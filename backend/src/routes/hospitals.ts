import { Router } from 'express';
import { Role, BedStatus, WardType, BookingType, BookingStatus, TriageLevel, VerificationState } from '@prisma/client';
import { authenticate, AuthRequest } from '../middleware/auth';
import prisma from '../db';
import { broadcastToHospital, broadcastToDriver, broadcastToPatient, getIO } from '../socket';
import { logAdminActivity } from '../utils/activityLogger';

const router = Router();

// Helper: Get hospital managed by logged-in admin or user
async function getAdminHospital(userId: string, role?: Role) {
  if (role === Role.ADMIN_HOSPITAL) {
    return prisma.hospital.findUnique({
      where: { adminUserId: userId },
    });
  }
  // For SUPER_ADMIN fallback, get first hospital or check if adminUserId matches
  const direct = await prisma.hospital.findUnique({
    where: { adminUserId: userId },
  });
  if (direct) return direct;
  return prisma.hospital.findFirst();
}

// Helper: Seed realistic default bed layout if hospital has no beds
async function ensureHospitalBeds(hospitalId: string) {
  const hospital = await prisma.hospital.findUnique({ where: { id: hospitalId } });
  if (!hospital) return;
  const count = await prisma.hospitalBed.count({ where: { hospitalId } });
  if (count > 0 || (hospital.totalBeds && hospital.totalBeds > 0)) return;

  const defaultBeds = [
    // 4 ICU Beds
    { bedNumber: 'ICU-01', ward: WardType.ICU, category: 'ICU', status: BedStatus.OCCUPIED, patientName: 'Michael Vance', assignedDoctor: 'Dr. Robert Chen', notes: 'Severe respiratory distress, connected to mechanical ventilator', admittedAt: new Date(Date.now() - 4 * 3600 * 1000) },
    { bedNumber: 'ICU-02', ward: WardType.ICU, category: 'ICU', status: BedStatus.AVAILABLE, notes: 'Telemetry & invasive hemodynamic monitoring ready' },
    { bedNumber: 'ICU-03', ward: WardType.ICU, category: 'ICU', status: BedStatus.AVAILABLE, notes: 'Equipped with Hamilton-C3 transport ventilator' },
    { bedNumber: 'ICU-04', ward: WardType.ICU, category: 'ICU', status: BedStatus.CLEANING, cleaningPriority: 'TERMINAL_DISINFECTION', cleanedBy: 'Sanitation Team Alpha', notes: 'Under ultraviolet terminal disinfection' },

    // 4 Emergency Trauma Resuscitation Bays
    { bedNumber: 'ER-01', ward: WardType.EMERGENCY_ER, category: 'EMERGENCY', status: BedStatus.OCCUPIED, patientName: 'Sophia Chen', assignedDoctor: 'Dr. Sarah Connor', notes: 'STEMI cardiac protocol initiated, Cath lab prepped', admittedAt: new Date(Date.now() - 45 * 60 * 1000) },
    { bedNumber: 'ER-02', ward: WardType.TRAUMA, category: 'EMERGENCY', status: BedStatus.AVAILABLE, notes: 'Rapid infuser & ultrasound triage console on standby' },
    { bedNumber: 'ER-03', ward: WardType.EMERGENCY_ER, category: 'EMERGENCY', status: BedStatus.AVAILABLE, notes: 'General resuscitation bay' },
    { bedNumber: 'ER-04', ward: WardType.TRAUMA, category: 'EMERGENCY', status: BedStatus.RESERVED, notes: 'Reserved for incoming ambulance Medic-12' },

    // 8 General Ward Beds
    { bedNumber: 'GW-101', ward: WardType.GENERAL_WARD, category: 'GENERAL', status: BedStatus.OCCUPIED, patientName: 'James Wilson', assignedDoctor: 'Dr. Angela Martinez', notes: 'Post-laparoscopic recovery, vitals stable', admittedAt: new Date(Date.now() - 24 * 3600 * 1000) },
    { bedNumber: 'GW-102', ward: WardType.GENERAL_WARD, category: 'GENERAL', status: BedStatus.AVAILABLE, notes: 'Standard electric medical bed' },
    { bedNumber: 'GW-103', ward: WardType.GENERAL_WARD, category: 'GENERAL', status: BedStatus.AVAILABLE, notes: 'Low air loss mattress installed' },
    { bedNumber: 'GW-104', ward: WardType.GENERAL_WARD, category: 'GENERAL', status: BedStatus.CLEANING, cleaningPriority: 'ROUTINE', cleanedBy: 'Housekeeper Linda', notes: 'Bed stripped, sanitizing side rails and mattress' },
    { bedNumber: 'GW-105', ward: WardType.GENERAL_WARD, category: 'GENERAL', status: BedStatus.OCCUPIED, patientName: 'Margaret Thatcher', assignedDoctor: 'Dr. Angela Martinez', notes: 'Pneumonia IV antibiotic therapy Day 2', admittedAt: new Date(Date.now() - 48 * 3600 * 1000) },
    { bedNumber: 'GW-106', ward: WardType.GENERAL_WARD, category: 'GENERAL', status: BedStatus.AVAILABLE, notes: 'Standard general inpatient bed' },
    { bedNumber: 'GW-107', ward: WardType.GENERAL_WARD, category: 'GENERAL', status: BedStatus.AVAILABLE, notes: 'Cardiac telemetry step-down bed' },
    { bedNumber: 'GW-108', ward: WardType.GENERAL_WARD, category: 'GENERAL', status: BedStatus.MAINTENANCE, notes: 'Hydraulic elevation mechanism undergoing repair' },

    // 2 Pediatric Beds
    { bedNumber: 'PED-01', ward: WardType.PEDIATRIC, category: 'PEDIATRIC', status: BedStatus.AVAILABLE, notes: 'Pediatric crib bed with safety barrier' },
    { bedNumber: 'PED-02', ward: WardType.PEDIATRIC, category: 'PEDIATRIC', status: BedStatus.OCCUPIED, patientName: 'Liam Miller', assignedDoctor: 'Dr. Sarah Connor', notes: 'Acute viral dehydration, saline infusion active', admittedAt: new Date(Date.now() - 6 * 3600 * 1000) },

    // 2 Surgical Post-Op Beds
    { bedNumber: 'SURG-01', ward: WardType.SURGICAL, category: 'SURGICAL', status: BedStatus.AVAILABLE, notes: 'Post-anesthesia recovery unit bed' },
    { bedNumber: 'SURG-02', ward: WardType.SURGICAL, category: 'SURGICAL', status: BedStatus.OCCUPIED, patientName: 'Robert Johnson', assignedDoctor: 'Dr. Robert Chen', notes: 'Total hip arthroplasty post-op monitoring', admittedAt: new Date(Date.now() - 12 * 3600 * 1000) },
  ];

  await prisma.hospitalBed.createMany({
    data: defaultBeds.map((b) => ({ ...b, hospitalId })),
  });

  const avail = defaultBeds.filter((b) => b.status === BedStatus.AVAILABLE).length;
  await prisma.hospital.update({
    where: { id: hospitalId },
    data: {
      availableBeds: avail,
      totalBeds: defaultBeds.length,
      capacityLastUpdated: new Date(),
    },
  });

  // Also seed a couple realistic bookings if empty
  const bookingCount = await prisma.hospitalBooking.count({ where: { hospitalId } });
  if (bookingCount === 0) {
    await prisma.hospitalBooking.createMany({
      data: [
        {
          hospitalId,
          patientName: 'Sophia Chen',
          patientPhone: '+15550199',
          bookingType: BookingType.EMERGENCY_ADMISSION,
          department: 'Emergency & Trauma ER',
          doctorName: 'Dr. Sarah Connor',
          status: BookingStatus.ADMITTED,
          triageLevel: TriageLevel.RED_CRITICAL,
          symptoms: 'Crushing chest pain radiating to left arm, acute STEMI',
          notes: 'Emergency ambulance inbound matched with bay ER-01',
        },
        {
          hospitalId,
          patientName: 'David Lee',
          patientPhone: '+15550288',
          bookingType: BookingType.OPD_CONSULTATION,
          department: 'Cardiology',
          doctorName: 'Dr. Robert Chen',
          status: BookingStatus.CONFIRMED,
          triageLevel: TriageLevel.YELLOW_URGENT,
          symptoms: 'Exertional dyspnea, palpitations, hypertension history',
          scheduledDate: new Date(Date.now() + 2 * 3600 * 1000),
          notes: 'Echo and ECG requested',
        },
        {
          hospitalId,
          patientName: 'Emma Watson',
          patientPhone: '+15550377',
          bookingType: BookingType.BED_RESERVATION,
          department: 'Orthopedics',
          doctorName: 'Dr. Angela Martinez',
          status: BookingStatus.PENDING,
          triageLevel: TriageLevel.GREEN_ROUTINE,
          symptoms: 'Elective knee arthroscopy scheduled',
          scheduledDate: new Date(Date.now() + 24 * 3600 * 1000),
          notes: 'Pre-op clearance completed',
        },
      ],
    });
  }

  // Synchronize availableBeds count on hospital
  const availCount = await prisma.hospitalBed.count({
    where: { hospitalId, status: BedStatus.AVAILABLE },
  });
  await prisma.hospital.update({
    where: { id: hospitalId },
    data: { availableBeds: availCount },
  });
}

// -------------------------------------------------------------
// Public & Patient Endpoints
// -------------------------------------------------------------

// Haversine distance formula (in km)
function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function formatDistance(distanceKm: number): string {
  if (distanceKm < 1) {
    return `${Math.round(distanceKm * 1000)} m away`;
  }
  return `${distanceKm.toFixed(1)} km away`;
}

// GET /api/hospitals/nearby?lat=&lng=&radius=&search=
// GET /api/v1/hospitals/nearby?lat=&lng=&radiusKm=&radius=&search=
router.get('/nearby', async (req, res) => {
  try {
    const latStr = req.query.lat as string | undefined;
    const lngStr = req.query.lng as string | undefined;
    const radiusStr = (req.query.radiusKm || req.query.radius) as string | undefined;
    const rawSearch = req.query.search as string | undefined;
    const search = rawSearch ? rawSearch.replace(/\s+/g, ' ').trim().toLowerCase() : undefined;

    // Validate coordinates if provided; if neither lat nor lng provided, fall back to manual browse
    const hasCoordinatesQuery = latStr !== undefined || lngStr !== undefined;
    let userLat: number | null = null;
    let userLng: number | null = null;

    if (hasCoordinatesQuery) {
      if (!latStr || !lngStr || latStr.trim() === '' || lngStr.trim() === '') {
        return res.status(400).json({
          success: false,
          code: 'INVALID_COORDINATES',
          error: 'INVALID_COORDINATES: Both latitude (lat) and longitude (lng) must be provided.',
          message: 'Both latitude (lat) and longitude (lng) must be provided.',
        });
      }

      const pLat = parseFloat(latStr);
      const pLng = parseFloat(lngStr);

      if (isNaN(pLat) || isNaN(pLng) || pLat < -90 || pLat > 90 || pLng < -180 || pLng > 180) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_COORDINATES',
          error: 'INVALID_COORDINATES: Valid latitude must be between -90 and 90, and longitude between -180 and 180.',
          message: 'Latitude must be between -90 and 90, and longitude between -180 and 180.',
        });
      }
      userLat = pLat;
      userLng = pLng;
    }

    // Radius validation: cap between 1km and 100km
    let radius = 15;
    if (radiusStr !== undefined) {
      const parsed = parseFloat(radiusStr);
      if (!isNaN(parsed) && parsed > 0) {
        radius = Math.min(100, Math.max(1, parsed));
      }
    }

    const limitStr = req.query.limit as string | undefined;
    const limit = limitStr ? Math.min(50, Math.max(1, parseInt(limitStr, 10))) : 30;

    let hospitals = await prisma.hospital.findMany({
      where: {
        verificationState: { notIn: [VerificationState.SUSPENDED, VerificationState.REJECTED] },
      },
      include: {
        doctors: {
          where: { isActive: true },
          select: {
            id: true,
            name: true,
            specialization: true,
            designation: true,
            experienceYears: true,
            consultationFee: true,
            bookingEnabled: true,
            verificationStatus: true,
            profileUrl: true,
            imageUrl: true,
            sourceUrl: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    // Exclude records with missing or invalid coordinates
    hospitals = hospitals.filter((h) => {
      if (h.lat === null || h.lng === null || isNaN(h.lat) || isNaN(h.lng)) return false;
      if (h.lat < -90 || h.lat > 90 || h.lng < -180 || h.lng > 180) return false;
      return true;
    });

    let combinedHospitals: any[] = hospitals.map((h: any) => ({
      ...h,
      isLifeLinkPartner: h.id === 'hosp-gmch-nagpur' || h.id === 'hosp-mayo-nagpur',
      linkStatus: h.linkStatus || 'LINKED_PARTNER',
      aliases: h.aliases || [],
      alternateNames: h.alternateNames || [],
      locality: h.locality || null,
      specialties: h.specialties || [],
      coverageZone: h.coverageZone || (h.locality?.toLowerCase().includes('rural') || h.address?.toLowerCase().includes('rural') ? 'NAGPUR_DISTRICT_RURAL' : 'NAGPUR_CITY'),
      coverageGroup: h.coverageGroup || 'NAGPUR_CITY',
      verificationStatus: h.verificationState || 'VERIFIED',
    }));

    // Always merge directory facilities unless explicitly disabled with includeDirectory=false
    if (req.query.includeDirectory !== 'false') {
      const dirFacilities = await prisma.directoryFacility.findMany({
        where: {
          isDuplicate: false,
          verificationStatus: { in: ['VERIFIED', 'PENDING_REVIEW'] },
        },
      });

      for (const df of dirFacilities) {
        const dfAny = df as any;
        const existingIdx = combinedHospitals.findIndex(
          (h) => h.id === df.linkedHospitalId || h.id === df.id || h.name.toLowerCase() === df.name.toLowerCase()
        );

        if (existingIdx >= 0) {
          // Merge metadata into existing record if missing
          const existing = combinedHospitals[existingIdx];
          if (!existing.locality && df.locality) existing.locality = df.locality;
          if ((!existing.aliases || existing.aliases.length === 0) && (dfAny.alternateNames || dfAny.aliases)) {
            existing.aliases = dfAny.alternateNames || dfAny.aliases;
          }
          if ((!existing.specialties || existing.specialties.length === 0) && df.specialties) {
            existing.specialties = df.specialties;
          }
          if (!existing.website && df.website) existing.website = df.website;
          if (!existing.coverageZone && df.coverageGroup) existing.coverageZone = df.coverageGroup;
        } else {
          if (df.lat !== null && df.lng !== null && !isNaN(df.lat) && !isNaN(df.lng)) {
            // Find any doctors associated with this directory facility
            const dfDoctors = await prisma.doctor.findMany({
              where: { hospitalId: df.id, isActive: true },
              select: {
                id: true,
                name: true,
                specialization: true,
                designation: true,
                experienceYears: true,
                consultationFee: true,
                bookingEnabled: true,
                verificationStatus: true,
                profileUrl: true,
                imageUrl: true,
                sourceUrl: true,
              },
            });

            const resolvedZone = df.coverageGroup || (df.locality?.toLowerCase().includes('rural') || df.address?.toLowerCase().includes('rural') || (df.tehsil && df.tehsil !== 'Nagpur Urban') ? 'NAGPUR_DISTRICT_RURAL' : 'NAGPUR_CITY');

            combinedHospitals.push({
              id: df.id,
              name: df.name,
              address: df.address,
              locality: df.locality || null,
              aliases: dfAny.alternateNames || dfAny.aliases || [],
              alternateNames: dfAny.alternateNames || [],
              specialties: df.specialties || [],
              contactNumber: df.contactNumber,
              emergencyPhone: df.emergencyPhone || df.emergencyHelpline || null,
              lat: df.lat,
              lng: df.lng,
              availableBeds: 0,
              totalBeds: 0,
              isLifeLinkPartner: false,
              linkStatus: df.linkStatus || 'UNLINKED',
              facilityType: df.facilityType,
              ownership: df.ownership,
              coverageZone: resolvedZone,
              coverageGroup: resolvedZone,
              verificationStatus: df.verificationStatus || 'PUBLIC_DIRECTORY_LISTED',
              sourceUrl: df.sourceUrl,
              website: df.website || null,
              doctors: dfDoctors,
            });
          }
        }
      }
    }

    // Filter by coverage zone if specified (NAGPUR_CITY vs NAGPUR_DISTRICT_RURAL)
    const zoneFilter = (req.query.zone || req.query.coverageZone || req.query.coverageGroup) as string | undefined;
    if (zoneFilter) {
      const normalizedZone = zoneFilter.trim().toUpperCase();
      combinedHospitals = combinedHospitals.filter(
        (h) => h.coverageZone === normalizedZone || h.coverageGroup === normalizedZone
      );
    }

    if (search) {
      combinedHospitals = combinedHospitals.filter((h) => {
        // 1. Direct name match
        if (h.name && h.name.toLowerCase().includes(search)) return true;

        // 2. Address match
        if (h.address && h.address.toLowerCase().includes(search)) return true;

        // 3. Locality / city match
        if (h.locality && h.locality.toLowerCase().includes(search)) return true;
        if (h.city && h.city.toLowerCase().includes(search)) return true;

        // 4. Aliases & Alternate names match (e.g. "Alexis", "Alexis Hospital", "Max Hospital Mankapur")
        const aliases = Array.isArray(h.aliases)
          ? h.aliases
          : (typeof h.aliases === 'string' ? [h.aliases] : []);
        const altNames = Array.isArray(h.alternateNames)
          ? h.alternateNames
          : (typeof h.alternateNames === 'string' ? [h.alternateNames] : []);
        const allAliases = [...aliases, ...altNames];
        if (allAliases.some((a: string) => String(a).toLowerCase().includes(search))) return true;

        // 5. Specialties match
        const specs = Array.isArray(h.specialties)
          ? h.specialties
          : (typeof h.specialties === 'string' ? [h.specialties] : []);
        if (specs.some((s: string) => String(s).toLowerCase().includes(search))) return true;

        // 6. Doctor names, designations, and specializations match
        if (h.doctors && Array.isArray(h.doctors)) {
          const docMatch = h.doctors.some((d: any) =>
            (d.name && d.name.toLowerCase().includes(search)) ||
            (d.specialization && d.specialization.toLowerCase().includes(search)) ||
            (d.designation && d.designation.toLowerCase().includes(search))
          );
          if (docMatch) return true;
        }

        return false;
      });
    }

    hospitals = combinedHospitals;

    if (userLat !== null && userLng !== null) {
      const hospitalsWithDistance = hospitals.map((h) => {
        const distanceKm = haversineDistanceKm(userLat!, userLng!, h.lat, h.lng);
        return {
          ...h,
          distanceKm: Math.round(distanceKm * 100) / 100,
          distanceUnit: 'km',
          distanceType: 'STRAIGHT_LINE_HAVERSINE',
          distanceLabel: `${(Math.round(distanceKm * 10) / 10).toFixed(1)} km away (straight-line geographic distance)`,
        };
      });

      // Filter within radius
      const filtered = hospitalsWithDistance.filter((h) => h.distanceKm <= radius);
      filtered.sort((a, b) => a.distanceKm - b.distanceKm);

      const paginated = filtered.slice(0, limit);
      const isSimulated = req.query.isSimulated === 'true' || req.query.simulated === 'true';

      return res.json({
        success: true,
        hasLocation: true,
        userLocation: { lat: userLat, lng: userLng },
        radiusKm: radius,
        queryRadiusKm: radius,
        distanceType: 'STRAIGHT_LINE_HAVERSINE',
        distanceDisclaimer: 'Distances are straight-line geographic distance calculations. Actual driving distance and ETA may vary based on road routing.',
        count: paginated.length,
        total: filtered.length,
        limit,
        hospitals: paginated,
        isSimulated,
        ...(isSimulated && {
          disclaimer: 'SIMULATED_COORDINATES: Distances are computed using simulated pilot coordinates for development and testing.',
        }),
        ...(filtered.length === 0 && {
          message: 'No verified hospitals found within the specified radius.',
        }),
      });
    }

    // Geolocation absent or denied fallback
    const paginatedFallback = hospitals.slice(0, limit);
    return res.json({
      success: true,
      hasLocation: false,
      fallbackCity: req.query.city ? String(req.query.city).trim() : 'Nagpur',
      count: paginatedFallback.length,
      total: hospitals.length,
      limit,
      hospitals: paginatedFallback.map((h) => ({
        ...h,
        distanceKm: null,
        distanceType: 'UNKNOWN',
        distanceLabel: 'Distance unavailable (location not provided)',
      })),
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to fetch nearby hospitals' });
  }
});

// GET /api/v1/hospitals/:hospitalId/nearby-ambulances?lat=&lng=&radiusKm=
router.get('/:hospitalId/nearby-ambulances', async (req, res) => {
  try {
    const { hospitalId } = req.params;
    const latStr = req.query.lat as string | undefined;
    const lngStr = req.query.lng as string | undefined;
    const radiusStr = (req.query.radiusKm || req.query.radius) as string | undefined;

    // Radius capped between 1km and 100km
    let radius = 25;
    if (radiusStr !== undefined) {
      const parsed = parseFloat(radiusStr);
      if (!isNaN(parsed) && parsed > 0) {
        radius = Math.min(100, Math.max(1, parsed));
      }
    }

    const hospital = await prisma.hospital.findUnique({
      where: { id: hospitalId },
    });

    if (!hospital) {
      return res.status(404).json({
        error: 'HOSPITAL_NOT_FOUND',
        message: 'The requested hospital was not found.',
      });
    }

    let userLat: number | null = null;
    let userLng: number | null = null;
    if (latStr !== undefined || lngStr !== undefined) {
      if (latStr === undefined || lngStr === undefined) {
        return res.status(400).json({
          error: 'INVALID_COORDINATES',
          message: 'Both latitude (lat) and longitude (lng) must be provided.',
        });
      }
      userLat = parseFloat(latStr);
      userLng = parseFloat(lngStr);
      if (isNaN(userLat) || isNaN(userLng) || userLat < -90 || userLat > 90 || userLng < -180 || userLng > 180) {
        return res.status(400).json({
          error: 'INVALID_COORDINATES',
          message: 'Latitude must be between -90 and 90, and longitude between -180 and 180.',
        });
      }
    }

    // Retrieve active ambulances with assigned driver & organization details
    const allAmbulances = await prisma.ambulance.findMany({
      include: {
        hospital: {
          select: { id: true, name: true, verificationState: true },
        },
        operator: {
          select: { id: true, name: true, verificationState: true },
        },
        driver: {
          select: { id: true, isActive: true, isSuspended: true },
        },
      },
    });

    const eligibleAmbulances: any[] = [];
    const nowMs = Date.now();

    for (const amb of allAmbulances) {
      // Determine hospital-owned vs private operator
      const isHospitalOwned = amb.hospitalId === hospital.id;
      const isPrivateOperator = !!amb.operatorId;

      // Only include hospital-owned vehicles for this hospital OR verified private operator vehicles
      if (!isHospitalOwned && !isPrivateOperator) continue;

      // Calculate data freshness & stale GPS check (>30 mins)
      const lastUpdatedMs = amb.lastUpdated ? new Date(amb.lastUpdated).getTime() : 0;
      const ageMinutes = lastUpdatedMs > 0 ? (nowMs - lastUpdatedMs) / (60 * 1000) : 999;

      let dataFreshness: 'LIVE' | 'STALE' | 'UNAVAILABLE' | 'SIMULATED' = 'LIVE';
      if (amb.isDemo) {
        dataFreshness = 'SIMULATED';
      } else if (lastUpdatedMs === 0 || amb.currentLat == null || amb.currentLng == null) {
        dataFreshness = 'UNAVAILABLE';
      } else if (ageMinutes > 30) {
        dataFreshness = 'STALE';
      }

      // Movement status: If telemetry is stale or unavailable, movement is UNKNOWN
      let movementStatus = (amb as any).movementStatus || 'STOPPED';
      let speedKmH = (amb as any).speedKmH || 0;
      if (dataFreshness === 'STALE' || dataFreshness === 'UNAVAILABLE') {
        movementStatus = 'UNKNOWN';
        speedKmH = 0;
      }

      // Dispatch Eligibility Check (Deterministically separate nearby visibility from real dispatch qualification)
      const isVerified = amb.verificationStatus === 'APPROVED' || amb.verificationState === 'VERIFIED';
      const isOperational = amb.maintenanceStatus === 'OPERATIONAL';
      const isDriverQualified = !amb.driver || (amb.driver.isActive && !amb.driver.isSuspended);

      const isEligibleForDispatch =
        amb.isAvailable &&
        !amb.isDemo &&
        isVerified &&
        isOperational &&
        dataFreshness === 'LIVE' &&
        isDriverQualified;

      const distFromHospital = haversineDistanceKm(hospital.lat, hospital.lng, amb.currentLat, amb.currentLng);
      const distFromPatient = userLat !== null && userLng !== null
        ? haversineDistanceKm(userLat, userLng, amb.currentLat, amb.currentLng)
        : null;

      // If user coords provided, filter within radius
      if (distFromPatient !== null && distFromPatient > radius && !isHospitalOwned) {
        continue;
      }

      // Operational status derivation
      let operationalStatus = (amb as any).status || (amb.isAvailable ? 'AVAILABLE' : 'OFFLINE');
      if (!amb.isAvailable && operationalStatus === 'AVAILABLE') {
        operationalStatus = 'RESERVED';
      }

      eligibleAmbulances.push({
        id: amb.id,
        vehicleNumber: amb.vehicleNumber,
        ambulanceType: amb.ambulanceType,
        ownership: isHospitalOwned ? 'HOSPITAL_OWNED' : 'PRIVATE_OPERATOR',
        ownerName: isHospitalOwned ? hospital.name : (amb.operator?.name || 'Private Operator'),
        operationalStatus,
        isEligibleForDispatch,
        dataFreshness,
        movementStatus,
        speedKmH,
        currentLat: amb.currentLat,
        currentLng: amb.currentLng,
        distanceFromHospitalKm: Math.round(distFromHospital * 100) / 100,
        distanceFromPatientKm: distFromPatient !== null ? Math.round(distFromPatient * 100) / 100 : null,
        ageSeconds: lastUpdatedMs > 0 ? Math.round((nowMs - lastUpdatedMs) / 1000) : 999999,
        isDemo: amb.isDemo || false,
      });
    }

    // Sort by proximity to patient if available, else proximity to hospital
    if (userLat !== null) {
      eligibleAmbulances.sort((a, b) => (a.distanceFromPatientKm ?? 999) - (b.distanceFromPatientKm ?? 999));
    } else {
      eligibleAmbulances.sort((a, b) => a.distanceFromHospitalKm - b.distanceFromHospitalKm);
    }

    const isSimulated = req.query.isSimulated === 'true' || req.query.simulated === 'true';

    return res.json({
      success: true,
      hospitalId: hospital.id,
      hospitalName: hospital.name,
      radiusKm: radius,
      distanceType: 'STRAIGHT_LINE_HAVERSINE',
      count: eligibleAmbulances.length,
      totalNearby: eligibleAmbulances.length,
      ambulances: eligibleAmbulances,
      isSimulated,
      ...(isSimulated && {
        disclaimer: 'SIMULATED_COORDINATES: Ambulance distances are computed using simulated pilot coordinates for development and testing.',
      }),
      emergencyDirective: {
        helpline: '112',
        message: eligibleAmbulances.length === 0
          ? 'No active ambulances are currently available near this hospital. Dial 112 immediately for emergency services.'
          : 'For immediate life-threatening emergencies, you can also dial 112 directly.',
      },
      emergencyFallback: {
        notice: eligibleAmbulances.length === 0
          ? 'No active ambulances are currently available near this hospital. For life-threatening emergencies, immediately dial National Emergency 112.'
          : 'For immediate life-threatening emergencies, you can also dial National Emergency 112 directly.',
        emergencyPhone: '112',
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to fetch nearby ambulances' });
  }
});

// GET /api/v1/hospitals/:hospitalId/doctors (and /api/hospitals/:hospitalId/doctors)
// Sourced, validated, and normalized doctors affiliated with this hospital or facility
router.get('/:hospitalId/doctors', async (req, res) => {
  try {
    const { hospitalId } = req.params;
    const rawSpecialization = (req.query.specialization || req.query.specialty) as string | undefined;
    const rawSearch = req.query.search as string | undefined;
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));

    // Resolve hospital or directory facility
    let hospitalRecord: any = await prisma.hospital.findUnique({ where: { id: hospitalId } });
    let facilityRecord: any = null;
    if (!hospitalRecord) {
      facilityRecord = await prisma.directoryFacility.findUnique({ where: { id: hospitalId } });
    }

    // Handle known linked partner aliases (GMCH & Mayo)
    if (!hospitalRecord && !facilityRecord) {
      if (hospitalId === 'fac-gmch-nagpur') {
        hospitalRecord = await prisma.hospital.findUnique({ where: { id: 'hosp-gmch-nagpur' } });
      } else if (hospitalId === 'hosp-gmch-nagpur') {
        facilityRecord = await prisma.directoryFacility.findUnique({ where: { id: 'fac-gmch-nagpur' } });
      } else if (hospitalId === 'fac-iggmc-mayo-nagpur') {
        hospitalRecord = await prisma.hospital.findUnique({ where: { id: 'hosp-mayo-nagpur' } });
      } else if (hospitalId === 'hosp-mayo-nagpur') {
        facilityRecord = await prisma.directoryFacility.findUnique({ where: { id: 'fac-iggmc-mayo-nagpur' } });
      }
    }

    if (!hospitalRecord && !facilityRecord) {
      return res.status(404).json({
        success: false,
        message: `Hospital or medical facility "${hospitalId}" not found`,
      });
    }

    const facilityName = hospitalRecord?.name || facilityRecord?.name;
    const facilityAddress = hospitalRecord?.address || facilityRecord?.address;
    const facilityPhone = hospitalRecord?.contactNumber || facilityRecord?.contactNumber;
    const facilityType = facilityRecord?.facilityType || 'GENERAL_HOSPITAL';
    const ownership = facilityRecord?.ownership || 'UNKNOWN';

    // Aliases to search
    const aliasIds = [hospitalId];
    if (hospitalId === 'fac-gmch-nagpur' && !aliasIds.includes('hosp-gmch-nagpur')) aliasIds.push('hosp-gmch-nagpur');
    if (hospitalId === 'hosp-gmch-nagpur' && !aliasIds.includes('fac-gmch-nagpur')) aliasIds.push('fac-gmch-nagpur');
    if (hospitalId === 'fac-iggmc-mayo-nagpur' && !aliasIds.includes('hosp-mayo-nagpur')) aliasIds.push('hosp-mayo-nagpur');
    if (hospitalId === 'hosp-mayo-nagpur' && !aliasIds.includes('fac-iggmc-mayo-nagpur')) aliasIds.push('fac-iggmc-mayo-nagpur');

    // 1. Fetch doctors directly tied by hospitalId
    let doctors: any[] = await prisma.doctor.findMany({
      where: {
        isActive: true,
        hospitalId: { in: aliasIds },
      },
      include: {
        affiliations: true,
      },
    });

    // 2. Fetch doctors linked via HospitalDoctor many-to-many table
    const affiliations = await prisma.hospitalDoctor.findMany({
      where: {
        hospitalId: { in: aliasIds },
      },
    });

    const affiliatedDocIds = new Set(affiliations.map((a: any) => a.doctorId));
    for (const affDocId of affiliatedDocIds) {
      if (!doctors.some((d: any) => d.id === affDocId)) {
        const doc = await prisma.doctor.findUnique({
          where: { id: affDocId },
          include: { affiliations: true },
        });
        if (doc && doc.isActive) {
          doctors.push(doc);
        }
      }
    }

    // Build unique specialties list
    const allSpecialtiesSet = new Set<string>();
    for (const d of doctors) {
      if (d.specialization) allSpecialtiesSet.add(d.specialization.trim());
      if (Array.isArray(d.specialtiesList)) {
        d.specialtiesList.forEach((s: string) => {
          if (s && s.trim()) allSpecialtiesSet.add(s.trim());
        });
      }
    }
    const specialties = Array.from(allSpecialtiesSet).sort();

    // Specialization filtering
    if (rawSpecialization && rawSpecialization !== 'ALL') {
      const specLower = rawSpecialization.toLowerCase().trim();
      doctors = doctors.filter((d: any) => {
        const primaryMatch = d.specialization && d.specialization.toLowerCase().includes(specLower);
        const designationMatch = d.designation && d.designation.toLowerCase().includes(specLower);
        const listMatch = Array.isArray(d.specialtiesList) && d.specialtiesList.some((s: string) => s.toLowerCase().includes(specLower));
        return primaryMatch || designationMatch || listMatch;
      });
    }

    // Search query filtering
    if (rawSearch) {
      const searchLower = rawSearch.toLowerCase().trim();
      doctors = doctors.filter((d: any) => {
        return (
          (d.name && d.name.toLowerCase().includes(searchLower)) ||
          (d.specialization && d.specialization.toLowerCase().includes(searchLower)) ||
          (d.designation && d.designation.toLowerCase().includes(searchLower)) ||
          (d.qualifications && d.qualifications.toLowerCase().includes(searchLower)) ||
          (d.registrationNumber && d.registrationNumber.toLowerCase().includes(searchLower)) ||
          (Array.isArray(d.specialtiesList) && d.specialtiesList.some((s: string) => s.toLowerCase().includes(searchLower)))
        );
      });
    }

    // Sort alphabetically by name
    doctors.sort((a: any, b: any) => (a.name || '').localeCompare(b.name || ''));

    const total = doctors.length;
    const totalPages = Math.ceil(total / limit) || (total === 0 ? 0 : 1);
    const startIndex = (page - 1) * limit;
    const paginatedDoctors = doctors.slice(startIndex, startIndex + limit).map((d: any) => {
      const aff = (d.affiliations || []).find((a: any) => aliasIds.includes(a.hospitalId)) || null;
      const isPrimary = d.hospitalId === hospitalId || aliasIds.includes(d.hospitalId);

      return {
        id: d.id,
        name: d.name,
        designation: d.designation || null,
        specialization: d.specialization,
        specialtiesList: Array.isArray(d.specialtiesList) && d.specialtiesList.length > 0 ? d.specialtiesList : [d.specialization],
        qualifications: d.qualifications || null,
        experienceYears: d.experienceYears || 0,
        registrationNumber: d.registrationNumber || null,
        registrationAuthority: d.registrationAuthority || 'Maharashtra Medical Council',
        verificationStatus: d.verificationStatus || 'PUBLIC_DIRECTORY_LISTED',
        bookingEnabled: Boolean(d.bookingEnabled),
        consultationFee: d.consultationFee || 0,
        profileUrl: d.profileUrl || null,
        imageUrl: d.imageUrl || null,
        sourceUrl: d.sourceUrl || null,
        affiliation: {
          hospitalId,
          status: aff?.affiliationStatus || (isPrimary ? (d.bookingEnabled ? 'VERIFIED_PARTNER' : 'PRIMARY') : 'VISITING_CONSULTANT'),
          sourceUrl: aff?.sourceUrl || d.sourceUrl || null,
          lastVerifiedAt: aff?.lastVerifiedAt || d.sourceRetrievedAt || new Date(),
        },
      };
    });

    return res.json({
      success: true,
      hospital: {
        id: hospitalId,
        name: facilityName,
        address: facilityAddress,
        contactNumber: facilityPhone,
        facilityType,
        ownership,
        isLifeLinkPartner: Boolean(hospitalRecord?.verificationState === 'VERIFIED' || facilityRecord?.linkStatus === 'LINKED_PARTNER'),
      },
      total,
      page,
      limit,
      totalPages,
      specialties,
      doctors: paginatedDoctors,
      message: total === 0 ? 'No public doctor records are currently indexed for this facility.' : undefined,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to fetch hospital doctors' });
  }
});

// GET /api/v1/hospitals/:id - Get hospital details, verified bed breakdown, and doctor specializations
router.get('/:id', async (req, res, next) => {
  const { id } = req.params;
  if (['nearby', 'capacities', 'beds', 'bookings', 'fleet', 'capacity'].includes(id)) {
    return next();
  }

  try {
    const hospital = await prisma.hospital.findUnique({
      where: { id },
      include: {
        beds: {
          select: { id: true, bedNumber: true, ward: true, status: true, notes: true },
        },
        doctors: {
          where: { isActive: true },
          select: { id: true, name: true, specialization: true, experienceYears: true, consultationFee: true },
        },
      },
    });

    if (!hospital) {
      return res.status(404).json({ success: false, error: 'Hospital not found' });
    }

    if (hospital.beds.length === 0) {
      await ensureHospitalBeds(hospital.id);
    }

    const currentBeds = hospital.beds.length > 0
      ? hospital.beds
      : await prisma.hospitalBed.findMany({ where: { hospitalId: hospital.id } });

    const bedStats = {
      total: currentBeds.length,
      available: currentBeds.filter((b) => b.status === BedStatus.AVAILABLE).length,
      occupied: currentBeds.filter((b) => b.status === BedStatus.OCCUPIED).length,
      cleaning: currentBeds.filter((b) => b.status === BedStatus.CLEANING).length,
      maintenance: currentBeds.filter((b) => b.status === BedStatus.MAINTENANCE).length,
      icuAvailable: currentBeds.filter((b) => b.ward === WardType.ICU && b.status === BedStatus.AVAILABLE).length,
      erAvailable: currentBeds.filter(
        (b) => (b.ward === WardType.EMERGENCY_ER || b.ward === WardType.TRAUMA) && b.status === BedStatus.AVAILABLE
      ).length,
    };

    const hospitalData = {
      id: hospital.id,
      name: hospital.name,
      address: hospital.address,
      contactNumber: hospital.contactNumber,
      city: hospital.city,
      state: hospital.state,
      lat: hospital.lat,
      lng: hospital.lng,
      verificationState: hospital.verificationState,
      isDemo: hospital.isDemo,
      availableBeds: bedStats.available || hospital.availableBeds,
      bedStats,
      doctors: hospital.doctors,
    };

    return res.json({
      success: true,
      ...hospitalData,
      hospital: hospitalData,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message || 'Failed to fetch hospital details' });
  }
});

// GET /api/hospitals - list all hospitals with optional city/state filtering and pagination
router.get('/', async (req, res) => {
  try {
    const search = (req.query.search as string | undefined)?.trim().toLowerCase();
    const city = (req.query.city as string | undefined)?.trim();
    const state = (req.query.state as string | undefined)?.trim();
    const pageStr = req.query.page as string | undefined;
    const limitStr = req.query.limit as string | undefined;

    const where: any = {};
    if (city) {
      where.city = { equals: city, mode: 'insensitive' };
    }
    if (state) {
      where.state = { equals: state, mode: 'insensitive' };
    }

    let hospitals = await prisma.hospital.findMany({
      where: Object.keys(where).length > 0 ? where : undefined,
      include: {
        doctors: {
          where: { isActive: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    if (city) {
      const cLower = city.toLowerCase();
      hospitals = hospitals.filter(
        (h) => (h.city && h.city.toLowerCase() === cLower) || (h.address && h.address.toLowerCase().includes(cLower))
      );
    }

    if (state) {
      const sLower = state.toLowerCase();
      hospitals = hospitals.filter(
        (h) => (h.state && h.state.toLowerCase() === sLower) || (h.address && h.address.toLowerCase().includes(sLower))
      );
    }

    if (search) {
      hospitals = hospitals.filter(
        (h) =>
          h.name.toLowerCase().includes(search) ||
          h.address.toLowerCase().includes(search)
      );
    }

    if (pageStr !== undefined || limitStr !== undefined) {
      const page = Math.max(1, parseInt(pageStr || '1', 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(limitStr || '10', 10) || 10));
      const total = hospitals.length;
      const totalPages = Math.ceil(total / limit) || 1;
      const paginated = hospitals.slice((page - 1) * limit, page * limit);
      return res.json({
        data: paginated,
        meta: {
          total,
          page,
          limit,
          totalPages,
        },
      });
    }

    return res.json(hospitals);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to fetch hospitals' });
  }
});

// Helper: Calculate sanitized public capacity summary and category breakdown
interface BedCategoryStat {
  available: number;
  occupied: number;
  cleaning: number;
  maintenance: number;
  reserved: number;
  unavailable: number;
  total: number;
  occupancyPercent: number;
}

function calculateHospitalCapacityPayload(hospital: any, beds: any[] = []) {
  const hasWardBreakdown = Array.isArray(beds) && beds.length > 0;
  const totalBeds = hasWardBreakdown ? beds.length : (hospital.totalBeds || hospital.availableBeds || 0);
  const availableBeds = hasWardBreakdown
    ? beds.filter((b) => b.status === BedStatus.AVAILABLE).length
    : (hospital.availableBeds || 0);
  const occupiedBeds = hasWardBreakdown
    ? beds.filter((b) => b.status === BedStatus.OCCUPIED).length
    : Math.max(0, totalBeds - availableBeds);
  const cleaningBeds = hasWardBreakdown ? beds.filter((b) => b.status === BedStatus.CLEANING).length : 0;
  const maintenanceBeds = hasWardBreakdown ? beds.filter((b) => b.status === BedStatus.MAINTENANCE).length : 0;
  const reservedBeds = hasWardBreakdown ? beds.filter((b) => b.status === BedStatus.RESERVED).length : 0;
  const unavailableBeds = hasWardBreakdown ? beds.filter((b) => b.status === 'UNAVAILABLE').length : 0;

  const getStats = (catName: string, wards: WardType[]): BedCategoryStat => {
    if (!hasWardBreakdown) {
      return {
        available: 0,
        occupied: 0,
        cleaning: 0,
        maintenance: 0,
        reserved: 0,
        unavailable: 0,
        total: 0,
        occupancyPercent: 0,
      };
    }
    const matching = beds.filter((b) =>
      (b.category && b.category.toUpperCase() === catName.toUpperCase()) ||
      wards.includes(b.ward)
    );
    const avail = matching.filter((b) => b.status === BedStatus.AVAILABLE).length;
    const occ = matching.filter((b) => b.status === BedStatus.OCCUPIED).length;
    const clean = matching.filter((b) => b.status === BedStatus.CLEANING).length;
    const maint = matching.filter((b) => b.status === BedStatus.MAINTENANCE).length;
    const res = matching.filter((b) => b.status === BedStatus.RESERVED).length;
    const unavail = matching.filter((b) => b.status === 'UNAVAILABLE').length;
    const tot = matching.length;
    return {
      available: avail,
      occupied: occ,
      cleaning: clean,
      maintenance: maint,
      reserved: res,
      unavailable: unavail,
      total: tot,
      occupancyPercent: tot > 0 ? Math.min(100, Math.round(((tot - avail) / tot) * 100)) : 0,
    };
  };

  const icu = getStats('ICU', [WardType.ICU]);
  const er = getStats('EMERGENCY', [WardType.EMERGENCY_ER, WardType.TRAUMA]);
  const general = getStats('GENERAL', [WardType.GENERAL_WARD]);
  const pediatric = getStats('PEDIATRIC', [WardType.PEDIATRIC]);
  const surgical = getStats('SURGICAL', [WardType.SURGICAL]);

  // Support hospital configured custom categories
  const customCategories: Record<string, BedCategoryStat> = {};
  if (Array.isArray(hospital.configuredCategories)) {
    for (const cat of hospital.configuredCategories) {
      if (cat.name && !['ICU', 'EMERGENCY', 'GENERAL', 'PEDIATRIC', 'SURGICAL'].includes(cat.name.toUpperCase())) {
        customCategories[cat.name.toLowerCase()] = getStats(cat.name, []);
      }
    }
  }

  const occupancyPercent = totalBeds > 0
    ? Math.min(100, Math.round(((totalBeds - availableBeds) / totalBeds) * 100))
    : 0;

  const lastUpdated = hospital.capacityLastUpdated || hospital.updatedAt || new Date();
  const lastUpdatedMs = new Date(lastUpdated).getTime();
  const ageMinutes = Math.max(0, Math.round((Date.now() - lastUpdatedMs) / (60 * 1000)));
  const isStale = ageMinutes > 30;

  // Truthful data freshness semantics: NEVER claim false "LIVE TELEMETRY"
  const dataFreshness = isStale
    ? 'STALE_VERIFICATION_REQUIRED'
    : hasWardBreakdown
    ? 'WARD_DESK_VERIFIED'
    : 'HOSPITAL_REPORTED_RECENT';

  const dataSourceLabel = hasWardBreakdown
    ? 'Ward Management Desk'
    : 'Hospital-Reported Aggregate';

  const staleWarning = isStale
    ? `Capacity data was last verified ${ageMinutes} minutes ago. Please call hospital directly at ${hospital.contactNumber || 'facility'} or dial emergency helpline 112 to confirm immediate bed availability.`
    : null;

  return {
    id: hospital.id,
    name: hospital.name,
    locality: hospital.locality || null,
    address: hospital.address,
    contactNumber: hospital.contactNumber,
    city: hospital.city,
    state: hospital.state,
    lat: hospital.lat,
    lng: hospital.lng,
    totalBeds,
    availableBeds,
    occupiedBeds,
    cleaningBeds,
    maintenanceBeds,
    reservedBeds,
    unavailableBeds,
    occupancyPercent,
    lastUpdated: new Date(lastUpdated).toISOString(),
    ageMinutes,
    isStale,
    dataFreshness,
    dataSourceLabel,
    hasWardBreakdown,
    staleWarning,
    wards: {
      icu: hasWardBreakdown ? { available: icu.available, total: icu.total } : { available: null, total: null },
      er: hasWardBreakdown ? { available: er.available, total: er.total } : { available: null, total: null },
      general: hasWardBreakdown ? { available: general.available, total: general.total } : { available: null, total: null },
      pediatric: hasWardBreakdown ? { available: pediatric.available, total: pediatric.total } : { available: null, total: null },
      surgical: hasWardBreakdown ? { available: surgical.available, total: surgical.total } : { available: null, total: null },
      ...customCategories,
    },
    categoryBreakdown: {
      icu,
      emergency: er,
      general,
      pediatric,
      surgical,
      ...customCategories,
    },
    categories: {
      icu,
      emergency: er,
      general,
      pediatric,
      surgical,
      ...customCategories,
    },
  };
}

// List all hospitals with detailed live bed capacities (Public summary)
router.get('/capacities', async (req, res) => {
  try {
    const city = (req.query.city as string | undefined)?.trim().toLowerCase();
    const state = (req.query.state as string | undefined)?.trim().toLowerCase();

    let hospitals = await prisma.hospital.findMany({
      include: {
        beds: {
          select: { ward: true, category: true, status: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    // Only seed default test beds if a facility has zero beds AND zero total capacity
    for (const h of hospitals) {
      if ((!h.beds || h.beds.length === 0) && (!h.totalBeds || h.totalBeds === 0)) {
        await ensureHospitalBeds(h.id);
        h.beds = await prisma.hospitalBed.findMany({
          where: { hospitalId: h.id },
          select: { ward: true, category: true, status: true },
        });
      }
    }

    if (city) {
      hospitals = hospitals.filter(
        (h) => (h.city && h.city.toLowerCase() === city) || (h.address && h.address.toLowerCase().includes(city))
      );
    }

    if (state) {
      hospitals = hospitals.filter(
        (h) => (h.state && h.state.toLowerCase() === state) || (h.address && h.address.toLowerCase().includes(state))
      );
    }

    const enriched = hospitals.map((h) => calculateHospitalCapacityPayload(h, h.beds));

    return res.json(enriched);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to fetch hospital capacities' });
  }
});

// Dedicated public capacity summary for a single hospital
router.get('/:id/capacity', async (req, res) => {
  try {
    const { id } = req.params;
    const hospital = await prisma.hospital.findUnique({
      where: { id },
      include: {
        beds: {
          select: { ward: true, category: true, status: true },
        },
      },
    });

    if (!hospital) {
      return res.status(404).json({ success: false, error: 'Hospital not found' });
    }

    const payload = calculateHospitalCapacityPayload(hospital, hospital.beds);
    return res.json({
      success: true,
      ...payload,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to fetch hospital capacity' });
  }
});

// Update hospital bed capacity & category configuration (Hospital Admin & Super Admin)
const updateHospitalCapacityHandler = async (req: AuthRequest, res: any) => {
  if (!req.user || (req.user.role !== Role.ADMIN_HOSPITAL && req.user.role !== Role.SUPER_ADMIN)) {
    return res.status(403).json({ message: 'Forbidden: Only hospital administrators can update capacity' });
  }

  const { id } = req.params;
  const { availableBeds, totalBeds, categories, reason } = req.body;

  try {
    const hospital = await prisma.hospital.findUnique({ where: { id } });
    if (!hospital) {
      return res.status(404).json({ message: 'Hospital not found' });
    }

    // Tenant isolation: Hospital Admin cannot modify another hospital's capacity
    if (req.user.role === Role.ADMIN_HOSPITAL) {
      const adminHospital = await getAdminHospital(req.user.id, req.user.role);
      if (!adminHospital || adminHospital.id !== id) {
        return res.status(403).json({
          message: 'Forbidden: You cannot modify capacity for an unrelated hospital',
          code: 'UNAUTHORIZED_HOSPITAL_ACCESS',
        });
      }
    }

    const prevAvailable = hospital.availableBeds ?? 0;
    const prevTotal = hospital.totalBeds ?? hospital.availableBeds ?? 0;

    let targetTotal = totalBeds !== undefined ? totalBeds : prevTotal;
    let targetAvailable = availableBeds !== undefined ? availableBeds : prevAvailable;

    if (typeof targetTotal !== 'number' || isNaN(targetTotal) || targetTotal < 0) {
      return res.status(400).json({
        code: 'INVALID_CAPACITY_COUNT',
        message: 'Total beds count must be a non-negative number',
      });
    }

    if (typeof targetAvailable !== 'number' || isNaN(targetAvailable) || targetAvailable < 0) {
      return res.status(400).json({
        code: 'INVALID_CAPACITY_COUNT',
        message: 'Available beds count cannot be negative',
      });
    }

    if (targetAvailable > targetTotal) {
      return res.status(400).json({
        code: 'INVALID_CAPACITY_COUNT',
        message: 'Available beds cannot exceed total configured beds',
      });
    }

    // Validate against currently occupied beds
    const currentOccupied = await prisma.hospitalBed.count({
      where: { hospitalId: id, status: BedStatus.OCCUPIED },
    });

    if (targetTotal < currentOccupied) {
      return res.status(400).json({
        code: 'CAPACITY_BELOW_OCCUPANCY',
        message: `Total beds cannot be reduced below the number of currently occupied beds (${currentOccupied})`,
      });
    }

    // Concurrency control via transaction
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.hospital.update({
        where: { id },
        data: {
          availableBeds: targetAvailable,
          totalBeds: targetTotal,
          configuredCategories: categories !== undefined ? categories : hospital.configuredCategories,
          capacityLastUpdated: new Date(),
        },
      });

      // Record Capacity Audit Log
      const auditLog = await tx.hospitalCapacityAuditLog.create({
        data: {
          hospitalId: id,
          changedById: req.user!.id,
          changedByName: req.user!.name || 'Hospital Admin',
          changedByRole: req.user!.role,
          action: 'CAPACITY_CONFIG_UPDATED',
          category: req.body.category || 'ALL',
          previousAvailable: prevAvailable,
          newAvailable: targetAvailable,
          previousTotal: prevTotal,
          newTotal: targetTotal,
          previousOccupied: currentOccupied,
          newOccupied: currentOccupied,
          reason: reason || 'Hospital administrator manual capacity update',
          metadata: categories ? { categories } : undefined,
          timestamp: new Date(),
        },
      });

      return { updated, auditLog };
    });

    // Record system Activity Log
    await logAdminActivity(req.user.id, 'HOSPITAL_CAPACITY_UPDATED', {
      hospitalId: id,
      previousAvailable: prevAvailable,
      newAvailable: targetAvailable,
      previousTotal: prevTotal,
      newTotal: targetTotal,
      reason,
    });

    // Broadcast real-time Socket.IO event
    const io = getIO();
    if (io) {
      io.to('hospital_room').emit('hospital:capacity_updated', {
        hospitalId: id,
        availableBeds: targetAvailable,
        totalBeds: targetTotal,
        lastUpdated: new Date().toISOString(),
      });

      // Code Red alert if capacity is exhausted
      if (targetAvailable === 0) {
        io.to('hospital_room').emit('hospital:critical_capacity_alert', {
          hospitalId: id,
          hospitalName: hospital.name,
          availableBeds: 0,
          totalBeds: targetTotal,
          severity: 'CRITICAL',
          message: `Warning: ${hospital.name} has exhausted bed capacity (0 available beds).`,
        });
      }
    }

    return res.json({
      success: true,
      hospital: result.updated,
      auditLog: result.auditLog,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to update capacity' });
  }
};

router.patch('/:id/capacity', authenticate, updateHospitalCapacityHandler);
router.put('/:id/capacity', authenticate, updateHospitalCapacityHandler);

// View capacity change audit history (Protected: Hospital Admin & Super Admin)
router.get('/:id/capacity-history', authenticate, async (req: AuthRequest, res) => {
  if (!req.user || (req.user.role !== Role.ADMIN_HOSPITAL && req.user.role !== Role.SUPER_ADMIN)) {
    return res.status(403).json({ message: 'Forbidden: Only hospital administrators can access capacity audit logs' });
  }

  const { id } = req.params;

  try {
    const hospital = await prisma.hospital.findUnique({ where: { id } });
    if (!hospital) {
      return res.status(404).json({ message: 'Hospital not found' });
    }

    // Tenant isolation
    if (req.user.role === Role.ADMIN_HOSPITAL) {
      const adminHospital = await getAdminHospital(req.user.id, req.user.role);
      if (!adminHospital || adminHospital.id !== id) {
        return res.status(403).json({
          message: 'Forbidden: You cannot inspect audit logs for an unrelated hospital',
          code: 'UNAUTHORIZED_HOSPITAL_ACCESS',
        });
      }
    }

    const history = await prisma.hospitalCapacityAuditLog.findMany({
      where: { hospitalId: id },
      orderBy: { timestamp: 'desc' },
      take: 50,
    });

    return res.json({
      success: true,
      hospitalId: id,
      count: history.length,
      history,
      auditLogs: history,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to fetch capacity history' });
  }
});

// Patient: Get my hospital admissions and bookings
router.get('/bookings/my', authenticate, async (req: AuthRequest, res) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    const bookings = await prisma.hospitalBooking.findMany({
      where: {
        OR: [
          { patientId: req.user.id },
          ...(req.user.email ? [{ patient: { email: req.user.email } }] : []),
        ],
      },
      include: {
        hospital: { select: { name: true, address: true, contactNumber: true } },
        assignedBed: { select: { bedNumber: true, ward: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.json(bookings);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to fetch patient bookings' });
  }
});

// -------------------------------------------------------------
// Hospital Operations & Bed Management Endpoints
// -------------------------------------------------------------

// List all beds of the logged-in admin's hospital
router.get('/beds', authenticate, async (req: AuthRequest, res) => {
  if (!req.user || (req.user.role !== Role.ADMIN_HOSPITAL && req.user.role !== Role.SUPER_ADMIN)) {
    return res.status(403).json({ message: 'Forbidden: Only hospital administrators can access bed management' });
  }

  try {
    const hospital = await getAdminHospital(req.user.id, req.user.role);
    if (!hospital) {
      return res.status(404).json({ message: 'Hospital not found for this administrator' });
    }

    // Ensure realistic beds exist
    await ensureHospitalBeds(hospital.id);

    const beds = await prisma.hospitalBed.findMany({
      where: { hospitalId: hospital.id },
      orderBy: [{ ward: 'asc' }, { bedNumber: 'asc' }],
    });

    // Compute comprehensive statistics
    const stats = {
      total: beds.length,
      available: beds.filter((b) => b.status === BedStatus.AVAILABLE).length,
      occupied: beds.filter((b) => b.status === BedStatus.OCCUPIED).length,
      cleaning: beds.filter((b) => b.status === BedStatus.CLEANING).length,
      maintenance: beds.filter((b) => b.status === BedStatus.MAINTENANCE).length,
      reserved: beds.filter((b) => b.status === BedStatus.RESERVED).length,
      icuAvailable: beds.filter((b) => b.ward === WardType.ICU && b.status === BedStatus.AVAILABLE).length,
      erAvailable: beds.filter((b) => (b.ward === WardType.EMERGENCY_ER || b.ward === WardType.TRAUMA) && b.status === BedStatus.AVAILABLE).length,
    };

    return res.json({ beds, stats, hospital });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to fetch hospital beds' });
  }
});

// Add new bed to hospital
router.post('/beds', authenticate, async (req: AuthRequest, res) => {
  if (!req.user || (req.user.role !== Role.ADMIN_HOSPITAL && req.user.role !== Role.SUPER_ADMIN)) {
    return res.status(403).json({ message: 'Forbidden' });
  }

  const { bedNumber, ward, category, notes } = req.body;

  if (!bedNumber || typeof bedNumber !== 'string' || bedNumber.trim() === '') {
    return res.status(400).json({ code: 'INVALID_BED_NUMBER', message: 'Bed number is required and cannot be empty' });
  }

  try {
    const hospital = await getAdminHospital(req.user.id, req.user.role);
    if (!hospital) {
      return res.status(404).json({ message: 'Hospital not found' });
    }

    const trimmedBedNumber = bedNumber.trim();
    const existing = await prisma.hospitalBed.findFirst({
      where: { hospitalId: hospital.id, bedNumber: trimmedBedNumber },
    });
    if (existing) {
      return res.status(400).json({ message: `Bed ${trimmedBedNumber} already exists in this hospital` });
    }

    const bedCategory = category || (
      ward === WardType.ICU ? 'ICU' :
      ward === WardType.EMERGENCY_ER || ward === WardType.TRAUMA ? 'EMERGENCY' :
      ward === WardType.PEDIATRIC ? 'PEDIATRIC' :
      ward === WardType.SURGICAL ? 'SURGICAL' : 'GENERAL'
    );

    const prevAvail = hospital.availableBeds ?? 0;
    const prevTotal = hospital.totalBeds ?? hospital.availableBeds ?? 0;

    const result = await prisma.$transaction(async (tx) => {
      const newBed = await tx.hospitalBed.create({
        data: {
          hospitalId: hospital.id,
          bedNumber: trimmedBedNumber,
          ward: ward || WardType.GENERAL_WARD,
          category: bedCategory,
          status: BedStatus.AVAILABLE,
          notes: notes || '',
        },
      });

      const avail = await tx.hospitalBed.count({
        where: { hospitalId: hospital.id, status: BedStatus.AVAILABLE },
      });
      const total = await tx.hospitalBed.count({
        where: { hospitalId: hospital.id },
      });

      await tx.hospital.update({
        where: { id: hospital.id },
        data: {
          availableBeds: avail,
          totalBeds: total,
          capacityLastUpdated: new Date(),
        },
      });

      await tx.hospitalCapacityAuditLog.create({
        data: {
          hospitalId: hospital.id,
          changedById: req.user!.id,
          changedByName: req.user!.name || 'Hospital Admin',
          changedByRole: req.user!.role,
          action: 'BED_ADDED',
          category: bedCategory,
          previousAvailable: prevAvail,
          newAvailable: avail,
          previousTotal: prevTotal,
          newTotal: total,
          reason: `Added new bed ${newBed.bedNumber}`,
          timestamp: new Date(),
        },
      });

      return newBed;
    });

    const io = getIO();
    if (io) {
      io.to('hospital_room').emit('hospital:bed_updated', result);
      io.emit('hospital:bed_updated', result);
      io.to('hospital_room').emit('hospital:capacity_updated', {
        hospitalId: hospital.id,
        availableBeds: prevAvail + 1,
        totalBeds: prevTotal + 1,
      });
      io.emit('hospital:capacity_updated', {
        hospitalId: hospital.id,
        availableBeds: prevAvail + 1,
        totalBeds: prevTotal + 1,
      });
    }

    return res.status(201).json(result);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to create bed' });
  }
});

// Update Bed status (Admit, Transfer, Discharge -> Cleaning, Maintenance, Unavailable)
router.put('/beds/:id', authenticate, async (req: AuthRequest, res) => {
  if (!req.user || (req.user.role !== Role.ADMIN_HOSPITAL && req.user.role !== Role.SUPER_ADMIN)) {
    return res.status(403).json({ message: 'Forbidden' });
  }

  const { id } = req.params;
  const { status, patientName, patientId, assignedDoctor, notes, cleaningPriority, ward, category, bedNumber } = req.body;

  try {
    const bed = await prisma.hospitalBed.findUnique({ where: { id } });
    if (!bed) {
      return res.status(404).json({ message: 'Bed record not found' });
    }

    // Tenant isolation: Hospital Admin cannot modify beds of an unrelated hospital
    if (req.user.role === Role.ADMIN_HOSPITAL) {
      const adminHospital = await getAdminHospital(req.user.id, req.user.role);
      if (!adminHospital || bed.hospitalId !== adminHospital.id) {
        return res.status(403).json({
          message: 'Forbidden: You cannot modify beds for an unrelated hospital',
          code: 'UNAUTHORIZED_HOSPITAL_ACCESS',
        });
      }
    }

    // Concurrency check: If attempting to admit into an already occupied bed
    if (status === BedStatus.OCCUPIED && bed.status === BedStatus.OCCUPIED && patientId && bed.patientId !== patientId) {
      return res.status(409).json({
        code: 'BED_ALREADY_OCCUPIED',
        message: `Bed ${bed.bedNumber} is already occupied by another patient (${bed.patientName || 'Admitted Patient'}).`,
      });
    }

    const updateData: any = {};
    if (ward) updateData.ward = ward;
    if (category) updateData.category = category;
    if (bedNumber) updateData.bedNumber = bedNumber;
    if (notes !== undefined) updateData.notes = notes;

    if (status) {
      updateData.status = status;

      if (status === BedStatus.OCCUPIED) {
        updateData.patientName = patientName || 'Admitted Patient';
        updateData.patientId = patientId || null;
        updateData.assignedDoctor = assignedDoctor || 'Staff Physician';
        updateData.admittedAt = new Date();
        updateData.cleaningPriority = null;
        updateData.cleanedBy = null;
      } else if (status === BedStatus.CLEANING) {
        // Patient discharged, bed vacated -> Needs sanitation
        updateData.cleaningPriority = cleaningPriority || 'URGENT';
        updateData.patientName = null;
        updateData.patientId = null;
        updateData.assignedDoctor = null;
        updateData.admittedAt = null;
      } else if (status === BedStatus.AVAILABLE) {
        updateData.patientName = null;
        updateData.patientId = null;
        updateData.assignedDoctor = null;
        updateData.cleaningPriority = null;
        updateData.admittedAt = null;
      } else if (status === BedStatus.MAINTENANCE || status === 'UNAVAILABLE') {
        updateData.patientName = null;
        updateData.patientId = null;
        updateData.assignedDoctor = null;
      }
    }

    const hospital = await prisma.hospital.findUnique({ where: { id: bed.hospitalId } });
    const prevAvail = hospital?.availableBeds ?? 0;
    const prevTotal = hospital?.totalBeds ?? hospital?.availableBeds ?? 0;

    const updatedBed = await prisma.$transaction(async (tx) => {
      const resBed = await tx.hospitalBed.update({
        where: { id },
        data: updateData,
      });

      // Recalculate available count
      const avail = await tx.hospitalBed.count({
        where: { hospitalId: bed.hospitalId, status: BedStatus.AVAILABLE },
      });
      await tx.hospital.update({
        where: { id: bed.hospitalId },
        data: {
          availableBeds: avail,
          capacityLastUpdated: new Date(),
        },
      });

      // Audit log entry
      const actionName = status === BedStatus.OCCUPIED
        ? 'PATIENT_ADMITTED'
        : status === BedStatus.CLEANING
        ? 'PATIENT_DISCHARGED'
        : status === BedStatus.AVAILABLE
        ? 'BED_RELEASED'
        : 'BED_STATUS_CHANGED';

      await tx.hospitalCapacityAuditLog.create({
        data: {
          hospitalId: bed.hospitalId,
          changedById: req.user!.id,
          changedByName: req.user!.name || 'Hospital Admin',
          changedByRole: req.user!.role,
          action: actionName,
          category: resBed.category || resBed.ward,
          previousAvailable: prevAvail,
          newAvailable: avail,
          previousTotal: prevTotal,
          newTotal: prevTotal,
          reason: notes || `Bed ${resBed.bedNumber} status updated to ${resBed.status}`,
          timestamp: new Date(),
        },
      });

      return resBed;
    });

    const io = getIO();
    if (io) {
      const availCount = await prisma.hospitalBed.count({ where: { hospitalId: bed.hospitalId, status: BedStatus.AVAILABLE } });
      io.to('hospital_room').emit('hospital:bed_updated', updatedBed);
      io.emit('hospital:bed_updated', updatedBed);
      io.to('hospital_room').emit('hospital:capacity_updated', {
        hospitalId: bed.hospitalId,
        availableBeds: availCount,
      });
      io.emit('hospital:capacity_updated', {
        hospitalId: bed.hospitalId,
        availableBeds: availCount,
      });
    }

    // Record activity log for super admin monitoring
    await logAdminActivity(req.user!.id, 'BED_STATUS_UPDATED', {
      bedId: id,
      bedNumber: updatedBed.bedNumber,
      status: updatedBed.status,
      patientName: updatedBed.patientName || undefined,
      ward: updatedBed.ward,
    });

    return res.json(updatedBed);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to update bed' });
  }
});

// Remove Bed from Hospital (Protected: Hospital Admin & Super Admin)
router.delete('/beds/:id', authenticate, async (req: AuthRequest, res) => {
  if (!req.user || (req.user.role !== Role.ADMIN_HOSPITAL && req.user.role !== Role.SUPER_ADMIN)) {
    return res.status(403).json({ message: 'Forbidden' });
  }

  const { id } = req.params;

  try {
    const bed = await prisma.hospitalBed.findUnique({ where: { id } });
    if (!bed) {
      return res.status(404).json({ message: 'Bed not found' });
    }

    // Tenant isolation
    if (req.user.role === Role.ADMIN_HOSPITAL) {
      const adminHospital = await getAdminHospital(req.user.id, req.user.role);
      if (!adminHospital || bed.hospitalId !== adminHospital.id) {
        return res.status(403).json({
          message: 'Forbidden: You cannot delete beds for an unrelated hospital',
          code: 'UNAUTHORIZED_HOSPITAL_ACCESS',
        });
      }
    }

    // Safety check: Cannot delete occupied bed
    if (bed.status === BedStatus.OCCUPIED) {
      return res.status(400).json({
        code: 'CANNOT_DELETE_OCCUPIED_BED',
        message: 'Cannot delete bed while a patient is currently admitted. Discharge or transfer the patient first.',
      });
    }

    const hospital = await prisma.hospital.findUnique({ where: { id: bed.hospitalId } });
    const prevAvail = hospital?.availableBeds ?? 0;
    const prevTotal = hospital?.totalBeds ?? hospital?.availableBeds ?? 0;

    await prisma.$transaction(async (tx) => {
      await tx.hospitalBed.delete({ where: { id } });

      const avail = await tx.hospitalBed.count({
        where: { hospitalId: bed.hospitalId, status: BedStatus.AVAILABLE },
      });
      const total = await tx.hospitalBed.count({
        where: { hospitalId: bed.hospitalId },
      });

      await tx.hospital.update({
        where: { id: bed.hospitalId },
        data: {
          availableBeds: avail,
          totalBeds: total,
          capacityLastUpdated: new Date(),
        },
      });

      await tx.hospitalCapacityAuditLog.create({
        data: {
          hospitalId: bed.hospitalId,
          changedById: req.user!.id,
          changedByName: req.user!.name || 'Hospital Admin',
          changedByRole: req.user!.role,
          action: 'BED_REMOVED',
          category: bed.category || bed.ward,
          previousAvailable: prevAvail,
          newAvailable: avail,
          previousTotal: prevTotal,
          newTotal: total,
          reason: `Bed ${bed.bedNumber} removed by administrator`,
          timestamp: new Date(),
        },
      });
    });

    const io = getIO();
    if (io) {
      io.to('hospital_room').emit('hospital:bed_deleted', { bedId: id });
    }

    return res.json({ success: true, message: `Bed ${bed.bedNumber} successfully deleted` });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to delete bed' });
  }
});

// Housekeeping: Start Cleaning / Mark Sanitized & Ready
router.post('/beds/:id/clean', authenticate, async (req: AuthRequest, res) => {
  if (!req.user || (req.user.role !== Role.ADMIN_HOSPITAL && req.user.role !== Role.SUPER_ADMIN)) {
    return res.status(403).json({ message: 'Forbidden' });
  }

  const { id } = req.params;
  const { action, cleanedBy } = req.body; // action: 'START' | 'COMPLETE'

  try {
    const bed = await prisma.hospitalBed.findUnique({ where: { id } });
    if (!bed) {
      return res.status(404).json({ message: 'Bed not found' });
    }

    // Tenant isolation: Hospital Admin cannot modify cleanings of an unrelated hospital
    if (req.user.role === Role.ADMIN_HOSPITAL) {
      const adminHospital = await getAdminHospital(req.user.id, req.user.role);
      if (!adminHospital || bed.hospitalId !== adminHospital.id) {
        return res.status(403).json({
          message: 'Forbidden: You cannot modify beds for an unrelated hospital',
          code: 'UNAUTHORIZED_HOSPITAL_ACCESS',
        });
      }
    }

    let updatedBed;
    if (action === 'START') {
      updatedBed = await prisma.hospitalBed.update({
        where: { id },
        data: {
          status: BedStatus.CLEANING,
          cleanedBy: cleanedBy || 'Housekeeping Staff',
        },
      });
    } else {
      // COMPLETE sanitation -> Ready for next patient
      updatedBed = await prisma.hospitalBed.update({
        where: { id },
        data: {
          status: BedStatus.AVAILABLE,
          cleanedBy: cleanedBy || bed.cleanedBy || 'Sanitation Team',
          lastCleanedAt: new Date(),
          cleaningPriority: null,
          patientName: null,
          patientId: null,
        },
      });

      // Update available count
      const avail = await prisma.hospitalBed.count({
        where: { hospitalId: bed.hospitalId, status: BedStatus.AVAILABLE },
      });
      await prisma.hospital.update({
        where: { id: bed.hospitalId },
        data: { availableBeds: avail },
      });
    }

    const io = getIO();
    if (io) {
      io.to('hospital_room').emit('hospital:bed_updated', updatedBed);
      io.emit('hospital:bed_updated', updatedBed);
    }

    return res.json(updatedBed);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to update cleaning status' });
  }
});

// -------------------------------------------------------------
// Admissions & Bookings Hub Endpoints
// -------------------------------------------------------------

// List all admissions and bookings for the hospital
router.get('/bookings', authenticate, async (req: AuthRequest, res) => {
  if (!req.user || (req.user.role !== Role.ADMIN_HOSPITAL && req.user.role !== Role.SUPER_ADMIN)) {
    return res.status(403).json({ message: 'Forbidden' });
  }

  try {
    const hospital = await getAdminHospital(req.user.id, req.user.role);
    if (!hospital) {
      return res.status(404).json({ message: 'Hospital not found' });
    }

    await ensureHospitalBeds(hospital.id);

    const bookings = await prisma.hospitalBooking.findMany({
      where: { hospitalId: hospital.id },
      include: {
        assignedBed: true,
        patient: {
          select: { id: true, name: true, email: true, phone: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.json(bookings);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to fetch bookings' });
  }
});

// Create new admission / booking (Admin walk-in or Patient booking)
router.post('/bookings', authenticate, async (req: AuthRequest, res) => {
  const {
    hospitalId,
    patientName,
    patientPhone,
    bookingType,
    department,
    doctorName,
    scheduledDate,
    triageLevel,
    symptoms,
    assignedBedId,
    notes,
  } = req.body;

  try {
    let targetHospitalId = hospitalId;
    if (!targetHospitalId) {
      const hospital = await getAdminHospital(req.user!.id, req.user!.role as Role);
      if (hospital) targetHospitalId = hospital.id;
    }

    if (!targetHospitalId) {
      return res.status(400).json({ message: 'Target hospital ID is required' });
    }

    const targetHospital = await prisma.hospital.findUnique({ where: { id: targetHospitalId } });
    if (!targetHospital) {
      return res.status(404).json({ message: 'Target hospital not found' });
    }

    const prevAvail = targetHospital.availableBeds ?? 0;
    const prevTotal = targetHospital.totalBeds ?? targetHospital.availableBeds ?? 0;

    const booking = await prisma.$transaction(async (tx) => {
      // Requirement 12 & 13: Atomic reservation check if bed is designated
      if (assignedBedId) {
        const targetBed = await tx.hospitalBed.findUnique({ where: { id: assignedBedId } });
        if (!targetBed) {
          const err: any = new Error('Selected bed does not exist');
          err.status = 404;
          throw err;
        }
        if (targetBed.hospitalId !== targetHospitalId) {
          const err: any = new Error('Selected bed belongs to another facility');
          err.status = 400;
          throw err;
        }
        if (targetBed.status !== BedStatus.AVAILABLE) {
          const err: any = new Error(`Bed ${targetBed.bedNumber} is not available for reservation (current status: ${targetBed.status})`);
          err.status = 409;
          err.code = 'BED_UNAVAILABLE_FOR_RESERVATION';
          throw err;
        }
      }

      const newBooking = await tx.hospitalBooking.create({
        data: {
          hospitalId: targetHospitalId,
          patientId: req.user?.role === Role.PATIENT ? req.user.id : null,
          patientName: patientName || req.user?.name || 'Walk-in Patient',
          patientPhone: patientPhone || '+15550000',
          bookingType: (bookingType as BookingType) || BookingType.EMERGENCY_ADMISSION,
          department: department || 'Emergency ER',
          doctorName: doctorName || 'Attending Physician',
          scheduledDate: scheduledDate ? new Date(scheduledDate) : new Date(),
          triageLevel: (triageLevel as TriageLevel) || TriageLevel.YELLOW_URGENT,
          symptoms: symptoms || '',
          assignedBedId: assignedBedId || null,
          notes: notes || '',
          status: assignedBedId ? BookingStatus.ADMITTED : BookingStatus.CONFIRMED,
        },
        include: { assignedBed: true, hospital: true },
      });

      // If a bed was designated immediately, mark it as OCCUPIED and log audit trail
      if (assignedBedId) {
        const updatedBed = await tx.hospitalBed.update({
          where: { id: assignedBedId },
          data: {
            status: BedStatus.OCCUPIED,
            patientName: newBooking.patientName,
            patientId: newBooking.patientId,
            assignedDoctor: newBooking.doctorName,
            admittedAt: new Date(),
          },
        });

        // Recalculate available beds
        const avail = await tx.hospitalBed.count({
          where: { hospitalId: targetHospitalId, status: BedStatus.AVAILABLE },
        });
        await tx.hospital.update({
          where: { id: targetHospitalId },
          data: {
            availableBeds: avail,
            capacityLastUpdated: new Date(),
          },
        });

        await tx.hospitalCapacityAuditLog.create({
          data: {
            hospitalId: targetHospitalId,
            changedById: req.user!.id,
            changedByName: req.user!.name || 'Hospital Admin',
            changedByRole: req.user!.role,
            action: 'PATIENT_ADMITTED',
            category: updatedBed.category || updatedBed.ward,
            previousAvailable: prevAvail,
            newAvailable: avail,
            previousTotal: prevTotal,
            newTotal: prevTotal,
            reason: `Admitted booking ${newBooking.id} into bed ${updatedBed.bedNumber}`,
            timestamp: new Date(),
          },
        });
      }

      return newBooking;
    });

    const io = getIO();
    if (io) {
      io.to('hospital_room').emit('hospital:booking_created', booking);
      if (assignedBedId) {
        io.to('hospital_room').emit('hospital:capacity_updated', {
          hospitalId: targetHospitalId,
          availableBeds: await prisma.hospitalBed.count({ where: { hospitalId: targetHospitalId, status: BedStatus.AVAILABLE } }),
        });
      }
    }

    return res.status(201).json(booking);
  } catch (error: any) {
    return res.status(error.status || 500).json({
      message: error.message || 'Failed to create booking',
      code: error.code,
    });
  }
});

// Update booking status & bed assignment
router.put('/bookings/:id/status', authenticate, async (req: AuthRequest, res) => {
  if (!req.user || (req.user.role !== Role.ADMIN_HOSPITAL && req.user.role !== Role.SUPER_ADMIN)) {
    return res.status(403).json({ message: 'Forbidden' });
  }

  const { id } = req.params;
  const { status, assignedBedId, doctorName, notes } = req.body;

  try {
    const booking = await prisma.hospitalBooking.findUnique({
      where: { id },
      include: { assignedBed: true },
    });

    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    if (req.user.role === Role.ADMIN_HOSPITAL) {
      const adminHospital = await getAdminHospital(req.user.id, req.user.role);
      if (!adminHospital || booking.hospitalId !== adminHospital.id) {
        return res.status(403).json({
          message: 'Forbidden: You cannot modify bookings for an unrelated hospital',
          code: 'UNAUTHORIZED_HOSPITAL_ACCESS',
        });
      }
    }

    const hospital = await prisma.hospital.findUnique({ where: { id: booking.hospitalId } });
    const prevAvail = hospital?.availableBeds ?? 0;
    const prevTotal = hospital?.totalBeds ?? hospital?.availableBeds ?? 0;

    const updated = await prisma.$transaction(async (tx) => {
      const updateData: any = {};
      if (status) updateData.status = status;
      if (doctorName) updateData.doctorName = doctorName;
      if (notes !== undefined) updateData.notes = notes;
      if (assignedBedId !== undefined) updateData.assignedBedId = assignedBedId;

      // If new bed is being assigned, verify it is AVAILABLE
      if (assignedBedId && assignedBedId !== booking.assignedBedId) {
        const targetBed = await tx.hospitalBed.findUnique({ where: { id: assignedBedId } });
        if (!targetBed) {
          const err: any = new Error('Designated bed not found');
          err.status = 404;
          throw err;
        }
        if (targetBed.hospitalId !== booking.hospitalId) {
          const err: any = new Error('Designated bed belongs to another hospital');
          err.status = 400;
          throw err;
        }
        if (targetBed.status !== BedStatus.AVAILABLE) {
          const err: any = new Error(`Bed ${targetBed.bedNumber} is not available (current status: ${targetBed.status})`);
          err.status = 409;
          err.code = 'BED_UNAVAILABLE_FOR_RESERVATION';
          throw err;
        }
      }

      const resBooking = await tx.hospitalBooking.update({
        where: { id },
        data: updateData,
        include: { assignedBed: true, hospital: true },
      });

      // If status changed to ADMITTED and bed is assigned
      if (status === BookingStatus.ADMITTED && (assignedBedId || booking.assignedBedId)) {
        const bedId = assignedBedId || booking.assignedBedId!;
        const bed = await tx.hospitalBed.update({
          where: { id: bedId },
          data: {
            status: BedStatus.OCCUPIED,
            patientName: resBooking.patientName,
            assignedDoctor: resBooking.doctorName,
            admittedAt: new Date(),
          },
        });

        const avail = await tx.hospitalBed.count({
          where: { hospitalId: booking.hospitalId, status: BedStatus.AVAILABLE },
        });
        await tx.hospital.update({
          where: { id: booking.hospitalId },
          data: { availableBeds: avail, capacityLastUpdated: new Date() },
        });

        await tx.hospitalCapacityAuditLog.create({
          data: {
            hospitalId: booking.hospitalId,
            changedById: req.user!.id,
            changedByName: req.user!.name || 'Hospital Admin',
            changedByRole: req.user!.role,
            action: 'PATIENT_ADMITTED',
            category: bed.category || bed.ward,
            previousAvailable: prevAvail,
            newAvailable: avail,
            previousTotal: prevTotal,
            newTotal: prevTotal,
            reason: `Booking ${resBooking.id} admitted into bed ${bed.bedNumber}`,
            timestamp: new Date(),
          },
        });
      }

      // If status changed to CANCELLED and was previously assigned to a bed, atomically release it back to AVAILABLE
      if (status === BookingStatus.CANCELLED && booking.assignedBedId) {
        const bed = await tx.hospitalBed.update({
          where: { id: booking.assignedBedId },
          data: {
            status: BedStatus.AVAILABLE,
            patientName: null,
            patientId: null,
            assignedDoctor: null,
            cleaningPriority: null,
            admittedAt: null,
          },
        });

        const avail = await tx.hospitalBed.count({
          where: { hospitalId: booking.hospitalId, status: BedStatus.AVAILABLE },
        });
        await tx.hospital.update({
          where: { id: booking.hospitalId },
          data: { availableBeds: avail, capacityLastUpdated: new Date() },
        });

        await tx.hospitalCapacityAuditLog.create({
          data: {
            hospitalId: booking.hospitalId,
            changedById: req.user!.id,
            changedByName: req.user!.name || 'Hospital Admin',
            changedByRole: req.user!.role,
            action: 'RESERVATION_CANCELLED',
            category: bed.category || bed.ward,
            previousAvailable: prevAvail,
            newAvailable: avail,
            previousTotal: prevTotal,
            newTotal: prevTotal,
            reason: `Booking ${resBooking.id} cancelled; released bed ${bed.bedNumber} back to available inventory`,
            timestamp: new Date(),
          },
        });
      }

      // If status changed to COMPLETED and was previously assigned to a bed, transition to CLEANING
      if (status === BookingStatus.COMPLETED && booking.assignedBedId) {
        const bed = await tx.hospitalBed.update({
          where: { id: booking.assignedBedId },
          data: {
            status: BedStatus.CLEANING,
            cleaningPriority: 'ROUTINE',
            patientName: null,
            patientId: null,
            assignedDoctor: null,
            admittedAt: null,
          },
        });

        const avail = await tx.hospitalBed.count({
          where: { hospitalId: booking.hospitalId, status: BedStatus.AVAILABLE },
        });
        await tx.hospital.update({
          where: { id: booking.hospitalId },
          data: { availableBeds: avail, capacityLastUpdated: new Date() },
        });

        await tx.hospitalCapacityAuditLog.create({
          data: {
            hospitalId: booking.hospitalId,
            changedById: req.user!.id,
            changedByName: req.user!.name || 'Hospital Admin',
            changedByRole: req.user!.role,
            action: 'PATIENT_DISCHARGED',
            category: bed.category || bed.ward,
            previousAvailable: prevAvail,
            newAvailable: avail,
            previousTotal: prevTotal,
            newTotal: prevTotal,
            reason: `Booking ${resBooking.id} completed/discharged; bed ${bed.bedNumber} queued for sanitation`,
            timestamp: new Date(),
          },
        });
      }

      return resBooking;
    });

    const io = getIO();
    if (io) {
      io.to('hospital_room').emit('hospital:booking_updated', updated);
      io.to('hospital_room').emit('hospital:capacity_updated', {
        hospitalId: booking.hospitalId,
        availableBeds: await prisma.hospitalBed.count({ where: { hospitalId: booking.hospitalId, status: BedStatus.AVAILABLE } }),
      });
    }

    await logAdminActivity(req.user!.id, 'PATIENT_ADMISSION_UPDATED', {
      bookingId: id,
      patientName: updated.patientName,
      status: updated.status,
      assignedBedId: updated.assignedBedId || undefined,
      doctorName: updated.doctorName || undefined,
    });

    return res.json(updated);
  } catch (error: any) {
    return res.status(error.status || 500).json({
      message: error.message || 'Failed to update booking status',
      code: error.code,
    });
  }
});

// -------------------------------------------------------------
// Inbound Emergency Bay Allocation
// -------------------------------------------------------------

// Assign specific ER Bay / Bed to an incoming ambulance dispatch
router.post('/requests/:id/assign-bay', authenticate, async (req: AuthRequest, res) => {
  if (!req.user || (req.user.role !== Role.ADMIN_HOSPITAL && req.user.role !== Role.SUPER_ADMIN)) {
    return res.status(403).json({ message: 'Forbidden' });
  }

  const { id } = req.params;
  const { assignedBay, bedId, doctorName } = req.body;

  try {
    const request = await prisma.emergencyRequest.findUnique({
      where: { id },
      include: { patient: true, driver: true, hospital: true },
    });

    if (!request) {
      return res.status(404).json({ message: 'Emergency dispatch request not found' });
    }

    if (req.user.role === Role.ADMIN_HOSPITAL) {
      const adminHospital = await getAdminHospital(req.user.id, req.user.role);
      if (!adminHospital || (request.hospitalId && request.hospitalId !== adminHospital.id)) {
        return res.status(403).json({
          message: 'Forbidden: You cannot assign emergency bays for another hospital',
          code: 'UNAUTHORIZED_HOSPITAL_ACCESS',
        });
      }
    }

    const updatedRequest = await prisma.$transaction(async (tx) => {
      // Update request with assignedBay
      const reqUpdated = await tx.emergencyRequest.update({
        where: { id },
        data: {
          assignedBay: assignedBay || 'ER Trauma Bay 1',
        },
      });

      // If a specific bed was selected, atomically verify and reserve it
      if (bedId) {
        const bed = await tx.hospitalBed.findUnique({ where: { id: bedId } });
        if (!bed) {
          const err: any = new Error('Designated ER bed not found');
          err.status = 404;
          throw err;
        }
        if (bed.hospitalId !== request.hospitalId) {
          const err: any = new Error('Designated bed does not belong to destination hospital');
          err.status = 400;
          throw err;
        }
        if (bed.status !== BedStatus.AVAILABLE) {
          const err: any = new Error(`Bed ${bed.bedNumber} is not available for reservation (status: ${bed.status})`);
          err.status = 409;
          err.code = 'BED_UNAVAILABLE_FOR_RESERVATION';
          throw err;
        }

        const targetHospital = await tx.hospital.findUnique({ where: { id: bed.hospitalId } });
        const prevAvail = targetHospital?.availableBeds ?? 0;
        const prevTotal = targetHospital?.totalBeds ?? targetHospital?.availableBeds ?? 0;

        await tx.hospitalBed.update({
          where: { id: bedId },
          data: {
            status: BedStatus.RESERVED,
            patientName: request.patient.name,
            assignedDoctor: doctorName || 'ER Trauma Team On-Call',
            notes: `Reserved for inbound dispatch (${assignedBay || 'Resus Bay'})`,
          },
        });

        const avail = await tx.hospitalBed.count({
          where: { hospitalId: bed.hospitalId, status: BedStatus.AVAILABLE },
        });
        await tx.hospital.update({
          where: { id: bed.hospitalId },
          data: { availableBeds: avail, capacityLastUpdated: new Date() },
        });

        await tx.hospitalCapacityAuditLog.create({
          data: {
            hospitalId: bed.hospitalId,
            changedById: req.user!.id,
            changedByName: req.user!.name || 'Hospital Admin',
            changedByRole: req.user!.role,
            action: 'BED_RESERVED',
            category: bed.category || bed.ward,
            previousAvailable: prevAvail,
            newAvailable: avail,
            previousTotal: prevTotal,
            newTotal: prevTotal,
            reason: `Reserved bed ${bed.bedNumber} for incoming emergency dispatch #${id}`,
            timestamp: new Date(),
          },
        });
      }

      return reqUpdated;
    });

    const payload = {
      requestId: id,
      assignedBay: updatedRequest.assignedBay,
      doctorName: doctorName || 'Dr. Sarah Connor (Trauma Surgeon)',
      hospitalName: request.hospital?.name || 'Assigned Hospital',
    };

    // Broadcast to driver and patient in real-time
    if (request.driverId) {
      broadcastToDriver(request.driverId, 'hospital:bay_assigned', payload);
    }
    broadcastToPatient(request.patientId, 'hospital:bay_assigned', payload);

    const io = getIO();
    if (io) {
      io.to('hospital_room').emit('hospital:bay_assigned', payload);
    }

    await logAdminActivity(req.user!.id, 'EMERGENCY_BAY_ALLOCATED', {
      requestId: id,
      assignedBay: updatedRequest.assignedBay,
      patientName: request.patient.name,
      driverName: request.driver?.name || 'Assigned Driver',
      doctorName: payload.doctorName,
      hospitalName: request.hospital?.name || 'Assigned Hospital',
    });

    return res.json({ success: true, request: updatedRequest, bayInfo: payload });
  } catch (error: any) {
    return res.status(error.status || 500).json({
      message: error.message || 'Failed to assign ER bay',
      code: error.code,
    });
  }
});

// List all hospitals
router.get('/', authenticate, async (req: AuthRequest, res) => {
  try {
    const hospitals = await prisma.hospital.findMany();
    return res.json(hospitals);
  } catch (error) {
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// Update beds count (Admin of specific hospital only - legacy endpoint protected with invariants)
router.put('/beds', authenticate, async (req: AuthRequest, res) => {
  if (!req.user || req.user.role !== 'ADMIN_HOSPITAL') {
    return res.status(403).json({ message: 'Forbidden: Only hospital admins can manage beds' });
  }

  const { availableBeds, totalBeds, reason } = req.body;
  const parsedAvail = parseInt(availableBeds, 10);

  if (isNaN(parsedAvail) || parsedAvail < 0) {
    return res.status(400).json({
      code: 'INVALID_CAPACITY_COUNT',
      message: 'Available bed count cannot be negative or invalid',
    });
  }

  try {
    const hospital = await getAdminHospital(req.user.id);
    if (!hospital) {
      return res.status(404).json({ message: 'Hospital record not found for admin' });
    }

    const prevAvail = hospital.availableBeds ?? 0;
    const prevTotal = hospital.totalBeds ?? hospital.availableBeds ?? 0;
    const newTotal = totalBeds !== undefined ? parseInt(totalBeds, 10) : prevTotal;

    if (isNaN(newTotal) || newTotal < 0) {
      return res.status(400).json({
        code: 'INVALID_CAPACITY_COUNT',
        message: 'Total bed count cannot be negative or invalid',
      });
    }

    if (parsedAvail > newTotal) {
      return res.status(400).json({
        code: 'INVALID_CAPACITY_COUNT',
        message: `Available beds (${parsedAvail}) cannot exceed total configured beds (${newTotal})`,
      });
    }

    const occupiedCount = await prisma.hospitalBed.count({
      where: { hospitalId: hospital.id, status: BedStatus.OCCUPIED },
    });
    if (newTotal < occupiedCount) {
      return res.status(400).json({
        code: 'CAPACITY_BELOW_OCCUPANCY',
        message: `Total beds (${newTotal}) cannot be less than currently occupied beds (${occupiedCount})`,
      });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const resHosp = await tx.hospital.update({
        where: { id: hospital.id },
        data: {
          availableBeds: parsedAvail,
          totalBeds: newTotal,
          capacityLastUpdated: new Date(),
        },
      });

      await tx.hospitalCapacityAuditLog.create({
        data: {
          hospitalId: hospital.id,
          changedById: req.user!.id,
          changedByName: req.user!.name || 'Hospital Admin',
          changedByRole: req.user!.role,
          action: 'CAPACITY_OVERRIDE',
          category: 'ALL',
          previousAvailable: prevAvail,
          newAvailable: parsedAvail,
          previousTotal: prevTotal,
          newTotal: newTotal,
          reason: reason || 'Capacity updated via legacy admin beds endpoint',
          timestamp: new Date(),
        },
      });

      return resHosp;
    });

    const io = getIO();
    if (io) {
      io.to('hospital_room').emit('hospital:capacity_updated', {
        hospitalId: hospital.id,
        availableBeds: parsedAvail,
        totalBeds: newTotal,
      });
    }

    return res.json(updated);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Internal server error' });
  }
});

// 1. GET Hospital Drivers Roster
router.get('/drivers', authenticate, async (req: AuthRequest, res) => {
  if (!req.user || req.user.role !== 'ADMIN_HOSPITAL') {
    return res.status(403).json({ message: 'Forbidden: Only hospital admins can view roster' });
  }

  try {
    const hospital = await getAdminHospital(req.user.id);
    if (!hospital) {
      return res.status(404).json({ message: 'Hospital not configured for this admin' });
    }

    const drivers = await prisma.user.findMany({
      where: {
        hospitalId: hospital.id,
        role: Role.DRIVER,
      },
      include: {
        ambulance: true,
      },
      orderBy: { name: 'asc' },
    });

    // Hide password hashes
    const safeDrivers = drivers.map((d) => {
      const { passwordHash, ...safe } = d;
      return safe;
    });

    return res.json(safeDrivers);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Internal server error' });
  }
});

// 2. PUT Verify Driver Documents
router.put('/drivers/:driverId/verify', authenticate, async (req: AuthRequest, res) => {
  if (!req.user || req.user.role !== 'ADMIN_HOSPITAL') {
    return res.status(403).json({ message: 'Forbidden: Only hospital admins can verify drivers' });
  }

  const { driverId } = req.params;
  const { status } = req.body; // 'APPROVED' or 'REJECTED' or 'PENDING'

  try {
    const hospital = await getAdminHospital(req.user.id);
    if (!hospital) {
      return res.status(404).json({ message: 'Hospital not configured for this admin' });
    }

    // Verify driver belongs to this hospital
    const driver = await prisma.user.findFirst({
      where: { id: driverId, hospitalId: hospital.id, role: Role.DRIVER },
    });

    if (!driver) {
      return res.status(404).json({ message: 'Driver not found in this hospital roster' });
    }

    const updatedAmbulance = await prisma.ambulance.update({
      where: { driverId: driver.id },
      data: {
        verificationStatus: status,
      },
    });

    return res.json(updatedAmbulance);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Internal server error' });
  }
});

// 3. PUT Toggle Driver Account Status (Active/Inactive)
router.put('/drivers/:driverId/status', authenticate, async (req: AuthRequest, res) => {
  if (!req.user || req.user.role !== 'ADMIN_HOSPITAL') {
    return res.status(403).json({ message: 'Forbidden: Only hospital admins can toggle driver accounts' });
  }

  const { driverId } = req.params;
  const { isActive } = req.body;

  try {
    const hospital = await getAdminHospital(req.user.id);
    if (!hospital) {
      return res.status(404).json({ message: 'Hospital not configured' });
    }

    const driver = await prisma.user.findFirst({
      where: { id: driverId, hospitalId: hospital.id, role: Role.DRIVER },
    });

    if (!driver) {
      return res.status(404).json({ message: 'Driver not found in this hospital roster' });
    }

    const updatedUser = await prisma.user.update({
      where: { id: driverId },
      data: {
        isActive: !!isActive,
      },
    });

    const { passwordHash, ...safeUser } = updatedUser;
    return res.json(safeUser);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Internal server error' });
  }
});

// 4. GET Hospital Ambulance Fleet
router.get('/ambulances', authenticate, async (req: AuthRequest, res) => {
  if (!req.user || req.user.role !== 'ADMIN_HOSPITAL') {
    return res.status(403).json({ message: 'Forbidden: Only hospital admins can manage fleet' });
  }

  try {
    const hospital = await getAdminHospital(req.user.id);
    if (!hospital) {
      return res.status(404).json({ message: 'Hospital not configured' });
    }

    const fleet = await prisma.ambulance.findMany({
      where: { hospitalId: hospital.id },
      include: {
        driver: {
          select: { id: true, name: true, email: true, phone: true },
        },
      },
      orderBy: { vehicleNumber: 'asc' },
    });

    return res.json(fleet);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Internal server error' });
  }
});

// 5. POST Register New Ambulance
router.post('/ambulances', authenticate, async (req: AuthRequest, res) => {
  if (!req.user || req.user.role !== 'ADMIN_HOSPITAL') {
    return res.status(403).json({ message: 'Forbidden' });
  }

  const { vehicleNumber, ambulanceType } = req.body;

  try {
    const hospital = await getAdminHospital(req.user.id);
    if (!hospital) {
      return res.status(404).json({ message: 'Hospital not configured' });
    }

    const existingAmb = await prisma.ambulance.findFirst({
      where: { vehicleNumber },
    });
    if (existingAmb) {
      return res.status(400).json({ message: 'Vehicle number already registered on the platform' });
    }

    const newAmbulance = await prisma.ambulance.create({
      data: {
        vehicleNumber,
        ambulanceType,
        hospitalId: hospital.id,
        isAvailable: false,
        currentLat: hospital.lat,
        currentLng: hospital.lng,
        verificationStatus: 'APPROVED', // Registered directly by the hospital admin
      },
    });

    return res.status(201).json(newAmbulance);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Internal server error' });
  }
});

// 6. PUT Edit Ambulance details (assign driver / toggle maintenance status)
router.put('/ambulances/:id', authenticate, async (req: AuthRequest, res) => {
  if (!req.user || req.user.role !== 'ADMIN_HOSPITAL') {
    return res.status(403).json({ message: 'Forbidden' });
  }

  const { id } = req.params;
  const { driverId, maintenanceStatus } = req.body;

  try {
    const hospital = await getAdminHospital(req.user.id);
    if (!hospital) {
      return res.status(404).json({ message: 'Hospital not configured' });
    }

    // Verify ambulance belongs to hospital
    const ambulance = await prisma.ambulance.findFirst({
      where: { id, hospitalId: hospital.id },
    });

    if (!ambulance) {
      return res.status(404).json({ message: 'Ambulance not found in this hospital fleet' });
    }

    const result = await prisma.$transaction(async (tx) => {
      // If assigning a new driver
      if (driverId !== undefined) {
        if (driverId) {
          // Verify target driver is in the roster
          const targetDriver = await tx.user.findFirst({
            where: { id: driverId, hospitalId: hospital.id, role: Role.DRIVER },
          });

          if (!targetDriver) {
            throw new Error('Target driver is not in your hospital roster');
          }

          // Unassign this driver from any other ambulance (prevent unique constraint violations)
          await tx.ambulance.updateMany({
            where: { driverId },
            data: { driverId: null },
          });
        }

        // If this ambulance had another driver assigned, we can unassign them first or let Prisma replace
        // Since driverId is unique, we must update the record directly
        return tx.ambulance.update({
          where: { id },
          data: {
            driverId: driverId || null,
            maintenanceStatus: maintenanceStatus || ambulance.maintenanceStatus,
          },
          include: { driver: true },
        });
      }

      // Just update maintenance status
      return tx.ambulance.update({
        where: { id },
        data: {
          maintenanceStatus: maintenanceStatus || ambulance.maintenanceStatus,
        },
        include: { driver: true },
      });
    });

    return res.json(result);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Internal server error' });
  }
});

// GET /api/v1/hospitals/:id - Get single hospital details by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const hospital = await prisma.hospital.findUnique({
      where: { id },
      include: {
        doctors: { where: { isActive: true } },
      },
    });

    if (!hospital) {
      return res.status(404).json({ error: 'HOSPITAL_NOT_FOUND', message: 'Hospital not found.' });
    }

    return res.json(hospital);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to fetch hospital' });
  }
});

export default router;
