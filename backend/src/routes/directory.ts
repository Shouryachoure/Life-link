import { Router, Request, Response } from 'express';
import { Role } from '@prisma/client';
import prisma from '../db';
import { authenticate, authorize } from '../middleware/auth';
import {
  validateFacilityBatch,
  validateAmbulanceBatch,
  executeFacilityImport,
  executeAmbulanceImport,
  calculateHaversineDistanceKm,
} from '../services/directoryPipelineService';
import { logAdminActivity } from '../utils/activityLogger';
import { formatServiceType, formatFacilityCategory } from '../utils/directoryLabels';

const router = Router();

// =============================================================================
// PUBLIC & CITIZEN DIRECTORY DISCOVERY ENDPOINTS
// =============================================================================

/**
 * GET /api/v1/directory/hospitals
 * Discover hospitals from the public directory with filtering, search, and geospatial proximity
 */
router.get('/hospitals', async (req: Request, res: Response) => {
  try {
    const {
      search,
      facilityType,
      recordType,
      recordStatus,
      ownership,
      locality,
      tehsil,
      coverageGroup,
      dataConfidence,
      city = 'Nagpur',
      district = 'Nagpur',
      lat,
      lng,
      radiusKm = '35',
      linkedOnly,
      limit = '50',
      page = '1',
    } = req.query;

    const pageNum = Math.max(1, parseInt(String(page)) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(String(limit)) || 50));
    const skip = (pageNum - 1) * limitNum;

    // Fetch matching facilities
    let facilities = await prisma.directoryFacility.findMany({
      where: {
        city: String(city),
        district: String(district),
        isDuplicate: false, // Exclude marked duplicate entries from public view
        ...(facilityType ? { facilityType: String(facilityType) } : {}),
        ...(recordType ? { recordType: String(recordType) } : {}),
        ...(recordStatus ? { recordStatus: String(recordStatus) } : {}),
        ...(ownership ? { ownership: String(ownership) } : {}),
        ...(locality ? { locality: String(locality) } : {}),
        ...(tehsil ? { tehsil: String(tehsil) } : {}),
        ...(coverageGroup ? { coverageGroup: String(coverageGroup) } : {}),
        ...(dataConfidence ? { dataConfidence: String(dataConfidence) } : {}),
        ...(linkedOnly === 'true' ? { linkStatus: 'LINKED_PARTNER' } : {}),
        ...(search ? { search: String(search) } : {}),
      },
      orderBy: { name: 'asc' },
    });

    // If user provided geographic coordinates, compute straight-line distance and sort
    const parsedUserLat = lat ? parseFloat(String(lat)) : null;
    const parsedUserLng = lng ? parseFloat(String(lng)) : null;
    const parsedRadius = parseFloat(String(radiusKm)) || 35;

    let enriched = facilities.map((f: any) => {
      let distanceKm: number | null = null;
      if (parsedUserLat !== null && parsedUserLng !== null && f.lat && f.lng) {
        distanceKm = Math.round(calculateHaversineDistanceKm(parsedUserLat, parsedUserLng, f.lat, f.lng) * 10) / 10;
      }
      const rawPhone = f.contactNumber ? String(f.contactNumber) : '';
      const cleanPhone = rawPhone.replace(/[^0-9+]/g, '');
      const clickToCallUrl = cleanPhone ? `tel:${cleanPhone}` : null;
      const directionsUrl =
        f.lat !== null && f.lng !== null
          ? `https://www.google.com/maps/dir/?api=1&destination=${f.lat},${f.lng}`
          : null;

      return {
        ...f,
        distanceKm,
        clickToCallUrl,
        directionsUrl,
        isLifeLinkPartner: f.linkStatus === 'LINKED_PARTNER',
      };
    });

    if (parsedUserLat !== null && parsedUserLng !== null) {
      enriched = enriched
        .filter((f) => f.distanceKm === null || f.distanceKm <= parsedRadius)
        .sort((a, b) => {
          if (a.distanceKm === null) return 1;
          if (b.distanceKm === null) return -1;
          return a.distanceKm - b.distanceKm;
        });
    }

    const total = enriched.length;
    const paged = enriched.slice(skip, skip + limitNum);

    return res.status(200).json({
      success: true,
      data: paged,
      meta: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum) || 1,
        userLocationProvided: parsedUserLat !== null && parsedUserLng !== null,
        nagpurPilotZone: 'Nagpur District, Maharashtra',
      },
    });
  } catch (err: any) {
    return res.status(500).json({ status: 'error', message: err?.message || 'Failed to query directory facilities' });
  }
});

/**
 * GET /api/v1/directory/hospitals/:id
 * Retrieve specific facility details with full provenance
 */
router.get('/hospitals/:id', async (req: Request, res: Response) => {
  try {
    const facility = await prisma.directoryFacility.findUnique({
      where: { id: req.params.id },
    });

    if (!facility) {
      return res.status(404).json({ status: 'fail', message: 'Healthcare facility not found in public directory' });
    }

    const rawPhone = facility.contactNumber ? String(facility.contactNumber) : '';
    const cleanPhone = rawPhone.replace(/[^0-9+]/g, '');
    const clickToCallUrl = cleanPhone ? `tel:${cleanPhone}` : null;
    const directionsUrl =
      facility.lat !== null && facility.lng !== null
        ? `https://www.google.com/maps/dir/?api=1&destination=${facility.lat},${facility.lng}`
        : null;

    // If linked to an approved LifeLink partner hospital, optionally include live bed telemetry count
    let livePartnerTelemetry: any = null;
    if (facility.linkedHospitalId) {
      const partnerHosp = await prisma.hospital.findUnique({
        where: { id: facility.linkedHospitalId },
      });
      if (partnerHosp) {
        livePartnerTelemetry = {
          hospitalId: partnerHosp.id,
          availableBeds: partnerHosp.availableBeds,
          totalBeds: partnerHosp.totalBeds,
          capacityLastUpdated: partnerHosp.capacityLastUpdated,
          verificationState: partnerHosp.verificationState,
        };
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        ...facility,
        clickToCallUrl,
        directionsUrl,
        livePartnerTelemetry,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ status: 'error', message: err?.message || 'Failed to retrieve facility details' });
  }
});

/**
 * GET /api/v1/directory/hospitals/:id/doctors
 * Get affiliated doctors for directory facility
 */
router.get('/hospitals/:id/doctors', async (req: Request, res: Response) => {
  try {
    const { id: hospitalId } = req.params;
    const rawSpecialization = (req.query.specialization || req.query.specialty) as string | undefined;
    const rawSearch = req.query.search as string | undefined;
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));

    // Resolve hospital or directory facility
    let hospitalRecord: any = await prisma.hospital.findUnique({ where: { id: hospitalId } });
    let facilityRecord: any = await prisma.directoryFacility.findUnique({ where: { id: hospitalId } });

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
        message: `Facility "${hospitalId}" not found in directory`,
      });
    }

    const facilityName = facilityRecord?.name || hospitalRecord?.name;
    const facilityAddress = facilityRecord?.address || hospitalRecord?.address;
    const facilityPhone = facilityRecord?.contactNumber || hospitalRecord?.contactNumber;
    const facilityType = facilityRecord?.facilityType || 'GENERAL_HOSPITAL';
    const ownership = facilityRecord?.ownership || 'UNKNOWN';

    // Aliases to search
    const aliasIds = [hospitalId];
    if (hospitalId === 'fac-gmch-nagpur' && !aliasIds.includes('hosp-gmch-nagpur')) aliasIds.push('hosp-gmch-nagpur');
    if (hospitalId === 'hosp-gmch-nagpur' && !aliasIds.includes('fac-gmch-nagpur')) aliasIds.push('fac-gmch-nagpur');
    if (hospitalId === 'fac-iggmc-mayo-nagpur' && !aliasIds.includes('hosp-mayo-nagpur')) aliasIds.push('hosp-mayo-nagpur');
    if (hospitalId === 'hosp-mayo-nagpur' && !aliasIds.includes('fac-iggmc-mayo-nagpur')) aliasIds.push('fac-iggmc-mayo-nagpur');

    let doctors: any[] = await prisma.doctor.findMany({
      where: {
        isActive: true,
        hospitalId: { in: aliasIds },
      },
      include: {
        affiliations: true,
      },
    });

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

    if (rawSpecialization && rawSpecialization !== 'ALL') {
      const specLower = rawSpecialization.toLowerCase().trim();
      doctors = doctors.filter((d: any) => {
        const primaryMatch = d.specialization && d.specialization.toLowerCase().includes(specLower);
        const designationMatch = d.designation && d.designation.toLowerCase().includes(specLower);
        const listMatch = Array.isArray(d.specialtiesList) && d.specialtiesList.some((s: string) => s.toLowerCase().includes(specLower));
        return primaryMatch || designationMatch || listMatch;
      });
    }

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

/**
 * GET /api/v1/directory/ambulances
 * Discover public and emergency ambulance services across Nagpur
 */
router.get('/ambulances', async (req: Request, res: Response) => {
  try {
    const {
      search,
      operatorType,
      recordType,
      recordStatus,
      locality,
      tehsil,
      coverageGroup,
      dataConfidence,
      city = 'Nagpur',
      district = 'Nagpur',
      lat,
      lng,
      radiusKm = '35',
      limit = '50',
      page = '1',
    } = req.query;

    const pageNum = Math.max(1, parseInt(String(page)) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(String(limit)) || 50));
    const skip = (pageNum - 1) * limitNum;

    const services = await prisma.directoryAmbulanceService.findMany({
      where: {
        city: String(city),
        district: String(district),
        isDuplicate: false,
        ...(operatorType ? { operatorType: String(operatorType) } : {}),
        ...(recordType ? { recordType: String(recordType) } : {}),
        ...(recordStatus ? { recordStatus: String(recordStatus) } : {}),
        ...(locality ? { locality: String(locality) } : {}),
        ...(tehsil ? { tehsil: String(tehsil) } : {}),
        ...(coverageGroup ? { coverageGroup: String(coverageGroup) } : {}),
        ...(dataConfidence ? { dataConfidence: String(dataConfidence) } : {}),
        ...(search ? { search: String(search) } : {}),
      },
      orderBy: { serviceName: 'asc' },
    });

    const parsedUserLat = lat ? parseFloat(String(lat)) : null;
    const parsedUserLng = lng ? parseFloat(String(lng)) : null;
    const parsedRadius = parseFloat(String(radiusKm)) || 35;

    let enriched = services.map((s: any) => {
      let distanceKm: number | null = null;
      if (parsedUserLat !== null && parsedUserLng !== null && s.lat && s.lng) {
        distanceKm = Math.round(calculateHaversineDistanceKm(parsedUserLat, parsedUserLng, s.lat, s.lng) * 10) / 10;
      }
      const rawPhone = s.contactNumber ? String(s.contactNumber) : '';
      const cleanPhone = rawPhone.replace(/[^0-9+]/g, '');
      const clickToCallUrl = cleanPhone ? `tel:${cleanPhone}` : null;
      const directionsUrl =
        s.lat !== null && s.lng !== null
          ? `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`
          : null;

      return {
        ...s,
        distanceKm,
        clickToCallUrl,
        directionsUrl,
        isLifeLinkPartner: s.linkStatus === 'LINKED_PARTNER',
      };
    });

    if (parsedUserLat !== null && parsedUserLng !== null) {
      enriched = enriched
        .filter((s) => s.distanceKm === null || s.distanceKm <= parsedRadius)
        .sort((a, b) => {
          if (a.distanceKm === null) return 1;
          if (b.distanceKm === null) return -1;
          return a.distanceKm - b.distanceKm;
        });
    }

    const total = enriched.length;
    const paged = enriched.slice(skip, skip + limitNum);

    return res.status(200).json({
      success: true,
      data: paged,
      meta: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum) || 1,
        notice:
          'Directory contact numbers are publicly listed business and helpline contacts. They are NOT direct driver mobile numbers or guaranteed dispatch responders.',
      },
    });
  } catch (err: any) {
    return res.status(500).json({ status: 'error', message: err?.message || 'Failed to query ambulance services' });
  }
});

/**
 * GET /api/v1/directory/unified
 * Unified discovery endpoint returning both hospitals and ambulance providers with standardized metadata
 */
router.get('/unified', async (req: Request, res: Response) => {
  try {
    const {
      type = 'ALL', // 'ALL' | 'HOSPITAL' | 'CLINIC' | 'AMBULANCE_PROVIDER' | 'OFFICIAL_EMERGENCY_HELPLINE' | 'HELPLINE'
      category,     // alias for type
      search,
      locality,
      tehsil,
      coverageGroup,
      dataConfidence,
      city = 'Nagpur',
      district = 'Nagpur',
      lat,
      lng,
      radiusKm = '35',
      limit = '100',
      page = '1',
    } = req.query;

    const requestedCategory = String(category || type || 'ALL').toUpperCase();
    const pageNum = Math.max(1, parseInt(String(page)) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(String(limit)) || 100));
    const skip = (pageNum - 1) * limitNum;

    const parsedUserLat = lat ? parseFloat(String(lat)) : null;
    const parsedUserLng = lng ? parseFloat(String(lng)) : null;
    const parsedRadius = parseFloat(String(radiusKm)) || 35;

    let items: any[] = [];

    // Facility types classified as clinics vs hospitals
    const CLINIC_FACILITY_TYPES = ['DAYCARE_CLINIC', 'INSTITUTIONAL_HEALTH_CENTRE', 'PRIMARY_HEALTH_CENTRE', 'COMMUNITY_HEALTH_CENTRE'];

    // 1. Fetch facilities if requested
    const shouldFetchFacilities = ['ALL', 'HOSPITAL', 'CLINIC'].includes(requestedCategory);
    if (shouldFetchFacilities) {
      const facilities = await prisma.directoryFacility.findMany({
        where: {
          city: String(city),
          district: String(district),
          isDuplicate: false,
          ...(locality ? { locality: String(locality) } : {}),
          ...(tehsil ? { tehsil: String(tehsil) } : {}),
          ...(coverageGroup && coverageGroup !== 'ALL' ? { coverageGroup: String(coverageGroup) } : {}),
          ...(dataConfidence ? { dataConfidence: String(dataConfidence) } : {}),
          ...(search ? { search: String(search) } : {}),
        },
      });

      for (const f of facilities) {
        const isClinic = CLINIC_FACILITY_TYPES.includes(f.facilityType);
        if (requestedCategory === 'CLINIC' && !isClinic) continue;
        if (requestedCategory === 'HOSPITAL' && isClinic) continue;

        let distanceKm: number | null = null;
        if (parsedUserLat !== null && parsedUserLng !== null && f.lat && f.lng) {
          distanceKm = Math.round(calculateHaversineDistanceKm(parsedUserLat, parsedUserLng, f.lat, f.lng) * 10) / 10;
        }
        const cleanPhone = (f.contactNumber || '').replace(/[^0-9+]/g, '');
        const humanCat = formatFacilityCategory(f.facilityType, false, false, false);

        items.push({
          id: f.id,
          name: f.name,
          alternateNames: f.alternateNames,
          recordType: f.recordType || 'HOSPITAL',
          recordStatus: f.recordStatus || 'ACTIVE',
          category: f.facilityType,
          categoryLabel: humanCat,
          ownership: f.ownership,
          contactNumber: f.contactNumber,
          rawContactNumber: f.rawContactNumber,
          alternateNumber: f.alternateNumber,
          emergencyPhone: f.emergencyPhone,
          ambulancePhone: f.ambulancePhone,
          publicEmail: f.publicEmail,
          specialties: f.specialties,
          emergencyServicesClaimed: f.emergencyServicesClaimed,
          clickToCallUrl: cleanPhone ? `tel:${cleanPhone}` : null,
          address: f.address,
          locality: f.locality,
          tehsil: f.tehsil,
          coverageGroup: f.coverageGroup || 'NAGPUR_CITY',
          city: f.city,
          district: f.district,
          state: f.state,
          lat: f.lat,
          lng: f.lng,
          isGeocoded: f.isGeocoded,
          coordinateQuality: f.coordinateQuality,
          directionsUrl:
            f.lat !== null && f.lng !== null
              ? `https://www.google.com/maps/dir/?api=1&destination=${f.lat},${f.lng}`
              : null,
          website: f.website,
          sourceUrl: f.sourceUrl,
          sourceType: f.sourceType || 'OFFICIAL_GOVERNMENT_PORTAL',
          dataProvenance: f.dataProvenance || 'Verified Nagpur public directory.',
          dataConfidence: f.dataConfidence || 'DIRECTORY_LISTED',
          lastCheckedAt: f.lastCheckedAt || f.lastVerifiedAt,
          verificationStatus: f.verificationStatus,
          contactVerificationStatus: f.contactVerificationStatus || 'VERIFIED',
          lastContactVerifiedAt: f.lastContactVerifiedAt,
          isLifeLinkPartner: f.linkStatus === 'LINKED_PARTNER',
          linkStatus: f.linkStatus,
          onboardingStatus: f.onboardingStatus,
          distanceKm,
          isHospitalAffiliated: false,
          hasDedicatedAmbulanceDesk: Boolean(f.ambulancePhone),
        });
      }
    }

    // 2. Fetch ambulance providers & helplines if requested
    const isHelplineOnly = requestedCategory === 'OFFICIAL_EMERGENCY_HELPLINE' || requestedCategory === 'HELPLINE';
    const isAmbOnly = requestedCategory === 'AMBULANCE_PROVIDER';
    const shouldFetchAmbulance = requestedCategory === 'ALL' || isAmbOnly || isHelplineOnly;

    if (shouldFetchAmbulance) {
      const ambulances = await prisma.directoryAmbulanceService.findMany({
        where: {
          city: String(city),
          district: String(district),
          isDuplicate: false,
          ...(isHelplineOnly
            ? { recordType: 'OFFICIAL_EMERGENCY_HELPLINE' }
            : isAmbOnly
            ? { recordType: 'AMBULANCE_PROVIDER' }
            : {}),
          ...(locality ? { locality: String(locality) } : {}),
          ...(tehsil ? { tehsil: String(tehsil) } : {}),
          ...(coverageGroup && coverageGroup !== 'ALL' ? { coverageGroup: String(coverageGroup) } : {}),
          ...(dataConfidence ? { dataConfidence: String(dataConfidence) } : {}),
          ...(search ? { search: String(search) } : {}),
        },
      });

      // Map of hospital links for affiliated ambulances
      const hospitalLinks: Record<string, { id: string; name: string }> = {
        'amb-gmch-hospital-fleet': { id: 'fac-gmch-nagpur', name: 'Government Medical College and Hospital (GMCH Nagpur)' },
        'amb-iggmch-mayo-fleet': { id: 'fac-iggmc-mayo-nagpur', name: 'Indira Gandhi Government Medical College and Hospital (Mayo Hospital)' },
        'amb-aiims-dedicated-line': { id: 'fac-aiims-nagpur', name: 'All India Institute of Medical Sciences (AIIMS Nagpur)' },
        'amb-wockhardt-dedicated-fleet': { id: 'fac-wockhardt-nagpur', name: 'Wockhardt Hospitals, Nagpur' },
        'amb-care-emergency-line': { id: 'fac-care-hospitals-nagpur', name: 'CARE Hospitals, Nagpur' },
        'amb-kingsway-rapid-response': { id: 'fac-kingsway-hospitals-nagpur', name: 'KIMS-Kingsway Hospitals' },
        'amb-ochri-dedicated-line': { id: 'fac-ochri-nagpur', name: 'Orange City Hospital & Research Institute (OCHRI)' },
        'amb-suretech-dispatch': { id: 'fac-suretech-hospital-nagpur', name: 'Suretech Hospital & Research Centre' },
        'amb-max-emergency-line': { id: 'fac-max-super-nagpur', name: 'Max Super Speciality Hospital, Nagpur (Formerly Alexis)' },
        'amb-nci-emergency-transport': { id: 'fac-nci-jamtha', name: 'National Cancer Institute (NCI), Jamtha' },
      };

      for (const a of ambulances) {
        let distanceKm: number | null = null;
        if (parsedUserLat !== null && parsedUserLng !== null && a.lat && a.lng) {
          distanceKm = Math.round(calculateHaversineDistanceKm(parsedUserLat, parsedUserLng, a.lat, a.lng) * 10) / 10;
        }
        const cleanPhone = (a.contactNumber || '').replace(/[^0-9+]/g, '');
        const isHelpline = a.recordType === 'OFFICIAL_EMERGENCY_HELPLINE';
        const linkInfo = hospitalLinks[a.id] || (a.linkedHospitalId ? { id: a.linkedHospitalId, name: 'Affiliated Hospital' } : null);
        const isHospitalOperated = Boolean(linkInfo || a.operatorType === 'HOSPITAL_OPERATED');
        const humanCat = formatFacilityCategory(a.operatorType, isHelpline, true, isHospitalOperated);
        const formattedServices = Array.isArray(a.advertisedServiceTypes)
          ? (a.advertisedServiceTypes as string[]).map(formatServiceType)
          : [];

        items.push({
          id: a.id,
          name: a.serviceName,
          recordType: a.recordType || 'AMBULANCE_PROVIDER',
          recordStatus: a.recordStatus || 'ACTIVE',
          category: a.operatorType,
          categoryLabel: humanCat,
          contactNumber: a.contactNumber,
          rawContactNumber: a.rawContactNumber,
          alternateNumber: a.alternateContact,
          publicBusinessPhone: a.publicBusinessPhone,
          alternatePublicPhone: a.alternatePublicPhone,
          businessAddress: a.businessAddress,
          serviceArea: a.serviceArea || a.operatingArea,
          advertisedServiceTypes: a.advertisedServiceTypes,
          humanServiceTypes: formattedServices,
          advertisedIcuOrVentilatorCapability: a.advertisedIcuOrVentilatorCapability,
          clickToCallUrl: cleanPhone ? `tel:${cleanPhone}` : null,
          address: a.address,
          locality: a.locality,
          tehsil: a.tehsil,
          coverageGroup: a.coverageGroup || 'NAGPUR_CITY',
          city: a.city,
          district: a.district,
          state: a.state || 'Maharashtra',
          operatingArea: a.operatingArea,
          lat: a.lat,
          lng: a.lng,
          isGeocoded: a.isGeocoded,
          coordinateQuality: a.coordinateQuality,
          directionsUrl:
            a.lat !== null && a.lng !== null
              ? `https://www.google.com/maps/dir/?api=1&destination=${a.lat},${a.lng}`
              : null,
          website: a.website,
          sourceUrl: a.sourceUrl,
          sourceType: a.sourceType || 'COMMERCIAL_DIRECTORY_LISTING',
          dataProvenance: a.dataProvenance || 'Verified Nagpur public directory.',
          dataConfidence: a.dataConfidence || 'DIRECTORY_LISTED',
          lastCheckedAt: a.lastCheckedAt || a.lastVerifiedAt,
          verificationStatus: a.verificationStatus,
          contactVerificationStatus: a.contactVerificationStatus || 'VERIFIED',
          lastContactVerifiedAt: a.lastContactVerifiedAt,
          isLifeLinkPartner: a.linkStatus === 'LINKED_PARTNER',
          linkStatus: a.linkStatus,
          onboardingStatus: a.onboardingStatus,
          distanceKm,
          isHospitalAffiliated: isHospitalOperated,
          linkedHospitalId: linkInfo?.id || null,
          linkedHospitalName: linkInfo?.name || null,
        });
      }
    }

    // Sort by proximity if user provided coordinates, else by name
    if (parsedUserLat !== null && parsedUserLng !== null) {
      items = items
        .filter((i) => i.distanceKm === null || i.distanceKm <= parsedRadius)
        .sort((a, b) => {
          if (a.distanceKm === null) return 1;
          if (b.distanceKm === null) return -1;
          return a.distanceKm - b.distanceKm;
        });
    } else {
      items.sort((a, b) => a.name.localeCompare(b.name));
    }

    const total = items.length;
    const paged = items.slice(skip, skip + limitNum);

    return res.status(200).json({
      success: true,
      data: paged,
      meta: {
        total,
        returned: paged.length,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum) || 1,
        userLocationProvided: parsedUserLat !== null && parsedUserLng !== null,
        totalCatalogRecords: 85, // 57 facilities + 28 ambulance services
        nagpurPilotZone: 'Nagpur District, Maharashtra',
      },
    });
  } catch (err: any) {
    return res.status(500).json({ status: 'error', message: err?.message || 'Failed to query unified directory' });
  }
});

/**
 * POST /api/v1/directory/feedback
 * Submit a community or operator correction report for a directory facility or service
 */
router.post('/feedback', async (req: Request, res: Response) => {
  try {
    const { entityType, entityId, issueType, description, suggestedCorrection, reportedBy } = req.body;

    if (!entityType || !entityId || !issueType || !description) {
      return res.status(400).json({
        status: 'fail',
        message: 'Missing mandatory feedback fields: entityType, entityId, issueType, description',
      });
    }

    const reviewIssue = await prisma.directoryReviewIssue.create({
      data: {
        entityType: String(entityType).toUpperCase(),
        entityId: String(entityId),
        issueType: String(issueType).toUpperCase(),
        severity: 'MEDIUM',
        description: String(description).trim(),
        suggestedCorrection: suggestedCorrection || null,
        reportedBy: reportedBy || 'CITIZEN_USER',
        status: 'OPEN',
      },
    });

    return res.status(201).json({
      success: true,
      message: 'Correction report submitted successfully for review by LifeLink operations',
      data: reviewIssue,
    });
  } catch (err: any) {
    return res.status(500).json({ status: 'error', message: err?.message || 'Failed to submit feedback' });
  }
});

// =============================================================================
// SUPER-ADMIN DIRECTORY MANAGEMENT & IMPORT WORKFLOW
// =============================================================================

/**
 * GET /api/v1/directory/admin/summary
 * Super-Admin metrics and directory coverage statistics
 */
router.get('/admin/summary', authenticate as any, authorize([Role.SUPER_ADMIN]) as any, async (_req: Request, res: Response) => {
  try {
    const totalFacilities = await prisma.directoryFacility.count();
    const verifiedFacilities = await prisma.directoryFacility.count({ where: { verificationStatus: 'VERIFIED' } });
    const linkedFacilities = await prisma.directoryFacility.count({ where: { linkStatus: 'LINKED_PARTNER' } });
    const totalAmbulances = await prisma.directoryAmbulanceService.count();
    const openIssues = await prisma.directoryReviewIssue.count({ where: { status: 'OPEN' } });

    // Category breakdown
    const allFacilities = await prisma.directoryFacility.findMany();
    const categoryCounts: Record<string, number> = {};
    let withCoords = 0;
    let districtCount = 0;

    for (const f of allFacilities) {
      categoryCounts[f.facilityType] = (categoryCounts[f.facilityType] || 0) + 1;
      if (f.lat !== null && f.lng !== null) withCoords++;
      if (f.city !== 'Nagpur' || f.locality?.toUpperCase().includes('KAMPTEE') || f.locality?.toUpperCase().includes('HINGNA')) {
        districtCount++;
      }
    }

    return res.status(200).json({
      success: true,
      summary: {
        totalFacilities,
        verifiedFacilities,
        linkedFacilities,
        unlinkedFacilities: totalFacilities - linkedFacilities,
        withCoordinates: withCoords,
        missingCoordinates: totalFacilities - withCoords,
        districtFacilities: districtCount,
        cityFacilities: totalFacilities - districtCount,
        totalAmbulanceServices: totalAmbulances,
        openReviewIssues: openIssues,
        categoryBreakdown: categoryCounts,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ status: 'error', message: err?.message || 'Failed to load directory summary' });
  }
});

/**
 * POST /api/v1/directory/admin/import/preview
 * Validate batch without modifying database
 */
router.post(
  '/admin/import/preview',
  authenticate as any,
  authorize([Role.SUPER_ADMIN]) as any,
  async (req: Request, res: Response) => {
    try {
      const { entityType, records } = req.body;

      if (!records || !Array.isArray(records) || records.length === 0) {
        return res.status(400).json({ status: 'fail', message: 'records array is required and must not be empty' });
      }

      if (entityType === 'AMBULANCE') {
        const preview = await validateAmbulanceBatch(records);
        return res.status(200).json({ success: true, preview });
      } else {
        const preview = await validateFacilityBatch(records);
        return res.status(200).json({ success: true, preview });
      }
    } catch (err: any) {
      return res.status(500).json({ status: 'error', message: err?.message || 'Failed to preview directory import' });
    }
  }
);

/**
 * POST /api/v1/directory/admin/import/execute
 * Execute authorized import of verified records with audit trail
 */
router.post(
  '/admin/import/execute',
  authenticate as any,
  authorize([Role.SUPER_ADMIN]) as any,
  async (req: Request, res: Response) => {
    try {
      const { entityType, records } = req.body;

      if (!records || !Array.isArray(records) || records.length === 0) {
        return res.status(400).json({ status: 'fail', message: 'records array is required' });
      }

      const actorId = (req as any).user?.id || 'super-admin';

      if (entityType === 'AMBULANCE') {
        const validation = await validateAmbulanceBatch(records);
        if (validation.errorCount > 0) {
          return res.status(400).json({
            status: 'fail',
            message: `Batch contains ${validation.errorCount} invalid records. Please fix validation errors before importing.`,
            issues: validation.issues,
          });
        }
        const outcome = await executeAmbulanceImport(validation.validRecords, actorId);
        await logAdminActivity(actorId, 'DIRECTORY_AMBULANCE_IMPORT', {
          outcome,
          count: validation.validRecords.length,
        });

        return res.status(201).json({
          success: true,
          message: `Successfully imported ${outcome.inserted} ambulance services (${outcome.updated} updated)`,
          outcome,
        });
      } else {
        const validation = await validateFacilityBatch(records);
        if (validation.errorCount > 0) {
          return res.status(400).json({
            status: 'fail',
            message: `Batch contains ${validation.errorCount} invalid records. Please fix validation errors before importing.`,
            issues: validation.issues,
          });
        }
        const outcome = await executeFacilityImport(validation.validRecords, actorId);
        await logAdminActivity(actorId, 'DIRECTORY_FACILITY_IMPORT', {
          outcome,
          count: validation.validRecords.length,
        });

        return res.status(201).json({
          success: true,
          message: `Successfully imported ${outcome.inserted} healthcare facilities (${outcome.updated} updated)`,
          outcome,
        });
      }
    } catch (err: any) {
      return res.status(500).json({ status: 'error', message: err?.message || 'Failed to execute directory import' });
    }
  }
);

/**
 * PUT /api/v1/directory/admin/facilities/:id/verify
 * Update verification status of a directory facility
 */
router.put(
  '/admin/facilities/:id/verify',
  authenticate as any,
  authorize([Role.SUPER_ADMIN]) as any,
  async (req: Request, res: Response) => {
    try {
      const { verificationStatus, reviewNotes } = req.body;
      const validStatuses = ['VERIFIED', 'PENDING_REVIEW', 'FLAGGED', 'OUTDATED'];

      if (!verificationStatus || !validStatuses.includes(verificationStatus)) {
        return res.status(400).json({
          status: 'fail',
          message: `verificationStatus must be one of: ${validStatuses.join(', ')}`,
        });
      }

      const updated = await prisma.directoryFacility.update({
        where: { id: req.params.id },
        data: {
          verificationStatus,
          reviewNotes: reviewNotes || null,
          lastVerifiedAt: new Date(),
        },
      });

      await logAdminActivity((req as any).user!.id, 'DIRECTORY_FACILITY_VERIFIED', {
        targetId: req.params.id,
        status: verificationStatus,
        notes: reviewNotes,
      });

      return res.status(200).json({ success: true, data: updated });
    } catch (err: any) {
      return res.status(500).json({ status: 'error', message: err?.message || 'Failed to verify directory facility' });
    }
  }
);

/**
 * POST /api/v1/directory/admin/facilities/:id/link-hospital
 * Authorized workflow linking a public directory record to an approved LifeLink Hospital partner
 */
router.post(
  '/admin/facilities/:id/link-hospital',
  authenticate as any,
  authorize([Role.SUPER_ADMIN]) as any,
  async (req: Request, res: Response) => {
    try {
      const { hospitalId } = req.body;

      if (!hospitalId) {
        return res.status(400).json({ status: 'fail', message: 'hospitalId is required to link facility' });
      }

      const partnerHospital = await prisma.hospital.findUnique({
        where: { id: hospitalId },
      });

      if (!partnerHospital) {
        return res.status(404).json({ status: 'fail', message: `Partner hospital with ID '${hospitalId}' not found` });
      }

      const updated = await prisma.directoryFacility.update({
        where: { id: req.params.id },
        data: {
          linkedHospitalId: partnerHospital.id,
          linkStatus: 'LINKED_PARTNER',
          verificationStatus: 'VERIFIED',
          updatedAt: new Date(),
        },
      });

      await logAdminActivity((req as any).user!.id, 'DIRECTORY_FACILITY_LINKED_TO_PARTNER', {
        targetId: req.params.id,
        linkedHospitalId: partnerHospital.id,
        hospitalName: partnerHospital.name,
      });

      return res.status(200).json({
        success: true,
        message: `Public facility '${updated.name}' successfully linked to LifeLink Partner '${partnerHospital.name}'`,
        data: updated,
      });
    } catch (err: any) {
      return res.status(500).json({ status: 'error', message: err?.message || 'Failed to link facility to hospital' });
    }
  }
);

/**
 * GET /api/v1/directory/admin/review-issues
 * Retrieve open review issues
 */
router.get(
  '/admin/review-issues',
  authenticate as any,
  authorize([Role.SUPER_ADMIN]) as any,
  async (_req: Request, res: Response) => {
    try {
      const issues = await prisma.directoryReviewIssue.findMany({
        where: { status: 'OPEN' },
      });
      return res.status(200).json({ success: true, count: issues.length, data: issues });
    } catch (err: any) {
      return res.status(500).json({ status: 'error', message: err?.message || 'Failed to fetch review issues' });
    }
  }
);

/**
 * PUT /api/v1/directory/admin/review-issues/:id/resolve
 * Resolve an open review issue
 */
router.put(
  '/admin/review-issues/:id/resolve',
  authenticate as any,
  authorize([Role.SUPER_ADMIN]) as any,
  async (req: Request, res: Response) => {
    try {
      const { resolutionNotes } = req.body;
      const updated = await prisma.directoryReviewIssue.update({
        where: { id: req.params.id },
        data: {
          status: 'RESOLVED',
          resolvedBy: (req as any).user?.id || 'super-admin',
          resolvedAt: new Date(),
          description: resolutionNotes ? `RESOLVED: ${resolutionNotes}` : undefined,
        },
      });

      return res.status(200).json({ success: true, message: 'Issue resolved successfully', data: updated });
    } catch (err: any) {
      return res.status(500).json({ status: 'error', message: err?.message || 'Failed to resolve review issue' });
    }
  }
);

/**
 * PUT /api/v1/directory/admin/facilities/:id/status
 * Updates the directory facility lifecycle state (Phase 1)
 */
router.put(
  '/admin/facilities/:id/status',
  authenticate as any,
  authorize([Role.SUPER_ADMIN]) as any,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { onboardingStatus, reviewNotes } = req.body;

      const validStatuses = [
        'PUBLIC_DIRECTORY_RECORD',
        'CONTACT_INFO_CHECKED',
        'ONBOARDING_REQUESTED',
        'DOCUMENTS_SUBMITTED',
        'UNDER_REVIEW',
        'APPROVED',
        'SUSPENDED',
      ];

      if (!onboardingStatus || !validStatuses.includes(onboardingStatus)) {
        return res.status(400).json({
          status: 'fail',
          message: `onboardingStatus must be one of: ${validStatuses.join(', ')}`,
        });
      }

      const user = (req as any).user;
      const updateData: any = {
        onboardingStatus,
        reviewNotes: reviewNotes || undefined,
        updatedAt: new Date(),
      };

      if (onboardingStatus === 'CONTACT_INFO_CHECKED') {
        updateData.contactCheckedAt = new Date();
        updateData.contactCheckedBy = user?.id || 'SUPER_ADMIN';
      }

      const updated = await prisma.directoryFacility.update({
        where: { id },
        data: updateData,
      });

      await prisma.activityLog.create({
        data: {
          adminId: user?.id || 'system-admin',
          action: 'DIRECTORY_FACILITY_STATUS_UPDATED',
          metadata: { facilityId: id, onboardingStatus, reviewNotes },
        },
      });

      return res.status(200).json({
        success: true,
        message: `Directory facility lifecycle updated to ${onboardingStatus}`,
        data: updated,
      });
    } catch (err: any) {
      return res.status(500).json({ status: 'error', message: err?.message || 'Failed to update facility status' });
    }
  }
);

/**
 * PUT /api/v1/directory/admin/facilities/:id/correct
 * Corrects directory facility attributes with immutable audit logging
 */
router.put(
  '/admin/facilities/:id/correct',
  authenticate as any,
  authorize([Role.SUPER_ADMIN]) as any,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { name, contactNumber, address, lat, lng, pincode, reviewNotes } = req.body;

      const user = (req as any).user;
      const existing = await prisma.directoryFacility.findUnique({ where: { id } });
      if (!existing) return res.status(404).json({ status: 'fail', message: 'Facility not found' });

      const updateData: any = {
        name: name ? String(name).trim() : existing.name,
        contactNumber: contactNumber ? String(contactNumber).trim() : existing.contactNumber,
        address: address ? String(address).trim() : existing.address,
        pincode: pincode !== undefined ? pincode : existing.pincode,
        reviewNotes: reviewNotes || existing.reviewNotes,
      };

      if (lat !== undefined && lng !== undefined) {
        updateData.lat = parseFloat(lat);
        updateData.lng = parseFloat(lng);
        updateData.isGeocoded = true;
      }

      const updated = await prisma.directoryFacility.update({
        where: { id },
        data: updateData,
      });

      await prisma.activityLog.create({
        data: {
          adminId: user?.id || 'system-admin',
          action: 'DIRECTORY_FACILITY_CORRECTED',
          metadata: { facilityId: id, changes: updateData },
        },
      });

      return res.status(200).json({
        success: true,
        message: 'Facility details corrected successfully',
        data: updated,
      });
    } catch (err: any) {
      return res.status(500).json({ status: 'error', message: err?.message || 'Failed to correct facility' });
    }
  }
);

/**
 * PUT /api/v1/directory/admin/ambulances/:id/status
 * Updates directory ambulance operator lifecycle state
 */
router.put(
  '/admin/ambulances/:id/status',
  authenticate as any,
  authorize([Role.SUPER_ADMIN]) as any,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { onboardingStatus, reviewNotes } = req.body;

      const validStatuses = [
        'PUBLIC_DIRECTORY_RECORD',
        'CONTACT_INFO_CHECKED',
        'ONBOARDING_REQUESTED',
        'DOCUMENTS_SUBMITTED',
        'UNDER_REVIEW',
        'APPROVED',
        'SUSPENDED',
      ];

      if (!onboardingStatus || !validStatuses.includes(onboardingStatus)) {
        return res.status(400).json({
          status: 'fail',
          message: `onboardingStatus must be one of: ${validStatuses.join(', ')}`,
        });
      }

      const user = (req as any).user;
      const updateData: any = {
        onboardingStatus,
        reviewNotes: reviewNotes || undefined,
        updatedAt: new Date(),
      };

      if (onboardingStatus === 'CONTACT_INFO_CHECKED') {
        updateData.contactCheckedAt = new Date();
        updateData.contactCheckedBy = user?.id || 'SUPER_ADMIN';
      }

      const updated = await prisma.directoryAmbulanceService.update({
        where: { id },
        data: updateData,
      });

      await prisma.activityLog.create({
        data: {
          adminId: user?.id || 'system-admin',
          action: 'DIRECTORY_AMBULANCE_STATUS_UPDATED',
          metadata: { serviceId: id, onboardingStatus, reviewNotes },
        },
      });

      return res.status(200).json({
        success: true,
        message: `Directory ambulance service lifecycle updated to ${onboardingStatus}`,
        data: updated,
      });
    } catch (err: any) {
      return res.status(500).json({ status: 'error', message: err?.message || 'Failed to update ambulance status' });
    }
  }
);

/**
 * PUT /api/v1/directory/admin/ambulances/:id/correct
 * Corrects directory ambulance service attributes with immutable audit logging
 */
router.put(
  '/admin/ambulances/:id/correct',
  authenticate as any,
  authorize([Role.SUPER_ADMIN]) as any,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { serviceName, contactNumber, address, operatingArea, lat, lng, reviewNotes } = req.body;

      const user = (req as any).user;
      const existing = await prisma.directoryAmbulanceService.findUnique({ where: { id } });
      if (!existing) return res.status(404).json({ status: 'fail', message: 'Ambulance service not found' });

      const updateData: any = {
        serviceName: serviceName ? String(serviceName).trim() : existing.serviceName,
        contactNumber: contactNumber ? String(contactNumber).trim() : existing.contactNumber,
        address: address ? String(address).trim() : existing.address,
        operatingArea: operatingArea ? String(operatingArea).trim() : existing.operatingArea,
        reviewNotes: reviewNotes || existing.reviewNotes,
      };

      if (lat !== undefined && lng !== undefined) {
        updateData.lat = parseFloat(lat);
        updateData.lng = parseFloat(lng);
        updateData.isGeocoded = true;
      }

      const updated = await prisma.directoryAmbulanceService.update({
        where: { id },
        data: updateData,
      });

      await prisma.activityLog.create({
        data: {
          adminId: user?.id || 'system-admin',
          action: 'DIRECTORY_AMBULANCE_CORRECTED',
          metadata: { serviceId: id, changes: updateData },
        },
      });

      return res.status(200).json({
        success: true,
        message: 'Ambulance service details corrected successfully',
        data: updated,
      });
    } catch (err: any) {
      return res.status(500).json({ status: 'error', message: err?.message || 'Failed to correct ambulance service' });
    }
  }
);

/**
 * POST /api/v1/directory/admin/invite
 * Record an official onboarding invitation sent to a public directory organization
 */
router.post(
  '/admin/invite',
  authenticate as any,
  authorize([Role.SUPER_ADMIN]) as any,
  async (req: Request, res: Response) => {
    try {
      const { entityType, entityId, contactPersonName, contactEmail, invitationNotes } = req.body;
      const user = (req as any).user;

      if (!entityType || !entityId) {
        return res.status(400).json({ status: 'fail', message: 'entityType and entityId are required' });
      }

      let orgName = '';
      if (entityType === 'FACILITY') {
        const fac = await prisma.directoryFacility.findUnique({ where: { id: entityId } });
        if (!fac) return res.status(404).json({ status: 'fail', message: 'Facility not found' });
        orgName = fac.name;
        await prisma.directoryFacility.update({
          where: { id: entityId },
          data: {
            onboardingStatus: 'ONBOARDING_REQUESTED',
            reviewNotes: invitationNotes || `Onboarding invitation dispatched to ${contactEmail || 'public contact'}`,
          },
        });
      } else {
        const amb = await prisma.directoryAmbulanceService.findUnique({ where: { id: entityId } });
        if (!amb) return res.status(404).json({ status: 'fail', message: 'Ambulance service not found' });
        orgName = amb.serviceName;
        await prisma.directoryAmbulanceService.update({
          where: { id: entityId },
          data: {
            onboardingStatus: 'ONBOARDING_REQUESTED',
            reviewNotes: invitationNotes || `Onboarding invitation dispatched to ${contactEmail || 'public contact'}`,
          },
        });
      }

      await prisma.activityLog.create({
        data: {
          adminId: user?.id || 'system-admin',
          action: 'ONBOARDING_INVITATION_DISPATCHED',
          metadata: {
            entityType,
            entityId,
            orgName,
            contactPersonName,
            contactEmail,
            invitationNotes,
          },
        },
      });

      return res.status(200).json({
        success: true,
        message: `Onboarding invitation recorded for ${orgName}. Lifecycle updated to ONBOARDING_REQUESTED.`,
      });
    } catch (err: any) {
      return res.status(500).json({ status: 'error', message: err?.message || 'Failed to dispatch onboarding invitation' });
    }
  }
);

export default router;
