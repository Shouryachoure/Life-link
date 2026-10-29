process.env.NODE_ENV = 'test';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import * as jwt from 'jsonwebtoken';
import app from '../src/app';
import {
  aiProviderManager,
  GroqAiAdapter,
  OllamaAiAdapter,
  LocalHeuristicOfflineProvider,
} from '../src/services/aiProvider';
import { evaluateEmergencySafety } from '../src/services/naniEmergencyGuard';
import { executeNaniTool, NANI_TOOLS } from '../src/services/naniTools';
import { inMemoryDb } from '../src/db';

let server: http.Server;
let baseUrl: string;
const JWT_SECRET = process.env.JWT_SECRET || 'lifelink_jwt_secret_key_2026_super_secure';

test.before(async () => {
  inMemoryDb.seedDefaultDevData();
  await new Promise<void>((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as any;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

test.after(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

function createToken(payload: { id: string; email: string; role: string; name?: string }) {
  return jwt.sign(
    {
      id: payload.id,
      email: payload.email,
      role: payload.role,
      name: payload.name || 'Test User',
    },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

// =============================================================================
// SCENARIO 1 & 6: GROQ CONFIGURATION, MISSING & INVALID API KEY HANDLING
// =============================================================================

test('1.1. Groq adapter handles missing API key gracefully without crash', async () => {
  const unconfiguredGroq = new GroqAiAdapter({ apiKey: '' });
  assert.equal(unconfiguredGroq.isConfigured(), false);
  const health = await unconfiguredGroq.healthCheck();
  assert.equal(health.available, false);
  assert.equal(health.provider, 'groq');
  assert.ok(health.error?.includes('GROQ_API_KEY is not configured'));
});

test('1.2. Groq adapter handles invalid API key (401/403) gracefully during probe', async () => {
  // Spawn a mock HTTP server that returns 401 Unauthorized
  const mockGroq = http.createServer((req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Invalid API Key', type: 'invalid_request_error' } }));
  });

  await new Promise<void>((resolve) => mockGroq.listen(0, '127.0.0.1', () => resolve()));
  const mockPort = (mockGroq.address() as any).port;

  try {
    const groqAdapter = new GroqAiAdapter({
      baseUrl: `http://127.0.0.1:${mockPort}`,
      apiKey: 'gsk_invalid_test_key_123',
    });
    assert.equal(groqAdapter.isConfigured(), true);

    const health = await groqAdapter.healthCheck();
    assert.equal(health.available, false);
    assert.ok(health.error?.includes('Invalid GROQ_API_KEY') || health.error?.includes('401'));
  } finally {
    mockGroq.close();
  }
});

// =============================================================================
// SCENARIO 2: SUCCESSFUL GROQ & OLLAMA RESPONSES
// =============================================================================

test('2.1. Groq adapter parses OpenAI-compatible chat completion and tool calls', async () => {
  const mockGroq = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'chatcmpl-test-123',
        model: 'openai/gpt-oss-20b',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'Namaste! I can assist you with bed capacity and hospital discovery in Nagpur.',
              tool_calls: [
                {
                  id: 'call_search_1',
                  type: 'function',
                  function: {
                    name: 'search_hospitals',
                    arguments: JSON.stringify({ query: 'Nagpur', emergencyOnly: true }),
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      })
    );
  });

  await new Promise<void>((resolve) => mockGroq.listen(0, '127.0.0.1', () => resolve()));
  const mockPort = (mockGroq.address() as any).port;

  try {
    const groqAdapter = new GroqAiAdapter({
      baseUrl: `http://127.0.0.1:${mockPort}`,
      apiKey: 'gsk_valid_mock_key',
    });

    const res = await groqAdapter.generate({
      prompt: 'Which hospitals have emergency casualty in Nagpur?',
      language: 'English',
      tools: NANI_TOOLS,
    });

    assert.equal(res.provider, 'groq');
    assert.ok(res.reply.includes('Namaste!'));
    assert.equal(res.costMode, 'external_billed');
    assert.ok(Array.isArray(res.toolCalls));
    assert.equal(res.toolCalls?.[0].function.name, 'search_hospitals');
    assert.equal(res.toolCalls?.[0].function.arguments.query, 'Nagpur');
  } finally {
    mockGroq.close();
  }
});

test('2.2. Ollama adapter connects to local daemon when online', async () => {
  const ollama = new OllamaAiAdapter();
  const health = await ollama.healthCheck();
  // If local Ollama is active on the machine, verify health and model inspection
  if (health.available) {
    assert.equal(health.provider, 'ollama');
    assert.ok(health.model);
    assert.ok(Array.isArray(health.installedModels));
  } else {
    assert.ok(health.error);
  }
});

// =============================================================================
// SCENARIO 3: GROQ UNAVAILABLE -> ELIGIBLE LOCAL FALLBACK SUCCEEDS
// =============================================================================

test('3.1. Auto mode routes to local fallback when Groq endpoint is unreachable', async () => {
  const originalProvider = process.env.NANI_PROVIDER;
  const originalGroqBase = process.env.GROQ_BASE_URL;
  const originalGroqKey = process.env.GROQ_API_KEY;

  try {
    process.env.NANI_PROVIDER = 'auto';
    process.env.GROQ_BASE_URL = 'http://127.0.0.1:59999'; // Dead port
    process.env.GROQ_API_KEY = 'gsk_test_key';
    aiProviderManager.getGroqAdapter().timeoutMs = 1500; // fast test timeout

    const res = await fetch(`${baseUrl}/api/v1/chatbot/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Where can I find hospital beds in Nagpur?',
        language: 'English',
        allowExternalAi: true, // consent granted
      }),
    });

    assert.equal(res.status, 200);
    const data = (await res.json()) as any;
    assert.equal(data.isEmergency, false);
    // Should fall back to local Ollama (if running) or local_fallback safely without throwing 500
    assert.ok(data.provider === 'ollama' || data.provider === 'local_fallback');
    assert.ok(data.reply);
  } finally {
    process.env.NANI_PROVIDER = originalProvider;
    process.env.GROQ_BASE_URL = originalGroqBase;
    process.env.GROQ_API_KEY = originalGroqKey;
    aiProviderManager.getGroqAdapter().timeoutMs = 12000;
  }
});

// =============================================================================
// SCENARIO 4: BOTH PROVIDERS UNAVAILABLE -> DETERMINISTIC SAFETY FALLBACK
// =============================================================================

test('4.1. Graceful deterministic offline response when all AI daemons are offline', async () => {
  const offlineProvider = new LocalHeuristicOfflineProvider();
  assert.equal(offlineProvider.isConfigured(), true);

  const res = await offlineProvider.generate({
    prompt: 'How do I check hospital bed capacity?',
    language: 'English',
  });

  assert.equal(res.provider, 'local_fallback');
  assert.equal(res.costMode, 'zero_cost');
  assert.ok(res.reply.includes('Beds & Admissions'));
});

// =============================================================================
// SCENARIO 5: GROQ RETURNS HTTP 429 RATE LIMIT & RETRY-AFTER HANDLING
// =============================================================================

test('5.1. Groq HTTP 429 parses Retry-After, enforces cooldown and prevents retry storms', async () => {
  let callCount = 0;
  const mockGroq = http.createServer((req, res) => {
    callCount++;
    res.writeHead(429, {
      'Content-Type': 'application/json',
      'Retry-After': '45',
    });
    res.end(
      JSON.stringify({
        error: {
          message: 'Rate limit exceeded: tokens per minute (TPM) limit reached.',
          type: 'tokens_exceeded',
        },
      })
    );
  });

  await new Promise<void>((resolve) => mockGroq.listen(0, '127.0.0.1', () => resolve()));
  const mockPort = (mockGroq.address() as any).port;

  try {
    const groqAdapter = new GroqAiAdapter({
      baseUrl: `http://127.0.0.1:${mockPort}`,
      apiKey: 'gsk_test_key_ratelimit',
    });

    // 1. Initial call triggers 429
    let caughtError: any = null;
    try {
      await groqAdapter.generate({
        prompt: 'Hello Nani',
        language: 'English',
      });
    } catch (e: any) {
      caughtError = e;
    }

    assert.ok(caughtError);
    assert.equal(caughtError.status, 429);
    assert.equal(caughtError.retryAfter, 45);
    assert.equal(groqAdapter.isRateLimited(), true);
    assert.ok(groqAdapter.getCooldownRemainingSec() >= 40);

    // 2. Subsequent call fails fast locally without making a network request (prevents retry storm)
    const initialCallCount = callCount;
    let stormBlockedError: any = null;
    try {
      await groqAdapter.generate({
        prompt: 'Hello Nani again',
        language: 'English',
      });
    } catch (e: any) {
      stormBlockedError = e;
    }

    assert.ok(stormBlockedError);
    assert.ok(stormBlockedError.message.includes('Groq rate limit cooldown active'));
    assert.equal(callCount, initialCallCount); // Network request was NOT made!
  } finally {
    mockGroq.close();
  }
});

// =============================================================================
// SCENARIO 7: EXTERNAL AI CONSENT IS ABSENT -> REMAINS STRICTLY LOCAL
// =============================================================================

test('7.1. Groq is bypassed when allowExternalAi is false, preserving local privacy', async () => {
  let groqHitCount = 0;
  const mockGroq = http.createServer((req, res) => {
    groqHitCount++;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: 'From Groq' } }] }));
  });

  await new Promise<void>((resolve) => mockGroq.listen(0, '127.0.0.1', () => resolve()));
  const mockPort = (mockGroq.address() as any).port;

  const originalProvider = process.env.NANI_PROVIDER;
  const originalGroqBase = process.env.GROQ_BASE_URL;
  const originalGroqKey = process.env.GROQ_API_KEY;

  try {
    process.env.NANI_PROVIDER = 'groq'; // Explicit Groq mode requested
    process.env.GROQ_BASE_URL = `http://127.0.0.1:${mockPort}`;
    process.env.GROQ_API_KEY = 'gsk_test_key_consent';

    // User sends query WITHOUT consent: allowExternalAi = false
    const res = await fetch(`${baseUrl}/api/v1/chatbot/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Tell me about LifeLink emergency services',
        language: 'English',
        allowExternalAi: false, // NO EXTERNAL AI CONSENT
      }),
    });

    assert.equal(res.status, 200);
    const data = (await res.json()) as any;
    // Invariant: Groq server was NEVER contacted!
    assert.equal(groqHitCount, 0);
    assert.notEqual(data.provider, 'groq');
  } finally {
    mockGroq.close();
    process.env.NANI_PROVIDER = originalProvider;
    process.env.GROQ_BASE_URL = originalGroqBase;
    process.env.GROQ_API_KEY = originalGroqKey;
  }
});

// =============================================================================
// SCENARIO 8: MEDICAL EMERGENCY DETECTED WHILE BOTH MODELS ARE OFFLINE
// =============================================================================

test('8.1. Acute cardiac emergency intercepts immediately with 0ms delay even if all models are down', async () => {
  const originalProvider = process.env.NANI_PROVIDER;
  try {
    process.env.NANI_PROVIDER = 'local_fallback'; // Simulate models offline

    const res = await fetch(`${baseUrl}/api/v1/chatbot/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Bohot tez seene me dard ho raha hai saans nahi aa rahi',
        language: 'Hinglish',
      }),
    });

    assert.equal(res.status, 200);
    const data = (await res.json()) as any;
    assert.equal(data.isEmergency, true);
    assert.equal(data.requiresUrgentGuidance, true);
    assert.equal(data.safetyLevel, 'CRITICAL_EMERGENCY');
    assert.equal(data.emergencyContact, '112');
    assert.ok(data.emergencyGuidance.nationalEmergency === '112');
    assert.ok(data.emergencyGuidance.ambulanceMedicalService === '108');
  } finally {
    process.env.NANI_PROVIDER = originalProvider;
  }
});

// =============================================================================
// SCENARIO 9: UNAUTHORIZED TOOL CALL IS REJECTED
// =============================================================================

test('9.1. Backend tool gatekeeper strictly rejects unpermitted tool proposals', async () => {
  const maliciousProposal = 'execute_arbitrary_shell_command';
  const execResult = await executeNaniTool(maliciousProposal, { command: 'rm -rf /' }, null);

  assert.equal(execResult.success, false);
  assert.ok(execResult.error?.includes('allowlist'));
});

// =============================================================================
// SCENARIO 10: UNCONFIRMED DISPATCH OR BOOKING CANNOT BE CLAIMED
// =============================================================================

test('10.1. Ambulance dispatch requires human confirmation and never creates premature dispatch ID', async () => {
  const toolExec = await executeNaniTool(
    'request_ambulance_dispatch',
    { pickupAddress: 'Dharampeth, Nagpur', emergencySeverity: 'CRITICAL' },
    { id: 'usr_patient_test_01', role: 'PATIENT' }
  );

  // Invariant: Tool MUST NOT execute mutation; it must return requiresUserConfirmation: true
  assert.equal(toolExec.requiresUserConfirmation, true);
  assert.equal(toolExec.success, true);
  assert.equal(toolExec.confirmationDetails?.action, 'CONFIRM_EMERGENCY_DISPATCH');
  assert.equal(Boolean(toolExec.data?.dispatchId), false);
});

// =============================================================================
// SCENARIO 11: STATUS & CONFIG ENDPOINTS WITH DUAL-PROVIDER METADATA
// =============================================================================

test('11.1. /status endpoint truthfully exposes providerMode and dual-provider health', async () => {
  const res = await fetch(`${baseUrl}/api/v1/chatbot/status`);
  assert.equal(res.status, 200);
  const data = (await res.json()) as any;
  assert.equal(data.status, 'success');
  assert.ok(data.data.providerMode);
  assert.ok(data.data.activeProvider);
  assert.equal(typeof data.data.groqConfigured, 'boolean');
  assert.equal(typeof data.data.ollamaConfigured, 'boolean');
  assert.ok(Array.isArray(data.data.toolsEnabled));
});

test('11.2. /config endpoint returns externalAiPolicy and zeroCost status', async () => {
  const res = await fetch(`${baseUrl}/api/v1/chatbot/config`);
  assert.equal(res.status, 200);
  const data = (await res.json()) as any;
  assert.equal(data.status, 'success');
  assert.ok(data.data.privacyPolicy.externalAiPolicy);
  assert.equal(data.data.emergencyNumber, '112');
  assert.equal(data.data.nationalAmbulanceNumber, '108');
});

test('11.3. /message enforces 1500 character limit', async () => {
  const oversizedText = 'A'.repeat(1501);
  const res = await fetch(`${baseUrl}/api/v1/chatbot/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: oversizedText }),
  });
  assert.equal(res.status, 400);
  const data = (await res.json()) as any;
  assert.equal(data.code, 'MESSAGE_TOO_LONG');
});
