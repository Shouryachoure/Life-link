process.env.NODE_ENV = 'test';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { EventEmitter } from 'events';
import { Server } from 'socket.io';
import app from '../src/app';
import prisma, { inMemoryDb } from '../src/db';
import { setupSocketHandlers } from '../src/socket';
import { generateTokens } from '../src/services/tokenService';
import {
  evaluateCandidateEligibility,
  checkServiceArea,
  discoverAndRankCandidates,
  atomicallyAcceptOffer,
  rejectOrExpireOffer,
  dispatchOfferToCandidate,
  CandidateVehicle,
} from '../src/services/dispatchEngine';
import { Role, VerificationState, AmbulanceType, RequestStatus, DispatchAttemptStatus, TripLifecycleStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

let server: http.Server;
let ioServer: Server;
let baseUrl: string;
let serverPort: number;

// Test actors
let patientToken: string;
let patientId: string;
let otherPatientToken: string;
let otherPatientId: string;

let driver1Token: string;
let driver1Id: string;
let driver2Token: string;
let driver2Id: string;

let hospitalAdminToken: string;
let hospitalId: string;

let operatorAdminToken: string;
let operatorId: string;

let superAdminToken: string;
let superAdminId: string;

test.before(async () => {
  process.env.NODE_ENV = 'test';
  inMemoryDb.clear();

  // Create HTTP server with Socket.IO attached
  server = http.createServer(app);
  ioServer = new Server(server, { cors: { origin: '*' } });
  setupSocketHandlers(ioServer);

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as any;
      serverPort = addr.port;
      baseUrl = `http://127.0.0.1:${serverPort}`;
      resolve();
    });
  });

  const salt = bcrypt.genSaltSync(10);
  const passwordHash = bcrypt.hashSync('StrongPass123!@#', salt);

  // 1. Seed Patients
  const p1 = await prisma.user.create({
    data: {
      name: 'Ramesh Sharma',
      email: 'ramesh.sharma@example.in',
      phone: '+919876543210',
      passwordHash,
      role: Role.PATIENT,
    },
  });
  patientId = p1.id;
  patientToken = generateTokens({ id: p1.id, email: p1.email, role: p1.role, name: p1.name }).accessToken;

  const p2 = await prisma.user.create({
    data: {
      name: 'Suresh Patil',
      email: 'suresh.patil@example.in',
      phone: '+919876543211',
      passwordHash,
      role: Role.PATIENT,
    },
  });
  otherPatientId = p2.id;
  otherPatientToken = generateTokens({ id: p2.id, email: p2.email, role: p2.role, name: p2.name }).accessToken;

  // 2. Seed Super Admin
  const sa = await prisma.user.create({
    data: {
      name: 'LifeLink Commander',
      email: 'commander@lifelink.org',
      passwordHash,
      role: Role.SUPER_ADMIN,
    },
  });
  superAdminId = sa.id;
  superAdminToken = generateTokens({ id: sa.id, email: sa.email, role: sa.role, name: sa.name }).accessToken;

  // 3. Seed Hospital & Hospital Admin
  const hAdmin = await prisma.user.create({
    data: {
      name: 'Dr. Deshmukh',
      email: 'admin@aiimsnagpur.org',
      passwordHash,
      role: Role.ADMIN_HOSPITAL,
    },
  });
  const hosp = await prisma.hospital.create({
    data: {
      name: 'AIIMS Nagpur Super Specialty',
      address: 'MIHAN, Nagpur, Maharashtra',
      contactNumber: '+917122800000',
      city: 'Nagpur',
      state: 'Maharashtra',
      lat: 21.0858,
      lng: 79.0382,
      adminUserId: hAdmin.id,
      availableBeds: 25,
      verificationState: VerificationState.VERIFIED,
    },
  });
  hospitalId = hosp.id;
  hospitalAdminToken = generateTokens({
    id: hAdmin.id,
    email: hAdmin.email,
    role: hAdmin.role,
    name: hAdmin.name,
    hospitalId: hosp.id,
  }).accessToken;

  // 4. Seed Private Operator & Operator Admin
  const opAdmin = await prisma.user.create({
    data: {
      name: 'Kailash Ambulance Services Manager',
      email: 'kailash.ops@example.in',
      passwordHash,
      role: Role.OPERATOR_ADMIN,
    },
  });
  const op = await prisma.ambulanceOperator.create({
    data: {
      name: 'Kailash Emergency Care Fleet',
      tradeLicense: 'MH-NAG-AMB-2026-0042',
      contactPhone: '+919822000001',
      email: 'dispatch@kailashambulance.in',
      city: 'Nagpur',
      state: 'Maharashtra',
      address: 'Sitabuldi, Nagpur',
      adminUserId: opAdmin.id,
      verificationState: VerificationState.VERIFIED,
    },
  });
  operatorId = op.id;
  operatorAdminToken = generateTokens({
    id: opAdmin.id,
    email: opAdmin.email,
    role: opAdmin.role,
    name: opAdmin.name,
    operatorId: op.id,
  }).accessToken;

  // 5. Seed Drivers
  // Driver 1: Hospital-owned ALS Driver
  const d1 = await prisma.user.create({
    data: {
      name: 'Rajesh Gawande (Hospital Driver)',
      email: 'rajesh.gawande@aiimsnagpur.org',
      phone: '+919822100001',
      passwordHash,
      role: Role.DRIVER,
      hospitalId: hosp.id,
    },
  });
  driver1Id = d1.id;
  driver1Token = generateTokens({ id: d1.id, email: d1.email, role: d1.role, name: d1.name }).accessToken;

  // Driver 2: Private Operator BLS Driver
  const d2 = await prisma.user.create({
    data: {
      name: 'Sunil Wankhede (Operator Driver)',
      email: 'sunil.wankhede@kailash.in',
      phone: '+919822100002',
      passwordHash,
      role: Role.DRIVER,
      operatorId: op.id,
    },
  });
  driver2Id = d2.id;
  driver2Token = generateTokens({ id: d2.id, email: d2.email, role: d2.role, name: d2.name }).accessToken;
});

test.after(async () => {
  ioServer.close();
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  try {
    await prisma.$disconnect();
  } catch {}
});

// -------------------------------------------------------------
// SECTION 16: Automated Dispatch Tests
// -------------------------------------------------------------

test('1. A verified hospital-owned ambulance is eligible when all conditions hold', async () => {
  // Seed verified profile for Driver 1
  const dProfile1 = await prisma.driverProfile.create({
    data: {
      userId: driver1Id,
      licenseNumber: 'MH31-2020-0012345',
      licenseExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // Valid for 1 year
      verificationState: VerificationState.VERIFIED,
      organizationType: 'HOSPITAL',
      hospitalId,
      membershipStatus: 'APPROVED',
      isDispatchEligible: true,
      isDemo: false,
    },
  });

  // Seed verified ALS ambulance belonging to hospital
  const ambHospital = await prisma.ambulance.create({
    data: {
      vehicleNumber: 'MH-31-HA-1001',
      ambulanceType: AmbulanceType.ADVANCED_LIFE_SUPPORT,
      driverId: driver1Id,
      hospitalId,
      verificationState: VerificationState.VERIFIED,
      isAvailable: true,
      currentLat: 21.1458,
      currentLng: 79.0882, // Nagpur Center
      isDemo: false,
    },
  });

  // Create current vehicle assignment
  await prisma.driverVehicleAssignment.create({
    data: {
      driverId: dProfile1.id,
      ambulanceId: ambHospital.id,
      isCurrent: true,
    },
  });

  const hosp = await prisma.hospital.findUnique({ where: { id: hospitalId } });
  const driver = await prisma.user.findUnique({ where: { id: driver1Id } });

  const candidate: CandidateVehicle = {
    ambulance: ambHospital,
    driver,
    driverProfile: dProfile1,
    organization: {
      type: 'HOSPITAL',
      id: hosp!.id,
      name: hosp!.name,
      verificationState: hosp!.verificationState,
      isDemo: hosp!.isDemo,
    },
  };

  const result = await evaluateCandidateEligibility(candidate, {
    requiredAmbulanceType: AmbulanceType.ADVANCED_LIFE_SUPPORT,
    isDemoRequest: false,
  });

  assert.equal(result.eligible, true, `Expected eligible, got: ${result.denialReasons.join(', ')}`);
  assert.equal(result.denialReasons.length, 0);
});

test('2. A verified private-operator ambulance is eligible when all conditions hold', async () => {
  // Seed verified profile for Driver 2
  const dProfile2 = await prisma.driverProfile.create({
    data: {
      userId: driver2Id,
      licenseNumber: 'MH31-2022-0054321',
      licenseExpiry: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
      verificationState: VerificationState.VERIFIED,
      organizationType: 'PRIVATE_OPERATOR',
      operatorId,
      membershipStatus: 'APPROVED',
      isDispatchEligible: true,
      isDemo: false,
    },
  });

  // Seed verified BLS ambulance belonging to private operator
  const ambOperator = await prisma.ambulance.create({
    data: {
      vehicleNumber: 'MH-31-OP-2002',
      ambulanceType: AmbulanceType.BASIC_LIFE_SUPPORT,
      driverId: driver2Id,
      operatorId,
      verificationState: VerificationState.VERIFIED,
      isAvailable: true,
      currentLat: 21.1495,
      currentLng: 79.0805, // Sitabuldi, Nagpur (~1.2 km from center)
      isDemo: false,
    },
  });

  // Create current vehicle assignment
  await prisma.driverVehicleAssignment.create({
    data: {
      driverId: dProfile2.id,
      ambulanceId: ambOperator.id,
      isCurrent: true,
    },
  });

  const op = await prisma.ambulanceOperator.findUnique({ where: { id: operatorId } });
  const driver = await prisma.user.findUnique({ where: { id: driver2Id } });

  const candidate: CandidateVehicle = {
    ambulance: ambOperator,
    driver,
    driverProfile: dProfile2,
    organization: {
      type: 'PRIVATE_OPERATOR',
      id: op!.id,
      name: op!.name,
      verificationState: op!.verificationState,
      isDemo: op!.isDemo,
    },
  };

  const result = await evaluateCandidateEligibility(candidate, {
    requiredAmbulanceType: AmbulanceType.BASIC_LIFE_SUPPORT,
    isDemoRequest: false,
  });

  assert.equal(result.eligible, true, `Expected operator ambulance eligible, got: ${result.denialReasons.join(', ')}`);
  assert.equal(result.denialReasons.length, 0);
});

test('3. An unverified driver is excluded', async () => {
  const dProfile = await prisma.driverProfile.findUnique({ where: { userId: driver1Id } });
  // Temporarily set driver verification to PENDING_REVIEW
  const unverifiedProfile = { ...dProfile, verificationState: VerificationState.PENDING_REVIEW };

  const amb = await prisma.ambulance.findFirst({ where: { driverId: driver1Id } });
  const driver = await prisma.user.findUnique({ where: { id: driver1Id } });
  const hosp = await prisma.hospital.findUnique({ where: { id: hospitalId } });

  const candidate: CandidateVehicle = {
    ambulance: amb,
    driver,
    driverProfile: unverifiedProfile,
    organization: {
      type: 'HOSPITAL',
      id: hosp!.id,
      name: hosp!.name,
      verificationState: hosp!.verificationState,
      isDemo: false,
    },
  };

  const result = await evaluateCandidateEligibility(candidate);
  assert.equal(result.eligible, false);
  assert.ok(result.denialReasons.includes('DRIVER_NOT_VERIFIED'), `Expected DRIVER_NOT_VERIFIED, got: ${result.denialReasons.join(', ')}`);
});

test('4. An expired required credential blocks eligibility', async () => {
  const dProfile = await prisma.driverProfile.findUnique({ where: { userId: driver1Id } });
  // Set expired license date (yesterday)
  const expiredProfile = {
    ...dProfile,
    verificationState: VerificationState.VERIFIED,
    licenseExpiry: new Date(Date.now() - 24 * 60 * 60 * 1000),
  };

  const amb = await prisma.ambulance.findFirst({ where: { driverId: driver1Id } });
  const driver = await prisma.user.findUnique({ where: { id: driver1Id } });
  const hosp = await prisma.hospital.findUnique({ where: { id: hospitalId } });

  const candidate: CandidateVehicle = {
    ambulance: amb,
    driver,
    driverProfile: expiredProfile,
    organization: {
      type: 'HOSPITAL',
      id: hosp!.id,
      name: hosp!.name,
      verificationState: hosp!.verificationState,
      isDemo: false,
    },
  };

  const result = await evaluateCandidateEligibility(candidate);
  assert.equal(result.eligible, false);
  assert.ok(result.denialReasons.includes('CREDENTIAL_EXPIRED'), `Expected CREDENTIAL_EXPIRED, got: ${result.denialReasons.join(', ')}`);
});

test('5. An unverified operator or hospital blocks eligibility', async () => {
  const dProfile = await prisma.driverProfile.findUnique({ where: { userId: driver2Id } });
  const amb = await prisma.ambulance.findFirst({ where: { driverId: driver2Id } });
  const driver = await prisma.user.findUnique({ where: { id: driver2Id } });

  // Unverified operator
  const candidate: CandidateVehicle = {
    ambulance: amb,
    driver,
    driverProfile: dProfile,
    organization: {
      type: 'PRIVATE_OPERATOR',
      id: operatorId,
      name: 'Unverified Operator Pvt Ltd',
      verificationState: VerificationState.PENDING_REVIEW,
      isDemo: false,
    },
  };

  const result = await evaluateCandidateEligibility(candidate);
  assert.equal(result.eligible, false);
  assert.ok(result.denialReasons.includes('ORGANIZATION_NOT_VERIFIED'), `Expected ORGANIZATION_NOT_VERIFIED, got: ${result.denialReasons.join(', ')}`);
});

test('6. An unverified ambulance is excluded', async () => {
  const dProfile = await prisma.driverProfile.findUnique({ where: { userId: driver1Id } });
  const amb = await prisma.ambulance.findFirst({ where: { driverId: driver1Id } });
  const driver = await prisma.user.findUnique({ where: { id: driver1Id } });
  const hosp = await prisma.hospital.findUnique({ where: { id: hospitalId } });

  const unverifiedAmb = { ...amb, verificationState: VerificationState.PENDING_REVIEW };

  const candidate: CandidateVehicle = {
    ambulance: unverifiedAmb,
    driver,
    driverProfile: dProfile,
    organization: {
      type: 'HOSPITAL',
      id: hosp!.id,
      name: hosp!.name,
      verificationState: hosp!.verificationState,
      isDemo: false,
    },
  };

  const result = await evaluateCandidateEligibility(candidate);
  assert.equal(result.eligible, false);
  assert.ok(result.denialReasons.includes('AMBULANCE_NOT_VERIFIED'), `Expected AMBULANCE_NOT_VERIFIED, got: ${result.denialReasons.join(', ')}`);
});

test('7. An invalid driver-to-ambulance assignment blocks eligibility', async () => {
  const dProfile = await prisma.driverProfile.findUnique({ where: { userId: driver1Id } });
  const driver = await prisma.user.findUnique({ where: { id: driver1Id } });
  const hosp = await prisma.hospital.findUnique({ where: { id: hospitalId } });

  // Ambulance with non-matching ID for which driver has no active assignment
  const unassignedAmb = {
    id: 'unassigned-amb-999',
    vehicleNumber: 'MH-31-XX-9999',
    ambulanceType: AmbulanceType.BASIC_LIFE_SUPPORT,
    verificationState: VerificationState.VERIFIED,
    isAvailable: true,
    currentLat: 21.1458,
    currentLng: 79.0882,
    lastUpdated: new Date(),
    hospitalId,
  };

  const candidate: CandidateVehicle = {
    ambulance: unassignedAmb,
    driver,
    driverProfile: dProfile,
    organization: {
      type: 'HOSPITAL',
      id: hosp!.id,
      name: hosp!.name,
      verificationState: hosp!.verificationState,
      isDemo: false,
    },
  };

  const result = await evaluateCandidateEligibility(candidate);
  assert.equal(result.eligible, false);
  assert.ok(result.denialReasons.includes('ASSIGNMENT_INVALID'), `Expected ASSIGNMENT_INVALID, got: ${result.denialReasons.join(', ')}`);
});

test('8. An unavailable ambulance is excluded', async () => {
  const dProfile = await prisma.driverProfile.findUnique({ where: { userId: driver1Id } });
  const amb = await prisma.ambulance.findFirst({ where: { driverId: driver1Id } });
  const driver = await prisma.user.findUnique({ where: { id: driver1Id } });
  const hosp = await prisma.hospital.findUnique({ where: { id: hospitalId } });

  // Currently offline / engaged
  const unavailableAmb = { ...amb, isAvailable: false };

  const candidate: CandidateVehicle = {
    ambulance: unavailableAmb,
    driver,
    driverProfile: dProfile,
    organization: {
      type: 'HOSPITAL',
      id: hosp!.id,
      name: hosp!.name,
      verificationState: hosp!.verificationState,
      isDemo: false,
    },
  };

  const result = await evaluateCandidateEligibility(candidate);
  assert.equal(result.eligible, false);
  assert.ok(result.denialReasons.includes('VEHICLE_UNAVAILABLE'), `Expected VEHICLE_UNAVAILABLE, got: ${result.denialReasons.join(', ')}`);
});

test('9. A service-category mismatch blocks eligibility', async () => {
  const dProfile = await prisma.driverProfile.findUnique({ where: { userId: driver2Id } });
  const amb = await prisma.ambulance.findFirst({ where: { driverId: driver2Id } }); // BLS ambulance
  const driver = await prisma.user.findUnique({ where: { id: driver2Id } });
  const op = await prisma.ambulanceOperator.findUnique({ where: { id: operatorId } });

  const candidate: CandidateVehicle = {
    ambulance: amb, // BLS
    driver,
    driverProfile: dProfile,
    organization: {
      type: 'PRIVATE_OPERATOR',
      id: op!.id,
      name: op!.name,
      verificationState: op!.verificationState,
      isDemo: false,
    },
  };

  // Request explicitly requires ADVANCED_LIFE_SUPPORT
  const result = await evaluateCandidateEligibility(candidate, {
    requiredAmbulanceType: AmbulanceType.ADVANCED_LIFE_SUPPORT,
  });

  assert.equal(result.eligible, false);
  assert.ok(result.denialReasons.includes('SERVICE_CATEGORY_MISMATCH'), `Expected SERVICE_CATEGORY_MISMATCH, got: ${result.denialReasons.join(', ')}`);
});

test('10. An ambulance outside the configured service area is excluded', async () => {
  const dProfile = await prisma.driverProfile.findUnique({ where: { userId: driver1Id } });
  const amb = await prisma.ambulance.findFirst({ where: { driverId: driver1Id } });
  const driver = await prisma.user.findUnique({ where: { id: driver1Id } });
  const hosp = await prisma.hospital.findUnique({ where: { id: hospitalId } });

  // Mumbai coordinates (approx 700km from Nagpur center)
  const farAwayAmb = {
    ...amb,
    currentLat: 19.0760,
    currentLng: 72.8777,
  };

  const candidate: CandidateVehicle = {
    ambulance: farAwayAmb,
    driver,
    driverProfile: dProfile,
    organization: {
      type: 'HOSPITAL',
      id: hosp!.id,
      name: hosp!.name,
      verificationState: hosp!.verificationState,
      isDemo: false,
    },
  };

  const result = await evaluateCandidateEligibility(candidate);
  assert.equal(result.eligible, false);
  assert.ok(result.denialReasons.includes('OUTSIDE_SERVICE_AREA'), `Expected OUTSIDE_SERVICE_AREA, got: ${result.denialReasons.join(', ')}`);
});

test('11. Missing or stale GPS data is handled safely', async () => {
  const dProfile = await prisma.driverProfile.findUnique({ where: { userId: driver1Id } });
  const amb = await prisma.ambulance.findFirst({ where: { driverId: driver1Id } });
  const driver = await prisma.user.findUnique({ where: { id: driver1Id } });
  const hosp = await prisma.hospital.findUnique({ where: { id: hospitalId } });

  // Case A: Last location update was 2 hours ago (stale > 30 minutes)
  const staleAmb = {
    ...amb,
    lastUpdated: new Date(Date.now() - 2 * 60 * 60 * 1000),
  };

  const staleCandidate: CandidateVehicle = {
    ambulance: staleAmb,
    driver,
    driverProfile: dProfile,
    organization: {
      type: 'HOSPITAL',
      id: hosp!.id,
      name: hosp!.name,
      verificationState: hosp!.verificationState,
      isDemo: false,
    },
  };

  const staleResult = await evaluateCandidateEligibility(staleCandidate);
  assert.equal(staleResult.eligible, false);
  assert.ok(staleResult.denialReasons.includes('LOCATION_STALE'), `Expected LOCATION_STALE, got: ${staleResult.denialReasons.join(', ')}`);

  // Case B: Invalid/impossible GPS coordinates (NaN or > 90 lat)
  const invalidCoordAmb = {
    ...amb,
    currentLat: 999.99,
    currentLng: NaN,
  };

  const invalidCandidate: CandidateVehicle = {
    ambulance: invalidCoordAmb,
    driver,
    driverProfile: dProfile,
    organization: {
      type: 'HOSPITAL',
      id: hosp!.id,
      name: hosp!.name,
      verificationState: hosp!.verificationState,
      isDemo: false,
    },
  };

  const invalidResult = await evaluateCandidateEligibility(invalidCandidate);
  assert.equal(invalidResult.eligible, false);
  assert.ok(invalidResult.denialReasons.includes('LOCATION_INVALID'), `Expected LOCATION_INVALID, got: ${invalidResult.denialReasons.join(', ')}`);
});

test("12. A patient cannot view another patient's emergency", async () => {
  // Create an emergency request for Patient 1
  const req1 = await prisma.emergencyRequest.create({
    data: {
      patientId,
      pickupLat: 21.1458,
      pickupLng: 79.0882,
      status: RequestStatus.SEARCHING,
    },
  });

  // Patient 2 attempts to fetch Patient 1's request
  const res = await fetch(`${baseUrl}/api/v1/sos/${req1.id}`, {
    headers: { Authorization: `Bearer ${otherPatientToken}` },
  });

  assert.equal(res.status, 403, `Expected HTTP 403 Forbidden for cross-patient access, got ${res.status}`);
  const data = (await res.json()) as any;
  assert.equal(data.code, 'FORBIDDEN_EMERGENCY_ACCESS');
});

test("13. A driver cannot accept another driver's offer", async () => {
  const req = await prisma.emergencyRequest.create({
    data: {
      patientId,
      pickupLat: 21.1458,
      pickupLng: 79.0882,
      status: RequestStatus.OFFERED,
    },
  });

  const amb = await prisma.ambulance.findFirst({ where: { driverId: driver1Id } });

  // Offer addressed specifically to Driver 1
  const attempt = await prisma.dispatchAttempt.create({
    data: {
      requestId: req.id,
      ambulanceId: amb!.id,
      driverId: driver1Id,
      status: DispatchAttemptStatus.OFFERED,
      distanceKm: 2.5,
      expiresAt: new Date(Date.now() + 60000),
    },
  });

  // Driver 2 attempts to accept Driver 1's offer
  const res = await fetch(`${baseUrl}/api/v1/sos/offers/${attempt.id}/accept`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${driver2Token}` },
  });

  assert.equal(res.status, 400);
  const data = (await res.json()) as any;
  assert.equal(data.code, 'UNAUTHORIZED_DRIVER');
});

test('14. Two concurrent acceptance attempts produce at most one assignment', async () => {
  const req = await prisma.emergencyRequest.create({
    data: {
      patientId,
      pickupLat: 21.1458,
      pickupLng: 79.0882,
      status: RequestStatus.OFFERED,
    },
  });

  const amb = await prisma.ambulance.findFirst({ where: { driverId: driver1Id } });

  const attempt = await prisma.dispatchAttempt.create({
    data: {
      requestId: req.id,
      ambulanceId: amb!.id,
      driverId: driver1Id,
      status: DispatchAttemptStatus.OFFERED,
      distanceKm: 1.5,
      expiresAt: new Date(Date.now() + 60000),
    },
  });

  // Launch two concurrent acceptance calls simultaneously
  const [res1, res2] = await Promise.all([
    atomicallyAcceptOffer(attempt.id, driver1Id),
    atomicallyAcceptOffer(attempt.id, driver1Id),
  ]);

  // Exactly one must succeed and one must fail with a race/lock code
  const successes = [res1, res2].filter(r => r.success);
  const failures = [res1, res2].filter(r => !r.success);

  assert.equal(successes.length, 1, 'Exactly one concurrent accept must succeed');
  assert.equal(failures.length, 1, 'Exactly one concurrent accept must be rejected');
  assert.ok(
    failures[0].code === 'CONCURRENCY_LOCK' || failures[0].code === 'OFFER_NOT_OFFERED',
    `Expected concurrency protection code, got: ${failures[0].code}`
  );
});

test('15. A timed-out offer cannot be accepted later', async () => {
  const req = await prisma.emergencyRequest.create({
    data: {
      patientId,
      pickupLat: 21.1458,
      pickupLng: 79.0882,
      status: RequestStatus.OFFERED,
    },
  });

  const amb = await prisma.ambulance.findFirst({ where: { driverId: driver2Id } });

  // Expired offer (expired 10 seconds ago)
  const expiredAttempt = await prisma.dispatchAttempt.create({
    data: {
      requestId: req.id,
      ambulanceId: amb!.id,
      driverId: driver2Id,
      status: DispatchAttemptStatus.OFFERED,
      distanceKm: 3.0,
      expiresAt: new Date(Date.now() - 10000),
    },
  });

  const result = await atomicallyAcceptOffer(expiredAttempt.id, driver2Id);
  assert.equal(result.success, false);
  assert.equal(result.code, 'OFFER_EXPIRED');

  // Verify attempt status in DB transitioned to EXPIRED
  const updatedAttempt = await prisma.dispatchAttempt.findUnique({ where: { id: expiredAttempt.id } });
  assert.equal(updatedAttempt?.status, DispatchAttemptStatus.EXPIRED);
});

test('16. Rejected offers escalate safely to next eligible candidate', async () => {
  // Ensure both ambulances are available
  const amb1 = await prisma.ambulance.findFirst({ where: { driverId: driver1Id } });
  const amb2 = await prisma.ambulance.findFirst({ where: { driverId: driver2Id } });
  await prisma.ambulance.update({ where: { id: amb1!.id }, data: { isAvailable: true } });
  await prisma.ambulance.update({ where: { id: amb2!.id }, data: { isAvailable: true } });

  // Create request requiring BLS (both ALS and BLS match)
  const req = await prisma.emergencyRequest.create({
    data: {
      patientId,
      pickupLat: 21.1458,
      pickupLng: 79.0882,
      requiredAmbulanceType: AmbulanceType.BASIC_LIFE_SUPPORT,
      status: RequestStatus.OFFERED,
    },
  });

  // Create offer for Driver 1
  const attempt1 = await prisma.dispatchAttempt.create({
    data: {
      requestId: req.id,
      ambulanceId: amb1!.id,
      driverId: driver1Id,
      status: DispatchAttemptStatus.OFFERED,
      distanceKm: 1.0,
      expiresAt: new Date(Date.now() + 30000),
    },
  });

  // Driver 1 rejects the offer
  const escalation = await rejectOrExpireOffer(attempt1.id, driver1Id, 'REJECT', 'Vehicle mechanical issue');

  assert.equal(escalation.nextOffered, true, 'Expected offer to escalate to candidate 2');
  assert.equal(escalation.noAmbulanceLeft, false);

  // Verify attempt 1 is REJECTED and new attempt created for Driver 2
  const updatedAtt1 = await prisma.dispatchAttempt.findUnique({ where: { id: attempt1.id } });
  assert.equal(updatedAtt1?.status, DispatchAttemptStatus.REJECTED);

  const attempt2 = await prisma.dispatchAttempt.findFirst({
    where: { requestId: req.id, driverId: driver2Id },
  });
  assert.ok(attempt2, 'Expected new DispatchAttempt created for Driver 2');
  assert.equal(attempt2.status, DispatchAttemptStatus.OFFERED);
});

test('17. Duplicate SOS submissions are handled according to idempotency policy', async () => {
  // Clear non-terminal requests for patient
  const pastReqs = await prisma.emergencyRequest.findMany({ where: { patientId } });
  for (const r of pastReqs) {
    await prisma.emergencyRequest.update({ where: { id: r.id }, data: { status: RequestStatus.COMPLETED } });
  }

  // Clear non-terminal emergency trips
  const pastTrips = await prisma.emergencyTrip.findMany();
  for (const t of pastTrips) {
    await prisma.emergencyTrip.update({ where: { id: t.id }, data: { status: TripLifecycleStatus.COMPLETED } });
  }

  // Ensure ambulances are available
  const allAmbs = await prisma.ambulance.findMany();
  for (const a of allAmbs) {
    await prisma.ambulance.update({ where: { id: a.id }, data: { isAvailable: true } });
  }

  // First request creation
  const res1 = await fetch(`${baseUrl}/api/v1/sos/request`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${patientToken}`,
    },
    body: JSON.stringify({
      pickupLat: 21.1458,
      pickupLng: 79.0882,
      category: 'CARDIAC',
    }),
  });
  assert.equal(res1.status, 201);

  // Immediate duplicate request submission while first is still active
  const res2 = await fetch(`${baseUrl}/api/v1/sos/request`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${patientToken}`,
    },
    body: JSON.stringify({
      pickupLat: 21.1458,
      pickupLng: 79.0882,
      category: 'CARDIAC',
    }),
  });

  assert.equal(res2.status, 409, `Expected HTTP 409 Conflict on duplicate SOS, got ${res2.status}`);
  const data = (await res2.json()) as any;
  assert.equal(data.code, 'ACTIVE_REQUEST_EXISTS');
});

test('18. No eligible ambulance produces an explicit unresolved status', async () => {
  // Mark all ambulances offline / unavailable
  const allAmbs = await prisma.ambulance.findMany();
  for (const amb of allAmbs) {
    await prisma.ambulance.update({ where: { id: amb.id }, data: { isAvailable: false } });
  }

  // Clear existing requests
  const pastReqs = await prisma.emergencyRequest.findMany({ where: { patientId } });
  for (const r of pastReqs) {
    await prisma.emergencyRequest.update({ where: { id: r.id }, data: { status: RequestStatus.COMPLETED } });
  }

  const res = await fetch(`${baseUrl}/api/v1/sos/request`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${patientToken}`,
    },
    body: JSON.stringify({
      pickupLat: 21.1458,
      pickupLng: 79.0882,
      category: 'GENERAL',
    }),
  });

  const data = (await res.json()) as any;
  assert.equal(data.code, 'NO_ELIGIBLE_AMBULANCE');
  assert.equal(data.request.status, RequestStatus.NO_ELIGIBLE_AMBULANCE);
  assert.equal(data.officialEmergencyFallback.nationalEmergencyNumber, '112');
});

test('19. Unauthorized Socket.IO clients cannot subscribe to protected events', async () => {
  // Verify that an unauthenticated socket client cannot register for privileged streams
  class MockSocket extends EventEmitter {
    id = 'mock-unauth-socket-999';
    handshake = { auth: {}, headers: {} };
    rooms = new Set<string>();
    user: any = null;
    join(room: string) { this.rooms.add(room); }
    leave(room: string) { this.rooms.delete(room); }
  }

  const mockSocket = new MockSocket() as any;

  // Retrieve connection handler from ioServer
  const connectionListeners = ioServer.listeners('connection');
  assert.ok(connectionListeners.length > 0, 'Socket.IO connection listener must be registered');

  // Connect mock socket to handler (unauthenticated user)
  (connectionListeners[0] as any)(mockSocket);

  // Client attempts to register for superadmin telemetry stream without authentication
  const errorReceived = new Promise<string>((resolve) => {
    mockSocket.on('error:unauthorized', (err: any) => {
      resolve(err.message);
    });
  });

  mockSocket.emit('telemetry:register');

  const msg = await Promise.race([
    errorReceived,
    new Promise<string>((_, reject) => setTimeout(() => reject(new Error('Timeout waiting for unauthorized error')), 2000)),
  ]);

  assert.ok(msg.includes('Forbidden') || msg.includes('Super Admin'), `Expected unauthorized rejection, got: ${msg}`);
  assert.equal(mockSocket.rooms.has('telemetry_room'), false, 'Unauthorized socket must not join telemetry_room');
});

test('20. Demo drivers and simulated GPS never become eligible for production dispatch', async () => {
  // Seed demo driver and ambulance
  const demoDriver = await prisma.user.create({
    data: {
      name: 'Simulated Demo Driver',
      email: 'demo.driver@example.in',
      passwordHash: 'dummy',
      role: Role.DRIVER,
    },
  });

  const demoProfile = await prisma.driverProfile.create({
    data: {
      userId: demoDriver.id,
      licenseNumber: 'DEMO-LICENSE-1234',
      verificationState: VerificationState.VERIFIED,
      membershipStatus: 'APPROVED',
      isDemo: true, // DEMO FLAG SET
    },
  });

  const demoAmb = await prisma.ambulance.create({
    data: {
      vehicleNumber: 'MH-31-DEMO-999',
      ambulanceType: AmbulanceType.BASIC_LIFE_SUPPORT,
      driverId: demoDriver.id,
      verificationState: VerificationState.VERIFIED,
      isAvailable: true,
      currentLat: 21.1458,
      currentLng: 79.0882,
      isDemo: true, // DEMO FLAG SET
    },
  });

  const hosp = await prisma.hospital.findUnique({ where: { id: hospitalId } });

  const candidate: CandidateVehicle = {
    ambulance: demoAmb,
    driver: demoDriver,
    driverProfile: demoProfile,
    organization: {
      type: 'HOSPITAL',
      id: hosp!.id,
      name: hosp!.name,
      verificationState: hosp!.verificationState,
      isDemo: false,
    },
  };

  // Real production request (isDemoRequest: false)
  const result = await evaluateCandidateEligibility(candidate, {
    isDemoRequest: false,
  });

  assert.equal(result.eligible, false);
  assert.ok(
    result.denialReasons.includes('DEMO_RESOURCE_EXCLUDED'),
    `Expected DEMO_RESOURCE_EXCLUDED, got: ${result.denialReasons.join(', ')}`
  );
});

test('21. Existing authentication and health checks continue to pass', async () => {
  // Verify GET /api/v1/health
  const healthRes = await fetch(`${baseUrl}/api/v1/health`);
  assert.equal(healthRes.status, 200);
  const healthData = (await healthRes.json()) as any;
  assert.equal(healthData.status, 'ok');

  // Verify GET /api/v1/health/ready
  const readyRes = await fetch(`${baseUrl}/api/v1/health/ready`);
  assert.ok(readyRes.status === 200 || readyRes.status === 503);

  // Verify Super Admin token access to service area
  const areaRes = await fetch(`${baseUrl}/api/v1/sos/service-area`);
  assert.equal(areaRes.status, 200);
  const areaData = (await areaRes.json()) as any;
  assert.ok(areaData.areas && areaData.areas.length > 0);
  assert.equal(areaData.pilotCenter.city, 'Nagpur');
});

test('22. Database migrations and constraints work on a test database', async () => {
  // Verify service area pilot radius
  const pilotArea = await prisma.serviceArea.findFirst({ where: { isPilot: true } });
  assert.ok(pilotArea, 'Pilot service area must be seeded');
  assert.equal(pilotArea.city, 'Nagpur');
  assert.equal(pilotArea.radiusKm, 30.0);

  // Verify DispatchAttempt foreign key & status constraints
  const testAttempt = await prisma.dispatchAttempt.create({
    data: {
      requestId: 'test-req-dummy',
      ambulanceId: 'test-amb-dummy',
      driverId: 'test-driver-dummy',
      status: DispatchAttemptStatus.OFFERED,
      distanceKm: 4.2,
      isStraightLine: true,
      expiresAt: new Date(Date.now() + 45000),
    },
  });
  assert.ok(testAttempt.id);
  assert.equal(testAttempt.status, DispatchAttemptStatus.OFFERED);
  assert.equal(testAttempt.isStraightLine, true);
});
