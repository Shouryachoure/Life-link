import { Router } from 'express';
import { Role } from '@prisma/client';
import prisma from '../db';
import { authenticate, AuthRequest } from '../middleware/auth';
import { MEDICAL_SPECIALIZATIONS } from '../constants/specializations';
import { doctorDirectoryPipeline } from '../services/doctorDirectoryPipelineService';

const router = Router();

// Helper to resolve the hospital managed by the logged-in admin
async function getAdminHospital(userId: string, role?: Role) {
  if (role === Role.ADMIN_HOSPITAL) {
    return prisma.hospital.findUnique({
      where: { adminUserId: userId },
    });
  }
  if (role === Role.SUPER_ADMIN) {
    const direct = await prisma.hospital.findUnique({
      where: { adminUserId: userId },
    });
    if (direct) return direct;
    return prisma.hospital.findFirst();
  }
  return null;
}

// -------------------------------------------------------------
// Public & Patient Doctor Endpoints
// -------------------------------------------------------------

// GET /api/doctors - List active doctors, filterable by hospitalId, specialization, and search query
router.get('/', async (req, res) => {
  try {
    const hospitalId = req.query.hospitalId as string | undefined;
    const rawSpecialization = (req.query.specialization || req.query.specialty) as string | undefined;
    const specialization = rawSpecialization ? rawSpecialization.replace(/\s+/g, ' ').trim() : undefined;
    const rawSearch = req.query.search as string | undefined;
    const search = rawSearch ? rawSearch.replace(/\s+/g, ' ').trim().toLowerCase() : undefined;

    const whereClause: any = { isActive: true };
    if (hospitalId) whereClause.hospitalId = hospitalId;

    let doctors = await prisma.doctor.findMany({
      where: whereClause,
      include: {
        hospital: {
          select: {
            id: true,
            name: true,
            address: true,
            contactNumber: true,
            lat: true,
            lng: true,
            website: true,
            sourceUrl: true,
          },
        },
        affiliations: true,
      },
      orderBy: { name: 'asc' },
    });

    // Substring & case-insensitive specialization filtering across primary specialty, designation, and specialtiesList
    if (specialization && specialization !== 'ALL') {
      const specLower = specialization.toLowerCase().trim();
      doctors = doctors.filter((d: any) => {
        const primaryMatch = d.specialization && d.specialization.toLowerCase().includes(specLower);
        const designationMatch = d.designation && d.designation.toLowerCase().includes(specLower);
        const listMatch = Array.isArray(d.specialtiesList) && d.specialtiesList.some((s: string) => s.toLowerCase().includes(specLower));
        return primaryMatch || designationMatch || listMatch;
      });
    }

    if (search) {
      doctors = doctors.filter(
        (d: any) =>
          (d.name && d.name.toLowerCase().includes(search)) ||
          (d.specialization && d.specialization.toLowerCase().includes(search)) ||
          (d.designation && d.designation.toLowerCase().includes(search)) ||
          (d.qualifications && d.qualifications.toLowerCase().includes(search)) ||
          (d.registrationNumber && d.registrationNumber.toLowerCase().includes(search)) ||
          (Array.isArray(d.specialtiesList) && d.specialtiesList.some((s: string) => s.toLowerCase().includes(search)))
      );
    }

    return res.json(doctors);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to fetch doctors' });
  }
});

// GET /api/doctors/specializations - List available specializations
router.get('/specializations', (req, res) => {
  return res.json(MEDICAL_SPECIALIZATIONS);
});

// GET /api/doctors/:id - Get single doctor details
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const doctor = await prisma.doctor.findUnique({
      where: { id },
      include: {
        hospital: {
          select: {
            id: true,
            name: true,
            address: true,
            contactNumber: true,
            lat: true,
            lng: true,
          },
        },
        affiliations: true,
      },
    });

    if (!doctor) {
      return res.status(404).json({ message: 'Doctor not found' });
    }

    return res.json(doctor);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to fetch doctor' });
  }
});

import { isSlotInPastIST, generateTimeSlots } from '../utils/localization';

// GET /api/doctors/:id/slots?date=YYYY-MM-DD
// PATIENT PRIVACY GUARANTEE: Returns ONLY remaining capacity count and availability. NEVER patient identities!
router.get('/:id/slots', async (req, res) => {
  try {
    const { id: doctorId } = req.params;
    const date = req.query.date as string | undefined;

    // Verify doctor exists and is active
    const doctor = await prisma.doctor.findUnique({
      where: { id: doctorId },
      select: {
        id: true,
        name: true,
        specialization: true,
        hospitalId: true,
        isActive: true,
        unavailableDates: true,
        defaultSlotDuration: true,
        bookingEnabled: true,
        verificationStatus: true,
      },
    });

    if (!doctor || !doctor.isActive) {
      return res.status(404).json({ message: 'Doctor not found or currently inactive' });
    }

    // Public directory listing guard: return zero slots and explain unverified availability
    if (doctor.bookingEnabled === false || doctor.verificationStatus === 'PUBLIC_DIRECTORY_LISTED') {
      return res.json({
        doctorId,
        doctorName: doctor.name,
        specialization: doctor.specialization,
        date,
        totalSlots: 0,
        availableSlots: 0,
        doctorOnLeave: false,
        bookingEnabled: false,
        unverified: true,
        verificationStatus: doctor.verificationStatus || 'PUBLIC_DIRECTORY_LISTED',
        slots: [],
        message: 'Online slot booking is not yet verified for this public directory listing. Please contact the hospital directly.',
      });
    }

    const whereClause: any = { doctorId };
    if (date) {
      whereClause.date = date;
    }

    const slots = await prisma.doctorSlot.findMany({
      where: whereClause,
      orderBy: { startTime: 'asc' },
    });

    const isDoctorOnLeaveForDate = (slotDate: string) => {
      const dates = (doctor as any).unavailableDates;
      return Array.isArray(dates) && dates.includes(slotDate);
    };

    // Strip sensitive info: return ONLY slot timing, remaining capacity, and availability
    const sanitizedSlots = slots.map((s: any) => {
      const remainingCapacity = Math.max(0, s.maxPatients - s.bookedCount);
      const isPast = isSlotInPastIST(s.date, s.startTime);
      const isBlocked = Boolean(s.isBlocked);
      const onLeave = isDoctorOnLeaveForDate(s.date);
      const isAvailable = remainingCapacity > 0 && !isBlocked && !isPast && !onLeave;

      return {
        id: s.id,
        doctorId: s.doctorId,
        date: s.date,
        startTime: s.startTime,
        endTime: s.endTime,
        slotDurationMinutes: s.slotDurationMinutes || 15,
        maxPatients: s.maxPatients,
        bookedCount: s.bookedCount,
        remainingCapacity,
        isBlocked,
        blockedReason: s.blockedReason || (onLeave ? 'Doctor is on leave on this date' : null),
        isPast,
        isAvailable,
      };
    });

    return res.json({
      doctorId,
      doctorName: doctor.name,
      specialization: doctor.specialization,
      date,
      doctorOnLeave: date ? isDoctorOnLeaveForDate(date) : false,
      doctorUnavailable: date ? isDoctorOnLeaveForDate(date) : false,
      slots: sanitizedSlots,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to fetch doctor slots' });
  }
});

// -------------------------------------------------------------
// Hospital Admin Management Endpoints
// -------------------------------------------------------------

// POST /api/doctors - Add doctor to admin's hospital
router.post('/', authenticate, async (req: AuthRequest, res) => {
  if (!req.user || (req.user.role !== Role.ADMIN_HOSPITAL && req.user.role !== Role.SUPER_ADMIN)) {
    return res.status(403).json({ message: 'Forbidden: Only hospital administrators can add doctors' });
  }

  try {
    const hospital = await getAdminHospital(req.user.id, req.user.role);
    if (!hospital) {
      return res.status(404).json({ message: 'Admin hospital not found' });
    }

    const { name, specialization, qualifications, experienceYears, consultationFee, defaultSlotDuration } = req.body;

    if (!name || !specialization) {
      return res.status(400).json({ message: 'Name and specialization are required' });
    }

    const doctor = await prisma.doctor.create({
      data: {
        hospitalId: hospital.id,
        name: name.trim(),
        specialization: specialization.trim(),
        qualifications: qualifications ? String(qualifications).trim() : null,
        experienceYears: experienceYears ? parseInt(experienceYears) : 0,
        consultationFee: consultationFee ? parseFloat(consultationFee) : 0,
        defaultSlotDuration: defaultSlotDuration ? parseInt(defaultSlotDuration) : 15,
        isActive: true,
      },
    });

    return res.status(201).json(doctor);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to create doctor' });
  }
});

// PUT /api/doctors/:id - Update doctor details (must belong to admin's hospital)
router.put('/:id', authenticate, async (req: AuthRequest, res) => {
  if (!req.user || (req.user.role !== Role.ADMIN_HOSPITAL && req.user.role !== Role.SUPER_ADMIN)) {
    return res.status(403).json({ message: 'Forbidden: Only hospital administrators can update doctors' });
  }

  try {
    const hospital = await getAdminHospital(req.user.id, req.user.role);
    if (!hospital) {
      return res.status(404).json({ message: 'Admin hospital not found' });
    }

    const { id } = req.params;
    const existing = await prisma.doctor.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ message: 'Doctor not found' });
    }
    if (req.user.role === Role.ADMIN_HOSPITAL && existing.hospitalId !== hospital.id) {
      return res.status(403).json({
        message: 'Forbidden: You cannot modify doctors for an unrelated hospital',
        code: 'UNAUTHORIZED_HOSPITAL_ACCESS',
      });
    }

    const { name, specialization, qualifications, experienceYears, consultationFee, isActive } = req.body;

    const updated = await prisma.doctor.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(specialization !== undefined && { specialization: specialization.trim() }),
        ...(qualifications !== undefined && { qualifications: String(qualifications).trim() }),
        ...(experienceYears !== undefined && { experienceYears: parseInt(experienceYears) }),
        ...(consultationFee !== undefined && { consultationFee: parseFloat(consultationFee) }),
        ...(isActive !== undefined && { isActive: Boolean(isActive) }),
      },
    });

    return res.json(updated);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to update doctor' });
  }
});

// DELETE /api/doctors/:id - Deactivate doctor
router.delete('/:id', authenticate, async (req: AuthRequest, res) => {
  if (!req.user || (req.user.role !== Role.ADMIN_HOSPITAL && req.user.role !== Role.SUPER_ADMIN)) {
    return res.status(403).json({ message: 'Forbidden: Only hospital administrators can manage doctors' });
  }

  try {
    const hospital = await getAdminHospital(req.user.id, req.user.role);
    if (!hospital) {
      return res.status(404).json({ message: 'Admin hospital not found' });
    }

    const { id } = req.params;
    const existing = await prisma.doctor.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ message: 'Doctor not found' });
    }
    if (req.user.role === Role.ADMIN_HOSPITAL && existing.hospitalId !== hospital.id) {
      return res.status(403).json({
        message: 'Forbidden: You cannot modify doctors for an unrelated hospital',
        code: 'UNAUTHORIZED_HOSPITAL_ACCESS',
      });
    }

    // Soft delete / set inactive to protect foreign key integrity for appointments
    const updated = await prisma.doctor.update({
      where: { id },
      data: { isActive: false },
    });

    return res.json({ message: 'Doctor deactivated successfully', doctor: updated });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to deactivate doctor' });
  }
});

// POST /api/doctors/:id/slots - Hospital Admin creates a slot for a doctor
router.post('/:id/slots', authenticate, async (req: AuthRequest, res) => {
  if (!req.user || (req.user.role !== Role.ADMIN_HOSPITAL && req.user.role !== Role.SUPER_ADMIN)) {
    return res.status(403).json({ message: 'Forbidden: Only hospital administrators can create slots' });
  }

  try {
    const hospital = await getAdminHospital(req.user.id, req.user.role);
    if (!hospital) {
      return res.status(404).json({ message: 'Admin hospital not found' });
    }

    const { id: doctorId } = req.params;
    const doctor = await prisma.doctor.findUnique({ where: { id: doctorId } });
    if (!doctor || doctor.hospitalId !== hospital.id) {
      return res.status(404).json({ message: 'Doctor not found in your hospital' });
    }

    const { date, startTime, endTime, maxPatients, slotDurationMinutes, isBlocked, blockedReason } = req.body;

    if (!date || !startTime || !endTime) {
      return res.status(400).json({ message: 'Date (YYYY-MM-DD), startTime (HH:MM), and endTime (HH:MM) are required' });
    }

    // Backend validation: Prevent creating slots in the past
    if (isSlotInPastIST(date, startTime)) {
      return res.status(400).json({ message: 'Cannot create slots for past dates or times', code: 'CANNOT_CREATE_PAST_SLOT' });
    }

    const capacity = maxPatients ? parseInt(maxPatients) : 5;
    if (isNaN(capacity) || capacity <= 0) {
      return res.status(400).json({ message: 'maxPatients must be a positive integer' });
    }

    // Check if slot already exists
    const existingSlot = await prisma.doctorSlot.findUnique({
      where: {
        doctorId_date_startTime: {
          doctorId,
          date,
          startTime,
        },
      },
    });

    if (existingSlot) {
      return res.status(409).json({ message: 'A slot for this doctor at this date and start time already exists' });
    }

    const newSlot = await prisma.doctorSlot.create({
      data: {
        doctorId,
        date,
        startTime,
        endTime,
        slotDurationMinutes: slotDurationMinutes ? parseInt(slotDurationMinutes) : 15,
        maxPatients: capacity,
        bookedCount: 0,
        isBlocked: Boolean(isBlocked),
        blockedReason: isBlocked ? (blockedReason || 'Blocked by hospital') : null,
      },
    });

    return res.status(201).json(newSlot);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to create doctor slot' });
  }
});

// POST /api/doctors/:id/schedule - Hospital Admin generates schedule slots with configurable duration
router.post('/:id/schedule', authenticate, async (req: AuthRequest, res) => {
  if (!req.user || (req.user.role !== Role.ADMIN_HOSPITAL && req.user.role !== Role.SUPER_ADMIN)) {
    return res.status(403).json({ message: 'Forbidden: Only hospital administrators can configure schedules' });
  }

  try {
    const hospital = await getAdminHospital(req.user.id, req.user.role);
    if (!hospital) {
      return res.status(404).json({ message: 'Admin hospital not found' });
    }

    const { id: doctorId } = req.params;
    const doctor = await prisma.doctor.findUnique({ where: { id: doctorId } });
    if (!doctor || doctor.hospitalId !== hospital.id) {
      return res.status(404).json({ message: 'Doctor not found in your hospital' });
    }

    const { date, dates, startDate, endDate, startTime, endTime, slotDurationMinutes = 15, maxPatients = 5 } = req.body;

    let targetDates: string[] = [];
    if (dates && Array.isArray(dates) && dates.length > 0) {
      targetDates = dates;
    } else if (startDate && endDate) {
      const cur = new Date(startDate);
      const end = new Date(endDate);
      while (cur <= end) {
        targetDates.push(cur.toISOString().split('T')[0]);
        cur.setDate(cur.getDate() + 1);
      }
    } else if (date) {
      targetDates = [date];
    }

    if (targetDates.length === 0 || !startTime || !endTime) {
      return res.status(400).json({ message: 'Date(s), startTime (HH:MM), and endTime (HH:MM) are required' });
    }
    const duration = parseInt(slotDurationMinutes) || 15;
    const capacity = parseInt(maxPatients) || 5;

    const generated = generateTimeSlots(startTime, endTime, duration);
    if (generated.length === 0) {
      return res.status(400).json({ message: 'Invalid time range: startTime must precede endTime by at least slotDurationMinutes' });
    }

    const createdSlots: any[] = [];
    for (const d of targetDates) {
      // Check if doctor is on leave
      if (Array.isArray((doctor as any).unavailableDates) && (doctor as any).unavailableDates.includes(d)) {
        continue;
      }

      for (const t of generated) {
        if (isSlotInPastIST(d, t.startTime)) {
          continue;
        }

        const existing = await prisma.doctorSlot.findUnique({
          where: {
            doctorId_date_startTime: {
              doctorId,
              date: d,
              startTime: t.startTime,
            },
          },
        });

        if (!existing) {
          const slot = await prisma.doctorSlot.create({
            data: {
              doctorId,
              date: d,
              startTime: t.startTime,
              endTime: t.endTime,
              slotDurationMinutes: duration,
              maxPatients: capacity,
              bookedCount: 0,
              isBlocked: false,
            },
          });
          createdSlots.push(slot);
        }
      }
    }

    const totalPotential = targetDates.length * generated.length;
    const slotsSkipped = Math.max(0, totalPotential - createdSlots.length);

    return res.status(201).json({
      message: `Successfully generated ${createdSlots.length} schedule slots`,
      createdCount: createdSlots.length,
      slotsCreated: createdSlots.length,
      slotsSkipped,
      slots: createdSlots,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to generate doctor schedule' });
  }
});

// PUT /api/doctors/slots/:slotId/block - Block or unblock a slot
router.put('/slots/:slotId/block', authenticate, async (req: AuthRequest, res) => {
  if (!req.user || (req.user.role !== Role.ADMIN_HOSPITAL && req.user.role !== Role.SUPER_ADMIN)) {
    return res.status(403).json({ message: 'Forbidden: Only hospital administrators can block slots' });
  }

  try {
    const hospital = await getAdminHospital(req.user.id, req.user.role);
    if (!hospital) {
      return res.status(404).json({ message: 'Admin hospital not found' });
    }

    const { slotId } = req.params;
    const { isBlocked = true, blockedReason, reason } = req.body;
    const effectiveReason = reason || blockedReason || 'Unavailable';

    const slot = await prisma.doctorSlot.findUnique({
      where: { id: slotId },
      include: { doctor: true },
    });

    if (!slot || slot.doctor.hospitalId !== hospital.id) {
      return res.status(404).json({ message: 'Slot not found in your hospital' });
    }

    const updated = await prisma.doctorSlot.update({
      where: { id: slotId },
      data: {
        isBlocked: Boolean(isBlocked),
        blockedReason: isBlocked ? String(effectiveReason).trim() : null,
      },
    });

    return res.json({
      message: isBlocked ? 'Slot has been blocked from booking' : 'Slot has been unblocked',
      slot: updated,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to update slot block state' });
  }
});

// PUT /api/doctors/:id/unavailable-dates - Set doctor's unavailable dates / leaves
router.put('/:id/unavailable-dates', authenticate, async (req: AuthRequest, res) => {
  if (!req.user || (req.user.role !== Role.ADMIN_HOSPITAL && req.user.role !== Role.SUPER_ADMIN)) {
    return res.status(403).json({ message: 'Forbidden: Only hospital administrators can set unavailable dates' });
  }

  try {
    const hospital = await getAdminHospital(req.user.id, req.user.role);
    if (!hospital) {
      return res.status(404).json({ message: 'Admin hospital not found' });
    }

    const { id: doctorId } = req.params;
    const { unavailableDates = [] } = req.body;

    const doctor = await prisma.doctor.findUnique({ where: { id: doctorId } });
    if (!doctor || doctor.hospitalId !== hospital.id) {
      return res.status(404).json({ message: 'Doctor not found in your hospital' });
    }

    if (!Array.isArray(unavailableDates)) {
      return res.status(400).json({ message: 'unavailableDates must be an array of date strings (YYYY-MM-DD)' });
    }

    const updated = await prisma.doctor.update({
      where: { id: doctorId },
      data: {
        unavailableDates,
      },
    });

    return res.json({
      message: 'Doctor unavailable dates updated successfully',
      doctor: updated,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to update unavailable dates' });
  }
});

// GET /api/doctors/hospital/slots - Admin daily appointments roster with patient identities
// Renders day's slots table with Capacity | Booked | Remaining and reveals booked patient details
router.get('/hospital/slots', authenticate, async (req: AuthRequest, res) => {
  if (!req.user || (req.user.role !== Role.ADMIN_HOSPITAL && req.user.role !== Role.SUPER_ADMIN)) {
    return res.status(403).json({ message: 'Forbidden: Only hospital administrators can view hospital slots' });
  }

  try {
    const hospital = await getAdminHospital(req.user.id, req.user.role);
    if (!hospital) {
      return res.status(404).json({ message: 'Admin hospital not found' });
    }

    const date = (req.query.date as string) || new Date().toISOString().split('T')[0];
    const doctorId = req.query.doctorId as string | undefined;

    const whereSlot: any = {
      date,
      doctor: { hospitalId: hospital.id },
    };
    if (doctorId) {
      whereSlot.doctorId = doctorId;
    }

    const slots = await prisma.doctorSlot.findMany({
      where: whereSlot,
      include: {
        doctor: {
          select: {
            id: true,
            name: true,
            specialization: true,
          },
        },
        appointments: {
          include: {
            patient: {
              select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                patientProfile: {
                  select: { bloodGroup: true, allergies: true, emergencyContactPhone: true },
                },
              },
            },
          },
          orderBy: { tokenNumber: 'asc' },
        },
      },
      orderBy: [{ startTime: 'asc' }],
    });

    const enriched = slots.map((slot) => ({
      id: slot.id,
      doctorId: slot.doctorId,
      doctorName: slot.doctor.name,
      specialization: slot.doctor.specialization,
      date: slot.date,
      startTime: slot.startTime,
      endTime: slot.endTime,
      capacity: slot.maxPatients,
      booked: slot.bookedCount,
      remaining: Math.max(0, slot.maxPatients - slot.bookedCount),
      patients: slot.appointments.map((apt) => ({
        appointmentId: apt.id,
        tokenNumber: apt.tokenNumber,
        status: apt.status,
        symptoms: apt.symptoms,
        patientId: apt.patient.id,
        patientName: apt.patient.name,
        patientEmail: apt.patient.email,
        patientPhone: apt.patient.phone || apt.patient.patientProfile?.emergencyContactPhone || 'N/A',
        bloodGroup: apt.patient.patientProfile?.bloodGroup || 'N/A',
        allergies: apt.patient.patientProfile?.allergies || 'None',
        bookedAt: apt.createdAt,
      })),
    }));

    return res.json({
      date,
      hospitalId: hospital.id,
      hospitalName: hospital.name,
      slots: enriched,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to fetch hospital slots' });
  }
});

// DELETE /api/doctors/slots/:slotId - Hospital Admin removes a slot
router.delete('/slots/:slotId', authenticate, async (req: AuthRequest, res) => {
  if (!req.user || (req.user.role !== Role.ADMIN_HOSPITAL && req.user.role !== Role.SUPER_ADMIN)) {
    return res.status(403).json({ message: 'Forbidden: Only hospital administrators can delete slots' });
  }

  try {
    const hospital = await getAdminHospital(req.user.id, req.user.role);
    if (!hospital) {
      return res.status(404).json({ message: 'Admin hospital not found' });
    }

    const { slotId } = req.params;
    const slot = await prisma.doctorSlot.findUnique({
      where: { id: slotId },
      include: { doctor: true, appointments: true },
    });

    if (!slot || slot.doctor.hospitalId !== hospital.id) {
      return res.status(404).json({ message: 'Slot not found in your hospital' });
    }

    if (slot.bookedCount > 0) {
      return res.status(400).json({
        message: 'Cannot delete slot with active bookings. Cancel appointments first.',
        bookedCount: slot.bookedCount,
      });
    }

    await prisma.doctorSlot.delete({ where: { id: slotId } });

    return res.json({ message: 'Slot deleted successfully' });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to delete slot' });
  }
});

// -------------------------------------------------------------
// Directory Pipeline & Coverage Endpoints
// -------------------------------------------------------------

// POST /api/doctors/directory/import - Trigger idempotent public doctor directory ingestion
router.post('/directory/import', authenticate, async (req: AuthRequest, res) => {
  if (req.user?.role !== Role.SUPER_ADMIN && req.user?.role !== Role.ADMIN_HOSPITAL) {
    return res.status(403).json({ error: 'FORBIDDEN', message: 'Admin privileges required to trigger directory imports' });
  }

  try {
    const { hospitalId, dryRun: bodyDryRun } = req.body || {};
    const dryRun = Boolean(bodyDryRun || req.query.dryRun === 'true');
    if (hospitalId) {
      const report = await doctorDirectoryPipeline.importDoctorsForHospital(hospitalId, { dryRun });
      return res.json({ success: true, dryRun, totalImported: report.totalSourced, report });
    }
    const reports = await doctorDirectoryPipeline.importAllNagpurDoctors({ dryRun });
    const totalImported = reports.reduce((acc, r) => acc + r.totalSourced, 0);
    return res.json({ success: true, dryRun, totalImported, reports });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message || 'Directory import failed' });
  }
});

// GET /api/doctors/directory/coverage - Get directory ingestion coverage report across Nagpur hospitals
router.get('/directory/coverage', async (_req, res) => {
  try {
    const hospitals = await prisma.hospital.findMany({
      select: { id: true, name: true, website: true, sourceUrl: true },
      orderBy: { name: 'asc' },
    });

    const hospitalMap = new Map<string, any>();
    for (const h of hospitals) {
      hospitalMap.set(h.id, h);
    }

    const registeredAdapters = doctorDirectoryPipeline.getRegisteredAdapters();
    for (const adapter of registeredAdapters) {
      if (!hospitalMap.has(adapter.hospitalId)) {
        hospitalMap.set(adapter.hospitalId, {
          id: adapter.hospitalId,
          name: adapter.hospitalName,
          sourceUrl: adapter.sourceUrl,
        });
      }
    }

    const coverage = [];
    for (const [hospId, h] of hospitalMap.entries()) {
      const doctors = await prisma.doctor.findMany({
        where: { hospitalId: hospId },
      });
      const publicDocs = doctors.filter((d: any) => d.verificationStatus === 'PUBLIC_DIRECTORY_LISTED');
      const partnerDocs = doctors.filter((d: any) => d.verificationStatus !== 'PUBLIC_DIRECTORY_LISTED');
      const hasAdapter = doctorDirectoryPipeline.hasAdapterForHospital(hospId);

      coverage.push({
        hospitalId: hospId,
        hospitalName: h.name,
        doctorCount: doctors.length,
        totalDoctors: doctors.length,
        publicDirectoryDoctors: publicDocs.length,
        verifiedPartnerDoctors: partnerDocs.length,
        hasLiveDirectoryFeed: hasAdapter && hospId === 'fac-max-super-nagpur',
        hasAutomatedAdapter: hasAdapter,
        website: h.website || null,
        sourceUrl: h.sourceUrl || null,
        status: doctors.length > 0 ? (hasAdapter ? 'IMPORT_SUCCESS' : 'COVERED') : (hasAdapter ? 'READY_FOR_IMPORT' : 'MANUAL_VERIFICATION_REQUIRED'),
      });
    }

    const totalDoctorsImported = coverage.reduce((acc, c) => acc + c.totalDoctors, 0);

    return res.json({
      success: true,
      city: 'Nagpur',
      totalHospitals: hospitalMap.size,
      totalHospitalsConfigured: hospitalMap.size,
      totalDoctorsImported,
      coveredHospitals: coverage.filter((c) => c.totalDoctors > 0).length,
      coverage,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message || 'Failed to fetch directory coverage' });
  }
});

export default router;
