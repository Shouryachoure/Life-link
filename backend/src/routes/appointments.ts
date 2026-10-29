import { Router } from 'express';
import { AppointmentStatus, Role } from '@prisma/client';
import prisma from '../db';
import { authenticate, AuthRequest } from '../middleware/auth';
import { getIO } from '../socket';
import {
  notifyAppointmentConfirmed,
  notifyAppointmentCancelled,
  notifyAppointmentRescheduled,
} from '../services/notificationService';
import { metrics } from '../utils/metrics';
import { isSlotInPastIST, getTodayDateStringIST } from '../utils/localization';

const router = Router();

// ============================================================================
// 1. POST /api/appointments - Book an appointment atomically
// ============================================================================
router.post('/', authenticate, async (req: AuthRequest, res) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const patientId = req.user.id;
  const { slotId, symptoms, notes, doctorId } = req.body;

  if (doctorId) {
    const doc = await prisma.doctor.findUnique({ where: { id: doctorId } });
    if (doc && (doc.bookingEnabled === false || doc.verificationStatus === 'PUBLIC_DIRECTORY_LISTED')) {
      return res.status(400).json({
        success: false,
        code: 'BOOKING_NOT_SUPPORTED_FOR_DIRECTORY_LISTING',
        error: 'BOOKING_NOT_SUPPORTED_FOR_DIRECTORY_LISTING',
        message: 'This doctor is part of a public directory listing and is not verified for direct LifeLink online booking. Please contact the hospital OPD directly.',
      });
    }
  }

  if (!slotId) {
    return res.status(400).json({ message: 'slotId is required' });
  }

  try {
    const newAppointment = await prisma.$transaction(async (tx) => {
      // 1. Verify slot exists and get doctor & hospital info
      const slot = await tx.doctorSlot.findUnique({
        where: { id: slotId },
        include: {
          doctor: {
            include: {
              hospital: true,
            },
          },
        },
      });

      if (!slot) {
        throw new Error('DOCTOR_SLOT_NOT_FOUND');
      }

      // 2. Prevent booking blocked slots
      if (slot.isBlocked) {
        throw new Error('SLOT_BLOCKED');
      }

      // 3. Prevent booking slots in the past (Asia/Kolkata timezone)
      if (isSlotInPastIST(slot.date, slot.startTime)) {
        throw new Error('CANNOT_BOOK_PAST_SLOT');
      }

      // 4. Validate doctor is active and has real booking availability enabled
      if (!slot.doctor.isActive) {
        throw new Error('DOCTOR_INACTIVE');
      }

      if (slot.doctor.bookingEnabled === false || slot.doctor.verificationStatus === 'PUBLIC_DIRECTORY_LISTED') {
        throw new Error('BOOKING_NOT_SUPPORTED_FOR_DIRECTORY_LISTING');
      }

      // 5. Prevent booking if doctor is on leave/unavailable on this date
      if (
        slot.doctor.unavailableDates &&
        Array.isArray(slot.doctor.unavailableDates) &&
        slot.doctor.unavailableDates.includes(slot.date)
      ) {
        throw new Error('DOCTOR_ON_LEAVE');
      }

      // 6. Prevent duplicate active booking by the same patient for the same slot
      const existingPatientBooking = await tx.appointment.findFirst({
        where: {
          slotId,
          patientId,
          status: {
            in: [
              AppointmentStatus.BOOKED,
              AppointmentStatus.CONFIRMED,
              AppointmentStatus.CHECKED_IN,
              AppointmentStatus.IN_CONSULTATION,
            ],
          },
        },
      });

      if (existingPatientBooking) {
        throw new Error('DUPLICATE_BOOKING');
      }

      // 7. Atomic Concurrency Protection:
      // Row-level lock conditional increment at the database level.
      const updateResult = await tx.doctorSlot.updateMany({
        where: {
          id: slotId,
          bookedCount: { lt: slot.maxPatients },
          isBlocked: false,
        },
        data: {
          bookedCount: { increment: 1 },
        },
      });

      if (updateResult.count === 0) {
        throw new Error('SLOT_FULLY_BOOKED');
      }

      // 8. Generate strictly monotonic sequential token within this slot
      const existingAppointments = await tx.appointment.findMany({
        where: { slotId },
        select: { tokenNumber: true },
      });
      const maxToken = existingAppointments.reduce((max, a) => Math.max(max, a.tokenNumber || 0), 0);
      const tokenNumber = maxToken + 1;
      const docCode = slot.doctor.name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase() || 'DOC';
      const dateCompact = slot.date.replace(/-/g, '');
      const tokenSeq = String(tokenNumber).padStart(3, '0');
      const tokenString = `NAG-${docCode}-${dateCompact}-${tokenSeq}`;

      // 9. Create the appointment record
      const appointment = await tx.appointment.create({
        data: {
          hospitalId: slot.doctor.hospitalId,
          doctorId: slot.doctorId,
          slotId: slot.id,
          patientId,
          tokenNumber,
          tokenString,
          status: AppointmentStatus.BOOKED,
          symptoms: symptoms ? String(symptoms).trim() : null,
          notes: notes ? String(notes).trim() : null,
        },
        include: {
          doctor: {
            select: {
              id: true,
              name: true,
              specialization: true,
              consultationFee: true,
            },
          },
          slot: {
            select: {
              id: true,
              date: true,
              startTime: true,
              endTime: true,
              maxPatients: true,
              bookedCount: true,
            },
          },
          hospital: {
            select: {
              id: true,
              name: true,
              address: true,
              contactNumber: true,
            },
          },
          patient: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
            },
          },
        },
      });

      // 10. Persist immutable audit log
      await tx.appointmentAuditLog.create({
        data: {
          appointmentId: appointment.id,
          hospitalId: slot.doctor.hospitalId,
          doctorId: slot.doctorId,
          patientId,
          action: 'CREATED',
          previousStatus: null,
          newStatus: AppointmentStatus.BOOKED,
          actorId: req.user!.id,
          actorRole: req.user!.role,
          actorName: req.user!.name || 'Patient',
          reason: symptoms ? `Booking: ${symptoms}` : 'Appointment booked by patient',
          metadata: { slotId, tokenNumber, tokenString },
        },
      });

      return appointment;
    });

    metrics.recordAppointment('CREATED');

    // Centralized Notification Engine (strictly scoped to patient, doctor, hospital admin)
    await notifyAppointmentConfirmed(newAppointment).catch((err) => {
      console.error('[NotificationEngine Error] notifyAppointmentConfirmed failed:', err);
    });

    // Real-time socket emission
    const io = getIO();
    if (io) {
      const notificationPayload = {
        appointmentId: newAppointment.id,
        tokenNumber: newAppointment.tokenNumber,
        tokenString: (newAppointment as any).tokenString,
        doctorName: newAppointment.doctor.name,
        hospitalName: newAppointment.hospital?.name,
        date: newAppointment.slot.date,
        startTime: newAppointment.slot.startTime,
        patientName: newAppointment.patient.name,
        status: newAppointment.status,
      };
      io.to(`doctor:${newAppointment.doctorId}`).emit('appointment:new', notificationPayload);
      if (newAppointment.hospitalId) {
        io.to(`hospital:${newAppointment.hospitalId}`).emit('appointment:new', notificationPayload);
      }
      io.to(`patient:${patientId}`).emit('appointment:confirmed', notificationPayload);
    }

    return res.status(201).json({
      message: 'Appointment booked successfully',
      appointment: newAppointment,
      tokenNumber: newAppointment.tokenNumber,
      tokenString: (newAppointment as any).tokenString,
    });
  } catch (error: any) {
    if (error.message === 'DOCTOR_SLOT_NOT_FOUND') {
      return res.status(404).json({ message: 'Selected doctor slot was not found' });
    }
    if (error.message === 'SLOT_BLOCKED') {
      return res.status(400).json({ message: 'This appointment slot has been blocked by the hospital' });
    }
    if (error.message === 'CANNOT_BOOK_PAST_SLOT') {
      return res.status(400).json({ message: 'Cannot book appointments for past dates or times' });
    }
    if (error.message === 'DOCTOR_INACTIVE') {
      return res.status(400).json({ message: 'Doctor is currently inactive' });
    }
    if (error.message === 'BOOKING_NOT_SUPPORTED_FOR_DIRECTORY_LISTING') {
      return res.status(400).json({
        success: false,
        code: 'BOOKING_NOT_SUPPORTED_FOR_DIRECTORY_LISTING',
        error: 'BOOKING_NOT_SUPPORTED_FOR_DIRECTORY_LISTING',
        message: 'Direct online booking is not available for public directory listings. Please contact the hospital directly.',
      });
    }
    if (error.message === 'DOCTOR_ON_LEAVE') {
      return res.status(400).json({ message: 'Doctor is unavailable or on leave on this date' });
    }
    if (error.message === 'DUPLICATE_BOOKING') {
      return res.status(409).json({ message: 'You already have an active booking for this time slot' });
    }
    if (error.message === 'SLOT_FULLY_BOOKED') {
      return res.status(409).json({ message: 'Slot is fully booked. Please choose another time slot or doctor.' });
    }
    return res.status(500).json({ message: error.message || 'Failed to book appointment' });
  }
});

// ============================================================================
// 2. GET /api/appointments/my - Get patient's appointments
// ============================================================================
router.get('/my', authenticate, async (req: AuthRequest, res) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    const appointments = await prisma.appointment.findMany({
      where: { patientId: req.user.id },
      include: {
        doctor: {
          select: {
            id: true,
            name: true,
            specialization: true,
            consultationFee: true,
          },
        },
        slot: {
          select: {
            id: true,
            date: true,
            startTime: true,
            endTime: true,
          },
        },
        hospital: {
          select: {
            id: true,
            name: true,
            address: true,
            contactNumber: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.json(appointments);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to fetch appointments' });
  }
});

// GET /api/appointments/my-appointments - Returns { appointments, count } format
router.get('/my-appointments', authenticate, async (req: AuthRequest, res) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    const appointments = await prisma.appointment.findMany({
      where: { patientId: req.user.id },
      include: {
        doctor: {
          select: {
            id: true,
            name: true,
            specialization: true,
            consultationFee: true,
          },
        },
        slot: {
          select: {
            id: true,
            date: true,
            startTime: true,
            endTime: true,
          },
        },
        hospital: {
          select: {
            id: true,
            name: true,
            address: true,
            contactNumber: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.json({ appointments, count: appointments.length });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to fetch appointments' });
  }
});

// ============================================================================
// 3. GET /api/appointments/:id - View specific appointment with tenancy check
// ============================================================================
router.get('/:id', authenticate, async (req: AuthRequest, res) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const { id } = req.params;

  try {
    const appointment = await prisma.appointment.findUnique({
      where: { id },
      include: {
        doctor: {
          select: {
            id: true,
            name: true,
            specialization: true,
            consultationFee: true,
          },
        },
        slot: {
          select: {
            id: true,
            date: true,
            startTime: true,
            endTime: true,
          },
        },
        hospital: {
          select: {
            id: true,
            name: true,
            address: true,
            contactNumber: true,
          },
        },
        patient: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
          },
        },
      },
    });

    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found' });
    }

    const isOwner = appointment.patientId === req.user.id;
    let isHospitalAdmin = false;
    if (req.user.role === Role.ADMIN_HOSPITAL) {
      const adminHospital = await prisma.hospital.findUnique({
        where: { adminUserId: req.user.id },
      });
      isHospitalAdmin = !!adminHospital && appointment.hospitalId === adminHospital.id;
    }
    const isSuperAdmin = req.user.role === Role.SUPER_ADMIN;

    if (!isOwner && !isHospitalAdmin && !isSuperAdmin) {
      return res.status(403).json({
        message: "Forbidden: You do not have permission to access another user's appointment",
        code: 'UNAUTHORIZED_APPOINTMENT_ACCESS',
      });
    }

    return res.json(appointment);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to fetch appointment' });
  }
});

// ============================================================================
// 4. PUT /api/appointments/:id/confirm - Hospital staff confirms appointment
// ============================================================================
router.put('/:id/confirm', authenticate, async (req: AuthRequest, res) => {
  if (!req.user || (req.user.role !== Role.ADMIN_HOSPITAL && req.user.role !== Role.SUPER_ADMIN)) {
    return res.status(403).json({ message: 'Forbidden: Only authorized hospital staff can confirm appointments' });
  }

  const { id } = req.params;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const appointment = await tx.appointment.findUnique({
        where: { id },
        include: { slot: true, doctor: true, hospital: true, patient: true },
      });

      if (!appointment) {
        throw new Error('NOT_FOUND');
      }

      if (req.user!.role === Role.ADMIN_HOSPITAL) {
        const adminHospital = await tx.hospital.findUnique({
          where: { adminUserId: req.user!.id },
        });
        if (!adminHospital || appointment.hospitalId !== adminHospital.id) {
          throw new Error('FORBIDDEN');
        }
      }

      if (appointment.status === AppointmentStatus.CANCELLED) {
        throw new Error('CANNOT_CONFIRM_CANCELLED');
      }

      if (appointment.status === AppointmentStatus.COMPLETED) {
        throw new Error('ALREADY_COMPLETED');
      }

      const updated = await tx.appointment.update({
        where: { id },
        data: {
          status: AppointmentStatus.CONFIRMED,
          confirmedAt: new Date(),
        },
        include: {
          doctor: { select: { id: true, name: true, specialization: true } },
          slot: true,
          hospital: { select: { id: true, name: true, address: true } },
          patient: { select: { id: true, name: true, email: true, phone: true } },
        },
      });

      // Audit Log
      await tx.appointmentAuditLog.create({
        data: {
          appointmentId: appointment.id,
          hospitalId: appointment.hospitalId,
          doctorId: appointment.doctorId,
          patientId: appointment.patientId,
          action: 'CONFIRMED',
          previousStatus: appointment.status,
          newStatus: AppointmentStatus.CONFIRMED,
          actorId: req.user!.id,
          actorRole: req.user!.role,
          actorName: req.user!.name || 'Hospital Staff',
          reason: 'Appointment confirmed by hospital staff',
        },
      });

      return updated;
    });

    const io = getIO();
    if (io) {
      io.to(`patient:${result.patientId}`).emit('appointment:status_update', {
        appointmentId: result.id,
        status: AppointmentStatus.CONFIRMED,
        tokenNumber: result.tokenNumber,
        tokenString: (result as any).tokenString,
      });
    }

    return res.json({ message: 'Appointment confirmed successfully', appointment: result });
  } catch (error: any) {
    if (error.message === 'NOT_FOUND') return res.status(404).json({ message: 'Appointment not found' });
    if (error.message === 'FORBIDDEN') return res.status(403).json({ message: 'Forbidden: Hospital unauthorized', code: 'UNAUTHORIZED_HOSPITAL_ACCESS' });
    if (error.message === 'CANNOT_CONFIRM_CANCELLED') return res.status(400).json({ message: 'Cannot confirm a cancelled appointment' });
    if (error.message === 'ALREADY_COMPLETED') return res.status(400).json({ message: 'Appointment already completed' });
    return res.status(500).json({ message: error.message || 'Failed to confirm appointment' });
  }
});

// ============================================================================
// 5. PUT /api/appointments/:id/cancel - Cancel appointment with slot recovery
// ============================================================================
router.put('/:id/cancel', authenticate, async (req: AuthRequest, res) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const { id } = req.params;
  const { reason } = req.body || {};

  try {
    const result = await prisma.$transaction(async (tx) => {
      const appointment = await tx.appointment.findUnique({
        where: { id },
        include: { slot: true },
      });

      if (!appointment) {
        throw new Error('NOT_FOUND');
      }

      // Check permission: Patient who booked, or Hospital Admin of the hospital, or Super Admin
      const isOwner = appointment.patientId === req.user!.id;
      let isHospitalAdmin = false;
      if (req.user!.role === Role.ADMIN_HOSPITAL) {
        const adminHospital = await tx.hospital.findUnique({
          where: { adminUserId: req.user!.id },
        });
        isHospitalAdmin = !!adminHospital && appointment.hospitalId === adminHospital.id;
      }
      const isSuperAdmin = req.user!.role === Role.SUPER_ADMIN;

      if (!isOwner && !isHospitalAdmin && !isSuperAdmin) {
        throw new Error('FORBIDDEN');
      }

      if (appointment.status === AppointmentStatus.CANCELLED) {
        throw new Error('ALREADY_CANCELLED');
      }

      if (appointment.status === AppointmentStatus.COMPLETED) {
        throw new Error('CANNOT_CANCEL_COMPLETED');
      }

      const cancellationReason = reason ? String(reason).trim() : 'Cancelled by user';

      // Update appointment status to CANCELLED
      const updated = await tx.appointment.update({
        where: { id },
        data: {
          status: AppointmentStatus.CANCELLED,
          cancellationReason,
        },
      });

      // Safely decrement bookedCount on slot
      if (appointment.slot.bookedCount > 0) {
        await tx.doctorSlot.update({
          where: { id: appointment.slotId },
          data: { bookedCount: { decrement: 1 } },
        });
      }

      // Persist Audit Log
      await tx.appointmentAuditLog.create({
        data: {
          appointmentId: appointment.id,
          hospitalId: appointment.hospitalId,
          doctorId: appointment.doctorId,
          patientId: appointment.patientId,
          action: 'CANCELLED',
          previousStatus: appointment.status,
          newStatus: AppointmentStatus.CANCELLED,
          actorId: req.user!.id,
          actorRole: req.user!.role,
          actorName: req.user!.name || 'Authorized User',
          reason: cancellationReason,
        },
      });

      return updated;
    });

    // Notify Patient, Doctor, and Hospital Admin of cancellation (strictly scoped)
    try {
      const fullAppointment = await prisma.appointment.findUnique({
        where: { id: result.id },
        include: { doctor: true, hospital: true, slot: true, patient: true },
      });
      if (fullAppointment) {
        await notifyAppointmentCancelled(fullAppointment, result.cancellationReason || undefined);
      }
    } catch (notifErr) {
      console.error('[NotificationEngine Error] notifyAppointmentCancelled failed:', notifErr);
    }

    metrics.recordAppointment('CANCELLED');
    return res.json({ message: 'Appointment cancelled successfully', appointment: result });
  } catch (error: any) {
    if (error.message === 'NOT_FOUND') {
      return res.status(404).json({ message: 'Appointment not found' });
    }
    if (error.message === 'FORBIDDEN') {
      return res.status(403).json({
        message: 'You do not have permission to cancel this appointment',
        code: 'UNAUTHORIZED_HOSPITAL_ACCESS',
      });
    }
    if (error.message === 'ALREADY_CANCELLED') {
      return res.status(400).json({ message: 'Appointment is already cancelled' });
    }
    if (error.message === 'CANNOT_CANCEL_COMPLETED') {
      return res.status(400).json({ message: 'Cannot cancel an appointment that has already been completed' });
    }
    return res.status(500).json({ message: error.message || 'Failed to cancel appointment' });
  }
});

// ============================================================================
// 6. POST & PUT /api/appointments/:id/reschedule - Reschedule appointment
// ============================================================================
async function handleReschedule(req: AuthRequest, res: any) {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const { id } = req.params;
  const { targetSlotId, reason } = req.body;

  if (!targetSlotId) {
    return res.status(400).json({ message: 'targetSlotId is required for rescheduling' });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. Fetch current appointment
      const appointment = await tx.appointment.findUnique({
        where: { id },
        include: { slot: true, doctor: true, hospital: true },
      });

      if (!appointment) {
        throw new Error('NOT_FOUND');
      }

      // 2. Permission check
      const isOwner = appointment.patientId === req.user!.id;
      let isHospitalAdmin = false;
      if (req.user!.role === Role.ADMIN_HOSPITAL) {
        const adminHospital = await tx.hospital.findUnique({
          where: { adminUserId: req.user!.id },
        });
        isHospitalAdmin = !!adminHospital && appointment.hospitalId === adminHospital.id;
      }
      const isSuperAdmin = req.user!.role === Role.SUPER_ADMIN;

      if (!isOwner && !isHospitalAdmin && !isSuperAdmin) {
        throw new Error('FORBIDDEN');
      }

      // 3. Reject terminal states
      if (
        appointment.status === AppointmentStatus.CANCELLED ||
        appointment.status === AppointmentStatus.COMPLETED
      ) {
        throw new Error('CANNOT_RESCHEDULE_TERMINAL');
      }

      // 4. Same slot check
      if (targetSlotId === appointment.slotId) {
        throw new Error('SAME_SLOT_RESCHEDULE');
      }

      // 5. Fetch target slot
      const targetSlot = await tx.doctorSlot.findUnique({
        where: { id: targetSlotId },
        include: {
          doctor: {
            include: {
              hospital: true,
            },
          },
        },
      });

      if (!targetSlot) {
        throw new Error('TARGET_SLOT_NOT_FOUND');
      }

      if (targetSlot.isBlocked) {
        throw new Error('TARGET_SLOT_BLOCKED');
      }

      if (isSlotInPastIST(targetSlot.date, targetSlot.startTime)) {
        throw new Error('CANNOT_BOOK_PAST_SLOT');
      }

      if (!targetSlot.doctor.isActive) {
        throw new Error('DOCTOR_INACTIVE');
      }

      if (
        targetSlot.doctor.unavailableDates &&
        Array.isArray(targetSlot.doctor.unavailableDates) &&
        targetSlot.doctor.unavailableDates.includes(targetSlot.date)
      ) {
        throw new Error('DOCTOR_ON_LEAVE');
      }

      // 6. Concurrency lock: increment target slot capacity atomically
      const updateTargetResult = await tx.doctorSlot.updateMany({
        where: {
          id: targetSlotId,
          bookedCount: { lt: targetSlot.maxPatients },
          isBlocked: false,
        },
        data: {
          bookedCount: { increment: 1 },
        },
      });

      if (updateTargetResult.count === 0) {
        throw new Error('TARGET_SLOT_FULLY_BOOKED');
      }

      // 7. Safely decrement original slot capacity
      if (appointment.slot.bookedCount > 0) {
        await tx.doctorSlot.update({
          where: { id: appointment.slotId },
          data: {
            bookedCount: { decrement: 1 },
          },
        });
      }

      // 8. Calculate new monotonic token for target slot
      const targetAppointments = await tx.appointment.findMany({
        where: { slotId: targetSlotId },
        select: { tokenNumber: true },
      });
      const maxToken = targetAppointments.reduce((max, a) => Math.max(max, a.tokenNumber || 0), 0);
      const newTokenNumber = maxToken + 1;
      const docCode = targetSlot.doctor.name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase() || 'DOC';
      const dateCompact = targetSlot.date.replace(/-/g, '');
      const tokenSeq = String(newTokenNumber).padStart(3, '0');
      const newTokenString = `NAG-${docCode}-${dateCompact}-${tokenSeq}`;

      // 9. Update appointment record
      const updated = await tx.appointment.update({
        where: { id },
        data: {
          slotId: targetSlotId,
          doctorId: targetSlot.doctorId,
          hospitalId: targetSlot.doctor.hospitalId,
          tokenNumber: newTokenNumber,
          tokenString: newTokenString,
          rescheduledFromSlotId: appointment.slotId,
          rescheduledAt: new Date(),
          status: AppointmentStatus.BOOKED,
        },
        include: {
          doctor: {
            select: { id: true, name: true, specialization: true, consultationFee: true },
          },
          slot: {
            select: { id: true, date: true, startTime: true, endTime: true, maxPatients: true, bookedCount: true },
          },
          hospital: {
            select: { id: true, name: true, address: true, contactNumber: true },
          },
          patient: {
            select: { id: true, name: true, email: true, phone: true },
          },
        },
      });

      // 10. Persist audit log
      await tx.appointmentAuditLog.create({
        data: {
          appointmentId: updated.id,
          hospitalId: targetSlot.doctor.hospitalId,
          doctorId: targetSlot.doctorId,
          patientId: appointment.patientId,
          action: 'RESCHEDULED',
          previousStatus: appointment.status,
          newStatus: AppointmentStatus.BOOKED,
          actorId: req.user!.id,
          actorRole: req.user!.role,
          actorName: req.user!.name || 'Authorized User',
          reason: reason || 'Appointment rescheduled to a new time slot',
          metadata: {
            previousSlotId: appointment.slotId,
            previousDate: appointment.slot.date,
            previousTime: appointment.slot.startTime,
            newSlotId: targetSlotId,
            newDate: targetSlot.date,
            newTime: targetSlot.startTime,
            previousToken: appointment.tokenNumber,
            newToken: newTokenNumber,
          },
        },
      });

      return updated;
    });

    metrics.recordAppointment('RESCHEDULED');

    // Centralized notification engine (isolated to patient, doctor, hospital)
    notifyAppointmentRescheduled(
      result,
      result.slot.date,
      result.slot.startTime
    ).catch((err) => {
      console.error('[NotificationEngine Error] notifyAppointmentRescheduled failed:', err);
    });

    // Real-time socket emission
    const io = getIO();
    if (io) {
      const payload = {
        appointmentId: result.id,
        tokenNumber: result.tokenNumber,
        tokenString: (result as any).tokenString,
        date: result.slot.date,
        startTime: result.slot.startTime,
        status: result.status,
      };
      io.to(`patient:${result.patientId}`).emit('appointment:rescheduled', payload);
      io.to(`doctor:${result.doctorId}`).emit('appointment:rescheduled', payload);
      if (result.hospitalId) {
        io.to(`hospital:${result.hospitalId}`).emit('appointment:rescheduled', payload);
      }
    }

    return res.json({
      message: 'Appointment rescheduled successfully',
      appointment: result,
      tokenNumber: result.tokenNumber,
      tokenString: (result as any).tokenString,
    });
  } catch (error: any) {
    if (error.message === 'NOT_FOUND') return res.status(404).json({ message: 'Appointment not found' });
    if (error.message === 'FORBIDDEN') return res.status(403).json({ message: 'You do not have permission to reschedule this appointment', code: 'UNAUTHORIZED_HOSPITAL_ACCESS' });
    if (error.message === 'CANNOT_RESCHEDULE_TERMINAL') return res.status(400).json({ message: 'Cannot reschedule a completed or cancelled appointment' });
    if (error.message === 'SAME_SLOT_RESCHEDULE') return res.status(400).json({ message: 'Target slot must be different from current slot' });
    if (error.message === 'TARGET_SLOT_NOT_FOUND') return res.status(404).json({ message: 'Selected target slot was not found' });
    if (error.message === 'TARGET_SLOT_BLOCKED') return res.status(400).json({ message: 'Selected target slot is blocked by the hospital' });
    if (error.message === 'CANNOT_BOOK_PAST_SLOT') return res.status(400).json({ message: 'Cannot reschedule to a past slot' });
    if (error.message === 'DOCTOR_INACTIVE') return res.status(400).json({ message: 'Doctor is inactive for the selected slot' });
    if (error.message === 'DOCTOR_ON_LEAVE') return res.status(400).json({ message: 'Doctor is unavailable or on leave for the selected date' });
    if (error.message === 'TARGET_SLOT_FULLY_BOOKED') return res.status(409).json({ message: 'Target slot is fully booked. Please choose another slot.' });
    return res.status(500).json({ message: error.message || 'Failed to reschedule appointment' });
  }
}

router.post('/:id/reschedule', authenticate, handleReschedule);
router.put('/:id/reschedule', authenticate, handleReschedule);

// ============================================================================
// 7. PUT /api/appointments/:id/status - Update appointment status with audit trail
// ============================================================================
router.put('/:id/status', authenticate, async (req: AuthRequest, res) => {
  if (!req.user || (req.user.role !== Role.ADMIN_HOSPITAL && req.user.role !== Role.SUPER_ADMIN)) {
    return res.status(403).json({ message: 'Forbidden: Only authorized hospital staff can update appointment status' });
  }

  const { id } = req.params;
  const { status, reason } = req.body;

  if (!status || !Object.values(AppointmentStatus).includes(status)) {
    return res.status(400).json({ message: 'Invalid appointment status' });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.appointment.findUnique({
        where: { id },
        include: { slot: true },
      });

      if (!existing) {
        throw new Error('NOT_FOUND');
      }

      if (req.user!.role === Role.ADMIN_HOSPITAL) {
        const adminHospital = await tx.hospital.findUnique({
          where: { adminUserId: req.user!.id },
        });
        if (!adminHospital || existing.hospitalId !== adminHospital.id) {
          throw new Error('FORBIDDEN');
        }
      }

      // If already terminal and trying to re-modify
      if (existing.status === AppointmentStatus.COMPLETED && status !== AppointmentStatus.COMPLETED) {
        throw new Error('ALREADY_COMPLETED');
      }

      const updateData: any = { status };
      if (status === AppointmentStatus.CONFIRMED && !existing.confirmedAt) {
        updateData.confirmedAt = new Date();
      } else if (status === AppointmentStatus.CHECKED_IN && !existing.checkedInAt) {
        updateData.checkedInAt = new Date();
      } else if (status === AppointmentStatus.COMPLETED && !existing.completedAt) {
        updateData.completedAt = new Date();
      } else if (status === AppointmentStatus.CANCELLED) {
        updateData.cancellationReason = reason || 'Cancelled by staff';
        // Decrement slot bookedCount if transitioning to CANCELLED and was previously active
        if (existing.status !== AppointmentStatus.CANCELLED && existing.slot.bookedCount > 0) {
          await tx.doctorSlot.update({
            where: { id: existing.slotId },
            data: { bookedCount: { decrement: 1 } },
          });
        }
      } else if (status === AppointmentStatus.NO_SHOW) {
        // Free slot capacity on NO_SHOW
        if (existing.status !== AppointmentStatus.NO_SHOW && existing.slot.bookedCount > 0) {
          await tx.doctorSlot.update({
            where: { id: existing.slotId },
            data: { bookedCount: { decrement: 1 } },
          });
        }
      }

      const updated = await tx.appointment.update({
        where: { id },
        data: updateData,
        include: {
          doctor: { select: { id: true, name: true, specialization: true } },
          slot: true,
          hospital: { select: { id: true, name: true, address: true } },
          patient: { select: { id: true, name: true, email: true, phone: true } },
        },
      });

      // Audit Log
      await tx.appointmentAuditLog.create({
        data: {
          appointmentId: existing.id,
          hospitalId: existing.hospitalId,
          doctorId: existing.doctorId,
          patientId: existing.patientId,
          action: 'STATUS_UPDATED',
          previousStatus: existing.status,
          newStatus: status,
          actorId: req.user!.id,
          actorRole: req.user!.role,
          actorName: req.user!.name || 'Hospital Staff',
          reason: reason || `Status updated from ${existing.status} to ${status}`,
        },
      });

      return updated;
    });

    const io = getIO();
    if (io) {
      io.to(`patient:${result.patientId}`).emit('appointment:status_update', {
        appointmentId: result.id,
        status: result.status,
        tokenNumber: result.tokenNumber,
        tokenString: (result as any).tokenString,
      });
    }

    return res.json({
      ...result,
      message: 'Appointment status updated successfully',
      appointment: result,
    });
  } catch (error: any) {
    if (error.message === 'NOT_FOUND') return res.status(404).json({ message: 'Appointment not found' });
    if (error.message === 'FORBIDDEN') {
      return res.status(403).json({
        message: 'Forbidden: You cannot modify appointments for an unrelated hospital',
        code: 'UNAUTHORIZED_HOSPITAL_ACCESS',
      });
    }
    if (error.message === 'ALREADY_COMPLETED') {
      return res.status(400).json({ message: 'Completed appointments cannot change status' });
    }
    return res.status(500).json({ message: error.message || 'Failed to update appointment status' });
  }
});

// ============================================================================
// 8. GET /api/appointments/:id/audit-trail - View appointment audit logs
// ============================================================================
router.get('/:id/audit-trail', authenticate, async (req: AuthRequest, res) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const { id } = req.params;

  try {
    const appointment = await prisma.appointment.findUnique({
      where: { id },
    });

    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found' });
    }

    const isOwner = appointment.patientId === req.user.id;
    let isHospitalAdmin = false;
    if (req.user.role === Role.ADMIN_HOSPITAL) {
      const adminHospital = await prisma.hospital.findUnique({
        where: { adminUserId: req.user.id },
      });
      isHospitalAdmin = !!adminHospital && appointment.hospitalId === adminHospital.id;
    }
    const isSuperAdmin = req.user.role === Role.SUPER_ADMIN;

    if (!isOwner && !isHospitalAdmin && !isSuperAdmin) {
      return res.status(403).json({
        message: 'Forbidden: Unauthorized access to appointment audit logs',
        code: 'UNAUTHORIZED_HOSPITAL_ACCESS',
      });
    }

    const logs = await prisma.appointmentAuditLog.findMany({
      where: { appointmentId: id },
      orderBy: { timestamp: 'asc' },
    });

    return res.json({
      appointmentId: id,
      count: logs.length,
      auditLogs: logs,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to fetch audit trail' });
  }
});

// ============================================================================
// 9. GET /api/appointments/hospital/queue - Hospital Admin retrieves appointment OPD queue
// ============================================================================
router.get('/hospital/queue', authenticate, async (req: AuthRequest, res) => {
  if (!req.user || (req.user.role !== Role.ADMIN_HOSPITAL && req.user.role !== Role.SUPER_ADMIN)) {
    return res.status(403).json({ message: 'Forbidden: Only hospital administrators can access the OPD queue' });
  }

  try {
    let hospitalId = req.query.hospitalId as string | undefined;
    if (req.user.role === Role.ADMIN_HOSPITAL) {
      const hospital = await prisma.hospital.findUnique({
        where: { adminUserId: req.user.id },
      });
      if (!hospital) {
        return res.status(404).json({ message: 'Managed hospital not found for current administrator' });
      }
      hospitalId = hospital.id;
    }

    const doctorId = req.query.doctorId as string | undefined;
    const dateParam = req.query.date as string | undefined;
    const specialization = req.query.specialization as string | undefined;
    const statusParam = req.query.status as string | undefined;
    const searchQuery = req.query.search ? String(req.query.search).trim().toLowerCase() : undefined;

    // Build filter clause
    const whereClause: any = {
      ...(hospitalId && { hospitalId }),
      ...(doctorId && { doctorId }),
      ...(statusParam && { status: statusParam }),
    };

    // Date filtering (support 'today' keyword or specific YYYY-MM-DD)
    const targetDate = dateParam === 'today' ? getTodayDateStringIST() : dateParam;
    if (targetDate) {
      whereClause.slot = { date: targetDate };
    }

    let appointments = await prisma.appointment.findMany({
      where: whereClause,
      include: {
        doctor: { select: { id: true, name: true, specialization: true, consultationFee: true } },
        patient: { select: { id: true, name: true, phone: true, email: true } },
        slot: true,
      },
      orderBy: [{ tokenNumber: 'asc' }],
    });

    // In-memory filter for specialization or search query if needed
    if (specialization) {
      appointments = appointments.filter(
        (a) => a.doctor?.specialization?.toLowerCase() === specialization.toLowerCase()
      );
    }

    if (searchQuery) {
      appointments = appointments.filter((a) => {
        const patientName = a.patient?.name?.toLowerCase() || '';
        const patientPhone = a.patient?.phone?.toLowerCase() || '';
        const tokenStr = (a as any).tokenString?.toLowerCase() || '';
        const doctorName = a.doctor?.name?.toLowerCase() || '';
        return (
          patientName.includes(searchQuery) ||
          patientPhone.includes(searchQuery) ||
          tokenStr.includes(searchQuery) ||
          doctorName.includes(searchQuery)
        );
      });
    }

    // Aggregate summary counts
    const summary = {
      total: appointments.length,
      booked: appointments.filter((a) => a.status === AppointmentStatus.BOOKED).length,
      confirmed: appointments.filter((a) => a.status === AppointmentStatus.CONFIRMED).length,
      checkedIn: appointments.filter((a) => a.status === AppointmentStatus.CHECKED_IN).length,
      inConsultation: appointments.filter((a) => a.status === AppointmentStatus.IN_CONSULTATION).length,
      completed: appointments.filter((a) => a.status === AppointmentStatus.COMPLETED).length,
      cancelled: appointments.filter((a) => a.status === AppointmentStatus.CANCELLED).length,
      noShow: appointments.filter((a) => a.status === AppointmentStatus.NO_SHOW).length,
    };

    return res.json({
      hospitalId,
      date: targetDate || 'ALL',
      summary,
      count: appointments.length,
      queue: appointments,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to fetch hospital appointment queue' });
  }
});

export default router;

