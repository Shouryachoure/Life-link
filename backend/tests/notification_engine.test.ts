process.env.NODE_ENV = 'test';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { EventEmitter } from 'events';
import { Server } from 'socket.io';
import app from '../src/app';
import prisma, { inMemoryDb } from '../src/db';
import { generateTokens } from '../src/services/tokenService';
import { setupSocketHandlers } from '../src/socket';
import {
  dispatchNotification,
  notifyAppointmentConfirmed,
  notifyAppointmentCancelled,
  notifyAppointmentRescheduled,
  notifyDispatchOffer,
  notifyPatientDispatchStatus,
  notifyIncomingAmbulance,
  notifyDriverVerification,
  notifyDriverCredentialExpiry,
  notifyOrganizationApproval,
  notifySuperAdminReview,
  processOutboxRetries,
  expireObsoleteOffers,
} from '../src/services/notificationService';
import { Role, NotificationStatus, NotificationChannel, VerificationState } from '@prisma/client';

let server: http.Server;
let baseUrl: string;
let ioServer: any;

function makeToken(user: any): string {
  return generateTokens({ id: user.id, email: user.email, role: user.role, name: user.name }).accessToken;
}

// Test users and tokens
let patientAId: string;
let patientAToken: string;
let patientBId: string;
let patientBToken: string;

let doctor1Id: string;
let doctor2Id: string;

let hospitalAId: string;
let hospitalAdminAId: string;
let hospitalAdminAToken: string;

let hospitalBId: string;
let hospitalAdminBId: string;
let hospitalAdminBToken: string;

let driverAId: string;
let driverAToken: string;

let operatorAId: string;
let operatorAdminAId: string;
let operatorAdminAToken: string;

let superAdminId: string;
let superAdminToken: string;

let testSlot1Id: string;
let testSlot2Id: string;

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

  // Seed Patient A & B
  const patientA = await prisma.user.create({
    data: {
      email: 'patient.a@lifelink.in',
      passwordHash: 'hash-patient-a',
      name: 'Rohan Sharma',
      phone: '+919876543210',
      role: Role.PATIENT,
      isActive: true,
      isSuspended: false,
    },
  });
  patientAId = patientA.id;
  patientAToken = makeToken(patientA);

  const patientB = await prisma.user.create({
    data: {
      email: 'patient.b@lifelink.in',
      passwordHash: 'hash-patient-b',
      name: 'Aarav Mehta',
      phone: '+919876543211',
      role: Role.PATIENT,
      isActive: true,
      isSuspended: false,
    },
  });
  patientBId = patientB.id;
  patientBToken = makeToken(patientB);

  // Seed Hospital A & Admin
  const hospAdminA = await prisma.user.create({
    data: {
      email: 'admin.hosp.a@lifelink.in',
      passwordHash: 'hash-hosp-a',
      name: 'Hosp Admin A',
      phone: '+919876543220',
      role: Role.ADMIN_HOSPITAL,
      isActive: true,
      isSuspended: false,
    },
  });
  hospitalAdminAId = hospAdminA.id;
  hospitalAdminAToken = makeToken(hospAdminA);

  const hospitalA = await prisma.hospital.create({
    data: {
      name: 'Nagpur Central Care Hospital',
      address: 'Central Avenue, Nagpur',
      contactNumber: '+917122550001',
      lat: 21.1458,
      lng: 79.0882,
      adminUserId: hospitalAdminAId,
      verificationState: VerificationState.VERIFIED,
    },
  });
  hospitalAId = hospitalA.id;

  // Seed Hospital B & Admin
  const hospAdminB = await prisma.user.create({
    data: {
      email: 'admin.hosp.b@lifelink.in',
      passwordHash: 'hash-hosp-b',
      name: 'Hosp Admin B',
      phone: '+919876543221',
      role: Role.ADMIN_HOSPITAL,
      isActive: true,
      isSuspended: false,
    },
  });
  hospitalAdminBId = hospAdminB.id;
  hospitalAdminBToken = makeToken(hospAdminB);

  const hospitalB = await prisma.hospital.create({
    data: {
      name: 'Dharampeth Medical Centre',
      address: 'Dharampeth, Nagpur',
      contactNumber: '+917122550002',
      lat: 21.1400,
      lng: 79.0700,
      adminUserId: hospitalAdminBId,
      verificationState: VerificationState.VERIFIED,
    },
  });
  hospitalBId = hospitalB.id;

  // Seed Doctors
  const doctor1 = await prisma.doctor.create({
    data: {
      hospitalId: hospitalAId,
      name: 'Dr. Priya Sharma',
      specialization: 'Cardiology',
      consultationFee: 500,
      isActive: true,
    },
  });
  doctor1Id = doctor1.id;

  const doctor2 = await prisma.doctor.create({
    data: {
      hospitalId: hospitalBId,
      name: 'Dr. Rajesh Joshi',
      specialization: 'Neurology',
      consultationFee: 700,
      isActive: true,
    },
  });
  doctor2Id = doctor2.id;

  // Seed Slots
  const slot1 = await prisma.doctorSlot.create({
    data: {
      doctorId: doctor1Id,
      date: '2026-11-01',
      startTime: '10:00',
      endTime: '12:00',
      maxPatients: 10,
      bookedCount: 0,
    },
  });
  testSlot1Id = slot1.id;

  const slot2 = await prisma.doctorSlot.create({
    data: {
      doctorId: doctor2Id,
      date: '2026-11-01',
      startTime: '14:00',
      endTime: '16:00',
      maxPatients: 5,
      bookedCount: 0,
    },
  });
  testSlot2Id = slot2.id;

  // Seed Driver A
  const driverUser = await prisma.user.create({
    data: {
      email: 'driver.a@lifelink.in',
      passwordHash: 'hash-driver-a',
      name: 'Vijay Verma',
      phone: '+919876543230',
      role: Role.DRIVER,
      isActive: true,
      isSuspended: false,
    },
  });
  driverAId = driverUser.id;
  driverAToken = makeToken(driverUser);

  await prisma.driverProfile.create({
    data: {
      userId: driverAId,
      licenseNumber: 'MH-31-2022-009988',
      verificationState: VerificationState.VERIFIED,
    },
  });

  // Seed Operator A
  const opAdminA = await prisma.user.create({
    data: {
      email: 'op.admin.a@lifelink.in',
      passwordHash: 'hash-op-a',
      name: 'Operator Admin A',
      phone: '+919876543240',
      role: Role.OPERATOR_ADMIN,
      isActive: true,
      isSuspended: false,
    },
  });
  operatorAdminAId = opAdminA.id;
  operatorAdminAToken = makeToken(opAdminA);

  const operatorA = await prisma.ambulanceOperator.create({
    data: {
      name: 'Vidarbha Quick Emergency Services',
      tradeLicense: 'VQE-2024-NAG-01',
      contactPhone: '+917122558888',
      email: 'ops@vqe-nagpur.com',
      address: 'Sitabuldi, Nagpur',
      adminUserId: operatorAdminAId,
      verificationState: VerificationState.VERIFIED,
    },
  });
  operatorAId = operatorA.id;

  // Seed Super Admin
  const sAdmin = await prisma.user.create({
    data: {
      email: 'superadmin.notif@lifelink.in',
      passwordHash: 'hash-superadmin',
      name: 'Chief Security Officer',
      phone: '+919876543299',
      role: Role.SUPER_ADMIN,
      isActive: true,
      isSuspended: false,
    },
  });
  superAdminId = sAdmin.id;
  superAdminToken = makeToken(sAdmin);
});

test.after(async () => {
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

// Helper for MockSocket
class MockSocket extends EventEmitter {
  id: string;
  handshake: any;
  rooms: Set<string>;
  user: any;

  constructor(id: string, user: any = null) {
    super();
    this.id = id;
    this.rooms = new Set<string>();
    this.user = user;
    this.handshake = {
      auth: user ? { token: makeToken(user) } : {},
      headers: {},
    };
  }

  join(room: string) {
    this.rooms.add(room);
  }

  leave(room: string) {
    this.rooms.delete(room);
  }
}

// =========================================================================
// SECTION 1: CENTRALIZED NOTIFICATION ENGINE & TRANSACTIONAL OUTBOX
// =========================================================================

test('1.1. Notification Engine creates persisted PENDING notification and marks DELIVERED after delivery', async () => {
  const result = await dispatchNotification({
    recipientId: patientAId,
    recipientRole: Role.PATIENT,
    title: 'Welcome to LifeLink',
    message: 'Your emergency health profile has been synchronized.',
    type: 'SYSTEM_ALERT',
    channel: NotificationChannel.IN_APP,
    idempotencyKey: 'test-welcome-pat-a',
  });

  assert.equal(result.delivered, true);
  assert.equal(result.recipientId, patientAId);
  assert.ok(result.notification);
  assert.equal(result.notification.status, NotificationStatus.DELIVERED);
  assert.ok(result.notification.deliveredAt);

  // Verify database record
  const saved = await prisma.notification.findUnique({
    where: { id: result.notification.id },
  });
  assert.ok(saved);
  assert.equal(saved.recipientId, patientAId);
  assert.equal(saved.isRead, false);
});

test('1.2. Idempotent processing: Duplicate event with same idempotencyKey is suppressed', async () => {
  const duplicateResult = await dispatchNotification({
    recipientId: patientAId,
    recipientRole: Role.PATIENT,
    title: 'Welcome to LifeLink Duplicate',
    message: 'This should be suppressed.',
    type: 'SYSTEM_ALERT',
    idempotencyKey: 'test-welcome-pat-a', // Matching key
  });

  assert.equal(duplicateResult.deduplicated, true);
  assert.equal(duplicateResult.delivered, true);

  // Total notifications for patientA with this key must remain exactly 1
  const count = await prisma.notification.count({
    where: { idempotencyKey: 'test-welcome-pat-a' },
  });
  assert.equal(count, 1);
});

test('1.3. Zero-cost local operation: Fallback to simulated SMS does not crash without external SMS provider', async () => {
  const result = await dispatchNotification({
    recipientId: patientAId,
    recipientRole: Role.PATIENT,
    title: 'Local SMS Test',
    message: 'Zero-cost local SMS simulation message.',
    type: 'SMS_ALERT',
    channel: NotificationChannel.SMS,
    allowSimulatedSMS: true,
    idempotencyKey: 'test-sms-fallback-01',
  });

  assert.equal(result.delivered, true);
  assert.equal(result.notification.channel, NotificationChannel.SMS);
});

// =========================================================================
// SECTION 2: APPOINTMENT NOTIFICATION ROUTING & RECIPIENT CORRECTNESS
// =========================================================================

let bookedAppointmentId: string;

test('2.1. Booking an appointment routes notifications to Patient, assigned Doctor, and Hospital Admin', async () => {
  // Book appointment via API
  const bookRes = await fetch(`${baseUrl}/api/v1/appointments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${patientAToken}`,
    },
    body: JSON.stringify({
      slotId: testSlot1Id,
      symptoms: 'Mild chest tightness',
    }),
  });

  assert.equal(bookRes.status, 201);
  const body = (await bookRes.json()) as any;
  bookedAppointmentId = body.appointment.id;
  assert.ok(bookedAppointmentId);

  // 1. Patient Notification Check
  const patientNotifs = await prisma.notification.findMany({
    where: { recipientId: patientAId, type: 'APPOINTMENT_CONFIRMED' },
  });
  assert.ok(patientNotifs.length >= 1);
  const pNotif = patientNotifs[0];
  assert.ok(pNotif.title.includes('Appointment Confirmed'));
  assert.ok(pNotif.message.includes('Dr. Priya Sharma'));
  assert.equal(pNotif.doctorId, doctor1Id);
  assert.equal(pNotif.hospitalId, hospitalAId);

  // 2. Doctor Alert Check (Strictly assigned doctor)
  const doctorNotifs = await prisma.notification.findMany({
    where: { doctorId: doctor1Id, type: 'DOCTOR_APPOINTMENT_ALERT' },
  });
  assert.ok(doctorNotifs.length >= 1);
  assert.equal(doctorNotifs[0].doctorId, doctor1Id);

  // 3. Hospital Admin Check (Strictly hospital A)
  const hospAdminNotifs = await prisma.notification.findMany({
    where: { recipientId: hospitalAdminAId, hospitalId: hospitalAId },
  });
  assert.ok(hospAdminNotifs.length >= 1);
});

test('2.2. Doctor Isolation: Doctor 2 receives NO notifications for Doctor 1 appointments', async () => {
  const doctor2Notifs = await prisma.notification.findMany({
    where: { doctorId: doctor2Id },
  });
  assert.equal(doctor2Notifs.length, 0, 'Doctor 2 must never receive notifications for Doctor 1');
});

test('2.3. Hospital Isolation: Hospital B receives NO notifications for Hospital A appointments', async () => {
  const hospBNotifs = await prisma.notification.findMany({
    where: { recipientId: hospitalAdminBId },
  });
  assert.equal(hospBNotifs.length, 0, 'Hospital Admin B must never receive events for Hospital A');
});

test('2.4. Cancelling an appointment generates APPOINTMENT_CANCELLED notifications to all parties', async () => {
  const cancelRes = await fetch(`${baseUrl}/api/v1/appointments/${bookedAppointmentId}/cancel`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${patientAToken}`,
    },
  });

  assert.equal(cancelRes.status, 200);

  // Check Patient cancellation notification
  const cancelNotifs = await prisma.notification.findMany({
    where: { recipientId: patientAId, type: 'APPOINTMENT_CANCELLED' },
  });
  assert.ok(cancelNotifs.length >= 1);
  assert.ok(cancelNotifs[0].message.includes('cancelled'));

  // Check Doctor cancellation alert
  const docCancelNotifs = await prisma.notification.findMany({
    where: { doctorId: doctor1Id, type: 'APPOINTMENT_CANCELLED' },
  });
  assert.ok(docCancelNotifs.length >= 1);
});

test('2.5. Rescheduling notification routes updated date/time cleanly', async () => {
  const appointmentMock = {
    id: bookedAppointmentId,
    patientId: patientAId,
    hospitalId: hospitalAId,
    doctorId: doctor1Id,
    doctor: { name: 'Dr. Priya Sharma' },
  };

  await notifyAppointmentRescheduled(appointmentMock, '2026-11-05', '11:30');

  const reschedNotifs = await prisma.notification.findMany({
    where: { recipientId: patientAId, type: 'APPOINTMENT_RESCHEDULED' },
  });
  assert.ok(reschedNotifs.length >= 1);
  assert.ok(reschedNotifs[0].message.includes('2026-11-05 at 11:30'));
});

// =========================================================================
// SECTION 3: EMERGENCY NOTIFICATION ROUTING
// =========================================================================

test('3.1. Ambulance dispatch offer creates notification with strict 30s TTL expiry', async () => {
  const expiresAt = new Date(Date.now() + 30 * 1000);
  const result = await notifyDispatchOffer(
    driverAId,
    { id: 'attempt-test-101' },
    { id: 'req-emergency-101', requiredAmbulanceType: 'ADVANCED_LIFE_SUPPORT' },
    3.2,
    expiresAt
  );

  assert.equal(result.delivered, true);
  assert.equal(result.notification.recipientId, driverAId);
  assert.equal(result.notification.type, 'DISPATCH_OFFER');
  assert.equal(result.notification.priority, 'CRITICAL');
  assert.ok(result.notification.expiresAt);
  assert.equal(new Date(result.notification.expiresAt).getTime(), expiresAt.getTime());
});

test('3.2. Incoming ambulance alert notifies destination hospital with sanitized ER bay and triage level', async () => {
  const result = await notifyIncomingAmbulance(
    hospitalAId,
    'req-emergency-101',
    {
      vehicleNumber: 'MH-31-EM-9999',
      assignedBay: 'ER Trauma Bay 1',
      triageLevel: 'RED_CRITICAL',
      etaMinutes: 4,
      patientName: 'Rohan Sharma',
    }
  );

  assert.ok(result);
  assert.equal(result.delivered, true);
  assert.equal(result.notification.recipientId, hospitalAdminAId);
  assert.equal(result.notification.type, 'INCOMING_AMBULANCE_ALERT');
  assert.ok(result.notification.message.includes('ER Trauma Bay 1'));
  assert.ok(result.notification.message.includes('RED_CRITICAL'));
  // Ensure sensitive history wasn't forced into message
  assert.ok(!result.notification.message.includes('password'));
});

test('3.3. Patient dispatch-status update notifies patient of rig en route', async () => {
  const result = await notifyPatientDispatchStatus(
    patientAId,
    'req-emergency-101',
    'EN_ROUTE_TO_PICKUP',
    {
      vehicleNumber: 'MH-31-EM-9999',
      driverName: 'Vijay Verma',
      etaMinutes: 4,
    }
  );

  assert.equal(result.delivered, true);
  assert.equal(result.notification.recipientId, patientAId);
  assert.equal(result.notification.type, 'PATIENT_DISPATCH_STATUS');
  assert.ok(result.notification.message.includes('Vijay Verma'));
  assert.ok(result.notification.message.includes('4 minute(s)'));
});

// =========================================================================
// SECTION 4: DRIVER VERIFICATION & ORGANIZATION APPROVAL NOTIFICATIONS
// =========================================================================

test('4.1. Driver verification approval dispatches DRIVER_VERIFICATION_ALERT', async () => {
  const result = await notifyDriverVerification(driverAId, 'VERIFIED', 'All RTO documents verified');
  assert.equal(result.delivered, true);
  assert.equal(result.notification.recipientId, driverAId);
  assert.equal(result.notification.type, 'DRIVER_VERIFICATION_ALERT');
  assert.ok(result.notification.message.includes('verified'));
});

test('4.2. Driver credential expiry dispatches CREDENTIAL_EXPIRY_ALERT with daysRemaining', async () => {
  const expiryDate = new Date(Date.now() + 15 * 86400000);
  const result = await notifyDriverCredentialExpiry(driverAId, 'Commercial Driving License', expiryDate, 15);
  assert.equal(result.delivered, true);
  assert.equal(result.notification.type, 'CREDENTIAL_EXPIRY_ALERT');
  assert.ok(result.notification.message.includes('15 day(s)'));
});

test('4.3. Hospital approval notification dispatches ORGANIZATION_APPROVAL_ALERT to admin user', async () => {
  const result = await notifyOrganizationApproval('HOSPITAL', hospitalAId, 'VERIFIED');
  assert.ok(result);
  assert.equal(result.delivered, true);
  assert.equal(result.notification.recipientId, hospitalAdminAId);
  assert.equal(result.notification.type, 'ORGANIZATION_APPROVAL_ALERT');
  assert.ok(result.notification.message.includes('Nagpur Central Care Hospital'));
});

test('4.4. Operator approval notification dispatches ORGANIZATION_APPROVAL_ALERT to operator admin user', async () => {
  const result = await notifyOrganizationApproval('OPERATOR', operatorAId, 'VERIFIED');
  assert.ok(result);
  assert.equal(result.delivered, true);
  assert.equal(result.notification.recipientId, operatorAdminAId);
  assert.equal(result.notification.type, 'ORGANIZATION_APPROVAL_ALERT');
  assert.ok(result.notification.message.includes('Vidarbha Quick Emergency Services'));
});

test('4.5. Super Admin review alert routes strictly to super admin', async () => {
  const result = await notifySuperAdminReview('AMBULANCE', 'amb-test-99', 'Multiple consecutive missed offers');
  assert.ok(result);
  assert.equal(result.delivered, true);
  assert.equal(result.notification.recipientId, superAdminId);
  assert.equal(result.notification.type, 'SUPER_ADMIN_REVIEW_ALERT');
});

// =========================================================================
// SECTION 5: RELIABILITY, OUTBOX RETRIES & EXPIRY WORKERS
// =========================================================================

test('5.1. Immediate expiry: An already-expired dispatch offer is rejected with EXPIRED status', async () => {
  const pastDate = new Date(Date.now() - 5000);
  const result = await dispatchNotification({
    recipientId: driverAId,
    recipientRole: Role.DRIVER,
    title: 'Stale Offer',
    message: 'This offer was created already expired.',
    type: 'DISPATCH_OFFER',
    expiresAt: pastDate,
    idempotencyKey: 'stale-offer-test-99',
  });

  assert.equal(result.delivered, false);
  assert.equal(result.error, 'EXPIRED_BEFORE_DISPATCH');
  assert.equal(result.notification.status, NotificationStatus.EXPIRED);
});

test('5.2. Expiry worker marks obsolete offers as EXPIRED', async () => {
  // Manually create a PENDING dispatch offer with past expiry
  const pastOffer = await prisma.notification.create({
    data: {
      recipientId: driverAId,
      title: 'Pending Past Offer',
      message: 'Pending but past TTL',
      type: 'DISPATCH_OFFER',
      status: NotificationStatus.PENDING,
      expiresAt: new Date(Date.now() - 10000),
      idempotencyKey: 'pending-past-ttl-offer',
    },
  });

  const expiredCount = await expireObsoleteOffers();
  assert.ok(expiredCount >= 1);

  const updatedOffer = await prisma.notification.findUnique({
    where: { id: pastOffer.id },
  });
  assert.equal(updatedOffer?.status, NotificationStatus.EXPIRED);
});

test('5.3. Outbox retry worker retries PENDING notifications', async () => {
  // Create a pending notification
  const pendingNotif = await prisma.notification.create({
    data: {
      recipientId: patientAId,
      title: 'Pending Retry Test',
      message: 'Will be retried by worker',
      type: 'SYSTEM_ALERT',
      status: NotificationStatus.PENDING,
      retryCount: 0,
      maxRetries: 3,
      idempotencyKey: 'retry-test-notif-01',
    },
  });

  const retryResults = await processOutboxRetries();
  assert.ok(retryResults.retried >= 1);

  const checked = await prisma.notification.findUnique({
    where: { id: pendingNotif.id },
  });
  assert.equal(checked?.status, NotificationStatus.DELIVERED);
});

// =========================================================================
// SECTION 6: SOCKET.IO ROOM AUTHORIZATION & RECONNECTION RECOVERY
// =========================================================================

test('6.1. Unauthorized Doctor Room: Patient socket cannot subscribe to doctor:register', async () => {
  const patientSocket = new MockSocket('mock-patient-socket', {
    id: patientAId,
    role: Role.PATIENT,
    name: 'Rohan Sharma',
  });

  const connectionListeners = ioServer.listeners('connection');
  (connectionListeners[0] as any)(patientSocket);

  const errorPromise = new Promise<string>((resolve) => {
    patientSocket.on('error:unauthorized', (err: any) => resolve(err.message));
  });

  patientSocket.emit('doctor:register', doctor1Id);

  const msg = await Promise.race([
    errorPromise,
    new Promise<string>((_, reject) => setTimeout(() => reject(new Error('Timeout')), 2000)),
  ]);

  assert.ok(msg.includes('Forbidden') || msg.includes('not authorized'));
  assert.equal(patientSocket.rooms.has(`doctor:${doctor1Id}`), false);
});

test('6.2. Authorized Doctor Room: Hospital Admin A CAN subscribe to Doctor 1 (belongs to Hospital A)', async () => {
  const hospAdminSocket = new MockSocket('mock-hosp-admin-socket', {
    id: hospitalAdminAId,
    role: Role.ADMIN_HOSPITAL,
    name: 'Hosp Admin A',
  });

  const connectionListeners = ioServer.listeners('connection');
  (connectionListeners[0] as any)(hospAdminSocket);

  hospAdminSocket.emit('doctor:register', doctor1Id);

  // Allow next-tick processing of async doctor lookup
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(hospAdminSocket.rooms.has(`doctor:${doctor1Id}`), true);
});

test('6.3. Hospital Isolation: Hospital Admin B CANNOT subscribe to Doctor 1 (belongs to Hospital A)', async () => {
  const hospAdminBSocket = new MockSocket('mock-hosp-admin-b-socket', {
    id: hospitalAdminBId,
    role: Role.ADMIN_HOSPITAL,
    name: 'Hosp Admin B',
  });

  const connectionListeners = ioServer.listeners('connection');
  (connectionListeners[0] as any)(hospAdminBSocket);

  const errorPromise = new Promise<string>((resolve) => {
    hospAdminBSocket.on('error:unauthorized', (err: any) => resolve(err.message));
  });

  hospAdminBSocket.emit('doctor:register', doctor1Id);

  const msg = await Promise.race([
    errorPromise,
    new Promise<string>((_, reject) => setTimeout(() => reject(new Error('Timeout')), 2000)),
  ]);

  assert.ok(msg.includes('Forbidden') || msg.includes('not authorized'));
  assert.equal(hospAdminBSocket.rooms.has(`doctor:${doctor1Id}`), false);
});

test('6.4. Reconnection Recovery: notifications:sync returns unread notifications and unreadCount', async () => {
  const patientSocket = new MockSocket('mock-pat-reconnect', {
    id: patientAId,
    role: Role.PATIENT,
    name: 'Rohan Sharma',
  });

  const connectionListeners = ioServer.listeners('connection');
  (connectionListeners[0] as any)(patientSocket);

  const syncPromise = new Promise<any>((resolve) => {
    patientSocket.on('notifications:synced', (data: any) => resolve(data));
  });

  patientSocket.emit('notifications:sync');

  const syncData = await Promise.race([
    syncPromise,
    new Promise<any>((_, reject) => setTimeout(() => reject(new Error('Timeout')), 2000)),
  ]);

  assert.ok(syncData);
  assert.ok(Array.isArray(syncData.notifications));
  assert.ok(typeof syncData.unreadCount === 'number');
  assert.ok(syncData.unreadCount >= 1);
});

test('6.5. Socket notifications:mark_read updates unread count and persists isRead', async () => {
  const patientSocket = new MockSocket('mock-pat-mark-read', {
    id: patientAId,
    role: Role.PATIENT,
    name: 'Rohan Sharma',
  });

  const connectionListeners = ioServer.listeners('connection');
  (connectionListeners[0] as any)(patientSocket);

  // Allow initial connection unread_count event to complete
  await new Promise((r) => setTimeout(r, 50));

  const unreadPromise = new Promise<number>((resolve) => {
    patientSocket.on('notifications:unread_count', (data: any) => resolve(data.unreadCount));
  });

  patientSocket.emit('notifications:mark_read', { markAll: true });

  const unreadCount = await Promise.race([
    unreadPromise,
    new Promise<number>((_, reject) => setTimeout(() => reject(new Error('Timeout')), 2000)),
  ]);

  assert.equal(unreadCount, 0);

  // Verify all Patient A notifications are indeed read in DB
  const unreadInDb = await prisma.notification.count({
    where: { recipientId: patientAId, isRead: false },
  });
  assert.equal(unreadInDb, 0);
});

// =========================================================================
// SECTION 7: REST API ENDPOINTS & PERSISTENCE
// =========================================================================

let patientBNotifId: string;

test('7.1. GET /api/v1/notifications lists user notifications with pagination', async () => {
  // Create a fresh unread notification for Patient B
  const notifB = await prisma.notification.create({
    data: {
      recipientId: patientBId,
      title: 'Lab Report Available',
      message: 'Your diagnostic results are ready for download.',
      type: 'LAB_REPORT_ALERT',
      status: NotificationStatus.DELIVERED,
      isRead: false,
    },
  });
  patientBNotifId = notifB.id;

  const res = await fetch(`${baseUrl}/api/v1/notifications?limit=10`, {
    headers: { Authorization: `Bearer ${patientBToken}` },
  });

  assert.equal(res.status, 200);
  const data = (await res.json()) as any;
  assert.equal(data.status, 'success');
  assert.ok(data.data.notifications.length >= 1);
  assert.equal(data.data.unreadCount, 1);
  assert.equal(data.data.pagination.limit, 10);
});

test('7.2. PUT /api/v1/notifications/:id/read marks notification as read', async () => {
  const res = await fetch(`${baseUrl}/api/v1/notifications/${patientBNotifId}/read`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${patientBToken}` },
  });

  assert.equal(res.status, 200);
  const data = (await res.json()) as any;
  assert.equal(data.status, 'success');
  assert.equal(data.data.notification.isRead, true);

  // Check unread count is now 0
  const countRes = await fetch(`${baseUrl}/api/v1/notifications/unread-count`, {
    headers: { Authorization: `Bearer ${patientBToken}` },
  });
  const countData = (await countRes.json()) as any;
  assert.equal(countData.data.unreadCount, 0);
});

test('7.3. Cross-User Isolation: Patient A CANNOT modify Patient B notification', async () => {
  const res = await fetch(`${baseUrl}/api/v1/notifications/${patientBNotifId}/read`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${patientAToken}` }, // Patient A token
  });

  assert.equal(res.status, 403);
  const data = (await res.json()) as any;
  assert.ok(data.message.includes('Forbidden'));
});

test('7.4. Cross-User Isolation: Patient A CANNOT delete Patient B notification', async () => {
  const res = await fetch(`${baseUrl}/api/v1/notifications/${patientBNotifId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${patientAToken}` }, // Patient A token
  });

  assert.equal(res.status, 403);
});

test('7.5. DELETE /api/v1/notifications/:id removes notification for authorized owner', async () => {
  const res = await fetch(`${baseUrl}/api/v1/notifications/${patientBNotifId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${patientBToken}` }, // Patient B token
  });

  assert.equal(res.status, 200);

  const found = await prisma.notification.findUnique({
    where: { id: patientBNotifId },
  });
  assert.equal(found, null);
});

test('7.6. Trigger workers endpoint is protected: Normal users rejected, Super Admin accepted', async () => {
  const rejectRes = await fetch(`${baseUrl}/api/v1/notifications/trigger-workers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${patientAToken}` },
  });
  assert.equal(rejectRes.status, 403);

  const acceptRes = await fetch(`${baseUrl}/api/v1/notifications/trigger-workers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  assert.equal(acceptRes.status, 200);
  const data = (await acceptRes.json()) as any;
  assert.equal(data.status, 'success');
  assert.ok(data.data.retried !== undefined);
});

test('7.7. Persistence verification: Notifications remain persisted and readable in database', async () => {
  // Query all notifications stored in the DB
  const allNotifs = await prisma.notification.findMany();
  assert.ok(allNotifs.length >= 5, `Expected multiple notifications persisted in DB, found ${allNotifs.length}`);
  
  // Verify mandatory audit fields are present on all records
  for (const n of allNotifs) {
    assert.ok(n.id);
    assert.ok(n.recipientId);
    assert.ok(n.type);
    assert.ok(n.status);
    assert.ok(n.createdAt);
  }
});
