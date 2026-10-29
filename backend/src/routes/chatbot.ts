import { Router, Request, Response } from 'express';
import * as jwt from 'jsonwebtoken';
import { redactSensitiveString } from '../utils/privacyRedactor';
import { aiProviderManager, NaniMessageItem, ToolCallProposal } from '../services/aiProvider';
import { evaluateEmergencySafety, EmergencySafetyState } from '../services/naniEmergencyGuard';
import { NANI_TOOLS, executeNaniTool } from '../services/naniTools';
import { NANI_PROMPT_VERSION } from '../services/naniPrompts';
import { modelRegistry } from '../services/naniModelRegistry';
import { taskRouter } from '../services/naniTaskRouter';
import { knowledgeRetrieval } from '../services/naniKnowledgeRetrieval';
import { voiceCoordinator } from '../services/naniVoiceEngine';

const router = Router();

const JWT_SECRET =
  process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'lifelink_jwt_secret_key_2026_super_secure');

// Persistent message record for conversational history inspection & auditing
export interface ChatMessageRecord {
  id: string;
  sender: 'user' | 'nani';
  text: string;
  timestamp: string;
  language?: string;
  provider?: string;
  isEmergency?: boolean;
  toolCall?: any;
}

// In-memory conversation session store with user attribution and timestamp tracking
export interface ChatSessionRecord {
  sessionId: string;
  userId?: string;
  history: NaniMessageItem[];
  messages: ChatMessageRecord[];
  lastActive: number;
}

const sessionStore = new Map<string, ChatSessionRecord>();

// Periodic session cleanup for expired sessions (older than 2 hours TTL)
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessionStore.entries()) {
    if (now - session.lastActive > SESSION_TTL_MS) {
      sessionStore.delete(id);
    }
  }
}, 30 * 60 * 1000).unref();

// In-memory sliding rate-limiter: max 30 requests per minute per sessionId / IP
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + 60000 });
    return true;
  }
  if (entry.count >= 30) {
    return false;
  }
  entry.count += 1;
  return true;
}

/**
 * Extracts optional authenticated user identity from the Authorization Bearer header.
 */
function extractAuthUser(req: Request): { id: string; role: string; name?: string; email?: string } | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.split(' ')[1];
  if (!token) return null;

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    if (decoded && decoded.id) {
      return { id: decoded.id, role: decoded.role || 'PATIENT', name: decoded.name, email: decoded.email };
    }
    return null;
  } catch (err: any) {
    throw new Error('INVALID_TOKEN');
  }
}

/**
 * GET /api/v1/chatbot/status
 * Returns real-time model readiness, Ollama daemon status, Groq cloud status, and active tools.
 */
router.get('/status', async (_req: Request, res: Response) => {
  try {
    const health = await aiProviderManager.healthCheck();
    const activeProvider = aiProviderManager.getActiveProviderType();
    const providerMode = aiProviderManager.getProviderMode();
    const groqAdapter = aiProviderManager.getGroqAdapter();
    const ollamaAdapter = aiProviderManager.getOllamaAdapter();
    const nvidiaAdapter = aiProviderManager.getNvidiaAdapter();
    const voiceStatus = await voiceCoordinator.getStatus();
    const knowledgeStatus = await knowledgeRetrieval.checkEmbeddingModelAvailability();

    return res.status(200).json({
      status: 'success',
      data: {
        provider: health.provider,
        activeProvider,
        providerMode,
        model: health.model,
        available: health.available,
        latencyMs: health.latencyMs,
        installedModels: health.installedModels || [],
        zeroCost: aiProviderManager.isZeroCost(),
        promptVersion: NANI_PROMPT_VERSION,
        toolsEnabled: NANI_TOOLS.map((t: any) => t.function.name),
        rateLimited: health.rateLimited,
        cooldownRemainingSec: health.cooldownRemainingSec,
        groqConfigured: groqAdapter.isConfigured(),
        ollamaConfigured: ollamaAdapter.isConfigured(),
        nvidiaConfigured: nvidiaAdapter.isConfigured(),
        modelRegistry: modelRegistry.getAll().map((m) => ({
          id: m.id,
          displayName: m.displayName,
          provider: m.provider,
          privacyClassification: m.privacyClassification,
          costMode: m.costMode,
          isAvailable: m.isAvailable,
          taskCapabilities: m.taskCapabilities,
        })),
        voiceEngineStatus: voiceStatus,
        knowledgeEngineStatus: knowledgeStatus,
        error: health.error,
      },
    });
  } catch (err: any) {
    return res.status(500).json({
      status: 'error',
      message: err.message || 'Failed to check model status',
    });
  }
});

/**
 * GET /api/v1/chatbot/config
 * Returns current AI provider configuration, model info, emergency numbers,
 * speech synthesis/recognition limitations, zero-cost mode, and privacy retention policy.
 */
router.get('/config', (_req: Request, res: Response) => {
  const activeProvider = aiProviderManager.getActiveProviderType();
  const providerMode = aiProviderManager.getProviderMode();
  const isLive = aiProviderManager.isLiveAiConfigured();
  const isZeroCost = aiProviderManager.isZeroCost();
  const activeModel = aiProviderManager.getActiveModelName();
  const groq = aiProviderManager.getGroqAdapter();

  return res.status(200).json({
    status: 'success',
    data: {
      provider: activeProvider,
      providerMode,
      isLiveAiConfigured: isLive,
      model: activeModel,
      groqConfigured: groq.isConfigured(),
      groqModel: groq.modelIdentifier,
      promptVersion: NANI_PROMPT_VERSION,
      voiceSupported: true,
      emergencyNumber: '112',
      nationalAmbulanceNumber: '108',
      zeroCostMode: isZeroCost,
      pricingNotes: isZeroCost
        ? 'Zero-cost local-first operation active via Ollama. No external cloud API fees or per-token charges.'
        : 'External cloud model active (Groq / Gemini). Usage limits and cloud policies apply.',
      integrationDisclaimer:
        'LifeLink provides rapid one-tap dialing assistance for National Emergency 112 and Ambulance 108. LifeLink does not claim an official government backend dispatch integration with 112.',
      privacyPolicy: {
        audioRetention:
          'LifeLink does NOT record, stream, or store user microphone audio on any server. Voice recognition operates client-side via browser Web Speech API.',
        retentionPolicy: 'In-memory sliding TTL (2 hours) or deleted immediately on user clear request.',
        piiHandling:
          'Client and server sanitize phone numbers, emails, Aadhaar IDs, and credentials before any external or local model dispatch.',
        authenticatedTenantIsolation:
          'Conversation history is strictly partitioned by authenticated user ID or private session key.',
        externalAiPolicy:
          'Groq cloud inference is only utilized when explicit user consent (allowExternalAi) is granted. Otherwise, queries remain strictly on private local models.',
      },
      speechCapabilities: {
        supported: true,
        speechSynthesis: 'Browser-native Web Speech API SpeechSynthesis running 100% on-device with zero network latency.',
        speechRecognition:
          'Browser-native Web Speech API SpeechRecognition supported in Google Chrome, Microsoft Edge, and Safari; unsupported by default in Mozilla Firefox.',
        limitations:
          'Microphone permissions require secure context (HTTPS) in production. SpeechRecognition is limited or unsupported in Firefox without experimental flags.',
        offlineVoiceSupport: 'Local browser synthetic voices execute 100% on-device with zero network latency or cost.',
        httpsRequired: 'Microphone permissions require secure context (HTTPS) in production deployments.',
      },
    },
  });
});

/**
 * GET /api/v1/chatbot/history
 * Retrieves stored conversation messages for the current session or authenticated user.
 */
router.get('/history', (req: Request, res: Response) => {
  let authUser: { id: string; role: string } | null = null;
  try {
    authUser = extractAuthUser(req);
  } catch {
    return res.status(401).json({ status: 'fail', message: 'Invalid or expired authorization token.' });
  }

  const queryUserId = (req.query.userId as string) || undefined;
  const sessionId = (req.query.sessionId as string) || undefined;

  // Horizontal authorization gatekeeper
  if (authUser) {
    if (queryUserId && queryUserId !== authUser.id && authUser.role !== 'SUPER_ADMIN') {
      return res.status(403).json({
        status: 'fail',
        message: "Forbidden: You do not have permission to access another user's conversation history.",
      });
    }
  } else if (queryUserId) {
    return res.status(401).json({
      status: 'fail',
      message: 'Authentication required to inspect patient conversation history.',
    });
  }

  // Locate session by sessionId or userId
  let matchedSession: ChatSessionRecord | undefined;
  if (sessionId && sessionStore.has(sessionId)) {
    matchedSession = sessionStore.get(sessionId);
    if (matchedSession?.userId && authUser && matchedSession.userId !== authUser.id && authUser.role !== 'SUPER_ADMIN') {
      return res.status(403).json({
        status: 'fail',
        message: "Forbidden: You do not have permission to access another user's conversation session.",
      });
    }
  } else if (authUser) {
    for (const session of sessionStore.values()) {
      if (session.userId === authUser.id) {
        matchedSession = session;
        break;
      }
    }
  }

  return res.status(200).json({
    status: 'success',
    data: {
      sessionId: matchedSession?.sessionId || sessionId || 'none',
      messages: matchedSession?.messages || [],
      count: matchedSession?.messages?.length || 0,
      retentionPolicy: 'In-memory 2-hour TTL sliding window',
    },
  });
});

/**
 * DELETE /api/v1/chatbot/history
 * Clears stored conversation messages for the current session or authenticated user.
 */
router.delete('/history', (req: Request, res: Response) => {
  let authUser: { id: string; role: string } | null = null;
  try {
    authUser = extractAuthUser(req);
  } catch {
    return res.status(401).json({ status: 'fail', message: 'Invalid or expired authorization token.' });
  }

  const targetUserId = (req.query.userId as string) || (req.body?.userId as string) || undefined;
  const sessionId = (req.query.sessionId as string) || (req.body?.sessionId as string) || undefined;

  if (authUser) {
    if (targetUserId && targetUserId !== authUser.id && authUser.role !== 'SUPER_ADMIN') {
      return res.status(403).json({
        status: 'fail',
        message: "Forbidden: You do not have permission to clear another user's conversation history.",
      });
    }

    const toDelete: string[] = [];
    for (const [sId, record] of sessionStore.entries()) {
      if (record.userId === authUser.id || (sessionId && sId === sessionId)) {
        toDelete.push(sId);
      }
    }
    toDelete.forEach((id) => sessionStore.delete(id));
  } else {
    if (targetUserId) {
      return res.status(401).json({
        status: 'fail',
        message: 'Authentication required to clear user conversation history.',
      });
    }
    if (sessionId) {
      sessionStore.delete(sessionId);
    }
  }

  return res.status(200).json({
    status: 'success',
    message: 'Conversation history cleared successfully in compliance with privacy retention guidelines.',
  });
});

/**
 * POST /api/v1/chatbot/message
 * Primary conversational entry point.
 * Body: { message: string, language?: string, sessionId?: string }
 */
router.post('/message', async (req: Request, res: Response) => {
  try {
    let authUser: { id: string; role: string; name?: string } | null = null;
    try {
      authUser = extractAuthUser(req);
    } catch {
      return res.status(401).json({ status: 'fail', message: 'Invalid or expired authorization token.' });
    }

    const { message, language = 'Hinglish', sessionId = `session_${Date.now()}`, allowExternalAi } = req.body;

    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'Message content is required.' });
    }

    // Input length limit check
    if (message.length > 1500) {
      return res.status(400).json({
        error: 'Message length exceeds maximum allowable limit of 1500 characters. Please provide a more concise inquiry.',
        code: 'MESSAGE_TOO_LONG',
      });
    }

    // Rate limit check
    const rateLimitKey = authUser?.id || req.ip || sessionId;
    if (!checkRateLimit(rateLimitKey)) {
      return res.status(429).json({
        error: 'Too many requests. Please wait a moment before sending another message to Nani.',
        code: 'RATE_LIMIT_EXCEEDED',
      });
    }

    const trimmedMessage = message.trim();

    // Retrieve or initialize conversation session history
    let session = sessionStore.get(sessionId);
    if (!session) {
      session = {
        sessionId,
        userId: authUser?.id,
        history: [],
        messages: [],
        lastActive: Date.now(),
      };
      sessionStore.set(sessionId, session);
    } else {
      session.lastActive = Date.now();
      if (authUser && !session.userId) {
        session.userId = authUser.id;
      }
    }

    // Record incoming user message in session message log
    const userMsgRecord: ChatMessageRecord = {
      id: `usr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      sender: 'user',
      text: trimmedMessage,
      timestamp: new Date().toISOString(),
      language,
    };
    session.messages.push(userMsgRecord);

    // =========================================================================
    // STEP 1: DETERMINISTIC EMERGENCY SAFETY GUARDRAIL
    // Clinical Rule: Runs BEFORE any model invocation. Zero conversational delay.
    // =========================================================================
    const emergencyState: EmergencySafetyState = evaluateEmergencySafety(trimmedMessage, language);

    if (emergencyState.requiresUrgentGuidance) {
      const guardrailProvider = aiProviderManager.isLiveAiConfigured() ? 'emergency_guardrail' : 'local_fallback';

      const botReplyRecord: ChatMessageRecord = {
        id: `bot_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        sender: 'nani',
        text: emergencyState.guidance,
        timestamp: new Date().toISOString(),
        language,
        provider: guardrailProvider,
        isEmergency: true,
      };
      session.messages.push(botReplyRecord);

      return res.status(200).json({
        reply: emergencyState.guidance,
        sessionId,
        language,
        isEmergency: true,
        safetyLevel: emergencyState.safetyLevel,
        requiresUrgentGuidance: true,
        detectedKeywords: emergencyState.detectedKeywords,
        provider: guardrailProvider,
        emergencyContact: '112',
        emergencyGuidance: {
          nationalEmergency: emergencyState.emergencyNumber,
          ambulanceMedicalService: emergencyState.ambulanceNumber,
          action: 'DIAL_112_OR_TRIGGER_SOS',
          ambulanceType: 'ADVANCED_LIFE_SUPPORT',
          dispatchAvailable: emergencyState.dispatchAvailable,
          autoDispatch: false,
          disclaimer:
            'Nani is an AI assistant, not a doctor or diagnostic service. Immediate professional medical care is required.',
          integrationNote:
            'LifeLink provides direct 112 calling assistance and does not claim official government backend dispatch integration with National Emergency 112.',
        },
      });
    }

    // =========================================================================
    // STEP 2: TASK-AWARE & PRIVACY-AWARE MULTI-MODEL ROUTING
    // =========================================================================
    const aiResult = await taskRouter.routeAndExecute({
      prompt: trimmedMessage,
      language,
      sessionId,
      history: session.history,
      tools: NANI_TOOLS,
      authUser,
      allowExternalAi: Boolean(allowExternalAi),
    });

    let finalReply = aiResult.reply;
    let toolExecutionData: any = null;

    // =========================================================================
    // STEP 3: STRICT TOOL CALL HANDLING
    // =========================================================================
    if (aiResult.toolCalls && aiResult.toolCalls.length > 0) {
      const toolCall = aiResult.toolCalls[0];
      const toolExec = await executeNaniTool(toolCall.function.name, toolCall.function.arguments, authUser);
      toolExecutionData = toolExec;

      if (toolExec.requiresUserConfirmation) {
        finalReply = `${finalReply ? finalReply + '\n\n' : ''}⚠️ I have prepared the ${toolCall.function.name === 'book_doctor_appointment' ? 'appointment booking' : 'ambulance dispatch'} request. Please confirm to proceed.`;
      } else if (toolExec.success && toolExec.data) {
        // Incorporate tool output into conversation
        if (toolCall.function.name === 'search_hospitals') {
          const count = toolExec.data.count || 0;
          const facList = (toolExec.data.facilities || []).slice(0, 3).map((f: any) => `• **${f.name}** (${f.locality}, ${f.tehsil}) - 📞 ${f.emergencyPhone || '112'}`).join('\n');
          finalReply = `${finalReply ? finalReply + '\n\n' : ''}Found ${count} hospital(s):\n${facList}`;
        } else if (toolCall.function.name === 'get_hospital_contact') {
          const d = toolExec.data;
          finalReply = `🏥 **${d.name}**\n📍 ${d.address || d.locality}\n🚨 24x7 Emergency Desk: **${d.emergencyPhone}**\n🚑 Ambulance Helpdesk: **${d.ambulancePhone}**`;
        } else if (toolCall.function.name === 'check_bed_capacity') {
          const d = toolExec.data;
          finalReply = `🛏️ **${d.hospitalName} Bed Capacity:**\n• Available Beds: **${d.availableBeds} / ${d.totalBeds}**\n• ICU Available: **${d.icuAvailable}**\n• Status: **${d.dataFreshness}** (${d.ageMinutes} mins ago)`;
        } else if (toolCall.function.name === 'check_doctor_slots') {
          const doc = toolExec.data.doctors?.[0];
          if (doc) {
            const slotsText = doc.slots.map((s: any) => `• ${s.date} ${s.time} (${s.remainingCapacity} slots left)`).join('\n');
            finalReply = `👨‍⚕️ **${doc.name}** (${doc.specialization})\n🏥 ${doc.hospital}\nAvailable Slots:\n${slotsText || 'No open slots on this date.'}`;
          }
        }
      }
    }

    // Update rolling history for context window (last 10 exchanges = 20 items)
    const sanitizedPrompt = redactSensitiveString(trimmedMessage);
    session.history.push({
      role: 'user',
      content: sanitizedPrompt,
    });
    session.history.push({
      role: 'assistant',
      content: finalReply,
    });

    if (session.history.length > 20) {
      session.history = session.history.slice(-20);
    }

    // Record bot reply in session message log
    const botReplyRecord: ChatMessageRecord = {
      id: `bot_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      sender: 'nani',
      text: finalReply,
      timestamp: new Date().toISOString(),
      language,
      provider: aiResult.provider,
      isEmergency: false,
      toolCall: toolExecutionData,
    };
    session.messages.push(botReplyRecord);

    return res.status(200).json({
      reply: finalReply,
      sessionId,
      language,
      isEmergency: false,
      safetyLevel: 'NON_EMERGENCY',
      provider: aiResult.provider,
      modelName: aiResult.modelName,
      costMode: aiResult.costMode,
      pricingNote: aiResult.pricingNote,
      disclaimer: aiResult.disclaimer,
      toolExecution: toolExecutionData,
      taskCategory: aiResult.taskCategory,
      selectedModelId: aiResult.selectedModelId,
      retrievedDocuments: aiResult.retrievedDocuments,
      reviewedBySecondModel: aiResult.reviewedBySecondModel,
      routingLatencyMs: aiResult.routingLatencyMs,
      latencyMs: aiResult.latencyMs,
      error: aiResult.error,
    });
  } catch (error: any) {
    console.error('Error in Nani Chatbot API:', error);

    const userFallback =
      'I apologize, but I am experiencing connection difficulty with the health response network. Operating in zero-cost safe fallback. If you have an urgent medical need, please tap the SOS button or call 112 immediately!';

    return res.status(200).json({
      reply: userFallback,
      sessionId: req.body?.sessionId || 'default',
      isEmergency: false,
      safetyLevel: 'NON_EMERGENCY',
      provider: 'local_fallback',
      error: error.message || 'Processing error',
    });
  }
});

export default router;
