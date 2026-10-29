import { Router } from 'express';
import { Role, VerificationState, VerificationStatus } from '@prisma/client';
import { authenticate, AuthRequest, authorize } from '../middleware/auth';
import prisma from '../db';
import { checkServiceArea, calculateHaversineDistanceKm } from '../services/dispatchEngine';

const router = Router();

/**
 * 1. List all configured service areas
 * Supports filtering by city, state, country, active status, and pilot status.
 */
router.get('/', async (req, res) => {
  try {
    const { city, state, country, isActive, isPilot, page, limit } = req.query;

    const where: any = {};
    if (city) where.city = { equals: String(city), mode: 'insensitive' };
    if (state) where.state = { equals: String(state), mode: 'insensitive' };
    if (country) where.country = { equals: String(country), mode: 'insensitive' };
    if (isActive !== undefined) where.isActive = isActive === 'true';
    if (isPilot !== undefined) where.isPilot = isPilot === 'true';

    const areas = await prisma.serviceArea.findMany({ where });

    const pageNum = page ? Math.max(1, parseInt(String(page), 10)) : 1;
    const limitNum = limit ? Math.min(100, Math.max(1, parseInt(String(limit), 10))) : (page ? 20 : areas.length);
    const paginatedAreas = (page || limit) ? areas.slice((pageNum - 1) * limitNum, pageNum * limitNum) : areas;

    return res.json({
      success: true,
      count: paginatedAreas.length,
      total: areas.length,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(areas.length / (limitNum || 1)) || 1,
      data: paginatedAreas,
      serviceAreas: paginatedAreas,
      meta: {
        total: areas.length,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(areas.length / (limitNum || 1)) || 1,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to retrieve service areas' });
  }
});

/**
 * 1b. List all distinct expansion cities and their coverage status
 */
router.get('/cities', async (_req, res) => {
  try {
    const areas = await prisma.serviceArea.findMany();
    const cityMap = new Map<string, any>();

    for (const a of areas) {
      let metaStatus = null;
      if (a.metadata) {
        try {
          const meta = typeof a.metadata === 'string' ? JSON.parse(a.metadata) : a.metadata;
          if (meta?.status) metaStatus = meta.status;
        } catch {}
      }
      const status = metaStatus || (a.isPilot ? 'PILOT' : a.isActive ? 'ACTIVE' : 'PLANNED');
      const isOperational = status !== 'PLANNED' && (a.isPilot || a.isActive);

      const key = `${a.city.toLowerCase()}_${a.state.toLowerCase()}`;
      if (!cityMap.has(key)) {
        cityMap.set(key, {
          city: a.city,
          state: a.state,
          country: a.country || 'India',
          centerLat: a.centerLat,
          centerLng: a.centerLng,
          serviceAreasCount: 1,
          isPilot: a.isPilot,
          isActive: a.isActive,
          status,
          isOperational,
        });
      } else {
        const item = cityMap.get(key);
        item.serviceAreasCount++;
        if (a.isPilot) item.isPilot = true;
        if (status === 'ACTIVE' || status === 'PILOT') {
          item.status = status;
          item.isOperational = true;
        }
      }
    }

    return res.json({
      success: true,
      country: 'India',
      count: cityMap.size,
      cities: Array.from(cityMap.values()),
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to list expansion cities' });
  }
});

/**
 * 2. Check if specific geographic coordinates fall inside any active service area
 */
router.post('/check', async (req, res) => {
  const { lat, lng, requiredAmbulanceType, organizationId } = req.body;

  const pLat = parseFloat(lat);
  const pLng = parseFloat(lng);

  if (isNaN(pLat) || isNaN(pLng) || pLat < -90 || pLat > 90 || pLng < -180 || pLng > 180) {
    return res.status(400).json({
      success: false,
      message: 'Invalid coordinates. Latitude must be between -90 and 90, longitude between -180 and 180.',
      code: 'INVALID_COORDINATES',
    });
  }

  try {
    const result = await checkServiceArea(pLat, pLng, {
      requiredAmbulanceType,
      organizationId,
    });

    return res.json({
      success: true,
      inArea: result.inArea,
      distanceFromCenterKm: result.distanceFromCenterKm,
      serviceArea: result.serviceArea,
      reason: result.reason,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Service area evaluation failed' });
  }
});

/**
 * 2b. Fast Point Resolution: Resolve GPS coordinates to pilot / active service area
 * or identify nearest facility when coordinates fall outside operating zone.
 */
router.get('/resolve-point', async (req, res) => {
  const { lat, lng } = req.query;

  const pLat = parseFloat(String(lat));
  const pLng = parseFloat(String(lng));

  if (isNaN(pLat) || isNaN(pLng) || pLat < -90 || pLat > 90 || pLng < -180 || pLng > 180) {
    return res.status(400).json({
      success: false,
      message: 'Invalid coordinates. Latitude must be between -90 and 90, longitude between -180 and 180.',
      code: 'INVALID_COORDINATES',
    });
  }

  try {
    const areas = await prisma.serviceArea.findMany({ where: { isActive: true } });
    if (!areas || areas.length === 0) {
      return res.status(404).json({ success: false, inArea: false, message: 'No active service areas configured' });
    }

    let matchedArea: any = null;
    let minDistance = Infinity;
    let nearestArea: any = null;

    for (const a of areas) {
      const dist = calculateHaversineDistanceKm(pLat, pLng, a.centerLat, a.centerLng);
      if (dist < minDistance) {
        minDistance = dist;
        nearestArea = a;
      }
      if (dist <= a.radiusKm && !matchedArea) {
        matchedArea = a;
      }
    }

    if (matchedArea) {
      return res.json({
        success: true,
        inArea: true,
        distanceFromCenterKm: Math.round(minDistance * 100) / 100,
        matchedArea,
        serviceArea: matchedArea,
      });
    }

    return res.json({
      success: true,
      inArea: false,
      distanceFromCenterKm: Math.round(minDistance * 100) / 100,
      nearestArea,
      message: 'Coordinates fall outside active service area boundaries.',
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Service area point resolution failed' });
  }
});

/**
 * 3. Retrieve details for a single service area
 */
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const area = await prisma.serviceArea.findUnique({ where: { id } });
    if (!area) {
      return res.status(404).json({ message: 'Service area not found' });
    }

    // Parse metadata if available
    let parsedMetadata = null;
    if (area.metadata) {
      try {
        parsedMetadata = typeof area.metadata === 'string' ? JSON.parse(area.metadata) : area.metadata;
      } catch {
        parsedMetadata = area.metadata;
      }
    }

    return res.json({
      success: true,
      serviceArea: {
        ...area,
        parsedMetadata,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to retrieve service area' });
  }
});

/**
 * 3b. Expansion Safety: Evaluate Operational Readiness for a Service Area
 * A new city must NOT receive real dispatch traffic until its required organizations,
 * fleets, operating arrangements, and verification processes are configured and approved.
 */
router.get('/:id/readiness', async (req, res) => {
  const { id } = req.params;

  try {
    const area = await prisma.serviceArea.findUnique({ where: { id } });
    if (!area) {
      return res.status(404).json({ success: false, message: 'Service area not found' });
    }

    // 1. Query verified hospitals in this city
    const verifiedHospitals = await prisma.hospital.findMany({
      where: {
        city: { equals: area.city, mode: 'insensitive' },
        verificationState: VerificationState.VERIFIED,
      },
    });

    // 2. Query verified ambulances belonging to local hospital or operator
    const allAmbulances = await prisma.ambulance.findMany({
      where: {
        verificationStatus: VerificationStatus.APPROVED,
        verificationState: VerificationState.VERIFIED,
        isDemo: false,
      },
      include: { hospital: true, operator: true },
    });

    const localAmbulances = allAmbulances.filter((amb: any) => {
      const orgCity = amb.hospital?.city || amb.operator?.city;
      return orgCity && orgCity.toLowerCase() === area.city.toLowerCase();
    });

    // 3. Query verified drivers in this city
    const allDrivers = await prisma.driverProfile.findMany({
      where: {
        verificationState: VerificationState.VERIFIED,
        membershipStatus: 'APPROVED',
        isDemo: false,
      },
      include: { hospital: true, operator: true },
    });

    const localDrivers = allDrivers.filter((d: any) => {
      const orgCity = d.hospital?.city || d.operator?.city;
      return orgCity && orgCity.toLowerCase() === area.city.toLowerCase();
    });

    // Parse metadata for thresholds and expansion status
    let minHospitals = 1;
    let minAmbulances = 1;
    let status = area.isPilot ? 'PILOT' : area.isActive ? 'ACTIVE' : 'PLANNED';

    if (area.metadata) {
      try {
        const meta = typeof area.metadata === 'string' ? JSON.parse(area.metadata) : area.metadata;
        if (meta?.minVerifiedHospitals) minHospitals = meta.minVerifiedHospitals;
        if (meta?.minVerifiedAmbulances) minAmbulances = meta.minVerifiedAmbulances;
        if (meta?.status) status = meta.status;
      } catch {}
    }

    const blockers: string[] = [];
    if (!area.isActive) blockers.push('Service area is marked INACTIVE in administrative configuration.');
    if (status === 'PLANNED') blockers.push('City is in planned expansion phase. Commercial operating arrangements pending.');
    if (verifiedHospitals.length < minHospitals) {
      blockers.push(`Requires at least ${minHospitals} verified hospital partner in ${area.city} (currently ${verifiedHospitals.length}).`);
    }
    if (localAmbulances.length < minAmbulances) {
      blockers.push(`Requires at least ${minAmbulances} verified ambulance in ${area.city} (currently ${localAmbulances.length}).`);
    }

    const isOperational = blockers.length === 0;
    const readinessScore = Math.min(
      100,
      Math.round(
        (area.isActive ? 25 : 0) +
        (status !== 'PLANNED' ? 25 : 0) +
        Math.min(25, (verifiedHospitals.length / (minHospitals || 1)) * 25) +
        Math.min(25, (localAmbulances.length / (minAmbulances || 1)) * 25)
      )
    );

    return res.json({
      success: true,
      serviceAreaId: area.id,
      serviceArea: {
        id: area.id,
        name: area.name,
        city: area.city,
        state: area.state,
        country: area.country || 'India',
        status,
        isPilot: area.isPilot,
        isActive: area.isActive,
      },
      name: area.name,
      city: area.city,
      state: area.state,
      country: area.country || 'India',
      status,
      isOperational,
      isReadyForLiveDispatch: isOperational,
      readinessScore,
      metrics: {
        verifiedHospitalsCount: verifiedHospitals.length,
        verifiedAmbulancesCount: localAmbulances.length,
        verifiedDriversCount: localDrivers.length,
        minRequiredHospitals: minHospitals,
        minRequiredAmbulances: minAmbulances,
      },
      blockers,
      emergencyNotice: isOperational
        ? 'Live emergency dispatch is active.'
        : `Service area is in onboarding/readiness phase. Live dispatch disabled. Emergency callers directed to National Emergency 112.`,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to evaluate service area readiness' });
  }
});

/**
 * 4. Create a new service area (Super Admin only)
 * Enables multi-city expansion beyond Nagpur (e.g. Pune, Mumbai, Wardha, Amravati, Pan-India).
 */
router.post('/', authenticate, authorize([Role.SUPER_ADMIN]), async (req: AuthRequest, res) => {
  const {
    name,
    city,
    state,
    country = 'India',
    centerLat,
    centerLng,
    radiusKm,
    isActive = true,
    isPilot = false,
    metadata,
  } = req.body;

  if (!name || !city || !state || centerLat === undefined || centerLng === undefined || radiusKm === undefined) {
    return res.status(400).json({
      message: 'Missing required fields: name, city, state, centerLat, centerLng, and radiusKm are mandatory.',
    });
  }

  const cLat = parseFloat(centerLat);
  const cLng = parseFloat(centerLng);
  const rad = parseFloat(radiusKm);

  if (isNaN(cLat) || isNaN(cLng) || cLat < -90 || cLat > 90 || cLng < -180 || cLng > 180) {
    return res.status(400).json({ message: 'Invalid center coordinates.' });
  }

  if (isNaN(rad) || rad <= 0 || rad > 500) {
    return res.status(400).json({ message: 'radiusKm must be a positive number up to 500 km.' });
  }

  try {
    const metadataStr = metadata ? (typeof metadata === 'string' ? metadata : JSON.stringify(metadata)) : null;

    const newArea = await prisma.serviceArea.create({
      data: {
        name,
        city,
        state,
        country,
        centerLat: cLat,
        centerLng: cLng,
        radiusKm: rad,
        isActive: Boolean(isActive),
        isPilot: Boolean(isPilot),
        metadata: metadataStr,
      },
    });

    return res.status(201).json({
      success: true,
      message: `Service area "${name}" created successfully for ${city}, ${state}.`,
      serviceArea: newArea,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to create service area' });
  }
});

/**
 * 5. Update an existing service area (Super Admin only)
 */
router.put('/:id', authenticate, authorize([Role.SUPER_ADMIN]), async (req: AuthRequest, res) => {
  const { id } = req.params;
  const {
    name,
    city,
    state,
    country,
    centerLat,
    centerLng,
    radiusKm,
    isActive,
    isPilot,
    metadata,
  } = req.body;

  try {
    const existing = await prisma.serviceArea.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ message: 'Service area not found' });
    }

    const data: any = {};
    if (name !== undefined) data.name = name;
    if (city !== undefined) data.city = city;
    if (state !== undefined) data.state = state;
    if (country !== undefined) data.country = country;
    if (centerLat !== undefined) data.centerLat = parseFloat(centerLat);
    if (centerLng !== undefined) data.centerLng = parseFloat(centerLng);
    if (radiusKm !== undefined) data.radiusKm = parseFloat(radiusKm);
    if (isActive !== undefined) data.isActive = Boolean(isActive);
    if (isPilot !== undefined) data.isPilot = Boolean(isPilot);
    if (metadata !== undefined) {
      data.metadata = typeof metadata === 'string' ? metadata : JSON.stringify(metadata);
    }

    const updated = await prisma.serviceArea.update({
      where: { id },
      data,
    });

    return res.json({
      success: true,
      message: 'Service area updated successfully',
      serviceArea: updated,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to update service area' });
  }
});

/**
 * 6. Delete / Deactivate a service area (Super Admin only)
 */
router.delete('/:id', authenticate, authorize([Role.SUPER_ADMIN]), async (req: AuthRequest, res) => {
  const { id } = req.params;

  try {
    const existing = await prisma.serviceArea.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ message: 'Service area not found' });
    }

    await prisma.serviceArea.delete({ where: { id } });

    return res.json({
      success: true,
      message: `Service area "${existing.name}" removed successfully.`,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to delete service area' });
  }
});

export default router;
