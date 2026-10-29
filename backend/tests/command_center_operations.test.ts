process.env.NODE_ENV = 'test';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import * as jwt from 'jsonwebtoken';
import app from '../src/app';
import prisma from '../src/db';
import { Role } from '@prisma/client';

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

const superAdminToken = createToken({
  id: 'admin_super_command_center_test',
  email: 'superadmin@lifelink.org',
  role: Role.SUPER_ADMIN,
  name: 'Command Center Lead',
});

const patientToken = createToken({
  id: 'patient_unauthorized_test',
  email: 'citizen@example.com',
  role: Role.PATIENT,
  name: 'Regular Citizen',
});

let sharedHospitalId: string;

// =============================================================================
// TEST SUITE 1: AUTHORIZATION & TENANT ISOLATION
// =============================================================================

test('1.1. Non-authenticated request to Command Center overview returns 401 Unauthorized', async () => {
  const res = await fetch(`${baseUrl}/api/admin/command-center/overview`);
  assert.equal(res.status, 401);
});

test('1.2. Regular user (PATIENT role) request returns 403 Forbidden', async () => {
  const res = await fetch(`${baseUrl}/api/admin/command-center/overview`, {
    headers: { Authorization: `Bearer ${patientToken}` },
  });
  assert.equal(res.status, 403);
});

test('1.3. Authorized Super Admin request succeeds with complete 10-module telemetry payload', async () => {
  const res = await fetch(`${baseUrl}/api/admin/command-center/overview`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  assert.equal(res.status, 200);
  const data: any = await res.json();
  assert.ok(data.timestamp);
  assert.ok(data.modules);
  assert.ok(data.modules.emergencyRequests);
  assert.ok(data.modules.activeTripsAndOffers);
  assert.ok(data.modules.unresolvedEscalations);
  assert.ok(data.modules.fleetStatus);
  assert.ok(data.modules.pendingVerifications);
  assert.ok(data.modules.credentialExpirations);
  assert.ok(data.modules.notificationOutbox);
  assert.ok(data.modules.gpsFreshness);
  assert.ok(data.modules.opdAndAppointments);
  assert.ok(data.modules.nagpurPilotStatus);
});

// =============================================================================
// TEST SUITE 2: METRIC ACCURACY ACROSS ALL 10 MODULES
// =============================================================================

test('2.1. Module 1: Accurately counts requests by state and segregates Demo from Production', async () => {
  const patient = await prisma.user.create({
    data: {
      email: `patient_req_test_${Date.now()}@lifelink.org`,
      passwordHash: 'hash',
      name: 'Test Emergency Patient',
      role: Role.PATIENT,
    },
  });

  // Create 1 active production request
  await prisma.emergencyRequest.create({
    data: {
      patientId: patient.id,
      pickupLat: 21.1458,
      pickupLng: 79.0882,
      pickupAddress: 'Dharampeth, Nagpur',
      status: 'REQUESTED',
      isDemo: false,
    },
  });

  // Create 1 escalated production request
  await prisma.emergencyRequest.create({
    data: {
      patientId: patient.id,
      pickupLat: 21.1500,
      pickupLng: 79.0900,
      pickupAddress: 'Sitabuldi, Nagpur',
      status: 'NO_ELIGIBLE_AMBULANCE',
      isDemo: false,
    },
  });

  // Create 1 demo request
  await prisma.emergencyRequest.create({
    data: {
      patientId: patient.id,
      pickupLat: 21.1600,
      pickupLng: 79.1000,
      pickupAddress: 'Simulated Demo Sector',
      status: 'COMPLETED',
      isDemo: true,
    },
  });

  const res = await fetch(`${baseUrl}/api/admin/command-center/overview`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  assert.equal(res.status, 200);
  const data: any = await res.json();
  const mod1 = data.modules.emergencyRequests;

  assert.ok(mod1.total >= 3);
  assert.ok(mod1.activeCount >= 1);
  assert.ok(mod1.completedCount >= 1);
  assert.ok(mod1.escalatedCount >= 1);
  assert.ok(mod1.demoCount >= 1);
  assert.ok(mod1.productionCount >= 2);
  assert.ok(mod1.definition.includes('Aggregated emergency dispatch requests'));
});

test('2.2. Module 2: Accurately reflects Active Trips and Unexpired Dispatch Offers', async () => {
  const res = await fetch(`${baseUrl}/api/admin/command-center/overview`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  const data: any = await res.json();
  const mod2 = data.modules.activeTripsAndOffers;

  assert.equal(typeof mod2.activeTripsCount, 'number');
  assert.equal(typeof mod2.activeOffersCount, 'number');
  assert.ok(Array.isArray(mod2.activeTrips));
  assert.ok(Array.isArray(mod2.activeOffers));
  assert.ok(mod2.definition.includes('Live trips currently en route'));
});

test('2.3. Module 3: Captures Requests with No Eligible Ambulance and 112 Fallback', async () => {
  const res = await fetch(`${baseUrl}/api/admin/command-center/overview`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  const data: any = await res.json();
  const mod3 = data.modules.unresolvedEscalations;

  assert.ok(mod3.count >= 1);
  const escalated = mod3.requests.find((r: any) => r.status === 'NO_ELIGIBLE_AMBULANCE');
  assert.ok(escalated);
  assert.ok(escalated.pickupAddress.includes('Sitabuldi'));
  assert.ok(escalated.fallbackProtocol.includes('112 Central Dispatch Notification'));
  assert.ok(mod3.definition.includes('112 emergency service manual intervention'));
});

test('2.4. Module 4: Separates Hospital Fleet from Private Operator Fleet', async () => {
  // Create hospital and hospital ambulance
  const hospitalAdmin = await prisma.user.create({
    data: {
      email: `hosp_admin_${Date.now()}@lifelink.org`,
      passwordHash: 'hash',
      name: 'Hospital Admin CC',
      role: Role.ADMIN_HOSPITAL,
    },
  });

  const hospital = await prisma.hospital.create({
    data: {
      name: 'Nagpur Central Care Hospital',
      address: 'Central Avenue, Nagpur',
      contactNumber: '+917122000001',
      lat: 21.1458,
      lng: 79.0882,
      adminUserId: hospitalAdmin.id,
      verificationState: 'VERIFIED',
    },
  });
  sharedHospitalId = hospital.id;

  // Verified & available hospital ambulance
  await prisma.ambulance.create({
    data: {
      vehicleNumber: `MH31-HA-${Date.now().toString().slice(-4)}`,
      ambulanceType: 'ADVANCED_LIFE_SUPPORT',
      isAvailable: true,
      currentLat: 21.1458,
      currentLng: 79.0882,
      hospitalId: hospital.id,
      verificationState: 'VERIFIED',
      verificationStatus: 'APPROVED',
      maintenanceStatus: 'GOOD',
      isDemo: false,
    },
  });

  // Create operator and operator ambulance
  const operatorAdmin = await prisma.user.create({
    data: {
      email: `op_admin_${Date.now()}@lifelink.org`,
      passwordHash: 'hash',
      name: 'Operator Admin CC',
      role: Role.OPERATOR_ADMIN,
    },
  });

  const operator = await prisma.ambulanceOperator.create({
    data: {
      name: 'Nagpur Swift Response Private Ltd',
      tradeLicense: 'TR-NGP-9922',
      contactPhone: '+917122999991',
      email: `swift_${Date.now()}@gmail.com`,
      address: 'Wardha Road, Nagpur',
      adminUserId: operatorAdmin.id,
      verificationState: 'VERIFIED',
    },
  });

  // Verified & available operator ambulance
  await prisma.ambulance.create({
    data: {
      vehicleNumber: `MH31-OP-${Date.now().toString().slice(-4)}`,
      ambulanceType: 'BASIC_LIFE_SUPPORT',
      isAvailable: true,
      currentLat: 21.1200,
      currentLng: 79.0600,
      operatorId: operator.id,
      verificationState: 'VERIFIED',
      verificationStatus: 'APPROVED',
      maintenanceStatus: 'GOOD',
      isDemo: false,
    },
  });

  const res = await fetch(`${baseUrl}/api/admin/command-center/overview`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  const data: any = await res.json();
  const mod4 = data.modules.fleetStatus;

  assert.ok(mod4.hospitalFleet.total >= 1);
  assert.ok(mod4.hospitalFleet.available >= 1);
  assert.ok(mod4.operatorFleet.total >= 1);
  assert.ok(mod4.operatorFleet.available >= 1);
  assert.ok(mod4.totalDispatchable >= 2);
  assert.ok(mod4.definition.includes('Suspended or unverified vehicles are strictly excluded'));
});

// =============================================================================
// TEST SUITE 3: STRICT DISPATCH ELIGIBILITY (SUSPENSION & UNVERIFIED EFFECTS)
// =============================================================================

test('3.1. Suspended vehicle is strictly excluded from dispatchable availability', async () => {
  const suspendedAmbulance = await prisma.ambulance.create({
    data: {
      vehicleNumber: `MH31-SUS-${Date.now().toString().slice(-4)}`,
      ambulanceType: 'BASIC_LIFE_SUPPORT',
      isAvailable: true, // Marked available, but suspended!
      currentLat: 21.1458,
      currentLng: 79.0882,
      verificationState: 'SUSPENDED',
      maintenanceStatus: 'SUSPENDED',
      isDemo: false,
    },
  });

  const res = await fetch(`${baseUrl}/api/admin/command-center/overview`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  const data: any = await res.json();
  const mod4 = data.modules.fleetStatus;

  assert.ok(mod4.operatorFleet.suspended >= 1 || mod4.hospitalFleet.suspended >= 1);

  const fleetRes = await fetch(`${baseUrl}/api/admin/command-center/fleet?search=${suspendedAmbulance.vehicleNumber}`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  const fleetData: any = await fleetRes.json();
  const found = fleetData.fleet.find((v: any) => v.id === suspendedAmbulance.id);
  assert.ok(found);
  assert.equal(found.isDispatchable, false, 'Suspended vehicle MUST NOT be dispatchable');
});

test('3.2. Unverified vehicle (PENDING_REVIEW) is excluded from dispatchable availability', async () => {
  const pendingAmbulance = await prisma.ambulance.create({
    data: {
      vehicleNumber: `MH31-PEND-${Date.now().toString().slice(-4)}`,
      ambulanceType: 'BASIC_LIFE_SUPPORT',
      isAvailable: true,
      currentLat: 21.1458,
      currentLng: 79.0882,
      verificationState: 'PENDING_REVIEW',
      verificationStatus: 'PENDING',
      isDemo: false,
    },
  });

  const fleetRes = await fetch(`${baseUrl}/api/admin/command-center/fleet?search=${pendingAmbulance.vehicleNumber}`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  const fleetData: any = await fleetRes.json();
  const found = fleetData.fleet.find((v: any) => v.id === pendingAmbulance.id);
  assert.ok(found);
  assert.equal(found.isDispatchable, false, 'Unverified vehicle MUST NOT be dispatchable');
});

test('3.3. Demo/Simulated vehicle (isDemo: true) is excluded from dispatchable availability', async () => {
  const demoAmbulance = await prisma.ambulance.create({
    data: {
      vehicleNumber: `MH31-SIM-${Date.now().toString().slice(-4)}`,
      ambulanceType: 'BASIC_LIFE_SUPPORT',
      isAvailable: true,
      currentLat: 21.1458,
      currentLng: 79.0882,
      verificationState: 'VERIFIED',
      verificationStatus: 'APPROVED',
      isDemo: true, // Marked demo!
    },
  });

  const fleetRes = await fetch(`${baseUrl}/api/admin/command-center/fleet?search=${demoAmbulance.vehicleNumber}`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  const fleetData: any = await fleetRes.json();
  const found = fleetData.fleet.find((v: any) => v.id === demoAmbulance.id);
  assert.ok(found);
  assert.equal(found.isDispatchable, false, 'Demo vehicle MUST NOT be dispatchable in production');
});

// =============================================================================
// TEST SUITE 4: OPERATIONAL CONTROLS & MANDATORY REASONS
// =============================================================================

test('4.1. Operational action without mandatory reason returns 400 Bad Request', async () => {
  const res = await fetch(`${baseUrl}/api/admin/command-center/action`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${superAdminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      targetType: 'HOSPITAL',
      targetId: 'hosp-123',
      action: 'SUSPEND',
      reason: '', // Empty reason!
    }),
  });
  assert.equal(res.status, 400);
  const data: any = await res.json();
  assert.ok(data.message.includes('Mandatory reason'));
});

test('4.2. Operational action with whitespace reason returns 400 Bad Request', async () => {
  const res = await fetch(`${baseUrl}/api/admin/command-center/action`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${superAdminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      targetType: 'HOSPITAL',
      targetId: 'hosp-123',
      action: 'APPROVE',
      reason: '   ',
    }),
  });
  assert.equal(res.status, 400);
});

test('4.3. Operational action with valid reason executes and updates entity state', async () => {
  // Create driver
  const driverUser = await prisma.user.create({
    data: {
      email: `driver_ctrl_${Date.now()}@lifelink.org`,
      passwordHash: 'hash',
      name: 'Ramesh Patil',
      role: Role.DRIVER,
    },
  });

  const driverProfile = await prisma.driverProfile.create({
    data: {
      userId: driverUser.id,
      licenseNumber: `MH31-DL-${Date.now().toString().slice(-5)}`,
      verificationState: 'PENDING_REVIEW',
      membershipStatus: 'PENDING',
      isDispatchEligible: false,
    },
  });

  // Approve driver
  const approveRes = await fetch(`${baseUrl}/api/admin/command-center/action`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${superAdminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      targetType: 'DRIVER',
      targetId: driverProfile.id,
      action: 'APPROVE',
      reason: 'Driver commercial license and medical emergency training verified against transport records.',
    }),
  });

  assert.equal(approveRes.status, 200);
  const approveData: any = await approveRes.json();
  assert.equal(approveData.success, true);

  const updatedProfile: any = await prisma.driverProfile.findUnique({ where: { id: driverProfile.id } });
  assert.ok(updatedProfile);
  assert.equal(updatedProfile.verificationState, 'VERIFIED');
  assert.equal(updatedProfile.isDispatchEligible, true);
  assert.equal(updatedProfile.membershipStatus, 'APPROVED');

  // Now suspend driver with reason
  const suspendRes = await fetch(`${baseUrl}/api/admin/command-center/action`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${superAdminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      targetType: 'DRIVER',
      targetId: driverProfile.id,
      action: 'SUSPEND',
      reason: 'Suspended pending investigation following dispatch refusal incident in Civil Lines.',
    }),
  });

  assert.equal(suspendRes.status, 200);
  const suspendedDriver: any = await prisma.driverProfile.findUnique({ where: { id: driverProfile.id } });
  assert.ok(suspendedDriver);
  assert.equal(suspendedDriver.verificationState, 'SUSPENDED');
  assert.equal(suspendedDriver.isDispatchEligible, false);

  const suspendedUser: any = await prisma.user.findUnique({ where: { id: driverUser.id } });
  assert.ok(suspendedUser);
  assert.equal(suspendedUser.isSuspended, true);

  // Reinstate driver
  const reinstateRes = await fetch(`${baseUrl}/api/admin/command-center/action`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${superAdminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      targetType: 'DRIVER',
      targetId: driverProfile.id,
      action: 'REINSTATE',
      reason: 'Investigation concluded. Compliance warning issued and re-certification completed.',
    }),
  });

  assert.equal(reinstateRes.status, 200);
  const reinstatedDriver: any = await prisma.driverProfile.findUnique({ where: { id: driverProfile.id } });
  assert.ok(reinstatedDriver);
  assert.equal(reinstatedDriver.verificationState, 'VERIFIED');
  assert.equal(reinstatedDriver.isDispatchEligible, true);
});

// =============================================================================
// TEST SUITE 5: AUDIT LOGGING INTEGRITY
// =============================================================================

test('5.1. Operational control action persists immutable audit log records', async () => {
  const auditRes = await fetch(`${baseUrl}/api/admin/command-center/audit-logs`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  assert.equal(auditRes.status, 200);
  const auditData: any = await auditRes.json();

  assert.ok(Array.isArray(auditData.logs));
  assert.ok(auditData.total >= 3);

  const driverLog = auditData.logs.find((l: any) => l.action === 'COMMAND_CENTER_APPROVE' && l.targetEntityType === 'DRIVER');
  assert.ok(driverLog);
  assert.ok(driverLog.notes.includes('Driver commercial license and medical emergency training'));
  assert.equal(driverLog.actorId, 'admin_super_command_center_test');
  assert.equal(driverLog.newState, 'VERIFIED');
});

// =============================================================================
// TEST SUITE 6: GPS FRESHNESS & STALE DATA OUTAGE CLASSIFICATION
// =============================================================================

test('6.1. Stale GPS updates (>30m) are classified as Tracking Outages', async () => {
  const staleTime = new Date(Date.now() - 45 * 60 * 1000); // 45 minutes ago

  const staleAmbulance = await prisma.ambulance.create({
    data: {
      vehicleNumber: `MH31-OUTAGE-${Date.now().toString().slice(-4)}`,
      ambulanceType: 'ADVANCED_LIFE_SUPPORT',
      isAvailable: true,
      currentLat: 21.1400,
      currentLng: 79.0800,
      verificationState: 'VERIFIED',
      verificationStatus: 'APPROVED',
      lastUpdated: staleTime,
      isDemo: false,
    },
  });

  const res = await fetch(`${baseUrl}/api/admin/command-center/overview`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  const data: any = await res.json();
  const mod8 = data.modules.gpsFreshness;

  assert.ok(mod8.outageCount >= 1);
  const outageEntry = mod8.outages.find((o: any) => o.id === staleAmbulance.id);
  assert.ok(outageEntry);
  assert.ok(outageEntry.outageMinutes >= 44);
  assert.equal(outageEntry.status, 'TRACKING_OUTAGE');
});

// =============================================================================
// TEST SUITE 7: OPD & APPOINTMENT OPERATIONAL METRICS
// =============================================================================

test('7.1. Module 9 correctly aggregates OPD appointments and clinic doctor slots', async () => {
  const doctor = await prisma.doctor.create({
    data: {
      hospitalId: sharedHospitalId,
      name: 'Dr. Anjali Deshmukh',
      specialization: 'Emergency Medicine',
      isActive: true,
    },
  });

  await prisma.doctorSlot.create({
    data: {
      doctorId: doctor.id,
      date: '2026-10-27',
      startTime: '09:00',
      endTime: '13:00',
      maxPatients: 10,
      bookedCount: 4,
      isBlocked: false,
    },
  });

  const res = await fetch(`${baseUrl}/api/admin/command-center/overview`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  const data: any = await res.json();
  const mod9 = data.modules.opdAndAppointments;

  assert.ok(mod9.activeDoctorsCount >= 1);
  assert.ok(mod9.slotsSummary.totalSlots >= 1);
  assert.ok(mod9.slotsSummary.bookedSlots >= 4);
  assert.ok(mod9.slotsSummary.availableSlots >= 1);
});

// =============================================================================
// TEST SUITE 8: NAGPUR PILOT SERVICE-AREA STATUS
// =============================================================================

test('8.1. Module 10 reflects Nagpur Pilot parameters (30km, 21.1458, 79.0882)', async () => {
  const res = await fetch(`${baseUrl}/api/admin/command-center/overview`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  const data: any = await res.json();
  const mod10 = data.modules.nagpurPilotStatus;

  assert.equal(mod10.centerLat, 21.1458);
  assert.equal(mod10.centerLng, 79.0882);
  assert.equal(mod10.radiusKm, 30.0);
  assert.equal(mod10.pilotOperationalApproved, true);
});
