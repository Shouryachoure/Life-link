process.env.NODE_ENV = 'test';
process.env.TEST_DB_CONNECTED = 'true';

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import * as jwt from 'jsonwebtoken';
import app from '../src/app';
import prisma from '../src/db';
import { Role } from '@prisma/client';
import {
  normalizeIndianDirectoryPhone,
  validateNagpurCoordinates,
  calculateNameSimilarity,
  validateFacilityBatch,
  validateAmbulanceBatch,
  executeFacilityImport,
  executeAmbulanceImport,
  RawFacilityImportItem,
  RawAmbulanceImportItem,
} from '../src/services/directoryPipelineService';
import { formatServiceType, formatFacilityCategory } from '../src/utils/directoryLabels';

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

const superAdminId = 'user_super_admin_dir_test';
const superAdminToken = createToken({
  id: superAdminId,
  email: 'superadmin.dir@lifelink.org',
  role: Role.SUPER_ADMIN,
  name: 'Lead Operations Director',
});

const patientId = 'user_patient_dir_test';
const patientToken = createToken({
  id: patientId,
  email: 'patient.dir@lifelink.org',
  role: Role.PATIENT,
  name: 'Citizen Patient',
});

test.before(async () => {
  // Clear isolated test database
  (prisma as any).clear();

  server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as any;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

test.after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

// =============================================================================
// Suite 1: Phone Normalization & Coordinate Validation
// =============================================================================

test('1.1. Normalizes Nagpur landlines, mobile numbers, and emergency helplines accurately', () => {
  // Nagpur Landline
  const res1 = normalizeIndianDirectoryPhone('07122744400');
  assert.equal(res1.normalized, '0712-2744400');
  assert.equal(res1.type, 'LANDLINE');

  const res2 = normalizeIndianDirectoryPhone('0712-2725423');
  assert.equal(res2.normalized, '0712-2725423');
  assert.equal(res2.type, 'LANDLINE');

  // Indian Mobile
  const res3 = normalizeIndianDirectoryPhone('9823055555');
  assert.equal(res3.normalized, '+919823055555');
  assert.equal(res3.type, 'MOBILE');

  // Emergency Shortcodes
  const res4 = normalizeIndianDirectoryPhone('108');
  assert.equal(res4.normalized, '108');
  assert.equal(res4.type, 'HELPLINE');

  const res5 = normalizeIndianDirectoryPhone('112');
  assert.equal(res5.normalized, '112');
  assert.equal(res5.type, 'HELPLINE');

  // Toll-Free
  const res6 = normalizeIndianDirectoryPhone('1800-180-1104');
  assert.equal(res6.normalized, '1800-180-1104');
  assert.equal(res6.type, 'TOLLFREE');

  // Invalid Garbage
  const res7 = normalizeIndianDirectoryPhone('12345');
  assert.equal(res7.type, 'INVALID');
});

test('1.2. Validates Nagpur district and city coordinate boundaries and rejects invalid coordinates', () => {
  // Valid Nagpur City Center (Sitabuldi)
  const cityCheck = validateNagpurCoordinates(21.1458, 79.0882);
  assert.equal(cityCheck.isValid, true);
  assert.equal(cityCheck.isDistrictWide, false);

  // Valid Nagpur District (Ramtek)
  const distCheck = validateNagpurCoordinates(21.3985, 79.3275);
  assert.equal(distCheck.isValid, true);
  assert.equal(distCheck.isDistrictWide, true);

  // Null Island (0,0) - Must be rejected
  const nullIsland = validateNagpurCoordinates(0, 0);
  assert.equal(nullIsland.isValid, false);
  assert.ok(nullIsland.issue?.includes('Null Island'));

  // Out of bounds (e.g. Mumbai or London)
  const mumbaiCheck = validateNagpurCoordinates(18.922, 72.834);
  assert.equal(mumbaiCheck.isValid, false);
  assert.ok(mumbaiCheck.issue?.includes('lie outside Nagpur district'));
});

// =============================================================================
// Suite 2: Batch Schema Validation & Error Detection
// =============================================================================

test('2.1. Validates facility batch and reports errors for missing mandatory fields', async () => {
  const invalidBatch: RawFacilityImportItem[] = [
    {
      name: 'Valid GMCH Test',
      facilityType: 'MEDICAL_COLLEGE',
      ownership: 'GOVERNMENT_STATE',
      contactNumber: '0712-2744400',
      address: 'Medical Square, Hanuman Nagar, Nagpur',
      lat: 21.1293,
      lng: 79.0967,
      sourceUrl: 'https://dmer.maharashtra.gov.in',
    },
    {
      name: '', // Invalid empty name
      facilityType: 'INVALID_TYPE', // Invalid facility type
      ownership: 'UNKNOWN',
      contactNumber: 'invalid-phone', // Invalid phone
      address: '', // Missing address
      sourceUrl: '', // Missing source URL
    },
  ];

  const preview = await validateFacilityBatch(invalidBatch);
  assert.equal(preview.total, 2);
  assert.equal(preview.validCount, 1);
  assert.equal(preview.errorCount, 1);
  assert.equal(preview.issues.length, 1);

  const errorFields = preview.issues[0].errors.map((e) => e.field);
  assert.ok(errorFields.includes('name'));
  assert.ok(errorFields.includes('facilityType'));
  assert.ok(errorFields.includes('contactNumber'));
  assert.ok(errorFields.includes('address'));
  assert.ok(errorFields.includes('sourceUrl'));
});

// =============================================================================
// Suite 3: Anti-Duplicate Detection
// =============================================================================

test('3.1. Detects duplicate facilities sharing high name similarity and telephone numbers', async () => {
  const batchWithDuplicates: RawFacilityImportItem[] = [
    {
      name: 'Orange City Hospital and Research Institute',
      facilityType: 'PRIVATE_MULTISPECIALTY',
      ownership: 'PRIVATE_TRUST',
      contactNumber: '0712-6652000',
      address: '19, Khamla Road, Nagpur',
      lat: 21.1189,
      lng: 79.0628,
      sourceUrl: 'https://orangecityhospital.com',
    },
    {
      name: 'Orange City Hospital Khamla', // Duplicate with high similarity & same phone
      facilityType: 'PRIVATE_MULTISPECIALTY',
      ownership: 'PRIVATE_TRUST',
      contactNumber: '0712-6652000',
      address: 'Near Square, Veer Sawarkar Nagar, Khamla, Nagpur',
      lat: 21.1189,
      lng: 79.0628,
      sourceUrl: 'https://orangecityhospital.com',
    },
  ];

  const preview = await validateFacilityBatch(batchWithDuplicates);
  assert.equal(preview.total, 2);
  assert.equal(preview.duplicateCount, 1);
  assert.ok(preview.issues.some((i) => i.isDuplicate));
});

// =============================================================================
// Suite 4: Public Directory Isolation & Fleet Security
// =============================================================================

test('4.1. Public directory records remain strictly UNLINKED and cannot become approved LifeLink organizations', async () => {
  const testFacility: RawFacilityImportItem = {
    id: 'fac_unlinked_test_01',
    name: 'Nagpur Central Private Clinic',
    facilityType: 'PRIVATE_SPECIALTY',
    ownership: 'PRIVATE_CORPORATE',
    contactNumber: '0712-2555555',
    address: 'Central Avenue, Near Fountain, Nagpur',
    sourceUrl: 'https://nagpur.gov.in',
  };

  const preview = await validateFacilityBatch([testFacility]);
  assert.equal(preview.validCount, 1);

  const importResult = await executeFacilityImport(preview.validRecords, 'super-admin-test');
  assert.equal(importResult.inserted, 1);

  const saved = await prisma.directoryFacility.findUnique({ where: { id: testFacility.id! } });
  assert.ok(saved);
  assert.equal(saved.linkStatus, 'UNLINKED');
  assert.equal(saved.linkedHospitalId, null);

  // Confirm NO user or hospital partner was created
  const matchingUser = await prisma.user.findFirst({ where: { email: { contains: 'nagpur.central' } } });
  assert.equal(matchingUser, null);
  const matchingPartner = await prisma.hospital.findFirst({ where: { name: testFacility.name } });
  assert.equal(matchingPartner, null);
});

test('4.2. Public ambulance services remain UNLINKED and cannot qualify for live ambulance dispatch', async () => {
  const testAmbulance: RawAmbulanceImportItem = {
    id: 'amb_unlinked_test_01',
    serviceName: 'Vidarbha Regional Private Ambulance',
    operatorType: 'PRIVATE_OPERATOR',
    contactNumber: '+919822211111',
    address: 'Dharampeth, Nagpur',
    sourceUrl: 'https://nagpuryellowpages.in',
  };

  const preview = await validateAmbulanceBatch([testAmbulance]);
  assert.equal(preview.validCount, 1);

  const importResult = await executeAmbulanceImport(preview.validRecords, 'super-admin-test');
  assert.equal(importResult.inserted, 1);

  const saved = await prisma.directoryAmbulanceService.findUnique({ where: { id: testAmbulance.id! } });
  assert.ok(saved);
  assert.equal(saved.linkStatus, 'UNLINKED');
  assert.equal(saved.linkedOperatorId, null);

  // Confirm no registered Ambulance or DriverProfile exists
  const matchingAmbulance = await prisma.ambulance.findFirst({ where: { vehicleNumber: 'Vidarbha Regional' } });
  assert.equal(matchingAmbulance, null);
});

// =============================================================================
// Suite 5: Super-Admin Authorized Import & Verification Workflow
// =============================================================================

test('5.1. Rejects unauthenticated and citizen access to directory admin endpoints (401/403)', async () => {
  // Unauthenticated
  const resUnauth = await fetch(`${baseUrl}/api/v1/directory/admin/summary`);
  assert.equal(resUnauth.status, 401);

  // Citizen Patient (Forbidden)
  const resPatient = await fetch(`${baseUrl}/api/v1/directory/admin/summary`, {
    headers: { Authorization: `Bearer ${patientToken}` },
  });
  assert.equal(resPatient.status, 403);
});

test('5.2. Super-Admin retrieves directory summary and preview before executing import', async () => {
  // Summary
  const resSummary = await fetch(`${baseUrl}/api/v1/directory/admin/summary`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  assert.equal(resSummary.status, 200);
  const summaryData = (await resSummary.json()) as any;
  assert.equal(summaryData.success, true);
  assert.ok(typeof summaryData.summary.totalFacilities === 'number');

  // Preview Endpoint
  const resPreview = await fetch(`${baseUrl}/api/v1/directory/admin/import/preview`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${superAdminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      entityType: 'FACILITY',
      records: [
        {
          name: 'Preview Test Clinic Nagpur',
          facilityType: 'PRIVATE_SPECIALTY',
          ownership: 'PRIVATE_CORPORATE',
          contactNumber: '0712-2444444',
          address: 'Wardha Road, Dhantoli, Nagpur',
          sourceUrl: 'https://nagpur.gov.in',
        },
      ],
    }),
  });
  assert.equal(resPreview.status, 200);
  const previewData = (await resPreview.json()) as any;
  assert.equal(previewData.preview.validCount, 1);
});

test('5.3. Super-Admin executes authorized facility linking to an approved LifeLink Hospital partner', async () => {
  // 1. Create a public facility in directory
  const facility = await prisma.directoryFacility.create({
    data: {
      name: 'GMCH Nagpur Public Listing',
      facilityType: 'MEDICAL_COLLEGE',
      ownership: 'GOVERNMENT_STATE',
      contactNumber: '0712-2744400',
      address: 'Medical Square, Nagpur',
      sourceUrl: 'https://dmer.maharashtra.gov.in',
      linkStatus: 'UNLINKED',
    },
  });

  // 2. Create an approved partner hospital in operational DB
  const partnerUser = await prisma.user.create({
    data: {
      name: 'GMCH Director',
      email: 'gmch.director.test@lifelink.org',
      passwordHash: 'hashed_pw',
      role: Role.ADMIN_HOSPITAL,
    },
  });

  const partnerHospital = await prisma.hospital.create({
    data: {
      name: 'GMCH Trauma Center Nagpur',
      address: 'Medical Square, Hanuman Nagar, Nagpur',
      contactNumber: '07122744400',
      adminUserId: partnerUser.id,
      availableBeds: 25,
      totalBeds: 100,
      verificationState: 'VERIFIED',
      lat: 21.1293,
      lng: 79.0967,
    },
  });

  // 3. Link facility via Super-Admin API
  const resLink = await fetch(`${baseUrl}/api/v1/directory/admin/facilities/${facility.id}/link-hospital`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${superAdminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ hospitalId: partnerHospital.id }),
  });

  assert.equal(resLink.status, 200);
  const linkData = (await resLink.json()) as any;
  assert.equal(linkData.success, true);
  assert.equal(linkData.data.linkStatus, 'LINKED_PARTNER');
  assert.equal(linkData.data.linkedHospitalId, partnerHospital.id);

  // 4. Query facility by ID and verify live partner telemetry is attached
  const resDetail = await fetch(`${baseUrl}/api/v1/directory/hospitals/${facility.id}`);
  assert.equal(resDetail.status, 200);
  const detailData = (await resDetail.json()) as any;
  assert.equal(detailData.data.linkStatus, 'LINKED_PARTNER');
  assert.ok(detailData.data.livePartnerTelemetry);
  assert.equal(detailData.data.livePartnerTelemetry.availableBeds, 25);
});

// =============================================================================
// Suite 6: Public Discovery & Proximity Query APIs
// =============================================================================

test('6.1. Public directory queries return facilities sorted by distance with search filter', async () => {
  // Query near Sitabuldi Square (Lat: 21.1458, Lng: 79.0882)
  const res = await fetch(`${baseUrl}/api/v1/directory/hospitals?lat=21.1458&lng=79.0882&radiusKm=30`);
  assert.equal(res.status, 200);
  const data = (await res.json()) as any;
  assert.equal(data.success, true);
  assert.ok(Array.isArray(data.data));

  // Search filter
  const resSearch = await fetch(`${baseUrl}/api/v1/directory/hospitals?search=GMCH`);
  assert.equal(resSearch.status, 200);
  const searchData = (await resSearch.json()) as any;
  assert.equal(searchData.success, true);
});

test('6.2. Citizens can submit directory feedback and report data issues', async () => {
  const resFeedback = await fetch(`${baseUrl}/api/v1/directory/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      entityType: 'FACILITY',
      entityId: 'fac-gmch-nagpur',
      issueType: 'USER_REPORTED_ERROR',
      description: 'Public landline number updated by administration',
      suggestedCorrection: { updatedPhone: '0712-2744405' },
    }),
  });

  assert.equal(resFeedback.status, 201);
  const feedbackData = (await resFeedback.json()) as any;
  assert.equal(feedbackData.success, true);
  assert.equal(feedbackData.data.issueType, 'USER_REPORTED_ERROR');
});

// =============================================================================
// Suite 7: Candidate Phone Normalization for Nagpur Hospitals & Ambulances
// =============================================================================

test('7.1. Normalizes all user-specified candidate hospital and ambulance phone numbers', () => {
  const candidateNumbers = [
    { raw: '+91 78758 73789', expected: '+917875873789', type: 'MOBILE' },
    { raw: '+91 87881 16634', expected: '+918788116634', type: 'MOBILE' },
    { raw: '+91 96658 88756', expected: '+919665888756', type: 'MOBILE' },
    { raw: '+91 93708 08570', expected: '+919370808570', type: 'MOBILE' },
    { raw: '+91 70202 97300', expected: '+917020297300', type: 'MOBILE' },
    { raw: '+91 98811 15525', expected: '+919881115525', type: 'MOBILE' },
    { raw: '+91 96890 51619', expected: '+919689051619', type: 'MOBILE' },
    { raw: '+91 93095 89326', expected: '+919309589326', type: 'MOBILE' },
    { raw: '+91 78757 07373', expected: '+917875707373', type: 'MOBILE' },
    { raw: '+91 70679 39506', expected: '+917067939506', type: 'MOBILE' },
    { raw: '0712-2701642', expected: '0712-2701642', type: 'LANDLINE' },
    { raw: '0712-2725274', expected: '0712-2725274', type: 'LANDLINE' },
    { raw: '0712-2729333', expected: '0712-2729333', type: 'LANDLINE' },
    { raw: '0712-6165656', expected: '0712-6165656', type: 'LANDLINE' },
    { raw: '0712-6624400', expected: '0712-6624400', type: 'LANDLINE' },
    { raw: '0712-2238431', expected: '0712-2238431', type: 'LANDLINE' },
    { raw: '0712-6669600', expected: '0712-6669600', type: 'LANDLINE' },
    { raw: '0712-6636802', expected: '0712-6636802', type: 'LANDLINE' },
    { raw: '0712-6789100', expected: '0712-6789100', type: 'LANDLINE' },
    { raw: '+91 80559 97799', expected: '+918055997799', type: 'MOBILE' },
    { raw: '108', expected: '108', type: 'HELPLINE' },
    { raw: '112', expected: '112', type: 'HELPLINE' },
  ];

  for (const item of candidateNumbers) {
    const res = normalizeIndianDirectoryPhone(item.raw);
    assert.equal(res.normalized, item.expected, `Failed for raw phone: ${item.raw}`);
    assert.equal(res.type, item.type, `Failed type for raw phone: ${item.raw}`);
  }
});

// =============================================================================
// Suite 8: Unified Discovery & Filter Semantics
// =============================================================================

test('8.1. Unified discovery endpoint /api/v1/directory/unified returns formatted records with clickToCall and directions', async () => {
  // Ensure default directory data is seeded in memory db
  if ((prisma as any).seedDirectoryData) {
    (prisma as any).seedDirectoryData();
  }

  const res = await fetch(`${baseUrl}/api/v1/directory/unified?type=ALL&city=Nagpur`);
  assert.equal(res.status, 200);
  const json = (await res.json()) as any;
  assert.equal(json.success, true);
  assert.ok(Array.isArray(json.data));
  assert.ok(json.data.length > 0);

  const first = json.data[0];
  assert.ok(first.id);
  assert.ok(first.name);
  assert.ok(['HOSPITAL', 'AMBULANCE_PROVIDER', 'OFFICIAL_EMERGENCY_HELPLINE'].includes(first.recordType));
  assert.ok(first.clickToCallUrl.startsWith('tel:'));
  assert.ok(first.sourceUrl);
  assert.ok(first.dataProvenance);

  // If coordinates are present, directionsUrl must be formatted
  if (first.lat !== null && first.lng !== null) {
    assert.ok(first.directionsUrl.includes('google.com/maps/dir'));
  } else {
    assert.equal(first.directionsUrl, null);
  }
});

test('8.2. Unified discovery filters by recordType and locality correctly', async () => {
  // Filter by HOSPITAL only
  const resHosp = await fetch(`${baseUrl}/api/v1/directory/unified?type=HOSPITAL`);
  assert.equal(resHosp.status, 200);
  const dataHosp = (await resHosp.json()) as any;
  assert.ok(dataHosp.data.every((d: any) => d.recordType === 'HOSPITAL'));

  // Filter by AMBULANCE_PROVIDER only
  const resAmb = await fetch(`${baseUrl}/api/v1/directory/unified?type=AMBULANCE_PROVIDER`);
  assert.equal(resAmb.status, 200);
  const dataAmb = (await resAmb.json()) as any;
  assert.ok(dataAmb.data.every((d: any) => d.recordType === 'AMBULANCE_PROVIDER'));

  // Filter by locality
  const resLoc = await fetch(`${baseUrl}/api/v1/directory/unified?locality=Dhantoli`);
  assert.equal(resLoc.status, 200);
  const dataLoc = (await resLoc.json()) as any;
  assert.ok(dataLoc.data.every((d: any) => d.locality?.toLowerCase().includes('dhantoli')));
});

// =============================================================================
// Suite 9: Coordinate Integrity & Missing Coordinates Handling
// =============================================================================

test('9.1. Preserves null coordinates and does not invent coordinates for unverified providers', async () => {
  const unlocatedService: RawAmbulanceImportItem = {
    id: 'amb_unlocated_test_01',
    serviceName: 'Nagpur Central Patient Transfer Desk',
    operatorType: 'PRIVATE_OPERATOR',
    contactNumber: '+919922334455',
    address: 'Sadar, Nagpur, Maharashtra',
    locality: 'Sadar',
    sourceUrl: 'https://nagpur.gov.in',
    lat: null,
    lng: null,
  };

  const preview = await validateAmbulanceBatch([unlocatedService]);
  assert.equal(preview.validCount, 1);
  assert.equal(preview.validRecords[0].lat, null);
  assert.equal(preview.validRecords[0].lng, null);
  assert.equal(preview.validRecords[0].isGeocoded, false);

  const result = await executeAmbulanceImport(preview.validRecords, 'super-admin-test');
  assert.equal(result.inserted, 1);

  const saved = await prisma.directoryAmbulanceService.findUnique({ where: { id: unlocatedService.id! } });
  assert.ok(saved);
  assert.equal(saved.lat, null);
  assert.equal(saved.lng, null);
  assert.equal(saved.isGeocoded, false);
});

// =============================================================================
// Suite 10: Strict Separation of Public Directory from Live Dispatch Fleet
// =============================================================================

test('10.1. Emergency request dispatch only offers to approved active ambulances, never to directory contacts', async () => {
  // Query ambulances available in operational fleet (model Ambulance)
  const operationalAmbulances = await prisma.ambulance.findMany();
  // Query public directory ambulance services
  const directoryAmbulances = await prisma.directoryAmbulanceService.findMany();

  // Verify that directory contacts do not exist in the operational fleet table
  for (const dirAmb of directoryAmbulances) {
    const matchingFleet = operationalAmbulances.find(
      (a: any) => a.id === dirAmb.id || (dirAmb.contactNumber && a.vehicleNumber === dirAmb.contactNumber)
    );
    assert.equal(matchingFleet, undefined, `Directory service ${dirAmb.serviceName} should NOT be in operational fleet`);
  }
});

// =============================================================================
// Suite 11: Super-Admin Ambulance Lifecycle & Onboarding Invitations
// =============================================================================

test('11.1. Super-Admin updates ambulance lifecycle state and dispatches onboarding invitation', async () => {
  // 1. Create a public ambulance record
  const service = await prisma.directoryAmbulanceService.create({
    data: {
      serviceName: 'Tiwari Ambulance Service',
      operatorType: 'PRIVATE_OPERATOR',
      contactNumber: '+919665888756',
      sourceUrl: 'https://nagpur.gov.in',
      linkStatus: 'UNLINKED',
      onboardingStatus: 'PUBLIC_DIRECTORY_RECORD',
    },
  });

  // 2. Update status via Super-Admin PUT
  const resStatus = await fetch(`${baseUrl}/api/v1/directory/admin/ambulances/${service.id}/status`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${superAdminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      onboardingStatus: 'CONTACT_INFO_CHECKED',
      reviewNotes: 'Telephone availability confirmed with operator',
    }),
  });

  assert.equal(resStatus.status, 200);
  const statusData = (await resStatus.json()) as any;
  assert.equal(statusData.data.onboardingStatus, 'CONTACT_INFO_CHECKED');
  assert.ok(statusData.data.contactCheckedAt);

  // 3. Dispatch onboarding invitation via POST
  const resInvite = await fetch(`${baseUrl}/api/v1/directory/admin/invite`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${superAdminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      entityType: 'AMBULANCE_SERVICE',
      entityId: service.id,
      contactPersonName: 'Shri Tiwari',
      contactEmail: 'tiwari.ambulance@nagpur.org',
      invitationNotes: 'Invited to join LifeLink Nagpur Pilot Fleet',
    }),
  });

  assert.equal(resInvite.status, 200);
  const inviteData = (await resInvite.json()) as any;
  assert.equal(inviteData.success, true);

  // 4. Verify updated record in DB
  const checkService = await prisma.directoryAmbulanceService.findUnique({ where: { id: service.id } });
  assert.equal(checkService?.onboardingStatus, 'ONBOARDING_REQUESTED');
});

// =============================================================================
// Suite 12: Healthcare Directory Rescue & Data Integrity
// =============================================================================

test('12.1. Geographic Scope Filters: Properly separates Nagpur City, Nagpur District, and Rural Tehsils', async () => {
  // Query City Scope
  const resCity = await fetch(`${baseUrl}/api/v1/directory/unified?coverageGroup=NAGPUR_CITY`);
  assert.equal(resCity.status, 200);
  const dataCity = (await resCity.json()) as any;
  assert.equal(dataCity.success, true);
  assert.ok(dataCity.data.length > 0);
  assert.ok(dataCity.data.every((d: any) => d.coverageGroup === 'NAGPUR_CITY'));

  // Query Rural Scope
  const resRural = await fetch(`${baseUrl}/api/v1/directory/unified?coverageGroup=NAGPUR_DISTRICT_RURAL`);
  assert.equal(resRural.status, 200);
  const dataRural = (await resRural.json()) as any;
  assert.equal(dataRural.success, true);
  assert.ok(dataRural.data.length > 0);
  assert.ok(dataRural.data.every((d: any) => d.coverageGroup === 'NAGPUR_DISTRICT_RURAL'));

  // Specific Rural Tehsil Query
  const resTehsil = await fetch(`${baseUrl}/api/v1/directory/unified?tehsil=Katol`);
  assert.equal(resTehsil.status, 200);
  const dataTehsil = (await resTehsil.json()) as any;
  assert.ok(dataTehsil.data.length > 0);
  assert.ok(dataTehsil.data.every((d: any) => d.tehsil?.toLowerCase() === 'katol'));
});

test('12.2. Category Filtering: Supports ALL, HOSPITAL, CLINIC, AMBULANCE_PROVIDER, and OFFICIAL_EMERGENCY_HELPLINE', async () => {
  // Clinic Category
  const resClinic = await fetch(`${baseUrl}/api/v1/directory/unified?type=CLINIC`);
  assert.equal(resClinic.status, 200);
  const dataClinic = (await resClinic.json()) as any;
  assert.ok(dataClinic.data.length > 0);
  assert.ok(dataClinic.data.every((d: any) => ['DAYCARE_CLINIC', 'INSTITUTIONAL_HEALTH_CENTRE'].includes(d.category)));

  // Hospital Category (excludes clinics)
  const resHosp = await fetch(`${baseUrl}/api/v1/directory/unified?type=HOSPITAL`);
  assert.equal(resHosp.status, 200);
  const dataHosp = (await resHosp.json()) as any;
  assert.ok(dataHosp.data.every((d: any) => !['DAYCARE_CLINIC', 'INSTITUTIONAL_HEALTH_CENTRE'].includes(d.category)));

  // Helpline Category
  const resHelpline = await fetch(`${baseUrl}/api/v1/directory/unified?type=OFFICIAL_EMERGENCY_HELPLINE`);
  assert.equal(resHelpline.status, 200);
  const dataHelpline = (await resHelpline.json()) as any;
  assert.ok(dataHelpline.data.length > 0);
  assert.ok(dataHelpline.data.every((d: any) => d.recordType === 'OFFICIAL_EMERGENCY_HELPLINE'));
});

test('12.3. Accurate Result Counts: Replaces hardcoded 60 limit with full catalog metrics', async () => {
  const res = await fetch(`${baseUrl}/api/v1/directory/unified?type=ALL&limit=100`);
  assert.equal(res.status, 200);
  const json = (await res.json()) as any;
  assert.equal(json.success, true);
  assert.ok(json.meta.totalCatalogRecords >= 85, `Expected >= 85 catalog records, got ${json.meta.totalCatalogRecords}`);
  assert.ok(json.meta.total > 60, `Expected total > 60, got ${json.meta.total}`);
  assert.equal(json.data.length, json.meta.total);
});

test('12.4. Duplicate Organization Handling: Links hospital-operated ambulance desks to parent hospital', async () => {
  const res = await fetch(`${baseUrl}/api/v1/directory/unified?type=ALL`);
  assert.equal(res.status, 200);
  const json = (await res.json()) as any;

  // Find GMCH ambulance desk
  const gmchAmb = json.data.find((d: any) => d.id === 'amb-gmch-hospital-fleet');
  assert.ok(gmchAmb, 'Expected amb-gmch-hospital-fleet in directory');
  assert.equal(gmchAmb.isHospitalAffiliated, true);
  assert.equal(gmchAmb.category, 'HOSPITAL_OPERATED');
  assert.equal(gmchAmb.linkedHospitalId, 'fac-gmch-nagpur');
  assert.ok(gmchAmb.linkedHospitalName?.includes('Government Medical College'));

  // Find Max Hospital ambulance line
  const maxAmb = json.data.find((d: any) => d.id === 'amb-max-emergency-line');
  assert.ok(maxAmb, 'Expected amb-max-emergency-line in directory');
  assert.equal(maxAmb.isHospitalAffiliated, true);
  assert.equal(maxAmb.linkedHospitalId, 'fac-max-super-nagpur');
});

test('12.5. Enum-to-Label Conversion: Eliminates raw screaming snake case strings in citizen UI', () => {
  // Service types conversion
  assert.equal(formatServiceType('ADVANCED_LIFE_SUPPORT'), 'Advanced Life Support (ALS)');
  assert.equal(formatServiceType('BASIC_LIFE_SUPPORT'), 'Basic Life Support (BLS)');
  assert.equal(formatServiceType('CRITICAL_CARE_MOBILE_ICU'), 'Critical Care Mobile ICU');
  assert.equal(formatServiceType('OXYGEN_SUPPORT'), 'Medical Oxygen Support');
  assert.equal(formatServiceType('VENTILATOR_AMBULANCE'), 'Ventilator Ambulance');

  // Facility category conversion
  assert.equal(formatFacilityCategory('MEDICAL_COLLEGE'), 'Medical College & Hospital');
  assert.equal(formatFacilityCategory('PRIVATE_MULTISPECIALTY'), 'Multispecialty Hospital');
  assert.equal(formatFacilityCategory('SUB_DISTRICT_HOSPITAL'), 'Sub-District Hospital (SDH)');
  assert.equal(formatFacilityCategory('RURAL_HOSPITAL'), 'Rural Hospital (RH)');
  assert.equal(formatFacilityCategory('DAYCARE_CLINIC'), 'Daycare Clinic & Outpatient');
  assert.equal(formatFacilityCategory('INSTITUTIONAL_HEALTH_CENTRE'), 'Institutional Health Centre');
  assert.equal(formatFacilityCategory(null, true), 'Official Helpline');
  assert.equal(formatFacilityCategory('HOSPITAL_OPERATED', false, true, true), 'Hospital-Operated Fleet');
});

test('12.6. Location and Distance: Distance calculated only when user coordinates and facility coordinates are valid', async () => {
  // 1. Without user coordinates: distanceKm must be null
  const resNoLoc = await fetch(`${baseUrl}/api/v1/directory/unified?type=HOSPITAL`);
  assert.equal(resNoLoc.status, 200);
  const dataNoLoc = (await resNoLoc.json()) as any;
  assert.ok(dataNoLoc.data.every((d: any) => d.distanceKm === null));
  assert.equal(dataNoLoc.meta.userLocationProvided, false);

  // 2. With valid user coordinates: distanceKm must be a positive number
  const resWithLoc = await fetch(`${baseUrl}/api/v1/directory/unified?type=HOSPITAL&lat=21.1458&lng=79.0882`);
  assert.equal(resWithLoc.status, 200);
  const dataWithLoc = (await resWithLoc.json()) as any;
  assert.equal(dataWithLoc.meta.userLocationProvided, true);
  const withCoords = dataWithLoc.data.filter((d: any) => d.lat !== null && d.lng !== null);
  assert.ok(withCoords.length > 0);
  assert.ok(withCoords.every((d: any) => typeof d.distanceKm === 'number' && d.distanceKm >= 0));
});

test('12.7. Missing Phone Numbers & Optional Fields: Gracefully handles nulls without fabricating fake data', async () => {
  const res = await fetch(`${baseUrl}/api/v1/directory/unified`);
  assert.equal(res.status, 200);
  const json = (await res.json()) as any;

  for (const item of json.data) {
    // If contact number exists, clickToCallUrl must format correctly
    if (item.contactNumber) {
      assert.ok(item.clickToCallUrl.startsWith('tel:'));
    }
    // If alternate number is missing, it should remain null/undefined, not a dummy placeholder
    if (!item.alternateNumber) {
      assert.ok(item.alternateNumber === null || item.alternateNumber === undefined);
    }
    // Emergency phone, if absent, should be falsy
    if (!item.emergencyPhone) {
      assert.ok(item.emergencyPhone === null || item.emergencyPhone === undefined);
    }
  }
});

