process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_secret_for_nagpur_doctor_dataset_pipeline_2026_super_secure';
process.env.TEST_DB_CONNECTED = 'true';

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import app from '../src/app';
import prisma from '../src/db';
import { generateTokens } from '../src/services/tokenService';
import { Role } from '@prisma/client';
import { doctorDirectoryPipeline } from '../src/services/doctorDirectoryPipelineService';

let server: http.Server;
let port: number;
let baseUrl: string;

let superAdminToken: string;
let superAdminUser: any;
let patientToken: string;
let patientUser: any;

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

  // Create Super Admin user & token
  superAdminUser = await prisma.user.create({
    data: {
      email: `superadmin.nagpurdocs.${Date.now()}@lifelink.org.in`,
      passwordHash: 'hash',
      name: 'Dr. SuperAdmin Data Architect',
      role: Role.SUPER_ADMIN,
    },
  });
  superAdminToken = generateTokens({
    id: superAdminUser.id,
    email: superAdminUser.email,
    role: superAdminUser.role,
    name: superAdminUser.name,
  }).accessToken;

  // Create Patient user & token
  patientUser = await prisma.user.create({
    data: {
      email: `patient.nagpurdocs.${Date.now()}@lifelink.org.in`,
      passwordHash: 'hash',
      name: 'Nagpur Resident Patient',
      role: Role.PATIENT,
    },
  });
  patientToken = generateTokens({
    id: patientUser.id,
    email: patientUser.email,
    role: patientUser.role,
    name: patientUser.name,
  }).accessToken;
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('1. Dataset Deliverables: doctors.json and doctors.csv exist, are valid, and contain 152 verified doctors', async () => {
  const jsonPath = path.resolve(__dirname, '../../data/nagpur/doctors.json');
  const csvPath = path.resolve(__dirname, '../../data/nagpur/doctors.csv');

  assert.ok(fs.existsSync(jsonPath), 'data/nagpur/doctors.json must exist');
  assert.ok(fs.existsSync(csvPath), 'data/nagpur/doctors.csv must exist');

  const rawJson = fs.readFileSync(jsonPath, 'utf8');
  const docs = JSON.parse(rawJson);
  assert.strictEqual(docs.length, 152, 'Dataset must contain exactly 152 verified doctors');

  const rawCsv = fs.readFileSync(csvPath, 'utf8');
  const csvLines = rawCsv.trim().split('\n');
  assert.strictEqual(csvLines.length, 153, 'CSV must have 1 header line + 152 doctor rows');
  assert.ok(csvLines[0].includes('registrationNumber'), 'CSV header must include registrationNumber');
  assert.ok(csvLines[0].includes('registrationAuthority'), 'CSV header must include registrationAuthority');

  // Verify uniqueness of doctor IDs
  const idSet = new Set<string>();
  for (const d of docs) {
    assert.ok(d.id, 'Doctor record must have an ID');
    assert.ok(!idSet.has(d.id), `Duplicate doctor ID found: ${d.id}`);
    idSet.add(d.id);
    assert.ok(d.name, `Doctor ${d.id} must have a name`);
    assert.ok(d.specialization, `Doctor ${d.id} must have a specialization`);
    assert.ok(d.hospitalId, `Doctor ${d.id} must have a hospitalId`);
    assert.ok(d.sourceUrl, `Doctor ${d.id} must have a sourceUrl`);
    assert.ok(d.sourceRetrievedAt, `Doctor ${d.id} must have sourceRetrievedAt`);
    assert.ok(d.registrationNumber, `Doctor ${d.id} must have registrationNumber`);
  }
});

test('2. Ingestion Pipeline: Dry-run mode calculates projections without committing writes', async () => {
  const report = await doctorDirectoryPipeline.importDoctorsForHospital('fac-max-super-nagpur', { dryRun: true });
  assert.strictEqual(report.status, 'SUCCESS');
  assert.strictEqual(report.dryRun, true);
  assert.ok(report.totalSourced >= 50, 'Max Healthcare adapter should source 50 doctors');
});

test('3. Ingestion Pipeline: Batch import across all 24 registered adapters is idempotent', async () => {
  const reports = await doctorDirectoryPipeline.importAllNagpurDoctors({ dryRun: false });
  assert.ok(reports.length >= 24, 'Pipeline must register all 24 Nagpur facility adapters');
  const totalSourced = reports.reduce((acc, r) => acc + r.totalSourced, 0);
  assert.ok(totalSourced >= 150, `Total sourced across adapters (${totalSourced}) must cover dataset`);

  // Run second time to verify idempotency
  const secondReports = await doctorDirectoryPipeline.importAllNagpurDoctors({ dryRun: false });
  const newlyImported = secondReports.reduce((acc, r) => acc + r.imported, 0);
  assert.strictEqual(newlyImported, 0, 'Second run must import 0 new doctors (100% idempotent updates)');
});

test('4. Multi-Hospital Affiliations: Dr. Avinash Sharma is affiliated with NewEra (Primary) and Seven Star (Visiting)', async () => {
  const doc = await prisma.doctor.findUnique({
    where: { id: 'doc-newera-dr-avinash-sharma' },
    include: { affiliations: true },
  });

  assert.ok(doc, 'Dr. Avinash Sharma must exist in database');
  assert.strictEqual(doc.hospitalId, 'fac-newera-hospital-nagpur');
  assert.strictEqual(doc.registrationNumber, 'MMC/2007/05/02140');
  assert.strictEqual(doc.registrationAuthority, 'Maharashtra Medical Council');

  // Verify affiliations in hospitalDoctor table
  const affiliations = await prisma.hospitalDoctor.findMany({
    where: { doctorId: 'doc-newera-dr-avinash-sharma' },
  });

  assert.ok(affiliations.length >= 2, 'Dr. Avinash Sharma must have at least 2 hospital affiliations');
  const primaryAff = affiliations.find((a: any) => a.hospitalId === 'fac-newera-hospital-nagpur');
  const visitingAff = affiliations.find((a: any) => a.hospitalId === 'fac-seven-star-nagpur');

  assert.ok(primaryAff, 'Must have primary affiliation with NewEra');
  assert.ok(visitingAff, 'Must have visiting affiliation with Seven Star');
  assert.strictEqual(visitingAff.affiliationStatus, 'VISITING_CONSULTANT');
});

test('5. Multi-Hospital Affiliations: Dr. Ketan Chaturvedi is affiliated with Max (Primary) and Kingsway (Visiting)', async () => {
  const affiliations = await prisma.hospitalDoctor.findMany({
    where: { doctorId: 'doc-max-dr-ketan-chaturvedi' },
  });

  assert.ok(affiliations.length >= 2, 'Dr. Ketan Chaturvedi must have at least 2 hospital affiliations');
  const primaryAff = affiliations.find((a: any) => a.hospitalId === 'fac-max-super-nagpur');
  const visitingAff = affiliations.find((a: any) => a.hospitalId === 'fac-kingsway-hospitals-nagpur');

  assert.ok(primaryAff, 'Must have primary affiliation with Max Super Speciality');
  assert.ok(visitingAff, 'Must have visiting affiliation with Kingsway');
  assert.strictEqual(visitingAff.affiliationStatus, 'VISITING_CONSULTANT');
});

test('6. GET /api/hospitals/:hospitalId/doctors: Returns affiliated doctors with structured metadata and specialties list', async () => {
  const res = await fetch(`${baseUrl}/api/hospitals/fac-kingsway-hospitals-nagpur/doctors`);
  assert.strictEqual(res.status, 200);

  const data = (await res.json()) as any;
  assert.strictEqual(data.success, true);
  assert.ok(data.hospital, 'Must include hospital metadata');
  assert.strictEqual(data.hospital.id, 'fac-kingsway-hospitals-nagpur');
  assert.ok(data.total >= 6, `Kingsway must have at least 6 affiliated doctors (got ${data.total})`);
  assert.ok(Array.isArray(data.specialties), 'Must return array of specialties');
  assert.ok(data.specialties.length > 0, 'Specialties list must not be empty');

  // Verify Dr. Ketan Chaturvedi appears in Kingsway doctors as a Visiting Consultant
  const chaturvedi = data.doctors.find((d: any) => d.id === 'doc-max-dr-ketan-chaturvedi');
  assert.ok(chaturvedi, 'Kingsway doctor roster must include visiting specialist Dr. Ketan Chaturvedi');
  assert.strictEqual(chaturvedi.affiliation.status, 'VISITING_CONSULTANT');
  assert.ok(chaturvedi.registrationNumber, 'Doctor must have MMC registration number');
});

test('7. GET /api/hospitals/:hospitalId/doctors: Filtering by specialization works accurately', async () => {
  const res = await fetch(`${baseUrl}/api/hospitals/fac-max-super-nagpur/doctors?specialization=Neurosurgery`);
  assert.strictEqual(res.status, 200);

  const data = (await res.json()) as any;
  assert.strictEqual(data.success, true);
  assert.ok(data.total > 0, 'Max Healthcare must have neurosurgeons');
  for (const doc of data.doctors) {
    const matchesSpec = doc.specialization.toLowerCase().includes('neuro');
    const matchesList = Array.isArray(doc.specialtiesList) && doc.specialtiesList.some((s: string) => s.toLowerCase().includes('neuro'));
    assert.ok(matchesSpec || matchesList, `Doctor ${doc.name} should match Neurosurgery specialization`);
  }
});

test('8. GET /api/hospitals/:hospitalId/doctors: Search by name and registration number', async () => {
  // Search by name
  const resName = await fetch(`${baseUrl}/api/hospitals/fac-newera-hospital-nagpur/doctors?search=Avinash`);
  assert.strictEqual(resName.status, 200);
  const dataName = (await resName.json()) as any;
  assert.strictEqual(dataName.total, 1);
  assert.strictEqual(dataName.doctors[0].id, 'doc-newera-dr-avinash-sharma');

  // Search by registration number
  const resReg = await fetch(`${baseUrl}/api/hospitals/fac-newera-hospital-nagpur/doctors?search=MMC/2007/05/02140`);
  assert.strictEqual(resReg.status, 200);
  const dataReg = (await resReg.json()) as any;
  assert.strictEqual(dataReg.total, 1);
  assert.strictEqual(dataReg.doctors[0].name, 'Dr. Avinash Sharma');
});

test('9. GET /api/hospitals/:hospitalId/doctors: Pagination works properly', async () => {
  const resPage1 = await fetch(`${baseUrl}/api/hospitals/fac-max-super-nagpur/doctors?page=1&limit=10`);
  assert.strictEqual(resPage1.status, 200);
  const dataPage1 = (await resPage1.json()) as any;

  assert.strictEqual(dataPage1.page, 1);
  assert.strictEqual(dataPage1.limit, 10);
  assert.strictEqual(dataPage1.doctors.length, 10);
  assert.ok(dataPage1.totalPages >= 5, 'Total pages must reflect 50 doctors / 10 per page = 5');

  const resPage2 = await fetch(`${baseUrl}/api/hospitals/fac-max-super-nagpur/doctors?page=2&limit=10`);
  const dataPage2 = (await resPage2.json()) as any;
  assert.strictEqual(dataPage2.page, 2);
  assert.strictEqual(dataPage2.doctors.length, 10);

  // Doctors on page 1 and page 2 must be distinct
  const page1Ids = new Set(dataPage1.doctors.map((d: any) => d.id));
  const page2Ids = new Set(dataPage2.doctors.map((d: any) => d.id));
  for (const id of page2Ids) {
    assert.ok(!page1Ids.has(id), `Page 2 doctor ${id} should not appear on page 1`);
  }
});

test('10. GET /api/hospitals/:hospitalId/doctors: Truthful empty state when facility has no indexed doctors', async () => {
  // Use a rural sub-centre or clinic without doctor roster
  const res = await fetch(`${baseUrl}/api/hospitals/fac-nonexistent-subcentre-nagpur/doctors`);
  assert.strictEqual(res.status, 404);

  // Create temporary facility with 0 doctors
  const emptyFacility = await prisma.directoryFacility.create({
    data: {
      id: 'fac-empty-test-health-post',
      name: 'Nagpur Municipal Corporation Urban Health Post Sadar',
      facilityType: 'PRIMARY_HEALTH_CENTRE',
      ownership: 'MUNICIPAL',
      address: 'Sadar, Nagpur',
      contactNumber: '07122550000',
      sourceUrl: 'https://nagpur.gov.in/public-utility-category/hospitals/',
    },
  });

  const resEmpty = await fetch(`${baseUrl}/api/hospitals/${emptyFacility.id}/doctors`);
  assert.strictEqual(resEmpty.status, 200);
  const dataEmpty = (await resEmpty.json()) as any;

  assert.strictEqual(dataEmpty.success, true);
  assert.strictEqual(dataEmpty.total, 0);
  assert.strictEqual(dataEmpty.doctors.length, 0);
  assert.strictEqual(dataEmpty.specialties.length, 0);
  assert.ok(dataEmpty.message.includes('No public doctor records are currently indexed'));
});

test('11. Alias Resolution: fac-gmch-nagpur and hosp-gmch-nagpur resolve to the same affiliated doctors', async () => {
  const resFac = await fetch(`${baseUrl}/api/hospitals/fac-gmch-nagpur/doctors`);
  const resHosp = await fetch(`${baseUrl}/api/hospitals/hosp-gmch-nagpur/doctors`);

  assert.strictEqual(resFac.status, 200);
  assert.strictEqual(resHosp.status, 200);

  const dataFac = (await resFac.json()) as any;
  const dataHosp = (await resHosp.json()) as any;

  assert.strictEqual(dataFac.total, dataHosp.total, 'Both aliases must return the exact same count of doctors');
  assert.ok(dataFac.total >= 18, 'GMCH must have at least 18 doctors');
});

test('12. Directory Route: GET /api/directory/hospitals/:id/doctors returns matching structured response', async () => {
  const res = await fetch(`${baseUrl}/api/directory/hospitals/fac-aiims-nagpur/doctors`);
  assert.strictEqual(res.status, 200);

  const data = (await res.json()) as any;
  assert.strictEqual(data.success, true);
  assert.strictEqual(data.hospital.id, 'fac-aiims-nagpur');
  assert.ok(data.total >= 20, 'AIIMS Nagpur must have 20 affiliated doctors');
  assert.ok(data.specialties.includes('Pulmonology'));
  assert.ok(data.specialties.includes('Endocrinology'));
});

test('13. Admin Endpoint: POST /api/doctors/directory/import supports dry-run parameter', async () => {
  const res = await fetch(`${baseUrl}/api/doctors/directory/import`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${superAdminToken}`,
    },
    body: JSON.stringify({
      hospitalId: 'fac-care-hospitals-nagpur',
      dryRun: true,
    }),
  });

  assert.strictEqual(res.status, 200);
  const data = (await res.json()) as any;
  assert.strictEqual(data.success, true);
  assert.strictEqual(data.dryRun, true);
  assert.strictEqual(data.report.dryRun, true);
  assert.ok(data.report.totalSourced >= 5);
});
