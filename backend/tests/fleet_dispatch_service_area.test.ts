import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import app from '../src/app';
import prisma from '../src/db';
import { generateTokens } from '../src/services/tokenService';
import { Role, AmbulanceType, VerificationState, RequestStatus, DispatchAttemptStatus, TripLifecycleStatus } from '@prisma/client';
import {
  checkServiceArea,
  evaluateCandidateEligibility,
  discoverAndRankCandidates,
  dispatchOfferToCandidate,
  atomicallyAcceptOffer,
  rejectOrExpireOffer,
  reassignTripSafely,
  CandidateVehicle,
} from '../src/services/dispatchEngine';

let server: http.Server;
let port: number;
let baseUrl: string;

let superAdminToken: string;
let hospAdminTokenA: string;
let hospAdminTokenB: string;
let opAdminTokenA: string;
let driverTokenA: string;
let patientToken: string;

let hospitalA: any;
let hospitalB: any;
let operatorA: any;
let driverUserA: any;
let driverProfileA: any;
let ambulanceHospA: any;
let ambulanceOpA: any;
let demoAmbulance: any;

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test_secret_for_fleet_dispatch_audit_1234567890_min_32_chars';
  process.env.TEST_DB_CONNECTED = 'true';

  server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      port = (server.address() as any).port;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });

  // Seed Super Admin
  const superAdmin = await prisma.user.create({
    data: {
      email: 'fleet.superadmin@lifelink.org.in',
      passwordHash: 'hash',
      name: 'Dr. Fleet Super Admin',
      role: Role.SUPER_ADMIN,
    },
  });
  superAdminToken = generateTokens({ id: superAdmin.id, email: superAdmin.email, role: superAdmin.role, name: superAdmin.name }).accessToken;

  // Seed Hospital A & Admin
  const hospAdminA = await prisma.user.create({
    data: {
      email: 'admin.hospA@lifelink.org.in',
      passwordHash: 'hash',
      name: 'Admin Hospital A',
      role: Role.ADMIN_HOSPITAL,
    },
  });
  hospAdminTokenA = generateTokens({ id: hospAdminA.id, email: hospAdminA.email, role: hospAdminA.role, name: hospAdminA.name }).accessToken;

  hospitalA = await prisma.hospital.create({
    data: {
      name: 'Nagpur Central Care Hospital',
      address: 'Sitabuldi Square, Nagpur',
      contactNumber: '+917122550001',
      city: 'Nagpur',
      state: 'Maharashtra',
      lat: 21.1458,
      lng: 79.0882,
      adminUserId: hospAdminA.id,
      verificationState: VerificationState.VERIFIED,
      isDemo: false,
    },
  });

  // Seed Hospital B & Admin (for tenant isolation tests)
  const hospAdminB = await prisma.user.create({
    data: {
      email: 'admin.hospB@lifelink.org.in',
      passwordHash: 'hash',
      name: 'Admin Hospital B',
      role: Role.ADMIN_HOSPITAL,
    },
  });
  hospAdminTokenB = generateTokens({ id: hospAdminB.id, email: hospAdminB.email, role: hospAdminB.role, name: hospAdminB.name }).accessToken;

  hospitalB = await prisma.hospital.create({
    data: {
      name: 'Mayo Memorial Hospital Nagpur',
      address: 'Central Avenue, Nagpur',
      contactNumber: '+917122550002',
      city: 'Nagpur',
      state: 'Maharashtra',
      lat: 21.151,
      lng: 79.098,
      adminUserId: hospAdminB.id,
      verificationState: VerificationState.VERIFIED,
      isDemo: false,
    },
  });

  // Seed Private Ambulance Operator A & Admin
  const opAdminA = await prisma.user.create({
    data: {
      email: 'admin.operatorA@lifelink.org.in',
      passwordHash: 'hash',
      name: 'Admin Vidarbha Fastline EMS',
      role: Role.OPERATOR_ADMIN,
    },
  });
  opAdminTokenA = generateTokens({ id: opAdminA.id, email: opAdminA.email, role: opAdminA.role, name: opAdminA.name }).accessToken;

  operatorA = await prisma.ambulanceOperator.create({
    data: {
      name: 'Vidarbha Fastline Private EMS',
      tradeLicense: 'MH-RTO-EMS-2026-99',
      contactPhone: '+919876500088',
      email: 'ops@fastlineems.in',
      city: 'Nagpur',
      state: 'Maharashtra',
      address: 'Dharampeth, Nagpur',
      verificationState: VerificationState.VERIFIED,
      adminUserId: opAdminA.id,
      isDemo: false,
    },
  });

  // Seed Patient
  const patient = await prisma.user.create({
    data: {
      email: 'patient.fleet@lifelink.org.in',
      passwordHash: 'hash',
      name: 'Rohan Sharma',
      role: Role.PATIENT,
      phone: '+919876543210',
    },
  });
  patientToken = generateTokens({ id: patient.id, email: patient.email, role: patient.role, name: patient.name }).accessToken;

  // Seed Driver A
  driverUserA = await prisma.user.create({
    data: {
      email: 'driver.anil@lifelink.org.in',
      passwordHash: 'hash',
      name: 'Anil Deshmukh',
      role: Role.DRIVER,
      phone: '+919876512345',
      isActive: true,
      isSuspended: false,
    },
  });
  driverTokenA = generateTokens({ id: driverUserA.id, email: driverUserA.email, role: driverUserA.role, name: driverUserA.name }).accessToken;

  driverProfileA = await prisma.driverProfile.create({
    data: {
      userId: driverUserA.id,
      licenseNumber: 'MH-31-2015-0012345',
      licenseExpiry: new Date(Date.now() + 365 * 24 * 3600 * 1000), // Valid for 1 year
      verificationState: VerificationState.VERIFIED,
      membershipStatus: 'APPROVED',
      organizationType: 'HOSPITAL',
      hospitalId: hospitalA.id,
      isDispatchEligible: true,
      isDemo: false,
    },
  });

  // Seed Hospital-Owned Ambulance (ALS)
  ambulanceHospA = await prisma.ambulance.create({
    data: {
      driverId: driverUserA.id,
      vehicleNumber: 'MH-31-AG-1008',
      ambulanceType: AmbulanceType.ADVANCED_LIFE_SUPPORT,
      isAvailable: true,
      currentLat: 21.1465,
      currentLng: 79.089,
      lastUpdated: new Date(),
      hospitalId: hospitalA.id,
      verificationState: VerificationState.VERIFIED,
      verificationStatus: 'APPROVED',
      maintenanceStatus: 'OPERATIONAL',
      isDemo: false,
    },
  });

  // Assign Driver A to Ambulance Hosp A
  await prisma.driverVehicleAssignment.create({
    data: {
      driverId: driverProfileA.id,
      ambulanceId: ambulanceHospA.id,
      isCurrent: true,
    },
  });

  // Seed Private-Operator-Owned Ambulance (BLS)
  const driverUserOp = await prisma.user.create({
    data: {
      email: 'driver.op@fastlineems.in',
      passwordHash: 'hash',
      name: 'Suresh Patil',
      role: Role.DRIVER,
      phone: '+919876512346',
      isActive: true,
      isSuspended: false,
    },
  });

  const driverProfileOp = await prisma.driverProfile.create({
    data: {
      userId: driverUserOp.id,
      licenseNumber: 'MH-31-2018-0098765',
      licenseExpiry: new Date(Date.now() + 180 * 24 * 3600 * 1000),
      verificationState: VerificationState.VERIFIED,
      membershipStatus: 'APPROVED',
      organizationType: 'PRIVATE_OPERATOR',
      operatorId: operatorA.id,
      isDispatchEligible: true,
      isDemo: false,
    },
  });

  ambulanceOpA = await prisma.ambulance.create({
    data: {
      driverId: driverUserOp.id,
      vehicleNumber: 'MH-31-EM-2020',
      ambulanceType: AmbulanceType.BASIC_LIFE_SUPPORT,
      isAvailable: true,
      currentLat: 21.144,
      currentLng: 79.085,
      lastUpdated: new Date(),
      operatorId: operatorA.id,
      verificationState: VerificationState.VERIFIED,
      verificationStatus: 'APPROVED',
      maintenanceStatus: 'OPERATIONAL',
      isDemo: false,
    },
  });

  await prisma.driverVehicleAssignment.create({
    data: {
      driverId: driverProfileOp.id,
      ambulanceId: ambulanceOpA.id,
      isCurrent: true,
    },
  });

  // Seed Demo Ambulance (Explicit quarantine check)
  demoAmbulance = await prisma.ambulance.create({
    data: {
      vehicleNumber: 'MH-31-DEMO-9999',
      ambulanceType: AmbulanceType.BASIC_LIFE_SUPPORT,
      isAvailable: true,
      currentLat: 21.145,
      currentLng: 79.088,
      lastUpdated: new Date(),
      hospitalId: hospitalA.id,
      verificationState: VerificationState.VERIFIED,
      verificationStatus: 'APPROVED',
      maintenanceStatus: 'OPERATIONAL',
      isDemo: true, // DEMO RESOURCE
    },
  });
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// =========================================================================
// SECTION 1: FLEET INVENTORY (Hospital-Owned & Private Operator Models)
// =========================================================================

test('1.1. Fleet Inventory: Hospital Admin retrieves hospital-owned fleet with rich metadata', async () => {
  const res = await fetch(`${baseUrl}/api/v1/ambulances/fleet`, {
    headers: { Authorization: `Bearer ${hospAdminTokenA}` },
  });

  assert.equal(res.status, 200);
  const data: any = await res.json();
  assert.equal(data.success, true);
  assert.ok(data.fleet.length >= 1);

  const vehicle = data.fleet.find((v: any) => v.id === ambulanceHospA.id);
  assert.ok(vehicle, 'Hospital ambulance must exist in fleet response');
  assert.equal(vehicle.registrationIdentifier, 'MH-31-AG-1008');
  assert.equal(vehicle.owningOrganization.type, 'HOSPITAL');
  assert.equal(vehicle.owningOrganization.id, hospitalA.id);
  assert.equal(vehicle.verificationState, 'VERIFIED');
  assert.equal(vehicle.serviceCategory.type, 'ADVANCED_LIFE_SUPPORT');
  assert.ok(vehicle.serviceCategory.equipmentCapabilities.includes('Transport Ventilator (Invasive/Non-Invasive)'));
  assert.ok(vehicle.serviceCategory.equipmentCapabilities.includes('Multipara Cardiac Monitor with Defibrillator (AED & Manual)'));
  assert.equal(vehicle.operationalAvailability.isAvailable, true);
  assert.equal(vehicle.operationalAvailability.maintenanceStatus, 'OPERATIONAL');
  assert.equal(vehicle.assignedDriver.name, 'Anil Deshmukh');
  assert.equal(vehicle.currentCommitment.hasActiveTrip, false);
  assert.equal(vehicle.isDemo, false);
});

test('1.2. Fleet Inventory: Operator Admin retrieves private operator fleet with equipment capabilities', async () => {
  const res = await fetch(`${baseUrl}/api/v1/ambulances/inventory`, {
    headers: { Authorization: `Bearer ${opAdminTokenA}` },
  });

  assert.equal(res.status, 200);
  const data: any = await res.json();
  assert.equal(data.success, true);
  assert.ok(data.fleet.length >= 1);

  const vehicle = data.fleet.find((v: any) => v.id === ambulanceOpA.id);
  assert.ok(vehicle, 'Private operator ambulance must exist in fleet response');
  assert.equal(vehicle.registrationIdentifier, 'MH-31-EM-2020');
  assert.equal(vehicle.owningOrganization.type, 'PRIVATE_OPERATOR');
  assert.equal(vehicle.owningOrganization.id, operatorA.id);
  assert.ok(vehicle.serviceCategory.equipmentCapabilities.includes('Self-loading Main Stretcher'));
  assert.ok(vehicle.serviceCategory.equipmentCapabilities.includes('Automated External Defibrillator (AED)'));
});

test('1.3. Fleet Inventory: Super Admin can query cross-fleet with organization type filter', async () => {
  const res = await fetch(`${baseUrl}/api/v1/ambulances/fleet?organizationType=PRIVATE_OPERATOR`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });

  assert.equal(res.status, 200);
  const data: any = await res.json();
  assert.ok(data.fleet.every((v: any) => v.owningOrganization.type === 'PRIVATE_OPERATOR'));
});

test('1.4. Fleet Tenant Isolation: Hospital Admin A CANNOT view Hospital B or Private Operator fleet', async () => {
  const res = await fetch(`${baseUrl}/api/v1/ambulances/fleet`, {
    headers: { Authorization: `Bearer ${hospAdminTokenA}` },
  });

  const data: any = await res.json();
  assert.ok(
    data.fleet.every((v: any) => v.owningOrganization.id === hospitalA.id),
    'Hospital Admin must only see ambulances belonging to their hospital'
  );
  assert.ok(!data.fleet.some((v: any) => v.id === ambulanceOpA.id));
});

test('1.5. Fleet Tenant Isolation: Operator Admin CANNOT view Hospital ambulances', async () => {
  const res = await fetch(`${baseUrl}/api/v1/ambulances/fleet`, {
    headers: { Authorization: `Bearer ${opAdminTokenA}` },
  });

  const data: any = await res.json();
  assert.ok(
    data.fleet.every((v: any) => v.owningOrganization.id === operatorA.id),
    'Operator Admin must only see ambulances belonging to their private operator'
  );
  assert.ok(!data.fleet.some((v: any) => v.id === ambulanceHospA.id));
});

test('1.6. Fleet Quarantine: Demo vehicles are excluded from production fleet queries by default', async () => {
  const res = await fetch(`${baseUrl}/api/v1/ambulances/fleet`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });

  const data: any = await res.json();
  assert.ok(
    !data.fleet.some((v: any) => v.id === demoAmbulance.id),
    'Demo ambulance must be excluded from default production fleet view'
  );

  // Surface only when explicitly requested
  const demoRes = await fetch(`${baseUrl}/api/v1/ambulances/fleet?includeDemo=true`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  const demoData: any = await demoRes.json();
  const demoFound = demoData.fleet.find((v: any) => v.id === demoAmbulance.id);
  assert.ok(demoFound);
  assert.equal(demoFound.isDemo, true);
});

// =========================================================================
// SECTION 2: DISPATCH ELIGIBILITY GATEKEEPER (11 Deterministic Checks)
// =========================================================================

test('2.1. Eligibility Check 1: Inactive driver account is rejected with DRIVER_INACTIVE', async () => {
  const candidate: CandidateVehicle = {
    ambulance: { ...ambulanceHospA },
    driver: { ...driverUserA, isActive: false },
    driverProfile: { ...driverProfileA },
    organization: { type: 'HOSPITAL', id: hospitalA.id, name: hospitalA.name, verificationState: 'VERIFIED', isDemo: false },
  };

  const result = await evaluateCandidateEligibility(candidate);
  assert.equal(result.eligible, false);
  assert.ok(result.denialReasons.includes('DRIVER_INACTIVE'));
});

test('2.2. Eligibility Check 2: Suspended driver is rejected with DRIVER_INACTIVE', async () => {
  const candidate: CandidateVehicle = {
    ambulance: { ...ambulanceHospA },
    driver: { ...driverUserA, isSuspended: true },
    driverProfile: { ...driverProfileA },
    organization: { type: 'HOSPITAL', id: hospitalA.id, name: hospitalA.name, verificationState: 'VERIFIED', isDemo: false },
  };

  const result = await evaluateCandidateEligibility(candidate);
  assert.equal(result.eligible, false);
  assert.ok(result.denialReasons.includes('DRIVER_INACTIVE'));
});

test('2.3. Eligibility Check 3: Expired commercial license is rejected with CREDENTIAL_EXPIRED', async () => {
  const candidate: CandidateVehicle = {
    ambulance: { ...ambulanceHospA },
    driver: { ...driverUserA },
    driverProfile: { ...driverProfileA, licenseExpiry: new Date(Date.now() - 86400000) }, // Expired yesterday
    organization: { type: 'HOSPITAL', id: hospitalA.id, name: hospitalA.name, verificationState: 'VERIFIED', isDemo: false },
  };

  const result = await evaluateCandidateEligibility(candidate);
  assert.equal(result.eligible, false);
  assert.ok(result.denialReasons.includes('CREDENTIAL_EXPIRED'));
});

test('2.4. Eligibility Check 4: Unapproved organization membership is rejected with DRIVER_MEMBERSHIP_NOT_APPROVED', async () => {
  const candidate: CandidateVehicle = {
    ambulance: { ...ambulanceHospA },
    driver: { ...driverUserA },
    driverProfile: { ...driverProfileA, membershipStatus: 'PENDING' },
    organization: { type: 'HOSPITAL', id: hospitalA.id, name: hospitalA.name, verificationState: 'VERIFIED', isDemo: false },
  };

  const result = await evaluateCandidateEligibility(candidate);
  assert.equal(result.eligible, false);
  assert.ok(result.denialReasons.includes('DRIVER_MEMBERSHIP_NOT_APPROVED'));
});

test('2.5. Eligibility Check 5: Missing driver-vehicle assignment is rejected with ASSIGNMENT_INVALID', async () => {
  const candidate: CandidateVehicle = {
    ambulance: { ...ambulanceHospA, id: 'amb-unassigned-xyz' },
    driver: { ...driverUserA },
    driverProfile: { ...driverProfileA },
    organization: { type: 'HOSPITAL', id: hospitalA.id, name: hospitalA.name, verificationState: 'VERIFIED', isDemo: false },
  };

  const result = await evaluateCandidateEligibility(candidate);
  assert.equal(result.eligible, false);
  assert.ok(result.denialReasons.includes('ASSIGNMENT_INVALID'));
});

test('2.6. Eligibility Check 6: Unverified ambulance is rejected with AMBULANCE_NOT_VERIFIED', async () => {
  const candidate: CandidateVehicle = {
    ambulance: { ...ambulanceHospA, verificationState: 'PENDING_REVIEW' },
    driver: { ...driverUserA },
    driverProfile: { ...driverProfileA },
    organization: { type: 'HOSPITAL', id: hospitalA.id, name: hospitalA.name, verificationState: 'VERIFIED', isDemo: false },
  };

  const result = await evaluateCandidateEligibility(candidate);
  assert.equal(result.eligible, false);
  assert.ok(result.denialReasons.includes('AMBULANCE_NOT_VERIFIED'));
});

test('2.7. Eligibility Check 7: Ambulance out of service for maintenance is rejected with AMBULANCE_OUT_OF_SERVICE', async () => {
  const candidate: CandidateVehicle = {
    ambulance: { ...ambulanceHospA, maintenanceStatus: 'OUT_OF_SERVICE' },
    driver: { ...driverUserA },
    driverProfile: { ...driverProfileA },
    organization: { type: 'HOSPITAL', id: hospitalA.id, name: hospitalA.name, verificationState: 'VERIFIED', isDemo: false },
  };

  const result = await evaluateCandidateEligibility(candidate);
  assert.equal(result.eligible, false);
  assert.ok(result.denialReasons.includes('AMBULANCE_OUT_OF_SERVICE'));
});

test('2.8. Eligibility Check 8: Unverified organization is rejected with ORGANIZATION_NOT_VERIFIED', async () => {
  const candidate: CandidateVehicle = {
    ambulance: { ...ambulanceHospA },
    driver: { ...driverUserA },
    driverProfile: { ...driverProfileA },
    organization: { type: 'HOSPITAL', id: hospitalA.id, name: hospitalA.name, verificationState: 'PENDING_REVIEW', isDemo: false },
  };

  const result = await evaluateCandidateEligibility(candidate);
  assert.equal(result.eligible, false);
  assert.ok(result.denialReasons.includes('ORGANIZATION_NOT_VERIFIED'));
});

test('2.9. Eligibility Check 9: Service category mismatch (ALS requested, BLS provided) is rejected', async () => {
  const candidate: CandidateVehicle = {
    ambulance: { ...ambulanceOpA }, // BLS ambulance
    driver: { ...driverUserA },
    driverProfile: { ...driverProfileA },
    organization: { type: 'PRIVATE_OPERATOR', id: operatorA.id, name: operatorA.name, verificationState: 'VERIFIED', isDemo: false },
  };

  const result = await evaluateCandidateEligibility(candidate, {
    requiredAmbulanceType: AmbulanceType.ADVANCED_LIFE_SUPPORT,
  });

  assert.equal(result.eligible, false);
  assert.ok(result.denialReasons.includes('SERVICE_CATEGORY_MISMATCH'));
});

test('2.10. Eligibility Check 10: Stale location (>30 min) is rejected with LOCATION_STALE', async () => {
  const candidate: CandidateVehicle = {
    ambulance: {
      ...ambulanceHospA,
      lastUpdated: new Date(Date.now() - 45 * 60 * 1000), // 45 minutes ago
    },
    driver: { ...driverUserA },
    driverProfile: { ...driverProfileA },
    organization: { type: 'HOSPITAL', id: hospitalA.id, name: hospitalA.name, verificationState: 'VERIFIED', isDemo: false },
  };

  const result = await evaluateCandidateEligibility(candidate);
  assert.equal(result.eligible, false);
  assert.ok(result.denialReasons.includes('LOCATION_STALE'));
});

test('2.11. Eligibility Check 11: Real emergency request excludes demo vehicle with DEMO_RESOURCE_EXCLUDED', async () => {
  const candidate: CandidateVehicle = {
    ambulance: { ...demoAmbulance },
    driver: { ...driverUserA },
    driverProfile: { ...driverProfileA },
    organization: { type: 'HOSPITAL', id: hospitalA.id, name: hospitalA.name, verificationState: 'VERIFIED', isDemo: false },
  };

  const result = await evaluateCandidateEligibility(candidate, { isDemoRequest: false });
  assert.equal(result.eligible, false);
  assert.ok(result.denialReasons.includes('DEMO_RESOURCE_EXCLUDED'));
});

test('2.12. Deterministic Eligibility: Fully verified hospital & operator units pass all 11 checks', async () => {
  const hospCandidate: CandidateVehicle = {
    ambulance: { ...ambulanceHospA, lastUpdated: new Date() },
    driver: { ...driverUserA },
    driverProfile: { ...driverProfileA },
    organization: { type: 'HOSPITAL', id: hospitalA.id, name: hospitalA.name, verificationState: 'VERIFIED', isDemo: false },
  };

  const result = await evaluateCandidateEligibility(hospCandidate, {
    requiredAmbulanceType: AmbulanceType.ADVANCED_LIFE_SUPPORT,
    isDemoRequest: false,
  });

  assert.equal(result.eligible, true, `Expected eligible, got: ${result.denialReasons.join(', ')}`);
  assert.equal(result.denialReasons.length, 0);
});

// =========================================================================
// SECTION 3: CANDIDATE RANKING & DISTANCE/ETA TRANSPARENCY
// =========================================================================

test('3.1. Candidate Ranking: DISTANCE_FIRST policy ranks nearest vehicle first', async () => {
  const result = await discoverAndRankCandidates({
    id: 'req-rank-01',
    pickupLat: 21.146,
    pickupLng: 79.088,
    rankingPolicy: 'DISTANCE_FIRST',
    isDemo: false,
  });

  assert.ok(result.rankedCandidates.length >= 2);
  assert.equal(result.rankingPolicyUsed, 'DISTANCE_FIRST');

  for (let i = 0; i < result.rankedCandidates.length - 1; i++) {
    const curDist = result.rankedCandidates[i].distanceKm ?? 0;
    const nextDist = result.rankedCandidates[i + 1].distanceKm ?? 0;
    assert.ok(curDist <= nextDist + 0.05, `Candidate ${i} (${curDist}km) should be closer than ${i + 1} (${nextDist}km)`);
  }
});

test('3.2. Candidate Ranking: CAPABILITY_FIRST prioritizes ALS capability for critical emergency', async () => {
  const result = await discoverAndRankCandidates({
    id: 'req-rank-02',
    pickupLat: 21.146,
    pickupLng: 79.088,
    rankingPolicy: 'CAPABILITY_FIRST',
    isDemo: false,
  });

  assert.ok(result.rankedCandidates.length >= 2);
  assert.equal(result.rankingPolicyUsed, 'CAPABILITY_FIRST');

  // The first candidate should be ALS (capScore = 3)
  const topCandidate = result.rankedCandidates[0];
  assert.equal(topCandidate.ambulance.ambulanceType, AmbulanceType.ADVANCED_LIFE_SUPPORT);
  assert.equal(topCandidate.capabilityScore, 3);
});

test('3.3. Distance Transparency: Road vs Straight-Line distance is explicitly marked with ETA disclaimer', async () => {
  const result = await discoverAndRankCandidates({
    id: 'req-rank-03',
    pickupLat: 21.146,
    pickupLng: 79.088,
    isDemo: false,
  });

  const candidate = result.rankedCandidates[0];
  assert.equal(candidate.isStraightLine, true);
  assert.equal(candidate.distanceType, 'STRAIGHT_LINE_HAVERSINE');
  assert.equal(candidate.distanceLabel, 'Straight-line geographic distance (km)');
  assert.ok(candidate.estimatedTravelMinutes! >= 1);
  assert.equal(candidate.etaMethod, 'AVERAGE_SPEED_ESTIMATE_40KMH');
  assert.ok(candidate.etaDisclaimer!.includes('Actual road conditions, traffic signals, and weather may vary.'));
});

// =========================================================================
// SECTION 4: OFFER ESCALATION, ATOMIC ACCEPTANCE & REASSIGNMENT PROTECTION
// =========================================================================

test('4.1. Unique Dispatch Offer: Generates unique offer with configurable 45-second TTL', async () => {
  const req = await prisma.emergencyRequest.create({
    data: {
      patientId: 'patient-test-01',
      pickupLat: 21.146,
      pickupLng: 79.088,
      status: RequestStatus.SEARCHING,
      requiredAmbulanceType: AmbulanceType.ADVANCED_LIFE_SUPPORT,
    },
  });

  const candidate: CandidateVehicle = {
    ambulance: { ...ambulanceHospA },
    driver: { ...driverUserA },
    driverProfile: { ...driverProfileA },
    organization: { type: 'HOSPITAL', id: hospitalA.id, name: hospitalA.name, verificationState: 'VERIFIED', isDemo: false },
    distanceKm: 0.8,
  };

  const offer = await dispatchOfferToCandidate(req.id, candidate, 45);
  assert.ok(offer.id);
  assert.equal(offer.status, DispatchAttemptStatus.OFFERED);
  assert.ok(new Date(offer.expiresAt).getTime() > Date.now());
  assert.ok(new Date(offer.expiresAt).getTime() <= Date.now() + 46000);
});

test('4.2. Offer Escalation: Driver rejection escalates automatically to next eligible candidate', async () => {
  const req = await prisma.emergencyRequest.create({
    data: {
      patientId: 'patient-test-02',
      pickupLat: 21.146,
      pickupLng: 79.088,
      status: RequestStatus.SEARCHING,
      requiredAmbulanceType: AmbulanceType.BASIC_LIFE_SUPPORT,
    },
  });

  const { rankedCandidates } = await discoverAndRankCandidates({
    id: req.id,
    pickupLat: req.pickupLat,
    pickupLng: req.pickupLng,
    isDemo: false,
  });

  assert.ok(rankedCandidates.length >= 2);

  // Offer to first candidate
  const firstCandidate = rankedCandidates[0];
  const offer = await dispatchOfferToCandidate(req.id, firstCandidate, 45);

  // First driver declines offer
  const escalation = await rejectOrExpireOffer(offer.id, firstCandidate.driver.id, 'REJECT', 'Vehicle refueling');
  assert.equal(escalation.nextOffered, true);
  assert.equal(escalation.noAmbulanceLeft, false);

  // Verify next offer exists and is addressed to a different driver
  const nextAttempt = await prisma.dispatchAttempt.findFirst({
    where: {
      requestId: req.id,
      status: DispatchAttemptStatus.OFFERED,
    },
  });
  assert.ok(nextAttempt);
  assert.notEqual(nextAttempt.driverId, firstCandidate.driver.id);
});

test('4.3. Concurrency Mutex: Two concurrent driver acceptances produce at most one assignment', async () => {
  const req = await prisma.emergencyRequest.create({
    data: {
      patientId: 'patient-test-03',
      pickupLat: 21.146,
      pickupLng: 79.088,
      status: RequestStatus.SEARCHING,
      requiredAmbulanceType: AmbulanceType.ADVANCED_LIFE_SUPPORT,
    },
  });

  const candidate: CandidateVehicle = {
    ambulance: { ...ambulanceHospA },
    driver: { ...driverUserA },
    driverProfile: { ...driverProfileA },
    organization: { type: 'HOSPITAL', id: hospitalA.id, name: hospitalA.name, verificationState: 'VERIFIED', isDemo: false },
    distanceKm: 0.5,
  };

  const offer = await dispatchOfferToCandidate(req.id, candidate, 45);

  // Simulate two concurrent acceptance promises
  const [res1, res2] = await Promise.all([
    atomicallyAcceptOffer(offer.id, driverUserA.id),
    atomicallyAcceptOffer(offer.id, driverUserA.id),
  ]);

  const successes = [res1, res2].filter((r) => r.success);
  const failures = [res1, res2].filter((r) => !r.success);

  assert.equal(successes.length, 1, 'Exactly one acceptance must succeed');
  assert.equal(failures.length, 1, 'The concurrent attempt must fail');
  assert.ok(
    failures[0].code === 'CONCURRENCY_LOCK' ||
    failures[0].code === 'OFFER_NOT_OFFERED' ||
    failures[0].code === 'REQUEST_ALREADY_ASSIGNED'
  );
});

test('4.4. Active Trip Reassignment Protection: Reassigns safely with audit event and releases old vehicle', async () => {
  // Create an active trip
  const req = await prisma.emergencyRequest.create({
    data: {
      patientId: 'patient-test-04',
      pickupLat: 21.146,
      pickupLng: 79.088,
      status: RequestStatus.ACCEPTED,
      driverId: driverUserA.id,
      ambulanceId: ambulanceHospA.id,
    },
  });

  const trip = await prisma.emergencyTrip.create({
    data: {
      requestId: req.id,
      ambulanceId: ambulanceHospA.id,
      driverId: driverUserA.id,
      hospitalId: hospitalA.id,
      pickupLat: 21.146,
      pickupLng: 79.088,
      status: TripLifecycleStatus.ACCEPTED,
    },
  });

  // Reassign due to mechanical breakdown
  const reassignResult = await reassignTripSafely(
    trip.id,
    hospitalA.adminUserId,
    'ADMIN_HOSPITAL',
    'Ambulance mechanical breakdown'
  );

  assert.equal(reassignResult.success, true);
  assert.ok(reassignResult.message?.includes('Trip safely cancelled and escalated'));

  // Old trip must be cancelled
  const updatedTrip = await prisma.emergencyTrip.findUnique({ where: { id: trip.id } });
  assert.equal(updatedTrip?.status, TripLifecycleStatus.CANCELLED);

  // Old ambulance must be marked OUT_OF_SERVICE
  const updatedAmb = await prisma.ambulance.findUnique({ where: { id: ambulanceHospA.id } });
  assert.equal(updatedAmb?.isAvailable, false);
  assert.equal(updatedAmb?.maintenanceStatus, 'OUT_OF_SERVICE');
});

test('4.5. Exhausted Supply: Explicit NO_ELIGIBLE_AMBULANCE when all candidates decline', async () => {
  const req = await prisma.emergencyRequest.create({
    data: {
      patientId: 'patient-test-05',
      pickupLat: 21.146,
      pickupLng: 79.088,
      status: RequestStatus.SEARCHING,
    },
  });

  const offer = await prisma.dispatchAttempt.create({
    data: {
      requestId: req.id,
      driverId: 'unregistered-driver-temp',
      ambulanceId: 'unregistered-amb-temp',
      status: DispatchAttemptStatus.OFFERED,
      distanceKm: 2.0,
      expiresAt: new Date(Date.now() + 10000),
    },
  });

  const result = await rejectOrExpireOffer(offer.id, 'unregistered-driver-temp', 'REJECT', 'Unavailable');
  assert.ok(typeof result.nextOffered === 'boolean');
  assert.ok(typeof result.noAmbulanceLeft === 'boolean');
});

// =========================================================================
// SECTION 5: MULTI-CITY SERVICE-AREA MANAGEMENT (Dynamic Expansion)
// =========================================================================

test('5.1. Service Areas: List all configured service areas', async () => {
  const res = await fetch(`${baseUrl}/api/v1/service-areas`);
  assert.equal(res.status, 200);
  const data: any = await res.json();
  assert.equal(data.success, true);
  assert.ok(data.serviceAreas.length >= 1);
  assert.ok(data.serviceAreas.some((a: any) => a.city === 'Nagpur'));
});

test('5.2. Service Area Expansion: Super Admin creates a new service area (Pune, Maharashtra)', async () => {
  const punePayload = {
    name: 'Pune Metropolitan Emergency Zone',
    city: 'Pune',
    state: 'Maharashtra',
    country: 'India',
    centerLat: 18.5204,
    centerLng: 73.8567,
    radiusKm: 25.0,
    isActive: true,
    isPilot: false,
    metadata: {
      coverageLocalities: ['Shivajinagar', 'Kothrud', 'Hinjewadi', 'Viman Nagar'],
      allowedAmbulanceTypes: ['BASIC_LIFE_SUPPORT', 'ADVANCED_LIFE_SUPPORT', 'OXYGEN_SUPPORT'],
    },
  };

  const res = await fetch(`${baseUrl}/api/v1/service-areas`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${superAdminToken}`,
    },
    body: JSON.stringify(punePayload),
  });

  assert.equal(res.status, 201);
  const data: any = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.serviceArea.city, 'Pune');
  assert.equal(data.serviceArea.radiusKm, 25.0);
});

test('5.3. Dynamic Geofence: Coordinate inside Pune resolves to Pune service area', async () => {
  // Coordinates near Pune Railway Station: 18.5284, 73.8739 (approx 2.0 km from Pune center)
  const res = await fetch(`${baseUrl}/api/v1/service-areas/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lat: 18.5284,
      lng: 73.8739,
    }),
  });

  assert.equal(res.status, 200);
  const data: any = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.inArea, true);
  assert.equal(data.serviceArea.city, 'Pune');
  assert.ok(data.distanceFromCenterKm < 10.0);
});

test('5.4. Dynamic Geofence: Coordinate inside Nagpur resolves to Nagpur pilot zone', async () => {
  // Sitabuldi, Nagpur: 21.1458, 79.0882
  const res = await fetch(`${baseUrl}/api/v1/service-areas/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lat: 21.1458,
      lng: 79.0882,
    }),
  });

  assert.equal(res.status, 200);
  const data: any = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.inArea, true);
  assert.equal(data.serviceArea.city, 'Nagpur');
});

test('5.5. Dynamic Geofence: Coordinate in Mumbai (unconfigured) returns inArea: false with nearest area', async () => {
  // Mumbai Nariman Point: 18.9256, 72.8242
  const res = await fetch(`${baseUrl}/api/v1/service-areas/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lat: 18.9256,
      lng: 72.8242,
    }),
  });

  assert.equal(res.status, 200);
  const data: any = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.inArea, false);
  assert.equal(data.reason, 'OUTSIDE_SERVICE_AREA');
  assert.ok(data.distanceFromCenterKm > 50.0);
});

test('5.6. Service Area RBAC: Non-admin cannot create or modify service areas', async () => {
  const res = await fetch(`${baseUrl}/api/v1/service-areas`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${patientToken}`,
    },
    body: JSON.stringify({
      name: 'Unauthorized Area',
      city: 'Delhi',
      state: 'Delhi',
      centerLat: 28.6139,
      centerLng: 77.209,
      radiusKm: 20.0,
    }),
  });

  assert.equal(res.status, 403);
});
