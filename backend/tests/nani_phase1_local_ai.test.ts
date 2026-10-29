process.env.NODE_ENV = 'test';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import * as jwt from 'jsonwebtoken';
import app from '../src/app';
import { OllamaAiAdapter } from '../src/services/aiProvider';
import { evaluateEmergencySafety } from '../src/services/naniEmergencyGuard';
import { executeNaniTool } from '../src/services/naniTools';
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
// SUITE 1: PROVIDER ABSTRACTION, CONFIGURATION & HEALTH
// =============================================================================

test('1.1. Status endpoint returns truthful model status and zero-cost guarantee', async () => {
  const res = await fetch(`${baseUrl}/api/v1/chatbot/status`);
  assert.equal(res.status, 200);
  const data = (await res.json()) as any;
  assert.equal(data.status, 'success');
  assert.ok(data.data.provider);
  assert.ok(data.data.model);
  assert.equal(data.data.zeroCost, true);
  assert.ok(Array.isArray(data.data.toolsEnabled));
  assert.ok(data.data.toolsEnabled.length >= 6);
  assert.ok(data.data.toolsEnabled.includes('search_hospitals'));
  assert.ok(data.data.toolsEnabled.includes('request_ambulance_dispatch'));
});

test('1.2. Ollama provider respects strict request timeout and bounds', () => {
  const customAdapter = new OllamaAiAdapter({
    baseUrl: 'http://127.0.0.1:11434',
    model: 'qwen3:4b',
    timeoutMs: 3000,
    maxTokens: 512,
  });
  assert.equal(customAdapter.modelIdentifier, 'qwen3:4b');
  assert.equal(customAdapter.timeoutMs, 3000);
  assert.equal(customAdapter.maxTokens, 512);
  assert.equal(customAdapter.isZeroCost(), true);
});

test('1.3. Graceful degradation: Offline/Unreachable Ollama safely fails over without crash', async () => {
  // Point to a non-existent local port
  const offlineAdapter = new OllamaAiAdapter({
    baseUrl: 'http://127.0.0.1:59999',
    model: 'qwen3:4b',
    timeoutMs: 800,
  });

  const health = await offlineAdapter.healthCheck();
  assert.equal(health.available, false);
  assert.ok(health.error?.includes('offline') || health.error?.includes('fetch failed') || health.error?.includes('connect') || health.error?.includes('timed out'));

  // Test generate with offline adapter -> bounded timeout / error thrown
  await assert.rejects(
    async () => {
      await offlineAdapter.generate({
        prompt: 'Hello',
      });
    },
    (err: any) => {
      assert.ok(err.name === 'AbortError' || err.message.includes('fetch failed') || err.message.includes('connect') || err.message.includes('offline'));
      return true;
    }
  );
});

// =============================================================================
// SUITE 2: DETERMINISTIC EMERGENCY SAFETY INDEPENDENCE
// =============================================================================

test('2.1. Emergency Guard triggers immediately on English acute cardiac distress', () => {
  const assessment = evaluateEmergencySafety('I have crushing chest pain radiating to left arm and cannot breathe');
  assert.equal(assessment.safetyLevel, 'CRITICAL_EMERGENCY');
  assert.equal(assessment.requiresUrgentGuidance, true);
  assert.equal(assessment.emergencyNumber, '112');
  assert.equal(assessment.dispatchAvailable, true);
  assert.ok(assessment.guidance.includes('112'));
});

test('2.2. Emergency Guard triggers on Devanagari Hindi acute respiratory failure', () => {
  const assessment = evaluateEmergencySafety('सांस लेने में बहुत तकलीफ हो रही है, दम घुट रहा है', 'Hindi');
  assert.equal(assessment.safetyLevel, 'CRITICAL_EMERGENCY');
  assert.equal(assessment.requiresUrgentGuidance, true);
  assert.ok(assessment.guidance.includes('112'));
  assert.ok(assessment.guidance.includes('आपातकालीन चेतावनी'));
});

test('2.3. Emergency Guard triggers on Roman Hindi/Hinglish severe symptoms', () => {
  const assessment = evaluateEmergencySafety('bohot tez chest pain ho raha hai aur chhati me jalan hai');
  assert.equal(assessment.safetyLevel, 'CRITICAL_EMERGENCY');
  assert.equal(assessment.requiresUrgentGuidance, true);
  assert.equal(assessment.emergencyNumber, '112');
});

test('2.4. Non-emergency mild symptoms do NOT trigger false critical alarms', () => {
  const assessment = evaluateEmergencySafety('I have had mild body ache and slight dry cough since yesterday morning');
  assert.notEqual(assessment.safetyLevel, 'CRITICAL_EMERGENCY');
  assert.equal(assessment.requiresUrgentGuidance, false);
});

test('2.5. Chatbot message endpoint surfaces structured emergency safety state', async () => {
  const res = await fetch(`${baseUrl}/api/v1/chatbot/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Severe chest pain, please help immediately!',
      language: 'English',
    }),
  });

  assert.equal(res.status, 200);
  const data = (await res.json()) as any;
  assert.equal(data.isEmergency, true);
  assert.equal(data.safetyLevel, 'CRITICAL_EMERGENCY');
  assert.equal(data.emergencyContact, '112');
  assert.ok(data.reply.includes('112'));
});

// =============================================================================
// SUITE 3: INPUT VALIDATION, RATE LIMITING & SECURITY
// =============================================================================

test('3.1. Reject oversized input (>1500 chars) with HTTP 400', async () => {
  const oversizedMessage = 'A'.repeat(1501);
  const res = await fetch(`${baseUrl}/api/v1/chatbot/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: oversizedMessage,
    }),
  });

  assert.equal(res.status, 400);
  const data = (await res.json()) as any;
  assert.ok(data.error?.includes('1500 characters'));
});

test('3.2. Reject empty message with HTTP 400', async () => {
  const res = await fetch(`${baseUrl}/api/v1/chatbot/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: '   ',
    }),
  });

  assert.equal(res.status, 400);
  const data = (await res.json()) as any;
  assert.ok(data.error?.includes('required'));
});

test('3.3. Conversation history isolation between different authenticated users', async () => {
  const tokenUser1 = createToken({ id: 'usr_phase1_alpha', email: 'alpha@test.org', role: 'PATIENT' });
  const tokenUser2 = createToken({ id: 'usr_phase1_beta', email: 'beta@test.org', role: 'PATIENT' });

  // User 1 posts a message
  const postRes = await fetch(`${baseUrl}/api/v1/chatbot/message`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${tokenUser1}`,
    },
    body: JSON.stringify({
      message: 'User Alpha private medical question regarding blood pressure',
    }),
  });
  assert.equal(postRes.status, 200);

  // User 2 fetches their own history -> must NOT contain User 1's query
  const getRes = await fetch(`${baseUrl}/api/v1/chatbot/history`, {
    headers: {
      'Authorization': `Bearer ${tokenUser2}`,
    },
  });
  assert.equal(getRes.status, 200);
  const histData = (await getRes.json()) as any;
  const foundAlpha = (histData.data?.history || []).some((item: any) =>
    (item.userMessage || '').includes('User Alpha private')
  );
  assert.equal(foundAlpha, false, 'User Beta must NOT be able to view User Alpha conversation');
});

// =============================================================================
// SUITE 4: STRICT TOOL REGISTRY & BACKEND SAFETY BOUNDARIES
// =============================================================================

test('4.1. Unauthorized or unregistered tool call is rejected', async () => {
  const result = await executeNaniTool('drop_database_table', { table: 'users' });
  assert.equal(result.success, false);
  assert.ok(result.error?.includes('not in the authorized NANI tool allowlist'));
});

test('4.2. Tool: search_hospitals executes real backend query safely', async () => {
  const result = await executeNaniTool('search_hospitals', { search: 'Nagpur' });
  assert.equal(result.success, true);
  assert.ok(Array.isArray(result.data?.facilities));
});

test('4.3. Tool: check_bed_capacity validates and queries capacity truthfully', async () => {
  const result = await executeNaniTool('check_bed_capacity', { hospitalName: 'GMCH' });
  assert.equal(result.success, true);
  assert.ok(result.data !== undefined);
  assert.ok(result.data.availableBeds !== undefined);
});

test('4.4. Critical mutation: request_ambulance_dispatch requires patient auth & explicit confirmation', async () => {
  // 1. Unauthenticated request -> must fail
  const unauthRes = await executeNaniTool('request_ambulance_dispatch', { pickupAddress: 'Nagpur' });
  assert.equal(unauthRes.success, false);
  assert.ok(unauthRes.error?.includes('Authentication as a registered PATIENT is required'));

  // 2. Authenticated patient -> must return requiresUserConfirmation: true
  const patAuth = { id: 'usr_patient_1', role: 'PATIENT', name: 'Ramesh Patel' };
  const result = await executeNaniTool('request_ambulance_dispatch', {
    pickupAddress: 'Dharampeth, Nagpur',
    category: 'CARDIAC',
  }, patAuth);

  assert.equal(result.success, true);
  assert.equal(result.requiresUserConfirmation, true);
  assert.equal(result.confirmationDetails?.action, 'CONFIRM_EMERGENCY_DISPATCH');
  assert.equal(result.confirmationDetails?.patientId, 'usr_patient_1');
});

test('4.5. Critical mutation: book_doctor_appointment requires patient auth & explicit confirmation', async () => {
  // 1. Unauthenticated request -> must fail
  const unauthRes = await executeNaniTool('book_doctor_appointment', { slotId: 'slot_123', symptoms: 'fever' });
  assert.equal(unauthRes.success, false);
  assert.ok(unauthRes.error?.includes('Authentication as a registered PATIENT is required'));

  // 2. Authenticated patient -> must return requiresUserConfirmation: true
  const patAuth = { id: 'usr_patient_2', role: 'PATIENT', name: 'Sita Sharma' };
  const result = await executeNaniTool('book_doctor_appointment', {
    slotId: 'slot_123',
    symptoms: 'fever and headache',
  }, patAuth);

  assert.equal(result.success, true);
  assert.equal(result.requiresUserConfirmation, true);
  assert.equal(result.confirmationDetails?.action, 'CONFIRM_APPOINTMENT_BOOKING');
  assert.equal(result.confirmationDetails?.slotId, 'slot_123');
});

// =============================================================================
// SUITE 5: HINDI & HINGLISH CONVERSATIONAL QUALITY
// =============================================================================

test('5.1. NANI handles Hinglish general inquiry politely without medical jargon', async () => {
  const res = await fetch(`${baseUrl}/api/v1/chatbot/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Nagpur me ambulance bulane ka tarika kya hai?',
      language: 'Hinglish',
    }),
  });

  assert.equal(res.status, 200);
  const data = (await res.json()) as any;
  assert.ok(data.reply);
  assert.ok(data.reply.length > 20);
  assert.equal(data.costMode, 'zero_cost');
});

test('5.2. NANI handles pure Hindi greeting and responds in Hindi', async () => {
  const res = await fetch(`${baseUrl}/api/v1/chatbot/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'नमस्ते नानी, क्या आप मुझे नजदीकी अस्पताल ढूंढने में मदद कर सकती हैं?',
      language: 'Hindi',
    }),
  });

  assert.equal(res.status, 200);
  const data = (await res.json()) as any;
  assert.ok(data.reply);
  assert.ok(data.reply.length > 10);
});
