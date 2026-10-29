import prisma from '../db';
import { RequestStatus, DispatchAttemptStatus, TripLifecycleStatus, AmbulanceType } from '@prisma/client';
import { getIO } from '../socket';
import { notifyDispatchOffer } from './notificationService';
import { metrics } from '../utils/metrics';
import { logger } from '../utils/logger';

// Haversine formula to calculate straight-line geographic distance in kilometers
export function calculateHaversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's mean radius in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return parseFloat((R * c).toFixed(2));
}

export interface EligibilityResult {
  eligible: boolean;
  denialReasons: string[];
}

export interface CandidateVehicle {
  ambulance: any;
  driver: any;
  driverProfile: any;
  organization: {
    type: 'HOSPITAL' | 'PRIVATE_OPERATOR';
    id: string;
    name: string;
    verificationState: string;
    isDemo: boolean;
  };
  distanceKm?: number;
  isStraightLine?: boolean;
  distanceType?: 'STRAIGHT_LINE_HAVERSINE' | 'ROAD_NETWORK_ROUTING';
  distanceLabel?: string;
  estimatedTravelMinutes?: number;
  etaMethod?: string;
  etaDisclaimer?: string;
  capabilityScore?: number;
}

export type RankingPolicy = 'DISTANCE_FIRST' | 'CAPABILITY_FIRST' | 'BALANCED_POLICY';

// -------------------------------------------------------------
// 1. Service Area & Geofence Verification (Multi-City Dynamic)
// -------------------------------------------------------------
export async function checkServiceArea(
  lat: number,
  lng: number,
  options?: {
    requiredAmbulanceType?: AmbulanceType | string;
    organizationId?: string;
  }
): Promise<{
  inArea: boolean;
  serviceArea?: any;
  reason?: string;
  distanceFromCenterKm?: number;
}> {
  // Validate coordinates
  if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { inArea: false, reason: 'INVALID_COORDINATES' };
  }

  // Retrieve active service areas
  let activeAreas = await prisma.serviceArea.findMany({
    where: { isActive: true },
  });

  if (!activeAreas || activeAreas.length === 0) {
    // Default fallback to Nagpur Pilot Center if no DB records exist
    const defaultPilotArea = {
      id: 'nagpur-pilot-service-area',
      name: 'Nagpur Pilot Zone',
      city: 'Nagpur',
      state: 'Maharashtra',
      country: 'India',
      centerLat: 21.1458,
      centerLng: 79.0882,
      radiusKm: 30.0,
      isActive: true,
      isPilot: true,
      metadata: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    activeAreas = [defaultPilotArea];
  }

  let matchingArea: any = null;
  let closestArea: any = null;
  let minDistance = Infinity;

  for (const area of activeAreas) {
    const dist = calculateHaversineDistanceKm(lat, lng, area.centerLat, area.centerLng);
    if (dist < minDistance) {
      minDistance = dist;
      closestArea = area;
    }

    if (dist <= area.radiusKm) {
      // Check service area rules if metadata defines constraints
      if (area.metadata) {
        try {
          const meta = typeof area.metadata === 'string' ? JSON.parse(area.metadata) : area.metadata;
          if (meta) {
            // Check ambulance category rule
            if (options?.requiredAmbulanceType && Array.isArray(meta.allowedAmbulanceTypes) && meta.allowedAmbulanceTypes.length > 0) {
              if (!meta.allowedAmbulanceTypes.includes(options.requiredAmbulanceType)) {
                continue; // Type not permitted in this area
              }
            }
            // Check organization eligibility rule
            if (options?.organizationId && Array.isArray(meta.allowedOrganizationIds) && meta.allowedOrganizationIds.length > 0) {
              if (!meta.allowedOrganizationIds.includes(options.organizationId)) {
                continue; // Organization not permitted in this area
              }
            }
          }
        } catch {
          // Ignore JSON parse error and proceed
        }
      }

      matchingArea = area;
      minDistance = dist;
      break;
    }
  }

  if (matchingArea) {
    return {
      inArea: true,
      serviceArea: matchingArea,
      distanceFromCenterKm: minDistance,
    };
  }

  return {
    inArea: false,
    serviceArea: closestArea,
    reason: 'OUTSIDE_SERVICE_AREA',
    distanceFromCenterKm: minDistance === Infinity ? undefined : minDistance,
  };
}

// -------------------------------------------------------------
// 2. 9-Point Deterministic Dispatch Eligibility Gatekeeper
// -------------------------------------------------------------
export async function evaluateCandidateEligibility(
  candidate: CandidateVehicle,
  requestRequirements?: {
    requiredAmbulanceType?: AmbulanceType | string;
    pickupLat?: number;
    pickupLng?: number;
    isDemoRequest?: boolean;
  }
): Promise<EligibilityResult> {
  const reasons: string[] = [];

  const { ambulance, driver, driverProfile, organization } = candidate;

  // 1. Driver Account Operational Status
  if (!driver) {
    reasons.push('DRIVER_NOT_FOUND');
  } else {
    if (!driver.isActive || driver.isSuspended) {
      reasons.push('DRIVER_INACTIVE');
    }
  }

  // 2. Driver Verification Approved
  if (!driverProfile) {
    reasons.push('DRIVER_PROFILE_MISSING');
  } else {
    if (driverProfile.verificationState !== 'VERIFIED') {
      reasons.push('DRIVER_NOT_VERIFIED');
    }

    // 3. Required Driver Credentials Current
    if (driverProfile.licenseExpiry && new Date(driverProfile.licenseExpiry).getTime() <= Date.now()) {
      reasons.push('CREDENTIAL_EXPIRED');
    }

    // 4. Driver Organization Membership Approved
    if (driverProfile.membershipStatus !== 'APPROVED') {
      reasons.push('DRIVER_MEMBERSHIP_NOT_APPROVED');
    }
  }

  // 5. Ambulance Vehicle Verification & Operational Status
  if (!ambulance) {
    reasons.push('AMBULANCE_NOT_FOUND');
  } else {
    if (ambulance.verificationState !== 'VERIFIED') {
      reasons.push('AMBULANCE_NOT_VERIFIED');
    }
    if (ambulance.maintenanceStatus === 'OUT_OF_SERVICE') {
      reasons.push('AMBULANCE_OUT_OF_SERVICE');
    }

    // 6. Valid Driver-to-Vehicle Assignment
    const activeAssignment = await prisma.driverVehicleAssignment.findMany({
      where: {
        driverId: driverProfile?.id,
        ambulanceId: ambulance.id,
        isCurrent: true,
      },
    });

    if (!activeAssignment || activeAssignment.length === 0) {
      reasons.push('ASSIGNMENT_INVALID');
    }
  }

  // 7. Organization Approved and Active
  if (!organization || organization.verificationState !== 'VERIFIED') {
    reasons.push('ORGANIZATION_NOT_VERIFIED');
  }

  // 8. Vehicle Service Category Meets Request Requirements
  if (requestRequirements?.requiredAmbulanceType && ambulance) {
    const reqType = requestRequirements.requiredAmbulanceType;
    const ambType = ambulance.ambulanceType || ambulance.type;

    if (reqType === 'ADVANCED_LIFE_SUPPORT' && ambType !== 'ADVANCED_LIFE_SUPPORT') {
      reasons.push('SERVICE_CATEGORY_MISMATCH');
    }
  }

  // 9. Ambulance Available & Not Committed to Another Trip
  if (!ambulance?.isAvailable) {
    reasons.push('VEHICLE_UNAVAILABLE');
  } else if (ambulance) {
    // Check for active trip commitments
    const activeTrip = await prisma.emergencyTrip.findFirst({
      where: {
        ambulanceId: ambulance.id,
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
    });

    if (activeTrip) {
      reasons.push('VEHICLE_UNAVAILABLE');
    }
  }

  // 10. Service Area & Location Freshness
  if (ambulance) {
    if (isNaN(ambulance.currentLat) || isNaN(ambulance.currentLng) ||
        ambulance.currentLat < -90 || ambulance.currentLat > 90 ||
        ambulance.currentLng < -180 || ambulance.currentLng > 180) {
      reasons.push('LOCATION_INVALID');
    } else {
      // Location freshness check (30 minutes max staleness)
      const lastPing = ambulance.lastUpdated
        ? new Date(ambulance.lastUpdated).getTime()
        : (ambulance.updatedAt ? new Date(ambulance.updatedAt).getTime() : Date.now());
      const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000;
      if (lastPing < thirtyMinutesAgo) {
        reasons.push('LOCATION_STALE');
      }

      // Check service area boundary
      const areaCheck = await checkServiceArea(ambulance.currentLat, ambulance.currentLng);
      if (!areaCheck.inArea) {
        reasons.push('OUTSIDE_SERVICE_AREA');
      }
    }
  }

  // 11. Production vs Demo Quarantine
  const isDemoReq = requestRequirements?.isDemoRequest ?? false;
  const isCandidateDemo = Boolean(ambulance?.isDemo || driverProfile?.isDemo || organization?.isDemo);

  if (!isDemoReq && isCandidateDemo) {
    // Real emergency must NEVER dispatch demo/simulated units
    reasons.push('DEMO_RESOURCE_EXCLUDED');
  }

  return {
    eligible: reasons.length === 0,
    denialReasons: reasons,
  };
}

// -------------------------------------------------------------
// 3. Candidate Discovery & Transparent Ranking
// -------------------------------------------------------------
export async function discoverAndRankCandidates(request: {
  id: string;
  pickupLat: number;
  pickupLng: number;
  requiredAmbulanceType?: AmbulanceType | string;
  isDemo?: boolean;
  rankingPolicy?: RankingPolicy;
}): Promise<{
  rankedCandidates: CandidateVehicle[];
  rejectedCandidates: Array<{ id: string; denialReasons: string[] }>;
  rankingPolicyUsed: RankingPolicy;
}> {
  // Query all ambulances
  const allAmbulances = await prisma.ambulance.findMany({
    include: {
      driver: {
        include: {
          driverProfile: true,
        },
      },
      hospital: true,
      operator: true,
    },
  });

  const rankedCandidates: CandidateVehicle[] = [];
  const rejectedCandidates: Array<{ id: string; denialReasons: string[] }> = [];

  // Scalable Geospatial Pre-filter: 100km bounding box around incident coordinates
  const maxSearchRadiusKm = 100;
  const latDelta = maxSearchRadiusKm / 111.0;
  const radLat = (request.pickupLat * Math.PI) / 180;
  const lngDelta = maxSearchRadiusKm / (111.0 * Math.max(0.1, Math.cos(radLat)));
  const minLat = request.pickupLat - latDelta;
  const maxLat = request.pickupLat + latDelta;
  const minLng = request.pickupLng - lngDelta;
  const maxLng = request.pickupLng + lngDelta;

  for (const amb of allAmbulances) {
    // Fast geospatial bounding box rejection before relational lookups
    if (
      amb.currentLat !== undefined &&
      amb.currentLng !== undefined &&
      (amb.currentLat < minLat ||
        amb.currentLat > maxLat ||
        amb.currentLng < minLng ||
        amb.currentLng > maxLng)
    ) {
      rejectedCandidates.push({
        id: amb.id,
        denialReasons: ['OUTSIDE_SEARCH_RADIUS'],
      });
      continue;
    }

    let driver: any = amb.driver;
    if (!driver && amb.driverId) {
      driver = await prisma.user.findUnique({ where: { id: amb.driverId } });
    }

    let driverProfile = driver?.driverProfile;
    if (!driverProfile && driver?.id) {
      driverProfile = await prisma.driverProfile.findUnique({ where: { userId: driver.id } });
    }

    let org: any = null;
    if (amb.hospitalId) {
      const hosp = amb.hospital || (await prisma.hospital.findUnique({ where: { id: amb.hospitalId } }));
      if (hosp) {
        org = {
          type: 'HOSPITAL',
          id: hosp.id,
          name: hosp.name,
          verificationState: hosp.verificationState,
          isDemo: hosp.isDemo,
        };
      }
    } else if (amb.operatorId) {
      const op = amb.operator || (await prisma.ambulanceOperator.findUnique({ where: { id: amb.operatorId } }));
      if (op) {
        org = {
          type: 'PRIVATE_OPERATOR',
          id: op.id,
          name: op.name,
          verificationState: op.verificationState,
          isDemo: op.isDemo,
        };
      }
    }

    const candidate: CandidateVehicle = {
      ambulance: amb,
      driver,
      driverProfile,
      organization: org,
    };

    const eligibility = await evaluateCandidateEligibility(candidate, {
      requiredAmbulanceType: request.requiredAmbulanceType,
      pickupLat: request.pickupLat,
      pickupLng: request.pickupLng,
      isDemoRequest: request.isDemo,
    });

    if (!eligibility.eligible) {
      rejectedCandidates.push({
        id: amb.id,
        denialReasons: eligibility.denialReasons,
      });
      continue;
    }

    // Straight-line Haversine distance from ambulance to patient pickup
    const distanceKm = calculateHaversineDistanceKm(
      request.pickupLat,
      request.pickupLng,
      amb.currentLat,
      amb.currentLng
    );

    // Compute estimated travel time without fabricating turn-by-turn road traffic
    const estimatedTravelMinutes = Math.max(1, Math.ceil((distanceKm / 40) * 60));

    candidate.distanceKm = distanceKm;
    candidate.isStraightLine = true; // Explicitly marked: geographic estimate, NOT fabricated road ETA
    candidate.distanceType = 'STRAIGHT_LINE_HAVERSINE';
    candidate.distanceLabel = 'Straight-line geographic distance (km)';
    candidate.estimatedTravelMinutes = estimatedTravelMinutes;
    candidate.etaMethod = 'AVERAGE_SPEED_ESTIMATE_40KMH';
    candidate.etaDisclaimer = 'Estimated travel time based on 40 km/h baseline speed. Actual road conditions, traffic signals, and weather may vary.';

    // Medical capability scoring
    let capScore = 1;
    const ambTypeStr: string = String((amb as any).ambulanceType || (amb as any).type || '');
    if (ambTypeStr === 'ADVANCED_LIFE_SUPPORT' || ambTypeStr === 'ICU_ON_WHEELS') capScore = 3;
    else if (ambTypeStr === 'OXYGEN_SUPPORT') capScore = 2;
    else if (ambTypeStr === 'PATIENT_TRANSPORT' || ambTypeStr === 'BASIC_TRANSPORT') capScore = 0;
    candidate.capabilityScore = capScore;

    rankedCandidates.push(candidate);
  }

  // Configurable ranking policy
  const policy: RankingPolicy = request.rankingPolicy || 'DISTANCE_FIRST';

  if (policy === 'CAPABILITY_FIRST') {
    // Prioritize medical equipment capability first, then distance
    rankedCandidates.sort((a, b) => {
      const capDiff = (b.capabilityScore ?? 0) - (a.capabilityScore ?? 0);
      if (capDiff !== 0) return capDiff;
      return (a.distanceKm ?? 9999) - (b.distanceKm ?? 9999);
    });
  } else if (policy === 'BALANCED_POLICY') {
    // Composite optimization: distance (60%) vs capability (40%)
    rankedCandidates.sort((a, b) => {
      const scoreA = (a.distanceKm ?? 9999) * 0.7 - (a.capabilityScore ?? 0) * 1.5;
      const scoreB = (b.distanceKm ?? 9999) * 0.7 - (b.capabilityScore ?? 0) * 1.5;
      return scoreA - scoreB;
    });
  } else {
    // DISTANCE_FIRST (Default emergency standard)
    rankedCandidates.sort((a, b) => {
      const distDiff = (a.distanceKm ?? 9999) - (b.distanceKm ?? 9999);
      if (Math.abs(distDiff) > 0.05) return distDiff;
      return (b.capabilityScore ?? 0) - (a.capabilityScore ?? 0);
    });
  }

  return {
    rankedCandidates,
    rejectedCandidates,
    rankingPolicyUsed: policy,
  };
}

// -------------------------------------------------------------
// 4. Concurrency-Safe Dispatch Offer & Escalation Cycle
// -------------------------------------------------------------
const offerMutexes = new Map<string, boolean>();

export async function dispatchOfferToCandidate(
  requestId: string,
  candidate: CandidateVehicle,
  timeoutSeconds: number = 45
): Promise<any> {
  const expiresAt = new Date(Date.now() + timeoutSeconds * 1000);

  // 1. Create DispatchAttempt record
  const attempt = await prisma.dispatchAttempt.create({
    data: {
      requestId,
      ambulanceId: candidate.ambulance.id,
      driverId: candidate.driver.id,
      status: DispatchAttemptStatus.OFFERED,
      distanceKm: candidate.distanceKm ?? 0,
      isStraightLine: true,
      expiresAt,
      isDemo: candidate.ambulance.isDemo || false,
    },
    include: {
      ambulance: true,
      driver: true,
    },
  });

  // 2. Update EmergencyRequest state to OFFERED
  await prisma.emergencyRequest.update({
    where: { id: requestId },
    data: {
      status: RequestStatus.OFFERED,
    },
  });

  // 3. Record EmergencyEvent
  await prisma.emergencyEvent.create({
    data: {
      requestId,
      eventType: 'DISPATCH_OFFERED',
      actorId: 'DISPATCH_ENGINE',
      actorRole: 'SYSTEM',
      previousState: 'SEARCHING',
      newState: 'OFFERED',
      metadata: JSON.stringify({
        attemptId: attempt.id,
        driverId: candidate.driver.id,
        ambulanceId: candidate.ambulance.id,
        distanceKm: candidate.distanceKm,
        expiresAt: expiresAt.toISOString(),
      }),
      isDemo: candidate.ambulance.isDemo || false,
    },
  });

  // 4. Centralized Notification Engine (Transactional Outbox with 30-45s Expiry)
  await notifyDispatchOffer(
    candidate.driver.id,
    attempt,
    { id: requestId, requiredAmbulanceType: candidate.ambulance.ambulanceType },
    candidate.distanceKm ?? 0,
    expiresAt
  ).catch((err) => {
    console.error('[NotificationEngine Error] notifyDispatchOffer failed:', err);
  });

  // Backward-compatible direct socket broadcast
  const io = getIO();
  if (io) {
    io.to(`driver:${candidate.driver.id}`).emit('dispatch:offer', {
      attemptId: attempt.id,
      requestId,
      distanceKm: candidate.distanceKm,
      isStraightLine: true,
      expiresAt: expiresAt.toISOString(),
      ambulanceType: candidate.ambulance.ambulanceType,
      organizationName: candidate.organization.name,
      isDemo: candidate.ambulance.isDemo || false,
    });
  }

  metrics.recordDispatchOffer('OFFERED');
  logger.info('DISPATCH_ENGINE', `Dispatch offer ${attempt.id} created for driver ${candidate.driver.id} (request: ${requestId})`, {
    metadata: { attemptId: attempt.id, requestId, driverId: candidate.driver.id },
    operationOutcome: 'SUCCESS',
  });

  return attempt;
}

export async function atomicallyAcceptOffer(
  attemptId: string,
  driverId: string
): Promise<{ success: boolean; trip?: any; error?: string; code?: string }> {
  // Concurrency Mutex Lock
  if (offerMutexes.get(attemptId)) {
    return { success: false, error: 'Acceptance operation already in progress', code: 'CONCURRENCY_LOCK' };
  }
  offerMutexes.set(attemptId, true);

  try {
    const attempt = await prisma.dispatchAttempt.findUnique({
      where: { id: attemptId },
      include: {
        request: true,
        ambulance: {
          include: {
            hospital: true,
            operator: true,
          },
        },
        driver: {
          include: {
            driverProfile: true,
          },
        },
      },
    });

    if (!attempt) {
      return { success: false, error: 'Dispatch offer not found', code: 'OFFER_NOT_FOUND' };
    }

    if (attempt.driverId !== driverId) {
      return { success: false, error: 'Unauthorized: offer was not addressed to this driver', code: 'UNAUTHORIZED_DRIVER' };
    }

    if (attempt.status !== DispatchAttemptStatus.OFFERED) {
      return { success: false, error: `Offer is no longer valid (status: ${attempt.status})`, code: 'OFFER_NOT_OFFERED' };
    }

    if (new Date().getTime() > new Date(attempt.expiresAt).getTime()) {
      await prisma.dispatchAttempt.update({
        where: { id: attemptId },
        data: { status: DispatchAttemptStatus.EXPIRED },
      });
      metrics.recordDispatchOffer('EXPIRED');
      return { success: false, error: 'Dispatch offer has expired', code: 'OFFER_EXPIRED' };
    }

    const request = attempt.request;
    if (request.status !== RequestStatus.OFFERED && request.status !== RequestStatus.SEARCHING) {
      return { success: false, error: 'Emergency request has already been assigned or cancelled', code: 'REQUEST_ALREADY_ASSIGNED' };
    }

    // Recheck live eligibility at acceptance time (Section 9)
    let org: any = null;
    if (attempt.ambulance.hospitalId) {
      const hosp = attempt.ambulance.hospital || (await prisma.hospital.findUnique({ where: { id: attempt.ambulance.hospitalId } }));
      if (hosp) {
        org = {
          type: 'HOSPITAL',
          id: hosp.id,
          name: hosp.name,
          verificationState: hosp.verificationState,
          isDemo: hosp.isDemo,
        };
      }
    } else if (attempt.ambulance.operatorId) {
      const op = attempt.ambulance.operator || (await prisma.ambulanceOperator.findUnique({ where: { id: attempt.ambulance.operatorId } }));
      if (op) {
        org = {
          type: 'PRIVATE_OPERATOR',
          id: op.id,
          name: op.name,
          verificationState: op.verificationState,
          isDemo: op.isDemo,
        };
      }
    }

    let dProfile = attempt.driver.driverProfile;
    if (!dProfile && attempt.driverId) {
      dProfile = await prisma.driverProfile.findUnique({ where: { userId: attempt.driverId } });
    }

    const liveCandidate: CandidateVehicle = {
      ambulance: attempt.ambulance,
      driver: attempt.driver,
      driverProfile: dProfile,
      organization: org,
    };

    const recheck = await evaluateCandidateEligibility(liveCandidate, {
      requiredAmbulanceType: request.requiredAmbulanceType,
      isDemoRequest: request.isDemo,
    });

    if (!recheck.eligible) {
      return {
        success: false,
        error: `Driver or ambulance is no longer eligible: ${recheck.denialReasons.join(', ')}`,
        code: 'ELIGIBILITY_RECHECK_FAILED',
      };
    }

    // Execute atomic transaction for acceptance
    const result = await prisma.$transaction(async (tx: any) => {
      // 1. Mark attempt as ACCEPTED
      const updatedAttempt = await tx.dispatchAttempt.update({
        where: { id: attemptId },
        data: {
          status: DispatchAttemptStatus.ACCEPTED,
          respondedAt: new Date(),
        },
      });

      // 2. Mark ambulance as unavailable
      await tx.ambulance.update({
        where: { id: attempt.ambulanceId },
        data: { isAvailable: false },
      });

      // 3. Mark EmergencyRequest as ACCEPTED with assigned driver and ambulance
      const updatedRequest = await tx.emergencyRequest.update({
        where: { id: request.id },
        data: {
          status: RequestStatus.ACCEPTED,
          driverId: attempt.driverId,
          ambulanceId: attempt.ambulanceId,
          hospitalId: attempt.ambulance.hospitalId,
          operatorId: attempt.ambulance.operatorId,
        },
      });

      // 4. Create EmergencyTrip
      const trip = await tx.emergencyTrip.create({
        data: {
          requestId: request.id,
          ambulanceId: attempt.ambulanceId,
          driverId: attempt.driverId,
          hospitalId: attempt.ambulance.hospitalId,
          operatorId: attempt.ambulance.operatorId,
          pickupLat: request.pickupLat,
          pickupLng: request.pickupLng,
          pickupAddress: request.pickupAddress,
          status: TripLifecycleStatus.ACCEPTED,
          startedAt: new Date(),
          isDemo: request.isDemo,
        },
      });

      // 5. Expire or cancel any other pending offers for this request
      const otherAttempts = await tx.dispatchAttempt.findMany({
        where: {
          requestId: request.id,
          status: DispatchAttemptStatus.OFFERED,
        },
      });

      for (const oa of otherAttempts) {
        if (oa.id !== attemptId) {
          await tx.dispatchAttempt.update({
            where: { id: oa.id },
            data: { status: DispatchAttemptStatus.CANCELLED },
          });
        }
      }

      // 6. Record EmergencyEvent
      await tx.emergencyEvent.create({
        data: {
          requestId: request.id,
          tripId: trip.id,
          eventType: 'OFFER_ACCEPTED',
          actorId: driverId,
          actorRole: 'DRIVER',
          previousState: 'OFFERED',
          newState: 'ACCEPTED',
          metadata: JSON.stringify({
            attemptId,
            tripId: trip.id,
            ambulanceId: attempt.ambulanceId,
          }),
          isDemo: request.isDemo,
        },
      });

      return { updatedAttempt, updatedRequest, trip };
    });

    // Broadcast real-time events
    const io = getIO();
    if (io) {
      // Notify patient
      io.to(`patient:${request.patientId}`).emit('dispatch:accepted', {
        requestId: request.id,
        tripId: result.trip.id,
        driverId: attempt.driverId,
        driverName: attempt.driver.name,
        driverPhone: attempt.driver.phone,
        vehicleNumber: attempt.ambulance.vehicleNumber,
        ambulanceType: attempt.ambulance.ambulanceType,
        isDemo: request.isDemo,
      });

      // Notify hospital if hospital-owned
      if (attempt.ambulance.hospitalId) {
        io.to(`hospital:${attempt.ambulance.hospitalId}`).emit('dispatch:accepted', {
          requestId: request.id,
          tripId: result.trip.id,
          ambulanceId: attempt.ambulanceId,
        });
      }

      // Notify operator if private-operator owned
      if (attempt.ambulance.operatorId) {
        io.to(`operator:${attempt.ambulance.operatorId}`).emit('dispatch:accepted', {
          requestId: request.id,
          tripId: result.trip.id,
          ambulanceId: attempt.ambulanceId,
        });
      }

      // Notify telemetry
      io.to('super_admin_room').emit('telemetry:update');
    }

    metrics.recordDispatchOffer('ACCEPTED');
    logger.info('DISPATCH_ENGINE', `Offer ${attemptId} successfully accepted by driver ${driverId}`, {
      metadata: { attemptId, tripId: result.trip.id, driverId },
      operationOutcome: 'SUCCESS',
    });

    return { success: true, trip: result.trip };
  } finally {
    offerMutexes.delete(attemptId);
  }
}

export async function rejectOrExpireOffer(
  attemptId: string,
  driverId: string,
  action: 'REJECT' | 'EXPIRE',
  rejectionReason?: string
): Promise<{ nextOffered: boolean; noAmbulanceLeft: boolean }> {
  const attempt = await prisma.dispatchAttempt.findUnique({
    where: { id: attemptId },
    include: { request: true },
  });

  if (!attempt) return { nextOffered: false, noAmbulanceLeft: true };

  const newStatus = action === 'REJECT' ? DispatchAttemptStatus.REJECTED : DispatchAttemptStatus.EXPIRED;
  await prisma.dispatchAttempt.update({
    where: { id: attemptId },
    data: {
      status: newStatus,
      respondedAt: new Date(),
      rejectionReason: rejectionReason || (action === 'EXPIRE' ? 'OFFER_TIMEOUT' : 'DECLINED_BY_DRIVER'),
    },
  });

  await prisma.emergencyEvent.create({
    data: {
      requestId: attempt.requestId,
      eventType: action === 'REJECT' ? 'OFFER_REJECTED' : 'OFFER_EXPIRED',
      actorId: driverId,
      actorRole: 'DRIVER',
      previousState: 'OFFERED',
      newState: 'SEARCHING',
      metadata: JSON.stringify({ attemptId, rejectionReason }),
      isDemo: attempt.isDemo,
    },
  });

  if (action === 'REJECT') {
    metrics.recordDispatchOffer('REJECTED');
  } else {
    metrics.recordDispatchOffer('EXPIRED');
  }

  // Trigger candidate escalation
  const { rankedCandidates } = await discoverAndRankCandidates({
    id: attempt.requestId,
    pickupLat: attempt.request.pickupLat,
    pickupLng: attempt.request.pickupLng,
    requiredAmbulanceType: attempt.request.requiredAmbulanceType,
    isDemo: attempt.request.isDemo,
  });

  // Find existing attempts for this request to avoid re-offering to same drivers
  const pastAttempts = await prisma.dispatchAttempt.findMany({
    where: { requestId: attempt.requestId },
  });
  const attemptedDriverIds = new Set(pastAttempts.map(a => a.driverId));

  const nextCandidate = rankedCandidates.find(c => !attemptedDriverIds.has(c.driver.id));

  if (nextCandidate) {
    await dispatchOfferToCandidate(attempt.requestId, nextCandidate);
    return { nextOffered: true, noAmbulanceLeft: false };
  } else {
    // No eligible ambulances remain
    metrics.recordDispatchOffer('NO_ELIGIBLE');
    logger.warn('DISPATCH_ENGINE', `No eligible ambulances remain for request ${attempt.requestId}`, {
      metadata: { requestId: attempt.requestId, attemptedDriversCount: pastAttempts.length },
      operationOutcome: 'DEGRADED',
    });

    await prisma.emergencyRequest.update({
      where: { id: attempt.requestId },
      data: { status: RequestStatus.NO_ELIGIBLE_AMBULANCE },
    });

    await prisma.emergencyEvent.create({
      data: {
        requestId: attempt.requestId,
        eventType: 'NO_ELIGIBLE_AMBULANCE',
        actorId: 'DISPATCH_ENGINE',
        actorRole: 'SYSTEM',
        previousState: 'OFFERED',
        newState: 'NO_ELIGIBLE_AMBULANCE',
        metadata: JSON.stringify({ message: 'All candidate drivers declined, expired, or are ineligible.' }),
        isDemo: attempt.isDemo,
      },
    });

    const io = getIO();
    if (io) {
      io.to(`patient:${attempt.request.patientId}`).emit('emergency:no_ambulance', {
        requestId: attempt.requestId,
        message: 'No eligible ambulances are currently available in the pilot zone. Please dial official emergency 112 immediately.',
      });
      io.to('super_admin_room').emit('telemetry:update');
    }

    return { nextOffered: false, noAmbulanceLeft: true };
  }
}

/**
 * System Startup Recovery: Recovers persisted dispatch work after node/container restart.
 * Automatically handles offers that expired while server was offline and triggers honest resolution.
 */
export async function recoverInterruptedDispatches(): Promise<{ expiredCount: number; unresolvedRequests: number }> {
  const now = new Date();
  const staleAttempts = await prisma.dispatchAttempt.findMany({
    where: {
      status: DispatchAttemptStatus.OFFERED,
      expiresAt: { lte: now },
    },
    include: { request: true },
  });

  let expiredCount = 0;
  let unresolvedRequests = 0;

  for (const attempt of staleAttempts) {
    try {
      await prisma.dispatchAttempt.update({
        where: { id: attempt.id },
        data: {
          status: DispatchAttemptStatus.EXPIRED,
          respondedAt: now,
          rejectionReason: 'OFFER_TIMEOUT_RECOVERY',
        },
      });
      expiredCount++;

      if (attempt.request && (attempt.request.status === RequestStatus.OFFERED || attempt.request.status === RequestStatus.SEARCHING)) {
        const escalation = await rejectOrExpireOffer(attempt.id, attempt.driverId, 'EXPIRE', 'SERVER_REBOOT_OFFER_EXPIRED');
        if (escalation.noAmbulanceLeft) {
          unresolvedRequests++;
        }
      }
    } catch (err: any) {
      console.error(`[Recovery] Failed to recover stale dispatch attempt ${attempt.id}:`, err?.message);
    }
  }

  return { expiredCount, unresolvedRequests };
}

/**
 * Safe Trip Reassignment:
 * Ensures active trips are never silently reassigned.
 * Cancels or archives the current trip with an auditable reason, releases the previous vehicle,
 * updates the emergency request back to SEARCHING, and escalates to the next eligible candidate.
 */
export async function reassignTripSafely(
  tripId: string,
  actorId: string,
  actorRole: string,
  reason: string
): Promise<{ success: boolean; newOfferDispatched?: boolean; message?: string; error?: string }> {
  const trip = await prisma.emergencyTrip.findUnique({
    where: { id: tripId },
    include: { request: true, ambulance: true, driver: true },
  });

  if (!trip) {
    return { success: false, error: 'Emergency trip not found' };
  }

  if (trip.status === TripLifecycleStatus.COMPLETED || trip.status === TripLifecycleStatus.CANCELLED) {
    return { success: false, error: `Cannot reassign trip in terminal status: ${trip.status}` };
  }

  // 1. Mark existing trip as CANCELLED
  await prisma.emergencyTrip.update({
    where: { id: tripId },
    data: {
      status: TripLifecycleStatus.CANCELLED,
    },
  });

  // 2. Update previous ambulance availability
  const isBreakdown = reason.toUpperCase().includes('BREAKDOWN') || reason.toUpperCase().includes('MECHANICAL');
  await prisma.ambulance.update({
    where: { id: trip.ambulanceId },
    data: {
      isAvailable: isBreakdown ? false : true,
      maintenanceStatus: isBreakdown ? 'OUT_OF_SERVICE' : 'OPERATIONAL',
    },
  });

  // 3. Mark previous dispatch attempts for this request as CANCELLED
  await prisma.dispatchAttempt.updateMany({
    where: {
      requestId: trip.requestId,
      status: DispatchAttemptStatus.ACCEPTED,
    },
    data: {
      status: DispatchAttemptStatus.CANCELLED,
      rejectionReason: `TRIP_REASSIGNED: ${reason}`,
    },
  });

  // 4. Record EmergencyEvent for auditable tracking
  await prisma.emergencyEvent.create({
    data: {
      requestId: trip.requestId,
      tripId: trip.id,
      eventType: 'TRIP_REASSIGNED',
      actorId,
      actorRole,
      previousState: trip.status,
      newState: 'SEARCHING',
      metadata: JSON.stringify({
        previousDriverId: trip.driverId,
        previousAmbulanceId: trip.ambulanceId,
        reason,
      }),
      isDemo: trip.isDemo,
    },
  });

  // 5. Update request status back to SEARCHING and clear driver/ambulance assignment
  await prisma.emergencyRequest.update({
    where: { id: trip.requestId },
    data: {
      status: RequestStatus.SEARCHING,
      driverId: null,
      ambulanceId: null,
    },
  });

  // 6. Discover and escalate to next eligible candidate
  const { rankedCandidates } = await discoverAndRankCandidates({
    id: trip.requestId,
    pickupLat: trip.pickupLat,
    pickupLng: trip.pickupLng,
    requiredAmbulanceType: trip.request?.requiredAmbulanceType,
    isDemo: trip.isDemo,
  });

  // Exclude previously assigned driver
  const nextCandidate = rankedCandidates.find((c: any) => c.driver.id !== trip.driverId);

  if (nextCandidate) {
    await dispatchOfferToCandidate(trip.requestId, nextCandidate);
    return {
      success: true,
      newOfferDispatched: true,
      message: 'Trip safely cancelled and escalated to next eligible candidate.',
    };
  } else {
    await prisma.emergencyRequest.update({
      where: { id: trip.requestId },
      data: { status: RequestStatus.NO_ELIGIBLE_AMBULANCE },
    });
    return {
      success: true,
      newOfferDispatched: false,
      message: 'Trip cancelled. No other eligible ambulances currently available; patient directed to 112.',
    };
  }
}
