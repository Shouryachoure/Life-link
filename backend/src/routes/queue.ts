import { Router } from 'express';
import { QueueStatus, QueuePriority } from '@prisma/client';
import { authenticate, AuthRequest } from '../middleware/auth';
import prisma from '../db';

const router = Router();

// GET: Fetch queue entries for a hospital or patient
router.get('/', authenticate, async (req: AuthRequest, res) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthorized' });

  const userId = req.user.id;
  const role = req.user.role;

  try {
    let entries: any[] = [];
    if (role === 'ADMIN_HOSPITAL') {
      const hospital = await prisma.hospital.findUnique({
        where: { adminUserId: userId },
      });
      if (hospital) {
        entries = await prisma.queueEntry.findMany({
          where: { hospitalId: hospital.id },
          include: { patient: true },
          orderBy: { queuePosition: 'asc' },
        });
      }
    } else if (role === 'PATIENT') {
      entries = await prisma.queueEntry.findMany({
        where: { patientId: userId },
        include: { hospital: true },
        orderBy: { joinedAt: 'desc' },
      });
    }

    return res.json(entries);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Internal server error' });
  }
});

// POST: Patient joins a hospital specialist wait queue
router.post('/join', authenticate, async (req: AuthRequest, res) => {
  if (!req.user || req.user.role !== 'PATIENT') {
    return res.status(403).json({ message: 'Only patients can join clinical wait queues.' });
  }

  const { hospitalId, specialty, priority } = req.body;
  if (!hospitalId || !specialty) {
    return res.status(400).json({ message: 'hospitalId and specialty are required.' });
  }

  try {
    // 1. Prevent duplicate active queue registrations for the same patient/hospital/specialty
    const existingEntry = await prisma.queueEntry.findFirst({
      where: {
        hospitalId,
        patientId: req.user.id,
        specialty,
        status: QueueStatus.WAITING,
      },
      include: {
        hospital: { select: { id: true, name: true, isDemo: true } },
      },
    });

    if (existingEntry) {
      return res.status(409).json({
        message: `You are already registered in the ${specialty} wait queue at ${existingEntry.hospital?.name || 'this hospital'}. Your active queue position is #${existingEntry.queuePosition}.`,
        code: 'DUPLICATE_QUEUE_REGISTRATION',
        entry: existingEntry,
      });
    }

    // Determine the next queue position for this specialty at the hospital
    const activeEntriesCount = await prisma.queueEntry.count({
      where: {
        hospitalId,
        specialty,
        status: QueueStatus.WAITING,
      },
    });

    const queuePosition = activeEntriesCount + 1;
    const queueToken = `LLQ-${specialty.slice(0, 3).toUpperCase()}-${queuePosition.toString().padStart(3, '0')}-${Date.now().toString(36).slice(-4).toUpperCase()}`;

    const entry = await prisma.queueEntry.create({
      data: {
        hospitalId,
        patientId: req.user.id,
        specialty,
        queuePosition,
        priority: (priority as QueuePriority) || QueuePriority.STANDARD,
      },
      include: {
        hospital: true,
      },
    });

    return res.status(201).json({
      ...entry,
      queueToken,
      registeredAt: new Date().toISOString(),
      isDemonstrationQueue: entry.hospital?.isDemo ?? false,
      disclaimer: entry.hospital?.isDemo
        ? 'DEMONSTRATION QUEUE: This is a simulated OPD wait queue. Real clinical consultation requires verified on-site check-in.'
        : 'OPD TRIAGE QUEUE: Please present your queue token at the hospital registration desk upon arrival.',
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Internal server error' });
  }
});

// POST: Hospital Admin registers a walk-in patient by email to their waitlist
router.post('/walkin', authenticate, async (req: AuthRequest, res) => {
  if (!req.user || req.user.role !== 'ADMIN_HOSPITAL') {
    return res.status(403).json({ message: 'Only hospital admins can register walk-in patients.' });
  }

  const { patientEmail, specialty, priority } = req.body;
  if (!patientEmail || !specialty) {
    return res.status(400).json({ message: 'patientEmail and specialty are required.' });
  }

  try {
    const adminUserId = req.user.id;
    // Find the hospital managed by this admin
    const hospital = await prisma.hospital.findUnique({
      where: { adminUserId },
    });

    if (!hospital) {
      return res.status(404).json({ message: 'Managed hospital details not found.' });
    }

    // Find patient by email
    const patientUser = await prisma.user.findUnique({
      where: { email: patientEmail },
    });

    if (!patientUser) {
      return res.status(404).json({ message: 'Patient account with this email not found.' });
    }

    // Check if patient is already in wait queue at this hospital
    const existing = await prisma.queueEntry.findFirst({
      where: {
        hospitalId: hospital.id,
        patientId: patientUser.id,
        status: QueueStatus.WAITING,
      },
    });

    if (existing) {
      return res.status(400).json({ message: 'Patient is already in the wait list.' });
    }

    const activeEntriesCount = await prisma.queueEntry.count({
      where: {
        hospitalId: hospital.id,
        specialty,
        status: QueueStatus.WAITING,
      },
    });

    const queuePosition = activeEntriesCount + 1;

    const entry = await prisma.queueEntry.create({
      data: {
        hospitalId: hospital.id,
        patientId: patientUser.id,
        specialty,
        queuePosition,
        priority: (priority as QueuePriority) || QueuePriority.STANDARD,
      },
      include: {
        patient: true,
      },
    });

    return res.status(201).json(entry);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Internal server error' });
  }
});

// PUT: Modify queue entry (for Hospital Admins to update status/priority/reorder)
router.put('/:id', authenticate, async (req: AuthRequest, res) => {
  if (!req.user || req.user.role !== 'ADMIN_HOSPITAL') {
    return res.status(403).json({ message: 'Only hospital admins can modify queue parameters.' });
  }

  const { id } = req.params;
  const { status, priority, queuePosition } = req.body;

  try {
    // Verify this queue entry belongs to the admin's hospital
    const entry = await prisma.queueEntry.findUnique({
      where: { id },
      include: { hospital: true },
    });

    if (!entry) {
      return res.status(404).json({ message: 'Queue entry not found.' });
    }

    const hospital = await prisma.hospital.findUnique({
      where: { adminUserId: req.user.id },
    });

    if (!hospital || entry.hospitalId !== hospital.id) {
      return res.status(403).json({ message: 'You are not authorized to modify this hospital queue.' });
    }

    const updatedEntry = await prisma.queueEntry.update({
      where: { id },
      data: {
        status: status ? (status as QueueStatus) : undefined,
        priority: priority ? (priority as QueuePriority) : undefined,
        queuePosition: queuePosition !== undefined ? parseInt(queuePosition) : undefined,
      },
      include: {
        patient: true,
      },
    });

    return res.json(updatedEntry);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Internal server error' });
  }
});

// POST: Predict wait-time (AI-driven wait time logic)
router.post('/predict-wait', authenticate, async (req: AuthRequest, res) => {
  const { queuePosition, avgConsultationMinutes = 30, bufferMinutes = 5, emergencyCount = 0 } = req.body;

  if (queuePosition === undefined) {
    return res.status(400).json({ message: 'queuePosition is required.' });
  }

  try {
    const totalBaseMinutes = queuePosition * (avgConsultationMinutes + bufferMinutes);
    const emergencyDelay = emergencyCount * 15;
    const finalWait = totalBaseMinutes + emergencyDelay;

    let text = `Estimated wait is approximately ${finalWait} minutes. The ER team is currently reviewing patient charts.`;
    if (finalWait > 60) {
      text = `Estimated wait is approximately ${Math.round(finalWait / 60 * 10) / 10} hours due to ${emergencyCount > 0 ? `${emergencyCount} active ER dispatches` : 'high patient volume'}. Please alert the triage nurse if symptoms change.`;
    }

    return res.json({
      predictedMinutes: finalWait,
      analysis: text,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Internal server error' });
  }
});

export default router;
