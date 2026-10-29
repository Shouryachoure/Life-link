import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import prisma from '../db';
import { authenticate, AuthRequest } from '../middleware/auth';
import { getIO } from '../socket';
import { notifyTrustedContactsOfTripMilestone } from '../services/notificationService';
import { maskPhoneNumber } from '../utils/phoneUtils';

const router = Router();

/**
 * Mask full name to protect patient privacy on public/contact views (e.g. "Rahul Sharma" -> "Rahul S.")
 */
function maskPatientName(fullName: string | null | undefined): string {
  if (!fullName) return 'Patient';
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].length > 2 ? `${parts[0].slice(0, 2)}***` : parts[0];
  }
  return `${parts[0]} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`;
}

/**
 * POST /api/v1/trip-share/session
 * Patient creates a cryptographically secure, unguessable trip-sharing session for trusted contacts.
 */
router.post('/session', authenticate, async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const {
    requestId,
    contactId,
    recipientName,
    recipientPhone,
    recipientEmail,
    allowLiveLocation = true,
    allowDestinationHospital = true,
    durationHours = 4,
  } = req.body;

  if (!requestId) {
    return res.status(400).json({ message: 'Emergency request ID is required', code: 'REQUEST_ID_REQUIRED' });
  }

  try {
    // 1. Verify patient ownership of emergency request
    const emergencyRequest = await prisma.emergencyRequest.findUnique({
      where: { id: requestId },
      include: {
        trip: { include: { ambulance: true, hospital: true } },
      },
    });

    if (!emergencyRequest) {
      return res.status(404).json({ message: 'Emergency request not found', code: 'REQUEST_NOT_FOUND' });
    }

    if (emergencyRequest.patientId !== req.user.id) {
      return res.status(403).json({
        message: 'Forbidden: You can only share emergency trips that belong to your account',
        code: 'FORBIDDEN_REQUEST_OWNERSHIP',
      });
    }

    // 2. Consent Check: Verify patient has not disabled emergency sharing
    const profile = await prisma.patientProfile.findUnique({
      where: { userId: req.user.id },
    });
    if (profile && profile.consentEmergencySharing === false) {
      return res.status(403).json({
        message: 'Emergency sharing is currently disabled in your privacy settings. Please enable emergency sharing to share trips.',
        code: 'CONSENT_REVOKED',
      });
    }

    // 3. Optional Trusted Contact Verification
    let contactEntity: any = null;
    if (contactId) {
      contactEntity = await prisma.emergencyContact.findUnique({ where: { id: contactId } });
      if (!contactEntity || contactEntity.patientId !== req.user.id) {
        return res.status(404).json({ message: 'Specified emergency contact not found', code: 'CONTACT_NOT_FOUND' });
      }
    }

    // 4. Generate unguessable, cryptographically secure 24-byte hex token
    const shareToken = crypto.randomBytes(24).toString('hex');

    // 5. Compute expiration (capped at durationHours, default 4h)
    const validHours = Math.min(Math.max(Number(durationHours) || 4, 1), 24);
    const expiresAt = new Date(Date.now() + validHours * 3600 * 1000);

    // 6. Create Trip Share Record
    const tripShare = await prisma.emergencyTripShare.create({
      data: {
        requestId,
        tripId: emergencyRequest.trip?.id || null,
        patientId: req.user.id,
        contactId: contactEntity?.id || null,
        recipientName: recipientName ? String(recipientName).trim() : contactEntity?.name || 'Trusted Contact',
        recipientPhone: recipientPhone ? String(recipientPhone).trim() : contactEntity?.phone || null,
        recipientEmail: recipientEmail ? String(recipientEmail).trim() : contactEntity?.email || null,
        shareToken,
        status: 'ACTIVE',
        allowLiveLocation: Boolean(allowLiveLocation),
        allowDestinationHospital: Boolean(allowDestinationHospital),
        expiresAt,
      },
    });

    // 7. Record Audit Log: Share Created
    await prisma.emergencyTripShareAuditLog.create({
      data: {
        shareId: tripShare.id,
        shareToken: tripShare.shareToken,
        requestId,
        patientId: req.user.id,
        action: 'SHARE_CREATED',
        actorId: req.user.id,
        actorRole: 'PATIENT',
        actorName: req.user.name,
        ipAddress: req.ip || null,
        userAgent: req.get('user-agent') || null,
        details: {
          contactId: contactEntity?.id || null,
          recipientName: tripShare.recipientName,
          expiresAt: tripShare.expiresAt,
          allowLiveLocation: tripShare.allowLiveLocation,
        },
      },
    });

    // 8. Auto-dispatch initial notification to trusted contacts
    const trackingUrl = `/track-trip?token=${shareToken}`;
    try {
      await notifyTrustedContactsOfTripMilestone({
        patientId: req.user.id,
        patientName: req.user.name,
        requestId,
        milestone: 'REQUEST_CREATED',
        message: 'Emergency request active. Live trip sharing has been initialized.',
        shareToken,
        destinationHospitalName: emergencyRequest.trip?.hospital?.name || null,
      });
    } catch {
      // Non-blocking notification dispatch
    }

    return res.status(201).json({
      message: 'Emergency trip share link generated successfully.',
      share: {
        id: tripShare.id,
        shareToken: tripShare.shareToken,
        trackingUrl,
        expiresAt: tripShare.expiresAt,
        status: tripShare.status,
        allowLiveLocation: tripShare.allowLiveLocation,
        allowDestinationHospital: tripShare.allowDestinationHospital,
        recipientName: tripShare.recipientName,
        recipientPhoneMasked: maskPhoneNumber(tripShare.recipientPhone),
      },
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to create trip share session' });
  }
});

/**
 * POST /api/v1/trip-share/revoke
 * Patient revokes trip sharing permissions immediately.
 */
router.post('/revoke', authenticate, async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const { shareToken, shareId, requestId, reason = 'Revoked by patient' } = req.body;

  if (!shareToken && !shareId && !requestId) {
    return res.status(400).json({ message: 'Must specify shareToken, shareId, or requestId to revoke' });
  }

  try {
    let affectedCount = 0;
    const now = new Date();

    if (shareToken || shareId) {
      const share = await prisma.emergencyTripShare.findFirst({
        where: {
          OR: [
            ...(shareToken ? [{ shareToken }] : []),
            ...(shareId ? [{ id: shareId }] : []),
          ],
        },
      });

      if (!share) {
        return res.status(404).json({ message: 'Trip share session not found', code: 'SHARE_NOT_FOUND' });
      }

      if (share.patientId !== req.user.id) {
        return res.status(403).json({ message: 'Forbidden: You can only revoke your own trip shares' });
      }

      await prisma.emergencyTripShare.update({
        where: { id: share.id },
        data: {
          status: 'REVOKED',
          revokedAt: now,
          revokedReason: String(reason).trim(),
        },
      });

      await prisma.emergencyTripShareAuditLog.create({
        data: {
          shareId: share.id,
          shareToken: share.shareToken,
          requestId: share.requestId,
          patientId: req.user.id,
          action: 'SHARE_REVOKED',
          actorId: req.user.id,
          actorRole: 'PATIENT',
          actorName: req.user.name,
          ipAddress: req.ip || null,
          userAgent: req.get('user-agent') || null,
          details: { reason: String(reason).trim(), revokedAt: now },
        },
      });

      affectedCount = 1;

      // Broadcast revocation via socket room to disconnect any active stream
      const io = getIO();
      if (io) {
        io.to(`trip_share:${share.shareToken}`).emit('trip_share:revoked', {
          shareToken: share.shareToken,
          revokedAt: now,
          message: 'This trip sharing link has been revoked by the patient.',
        });
      }
    } else if (requestId) {
      // Revoke all active shares for this request
      const shares = await prisma.emergencyTripShare.findMany({
        where: { requestId, patientId: req.user.id, status: 'ACTIVE' },
      });

      for (const share of shares) {
        await prisma.emergencyTripShare.update({
          where: { id: share.id },
          data: { status: 'REVOKED', revokedAt: now, revokedReason: String(reason).trim() },
        });

        await prisma.emergencyTripShareAuditLog.create({
          data: {
            shareId: share.id,
            shareToken: share.shareToken,
            requestId: share.requestId,
            patientId: req.user.id,
            action: 'SHARE_REVOKED',
            actorId: req.user.id,
            actorRole: 'PATIENT',
            actorName: req.user.name,
            ipAddress: req.ip || null,
            userAgent: req.get('user-agent') || null,
            details: { reason: String(reason).trim(), bulk: true },
          },
        });
      }

      affectedCount = shares.length;
    }

    return res.json({
      message: `Trip sharing revoked successfully. ${affectedCount} active link(s) disabled.`,
      revokedCount: affectedCount,
      revokedAt: now,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to revoke trip share' });
  }
});

/**
 * GET /api/v1/trip-share/active
 * Patient views all active trip sharing sessions and their statuses.
 */
router.get('/active', authenticate, async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    const shares = await prisma.emergencyTripShare.findMany({
      where: { patientId: req.user.id },
      include: {
        request: {
          select: {
            id: true,
            status: true,
            createdAt: true,
            pickupAddress: true,
          },
        },
        contact: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const now = Date.now();
    const formatted = shares.map((s: any) => {
      const isExpired = new Date(s.expiresAt).getTime() <= now;
      let computedStatus = s.status;
      if (s.status === 'ACTIVE' && isExpired) computedStatus = 'EXPIRED';

      return {
        id: s.id,
        shareToken: s.shareToken,
        trackingUrl: `/track-trip?token=${s.shareToken}`,
        status: computedStatus,
        isExpired,
        expiresAt: s.expiresAt,
        revokedAt: s.revokedAt,
        recipientName: s.recipientName,
        recipientPhoneMasked: maskPhoneNumber(s.recipientPhone),
        allowLiveLocation: s.allowLiveLocation,
        allowDestinationHospital: s.allowDestinationHospital,
        createdAt: s.createdAt,
        requestStatus: s.request?.status,
        requestId: s.requestId,
      };
    });

    return res.json({
      shares: formatted,
      count: formatted.length,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to fetch active trip shares' });
  }
});

/**
 * GET /api/v1/trip-share/track/:token (or /:token)
 * PUBLIC / TRUSTED CONTACT LIVE TRACKING ENDPOINT
 * Scoped access protected by the cryptographically secure unguessable share token.
 * Security & Minimal Data Disclosure:
 * - Masked Patient Name (Zero medical conditions, allergies, or medications exposed)
 * - Sanitized Ambulance Vehicle Number (Zero driver private personal PII)
 * - Destination Hospital ONLY exposed once assigned & confirmed
 * - Live location ONLY while trip is actively underway; stopped upon trip completion/cancellation
 * - Location staleness warning when telemetry > 5 mins old
 */
const handleTrackTrip = async (req: Request, res: Response) => {
  const token = req.params.token;

  if (!token || typeof token !== 'string' || token.length < 16) {
    return res.status(400).json({
      message: 'Invalid or missing trip sharing token',
      code: 'INVALID_TOKEN_FORMAT',
    });
  }

  try {
    const share = await prisma.emergencyTripShare.findUnique({
      where: { shareToken: token },
      include: {
        patient: { select: { id: true, name: true } },
        request: {
          include: {
            trip: {
              include: {
                ambulance: true,
                hospital: true,
              },
            },
            hospital: true,
            events: { orderBy: { timestamp: 'asc' } },
          },
        },
      },
    });

    if (!share) {
      return res.status(404).json({
        message: 'Trip sharing link is invalid or does not exist.',
        code: 'SHARE_TOKEN_NOT_FOUND',
      });
    }

    // Check Revocation: Immediately block access if revoked
    if (share.status === 'REVOKED' || share.revokedAt) {
      return res.status(410).json({
        message: 'Trip sharing permission has been revoked by the patient.',
        code: 'SHARE_PERMISSION_REVOKED',
        revokedAt: share.revokedAt,
      });
    }

    // Check Expiration: Block access if time-bounded token expired
    const nowMs = Date.now();
    const expiresMs = new Date(share.expiresAt).getTime();
    if (expiresMs <= nowMs || share.status === 'EXPIRED') {
      return res.status(410).json({
        message: 'This emergency trip sharing session has expired.',
        code: 'SHARE_PERMISSION_EXPIRED',
        expiredAt: share.expiresAt,
      });
    }

    const request = share.request;
    const trip = request?.trip;
    const ambulance = trip?.ambulance;

    // Determine lifecycle state
    const isCompleted = request.status === 'COMPLETED';
    const isCancelled = request.status === 'CANCELLED';
    const isTerminal = isCompleted || isCancelled;

    // Calculate Milestones from recorded emergency events & trip timestamps
    const milestones = [
      {
        milestone: 'REQUEST_CREATED',
        label: 'Emergency Request Created',
        timestamp: request.createdAt,
        completed: true,
      },
      {
        milestone: 'AMBULANCE_ASSIGNED',
        label: 'Ambulance Unit Assigned',
        timestamp: trip?.startedAt || null,
        completed: !!trip,
      },
      {
        milestone: 'AMBULANCE_ARRIVING',
        label: 'Ambulance En Route to Patient',
        timestamp: trip?.arrivedAt || null,
        completed: ['AMBULANCE_ARRIVING', 'PATIENT_PICKED_UP', 'AT_DESTINATION', 'COMPLETED'].includes(trip?.status || ''),
      },
      {
        milestone: 'PATIENT_PICKED_UP',
        label: 'Patient Safely Picked Up',
        timestamp: trip?.pickedUpAt || null,
        completed: ['PATIENT_PICKED_UP', 'AT_DESTINATION', 'COMPLETED'].includes(trip?.status || ''),
      },
      {
        milestone: 'AT_DESTINATION',
        label: 'Ambulance Arrived at Hospital ER',
        timestamp: trip?.status === 'AT_DESTINATION' ? trip?.updatedAt : null,
        completed: ['AT_DESTINATION', 'COMPLETED'].includes(trip?.status || ''),
      },
      {
        milestone: 'COMPLETED',
        label: isCancelled ? 'Emergency Trip Cancelled' : 'Emergency Trip Completed',
        timestamp: isCancelled ? trip?.cancelledAt || request.updatedAt : trip?.completedAt || request.completedAt,
        completed: isTerminal,
      },
    ];

    // Destination Hospital Secrecy: Only expose if assigned & confirmed
    let destinationHospital: any = null;
    const confirmedHospital = trip?.hospital || request.hospital;
    if (share.allowDestinationHospital && confirmedHospital) {
      destinationHospital = {
        name: confirmedHospital.name,
        address: confirmedHospital.address || 'Nagpur, Maharashtra',
        phone: confirmedHospital.contactNumber || null,
        confirmed: true,
      };
    }

    // Live Location Tracking: Only while trip is active, authorized, and technically available
    let liveLocation: any = null;
    let isLocationStale = false;
    let locationAgeSeconds = 0;

    if (share.allowLiveLocation && !isTerminal && ambulance) {
      const lastPingTime = ambulance.lastUpdated ? new Date(ambulance.lastUpdated).getTime() : 0;
      locationAgeSeconds = lastPingTime > 0 ? Math.max(0, Math.round((nowMs - lastPingTime) / 1000)) : 999999;
      // Stale if last reported > 5 minutes ago (300 seconds)
      isLocationStale = locationAgeSeconds > 300;

      liveLocation = {
        lat: ambulance.currentLat,
        lng: ambulance.currentLng,
        movementStatus: isLocationStale ? 'UNKNOWN' : (ambulance.movementStatus || 'STOPPED'),
        speedKmH: isLocationStale ? 0 : (ambulance.speedKmH || 0),
        lastUpdated: ambulance.lastUpdated,
        locationAgeSeconds,
        isStale: isLocationStale,
        stalenessWarning: isLocationStale
          ? 'Ambulance GPS telemetry was last updated more than 5 minutes ago. Location may be delayed due to cellular reception.'
          : null,
      };
    }

    // Sanitized Vehicle Information (ZERO private driver PII)
    const vehicleInfo = ambulance
      ? {
          vehicleNumber: ambulance.vehicleNumber,
          ambulanceType: ambulance.ambulanceType,
        }
      : null;

    // Record Audit Log: Share Accessed
    await prisma.emergencyTripShareAuditLog.create({
      data: {
        shareId: share.id,
        shareToken: share.shareToken,
        requestId: share.requestId,
        patientId: share.patientId,
        action: 'SHARE_ACCESSED',
        actorRole: 'TRUSTED_CONTACT',
        actorName: share.recipientName || 'Trusted Contact',
        ipAddress: req.ip || null,
        userAgent: req.get('user-agent') || null,
        details: {
          tripStatus: request.status,
          isTerminal,
        },
      },
    });

    return res.json({
      status: 'ACTIVE_SHARE',
      tripStatus: request.status,
      isLiveTrackingActive: !isTerminal && share.allowLiveLocation && !!liveLocation,
      patientMaskedName: maskPatientName(share.patient?.name),
      milestones,
      currentMilestone: request.status,
      destinationHospital,
      destinationNotice: !destinationHospital
        ? 'Destination hospital will be visible once assigned and confirmed by clinical emergency dispatch.'
        : null,
      liveLocation,
      vehicle: vehicleInfo,
      pickup: {
        lat: request.pickupLat,
        lng: request.pickupLng,
        address: request.pickupAddress || 'Nagpur Pilot Zone',
      },
      shareMetadata: {
        expiresAt: share.expiresAt,
        recipientName: share.recipientName,
        createdAt: share.createdAt,
      },
      officialEmergencyNotice: {
        emergencyNumber: '112',
        disclaimer: 'For critical immediate emergencies, dial official National Emergency Number 112 directly.',
      },
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to track emergency trip' });
  }
};

router.get('/track/:token', handleTrackTrip);
router.get('/:token', handleTrackTrip);

/**
 * GET /api/v1/trip-share/audit-logs
 * Patient inspects permission changes and access log history.
 */
router.get('/audit-logs', authenticate, async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const take = Math.min(parseInt(req.query.take as string) || 50, 100);
  const skip = parseInt(req.query.skip as string) || 0;

  try {
    const logs = await prisma.emergencyTripShareAuditLog.findMany({
      where: { patientId: req.user.id },
      take,
      skip,
      orderBy: { timestamp: 'desc' },
    });

    const total = await prisma.emergencyTripShareAuditLog.count({
      where: { patientId: req.user.id },
    });

    return res.json({
      logs,
      total,
      take,
      skip,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to fetch trip share audit logs' });
  }
});

export default router;
