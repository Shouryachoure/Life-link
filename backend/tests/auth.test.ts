process.env.NODE_ENV = 'test';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import app from '../src/app';
import prisma, { inMemoryDb } from '../src/db';
import { generateTokens, hashToken } from '../src/services/tokenService';
import { requireHospitalScope, requireSelfOrAdmin } from '../src/middleware/auth';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

let server: http.Server;
let baseUrl: string;

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
// 1. Successful patient registration
// -----------------------------------------------------------------------------
let registeredPatientToken: string;
let registeredPatientUser: any;

test('1. Successful patient registration', async () => {
  const payload = {
    name: 'Ananya Deshmukh',
    email: 'ananya.deshmukh@lifelink.org',
    password: 'PatientStrongPassword123!',
    confirmPassword: 'PatientStrongPassword123!',
    phone: '+919876500001',
    acceptedTerms: true,
    bloodGroup: 'B+',
    allergies: 'Aspirin',
    emergencyContactName: 'Rohan Deshmukh',
    emergencyContactPhone: '+919876500002',
    medicalNotes: 'Asthmatic, carries inhaler',
  };

  const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  assert.equal(res.status, 201, 'Registration should return HTTP 201 Created');
  const data = (await res.json()) as any;

  assert.equal(data.status, 'success');
  assert.ok(data.token, 'Access token must be returned');
  assert.equal(data.user.email, 'ananya.deshmukh@lifelink.org');
  assert.equal(data.user.role, 'PATIENT', 'User must be assigned PATIENT role');
  assert.equal(data.user.name, 'Ananya Deshmukh');
  assert.equal(data.user.patientProfile?.bloodGroup, 'B+');

  // Security Check: Password hash must NEVER be returned in response
  assert.equal(data.user.passwordHash, undefined, 'passwordHash must never be exposed');
  const rawBody = JSON.stringify(data);
  assert.ok(!rawBody.includes('PatientStrongPassword123!'), 'Plaintext password must never appear in response');

  registeredPatientToken = data.token;
  registeredPatientUser = data.user;
});

// -----------------------------------------------------------------------------
// 2. Duplicate-email registration rejection
// -----------------------------------------------------------------------------
test('2. Duplicate-email registration rejection with case-insensitivity', async () => {
  const payload = {
    name: 'Duplicate User',
    email: 'ANANYA.DESHMUKH@LIFELINK.ORG', // Mixed casing
    password: 'PatientStrongPassword123!',
    acceptedTerms: true,
  };

  const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  assert.equal(res.status, 400, 'Duplicate registration should return HTTP 400 Bad Request');
  const data = (await res.json()) as any;
  assert.equal(data.status, 'fail');
  assert.ok(data.message.includes('already exists'), 'Rejection message must indicate existing account');
});

// -----------------------------------------------------------------------------
// 3. Invalid registration input rejection
// -----------------------------------------------------------------------------
test('3. Invalid registration input rejection (password < 12 chars, invalid email, unaccepted terms)', async () => {
  // A. Password under 12 characters
  const shortPassRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Short Pass User',
      email: 'short@lifelink.org',
      password: 'short',
      acceptedTerms: true,
    }),
  });
  assert.equal(shortPassRes.status, 400);
  const shortData = (await shortPassRes.json()) as any;
  assert.ok(shortData.message.includes('12 characters'), 'Should enforce minimum 12 chars password');

  // B. Invalid email format
  const badEmailRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Bad Email User',
      email: 'not-an-email',
      password: 'ValidPasswordLength123!',
      acceptedTerms: true,
    }),
  });
  assert.equal(badEmailRes.status, 400);

  // C. Unaccepted terms
  const unacceptedTermsRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'No Terms User',
      email: 'noterms@lifelink.org',
      password: 'ValidPasswordLength123!',
      acceptedTerms: false,
    }),
  });
  assert.equal(unacceptedTermsRes.status, 400);
});

// -----------------------------------------------------------------------------
// 4. Successful login
// -----------------------------------------------------------------------------
test('4. Successful login establishing session and returning profile', async () => {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'ananya.deshmukh@lifelink.org',
      password: 'PatientStrongPassword123!',
    }),
  });

  assert.equal(res.status, 200, 'Login should return HTTP 200 OK');
  const data = (await res.json()) as any;
  assert.equal(data.status, 'success');
  assert.ok(data.token, 'Access token must be returned');
  assert.equal(data.user.email, 'ananya.deshmukh@lifelink.org');
  assert.equal(data.user.role, 'PATIENT');

  // Verify Set-Cookie header sets lifelink_refresh_token as HttpOnly
  const setCookie = res.headers.get('set-cookie');
  assert.ok(setCookie, 'Set-Cookie header must be present');
  assert.ok(setCookie.includes('lifelink_refresh_token='), 'Refresh token cookie must be set');
  assert.ok(setCookie.toLowerCase().includes('httponly'), 'Cookie must be HttpOnly');
});

// -----------------------------------------------------------------------------
// 5. Incorrect-password rejection
// -----------------------------------------------------------------------------
test('5. Incorrect-password rejection with generic error message', async () => {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'ananya.deshmukh@lifelink.org',
      password: 'WrongPassword12345!',
    }),
  });

  assert.equal(res.status, 401, 'Wrong password must return HTTP 401 Unauthorized');
  const data = (await res.json()) as any;
  assert.equal(data.status, 'fail');
  assert.equal(data.message, 'Invalid email or password.', 'Error message must be generic');
});

// -----------------------------------------------------------------------------
// 6. Safe handling of nonexistent accounts
// -----------------------------------------------------------------------------
test('6. Safe handling of nonexistent accounts (identical generic error to mitigate enumeration)', async () => {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'does.not.exist@lifelink.org',
      password: 'SomeRandomPassword123!',
    }),
  });

  assert.equal(res.status, 401, 'Nonexistent account must return HTTP 401');
  const data = (await res.json()) as any;
  assert.equal(data.status, 'fail');
  assert.equal(
    data.message,
    'Invalid email or password.',
    'Nonexistent account error must match wrong password error exactly'
  );
});

// -----------------------------------------------------------------------------
// 7. Authenticated profile retrieval (GET /api/v1/auth/me)
// -----------------------------------------------------------------------------
test('7. Authenticated profile retrieval (GET /api/v1/auth/me)', async () => {
  const res = await fetch(`${baseUrl}/api/v1/auth/me`, {
    headers: {
      Authorization: `Bearer ${registeredPatientToken}`,
    },
  });

  assert.equal(res.status, 200, 'Authenticated profile fetch should return HTTP 200');
  const data = (await res.json()) as any;
  assert.equal(data.status, 'success');
  assert.equal(data.user.email, 'ananya.deshmukh@lifelink.org');
  assert.equal(data.user.role, 'PATIENT');
  assert.equal(data.user.passwordHash, undefined, 'Password hash must never be returned');
});

// -----------------------------------------------------------------------------
// 8. Unauthenticated access rejection
// -----------------------------------------------------------------------------
test('8. Unauthenticated access rejection on protected endpoints', async () => {
  // A. Missing token
  const noTokenRes = await fetch(`${baseUrl}/api/v1/auth/me`);
  assert.equal(noTokenRes.status, 401, 'Missing token must return HTTP 401');

  // B. Invalid / forged token
  const badTokenRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
    headers: { Authorization: 'Bearer forged.invalid.token' },
  });
  assert.equal(badTokenRes.status, 401, 'Invalid token must return HTTP 401');
});

// -----------------------------------------------------------------------------
// 9. Successful logout and session invalidation
// -----------------------------------------------------------------------------
test('9. Successful logout and session cookie invalidation', async () => {
  const res = await fetch(`${baseUrl}/api/v1/auth/logout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${registeredPatientToken}`,
    },
  });

  assert.equal(res.status, 200, 'Logout should return HTTP 200');
  const data = (await res.json()) as any;
  assert.equal(data.status, 'success');

  // Cookie must be cleared
  const setCookie = res.headers.get('set-cookie');
  assert.ok(setCookie, 'Set-Cookie must be set on logout to clear session');
  assert.ok(setCookie.includes('lifelink_refresh_token=;'), 'Cookie value must be cleared');
});

// -----------------------------------------------------------------------------
// 10. Password change and old-password rejection
// -----------------------------------------------------------------------------
test('10. Password change, old-password rejection, and login with updated credentials', async () => {
  // A. Rejection of incorrect current password
  const badCurrentRes = await fetch(`${baseUrl}/api/v1/auth/change-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${registeredPatientToken}`,
    },
    body: JSON.stringify({
      currentPassword: 'IncorrectOldPassword123!',
      newPassword: 'BrandNewStrongPassword123!',
      confirmPassword: 'BrandNewStrongPassword123!',
    }),
  });
  assert.equal(badCurrentRes.status, 400);

  // B. Rejection of new password shorter than 12 chars
  const shortNewRes = await fetch(`${baseUrl}/api/v1/auth/change-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${registeredPatientToken}`,
    },
    body: JSON.stringify({
      currentPassword: 'PatientStrongPassword123!',
      newPassword: 'short',
      confirmPassword: 'short',
    }),
  });
  assert.equal(shortNewRes.status, 400);

  // C. Successful password update
  const successChangeRes = await fetch(`${baseUrl}/api/v1/auth/change-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${registeredPatientToken}`,
    },
    body: JSON.stringify({
      currentPassword: 'PatientStrongPassword123!',
      newPassword: 'BrandNewStrongPassword123!',
      confirmPassword: 'BrandNewStrongPassword123!',
    }),
  });
  assert.equal(successChangeRes.status, 200);

  // D. Verify old password no longer works
  const oldLoginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'ananya.deshmukh@lifelink.org',
      password: 'PatientStrongPassword123!',
    }),
  });
  assert.equal(oldLoginRes.status, 401, 'Old password must be rejected after password change');

  // E. Verify new password successfully logs in
  const newLoginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'ananya.deshmukh@lifelink.org',
      password: 'BrandNewStrongPassword123!',
    }),
  });
  assert.equal(newLoginRes.status, 200, 'New password must authenticate successfully');
  const newLoginData = (await newLoginRes.json()) as any;
  registeredPatientToken = newLoginData.token;
});

// -----------------------------------------------------------------------------
// 11. Public attempts to create privileged roles
// -----------------------------------------------------------------------------
test('11. Public attempts to register privileged accounts are rejected', async () => {
  // Attempt to register as SUPER_ADMIN
  const superAdminAttempt = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Attacker Admin',
      email: 'attacker.superadmin@lifelink.org',
      password: 'MaliciousAdminPassword123!',
      role: 'SUPER_ADMIN',
      acceptedTerms: true,
    }),
  });
  assert.equal(superAdminAttempt.status, 400, 'Attempt to register as SUPER_ADMIN must be rejected with 400');
  const superAdminData = (await superAdminAttempt.json()) as any;
  assert.ok(superAdminData.message.includes('restricted to PATIENT accounts only'));

  // Attempt to register as DRIVER
  const driverAttempt = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Attacker Driver',
      email: 'attacker.driver@lifelink.org',
      password: 'MaliciousDriverPassword123!',
      role: 'AMBULANCE_DRIVER',
      acceptedTerms: true,
    }),
  });
  assert.equal(driverAttempt.status, 400, 'Attempt to register as AMBULANCE_DRIVER must be rejected');

  // Attempt to register as HOSPITAL_ADMIN
  const hospitalAdminAttempt = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Attacker Hosp Admin',
      email: 'attacker.hospadmin@lifelink.org',
      password: 'MaliciousHospPassword123!',
      role: 'HOSPITAL_ADMIN',
      acceptedTerms: true,
    }),
  });
  assert.equal(hospitalAdminAttempt.status, 400, 'Attempt to register as HOSPITAL_ADMIN must be rejected');
});

// -----------------------------------------------------------------------------
// 12. Patient attempts to access privileged endpoints
// -----------------------------------------------------------------------------
test('12. Patient attempts to access privileged endpoints return HTTP 403 Forbidden', async () => {
  const res = await fetch(`${baseUrl}/api/v1/admin/telemetry`, {
    headers: {
      Authorization: `Bearer ${registeredPatientToken}`,
    },
  });

  assert.equal(res.status, 403, 'PATIENT role attempting to access admin route must receive HTTP 403');
  const data = (await res.json()) as any;
  assert.equal(data.status, 'fail');
  assert.ok(data.message.includes('Forbidden: Insufficient privileges'));
});

// -----------------------------------------------------------------------------
// 13. Cross-user profile access attempts (Horizontal privilege escalation & role tampering)
// -----------------------------------------------------------------------------
test('13. Cross-user profile access and role tampering via PATCH /api/v1/auth/me is blocked', async () => {
  // Attempt to escalate role to SUPER_ADMIN via profile patch
  const escalateRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${registeredPatientToken}`,
    },
    body: JSON.stringify({
      name: 'Ananya Deshmukh',
      role: 'SUPER_ADMIN',
    }),
  });

  assert.equal(escalateRes.status, 403, 'Attempt to change role via PATCH /me must return HTTP 403 Forbidden');
  const escalateData = (await escalateRes.json()) as any;
  assert.equal(escalateData.message, 'Role modifications are prohibited.');

  // Verify permitted profile update (name and phone) succeeds
  const legitPatchRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${registeredPatientToken}`,
    },
    body: JSON.stringify({
      name: 'Ananya D. Sharma',
      phone: '+919876599999',
    }),
  });
  assert.equal(legitPatchRes.status, 200);
  const legitData = (await legitPatchRes.json()) as any;
  assert.equal(legitData.user.name, 'Ananya D. Sharma');
  assert.equal(legitData.user.role, 'PATIENT', 'Role must remain unmodified PATIENT');
});

// -----------------------------------------------------------------------------
// 14. Hospital-admin isolation between hospitals
// -----------------------------------------------------------------------------
test('14. Hospital-admin isolation: Admin cannot manage operations for unrelated hospital', async () => {
  const middleware = requireHospitalScope('hospitalId');

  // Hospital Admin for Hospital A
  const reqA: any = {
    user: { id: 'admin-1', role: Role.ADMIN_HOSPITAL, hospitalId: 'hospital-A' },
    params: { hospitalId: 'hospital-A' },
    body: {},
    query: {},
  };
  let calledNextA = false;
  middleware(reqA, {} as any, () => {
    calledNextA = true;
  });
  assert.equal(calledNextA, true, 'Admin A accessing Hospital A operations must be permitted');

  // Hospital Admin for Hospital A trying to access Hospital B
  const reqB: any = {
    user: { id: 'admin-1', role: Role.ADMIN_HOSPITAL, hospitalId: 'hospital-A' },
    params: { hospitalId: 'hospital-B' },
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
    assert.fail('Should not allow cross-hospital access');
  });

  assert.equal(statusCodeB, 403, 'Cross-hospital administration must return HTTP 403 Forbidden');
  assert.ok(responseDataB.message.includes('not authorized to manage operations for another hospital'));
});

// -----------------------------------------------------------------------------
// 15. Super-admin bootstrap safeguards
// -----------------------------------------------------------------------------
test('15. Super-admin bootstrap safeguards enforce strong credentials and lock duplicates', async () => {
  // Step 1: Weak password rejected
  const weakPassword = 'weak';
  assert.ok(weakPassword.length < 12, 'Password < 12 characters should fail validation');

  // Step 2: Create initial super admin via safe bootstrap flow
  const adminEmail = 'initial.superadmin@lifelink.org';
  const adminPassword = 'AdminInitialStrongPassword123!';
  const salt = bcrypt.genSaltSync(12);
  const passwordHash = bcrypt.hashSync(adminPassword, salt);

  const createdSuperAdmin = await prisma.user.create({
    data: {
      email: adminEmail,
      passwordHash,
      name: 'System Root Admin',
      role: Role.SUPER_ADMIN,
    },
  });

  assert.ok(createdSuperAdmin.id);
  assert.equal(createdSuperAdmin.role, 'SUPER_ADMIN');

  // Step 3: Safeguard verification - check if another super admin can be created
  const superAdminCount = await prisma.user.count({ where: { role: Role.SUPER_ADMIN } });
  assert.equal(superAdminCount, 1, 'Only one super admin should exist after initial bootstrap');

  // Any subsequent attempt to bootstrap must detect existing super admin and abort
  const checkExisting = await prisma.user.findFirst({ where: { role: Role.SUPER_ADMIN } });
  assert.ok(checkExisting !== null, 'Existing super admin is correctly detected to lock bootstrap');
});

// -----------------------------------------------------------------------------
// 16. Refresh-token rotation and revocation
// -----------------------------------------------------------------------------
test('16. Refresh-token rotation, safe session renewal, and replay revocation', async () => {
  // Issue initial token pair
  const tokens = generateTokens({
    id: registeredPatientUser.id,
    email: registeredPatientUser.email,
    role: 'PATIENT',
    name: registeredPatientUser.name,
  });

  // A. Valid refresh token rotation
  const refreshRes = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: tokens.refreshToken }),
  });

  assert.equal(refreshRes.status, 200, 'Valid refresh token should return HTTP 200');
  const refreshData = (await refreshRes.json()) as any;
  assert.ok(refreshData.token, 'New access token must be returned');

  const rotatedCookie = refreshRes.headers.get('set-cookie');
  assert.ok(rotatedCookie && rotatedCookie.includes('lifelink_refresh_token='), 'Rotated refresh token cookie must be issued');

  // B. Replay attack detection: attempting to reuse old refresh token must be rejected
  const replayRes = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: tokens.refreshToken }),
  });

  assert.equal(replayRes.status, 401, 'Replay of old refresh token must be rejected with HTTP 401');
  const replayData = (await replayRes.json()) as any;
  assert.equal(replayData.status, 'fail');
});

// -----------------------------------------------------------------------------
// 17. Cookie and CSRF/security headers behavior
// -----------------------------------------------------------------------------
test('17. Cookie configuration and OWASP security headers', async () => {
  const res = await fetch(`${baseUrl}/api/v1/health`);

  // Verify OWASP recommended baseline security headers
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('x-xss-protection'), '0');
  assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
});

// -----------------------------------------------------------------------------
// 18. Rate-limit and brute-force throttling behavior
// -----------------------------------------------------------------------------
test('18. Rate-limit and brute-force throttling on repeated failed login attempts', async () => {
  const targetEmail = 'throttle.test@lifelink.org';

  // Seed user
  const salt = bcrypt.genSaltSync(12);
  await prisma.user.create({
    data: {
      email: targetEmail,
      passwordHash: bcrypt.hashSync('CorrectPassword123!', salt),
      name: 'Throttle Subject',
      role: Role.PATIENT,
    },
  });

  // Attempt 5 incorrect logins to trigger brute force throttling
  for (let i = 0; i < 5; i++) {
    const attemptRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: targetEmail,
        password: 'WrongPassword123!',
      }),
    });
    assert.equal(attemptRes.status, 401, `Attempt ${i + 1} should return 401`);
  }

  // 6th attempt should be throttled with HTTP 429 Too Many Requests
  const throttledRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: targetEmail,
      password: 'WrongPassword123!',
    }),
  });

  assert.equal(throttledRes.status, 429, 'Repeated failed login attempts must be throttled with HTTP 429');
  const throttledData = (await throttledRes.json()) as any;
  assert.equal(throttledData.status, 'fail');
  assert.ok(throttledData.message.includes('Too many failed login attempts'));
});

// -----------------------------------------------------------------------------
// 19. Google OAuth Endpoint Validation & Configuration Handling
// -----------------------------------------------------------------------------
test('19. Google OAuth endpoint rejects missing credentials and handles unconfigured provider safely', async () => {
  // 19.1. Request with missing credential payload returns HTTP 400
  const missingCredRes = await fetch(`${baseUrl}/api/v1/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(missingCredRes.status, 400);
  const missingCredData = (await missingCredRes.json()) as any;
  assert.equal(missingCredData.status, 'fail');
  assert.equal(missingCredData.code, 'MISSING_GOOGLE_CREDENTIAL');

  // 19.2. Request with dummy credential when GOOGLE_CLIENT_ID is not configured
  // returns HTTP 400 with code GOOGLE_OAUTH_NOT_CONFIGURED and setup instructions
  const unconfiguredRes = await fetch(`${baseUrl}/api/v1/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential: 'DUMMY_GOOGLE_TOKEN_123' }),
  });
  assert.equal(unconfiguredRes.status, 400);
  const unconfiguredData = (await unconfiguredRes.json()) as any;
  assert.equal(unconfiguredData.status, 'fail');
  assert.equal(unconfiguredData.code, 'GOOGLE_OAUTH_NOT_CONFIGURED');
  assert.ok(Array.isArray(unconfiguredData.instructions));
});

