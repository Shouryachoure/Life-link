import { GoogleGenerativeAI, Content } from '@google/generative-ai';
import { redactSensitiveString } from '../utils/privacyRedactor';
import { buildNaniSystemPrompt, NANI_PROMPT_VERSION } from './naniPrompts';
import { NANI_TOOLS, ToolDefinition } from './naniTools';

export type AiProviderType = 'ollama' | 'groq' | 'nvidia' | 'gemini' | 'local_fallback';
export type NaniProviderMode = 'auto' | 'groq' | 'ollama' | 'nvidia' | 'gemini' | 'local_fallback';

export interface NaniMessageItem {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_calls?: any[];
}

export interface AiGenerateOptions {
  prompt: string;
  language?: string;
  sessionId?: string;
  history?: NaniMessageItem[];
  systemInstruction?: string;
  tools?: ToolDefinition[];
  authUser?: { id: string; role: string; name?: string } | null;
  allowExternalAi?: boolean;
}

export interface ToolCallProposal {
  id?: string;
  type: 'function';
  function: {
    name: string;
    arguments: Record<string, any>;
  };
}

export interface AiResponse {
  reply: string;
  provider: AiProviderType;
  modelName: string;
  isEmergency: boolean;
  costMode: 'zero_cost' | 'external_billed';
  pricingNote: string;
  disclaimer: string;
  toolCalls?: ToolCallProposal[];
  error?: string;
  latencyMs?: number;
}

export interface ProviderHealthStatus {
  available: boolean;
  provider: AiProviderType;
  model: string;
  latencyMs?: number;
  installedModels?: string[];
  rateLimited?: boolean;
  cooldownRemainingSec?: number;
  error?: string;
}

export interface IAiAdapter {
  name: AiProviderType;
  modelIdentifier: string;
  isConfigured(): boolean;
  healthCheck(): Promise<ProviderHealthStatus>;
  generate(options: AiGenerateOptions): Promise<AiResponse>;
}

/**
 * 1. Primary Local Provider: Ollama Native Adapter
 * 
 * Target Architecture:
 * - 100% Zero-Cost Local-First Inference on AMD Ryzen 5 8500G / CPU / Integrated Graphics
 * - Connects to local Ollama daemon (defaults to http://127.0.0.1:11434)
 * - Configurable model: NANI_MODEL (default: qwen3:4b, fallback to installed qwen2.5:3b / llama3.2:3b)
 * - Bounded generation: temperature 0.3, context limit 4096, max tokens 400
 * - Never transmits sensitive data to the public internet
 */
export class OllamaAiAdapter implements IAiAdapter {
  name: AiProviderType = 'ollama';
  baseUrl: string;
  modelIdentifier: string;
  timeoutMs: number = process.env.OLLAMA_TIMEOUT_MS ? parseInt(process.env.OLLAMA_TIMEOUT_MS) : 35000;
  maxTokens: number = 380;
  fallbackInstalledModel?: string;

  constructor(options?: { baseUrl?: string; model?: string; timeoutMs?: number; maxTokens?: number }) {
    this.baseUrl = options?.baseUrl || process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
    this.modelIdentifier = options?.model || process.env.NANI_LOCAL_MODEL || process.env.NANI_MODEL || 'qwen3:4b';
    if (options?.timeoutMs) this.timeoutMs = options.timeoutMs;
    if (options?.maxTokens) this.maxTokens = options.maxTokens;
  }

  isZeroCost(): boolean {
    return true;
  }

  isConfigured(): boolean {
    if (process.env.NODE_ENV === 'test') {
      if (process.env.NANI_PROVIDER === 'ollama') return true;
      return Boolean(process.env.LOCAL_AI_URL && process.env.LOCAL_AI_URL.trim().length > 0);
    }
    if (process.env.NANI_PROVIDER === 'ollama' || process.env.NANI_PROVIDER === 'auto') {
      return true;
    }
    if (process.env.NANI_PROVIDER === 'gemini' || process.env.NANI_PROVIDER === 'local_fallback') {
      return false;
    }
    return true;
  }

  async healthCheck(): Promise<ProviderHealthStatus> {
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);

      const res = await fetch(`${this.baseUrl}/api/tags`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        return {
          available: false,
          provider: 'ollama',
          model: this.modelIdentifier,
          latencyMs: Date.now() - start,
          error: `Ollama server returned HTTP ${res.status}`,
        };
      }

      const data = (await res.json()) as any;
      const models = (data?.models || []).map((m: any) => m.name || m.model);

      // Check if primary requested model is installed
      const hasRequestedModel = models.some(
        (m: string) => m === this.modelIdentifier || m.startsWith(`${this.modelIdentifier}:`)
      );

      // Check for available alternative local model (e.g. qwen2.5:3b)
      if (!hasRequestedModel) {
        const altQwen = models.find((m: string) => m.includes('qwen') || m.includes('llama'));
        if (altQwen) {
          this.fallbackInstalledModel = altQwen;
        }
      }

      return {
        available: true,
        provider: 'ollama',
        model: hasRequestedModel ? this.modelIdentifier : (this.fallbackInstalledModel || this.modelIdentifier),
        installedModels: models,
        latencyMs: Date.now() - start,
        error: hasRequestedModel
          ? undefined
          : `Requested model "${this.modelIdentifier}" is not yet pulled. Available local models: ${models.join(', ') || 'none'}.`,
      };
    } catch (err: any) {
      return {
        available: false,
        provider: 'ollama',
        model: this.modelIdentifier,
        latencyMs: Date.now() - start,
        error: err.name === 'AbortError'
          ? 'Ollama health check timed out (daemon unresponsive)'
          : `Cannot connect to Ollama at ${this.baseUrl} (${err.message || 'Connection refused'})`,
      };
    }
  }

  async generate(options: AiGenerateOptions): Promise<AiResponse> {
    const start = Date.now();
    const sanitizedPrompt = redactSensitiveString(options.prompt);
    const lang = options.language || 'Hinglish';

    const systemInstruction = options.systemInstruction || buildNaniSystemPrompt(lang);

    // Build message array for Ollama /api/chat
    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemInstruction },
    ];

    if (options.history && options.history.length > 0) {
      for (const h of options.history) {
        messages.push({
          role: h.role === 'assistant' ? 'assistant' : 'user',
          content: redactSensitiveString(h.content),
        });
      }
    }

    messages.push({ role: 'user', content: sanitizedPrompt });

    // Use requested model, or fallback to an available local model
    let targetModel = this.modelIdentifier;
    if (this.fallbackInstalledModel) {
      targetModel = this.fallbackInstalledModel;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const payload: any = {
        model: targetModel,
        messages,
        stream: false,
        options: {
          temperature: 0.3,
          num_ctx: 1536,
          num_predict: Math.min(this.maxTokens, 120),
        },
      };

      if (options.tools && options.tools.length > 0) {
        payload.tools = options.tools;
      }

      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify(payload),
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama HTTP ${response.status}: ${errorText || response.statusText}`);
      }

      const data = (await response.json()) as any;
      const message = data?.message;
      let replyText = (message?.content || '').trim();

      // If replyText is empty due to reasoning model token budget, check message.thinking
      if (!replyText && message?.thinking) {
        replyText = message.thinking.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        if (!replyText) {
          replyText = message.thinking.trim();
        }
      }

      // Parse tool calls if returned by model
      const toolCalls: ToolCallProposal[] = [];
      if (message?.tool_calls && Array.isArray(message.tool_calls)) {
        for (const tc of message.tool_calls) {
          if (tc.function?.name) {
            toolCalls.push({
              id: tc.id,
              type: 'function',
              function: {
                name: tc.function.name,
                arguments: typeof tc.function.arguments === 'string'
                  ? JSON.parse(tc.function.arguments)
                  : (tc.function.arguments || {}),
              },
            });
          }
        }
      }

      if (!replyText && toolCalls.length === 0) {
        throw new Error('Ollama returned an empty response');
      }

      return {
        reply: replyText,
        provider: 'ollama',
        modelName: targetModel,
        isEmergency: false,
        costMode: 'zero_cost',
        pricingNote: 'Local-first zero-cost inference running on private Ollama daemon.',
        disclaimer: 'Nani is an AI assistant, not a doctor. This guidance does not replace professional medical evaluation.',
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        latencyMs: Date.now() - start,
      };
    } catch (err: any) {
      clearTimeout(timeout);
      throw err;
    }
  }
}

/**
 * 2. High-Speed Cloud Provider: Groq OpenAI-Compatible Adapter
 * 
 * Target Architecture:
 * - Hosted ultra-low-latency cloud inference via Groq LPUs
 * - Standard endpoint: https://api.groq.com/openai/v1/chat/completions
 * - Configurable model: NANI_GROQ_MODEL (default: openai/gpt-oss-20b, or llama-3.3-70b-versatile)
 * - Strict PII Sanitization: Pre-scrubs identifiers, phones, emails, and ABHA numbers
 * - Explicit Consent Gate: Requires user consent (allowExternalAi) before dispatch
 * - Rate-Limit & Backoff: Respects HTTP 429 and Retry-After headers to prevent retry storms
 * - Fallback: Degrades gracefully to local Ollama or deterministic safety baseline
 */
export class GroqAiAdapter implements IAiAdapter {
  name: AiProviderType = 'groq';
  baseUrl: string;
  modelIdentifier: string;
  apiKey: string;
  timeoutMs: number = 12000;
  maxTokens: number = 400;
  rateLimitedUntil: number = 0;
  lastRetryAfterSec: number = 0;

  constructor(options?: {
    baseUrl?: string;
    model?: string;
    apiKey?: string;
    timeoutMs?: number;
    maxTokens?: number;
  }) {
    this.baseUrl = (options?.baseUrl || process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/+$/, '');
    this.modelIdentifier = options?.model || process.env.NANI_GROQ_MODEL || 'openai/gpt-oss-20b';
    this.apiKey = (options?.apiKey || process.env.GROQ_API_KEY || '').trim();
    if (options?.timeoutMs) this.timeoutMs = options.timeoutMs;
    if (options?.maxTokens) this.maxTokens = options.maxTokens;
  }

  isZeroCost(): boolean {
    return false; // Cloud hosted API
  }

  isConfigured(): boolean {
    return Boolean(
      this.apiKey &&
      this.apiKey.length > 0 &&
      this.apiKey !== 'mock' &&
      this.apiKey !== 'placeholder'
    );
  }

  isRateLimited(): boolean {
    return Date.now() < this.rateLimitedUntil;
  }

  getCooldownRemainingSec(): number {
    return Math.max(0, Math.ceil((this.rateLimitedUntil - Date.now()) / 1000));
  }

  setRateLimitCooldown(seconds: number): void {
    this.lastRetryAfterSec = seconds > 0 ? seconds : 30;
    this.rateLimitedUntil = Date.now() + (this.lastRetryAfterSec * 1000);
  }

  async healthCheck(): Promise<ProviderHealthStatus> {
    const start = Date.now();
    if (!this.isConfigured()) {
      return {
        available: false,
        provider: 'groq',
        model: this.modelIdentifier,
        latencyMs: 0,
        error: 'GROQ_API_KEY is not configured in backend environment.',
      };
    }

    if (this.isRateLimited()) {
      return {
        available: false,
        provider: 'groq',
        model: this.modelIdentifier,
        rateLimited: true,
        cooldownRemainingSec: this.getCooldownRemainingSec(),
        latencyMs: 0,
        error: `Groq HTTP 429 rate limit cooldown active (${this.getCooldownRemainingSec()}s remaining).`,
      };
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);

      const res = await fetch(`${this.baseUrl}/models`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (res.status === 401 || res.status === 403) {
        return {
          available: false,
          provider: 'groq',
          model: this.modelIdentifier,
          latencyMs: Date.now() - start,
          error: `Groq authentication failed (HTTP ${res.status}): Invalid GROQ_API_KEY or access denied.`,
        };
      }

      if (res.status === 429) {
        const retryHeader = res.headers.get('retry-after');
        const retrySec = retryHeader ? parseInt(retryHeader, 10) || 30 : 30;
        this.setRateLimitCooldown(retrySec);
        return {
          available: false,
          provider: 'groq',
          model: this.modelIdentifier,
          rateLimited: true,
          cooldownRemainingSec: retrySec,
          latencyMs: Date.now() - start,
          error: `Groq HTTP 429: Rate limit exceeded. Retry-After ${retrySec}s.`,
        };
      }

      if (!res.ok) {
        return {
          available: false,
          provider: 'groq',
          model: this.modelIdentifier,
          latencyMs: Date.now() - start,
          error: `Groq server returned HTTP ${res.status}: ${res.statusText}`,
        };
      }

      const data = (await res.json()) as any;
      const models = (data?.data || []).map((m: any) => m.id || m.model);
      const hasModel = models.includes(this.modelIdentifier);

      return {
        available: true,
        provider: 'groq',
        model: this.modelIdentifier,
        installedModels: models,
        latencyMs: Date.now() - start,
        error: hasModel
          ? undefined
          : `Configured model "${this.modelIdentifier}" not in current Groq model list.`,
      };
    } catch (err: any) {
      return {
        available: false,
        provider: 'groq',
        model: this.modelIdentifier,
        latencyMs: Date.now() - start,
        error: err.name === 'AbortError'
          ? 'Groq health check timed out (endpoint unresponsive)'
          : `Cannot connect to Groq at ${this.baseUrl}: ${err.message || 'Network error'}`,
      };
    }
  }

  async generate(options: AiGenerateOptions): Promise<AiResponse> {
    const start = Date.now();

    if (!this.isConfigured()) {
      throw new Error('GROQ_API_KEY is not configured in backend environment');
    }

    if (this.isRateLimited()) {
      const err: any = new Error(`Groq rate limit cooldown active (${this.getCooldownRemainingSec()}s remaining).`);
      err.status = 429;
      err.retryAfter = this.getCooldownRemainingSec();
      throw err;
    }

    // 1. Strict PII Sanitization
    const sanitizedPrompt = redactSensitiveString(options.prompt);
    const lang = options.language || 'Hinglish';
    const systemInstruction = options.systemInstruction || buildNaniSystemPrompt(lang);

    // 2. Build OpenAI-compatible chat messages array with bounded context window (minimize external exposure)
    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemInstruction },
    ];

    if (options.history && options.history.length > 0) {
      const boundedHistory = options.history.slice(-6);
      for (const h of boundedHistory) {
        messages.push({
          role: h.role === 'assistant' ? 'assistant' : 'user',
          content: redactSensitiveString(h.content),
        });
      }
    }

    messages.push({ role: 'user', content: sanitizedPrompt });

    // 3. Map tools to OpenAI standard tool call format
    const toolsPayload = (options.tools && options.tools.length > 0)
      ? options.tools.map((t) => ({
          type: 'function',
          function: {
            name: t.function.name,
            description: t.function.description,
            parameters: t.function.parameters,
          },
        }))
      : undefined;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const payload: any = {
        model: this.modelIdentifier,
        messages,
        temperature: 0.3,
        max_tokens: this.maxTokens,
      };

      if (toolsPayload) {
        payload.tools = toolsPayload;
        payload.tool_choice = 'auto';
      }

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify(payload),
      });

      clearTimeout(timeout);

      if (response.status === 429) {
        const retryHeader = response.headers.get('retry-after');
        const retrySec = retryHeader ? parseInt(retryHeader, 10) || 30 : 30;
        this.setRateLimitCooldown(retrySec);
        const errText = await response.text();
        const err: any = new Error(`Groq HTTP 429 Rate Limit Exceeded: Retry-After ${retrySec}s. ${errText || ''}`);
        err.status = 429;
        err.retryAfter = retrySec;
        throw err;
      }

      if (response.status === 401 || response.status === 403) {
        const errText = await response.text();
        throw new Error(`Groq authentication failed (HTTP ${response.status}): ${errText || 'Invalid API key'}`);
      }

      if (response.status === 404) {
        const errText = await response.text();
        throw new Error(`Groq model not found (HTTP 404): "${this.modelIdentifier}" is not available on Groq.`);
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Groq HTTP ${response.status}: ${errorText || response.statusText}`);
      }

      const data = (await response.json()) as any;
      const choice = data?.choices?.[0];
      const message = choice?.message;
      let replyText = (message?.content || '').trim();

      // Parse tool calls if proposed by Groq
      const toolCalls: ToolCallProposal[] = [];
      if (message?.tool_calls && Array.isArray(message.tool_calls)) {
        for (const tc of message.tool_calls) {
          if (tc.function?.name) {
            toolCalls.push({
              id: tc.id,
              type: 'function',
              function: {
                name: tc.function.name,
                arguments: typeof tc.function.arguments === 'string'
                  ? JSON.parse(tc.function.arguments)
                  : (tc.function.arguments || {}),
              },
            });
          }
        }
      }

      if (!replyText && toolCalls.length === 0) {
        throw new Error('Groq returned an empty response');
      }

      return {
        reply: replyText,
        provider: 'groq',
        modelName: this.modelIdentifier,
        isEmergency: false,
        costMode: 'external_billed',
        pricingNote: 'External Groq cloud hosted inference API (LPU acceleration).',
        disclaimer: 'Nani is an AI assistant, not a doctor. This guidance does not replace professional medical evaluation.',
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        latencyMs: Date.now() - start,
      };
    } catch (err: any) {
      clearTimeout(timeout);
      throw err;
    }
  }
}

/**
 * 3. Optional Remote Provider: Google Gemini AI Cloud Adapter
 * Only enabled if explicitly configured with GEMINI_API_KEY. Never required for local dev.
 */
export class GeminiAiAdapter implements IAiAdapter {
  name: AiProviderType = 'gemini';
  modelIdentifier: string;

  constructor() {
    this.modelIdentifier = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
  }

  isConfigured(): boolean {
    const key = process.env.GEMINI_API_KEY;
    return typeof key === 'string' && key.trim().length > 0 && key !== 'mock' && key !== 'placeholder';
  }

  async healthCheck(): Promise<ProviderHealthStatus> {
    if (!this.isConfigured()) {
      return {
        available: false,
        provider: 'gemini',
        model: this.modelIdentifier,
        error: 'GEMINI_API_KEY is not configured',
      };
    }
    return {
      available: true,
      provider: 'gemini',
      model: this.modelIdentifier,
    };
  }

  async generate(options: AiGenerateOptions): Promise<AiResponse> {
    const start = Date.now();
    const apiKey = process.env.GEMINI_API_KEY!;
    const sanitizedPrompt = redactSensitiveString(options.prompt);
    const lang = options.language || 'Hinglish';

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: this.modelIdentifier,
      systemInstruction: options.systemInstruction || buildNaniSystemPrompt(lang),
    });

    const chat = model.startChat({});
    const result = await chat.sendMessage(sanitizedPrompt);
    const replyText = result.response.text();

    return {
      reply: replyText,
      provider: 'gemini',
      modelName: this.modelIdentifier,
      isEmergency: false,
      costMode: 'external_billed',
      pricingNote: 'Using external Google Gemini Cloud API. External usage quotas apply.',
      disclaimer: 'Nani is an AI assistant, not a doctor. This guidance does not replace professional medical evaluation.',
      latencyMs: Date.now() - start,
    };
  }
}

/**
 * 4. Optional Remote Provider: NVIDIA Nemotron / OpenAI-Compatible NIM Adapter
 * Enabled only if NVIDIA_API_KEY is configured. Never required for local dev.
 */
export class NvidiaAiAdapter implements IAiAdapter {
  name: AiProviderType = 'nvidia';
  baseUrl: string;
  modelIdentifier: string;
  apiKey: string;
  timeoutMs: number = 10000;
  maxTokens: number = 512;

  constructor(options?: {
    baseUrl?: string;
    model?: string;
    apiKey?: string;
    timeoutMs?: number;
    maxTokens?: number;
  }) {
    this.baseUrl = (options?.baseUrl || process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1').replace(/\/+$/, '');
    this.modelIdentifier = options?.model || process.env.NANI_NVIDIA_MODEL || 'nvidia/nemotron-3.5-bolt-e4b';
    this.apiKey = (options?.apiKey || process.env.NVIDIA_API_KEY || '').trim();
    if (options?.timeoutMs) this.timeoutMs = options.timeoutMs;
    if (options?.maxTokens) this.maxTokens = options.maxTokens;
  }

  isZeroCost(): boolean {
    return false;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.length > 0 && this.apiKey !== 'mock' && this.apiKey !== 'placeholder');
  }

  async healthCheck(): Promise<ProviderHealthStatus> {
    const start = Date.now();
    if (!this.isConfigured()) {
      return {
        available: false,
        provider: 'nvidia',
        model: this.modelIdentifier,
        latencyMs: 0,
        error: 'NVIDIA_API_KEY is not configured in backend environment.',
      };
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);

      const res = await fetch(`${this.baseUrl}/models`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        return {
          available: false,
          provider: 'nvidia',
          model: this.modelIdentifier,
          latencyMs: Date.now() - start,
          error: `NVIDIA endpoint returned HTTP ${res.status}: ${res.statusText}`,
        };
      }

      return {
        available: true,
        provider: 'nvidia',
        model: this.modelIdentifier,
        latencyMs: Date.now() - start,
      };
    } catch (err: any) {
      return {
        available: false,
        provider: 'nvidia',
        model: this.modelIdentifier,
        latencyMs: Date.now() - start,
        error: `Cannot connect to NVIDIA endpoint at ${this.baseUrl}: ${err.message || 'Network error'}`,
      };
    }
  }

  async generate(options: AiGenerateOptions): Promise<AiResponse> {
    const start = Date.now();
    if (!this.isConfigured()) {
      throw new Error('NVIDIA_API_KEY is not configured in backend environment');
    }

    const sanitizedPrompt = redactSensitiveString(options.prompt);
    const lang = options.language || 'English';
    const systemInstruction = options.systemInstruction || buildNaniSystemPrompt(lang);

    const messages = [
      { role: 'system', content: systemInstruction },
      { role: 'user', content: sanitizedPrompt },
    ];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.modelIdentifier,
          messages,
          temperature: 0.3,
          max_tokens: this.maxTokens,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`NVIDIA HTTP ${response.status}: ${errorText || response.statusText}`);
      }

      const data = (await response.json()) as any;
      const replyText = (data?.choices?.[0]?.message?.content || '').trim();

      return {
        reply: replyText,
        provider: 'nvidia',
        modelName: this.modelIdentifier,
        isEmergency: false,
        costMode: 'external_billed',
        pricingNote: 'NVIDIA Nemotron hosted inference API.',
        disclaimer: 'Nani is an AI assistant, not a doctor. This guidance does not replace professional medical evaluation.',
        latencyMs: Date.now() - start,
      };
    } catch (err: any) {
      clearTimeout(timeout);
      throw err;
    }
  }
}


/**
 * 3. Zero-Cost Local Heuristic Offline Triage Engine
 * Always available as the deterministic safety baseline.
 */
export class LocalHeuristicOfflineProvider implements IAiAdapter {
  name: AiProviderType = 'local_fallback';
  modelIdentifier = 'local_heuristic_emergency_rules';

  isConfigured(): boolean {
    return true; // Always available
  }

  async healthCheck(): Promise<ProviderHealthStatus> {
    return {
      available: true,
      provider: 'local_fallback',
      model: this.modelIdentifier,
      latencyMs: 0,
    };
  }

  async generate(options: AiGenerateOptions): Promise<AiResponse> {
    const prompt = (options.prompt || '').trim();
    const lower = prompt.toLowerCase();
    const lang = (options.language || 'Hinglish').toLowerCase();
    const isHindi = lang.includes('hindi') || lang.includes('hi');

    let reply = '';

    if (lower.includes('sos') || lower.includes('emergency button')) {
      reply = isHindi
        ? 'लाइफलिंक एसओएस (SOS) बटन 10 सेकंड की सुरक्षा विंडो के साथ आपातकालीन अलर्ट सक्रिय करता है। यदि इसे 10 सेकंड के भीतर रद्द नहीं किया जाता है, तो यह तुरंत आपके जीपीएस स्थान पर निकटतम उपलब्ध एम्बुलेंस को भेजने की प्रक्रिया शुरू करता है।'
        : 'The LifeLink SOS button initiates an emergency alert with a 10-second safety cancellation window. If not cancelled within 10 seconds, it automatically dispatches the nearest ambulance to your GPS location.';
    } else if (lower.includes('ambulance') || lower.includes('गाड़ी') || lower.includes('एम्बुलेंस')) {
      reply = isHindi
        ? 'लाइफलिंक सत्यापित एम्बुलेंस का समर्थन करता है: बेसिक लाइफ सपोर्ट (BLS), पैरामेडिक और कार्डियक मॉनिटरिंग के साथ एडवांस्ड लाइफ सपोर्ट (ALS), तथा श्वसन सहायता के लिए ऑक्सीजन सपोर्ट।'
        : 'LifeLink coordinates verified ambulances: Basic Life Support (BLS), Advanced Life Support (ALS) with paramedic monitoring, and Oxygen Support for respiratory distress.';
    } else if (lower.includes('bed') || lower.includes('hospital') || lower.includes('बेड') || lower.includes('अस्पताल')) {
      reply = isHindi
        ? 'आप अपने पेशेंट डैशबोर्ड में "Beds & Admissions" टैब के तहत वास्तविक समय में अस्पताल के बेड (जनरल वार्ड, आईसीयू, इमरजेंसी) की उपलब्धता देख सकते हैं और भर्ती का अनुरोध दर्ज कर सकते हैं।'
        : 'You can check real-time hospital bed availability and submit admission requests under the "Beds & Admissions" tab in your Patient Dashboard.';
    } else if (lower.includes('doctor') || lower.includes('appointment') || lower.includes('opd') || lower.includes('डॉक्टर') || lower.includes('अपॉइंटमेंट')) {
      reply = isHindi
        ? 'आप अपॉइंटमेंट टैब में सत्यापित डॉक्टरों की सूची देख सकते हैं, वास्तविक समय के ओपीडी स्लॉट चुन सकते हैं, और क्रमिक टोकन नंबर के साथ अपॉइंटमेंट बुक कर सकते हैं।'
        : 'You can browse verified doctors, view real-time OPD slots, and book appointments with persistent sequential token generation in the Appointments tab.';
    } else if (lower.includes('diagnos') || lower.includes('prescrib') || lower.includes('medicine') || lower.includes('दवा') || lower.includes('इलाज')) {
      reply = isHindi
        ? 'नानी एक आपातकालीन देखभाल समन्वयक है और चिकित्सकीय निदान करने या दवाएं निर्धारित करने के लिए अधिकृत नहीं है। कृपया पेशेवर चिकित्सीय मूल्यांकन के लिए किसी योग्य चिकित्सक से परामर्श लें या ओपीडी अपॉइंटमेंट बुक करें।'
        : 'Nani is an emergency care coordinator and is strictly prohibited from diagnosing medical conditions or prescribing medications. Please consult a licensed doctor or book an OPD consultation.';
    } else if (lower.includes('fever') || lower.includes('cough') || lower.includes('बुखार') || lower.includes('खांसी')) {
      reply = isHindi
        ? 'हल्के बुखार या सर्दी के लिए पर्याप्त पानी पिएं, आराम करें और तापमान पर नज़र रखें। ध्यान दें: नानी कोई दवा नहीं लिखती। यदि बुखार 102°F से अधिक हो या 48 घंटे से ज्यादा रहे, तो कृपया तुरंत डॉक्टर से परामर्श लें।'
        : 'For mild fever or cough, ensure adequate rest and fluid hydration. Please note: Nani does not prescribe medications. If fever persists over 48 hours or exceeds 102°F (38.9°C), please book an OPD doctor consultation.';
    } else if (lower.includes('headache') || lower.includes('सिरदर्द')) {
      reply = isHindi
        ? 'हल्के सिरदर्द के लिए शांत कमरे में विश्राम करें और पानी पिएं। यदि सिरदर्द अचानक और बहुत तीव्र हो, तो तुरंत 112 पर कॉल करें या लाल SOS बटन दबाएं।'
        : 'For mild headaches, rest in a quiet space and hydrate. If the headache is sudden and unusually severe, please press the SOS button or call 112 immediately.';
    } else if (
      lower.includes('medical id') ||
      lower.includes('health id') ||
      lower.includes('qr') ||
      lower.includes('emergency profile') ||
      lower.includes('break-glass') ||
      lower.includes('privacy')
    ) {
      reply = isHindi
        ? 'आपका इमरजेंसी हेल्थ आईडी मरीज-नियंत्रित है और डीपीडीपी अधिनियम 2023 के तहत सुरक्षित है। अधिकृत स्वास्थ्य कर्मी आपात स्थिति में ब्रेक-ग्लास ऑडिट प्रक्रिया द्वारा ही डेटा देख सकते हैं।'
        : 'Your LifeLink Emergency Health ID is patient-controlled and protected under the DPDP Act 2023. Verified responders access full records via audited break-glass emergency protocols.';
    } else if (
      lower.includes('profile') ||
      lower.includes('blood') ||
      lower.includes('allerg') ||
      lower.includes('रक्त') ||
      lower.includes('एलर्जी')
    ) {
      reply = isHindi
        ? 'आप "Emergency Health ID" टैब में अपनी स्वैच्छिक आपातकालीन स्वास्थ्य जानकारी (रक्त समूह, एलर्जी, पुरानी स्थितियां) दर्ज या अद्यतन कर सकते हैं।'
        : 'You can update your voluntary emergency health information (blood group, allergies, conditions, and medications) with provenance tracking in the "Emergency Health ID" tab.';
    } else if (lower.includes('who are you') || lower.includes('nani') || lower.includes('hello') || lower.includes('hi') || lower.includes('नमस्ते')) {
      reply = isHindi
        ? 'नमस्ते! मैं नानी हूँ, आपकी लाइफलिंक स्वास्थ्य सहायक। मैं एम्बुलेंस, अस्पताल के बेड और डॉक्टर अपॉइंटमेंट में आपकी सहायता कर सकती हूँ।'
        : 'Namaste! I am Nani, your LifeLink healthcare assistant. I can help you with ambulance dispatch, hospital beds, and OPD appointments.';
    } else {
      reply = isHindi
        ? 'नमस्ते, मैं नानी हूँ। आप मुझसे लाइफलिंक आपातकालीन सेवाओं, अस्पताल के बेड और एम्बुलेंस के बारे में पूछ सकते हैं।'
        : 'Namaste, I am Nani. I can guide you on LifeLink emergency dispatch, hospital bed availability, and doctor appointments.';
    }

    return {
      reply,
      provider: 'local_fallback',
      modelName: this.modelIdentifier,
      isEmergency: false,
      costMode: 'zero_cost',
      pricingNote: 'Zero-cost offline deterministic rule engine. No external API credentials required.',
      disclaimer: 'Nani is an AI assistant, not a doctor. This guidance does not replace professional medical evaluation.',
      latencyMs: 1,
    };
  }
}

/**
 * AI Provider Registry & Dispatcher
 */
export class AiProviderManager {
  private ollamaAdapter: OllamaAiAdapter;
  private groqAdapter: GroqAiAdapter;
  private nvidiaAdapter: NvidiaAiAdapter;
  private geminiAdapter: GeminiAiAdapter;
  private localFallbackProvider: LocalHeuristicOfflineProvider;

  constructor() {
    this.ollamaAdapter = new OllamaAiAdapter();
    this.groqAdapter = new GroqAiAdapter();
    this.nvidiaAdapter = new NvidiaAiAdapter();
    this.geminiAdapter = new GeminiAiAdapter();
    this.localFallbackProvider = new LocalHeuristicOfflineProvider();
  }

  getProviderMode(): NaniProviderMode {
    return (process.env.NANI_PROVIDER as NaniProviderMode) || 'auto';
  }

  getActiveProviderType(): AiProviderType {
    if (
      process.env.NODE_ENV === 'test' &&
      !process.env.LOCAL_AI_URL &&
      !process.env.GROQ_API_KEY &&
      process.env.NANI_PROVIDER !== 'ollama' &&
      process.env.NANI_PROVIDER !== 'groq'
    ) {
      return 'local_fallback';
    }

    const mode = this.getProviderMode();
    if (mode === 'groq') return 'groq';
    if (mode === 'ollama') return 'ollama';
    if (mode === 'nvidia' && this.nvidiaAdapter.isConfigured()) return 'nvidia';
    if (mode === 'gemini' && this.geminiAdapter.isConfigured()) return 'gemini';
    if (mode === 'local_fallback') return 'local_fallback';

    if (this.groqAdapter.isConfigured() && !this.groqAdapter.isRateLimited()) {
      return 'groq';
    }
    if (this.ollamaAdapter.isConfigured()) {
      return 'ollama';
    }
    return 'local_fallback';
  }

  getActiveModelName(): string {
    const provider = this.getActiveProviderType();
    if (provider === 'groq') return this.groqAdapter.modelIdentifier;
    if (provider === 'ollama') return this.ollamaAdapter.modelIdentifier;
    if (provider === 'nvidia') return this.nvidiaAdapter.modelIdentifier;
    if (provider === 'gemini') return this.geminiAdapter.modelIdentifier;
    return this.localFallbackProvider.modelIdentifier;
  }

  isZeroCost(): boolean {
    const provider = this.getActiveProviderType();
    return provider !== 'groq' && provider !== 'gemini' && provider !== 'nvidia';
  }

  isLiveAiConfigured(): boolean {
    if (
      process.env.NODE_ENV === 'test' &&
      !process.env.LOCAL_AI_URL &&
      !process.env.GROQ_API_KEY &&
      !process.env.NVIDIA_API_KEY &&
      process.env.NANI_PROVIDER !== 'ollama' &&
      process.env.NANI_PROVIDER !== 'groq' &&
      process.env.NANI_PROVIDER !== 'nvidia'
    ) {
      return false;
    }

    const mode = this.getProviderMode();
    if (mode === 'groq') return this.groqAdapter.isConfigured();
    if (mode === 'ollama') return this.ollamaAdapter.isConfigured();
    if (mode === 'nvidia') return this.nvidiaAdapter.isConfigured();
    if (mode === 'gemini') return this.geminiAdapter.isConfigured();
    if (mode === 'local_fallback') return false;
    return this.groqAdapter.isConfigured() || this.ollamaAdapter.isConfigured();
  }

  getOllamaAdapter(): OllamaAiAdapter {
    return this.ollamaAdapter;
  }

  getGroqAdapter(): GroqAiAdapter {
    return this.groqAdapter;
  }

  getNvidiaAdapter(): NvidiaAiAdapter {
    return this.nvidiaAdapter;
  }

  getGeminiAdapter(): GeminiAiAdapter {
    return this.geminiAdapter;
  }

  getLocalFallbackProvider(): LocalHeuristicOfflineProvider {
    return this.localFallbackProvider;
  }

  async healthCheck(): Promise<ProviderHealthStatus> {
    const mode = this.getProviderMode();

    if (mode === 'groq') {
      return await this.groqAdapter.healthCheck();
    }
    if (mode === 'nvidia') {
      return await this.nvidiaAdapter.healthCheck();
    }
    if (mode === 'ollama') {
      const ollamaHealth = await this.ollamaAdapter.healthCheck();
      if (!ollamaHealth.available) {
        return {
          ...ollamaHealth,
          error: `${ollamaHealth.error}. Local deterministic safety fallback is ready.`,
        };
      }
      return ollamaHealth;
    }
    if (mode === 'gemini') {
      return await this.geminiAdapter.healthCheck();
    }
    if (mode === 'local_fallback') {
      return await this.localFallbackProvider.healthCheck();
    }

    // Auto mode: probe Groq (if configured) or Ollama
    if (this.groqAdapter.isConfigured()) {
      const groqHealth = await this.groqAdapter.healthCheck();
      if (groqHealth.available) {
        return groqHealth;
      }
      // If Groq is rate-limited or unavailable, check if Ollama is ready
      const ollamaHealth = await this.ollamaAdapter.healthCheck();
      if (ollamaHealth.available) {
        return {
          available: true,
          provider: 'ollama',
          model: ollamaHealth.model,
          installedModels: ollamaHealth.installedModels,
          latencyMs: ollamaHealth.latencyMs,
          error: `Groq unavailable (${groqHealth.error || 'offline'}). Local Ollama is active.`,
        };
      }
      return {
        available: false,
        provider: 'local_fallback',
        model: this.localFallbackProvider.modelIdentifier,
        error: `Both Groq (${groqHealth.error}) and Ollama (${ollamaHealth.error}) are unavailable. Deterministic safety baseline active.`,
      };
    }

    // Auto mode with no Groq key: use Ollama
    const ollamaHealth = await this.ollamaAdapter.healthCheck();
    if (ollamaHealth.available) {
      return ollamaHealth;
    }

    return {
      available: false,
      provider: 'local_fallback',
      model: this.localFallbackProvider.modelIdentifier,
      error: `${ollamaHealth.error || 'Ollama offline'}. Deterministic safety baseline active.`,
    };
  }

  async generateResponse(options: AiGenerateOptions): Promise<AiResponse> {
    const mode = this.getProviderMode();
    const hasExternalConsent = Boolean(options.allowExternalAi);

    if (
      process.env.NODE_ENV === 'test' &&
      !process.env.LOCAL_AI_URL &&
      !process.env.GROQ_API_KEY &&
      process.env.NANI_PROVIDER !== 'ollama' &&
      process.env.NANI_PROVIDER !== 'groq'
    ) {
      return await this.localFallbackProvider.generate(options);
    }

    // 1. Explicit Ollama mode: Strictly local; NEVER route to Groq or Gemini
    if (mode === 'ollama') {
      try {
        return await this.ollamaAdapter.generate(options);
      } catch (ollamaError: any) {
        console.warn('Ollama provider issue; executing local safety fallback:', ollamaError?.message || ollamaError);
        const fallbackRes = await this.localFallbackProvider.generate(options);
        return {
          ...fallbackRes,
          error: `Ollama unavailable (${ollamaError?.message || 'offline'}). Deterministic safety fallback active.`,
        };
      }
    }

    // 2. Explicit Groq mode
    if (mode === 'groq') {
      // Privacy invariant: Require user consent before transmitting to Groq
      if (!hasExternalConsent) {
        console.warn('Groq mode requested but external AI consent not granted. Checking local fallback.');
        if (this.ollamaAdapter.isConfigured()) {
          try {
            const ollamaRes = await this.ollamaAdapter.generate(options);
            return {
              ...ollamaRes,
              pricingNote: 'Local Ollama active (external AI consent not granted for Groq).',
            };
          } catch {}
        }
        const fallback = await this.localFallbackProvider.generate(options);
        return {
          ...fallback,
          error: 'External AI consent not granted. Conversational AI temporarily unavailable in cloud mode; local offline rules active.',
        };
      }

      if (!this.groqAdapter.isConfigured()) {
        console.warn('Groq mode requested but GROQ_API_KEY is not configured.');
        if (this.ollamaAdapter.isConfigured()) {
          try {
            return await this.ollamaAdapter.generate(options);
          } catch {}
        }
        const fallback = await this.localFallbackProvider.generate(options);
        return {
          ...fallback,
          error: 'GROQ_API_KEY is not configured in backend environment. Local deterministic safety fallback active.',
        };
      }

      try {
        return await this.groqAdapter.generate(options);
      } catch (groqError: any) {
        console.warn('Groq provider error; evaluating fallback:', groqError?.message || groqError);
        // If Groq fails or returns 429, fall back to local Ollama if available
        if (this.ollamaAdapter.isConfigured()) {
          try {
            const ollamaRes = await this.ollamaAdapter.generate(options);
            return {
              ...ollamaRes,
              error: `Groq error (${groqError?.message || 'failed'}). Routed to local Ollama.`,
            };
          } catch {}
        }
        const fallback = await this.localFallbackProvider.generate(options);
        return {
          ...fallback,
          error: `Groq error (${groqError?.message || 'unavailable'}) and local Ollama unavailable. Deterministic safety fallback active.`,
        };
      }
    }

    // 3. Auto mode: Select according to configuration, privacy consent & rate limits
    if (mode === 'auto') {
      // Step A: If external AI consent is granted AND Groq is configured AND not rate-limited -> Try Groq
      if (hasExternalConsent && this.groqAdapter.isConfigured() && !this.groqAdapter.isRateLimited()) {
        try {
          return await this.groqAdapter.generate(options);
        } catch (groqError: any) {
          console.warn('Groq in auto mode failed; falling back to local Ollama:', groqError?.message || groqError);
          // Fall back to local Ollama
          if (this.ollamaAdapter.isConfigured()) {
            try {
              const ollamaRes = await this.ollamaAdapter.generate(options);
              return {
                ...ollamaRes,
                error: `Groq error (${groqError?.message || 'rate-limited/offline'}). Fell back to local Ollama.`,
              };
            } catch {}
          }
          const fallback = await this.localFallbackProvider.generate(options);
          return {
            ...fallback,
            error: `Groq error (${groqError?.message || 'unavailable'}) and local model offline. Local deterministic safety fallback active.`,
          };
        }
      }

      // Step B: External AI consent not granted OR Groq not configured/rate-limited -> Use Local Ollama
      if (this.ollamaAdapter.isConfigured()) {
        try {
          return await this.ollamaAdapter.generate(options);
        } catch (ollamaError: any) {
          console.warn('Ollama in auto mode failed; falling back to deterministic safety:', ollamaError?.message || ollamaError);
          const fallback = await this.localFallbackProvider.generate(options);
          return {
            ...fallback,
            error: `Local Ollama unavailable (${ollamaError?.message || 'offline'}). Local deterministic safety fallback active.`,
          };
        }
      }

      // Step C: Both unavailable -> Local deterministic engine
      return await this.localFallbackProvider.generate(options);
    }

    // 4. NVIDIA mode
    if (mode === 'nvidia' && this.nvidiaAdapter.isConfigured()) {
      if (!hasExternalConsent) {
        const fallback = await this.localFallbackProvider.generate(options);
        return {
          ...fallback,
          error: 'External AI consent not granted for NVIDIA Nemotron cloud model.',
        };
      }
      try {
        return await this.nvidiaAdapter.generate(options);
      } catch (nvidiaError: any) {
        const fallback = await this.localFallbackProvider.generate(options);
        return {
          ...fallback,
          error: `NVIDIA API error (${nvidiaError?.message || 'remote error'}). Deterministic safety fallback active.`,
        };
      }
    }

    // 5. Gemini mode
    if (mode === 'gemini' && this.geminiAdapter.isConfigured()) {
      if (!hasExternalConsent) {
        const fallback = await this.localFallbackProvider.generate(options);
        return {
          ...fallback,
          error: 'External AI consent not granted for cloud model.',
        };
      }
      try {
        return await this.geminiAdapter.generate(options);
      } catch (geminiError: any) {
        const fallback = await this.localFallbackProvider.generate(options);
        return {
          ...fallback,
          error: `Gemini API error (${geminiError?.message || 'remote error'}). Deterministic safety fallback active.`,
        };
      }
    }

    // 5. Default Local Deterministic Engine
    return await this.localFallbackProvider.generate(options);
  }
}

export const aiProviderManager = new AiProviderManager();
export { OllamaAiAdapter as LocalModelAdapter };
