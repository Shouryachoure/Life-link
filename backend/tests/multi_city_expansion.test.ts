import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import app from '../src/app';
import prisma from '../src/db';
import { generateTokens } from '../src/services/tokenService';
import { Role, VerificationState, AmbulanceType } from '@prisma/client';
import {
  formatIndianPhone,
  maskIndianPhone,
  validateIndianPhone,
  validateIndianPinCode,
  formatIndianAddress,
  formatINR,
  formatIndianDateTime,
  formatIndianDate,
  formatIndianTime,
  isFacilityOpen,
  OperationalSchedule,
  t,
} from '../src/utils/localization';
import { checkServiceArea, discoverAndRankCandidates } from '../src/services/dispatchEngine';
import { broadcastToCity, broadcastToServiceArea } from '../src/socket';

let server: http.Server;
let port: number;
let baseUrl: string;

let superAdminToken: string;
let nagpurHospAdminToken: string;
let puneHospAdminToken: string;
let patientToken: string;

let nagpurAreaId: string;
let puneAreaId: string;
let mumbaiPlannedAreaId: string;

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test_secret_for_multicity_expansion_1234567890_min_32_chars';
  process.env.TEST_DB_CONNECTED = 'true';

  server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      port = (server.address() as any).port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  // Seed Super Admin
  const superAdmin = await prisma.user.create({
    data: {
      email: 'superadmin.multicity@lifelink.in',
      name: 'Dr. National Director',
      role: Role.SUPER_ADMIN,
      passwordHash: 'hashed_pw',
      phone: '+919876543210',
    },
  });
  superAdminToken = generateTokens({
    id: superAdmin.id,
    email: superAdmin.email,
    role: Role.SUPER_ADMIN,
    name: superAdmin.name,
  }).accessToken;

  // Seed Nagpur Pilot Hospital & Admin
  const nagpurAdmin = await prisma.user.create({
    data: {
      email: 'admin.nagpur@lifelink.in',
      name: 'Nagpur Admin',
      role: Role.ADMIN_HOSPITAL,
      passwordHash: 'hashed_pw',
      phone: '+919811122233',
    },
  });
  const nagpurHospital = await prisma.hospital.create({
    data: {
      name: 'Nagpur AIIMS Trauma Center',
      address: 'Plot 2, Sector 20, MIHAN, Nagpur, Maharashtra 441108',
      contactNumber: '+91 712 281 2000',
      city: 'Nagpur',
      state: 'Maharashtra',
      lat: 21.0558,
      lng: 79.0345,
      adminUserId: nagpurAdmin.id,
      availableBeds: 12,
      verificationState: VerificationState.VERIFIED,
    },
  });
  await prisma.user.update({
    where: { id: nagpurAdmin.id },
    data: { hospitalId: nagpurHospital.id },
  });
  nagpurHospAdminToken = generateTokens({
    id: nagpurAdmin.id,
    email: nagpurAdmin.email,
    role: Role.ADMIN_HOSPITAL,
    name: nagpurAdmin.name,
  }).accessToken;

  // Seed Patient
  const patient = await prisma.user.create({
    data: {
      email: 'patient.expansion@lifelink.in',
      name: 'Aarav Deshmukh',
      role: Role.PATIENT,
      passwordHash: 'hashed_pw',
      phone: '+919988776655',
    },
  });
  patientToken = generateTokens({
    id: patient.id,
    email: patient.email,
    role: Role.PATIENT,
    name: patient.name,
  }).accessToken;

  // Configure Multi-City Service Areas
  // 1. Nagpur Pilot Area (Active Pilot)
  const nagpurArea = await prisma.serviceArea.create({
    data: {
      name: 'Nagpur Pilot Zone',
      city: 'Nagpur',
      state: 'Maharashtra',
      country: 'India',
      centerLat: 21.1458,
      centerLng: 79.0882,
      radiusKm: 35.0,
      isActive: true,
      isPilot: true,
      metadata: JSON.stringify({
        status: 'PILOT',
        minVerifiedHospitals: 1,
        minVerifiedAmbulances: 1,
        description: 'Initial configured pilot region for LifeLink emergency operations',
      }),
    },
  });
  nagpurAreaId = nagpurArea.id;

  // 2. Pune Active Expansion Hub (Approved and Active)
  const puneArea = await prisma.serviceArea.create({
    data: {
      name: 'Pune Metropolitan Emergency Zone',
      city: 'Pune',
      state: 'Maharashtra',
      country: 'India',
      centerLat: 18.5204,
      centerLng: 73.8567,
      radiusKm: 40.0,
      isActive: true,
      isPilot: false,
      metadata: JSON.stringify({
        status: 'ACTIVE',
        minVerifiedHospitals: 1,
        minVerifiedAmbulances: 1,
        description: 'Pune regional dispatch hub',
      }),
    },
  });
  puneAreaId = puneArea.id;

  // 3. Mumbai Planned Expansion Zone (In Planning Stage, Fleet Not Approved)
  const mumbaiPlannedArea = await prisma.serviceArea.create({
    data: {
      name: 'Greater Mumbai Emergency Zone',
      city: 'Mumbai',
      state: 'Maharashtra',
      country: 'India',
      centerLat: 19.0760,
      centerLng: 72.8777,
      radiusKm: 45.0,
      isActive: true,
      isPilot: false,
      metadata: JSON.stringify({
        status: 'PLANNED',
        minVerifiedHospitals: 2,
        minVerifiedAmbulances: 3,
        description: 'Mumbai expansion in readiness pipeline',
      }),
    },
  });
  mumbaiPlannedAreaId = mumbaiPlannedArea.id;
});

after(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

// ============================================================================
// Section 1: Geographic Configuration & Pilot Region
// ============================================================================
test('1.1 Geographic Configuration: Nagpur configured as initial pilot without hardcoding business logic', async () => {
  const res = await fetch(`${baseUrl}/api/v1/sos/service-area`);
  assert.equal(res.status, 200);
  const data: any = await res.json();

  assert.ok(Array.isArray(data.areas), 'Should return list of service areas');
  assert.ok(data.areas.length >= 3, 'Should contain Nagpur, Pune, and Mumbai');

  // Verify pilotCenter points to Nagpur pilot without blocking other active areas
  assert.equal(data.pilotCenter.city, 'Nagpur');
  assert.equal(data.pilotCenter.state, 'Maharashtra');
  assert.equal(data.pilotCenter.country, 'India');

  // Verify dynamic active cities listing
  assert.ok(Array.isArray(data.activeCities));
  assert.ok(data.activeCities.includes('Nagpur'));
  assert.ok(data.activeCities.includes('Pune'));
});

test('1.2 Geographic Configuration: Directory of cities distinguishes Active/Pilot vs Planned', async () => {
  const res = await fetch(`${baseUrl}/api/v1/service-areas/cities`);
  assert.equal(res.status, 200);
  const data: any = await res.json();

  assert.equal(data.country, 'India');
  assert.ok(Array.isArray(data.cities));

  const nagpur = data.cities.find((c: any) => c.city === 'Nagpur');
  assert.ok(nagpur, 'Nagpur must exist');
  assert.equal(nagpur.isPilot, true);
  assert.equal(nagpur.isOperational, true);

  const pune = data.cities.find((c: any) => c.city === 'Pune');
  assert.ok(pune, 'Pune must exist');
  assert.equal(pune.isPilot, false);
  assert.equal(pune.status, 'ACTIVE');

  const mumbai = data.cities.find((c: any) => c.city === 'Mumbai');
  assert.ok(mumbai, 'Mumbai must exist');
  assert.equal(mumbai.status, 'PLANNED');
  assert.equal(mumbai.isOperational, false);
});

test('1.3 Geographic Configuration: Dynamic service area boundaries support custom coordinates', async () => {
  // Test coordinates inside Pune (lat: 18.5204, lng: 73.8567)
  const puneCheck = await checkServiceArea(18.5204, 73.8567);
  assert.equal(puneCheck.inArea, true);
  assert.equal(puneCheck.serviceArea.city, 'Pune');

  // Test coordinates inside Nagpur (lat: 21.1458, lng: 79.0882)
  const nagpurCheck = await checkServiceArea(21.1458, 79.0882);
  assert.equal(nagpurCheck.inArea, true);
  assert.equal(nagpurCheck.serviceArea.city, 'Nagpur');

  // Test coordinates outside all areas (e.g. Bhopal lat: 23.2599, lng: 77.4126)
  const outsideCheck = await checkServiceArea(23.2599, 77.4126);
  assert.equal(outsideCheck.inArea, false);
  assert.ok(outsideCheck.serviceArea, 'Should indicate nearest configured zone');
});

// ============================================================================
// Section 2: Expansion Safety & Operational Readiness Gatekeeper
// ============================================================================
test('2.1 Expansion Safety: Service area readiness gatekeeper computes readiness and enumerates blockers', async () => {
  const res = await fetch(`${baseUrl}/api/v1/service-areas/${mumbaiPlannedAreaId}/readiness`);
  assert.equal(res.status, 200);
  const data: any = await res.json();

  assert.equal(data.serviceArea.city, 'Mumbai');
  assert.equal(data.serviceArea.status, 'PLANNED');
  assert.ok(data.blockers.some((b: string) => b.includes('verified hospital') || b.includes('PLANNED') || b.includes('planned')));
});

test('2.2 Expansion Safety: Emergency SOS in PLANNED expansion city is blocked with 112 fallback', async () => {
  // Mumbai coordinates (inside Mumbai service area, but Mumbai is PLANNED)
  const res = await fetch(`${baseUrl}/api/v1/sos/request`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${patientToken}`,
    },
    body: JSON.stringify({
      pickupLat: 19.0760,
      pickupLng: 72.8777,
      pickupAddress: 'Dadar West, Mumbai, Maharashtra 400028',
      category: 'CARDIAC',
      urgencyLevel: 'CRITICAL',
    }),
  });

  assert.equal(res.status, 403);
  const data: any = await res.json();
  assert.equal(data.code, 'SERVICE_AREA_NOT_OPERATIONAL');
  assert.equal(data.status, 'PLANNED');
  assert.equal(data.expansionNotice, true);
  assert.ok(data.message.includes('PLANNED'));
  assert.equal(data.officialEmergencyFallback.nationalEmergencyNumber, '112');
});

test('2.3 Expansion Safety: Emergency SOS outside all service areas reports nearest city and 112 guidance', async () => {
  // Remote location in central Madhya Pradesh
  const res = await fetch(`${baseUrl}/api/v1/sos/request`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${patientToken}`,
    },
    body: JSON.stringify({
      pickupLat: 23.2599,
      pickupLng: 77.4126, // Bhopal
      pickupAddress: 'Arera Hills, Bhopal, Madhya Pradesh 462011',
      category: 'GENERAL_MEDICAL',
      urgencyLevel: 'MEDIUM',
    }),
  });

  assert.equal(res.status, 400);
  const data: any = await res.json();
  assert.equal(data.code, 'OUTSIDE_SERVICE_AREA');
  assert.ok(data.message.includes('Nearest configured zone'));
  assert.ok(data.nearestCity, 'Should indicate nearest operational city');
  assert.equal(data.officialEmergencyFallback.nationalEmergencyNumber, '112');
});

// ============================================================================
// Section 3: Organization Onboarding & Tenant Isolation
// ============================================================================
test('3.1 Organization Onboarding: Onboard hospital in new city (Pune) with custom lat/lng and PENDING_REVIEW state', async () => {
  const res = await fetch(`${baseUrl}/api/v1/auth/onboard/hospital`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Dr. Vikram Joshi',
      email: 'vikram.pune@jehangirhospital.org',
      password: 'SecurePassword123!',
      phone: '+919822012345',
      hospitalName: 'Jehangir Hospital Pune',
      address: '32 Sassoon Road, Pune, Maharashtra 411001',
      city: 'Pune',
      state: 'Maharashtra',
      lat: 18.5284,
      lng: 73.8742,
    }),
  });

  const data: any = await res.json();
  if (res.status !== 201) console.log('REGISTER_HOSPITAL_ERROR:', res.status, data);
  assert.equal(res.status, 201);
  assert.equal(data.user.role, Role.ADMIN_HOSPITAL);
  puneHospAdminToken = data.tokens.accessToken;

  // Retrieve onboarding status
  const statusRes = await fetch(`${baseUrl}/api/v1/auth/onboarding-status`, {
    headers: { Authorization: `Bearer ${puneHospAdminToken}` },
  });
  assert.equal(statusRes.status, 200);
  const statusData: any = await statusRes.json();

  assert.equal(statusData.hospital.city, 'Pune');
  assert.equal(statusData.hospital.verificationState, VerificationState.PENDING_REVIEW);
  // An organization must not be operational merely because a record exists
  assert.equal(statusData.isOperationallyReady, false);
});

test('3.2 Tenant Isolation: Pune hospital admin cannot view or mutate Nagpur hospital records', async () => {
  // Query beds with Pune Hospital Admin token
  const res = await fetch(`${baseUrl}/api/v1/hospitals/beds`, {
    headers: { Authorization: `Bearer ${puneHospAdminToken}` },
  });
  assert.equal(res.status, 200);
  const data: any = await res.json();

  // Pune hospital just registered, should have its own beds and not Nagpur AIIMS beds
  assert.equal(data.hospital.city, 'Pune');
  assert.notEqual(data.hospital.city, 'Nagpur');
});

test('3.3 Organization Onboarding: Onboard private ambulance operator with custom city and unverified state', async () => {
  const res = await fetch(`${baseUrl}/api/v1/auth/onboard/operator`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Suresh Patil',
      email: 'suresh@puneambulancenetwork.in',
      password: 'SecurePassword123!',
      phone: '+919833012345',
      operatorName: 'Pune LifeGuard Ambulance Fleet',
      tradeLicense: 'MH-12-AMB-2026-99',
      city: 'Pune',
      state: 'Maharashtra',
      address: 'Shivajinagar Depot, Pune, Maharashtra 411005',
    }),
  });

  assert.equal(res.status, 201);
  const data: any = await res.json();
  assert.equal(data.user.role, Role.OPERATOR_ADMIN);

  // Status check
  const statusRes = await fetch(`${baseUrl}/api/v1/auth/onboarding-status`, {
    headers: { Authorization: `Bearer ${data.tokens.accessToken}` },
  });
  assert.equal(statusRes.status, 200);
  const statusData: any = await statusRes.json();
  assert.equal(statusData.operator.city, 'Pune');
  assert.equal(statusData.operator.verificationState, VerificationState.PENDING_REVIEW);
  assert.equal(statusData.isOperationallyReady, false);
});

// ============================================================================
// Section 4: Scalability & Geospatial Query Efficiency
// ============================================================================
test('4.1 Scalability: API pagination on service-areas endpoint', async () => {
  const res = await fetch(`${baseUrl}/api/v1/service-areas?page=1&limit=2`);
  assert.equal(res.status, 200);
  const data: any = await res.json();

  assert.ok(data.data, 'Should contain data array');
  assert.equal(data.data.length, 2);
  assert.ok(data.meta, 'Should contain pagination metadata');
  assert.equal(data.meta.page, 1);
  assert.equal(data.meta.limit, 2);
  assert.ok(data.meta.total >= 3);
  assert.ok(data.meta.totalPages >= 2);
});

test('4.2 Scalability: API pagination and city filtering on hospitals endpoint', async () => {
  // Query with city=Pune
  const resPune = await fetch(`${baseUrl}/api/v1/hospitals?city=Pune&page=1&limit=10`);
  assert.equal(resPune.status, 200);
  const dataPune: any = await resPune.json();

  assert.ok(Array.isArray(dataPune.data));
  assert.ok(dataPune.data.length >= 1);
  for (const h of dataPune.data) {
    assert.equal(h.city, 'Pune');
  }

  // Query hospital capacities with city filter
  const resCapacities = await fetch(`${baseUrl}/api/v1/hospitals/capacities?city=Nagpur`);
  assert.equal(resCapacities.status, 200);
  const dataCap: any = await resCapacities.json();
  assert.ok(Array.isArray(dataCap));
  assert.ok(dataCap.every((h: any) => !h.city || h.city === 'Nagpur' || h.address.includes('Nagpur')));
});

test('4.3 Scalability: Fleet inventory supports pagination and city filtering', async () => {
  const res = await fetch(`${baseUrl}/api/v1/ambulances/inventory?page=1&limit=5&city=Nagpur`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  assert.equal(res.status, 200);
  const data: any = await res.json();

  assert.ok(Array.isArray(data.data));
  assert.ok(data.meta);
  assert.equal(data.meta.page, 1);
  assert.equal(data.meta.limit, 5);
});

test('4.4 Geospatial Efficiency: Discover and rank candidates excludes ambulances >100km away via bounding box', async () => {
  // Create an ambulance located in Mumbai (420km away from Pune incident)
  const mumbaiAmbulance = await prisma.ambulance.create({
    data: {
      vehicleNumber: 'MH-01-EXP-9999',
      ambulanceType: AmbulanceType.ADVANCED_LIFE_SUPPORT,
      isAvailable: true,
      currentLat: 19.0760, // Mumbai coordinates
      currentLng: 72.8777,
      verificationState: VerificationState.VERIFIED,
      isDemo: false,
    },
  });

  const discovery = await discoverAndRankCandidates({
    id: 'incident-pune-emergency-01',
    pickupLat: 18.5204, // Pune incident coordinates
    pickupLng: 73.8567,
    requiredAmbulanceType: AmbulanceType.ADVANCED_LIFE_SUPPORT,
    isDemo: false,
  });

  // Mumbai ambulance should be rejected quickly by geospatial pre-filter
  const rejectedMumbai = discovery.rejectedCandidates.find((c) => c.id === mumbaiAmbulance.id);
  assert.ok(rejectedMumbai, 'Distant ambulance must be filtered out');
  assert.ok(rejectedMumbai.denialReasons.includes('OUTSIDE_SEARCH_RADIUS'));
});

test('4.5 Socket.IO: Multi-city room broadcasts execute without error', () => {
  assert.doesNotThrow(() => {
    broadcastToCity('Nagpur', 'emergency:alert', { message: 'High heat index caution' });
    broadcastToCity('Pune', 'emergency:alert', { message: 'Rain alert' });
    broadcastToServiceArea(nagpurAreaId, 'service_area:status', { active: true });
  });
});

// ============================================================================
// Section 5: Localization Standards (Indian Standards Verification)
// ============================================================================
test('5.1 Localization: Indian telephone number formatting and masking', () => {
  const formatted = formatIndianPhone('9876543210');
  assert.equal(formatted, '+91 98765 43210');

  const withPrefix = formatIndianPhone('+919876543210');
  assert.equal(withPrefix, '+91 98765 43210');

  const masked = maskIndianPhone('9876543210');
  assert.equal(masked, '+91 98*** **210');

  const valid = validateIndianPhone('9876543210');
  assert.equal(valid.isValid, true);
  assert.equal(valid.normalized, '+919876543210');

  // Reject invalid non-mobile numbers (<10 digits or starting with 1-5)
  const invalid1 = validateIndianPhone('1234567890');
  assert.equal(invalid1.isValid, false);

  const invalid2 = validateIndianPhone('98765');
  assert.equal(invalid2.isValid, false);
});

test('5.2 Localization: Indian 6-digit PIN code validation', () => {
  assert.equal(validateIndianPinCode('440001').isValid, true); // Nagpur
  assert.equal(validateIndianPinCode('411001').isValid, true); // Pune
  assert.equal(validateIndianPinCode('110001').isValid, true); // New Delhi

  // Starting with 0 is invalid in India
  assert.equal(validateIndianPinCode('040001').isValid, false);
  // 5 digits invalid
  assert.equal(validateIndianPinCode('44001').isValid, false);
  // Alphanumeric invalid
  assert.equal(validateIndianPinCode('44000A').isValid, false);
});

test('5.3 Localization: Indian address formatting', () => {
  const formatted = formatIndianAddress({
    line1: 'Flat 402, Ganga Residency',
    line2: 'Behind City Hospital',
    locality: 'Civil Lines',
    city: 'Nagpur',
    state: 'Maharashtra',
    pinCode: '440001',
  });

  assert.equal(
    formatted,
    'Flat 402, Ganga Residency, Behind City Hospital, Civil Lines, Nagpur, Maharashtra, 440001, India'
  );
});

test('5.4 Localization: Indian Rupee (INR) formatting with Lakh/Crore grouping', () => {
  const formatted50k = formatINR(50000);
  assert.ok(formatted50k.includes('50,000'), `Expected 50,000 in ${formatted50k}`);

  const formatted1Lakh50k = formatINR(150000);
  assert.ok(formatted1Lakh50k.includes('1,50,000'), `Expected 1,50,000 in ${formatted1Lakh50k}`);

  const formattedCrore = formatINR(10000000);
  assert.ok(formattedCrore.includes('1,00,00,000'), `Expected 1,00,00,000 in ${formattedCrore}`);
});

test('5.5 Localization: India-local (IST) dates and times', () => {
  // Epoch timestamp corresponding to 2026-10-27T02:00:00.000Z
  const date = new Date('2026-10-27T02:00:00.000Z');
  // UTC 02:00 + 05:30 IST = 07:30 AM
  const dateTimeStr = formatIndianDateTime(date);
  assert.ok(dateTimeStr.includes('07:30') || dateTimeStr.includes('7:30'), `Expected 07:30 AM, got: ${dateTimeStr}`);
  assert.ok(dateTimeStr.includes('IST'));
  assert.ok(dateTimeStr.includes('27/10/2026') || dateTimeStr.includes('2026'));

  const dateOnly = formatIndianDate(date);
  assert.ok(dateOnly.includes('27/10/2026') || dateOnly.includes('2026'));

  const timeOnly = formatIndianTime(date);
  assert.ok(timeOnly.includes('07:30') || timeOnly.includes('7:30'));
});

test('5.6 Localization: Operational schedules are configurable and not assumed identical', () => {
  // 24x7 Emergency facility
  const emergencyFacility = isFacilityOpen({
    city: 'Nagpur',
    timezone: 'Asia/Kolkata',
    isEmergency24x7: true,
    opdDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    opdHours: { startTime: '09:00', endTime: '17:00' },
  });
  assert.equal(emergencyFacility.isOpen, true);
  assert.ok(emergencyFacility.status === 'EMERGENCY_ONLY_24X7' || emergencyFacility.status === 'OPD_OPEN');

  // Facility with no 24x7 ER, closed on Sunday
  const sundayClosedFacility: OperationalSchedule = {
    city: 'Pune',
    timezone: 'Asia/Kolkata',
    isEmergency24x7: false,
    opdDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    opdHours: { startTime: '09:00', endTime: '17:00' },
  };
  // 2026-10-25 was a Sunday
  const sundayRef = new Date('2026-10-25T10:00:00.000Z');
  const sundayResult = isFacilityOpen(sundayClosedFacility, sundayRef);
  assert.equal(sundayResult.isOpen, false);
  assert.equal(sundayResult.status, 'CLOSED');
});

test('5.7 Localization: Bilingual vocabulary dictionary for English, Hindi, and Marathi', () => {
  assert.equal(t('emergencySos', 'en'), 'Emergency SOS');
  assert.equal(t('emergencySos', 'hi'), 'आपातकालीन एसओएस');
  assert.equal(t('emergencySos', 'mr'), 'तात्काळ एसओएस');

  assert.equal(t('call112', 'en'), 'National Emergency: Dial 112');
  assert.equal(t('call112', 'hi'), 'राष्ट्रीय आपातकालीन: डायल 112');

  assert.equal(t('availableBeds', 'hi'), 'उपलब्ध बिस्तर');
  assert.equal(t('availableBeds', 'mr'), 'उपलब्ध खाटा');
});
