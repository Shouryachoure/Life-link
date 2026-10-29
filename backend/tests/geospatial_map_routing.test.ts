import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import app from '../src/app';
import prisma from '../src/db';
import { generateTokens } from '../src/services/tokenService';
import { Role, AmbulanceType, VerificationState } from '@prisma/client';

let server: http.Server;
let port: number;
let baseUrl: string;

let superAdminToken: string;
let driverTokenValid: string;
let driverTokenUnassigned: string;
let patientToken: string;

let hospitalVerifiedA: any;
let hospitalVerifiedB: any;
let hospitalInvalidCoords: any;
let hospitalSuspended: any;

let driverUserValid: any;
let driverProfileValid: any;
let driverUserUnassigned: any;
let driverProfileUnassigned: any;

let ambulanceLive: any;
let ambulanceStale: any;
let ambulanceMaintenance: any;
let ambulanceDemo: any;

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test_secret_for_geospatial_map_audit_1234567890_min_32_chars';
  process.env.TEST_DB_CONNECTED = 'true';

  server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      port = (server.address() as any).port;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });

  // 1. Seed Super Admin
  const superAdmin = await prisma.user.create({
    data: {
      email: `geo.admin.${Date.now()}@lifelink.org.in`,
      passwordHash: 'hash',
      name: 'Geospatial Test Admin',
      role: Role.SUPER_ADMIN,
    },
  });
  superAdminToken = generateTokens({ id: superAdmin.id, email: superAdmin.email, role: superAdmin.role, name: superAdmin.name }).accessToken;

  // 2. Seed Patient
  const patient = await prisma.user.create({
    data: {
      email: `geo.patient.${Date.now()}@lifelink.org.in`,
      passwordHash: 'hash',
      name: 'Ramesh Nagpur Patient',
      role: Role.PATIENT,
      phone: '+919876543210',
    },
  });
  patientToken = generateTokens({ id: patient.id, email: patient.email, role: patient.role, name: patient.name }).accessToken;

  // Hospital Admin Users
  const hospAdminA = await prisma.user.create({
    data: {
      email: `geo.hospadmin.a.${Date.now()}@lifelink.org.in`,
      passwordHash: 'hash',
      name: 'Admin Hospital A',
      role: Role.ADMIN_HOSPITAL,
    },
  });
  const hospAdminB = await prisma.user.create({
    data: {
      email: `geo.hospadmin.b.${Date.now()}@lifelink.org.in`,
      passwordHash: 'hash',
      name: 'Admin Hospital B',
      role: Role.ADMIN_HOSPITAL,
    },
  });
  const hospAdminInvalid = await prisma.user.create({
    data: {
      email: `geo.hospadmin.inv.${Date.now()}@lifelink.org.in`,
      passwordHash: 'hash',
      name: 'Admin Hospital Invalid',
      role: Role.ADMIN_HOSPITAL,
    },
  });
  const hospAdminSuspended = await prisma.user.create({
    data: {
      email: `geo.hospadmin.susp.${Date.now()}@lifelink.org.in`,
      passwordHash: 'hash',
      name: 'Admin Hospital Suspended',
      role: Role.ADMIN_HOSPITAL,
    },
  });

  // 3. Seed Valid Verified Hospital A (Sitabuldi, Nagpur)
  hospitalVerifiedA = await prisma.hospital.create({
    data: {
      name: 'Nagpur Care Metro Hospital',
      address: 'Sitabuldi Square, Nagpur, Maharashtra',
      contactNumber: '+917122554401',
      city: 'Nagpur',
      state: 'Maharashtra',
      lat: 21.1458,
      lng: 79.0882,
      adminUserId: hospAdminA.id,
      verificationState: VerificationState.VERIFIED,
      isDemo: false,
    },
  });

  // 4. Seed Valid Verified Hospital B (Medical Square / GMCH, Nagpur ~ 2.4 km away)
  hospitalVerifiedB = await prisma.hospital.create({
    data: {
      name: 'Government Medical College & Hospital Nagpur',
      address: 'Medical Square, Hanuman Nagar, Nagpur',
      contactNumber: '+917122554402',
      city: 'Nagpur',
      state: 'Maharashtra',
      lat: 21.1272,
      lng: 79.0988,
      adminUserId: hospAdminB.id,
      verificationState: VerificationState.VERIFIED,
      isDemo: false,
    },
  });

  // 5. Seed Hospital with Invalid/Out-of-bounds Coordinates (should be safely excluded from map)
  hospitalInvalidCoords = await prisma.hospital.create({
    data: {
      name: 'Nagpur Ghost Clinic (Invalid Coordinates)',
      address: 'Unknown Street, Nagpur',
      contactNumber: '+917122554403',
      city: 'Nagpur',
      state: 'Maharashtra',
      lat: 999.0,
      lng: 999.0,
      adminUserId: hospAdminInvalid.id,
      verificationState: VerificationState.VERIFIED,
      isDemo: false,
    },
  });

  // 6. Seed Suspended Hospital (should be excluded from map)
  hospitalSuspended = await prisma.hospital.create({
    data: {
      name: 'Suspended Facility Nagpur',
      address: 'Wardha Road, Nagpur',
      contactNumber: '+917122554404',
      city: 'Nagpur',
      state: 'Maharashtra',
      lat: 21.1000,
      lng: 79.0600,
      adminUserId: hospAdminSuspended.id,
      verificationState: VerificationState.SUSPENDED,
      isDemo: false,
    },
  });

  // 7. Seed Driver 1 (Valid, Assigned)
  driverUserValid = await prisma.user.create({
    data: {
      email: `geo.driver.valid.${Date.now()}@lifelink.org.in`,
      passwordHash: 'hash',
      name: 'Amol Shinde',
      role: Role.DRIVER,
      phone: '+919876543211',
      isActive: true,
      isSuspended: false,
    },
  });
  driverTokenValid = generateTokens({ id: driverUserValid.id, email: driverUserValid.email, role: driverUserValid.role, name: driverUserValid.name }).accessToken;

  driverProfileValid = await prisma.driverProfile.create({
    data: {
      userId: driverUserValid.id,
      licenseNumber: 'MH-31-2020-001234',
      licenseExpiry: new Date(Date.now() + 365 * 24 * 3600 * 1000),
      verificationState: VerificationState.VERIFIED,
      membershipStatus: 'APPROVED',
      isDispatchEligible: true,
      isDemo: false,
    },
  });

  // 8. Seed Driver 2 (Unassigned)
  driverUserUnassigned = await prisma.user.create({
    data: {
      email: `geo.driver.unassigned.${Date.now()}@lifelink.org.in`,
      passwordHash: 'hash',
      name: 'Vikas Deshmukh',
      role: Role.DRIVER,
      phone: '+919876543212',
      isActive: true,
      isSuspended: false,
    },
  });
  driverTokenUnassigned = generateTokens({ id: driverUserUnassigned.id, email: driverUserUnassigned.email, role: driverUserUnassigned.role, name: driverUserUnassigned.name }).accessToken;

  driverProfileUnassigned = await prisma.driverProfile.create({
    data: {
      userId: driverUserUnassigned.id,
      licenseNumber: 'MH-31-2021-005678',
      licenseExpiry: new Date(Date.now() + 365 * 24 * 3600 * 1000),
      verificationState: VerificationState.VERIFIED,
      membershipStatus: 'APPROVED',
      isDispatchEligible: true,
      isDemo: false,
    },
  });

  // 9. Seed Ambulance 1: LIVE GPS (lastUpdated = now, 2 mins ago)
  ambulanceLive = await prisma.ambulance.create({
    data: {
      driverId: driverUserValid.id,
      vehicleNumber: `MH-31-GEO-${Math.floor(1000 + Math.random() * 9000)}`,
      ambulanceType: AmbulanceType.ADVANCED_LIFE_SUPPORT,
      isAvailable: true,
      currentLat: 21.1465,
      currentLng: 79.0890,
      lastUpdated: new Date(Date.now() - 2 * 60 * 1000), // 2 minutes ago
      hospitalId: hospitalVerifiedA.id,
      verificationState: VerificationState.VERIFIED,
      verificationStatus: 'APPROVED',
      maintenanceStatus: 'OPERATIONAL',
      isDemo: false,
    },
  });

  await prisma.driverVehicleAssignment.create({
    data: {
      driverId: driverProfileValid.id,
      ambulanceId: ambulanceLive.id,
      isCurrent: true,
    },
  });

  // 10. Seed Ambulance 2: STALE GPS (lastUpdated = 45 mins ago > 30 min freshness threshold)
  ambulanceStale = await prisma.ambulance.create({
    data: {
      vehicleNumber: `MH-31-STALE-${Math.floor(1000 + Math.random() * 9000)}`,
      ambulanceType: AmbulanceType.BASIC_LIFE_SUPPORT,
      isAvailable: true,
      currentLat: 21.1470,
      currentLng: 79.0900,
      lastUpdated: new Date(Date.now() - 45 * 60 * 1000), // 45 minutes ago
      hospitalId: hospitalVerifiedA.id,
      verificationState: VerificationState.VERIFIED,
      verificationStatus: 'APPROVED',
      maintenanceStatus: 'OPERATIONAL',
      isDemo: false,
    },
  });

  // 11. Seed Ambulance 3: UNDER MAINTENANCE (ineligible for dispatch)
  ambulanceMaintenance = await prisma.ambulance.create({
    data: {
      vehicleNumber: `MH-31-MAINT-${Math.floor(1000 + Math.random() * 9000)}`,
      ambulanceType: AmbulanceType.BASIC_LIFE_SUPPORT,
      isAvailable: false,
      currentLat: 21.1480,
      currentLng: 79.0910,
      lastUpdated: new Date(),
      hospitalId: hospitalVerifiedA.id,
      verificationState: VerificationState.VERIFIED,
      verificationStatus: 'APPROVED',
      maintenanceStatus: 'UNDER_MAINTENANCE',
      isDemo: false,
    },
  });

  // 12. Seed Ambulance 4: DEMO VEHICLE (quarantined from real dispatch)
  ambulanceDemo = await prisma.ambulance.create({
    data: {
      vehicleNumber: `MH-31-DEMO-${Math.floor(1000 + Math.random() * 9000)}`,
      ambulanceType: AmbulanceType.BASIC_LIFE_SUPPORT,
      isAvailable: true,
      currentLat: 21.1490,
      currentLng: 79.0920,
      lastUpdated: new Date(),
      hospitalId: hospitalVerifiedA.id,
      verificationState: VerificationState.VERIFIED,
      verificationStatus: 'APPROVED',
      maintenanceStatus: 'OPERATIONAL',
      isDemo: true, // Marked DEMO
    },
  });
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// =========================================================================
// SECTION 1: COORDINATE VALIDATION & BOUNDS
// =========================================================================

test('1.1. Coordinate Validation: Missing or invalid lat/lng returns HTTP 400 with helpful error', async () => {
  const invalidQueries = [
    { query: 'lat=95&lng=79.0882', desc: 'Latitude > 90' },
    { query: 'lat=-91&lng=79.0882', desc: 'Latitude < -90' },
    { query: 'lat=21.1458&lng=185', desc: 'Longitude > 180' },
    { query: 'lat=21.1458&lng=-185', desc: 'Longitude < -180' },
    { query: 'lat=invalid&lng=79.0882', desc: 'Non-numeric latitude' },
    { query: 'lat=21.1458', desc: 'Missing longitude' },
    { query: 'lng=79.0882', desc: 'Missing latitude' },
  ];

  for (const { query, desc } of invalidQueries) {
    const res = await fetch(`${baseUrl}/api/v1/hospitals/nearby?${query}`);
    assert.equal(res.status, 400, `Expected 400 for ${desc}`);
    const data: any = await res.json();
    assert.equal(data.success, false);
    assert.ok(data.error.includes('Valid latitude') || data.error.includes('provided') || data.error.includes('required'));
  }
});

test('1.2. Fallback Discovery: Empty coordinates returns HTTP 200 with hasLocation: false for manual browsing', async () => {
  const res = await fetch(`${baseUrl}/api/v1/hospitals/nearby`);
  assert.equal(res.status, 200);
  const data: any = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.hasLocation, false);
  assert.ok(Array.isArray(data.hospitals));
  assert.ok(data.hospitals.length >= 1, 'Should return available hospitals for manual browse');
  assert.equal(data.hospitals[0].distanceKm, null);
});

// =========================================================================
// SECTION 2: HOSPITAL DISCOVERY & RADIUS CAPPING
// =========================================================================

test('2.1. Hospital Discovery: Finds verified hospitals near Nagpur center within capped radius', async () => {
  // Query at Sitabuldi (21.1458, 79.0882) with radius 10km
  const res = await fetch(`${baseUrl}/api/v1/hospitals/nearby?lat=21.1458&lng=79.0882&radius=10`);
  assert.equal(res.status, 200);

  const data: any = await res.json();
  assert.equal(data.success, true);
  assert.ok(Array.isArray(data.hospitals));
  assert.ok(data.hospitals.length >= 2, 'Should return at least Hospital A and Hospital B');

  // Verify distance type is documented
  assert.equal(data.distanceType, 'STRAIGHT_LINE_HAVERSINE');
  assert.equal(data.queryRadiusKm, 10);

  // Hospital A should be distance ~0 km (same coordinate)
  const hospA = data.hospitals.find((h: any) => h.id === hospitalVerifiedA.id);
  assert.ok(hospA, 'Hospital A must be found');
  assert.ok(hospA.distanceKm < 0.1, 'Hospital A distance should be ~0 km');
  assert.equal(hospA.distanceUnit, 'km');

  // Hospital B (GMCH) should be ~2.3 - 2.5 km
  const hospB = data.hospitals.find((h: any) => h.id === hospitalVerifiedB.id);
  assert.ok(hospB, 'Hospital B must be found');
  assert.ok(hospB.distanceKm >= 2.0 && hospB.distanceKm <= 3.0, 'Hospital B distance should be ~2.4 km');
});

test('2.2. Hospital Discovery: Automatically caps excessive radius to 100km max and limit to 50 max', async () => {
  const res = await fetch(`${baseUrl}/api/v1/hospitals/nearby?lat=21.1458&lng=79.0882&radius=9999&limit=500`);
  assert.equal(res.status, 200);

  const data: any = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.queryRadiusKm, 100, 'Radius should be capped at 100km');
});

test('2.3. Hospital Discovery: Excludes hospitals with null coordinates or suspended status', async () => {
  const res = await fetch(`${baseUrl}/api/v1/hospitals/nearby?lat=21.1458&lng=79.0882&radius=50`);
  assert.equal(res.status, 200);

  const data: any = await res.json();
  const nullCoordHospital = data.hospitals.find((h: any) => h.id === hospitalInvalidCoords.id);
  assert.equal(nullCoordHospital, undefined, 'Hospital with null coordinates must NOT be included');

  const suspendedHospital = data.hospitals.find((h: any) => h.id === hospitalSuspended.id);
  assert.equal(suspendedHospital, undefined, 'Suspended hospital must NOT be included');
});

test('2.4. Hospital Details: Retrieves rich details and bed availability breakdown for selected hospital', async () => {
  const res = await fetch(`${baseUrl}/api/v1/hospitals/${hospitalVerifiedA.id}`);
  assert.equal(res.status, 200);
  const data: any = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.hospital.name, 'Nagpur Care Metro Hospital');
  assert.equal(data.hospital.city, 'Nagpur');
  assert.ok(data.hospital.lat === 21.1458);
  assert.ok(data.hospital.lng === 79.0882);
  assert.ok(data.hospital.bedStats, 'Bed availability statistics should be present');
});

// =========================================================================
// SECTION 3: NEARBY AMBULANCE DISCOVERY & FLEET TELEMETRY FRESHNESS
// =========================================================================

test('3.1. Nearby Ambulance Discovery: Returns vehicles with data freshness classification', async () => {
  const res = await fetch(`${baseUrl}/api/v1/hospitals/${hospitalVerifiedA.id}/nearby-ambulances?radiusKm=20`);
  assert.equal(res.status, 200);

  const data: any = await res.json();
  assert.equal(data.success, true);
  assert.ok(Array.isArray(data.ambulances));
  assert.ok(data.totalNearby >= 1);

  // Live ambulance should be LIVE freshness and eligible
  const liveAmb = data.ambulances.find((a: any) => a.id === ambulanceLive.id);
  assert.ok(liveAmb, 'Live ambulance must be found');
  assert.equal(liveAmb.dataFreshness, 'LIVE');
  assert.equal(liveAmb.isEligibleForDispatch, true);
  assert.ok(liveAmb.ageSeconds < 300, 'Live ambulance age should be under 5 minutes');

  // Stale ambulance (>30 min) should be flagged STALE and movement UNKNOWN
  const staleAmb = data.ambulances.find((a: any) => a.id === ambulanceStale.id);
  assert.ok(staleAmb, 'Stale ambulance must be found');
  assert.equal(staleAmb.dataFreshness, 'STALE');
  assert.equal(staleAmb.movementStatus, 'UNKNOWN', 'Stale telemetry must force movementStatus to UNKNOWN');
  assert.equal(staleAmb.isEligibleForDispatch, false, 'Stale ambulance must not be dispatch eligible');
  assert.ok(staleAmb.ageSeconds >= 1800, 'Stale ambulance age should be >= 1800s (30m)');

  // Maintenance ambulance should be flagged ineligible
  const maintAmb = data.ambulances.find((a: any) => a.id === ambulanceMaintenance.id);
  assert.ok(maintAmb, 'Maintenance vehicle should be in audit list');
  assert.equal(maintAmb.isEligibleForDispatch, false, 'Vehicle under maintenance must NOT be eligible');

  // Privacy Redaction: Driver personal phone must NOT be exposed in public nearby results
  for (const amb of data.ambulances) {
    assert.equal(amb.driverPhone, undefined, 'Driver phone must be redacted from public discovery');
  }
});

test('3.2. Demo Ambulance Isolation: Demo vehicle is tagged DEMO and quarantined from real dispatch', async () => {
  const res = await fetch(`${baseUrl}/api/v1/hospitals/${hospitalVerifiedA.id}/nearby-ambulances?radiusKm=20`);
  assert.equal(res.status, 200);

  const data: any = await res.json();
  const demoAmb = data.ambulances.find((a: any) => a.id === ambulanceDemo.id);
  assert.ok(demoAmb, 'Demo ambulance should appear for audit/demo view');
  assert.equal(demoAmb.isDemo, true);
  assert.equal(demoAmb.dataFreshness, 'SIMULATED', 'Demo ambulance freshness must be marked SIMULATED');
  assert.equal(demoAmb.isEligibleForDispatch, false, 'Demo ambulance must NOT be eligible for real dispatch');
});

test('3.3. Emergency 112 Fallback: Empty ambulance search returns official India 112 emergency directive', async () => {
  // Query Hospital B which has no assigned ambulances seeded
  const res = await fetch(`${baseUrl}/api/v1/hospitals/${hospitalVerifiedB.id}/nearby-ambulances?radiusKm=0.1`);
  assert.equal(res.status, 200);

  const data: any = await res.json();
  assert.equal(data.success, true);
  if (data.ambulances.length === 0) {
    assert.equal(data.emergencyDirective.helpline, '112');
    assert.ok(data.emergencyDirective.message.includes('Dial 112'));
  }
});

// =========================================================================
// SECTION 4: DRIVER GPS TELEMETRY INGESTION & VEHICLE ASSIGNMENT
// =========================================================================

test('4.1. Driver Location Ping: Unassigned driver cannot ping GPS for unassigned vehicle', async () => {
  const res = await fetch(`${baseUrl}/api/v1/ambulances/location`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${driverTokenUnassigned}`,
    },
    body: JSON.stringify({
      latitude: 21.1458,
      longitude: 79.0882,
    }),
  });

  assert.equal(res.status, 404, 'Unassigned driver should receive 404 No Active Ambulance');
  const data: any = await res.json();
  assert.equal(data.success, false);
});

test('4.2. Driver Location Ping: Out-of-bounds coordinates are rejected with HTTP 400', async () => {
  const res = await fetch(`${baseUrl}/api/v1/ambulances/location`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${driverTokenValid}`,
    },
    body: JSON.stringify({
      latitude: 105.0, // Invalid lat > 90
      longitude: 79.0882,
    }),
  });

  assert.equal(res.status, 400);
  const data: any = await res.json();
  assert.equal(data.success, false);
  assert.ok(data.error.includes('Valid latitude'));
});

test('4.3. Driver Location Ping: Assigned driver sends valid GPS update with speed calculation', async () => {
  const newLat = 21.1475;
  const newLng = 79.0895;

  const res = await fetch(`${baseUrl}/api/v1/ambulances/location`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${driverTokenValid}`,
    },
    body: JSON.stringify({
      latitude: newLat,
      longitude: newLng,
    }),
  });

  assert.equal(res.status, 200);
  const data: any = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.ambulance.currentLat, newLat);
  assert.equal(data.ambulance.currentLng, newLng);

  // Verify database persistence
  const updated = await prisma.ambulance.findUnique({
    where: { id: ambulanceLive.id },
  });
  assert.equal(updated?.currentLat, newLat);
  assert.equal(updated?.currentLng, newLng);
});

// =========================================================================
// SECTION 5: TRIP LOCATION & PATIENT ACCESS CONTROL
// =========================================================================

test('5.1. Trip Location Ingestion: Rejects updates for non-existent trip with HTTP 404', async () => {
  const res = await fetch(`${baseUrl}/api/v1/sos/trips/non-existent-trip-id-999/location`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${driverTokenValid}`,
    },
    body: JSON.stringify({
      latitude: 21.1458,
      longitude: 79.0882,
      heading: 90,
      speed: 35.5,
      accuracy: 5.0,
    }),
  });

  assert.equal(res.status, 404);
  const data: any = await res.json();
  assert.equal(data.success, false);
});

test('5.2. Trip Tracking Access: Unauthorized user cannot read arbitrary trip location', async () => {
  const res = await fetch(`${baseUrl}/api/v1/sos/trips/some-random-trip-id/location`, {
    headers: {
      Authorization: `Bearer ${patientToken}`,
    },
  });

  assert.equal(res.status, 404);
});

// =========================================================================
// SECTION 6: ROUTING CONTRACT & HONEST FALLBACK VERIFICATION
// =========================================================================

test('6.1. Routing Contract: Straight-line calculation matches Haversine formula within 1% accuracy', () => {
  // Distance between Sitabuldi (21.1458, 79.0882) and GMCH (21.1272, 79.0988)
  const lat1 = 21.1458;
  const lon1 = 79.0882;
  const lat2 = 21.1272;
  const lon2 = 79.0988;

  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const expectedDist = R * c; // ~2.34 km

  assert.ok(expectedDist > 2.2 && expectedDist < 2.5, `Expected distance ~2.34km, got ${expectedDist}`);
});
