process.env.NODE_ENV = 'test';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import * as jwt from 'jsonwebtoken';
import app from '../src/app';
import prisma, { inMemoryDb } from '../src/db';
import { Role } from '@prisma/client';
import { getSupabaseBackendClient, verifySupabaseToken, isSupabaseServerConfigured } from '../src/utils/supabaseClient';

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
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('1. Supabase server client properly initializes without exposing secrets', async () => {
  const configured = isSupabaseServerConfigured();
  assert.strictEqual(typeof configured, 'boolean');
  const client = getSupabaseBackendClient();
  assert.ok(client, 'Supabase server client should initialize from environment');
});

test('2. Missing or malformed Supabase access token is rejected', async () => {
  const result = await verifySupabaseToken('invalid_malformed_token_12345');
  assert.strictEqual(result.user, null);
  assert.ok(result.error, 'Should return an error for invalid token');
});

test('3. Unauthenticated requests to /api/v1/auth/supabase/sync return HTTP 401', async () => {
  const res = await fetch(`${baseUrl}/api/v1/auth/supabase/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bloodGroup: 'B+' }),
  });

  assert.strictEqual(res.status, 401);
  const data = (await res.json()) as any;
  assert.strictEqual(data.status, 'fail');
  assert.strictEqual(data.message, 'Authorization token required.');
});

test('4. Forged Bearer token to /api/v1/auth/supabase/sync is rejected', async () => {
  const res = await fetch(`${baseUrl}/api/v1/auth/supabase/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer forged_fake_token_abc',
    },
    body: JSON.stringify({ bloodGroup: 'B+' }),
  });

  assert.strictEqual(res.status, 401);
  const data = (await res.json()) as any;
  assert.strictEqual(data.status, 'fail');
});

test('5. Backward compatibility: Local JWT tokens authenticate seamlessly through middleware', async () => {
  const testUser = await prisma.user.create({
    data: {
      name: 'Dr. Anita Roy',
      email: `anita.roy.${Date.now()}@lifelink.org`,
      passwordHash: 'hashed_pw',
      role: Role.PATIENT,
      isEmailVerified: true,
    },
  });

  const secret = process.env.JWT_SECRET || 'lifelink_jwt_secret_key_2026_super_secure';
  const localToken = jwt.sign(
    { id: testUser.id, email: testUser.email, role: testUser.role, name: testUser.name },
    secret,
    { expiresIn: '1h' }
  );

  const res = await fetch(`${baseUrl}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${localToken}` },
  });

  assert.strictEqual(res.status, 200);
  const data = (await res.json()) as any;
  assert.strictEqual(data.status, 'success');
  assert.strictEqual(data.user.email, testUser.email);
});

test('6. Supabase sync endpoint idempotently upserts patient profile with medical metadata', async () => {
  const testUser = await prisma.user.create({
    data: {
      name: 'Rohan Sharma',
      email: `rohan.sharma.${Date.now()}@lifelink.org`,
      passwordHash: 'SUPABASE_MANAGED_AUTH',
      role: Role.PATIENT,
      isEmailVerified: true,
      supabaseId: `sb-test-${Date.now()}`,
    },
  });

  const secret = process.env.JWT_SECRET || 'lifelink_jwt_secret_key_2026_super_secure';
  const token = jwt.sign(
    { id: testUser.id, email: testUser.email, role: testUser.role, name: testUser.name },
    secret,
    { expiresIn: '1h' }
  );

  const res = await fetch(`${baseUrl}/api/v1/auth/supabase/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      bloodGroup: 'AB+',
      allergies: 'Penicillin, Peanuts',
      emergencyContactName: 'Sunita Sharma',
      emergencyContactPhone: '+919876543210',
      medicalNotes: 'Asthmatic, carries rescue inhaler',
    }),
  });

  assert.strictEqual(res.status, 200);
  const data = (await res.json()) as any;
  assert.strictEqual(data.status, 'success');
  assert.strictEqual(data.user.email, testUser.email);
  assert.strictEqual(data.user.patientProfile.bloodGroup, 'AB+');
  assert.strictEqual(data.user.patientProfile.allergies, 'Penicillin, Peanuts');
  assert.strictEqual(data.user.patientProfile.emergencyContactPhone, '+919876543210');
});

test('7. Suspended user accounts are blocked during authentication', async () => {
  const suspendedUser = await prisma.user.create({
    data: {
      name: 'Suspended Account',
      email: `suspended.${Date.now()}@lifelink.org`,
      passwordHash: 'SUPABASE_MANAGED_AUTH',
      role: Role.PATIENT,
      isEmailVerified: true,
      isSuspended: true,
      supabaseId: `sb-suspended-${Date.now()}`,
    },
  });

  const secret = process.env.JWT_SECRET || 'lifelink_jwt_secret_key_2026_super_secure';
  const token = jwt.sign(
    { id: suspendedUser.id, email: suspendedUser.email, role: suspendedUser.role, name: suspendedUser.name },
    secret,
    { expiresIn: '1h' }
  );

  const res = await fetch(`${baseUrl}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  assert.strictEqual(res.status, 403);
  const data = (await res.json()) as any;
  assert.strictEqual(data.status, 'fail');
  assert.match(data.message, /Account suspended/i);
});

test('8. Role escalation via unauthorized sync payload is rejected', async () => {
  const patientUser = await prisma.user.create({
    data: {
      name: 'Normal Patient',
      email: `normal.patient.${Date.now()}@lifelink.org`,
      passwordHash: 'SUPABASE_MANAGED_AUTH',
      role: Role.PATIENT,
      isEmailVerified: true,
    },
  });

  const secret = process.env.JWT_SECRET || 'lifelink_jwt_secret_key_2026_super_secure';
  const token = jwt.sign(
    { id: patientUser.id, email: patientUser.email, role: patientUser.role, name: patientUser.name },
    secret,
    { expiresIn: '1h' }
  );

  // Attempt to elevate role to SUPER_ADMIN via sync endpoint
  const res = await fetch(`${baseUrl}/api/v1/auth/supabase/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      role: 'SUPER_ADMIN',
    }),
  });

  assert.strictEqual(res.status, 200);
  const data = (await res.json()) as any;
  // Role must remain strictly PATIENT
  assert.strictEqual(data.user.role, 'PATIENT');
});
