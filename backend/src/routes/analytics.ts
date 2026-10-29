import express, { Response } from 'express';
import { Role } from '@prisma/client';
import prisma from '../db';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { logAdminActivity } from '../utils/activityLogger';
import {
  getEmergencyOperationsAnalytics,
  generateAnalyticsCsv,
  AnalyticsFilterParams,
} from '../services/analyticsService';

const router = express.Router();

// Protected to authorized administrative roles only
router.use(authenticate as any);
router.use(authorize([Role.SUPER_ADMIN, Role.ADMIN_HOSPITAL, Role.OPERATOR_ADMIN]));

/**
 * Resolves organization scope constraints based on caller role.
 * Prevents Hospital/Operator admins from accessing cross-tenant metrics.
 */
async function resolveOrganizationScope(req: AuthRequest): Promise<{
  hospitalId?: string;
  operatorId?: string;
  scopeError?: string;
}> {
  const user = req.user!;

  if (user.role === Role.ADMIN_HOSPITAL) {
    const hosp = await prisma.hospital.findUnique({
      where: { adminUserId: user.id },
    });
    if (!hosp) {
      return { scopeError: 'Hospital organization not found for this administrator account.' };
    }
    return { hospitalId: hosp.id };
  }

  if (user.role === Role.OPERATOR_ADMIN) {
    const op = await prisma.ambulanceOperator.findFirst({
      where: { adminUserId: user.id },
    });
    if (!op) {
      return { scopeError: 'Private operator organization not found for this administrator account.' };
    }
    return { operatorId: op.id };
  }

  // Super Admin can optionally filter or view platform-wide data
  return {
    hospitalId: (req.query.hospitalId as string) || undefined,
    operatorId: (req.query.operatorId as string) || undefined,
  };
}

/**
 * Handler for fetching operations analytics report.
 */
const handleGetReports = async (req: AuthRequest, res: Response) => {
  try {
    const scope = await resolveOrganizationScope(req);
    if (scope.scopeError) {
      return res.status(403).json({ message: scope.scopeError });
    }

    const filterParams: AnalyticsFilterParams = {
      startDate: req.query.startDate as string,
      endDate: req.query.endDate as string,
      includeDemo: req.query.includeDemo === 'true',
      hospitalId: scope.hospitalId,
      operatorId: scope.operatorId,
      city: req.query.city as string,
      requestingUserRole: req.user!.role as Role,
      requestingUserId: req.user!.id,
    };

    const analytics = await getEmergencyOperationsAnalytics(filterParams);

    // Audit log privileged access
    await logAdminActivity(req.user!.id, 'ANALYTICS_REPORT_VIEWED', {
      role: req.user!.role,
      startDate: req.query.startDate as string,
      endDate: req.query.endDate as string,
      hospitalId: scope.hospitalId,
      operatorId: scope.operatorId,
    });

    return res.status(200).json({
      status: 'success',
      data: analytics,
    });
  } catch (error: any) {
    if (error.message?.includes('INVALID_DATE_FORMAT') || error.message?.includes('START_DATE_AFTER_END_DATE')) {
      return res.status(400).json({
        status: 'error',
        message: error.message,
      });
    }
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to generate operations analytics report.',
    });
  }
};

router.get('/reports', handleGetReports);
router.get('/overview', handleGetReports);

/**
 * GET /api/v1/analytics/export
 * Generates and downloads a CSV report with Spreadsheet Formula Injection (CWE-1236) sanitization.
 */
router.get('/export', async (req: AuthRequest, res: Response) => {
  try {
    const scope = await resolveOrganizationScope(req);
    if (scope.scopeError) {
      return res.status(403).json({ message: scope.scopeError });
    }

    const type = (req.query.type as any) || 'summary';
    const validTypes = ['summary', 'emergency_requests', 'dispatch_attempts', 'fleet', 'appointments', 'hospitals'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        status: 'error',
        message: `Invalid export type "${type}". Allowed types: ${validTypes.join(', ')}.`,
      });
    }

    const filterParams: AnalyticsFilterParams = {
      startDate: req.query.startDate as string,
      endDate: req.query.endDate as string,
      includeDemo: req.query.includeDemo === 'true',
      hospitalId: scope.hospitalId,
      operatorId: scope.operatorId,
      city: req.query.city as string,
      requestingUserRole: req.user!.role as Role,
      requestingUserId: req.user!.id,
    };

    const { filename, csv } = await generateAnalyticsCsv(type, filterParams);

    // Audit log privileged export
    await logAdminActivity(req.user!.id, 'ANALYTICS_CSV_EXPORTED', {
      role: req.user!.role,
      exportType: type,
      filename,
      hospitalId: scope.hospitalId,
      operatorId: scope.operatorId,
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(csv);
  } catch (error: any) {
    if (error.message?.includes('INVALID_DATE_FORMAT') || error.message?.includes('START_DATE_AFTER_END_DATE')) {
      return res.status(400).json({
        status: 'error',
        message: error.message,
      });
    }
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to export analytics CSV report.',
    });
  }
});

export default router;
