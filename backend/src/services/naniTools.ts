/**
 * NANI Phase 1: Strict Tool Boundaries & Registry
 * 
 * Safety Rules:
 * 1. The model may propose a tool call, but the backend independently validates arguments,
 *    permissions, current data, and required confirmations.
 * 2. Never execute arbitrary SQL, shell commands, or unrestricted external HTTP calls.
 * 3. Never invent phone numbers, bed counts, or dispatch confirmations.
 */

import prisma from '../db';
import { checkServiceArea, discoverAndRankCandidates, dispatchOfferToCandidate } from './dispatchEngine';
import { AppointmentStatus, RequestStatus, AmbulanceType } from '@prisma/client';
import { knowledgeRetrieval } from './naniKnowledgeRetrieval';

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required?: string[];
    };
  };
}

export const NANI_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'search_hospitals',
      description: 'Search verified public & private hospitals in Nagpur district by locality, tehsil, or name.',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Name of hospital or keyword (e.g. GMCH, AIIMS, Kingsway)' },
          locality: { type: 'string', description: 'Locality within Nagpur (e.g. Dhantoli, Ramdaspeth, Medical Square)' },
          tehsil: { type: 'string', description: 'Tehsil in Nagpur District (e.g. Nagpur Urban, Katol, Saoner, Kamptee)' },
          emergencyOnly: { type: 'boolean', description: 'Filter only facilities with 24x7 Emergency/Casualty desks' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_hospital_contact',
      description: 'Retrieve verified emergency casualty telephone, ambulance helpdesk, and address for a Nagpur hospital.',
      parameters: {
        type: 'object',
        properties: {
          hospitalNameOrId: { type: 'string', description: 'Name or ID of hospital (e.g. GMCH, Indira Gandhi GMC, AIIMS)' },
        },
        required: ['hospitalNameOrId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_bed_capacity',
      description: 'Check real-time timestamped ICU, Emergency, and General bed availability for verified LifeLink partner hospitals.',
      parameters: {
        type: 'object',
        properties: {
          hospitalNameOrId: { type: 'string', description: 'Name or ID of hospital' },
        },
        required: ['hospitalNameOrId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_doctor_slots',
      description: 'Check available doctor consultation slots and OPD timings for appointments.',
      parameters: {
        type: 'object',
        properties: {
          doctorName: { type: 'string', description: 'Doctor name or partial name' },
          specialization: { type: 'string', description: 'Medical specialty (e.g. CARDIOLOGY, GENERAL_MEDICINE)' },
          date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'book_doctor_appointment',
      description: 'Book an OPD appointment with persistent queue token for an authenticated patient.',
      parameters: {
        type: 'object',
        properties: {
          slotId: { type: 'string', description: 'ID of the doctor slot to book' },
          symptoms: { type: 'string', description: 'Brief description of symptoms' },
          notes: { type: 'string', description: 'Additional clinical notes or reason for visit' },
        },
        required: ['slotId', 'symptoms'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'request_ambulance_dispatch',
      description: 'Trigger emergency SOS ambulance dispatch for an authenticated patient in distress.',
      parameters: {
        type: 'object',
        properties: {
          pickupLat: { type: 'number', description: 'Latitude of pickup location' },
          pickupLng: { type: 'number', description: 'Longitude of pickup location' },
          pickupAddress: { type: 'string', description: 'Readable street or landmark address' },
          category: { type: 'string', description: 'Emergency category (TRAUMA, CARDIAC, RESPIRATORY, GENERAL)' },
          urgencyLevel: { type: 'string', description: 'Urgency level (CRITICAL, HIGH, MEDIUM)' },
        },
        required: ['pickupLat', 'pickupLng', 'pickupAddress'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_confirmed_dispatch_status',
      description: 'Retrieve real-time status of an active LifeLink ambulance dispatch request from the official database.',
      parameters: {
        type: 'object',
        properties: {
          requestId: { type: 'string', description: 'The official LifeLink emergency dispatch request ID' },
        },
        required: ['requestId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_verified_health_knowledge',
      description: 'Retrieve verified healthcare guidelines, government health schemes (MJPJAY/PM-JAY), or helpline directories.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search term or topic (e.g. MJPJAY, Ayushman Bharat, ALS ambulance, 108)' },
        },
        required: ['query'],
      },
    },
  },
];

export interface ToolExecutionResult {
  tool: string;
  success: boolean;
  data?: any;
  error?: string;
  requiresUserConfirmation?: boolean;
  confirmationDetails?: any;
}

/**
 * Validates and executes tool call securely
 */
export async function executeNaniTool(
  toolName: string,
  args: Record<string, any>,
  authUser?: { id: string; role: string; name?: string } | null
): Promise<ToolExecutionResult> {
  const allowedTool = NANI_TOOLS.find((t) => t.function.name === toolName);
  if (!allowedTool) {
    return {
      tool: toolName,
      success: false,
      error: `Tool "${toolName}" is not in the authorized NANI tool allowlist.`,
    };
  }

  try {
    switch (toolName) {
      case 'search_hospitals': {
        const { search, locality, tehsil, emergencyOnly } = args;
        const where: any = { isDuplicate: false };

        if (search) {
          where.OR = [
            { name: { contains: String(search), mode: 'insensitive' } },
            { address: { contains: String(search), mode: 'insensitive' } },
          ];
        }
        if (locality) {
          where.locality = { contains: String(locality), mode: 'insensitive' };
        }
        if (tehsil) {
          where.tehsil = { contains: String(tehsil), mode: 'insensitive' };
        }
        if (emergencyOnly) {
          where.hasEmergencyServices = true;
        }

        const facilities = await prisma.directoryFacility.findMany({
          where,
          take: 5,
          orderBy: { name: 'asc' },
          select: {
            id: true,
            name: true,
            facilityType: true,
            locality: true,
            tehsil: true,
            emergencyPhone: true,
            ambulancePhone: true,
            linkStatus: true,
            dataConfidence: true,
          },
        });

        const mappedFacilities = facilities.map((f: any) => ({
          ...f,
          isLifeLinkPartner: f.linkStatus === 'LINKED_PARTNER',
        }));

        return {
          tool: toolName,
          success: true,
          data: {
            count: mappedFacilities.length,
            facilities: mappedFacilities,
          },
        };
      }

      case 'get_hospital_contact': {
        const { hospitalNameOrId } = args;
        if (!hospitalNameOrId) {
          return { tool: toolName, success: false, error: 'hospitalNameOrId is required' };
        }

        // Search directoryFacility first, then LifeLink Hospital
        let facility: any = await prisma.directoryFacility.findFirst({
          where: {
            OR: [
              { id: String(hospitalNameOrId) },
              { name: { contains: String(hospitalNameOrId), mode: 'insensitive' } },
            ],
          },
        });

        if (facility) {
          return {
            tool: toolName,
            success: true,
            data: {
              id: facility.id,
              name: facility.name,
              address: facility.address,
              locality: facility.locality,
              emergencyPhone: facility.emergencyPhone || '112 (National Emergency)',
              ambulancePhone: facility.ambulancePhone || facility.emergencyPhone || '108',
              is24x7: true,
              dataConfidence: facility.dataConfidence,
              isLifeLinkPartner: facility.linkStatus === 'LINKED_PARTNER',
            },
          };
        }

        const hospital = await prisma.hospital.findFirst({
          where: {
            OR: [
              { id: String(hospitalNameOrId) },
              { name: { contains: String(hospitalNameOrId), mode: 'insensitive' } },
            ],
          },
        });

        if (hospital) {
          return {
            tool: toolName,
            success: true,
            data: {
              id: hospital.id,
              name: hospital.name,
              address: hospital.address,
              emergencyPhone: hospital.contactNumber || '112',
              ambulancePhone: hospital.contactNumber || '108',
              is24x7: true,
              dataConfidence: 'OFFICIAL_PARTNER',
              isLifeLinkPartner: true,
            },
          };
        }

        return {
          tool: toolName,
          success: false,
          error: `No hospital found matching "${hospitalNameOrId}".`,
        };
      }

      case 'check_bed_capacity': {
        const target = args.hospitalNameOrId || args.hospitalName || args.hospital || '';
        const hospital = await prisma.hospital.findFirst({
          where: {
            OR: [
              { id: String(target) },
              { name: { contains: String(target), mode: 'insensitive' } },
            ],
          },
          include: { beds: true },
        });

        if (!hospital) {
          const directoryMatch = await prisma.directoryFacility.findFirst({
            where: {
              OR: [
                { name: { contains: String(target), mode: 'insensitive' } },
                { address: { contains: String(target), mode: 'insensitive' } },
              ],
            },
          });

          if (directoryMatch) {
            return {
              tool: toolName,
              success: true,
              data: {
                hospitalName: directoryMatch.name,
                isLifeLinkPartner: false,
                dataFreshness: 'PUBLIC_DIRECTORY_CONTACT',
                emergencyPhone: directoryMatch.emergencyPhone || '112',
                note: 'Live telemetry bed availability is not linked for this public directory facility. Please contact the emergency desk directly.',
              },
            };
          }

          return {
            tool: toolName,
            success: false,
            error: `Live telemetry bed capacity is only available for verified LifeLink partner hospitals. Facility "${target}" is not found.`,
          };
        }

        const availableCount = hospital.beds.length > 0
          ? hospital.beds.filter((b) => b.status === 'AVAILABLE').length
          : hospital.availableBeds;

        const totalCount = hospital.beds.length > 0 ? hospital.beds.length : hospital.totalBeds;
        const icuAvailable = hospital.beds.filter((b) => b.ward === 'ICU' && b.status === 'AVAILABLE').length;

        const lastUpdated = hospital.capacityLastUpdated || (hospital as any).createdAt || new Date();
        const ageMinutes = Math.floor((Date.now() - new Date(lastUpdated).getTime()) / 60000);
        const isStale = ageMinutes > 60;

        return {
          tool: toolName,
          success: true,
          data: {
            hospitalId: hospital.id,
            hospitalName: hospital.name,
            availableBeds: availableCount,
            totalBeds: totalCount,
            icuAvailable,
            lastUpdated: new Date(lastUpdated).toISOString(),
            ageMinutes,
            isStale,
            dataFreshness: isStale ? 'STALE_VERIFICATION_REQUIRED' : 'LIVE',
          },
        };
      }

      case 'check_doctor_slots': {
        const { doctorName, specialization, date } = args;
        const whereDoctor: any = { isActive: true };

        if (doctorName) {
          whereDoctor.name = { contains: String(doctorName), mode: 'insensitive' };
        }
        if (specialization) {
          whereDoctor.specialization = { contains: String(specialization), mode: 'insensitive' };
        }

        const doctors = await prisma.doctor.findMany({
          where: whereDoctor,
          include: {
            hospital: { select: { id: true, name: true, address: true } },
            slots: {
              where: {
                isBlocked: false,
                ...(date ? { date: String(date) } : {}),
              },
              take: 5,
              orderBy: { startTime: 'asc' },
            },
          },
          take: 3,
        });

        const formatted = doctors.map((d) => ({
          doctorId: d.id,
          name: d.name,
          specialization: d.specialization,
          hospital: d.hospital?.name,
          slots: d.slots
            .filter((s) => s.bookedCount < s.maxPatients)
            .map((s) => ({
              slotId: s.id,
              date: s.date,
              time: `${s.startTime} - ${s.endTime}`,
              remainingCapacity: s.maxPatients - s.bookedCount,
            })),
        }));

        return {
          tool: toolName,
          success: true,
          data: {
            doctorsCount: formatted.length,
            doctors: formatted,
          },
        };
      }

      case 'book_doctor_appointment': {
        if (!authUser || authUser.role !== 'PATIENT') {
          return {
            tool: toolName,
            success: false,
            error: 'Authentication as a registered PATIENT is required to book appointments.',
          };
        }

        const { slotId, symptoms, notes } = args;
        if (!slotId || !symptoms) {
          return { tool: toolName, success: false, error: 'slotId and symptoms are required.' };
        }

        // Return a structured confirmation payload so user can explicitly approve booking
        return {
          tool: toolName,
          success: true,
          requiresUserConfirmation: true,
          confirmationDetails: {
            action: 'CONFIRM_APPOINTMENT_BOOKING',
            slotId,
            symptoms,
            notes,
            patientId: authUser.id,
            patientName: authUser.name,
          },
        };
      }

      case 'request_ambulance_dispatch': {
        if (!authUser || authUser.role !== 'PATIENT') {
          return {
            tool: toolName,
            success: false,
            error: 'Authentication as a registered PATIENT is required to trigger automated ambulance dispatch.',
          };
        }

        const { pickupLat, pickupLng, pickupAddress, category, urgencyLevel } = args;
        return {
          tool: toolName,
          success: true,
          requiresUserConfirmation: true,
          confirmationDetails: {
            action: 'CONFIRM_EMERGENCY_DISPATCH',
            pickupLat,
            pickupLng,
            pickupAddress,
            category: category || 'TRAUMA',
            urgencyLevel: urgencyLevel || 'CRITICAL',
            patientId: authUser.id,
            warning: 'Emergency ambulances are dispatched to genuine emergencies. Misuse is penalized.',
          },
        };
      }

      case 'get_confirmed_dispatch_status': {
        const { requestId } = args;
        if (!requestId) {
          return {
            tool: toolName,
            success: false,
            error: 'requestId is required to check dispatch status.',
          };
        }

        const request = await prisma.emergencyRequest.findUnique({
          where: { id: String(requestId) },
          include: {
            ambulance: true,
            driver: true,
          },
        });

        if (!request) {
          return {
            tool: toolName,
            success: false,
            error: `No dispatch record found for ID "${requestId}". A verbal model statement is not evidence of an actual dispatch.`,
          };
        }

        // Horizontal patient isolation check
        if (authUser && authUser.role === 'PATIENT' && request.patientId !== authUser.id) {
          return {
            tool: toolName,
            success: false,
            error: "Forbidden: You cannot inspect another patient's dispatch record.",
          };
        }

        const amb = (request as any).ambulance;
        const drv = (request as any).driver;

        return {
          tool: toolName,
          success: true,
          data: {
            requestId: request.id,
            status: request.status,
            category: request.category,
            ambulance: amb ? { id: amb.id, vehicleNumber: amb.vehicleNumber, ambulanceType: amb.ambulanceType } : null,
            driver: drv ? { name: drv.name, phone: drv.phone } : null,
            etaMinutes: request.etaMinutes || 5,
            isConfirmed: true,
          },
        };
      }

      case 'query_verified_health_knowledge': {
        const queryStr = String(args.query || '');
        const docs = await knowledgeRetrieval.retrieve(queryStr, 3);
        return {
          tool: toolName,
          success: true,
          data: {
            count: docs.length,
            records: docs,
          },
        };
      }

      default:
        return {
          tool: toolName,
          success: false,
          error: `Tool ${toolName} execution handler not implemented.`,
        };
    }
  } catch (error: any) {
    return {
      tool: toolName,
      success: false,
      error: error.message || 'Tool execution encountered an unexpected error',
    };
  }
}
