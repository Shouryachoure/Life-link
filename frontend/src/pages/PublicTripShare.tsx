import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import {
  ShieldAlert,
  MapPin,
  Clock,
  PhoneCall,
  CheckCircle2,
  AlertTriangle,
  Building2,
  Car,
  Wifi,
  WifiOff,
  Compass,
  ArrowRight,
  ShieldCheck,
  RefreshCw,
  ExternalLink,
  Info
} from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import LeafletMap from '../components/LeafletMap';
import { getBackendBaseUrl, getSocketUrl } from '../config/apiConfig';

interface MilestoneItem {
  milestone: string;
  label: string;
  timestamp: string | null;
  completed: boolean;
}

interface DestinationHospital {
  name: string;
  address: string;
  phone?: string | null;
  confirmed: boolean;
}

interface LiveLocationData {
  lat: number;
  lng: number;
  movementStatus: string;
  speedKmH: number;
  lastUpdated: string;
  locationAgeSeconds: number;
  isStale: boolean;
  stalenessWarning?: string | null;
}

interface TripShareData {
  status: string;
  tripStatus: string;
  isLiveTrackingActive: boolean;
  patientMaskedName: string;
  milestones: MilestoneItem[];
  currentMilestone: string;
  destinationHospital: DestinationHospital | null;
  destinationNotice?: string | null;
  liveLocation: LiveLocationData | null;
  vehicle: {
    vehicleNumber: string;
    ambulanceType?: string;
  } | null;
  pickup: {
    lat: number;
    lng: number;
    address: string;
  };
  shareMetadata: {
    expiresAt: string;
    recipientName?: string;
    createdAt: string;
  };
}

export const PublicTripShare: React.FC = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [tripData, setTripData] = useState<TripShareData | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  const [socketConnected, setSocketConnected] = useState(false);

  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!token) {
      setError('Trip tracking link is invalid or missing access token.');
      setErrorCode('MISSING_TOKEN');
      setLoading(false);
      return;
    }

    fetchTripStatus();

    // Initialize Socket.io connection for real-time live location and milestone streaming
    const socketUrl = getSocketUrl();
    const socket = io(socketUrl, {
      transports: ['websocket', 'polling'],
      withCredentials: true,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setSocketConnected(true);
      // Subscribe to this specific unguessable trip share room
      socket.emit('trip_share:subscribe', token);
    });

    socket.on('disconnect', () => {
      setSocketConnected(false);
    });

    socket.on('trip_share:subscribed', () => {
      console.log('[TripShare] Successfully subscribed to live trip stream');
    });

    socket.on('trip_share:location_updated', (loc: any) => {
      setTripData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          liveLocation: {
            lat: loc.lat,
            lng: loc.lng,
            movementStatus: loc.movementStatus || 'MOVING',
            speedKmH: loc.speedKmH || 0,
            lastUpdated: loc.timestamp || new Date().toISOString(),
            locationAgeSeconds: 0,
            isStale: false,
          },
        };
      });
      setLastRefreshed(new Date());
    });

    socket.on('trip_share:milestone_updated', (data: any) => {
      // Re-fetch clean state on milestone transitions
      fetchTripStatus();
    });

    socket.on('trip_share:revoked', () => {
      setError('Trip sharing permission has been revoked by the patient.');
      setErrorCode('SHARE_PERMISSION_REVOKED');
      setTripData(null);
    });

    // Fallback polling every 10 seconds in case websockets are interrupted
    const interval = setInterval(fetchTripStatus, 10000);

    return () => {
      clearInterval(interval);
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, [token]);

  const backendUrl = getBackendBaseUrl();

  const fetchTripStatus = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${backendUrl}/api/v1/trip-share/track/${encodeURIComponent(token)}`);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setErrorCode(errData.code || `HTTP_${res.status}`);
        setError(errData.message || 'Failed to retrieve trip sharing information.');
        setTripData(null);
        return;
      }

      const data = await res.json();
      setTripData(data);
      setError(null);
      setErrorCode(null);
      setLastRefreshed(new Date());
    } catch (err: any) {
      if (!tripData) {
        setError(err.message || 'Network connection failed while tracking trip.');
      }
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30';
      case 'CANCELLED':
        return 'bg-rose-500/10 text-rose-500 border-rose-500/30';
      case 'PATIENT_PICKED_UP':
      case 'AT_DESTINATION':
      case 'IN_TRANSIT':
        return 'bg-blue-500/10 text-blue-500 border-blue-500/30';
      case 'AMBULANCE_ARRIVING':
        return 'bg-amber-500/10 text-amber-500 border-amber-500/30';
      default:
        return 'bg-purple-500/10 text-purple-500 border-purple-500/30';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 border-4 border-rose-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <h2 className="text-xl font-black text-white">Loading Emergency Trip Tracking...</h2>
          <p className="text-slate-400 text-sm">Verifying secure token and decrypting real-time telemetry.</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 text-white">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl p-8 text-center space-y-6 shadow-2xl">
          <div className="w-16 h-16 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-500 flex items-center justify-center mx-auto">
            <AlertTriangle className="w-8 h-8" />
          </div>

          <div className="space-y-2">
            <h2 className="text-xl font-black text-white">
              {errorCode === 'SHARE_PERMISSION_REVOKED'
                ? 'Trip Sharing Revoked'
                : errorCode === 'SHARE_PERMISSION_EXPIRED'
                ? 'Trip Sharing Expired'
                : 'Tracking Unavailable'}
            </h2>
            <p className="text-slate-400 text-sm leading-relaxed">{error}</p>
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 text-left space-y-2">
            <div className="flex items-center gap-2 text-rose-400 text-xs font-bold uppercase tracking-wider">
              <ShieldAlert className="w-4 h-4" />
              <span>Security & Privacy Notice</span>
            </div>
            <p className="text-xs text-slate-400">
              Trip sharing permissions are strictly time-bounded and revocable by the patient at any time under the
              Digital Personal Data Protection (DPDP) Act, 2023.
            </p>
          </div>

          <div className="pt-2">
            <a
              href="tel:112"
              className="w-full py-3 bg-red-600 hover:bg-red-500 text-white rounded-2xl text-xs font-black shadow-lg shadow-red-600/30 flex items-center justify-center gap-2 transition-all"
            >
              <PhoneCall className="w-4 h-4" />
              <span>National Emergency Helpline (112)</span>
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (!tripData) return null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Top Header Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 md:p-8 shadow-xl space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-rose-500/10 text-rose-500 border border-rose-500/20 flex items-center justify-center font-black">
                  <Car className="w-5 h-5" />
                </div>
                <div>
                  <h1 className="text-xl font-black text-white flex items-center gap-2">
                    <span>Emergency Trip Tracking</span>
                    <span
                      className={`text-2xs uppercase tracking-wider font-bold px-2.5 py-0.5 rounded-full border ${getStatusColor(
                        tripData.tripStatus
                      )}`}
                    >
                      {tripData.tripStatus.replace(/_/g, ' ')}
                    </span>
                  </h1>
                  <p className="text-xs text-slate-400">
                    Secure family & trusted-contact sharing for <strong className="text-white">{tripData.patientMaskedName}</strong>
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 text-2xs font-mono px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-400">
                {socketConnected ? (
                  <>
                    <Wifi className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                    <span className="text-emerald-400 font-bold">Live Stream</span>
                  </>
                ) : (
                  <>
                    <WifiOff className="w-3.5 h-3.5 text-amber-400" />
                    <span>Polling</span>
                  </>
                )}
              </div>

              <button
                onClick={fetchTripStatus}
                title="Refresh trip telemetry"
                className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition-all cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Privacy disclaimer banner */}
          <div className="p-3.5 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-xs text-blue-300 flex items-start gap-2.5">
            <ShieldCheck className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <span className="font-bold">Privacy-Preserving Family Share:</span>
              <p className="text-2xs text-blue-300/80 leading-relaxed">
                Personal medical history (conditions, medications, blood group, allergies) is strictly confidential and
                protected under India's DPDP Act, 2023. Only emergency transit progress and authorized telemetry are displayed.
              </p>
            </div>
          </div>
        </div>

        {/* Milestone Progression Stepper */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 md:p-8 shadow-xl space-y-6">
          <h2 className="text-sm font-black text-slate-300 uppercase tracking-wider flex items-center gap-2">
            <Clock className="w-4 h-4 text-rose-500" />
            <span>Trip Milestone Status</span>
          </h2>

          <div className="relative pl-6 space-y-6 border-l-2 border-slate-800 ml-3">
            {tripData.milestones.map((m, idx) => {
              const isCurrent = tripData.currentMilestone === m.milestone;
              return (
                <div key={idx} className="relative group">
                  <div
                    className={`absolute -left-[31px] top-0.5 w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs font-bold ${
                      m.completed
                        ? 'bg-emerald-500 border-emerald-400 text-slate-950'
                        : isCurrent
                        ? 'bg-rose-500 border-rose-400 text-white animate-pulse'
                        : 'bg-slate-950 border-slate-800 text-slate-600'
                    }`}
                  >
                    {m.completed ? <CheckCircle2 className="w-3.5 h-3.5" /> : idx + 1}
                  </div>

                  <div className="space-y-1">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                      <h4
                        className={`text-sm font-black ${
                          m.completed ? 'text-white' : isCurrent ? 'text-rose-400' : 'text-slate-500'
                        }`}
                      >
                        {m.label}
                      </h4>
                      {m.timestamp && (
                        <span className="text-2xs font-mono text-slate-400">
                          {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                      )}
                    </div>

                    {isCurrent && (
                      <p className="text-xs text-rose-400/90 font-medium">
                        Active milestone currently underway.
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Map & Live Location Section */}
        {tripData.isLiveTrackingActive && tripData.liveLocation && (
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 md:p-8 shadow-xl space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="space-y-0.5">
                <h2 className="text-sm font-black text-slate-300 uppercase tracking-wider flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-emerald-400" />
                  <span>Live Ambulance GPS Telemetry</span>
                </h2>
                <span className="text-xs text-slate-400">
                  Last ping:{' '}
                  {new Date(tripData.liveLocation.lastUpdated).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}{' '}
                  ({tripData.liveLocation.locationAgeSeconds}s ago)
                </span>
              </div>

              {tripData.liveLocation.isStale && (
                <div className="px-3 py-1 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-bold flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span>Stale Telemetry (&gt;5m)</span>
                </div>
              )}
            </div>

            {/* Staleness warning if location is old */}
            {tripData.liveLocation.stalenessWarning && (
              <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{tripData.liveLocation.stalenessWarning}</span>
              </div>
            )}

            {/* Map Container */}
            <div className="h-80 w-full rounded-2xl overflow-hidden border border-slate-800 shadow-inner">
              <LeafletMap
                patientLoc={[tripData.pickup.lat, tripData.pickup.lng]}
                driverLoc={[tripData.liveLocation.lat, tripData.liveLocation.lng]}
                hospitalLoc={null}
                status={tripData.tripStatus}
                zoom={14}
              />
            </div>

            {/* Telemetry Chips */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
              <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800">
                <span className="text-2xs uppercase tracking-wider font-bold text-slate-500">Ambulance</span>
                <p className="text-sm font-black text-white">{tripData.vehicle?.vehicleNumber || 'Assigned'}</p>
              </div>
              <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800">
                <span className="text-2xs uppercase tracking-wider font-bold text-slate-500">Movement</span>
                <p className="text-sm font-black text-emerald-400">{tripData.liveLocation.movementStatus}</p>
              </div>
              <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800">
                <span className="text-2xs uppercase tracking-wider font-bold text-slate-500">Speed</span>
                <p className="text-sm font-black text-white">{tripData.liveLocation.speedKmH} km/h</p>
              </div>
              <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800">
                <span className="text-2xs uppercase tracking-wider font-bold text-slate-500">Service</span>
                <p className="text-sm font-black text-rose-400">{tripData.vehicle?.ambulanceType?.replace(/_/g, ' ') || 'Emergency'}</p>
              </div>
            </div>
          </div>
        )}

        {/* If live location has stopped because trip is finished */}
        {(!tripData.isLiveTrackingActive || !tripData.liveLocation) && (
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 text-center space-y-2 shadow-xl">
            <div className="w-10 h-10 rounded-2xl bg-slate-800 text-slate-400 flex items-center justify-center mx-auto">
              <Compass className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-black text-white">Live Location Tracking Inactive</h3>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              {tripData.tripStatus === 'COMPLETED'
                ? 'This emergency trip has concluded safely. Live GPS streaming has been stopped.'
                : tripData.tripStatus === 'CANCELLED'
                ? 'This emergency request was cancelled. GPS location updates are discontinued.'
                : 'Live coordinates will appear here once the assigned ambulance initiates transit.'}
            </p>
          </div>
        )}

        {/* Destination Hospital Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 md:p-8 shadow-xl space-y-4">
          <h2 className="text-sm font-black text-slate-300 uppercase tracking-wider flex items-center gap-2">
            <Building2 className="w-4 h-4 text-blue-400" />
            <span>Destination Hospital</span>
          </h2>

          {tripData.destinationHospital ? (
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold">
                    Confirmed Destination
                  </span>
                </div>
                <h3 className="text-base font-black text-white">{tripData.destinationHospital.name}</h3>
                <p className="text-xs text-slate-400">{tripData.destinationHospital.address}</p>
              </div>

              {tripData.destinationHospital.phone && (
                <a
                  href={`tel:${tripData.destinationHospital.phone}`}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold flex items-center gap-2 shrink-0 transition-all"
                >
                  <PhoneCall className="w-3.5 h-3.5 text-blue-400" />
                  <span>Call Hospital ER</span>
                </a>
              )}
            </div>
          ) : (
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 flex items-start gap-3 text-slate-400 text-xs">
              <Info className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
              <p>{tripData.destinationNotice || 'Hospital destination will be displayed once confirmed by dispatch.'}</p>
            </div>
          )}
        </div>

        {/* National 112 Safety Card */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-3xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-0.5">
            <h4 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-red-500" />
              <span>National Emergency Helpline</span>
            </h4>
            <p className="text-2xs text-slate-400">
              LifeLink coordinates care with authorized services. For life-threatening emergencies, always call 112 directly.
            </p>
          </div>

          <a
            href="tel:112"
            className="px-6 py-2.5 bg-red-600 hover:bg-red-500 text-white rounded-2xl text-xs font-black shadow-lg shadow-red-600/20 flex items-center gap-2 shrink-0 transition-all"
          >
            <PhoneCall className="w-3.5 h-3.5" />
            <span>Call 112</span>
          </a>
        </div>
      </div>
    </div>
  );
};

export default PublicTripShare;
