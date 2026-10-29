import { Server, Socket } from 'socket.io';
import { RequestStatus, TripType, AmbulanceType, Role } from '@prisma/client';
import * as jwt from 'jsonwebtoken';
import prisma from './db';
import { sendEmergencyAlertToContacts } from './utils/smsService';
import { normalizeRole } from './middleware/auth';
import { metrics } from './utils/metrics';
import { logger } from './utils/logger';
import { verifySupabaseToken, isSupabaseServerConfigured } from './utils/supabaseClient';

// Haversine formula to compute distance in km
function getDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function deg2rad(deg: number): number {
  return deg * (Math.PI / 180);
}

// Maps driver userId to socket ID
const driverSockets = new Map<string, string>();
// Maps patient userId to socket ID
const patientSockets = new Map<string, string>();
// Maps hospital admin userId to socket ID
const hospitalSockets = new Map<string, string>();
// Telemetry sockets list
const telemetrySockets = new Set<string>();

interface DispatchQueue {
  requestId: string;
  candidates: string[];
  currentIndex: number;
  payload: any;
}
const dispatchQueues = new Map<string, DispatchQueue>();

let ioInstance: Server | null = null;

export function getIO(): Server | null {
  return ioInstance;
}

export function broadcastToHospital(hospitalIdOrAdminId: string, event: string, data: any) {
  if (!ioInstance) return;
  const socketId = hospitalSockets.get(hospitalIdOrAdminId);
  if (socketId) {
    ioInstance.to(socketId).emit(event, data);
  }
  ioInstance.to(`hospital:${hospitalIdOrAdminId}`).emit(event, data);
  ioInstance.to('hospital_room').emit(event, data);
}

export function broadcastToOperator(operatorId: string, event: string, data: any) {
  if (!ioInstance) return;
  ioInstance.to(`operator:${operatorId}`).emit(event, data);
}

export function broadcastToDriver(driverId: string, event: string, data: any) {
  if (!ioInstance) return;
  const socketId = driverSockets.get(driverId);
  if (socketId) {
    ioInstance.to(socketId).emit(event, data);
  }
  ioInstance.to(`driver:${driverId}`).emit(event, data);
}

export function broadcastToPatient(patientId: string, event: string, data: any) {
  if (!ioInstance) return;
  const socketId = patientSockets.get(patientId);
  if (socketId) {
    ioInstance.to(socketId).emit(event, data);
  }
  ioInstance.to(`patient:${patientId}`).emit(event, data);
}

export function broadcastToDoctor(doctorId: string, event: string, data: any) {
  if (!ioInstance) return;
  ioInstance.to(`doctor:${doctorId}`).emit(event, data);
}

export function broadcastToUser(userId: string, event: string, data: any) {
  if (!ioInstance) return;
  ioInstance.to(`user:${userId}`).emit(event, data);
}

export function broadcastToSuperAdmin(event: string, data: any) {
  if (!ioInstance) return;
  ioInstance.to('super_admin_room').to('telemetry_room').emit(event, data);
}

export function broadcastToCity(city: string, event: string, data: any) {
  if (!ioInstance || !city) return;
  const normalizedCity = city.trim().toLowerCase();
  ioInstance.to(`city:${normalizedCity}`).emit(event, data);
}

export function broadcastToServiceArea(serviceAreaId: string, event: string, data: any) {
  if (!ioInstance || !serviceAreaId) return;
  ioInstance.to(`service_area:${serviceAreaId}`).emit(event, data);
}

export function setupSocketHandlers(io: Server) {
  ioInstance = io;

  // Socket.IO Authentication Middleware (Supporting both Supabase Auth tokens and local JWTs)
  io.use(async (socket: Socket, next: (err?: Error) => void) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        (socket.handshake.headers?.authorization?.startsWith('Bearer ')
          ? socket.handshake.headers.authorization.split(' ')[1]
          : null);

      if (token) {
        // 1. Check Supabase Auth Token first
        if (isSupabaseServerConfigured()) {
          try {
            const { user: supabaseUser } = await verifySupabaseToken(token);
            if (supabaseUser && (supabaseUser.id || supabaseUser.email)) {
              let user = await prisma.user.findUnique({
                where: { supabaseId: supabaseUser.id },
              });
              if (!user && supabaseUser.email) {
                user = await prisma.user.findUnique({
                  where: { email: supabaseUser.email.toLowerCase().trim() },
                });
                if (user && !user.supabaseId) {
                  try {
                    user = await prisma.user.update({
                      where: { id: user.id },
                      data: { supabaseId: supabaseUser.id },
                    });
                  } catch {
                    // Ignore concurrency update race
                  }
                }
              }
              if (user && user.isActive && !user.isSuspended) {
                (socket as any).user = {
                  id: user.id,
                  role: normalizeRole(user.role),
                  name: user.name,
                  email: user.email,
                };
              }
            }
          } catch {
            // Supabase token verification fallback
          }
        }

        // 2. Fall back to local JWT verification
        if (!(socket as any).user) {
          const JWT_SECRET =
            process.env.JWT_SECRET ||
            (process.env.NODE_ENV === 'production' ? '' : 'lifelink_jwt_secret_key_2026_super_secure');

          if (JWT_SECRET) {
            try {
              const decoded = jwt.verify(token, JWT_SECRET) as any;
              if (decoded && decoded.id) {
                const user = await prisma.user.findUnique({ where: { id: decoded.id } });
                if (user && user.isActive && !user.isSuspended) {
                  (socket as any).user = {
                    id: user.id,
                    role: normalizeRole(user.role),
                    name: user.name,
                    email: user.email,
                  };
                }
              }
            } catch {
              // Ignore invalid local JWT token
            }
          }
        }
      }
      next();
    } catch (err) {
      // Allow unauthenticated connection for fallback/demo, but socket.user remains null
      next();
    }
  });

  io.on('connection', async (socket: Socket) => {
    metrics.recordSocketConnect();
    const authUser = (socket as any).user;
    console.log(`Socket connected: ${socket.id} (Authenticated User: ${authUser ? authUser.id + ' / ' + authUser.role : 'Guest/Unauthenticated'})`);

    // Automatic secure room assignment based on verified token identity
    if (authUser) {
      socket.join(`user:${authUser.id}`);

      if (authUser.role === Role.PATIENT) {
        patientSockets.set(authUser.id, socket.id);
        socket.join(`patient:${authUser.id}`);
      } else if (authUser.role === Role.DRIVER) {
        driverSockets.set(authUser.id, socket.id);
        socket.join(`driver:${authUser.id}`);
      } else if (authUser.role === Role.ADMIN_HOSPITAL) {
        hospitalSockets.set(authUser.id, socket.id);
        socket.join('hospital_room');
        prisma.hospital.findUnique({ where: { adminUserId: authUser.id } }).then((hospital) => {
          if (hospital) {
            socket.join(`hospital:${hospital.id}`);
            if (hospital.city) socket.join(`city:${hospital.city.trim().toLowerCase()}`);
          }
        }).catch(() => {});
      } else if (authUser.role === Role.OPERATOR_ADMIN) {
        prisma.ambulanceOperator.findUnique({ where: { adminUserId: authUser.id } }).then((operator) => {
          if (operator) {
            socket.join(`operator:${operator.id}`);
            if (operator.city) socket.join(`city:${operator.city.trim().toLowerCase()}`);
          }
        }).catch(() => {});
      } else if (authUser.role === Role.SUPER_ADMIN) {
        telemetrySockets.add(socket.id);
        socket.join('super_admin_room');
        socket.join('telemetry_room');
      }

      // Allow authenticated or telemetry sockets to join city-specific event streams
      socket.on('join:city', (data: { city?: string }) => {
        if (data?.city) {
          socket.join(`city:${data.city.trim().toLowerCase()}`);
        }
      });

      socket.on('leave:city', (data: { city?: string }) => {
        if (data?.city) {
          socket.leave(`city:${data.city.trim().toLowerCase()}`);
        }
      });

      // Synchronize unread notification count on connection
      try {
        if (prisma.notification) {
          prisma.notification.count({
            where: { recipientId: authUser.id, isRead: false },
          }).then((unreadCount: number) => {
            socket.emit('notifications:unread_count', { unreadCount });
          }).catch(() => {});
        }
      } catch (err) {
        // Ignore
      }
    }

    // Register Patient (Strict authentication & ownership check)
    socket.on('patient:register', (patientId: string) => {
      if (!authUser || (authUser.id !== patientId && authUser.role !== Role.SUPER_ADMIN)) {
        socket.emit('error:unauthorized', { message: 'Unauthorized: Cannot subscribe to another patient emergency stream' });
        return;
      }
      patientSockets.set(patientId, socket.id);
      socket.join(`patient:${patientId}`);
      console.log(`Registered Patient: ${patientId} on socket ${socket.id}`);
    });

    // Register Driver (Strict authentication & ownership check)
    socket.on('driver:register', (driverId: string) => {
      if (!authUser || (authUser.id !== driverId && authUser.role !== Role.SUPER_ADMIN)) {
        socket.emit('error:unauthorized', { message: 'Unauthorized: Cannot register for another driver dispatch stream' });
        return;
      }
      driverSockets.set(driverId, socket.id);
      socket.join(`driver:${driverId}`);
      console.log(`Registered Driver: ${driverId} on socket ${socket.id}`);
    });

    // Register Hospital Admin (Strict authentication & facility scope check)
    socket.on('hospital:register', async (adminUserId: string) => {
      if (!authUser) {
        socket.emit('error:unauthorized', { message: 'Unauthorized: Authentication required' });
        return;
      }
      if (authUser.role !== Role.ADMIN_HOSPITAL && authUser.role !== Role.SUPER_ADMIN) {
        socket.emit('error:unauthorized', { message: 'Forbidden: Hospital admin role required' });
        return;
      }
      if (authUser.role === Role.ADMIN_HOSPITAL && authUser.id !== adminUserId) {
        socket.emit('error:unauthorized', { message: 'Forbidden: Cannot access another hospital facility stream' });
        return;
      }
      hospitalSockets.set(adminUserId, socket.id);
      socket.join('hospital_room');
      const hospital = await prisma.hospital.findUnique({ where: { adminUserId } });
      if (hospital) {
        socket.join(`hospital:${hospital.id}`);
      }
      console.log(`Registered Hospital Admin: ${adminUserId} on socket ${socket.id}`);
    });

    // Register Operator Admin (Strict authentication & operator fleet scope check)
    socket.on('operator:register', async (adminUserId: string) => {
      if (!authUser) {
        socket.emit('error:unauthorized', { message: 'Unauthorized: Authentication required' });
        return;
      }
      if (authUser.role !== Role.OPERATOR_ADMIN && authUser.role !== Role.SUPER_ADMIN) {
        socket.emit('error:unauthorized', { message: 'Forbidden: Operator admin role required' });
        return;
      }
      if (authUser.role === Role.OPERATOR_ADMIN && authUser.id !== adminUserId) {
        socket.emit('error:unauthorized', { message: 'Forbidden: Cannot access another private operator stream' });
        return;
      }
      const operator = await prisma.ambulanceOperator.findUnique({ where: { adminUserId } });
      if (operator) {
        socket.join(`operator:${operator.id}`);
      }
      console.log(`Registered Operator Admin: ${adminUserId} on socket ${socket.id}`);
    });

    // Register Doctor (Strict authorization check)
    socket.on('doctor:register', async (doctorId: string) => {
      if (!authUser) {
        socket.emit('error:unauthorized', { message: 'Unauthorized: Authentication required' });
        return;
      }
      let isAuthorized = authUser.role === Role.SUPER_ADMIN;
      if (!isAuthorized) {
        const doctor = await prisma.doctor.findUnique({ where: { id: doctorId } });
        if (doctor) {
          if (doctor.hospitalId) {
            const hospital = await prisma.hospital.findUnique({ where: { id: doctor.hospitalId } });
            if (hospital && hospital.adminUserId === authUser.id) {
              isAuthorized = true;
            }
          }
          if (authUser.id === doctorId || (authUser.name && doctor.name && authUser.name.toLowerCase() === doctor.name.toLowerCase())) {
            isAuthorized = true;
          }
        }
      }
      if (!isAuthorized) {
        socket.emit('error:unauthorized', { message: 'Forbidden: You are not authorized to subscribe to this doctor stream' });
        return;
      }
      socket.join(`doctor:${doctorId}`);
      console.log(`Registered Doctor room: ${doctorId} on socket ${socket.id}`);
    });

    // Register Super Admin Telemetry (Strictly requires SUPER_ADMIN)
    socket.on('telemetry:register', () => {
      if (!authUser || authUser.role !== Role.SUPER_ADMIN) {
        socket.emit('error:unauthorized', { message: 'Forbidden: Super Admin privileges required to access telemetry stream' });
        return;
      }
      telemetrySockets.add(socket.id);
      socket.join('telemetry_room');
      socket.join('super_admin_room');
      console.log(`Registered Telemetry listener: ${socket.id}`);
    });

    socket.on('superadmin:register', () => {
      if (!authUser || authUser.role !== Role.SUPER_ADMIN) {
        socket.emit('error:unauthorized', { message: 'Forbidden: Super Admin privileges required to access super admin room' });
        return;
      }
      telemetrySockets.add(socket.id);
      socket.join('super_admin_room');
      socket.join('telemetry_room');
      console.log(`Registered Super Admin room listener: ${socket.id}`);
    });

    // Notification Reconnection Recovery (Sync missed unread notifications)
    socket.on('notifications:sync', async () => {
      if (!authUser) {
        socket.emit('error:unauthorized', { message: 'Unauthorized: Authentication required' });
        return;
      }
      try {
        const unread = await prisma.notification.findMany({
          where: { recipientId: authUser.id, isRead: false },
          orderBy: { createdAt: 'desc' },
          take: 50,
        });
        const unreadCount = await prisma.notification.count({
          where: { recipientId: authUser.id, isRead: false },
        });
        socket.emit('notifications:synced', { notifications: unread, unreadCount });
      } catch (err: any) {
        socket.emit('notifications:error', { message: err?.message || 'Failed to sync notifications' });
      }
    });

    // Subscribe to Emergency Trip Share Stream (Protected by unguessable token)
    socket.on('trip_share:subscribe', async (token: string) => {
      if (!token || typeof token !== 'string') return;
      try {
        const share = await prisma.emergencyTripShare.findUnique({
          where: { shareToken: token },
        });
        if (!share || share.status === 'REVOKED' || share.revokedAt) {
          socket.emit('trip_share:error', { code: 'SHARE_REVOKED_OR_INVALID', message: 'Trip share is revoked or invalid' });
          return;
        }
        if (new Date(share.expiresAt).getTime() <= Date.now()) {
          socket.emit('trip_share:error', { code: 'SHARE_EXPIRED', message: 'Trip share session has expired' });
          return;
        }
        socket.join(`trip_share:${share.shareToken}`);
        socket.emit('trip_share:subscribed', { shareToken: share.shareToken, status: share.status });
      } catch {
        socket.emit('trip_share:error', { code: 'SERVER_ERROR', message: 'Failed to subscribe to trip share' });
      }
    });

    // Mark Notification Read via Socket
    socket.on('notifications:mark_read', async (data: { notificationId?: string; markAll?: boolean }) => {
      if (!authUser) {
        socket.emit('error:unauthorized', { message: 'Unauthorized: Authentication required' });
        return;
      }
      try {
        if (data && data.markAll) {
          await prisma.notification.updateMany({
            where: { recipientId: authUser.id, isRead: false },
            data: { isRead: true },
          });
        } else if (data && data.notificationId) {
          const existing = await prisma.notification.findUnique({ where: { id: data.notificationId } });
          if (existing && existing.recipientId === authUser.id) {
            await prisma.notification.update({
              where: { id: data.notificationId },
              data: { isRead: true },
            });
          }
        }
        const unreadCount = await prisma.notification.count({
          where: { recipientId: authUser.id, isRead: false },
        });
        socket.emit('notifications:unread_count', { unreadCount });
      } catch (err) {
        // Fail silently
      }
    });

    // Handle SOS and standard dispatches
    socket.on('sos:trigger', async (data: {
      patientId: string;
      lat: number;
      lng: number;
      tripType: 'SOS' | 'STANDARD';
      ambulanceType?: string;
      hospitalId?: string;
      isDemo?: boolean;
      isSimulated?: boolean;
    }) => {
      const { patientId, lat, lng, tripType, ambulanceType, hospitalId } = data;
      console.log(`SOS/Standard Triggered by ${patientId} at (${lat}, ${lng})`);

      try {
        if (authUser && authUser.id !== patientId && authUser.role !== Role.SUPER_ADMIN) {
          socket.emit('sos:error', { message: 'Unauthorized: Cannot trigger emergency for another patient' });
          return;
        }

        // Fetch patient details and medical profile
        const patient = await prisma.user.findUnique({
          where: { id: patientId },
          include: { patientProfile: true, emergencyContacts: true },
        });

        if (!patient) {
          socket.emit('sos:error', { message: 'Patient account not found' });
          return;
        }

        // 1. Validate real coordinates and service area
        if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
          socket.emit('sos:error', { message: 'Invalid GPS coordinates provided' });
          return;
        }

        // Check for existing active emergency request (Idempotency & Double-tap protection)
        const existingActive = await prisma.emergencyRequest.findFirst({
          where: {
            patientId,
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
          include: {
            patient: {
              include: { patientProfile: true },
            },
            hospital: true,
          },
        });

        if (existingActive) {
          console.log(`[Idempotent SOS] Patient ${patientId} already has active request ${existingActive.id}. Re-emitting state.`);
          socket.emit('sos:initiated', {
            request: existingActive,
            hospital: existingActive.hospital,
            isIdempotentReplay: true,
          });
          return;
        }

        // 2. Find target hospital without artificial location mutation
        let targetHospital = null;
        let minHospitalDist = 0;

        if (data.hospitalId) {
          targetHospital = await prisma.hospital.findUnique({
            where: { id: data.hospitalId },
          });
          if (targetHospital) {
            minHospitalDist = getDistance(lat, lng, targetHospital.lat, targetHospital.lng);
          }
        }

        if (!targetHospital) {
          const allHospitals = await prisma.hospital.findMany();
          if (allHospitals.length > 0) {
            let closestHospital = allHospitals[0];
            minHospitalDist = getDistance(lat, lng, closestHospital.lat, closestHospital.lng);

            for (let i = 1; i < allHospitals.length; i++) {
              const dist = getDistance(lat, lng, allHospitals[i].lat, allHospitals[i].lng);
              if (dist < minHospitalDist) {
                minHospitalDist = dist;
                closestHospital = allHospitals[i];
              }
            }
            targetHospital = closestHospital;
          }
        }

        // Haversine straight-line distance estimate (clearly identified, never fabricated road ETA)
        const etaMinutes = minHospitalDist > 0 ? Math.max(3, Math.round(minHospitalDist * 2.0 + 2)) : 5;

        // 3. Create the EmergencyRequest in database
        const emergencyRequest = await prisma.emergencyRequest.create({
          data: {
            patientId,
            hospitalId: targetHospital?.id || null,
            pickupLat: lat,
            pickupLng: lng,
            status: RequestStatus.PENDING,
            tripType: tripType as TripType,
            etaMinutes,
          },
          include: {
            patient: {
              include: {
                patientProfile: true,
              },
            },
            hospital: true,
          },
        });

        // 4. Send response to patient
        socket.emit('sos:initiated', {
          request: emergencyRequest,
          hospital: targetHospital,
        });

        // 4b. Dispatch Emergency SMS alert to patient's emergency contacts
        if (patient.emergencyContacts && patient.emergencyContacts.length > 0) {
          sendEmergencyAlertToContacts(
            patient.emergencyContacts.map((c) => ({ name: c.name, phone: c.phone })),
            patient.name,
            patient.patientProfile?.customAlertMessage,
            { lat, lng }
          ).catch((err) => console.error('[SMS SOS Dispatch Error]', err));
        }

        // 5. Send dispatch to the closest available candidate first (Sequential Dispatch)
        const payloadForDrivers = {
          requestId: emergencyRequest.id,
          pickupLat: lat,
          pickupLng: lng,
          tripType: emergencyRequest.tripType,
          patientName: patient.name,
          patientPhone: patient.phone,
          bloodGroup: patient.patientProfile?.bloodGroup || 'Unknown',
          medicalNotes: patient.patientProfile?.medicalNotes || 'None',
          allergies: patient.patientProfile?.allergies || 'None',
          hospitalName: targetHospital?.name || 'Local Emergency Center',
          distanceKm: parseFloat(minHospitalDist.toFixed(2)),
        };

        // Query available ambulances without artificial coordinate mutations
        const allAvailableAmbulances = await prisma.ambulance.findMany({
          where: { isAvailable: true },
          include: { driver: true },
        });

        // Sort available nearby drivers by distance
        const sortedNearbyDrivers = allAvailableAmbulances
          .filter((amb: any) => !ambulanceType || amb.ambulanceType === ambulanceType)
          .map((amb: any) => {
            const dist = getDistance(lat, lng, amb.currentLat, amb.currentLng);
            return { amb, dist };
          })
          .sort((a: any, b: any) => a.dist - b.dist);

        const candidateDriverIds = sortedNearbyDrivers
          .map((item: any) => item.amb.driverId)
          .filter((id: any): id is string => !!id);

        if (candidateDriverIds.length > 0) {
          const firstDriverId = candidateDriverIds[0];
          const firstDriverSocketId = driverSockets.get(firstDriverId);
          
          dispatchQueues.set(emergencyRequest.id, {
            requestId: emergencyRequest.id,
            candidates: candidateDriverIds,
            currentIndex: 0,
            payload: payloadForDrivers
          });

          if (firstDriverSocketId) {
            console.log(`SOS Dispatching: Request ${emergencyRequest.id} sent to first candidate driver ${firstDriverId}`);
            io.to(firstDriverSocketId).emit('request:new', payloadForDrivers);
          }

          if (data.isDemo || (data as any).isSimulated) {
            // Safe Isolated Simulation Lifecycle for Demonstrations
            setTimeout(async () => {
              try {
                const currentReq = await prisma.emergencyRequest.findUnique({ where: { id: emergencyRequest.id } });
                if (currentReq && currentReq.status === RequestStatus.PENDING) {
                  const updated = await prisma.emergencyRequest.update({
                    where: { id: emergencyRequest.id },
                    data: {
                      status: RequestStatus.ACCEPTED,
                      driverId: firstDriverId,
                      ambulanceId: sortedNearbyDrivers[0]?.amb?.id || 'amb-gmch-als-1',
                      isDemo: true,
                    },
                    include: {
                      driver: { select: { id: true, name: true, phone: true } },
                      ambulance: true,
                      hospital: true,
                    },
                  });

                  const patientSocketId = patientSockets.get(patientId);
                  if (patientSocketId) {
                    io.to(patientSocketId).emit('request:accepted', {
                      request: updated,
                      lat: updated.ambulance?.currentLat || (lat + 0.005),
                      lng: updated.ambulance?.currentLng || (lng + 0.005),
                      isDemo: true,
                      disclaimer: 'SIMULATED DEMO: This is an isolated testing simulation.',
                    });
                  }
                }
              } catch (simErr) {
                console.error('Demo simulation error:', simErr);
              }
            }, 2500);
          }
        } else {
          console.log(`No available ambulance drivers within range for SOS request ${emergencyRequest.id}`);
          if (data.isDemo || (data as any).isSimulated) {
            // In demo mode with no drivers, assign the demo ambulance
            setTimeout(async () => {
              try {
                const updated = await prisma.emergencyRequest.update({
                  where: { id: emergencyRequest.id },
                  data: {
                    status: RequestStatus.ACCEPTED,
                    driverId: 'user-driver-anil-dev',
                    ambulanceId: 'amb-gmch-als-1',
                    isDemo: true,
                  },
                  include: {
                    driver: { select: { id: true, name: true, phone: true } },
                    ambulance: true,
                    hospital: true,
                  },
                });

                const patientSocketId = patientSockets.get(patientId);
                if (patientSocketId) {
                  io.to(patientSocketId).emit('request:accepted', {
                    request: updated,
                    lat: 21.1465,
                    lng: 79.0888,
                    isDemo: true,
                    disclaimer: 'SIMULATED DEMO: Demonstration ambulance dispatch activated.',
                  });
                }
              } catch (simErr) {
                console.error('Demo simulation error:', simErr);
              }
            }, 2500);
          } else {
            const patientSocketId = patientSockets.get(patientId);
            if (patientSocketId) {
              io.to(patientSocketId).emit('sos:no_ambulance', {
                requestId: emergencyRequest.id,
                message: 'No active LifeLink ambulances are currently available within dispatch range. Please dial 112 directly.',
                officialEmergencyNumber: '112',
              });
            }
          }
        }

        // 6. Broadcast to the assigned hospital ER board
        io.to('hospital_room').emit('hospital:new_emergency', {
          request: emergencyRequest,
          patientProfile: patient.patientProfile,
          patientName: patient.name,
          patientPhone: patient.phone,
        });

        // 7. Update Super Admin telemetry
        io.to('telemetry_room').emit('telemetry:update');

      } catch (err: any) {
        console.error('SOS triggering error:', err);
        socket.emit('sos:error', { message: 'Failed to initiate dispatch request' });
      }
    });

    // Driver Slide to Accept Emergency Request
    socket.on('request:accept', async (data: { requestId: string; driverId: string }) => {
      const { requestId, driverId } = data;
      console.log(`Driver ${driverId} attempting to accept request ${requestId}`);

      try {
        if (authUser && authUser.id !== driverId && authUser.role !== Role.SUPER_ADMIN) {
          socket.emit('request:accept_error', { message: 'Unauthorized: Driver identity mismatch' });
          return;
        }

        // Find request
        const request = await prisma.emergencyRequest.findUnique({
          where: { id: requestId },
        });

        if (!request) {
          socket.emit('request:accept_error', { message: 'Emergency request not found' });
          return;
        }

        // Check if request is still pending (locking mechanism)
        if (request.status !== RequestStatus.PENDING) {
          if (request.status === RequestStatus.ACCEPTED && request.driverId === driverId) {
            // Safe idempotent replay: this driver already claimed this request
            socket.emit('trip:status_success', { request, isIdempotentReplay: true });
            return;
          }
          socket.emit('request:accept_error', { message: 'This request has already been claimed by another driver.' });
          return;
        }

        // Check if driver has an active ambulance
        const ambulance = await prisma.ambulance.findUnique({
          where: { driverId },
          include: { driver: true },
        });

        if (!ambulance) {
          socket.emit('request:accept_error', { message: 'Ambulance vehicle details not configured.' });
          return;
        }

        // Transaction: Update request status and claim driver, and mark driver as unavailable
        const updatedRequest = await prisma.$transaction(async (tx) => {
          // Update request
          const req = await tx.emergencyRequest.update({
            where: { id: requestId },
            data: {
              status: RequestStatus.ACCEPTED,
              driverId: driverId,
            },
            include: {
              patient: {
                include: { patientProfile: true },
              },
              hospital: true,
            },
          });

          // Mark driver as unavailable (currently active on trip)
          await tx.ambulance.update({
            where: { driverId },
            data: { isAvailable: false },
          });

          return req;
        });

        // Broadcast to patient
        const patientSocketId = patientSockets.get(updatedRequest.patientId);
        if (patientSocketId) {
          io.to(patientSocketId).emit('request:accepted', {
            request: updatedRequest,
            driverName: ambulance?.driver?.name || 'Unknown',
            driverPhone: ambulance?.driver?.phone || '',
            vehicleNumber: ambulance?.vehicleNumber,
            ambulanceType: ambulance?.ambulanceType,
            lat: ambulance?.currentLat,
            lng: ambulance?.currentLng,
          });
        }

        // Broadcast dismiss event to other drivers
        io.emit('request:claimed', { requestId, claimerDriverId: driverId });

        // Broadcast update to Hospital ER board
        io.to('hospital_room').emit('hospital:emergency_claimed', {
          request: updatedRequest,
          driverName: ambulance?.driver?.name || 'Unknown',
          driverPhone: ambulance?.driver?.phone || '',
          vehicleNumber: ambulance?.vehicleNumber,
        });

        // Emit success back to the claiming driver
        socket.emit('request:accept_success', { request: updatedRequest });

        // Update Super Admin telemetry
        io.to('telemetry_room').emit('telemetry:update');

        // Delete matching queue from in-memory dispatch queues
        dispatchQueues.delete(requestId);

        // Start routing simulation on accept ONLY if request or vehicle is explicitly marked DEMO/SIMULATED
        if (updatedRequest.isDemo || ambulance.isDemo) {
          startRouteSimulation(io, requestId, driverId, ambulance.currentLat, ambulance.currentLng, updatedRequest.pickupLat, updatedRequest.pickupLng);
        }

      } catch (err: any) {
        console.error('Accepting request error:', err);
        socket.emit('request:accept_error', { message: 'Failed to process request acceptance.' });
      }
    });

    // Driver Slide to Decline/Reject Emergency Request (Pass to next driver)
    socket.on('request:reject', async (data: { requestId: string; driverId: string }) => {
      const { requestId, driverId } = data;
      console.log(`Driver ${driverId} rejected request ${requestId}`);

      const queue = dispatchQueues.get(requestId);
      if (queue) {
        if (queue.candidates[queue.currentIndex] === driverId) {
          queue.currentIndex++;
          if (queue.currentIndex < queue.candidates.length) {
            const nextDriverId = queue.candidates[queue.currentIndex];
            const nextDriverSocketId = driverSockets.get(nextDriverId);
            if (nextDriverSocketId) {
              console.log(`Request ${requestId} passed to next closest driver ${nextDriverId}`);
              io.to(nextDriverSocketId).emit('request:new', queue.payload);
            }
          } else {
            console.log(`All candidate drivers declined request ${requestId}`);
            // Update request status to REJECTED in database
            await prisma.emergencyRequest.update({
              where: { id: requestId },
              data: { status: RequestStatus.REJECTED }
            });

            // Notify patient of failure
            const request = await prisma.emergencyRequest.findUnique({
              where: { id: requestId }
            });
            if (request) {
              const patientSocketId = patientSockets.get(request.patientId);
              if (patientSocketId) {
                io.to(patientSocketId).emit('sos:error', {
                  message: 'All nearby emergency ambulances are currently engaged. Please hold, dispatch command is routing out-of-network responders.'
                });
              }
            }
            dispatchQueues.delete(requestId);
          }
        }
      }
    });

    // Driver Update Trip Status in Real-Time
    socket.on('trip:status_update', async (data: {
      requestId: string;
      driverId: string;
      status: 'ACCEPTED' | 'ARRIVING' | 'IN_TRANSIT' | 'AT_HOSPITAL' | 'COMPLETED' | 'REJECTED';
    }) => {
      const { requestId, driverId, status } = data;
      console.log(`Driver ${driverId} updating request ${requestId} to status ${status}`);

      try {
        const reqStatus = status as RequestStatus;

        // Fetch the request
        const request = await prisma.emergencyRequest.findUnique({
          where: { id: requestId },
        });

        if (!request) {
          socket.emit('trip:status_error', { message: 'Trip not found' });
          return;
        }

        const isCompleted = reqStatus === RequestStatus.COMPLETED;
        const isRejected = reqStatus === RequestStatus.REJECTED;

        const updatedRequest = await prisma.$transaction(async (tx) => {
          const req = await tx.emergencyRequest.update({
            where: { id: requestId },
            data: {
              status: reqStatus,
              completedAt: isCompleted ? new Date() : null,
            },
            include: {
              patient: true,
              hospital: true,
            },
          });

          // If completed or rejected, free up the driver ambulance
          if (isCompleted || isRejected) {
            await tx.ambulance.update({
              where: { driverId },
              data: { isAvailable: true },
            });
          }

          return req;
        });

        // Fetch driver vehicle details for status broadcasts
        const ambulance = await prisma.ambulance.findUnique({
          where: { driverId },
          include: { driver: true },
        });

        // Broadcast to patient
        const patientSocketId = patientSockets.get(updatedRequest.patientId);
        if (patientSocketId) {
          io.to(patientSocketId).emit('trip:status_changed', {
            request: updatedRequest,
            driverName: ambulance?.driver?.name || 'Unknown',
            vehicleNumber: ambulance?.vehicleNumber,
          });
        }

        // Broadcast to hospital ER board
        io.to('hospital_room').emit('hospital:emergency_status_changed', {
          request: updatedRequest,
          driverName: ambulance?.driver?.name || 'Unknown',
          vehicleNumber: ambulance?.vehicleNumber,
        });

        // Emit back to the driver
        socket.emit('trip:status_success', { request: updatedRequest });

        // Update Super Admin telemetry
        io.to('telemetry_room').emit('telemetry:update');

        // Start or stop routing simulation based on trip phase (demo requests only)
        if (reqStatus === RequestStatus.IN_TRANSIT && updatedRequest.hospital && (updatedRequest.isDemo || ambulance?.isDemo)) {
          startRouteSimulation(io, requestId, driverId, updatedRequest.pickupLat, updatedRequest.pickupLng, updatedRequest.hospital.lat, updatedRequest.hospital.lng);
        } else if (reqStatus === RequestStatus.COMPLETED || reqStatus === RequestStatus.REJECTED || reqStatus === RequestStatus.AT_HOSPITAL) {
          stopRouteSimulation(requestId);
        }

      } catch (err: any) {
        console.error('Updating trip status error:', err);
        socket.emit('trip:status_error', { message: 'Failed to update trip status.' });
      }
    });

    // Driver periodic location update
    socket.on('driver:location_update', async (data: {
      driverId: string;
      lat: number;
      lng: number;
      requestId?: string;
    }) => {
      const { driverId, lat, lng, requestId } = data;

      try {
        // 1. Update ambulance coordinates in database
        const ambulance = await prisma.ambulance.update({
          where: { driverId },
          data: {
            currentLat: lat,
            currentLng: lng,
            lastUpdated: new Date(),
          },
          include: { driver: true },
        });

        // 2. Broadcast coordinates to the active patient with timestamp for freshness evaluation
        const locationPayload = {
          driverId,
          lat,
          lng,
          vehicleNumber: ambulance.vehicleNumber,
          timestamp: new Date().toISOString(),
          speedKmH: (ambulance as any).speedKmH ?? 0,
        };

        if (requestId) {
          const request = await prisma.emergencyRequest.findUnique({
            where: { id: requestId },
          });

          if (request) {
            const patientSocketId = patientSockets.get(request.patientId);
            if (patientSocketId) {
              io.to(patientSocketId).emit('driver:location_changed', locationPayload);
            }
          }
        }

        // 3. Broadcast to hospital board if driving to ER
        io.to('hospital_room').emit('driver:location_changed', locationPayload);

        // 4. Update Telemetry room
        io.to('telemetry_room').emit('telemetry:driver_moved', {
          driverId,
          lat,
          lng,
          vehicleNumber: ambulance.vehicleNumber,
        });

      } catch (err) {
        // Fail silently on periodic GPS updates to avoid flooding logs
      }
    });

    // Cleanup on disconnect
    socket.on('disconnect', () => {
      metrics.recordSocketDisconnect();
      console.log(`Socket disconnected: ${socket.id}`);

      // Remove socket maps
      for (const [key, value] of driverSockets.entries()) {
        if (value === socket.id) driverSockets.delete(key);
      }
      for (const [key, value] of patientSockets.entries()) {
        if (value === socket.id) patientSockets.delete(key);
      }
      for (const [key, value] of hospitalSockets.entries()) {
        if (value === socket.id) hospitalSockets.delete(key);
      }
      telemetrySockets.delete(socket.id);
    });
  });
}

// -------------------------------------------------------------
// Real-Time Road Routing Simulator (OSRM Integration)
// -------------------------------------------------------------

interface ActiveSimulation {
  requestId: string;
  driverId: string;
  points: [number, number][];
  currentIndex: number;
  interval: NodeJS.Timeout;
}

const activeSimulations = new Map<string, ActiveSimulation>();

async function fetchDirectionsRoute(startLat: number, startLng: number, endLat: number, endLng: number): Promise<[number, number][]> {
  const mapboxToken = process.env.MAPBOX_ACCESS_TOKEN || process.env.MAPBOX_TOKEN || '';

  // 1. Try Mapbox Directions API v5 if token is present
  if (mapboxToken) {
    try {
      const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${startLng},${startLat};${endLng},${endLat}?geometries=geojson&overview=full&access_token=${mapboxToken}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = (await res.json()) as any;
        if (data.routes && data.routes.length > 0) {
          return data.routes[0].geometry.coordinates.map((c: [number, number]) => [c[1], c[0]]);
        }
      }
    } catch (error) {
      console.error('Error fetching route from Mapbox Directions API:', error);
    }
  }

  // 2. Fallback to OSRM OpenStreetMap routing
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${startLng},${startLat};${endLng},${endLat}?geometries=geojson&overview=full`;
    const res = await fetch(url);
    const data = (await res.json()) as any;
    if (data.routes && data.routes.length > 0) {
      return data.routes[0].geometry.coordinates.map((c: [number, number]) => [c[1], c[0]]);
    }
  } catch (error) {
    console.error('Error fetching route from OSRM:', error);
  }

  // Robust Fallback: straight-line geometry split into 15 steps
  const steps = 15;
  const points: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const lat = startLat + (endLat - startLat) * (i / steps);
    const lng = startLng + (endLng - startLng) * (i / steps);
    points.push([lat, lng]);
  }
  return points;
}

async function startRouteSimulation(
  io: Server,
  requestId: string,
  driverId: string,
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number
) {
  // Reset any active simulation on request or driver
  stopRouteSimulation(requestId);
  for (const [reqId, sim] of activeSimulations.entries()) {
    if (sim.driverId === driverId) {
      stopRouteSimulation(reqId);
    }
  }

  const points = await fetchDirectionsRoute(startLat, startLng, endLat, endLng);
  if (points.length === 0) return;

  console.log(`Starting backend turn-by-turn simulation for request ${requestId} (${points.length} nodes)`);

  let currentIndex = 0;
  const interval = setInterval(async () => {
    const sim = activeSimulations.get(requestId);
    if (!sim) {
      clearInterval(interval);
      return;
    }

    if (currentIndex >= points.length) {
      clearInterval(interval);
      activeSimulations.delete(requestId);
      console.log(`Simulation reached target end for request ${requestId}`);
      return;
    }

    const [currentLat, currentLng] = points[currentIndex];
    currentIndex++;

    try {
      // 1. Update coordinates in DB
      const ambulance = await prisma.ambulance.update({
        where: { driverId },
        data: {
          currentLat,
          currentLng,
          lastUpdated: new Date(),
        },
        include: { driver: true },
      });

      const simPayload = {
        driverId,
        lat: currentLat,
        lng: currentLng,
        vehicleNumber: ambulance.vehicleNumber,
        isSimulated: true,
        isDemo: true,
        notice: 'DEMO SIMULATION ONLY - NOT A REAL GPS MOVEMENT',
      };

      // 2. Broadcast coordinates to patient
      const request = await prisma.emergencyRequest.findUnique({
        where: { id: requestId },
      });

      if (request) {
        const patientSocketId = patientSockets.get(request.patientId);
        if (patientSocketId) {
          io.to(patientSocketId).emit('driver:location_changed', simPayload);
        }
      }

      // 3. Broadcast to hospital board
      io.to('hospital_room').emit('driver:location_changed', simPayload);

      // 4. Update Telemetry room
      io.to('telemetry_room').emit('telemetry:driver_moved', simPayload);

      // 5. Broadcast to driver socket to synchronize driver dashboard view
      const driverSocketId = driverSockets.get(driverId);
      if (driverSocketId) {
        io.to(driverSocketId).emit('driver:coordinates_simulated', simPayload);
      }

    } catch (err) {
      // Fail silently
    }
  }, 3500); // Step every 3.5 seconds
  interval.unref();

  activeSimulations.set(requestId, {
    requestId,
    driverId,
    points,
    currentIndex,
    interval,
  });
}

function stopRouteSimulation(requestId: string) {
  const sim = activeSimulations.get(requestId);
  if (sim) {
    clearInterval(sim.interval);
    activeSimulations.delete(requestId);
    console.log(`Stopped simulation for request ${requestId}`);
  }
}
