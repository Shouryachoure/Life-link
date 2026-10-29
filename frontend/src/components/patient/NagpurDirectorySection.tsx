import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Building2,
  Ambulance,
  Phone,
  MapPin,
  MapPinOff,
  ExternalLink,
  Navigation,
  ShieldCheck,
  Search,
  CheckCircle2,
  RefreshCw,
  PhoneCall,
  ShieldAlert,
  HeartPulse,
  Activity,
  X,
  SlidersHorizontal,
  ChevronRight,
  Info,
  Send,
  AlertCircle,
  LocateFixed,
  Stethoscope,
  User,
  Award,
  Minimize2,
  Maximize2,
  Compass,
} from 'lucide-react';
import { formatIndianPhone, formatIndianDateTime } from '../../utils/localization';
import {
  formatServiceType,
  formatFacilityCategory,
  DATA_CONFIDENCE_LABELS,
} from '../../utils/directoryLabels';
import { LeafletMap, type HospitalMarkerItem, type AmbulanceProviderMarkerItem } from '../LeafletMap';
import { calculateHaversineDistanceKm, type RouteResult } from '../../utils/routingAdapter';

export interface DirectoryRecord {
  id: string;
  name: string;
  alternateNames?: string[];
  recordType: 'HOSPITAL' | 'AMBULANCE_PROVIDER' | 'OFFICIAL_EMERGENCY_HELPLINE';
  recordStatus: 'ACTIVE' | 'NEEDS_VERIFICATION' | 'INACTIVE' | 'DUPLICATE';
  category?: string;
  categoryLabel?: string;
  ownership?: string;
  contactNumber: string;
  rawContactNumber?: string;
  alternateNumber?: string;
  emergencyPhone?: string | null;
  ambulancePhone?: string | null;
  publicEmail?: string | null;
  specialties?: string[];
  emergencyServicesClaimed?: boolean;
  publicBusinessPhone?: string | null;
  alternatePublicPhone?: string | null;
  businessAddress?: string | null;
  serviceArea?: string | null;
  advertisedServiceTypes?: string[];
  humanServiceTypes?: string[];
  advertisedIcuOrVentilatorCapability?: boolean;
  clickToCallUrl?: string | null;
  address: string;
  locality?: string | null;
  tehsil?: string | null;
  coverageGroup?: 'NAGPUR_CITY' | 'NAGPUR_DISTRICT_RURAL' | string;
  pinCode?: string | null;
  city: string;
  district: string;
  state?: string;
  lat?: number | null;
  lng?: number | null;
  isGeocoded?: boolean;
  coordinateQuality?: string | null;
  directionsUrl?: string | null;
  website?: string | null;
  sourceUrl: string;
  sourceType: string;
  dataProvenance: string;
  dataConfidence?: 'GOVERNMENT_CONFIRMED' | 'OFFICIAL_PROVIDER_PUBLISHED' | 'DIRECTORY_LISTED' | 'CONTACT_CONFIRMED' | string;
  lastCheckedAt?: string | Date;
  verificationStatus: string;
  contactVerificationStatus: string;
  lastContactVerifiedAt?: string | Date | null;
  isLifeLinkPartner: boolean;
  linkStatus: string;
  onboardingStatus?: string;
  distanceKm?: number | null;
  isHospitalAffiliated?: boolean;
  linkedHospitalId?: string | null;
  linkedHospitalName?: string | null;
  hasDedicatedAmbulanceDesk?: boolean;
}

interface DirectoryMeta {
  total: number;
  returned: number;
  page: number;
  limit: number;
  totalPages: number;
  userLocationProvided: boolean;
  totalCatalogRecords: number;
  nagpurPilotZone: string;
}

interface NagpurDirectorySectionProps {
  apiFetch: (url: string, options?: RequestInit) => Promise<any>;
  userLat?: number;
  userLng?: number;
  geoPermission?: 'PROMPT' | 'GRANTED' | 'DENIED';
  locLoading?: boolean;
  onRequestLocation?: () => void;
  onDetectLocation?: () => void;
  onNavigateTab?: (tab: string) => void;
  onSelectHospitalForMap?: (hospitalId: string) => void;
}

const NAGPUR_LOCALITIES = [
  'All Localities',
  // Nagpur City Localities
  'Dhantoli',
  'Ramdaspeth',
  'Medical Square',
  'Dharampeth',
  'Mankapur',
  'Nandanvan',
  'Lakadganj',
  'Sadar',
  'Manewada',
  'Kamptee Road',
  'Central Avenue',
  'Sitabuldi',
  'Civil Lines',
  'MIHAN / Jamtha',
  'Hanuman Nagar',
  // Nagpur District Tehsils
  'Hingna',
  'Kamptee',
  'Katol',
  'Saoner',
  'Umred',
  'Ramtek',
  'Kalmeshwar',
  'Mouda',
  'Parseoni',
  'Kuhi',
  'Bhiwapur',
  'Narkhed',
];

export const NagpurDirectorySection: React.FC<NagpurDirectorySectionProps> = ({
  apiFetch,
  userLat,
  userLng,
  geoPermission = 'PROMPT',
  locLoading = false,
  onRequestLocation,
  onDetectLocation,
  onNavigateTab,
  onSelectHospitalForMap,
}) => {
  const [records, setRecords] = useState<DirectoryRecord[]>([]);
  const [meta, setMeta] = useState<DirectoryMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Map & Interactive Navigation States
  const [showMap, setShowMap] = useState<boolean>(true);
  const [isMapExpanded, setIsMapExpanded] = useState<boolean>(false);
  const [selectedHospitalId, setSelectedHospitalId] = useState<string | null>(null);
  const [selectedHospitalRoute, setSelectedHospitalRoute] = useState<RouteResult | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCoverageGroup, setSelectedCoverageGroup] = useState<'ALL' | 'NAGPUR_CITY' | 'NAGPUR_DISTRICT_RURAL'>('ALL');
  const [selectedCategory, setSelectedCategory] = useState<'ALL' | 'HOSPITAL' | 'CLINIC' | 'AMBULANCE_PROVIDER' | 'OFFICIAL_EMERGENCY_HELPLINE'>('ALL');
  const [selectedLocality, setSelectedLocality] = useState('All Localities');
  const [partnerOnly, setPartnerOnly] = useState(false);
  const [emergencyDeskOnly, setEmergencyDeskOnly] = useState(false);
  const [showFiltersPanel, setShowFiltersPanel] = useState(false);

  // Modal inspection & correction states
  const [inspectRecord, setInspectRecord] = useState<DirectoryRecord | null>(null);
  const [feedbackRecord, setFeedbackRecord] = useState<DirectoryRecord | null>(null);
  const [feedbackIssueType, setFeedbackIssueType] = useState('OUTDATED_PHONE');
  const [feedbackDescription, setFeedbackDescription] = useState('');
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackSuccess, setFeedbackSuccess] = useState(false);

  // Hospital Doctor Inspection in Modal
  const [modalTab, setModalTab] = useState<'OVERVIEW' | 'DOCTORS'>('OVERVIEW');
  const [modalDoctors, setModalDoctors] = useState<any[]>([]);
  const [loadingModalDoctors, setLoadingModalDoctors] = useState(false);
  const [modalDoctorSpecialties, setModalDoctorSpecialties] = useState<string[]>([]);
  const [modalDoctorSpecFilter, setModalDoctorSpecFilter] = useState('ALL');
  const [modalDoctorSearch, setModalDoctorSearch] = useState('');

  const loadHospitalDoctors = async (facilityId: string) => {
    setLoadingModalDoctors(true);
    try {
      const res = await apiFetch(`/hospitals/${facilityId}/doctors`);
      if (res && res.doctors) {
        setModalDoctors(res.doctors || []);
        setModalDoctorSpecialties(res.specialties || []);
      } else {
        setModalDoctors([]);
        setModalDoctorSpecialties([]);
      }
    } catch {
      setModalDoctors([]);
      setModalDoctorSpecialties([]);
    } finally {
      setLoadingModalDoctors(false);
    }
  };

  useEffect(() => {
    if (!inspectRecord) {
      setModalDoctors([]);
      setModalDoctorSpecialties([]);
      setModalDoctorSpecFilter('ALL');
      setModalDoctorSearch('');
      setModalTab('OVERVIEW');
      return;
    }
    if (inspectRecord.recordType !== 'AMBULANCE_PROVIDER' && inspectRecord.recordType !== 'OFFICIAL_EMERGENCY_HELPLINE') {
      loadHospitalDoctors(inspectRecord.id);
    }
  }, [inspectRecord]);

  const filteredModalDoctors = useMemo(() => {
    return modalDoctors.filter((doc) => {
      if (modalDoctorSpecFilter !== 'ALL') {
        const specLower = modalDoctorSpecFilter.toLowerCase();
        const prim = doc.specialization?.toLowerCase() || '';
        const list = Array.isArray(doc.specialtiesList) ? doc.specialtiesList.map((s: string) => s.toLowerCase()) : [];
        if (!prim.includes(specLower) && !list.some((s: string) => s.includes(specLower))) {
          return false;
        }
      }
      if (modalDoctorSearch.trim()) {
        const q = modalDoctorSearch.trim().toLowerCase();
        const matchesName = doc.name?.toLowerCase().includes(q);
        const matchesSpec = doc.specialization?.toLowerCase().includes(q);
        const matchesDesig = doc.designation?.toLowerCase().includes(q);
        const matchesReg = doc.registrationNumber?.toLowerCase().includes(q);
        const matchesQual = doc.qualifications?.toLowerCase().includes(q);
        return matchesName || matchesSpec || matchesDesig || matchesReg || matchesQual;
      }
      return true;
    });
  }, [modalDoctors, modalDoctorSpecFilter, modalDoctorSearch]);

  const isLocationGranted = geoPermission === 'GRANTED' && typeof userLat === 'number' && typeof userLng === 'number';

  const fetchDirectory = async () => {
    setLoading(true);
    setError(null);
    try {
      let url = `/directory/unified?type=${selectedCategory}&city=Nagpur&limit=100`;

      // Pass user location ONLY if actually permitted by browser
      if (isLocationGranted && userLat && userLng) {
        url += `&lat=${userLat}&lng=${userLng}`;
      }

      if (searchQuery.trim()) {
        url += `&search=${encodeURIComponent(searchQuery.trim())}`;
      }
      if (selectedLocality !== 'All Localities') {
        url += `&locality=${encodeURIComponent(selectedLocality)}`;
      }
      if (selectedCoverageGroup !== 'ALL') {
        url += `&coverageGroup=${encodeURIComponent(selectedCoverageGroup)}`;
      }

      const res = await apiFetch(url);
      if (res.success) {
        setRecords(res.data || []);
        setMeta(res.meta || null);
      } else {
        setError(res.message || 'Failed to load healthcare directory.');
      }
    } catch (err: any) {
      console.error('Failed to load healthcare directory:', err);
      setError(err?.message || 'Network error while querying healthcare directory.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDirectory();
  }, [selectedCategory, selectedCoverageGroup, selectedLocality, isLocationGranted, userLat, userLng]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchDirectory();
  };

  // Client-side filter refinements (partnerOnly, emergencyDeskOnly)
  const filteredRecords = useMemo(() => {
    return records.filter((r) => {
      if (partnerOnly && !r.isLifeLinkPartner) return false;
      if (emergencyDeskOnly && !r.emergencyServicesClaimed && !r.emergencyPhone) return false;
      return true;
    });
  }, [records, partnerOnly, emergencyDeskOnly]);

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (selectedCoverageGroup !== 'ALL') count++;
    if (selectedCategory !== 'ALL') count++;
    if (selectedLocality !== 'All Localities') count++;
    if (partnerOnly) count++;
    if (emergencyDeskOnly) count++;
    if (searchQuery.trim()) count++;
    return count;
  }, [selectedCoverageGroup, selectedCategory, selectedLocality, partnerOnly, emergencyDeskOnly, searchQuery]);

  const resetAllFilters = () => {
    setSearchQuery('');
    setSelectedCoverageGroup('ALL');
    setSelectedCategory('ALL');
    setSelectedLocality('All Localities');
    setPartnerOnly(false);
    setEmergencyDeskOnly(false);
    setSelectedHospitalId(null);
    setSelectedAmbulanceProviderId(null);
    setSelectedHospitalRoute(null);
  };

  const [selectedAmbulanceProviderId, setSelectedAmbulanceProviderId] = useState<string | null>(null);

  // Convert filtered hospital records into HospitalMarkerItem[] for LeafletMap
  const mapHospitals: HospitalMarkerItem[] = useMemo(() => {
    return filteredRecords
      .filter(
        (r) =>
          r.recordType === 'HOSPITAL' &&
          typeof r.lat === 'number' &&
          typeof r.lng === 'number' &&
          !isNaN(r.lat) &&
          !isNaN(r.lng) &&
          r.lat !== 0 &&
          r.lng !== 0
      )
      .map((r) => {
        let distLabel = 'Distance unavailable';
        if (
          isLocationGranted &&
          typeof userLat === 'number' &&
          typeof userLng === 'number' &&
          r.lat &&
          r.lng
        ) {
          const d = calculateHaversineDistanceKm(userLat, userLng, r.lat, r.lng);
          distLabel = `Straight-line: ${d} km`;
        }

        return {
          id: r.id,
          name: r.name,
          lat: r.lat!,
          lng: r.lng!,
          isLifeLinkPartner: r.isLifeLinkPartner,
          contactNumber: r.emergencyPhone || r.contactNumber,
          distanceLabel: distLabel,
          address: r.address,
        };
      });
  }, [filteredRecords, isLocationGranted, userLat, userLng]);

  // Convert filtered ambulance provider records into AmbulanceProviderMarkerItem[] for LeafletMap
  const mapAmbulanceProviders: AmbulanceProviderMarkerItem[] = useMemo(() => {
    return filteredRecords
      .filter(
        (r) =>
          r.recordType === 'AMBULANCE_PROVIDER' &&
          typeof r.lat === 'number' &&
          typeof r.lng === 'number' &&
          !isNaN(r.lat) &&
          !isNaN(r.lng) &&
          r.lat !== 0 &&
          r.lng !== 0
      )
      .map((r) => {
        let distLabel = 'Distance unavailable';
        if (
          isLocationGranted &&
          typeof userLat === 'number' &&
          typeof userLng === 'number' &&
          r.lat &&
          r.lng
        ) {
          const d = calculateHaversineDistanceKm(userLat, userLng, r.lat, r.lng);
          distLabel = `Straight-line: ${d} km`;
        }

        return {
          id: r.id,
          name: r.name,
          operatorType: r.category || 'PRIVATE_OPERATOR',
          operatorTypeLabel: r.categoryLabel,
          contactNumber: r.publicBusinessPhone || r.contactNumber,
          alternateNumber: r.alternatePublicPhone || r.alternateNumber,
          address: r.businessAddress || r.address,
          locality: r.locality || 'Nagpur',
          tehsil: r.tehsil || 'Nagpur Urban',
          lat: r.lat!,
          lng: r.lng!,
          distanceKm: r.distanceKm,
          distanceLabel: distLabel,
          advertisedServiceTypes: r.advertisedServiceTypes,
          advertisedIcuOrVentilatorCapability: r.advertisedIcuOrVentilatorCapability,
          dataConfidence: r.dataConfidence,
          isHelpline: false,
          isHospitalAffiliated: r.isHospitalAffiliated,
          linkedHospitalName: r.linkedHospitalName || undefined,
          coverageGroup: r.coverageGroup,
        };
      });
  }, [filteredRecords, isLocationGranted, userLat, userLng]);

  const selectedHospital = useMemo(() => {
    if (!selectedHospitalId && !selectedAmbulanceProviderId) return null;
    const targetId = selectedHospitalId || selectedAmbulanceProviderId;
    return filteredRecords.find((r) => r.id === targetId) || null;
  }, [selectedHospitalId, selectedAmbulanceProviderId, filteredRecords]);

  // Handle selecting a facility/ambulance card click or "View on Map" action
  const handleSelectHospital = (item: DirectoryRecord) => {
    const hasValidCoords =
      typeof item.lat === 'number' &&
      typeof item.lng === 'number' &&
      !isNaN(item.lat) &&
      !isNaN(item.lng) &&
      item.lat !== 0 &&
      item.lng !== 0;

    if (!hasValidCoords) {
      // Missing coordinates: Do not zoom to (0,0) or center of Nagpur!
      setInspectRecord(item);
      return;
    }

    // 1. Reveal map if hidden
    if (!showMap) {
      setShowMap(true);
    }

    // 2. Set selected ID based on record type
    if (item.recordType === 'AMBULANCE_PROVIDER') {
      setSelectedAmbulanceProviderId(item.id);
      setSelectedHospitalId(null);
    } else {
      setSelectedHospitalId(item.id);
      setSelectedAmbulanceProviderId(null);
    }

    // 3. Smoothly scroll map container into view
    setTimeout(() => {
      mapContainerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);
  };

  // Handle selecting a hospital from Leaflet map marker click
  const handleSelectHospitalFromMap = (hospitalId: string) => {
    setSelectedHospitalId(hospitalId);
    setSelectedAmbulanceProviderId(null);

    // Smoothly scroll corresponding card into view
    setTimeout(() => {
      const cardEl = document.getElementById(`dir-card-${hospitalId}`);
      if (cardEl) {
        cardEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }, 120);
  };

  // Handle selecting an ambulance provider from Leaflet map marker click
  const handleSelectAmbulanceProviderFromMap = (providerId: string) => {
    setSelectedAmbulanceProviderId(providerId);
    setSelectedHospitalId(null);

    // Smoothly scroll corresponding card into view
    setTimeout(() => {
      const cardEl = document.getElementById(`dir-card-${providerId}`);
      if (cardEl) {
        cardEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }, 120);
  };

  const handleSubmitFeedback = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!feedbackRecord || !feedbackDescription.trim()) return;
    setFeedbackSubmitting(true);
    try {
      await apiFetch('/directory/feedback', {
        method: 'POST',
        body: JSON.stringify({
          entityType: feedbackRecord.recordType === 'HOSPITAL' ? 'FACILITY' : 'AMBULANCE_SERVICE',
          entityId: feedbackRecord.id,
          issueType: feedbackIssueType,
          description: feedbackDescription.trim(),
        }),
      });
      setFeedbackSuccess(true);
      setTimeout(() => {
        setFeedbackSuccess(false);
        setFeedbackRecord(null);
        setFeedbackDescription('');
      }, 2000);
    } catch (err) {
      console.error('Feedback submission error:', err);
      alert('Failed to submit correction report. Please try again.');
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* 1. SEARCH HEADER & PROMINENT SEARCH FIELD */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-3xl p-6 sm:p-8 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-100 dark:border-slate-800">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              <span className="text-[11px] font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
                Nagpur Healthcare Directory
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
              Find Healthcare Near You
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
              Explore hospitals and emergency services in your area.
            </p>
          </div>

          {/* Location Status Pill with Permission & Refresh Controls */}
          <div className="flex items-center gap-2">
            {locLoading ? (
              <div className="px-3.5 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-emerald-600 animate-spin shrink-0" />
                <span className="text-2xs font-bold text-slate-600 dark:text-slate-300">
                  Acquiring GPS fix...
                </span>
              </div>
            ) : isLocationGranted ? (
              <div className="px-3.5 py-2 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 flex items-center gap-2.5">
                <LocateFixed className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <div className="text-left">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300 block">
                    GPS Active
                  </span>
                  <span className="text-2xs text-emerald-600 dark:text-emerald-400 font-mono">
                    {userLat?.toFixed(4)}, {userLng?.toFixed(4)}
                  </span>
                </div>
                {(onRequestLocation || onDetectLocation) && (
                  <button
                    type="button"
                    onClick={onRequestLocation || onDetectLocation}
                    className="p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 transition-colors cursor-pointer text-3xs font-bold"
                    title="Refresh current location"
                  >
                    <RefreshCw className="w-3 h-3" />
                  </button>
                )}
              </div>
            ) : geoPermission === 'DENIED' ? (
              <div className="px-3.5 py-2 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 flex items-center gap-2.5">
                <MapPinOff className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                <div className="text-left">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300 block">
                    Location Denied
                  </span>
                  <span className="text-2xs text-amber-700 dark:text-amber-400">
                    Locality filter mode
                  </span>
                </div>
                {(onRequestLocation || onDetectLocation) && (
                  <button
                    type="button"
                    onClick={onRequestLocation || onDetectLocation}
                    className="px-2 py-1 text-3xs font-bold rounded-lg bg-amber-600 hover:bg-amber-700 text-white transition-colors cursor-pointer"
                  >
                    Retry
                  </button>
                )}
              </div>
            ) : (
              <div className="px-3.5 py-2 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 flex items-center justify-between gap-3">
                <div className="text-left">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 block">
                    District View
                  </span>
                  <span className="text-2xs text-slate-500 dark:text-slate-400">
                    Locality mode
                  </span>
                </div>
                {(onRequestLocation || onDetectLocation) && (
                  <button
                    type="button"
                    onClick={onRequestLocation || onDetectLocation}
                    className="px-2.5 py-1 text-3xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors cursor-pointer"
                  >
                    Enable GPS
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Search Bar Form */}
        <form onSubmit={handleSearchSubmit} className="mt-6 flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by facility name, locality, specialty, or service (e.g. Max, Dhantoli, Cardiac, Oxygen)..."
              className="w-full bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 rounded-2xl pl-11 pr-10 py-3.5 text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  fetchDirectory();
                }}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="flex-1 sm:flex-none px-6 py-3.5 bg-slate-900 hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-700 text-white rounded-2xl text-xs font-bold transition-all shadow-sm cursor-pointer"
            >
              Search
            </button>
            <button
              type="button"
              onClick={() => setShowFiltersPanel((prev) => !prev)}
              className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex items-center gap-1.5 ${
                showFiltersPanel || activeFiltersCount > 0
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                  : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
              title="Toggle filter controls"
            >
              <SlidersHorizontal className="w-4 h-4" />
              {activeFiltersCount > 0 && (
                <span className="w-4 h-4 rounded-full bg-emerald-600 text-white text-[10px] font-bold flex items-center justify-center">
                  {activeFiltersCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={fetchDirectory}
              className="p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              title="Refresh directory"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </form>

        {/* 2. PRIMARY FILTERS: GEOGRAPHIC SCOPE & CATEGORIES */}
        <div className="mt-6 pt-5 border-t border-slate-100 dark:border-slate-800 flex flex-col gap-4">
          {/* Geographic Scope Tabs */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                Scope:
              </span>
              <div className="inline-flex rounded-xl bg-slate-100 dark:bg-slate-800/80 p-0.5 border border-slate-200/50 dark:border-slate-700/50">
                <button
                  type="button"
                  onClick={() => setSelectedCoverageGroup('NAGPUR_CITY')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    selectedCoverageGroup === 'NAGPUR_CITY'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  Nagpur City
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedCoverageGroup('ALL')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    selectedCoverageGroup === 'ALL'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  Nagpur District
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedCoverageGroup('NAGPUR_DISTRICT_RURAL')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    selectedCoverageGroup === 'NAGPUR_DISTRICT_RURAL'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  Rural Tehsils
                </button>
              </div>
            </div>

            {/* Quick stats indicator */}
            <div className="text-2xs font-medium text-slate-400 dark:text-slate-500">
              {meta ? `${filteredRecords.length} results of ${meta.totalCatalogRecords || 85} catalog facilities` : 'Nagpur Pilot Directory'}
            </div>
          </div>

          {/* Category Tabs */}
          <div className="flex flex-wrap items-center gap-2 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => setSelectedCategory('ALL')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                selectedCategory === 'ALL'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              All Categories
            </button>
            <button
              type="button"
              onClick={() => setSelectedCategory('HOSPITAL')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                selectedCategory === 'HOSPITAL'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <Building2 className="w-3.5 h-3.5" />
              <span>Hospitals</span>
            </button>
            <button
              type="button"
              onClick={() => setSelectedCategory('CLINIC')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                selectedCategory === 'CLINIC'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Clinics & Centres</span>
            </button>
            <button
              type="button"
              onClick={() => setSelectedCategory('AMBULANCE_PROVIDER')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                selectedCategory === 'AMBULANCE_PROVIDER'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <Ambulance className="w-3.5 h-3.5" />
              <span>Ambulance Providers</span>
            </button>
            <button
              type="button"
              onClick={() => setSelectedCategory('OFFICIAL_EMERGENCY_HELPLINE')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                selectedCategory === 'OFFICIAL_EMERGENCY_HELPLINE'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <ShieldAlert className="w-3.5 h-3.5 text-rose-500" />
              <span>Helplines</span>
            </button>
          </div>

          {/* Expandable Secondary Filters Panel */}
          {showFiltersPanel && (
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-3 gap-4 animate-in fade-in duration-200">
              {/* Locality Dropdown */}
              <div>
                <label className="text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1.5 block">
                  Locality or Tehsil
                </label>
                <div className="flex items-center gap-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs">
                  <MapPin className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <select
                    value={selectedLocality}
                    onChange={(e) => setSelectedLocality(e.target.value)}
                    className="w-full bg-transparent text-xs font-semibold focus:outline-none cursor-pointer text-slate-800 dark:text-slate-200"
                  >
                    {NAGPUR_LOCALITIES.map((loc) => (
                      <option key={loc} value={loc} className="dark:bg-slate-900">
                        {loc}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Verified Partner Toggle */}
              <div className="flex items-end">
                <label className="flex items-center gap-2.5 p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-full cursor-pointer text-xs font-semibold text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={partnerOnly}
                    onChange={(e) => setPartnerOnly(e.target.checked)}
                    className="rounded text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>Verified Partners Only</span>
                </label>
              </div>

              {/* 24x7 Emergency Desk Toggle */}
              <div className="flex items-end">
                <label className="flex items-center gap-2.5 p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-full cursor-pointer text-xs font-semibold text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={emergencyDeskOnly}
                    onChange={(e) => setEmergencyDeskOnly(e.target.checked)}
                    className="rounded text-rose-600 focus:ring-rose-500"
                  />
                  <span>24x7 Emergency Desk Claimed</span>
                </label>
              </div>
            </div>
          )}

          {/* Active Filters Row */}
          {activeFiltersCount > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-1 text-2xs">
              <span className="text-slate-400 dark:text-slate-500 font-semibold">Active filters:</span>
              {selectedCoverageGroup !== 'ALL' && (
                <span className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium flex items-center gap-1">
                  Scope: {selectedCoverageGroup === 'NAGPUR_CITY' ? 'Nagpur City' : 'Rural Tehsils'}
                  <button type="button" onClick={() => setSelectedCoverageGroup('ALL')} className="hover:text-rose-500">×</button>
                </span>
              )}
              {selectedCategory !== 'ALL' && (
                <span className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium flex items-center gap-1">
                  Category: {selectedCategory.replace(/_/g, ' ')}
                  <button type="button" onClick={() => setSelectedCategory('ALL')} className="hover:text-rose-500">×</button>
                </span>
              )}
              {selectedLocality !== 'All Localities' && (
                <span className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium flex items-center gap-1">
                  Locality: {selectedLocality}
                  <button type="button" onClick={() => setSelectedLocality('All Localities')} className="hover:text-rose-500">×</button>
                </span>
              )}
              {partnerOnly && (
                <span className="px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-medium flex items-center gap-1">
                  Partners Only
                  <button type="button" onClick={() => setPartnerOnly(false)} className="hover:text-rose-500">×</button>
                </span>
              )}
              {emergencyDeskOnly && (
                <span className="px-2.5 py-1 rounded-lg bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 font-medium flex items-center gap-1">
                  24x7 Emergency Desk
                  <button type="button" onClick={() => setEmergencyDeskOnly(false)} className="hover:text-rose-500">×</button>
                </span>
              )}
              <button
                type="button"
                onClick={resetAllFilters}
                className="text-emerald-600 dark:text-emerald-400 hover:underline font-bold ml-1 cursor-pointer"
              >
                Clear all filters
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 3. MODEST RESULTS SUMMARY */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 px-1">
        <div>
          <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
            {loading ? (
              'Querying registry records...'
            ) : filteredRecords.length === 0 ? (
              'No matching facilities found'
            ) : (
              <>
                Showing <strong className="text-slate-900 dark:text-slate-100">{filteredRecords.length}</strong>{' '}
                {selectedCategory === 'HOSPITAL'
                  ? 'hospitals'
                  : selectedCategory === 'CLINIC'
                  ? 'clinics & centres'
                  : selectedCategory === 'AMBULANCE_PROVIDER'
                  ? 'ambulance providers'
                  : selectedCategory === 'OFFICIAL_EMERGENCY_HELPLINE'
                  ? 'emergency helplines'
                  : 'healthcare facilities & services'}{' '}
                {selectedLocality !== 'All Localities' ? `in ${selectedLocality}` : 'in Nagpur District'}
              </>
            )}
          </span>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
            Pilot directory covering Nagpur Municipal Corporation and district rural tehsils.
          </p>
        </div>
      </div>

      {/* 4. LOADING SKELETON */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {[1, 2, 3, 4].map((n) => (
            <div
              key={n}
              className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-3xl p-6 flex flex-col gap-4 animate-pulse"
            >
              <div className="flex justify-between items-center">
                <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded w-1/4" />
                <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded w-1/5" />
              </div>
              <div className="h-6 bg-slate-200 dark:bg-slate-800 rounded w-3/4" />
              <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded w-1/2" />
              <div className="flex gap-2 mt-2">
                <div className="h-6 bg-slate-200 dark:bg-slate-800 rounded-lg w-20" />
                <div className="h-6 bg-slate-200 dark:bg-slate-800 rounded-lg w-24" />
              </div>
              <div className="h-11 bg-slate-200 dark:bg-slate-800 rounded-2xl mt-3" />
            </div>
          ))}
        </div>
      )}

      {/* 5. ERROR STATE */}
      {!loading && error && (
        <div className="p-8 rounded-3xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-center flex flex-col items-center justify-center gap-3">
          <AlertCircle className="w-8 h-8 text-rose-500" />
          <h3 className="text-sm font-bold text-rose-900 dark:text-rose-200">Unable to Load Directory</h3>
          <p className="text-xs text-rose-700 dark:text-rose-300 max-w-md">{error}</p>
          <button
            type="button"
            onClick={fetchDirectory}
            className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
          >
            Retry Connection
          </button>
        </div>
      )}

      {/* 6. EMPTY STATE */}
      {!loading && !error && filteredRecords.length === 0 && (
        <div className="bg-white dark:bg-slate-900 border border-dashed border-slate-300 dark:border-slate-800 rounded-3xl p-10 flex flex-col items-center justify-center text-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400">
            <Building2 className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-slate-800 dark:text-slate-200">
            No Verified Facilities Match Your Filter
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md leading-relaxed">
            No records matched {searchQuery ? `"${searchQuery}"` : 'your query'} in{' '}
            <strong className="text-slate-700 dark:text-slate-300">{selectedLocality}</strong>. LifeLink avoids inventing
            unverified facilities or coordinates.
          </p>
          <button
            type="button"
            onClick={resetAllFilters}
            className="mt-2 text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
          >
            Reset all filters & show entire Nagpur district registry
          </button>
        </div>
      )}

      {/* 6.5. INTERACTIVE HEALTHCARE NETWORK MAP (LEAFLET + OPENSTREETMAP) */}
      {!loading && !error && filteredRecords.length > 0 && (
        <div ref={mapContainerRef} className="scroll-mt-6">
          {showMap ? (
            <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-sm space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                    <MapPin className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                      <span>Live Healthcare & Emergency Network Map</span>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                        OpenStreetMap Standard
                      </span>
                    </h3>
                    <p className="text-3xs text-slate-400 dark:text-slate-500">
                      {mapHospitals.length} verified facilities mapped • Click any hospital card to zoom to street level (Zoom 16)
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {onNavigateTab && (
                    <button
                      type="button"
                      onClick={() => onNavigateTab('SOS')}
                      className="px-3 py-1.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/50 border border-rose-200 dark:border-rose-900/40 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                      title="Open full emergency dispatch view"
                    >
                      <ShieldAlert className="w-3.5 h-3.5 text-rose-500" />
                      <span>SOS Network</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setIsMapExpanded((prev) => !prev)}
                    className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                    title={isMapExpanded ? 'Standard map view' : 'Expand map height'}
                  >
                    {isMapExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                    <span>{isMapExpanded ? 'Standard' : 'Expand'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowMap(false)}
                    className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                    title="Hide map panel"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Hide Map</span>
                  </button>
                </div>
              </div>

              {/* Selected Hospital Alert Banner inside Map Header */}
              {selectedHospital && (
                <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-emerald-900 dark:text-emerald-200 animate-in fade-in">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping shrink-0" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <strong className="text-sm font-extrabold truncate">{selectedHospital.name}</strong>
                        {selectedHospital.locality && (
                          <span className="text-3xs font-semibold px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-200 shrink-0">
                            {selectedHospital.locality}
                          </span>
                        )}
                      </div>
                      <p className="text-3xs text-emerald-700 dark:text-emerald-300 mt-0.5 font-mono truncate">
                        GPS: {selectedHospital.lat?.toFixed(5)}, {selectedHospital.lng?.toFixed(5)} • Street View (Zoom 16)
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                    {selectedHospital.lat && selectedHospital.lng && (
                      <a
                        href={`https://www.google.com/maps/dir/?api=1&destination=${selectedHospital.lat},${selectedHospital.lng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-xs"
                      >
                        <Navigation className="w-3.5 h-3.5" />
                        <span>Get Directions</span>
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedHospitalId(null);
                        setSelectedAmbulanceProviderId(null);
                        setSelectedHospitalRoute(null);
                      }}
                      className="px-3 py-1.5 rounded-xl border border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-xs font-bold transition-colors cursor-pointer"
                    >
                      Reset Focus
                    </button>
                  </div>
                </div>
              )}

              {/* Leaflet Map Frame */}
              <div
                className={`w-full rounded-2xl overflow-hidden border border-slate-200/90 dark:border-slate-800 shadow-inner transition-all duration-300 ${
                  isMapExpanded ? 'h-[500px]' : 'h-80 sm:h-96'
                }`}
              >
                <LeafletMap
                  center={
                    selectedHospital && selectedHospital.lat && selectedHospital.lng
                      ? [selectedHospital.lat, selectedHospital.lng]
                      : isLocationGranted && userLat && userLng
                      ? [userLat, userLng]
                      : [21.1458, 79.0882]
                  }
                  patientLoc={isLocationGranted && userLat && userLng ? [userLat, userLng] : null}
                  hospitals={mapHospitals}
                  ambulanceProviders={mapAmbulanceProviders}
                  selectedHospitalId={selectedHospitalId || undefined}
                  selectedAmbulanceProviderId={selectedAmbulanceProviderId || undefined}
                  onSelectHospital={handleSelectHospitalFromMap}
                  onSelectAmbulanceProvider={handleSelectAmbulanceProviderFromMap}
                  onRouteCalculated={(route) => setSelectedHospitalRoute(route)}
                  zoom={13}
                />
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between p-4 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-3xl shadow-xs">
              <div className="flex items-center gap-2.5">
                <MapPin className="w-4 h-4 text-emerald-600" />
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Interactive OpenStreetMap is hidden ({mapHospitals.length + mapAmbulanceProviders.length} facilities ready to view)
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowMap(true);
                  setTimeout(() => window.dispatchEvent(new Event('resize')), 100);
                }}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer flex items-center gap-1.5"
              >
                <MapPin className="w-3.5 h-3.5" />
                <span>Show Map</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* 7. FACILITY CARDS GRID */}
      {!loading && !error && filteredRecords.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {filteredRecords.map((item) => {
            const isHospital = item.recordType === 'HOSPITAL';
            const isHelpline = item.recordType === 'OFFICIAL_EMERGENCY_HELPLINE';
            const isAmbulance = item.recordType === 'AMBULANCE_PROVIDER';

            const isSelected = selectedHospitalId === item.id || selectedAmbulanceProviderId === item.id;

            const cleanPhone = (item.contactNumber || '').replace(/[^0-9+]/g, '');
            const cleanEmergencyPhone = (item.emergencyPhone || '').replace(/[^0-9+]/g, '');
            const cleanAmbulancePhone = (item.ambulancePhone || '').replace(/[^0-9+]/g, '');

            const categoryTitle = formatFacilityCategory(
              item.category,
              isHelpline,
              isAmbulance,
              item.isHospitalAffiliated
            );

            // Valid coordinate check
            const hasValidCoords =
              typeof item.lat === 'number' &&
              typeof item.lng === 'number' &&
              !isNaN(item.lat) &&
              !isNaN(item.lng) &&
              item.lat !== 0 &&
              item.lng !== 0;

            // Straight-line distance calculation using Haversine formula
            let straightLineDistKm: number | null = null;
            if (
              isLocationGranted &&
              typeof userLat === 'number' &&
              typeof userLng === 'number' &&
              hasValidCoords
            ) {
              straightLineDistKm = calculateHaversineDistanceKm(userLat, userLng, item.lat!, item.lng!);
            }

            return (
              <div
                id={`dir-card-${item.id}`}
                key={item.id}
                onClick={() => handleSelectHospital(item)}
                className={`bg-white dark:bg-slate-900 border rounded-3xl p-6 shadow-sm transition-all duration-200 flex flex-col justify-between gap-5 group cursor-pointer ${
                  isSelected
                    ? 'border-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/30 ring-2 ring-emerald-500/30 shadow-md'
                    : 'border-slate-200/80 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-md'
                }`}
              >
                <div className="space-y-3">
                  {/* Selected Active Badge */}
                  {isSelected && (
                    <div className="bg-emerald-600 text-white text-3xs font-extrabold uppercase tracking-wider px-3 py-1.5 rounded-xl flex items-center justify-between shadow-xs">
                      <span className="flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-white animate-bounce" />
                        <span>{isAmbulance ? 'Selected Ambulance Station • Focused on Map (Zoom 16)' : 'Selected Facility • Focused on Map (Zoom 16)'}</span>
                      </span>
                      <span className="text-[10px] font-mono opacity-90">Active Marker</span>
                    </div>
                  )}

                  {/* Top Bar: Category Label & Verified Badges */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-3xs font-bold uppercase tracking-wider ${
                          isHelpline
                            ? 'bg-amber-100/70 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-900/60'
                            : item.isHospitalAffiliated
                            ? 'bg-indigo-100/70 dark:bg-indigo-950/60 text-indigo-800 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-900/60'
                            : isHospital
                            ? 'bg-blue-100/70 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-900/60'
                            : 'bg-purple-100/70 dark:bg-purple-950/60 text-purple-800 dark:text-purple-300 border border-purple-200 dark:border-purple-900/60'
                        }`}
                      >
                        {isHelpline ? (
                          <ShieldAlert className="w-3 h-3 text-rose-500" />
                        ) : isHospital ? (
                          <Building2 className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                        ) : (
                          <Ambulance className="w-3 h-3 text-purple-600 dark:text-purple-400" />
                        )}
                        <span>{categoryTitle}</span>
                      </span>

                      {/* Locality badge */}
                      {item.locality && (
                        <span className="text-3xs font-semibold px-2.5 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                          {item.locality}
                        </span>
                      )}
                    </div>

                    {/* Partner Label: ONLY shown if explicitly confirmed in database */}
                    {item.isLifeLinkPartner && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-3xs font-bold bg-emerald-500 text-white shadow-xs">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>LifeLink Partner</span>
                      </span>
                    )}
                  </div>

                  {/* Explicit Hospital Affiliation Indicator for Ambulances */}
                  {item.isHospitalAffiliated && item.linkedHospitalName && (
                    <div className="text-3xs font-semibold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/30 px-3 py-1 rounded-xl border border-indigo-100 dark:border-indigo-900/40 flex items-center gap-1.5">
                      <Building2 className="w-3 h-3 text-indigo-500" />
                      <span>Hospital Fleet • Linked to {item.linkedHospitalName}</span>
                    </div>
                  )}

                  {/* Facility Name & Alternate Names */}
                  <div>
                    <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100 leading-snug group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                      {item.name}
                    </h3>
                    {item.alternateNames && item.alternateNames.length > 0 && (
                      <p className="text-3xs text-slate-400 dark:text-slate-500 font-medium mt-0.5">
                        Also known as: {item.alternateNames.join(', ')}
                      </p>
                    )}
                  </div>

                  {/* Address & Verified Locality */}
                  <div className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                    <span>
                      {item.address}
                      {item.pinCode ? ` • ${item.pinCode}` : ''}
                    </span>
                  </div>

                  {/* Proximity / Distance: Honest Straight-line & Optional Road Routing */}
                  <div className="pt-0.5">
                    {hasValidCoords ? (
                      isLocationGranted && straightLineDistKm !== null ? (
                        <div className="space-y-1">
                          <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                            <Compass className="w-3.5 h-3.5 shrink-0" />
                            <span>Straight-line distance: {straightLineDistKm} km from your location</span>
                          </div>
                          {isSelected && selectedHospitalRoute && selectedHospitalRoute.isRoadRouting && (
                            <div className="text-xs font-semibold text-cyan-700 dark:text-cyan-300 pl-5 flex items-center gap-1.5 bg-cyan-50 dark:bg-cyan-950/40 py-1.5 px-3 rounded-xl border border-cyan-200 dark:border-cyan-900/40">
                              <Navigation className="w-3.5 h-3.5 shrink-0 text-cyan-600" />
                              <span>
                                Road distance: {selectedHospitalRoute.distanceKm} km • Est. travel time: {selectedHospitalRoute.durationMins} mins (OSRM)
                              </span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center justify-between text-xs text-slate-400 dark:text-slate-500">
                          <span className="flex items-center gap-1.5">
                            <MapPin className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                            <span>Distance unavailable (Location not enabled)</span>
                          </span>
                          {(onRequestLocation || onDetectLocation) && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                (onRequestLocation || onDetectLocation)?.();
                              }}
                              className="text-emerald-600 dark:text-emerald-400 hover:underline text-3xs font-bold cursor-pointer"
                            >
                              Enable Location
                            </button>
                          )}
                        </div>
                      )
                    ) : (
                      <div className="text-xs text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
                        <MapPinOff className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                        <span>Distance unavailable (Facility coordinates unindexed)</span>
                      </div>
                    )}
                  </div>

                  {/* Hospital Specialties (Humanized, capped at 3) */}
                  {isHospital && item.specialties && item.specialties.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      {item.specialties.slice(0, 3).map((spec, i) => (
                        <span
                          key={i}
                          className="px-2.5 py-0.5 rounded-lg text-3xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                        >
                          {spec}
                        </span>
                      ))}
                      {item.specialties.length > 3 && (
                        <span className="text-3xs font-semibold text-slate-400 dark:text-slate-500">
                          +{item.specialties.length - 3} more
                        </span>
                      )}
                    </div>
                  )}

                  {/* Ambulance Services (Humanized labels, NO raw screaming snake case) */}
                  {!isHospital && !isHelpline && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      {item.humanServiceTypes && item.humanServiceTypes.length > 0 ? (
                        item.humanServiceTypes.slice(0, 3).map((svc, i) => (
                          <span
                            key={i}
                            className="px-2.5 py-0.5 rounded-lg text-3xs font-semibold bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border border-purple-100 dark:border-purple-900/30"
                          >
                            {svc}
                          </span>
                        ))
                      ) : item.advertisedServiceTypes && item.advertisedServiceTypes.length > 0 ? (
                        item.advertisedServiceTypes.slice(0, 3).map((svc, i) => (
                          <span
                            key={i}
                            className="px-2.5 py-0.5 rounded-lg text-3xs font-semibold bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border border-purple-100 dark:border-purple-900/30"
                          >
                            {formatServiceType(svc)}
                          </span>
                        ))
                      ) : null}
                      {item.advertisedIcuOrVentilatorCapability && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-3xs font-bold bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-900/40">
                          <Activity className="w-3 h-3 text-rose-600" />
                          <span>ICU Capable</span>
                        </span>
                      )}
                    </div>
                  )}

                  {/* Dedicated Emergency Casualty Desk Notice */}
                  {isHospital && item.emergencyServicesClaimed && (
                    <div className="flex items-center gap-1.5 text-3xs font-bold text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 px-3 py-1 rounded-xl w-fit border border-rose-200/60 dark:border-rose-900/40">
                      <HeartPulse className="w-3 h-3 text-rose-600 shrink-0" />
                      <span>24x7 Emergency Desk Available</span>
                    </div>
                  )}
                </div>

                {/* Bottom Action Area: Call, Directions, Details */}
                <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-2.5">
                  {/* Secondary dedicated phone desk if present */}
                  {item.emergencyPhone && (
                    <a
                      href={`tel:${cleanEmergencyPhone}`}
                      className="w-full flex items-center justify-center gap-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs py-2 px-3 rounded-xl shadow-xs transition-colors"
                      title="24x7 Direct Emergency Casualty Desk"
                    >
                      <PhoneCall className="w-3.5 h-3.5" />
                      <span>24x7 Emergency Desk: {item.emergencyPhone}</span>
                    </a>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    {/* Primary Click to Call */}
                    <a
                      href={item.clickToCallUrl || `tel:${cleanPhone}`}
                      onClick={(e) => e.stopPropagation()}
                      className="flex-1 min-w-[130px] flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-700 text-white font-bold text-xs py-2.5 px-3.5 rounded-xl shadow-xs transition-colors cursor-pointer"
                    >
                      <Phone className="w-3.5 h-3.5" />
                      <span>Call: {formatIndianPhone(item.contactNumber)}</span>
                    </a>

                    {/* View on Map Button */}
                    {hasValidCoords && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectHospital(item);
                        }}
                        className={`flex items-center justify-center gap-1.5 text-xs font-bold py-2.5 px-3 rounded-xl transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-emerald-600 text-white shadow-xs'
                            : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 border border-emerald-200 dark:border-emerald-800/50'
                        }`}
                        title="Focus and zoom facility on map (Zoom 16 street view)"
                      >
                        <MapPin className="w-3.5 h-3.5" />
                        <span>{isSelected ? 'Focused' : 'View on Map'}</span>
                      </button>
                    )}

                    {/* Directions Link using verified coordinates or address */}
                    {hasValidCoords ? (
                      <a
                        href={item.directionsUrl || `https://www.google.com/maps/dir/?api=1&destination=${item.lat},${item.lng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center justify-center gap-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs py-2.5 px-3.5 rounded-xl transition-colors cursor-pointer"
                        title="Get directions using verified coordinates"
                      >
                        <Navigation className="w-3.5 h-3.5 text-blue-500" />
                        <span>Directions</span>
                      </a>
                    ) : item.address ? (
                      <a
                        href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(item.name + ', ' + item.address)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center justify-center gap-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs py-2.5 px-3.5 rounded-xl transition-colors cursor-pointer"
                        title="Get directions using facility address"
                      >
                        <Navigation className="w-3.5 h-3.5 text-blue-500" />
                        <span>Directions</span>
                      </a>
                    ) : null}

                    {/* View Doctors Button for Hospitals */}
                    {item.recordType !== 'AMBULANCE_PROVIDER' && item.recordType !== 'OFFICIAL_EMERGENCY_HELPLINE' && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setModalTab('DOCTORS');
                          setInspectRecord(item);
                        }}
                        className="flex items-center justify-center gap-1.5 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/50 text-rose-600 dark:text-rose-400 font-bold text-xs py-2.5 px-3 rounded-xl transition-colors cursor-pointer border border-rose-200/50 dark:border-rose-800/40"
                        title="View affiliated doctors and medical specialists"
                      >
                        <Stethoscope className="w-3.5 h-3.5 text-rose-500" />
                        <span>Doctors</span>
                      </button>
                    )}

                    {/* View Details Drawer Button */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setModalTab('OVERVIEW');
                        setInspectRecord(item);
                      }}
                      className="p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors cursor-pointer"
                      title="View facility details and verification"
                    >
                      <Info className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 8. FACILITY DETAILS & VERIFICATION MODAL */}
      {inspectRecord && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 sm:p-8 shadow-2xl space-y-6 animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
              <div>
                <span className="text-3xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                  {formatFacilityCategory(inspectRecord.category, inspectRecord.recordType === 'OFFICIAL_EMERGENCY_HELPLINE', inspectRecord.recordType === 'AMBULANCE_PROVIDER', inspectRecord.isHospitalAffiliated)}
                </span>
                <h3 className="text-xl font-extrabold text-slate-900 dark:text-slate-100 mt-1">
                  {inspectRecord.name}
                </h3>
                {inspectRecord.isLifeLinkPartner && (
                  <span className="inline-flex items-center gap-1 mt-1.5 px-2.5 py-0.5 rounded-lg text-3xs font-bold bg-emerald-500 text-white">
                    <CheckCircle2 className="w-3 h-3" />
                    <span>Verified LifeLink Partner</span>
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setInspectRecord(null)}
                className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Tabs for Hospitals */}
            {inspectRecord.recordType !== 'AMBULANCE_PROVIDER' && inspectRecord.recordType !== 'OFFICIAL_EMERGENCY_HELPLINE' && (
              <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-2">
                <button
                  type="button"
                  onClick={() => setModalTab('OVERVIEW')}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                    modalTab === 'OVERVIEW'
                      ? 'bg-slate-900 text-white dark:bg-emerald-600'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  Facility Overview
                </button>
                <button
                  type="button"
                  onClick={() => setModalTab('DOCTORS')}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                    modalTab === 'DOCTORS'
                      ? 'bg-slate-900 text-white dark:bg-emerald-600'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <Stethoscope className="w-3.5 h-3.5" />
                  <span>Doctors & Specialists</span>
                  <span className="px-2 py-0.5 rounded-full text-3xs font-extrabold bg-rose-500 text-white ml-0.5">
                    {loadingModalDoctors ? '...' : modalDoctors.length}
                  </span>
                </button>
              </div>
            )}

            {modalTab === 'OVERVIEW' ? (
              <>
                {/* Address & Geographic Information */}
                <div className="space-y-2 text-xs">
                  <span className="font-bold text-slate-800 dark:text-slate-200">Location & Territory</span>
                  <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200/70 dark:border-slate-800 space-y-1.5 text-slate-600 dark:text-slate-400">
                    <p><strong className="text-slate-700 dark:text-slate-300">Address:</strong> {inspectRecord.address}</p>
                    <p><strong className="text-slate-700 dark:text-slate-300">Locality:</strong> {inspectRecord.locality || 'Nagpur'}</p>
                    <p><strong className="text-slate-700 dark:text-slate-300">Tehsil:</strong> {inspectRecord.tehsil || 'Nagpur Urban'}</p>
                    <p><strong className="text-slate-700 dark:text-slate-300">Coordinates:</strong> {inspectRecord.lat && inspectRecord.lng ? `${inspectRecord.lat}, ${inspectRecord.lng}` : 'Locality geocoded'}</p>
                  </div>
                </div>

                {/* Verified Contact Lines */}
                <div className="space-y-2 text-xs">
                  <span className="font-bold text-slate-800 dark:text-slate-200">Verified Contact Directory</span>
                  <div className="divide-y divide-slate-100 dark:divide-slate-800 rounded-2xl border border-slate-200/70 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
                    <div className="p-3 flex items-center justify-between">
                      <span className="text-slate-600 dark:text-slate-400">Main Reception:</span>
                      <a href={`tel:${(inspectRecord.contactNumber || '').replace(/[^0-9+]/g, '')}`} className="font-bold text-emerald-600 dark:text-emerald-400 hover:underline">
                        {formatIndianPhone(inspectRecord.contactNumber)}
                      </a>
                    </div>
                    {inspectRecord.emergencyPhone && (
                      <div className="p-3 flex items-center justify-between">
                        <span className="text-rose-600 dark:text-rose-400 font-semibold">24x7 Casualty Line:</span>
                        <a href={`tel:${(inspectRecord.emergencyPhone || '').replace(/[^0-9+]/g, '')}`} className="font-bold text-rose-600 dark:text-rose-400 hover:underline">
                          {inspectRecord.emergencyPhone}
                        </a>
                      </div>
                    )}
                    {inspectRecord.ambulancePhone && (
                      <div className="p-3 flex items-center justify-between">
                        <span className="text-purple-600 dark:text-purple-400 font-semibold">Ambulance Helpdesk:</span>
                        <a href={`tel:${(inspectRecord.ambulancePhone || '').replace(/[^0-9+]/g, '')}`} className="font-bold text-purple-600 dark:text-purple-400 hover:underline">
                          {inspectRecord.ambulancePhone}
                        </a>
                      </div>
                    )}
                    {inspectRecord.website && (
                      <div className="p-3 flex items-center justify-between">
                        <span className="text-slate-600 dark:text-slate-400">Official Website:</span>
                        <a href={inspectRecord.website} target="_blank" rel="noopener noreferrer" className="font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1">
                          <span>Visit Portal</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    )}
                  </div>
                </div>

                {/* Data Provenance & Trust Transparency */}
                <div className="space-y-2 text-xs">
                  <span className="font-bold text-slate-800 dark:text-slate-200">Data Source & Provenance</span>
                  <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200/70 dark:border-slate-800 space-y-1.5 text-slate-500 dark:text-slate-400 text-3xs">
                    <p>
                      <strong className="text-slate-700 dark:text-slate-300">Confidence:</strong>{' '}
                      {DATA_CONFIDENCE_LABELS[inspectRecord.dataConfidence || '']?.label || 'Public Directory'}
                    </p>
                    <p>
                      <strong className="text-slate-700 dark:text-slate-300">Audit notes:</strong>{' '}
                      {inspectRecord.dataProvenance}
                    </p>
                    {inspectRecord.lastCheckedAt && (
                      <p>
                        <strong className="text-slate-700 dark:text-slate-300">Last Verified:</strong>{' '}
                        {formatIndianDateTime(inspectRecord.lastCheckedAt)}
                      </p>
                    )}
                  </div>
                </div>
              </>
            ) : (
              /* DOCTORS TAB */
              <div className="space-y-4 text-xs">
                {/* Search & Specialty Filters */}
                <div className="flex flex-col sm:flex-row gap-2.5">
                  <div className="relative flex-1">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Search doctor name, specialty, or MMC reg..."
                      value={modalDoctorSearch}
                      onChange={(e) => setModalDoctorSearch(e.target.value)}
                      className="w-full pl-8.5 pr-8 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-rose-500"
                    />
                    {modalDoctorSearch && (
                      <button
                        onClick={() => setModalDoctorSearch('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  {modalDoctorSpecialties.length > 0 && (
                    <select
                      value={modalDoctorSpecFilter}
                      onChange={(e) => setModalDoctorSpecFilter(e.target.value)}
                      className="px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 focus:outline-none focus:border-rose-500 max-w-[200px]"
                    >
                      <option value="ALL">All Specialties ({modalDoctorSpecialties.length})</option>
                      {modalDoctorSpecialties.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  )}
                </div>

                {loadingModalDoctors ? (
                  <div className="py-12 text-center text-slate-400 flex flex-col items-center gap-2">
                    <RefreshCw className="w-5 h-5 animate-spin text-rose-500" />
                    <span>Loading affiliated medical specialists...</span>
                  </div>
                ) : filteredModalDoctors.length === 0 ? (
                  <div className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-center space-y-2">
                    <p className="font-semibold text-slate-800 dark:text-slate-200 text-xs">
                      {modalDoctors.length === 0
                        ? 'No verified doctor records currently indexed for this facility.'
                        : 'No specialists match the search criteria.'}
                    </p>
                    <p className="text-3xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                      {modalDoctors.length === 0
                        ? 'LifeLink only displays genuine doctor records verified through official hospital directories or Maharashtra Medical Council registrations. Please contact hospital reception directly for current consultant schedules.'
                        : 'Try clearing your search query or selecting "All Specialties".'}
                    </p>
                    {inspectRecord.contactNumber && (
                      <div className="pt-2">
                        <a
                          href={`tel:${inspectRecord.contactNumber.replace(/[^0-9+]/g, '')}`}
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 text-white dark:bg-emerald-600 font-bold text-3xs"
                        >
                          <Phone className="w-3 h-3" />
                          <span>Call Reception: {formatIndianPhone(inspectRecord.contactNumber)}</span>
                        </a>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
                    {filteredModalDoctors.map((doc: any) => {
                      const isVisiting = doc.affiliation?.status === 'VISITING_CONSULTANT';
                      const isPartner = doc.bookingEnabled;

                      return (
                        <div
                          key={doc.id}
                          className="p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/70 space-y-2.5"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="space-y-0.5">
                              <h4 className="font-bold text-sm text-slate-900 dark:text-white">
                                {doc.name}
                              </h4>
                              {doc.designation && (
                                <p className="text-3xs font-medium text-slate-600 dark:text-slate-400">
                                  {doc.designation}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {isVisiting ? (
                                <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                                  Visiting Specialist
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                                  Primary Staff
                                </span>
                              )}
                              {isPartner ? (
                                <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-600 text-white">
                                  OPD Booking
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                                  Directory Listed
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="px-2 py-0.5 rounded-md bg-rose-500/10 text-rose-600 dark:text-rose-400 text-3xs font-extrabold uppercase tracking-wider">
                              {doc.specialization}
                            </span>
                            {Array.isArray(doc.specialtiesList) &&
                              doc.specialtiesList
                                .filter((s: string) => s && s !== doc.specialization)
                                .slice(0, 3)
                                .map((s: string) => (
                                  <span
                                    key={s}
                                    className="px-1.5 py-0.5 rounded bg-slate-200/60 dark:bg-slate-800/80 text-slate-600 dark:text-slate-400 text-[10px]"
                                  >
                                    {s}
                                  </span>
                                ))}
                          </div>

                          {/* Qualifications & Registration Authority */}
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-3xs text-slate-600 dark:text-slate-400 pt-1 border-t border-slate-200/50 dark:border-slate-850">
                            {doc.qualifications && (
                              <span><strong>Qualifications:</strong> {doc.qualifications}</span>
                            )}
                            {doc.experienceYears > 0 && (
                              <span><strong>Experience:</strong> {doc.experienceYears} yrs</span>
                            )}
                            {doc.registrationNumber && (
                              <span className="flex items-center gap-1 font-mono text-slate-700 dark:text-slate-300">
                                <Award className="w-3 h-3 text-emerald-500 shrink-0" />
                                <strong>Reg:</strong> {doc.registrationNumber} ({doc.registrationAuthority || 'MMC'})
                              </span>
                            )}
                          </div>

                          {/* Actions */}
                          <div className="pt-2 flex items-center justify-between gap-2">
                            {doc.profileUrl ? (
                              <a
                                href={doc.profileUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-3xs font-bold text-blue-600 dark:text-blue-400 hover:underline"
                              >
                                <span>Official Hospital Profile</span>
                                <ExternalLink className="w-2.5 h-2.5" />
                              </a>
                            ) : (
                              <span className="text-[10px] text-slate-400">Verified Public Record</span>
                            )}

                            {inspectRecord.contactNumber && (
                              <a
                                href={`tel:${inspectRecord.contactNumber.replace(/[^0-9+]/g, '')}`}
                                className="px-2.5 py-1 rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-3xs hover:bg-slate-300 inline-flex items-center gap-1"
                              >
                                <Phone className="w-2.5 h-2.5" />
                                <span>Call OPD</span>
                              </a>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="pt-2 flex items-center justify-between border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setFeedbackRecord(inspectRecord);
                  setInspectRecord(null);
                }}
                className="text-xs font-bold text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
              >
                Report Correction / Outdated Info
              </button>
              <button
                type="button"
                onClick={() => setInspectRecord(null)}
                className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 text-white font-bold text-xs transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 9. SUBMIT CORRECTION MODAL */}
      {feedbackRecord && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-md w-full p-6 sm:p-8 shadow-2xl space-y-5 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                Submit Directory Correction
              </h3>
              <button
                type="button"
                onClick={() => setFeedbackRecord(null)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Reporting for <strong className="text-slate-800 dark:text-slate-200">{feedbackRecord.name}</strong>. Your
              correction will be reviewed by LifeLink operations against official municipal registries.
            </p>

            {feedbackSuccess ? (
              <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-2xl p-4 text-center text-xs text-emerald-800 dark:text-emerald-200 font-bold">
                ✓ Thank you. Correction report submitted for review.
              </div>
            ) : (
              <form onSubmit={handleSubmitFeedback} className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 block">
                    Correction Type
                  </label>
                  <select
                    value={feedbackIssueType}
                    onChange={(e) => setFeedbackIssueType(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-2.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20 text-slate-900 dark:text-slate-100"
                  >
                    <option value="OUTDATED_PHONE">Phone Number Changed / Unreachable</option>
                    <option value="INCORRECT_ADDRESS">Address / Locality Incorrect</option>
                    <option value="MISSING_COORDINATES">Coordinates / Map Location Wrong</option>
                    <option value="FACILITY_CLOSED">Facility No Longer Operational</option>
                    <option value="DUPLICATE_ENTRY">Duplicate Organization Entry</option>
                    <option value="OTHER">Other Discrepancy</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 block">
                    Correction Details & Evidence
                  </label>
                  <textarea
                    rows={3}
                    value={feedbackDescription}
                    onChange={(e) => setFeedbackDescription(e.target.value)}
                    placeholder="Provide corrected phone, address, or official hospital notice link..."
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20 text-slate-900 dark:text-slate-100"
                    required
                  />
                </div>

                <div className="flex items-center justify-end gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => setFeedbackRecord(null)}
                    className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={feedbackSubmitting}
                    className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer disabled:opacity-50"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{feedbackSubmitting ? 'Submitting...' : 'Submit Report'}</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
