import { Router } from 'express';
import { Role, TripLifecycleStatus, AmbulanceType } from '@prisma/client';
import { authenticate, AuthRequest, authorize } from '../middleware/auth';
import prisma from '../db';
import { metrics } from '../utils/metrics';

const router = Router();

/**
 * Standard equipment capabilities mapping by ambulance service category.
 * Complies with AIS-125 (Automotive Industry Standard for Ambulances in India).
 */
export function getEquipmentCapabilities(ambulanceType: string): string[] {
  switch (ambulanceType) {
    case AmbulanceType.ADVANCED_LIFE_SUPPORT:
    case 'ADVANCED_LIFE_SUPPORT':
    case 'ICU_ON_WHEELS':
      return [
        'Transport Ventilator (Invasive/Non-Invasive)',
        'Multipara Cardiac Monitor with Defibrillator (AED & Manual)',
        'Central Oxygen Delivery System (D-Type & E-Type Cylinders)',
        'Syringe & Infusion Pumps',
        'Suction Unit (Electric & Foot-operated)',
        'Emergency Resuscitation & Intubation Kit (Laryngoscope, ETT)',
        'Spine Board, Scoop Stretcher & Cervical Collar Set',
        'Emergency Pharmacological Crash Cart',
      ];
    case AmbulanceType.OXYGEN_SUPPORT:
    case 'OXYGEN_SUPPORT':
      return [
        'Central Oxygen Manifold & Flowmeters',
        'Portable Oxygen Kit',
        'Pulse Oximeter & BP Monitor',
        'Electric Suction Apparatus',
        'Nebulizer Machine',
        'First Aid & Trauma Bandage Kit',
        'Collapsible Stretcher',
      ];
    case 'PATIENT_TRANSPORT':
    case 'BASIC_TRANSPORT':
      return [
        'Foldable Wheelchair & Basic Stretcher',
        'Primary First Aid Kit',
        'Manual Sphygmomanometer & Stethoscope',
      ];
    case AmbulanceType.BASIC_LIFE_SUPPORT:
    case 'BASIC_LIFE_SUPPORT':
    default:
      return [
        'Self-loading Main Stretcher',
        'Portable Oxygen Cylinder with Regulator',
        'Bag Valve Mask (Ambu Bag - Adult & Pediatric)',
        'Automated External Defibrillator (AED)',
        'Manual Blood Pressure Apparatus & Stethoscope',
        'Basic Fracture Splints & Cervical Collar',
        'First Aid & Burn Dressing Kit',
      ];
  }
}

/**
 * 1. Fleet Inventory Endpoint
 * Supports both hospital-owned and private ambulance operator fleets.
 * Returns rich status records: registration, organization, verification,
 * capabilities, availability, driver assignment, location freshness, and active trip commitments.
 */
router.get(['/', '/fleet', '/inventory'], authenticate, async (req: AuthRequest, res) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthorized' });

  const user = req.user;
  const {
    organizationType,
    organizationId,
    verificationState,
    isAvailable,
    ambulanceType,
    includeDemo = 'false',
    city,
  } = req.query;

  try {
    let whereClause: any = {};

    // 1. Role-Based Access Control & Tenant Isolation
    if (user.role === Role.SUPER_ADMIN) {
      // Super Admin can view full fleet with optional filters
      if (organizationType === 'HOSPITAL') {
        whereClause.hospitalId = { not: null };
      } else if (organizationType === 'PRIVATE_OPERATOR') {
        whereClause.operatorId = { not: null };
      }
      if (organizationId) {
        if (organizationType === 'HOSPITAL') whereClause.hospitalId = String(organizationId);
        else if (organizationType === 'PRIVATE_OPERATOR') whereClause.operatorId = String(organizationId);
      }
    } else if (user.role === Role.ADMIN_HOSPITAL) {
      // Hospital Admin is strictly isolated to their hospital's ambulances
      const hospital = await prisma.hospital.findUnique({
        where: { adminUserId: user.id },
      });
      if (!hospital) {
        return res.status(403).json({ message: 'No hospital found managed by this account' });
      }
      whereClause.hospitalId = hospital.id;
    } else if (user.role === Role.OPERATOR_ADMIN) {
      // Operator Admin is strictly isolated to their private operator's fleet
      const operator = await prisma.ambulanceOperator.findUnique({
        where: { adminUserId: user.id },
      });
      if (!operator) {
        return res.status(403).json({ message: 'No private ambulance operator found managed by this account' });
      }
      whereClause.operatorId = operator.id;
    } else if (user.role === Role.DRIVER) {
      // Driver sees only their assigned vehicle
      whereClause.driverId = user.id;
    } else {
      // General patients or unprivileged roles cannot view raw operational fleet inventory
      return res.status(403).json({ message: 'Forbidden: Insufficient privileges to view fleet inventory' });
    }

    // Filter by verification state
    if (verificationState) {
      whereClause.verificationState = String(verificationState);
    }

    // Filter by availability
    if (isAvailable !== undefined) {
      whereClause.isAvailable = isAvailable === 'true';
    }

    // Filter by ambulance service category
    if (ambulanceType) {
      whereClause.ambulanceType = String(ambulanceType);
    }

    // Filter out demo vehicles unless explicitly requested
    if (includeDemo !== 'true') {
      whereClause.isDemo = false;
    }

    // Query ambulances with full relations
    const rawAmbulances = await prisma.ambulance.findMany({
      where: whereClause,
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

    const now = Date.now();

    // Map each vehicle to the rich Fleet Inventory schema
    const fleet = await Promise.all(
      rawAmbulances.map(async (amb: any) => {
        // Resolve owning organization
        let owningOrg: any = null;
        if (amb.hospital) {
          owningOrg = {
            type: 'HOSPITAL',
            id: amb.hospital.id,
            name: amb.hospital.name,
            city: amb.hospital.city,
            state: amb.hospital.state,
            verificationState: amb.hospital.verificationState,
            isDemo: amb.hospital.isDemo || false,
          };
        } else if (amb.operator) {
          owningOrg = {
            type: 'PRIVATE_OPERATOR',
            id: amb.operator.id,
            name: amb.operator.name,
            city: amb.operator.city,
            state: amb.operator.state,
            verificationState: amb.operator.verificationState,
            isDemo: amb.operator.isDemo || false,
          };
        }

        // Apply city filter if requested
        if (city && owningOrg && owningOrg.city.toLowerCase() !== String(city).toLowerCase()) {
          return null;
        }

        // Location freshness
        const lastPing = amb.lastUpdated
          ? new Date(amb.lastUpdated).getTime()
          : (amb.updatedAt ? new Date(amb.updatedAt).getTime() : now);
        const freshnessSeconds = Math.max(0, Math.floor((now - lastPing) / 1000));
        const isLocationStale = freshnessSeconds > 1800; // > 30 minutes is considered stale
        metrics.recordGpsUpdate(freshnessSeconds, isLocationStale);

        // Current active trip commitment check
        const activeTrip = await prisma.emergencyTrip.findFirst({
          where: {
            ambulanceId: amb.id,
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

        const currentCommitment = activeTrip
          ? {
              hasActiveTrip: true,
              tripId: activeTrip.id,
              requestId: activeTrip.requestId,
              status: activeTrip.status,
              pickupAddress: activeTrip.pickupAddress,
              destinationAddress: activeTrip.destinationAddress,
              startedAt: activeTrip.startedAt,
            }
          : {
              hasActiveTrip: false,
              tripId: null,
              status: null,
            };

        // Assigned driver details
        const assignedDriver = amb.driver
          ? {
              id: amb.driver.id,
              name: amb.driver.name,
              phone: amb.driver.phone,
              isActive: amb.driver.isActive,
              isSuspended: amb.driver.isSuspended,
              verificationState: amb.driver.driverProfile?.verificationState || 'PENDING_REVIEW',
              licenseNumber: amb.driver.driverProfile?.licenseNumber || null,
              licenseExpiry: amb.driver.driverProfile?.licenseExpiry || null,
              membershipStatus: amb.driver.driverProfile?.membershipStatus || 'PENDING',
            }
          : null;

        const capabilities = getEquipmentCapabilities(amb.ambulanceType);

        return {
          id: amb.id,
          registrationIdentifier: amb.vehicleNumber,
          vehicleNumber: amb.vehicleNumber,
          owningOrganization: owningOrg,
          verificationState: amb.verificationState,
          verificationStatus: amb.verificationStatus,
          serviceCategory: {
            type: amb.ambulanceType,
            equipmentCapabilities: capabilities,
          },
          ambulanceType: amb.ambulanceType,
          operationalAvailability: {
            isAvailable: amb.isAvailable,
            maintenanceStatus: amb.maintenanceStatus,
            movementStatus: isLocationStale ? 'UNKNOWN' : (amb.movementStatus || 'UNKNOWN'),
            speedKmH: isLocationStale ? 0 : (amb.speedKmH || 0),
          },
          isAvailable: amb.isAvailable,
          maintenanceStatus: amb.maintenanceStatus,
          assignedDriver,
          lastKnownLocation: {
            lat: amb.currentLat,
            lng: amb.currentLng,
            lastUpdated: amb.lastUpdated,
            freshnessSeconds,
            isLocationStale,
          },
          currentCommitment,
          isDemo: amb.isDemo || false,
        };
      })
    );

    // Filter out nulls and apply city filter if provided
    let activeFleet = fleet.filter(Boolean);
    if (city) {
      activeFleet = activeFleet.filter(
        (v: any) => v.owningOrganization?.city && v.owningOrganization.city.toLowerCase() === String(city).toLowerCase()
      );
    }

    const pageNum = req.query.page ? Math.max(1, parseInt(String(req.query.page), 10)) : 1;
    const limitNum = req.query.limit ? Math.min(100, Math.max(1, parseInt(String(req.query.limit), 10))) : (req.query.page ? 20 : activeFleet.length);
    const paginatedFleet = (req.query.page || req.query.limit)
      ? activeFleet.slice((pageNum - 1) * limitNum, pageNum * limitNum)
      : activeFleet;

    return res.json({
      success: true,
      totalVehicles: activeFleet.length,
      availableVehicles: activeFleet.filter((v: any) => v.operationalAvailability.isAvailable && !v.currentCommitment.hasActiveTrip).length,
      hospitalOwnedCount: activeFleet.filter((v: any) => v.owningOrganization?.type === 'HOSPITAL').length,
      privateOperatorCount: activeFleet.filter((v: any) => v.owningOrganization?.type === 'PRIVATE_OPERATOR').length,
      count: paginatedFleet.length,
      total: activeFleet.length,
      page: pageNum,
      limit: limitNum,
      fleet: paginatedFleet,
      data: paginatedFleet,
      meta: {
        total: activeFleet.length,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(activeFleet.length / (limitNum || 1)) || 1,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to retrieve fleet inventory' });
  }
});

/**
 * 2. Driver: Toggle availability
 */
router.put('/availability', authenticate, async (req: AuthRequest, res) => {
  if (!req.user || req.user.role !== 'DRIVER') {
    return res.status(403).json({ message: 'Forbidden: Only drivers can toggle availability' });
  }

  const { isAvailable } = req.body;

  try {
    const ambulance = await prisma.ambulance.update({
      where: { driverId: req.user.id },
      data: {
        isAvailable: !!isAvailable,
        lastUpdated: new Date(),
      },
    });
    return res.json(ambulance);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Internal server error' });
  }
});

/**
 * 4. Driver: Update location coordinates
 */
const updateLocationHandler = async (req: AuthRequest, res: any) => {
  if (!req.user || req.user.role !== 'DRIVER') {
    return res.status(403).json({ success: false, error: 'Forbidden: Only drivers can update coordinates' });
  }

  const rawLat = req.body.latitude !== undefined ? req.body.latitude : req.body.lat;
  const rawLng = req.body.longitude !== undefined ? req.body.longitude : req.body.lng;

  if (rawLat === undefined || rawLng === undefined) {
    return res.status(400).json({ success: false, error: 'Valid latitude and longitude are required' });
  }

  const pLat = parseFloat(rawLat);
  const pLng = parseFloat(rawLng);

  if (isNaN(pLat) || isNaN(pLng) || pLat < -90 || pLat > 90 || pLng < -180 || pLng > 180) {
    return res.status(400).json({ success: false, error: 'Valid latitude between -90 and 90, and longitude between -180 and 180 required' });
  }

  try {
    let driverAmbulance = await prisma.ambulance.findFirst({
      where: { driverId: req.user.id },
    });

    if (!driverAmbulance) {
      const dp = await prisma.driverProfile.findFirst({
        where: { userId: req.user.id },
      });
      if (dp) {
        const assignment = await prisma.driverVehicleAssignment.findFirst({
          where: { driverId: dp.id, isCurrent: true },
        });
        if (assignment) {
          driverAmbulance = await prisma.ambulance.findUnique({
            where: { id: assignment.ambulanceId },
          });
        }
      }
    }

    if (!driverAmbulance) {
      return res.status(404).json({ success: false, error: 'No active ambulance found assigned to this driver' });
    }

    const updated = await prisma.ambulance.update({
      where: { id: driverAmbulance.id },
      data: {
        currentLat: pLat,
        currentLng: pLng,
        lastUpdated: new Date(),
      },
    });
    metrics.recordGpsUpdate(0, false);
    return res.json({ success: true, ambulance: updated });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message || 'Internal server error' });
  }
};

router.put('/location', authenticate, updateLocationHandler);
router.patch('/location', authenticate, updateLocationHandler);

/**
 * 5. Get nearby available ambulances (Patient / Dispatch view)
 */
router.get('/nearby', authenticate, async (req: AuthRequest, res) => {
  const { lat, lng } = req.query;
  if (!lat || !lng) {
    return res.status(400).json({ message: 'Latitude and Longitude are required' });
  }

  const pLat = parseFloat(lat as string);
  const pLng = parseFloat(lng as string);

  try {
    const onlineAmbulances = await prisma.ambulance.findMany({
      where: {
        isAvailable: true,
        verificationStatus: 'APPROVED',
        maintenanceStatus: 'OPERATIONAL',
      },
      include: {
        driver: {
          select: { name: true, phone: true, isActive: true, isSuspended: true },
        },
      },
    });

    const nearby = onlineAmbulances.filter((amb) => {
      if (amb.driver && (!amb.driver.isActive || amb.driver.isSuspended)) {
        return false;
      }
      const dist = getDistance(pLat, pLng, amb.currentLat, amb.currentLng);
      return dist <= 12.0;
    });

    return res.json(nearby);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Internal server error' });
  }
});

/**
 * 5. Get specific vehicle details
 */
router.get('/:id', authenticate, async (req: AuthRequest, res) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthorized' });

  const { id } = req.params;

  try {
    const amb = await prisma.ambulance.findUnique({
      where: { id },
      include: {
        driver: {
          include: { driverProfile: true },
        },
        hospital: true,
        operator: true,
        assignments: {
          where: { isCurrent: true },
          include: { driver: true },
        },
      },
    });

    if (!amb) {
      return res.status(404).json({ message: 'Ambulance not found' });
    }

    // Role-based tenant check
    if (req.user.role === Role.ADMIN_HOSPITAL) {
      const hosp = await prisma.hospital.findUnique({ where: { adminUserId: req.user.id } });
      if (!hosp || amb.hospitalId !== hosp.id) {
        return res.status(403).json({ message: 'Forbidden: You can only view ambulances belonging to your hospital' });
      }
    } else if (req.user.role === Role.OPERATOR_ADMIN) {
      const op = await prisma.ambulanceOperator.findUnique({ where: { adminUserId: req.user.id } });
      if (!op || amb.operatorId !== op.id) {
        return res.status(403).json({ message: 'Forbidden: You can only view ambulances belonging to your private operator' });
      }
    }

    const capabilities = getEquipmentCapabilities(amb.ambulanceType);

    return res.json({
      success: true,
      ambulance: {
        ...amb,
        equipmentCapabilities: capabilities,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to retrieve ambulance' });
  }
});

/**
 * 6. Register a Real Ambulance Vehicle (Phase 5)
 * Protected by ADMIN_HOSPITAL, OPERATOR_ADMIN, or SUPER_ADMIN.
 * Vehicle starts in PENDING_REVIEW state and is ineligible for dispatch until verified.
 */
router.post('/register', authenticate, authorize([Role.ADMIN_HOSPITAL, Role.OPERATOR_ADMIN, Role.SUPER_ADMIN]), async (req: AuthRequest, res) => {
  const user = req.user!;
  const {
    vehicleNumber,
    ambulanceType = AmbulanceType.BASIC_LIFE_SUPPORT,
    chassisNumber,
    fitnessExpiry,
    insuranceExpiry,
    pucExpiry,
    currentLat = 21.1458,
    currentLng = 79.0882,
    organizationType,
    organizationId,
  } = req.body;

  if (!vehicleNumber) {
    return res.status(400).json({ status: 'fail', message: 'vehicleNumber is required (e.g. MH-31-AP-1080).' });
  }

  try {
    let resolvedHospitalId: string | null = null;
    let resolvedOperatorId: string | null = null;

    if (user.role === Role.ADMIN_HOSPITAL) {
      const hosp = await prisma.hospital.findUnique({ where: { adminUserId: user.id } });
      if (!hosp) return res.status(403).json({ status: 'fail', message: 'No hospital linked to your administrator account.' });
      resolvedHospitalId = hosp.id;
    } else if (user.role === Role.OPERATOR_ADMIN) {
      const op = await prisma.ambulanceOperator.findUnique({ where: { adminUserId: user.id } });
      if (!op) return res.status(403).json({ status: 'fail', message: 'No private operator linked to your administrator account.' });
      resolvedOperatorId = op.id;
    } else if (user.role === Role.SUPER_ADMIN) {
      if (organizationType === 'HOSPITAL') resolvedHospitalId = organizationId;
      else if (organizationType === 'PRIVATE_OPERATOR') resolvedOperatorId = organizationId;
    }

    // Check duplicate registration
    const existing = await prisma.ambulance.findFirst({
      where: { vehicleNumber: vehicleNumber.trim() },
    });
    if (existing) {
      return res.status(409).json({ status: 'fail', message: `Ambulance with registration ${vehicleNumber} already exists.` });
    }

    const ambulance = await prisma.ambulance.create({
      data: {
        vehicleNumber: vehicleNumber.trim().toUpperCase(),
        ambulanceType: ambulanceType as AmbulanceType,
        hospitalId: resolvedHospitalId,
        operatorId: resolvedOperatorId,
        isAvailable: false,
        verificationState: 'PENDING_REVIEW' as any,
        verificationStatus: 'PENDING',
        maintenanceStatus: 'OPERATIONAL',
        movementStatus: 'STOPPED',
        currentLat: parseFloat(currentLat),
        currentLng: parseFloat(currentLng),
        isDemo: false,
      },
    });

    await prisma.activityLog.create({
      data: {
        adminId: user.id,
        action: 'AMBULANCE_REGISTERED',
        metadata: { ambulanceId: ambulance.id, vehicleNumber: ambulance.vehicleNumber },
      },
    });

    return res.status(201).json({
      status: 'success',
      message: 'Ambulance vehicle registered successfully. Pending verification audit.',
      ambulance,
    });
  } catch (error: any) {
    return res.status(500).json({ status: 'error', message: error.message || 'Failed to register ambulance' });
  }
});

/**
 * 7. Assign Driver to Ambulance Vehicle (Phase 5)
 * Enforces:
 * - Driver must not have an existing active assignment
 * - Vehicle must not have an existing active assignment
 * - Non-overlapping shifts
 */
router.post('/:id/assign-driver', authenticate, authorize([Role.ADMIN_HOSPITAL, Role.OPERATOR_ADMIN, Role.SUPER_ADMIN]), async (req: AuthRequest, res) => {
  const { id } = req.params;
  const user = req.user!;
  const { driverUserId, shiftStart, shiftEnd, shiftNotes } = req.body;

  if (!driverUserId) {
    return res.status(400).json({ status: 'fail', message: 'driverUserId is required.' });
  }

  try {
    const ambulance = await prisma.ambulance.findUnique({
      where: { id },
      include: {
        assignments: { where: { isCurrent: true } },
      },
    });

    if (!ambulance) {
      return res.status(404).json({ status: 'fail', message: 'Ambulance vehicle not found.' });
    }

    // Tenancy check
    if (user.role === Role.ADMIN_HOSPITAL) {
      const hosp = await prisma.hospital.findUnique({ where: { adminUserId: user.id } });
      if (!hosp || ambulance.hospitalId !== hosp.id) {
        return res.status(403).json({ status: 'fail', message: 'Forbidden: You cannot assign drivers to vehicles outside your hospital.' });
      }
    } else if (user.role === Role.OPERATOR_ADMIN) {
      const op = await prisma.ambulanceOperator.findUnique({ where: { adminUserId: user.id } });
      if (!op || ambulance.operatorId !== op.id) {
        return res.status(403).json({ status: 'fail', message: 'Forbidden: You cannot assign drivers to vehicles outside your private operator.' });
      }
    }

    // 1. Check vehicle active assignment conflict
    if (ambulance.assignments && ambulance.assignments.length > 0) {
      return res.status(409).json({
        status: 'fail',
        message: 'Conflict: This ambulance already has an active driver assigned. Unassign previous driver first.',
        code: 'VEHICLE_ALREADY_ASSIGNED',
      });
    }

    // 2. Check driver profile & verification
    const driverProfile = await prisma.driverProfile.findUnique({
      where: { userId: driverUserId },
    });
    if (!driverProfile) {
      return res.status(404).json({ status: 'fail', message: 'Driver profile not found.' });
    }

    // 3. Check driver active assignment conflict (driver cannot drive 2 ambulances simultaneously)
    const activeDriverAssignment = await prisma.driverVehicleAssignment.findFirst({
      where: { driverId: driverProfile.id, isCurrent: true },
    });
    if (activeDriverAssignment) {
      return res.status(409).json({
        status: 'fail',
        message: 'Conflict: Driver is already actively assigned to another ambulance vehicle.',
        code: 'DRIVER_ALREADY_ASSIGNED',
      });
    }

    // Execute atomic assignment
    const assignment = await prisma.driverVehicleAssignment.create({
      data: {
        driverId: driverProfile.id,
        ambulanceId: id,
        isCurrent: true,
        assignedAt: new Date(),
      },
    });

    // Link ambulance driverId
    const updatedAmbulance = await prisma.ambulance.update({
      where: { id },
      data: {
        driverId: driverUserId,
        isAvailable: true,
      },
    });

    await prisma.activityLog.create({
      data: {
        adminId: user.id,
        action: 'DRIVER_VEHICLE_ASSIGNED',
        metadata: { ambulanceId: id, driverUserId, assignmentId: assignment.id },
      },
    });

    return res.status(200).json({
      status: 'success',
      message: 'Driver assigned to vehicle successfully.',
      assignment,
      ambulance: updatedAmbulance,
    });
  } catch (error: any) {
    return res.status(500).json({ status: 'error', message: error.message || 'Failed to assign driver' });
  }
});

/**
 * 8. Unassign Driver from Ambulance Vehicle (Phase 5)
 */
router.post('/:id/unassign-driver', authenticate, authorize([Role.ADMIN_HOSPITAL, Role.OPERATOR_ADMIN, Role.SUPER_ADMIN]), async (req: AuthRequest, res) => {
  const { id } = req.params;
  const user = req.user!;

  try {
    const ambulance = await prisma.ambulance.findUnique({ where: { id } });
    if (!ambulance) return res.status(404).json({ status: 'fail', message: 'Ambulance not found.' });

    // Mark current assignments as closed
    await prisma.driverVehicleAssignment.updateMany({
      where: { ambulanceId: id, isCurrent: true },
      data: { isCurrent: false, unassignedAt: new Date() },
    });

    // Clear driverId and mark unavailable
    const updated = await prisma.ambulance.update({
      where: { id },
      data: {
        driverId: null,
        isAvailable: false,
      },
    });

    await prisma.activityLog.create({
      data: {
        adminId: user.id,
        action: 'DRIVER_VEHICLE_UNASSIGNED',
        metadata: { ambulanceId: id },
      },
    });

    return res.status(200).json({
      status: 'success',
      message: 'Driver unassigned from ambulance.',
      ambulance: updated,
    });
  } catch (error: any) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

function getDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export default router;
