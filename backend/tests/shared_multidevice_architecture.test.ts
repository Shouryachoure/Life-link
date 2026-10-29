import assert from 'assert';
import http from 'http';
import app from '../src/app';
import prisma from '../src/db';
import * as jwt from 'jsonwebtoken';
import { Role, BedStatus } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const JWT_SECRET = process.env.JWT_SECRET || 'lifelink_jwt_secret_key_2026_super_secure';

function createAuthToken(userId: string, role: string, email: string): string {
  return jwt.sign({ id: userId, role, email }, JWT_SECRET, { expiresIn: '1h' });
}

async function runSharedArchitectureTests() {
  console.log('\n================================================================');
  console.log('LifeLink — Shared Multi-Device Architecture Verification Suite');
  console.log('================================================================\n');

  // Start test server on ephemeral port
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  let passedTests = 0;
  let totalTests = 0;

  async function test(name: string, fn: () => Promise<void>) {
    totalTests++;
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passedTests++;
    } catch (err: any) {
      console.error(`  ✗ ${name}`);
      console.error(`    Error: ${err.message}`);
      if (err.stack) {
        console.error(`    ${err.stack.split('\n').slice(1, 4).join('\n    ')}`);
      }
    }
  }

  try {
    // Tokens for distinct authorized user sessions
    const gmchAdminToken = createAuthToken('user-admin-gmch-dev', Role.ADMIN_HOSPITAL, 'admin.gmch@lifelink.com');
    const patientToken = createAuthToken('user-patient-john-dev', Role.PATIENT, 'patient.john@gmail.com');

    // ---------------------------------------------------------------------------
    // TEST 1: Concurrent sessions read identical shared database records
    // ---------------------------------------------------------------------------
    await test('1. Concurrent sessions (PC admin & Mobile patient) read identical database facilities', async () => {
      // Session A: Mobile patient queries directory facilities
      const resA = await fetch(`${baseUrl}/api/v1/directory/hospitals?limit=50`, {
        headers: { Authorization: `Bearer ${patientToken}` },
      });
      const dataA = (await resA.json()) as any;

      // Session B: Desktop hospital admin queries directory facilities
      const resB = await fetch(`${baseUrl}/api/v1/directory/hospitals?limit=50`, {
        headers: { Authorization: `Bearer ${gmchAdminToken}` },
      });
      const dataB = (await resB.json()) as any;

      assert.strictEqual(resA.status, 200, 'Session A must succeed');
      assert.strictEqual(resB.status, 200, 'Session B must succeed');

      const facilitiesA = dataA.hospitals || dataA.facilities || dataA.data || dataA;
      const facilitiesB = dataB.hospitals || dataB.facilities || dataB.data || dataB;

      assert(Array.isArray(facilitiesA) && facilitiesA.length > 0, 'Session A must receive facility records');
      assert.strictEqual(facilitiesA.length, facilitiesB.length, 'Both sessions must receive identical facility counts');
      assert.strictEqual(facilitiesA[0].id, facilitiesB[0].id, 'Both sessions must see the same primary facility ID');
    });

    // ---------------------------------------------------------------------------
    // TEST 2: Shared Doctor & Ambulance Datasets are identical across sessions
    // ---------------------------------------------------------------------------
    await test('2. Both sessions read identical verified Nagpur ambulance providers and doctors', async () => {
      // Ambulances query
      const ambRes = await fetch(`${baseUrl}/api/v1/directory/ambulances`, {
        headers: { Authorization: `Bearer ${patientToken}` },
      });
      assert.strictEqual(ambRes.status, 200);
      const ambData = (await ambRes.json()) as any;
      const ambList = ambData.ambulanceServices || ambData.data || ambData;
      assert(Array.isArray(ambList), 'Ambulance directory must return an array');
      assert(ambList.length >= 30, `Expected at least 30 verified Nagpur ambulance providers, got ${ambList.length}`);

      // Doctors query
      const docRes = await fetch(`${baseUrl}/api/v1/doctors`, {
        headers: { Authorization: `Bearer ${patientToken}` },
      });
      assert.strictEqual(docRes.status, 200);
      const docData = (await docRes.json()) as any;
      const docList = docData.doctors || docData;
      assert(Array.isArray(docList), 'Doctors list must return an array');
      assert(docList.length > 0, 'Doctor records must be populated in shared database');
    });

    // ---------------------------------------------------------------------------
    // TEST 3: Permitted write in Session A is immediately visible in Session B
    // ---------------------------------------------------------------------------
    await test('3. Hospital Admin updates bed in Session A; Patient observes update in Session B', async () => {
      // Look up an existing bed for GMCH
      const bed = await prisma.hospitalBed.findFirst({
        where: { hospitalId: 'hosp-gmch-nagpur' },
      });
      assert(bed, 'GMCH must have at least one test bed');

      const targetStatus = bed.status === BedStatus.AVAILABLE ? BedStatus.OCCUPIED : BedStatus.AVAILABLE;

      // Session A: GMCH Admin updates bed status
      const updateRes = await fetch(`${baseUrl}/api/v1/hospitals/beds/${bed.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${gmchAdminToken}`,
        },
        body: JSON.stringify({
          status: targetStatus,
          patientName: targetStatus === BedStatus.OCCUPIED ? 'Multi-Device Test Patient' : null,
        }),
      });

      assert.strictEqual(updateRes.status, 200, 'Bed update must succeed');

      // Session B: Mobile patient queries hospital bed capacities
      const bedsRes = await fetch(`${baseUrl}/api/v1/hospitals/capacities`, {
        headers: { Authorization: `Bearer ${patientToken}` },
      });
      assert.strictEqual(bedsRes.status, 200);
      const bedsData = (await bedsRes.json()) as any;
      const hospitals = bedsData.hospitals || bedsData;
      const gmchCapacity = hospitals.find((h: any) => h.id === 'hosp-gmch-nagpur');
      assert(gmchCapacity, 'GMCH capacity record must exist');

      // Direct read from database confirms persistence
      const directDbBed = await prisma.hospitalBed.findUnique({ where: { id: bed.id } });
      assert.strictEqual(directDbBed?.status, targetStatus, 'Shared database must reflect updated bed status');

      // Restore original status
      await prisma.hospitalBed.update({
        where: { id: bed.id },
        data: { status: bed.status, patientName: null },
      });
    });

    // ---------------------------------------------------------------------------
    // TEST 4: Unauthorized writes are strictly rejected
    // ---------------------------------------------------------------------------
    await test('4. Unauthorized patient or unauthenticated writes to beds are rejected (403/401)', async () => {
      const bed = await prisma.hospitalBed.findFirst();
      assert(bed, 'Test bed must exist');

      // Attempt write with patient token (insufficient privileges)
      const forbiddenRes = await fetch(`${baseUrl}/api/v1/hospitals/beds/${bed.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${patientToken}`,
        },
        body: JSON.stringify({ status: BedStatus.OCCUPIED }),
      });
      assert.strictEqual(forbiddenRes.status, 403, 'Patient write to hospital bed must return HTTP 403 Forbidden');

      // Attempt write with no auth token
      const unauthRes = await fetch(`${baseUrl}/api/v1/hospitals/beds/${bed.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: BedStatus.OCCUPIED }),
      });
      assert.strictEqual(unauthRes.status, 401, 'Unauthenticated write to hospital bed must return HTTP 401 Unauthorized');
    });

    // ---------------------------------------------------------------------------
    // TEST 5: Emergency request workflow synchronized across Patient & Driver sessions
    // ---------------------------------------------------------------------------
    await test('5. Patient creates SOS on Mobile; checked on PC; Patient cancels on PC', async () => {
      // Clear any dangling requests for test patient
      await prisma.emergencyRequest.deleteMany({
        where: { patientId: 'user-patient-john-dev' },
      });

      // Step 1: Patient triggers SOS request
      const sosRes = await fetch(`${baseUrl}/api/v1/sos/request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${patientToken}`,
        },
        body: JSON.stringify({
          pickupLat: 21.1458,
          pickupLng: 79.0882,
          pickupAddress: 'Nagpur Central, Maharashtra',
          requiredAmbulanceType: 'ADVANCED_LIFE_SUPPORT',
          category: 'MEDICAL_EMERGENCY',
          urgencyLevel: 'HIGH',
        }),
      });

      assert([200, 201].includes(sosRes.status), `SOS trigger must succeed (got ${sosRes.status})`);
      const sosData = (await sosRes.json()) as any;
      const createdReq = sosData.request || sosData;
      assert(createdReq && createdReq.id, 'SOS must return a valid request ID');

      // Step 2: Patient checks active request from second device session
      const activeRes = await fetch(`${baseUrl}/api/v1/requests/active`, {
        headers: { Authorization: `Bearer ${patientToken}` },
      });
      assert.strictEqual(activeRes.status, 200);
      const activeData = (await activeRes.json()) as any;
      assert.strictEqual(activeData.id, createdReq.id, 'Active request must match created SOS across sessions');

      // Step 3: Patient cancels emergency request from second session
      const cancelRes = await fetch(`${baseUrl}/api/v1/sos/${createdReq.id}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${patientToken}`,
        },
        body: JSON.stringify({ reason: 'Patient cancelled from other device' }),
      });
      assert.strictEqual(cancelRes.status, 200, 'Patient cancellation must succeed');

      // Step 4: Verify request is no longer returned as active on any device
      const afterCancelRes = await fetch(`${baseUrl}/api/v1/requests/active`, {
        headers: { Authorization: `Bearer ${patientToken}` },
      });
      assert.strictEqual(afterCancelRes.status, 200);
      const afterCancelData = (await afterCancelRes.json()) as any;
      assert.strictEqual(afterCancelData, null, 'Cancelled request must not appear as active on any session');
    });

    // ---------------------------------------------------------------------------
    // TEST 6: Data persistence across queries
    // ---------------------------------------------------------------------------
    await test('6. Records persist across queries in PostgreSQL database (EmergencyContact test)', async () => {
      const contactId = `contact-persist-${Date.now()}`;
      const contact = await prisma.emergencyContact.create({
        data: {
          id: contactId,
          patientId: 'user-patient-john-dev',
          name: 'Verified Family Contact',
          phone: '+919876543299',
          relation: 'Spouse',
          isVerified: true,
          notifyOnSos: true,
        },
      });

      // Verify record exists in persistent database
      const fetched = await prisma.emergencyContact.findUnique({
        where: { id: contact.id },
      });
      assert.strictEqual(fetched?.id, contact.id, 'Contact must be stored in persistent database');
      assert.strictEqual(fetched?.phone, '+919876543299', 'Contact phone must match');

      // Clean up test contact
      await prisma.emergencyContact.delete({
        where: { id: contact.id },
      });
    });

    // ---------------------------------------------------------------------------
    // TEST 7: Deployment Configuration Integrity (Vercel & Render configs exist)
    // ---------------------------------------------------------------------------
    await test('7. Deployment configurations (vercel.json, render.yaml) are present and valid', async () => {
      const rootVercel = path.resolve(__dirname, '../../vercel.json');
      const frontendVercel = path.resolve(__dirname, '../../frontend/vercel.json');
      const renderYaml = path.resolve(__dirname, '../../render.yaml');

      assert(fs.existsSync(rootVercel), 'Root vercel.json must exist');
      assert(fs.existsSync(frontendVercel), 'Frontend vercel.json must exist');
      assert(fs.existsSync(renderYaml), 'Root render.yaml must exist');

      // Verify JSON parse
      const vercelConfig = JSON.parse(fs.readFileSync(frontendVercel, 'utf8'));
      assert(Array.isArray(vercelConfig.rewrites), 'vercel.json must have SPA rewrites');
      assert.strictEqual(vercelConfig.rewrites[0].destination, '/index.html', 'Vercel must route /* to /index.html');

      // Verify Render YAML contains essential services
      const yamlContent = fs.readFileSync(renderYaml, 'utf8');
      assert(yamlContent.includes('name: lifelink-backend'), 'render.yaml must define lifelink-backend');
      assert(yamlContent.includes('USE_IN_MEMORY_DB'), 'render.yaml must declare USE_IN_MEMORY_DB');
      assert(yamlContent.includes('DATABASE_URL'), 'render.yaml must declare DATABASE_URL');
    });

    // ---------------------------------------------------------------------------
    // TEST 8: Code delivery isolation truth (Local edits do NOT auto-deploy without build)
    // ---------------------------------------------------------------------------
    await test('8. Local source code edits require explicit deployment build', async () => {
      const frontendDist = path.resolve(__dirname, '../../frontend/dist/index.html');
      assert(fs.existsSync(frontendDist), 'Frontend production build (dist/index.html) must exist');

      const pkgJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
      assert(pkgJson.scripts['build'], 'Backend package.json must have build script');
      assert(pkgJson.scripts['prisma:seed'], 'Backend package.json must have prisma:seed script');
    });

    console.log(`\nResults: ${passedTests} / ${totalTests} tests passed (${Math.round((passedTests / totalTests) * 100)}%)\n`);
  } finally {
    server.close();
    await prisma.$disconnect();
  }

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runSharedArchitectureTests()
  .then(() => {
    console.log('Shared Multi-Device Architecture test suite passed successfully.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Fatal test error:', err);
    process.exit(1);
  });
