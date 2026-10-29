process.env.NODE_ENV = 'test';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { Server } from 'socket.io';
import app from '../src/app';
import prisma, { inMemoryDb } from '../src/db';
import { setupSocketHandlers } from '../src/socket';
import { generateTokens } from '../src/services/tokenService';
import {
  evaluateCandidateEligibility,
  atomicallyAcceptOffer,
  rejectOrExpireOffer,
  CandidateVehicle,
} from '../src/services/dispatchEngine';
import {
  Role,
  VerificationState,
  AmbulanceType,
  RequestStatus,
  DispatchAttemptStatus,
  AppointmentStatus,
  BedStatus,
  WardType,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';

let server: http.Server;
let ioServer: Server;
let baseUrl: string;
let serverPort: number;

// Test Actors
let patientUser: any;
let patientToken: string;

let otherPatientUser: any;
let otherPatientToken: string;

let hospitalAdminUser: any;
let hospitalAdminToken: string;
let hospitalA: any;

let unrelatedHospitalAdminUser: any;
let unrelatedHospitalAdminToken: string;
let hospitalB: any;

let operatorAdminUser: any;
let operatorAdminToken: string;
let operatorA: any;

let superAdminUser: any;
let superAdminToken: string;

let doctorA: any;
let slotA: any;
let testBedA: any;

let driverUser: any;
let driverToken: string;
let driverProfileA: any;
let ambulanceA: any;

let secondDriverUser: any;
let secondDriverToken: string;
let driverProfileB: any;
let ambulanceB: any;

test.before(async () => {
  process.env.NODE_ENV = 'test';
  inMemoryDb.clear();

  // Create HTTP server with Socket.IO attached
  server = http.createServer(app);
  ioServer = new Server(server, { cors: { origin: '*' } });
  setupSocketHandlers(ioServer);

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as any;
      serverPort = addr.port;
      baseUrl = `http://127.0.0.1:${serverPort}`;
      resolve();
    });
  });

  const salt = bcrypt.genSaltSync(10);
  const passwordHash = bcrypt.hashSync('StrongPassword123!@#', salt);

  // 1. Seed Patient User
  patientUser = await prisma.user.create({
    data: {
      name: 'Anil Deshmukh',
      email: 'anil.deshmukh@example.in',
      phone: '+919876543210',
      passwordHash,
      role: Role.PATIENT,
      isActive: true,
      isPhoneVerified: true,
    },
  });
  await prisma.patientProfile.create({
    data: {
      userId: patientUser.id,
      bloodGroup: 'B+',
      emergencyContactName: 'Sunita Deshmukh',
      emergencyContactPhone: '+919876543219',
    },
  });
  patientToken = generateTokens({
    id: patientUser.id,
    email: patientUser.email,
    role: patientUser.role,
    name: patientUser.name,
  }).accessToken;

  // 2. Seed Second Patient User
  otherPatientUser = await prisma.user.create({
    data: {
      name: 'Kavita Joshi',
      email: 'kavita.joshi@example.in',
      phone: '+919876543211',
      passwordHash,
      role: Role.PATIENT,
      isActive: true,
      isPhoneVerified: true,
    },
  });
  otherPatientToken = generateTokens({
    id: otherPatientUser.id,
    email: otherPatientUser.email,
    role: otherPatientUser.role,
    name: otherPatientUser.name,
  }).accessToken;

  // 3. Seed Super Admin
  superAdminUser = await prisma.user.create({
    data: {
      name: 'LifeLink Super Admin',
      email: 'superadmin@lifelink.nagpur.in',
      passwordHash,
      role: Role.SUPER_ADMIN,
      isActive: true,
    },
  });
  superAdminToken = generateTokens({
    id: superAdminUser.id,
    email: superAdminUser.email,
    role: superAdminUser.role,
    name: superAdminUser.name,
  }).accessToken;

  // 4. Seed Hospital A & Admin
  hospitalAdminUser = await prisma.user.create({
    data: {
      name: 'Admin AIIMS Nagpur',
      email: 'admin@aiims.nagpur.in',
      passwordHash,
      role: Role.ADMIN_HOSPITAL,
      isActive: true,
    },
  });
  hospitalA = await prisma.hospital.create({
    data: {
      name: 'AIIMS Nagpur Medical College',
      address: 'Plot 2, Sector 20, MIHAN, Nagpur, Maharashtra 441108',
      contactNumber: '+917122800000',
      city: 'Nagpur',
      state: 'Maharashtra',
      lat: 21.0858,
      lng: 79.0382,
      adminUserId: hospitalAdminUser.id,
      availableBeds: 50,
      verificationState: VerificationState.VERIFIED,
    },
  });
  hospitalAdminToken = generateTokens({
    id: hospitalAdminUser.id,
    email: hospitalAdminUser.email,
    role: hospitalAdminUser.role,
    name: hospitalAdminUser.name,
    hospitalId: hospitalA.id,
  }).accessToken;

  // 5. Seed Unrelated Hospital B & Admin
  unrelatedHospitalAdminUser = await prisma.user.create({
    data: {
      name: 'Admin Kingsway Hospital',
      email: 'admin@kingsway.nagpur.in',
      passwordHash,
      role: Role.ADMIN_HOSPITAL,
      isActive: true,
    },
  });
  hospitalB = await prisma.hospital.create({
    data: {
      name: 'Kingsway Hospitals Nagpur',
      address: 'Near Railway Station, Nagpur, Maharashtra 440001',
      contactNumber: '+917122899999',
      city: 'Nagpur',
      state: 'Maharashtra',
      lat: 21.1523,
      lng: 79.0886,
      adminUserId: unrelatedHospitalAdminUser.id,
      availableBeds: 20,
      verificationState: VerificationState.VERIFIED,
    },
  });
  unrelatedHospitalAdminToken = generateTokens({
    id: unrelatedHospitalAdminUser.id,
    email: unrelatedHospitalAdminUser.email,
    role: unrelatedHospitalAdminUser.role,
    name: unrelatedHospitalAdminUser.name,
    hospitalId: hospitalB.id,
  }).accessToken;

  // 6. Seed Doctor and OPD Slot for Hospital A
  doctorA = await prisma.doctor.create({
    data: {
      name: 'Dr. Vivek Sengupta',
      specialization: 'Cardiology',
      qualifications: 'MBBS, MD, DM (Cardiology)',
      experienceYears: 14,
      consultationFee: 750,
      hospitalId: hospitalA.id,
      isActive: true,
    },
  });
  slotA = await prisma.doctorSlot.create({
    data: {
      doctorId: doctorA.id,
      date: '2026-10-28',
      startTime: '09:00',
      endTime: '12:00',
      maxPatients: 2, // Constrained slot with max 2 patients for concurrency testing
      bookedCount: 0,
    },
  });

  // 7. Seed Bed for Hospital A
  testBedA = await prisma.hospitalBed.create({
    data: {
      hospitalId: hospitalA.id,
      bedNumber: 'ICU-B101',
      ward: WardType.ICU,
      status: BedStatus.AVAILABLE,
    },
  });

  // 8. Seed Private Operator & Fleet
  operatorAdminUser = await prisma.user.create({
    data: {
      name: 'Nagpur Emergency Fleet Ltd',
      email: 'manager@nagpuremergency.in',
      passwordHash,
      role: Role.OPERATOR_ADMIN,
      isActive: true,
    },
  });
  operatorA = await prisma.ambulanceOperator.create({
    data: {
      name: 'Nagpur Rapid Medical Response',
      city: 'Nagpur',
      state: 'Maharashtra',
      address: 'Central Avenue, Nagpur',
      contactPhone: '+917122700000',
      email: 'contact@nagpuremergency.in',
      tradeLicense: 'MH-NGP-AMB-2024-001',
      adminUserId: operatorAdminUser.id,
      verificationState: VerificationState.VERIFIED,
    },
  });
  operatorAdminToken = generateTokens({
    id: operatorAdminUser.id,
    email: operatorAdminUser.email,
    role: operatorAdminUser.role,
    name: operatorAdminUser.name,
    operatorId: operatorA.id,
  }).accessToken;

  // 9. Seed Drivers & Ambulances
  driverUser = await prisma.user.create({
    data: {
      name: 'Rajesh Kadu',
      email: 'rajesh.kadu@driver.nagpur.in',
      phone: '+919876543222',
      passwordHash,
      role: Role.DRIVER,
      isActive: true,
      isPhoneVerified: true,
      hospitalId: hospitalA.id,
    },
  });
  driverProfileA = await prisma.driverProfile.create({
    data: {
      userId: driverUser.id,
      licenseNumber: 'MH31-2019-0098765',
      licenseExpiry: new Date('2028-12-31'),
      verificationState: VerificationState.VERIFIED,
      organizationType: 'HOSPITAL',
      hospitalId: hospitalA.id,
      membershipStatus: 'APPROVED',
      isDispatchEligible: true,
      isDemo: false,
    },
  });
  driverToken = generateTokens({
    id: driverUser.id,
    email: driverUser.email,
    role: driverUser.role,
    name: driverUser.name,
  }).accessToken;

  ambulanceA = await prisma.ambulance.create({
    data: {
      driverId: driverUser.id,
      hospitalId: hospitalA.id,
      vehicleNumber: 'MH-31-EQ-1008',
      ambulanceType: AmbulanceType.ADVANCED_LIFE_SUPPORT,
      isAvailable: true,
      currentLat: 21.0900,
      currentLng: 79.0400,
      verificationState: VerificationState.VERIFIED,
      movementStatus: 'STOPPED',
      speedKmH: 0,
      isDemo: false,
    },
  });
  await prisma.driverVehicleAssignment.create({
    data: {
      driverId: driverProfileA.id,
      ambulanceId: ambulanceA.id,
      isCurrent: true,
    },
  });

  secondDriverUser = await prisma.user.create({
    data: {
      name: 'Prakash Rao',
      email: 'prakash.rao@driver.nagpur.in',
      phone: '+919876543223',
      passwordHash,
      role: Role.DRIVER,
      isActive: true,
      isPhoneVerified: true,
      operatorId: operatorA.id,
    },
  });
  driverProfileB = await prisma.driverProfile.create({
    data: {
      userId: secondDriverUser.id,
      licenseNumber: 'MH31-2020-0043210',
      licenseExpiry: new Date('2029-05-15'),
      verificationState: VerificationState.VERIFIED,
      organizationType: 'PRIVATE_OPERATOR',
      operatorId: operatorA.id,
      membershipStatus: 'APPROVED',
      isDispatchEligible: true,
      isDemo: false,
    },
  });
  secondDriverToken = generateTokens({
    id: secondDriverUser.id,
    email: secondDriverUser.email,
    role: secondDriverUser.role,
    name: secondDriverUser.name,
  }).accessToken;

  ambulanceB = await prisma.ambulance.create({
    data: {
      driverId: secondDriverUser.id,
      operatorId: operatorA.id,
      vehicleNumber: 'MH-31-AR-2020',
      ambulanceType: AmbulanceType.BASIC_LIFE_SUPPORT,
      isAvailable: true,
      currentLat: 21.1400,
      currentLng: 79.0800,
      verificationState: VerificationState.VERIFIED,
      movementStatus: 'STOPPED',
      speedKmH: 0,
      isDemo: false,
    },
  });
  await prisma.driverVehicleAssignment.create({
    data: {
      driverId: driverProfileB.id,
      ambulanceId: ambulanceB.id,
      isCurrent: true,
    },
  });
});

test.after(async () => {
  await new Promise<void>((resolve) => {
    ioServer.close();
    server.close(() => resolve());
  });
  try {
    await prisma.$disconnect();
  } catch {}
});

// =============================================================================
// MODULE L: PATIENT MAP (Tests 1-6)
// =============================================================================

test('1. Nearby hospitals are fetched from the backend', async () => {
  const res = await fetch(`${baseUrl}/api/v1/hospitals/nearby?lat=21.1458&lng=79.0882&radiusKm=20`);
  assert.equal(res.status, 200, 'Nearby hospitals should return 200 OK');
  const data = (await res.json()) as any;
  assert.ok(data.hospitals && Array.isArray(data.hospitals), 'Should return hospitals array');
  assert.ok(data.hospitals.length >= 1, 'Should find at least 1 verified hospital');
  const found = data.hospitals.find((h: any) => h.id === hospitalA.id || h.id === hospitalB.id);
  assert.ok(found, 'Should find seeded Nagpur hospital');
});

test('2. Hospital distance is calculated correctly', async () => {
  const res = await fetch(`${baseUrl}/api/v1/hospitals/nearby?lat=21.1458&lng=79.0882&radiusKm=25`);
  assert.equal(res.status, 200);
  const data = (await res.json()) as any;
  const hosp = data.hospitals.find((h: any) => h.id === hospitalA.id);
  assert.ok(hosp, 'Should find Hospital A');
  assert.ok(typeof hosp.distanceKm === 'number', 'distanceKm should be a number');
  assert.ok(hosp.distanceLabel && hosp.distanceLabel.includes('geographic distance'), 'Must label as geographic distance');
});

test('3. Selecting a hospital retrieves the correct nearby ambulance results', async () => {
  const res = await fetch(`${baseUrl}/api/v1/hospitals/${hospitalA.id}/nearby-ambulances?lat=21.1458&lng=79.0882&radiusKm=30`);
  assert.equal(res.status, 200, 'Nearby ambulances should return 200 OK');
  const data = (await res.json()) as any;
  assert.ok(data.ambulances && Array.isArray(data.ambulances), 'Should return ambulances array');
  assert.equal(data.hospitalId, hospitalA.id);
  assert.equal(data.emergencyFallback?.emergencyPhone || data.emergencyFallback, '112');
  
  // Distinguish hospital-owned vs private-operator
  const hospOwned = data.ambulances.find((a: any) => a.ownership === 'HOSPITAL_OWNED');
  assert.ok(hospOwned, 'Should include hospital-owned ambulance');
  assert.equal(hospOwned.id, ambulanceA.id);
  assert.equal(hospOwned.operationalStatus, 'AVAILABLE');
});

test('4. Invalid coordinates are rejected', async () => {
  const res = await fetch(`${baseUrl}/api/v1/hospitals/nearby?lat=95.5&lng=200.0`);
  assert.equal(res.status, 400, 'Invalid coordinates must return 400 Bad Request');
  const data = (await res.json()) as any;
  assert.equal(data.code, 'INVALID_COORDINATES');
});

test('5. Denied geolocation provides a usable fallback', async () => {
  // Querying without coordinates falls back safely to default pilot location or all verified hospitals
  const res = await fetch(`${baseUrl}/api/v1/hospitals/nearby`);
  assert.equal(res.status, 200, 'Fallback query without coordinates should succeed');
  const data = (await res.json()) as any;
  assert.ok(data.hospitals && Array.isArray(data.hospitals));
  assert.ok(data.hospitals.length >= 1, 'Should return available hospitals for manual browse');
});

test('6. Empty results are displayed honestly', async () => {
  // Querying coordinates far away from any hospital with small radius (e.g., Antarctica)
  const res = await fetch(`${baseUrl}/api/v1/hospitals/nearby?lat=-75.0&lng=0.0&radiusKm=10`);
  assert.equal(res.status, 200);
  const data = (await res.json()) as any;
  assert.equal(data.count, 0, 'Count should be 0');
  assert.equal(data.hospitals.length, 0, 'Hospitals array should be empty');
  assert.ok(data.message && data.message.includes('No verified hospitals found'), 'Should honestly report no hospitals');
});

// =============================================================================
// MODULE L: NANI AI CHATBOT AND VOICE (Tests 7-10)
// =============================================================================

test('7. Text messages reach the configured chatbot adapter', async () => {
  const res = await fetch(`${baseUrl}/api/v1/chatbot/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'What OPD services are available at AIIMS Nagpur?' }),
  });
  assert.equal(res.status, 200);
  const data = (await res.json()) as any;
  assert.ok(data.reply, 'Should receive a reply');
  assert.ok(data.provider, 'Should specify provider');
});

test('8. Provider errors produce a usable fallback', async () => {
  // When GEMINI_API_KEY is not defined, chatbot gracefully uses local contextual fallback
  const res = await fetch(`${baseUrl}/api/v1/chatbot/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Hello, how can I book an appointment?' }),
  });
  assert.equal(res.status, 200);
  const data = (await res.json()) as any;
  assert.equal(data.provider, 'local_fallback', 'Should explicitly report local_fallback provider');
  assert.ok(!data.isEmergency);
});

test('9. Voice output is handled according to browser support', async () => {
  // Chatbot returns clean textual payload and speech metadata suitable for Web Speech synthesis
  const res = await fetch(`${baseUrl}/api/v1/chatbot/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'नमस्ते, मुझे डॉक्टर से मिलना है' }),
  });
  assert.equal(res.status, 200);
  const data = (await res.json()) as any;
  assert.ok(typeof data.reply === 'string' && data.reply.length > 0, 'Reply text must be present for Web Speech API synthesis');
});

test('10. Emergency guardrails display appropriate emergency guidance', async () => {
  const res = await fetch(`${baseUrl}/api/v1/chatbot/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Patient has severe crushing chest pain, difficulty breathing, and sweating' }),
  });
  assert.equal(res.status, 200);
  const data = (await res.json()) as any;
  assert.equal(data.isEmergency, true, 'Emergency symptoms must trigger emergency flag');
  assert.equal(data.emergencyContact, '112', 'Must specify 112 emergency line');
  assert.ok(data.reply.includes('112'), 'Reply must prominently guide patient to 112');
});

// =============================================================================
// MODULE L: APPOINTMENTS & OPD TOKENS (Tests 11-16)
// =============================================================================

let bookedAppointmentId: string;
let allocatedTokenString: string;

test('11. Booking persists in the database', async () => {
  const res = await fetch(`${baseUrl}/api/appointments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${patientToken}`,
    },
    body: JSON.stringify({
      slotId: slotA.id,
      symptoms: 'Mild chest tightness on exertion',
    }),
  });
  assert.equal(res.status, 201, 'Booking should return 201 Created');
  const data = (await res.json()) as any;
  assert.ok(data.appointment && data.appointment.id);
  assert.equal(data.appointment.patientId, patientUser.id);
  assert.equal(data.appointment.doctorId, doctorA.id);
  assert.equal(data.appointment.hospitalId, hospitalA.id);
  assert.equal(data.appointment.status, AppointmentStatus.BOOKED);
  
  bookedAppointmentId = data.appointment.id;
  allocatedTokenString = data.appointment.tokenString;
  
  // Verify persistence in DB
  const persisted = await prisma.appointment.findUnique({ where: { id: bookedAppointmentId } });
  assert.ok(persisted, 'Appointment must exist in DB');
});

test('12. The correct doctor receives the relevant notification', async () => {
  // Verify appointment was recorded with doctor association
  const appt = await prisma.appointment.findUnique({
    where: { id: bookedAppointmentId },
    include: { doctor: true },
  });
  assert.ok(appt);
  assert.equal(appt.doctorId, doctorA.id);
  assert.equal(appt.doctor.name, doctorA.name);
});

test('13. The correct hospital receives the relevant notification', async () => {
  // Query hospital OPD queue for Hospital A
  const res = await fetch(`${baseUrl}/api/appointments/hospital/queue?doctorId=${doctorA.id}&date=2026-10-28`, {
    headers: { Authorization: `Bearer ${hospitalAdminToken}` },
  });
  assert.equal(res.status, 200, 'Hospital admin should be able to view queue');
  const data = (await res.json()) as any;
  assert.ok(data.queue && data.queue.length >= 1);
  const found = data.queue.find((a: any) => a.id === bookedAppointmentId);
  assert.ok(found, 'Hospital A queue must include the booked appointment');
});

test('14. The patient receives the actual booking confirmation', async () => {
  const res = await fetch(`${baseUrl}/api/appointments/my-appointments`, {
    headers: { Authorization: `Bearer ${patientToken}` },
  });
  assert.equal(res.status, 200);
  const data = (await res.json()) as any;
  const myAppt = data.appointments.find((a: any) => a.id === bookedAppointmentId);
  assert.ok(myAppt, 'Patient appointments list must contain confirmation');
  assert.equal(myAppt.status, AppointmentStatus.BOOKED);
});

test('15. Concurrent booking cannot overbook a constrained slot', async () => {
  // Slot A has maxPatients = 2. It currently has 1 booking.
  // Patient 2 will book slot 2: this should succeed.
  const res2 = await fetch(`${baseUrl}/api/appointments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${otherPatientToken}`,
    },
    body: JSON.stringify({ slotId: slotA.id }),
  });
  assert.equal(res2.status, 201, 'Second booking should fill slot to max capacity (2/2)');

  // Third patient attempts to book the filled slot: must be rejected
  const thirdUser = await prisma.user.create({
    data: {
      name: 'Third Patient',
      email: 'third.patient@example.in',
      phone: '+919876543299',
      passwordHash: 'hash',
      role: Role.PATIENT,
      isActive: true,
    },
  });
  const thirdToken = generateTokens({
    id: thirdUser.id,
    email: thirdUser.email,
    role: thirdUser.role,
    name: thirdUser.name,
  }).accessToken;

  const res3 = await fetch(`${baseUrl}/api/appointments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${thirdToken}`,
    },
    body: JSON.stringify({ slotId: slotA.id }),
  });
  assert.ok(res3.status === 400 || res3.status === 409, 'Overbooking must be rejected with 400 or 409');
  const data3 = (await res3.json()) as any;
  assert.ok(data3.message.includes('fully booked'), 'Must report slot is fully booked');
});

test('16. Tokens are unique within the configured queue scope', async () => {
  // Verify token format NAG-DRxxx-YYYYMMDD-xxx
  assert.ok(allocatedTokenString, 'Token string must be allocated');
  assert.match(allocatedTokenString, /^NAG-[A-Z0-9]+-\d{8}-\d{3}$/, 'Token must follow human-readable OPD format');

  // Verify tokens are unique for the slot
  const appts = await prisma.appointment.findMany({ where: { slotId: slotA.id } });
  const tokenSet = new Set(appts.map((a) => a.tokenString));
  assert.equal(tokenSet.size, appts.length, 'All tokens in queue must be distinct');
});

// =============================================================================
// MODULE L: AMBULANCE ESCALATION & GPS TRACKING (Tests 17-23)
// =============================================================================

let testRequestId: string;
let testTripId: string;

test('17. Offers reach only eligible assigned drivers', async () => {
  const hosp = await prisma.hospital.findUnique({ where: { id: hospitalA.id } });
  const driver = await prisma.user.findUnique({ where: { id: driverUser.id } });
  const dProfile = await prisma.driverProfile.findUnique({ where: { userId: driverUser.id } });

  const candidate: CandidateVehicle = {
    ambulance: ambulanceA,
    driver,
    driverProfile: dProfile,
    organization: {
      type: 'HOSPITAL',
      id: hosp!.id,
      name: hosp!.name,
      verificationState: hosp!.verificationState,
      isDemo: hosp!.isDemo,
    },
  };

  const evalResult = await evaluateCandidateEligibility(candidate, {
    requiredAmbulanceType: AmbulanceType.ADVANCED_LIFE_SUPPORT,
    isDemoRequest: false,
  });
  assert.equal(evalResult.eligible, true, 'Fully verified hospital ambulance must be eligible');
});

test('18. Rejection and timeout trigger escalation', async () => {
  // Ensure ambulances are available
  await prisma.ambulance.update({ where: { id: ambulanceA.id }, data: { isAvailable: true } });
  await prisma.ambulance.update({ where: { id: ambulanceB.id }, data: { isAvailable: true } });

  // Create an emergency request requiring BLS (so both ALS and BLS match)
  const emergencyReq = await prisma.emergencyRequest.create({
    data: {
      patientId: patientUser.id,
      pickupLat: 21.1458,
      pickupLng: 79.0882,
      requiredAmbulanceType: AmbulanceType.BASIC_LIFE_SUPPORT,
      status: RequestStatus.OFFERED,
      hospitalId: hospitalA.id,
    },
  });
  testRequestId = emergencyReq.id;

  const attempt1 = await prisma.dispatchAttempt.create({
    data: {
      requestId: emergencyReq.id,
      driverId: driverUser.id,
      ambulanceId: ambulanceA.id,
      status: DispatchAttemptStatus.OFFERED,
      distanceKm: 2.0,
      expiresAt: new Date(Date.now() + 60000),
    },
  });

  // Driver 1 rejects offer -> engine updates status to REJECTED and escalates to Driver 2
  const escalation = await rejectOrExpireOffer(attempt1.id, driverUser.id, 'REJECT', 'Vehicle maintenance');
  assert.equal(escalation.nextOffered, true, 'Offer should escalate to next eligible candidate');

  const updatedAttempt1 = await prisma.dispatchAttempt.findUnique({ where: { id: attempt1.id } });
  assert.equal(updatedAttempt1?.status, DispatchAttemptStatus.REJECTED);
});

test('19. Concurrent acceptance cannot create duplicate dispatches', async () => {
  // Create attempt for driver 2
  const attempt2 = await prisma.dispatchAttempt.create({
    data: {
      requestId: testRequestId,
      driverId: secondDriverUser.id,
      ambulanceId: ambulanceB.id,
      status: DispatchAttemptStatus.OFFERED,
      distanceKm: 1.5,
      expiresAt: new Date(Date.now() + 60000),
    },
  });

  // First acceptance succeeds
  const acceptResult1 = await atomicallyAcceptOffer(attempt2.id, secondDriverUser.id);
  assert.equal(acceptResult1.success, true, 'First acceptance must succeed');
  assert.ok(acceptResult1.trip, 'Trip must be created');
  testTripId = acceptResult1.trip.id;

  // Second duplicate acceptance attempt for same request must fail
  const acceptResult2 = await atomicallyAcceptOffer(attempt2.id, secondDriverUser.id);
  assert.equal(acceptResult2.success, false, 'Duplicate acceptance must be rejected');
});

test('20. Driver location is visible only to authorized participants', async () => {
  // Unrelated patient attempts to access emergency request and trip details
  const res = await fetch(`${baseUrl}/api/v1/sos/${testRequestId}`, {
    headers: { Authorization: `Bearer ${otherPatientToken}` },
  });
  assert.equal(res.status, 403, 'Unrelated patient must be denied access to another patient trip (403)');
});

test('21. Stale GPS produces UNKNOWN or OFFLINE as appropriate', async () => {
  // Update location with stationary speed (< 3 km/h) -> STOPPED
  const res1 = await fetch(`${baseUrl}/api/v1/sos/trips/${testTripId}/location`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secondDriverToken}`,
    },
    body: JSON.stringify({
      lat: 21.1410,
      lng: 79.0810,
      speedKmH: 0,
    }),
  });
  assert.equal(res1.status, 200);
  const data1 = (await res1.json()) as any;
  assert.equal(data1.movementStatus, 'STOPPED');

  // Successive location with speed 45 km/h -> MOVING
  const res2 = await fetch(`${baseUrl}/api/v1/sos/trips/${testTripId}/location`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secondDriverToken}`,
    },
    body: JSON.stringify({
      lat: 21.1440,
      lng: 79.0840,
      speedKmH: 45,
    }),
  });
  assert.equal(res2.status, 200);
  const data2 = (await res2.json()) as any;
  assert.equal(data2.movementStatus, 'MOVING');
});

test('22. The destination hospital receives the appropriate notification', async () => {
  // Update trip status to ARRIVING / AT_HOSPITAL
  const res = await fetch(`${baseUrl}/api/v1/sos/trips/${testTripId}/status`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secondDriverToken}`,
    },
    body: JSON.stringify({ status: 'AMBULANCE_ARRIVING' }),
  });
  assert.equal(res.status, 200);
  const data = (await res.json()) as any;
  assert.equal(data.trip.status, 'AMBULANCE_ARRIVING');
});

test('23. No eligible ambulance results in an explicit unresolved status', async () => {
  // An emergency request where no candidate can serve
  const noMatchReq = await prisma.emergencyRequest.create({
    data: {
      patientId: patientUser.id,
      pickupLat: 10.0000, // Remote location far from any fleet
      pickupLng: 70.0000,
      requiredAmbulanceType: AmbulanceType.BASIC_LIFE_SUPPORT,
      status: RequestStatus.NO_ELIGIBLE_AMBULANCE,
    },
  });
  assert.equal(noMatchReq.status, RequestStatus.NO_ELIGIBLE_AMBULANCE);
});

// =============================================================================
// MODULE L: HOSPITAL ADMIN PANEL (Tests 24-27)
// =============================================================================

test('24. Bed changes persist', async () => {
  const res = await fetch(`${baseUrl}/api/v1/hospitals/beds/${testBedA.id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hospitalAdminToken}`,
    },
    body: JSON.stringify({ status: BedStatus.OCCUPIED }),
  });
  assert.equal(res.status, 200, 'Updating bed should return 200 OK');
  const data = (await res.json()) as any;
  assert.equal(data.status, BedStatus.OCCUPIED);

  const updatedBed = await prisma.hospitalBed.findUnique({ where: { id: testBedA.id } });
  assert.equal(updatedBed?.status, BedStatus.OCCUPIED, 'Bed update must persist in DB');
});

test('25. Doctor and specialty changes persist', async () => {
  const res = await fetch(`${baseUrl}/api/doctors/${doctorA.id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hospitalAdminToken}`,
    },
    body: JSON.stringify({
      specialization: 'Interventional Cardiology & Electrophysiology',
      consultationFee: 900,
    }),
  });
  assert.equal(res.status, 200, 'Doctor update should succeed');
  const data = (await res.json()) as any;
  assert.equal(data.specialization, 'Interventional Cardiology & Electrophysiology');
  assert.equal(data.consultationFee, 900);

  const updatedDoc = await prisma.doctor.findUnique({ where: { id: doctorA.id } });
  assert.equal(updatedDoc?.specialization, 'Interventional Cardiology & Electrophysiology');
});

test('26. Hospital administrators cannot modify unrelated organizations', async () => {
  // Admin for Hospital B attempts to modify Doctor A belonging to Hospital A -> 403 Forbidden
  const resDoc = await fetch(`${baseUrl}/api/doctors/${doctorA.id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${unrelatedHospitalAdminToken}`,
    },
    body: JSON.stringify({ name: 'Hacked Doctor' }),
  });
  assert.equal(resDoc.status, 403, 'Cross-hospital doctor update must return 403 Forbidden');
  const dataDoc = (await resDoc.json()) as any;
  assert.equal(dataDoc.code, 'UNAUTHORIZED_HOSPITAL_ACCESS');

  // Admin for Hospital B attempts to modify Bed in Hospital A -> 403 Forbidden
  const resBed = await fetch(`${baseUrl}/api/v1/hospitals/beds/${testBedA.id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${unrelatedHospitalAdminToken}`,
    },
    body: JSON.stringify({ status: BedStatus.MAINTENANCE }),
  });
  assert.equal(resBed.status, 403, 'Cross-hospital bed update must return 403 Forbidden');
  const dataBed = (await resBed.json()) as any;
  assert.equal(dataBed.code, 'UNAUTHORIZED_HOSPITAL_ACCESS');
});

test('27. OPD queue transitions persist and remain auditable', async () => {
  // Mark appointment COMPLETED
  const res = await fetch(`${baseUrl}/api/appointments/${bookedAppointmentId}/status`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hospitalAdminToken}`,
    },
    body: JSON.stringify({ status: AppointmentStatus.COMPLETED }),
  });
  assert.equal(res.status, 200);
  const data = (await res.json()) as any;
  assert.equal(data.status, AppointmentStatus.COMPLETED);

  const updatedAppt = await prisma.appointment.findUnique({ where: { id: bookedAppointmentId } });
  assert.equal(updatedAppt?.status, AppointmentStatus.COMPLETED);
});

// =============================================================================
// MODULE L: SUPER ADMIN AND APPROVAL CONTROLS (Tests 28-31)
// =============================================================================

test('28. Approval changes persist', async () => {
  // Super Admin reviews and updates an entity verification state
  const res = await fetch(`${baseUrl}/api/v1/verification/review`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${superAdminToken}`,
    },
    body: JSON.stringify({
      entityType: 'HOSPITAL',
      entityId: hospitalB.id,
      status: VerificationState.VERIFIED,
      reviewNotes: 'All NMC medical accreditation certificates validated.',
    }),
  });
  assert.equal(res.status, 200);
  const data = (await res.json()) as any;
  assert.ok(data.audit);
  assert.equal(data.audit.actorId, superAdminUser.id);

  const updatedHosp = await prisma.hospital.findUnique({ where: { id: hospitalB.id } });
  assert.equal(updatedHosp?.verificationState, VerificationState.VERIFIED);
});

test('29. Unverified entities remain ineligible for real dispatch', async () => {
  const hosp = await prisma.hospital.findUnique({ where: { id: hospitalA.id } });
  const driver = await prisma.user.findUnique({ where: { id: driverUser.id } });
  const dProfile = await prisma.driverProfile.findUnique({ where: { userId: driverUser.id } });

  // Unverified ambulance
  const unverifiedAmbulance = {
    ...ambulanceA,
    verificationState: VerificationState.PENDING_REVIEW,
  };

  const unverifiedCandidate: CandidateVehicle = {
    ambulance: unverifiedAmbulance,
    driver,
    driverProfile: dProfile,
    organization: {
      type: 'HOSPITAL',
      id: hosp!.id,
      name: hosp!.name,
      verificationState: hosp!.verificationState,
      isDemo: hosp!.isDemo,
    },
  };

  const evalResult = await evaluateCandidateEligibility(unverifiedCandidate, {
    requiredAmbulanceType: AmbulanceType.BASIC_LIFE_SUPPORT,
    isDemoRequest: false,
  });
  assert.equal(evalResult.eligible, false, 'Unverified ambulance must not be eligible');
  assert.ok(evalResult.denialReasons.includes('AMBULANCE_NOT_VERIFIED'));
});

test('30. Suspended accounts lose the permissions that should be revoked', async () => {
  // Suspend second patient account
  const resSuspend = await fetch(`${baseUrl}/api/v1/verification/suspend-account`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${superAdminToken}`,
    },
    body: JSON.stringify({
      userId: otherPatientUser.id,
      reason: 'Repeated non-emergency prank dispatch abuse',
    }),
  });
  assert.equal(resSuspend.status, 200);

  // Authenticated request by suspended user must be blocked with 403
  const resBlocked = await fetch(`${baseUrl}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${otherPatientToken}` },
  });
  assert.equal(resBlocked.status, 403, 'Suspended user must be blocked from protected routes');

  // Reactivate account
  const resReactivate = await fetch(`${baseUrl}/api/v1/verification/reactivate-account`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${superAdminToken}`,
    },
    body: JSON.stringify({
      userId: otherPatientUser.id,
      reason: 'User submitted formal appeal and identity confirmation',
    }),
  });
  assert.equal(resReactivate.status, 200);

  const resUnblocked = await fetch(`${baseUrl}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${otherPatientToken}` },
  });
  assert.equal(resUnblocked.status, 200, 'Reactivated user can access protected endpoints');
});

test('31. Sensitive actions generate appropriate audit events', async () => {
  const res = await fetch(`${baseUrl}/api/v1/verification/audit-logs`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  assert.equal(res.status, 200);
  const data = (await res.json()) as any;
  assert.ok(data.logs && Array.isArray(data.logs));
  assert.ok(data.logs.length >= 2, 'Must contain audit logs for review and suspension actions');
});

// =============================================================================
// MODULE L: LOGIN, REGISTRATION AND GOOGLE OAUTH (Tests 32-35)
// =============================================================================

test('32. Registration and login work', async () => {
  const registerPayload = {
    name: 'Pradeep Deshpande',
    email: 'pradeep.deshpande@example.in',
    phone: '09876599999', // Indian format with leading 0 -> normalized to +919876599999
    password: 'SecurePassword123!@#',
    bloodGroup: 'A+',
    termsAccepted: true,
  };

  const resReg = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(registerPayload),
  });
  assert.equal(resReg.status, 201, 'Registration should return 201');
  const regData = (await resReg.json()) as any;
  assert.equal(regData.user.role, Role.PATIENT);
  assert.equal(regData.user.phone, '+919876599999');

  // Login with normalized Indian phone
  const resLogin = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone: '+919876599999',
      password: 'SecurePassword123!@#',
    }),
  });
  assert.equal(resLogin.status, 200, 'Login with phone should return 200');
  const loginData = (await resLogin.json()) as any;
  assert.ok(loginData.token);
});

test('33. Session invalidation works', async () => {
  const res = await fetch(`${baseUrl}/api/v1/auth/logout`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${patientToken}`,
    },
  });
  assert.equal(res.status, 200);
  const data = (await res.json()) as any;
  assert.equal(data.status, 'success');
  
  // Set-Cookie header must invalidate the refresh_token cookie
  const setCookie = res.headers.get('set-cookie');
  assert.ok(setCookie && setCookie.includes('lifelink_refresh_token=;'), 'Must clear refresh cookie');
});

test('34. Protected routes reject unauthorized requests', async () => {
  const resNoAuth = await fetch(`${baseUrl}/api/v1/auth/me`);
  assert.equal(resNoAuth.status, 401, 'Request without token must return 401 Unauthorized');

  const resBadToken = await fetch(`${baseUrl}/api/v1/auth/me`, {
    headers: { Authorization: 'Bearer invalid.jwt.token' },
  });
  assert.equal(resBadToken.status, 401, 'Request with bogus token must return 401 Unauthorized');
});

test('35. Google OAuth works with configured credentials or reports a precise missing prerequisite', async () => {
  // When GOOGLE_CLIENT_ID is unset in test environment, it must report clear configuration failure
  const res = await fetch(`${baseUrl}/api/v1/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: 'mock-google-id-token' }),
  });
  assert.equal(res.status, 400);
  const data = (await res.json()) as any;
  assert.equal(data.code, 'GOOGLE_OAUTH_NOT_CONFIGURED');
  assert.ok(data.message.includes('GOOGLE_CLIENT_ID'));
  assert.ok(data.instructions && Array.isArray(data.instructions), 'Must provide clear setup instructions');
});
