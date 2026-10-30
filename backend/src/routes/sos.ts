import { Router } from 'express';
import { RequestStatus, TripLifecycleStatus, AmbulanceType, Role, DispatchAttemptStatus, VerificationState } from '@prisma/client';
import { authenticate, AuthRequest, authorize } from '../middleware/auth';
import prisma from '../db';
import {
  checkServiceArea,
  discoverAndRankCandidates,
  dispatchOfferToCandidate,
  atomicallyAcceptOffer,
  rejectOrExpireOffer,
  calculateHaversineDistanceKm,
  reassignTripSafely,
} from '../services/dispatchEngine';
import { getIO } from '../socket';
import { notifyTrustedContactsOfTripMilestone } from '../services/notificationService';
import { sendSMS, isSmsProviderConfigured, getCarrierProviderStatus } from '../utils/smsService';

const router = Router();

// Official 112 guidance notice constant
const OFFICIAL_112_NOTICE = {
  nationalEmergencyNumber: '112',
  disclaimer:
    'LifeLink is an emergency care coordination platform currently piloting in Nagpur, Maharashtra and expanding across authorized Indian service areas. For immediate life-threatening emergencies, always dial official National Emergency Number 112 directly. LifeLink coordinates with registered hospital and operator networks and does not replace official state emergency dispatch.',
};

// -------------------------------------------------------------
// 1. Patient SOS Request Creation
// -------------------------------------------------------------
router.post('/request', authenticate, async (req: AuthRequest, res) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthorized' });

  const {
    pickupLat,
    pickupLng,
    pickupAddress,
    category,
    urgencyLevel,
    requiredAmbulanceType,
    isDemo = false,
  } = req.body;

  // Validate coordinates
  const lat = parseFloat(pickupLat);
  const lng = parseFloat(pickupLng);

  if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({
      message: 'Invalid coordinate values. Latitude must be between -90 and 90, and longitude between -180 and 180.',
      code: 'INVALID_COORDINATES',
    });
  }

  // Dynamic Service Area Check
  const areaCheck = await checkServiceArea(lat, lng);
  if (!areaCheck.inArea) {
    const areaName = areaCheck.serviceArea ? `${areaCheck.serviceArea.name} (${areaCheck.serviceArea.city})` : 'active service areas';
    const nearestCity = areaCheck.serviceArea?.city || 'the nearest operational hub';
    return res.status(400).json({
      message: `Requested location is outside active service areas. Nearest configured zone is ${areaName}. Please provide an address within ${nearestCity} or dial national emergency 112 directly.`,
      code: 'OUTSIDE_SERVICE_AREA',
      nearestServiceArea: areaCheck.serviceArea?.name,
      nearestCity: areaCheck.serviceArea?.city,
      distanceFromPilotCenterKm: areaCheck.distanceFromCenterKm,
      officialEmergencyFallback: OFFICIAL_112_NOTICE,
    });
  }

  // Expansion Safety Gatekeeper: Ensure matching service area is operational and not PLANNED
  if (areaCheck.serviceArea?.metadata) {
    try {
      const meta = typeof areaCheck.serviceArea.metadata === 'string'
        ? JSON.parse(areaCheck.serviceArea.metadata)
        : areaCheck.serviceArea.metadata;
      if (meta?.status === 'PLANNED') {
        return res.status(403).json({
          message: `Service area "${areaCheck.serviceArea.name}" in ${areaCheck.serviceArea.city} is currently in PLANNED expansion status and is not yet operational for emergency dispatches. Please dial 112 directly.`,
          code: 'SERVICE_AREA_NOT_OPERATIONAL',
          city: areaCheck.serviceArea.city,
          status: 'PLANNED',
          expansionNotice: true,
          officialEmergencyFallback: OFFICIAL_112_NOTICE,
        });
      }
    } catch {
      // Proceed if metadata parse fails
    }
  }

  try {
    // Check if patient already has an active non-terminal SOS request (Idempotency / Single-active-request policy)
    const existingActiveRequest = await prisma.emergencyRequest.findFirst({
      where: {
        patientId: req.user.id,
        status: {
          notIn: [
            RequestStatus.COMPLETED,
            RequestStatus.CANCELLED,
            RequestStatus.REJECTED,
            RequestStatus.NO_ELIGIBLE_AMBULANCE,
            RequestStatus.FAILED,
          ],
        },
      },
    });

    if (existingActiveRequest) {
      return res.status(409).json({
        message: 'You already have an active emergency request in progress.',
        code: 'ACTIVE_REQUEST_EXISTS',
        request: existingActiveRequest,
      });
    }

    // Determine ambulance type requirement based on category if not explicitly provided
    let ambType: AmbulanceType = AmbulanceType.BASIC_LIFE_SUPPORT;
    if (requiredAmbulanceType === 'ADVANCED_LIFE_SUPPORT' || category === 'CARDIAC' || category === 'TRAUMA') {
      ambType = AmbulanceType.ADVANCED_LIFE_SUPPORT;
    } else if (requiredAmbulanceType === 'OXYGEN_SUPPORT' || category === 'RESPIRATORY') {
      ambType = AmbulanceType.OXYGEN_SUPPORT;
    }

    // Create EmergencyRequest record
    const newRequest = await prisma.emergencyRequest.create({
      data: {
        patientId: req.user.id,
        pickupLat: lat,
        pickupLng: lng,
        pickupAddress: pickupAddress || null,
        status: RequestStatus.SEARCHING,
        tripType: 'SOS',
        category: category || 'GENERAL',
        urgencyLevel: urgencyLevel || 'HIGH',
        requiredAmbulanceType: ambType,
        isDemo: Boolean(isDemo),
      },
      include: {
        patient: {
          include: { patientProfile: true },
        },
      },
    });

    // Record creation audit event
    await prisma.emergencyEvent.create({
      data: {
        requestId: newRequest.id,
        eventType: 'SOS_CREATED',
        actorId: req.user.id,
        actorRole: req.user.role,
        previousState: null,
        newState: RequestStatus.SEARCHING,
        metadata: JSON.stringify({
          pickupLat: lat,
          pickupLng: lng,
          category,
          urgencyLevel,
          ambType,
          isDemo,
        }),
        isDemo: Boolean(isDemo),
      },
    });

    // Trigger candidate discovery & ranking
    const { rankedCandidates, rankingPolicyUsed } = await discoverAndRankCandidates({
      id: newRequest.id,
      pickupLat: lat,
      pickupLng: lng,
      requiredAmbulanceType: ambType,
      isDemo: Boolean(isDemo),
      rankingPolicy: req.body.rankingPolicy,
    });

    if (rankedCandidates.length > 0) {
      // Dispatch offer to top ranked candidate
      const topCandidate = rankedCandidates[0];
      await dispatchOfferToCandidate(newRequest.id, topCandidate, 45);

      const updatedRequest = await prisma.emergencyRequest.findUnique({
        where: { id: newRequest.id },
      });

      return res.status(201).json({
        message: 'Emergency SOS initiated. Dispatch offer sent to nearest eligible verified ambulance unit.',
        request: updatedRequest,
        candidateCount: rankedCandidates.length,
        rankingPolicyUsed,
        topCandidateDistanceKm: topCandidate.distanceKm,
        officialEmergencyFallback: OFFICIAL_112_NOTICE,
      });
    } else {
      // No eligible ambulances available
      const updatedRequest = await prisma.emergencyRequest.update({
        where: { id: newRequest.id },
        data: { status: RequestStatus.NO_ELIGIBLE_AMBULANCE },
      });

      await prisma.emergencyEvent.create({
        data: {
          requestId: newRequest.id,
          eventType: 'NO_ELIGIBLE_AMBULANCE',
          actorId: 'DISPATCH_ENGINE',
          actorRole: 'SYSTEM',
          previousState: RequestStatus.SEARCHING,
          newState: RequestStatus.NO_ELIGIBLE_AMBULANCE,
          metadata: JSON.stringify({ reason: 'No eligible hospital or private operator ambulances found in pilot area.' }),
          isDemo: Boolean(isDemo),
        },
      });

      return res.status(200).json({
        message: 'No eligible ambulances are currently available in the pilot zone. Please dial official emergency 112 immediately.',
        code: 'NO_ELIGIBLE_AMBULANCE',
        request: updatedRequest,
        candidateCount: 0,
        officialEmergencyFallback: OFFICIAL_112_NOTICE,
      });
    }
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to create emergency request' });
  }
});

// -------------------------------------------------------------
// 1b. Service Area Inspection & Configuration
// -------------------------------------------------------------
router.get('/service-area', async (_req, res) => {
  try {
    const areas = await prisma.serviceArea.findMany();
    const pilotArea = areas.find((a: any) => a.isPilot) || areas[0] || {
      centerLat: 21.1458,
      centerLng: 79.0882,
      city: 'Nagpur',
      state: 'Maharashtra',
      country: 'India',
    };
    const activeCities = Array.from(new Set(areas.filter((a: any) => a.isActive).map((a: any) => a.city)));
    return res.json({
      areas,
      activeCities,
      pilotCenter: {
        lat: pilotArea.centerLat,
        lng: pilotArea.centerLng,
        city: pilotArea.city,
        state: pilotArea.state,
        country: pilotArea.country || 'India',
      },
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to retrieve service areas' });
  }
});

router.put('/service-area/:id', authenticate, authorize([Role.SUPER_ADMIN]), async (req: AuthRequest, res) => {
  const { id } = req.params;
  const { radiusKm, isActive } = req.body;

  try {
    const updated = await prisma.serviceArea.update({
      where: { id },
      data: {
        ...(radiusKm !== undefined && { radiusKm: parseFloat(radiusKm) }),
        ...(isActive !== undefined && { isActive: Boolean(isActive) }),
      },
    });

    return res.json({
      message: 'Service area boundary updated successfully',
      serviceArea: updated,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to update service area' });
  }
});

// -------------------------------------------------------------
// CONTROLLED EMERGENCY WORKFLOW TEST (SANDBOX DRILL)
// -------------------------------------------------------------
const EMERGENCY_TEST_CONTACT_PHONE = process.env.EMERGENCY_TEST_CONTACT_PHONE || '+918669202393';
const EMERGENCY_TEST_CONTACT_NAME = process.env.EMERGENCY_TEST_CONTACT_NAME || 'TEST CONTACT';

/**
 * 1. GET /api/v1/sos/test-workflow/config
 * Retrieves test contact configuration, live carrier readiness, and sandbox constraints.
 */
router.get('/test-workflow/config', authenticate, async (_req: AuthRequest, res) => {
  const carrier = getCarrierProviderStatus();
  return res.json({
    testContact: {
      phone: EMERGENCY_TEST_CONTACT_PHONE,
      name: EMERGENCY_TEST_CONTACT_NAME,
      countryCode: '+91',
      isTest: true,
      label: 'TEST CONTACT',
    },
    carrier: {
      isConfigured: carrier.isConfigured,
      provider: carrier.provider,
      fromNumber: carrier.fromNumber,
      statusMessage: carrier.isConfigured
        ? 'Live SMS carrier configured (Twilio)'
        : 'Automated carrier delivery unavailable (no live Twilio account). Mock simulation is prohibited.',
    },
    safetyGuidelines: {
      isDemoSandbox: true,
      realAmbulanceDispatched: false,
      hospitalErNotified: false,
      officialEmergencyFallback: OFFICIAL_112_NOTICE,
    },
  });
});

/**
 * 2. POST /api/v1/sos/test-workflow/initiate
 * Initiates controlled test SOS: captures coordinates, creates persistent demo record in DB,
 * generates unique test request ID, and prepares standardized test emergency notification payload.
 */
router.post('/test-workflow/initiate', authenticate, async (req: AuthRequest, res) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthorized' });

  const {
    pickupLat,
    pickupLng,
    gpsPermission = 'GRANTED',
    gpsAccuracy,
    pickupAddress,
    notes,
  } = req.body;

  const lat = typeof pickupLat === 'number' ? pickupLat : parseFloat(pickupLat);
  const lng = typeof pickupLng === 'number' ? pickupLng : parseFloat(pickupLng);

  if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({
      message: 'Invalid coordinate values. Valid GPS coordinates required for test workflow.',
      code: 'INVALID_COORDINATES',
    });
  }

  try {
    // Create persistent EmergencyRequest record in database (isolated demo record)
    const emergencyRequest = await prisma.emergencyRequest.create({
      data: {
        patientId: req.user.id,
        pickupLat: lat,
        pickupLng: lng,
        pickupAddress: pickupAddress || 'Controlled SOS Test Drill — Nagpur Location',
        category: 'EMERGENCY_TEST_WORKFLOW',
        urgencyLevel: 'TEST_DRILL',
        status: RequestStatus.PENDING,
        isDemo: true, // Strictly isolated demo / test flag
      },
    });

    const shortId = emergencyRequest.id.substring(0, 8).toUpperCase();
    const testEmergencyId = `LL-TEST-${shortId}`;
    const mapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;
    const requestTimestamp = new Date().toISOString();
    const formattedIST = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    const accuracyNumber = typeof gpsAccuracy === 'number' && !isNaN(gpsAccuracy) ? Math.round(gpsAccuracy) : null;
    const accuracySuffix = accuracyNumber !== null ? ` (Accuracy: ±${accuracyNumber}m)` : '';

    // Standardized emergency notification payload strictly complying with test format
    const notificationMessage = `[TEST ONLY] LIFELINK SOS TEST\nTest Request ID: ${testEmergencyId}\nCoordinates: ${lat.toFixed(5)}, ${lng.toFixed(5)}${accuracySuffix}\nGoogle Maps: ${mapsUrl}\nTimestamp: ${formattedIST} IST\nPatient: ${req.user.name || 'Test Patient'} (ID: ${req.user.id})\nAuthorized Recipient: ${EMERGENCY_TEST_CONTACT_NAME} (${EMERGENCY_TEST_CONTACT_PHONE})\nAmbulance Dispatch: NOT ATTEMPTED — TEST MODE\nNote: Controlled emergency test. No real dispatch triggered.`;

    // Persist audit event
    await prisma.emergencyEvent.create({
      data: {
        requestId: emergencyRequest.id,
        eventType: 'TEST_SOS_INITIATED',
        actorId: req.user.id,
        actorRole: req.user.role,
        newState: 'INITIATED',
        isDemo: true,
        metadata: JSON.stringify({
          testEmergencyId,
          gpsPermission,
          coordinates: { lat, lng },
          accuracy: accuracyNumber,
          mapsUrl,
          requestTimestamp,
          patientId: req.user.id,
          patientName: req.user.name || 'Test Patient',
          recipient: { name: EMERGENCY_TEST_CONTACT_NAME, phone: EMERGENCY_TEST_CONTACT_PHONE },
          ambulanceDispatch: 'NOT ATTEMPTED — TEST MODE',
          notificationPrepared: notificationMessage,
          userNotes: notes || null,
        }),
      },
    });

    const carrier = getCarrierProviderStatus();

    // Safe sanitized console log (no raw coordinates exposed)
    console.log(`[LifeLink Test Workflow] SOS Test Initiated: ${testEmergencyId} for User ${req.user.id} (GPS Permission: ${gpsPermission}, Accuracy: ±${accuracyNumber ?? 'N/A'}m)`);

    return res.status(201).json({
      success: true,
      requestId: emergencyRequest.id,
      testEmergencyId,
      status: 'INITIATED',
      patientId: req.user.id,
      gps: {
        permission: gpsPermission,
        lat,
        lng,
        accuracy: accuracyNumber,
        mapsUrl,
        capturedAt: requestTimestamp,
      },
      notificationPayload: {
        testEmergencyId,
        recipient: {
          name: EMERGENCY_TEST_CONTACT_NAME,
          phone: EMERGENCY_TEST_CONTACT_PHONE,
        },
        mapsUrl,
        coordinates: { lat, lng },
        accuracy: accuracyNumber,
        messageBody: notificationMessage,
        preparedAt: requestTimestamp,
        formattedIST,
        testModeDesignation: 'TEST ONLY',
      },
      carrier: {
        isConfigured: carrier.isConfigured,
        provider: carrier.provider,
      },
      dispatchStatus: 'NOT ATTEMPTED — TEST MODE',
      timestamp: requestTimestamp,
      officialEmergencyFallback: OFFICIAL_112_NOTICE,
    });
  } catch (error: any) {
    console.error('[LifeLink Test Workflow ERROR] Failed to initiate test SOS:', error);
    return res.status(500).json({
      message: error.message || 'Failed to initiate controlled test SOS',
      code: 'TEST_INITIATION_FAILED',
    });
  }
});

/**
 * 3. POST /api/v1/sos/test-workflow/send-location
 * Sends patient-approved test location coordinates to the test contact with explicit confirmation.
 * Strict safety rule: If no SMS carrier is configured, reports delivery UNAVAILABLE and NEVER simulates success.
 */
router.post('/test-workflow/send-location', authenticate, async (req: AuthRequest, res) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthorized' });

  const { requestId, confirmedByUser } = req.body;

  if (!requestId) {
    return res.status(400).json({ message: 'requestId is required.', code: 'MISSING_REQUEST_ID' });
  }

  if (!confirmedByUser) {
    return res.status(400).json({
      message: 'Explicit user confirmation is required before dispatching emergency test location.',
      code: 'CONFIRMATION_REQUIRED',
    });
  }

  try {
    const emergencyRequest = await prisma.emergencyRequest.findUnique({
      where: { id: requestId },
    });

    if (!emergencyRequest || !emergencyRequest.isDemo) {
      return res.status(404).json({
        message: 'Active emergency test record not found or not in demo sandbox mode.',
        code: 'TEST_REQUEST_NOT_FOUND',
      });
    }

    const shortId = emergencyRequest.id.substring(0, 8).toUpperCase();
    const testEmergencyId = `LL-TEST-${shortId}`;
    const lat = emergencyRequest.pickupLat;
    const lng = emergencyRequest.pickupLng;
    const mapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;
    const formattedIST = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

    // Retrieve accuracy from initiate event if logged
    const initEvent = await prisma.emergencyEvent.findFirst({
      where: { requestId: emergencyRequest.id, eventType: 'TEST_SOS_INITIATED' },
    });
    let accuracyText = '';
    if (initEvent?.metadata) {
      try {
        const meta = JSON.parse(initEvent.metadata);
        if (meta.accuracy) accuracyText = ` (Accuracy: ±${Math.round(meta.accuracy)}m)`;
      } catch {}
    }

    const messageBody = `[TEST ONLY] LIFELINK SOS TEST\nTest Request ID: ${testEmergencyId}\nCoordinates: ${lat.toFixed(5)}, ${lng.toFixed(5)}${accuracyText}\nGoogle Maps: ${mapsUrl}\nTimestamp: ${formattedIST} IST\nPatient: ${req.user.name || 'Test Patient'} (ID: ${req.user.id})\nAuthorized Recipient: ${EMERGENCY_TEST_CONTACT_NAME} (${EMERGENCY_TEST_CONTACT_PHONE})\nAmbulance Dispatch: NOT ATTEMPTED — TEST MODE\nNote: Controlled emergency test. No real dispatch triggered.`;

    // Attempt live carrier delivery (requireRealProvider = true to forbid simulated mock success)
    const smsResult = await sendSMS(EMERGENCY_TEST_CONTACT_PHONE, messageBody, {
      requireRealProvider: true,
    });

    const isCarrierLive = isSmsProviderConfigured();
    const cleanPhoneDigits = EMERGENCY_TEST_CONTACT_PHONE.replace(/\+/g, '').replace(/\D/g, '');
    const smsDeepLink = `sms:${EMERGENCY_TEST_CONTACT_PHONE}?body=${encodeURIComponent(messageBody)}`;
    const whatsappDeepLink = `https://wa.me/${cleanPhoneDigits}?text=${encodeURIComponent(messageBody)}`;

    // Log the delivery attempt in audit trail
    await prisma.emergencyEvent.create({
      data: {
        requestId: emergencyRequest.id,
        eventType: 'TEST_LOCATION_DELIVERY_ATTEMPTED',
        actorId: req.user.id,
        actorRole: req.user.role,
        newState: smsResult.success ? 'DELIVERY_SUCCESS' : 'DELIVERY_FAILED',
        isDemo: true,
        metadata: JSON.stringify({
          testEmergencyId,
          recipient: EMERGENCY_TEST_CONTACT_PHONE,
          deliveryMode: smsResult.deliveryMode,
          deliveryStatus: smsResult.deliveryStatus,
          success: smsResult.success,
          error: smsResult.error || null,
          carrierConfigured: isCarrierLive,
          provider: isCarrierLive ? 'Twilio' : 'NONE',
          timestamp: new Date().toISOString(),
        }),
      },
    });

    return res.json({
      success: smsResult.success,
      deliveryStatus: smsResult.deliveryStatus,
      deliveryMode: smsResult.deliveryMode,
      error: smsResult.error || null,
      carrierConfigured: isCarrierLive,
      carrierNotice: smsResult.success
        ? 'Emergency notification accepted by live carrier provider for delivery.'
        : 'Automated carrier delivery is unavailable because no live SMS provider (Twilio) is configured in backend environment. Simulation is prohibited.',
      recipient: {
        name: EMERGENCY_TEST_CONTACT_NAME,
        phone: EMERGENCY_TEST_CONTACT_PHONE,
      },
      location: {
        lat,
        lng,
        mapsUrl,
      },
      messageBody,
      directLinks: {
        sms: smsDeepLink,
        whatsapp: whatsappDeepLink,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[LifeLink Test Workflow ERROR] Location delivery error:', error);
    return res.status(500).json({
      message: error.message || 'Failed to execute test location delivery',
      code: 'DELIVERY_EXECUTION_ERROR',
    });
  }
});

/**
 * 4. POST /api/v1/sos/test-workflow/call-action
 * Records initiation of the telephone dialer link action.
 * Accurately logs that dialer was triggered without falsely claiming the call completed.
 */
router.post('/test-workflow/call-action', authenticate, async (req: AuthRequest, res) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthorized' });

  const { requestId } = req.body;

  if (!requestId) {
    return res.status(400).json({ message: 'requestId is required.', code: 'MISSING_REQUEST_ID' });
  }

  try {
    const emergencyRequest = await prisma.emergencyRequest.findUnique({
      where: { id: requestId },
    });

    if (!emergencyRequest || !emergencyRequest.isDemo) {
      return res.status(404).json({
        message: 'Active emergency test record not found or not in demo sandbox mode.',
        code: 'TEST_REQUEST_NOT_FOUND',
      });
    }

    const timestamp = new Date().toISOString();

    // Persist dialer trigger event
    await prisma.emergencyEvent.create({
      data: {
        requestId: emergencyRequest.id,
        eventType: 'TEST_CALL_DIALER_INITIATED',
        actorId: req.user.id,
        actorRole: req.user.role,
        newState: 'DIALER_LAUNCHED',
        isDemo: true,
        metadata: JSON.stringify({
          recipient: EMERGENCY_TEST_CONTACT_PHONE,
          recipientName: EMERGENCY_TEST_CONTACT_NAME,
          dialerUri: `tel:${EMERGENCY_TEST_CONTACT_PHONE}`,
          status: 'DIALER_LAUNCHED',
          note: 'Device telephone dialer launched via tel: protocol. Actual call completion depends on physical user placement on device.',
          timestamp,
        }),
      },
    });

    return res.json({
      success: true,
      status: 'DIALER_LAUNCHED',
      dialerUri: `tel:${EMERGENCY_TEST_CONTACT_PHONE}`,
      recipient: {
        name: EMERGENCY_TEST_CONTACT_NAME,
        phone: EMERGENCY_TEST_CONTACT_PHONE,
      },
      disclaimer:
        'Telephone dialer launched on device. Web security policies prevent automatic detection of physical call duration or connection.',
      timestamp,
    });
  } catch (error: any) {
    return res.status(500).json({
      message: error.message || 'Failed to record call action',
      code: 'CALL_ACTION_LOG_FAILED',
    });
  }
});

/**
 * 5. GET /api/v1/sos/test-workflow/results/:requestId
 * Retrieves complete audit summary and timeline for a given controlled test SOS drill.
 */
router.get('/test-workflow/results/:requestId', authenticate, async (req: AuthRequest, res) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthorized' });

  const { requestId } = req.params;

  try {
    const emergencyRequest = await prisma.emergencyRequest.findUnique({
      where: { id: requestId },
      include: {
        events: {
          orderBy: { timestamp: 'asc' },
        },
      },
    });

    if (!emergencyRequest || !emergencyRequest.isDemo) {
      return res.status(404).json({
        message: 'Controlled test record not found.',
        code: 'TEST_RECORD_NOT_FOUND',
      });
    }

    const shortId = emergencyRequest.id.substring(0, 8).toUpperCase();
    const testEmergencyId = `LL-TEST-${shortId}`;
    const lat = emergencyRequest.pickupLat;
    const lng = emergencyRequest.pickupLng;
    const mapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;

    const initiateEvent = emergencyRequest.events.find((e) => e.eventType === 'TEST_SOS_INITIATED');
    const deliveryEvent = emergencyRequest.events.find((e) => e.eventType === 'TEST_LOCATION_DELIVERY_ATTEMPTED');
    const callEvent = emergencyRequest.events.find((e) => e.eventType === 'TEST_CALL_DIALER_INITIATED');

    let initMeta: any = {};
    if (initiateEvent?.metadata) {
      try { initMeta = JSON.parse(initiateEvent.metadata); } catch {}
    }

    let deliveryMeta: any = {};
    if (deliveryEvent?.metadata) {
      try { deliveryMeta = JSON.parse(deliveryEvent.metadata); } catch {}
    }

    let callMeta: any = {};
    if (callEvent?.metadata) {
      try { callMeta = JSON.parse(callEvent.metadata); } catch {}
    }

    const carrier = getCarrierProviderStatus();

    return res.json({
      testEmergencyId,
      requestId: emergencyRequest.id,
      createdAt: emergencyRequest.createdAt,
      status: emergencyRequest.status,
      isDemo: true,
      patientId: emergencyRequest.patientId,
      // 6 Core Statuses
      sosRecordCreated: {
        status: 'CREATED',
        requestId: emergencyRequest.id,
        testEmergencyId,
        isDemo: true,
        patientId: emergencyRequest.patientId,
        createdAt: emergencyRequest.createdAt,
      },
      gpsCaptured: {
        status: 'CAPTURED',
        lat,
        lng,
        accuracy: initMeta.accuracy ?? null,
        permission: initMeta.gpsPermission || 'GRANTED',
        mapsUrl,
        timestamp: initMeta.requestTimestamp || emergencyRequest.createdAt,
      },
      notificationPrepared: {
        status: 'PREPARED',
        recipient: {
          name: EMERGENCY_TEST_CONTACT_NAME,
          phone: EMERGENCY_TEST_CONTACT_PHONE,
        },
        mapsUrl,
        messageBody: initMeta.notificationPrepared || `[TEST ONLY] LIFELINK SOS TEST\nTest Request ID: ${testEmergencyId}\nCoordinates: ${lat.toFixed(5)}, ${lng.toFixed(5)}\nGoogle Maps: ${mapsUrl}`,
        testModeDesignation: 'TEST ONLY',
        preparedAt: initMeta.requestTimestamp || emergencyRequest.createdAt,
      },
      notificationDelivered: {
        status: deliveryEvent
          ? (deliveryMeta.success ? 'DELIVERED' : 'FAILED')
          : 'NOT_ATTEMPTED',
        attempted: Boolean(deliveryEvent),
        success: deliveryMeta.success ?? false,
        deliveryStatus: deliveryMeta.deliveryStatus || 'NOT_ATTEMPTED',
        deliveryMode: deliveryMeta.deliveryMode || 'NONE',
        carrierConfigured: carrier.isConfigured,
        carrierProvider: carrier.provider,
        error: deliveryMeta.error || (!carrier.isConfigured ? 'Automatic delivery requires an integration. No live SMS carrier configured.' : null),
        timestamp: deliveryMeta.timestamp || null,
      },
      callActionInitiated: {
        status: callEvent ? 'DIALER_LAUNCHED' : 'NOT_INITIATED',
        dialerLaunched: Boolean(callEvent),
        statusLabel: callMeta.status || (callEvent ? 'DIALER_LAUNCHED' : 'NOT_INITIATED'),
        dialerUri: `tel:${EMERGENCY_TEST_CONTACT_PHONE}`,
        recipient: EMERGENCY_TEST_CONTACT_PHONE,
        timestamp: callMeta.timestamp || null,
        disclaimer: 'Device dialer triggered. Call completion requires physical placement by user on device.',
      },
      ambulanceDispatch: {
        status: 'NOT ATTEMPTED — TEST MODE',
        realAmbulanceDispatched: false,
        fakeVehiclePositionsCreated: false,
        note: 'Controlled test mode active. Real fleet dispatch strictly disabled.',
      },
      // Backwards compatible fields
      gps: {
        lat,
        lng,
        accuracy: initMeta.accuracy ?? null,
        mapsUrl,
        permission: initMeta.gpsPermission || 'GRANTED',
        capturedAt: initMeta.requestTimestamp || emergencyRequest.createdAt,
      },
      notification: {
        recipient: {
          name: EMERGENCY_TEST_CONTACT_NAME,
          phone: EMERGENCY_TEST_CONTACT_PHONE,
        },
        mapsUrl,
        preparedAt: initMeta.requestTimestamp || emergencyRequest.createdAt,
        testModeDesignation: 'TEST ONLY',
      },
      delivery: {
        attempted: Boolean(deliveryEvent),
        success: deliveryMeta.success ?? false,
        deliveryStatus: deliveryMeta.deliveryStatus || 'NOT_ATTEMPTED',
        deliveryMode: deliveryMeta.deliveryMode || 'NONE',
        carrierConfigured: carrier.isConfigured,
        carrierProvider: carrier.provider,
        error: deliveryMeta.error || null,
        timestamp: deliveryMeta.timestamp || null,
      },
      calling: {
        dialerLaunched: Boolean(callEvent),
        status: callMeta.status || (callEvent ? 'DIALER_LAUNCHED' : 'NOT_INITIATED'),
        timestamp: callMeta.timestamp || null,
        recipient: EMERGENCY_TEST_CONTACT_PHONE,
      },
      timeline: emergencyRequest.events.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        newState: e.newState,
        timestamp: e.timestamp,
        metadata: e.metadata ? JSON.parse(e.metadata) : null,
      })),
      safetyStatus: {
        zeroRealAmbulancesDispatched: true,
        zeroHospitalErNotified: true,
        nationalEmergencyFallback: OFFICIAL_112_NOTICE,
      },
    });
  } catch (error: any) {
    return res.status(500).json({
      message: error.message || 'Failed to retrieve test workflow results',
      code: 'RESULTS_FETCH_FAILED',
    });
  }
});

// -------------------------------------------------------------
// 2. View Emergency Request Details with Role Authorization
// -------------------------------------------------------------
router.get('/:id', authenticate, async (req: AuthRequest, res) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthorized' });

  const { id } = req.params;
  const user = req.user;

  try {
    const request = await prisma.emergencyRequest.findUnique({
      where: { id },
      include: {
        patient: {
          select: { id: true, name: true, phone: true, patientProfile: true },
        },
        driver: {
          select: { id: true, name: true, phone: true },
        },
        ambulance: true,
        hospital: true,
        operator: true,
        trip: {
          include: { events: true },
        },
        dispatchAttempts: true,
      },
    });

    if (!request) {
      return res.status(404).json({ message: 'Emergency request not found' });
    }

    // Role Authorization Boundaries (Section 10 & 16)
    let isAuthorized = false;

    if (user.role === Role.SUPER_ADMIN) {
      isAuthorized = true;
    } else if (user.role === Role.PATIENT && request.patientId === user.id) {
      isAuthorized = true;
    } else if (user.role === Role.DRIVER) {
      // Driver is authorized if assigned to the request or offered an attempt
      if (request.driverId === user.id) {
        isAuthorized = true;
      } else {
        const hasAttempt = request.dispatchAttempts?.some(
          (a: any) => a.driverId === user.id
        );
        if (hasAttempt) isAuthorized = true;
      }
    } else if (user.role === Role.ADMIN_HOSPITAL) {
      // Hospital admin is authorized only if linked to the request's hospital
      const hospital = await prisma.hospital.findUnique({
        where: { adminUserId: user.id },
      });
      if (hospital && request.hospitalId === hospital.id) {
        isAuthorized = true;
      }
    } else if (user.role === Role.OPERATOR_ADMIN) {
      // Operator admin is authorized only if linked to the request's operator
      const operator = await prisma.ambulanceOperator.findUnique({
        where: { adminUserId: user.id },
      });
      if (operator && request.operatorId === operator.id) {
        isAuthorized = true;
      }
    }

    if (!isAuthorized) {
      return res.status(403).json({
        message: 'Access forbidden: You do not have permission to view this emergency record.',
        code: 'FORBIDDEN_EMERGENCY_ACCESS',
      });
    }

    return res.json({
      request,
      officialEmergencyFallback: OFFICIAL_112_NOTICE,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to retrieve emergency details' });
  }
});

// -------------------------------------------------------------
// 3. Patient Cancellation with Explicit Lifecycle Rules
// -------------------------------------------------------------
router.post('/:id/cancel', authenticate, async (req: AuthRequest, res) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthorized' });

  const { id } = req.params;
  const { reason = 'Cancelled by patient' } = req.body;

  try {
    const request = await prisma.emergencyRequest.findUnique({
      where: { id },
      include: { ambulance: true, trip: true },
    });

    if (!request) {
      return res.status(404).json({ message: 'Emergency request not found' });
    }

    // Only requesting patient or super admin can cancel
    if (request.patientId !== req.user.id && req.user.role !== Role.SUPER_ADMIN) {
      return res.status(403).json({ message: 'Only the requesting patient may cancel this SOS request' });
    }

    // State rule: CANNOT cancel once patient is picked up, in transit, or completed
    const nonCancellableStates: RequestStatus[] = [
      RequestStatus.PATIENT_PICKED_UP,
      RequestStatus.IN_TRANSIT,
      RequestStatus.AT_HOSPITAL,
      RequestStatus.AT_DESTINATION,
      RequestStatus.COMPLETED,
      RequestStatus.CANCELLED,
    ];

    if (nonCancellableStates.includes(request.status)) {
      return res.status(400).json({
        message: `Request cannot be cancelled in its current state: ${request.status}`,
        code: 'CANCELLATION_NOT_ALLOWED',
      });
    }

    // Transactional cancellation
    const updated = await prisma.$transaction(async (tx: any) => {
      const updatedReq = await tx.emergencyRequest.update({
        where: { id },
        data: {
          status: RequestStatus.CANCELLED,
        },
      });

      // Free up assigned ambulance if one was committed
      if (request.ambulanceId) {
        await tx.ambulance.update({
          where: { id: request.ambulanceId },
          data: { isAvailable: true },
        });
      }

      // Update trip if active
      if (request.trip) {
        await tx.emergencyTrip.update({
          where: { id: request.trip.id },
          data: {
            status: TripLifecycleStatus.CANCELLED,
            cancelledAt: new Date(),
            cancelReason: reason,
          },
        });
      }

      // Record cancellation event
      await tx.emergencyEvent.create({
        data: {
          requestId: id,
          tripId: request.trip?.id || null,
          eventType: 'REQUEST_CANCELLED',
          actorId: req.user!.id,
          actorRole: req.user!.role,
          previousState: request.status,
          newState: RequestStatus.CANCELLED,
          metadata: JSON.stringify({ reason }),
          isDemo: request.isDemo,
        },
      });

      return updatedReq;
    });

    // Broadcast cancellation
    const io = getIO();
    if (io) {
      if (request.driverId) {
        io.to(`driver:${request.driverId}`).emit('emergency:cancelled', {
          requestId: id,
          reason,
        });
      }
      if (request.hospitalId) {
        io.to(`hospital:${request.hospitalId}`).emit('emergency:cancelled', {
          requestId: id,
          reason,
        });
      }
      if (request.operatorId) {
        io.to(`operator:${request.operatorId}`).emit('emergency:cancelled', {
          requestId: id,
          reason,
        });
      }
      io.to('super_admin_room').emit('telemetry:update');
    }

    return res.json({
      message: 'Emergency request successfully cancelled.',
      request: updated,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to cancel emergency request' });
  }
});

// -------------------------------------------------------------
// 4. Driver Offer Acceptance (Atomic & Concurrency-Safe)
// -------------------------------------------------------------
router.post('/offers/:attemptId/accept', authenticate, authorize([Role.DRIVER]), async (req: AuthRequest, res) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthorized' });

  const { attemptId } = req.params;

  try {
    const result = await atomicallyAcceptOffer(attemptId, req.user.id);
    if (!result.success) {
      if (result.code === 'OFFER_NOT_OFFERED') {
        const attempt = await prisma.dispatchAttempt.findUnique({ where: { id: attemptId } });
        if (attempt && attempt.driverId === req.user.id && attempt.status === DispatchAttemptStatus.ACCEPTED) {
          const existingTrip = await prisma.emergencyTrip.findFirst({
            where: { requestId: attempt.requestId, driverId: req.user.id },
            include: { ambulance: true, driver: true, request: true },
          });
          if (existingTrip) {
            return res.json({
              message: 'Offer already accepted. Reconnecting to active trip.',
              trip: existingTrip,
              isIdempotentReplay: true,
            });
          }
        }
      }
      const statusCode = result.code === 'CONCURRENCY_LOCK' || result.code === 'REQUEST_ALREADY_ASSIGNED' ? 409 : 400;
      return res.status(statusCode).json({
        message: result.error,
        code: result.code,
      });
    }

    return res.json({
      message: 'Offer accepted successfully. Proceed to patient pickup.',
      trip: result.trip,
      isIdempotentReplay: false,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to accept offer' });
  }
});

// -------------------------------------------------------------
// 5. Driver Offer Rejection / Timeout Escalation
// -------------------------------------------------------------
router.post('/offers/:attemptId/reject', authenticate, authorize([Role.DRIVER]), async (req: AuthRequest, res) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthorized' });

  const { attemptId } = req.params;
  const { reason = 'Driver declined' } = req.body;

  try {
    const attempt = await prisma.dispatchAttempt.findUnique({
      where: { id: attemptId },
    });

    if (!attempt) {
      return res.status(404).json({ message: 'Offer not found' });
    }

    if (attempt.driverId !== req.user.id) {
      return res.status(403).json({ message: 'You are not authorized to reject this offer' });
    }

    const escalationResult = await rejectOrExpireOffer(attemptId, req.user.id, 'REJECT', reason);

    return res.json({
      message: 'Offer rejected. Candidate escalation initiated.',
      escalation: escalationResult,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to reject offer' });
  }
});

// -------------------------------------------------------------
// 6. Driver Trip Lifecycle State Transition
// -------------------------------------------------------------
router.post('/trips/:tripId/status', authenticate, authorize([Role.DRIVER]), async (req: AuthRequest, res) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthorized' });

  const { tripId } = req.params;
  const { status } = req.body;

  const validStatuses: TripLifecycleStatus[] = [
    TripLifecycleStatus.AMBULANCE_ARRIVING,
    TripLifecycleStatus.PATIENT_PICKED_UP,
    TripLifecycleStatus.IN_TRANSIT,
    TripLifecycleStatus.AT_DESTINATION,
    TripLifecycleStatus.COMPLETED,
  ];

  if (!validStatuses.includes(status)) {
    return res.status(400).json({
      message: `Invalid trip status. Allowed values: ${validStatuses.join(', ')}`,
      code: 'INVALID_TRIP_STATUS',
    });
  }

  try {
    const trip = await prisma.emergencyTrip.findUnique({
      where: { id: tripId },
      include: { ambulance: true, request: true },
    });

    if (!trip) {
      return res.status(404).json({ message: 'Emergency trip not found' });
    }

    if (trip.driverId !== req.user.id) {
      return res.status(403).json({ message: 'You are not authorized to update this trip' });
    }

    const isCompleted = status === TripLifecycleStatus.COMPLETED;
    const isArrived = status === TripLifecycleStatus.AMBULANCE_ARRIVING;
    const isPickedUp = status === TripLifecycleStatus.PATIENT_PICKED_UP;

    const updated = await prisma.$transaction(async (tx: any) => {
      // 1. Update trip record
      const updateData: any = {
        status,
        updatedAt: new Date(),
      };
      if (isArrived && !trip.arrivedAt) updateData.arrivedAt = new Date();
      if (isPickedUp && !trip.pickedUpAt) updateData.pickedUpAt = new Date();
      if (isCompleted) updateData.completedAt = new Date();

      const updatedTrip = await tx.emergencyTrip.update({
        where: { id: tripId },
        data: updateData,
      });

      // 2. Synchronize EmergencyRequest status
      let reqStatus: RequestStatus = RequestStatus.IN_TRANSIT;
      if (status === TripLifecycleStatus.AMBULANCE_ARRIVING) reqStatus = RequestStatus.AMBULANCE_ARRIVING;
      if (status === TripLifecycleStatus.PATIENT_PICKED_UP) reqStatus = RequestStatus.PATIENT_PICKED_UP;
      if (status === TripLifecycleStatus.AT_DESTINATION) reqStatus = RequestStatus.AT_DESTINATION;
      if (status === TripLifecycleStatus.COMPLETED) reqStatus = RequestStatus.COMPLETED;

      await tx.emergencyRequest.update({
        where: { id: trip.requestId },
        data: {
          status: reqStatus,
          completedAt: isCompleted ? new Date() : null,
        },
      });

      // 3. If trip completed, free up the vehicle
      if (isCompleted) {
        await tx.ambulance.update({
          where: { id: trip.ambulanceId },
          data: { isAvailable: true },
        });
      }

      // 4. Record event
      await tx.emergencyEvent.create({
        data: {
          requestId: trip.requestId,
          tripId: trip.id,
          eventType: `TRIP_${status}`,
          actorId: req.user!.id,
          actorRole: 'DRIVER',
          previousState: trip.status,
          newState: status,
          metadata: JSON.stringify({ timestamp: new Date() }),
          isDemo: trip.isDemo,
        },
      });

      return updatedTrip;
    });

    // Real-time broadcast
    const io = getIO();
    if (io) {
      io.to(`patient:${trip.request.patientId}`).emit('trip:status_changed', {
        tripId,
        status,
        driverId: req.user.id,
        isDemo: trip.isDemo,
      });

      if (trip.hospitalId) {
        io.to(`hospital:${trip.hospitalId}`).emit('trip:status_changed', {
          tripId,
          status,
          isDemo: trip.isDemo,
        });

        // Dedicated Hospital Arrival Notification (Module D4 & F4)
        io.to(`hospital:${trip.hospitalId}`).emit('hospital:incoming_ambulance', {
          tripId,
          requestId: trip.requestId,
          status,
          driverId: req.user.id,
          ambulanceId: trip.ambulanceId,
          vehicleNumber: trip.ambulance.vehicleNumber,
          isDemo: trip.isDemo,
          timestamp: new Date().toISOString(),
        });
      }

      if (trip.operatorId) {
        io.to(`operator:${trip.operatorId}`).emit('trip:status_changed', {
          tripId,
          status,
          isDemo: trip.isDemo,
        });
      }

      io.to('super_admin_room').emit('telemetry:update');

      // Propagate milestone to active emergency trip share rooms
      try {
        const isTerminal = status === TripLifecycleStatus.COMPLETED || status === 'CANCELLED';
        if (isTerminal) {
          await prisma.emergencyTripShare.updateMany({
            where: { requestId: trip.requestId, status: 'ACTIVE' },
            data: { status: status === TripLifecycleStatus.COMPLETED ? 'COMPLETED' : 'CANCELLED' },
          });
        }

        const activeShares = await prisma.emergencyTripShare.findMany({
          where: { requestId: trip.requestId },
        });

        for (const s of activeShares) {
          io.to(`trip_share:${s.shareToken}`).emit('trip_share:milestone_updated', {
            shareToken: s.shareToken,
            status,
            milestone: status,
            isTerminal,
            timestamp: new Date().toISOString(),
          });
        }

        // Notify trusted contacts of milestones
        const patientUser = await prisma.user.findUnique({ where: { id: trip.request.patientId } });
        if (patientUser) {
          await notifyTrustedContactsOfTripMilestone({
            patientId: patientUser.id,
            patientName: patientUser.name,
            requestId: trip.requestId,
            milestone: status,
            message: `Emergency trip status updated to ${status}.`,
            shareToken: activeShares.length > 0 ? activeShares[0].shareToken : undefined,
          });
        }
      } catch {
        // Non-blocking for primary dispatch lifecycle
      }
    }

    return res.json({
      message: `Trip lifecycle updated to ${status}`,
      trip: updated,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to update trip status' });
  }
});

// -------------------------------------------------------------
// 6b. Emergency Trip Reassignment (Auditable & Escalating)
// -------------------------------------------------------------
router.post(
  '/trips/:tripId/reassign',
  authenticate,
  authorize([Role.SUPER_ADMIN, Role.ADMIN_HOSPITAL, Role.OPERATOR_ADMIN]),
  async (req: AuthRequest, res) => {
    if (!req.user) return res.status(401).json({ message: 'Unauthorized' });

    const { tripId } = req.params;
    const { reason = 'Emergency reassignment requested' } = req.body;

    try {
      const trip = await prisma.emergencyTrip.findUnique({
        where: { id: tripId },
      });

      if (!trip) {
        return res.status(404).json({ message: 'Emergency trip not found' });
      }

      // Check tenant isolation
      if (req.user.role === Role.ADMIN_HOSPITAL) {
        const hosp = await prisma.hospital.findUnique({ where: { adminUserId: req.user.id } });
        if (!hosp || trip.hospitalId !== hosp.id) {
          return res.status(403).json({ message: 'Forbidden: You can only reassign trips belonging to your hospital' });
        }
      } else if (req.user.role === Role.OPERATOR_ADMIN) {
        const op = await prisma.ambulanceOperator.findUnique({ where: { adminUserId: req.user.id } });
        if (!op || trip.operatorId !== op.id) {
          return res.status(403).json({ message: 'Forbidden: You can only reassign trips belonging to your private operator' });
        }
      }

      const result = await reassignTripSafely(tripId, req.user.id, req.user.role, reason);

      if (!result.success) {
        return res.status(400).json({ message: result.error });
      }

      return res.json({
        message: result.message,
        newOfferDispatched: result.newOfferDispatched,
      });
    } catch (error: any) {
      return res.status(500).json({ message: error.message || 'Failed to reassign trip' });
    }
  }
);

// -------------------------------------------------------------
// 7. Driver Location Ping (Authenticated & Validated with Movement Calculation)
// -------------------------------------------------------------
const handleTripLocationPing = async (req: AuthRequest, res: any) => {
  if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });

  // Only drivers can push location pings
  if (req.user.role !== Role.DRIVER) {
    return res.status(403).json({ success: false, message: 'Forbidden: Only drivers can push location telemetry' });
  }

  const { tripId } = req.params;
  const rawLat = req.body.latitude !== undefined ? req.body.latitude : req.body.lat;
  const rawLng = req.body.longitude !== undefined ? req.body.longitude : req.body.lng;

  const latitude = parseFloat(rawLat);
  const longitude = parseFloat(rawLng);

  if (isNaN(latitude) || isNaN(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return res.status(400).json({ success: false, message: 'Invalid GPS coordinates', error: 'Invalid GPS coordinates', code: 'INVALID_COORDINATES' });
  }

  try {
    const trip = await prisma.emergencyTrip.findUnique({
      where: { id: tripId },
      include: { ambulance: true, request: true },
    });

    if (!trip) {
      return res.status(404).json({ success: false, error: 'Emergency trip not found', message: 'Emergency trip not found' });
    }

    if (trip.driverId !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Forbidden', message: 'You are not the assigned driver for this trip' });
    }

    // Calculate movement status based on successive GPS observations (Module E1 & E2)
    const prevLat = trip.ambulance.currentLat;
    const prevLng = trip.ambulance.currentLng;
    const prevTime = trip.ambulance.lastUpdated ? new Date(trip.ambulance.lastUpdated).getTime() : 0;
    const nowTime = Date.now();

    const clientSpeed = req.body.speedKmH !== undefined ? parseFloat(req.body.speedKmH) : undefined;
    let movementStatus = 'UNKNOWN';
    let speedKmH = 0;

    if (clientSpeed !== undefined && !isNaN(clientSpeed)) {
      speedKmH = clientSpeed;
      movementStatus = speedKmH > 3.0 ? 'MOVING' : 'STOPPED';
    } else if (prevTime > 0) {
      const elapsedMs = nowTime - prevTime;
      if (elapsedMs > 30 * 60 * 1000) {
        // Telemetry is stale (> 30 min) -> OFFLINE/UNKNOWN, never falsely inferred as STOPPED
        movementStatus = 'UNKNOWN';
        speedKmH = 0;
      } else if (elapsedMs >= 1000) {
        const timeHours = elapsedMs / (1000 * 3600);
        const distKm = calculateHaversineDistanceKm(prevLat, prevLng, latitude, longitude);
        if (timeHours > 0) {
          speedKmH = Math.round((distKm / timeHours) * 10) / 10;
          movementStatus = speedKmH > 3.0 ? 'MOVING' : 'STOPPED';
        }
      }
    } else {
      // First observation without speed sensor data: cannot infer STOPPED
      movementStatus = 'UNKNOWN';
    }

    // Update ambulance location, movement status, and speed in DB
    const updatedAmbulance = await prisma.ambulance.update({
      where: { id: trip.ambulanceId },
      data: {
        currentLat: latitude,
        currentLng: longitude,
        movementStatus,
        speedKmH,
        lastUpdated: new Date(),
      },
    });

    // Broadcast location ping
    const io = getIO();
    if (io) {
      const payload = {
        driverId: req.user.id,
        lat: latitude,
        lng: longitude,
        vehicleNumber: updatedAmbulance.vehicleNumber,
        isDemo: trip.isDemo,
        movementStatus,
        speedKmH,
        timestamp: new Date().toISOString(),
      };

      io.to(`patient:${trip.request.patientId}`).emit('ambulance:location', payload);

      if (trip.hospitalId) {
        io.to(`hospital:${trip.hospitalId}`).emit('ambulance:location', payload);
      }
      if (trip.operatorId) {
        io.to(`operator:${trip.operatorId}`).emit('ambulance:location', payload);
      }
      io.to('super_admin_room').emit('telemetry:driver_moved', payload);

      // Broadcast to active authorized emergency trip share rooms
      try {
        const activeShares = await prisma.emergencyTripShare.findMany({
          where: { requestId: trip.requestId, status: 'ACTIVE' },
        });
        for (const s of activeShares) {
          if (s.allowLiveLocation) {
            io.to(`trip_share:${s.shareToken}`).emit('trip_share:location_updated', {
              lat: latitude,
              lng: longitude,
              movementStatus,
              speedKmH,
              timestamp: new Date().toISOString(),
            });
          }
        }
      } catch {
        // Non-blocking
      }
    }

    return res.json({
      success: true,
      lat: latitude,
      lng: longitude,
      movementStatus,
      speedKmH,
      isDemo: trip.isDemo,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to update driver location' });
  }
};

router.post(['/trips/:tripId/location', '/trips/:tripId/location/ping'], authenticate, handleTripLocationPing);
router.patch(['/trips/:tripId/location', '/trips/:tripId/location/ping'], authenticate, handleTripLocationPing);

// 8. Authorized Trip Location Retrieval (Patient & Involved Stakeholders)
router.get('/trips/:tripId/location', authenticate, async (req: AuthRequest, res) => {
  if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });

  const { tripId } = req.params;

  try {
    const trip = await prisma.emergencyTrip.findUnique({
      where: { id: tripId },
      include: {
        ambulance: true,
        request: true,
      },
    });

    if (!trip) {
      return res.status(404).json({ success: false, error: 'Emergency trip not found' });
    }

    // Authorization: Patient involved, Assigned Driver, Hospital Admin, Operator Admin, or Super Admin
    const isPatient = trip.request.patientId === req.user.id;
    const isDriver = trip.driverId === req.user.id;
    const isSuperAdmin = req.user.role === Role.SUPER_ADMIN;
    let isHospitalAdmin = false;
    let isOperatorAdmin = false;

    if (req.user.role === Role.ADMIN_HOSPITAL && trip.hospitalId) {
      const hosp = await prisma.hospital.findUnique({ where: { adminUserId: req.user.id } });
      isHospitalAdmin = !!hosp && hosp.id === trip.hospitalId;
    }
    if (req.user.role === Role.OPERATOR_ADMIN && trip.operatorId) {
      const op = await prisma.ambulanceOperator.findUnique({ where: { adminUserId: req.user.id } });
      isOperatorAdmin = !!op && op.id === trip.operatorId;
    }

    if (!isPatient && !isDriver && !isSuperAdmin && !isHospitalAdmin && !isOperatorAdmin) {
      return res.status(403).json({ success: false, error: 'Forbidden: You do not have permission to track this trip' });
    }

    // Telemetry freshness
    const lastUpdatedMs = trip.ambulance.lastUpdated ? new Date(trip.ambulance.lastUpdated).getTime() : 0;
    const nowMs = Date.now();
    const ageSeconds = lastUpdatedMs > 0 ? Math.round((nowMs - lastUpdatedMs) / 1000) : 999999;
    const isStale = ageSeconds > 1800; // >30m

    return res.json({
      success: true,
      tripId: trip.id,
      status: trip.status,
      vehicleNumber: trip.ambulance.vehicleNumber,
      ambulanceType: trip.ambulance.ambulanceType,
      currentLat: trip.ambulance.currentLat,
      currentLng: trip.ambulance.currentLng,
      pickupLat: trip.request.pickupLat,
      pickupLng: trip.request.pickupLng,
      movementStatus: isStale ? 'UNKNOWN' : (trip.ambulance.movementStatus || 'STOPPED'),
      speedKmH: isStale ? 0 : (trip.ambulance.speedKmH || 0),
      dataFreshness: trip.isDemo ? 'SIMULATED' : (isStale ? 'STALE' : 'LIVE'),
      lastUpdated: trip.ambulance.lastUpdated,
      ageSeconds,
      isDemo: trip.isDemo,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message || 'Failed to retrieve trip location' });
  }
});

// -------------------------------------------------------------

// -------------------------------------------------------------
// 9. Fleet Dashboards: Hospital & Operator Supply Channels
// -------------------------------------------------------------
router.get('/fleet/hospital', authenticate, authorize([Role.ADMIN_HOSPITAL, Role.SUPER_ADMIN]), async (req: AuthRequest, res) => {
  try {
    const hospital = await prisma.hospital.findUnique({
      where: { adminUserId: req.user!.id },
    });

    if (!hospital && req.user!.role !== Role.SUPER_ADMIN) {
      return res.status(404).json({ message: 'No hospital organization linked to this administrator' });
    }

    const hospitalId = hospital?.id;
    const ambulances = await prisma.ambulance.findMany({
      where: hospitalId ? { hospitalId } : undefined,
      include: {
        driver: {
          include: { driverProfile: true },
        },
        assignments: true,
      },
    });

    const activeRequests = await prisma.emergencyRequest.findMany({
      where: {
        hospitalId: hospitalId || undefined,
        status: {
          notIn: [RequestStatus.COMPLETED, RequestStatus.CANCELLED, RequestStatus.REJECTED],
        },
      },
      include: {
        patient: { select: { name: true, phone: true } },
        driver: { select: { name: true, phone: true } },
      },
    });

    return res.json({
      hospital,
      ambulances,
      activeRequests,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to load hospital fleet' });
  }
});

router.get('/fleet/operator', authenticate, authorize([Role.OPERATOR_ADMIN, Role.SUPER_ADMIN]), async (req: AuthRequest, res) => {
  try {
    const operator = await prisma.ambulanceOperator.findUnique({
      where: { adminUserId: req.user!.id },
    });

    if (!operator && req.user!.role !== Role.SUPER_ADMIN) {
      return res.status(404).json({ message: 'No ambulance operator linked to this administrator' });
    }

    const operatorId = operator?.id;
    const ambulances = await prisma.ambulance.findMany({
      where: operatorId ? { operatorId } : undefined,
      include: {
        driver: {
          include: { driverProfile: true },
        },
        assignments: true,
      },
    });

    const activeRequests = await prisma.emergencyRequest.findMany({
      where: {
        operatorId: operatorId || undefined,
        status: {
          notIn: [RequestStatus.COMPLETED, RequestStatus.CANCELLED, RequestStatus.REJECTED],
        },
      },
      include: {
        patient: { select: { name: true, phone: true } },
        driver: { select: { name: true, phone: true } },
      },
    });

    return res.json({
      operator,
      ambulances,
      activeRequests,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to load operator fleet' });
  }
});

// POST /api/v1/sos/fleet/operator/ambulances - Private Operator registers an ambulance
router.post('/fleet/operator/ambulances', authenticate, authorize([Role.OPERATOR_ADMIN, Role.SUPER_ADMIN]), async (req: AuthRequest, res) => {
  const { vehicleNumber, ambulanceType, lat, lng } = req.body;

  if (!vehicleNumber || !ambulanceType) {
    return res.status(400).json({ message: 'vehicleNumber and ambulanceType are required' });
  }

  try {
    let operator = null;
    if (req.user!.role === Role.OPERATOR_ADMIN) {
      operator = await prisma.ambulanceOperator.findUnique({
        where: { adminUserId: req.user!.id },
      });
      if (!operator) {
        return res.status(404).json({ message: 'Ambulance operator organization not found' });
      }
    } else {
      const opId = req.body.operatorId;
      operator = await prisma.ambulanceOperator.findUnique({ where: { id: opId } });
      if (!operator) {
        return res.status(404).json({ message: 'Target operator organization not found' });
      }
    }

    const existing = await prisma.ambulance.findFirst({ where: { vehicleNumber } });
    if (existing) {
      return res.status(400).json({ message: 'Vehicle number already registered' });
    }

    const newAmbulance = await prisma.ambulance.create({
      data: {
        vehicleNumber,
        ambulanceType,
        operatorId: operator.id,
        isAvailable: false,
        currentLat: lat !== undefined ? parseFloat(lat) : 21.1458,
        currentLng: lng !== undefined ? parseFloat(lng) : 79.0882,
        verificationState: VerificationState.PENDING_REVIEW,
      },
    });

    return res.status(201).json(newAmbulance);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to register operator ambulance' });
  }
});

// PUT /api/v1/sos/fleet/operator/ambulances/:id - Private Operator updates vehicle / assigns driver
router.put('/fleet/operator/ambulances/:id', authenticate, authorize([Role.OPERATOR_ADMIN, Role.SUPER_ADMIN]), async (req: AuthRequest, res) => {
  const { id } = req.params;
  const { driverId, maintenanceStatus, isAvailable } = req.body;

  try {
    const ambulance = await prisma.ambulance.findUnique({ where: { id } });
    if (!ambulance) {
      return res.status(404).json({ message: 'Ambulance not found' });
    }

    // Operator Tenant Isolation: Operator Admin cannot modify vehicles of another operator or hospital
    if (req.user!.role === Role.OPERATOR_ADMIN) {
      const operator = await prisma.ambulanceOperator.findUnique({
        where: { adminUserId: req.user!.id },
      });
      if (!operator || ambulance.operatorId !== operator.id) {
        return res.status(403).json({
          status: 'fail',
          code: 'UNAUTHORIZED_OPERATOR_ACCESS',
          message: 'Forbidden: You are not authorized to manage operations for another private ambulance operator.',
        });
      }

      // If assigning a driver, verify driver belongs to this operator's roster
      if (driverId) {
        const driver = await prisma.user.findFirst({
          where: { id: driverId, operatorId: operator.id, role: Role.DRIVER },
        });
        if (!driver) {
          return res.status(400).json({
            status: 'fail',
            code: 'DRIVER_NOT_IN_ROSTER',
            message: 'Target driver is not in your private operator roster.',
          });
        }
      }
    }

    const updated = await prisma.ambulance.update({
      where: { id },
      data: {
        ...(driverId !== undefined && { driverId: driverId || null }),
        ...(maintenanceStatus !== undefined && { maintenanceStatus }),
        ...(isAvailable !== undefined && { isAvailable: Boolean(isAvailable) }),
      },
    });

    return res.json(updated);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to update operator ambulance' });
  }
});

// PUT /api/v1/sos/fleet/operator/drivers/:id - Private Operator manages driver roster
router.put('/fleet/operator/drivers/:id', authenticate, authorize([Role.OPERATOR_ADMIN, Role.SUPER_ADMIN]), async (req: AuthRequest, res) => {
  const { id } = req.params;
  const { membershipStatus } = req.body;

  try {
    const driverProfile = await prisma.driverProfile.findUnique({ where: { id } });
    if (!driverProfile) {
      return res.status(404).json({ message: 'Driver profile not found' });
    }

    // Operator Tenant Isolation
    if (req.user!.role === Role.OPERATOR_ADMIN) {
      const operator = await prisma.ambulanceOperator.findUnique({
        where: { adminUserId: req.user!.id },
      });
      if (!operator || driverProfile.operatorId !== operator.id) {
        return res.status(403).json({
          status: 'fail',
          code: 'UNAUTHORIZED_OPERATOR_ACCESS',
          message: 'Forbidden: You are not authorized to manage drivers for another private operator.',
        });
      }
    }

    const updated = await prisma.driverProfile.update({
      where: { id },
      data: {
        ...(membershipStatus !== undefined && { membershipStatus }),
      },
    });

    return res.json(updated);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to update operator driver' });
  }
});

// -------------------------------------------------------------
// 10. Driver Dashboard Operational Status
// -------------------------------------------------------------
router.get('/driver/dashboard', authenticate, authorize([Role.DRIVER]), async (req: AuthRequest, res) => {
  try {
    const driverId = req.user!.id;

    // Driver Profile & Verification
    const profile = await prisma.driverProfile.findUnique({
      where: { userId: driverId },
      include: {
        hospital: true,
        operator: true,
        assignments: {
          include: { ambulance: true },
        },
      },
    });

    // Assigned Ambulance
    const ambulance = await prisma.ambulance.findUnique({
      where: { driverId },
      include: { hospital: true, operator: true },
    });

    // Pending incoming offers for this driver
    const pendingOffers = await prisma.dispatchAttempt.findMany({
      where: {
        driverId,
        status: DispatchAttemptStatus.OFFERED,
      },
      include: {
        request: {
          include: {
            patient: {
              select: { name: true, phone: true },
            },
          },
        },
      },
    });

    // Active Trip (if any)
    const activeTrip = await prisma.emergencyTrip.findFirst({
      where: {
        driverId,
        status: {
          in: [
            TripLifecycleStatus.ACCEPTED,
            TripLifecycleStatus.AMBULANCE_ARRIVING,
            TripLifecycleStatus.PATIENT_PICKED_UP,
            TripLifecycleStatus.IN_TRANSIT,
            TripLifecycleStatus.AT_DESTINATION,
          ],
        },
      },
      include: {
        request: {
          include: {
            patient: { select: { name: true, phone: true } },
          },
        },
        ambulance: true,
      },
    });

    return res.json({
      driver: {
        id: req.user!.id,
        name: req.user!.name,
        phone: (req.user as any).phone || '',
        email: req.user!.email,
      },
      profile,
      ambulance,
      pendingOffers,
      activeTrip,
      officialEmergencyFallback: OFFICIAL_112_NOTICE,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to load driver dashboard' });
  }
});

export default router;
