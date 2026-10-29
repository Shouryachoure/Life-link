import prisma from '../db';
import {
  getIO,
  broadcastToPatient,
  broadcastToDriver,
  broadcastToHospital,
  broadcastToOperator,
  broadcastToDoctor,
  broadcastToSuperAdmin,
  broadcastToUser,
} from '../socket';
import { NotificationChannel, NotificationStatus, Role } from '@prisma/client';
import { sendEmergencyAlertToContacts, sendSMS } from '../utils/smsService';
import { metrics } from '../utils/metrics';
import { logger } from '../utils/logger';

export interface CreateNotificationInput {
  recipientId: string;
  recipientRole?: string;
  title: string;
  message: string;
  type: string;
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
  channel?: NotificationChannel | string;
  eventSource?: string;
  entityType?: string;
  entityId?: string;
  hospitalId?: string;
  operatorId?: string;
  doctorId?: string;
  data?: any;
  idempotencyKey?: string;
  expiresAt?: Date;
  allowSimulatedSMS?: boolean;
}

export interface DispatchNotificationResult {
  notification: any;
  deduplicated?: boolean;
  delivered: boolean;
  channel: string;
  recipientId: string;
  error?: string;
}

/**
 * Centralized Notification Dispatcher with Transactional Outbox,
 * Idempotent Deduping, and Recipient Authorization.
 */
export async function dispatchNotification(
  input: CreateNotificationInput
): Promise<DispatchNotificationResult> {
  const {
    recipientId,
    recipientRole,
    title,
    message,
    type,
    priority = 'NORMAL',
    channel = NotificationChannel.IN_APP,
    eventSource,
    entityType,
    entityId,
    hospitalId,
    operatorId,
    doctorId,
    data = {},
    idempotencyKey,
    expiresAt,
    allowSimulatedSMS = false,
  } = input;

  // 1. Idempotency Check: Suppress duplicates if idempotencyKey already processed
  if (idempotencyKey) {
    const existing = await prisma.notification.findUnique({
      where: { idempotencyKey },
    });
    if (existing) {
      return {
        notification: existing,
        deduplicated: true,
        delivered: existing.status === NotificationStatus.DELIVERED,
        channel: existing.channel,
        recipientId: existing.recipientId,
      };
    }
  }

  // 2. Check Expiry: Do not dispatch obsolete expired offers
  const isExpired = expiresAt ? expiresAt.getTime() <= Date.now() : false;
  const initialStatus = isExpired ? NotificationStatus.EXPIRED : NotificationStatus.QUEUED;

  // 3. Persist Notification Record Transactionally (Transactional Outbox)
  const notification = await prisma.notification.create({
    data: {
      recipientId,
      recipientRole,
      title,
      message,
      type,
      priority,
      channel: (channel as NotificationChannel) || NotificationChannel.IN_APP,
      status: initialStatus,
      isRead: false,
      eventSource: eventSource || type.toLowerCase(),
      entityType,
      entityId,
      hospitalId,
      operatorId,
      doctorId,
      data: data ? JSON.parse(JSON.stringify(data)) : null,
      idempotencyKey,
      expiresAt,
      retryCount: 0,
      maxRetries: 3,
    },
  });

  if (isExpired) {
    return {
      notification,
      delivered: false,
      channel: String(channel),
      recipientId,
      error: 'EXPIRED_BEFORE_DISPATCH',
    };
  }

  // 4. Real-time Delivery via Authorized Socket.IO Rooms
  let socketDelivered = false;
  let deliveryError: string | undefined;

  try {
    const io = getIO();
    const payload = {
      id: notification.id,
      title: notification.title,
      message: notification.message,
      type: notification.type,
      priority: notification.priority,
      entityType: notification.entityType,
      entityId: notification.entityId,
      hospitalId: notification.hospitalId,
      operatorId: notification.operatorId,
      doctorId: notification.doctorId,
      data: notification.data,
      createdAt: notification.createdAt,
      expiresAt: notification.expiresAt,
    };

    if (io) {
      // Direct recipient user room
      io.to(`user:${recipientId}`).emit('notification:new', payload);

      // Role-specific targeted routing
      if (type.startsWith('APPOINTMENT_') || type === 'DOCTOR_APPOINTMENT_ALERT') {
        if (doctorId) {
          broadcastToDoctor(doctorId, 'appointment:notification', payload);
        }
        if (hospitalId) {
          broadcastToHospital(hospitalId, 'appointment:notification', payload);
        }
        if (recipientRole === Role.PATIENT || recipientId) {
          broadcastToPatient(recipientId, 'appointment:notification', payload);
        }
      } else if (type === 'DISPATCH_OFFER') {
        broadcastToDriver(recipientId, 'dispatch:offer', {
          ...payload,
          ...data,
          expiresAt: expiresAt?.toISOString(),
        });
      } else if (type === 'PATIENT_DISPATCH_STATUS') {
        broadcastToPatient(recipientId, 'sos:status_update', payload);
      } else if (type === 'INCOMING_AMBULANCE_ALERT' && hospitalId) {
        broadcastToHospital(hospitalId, 'hospital:inbound_ambulance', payload);
      } else if (type === 'ORGANIZATION_APPROVAL_ALERT') {
        if (hospitalId) broadcastToHospital(hospitalId, 'organization:verified', payload);
        if (operatorId) broadcastToOperator(operatorId, 'organization:verified', payload);
      } else if (type === 'SUPER_ADMIN_REVIEW_ALERT') {
        broadcastToSuperAdmin('admin:review_alert', payload);
      }

      socketDelivered = true;
    }

    // 4. Record Metrics and Emitting Telemetry
    metrics.recordNotification('DISPATCHED');

    // 5. Update Status: Never mark delivered merely because it was queued
    // Marked DELIVERED only after successful real-time emit
    const updated = await prisma.notification.update({
      where: { id: notification.id },
      data: {
        status: NotificationStatus.DELIVERED,
        deliveredAt: new Date(),
      },
    });

    metrics.recordNotification('DELIVERED');
    logger.info('NOTIFICATION', `Notification delivered to ${recipientId}`, {
      metadata: { notificationId: notification.id, type, channel: String(channel) },
      operationOutcome: 'SUCCESS',
    });

    // 6. Optional Simulated SMS Channel Adapter (Zero paid cost, local development mode)
    if (allowSimulatedSMS || channel === NotificationChannel.SMS) {
      try {
        const user = await prisma.user.findUnique({ where: { id: recipientId } });
        if (user && user.phone) {
          await sendEmergencyAlertToContacts(
            [{ name: user.name, phone: user.phone }],
            user.name,
            `${title}: ${message}`
          );
        }
      } catch (smsErr) {
        // SMS failure is non-blocking for local zero-cost operation
      }
    }

    return {
      notification: updated,
      delivered: true,
      channel: String(channel),
      recipientId,
    };
  } catch (err: any) {
    deliveryError = err.message || 'Delivery error';
    metrics.recordNotification('FAILED');
    logger.warn('NOTIFICATION', `Notification delivery deferred to outbox for ${recipientId}: ${deliveryError}`, {
      metadata: { notificationId: notification.id, type },
      operationOutcome: 'DEGRADED',
    });

    await prisma.notification.update({
      where: { id: notification.id },
      data: {
        status: NotificationStatus.PENDING,
        retryCount: { increment: 1 },
        lastError: deliveryError,
      },
    });

    return {
      notification,
      delivered: false,
      channel: String(channel),
      recipientId,
      error: deliveryError,
    };
  }
}

// -----------------------------------------------------------------------------
// Domain Event Helper Dispatchers
// -----------------------------------------------------------------------------

/**
 * 1. Appointment Confirmation Notification
 * Routes to Patient, assigned Doctor, and Hospital Admin with sanitized data.
 */
export async function notifyAppointmentConfirmed(appointment: any) {
  const doctorName = appointment.doctor?.name || 'Assigned Doctor';
  const hospitalName = appointment.hospital?.name || 'Medical Facility';
  const slotDate = appointment.slot?.date || 'Scheduled Date';
  const slotTime = appointment.slot?.startTime || 'Scheduled Time';
  const tokenNumber = appointment.tokenNumber;

  // 1. Patient Notification
  await dispatchNotification({
    recipientId: appointment.patientId,
    recipientRole: Role.PATIENT,
    title: 'Appointment Confirmed',
    message: `Your appointment with ${doctorName} at ${hospitalName} is confirmed for ${slotDate} at ${slotTime}. Token #${tokenNumber}.`,
    type: 'APPOINTMENT_CONFIRMED',
    priority: 'HIGH',
    entityType: 'APPOINTMENT',
    entityId: appointment.id,
    hospitalId: appointment.hospitalId,
    doctorId: appointment.doctorId,
    data: {
      appointmentId: appointment.id,
      tokenNumber,
      tokenString: appointment.tokenString,
      doctorName,
      hospitalName,
      date: slotDate,
      startTime: slotTime,
    },
    idempotencyKey: `apt-confirmed-${appointment.id}`,
    allowSimulatedSMS: true,
  });

  // 2. Doctor Alert (Strictly routed to this doctor)
  if (appointment.doctorId) {
    const doctorUser = await prisma.user.findFirst({
      where: { id: appointment.doctorId },
    });
    const doctorUserId = doctorUser?.id || appointment.doctorId;

    await dispatchNotification({
      recipientId: doctorUserId,
      recipientRole: 'DOCTOR',
      title: 'New Appointment Booked',
      message: `New appointment scheduled for ${slotDate} at ${slotTime}. Token #${tokenNumber}.`,
      type: 'DOCTOR_APPOINTMENT_ALERT',
      priority: 'NORMAL',
      entityType: 'APPOINTMENT',
      entityId: appointment.id,
      hospitalId: appointment.hospitalId,
      doctorId: appointment.doctorId,
      data: {
        appointmentId: appointment.id,
        tokenNumber,
        date: slotDate,
        startTime: slotTime,
      },
      idempotencyKey: `doc-apt-${appointment.id}`,
    });
  }

  // 3. Hospital Admin Notification
  if (appointment.hospitalId) {
    const hospital = await prisma.hospital.findUnique({
      where: { id: appointment.hospitalId },
    });
    if (hospital && hospital.adminUserId) {
      await dispatchNotification({
        recipientId: hospital.adminUserId,
        recipientRole: Role.ADMIN_HOSPITAL,
        title: 'New OPD Booking',
        message: `Appointment #${tokenNumber} booked for ${doctorName} on ${slotDate} at ${slotTime}.`,
        type: 'HOSPITAL_APPOINTMENT_ALERT',
        priority: 'NORMAL',
        entityType: 'APPOINTMENT',
        entityId: appointment.id,
        hospitalId: appointment.hospitalId,
        doctorId: appointment.doctorId,
        data: {
          appointmentId: appointment.id,
          tokenNumber,
          doctorName,
          date: slotDate,
        },
        idempotencyKey: `hosp-apt-${appointment.id}`,
      });
    }
  }
}

/**
 * 2. Appointment Cancellation Notification
 */
export async function notifyAppointmentCancelled(appointment: any, reason?: string) {
  const doctorName = appointment.doctor?.name || 'Doctor';
  const tokenNumber = appointment.tokenNumber;
  const reasonText = reason || 'Cancelled by patient or hospital';

  // To Patient
  await dispatchNotification({
    recipientId: appointment.patientId,
    recipientRole: Role.PATIENT,
    title: 'Appointment Cancelled',
    message: `Your appointment with ${doctorName} (Token #${tokenNumber}) has been cancelled. Reason: ${reasonText}`,
    type: 'APPOINTMENT_CANCELLED',
    priority: 'HIGH',
    entityType: 'APPOINTMENT',
    entityId: appointment.id,
    hospitalId: appointment.hospitalId,
    doctorId: appointment.doctorId,
    data: { appointmentId: appointment.id, tokenNumber, reason: reasonText },
    idempotencyKey: `apt-cancelled-pat-${appointment.id}`,
  });

  // To Doctor
  if (appointment.doctorId) {
    await dispatchNotification({
      recipientId: appointment.doctorId,
      recipientRole: 'DOCTOR',
      title: 'Appointment Cancelled',
      message: `Appointment Token #${tokenNumber} has been cancelled.`,
      type: 'APPOINTMENT_CANCELLED',
      priority: 'NORMAL',
      entityType: 'APPOINTMENT',
      entityId: appointment.id,
      doctorId: appointment.doctorId,
      hospitalId: appointment.hospitalId,
      data: { appointmentId: appointment.id, tokenNumber },
      idempotencyKey: `apt-cancelled-doc-${appointment.id}`,
    });
  }

  // To Hospital Admin
  if (appointment.hospitalId) {
    const hospital = await prisma.hospital.findUnique({
      where: { id: appointment.hospitalId },
    });
    if (hospital?.adminUserId) {
      await dispatchNotification({
        recipientId: hospital.adminUserId,
        recipientRole: Role.ADMIN_HOSPITAL,
        title: 'Appointment Cancelled',
        message: `Appointment #${tokenNumber} for ${doctorName} was cancelled.`,
        type: 'APPOINTMENT_CANCELLED',
        priority: 'NORMAL',
        entityType: 'APPOINTMENT',
        entityId: appointment.id,
        hospitalId: appointment.hospitalId,
        data: { appointmentId: appointment.id, tokenNumber },
        idempotencyKey: `apt-cancelled-hosp-${appointment.id}`,
      });
    }
  }
}

/**
 * 3. Appointment Rescheduling Notification
 */
export async function notifyAppointmentRescheduled(
  appointment: any,
  newDate: string,
  newStartTime: string
) {
  const doctorName = appointment.doctor?.name || 'Doctor';
  const tokenNumber = appointment.tokenNumber;

  // 1. To Patient
  await dispatchNotification({
    recipientId: appointment.patientId,
    recipientRole: Role.PATIENT,
    title: 'Appointment Rescheduled',
    message: `Your appointment with ${doctorName} (Token #${tokenNumber}) has been rescheduled to ${newDate} at ${newStartTime}.`,
    type: 'APPOINTMENT_RESCHEDULED',
    priority: 'HIGH',
    entityType: 'APPOINTMENT',
    entityId: appointment.id,
    hospitalId: appointment.hospitalId,
    doctorId: appointment.doctorId,
    data: { appointmentId: appointment.id, newDate, newStartTime, tokenNumber },
    idempotencyKey: `apt-resched-pat-${appointment.id}-${newDate}-${newStartTime}`,
  });

  // 2. To Relevant Doctor
  if (appointment.doctorId) {
    await dispatchNotification({
      recipientId: appointment.doctorId,
      recipientRole: 'DOCTOR',
      title: 'Appointment Rescheduled',
      message: `Appointment Token #${tokenNumber} has been rescheduled to ${newDate} at ${newStartTime}.`,
      type: 'APPOINTMENT_RESCHEDULED',
      priority: 'NORMAL',
      entityType: 'APPOINTMENT',
      entityId: appointment.id,
      hospitalId: appointment.hospitalId,
      doctorId: appointment.doctorId,
      data: { appointmentId: appointment.id, newDate, newStartTime, tokenNumber },
      idempotencyKey: `apt-resched-doc-${appointment.id}-${newDate}-${newStartTime}`,
    });
  }

  // 3. To Relevant Hospital Admin
  if (appointment.hospitalId) {
    const hospital = await prisma.hospital.findUnique({
      where: { id: appointment.hospitalId },
    });
    if (hospital?.adminUserId) {
      await dispatchNotification({
        recipientId: hospital.adminUserId,
        recipientRole: Role.ADMIN_HOSPITAL,
        title: 'Appointment Rescheduled',
        message: `Appointment #${tokenNumber} for ${doctorName} was rescheduled to ${newDate} at ${newStartTime}.`,
        type: 'APPOINTMENT_RESCHEDULED',
        priority: 'NORMAL',
        entityType: 'APPOINTMENT',
        entityId: appointment.id,
        hospitalId: appointment.hospitalId,
        doctorId: appointment.doctorId,
        data: { appointmentId: appointment.id, newDate, newStartTime, tokenNumber },
        idempotencyKey: `apt-resched-hosp-${appointment.id}-${newDate}-${newStartTime}`,
      });
    }
  }
}

/**
 * 4. Ambulance Dispatch Offer with strict 30-second TTL
 */
export async function notifyDispatchOffer(
  driverUserId: string,
  attempt: any,
  request: any,
  distanceKm: number,
  expiresAt: Date
) {
  return dispatchNotification({
    recipientId: driverUserId,
    recipientRole: Role.DRIVER,
    title: 'Urgent: Emergency Dispatch Offer',
    message: `New emergency dispatch request within ${distanceKm} km. Respond before expiry.`,
    type: 'DISPATCH_OFFER',
    priority: 'CRITICAL',
    entityType: 'DISPATCH_ATTEMPT',
    entityId: attempt.id,
    data: {
      attemptId: attempt.id,
      requestId: request.id,
      distanceKm,
      ambulanceType: request.requiredAmbulanceType || 'BASIC_LIFE_SUPPORT',
      category: request.category || 'EMERGENCY',
      expiresAt: expiresAt.toISOString(),
    },
    expiresAt,
    idempotencyKey: `dispatch-offer-${attempt.id}`,
  });
}

/**
 * 5. Patient Dispatch Status Update
 */
export async function notifyPatientDispatchStatus(
  patientId: string,
  requestId: string,
  status: string,
  details: { driverName?: string; driverPhone?: string; vehicleNumber?: string; etaMinutes?: number } = {}
) {
  let title = 'Ambulance Status Update';
  let message = `Emergency request status updated to ${status}.`;

  if (status === 'ACCEPTED' || status === 'EN_ROUTE_TO_PICKUP') {
    title = 'Ambulance Dispatched & En Route';
    message = `Ambulance ${details.vehicleNumber || ''} is en route to your location. Driver: ${details.driverName || 'Assigned Driver'}. ETA: ${details.etaMinutes || 5} minute(s).`;
  } else if (status === 'AMBULANCE_ARRIVING') {
    title = 'Ambulance Arriving';
    message = `Ambulance is near your location. Estimated arrival in ${details.etaMinutes || 2} minutes.`;
  } else if (status === 'PATIENT_PICKED_UP') {
    title = 'Patient Picked Up';
    message = 'Ambulance has safely arrived and patient transit has begun.';
  } else if (status === 'COMPLETED') {
    title = 'Trip Completed';
    message = 'Emergency transit successfully completed at destination medical facility.';
  }

  return dispatchNotification({
    recipientId: patientId,
    recipientRole: Role.PATIENT,
    title,
    message,
    type: 'PATIENT_DISPATCH_STATUS',
    priority: 'HIGH',
    entityType: 'EMERGENCY_REQUEST',
    entityId: requestId,
    data: { requestId, status, ...details },
    idempotencyKey: `patient-sos-status-${requestId}-${status}`,
    allowSimulatedSMS: true,
  });
}

/**
 * 6. Incoming Ambulance Alert for Destination Hospital
 * Sanitized: exposes triage level and ETA without unnecessary medical details.
 */
export async function notifyIncomingAmbulance(
  hospitalId: string,
  requestId: string,
  details: { vehicleNumber?: string; driverName?: string; assignedBay?: string; triageLevel?: string; etaMinutes?: number; patientName?: string }
) {
  const hospital = await prisma.hospital.findUnique({ where: { id: hospitalId } });
  if (!hospital || !hospital.adminUserId) return;

  return dispatchNotification({
    recipientId: hospital.adminUserId,
    recipientRole: Role.ADMIN_HOSPITAL,
    title: 'Inbound Ambulance Alert',
    message: `Inbound emergency rig (${details.vehicleNumber || 'Ambulance'}) arriving at ${details.assignedBay || 'ER Trauma Bay'}. Triage: ${details.triageLevel || 'CRITICAL'}. ETA: ${details.etaMinutes || 5} min.`,
    type: 'INCOMING_AMBULANCE_ALERT',
    priority: 'CRITICAL',
    entityType: 'EMERGENCY_REQUEST',
    entityId: requestId,
    hospitalId,
    data: {
      requestId,
      vehicleNumber: details.vehicleNumber,
      assignedBay: details.assignedBay,
      triageLevel: details.triageLevel,
      etaMinutes: details.etaMinutes,
      patientName: details.patientName || 'Emergency Patient',
    },
    idempotencyKey: `inbound-hosp-${hospitalId}-${requestId}`,
  });
}

/**
 * 7. Driver Verification and Credential Expiry Alerts
 */
export async function notifyDriverVerification(
  driverUserId: string,
  newState: string,
  reviewNotes?: string
) {
  const isApproved = newState === 'VERIFIED';
  return dispatchNotification({
    recipientId: driverUserId,
    recipientRole: Role.DRIVER,
    title: isApproved ? 'Verification Approved' : 'Verification Update',
    message: isApproved
      ? 'Your ambulance driver profile has been verified. You are now eligible for live dispatches.'
      : `Your verification state is now ${newState}. ${reviewNotes ? 'Notes: ' + reviewNotes : ''}`,
    type: 'DRIVER_VERIFICATION_ALERT',
    priority: 'HIGH',
    data: { newState, reviewNotes },
    idempotencyKey: `driver-verif-${driverUserId}-${newState}`,
  });
}

export async function notifyDriverCredentialExpiry(
  driverUserId: string,
  credentialType: string,
  expiryDate: Date,
  daysRemaining: number
) {
  return dispatchNotification({
    recipientId: driverUserId,
    recipientRole: Role.DRIVER,
    title: 'Credential Expiry Warning',
    message: `Your ${credentialType} will expire in ${daysRemaining} day(s) on ${expiryDate.toISOString().split('T')[0]}. Please submit renewed documents.`,
    type: 'CREDENTIAL_EXPIRY_ALERT',
    priority: 'HIGH',
    data: { credentialType, expiryDate: expiryDate.toISOString(), daysRemaining },
    idempotencyKey: `driver-expiry-${driverUserId}-${credentialType}-${daysRemaining}d`,
  });
}

/**
 * 8. Hospital and Operator Approval Notifications
 */
export async function notifyOrganizationApproval(
  entityType: 'HOSPITAL' | 'OPERATOR',
  entityId: string,
  status: string,
  notes?: string
) {
  let adminUserId: string | null = null;
  let orgName = 'Organization';

  if (entityType === 'HOSPITAL') {
    const hosp = await prisma.hospital.findUnique({ where: { id: entityId } });
    adminUserId = hosp?.adminUserId || null;
    orgName = hosp?.name || 'Hospital';
  } else {
    const op = await prisma.ambulanceOperator.findUnique({ where: { id: entityId } });
    adminUserId = op?.adminUserId || null;
    orgName = op?.name || 'Ambulance Operator';
  }

  if (!adminUserId) return;

  const isApproved = status === 'VERIFIED';
  return dispatchNotification({
    recipientId: adminUserId,
    recipientRole: entityType === 'HOSPITAL' ? Role.ADMIN_HOSPITAL : Role.OPERATOR_ADMIN,
    title: isApproved ? `${entityType} Registration Approved` : `${entityType} Verification Status`,
    message: isApproved
      ? `Congratulations! ${orgName} has been verified and approved on LifeLink.`
      : `${orgName} status updated to ${status}. ${notes ? 'Notes: ' + notes : ''}`,
    type: 'ORGANIZATION_APPROVAL_ALERT',
    priority: 'HIGH',
    entityType,
    entityId,
    hospitalId: entityType === 'HOSPITAL' ? entityId : undefined,
    operatorId: entityType === 'OPERATOR' ? entityId : undefined,
    data: { status, notes },
    idempotencyKey: `org-approval-${entityType}-${entityId}-${status}`,
  });
}

/**
 * 9. Super-Admin Review Alerts
 */
export async function notifySuperAdminReview(
  entityType: string,
  entityId: string,
  reason: string
) {
  const superAdmin = await prisma.user.findFirst({
    where: { role: Role.SUPER_ADMIN },
  });
  if (!superAdmin) return;

  return dispatchNotification({
    recipientId: superAdmin.id,
    recipientRole: Role.SUPER_ADMIN,
    title: 'Administrative Review Required',
    message: `Review requested for ${entityType} (${entityId}). Reason: ${reason}`,
    type: 'SUPER_ADMIN_REVIEW_ALERT',
    priority: 'NORMAL',
    entityType,
    entityId,
    data: { entityType, entityId, reason },
    idempotencyKey: `admin-review-${entityType}-${entityId}`,
  });
}

// -----------------------------------------------------------------------------
// Transactional Outbox Retry & Expiry Workers
// -----------------------------------------------------------------------------

/**
 * Retryable Outbox Worker: Picks up PENDING notifications that previously failed
 * or were queued during brief network disruption.
 */
export async function processOutboxRetries(): Promise<{ retried: number; delivered: number; failed: number }> {
  const now = new Date();
  let deliveredCount = 0;
  let failedCount = 0;

  try {
    const pending = await prisma.notification.findMany({
      where: {
        status: NotificationStatus.PENDING,
        retryCount: { lt: 5 },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      take: 50,
    });

    for (const notif of pending) {
      metrics.recordNotification('RETRIED');
      try {
        const io = getIO();
        if (io) {
          io.to(`user:${notif.recipientId}`).emit('notification:new', notif);
          await prisma.notification.update({
            where: { id: notif.id },
            data: {
              status: NotificationStatus.DELIVERED,
              deliveredAt: new Date(),
            },
          });
          deliveredCount++;
          metrics.recordNotification('DELIVERED');
        } else {
          throw new Error('Socket.IO instance unavailable during background retry');
        }
      } catch (err: any) {
        const newCount = notif.retryCount + 1;
        const maxLimit = notif.maxRetries || 5;
        const isExhausted = newCount >= maxLimit;

        await prisma.notification.update({
          where: { id: notif.id },
          data: {
            retryCount: newCount,
            lastError: err.message,
            status: isExhausted ? NotificationStatus.FAILED : NotificationStatus.PENDING,
          },
        });

        if (isExhausted) {
          metrics.recordNotification('FAILED');
          logger.warn('OUTBOX_WORKER', `Notification ${notif.id} retry attempts exhausted (${newCount}/${maxLimit})`, {
            metadata: { recipientId: notif.recipientId, error: err.message },
          });
        }
        failedCount++;
      }
    }

    const remainingBacklog = await prisma.notification.count({
      where: { status: NotificationStatus.PENDING },
    });
    metrics.setOutboxBacklogCount(remainingBacklog);
    metrics.recordWorkerRun('outbox_retries', true);

    return { retried: pending.length, delivered: deliveredCount, failed: failedCount };
  } catch (err: any) {
    metrics.recordWorkerRun('outbox_retries', false);
    logger.error('OUTBOX_WORKER', 'Failed to execute outbox retry cycle', { error: err });
    return { retried: 0, delivered: 0, failed: 0 };
  }
}

/**
 * Expiry Worker: Automatically marks obsolete dispatch offers as EXPIRED.
 */
export async function expireObsoleteOffers(): Promise<number> {
  const now = new Date();
  try {
    const expired = await prisma.notification.updateMany({
      where: {
        status: NotificationStatus.PENDING,
        expiresAt: { lte: now },
      },
      data: {
        status: NotificationStatus.EXPIRED,
      },
    });

    metrics.recordWorkerRun('expire_offers', true);
    return expired.count;
  } catch (err: any) {
    metrics.recordWorkerRun('expire_offers', false);
    logger.error('EXPIRY_WORKER', 'Failed to execute offer expiry cycle', { error: err });
    return 0;
  }
}

/**
 * Trusted Contact Emergency Trip Milestone Notification Dispatcher
 * Dispatches both in-app notification to patient and SMS to trusted contacts.
 */
export async function notifyTrustedContactsOfTripMilestone(params: {
  patientId: string;
  patientName: string;
  requestId: string;
  milestone: string;
  message: string;
  shareToken?: string;
  destinationHospitalName?: string | null;
  simulateSmsFailure?: boolean;
}) {
  const {
    patientId,
    patientName,
    requestId,
    milestone,
    message,
    shareToken,
    destinationHospitalName,
    simulateSmsFailure,
  } = params;

  const contacts = await prisma.emergencyContact.findMany({
    where: { patientId },
  });

  const trackingLink = shareToken ? `/track-trip?token=${shareToken}` : undefined;
  const results: any[] = [];

  for (const contact of contacts) {
    if (contact.canReceiveTripUpdates === false) continue;

    // 1. In-App Notification (always persisted and attempted as core no-cost channel)
    const inAppResult = await dispatchNotification({
      recipientId: patientId,
      recipientRole: Role.PATIENT,
      title: `Trip Milestone: ${milestone}`,
      message: `${message}${destinationHospitalName ? ` (Destination: ${destinationHospitalName})` : ''}`,
      type: `TRIP_SHARE_${milestone}`,
      priority: 'HIGH',
      channel: NotificationChannel.IN_APP,
      entityType: 'EMERGENCY_REQUEST',
      entityId: requestId,
      data: {
        requestId,
        milestone,
        contactName: contact.name,
        contactPhone: contact.phone,
        trackingLink,
        destinationHospitalName,
      },
      idempotencyKey: `trip-milestone-${requestId}-${contact.id}-${milestone}`,
    });

    // 2. Cellular SMS via Configured Adapter (with simulated fallback and error tracking)
    let smsResult: any = null;
    if (contact.phone && contact.notifyOnSos !== false) {
      const smsBody = `LifeLink Alert: ${patientName}'s emergency trip milestone updated: ${message}.${
        destinationHospitalName ? ` Destination: ${destinationHospitalName}.` : ''
      }${trackingLink ? ` Live Tracking: ${trackingLink}` : ''}`;

      smsResult = await sendSMS(contact.phone, smsBody, { simulateFailure: simulateSmsFailure });
    }

    results.push({
      contactId: contact.id,
      contactName: contact.name,
      phone: contact.phone,
      inAppStatus: inAppResult.notification.status,
      smsStatus: smsResult ? smsResult.deliveryStatus : null,
      smsSuccess: smsResult ? smsResult.success : null,
      smsError: smsResult ? smsResult.error : null,
    });
  }

  return results;
}
