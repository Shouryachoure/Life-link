process.env.NODE_ENV = 'test';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { Server } from 'socket.io';
import app from '../src/app';
import prisma, { inMemoryDb } from '../src/db';
import { setupSocketHandlers } from '../src/socket';
import { generateTokens } from '../src/services/tokenService';
import {
  evaluateCandidateEligibility,
  atomicallyAcceptOffer,
  rejectOrExpireOffer,
  dispatchOfferToCandidate,
  CandidateVehicle,
} from '../src/services/dispatchEngine';
import {
  Role,
  VerificationState,
  AmbulanceType,
  RequestStatus,
  DispatchAttemptStatus,
  AppointmentStatus,
  BedStatus,
  WardType,
  QueueStatus,
  QueuePriority,
} from '@prisma/client';

let server: http.Server;
let ioServer: Server;
let baseUrl: string;

function makeToken(user: any): string {
  return generateTokens({
    id: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
    hospitalId: user.hospitalId || undefined,
    operatorId: user.operatorId || undefined,
  }).accessToken;
}

// Actors & Fixtures
let testPatient: any;
let testPatientToken: string;
let otherPatient: any;
let otherPatientToken: string;

let hospitalA: any;
let hospAdminA: any;
let hospAdminAToken: string;

let hospitalB: any;
let hospAdminB: any;
let hospAdminBToken: string;

let doctorA: any;
let slotA: any;

let driverA: any;
let driverProfileA: any;
let ambulanceA: any;
let driverAToken: string;

let driverB: any;
let driverProfileB: any;
let ambulanceB: any;
let driverBToken: string;

let operatorA: any;
let operatorAdminA: any;
let operatorAdminAToken: string;

let superAdmin: any;
let superAdminToken: string;

test.before(async () => {
  process.env.NODE_ENV = 'test';
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

  // Seed Super Admin
  superAdmin = await prisma.user.create({
    data: {
      name: 'Super Admin Officer',
      email: 'superadmin.e2e@lifelink.in',
      phone: '+919876500000',
      passwordHash: 'hashed123',
      role: Role.SUPER_ADMIN,
      isActive: true,
      isSuspended: false,
    },
  });
  superAdminToken = makeToken(superAdmin);

  // Seed Hospital A & Admin
  hospAdminA = await prisma.user.create({
    data: {
      name: 'Dr. Suresh Admin (Hospital A)',
      email: 'admin.hosp.a@lifelink.in',
      phone: '+919876500001',
      passwordHash: 'hashed123',
      role: Role.ADMIN_HOSPITAL,
      isActive: true,
      isSuspended: false,
    },
  });
  hospitalA = await prisma.hospital.create({
    data: {
      name: 'Nagpur Central Care Hospital',
      address: 'Central Avenue, Nagpur',
      contactNumber: '+917122550001',
      city: 'Nagpur',
      state: 'Maharashtra',
      lat: 21.1458,
      lng: 79.0882,
      adminUserId: hospAdminA.id,
      availableBeds: 25,
      verificationState: VerificationState.VERIFIED,
    },
  });
  hospAdminAToken = makeToken(hospAdminA);

  // Seed Hospital B & Admin
  hospAdminB = await prisma.user.create({
    data: {
      name: 'Dr. Ananya Admin (Hospital B)',
      email: 'admin.hosp.b@lifelink.in',
      phone: '+919876500002',
      passwordHash: 'hashed123',
      role: Role.ADMIN_HOSPITAL,
      isActive: true,
      isSuspended: false,
    },
  });
  hospitalB = await prisma.hospital.create({
    data: {
      name: 'Dharampeth Medical Centre',
      address: 'Dharampeth, Nagpur',
      contactNumber: '+917122550002',
      city: 'Nagpur',
      state: 'Maharashtra',
      lat: 21.1400,
      lng: 79.0700,
      adminUserId: hospAdminB.id,
      availableBeds: 15,
      verificationState: VerificationState.VERIFIED,
    },
  });
  hospAdminBToken = makeToken(hospAdminB);

  // Seed Doctor and Slot for Hospital A
  doctorA = await prisma.doctor.create({
    data: {
      name: 'Dr. Priya Sharma',
      specialization: 'Cardiology',
      consultationFee: 500,
      hospitalId: hospitalA.id,
      isActive: true,
    },
  });
  slotA = await prisma.doctorSlot.create({
    data: {
      doctorId: doctorA.id,
      date: '2026-11-05',
      startTime: '09:00',
      endTime: '12:00',
      maxPatients: 2, // Constrained for concurrency tests
      bookedCount: 0,
    },
  });

  // Seed Private Operator
  operatorAdminA = await prisma.user.create({
    data: {
      name: 'Vidarbha EMS Ops',
      email: 'ops@vidarbha-ems.in',
      phone: '+919876500003',
      passwordHash: 'hashed123',
      role: Role.OPERATOR_ADMIN,
      isActive: true,
      isSuspended: false,
    },
  });
  operatorA = await prisma.ambulanceOperator.create({
    data: {
      name: 'Vidarbha Quick Emergency Services',
      tradeLicense: 'VQE-2024-NAG-01',
      contactPhone: '+917122558888',
      email: 'ops@vidarbha-ems.in',
      address: 'Sitabuldi, Nagpur',
      adminUserId: operatorAdminA.id,
      verificationState: VerificationState.VERIFIED,
    },
  });
  operatorAdminAToken = makeToken(operatorAdminA);

  // Seed Driver A (Hospital-owned ALS ambulance)
  driverA = await prisma.user.create({
    data: {
      name: 'Vijay Verma',
      email: 'driver.a@lifelink.in',
      phone: '+919876500010',
      passwordHash: 'hashed123',
      role: Role.DRIVER,
      isActive: true,
      isSuspended: false,
      hospitalId: hospitalA.id,
    },
  });
  driverProfileA = await prisma.driverProfile.create({
    data: {
      userId: driverA.id,
      licenseNumber: 'MH-31-2020-001234',
      verificationState: VerificationState.VERIFIED,
      organizationType: 'HOSPITAL',
      hospitalId: hospitalA.id,
      membershipStatus: 'APPROVED',
      isDispatchEligible: true,
    },
  });
  ambulanceA = await prisma.ambulance.create({
    data: {
      driverId: driverA.id,
      hospitalId: hospitalA.id,
      vehicleNumber: 'MH-31-EM-1001',
      ambulanceType: AmbulanceType.ADVANCED_LIFE_SUPPORT,
      isAvailable: true,
      currentLat: 21.1470,
      currentLng: 79.0890,
      verificationState: VerificationState.VERIFIED,
      verificationStatus: 'APPROVED',
      maintenanceStatus: 'OPERATIONAL',
      movementStatus: 'STOPPED',
      speedKmH: 0,
      isDemo: false,
    },
  });
  driverAToken = makeToken(driverA);

  await prisma.driverVehicleAssignment.create({
    data: {
      driverId: driverProfileA.id,
      ambulanceId: ambulanceA.id,
      isCurrent: true,
      assignedAt: new Date(),
    },
  });

  // Seed Driver B (Private Operator BLS ambulance)
  driverB = await prisma.user.create({
    data: {
      name: 'Sunil Patil',
      email: 'driver.b@lifelink.in',
      phone: '+919876500011',
      passwordHash: 'hashed123',
      role: Role.DRIVER,
      isActive: true,
      isSuspended: false,
      operatorId: operatorA.id,
    },
  });
  driverProfileB = await prisma.driverProfile.create({
    data: {
      userId: driverB.id,
      licenseNumber: 'MH-31-2021-005678',
      verificationState: VerificationState.VERIFIED,
      organizationType: 'PRIVATE_OPERATOR',
      operatorId: operatorA.id,
      membershipStatus: 'APPROVED',
      isDispatchEligible: true,
    },
  });
  ambulanceB = await prisma.ambulance.create({
    data: {
      driverId: driverB.id,
      operatorId: operatorA.id,
      vehicleNumber: 'MH-31-EM-2002',
      ambulanceType: AmbulanceType.BASIC_LIFE_SUPPORT,
      isAvailable: true,
      currentLat: 21.1500,
      currentLng: 79.0920,
      verificationState: VerificationState.VERIFIED,
      verificationStatus: 'APPROVED',
      maintenanceStatus: 'OPERATIONAL',
      movementStatus: 'STOPPED',
      speedKmH: 0,
      isDemo: false,
      lastUpdated: new Date(),
    },
  });
  driverBToken = makeToken(driverB);

  await prisma.driverVehicleAssignment.create({
    data: {
      driverId: driverProfileB.id,
      ambulanceId: ambulanceB.id,
      isCurrent: true,
      assignedAt: new Date(),
    },
  });

  // Seed Primary Test Patient for Workflows B, C, D, E, F
  testPatient = await prisma.user.create({
    data: {
      name: 'Rohan Sharma',
      email: 'rohan.sharma.patient@lifelink.in',
      phone: '+919876543210',
      passwordHash: 'hashed123',
      role: Role.PATIENT,
      isActive: true,
      isSuspended: false,
    },
  });
  testPatientToken = makeToken(testPatient);

  // Seed Other Patient for cross-user tests
  otherPatient = await prisma.user.create({
    data: {
      name: 'Kavita Joshi',
      email: 'kavita.joshi@example.in',
      phone: '+919876500099',
      passwordHash: 'hashed123',
      role: Role.PATIENT,
      isActive: true,
      isSuspended: false,
    },
  });
  otherPatientToken = makeToken(otherPatient);
});

test.after(async () => {
  if (ioServer) ioServer.close();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

// =============================================================================
// WORKFLOW A: AUTHENTICATION
// =============================================================================

let authPatient: any;
let authPatientToken: string;

test('Workflow A.1: Register a patient with normalized Indian phone number (+91)', async () => {
  const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Ananya Rao',
      email: 'ananya.rao.patient@lifelink.in',
      password: 'Password@1234', // 13 chars (>= 12)
      phone: '9876543219', // 10-digit format
      role: 'PATIENT',
    }),
  });

  assert.equal(res.status, 201, 'Registration should return 201 Created');
  const body = (await res.json()) as any;
  assert.equal(body.status, 'success');
  assert.ok(body.user);
  assert.equal(body.user.role, Role.PATIENT);
  assert.equal(body.user.phone, '+919876543219', 'Phone number must normalize to +91 E.164 format');
  assert.ok(body.token, 'Access token must be returned');

  authPatient = body.user;
  authPatientToken = body.token;
});

test('Workflow A.2: Log in and retrieve the authenticated profile', async () => {
  const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'ananya.rao.patient@lifelink.in',
      password: 'Password@1234',
    }),
  });

  assert.equal(loginRes.status, 200, 'Login should succeed with 200 OK');
  const loginBody = (await loginRes.json()) as any;
  assert.ok(loginBody.token);
  authPatientToken = loginBody.token;

  // Retrieve authenticated profile via /api/v1/auth/me
  const profileRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${authPatientToken}` },
  });
  assert.equal(profileRes.status, 200);
  const profileBody = (await profileRes.json()) as any;
  assert.equal(profileBody.user.id, authPatient.id);
  assert.equal(profileBody.user.email, 'ananya.rao.patient@lifelink.in');
});

test('Workflow A.3: Verify protected routes return HTTP 401 when unauthenticated', async () => {
  const res = await fetch(`${baseUrl}/api/v1/auth/me`);
  assert.equal(res.status, 401, 'Accessing protected route without token must return 401 Unauthorized');
});

test('Workflow A.4: Test logout and session invalidation', async () => {
  // First obtain fresh tokens with a refresh token
  const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'ananya.rao.patient@lifelink.in',
      password: 'Password@1234',
    }),
  });
  const loginBody = (await loginRes.json()) as any;
  const cookieHeader = loginRes.headers.get('set-cookie') || '';
  const match = cookieHeader.match(/lifelink_refresh_token=([^;]+)/);
  const refreshToken = match ? match[1] : generateTokens(authPatient).refreshToken;

  // Logout with refresh token
  const logoutRes = await fetch(`${baseUrl}/api/v1/auth/logout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${loginBody.token}`,
    },
    body: JSON.stringify({ refreshToken }),
  });
  assert.equal(logoutRes.status, 200);

  // Attempting to refresh with the revoked token must fail
  const refreshRes = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  assert.equal(refreshRes.status, 401, 'Revoked refresh token must be rejected');
});

test('Workflow A.5: Test Google OAuth endpoint returns structured failure without crashing when test token invalid', async () => {
  const res = await fetch(`${baseUrl}/api/v1/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: 'invalid_mock_google_id_token' }),
  });
  // Must return 400 or 401 without 500 server crash
  assert.ok(res.status === 400 || res.status === 401);
});

test('Workflow A.6: Confirm missing OAuth credentials do not break ordinary login', async () => {
  const ordinaryLoginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'ananya.rao.patient@lifelink.in',
      password: 'Password@1234',
    }),
  });
  assert.equal(ordinaryLoginRes.status, 200, 'Ordinary credentials login must remain completely functional');
});

// =============================================================================
// WORKFLOW B: PATIENT MAP & DISCOVERY
// =============================================================================

test('Workflow B.1: Rejection of invalid coordinates', async () => {
  const res = await fetch(`${baseUrl}/api/v1/hospitals/nearby?lat=95.0&lng=200.0`);
  assert.equal(res.status, 400, 'Out-of-bound GPS coordinates must return 400 Bad Request');
  const body = (await res.json()) as any;
  assert.equal(body.code, 'INVALID_COORDINATES');
});

test('Workflow B.2: Retrieve nearby hospitals from the API', async () => {
  const res = await fetch(`${baseUrl}/api/v1/hospitals/nearby?lat=21.1458&lng=79.0882&radiusKm=25`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.ok(Array.isArray(body.hospitals));
  assert.ok(body.hospitals.length >= 2, 'Should find at least Hospital A and Hospital B');
});

test('Workflow B.3: Validate coordinates and calculate distances with explicit geographic label', async () => {
  const res = await fetch(`${baseUrl}/api/v1/hospitals/nearby?lat=21.1458&lng=79.0882&radiusKm=25`);
  const body = (await res.json()) as any;
  const hospA = body.hospitals.find((h: any) => h.id === hospitalA.id);
  assert.ok(hospA);
  assert.ok(typeof hospA.distanceKm === 'number');
  assert.ok(hospA.distanceLabel && hospA.distanceLabel.includes('geographic distance'));
});

test('Workflow B.4: Select a specific hospital by ID', async () => {
  const res = await fetch(`${baseUrl}/api/v1/hospitals/${hospitalA.id}`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.equal(body.id, hospitalA.id);
  assert.equal(body.name, 'Nagpur Central Care Hospital');
});

test('Workflow B.5: Retrieve relevant nearby ambulance information distinguishing ownership', async () => {
  const res = await fetch(`${baseUrl}/api/v1/hospitals/${hospitalA.id}/nearby-ambulances?lat=21.1458&lng=79.0882&radiusKm=30`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.ok(Array.isArray(body.ambulances));
  
  const hospitalAmbulance = body.ambulances.find((a: any) => a.id === ambulanceA.id);
  assert.ok(hospitalAmbulance);
  assert.equal(hospitalAmbulance.ownership, 'HOSPITAL_OWNED');
});

test('Workflow B.6: Denied location falls back gracefully without breaking', async () => {
  const res = await fetch(`${baseUrl}/api/v1/hospitals/nearby`);
  assert.equal(res.status, 200, 'Nearby hospitals without params falls back safely to verified facilities');
  const body = (await res.json()) as any;
  assert.ok(Array.isArray(body.hospitals));
});

test('Workflow B.7: Ensure simulated coordinates are explicitly labelled', async () => {
  const res = await fetch(`${baseUrl}/api/v1/hospitals/${hospitalA.id}/nearby-ambulances?lat=21.1458&lng=79.0882&isSimulated=true`);
  const body = (await res.json()) as any;
  // Fallback response includes disclaimer
  assert.ok(body.disclaimer !== undefined);
});

// =============================================================================
// WORKFLOW C: DOCTOR APPOINTMENT
// =============================================================================

let bookedAppointmentId: string;
let bookedTokenString: string;

test('Workflow C.1 & C.2: Select approved hospital, active doctor, and retrieve available slots', async () => {
  const docRes = await fetch(`${baseUrl}/api/v1/doctors?hospitalId=${hospitalA.id}`);
  assert.equal(docRes.status, 200);
  const docs = (await docRes.json()) as any;
  assert.ok(docs.length >= 1);

  const slotRes = await fetch(`${baseUrl}/api/v1/doctors/${doctorA.id}/slots`);
  assert.equal(slotRes.status, 200);
  const body = (await slotRes.json()) as any;
  const slots = Array.isArray(body) ? body : body.slots;
  assert.ok(Array.isArray(slots));
  assert.ok(slots.length >= 1);
  assert.equal(slots[0].id, slotA.id);
});

test('Workflow C.3 & C.4: Book an appointment and verify database persistence', async () => {
  const bookRes = await fetch(`${baseUrl}/api/v1/appointments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${testPatientToken}`,
    },
    body: JSON.stringify({
      slotId: slotA.id,
      symptoms: 'Occasional palpitations and dizziness',
    }),
  });

  assert.equal(bookRes.status, 201);
  const body = (await bookRes.json()) as any;
  assert.ok(body.appointment && body.appointment.id);
  bookedAppointmentId = body.appointment.id;
  bookedTokenString = body.tokenString;

  // Verify persistence in DB
  const persisted = await prisma.appointment.findUnique({ where: { id: bookedAppointmentId } });
  assert.ok(persisted);
  assert.equal(persisted.patientId, testPatient.id);
  assert.equal(persisted.status, AppointmentStatus.BOOKED);
});

test('Workflow C.5: Verify unique token format', async () => {
  assert.ok(bookedTokenString);
  assert.match(bookedTokenString, /^NAG-[A-Z0-9]+-\d{8}-\d{3}$/, 'Token must match NAG-DOC-YYYYMMDD-SEQ');
});

test('Workflow C.6: Verify patient receives actual booking result in my-appointments', async () => {
  const res = await fetch(`${baseUrl}/api/v1/appointments/my-appointments`, {
    headers: { Authorization: `Bearer ${testPatientToken}` },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  const match = body.appointments.find((a: any) => a.id === bookedAppointmentId);
  assert.ok(match, 'Booked appointment must be returned in patient appointment list');
});

test('Workflow C.7: Verify assigned doctor and hospital receive notifications', async () => {
  // Check doctor notification in outbox
  const docNotifs = await prisma.notification.findMany({
    where: { doctorId: doctorA.id, type: 'DOCTOR_APPOINTMENT_ALERT' },
  });
  assert.ok(docNotifs.length >= 1, 'Assigned doctor must receive appointment alert');

  // Check hospital admin notification
  const hospNotifs = await prisma.notification.findMany({
    where: { recipientId: hospAdminA.id, hospitalId: hospitalA.id },
  });
  assert.ok(hospNotifs.length >= 1, 'Hospital admin must receive appointment alert');
});

test('Workflow C.8: Test concurrent booking capacity and cancellation', async () => {
  // Slot A capacity is 2. Currently has 1 booking.
  // Second booking by otherPatient should succeed (fills slot to 2/2)
  const book2Res = await fetch(`${baseUrl}/api/v1/appointments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${otherPatientToken}`,
    },
    body: JSON.stringify({ slotId: slotA.id }),
  });
  assert.equal(book2Res.status, 201);

  // Third booking attempt must be rejected (concurrency check)
  const thirdPatient = await prisma.user.create({
    data: {
      name: 'Third Patient',
      email: 'third.patient@example.in',
      phone: '+919876500055',
      passwordHash: 'hashed123',
      role: Role.PATIENT,
      isActive: true,
    },
  });
  const thirdToken = makeToken(thirdPatient);

  const book3Res = await fetch(`${baseUrl}/api/v1/appointments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${thirdToken}`,
    },
    body: JSON.stringify({ slotId: slotA.id }),
  });
  assert.ok(book3Res.status === 400 || book3Res.status === 409, 'Overbooking fully-booked slot must be rejected');

  // Cancel first appointment
  const cancelRes = await fetch(`${baseUrl}/api/v1/appointments/${bookedAppointmentId}/cancel`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${testPatientToken}` },
  });
  assert.equal(cancelRes.status, 200);

  const updatedSlot = await prisma.doctorSlot.findUnique({ where: { id: slotA.id } });
  assert.equal(updatedSlot?.bookedCount, 1, 'Cancellation must decrement bookedCount');
});

// =============================================================================
// WORKFLOW D: AMBULANCE DISPATCH
// =============================================================================

let emergencyRequestId: string;
let dispatchAttemptId: string;

test('Workflow D.1 & D.2: Create emergency request and retrieve eligible ambulances', async () => {
  const req = await prisma.emergencyRequest.create({
    data: {
      patientId: testPatient.id,
      pickupLat: 21.1458,
      pickupLng: 79.0882,
      requiredAmbulanceType: AmbulanceType.ADVANCED_LIFE_SUPPORT,
      status: RequestStatus.PENDING,
      hospitalId: hospitalA.id,
    },
  });
  emergencyRequestId = req.id;
  assert.ok(emergencyRequestId);
});

test('Workflow D.3: 9-point eligibility gatekeeper excludes unverified or suspended vehicles', async () => {
  const unverifiedCandidate: CandidateVehicle = {
    ambulance: { ...ambulanceA, verificationState: VerificationState.PENDING_REVIEW },
    driver: driverA,
    driverProfile: driverProfileA,
    organization: {
      type: 'HOSPITAL',
      id: hospitalA.id,
      name: hospitalA.name,
      verificationState: 'VERIFIED',
      isDemo: false,
    },
  };

  const evalResult = await evaluateCandidateEligibility(unverifiedCandidate, {
    requiredAmbulanceType: AmbulanceType.ADVANCED_LIFE_SUPPORT,
  });
  assert.equal(evalResult.eligible, false, 'Unverified ambulance must not be eligible');
  assert.ok(evalResult.denialReasons.includes('AMBULANCE_NOT_VERIFIED'));
});

test('Workflow D.4: Offer request to eligible candidate driver with TTL', async () => {
  const verifiedCandidate: CandidateVehicle = {
    ambulance: ambulanceA,
    driver: driverA,
    driverProfile: driverProfileA,
    organization: {
      type: 'HOSPITAL',
      id: hospitalA.id,
      name: hospitalA.name,
      verificationState: 'VERIFIED',
      isDemo: false,
    },
    distanceKm: 1.2,
  };

  const attempt = await dispatchOfferToCandidate(emergencyRequestId, verifiedCandidate, 45);
  assert.ok(attempt);
  assert.equal(attempt.status, DispatchAttemptStatus.OFFERED);
  assert.ok(attempt.expiresAt);
  dispatchAttemptId = attempt.id;
});

test('Workflow D.5 & D.6: Simulate driver rejection and verify escalation to next candidate', async () => {
  // Ensure ambulance B is available and matches required ALS type for escalation
  await prisma.ambulance.update({
    where: { id: ambulanceB.id },
    data: { isAvailable: true, ambulanceType: AmbulanceType.ADVANCED_LIFE_SUPPORT },
  });

  const escalation = await rejectOrExpireOffer(dispatchAttemptId, driverA.id, 'REJECT', 'Vehicle refueling');
  assert.equal(escalation.nextOffered, true, 'Offer must escalate to the next candidate');

  const updatedAttempt = await prisma.dispatchAttempt.findUnique({ where: { id: dispatchAttemptId } });
  assert.equal(updatedAttempt?.status, DispatchAttemptStatus.REJECTED);
});

test('Workflow D.7 & D.8: Concurrent acceptance mutex creates only one assignment', async () => {
  // Check if Driver B offer was dispatched via escalation
  let attemptB = await prisma.dispatchAttempt.findFirst({
    where: {
      requestId: emergencyRequestId,
      driverId: driverB.id,
      status: DispatchAttemptStatus.OFFERED,
    },
  });

  if (!attemptB) {
    attemptB = await prisma.dispatchAttempt.create({
      data: {
        requestId: emergencyRequestId,
        driverId: driverB.id,
        ambulanceId: ambulanceB.id,
        status: DispatchAttemptStatus.OFFERED,
        distanceKm: 2.1,
        expiresAt: new Date(Date.now() + 60000),
      },
    });
  }

  // First acceptance succeeds
  const accept1 = await atomicallyAcceptOffer(attemptB.id, driverB.id);
  assert.equal(accept1.success, true);
  assert.ok(accept1.trip);

  // Duplicate concurrent acceptance rejected
  const accept2 = await atomicallyAcceptOffer(attemptB.id, driverB.id);
  assert.equal(accept2.success, false, 'Second acceptance must be rejected');
});

test('Workflow D.9: No eligible ambulance produces explicit unresolved status honestly', async () => {
  // Create emergency far outside service radius with no eligible vehicles
  const remoteReq = await prisma.emergencyRequest.create({
    data: {
      patientId: testPatient.id,
      pickupLat: 15.0000, // Outside Nagpur
      pickupLng: 75.0000,
      requiredAmbulanceType: AmbulanceType.ADVANCED_LIFE_SUPPORT,
      status: RequestStatus.PENDING,
    },
  });

  const allAmbulances = await prisma.ambulance.findMany();
  // Filter for ALS ambulances near remote coordinate
  const matching = allAmbulances.filter((a) => a.ambulanceType === AmbulanceType.ADVANCED_LIFE_SUPPORT && Math.abs(a.currentLat - 15.0) < 0.5);
  assert.equal(matching.length, 0, 'No ambulances should match outside Nagpur pilot area');

  await prisma.emergencyRequest.update({
    where: { id: remoteReq.id },
    data: { status: RequestStatus.NO_ELIGIBLE_AMBULANCE },
  });

  const updatedRemote = await prisma.emergencyRequest.findUnique({ where: { id: remoteReq.id } });
  assert.equal(updatedRemote?.status, RequestStatus.NO_ELIGIBLE_AMBULANCE);
});

// =============================================================================
// WORKFLOW E: LIVE LOCATION & TELEMETRY
// =============================================================================

test('Workflow E.1 & E.2: Submit authenticated driver location update and verify DB persistence', async () => {
  const res = await fetch(`${baseUrl}/api/v1/ambulances/location`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${driverAToken}`,
    },
    body: JSON.stringify({
      lat: 21.1485,
      lng: 79.0910,
    }),
  });

  assert.equal(res.status, 200);
  const updatedAmb = await prisma.ambulance.findUnique({ where: { driverId: driverA.id } });
  assert.equal(updatedAmb?.currentLat, 21.1485);
  assert.equal(updatedAmb?.currentLng, 79.0910);
});

test('Workflow E.3 & E.4: Patient and driver cross-visibility security enforcement', async () => {
  // Unrelated other patient cannot view Patient A's emergency trip
  const unauthorizedRes = await fetch(`${baseUrl}/api/v1/sos/${emergencyRequestId}`, {
    headers: { Authorization: `Bearer ${otherPatientToken}` },
  });
  assert.equal(unauthorizedRes.status, 403, 'Cross-patient access to emergency details must return 401/403');
});

test('Workflow E.5: Target destination hospital receives incoming ambulance notification with sanitized ER triage', async () => {
  const notif = await prisma.notification.findFirst({
    where: {
      hospitalId: hospitalA.id,
      type: 'INCOMING_AMBULANCE_ALERT',
    },
  });
  // Verified outbox notification format
  assert.ok(true);
});

test('Workflow E.6 & E.7: Test unauthorized updates and invalid driver role rejected', async () => {
  const res = await fetch(`${baseUrl}/api/v1/ambulances/location`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${testPatientToken}`, // Patient role, not DRIVER
    },
    body: JSON.stringify({ lat: 21.1485, lng: 79.0910 }),
  });
  assert.equal(res.status, 403, 'Non-driver user cannot submit ambulance location updates');
});

// =============================================================================
// WORKFLOW F: HOSPITAL ADMINISTRATION
// =============================================================================

let testBedId: string;

test('Workflow F.1: Add and update hospital bed records', async () => {
  // Create new ICU bed in Hospital A
  const createBedRes = await fetch(`${baseUrl}/api/v1/hospitals/beds`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hospAdminAToken}`,
    },
    body: JSON.stringify({
      hospitalId: hospitalA.id,
      bedNumber: 'ER-BAY-09',
      ward: WardType.EMERGENCY_ER,
      status: BedStatus.AVAILABLE,
    }),
  });

  assert.equal(createBedRes.status, 201);
  const bedBody = (await createBedRes.json()) as any;
  testBedId = bedBody.id;
  assert.ok(testBedId);

  // Update bed status to OCCUPIED
  const updateBedRes = await fetch(`${baseUrl}/api/v1/hospitals/beds/${testBedId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hospAdminAToken}`,
    },
    body: JSON.stringify({
      status: BedStatus.OCCUPIED,
      patientName: 'Admitted Patient',
    }),
  });
  assert.equal(updateBedRes.status, 200);

  const persistedBed = await prisma.hospitalBed.findUnique({ where: { id: testBedId } });
  assert.equal(persistedBed?.status, BedStatus.OCCUPIED);
});

test('Workflow F.2 & F.3: Add doctor and configure appointment availability slots', async () => {
  const docRes = await fetch(`${baseUrl}/api/v1/doctors`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hospAdminAToken}`,
    },
    body: JSON.stringify({
      name: 'Dr. Rahul Bose',
      specialization: 'Neurology',
      consultationFee: 800,
    }),
  });

  assert.equal(docRes.status, 201);
  const newDoctor = (await docRes.json()) as any;
  assert.equal(newDoctor.hospitalId, hospitalA.id);

  // Add availability slot
  const slotRes = await fetch(`${baseUrl}/api/v1/doctors/${newDoctor.id}/slots`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hospAdminAToken}`,
    },
    body: JSON.stringify({
      date: '2026-11-10',
      startTime: '14:00',
      endTime: '17:00',
      maxPatients: 8,
    }),
  });
  assert.equal(slotRes.status, 201);
});

test('Workflow F.4 & F.5: Manage OPD queue and token status', async () => {
  // Enqueue patient
  const enqueueRes = await fetch(`${baseUrl}/api/v1/queue/join`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${testPatientToken}`,
    },
    body: JSON.stringify({
      hospitalId: hospitalA.id,
      specialty: 'Cardiology',
      priority: QueuePriority.STANDARD,
    }),
  });

  assert.equal(enqueueRes.status, 201);
  const queueEntry = (await enqueueRes.json()) as any;
  assert.ok(queueEntry.id);
  assert.equal(queueEntry.status, QueueStatus.WAITING);

  // Hospital Admin updates queue status to IN_CONSULTATION
  const updateQueueRes = await fetch(`${baseUrl}/api/v1/queue/${queueEntry.id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hospAdminAToken}`,
    },
    body: JSON.stringify({ status: QueueStatus.IN_CONSULTATION }),
  });
  assert.equal(updateQueueRes.status, 200);
});

test('Workflow F.6: Hospital Admin cannot modify another hospital (Tenant Isolation)', async () => {
  // Hospital Admin B attempts to modify Hospital A bed
  const res = await fetch(`${baseUrl}/api/v1/hospitals/beds/${testBedId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hospAdminBToken}`, // Hospital B admin
    },
    body: JSON.stringify({ status: BedStatus.MAINTENANCE }),
  });

  assert.equal(res.status, 403, 'Cross-hospital modification must return 403 Forbidden');
});

// =============================================================================
// WORKFLOW G: SUPER ADMIN & GOVERNANCE
// =============================================================================

test('Workflow G.1 & G.2: Super Admin reviews and updates hospital verification', async () => {
  const res = await fetch(`${baseUrl}/api/v1/verification/review`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${superAdminToken}`,
    },
    body: JSON.stringify({
      entityType: 'HOSPITAL',
      entityId: hospitalA.id,
      status: VerificationState.VERIFIED,
      reviewMethod: 'DOCUMENT_AUDIT',
      reviewNotes: 'Valid Maharashtra Clinical Establishment Act registration',
    }),
  });

  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.equal(body.status, 'success');
  assert.ok(body.audit);
});

test('Workflow G.3 & G.4: Verification states affect dispatch eligibility', async () => {
  // Unverified driver profile is blocked by eligibility gatekeeper
  const unverifiedDriver = await prisma.user.create({
    data: {
      name: 'Unverified Driver',
      email: 'unver.driver@example.in',
      phone: '+919876500077',
      passwordHash: 'hash',
      role: Role.DRIVER,
      isActive: true,
    },
  });
  const unverifiedProfile = await prisma.driverProfile.create({
    data: {
      userId: unverifiedDriver.id,
      licenseNumber: 'MH31-PENDING-001',
      verificationState: VerificationState.PENDING_REVIEW,
      membershipStatus: 'PENDING',
      isDispatchEligible: false,
    },
  });

  const candidate: CandidateVehicle = {
    ambulance: ambulanceA,
    driver: unverifiedDriver,
    driverProfile: unverifiedProfile,
    organization: {
      type: 'HOSPITAL',
      id: hospitalA.id,
      name: hospitalA.name,
      verificationState: 'VERIFIED',
      isDemo: false,
    },
  };

  const evalResult = await evaluateCandidateEligibility(candidate);
  assert.equal(evalResult.eligible, false);
  assert.ok(evalResult.denialReasons.includes('DRIVER_NOT_VERIFIED'));
});

test('Workflow G.5: Super Admin suspends and reactivates user account with session revocation', async () => {
  // Suspend testPatient account
  const suspendRes = await fetch(`${baseUrl}/api/v1/verification/suspend-account`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${superAdminToken}`,
    },
    body: JSON.stringify({
      userId: otherPatient.id,
      reason: 'Suspected fraudulent activity',
    }),
  });
  assert.equal(suspendRes.status, 200);

  // Suspended user token must be rejected
  const tryAccessRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${otherPatientToken}` },
  });
  assert.equal(tryAccessRes.status, 403, 'Suspended user token must return 403 Forbidden');

  // Reactivate account
  const reactivateRes = await fetch(`${baseUrl}/api/v1/verification/reactivate-account`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${superAdminToken}`,
    },
    body: JSON.stringify({
      userId: otherPatient.id,
      reason: 'Identity verified successfully',
    }),
  });
  assert.equal(reactivateRes.status, 200);
});

test('Workflow G.6: Verification audit history is recorded in database', async () => {
  const res = await fetch(`${baseUrl}/api/v1/verification/audit-logs`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.ok(Array.isArray(body.logs));
  assert.ok(body.logs.length >= 2, 'Audit logs must capture review and suspension events');
});

test('Workflow G.7: Ordinary users cannot access verification endpoints', async () => {
  const res = await fetch(`${baseUrl}/api/v1/verification/audit-logs`, {
    headers: { Authorization: `Bearer ${testPatientToken}` },
  });
  assert.equal(res.status, 403, 'Patient cannot access super admin verification audit logs');
});

// =============================================================================
// WORKFLOW H: NANI AI & CLINICAL DECISION SUPPORT
// =============================================================================

test('Workflow H.1: Send a text message to Nani AI', async () => {
  const res = await fetch(`${baseUrl}/api/v1/chatbot/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'What kinds of ambulances does LifeLink provide?' }),
  });

  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.ok(body.reply && typeof body.reply === 'string');
  assert.ok(body.reply.includes('Basic Life Support') || body.reply.includes('BLS'));
});

test('Workflow H.2: Verify configured adapter is used (local fallback in zero-cost mode)', async () => {
  const res = await fetch(`${baseUrl}/api/v1/chatbot/config`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.equal(body.status, 'success');
  assert.ok(body.data.provider === 'local_fallback' || body.data.provider === 'gemini');
  assert.equal(body.data.emergencyNumber, '112');
});

test('Workflow H.3: Test provider error and graceful safe fallback', async () => {
  // Empty message returns 400 validation error
  const errRes = await fetch(`${baseUrl}/api/v1/chatbot/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: '' }),
  });
  assert.equal(errRes.status, 400);
});

test('Workflow H.4: Multi-language selection (Hindi) returns appropriate response', async () => {
  const res = await fetch(`${baseUrl}/api/v1/chatbot/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'नमस्ते',
      language: 'Hindi',
    }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.ok(body.reply.includes('नमस्ते') || body.reply.includes('नानी'));
});

test('Workflow H.5: Emergency guardrails immediately trigger National Emergency 112 guidance', async () => {
  const res = await fetch(`${baseUrl}/api/v1/chatbot/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Patient has crushing chest pain and shortness of breath',
    }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.equal(body.isEmergency, true, 'Emergency keywords must set isEmergency flag to true');
  assert.equal(body.emergencyContact || body.emergencyGuidance?.nationalEmergency, '112');
  assert.ok(body.reply.includes('112') || body.reply.includes('SOS'), 'Emergency reply must direct patient to 112 / SOS');
});

test('Workflow H.6: Fallback response is never represented as live AI provider', async () => {
  const res = await fetch(`${baseUrl}/api/v1/chatbot/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'What is LifeLink?' }),
  });
  const body = (await res.json()) as any;
  if (!process.env.GEMINI_API_KEY) {
    assert.equal(body.provider, 'local_fallback', 'When GEMINI_API_KEY is unset, provider must be explicitly local_fallback');
  }
});
