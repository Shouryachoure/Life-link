process.env.NODE_ENV = 'test';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import app from '../src/app';
import prisma, { inMemoryDb } from '../src/db';

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
// 1. Email OTP Registration Journey
// -----------------------------------------------------------------------------
let emailOtpCode: string;
const testEmail = 'aarav.patel@lifelink.org';

test('1. Dispatch Email OTP for user registration with masked recipient and cooldown feedback', async () => {
  const res = await fetch(`${baseUrl}/api/v1/auth/otp/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identifier: testEmail,
      channel: 'EMAIL',
      purpose: 'REGISTRATION',
    }),
  });

  assert.equal(res.status, 200);
  const data = (await res.json()) as any;

  assert.equal(data.status, 'success');
  assert.equal(data.channel, 'EMAIL');
  assert.ok(data.maskedRecipient.includes('****'), 'Recipient email must be masked for privacy');
  assert.ok(data.maskedRecipient.includes('@lifelink.org'));
  assert.equal(data.cooldownSeconds, 60);
  assert.ok(data.expiresInSeconds >= 300);
  assert.ok(data.deliveryFeedback, 'Delivery feedback message must be present');
  assert.ok(data.mockCode, 'Test environment exposes mockCode for automated verification');

  emailOtpCode = data.mockCode;
});

// -----------------------------------------------------------------------------
// 2. Resend Cooldown Enforcement
// -----------------------------------------------------------------------------
test('2. Resend cooldown enforcement blocks immediate duplicate OTP requests', async () => {
  const res = await fetch(`${baseUrl}/api/v1/auth/otp/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identifier: testEmail,
      channel: 'EMAIL',
      purpose: 'REGISTRATION',
    }),
  });

  assert.equal(res.status, 429, 'Immediate OTP resend must return HTTP 429 Too Many Requests');
  const data = (await res.json()) as any;
  assert.equal(data.status, 'fail');
  assert.ok(data.message.includes('second(s) before requesting'));
});

// -----------------------------------------------------------------------------
// 3. Incorrect OTP and Attempt Limits
// -----------------------------------------------------------------------------
test('3. Incorrect OTP codes decrement attempts and lock after 3 failures', async () => {
  // Attempt 1: wrong code
  const res1 = await fetch(`${baseUrl}/api/v1/auth/otp/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identifier: testEmail,
      channel: 'EMAIL',
      purpose: 'REGISTRATION',
      code: '000000',
    }),
  });
  assert.equal(res1.status, 400);
  const data1 = (await res1.json()) as any;
  assert.equal(data1.remainingAttempts, 2);

  // Attempt 2: wrong code
  const res2 = await fetch(`${baseUrl}/api/v1/auth/otp/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identifier: testEmail,
      channel: 'EMAIL',
      purpose: 'REGISTRATION',
      code: '111111',
    }),
  });
  assert.equal(res2.status, 400);
  const data2 = (await res2.json()) as any;
  assert.equal(data2.remainingAttempts, 1);

  // Attempt 3: wrong code -> Invalidates OTP
  const res3 = await fetch(`${baseUrl}/api/v1/auth/otp/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identifier: testEmail,
      channel: 'EMAIL',
      purpose: 'REGISTRATION',
      code: '222222',
    }),
  });
  assert.equal(res3.status, 400);
  const data3 = (await res3.json()) as any;
  assert.equal(data3.remainingAttempts, 0);
  assert.ok(data3.message.includes('exceeded maximum verification attempts'));

  // Attempt 4: Even with original code, code is permanently invalidated
  const res4 = await fetch(`${baseUrl}/api/v1/auth/otp/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identifier: testEmail,
      channel: 'EMAIL',
      purpose: 'REGISTRATION',
      code: emailOtpCode,
    }),
  });
  assert.equal(res4.status, 400);
});

// -----------------------------------------------------------------------------
// 4. Successful Email OTP Verification & Account Activation
// -----------------------------------------------------------------------------
let registeredPatientToken: string;
let registeredPatientUser: any;

test('4. Successful Email OTP verification activates account and issues session', async () => {
  // Request fresh OTP for a new recipient
  const freshEmail = 'kavita.joshi@lifelink.org';
  const sendRes = await fetch(`${baseUrl}/api/v1/auth/otp/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identifier: freshEmail,
      channel: 'EMAIL',
      purpose: 'REGISTRATION',
    }),
  });
  assert.equal(sendRes.status, 200);
  const sendData = (await sendRes.json()) as any;
  const validCode = sendData.mockCode;

  // Verify and activate
  const verifyRes = await fetch(`${baseUrl}/api/v1/auth/otp/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identifier: freshEmail,
      channel: 'EMAIL',
      purpose: 'REGISTRATION',
      code: validCode,
      registrationData: {
        name: 'Kavita Joshi',
        email: freshEmail,
        password: 'KavitaSecurePassword123!',
        confirmPassword: 'KavitaSecurePassword123!',
        phone: '+919876544444',
        bloodGroup: 'A+',
        allergies: 'Penicillin',
      },
    }),
  });

  assert.equal(verifyRes.status, 201, 'Account activation should return HTTP 201 Created');
  const verifyData = (await verifyRes.json()) as any;
  assert.equal(verifyData.status, 'success');
  assert.ok(verifyData.token, 'Access token must be returned');
  assert.equal(verifyData.user.email, freshEmail);
  assert.equal(verifyData.user.isEmailVerified, true, 'isEmailVerified must be set to true');
  assert.equal(verifyData.user.role, 'PATIENT');
  assert.equal(verifyData.user.patientProfile?.bloodGroup, 'A+');

  registeredPatientToken = verifyData.token;
  registeredPatientUser = verifyData.user;
});

// -----------------------------------------------------------------------------
// 5. Anti-Replay: Verify Code Cannot Be Reused
// -----------------------------------------------------------------------------
test('5. Single-use consumption prevents OTP replay attack', async () => {
  const replayRes = await fetch(`${baseUrl}/api/v1/auth/otp/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identifier: 'kavita.joshi@lifelink.org',
      channel: 'EMAIL',
      purpose: 'REGISTRATION',
      code: 'any-code',
    }),
  });
  assert.equal(replayRes.status, 400);
});

// -----------------------------------------------------------------------------
// 6. Duplicate Registration Protection
// -----------------------------------------------------------------------------
test('6. Duplicate registration for already registered email is rejected', async () => {
  const dupRes = await fetch(`${baseUrl}/api/v1/auth/otp/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identifier: 'kavita.joshi@lifelink.org',
      channel: 'EMAIL',
      purpose: 'REGISTRATION',
    }),
  });
  assert.equal(dupRes.status, 400);
  const dupData = (await dupRes.json()) as any;
  assert.ok(dupData.message.includes('already exists'));
});

// -----------------------------------------------------------------------------
// 7. SMS OTP Phone Registration Journey
// -----------------------------------------------------------------------------
test('7. SMS OTP registration with Indian phone number (+91) and unconfigured provider feedback', async () => {
  const phone = '9876555555';
  const sendRes = await fetch(`${baseUrl}/api/v1/auth/otp/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identifier: phone,
      channel: 'PHONE',
      purpose: 'REGISTRATION',
    }),
  });

  assert.equal(sendRes.status, 200);
  const sendData = (await sendRes.json()) as any;
  assert.equal(sendData.channel, 'PHONE');
  assert.equal(sendData.identifier, '+919876555555');
  assert.ok(sendData.maskedRecipient.includes('****'));
  // Feedback must clearly report configuration state
  assert.ok(sendData.deliveryFeedback.length > 0);
  const smsCode = sendData.mockCode;

  // Complete phone registration
  const verifyRes = await fetch(`${baseUrl}/api/v1/auth/otp/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identifier: '+919876555555',
      channel: 'PHONE',
      purpose: 'REGISTRATION',
      code: smsCode,
      registrationData: {
        name: 'Suresh Patil',
        email: 'suresh.patil@lifelink.org',
        password: 'SureshSecurePassword123!',
        confirmPassword: 'SureshSecurePassword123!',
        phone: '+919876555555',
      },
    }),
  });

  assert.equal(verifyRes.status, 201);
  const verifyData = (await verifyRes.json()) as any;
  assert.equal(verifyData.user.isPhoneVerified, true, 'isPhoneVerified must be set to true');
  assert.equal(verifyData.user.name, 'Suresh Patil');
});

// -----------------------------------------------------------------------------
// 8. Passwordless OTP Login
// -----------------------------------------------------------------------------
test('8. Passwordless login using Email OTP', async () => {
  // Step 1: Request login OTP for existing user
  const sendRes = await fetch(`${baseUrl}/api/v1/auth/otp/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identifier: 'kavita.joshi@lifelink.org',
      channel: 'EMAIL',
      purpose: 'LOGIN',
    }),
  });

  assert.equal(sendRes.status, 200);
  const sendData = (await sendRes.json()) as any;
  const loginCode = sendData.mockCode;

  // Step 2: Verify login OTP
  const loginRes = await fetch(`${baseUrl}/api/v1/auth/otp/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identifier: 'kavita.joshi@lifelink.org',
      channel: 'EMAIL',
      purpose: 'LOGIN',
      code: loginCode,
    }),
  });

  assert.equal(loginRes.status, 200);
  const loginData = (await loginRes.json()) as any;
  assert.equal(loginData.status, 'success');
  assert.ok(loginData.token, 'JWT access token must be issued on passwordless OTP login');
  assert.equal(loginData.user.email, 'kavita.joshi@lifelink.org');
});

// -----------------------------------------------------------------------------
// 9. Forgot Password Workflow via OTP
// -----------------------------------------------------------------------------
test('9. Full Password Recovery: Request OTP -> Verify -> Reset Password -> Login with New Password', async () => {
  // Step 1: Request password reset OTP
  const reqRes = await fetch(`${baseUrl}/api/v1/auth/forgot-password/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identifier: 'kavita.joshi@lifelink.org',
    }),
  });
  assert.equal(reqRes.status, 200);
  const reqData = (await reqRes.json()) as any;
  const resetOtp = reqData.mockCode;

  // Step 2: Verify OTP and receive short-lived reset token
  const verifyOtpRes = await fetch(`${baseUrl}/api/v1/auth/otp/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identifier: 'kavita.joshi@lifelink.org',
      channel: 'EMAIL',
      purpose: 'PASSWORD_RESET',
      code: resetOtp,
    }),
  });
  assert.equal(verifyOtpRes.status, 200);
  const verifyOtpData = (await verifyOtpRes.json()) as any;
  assert.ok(verifyOtpData.resetToken, 'Short-lived resetToken must be returned');

  // Step 3: Reset password with validation (attempt short password first)
  const shortPassRes = await fetch(`${baseUrl}/api/v1/auth/forgot-password/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      resetToken: verifyOtpData.resetToken,
      newPassword: 'short',
      confirmPassword: 'short',
    }),
  });
  assert.equal(shortPassRes.status, 400, 'Password under 12 characters must fail');

  // Valid password update
  const newPass = 'KavitaBrandNewPass2026!';
  const resetRes = await fetch(`${baseUrl}/api/v1/auth/forgot-password/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      resetToken: verifyOtpData.resetToken,
      newPassword: newPass,
      confirmPassword: newPass,
    }),
  });
  assert.equal(resetRes.status, 200);

  // Step 4: Old password should now fail
  const oldLoginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'kavita.joshi@lifelink.org',
      password: 'KavitaSecurePassword123!',
    }),
  });
  assert.equal(oldLoginRes.status, 401, 'Old password must be rejected');

  // Step 5: New password succeeds
  const newLoginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'kavita.joshi@lifelink.org',
      password: newPass,
    }),
  });
  assert.equal(newLoginRes.status, 200, 'New password must allow successful login');
  const newLoginData = (await newLoginRes.json()) as any;
  assert.ok(newLoginData.token);
});

// -----------------------------------------------------------------------------
// 10. Tampered Reset Token Rejection
// -----------------------------------------------------------------------------
test('10. Tampered or forged reset token is rejected', async () => {
  const forgedRes = await fetch(`${baseUrl}/api/v1/auth/forgot-password/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      resetToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.fake',
      newPassword: 'ValidPassword12345!',
      confirmPassword: 'ValidPassword12345!',
    }),
  });
  assert.equal(forgedRes.status, 400);
});
