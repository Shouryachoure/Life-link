import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { Role, DataProvenance, EmergencyAccessType } from '@prisma/client';
import { authenticate, AuthRequest, authorize } from '../middleware/auth';
import prisma from '../db';

const router = Router();

// Clinical disclaimer constant for all responder views
export const CLINICAL_EMERGENCY_DISCLAIMER =
  'NOTICE TO EMERGENCY RESPONDERS AND CLINICIANS: Patient-reported health data is voluntarily provided by the individual and has not been independently verified by a licensed laboratory or clinician unless explicitly marked as VERIFIED_CLINICAL. Emergency responders must exercise independent clinical discretion and verify vital parameters during triage.';

// DPDP Act 2023 statutory statement
export const DPDP_COMPLIANCE_NOTICE =
  'Compliant with the Digital Personal Data Protection (DPDP) Act, 2023 (Section 7 - Processing for Medical Emergency & Public Health, Section 12 - Right to Correction and Erasure). Voluntary patient consent is recorded, and full medical histories are strictly omitted from access audit logs.';

/**
 * Helper to mask patient names for non-confidential safety card display (e.g. "Rahul Sharma" -> "Rahul S.")
 */
function maskNameForSafetyCard(fullName: string): string {
  if (!fullName) return 'Patient';
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].length > 2 ? `${parts[0].slice(0, 2)}***` : parts[0];
  }
  return `${parts[0]} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`;
}

/**
 * GET /api/v1/emergency-profile
 * Patient views their own Emergency Health Profile with provenance metadata and access token.
 */
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    const profile = await prisma.patientProfile.findUnique({
      where: { userId: req.user.id },
    });

    const contacts = await prisma.emergencyContact.findMany({
      where: { patientId: req.user.id },
      orderBy: { createdAt: 'asc' },
    });

    // If profile does not exist yet, return a clean default template
    if (!profile) {
      return res.status(200).json({
        hasProfile: false,
        profile: null,
        contacts,
        message: 'No emergency health profile recorded yet. You may voluntarily provide emergency details.',
      });
    }

    // Ensure access token exists
    let token = profile.emergencyAccessToken;
    if (!token) {
      token = crypto.randomBytes(24).toString('hex');
      await prisma.patientProfile.update({
        where: { userId: req.user.id },
        data: {
          emergencyAccessToken: token,
          tokenGeneratedAt: new Date(),
        },
      });
    }

    // Log patient direct view
    await prisma.emergencyHealthAccessLog.create({
      data: {
        patientId: req.user.id,
        accessorId: req.user.id,
        accessorRole: req.user.role,
        accessorName: req.user.name,
        organization: 'LifeLink Patient Portal',
        accessType: EmergencyAccessType.PATIENT_DIRECT_VIEW,
        accessReason: 'Patient viewed own Emergency Health Profile',
        lawfulBasis: 'USER_DATA_ACCESS_RIGHT_DPDP_SEC_11',
        fieldsAccessed: ['bloodGroup', 'allergies', 'medicalConditions', 'currentMedications', 'emergencyContacts'],
        ipAddress: req.ip || null,
        userAgent: req.get('user-agent') || null,
      },
    });

    return res.status(200).json({
      hasProfile: true,
      profile: {
        ...profile,
        emergencyAccessToken: token,
      },
      contacts,
      dpdpNotice: DPDP_COMPLIANCE_NOTICE,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to fetch emergency profile' });
  }
});

/**
 * PUT /api/v1/emergency-profile
 * Patient creates or updates voluntary emergency health information.
 * Provenance defaults to PATIENT_REPORTED unless previously VERIFIED_CLINICAL.
 */
router.put('/', authenticate, async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const {
    bloodGroup,
    allergies,
    medicalConditions,
    currentMedications,
    organDonorStatus,
    preferredHospital,
    medicalNotes,
    customAlertMessage,
    consentEmergencySharing = true,
  } = req.body;

  try {
    const existing = await prisma.patientProfile.findUnique({
      where: { userId: req.user.id },
    });

    // Determine provenance for bloodGroup: if explicitly set to UNKNOWN, mark UNKNOWN
    let targetBloodGroup = existing?.bloodGroup || 'UNKNOWN';
    let bloodGroupProv: DataProvenance = existing?.bloodGroupProvenance || DataProvenance.UNKNOWN;

    if (bloodGroup !== undefined) {
      targetBloodGroup = bloodGroup || 'UNKNOWN';
      if (bloodGroup === 'UNKNOWN' || !bloodGroup) {
        bloodGroupProv = DataProvenance.UNKNOWN;
      } else if (existing?.bloodGroupProvenance === DataProvenance.VERIFIED_CLINICAL && existing.bloodGroup === bloodGroup) {
        bloodGroupProv = DataProvenance.VERIFIED_CLINICAL;
      } else {
        bloodGroupProv = DataProvenance.PATIENT_REPORTED;
      }
    }

    // Retain VERIFIED_CLINICAL provenance if value has not changed, otherwise reset to PATIENT_REPORTED
    const allergiesProv =
      allergies === undefined
        ? existing?.allergiesProvenance || DataProvenance.PATIENT_REPORTED
        : existing?.allergiesProvenance === DataProvenance.VERIFIED_CLINICAL && existing.allergies === allergies
        ? DataProvenance.VERIFIED_CLINICAL
        : DataProvenance.PATIENT_REPORTED;

    const conditionsProv =
      medicalConditions === undefined
        ? existing?.medicalConditionsProvenance || DataProvenance.PATIENT_REPORTED
        : existing?.medicalConditionsProvenance === DataProvenance.VERIFIED_CLINICAL && existing.medicalConditions === medicalConditions
        ? DataProvenance.VERIFIED_CLINICAL
        : DataProvenance.PATIENT_REPORTED;

    const medicationsProv =
      currentMedications === undefined
        ? existing?.medicationsProvenance || DataProvenance.PATIENT_REPORTED
        : existing?.medicationsProvenance === DataProvenance.VERIFIED_CLINICAL && existing.currentMedications === currentMedications
        ? DataProvenance.VERIFIED_CLINICAL
        : DataProvenance.PATIENT_REPORTED;

    const token = existing?.emergencyAccessToken || crypto.randomBytes(24).toString('hex');
    const tokenGenAt = existing?.tokenGeneratedAt || new Date();

    const updatedProfile = await prisma.patientProfile.upsert({
      where: { userId: req.user.id },
      update: {
        bloodGroup: targetBloodGroup,
        bloodGroupProvenance: bloodGroupProv,
        allergies: allergies !== undefined ? (allergies ? String(allergies).trim() : null) : existing?.allergies,
        allergiesProvenance: allergiesProv,
        medicalConditions:
          medicalConditions !== undefined
            ? medicalConditions
              ? String(medicalConditions).trim()
              : null
            : existing?.medicalConditions,
        medicalConditionsProvenance: conditionsProv,
        currentMedications:
          currentMedications !== undefined
            ? currentMedications
              ? String(currentMedications).trim()
              : null
            : existing?.currentMedications,
        medicationsProvenance: medicationsProv,
        organDonorStatus: organDonorStatus || existing?.organDonorStatus || 'NOT_SPECIFIED',
        preferredHospital: preferredHospital !== undefined ? preferredHospital : existing?.preferredHospital,
        medicalNotes: medicalNotes !== undefined ? (medicalNotes ? String(medicalNotes).trim() : null) : existing?.medicalNotes,
        customAlertMessage:
          customAlertMessage !== undefined
            ? customAlertMessage
              ? String(customAlertMessage).trim()
              : null
            : existing?.customAlertMessage,
        consentEmergencySharing: Boolean(consentEmergencySharing),
        emergencyAccessToken: token,
        tokenGeneratedAt: tokenGenAt,
      },
      create: {
        userId: req.user.id,
        bloodGroup: bloodGroup || 'UNKNOWN',
        bloodGroupProvenance: bloodGroupProv,
        allergies: allergies ? String(allergies).trim() : null,
        allergiesProvenance: allergiesProv,
        medicalConditions: medicalConditions ? String(medicalConditions).trim() : null,
        medicalConditionsProvenance: conditionsProv,
        currentMedications: currentMedications ? String(currentMedications).trim() : null,
        medicationsProvenance: medicationsProv,
        organDonorStatus: organDonorStatus || 'NOT_SPECIFIED',
        preferredHospital: preferredHospital || null,
        medicalNotes: medicalNotes ? String(medicalNotes).trim() : null,
        customAlertMessage: customAlertMessage ? String(customAlertMessage).trim() : null,
        consentEmergencySharing: Boolean(consentEmergencySharing),
        emergencyAccessToken: token,
        tokenGeneratedAt: tokenGenAt,
      },
    });

    return res.status(200).json({
      message: 'Emergency health profile updated successfully.',
      profile: updatedProfile,
      dpdpNotice: DPDP_COMPLIANCE_NOTICE,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to update emergency profile' });
  }
});

/**
 * DELETE /api/v1/emergency-profile
 * Right to Erasure (DPDP Act 2023 Sec 12).
 * Patient can selectively delete fields or wipe their emergency profile.
 */
router.delete('/', authenticate, async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const { fields } = req.body || {};

  try {
    const existing = await prisma.patientProfile.findUnique({
      where: { userId: req.user.id },
    });

    if (!existing) {
      return res.status(404).json({ message: 'No emergency health profile found to delete.' });
    }

    // Selective field erasure
    if (Array.isArray(fields) && fields.length > 0) {
      const updateData: any = {};
      for (const field of fields) {
        if (field === 'bloodGroup') {
          updateData.bloodGroup = 'UNKNOWN';
          updateData.bloodGroupProvenance = DataProvenance.UNKNOWN;
        } else if (field === 'allergies') {
          updateData.allergies = null;
          updateData.allergiesProvenance = DataProvenance.PATIENT_REPORTED;
        } else if (field === 'medicalConditions') {
          updateData.medicalConditions = null;
          updateData.medicalConditionsProvenance = DataProvenance.PATIENT_REPORTED;
        } else if (field === 'currentMedications') {
          updateData.currentMedications = null;
          updateData.medicationsProvenance = DataProvenance.PATIENT_REPORTED;
        } else if (field === 'medicalNotes') {
          updateData.medicalNotes = null;
        } else if (field === 'organDonorStatus') {
          updateData.organDonorStatus = 'NOT_SPECIFIED';
        } else if (field === 'preferredHospital') {
          updateData.preferredHospital = null;
        }
      }

      const updated = await prisma.patientProfile.update({
        where: { userId: req.user.id },
        data: updateData,
      });

      return res.status(200).json({
        message: `Specified fields (${fields.join(', ')}) cleared successfully under DPDP Right to Erasure.`,
        profile: updated,
      });
    }

    // Complete deletion of voluntary emergency profile
    await prisma.patientProfile.delete({
      where: { userId: req.user.id },
    });

    return res.status(200).json({
      message: 'Emergency health profile permanently deleted under DPDP Right to Erasure.',
      hasProfile: false,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to delete emergency profile' });
  }
});

/**
 * POST /api/v1/emergency-profile/token/regenerate
 * Revokes existing QR emergency access token and issues a fresh cryptographically random token.
 * Prevents unauthorized access if QR code was previously photographed or shared.
 */
router.post('/token/regenerate', authenticate, async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    const newToken = crypto.randomBytes(24).toString('hex');

    const updated = await prisma.patientProfile.update({
      where: { userId: req.user.id },
      data: {
        emergencyAccessToken: newToken,
        tokenGeneratedAt: new Date(),
      },
    });

    return res.status(200).json({
      message: 'Emergency access token regenerated. All previous QR codes and links are now revoked.',
      emergencyAccessToken: newToken,
      tokenGeneratedAt: updated.tokenGeneratedAt,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to regenerate emergency access token' });
  }
});

/**
 * GET /api/v1/emergency-profile/access-logs
 * Patient reviews immutable audit trail of who accessed their emergency records.
 */
router.get('/access-logs', authenticate, async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const take = Math.min(parseInt(req.query.take as string) || 50, 100);
  const skip = parseInt(req.query.skip as string) || 0;

  try {
    const logs = await prisma.emergencyHealthAccessLog.findMany({
      where: { patientId: req.user.id },
      take,
      skip,
      orderBy: { timestamp: 'desc' },
    });

    const total = await prisma.emergencyHealthAccessLog.count({
      where: { patientId: req.user.id },
    });

    return res.status(200).json({
      logs,
      total,
      take,
      skip,
      dpdpNotice: DPDP_COMPLIANCE_NOTICE,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to fetch access logs' });
  }
});

/**
 * GET /api/v1/emergency-profile/qr-card/:token
 * PUBLIC QR SCAN ENDPOINT (Good Samaritan / Bystander view).
 * Security & Privacy: Returns ONLY a non-confidential safety card:
 * - Masked Patient Name
 * - Emergency Contact direct call numbers
 * - Official 112 Hotline button
 * ZERO sensitive clinical details are exposed!
 */
router.get('/qr-card/:token', async (req: Request, res: Response) => {
  const { token } = req.params;

  if (!token || token.length < 16) {
    return res.status(400).json({ message: 'Invalid emergency token format', code: 'INVALID_TOKEN' });
  }

  try {
    const profile = await prisma.patientProfile.findUnique({
      where: { emergencyAccessToken: token },
    });

    if (!profile) {
      return res.status(404).json({
        message: 'Emergency access token is invalid, expired, or has been revoked by the patient.',
        code: 'TOKEN_EXPIRED_OR_REVOKED',
      });
    }

    if (!profile.consentEmergencySharing) {
      return res.status(403).json({
        message: 'The patient has disabled external emergency access sharing.',
        code: 'EMERGENCY_SHARING_DISABLED',
      });
    }

    // Retrieve patient user & registered emergency contacts
    const patientUser = await prisma.user.findUnique({
      where: { id: profile.userId },
      include: { emergencyContacts: true },
    });

    if (!patientUser) {
      return res.status(404).json({ message: 'Patient account not found.', code: 'PATIENT_NOT_FOUND' });
    }

    // Audit log this public safety card scan (non-confidential triage)
    await prisma.emergencyHealthAccessLog.create({
      data: {
        patientId: patientUser.id,
        accessorId: null,
        accessorRole: 'ANONYMOUS_SCANNER',
        accessorName: 'Good Samaritan / On-Scene Bystander',
        organization: 'Public QR Medical ID Scan',
        accessType: EmergencyAccessType.PUBLIC_QR_SAFETY_CARD,
        accessReason: 'Bystander scanned emergency QR code',
        lawfulBasis: 'EMERGENCY_ASSISTANCE_DPDP_SEC_7',
        fieldsAccessed: ['maskedName', 'emergencyContacts', 'emergencyHotlines'],
        ipAddress: req.ip || null,
        userAgent: req.get('user-agent') || null,
      },
    });

    // Return strictly non-confidential safety card
    return res.status(200).json({
      status: 'SAFETY_CARD_ACTIVE',
      maskedPatientName: maskNameForSafetyCard(patientUser.name),
      isClinicalDataProtected: true,
      protectionNotice:
        'Sensitive clinical details (blood type, allergies, conditions, and medications) are protected under the Digital Personal Data Protection (DPDP) Act, 2023 and require authenticated break-glass declaration by authorized responders.',
      emergencyContacts: (patientUser.emergencyContacts || []).map((c: any) => ({
        name: c.name,
        phone: c.phone,
        relation: c.relation || 'Emergency Contact',
      })),
      emergencyHotlines: [
        { label: 'National Emergency Helpline (Pan-India)', number: '112' },
        { label: 'National Ambulance Service', number: '108' },
      ],
      breakGlassAvailable: true,
      breakGlassEndpoint: '/api/v1/emergency-profile/break-glass',
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to process emergency QR card' });
  }
});

/**
 * POST /api/v1/emergency-profile/break-glass
 * AUTHORIZED BREAK-GLASS EMERGENCY ACCESS
 * Authorized responder (Ambulance Driver, Hospital ER Doctor/Admin, Super Admin)
 * Body: { token: string, accessReason: string }
 * Decrypts & returns full clinical profile with provenance and audits the access.
 */
router.post('/break-glass', authenticate, async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Authentication required for break-glass clinical access.' });
  }

  // Must be an authorized responder role
  const allowedRoles: string[] = [Role.DRIVER, Role.ADMIN_HOSPITAL, Role.SUPER_ADMIN, Role.OPERATOR_ADMIN];
  if (!allowedRoles.includes(req.user.role)) {
    return res.status(403).json({
      message: 'Unauthorized: Only verified ambulance drivers, hospital ER personnel, and administrators may exercise break-glass clinical access.',
      code: 'FORBIDDEN_ROLE',
    });
  }

  const token = req.body.token;
  const accessReason = req.body.accessReason || req.body.reason;

  if (!token) {
    return res.status(400).json({ message: 'Emergency access token is required.', code: 'TOKEN_REQUIRED' });
  }

  if (!accessReason || typeof accessReason !== 'string' || accessReason.trim().length < 8) {
    return res.status(400).json({
      message: 'A specific clinical emergency reason (minimum 8 characters) is required to exercise break-glass access.',
      code: 'BREAK_GLASS_REASON_REQUIRED',
    });
  }

  try {
    const profile = await prisma.patientProfile.findUnique({
      where: { emergencyAccessToken: token },
    });

    if (!profile) {
      return res.status(404).json({
        message: 'Invalid or revoked emergency access token.',
        code: 'TOKEN_EXPIRED_OR_REVOKED',
      });
    }

    if (!profile.consentEmergencySharing) {
      return res.status(403).json({
        message: 'Patient has revoked emergency access sharing.',
        code: 'EMERGENCY_SHARING_DISABLED',
      });
    }

    const patientUser = await prisma.user.findUnique({
      where: { id: profile.userId },
      include: { emergencyContacts: true },
    });

    if (!patientUser) {
      return res.status(404).json({ message: 'Patient account not found.', code: 'PATIENT_NOT_FOUND' });
    }

    // Determine organization
    let org = 'Emergency Medical Services';
    if (req.user.role === Role.ADMIN_HOSPITAL && req.user.hospitalId) {
      const hosp = await prisma.hospital.findUnique({ where: { id: req.user.hospitalId } });
      if (hosp) org = hosp.name;
    } else if (req.user.role === Role.DRIVER) {
      org = 'Active Nagpur Ambulance Paramedic Unit';
    }

    // Immutable audit logging of break-glass access (DPDP Act 2023 Sec 7)
    await prisma.emergencyHealthAccessLog.create({
      data: {
        patientId: patientUser.id,
        accessorId: req.user.id,
        accessorRole: req.user.role,
        accessorName: req.user.name,
        organization: org,
        accessType: EmergencyAccessType.BREAK_GLASS_QR,
        accessReason: accessReason.trim(),
        lawfulBasis: 'EMERGENCY_MEDICAL_TREATMENT_DPDP_SEC_7',
        fieldsAccessed: [
          'bloodGroup',
          'bloodGroupProvenance',
          'allergies',
          'allergiesProvenance',
          'medicalConditions',
          'medicalConditionsProvenance',
          'currentMedications',
          'medicationsProvenance',
          'emergencyContacts',
          'organDonorStatus',
          'preferredHospital',
        ],
        ipAddress: req.ip || null,
        userAgent: req.get('user-agent') || null,
      },
    });

    return res.status(200).json({
      status: 'BREAK_GLASS_AUTHORIZED',
      patientName: patientUser.name,
      patientPhone: patientUser.phone || 'Not provided',
      clinicalProfile: {
        bloodGroup: {
          value: profile.bloodGroup || 'UNKNOWN',
          provenance: profile.bloodGroupProvenance,
          isVerified: profile.bloodGroupProvenance === DataProvenance.VERIFIED_CLINICAL,
        },
        allergies: {
          value: profile.allergies || 'None reported',
          provenance: profile.allergiesProvenance,
          isVerified: profile.allergiesProvenance === DataProvenance.VERIFIED_CLINICAL,
        },
        medicalConditions: {
          value: profile.medicalConditions || 'None reported',
          provenance: profile.medicalConditionsProvenance,
          isVerified: profile.medicalConditionsProvenance === DataProvenance.VERIFIED_CLINICAL,
        },
        currentMedications: {
          value: profile.currentMedications || 'None reported',
          provenance: profile.medicationsProvenance,
          isVerified: profile.medicationsProvenance === DataProvenance.VERIFIED_CLINICAL,
        },
        organDonorStatus: profile.organDonorStatus || 'NOT_SPECIFIED',
        preferredHospital: profile.preferredHospital || 'Nearest Hospital',
        medicalNotes: profile.medicalNotes || null,
        lastUpdated: profile.updatedAt,
      },
      emergencyContacts: patientUser.emergencyContacts || [],
      clinicalDisclaimer: CLINICAL_EMERGENCY_DISCLAIMER,
      auditRecordCreated: true,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Break-glass access failed' });
  }
});

/**
 * GET /api/v1/emergency-profile/dispatch/:requestId
 * ACTIVE DISPATCH TRIAGE ACCESS
 * Accessible by assigned ambulance driver or destination hospital during active emergency.
 */
router.get('/dispatch/:requestId', authenticate, async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const { requestId } = req.params;

  try {
    const request = await prisma.emergencyRequest.findUnique({
      where: { id: requestId },
      include: {
        patient: {
          include: {
            patientProfile: true,
            emergencyContacts: true,
          },
        },
      },
    });

    if (!request) {
      return res.status(404).json({ message: 'Emergency request not found.', code: 'REQUEST_NOT_FOUND' });
    }

    // Authorization verification:
    // User must be:
    // 1) The assigned driver for this request
    // 2) Or the destination hospital admin
    // 3) Or the patient themself
    // 4) Or a SUPER_ADMIN / OPERATOR_ADMIN
    const isAssignedDriver = request.driverId === req.user.id;
    let isHospitalAdmin = false;
    if (req.user.role === Role.ADMIN_HOSPITAL && request.hospitalId) {
      if (req.user.hospitalId === request.hospitalId) {
        isHospitalAdmin = true;
      } else {
        const destHospital = await prisma.hospital.findUnique({ where: { id: request.hospitalId } });
        if (destHospital && destHospital.adminUserId === req.user.id) {
          isHospitalAdmin = true;
        }
      }
    }
    const isPatientSelf = request.patientId === req.user.id;
    const isSuperAdmin = req.user.role === Role.SUPER_ADMIN || req.user.role === Role.OPERATOR_ADMIN;

    if (!isAssignedDriver && !isHospitalAdmin && !isPatientSelf && !isSuperAdmin) {
      return res.status(403).json({
        message: 'Forbidden: You are not assigned to this emergency request and do not have triage access.',
        code: 'UNAUTHORIZED_DISPATCH_ACCESS',
      });
    }

    const patient = request.patient;
    const profile = patient?.patientProfile;

    // Log the active dispatch triage access if accessed by driver or hospital
    if (!isPatientSelf) {
      await prisma.emergencyHealthAccessLog.create({
        data: {
          patientId: request.patientId,
          accessorId: req.user.id,
          accessorRole: req.user.role,
          accessorName: req.user.name,
          organization: isAssignedDriver ? 'Responding Ambulance Unit' : 'Destination Hospital ER',
          accessType: EmergencyAccessType.ACTIVE_DISPATCH_TRIAGE,
          accessReason: `Active dispatch triage for request ${requestId} (${request.category || 'EMERGENCY'})`,
          lawfulBasis: 'EMERGENCY_MEDICAL_TREATMENT_DPDP_SEC_7',
          fieldsAccessed: ['bloodGroup', 'allergies', 'medicalConditions', 'currentMedications', 'emergencyContacts'],
          ipAddress: req.ip || null,
          userAgent: req.get('user-agent') || null,
        },
      });
    }

    return res.status(200).json({
      status: 'DISPATCH_TRIAGE_ACTIVE',
      requestId: request.id,
      patientName: patient?.name || 'Emergency Patient',
      patientPhone: patient?.phone || 'Not provided',
      hasProfile: !!profile,
      clinicalProfile: profile
        ? {
            bloodGroup: {
              value: profile.bloodGroup || 'UNKNOWN',
              provenance: profile.bloodGroupProvenance,
              isVerified: profile.bloodGroupProvenance === DataProvenance.VERIFIED_CLINICAL,
            },
            allergies: {
              value: profile.allergies || 'None reported',
              provenance: profile.allergiesProvenance,
              isVerified: profile.allergiesProvenance === DataProvenance.VERIFIED_CLINICAL,
            },
            medicalConditions: {
              value: profile.medicalConditions || 'None reported',
              provenance: profile.medicalConditionsProvenance,
              isVerified: profile.medicalConditionsProvenance === DataProvenance.VERIFIED_CLINICAL,
            },
            currentMedications: {
              value: profile.currentMedications || 'None reported',
              provenance: profile.medicationsProvenance,
              isVerified: profile.medicationsProvenance === DataProvenance.VERIFIED_CLINICAL,
            },
            organDonorStatus: profile.organDonorStatus || 'NOT_SPECIFIED',
            preferredHospital: profile.preferredHospital || null,
            medicalNotes: profile.medicalNotes || null,
            lastUpdated: profile.updatedAt,
          }
        : null,
      emergencyContacts: patient?.emergencyContacts || [],
      clinicalDisclaimer: CLINICAL_EMERGENCY_DISCLAIMER,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to fetch dispatch triage profile' });
  }
});

/**
 * POST /api/v1/emergency-profile/verify-field
 * Clinical verification process: an authorized hospital administrator/clinician
 * marks a specific patient field as VERIFIED_CLINICAL after reviewing lab reports or clinical history.
 */
router.post(
  '/verify-field',
  authenticate,
  authorize([Role.ADMIN_HOSPITAL, Role.SUPER_ADMIN]),
  async (req: AuthRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const { patientId, fieldName, verifiedValue } = req.body;

    if (!patientId || !fieldName) {
      return res.status(400).json({ message: 'patientId and fieldName are required.' });
    }

    const validFields = ['bloodGroup', 'allergies', 'medicalConditions', 'currentMedications'];
    if (!validFields.includes(fieldName)) {
      return res.status(400).json({
        message: `Invalid fieldName. Must be one of: ${validFields.join(', ')}`,
      });
    }

    try {
      const existing = await prisma.patientProfile.findUnique({
        where: { userId: patientId },
      });

      if (!existing) {
        return res.status(404).json({ message: 'Patient profile not found.' });
      }

      const updateData: any = {
        verifiedBy: req.user.name,
        verifiedAt: new Date(),
      };

      if (fieldName === 'bloodGroup') {
        if (verifiedValue) updateData.bloodGroup = verifiedValue;
        updateData.bloodGroupProvenance = DataProvenance.VERIFIED_CLINICAL;
      } else if (fieldName === 'allergies') {
        if (verifiedValue !== undefined) updateData.allergies = verifiedValue;
        updateData.allergiesProvenance = DataProvenance.VERIFIED_CLINICAL;
      } else if (fieldName === 'medicalConditions') {
        if (verifiedValue !== undefined) updateData.medicalConditions = verifiedValue;
        updateData.medicalConditionsProvenance = DataProvenance.VERIFIED_CLINICAL;
      } else if (fieldName === 'currentMedications') {
        if (verifiedValue !== undefined) updateData.currentMedications = verifiedValue;
        updateData.medicationsProvenance = DataProvenance.VERIFIED_CLINICAL;
      }

      const updated = await prisma.patientProfile.update({
        where: { userId: patientId },
        data: updateData,
      });

      // Audit log the verification
      await prisma.emergencyHealthAccessLog.create({
        data: {
          patientId,
          accessorId: req.user.id,
          accessorRole: req.user.role,
          accessorName: req.user.name,
          organization: 'Authorized Clinical Verification',
          accessType: EmergencyAccessType.HOSPITAL_ADMISSION_TRIAGE,
          accessReason: `Clinical verification of ${fieldName} by ${req.user.name}`,
          lawfulBasis: 'CLINICAL_VERIFICATION_DPDP_SEC_7',
          fieldsAccessed: [fieldName],
          ipAddress: req.ip || null,
          userAgent: req.get('user-agent') || null,
        },
      });

      return res.status(200).json({
        message: `Field "${fieldName}" successfully verified by clinical staff.`,
        profile: updated,
      });
    } catch (error: any) {
      return res.status(500).json({ message: error.message || 'Failed to verify field' });
    }
  }
);

export default router;
