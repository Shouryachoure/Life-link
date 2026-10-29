/**
 * LifeLink NANI - Multi-Model Intelligence Engine
 * Model Registry & Capability Specification
 * 
 * Tracks provider availability, task capabilities, privacy classification,
 * context limits, cost modes, and empirical latency/error telemetry.
 */

export type NaniTaskCategory =
  | 'GENERAL_CONVERSATION'
  | 'HINGLISH_INTENT'
  | 'HOSPITAL_DIRECTORY'
  | 'APPOINTMENT_ASSISTANCE'
  | 'EMERGENCY_ASSISTANCE'
  | 'TOOL_CALL_ARGUMENT_GEN'
  | 'AUTHORIZED_SUMMARIZATION'
  | 'HEALTHCARE_KNOWLEDGE_RETRIEVAL'
  | 'RESPONSE_REVIEW';

export type ModelPrivacyClassification = 'local_private' | 'hosted_cloud_external';
export type ModelCostMode = 'zero_cost' | 'metered_api';
export type RegisteredProvider = 'ollama' | 'groq' | 'nvidia' | 'gemini' | 'local_fallback';

export interface ModelRegistryEntry {
  id: string; // e.g. "ollama/qwen3:4b"
  provider: RegisteredProvider;
  modelIdentifier: string; // e.g. "qwen3:4b"
  displayName: string;
  taskCapabilities: NaniTaskCategory[];
  supportedLanguages: string[]; // e.g. ["en", "hi", "hi-Latn"]
  modalities: ('text' | 'audio')[];
  contextLimit: number;
  outputLimit: number;
  privacyClassification: ModelPrivacyClassification;
  costMode: ModelCostMode;
  toolCallingSupported: boolean;
  fallbackEligible: boolean;
  isAvailable: boolean;
  requiresExternalConsent: boolean;
  measuredLatencyMs?: number;
  failureRate?: number;
  healthError?: string;
  lastHealthCheck?: string;
  metadata?: Record<string, any>;
}

export class NaniModelRegistry {
  private entries: Map<string, ModelRegistryEntry> = new Map();

  constructor() {
    this.registerDefaults();
  }

  private registerDefaults(): void {
    // 1. Ollama Primary: qwen3:4b (Local CPU Inference, ₹0)
    const localModel = process.env.NANI_LOCAL_MODEL || process.env.NANI_MODEL || 'qwen3:4b';
    this.register({
      id: `ollama/${localModel}`,
      provider: 'ollama',
      modelIdentifier: localModel,
      displayName: `Ollama ${localModel} (Local CPU ₹0)`,
      taskCapabilities: [
        'GENERAL_CONVERSATION',
        'HINGLISH_INTENT',
        'HOSPITAL_DIRECTORY',
        'APPOINTMENT_ASSISTANCE',
        'TOOL_CALL_ARGUMENT_GEN',
        'HEALTHCARE_KNOWLEDGE_RETRIEVAL',
      ],
      supportedLanguages: ['en', 'hi', 'hi-Latn'],
      modalities: ['text'],
      contextLimit: 4096,
      outputLimit: 380,
      privacyClassification: 'local_private',
      costMode: 'zero_cost',
      toolCallingSupported: true,
      fallbackEligible: true,
      isAvailable: false,
      requiresExternalConsent: false,
      measuredLatencyMs: 12380,
      failureRate: 0.0,
    });

    // 2. Ollama Secondary: qwen3:8b (Optional comparison / higher reasoning)
    this.register({
      id: 'ollama/qwen3:8b',
      provider: 'ollama',
      modelIdentifier: 'qwen3:8b',
      displayName: 'Ollama qwen3:8b (Local High-Capacity CPU)',
      taskCapabilities: [
        'GENERAL_CONVERSATION',
        'HINGLISH_INTENT',
        'HOSPITAL_DIRECTORY',
        'APPOINTMENT_ASSISTANCE',
        'TOOL_CALL_ARGUMENT_GEN',
        'AUTHORIZED_SUMMARIZATION',
        'RESPONSE_REVIEW',
      ],
      supportedLanguages: ['en', 'hi', 'hi-Latn'],
      modalities: ['text'],
      contextLimit: 8192,
      outputLimit: 512,
      privacyClassification: 'local_private',
      costMode: 'zero_cost',
      toolCallingSupported: true,
      fallbackEligible: true,
      isAvailable: false,
      requiresExternalConsent: false,
      measuredLatencyMs: 26000,
      failureRate: 0.0,
    });

    // 3. Groq Fast OSS: openai/gpt-oss-20b
    const groqModel1 = process.env.NANI_GROQ_MODEL || 'openai/gpt-oss-20b';
    this.register({
      id: `groq/${groqModel1}`,
      provider: 'groq',
      modelIdentifier: groqModel1,
      displayName: `Groq ${groqModel1} (Hosted LPU)`,
      taskCapabilities: [
        'GENERAL_CONVERSATION',
        'HINGLISH_INTENT',
        'HOSPITAL_DIRECTORY',
        'APPOINTMENT_ASSISTANCE',
        'TOOL_CALL_ARGUMENT_GEN',
        'HEALTHCARE_KNOWLEDGE_RETRIEVAL',
      ],
      supportedLanguages: ['en', 'hi', 'hi-Latn'],
      modalities: ['text'],
      contextLimit: 8192,
      outputLimit: 512,
      privacyClassification: 'hosted_cloud_external',
      costMode: 'metered_api',
      toolCallingSupported: true,
      fallbackEligible: true,
      isAvailable: false,
      requiresExternalConsent: true,
      measuredLatencyMs: 650,
      failureRate: 0.0,
    });

    // 4. Groq High Precision: llama-3.3-70b-versatile
    this.register({
      id: 'groq/llama-3.3-70b-versatile',
      provider: 'groq',
      modelIdentifier: 'llama-3.3-70b-versatile',
      displayName: 'Groq Llama-3.3-70b-Versatile (Complex Reasoning LPU)',
      taskCapabilities: [
        'GENERAL_CONVERSATION',
        'HINGLISH_INTENT',
        'HOSPITAL_DIRECTORY',
        'APPOINTMENT_ASSISTANCE',
        'TOOL_CALL_ARGUMENT_GEN',
        'AUTHORIZED_SUMMARIZATION',
        'HEALTHCARE_KNOWLEDGE_RETRIEVAL',
        'RESPONSE_REVIEW',
      ],
      supportedLanguages: ['en', 'hi', 'hi-Latn'],
      modalities: ['text'],
      contextLimit: 32768,
      outputLimit: 1024,
      privacyClassification: 'hosted_cloud_external',
      costMode: 'metered_api',
      toolCallingSupported: true,
      fallbackEligible: true,
      isAvailable: false,
      requiresExternalConsent: true,
      measuredLatencyMs: 850,
      failureRate: 0.0,
    });

    // 5. NVIDIA Nemotron Model (Selectively evaluated when configured)
    const nvidiaModel = process.env.NANI_NVIDIA_MODEL || 'nvidia/nemotron-3.5-bolt-e4b';
    this.register({
      id: `nvidia/${nvidiaModel}`,
      provider: 'nvidia',
      modelIdentifier: nvidiaModel,
      displayName: `NVIDIA Nemotron (${nvidiaModel})`,
      taskCapabilities: [
        'GENERAL_CONVERSATION',
        'TOOL_CALL_ARGUMENT_GEN',
        'AUTHORIZED_SUMMARIZATION',
        'RESPONSE_REVIEW',
      ],
      supportedLanguages: ['en'],
      modalities: ['text'],
      contextLimit: 4096,
      outputLimit: 512,
      privacyClassification: 'hosted_cloud_external',
      costMode: 'metered_api',
      toolCallingSupported: true,
      fallbackEligible: false,
      isAvailable: false,
      requiresExternalConsent: true,
      measuredLatencyMs: 1200,
      failureRate: 0.0,
    });

    // 6. Local Heuristic Offline Provider (Deterministic ₹0 100% Uptime Baseline)
    this.register({
      id: 'local/heuristic_engine',
      provider: 'local_fallback',
      modelIdentifier: 'local_heuristic_emergency_rules',
      displayName: 'LifeLink Deterministic Local Guide (₹0 Offline)',
      taskCapabilities: [
        'EMERGENCY_ASSISTANCE',
        'GENERAL_CONVERSATION',
        'HOSPITAL_DIRECTORY',
      ],
      supportedLanguages: ['en', 'hi', 'hi-Latn'],
      modalities: ['text'],
      contextLimit: 1500,
      outputLimit: 300,
      privacyClassification: 'local_private',
      costMode: 'zero_cost',
      toolCallingSupported: false,
      fallbackEligible: true,
      isAvailable: true, // Always available
      requiresExternalConsent: false,
      measuredLatencyMs: 1,
      failureRate: 0.0,
    });
  }

  public register(entry: ModelRegistryEntry): void {
    this.entries.set(entry.id, entry);
  }

  public get(id: string): ModelRegistryEntry | undefined {
    return this.entries.get(id);
  }

  public getAll(): ModelRegistryEntry[] {
    return Array.from(this.entries.values());
  }

  public getAvailable(): ModelRegistryEntry[] {
    return this.getAll().filter((e) => e.isAvailable);
  }

  public getByProvider(provider: RegisteredProvider): ModelRegistryEntry[] {
    return this.getAll().filter((e) => e.provider === provider);
  }

  public getByTask(task: NaniTaskCategory): ModelRegistryEntry[] {
    return this.getAll().filter((e) => e.taskCapabilities.includes(task));
  }

  public updateHealth(
    id: string,
    isAvailable: boolean,
    latencyMs?: number,
    error?: string
  ): void {
    const entry = this.entries.get(id);
    if (!entry) return;

    entry.isAvailable = isAvailable;
    entry.lastHealthCheck = new Date().toISOString();
    if (latencyMs !== undefined) entry.measuredLatencyMs = latencyMs;
    if (error !== undefined) entry.healthError = error;
    if (!isAvailable) {
      entry.failureRate = Math.min(1.0, (entry.failureRate || 0) + 0.1);
    } else {
      entry.failureRate = Math.max(0.0, (entry.failureRate || 0) - 0.05);
    }
  }
}

export const modelRegistry = new NaniModelRegistry();
