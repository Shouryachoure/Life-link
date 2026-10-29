process.env.NODE_ENV = 'test';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import app from '../src/app';
import prisma, { inMemoryDb } from '../src/db';
import { normalizeIndianPhone } from '../src/utils/phoneUtils';
import { generateTokens } from '../src/services/tokenService';
import { requireOperatorScope } from '../src/middleware/auth';
import { Role, VerificationState } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

let server: http.Server;
let baseUrl: string;

let superAdminToken: string;
let superAdminUserId: string;

test.before(async () => {
  process.env.NODE_ENV = 'test';
  inMemoryDb.clear();

  await new Promise<void>((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as any;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });

  // Seed Super Administrator for verification tests
  const salt = bcrypt.genSaltSync(12);
  const admin = await prisma.user.create({
    data: {
      name: 'LifeLink Central Verifier',
      email: 'verifier@lifelink.org',
      phone: '+919876500000',
      passwordHash: bcrypt.hashSync('VerifierSecretPass123!', salt),
      role: Role.SUPER_ADMIN,
    },
  });
  superAdminUserId = admin.id;

  const tokens = generateTokens({
    id: admin.id,
    email: admin.email,
    role: admin.role,
    name: admin.name,
  });
  superAdminToken = tokens.accessToken;
});

test.after(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  try {
    await prisma.$disconnect();
  } catch {}
});

// -----------------------------------------------------------------------------
// 1. Phone number normalization (+91 standard E.164)
// -----------------------------------------------------------------------------
test('1. Indian phone number normalization and numbering plan validation', async () => {
  // Valid variations of Indian mobile number
  assert.equal(normalizeIndianPhone('9876543210').normalized, '+919876543210');
  assert.equal(normalizeIndianPhone('09876543210').normalized, '+919876543210');
  assert.equal(normalizeIndianPhone('919876543210').normalized, '+919876543210');
  assert.equal(normalizeIndianPhone('+91 98765 43210').normalized, '+919876543210');
  assert.equal(normalizeIndianPhone('+91-98765-43210').normalized, '+919876543210');
  assert.equal(normalizeIndianPhone('  88888 77777 ').normalized, '+918888877777');
  assert.equal(normalizeIndianPhone('7000012345').normalized, '+917000012345');
  assert.equal(normalizeIndianPhone('6123456789').normalized, '+916123456789');

  // Invalid numbers
  assert.equal(normalizeIndianPhone('12345').isValid, false, 'Short number must fail');
  assert.equal(normalizeIndianPhone('5555555555').isValid, false, 'Number starting with 5 must fail');
  assert.equal(normalizeIndianPhone('abcdefghij').isValid, false, 'Non-numeric string must fail');
  assert.equal(normalizeIndianPhone(null as any).isValid, false);
});

// -----------------------------------------------------------------------------
// 2. Mock OTP dispatch and genuine verification
// -----------------------------------------------------------------------------
let patientUserId: string;
let patientUserToken: string;

test('2. Mock OTP dispatch and verification (never claims verified without OTP)', async () => {
  const phone = '9876511111';

  // Step A: Register patient with phone
  const regRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Ramesh Pawar',
      email: 'ramesh.pawar@lifelink.org',
      phone,
      password: 'StrongPatientPass123!',
      confirmPassword: 'StrongPatientPass123!',
      acceptedTerms: true,
    }),
  });
  assert.equal(regRes.status, 201);
  const regData = (await regRes.json()) as any;
  patientUserId = regData.user.id;
  patientUserToken = regData.token;

  // CRITICAL CHECK: Newly registered user must NOT be marked phone-verified
  assert.equal(regData.user.isPhoneVerified, false, 'Phone must remain unverified until genuine OTP check');

  // Step B: Request OTP
  const otpSendRes = await fetch(`${baseUrl}/api/v1/auth/send-phone-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone }),
  });
  assert.equal(otpSendRes.status, 200);
  const otpSendData = (await otpSendRes.json()) as any;
  assert.equal(otpSendData.mock, true, 'Must be flagged as mock');
  assert.equal(otpSendData.isSimulated, true, 'Must be flagged as simulated');
  assert.ok(otpSendData.devNotice, 'Dev notice must be present to prevent confusing with real SMS');
  const mockCode = otpSendData.mockCode;

  // Step C: Incorrect OTP rejection
  const badOtpRes = await fetch(`${baseUrl}/api/v1/auth/verify-phone-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, code: '000000' }),
  });
  assert.equal(badOtpRes.status, 400);

  // Step D: Correct OTP verification
  const verifyRes = await fetch(`${baseUrl}/api/v1/auth/verify-phone-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, code: mockCode }),
  });
  assert.equal(verifyRes.status, 200);
  const verifyData = (await verifyRes.json()) as any;
  assert.equal(verifyData.verified, true);

  // Step E: Verify updated profile reflects verified state
  const meRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${patientUserToken}` },
  });
  assert.equal(meRes.status, 200);
  const meData = (await meRes.json()) as any;
  assert.equal(meData.user.isPhoneVerified, true, 'User record must now reflect verified status');
});

// -----------------------------------------------------------------------------
// 3. Indian Phone-based login
// -----------------------------------------------------------------------------
test('3. Phone-based login using normalized Indian number', async () => {
  const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone: '98765 11111', // Format with space
      password: 'StrongPatientPass123!',
    }),
  });

  assert.equal(loginRes.status, 200, 'Login via phone number must succeed');
  const loginData = (await loginRes.json()) as any;
  assert.equal(loginData.user.phone, '+919876511111');
});

// -----------------------------------------------------------------------------
// 4. Driver onboarding workflow
// -----------------------------------------------------------------------------
let onboardedDriverUserId: string;
let onboardedDriverProfileId: string;
let driverUserToken: string;

test('4. Separate Driver Onboarding creates unverified, dispatch-ineligible profile', async () => {
  const payload = {
    name: 'Suresh Patil',
    email: 'suresh.patil@lifelink.org',
    phone: '9876522222',
    password: 'DriverStrongPass123!',
    confirmPassword: 'DriverStrongPass123!',
    licenseNumber: 'MH31-2024-0012345',
    licenseExpiry: '2028-12-31',
    organizationType: 'HOSPITAL',
  };

  const res = await fetch(`${baseUrl}/api/v1/auth/onboard/driver`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  assert.equal(res.status, 201, 'Driver onboarding should return 201 Created');
  const data = (await res.json()) as any;
  assert.equal(data.user.role, 'DRIVER');
  assert.equal(data.user.phone, '+919876522222');
  assert.equal(data.driverProfile.verificationState, 'PENDING_REVIEW');
  assert.equal(data.driverProfile.membershipStatus, 'PENDING');

  // CRITICAL REQUIREMENT: A newly registered driver must remain dispatch-ineligible
  assert.equal(data.isDispatchEligible, false, 'New driver must be dispatch ineligible');

  onboardedDriverUserId = data.user.id;
  onboardedDriverProfileId = data.driverProfile.id;
  driverUserToken = data.token;
});

// -----------------------------------------------------------------------------
// 5. 9-Point Dispatch eligibility gatekeeper returns explicit failure reasons
// -----------------------------------------------------------------------------
test('5. Dispatch eligibility gatekeeper rejects unverified driver with explicit codes', async () => {
  const res = await fetch(`${baseUrl}/api/v1/auth/driver-eligibility/${onboardedDriverUserId}`, {
    headers: { Authorization: `Bearer ${driverUserToken}` },
  });

  assert.equal(res.status, 200);
  const data = (await res.json()) as any;
  assert.equal(data.isEligible, false, 'Unverified driver cannot be eligible for dispatch');

  // Must contain explicit denial codes
  assert.ok(data.reasons.includes('DRIVER_NOT_VERIFIED'), 'Must include DRIVER_NOT_VERIFIED');
  assert.ok(data.reasons.includes('ORGANIZATION_MEMBERSHIP_PENDING'), 'Must include ORGANIZATION_MEMBERSHIP_PENDING');
  assert.ok(data.reasons.includes('ASSIGNMENT_INVALID'), 'Must include ASSIGNMENT_INVALID');
});

// -----------------------------------------------------------------------------
// 6. Hospital onboarding workflow
// -----------------------------------------------------------------------------
let onboardedHospitalId: string;

test('6. Separate Hospital Onboarding creates pending organization and linked admin', async () => {
  const payload = {
    hospitalName: 'Nagpur Care Multi-Speciality Hospital',
    address: 'Ramdaspeth, Central Avenue, Nagpur',
    city: 'Nagpur',
    state: 'Maharashtra',
    contactPhone: '9876533333',
    adminName: 'Dr. Vivek Joshi',
    adminEmail: 'admin@nagpurcare.org',
    password: 'HospitalAdminPass123!',
    confirmPassword: 'HospitalAdminPass123!',
  };

  const res = await fetch(`${baseUrl}/api/v1/auth/onboard/hospital`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  assert.equal(res.status, 201);
  const data = (await res.json()) as any;
  assert.equal(data.user.role, 'ADMIN_HOSPITAL');
  assert.equal(data.hospital.name, 'Nagpur Care Multi-Speciality Hospital');
  assert.equal(data.hospital.city, 'Nagpur');
  assert.equal(data.hospital.verificationState, 'PENDING_REVIEW');
  assert.equal(data.user.hospitalId, data.hospital.id, 'Admin must be linked to hospital');

  onboardedHospitalId = data.hospital.id;
});

// -----------------------------------------------------------------------------
// 7. Private ambulance operator onboarding workflow
// -----------------------------------------------------------------------------
let onboardedOperatorId: string;
let operatorAdminToken: string;

test('7. Separate Private Operator Onboarding creates pending organization and linked manager', async () => {
  const payload = {
    operatorName: 'Vidarbha QuickResponse Ambulance Services',
    tradeLicense: 'NMC-AMB-2024-9871',
    contactPhone: '9876544444',
    email: 'ops@vidarbharesponse.in',
    address: 'Wardha Road Depot, Nagpur',
    city: 'Nagpur',
    state: 'Maharashtra',
    adminName: 'Prakash Deshmukh',
    password: 'OperatorAdminPass123!',
    confirmPassword: 'OperatorAdminPass123!',
  };

  const res = await fetch(`${baseUrl}/api/v1/auth/onboard/operator`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  assert.equal(res.status, 201);
  const data = (await res.json()) as any;
  assert.equal(data.user.role, 'OPERATOR_ADMIN');
  assert.equal(data.operator.tradeLicense, 'NMC-AMB-2024-9871');
  assert.equal(data.operator.verificationState, 'PENDING_REVIEW');
  assert.equal(data.user.operatorId, data.operator.id, 'Manager must be linked to operator');

  onboardedOperatorId = data.operator.id;
  operatorAdminToken = data.token;
});

// -----------------------------------------------------------------------------
// 8. Onboarding status endpoint returns role-specific checklist
// -----------------------------------------------------------------------------
test('8. Role-specific onboarding status explains remaining incomplete items', async () => {
  // Test Driver onboarding status
  const driverStatusRes = await fetch(`${baseUrl}/api/v1/auth/onboarding-status`, {
    headers: { Authorization: `Bearer ${driverUserToken}` },
  });
  assert.equal(driverStatusRes.status, 200);
  const driverStatus = (await driverStatusRes.json()) as any;
  assert.equal(driverStatus.role, 'DRIVER');
  assert.equal(driverStatus.isDispatchEligible, false);
  assert.ok(driverStatus.missingSteps.length >= 2, 'Must list missing verification steps');

  // Test Operator Admin onboarding status
  const opStatusRes = await fetch(`${baseUrl}/api/v1/auth/onboarding-status`, {
    headers: { Authorization: `Bearer ${operatorAdminToken}` },
  });
  assert.equal(opStatusRes.status, 200);
  const opStatus = (await opStatusRes.json()) as any;
  assert.equal(opStatus.role, 'OPERATOR_ADMIN');
  assert.equal(opStatus.checklist.operatorVerified, false);
  assert.ok(opStatus.missingSteps.some((s: string) => s.includes('trade license verification')));
});

// -----------------------------------------------------------------------------
// 9. Authorized verification staff approval with audit trail
// -----------------------------------------------------------------------------
test('9. Verification review by authorized staff updates state and logs sanitized audit', async () => {
  // A. Non-admin unauthorized attempt must be blocked
  const unauthRes = await fetch(`${baseUrl}/api/v1/verification/review`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${driverUserToken}`,
    },
    body: JSON.stringify({
      entityType: 'DRIVER',
      entityId: onboardedDriverProfileId,
      status: 'VERIFIED',
    }),
  });
  assert.equal(unauthRes.status, 403, 'Driver cannot approve verification');

  // B. Authorized Super Admin approval
  const approveRes = await fetch(`${baseUrl}/api/v1/verification/review`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${superAdminToken}`,
    },
    body: JSON.stringify({
      entityType: 'DRIVER',
      entityId: onboardedDriverProfileId,
      status: 'VERIFIED',
      reviewMethod: 'MANUAL_DOCUMENT_AUDIT',
      reviewNotes: 'Driving license and RTO commercial endorsement verified manually.',
    }),
  });

  assert.equal(approveRes.status, 200);
  const approveData = (await approveRes.json()) as any;
  assert.equal(approveData.audit.newState, 'VERIFIED');
  assert.equal(approveData.audit.reviewMethod, 'MANUAL_DOCUMENT_AUDIT');
  assert.equal(approveData.audit.actorId, superAdminUserId);

  // Verification audit check: never store raw document images/base64 in audit log
  const auditString = JSON.stringify(approveData);
  assert.ok(!auditString.includes('data:image'), 'Raw documents must never appear in audit trail');
});

// -----------------------------------------------------------------------------
// 10. Account suspension & immediate session revocation
// -----------------------------------------------------------------------------
test('10. Account suspension immediately blocks active tokens and login attempts', async () => {
  // Suspend the onboarded driver account
  const suspendRes = await fetch(`${baseUrl}/api/v1/verification/suspend-account`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${superAdminToken}`,
    },
    body: JSON.stringify({
      userId: onboardedDriverUserId,
      reason: 'Temporary safety hold pending re-verification of transport fitness.',
    }),
  });
  assert.equal(suspendRes.status, 200);

  // Authenticated route using the driver's token must now fail closed with HTTP 403
  const probeRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${driverUserToken}` },
  });
  assert.equal(probeRes.status, 403, 'Suspended user token must be rejected with 403');
  const probeData = (await probeRes.json()) as any;
  assert.ok(probeData.message.includes('suspended'));

  // Login attempt with correct password must also be blocked
  const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'suresh.patil@lifelink.org',
      password: 'DriverStrongPass123!',
    }),
  });
  assert.equal(loginRes.status, 403, 'Suspended user login must be rejected with 403');
});

// -----------------------------------------------------------------------------
// 11. Cross-operator isolation middleware
// -----------------------------------------------------------------------------
test('11. Private Operator isolation: Manager A cannot access Operator B resources', async () => {
  const middleware = requireOperatorScope('operatorId');

  // Manager for Operator A accessing Operator A
  const reqA: any = {
    user: { id: 'mgr-1', role: Role.OPERATOR_ADMIN, operatorId: 'op-A' },
    params: { operatorId: 'op-A' },
    body: {},
    query: {},
  };
  let calledNextA = false;
  middleware(reqA, {} as any, () => {
    calledNextA = true;
  });
  assert.equal(calledNextA, true, 'Manager A accessing Operator A must pass');

  // Manager for Operator A attempting to access Operator B
  const reqB: any = {
    user: { id: 'mgr-1', role: Role.OPERATOR_ADMIN, operatorId: 'op-A' },
    params: { operatorId: 'op-B' },
    body: {},
    query: {},
  };
  let statusCodeB = 0;
  let responseDataB: any = null;
  const resB: any = {
    status: (code: number) => {
      statusCodeB = code;
      return {
        json: (data: any) => {
          responseDataB = data;
        },
      };
    },
  };
  middleware(reqB, resB, () => {
    assert.fail('Should not allow cross-operator access');
  });

  assert.equal(statusCodeB, 403, 'Cross-operator access must return HTTP 403');
  assert.ok(responseDataB.message.includes('not authorized to manage operations for another private ambulance operator'));
});
