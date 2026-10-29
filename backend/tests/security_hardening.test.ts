process.env.NODE_ENV = 'test';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';
import { Server } from 'socket.io';
import app from '../src/app';
import prisma, { inMemoryDb } from '../src/db';
import { generateTokens } from '../src/services/tokenService';
import { setupSocketHandlers } from '../src/socket';
import { Role, VerificationState, AppointmentStatus, RequestStatus, BedStatus, WardType } from '@prisma/client';
import { documentRegistry } from '../src/routes/upload';
import { evaluateCandidateEligibility, CandidateVehicle } from '../src/services/dispatchEngine';

let server: http.Server;
let baseUrl: string;
let ioServer: any;

// Test users and tokens
let patientAToken: string;
let patientAId: string;
let patientBToken: string;
let patientBId: string;
let hospitalAdminAToken: string;
let hospitalAdminAId: string;
let hospitalAId: string;
let hospitalAdminBToken: string;
let hospitalAdminBId: string;
let hospitalBId: string;
let operatorAdminAToken: string;
let operatorAdminAId: string;
let operatorAId: string;
let operatorAdminBToken: string;
let operatorAdminBId: string;
let operatorBId: string;
let superAdminToken: string;
let superAdminId: string;
let verificationAdminToken: string;
let verificationAdminId: string;
let suspendedUserToken: string;
let suspendedUserId: string;

let testAppointmentAId: string;
let testEmergencyReqAId: string;
let testDocFilename: string;

test.before(async () => {
  process.env.NODE_ENV = 'test';
  inMemoryDb.clear();

  server = http.createServer(app);
  ioServer = new Server(server, { cors: { origin: '*' } });
  setupSocketHandlers(ioServer);

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as any;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });

  // Seed Patient A
  const patA = await prisma.user.create({
    data: {
      name: 'Aarav Sharma (Patient A)',
      email: 'patient.a@example.in',
      phone: '+919876500001',
      passwordHash: 'hashed123',
      role: Role.PATIENT,
      isActive: true,
      isSuspended: false,
    },
  });
  patientAId = patA.id;
  patientAToken = generateTokens({ id: patA.id, email: patA.email, role: patA.role, name: patA.name }).accessToken;

  // Seed Patient B
  const patB = await prisma.user.create({
    data: {
      name: 'Diya Patel (Patient B)',
      email: 'patient.b@example.in',
      phone: '+919876500002',
      passwordHash: 'hashed123',
      role: Role.PATIENT,
      isActive: true,
      isSuspended: false,
    },
  });
  patientBId = patB.id;
  patientBToken = generateTokens({ id: patB.id, email: patB.email, role: patB.role, name: patB.name }).accessToken;

  // Seed Hospital A and Admin A
  const hAdminA = await prisma.user.create({
    data: {
      name: 'Dr. Suresh Admin (Hospital A)',
      email: 'admin.hosp.a@example.in',
      phone: '+919876500003',
      passwordHash: 'hashed123',
      role: Role.ADMIN_HOSPITAL,
      isActive: true,
      isSuspended: false,
    },
  });
  hospitalAdminAId = hAdminA.id;
  const hospA = await prisma.hospital.create({
    data: {
      name: 'Nagpur Care Hospital A',
      address: 'Central Nagpur, Maharashtra',
      contactNumber: '+917122000001',
      lat: 21.1458,
      lng: 79.0882,
      availableBeds: 10,
      adminUserId: hAdminA.id,
      verificationState: VerificationState.VERIFIED,
    },
  });
  hospitalAId = hospA.id;
  await prisma.user.update({ where: { id: hAdminA.id }, data: { hospitalId: hospA.id } });
  hospitalAdminAToken = generateTokens({
    id: hAdminA.id,
    email: hAdminA.email,
    role: hAdminA.role,
    name: hAdminA.name,
    hospitalId: hospA.id,
  }).accessToken;

  // Seed Hospital B and Admin B
  const hAdminB = await prisma.user.create({
    data: {
      name: 'Dr. Rajesh Admin (Hospital B)',
      email: 'admin.hosp.b@example.in',
      phone: '+919876500004',
      passwordHash: 'hashed123',
      role: Role.ADMIN_HOSPITAL,
      isActive: true,
      isSuspended: false,
    },
  });
  hospitalAdminBId = hAdminB.id;
  const hospB = await prisma.hospital.create({
    data: {
      name: 'Nagpur Metro Hospital B',
      address: 'Civil Lines, Nagpur, Maharashtra',
      contactNumber: '+917122000002',
      lat: 21.1500,
      lng: 79.0900,
      availableBeds: 8,
      adminUserId: hAdminB.id,
      verificationState: VerificationState.VERIFIED,
    },
  });
  hospitalBId = hospB.id;
  await prisma.user.update({ where: { id: hAdminB.id }, data: { hospitalId: hospB.id } });
  hospitalAdminBToken = generateTokens({
    id: hAdminB.id,
    email: hAdminB.email,
    role: hAdminB.role,
    name: hAdminB.name,
    hospitalId: hospB.id,
  }).accessToken;

  // Seed Operator A and Operator Admin A
  const opAdminA = await prisma.user.create({
    data: {
      name: 'Vikas Sharma (Operator A)',
      email: 'operator.a@example.in',
      phone: '+919876500005',
      passwordHash: 'hashed123',
      role: Role.OPERATOR_ADMIN,
      isActive: true,
      isSuspended: false,
    },
  });
  operatorAdminAId = opAdminA.id;
  const opA = await prisma.ambulanceOperator.create({
    data: {
      name: 'LifeLine Fleet Services Alpha',
      tradeLicense: 'MH-OPS-ALPHA-01',
      email: opAdminA.email,
      contactPhone: opAdminA.phone || '+919876500005',
      address: 'Wardha Road, Nagpur',
      adminUserId: opAdminA.id,
      verificationState: VerificationState.VERIFIED,
    },
  });
  operatorAId = opA.id;
  await prisma.user.update({ where: { id: opAdminA.id }, data: { operatorId: opA.id } });
  operatorAdminAToken = generateTokens({
    id: opAdminA.id,
    email: opAdminA.email,
    role: opAdminA.role,
    name: opAdminA.name,
    operatorId: opA.id,
  }).accessToken;

  // Seed Operator B and Operator Admin B
  const opAdminB = await prisma.user.create({
    data: {
      name: 'Anil Kumar (Operator B)',
      email: 'operator.b@example.in',
      phone: '+919876500006',
      passwordHash: 'hashed123',
      role: Role.OPERATOR_ADMIN,
      isActive: true,
      isSuspended: false,
    },
  });
  operatorAdminBId = opAdminB.id;
  const opB = await prisma.ambulanceOperator.create({
    data: {
      name: 'Orange City Ambulances Beta',
      tradeLicense: 'MH-OPS-BETA-02',
      email: opAdminB.email,
      contactPhone: opAdminB.phone || '+919876500006',
      address: 'Sitabuldi, Nagpur',
      adminUserId: opAdminB.id,
      verificationState: VerificationState.VERIFIED,
    },
  });
  operatorBId = opB.id;
  await prisma.user.update({ where: { id: opAdminB.id }, data: { operatorId: opB.id } });
  operatorAdminBToken = generateTokens({
    id: opAdminB.id,
    email: opAdminB.email,
    role: opAdminB.role,
    name: opAdminB.name,
    operatorId: opB.id,
  }).accessToken;

  // Seed Super Admin
  const supAdmin = await prisma.user.create({
    data: {
      name: 'Super Admin Officer',
      email: 'superadmin@lifelink.nagpur.gov.in',
      phone: '+919876500099',
      passwordHash: 'hashed123',
      role: Role.SUPER_ADMIN,
      isActive: true,
      isSuspended: false,
    },
  });
  superAdminId = supAdmin.id;
  superAdminToken = generateTokens({
    id: supAdmin.id,
    email: supAdmin.email,
    role: supAdmin.role,
    name: supAdmin.name,
  }).accessToken;

  // Seed Verification Admin
  const verAdmin = await prisma.user.create({
    data: {
      name: 'Pooja Deshmukh (Verification Staff)',
      email: 'verifier@lifelink.nagpur.gov.in',
      phone: '+919876500088',
      passwordHash: 'hashed123',
      role: 'VERIFICATION_ADMIN' as any,
      isActive: true,
      isSuspended: false,
    },
  });
  verificationAdminId = verAdmin.id;
  verificationAdminToken = generateTokens({
    id: verAdmin.id,
    email: verAdmin.email,
    role: 'VERIFICATION_ADMIN',
    name: verAdmin.name,
  }).accessToken;

  // Seed Suspended User
  const suspUser = await prisma.user.create({
    data: {
      name: 'Suspended Account User',
      email: 'suspended@example.in',
      phone: '+919876500077',
      passwordHash: 'hashed123',
      role: Role.PATIENT,
      isActive: true,
      isSuspended: true,
    },
  });
  suspendedUserId = suspUser.id;
  suspendedUserToken = generateTokens({
    id: suspUser.id,
    email: suspUser.email,
    role: suspUser.role,
    name: suspUser.name,
  }).accessToken;

  // Seed Doctor & Slot in Hospital A
  const docA = await prisma.doctor.create({
    data: {
      name: 'Dr. Vivek Joshi',
      specialization: 'Cardiology',
      hospitalId: hospitalAId,
      experienceYears: 12,
      consultationFee: 500,
      isActive: true,
    },
  });
  const slotA = await prisma.doctorSlot.create({
    data: {
      doctorId: docA.id,
      date: '2026-11-01',
      startTime: '10:00',
      endTime: '11:00',
      maxPatients: 5,
      bookedCount: 1,
    },
  });

  // Seed Appointment for Patient A
  const aptA = await prisma.appointment.create({
    data: {
      hospitalId: hospitalAId,
      doctorId: docA.id,
      slotId: slotA.id,
      patientId: patientAId,
      tokenNumber: 1,
      tokenString: 'NAG-CARD-20261101-001',
      status: AppointmentStatus.BOOKED,
      symptoms: 'Mild chest discomfort',
    },
  });
  testAppointmentAId = aptA.id;

  // Seed Emergency Request for Patient A
  const emReqA = await prisma.emergencyRequest.create({
    data: {
      patientId: patientAId,
      pickupLat: 21.1458,
      pickupLng: 79.0882,
      pickupAddress: 'Sitabuldi Square, Nagpur',
      status: RequestStatus.REQUESTED,
      category: 'CARDIAC',
      hospitalId: hospitalAId,
    },
  });
  testEmergencyReqAId = emReqA.id;

  // Seed a private document uploaded by Patient A
  const uploadDir = path.resolve(__dirname, '../uploads');
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
  testDocFilename = `doc-${Date.now()}-patient-a-ecg.pdf`;
  const filePath = path.join(uploadDir, testDocFilename);
  fs.writeFileSync(filePath, '%PDF-1.4 Mock ECG Clinical Document Content');

  documentRegistry.set(testDocFilename, {
    filename: testDocFilename,
    originalName: 'patient-a-ecg.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 42,
    uploadedByUserId: patientAId,
    uploadedByUserRole: Role.PATIENT,
    uploadedAt: new Date(),
  });
});

test.after(async () => {
  // Clean up mock document
  try {
    const uploadDir = path.resolve(__dirname, '../uploads');
    const filePath = path.join(uploadDir, testDocFilename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {}

  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  try {
    await prisma.$disconnect();
  } catch {}
});

// =========================================================================
// 1. UNAUTHENTICATED ACCESS REJECTION
// =========================================================================

test('1.1. Unauthenticated request to appointments is rejected with HTTP 401', async () => {
  const res = await fetch(`${baseUrl}/api/v1/appointments/my`);
  assert.equal(res.status, 401);
});

test('1.2. Unauthenticated request to health metrics is rejected with HTTP 401', async () => {
  const res = await fetch(`${baseUrl}/api/v1/health-metrics`);
  assert.equal(res.status, 401);
});

test('1.3. Unauthenticated request to private uploaded document is rejected with HTTP 401', async () => {
  const res = await fetch(`${baseUrl}/uploads/${testDocFilename}`);
  assert.equal(res.status, 401);
});

test('1.4. Unauthenticated request to admin telemetry is rejected with HTTP 401', async () => {
  const res = await fetch(`${baseUrl}/api/v1/admin/telemetry`);
  assert.equal(res.status, 401);
});

// =========================================================================
// 2. PRIVILEGE ESCALATION PREVENTION
// =========================================================================

test('2.1. Public registration rejects attempted role escalation to SUPER_ADMIN', async () => {
  const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Malicious Actor',
      email: 'attacker@evil.com',
      password: 'StrongPassword123!',
      phone: '+919876543210',
      role: 'SUPER_ADMIN',
    }),
  });

  assert.equal(res.status, 400);
  const data = (await res.json()) as any;
  assert.ok(data.message.includes('restricted to PATIENT'));
});

test('2.2. Patient attempting verification review is rejected with HTTP 403 Forbidden', async () => {
  const res = await fetch(`${baseUrl}/api/v1/verification/review`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${patientAToken}`,
    },
    body: JSON.stringify({
      entityType: 'HOSPITAL',
      entityId: hospitalAId,
      status: 'VERIFIED',
    }),
  });

  assert.equal(res.status, 403);
});

test('2.3. Hospital Admin attempting super admin activity logs is rejected with HTTP 403', async () => {
  const res = await fetch(`${baseUrl}/api/v1/admin/activity-logs`, {
    headers: {
      Authorization: `Bearer ${hospitalAdminAToken}`,
    },
  });

  assert.equal(res.status, 403);
});

// =========================================================================
// 3. CROSS-PATIENT DATA ACCESS PROTECTION
// =========================================================================

test('3.1. Patient B is forbidden from accessing Patient A appointment details (HTTP 403)', async () => {
  const res = await fetch(`${baseUrl}/api/v1/appointments/${testAppointmentAId}`, {
    headers: {
      Authorization: `Bearer ${patientBToken}`,
    },
  });

  assert.equal(res.status, 403);
  const data = (await res.json()) as any;
  assert.equal(data.code, 'UNAUTHORIZED_APPOINTMENT_ACCESS');
});

test('3.2. Patient A can view their own appointment (HTTP 200)', async () => {
  const res = await fetch(`${baseUrl}/api/v1/appointments/${testAppointmentAId}`, {
    headers: {
      Authorization: `Bearer ${patientAToken}`,
    },
  });

  assert.equal(res.status, 200);
  const data = (await res.json()) as any;
  assert.equal(data.id, testAppointmentAId);
  assert.equal(data.patientId, patientAId);
});

test('3.3. Patient B is forbidden from accessing Patient A emergency request details (HTTP 403)', async () => {
  const res = await fetch(`${baseUrl}/api/v1/sos/${testEmergencyReqAId}`, {
    headers: {
      Authorization: `Bearer ${patientBToken}`,
    },
  });

  assert.equal(res.status, 403);
  const data = (await res.json()) as any;
  assert.equal(data.code, 'FORBIDDEN_EMERGENCY_ACCESS');
});

test('3.4. Patient A can view their own emergency request details (HTTP 200)', async () => {
  const res = await fetch(`${baseUrl}/api/v1/sos/${testEmergencyReqAId}`, {
    headers: {
      Authorization: `Bearer ${patientAToken}`,
    },
  });

  assert.equal(res.status, 200);
  const data = (await res.json()) as any;
  assert.equal(data.request.id, testEmergencyReqAId);
});

test('3.5. Patient B cannot update Patient A emergency contact records', async () => {
  // Create contact for Patient A
  const contactA = await prisma.emergencyContact.create({
    data: {
      patientId: patientAId,
      name: 'Mother of Aarav',
      phone: '+919876599991',
      relation: 'Mother',
    },
  });

  const res = await fetch(`${baseUrl}/api/v1/emergency-contacts/${contactA.id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${patientBToken}`,
    },
    body: JSON.stringify({ name: 'Hijacked Contact Name' }),
  });

  assert.equal(res.status, 404, 'Must return 404 Not Found to prevent leaking contact existence');
});

test('3.6. Health metrics query strictly isolates records by authenticated patient ID', async () => {
  // Record health metric for Patient A
  await prisma.healthMetric.create({
    data: {
      patientId: patientAId,
      metricType: 'pulse',
      value: 72,
      unit: 'bpm',
    },
  });

  // Patient B queries health metrics
  const resB = await fetch(`${baseUrl}/api/v1/health-metrics`, {
    headers: { Authorization: `Bearer ${patientBToken}` },
  });

  assert.equal(resB.status, 200);
  const metricsB = (await resB.json()) as any[];
  // Patient B should have 0 metrics
  assert.equal(metricsB.length, 0);

  // Patient A queries health metrics
  const resA = await fetch(`${baseUrl}/api/v1/health-metrics`, {
    headers: { Authorization: `Bearer ${patientAToken}` },
  });
  const metricsA = (await resA.json()) as any[];
  assert.ok(metricsA.some((m) => m.patientId === patientAId));
});

// =========================================================================
// 4. CROSS-HOSPITAL TENANT ISOLATION
// =========================================================================

test('4.1. Hospital Admin B cannot modify bed status for Hospital A (HTTP 403)', async () => {
  // Create bed in Hospital A
  const bedA = await prisma.hospitalBed.create({
    data: {
      hospitalId: hospitalAId,
      bedNumber: 'SEC-ICU-01',
      ward: WardType.ICU,
      status: BedStatus.AVAILABLE,
    },
  });

  // Admin B attempts to update bed status in Hospital A
  const res = await fetch(`${baseUrl}/api/v1/hospitals/beds/${bedA.id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hospitalAdminBToken}`,
    },
    body: JSON.stringify({ status: BedStatus.OCCUPIED, patientName: 'Attacker Impersonation' }),
  });

  assert.equal(res.status, 403);
  const data = (await res.json()) as any;
  assert.equal(data.code, 'UNAUTHORIZED_HOSPITAL_ACCESS');
});

test('4.2. Hospital Admin B cannot modify booking status for Hospital A (HTTP 403)', async () => {
  // Create booking in Hospital A
  const bookingA = await prisma.hospitalBooking.create({
    data: {
      hospitalId: hospitalAId,
      patientName: 'Local Patient',
      patientPhone: '+919876544444',
      bookingType: 'EMERGENCY_ADMISSION',
      department: 'Trauma',
      doctorName: 'Dr. Vivek Joshi',
      status: 'PENDING',
    },
  });

  // Admin B attempts to modify booking status in Hospital A
  const res = await fetch(`${baseUrl}/api/v1/hospitals/bookings/${bookingA.id}/status`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hospitalAdminBToken}`,
    },
    body: JSON.stringify({ status: 'ADMITTED' }),
  });

  assert.equal(res.status, 403);
  const data = (await res.json()) as any;
  assert.equal(data.code, 'UNAUTHORIZED_HOSPITAL_ACCESS');
});

test('4.3. Hospital Admin B cannot cancel appointment in Hospital A (HTTP 403)', async () => {
  const res = await fetch(`${baseUrl}/api/v1/appointments/${testAppointmentAId}/cancel`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${hospitalAdminBToken}`,
    },
  });

  assert.equal(res.status, 403);
  const data = (await res.json()) as any;
  assert.equal(data.code, 'UNAUTHORIZED_HOSPITAL_ACCESS');
});

test('4.4. Hospital Admin B cannot modify doctor details in Hospital A (HTTP 403)', async () => {
  const docA = await prisma.doctor.findFirst({ where: { hospitalId: hospitalAId } });

  const res = await fetch(`${baseUrl}/api/v1/doctors/${docA!.id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hospitalAdminBToken}`,
    },
    body: JSON.stringify({ consultationFee: 99999 }),
  });

  assert.equal(res.status, 403);
  const data = (await res.json()) as any;
  assert.equal(data.code, 'UNAUTHORIZED_HOSPITAL_ACCESS');
});

// =========================================================================
// 5. CROSS-OPERATOR TENANT ISOLATION
// =========================================================================

test('5.1. Operator Admin B cannot modify ambulance of Operator A (HTTP 403)', async () => {
  // Register ambulance under Operator A
  const ambA = await prisma.ambulance.create({
    data: {
      vehicleNumber: 'MH-31-SEC-001',
      ambulanceType: 'ADVANCED_LIFE_SUPPORT',
      operatorId: operatorAId,
      isAvailable: false,
      currentLat: 21.1458,
      currentLng: 79.0882,
      verificationState: VerificationState.VERIFIED,
      verificationStatus: 'APPROVED',
    },
  });

  // Operator Admin B attempts to toggle availability of Operator A ambulance
  const res = await fetch(`${baseUrl}/api/v1/sos/fleet/operator/ambulances/${ambA.id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${operatorAdminBToken}`,
    },
    body: JSON.stringify({ isAvailable: true }),
  });

  assert.equal(res.status, 403);
  const data = (await res.json()) as any;
  assert.equal(data.code, 'UNAUTHORIZED_OPERATOR_ACCESS');
});

test('5.2. Operator Admin A cannot assign driver belonging to Operator B (HTTP 400)', async () => {
  // Create driver under Operator B
  const driverB = await prisma.user.create({
    data: {
      name: 'Rohan Driver (Operator B)',
      email: 'rohan.b@example.in',
      phone: '+919876522222',
      passwordHash: 'dummy',
      role: Role.DRIVER,
      operatorId: operatorBId,
      isActive: true,
    },
  });

  const ambA = await prisma.ambulance.findFirst({ where: { operatorId: operatorAId } });

  // Operator Admin A attempts to assign Driver B
  const res = await fetch(`${baseUrl}/api/v1/sos/fleet/operator/ambulances/${ambA!.id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${operatorAdminAToken}`,
    },
    body: JSON.stringify({ driverId: driverB.id }),
  });

  assert.equal(res.status, 400);
  const data = (await res.json()) as any;
  assert.equal(data.code, 'DRIVER_NOT_IN_ROSTER');
});

// =========================================================================
// 6. DOCUMENT SECURITY & PATH TRAVERSAL MITIGATION
// =========================================================================

test('6.1. Path traversal in document download is rejected with HTTP 400', async () => {
  const res = await fetch(`${baseUrl}/uploads/test?file=..%2Fpackage.json`, {
    headers: { Authorization: `Bearer ${patientAToken}` },
  });
  assert.equal(res.status, 400);
  const data = (await res.json()) as any;
  assert.ok(data.message.includes('Path traversal is blocked'));
});

test('6.2. Patient B is forbidden from accessing Patient A private document (HTTP 403)', async () => {
  const res = await fetch(`${baseUrl}/uploads/${testDocFilename}`, {
    headers: { Authorization: `Bearer ${patientBToken}` },
  });

  assert.equal(res.status, 403);
  const data = (await res.json()) as any;
  assert.equal(data.code, 'UNAUTHORIZED_DOCUMENT_ACCESS');
});

test('6.3. Document owner (Patient A) can download their document (HTTP 200)', async () => {
  const res = await fetch(`${baseUrl}/uploads/${testDocFilename}`, {
    headers: { Authorization: `Bearer ${patientAToken}` },
  });

  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(res.headers.get('content-security-policy')?.includes("default-src 'none'"));
});

test('6.4. Super Admin can access document for platform auditing (HTTP 200)', async () => {
  const res = await fetch(`${baseUrl}/uploads/${testDocFilename}`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });

  assert.equal(res.status, 200);
});

test('6.5. Verification Admin can access document for review verification (HTTP 200)', async () => {
  const res = await fetch(`${baseUrl}/uploads/${testDocFilename}`, {
    headers: { Authorization: `Bearer ${verificationAdminToken}` },
  });

  assert.equal(res.status, 200);
});

// =========================================================================
// 7. SUSPENDED ACCOUNTS & SESSION REVOCATION
// =========================================================================

test('7.1. Suspended user token is immediately rejected with HTTP 403 by authenticate middleware', async () => {
  const res = await fetch(`${baseUrl}/api/v1/appointments/my`, {
    headers: { Authorization: `Bearer ${suspendedUserToken}` },
  });

  assert.equal(res.status, 403);
  const data = (await res.json()) as any;
  assert.ok(data.message.includes('Account suspended'));
});

test('7.2. Suspended user login is rejected with HTTP 403', async () => {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'suspended@example.in',
      password: 'hashed123',
    }),
  });

  assert.equal(res.status, 403);
  const data = (await res.json()) as any;
  assert.ok(data.message.includes('suspended'));
});

test('7.3. Suspended driver is excluded from dispatch candidates by eligibility gatekeeper', async () => {
  const suspDriver = await prisma.user.create({
    data: {
      name: 'Suspended Driver',
      email: 'driver.susp@example.in',
      phone: '+919876577777',
      passwordHash: 'dummy',
      role: Role.DRIVER,
      isSuspended: true,
      isActive: true,
    },
  });

  const candidate: CandidateVehicle = {
    ambulance: { id: 'amb-susp', verificationState: 'VERIFIED', isAvailable: true, maintenanceStatus: 'OPERATIONAL' },
    driver: suspDriver,
    driverProfile: { id: 'dp-susp', verificationState: 'VERIFIED', membershipStatus: 'APPROVED' },
    organization: { type: 'HOSPITAL', id: hospitalAId, name: 'Hosp A', verificationState: 'VERIFIED', isDemo: false },
  };

  const result = await evaluateCandidateEligibility(candidate);
  assert.equal(result.eligible, false);
  assert.ok(result.denialReasons.includes('DRIVER_INACTIVE'));
});

// =========================================================================
// 8. EXPIRED CREDENTIALS & UNVERIFIED ENTITIES
// =========================================================================

test('8.1. Driver with expired license is excluded with CREDENTIAL_EXPIRED', async () => {
  const expiredDriver = await prisma.user.create({
    data: {
      name: 'Expired License Driver',
      email: 'driver.expired@example.in',
      phone: '+919876566666',
      passwordHash: 'dummy',
      role: Role.DRIVER,
      isSuspended: false,
      isActive: true,
    },
  });

  const candidate: CandidateVehicle = {
    ambulance: { id: 'amb-exp', verificationState: 'VERIFIED', isAvailable: true, maintenanceStatus: 'OPERATIONAL' },
    driver: expiredDriver,
    driverProfile: {
      id: 'dp-exp',
      verificationState: 'VERIFIED',
      membershipStatus: 'APPROVED',
      licenseExpiry: new Date(Date.now() - 24 * 3600 * 1000), // Expired yesterday
    },
    organization: { type: 'HOSPITAL', id: hospitalAId, name: 'Hosp A', verificationState: 'VERIFIED', isDemo: false },
  };

  const result = await evaluateCandidateEligibility(candidate);
  assert.equal(result.eligible, false);
  assert.ok(result.denialReasons.includes('CREDENTIAL_EXPIRED'));
});

test('8.2. Unverified organization blocks vehicle dispatch with ORGANIZATION_NOT_VERIFIED', async () => {
  const activeDriver = await prisma.user.create({
    data: {
      name: 'Active Driver',
      email: 'driver.act@example.in',
      phone: '+919876555555',
      passwordHash: 'dummy',
      role: Role.DRIVER,
      isSuspended: false,
      isActive: true,
    },
  });

  const candidate: CandidateVehicle = {
    ambulance: { id: 'amb-1', verificationState: 'VERIFIED', isAvailable: true, maintenanceStatus: 'OPERATIONAL' },
    driver: activeDriver,
    driverProfile: { id: 'dp-1', verificationState: 'VERIFIED', membershipStatus: 'APPROVED' },
    organization: { type: 'HOSPITAL', id: 'unverified-hosp', name: 'Unverified Hosp', verificationState: 'PENDING_REVIEW', isDemo: false },
  };

  const result = await evaluateCandidateEligibility(candidate);
  assert.equal(result.eligible, false);
  assert.ok(result.denialReasons.includes('ORGANIZATION_NOT_VERIFIED'));
});

test('8.3. GET /api/v1/ambulances/nearby excludes unverified or suspended ambulances', async () => {
  // Seed an unverified ambulance
  await prisma.ambulance.create({
    data: {
      vehicleNumber: 'MH-31-UNVER-01',
      ambulanceType: 'BASIC_LIFE_SUPPORT',
      isAvailable: true,
      currentLat: 21.1458,
      currentLng: 79.0882,
      verificationStatus: 'PENDING',
    },
  });

  const res = await fetch(`${baseUrl}/api/v1/ambulances/nearby?lat=21.1458&lng=79.0882`, {
    headers: { Authorization: `Bearer ${patientAToken}` },
  });

  assert.equal(res.status, 200);
  const nearby = (await res.json()) as any[];
  assert.ok(!nearby.some((a) => a.vehicleNumber === 'MH-31-UNVER-01'), 'Unverified ambulance must not appear in nearby results');
});

// =========================================================================
// 9. UNAUTHORIZED SOCKET.IO SUBSCRIPTIONS
// =========================================================================

test('9.1. Anonymous Socket.IO client is rejected from patient:register', async () => {
  class MockSocket extends EventEmitter {
    id = 'mock-anonymous-socket-01';
    handshake = { auth: {}, headers: {} };
    rooms = new Set<string>();
    user: any = null;
    join(room: string) { this.rooms.add(room); }
    leave(room: string) { this.rooms.delete(room); }
  }

  const mockSocket = new MockSocket() as any;
  const connectionListeners = ioServer.listeners('connection');
  (connectionListeners[0] as any)(mockSocket);

  const errorPromise = new Promise<string>((resolve) => {
    mockSocket.on('error:unauthorized', (err: any) => resolve(err.message));
  });

  mockSocket.emit('patient:register', patientAId);

  const msg = await Promise.race([
    errorPromise,
    new Promise<string>((_, reject) => setTimeout(() => reject(new Error('Timeout waiting for socket error')), 2000)),
  ]);

  assert.ok(msg.includes('Authentication required') || msg.includes('Unauthorized'));
  assert.equal(mockSocket.rooms.has(`patient:${patientAId}`), false);
});

test('9.2. Anonymous Socket.IO client is rejected from driver:register', async () => {
  class MockSocket extends EventEmitter {
    id = 'mock-anonymous-socket-02';
    handshake = { auth: {}, headers: {} };
    rooms = new Set<string>();
    user: any = null;
    join(room: string) { this.rooms.add(room); }
    leave(room: string) { this.rooms.delete(room); }
  }

  const mockSocket = new MockSocket() as any;
  const connectionListeners = ioServer.listeners('connection');
  (connectionListeners[0] as any)(mockSocket);

  const errorPromise = new Promise<string>((resolve) => {
    mockSocket.on('error:unauthorized', (err: any) => resolve(err.message));
  });

  mockSocket.emit('driver:register', 'driver-123');

  const msg = await Promise.race([
    errorPromise,
    new Promise<string>((_, reject) => setTimeout(() => reject(new Error('Timeout waiting for socket error')), 2000)),
  ]);

  assert.ok(msg.includes('Authentication required') || msg.includes('Unauthorized'));
});

test('9.3. Anonymous Socket.IO client is rejected from hospital:register', async () => {
  class MockSocket extends EventEmitter {
    id = 'mock-anonymous-socket-03';
    handshake = { auth: {}, headers: {} };
    rooms = new Set<string>();
    user: any = null;
    join(room: string) { this.rooms.add(room); }
    leave(room: string) { this.rooms.delete(room); }
  }

  const mockSocket = new MockSocket() as any;
  const connectionListeners = ioServer.listeners('connection');
  (connectionListeners[0] as any)(mockSocket);

  const errorPromise = new Promise<string>((resolve) => {
    mockSocket.on('error:unauthorized', (err: any) => resolve(err.message));
  });

  mockSocket.emit('hospital:register', hospitalAId);

  const msg = await Promise.race([
    errorPromise,
    new Promise<string>((_, reject) => setTimeout(() => reject(new Error('Timeout waiting for socket error')), 2000)),
  ]);

  assert.ok(msg.includes('Authentication required') || msg.includes('Unauthorized'));
});

test('9.4. Authenticated Patient A is rejected when attempting to subscribe to Patient B room', async () => {
  class MockSocket extends EventEmitter {
    id = 'mock-patient-a-socket';
    handshake = { auth: {}, headers: {} };
    rooms = new Set<string>();
    user: any = { id: patientAId, email: 'patient.a@example.in', role: Role.PATIENT };
    join(room: string) { this.rooms.add(room); }
    leave(room: string) { this.rooms.delete(room); }
  }

  const mockSocket = new MockSocket() as any;
  const connectionListeners = ioServer.listeners('connection');
  (connectionListeners[0] as any)(mockSocket);

  const errorPromise = new Promise<string>((resolve) => {
    mockSocket.on('error:unauthorized', (err: any) => resolve(err.message));
  });

  // Patient A tries to join Patient B room
  mockSocket.emit('patient:register', patientBId);

  const msg = await Promise.race([
    errorPromise,
    new Promise<string>((_, reject) => setTimeout(() => reject(new Error('Timeout waiting for socket error')), 2000)),
  ]);

  assert.ok(msg.includes('Forbidden') || msg.includes('another patient'));
  assert.equal(mockSocket.rooms.has(`patient:${patientBId}`), false);
});
