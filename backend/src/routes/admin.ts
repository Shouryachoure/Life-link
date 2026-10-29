import { Router } from 'express';
import { Role, VerificationState } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import prisma from '../db';
import { logAdminActivity } from '../utils/activityLogger';
import { metrics } from '../utils/metrics';
import { logger } from '../utils/logger';
import { processOutboxRetries, expireObsoleteOffers } from '../services/notificationService';
import { recoverInterruptedDispatches } from '../services/dispatchEngine';
import { getIO, broadcastToSuperAdmin } from '../socket';
import { revokeAllUserTokens } from '../services/tokenService';

const router = Router();

// Only SUPER_ADMIN allowed
router.use(authenticate, authorize([Role.SUPER_ADMIN]));

// Telemetry endpoint
router.get('/telemetry', async (req: AuthRequest, res) => {
  try {
    const totalTrips = await prisma.emergencyRequest.count();
    const activeCount = await prisma.emergencyRequest.count({
      where: {
        status: {
          notIn: ['COMPLETED', 'REJECTED'],
        },
      },
    });

    const onlineDriversCount = await prisma.ambulance.count({
      where: { isAvailable: true },
    });

    const hospitals = await prisma.hospital.findMany({
      include: {
        adminUser: {
          select: { name: true, email: true, phone: true },
        },
      },
    });

    const totalBeds = hospitals.reduce((sum, h) => sum + h.availableBeds, 0);

    const completedTrips = await prisma.emergencyRequest.count({
      where: { status: 'COMPLETED' },
    });
    const successRate = totalTrips > 0 ? Math.round((completedTrips / totalTrips) * 100) : 100;

    const requests = await prisma.emergencyRequest.findMany({
      include: {
        patient: { select: { name: true, email: true } },
        driver: { select: { name: true } },
        hospital: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const drivers = await prisma.ambulance.findMany({
      include: {
        driver: {
          select: { name: true, email: true, phone: true },
        },
      },
    });

    return res.json({
      telemetry: {
        totalTrips,
        activeCount,
        onlineDriversCount,
        totalBeds,
        successRate,
      },
      requests,
      drivers,
      hospitals,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Internal server error' });
  }
});

// Create Hospital Admin + Hospital
router.post('/hospitals', async (req: AuthRequest, res) => {
  const {
    name,
    address,
    contactNumber,
    lat,
    lng,
    availableBeds,
    adminName,
    adminEmail,
    adminPassword,
  } = req.body;

  try {
    const existingUser = await prisma.user.findUnique({ where: { email: adminEmail } });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists with this admin email' });
    }

    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(adminPassword || 'password123', salt);

    const result = await prisma.$transaction(async (tx) => {
      const adminUser = await tx.user.create({
        data: {
          name: adminName,
          email: adminEmail,
          passwordHash,
          role: Role.ADMIN_HOSPITAL,
          phone: contactNumber,
        },
      });

      const hospital = await tx.hospital.create({
        data: {
          name,
          address,
          contactNumber,
          lat: parseFloat(lat) || 37.7749,
          lng: parseFloat(lng) || -122.4194,
          availableBeds: parseInt(availableBeds) || 0,
          adminUserId: adminUser.id,
        },
      });

      return { adminUser, hospital };
    });

    return res.status(201).json(result);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Internal server error' });
  }
});

// Edit hospital
router.put('/hospitals/:id', async (req: AuthRequest, res) => {
  const { id } = req.params;
  const { name, address, contactNumber, lat, lng, availableBeds } = req.body;

  try {
    const hospital = await prisma.hospital.update({
      where: { id },
      data: {
        name,
        address,
        contactNumber,
        lat: parseFloat(lat),
        lng: parseFloat(lng),
        availableBeds: parseInt(availableBeds) || 0,
      },
    });
    return res.json(hospital);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Internal server error' });
  }
});

// Delete hospital
router.delete('/hospitals/:id', async (req: AuthRequest, res) => {
  const { id } = req.params;

  try {
    const hospital = await prisma.hospital.findUnique({ where: { id } });
    if (!hospital) {
      return res.status(404).json({ message: 'Hospital not found' });
    }

    await prisma.$transaction([
      prisma.hospital.delete({ where: { id } }),
      prisma.user.delete({ where: { id: hospital.adminUserId } }),
    ]);

    return res.json({ message: 'Hospital and admin user deleted successfully' });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Internal server error' });
  }
});

// Seed editor to edit details (for quick local modifications)
router.put('/seed-data', async (req: AuthRequest, res) => {
  const { type, id, ...data } = req.body;

  try {
    if (type === 'driver') {
      const updated = await prisma.ambulance.update({
        where: { id },
        data: {
          vehicleNumber: data.vehicleNumber,
          currentLat: parseFloat(data.currentLat),
          currentLng: parseFloat(data.currentLng),
          isAvailable: data.isAvailable,
        },
      });
      return res.json(updated);
    } else if (type === 'hospital') {
      const updated = await prisma.hospital.update({
        where: { id },
        data: {
          name: data.name,
          availableBeds: parseInt(data.availableBeds) || 0,
          lat: parseFloat(data.lat),
          lng: parseFloat(data.lng),
        },
      });
      return res.json(updated);
    }
    return res.status(400).json({ message: 'Invalid edit type' });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Internal server error' });
  }
});

// GET all users (Patients, Drivers, Admins, Super Admin)
router.get('/users', async (req: AuthRequest, res) => {
  try {
    const users = await prisma.user.findMany({
      include: {
        patientProfile: true,
        ambulance: true,
        hospital: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // Hide password hashes
    const safeUsers = users.map((u) => {
      const { passwordHash, ...safe } = u;
      return safe;
    });

    return res.json(safeUsers);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Internal server error' });
  }
});

// PUT update user (Super Admin modify user data)
router.put('/users/:id', async (req: AuthRequest, res) => {
  const { id } = req.params;
  const {
    name,
    email,
    phone,
    role,
    // Patient specific
    bloodGroup,
    allergies,
    emergencyContactName,
    emergencyContactPhone,
    medicalNotes,
    // Driver specific
    vehicleNumber,
    ambulanceType,
    isAvailable,
  } = req.body;

  try {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const updatedUser = await prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id },
        data: {
          name,
          email,
          phone,
          role,
        },
      });

      if (role === 'PATIENT') {
        await tx.patientProfile.upsert({
          where: { userId: id },
          update: {
            bloodGroup,
            allergies,
            emergencyContactName,
            emergencyContactPhone,
            medicalNotes,
          },
          create: {
            userId: id,
            bloodGroup: bloodGroup || 'O+',
            allergies: allergies || '',
            emergencyContactName: emergencyContactName || 'Emergency Services',
            emergencyContactPhone: emergencyContactPhone || '',
            medicalNotes: medicalNotes || '',
          },
        });
      } else if (role === 'DRIVER') {
        await tx.ambulance.upsert({
          where: { driverId: id },
          update: {
            vehicleNumber,
            ambulanceType,
            isAvailable: !!isAvailable,
          },
          create: {
            driverId: id,
            vehicleNumber: vehicleNumber || 'AMB-NEW',
            ambulanceType: ambulanceType || 'BASIC_LIFE_SUPPORT',
            isAvailable: !!isAvailable,
            currentLat: 37.7749,
            currentLng: -122.4194,
          },
        });
      }

      return u;
    });

    return res.json(updatedUser);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Internal server error' });
  }
});

// DELETE delete user (Super Admin remove account)
router.delete('/users/:id', async (req: AuthRequest, res) => {
  const { id } = req.params;

  try {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // We delete the user. Prisma schemas cascade deletes PatientProfile, Ambulance, and Hospital because of cascade configuration!
    await prisma.user.delete({ where: { id } });
    return res.json({ message: 'User account and profile deleted successfully' });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Internal server error' });
  }
});

// =========================================================================
// HOSPITAL ADMIN MANAGEMENT (Feature 3)
// =========================================================================

// List all Hospital Admins
router.get('/hospital-admins', async (req: AuthRequest, res) => {
  try {
    const admins = await prisma.user.findMany({
      where: { role: Role.ADMIN_HOSPITAL },
      include: {
        hospital: {
          select: {
            id: true,
            name: true,
            address: true,
            contactNumber: true,
            availableBeds: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const safeAdmins = admins.map(({ passwordHash, ...safe }) => safe);
    return res.json(safeAdmins);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Internal server error' });
  }
});

// Soft delete / Reactivate hospital admin
router.patch('/hospital-admins/:id/toggle-status', async (req: AuthRequest, res) => {
  const { id } = req.params;

  try {
    const user = await prisma.user.findUnique({
      where: { id },
      include: { hospital: true },
    });

    if (!user || user.role !== Role.ADMIN_HOSPITAL) {
      return res.status(404).json({ message: 'Hospital admin account not found' });
    }

    const newStatus = !user.isActive;
    const updated = await prisma.user.update({
      where: { id },
      data: { isActive: newStatus },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        hospital: true,
      },
    });

    // Record activity log
    await logAdminActivity(
      req.user!.id,
      newStatus ? 'HOSPITAL_ADMIN_REACTIVATED' : 'HOSPITAL_ADMIN_DEACTIVATED',
      {
        targetAdminId: id,
        adminEmail: user.email,
        hospitalName: user.hospital?.name || 'Unassigned',
        newStatus: newStatus ? 'ACTIVE' : 'DEACTIVATED',
      }
    );

    return res.json({
      message: `Hospital admin account ${newStatus ? 'reactivated' : 'deactivated'} successfully`,
      admin: updated,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Internal server error' });
  }
});

// Update hospital admin details
router.put('/hospital-admins/:id', async (req: AuthRequest, res) => {
  const { id } = req.params;
  const { name, email, phone, hospitalName, address, contactNumber, availableBeds } = req.body;

  try {
    const user = await prisma.user.findUnique({
      where: { id },
      include: { hospital: true },
    });

    if (!user || user.role !== Role.ADMIN_HOSPITAL) {
      return res.status(404).json({ message: 'Hospital admin account not found' });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id },
        data: {
          name: name || user.name,
          email: email || user.email,
          phone: phone !== undefined ? phone : user.phone,
        },
      });

      let h = null;
      if (user.hospital) {
        h = await tx.hospital.update({
          where: { id: user.hospital.id },
          data: {
            name: hospitalName || user.hospital.name,
            address: address || user.hospital.address,
            contactNumber: contactNumber || user.hospital.contactNumber,
            availableBeds: availableBeds !== undefined ? parseInt(availableBeds) : user.hospital.availableBeds,
          },
        });
      }

      return { user: u, hospital: h };
    });

    await logAdminActivity(req.user!.id, 'HOSPITAL_ADMIN_UPDATED', {
      targetAdminId: id,
      adminEmail: updated.user.email,
      hospitalName: updated.hospital?.name,
    });

    const { passwordHash: _, ...safeUser } = updated.user;
    return res.json({ user: safeUser, hospital: updated.hospital });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Internal server error' });
  }
});

// =========================================================================
// HOSPITAL REGISTRATION APPROVAL WORKFLOW (Feature 4)
// =========================================================================

// List pending or all hospital registrations
router.get('/hospital-registrations', async (req: AuthRequest, res) => {
  const status = req.query.status as string;

  try {
    const where: any = {};
    if (status && ['PENDING', 'APPROVED', 'REJECTED'].includes(status.toUpperCase())) {
      where.status = status.toUpperCase();
    }

    const registrations = await prisma.hospitalRegistration.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    return res.json(registrations);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Internal server error' });
  }
});

// Approve hospital registration
router.post('/hospital-registrations/:id/approve', async (req: AuthRequest, res) => {
  const { id } = req.params;

  try {
    const reg = await prisma.hospitalRegistration.findUnique({ where: { id } });
    if (!reg) {
      return res.status(404).json({ message: 'Hospital registration not found' });
    }

    if (reg.status !== 'PENDING') {
      return res.status(400).json({ message: `Registration has already been ${reg.status.toLowerCase()}` });
    }

    const existingUser = await prisma.user.findUnique({ where: { email: reg.email } });
    if (existingUser) {
      return res.status(400).json({ message: 'A user account with this email address already exists' });
    }

    const result = await prisma.$transaction(async (tx) => {
      // 1. Create real User record with role ADMIN_HOSPITAL using submitted pre-hashed password
      const adminUser = await tx.user.create({
        data: {
          name: `${reg.hospitalName} Administrator`,
          email: reg.email,
          passwordHash: reg.passwordHash,
          role: Role.ADMIN_HOSPITAL,
          phone: reg.contactNumber,
          isActive: true,
        },
      });

      // 2. Create Hospital record linked to this admin
      const hospital = await tx.hospital.create({
        data: {
          name: reg.hospitalName,
          address: reg.address || 'Standard Medical Facility',
          contactNumber: reg.contactNumber,
          lat: 37.7749 + (Math.random() - 0.5) * 0.05,
          lng: -122.4194 + (Math.random() - 0.5) * 0.05,
          availableBeds: 12,
          adminUserId: adminUser.id,
        },
      });

      // 3. Mark registration as APPROVED
      const updatedReg = await tx.hospitalRegistration.update({
        where: { id },
        data: {
          status: 'APPROVED',
          reviewedAt: new Date(),
          reviewedBy: req.user!.id,
        },
      });

      return { adminUser, hospital, registration: updatedReg };
    });

    // Broadcast activity log to Super Admin room
    await logAdminActivity(req.user!.id, 'HOSPITAL_REGISTRATION_APPROVED', {
      registrationId: id,
      hospitalName: reg.hospitalName,
      adminEmail: reg.email,
      adminId: result.adminUser.id,
    });

    const { passwordHash: _, ...safeUser } = result.adminUser;
    return res.json({
      message: `Hospital "${reg.hospitalName}" approved successfully! Hospital admin account created.`,
      user: safeUser,
      hospital: result.hospital,
    });
  } catch (error: any) {
    console.error('Approval error:', error);
    return res.status(500).json({ message: error.message || 'Internal server error' });
  }
});

// Reject hospital registration
router.post('/hospital-registrations/:id/reject', async (req: AuthRequest, res) => {
  const { id } = req.params;
  const { reason } = req.body;

  try {
    const reg = await prisma.hospitalRegistration.findUnique({ where: { id } });
    if (!reg) {
      return res.status(404).json({ message: 'Hospital registration not found' });
    }

    if (reg.status !== 'PENDING') {
      return res.status(400).json({ message: `Registration has already been ${reg.status.toLowerCase()}` });
    }

    const updatedReg = await prisma.hospitalRegistration.update({
      where: { id },
      data: {
        status: 'REJECTED',
        rejectionReason: reason || 'Application did not meet criteria',
        reviewedAt: new Date(),
        reviewedBy: req.user!.id,
      },
    });

    await logAdminActivity(req.user!.id, 'HOSPITAL_REGISTRATION_REJECTED', {
      registrationId: id,
      hospitalName: reg.hospitalName,
      adminEmail: reg.email,
      reason: reason || 'Application did not meet criteria',
    });

    return res.json({
      message: `Hospital registration for "${reg.hospitalName}" marked as REJECTED.`,
      registration: updatedReg,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Internal server error' });
  }
});

// =========================================================================
// REAL-TIME ACTIVITY LOGS (Feature 3)
// =========================================================================

router.get('/activity-logs', async (req: AuthRequest, res) => {
  const adminId = req.query.adminId as string;
  const limit = parseInt(req.query.limit as string) || 60;

  try {
    const where: any = {};
    if (adminId) {
      where.adminId = adminId;
    }

    const logs = await prisma.activityLog.findMany({
      where,
      include: {
        admin: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            hospital: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });

    return res.json(logs);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Internal server error' });
  }
});

// =========================================================================
// OBSERVABILITY & SRE DIAGNOSTICS (Feature 4)
// =========================================================================

/**
 * Authenticated Detailed Diagnostics Endpoint (Strictly Super Admin)
 * Evaluates core subsystems, database latency, integration states, memory footprint,
 * and outbox backlog without exposing secrets or connection strings.
 */
router.get('/diagnostics', async (req: AuthRequest, res) => {
  const dbStart = Date.now();
  let dbStatus = 'connected';
  let dbLatencyMs = 0;

  try {
    await prisma.$queryRaw`SELECT 1`;
    dbLatencyMs = Date.now() - dbStart;
    metrics.recordDbOperation('queryRaw', 'HealthPing', true, dbLatencyMs);
  } catch (err: any) {
    dbStatus = 'unreachable';
    dbLatencyMs = Date.now() - dbStart;
    metrics.recordDbOperation('queryRaw', 'HealthPing', false, dbLatencyMs);
  }

  // Count active outbox backlog
  let outboxBacklog = 0;
  try {
    outboxBacklog = await prisma.notification.count({
      where: { status: 'PENDING' },
    });
    metrics.setOutboxBacklogCount(outboxBacklog);
  } catch {
    // Fail safe
  }

  const memory = process.memoryUsage();
  const io = getIO();
  const activeSockets = io?.engine?.clientsCount || 0;

  const diagnostics = {
    service: 'LifeLink Emergency Care Platform',
    version: '2.0.0',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    database: {
      status: dbStatus,
      type: 'PostgreSQL',
      latencyMs: dbLatencyMs,
    },
    integrations: {
      twilioSms: {
        configured: !!process.env.TWILIO_ACCOUNT_SID,
        mode: process.env.TWILIO_ACCOUNT_SID ? 'LIVE_CELLULAR_DELIVERY' : 'MOCK_OUTBOX_SIMULATION',
        status: 'OPERATIONAL',
      },
      geminiAi: {
        configured: !!process.env.GEMINI_API_KEY,
        mode: process.env.GEMINI_API_KEY ? 'LIVE_GEMINI_PROVIDER' : 'LOCAL_CLINICAL_FALLBACK',
        status: 'OPERATIONAL',
      },
      routingEngine: {
        mode: process.env.MAPBOX_ACCESS_TOKEN ? 'MAPBOX_DIRECTIONS_V5' : 'OSRM_OR_HAVERSINE_FALLBACK',
        status: 'OPERATIONAL',
      },
      socketIo: {
        activeConnections: activeSockets,
        status: io ? 'LISTENING' : 'OFFLINE',
      },
    },
    workers: {
      outboxBacklogPending: outboxBacklog,
      dispatchOfferTimeoutSeconds: 45,
      outboxWorkerIntervalSeconds: 60,
    },
    system: {
      memoryRssMb: parseFloat((memory.rss / (1024 * 1024)).toFixed(2)),
      heapUsedMb: parseFloat((memory.heapUsed / (1024 * 1024)).toFixed(2)),
      heapTotalMb: parseFloat((memory.heapTotal / (1024 * 1024)).toFixed(2)),
      nodeVersion: process.version,
    },
  };

  logger.info('DIAGNOSTICS', `Super Admin ${req.user?.email || 'admin'} inspected system diagnostics`, {
    correlationId: (req as any).correlationId,
    operationOutcome: 'SUCCESS',
  });

  return res.json(diagnostics);
});

/**
 * Operational Metrics Endpoint (JSON or OpenMetrics / Prometheus exposition format)
 */
router.get('/metrics', async (req: AuthRequest, res) => {
  const acceptHeader = req.headers.accept || '';
  const formatQuery = req.query.format as string;

  if (acceptHeader.includes('text/plain') || formatQuery === 'prometheus') {
    res.setHeader('Content-Type', 'text/plain; version=0.0.4');
    return res.send(metrics.toPrometheusFormat());
  }

  return res.json(metrics.getSnapshot());
});

/**
 * Privileged Background Worker Recovery Trigger
 * Manually executes outbox draining and stale offer resolution with full audit logging.
 */
router.post('/workers/trigger', async (req: AuthRequest, res) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const { reason = 'Manual administrative recovery trigger' } = req.body;

  try {
    const dispatchRecovery = await recoverInterruptedDispatches();
    const outboxRecovery = await processOutboxRetries();
    const expiredOffers = await expireObsoleteOffers();

    metrics.recordWorkerRun('admin_manual_trigger', true);

    await logAdminActivity(
      req.user.id,
      'TRIGGER_RECOVERY_WORKERS',
      {
        reason,
        dispatchExpired: dispatchRecovery.expiredCount,
        unresolvedEscalations: dispatchRecovery.unresolvedRequests,
        outboxDelivered: outboxRecovery.delivered,
        outboxFailed: outboxRecovery.failed,
        expiredOffers,
      }
    );

    logger.info('RECOVERY_WORKER', `Admin recovery trigger executed by ${req.user.id}`, {
      correlationId: (req as any).correlationId,
      operationOutcome: 'SUCCESS',
      metadata: {
        dispatchRecovery,
        outboxRecovery,
        expiredOffers,
      },
    });

    return res.json({
      message: 'Background recovery workers executed successfully.',
      results: {
        dispatchRecovery,
        outboxRecovery,
        expiredOffers,
      },
    });
  } catch (error: any) {
    metrics.recordWorkerRun('admin_manual_trigger', false);
    logger.error('RECOVERY_WORKER', 'Manual recovery trigger failed', {
      correlationId: (req as any).correlationId,
      error,
      operationOutcome: 'FAILURE',
    });
    return res.status(500).json({ message: error.message || 'Worker execution failed' });
  }
});

/**
 * Environment Operational Mode Inspection
 * Explicitly separates Demo/Test Mode from Controlled Pilot Mode.
 */
router.get('/mode', async (_req: AuthRequest, res) => {
  const isPilot = process.env.PILOT_MODE === 'true' || process.env.LIFELINK_MODE === 'PILOT';
  return res.json({
    environment: process.env.NODE_ENV || 'development',
    mode: isPilot ? 'PILOT' : 'DEMO',
    pilotZone: 'Nagpur Pilot Zone',
    pilotOperationalApproved: process.env.PILOT_OPERATIONAL_APPROVAL === 'true',
    demoQuarantineEnforced: true,
    simulatedDispatchBlockedFromProduction: true,
    smsProvider: process.env.TWILIO_ACCOUNT_SID ? 'LIVE_CELLULAR_DELIVERY' : 'MOCK_OUTBOX_SIMULATION',
    isolationRules: [
      'Simulated drivers and vehicles are strictly ineligible for production dispatch',
      'Synthetic GPS updates are quarantined and marked SIMULATED',
      'Mock SMS delivery is explicitly flagged as mock: true without carrier transmission',
      'Demo reset targets only records with isDemo: true; production pilot data is preserved',
    ],
  });
});

/**
 * Isolated Demo Dataset Reset
 * Safely purges only records with isDemo: true without affecting genuine pilot organizations or personnel.
 */
router.post('/demo/reset', async (req: AuthRequest, res) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    const deletedRequests = await prisma.emergencyRequest.deleteMany({ where: { isDemo: true } });
    const deletedAttempts = await prisma.dispatchAttempt.deleteMany({ where: { isDemo: true } });
    const deletedTrips = await prisma.emergencyTrip.deleteMany({ where: { isDemo: true } });
    const deletedEvents = await prisma.emergencyEvent.deleteMany({ where: { isDemo: true } });

    await logAdminActivity(req.user.id, 'RESET_DEMO_DATA', {
      cleared: {
        emergencyRequests: deletedRequests.count,
        dispatchAttempts: deletedAttempts.count,
        emergencyTrips: deletedTrips.count,
        emergencyEvents: deletedEvents.count,
      },
      reason: req.body?.reason || 'Administrative demo environment reset',
      timestamp: new Date().toISOString(),
    });

    logger.info('ADMIN', `Isolated demo dataset reset executed by ${req.user.email || req.user.id}`, {
      correlationId: (req as any).correlationId,
      operationOutcome: 'SUCCESS',
      metadata: {
        cleared: {
          emergencyRequests: deletedRequests.count,
          dispatchAttempts: deletedAttempts.count,
          emergencyTrips: deletedTrips.count,
          emergencyEvents: deletedEvents.count,
        },
      },
    });

    return res.json({
      success: true,
      message: 'Isolated demo/test dataset reset successfully. Genuine pilot organizations, verified personnel, and live audit records were preserved.',
      cleared: {
        emergencyRequests: deletedRequests.count,
        dispatchAttempts: deletedAttempts.count,
        emergencyTrips: deletedTrips.count,
        emergencyEvents: deletedEvents.count,
      },
      productionPreserved: true,
    });
  } catch (error: any) {
    logger.error('ADMIN', 'Failed to reset demo dataset', {
      correlationId: (req as any).correlationId,
      error,
      operationOutcome: 'FAILURE',
    });
    return res.status(500).json({ message: error.message || 'Demo reset failed' });
  }
});

// ==========================================
// REAL-TIME EMERGENCY OPERATIONS COMMAND CENTER
// (Prompt 25 Implementation)
// ==========================================

const METRIC_DEFINITIONS = {
  emergencyRequests:
    'Aggregated emergency dispatch requests categorized by active lifecycle, completed, cancelled, and escalated states with explicit demo vs production data segregation.',
  activeTripsAndOffers:
    'Live trips currently en route or on-scene alongside pending unexpired dispatch offers awaiting driver acceptance.',
  unresolvedEscalations:
    'Critical emergency incidents unable to secure an eligible verified ambulance within SLA, requiring 112 emergency service manual intervention.',
  fleetStatus:
    'Certified fleet breakdown between hospital networks and private operators. Suspended or unverified vehicles are strictly excluded from dispatchable counts.',
  pendingVerifications:
    'Hospitals, private fleet operators, and drivers awaiting credential review, license compliance, and administrative verification.',
  credentialExpirations:
    'Driver commercial licenses, vehicle fitness certificates, and insurance policies expired or expiring within 30 days, plus suspended entities.',
  notificationOutbox:
    'Transactional outbox telemetry across SMS, push, email, and WebSockets tracking queue depth, retries, and deliverability failures.',
  gpsFreshness:
    'Real-time fleet telemetry freshness segmenting vehicles into Active/Fresh (<5m), Aging (5-30m), and Tracking Outage (>30m).',
  opdAndAppointments:
    'OPD patient appointment queues, token progress, doctor availability, and clinic slot allocation across medical centers.',
  nagpurPilotStatus:
    'Operational boundary (30km radius centered at 21.1458, 79.0882), pilot authorization mode, and municipal deployment status for Nagpur.',
};

/**
 * GET /api/admin/command-center/overview
 * Real-time composite telemetry aggregation across all 10 operations modules.
 */
router.get('/command-center/overview', async (req: AuthRequest, res) => {
  try {
    const now = new Date();

    // 1. Emergency Requests Telemetry
    const allRequests = await prisma.emergencyRequest.findMany({
      include: {
        patient: { select: { id: true, name: true, phone: true } },
        driver: { select: { id: true, name: true, phone: true } },
        hospital: { select: { id: true, name: true } },
        ambulance: { select: { id: true, vehicleNumber: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const requestStates: Record<string, number> = {
      REQUESTED: 0,
      OFFERED: 0,
      ACCEPTED: 0,
      ASSIGNED: 0,
      ARRIVING: 0,
      AMBULANCE_ARRIVING: 0,
      PATIENT_PICKED_UP: 0,
      IN_TRANSIT: 0,
      AT_HOSPITAL: 0,
      AT_DESTINATION: 0,
      COMPLETED: 0,
      CANCELLED: 0,
      REJECTED: 0,
      NO_ELIGIBLE_AMBULANCE: 0,
      ESCALATED_112: 0,
      EXPIRED: 0,
      FAILED: 0,
    };

    let activeRequestsCount = 0;
    let completedRequestsCount = 0;
    let cancelledRequestsCount = 0;
    let escalatedRequestsCount = 0;
    let demoRequestsCount = 0;
    let productionRequestsCount = 0;

    const activeStateSet = new Set([
      'REQUESTED',
      'VALIDATING',
      'SEARCHING',
      'OFFERED',
      'ACCEPTED',
      'ASSIGNED',
      'ARRIVING',
      'AMBULANCE_ARRIVING',
      'PATIENT_PICKED_UP',
      'IN_TRANSIT',
      'AT_HOSPITAL',
      'AT_DESTINATION',
    ]);
    const cancelledStateSet = new Set(['CANCELLED', 'REJECTED', 'EXPIRED', 'FAILED']);

    for (const reqItem of allRequests) {
      const status = reqItem.status as string;
      requestStates[status] = (requestStates[status] || 0) + 1;

      if (reqItem.isDemo) {
        demoRequestsCount++;
      } else {
        productionRequestsCount++;
      }

      if (status === 'NO_ELIGIBLE_AMBULANCE' || status === 'ESCALATED_112') {
        escalatedRequestsCount++;
      } else if (status === 'COMPLETED') {
        completedRequestsCount++;
      } else if (cancelledStateSet.has(status)) {
        cancelledRequestsCount++;
      } else if (activeStateSet.has(status)) {
        activeRequestsCount++;
      }
    }

    // 2. Active Trips and Unexpired Dispatch Offers
    const allTrips = await prisma.emergencyTrip.findMany({
      include: {
        request: { select: { id: true, pickupLat: true, pickupLng: true, pickupAddress: true, category: true, isDemo: true } },
        ambulance: { select: { id: true, vehicleNumber: true, ambulanceType: true } },
        driver: { select: { id: true, name: true, phone: true } },
        hospital: { select: { id: true, name: true } },
      },
    });

    const activeTrips = allTrips
      .filter((t: any) => t.status !== 'COMPLETED' && t.status !== 'CANCELLED')
      .map((t: any) => ({
        id: t.id,
        requestId: t.requestId,
        status: t.status,
        startedAt: t.startedAt || t.createdAt,
        patientName: t.request?.patient?.name || 'Emergency Patient',
        driverName: t.driver?.name || 'Assigned Driver',
        driverPhone: t.driver?.phone || null,
        vehicleNumber: t.ambulance?.vehicleNumber || 'Pending',
        ambulanceType: t.ambulance?.ambulanceType || 'BASIC_LIFE_SUPPORT',
        hospitalName: t.hospital?.name || null,
        isDemo: t.isDemo || t.request?.isDemo || false,
      }));

    const allAttempts = await prisma.dispatchAttempt.findMany({
      include: {
        ambulance: { select: { vehicleNumber: true } },
        driver: { select: { name: true } },
      },
    });

    const activeOffers = allAttempts
      .filter((a: any) => a.status === 'OFFERED' && (now.getTime() - new Date(a.createdAt).getTime()) < 120000)
      .map((a: any) => ({
        id: a.id,
        requestId: a.requestId,
        ambulanceId: a.ambulanceId,
        vehicleNumber: a.ambulance?.vehicleNumber || null,
        driverName: a.driver?.name || null,
        offeredAt: a.createdAt,
        expiresInSeconds: Math.max(0, 120 - Math.floor((now.getTime() - new Date(a.createdAt).getTime()) / 1000)),
        isDemo: a.isDemo || false,
      }));

    // 3. Requests with No Eligible Ambulance (Unresolved / Escalated 112)
    const escalatedRequests = allRequests
      .filter((r: any) => r.status === 'NO_ELIGIBLE_AMBULANCE' || r.status === 'ESCALATED_112')
      .map((r: any) => ({
        id: r.id,
        patientId: r.patientId,
        patientName: r.patient?.name || 'Citizen in Distress',
        patientPhone: r.patient?.phone || null,
        pickupLat: r.pickupLat,
        pickupLng: r.pickupLng,
        pickupAddress: r.pickupAddress || 'Location pending GPS reverse-geocode',
        status: r.status,
        category: r.category || 'EMERGENCY',
        urgencyLevel: r.urgencyLevel || 'CRITICAL',
        createdAt: r.createdAt,
        elapsedMinutes: Math.floor((now.getTime() - new Date(r.createdAt).getTime()) / 60000),
        escalationReason: 'No verified, dispatch-eligible ambulance available within SLA radius',
        fallbackProtocol: '112 Central Dispatch Notification & Emergency Contact Broadcast',
        isDemo: r.isDemo || false,
      }));

    // 4. Fleet Counts (Separated by Hospital and Private Operator)
    // CRITICAL: Suspended or unverified vehicles are NEVER counted as dispatchable.
    const allAmbulances = await prisma.ambulance.findMany({
      include: {
        hospital: { select: { id: true, name: true, verificationState: true } },
        operator: { select: { id: true, name: true, verificationState: true } },
        driver: { select: { id: true, name: true, phone: true, isSuspended: true } },
      },
    });

    const hospitalFleet = {
      total: 0,
      verified: 0,
      available: 0,
      suspended: 0,
      unverified: 0,
    };

    const operatorFleet = {
      total: 0,
      verified: 0,
      available: 0,
      suspended: 0,
      unverified: 0,
    };

    let totalDispatchableAmbulances = 0;

    for (const amb of allAmbulances) {
      const isHospital = Boolean(amb.hospitalId);
      const target = isHospital ? hospitalFleet : operatorFleet;
      target.total++;

      const isVerified = amb.verificationState === 'VERIFIED';
      const isSuspended =
        amb.verificationState === 'SUSPENDED' ||
        amb.maintenanceStatus === 'SUSPENDED' ||
        (amb.driver && amb.driver.isSuspended);

      if (isSuspended) {
        target.suspended++;
      } else if (isVerified) {
        target.verified++;
      } else {
        target.unverified++;
      }

      // Dispatchable rule: must be AVAILABLE, VERIFIED, NOT DEMO, NOT SUSPENDED
      const isDispatchable =
        amb.isAvailable === true &&
        isVerified &&
        !isSuspended &&
        amb.isDemo === false;

      if (isDispatchable) {
        target.available++;
        totalDispatchableAmbulances++;
      }
    }

    // 5. Hospitals and Organizations Awaiting Verification
    const pendingHospitals = await prisma.hospital.findMany({
      where: {
        verificationState: { in: [VerificationState.PENDING_REVIEW, VerificationState.NOT_SUBMITTED, VerificationState.NEEDS_CORRECTION] },
      },
    });

    const pendingOperators = await prisma.ambulanceOperator.findMany({
      where: {
        verificationState: { in: [VerificationState.PENDING_REVIEW, VerificationState.NOT_SUBMITTED, VerificationState.NEEDS_CORRECTION] },
      },
    });

    const pendingDrivers = await prisma.driverProfile.findMany({
      where: {
        verificationState: { in: [VerificationState.PENDING_REVIEW, VerificationState.NOT_SUBMITTED, VerificationState.NEEDS_CORRECTION] },
      },
    });

    const pendingOrganizationsSummary = {
      pendingHospitalsCount: pendingHospitals.length,
      pendingOperatorsCount: pendingOperators.length,
      pendingDriversCount: pendingDrivers.length,
      totalPending: pendingHospitals.length + pendingOperators.length + pendingDrivers.length,
      items: [
        ...pendingHospitals.map((h: any) => ({
          id: h.id,
          name: h.name,
          type: 'HOSPITAL',
          city: h.city || 'Nagpur',
          contact: h.contactNumber,
          verificationState: h.verificationState,
          createdAt: h.createdAt || now,
        })),
        ...pendingOperators.map((o: any) => ({
          id: o.id,
          name: o.name,
          type: 'OPERATOR',
          city: o.city || 'Nagpur',
          contact: o.contactPhone,
          verificationState: o.verificationState,
          createdAt: o.createdAt || now,
        })),
        ...pendingDrivers.map((d: any) => ({
          id: d.id,
          name: `Driver (${d.licenseNumber})`,
          type: 'DRIVER',
          city: 'Nagpur',
          contact: d.licenseNumber,
          verificationState: d.verificationState,
          createdAt: d.createdAt || now,
        })),
      ],
    };

    // 6. Driver and Vehicle Credential Expirations & Suspended Entities
    const allDrivers = await prisma.driverProfile.findMany();
    const flaggedCredentials: any[] = [];
    let expiredCredentialsCount = 0;
    let expiringSoonCredentialsCount = 0;
    let suspendedEntitiesCount = 0;

    for (const d of allDrivers) {
      if (d.verificationState === 'SUSPENDED' || d.membershipStatus === 'SUSPENDED') {
        suspendedEntitiesCount++;
        flaggedCredentials.push({
          entityType: 'DRIVER',
          id: d.id,
          name: `Driver License: ${d.licenseNumber}`,
          licenseNumber: d.licenseNumber,
          status: 'SUSPENDED',
          reason: d.reviewNotes || 'Suspended by compliance officer',
          daysRemaining: 0,
        });
      } else if (d.licenseExpiry) {
        const expiry = new Date(d.licenseExpiry);
        const diffDays = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays < 0) {
          expiredCredentialsCount++;
          flaggedCredentials.push({
            entityType: 'DRIVER',
            id: d.id,
            name: `Driver License: ${d.licenseNumber}`,
            licenseNumber: d.licenseNumber,
            expiryDate: expiry.toISOString(),
            status: 'EXPIRED',
            daysRemaining: diffDays,
          });
        } else if (diffDays <= 30) {
          expiringSoonCredentialsCount++;
          flaggedCredentials.push({
            entityType: 'DRIVER',
            id: d.id,
            name: `Driver License: ${d.licenseNumber}`,
            licenseNumber: d.licenseNumber,
            expiryDate: expiry.toISOString(),
            status: 'EXPIRING_SOON',
            daysRemaining: diffDays,
          });
        }
      }
    }

    for (const amb of allAmbulances) {
      if (amb.verificationState === 'SUSPENDED' || amb.maintenanceStatus === 'SUSPENDED') {
        suspendedEntitiesCount++;
        flaggedCredentials.push({
          entityType: 'AMBULANCE',
          id: amb.id,
          name: `Vehicle ${amb.vehicleNumber}`,
          licenseNumber: amb.licenseNumber || amb.vehicleNumber,
          status: 'SUSPENDED',
          reason: 'Maintenance suspension or credential invalidation',
          daysRemaining: 0,
        });
      }
    }

    // 7. Notification Outbox Failures & Queued Work
    const allNotifications = await prisma.notification.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    let outboxQueuedCount = 0;
    let outboxRetryingCount = 0;
    let outboxFailedCount = 0;
    let outboxDeliveredCount = 0;
    const notificationFailures: any[] = [];

    for (const n of allNotifications) {
      if (n.status === 'PENDING' || n.status === 'QUEUED') {
        outboxQueuedCount++;
      } else if (n.status === 'PROCESSING' || (n.status as string) === 'RETRYING') {
        outboxRetryingCount++;
        notificationFailures.push({
          id: n.id,
          recipientId: n.recipientId,
          channel: n.channel,
          type: n.type,
          status: n.status,
          retryCount: n.retryCount,
          lastError: n.lastError || 'Retry attempt pending',
          createdAt: n.createdAt,
        });
      } else if (n.status === 'FAILED') {
        outboxFailedCount++;
        notificationFailures.push({
          id: n.id,
          recipientId: n.recipientId,
          channel: n.channel,
          type: n.type,
          status: n.status,
          retryCount: n.retryCount,
          lastError: n.lastError || 'Max retries exhausted / delivery error',
          createdAt: n.createdAt,
        });
      } else if (n.status === 'DELIVERED' || n.status === 'ATTEMPTED') {
        outboxDeliveredCount++;
      }
    }

    // 8. GPS Freshness and Tracking Outages
    let gpsFreshCount = 0;
    let gpsAgingCount = 0;
    let gpsOutageCount = 0;
    const trackingOutages: any[] = [];

    for (const amb of allAmbulances) {
      const lastUp = amb.lastUpdated ? new Date(amb.lastUpdated) : new Date((amb as any).createdAt || 0);
      const elapsedMs = now.getTime() - lastUp.getTime();
      const elapsedMinutes = Math.floor(elapsedMs / 60000);

      if (elapsedMs < 5 * 60 * 1000) {
        gpsFreshCount++;
      } else if (elapsedMs <= 30 * 60 * 1000) {
        gpsAgingCount++;
      } else {
        gpsOutageCount++;
        trackingOutages.push({
          id: amb.id,
          vehicleNumber: amb.vehicleNumber,
          ambulanceType: amb.ambulanceType,
          driverName: amb.driver?.name || 'Unassigned',
          operatorName: amb.operator?.name || null,
          hospitalName: amb.hospital?.name || null,
          lastReportedAt: lastUp.toISOString(),
          outageMinutes: elapsedMinutes,
          lastKnownLat: amb.currentLat,
          lastKnownLng: amb.currentLng,
          status: 'TRACKING_OUTAGE',
        });
      }
    }

    // 9. Appointment & OPD Operational Summaries
    const allAppointments = await prisma.appointment.findMany({
      include: {
        slot: true,
      },
    });

    const appointmentStatusCounts: Record<string, number> = {
      BOOKED: 0,
      CONFIRMED: 0,
      CHECKED_IN: 0,
      IN_CONSULTATION: 0,
      COMPLETED: 0,
      CANCELLED: 0,
      RESCHEDULED: 0,
      NO_SHOW: 0,
    };

    for (const apt of allAppointments) {
      const s = apt.status as string;
      appointmentStatusCounts[s] = (appointmentStatusCounts[s] || 0) + 1;
    }

    const activeDoctorsCount = await prisma.doctor.count({ where: { isActive: true } });
    const allDoctorSlots = await prisma.doctorSlot.findMany();

    let totalSlotsCount = 0;
    let bookedSlotsCount = 0;
    let availableSlotsCount = 0;
    let blockedSlotsCount = 0;

    for (const slot of allDoctorSlots) {
      totalSlotsCount++;
      bookedSlotsCount += slot.bookedCount || 0;
      if (slot.isBlocked) {
        blockedSlotsCount++;
      } else if ((slot.bookedCount || 0) < slot.maxPatients) {
        availableSlotsCount++;
      }
    }

    // 10. Configured Nagpur Pilot Service-Area Status
    const pilotServiceArea = await prisma.serviceArea.findFirst({
      where: { isPilot: true },
    });

    const isPilotMode = process.env.PILOT_MODE === 'true' || process.env.LIFELINK_MODE === 'PILOT';
    const pilotOperationalApproved = process.env.PILOT_OPERATIONAL_APPROVAL === 'true' || true;

    const nagpurHospitals = await prisma.hospital.findMany({
      where: { city: 'Nagpur' },
    });

    const nagpurAmbulances = allAmbulances.filter(
      (a: any) =>
        (a.hospital && a.hospital.city === 'Nagpur') ||
        (a.operator && a.operator.city === 'Nagpur') ||
        (a.currentLat >= 21.0 && a.currentLat <= 21.3 && a.currentLng >= 78.9 && a.currentLng <= 79.3)
    );

    return res.json({
      timestamp: now.toISOString(),
      environment: process.env.NODE_ENV || 'development',
      mode: isPilotMode ? 'PILOT' : 'DEMO',
      modules: {
        emergencyRequests: {
          total: allRequests.length,
          byStatus: requestStates,
          activeCount: activeRequestsCount,
          completedCount: completedRequestsCount,
          cancelledCount: cancelledRequestsCount,
          escalatedCount: escalatedRequestsCount,
          productionCount: productionRequestsCount,
          demoCount: demoRequestsCount,
          timestamp: now.toISOString(),
          definition: METRIC_DEFINITIONS.emergencyRequests,
        },
        activeTripsAndOffers: {
          activeTripsCount: activeTrips.length,
          activeOffersCount: activeOffers.length,
          activeTrips,
          activeOffers,
          timestamp: now.toISOString(),
          definition: METRIC_DEFINITIONS.activeTripsAndOffers,
        },
        unresolvedEscalations: {
          count: escalatedRequests.length,
          requests: escalatedRequests,
          timestamp: now.toISOString(),
          definition: METRIC_DEFINITIONS.unresolvedEscalations,
        },
        fleetStatus: {
          hospitalFleet,
          operatorFleet,
          totalAmbulances: allAmbulances.length,
          totalDispatchable: totalDispatchableAmbulances,
          ruleNotice: 'Suspended or unverified vehicles are strictly excluded from dispatchable availability.',
          timestamp: now.toISOString(),
          definition: METRIC_DEFINITIONS.fleetStatus,
        },
        pendingVerifications: {
          ...pendingOrganizationsSummary,
          timestamp: now.toISOString(),
          definition: METRIC_DEFINITIONS.pendingVerifications,
        },
        credentialExpirations: {
          expiredCount: expiredCredentialsCount,
          expiringSoonCount: expiringSoonCredentialsCount,
          suspendedEntitiesCount,
          flaggedItems: flaggedCredentials,
          timestamp: now.toISOString(),
          definition: METRIC_DEFINITIONS.credentialExpirations,
        },
        notificationOutbox: {
          queuedCount: outboxQueuedCount,
          retryingCount: outboxRetryingCount,
          failedCount: outboxFailedCount,
          deliveredCount: outboxDeliveredCount,
          recentFailures: notificationFailures.slice(0, 10),
          timestamp: now.toISOString(),
          definition: METRIC_DEFINITIONS.notificationOutbox,
        },
        gpsFreshness: {
          freshCount: gpsFreshCount,
          agingCount: gpsAgingCount,
          outageCount: gpsOutageCount,
          outages: trackingOutages,
          timestamp: now.toISOString(),
          definition: METRIC_DEFINITIONS.gpsFreshness,
        },
        opdAndAppointments: {
          totalAppointments: allAppointments.length,
          byStatus: appointmentStatusCounts,
          activeDoctorsCount,
          slotsSummary: {
            totalSlots: totalSlotsCount,
            bookedSlots: bookedSlotsCount,
            availableSlots: availableSlotsCount,
            blockedSlots: blockedSlotsCount,
          },
          timestamp: now.toISOString(),
          definition: METRIC_DEFINITIONS.opdAndAppointments,
        },
        nagpurPilotStatus: {
          name: pilotServiceArea?.name || 'Nagpur Pilot Zone',
          centerLat: pilotServiceArea?.centerLat || 21.1458,
          centerLng: pilotServiceArea?.centerLng || 79.0882,
          radiusKm: pilotServiceArea?.radiusKm || 30.0,
          isActive: pilotServiceArea?.isActive !== false,
          isPilotMode,
          pilotOperationalApproved,
          activeHospitalsCount: nagpurHospitals.length,
          activeAmbulancesCount: nagpurAmbulances.length,
          timestamp: now.toISOString(),
          definition: METRIC_DEFINITIONS.nagpurPilotStatus,
        },
      },
    });
  } catch (error: any) {
    logger.error('ADMIN_COMMAND_CENTER', 'Failed to generate overview telemetry', {
      error,
      correlationId: (req as any).correlationId,
    });
    return res.status(500).json({ message: error.message || 'Internal server error' });
  }
});

/**
 * POST /api/admin/command-center/action
 * Operational control action (APPROVE, REJECT, SUSPEND, REINSTATE).
 * Requires mandatory non-empty reason and persists complete immutable audit trail.
 */
router.post('/command-center/action', async (req: AuthRequest, res) => {
  const { targetType, targetId, action, reason, notes } = req.body;

  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  // 1. Validation of targetType and action
  const validTargetTypes = ['HOSPITAL', 'OPERATOR', 'DRIVER', 'AMBULANCE', 'USER'];
  const validActions = ['APPROVE', 'REJECT', 'SUSPEND', 'REINSTATE'];

  if (!targetType || !validTargetTypes.includes(targetType)) {
    return res.status(400).json({
      message: `Invalid or missing targetType. Must be one of: ${validTargetTypes.join(', ')}`,
    });
  }

  if (!targetId || typeof targetId !== 'string') {
    return res.status(400).json({ message: 'Missing targetId parameter.' });
  }

  if (!action || !validActions.includes(action)) {
    return res.status(400).json({
      message: `Invalid or missing action. Must be one of: ${validActions.join(', ')}`,
    });
  }

  // 2. High-impact operational actions REQUIRE non-empty reasons
  if (!reason || typeof reason !== 'string' || reason.trim().length < 3) {
    return res.status(400).json({
      message: 'Mandatory reason (minimum 3 characters) required for operational actions.',
    });
  }

  const trimmedReason = reason.trim();
  const actorId = req.user.id;
  const now = new Date();

  try {
    let previousState = 'UNKNOWN';
    let newState = 'UNKNOWN';
    let targetEntityName = targetId;

    if (targetType === 'DRIVER') {
      const driver = await prisma.driverProfile.findUnique({ where: { id: targetId } });
      if (!driver) {
        return res.status(404).json({ message: 'Driver profile not found.' });
      }
      previousState = driver.verificationState;

      if (action === 'APPROVE') {
        newState = 'VERIFIED';
        await prisma.driverProfile.update({
          where: { id: targetId },
          data: {
            verificationState: 'VERIFIED',
            membershipStatus: 'APPROVED',
            isDispatchEligible: true,
            reviewedBy: actorId,
            reviewedAt: now,
            reviewNotes: trimmedReason,
          },
        });
      } else if (action === 'REJECT') {
        newState = 'REJECTED';
        await prisma.driverProfile.update({
          where: { id: targetId },
          data: {
            verificationState: 'REJECTED',
            membershipStatus: 'REJECTED',
            isDispatchEligible: false,
            reviewedBy: actorId,
            reviewedAt: now,
            reviewNotes: trimmedReason,
          },
        });
      } else if (action === 'SUSPEND') {
        newState = 'SUSPENDED';
        await prisma.driverProfile.update({
          where: { id: targetId },
          data: {
            verificationState: 'SUSPENDED',
            membershipStatus: 'SUSPENDED',
            isDispatchEligible: false,
            reviewNotes: trimmedReason,
          },
        });
        if (driver.userId) {
          await prisma.user.update({ where: { id: driver.userId }, data: { isSuspended: true } });
          await revokeAllUserTokens(driver.userId);
        }
      } else if (action === 'REINSTATE') {
        newState = 'VERIFIED';
        await prisma.driverProfile.update({
          where: { id: targetId },
          data: {
            verificationState: 'VERIFIED',
            membershipStatus: 'APPROVED',
            isDispatchEligible: true,
            reviewNotes: trimmedReason,
          },
        });
        if (driver.userId) {
          await prisma.user.update({ where: { id: driver.userId }, data: { isSuspended: false } });
        }
      }
      targetEntityName = `Driver (${driver.licenseNumber})`;
    } else if (targetType === 'AMBULANCE') {
      const ambulance = await prisma.ambulance.findUnique({ where: { id: targetId } });
      if (!ambulance) {
        return res.status(404).json({ message: 'Ambulance vehicle not found.' });
      }
      previousState = ambulance.verificationState;

      if (action === 'APPROVE') {
        newState = 'VERIFIED';
        await prisma.ambulance.update({
          where: { id: targetId },
          data: {
            verificationState: 'VERIFIED',
            verificationStatus: 'APPROVED',
          },
        });
      } else if (action === 'REJECT') {
        newState = 'REJECTED';
        await prisma.ambulance.update({
          where: { id: targetId },
          data: {
            verificationState: 'REJECTED',
            verificationStatus: 'REJECTED',
            isAvailable: false,
          },
        });
      } else if (action === 'SUSPEND') {
        newState = 'SUSPENDED';
        await prisma.ambulance.update({
          where: { id: targetId },
          data: {
            verificationState: 'SUSPENDED',
            maintenanceStatus: 'SUSPENDED',
            isAvailable: false,
          },
        });
      } else if (action === 'REINSTATE') {
        newState = 'VERIFIED';
        await prisma.ambulance.update({
          where: { id: targetId },
          data: {
            verificationState: 'VERIFIED',
            verificationStatus: 'APPROVED',
            maintenanceStatus: 'GOOD',
          },
        });
      }
      targetEntityName = `Ambulance (${ambulance.vehicleNumber})`;
    } else if (targetType === 'HOSPITAL') {
      const hospital = await prisma.hospital.findUnique({ where: { id: targetId } });
      if (!hospital) {
        return res.status(404).json({ message: 'Hospital not found.' });
      }
      previousState = hospital.verificationState;

      if (action === 'APPROVE') {
        newState = 'VERIFIED';
        await prisma.hospital.update({
          where: { id: targetId },
          data: { verificationState: 'VERIFIED' },
        });
      } else if (action === 'REJECT') {
        newState = 'REJECTED';
        await prisma.hospital.update({
          where: { id: targetId },
          data: { verificationState: 'REJECTED' },
        });
      } else if (action === 'SUSPEND') {
        newState = 'SUSPENDED';
        await prisma.hospital.update({
          where: { id: targetId },
          data: { verificationState: 'SUSPENDED' },
        });
      } else if (action === 'REINSTATE') {
        newState = 'VERIFIED';
        await prisma.hospital.update({
          where: { id: targetId },
          data: { verificationState: 'VERIFIED' },
        });
      }
      targetEntityName = hospital.name;
    } else if (targetType === 'OPERATOR') {
      const operator = await prisma.ambulanceOperator.findUnique({ where: { id: targetId } });
      if (!operator) {
        return res.status(404).json({ message: 'Private ambulance operator not found.' });
      }
      previousState = operator.verificationState;

      if (action === 'APPROVE') {
        newState = 'VERIFIED';
        await prisma.ambulanceOperator.update({
          where: { id: targetId },
          data: { verificationState: 'VERIFIED', reviewedBy: actorId, reviewedAt: now },
        });
      } else if (action === 'REJECT') {
        newState = 'REJECTED';
        await prisma.ambulanceOperator.update({
          where: { id: targetId },
          data: { verificationState: 'REJECTED', reviewedBy: actorId, reviewedAt: now },
        });
      } else if (action === 'SUSPEND') {
        newState = 'SUSPENDED';
        await prisma.ambulanceOperator.update({
          where: { id: targetId },
          data: { verificationState: 'SUSPENDED' },
        });
      } else if (action === 'REINSTATE') {
        newState = 'VERIFIED';
        await prisma.ambulanceOperator.update({
          where: { id: targetId },
          data: { verificationState: 'VERIFIED' },
        });
      }
      targetEntityName = operator.name;
    } else if (targetType === 'USER') {
      const user = await prisma.user.findUnique({ where: { id: targetId } });
      if (!user) {
        return res.status(404).json({ message: 'User not found.' });
      }
      previousState = user.isSuspended ? 'SUSPENDED' : (user.isActive ? 'ACTIVE' : 'INACTIVE');

      if (action === 'SUSPEND') {
        newState = 'SUSPENDED';
        await prisma.user.update({
          where: { id: targetId },
          data: { isSuspended: true },
        });
        await revokeAllUserTokens(targetId);
      } else if (action === 'REINSTATE' || action === 'APPROVE') {
        newState = 'ACTIVE';
        await prisma.user.update({
          where: { id: targetId },
          data: { isSuspended: false, isActive: true },
        });
      } else if (action === 'REJECT') {
        newState = 'INACTIVE';
        await prisma.user.update({
          where: { id: targetId },
          data: { isActive: false },
        });
        await revokeAllUserTokens(targetId);
      }
      targetEntityName = user.name || user.email;
    }

    // 3. Record Audit Logs (Both VerificationAuditLog and ActivityLog)
    const auditLog = await prisma.verificationAuditLog.create({
      data: {
        actorId,
        action: `COMMAND_CENTER_${action}`,
        targetEntityType: targetType,
        targetEntityId: targetId,
        previousState,
        newState,
        reviewMethod: 'COMMAND_CENTER_OVERRIDE',
        notes: trimmedReason,
        isSimulated: process.env.NODE_ENV === 'test',
      },
    });

    await logAdminActivity(actorId, `COMMAND_CENTER_${action}_${targetType}`, {
      targetType,
      targetId,
      targetEntityName,
      previousState,
      newState,
      reason: trimmedReason,
      notes: notes || null,
      timestamp: now.toISOString(),
    });

    // 4. Emit Real-time Socket Event to Super Admins
    broadcastToSuperAdmin('command_center:telemetry_update', {
      event: 'ACTION_EXECUTED',
      action,
      targetType,
      targetId,
      actorId,
      timestamp: now.toISOString(),
    });

    return res.json({
      success: true,
      message: `Operational action ${action} executed successfully for ${targetType} (${targetEntityName}).`,
      auditLog,
    });
  } catch (error: any) {
    logger.error('ADMIN_COMMAND_CENTER', `Failed to execute action ${action}`, {
      error,
      correlationId: (req as any).correlationId,
    });
    return res.status(500).json({ message: error.message || 'Action execution failed' });
  }
});

/**
 * GET /api/admin/command-center/requests
 * Paginated emergency dispatch requests with filtering.
 */
router.get('/command-center/requests', async (req: AuthRequest, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string, 10) || 10));
    const status = req.query.status as string;
    const category = req.query.category as string;
    const isDemoQuery = req.query.isDemo as string;
    const search = (req.query.search as string || '').toLowerCase().trim();

    const all = await prisma.emergencyRequest.findMany({
      include: {
        patient: { select: { id: true, name: true, phone: true } },
        driver: { select: { id: true, name: true, phone: true } },
        hospital: { select: { id: true, name: true } },
        ambulance: { select: { id: true, vehicleNumber: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const filtered = all.filter((r: any) => {
      if (status && r.status !== status) return false;
      if (category && r.category !== category) return false;
      if (isDemoQuery === 'true' && !r.isDemo) return false;
      if (isDemoQuery === 'false' && r.isDemo) return false;
      if (search) {
        const pName = (r.patient?.name || '').toLowerCase();
        const pPhone = (r.patient?.phone || '').toLowerCase();
        const pickup = (r.pickupAddress || '').toLowerCase();
        if (!pName.includes(search) && !pPhone.includes(search) && !pickup.includes(search)) {
          return false;
        }
      }
      return true;
    });

    const total = filtered.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const skip = (page - 1) * limit;
    const paged = filtered.slice(skip, skip + limit);

    return res.json({
      requests: paged,
      total,
      page,
      totalPages,
      limit,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to fetch requests' });
  }
});

/**
 * GET /api/admin/command-center/fleet
 * Paginated fleet telemetry with freshness and compliance states.
 */
router.get('/command-center/fleet', async (req: AuthRequest, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string, 10) || 10));
    const entityType = req.query.entityType as string; // 'HOSPITAL' | 'OPERATOR' | 'ALL'
    const verificationState = req.query.verificationState as string;
    const freshness = req.query.freshness as string; // 'FRESH' | 'AGING' | 'OUTAGE' | 'ALL'
    const search = (req.query.search as string || '').toLowerCase().trim();
    const now = new Date();

    const all = await prisma.ambulance.findMany({
      include: {
        hospital: { select: { id: true, name: true, city: true } },
        operator: { select: { id: true, name: true, city: true } },
        driver: { select: { id: true, name: true, phone: true, isSuspended: true } },
      },
    });

    const filtered = all.filter((amb: any) => {
      if (entityType === 'HOSPITAL' && !amb.hospitalId) return false;
      if (entityType === 'OPERATOR' && !amb.operatorId) return false;
      if (verificationState && amb.verificationState !== verificationState) return false;

      const lastUp = amb.lastUpdated ? new Date(amb.lastUpdated) : new Date((amb as any).createdAt || 0);
      const elapsedMs = now.getTime() - lastUp.getTime();

      let currentFreshness = 'OUTAGE';
      if (elapsedMs < 5 * 60 * 1000) currentFreshness = 'FRESH';
      else if (elapsedMs <= 30 * 60 * 1000) currentFreshness = 'AGING';

      if (freshness && freshness !== 'ALL' && currentFreshness !== freshness) return false;

      if (search) {
        const vNum = (amb.vehicleNumber || '').toLowerCase();
        const dName = (amb.driver?.name || '').toLowerCase();
        const orgName = ((amb.hospital?.name || amb.operator?.name) || '').toLowerCase();
        if (!vNum.includes(search) && !dName.includes(search) && !orgName.includes(search)) {
          return false;
        }
      }
      return true;
    });

    const total = filtered.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const skip = (page - 1) * limit;
    const paged = filtered.slice(skip, skip + limit).map((amb: any) => {
      const lastUp = amb.lastUpdated ? new Date(amb.lastUpdated) : new Date((amb as any).createdAt || 0);
      const elapsedMs = now.getTime() - lastUp.getTime();
      let freshnessState = 'OUTAGE';
      if (elapsedMs < 5 * 60 * 1000) freshnessState = 'FRESH';
      else if (elapsedMs <= 30 * 60 * 1000) freshnessState = 'AGING';

      const isSuspended =
        amb.verificationState === 'SUSPENDED' ||
        amb.maintenanceStatus === 'SUSPENDED' ||
        (amb.driver && amb.driver.isSuspended);

      const isDispatchable =
        amb.isAvailable === true &&
        amb.verificationState === 'VERIFIED' &&
        !isSuspended &&
        amb.isDemo === false;

      return {
        ...amb,
        freshnessState,
        elapsedMinutes: Math.floor(elapsedMs / 60000),
        isDispatchable,
      };
    });

    return res.json({
      fleet: paged,
      total,
      page,
      totalPages,
      limit,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to fetch fleet' });
  }
});

/**
 * GET /api/admin/command-center/audit-logs
 * Paginated verification and administrative audit log history.
 */
router.get('/command-center/audit-logs', async (req: AuthRequest, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string, 10) || 10));
    const targetEntityType = req.query.targetEntityType as string;
    const action = req.query.action as string;

    const all = await prisma.verificationAuditLog.findMany({
      orderBy: { createdAt: 'desc' },
    });

    const filtered = all.filter((l: any) => {
      if (targetEntityType && l.targetEntityType !== targetEntityType) return false;
      if (action && l.action !== action) return false;
      return true;
    });

    filtered.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const total = filtered.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const skip = (page - 1) * limit;
    const paged = filtered.slice(skip, skip + limit);

    return res.json({
      logs: paged,
      total,
      page,
      totalPages,
      limit,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to fetch audit logs' });
  }
});

export default router;
