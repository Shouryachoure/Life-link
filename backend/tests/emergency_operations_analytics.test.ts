process.env.NODE_ENV = 'test';
process.env.TEST_DB_CONNECTED = 'true';

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import * as jwt from 'jsonwebtoken';
import app from '../src/app';
import prisma from '../src/db';
import { Role, RequestStatus, DispatchAttemptStatus, TripLifecycleStatus, VerificationState, AmbulanceType } from '@prisma/client';
import { sanitizeCsvField } from '../src/services/analyticsService';

let server: http.Server;
let baseUrl: string;
const JWT_SECRET = process.env.JWT_SECRET || 'lifelink_jwt_secret_key_2026_super_secure';

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

// User IDs & Tokens
const superAdminId = 'user_super_admin_analytics';
const superAdminToken = createToken({
  id: superAdminId,
  email: 'superadmin.analytics@lifelink.org',
  role: Role.SUPER_ADMIN,
  name: 'Lead Ops Director',
});

const hospitalAdminAId = 'user_hosp_admin_a_analytics';
const hospitalAdminTokenA = createToken({
  id: hospitalAdminAId,
  email: 'admin.gmch@lifelink.org',
  role: Role.ADMIN_HOSPITAL,
  name: 'GMCH Hospital Admin',
});

const hospitalAdminBId = 'user_hosp_admin_b_analytics';
const hospitalAdminTokenB = createToken({
  id: hospitalAdminBId,
  email: 'admin.mayo@lifelink.org',
  role: Role.ADMIN_HOSPITAL,
  name: 'Mayo Hospital Admin',
});

const operatorAdminId = 'user_operator_admin_analytics';
const operatorAdminToken = createToken({
  id: operatorAdminId,
  email: 'manager.apex@lifelink.org',
  role: Role.OPERATOR_ADMIN,
  name: 'Apex Private Fleet Admin',
});

const driverId = 'user_driver_analytics';
const driverToken = createToken({
  id: driverId,
  email: 'driver.analytics@lifelink.org',
  role: Role.DRIVER,
  name: 'Anil Patil',
});

const patientId = 'user_patient_analytics';
const patientToken = createToken({
  id: patientId,
  email: 'patient.analytics@lifelink.org',
  role: Role.PATIENT,
  name: 'Pooja Sharma',
});

let testHospitalAId: string;
let testHospitalBId: string;
let testOperatorId: string;
let testAmbulanceAId: string;
let testAmbulanceBId: string;
let testAmbulanceStaleId: string;
let testAmbulanceOfflineId: string;

test.before(async () => {
  await new Promise<void>((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as any;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });

  // Seed Users
  await prisma.user.create({
    data: { id: superAdminId, email: 'superadmin.analytics@lifelink.org', name: 'Lead Ops Director', role: Role.SUPER_ADMIN, passwordHash: 'hash' },
  });
  await prisma.user.create({
    data: { id: hospitalAdminAId, email: 'admin.gmch@lifelink.org', name: 'GMCH Hospital Admin', role: Role.ADMIN_HOSPITAL, passwordHash: 'hash' },
  });
  await prisma.user.create({
    data: { id: hospitalAdminBId, email: 'admin.mayo@lifelink.org', name: 'Mayo Hospital Admin', role: Role.ADMIN_HOSPITAL, passwordHash: 'hash' },
  });
  await prisma.user.create({
    data: { id: operatorAdminId, email: 'manager.apex@lifelink.org', name: 'Apex Private Fleet Admin', role: Role.OPERATOR_ADMIN, passwordHash: 'hash' },
  });
  await prisma.user.create({
    data: { id: driverId, email: 'driver.analytics@lifelink.org', name: 'Anil Patil', role: Role.DRIVER, passwordHash: 'hash' },
  });
  await prisma.user.create({
    data: { id: patientId, email: 'patient.analytics@lifelink.org', name: 'Pooja Sharma', role: Role.PATIENT, passwordHash: 'hash' },
  });

  // Seed Hospitals
  const hospA = await prisma.hospital.create({
    data: {
      id: 'hosp_analytics_gmch',
      name: 'GMCH Trauma Care Nagpur',
      address: 'Medical Square, Nagpur',
      city: 'Nagpur',
      state: 'Maharashtra',
      contactNumber: '07122744400',
      lat: 21.1293,
      lng: 79.0967,
      totalBeds: 200,
      availableBeds: 40,
      adminUserId: hospitalAdminAId,
      verificationState: VerificationState.VERIFIED,
      capacityLastUpdated: new Date(), // Fresh (<1h)
      isDemo: false,
    },
  });
  testHospitalAId = hospA.id;

  const hospB = await prisma.hospital.create({
    data: {
      id: 'hosp_analytics_mayo',
      name: 'Indira Gandhi Mayo Hospital',
      address: 'Central Avenue, Nagpur',
      city: 'Nagpur',
      state: 'Maharashtra',
      contactNumber: '07122728621',
      lat: 21.1512,
      lng: 79.0911,
      totalBeds: 150,
      availableBeds: 15,
      adminUserId: hospitalAdminBId,
      verificationState: VerificationState.VERIFIED,
      capacityLastUpdated: new Date(Date.now() - 3 * 3600 * 1000), // Stale (3 hours old)
      isDemo: false,
    },
  });
  testHospitalBId = hospB.id;

  // Seed Private Operator
  const op = await prisma.ambulanceOperator.create({
    data: {
      id: 'operator_analytics_apex',
      name: 'Apex Emergency Mobility Fleet',
      address: 'Dharampeth, Nagpur',
      city: 'Nagpur',
      state: 'Maharashtra',
      tradeLicense: 'MH-NGP-2024-OP-01',
      contactPhone: '+919876500000',
      email: 'apex.fleet@lifelink.org',
      adminUserId: operatorAdminId,
      verificationState: VerificationState.VERIFIED,
      isDemo: false,
    },
  });
  testOperatorId = op.id;

  // Seed Ambulances with varied GPS freshness
  const ambA = await prisma.ambulance.create({
    data: {
      id: 'amb_analytics_a',
      vehicleNumber: 'MH-31-AN-0101',
      ambulanceType: AmbulanceType.ADVANCED_LIFE_SUPPORT,
      hospitalId: testHospitalAId,
      isAvailable: true,
      currentLat: 21.1458,
      currentLng: 79.0882,
      lastUpdated: new Date(), // Live (<2m)
      verificationState: VerificationState.VERIFIED,
      isDemo: false,
    },
  });
  testAmbulanceAId = ambA.id;

  const ambB = await prisma.ambulance.create({
    data: {
      id: 'amb_analytics_b',
      vehicleNumber: 'MH-31-AN-0202',
      ambulanceType: AmbulanceType.BASIC_LIFE_SUPPORT,
      operatorId: testOperatorId,
      isAvailable: true,
      currentLat: 21.147,
      currentLng: 79.089,
      lastUpdated: new Date(), // Live
      verificationState: VerificationState.VERIFIED,
      isDemo: false,
    },
  });
  testAmbulanceBId = ambB.id;

  const ambStale = await prisma.ambulance.create({
    data: {
      id: 'amb_analytics_stale',
      vehicleNumber: 'MH-31-AN-0303',
      ambulanceType: AmbulanceType.BASIC_LIFE_SUPPORT,
      hospitalId: testHospitalAId,
      isAvailable: false,
      currentLat: 21.148,
      currentLng: 79.09,
      lastUpdated: new Date(Date.now() - 180000), // 3 minutes old (Stale)
      verificationState: VerificationState.VERIFIED,
      isDemo: false,
    },
  });
  testAmbulanceStaleId = ambStale.id;

  const ambOffline = await prisma.ambulance.create({
    data: {
      id: 'amb_analytics_offline',
      vehicleNumber: 'MH-31-AN-0404',
      ambulanceType: AmbulanceType.BASIC_LIFE_SUPPORT,
      hospitalId: testHospitalBId,
      isAvailable: false,
      currentLat: 21.149,
      currentLng: 79.091,
      lastUpdated: new Date(Date.now() - 400000), // > 6 minutes old (Tracking Outage / Offline)
      verificationState: VerificationState.VERIFIED,
      isDemo: false,
    },
  });
  testAmbulanceOfflineId = ambOffline.id;

  // Seed Emergency Requests and Lifecycle Trips
  const baseTime = Date.now() - 3600000; // 1 hour ago
  const req1 = await prisma.emergencyRequest.create({
    data: {
      id: 'req_analytics_completed_1',
      patientId,
      pickupLat: 21.1458,
      pickupLng: 79.0882,
      status: RequestStatus.COMPLETED,
      tripType: 'SOS',
      category: 'CARDIAC',
      urgencyLevel: 'CRITICAL',
      requiredAmbulanceType: AmbulanceType.ADVANCED_LIFE_SUPPORT,
      hospitalId: testHospitalAId,
      ambulanceId: testAmbulanceAId,
      driverId,
      createdAt: new Date(baseTime),
      completedAt: new Date(baseTime + 1800000), // 30 mins later
      isDemo: false,
    },
  });

  await prisma.emergencyTrip.create({
    data: {
      id: 'trip_analytics_1',
      requestId: req1.id,
      ambulanceId: testAmbulanceAId,
      driverId,
      hospitalId: testHospitalAId,
      pickupLat: 21.1458,
      pickupLng: 79.0882,
      status: TripLifecycleStatus.COMPLETED,
      startedAt: new Date(baseTime + 120000), // +2 min
      arrivedAt: new Date(baseTime + 600000), // +8 min after accept
      pickedUpAt: new Date(baseTime + 900000), // +5 min on scene
      completedAt: new Date(baseTime + 1800000), // +15 min transit
      createdAt: new Date(baseTime),
      isDemo: false,
    },
  });

  // Seed unserved request
  await prisma.emergencyRequest.create({
    data: {
      id: 'req_analytics_unserved_1',
      patientId,
      pickupLat: 21.1458,
      pickupLng: 79.0882,
      status: RequestStatus.NO_ELIGIBLE_AMBULANCE,
      tripType: 'SOS',
      category: 'GENERAL',
      urgencyLevel: 'HIGH',
      requiredAmbulanceType: AmbulanceType.BASIC_LIFE_SUPPORT,
      createdAt: new Date(baseTime + 60000),
      isDemo: false,
    },
  });

  // Seed Demo request (must be excluded from production reporting)
  await prisma.emergencyRequest.create({
    data: {
      id: 'req_analytics_demo_1',
      patientId,
      pickupLat: 21.1458,
      pickupLng: 79.0882,
      status: RequestStatus.COMPLETED,
      tripType: 'SOS',
      category: 'GENERAL',
      urgencyLevel: 'LOW',
      requiredAmbulanceType: AmbulanceType.BASIC_LIFE_SUPPORT,
      createdAt: new Date(baseTime + 120000),
      isDemo: true, // DEMO RECORD
    },
  });

  // Seed Dispatch Attempts
  await prisma.dispatchAttempt.create({
    data: {
      requestId: req1.id,
      driverId,
      ambulanceId: testAmbulanceAId,
      status: DispatchAttemptStatus.ACCEPTED,
      distanceKm: 2.1,
      offeredAt: new Date(baseTime + 60000),
      respondedAt: new Date(baseTime + 120000),
      expiresAt: new Date(baseTime + 180000),
    },
  });

  await prisma.dispatchAttempt.create({
    data: {
      requestId: req1.id,
      driverId,
      ambulanceId: testAmbulanceBId,
      status: DispatchAttemptStatus.EXPIRED,
      distanceKm: 3.5,
      offeredAt: new Date(baseTime + 30000),
      expiresAt: new Date(baseTime + 75000),
    },
  });

  // Seed Pending verification entities for backlog
  await prisma.driverProfile.create({
    data: {
      userId: 'driver_pending_analytics',
      licenseNumber: 'MH31-PENDING-001',
      verificationState: VerificationState.PENDING_REVIEW,
      membershipStatus: 'PENDING',
      isDispatchEligible: false,
    },
  });
});

test.after(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

// =============================================================================
// TEST SUITE 1: AUTHORIZATION & ROLE ACCESS CONTROL
// =============================================================================

test('1.1. Unauthenticated request to /api/v1/analytics/reports returns 401 Unauthorized', async () => {
  const res = await fetch(`${baseUrl}/api/v1/analytics/reports`);
  assert.equal(res.status, 401);
});

test('1.2. Regular user (PATIENT role) request returns 403 Forbidden', async () => {
  const res = await fetch(`${baseUrl}/api/v1/analytics/reports`, {
    headers: { Authorization: `Bearer ${patientToken}` },
  });
  assert.equal(res.status, 403);
});

test('1.3. Driver user (DRIVER role) request returns 403 Forbidden', async () => {
  const res = await fetch(`${baseUrl}/api/v1/analytics/reports`, {
    headers: { Authorization: `Bearer ${driverToken}` },
  });
  assert.equal(res.status, 403);
});

test('1.4. Authorized Super Admin request succeeds with complete 10-module analytics payload', async () => {
  const res = await fetch(`${baseUrl}/api/v1/analytics/reports`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  assert.equal(res.status, 200);
  const json: any = await res.json();
  assert.equal(json.status, 'success');
  const data = json.data;

  // Validate presence of all 10 core modules + metadata
  assert.ok(data.metadata);
  assert.ok(data.emergencyRequests);
  assert.ok(data.dispatchPerformance);
  assert.ok(data.lifecycleDurations);
  assert.ok(data.unservedEmergencyDemand);
  assert.ok(data.fleetAvailability);
  assert.ok(data.gpsFreshness);
  assert.ok(data.hospitalCapacity);
  assert.ok(data.opdAppointmentsAndQueue);
  assert.ok(data.notifications);
  assert.ok(data.verificationBacklog);
});

// =============================================================================
// TEST SUITE 2: ORGANIZATION ISOLATION & TENANCY SCOPING
// =============================================================================

test('2.1. Hospital Admin A receives analytics scoped strictly to Hospital A', async () => {
  const res = await fetch(`${baseUrl}/api/v1/analytics/reports`, {
    headers: { Authorization: `Bearer ${hospitalAdminTokenA}` },
  });
  assert.equal(res.status, 200);
  const json: any = await res.json();
  const data = json.data;

  assert.equal(data.metadata.filtersApplied.hospitalId, testHospitalAId);
  // Fleet count should only reflect Hospital A ambulances
  for (const h of data.hospitalCapacity.hospitals) {
    assert.equal(h.id, testHospitalAId);
  }
});

test('2.2. Hospital Admin A cannot query Hospital B data by overriding query parameter', async () => {
  // Attempting privilege escalation via ?hospitalId=hosp_analytics_mayo
  const res = await fetch(`${baseUrl}/api/v1/analytics/reports?hospitalId=${testHospitalBId}`, {
    headers: { Authorization: `Bearer ${hospitalAdminTokenA}` },
  });
  assert.equal(res.status, 200);
  const json: any = await res.json();
  // Server must enforce user's actual hospitalId from their account
  assert.equal(json.data.metadata.filtersApplied.hospitalId, testHospitalAId);
});

test('2.3. Operator Admin receives analytics scoped strictly to their private fleet', async () => {
  const res = await fetch(`${baseUrl}/api/v1/analytics/reports`, {
    headers: { Authorization: `Bearer ${operatorAdminToken}` },
  });
  assert.equal(res.status, 200);
  const json: any = await res.json();
  assert.equal(json.data.metadata.filtersApplied.operatorId, testOperatorId);
});

// =============================================================================
// TEST SUITE 3: DATE BOUNDARIES & INPUT VALIDATION
// =============================================================================

test('3.1. Invalid date format returns 400 Bad Request', async () => {
  const res = await fetch(`${baseUrl}/api/v1/analytics/reports?startDate=invalid-date`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  assert.equal(res.status, 400);
  const json: any = await res.json();
  assert.ok(json.message.includes('INVALID_DATE_FORMAT'));
});

test('3.2. Reversed date boundaries (startDate > endDate) returns 400 Bad Request', async () => {
  const res = await fetch(
    `${baseUrl}/api/v1/analytics/reports?startDate=2026-10-28&endDate=2026-10-20`,
    {
      headers: { Authorization: `Bearer ${superAdminToken}` },
    }
  );
  assert.equal(res.status, 400);
  const json: any = await res.json();
  assert.ok(json.message.includes('START_DATE_AFTER_END_DATE'));
});

test('3.3. Date boundary filtering correctly restricts metrics window', async () => {
  // Query a date in the past before test requests were created
  const pastStart = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const pastEnd = new Date(Date.now() - 25 * 24 * 3600 * 1000).toISOString();

  const res = await fetch(
    `${baseUrl}/api/v1/analytics/reports?startDate=${pastStart}&endDate=${pastEnd}`,
    {
      headers: { Authorization: `Bearer ${superAdminToken}` },
    }
  );
  assert.equal(res.status, 200);
  const json: any = await res.json();
  // No requests should fall in that past window
  assert.equal(json.data.emergencyRequests.totalRequests, 0);
});

// =============================================================================
// TEST SUITE 4: DEMO DATA EXCLUSION POLICY
// =============================================================================

test('4.1. Production reporting excludes demo records by default (includeDemo=false)', async () => {
  const res = await fetch(`${baseUrl}/api/v1/analytics/reports`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  assert.equal(res.status, 200);
  const json: any = await res.json();
  const prodTotal = json.data.emergencyRequests.totalRequests;

  // Now query with includeDemo=true
  const resDemo = await fetch(`${baseUrl}/api/v1/analytics/reports?includeDemo=true`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  assert.equal(resDemo.status, 200);
  const jsonDemo: any = await resDemo.json();
  const demoTotal = jsonDemo.data.emergencyRequests.totalRequests;

  // The demo query must include the 1 seeded demo request
  assert.equal(demoTotal, prodTotal + 1);
});

// =============================================================================
// TEST SUITE 5: CALCULATIONS & DISTINGUISHING MISSING DATA FROM ZERO
// =============================================================================

test('5.1. Distinguishes missing data from zero: returns null when samples are zero', async () => {
  // Query past date window where no trips occurred
  const pastStart = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const pastEnd = new Date(Date.now() - 25 * 24 * 3600 * 1000).toISOString();

  const res = await fetch(
    `${baseUrl}/api/v1/analytics/reports?startDate=${pastStart}&endDate=${pastEnd}`,
    {
      headers: { Authorization: `Bearer ${superAdminToken}` },
    }
  );
  assert.equal(res.status, 200);
  const json: any = await res.json();
  const durations = json.data.lifecycleDurations;

  // Must be null, NOT 0.0 mins (to avoid misleading operators)
  assert.equal(durations.requestToAssignmentMinutes.averageMinutes, null);
  assert.equal(durations.assignmentToArrivalMinutes.averageMinutes, null);
  assert.equal(durations.totalMissionMinutes.averageMinutes, null);
});

test('5.2. Accurately computes lifecycle durations from persisted timestamps', async () => {
  const res = await fetch(`${baseUrl}/api/v1/analytics/reports`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  assert.equal(res.status, 200);
  const json: any = await res.json();
  const durations = json.data.lifecycleDurations;

  // From seed data:
  // Request created at T0, Accepted at T0 + 2m -> requestToAssignment = 2.0 mins
  // Accepted at T0+2m, Arrived at T0+10m -> assignmentToArrival = 8.0 mins
  // Arrived at T0+10m, Picked up at T0+15m -> arrivalToPickup = 5.0 mins
  // Picked up at T0+15m, Completed at T0+30m -> pickupToCompletion = 15.0 mins
  // Total turnaround: T0 to T0+30m -> totalMission = 30.0 mins
  assert.equal(durations.requestToAssignmentMinutes.averageMinutes, 2);
  assert.equal(durations.assignmentToArrivalMinutes.averageMinutes, 8);
  assert.equal(durations.arrivalToPickupMinutes.averageMinutes, 5);
  assert.equal(durations.pickupToCompletionMinutes.averageMinutes, 15);
  assert.equal(durations.totalMissionMinutes.averageMinutes, 30);
});

test('5.3. Correctly calculates dispatch acceptance and timeout rates', async () => {
  const res = await fetch(`${baseUrl}/api/v1/analytics/reports`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  assert.equal(res.status, 200);
  const json: any = await res.json();
  const dispatch = json.data.dispatchPerformance;

  // 1 accepted, 1 expired = 2 total
  assert.equal(dispatch.totalOffers, 2);
  assert.equal(dispatch.acceptedOffers, 1);
  assert.equal(dispatch.expiredOffers, 1);
  assert.equal(dispatch.acceptanceRate, 50.0);
  assert.equal(dispatch.timeoutRate, 50.0);
});

// =============================================================================
// TEST SUITE 6: PRIVACY & DE-IDENTIFICATION
// =============================================================================

test('6.1. Analytics payload does NOT expose patient names, phone numbers, or addresses', async () => {
  const res = await fetch(`${baseUrl}/api/v1/analytics/reports`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  assert.equal(res.status, 200);
  const jsonStr = await res.text();

  // Patient name 'Pooja Sharma' must NOT appear anywhere in the analytics payload
  assert.ok(!jsonStr.includes('Pooja Sharma'));
  assert.ok(!jsonStr.includes('patient.analytics@lifelink.org'));
});

// =============================================================================
// TEST SUITE 7: AUDIT LOGGING OF PRIVILEGED ACCESS & EXPORTS
// =============================================================================

test('7.1. Privileged report view records an immutable ActivityLog entry', async () => {
  const res = await fetch(`${baseUrl}/api/v1/analytics/reports`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  assert.equal(res.status, 200);

  const logs = await prisma.activityLog.findMany({
    where: { action: 'ANALYTICS_REPORT_VIEWED' },
  });
  assert.ok(logs.length > 0);
});

test('7.2. Privileged CSV export records an immutable ActivityLog entry', async () => {
  const res = await fetch(`${baseUrl}/api/v1/analytics/export?type=summary`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  assert.equal(res.status, 200);

  const logs = await prisma.activityLog.findMany({
    where: { action: 'ANALYTICS_CSV_EXPORTED' },
  });
  assert.ok(logs.length > 0);
});

// =============================================================================
// TEST SUITE 8: CSV EXPORT & FORMULA INJECTION PREVENTION (CWE-1236)
// =============================================================================

test('8.1. CSV export returns valid text/csv format with Content-Disposition header', async () => {
  const res = await fetch(`${baseUrl}/api/v1/analytics/export?type=summary`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  assert.equal(res.status, 200);
  assert.ok(res.headers.get('Content-Type')?.includes('text/csv'));
  assert.ok(res.headers.get('Content-Disposition')?.includes('attachment; filename="lifelink-analytics-summary-'));

  const text = await res.text();
  assert.ok(text.includes('Report Section,Metric,Value,Unit / Note'));
  assert.ok(text.includes('Emergency Requests,Total Requests'));
});

test('8.2. CSV formula injection triggers (=, +, -, @, \\t, \\r) are neutralized with single-quote prefix', () => {
  // Test unit function sanitizeCsvField
  assert.equal(sanitizeCsvField('=SUM(A1:B1)'), "'=SUM(A1:B1)");
  assert.equal(sanitizeCsvField('+919876543210'), "'+919876543210");
  assert.equal(sanitizeCsvField('-100.5'), "'-100.5");
  assert.equal(sanitizeCsvField('@superuser'), "'@superuser");
  assert.equal(sanitizeCsvField('\tindented'), "'\tindented");
  
  // Safe string should not be prefixed
  assert.equal(sanitizeCsvField('Nagpur Central'), 'Nagpur Central');
  
  // Comma containing string should be quoted
  assert.equal(sanitizeCsvField('GMCH, Trauma'), '"GMCH, Trauma"');
});

test('8.3. Invalid export type returns 400 Bad Request', async () => {
  const res = await fetch(`${baseUrl}/api/v1/analytics/export?type=unsupported_type_xyz`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  assert.equal(res.status, 400);
  const json: any = await res.json();
  assert.ok(json.message.includes('Invalid export type'));
});
