import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import app from '../src/app';
import prisma from '../src/db';
import { generateTokens } from '../src/services/tokenService';
import { Role, DataProvenance, EmergencyAccessType } from '@prisma/client';

let server: http.Server;
let port: number;
let baseUrl: string;

let patientAUser: any;
let patientAToken: string;

let patientBUser: any;
let patientBToken: string;

let patientCUser: any; // Patient without profile
let patientCToken: string;

let driverAUser: any;
let driverAToken: string;

let driverBUser: any; // Unassigned driver
let driverBToken: string;

let hospitalAdminUser: any;
let hospitalAdminToken: string;
let hospitalEntity: any;

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test_secret_for_emergency_health_profile_2026_super_secure';
  process.env.TEST_DB_CONNECTED = 'true';

  server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      port = (server.address() as any).port;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });

  // Seed Hospital
  hospitalAdminUser = await prisma.user.create({
    data: {
      email: `admin.aiims.${Date.now()}@lifelink.org.in`,
      passwordHash: 'hash',
      name: 'Dr. Priya Deshmukh (ER Chief)',
      role: Role.ADMIN_HOSPITAL,
    },
  });
  hospitalAdminToken = generateTokens({
    id: hospitalAdminUser.id,
    email: hospitalAdminUser.email,
    role: hospitalAdminUser.role,
    name: hospitalAdminUser.name,
  }).accessToken;

  hospitalEntity = await prisma.hospital.create({
    data: {
      name: 'AIIMS Nagpur Super Specialty',
      address: 'MIHAN, Nagpur, Maharashtra',
      contactNumber: '+917122500001',
      lat: 21.0543,
      lng: 79.0253,
      adminUserId: hospitalAdminUser.id,
      availableBeds: 50,
      totalBeds: 100,
    },
  });

  await prisma.user.update({
    where: { id: hospitalAdminUser.id },
    data: { hospitalId: hospitalEntity.id },
  });
  hospitalAdminUser.hospitalId = hospitalEntity.id;
  hospitalAdminToken = generateTokens({
    id: hospitalAdminUser.id,
    email: hospitalAdminUser.email,
    role: hospitalAdminUser.role,
    name: hospitalAdminUser.name,
    hospitalId: hospitalEntity.id,
  }).accessToken;

  // Seed Patient A
  patientAUser = await prisma.user.create({
    data: {
      email: `patient.rahul.${Date.now()}@lifelink.org.in`,
      passwordHash: 'hash',
      name: 'Rahul Sharma',
      phone: '+919876543210',
      role: Role.PATIENT,
    },
  });
  patientAToken = generateTokens({
    id: patientAUser.id,
    email: patientAUser.email,
    role: patientAUser.role,
    name: patientAUser.name,
  }).accessToken;

  // Add Emergency Contacts for Patient A
  await prisma.emergencyContact.create({
    data: {
      patientId: patientAUser.id,
      name: 'Sunita Sharma',
      phone: '+919876500001',
      relation: 'Mother',
    },
  });

  // Seed Patient B
  patientBUser = await prisma.user.create({
    data: {
      email: `patient.anita.${Date.now()}@lifelink.org.in`,
      passwordHash: 'hash',
      name: 'Anita Verma',
      phone: '+919876543211',
      role: Role.PATIENT,
    },
  });
  patientBToken = generateTokens({
    id: patientBUser.id,
    email: patientBUser.email,
    role: patientBUser.role,
    name: patientBUser.name,
  }).accessToken;

  // Seed Patient C (Never fills a medical profile)
  patientCUser = await prisma.user.create({
    data: {
      email: `patient.unregistered.${Date.now()}@lifelink.org.in`,
      passwordHash: 'hash',
      name: 'Deepak Patel',
      phone: '+919876543212',
      role: Role.PATIENT,
    },
  });
  patientCToken = generateTokens({
    id: patientCUser.id,
    email: patientCUser.email,
    role: patientCUser.role,
    name: patientCUser.name,
  }).accessToken;

  // Seed Driver A (Assigned Paramedic)
  driverAUser = await prisma.user.create({
    data: {
      email: `driver.paramedic.a.${Date.now()}@lifelink.org.in`,
      passwordHash: 'hash',
      name: 'Vikram Singh (Paramedic A)',
      phone: '+919876500002',
      role: Role.DRIVER,
    },
  });
  driverAToken = generateTokens({
    id: driverAUser.id,
    email: driverAUser.email,
    role: driverAUser.role,
    name: driverAUser.name,
  }).accessToken;

  // Seed Driver B (Unassigned Paramedic)
  driverBUser = await prisma.user.create({
    data: {
      email: `driver.paramedic.b.${Date.now()}@lifelink.org.in`,
      passwordHash: 'hash',
      name: 'Rajesh Patil (Paramedic B)',
      phone: '+919876500003',
      role: Role.DRIVER,
    },
  });
  driverBToken = generateTokens({
    id: driverBUser.id,
    email: driverBUser.email,
    role: driverBUser.role,
    name: driverBUser.name,
  }).accessToken;
});

after(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

test('1. Patient voluntarily manages emergency information with explicit PATIENT_REPORTED provenance', async () => {
  const payload = {
    bloodGroup: 'B+',
    allergies: 'Severe Penicillin, Peanuts',
    medicalConditions: 'Asthma, Type-2 Diabetes',
    currentMedications: 'Salbutamol Inhaler, Metformin 500mg BD',
    organDonorStatus: 'YES',
    preferredHospital: 'AIIMS Nagpur Super Specialty',
    medicalNotes: 'Carries EpiPen in backpack pocket',
    consentEmergencySharing: true,
  };

  const res = await fetch(`${baseUrl}/api/v1/emergency-profile`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${patientAToken}`,
    },
    body: JSON.stringify(payload),
  });

  assert.equal(res.status, 200);
  const data = (await res.json()) as any;
  assert.equal(data.profile.bloodGroup, 'B+');
  assert.equal(data.profile.bloodGroupProvenance, 'PATIENT_REPORTED');
  assert.equal(data.profile.allergies, 'Severe Penicillin, Peanuts');
  assert.equal(data.profile.allergiesProvenance, 'PATIENT_REPORTED');
  assert.equal(data.profile.medicalConditionsProvenance, 'PATIENT_REPORTED');
  assert.equal(data.profile.medicationsProvenance, 'PATIENT_REPORTED');
  assert.equal(data.profile.organDonorStatus, 'YES');
  assert.equal(data.profile.consentEmergencySharing, true);
  assert.ok(data.profile.emergencyAccessToken, 'Should generate an emergency access token');
  assert.ok(data.dpdpNotice.includes('DPDP'), 'Should include DPDP statutory notice');
});

test('2. Missing or unverified blood group is marked UNKNOWN and never assumed medically confirmed', async () => {
  const payload = {
    bloodGroup: 'UNKNOWN',
    allergies: 'None known',
  };

  const res = await fetch(`${baseUrl}/api/v1/emergency-profile`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${patientBToken}`,
    },
    body: JSON.stringify(payload),
  });

  assert.equal(res.status, 200);
  const data = (await res.json()) as any;
  assert.equal(data.profile.bloodGroup, 'UNKNOWN');
  assert.equal(data.profile.bloodGroupProvenance, 'UNKNOWN');
  assert.notEqual(data.profile.bloodGroup, 'O+', 'Should never automatically force O+ on unknown patient');
});

test('3. Patient views own emergency health profile with audit logging', async () => {
  const res = await fetch(`${baseUrl}/api/v1/emergency-profile`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${patientAToken}`,
    },
  });

  assert.equal(res.status, 200);
  const data = (await res.json()) as any;
  assert.equal(data.hasProfile, true);
  assert.equal(data.profile.bloodGroup, 'B+');
  assert.ok(data.contacts.length >= 1, 'Should include emergency contacts');
  assert.equal(data.contacts[0].name, 'Sunita Sharma');
});

test('4. Patient exercises DPDP Right to Erasure for selective fields', async () => {
  const res = await fetch(`${baseUrl}/api/v1/emergency-profile`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${patientAToken}`,
    },
    body: JSON.stringify({ fields: ['currentMedications', 'allergies'] }),
  });

  assert.equal(res.status, 200);
  const data = (await res.json()) as any;
  assert.equal(data.profile.currentMedications, null, 'Current medications should be cleared');
  assert.equal(data.profile.allergies, null, 'Allergies should be cleared');
  assert.equal(data.profile.bloodGroup, 'B+', 'Blood group should remain untouched');
  assert.equal(data.profile.medicalConditions, 'Asthma, Type-2 Diabetes', 'Conditions should remain untouched');
});

test('5. Public QR scan provides ONLY a non-confidential safety card (ZERO sensitive medical records)', async () => {
  // First fetch patient profile to get emergencyAccessToken
  const profileRes = await fetch(`${baseUrl}/api/v1/emergency-profile`, {
    headers: { Authorization: `Bearer ${patientAToken}` },
  });
  const profileData = (await profileRes.json()) as any;
  const token = profileData.profile.emergencyAccessToken;
  assert.ok(token);

  // Unauthenticated public scan (bystander or good Samaritan scanning the QR code)
  const scanRes = await fetch(`${baseUrl}/api/v1/emergency-profile/qr-card/${token}`);
  assert.equal(scanRes.status, 200);
  const scanData = (await scanRes.json()) as any;

  assert.equal(scanData.status, 'SAFETY_CARD_ACTIVE');
  assert.equal(scanData.isClinicalDataProtected, true);
  assert.ok(scanData.maskedPatientName.startsWith('Rahul'), 'Masks name for safety: Rahul S.');
  assert.ok(scanData.emergencyContacts.length >= 1, 'Provides direct emergency contact phone buttons');
  assert.equal(scanData.emergencyContacts[0].name, 'Sunita Sharma');
  assert.ok(scanData.emergencyHotlines.some((h: any) => h.number === '112'), 'Contains 112 emergency hotline');

  // CRITICAL SECURITY TEST: Ensure NO sensitive clinical data is returned to public scanner!
  assert.equal(scanData.bloodGroup, undefined, 'Blood group must NOT be exposed publicly');
  assert.equal(scanData.allergies, undefined, 'Allergies must NOT be exposed publicly');
  assert.equal(scanData.medicalConditions, undefined, 'Conditions must NOT be exposed publicly');
  assert.equal(scanData.currentMedications, undefined, 'Medications must NOT be exposed publicly');
  assert.equal(scanData.medicalNotes, undefined, 'Medical notes must NOT be exposed publicly');
});

test('6. Regenerating emergency access token immediately invalidates previous QR code', async () => {
  // Get current token
  const profileRes = await fetch(`${baseUrl}/api/v1/emergency-profile`, {
    headers: { Authorization: `Bearer ${patientAToken}` },
  });
  const oldToken = (await profileRes.json() as any).profile.emergencyAccessToken;

  // Patient regenerates token
  const regenRes = await fetch(`${baseUrl}/api/v1/emergency-profile/token/regenerate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${patientAToken}` },
  });
  assert.equal(regenRes.status, 200);
  const regenData = (await regenRes.json()) as any;
  const newToken = regenData.emergencyAccessToken;
  assert.notEqual(newToken, oldToken, 'New token must differ from old token');

  // Old token must now be rejected
  const oldScanRes = await fetch(`${baseUrl}/api/v1/emergency-profile/qr-card/${oldToken}`);
  assert.equal(oldScanRes.status, 404, 'Old token must be rejected with 404');
  const oldScanData = (await oldScanRes.json()) as any;
  assert.equal(oldScanData.code, 'TOKEN_EXPIRED_OR_REVOKED');

  // New token must succeed
  const newScanRes = await fetch(`${baseUrl}/api/v1/emergency-profile/qr-card/${newToken}`);
  assert.equal(newScanRes.status, 200, 'New token must be valid');
});

test('7. Patient disabling emergency consent blocks QR scans and break-glass access', async () => {
  // Disable consent
  await fetch(`${baseUrl}/api/v1/emergency-profile`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${patientAToken}`,
    },
    body: JSON.stringify({ consentEmergencySharing: false }),
  });

  const profileRes = await fetch(`${baseUrl}/api/v1/emergency-profile`, {
    headers: { Authorization: `Bearer ${patientAToken}` },
  });
  const token = (await profileRes.json() as any).profile.emergencyAccessToken;

  // Public scan blocked
  const scanRes = await fetch(`${baseUrl}/api/v1/emergency-profile/qr-card/${token}`);
  assert.equal(scanRes.status, 403);
  assert.equal((await scanRes.json() as any).code, 'EMERGENCY_SHARING_DISABLED');

  // Break-glass blocked
  const breakGlassRes = await fetch(`${baseUrl}/api/v1/emergency-profile/break-glass`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${driverAToken}`,
    },
    body: JSON.stringify({ token, accessReason: 'Unconscious roadside trauma triage' }),
  });
  assert.equal(breakGlassRes.status, 403);

  // Re-enable consent for subsequent tests
  await fetch(`${baseUrl}/api/v1/emergency-profile`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${patientAToken}`,
    },
    body: JSON.stringify({ consentEmergencySharing: true }),
  });
});

test('8. Authorized Paramedic executes Break-Glass access with clinical emergency reason', async () => {
  const profileRes = await fetch(`${baseUrl}/api/v1/emergency-profile`, {
    headers: { Authorization: `Bearer ${patientAToken}` },
  });
  const token = (await profileRes.json() as any).profile.emergencyAccessToken;

  const breakGlassRes = await fetch(`${baseUrl}/api/v1/emergency-profile/break-glass`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${driverAToken}`,
    },
    body: JSON.stringify({
      token,
      accessReason: 'Patient unresponsive at vehicle collision site, assessing trauma risk',
    }),
  });

  assert.equal(breakGlassRes.status, 200);
  const data = (await breakGlassRes.json()) as any;
  assert.equal(data.status, 'BREAK_GLASS_AUTHORIZED');
  assert.equal(data.patientName, 'Rahul Sharma');
  assert.equal(data.clinicalProfile.bloodGroup.value, 'B+');
  assert.equal(data.clinicalProfile.bloodGroup.provenance, 'PATIENT_REPORTED');
  assert.equal(data.clinicalProfile.bloodGroup.isVerified, false, 'Patient-reported is unverified');
  assert.ok(data.clinicalDisclaimer.includes('NOTICE TO EMERGENCY RESPONDERS'));
  assert.equal(data.auditRecordCreated, true);
});

test('9. Break-Glass access enforces role authorization and mandatory clinical reason', async () => {
  const profileRes = await fetch(`${baseUrl}/api/v1/emergency-profile`, {
    headers: { Authorization: `Bearer ${patientAToken}` },
  });
  const token = (await profileRes.json() as any).profile.emergencyAccessToken;

  // Test A: Patient role cannot break glass
  const patientAttempt = await fetch(`${baseUrl}/api/v1/emergency-profile/break-glass`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${patientBToken}`,
    },
    body: JSON.stringify({ token, accessReason: 'Curious bystander' }),
  });
  assert.equal(patientAttempt.status, 403);
  assert.equal((await patientAttempt.json() as any).code, 'FORBIDDEN_ROLE');

  // Test B: Reason missing or too short
  const shortReasonAttempt = await fetch(`${baseUrl}/api/v1/emergency-profile/break-glass`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${driverAToken}`,
    },
    body: JSON.stringify({ token, accessReason: 'Test' }), // Less than 8 chars
  });
  assert.equal(shortReasonAttempt.status, 400);
  assert.equal((await shortReasonAttempt.json() as any).code, 'BREAK_GLASS_REASON_REQUIRED');
});

test('10. Active Dispatch Triage access is granted to assigned driver and destination hospital', async () => {
  // Create an active emergency request
  const emergencyRequest = await prisma.emergencyRequest.create({
    data: {
      patientId: patientAUser.id,
      driverId: driverAUser.id,
      hospitalId: hospitalEntity.id,
      pickupLat: 21.1458,
      pickupLng: 79.0882,
      status: 'AMBULANCE_ARRIVING',
      tripType: 'SOS',
      category: 'CARDIAC',
      urgencyLevel: 'CRITICAL',
    },
  });

  // Assigned Driver A accesses dispatch triage
  const driverRes = await fetch(`${baseUrl}/api/v1/emergency-profile/dispatch/${emergencyRequest.id}`, {
    headers: { Authorization: `Bearer ${driverAToken}` },
  });
  assert.equal(driverRes.status, 200);
  const driverData = (await driverRes.json()) as any;
  assert.equal(driverData.status, 'DISPATCH_TRIAGE_ACTIVE');
  assert.equal(driverData.patientName, 'Rahul Sharma');
  assert.equal(driverData.clinicalProfile.bloodGroup.value, 'B+');
  assert.ok(driverData.clinicalDisclaimer.includes('NOTICE TO EMERGENCY RESPONDERS'));

  // Destination Hospital Admin accesses dispatch triage
  const hospitalRes = await fetch(`${baseUrl}/api/v1/emergency-profile/dispatch/${emergencyRequest.id}`, {
    headers: { Authorization: `Bearer ${hospitalAdminToken}` },
  });
  assert.equal(hospitalRes.status, 200);
  const hospitalData = (await hospitalRes.json()) as any;
  assert.equal(hospitalData.patientName, 'Rahul Sharma');
});

test('11. Unassigned Driver B is denied dispatch triage access (HTTP 403)', async () => {
  // Emergency request assigned to Driver A, not Driver B
  const emergencyRequest = await prisma.emergencyRequest.create({
    data: {
      patientId: patientAUser.id,
      driverId: driverAUser.id,
      pickupLat: 21.1458,
      pickupLng: 79.0882,
      status: 'IN_TRANSIT',
      tripType: 'SOS',
    },
  });

  const unassignedRes = await fetch(`${baseUrl}/api/v1/emergency-profile/dispatch/${emergencyRequest.id}`, {
    headers: { Authorization: `Bearer ${driverBToken}` },
  });
  assert.equal(unassignedRes.status, 403);
  const errData = (await unassignedRes.json()) as any;
  assert.equal(errData.code, 'UNAUTHORIZED_DISPATCH_ACCESS');
});

test('12. Patient inspects immutable access audit logs (DPDP Transparency)', async () => {
  const res = await fetch(`${baseUrl}/api/v1/emergency-profile/access-logs`, {
    headers: { Authorization: `Bearer ${patientAToken}` },
  });

  assert.equal(res.status, 200);
  const data = (await res.json()) as any;
  assert.ok(data.logs.length >= 2, 'Should have multiple access log entries');

  // Verify that break-glass access was logged
  const breakGlassLog = data.logs.find((l: any) => l.accessType === EmergencyAccessType.BREAK_GLASS_QR);
  assert.ok(breakGlassLog, 'Break-glass access must be audited');
  assert.equal(breakGlassLog.accessorRole, 'DRIVER');
  assert.equal(breakGlassLog.lawfulBasis, 'EMERGENCY_MEDICAL_TREATMENT_DPDP_SEC_7');

  // CRITICAL PRIVACY TEST: Ensure full medical values are NOT stored in audit logs
  assert.ok(Array.isArray(breakGlassLog.fieldsAccessed), 'fieldsAccessed should be list of field names');
  assert.ok(breakGlassLog.fieldsAccessed.includes('bloodGroup'));
  assert.equal(JSON.stringify(breakGlassLog).includes('Salbutamol'), false, 'Raw drug names must not be logged in audit table');
});

test('13. Authorized Clinician verifies patient blood group with VERIFIED_CLINICAL provenance', async () => {
  const verifyRes = await fetch(`${baseUrl}/api/v1/emergency-profile/verify-field`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hospitalAdminToken}`,
    },
    body: JSON.stringify({
      patientId: patientAUser.id,
      fieldName: 'bloodGroup',
      verifiedValue: 'B+',
    }),
  });

  assert.equal(verifyRes.status, 200);
  const verifyData = (await verifyRes.json()) as any;
  assert.equal(verifyData.profile.bloodGroupProvenance, 'VERIFIED_CLINICAL');
  assert.ok(verifyData.profile.verifiedBy.includes('Priya Deshmukh'));
  assert.ok(verifyData.profile.verifiedAt);

  // Now when responder views the profile, bloodGroup reflects VERIFIED_CLINICAL
  const profileRes = await fetch(`${baseUrl}/api/v1/emergency-profile`, {
    headers: { Authorization: `Bearer ${patientAToken}` },
  });
  const updatedProfile = (await profileRes.json() as any).profile;
  assert.equal(updatedProfile.bloodGroupProvenance, 'VERIFIED_CLINICAL');
});

test('14. Full Right to Erasure: Patient permanently deletes voluntary emergency health profile', async () => {
  const delRes = await fetch(`${baseUrl}/api/v1/emergency-profile`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${patientBToken}` },
  });

  assert.equal(delRes.status, 200);
  const delData = (await delRes.json()) as any;
  assert.equal(delData.hasProfile, false);

  // Subsequent GET returns hasProfile: false
  const getRes = await fetch(`${baseUrl}/api/v1/emergency-profile`, {
    headers: { Authorization: `Bearer ${patientBToken}` },
  });
  const getData = (await getRes.json()) as any;
  assert.equal(getData.hasProfile, false);
});

test('15. Emergency services (SOS dispatch) are NEVER blocked if patient has not completed a profile', async () => {
  // Patient C has zero profile
  const profileCheck = await fetch(`${baseUrl}/api/v1/emergency-profile`, {
    headers: { Authorization: `Bearer ${patientCToken}` },
  });
  assert.equal((await profileCheck.json() as any).hasProfile, false);

  // Patient C triggers SOS dispatch
  const sosRes = await fetch(`${baseUrl}/api/v1/sos/request`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${patientCToken}`,
    },
    body: JSON.stringify({
      pickupLat: 21.1458,
      pickupLng: 79.0882,
      category: 'CARDIAC',
      urgencyLevel: 'CRITICAL',
    }),
  });

  // SOS must succeed without blocking
  assert.ok([200, 201].includes(sosRes.status), `Expected HTTP 200 or 201, got ${sosRes.status}`);
  const sosData = (await sosRes.json()) as any;
  assert.ok(sosData.request && sosData.request.id, 'Emergency request must be created');
  assert.equal(sosData.request.patientId, patientCUser.id);
});

test('16. Nani AI strictly refuses to diagnose conditions or decide treatments', async () => {
  // Query 1: Asking for diagnosis
  const diagRes = await fetch(`${baseUrl}/api/v1/chatbot/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Can you please diagnose what illness I have based on my symptoms?',
    }),
  });
  assert.equal(diagRes.status, 200);
  const diagData = (await diagRes.json()) as any;
  assert.ok(
    diagData.reply.includes('prohibited from diagnosing') || diagData.reply.includes('चिकित्सीय निदान'),
    'Nani must refuse medical diagnosis'
  );

  // Query 2: Asking for treatment decision / prescription
  const treatRes = await fetch(`${baseUrl}/api/v1/chatbot/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'What medicine and treatment should I decide to take?',
    }),
  });
  assert.equal(treatRes.status, 200);
  const treatData = (await treatRes.json()) as any;
  assert.ok(
    treatData.reply.includes('prohibited from diagnosing') || treatData.reply.includes('दवाएं निर्धारित'),
    'Nani must refuse treatment prescribing'
  );

  // Query 3: Asking about Medical ID privacy
  const idRes = await fetch(`${baseUrl}/api/v1/chatbot/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'How does the LifeLink medical ID QR code protect my privacy?',
    }),
  });
  assert.equal(idRes.status, 200);
  const idData = (await idRes.json()) as any;
  assert.ok(
    idData.reply.includes('DPDP') || idData.reply.includes('break-glass') || idData.reply.includes('safety card'),
    'Nani explains privacy protection'
  );
});
