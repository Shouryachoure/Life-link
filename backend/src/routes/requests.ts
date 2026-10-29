import { Router } from 'express';
import { RequestStatus, VerificationState } from '@prisma/client';
import { authenticate, AuthRequest } from '../middleware/auth';
import prisma from '../db';
import { getIO } from '../socket';

const router = Router();

// Get active request for patient, driver, or hospital
router.get('/active', authenticate, async (req: AuthRequest, res) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthorized' });

  const userId = req.user.id;
  const role = req.user.role;

  try {
    let activeRequest = null;

    if (role === 'PATIENT') {
      activeRequest = await prisma.emergencyRequest.findFirst({
        where: {
          patientId: userId,
          status: {
            notIn: [
              RequestStatus.COMPLETED,
              RequestStatus.REJECTED,
              RequestStatus.CANCELLED,
              RequestStatus.EXPIRED,
              RequestStatus.FAILED,
              RequestStatus.NO_ELIGIBLE_AMBULANCE,
            ],
          },
        },
        include: {
          driver: {
            include: {
              ambulance: true,
            },
          },
          hospital: true,
        },
      });
    } else if (role === 'DRIVER') {
      activeRequest = await prisma.emergencyRequest.findFirst({
        where: {
          driverId: userId,
          status: {
            notIn: [
              RequestStatus.COMPLETED,
              RequestStatus.REJECTED,
              RequestStatus.CANCELLED,
              RequestStatus.EXPIRED,
              RequestStatus.FAILED,
              RequestStatus.NO_ELIGIBLE_AMBULANCE,
            ],
          },
        },
        include: {
          patient: {
            include: {
              patientProfile: true,
            },
          },
          hospital: true,
        },
      });
    } else if (role === 'ADMIN_HOSPITAL') {
      // Find the hospital managed by this admin
      const hospital = await prisma.hospital.findUnique({
        where: { adminUserId: userId },
      });

      if (hospital) {
        activeRequest = await prisma.emergencyRequest.findFirst({
          where: {
            hospitalId: hospital.id,
            status: {
              notIn: [
                RequestStatus.COMPLETED,
                RequestStatus.REJECTED,
                RequestStatus.CANCELLED,
                RequestStatus.EXPIRED,
                RequestStatus.FAILED,
                RequestStatus.NO_ELIGIBLE_AMBULANCE,
              ],
            },
          },
          include: {
            patient: {
              include: {
                patientProfile: true,
              },
            },
            driver: {
              include: {
                ambulance: true,
              },
            },
            hospital: true,
          },
        });
      }
    }

    return res.json(activeRequest);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Internal server error' });
  }
});

// Cancel active emergency request by patient
router.post('/cancel', authenticate, async (req: AuthRequest, res) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthorized' });

  const userId = req.user.id;

  try {
    const activeRequest = await prisma.emergencyRequest.findFirst({
      where: {
        patientId: userId,
        status: {
          notIn: [RequestStatus.COMPLETED, RequestStatus.REJECTED],
        },
      },
    });

    if (!activeRequest) {
      return res.status(400).json({ message: 'No active request found to cancel' });
    }

    const updatedRequest = await prisma.$transaction(async (tx) => {
      const req = await tx.emergencyRequest.update({
        where: { id: activeRequest.id },
        data: {
          status: RequestStatus.CANCELLED,
        },
      });

      if (activeRequest.driverId) {
        await tx.ambulance.update({
          where: { driverId: activeRequest.driverId },
          data: { isAvailable: true },
        });
      }

      return req;
    });

    const io = getIO();
    if (io) {
      io.to(`patient:${userId}`).emit('emergency:cancelled', { requestId: activeRequest.id });
      if (activeRequest.driverId) {
        io.to(`driver:${activeRequest.driverId}`).emit('emergency:cancelled', { requestId: activeRequest.id });
      }
      if (activeRequest.hospitalId) {
        io.to(`hospital:${activeRequest.hospitalId}`).emit('emergency:cancelled', { requestId: activeRequest.id });
      }
      io.to('super_admin_room').emit('telemetry:update');
    }

    res.json({ message: 'Emergency request cancelled successfully', request: updatedRequest });
  } catch (err: any) {
    res.status(500).json({ message: err.message || 'Failed to cancel request' });
  }
});

// Get user history (completed requests)
router.get('/history', authenticate, async (req: AuthRequest, res) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthorized' });

  const userId = req.user.id;
  const role = req.user.role;

  try {
    let requests: any[] = [];

    if (role === 'PATIENT') {
      requests = await prisma.emergencyRequest.findMany({
        where: {
          patientId: userId,
          status: RequestStatus.COMPLETED,
        },
        include: {
          driver: true,
          hospital: true,
        },
        orderBy: { createdAt: 'desc' },
      });
    } else if (role === 'DRIVER') {
      requests = await prisma.emergencyRequest.findMany({
        where: {
          driverId: userId,
          status: RequestStatus.COMPLETED,
        },
        include: {
          patient: true,
          hospital: true,
        },
        orderBy: { createdAt: 'desc' },
      });
    } else if (role === 'ADMIN_HOSPITAL') {
      const hospital = await prisma.hospital.findUnique({
        where: { adminUserId: userId },
      });
      if (hospital) {
        requests = await prisma.emergencyRequest.findMany({
          where: {
            hospitalId: hospital.id,
            status: RequestStatus.COMPLETED,
          },
          include: {
            patient: true,
            driver: true,
          },
          orderBy: { createdAt: 'desc' },
        });
      }
    }

    return res.json(requests);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Internal server error' });
  }
});

// POST: Analyze symptoms and recommend specialist + hospital + ambulance tier (Health-Q style)
router.post('/symptom-triage', authenticate, async (req: AuthRequest, res) => {
  const { symptoms, lat, lng } = req.body;

  if (!symptoms || lat === undefined || lng === undefined) {
    return res.status(400).json({ message: 'Symptoms, lat, and lng are required parameters.' });
  }

  try {
    const text = symptoms.toLowerCase();
    let specialty = 'General Medicine';
    let recommendedTier = 'BASIC_LIFE_SUPPORT';
    let analysis = 'Symptoms suggest general illness. BASIC LIFE SUPPORT vehicle is sufficient.';

    // Rule-based symptom analyzer (Health-Q matching logic)
    if (
      text.includes('chest') ||
      text.includes('heart') ||
      text.includes('cardiac') ||
      text.includes('radiat') ||
      text.includes('palpitation') ||
      text.includes('breath')
    ) {
      specialty = 'Cardiology';
      recommendedTier = 'ADVANCED_LIFE_SUPPORT';
      analysis = 'Symptoms match acute cardiovascular patterns. ADVANCED LIFE SUPPORT vehicle is strongly recommended.';
    } else if (
      text.includes('stroke') ||
      text.includes('seizure') ||
      text.includes('headache') ||
      text.includes('numb') ||
      text.includes('vision') ||
      text.includes('speech') ||
      text.includes('paraly')
    ) {
      specialty = 'Neurology';
      recommendedTier = 'ADVANCED_LIFE_SUPPORT';
      analysis = 'Symptoms correlate with neurological events. ADVANCED LIFE SUPPORT vehicle is recommended.';
    } else if (
      text.includes('fracture') ||
      text.includes('bone') ||
      text.includes('fall') ||
      text.includes('sprain') ||
      text.includes('joint') ||
      text.includes('broken') ||
      text.includes('dislocat')
    ) {
      specialty = 'Orthopedics';
      recommendedTier = 'BASIC_LIFE_SUPPORT';
      analysis = 'Symptoms indicate musculoskeletal trauma. BASIC LIFE SUPPORT vehicle with splints is recommended.';
    }

    // Retrieve verified hospitals with doctors from DB
    const allHospitals = await prisma.hospital.findMany({
      where: {
        verificationState: { notIn: [VerificationState.SUSPENDED, VerificationState.REJECTED] },
      },
      include: {
        doctors: {
          where: { isActive: true },
          select: { specialization: true },
        },
      },
    });

    // Map each hospital to include distance & verified specialties list
    const scoredHospitals = allHospitals
      .filter((h) => h.lat != null && h.lng != null && !isNaN(h.lat) && !isNaN(h.lng))
      .map((h) => {
        // Haversine distance calculator
        const R = 6371; // Earth radius in km
        const dLat = ((h.lat - lat) * Math.PI) / 180;
        const dLon = ((h.lng - lng) * Math.PI) / 180;
        const a =
          Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos((lat * Math.PI) / 180) * Math.cos((h.lat * Math.PI) / 180) *
          Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distanceKm = R * c;

        // Verified doctor specializations from DB
        const docSpecialties = Array.from(new Set(h.doctors.map((d: any) => d.specialization)));
        const specialties: string[] = docSpecialties.length > 0
          ? docSpecialties
          : ['General Medicine', 'Emergency & Trauma'];

        const supportsSpecialty = specialties.some((s: string) => s.toLowerCase().includes(specialty.toLowerCase()));

        return {
          id: h.id,
          name: h.name,
          lat: h.lat,
          lng: h.lng,
          availableBeds: h.availableBeds,
          address: h.address,
          distanceKm: parseFloat(distanceKm.toFixed(2)),
          specialties,
          supportsSpecialty,
        };
      })
      // Filter only hospitals with available beds
      .filter((h) => h.availableBeds > 0)
      // Sort: prioritize those supporting the specialty, then sort by distance
      .sort((a, b) => {
        if (a.supportsSpecialty && !b.supportsSpecialty) return -1;
        if (!a.supportsSpecialty && b.supportsSpecialty) return 1;
        return a.distanceKm - b.distanceKm;
      });

    return res.json({
      specialty,
      recommendedTier,
      analysis,
      hospitals: scoredHospitals,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Internal server error' });
  }
});

export default router;
