import { Router } from 'express';
import { Role, VerificationState, AmbulanceType } from '@prisma/client';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import prisma from '../db';
import { logSecurityEvent } from '../utils/securityLogger';
import { dispatchNotification } from '../services/notificationService';
import { evaluateAmbulanceDispatchEligibility } from '../services/dispatchEligibility';

const db = prisma as any;
const router = Router();

// Indian Phone Number Normalization
function normalizeIndianPhone(input: string): string {
  if (!input) return '';
  const digits = input.replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `+91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  return input.trim();
}

// -------------------------------------------------------------
// 1. HOSPITAL ONBOARDING APPLICANT ENDPOINTS
// -------------------------------------------------------------

/**
 * POST /api/v1/onboarding/hospital/apply
 * Allows an authorized hospital representative to submit an onboarding application.
 */
router.post('/hospital/apply', authenticate, async (req: AuthRequest, res) => {
  const user = req.user!;
  const {
    hospitalName,
    registrationNumber,
    contactPersonName,
    designation,
    contactPhone,
    email,
    address,
    city = 'Nagpur',
    district = 'Nagpur',
    state = 'Maharashtra',
    lat,
    lng,
    servicesOffered,
    bedCapacityTotal,
    bedCapacityIcu,
    bedCapacityEr,
    documents,
    directoryFacilityId,
  } = req.body;

  if (!hospitalName || !registrationNumber || !contactPersonName || !contactPhone || !email || !address) {
    return res.status(400).json({
      status: 'fail',
      message: 'hospitalName, registrationNumber, contactPersonName, contactPhone, email, and address are required.',
    });
  }

  const normPhone = normalizeIndianPhone(contactPhone);

  try {
    // If linking to a directory facility, verify it exists
    if (directoryFacilityId) {
      const facility = await db.directoryFacility.findUnique({ where: { id: directoryFacilityId } });
      if (!facility) {
        return res.status(404).json({ status: 'fail', message: 'Referenced directory facility not found.' });
      }
      // Update directory facility lifecycle state
      await db.directoryFacility.update({
        where: { id: directoryFacilityId },
        data: { onboardingStatus: 'ONBOARDING_REQUESTED' },
      });
    }

    const application = await db.hospitalOnboardingApplication.create({
      data: {
        hospitalName: hospitalName.trim(),
        registrationNumber: registrationNumber.trim(),
        contactPersonName: contactPersonName.trim(),
        designation: designation ? designation.trim() : 'Hospital Administrator',
        contactPhone: normPhone,
        email: email.toLowerCase().trim(),
        address: address.trim(),
        city,
        district,
        state,
        lat: lat ? parseFloat(lat) : 21.1458,
        lng: lng ? parseFloat(lng) : 79.0882,
        servicesOffered: servicesOffered || ['EMERGENCY_ER', 'GENERAL_WARD'],
        bedCapacityTotal: bedCapacityTotal ? parseInt(bedCapacityTotal, 10) : 0,
        bedCapacityIcu: bedCapacityIcu ? parseInt(bedCapacityIcu, 10) : 0,
        bedCapacityEr: bedCapacityEr ? parseInt(bedCapacityEr, 10) : 0,
        documents: documents || [],
        status: 'SUBMITTED',
        applicantUserId: user.id,
        directoryFacilityId: directoryFacilityId || null,
      },
    });

    // In-app notification to applicant
    await dispatchNotification({
      recipientId: user.id,
      title: 'Hospital Onboarding Application Received',
      message: `Your application for ${hospitalName} has been submitted for Super-Admin review. Reference: ${application.id.slice(0, 8)}`,
      type: 'ONBOARDING_SUBMITTED',
      priority: 'NORMAL',
    }).catch(() => {});

    // Audit log
    await db.activityLog.create({
      data: {
        adminId: user.id,
        action: 'HOSPITAL_ONBOARDING_APPLICATION_SUBMITTED',
        metadata: { applicationId: application.id, hospitalName, registrationNumber },
      },
    });

    return res.status(201).json({
      status: 'success',
      message: 'Hospital onboarding application submitted successfully. Pending operations review.',
      application,
    });
  } catch (error: any) {
    return res.status(500).json({ status: 'error', message: error.message || 'Failed to submit application' });
  }
});

/**
 * GET /api/v1/onboarding/hospital/my-applications
 */
router.get('/hospital/my-applications', authenticate, async (req: AuthRequest, res) => {
  try {
    const apps = await db.hospitalOnboardingApplication.findMany({
      where: { applicantUserId: req.user!.id },
    });
    return res.json({ status: 'success', applications: apps });
  } catch (error: any) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

/**
 * PUT /api/v1/onboarding/hospital/:id/resubmit
 */
router.put('/hospital/:id/resubmit', authenticate, async (req: AuthRequest, res) => {
  const { id } = req.params;
  const user = req.user!;
  const { documents, updatedNotes } = req.body;

  try {
    const app = await db.hospitalOnboardingApplication.findUnique({ where: { id } });
    if (!app) return res.status(404).json({ status: 'fail', message: 'Application not found' });

    if (app.applicantUserId !== user.id && user.role !== Role.SUPER_ADMIN) {
      return res.status(403).json({ status: 'fail', message: 'Forbidden' });
    }

    const updated = await db.hospitalOnboardingApplication.update({
      where: { id },
      data: {
        status: 'SUBMITTED',
        documents: documents || app.documents,
        reviewerNotes: updatedNotes ? `[Applicant Resubmitted]: ${updatedNotes}` : app.reviewerNotes,
      },
    });

    return res.json({ status: 'success', message: 'Application resubmitted with updated dossier', application: updated });
  } catch (error: any) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

// -------------------------------------------------------------
// 2. PRIVATE OPERATOR ONBOARDING APPLICANT ENDPOINTS
// -------------------------------------------------------------

/**
 * POST /api/v1/onboarding/operator/apply
 */
router.post('/operator/apply', authenticate, async (req: AuthRequest, res) => {
  const user = req.user!;
  const {
    operatorName,
    tradeLicense,
    contactPersonName,
    designation,
    contactPhone,
    email,
    address,
    city = 'Nagpur',
    district = 'Nagpur',
    operatingArea = 'Nagpur District Wide',
    declaredFleetSize = 1,
    documents,
    directoryAmbulanceId,
  } = req.body;

  if (!operatorName || !tradeLicense || !contactPersonName || !contactPhone || !email || !address) {
    return res.status(400).json({
      status: 'fail',
      message: 'operatorName, tradeLicense, contactPersonName, contactPhone, email, and address are required.',
    });
  }

  const normPhone = normalizeIndianPhone(contactPhone);

  try {
    if (directoryAmbulanceId) {
      const ambService = await db.directoryAmbulanceService.findUnique({ where: { id: directoryAmbulanceId } });
      if (!ambService) {
        return res.status(404).json({ status: 'fail', message: 'Referenced directory ambulance service not found.' });
      }
      await db.directoryAmbulanceService.update({
        where: { id: directoryAmbulanceId },
        data: { onboardingStatus: 'ONBOARDING_REQUESTED' },
      });
    }

    const application = await db.operatorOnboardingApplication.create({
      data: {
        operatorName: operatorName.trim(),
        tradeLicense: tradeLicense.trim(),
        contactPersonName: contactPersonName.trim(),
        designation: designation ? designation.trim() : 'Fleet Operations Head',
        contactPhone: normPhone,
        email: email.toLowerCase().trim(),
        address: address.trim(),
        city,
        district,
        operatingArea,
        declaredFleetSize: declaredFleetSize ? parseInt(declaredFleetSize, 10) : 1,
        documents: documents || [],
        status: 'SUBMITTED',
        applicantUserId: user.id,
        directoryAmbulanceId: directoryAmbulanceId || null,
      },
    });

    await dispatchNotification({
      recipientId: user.id,
      title: 'Ambulance Operator Application Received',
      message: `Your application for ${operatorName} has been received and queued for Super-Admin review.`,
      type: 'ONBOARDING_SUBMITTED',
      priority: 'NORMAL',
    }).catch(() => {});

    await db.activityLog.create({
      data: {
        adminId: user.id,
        action: 'OPERATOR_ONBOARDING_APPLICATION_SUBMITTED',
        metadata: { applicationId: application.id, operatorName, tradeLicense },
      },
    });

    return res.status(201).json({
      status: 'success',
      message: 'Operator onboarding application submitted successfully.',
      application,
    });
  } catch (error: any) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

/**
 * GET /api/v1/onboarding/operator/my-applications
 */
router.get('/operator/my-applications', authenticate, async (req: AuthRequest, res) => {
  try {
    const apps = await db.operatorOnboardingApplication.findMany({
      where: { applicantUserId: req.user!.id },
    });
    return res.json({ status: 'success', applications: apps });
  } catch (error: any) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

// -------------------------------------------------------------
// 3. DRIVER VERIFICATION APPLICATION ENDPOINTS
// -------------------------------------------------------------

/**
 * POST /api/v1/onboarding/driver/apply
 */
router.post('/driver/apply', authenticate, async (req: AuthRequest, res) => {
  const user = req.user!;
  const {
    fullName,
    phone,
    licenseNumber,
    licenseExpiry,
    badgeNumber,
    organizationType,
    organizationId,
    documents,
  } = req.body;

  if (!fullName || !phone || !licenseNumber || !licenseExpiry || !organizationType || !organizationId) {
    return res.status(400).json({
      status: 'fail',
      message: 'fullName, phone, licenseNumber, licenseExpiry, organizationType, and organizationId are required.',
    });
  }

  const expDate = new Date(licenseExpiry);
  if (isNaN(expDate.getTime())) {
    return res.status(400).json({ status: 'fail', message: 'Invalid licenseExpiry date format.' });
  }

  if (expDate.getTime() <= Date.now()) {
    return res.status(400).json({
      status: 'fail',
      message: 'Driving license has already expired. Valid unexpired license is required for ambulance driver onboarding.',
      code: 'LICENSE_EXPIRED',
    });
  }

  try {
    // Check organization exists
    if (organizationType === 'HOSPITAL') {
      const hosp = await db.hospital.findUnique({ where: { id: organizationId } });
      if (!hosp) return res.status(404).json({ status: 'fail', message: 'Affiliated hospital not found.' });
    } else if (organizationType === 'PRIVATE_OPERATOR') {
      const op = await db.ambulanceOperator.findUnique({ where: { id: organizationId } });
      if (!op) return res.status(404).json({ status: 'fail', message: 'Affiliated ambulance operator not found.' });
    } else {
      return res.status(400).json({ status: 'fail', message: 'organizationType must be HOSPITAL or PRIVATE_OPERATOR.' });
    }

    const application = await db.driverVerificationApplication.create({
      data: {
        driverUserId: user.id,
        fullName: fullName.trim(),
        phone: normalizeIndianPhone(phone),
        licenseNumber: licenseNumber.trim(),
        licenseExpiry: expDate,
        badgeNumber: badgeNumber ? badgeNumber.trim() : null,
        organizationType,
        organizationId,
        documents: documents || [],
        status: 'SUBMITTED',
      },
    });

    // Ensure driverProfile exists in pending review state
    await db.driverProfile.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        licenseNumber: licenseNumber.trim(),
        licenseExpiry: expDate,
        verificationState: VerificationState.PENDING_REVIEW,
        organizationType,
        hospitalId: organizationType === 'HOSPITAL' ? organizationId : null,
        operatorId: organizationType === 'PRIVATE_OPERATOR' ? organizationId : null,
        membershipStatus: 'PENDING',
        isDispatchEligible: false,
      },
      update: {
        licenseNumber: licenseNumber.trim(),
        licenseExpiry: expDate,
        organizationType,
        hospitalId: organizationType === 'HOSPITAL' ? organizationId : null,
        operatorId: organizationType === 'PRIVATE_OPERATOR' ? organizationId : null,
        verificationState: VerificationState.PENDING_REVIEW,
      },
    });

    await dispatchNotification({
      recipientId: user.id,
      title: 'Driver Verification Application Submitted',
      message: 'Your driving credentials and organization affiliation have been submitted for operations review.',
      type: 'DRIVER_APPLICATION_SUBMITTED',
      priority: 'NORMAL',
    }).catch(() => {});

    return res.status(201).json({
      status: 'success',
      message: 'Driver verification application submitted successfully.',
      application,
    });
  } catch (error: any) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

/**
 * GET /api/v1/onboarding/driver/my-application
 */
router.get('/driver/my-application', authenticate, async (req: AuthRequest, res) => {
  try {
    const app = await db.driverVerificationApplication.findFirst({
      where: { driverUserId: req.user!.id },
    });
    return res.json({ status: 'success', application: app });
  } catch (error: any) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

// -------------------------------------------------------------
// 4. SUPER-ADMIN OPERATIONS REVIEW ENDPOINTS
// -------------------------------------------------------------

router.use('/admin', authenticate, authorize([Role.SUPER_ADMIN]));

/**
 * GET /api/v1/onboarding/admin/summary
 */
router.get('/admin/summary', async (_req: AuthRequest, res) => {
  try {
    const hospitalPending = await db.hospitalOnboardingApplication.count({ where: { status: 'SUBMITTED' } });
    const hospitalApproved = await db.hospitalOnboardingApplication.count({ where: { status: 'APPROVED' } });
    const operatorPending = await db.operatorOnboardingApplication.count({ where: { status: 'SUBMITTED' } });
    const operatorApproved = await db.operatorOnboardingApplication.count({ where: { status: 'APPROVED' } });
    const driverPending = await db.driverVerificationApplication.count({ where: { status: 'SUBMITTED' } });
    const driverApproved = await db.driverVerificationApplication.count({ where: { status: 'APPROVED' } });
    const checklists = await db.pilotActivationChecklist.findMany();

    return res.json({
      status: 'success',
      summary: {
        hospital: { pending: hospitalPending, approved: hospitalApproved },
        operator: { pending: operatorPending, approved: operatorApproved },
        driver: { pending: driverPending, approved: driverApproved },
        pilotActiveCount: checklists.filter((c: any) => c.activationStatus === 'PILOT_ACTIVE').length,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

/**
 * GET /api/v1/onboarding/admin/hospitals
 */
router.get('/admin/hospitals', async (req: AuthRequest, res) => {
  const { status } = req.query;
  try {
    const where: any = {};
    if (status) where.status = String(status);
    const applications = await db.hospitalOnboardingApplication.findMany({ where });
    return res.json({ status: 'success', count: applications.length, applications });
  } catch (error: any) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

/**
 * POST /api/v1/onboarding/admin/hospitals/:id/review
 * Approves, rejects, requests info, or suspends a hospital onboarding application.
 * Enforces: Applicant CANNOT approve themselves.
 */
router.post('/admin/hospitals/:id/review', async (req: AuthRequest, res) => {
  const { id } = req.params;
  const reviewer = req.user!;
  const { decision, reviewerNotes, rejectionReason } = req.body;

  if (!decision || !['APPROVED', 'NEEDS_MORE_INFO', 'REJECTED', 'SUSPENDED'].includes(decision)) {
    return res.status(400).json({
      status: 'fail',
      message: "decision must be one of: 'APPROVED', 'NEEDS_MORE_INFO', 'REJECTED', 'SUSPENDED'.",
    });
  }

  try {
    const app = await db.hospitalOnboardingApplication.findUnique({ where: { id } });
    if (!app) return res.status(404).json({ status: 'fail', message: 'Application not found' });

    // Anti-Self-Approval Invariant
    if (app.applicantUserId === reviewer.id) {
      await logSecurityEvent('SELF_APPROVAL_ATTEMPT_BLOCKED', reviewer.id, { applicationId: id, entityType: 'HOSPITAL' });
      return res.status(403).json({
        status: 'fail',
        message: 'Security Violation: Applicants cannot approve their own onboarding applications.',
        code: 'SELF_APPROVAL_FORBIDDEN',
      });
    }

    const previousState = app.status;
    const now = new Date();

    let createdOrUpdatedHospital: any = null;

    if (decision === 'APPROVED') {
      // Find existing hospital by adminUserId or create new Hospital
      let hosp = await db.hospital.findFirst({ where: { adminUserId: app.applicantUserId } });
      if (hosp) {
        createdOrUpdatedHospital = await db.hospital.update({
          where: { id: hosp.id },
          data: {
            verificationState: VerificationState.VERIFIED,
            name: app.hospitalName,
            address: app.address,
            contactNumber: app.contactPhone,
            totalBeds: app.bedCapacityTotal || hosp.totalBeds,
            availableBeds: app.bedCapacityTotal || hosp.availableBeds,
          },
        });
      } else {
        createdOrUpdatedHospital = await db.hospital.create({
          data: {
            name: app.hospitalName,
            address: app.address,
            contactNumber: app.contactPhone,
            city: app.city,
            state: app.state,
            lat: app.lat || 21.1458,
            lng: app.lng || 79.0882,
            adminUserId: app.applicantUserId,
            totalBeds: app.bedCapacityTotal || 20,
            availableBeds: app.bedCapacityTotal || 10,
            verificationState: VerificationState.VERIFIED,
          },
        });
      }

      // Promote applicant to ADMIN_HOSPITAL
      await db.user.update({
        where: { id: app.applicantUserId },
        data: {
          role: Role.ADMIN_HOSPITAL,
          hospitalId: createdOrUpdatedHospital.id,
        },
      });

      // If linked to directory facility, promote directory status
      if (app.directoryFacilityId) {
        await db.directoryFacility.update({
          where: { id: app.directoryFacilityId },
          data: {
            linkStatus: 'LINKED_PARTNER',
            onboardingStatus: 'APPROVED',
            linkedHospitalId: createdOrUpdatedHospital.id,
          },
        });
      }

      // Create pilot activation checklist record
      await db.pilotActivationChecklist.upsert({
        where: { organizationId: createdOrUpdatedHospital.id },
        create: {
          organizationType: 'HOSPITAL',
          organizationId: createdOrUpdatedHospital.id,
          organizationName: createdOrUpdatedHospital.name,
          isOrgApproved: true,
          activationStatus: 'APPROVED_NOT_ACTIVATED',
        },
        update: {
          isOrgApproved: true,
        },
      });
    }

    // Update application record
    const updatedApp = await db.hospitalOnboardingApplication.update({
      where: { id },
      data: {
        status: decision,
        reviewerId: reviewer.id,
        reviewerNotes: reviewerNotes || null,
        rejectionReason: decision === 'REJECTED' ? rejectionReason || reviewerNotes : null,
        reviewedAt: now,
      },
    });

    // Immutable verification audit log
    await db.verificationAuditLog.create({
      data: {
        actorId: reviewer.id,
        action: 'HOSPITAL_ONBOARDING_DECISION',
        targetEntityType: 'HOSPITAL_APPLICATION',
        targetEntityId: id,
        previousState,
        newState: decision,
        reviewMethod: 'DOCUMENT_AND_CREDENTIAL_AUDIT',
        notes: reviewerNotes ? String(reviewerNotes).slice(0, 500) : null,
        isSimulated: process.env.NODE_ENV === 'test',
      },
    });

    // Notify applicant
    await dispatchNotification({
      recipientId: app.applicantUserId,
      title: `Hospital Onboarding Application: ${decision}`,
      message:
        decision === 'APPROVED'
          ? `Congratulations! ${app.hospitalName} has been approved as a LifeLink partner hospital.`
          : `Your onboarding application has been marked: ${decision}. Notes: ${reviewerNotes || 'Please review requirements.'}`,
      type: 'ONBOARDING_STATUS_CHANGED',
      priority: decision === 'APPROVED' ? 'HIGH' : 'NORMAL',
    }).catch(() => {});

    return res.json({
      status: 'success',
      message: `Hospital onboarding application ${decision}.`,
      application: updatedApp,
      hospital: createdOrUpdatedHospital,
    });
  } catch (error: any) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

/**
 * GET /api/v1/onboarding/admin/operators
 */
router.get('/admin/operators', async (req: AuthRequest, res) => {
  const { status } = req.query;
  try {
    const where: any = {};
    if (status) where.status = String(status);
    const applications = await db.operatorOnboardingApplication.findMany({ where });
    return res.json({ status: 'success', count: applications.length, applications });
  } catch (error: any) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

/**
 * POST /api/v1/onboarding/admin/operators/:id/review
 * Approves, rejects, or flags private operator onboarding.
 */
router.post('/admin/operators/:id/review', async (req: AuthRequest, res) => {
  const { id } = req.params;
  const reviewer = req.user!;
  const { decision, reviewerNotes, rejectionReason } = req.body;

  if (!decision || !['APPROVED', 'NEEDS_MORE_INFO', 'REJECTED', 'SUSPENDED'].includes(decision)) {
    return res.status(400).json({ status: 'fail', message: 'Invalid decision' });
  }

  try {
    const app = await db.operatorOnboardingApplication.findUnique({ where: { id } });
    if (!app) return res.status(404).json({ status: 'fail', message: 'Application not found' });

    if (app.applicantUserId === reviewer.id) {
      return res.status(403).json({
        status: 'fail',
        message: 'Security Violation: Applicants cannot approve their own onboarding applications.',
        code: 'SELF_APPROVAL_FORBIDDEN',
      });
    }

    const previousState = app.status;
    let createdOrUpdatedOperator: any = null;

    if (decision === 'APPROVED') {
      let op = await db.ambulanceOperator.findFirst({ where: { adminUserId: app.applicantUserId } });
      if (op) {
        createdOrUpdatedOperator = await db.ambulanceOperator.update({
          where: { id: op.id },
          data: {
            verificationState: VerificationState.VERIFIED,
            name: app.operatorName,
            tradeLicense: app.tradeLicense,
            contactPhone: app.contactPhone,
            email: app.email,
            address: app.address,
          },
        });
      } else {
        createdOrUpdatedOperator = await db.ambulanceOperator.create({
          data: {
            name: app.operatorName,
            tradeLicense: app.tradeLicense,
            contactPhone: app.contactPhone,
            email: app.email,
            address: app.address,
            city: app.city,
            state: app.state,
            adminUserId: app.applicantUserId,
            verificationState: VerificationState.VERIFIED,
          },
        });
      }

      await db.user.update({
        where: { id: app.applicantUserId },
        data: {
          role: Role.OPERATOR_ADMIN,
          operatorId: createdOrUpdatedOperator.id,
        },
      });

      if (app.directoryAmbulanceId) {
        await db.directoryAmbulanceService.update({
          where: { id: app.directoryAmbulanceId },
          data: {
            linkStatus: 'LINKED_PARTNER',
            onboardingStatus: 'APPROVED',
            linkedOperatorId: createdOrUpdatedOperator.id,
          },
        });
      }

      await db.pilotActivationChecklist.upsert({
        where: { organizationId: createdOrUpdatedOperator.id },
        create: {
          organizationType: 'PRIVATE_OPERATOR',
          organizationId: createdOrUpdatedOperator.id,
          organizationName: createdOrUpdatedOperator.name,
          isOrgApproved: true,
          activationStatus: 'APPROVED_NOT_ACTIVATED',
        },
        update: {
          isOrgApproved: true,
        },
      });
    }

    const updatedApp = await db.operatorOnboardingApplication.update({
      where: { id },
      data: {
        status: decision,
        reviewerId: reviewer.id,
        reviewerNotes: reviewerNotes || null,
        rejectionReason: decision === 'REJECTED' ? rejectionReason || reviewerNotes : null,
        reviewedAt: new Date(),
      },
    });

    await db.verificationAuditLog.create({
      data: {
        actorId: reviewer.id,
        action: 'OPERATOR_ONBOARDING_DECISION',
        targetEntityType: 'OPERATOR_APPLICATION',
        targetEntityId: id,
        previousState,
        newState: decision,
        reviewMethod: 'DOCUMENT_AND_CREDENTIAL_AUDIT',
        notes: reviewerNotes || null,
        isSimulated: process.env.NODE_ENV === 'test',
      },
    });

    return res.json({
      status: 'success',
      message: `Operator onboarding application ${decision}.`,
      application: updatedApp,
      operator: createdOrUpdatedOperator,
    });
  } catch (error: any) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

/**
 * GET /api/v1/onboarding/admin/drivers
 */
router.get('/admin/drivers', async (req: AuthRequest, res) => {
  const { status } = req.query;
  try {
    const where: any = {};
    if (status) where.status = String(status);
    const applications = await db.driverVerificationApplication.findMany({ where });
    return res.json({ status: 'success', count: applications.length, applications });
  } catch (error: any) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

/**
 * POST /api/v1/onboarding/admin/drivers/:id/review
 */
router.post('/admin/drivers/:id/review', async (req: AuthRequest, res) => {
  const { id } = req.params;
  const reviewer = req.user!;
  const { decision, reviewerNotes, rejectionReason } = req.body;

  if (!decision || !['APPROVED', 'NEEDS_MORE_INFO', 'REJECTED', 'SUSPENDED'].includes(decision)) {
    return res.status(400).json({ status: 'fail', message: 'Invalid decision' });
  }

  try {
    const app = await db.driverVerificationApplication.findUnique({ where: { id } });
    if (!app) return res.status(404).json({ status: 'fail', message: 'Application not found' });

    if (app.driverUserId === reviewer.id) {
      return res.status(403).json({
        status: 'fail',
        message: 'Security Violation: Drivers cannot approve their own verification applications.',
        code: 'SELF_APPROVAL_FORBIDDEN',
      });
    }

    // Check if license is already expired at review time
    if (decision === 'APPROVED' && new Date(app.licenseExpiry).getTime() <= Date.now()) {
      return res.status(400).json({
        status: 'fail',
        message: 'Cannot approve driver: Driving license has expired.',
        code: 'LICENSE_EXPIRED',
      });
    }

    if (decision === 'APPROVED') {
      await db.driverProfile.update({
        where: { userId: app.driverUserId },
        data: {
          verificationState: VerificationState.VERIFIED,
          membershipStatus: 'APPROVED',
          licenseNumber: app.licenseNumber,
          licenseExpiry: app.licenseExpiry,
          reviewedBy: reviewer.id,
          reviewedAt: new Date(),
          reviewNotes: reviewerNotes || null,
        },
      });

      await db.user.update({
        where: { id: app.driverUserId },
        data: { role: Role.DRIVER },
      });
    } else if (decision === 'REJECTED' || decision === 'SUSPENDED') {
      await db.driverProfile.update({
        where: { userId: app.driverUserId },
        data: {
          verificationState: decision === 'SUSPENDED' ? VerificationState.SUSPENDED : VerificationState.REJECTED,
          membershipStatus: decision,
        },
      });
    }

    const updatedApp = await db.driverVerificationApplication.update({
      where: { id },
      data: {
        status: decision,
        reviewerId: reviewer.id,
        reviewerNotes: reviewerNotes || null,
        rejectionReason: decision === 'REJECTED' ? rejectionReason || reviewerNotes : null,
        reviewedAt: new Date(),
      },
    });

    await db.verificationAuditLog.create({
      data: {
        actorId: reviewer.id,
        action: 'DRIVER_VERIFICATION_DECISION',
        targetEntityType: 'DRIVER_APPLICATION',
        targetEntityId: id,
        previousState: app.status,
        newState: decision,
        reviewMethod: 'DOCUMENT_AND_CREDENTIAL_AUDIT',
        notes: reviewerNotes || null,
        isSimulated: process.env.NODE_ENV === 'test',
      },
    });

    return res.json({ status: 'success', message: `Driver application ${decision}.`, application: updatedApp });
  } catch (error: any) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

// -------------------------------------------------------------
// 5. PILOT ACTIVATION CONTROLS ENDPOINTS
// -------------------------------------------------------------

/**
 * GET /api/v1/onboarding/admin/pilot-checklists
 */
router.get('/admin/pilot-checklists', async (_req: AuthRequest, res) => {
  try {
    const checklists = await db.pilotActivationChecklist.findMany();
    return res.json({ status: 'success', checklists });
  } catch (error: any) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

/**
 * GET /api/v1/onboarding/admin/pilot-checklists/:organizationId
 * Calculates real-time activation readiness criteria for an organization.
 */
router.get('/admin/pilot-checklists/:organizationId', async (req: AuthRequest, res) => {
  const { organizationId } = req.params;

  try {
    // 1. Check organization type and verified state
    let orgType: 'HOSPITAL' | 'PRIVATE_OPERATOR' = 'HOSPITAL';
    let orgName = '';
    let isOrgApproved = false;

    const hosp = await db.hospital.findUnique({ where: { id: organizationId } });
    if (hosp) {
      orgType = 'HOSPITAL';
      orgName = hosp.name;
      isOrgApproved = hosp.verificationState === VerificationState.VERIFIED;
    } else {
      const op = await db.ambulanceOperator.findUnique({ where: { id: organizationId } });
      if (op) {
        orgType = 'PRIVATE_OPERATOR';
        orgName = op.name;
        isOrgApproved = op.verificationState === VerificationState.VERIFIED;
      } else {
        return res.status(404).json({ status: 'fail', message: 'Organization not found' });
      }
    }

    // 2. Count verified ambulances
    const ambWhere: any = {
      verificationState: VerificationState.VERIFIED,
      isDemo: false,
    };
    if (orgType === 'HOSPITAL') ambWhere.hospitalId = organizationId;
    else ambWhere.operatorId = organizationId;

    const verifiedAmbs = await db.ambulance.findMany({ where: ambWhere });

    // 3. Count verified drivers
    const dpWhere: any = {
      verificationState: VerificationState.VERIFIED,
      membershipStatus: 'APPROVED',
      isDemo: false,
    };
    if (orgType === 'HOSPITAL') dpWhere.hospitalId = organizationId;
    else dpWhere.operatorId = organizationId;

    const verifiedDrivers = await db.driverProfile.findMany({ where: dpWhere });

    // 4. Count active current driver-to-vehicle assignments
    let activeAssignmentsCount = 0;
    for (const amb of verifiedAmbs) {
      const assignment = await db.driverVehicleAssignment.findFirst({
        where: { ambulanceId: amb.id, isCurrent: true },
      });
      if (assignment) activeAssignmentsCount++;
    }

    // 5. GPS freshness check across verified fleet
    let hasRecentGpsPing = false;
    const now = Date.now();
    for (const amb of verifiedAmbs) {
      if (amb.lastUpdated && (now - new Date(amb.lastUpdated).getTime()) / 1000 <= 300) {
        hasRecentGpsPing = true;
        break;
      }
    }

    // Readiness evaluation
    const blockers: string[] = [];
    if (!isOrgApproved) blockers.push('Organization verification is not APPROVED.');
    if (verifiedAmbs.length === 0) blockers.push('No verified ambulances registered for this organization.');
    if (verifiedDrivers.length === 0) blockers.push('No verified drivers affiliated with this organization.');
    if (activeAssignmentsCount === 0) blockers.push('No active driver-to-vehicle assignments established.');
    if (!hasRecentGpsPing) blockers.push('No recent live GPS telemetry received from fleet (< 5 min).');

    const isReady = blockers.length === 0;

    const checklistData = {
      organizationId,
      organizationName: orgName,
      organizationType: orgType,
      isOrgApproved,
      verifiedFleetCount: verifiedAmbs.length,
      verifiedDriverCount: verifiedDrivers.length,
      activeAssignmentsCount,
      hasRecentGpsPing,
      readinessVerdict: isReady ? 'READY_FOR_ACTIVATION' : 'BLOCKED',
      blockers,
    };

    return res.json({ status: 'success', checklist: checklistData });
  } catch (error: any) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

/**
 * POST /api/v1/onboarding/admin/pilot-checklists/:organizationId/activate
 * Explicit, authorized pilot activation action.
 * Strictly blocked if prerequisites are not met!
 */
router.post('/admin/pilot-checklists/:organizationId/activate', async (req: AuthRequest, res) => {
  const { organizationId } = req.params;
  const reviewer = req.user!;
  const { notes } = req.body;

  try {
    // Re-verify all prerequisites server-side
    let orgType: 'HOSPITAL' | 'PRIVATE_OPERATOR' = 'HOSPITAL';
    let orgName = '';
    let isOrgApproved = false;

    const hosp = await db.hospital.findUnique({ where: { id: organizationId } });
    if (hosp) {
      orgType = 'HOSPITAL';
      orgName = hosp.name;
      isOrgApproved = hosp.verificationState === VerificationState.VERIFIED;
    } else {
      const op = await db.ambulanceOperator.findUnique({ where: { id: organizationId } });
      if (op) {
        orgType = 'PRIVATE_OPERATOR';
        orgName = op.name;
        isOrgApproved = op.verificationState === VerificationState.VERIFIED;
      } else {
        return res.status(404).json({ status: 'fail', message: 'Organization not found' });
      }
    }

    const ambWhere: any = { verificationState: VerificationState.VERIFIED, isDemo: false };
    if (orgType === 'HOSPITAL') ambWhere.hospitalId = organizationId;
    else ambWhere.operatorId = organizationId;
    const verifiedAmbs = await db.ambulance.findMany({ where: ambWhere });

    const dpWhere: any = { verificationState: VerificationState.VERIFIED, membershipStatus: 'APPROVED', isDemo: false };
    if (orgType === 'HOSPITAL') dpWhere.hospitalId = organizationId;
    else dpWhere.operatorId = organizationId;
    const verifiedDrivers = await db.driverProfile.findMany({ where: dpWhere });

    let activeAssignmentsCount = 0;
    for (const amb of verifiedAmbs) {
      const assignment = await db.driverVehicleAssignment.findFirst({
        where: { ambulanceId: amb.id, isCurrent: true },
      });
      if (assignment) activeAssignmentsCount++;
    }

    let hasRecentGpsPing = false;
    const now = Date.now();
    for (const amb of verifiedAmbs) {
      if (amb.lastUpdated && (now - new Date(amb.lastUpdated).getTime()) / 1000 <= 300) {
        hasRecentGpsPing = true;
        break;
      }
    }

    const blockers: string[] = [];
    if (!isOrgApproved) blockers.push('ORGANIZATION_NOT_APPROVED');
    if (verifiedAmbs.length === 0) blockers.push('NO_VERIFIED_AMBULANCES');
    if (verifiedDrivers.length === 0) blockers.push('NO_VERIFIED_DRIVERS');
    if (activeAssignmentsCount === 0) blockers.push('NO_ACTIVE_DRIVER_ASSIGNMENTS');
    if (!hasRecentGpsPing) blockers.push('NO_RECENT_GPS_TELEMETRY');

    if (blockers.length > 0) {
      return res.status(400).json({
        status: 'fail',
        message: 'Pilot activation blocked: One or more operational prerequisites have not been satisfied.',
        verdict: 'BLOCKED',
        blockers,
      });
    }

    // Prerequisites met: Activate organization in pilot
    const updatedChecklist = await db.pilotActivationChecklist.upsert({
      where: { organizationId },
      create: {
        organizationType: orgType,
        organizationId,
        organizationName: orgName,
        isOrgApproved: true,
        verifiedFleetCount: verifiedAmbs.length,
        verifiedDriverCount: verifiedDrivers.length,
        activeAssignmentsCount,
        hasRecentGpsPing: true,
        activationStatus: 'PILOT_ACTIVE',
        activatedBy: reviewer.id,
        activatedAt: new Date(),
        notes: notes || 'All prerequisites verified and approved by Super-Admin',
      },
      update: {
        isOrgApproved: true,
        verifiedFleetCount: verifiedAmbs.length,
        verifiedDriverCount: verifiedDrivers.length,
        activeAssignmentsCount,
        hasRecentGpsPing: true,
        activationStatus: 'PILOT_ACTIVE',
        activatedBy: reviewer.id,
        activatedAt: new Date(),
        notes: notes || 'Re-activated in pilot',
      },
    });

    await db.activityLog.create({
      data: {
        adminId: reviewer.id,
        action: 'PILOT_NETWORK_ACTIVATED',
        metadata: { organizationId, organizationName: orgName, orgType },
      },
    });

    return res.json({
      status: 'success',
      message: `Organization ${orgName} is now OPERATIONALLY ACTIVE in Nagpur Pilot.`,
      checklist: updatedChecklist,
    });
  } catch (error: any) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

/**
 * POST /api/v1/onboarding/admin/pilot-checklists/:organizationId/suspend
 */
router.post('/admin/pilot-checklists/:organizationId/suspend', async (req: AuthRequest, res) => {
  const { organizationId } = req.params;
  const reviewer = req.user!;
  const { reason } = req.body;

  if (!reason) {
    return res.status(400).json({ status: 'fail', message: 'Mandatory suspension reason is required.' });
  }

  try {
    const updated = await db.pilotActivationChecklist.update({
      where: { organizationId },
      data: {
        activationStatus: 'TEMPORARILY_SUSPENDED',
        deactivatedReason: reason,
      },
    });

    await db.activityLog.create({
      data: {
        adminId: reviewer.id,
        action: 'PILOT_NETWORK_SUSPENDED',
        metadata: { organizationId, reason },
      },
    });

    return res.json({ status: 'success', message: 'Organization pilot activation temporarily suspended.', checklist: updated });
  } catch (error: any) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

// -------------------------------------------------------------
// 6. DISPATCH ELIGIBILITY INSPECTOR TOOL
// -------------------------------------------------------------

/**
 * GET /api/v1/onboarding/admin/dispatch-eligibility/inspect/:ambulanceId
 * Inspects a vehicle against the 12-point dispatch eligibility engine.
 */
router.get('/admin/dispatch-eligibility/inspect/:ambulanceId', async (req: AuthRequest, res) => {
  const { ambulanceId } = req.params;
  const { requiredType } = req.query;

  try {
    const inspection = await evaluateAmbulanceDispatchEligibility(ambulanceId, {
      requiredAmbulanceType: requiredType ? String(requiredType) : undefined,
    });

    return res.json({
      status: 'success',
      inspection,
    });
  } catch (error: any) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

export default router;
