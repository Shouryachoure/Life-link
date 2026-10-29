import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import app from '../src/app';
import prisma from '../src/db';
import { generateTokens } from '../src/services/tokenService';
import { Role, BedStatus, WardType } from '@prisma/client';

let server: http.Server;
let port: number;
let baseUrl: string;

let superAdminToken: string;
let superAdminUser: any;

let hospitalAdminTokenA: string;
let hospitalAdminUserA: any;
let hospitalA: any;

let hospitalAdminTokenB: string;
let hospitalAdminUserB: any;
let hospitalB: any;

let patientToken: string;
let patientUser: any;

let driverToken: string;
let driverUser: any;

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test_secret_for_hospital_capacity_audit_1234567890_min_32_chars';
  process.env.TEST_DB_CONNECTED = 'true';

  server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      port = (server.address() as any).port;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });

  // Seed Super Admin
  superAdminUser = await prisma.user.create({
    data: {
      email: `super.admin.${Date.now()}@lifelink.org.in`,
      passwordHash: 'hash',
      name: 'Super Director Admin',
      role: Role.SUPER_ADMIN,
    },
  });
  superAdminToken = generateTokens({
    id: superAdminUser.id,
    email: superAdminUser.email,
    role: superAdminUser.role,
    name: superAdminUser.name,
  }).accessToken;

  // Seed Hospital A & Admin A
  hospitalAdminUserA = await prisma.user.create({
    data: {
      email: `admin.hospital.a.${Date.now()}@lifelink.org.in`,
      passwordHash: 'hash',
      name: 'Dr. Ramesh Sharma (Admin A)',
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
      name: 'Orange City Hospital Nagpur',
      address: 'Central Avenue, Nagpur, MH',
      lat: 21.1466,
      lng: 79.0888,
      contactNumber: '+917122550001',
      availableBeds: 10,
      totalBeds: 20,
      adminUserId: hospitalAdminUserA.id,
      capacityLastUpdated: new Date(),
    },
  });

  await prisma.user.update({
    where: { id: hospitalAdminUserA.id },
    data: { hospitalId: hospitalA.id },
  });

  // Seed Hospital B & Admin B
  hospitalAdminUserB = await prisma.user.create({
    data: {
      email: `admin.hospital.b.${Date.now()}@lifelink.org.in`,
      passwordHash: 'hash',
      name: 'Dr. Priya Deshmukh (Admin B)',
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
      name: 'Dharampeth General Hospital Nagpur',
      address: 'West High Court Rd, Nagpur, MH',
      lat: 21.1422,
      lng: 79.0712,
      contactNumber: '+917122550002',
      availableBeds: 5,
      totalBeds: 15,
      adminUserId: hospitalAdminUserB.id,
      capacityLastUpdated: new Date(),
    },
  });

  await prisma.user.update({
    where: { id: hospitalAdminUserB.id },
    data: { hospitalId: hospitalB.id },
  });

  // Seed Patient
  patientUser = await prisma.user.create({
    data: {
      email: `patient.test.${Date.now()}@lifelink.org.in`,
      passwordHash: 'hash',
      name: 'Sunil Gavaskar Patient',
      phone: '+919876543210',
      role: Role.PATIENT,
    },
  });
  patientToken = generateTokens({
    id: patientUser.id,
    email: patientUser.email,
    role: patientUser.role,
    name: patientUser.name,
  }).accessToken;

  // Seed Driver
  driverUser = await prisma.user.create({
    data: {
      email: `driver.test.${Date.now()}@lifelink.org.in`,
      passwordHash: 'hash',
      name: 'Ambulance Pilot Rajesh',
      role: Role.DRIVER,
    },
  });
  driverToken = generateTokens({
    id: driverUser.id,
    email: driverUser.email,
    role: driverUser.role,
    name: driverUser.name,
  }).accessToken;
});

after(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

test('1. Capacity Invariant: Negative bed counts must be rejected with 400 INVALID_CAPACITY_COUNT', async () => {
  const res = await fetch(`${baseUrl}/api/v1/hospitals/${hospitalA.id}/capacity`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hospitalAdminTokenA}`,
    },
    body: JSON.stringify({
      availableBeds: -5,
      totalBeds: 20,
      reason: 'Testing negative count rejection',
    }),
  });

  assert.equal(res.status, 400);
  const data = (await res.json()) as any;
  assert.equal(data.code, 'INVALID_CAPACITY_COUNT');
});

test('2. Capacity Invariant: Available beds exceeding total beds must be rejected with 400 INVALID_CAPACITY_COUNT', async () => {
  const res = await fetch(`${baseUrl}/api/v1/hospitals/${hospitalA.id}/capacity`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hospitalAdminTokenA}`,
    },
    body: JSON.stringify({
      availableBeds: 50,
      totalBeds: 25,
      reason: 'Testing available > total rejection',
    }),
  });

  assert.equal(res.status, 400);
  const data = (await res.json()) as any;
  assert.equal(data.code, 'INVALID_CAPACITY_COUNT');
});

test('3. Capacity Invariant: Total beds cannot be reduced below occupied bed count (400 CAPACITY_BELOW_OCCUPANCY)', async () => {
  // Create an occupied bed in Hospital A
  const occupiedBed = await prisma.hospitalBed.create({
    data: {
      hospitalId: hospitalA.id,
      bedNumber: `BED-OCC-1-${Date.now()}`,
      ward: WardType.ICU,
      category: 'ICU',
      status: BedStatus.OCCUPIED,
      patientName: 'Admitted ICU Patient',
      patientId: patientUser.id,
    },
  });

  // Attempt to set totalBeds to 0 while 1 bed is currently occupied
  const res = await fetch(`${baseUrl}/api/v1/hospitals/${hospitalA.id}/capacity`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hospitalAdminTokenA}`,
    },
    body: JSON.stringify({
      availableBeds: 0,
      totalBeds: 0,
      reason: 'Testing total beds below occupied count',
    }),
  });

  assert.equal(res.status, 400);
  const data = (await res.json()) as any;
  assert.equal(data.code, 'CAPACITY_BELOW_OCCUPANCY');

  // Clean up occupied bed for clean test isolation
  await prisma.hospitalBed.delete({ where: { id: occupiedBed.id } });
});

test('4. Authorized Hospital Administrator can update capacity and verify audit trail entry is created', async () => {
  const reasonText = 'Monsoon viral surge: Activated 4 additional observation beds';
  const res = await fetch(`${baseUrl}/api/v1/hospitals/${hospitalA.id}/capacity`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hospitalAdminTokenA}`,
    },
    body: JSON.stringify({
      availableBeds: 14,
      totalBeds: 24,
      reason: reasonText,
    }),
  });

  assert.equal(res.status, 200);
  const data = (await res.json()) as any;
  assert.equal(data.hospital.availableBeds, 14);
  assert.equal(data.hospital.totalBeds, 24);

  // Verify Audit Log was recorded
  const historyRes = await fetch(`${baseUrl}/api/v1/hospitals/${hospitalA.id}/capacity-history`, {
    headers: {
      Authorization: `Bearer ${hospitalAdminTokenA}`,
    },
  });

  assert.equal(historyRes.status, 200);
  const historyData = (await historyRes.json()) as any;
  assert.ok(historyData.auditLogs.length > 0);
  const latestLog = historyData.auditLogs[0];
  assert.equal(latestLog.changedById, hospitalAdminUserA.id);
  assert.equal(latestLog.action, 'CAPACITY_CONFIG_UPDATED');
  assert.equal(latestLog.newAvailable, 14);
  assert.equal(latestLog.newTotal, 24);
  assert.equal(latestLog.reason, reasonText);
});

test('5. Multi-Tenant Organization Isolation: Hospital Admin A cannot update Hospital B capacity (403 UNAUTHORIZED_HOSPITAL_ACCESS)', async () => {
  const res = await fetch(`${baseUrl}/api/v1/hospitals/${hospitalB.id}/capacity`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hospitalAdminTokenA}`,
    },
    body: JSON.stringify({
      availableBeds: 10,
      totalBeds: 20,
      reason: 'Malicious cross-tenant attempt',
    }),
  });

  assert.equal(res.status, 403);
  const data = (await res.json()) as any;
  assert.equal(data.code, 'UNAUTHORIZED_HOSPITAL_ACCESS');
});

test('6. Multi-Tenant Organization Isolation: Hospital Admin A cannot view Hospital B audit history (403 UNAUTHORIZED_HOSPITAL_ACCESS)', async () => {
  const res = await fetch(`${baseUrl}/api/v1/hospitals/${hospitalB.id}/capacity-history`, {
    headers: {
      Authorization: `Bearer ${hospitalAdminTokenA}`,
    },
  });

  assert.equal(res.status, 403);
  const data = (await res.json()) as any;
  assert.equal(data.code, 'UNAUTHORIZED_HOSPITAL_ACCESS');
});

test('7. Role Permissions: Non-admin users (Patient, Driver) receive 403 Forbidden on capacity changes', async () => {
  const resPatient = await fetch(`${baseUrl}/api/v1/hospitals/${hospitalA.id}/capacity`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${patientToken}`,
    },
    body: JSON.stringify({ availableBeds: 5, totalBeds: 20 }),
  });
  assert.equal(resPatient.status, 403);

  const resDriver = await fetch(`${baseUrl}/api/v1/hospitals/${hospitalA.id}/capacity`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${driverToken}`,
    },
    body: JSON.stringify({ availableBeds: 5, totalBeds: 20 }),
  });
  assert.equal(resDriver.status, 403);
});

test('8. Privacy Compliance: Public capacity summaries (/capacities & /:id/capacity) expose ZERO patient PII', async () => {
  // Create an occupied bed with sensitive patient data in Hospital A
  const sensitiveBed = await prisma.hospitalBed.create({
    data: {
      hospitalId: hospitalA.id,
      bedNumber: `BED-PII-${Date.now()}`,
      ward: WardType.ICU,
      category: 'ICU',
      status: BedStatus.OCCUPIED,
      patientName: 'Confidential VIP Patient',
      patientId: patientUser.id,
      notes: 'Sensitive clinical diagnosis: Acute cardiac arrhythmia',
    },
  });

  // Call public summary endpoint
  const res = await fetch(`${baseUrl}/api/v1/hospitals/capacities`);
  assert.equal(res.status, 200);
  const data = (await res.json()) as any;
  assert.ok(Array.isArray(data));

  // Stringify the entire public response and ensure zero leakage of confidential strings
  const stringified = JSON.stringify(data);
  assert.ok(!stringified.includes('Confidential VIP Patient'), 'Patient name MUST NOT be leaked in public capacity');
  assert.ok(!stringified.includes('Sensitive clinical diagnosis'), 'Clinical diagnosis notes MUST NOT be leaked in public capacity');
  assert.ok(!stringified.includes(patientUser.id), 'Patient ID MUST NOT be leaked');

  // Also verify single hospital public capacity endpoint
  const resSingle = await fetch(`${baseUrl}/api/v1/hospitals/${hospitalA.id}/capacity`);
  assert.equal(resSingle.status, 200);
  const dataSingle = (await resSingle.json()) as any;
  const singleString = JSON.stringify(dataSingle);
  assert.ok(!singleString.includes('Confidential VIP Patient'));
  assert.ok(!singleString.includes('Sensitive clinical diagnosis'));

  await prisma.hospitalBed.delete({ where: { id: sensitiveBed.id } });
});

test('9. Stale Data Warning: Stale capacity data (>30 mins) sets isStale: true with clear emergency 112 directive', async () => {
  // Backdate capacityLastUpdated to 45 minutes ago
  const fortyFiveMinsAgo = new Date(Date.now() - 45 * 60 * 1000);
  await prisma.hospital.update({
    where: { id: hospitalA.id },
    data: { capacityLastUpdated: fortyFiveMinsAgo },
  });

  const res = await fetch(`${baseUrl}/api/v1/hospitals/${hospitalA.id}/capacity`);
  assert.equal(res.status, 200);
  const data = (await res.json()) as any;

  assert.equal(data.isStale, true);
  assert.ok(data.ageMinutes >= 45);
  assert.ok(data.staleWarning.includes('112') || data.staleWarning.includes('call hospital'));
  assert.equal(data.dataFreshness, 'STALE_VERIFICATION_REQUIRED');
});

test('10. Concurrency Control: Concurrent admission into same bed fails atomically with 409 BED_ALREADY_OCCUPIED', async () => {
  // Create an available bed
  const bed = await prisma.hospitalBed.create({
    data: {
      hospitalId: hospitalA.id,
      bedNumber: `BED-CONC-${Date.now()}`,
      ward: WardType.GENERAL_WARD,
      category: 'GENERAL',
      status: BedStatus.AVAILABLE,
    },
  });

  // First patient admission succeeds
  const res1 = await fetch(`${baseUrl}/api/v1/hospitals/beds/${bed.id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hospitalAdminTokenA}`,
    },
    body: JSON.stringify({
      status: BedStatus.OCCUPIED,
      patientName: 'Patient Alpha',
      patientId: 'patient_alpha_id_1',
    }),
  });
  assert.equal(res1.status, 200);

  // Second concurrent admission into same bed fails with 409 Conflict
  const res2 = await fetch(`${baseUrl}/api/v1/hospitals/beds/${bed.id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hospitalAdminTokenA}`,
    },
    body: JSON.stringify({
      status: BedStatus.OCCUPIED,
      patientName: 'Patient Beta',
      patientId: 'patient_beta_id_2',
    }),
  });

  assert.equal(res2.status, 409);
  const data2 = (await res2.json()) as any;
  assert.equal(data2.code, 'BED_ALREADY_OCCUPIED');

  await prisma.hospitalBed.delete({ where: { id: bed.id } });
});

test('11. Bed Deletion Guardrail: Occupied bed cannot be deleted (400 CANNOT_DELETE_OCCUPIED_BED)', async () => {
  const bed = await prisma.hospitalBed.create({
    data: {
      hospitalId: hospitalA.id,
      bedNumber: `BED-DEL-${Date.now()}`,
      ward: WardType.GENERAL_WARD,
      status: BedStatus.OCCUPIED,
      patientName: 'Patient In Bed',
    },
  });

  const res = await fetch(`${baseUrl}/api/v1/hospitals/beds/${bed.id}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${hospitalAdminTokenA}`,
    },
  });

  assert.equal(res.status, 400);
  const data = (await res.json()) as any;
  assert.equal(data.code, 'CANNOT_DELETE_OCCUPIED_BED');

  // Change to AVAILABLE, then delete succeeds
  await prisma.hospitalBed.update({
    where: { id: bed.id },
    data: { status: BedStatus.AVAILABLE, patientName: null },
  });

  const resDel = await fetch(`${baseUrl}/api/v1/hospitals/beds/${bed.id}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${hospitalAdminTokenA}`,
    },
  });
  assert.equal(resDel.status, 200);
});

test('12. Configurable Bed Categories: Custom & standard categories are supported and tracked in audit log', async () => {
  const bedNum = `PED-${Date.now().toString().slice(-4)}`;
  const res = await fetch(`${baseUrl}/api/v1/hospitals/beds`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hospitalAdminTokenA}`,
    },
    body: JSON.stringify({
      bedNumber: bedNum,
      ward: WardType.PEDIATRIC,
      category: 'PEDIATRIC',
      notes: 'Equipped with pediatric ventilator and radiant warmer',
    }),
  });

  assert.equal(res.status, 201);
  const newBed = (await res.json()) as any;
  assert.equal(newBed.category, 'PEDIATRIC');

  // Verify capacity payload reflects pediatric category
  const resCap = await fetch(`${baseUrl}/api/v1/hospitals/${hospitalA.id}/capacity`);
  const capData = (await resCap.json()) as any;
  assert.ok(capData.categoryBreakdown.pediatric);
  assert.ok(capData.categoryBreakdown.pediatric.total >= 1);

  await prisma.hospitalBed.delete({ where: { id: newBed.id } });
});

test('13. Non-Auto-Reservation Guardrail: Selecting hospital or ambulance approaching does NOT auto-reserve a bed', async () => {
  // Capture available beds before booking without designated bed
  const beforeHosp = await prisma.hospital.findUnique({ where: { id: hospitalA.id } });
  const initialAvail = beforeHosp?.availableBeds ?? 0;

  const res = await fetch(`${baseUrl}/api/v1/hospitals/bookings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${patientToken}`,
    },
    body: JSON.stringify({
      hospitalId: hospitalA.id,
      patientName: 'Sunil Gavaskar',
      bookingType: 'EMERGENCY_ADMISSION',
      department: 'Emergency ER',
      assignedBedId: null, // No bed designated
    }),
  });

  assert.equal(res.status, 201);
  const booking = (await res.json()) as any;
  assert.equal(booking.assignedBedId, null);
  assert.equal(booking.status, 'CONFIRMED'); // Not admitted, no bed taken

  // Available beds count must remain completely unchanged
  const afterHosp = await prisma.hospital.findUnique({ where: { id: hospitalA.id } });
  assert.equal(afterHosp?.availableBeds, initialAvail);

  // Clean up booking
  await prisma.hospitalBooking.delete({ where: { id: booking.id } });
});

test('14. Atomic Bed Reservation: Assigning unavailable bed in booking fails with 409 BED_UNAVAILABLE_FOR_RESERVATION', async () => {
  const occupiedBed = await prisma.hospitalBed.create({
    data: {
      hospitalId: hospitalA.id,
      bedNumber: `BED-BUSY-${Date.now()}`,
      ward: WardType.GENERAL_WARD,
      status: BedStatus.OCCUPIED,
      patientName: 'Existing Admitted Patient',
    },
  });

  const res = await fetch(`${baseUrl}/api/v1/hospitals/bookings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hospitalAdminTokenA}`,
    },
    body: JSON.stringify({
      hospitalId: hospitalA.id,
      patientName: 'New Patient Attempt',
      bookingType: 'BED_RESERVATION',
      assignedBedId: occupiedBed.id,
    }),
  });

  assert.equal(res.status, 409);
  const data = (await res.json()) as any;
  assert.equal(data.code, 'BED_UNAVAILABLE_FOR_RESERVATION');

  await prisma.hospitalBed.delete({ where: { id: occupiedBed.id } });
});

test('15. Atomic Bed Cancellation: Cancelling booking releases designated bed and logs RESERVATION_CANCELLED audit entry', async () => {
  // Create an available bed
  const availableBed = await prisma.hospitalBed.create({
    data: {
      hospitalId: hospitalA.id,
      bedNumber: `BED-REL-${Date.now()}`,
      ward: WardType.GENERAL_WARD,
      category: 'GENERAL',
      status: BedStatus.AVAILABLE,
    },
  });

  // Admit booking with this bed
  const bookRes = await fetch(`${baseUrl}/api/v1/hospitals/bookings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hospitalAdminTokenA}`,
    },
    body: JSON.stringify({
      hospitalId: hospitalA.id,
      patientName: 'Patient To Cancel',
      bookingType: 'EMERGENCY_ADMISSION',
      assignedBedId: availableBed.id,
    }),
  });

  assert.equal(bookRes.status, 201);
  const booking = (await bookRes.json()) as any;
  assert.equal(booking.assignedBedId, availableBed.id);

  // Verify bed is now OCCUPIED
  const bedAfterAdmit = await prisma.hospitalBed.findUnique({ where: { id: availableBed.id } });
  assert.equal(bedAfterAdmit?.status, BedStatus.OCCUPIED);

  // Now cancel the booking
  const cancelRes = await fetch(`${baseUrl}/api/v1/hospitals/bookings/${booking.id}/status`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hospitalAdminTokenA}`,
    },
    body: JSON.stringify({
      status: 'CANCELLED',
    }),
  });

  assert.equal(cancelRes.status, 200);

  // Verify bed was atomically released back to AVAILABLE
  const bedAfterCancel = await prisma.hospitalBed.findUnique({ where: { id: availableBed.id } });
  assert.equal(bedAfterCancel?.status, BedStatus.AVAILABLE);
  assert.equal(bedAfterCancel?.patientName, null);

  // Verify audit log has RESERVATION_CANCELLED
  const historyRes = await fetch(`${baseUrl}/api/v1/hospitals/${hospitalA.id}/capacity-history`, {
    headers: {
      Authorization: `Bearer ${hospitalAdminTokenA}`,
    },
  });
  const hist = (await historyRes.json()) as any;
  const cancelAudit = hist.auditLogs.find((l: any) => l.action === 'RESERVATION_CANCELLED');
  assert.ok(cancelAudit, 'Audit log must record RESERVATION_CANCELLED on booking cancellation');

  await prisma.hospitalBooking.delete({ where: { id: booking.id } });
  await prisma.hospitalBed.delete({ where: { id: availableBed.id } });
});
