import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import app from '../src/app';
import prisma from '../src/db';
import { generateTokens } from '../src/services/tokenService';
import {
  Role,
  RequestStatus,
  NotificationStatus,
  NotificationChannel,
  AmbulanceType,
  TripLifecycleStatus,
} from '@prisma/client';
import { normalizeTrustedContactPhone } from '../src/utils/phoneUtils';
import { dispatchNotification } from '../src/services/notificationService';
import { sendSMS } from '../src/utils/smsService';

let server: http.Server;
let port: number;
let baseUrl: string;

let hospitalAdminUser: any;
let driverUser: any;

let patientAUser: any;
let patientAToken: string;

let patientBUser: any;
let patientBToken: string;

let emergencyReqA: any;
let emergencyReqB: any;
let testAmbulance: any;
let testHospital: any;
let testTripA: any;

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test_secret_trusted_contacts_trip_sharing_2026';
  process.env.TEST_DB_CONNECTED = 'true';

  server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      port = (server.address() as any).port;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });

  // 1. Seed Hospital Admin and Hospital
  hospitalAdminUser = await prisma.user.create({
    data: {
      email: `admin.hospital.${Date.now()}@lifelink.org.in`,
      passwordHash: 'hash',
      name: 'Dr. Deshmukh',
      role: Role.ADMIN_HOSPITAL,
    },
  });

  testHospital = await prisma.hospital.create({
    data: {
      name: 'AIIMS Nagpur Trauma Center',
      address: 'Plot 2, Sector 20, MIHAN, Nagpur, Maharashtra',
      contactNumber: '+917122500001',
      lat: 21.0543,
      lng: 79.0253,
      availableBeds: 25,
      totalBeds: 50,
      adminUserId: hospitalAdminUser.id,
    },
  });

  // 2. Seed Driver and Ambulance
  driverUser = await prisma.user.create({
    data: {
      email: `driver.ramesh.${Date.now()}@lifelink.org.in`,
      passwordHash: 'hash',
      name: 'Ramesh Pilot',
      phone: '+919811122233',
      role: Role.DRIVER,
    },
  });

  testAmbulance = await prisma.ambulance.create({
    data: {
      vehicleNumber: 'MH-31-TR-9009',
      ambulanceType: AmbulanceType.ADVANCED_LIFE_SUPPORT,
      currentLat: 21.1458,
      currentLng: 79.0882,
      movementStatus: 'MOVING',
      speedKmH: 45,
      lastUpdated: new Date(),
      isAvailable: false,
      driverId: driverUser.id,
    },
  });

  // 3. Seed Patient A
  patientAUser = await prisma.user.create({
    data: {
      email: `patient.arjun.${Date.now()}@lifelink.org.in`,
      passwordHash: 'hash',
      name: 'Arjun Verma',
      phone: '+919876543210',
      role: Role.PATIENT,
    },
  });
  patientAToken = generateTokens({
    id: patientAUser.id,
    email: patientAUser.email,
    role: patientAUser.role,
    name: patientAUser.name,
  }).accessToken;

  // Patient A Profile with emergency sharing consent enabled
  await prisma.patientProfile.create({
    data: {
      userId: patientAUser.id,
      bloodGroup: 'O_POSITIVE',
      consentEmergencySharing: true,
      customAlertMessage: 'I have chronic asthma and keep an inhaler in my backpack.',
    },
  });

  // 4. Seed Patient B (With sharing consent explicitly REVOKED/DISABLED)
  patientBUser = await prisma.user.create({
    data: {
      email: `patient.ananya.${Date.now()}@lifelink.org.in`,
      passwordHash: 'hash',
      name: 'Ananya Deshmukh',
      phone: '+919823456789',
      role: Role.PATIENT,
    },
  });
  patientBToken = generateTokens({
    id: patientBUser.id,
    email: patientBUser.email,
    role: patientBUser.role,
    name: patientBUser.name,
  }).accessToken;

  await prisma.patientProfile.create({
    data: {
      userId: patientBUser.id,
      bloodGroup: 'B_POSITIVE',
      consentEmergencySharing: false, // Consent revoked
    },
  });

  // 5. Seed Emergency Request for Patient A
  emergencyReqA = await prisma.emergencyRequest.create({
    data: {
      patientId: patientAUser.id,
      status: RequestStatus.AMBULANCE_ARRIVING,
      pickupLat: 21.1460,
      pickupLng: 79.0880,
      pickupAddress: 'Dharampeth, Nagpur, Maharashtra',
    },
  });

  // Seed Trip for Request A
  testTripA = await prisma.emergencyTrip.create({
    data: {
      requestId: emergencyReqA.id,
      ambulanceId: testAmbulance.id,
      driverId: driverUser.id,
      hospitalId: null, // Initially no destination hospital confirmed
      status: TripLifecycleStatus.AMBULANCE_ARRIVING,
      pickupLat: 21.1460,
      pickupLng: 79.0880,
      startedAt: new Date(),
    },
  });

  // 6. Seed Emergency Request for Patient B
  emergencyReqB = await prisma.emergencyRequest.create({
    data: {
      patientId: patientBUser.id,
      status: RequestStatus.PENDING,
      pickupLat: 21.1200,
      pickupLng: 79.0500,
      pickupAddress: 'Wardha Road, Nagpur',
    },
  });
});

after(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

// Helper for making authenticated or unauthenticated HTTP requests
async function makeRequest(
  method: string,
  path: string,
  body?: any,
  token?: string
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const reqHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      reqHeaders['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(
      url,
      {
        method,
        headers: reqHeaders,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          let parsed = {};
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = { raw: data };
          }
          resolve({ status: res.statusCode || 500, body: parsed });
        });
      }
    );

    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// -------------------------------------------------------------
// SECTION 1: TRUSTED CONTACTS VALIDATION & PHONE NUMBERS
// -------------------------------------------------------------

test('1.1 Phone Validation: Correctly normalizes Indian +91 numbers and valid international E.164 formats', () => {
  // Indian Numbers
  const indian1 = normalizeTrustedContactPhone('9876543210');
  assert.equal(indian1.isValid, true);
  assert.equal(indian1.normalized, '+919876543210');
  assert.equal(indian1.isInternational, false);

  const indian2 = normalizeTrustedContactPhone('+91 98765 43210');
  assert.equal(indian2.isValid, true);
  assert.equal(indian2.normalized, '+919876543210');

  const indian3 = normalizeTrustedContactPhone('09876543210');
  assert.equal(indian3.isValid, true);
  assert.equal(indian3.normalized, '+919876543210');

  // International Numbers
  const intlUS = normalizeTrustedContactPhone('+12025550199');
  assert.equal(intlUS.isValid, true);
  assert.equal(intlUS.normalized, '+12025550199');
  assert.equal(intlUS.isInternational, true);

  const intlUK = normalizeTrustedContactPhone('+447911123456');
  assert.equal(intlUK.isValid, true);
  assert.equal(intlUK.normalized, '+447911123456');
  assert.equal(intlUK.isInternational, true);
});

test('1.2 Phone Validation: Rejects malformed Indian numbers and invalid international formats', () => {
  // Invalid Indian starts with digit < 6
  const badStart = normalizeTrustedContactPhone('5551234567');
  assert.equal(badStart.isValid, false);
  assert.ok(badStart.error?.includes('start with 6, 7, 8, or 9'));

  // Invalid length
  const shortNum = normalizeTrustedContactPhone('98765');
  assert.equal(shortNum.isValid, false);

  // Missing plus on international
  const noPlusIntl = normalizeTrustedContactPhone('12025550199');
  assert.equal(noPlusIntl.isValid, false);

  // Non-numeric garbage
  const alphaNum = normalizeTrustedContactPhone('+91abcdefghij');
  assert.equal(alphaNum.isValid, false);
});

let addedContactA: any;
let addedContactIntl: any;

test('1.3 Add Trusted Contact: Rejects invalid phone number via HTTP API', async () => {
  const res = await makeRequest(
    'POST',
    '/api/emergency-contacts',
    {
      name: 'Rohan Sharma',
      phone: '3123456789', // Invalid Indian mobile prefix
      relation: 'Brother',
    },
    patientAToken
  );

  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'INVALID_PHONE_NUMBER');
});

test('1.4 Add Trusted Contact: Successfully adds Indian contact with isVerified=false default', async () => {
  const res = await makeRequest(
    'POST',
    '/api/emergency-contacts',
    {
      name: 'Sunita Verma',
      phone: '9876543210',
      email: 'sunita.verma@example.com',
      relation: 'Mother',
      canReceiveTripUpdates: true,
      notifyOnSos: true,
    },
    patientAToken
  );

  assert.equal(res.status, 201);
  assert.ok(res.body.id);
  assert.equal(res.body.phone, '+919876543210');
  assert.equal(res.body.isVerified, false, 'Never claim a phone number is verified without verification');
  assert.equal(res.body.verifiedAt, null);
  assert.equal(res.body.canReceiveTripUpdates, true);

  addedContactA = res.body;
});

test('1.5 Add Trusted Contact: Successfully adds international contact with isVerified=false', async () => {
  const res = await makeRequest(
    'POST',
    '/api/emergency-contacts',
    {
      name: 'Michael Scott',
      phone: '+12025550199',
      relation: 'Friend',
      canReceiveTripUpdates: true,
    },
    patientAToken
  );

  assert.equal(res.status, 201);
  assert.equal(res.body.phone, '+12025550199');
  assert.equal(res.body.isVerified, false);

  addedContactIntl = res.body;
});

test('1.6 Verification Integrity: Verify contact phone number via simulated zero-cost verification endpoint', async () => {
  const res = await makeRequest(
    'POST',
    `/api/emergency-contacts/${addedContactA.id}/verify`,
    { verificationCode: '123456' },
    patientAToken
  );

  assert.equal(res.status, 200);
  assert.equal(res.body.contact.isVerified, true);
  assert.ok(res.body.contact.verifiedAt);
});

test('1.7 Verification Integrity: Modifying contact phone resets isVerified back to false', async () => {
  const res = await makeRequest(
    'PUT',
    `/api/emergency-contacts/${addedContactA.id}`,
    { phone: '9876500000' },
    patientAToken
  );

  assert.equal(res.status, 200);
  assert.equal(res.body.phone, '+919876500000');
  assert.equal(res.body.isVerified, false, 'Verification must be reset when phone number changes');
  assert.equal(res.body.verifiedAt, null);
});

test('1.8 Capped at 3 Contacts: Adding a 4th contact is rejected', async () => {
  // Add 3rd contact
  const res3 = await makeRequest(
    'POST',
    '/api/emergency-contacts',
    {
      name: 'Kavita Verma',
      phone: '9822000003',
      relation: 'Sister',
    },
    patientAToken
  );
  assert.equal(res3.status, 201);

  // Attempt 4th contact
  const res4 = await makeRequest(
    'POST',
    '/api/emergency-contacts',
    {
      name: 'Excess Contact',
      phone: '9822000004',
      relation: 'Colleague',
    },
    patientAToken
  );
  assert.equal(res4.status, 400);
  assert.equal(res4.body.code, 'CONTACT_LIMIT_REACHED');
});

// -------------------------------------------------------------
// SECTION 2: CONSENT & ACCESS CONTROL FOR TRIP SHARING
// -------------------------------------------------------------

test('2.1 Consent Enforcement: Patient with emergency sharing consent disabled cannot create a trip share', async () => {
  const res = await makeRequest(
    'POST',
    '/api/v1/trip-share/session',
    {
      requestId: emergencyReqB.id,
      recipientName: 'Gaurav Deshmukh',
      recipientPhone: '+919822123456',
    },
    patientBToken
  );

  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'CONSENT_REVOKED');
});

test('2.2 Unauthorized Access: Non-owner cannot create a trip share for another patient emergency request', async () => {
  // Patient B tries to share Patient A's emergency request
  const res = await makeRequest(
    'POST',
    '/api/v1/trip-share/session',
    {
      requestId: emergencyReqA.id,
      recipientName: 'Intruder',
    },
    patientBToken
  );

  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'FORBIDDEN_REQUEST_OWNERSHIP');
});

let shareSessionA: any;

test('2.3 Create Trip Share: Patient A creates secure unguessable trip share session', async () => {
  const res = await makeRequest(
    'POST',
    '/api/v1/trip-share/session',
    {
      requestId: emergencyReqA.id,
      recipientName: 'Sunita Verma',
      recipientPhone: '+919876543210',
      allowLiveLocation: true,
      allowDestinationHospital: true,
      durationHours: 3,
    },
    patientAToken
  );

  assert.equal(res.status, 201);
  const share = res.body.share || res.body;
  assert.ok(share.shareToken);
  assert.equal(share.shareToken.length, 48, 'Token should be a 24-byte hex string (48 characters)');
  assert.equal(share.status, 'ACTIVE');
  assert.ok(share.trackingUrl.includes(share.shareToken));

  shareSessionA = share;
});

test('2.4 Unauthorized Access: Guessed or non-existent token returns HTTP 404', async () => {
  const fakeToken = '0123456789abcdef0123456789abcdef0123456789abcdef';
  const res = await makeRequest('GET', `/api/v1/trip-share/track/${fakeToken}`);

  assert.equal(res.status, 404);
  assert.equal(res.body.code, 'SHARE_TOKEN_NOT_FOUND');
});

// -------------------------------------------------------------
// SECTION 3: PRIVACY & MINIMAL DATA DISCLOSURE
// -------------------------------------------------------------

test('3.1 Privacy: Public tracking view exposes ZERO patient medical records and masked patient name', async () => {
  const res = await makeRequest('GET', `/api/v1/trip-share/track/${shareSessionA.shareToken}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ACTIVE_SHARE');
  // Masked name check: "Arjun Verma" -> "Arjun V."
  assert.equal(res.body.patientMaskedName, 'Arjun V.');

  // Verify ZERO medical records exposed
  assert.equal(res.body.bloodGroup, undefined);
  assert.equal(res.body.allergies, undefined);
  assert.equal(res.body.chronicConditions, undefined);
  assert.equal(res.body.medications, undefined);
  assert.equal(res.body.medicalId, undefined);

  // Verify driver personal PII is not exposed
  assert.equal(res.body.driverName, undefined);
  assert.equal(res.body.driverPhone, undefined);
  assert.ok(res.body.vehicle.vehicleNumber, 'Sanitized vehicle number is present');
});

test('3.2 Destination Hospital Secrecy: Hospital is hidden until assigned & confirmed', async () => {
  // Currently trip hospitalId is null
  const res = await makeRequest('GET', `/api/v1/trip-share/track/${shareSessionA.shareToken}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.destinationHospital, null, 'Destination hospital must be hidden before assignment');
  assert.ok(res.body.destinationNotice.includes('once assigned and confirmed'));
});

test('3.3 Destination Hospital Exposure: Disclosed only after dispatch confirms destination hospital', async () => {
  // Update trip with confirmed destination hospital
  await prisma.emergencyTrip.update({
    where: { id: testTripA.id },
    data: { hospitalId: testHospital.id },
  });

  const res = await makeRequest('GET', `/api/v1/trip-share/track/${shareSessionA.shareToken}`);

  assert.equal(res.status, 200);
  assert.ok(res.body.destinationHospital);
  assert.equal(res.body.destinationHospital.name, 'AIIMS Nagpur Trauma Center');
  assert.equal(res.body.destinationHospital.confirmed, true);
});

// -------------------------------------------------------------
// SECTION 4: LOCATION STALENESS & LIVE TRACKING SHUTOFF
// -------------------------------------------------------------

test('4.1 Location Freshness: Active ambulance has fresh GPS telemetry', async () => {
  await prisma.ambulance.update({
    where: { id: testAmbulance.id },
    data: {
      lastUpdated: new Date(),
      movementStatus: 'MOVING',
      speedKmH: 52,
    },
  });

  const res = await makeRequest('GET', `/api/v1/trip-share/track/${shareSessionA.shareToken}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.isLiveTrackingActive, true);
  assert.ok(res.body.liveLocation);
  assert.equal(res.body.liveLocation.isStale, false);
  assert.equal(res.body.liveLocation.stalenessWarning, null);
  assert.equal(res.body.liveLocation.speedKmH, 52);
});

test('4.2 Location Staleness: Telemetry older than 300 seconds is flagged as stale with warning notice', async () => {
  // Set lastUpdated to 10 minutes (600s) ago
  const staleTime = new Date(Date.now() - 600 * 1000);
  await prisma.ambulance.update({
    where: { id: testAmbulance.id },
    data: {
      lastUpdated: staleTime,
    },
  });

  const res = await makeRequest('GET', `/api/v1/trip-share/track/${shareSessionA.shareToken}`);

  assert.equal(res.status, 200);
  assert.ok(res.body.liveLocation);
  assert.equal(res.body.liveLocation.isStale, true);
  assert.ok(res.body.liveLocation.locationAgeSeconds >= 590);
  assert.ok(res.body.liveLocation.stalenessWarning?.includes('last updated more than 5 minutes ago'));
  assert.equal(res.body.liveLocation.movementStatus, 'UNKNOWN');
});

test('4.3 Live Location Shutoff: When trip is completed, live GPS coordinates are immediately terminated', async () => {
  // Mark trip and request as completed
  await prisma.emergencyTrip.update({
    where: { id: testTripA.id },
    data: {
      status: TripLifecycleStatus.COMPLETED,
      completedAt: new Date(),
    },
  });
  await prisma.emergencyRequest.update({
    where: { id: emergencyReqA.id },
    data: {
      status: RequestStatus.COMPLETED,
      completedAt: new Date(),
    },
  });

  const res = await makeRequest('GET', `/api/v1/trip-share/track/${shareSessionA.shareToken}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.tripStatus, 'COMPLETED');
  assert.equal(res.body.isLiveTrackingActive, false, 'Live tracking must shut off upon trip completion');
  assert.equal(res.body.liveLocation, null, 'Live location telemetry must be omitted upon trip completion');
  // Milestone should show completed
  const lastMilestone = res.body.milestones[res.body.milestones.length - 1];
  assert.equal(lastMilestone.milestone, 'COMPLETED');
  assert.equal(lastMilestone.completed, true);
});

// -------------------------------------------------------------
// SECTION 5: REVOCATION & EXPIRATION
// -------------------------------------------------------------

test('5.1 Revocation: Patient revokes trip share and subsequent access is immediately denied (HTTP 410)', async () => {
  // Patient A revokes shareSessionA
  const revokeRes = await makeRequest(
    'POST',
    '/api/v1/trip-share/revoke',
    {
      shareToken: shareSessionA.shareToken,
      reason: 'Patient arrived safely at family home',
    },
    patientAToken
  );

  assert.equal(revokeRes.status, 200);
  assert.equal(revokeRes.body.revokedCount, 1);

  // Attempting to track now returns HTTP 410
  const trackRes = await makeRequest('GET', `/api/v1/trip-share/track/${shareSessionA.shareToken}`);
  assert.equal(trackRes.status, 410);
  assert.equal(trackRes.body.code, 'SHARE_PERMISSION_REVOKED');
});

test('5.2 Expiration: Time-bounded trip share in the past returns HTTP 410 (SHARE_PERMISSION_EXPIRED)', async () => {
  // Create an already-expired trip share
  const expiredShare = await prisma.emergencyTripShare.create({
    data: {
      requestId: emergencyReqA.id,
      patientId: patientAUser.id,
      shareToken: 'abcdef1234567890abcdef1234567890abcdef1234567890',
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() - 3600 * 1000), // Expired 1 hour ago
      recipientName: 'Expired Session Contact',
    },
  });

  const res = await makeRequest('GET', `/api/v1/trip-share/track/${expiredShare.shareToken}`);

  assert.equal(res.status, 410);
  assert.equal(res.body.code, 'SHARE_PERMISSION_EXPIRED');
});

// -------------------------------------------------------------
// SECTION 6: NOTIFICATION DELIVERY STATES & OUTBOX INTEGRITY
// -------------------------------------------------------------

test('6.1 Notification States: Distinguishes QUEUED -> ATTEMPTED -> DELIVERED states without false delivery claims', async () => {
  // Dispatch an in-app notification
  const notifResult = await dispatchNotification({
    recipientId: patientAUser.id,
    recipientRole: Role.PATIENT,
    type: 'TRIP_SHARE_CREATED',
    title: 'Trip Tracking Link Created',
    message: 'Your emergency trip tracking link is active.',
    channel: NotificationChannel.IN_APP,
    priority: 'HIGH',
    data: { shareToken: shareSessionA.shareToken },
  });

  assert.equal(notifResult.delivered, true);
  assert.equal(notifResult.notification.status, NotificationStatus.DELIVERED);

  // Verify in database
  const fetched = await prisma.notification.findUnique({ where: { id: notifResult.notification.id } });
  assert.equal(fetched?.status, NotificationStatus.DELIVERED);
});

test('6.2 Notification SMS Carrier: Distinguishes delivery status and handles simulated carrier failures', async () => {
  // 1. Successful simulated SMS
  const successSms = await sendSMS(
    '+919876543210',
    'LifeLink Alert: Ambulance is en route.'
  );
  assert.equal(successSms.success, true);
  assert.equal(successSms.deliveryStatus, 'DELIVERED');

  // 2. Simulated Carrier Failure: Never claims delivered when carrier fails
  const failedSms = await sendSMS(
    '+919876543210',
    'LifeLink Alert: Ambulance is en route.',
    { simulateFailure: true }
  );
  assert.equal(failedSms.success, false);
  assert.equal(failedSms.deliveryStatus, 'FAILED');
  assert.ok(failedSms.error?.includes('Carrier delivery failed'));
});

// -------------------------------------------------------------
// SECTION 7: AUDIT TRAIL PERSISTENCE
// -------------------------------------------------------------

test('7.1 Audit Trail: Records permission changes, contact updates, and access logs', async () => {
  const auditLogs = await prisma.emergencyTripShareAuditLog.findMany({
    where: { patientId: patientAUser.id },
  });

  assert.ok(auditLogs.length >= 4);

  const actions = auditLogs.map((l: any) => l.action);
  assert.ok(actions.includes('TRUSTED_CONTACT_ADDED'), 'Should log contact added');
  assert.ok(actions.includes('TRUSTED_CONTACT_VERIFIED'), 'Should log contact verified');
  assert.ok(actions.includes('SHARE_CREATED'), 'Should log trip share created');
  assert.ok(actions.includes('SHARE_ACCESSED'), 'Should log trip share accessed');
  assert.ok(actions.includes('SHARE_REVOKED'), 'Should log trip share revoked');
});
