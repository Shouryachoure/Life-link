import prisma from '../db';
import { VerificationState, AmbulanceType, TripLifecycleStatus } from '@prisma/client';

export interface DispatchEligibilityResult {
  isEligible: boolean;
  driverId?: string;
  driverName?: string;
  ambulanceId?: string;
  vehicleNumber?: string;
  organizationId?: string;
  organizationName?: string;
  reasons: string[];
  details: {
    driverAccountActive: boolean;
    driverVerified: boolean;
    credentialsCurrent: boolean;
    organizationApproved: boolean;
    ambulanceAssigned: boolean;
    ambulanceVerified: boolean;
    ambulanceAvailable: boolean;
    notInMaintenance: boolean;
    notOnActiveTrip: boolean;
    locationFresh: boolean;
    serviceCategoryMatch: boolean;
    pilotActivated: boolean;
    notDemo: boolean;
  };
}

/**
 * 12-Point Authoritative Dispatch Eligibility Engine (LifeLink Real-World Pilot Standard)
 * Evaluates whether a driver and their assigned ambulance can be dispatched to a real patient emergency.
 * Every check is deterministic, auditable, and evaluated server-side.
 */
export async function evaluateDriverDispatchEligibility(
  driverUserId: string,
  options?: {
    requiredAmbulanceType?: AmbulanceType | string;
    isDemoRequest?: boolean;
    maxGpsAgeSeconds?: number;
  }
): Promise<DispatchEligibilityResult> {
  const reasons: string[] = [];
  const maxGpsAge = options?.maxGpsAgeSeconds || 300; // 5 minutes standard freshness window

  const details = {
    driverAccountActive: false,
    driverVerified: false,
    credentialsCurrent: false,
    organizationApproved: false,
    ambulanceAssigned: false,
    ambulanceVerified: false,
    ambulanceAvailable: false,
    notInMaintenance: false,
    notOnActiveTrip: false,
    locationFresh: false,
    serviceCategoryMatch: true,
    pilotActivated: true,
    notDemo: true,
  };

  // 1. Fetch driver User record
  const user = await prisma.user.findUnique({
    where: { id: driverUserId },
    include: {
      driverProfile: {
        include: {
          hospital: true,
          operator: true,
          assignments: {
            where: { isCurrent: true },
            include: { ambulance: true },
          },
        },
      },
    },
  });

  if (!user) {
    return {
      isEligible: false,
      driverId: driverUserId,
      reasons: ['DRIVER_NOT_FOUND'],
      details,
    };
  }

  // Check 1: Driver account active & not suspended
  if (user.isActive && !user.isSuspended) {
    details.driverAccountActive = true;
  } else {
    reasons.push(user.isSuspended ? 'DRIVER_SUSPENDED' : 'DRIVER_INACTIVE');
  }

  const profile = user.driverProfile;
  if (!profile) {
    return {
      isEligible: false,
      driverId: driverUserId,
      driverName: user.name,
      reasons: [...reasons, 'DRIVER_PROFILE_MISSING'],
      details,
    };
  }

  // Check 2: Driver verification state must be explicitly VERIFIED
  if (profile.verificationState === VerificationState.VERIFIED) {
    details.driverVerified = true;
  } else {
    reasons.push(
      profile.verificationState === VerificationState.SUSPENDED
        ? 'DRIVER_SUSPENDED'
        : 'DRIVER_NOT_VERIFIED'
    );
  }

  // Check 3: Required driver credentials are current (license not expired)
  if (profile.licenseExpiry) {
    const isExpired = new Date(profile.licenseExpiry).getTime() <= Date.now();
    if (!isExpired) {
      details.credentialsCurrent = true;
    } else {
      reasons.push('DRIVER_LICENSE_EXPIRED');
    }
  } else {
    reasons.push('DRIVER_CREDENTIALS_MISSING');
  }

  // Check 4: Approved organization affiliation (Hospital OR Private Operator)
  let orgApproved = false;
  let orgId = profile.hospitalId || profile.operatorId || '';
  let orgName = '';
  let orgSuspended = false;

  if (profile.organizationType === 'HOSPITAL' && profile.hospital) {
    orgApproved = profile.hospital.verificationState === VerificationState.VERIFIED;
    orgName = profile.hospital.name;
  } else if (profile.organizationType === 'PRIVATE_OPERATOR' && profile.operator) {
    orgApproved = profile.operator.verificationState === VerificationState.VERIFIED;
    orgName = profile.operator.name;
  } else if (profile.hospitalId) {
    const hosp = await prisma.hospital.findUnique({ where: { id: profile.hospitalId } });
    if (hosp) {
      orgApproved = hosp.verificationState === VerificationState.VERIFIED;
      orgName = hosp.name;
    }
  } else if (profile.operatorId) {
    const op = await prisma.ambulanceOperator.findUnique({ where: { id: profile.operatorId } });
    if (op) {
      orgApproved = op.verificationState === VerificationState.VERIFIED;
      orgName = op.name;
    }
  }

  if (profile.membershipStatus === 'APPROVED' && orgApproved && !orgSuspended) {
    details.organizationApproved = true;
  } else {
    if (profile.membershipStatus !== 'APPROVED') {
      reasons.push('ORGANIZATION_MEMBERSHIP_PENDING');
    }
    if (!orgApproved) {
      reasons.push('ORGANIZATION_NOT_VERIFIED');
    }
    if (orgSuspended) {
      reasons.push('ORGANIZATION_SUSPENDED');
    }
  }

  // Check 5: Valid current Driver-Vehicle Assignment
  const currentAssignment = profile.assignments?.[0];
  if (currentAssignment && currentAssignment.ambulance) {
    details.ambulanceAssigned = true;
    const amb = currentAssignment.ambulance;

    // Check 6: Assigned ambulance is verified
    if (
      amb.verificationState === VerificationState.VERIFIED ||
      amb.verificationStatus === 'APPROVED'
    ) {
      details.ambulanceVerified = true;
    } else {
      reasons.push('AMBULANCE_NOT_VERIFIED');
    }

    // Check 7: Assigned ambulance is operational and available
    const opStatus = (amb as any).operationalStatus || (amb.isAvailable ? 'AVAILABLE' : 'UNAVAILABLE');
    if (amb.isAvailable && opStatus === 'AVAILABLE') {
      details.ambulanceAvailable = true;
    } else {
      reasons.push(opStatus === 'SUSPENDED' ? 'VEHICLE_SUSPENDED' : 'VEHICLE_UNAVAILABLE');
    }

    // Check 8: Not in maintenance
    const maint = amb.maintenanceStatus || 'GOOD';
    if (maint === 'OPERATIONAL' || maint === 'GOOD') {
      details.notInMaintenance = true;
    } else {
      reasons.push('VEHICLE_IN_MAINTENANCE');
    }

    // Check 9: Not currently committed to an active emergency trip
    const activeTrip = await prisma.emergencyTrip.findFirst({
      where: {
        OR: [{ ambulanceId: amb.id }, { driverId: driverUserId }],
        status: {
          in: [
            TripLifecycleStatus.ACCEPTED,
            TripLifecycleStatus.AMBULANCE_ARRIVING,
            TripLifecycleStatus.PATIENT_PICKED_UP,
            TripLifecycleStatus.IN_TRANSIT,
          ],
        },
      },
    });

    if (!activeTrip) {
      details.notOnActiveTrip = true;
    } else {
      reasons.push('AMBULANCE_ALREADY_COMMITTED_TO_ACTIVE_TRIP');
    }

    // Check 10: Location telemetry freshness (< 5 mins & non-null coordinates)
    if (amb.lastUpdated && amb.currentLat && amb.currentLng) {
      const ageSeconds = (Date.now() - new Date(amb.lastUpdated).getTime()) / 1000;
      if (ageSeconds <= maxGpsAge && (amb.currentLat !== 0 || amb.currentLng !== 0)) {
        details.locationFresh = true;
      } else {
        reasons.push(ageSeconds > maxGpsAge ? 'STALE_GPS_LOCATION' : 'INVALID_COORDINATES');
      }
    } else {
      reasons.push('LOCATION_TELEMETRY_MISSING');
    }

    // Check 11: Service category match
    if (options?.requiredAmbulanceType) {
      const reqType = options.requiredAmbulanceType;
      if (reqType === AmbulanceType.ADVANCED_LIFE_SUPPORT && amb.ambulanceType !== AmbulanceType.ADVANCED_LIFE_SUPPORT) {
        details.serviceCategoryMatch = false;
        reasons.push('AMBULANCE_CAPABILITY_MISMATCH_REQUIRES_ALS');
      }
    }

    // Check 12: Demo quarantine isolation
    const isDemoRecord = amb.isDemo || profile.isDemo;
    if (isDemoRecord && !options?.isDemoRequest) {
      details.notDemo = false;
      reasons.push('DEMO_QUARANTINE_INELIGIBLE_FOR_PRODUCTION');
    }

    return {
      isEligible: reasons.length === 0,
      driverId: driverUserId,
      driverName: user.name,
      ambulanceId: amb.id,
      vehicleNumber: amb.vehicleNumber,
      organizationId: orgId,
      organizationName: orgName,
      reasons,
      details,
    };
  } else {
    reasons.push('ASSIGNMENT_INVALID');
    return {
      isEligible: false,
      driverId: driverUserId,
      driverName: user.name,
      organizationId: orgId,
      organizationName: orgName,
      reasons,
      details,
    };
  }
}

/**
 * Evaluates an ambulance vehicle directly for dispatch readiness.
 */
export async function evaluateAmbulanceDispatchEligibility(
  ambulanceId: string,
  options?: {
    requiredAmbulanceType?: AmbulanceType | string;
    isDemoRequest?: boolean;
    maxGpsAgeSeconds?: number;
  }
): Promise<DispatchEligibilityResult> {
  const ambulance = await prisma.ambulance.findUnique({
    where: { id: ambulanceId },
    include: {
      assignments: {
        where: { isCurrent: true },
        include: { driver: true },
      },
      hospital: true,
      operator: true,
    },
  });

  if (!ambulance) {
    return {
      isEligible: false,
      ambulanceId,
      reasons: ['AMBULANCE_NOT_FOUND'],
      details: {
        driverAccountActive: false,
        driverVerified: false,
        credentialsCurrent: false,
        organizationApproved: false,
        ambulanceAssigned: false,
        ambulanceVerified: false,
        ambulanceAvailable: false,
        notInMaintenance: false,
        notOnActiveTrip: false,
        locationFresh: false,
        serviceCategoryMatch: false,
        pilotActivated: false,
        notDemo: true,
      },
    };
  }

  const currentAssignment = ambulance.assignments?.[0];
  if (!currentAssignment || !currentAssignment.driver) {
    return {
      isEligible: false,
      ambulanceId,
      vehicleNumber: ambulance.vehicleNumber,
      organizationId: ambulance.hospitalId || ambulance.operatorId || '',
      organizationName: ambulance.hospital?.name || ambulance.operator?.name || '',
      reasons: ['NO_ACTIVE_DRIVER_ASSIGNMENT'],
      details: {
        driverAccountActive: false,
        driverVerified: false,
        credentialsCurrent: false,
        organizationApproved:
          ambulance.hospital?.verificationState === VerificationState.VERIFIED ||
          ambulance.operator?.verificationState === VerificationState.VERIFIED,
        ambulanceAssigned: false,
        ambulanceVerified:
          ambulance.verificationState === VerificationState.VERIFIED ||
          ambulance.verificationStatus === 'APPROVED',
        ambulanceAvailable: ambulance.isAvailable,
        notInMaintenance: ambulance.maintenanceStatus === 'OPERATIONAL' || ambulance.maintenanceStatus === 'GOOD',
        notOnActiveTrip: true,
        locationFresh: false,
        serviceCategoryMatch: true,
        pilotActivated: true,
        notDemo: !ambulance.isDemo,
      },
    };
  }

  // Evaluate the driver and vehicle jointly
  return evaluateDriverDispatchEligibility(currentAssignment.driver.userId, options);
}
