import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import app from '../src/app';
import prisma from '../src/db';
import { generateTokens } from '../src/services/tokenService';
import { Role, NotificationStatus, DispatchAttemptStatus, RequestStatus } from '@prisma/client';
import { logger } from '../src/utils/logger';
import { metrics } from '../src/utils/metrics';
import { processOutboxRetries, expireObsoleteOffers } from '../src/services/notificationService';
import { atomicallyAcceptOffer } from '../src/services/dispatchEngine';

let server: http.Server;
let port: number;
let baseUrl: string;

let superAdminToken: string;
let patientToken: string;
let driverToken: string;

let superAdminUser: any;
let patientUser: any;
let driverUser: any;

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test_secret_for_observability_1234567890_min_32_chars';
  process.env.TEST_DB_CONNECTED = 'true';

  metrics.reset();

  server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      port = (server.address() as any).port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  // 1. Seed Super Admin
  superAdminUser = await prisma.user.create({
    data: {
      email: 'sre.director@lifelink.in',
      name: 'SRE Incident Commander',
      role: Role.SUPER_ADMIN,
      passwordHash: 'hashed_pw_test',
      phone: '+919876543201',
    },
  });
  const saTokens = generateTokens({
    id: superAdminUser.id,
    email: superAdminUser.email,
    name: superAdminUser.name,
    role: superAdminUser.role,
  });
  superAdminToken = saTokens.accessToken;

  // 2. Seed Patient
  patientUser = await prisma.user.create({
    data: {
      email: 'patient.observability@lifelink.in',
      name: 'Rohan Observability',
      role: Role.PATIENT,
      passwordHash: 'hashed_pw_test',
      phone: '+919876543202',
    },
  });
  const pTokens = generateTokens({
    id: patientUser.id,
    email: patientUser.email,
    name: patientUser.name,
    role: patientUser.role,
  });
  patientToken = pTokens.accessToken;

  // 3. Seed Driver
  driverUser = await prisma.user.create({
    data: {
      email: 'driver.observability@lifelink.in',
      name: 'Suresh Pilot Driver',
      role: Role.DRIVER,
      passwordHash: 'hashed_pw_test',
      phone: '+919876543203',
    },
  });
  const dTokens = generateTokens({
    id: driverUser.id,
    email: driverUser.email,
    name: driverUser.name,
    role: driverUser.role,
  });
  driverToken = dTokens.accessToken;
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

// -------------------------------------------------------------
// Section 1: Health & Readiness Subsystem Diagnostics
// -------------------------------------------------------------

test('1.1. Public Liveness check returns HTTP 200 without leaking secrets or internals', async () => {
  const res = await fetch(`${baseUrl}/api/v1/health`);
  assert.equal(res.status, 200);

  const data = (await res.json()) as any;
  assert.equal(data.status, 'ok');
  assert.equal(data.service, 'LifeLink Backend API');
  assert.equal(data.version, '2.0.0');
  assert.equal(typeof data.uptimeSeconds, 'number');
  assert.ok(data.timestamp);

  // Verify strict zero credential/secrets leakage
  const bodyText = JSON.stringify(data);
  assert.equal(bodyText.includes('JWT_SECRET'), false);
  assert.equal(bodyText.includes('postgresql://'), false);
  assert.equal(bodyText.includes('password'), false);
});

test('1.2. Public Readiness check verifies database connection latency safely', async () => {
  const res = await fetch(`${baseUrl}/api/v1/health/ready`);
  assert.equal(res.status, 200);

  const data = (await res.json()) as any;
  assert.equal(data.status, 'ready');
  assert.equal(data.database.status, 'connected');
  assert.equal(data.database.type, 'PostgreSQL');
  assert.equal(typeof data.database.latencyMs, 'number');

  // Verify no raw DB credentials or server internals
  const bodyText = JSON.stringify(data);
  assert.equal(bodyText.includes('postgres:'), false);
  assert.equal(bodyText.includes('localhost:5432'), false);
});

test('1.3. Readiness check fails fast (HTTP 503) without leaking internals during simulated DB timeout', async () => {
  // Temporarily simulate DB unavailability
  process.env.TEST_DB_CONNECTED = 'false';

  try {
    const res = await fetch(`${baseUrl}/ready`);
    assert.equal(res.status, 503);

    const data = (await res.json()) as any;
    assert.equal(data.status, 'degraded');
    assert.equal(data.database.status, 'unavailable');
    assert.ok(data.database.message.includes('Database connection offline'));

    // Verify raw driver stack trace is not exposed
    assert.equal(data.stack, undefined);
  } finally {
    process.env.TEST_DB_CONNECTED = 'true';
  }
});

// -------------------------------------------------------------
// Section 2: End-to-End Correlation ID & Distributed Tracing
// -------------------------------------------------------------

test('2.1. Inbound requests automatically receive a unique Correlation ID in headers', async () => {
  const res = await fetch(`${baseUrl}/api/v1/health`);
  assert.equal(res.status, 200);

  const correlationId = res.headers.get('x-correlation-id');
  assert.ok(correlationId);
  assert.ok(correlationId.startsWith('ll-'));
});

test('2.2. Inbound requests with existing X-Correlation-ID preserve and echo the correlation ID', async () => {
  const customTraceId = 'sre-incident-trace-998877';
  const res = await fetch(`${baseUrl}/api/v1/health`, {
    headers: {
      'X-Correlation-ID': customTraceId,
    },
  });
  assert.equal(res.status, 200);

  const correlationId = res.headers.get('x-correlation-id');
  assert.equal(correlationId, customTraceId);
});

// -------------------------------------------------------------
// Section 3: Structured Logging & PII Redaction
// -------------------------------------------------------------

test('3.1. Structured logger produces compliant schema entries with outcome and component', () => {
  const entry = logger.logOperation('DATABASE', 'FindUserById', 'SUCCESS', {
    correlationId: 'test-trace-123',
    durationMs: 4.2,
    metadata: { userId: 'usr-abc-123' },
  });

  assert.equal(entry.level, 'INFO');
  assert.equal(entry.component, 'DATABASE');
  assert.equal(entry.correlationId, 'test-trace-123');
  assert.equal(entry.operationOutcome, 'SUCCESS');
  assert.equal(entry.durationMs, 4.2);
  assert.ok(entry.timestamp);
});

test('3.2. Structured logger redacts PII and rounds GPS coordinates in log metadata', () => {
  const entry = logger.warn('DISPATCH', 'Suspected unverified candidate location', {
    metadata: {
      driverPhone: '+919876543210',
      password: 'supersecretpassword',
      token: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
      lat: 21.1458321,
      lng: 79.0882119,
    },
  });

  assert.equal(entry.metadata?.password, '[REDACTED]');
  assert.equal(entry.metadata?.token, '[REDACTED]');
  assert.equal(entry.metadata?.driverPhone, '+9198****3210');
  // Coordinates rounded to 2 decimal places to prevent exact location leak in logs
  assert.equal(entry.metadata?.lat, 21.15);
  assert.equal(entry.metadata?.lng, 79.09);
});

// -------------------------------------------------------------
// Section 4: Operational Metrics Registry
// -------------------------------------------------------------

test('4.1. Operational metrics accurately count HTTP requests, status codes, and latency', async () => {
  metrics.reset();

  // Make 3 requests: two 200s and one 404
  await fetch(`${baseUrl}/api/v1/health`);
  await fetch(`${baseUrl}/api/v1/health/ready`);
  await fetch(`${baseUrl}/api/v1/non-existent-route-for-metric-test`);

  const snapshot = metrics.getSnapshot();
  assert.ok(snapshot.http.totalRequests >= 3);
  assert.ok(snapshot.http.totalErrors >= 1);
  assert.ok(snapshot.http.byStatusCode['2xx'] >= 2);
  assert.ok(snapshot.http.byStatusCode['4xx'] >= 1);
  assert.ok(snapshot.http.latency.avgMs >= 0);
});

test('4.2. Operational metrics export standard Prometheus/OpenMetrics text format', () => {
  metrics.recordDispatchOffer('OFFERED');
  metrics.recordDispatchOffer('ACCEPTED');
  metrics.recordGpsUpdate(15, false);

  const promText = metrics.toPrometheusFormat();
  assert.ok(promText.includes('lifelink_uptime_seconds'));
  assert.ok(promText.includes('lifelink_http_requests_total'));
  assert.ok(promText.includes('lifelink_dispatch_offers_total'));
  assert.ok(promText.includes('lifelink_dispatch_acceptances_total'));
  assert.ok(promText.includes('lifelink_gps_updates_total'));
});

// -------------------------------------------------------------
// Section 5: Authenticated Diagnostics & Access Control
// -------------------------------------------------------------

test('5.1. Unauthenticated or Patient access to /api/v1/admin/diagnostics is rejected (401/403)', async () => {
  // Unauthenticated
  const unauthRes = await fetch(`${baseUrl}/api/v1/admin/diagnostics`);
  assert.equal(unauthRes.status, 401);

  // Patient caller
  const patientRes = await fetch(`${baseUrl}/api/v1/admin/diagnostics`, {
    headers: { Authorization: `Bearer ${patientToken}` },
  });
  assert.equal(patientRes.status, 403);
});

test('5.2. Super Admin retrieves detailed system diagnostics without secret leakage', async () => {
  const res = await fetch(`${baseUrl}/api/v1/admin/diagnostics`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  assert.equal(res.status, 200);

  const diag = (await res.json()) as any;
  assert.equal(diag.database.status, 'connected');
  assert.equal(diag.database.type, 'PostgreSQL');
  assert.ok(diag.integrations.twilioSms.mode);
  assert.ok(diag.integrations.geminiAi.mode);
  assert.ok(diag.integrations.routingEngine.mode);
  assert.equal(typeof diag.system.memoryRssMb, 'number');
  assert.equal(typeof diag.workers.outboxBacklogPending, 'number');

  // Verify zero secrets in diagnostic dump
  const diagStr = JSON.stringify(diag);
  assert.equal(diagStr.includes('JWT_SECRET'), false);
  assert.equal(diagStr.includes('passwordHash'), false);
  assert.equal(diagStr.includes('postgresql://'), false);
});

test('5.3. Super Admin retrieves Prometheus metrics text format when requested', async () => {
  const res = await fetch(`${baseUrl}/api/v1/admin/metrics`, {
    headers: {
      Authorization: `Bearer ${superAdminToken}`,
      Accept: 'text/plain',
    },
  });
  assert.equal(res.status, 200);
  assert.ok(res.headers.get('content-type')?.includes('text/plain'));

  const text = await res.text();
  assert.ok(text.includes('lifelink_uptime_seconds'));
  assert.ok(text.includes('lifelink_dispatch_offers_total'));
});

// -------------------------------------------------------------
// Section 6: Failure Handling & State Invariants
// -------------------------------------------------------------

test('6.1. Expired dispatch offer cannot be accepted later (enforces OFFER_EXPIRED invariant)', async () => {
  // 1. Create a hospital and ambulance for driver
  const hospital = await prisma.hospital.create({
    data: {
      name: 'Nagpur Diagnostic Hospital',
      address: 'Central Nagpur',
      lat: 21.1458,
      lng: 79.0882,
      contactNumber: '+917122000001',
      availableBeds: 15,
      city: 'Nagpur',
      state: 'Maharashtra',
      adminUserId: superAdminUser.id,
    },
  });

  const ambulance = await prisma.ambulance.create({
    data: {
      vehicleNumber: 'MH-31-EXP-9999',
      ambulanceType: 'BASIC_LIFE_SUPPORT',
      hospitalId: hospital.id,
      driverId: driverUser.id,
      isAvailable: true,
      currentLat: 21.1458,
      currentLng: 79.0882,
      lastUpdated: new Date(),
    },
  });

  // 2. Create emergency request
  const request = await prisma.emergencyRequest.create({
    data: {
      patientId: patientUser.id,
      pickupLat: 21.146,
      pickupLng: 79.089,
      pickupAddress: 'Sitabuldi Square',
      status: RequestStatus.OFFERED,
      category: 'MEDICAL_EMERGENCY',
      urgencyLevel: 'HIGH',
      requiredAmbulanceType: 'BASIC_LIFE_SUPPORT',
    },
  });

  // 3. Create already-expired dispatch attempt (expired 10 seconds ago)
  const expiredAttempt = await prisma.dispatchAttempt.create({
    data: {
      requestId: request.id,
      ambulanceId: ambulance.id,
      driverId: driverUser.id,
      distanceKm: 2.5,
      status: DispatchAttemptStatus.OFFERED,
      expiresAt: new Date(Date.now() - 10000), // Expired in the past
    },
  });

  // 4. Driver attempts acceptance -> must be rejected with OFFER_EXPIRED
  const acceptResult = await atomicallyAcceptOffer(expiredAttempt.id, driverUser.id);
  assert.equal(acceptResult.success, false);
  assert.equal(acceptResult.code, 'OFFER_EXPIRED');

  // Verify attempt is transitioned to EXPIRED in database
  const updatedAttempt = await prisma.dispatchAttempt.findUnique({
    where: { id: expiredAttempt.id },
  });
  assert.equal(updatedAttempt?.status, DispatchAttemptStatus.EXPIRED);
});

test('6.2. Bounded outbox retries transition to FAILED without unbounded infinite loops', async () => {
  // Create a stuck notification with retryCount = 4 and maxRetries = 5
  const stuckNotification = await prisma.notification.create({
    data: {
      recipientId: patientUser.id,
      title: 'Stuck Alert',
      message: 'Network disruption simulation',
      type: 'EMERGENCY_STATUS',
      status: NotificationStatus.PENDING,
      retryCount: 4,
      maxRetries: 5,
    },
  });

  // Execute outbox retry worker (will fail because test environment has no client socket connected for recipient)
  const workerResult = await processOutboxRetries();
  assert.ok(workerResult.retried >= 1);

  // Verify status is transitioned to FAILED and not left in endless PENDING
  const refreshed = await prisma.notification.findUnique({
    where: { id: stuckNotification.id },
  });
  assert.equal(refreshed?.status, NotificationStatus.FAILED);
  assert.equal(refreshed?.retryCount, 5);
});

test('6.3. Stale GPS (>30 min) marks location as stale and sets movementStatus to UNKNOWN', async () => {
  // Update ambulance with 45-minute-old lastUpdated
  const staleTimestamp = new Date(Date.now() - 45 * 60 * 1000);
  const amb = await prisma.ambulance.findFirst({
    where: { vehicleNumber: 'MH-31-EXP-9999' },
  });
  assert.ok(amb);

  await prisma.ambulance.update({
    where: { id: amb.id },
    data: {
      lastUpdated: staleTimestamp,
      movementStatus: 'STOPPED', // Stale recorded status
    },
  });

  // Query ambulance inventory via API
  const res = await fetch(`${baseUrl}/api/v1/ambulances/fleet?city=Nagpur`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  assert.equal(res.status, 200);

  const body = (await res.json()) as any;
  const fleet = body.fleet || body;
  const targetAmb = fleet.find((a: any) => a.id === amb.id);
  assert.ok(targetAmb);
  assert.equal(targetAmb.lastKnownLocation.isLocationStale, true);
  // Must be displayed as UNKNOWN because 45-minute-old data is insufficient evidence for STOPPED
  assert.equal(targetAmb.operationalAvailability.movementStatus, 'UNKNOWN');
});

// -------------------------------------------------------------
// Section 7: Privileged Recovery Action Audit
// -------------------------------------------------------------

test('7.1. Privileged worker trigger drains outbox and records audit log', async () => {
  const res = await fetch(`${baseUrl}/api/v1/admin/workers/trigger`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${superAdminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      reason: 'Scheduled SRE outbox backlog drain test',
    }),
  });
  assert.equal(res.status, 200);

  const data = (await res.json()) as any;
  assert.ok(data.results.dispatchRecovery);
  assert.ok(data.results.outboxRecovery);
  assert.equal(typeof data.results.expiredOffers, 'number');

  // Verify audit log was recorded in database
  const auditLog = await prisma.activityLog.findFirst({
    where: {
      action: 'TRIGGER_RECOVERY_WORKERS',
      adminId: superAdminUser.id,
    },
    orderBy: { timestamp: 'desc' },
  });
  assert.ok(auditLog);
  assert.ok(JSON.stringify(auditLog.metadata).includes('Scheduled SRE outbox backlog drain test'));
});
