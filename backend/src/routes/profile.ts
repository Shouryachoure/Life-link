import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, AuthRequest } from '../middleware/auth';
import prisma from '../db';

const router = Router();

// Get profile (returns detailed info depending on role)
router.get('/', authenticate, async (req: AuthRequest, res) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthorized' });

  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: {
        patientProfile: true,
        ambulance: true,
        hospital: true,
      },
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const { passwordHash, ...safeUser } = user;
    return res.json(safeUser);
  } catch (error) {
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// Update profile (branches dynamically by Role)
router.put('/', authenticate, async (req: AuthRequest, res) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthorized' });

  try {
    if (req.user.role === Role.DRIVER) {
      const { licenseNumber, licenseDoc, registrationDoc, phone, name } = req.body;

      const result = await prisma.$transaction(async (tx) => {
        // Update user core columns if provided
        const updatedUser = await tx.user.update({
          where: { id: req.user!.id },
          data: {
            name: name || undefined,
            phone: phone || undefined,
          },
        });

        // Check if ambulance exists
        const existingAmb = await tx.ambulance.findUnique({
          where: { driverId: req.user!.id },
        });

        let updatedAmb = null;
        if (existingAmb) {
          // Determine if we should reset verification to PENDING
          const isDocChanged = 
            (licenseDoc !== undefined && licenseDoc !== existingAmb.licenseDoc) ||
            (registrationDoc !== undefined && registrationDoc !== existingAmb.registrationDoc) ||
            (licenseNumber !== undefined && licenseNumber !== existingAmb.licenseNumber);

          updatedAmb = await tx.ambulance.update({
            where: { driverId: req.user!.id },
            data: {
              licenseNumber: licenseNumber !== undefined ? licenseNumber : undefined,
              licenseDoc: licenseDoc !== undefined ? licenseDoc : undefined,
              registrationDoc: registrationDoc !== undefined ? registrationDoc : undefined,
              verificationStatus: isDocChanged ? 'PENDING' : undefined,
            },
          });
        }

        return { user: updatedUser, ambulance: updatedAmb };
      });

      return res.json(result);
    } else {
      // Patient profile update
      const {
        bloodGroup,
        allergies,
        medicalConditions,
        currentMedications,
        organDonorStatus,
        preferredHospital,
        emergencyContactName,
        emergencyContactPhone,
        medicalNotes,
        name,
        phone,
      } = req.body;

      const result = await prisma.$transaction(async (tx) => {
        const updatedUser = await tx.user.update({
          where: { id: req.user!.id },
          data: {
            name: name || undefined,
            phone: phone || undefined,
          },
        });

        const updatedProfile = await tx.patientProfile.upsert({
          where: { userId: req.user!.id },
          update: {
            bloodGroup: bloodGroup !== undefined ? bloodGroup : undefined,
            allergies: allergies !== undefined ? allergies : undefined,
            medicalConditions: medicalConditions !== undefined ? medicalConditions : undefined,
            currentMedications: currentMedications !== undefined ? currentMedications : undefined,
            organDonorStatus: organDonorStatus !== undefined ? organDonorStatus : undefined,
            preferredHospital: preferredHospital !== undefined ? preferredHospital : undefined,
            emergencyContactName: emergencyContactName !== undefined ? emergencyContactName : undefined,
            emergencyContactPhone: emergencyContactPhone !== undefined ? emergencyContactPhone : undefined,
            medicalNotes: medicalNotes !== undefined ? medicalNotes : undefined,
          },
          create: {
            userId: req.user!.id,
            bloodGroup: bloodGroup || 'UNKNOWN',
            allergies: allergies || '',
            medicalConditions: medicalConditions || '',
            currentMedications: currentMedications || '',
            organDonorStatus: organDonorStatus || 'NOT_SPECIFIED',
            preferredHospital: preferredHospital || '',
            emergencyContactName: emergencyContactName || 'Emergency Contact',
            emergencyContactPhone: emergencyContactPhone || phone || '',
            medicalNotes: medicalNotes || '',
          },
        });

        return { user: updatedUser, patientProfile: updatedProfile };
      });

      return res.json(result);
    }
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Internal server error' });
  }
});

export default router;
