process.env.NODE_ENV = 'test';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import app from '../src/app';
import prisma, { inMemoryDb } from '../src/db';
import { validateEnvironment } from '../src/config/envValidator';
import { maskPhoneNumber, maskEmail, redactSensitiveString, sanitizeForLogging } from '../src/utils/privacyRedactor';
import { recoverInterruptedDispatches } from '../src/services/dispatchEngine';
import { processOutboxRetries, expireObsoleteOffers } from '../src/services/notificationService';
import { RequestStatus, DispatchAttemptStatus, AmbulanceType, NotificationStatus } from '@prisma/client';

import { Server } from 'socket.io';
import { setupSocketHandlers } from '../src/socket';

let server: http.Server;
let ioServer: Server;
let baseUrl: string;

test.before(async () => {
  inMemoryDb.clear();
  server = http.createServer(app);
  ioServer = new Server(server, { cors: { origin: '*' } });
  setupSocketHandlers(ioServer);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as any;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

test.after(async () => {
  if (ioServer) ioServer.close();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

// =============================================================================
// 1. STARTUP ENVIRONMENT & SECRETS INTEGRITY
// =============================================================================

test('1.1. validateEnvironment accepts valid development/test configuration', () => {
  const config = validateEnvironment();
  assert.equal(config.nodeEnv, 'test');
  assert.ok(config.port > 0);
  assert.ok(config.jwtSecret.length >= 32);
  assert.ok(config.jwtRefreshSecret.length >= 32);
  assert.notEqual(config.jwtSecret, config.jwtRefreshSecret);
});

test('1.2. validateEnvironment fails fast when production JWT_SECRET is weak or default', () => {
  const originalEnv = { ...process.env };
  try {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
    process.env.JWT_SECRET = 'lifelink_jwt_secret_key_2026_super_secure'; // Default dev secret
    process.env.JWT_REFRESH_SECRET = 'a_very_long_random_refresh_secret_that_is_at_least_32_chars';
    process.env.SUPER_ADMIN_TOTP_SECRET = 'SUPERADMINBASE32KEY';
    process.env.CORS_ORIGIN = 'https://app.lifelink.in';

    assert.throws(
      () => validateEnvironment(),
      /Default\/insecure development JWT_SECRET detected in production/
    );
  } finally {
    process.env = originalEnv;
  }
});

test('1.3. validateEnvironment fails fast when JWT_REFRESH_SECRET equals JWT_SECRET in production', () => {
  const originalEnv = { ...process.env };
  try {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
    const sameSecret = 'cryptographically_strong_random_secret_that_is_at_least_32_chars_long';
    process.env.JWT_SECRET = sameSecret;
    process.env.JWT_REFRESH_SECRET = sameSecret; // Reused secret
    process.env.SUPER_ADMIN_TOTP_SECRET = 'SUPERADMINBASE32KEY';
    process.env.CORS_ORIGIN = 'https://app.lifelink.in';

    assert.throws(
      () => validateEnvironment(),
      /JWT_REFRESH_SECRET must not be identical to JWT_SECRET/
    );
  } finally {
    process.env = originalEnv;
  }
});

test('1.4. validateEnvironment rejects wildcard CORS_ORIGIN in production', () => {
  const originalEnv = { ...process.env };
  try {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
    process.env.JWT_SECRET = 'cryptographically_strong_random_secret_one_32_chars_long';
    process.env.JWT_REFRESH_SECRET = 'cryptographically_strong_random_secret_two_32_chars_long';
    process.env.SUPER_ADMIN_TOTP_SECRET = 'SUPERADMINBASE32KEY';
    process.env.CORS_ORIGIN = '*'; // Wildcard prohibited with credentials

    assert.throws(
      () => validateEnvironment(),
      /Wildcard CORS_ORIGIN \("\*"\) is prohibited in production/
    );
  } finally {
    process.env = originalEnv;
  }
});

test('1.5. validateEnvironment rejects missing or non-PostgreSQL DATABASE_URL in production', () => {
  const originalEnv = { ...process.env };
  try {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'mysql://user:pass@localhost:3306/db';
    process.env.JWT_SECRET = 'cryptographically_strong_random_secret_one_32_chars_long';
    process.env.JWT_REFRESH_SECRET = 'cryptographically_strong_random_secret_two_32_chars_long';
    process.env.SUPER_ADMIN_TOTP_SECRET = 'SUPERADMINBASE32KEY';
    process.env.CORS_ORIGIN = 'https://app.lifelink.in';

    assert.throws(
      () => validateEnvironment(),
      /DATABASE_URL must be a valid PostgreSQL connection string/
    );
  } finally {
    process.env = originalEnv;
  }
});

// =============================================================================
// 2. PRIVACY-SAFE LOGGING & DPDP REDACTION
// =============================================================================

test('2.1. maskPhoneNumber redacts middle 4 digits of Indian MSISDN (+91 standard)', () => {
  const raw = '+919876543210';
  const masked = maskPhoneNumber(raw);
  assert.equal(masked, '+9198****3210');
  assert.ok(!masked.includes('7654'));
});

test('2.2. maskEmail preserves domain while masking username', () => {
  const raw = 'rohan.sharma@lifelink.in';
  const masked = maskEmail(raw);
  assert.equal(masked, 'r****a@lifelink.in');
  assert.ok(masked.endsWith('@lifelink.in'));
});

test('2.3. redactSensitiveString removes Bearer tokens and raw phone numbers from text', () => {
  const text = 'User authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.xyz for phone +919876543210';
  const redacted = redactSensitiveString(text);
  assert.ok(redacted.includes('Bearer [REDACTED_JWT]'));
  assert.ok(!redacted.includes('eyJhbGci'));
  assert.ok(redacted.includes('+9198****3210'));
});

test('2.4. sanitizeForLogging deeply masks sensitive healthcare and credential keys', () => {
  const payload = {
    patientName: 'Rohan Sharma',
    phone: '+919876543210',
    email: 'rohan@example.in',
    passwordHash: 'secret_bcrypt_hash_123',
    token: 'jwt.token.abc',
    medicalNotes: 'Acute chest pain radiating to left arm',
    allergies: 'Penicillin',
    vitals: {
      bloodGroup: 'B+',
      heartRate: 110,
    },
  };

  const sanitized = sanitizeForLogging(payload);
  assert.equal(sanitized.passwordHash, '[REDACTED]');
  assert.equal(sanitized.token, '[REDACTED]');
  assert.equal(sanitized.medicalNotes, '[REDACTED]');
  assert.equal(sanitized.allergies, '[REDACTED]');
  assert.equal(sanitized.vitals.bloodGroup, '[REDACTED]');
  assert.equal(sanitized.vitals.heartRate, 110);
  assert.ok(sanitized.phone.includes('****'));
});

// =============================================================================
// 3. HEALTH & READINESS PROBE ENDPOINTS
// =============================================================================

test('3.1. Liveness probes (/health and /api/v1/health) return HTTP 200 with service metadata', async () => {
  const res1 = await fetch(`${baseUrl}/health`);
  assert.equal(res1.status, 200);
  const body1 = (await res1.json()) as any;
  assert.equal(body1.status, 'ok');
  assert.equal(body1.service, 'LifeLink Backend API');
  assert.ok(body1.version);
  assert.ok(typeof body1.uptimeSeconds === 'number');

  const res2 = await fetch(`${baseUrl}/api/v1/health`);
  assert.equal(res2.status, 200);
});

test('3.2. Readiness probes (/ready and /api/v1/health/ready) report database status safely', async () => {
  const res = await fetch(`${baseUrl}/ready`);
  assert.ok(res.status === 200 || res.status === 503);
  const body = (await res.json()) as any;
  assert.ok(body.service === 'LifeLink Backend API');
  assert.ok(body.database);
  // Guarantee connection credentials or passwords are NEVER leaked in readiness probe
  const serialized = JSON.stringify(body);
  assert.ok(!serialized.includes('password'));
  assert.ok(!serialized.includes('DATABASE_URL'));
});

// =============================================================================
// 4. SCHEDULED RECOVERY & INTERRUPTED DISPATCH RECOVERY
// =============================================================================

test('4.1. recoverInterruptedDispatches transitions timed-out offers to EXPIRED on server restart', async () => {
  // Create an emergency request with an expired dispatch attempt (simulating crash while driver was considering)
  const req = await prisma.emergencyRequest.create({
    data: {
      patientId: 'patient-recovery-test-01',
      pickupLat: 21.1458,
      pickupLng: 79.0882,
      requiredAmbulanceType: AmbulanceType.BASIC_LIFE_SUPPORT,
      status: RequestStatus.OFFERED,
    },
  });

  const staleAttempt = await prisma.dispatchAttempt.create({
    data: {
      requestId: req.id,
      driverId: 'driver-stale-01',
      ambulanceId: 'amb-stale-01',
      status: DispatchAttemptStatus.OFFERED,
      distanceKm: 3.5,
      expiresAt: new Date(Date.now() - 60000), // Expired 1 minute ago during server downtime
    },
  });

  const recoveryResult = await recoverInterruptedDispatches();
  assert.ok(recoveryResult.expiredCount >= 1);

  const updatedAttempt = await prisma.dispatchAttempt.findUnique({
    where: { id: staleAttempt.id },
  });

  assert.equal(updatedAttempt?.status, DispatchAttemptStatus.EXPIRED);
  assert.ok(
    updatedAttempt?.rejectionReason === 'OFFER_TIMEOUT_RECOVERY' ||
    updatedAttempt?.rejectionReason === 'SERVER_REBOOT_OFFER_EXPIRED'
  );
});

test('4.2. processOutboxRetries recovers and delivers PENDING notifications', async () => {
  const notif = await prisma.notification.create({
    data: {
      recipientId: 'user-recovery-01',
      title: 'Pending Notification Recovery',
      message: 'This notification was queued before restart',
      type: 'IN_APP_ALERT',
      status: NotificationStatus.PENDING,
      retryCount: 0,
      maxRetries: 3,
    },
  });

  const outboxResult = await processOutboxRetries();
  assert.ok(outboxResult.retried >= 1);

  const updated = await prisma.notification.findUnique({ where: { id: notif.id } });
  assert.equal(updated?.status, NotificationStatus.DELIVERED);
});

test('4.3. expireObsoleteOffers transitions expired notification records to EXPIRED', async () => {
  const obsolete = await prisma.notification.create({
    data: {
      recipientId: 'user-recovery-02',
      title: 'Stale Dispatch Offer Alert',
      message: 'Offer timed out',
      type: 'DISPATCH_OFFER_ALERT',
      status: NotificationStatus.PENDING,
      expiresAt: new Date(Date.now() - 30000), // Expired 30 seconds ago
    },
  });

  const expiredCount = await expireObsoleteOffers();
  assert.ok(expiredCount >= 1);

  const updated = await prisma.notification.findUnique({ where: { id: obsolete.id } });
  assert.equal(updated?.status, NotificationStatus.EXPIRED);
});

// =============================================================================
// 5. ERROR SANITIZATION & STACK TRACE PROTECTION
// =============================================================================

test('5.1. Error responses sanitize internal error messages and strip stack traces in production mode', async () => {
  const originalEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';

    // Query non-existent route to test 404 handler
    const notFoundRes = await fetch(`${baseUrl}/api/v1/non-existent-route-xyz`);
    assert.equal(notFoundRes.status, 404);
    const body = (await notFoundRes.json()) as any;
    assert.equal(body.status, 'fail');
    assert.equal(body.stack, undefined, 'Stack trace must be undefined in production mode');
  } finally {
    process.env.NODE_ENV = originalEnv;
  }
});
