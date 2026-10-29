process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_secret_for_hospital_doctor_directory_2026_super_secure';
process.env.TEST_DB_CONNECTED = 'true';

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import app from '../src/app';
import prisma from '../src/db';
import { generateTokens } from '../src/services/tokenService';
import { Role, VerificationState } from '@prisma/client';
import { doctorDirectoryPipeline } from '../src/services/doctorDirectoryPipelineService';

let server: http.Server;
let port: number;
let baseUrl: string;

let superAdminToken: string;
let superAdminUser: any;
let patientToken: string;
let patientUser: any;
let verifiedHospital: any;
let verifiedDoctor: any;
let verifiedSlot: any;

function getFutureDate(daysAhead: number = 2): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

before(async () => {
  // Clear and seed isolated dev/test database
  (prisma as any).clear();
  (prisma as any).seedDefaultDevData();

  server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      port = (server.address() as any).port;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });

  // 1. Create Super Admin user & token
  superAdminUser = await prisma.user.create({
    data: {
      email: `superadmin.directory.${Date.now()}@lifelink.org.in`,
      passwordHash: 'hash',
      name: 'SuperAdmin Director',
      role: Role.SUPER_ADMIN,
    },
  });
  superAdminToken = generateTokens({
    id: superAdminUser.id,
    email: superAdminUser.email,
    role: superAdminUser.role,
    name: superAdminUser.name,
  }).accessToken;

  // 2. Create Patient user & token
  patientUser = await prisma.user.create({
    data: {
      email: `patient.directory.${Date.now()}@lifelink.org.in`,
      passwordHash: 'hash',
      name: 'Test Citizen Patient',
      role: Role.PATIENT,
    },
  });
  patientToken = generateTokens({
    id: patientUser.id,
    email: patientUser.email,
    role: patientUser.role,
    name: patientUser.name,
  }).accessToken;

  // 3. Create a Verified Partner Hospital & Verified Doctor with Slots for comparison testing
  verifiedHospital = await prisma.hospital.create({
    data: {
      name: 'LifeLink Verified City Hospital Nagpur',
      address: 'Ramdaspeth, Nagpur, Maharashtra',
      lat: 21.1350,
      lng: 79.0750,
      contactNumber: '+91 712 244 5500',
      adminUserId: superAdminUser.id,
      verificationState: VerificationState.VERIFIED,
      locality: 'Ramdaspeth',
    },
  });

  verifiedDoctor = await prisma.doctor.create({
    data: {
      hospitalId: verifiedHospital.id,
      name: 'Dr. Rajesh Deshmukh',
      specialization: 'General Medicine',
      designation: 'Senior Consultant',
      consultationFee: 500,
      defaultSlotDuration: 15,
      isActive: true,
      bookingEnabled: true,
      verificationStatus: 'VERIFIED_PARTNER',
      specialtiesList: ['General Medicine', 'Internal Medicine'],
    } as any,
  });

  const slotDate = getFutureDate(3);
  verifiedSlot = await prisma.doctorSlot.create({
    data: {
      doctorId: verifiedDoctor.id,
      date: slotDate,
      startTime: '10:00',
      endTime: '10:15',
      maxPatients: 5,
      bookedCount: 0,
      slotDurationMinutes: 15,
      isBlocked: false,
    },
  });
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

// =============================================================================
// Suite 1: Phase 1 & 2 - Hospital Search & Alias Normalization
// =============================================================================

test('1.1. "max" finds Max Super Speciality Hospital, Nagpur', async () => {
  const res = await fetch(`${baseUrl}/api/v1/hospitals/nearby?search=max`);
  assert.strictEqual(res.status, 200);
  const data = (await res.json()) as any;
  assert.ok(Array.isArray(data.hospitals), 'Expected hospitals array');

  const maxMatch = data.hospitals.find((h: any) => h.id === 'fac-max-super-nagpur');
  assert.ok(maxMatch, 'Should find Max Super Speciality Hospital with search="max"');
  assert.match(maxMatch.name, /Max Super Speciality Hospital/i);
  assert.strictEqual(maxMatch.id, 'fac-max-super-nagpur');
  assert.strictEqual(maxMatch.locality, 'Mankapur');
});

test('1.2. "Max Hospital" and "Max Super Speciality Hospital Nagpur" resolve to the exact same hospital', async () => {
  const res1 = await fetch(`${baseUrl}/api/v1/hospitals/nearby?search=Max%20Hospital`);
  assert.strictEqual(res1.status, 200);
  const data1 = (await res1.json()) as any;
  const match1 = data1.hospitals.find((h: any) => h.id === 'fac-max-super-nagpur');
  assert.ok(match1, 'Should find Max Super Speciality Hospital with search="Max Hospital"');

  const res2 = await fetch(`${baseUrl}/api/v1/hospitals/nearby?search=Max%20Super%20Speciality%20Hospital%20Nagpur`);
  assert.strictEqual(res2.status, 200);
  const data2 = (await res2.json()) as any;
  const match2 = data2.hospitals.find((h: any) => h.id === 'fac-max-super-nagpur');
  assert.ok(match2, 'Should find Max Super Speciality Hospital with full name search');
  assert.strictEqual(match1.id, match2.id, 'Stable hospital ID fac-max-super-nagpur must match across searches');
});

test('1.3. Alias searches ("Alexis Hospital" and "Alexis") resolve to the exact same hospital record', async () => {
  const resAlexisHosp = await fetch(`${baseUrl}/api/v1/hospitals/nearby?search=Alexis%20Hospital`);
  assert.strictEqual(resAlexisHosp.status, 200);
  const dataAlexisHosp = (await resAlexisHosp.json()) as any;
  const matchAlexisHosp = dataAlexisHosp.hospitals.find((h: any) => h.id === 'fac-max-super-nagpur');
  assert.ok(matchAlexisHosp, 'Should find hospital when searching by former name "Alexis Hospital"');

  const resAlexis = await fetch(`${baseUrl}/api/v1/hospitals/nearby?search=Alexis`);
  assert.strictEqual(resAlexis.status, 200);
  const dataAlexis = (await resAlexis.json()) as any;
  const matchAlexis = dataAlexis.hospitals.find((h: any) => h.id === 'fac-max-super-nagpur');
  assert.ok(matchAlexis, 'Should find hospital when searching by former short name "Alexis"');

  assert.strictEqual(matchAlexisHosp.id, 'fac-max-super-nagpur');
  assert.strictEqual(matchAlexis.id, 'fac-max-super-nagpur');
  // Verify aliases list contains Alexis
  assert.ok(
    matchAlexis.aliases.some((a: string) => a.toLowerCase().includes('alexis')),
    'Expected Alexis in aliases list'
  );
});

test('1.4. Locality search "Mankapur" resolves to Max Super Speciality Hospital', async () => {
  const res = await fetch(`${baseUrl}/api/v1/hospitals/nearby?search=Mankapur`);
  assert.strictEqual(res.status, 200);
  const data = (await res.json()) as any;
  const match = data.hospitals.find((h: any) => h.id === 'fac-max-super-nagpur');
  assert.ok(match, 'Searching by locality "Mankapur" must return Max Super Speciality Hospital');
});

test('1.5. Case-insensitive and whitespace-normalized query handling', async () => {
  const messyQuery = encodeURIComponent('   mAx   sUpeR   ');
  const res = await fetch(`${baseUrl}/api/v1/hospitals/nearby?search=${messyQuery}`);
  assert.strictEqual(res.status, 200);
  const data = (await res.json()) as any;
  const match = data.hospitals.find((h: any) => h.id === 'fac-max-super-nagpur');
  assert.ok(match, 'Query with erratic spacing and casing must match normalized hospital');
});

test('1.6. Honest empty state for non-existent hospital query', async () => {
  const res = await fetch(`${baseUrl}/api/v1/hospitals/nearby?search=nonexistent_hospital_xyz_12345`);
  assert.strictEqual(res.status, 200);
  const data = (await res.json()) as any;
  assert.ok(Array.isArray(data.hospitals));
  assert.strictEqual(data.hospitals.length, 0, 'Non-existent hospital must return empty array without errors');
});

// =============================================================================
// Suite 2: Phase 3 - Public Doctor Directory Import, Provenance & Persistence
// =============================================================================

test('2.1. Max Super Speciality Hospital has 50 public doctors persisted with accurate metadata', async () => {
  const res = await fetch(`${baseUrl}/api/doctors?hospitalId=fac-max-super-nagpur`);
  assert.strictEqual(res.status, 200);
  const doctors = (await res.json()) as any[];
  assert.ok(Array.isArray(doctors), 'Expected array of doctors');
  assert.strictEqual(doctors.length, 50, 'Max Healthcare Nagpur directory must contain 50 public doctors');

  // Inspect first doctor to verify public provenance fields
  const doctor = doctors[0];
  assert.ok(doctor.id, 'Doctor must have an ID');
  assert.ok(doctor.name, 'Doctor must have a name');
  assert.ok(doctor.specialization, 'Doctor must have a specialization');
  assert.ok(doctor.designation, 'Doctor must have a professional designation');
  assert.strictEqual(doctor.hospitalId, 'fac-max-super-nagpur');
  assert.strictEqual(doctor.verificationStatus, 'PUBLIC_DIRECTORY_LISTED');
  assert.strictEqual(doctor.bookingEnabled, false, 'Public directory doctors must not have booking enabled by default');
  assert.ok(doctor.sourceUrl.includes('maxhealthcare.in'), 'Source URL must point to official Max Healthcare source');
  assert.ok(doctor.sourceRetrievedAt, 'Doctor must preserve retrieval timestamp');
  assert.ok(doctor.profileUrl, 'Doctor must have official public profile URL');
});

test('2.2. Public doctors contain specialized details (Neurosurgery, Cardiac, Oncology)', async () => {
  const res = await fetch(`${baseUrl}/api/doctors?hospitalId=fac-max-super-nagpur`);
  const doctors = (await res.json()) as any[];

  const neuroDoctor = doctors.find((d: any) => d.name.includes('Husain Bhati'));
  assert.ok(neuroDoctor, 'Expected Dr. Husain Bhati in directory');
  assert.match(neuroDoctor.specialization, /Neurosurgery/i);
  assert.ok(neuroDoctor.experienceYears >= 10, 'Experience years should be preserved');
  assert.ok(neuroDoctor.designation, 'Professional designation must be preserved');
});

test('2.3. Doctor search by doctor name returns accurate matching record', async () => {
  const res = await fetch(`${baseUrl}/api/doctors?hospitalId=fac-max-super-nagpur&search=Bhati`);
  assert.strictEqual(res.status, 200);
  const doctors = (await res.json()) as any[];
  assert.ok(doctors.length >= 1, 'Should find at least 1 doctor matching "Bhati"');
  assert.ok(doctors.some((d: any) => d.name.includes('Husain Bhati')));
});

test('2.4. Specialty filtering matches actual persisted records', async () => {
  const resNeuro = await fetch(`${baseUrl}/api/doctors?hospitalId=fac-max-super-nagpur&specialty=Neurosurgery`);
  assert.strictEqual(resNeuro.status, 200);
  const neuroDocs = (await resNeuro.json()) as any[];
  assert.ok(neuroDocs.length >= 1, 'Expected neurosurgeons at Max Nagpur');
  assert.ok(neuroDocs.every((d: any) => d.specialization.includes('Neurosurgery') || d.specialtiesList?.includes('Neurosurgery')));

  // Non-existent specialty returns empty array honestly
  const resNonExistent = await fetch(`${baseUrl}/api/doctors?hospitalId=fac-max-super-nagpur&specialty=AcrobaticMedicine`);
  assert.strictEqual(resNonExistent.status, 200);
  const emptyDocs = (await resNonExistent.json()) as any[];
  assert.strictEqual(emptyDocs.length, 0, 'Unmatched specialty must return empty array honestly');
});

// =============================================================================
// Suite 3: Idempotent Ingestion & Deduplication
// =============================================================================

test('3.1. Re-running ingestion pipeline is idempotent and does not create duplicate doctors or hospitals', async () => {
  // Check count before re-import
  const resBefore = await fetch(`${baseUrl}/api/doctors?hospitalId=fac-max-super-nagpur`);
  const countBefore = ((await resBefore.json()) as any[]).length;
  assert.strictEqual(countBefore, 50);

  // Execute pipeline ingestion via service
  const importResult = await doctorDirectoryPipeline.importDoctorsForHospital('fac-max-super-nagpur');
  assert.strictEqual(importResult.hospitalId, 'fac-max-super-nagpur');
  assert.strictEqual(importResult.totalSourced, 50);
  assert.strictEqual(importResult.status, 'SUCCESS');

  // Check count after re-import
  const resAfter = await fetch(`${baseUrl}/api/doctors?hospitalId=fac-max-super-nagpur`);
  const countAfter = ((await resAfter.json()) as any[]).length;
  assert.strictEqual(countAfter, 50, 'Re-running ingestion must not duplicate doctors');

  // Verify hospital is not duplicated in hospitals table
  const hospRes = await fetch(`${baseUrl}/api/v1/hospitals/nearby?search=Max`);
  const hospData = (await hospRes.json()) as any;
  const maxMatches = hospData.hospitals.filter((h: any) => h.id === 'fac-max-super-nagpur');
  assert.strictEqual(maxMatches.length, 1, 'Hospital record must remain singular and stable');
});

test('3.2. POST /api/doctors/directory/import admin endpoint requires authentication and imports idempotently', async () => {
  // Without token -> 401
  const unauthRes = await fetch(`${baseUrl}/api/doctors/directory/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hospitalId: 'fac-max-super-nagpur' }),
  });
  assert.strictEqual(unauthRes.status, 401, 'Unauthenticated import must return 401');

  // With patient token -> 403
  const patientRes = await fetch(`${baseUrl}/api/doctors/directory/import`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${patientToken}`,
    },
    body: JSON.stringify({ hospitalId: 'fac-max-super-nagpur' }),
  });
  assert.strictEqual(patientRes.status, 403, 'Non-admin user import must return 403');

  // With super-admin token -> 200
  const adminRes = await fetch(`${baseUrl}/api/doctors/directory/import`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${superAdminToken}`,
    },
    body: JSON.stringify({ hospitalId: 'fac-max-super-nagpur' }),
  });
  assert.strictEqual(adminRes.status, 200);
  const result = (await adminRes.json()) as any;
  assert.strictEqual(result.totalImported, 50);
});

// =============================================================================
// Suite 4: Phase 4 - Directory vs Booking Availability Guards
// =============================================================================

test('4.1. GET /api/doctors/:id/slots for public directory doctor returns 0 slots with honest unverified notice', async () => {
  const publicDocId = 'doc-max-dr-mohammad-husain-bhati';
  const res = await fetch(`${baseUrl}/api/doctors/${publicDocId}/slots?date=${getFutureDate(1)}`);
  assert.strictEqual(res.status, 200);
  const data = (await res.json()) as any;

  assert.strictEqual(data.unverified, true, 'Directory doctor slots must be flagged unverified');
  assert.strictEqual(data.bookingEnabled, false);
  assert.ok(Array.isArray(data.slots));
  assert.strictEqual(data.slots.length, 0, 'Must never generate synthetic slots for public directory doctors');
  assert.match(data.message, /not yet verified for this public directory listing/i);
});

test('4.2. Attempting to book an appointment with a public directory doctor is strictly rejected (HTTP 400)', async () => {
  const publicDocId = 'doc-max-dr-mohammad-husain-bhati';
  const res = await fetch(`${baseUrl}/api/appointments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${patientToken}`,
    },
    body: JSON.stringify({
      doctorId: publicDocId,
      date: getFutureDate(2),
      time: '10:00',
      symptoms: 'Migraine consultation',
    }),
  });

  assert.strictEqual(res.status, 400, 'Attempting to book a public directory doctor must be rejected with HTTP 400');
  const errorData = (await res.json()) as any;
  assert.strictEqual(errorData.error, 'BOOKING_NOT_SUPPORTED_FOR_DIRECTORY_LISTING');
  assert.match(errorData.message, /not verified for direct LifeLink online booking/i);
});

test('4.3. Verified partner doctor booking succeeds and generates legitimate sequential queue token', async () => {
  const res = await fetch(`${baseUrl}/api/appointments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${patientToken}`,
    },
    body: JSON.stringify({
      doctorId: verifiedDoctor.id,
      slotId: verifiedSlot.id,
      symptoms: 'Routine health checkup',
    }),
  });

  assert.strictEqual(res.status, 201, 'Verified partner appointment booking must succeed with 201');
  const body = (await res.json()) as any;
  const appointment = body.appointment;
  assert.ok(appointment && appointment.id, 'Appointment must have an ID');
  assert.ok(body.tokenNumber >= 1, 'Legitimate booking must receive positive queue number');
  assert.strictEqual(appointment.doctorId, verifiedDoctor.id);
  assert.strictEqual(appointment.hospitalId, verifiedHospital.id);
  assert.strictEqual(appointment.status, 'BOOKED');
});

// =============================================================================
// Suite 5: Phase 6 - Nagpur Multi-Hospital Expansion & Coverage Reporting
// =============================================================================

test('5.1. GET /api/doctors/directory/coverage reports transparent coverage across Nagpur hospitals', async () => {
  const res = await fetch(`${baseUrl}/api/doctors/directory/coverage`);
  assert.strictEqual(res.status, 200);
  const data = (await res.json()) as any;

  assert.ok(data.city === 'Nagpur');
  assert.ok(data.totalHospitalsConfigured >= 4);
  assert.ok(data.totalDoctorsImported >= 50);
  assert.ok(Array.isArray(data.coverage));

  // Check Max Nagpur coverage item
  const maxCoverage = data.coverage.find((c: any) => c.hospitalId === 'fac-max-super-nagpur');
  assert.ok(maxCoverage, 'Coverage must include Max Super Speciality Hospital Nagpur');
  assert.strictEqual(maxCoverage.doctorCount, 50);
  assert.strictEqual(maxCoverage.hasLiveDirectoryFeed, true);
  assert.strictEqual(maxCoverage.status, 'IMPORT_SUCCESS');

  // Check GMCH coverage item (reporting official manual source without automated feed)
  const gmchCoverage = data.coverage.find((c: any) => c.hospitalId === 'hosp-gmch-nagpur');
  assert.ok(gmchCoverage, 'Coverage must include GMCH Nagpur');
  assert.strictEqual(gmchCoverage.hasLiveDirectoryFeed, false);
});

// =============================================================================
// Suite 6: Database Restart Simulation & Persistence
// =============================================================================

test('6.1. Simulating service restart preserves all 50 public doctor directory records and aliases', async () => {
  // Wipe in-memory tables and re-seed (simulating database reboot)
  (prisma as any).clear();
  (prisma as any).seedDefaultDevData();

  // Search "max"
  const hospRes = await fetch(`${baseUrl}/api/v1/hospitals/nearby?search=max`);
  assert.strictEqual(hospRes.status, 200);
  const hospData = (await hospRes.json()) as any;
  const maxHosp = hospData.hospitals.find((h: any) => h.id === 'fac-max-super-nagpur');
  assert.ok(maxHosp, 'Max hospital must be restored upon reboot');

  // Search "Alexis"
  const alexisRes = await fetch(`${baseUrl}/api/v1/hospitals/nearby?search=Alexis`);
  const alexisData = (await alexisRes.json()) as any;
  const alexisHosp = alexisData.hospitals.find((h: any) => h.id === 'fac-max-super-nagpur');
  assert.ok(alexisHosp, 'Alexis alias must resolve to same hospital upon reboot');

  // Query doctors
  const docRes = await fetch(`${baseUrl}/api/doctors?hospitalId=fac-max-super-nagpur`);
  assert.strictEqual(docRes.status, 200);
  const doctors = (await docRes.json()) as any[];
  assert.strictEqual(doctors.length, 50, 'All 50 doctors must be restored upon reboot');
});

// =============================================================================
// Suite 7: Nagpur-Wide Multi-Hospital Discovery & District Expansion
// =============================================================================

test('7.1. Nagpur-wide search: Government & Medical College discovery ("AIIMS", "Kingsway", "Daga", "VNIT")', async () => {
  // 1. AIIMS
  const resAiims = await fetch(`${baseUrl}/api/v1/hospitals/nearby?search=AIIMS`);
  assert.strictEqual(resAiims.status, 200);
  const dataAiims = (await resAiims.json()) as any;
  const matchAiims = dataAiims.hospitals.find((h: any) => h.id === 'fac-aiims-nagpur');
  assert.ok(matchAiims, 'Should discover AIIMS Nagpur');
  assert.strictEqual(matchAiims.linkStatus, 'LINKED_PARTNER');

  // 2. Kingsway
  const resKingsway = await fetch(`${baseUrl}/api/v1/hospitals/nearby?search=Kingsway`);
  assert.strictEqual(resKingsway.status, 200);
  const dataKingsway = (await resKingsway.json()) as any;
  const matchKingsway = dataKingsway.hospitals.find((h: any) => h.id === 'fac-kingsway-hospitals-nagpur');
  assert.ok(matchKingsway, 'Should discover KIMS-Kingsway Hospitals');

  // 3. Daga Memorial Women's Hospital
  const resDaga = await fetch(`${baseUrl}/api/v1/hospitals/nearby?search=Daga`);
  assert.strictEqual(resDaga.status, 200);
  const dataDaga = (await resDaga.json()) as any;
  const matchDaga = dataDaga.hospitals.find((h: any) => h.id === 'fac-daga-hospital-nagpur');
  assert.ok(matchDaga, 'Should discover Daga Memorial Hospital');

  // 4. VNIT Health Centre
  const resVnit = await fetch(`${baseUrl}/api/v1/hospitals/nearby?search=VNIT`);
  assert.strictEqual(resVnit.status, 200);
  const dataVnit = (await resVnit.json()) as any;
  const matchVnit = dataVnit.hospitals.find((h: any) => h.id === 'fac-vnit-health-centre');
  assert.ok(matchVnit, 'Should discover VNIT Health Centre');
});

test('7.2. Nagpur District Rural Expansion: Sub-district hospitals ("Katol", "Ramtek", "Umred", "Kamptee")', async () => {
  // Query Katol Sub-District Hospital
  const resKatol = await fetch(`${baseUrl}/api/v1/hospitals/nearby?search=Katol`);
  assert.strictEqual(resKatol.status, 200);
  const dataKatol = (await resKatol.json()) as any;
  const matchKatol = dataKatol.hospitals.find((h: any) => h.id === 'fac-sdh-katol' || h.name.includes('Katol'));
  assert.ok(matchKatol, 'Should discover Katol Sub-District Hospital in Nagpur rural expansion');
  assert.strictEqual(matchKatol.coverageZone, 'NAGPUR_DISTRICT_RURAL');

  // Query Ramtek Sub-District Hospital
  const resRamtek = await fetch(`${baseUrl}/api/v1/hospitals/nearby?search=Ramtek`);
  assert.strictEqual(resRamtek.status, 200);
  const dataRamtek = (await resRamtek.json()) as any;
  const matchRamtek = dataRamtek.hospitals.find((h: any) => h.name.includes('Ramtek'));
  assert.ok(matchRamtek, 'Should discover Ramtek Hospital');
  assert.strictEqual(matchRamtek.coverageZone, 'NAGPUR_DISTRICT_RURAL');
});

test('7.3. Multi-Hospital Doctor Directories: Non-Max hospitals (AIIMS, GMCH, Mayo, Kingsway) return verified public profiles', async () => {
  // Query AIIMS doctors
  const resAiimsDocs = await fetch(`${baseUrl}/api/doctors?hospitalId=fac-aiims-nagpur`);
  assert.strictEqual(resAiimsDocs.status, 200);
  const aiimsDocs = (await resAiimsDocs.json()) as any[];
  assert.ok(aiimsDocs.length >= 1, 'Expected public doctors for AIIMS Nagpur');
  const pulmonologist = aiimsDocs.find((d: any) => d.specialization === 'Pulmonology');
  assert.ok(pulmonologist, 'Expected Pulmonology specialist at AIIMS');
  assert.ok(pulmonologist.sourceUrl.includes('aiimsnagpur.edu.in'));

  // Query Kingsway doctors
  const resKingswayDocs = await fetch(`${baseUrl}/api/doctors?hospitalId=fac-kingsway-hospitals-nagpur`);
  assert.strictEqual(resKingswayDocs.status, 200);
  const kingswayDocs = (await resKingswayDocs.json()) as any[];
  assert.ok(kingswayDocs.length >= 1, 'Expected public doctors for Kingsway Hospitals');
  assert.ok(kingswayDocs.some((d: any) => d.name.includes('Pramod Mundra') || d.name.includes('Prakash')));
});

test('7.4. Zone Filtering: Filtering by zone=NAGPUR_DISTRICT_RURAL returns properly segregated facilities', async () => {
  const resRural = await fetch(`${baseUrl}/api/v1/hospitals/nearby?zone=NAGPUR_DISTRICT_RURAL`);
  assert.strictEqual(resRural.status, 200);
  const dataRural = (await resRural.json()) as any;
  assert.ok(dataRural.hospitals.length >= 5, 'Expected rural district facilities');
  assert.ok(
    dataRural.hospitals.every((h: any) => h.coverageZone === 'NAGPUR_DISTRICT_RURAL'),
    'All returned facilities must belong to NAGPUR_DISTRICT_RURAL'
  );

  const resCity = await fetch(`${baseUrl}/api/v1/hospitals/nearby?zone=NAGPUR_CITY`);
  assert.strictEqual(resCity.status, 200);
  const dataCity = (await resCity.json()) as any;
  assert.ok(dataCity.hospitals.length >= 10, 'Expected city facilities');
  assert.ok(
    dataCity.hospitals.every((h: any) => h.coverageZone === 'NAGPUR_CITY'),
    'All returned facilities must belong to NAGPUR_CITY'
  );
});

test('7.5. Directory Dataset Deliverables: CSV and JSON deliverables exist, are non-empty, and contain required schema fields', async () => {
  const fs = require('fs');
  const path = require('path');

  const files = [
    '../../data/nagpur/hospitals.json',
    '../../data/nagpur/hospitals.csv',
    '../../data/nagpur/doctors.json',
    '../../data/nagpur/doctors.csv',
    '../../data/nagpur/contacts.csv',
    '../../data/nagpur/sources.csv',
    '../../data/nagpur/duplicates_and_conflicts.csv',
    '../../docs/NAGPUR_DIRECTORY_COVERAGE.md',
    '../../docs/NAGPUR_DIRECTORY_IMPORT_GUIDE.md',
  ];

  for (const relFile of files) {
    const fullPath = path.resolve(__dirname, relFile);
    assert.ok(fs.existsSync(fullPath), `Deliverable file must exist: ${relFile}`);
    const stat = fs.statSync(fullPath);
    assert.ok(stat.size > 200, `Deliverable file ${relFile} must not be empty (size: ${stat.size} bytes)`);
  }

  // Check hospitals.json count
  const hospitals = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../data/nagpur/hospitals.json'), 'utf8'));
  assert.ok(hospitals.length >= 50, `Expected at least 50 hospitals, got ${hospitals.length}`);

  // Check doctors.json count
  const doctors = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../data/nagpur/doctors.json'), 'utf8'));
  assert.ok(doctors.length >= 60, `Expected at least 60 doctors, got ${doctors.length}`);
});
