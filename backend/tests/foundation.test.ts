process.env.NODE_ENV = 'test';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import app from '../src/app';
import { verifyTOTP, generateTOTP } from '../src/utils/totp';
import { sendSMS } from '../src/utils/smsService';

import prisma from '../src/db';

let server: http.Server;
let baseUrl: string;

test.before(async () => {
  process.env.NODE_ENV = 'test';
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
  try {
    await prisma.$disconnect();
  } catch {}
});

test('1. GET /api/v1/health returns process liveness and structured status', async () => {
  const res = await fetch(`${baseUrl}/api/v1/health`);
  assert.equal(res.status, 200, 'Health endpoint should return HTTP 200');

  const data = (await res.json()) as any;
  assert.equal(data.status, 'ok');
  assert.equal(data.service, 'LifeLink Backend API');
  assert.equal(data.version, '2.0.0');
  assert.ok(typeof data.uptimeSeconds === 'number', 'Uptime should be a number');
  assert.ok(data.timestamp, 'Timestamp should be present');
});

test('2. GET /health legacy route returns HTTP 200 for backward compatibility', async () => {
  const res = await fetch(`${baseUrl}/health`);
  assert.equal(res.status, 200, 'Legacy /health endpoint should return HTTP 200');

  const data = (await res.json()) as any;
  assert.equal(data.status, 'ok');
  assert.equal(data.service, 'LifeLink Backend API');
});

test('3. GET /api/v1/health/ready accurately reflects database availability without crashing', async () => {
  const res = await fetch(`${baseUrl}/api/v1/health/ready`);
  const data = (await res.json()) as any;

  if (res.status === 200) {
    // If PostgreSQL is running locally
    assert.equal(data.status, 'ready');
    assert.equal(data.database.status, 'connected');
    assert.ok(typeof data.database.latencyMs === 'number');
  } else {
    // If PostgreSQL is offline/disconnected
    assert.equal(res.status, 503, 'Readiness should return HTTP 503 when DB is offline');
    assert.equal(data.status, 'degraded');
    assert.equal(data.database.status, 'unavailable');
    assert.ok(data.database.message, 'Failure message should be present');

    // SECURITY CHECK: Verify no secrets or credentials leaked in response
    const jsonStr = JSON.stringify(data);
    assert.ok(!jsonStr.includes('password'), 'Database password must not be leaked');
    assert.ok(!jsonStr.includes('postgresql://'), 'Full connection string must not be leaked');
  }
});

test('4. Unknown routes return structured JSON 404', async () => {
  const res = await fetch(`${baseUrl}/api/v1/unknown-endpoint-${Date.now()}`);
  assert.equal(res.status, 404, 'Unknown route should return HTTP 404');

  const data = (await res.json()) as any;
  assert.equal(data.status, 'fail');
  assert.ok(data.message.includes('Resource not found'));
});

test('5. Super Admin 2FA TOTP verification: hardcoded bypass codes are rejected', async () => {
  const secret = 'SUPERADMINSECRET123';

  // Legitimate TOTP code generated from secret should pass
  const epoch = Math.floor(Date.now() / 1000 / 30);
  const validCode = generateTOTP(secret, epoch);
  assert.equal(verifyTOTP(secret, validCode), true, 'Valid TOTP code must be accepted');

  // Hardcoded bypasses must be rejected
  assert.equal(verifyTOTP(secret, '123456'), false, '123456 must be rejected');
  assert.equal(verifyTOTP(secret, '000000'), false, '000000 must be rejected');
  assert.equal(verifyTOTP(secret, '999999'), false, 'Random code must be rejected');
  assert.equal(verifyTOTP(secret, 'invalid'), false, 'Non-digit strings must be rejected');
  assert.equal(verifyTOTP(secret, ''), false, 'Empty code must be rejected');
});

test('6. Chatbot fallback functions gracefully without GEMINI_API_KEY', async () => {
  const res = await fetch(`${baseUrl}/api/v1/chatbot/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'What is LifeLink SOS?' }),
  });

  assert.equal(res.status, 200, 'Chatbot fallback should return HTTP 200');
  const data = (await res.json()) as any;
  assert.ok(data.reply, 'Chatbot reply should be populated');
  assert.ok(typeof data.reply === 'string', 'Reply must be a string');
});

test('7. Chatbot emergency guardrail redirects acute symptoms to emergency services', async () => {
  const res = await fetch(`${baseUrl}/api/v1/chatbot/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'I have severe chest pain and cannot breath' }),
  });

  assert.equal(res.status, 200);
  const data = (await res.json()) as any;
  const reply = data.reply.toLowerCase();
  assert.ok(
    reply.includes('sos') || reply.includes('emergency') || reply.includes('urgent'),
    'Emergency queries must direct patient to SOS or emergency services'
  );
});

test('8. SMS service gracefully logs mock message without Twilio credentials', async () => {
  const result = await sendSMS('+15551234567', 'Test emergency alert dispatch');
  assert.equal(result.success, true, 'Mock SMS dispatch should succeed');
  assert.equal(result.mock, true, 'Result should be flagged as mock');
  assert.ok(result.messageId?.startsWith('mock_'), 'Message ID should indicate mock generation');
});
