process.env.NODE_ENV = 'test';
process.env.TEST_DB_CONNECTED = 'true';

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import * as jwt from 'jsonwebtoken';
import app from '../src/app';
import prisma from '../src/db';
import { Role, VerificationState, AmbulanceType, TripLifecycleStatus, RequestStatus, DispatchAttemptStatus } from '@prisma/client';
import {
  evaluateDriverDispatchEligibility,
  evaluateAmbulanceDispatchEligibility,
} from '../src/services/dispatchEligibility';
import { atomicallyAcceptOffer } from '../src/services/dispatchEngine';

let server: http.Server;
let baseUrl: string;
const JWT_SECRET = process.env.JWT_SECRET || 'lifelink_jwt_secret_key_2026_super_secure';

function createToken(payload: { id: string; email: string; role: string; name?: string }) {
  return jwt.sign(
    {
      id: payload.id,
      email: payload.email,
      role: payload.role,
      name: payload.name || 'Test User',
    },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

// User IDs & Tokens
const superAdminId = 'usr-superadmin-act-01';
const superAdminToken = createToken({
  id: superAdminId,
  email: 'coo@lifelink.in',
  role: Role.SUPER_ADMIN,
  name: 'Chief Operations Officer',
});

const applicantUserId = 'usr-applicant-hosp-01';
const applicantToken = createToken({
  id: applicantUserId,
  email: 'dr.gupta@shreecare.in',
  role: Role.PATIENT,
  name: 'Dr. Ramesh Gupta',
});

const operatorApplicantId = 'usr-applicant-op-01';
const operatorApplicantToken = createToken({
  id: operatorApplicantId,
  email: 'vikram@vidarbha-ems.in',
  role: Role.PATIENT,
  name: 'Vikram Shinde',
});

const driverUserId = 'usr-driver-pilot-01';
const driverToken = createToken({
  id: driverUserId,
  email: 'santosh.driver@lifelink.in',
  role: Role.DRIVER,
  name: 'Santosh Kumar',
});

// Setup server before tests and close after
test.before(async () => {
  await new Promise<void>((resolve) => {
    server = http.createServer(app);
    server.listen(0, () => {
      const addr = server.address() as any;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });

  (prisma as any).clear();

  // Create base users in database
  await prisma.user.create({
    data: {
      id: superAdminId,
      name: 'Chief Operations Officer',
      email: 'coo@lifelink.in',
      passwordHash: 'hashed_pw',
      role: Role.SUPER_ADMIN,
      phone: '+919876543201',
      isActive: true,
      isSuspended: false,
    },
  });

  await prisma.user.create({
    data: {
      id: applicantUserId,
      name: 'Dr. Ramesh Gupta',
      email: 'dr.gupta@shreecare.in',
      passwordHash: 'hashed_pw',
      role: Role.PATIENT,
      phone: '+919876543202',
      isActive: true,
      isSuspended: false,
    },
  });

  await prisma.user.create({
    data: {
      id: operatorApplicantId,
      name: 'Vikram Shinde',
      email: 'vikram@vidarbha-ems.in',
      passwordHash: 'hashed_pw',
      role: Role.PATIENT,
      phone: '+919876543203',
      isActive: true,
      isSuspended: false,
    },
  });

  await prisma.user.create({
    data: {
      id: driverUserId,
      name: 'Santosh Kumar',
      email: 'santosh.driver@lifelink.in',
      passwordHash: 'hashed_pw',
      role: Role.DRIVER,
      phone: '+919876543204',
      isActive: true,
      isSuspended: false,
    },
  });
});

test.after(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  (prisma as any).clear();
});

// Shared state between test suites
let directoryFacId = 'dir-fac-nagpur-public-01';
let createdHospAppId: string;
let createdHospitalId: string;
let createdOpAppId: string;
let createdOperatorId: string;
let createdDriverAppId: string;
let registeredAmbulanceId: string;

// =============================================================================
// SUITE 1: Public Directory Lifecycle & Anti-Auto-Promotion Invariant
// =============================================================================
test('Suite 1.1: Public Directory record cannot login, has no adminUserId, and cannot accept dispatch', async () => {
  const directoryFac: any = await prisma.directoryFacility.create({
    data: {
      id: directoryFacId,
      name: 'Nagpur Municipal General Hospital',
      facilityType: 'GOVERNMENT_HOSPITAL',
      ownership: 'MUNICIPAL',
      contactNumber: '+917122500100',
      address: 'Sitabuldi Square, Nagpur',
      city: 'Nagpur',
      district: 'Nagpur',
      state: 'Maharashtra',
      sourceUrl: 'https://nagpur.gov.in/health',
      verificationStatus: 'VERIFIED',
      linkStatus: 'UNLINKED',
      onboardingStatus: 'PUBLIC_DIRECTORY_RECORD',
    } as any,
  });

  const user = await prisma.user.findUnique({ where: { id: directoryFac.id } });
  assert.ok(!user, 'Public directory facility must not have a user login account');
  assert.equal(directoryFac.linkStatus, 'UNLINKED');
  assert.ok(!directoryFac.linkedHospitalId);
  assert.equal(directoryFac.onboardingStatus, 'PUBLIC_DIRECTORY_RECORD');
});

test('Suite 1.2: Super-Admin can update directory facility lifecycle state with audit trail', async () => {
  const res = await fetch(`${baseUrl}/api/v1/directory/admin/facilities/${directoryFacId}/status`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${superAdminToken}`,
    },
    body: JSON.stringify({
      onboardingStatus: 'CONTACT_INFO_CHECKED',
      reviewNotes: 'Phone call verified to desk. Contact verified active.',
    }),
  });

  const data: any = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.success, true);
  assert.equal(data.data.onboardingStatus, 'CONTACT_INFO_CHECKED');
  assert.ok(data.data.contactCheckedAt);
});

// =============================================================================
// SUITE 2: Hospital Onboarding Application, Anti-Self-Approval & Promotion
// =============================================================================
test('Suite 2.1: Authorized representative submits complete hospital onboarding application', async () => {
  const res = await fetch(`${baseUrl}/api/v1/onboarding/hospital/apply`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${applicantToken}`,
    },
    body: JSON.stringify({
      hospitalName: 'Shree Care Multispecialty Hospital',
      registrationNumber: 'BNHA-NGP-2024-8891',
      contactPersonName: 'Dr. Ramesh Gupta',
      designation: 'Medical Superintendent',
      contactPhone: '9876543202',
      email: 'dr.gupta@shreecare.in',
      address: 'Wardha Road, Dhantoli, Nagpur',
      city: 'Nagpur',
      district: 'Nagpur',
      state: 'Maharashtra',
      lat: 21.1350,
      lng: 79.0820,
      servicesOffered: ['EMERGENCY_ER', 'ICU', 'CARDIAC', 'TRAUMA'],
      bedCapacityTotal: 50,
      bedCapacityIcu: 12,
      bedCapacityEr: 6,
      documents: [
        { docType: 'BOMBAY_NURSING_HOME_ACT', docNumber: 'BNHA-8891', verified: true },
        { docType: 'FIRE_SAFETY_NOC', docNumber: 'FS-2025-01', verified: true },
      ],
      directoryFacilityId: directoryFacId,
    }),
  });

  const data: any = await res.json();
  assert.equal(res.status, 201);
  assert.equal(data.status, 'success');
  assert.ok(data.application.id);
  assert.equal(data.application.status, 'SUBMITTED');
  createdHospAppId = data.application.id;

  const fac: any = await prisma.directoryFacility.findUnique({ where: { id: directoryFacId } });
  assert.equal(fac?.onboardingStatus, 'ONBOARDING_REQUESTED');
});

test('Suite 2.2: Anti-Self-Approval check: Applicant cannot approve their own application', async () => {
  const res = await fetch(`${baseUrl}/api/v1/onboarding/admin/hospitals/${createdHospAppId}/review`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${applicantToken}`,
    },
    body: JSON.stringify({
      decision: 'APPROVED',
      reviewerNotes: 'Self approval attempt',
    }),
  });

  assert.equal(res.status, 403, 'Applicants must be forbidden from approving applications');
});

test('Suite 2.3: Super-Admin approves hospital application: provisions Hospital, sets ADMIN_HOSPITAL role, and links directory record', async () => {
  const res = await fetch(`${baseUrl}/api/v1/onboarding/admin/hospitals/${createdHospAppId}/review`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${superAdminToken}`,
    },
    body: JSON.stringify({
      decision: 'APPROVED',
      reviewerNotes: 'BNHA registration and Fire NOC confirmed with Nagpur Municipal Corporation records.',
    }),
  });

  const data: any = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.status, 'success');
  assert.equal(data.application.status, 'APPROVED');
  assert.ok(data.hospital?.id);
  assert.equal(data.hospital.verificationState, VerificationState.VERIFIED);
  createdHospitalId = data.hospital.id;

  // Applicant role promoted
  const updatedUser = await prisma.user.findUnique({ where: { id: applicantUserId } });
  assert.equal(updatedUser?.role, Role.ADMIN_HOSPITAL);
  assert.equal(updatedUser?.hospitalId, createdHospitalId);

  // Directory record linked
  const fac: any = await prisma.directoryFacility.findUnique({ where: { id: directoryFacId } });
  assert.equal(fac?.linkStatus, 'LINKED_PARTNER');
  assert.equal(fac?.onboardingStatus, 'APPROVED');
  assert.equal(fac?.linkedHospitalId, createdHospitalId);
});

// =============================================================================
// SUITE 3: Private Ambulance Operator Onboarding Workflow
// =============================================================================
test('Suite 3.1: Private operator submits application with trade license and declared fleet', async () => {
  const res = await fetch(`${baseUrl}/api/v1/onboarding/operator/apply`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${operatorApplicantToken}`,
    },
    body: JSON.stringify({
      operatorName: 'Vidarbha EMS & Critical Care Ambulances',
      tradeLicense: 'RTO-NGP-COMM-2023-4410',
      contactPersonName: 'Vikram Shinde',
      designation: 'Managing Partner',
      contactPhone: '9876543203',
      email: 'vikram@vidarbha-ems.in',
      address: 'Ganeshpeth Colony, Nagpur',
      city: 'Nagpur',
      district: 'Nagpur',
      operatingArea: 'Nagpur District Wide',
      declaredFleetSize: 4,
      documents: [{ docType: 'RTO_COMMERCIAL_PERMIT', docNumber: 'RTO-4410', verified: true }],
    }),
  });

  const data: any = await res.json();
  assert.equal(res.status, 201);
  assert.equal(data.status, 'success');
  assert.ok(data.application?.id);
  createdOpAppId = data.application.id;
});

test('Suite 3.2: Super-Admin approves operator: provisions AmbulanceOperator and sets OPERATOR_ADMIN role', async () => {
  const res = await fetch(`${baseUrl}/api/v1/onboarding/admin/operators/${createdOpAppId}/review`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${superAdminToken}`,
    },
    body: JSON.stringify({
      decision: 'APPROVED',
      reviewerNotes: 'RTO commercial fleet permits and commercial insurance verified.',
    }),
  });

  const data: any = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.status, 'success');
  assert.ok(data.operator?.id);
  assert.equal(data.operator.verificationState, VerificationState.VERIFIED);
  createdOperatorId = data.operator.id;

  const user = await prisma.user.findUnique({ where: { id: operatorApplicantId } });
  assert.equal(user?.role, Role.OPERATOR_ADMIN);
  assert.equal(user?.operatorId, createdOperatorId);
});

// =============================================================================
// SUITE 4: Driver Verification & Credential Expiry Invalidation
// =============================================================================
test('Suite 4.1: Rejects driver application with an already expired driving license', async () => {
  const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const res = await fetch(`${baseUrl}/api/v1/onboarding/driver/apply`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${driverToken}`,
    },
    body: JSON.stringify({
      fullName: 'Santosh Kumar',
      phone: '9876543204',
      licenseNumber: 'MH-31-EXPIRED-99',
      licenseExpiry: yesterday,
      organizationType: 'HOSPITAL',
      organizationId: createdHospitalId,
    }),
  });

  const data: any = await res.json();
  assert.equal(res.status, 400);
  assert.equal(data.code, 'LICENSE_EXPIRED');
});

test('Suite 4.2: Accepts valid driver application and Super-Admin approves verification', async () => {
  const nextYear = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
  const applyRes = await fetch(`${baseUrl}/api/v1/onboarding/driver/apply`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${driverToken}`,
    },
    body: JSON.stringify({
      fullName: 'Santosh Kumar',
      phone: '9876543204',
      licenseNumber: 'MH-31-COMM-2024-5512',
      licenseExpiry: nextYear,
      badgeNumber: 'BDG-NGP-1120',
      organizationType: 'HOSPITAL',
      organizationId: createdHospitalId,
    }),
  });

  const applyData: any = await applyRes.json();
  assert.equal(applyRes.status, 201);
  createdDriverAppId = applyData.application.id;

  const reviewRes = await fetch(`${baseUrl}/api/v1/onboarding/admin/drivers/${createdDriverAppId}/review`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${superAdminToken}`,
    },
    body: JSON.stringify({
      decision: 'APPROVED',
      reviewerNotes: 'Sarathi portal license confirmed and background verification clear.',
    }),
  });

  const reviewData: any = await reviewRes.json();
  assert.equal(reviewRes.status, 200);
  assert.equal(reviewData.status, 'success');

  const profile = await prisma.driverProfile.findUnique({ where: { userId: driverUserId } });
  assert.equal(profile?.verificationState, VerificationState.VERIFIED);
  assert.equal(profile?.membershipStatus, 'APPROVED');
});

// =============================================================================
// SUITE 5: Real Vehicle Registration & Non-Overlapping Driver Assignment
// =============================================================================
test('Suite 5.1: Hospital admin registers real ambulance vehicle starting in PENDING_REVIEW', async () => {
  const updatedApplicantToken = createToken({
    id: applicantUserId,
    email: 'dr.gupta@shreecare.in',
    role: Role.ADMIN_HOSPITAL,
    name: 'Dr. Ramesh Gupta',
  });

  const res = await fetch(`${baseUrl}/api/v1/ambulances/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${updatedApplicantToken}`,
    },
    body: JSON.stringify({
      vehicleNumber: 'MH-31-AP-7700',
      ambulanceType: 'ADVANCED_LIFE_SUPPORT',
      chassisNumber: 'MAT7700XYZ123456',
    }),
  });

  const data: any = await res.json();
  assert.equal(res.status, 201);
  assert.ok(data.ambulance?.id);
  assert.equal(data.ambulance.verificationState, 'PENDING_REVIEW');
  assert.equal(data.ambulance.isAvailable, false);
  registeredAmbulanceId = data.ambulance.id;
});

test('Suite 5.2: Assign driver to ambulance establishes valid non-overlapping link', async () => {
  const updatedApplicantToken = createToken({
    id: applicantUserId,
    email: 'dr.gupta@shreecare.in',
    role: Role.ADMIN_HOSPITAL,
    name: 'Dr. Ramesh Gupta',
  });

  // Promote vehicle to VERIFIED for testing assignment
  await prisma.ambulance.update({
    where: { id: registeredAmbulanceId },
    data: { verificationState: 'VERIFIED' as any, verificationStatus: 'APPROVED' },
  });

  const res = await fetch(`${baseUrl}/api/v1/ambulances/${registeredAmbulanceId}/assign-driver`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${updatedApplicantToken}`,
    },
    body: JSON.stringify({
      driverUserId: driverUserId,
    }),
  });

  const data: any = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.status, 'success');
  assert.equal(data.assignment.isCurrent, true);

  const amb = await prisma.ambulance.findUnique({ where: { id: registeredAmbulanceId } });
  assert.equal(amb?.driverId, driverUserId);
  assert.equal(amb?.isAvailable, true);
});

test('Suite 5.3: Concurrency Conflict: Cannot assign same driver to a second vehicle simultaneously', async () => {
  const updatedApplicantToken = createToken({
    id: applicantUserId,
    email: 'dr.gupta@shreecare.in',
    role: Role.ADMIN_HOSPITAL,
    name: 'Dr. Ramesh Gupta',
  });

  const secondAmb = await prisma.ambulance.create({
    data: {
      vehicleNumber: 'MH-31-AP-8800',
      ambulanceType: 'BASIC_LIFE_SUPPORT',
      hospitalId: createdHospitalId,
      verificationState: 'VERIFIED' as any,
      verificationStatus: 'APPROVED',
      isAvailable: false,
      currentLat: 21.1458,
      currentLng: 79.0882,
    },
  });

  const res = await fetch(`${baseUrl}/api/v1/ambulances/${secondAmb.id}/assign-driver`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${updatedApplicantToken}`,
    },
    body: JSON.stringify({
      driverUserId: driverUserId,
    }),
  });

  const data: any = await res.json();
  assert.equal(res.status, 409);
  assert.equal(data.code, 'DRIVER_ALREADY_ASSIGNED');
});

// =============================================================================
// SUITE 6: 12-Point Authoritative Dispatch Eligibility Engine
// =============================================================================
test('Suite 6.1: Passes all 12 checks when driver, rig, assignment, and live GPS are verified and fresh', async () => {
  await prisma.ambulance.update({
    where: { id: registeredAmbulanceId },
    data: {
      currentLat: 21.1458,
      currentLng: 79.0882,
      lastUpdated: new Date(),
      isAvailable: true,
      maintenanceStatus: 'OPERATIONAL',
    },
  });

  const eligibility = await evaluateDriverDispatchEligibility(driverUserId);
  assert.equal(eligibility.isEligible, true);
  assert.equal(eligibility.reasons.length, 0);
  assert.equal(eligibility.details.driverAccountActive, true);
  assert.equal(eligibility.details.driverVerified, true);
  assert.equal(eligibility.details.credentialsCurrent, true);
  assert.equal(eligibility.details.organizationApproved, true);
  assert.equal(eligibility.details.ambulanceAssigned, true);
  assert.equal(eligibility.details.ambulanceVerified, true);
  assert.equal(eligibility.details.ambulanceAvailable, true);
  assert.equal(eligibility.details.notInMaintenance, true);
  assert.equal(eligibility.details.notOnActiveTrip, true);
  assert.equal(eligibility.details.locationFresh, true);
});

test('Suite 6.2: Rejects vehicle if GPS location is stale (> 5 minutes / 300s)', async () => {
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
  await prisma.ambulance.update({
    where: { id: registeredAmbulanceId },
    data: { lastUpdated: tenMinutesAgo },
  });

  const eligibility = await evaluateDriverDispatchEligibility(driverUserId, { maxGpsAgeSeconds: 300 });
  assert.equal(eligibility.isEligible, false);
  assert.equal(eligibility.details.locationFresh, false);
  assert.ok(eligibility.reasons.includes('STALE_GPS_LOCATION'));

  // Restore fresh GPS
  await prisma.ambulance.update({
    where: { id: registeredAmbulanceId },
    data: { lastUpdated: new Date() },
  });
});

test('Suite 6.3: Rejects vehicle if committed to an active emergency trip', async () => {
  const reqRecord = await prisma.emergencyRequest.create({
    data: {
      id: 'req-active-trip-test',
      patientId: applicantUserId,
      pickupLat: 21.1458,
      pickupLng: 79.0882,
      pickupAddress: 'Sitabuldi, Nagpur',
      status: RequestStatus.ACCEPTED,
    },
  });

  const trip = await prisma.emergencyTrip.create({
    data: {
      id: 'trip-active-test',
      requestId: reqRecord.id,
      ambulanceId: registeredAmbulanceId,
      driverId: driverUserId,
      status: TripLifecycleStatus.ACCEPTED,
      pickupLat: 21.1458,
      pickupLng: 79.0882,
    },
  });

  const eligibility = await evaluateDriverDispatchEligibility(driverUserId);
  assert.equal(eligibility.isEligible, false);
  assert.equal(eligibility.details.notOnActiveTrip, false);
  assert.ok(eligibility.reasons.includes('AMBULANCE_ALREADY_COMMITTED_TO_ACTIVE_TRIP'));

  // Clean up trip
  await prisma.emergencyTrip.update({
    where: { id: trip.id },
    data: { status: TripLifecycleStatus.COMPLETED },
  });
});

// =============================================================================
// SUITE 7: Concurrency Mutex & Atomic Offer Acceptance
// =============================================================================
test('Suite 7.1: Driver atomically accepts dispatch offer, creating trip and marking ambulance unavailable', async () => {
  await prisma.ambulance.update({
    where: { id: registeredAmbulanceId },
    data: { isAvailable: true, lastUpdated: new Date() },
  });

  const reqRecord = await prisma.emergencyRequest.create({
    data: {
      id: 'req-concurrency-test',
      patientId: applicantUserId,
      pickupLat: 21.1458,
      pickupLng: 79.0882,
      pickupAddress: 'Medical Square, Nagpur',
      status: RequestStatus.OFFERED,
    },
  });

  const attemptRecord = await prisma.dispatchAttempt.create({
    data: {
      id: 'att-concurrency-01',
      requestId: reqRecord.id,
      ambulanceId: registeredAmbulanceId,
      driverId: driverUserId,
      status: DispatchAttemptStatus.OFFERED,
      expiresAt: new Date(Date.now() + 45000),
      distanceKm: 2.5,
    },
  });

  const result = await atomicallyAcceptOffer(attemptRecord.id, driverUserId);
  assert.equal(result.success, true);
  assert.ok(result.trip);
  assert.equal(result.trip.status, TripLifecycleStatus.ACCEPTED);

  const amb = await prisma.ambulance.findUnique({ where: { id: registeredAmbulanceId } });
  assert.equal(amb?.isAvailable, false);

  const reqUpdated = await prisma.emergencyRequest.findUnique({ where: { id: reqRecord.id } });
  assert.equal(reqUpdated?.status, RequestStatus.ACCEPTED);

  // Suite 7.2: Double-Accept Rejection
  const secondResult = await atomicallyAcceptOffer(attemptRecord.id, driverUserId);
  assert.equal(secondResult.success, false);
  assert.equal(secondResult.code, 'OFFER_NOT_OFFERED');
});

// =============================================================================
// SUITE 8: Controlled Pilot Activation Prerequisites Switchboard
// =============================================================================
test('Suite 8.1: Pilot activation strictly BLOCKED if organization has 0 verified ambulances or drivers', async () => {
  const unverifiedOrg = await prisma.ambulanceOperator.create({
    data: {
      id: 'op-unverified-raw-01',
      name: 'Unverified Operator Nagpur',
      tradeLicense: 'TRADE-999',
      contactPhone: '+917122999999',
      email: 'unverified@test.com',
      address: 'Ganeshpeth, Nagpur',
      verificationState: 'PENDING_REVIEW' as any,
      adminUserId: 'dummy-admin-id',
    },
  });

  const res = await fetch(`${baseUrl}/api/v1/onboarding/admin/pilot-checklists/${unverifiedOrg.id}/activate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${superAdminToken}`,
    },
    body: JSON.stringify({ notes: 'Premature activation attempt' }),
  });

  const data: any = await res.json();
  assert.equal(res.status, 400);
  assert.equal(data.verdict, 'BLOCKED');
  assert.ok(data.blockers.length > 0);
  assert.ok(data.blockers.includes('ORGANIZATION_NOT_APPROVED'));
});

test('Suite 8.2: Authorizes pilot activation when organization satisfies all operational prerequisites', async () => {
  // Ensure hospital has live GPS on verified fleet
  await prisma.ambulance.update({
    where: { id: registeredAmbulanceId },
    data: { lastUpdated: new Date() },
  });

  const res = await fetch(`${baseUrl}/api/v1/onboarding/admin/pilot-checklists/${createdHospitalId}/activate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${superAdminToken}`,
    },
    body: JSON.stringify({ notes: 'All prerequisites verified for Shree Care Hospital Nagpur.' }),
  });

  const data: any = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.status, 'success');
  assert.equal(data.checklist.activationStatus, 'PILOT_ACTIVE');
});
