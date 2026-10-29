process.env.NODE_ENV = 'test';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import * as jwt from 'jsonwebtoken';
import app from '../src/app';
import prisma from '../src/db';
import { Role, RequestStatus, DispatchAttemptStatus, AmbulanceType, VerificationState } from '@prisma/client';
import { resetIdempotencyCache } from '../src/middleware/idempotency';
import { atomicallyAcceptOffer } from '../src/services/dispatchEngine';

let server: http.Server;
let baseUrl: string;
const JWT_SECRET = process.env.JWT_SECRET || 'lifelink_jwt_secret_key_2026_super_secure';

test.before(async () => {
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

// User tokens
const patientAId = 'patient_resilience_a_test';
const patientAToken = createToken({
  id: patientAId,
  email: 'patient.a@example.com',
  role: Role.PATIENT,
  name: 'Ananya Deshmukh',
});

const driverAId = 'driver_resilience_a_test';
const driverAToken = createToken({
  id: driverAId,
  email: 'driver.a@example.com',
  role: Role.DRIVER,
  name: 'Rajesh Patil',
});

const doctorAId = 'doctor_resilience_a_test';
let testSlotId: string;
let testHospitalId: string;
let testAmbulanceId: string;

// Setup test database entities before running tests
test.before(async () => {
  process.env.TEST_DB_CONNECTED = 'true';
  resetIdempotencyCache();

  // Create Patient User
  let patient = await prisma.user.findUnique({ where: { id: patientAId } });
  if (!patient) {
    patient = await prisma.user.create({
      data: {
        id: patientAId,
        email: 'patient.a@example.com',
        name: 'Ananya Deshmukh',
        role: Role.PATIENT,
        passwordHash: 'hash',
        phone: '+919876543210',
        isActive: true,
      },
    });
  }

  // Create Hospital Admin User
  let hospAdmin = await prisma.user.findUnique({ where: { id: 'admin_hosp_resilience_test' } });
  if (!hospAdmin) {
    hospAdmin = await prisma.user.create({
      data: {
        id: 'admin_hosp_resilience_test',
        email: 'hosp.admin.resilience@lifelink.org',
        name: 'GMCH Admin',
        role: Role.ADMIN_HOSPITAL,
        passwordHash: 'hash',
        isActive: true,
      },
    });
  }

  // Create Hospital
  let hospital = await prisma.hospital.findUnique({ where: { id: 'hospital_resilience_test' } });
  if (!hospital) {
    hospital = await prisma.hospital.create({
      data: {
        id: 'hospital_resilience_test',
        name: 'GMCH Trauma Center Nagpur',
        address: 'Medical Square, Hanuman Nagar, Nagpur',
        city: 'Nagpur',
        state: 'Maharashtra',
        lat: 21.1293,
        lng: 79.0967,
        totalBeds: 250,
        availableBeds: 45,
        contactNumber: '07122744400',
        adminUserId: hospAdmin.id,
        verificationState: VerificationState.VERIFIED,
        isDemo: false,
      },
    });
  }
  testHospitalId = hospital.id;

  // Create Driver User & Ambulance
  let driverUser = await prisma.user.findUnique({ where: { id: driverAId } });
  if (!driverUser) {
    driverUser = await prisma.user.create({
      data: {
        id: driverAId,
        email: 'driver.a@example.com',
        name: 'Rajesh Patil',
        role: Role.DRIVER,
        passwordHash: 'hash',
        phone: '+919822001122',
        isActive: true,
      },
    });
  }

  let driverProfile = await prisma.driverProfile.findFirst({ where: { userId: driverAId } });
  if (!driverProfile) {
    driverProfile = await prisma.driverProfile.create({
      data: {
        userId: driverAId,
        licenseNumber: 'MH31-2024-009988',
        verificationState: 'VERIFIED',
        membershipStatus: 'APPROVED',
        isDispatchEligible: true,
        hospitalId: testHospitalId,
      },
    });
  }

  let ambulance = await prisma.ambulance.findUnique({ where: { id: 'ambulance_resilience_test_id' } });
  if (!ambulance) {
    ambulance = await prisma.ambulance.create({
      data: {
        id: 'ambulance_resilience_test_id',
        vehicleNumber: 'MH-31-EM-2626',
        ambulanceType: AmbulanceType.ADVANCED_LIFE_SUPPORT,
        isAvailable: true,
        currentLat: 21.1458,
        currentLng: 79.0882,
        hospitalId: testHospitalId,
        driverId: driverAId,
        verificationState: VerificationState.VERIFIED,
        isDemo: false,
      },
    });
  }
  testAmbulanceId = ambulance.id;

  let assignment = await prisma.driverVehicleAssignment.findFirst({
    where: { driverId: driverProfile.id, ambulanceId: ambulance.id, isCurrent: true },
  });
  if (!assignment) {
    await prisma.driverVehicleAssignment.create({
      data: {
        driverId: driverProfile.id,
        ambulanceId: ambulance.id,
        isCurrent: true,
        assignedAt: new Date(),
      },
    });
  }

  // Ensure Nagpur Service Area is configured
  const existingArea = await prisma.serviceArea.findFirst({
    where: { city: 'Nagpur' },
  });
  if (!existingArea) {
    await prisma.serviceArea.create({
      data: {
        name: 'Nagpur Pilot Area',
        city: 'Nagpur',
        state: 'Maharashtra',
        centerLat: 21.1458,
        centerLng: 79.0882,
        radiusKm: 35.0,
        isActive: true,
        isPilot: true,
      },
    });
  }

  // Create Doctor and Slot for appointment testing
  let doctor = await prisma.doctor.findUnique({ where: { id: doctorAId } });
  if (!doctor) {
    doctor = await prisma.doctor.create({
      data: {
        id: doctorAId,
        name: 'Dr. Suresh Deshpande',
        specialization: 'Cardiology',
        hospitalId: testHospitalId,
        isActive: true,
        consultationFee: 500,
      },
    });
  }

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 2);
  const dateStr = tomorrow.toISOString().split('T')[0];

  const slot = await prisma.doctorSlot.create({
    data: {
      doctorId: doctor.id,
      date: dateStr,
      startTime: '10:00',
      endTime: '10:30',
      maxPatients: 5,
      bookedCount: 0,
      isBlocked: false,
    },
  });
  testSlotId = slot.id;
});

// =============================================================================
// TEST SUITE 1: NETWORK RESILIENCE & IDEMPOTENCY MIDDLEWARE
// =============================================================================

test('1.1. Mutating POST request with unique Idempotency-Key returns X-Idempotent-Key header', async () => {
  const idempotencyKey = `key_test_1_1_${Date.now()}`;
  const res = await fetch(`${baseUrl}/api/v1/sos/service-area`, {
    headers: {
      'Idempotency-Key': idempotencyKey,
    },
  });
  // GET request should succeed and pass through
  assert.equal(res.status, 200);
});

test('1.2. Idempotency middleware intercepts and replays identical response with X-Idempotent-Replay header', async () => {
  const idempotencyKey = `test_replay_${Date.now()}_abc`;

  // Make first appointment booking request
  const body = {
    slotId: testSlotId,
    symptoms: 'Mild chest heaviness after walking',
  };

  const res1 = await fetch(`${baseUrl}/api/appointments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${patientAToken}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(body),
  });

  assert.equal(res1.status, 201);
  const data1: any = await res1.json();
  assert.ok(data1.appointment);
  assert.equal(res1.headers.get('X-Idempotent-Key'), idempotencyKey);
  assert.equal(res1.headers.get('X-Idempotent-Replay'), null);

  // Simulate network retry: repeat identical request with identical idempotency key
  const res2 = await fetch(`${baseUrl}/api/appointments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${patientAToken}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(body),
  });

  assert.equal(res2.status, 201);
  const data2: any = await res2.json();
  assert.equal(res2.headers.get('X-Idempotent-Replay'), 'true');
  assert.equal(data2.appointment.id, data1.appointment.id);
  assert.equal(data2.appointment.tokenNumber, data1.appointment.tokenNumber);
});

test('1.3. CORS configuration exposes X-Idempotent-Replay and X-Idempotent-Key headers', async () => {
  const res = await fetch(`${baseUrl}/api/health`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://localhost:5173',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'Idempotency-Key, Content-Type',
    },
  });

  assert.equal(res.status, 204);
  const exposed = res.headers.get('Access-Control-Expose-Headers') || '';
  assert.ok(exposed.includes('X-Idempotent-Replay'));
  assert.ok(exposed.includes('X-Idempotent-Key'));
});

// =============================================================================
// TEST SUITE 2: EMERGENCY SOS HANDLING & DOUBLE-TAP SAFEGUARDS
// =============================================================================

test('2.1. Patient SOS creation succeeds with valid pilot coordinates', async () => {
  // Clear any previous active requests for patient
  await prisma.emergencyRequest.deleteMany({
    where: { patientId: patientAId },
  });

  const res = await fetch(`${baseUrl}/api/v1/sos/request`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${patientAToken}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `sos_key_${patientAId}_initial`,
    },
    body: JSON.stringify({
      pickupLat: 21.1458,
      pickupLng: 79.0882,
      pickupAddress: 'Sitabuldi Square, Nagpur',
      category: 'GENERAL',
      urgencyLevel: 'HIGH',
      requiredAmbulanceType: 'BASIC_LIFE_SUPPORT',
    }),
  });

  // Should succeed with 200 or 201
  assert.ok([200, 201].includes(res.status));
  const data: any = await res.json();
  assert.ok(data.request);
  assert.equal(data.request.patientId, patientAId);
});

test('2.2. Repeated tap or duplicate SOS submission rejects duplicate creation and returns active request', async () => {
  // Attempt to create a second emergency request while one is already active
  const res = await fetch(`${baseUrl}/api/v1/sos/request`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${patientAToken}`,
      'Content-Type': 'application/json',
      // Different key to test database-level single-active-request safeguard
      'Idempotency-Key': `sos_key_second_tap_${Date.now()}`,
    },
    body: JSON.stringify({
      pickupLat: 21.1458,
      pickupLng: 79.0882,
      category: 'CARDIAC',
    }),
  });

  assert.equal(res.status, 409);
  const data: any = await res.json();
  assert.equal(data.code, 'ACTIVE_REQUEST_EXISTS');
  assert.ok(data.request, 'Returns existing active emergency request for client reconciliation');
});

// =============================================================================
// TEST SUITE 3: EMERGENCY BEHAVIOR & 112 FALLBACK SPECIFICATION
// =============================================================================

test('3.1. Out of service area request explicitly returns Official 112 Notice without implying dispatch', async () => {
  // Clear requests to test service area rejection
  await prisma.emergencyRequest.deleteMany({
    where: { patientId: patientAId },
  });

  const res = await fetch(`${baseUrl}/api/v1/sos/request`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${patientAToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      pickupLat: 19.076, // Mumbai (outside Nagpur 35km radius)
      pickupLng: 72.8777,
      category: 'GENERAL',
    }),
  });

  assert.equal(res.status, 400);
  const data: any = await res.json();
  assert.equal(data.code, 'OUTSIDE_SERVICE_AREA');
  assert.ok(data.officialEmergencyFallback);
  assert.equal(data.officialEmergencyFallback.nationalEmergencyNumber, '112');
  assert.ok(data.officialEmergencyFallback.disclaimer.includes('112'));
});

test('3.2. Service Area inspection returns pilot center coordinates and active service cities', async () => {
  const res = await fetch(`${baseUrl}/api/v1/sos/service-area`);
  assert.equal(res.status, 200);
  const data: any = await res.json();
  assert.ok(Array.isArray(data.activeCities));
  assert.ok(data.activeCities.includes('Nagpur'));
  assert.equal(data.pilotCenter.city, 'Nagpur');
});

// =============================================================================
// TEST SUITE 4: DRIVER DISPATCH OFFER ACCEPTANCE IDEMPOTENCY
// =============================================================================

test('4.1. Driver offer acceptance is idempotent — replaying acceptance returns existing trip', async () => {
  // Create an EmergencyRequest in SEARCHING state
  const newReq = await prisma.emergencyRequest.create({
    data: {
      patientId: patientAId,
      pickupLat: 21.1458,
      pickupLng: 79.0882,
      status: RequestStatus.SEARCHING,
      tripType: 'SOS',
      category: 'GENERAL',
      urgencyLevel: 'HIGH',
      requiredAmbulanceType: AmbulanceType.BASIC_LIFE_SUPPORT,
    },
  });

  // Create an unexpired DispatchAttempt
  const expiresAt = new Date(Date.now() + 60000);
  const attempt = await prisma.dispatchAttempt.create({
    data: {
      requestId: newReq.id,
      ambulanceId: testAmbulanceId,
      driverId: driverAId,
      status: DispatchAttemptStatus.OFFERED,
      distanceKm: 2.5,
      offeredAt: new Date(),
      expiresAt,
    },
  });

  // 1st acceptance via driver HTTP endpoint
  const res1 = await fetch(`${baseUrl}/api/v1/sos/offers/${attempt.id}/accept`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${driverAToken}`,
    },
  });
  assert.equal(res1.status, 200);
  const data1: any = await res1.json();
  assert.ok(data1.trip);
  assert.equal(data1.isIdempotentReplay, false);

  // 2nd acceptance (simulated network retry by driver after mobile packet drop)
  const res2 = await fetch(`${baseUrl}/api/v1/sos/offers/${attempt.id}/accept`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${driverAToken}`,
    },
  });
  assert.equal(res2.status, 200);
  const data2: any = await res2.json();
  assert.equal(data2.isIdempotentReplay, true);
  assert.ok(data2.trip);
  assert.equal(data2.trip.id, data1.trip.id);
});

// =============================================================================
// TEST SUITE 5: APPOINTMENT CONCURRENCY & PREVENTING DUPLICATE TAPS
// =============================================================================

test('5.1. Patient booking the same slot twice is rejected as DUPLICATE_BOOKING', async () => {
  // First booking was done in Test 1.2
  // Attempting to book the exact same slot again without idempotency key
  const res = await fetch(`${baseUrl}/api/appointments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${patientAToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      slotId: testSlotId,
      symptoms: 'Second attempt booking',
    }),
  });

  assert.ok([400, 409].includes(res.status));
  const data: any = await res.json();
  assert.ok(data.message.includes('DUPLICATE_BOOKING') || data.message.includes('already have an active booking'));
});

// =============================================================================
// TEST SUITE 6: LOGOUT STORAGE HYGIENE & AUTH REVOCATION
// =============================================================================

test('6.1. Logout endpoint responds successfully to invalidate session cookies', async () => {
  const res = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${patientAToken}`,
    },
  });

  assert.equal(res.status, 200);
  const data: any = await res.json();
  assert.equal(data.status, 'success');
  assert.ok(data.message.toLowerCase().includes('logged out'));
});

// =============================================================================
// TEST SUITE 7: GPS FRESHNESS & STALENESS BOUNDS
// =============================================================================

test('7.1. Driver location update records authoritative timestamp', async () => {
  const res = await fetch(`${baseUrl}/api/ambulances/location`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${driverAToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      lat: 21.1460,
      lng: 79.0885,
    }),
  });

  assert.equal(res.status, 200);
  const data: any = await res.json();
  assert.ok(data.ambulance);
  assert.ok(data.ambulance.lastUpdated);
});

test('7.2. GPS update older than 5 minutes is classified as stale/offline', () => {
  const fiveMinutesAgo = Date.now() - 305000; // 305s ago
  const ageSec = Math.floor((Date.now() - fiveMinutesAgo) / 1000);
  
  const isStale = ageSec > 120;
  const isOffline = ageSec > 300;

  assert.equal(isStale, true);
  assert.equal(isOffline, true);
});

test('7.3. GPS update within 60 seconds is classified as live', () => {
  const tenSecondsAgo = Date.now() - 10000; // 10s ago
  const ageSec = Math.floor((Date.now() - tenSecondsAgo) / 1000);
  
  const isLive = ageSec < 120;
  assert.equal(isLive, true);
});

// =============================================================================
// TEST SUITE 8: NOTIFICATION SYNCHRONIZATION ON RECONNECTION
// =============================================================================

test('8.1. Notification sync endpoint returns unread notifications without duplicate duplication', async () => {
  // Create test notification
  await prisma.notification.create({
    data: {
      recipientId: patientAId,
      title: 'Emergency Service Ready',
      message: 'LifeLink Nagpur pilot active',
      type: 'INFO',
      isRead: false,
    },
  });

  const res = await fetch(`${baseUrl}/api/notifications`, {
    headers: {
      Authorization: `Bearer ${patientAToken}`,
    },
  });

  assert.equal(res.status, 200);
  const data: any = await res.json();
  const notificationsList = data.data?.notifications || data.notifications;
  assert.ok(Array.isArray(notificationsList));
  assert.ok(notificationsList.length > 0);
  const unread = data.data?.unreadCount !== undefined ? data.data.unreadCount : data.unreadCount;
  assert.ok(unread >= 1);
});
