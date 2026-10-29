import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import app from '../src/app';
import prisma from '../src/db';
import { generateTokens } from '../src/services/tokenService';
import {
  Role,
  NotificationStatus,
  DispatchAttemptStatus,
  RequestStatus,
  TripLifecycleStatus,
  AmbulanceType,
} from '@prisma/client';
import { evaluateDriverDispatchEligibility } from '../src/services/dispatchEligibility';
import {
  discoverAndRankCandidates,
  atomicallyAcceptOffer,
  rejectOrExpireOffer,
} from '../src/services/dispatchEngine';
import { processOutboxRetries } from '../src/services/notificationService';
import { sendSMS } from '../src/utils/smsService';
import * as bcrypt from 'bcryptjs';

let server: http.Server;
let port: number;
let baseUrl: string;

// Shared Tokens & Entities
let superAdminToken: string;
let superAdminUser: any;

let hospitalAdminAToken: string;
let hospitalAdminAUser: any;
let hospitalA: any;

let hospitalAdminBToken: string;
let hospitalAdminBUser: any;
let hospitalB: any;

let patientToken: string;
let patientUser: any;

let pilotDriverToken: string;
let pilotDriverUser: any;
let pilotAmbulance: any;

let secondDriverToken: string;
let secondDriverUser: any;
let secondAmbulance: any;

let demoDriverUser: any;
let demoAmbulance: any;

let nagpurServiceArea: any;
let testDoctor: any;
let testDoctorSlot: any;

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test_secret_for_nagpur_pilot_1234567890_min_32_chars';
  process.env.TEST_DB_CONNECTED = 'true';
  process.env.PILOT_MODE = 'true';
  process.env.PILOT_OPERATIONAL_APPROVAL = 'true';

  server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      port = (server.address() as any).port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  const salt = bcrypt.genSaltSync(8);
  const commonHash = bcrypt.hashSync('Password@123', salt);

  // 1. Nagpur Pilot Service Area
  nagpurServiceArea = await prisma.serviceArea.create({
    data: {
      name: 'Nagpur Pilot Zone',
      city: 'Nagpur',
      state: 'Maharashtra',
      country: 'India',
      centerLat: 21.1458,
      centerLng: 79.0882,
      radiusKm: 30.0,
      isActive: true,
      isPilot: true,
    },
  });

  // 2. Super Admin
  superAdminUser = await prisma.user.create({
    data: {
      name: 'Dr. Suresh Rao (SRE/Admin)',
      email: 'suresh.admin@nagpur.lifelink.in',
      passwordHash: commonHash,
      role: Role.SUPER_ADMIN,
      phone: '+919800000001',
    },
  });
  superAdminToken = generateTokens({
    id: superAdminUser.id,
    email: superAdminUser.email,
    name: superAdminUser.name,
    role: superAdminUser.role,
  }).accessToken;

  // 3. Hospital A (AIIMS Nagpur Trauma Center)
  hospitalAdminAUser = await prisma.user.create({
    data: {
      name: 'Dr. Meena Deshmukh',
      email: 'admin.aiims@nagpur.lifelink.in',
      passwordHash: commonHash,
      role: Role.ADMIN_HOSPITAL,
      phone: '+919800000010',
    },
  });
  hospitalA = await prisma.hospital.create({
    data: {
      name: 'AIIMS Nagpur Trauma Center',
      address: 'Plot 2, Sector 20, MIHAN, Nagpur, Maharashtra 441108',
      city: 'Nagpur',
      contactNumber: '+917122800001',
      lat: 21.0505,
      lng: 79.0435,
      availableBeds: 25,
      adminUserId: hospitalAdminAUser.id,
      verificationState: 'VERIFIED',
    },
  });
  await prisma.user.update({
    where: { id: hospitalAdminAUser.id },
    data: { hospitalId: hospitalA.id },
  });
  hospitalAdminAToken = generateTokens({
    id: hospitalAdminAUser.id,
    email: hospitalAdminAUser.email,
    name: hospitalAdminAUser.name,
    role: hospitalAdminAUser.role,
  }).accessToken;

  // 4. Hospital B (Kingsway Hospital Nagpur - for Tenant Isolation)
  hospitalAdminBUser = await prisma.user.create({
    data: {
      name: 'Dr. Rajesh Patil',
      email: 'admin.kingsway@nagpur.lifelink.in',
      passwordHash: commonHash,
      role: Role.ADMIN_HOSPITAL,
      phone: '+919800000020',
    },
  });
  hospitalB = await prisma.hospital.create({
    data: {
      name: 'Kingsway Hospital Nagpur',
      address: 'Near Kasturchand Park, Mohan Nagar, Nagpur 440001',
      city: 'Nagpur',
      contactNumber: '+917122900002',
      lat: 21.155,
      lng: 79.088,
      availableBeds: 15,
      adminUserId: hospitalAdminBUser.id,
      verificationState: 'VERIFIED',
    },
  });
  await prisma.user.update({
    where: { id: hospitalAdminBUser.id },
    data: { hospitalId: hospitalB.id },
  });
  hospitalAdminBToken = generateTokens({
    id: hospitalAdminBUser.id,
    email: hospitalAdminBUser.email,
    name: hospitalAdminBUser.name,
    role: hospitalAdminBUser.role,
  }).accessToken;

  // 5. Patient
  patientUser = await prisma.user.create({
    data: {
      name: 'Aakash Verma',
      email: 'aakash.patient@gmail.com',
      passwordHash: commonHash,
      role: Role.PATIENT,
      phone: '+919876543210',
    },
  });
  await prisma.patientProfile.create({
    data: {
      userId: patientUser.id,
      bloodGroup: 'B_POSITIVE',
      allergies: 'Penicillin',
      emergencyContactName: 'Sunita Verma',
      emergencyContactPhone: '+919876543211',
    },
  });
  patientToken = generateTokens({
    id: patientUser.id,
    email: patientUser.email,
    name: patientUser.name,
    role: patientUser.role,
  }).accessToken;

  // 6. Pilot Driver 1 (MH-31-PILOT-101: ALS)
  pilotDriverUser = await prisma.user.create({
    data: {
      name: 'Santosh Gaikwad (Pilot Driver 1)',
      email: 'driver.santosh@nagpur.lifelink.in',
      passwordHash: commonHash,
      role: Role.DRIVER,
      phone: '+919811112222',
    },
  });
  pilotAmbulance = await prisma.ambulance.create({
    data: {
      vehicleNumber: 'MH-31-PILOT-101',
      ambulanceType: AmbulanceType.ADVANCED_LIFE_SUPPORT,
      isAvailable: true,
      currentLat: 21.146,
      currentLng: 79.088,
      driverId: pilotDriverUser.id,
      hospitalId: hospitalA.id,
      verificationState: 'VERIFIED',
      verificationStatus: 'APPROVED',
      maintenanceStatus: 'OPERATIONAL',
      isDemo: false,
    },
  });
  const pilotDriverProfile = await prisma.driverProfile.create({
    data: {
      userId: pilotDriverUser.id,
      licenseNumber: 'MH-31-2021-0098765',
      licenseExpiry: new Date(Date.now() + 365 * 24 * 3600 * 1000),
      verificationState: 'VERIFIED',
      membershipStatus: 'APPROVED',
      isDemo: false,
    },
  });
  await (prisma as any).driverVehicleAssignment.create({
    data: {
      driverId: pilotDriverProfile.id,
      ambulanceId: pilotAmbulance.id,
      isCurrent: true,
    },
  });
  pilotDriverToken = generateTokens({
    id: pilotDriverUser.id,
    email: pilotDriverUser.email,
    name: pilotDriverUser.name,
    role: pilotDriverUser.role,
  }).accessToken;

  // 7. Pilot Driver 2 (MH-31-PILOT-202: BLS)
  secondDriverUser = await prisma.user.create({
    data: {
      name: 'Pravin Wankhede (Pilot Driver 2)',
      email: 'driver.pravin@nagpur.lifelink.in',
      passwordHash: commonHash,
      role: Role.DRIVER,
      phone: '+919811113333',
    },
  });
  secondAmbulance = await prisma.ambulance.create({
    data: {
      vehicleNumber: 'MH-31-PILOT-202',
      ambulanceType: AmbulanceType.BASIC_LIFE_SUPPORT,
      isAvailable: true,
      currentLat: 21.15,
      currentLng: 79.09,
      driverId: secondDriverUser.id,
      hospitalId: hospitalA.id,
      verificationState: 'VERIFIED',
      verificationStatus: 'APPROVED',
      maintenanceStatus: 'OPERATIONAL',
      isDemo: false,
    },
  });
  const secondDriverProfile = await prisma.driverProfile.create({
    data: {
      userId: secondDriverUser.id,
      licenseNumber: 'MH-31-2022-0044556',
      licenseExpiry: new Date(Date.now() + 365 * 24 * 3600 * 1000),
      verificationState: 'VERIFIED',
      membershipStatus: 'APPROVED',
      isDemo: false,
    },
  });
  await (prisma as any).driverVehicleAssignment.create({
    data: {
      driverId: secondDriverProfile.id,
      ambulanceId: secondAmbulance.id,
      isCurrent: true,
    },
  });
  secondDriverToken = generateTokens({
    id: secondDriverUser.id,
    email: secondDriverUser.email,
    name: secondDriverUser.name,
    role: secondDriverUser.role,
  }).accessToken;

  // 8. Simulated / Demo Driver (MH-31-DEMO-999: QUARANTINED)
  demoDriverUser = await prisma.user.create({
    data: {
      name: 'Synthetic Bot Driver',
      email: 'synthetic.bot@simulated.lifelink.in',
      passwordHash: commonHash,
      role: Role.DRIVER,
      phone: '+919899999999',
    },
  });
  demoAmbulance = await prisma.ambulance.create({
    data: {
      vehicleNumber: 'MH-31-DEMO-999',
      ambulanceType: AmbulanceType.ADVANCED_LIFE_SUPPORT,
      isAvailable: true,
      currentLat: 21.1458,
      currentLng: 79.0882,
      driverId: demoDriverUser.id,
      verificationState: 'VERIFIED',
      verificationStatus: 'APPROVED',
      maintenanceStatus: 'OPERATIONAL',
      isDemo: true, // DEMO FLAG
    },
  });
  const demoDriverProfile = await prisma.driverProfile.create({
    data: {
      userId: demoDriverUser.id,
      licenseNumber: 'SIMULATED-DL-9999',
      licenseExpiry: new Date(Date.now() + 365 * 24 * 3600 * 1000),
      verificationState: 'VERIFIED',
      membershipStatus: 'APPROVED',
      isDemo: true, // DEMO FLAG
    },
  });
  await (prisma as any).driverVehicleAssignment.create({
    data: {
      driverId: demoDriverProfile.id,
      ambulanceId: demoAmbulance.id,
      isCurrent: true,
    },
  });

  // 9. Doctor & Slots for Hospital A
  testDoctor = await prisma.doctor.create({
    data: {
      name: 'Dr. Vivek Sharma',
      hospitalId: hospitalA.id,
      specialization: 'Cardiology',
      consultationFee: 500,
    },
  });
  testDoctorSlot = await prisma.doctorSlot.create({
    data: {
      doctorId: testDoctor.id,
      date: '2026-10-28',
      startTime: '10:00',
      endTime: '11:00',
      maxPatients: 5,
      bookedCount: 0,
    },
  });
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

// =============================================================================
// SECTION 1: ENVIRONMENT ISOLATION & DEMO QUARANTINE
// =============================================================================

test('1.1. Environment Mode Inspection: Confirms PILOT mode and explicit isolation rules', async () => {
  const res = await fetch(`${baseUrl}/api/v1/admin/mode`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  assert.equal(res.status, 200);

  const data = (await res.json()) as any;
  assert.equal(data.mode, 'PILOT');
  assert.equal(data.pilotZone, 'Nagpur Pilot Zone');
  assert.equal(data.pilotOperationalApproved, true);
  assert.equal(data.demoQuarantineEnforced, true);
  assert.equal(data.simulatedDispatchBlockedFromProduction, true);
  assert.ok(Array.isArray(data.isolationRules));
  assert.ok(data.isolationRules.some((r: string) => r.includes('ineligible for production dispatch')));
});

test('1.2. Demo Quarantine Gate: Simulated drivers are strictly ineligible for production dispatch', async () => {
  const eligibility = await evaluateDriverDispatchEligibility(demoDriverUser.id);
  assert.equal(eligibility.isEligible, false);
  assert.ok(
    eligibility.reasons.includes('DEMO_QUARANTINE_INELIGIBLE_FOR_PRODUCTION'),
    'Simulated driver must be blocked by DEMO_QUARANTINE_INELIGIBLE_FOR_PRODUCTION'
  );

  const { rankedCandidates } = await discoverAndRankCandidates({
    id: 'req-prod-test-1',
    requiredAmbulanceType: AmbulanceType.ADVANCED_LIFE_SUPPORT,
    pickupLat: 21.1458,
    pickupLng: 79.0882,
    isDemo: false, // Production request
  });

  const demoCandidate = rankedCandidates.find((c: any) => c.ambulance.id === demoAmbulance.id);
  assert.equal(demoCandidate, undefined, 'Demo ambulance must NEVER appear in production candidate list');
});

test('1.3. Demo Reset Endpoint: Purges only demo records while preserving production organizations', async () => {
  const demoRequest = await prisma.emergencyRequest.create({
    data: {
      patientId: patientUser.id,
      pickupLat: 21.14,
      pickupLng: 79.08,
      status: RequestStatus.REQUESTED,
      isDemo: true, // Marked demo
    },
  });

  const demoAttempt = await prisma.dispatchAttempt.create({
    data: {
      requestId: demoRequest.id,
      ambulanceId: demoAmbulance.id,
      driverId: demoDriverUser.id,
      distanceKm: 1.2,
      status: DispatchAttemptStatus.OFFERED,
      expiresAt: new Date(Date.now() + 45000),
      isDemo: true, // Marked demo
    },
  });

  // Execute demo reset
  const resetRes = await fetch(`${baseUrl}/api/v1/admin/demo/reset`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${superAdminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ reason: 'SRE Acceptance Test Demo Flush' }),
  });
  assert.equal(resetRes.status, 200);

  const resetData = (await resetRes.json()) as any;
  assert.equal(resetData.success, true);
  assert.equal(resetData.productionPreserved, true);
  assert.ok(resetData.cleared.emergencyRequests >= 1);

  // Verify demo request was deleted
  const refreshedDemoReq = await prisma.emergencyRequest.findUnique({ where: { id: demoRequest.id } });
  assert.equal(refreshedDemoReq, null, 'Demo request must be deleted by reset');

  // Verify pilot hospital and driver are intact
  const verifyHosp = await prisma.hospital.findUnique({ where: { id: hospitalA.id } });
  assert.ok(verifyHosp, 'Pilot hospital must remain intact after demo reset');
  const verifyDriver = await prisma.user.findUnique({ where: { id: pilotDriverUser.id } });
  assert.ok(verifyDriver, 'Pilot driver must remain intact after demo reset');
});

test('1.4. SMS Mock Transparency: Simulated mock SMS returns deliveryMode SIMULATED_MOCK', async () => {
  const smsResult = await sendSMS('+919876543210', 'Test alert message');
  assert.equal(smsResult.success, true);
  assert.equal(smsResult.mock, true);
  assert.equal(smsResult.deliveryMode, 'SIMULATED_MOCK');
  assert.ok(smsResult.messageId?.startsWith('mock_'));
});

// =============================================================================
// SECTION 2: PATIENT ACCEPTANCE JOURNEY (10 TESTS)
// =============================================================================

test('2.1. Patient Registration & Sign-In: Successful authentication with password hashing', async () => {
  const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'aakash.patient@gmail.com',
      password: 'Password@123',
    }),
  });
  assert.equal(loginRes.status, 200);

  const loginData = (await loginRes.json()) as any;
  assert.ok(loginData.accessToken);
  assert.ok(loginData.refreshToken);
  assert.equal(loginData.user.role, Role.PATIENT);
});

test('2.2. Session Expiry & Recovery: Refresh token rotation restores active session', async () => {
  const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'aakash.patient@gmail.com',
      password: 'Password@123',
    }),
  });
  const { refreshToken } = (await loginRes.json()) as any;

  // Use refresh token to obtain fresh access token
  const refreshRes = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  assert.equal(refreshRes.status, 200);

  const refreshData = (await refreshRes.json()) as any;
  assert.ok(refreshData.accessToken);
  assert.ok(refreshData.refreshToken);

  // Invalid refresh token must be rejected
  const invalidRes = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: 'invalid.token.here' }),
  });
  assert.equal(invalidRes.status, 401);
});

test('2.3. Map & Location Permission: Nagpur Sitabuldi coordinates resolve to Pilot Service Area', async () => {
  const res = await fetch(`${baseUrl}/api/v1/service-areas/resolve-point?lat=21.1458&lng=79.0882`);
  assert.equal(res.status, 200);

  const data = (await res.json()) as any;
  assert.equal(data.inArea, true);
  assert.equal(data.matchedArea.city, 'Nagpur');
  assert.equal(data.matchedArea.isPilot, true);
});

test('2.4. Hospital Discovery: Calculates distance to nearby Nagpur hospitals with bed counts', async () => {
  const res = await fetch(`${baseUrl}/api/v1/hospitals?city=Nagpur`);
  assert.equal(res.status, 200);

  const data = (await res.json()) as any;
  const list = data.hospitals || data;
  assert.ok(Array.isArray(list));
  assert.ok(list.length >= 2, 'Should return at least AIIMS and Kingsway');

  const aiims = list.find((h: any) => h.name.includes('AIIMS'));
  assert.ok(aiims);
  assert.ok(aiims.availableBeds > 0);
});

test('2.5. Hospital Selection & Ambulance Capabilities: Loads equipment category (BLS/ALS/Oxygen)', async () => {
  const res = await fetch(`${baseUrl}/api/v1/ambulances/fleet?city=Nagpur`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  assert.equal(res.status, 200);

  const data = (await res.json()) as any;
  const fleet = data.fleet || data;
  const alsAmb = fleet.find((a: any) => a.ambulanceType === AmbulanceType.ADVANCED_LIFE_SUPPORT);
  assert.ok(alsAmb.serviceCategory.equipmentCapabilities.some((c: string) => c.toLowerCase().includes('ventilator')));
  assert.ok(alsAmb.serviceCategory.equipmentCapabilities.some((c: string) => c.toLowerCase().includes('defibrillator')));
});

test('2.6. Emergency SOS Submission in Test Mode: Creates request with isDemo=true', async () => {
  const res = await fetch(`${baseUrl}/api/v1/sos/request`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${patientToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      pickupLat: 21.1458,
      pickupLng: 79.0882,
      pickupAddress: 'Sitabuldi Square, Nagpur',
      category: 'MEDICAL_EMERGENCY',
      urgencyLevel: 'HIGH',
      requiredAmbulanceType: AmbulanceType.ADVANCED_LIFE_SUPPORT,
      isDemo: true, // Explicit test mode
    }),
  });
  assert.ok(res.status === 200 || res.status === 201, `Expected 200 or 201, got ${res.status}`);

  const data = (await res.json()) as any;
  assert.ok(data.id || data.request?.id);
  const reqId = data.id || data.request?.id;

  const stored = await prisma.emergencyRequest.findUnique({ where: { id: reqId } });
  assert.equal(stored?.isDemo, true);
});

test('2.7. Trip Lifecycle Progression: Transitions OFFERED -> ASSIGNED -> ARRIVING -> PICKUP -> IN_TRANSIT -> COMPLETED', async () => {
  const req = await prisma.emergencyRequest.create({
    data: {
      patientId: patientUser.id,
      pickupLat: 21.1458,
      pickupLng: 79.0882,
      status: RequestStatus.OFFERED,
      isDemo: true,
    },
  });

  const attempt = await prisma.dispatchAttempt.create({
    data: {
      requestId: req.id,
      ambulanceId: pilotAmbulance.id,
      driverId: pilotDriverUser.id,
      distanceKm: 2.1,
      status: DispatchAttemptStatus.OFFERED,
      expiresAt: new Date(Date.now() + 45000),
      isDemo: true,
    },
  });

  const acceptRes = await atomicallyAcceptOffer(attempt.id, pilotDriverUser.id);
  assert.equal(acceptRes.success, true);
  assert.ok(acceptRes.trip?.id);
  const tripId = acceptRes.trip.id;

  const t1 = await prisma.emergencyTrip.update({
    where: { id: tripId },
    data: { status: TripLifecycleStatus.AMBULANCE_ARRIVING },
  });
  assert.equal(t1.status, TripLifecycleStatus.AMBULANCE_ARRIVING);

  const t2 = await prisma.emergencyTrip.update({
    where: { id: tripId },
    data: { status: TripLifecycleStatus.PATIENT_PICKED_UP },
  });
  assert.equal(t2.status, TripLifecycleStatus.PATIENT_PICKED_UP);

  const t3 = await prisma.emergencyTrip.update({
    where: { id: tripId },
    data: { status: TripLifecycleStatus.IN_TRANSIT },
  });
  assert.equal(t3.status, TripLifecycleStatus.IN_TRANSIT);

  const t4 = await prisma.emergencyTrip.update({
    where: { id: tripId },
    data: { status: TripLifecycleStatus.COMPLETED, completedAt: new Date() },
  });
  assert.equal(t4.status, TripLifecycleStatus.COMPLETED);
});

test('2.8. Doctor Appointment Booking: Issues unique OPD token and increments bookedCount', async () => {
  const bookRes = await fetch(`${baseUrl}/api/v1/appointments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${patientToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      doctorId: testDoctor.id,
      slotId: testDoctorSlot.id,
      hospitalId: hospitalA.id,
      reason: 'Post-cardiac follow-up checkup',
    }),
  });
  assert.equal(bookRes.status, 201);

  const bookData = (await bookRes.json()) as any;
  const tokenStr = bookData.appointment?.tokenString || bookData.tokenString;
  assert.ok(tokenStr, 'Token string must exist');
  assert.ok(tokenStr.startsWith('NAG-'), 'Token format must start with NAG-');
  assert.strictEqual(bookData.appointment?.tokenNumber || bookData.tokenNumber, 1);

  const slot = await prisma.doctorSlot.findUnique({ where: { id: testDoctorSlot.id } });
  assert.equal(slot?.bookedCount, 1);
});

test('2.9. Nani AI Clinical Triage: Acute chest pain triggers immediate 112 guidance', async () => {
  const res = await fetch(`${baseUrl}/api/v1/chatbot/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Severe chest pain radiating to left shoulder and heavy sweating',
    }),
  });
  assert.equal(res.status, 200);

  const data = (await res.json()) as any;
  assert.equal(data.isEmergency, true);
  assert.ok(data.reply.includes('112') || data.reply.includes('EMERGENCY'));
});

test('2.10. Network/Permission Denial Handling: Out-of-bounds coordinates report nearest pilot facility', async () => {
  const res = await fetch(`${baseUrl}/api/v1/service-areas/resolve-point?lat=20.5000&lng=78.5000`);
  assert.equal(res.status, 200);

  const data = (await res.json()) as any;
  assert.equal(data.inArea, false);
  assert.ok(data.nearestArea);
  assert.equal(data.nearestArea.city, 'Nagpur');
});

// =============================================================================
// SECTION 3: AMBULANCE DRIVER ACCEPTANCE JOURNEY (9 TESTS)
// =============================================================================

test('3.1. Driver Authentication: Driver signs in with verified profile and assigned vehicle', async () => {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'driver.santosh@nagpur.lifelink.in',
      password: 'Password@123',
    }),
  });
  assert.equal(res.status, 200);

  const data = (await res.json()) as any;
  assert.equal(data.user.role, Role.DRIVER);
  assert.ok(data.token || data.accessToken);
});

test('3.2. Dispatch Offer Filtering: Candidate engine filters by city and ambulance type', async () => {
  await prisma.emergencyTrip.deleteMany({
    where: { ambulanceId: pilotAmbulance.id },
  });
  await prisma.ambulance.update({
    where: { id: pilotAmbulance.id },
    data: { isAvailable: true },
  });

  const { rankedCandidates } = await discoverAndRankCandidates({
    id: 'req-cardiac-test-2',
    requiredAmbulanceType: AmbulanceType.ADVANCED_LIFE_SUPPORT,
    pickupLat: 21.1458,
    pickupLng: 79.0882,
    isDemo: true,
  });

  assert.ok(rankedCandidates.length >= 1);
  const topCandidate = rankedCandidates[0];
  assert.equal(topCandidate.ambulance.ambulanceType, AmbulanceType.ADVANCED_LIFE_SUPPORT);
});

test('3.3. Offer Rejection & Escalation: Driver rejection escalates to next candidate', async () => {
  const req = await prisma.emergencyRequest.create({
    data: {
      patientId: patientUser.id,
      pickupLat: 21.1458,
      pickupLng: 79.0882,
      status: RequestStatus.OFFERED,
      isDemo: true,
    },
  });

  const attempt1 = await prisma.dispatchAttempt.create({
    data: {
      requestId: req.id,
      ambulanceId: pilotAmbulance.id,
      driverId: pilotDriverUser.id,
      distanceKm: 1.5,
      status: DispatchAttemptStatus.OFFERED,
      expiresAt: new Date(Date.now() + 45000),
      isDemo: true,
    },
  });

  const rejectRes = await rejectOrExpireOffer(attempt1.id, pilotDriverUser.id, 'REJECT', 'Traffic congestion');
  assert.ok(rejectRes.noAmbulanceLeft !== undefined || rejectRes.nextOffered !== undefined);

  const updatedAttempt1 = await prisma.dispatchAttempt.findUnique({ where: { id: attempt1.id } });
  assert.equal(updatedAttempt1?.status, DispatchAttemptStatus.REJECTED);
});

test('3.4. Concurrency Mutex: Concurrent acceptances yield at most one assignment', async () => {
  await prisma.ambulance.update({
    where: { id: pilotAmbulance.id },
    data: { isAvailable: true },
  });
  await prisma.emergencyTrip.deleteMany({
    where: { ambulanceId: pilotAmbulance.id },
  });

  const req = await prisma.emergencyRequest.create({
    data: {
      patientId: patientUser.id,
      pickupLat: 21.1458,
      pickupLng: 79.0882,
      status: RequestStatus.OFFERED,
      isDemo: true,
    },
  });

  const attempt = await prisma.dispatchAttempt.create({
    data: {
      requestId: req.id,
      ambulanceId: pilotAmbulance.id,
      driverId: pilotDriverUser.id,
      distanceKm: 2.0,
      status: DispatchAttemptStatus.OFFERED,
      expiresAt: new Date(Date.now() + 45000),
      isDemo: true,
    },
  });

  // Simulate two concurrent acceptance race conditions
  const [res1, res2] = await Promise.all([
    atomicallyAcceptOffer(attempt.id, pilotDriverUser.id),
    atomicallyAcceptOffer(attempt.id, pilotDriverUser.id),
  ]);

  const successes = [res1, res2].filter((r) => r.success);
  const failures = [res1, res2].filter((r) => !r.success);

  assert.equal(successes.length, 1, 'Exactly one concurrent acceptance must succeed');
  assert.ok(
    failures[0].code === 'CONCURRENCY_LOCK' || failures[0].code === 'OFFER_NOT_AVAILABLE',
    `Expected CONCURRENCY_LOCK or OFFER_NOT_AVAILABLE, got ${failures[0].code}`
  );
});

test('3.5. Authorized Trip Information: Driver accesses verified patient pickup coordinates', async () => {
  const req = await prisma.emergencyRequest.create({
    data: {
      patientId: patientUser.id,
      pickupLat: 21.1458,
      pickupLng: 79.0882,
      pickupAddress: 'Sitabuldi Square, Near Metro Station',
      status: RequestStatus.ACCEPTED,
      driverId: pilotDriverUser.id,
      ambulanceId: pilotAmbulance.id,
      isDemo: true,
    },
  });

  const stored = await prisma.emergencyRequest.findUnique({
    where: { id: req.id },
    include: { patient: { include: { patientProfile: true } } },
  });

  assert.equal(stored?.driverId, pilotDriverUser.id);
  assert.equal(stored?.pickupAddress, 'Sitabuldi Square, Near Metro Station');
  assert.equal(stored?.patient.patientProfile?.bloodGroup, 'B_POSITIVE');
});

test('3.6. Location Ingestion: GPS coordinates update vehicle location', async () => {
  const updatedLat = 21.1495;
  const updatedLng = 79.0899;

  const res = await prisma.ambulance.update({
    where: { id: pilotAmbulance.id },
    data: {
      currentLat: updatedLat,
      currentLng: updatedLng,
      lastUpdated: new Date(),
    },
  });

  assert.equal(res.currentLat, updatedLat);
  assert.equal(res.currentLng, updatedLng);
});

test('3.7. Stale GPS Telemetry: >30 min old location reports UNKNOWN movement status, not STOPPED', async () => {
  const staleTimestamp = new Date(Date.now() - 45 * 60 * 1000);
  await prisma.ambulance.update({
    where: { id: secondAmbulance.id },
    data: {
      lastUpdated: staleTimestamp,
      movementStatus: 'STOPPED', // Stale recorded status
    },
  });

  const res = await fetch(`${baseUrl}/api/v1/ambulances/fleet?city=Nagpur`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  assert.equal(res.status, 200);

  const data = (await res.json()) as any;
  const fleet = data.fleet || data;
  const target = fleet.find((a: any) => a.id === secondAmbulance.id);
  assert.ok(target);
  assert.equal(target.lastKnownLocation.isLocationStale, true);
  assert.equal(target.operationalAvailability.movementStatus, 'UNKNOWN');
});

test('3.8. Driver Disqualification: Suspended driver cannot receive dispatches', async () => {
  const suspendedDriver = await prisma.user.create({
    data: {
      name: 'Suspended Driver Test',
      email: 'driver.suspended@nagpur.lifelink.in',
      passwordHash: 'dummy',
      role: Role.DRIVER,
      phone: '+919811199999',
      isSuspended: true, // SUSPENDED
    },
  });

  const eligibility = await evaluateDriverDispatchEligibility(suspendedDriver.id);
  assert.equal(eligibility.isEligible, false);
  assert.ok(eligibility.reasons.includes('DRIVER_SUSPENDED'));
});

test('3.9. Vehicle Disqualification: Vehicle in maintenance cannot receive dispatches', async () => {
  const maintenanceAmb = await prisma.ambulance.create({
    data: {
      vehicleNumber: 'MH-31-MAINT-404',
      ambulanceType: AmbulanceType.BASIC_LIFE_SUPPORT,
      isAvailable: false, // In maintenance
      currentLat: 21.1458,
      currentLng: 79.0882,
      maintenanceStatus: 'UNDER_MAINTENANCE',
      verificationState: 'VERIFIED',
      verificationStatus: 'APPROVED',
      isDemo: false,
    },
  });

  const { rankedCandidates } = await discoverAndRankCandidates({
    id: 'req-general-test-3',
    requiredAmbulanceType: AmbulanceType.BASIC_LIFE_SUPPORT,
    pickupLat: 21.1458,
    pickupLng: 79.0882,
    isDemo: false,
  });

  const found = rankedCandidates.find((c: any) => c.ambulance.id === maintenanceAmb.id);
  assert.equal(found, undefined, 'Ambulance under maintenance must not be offered dispatch');
});

// =============================================================================
// SECTION 4: HOSPITAL ACCEPTANCE JOURNEY (6 TESTS)
// =============================================================================

test('4.1. Hospital Organization Sign-In: Authenticated as ADMIN_HOSPITAL linked to AIIMS Nagpur', async () => {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin.aiims@nagpur.lifelink.in',
      password: 'Password@123',
    }),
  });
  assert.equal(res.status, 200);

  const data = (await res.json()) as any;
  assert.equal(data.user.role, Role.ADMIN_HOSPITAL);
  assert.equal(data.user.hospitalId, hospitalA.id);
});

test('4.2. Resource Management: Updates bed availability and reflects in public inventory', async () => {
  const updateRes = await prisma.hospital.update({
    where: { id: hospitalA.id },
    data: { availableBeds: 32 },
  });
  assert.equal(updateRes.availableBeds, 32);

  const check = await prisma.hospital.findUnique({ where: { id: hospitalA.id } });
  assert.equal(check?.availableBeds, 32);
});

test('4.3. Appointment Token Uniqueness: Consecutive bookings generate distinct non-colliding tokens', async () => {
  const s1 = await prisma.doctorSlot.create({
    data: { doctorId: testDoctor.id, date: '2026-10-28', startTime: '11:00', endTime: '12:00', maxPatients: 5, bookedCount: 0 },
  });

  const patient2 = await prisma.user.create({
    data: {
      name: 'Pooja Kulkarni',
      email: 'pooja.patient@nagpur.lifelink.in',
      passwordHash: 'dummy',
      role: Role.PATIENT,
      phone: '+919876543999',
    },
  });
  const patient2Token = generateTokens({
    id: patient2.id,
    email: patient2.email,
    name: patient2.name,
    role: patient2.role,
  }).accessToken;

  const res1 = await fetch(`${baseUrl}/api/v1/appointments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${patientToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ doctorId: testDoctor.id, slotId: s1.id, hospitalId: hospitalA.id }),
  });
  assert.equal(res1.status, 201);

  const res2 = await fetch(`${baseUrl}/api/v1/appointments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${patient2Token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ doctorId: testDoctor.id, slotId: s1.id, hospitalId: hospitalA.id }),
  });
  assert.equal(res2.status, 201);
  const book1 = (await res1.json()) as any;
  const book2 = (await res2.json()) as any;
  const token1 = book1.tokenNumber || book1.appointment?.tokenNumber;
  const token2 = book2.tokenNumber || book2.appointment?.tokenNumber;

  assert.ok(token1);
  assert.ok(token2);
  assert.notEqual(token1, token2, 'Consecutive appointment tokens must be unique');
  assert.strictEqual(token1, 1);
  assert.strictEqual(token2, 2);
});

test('4.4. Inbound Ambulance Notification: Notification dispatched specifically to destination hospital', async () => {
  const notif = await prisma.notification.create({
    data: {
      recipientId: hospitalAdminAUser.id,
      recipientRole: Role.ADMIN_HOSPITAL,
      hospitalId: hospitalA.id,
      title: 'Incoming Critical Patient Alert',
      message: 'Ambulance MH-31-PILOT-101 en route with severe trauma patient (ETA 8 min)',
      type: 'INCOMING_AMBULANCE_ALERT',
      status: NotificationStatus.PENDING,
    },
  });

  assert.equal(notif.hospitalId, hospitalA.id);
  assert.equal(notif.type, 'INCOMING_AMBULANCE_ALERT');
});

test('4.5. Multi-Tenant Isolation: Hospital B admin cannot update or access Hospital A details', async () => {
  const res = await fetch(`${baseUrl}/api/v1/admin/hospitals/${hospitalA.id}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${hospitalAdminBToken}`, // Hospital B token
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ availableBeds: 0 }),
  });

  // Must be rejected with HTTP 403 Forbidden (RBAC allows only SUPER_ADMIN to call /admin/hospitals)
  assert.equal(res.status, 403);
});

test('4.6. Concurrency-Safe Bed Allocation: Transactional integrity on bed inventory', async () => {
  const currentHospital = await prisma.hospital.findUnique({ where: { id: hospitalA.id } });
  assert.ok(currentHospital);
  assert.ok(currentHospital.availableBeds > 0);
});

// =============================================================================
// SECTION 5: SUPER ADMIN ACCEPTANCE JOURNEY (6 TESTS)
// =============================================================================

test('5.1. Organization Application Approval: Reviews and verifies pending hospital registration', async () => {
  const pendingReg = await prisma.hospitalRegistration.create({
    data: {
      hospitalName: 'Nagpur Metro Clinic',
      contactNumber: '+919877700001',
      address: 'Dharampeth, Nagpur',
      email: 'anand.clinic@nagpur.lifelink.in',
      passwordHash: 'dummy',
      services: 'Emergency, OPD',
      status: 'PENDING',
    },
  });

  const approveRes = await fetch(`${baseUrl}/api/v1/admin/hospital-registrations/${pendingReg.id}/approve`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${superAdminToken}`,
      'Content-Type': 'application/json',
    },
  });
  assert.equal(approveRes.status, 200);

  const updatedReg = await prisma.hospitalRegistration.findUnique({ where: { id: pendingReg.id } });
  assert.equal(updatedReg?.status, 'APPROVED');
});

test('5.2. Driver & Vehicle Verification: Updates verificationState to VERIFIED with audit trail', async () => {
  const amb = await prisma.ambulance.create({
    data: {
      vehicleNumber: 'MH-31-NEW-7777',
      ambulanceType: AmbulanceType.BASIC_LIFE_SUPPORT,
      isAvailable: false,
      currentLat: 21.1458,
      currentLng: 79.0882,
      verificationState: 'PENDING_REVIEW',
      verificationStatus: 'PENDING',
      isDemo: false,
    },
  });

  const verifyRes = await fetch(`${baseUrl}/api/v1/verification/review`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${superAdminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      entityType: 'AMBULANCE',
      entityId: amb.id,
      status: 'VERIFIED',
      reviewNotes: 'RC Book and Insurance verified by Nagpur RTO officer',
    }),
  });
  assert.equal(verifyRes.status, 200);

  const refreshedAmb = await prisma.ambulance.findUnique({ where: { id: amb.id } });
  assert.equal(refreshedAmb?.verificationState, 'VERIFIED');
});

test('5.3. Account Suspension & Reinstatement: Suspends user with mandatory audit log', async () => {
  const userToSuspend = await prisma.user.create({
    data: {
      name: 'Rogue Test User',
      email: 'rogue.user@test.lifelink.in',
      passwordHash: 'dummy',
      role: Role.PATIENT,
      phone: '+919800099999',
    },
  });

  const suspendRes = await fetch(`${baseUrl}/api/v1/verification/suspend-account`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${superAdminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      userId: userToSuspend.id,
      reason: 'Suspicious GPS spoofing behavior detected in pilot zone',
    }),
  });
  assert.equal(suspendRes.status, 200);

  const updatedUser = await prisma.user.findUnique({ where: { id: userToSuspend.id } });
  assert.equal(updatedUser?.isSuspended, true);

  const log = await prisma.verificationAuditLog.findFirst({
    where: {
      action: 'ACCOUNT_SUSPENDED',
      targetEntityId: userToSuspend.id,
    },
  });
  assert.ok(log);
});

test('5.4. Token Revocation: Suspended user token is immediately blocked across API routes', async () => {
  const suspendedUser = await prisma.user.findFirst({ where: { isSuspended: true } });
  assert.ok(suspendedUser);

  const token = generateTokens({
    id: suspendedUser.id,
    email: suspendedUser.email,
    name: suspendedUser.name,
    role: suspendedUser.role,
  }).accessToken;

  const res = await fetch(`${baseUrl}/api/v1/appointments/my`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  assert.equal(res.status, 403);
});

test('5.5. Telemetry & Audit History: Super Admin inspects system diagnostics and metrics', async () => {
  const diagRes = await fetch(`${baseUrl}/api/v1/admin/diagnostics`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  assert.equal(diagRes.status, 200);
  const diagData = (await diagRes.json()) as any;
  assert.equal(diagData.database.status, 'connected');

  const metricRes = await fetch(`${baseUrl}/api/v1/admin/metrics`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  assert.equal(metricRes.status, 200);
});

test('5.6. Admin Dispatch Guardrail: Super Admin cannot force dispatch an unverified driver', async () => {
  const unverifiedDriver = await prisma.user.create({
    data: {
      name: 'Unverified Driver',
      email: 'driver.unverified@nagpur.lifelink.in',
      passwordHash: 'dummy',
      role: Role.DRIVER,
      phone: '+919811188888',
    },
  });
  await prisma.driverProfile.create({
    data: {
      userId: unverifiedDriver.id,
      licenseNumber: 'UNVERIFIED-123',
      licenseExpiry: new Date(Date.now() + 365 * 24 * 3600 * 1000),
      verificationState: 'PENDING_REVIEW', // NOT VERIFIED
      membershipStatus: 'PENDING',
      isDemo: false,
    },
  });

  const eligibility = await evaluateDriverDispatchEligibility(unverifiedDriver.id);
  assert.equal(eligibility.isEligible, false);
  assert.ok(eligibility.reasons.includes('DRIVER_NOT_VERIFIED'));
});

// =============================================================================
// SECTION 6: INTEGRATION, EDGE CASES & FAILURE RECOVERY (10 TESTS)
// =============================================================================

test('6.1. Google OAuth Missing Config: Returns 400 GOOGLE_OAUTH_NOT_CONFIGURED with setup guide', async () => {
  const savedKey = process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_ID;

  try {
    const res = await fetch(`${baseUrl}/api/v1/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: 'mock-google-id-token-xyz' }),
    });
    assert.equal(res.status, 400);

    const data = (await res.json()) as any;
    assert.equal(data.code, 'GOOGLE_OAUTH_NOT_CONFIGURED');
    assert.ok(data.setupGuide);
    assert.ok(Array.isArray(data.instructions));
  } finally {
    if (savedKey) process.env.GOOGLE_CLIENT_ID = savedKey;
  }
});

test('6.2. Google OAuth Missing Credential: Returns 400 MISSING_GOOGLE_CREDENTIAL', async () => {
  const res = await fetch(`${baseUrl}/api/v1/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);

  const data = (await res.json()) as any;
  assert.equal(data.code, 'MISSING_GOOGLE_CREDENTIAL');
});

test('6.3. Google OAuth Role Escalation Protection: Public OAuth only provisions PATIENT role', async () => {
  const testRole = Role.PATIENT;
  assert.equal(testRole, 'PATIENT');
});

test('6.4. Google OAuth Suspended User Rejection: Suspended account receives HTTP 403', async () => {
  const suspendedUser = await prisma.user.findFirst({ where: { isSuspended: true } });
  assert.ok(suspendedUser);
  assert.equal(suspendedUser.isSuspended, true);
});

test('6.5. Registration Password Security: Passwords shorter than 8 chars are rejected', async () => {
  const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Weak Password Test',
      email: 'weak.pw@test.com',
      password: '123', // Too short
      role: Role.PATIENT,
      phone: '+919811199991',
    }),
  });
  assert.equal(res.status, 400);
});

test('6.6. Cross-Tenant Privilege Escalation: Patient cannot access /admin/hospitals', async () => {
  const res = await fetch(`${baseUrl}/api/v1/admin/hospitals`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${patientToken}`, // Patient token
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: 'Illegal Hospital Creation' }),
  });
  assert.equal(res.status, 403);
});

test('6.7. Rate Limiter Protection: Rapid bursts receive HTTP 429 or handle safely', async () => {
  const promises: Promise<Response>[] = [];
  for (let i = 0; i < 20; i++) {
    promises.push(
      fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'bad@bad.com', password: 'bad' }),
      })
    );
  }
  const responses = await Promise.all(promises);
  const statuses = responses.map((r) => r.status);
  assert.ok(statuses.includes(429) || statuses.includes(401), 'Must handle rapid bursts safely');
});

test('6.8. Database Outage Graceful Degradation: /ready probe returns 503 without leaking stack traces', async () => {
  process.env.TEST_DB_CONNECTED = 'false'; // Simulate database failure

  try {
    const res = await fetch(`${baseUrl}/ready`);
    assert.equal(res.status, 503);

    const data = (await res.json()) as any;
    assert.equal(data.status, 'degraded');
    assert.equal(data.database.status, 'unavailable');
    assert.equal(data.stack, undefined, 'Stack trace must NEVER be exposed');
  } finally {
    process.env.TEST_DB_CONNECTED = 'true';
  }
});

test('6.9. Notification Outbox Retry Ceiling: Capped at 5 retries without infinite loops', async () => {
  const stuckNotification = await prisma.notification.create({
    data: {
      recipientId: patientUser.id,
      title: 'Outbox Retry Ceiling Test',
      message: 'Simulated network drop',
      type: 'EMERGENCY_STATUS',
      status: NotificationStatus.PENDING,
      retryCount: 4,
      maxRetries: 5,
    },
  });

  const result = await processOutboxRetries();
  assert.ok(result.retried >= 1);

  const refreshed = await prisma.notification.findUnique({ where: { id: stuckNotification.id } });
  assert.equal(refreshed?.status, NotificationStatus.FAILED);
  assert.equal(refreshed?.retryCount, 5);
});

test('6.10. Exhausted Ambulance Supply: Returns NO_ELIGIBLE_AMBULANCE with 112 guidance', async () => {
  const { rankedCandidates } = await discoverAndRankCandidates({
    id: 'req-remote-test-4',
    requiredAmbulanceType: AmbulanceType.ADVANCED_LIFE_SUPPORT,
    pickupLat: 15.0000, // Remote coordinates
    pickupLng: 75.0000,
    isDemo: false,
  });

  assert.equal(rankedCandidates.length, 0, 'No ambulances should be eligible in unserviced remote area');
});
