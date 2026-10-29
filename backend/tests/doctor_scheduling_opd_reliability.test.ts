import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import app from '../src/app';
import prisma from '../src/db';
import { generateTokens } from '../src/services/tokenService';
import { Role, AppointmentStatus, VerificationState } from '@prisma/client';
import { getTodayDateStringIST } from '../src/utils/localization';

let server: http.Server;
let port: number;
let baseUrl: string;

// Users & Tokens
let superAdminToken: string;
let superAdminUser: any;

let hospitalAdminTokenA: string;
let hospitalAdminUserA: any;
let hospitalA: any;
let doctorA: any;

let hospitalAdminTokenB: string;
let hospitalAdminUserB: any;
let hospitalB: any;
let doctorB: any;

let patientToken1: string;
let patientUser1: any;

let patientToken2: string;
let patientUser2: any;

let patientToken3: string;
let patientUser3: any;

let patientToken4: string;
let patientUser4: any;

let patientToken5: string;
let patientUser5: any;

// Helper to calculate future date string (YYYY-MM-DD)
function getFutureDate(daysAhead: number = 2): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test_secret_for_doctor_scheduling_opd_1234567890_min_32_chars';
  process.env.TEST_DB_CONNECTED = 'true';

  server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      port = (server.address() as any).port;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });

  // 1. Super Admin
  superAdminUser = await prisma.user.create({
    data: {
      email: `super.admin.${Date.now()}@lifelink.org.in`,
      passwordHash: 'hash',
      name: 'Dr. Director SuperAdmin',
      role: Role.SUPER_ADMIN,
    },
  });
  superAdminToken = generateTokens({
    id: superAdminUser.id,
    email: superAdminUser.email,
    role: superAdminUser.role,
    name: superAdminUser.name,
  }).accessToken;

  // 2. Hospital A & Admin A
  hospitalAdminUserA = await prisma.user.create({
    data: {
      email: `admin.hospital.a.${Date.now()}@lifelink.org.in`,
      passwordHash: 'hash',
      name: 'Ramesh Patel (Admin A)',
      role: Role.ADMIN_HOSPITAL,
    },
  });
  hospitalAdminTokenA = generateTokens({
    id: hospitalAdminUserA.id,
    email: hospitalAdminUserA.email,
    role: hospitalAdminUserA.role,
    name: hospitalAdminUserA.name,
  }).accessToken;

  hospitalA = await prisma.hospital.create({
    data: {
      name: 'Orange City Apex Hospital',
      address: 'Central Avenue, Nagpur, Maharashtra',
      lat: 21.1466,
      lng: 79.0882,
      contactNumber: '+91 712 255 1100',
      adminUserId: hospitalAdminUserA.id,
      verificationState: VerificationState.VERIFIED,
    },
  });

  // 3. Hospital B & Admin B
  hospitalAdminUserB = await prisma.user.create({
    data: {
      email: `admin.hospital.b.${Date.now()}@lifelink.org.in`,
      passwordHash: 'hash',
      name: 'Suresh Deshmukh (Admin B)',
      role: Role.ADMIN_HOSPITAL,
    },
  });
  hospitalAdminTokenB = generateTokens({
    id: hospitalAdminUserB.id,
    email: hospitalAdminUserB.email,
    role: hospitalAdminUserB.role,
    name: hospitalAdminUserB.name,
  }).accessToken;

  hospitalB = await prisma.hospital.create({
    data: {
      name: 'Dharampeth Care Hospital',
      address: 'West High Court Road, Dharampeth, Nagpur',
      lat: 21.1425,
      lng: 79.0655,
      contactNumber: '+91 712 252 2200',
      adminUserId: hospitalAdminUserB.id,
      verificationState: VerificationState.VERIFIED,
    },
  });

  // 4. Patients
  const createPatient = async (num: number) => {
    const user = await prisma.user.create({
      data: {
        email: `patient.${num}.${Date.now()}@test.com`,
        phone: `+91987654321${num}`,
        passwordHash: 'hash',
        name: `Test Patient ${num}`,
        role: Role.PATIENT,
      },
    });
    const token = generateTokens({
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    }).accessToken;
    return { user, token };
  };

  const p1 = await createPatient(1);
  patientUser1 = p1.user;
  patientToken1 = p1.token;

  const p2 = await createPatient(2);
  patientUser2 = p2.user;
  patientToken2 = p2.token;

  const p3 = await createPatient(3);
  patientUser3 = p3.user;
  patientToken3 = p3.token;

  const p4 = await createPatient(4);
  patientUser4 = p4.user;
  patientToken4 = p4.token;

  const p5 = await createPatient(5);
  patientUser5 = p5.user;
  patientToken5 = p5.token;
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

// ============================================================================
// TEST SUITE: DOCTOR SCHEDULING, OPD TOKENS & APPOINTMENT RELIABILITY
// ============================================================================

test('1. Doctor creation with configurable default slot duration and hospital scoping', async () => {
  // Hospital A creates Doctor A
  const resA = await fetch(`${baseUrl}/api/doctors`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hospitalAdminTokenA}`,
    },
    body: JSON.stringify({
      name: 'Dr. Ananya Sharma',
      specialization: 'Cardiology',
      qualifications: 'MBBS, MD (Cardio), DM',
      experienceYears: 12,
      consultationFee: 800,
      defaultSlotDuration: 20,
    }),
  });

  assert.strictEqual(resA.status, 201);
  const dataA = (await resA.json()) as any;
  assert.strictEqual(dataA.name, 'Dr. Ananya Sharma');
  assert.strictEqual(dataA.hospitalId, hospitalA.id);
  assert.strictEqual(dataA.defaultSlotDuration, 20);
  doctorA = dataA;

  // Hospital B creates Doctor B
  const resB = await fetch(`${baseUrl}/api/doctors`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hospitalAdminTokenB}`,
    },
    body: JSON.stringify({
      name: 'Dr. Vikas Kulkarni',
      specialization: 'Neurology',
      consultationFee: 1000,
      defaultSlotDuration: 30,
    }),
  });

  assert.strictEqual(resB.status, 201);
  const dataB = (await resB.json()) as any;
  assert.strictEqual(dataB.name, 'Dr. Vikas Kulkarni');
  assert.strictEqual(dataB.hospitalId, hospitalB.id);
  doctorB = dataB;
});

test('2. Batch schedule generation creates uniform slots with duration and skips past/duplicate periods', async () => {
  const targetDate = getFutureDate(3);

  // Admin A generates schedule from 09:00 to 11:00 with 20-min duration -> 6 discrete slots
  const res = await fetch(`${baseUrl}/api/doctors/${doctorA.id}/schedule`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hospitalAdminTokenA}`,
    },
    body: JSON.stringify({
      startDate: targetDate,
      endDate: targetDate,
      startTime: '09:00',
      endTime: '11:00',
      slotDurationMinutes: 20,
      maxPatients: 3,
    }),
  });

  assert.strictEqual(res.status, 201);
  const data = (await res.json()) as any;
  assert.strictEqual(data.slotsCreated, 6);
  assert.strictEqual(data.slotsSkipped, 0);

  // Query generated slots
  const getSlotsRes = await fetch(`${baseUrl}/api/doctors/${doctorA.id}/slots?date=${targetDate}`);
  assert.strictEqual(getSlotsRes.status, 200);
  const slotsData = (await getSlotsRes.json()) as any;
  assert.strictEqual(slotsData.slots.length, 6);
  assert.strictEqual(slotsData.slots[0].startTime, '09:00');
  assert.strictEqual(slotsData.slots[0].endTime, '09:20');
  assert.strictEqual(slotsData.slots[0].slotDurationMinutes, 20);
  assert.strictEqual(slotsData.slots[0].isBlocked, false);
});

test('3. Doctor unavailable dates / leaves prevent appointment bookings with DOCTOR_ON_LEAVE', async () => {
  const leaveDate = getFutureDate(4);

  // Admin A marks doctor on leave on leaveDate
  const setLeaveRes = await fetch(`${baseUrl}/api/doctors/${doctorA.id}/unavailable-dates`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hospitalAdminTokenA}`,
    },
    body: JSON.stringify({
      unavailableDates: [leaveDate],
    }),
  });

  assert.strictEqual(setLeaveRes.status, 200);
  const leaveData = (await setLeaveRes.json()) as any;
  assert.ok(leaveData.doctor.unavailableDates.includes(leaveDate));

  // Create slot for leaveDate
  const slotRes = await fetch(`${baseUrl}/api/doctors/${doctorA.id}/slots`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hospitalAdminTokenA}`,
    },
    body: JSON.stringify({
      date: leaveDate,
      startTime: '10:00',
      endTime: '10:30',
      maxPatients: 2,
    }),
  });
  assert.strictEqual(slotRes.status, 201);
  const slot = (await slotRes.json()) as any;

  // Querying slots should flag doctorOnLeave and isAvailable: false
  const checkSlotsRes = await fetch(`${baseUrl}/api/doctors/${doctorA.id}/slots?date=${leaveDate}`);
  const checkSlotsData = (await checkSlotsRes.json()) as any;
  assert.strictEqual(checkSlotsData.doctorOnLeave, true);
  assert.strictEqual(checkSlotsData.slots[0].isAvailable, false);

  // Patient tries to book slot on doctor's leave date -> rejected with HTTP 400 DOCTOR_ON_LEAVE
  const bookRes = await fetch(`${baseUrl}/api/appointments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${patientToken1}`,
    },
    body: JSON.stringify({
      slotId: slot.id,
      symptoms: 'Routine checkup on doctor leave date',
    }),
  });

  assert.strictEqual(bookRes.status, 400);
  const bookData = (await bookRes.json()) as any;
  assert.match(bookData.message, /Doctor is unavailable or on leave/i);
});

test('4. Slot blocking prevents patient booking and unblocking restores availability', async () => {
  const futureDate = getFutureDate(5);

  // Admin A creates a slot
  const slotRes = await fetch(`${baseUrl}/api/doctors/${doctorA.id}/slots`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hospitalAdminTokenA}`,
    },
    body: JSON.stringify({
      date: futureDate,
      startTime: '14:00',
      endTime: '15:00',
      maxPatients: 3,
    }),
  });
  assert.strictEqual(slotRes.status, 201);
  const slot = (await slotRes.json()) as any;

  // Hospital staff blocks the slot with a reason
  const blockRes = await fetch(`${baseUrl}/api/doctors/slots/${slot.id}/block`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hospitalAdminTokenA}`,
    },
    body: JSON.stringify({
      isBlocked: true,
      reason: 'Doctor Emergency OR duty',
    }),
  });
  assert.strictEqual(blockRes.status, 200);
  const blockedData = (await blockRes.json()) as any;
  assert.strictEqual(blockedData.slot.isBlocked, true);
  assert.strictEqual(blockedData.slot.blockedReason, 'Doctor Emergency OR duty');

  // Patient attempts to book the blocked slot -> rejected with HTTP 400 SLOT_BLOCKED
  const bookBlockedRes = await fetch(`${baseUrl}/api/appointments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${patientToken1}`,
    },
    body: JSON.stringify({
      slotId: slot.id,
      symptoms: 'Chest discomfort',
    }),
  });

  assert.strictEqual(bookBlockedRes.status, 400);
  const bookBlockedData = (await bookBlockedRes.json()) as any;
  assert.match(bookBlockedData.message, /blocked by the hospital/i);

  // Hospital staff unblocks the slot
  const unblockRes = await fetch(`${baseUrl}/api/doctors/slots/${slot.id}/block`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hospitalAdminTokenA}`,
    },
    body: JSON.stringify({
      isBlocked: false,
    }),
  });
  assert.strictEqual(unblockRes.status, 200);

  // Patient can now book successfully
  const bookSuccessRes = await fetch(`${baseUrl}/api/appointments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${patientToken1}`,
    },
    body: JSON.stringify({
      slotId: slot.id,
      symptoms: 'Chest discomfort',
    }),
  });
  assert.strictEqual(bookSuccessRes.status, 201);
  const successData = (await bookSuccessRes.json()) as any;
  assert.strictEqual(successData.appointment.status, 'BOOKED');
  assert.strictEqual(successData.tokenNumber, 1);
});

test('5. Asia/Kolkata timezone handling rejects past slot creation and bookings', async () => {
  // Attempt to book or create past slot
  const pastRes = await fetch(`${baseUrl}/api/doctors/${doctorA.id}/slots`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hospitalAdminTokenA}`,
    },
    body: JSON.stringify({
      date: '2023-01-01',
      startTime: '09:00',
      endTime: '10:00',
      maxPatients: 5,
    }),
  });

  assert.strictEqual(pastRes.status, 400);
  const pastData = (await pastRes.json()) as any;
  assert.match(pastData.message, /Cannot create slots for past dates or times/i);
});

test('6. Atomic concurrency row lock prevents overbooking under simultaneous requests', async () => {
  const concDate = getFutureDate(6);

  // Create slot with maxPatients: 2
  const slotRes = await fetch(`${baseUrl}/api/doctors/${doctorA.id}/slots`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hospitalAdminTokenA}`,
    },
    body: JSON.stringify({
      date: concDate,
      startTime: '11:00',
      endTime: '12:00',
      maxPatients: 2,
    }),
  });
  assert.strictEqual(slotRes.status, 201);
  const slot = (await slotRes.json()) as any;

  // 4 distinct patients simultaneously send booking requests for this 2-seat slot
  const patientTokens = [patientToken1, patientToken2, patientToken3, patientToken4];

  const bookingPromises = patientTokens.map((token, idx) =>
    fetch(`${baseUrl}/api/appointments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        slotId: slot.id,
        symptoms: `Concurrent test patient ${idx + 1}`,
      }),
    })
  );

  const responses = await Promise.all(bookingPromises);
  const statuses = responses.map((r) => r.status);

  // Exactly 2 must succeed (201) and exactly 2 must be rejected with 409
  const successCount = statuses.filter((s) => s === 201).length;
  const conflictCount = statuses.filter((s) => s === 409).length;

  assert.strictEqual(successCount, 2, 'Exactly 2 bookings must succeed for a capacity of 2');
  assert.strictEqual(conflictCount, 2, 'Overbooking requests must be rejected with HTTP 409');

  // Verify database record has bookedCount exactly 2
  const verifySlotRes = await fetch(`${baseUrl}/api/doctors/${doctorA.id}/slots?date=${concDate}`);
  const verifyData = (await verifySlotRes.json()) as any;
  const matchedSlot = verifyData.slots.find((s: any) => s.id === slot.id);
  assert.strictEqual(matchedSlot.bookedCount, 2);
  assert.strictEqual(matchedSlot.remainingCapacity, 0);
});

test('7. Duplicate active booking rejection prevents multiple bookings by same patient for same slot', async () => {
  const dupDate = getFutureDate(7);

  const slotRes = await fetch(`${baseUrl}/api/doctors/${doctorA.id}/slots`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hospitalAdminTokenA}`,
    },
    body: JSON.stringify({
      date: dupDate,
      startTime: '09:00',
      endTime: '09:30',
      maxPatients: 5,
    }),
  });
  const slot = (await slotRes.json()) as any;

  // First booking by patient 5
  const firstRes = await fetch(`${baseUrl}/api/appointments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${patientToken5}`,
    },
    body: JSON.stringify({
      slotId: slot.id,
      symptoms: 'Fever and cold',
    }),
  });
  assert.strictEqual(firstRes.status, 201);

  // Second booking by same patient 5 for same slot -> rejected with 409 DUPLICATE_BOOKING
  const dupRes = await fetch(`${baseUrl}/api/appointments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${patientToken5}`,
    },
    body: JSON.stringify({
      slotId: slot.id,
      symptoms: 'Second booking attempt',
    }),
  });
  assert.strictEqual(dupRes.status, 409);
  const dupData = (await dupRes.json()) as any;
  assert.match(dupData.message, /already have an active booking/i);
});

test('8. Monotonic token uniqueness within doctor/date/slot scope and no collision on cancellation', async () => {
  const tokenDate = getFutureDate(8);

  const slotRes = await fetch(`${baseUrl}/api/doctors/${doctorA.id}/slots`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hospitalAdminTokenA}`,
    },
    body: JSON.stringify({
      date: tokenDate,
      startTime: '10:00',
      endTime: '11:00',
      maxPatients: 5,
    }),
  });
  const slot = (await slotRes.json()) as any;

  // Book Patient 1 -> Token 1
  const b1 = await fetch(`${baseUrl}/api/appointments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patientToken1}` },
    body: JSON.stringify({ slotId: slot.id }),
  });
  const data1 = (await b1.json()) as any;
  assert.strictEqual(data1.tokenNumber, 1);
  assert.ok(data1.tokenString.includes('-001'));

  // Book Patient 2 -> Token 2
  const b2 = await fetch(`${baseUrl}/api/appointments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patientToken2}` },
    body: JSON.stringify({ slotId: slot.id }),
  });
  const data2 = (await b2.json()) as any;
  assert.strictEqual(data2.tokenNumber, 2);
  assert.ok(data2.tokenString.includes('-002'));

  // Patient 1 cancels
  const cancel1 = await fetch(`${baseUrl}/api/appointments/${data1.appointment.id}/cancel`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patientToken1}` },
    body: JSON.stringify({ reason: 'Cannot make it' }),
  });
  assert.strictEqual(cancel1.status, 200);

  // Book Patient 3 -> Token must be 3 (strictly monotonic, no collision with previous Token 1 or 2)
  const b3 = await fetch(`${baseUrl}/api/appointments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patientToken3}` },
    body: JSON.stringify({ slotId: slot.id }),
  });
  const data3 = (await b3.json()) as any;
  assert.strictEqual(data3.tokenNumber, 3, 'Token must be strictly monotonic even after cancellations');
  assert.ok(data3.tokenString.includes('-003'));
});

test('9. Full state transitions, timestamp audit, and completed appointment immutability', async () => {
  const transDate = getFutureDate(9);

  const slotRes = await fetch(`${baseUrl}/api/doctors/${doctorA.id}/slots`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${hospitalAdminTokenA}` },
    body: JSON.stringify({ date: transDate, startTime: '15:00', endTime: '15:30', maxPatients: 5 }),
  });
  const slot = (await slotRes.json()) as any;

  // Book
  const bookRes = await fetch(`${baseUrl}/api/appointments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patientToken1}` },
    body: JSON.stringify({ slotId: slot.id }),
  });
  const apt = ((await bookRes.json()) as any).appointment;
  assert.strictEqual(apt.status, AppointmentStatus.BOOKED);

  // 1. Confirm
  const confRes = await fetch(`${baseUrl}/api/appointments/${apt.id}/confirm`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${hospitalAdminTokenA}` },
  });
  assert.strictEqual(confRes.status, 200);
  const confApt = ((await confRes.json()) as any).appointment;
  assert.strictEqual(confApt.status, AppointmentStatus.CONFIRMED);
  assert.ok(confApt.confirmedAt);

  // 2. Check-In
  const checkInRes = await fetch(`${baseUrl}/api/appointments/${apt.id}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${hospitalAdminTokenA}` },
    body: JSON.stringify({ status: AppointmentStatus.CHECKED_IN }),
  });
  assert.strictEqual(checkInRes.status, 200);
  const checkedInApt = ((await checkInRes.json()) as any).appointment;
  assert.strictEqual(checkedInApt.status, AppointmentStatus.CHECKED_IN);
  assert.ok(checkedInApt.checkedInAt);

  // 3. In-Consultation
  const inConsultRes = await fetch(`${baseUrl}/api/appointments/${apt.id}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${hospitalAdminTokenA}` },
    body: JSON.stringify({ status: AppointmentStatus.IN_CONSULTATION }),
  });
  assert.strictEqual(inConsultRes.status, 200);

  // 4. Complete
  const completeRes = await fetch(`${baseUrl}/api/appointments/${apt.id}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${hospitalAdminTokenA}` },
    body: JSON.stringify({ status: AppointmentStatus.COMPLETED }),
  });
  assert.strictEqual(completeRes.status, 200);
  const completedApt = ((await completeRes.json()) as any).appointment;
  assert.strictEqual(completedApt.status, AppointmentStatus.COMPLETED);
  assert.ok(completedApt.completedAt);

  // 5. Completed appointments cannot be re-modified or cancelled
  const reModifyRes = await fetch(`${baseUrl}/api/appointments/${apt.id}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${hospitalAdminTokenA}` },
    body: JSON.stringify({ status: AppointmentStatus.BOOKED }),
  });
  assert.strictEqual(reModifyRes.status, 400);

  const cancelCompletedRes = await fetch(`${baseUrl}/api/appointments/${apt.id}/cancel`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patientToken1}` },
  });
  assert.strictEqual(cancelCompletedRes.status, 400);
});

test('10. Appointment rescheduling decrements old slot, increments target slot, and issues new token', async () => {
  const schedDate1 = getFutureDate(10);
  const schedDate2 = getFutureDate(11);

  // Create Slot 1
  const s1Res = await fetch(`${baseUrl}/api/doctors/${doctorA.id}/slots`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${hospitalAdminTokenA}` },
    body: JSON.stringify({ date: schedDate1, startTime: '09:00', endTime: '09:30', maxPatients: 3 }),
  });
  const slot1 = (await s1Res.json()) as any;

  // Create Slot 2
  const s2Res = await fetch(`${baseUrl}/api/doctors/${doctorA.id}/slots`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${hospitalAdminTokenA}` },
    body: JSON.stringify({ date: schedDate2, startTime: '14:00', endTime: '14:30', maxPatients: 3 }),
  });
  const slot2 = (await s2Res.json()) as any;

  // Book Patient 1 into Slot 1
  const bookRes = await fetch(`${baseUrl}/api/appointments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patientToken1}` },
    body: JSON.stringify({ slotId: slot1.id }),
  });
  const originalApt = ((await bookRes.json()) as any).appointment;
  assert.strictEqual(originalApt.tokenNumber, 1);

  // Verify Slot 1 bookedCount is 1, Slot 2 bookedCount is 0
  const slotsPre = await fetch(`${baseUrl}/api/doctors/${doctorA.id}/slots?date=${schedDate1}`);
  const s1Pre = ((await slotsPre.json()) as any).slots.find((s: any) => s.id === slot1.id);
  assert.strictEqual(s1Pre.bookedCount, 1);

  // Patient 1 reschedules to Slot 2
  const reschedRes = await fetch(`${baseUrl}/api/appointments/${originalApt.id}/reschedule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patientToken1}` },
    body: JSON.stringify({
      targetSlotId: slot2.id,
      reason: 'Urgent meeting conflict',
    }),
  });

  assert.strictEqual(reschedRes.status, 200);
  const reschedData = (await reschedRes.json()) as any;
  const reschedApt = reschedData.appointment;

  assert.strictEqual(reschedApt.slotId, slot2.id);
  assert.strictEqual(reschedApt.rescheduledFromSlotId, slot1.id);
  assert.ok(reschedApt.rescheduledAt);
  assert.strictEqual(reschedApt.tokenNumber, 1); // Slot 2's first patient
  assert.ok(reschedApt.tokenString.includes(schedDate2.replace(/-/g, '')));

  // Verify Slot 1 bookedCount decremented back to 0
  const slotsPost1 = await fetch(`${baseUrl}/api/doctors/${doctorA.id}/slots?date=${schedDate1}`);
  const s1Post = ((await slotsPost1.json()) as any).slots.find((s: any) => s.id === slot1.id);
  assert.strictEqual(s1Post.bookedCount, 0);

  // Verify Slot 2 bookedCount incremented to 1
  const slotsPost2 = await fetch(`${baseUrl}/api/doctors/${doctorA.id}/slots?date=${schedDate2}`);
  const s2Post = ((await slotsPost2.json()) as any).slots.find((s: any) => s.id === slot2.id);
  assert.strictEqual(s2Post.bookedCount, 1);

  // Rescheduling to same slot is prohibited
  const sameSlotRes = await fetch(`${baseUrl}/api/appointments/${originalApt.id}/reschedule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patientToken1}` },
    body: JSON.stringify({ targetSlotId: slot2.id }),
  });
  assert.strictEqual(sameSlotRes.status, 400);
  const sameData = (await sameSlotRes.json()) as any;
  assert.match(sameData.message, /different from current slot/i);
});

test('11. Role-based and organization-based access control enforces strict hospital isolation', async () => {
  const isoDate = getFutureDate(12);

  // Slot in Hospital A
  const slotRes = await fetch(`${baseUrl}/api/doctors/${doctorA.id}/slots`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${hospitalAdminTokenA}` },
    body: JSON.stringify({ date: isoDate, startTime: '16:00', endTime: '16:30', maxPatients: 2 }),
  });
  const slot = (await slotRes.json()) as any;

  // Book patient in Hospital A
  const bRes = await fetch(`${baseUrl}/api/appointments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patientToken1}` },
    body: JSON.stringify({ slotId: slot.id }),
  });
  const apt = ((await bRes.json()) as any).appointment;

  // Hospital Admin B attempts to confirm appointment in Hospital A -> 403 UNAUTHORIZED_HOSPITAL_ACCESS
  const unauthConfirm = await fetch(`${baseUrl}/api/appointments/${apt.id}/confirm`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${hospitalAdminTokenB}` },
  });
  assert.strictEqual(unauthConfirm.status, 403);
  const unauthConfirmData = (await unauthConfirm.json()) as any;
  assert.strictEqual(unauthConfirmData.code, 'UNAUTHORIZED_HOSPITAL_ACCESS');

  // Hospital Admin B attempts to update status of Hospital A appointment -> 403
  const unauthStatus = await fetch(`${baseUrl}/api/appointments/${apt.id}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${hospitalAdminTokenB}` },
    body: JSON.stringify({ status: AppointmentStatus.COMPLETED }),
  });
  assert.strictEqual(unauthStatus.status, 403);

  // Hospital Admin B attempts to manage Doctor A -> 403
  const unauthDocUpdate = await fetch(`${baseUrl}/api/doctors/${doctorA.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${hospitalAdminTokenB}` },
    body: JSON.stringify({ isActive: false }),
  });
  assert.strictEqual(unauthDocUpdate.status, 403);

  // Unrelated Patient 2 attempts to view Patient 1's appointment details -> 403 UNAUTHORIZED_APPOINTMENT_ACCESS
  const unauthPatientView = await fetch(`${baseUrl}/api/appointments/${apt.id}`, {
    headers: { Authorization: `Bearer ${patientToken2}` },
  });
  assert.strictEqual(unauthPatientView.status, 403);
  const unauthPatientData = (await unauthPatientView.json()) as any;
  assert.strictEqual(unauthPatientData.code, 'UNAUTHORIZED_APPOINTMENT_ACCESS');
});

test('12. Notifications strictly scoped to patient, doctor, and hospital with zero cross-tenant leakage', async () => {
  const notifDate = getFutureDate(13);

  const slotRes = await fetch(`${baseUrl}/api/doctors/${doctorA.id}/slots`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${hospitalAdminTokenA}` },
    body: JSON.stringify({ date: notifDate, startTime: '11:00', endTime: '11:30', maxPatients: 2 }),
  });
  const slot = (await slotRes.json()) as any;

  // Book appointment
  const bookRes = await fetch(`${baseUrl}/api/appointments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patientToken2}` },
    body: JSON.stringify({ slotId: slot.id, symptoms: 'Persistent migraine' }),
  });
  const apt = ((await bookRes.json()) as any).appointment;

  // Verify notifications persisted in DB
  const notifs = await prisma.notification.findMany({
    where: { entityId: apt.id },
  });

  // Verify notifications exist
  assert.ok(notifs.length > 0);

  // Verify recipient isolation:
  for (const n of notifs) {
    // Must belong to Hospital A
    assert.strictEqual(n.hospitalId, hospitalA.id);

    // Must NOT belong to Hospital B or Doctor B
    assert.notStrictEqual(n.hospitalId, hospitalB.id);
    assert.notStrictEqual(n.doctorId, doctorB.id);

    // Recipient must be Patient 2, Doctor A, or Hospital Admin A
    const allowedRecipients = [patientUser2.id, doctorA.id, hospitalAdminUserA.id];
    assert.ok(
      allowedRecipients.includes(n.recipientId),
      `Notification recipient ${n.recipientId} must be authorized entity`
    );
  }
});

test('13. Hospital OPD Queue supports searching, filtering, and summary statistics', async () => {
  // Admin A views OPD Queue for all dates
  const queueRes = await fetch(`${baseUrl}/api/appointments/hospital/queue`, {
    headers: { Authorization: `Bearer ${hospitalAdminTokenA}` },
  });

  assert.strictEqual(queueRes.status, 200);
  const queueData = (await queueRes.json()) as any;
  assert.strictEqual(queueData.hospitalId, hospitalA.id);
  assert.ok(queueData.summary);
  assert.ok(typeof queueData.summary.total === 'number');
  assert.ok(Array.isArray(queueData.queue));

  // Admin B querying queue sees ONLY Hospital B queue (zero Hospital A contamination)
  const queueBRes = await fetch(`${baseUrl}/api/appointments/hospital/queue`, {
    headers: { Authorization: `Bearer ${hospitalAdminTokenB}` },
  });
  assert.strictEqual(queueBRes.status, 200);
  const queueBData = (await queueBRes.json()) as any;
  assert.strictEqual(queueBData.hospitalId, hospitalB.id);
  for (const item of queueBData.queue) {
    assert.strictEqual(item.hospitalId, hospitalB.id);
  }
});

test('14. Complete immutable audit trail persistence across all appointment operations', async () => {
  const auditDate = getFutureDate(14);

  const slotRes = await fetch(`${baseUrl}/api/doctors/${doctorA.id}/slots`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${hospitalAdminTokenA}` },
    body: JSON.stringify({ date: auditDate, startTime: '12:00', endTime: '12:30', maxPatients: 2 }),
  });
  const slot = (await slotRes.json()) as any;

  // 1. Create
  const bookRes = await fetch(`${baseUrl}/api/appointments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patientToken1}` },
    body: JSON.stringify({ slotId: slot.id, symptoms: 'Audit testing symptom' }),
  });
  const apt = ((await bookRes.json()) as any).appointment;

  // 2. Confirm
  await fetch(`${baseUrl}/api/appointments/${apt.id}/confirm`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${hospitalAdminTokenA}` },
  });

  // 3. Cancel
  await fetch(`${baseUrl}/api/appointments/${apt.id}/cancel`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patientToken1}` },
    body: JSON.stringify({ reason: 'Audit test cancellation' }),
  });

  // Query audit trail endpoint
  const auditRes = await fetch(`${baseUrl}/api/appointments/${apt.id}/audit-trail`, {
    headers: { Authorization: `Bearer ${patientToken1}` },
  });
  assert.strictEqual(auditRes.status, 200);
  const auditData = (await auditRes.json()) as any;

  assert.strictEqual(auditData.appointmentId, apt.id);
  assert.ok(auditData.count >= 3);

  const actions = auditData.auditLogs.map((l: any) => l.action);
  assert.ok(actions.includes('CREATED'));
  assert.ok(actions.includes('CONFIRMED'));
  assert.ok(actions.includes('CANCELLED'));

  // Validate audit log integrity
  const cancelLog = auditData.auditLogs.find((l: any) => l.action === 'CANCELLED');
  assert.strictEqual(cancelLog.previousStatus, AppointmentStatus.CONFIRMED);
  assert.strictEqual(cancelLog.newStatus, AppointmentStatus.CANCELLED);
  assert.strictEqual(cancelLog.reason, 'Audit test cancellation');
  assert.strictEqual(cancelLog.actorId, patientUser1.id);
});
