import prisma from '../db';
import { Role, RequestStatus, DispatchAttemptStatus, VerificationState, AmbulanceType } from '@prisma/client';

export interface DateRange {
  start: Date;
  end: Date;
  startIso: string;
  endIso: string;
}

export interface AnalyticsFilterParams {
  startDate?: string;
  endDate?: string;
  includeDemo?: boolean;
  hospitalId?: string;
  operatorId?: string;
  serviceAreaId?: string;
  city?: string;
  requestingUserRole: Role;
  requestingUserId: string;
}

export interface DurationStats {
  sampleCount: number;
  averageMinutes: number | null;
  medianMinutes: number | null;
  minMinutes: number | null;
  maxMinutes: number | null;
  definition: string;
}

/**
 * Parses and validates date boundaries with ISO and YYYY-MM-DD support.
 * Defaults to the last 30 days up to the end of the current day.
 */
export function parseDateRange(startParam?: string, endParam?: string): DateRange {
  let start: Date;
  let end: Date;

  if (startParam) {
    const isIso = startParam.includes('T');
    start = new Date(isIso ? startParam : `${startParam}T00:00:00.000Z`);
  } else {
    // Default: 30 days prior, aligned to start of day
    start = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    start.setUTCHours(0, 0, 0, 0);
  }

  if (endParam) {
    const isIso = endParam.includes('T');
    end = new Date(isIso ? endParam : `${endParam}T23:59:59.999Z`);
  } else {
    // Default: current time aligned to end of day
    end = new Date();
    end.setUTCHours(23, 59, 59, 999);
  }

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new Error('INVALID_DATE_FORMAT: startDate and endDate must be valid ISO 8601 or YYYY-MM-DD strings.');
  }

  if (start.getTime() > end.getTime()) {
    throw new Error('START_DATE_AFTER_END_DATE: startDate cannot be after endDate.');
  }

  return {
    start,
    end,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

/**
 * Calculates count, average, median, min, max.
 * Returns null for missing/empty samples to distinguish missing data from zero.
 */
export function calculateDurationStats(values: number[], definition: string): DurationStats {
  if (!values || values.length === 0) {
    return {
      sampleCount: 0,
      averageMinutes: null,
      medianMinutes: null,
      minMinutes: null,
      maxMinutes: null,
      definition,
    };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const averageMinutes = Number((sum / sorted.length).toFixed(1));
  const mid = Math.floor(sorted.length / 2);
  const medianMinutes =
    sorted.length % 2 !== 0
      ? sorted[mid]
      : Number(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(1));
  const minMinutes = sorted[0];
  const maxMinutes = sorted[sorted.length - 1];

  return {
    sampleCount: sorted.length,
    averageMinutes,
    medianMinutes,
    minMinutes,
    maxMinutes,
    definition,
  };
}

/**
 * Sanitizes CSV cell values to prevent Spreadsheet Formula Injection (CWE-1236 / CSV Injection).
 * Any value starting with '=', '+', '-', '@', '\t', or '\r' is escaped with a leading single quote.
 */
export function sanitizeCsvField(value: any): string {
  if (value === null || value === undefined) return '';
  let str = String(value);

  // If the string starts with formula triggers, prepend a single quote to force plain text interpretation
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }

  // If string contains comma, quote, or newline, escape inner quotes and wrap in double quotes
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    str = `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

/**
 * Main analytics aggregator. Extracts and calculates all 10 reports.
 */
export async function getEmergencyOperationsAnalytics(params: AnalyticsFilterParams) {
  const { start, end, startIso, endIso } = parseDateRange(params.startDate, params.endDate);
  const includeDemo = Boolean(params.includeDemo);
  const now = new Date();

  // 1. Fetch raw datasets concurrently
  const [
    allRequests,
    allAttempts,
    allTrips,
    allAmbulances,
    allHospitals,
    allOperators,
    allAppointments,
    allQueues,
    allNotifications,
    allDriverProfiles,
    serviceAreas,
  ] = await Promise.all([
    prisma.emergencyRequest.findMany({
      include: {
        ambulance: { select: { id: true, vehicleNumber: true, hospitalId: true, operatorId: true } },
        hospital: { select: { id: true, name: true, city: true } },
        trip: { select: { id: true, hospitalId: true, startedAt: true, arrivedAt: true, pickedUpAt: true, completedAt: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.dispatchAttempt.findMany({
      include: {
        ambulance: { select: { id: true, hospitalId: true, operatorId: true } },
      },
    }),
    prisma.emergencyTrip.findMany({
      include: {
        ambulance: { select: { id: true, hospitalId: true, operatorId: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.ambulance.findMany({
      include: {
        hospital: { select: { id: true, name: true, city: true } },
        operator: { select: { id: true, name: true, city: true } },
      },
    }),
    prisma.hospital.findMany(),
    prisma.ambulanceOperator.findMany(),
    prisma.appointment.findMany({
      include: {
        hospital: { select: { id: true, name: true } },
        doctor: { select: { id: true, name: true, specialization: true } },
        slot: { select: { date: true, startTime: true, endTime: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.queueEntry.findMany(),
    prisma.notification.findMany({
      orderBy: { createdAt: 'desc' },
    }),
    prisma.driverProfile.findMany(),
    prisma.serviceArea.findMany(),
  ]);

  // Demo filter helper
  const isDemoMatch = (rec: any) => (includeDemo ? true : !rec.isDemo);

  // Date range filter helper
  const isInDateRange = (dateVal: any) => {
    if (!dateVal) return false;
    const t = new Date(dateVal).getTime();
    return t >= start.getTime() && t <= end.getTime();
  };

  // Organization filter helpers
  const targetHospitalId = params.hospitalId;
  const targetOperatorId = params.operatorId;

  // ---------------------------------------------------------------------------
  // REPORT 1: Emergency Requests by Status & Time Period
  // ---------------------------------------------------------------------------
  const filteredRequests = allRequests.filter(req => {
    if (!isDemoMatch(req)) return false;
    if (!isInDateRange(req.createdAt)) return false;
    if (targetHospitalId && req.hospitalId !== targetHospitalId && (req.trip as any)?.hospitalId !== targetHospitalId) {
      return false;
    }
    if (targetOperatorId && req.ambulance?.operatorId !== targetOperatorId) {
      return false;
    }
    return true;
  });

  const requestStatusCounts: Record<string, number> = {
    REQUESTED: 0,
    SEARCHING: 0,
    OFFERED: 0,
    ACCEPTED: 0,
    AMBULANCE_ARRIVING: 0,
    PATIENT_PICKED_UP: 0,
    IN_TRANSIT: 0,
    AT_DESTINATION: 0,
    COMPLETED: 0,
    CANCELLED: 0,
    REJECTED: 0,
    NO_ELIGIBLE_AMBULANCE: 0,
    EXPIRED: 0,
    FAILED: 0,
  };

  const dailyRequestBuckets: Record<string, { total: number; completed: number; cancelled: number; noAmbulance: number }> = {};

  let completedRequestsCount = 0;
  let noEligibleCount = 0;
  let cancelledRequestsCount = 0;

  for (const req of filteredRequests) {
    const st = req.status || 'UNKNOWN';
    requestStatusCounts[st] = (requestStatusCounts[st] || 0) + 1;

    if (st === RequestStatus.COMPLETED) completedRequestsCount++;
    if (st === RequestStatus.CANCELLED || st === RequestStatus.REJECTED || st === RequestStatus.EXPIRED || st === RequestStatus.FAILED) {
      cancelledRequestsCount++;
    }
    if (st === RequestStatus.NO_ELIGIBLE_AMBULANCE) noEligibleCount++;

    const dateKey = new Date(req.createdAt).toISOString().split('T')[0];
    if (!dailyRequestBuckets[dateKey]) {
      dailyRequestBuckets[dateKey] = { total: 0, completed: 0, cancelled: 0, noAmbulance: 0 };
    }
    dailyRequestBuckets[dateKey].total++;
    if (st === RequestStatus.COMPLETED) dailyRequestBuckets[dateKey].completed++;
    if (st === RequestStatus.CANCELLED || st === RequestStatus.REJECTED) dailyRequestBuckets[dateKey].cancelled++;
    if (st === RequestStatus.NO_ELIGIBLE_AMBULANCE) dailyRequestBuckets[dateKey].noAmbulance++;
  }

  const totalRequests = filteredRequests.length;
  const requestCompletionRate = totalRequests > 0 ? Number(((completedRequestsCount / totalRequests) * 100).toFixed(1)) : null;
  const unservedRate = totalRequests > 0 ? Number(((noEligibleCount / totalRequests) * 100).toFixed(1)) : null;

  // ---------------------------------------------------------------------------
  // REPORT 2: Dispatch Acceptance and Timeout Rates
  // ---------------------------------------------------------------------------
  const filteredAttempts = allAttempts.filter(att => {
    if (att.offeredAt && !isInDateRange(att.offeredAt)) return false;
    if (targetHospitalId && att.ambulance?.hospitalId !== targetHospitalId) return false;
    if (targetOperatorId && att.ambulance?.operatorId !== targetOperatorId) return false;
    return true;
  });

  let acceptedOffersCount = 0;
  let rejectedOffersCount = 0;
  let expiredOffersCount = 0;
  let currentlyOfferedCount = 0;

  for (const att of filteredAttempts) {
    if (att.status === DispatchAttemptStatus.ACCEPTED) acceptedOffersCount++;
    else if (att.status === DispatchAttemptStatus.REJECTED) rejectedOffersCount++;
    else if (att.status === DispatchAttemptStatus.EXPIRED) expiredOffersCount++;
    else if (att.status === DispatchAttemptStatus.OFFERED) currentlyOfferedCount++;
  }

  const totalOffers = filteredAttempts.length;
  const acceptanceRate = totalOffers > 0 ? Number(((acceptedOffersCount / totalOffers) * 100).toFixed(1)) : null;
  const rejectionRate = totalOffers > 0 ? Number(((rejectedOffersCount / totalOffers) * 100).toFixed(1)) : null;
  const timeoutRate = totalOffers > 0 ? Number(((expiredOffersCount / totalOffers) * 100).toFixed(1)) : null;

  // ---------------------------------------------------------------------------
  // REPORT 3: Lifecycle Durations (Derived strictly from persisted timestamps)
  // ---------------------------------------------------------------------------
  const requestCreatedMap = new Map<string, Date>();
  for (const r of allRequests) {
    if (r.createdAt) requestCreatedMap.set(r.id, new Date(r.createdAt));
  }

  const responseDurations: number[] = [];
  const arrivalDurations: number[] = [];
  const sceneDurations: number[] = [];
  const transitDurations: number[] = [];
  const totalTurnaroundDurations: number[] = [];

  const filteredTrips = allTrips.filter(trip => {
    if (!isDemoMatch(trip)) return false;
    if (trip.createdAt && !isInDateRange(trip.createdAt)) return false;
    if (targetHospitalId && (trip as any).hospitalId !== targetHospitalId && trip.ambulance?.hospitalId !== targetHospitalId) {
      return false;
    }
    if (targetOperatorId && trip.ambulance?.operatorId !== targetOperatorId) {
      return false;
    }
    return true;
  });

  for (const trip of filteredTrips) {
    const reqCreated = requestCreatedMap.get(trip.requestId);
    const acceptedAt = (trip as any).startedAt || (trip as any).acceptedAt ? new Date((trip as any).startedAt || (trip as any).acceptedAt) : null;
    const arrivedAt = trip.arrivedAt ? new Date(trip.arrivedAt) : null;
    const pickedUpAt = trip.pickedUpAt ? new Date(trip.pickedUpAt) : null;
    const completedAt = trip.completedAt ? new Date(trip.completedAt) : null;

    // 1. Request to Assignment / Acceptance
    if (reqCreated && acceptedAt && acceptedAt.getTime() >= reqCreated.getTime()) {
      const min = Number(((acceptedAt.getTime() - reqCreated.getTime()) / 60000).toFixed(1));
      if (min >= 0 && min < 1440) responseDurations.push(min);
    }

    // 2. Assignment to Arrival
    if (acceptedAt && arrivedAt && arrivedAt.getTime() >= acceptedAt.getTime()) {
      const min = Number(((arrivedAt.getTime() - acceptedAt.getTime()) / 60000).toFixed(1));
      if (min >= 0 && min < 1440) arrivalDurations.push(min);
    }

    // 3. Arrival to Pickup (Scene duration)
    if (arrivedAt && pickedUpAt && pickedUpAt.getTime() >= arrivedAt.getTime()) {
      const min = Number(((pickedUpAt.getTime() - arrivedAt.getTime()) / 60000).toFixed(1));
      if (min >= 0 && min < 1440) sceneDurations.push(min);
    }

    // 4. Pickup to Completion (Transit duration)
    if (pickedUpAt && completedAt && completedAt.getTime() >= pickedUpAt.getTime()) {
      const min = Number(((completedAt.getTime() - pickedUpAt.getTime()) / 60000).toFixed(1));
      if (min >= 0 && min < 1440) transitDurations.push(min);
    }

    // 5. Total Turnaround (Request creation to Trip completion)
    if (reqCreated && completedAt && completedAt.getTime() >= reqCreated.getTime()) {
      const min = Number(((completedAt.getTime() - reqCreated.getTime()) / 60000).toFixed(1));
      if (min >= 0 && min < 1440) totalTurnaroundDurations.push(min);
    }
  }

  const lifecycleDurations = {
    requestToAssignmentMinutes: calculateDurationStats(
      responseDurations,
      'Elapsed time from patient emergency request creation to driver offer acceptance.'
    ),
    assignmentToArrivalMinutes: calculateDurationStats(
      arrivalDurations,
      'Elapsed time from driver acceptance to arrival at incident scene.'
    ),
    arrivalToPickupMinutes: calculateDurationStats(
      sceneDurations,
      'Elapsed time spent on scene stabilizing and loading patient into ambulance.'
    ),
    pickupToCompletionMinutes: calculateDurationStats(
      transitDurations,
      'Elapsed transit time transporting patient from incident scene to hospital.'
    ),
    totalMissionMinutes: calculateDurationStats(
      totalTurnaroundDurations,
      'Total mission turnaround time from initial emergency request to trip completion.'
    ),
    disclaimer:
      'Lifecycle durations are calculated strictly from persisted operational timestamps. Road travel times are NOT estimated or inferred from straight-line Haversine distance.',
  };

  // ---------------------------------------------------------------------------
  // REPORT 4: Requests with No Eligible Ambulance
  // ---------------------------------------------------------------------------
  const unservedEmergencyDemand = {
    noEligibleAmbulanceCount: noEligibleCount,
    unservedPercentage: unservedRate,
    escalation112FallbackNotice:
      'All unserved emergency requests automatically present the citizen with direct National Emergency 112 dialing and local hospital emergency room helplines.',
  };

  // ---------------------------------------------------------------------------
  // REPORT 5: Fleet Availability by Organization & Service Area
  // ---------------------------------------------------------------------------
  const filteredAmbulances = allAmbulances.filter(amb => {
    if (!isDemoMatch(amb)) return false;
    if (targetHospitalId && amb.hospitalId !== targetHospitalId) return false;
    if (targetOperatorId && amb.operatorId !== targetOperatorId) return false;
    return true;
  });

  let hospitalFleetCount = 0;
  let privateOperatorFleetCount = 0;
  let availableAmbulancesCount = 0;
  let busyAmbulancesCount = 0;
  let outOfServiceCount = 0;
  let unverifiedOrSuspendedFleetCount = 0;

  const fleetByServiceArea: Record<string, { total: number; available: number }> = {};

  for (const amb of filteredAmbulances) {
    if (amb.hospitalId) hospitalFleetCount++;
    else if (amb.operatorId) privateOperatorFleetCount++;

    const isVerified = amb.verificationState === VerificationState.VERIFIED;
    const isMaintenance = amb.maintenanceStatus === 'OUT_OF_SERVICE';

    if (!isVerified) {
      unverifiedOrSuspendedFleetCount++;
    } else if (isMaintenance) {
      outOfServiceCount++;
    } else if (amb.isAvailable) {
      availableAmbulancesCount++;
    } else {
      busyAmbulancesCount++;
    }

    const cityKey = amb.hospital?.city || amb.operator?.city || 'Nagpur';
    if (!fleetByServiceArea[cityKey]) {
      fleetByServiceArea[cityKey] = { total: 0, available: 0 };
    }
    fleetByServiceArea[cityKey].total++;
    if (isVerified && !isMaintenance && amb.isAvailable) {
      fleetByServiceArea[cityKey].available++;
    }
  }

  const totalFleetCount = filteredAmbulances.length;
  const fleetAvailabilityRate =
    totalFleetCount > 0 ? Number(((availableAmbulancesCount / totalFleetCount) * 100).toFixed(1)) : null;

  // ---------------------------------------------------------------------------
  // REPORT 6: GPS Freshness and Tracking Outages
  // ---------------------------------------------------------------------------
  let liveGpsCount = 0;
  let staleGpsCount = 0;
  let trackingOutageCount = 0;

  for (const amb of filteredAmbulances) {
    if (!amb.lastUpdated) {
      trackingOutageCount++;
      continue;
    }
    const ageSeconds = Math.floor((now.getTime() - new Date(amb.lastUpdated).getTime()) / 1000);
    if (ageSeconds < 120) {
      liveGpsCount++;
    } else if (ageSeconds <= 300) {
      staleGpsCount++;
    } else {
      trackingOutageCount++;
    }
  }

  const trackingFailureRate =
    totalFleetCount > 0 ? Number(((trackingOutageCount / totalFleetCount) * 100).toFixed(1)) : null;

  // ---------------------------------------------------------------------------
  // REPORT 7: Hospital Capacity Update Freshness
  // ---------------------------------------------------------------------------
  const filteredHospitals = allHospitals.filter(hosp => {
    if (!isDemoMatch(hosp)) return false;
    if (targetHospitalId && hosp.id !== targetHospitalId) return false;
    return true;
  });

  let freshCapacityCount = 0; // < 1 hour
  let staleCapacityCount = 0; // 1 to 6 hours
  let outdatedCapacityCount = 0; // > 6 hours or null

  let totalBedsAcrossHospitals = 0;
  let availableBedsAcrossHospitals = 0;

  const hospitalCapacityList: Array<{
    id: string;
    name: string;
    city: string;
    totalBeds: number;
    availableBeds: number;
    occupancyRate: number | null;
    capacityFreshness: 'FRESH' | 'STALE' | 'OUTDATED';
    lastUpdated: string | null;
  }> = [];

  for (const hosp of filteredHospitals) {
    totalBedsAcrossHospitals += hosp.totalBeds || 0;
    availableBedsAcrossHospitals += hosp.availableBeds || 0;

    let freshness: 'FRESH' | 'STALE' | 'OUTDATED' = 'OUTDATED';
    if (hosp.capacityLastUpdated) {
      const ageHours = (now.getTime() - new Date(hosp.capacityLastUpdated).getTime()) / (3600 * 1000);
      if (ageHours < 1) {
        freshCapacityCount++;
        freshness = 'FRESH';
      } else if (ageHours <= 6) {
        staleCapacityCount++;
        freshness = 'STALE';
      } else {
        outdatedCapacityCount++;
      }
    } else {
      outdatedCapacityCount++;
    }

    const occ =
      hosp.totalBeds > 0
        ? Number((((hosp.totalBeds - hosp.availableBeds) / hosp.totalBeds) * 100).toFixed(1))
        : null;

    hospitalCapacityList.push({
      id: hosp.id,
      name: hosp.name,
      city: hosp.city,
      totalBeds: hosp.totalBeds,
      availableBeds: hosp.availableBeds,
      occupancyRate: occ,
      capacityFreshness: freshness,
      lastUpdated: hosp.capacityLastUpdated ? new Date(hosp.capacityLastUpdated).toISOString() : null,
    });
  }

  const overallOccupancyRate =
    totalBedsAcrossHospitals > 0
      ? Number((((totalBedsAcrossHospitals - availableBedsAcrossHospitals) / totalBedsAcrossHospitals) * 100).toFixed(1))
      : null;

  const hospitalFreshnessScore =
    filteredHospitals.length > 0
      ? Number(((freshCapacityCount / filteredHospitals.length) * 100).toFixed(1))
      : null;

  // ---------------------------------------------------------------------------
  // REPORT 8: Appointment Bookings, Cancellations, and Queue Summaries
  // ---------------------------------------------------------------------------
  const filteredAppointments = allAppointments.filter(app => {
    const appDateStr = (app as any).slot?.date || (app.createdAt ? new Date(app.createdAt).toISOString().split('T')[0] : '');
    if (appDateStr) {
      const appDate = new Date(`${appDateStr}T00:00:00.000Z`);
      if (appDate.getTime() < start.getTime() || appDate.getTime() > end.getTime()) {
        return false;
      }
    }
    if (targetHospitalId && app.hospitalId !== targetHospitalId) return false;
    return true;
  });

  const appointmentStatusCounts: Record<string, number> = {
    BOOKED: 0,
    CONFIRMED: 0,
    CHECKED_IN: 0,
    IN_CONSULTATION: 0,
    COMPLETED: 0,
    CANCELLED: 0,
    NO_SHOW: 0,
  };

  let completedAppointmentsCount = 0;
  let cancelledAppointmentsCount = 0;

  for (const app of filteredAppointments) {
    const st = app.status || 'BOOKED';
    appointmentStatusCounts[st] = (appointmentStatusCounts[st] || 0) + 1;
    if (st === 'COMPLETED') completedAppointmentsCount++;
    if (st === 'CANCELLED') cancelledAppointmentsCount++;
  }

  const totalAppointments = filteredAppointments.length;
  const appointmentCancellationRate =
    totalAppointments > 0 ? Number(((cancelledAppointmentsCount / totalAppointments) * 100).toFixed(1)) : null;

  // Queue metrics
  const filteredQueues = allQueues.filter(q => {
    if (targetHospitalId && q.hospitalId !== targetHospitalId) return false;
    return true;
  });

  const activeQueuesWaiting = filteredQueues.filter(q => q.status === 'WAITING').length;
  const waitTimes = filteredQueues
    .map(q => {
      if ((q as any).currentWaitMinutes !== undefined) return (q as any).currentWaitMinutes;
      if (q.joinedAt) return Math.max(0, Math.floor((now.getTime() - new Date(q.joinedAt).getTime()) / 60000));
      return null;
    })
    .filter((w): w is number => typeof w === 'number' && w >= 0);
  const averageWaitMinutes =
    waitTimes.length > 0 ? Number((waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length).toFixed(1)) : null;

  // ---------------------------------------------------------------------------
  // REPORT 9: Notification Success, Failure, and Pending Counts
  // ---------------------------------------------------------------------------
  const filteredNotifications = allNotifications.filter(n => {
    if (!isInDateRange(n.createdAt)) return false;
    return true;
  });

  let unreadNotificationsCount = 0;
  let readNotificationsCount = 0;
  const notificationTypeCounts: Record<string, number> = {};

  for (const notif of filteredNotifications) {
    if (notif.isRead) readNotificationsCount++;
    else unreadNotificationsCount++;
    const t = notif.type || 'INFO';
    notificationTypeCounts[t] = (notificationTypeCounts[t] || 0) + 1;
  }

  const totalNotifications = filteredNotifications.length;
  const notificationReadRate =
    totalNotifications > 0 ? Number(((readNotificationsCount / totalNotifications) * 100).toFixed(1)) : null;

  // ---------------------------------------------------------------------------
  // REPORT 10: Organization Verification Backlog
  // ---------------------------------------------------------------------------
  const pendingDriversCount = allDriverProfiles.filter(
    dp => isDemoMatch(dp) && dp.verificationState === VerificationState.PENDING_REVIEW
  ).length;

  const pendingHospitalsCount = allHospitals.filter(
    h => isDemoMatch(h) && h.verificationState === VerificationState.PENDING_REVIEW
  ).length;

  const pendingOperatorsCount = allOperators.filter(
    op => isDemoMatch(op) && op.verificationState === VerificationState.PENDING_REVIEW
  ).length;

  const pendingAmbulancesCount = allAmbulances.filter(
    amb => isDemoMatch(amb) && amb.verificationState === VerificationState.PENDING_REVIEW
  ).length;

  const totalVerificationBacklog =
    pendingDriversCount + pendingHospitalsCount + pendingOperatorsCount + pendingAmbulancesCount;

  // ---------------------------------------------------------------------------
  // RETURN UNIFIED ANALYTICS PAYLOAD
  // ---------------------------------------------------------------------------
  return {
    metadata: {
      generatedAt: now.toISOString(),
      dateRange: {
        startDate: startIso,
        endDate: endIso,
        timezone: 'Asia/Kolkata (IST)',
      },
      filtersApplied: {
        includeDemo,
        hospitalId: targetHospitalId || null,
        operatorId: targetOperatorId || null,
        city: params.city || null,
      },
      dataIntegrityNotice:
        'All reported metrics are computed strictly from persisted database records. Missing metrics are reported as null rather than zero. Patient identifiers are de-identified.',
    },
    emergencyRequests: {
      totalRequests,
      statusBreakdown: requestStatusCounts,
      completedCount: completedRequestsCount,
      completionRate: requestCompletionRate,
      cancelledCount: cancelledRequestsCount,
      dailyTrend: dailyRequestBuckets,
    },
    dispatchPerformance: {
      totalOffers,
      acceptedOffers: acceptedOffersCount,
      rejectedOffers: rejectedOffersCount,
      expiredOffers: expiredOffersCount,
      currentlyOffered: currentlyOfferedCount,
      acceptanceRate,
      rejectionRate,
      timeoutRate,
    },
    lifecycleDurations,
    unservedEmergencyDemand,
    fleetAvailability: {
      totalFleetCount,
      hospitalFleetCount,
      privateOperatorFleetCount,
      availableCount: availableAmbulancesCount,
      busyCount: busyAmbulancesCount,
      outOfServiceCount,
      unverifiedOrSuspendedCount: unverifiedOrSuspendedFleetCount,
      availabilityRate: fleetAvailabilityRate,
      byServiceArea: fleetByServiceArea,
    },
    gpsFreshness: {
      totalTracked: totalFleetCount,
      liveCount: liveGpsCount,
      staleCount: staleGpsCount,
      trackingOutageCount,
      trackingFailureRate,
    },
    hospitalCapacity: {
      totalHospitals: filteredHospitals.length,
      freshCount: freshCapacityCount,
      staleCount: staleCapacityCount,
      outdatedCount: outdatedCapacityCount,
      freshnessScore: hospitalFreshnessScore,
      totalBeds: totalBedsAcrossHospitals,
      availableBeds: availableBedsAcrossHospitals,
      overallOccupancyRate,
      hospitals: hospitalCapacityList,
    },
    opdAppointmentsAndQueue: {
      totalAppointments,
      statusBreakdown: appointmentStatusCounts,
      cancellationRate: appointmentCancellationRate,
      activeQueuesWaiting,
      averageWaitMinutes,
    },
    notifications: {
      totalNotifications,
      unreadCount: unreadNotificationsCount,
      readCount: readNotificationsCount,
      readRate: notificationReadRate,
      byType: notificationTypeCounts,
    },
    verificationBacklog: {
      totalPending: totalVerificationBacklog,
      pendingDrivers: pendingDriversCount,
      pendingHospitals: pendingHospitalsCount,
      pendingOperators: pendingOperatorsCount,
      pendingAmbulances: pendingAmbulancesCount,
    },
  };
}

/**
 * Generates sanitized CSV reports with strict Spreadsheet Formula Injection Protection (CWE-1236).
 * Supported types: 'summary' | 'emergency_requests' | 'dispatch_attempts' | 'fleet' | 'appointments' | 'hospitals'
 */
export async function generateAnalyticsCsv(
  type: 'summary' | 'emergency_requests' | 'dispatch_attempts' | 'fleet' | 'appointments' | 'hospitals',
  params: AnalyticsFilterParams
): Promise<{ filename: string; csv: string }> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const analytics = await getEmergencyOperationsAnalytics(params);

  let rows: string[][] = [];
  let filename = `lifelink-analytics-${type}-${timestamp}.csv`;

  if (type === 'summary') {
    rows = [
      ['Report Section', 'Metric', 'Value', 'Unit / Note'],
      ['Emergency Requests', 'Total Requests', String(analytics.emergencyRequests.totalRequests), 'Requests'],
      ['Emergency Requests', 'Completed Requests', String(analytics.emergencyRequests.completedCount), 'Requests'],
      ['Emergency Requests', 'Completion Rate', analytics.emergencyRequests.completionRate !== null ? `${analytics.emergencyRequests.completionRate}%` : 'N/A', '%'],
      ['Dispatch Performance', 'Total Offers', String(analytics.dispatchPerformance.totalOffers), 'Offers'],
      ['Dispatch Performance', 'Acceptance Rate', analytics.dispatchPerformance.acceptanceRate !== null ? `${analytics.dispatchPerformance.acceptanceRate}%` : 'N/A', '%'],
      ['Dispatch Performance', 'Timeout Rate', analytics.dispatchPerformance.timeoutRate !== null ? `${analytics.dispatchPerformance.timeoutRate}%` : 'N/A', '%'],
      ['Lifecycle Durations', 'Avg Request to Assignment', analytics.lifecycleDurations.requestToAssignmentMinutes.averageMinutes !== null ? String(analytics.lifecycleDurations.requestToAssignmentMinutes.averageMinutes) : 'N/A', 'Minutes'],
      ['Lifecycle Durations', 'Avg Assignment to Arrival', analytics.lifecycleDurations.assignmentToArrivalMinutes.averageMinutes !== null ? String(analytics.lifecycleDurations.assignmentToArrivalMinutes.averageMinutes) : 'N/A', 'Minutes'],
      ['Lifecycle Durations', 'Avg Arrival to Pickup', analytics.lifecycleDurations.arrivalToPickupMinutes.averageMinutes !== null ? String(analytics.lifecycleDurations.arrivalToPickupMinutes.averageMinutes) : 'N/A', 'Minutes'],
      ['Lifecycle Durations', 'Avg Pickup to Destination', analytics.lifecycleDurations.pickupToCompletionMinutes.averageMinutes !== null ? String(analytics.lifecycleDurations.pickupToCompletionMinutes.averageMinutes) : 'N/A', 'Minutes'],
      ['Lifecycle Durations', 'Avg Total Mission Time', analytics.lifecycleDurations.totalMissionMinutes.averageMinutes !== null ? String(analytics.lifecycleDurations.totalMissionMinutes.averageMinutes) : 'N/A', 'Minutes'],
      ['Unserved Demand', 'No Eligible Ambulance Count', String(analytics.unservedEmergencyDemand.noEligibleAmbulanceCount), 'Requests'],
      ['Unserved Demand', 'Unserved Rate', analytics.unservedEmergencyDemand.unservedPercentage !== null ? `${analytics.unservedEmergencyDemand.unservedPercentage}%` : 'N/A', '%'],
      ['Fleet Availability', 'Total Ambulances', String(analytics.fleetAvailability.totalFleetCount), 'Vehicles'],
      ['Fleet Availability', 'Available Ambulances', String(analytics.fleetAvailability.availableCount), 'Vehicles'],
      ['Fleet Availability', 'Fleet Availability Rate', analytics.fleetAvailability.availabilityRate !== null ? `${analytics.fleetAvailability.availabilityRate}%` : 'N/A', '%'],
      ['GPS Freshness', 'Live Tracking Count', String(analytics.gpsFreshness.liveCount), 'Vehicles'],
      ['GPS Freshness', 'Tracking Outage Count', String(analytics.gpsFreshness.trackingOutageCount), 'Vehicles'],
      ['GPS Freshness', 'Tracking Outage Rate', analytics.gpsFreshness.trackingFailureRate !== null ? `${analytics.gpsFreshness.trackingFailureRate}%` : 'N/A', '%'],
      ['Hospital Capacity', 'Total Beds', String(analytics.hospitalCapacity.totalBeds), 'Beds'],
      ['Hospital Capacity', 'Available Beds', String(analytics.hospitalCapacity.availableBeds), 'Beds'],
      ['Hospital Capacity', 'Occupancy Rate', analytics.hospitalCapacity.overallOccupancyRate !== null ? `${analytics.hospitalCapacity.overallOccupancyRate}%` : 'N/A', '%'],
      ['Hospital Capacity', 'Freshness Score (<1h)', analytics.hospitalCapacity.freshnessScore !== null ? `${analytics.hospitalCapacity.freshnessScore}%` : 'N/A', '%'],
      ['OPD Appointments', 'Total Appointments', String(analytics.opdAppointmentsAndQueue.totalAppointments), 'Appointments'],
      ['OPD Appointments', 'Cancellation Rate', analytics.opdAppointmentsAndQueue.cancellationRate !== null ? `${analytics.opdAppointmentsAndQueue.cancellationRate}%` : 'N/A', '%'],
      ['Verification Backlog', 'Total Pending Organizations', String(analytics.verificationBacklog.totalPending), 'Entities'],
    ];
  } else if (type === 'emergency_requests') {
    const requests = await prisma.emergencyRequest.findMany({
      include: {
        hospital: { select: { name: true } },
        ambulance: { select: { vehicleNumber: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    rows = [
      ['Request ID', 'Created At (UTC)', 'Status', 'Urgency', 'Category', 'Required Ambulance', 'Hospital Assigned', 'Ambulance Vehicle', 'Is Demo'],
      ...requests
        .filter(r => (params.includeDemo ? true : !r.isDemo))
        .map(r => [
          r.id,
          r.createdAt ? new Date(r.createdAt).toISOString() : '',
          String(r.status),
          String(r.urgencyLevel || 'HIGH'),
          String(r.category || 'GENERAL'),
          String(r.requiredAmbulanceType || 'BASIC_LIFE_SUPPORT'),
          r.hospital?.name || 'Unassigned',
          r.ambulance?.vehicleNumber || 'Unassigned',
          r.isDemo ? 'YES' : 'NO',
        ]),
    ];
  } else if (type === 'fleet') {
    const ambulances = await prisma.ambulance.findMany({
      include: {
        hospital: { select: { name: true, city: true } },
        operator: { select: { name: true, city: true } },
      },
    });

    rows = [
      ['Ambulance ID', 'Vehicle Number', 'Type', 'Organization Type', 'Organization Name', 'City', 'Available', 'Maintenance Status', 'Verification State', 'Last GPS Update'],
      ...ambulances
        .filter(a => (params.includeDemo ? true : !a.isDemo))
        .map(a => [
          a.id,
          a.vehicleNumber,
          String(a.ambulanceType),
          a.hospitalId ? 'HOSPITAL' : a.operatorId ? 'PRIVATE_OPERATOR' : 'INDEPENDENT',
          a.hospital?.name || a.operator?.name || 'Unassigned',
          a.hospital?.city || a.operator?.city || 'Nagpur',
          a.isAvailable ? 'YES' : 'NO',
          String(a.maintenanceStatus || 'ACTIVE'),
          String(a.verificationState),
          a.lastUpdated ? new Date(a.lastUpdated).toISOString() : 'NEVER',
        ]),
    ];
  } else if (type === 'hospitals') {
    rows = [
      ['Hospital ID', 'Hospital Name', 'City', 'Total Beds', 'Available Beds', 'Occupancy Rate %', 'Capacity Freshness', 'Last Updated (UTC)'],
      ...analytics.hospitalCapacity.hospitals.map(h => [
        h.id,
        h.name,
        h.city,
        String(h.totalBeds),
        String(h.availableBeds),
        h.occupancyRate !== null ? `${h.occupancyRate}%` : 'N/A',
        h.capacityFreshness,
        h.lastUpdated ? String(h.lastUpdated) : 'NEVER',
      ]),
    ];
  } else if (type === 'appointments') {
    const appointments = await prisma.appointment.findMany({
      include: {
        hospital: { select: { name: true } },
        doctor: { select: { name: true, specialization: true } },
        slot: { select: { date: true, startTime: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    rows = [
      ['Appointment ID', 'Date', 'Time', 'Doctor Name', 'Specialization', 'Hospital Name', 'Status', 'Token Number', 'Created At (UTC)'],
      ...appointments.map(app => [
        app.id,
        (app as any).slot?.date || (app.createdAt ? new Date(app.createdAt).toISOString().split('T')[0] : ''),
        (app as any).slot?.startTime || '',
        app.doctor?.name || 'Unassigned',
        app.doctor?.specialization || 'General',
        app.hospital?.name || 'Unassigned',
        app.status,
        String(app.tokenNumber),
        app.createdAt ? new Date(app.createdAt).toISOString() : '',
      ]),
    ];
  } else {
    rows = [
      ['Metric', 'Value'],
      ['Export Type', type],
      ['Generated At', new Date().toISOString()],
    ];
  }

  // Sanitize each cell with Formula Injection protection
  const csvContent = rows
    .map(row => row.map(sanitizeCsvField).join(','))
    .join('\r\n');

  return { filename, csv: csvContent };
}
