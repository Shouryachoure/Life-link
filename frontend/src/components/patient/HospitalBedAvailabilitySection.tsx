import React, { useState, useEffect, useMemo } from 'react';
import {
  Bed,
  Building2,
  Phone,
  MapPin,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Clock,
  Stethoscope,
  X,
  Search,
  SlidersHorizontal,
  Navigation,
  CalendarCheck,
  Send,
  Info,
  Activity,
  PhoneCall,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react';
import { formatIndianPhone, formatIndianDateTime } from '../../utils/localization';

export interface WardBedCount {
  available: number | null;
  total: number | null;
}

export interface HospitalCapacityRecord {
  id: string;
  name: string;
  locality?: string | null;
  address: string;
  contactNumber: string;
  city: string;
  state: string;
  lat?: number | null;
  lng?: number | null;
  totalBeds: number;
  availableBeds: number;
  occupiedBeds: number;
  cleaningBeds?: number;
  maintenanceBeds?: number;
  reservedBeds?: number;
  occupancyPercent: number;
  lastUpdated: string;
  ageMinutes: number;
  isStale: boolean;
  dataFreshness: 'STALE_VERIFICATION_REQUIRED' | 'WARD_DESK_VERIFIED' | 'HOSPITAL_REPORTED_RECENT' | string;
  dataSourceLabel: string;
  hasWardBreakdown: boolean;
  staleWarning?: string | null;
  wards: {
    icu: WardBedCount;
    er: WardBedCount;
    general: WardBedCount;
    pediatric: WardBedCount;
    surgical?: WardBedCount;
    [key: string]: WardBedCount | undefined;
  };
}

export interface HospitalBookingRecord {
  id: string;
  hospitalId: string;
  hospital?: {
    name: string;
    address: string;
  };
  bookingType: string;
  department?: string;
  doctorName?: string;
  chiefComplaint?: string;
  symptoms?: string;
  scheduledDate?: string;
  scheduledAt?: string;
  status: 'PENDING' | 'CONFIRMED' | 'ADMITTED' | 'COMPLETED' | 'CANCELLED' | string;
  wardType?: string;
  assignedBed?: {
    bedNumber: string;
    ward: string;
  } | null;
  createdAt: string;
}

interface HospitalBedAvailabilitySectionProps {
  apiFetch: (url: string, options?: RequestInit) => Promise<any>;
  user: any;
  userLat?: number;
  userLng?: number;
  onNavigateTab?: (tab: string) => void;
  socket?: any;
}

export const HospitalBedAvailabilitySection: React.FC<HospitalBedAvailabilitySectionProps> = ({
  apiFetch,
  user,
  userLat,
  userLng,
  onNavigateTab,
  socket,
}) => {
  const [capacities, setCapacities] = useState<HospitalCapacityRecord[]>([]);
  const [myBookings, setMyBookings] = useState<HospitalBookingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [bookingsLoading, setBookingsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedWardFilter, setSelectedWardFilter] = useState<'ALL' | 'ICU' | 'ER' | 'GENERAL' | 'PEDIATRIC'>('ALL');
  const [selectedFreshnessFilter, setSelectedFreshnessFilter] = useState<'ALL' | 'VERIFIED_RECENT' | 'STALE'>('ALL');
  const [selectedScopeFilter, setSelectedScopeFilter] = useState<'ALL' | 'NAGPUR_CITY' | 'RURAL'>('ALL');
  const [availableOnly, setAvailableOnly] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  // Admission Enquiry Modal
  const [enquiryModalOpen, setEnquiryModalOpen] = useState(false);
  const [selectedHospital, setSelectedHospital] = useState<HospitalCapacityRecord | null>(null);
  const [enquiryForm, setEnquiryForm] = useState({
    department: 'Emergency Medicine',
    priority: 'YELLOW_URGENT',
    symptoms: '',
    targetTime: new Date(Date.now() + 3600000).toISOString().slice(0, 16),
  });
  const [enquirySubmitting, setEnquirySubmitting] = useState(false);
  const [enquirySuccessMsg, setEnquirySuccessMsg] = useState('');
  const [enquiryErrorMsg, setEnquiryErrorMsg] = useState('');

  // Fetch capacities
  const fetchCapacities = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch('/hospitals/capacities');
      setCapacities(Array.isArray(data) ? data : []);
    } catch (err: any) {
      console.error('Failed to load hospital capacities:', err);
      setError(err?.message || 'Failed to connect to hospital bed availability registry.');
    } finally {
      setLoading(false);
    }
  };

  // Fetch user bookings/enquiries
  const fetchMyBookings = async () => {
    setBookingsLoading(true);
    try {
      const data = await apiFetch('/hospitals/my-bookings');
      setMyBookings(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load admissions/bookings:', err);
    } finally {
      setBookingsLoading(false);
    }
  };

  useEffect(() => {
    fetchCapacities();
    fetchMyBookings();
  }, []);

  // Socket auto-refresh
  useEffect(() => {
    if (!socket) return;
    const handleBedUpdate = () => fetchCapacities();
    const handleBookingUpdate = () => fetchMyBookings();

    socket.on('hospital:bed_updated', handleBedUpdate);
    socket.on('hospital:capacity_updated', handleBedUpdate);
    socket.on('hospital:booking_created', handleBookingUpdate);
    socket.on('hospital:booking_updated', handleBookingUpdate);

    return () => {
      socket.off('hospital:bed_updated', handleBedUpdate);
      socket.off('hospital:capacity_updated', handleBedUpdate);
      socket.off('hospital:booking_created', handleBookingUpdate);
      socket.off('hospital:booking_updated', handleBookingUpdate);
    };
  }, [socket]);

  // Client-side filtering
  const filteredHospitals = useMemo(() => {
    return capacities.filter((h) => {
      // Search query (hospital name, locality, address)
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesName = h.name.toLowerCase().includes(query);
        const matchesLocality = h.locality?.toLowerCase().includes(query);
        const matchesAddress = h.address.toLowerCase().includes(query);
        if (!matchesName && !matchesLocality && !matchesAddress) return false;
      }

      // Ward filter
      if (selectedWardFilter === 'ICU') {
        if (!h.hasWardBreakdown || (h.wards?.icu?.available ?? 0) <= 0) return false;
      } else if (selectedWardFilter === 'ER') {
        if (!h.hasWardBreakdown || (h.wards?.er?.available ?? 0) <= 0) return false;
      } else if (selectedWardFilter === 'GENERAL') {
        if (!h.hasWardBreakdown || (h.wards?.general?.available ?? 0) <= 0) return false;
      } else if (selectedWardFilter === 'PEDIATRIC') {
        if (!h.hasWardBreakdown || (h.wards?.pediatric?.available ?? 0) <= 0) return false;
      }

      // Freshness filter
      if (selectedFreshnessFilter === 'VERIFIED_RECENT' && h.isStale) return false;
      if (selectedFreshnessFilter === 'STALE' && !h.isStale) return false;

      // Available only filter
      if (availableOnly && h.availableBeds <= 0) return false;

      // Scope filter
      if (selectedScopeFilter === 'NAGPUR_CITY') {
        const isCity = !h.address.toLowerCase().includes('rural') && !h.address.toLowerCase().includes('tehsil');
        if (!isCity) return false;
      } else if (selectedScopeFilter === 'RURAL') {
        const isRural = h.address.toLowerCase().includes('rural') || h.address.toLowerCase().includes('tehsil');
        if (!isRural) return false;
      }

      return true;
    });
  }, [capacities, searchQuery, selectedWardFilter, selectedFreshnessFilter, selectedScopeFilter, availableOnly]);

  // Aggregate verified metrics across partner hospitals
  const aggregateMetrics = useMemo(() => {
    let totalAvail = 0;
    let totalCap = 0;
    let verifiedIcu = 0;
    let verifiedEr = 0;
    let verifiedGeneral = 0;

    capacities.forEach((h) => {
      totalAvail += h.availableBeds || 0;
      totalCap += h.totalBeds || 0;
      if (h.hasWardBreakdown) {
        if (typeof h.wards?.icu?.available === 'number') verifiedIcu += h.wards.icu.available;
        if (typeof h.wards?.er?.available === 'number') verifiedEr += h.wards.er.available;
        if (typeof h.wards?.general?.available === 'number') verifiedGeneral += h.wards.general.available;
      }
    });

    return { totalAvail, totalCap, verifiedIcu, verifiedEr, verifiedGeneral };
  }, [capacities]);

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (searchQuery.trim()) count++;
    if (selectedWardFilter !== 'ALL') count++;
    if (selectedFreshnessFilter !== 'ALL') count++;
    if (selectedScopeFilter !== 'ALL') count++;
    if (availableOnly) count++;
    return count;
  }, [searchQuery, selectedWardFilter, selectedFreshnessFilter, selectedScopeFilter, availableOnly]);

  const resetAllFilters = () => {
    setSearchQuery('');
    setSelectedWardFilter('ALL');
    setSelectedFreshnessFilter('ALL');
    setSelectedScopeFilter('ALL');
    setAvailableOnly(false);
  };

  // Submit Admission Enquiry
  const handleAdmissionEnquirySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedHospital) return;
    setEnquirySubmitting(true);
    setEnquirySuccessMsg('');
    setEnquiryErrorMsg('');

    try {
      const res = await apiFetch('/hospitals/bookings', {
        method: 'POST',
        body: JSON.stringify({
          hospitalId: selectedHospital.id,
          bookingType: 'BED_RESERVATION',
          department: enquiryForm.department,
          triageLevel: enquiryForm.priority,
          symptoms: enquiryForm.symptoms.trim(),
          scheduledDate: enquiryForm.targetTime ? new Date(enquiryForm.targetTime).toISOString() : undefined,
          patientName: user?.name,
          patientPhone: user?.phone,
        }),
      });

      setEnquirySuccessMsg(
        `Admission enquiry registered (#${res.id?.slice(-6).toUpperCase() || 'ENQ'}). The hospital admissions coordinator will review and confirm bed readiness upon triage.`
      );
      await fetchMyBookings();
      setTimeout(() => {
        setEnquiryModalOpen(false);
        setEnquirySuccessMsg('');
      }, 2500);
    } catch (err: any) {
      console.error('Admission enquiry submission failed:', err);
      setEnquiryErrorMsg(err.message || 'Failed to submit admission enquiry. Please call the hospital casualty desk directly.');
    } finally {
      setEnquirySubmitting(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* 1. HEADER & VERIFICATION DISCLAIMER */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-3xl p-6 sm:p-8 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-100 dark:border-slate-800">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              <span className="text-[11px] font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
                Hospital Operations Hub
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
              Hospital Bed Availability
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-2xl leading-relaxed">
              Reported ward and critical care capacities across partner centers. Availability must always be confirmed directly with the receiving hospital desk prior to arrival.
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              fetchCapacities();
              fetchMyBookings();
            }}
            disabled={loading || bookingsLoading}
            className="px-4 py-2.5 bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold transition-all flex items-center gap-2 self-start md:self-auto cursor-pointer border border-slate-200/80 dark:border-slate-700 shadow-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading || bookingsLoading ? 'animate-spin' : ''}`} />
            <span>Refresh Availability</span>
          </button>
        </div>

        {/* 2. REPUTABLE CAPACITY METRIC OVERVIEW */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 pt-6">
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/60 dark:border-slate-800">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
              Connected Centers
            </span>
            <p className="text-2xl font-black text-slate-900 dark:text-slate-100">
              {capacities.length}
            </p>
            <span className="text-3xs text-slate-500 dark:text-slate-400">Partner hospital facilities</span>
          </div>

          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/60 dark:border-slate-800">
            <span className="text-[10px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400 block mb-1">
              Verified ICU Beds
            </span>
            <p className="text-2xl font-black text-rose-600 dark:text-rose-400">
              {aggregateMetrics.verifiedIcu}
            </p>
            <span className="text-3xs text-slate-500 dark:text-slate-400">Across verified ward feeds</span>
          </div>

          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/60 dark:border-slate-800">
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 block mb-1">
              Verified ER Trauma Bays
            </span>
            <p className="text-2xl font-black text-amber-600 dark:text-amber-400">
              {aggregateMetrics.verifiedEr}
            </p>
            <span className="text-3xs text-slate-500 dark:text-slate-400">Resuscitation capacity</span>
          </div>

          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/60 dark:border-slate-800">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 block mb-1">
              Total Reported Available
            </span>
            <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400">
              {aggregateMetrics.totalAvail}
            </p>
            <span className="text-3xs text-slate-500 dark:text-slate-400">
              Of {aggregateMetrics.totalCap} overall capacity
            </span>
          </div>
        </div>

        {/* 3. SEARCH & REFINED FILTERS */}
        <div className="mt-6 pt-5 border-t border-slate-100 dark:border-slate-800 space-y-3.5">
          <div className="flex flex-col sm:flex-row gap-2.5">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter by hospital name, locality, or address (e.g. GMCH, Mayo, Max, Mankapur)..."
                className="w-full bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 rounded-2xl pl-11 pr-10 py-3 text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowFilters((prev) => !prev)}
              className={`px-4 py-3 rounded-2xl border transition-all cursor-pointer flex items-center justify-center gap-1.5 text-xs font-bold ${
                showFilters || activeFiltersCount > 0
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                  : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100'
              }`}
            >
              <SlidersHorizontal className="w-4 h-4" />
              <span>Filters</span>
              {activeFiltersCount > 0 && (
                <span className="w-4 h-4 rounded-full bg-emerald-600 text-white text-[10px] font-bold flex items-center justify-center">
                  {activeFiltersCount}
                </span>
              )}
            </button>
          </div>

          {/* Quick Filter Badges */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500 mr-1">Wards:</span>
            <button
              type="button"
              onClick={() => setSelectedWardFilter('ALL')}
              className={`px-3 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                selectedWardFilter === 'ALL'
                  ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
              }`}
            >
              All Wards
            </button>
            <button
              type="button"
              onClick={() => setSelectedWardFilter('ICU')}
              className={`px-3 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                selectedWardFilter === 'ICU'
                  ? 'bg-rose-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
              }`}
            >
              ICU Available
            </button>
            <button
              type="button"
              onClick={() => setSelectedWardFilter('ER')}
              className={`px-3 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                selectedWardFilter === 'ER'
                  ? 'bg-amber-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
              }`}
            >
              ER Bay Available
            </button>
            <button
              type="button"
              onClick={() => setSelectedWardFilter('GENERAL')}
              className={`px-3 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                selectedWardFilter === 'GENERAL'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
              }`}
            >
              General Ward Available
            </button>
            <button
              type="button"
              onClick={() => setSelectedWardFilter('PEDIATRIC')}
              className={`px-3 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                selectedWardFilter === 'PEDIATRIC'
                  ? 'bg-purple-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
              }`}
            >
              Pediatric Ward Available
            </button>
          </div>

          {/* Secondary Panel */}
          {showFilters && (
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-3 gap-3 animate-in fade-in duration-200">
              <div>
                <label className="text-3xs font-bold text-slate-500 block mb-1">Data Freshness</label>
                <select
                  value={selectedFreshnessFilter}
                  onChange={(e) => setSelectedFreshnessFilter(e.target.value as any)}
                  className="w-full p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300"
                >
                  <option value="ALL">All Updates</option>
                  <option value="VERIFIED_RECENT">Recently Verified (≤30m)</option>
                  <option value="STALE">Stale Updates (&gt;30m)</option>
                </select>
              </div>

              <div>
                <label className="text-3xs font-bold text-slate-500 block mb-1">Geographic Scope</label>
                <select
                  value={selectedScopeFilter}
                  onChange={(e) => setSelectedScopeFilter(e.target.value as any)}
                  className="w-full p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300"
                >
                  <option value="ALL">Entire District</option>
                  <option value="NAGPUR_CITY">Nagpur Urban</option>
                  <option value="RURAL">Rural Tehsils</option>
                </select>
              </div>

              <div className="flex items-end">
                <label className="flex items-center gap-2 p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full cursor-pointer text-xs font-semibold text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={availableOnly}
                    onChange={(e) => setAvailableOnly(e.target.checked)}
                    className="rounded text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>Has Available Beds Only</span>
                </label>
              </div>
            </div>
          )}

          {activeFiltersCount > 0 && (
            <div className="flex items-center gap-2 pt-1 text-2xs">
              <span className="text-slate-400">Filtering active.</span>
              <button
                type="button"
                onClick={resetAllFilters}
                className="text-emerald-600 dark:text-emerald-400 hover:underline font-bold cursor-pointer"
              >
                Reset filters
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 4. ACTIVE ADMISSION ENQUIRIES SECTION */}
      {myBookings.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <CalendarCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                My Hospital Admissions & Enquiries
              </h3>
            </div>
            <span className="text-2xs font-semibold text-slate-400">
              {myBookings.length} {myBookings.length === 1 ? 'Record' : 'Records'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {myBookings.map((b) => (
              <div
                key={b.id}
                className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-4 shadow-xs space-y-2.5"
              >
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-3xs font-extrabold uppercase px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                      {b.bookingType?.replace(/_/g, ' ')}
                    </span>
                    <span className="text-3xs font-mono text-slate-400">#{b.id.slice(-6).toUpperCase()}</span>
                  </div>
                  <span
                    className={`text-3xs font-bold uppercase px-2 py-0.5 rounded-full ${
                      b.status === 'CONFIRMED'
                        ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                        : b.status === 'ADMITTED'
                        ? 'bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800'
                        : 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                    }`}
                  >
                    {b.status === 'PENDING' ? 'Enquiry Pending Review' : b.status}
                  </span>
                </div>

                <div>
                  <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5 text-slate-400" />
                    <span>{b.hospital?.name || 'Hospital Facility'}</span>
                  </h4>
                  {b.hospital?.address && (
                    <p className="text-3xs text-slate-400 pl-5 truncate">{b.hospital.address}</p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200/50 dark:border-slate-800 text-3xs">
                  <div>
                    <span className="text-slate-400 block font-semibold uppercase">Designated Ward</span>
                    <span className="font-bold text-slate-700 dark:text-slate-300 mt-0.5 block">
                      {b.assignedBed ? `${b.assignedBed.bedNumber} (${b.assignedBed.ward})` : 'Triage Assessment'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block font-semibold uppercase">Department</span>
                    <span className="font-bold text-slate-700 dark:text-slate-300 mt-0.5 block">
                      {b.department || 'General Medicine'}
                    </span>
                  </div>
                </div>

                {b.symptoms && (
                  <p className="text-3xs text-slate-500 italic pl-1">
                    Note: {b.symptoms}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 5. LOADING SKELETON */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-5">
          {[1, 2].map((n) => (
            <div
              key={n}
              className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-3xl p-6 flex flex-col gap-4 animate-pulse"
            >
              <div className="flex justify-between">
                <div className="h-5 bg-slate-200 dark:bg-slate-800 rounded w-1/3" />
                <div className="h-5 bg-slate-200 dark:bg-slate-800 rounded w-1/5" />
              </div>
              <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded w-1/2" />
              <div className="grid grid-cols-4 gap-2 my-2">
                {[1, 2, 3, 4].map((w) => (
                  <div key={w} className="h-16 bg-slate-200 dark:bg-slate-800 rounded-xl" />
                ))}
              </div>
              <div className="h-10 bg-slate-200 dark:bg-slate-800 rounded-xl" />
            </div>
          ))}
        </div>
      )}

      {/* 6. ERROR STATE */}
      {!loading && error && (
        <div className="p-8 rounded-3xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-center flex flex-col items-center justify-center gap-3">
          <AlertCircle className="w-8 h-8 text-rose-500" />
          <h3 className="text-sm font-bold text-rose-900 dark:text-rose-200">Unable to Query Hospital Capacities</h3>
          <p className="text-xs text-rose-700 dark:text-rose-300 max-w-md">{error}</p>
          <button
            type="button"
            onClick={fetchCapacities}
            className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
          >
            Retry Connection
          </button>
        </div>
      )}

      {/* 7. EMPTY RESULTS STATE */}
      {!loading && !error && filteredHospitals.length === 0 && (
        <div className="bg-white dark:bg-slate-900 border border-dashed border-slate-300 dark:border-slate-800 rounded-3xl p-10 flex flex-col items-center justify-center text-center gap-3">
          <Building2 className="w-8 h-8 text-slate-400" />
          <h3 className="text-base font-bold text-slate-800 dark:text-slate-200">
            No Hospitals Match Filter Criteria
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md">
            No partner hospitals matched your current search and ward filters.
          </p>
          <button
            type="button"
            onClick={resetAllFilters}
            className="text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
          >
            Reset all filters
          </button>
        </div>
      )}

      {/* 8. HOSPITAL CARDS GRID */}
      {!loading && !error && filteredHospitals.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {filteredHospitals.map((h) => {
            const hasAvailableBeds = h.availableBeds > 0;
            const cleanPhone = (h.contactNumber || '').replace(/[^0-9+]/g, '');

            return (
              <div
                key={h.id}
                className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-3xl p-6 shadow-sm hover:shadow-md transition-all flex flex-col justify-between gap-5"
              >
                <div className="space-y-4">
                  {/* Top Bar: Hospital Title & Available Counter */}
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-3xs font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                          {h.locality || 'Nagpur Zone'}
                        </span>
                        <span className="text-3xs px-2 py-0.2 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-medium">
                          {h.dataSourceLabel}
                        </span>
                      </div>
                      <h3 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-slate-100 leading-snug">
                        {h.name}
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex items-start gap-1">
                        <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                        <span>{h.address}</span>
                      </p>
                    </div>

                    <div className="text-right shrink-0">
                      <span
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider ${
                          hasAvailableBeds
                            ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        <Bed className="w-3.5 h-3.5" />
                        <span>{h.availableBeds} Available</span>
                      </span>
                      <span className="text-3xs font-medium text-slate-400 block mt-1">
                        Total Capacity: {h.totalBeds}
                      </span>
                    </div>
                  </div>

                  {/* Stale Data Warning Banner (Only when verified >30 mins ago) */}
                  {h.isStale && (
                    <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 rounded-2xl flex items-start gap-2.5 text-xs text-amber-900 dark:text-amber-200">
                      <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                      <div className="leading-snug text-3xs">
                        <strong className="font-bold block text-amber-800 dark:text-amber-300">
                          Data Freshness Notice ({h.ageMinutes}m since desk verification)
                        </strong>
                        <span>Call facility directly to confirm immediate room reservation before transport.</span>
                      </div>
                    </div>
                  )}

                  {/* Occupancy Progress Bar */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-3xs font-semibold text-slate-500 dark:text-slate-400">
                      <span>Facility Occupancy</span>
                      <span>{h.occupancyPercent}% Occupied</span>
                    </div>
                    <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          h.occupancyPercent > 85
                            ? 'bg-rose-500'
                            : h.occupancyPercent > 60
                            ? 'bg-amber-500'
                            : 'bg-emerald-500'
                        }`}
                        style={{ width: `${Math.min(100, Math.max(5, h.occupancyPercent))}%` }}
                      />
                    </div>
                  </div>

                  {/* Ward Breakdown Cards (Truthful values: Never 0 when missing!) */}
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 block mb-2">
                      Ward Capacities Breakdown
                    </span>
                    <div className="grid grid-cols-4 gap-2">
                      {/* ICU */}
                      <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/60 dark:border-slate-800 text-center">
                        <span className="text-3xs font-bold text-slate-400 block mb-1">ICU</span>
                        {h.hasWardBreakdown && typeof h.wards?.icu?.available === 'number' ? (
                          <>
                            <span className="text-xs font-black text-rose-600 dark:text-rose-400 block">
                              {h.wards.icu.available}
                            </span>
                            <span className="text-4xs text-slate-400 font-mono">/ {h.wards.icu.total ?? '—'}</span>
                          </>
                        ) : (
                          <span className="text-3xs font-semibold text-slate-400 block py-1">Call Desk</span>
                        )}
                      </div>

                      {/* ER Bay */}
                      <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/60 dark:border-slate-800 text-center">
                        <span className="text-3xs font-bold text-slate-400 block mb-1">ER Bay</span>
                        {h.hasWardBreakdown && typeof h.wards?.er?.available === 'number' ? (
                          <>
                            <span className="text-xs font-black text-amber-600 dark:text-amber-400 block">
                              {h.wards.er.available}
                            </span>
                            <span className="text-4xs text-slate-400 font-mono">/ {h.wards.er.total ?? '—'}</span>
                          </>
                        ) : (
                          <span className="text-3xs font-semibold text-slate-400 block py-1">Call Desk</span>
                        )}
                      </div>

                      {/* General */}
                      <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/60 dark:border-slate-800 text-center">
                        <span className="text-3xs font-bold text-slate-400 block mb-1">General</span>
                        {h.hasWardBreakdown && typeof h.wards?.general?.available === 'number' ? (
                          <>
                            <span className="text-xs font-black text-blue-600 dark:text-blue-400 block">
                              {h.wards.general.available}
                            </span>
                            <span className="text-4xs text-slate-400 font-mono">/ {h.wards.general.total ?? '—'}</span>
                          </>
                        ) : (
                          <span className="text-3xs font-semibold text-slate-400 block py-1">Call Desk</span>
                        )}
                      </div>

                      {/* Pediatric */}
                      <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/60 dark:border-slate-800 text-center">
                        <span className="text-3xs font-bold text-slate-400 block mb-1">Pediatric</span>
                        {h.hasWardBreakdown && typeof h.wards?.pediatric?.available === 'number' ? (
                          <>
                            <span className="text-xs font-black text-purple-600 dark:text-purple-400 block">
                              {h.wards.pediatric.available}
                            </span>
                            <span className="text-4xs text-slate-400 font-mono">/ {h.wards.pediatric.total ?? '—'}</span>
                          </>
                        ) : (
                          <span className="text-3xs font-semibold text-slate-400 block py-1">Call Desk</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Verification timestamp */}
                  <div className="flex items-center justify-between text-3xs text-slate-400 pt-1">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3 text-slate-400" />
                      <span>Verified: {h.ageMinutes > 0 ? `${h.ageMinutes}m ago` : 'recently'}</span>
                    </span>
                    <span>Direct Desk: <strong className="text-slate-700 dark:text-slate-300 font-mono">{formatIndianPhone(h.contactNumber)}</strong></span>
                  </div>
                </div>

                {/* Bottom Separated Action Buttons (Requirement 4) */}
                <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-2.5">
                  <div className="grid grid-cols-2 gap-2">
                    {/* 1. Direct Call Action */}
                    <a
                      href={`tel:${cleanPhone}`}
                      className="flex items-center justify-center gap-1.5 py-2.5 px-3 bg-slate-900 hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs"
                      title="Call hospital admission coordinator directly"
                    >
                      <Phone className="w-3.5 h-3.5" />
                      <span>Call Hospital</span>
                    </a>

                    {/* 2. Direct Navigation Action */}
                    <a
                      href={
                        h.lat && h.lng
                          ? `https://www.google.com/maps/dir/?api=1&destination=${h.lat},${h.lng}`
                          : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(h.name + ', ' + h.address)}`
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-1.5 py-2.5 px-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold transition-all"
                    >
                      <Navigation className="w-3.5 h-3.5 text-blue-500" />
                      <span>Directions</span>
                    </a>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {/* 3. Inpatient Admission Enquiry (Distinct Workflow) */}
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedHospital(h);
                        setEnquiryModalOpen(true);
                        setEnquirySuccessMsg('');
                        setEnquiryErrorMsg('');
                      }}
                      className="py-2.5 px-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-slate-300 text-slate-700 dark:text-slate-300 text-xs font-bold transition-all hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Bed className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                      <span>Admission Enquiry</span>
                    </button>

                    {/* 4. Specialist Consultation (Distinct Workflow) */}
                    <button
                      type="button"
                      onClick={() => {
                        if (onNavigateTab) {
                          onNavigateTab('APPOINTMENTS');
                        }
                      }}
                      className="py-2.5 px-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-slate-300 text-slate-700 dark:text-slate-300 text-xs font-bold transition-all hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Stethoscope className="w-3.5 h-3.5 text-blue-500" />
                      <span>Book OPD Consult</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 9. ADMISSION ENQUIRY MODAL (Formal Workflow, Non-ambiguous) */}
      {enquiryModalOpen && selectedHospital && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 max-w-lg w-full shadow-2xl space-y-5 relative max-h-[90vh] overflow-y-auto">
            <button
              type="button"
              onClick={() => setEnquiryModalOpen(false)}
              className="absolute top-6 right-6 p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl"
            >
              <X className="w-5 h-5" />
            </button>

            <div>
              <span className="text-3xs font-extrabold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                Hospital Inpatient Services
              </span>
              <h3 className="text-xl font-extrabold text-slate-900 dark:text-slate-100 mt-1">
                Request Admission Enquiry
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Hospital: <strong className="text-slate-700 dark:text-slate-300">{selectedHospital.name}</strong>
              </p>
            </div>

            {/* Mandatory Medical Disclaimer Notice */}
            <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 flex items-start gap-2.5 text-xs text-amber-900 dark:text-amber-200">
              <Info className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="leading-relaxed text-3xs">
                <strong className="font-bold block text-amber-800 dark:text-amber-300">
                  Admission Policy Notice
                </strong>
                Submitting an enquiry notifies the hospital admission desk. It does not constitute a guaranteed bed reservation until triage confirmation is provided upon patient arrival. In acute life-threatening emergency, call 112 directly.
              </div>
            </div>

            {enquirySuccessMsg ? (
              <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs font-semibold leading-relaxed space-y-1">
                <div className="flex items-center gap-2 font-bold text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Enquiry Registered Successfully</span>
                </div>
                <p className="text-3xs">{enquirySuccessMsg}</p>
              </div>
            ) : (
              <form onSubmit={handleAdmissionEnquirySubmit} className="space-y-4">
                {enquiryErrorMsg && (
                  <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs text-rose-700 dark:text-rose-300">
                    {enquiryErrorMsg}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-3xs font-bold text-slate-500 block mb-1">
                      Clinical Department
                    </label>
                    <select
                      value={enquiryForm.department}
                      onChange={(e) => setEnquiryForm({ ...enquiryForm, department: e.target.value })}
                      className="w-full p-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                    >
                      <option value="Emergency Medicine">Emergency Medicine</option>
                      <option value="General Medicine">General Medicine</option>
                      <option value="Cardiology">Cardiology</option>
                      <option value="Trauma Surgery">Trauma Surgery</option>
                      <option value="Neurology">Neurology</option>
                      <option value="Orthopedics">Orthopedics</option>
                      <option value="Pediatrics">Pediatrics</option>
                      <option value="Pulmonology">Pulmonology</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-3xs font-bold text-slate-500 block mb-1">
                      Triage Urgency
                    </label>
                    <select
                      value={enquiryForm.priority}
                      onChange={(e) => setEnquiryForm({ ...enquiryForm, priority: e.target.value })}
                      className="w-full p-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                    >
                      <option value="YELLOW_URGENT">Urgent (Yellow Code)</option>
                      <option value="STANDARD">Standard Care (Planned)</option>
                      <option value="RED_CRITICAL">Critical (Code Red Emergency)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-3xs font-bold text-slate-500 block mb-1">
                    Estimated Time of Arrival
                  </label>
                  <input
                    type="datetime-local"
                    value={enquiryForm.targetTime}
                    onChange={(e) => setEnquiryForm({ ...enquiryForm, targetTime: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                  />
                </div>

                <div>
                  <label className="text-3xs font-bold text-slate-500 block mb-1">
                    Chief Complaint / Reason for Admission *
                  </label>
                  <textarea
                    rows={3}
                    required
                    placeholder="Describe symptoms, referral notes, or clinical status..."
                    value={enquiryForm.symptoms}
                    onChange={(e) => setEnquiryForm({ ...enquiryForm, symptoms: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 resize-none"
                  />
                </div>

                <div className="flex items-center justify-end gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => setEnquiryModalOpen(false)}
                    className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={enquirySubmitting}
                    className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer disabled:opacity-50"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{enquirySubmitting ? 'Submitting Enquiry...' : 'Submit Admission Enquiry'}</span>
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
