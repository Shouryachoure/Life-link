import React, { useState, useEffect, useRef } from 'react';
import {
  ShieldAlert,
  Phone,
  MapPin,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Building2,
  Sparkles,
  Send,
  Info,
  X,
  Maximize2,
  Minimize2,
  ShieldCheck,
  AlertCircle,
  Activity,
  Heart,
  User,
  Radio,
  Compass,
  Navigation,
  Ambulance,
  PhoneCall,
  FlaskConical,
  Check,
  ExternalLink,
  MessageSquare,
  PhoneForwarded,
  Copy,
  AlertOctagon,
  CheckSquare,
  Square,
  FileText,
} from 'lucide-react';
import { LeafletMap, type AmbulanceProviderMarkerItem } from '../LeafletMap';
import { HeartbeatLoader } from '../ui/HeartbeatLoader';
import { searchAddress, type GeocodingResult } from '../../utils/geocodingAdapter';
import { calculateHaversineDistanceKm } from '../../utils/routingAdapter';

interface EmergencySosSectionProps {
  user: any;
  lat: number;
  lng: number;
  locLoading: boolean;
  geoPermission: 'PROMPT' | 'GRANTED' | 'DENIED';
  onDetectLocation: () => void;
  onRequestLocation: () => void;
  onSetCoords: (lat: number, lng: number) => void;
  activeTrip: any;
  driverLocation: [number, number] | null;
  driverLocationStatus: 'LIVE' | 'STALE' | 'OFFLINE';
  driverLocationTimestamp: number | null;
  nearbyHospitals: any[];
  nearbyAmbulances: any[];
  loadingHospitals: boolean;
  selectedHospital: any;
  onSelectHospital: (hospitalId: string) => void;
  socket: any;
  apiFetch: (url: string, options?: RequestInit) => Promise<any>;
  onCancelTrip: () => Promise<void>;
}

export const EmergencySosSection: React.FC<EmergencySosSectionProps> = ({
  user,
  lat,
  lng,
  locLoading,
  geoPermission,
  onDetectLocation,
  onRequestLocation,
  onSetCoords,
  activeTrip,
  driverLocation,
  driverLocationStatus,
  driverLocationTimestamp,
  nearbyHospitals,
  nearbyAmbulances,
  loadingHospitals,
  selectedHospital,
  onSelectHospital,
  socket,
  apiFetch,
  onCancelTrip,
}) => {
  // Navigation / Tab inside SOS
  const [sosSubTab, setSosSubTab] = useState<'SOS' | 'AI_TRIAGE' | 'RADAR' | 'TEST_WORKFLOW'>('SOS');

  // Controlled SOS Test Workflow States
  const EMERGENCY_TEST_PHONE = import.meta.env.VITE_EMERGENCY_TEST_CONTACT_PHONE || '+918669202393';
  const EMERGENCY_TEST_NAME = import.meta.env.VITE_EMERGENCY_TEST_CONTACT_NAME || 'TEST CONTACT';

  const [testConfig, setTestConfig] = useState<any>(null);
  const [testLoading, setTestLoading] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [testSuccessNotice, setTestSuccessNotice] = useState<string | null>(null);
  const [testRequestId, setTestRequestId] = useState<string | null>(null);
  const [testEmergencyId, setTestEmergencyId] = useState<string | null>(null);
  const [testNotificationPayload, setTestNotificationPayload] = useState<any | null>(null);
  const [testUserConfirmed, setTestUserConfirmed] = useState(false);
  const [testDeliveryResult, setTestDeliveryResult] = useState<any | null>(null);
  const [testDeliveryLoading, setTestDeliveryLoading] = useState(false);
  const [testCallResult, setTestCallResult] = useState<any | null>(null);
  const [testAuditResults, setTestAuditResults] = useState<any | null>(null);
  const [testAuditLoading, setTestAuditLoading] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // Ambulance Dispatch Configuration
  const [ambulanceTier, setAmbulanceTier] = useState<'BASIC_LIFE_SUPPORT' | 'ADVANCED_LIFE_SUPPORT' | 'OXYGEN_SUPPORT'>(
    'BASIC_LIFE_SUPPORT'
  );
  const [includeMedicalProfile, setIncludeMedicalProfile] = useState(true);
  const [customDispatchNote, setCustomDispatchNote] = useState('');
  const [isDemoSimulation, setIsDemoSimulation] = useState(false);

  // Countdown & Dispatch State Machine: 'IDLE' | 'COUNTDOWN' | 'DISPATCHING' | 'ERROR'
  const [dispatchPhase, setDispatchPhase] = useState<'IDLE' | 'COUNTDOWN' | 'DISPATCHING' | 'ERROR'>('IDLE');
  const [countdownSeconds, setCountdownSeconds] = useState(10);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const countdownTimerRef = useRef<any>(null);
  const watchdogTimerRef = useRef<any>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);

  // Verified Ambulance Providers State
  const [ambulanceProviders, setAmbulanceProviders] = useState<AmbulanceProviderMarkerItem[]>([]);
  const [loadingAmbulanceProviders, setLoadingAmbulanceProviders] = useState(false);
  const [selectedAmbulanceProviderId, setSelectedAmbulanceProviderId] = useState<string | null>(null);
  const [facilityViewTab, setFacilityViewTab] = useState<'HOSPITALS' | 'AMBULANCE_DESKS'>('HOSPITALS');

  useEffect(() => {
    let isMounted = true;
    const fetchAmbulanceProviders = async () => {
      setLoadingAmbulanceProviders(true);
      try {
        const queryLat = typeof lat === 'number' && !isNaN(lat) ? lat : 21.1458;
        const queryLng = typeof lng === 'number' && !isNaN(lng) ? lng : 79.0882;
        const res = await apiFetch(`/directory/ambulances?city=Nagpur&lat=${queryLat}&lng=${queryLng}&limit=50`);
        const items = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
        if (isMounted) {
          const mapped: AmbulanceProviderMarkerItem[] = items
            .filter((item: any) => typeof item.lat === 'number' && typeof item.lng === 'number')
            .map((item: any) => {
              let distLabel = 'Distance unavailable';
              let distKm: number | null = null;
              if (typeof lat === 'number' && typeof lng === 'number' && item.lat && item.lng) {
                distKm = calculateHaversineDistanceKm(lat, lng, item.lat, item.lng);
                distLabel = `Straight-line: ${distKm} km from you`;
              }
              const isHelpline = ['108', '112', '102'].includes(item.contactNumber);
              return {
                id: item.id,
                name: item.serviceName || item.name,
                operatorType: item.operatorType || 'PRIVATE_OPERATOR',
                operatorTypeLabel: item.categoryLabel || item.operatorType,
                contactNumber: item.contactNumber || item.publicBusinessPhone,
                alternateNumber: item.alternateContact || item.alternatePublicPhone,
                address: item.address || item.businessAddress,
                locality: item.locality || 'Nagpur',
                tehsil: item.tehsil || 'Nagpur Urban',
                lat: item.lat,
                lng: item.lng,
                distanceKm: distKm,
                distanceLabel: distLabel,
                advertisedServiceTypes: item.advertisedServiceTypes,
                advertisedIcuOrVentilatorCapability: item.advertisedIcuOrVentilatorCapability,
                dataConfidence: item.dataConfidence,
                isHelpline,
                isHospitalAffiliated: Boolean(item.linkedHospitalId),
                linkedHospitalName: item.linkedHospitalName,
                coverageGroup: item.coverageGroup,
              };
            });
          setAmbulanceProviders(mapped);
        }
      } catch (err) {
        console.error('Failed to load ambulance providers in SOS section:', err);
      } finally {
        if (isMounted) setLoadingAmbulanceProviders(false);
      }
    };

    fetchAmbulanceProviders();
    return () => {
      isMounted = false;
    };
  }, [lat, lng, apiFetch]);

  const handleSelectHospital = (hId: string) => {
    onSelectHospital(hId);
    setSelectedAmbulanceProviderId(null);
    setTimeout(() => {
      mapContainerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 60);
  };

  const handleSelectFromMap = (hId: string) => {
    onSelectHospital(hId);
    setSelectedAmbulanceProviderId(null);
    setFacilityViewTab('HOSPITALS');
    setTimeout(() => {
      document.getElementById(`sos-hospital-${hId}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 80);
  };

  const handleSelectAmbulanceFromMap = (ambId: string) => {
    setSelectedAmbulanceProviderId(ambId);
    setFacilityViewTab('AMBULANCE_DESKS');
    setTimeout(() => {
      document.getElementById(`sos-ambulance-${ambId}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 80);
  };

  const handleSelectAmbulanceCard = (ambId: string) => {
    setSelectedAmbulanceProviderId(ambId);
    setTimeout(() => {
      mapContainerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 60);
  };

  // Address Geocoding Search
  const [addressQuery, setAddressQuery] = useState('');
  const [addressResults, setAddressResults] = useState<GeocodingResult[]>([]);
  const [searchingAddress, setSearchingAddress] = useState(false);
  const [addressError, setAddressError] = useState('');
  const [showAddressInput, setShowAddressInput] = useState(false);

  // Fullscreen map modal state
  const [isMapExpanded, setIsMapExpanded] = useState(false);

  // AI Symptom Router states
  const [symptomInput, setSymptomInput] = useState('');
  const [triageLoading, setTriageLoading] = useState(false);
  const [triageResult, setTriageResult] = useState<any>(null);

  // Audio Siren
  const playEmergencyTone = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(440, audioCtx.currentTime);

      for (let i = 0; i < 4; i += 0.5) {
        osc.frequency.linearRampToValueAtTime(880, audioCtx.currentTime + i + 0.25);
        osc.frequency.linearRampToValueAtTime(440, audioCtx.currentTime + i + 0.5);
      }

      gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 4.0);

      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 4.0);
    } catch {
      // Audio autoplay may be disabled by browser policy
    }
  };

  // 1. Trigger SOS Countdown Confirmation
  const startSosCountdown = () => {
    if (activeTrip || dispatchPhase !== 'IDLE') return;
    setDispatchError(null);
    setCountdownSeconds(10);
    setDispatchPhase('COUNTDOWN');
  };

  // 2. Cancel Countdown
  const cancelSosCountdown = () => {
    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    setDispatchPhase('IDLE');
    setCountdownSeconds(10);
  };

  // Countdown timer effect
  useEffect(() => {
    if (dispatchPhase !== 'COUNTDOWN') return;

    countdownTimerRef.current = setInterval(() => {
      setCountdownSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(countdownTimerRef.current);
          executeFinalDispatch('SOS');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    };
  }, [dispatchPhase]);

  // Keyboard Escape listener to cancel countdown
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dispatchPhase === 'COUNTDOWN') {
        cancelSosCountdown();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dispatchPhase]);

  // 3. Execute Actual Dispatch to Backend via WebSocket
  const executeFinalDispatch = (tripType: 'SOS' | 'STANDARD' = 'SOS', overrideHospitalId?: string, overrideTier?: string) => {
    setDispatchPhase('DISPATCHING');
    playEmergencyTone();

    if (!navigator.onLine || !socket || !socket.connected) {
      setDispatchPhase('ERROR');
      setDispatchError(
        'Your device appears offline or disconnected from LifeLink dispatch servers. Please dial 112 directly.'
      );
      return;
    }

    // 8-second watchdog timer
    if (watchdogTimerRef.current) clearTimeout(watchdogTimerRef.current);
    watchdogTimerRef.current = setTimeout(() => {
      if (!activeTrip) {
        setDispatchPhase('ERROR');
        setDispatchError(
          'Dispatch acknowledgment timed out. Local network may be congested. Please call 112 directly.'
        );
      }
    }, 8000);

    const idempotencyKey = `sos_${user?.id || 'anon'}_${Date.now()}`;
    socket.emit('sos:trigger', {
      patientId: user?.id,
      lat,
      lng,
      tripType,
      ambulanceType: overrideTier || ambulanceTier,
      hospitalId: overrideHospitalId,
      notes: customDispatchNote.trim() || undefined,
      includeMedicalProfile,
      isDemo: isDemoSimulation,
      idempotencyKey,
    });
  };

  // Reset dispatch state when active trip arrives or ends
  useEffect(() => {
    if (activeTrip) {
      setDispatchPhase('IDLE');
      if (watchdogTimerRef.current) clearTimeout(watchdogTimerRef.current);
    }
  }, [activeTrip]);

  // Address search autocomplete
  const handleAddressSearch = async (val: string) => {
    setAddressQuery(val);
    if (val.trim().length < 3) {
      setAddressResults([]);
      return;
    }
    setSearchingAddress(true);
    setAddressError('');
    try {
      const res = await searchAddress(val);
      setAddressResults(res.results);
      if (res.results.length === 0 && res.error) {
        setAddressError(res.error);
      }
    } catch {
      setAddressError('Geocoding service unavailable. You can click on the map to set location.');
    } finally {
      setSearchingAddress(false);
    }
  };

  const handleSelectAddress = (item: GeocodingResult) => {
    onSetCoords(item.lat, item.lng);
    setAddressQuery(item.displayName.split(',')[0]);
    setAddressResults([]);
    setShowAddressInput(false);
  };

  // AI Symptom Triage Submission
  const handleSymptomTriage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!symptomInput.trim()) return;
    setTriageLoading(true);
    setTriageResult(null);
    try {
      const result = await apiFetch('/requests/symptom-triage', {
        method: 'POST',
        body: JSON.stringify({ symptoms: symptomInput, lat, lng }),
      });
      setTriageResult(result);
    } catch (err: any) {
      setDispatchError(err.message || 'Symptom routing failed. Please use standard ambulance request.');
    } finally {
      setTriageLoading(false);
    }
  };

  // Controlled SOS Test Workflow Methods
  useEffect(() => {
    let isMounted = true;
    const fetchConfig = async () => {
      try {
        const res = await apiFetch('/sos/test-workflow/config');
        if (isMounted && res) {
          setTestConfig(res);
        }
      } catch (err: any) {
        console.warn('Could not load test workflow config:', err?.message);
      }
    };
    if (sosSubTab === 'TEST_WORKFLOW' && !testConfig) {
      fetchConfig();
    }
    return () => {
      isMounted = false;
    };
  }, [sosSubTab, testConfig, apiFetch]);

  const handleInitiateTestSos = async () => {
    setTestLoading(true);
    setTestError(null);
    setTestSuccessNotice(null);
    try {
      const payload = {
        pickupLat: lat,
        pickupLng: lng,
        gpsPermission: geoPermission,
        pickupAddress: addressQuery || 'Nagpur Pilot Zone, Maharashtra',
        notes: 'Controlled emergency workflow test drill',
      };
      const res = await apiFetch('/sos/test-workflow/initiate', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if (res?.success) {
        setTestRequestId(res.requestId);
        setTestEmergencyId(res.testEmergencyId);
        setTestNotificationPayload(res.notificationPayload);
        setTestSuccessNotice(`Test SOS record created successfully: ${res.testEmergencyId}`);
        fetchTestAudit(res.requestId);
      } else {
        setTestError(res?.message || 'Failed to initiate test SOS');
      }
    } catch (err: any) {
      setTestError(err?.message || 'Network error initiating test SOS');
    } finally {
      setTestLoading(false);
    }
  };

  const handleCallTestContact = async () => {
    if (!testRequestId) {
      setTestError('Please initiate a test SOS record first before testing the call action.');
      return;
    }
    try {
      const res = await apiFetch('/sos/test-workflow/call-action', {
        method: 'POST',
        body: JSON.stringify({ requestId: testRequestId }),
      });
      setTestCallResult(res);
      fetchTestAudit(testRequestId);
    } catch (err: any) {
      console.warn('Could not record call action in audit log:', err?.message);
    }
  };

  const handleSendTestLocation = async () => {
    if (!testRequestId) {
      setTestError('Please initiate a test SOS record first.');
      return;
    }
    if (!testUserConfirmed) {
      setTestError('You must explicitly check the confirmation box before sending location coordinates.');
      return;
    }

    setTestDeliveryLoading(true);
    setTestError(null);
    try {
      const res = await apiFetch('/sos/test-workflow/send-location', {
        method: 'POST',
        body: JSON.stringify({
          requestId: testRequestId,
          confirmedByUser: true,
        }),
      });

      setTestDeliveryResult(res);
      fetchTestAudit(testRequestId);
    } catch (err: any) {
      setTestError(err?.message || 'Failed to dispatch test location notification');
    } finally {
      setTestDeliveryLoading(false);
    }
  };

  const fetchTestAudit = async (reqId: string) => {
    setTestAuditLoading(true);
    try {
      const res = await apiFetch(`/sos/test-workflow/results/${reqId}`);
      setTestAuditResults(res);
    } catch (err: any) {
      console.warn('Failed to fetch test results audit:', err?.message);
    } finally {
      setTestAuditLoading(false);
    }
  };

  const handleResetTestDrill = () => {
    setTestRequestId(null);
    setTestEmergencyId(null);
    setTestNotificationPayload(null);
    setTestUserConfirmed(false);
    setTestDeliveryResult(null);
    setTestCallResult(null);
    setTestAuditResults(null);
    setTestError(null);
    setTestSuccessNotice(null);
  };

  // Medical profile summary
  const medProfile = user?.patientProfile;
  const hasMedicalNotes = Boolean(medProfile?.bloodGroup || medProfile?.allergies || medProfile?.emergencyContactName);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* 1. OFFICIAL INDIA 112 NATIONAL EMERGENCY BANNER */}
      <div className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-rose-600 text-white font-mono font-black text-sm flex items-center justify-center shrink-0 shadow-sm shadow-rose-600/30">
            112
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">
                Official National Emergency Services (India)
              </span>
              <span className="hidden sm:inline-block text-[10px] font-semibold px-2 py-0.5 rounded bg-rose-50 dark:bg-rose-950 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-900">
                Police • Fire • Medical
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed">
              For immediate life-threatening crises, dial 112 directly. LifeLink coordinates with private & partner hospital fleets and operates concurrently.
            </p>
          </div>
        </div>
        <a
          href="tel:112"
          className="w-full md:w-auto px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs uppercase tracking-wider rounded-xl shadow-md shadow-rose-600/20 active:scale-[0.99] transition-all flex items-center justify-center gap-2 shrink-0 cursor-pointer"
        >
          <Phone className="w-3.5 h-3.5" />
          <span>Call 112 Hotline</span>
        </a>
      </div>

      {/* 2. EMERGENCY ASSISTANCE HEADER & REAL-TIME LOCATION BAR */}
      <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xl shadow-slate-950/5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b border-slate-100 dark:border-slate-800">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse"></span>
              <span className="text-xs font-bold uppercase tracking-widest text-rose-600 dark:text-rose-400">
                Immediate Response Protocol
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
              Emergency Assistance
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
              Get the right help when every second matters.
            </p>
          </div>

          {/* Location Badge & Accuracy */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2.5">
            <div className="px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 flex items-center gap-2.5">
              <MapPin className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0" />
              <div className="text-left">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200 font-mono">
                    {lat.toFixed(4)}, {lng.toFixed(4)}
                  </span>
                  <span
                    className={`text-[9px] font-bold px-1.5 py-0.2 rounded ${
                      geoPermission === 'GRANTED'
                        ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300'
                        : 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300'
                    }`}
                  >
                    {geoPermission === 'GRANTED' ? 'GPS Lock' : 'Pilot Center'}
                  </span>
                </div>
                <span className="text-[10px] text-slate-400 block truncate max-w-[200px]">
                  {addressQuery || 'Nagpur Pilot Zone, MH'}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1.5 w-full sm:w-auto">
              <button
                type="button"
                onClick={onRequestLocation}
                disabled={locLoading}
                className="flex-1 sm:flex-initial px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                title="Refresh GPS Coordinates"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${locLoading ? 'animate-spin text-teal-600' : ''}`} />
                <span>{locLoading ? 'Locating...' : 'Refresh GPS'}</span>
              </button>

              <button
                type="button"
                onClick={() => setShowAddressInput(!showAddressInput)}
                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold transition-colors cursor-pointer"
              >
                {showAddressInput ? 'Close' : 'Edit Location'}
              </button>
            </div>
          </div>
        </div>

        {/* Address Manual Autocomplete Bar (Collapsible) */}
        {showAddressInput && (
          <div className="pt-4 pb-2 animate-in fade-in duration-200">
            <div className="relative max-w-xl">
              <div className="relative">
                <input
                  type="text"
                  value={addressQuery}
                  onChange={(e) => handleAddressSearch(e.target.value)}
                  placeholder="Type an address or locality in Nagpur (e.g. Sitabuldi, Mankapur, Dhantoli)..."
                  className="w-full h-10 pl-9 pr-24 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                />
                <MapPin className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                {searchingAddress && (
                  <span className="text-[10px] text-slate-400 absolute right-3 top-3 font-semibold">Searching...</span>
                )}
              </div>

              {addressResults.length > 0 && (
                <div className="absolute top-12 left-0 right-0 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl p-1 z-30 max-h-56 overflow-y-auto">
                  {addressResults.map((item, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleSelectAddress(item)}
                      className="w-full text-left p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 text-xs transition-colors cursor-pointer block"
                    >
                      <p className="font-bold text-slate-800 dark:text-slate-200 truncate">{item.displayName}</p>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {item.lat.toFixed(4)}, {item.lng.toFixed(4)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {addressError && <p className="text-[11px] text-amber-500 mt-1">{addressError}</p>}
            </div>
          </div>
        )}

        {/* Sub-navigation tabs: SOS Action vs AI Symptom Assistance vs Live Radar Map */}
        <div className="flex items-center gap-2 pt-4 overflow-x-auto">
          <button
            type="button"
            onClick={() => setSosSubTab('SOS')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
              sosSubTab === 'SOS'
                ? 'bg-rose-600 text-white shadow-sm shadow-rose-600/30'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Emergency SOS Dispatch</span>
          </button>

          <button
            type="button"
            onClick={() => setSosSubTab('AI_TRIAGE')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
              sosSubTab === 'AI_TRIAGE'
                ? 'bg-teal-600 text-white shadow-sm shadow-teal-600/30'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>AI Symptom Router</span>
          </button>

          <button
            type="button"
            onClick={() => setSosSubTab('RADAR')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
              sosSubTab === 'RADAR'
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/30'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            <span>Live Hospital & Ambulance Map</span>
          </button>

          <button
            type="button"
            onClick={() => setSosSubTab('TEST_WORKFLOW')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
              sosSubTab === 'TEST_WORKFLOW'
                ? 'bg-amber-600 text-white shadow-sm shadow-amber-600/30 ring-2 ring-amber-500/50'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <FlaskConical className="w-3.5 h-3.5 text-amber-300" />
            <span>Controlled SOS Drill</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/30">
              Test (+918669202393)
            </span>
          </button>
        </div>
      </div>

      {/* 3. ACTIVE TRIP VIEW (When an emergency is actively running) */}
      {activeTrip && (
        <div className="p-6 sm:p-8 rounded-3xl bg-white dark:bg-slate-900 border-2 border-rose-500/40 shadow-2xl shadow-rose-600/10 space-y-6 animate-in slide-in-from-top-4 duration-300">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-rose-50 dark:bg-rose-950 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 text-xs font-extrabold mb-2">
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping"></span>
                <span>Active Emergency Dispatch</span>
              </div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                {activeTrip.tripType === 'SOS' ? 'Code Red Emergency Protocol' : 'Standard Ambulance En Route'}
              </h2>
            </div>

            <div className="flex items-center gap-3">
              <div className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-mono font-bold text-slate-700 dark:text-slate-300">
                Status: <span className="text-rose-600 dark:text-rose-400 uppercase">{activeTrip.status}</span>
              </div>
              {activeTrip.etaMinutes && (
                <div className="px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950 text-xs font-mono font-bold text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                  ETA: ~{activeTrip.etaMinutes} min
                </div>
              )}
            </div>
          </div>

          {/* Assigned Bay / Doctor Notification */}
          {activeTrip.assignedBay && (
            <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 flex items-center justify-between gap-4 text-emerald-900 dark:text-emerald-200">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900 flex items-center justify-center font-bold text-emerald-700 dark:text-emerald-300 shrink-0">
                  🏥
                </div>
                <div>
                  <span className="text-xs font-bold block uppercase tracking-wide">
                    Hospital Trauma Bay Allocated: {activeTrip.assignedBay}
                  </span>
                  <span className="text-[11px] text-emerald-700 dark:text-emerald-400">
                    Physician Team: {activeTrip.doctorName || 'Emergency Trauma Team on Standby'}
                  </span>
                </div>
              </div>
              <span className="text-[10px] font-mono font-bold px-2.5 py-1 rounded-lg bg-emerald-100 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-200">
                ER READY
              </span>
            </div>
          )}

          {/* Real-time Map tracking */}
          <div className="h-72 sm:h-80 rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 shadow-inner">
            <LeafletMap
              patientLoc={[activeTrip.pickupLat || lat, activeTrip.pickupLng || lng]}
              driverLoc={driverLocation}
              hospitalLoc={activeTrip.hospital ? [activeTrip.hospital.lat, activeTrip.hospital.lng] : null}
              status={activeTrip.status}
              zoom={13}
            />
          </div>

          {/* Driver contact & vehicle summary */}
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold text-lg shrink-0">
                🚑
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {activeTrip.driver?.name || 'Assigned Paramedic Unit'}
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Plate: {activeTrip.driver?.ambulance?.vehicleNumber || 'Dispatching Unit'} •{' '}
                  {activeTrip.hospital?.name || 'Nearest Verified Hospital'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              {activeTrip.driver?.phone && (
                <a
                  href={`tel:${activeTrip.driver.phone}`}
                  className="flex-1 sm:flex-initial px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Phone className="w-3.5 h-3.5" />
                  <span>Call Paramedic</span>
                </a>
              )}
              <button
                type="button"
                onClick={async () => {
                  if (window.confirm('Are you sure you want to cancel this emergency ambulance request?')) {
                    await onCancelTrip();
                  }
                }}
                className="flex-1 sm:flex-initial px-4 py-2 rounded-xl border border-rose-300 dark:border-rose-800 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950 font-bold text-xs transition-colors cursor-pointer"
              >
                Cancel Emergency
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. MAIN WORKFLOW: SUB-TAB 'SOS' (When no active trip is running) */}
      {!activeTrip && sosSubTab === 'SOS' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* LEFT COLUMN: PRIMARY SOS DISPATCH CONTROL (7 COLS) */}
          <div className="lg:col-span-7 p-6 sm:p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xl shadow-slate-950/5 flex flex-col justify-between space-y-6">
            <div>
              {/* Quick Launch Banner for Controlled Test Drill */}
              <div className="mb-4 p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400">
                    <FlaskConical className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                      <span>Controlled SOS Drill</span>
                      <span className="text-[10px] px-1.5 py-0.5 bg-amber-500/20 text-amber-700 dark:text-amber-300 font-extrabold rounded">
                        TEST CONTACT +918669202393
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Test GPS coordinates, dialer action, and location delivery safely without real dispatches.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSosSubTab('TEST_WORKFLOW')}
                  className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition-all shrink-0 cursor-pointer shadow-xs"
                >
                  Test Drill
                </button>
              </div>

              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Primary Emergency Trigger
                </span>
                <span className="text-[11px] font-semibold text-slate-500 flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                  Encrypted Dispatch
                </span>
              </div>

              {/* Error Alert if any */}
              {dispatchError && (
                <div className="mb-4 p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 flex items-start gap-2.5 text-xs text-rose-700 dark:text-rose-300">
                  <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                  <div className="leading-relaxed">
                    <strong className="block font-bold">Dispatch Notice:</strong>
                    {dispatchError}
                  </div>
                </div>
              )}

              {/* STATE 1: IDLE */}
              {dispatchPhase === 'IDLE' && (
                <div className="text-center py-4 space-y-6">
                  <div>
                    <h2 className="text-xl sm:text-2xl font-black tracking-tight text-slate-900 dark:text-slate-100">
                      Tap to Initiate Code Red Dispatch
                    </h2>
                    <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1.5 max-w-md mx-auto leading-relaxed">
                      Transmits high-priority emergency alert with your GPS coordinates and medical record to the nearest ambulance and hospital ER trauma team.
                    </p>
                  </div>

                  {/* Refined, proportionate SOS Button */}
                  <div className="flex justify-center py-2">
                    <button
                      type="button"
                      onClick={startSosCountdown}
                      className="group relative w-48 h-48 sm:w-52 sm:h-52 rounded-full bg-gradient-to-tr from-rose-700 via-rose-600 to-red-500 text-white flex flex-col items-center justify-center shadow-2xl shadow-rose-600/35 hover:shadow-rose-600/50 hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 cursor-pointer border-4 border-white/20 select-none"
                      aria-label="Activate Emergency SOS"
                    >
                      {/* Subtle pulse ring */}
                      <span className="absolute inset-0 rounded-full bg-rose-500/20 animate-ping pointer-events-none"></span>

                      <div className="w-14 h-14 rounded-2xl bg-white/15 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
                        <ShieldAlert className="w-8 h-8 text-white" />
                      </div>
                      <span className="text-3xl font-black tracking-widest uppercase font-mono">SOS</span>
                      <span className="text-[10px] uppercase font-bold tracking-wider text-rose-100 mt-1">
                        Tap for Help
                      </span>
                    </button>
                  </div>

                  <p className="text-[11px] text-slate-400 dark:text-slate-500">
                    Includes a 10-second cancellable safety window before live broadcast.
                  </p>
                </div>
              )}

              {/* STATE 2: 10-SECOND CANCELLABLE CONFIRMATION COUNTDOWN */}
              {dispatchPhase === 'COUNTDOWN' && (
                <div className="text-center py-6 space-y-5 animate-in zoom-in-95 duration-200">
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 text-xs font-extrabold">
                    <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span>
                    <span>Safety Delay Active</span>
                  </div>

                  <h3 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-slate-100">
                    Broadcasting Emergency in {countdownSeconds}s
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
                    Press Cancel below or tap <kbd className="px-1.5 py-0.5 bg-slate-200 dark:bg-slate-800 rounded font-mono text-[10px]">Esc</kbd> if this was triggered accidentally.
                  </p>

                  {/* Circular countdown visual */}
                  <div className="flex justify-center my-4">
                    <div className="w-32 h-32 rounded-full bg-rose-50 dark:bg-rose-950/50 border-4 border-rose-500 flex flex-col items-center justify-center shadow-lg shadow-rose-500/20">
                      <span className="text-4xl font-black text-rose-600 dark:text-rose-400 font-mono">
                        {countdownSeconds}
                      </span>
                      <span className="text-[10px] font-bold uppercase text-slate-400">Seconds</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-center gap-3 max-w-xs mx-auto">
                    <button
                      type="button"
                      onClick={cancelSosCountdown}
                      className="w-full h-11 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <X className="w-4 h-4" />
                      <span>Cancel (Stop Dispatch)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => executeFinalDispatch('SOS')}
                      className="w-full h-11 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer flex items-center justify-center gap-1.5 shadow-md shadow-rose-600/20"
                    >
                      <span>Dispatch Now</span>
                    </button>
                  </div>
                </div>
              )}

              {/* STATE 3: DISPATCHING */}
              {dispatchPhase === 'DISPATCHING' && (
                <div className="text-center py-10 space-y-4">
                  <div className="flex justify-center">
                    <HeartbeatLoader size="large" />
                  </div>
                  <h3 className="text-xl font-extrabold text-slate-900 dark:text-slate-100">
                    Transmitting Emergency Packet...
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
                    Contacting nearest certified ambulance rigs and alerting trauma centers. Please keep LifeLink open.
                  </p>
                </div>
              )}
            </div>

            {/* Bottom: Simulation Toggle and Verification Integrity */}
            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-slate-500">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={isDemoSimulation}
                  onChange={(e) => setIsDemoSimulation(e.target.checked)}
                  className="rounded border-slate-300 text-teal-600 focus:ring-teal-500 cursor-pointer"
                />
                <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
                  Simulation sandbox mode (test without contacting real paramedics)
                </span>
              </label>

              <span className="text-[11px] font-semibold text-slate-400 font-mono">
                Protocol: ISO-22320 Emergency
              </span>
            </div>
          </div>

          {/* RIGHT COLUMN: STRUCTURED AMBULANCE REQUEST PANEL (5 COLS) */}
          <div className="lg:col-span-5 p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xl shadow-slate-950/5 flex flex-col justify-between space-y-5">
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider">
                  Ambulance Support Tier
                </h3>
                <span className="text-[10px] font-semibold text-teal-600 dark:text-teal-400">
                  Select Required Care Level
                </span>
              </div>

              {/* Ambulance Category Cards */}
              <div className="space-y-2.5">
                {[
                  {
                    tier: 'BASIC_LIFE_SUPPORT' as const,
                    title: 'Basic Life Support (BLS)',
                    desc: 'Emergency stretcher, vital signs monitoring, basic fracture splints & certified EMT.',
                    badge: 'Standard Emergency',
                    accent: 'border-teal-500 text-teal-600',
                  },
                  {
                    tier: 'ADVANCED_LIFE_SUPPORT' as const,
                    title: 'Advanced Life Support (ALS)',
                    desc: 'Ventilator, defibrillator, cardiac ECG monitor & specialized critical care paramedic.',
                    badge: 'Cardiac & Trauma',
                    accent: 'border-rose-500 text-rose-600',
                  },
                  {
                    tier: 'OXYGEN_SUPPORT' as const,
                    title: 'Oxygen Support Vehicle',
                    desc: 'Continuous flow medical oxygen, nebulizer & pulse oximetry respiratory technician.',
                    badge: 'Respiratory Critical',
                    accent: 'border-blue-500 text-blue-600',
                  },
                ].map((item) => {
                  const isSelected = ambulanceTier === item.tier;
                  return (
                    <div
                      key={item.tier}
                      onClick={() => setAmbulanceTier(item.tier)}
                      className={`p-3.5 rounded-2xl border transition-all cursor-pointer ${
                        isSelected
                          ? 'border-teal-500 bg-teal-50/40 dark:bg-teal-950/30 ring-2 ring-teal-500/20 shadow-sm'
                          : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                          {item.title}
                        </span>
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded bg-white dark:bg-slate-900 border ${isSelected ? item.accent : 'border-slate-200 dark:border-slate-700 text-slate-500'}`}>
                          {item.badge}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                        {item.desc}
                      </p>
                    </div>
                  );
                })}
              </div>

              {/* Medical Profile Consent Attachment */}
              <div className="mt-4 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5 text-teal-600" />
                    <span>Attach Emergency Medical Record</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={includeMedicalProfile}
                    onChange={(e) => setIncludeMedicalProfile(e.target.checked)}
                    className="rounded border-slate-300 text-teal-600 focus:ring-teal-500 cursor-pointer"
                  />
                </div>

                {hasMedicalNotes ? (
                  <div className="text-[11px] text-slate-600 dark:text-slate-400 grid grid-cols-2 gap-1.5 pt-1 border-t border-slate-200/60 dark:border-slate-700/60">
                    <div>
                      <span className="text-[10px] text-slate-400 block">Blood Group:</span>
                      <strong className="text-slate-800 dark:text-slate-200 font-bold">{medProfile?.bloodGroup || 'O+'}</strong>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 block">Known Allergies:</span>
                      <strong className="text-slate-800 dark:text-slate-200 font-bold truncate block">{medProfile?.allergies || 'None reported'}</strong>
                    </div>
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-400 pt-1">
                    No voluntary medical conditions on file. You can configure this in your Medical Profile.
                  </p>
                )}
              </div>

              {/* Optional brief accessibility note */}
              <div className="mt-3">
                <input
                  type="text"
                  value={customDispatchNote}
                  onChange={(e) => setCustomDispatchNote(e.target.value)}
                  placeholder="Optional note for paramedics (e.g. 2nd floor, wheelchair needed)..."
                  className="w-full h-9 px-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 outline-none focus:border-teal-500"
                />
              </div>
            </div>

            {/* Standard Request Ambulance Action */}
            <div className="pt-3">
              <button
                type="button"
                onClick={() => executeFinalDispatch('STANDARD')}
                disabled={dispatchPhase !== 'IDLE'}
                className="w-full h-11 rounded-xl bg-slate-900 dark:bg-slate-100 hover:bg-slate-800 dark:hover:bg-white text-white dark:text-slate-900 font-bold text-xs uppercase tracking-wider transition-all shadow-md active:scale-[0.99] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <span>Request Ambulance</span>
                <Send className="w-3.5 h-3.5" />
              </button>
              <p className="text-[10px] text-center text-slate-400 mt-2">
                Locates active approved vehicles within 12 km.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 5. SUB-TAB 'AI_TRIAGE': AI SYMPTOM-SPECIALIST ROUTER */}
      {!activeTrip && sosSubTab === 'AI_TRIAGE' && (
        <div className="p-6 sm:p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xl shadow-slate-950/5 space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                <span className="text-xs font-bold uppercase tracking-wider text-teal-600 dark:text-teal-400">
                  Intelligent Clinical Routing
                </span>
              </div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                Symptom-Specialist & Hospital Matcher
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Analyze acute symptoms to direct your transport to a hospital with matching specialist departments and available ICU beds.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSosSubTab('SOS')}
              className="text-xs font-semibold text-slate-500 hover:underline"
            >
              Back to Emergency SOS
            </button>
          </div>

          <form onSubmit={handleSymptomTriage} className="space-y-4 max-w-2xl">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                Describe Current Symptoms
              </label>
              <textarea
                required
                rows={3}
                value={symptomInput}
                onChange={(e) => setSymptomInput(e.target.value)}
                placeholder="Describe your condition in detail (e.g. intense crushing chest pressure for 20 mins, radiating to left arm, sweating, shortness of breath)..."
                className="w-full p-3.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-xs text-slate-900 dark:text-slate-100 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
              />
            </div>

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={triageLoading || !symptomInput.trim()}
                className="h-10 px-5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs uppercase tracking-wider transition-all shadow-md shadow-teal-600/20 active:scale-[0.99] flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {triageLoading ? (
                  <>
                    <HeartbeatLoader size="small" strokeColor="#ffffff" />
                    <span>Analyzing Clinical Guidelines...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Match Specialty & Hospital</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => setSymptomInput('')}
                className="h-10 px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Clear
              </button>
            </div>
          </form>

          {/* Clinical Triage Result Card */}
          {triageResult && (
            <div className="p-5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-4 max-w-2xl animate-in fade-in duration-200">
              <div className="flex items-center justify-between pb-2 border-b border-slate-200/60 dark:border-slate-700/60">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Identified Medical Specialty
                </span>
                <span className="text-xs font-mono font-extrabold px-2.5 py-1 rounded bg-teal-100 dark:bg-teal-950 text-teal-800 dark:text-teal-200 border border-teal-200 dark:border-teal-800">
                  {triageResult.specialty || 'Emergency Medicine'}
                </span>
              </div>

              <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed italic">
                {triageResult.analysis}
              </p>

              {/* Recommended Hospital */}
              {triageResult.hospitals && triageResult.hospitals.length > 0 ? (
                <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 space-y-2">
                  <div className="flex items-center justify-between">
                    <strong className="text-xs font-bold text-slate-900 dark:text-slate-100">
                      Recommended Destination: {triageResult.hospitals[0].name}
                    </strong>
                    <span className="text-xs font-mono font-bold text-teal-600">
                      {triageResult.hospitals[0].distanceKm} km away
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Available Verified Beds: {triageResult.hospitals[0].availableBeds} • Mapped Specialty Coverage Active
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      executeFinalDispatch('SOS', triageResult.hospitals[0].id, triageResult.recommendedTier)
                    }
                    className="w-full h-10 mt-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs uppercase tracking-wider transition-all shadow-md shadow-rose-600/20 active:scale-[0.99] flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <span>Dispatch Emergency Transport to {triageResult.hospitals[0].name}</span>
                  </button>
                </div>
              ) : (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  No verified partner hospital currently reporting open beds for this specialty within the pilot perimeter. Please use the 112 hotline.
                </p>
              )}

              <p className="text-[10px] text-slate-400 leading-tight">
                Disclaimer: LifeLink AI Symptom Router supports triage coordination based on emergency medicine guidelines. It is not a substitute for clinical diagnosis.
              </p>
            </div>
          )}
        </div>
      )}

      {/* 5.5 SUB-TAB 'TEST_WORKFLOW': CONTROLLED SOS CALL & LOCATION DELIVERY TEST */}
      {!activeTrip && sosSubTab === 'TEST_WORKFLOW' && (
        <div className="space-y-6 animate-in fade-in duration-300">
          {/* Header Card */}
          <div className="p-6 sm:p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xl shadow-slate-950/5">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-100 dark:border-slate-800">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="p-2 rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400">
                    <FlaskConical className="w-5 h-5" />
                  </div>
                  <span className="text-xs font-black uppercase tracking-wider text-amber-600 dark:text-amber-400">
                    Controlled Emergency Workflow Test
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-3xs font-extrabold uppercase tracking-wide bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
                    Sandbox Drill
                  </span>
                </div>
                <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-slate-100">
                  SOS Call & Location Delivery Verification
                </h2>
                <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
                  Run an end-to-end controlled emergency workflow test with designated test contact{' '}
                  <strong className="text-slate-800 dark:text-slate-200">{EMERGENCY_TEST_NAME} ({EMERGENCY_TEST_PHONE})</strong>.
                  Verifies GPS capture, persistent Supabase recording, dialer linking, and carrier delivery without notifying real hospital ERs or ambulance fleets.
                </p>
              </div>

              {testRequestId && (
                <button
                  type="button"
                  onClick={handleResetTestDrill}
                  className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-300 transition-colors cursor-pointer flex items-center gap-2 shrink-0 self-start md:self-center"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Start New Drill</span>
                </button>
              )}
            </div>

            {/* Test Contact & Safety Badges */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-6">
              <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/60">
                <span className="text-3xs font-bold text-slate-400 uppercase tracking-wider block">Designated Test Contact</span>
                <span className="text-sm font-extrabold text-slate-900 dark:text-slate-100 flex items-center gap-1.5 mt-0.5">
                  <Phone className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                  {EMERGENCY_TEST_PHONE}
                </span>
                <span className="text-3xs text-slate-500 dark:text-slate-400 font-mono mt-0.5 block">
                  Config: {EMERGENCY_TEST_NAME} (Isolated)
                </span>
              </div>

              <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/60">
                <span className="text-3xs font-bold text-slate-400 uppercase tracking-wider block">Carrier Provider Status</span>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className={`w-2 h-2 rounded-full ${testConfig?.carrier?.isConfigured ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
                  <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    {testConfig?.carrier?.isConfigured ? 'Twilio Live Carrier' : 'No Carrier (Local Mode)'}
                  </span>
                </div>
                <span className="text-3xs text-slate-500 dark:text-slate-400 mt-0.5 block">
                  {testConfig?.carrier?.isConfigured ? 'Live SMS delivery enabled' : 'Automatic SMS disabled. Device SIM fallback ready.'}
                </span>
              </div>

              <div className="p-3.5 rounded-2xl bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200/80 dark:border-rose-900/50">
                <span className="text-3xs font-bold text-rose-600 dark:text-rose-400 uppercase tracking-wider block">Emergency Safeguard</span>
                <div className="flex items-center justify-between mt-0.5">
                  <span className="text-xs font-extrabold text-rose-700 dark:text-rose-300">
                    Real Emergency? Dial 112
                  </span>
                  <a
                    href="tel:112"
                    className="px-2 py-0.5 rounded-lg bg-rose-600 text-white font-mono text-xs font-black shadow-xs hover:bg-rose-700 transition-colors"
                  >
                    112
                  </a>
                </div>
                <span className="text-3xs text-rose-600/80 dark:text-rose-400/80 mt-0.5 block">
                  Never use test mode during genuine life-threatening events.
                </span>
              </div>
            </div>

            {/* Error or Notice Alert */}
            {testError && (
              <div className="mt-4 p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 flex items-start gap-2.5 text-xs text-rose-700 dark:text-rose-300">
                <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                <div>
                  <strong className="block font-bold">Action Notice:</strong>
                  {testError}
                </div>
              </div>
            )}
            {testSuccessNotice && (
              <div className="mt-4 p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 flex items-start gap-2.5 text-xs text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                <div className="font-semibold">{testSuccessNotice}</div>
              </div>
            )}
          </div>

          {/* 4-Step Interactive Testing Pipeline */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {/* STEP 1: GPS PERMISSION & LOCATION CAPTURE */}
            <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xl shadow-slate-950/5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-black flex items-center justify-center">
                    1
                  </span>
                  <h3 className="font-bold text-sm sm:text-base text-slate-900 dark:text-slate-100">
                    GPS Coordinates & Permission
                  </h3>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-3xs font-extrabold uppercase ${
                  geoPermission === 'GRANTED'
                    ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300'
                    : geoPermission === 'DENIED'
                    ? 'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300'
                    : 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300'
                }`}>
                  Permission: {geoPermission}
                </span>
              </div>

              <p className="text-xs text-slate-500 dark:text-slate-400">
                Captures high-accuracy device coordinates via browser Geolocation API with explicit patient consent.
              </p>

              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400 font-semibold">Captured Latitude:</span>
                  <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{lat ? lat.toFixed(5) : '—'}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400 font-semibold">Captured Longitude:</span>
                  <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{lng ? lng.toFixed(5) : '—'}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400 font-semibold">Detected Zone:</span>
                  <span className="font-semibold text-slate-700 dark:text-slate-300 truncate max-w-[200px]">
                    {addressQuery || 'Nagpur Pilot Zone, Maharashtra'}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={onDetectLocation}
                  disabled={locLoading}
                  className="px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${locLoading ? 'animate-spin text-teal-600' : ''}`} />
                  <span>{locLoading ? 'Locating...' : 'Refresh GPS'}</span>
                </button>

                <a
                  href={`https://maps.google.com/?q=${lat},${lng}`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold transition-colors flex items-center gap-1.5 ml-auto"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Preview in Maps</span>
                </a>
              </div>
            </div>

            {/* STEP 2: INITIATE TEST SOS & PREPARE PAYLOAD */}
            <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xl shadow-slate-950/5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-black flex items-center justify-center">
                    2
                  </span>
                  <h3 className="font-bold text-sm sm:text-base text-slate-900 dark:text-slate-100">
                    Create Test Emergency Record
                  </h3>
                </div>
                {testEmergencyId ? (
                  <span className="px-2 py-0.5 rounded-full text-3xs font-extrabold uppercase bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    <span>{testEmergencyId}</span>
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full text-3xs font-extrabold uppercase bg-slate-100 dark:bg-slate-800 text-slate-500">
                    Not Initiated
                  </span>
                )}
              </div>

              <p className="text-xs text-slate-500 dark:text-slate-400">
                Creates a persistent EmergencyRequest in Supabase PostgreSQL (flagged with <code className="font-mono text-3xs bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded">isDemo: true</code>) and generates a standardized notification payload.
              </p>

              {!testEmergencyId ? (
                <button
                  type="button"
                  onClick={handleInitiateTestSos}
                  disabled={testLoading}
                  className="w-full py-3.5 rounded-2xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs sm:text-sm shadow-md shadow-amber-600/30 transition-all cursor-pointer flex items-center justify-center gap-2"
                >
                  {testLoading ? (
                    <>
                      <HeartbeatLoader size="small" strokeColor="#ffffff" />
                      <span>Creating Persistent Test Record...</span>
                    </>
                  ) : (
                    <>
                      <FlaskConical className="w-4 h-4" />
                      <span>Initiate Controlled Test SOS</span>
                    </>
                  )}
                </button>
              ) : (
                <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400 font-semibold">Emergency Test ID:</span>
                    <span className="font-mono font-black text-amber-600 dark:text-amber-400">{testEmergencyId}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400 font-semibold">Database Persistence:</span>
                    <span className="font-bold text-emerald-600 dark:text-emerald-400 text-3xs uppercase">
                      ✓ Supabase PostgreSQL Verified
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400 font-semibold">Driver Dispatch Status:</span>
                    <span className="font-bold text-slate-600 dark:text-slate-300 text-3xs uppercase">
                      Isolated (0 real dispatches)
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* STEP 3: CALLING TEST CONTACT ACTION */}
            <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xl shadow-slate-950/5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-black flex items-center justify-center">
                    3
                  </span>
                  <h3 className="font-bold text-sm sm:text-base text-slate-900 dark:text-slate-100">
                    Call Test Contact Action
                  </h3>
                </div>
                {testCallResult ? (
                  <span className="px-2 py-0.5 rounded-full text-3xs font-extrabold uppercase bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300">
                    Dialer Triggered
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full text-3xs font-extrabold uppercase bg-slate-100 dark:bg-slate-800 text-slate-500">
                    Ready to Dial
                  </span>
                )}
              </div>

              <p className="text-xs text-slate-500 dark:text-slate-400">
                Launches device phone dialer with <strong className="text-slate-800 dark:text-slate-200">{EMERGENCY_TEST_PHONE}</strong> via the <code className="font-mono text-3xs bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded">tel:</code> protocol.
              </p>

              <div className="p-3.5 rounded-2xl bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200/60 dark:border-blue-900/40 text-xs text-blue-900 dark:text-blue-200 space-y-1">
                <div className="font-bold flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                  <span>Browser Limitation Notice</span>
                </div>
                <p className="text-2xs text-blue-800/80 dark:text-blue-300/80 leading-relaxed">
                  Web security prevents browsers from detecting physical call completion or duration. Clicking below logs a verified <strong className="font-mono">DIALER_LAUNCHED</strong> audit event without false claims.
                </p>
              </div>

              <a
                href={`tel:${EMERGENCY_TEST_PHONE}`}
                onClick={handleCallTestContact}
                className={`w-full py-3.5 rounded-2xl text-white font-bold text-xs sm:text-sm shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer ${
                  testRequestId
                    ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/30'
                    : 'bg-slate-300 dark:bg-slate-700 cursor-not-allowed pointer-events-none opacity-60'
                }`}
              >
                <PhoneCall className="w-4 h-4" />
                <span>Call {EMERGENCY_TEST_NAME} ({EMERGENCY_TEST_PHONE})</span>
              </a>

              {testCallResult && (
                <div className="text-2xs text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                  <Check className="w-3.5 h-3.5" />
                  <span>Dialer trigger logged in database audit trail at {new Date(testCallResult.timestamp).toLocaleTimeString()}</span>
                </div>
              )}
            </div>

            {/* STEP 4: SEND TEST LOCATION ACTION */}
            <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xl shadow-slate-950/5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-black flex items-center justify-center">
                    4
                  </span>
                  <h3 className="font-bold text-sm sm:text-base text-slate-900 dark:text-slate-100">
                    Send Test Location Notification
                  </h3>
                </div>
                {testDeliveryResult ? (
                  <span className={`px-2 py-0.5 rounded-full text-3xs font-extrabold uppercase ${
                    testDeliveryResult.success
                      ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300'
                      : 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300'
                  }`}>
                    {testDeliveryResult.success ? 'Carrier Delivered' : 'Carrier Unavailable'}
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full text-3xs font-extrabold uppercase bg-slate-100 dark:bg-slate-800 text-slate-500">
                    Confirmation Required
                  </span>
                )}
              </div>

              {/* Exact Location & Recipient Preview before sending */}
              <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 space-y-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 font-semibold">Target Recipient:</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200">{EMERGENCY_TEST_NAME} ({EMERGENCY_TEST_PHONE})</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 font-semibold">Exact Coordinates:</span>
                  <span className="font-mono text-slate-700 dark:text-slate-300">{lat.toFixed(5)}, {lng.toFixed(5)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 font-semibold">Google Maps URL:</span>
                  <a
                    href={`https://maps.google.com/?q=${lat},${lng}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-teal-600 dark:text-teal-400 hover:underline truncate max-w-[200px]"
                  >
                    https://maps.google.com/?q={lat.toFixed(4)},{lng.toFixed(4)}
                  </a>
                </div>
              </div>

              {/* Explicit User Confirmation Checkbox */}
              <label className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/70 dark:border-amber-900/40 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={testUserConfirmed}
                  onChange={(e) => setTestUserConfirmed(e.target.checked)}
                  className="mt-0.5 rounded text-amber-600 focus:ring-amber-500 w-4 h-4"
                />
                <span className="text-xs text-slate-700 dark:text-slate-300 font-medium">
                  I explicitly confirm sending this emergency test location notification to <strong>{EMERGENCY_TEST_NAME} ({EMERGENCY_TEST_PHONE})</strong>.
                </span>
              </label>

              {/* Send Button */}
              <button
                type="button"
                onClick={handleSendTestLocation}
                disabled={!testRequestId || !testUserConfirmed || testDeliveryLoading}
                className={`w-full py-3.5 rounded-2xl text-white font-bold text-xs sm:text-sm shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer ${
                  testRequestId && testUserConfirmed && !testDeliveryLoading
                    ? 'bg-blue-600 hover:bg-blue-700 shadow-blue-600/30'
                    : 'bg-slate-300 dark:bg-slate-700 cursor-not-allowed opacity-60'
                }`}
              >
                {testDeliveryLoading ? (
                  <>
                    <HeartbeatLoader size="small" strokeColor="#ffffff" />
                    <span>Attempting Carrier Delivery...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    <span>Send Test Location via Carrier</span>
                  </>
                )}
              </button>

              {/* Carrier Delivery Feedback & Mobile Deep Links */}
              {testDeliveryResult && (
                <div className="space-y-3 pt-2">
                  {!testDeliveryResult.success && (
                    <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-xs text-amber-800 dark:text-amber-200 space-y-2">
                      <div className="font-bold flex items-center gap-1.5">
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                        <span>Automated Carrier Delivery Unavailable</span>
                      </div>
                      <p className="text-2xs text-amber-800/80 dark:text-amber-300/80 leading-relaxed">
                        No live Twilio credentials configured in backend. Per safety specifications, successful delivery is <strong className="underline">never simulated</strong>. You can dispatch directly using your phone&apos;s native SIM card or WhatsApp below:
                      </p>

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        {testDeliveryResult.directLinks?.sms && (
                          <a
                            href={testDeliveryResult.directLinks.sms}
                            className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-2xs transition-colors flex items-center gap-1 shadow-xs"
                          >
                            <MessageSquare className="w-3 h-3" />
                            <span>Open Device SMS App</span>
                          </a>
                        )}
                        {testDeliveryResult.directLinks?.whatsapp && (
                          <a
                            href={testDeliveryResult.directLinks.whatsapp}
                            target="_blank"
                            rel="noreferrer"
                            className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-2xs transition-colors flex items-center gap-1 shadow-xs"
                          >
                            <ExternalLink className="w-3 h-3" />
                            <span>Open in WhatsApp</span>
                          </a>
                        )}
                      </div>
                    </div>
                  )}

                  {testDeliveryResult.success && (
                    <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-xs text-emerald-800 dark:text-emerald-200">
                      <div className="font-bold flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        <span>Carrier Dispatched Successfully</span>
                      </div>
                      <p className="text-2xs text-emerald-700/80 dark:text-emerald-300/80 mt-1">
                        Twilio SID: <span className="font-mono">{testDeliveryResult.messageId || 'Active'}</span>
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* STEP 5: TEST NOTIFICATION PAYLOAD & RESULTS AUDIT CARD */}
          {testEmergencyId && (
            <div className="p-6 sm:p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xl shadow-slate-950/5 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
                <div>
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                    <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">
                      Controlled Test Audit Report & Delivery Results
                    </h3>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Real-time verification log persisted in database for Emergency ID <strong className="font-mono text-slate-700 dark:text-slate-300">{testEmergencyId}</strong>
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => testRequestId && fetchTestAudit(testRequestId)}
                  disabled={testAuditLoading}
                  className="px-3.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-300 transition-colors cursor-pointer flex items-center gap-1.5 self-start sm:self-auto"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${testAuditLoading ? 'animate-spin text-teal-600' : ''}`} />
                  <span>Refresh Audit Log</span>
                </button>
              </div>

              {/* Standardized Emergency Notification Payload Preview */}
              {testNotificationPayload && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                      Standardized Notification Payload
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(testNotificationPayload.messageBody);
                        setCopiedLink(true);
                        setTimeout(() => setCopiedLink(false), 2000);
                      }}
                      className="text-2xs font-semibold text-teal-600 dark:text-teal-400 hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      {copiedLink ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedLink ? 'Copied!' : 'Copy Text'}</span>
                    </button>
                  </div>

                  <div className="p-4 rounded-2xl bg-slate-900 text-slate-100 font-mono text-xs whitespace-pre-wrap leading-relaxed border border-slate-800 shadow-inner">
                    {testNotificationPayload.messageBody}
                  </div>
                </div>
              )}

              {/* 6 Core Verification Parameters */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* 1. SOS Request Created */}
                <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/60 space-y-1">
                  <span className="text-3xs font-bold text-slate-400 uppercase tracking-wider block">1. SOS Record Created</span>
                  <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Record Active (DB ID: {testRequestId?.substring(0, 8)}...)</span>
                  </div>
                  <span className="text-3xs text-slate-500 dark:text-slate-400 font-mono block">
                    Mode: isDemo=true (Isolated)
                  </span>
                </div>

                {/* 2. GPS Permission & Coordinates */}
                <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/60 space-y-1">
                  <span className="text-3xs font-bold text-slate-400 uppercase tracking-wider block">2. GPS Coordinates</span>
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-200">
                    <MapPin className="w-3.5 h-3.5 text-rose-500" />
                    <span>{lat.toFixed(5)}, {lng.toFixed(5)}</span>
                  </div>
                  <span className="text-3xs text-slate-500 dark:text-slate-400 block truncate">
                    Permission: {geoPermission}
                  </span>
                </div>

                {/* 3. Emergency Notification Prepared */}
                <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/60 space-y-1">
                  <span className="text-3xs font-bold text-slate-400 uppercase tracking-wider block">3. Notification Prepared</span>
                  <div className="flex items-center gap-1.5 text-xs font-bold text-teal-600 dark:text-teal-400">
                    <Check className="w-3.5 h-3.5" />
                    <span>Google Maps Link Embedded</span>
                  </div>
                  <span className="text-3xs text-slate-500 dark:text-slate-400 block truncate">
                    Designation: [TEST MODE]
                  </span>
                </div>

                {/* 4. Notification Delivery Status */}
                <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/60 space-y-1">
                  <span className="text-3xs font-bold text-slate-400 uppercase tracking-wider block">4. Delivery Status</span>
                  {testDeliveryResult ? (
                    <div className="flex items-center gap-1.5 text-xs font-bold">
                      {testDeliveryResult.success ? (
                        <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Live Carrier Delivered
                        </span>
                      ) : (
                        <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1">
                          <AlertTriangle className="w-3.5 h-3.5" /> Carrier Unavailable (No Fake Mock)
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-slate-400 font-semibold">Not Sent Yet</span>
                  )}
                  <span className="text-3xs text-slate-500 dark:text-slate-400 block truncate">
                    SIM/WhatsApp fallback links active
                  </span>
                </div>

                {/* 5. Call Action Initiated */}
                <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/60 space-y-1">
                  <span className="text-3xs font-bold text-slate-400 uppercase tracking-wider block">5. Call Action Initiated</span>
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-200">
                    <PhoneForwarded className="w-3.5 h-3.5 text-emerald-600" />
                    <span>{testCallResult ? 'DIALER_LAUNCHED' : 'Awaiting Click'}</span>
                  </div>
                  <span className="text-3xs text-slate-500 dark:text-slate-400 block truncate">
                    {testCallResult ? 'Trigger recorded in audit event' : `Target: ${EMERGENCY_TEST_PHONE}`}
                  </span>
                </div>

                {/* 6. Safety Safeguards */}
                <div className="p-4 rounded-2xl bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-200/70 dark:border-emerald-800/60 space-y-1">
                  <span className="text-3xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider block">6. Safety Isolation</span>
                  <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 dark:text-emerald-300">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>Zero Real Ambulances Dispatched</span>
                  </div>
                  <span className="text-3xs text-emerald-600/80 dark:text-emerald-400/80 block">
                    Permanent 112 hotline intact
                  </span>
                </div>
              </div>

              {/* Chronological Audit Event Trail */}
              {testAuditResults?.timeline && testAuditResults.timeline.length > 0 && (
                <div className="pt-2">
                  <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-3">
                    Database Event Trail (Supabase PostgreSQL EmergencyEvent Table)
                  </h4>
                  <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200/60 dark:border-slate-800 rounded-2xl overflow-hidden">
                    {testAuditResults.timeline.map((item: any, idx: number) => (
                      <div key={idx} className="p-3 bg-slate-50/50 dark:bg-slate-800/40 flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-3xs font-bold px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                            {item.eventType}
                          </span>
                          <span className="text-slate-600 dark:text-slate-400 font-medium">
                            State: <strong className="text-slate-800 dark:text-slate-200">{item.newState || 'LOGGED'}</strong>
                          </span>
                        </div>
                        <span className="font-mono text-3xs text-slate-400">
                          {new Date(item.timestamp).toLocaleTimeString()} IST
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 6. SUB-TAB 'RADAR' OR BOTTOM EMERGENCY NETWORK RADAR SECTION */}
      {(!activeTrip && sosSubTab !== 'TEST_WORKFLOW' || sosSubTab === 'RADAR') && (
        <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xl shadow-slate-950/5 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
            <div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                <h3 className="font-extrabold text-sm sm:text-base text-slate-900 dark:text-slate-100">
                  Verified Hospital Network & Ambulance Radar
                </h3>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Real-time OpenStreetMap grid of certified trauma centers and active ambulance rigs.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsMapExpanded(!isMapExpanded)}
                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                {isMapExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                <span>{isMapExpanded ? 'Collapse Map' : 'Expand Map'}</span>
              </button>
            </div>
          </div>

          {/* Interactive Leaflet Map Container */}
          <div ref={mapContainerRef} className={`w-full rounded-2xl overflow-hidden border border-slate-200/90 dark:border-slate-800 shadow-inner transition-all duration-300 ${isMapExpanded ? 'h-[500px]' : 'h-80 sm:h-96'}`}>
            <LeafletMap
              patientLoc={[lat, lng]}
              hospitals={nearbyHospitals}
              ambulances={nearbyAmbulances}
              ambulanceProviders={ambulanceProviders}
              selectedHospitalId={selectedHospital?.id}
              selectedAmbulanceProviderId={selectedAmbulanceProviderId || undefined}
              onSelectHospital={handleSelectFromMap}
              onSelectAmbulanceProvider={handleSelectAmbulanceFromMap}
              onMapClick={(coords) => onSetCoords(coords.lat, coords.lng)}
              zoom={13}
            />
          </div>

          {/* Facilities and Ambulance Stations List below map */}
          <div className="pt-2">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-3">
              {/* Category Tab Switch */}
              <div className="flex items-center gap-1.5 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200/80 dark:border-slate-700/80">
                <button
                  type="button"
                  onClick={() => setFacilityViewTab('HOSPITALS')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                    facilityViewTab === 'HOSPITALS'
                      ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-300 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  <Building2 className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Verified Hospitals ({nearbyHospitals.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setFacilityViewTab('AMBULANCE_DESKS')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                    facilityViewTab === 'AMBULANCE_DESKS'
                      ? 'bg-white dark:bg-slate-900 text-purple-700 dark:text-purple-300 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  <Ambulance className="w-3.5 h-3.5 text-purple-600" />
                  <span>Ambulance Stations ({ambulanceProviders.length})</span>
                </button>
              </div>

              <span className="text-[10px] text-slate-400 font-mono">
                Click any card to focus map at Zoom 16 street view
              </span>
            </div>

            {/* TAB CONTENT: HOSPITALS */}
            {facilityViewTab === 'HOSPITALS' && (
              <>
                {loadingHospitals ? (
                  <div className="py-8 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
                    <HeartbeatLoader size="small" />
                    <span>Scanning verified hospital directory...</span>
                  </div>
                ) : nearbyHospitals.length === 0 ? (
                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 text-center text-xs text-slate-400">
                    No hospitals detected within 35 km of current pin. Click anywhere on the map to set a new location.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-72 overflow-y-auto pr-1">
                    {nearbyHospitals.map((h: any) => {
                      const isSelected = selectedHospital?.id === h.id;
                      const isPartner = h.isLifeLinkPartner !== false;
                      const hasValidCoords =
                        typeof h.lat === 'number' &&
                        typeof h.lng === 'number' &&
                        !isNaN(h.lat) &&
                        !isNaN(h.lng) &&
                        h.lat !== 0 &&
                        h.lng !== 0;

                      const straightLineDist =
                        hasValidCoords && typeof lat === 'number' && typeof lng === 'number'
                          ? calculateHaversineDistanceKm(lat, lng, h.lat, h.lng)
                          : null;

                      return (
                        <div
                          id={`sos-hospital-${h.id}`}
                          key={h.id}
                          onClick={() => handleSelectHospital(h.id)}
                          className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between ${
                            isSelected
                              ? 'border-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/30 ring-2 ring-emerald-500/20 shadow-md'
                              : 'border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 hover:border-slate-300 dark:hover:border-slate-700'
                          }`}
                        >
                          <div>
                            {isSelected && (
                              <div className="mb-2 bg-emerald-600 text-white text-4xs font-black uppercase tracking-wider px-2 py-0.5 rounded-md flex items-center gap-1 w-fit">
                                <MapPin className="w-2.5 h-2.5" />
                                <span>Selected • Zoom 16</span>
                              </div>
                            )}
                            <div className="flex items-start justify-between gap-1 mb-1">
                              <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 line-clamp-1">
                                {h.name}
                              </h4>
                            </div>
                            <p className="text-[10px] text-slate-500 dark:text-slate-400 line-clamp-1 mb-1.5">
                              {h.address || h.locality}
                            </p>
                            <div className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 mb-2">
                              {straightLineDist !== null
                                ? `Straight-line: ${straightLineDist} km from your pin`
                                : 'Distance unavailable'}
                            </div>
                          </div>

                          <div className="flex items-center justify-between pt-2 border-t border-slate-200/60 dark:border-slate-700/60 text-[10px]">
                            <span className={`font-semibold ${isPartner ? 'text-emerald-600 dark:text-emerald-400' : 'text-blue-600 dark:text-blue-400'}`}>
                              {isPartner ? `Beds: ${h.availableBeds ?? 'Available'}` : 'Directory Listed'}
                            </span>
                            {h.contactNumber && (
                              <a
                                href={`tel:${h.contactNumber}`}
                                onClick={(e) => e.stopPropagation()}
                                className="font-bold text-teal-600 dark:text-teal-400 hover:underline"
                              >
                                Call ER
                              </a>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            {/* TAB CONTENT: AMBULANCE DISPATCH DESKS */}
            {facilityViewTab === 'AMBULANCE_DESKS' && (
              <div className="space-y-3">
                {/* 108 MEMS Emergency Call Banner */}
                <div className="p-3.5 rounded-2xl bg-gradient-to-r from-red-600 to-rose-700 text-white shadow-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                      <PhoneCall className="w-5 h-5 text-white animate-pulse" />
                    </div>
                    <div>
                      <div className="text-xs font-black tracking-wide uppercase flex items-center gap-2">
                        <span>Free Government 108 Emergency Helpline</span>
                        <span className="text-[9px] bg-white text-red-700 font-extrabold px-1.5 py-0.5 rounded-md">24x7 TOLL FREE</span>
                      </div>
                      <p className="text-2xs text-red-100 mt-0.5">
                        Maharashtra Emergency Medical Services (MEMS) central control room dispatch across all 14 tehsils.
                      </p>
                    </div>
                  </div>
                  <a
                    href="tel:108"
                    className="px-4 py-2 rounded-xl bg-white text-red-700 hover:bg-red-50 text-xs font-black shadow-sm flex items-center gap-1.5 transition-all self-end sm:self-center shrink-0 cursor-pointer"
                  >
                    <Phone className="w-3.5 h-3.5" />
                    <span>Call 108 Now</span>
                  </a>
                </div>

                {loadingAmbulanceProviders ? (
                  <div className="py-8 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
                    <HeartbeatLoader size="small" />
                    <span>Loading verified ambulance dispatch desks...</span>
                  </div>
                ) : ambulanceProviders.length === 0 ? (
                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 text-center text-xs text-slate-400">
                    No verified ambulance providers loaded.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-72 overflow-y-auto pr-1">
                    {ambulanceProviders.map((amb) => {
                      const isSelected = selectedAmbulanceProviderId === amb.id;
                      const isHelpline = amb.isHelpline;

                      return (
                        <div
                          id={`sos-ambulance-${amb.id}`}
                          key={amb.id}
                          onClick={() => handleSelectAmbulanceCard(amb.id)}
                          className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between ${
                            isSelected
                              ? 'border-purple-500 bg-purple-50/40 dark:bg-purple-950/30 ring-2 ring-purple-500/20 shadow-md'
                              : 'border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 hover:border-slate-300 dark:hover:border-slate-700'
                          }`}
                        >
                          <div>
                            {isSelected && (
                              <div className="mb-2 bg-purple-600 text-white text-4xs font-black uppercase tracking-wider px-2 py-0.5 rounded-md flex items-center gap-1 w-fit">
                                <MapPin className="w-2.5 h-2.5" />
                                <span>Selected Station • Zoom 16</span>
                              </div>
                            )}
                            <div className="flex items-start justify-between gap-1 mb-1">
                              <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 line-clamp-1">
                                {amb.name}
                              </h4>
                            </div>
                            <div className="flex items-center gap-1.5 mb-1">
                              <span className={`text-4xs font-bold px-1.5 py-0.5 rounded ${
                                isHelpline
                                  ? 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300'
                                  : amb.operatorType === 'HOSPITAL_OPERATED'
                                  ? 'bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300'
                                  : amb.operatorType === 'NGO_CHARITABLE'
                                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                                  : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                              }`}>
                                {isHelpline ? 'Govt Helpline' : amb.operatorType === 'HOSPITAL_OPERATED' ? 'Hospital Fleet' : amb.operatorType === 'NGO_CHARITABLE' ? 'NGO / Charitable' : 'Private 24x7'}
                              </span>
                              <span className="text-3xs text-slate-400 truncate">
                                {amb.locality}
                              </span>
                            </div>
                            <p className="text-[10px] text-slate-500 dark:text-slate-400 line-clamp-1 mb-1">
                              {amb.address}
                            </p>
                            <div className="text-[10px] font-semibold text-purple-600 dark:text-purple-400 mb-2">
                              {amb.distanceLabel || 'Distance unavailable'}
                            </div>
                          </div>

                          <div className="flex items-center justify-between pt-2 border-t border-slate-200/60 dark:border-slate-700/60 text-[10px]">
                            <span className="font-semibold text-slate-500 dark:text-slate-400 truncate max-w-[120px]">
                              {amb.advertisedIcuOrVentilatorCapability ? '✓ ICU / Ventilator' : '✓ Basic Transport'}
                            </span>
                            <a
                              href={`tel:${amb.contactNumber}`}
                              onClick={(e) => e.stopPropagation()}
                              className="font-bold px-2 py-1 rounded-lg bg-purple-600 hover:bg-purple-700 text-white flex items-center gap-1 transition-all shadow-xs"
                            >
                              <Phone className="w-3 h-3" />
                              <span>Call {amb.contactNumber}</span>
                            </a>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default EmergencySosSection;

