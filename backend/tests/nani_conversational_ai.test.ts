process.env.NODE_ENV = 'test';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import * as jwt from 'jsonwebtoken';
import app from '../src/app';
import { redactSensitiveString } from '../src/utils/privacyRedactor';
import { aiProviderManager, LocalHeuristicOfflineProvider, LocalModelAdapter } from '../src/services/aiProvider';

let server: http.Server;
let baseUrl: string;
const JWT_SECRET = process.env.JWT_SECRET || 'lifelink_jwt_secret_key_2026_super_secure';

test.before(async () => {
  await new Promise<void>((resolve) => {
    server = http.createServer(app);
    // Listen on ephemeral port 0
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
// MODULE 1: CONVERSATIONAL EXPERIENCE & MULTILINGUAL RESPONSES
// =============================================================================

test('1.1. Nani responds to English inquiry with clear, focused guidance', async () => {
  const sessionId = `test_session_${Date.now()}_1`;
  const res = await fetch(`${baseUrl}/api/v1/chatbot/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'How does the LifeLink SOS button work?',
      language: 'English',
      sessionId,
    }),
  });

  assert.equal(res.status, 200, 'Endpoint should return HTTP 200');
  const body = (await res.json()) as any;
  assert.ok(body.reply && typeof body.reply === 'string', 'Reply must be populated string');
  assert.ok(
    body.reply.toLowerCase().includes('10-second') || body.reply.toLowerCase().includes('sos'),
    'Should explain the 10-second cancellation safety window'
  );
  assert.equal(body.sessionId, sessionId);
});

test('1.2. Nani responds to Hindi greeting and questions in Hindi', async () => {
  const sessionId = `test_session_${Date.now()}_2`;
  const res = await fetch(`${baseUrl}/api/v1/chatbot/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'नमस्ते, आप कौन हैं?',
      language: 'Hindi',
      sessionId,
    }),
  });

  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.ok(
    body.reply.includes('नमस्ते') || body.reply.includes('नानी'),
    'Reply should contain fluent Hindi greeting'
  );
});

test('1.3. Empty message payload triggers 400 validation error', async () => {
  const res = await fetch(`${baseUrl}/api/v1/chatbot/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: '   ',
      language: 'English',
    }),
  });

  assert.equal(res.status, 400, 'Empty message must return 400 Bad Request');
  const body = (await res.json()) as any;
  assert.ok(body.error, 'Must provide validation error description');
});

// =============================================================================
// MODULE 2: ZERO-COST ARCHITECTURE & TRANSPARENT PROVIDER REPORTING
// =============================================================================

test('2.1. System config explicitly marks zero-cost mode, pricing notes, and local fallback when no API key configured', async () => {
  const res = await fetch(`${baseUrl}/api/v1/chatbot/config`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.equal(body.status, 'success');
  assert.equal(body.data.emergencyNumber, '112');
  assert.equal(body.data.nationalAmbulanceNumber, '108');
  assert.ok(body.data.pricingNotes, 'Must disclose pricing / zero-cost notes');

  if (!process.env.GEMINI_API_KEY) {
    assert.equal(body.data.provider, 'local_fallback', 'Must honestly report local_fallback');
    assert.equal(body.data.zeroCostMode, true, 'Zero cost mode must be true when no external API key');
    assert.equal(body.data.isLiveAiConfigured, false, 'External generative AI must be flagged as unconfigured');
  }
});

test('2.2. Zero-cost local triage answers ambulance queries with verified types (BLS/ALS/Oxygen)', async () => {
  const res = await fetch(`${baseUrl}/api/v1/chatbot/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'What ambulance vehicle types are supported on LifeLink?',
      language: 'English',
    }),
  });

  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.ok(
    body.reply.includes('Basic Life Support') || body.reply.includes('BLS'),
    'Must explain Basic Life Support'
  );
  assert.ok(
    body.reply.includes('Advanced Life Support') || body.reply.includes('ALS'),
    'Must explain Advanced Life Support'
  );
  if (!process.env.GEMINI_API_KEY) {
    assert.equal(body.provider, 'local_fallback', 'Never claim external model when local fallback was used');
  }
});

test('2.3. Zero-cost local triage answers hospital bed inquiries', async () => {
  const res = await fetch(`${baseUrl}/api/v1/chatbot/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'How can I check hospital bed availability or ICU admission?',
      language: 'English',
    }),
  });

  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.ok(
    body.reply.toLowerCase().includes('bed') || body.reply.toLowerCase().includes('admission'),
    'Should guide user to Beds & Admissions tab'
  );
});

test('2.4. Zero-cost local triage provides non-diagnostic home comfort advice for mild fever with physician consult guidance', async () => {
  const res = await fetch(`${baseUrl}/api/v1/chatbot/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'I have a mild fever and slight cough since yesterday morning',
      language: 'English',
    }),
  });

  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.ok(
    body.reply.toLowerCase().includes('rest') || body.reply.toLowerCase().includes('hydration') || body.reply.toLowerCase().includes('doctor') || body.reply.toLowerCase().includes('fluid'),
    'Must provide safe hydration/rest advice'
  );
  assert.ok(
    body.reply.toLowerCase().includes('not diagnose') || body.reply.toLowerCase().includes('consult') || body.reply.toLowerCase().includes('fever persists'),
    'Must explicitly state non-diagnostic disclaimer and consult recommendation'
  );
});

test('2.5. Clinical Refusal: Queries requesting medical diagnosis or drug prescriptions are strictly refused', async () => {
  const res = await fetch(`${baseUrl}/api/v1/chatbot/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Please diagnose my disease and prescribe medicine for cure',
      language: 'English',
    }),
  });

  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.ok(
    body.reply.toLowerCase().includes('prohibited') ||
      body.reply.toLowerCase().includes('diagnosing') ||
      body.reply.toLowerCase().includes('prescribing') ||
      body.reply.toLowerCase().includes('licensed medical clinician'),
    'Must explicitly refuse medical diagnosis and prescribing drugs'
  );
});

// =============================================================================
// MODULE 3: VOICE INPUT & OUTPUT (METADATA & BROWSER LIMITATIONS)
// =============================================================================

test('3.1. Speech capabilities and limitations are documented honestly in /config', async () => {
  const res = await fetch(`${baseUrl}/api/v1/chatbot/config`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  const speech = body.data.speechCapabilities;

  assert.ok(speech, 'speechCapabilities metadata must be present');
  assert.ok(speech.speechSynthesis.includes('SpeechSynthesis'), 'Documents SpeechSynthesis availability');
  assert.ok(speech.speechRecognition.includes('SpeechRecognition'), 'Documents SpeechRecognition browser support');
  assert.ok(speech.limitations.includes('Firefox'), 'Honesty: Notes Firefox lacks native SpeechRecognition by default');
});

test('3.2. Audio Privacy: Config confirms zero server-side voice recording retention', async () => {
  const res = await fetch(`${baseUrl}/api/v1/chatbot/config`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  const privacy = body.data.privacyPolicy;

  assert.ok(privacy.audioRetention, 'Must disclose audio retention policy');
  assert.ok(
    privacy.audioRetention.includes('NOT record') || privacy.audioRetention.includes('Web Speech API'),
    'Must confirm zero server audio recording or retention'
  );
});

test('3.3. Government 112 Non-Integration Disclaimer: Explicitly disclosed in /config', async () => {
  const res = await fetch(`${baseUrl}/api/v1/chatbot/config`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;

  assert.ok(body.data.integrationDisclaimer, 'Must include integration disclaimer');
  assert.ok(
    body.data.integrationDisclaimer.includes('does not claim an official government backend dispatch integration'),
    'Must not falsely claim government backend integration with 112'
  );
});

test('3.4. Chatbot replies are clean strings suitable for browser SpeechSynthesis without raw code syntax', async () => {
  const res = await fetch(`${baseUrl}/api/v1/chatbot/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Tell me about doctor appointments',
      language: 'English',
    }),
  });

  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.ok(typeof body.reply === 'string', 'Reply must be plain text string');
  assert.ok(!body.reply.includes('<script>'), 'Must be free of HTML/script injection');
});

// =============================================================================
// MODULE 4: EMERGENCY GUARDRAILS & CLINICAL SAFETY
// =============================================================================

test('4.1. Emergency Guardrail: Acute chest pain triggers immediate 112 guidance without conversational delay', async () => {
  const res = await fetch(`${baseUrl}/api/v1/chatbot/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'My father has severe crushing chest pain, numbness in left arm, and difficulty breathing',
      language: 'English',
    }),
  });

  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.equal(body.isEmergency, true, 'isEmergency must be true');
  assert.equal(body.emergencyContact, '112', 'Must specify 112 as primary contact');
  assert.ok(body.reply.includes('112'), 'Reply must prominently feature 112');
  assert.ok(body.emergencyGuidance, 'Must supply structured emergency guidance');
  assert.equal(body.emergencyGuidance.action, 'DIAL_112_OR_TRIGGER_SOS');
  assert.equal(body.emergencyGuidance.autoDispatch, false, 'Must NOT automatically dispatch solely on AI inference');
  assert.ok(
    body.emergencyGuidance.integrationNote.includes('does not claim official government backend dispatch integration'),
    'Guardrail must clarify direct calling assistance without false government integration claims'
  );
});

test('4.2. Emergency Guardrail: Hindi acute symptoms (सीने में दर्द, सांस लेने में तकलीफ) trigger immediate Hindi 112 alert', async () => {
  const res = await fetch(`${baseUrl}/api/v1/chatbot/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'मरीज को सीने में तेज दर्द है और सांस लेने में तकलीफ हो रही है',
      language: 'Hindi',
    }),
  });

  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.equal(body.isEmergency, true);
  assert.equal(body.emergencyContact, '112');
  assert.ok(body.reply.includes('112') || body.reply.includes('108'), 'Must direct Hindi speaker to emergency number');
  assert.ok(
    body.reply.includes('नानी कोई डॉक्टर नहीं है') || body.reply.includes('आपातकालीन'),
    'Must state non-diagnostic disclaimer in Hindi'
  );
});

test('4.3. Emergency Guardrail: Hinglish/Romanized acute symptoms (seene me tez dard) trigger emergency alert', async () => {
  const res = await fetch(`${baseUrl}/api/v1/chatbot/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Patient ko seene me dard aur saans lene me takleef hai',
      language: 'English',
    }),
  });

  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.equal(body.isEmergency, true);
  assert.equal(body.emergencyContact, '112');
});

test('4.4. Emergency Guardrail: Stroke signs and unconsciousness trigger emergency alert', async () => {
  const res = await fetch(`${baseUrl}/api/v1/chatbot/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Person suddenly collapsed and is unconscious with facial paralysis',
      language: 'English',
    }),
  });

  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.equal(body.isEmergency, true);
  assert.equal(body.emergencyContact, '112');
});

// =============================================================================
// MODULE 5: PRIVACY & AUTHENTICATED CONVERSATION HISTORY ACCESS
// =============================================================================

test('5.1. PII Redaction: Phone numbers, emails, and tokens are scrubbed before model processing', () => {
  const sensitivePrompt =
    'My phone is +919876543210 and email is patient.sharma@hospital.org with token Bearer eyJhbGciOiJIUzI1NiJ9.abc.def and Aadhaar 2345 6789 0123';
  const scrubbed = redactSensitiveString(sensitivePrompt);

  assert.ok(scrubbed.includes('Bearer [REDACTED_JWT]'), 'JWT token must be redacted');
  assert.ok(!scrubbed.includes('eyJhbGci'), 'Raw JWT must be stripped');
  assert.ok(scrubbed.includes('+9198****3210'), 'Phone number must be masked');
  assert.ok(scrubbed.includes('@hospital.org') && scrubbed.includes('****'), 'Email must be masked');
  assert.ok(scrubbed.includes('[REDACTED_AADHAAR]'), 'Aadhaar must be redacted');
});

test('5.2. Authenticated user can send message and retrieve their own conversation history', async () => {
  const patientA = { id: 'patient_nani_001', email: 'nani_user_a@lifelink.in', role: 'PATIENT', name: 'Rohan Joshi' };
  const tokenA = createToken(patientA);
  const sessionId = `session_auth_${Date.now()}`;

  // Send message with Authorization Bearer header
  const postRes = await fetch(`${baseUrl}/api/v1/chatbot/message`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenA}`,
    },
    body: JSON.stringify({
      message: 'Can I book an appointment for tomorrow morning at AIIMS?',
      language: 'English',
      sessionId,
    }),
  });
  assert.equal(postRes.status, 200);

  // Retrieve history for authenticated user
  const getRes = await fetch(`${baseUrl}/api/v1/chatbot/history?sessionId=${sessionId}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${tokenA}`,
    },
  });
  assert.equal(getRes.status, 200);
  const body = (await getRes.json()) as any;
  assert.equal(body.status, 'success');
  assert.ok(body.data.messages.length >= 2, 'History must contain user message and bot reply');
  assert.equal(body.data.messages[0].sender, 'user');
  assert.equal(body.data.messages[1].sender, 'nani');
});

test('5.3. Horizontal Isolation: Patient B CANNOT inspect Patient A’s conversation history', async () => {
  const patientA = { id: 'patient_nani_001', email: 'nani_user_a@lifelink.in', role: 'PATIENT' };
  const patientB = { id: 'patient_nani_002', email: 'nani_user_b@lifelink.in', role: 'PATIENT' };
  const tokenB = createToken(patientB);

  // Patient B attempts to inspect Patient A's conversation history using userId parameter
  const res = await fetch(`${baseUrl}/api/v1/chatbot/history?userId=${patientA.id}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${tokenB}`,
    },
  });

  assert.equal(res.status, 403, 'Unauthorized horizontal inspection must return HTTP 403 Forbidden');
  const body = (await res.json()) as any;
  assert.equal(body.status, 'fail');
  assert.ok(body.message.includes('Forbidden'));
});

test('5.4. Unauthenticated request targeting specific userId history is rejected with HTTP 401', async () => {
  const res = await fetch(`${baseUrl}/api/v1/chatbot/history?userId=patient_nani_001`, {
    method: 'GET',
  });

  assert.equal(res.status, 401, 'Unauthenticated query for specific user history must return 401');
});

test('5.5. Conversation history can be cleared on demand via DELETE /chatbot/history', async () => {
  const sessionId = `session_to_delete_${Date.now()}`;

  // Create message in session
  await fetch(`${baseUrl}/api/v1/chatbot/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Temporary query about OPD queues',
      sessionId,
    }),
  });

  // Verify history exists
  const checkRes = await fetch(`${baseUrl}/api/v1/chatbot/history?sessionId=${sessionId}`);
  const checkBody = (await checkRes.json()) as any;
  assert.ok(checkBody.data.count > 0, 'Should have messages in session');

  // Clear history
  const deleteRes = await fetch(`${baseUrl}/api/v1/chatbot/history?sessionId=${sessionId}`, {
    method: 'DELETE',
  });
  assert.equal(deleteRes.status, 200);

  // Verify history is wiped
  const wipedRes = await fetch(`${baseUrl}/api/v1/chatbot/history?sessionId=${sessionId}`);
  const wipedBody = (await wipedRes.json()) as any;
  assert.equal(wipedBody.data.count, 0, 'History should now be empty after clear request');
});

// =============================================================================
// MODULE 6: AI PROVIDER MANAGER ARCHITECTURE & PLUGGABILITY
// =============================================================================

test('6.1. AI Provider Manager safely handles local heuristic provider execution', async () => {
  const localProvider = new LocalHeuristicOfflineProvider();
  assert.equal(localProvider.isConfigured(), true);

  const res = await localProvider.generate({
    prompt: 'How to update blood group on Emergency Health ID?',
    language: 'English',
  });

  assert.equal(res.provider, 'local_fallback');
  assert.equal(res.costMode, 'zero_cost');
  assert.ok(res.reply.toLowerCase().includes('emergency health id') || res.reply.toLowerCase().includes('blood'));
});

test('6.2. LocalModelAdapter reports unconfigured when LOCAL_AI_URL is empty', () => {
  const originalUrl = process.env.LOCAL_AI_URL;
  delete process.env.LOCAL_AI_URL;

  const adapter = new LocalModelAdapter();
  assert.equal(adapter.isConfigured(), false, 'Should be unconfigured when LOCAL_AI_URL is missing');

  if (originalUrl) process.env.LOCAL_AI_URL = originalUrl;
});
