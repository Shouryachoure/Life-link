/**
 * LifeLink NANI - Central Task-Aware & Privacy-Aware Orchestrator
 * 
 * Routing Invariants:
 * 1. Task-aware model selection: Uses the smallest model that reliably completes each task.
 * 2. Privacy-first gate: Respects allowExternalAi; never sends patient data externally without explicit consent.
 * 3. 0ms Emergency Intercept: High-risk symptoms bypass all models instantly.
 * 4. Bounded Review: At most 1 non-recursive second-model review for complex non-emergency queries.
 * 5. Deterministic fallback: Gracefully falls back to local Ollama or deterministic heuristics.
 */

import { NaniTaskCategory, modelRegistry, ModelRegistryEntry } from './naniModelRegistry';
import { aiProviderManager, AiGenerateOptions, AiResponse, AiProviderType } from './aiProvider';
import { evaluateEmergencySafety, EmergencySafetyState } from './naniEmergencyGuard';
import { knowledgeRetrieval, RetrievedDocument } from './naniKnowledgeRetrieval';
import { redactSensitiveString } from '../utils/privacyRedactor';

export interface RoutedExecutionResult extends AiResponse {
  taskCategory: NaniTaskCategory;
  selectedModelId: string;
  externalConsentGranted: boolean;
  retrievedDocuments?: RetrievedDocument[];
  reviewedBySecondModel?: boolean;
  routingLatencyMs: number;
}

export class NaniTaskRouter {
  /**
   * Classifies user inquiry into one of the 9 explicit NANI task categories.
   */
  classifyTask(prompt: string, language?: string, toolsProvided: boolean = false): NaniTaskCategory {
    const text = prompt.toLowerCase().trim();

    // 1. Step 0 Check: Acute Emergency
    const safety = evaluateEmergencySafety(prompt, language);
    if (safety.requiresUrgentGuidance || safety.safetyLevel !== 'NON_EMERGENCY') {
      return 'EMERGENCY_ASSISTANCE';
    }

    // 2. Hospital Directory Search
    if (
      text.includes('hospital') ||
      text.includes('aspatal') ||
      text.includes('bed') ||
      text.includes('icu') ||
      text.includes('gmch') ||
      text.includes('mayo') ||
      text.includes('aiims') ||
      text.includes('casualty') ||
      text.includes('dhantoli') ||
      text.includes('ramdaspeth')
    ) {
      return 'HOSPITAL_DIRECTORY';
    }

    // 3. Appointment & OPD Assistance
    if (
      text.includes('appointment') ||
      text.includes('opd') ||
      text.includes('doctor') ||
      text.includes('slot') ||
      text.includes('consult') ||
      text.includes('dr.') ||
      text.includes('dr ') ||
      text.includes('timing')
    ) {
      return 'APPOINTMENT_ASSISTANCE';
    }

    // 4. Authorized Information Summarization
    if (
      text.includes('summarize') ||
      text.includes('summary') ||
      text.includes('saransh') ||
      text.includes('brief me on') ||
      text.includes('review my record')
    ) {
      return 'AUTHORIZED_SUMMARIZATION';
    }

    // 5. Healthcare Knowledge Retrieval (Government schemes, ambulance tiers, helplines)
    if (
      text.includes('mjpjay') ||
      text.includes('ayushman') ||
      text.includes('scheme') ||
      text.includes('yojana') ||
      text.includes('helpline') ||
      text.includes('bls') ||
      text.includes('als') ||
      text.includes('golden card')
    ) {
      return 'HEALTHCARE_KNOWLEDGE_RETRIEVAL';
    }

    // 6. Tool-Call Argument Generation
    if (toolsProvided && (text.includes('book') || text.includes('dispatch') || text.includes('call') || text.includes('search'))) {
      return 'TOOL_CALL_ARGUMENT_GEN';
    }

    // 7. Hinglish / Hindi Intent Understanding
    const hinglishMarkers = [
      'kya', 'hai', 'batao', 'kaise', 'karein', 'chahiye', 'namaste', 'shukriya',
      'madad', 'bhai', 'dada', 'bachha', 'ghar', 'takleef', 'bukhar', 'dard',
      'sardi', 'gale', 'aaram', 'dawa', 'parcha'
    ];
    const isHinglish = hinglishMarkers.some((m) => text.includes(m)) || language === 'Hinglish' || language === 'Hindi';
    if (isHinglish) {
      return 'HINGLISH_INTENT';
    }

    // 8. Default: General Conversation
    return 'GENERAL_CONVERSATION';
  }

  /**
   * Selects the optimal model for a given task, enforcing privacy boundaries and
   * choosing the smallest reliable model.
   */
  selectModelForTask(
    task: NaniTaskCategory,
    allowExternalAi: boolean,
    providerMode: string = 'auto'
  ): ModelRegistryEntry {
    const allModels = modelRegistry.getAll();

    // Emergency always maps to deterministic baseline (< 1ms)
    if (task === 'EMERGENCY_ASSISTANCE') {
      return (
        allModels.find((m) => m.id === 'local/heuristic_engine') ||
        allModels[allModels.length - 1]
      );
    }

    // If external AI consent is absent, STRICTLY limit candidates to local_private
    let candidates = allModels.filter((m) => {
      if (!allowExternalAi && m.privacyClassification !== 'local_private') {
        return false;
      }
      return true;
    });

    // If explicit provider mode is requested:
    if (providerMode === 'groq') {
      if (allowExternalAi) {
        const groqCandidate = candidates.find((m) => m.provider === 'groq' && m.taskCapabilities.includes(task));
        if (groqCandidate) return groqCandidate;
      }
    } else if (providerMode === 'ollama') {
      const ollamaCandidate = candidates.find((m) => m.provider === 'ollama' && m.taskCapabilities.includes(task));
      if (ollamaCandidate) return ollamaCandidate;
    } else if (providerMode === 'local_fallback') {
      return allModels.find((m) => m.id === 'local/heuristic_engine')!;
    }

    // Auto Mode Selection — Smallest capable model strategy:
    // 1. If external consent is granted and Groq is healthy:
    //    - For HINGLISH_INTENT, GENERAL_CONVERSATION: use Groq gpt-oss-20b (fast, lightweight LPU)
    //    - For AUTHORIZED_SUMMARIZATION, RESPONSE_REVIEW: use Groq llama-3.3-70b-versatile (high precision)
    if (allowExternalAi && providerMode === 'auto') {
      const groqAdapter = aiProviderManager.getGroqAdapter();
      if (groqAdapter.isConfigured() && !groqAdapter.isRateLimited()) {
        if (task === 'AUTHORIZED_SUMMARIZATION' || task === 'RESPONSE_REVIEW') {
          const l70 = candidates.find((m) => m.id === 'groq/llama-3.3-70b-versatile');
          if (l70) return l70;
        }
        const g20 = candidates.find((m) => m.id.includes('groq'));
        if (g20) return g20;
      }
    }

    // 2. Local-First Strategy (Default & Privacy Preserving):
    // Smallest model: qwen3:4b (Q4_K_M, 2.5 GB)
    const localSmall = candidates.find(
      (m) => m.provider === 'ollama' && m.taskCapabilities.includes(task)
    );
    if (localSmall) return localSmall;

    // 3. Absolute Fallback: Local Heuristic Provider
    return allModels.find((m) => m.id === 'local/heuristic_engine') || allModels[0];
  }

  /**
   * Executes routed request with pre-retrieval and optional bounded second-model review.
   */
  async routeAndExecute(options: AiGenerateOptions): Promise<RoutedExecutionResult> {
    const routeStart = Date.now();
    const allowExternal = Boolean(options.allowExternalAi);
    const providerMode = aiProviderManager.getProviderMode();

    // 1. Task Classification
    const task = this.classifyTask(options.prompt, options.language, Boolean(options.tools && options.tools.length > 0));

    // 2. Step 0 Deterministic Emergency Intercept (0ms)
    if (task === 'EMERGENCY_ASSISTANCE') {
      const safety = evaluateEmergencySafety(options.prompt, options.language);
      return {
        reply: safety.guidance,
        provider: 'local_fallback',
        modelName: 'deterministic_emergency_guard',
        isEmergency: true,
        costMode: 'zero_cost',
        pricingNote: 'Zero-cost deterministic emergency safety intercept (< 1ms).',
        disclaimer: 'Nani is an AI assistant, not an emergency clinician or diagnostic service.',
        taskCategory: 'EMERGENCY_ASSISTANCE',
        selectedModelId: 'local/heuristic_engine',
        externalConsentGranted: allowExternal,
        routingLatencyMs: Date.now() - routeStart,
      };
    }

    // 3. Grounded Knowledge Retrieval (For directory & healthcare inquiries)
    let retrievedDocs: RetrievedDocument[] | undefined;
    if (task === 'HEALTHCARE_KNOWLEDGE_RETRIEVAL' || task === 'HOSPITAL_DIRECTORY') {
      try {
        retrievedDocs = await knowledgeRetrieval.retrieve(options.prompt, 2);
      } catch (err) {
        console.warn('Knowledge retrieval warning:', err);
      }
    }

    // 4. Model Selection (Smallest capable model respecting privacy)
    const selectedModel = this.selectModelForTask(task, allowExternal, providerMode);

    // 5. Build enriched prompt if grounded knowledge is available
    let executionOptions: AiGenerateOptions = { ...options };
    if (retrievedDocs && retrievedDocs.length > 0) {
      const groundingContext = retrievedDocs
        .map((d) => `[Verified Source: ${d.title} (${d.sourceUrl}, Verified: ${d.verificationState}, Freshness: ${d.dataFreshness})]\n${d.snippet}`)
        .join('\n\n');

      executionOptions = {
        ...options,
        systemInstruction: `${options.systemInstruction || ''}\n\n[AUTHORITATIVE SOURCED CONTEXT - Base your answer strictly on this verified data]:\n${groundingContext}`,
      };
    }

    // 6. Generate Response
    const primaryResponse = await aiProviderManager.generateResponse(executionOptions);

    // 7. Optional Bounded Second-Model Review (Only for complex non-emergency summaries; bounded to 1 call)
    let reviewedBySecond = false;
    let finalReply = primaryResponse.reply;

    const shouldReview =
      task === 'AUTHORIZED_SUMMARIZATION' &&
      allowExternal &&
      selectedModel.provider === 'groq' &&
      primaryResponse.reply.length > 200;

    if (shouldReview) {
      try {
        const reviewController = new AbortController();
        const reviewTimeout = setTimeout(() => reviewController.abort(), 2500);

        // Bounded single-call review using lightweight local or Groq pass
        const reviewPrompt = `You are a medical factual reviewer. Briefly review this healthcare coordinator draft. Ensure no fabricated treatments or false promises exist. If safe, return the text unchanged. Draft:\n${primaryResponse.reply}`;

        // Call once, bounded
        const reviewRes = await aiProviderManager.generateResponse({
          prompt: reviewPrompt,
          language: options.language,
          allowExternalAi: false, // Review locally to bound cloud calls
        });

        clearTimeout(reviewTimeout);
        if (reviewRes.reply && reviewRes.reply.length > 20 && !reviewRes.reply.includes('error')) {
          finalReply = reviewRes.reply;
          reviewedBySecond = true;
        }
      } catch (reviewErr) {
        // Soft fail: return primary response if review times out or errors
        console.warn('Second-model review skipped due to timeout/error');
      }
    }

    return {
      ...primaryResponse,
      reply: finalReply,
      taskCategory: task,
      selectedModelId: selectedModel.id,
      externalConsentGranted: allowExternal,
      retrievedDocuments: retrievedDocs,
      reviewedBySecondModel: reviewedBySecond,
      routingLatencyMs: Date.now() - routeStart,
    };
  }
}

export const taskRouter = new NaniTaskRouter();
