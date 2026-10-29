import { Router } from 'express';
import { Role, VerificationState } from '@prisma/client';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import prisma from '../db';
import { revokeAllUserTokens } from '../services/tokenService';
import { logSecurityEvent } from '../utils/securityLogger';
import { notifyDriverVerification, notifyOrganizationApproval } from '../services/notificationService';

const router = Router();

// Only authorized verification staff / Super Admin can perform verification reviews
router.use(authenticate, authorize([Role.SUPER_ADMIN, 'VERIFICATION_ADMIN']));

/**
 * POST /api/v1/verification/review
 * Approves, rejects, or flags an organization, driver, or vehicle for correction.
 * Never fabricates verification results or claims external government DB connectivity.
 * Explicitly records the reviewer ID, timestamp, and review method.
 */
router.post('/review', async (req: AuthRequest, res) => {
  const { entityType, entityId, status, reviewMethod, reviewNotes } = req.body;

  if (!entityType || !entityId || !status) {
    return res.status(400).json({
      status: 'fail',
      message: 'entityType, entityId, and status are required.',
    });
  }

  const validStates = Object.values(VerificationState);
  if (!validStates.includes(status)) {
    return res.status(400).json({
      status: 'fail',
      message: `Invalid verification status '${status}'. Must be one of: ${validStates.join(', ')}`,
    });
  }

  const method = reviewMethod || 'MANUAL_DOCUMENT_AUDIT';
  const reviewerId = req.user!.id;
  const now = new Date();

  try {
    let previousState: string = 'UNKNOWN';

    if (entityType === 'DRIVER') {
      const driver = await prisma.driverProfile.findUnique({ where: { id: entityId } });
      if (!driver) {
        return res.status(404).json({ status: 'fail', message: 'Driver profile not found.' });
      }
      previousState = driver.verificationState;
      await prisma.driverProfile.update({
        where: { id: entityId },
        data: {
          verificationState: status,
          reviewedBy: reviewerId,
          reviewedAt: now,
          reviewMethod: method,
          reviewNotes: reviewNotes || null,
          membershipStatus: status === VerificationState.VERIFIED ? 'APPROVED' : driver.membershipStatus,
        },
      });
    } else if (entityType === 'HOSPITAL') {
      const hospital = await prisma.hospital.findUnique({ where: { id: entityId } });
      if (!hospital) {
        return res.status(404).json({ status: 'fail', message: 'Hospital not found.' });
      }
      previousState = hospital.verificationState;
      await prisma.hospital.update({
        where: { id: entityId },
        data: {
          verificationState: status,
        },
      });
    } else if (entityType === 'OPERATOR') {
      const operator = await prisma.ambulanceOperator.findUnique({ where: { id: entityId } });
      if (!operator) {
        return res.status(404).json({ status: 'fail', message: 'Private ambulance operator not found.' });
      }
      previousState = operator.verificationState;
      await prisma.ambulanceOperator.update({
        where: { id: entityId },
        data: {
          verificationState: status,
          reviewedBy: reviewerId,
          reviewedAt: now,
        },
      });
    } else if (entityType === 'AMBULANCE') {
      const ambulance = await prisma.ambulance.findUnique({ where: { id: entityId } });
      if (!ambulance) {
        return res.status(404).json({ status: 'fail', message: 'Ambulance vehicle not found.' });
      }
      previousState = ambulance.verificationState;
      await prisma.ambulance.update({
        where: { id: entityId },
        data: {
          verificationState: status,
          verificationStatus: status === VerificationState.VERIFIED ? 'APPROVED' : 'PENDING',
        },
      });
    } else {
      return res.status(400).json({
        status: 'fail',
        message: "entityType must be 'DRIVER', 'HOSPITAL', 'OPERATOR', or 'AMBULANCE'.",
      });
    }

    // Record auditable review decision WITHOUT storing raw document contents
    const auditRecord = await prisma.verificationAuditLog.create({
      data: {
        actorId: reviewerId,
        action: 'VERIFICATION_DECISION',
        targetEntityType: entityType,
        targetEntityId: entityId,
        previousState,
        newState: status,
        reviewMethod: method,
        notes: reviewNotes ? String(reviewNotes).slice(0, 500) : null,
        isSimulated: method.includes('SIMULATED') || process.env.NODE_ENV === 'test',
      },
    });

    await logSecurityEvent('VERIFICATION_DECISION_RECORDED', reviewerId, {
      entityType,
      entityId,
      status,
      method,
    });

    // Centralized Notification Dispatch (Transactional Outbox)
    try {
      if (entityType === 'DRIVER') {
        const profile = await prisma.driverProfile.findUnique({ where: { id: entityId } });
        if (profile?.userId) {
          await notifyDriverVerification(profile.userId, status, reviewNotes);
        }
      } else if (entityType === 'HOSPITAL') {
        await notifyOrganizationApproval('HOSPITAL', entityId, status, reviewNotes);
      } else if (entityType === 'OPERATOR') {
        await notifyOrganizationApproval('OPERATOR', entityId, status, reviewNotes);
      }
    } catch (notifErr) {
      console.error('[NotificationEngine Error] verification notification failed:', notifErr);
    }

    return res.status(200).json({
      status: 'success',
      message: `Entity ${entityType} (${entityId}) updated to ${status}. Reviewer and audit record logged.`,
      audit: auditRecord,
    });
  } catch (error: any) {
    return res.status(500).json({ status: 'error', message: error.message || 'Internal server error' });
  }
});

/**
 * POST /api/v1/verification/suspend-account
 * Suspends an account and immediately invalidates all active sessions/refresh tokens.
 */
router.post('/suspend-account', async (req: AuthRequest, res) => {
  const { userId, reason } = req.body;
  if (!userId || !reason) {
    return res.status(400).json({ status: 'fail', message: 'userId and reason are required.' });
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ status: 'fail', message: 'User not found.' });
    }

    // Update user suspension flag
    await prisma.user.update({
      where: { id: userId },
      data: { isSuspended: true },
    });

    // Revoke all active refresh tokens for the user
    await revokeAllUserTokens(userId);

    // Audit log
    await prisma.verificationAuditLog.create({
      data: {
        actorId: req.user!.id,
        action: 'ACCOUNT_SUSPENDED',
        targetEntityType: 'USER',
        targetEntityId: userId,
        previousState: user.isSuspended ? 'SUSPENDED' : 'ACTIVE',
        newState: 'SUSPENDED',
        reviewMethod: 'ADMINISTRATIVE_ACTION',
        notes: String(reason).slice(0, 500),
      },
    });

    await logSecurityEvent('ACCOUNT_SUSPENDED', req.user!.id, { targetUserId: userId, reason });

    return res.status(200).json({
      status: 'success',
      message: 'Account successfully suspended and all active sessions revoked.',
    });
  } catch (error: any) {
    return res.status(500).json({ status: 'error', message: error.message || 'Internal server error' });
  }
});

/**
 * POST /api/v1/verification/reactivate-account
 * Reactivates a suspended user account with reviewer identity, reason, and audit logging.
 */
router.post('/reactivate-account', async (req: AuthRequest, res) => {
  const { userId, reason } = req.body;
  if (!userId || !reason) {
    return res.status(400).json({ status: 'fail', message: 'userId and reason are required.' });
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ status: 'fail', message: 'User not found.' });
    }

    await prisma.user.update({
      where: { id: userId },
      data: { isSuspended: false, isActive: true },
    });

    await prisma.verificationAuditLog.create({
      data: {
        actorId: req.user!.id,
        action: 'ACCOUNT_REACTIVATED',
        targetEntityType: 'USER',
        targetEntityId: userId,
        previousState: 'SUSPENDED',
        newState: 'ACTIVE',
        reviewMethod: 'ADMINISTRATIVE_ACTION',
        notes: String(reason).slice(0, 500),
      },
    });

    await logSecurityEvent('ACCOUNT_REACTIVATED', req.user!.id, { targetUserId: userId, reason });

    return res.status(200).json({
      status: 'success',
      message: 'Account successfully reactivated.',
    });
  } catch (error: any) {
    return res.status(500).json({ status: 'error', message: error.message || 'Internal server error' });
  }
});

/**
 * GET /api/v1/verification/audit-logs
 * Retrieves verification audit trail.
 */
router.get('/audit-logs', async (req: AuthRequest, res) => {
  try {
    const logs = await prisma.verificationAuditLog.findMany();
    return res.status(200).json({
      status: 'success',
      logs,
    });
  } catch (error: any) {
    return res.status(500).json({ status: 'error', message: error.message || 'Internal server error' });
  }
});

export default router;
