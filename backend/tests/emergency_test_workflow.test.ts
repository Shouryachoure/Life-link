import assert from 'assert';
import http from 'http';
import app from '../src/app';
import prisma from '../src/db';
import * as jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';

const JWT_SECRET = process.env.JWT_SECRET || 'lifelink_jwt_secret_key_2026_super_secure';

function createAuthToken(userId: string, role: string, email: string): string {
  return jwt.sign({ id: userId, role, email }, JWT_SECRET, { expiresIn: '1h' });
}

async function runSosTestWorkflowVerification() {
  console.log('\n================================================================');
  console.log('LifeLink — Controlled SOS Call & Location Delivery Test Suite');
  console.log('================================================================\n');

  // Start test server on ephemeral port
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  let passedTests = 0;
  let totalTests = 0;

  async function test(name: string, fn: () => Promise<void>) {
    totalTests++;
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passedTests++;
    } catch (err: any) {
      console.error(`  ✗ ${name}`);
      console.error(`    Error: ${err.message}`);
      if (err.stack) {
        console.error(`    ${err.stack.split('\n').slice(1, 4).join('\n    ')}`);
      }
    }
  }

  try {
    // Ensure test user exists in database
    let testUser = await prisma.user.findFirst({
      where: { email: 'patient.test.sos@lifelink.in' },
    });

    if (!testUser) {
      testUser = await prisma.user.create({
        data: {
          name: 'Priya Sharma (Test Patient)',
          email: 'patient.test.sos@lifelink.in',
          passwordHash: 'hashed_password_for_testing',
          role: Role.PATIENT,
          phone: '+919876543210',
        },
      });
    }

    const patientToken = createAuthToken(testUser.id, testUser.role, testUser.email);
    const authHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${patientToken}`,
    };

    let createdRequestId = '';
    let testEmergencyId = '';

    // 1. Environment & Config Verification
    await test('1. Test contact is configured in environment with +91 country code & labeled TEST CONTACT', async () => {
      const res = await fetch(`${baseUrl}/api/v1/sos/test-workflow/config`, {
        headers: authHeaders,
      });
      assert.strictEqual(res.status, 200, 'Config endpoint should return 200');
      const data: any = await res.json();

      assert.strictEqual(data.testContact.phone, '+918669202393', 'Test contact phone must match +918669202393');
      assert.strictEqual(data.testContact.name, 'TEST CONTACT', 'Test contact must be clearly labeled TEST CONTACT');
      assert.strictEqual(data.testContact.countryCode, '+91', 'Country code must be +91');
      assert.strictEqual(data.testContact.isTest, true, 'isTest flag must be true');
      assert.strictEqual(data.safetyGuidelines.isDemoSandbox, true, 'Safety sandbox must be enabled');
      assert.strictEqual(data.safetyGuidelines.realAmbulanceDispatched, false, 'No real ambulances should be dispatched');
      assert.strictEqual(data.safetyGuidelines.officialEmergencyFallback.nationalEmergencyNumber, '112', '112 fallback preserved');
    });

    // 2. Reject Invalid Coordinates
    await test('2. Test SOS initiation rejects invalid coordinate values', async () => {
      const res = await fetch(`${baseUrl}/api/v1/sos/test-workflow/initiate`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          pickupLat: 999, // Invalid latitude
          pickupLng: 79.0882,
          gpsPermission: 'GRANTED',
        }),
      });
      assert.strictEqual(res.status, 400, 'Invalid coordinates must return 400');
      const data: any = await res.json();
      assert.strictEqual(data.code, 'INVALID_COORDINATES');
    });

    // 3. Initiate Controlled SOS Test
    await test('3. Controlled SOS initiation creates isolated demo record with valid ID and notification payload', async () => {
      const nagpurLat = 21.1458;
      const nagpurLng = 79.0882;

      const res = await fetch(`${baseUrl}/api/v1/sos/test-workflow/initiate`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          pickupLat: nagpurLat,
          pickupLng: nagpurLng,
          gpsPermission: 'GRANTED',
          pickupAddress: 'Dharampeth, Nagpur, Maharashtra',
          notes: 'Test drill initiated from verification suite',
        }),
      });

      assert.strictEqual(res.status, 201, 'Initiation should return 201 Created');
      const data: any = await res.json();

      assert.strictEqual(data.success, true);
      assert.ok(data.requestId, 'Must return database requestId');
      assert.ok(data.testEmergencyId.startsWith('LL-TEST-'), 'Must generate unique LL-TEST- ID');
      assert.strictEqual(data.gps.lat, nagpurLat);
      assert.strictEqual(data.gps.lng, nagpurLng);
      assert.ok(data.gps.mapsUrl.includes('21.1458,79.0882'), 'Must include Google Maps link');

      // Verify notification payload content
      assert.strictEqual(data.notificationPayload.recipient.phone, '+918669202393');
      assert.strictEqual(data.notificationPayload.recipient.name, 'TEST CONTACT');
      assert.ok(data.notificationPayload.messageBody.includes('LIFELINK SOS TEST'));
      assert.ok(data.notificationPayload.messageBody.includes(data.testEmergencyId));
      assert.ok(data.notificationPayload.messageBody.includes('https://www.google.com/maps?q=21.1458,79.0882'));
      assert.ok(data.notificationPayload.messageBody.includes('TEST ONLY'));

      createdRequestId = data.requestId;
      testEmergencyId = data.testEmergencyId;

      // Verify database isolation (isDemo = true, zero driver dispatch attempts)
      const dbRecord = await prisma.emergencyRequest.findUnique({
        where: { id: createdRequestId },
        include: { dispatchAttempts: true, events: true },
      });

      assert.ok(dbRecord, 'Record must exist in database');
      assert.strictEqual(dbRecord?.isDemo, true, 'isDemo must be strictly true');
      assert.strictEqual(dbRecord?.category, 'EMERGENCY_TEST_WORKFLOW');
      assert.strictEqual(dbRecord?.urgencyLevel, 'TEST_DRILL');
      assert.strictEqual(dbRecord?.dispatchAttempts.length, 0, 'Must NOT trigger any real driver dispatch attempts');

      // Verify event was logged
      const initEvent = dbRecord?.events.find((e) => e.eventType === 'TEST_SOS_INITIATED');
      assert.ok(initEvent, 'TEST_SOS_INITIATED event must be logged');
      assert.strictEqual(initEvent?.isDemo, true);
    });

    // 4. Send Location Delivery Requires Confirmation
    await test('4. Location delivery requires explicit user confirmation before sending', async () => {
      const res = await fetch(`${baseUrl}/api/v1/sos/test-workflow/send-location`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          requestId: createdRequestId,
          confirmedByUser: false, // Not confirmed
        }),
      });

      assert.strictEqual(res.status, 400, 'Unconfirmed delivery must be rejected');
      const data: any = await res.json();
      assert.strictEqual(data.code, 'CONFIRMATION_REQUIRED');
    });

    // 5. Send Location Delivery Truthful Reporting (Never Simulates Success when Twilio is unset)
    await test('5. Location delivery truthfully reports unavailable carrier without simulating success', async () => {
      const res = await fetch(`${baseUrl}/api/v1/sos/test-workflow/send-location`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          requestId: createdRequestId,
          confirmedByUser: true,
        }),
      });

      assert.strictEqual(res.status, 200);
      const data: any = await res.json();

      // Since Twilio credentials are not set in environment:
      assert.strictEqual(data.carrierConfigured, false, 'Carrier must be recognized as unconfigured');
      assert.strictEqual(data.success, false, 'Must NOT simulate successful carrier delivery');
      assert.strictEqual(data.deliveryMode, 'FAILED', 'Delivery mode must be FAILED, not SIMULATED_MOCK');
      assert.strictEqual(data.deliveryStatus, 'FAILED', 'Delivery status must be FAILED');
      assert.ok(data.error.includes('Automatic carrier delivery unavailable'), 'Error must explain missing carrier');

      // Fallback deep links must be provided
      assert.ok(data.directLinks.sms.startsWith('sms:+918669202393?body='), 'Must provide device SMS deep link');
      assert.ok(data.directLinks.whatsapp.startsWith('https://wa.me/918669202393?text='), 'Must provide WhatsApp deep link');

      // Verify audit event persisted in database
      const dbEvent = await prisma.emergencyEvent.findFirst({
        where: {
          requestId: createdRequestId,
          eventType: 'TEST_LOCATION_DELIVERY_ATTEMPTED',
        },
      });

      assert.ok(dbEvent, 'TEST_LOCATION_DELIVERY_ATTEMPTED event must be stored in database');
      assert.strictEqual(dbEvent?.newState, 'DELIVERY_FAILED');
      assert.strictEqual(dbEvent?.isDemo, true);
    });

    // 6. Record Phone Dialer Action
    await test('6. Call action records dialer launch truthfully without claiming call completed', async () => {
      const res = await fetch(`${baseUrl}/api/v1/sos/test-workflow/call-action`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          requestId: createdRequestId,
        }),
      });

      assert.strictEqual(res.status, 200);
      const data: any = await res.json();

      assert.strictEqual(data.success, true);
      assert.strictEqual(data.status, 'DIALER_LAUNCHED', 'Status must be DIALER_LAUNCHED, never CALL_COMPLETED');
      assert.strictEqual(data.dialerUri, 'tel:+918669202393');
      assert.strictEqual(data.recipient.phone, '+918669202393');
      assert.ok(data.disclaimer.includes('Telephone dialer launched on device'), 'Disclaimer must clarify browser limit');

      // Verify event in database
      const dbEvent = await prisma.emergencyEvent.findFirst({
        where: {
          requestId: createdRequestId,
          eventType: 'TEST_CALL_DIALER_INITIATED',
        },
      });

      assert.ok(dbEvent, 'TEST_CALL_DIALER_INITIATED event must be stored');
      assert.strictEqual(dbEvent?.newState, 'DIALER_LAUNCHED');
    });

    // 7. Results & Audit History Endpoint
    await test('7. Results endpoint returns complete audit summary with all 6 required fields and timestamps', async () => {
      const res = await fetch(`${baseUrl}/api/v1/sos/test-workflow/results/${createdRequestId}`, {
        headers: authHeaders,
      });

      assert.strictEqual(res.status, 200);
      const report: any = await res.json();

      // Field 1: SOS Request Created
      assert.strictEqual(report.requestId, createdRequestId);
      assert.strictEqual(report.testEmergencyId, testEmergencyId);
      assert.ok(report.createdAt, 'Must include createdAt timestamp');

      // Field 2: GPS Permission & Coordinates
      assert.strictEqual(report.gps.permission, 'GRANTED');
      assert.strictEqual(report.gps.lat, 21.1458);
      assert.strictEqual(report.gps.lng, 79.0882);
      assert.ok(report.gps.mapsUrl.includes('21.1458,79.0882'));

      // Field 3: Notification Prepared
      assert.strictEqual(report.notification.recipient.phone, '+918669202393');
      assert.strictEqual(report.notification.testModeDesignation, 'TEST ONLY');

      // Field 4: Carrier Delivery Status (truthful failure reported)
      assert.strictEqual(report.delivery.attempted, true);
      assert.strictEqual(report.delivery.success, false);
      assert.strictEqual(report.delivery.carrierConfigured, false);
      assert.strictEqual(report.delivery.deliveryStatus, 'FAILED');

      // Field 5: Call Action Initiated
      assert.strictEqual(report.calling.dialerLaunched, true);
      assert.strictEqual(report.calling.status, 'DIALER_LAUNCHED');
      assert.strictEqual(report.calling.recipient, '+918669202393');

      // Field 6: Ambulance Dispatch NOT ATTEMPTED
      assert.strictEqual(report.ambulanceDispatch.status, 'NOT ATTEMPTED — TEST MODE');
      assert.strictEqual(report.ambulanceDispatch.realAmbulanceDispatched, false);
      assert.strictEqual(report.ambulanceDispatch.fakeVehiclePositionsCreated, false);

      // Audit Timeline & Safety Safeguards
      assert.ok(report.timeline.length >= 3, 'Timeline must contain initiate, delivery, and call events');
      assert.strictEqual(report.safetyStatus.zeroRealAmbulancesDispatched, true);
      assert.strictEqual(report.safetyStatus.zeroHospitalErNotified, true);
      assert.strictEqual(report.safetyStatus.nationalEmergencyFallback.nationalEmergencyNumber, '112');
    });

  } finally {
    server.close();
  }

  console.log('\n----------------------------------------------------------------');
  console.log(`Results: ${passedTests}/${totalTests} tests passed (${Math.round((passedTests / totalTests) * 100)}%)`);
  console.log('----------------------------------------------------------------\n');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runSosTestWorkflowVerification().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
