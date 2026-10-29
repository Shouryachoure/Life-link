import React, { useState, useEffect, useMemo } from 'react';
import {
  Calendar,
  Clock,
  MapPin,
  Stethoscope,
  Search,
  CheckCircle2,
  AlertCircle,
  Building2,
  RefreshCw,
  Phone,
  Ticket,
  ChevronRight,
  User,
  X,
  AlertTriangle,
  Lock,
  History,
  Repeat,
  ExternalLink,
  ShieldCheck,
  BadgeInfo,
  Award,
} from 'lucide-react';
import { MEDICAL_SPECIALIZATIONS } from '../../constants/specializations';

interface BookAppointmentSectionProps {
  apiFetch: (url: string, options?: any) => Promise<any>;
  patientLat?: number;
  patientLng?: number;
}

export const BookAppointmentSection: React.FC<BookAppointmentSectionProps> = ({
  apiFetch,
  patientLat,
  patientLng,
}) => {
  // Geolocation & Hospital state
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(
    patientLat && patientLng ? { lat: patientLat, lng: patientLng } : null
  );
  const [geoDenied, setGeoDenied] = useState(false);
  const [locating, setLocating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hospitals, setHospitals] = useState<any[]>([]);
  const [loadingHospitals, setLoadingHospitals] = useState(false);
  const [hospitalSearch, setHospitalSearch] = useState('');
  const [selectedHospital, setSelectedHospital] = useState<any | null>(null);

  // Doctor & Specialization state
  const [specializationFilter, setSpecializationFilter] = useState<string>('ALL');
  const [doctorSearch, setDoctorSearch] = useState('');
  const [doctors, setDoctors] = useState<any[]>([]);
  const [loadingDoctors, setLoadingDoctors] = useState(false);
  const [selectedDoctor, setSelectedDoctor] = useState<any | null>(null);

  // Time Slot & Date state
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [slots, setSlots] = useState<any[]>([]);
  const [doctorOnLeave, setDoctorOnLeave] = useState(false);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<any | null>(null);

  // Booking Modal & Symptoms
  const [bookingModalOpen, setBookingModalOpen] = useState(false);
  const [symptomsInput, setSymptomsInput] = useState('');
  const [bookingLoading, setBookingLoading] = useState(false);
  const [bookingError, setBookingError] = useState('');
  const [confirmedAppointment, setConfirmedAppointment] = useState<any | null>(null);

  // Patient's Existing Appointments
  const [myAppointments, setMyAppointments] = useState<any[]>([]);
  const [loadingMyAppointments, setLoadingMyAppointments] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  // Rescheduling Modal State
  const [reschedulingAppointment, setReschedulingAppointment] = useState<any | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [rescheduleSlots, setRescheduleSlots] = useState<any[]>([]);
  const [loadingRescheduleSlots, setLoadingRescheduleSlots] = useState(false);
  const [selectedRescheduleSlot, setSelectedRescheduleSlot] = useState<any | null>(null);
  const [rescheduleReason, setRescheduleReason] = useState('');
  const [reschedulingLoading, setReschedulingLoading] = useState(false);
  const [rescheduleError, setRescheduleError] = useState('');

  // Audit Trail Viewer Modal State
  const [auditModalAppointmentId, setAuditModalAppointmentId] = useState<string | null>(null);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);

  // 1. Initial Geolocation Request
  useEffect(() => {
    requestUserLocation();
    fetchMyAppointments();
  }, []);

  const requestUserLocation = () => {
    if (!navigator.geolocation) {
      setGeoDenied(true);
      fetchHospitals(null, null, hospitalSearch);
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserCoords(coords);
        setGeoDenied(false);
        setLocating(false);
        fetchHospitals(coords.lat, coords.lng, hospitalSearch);
      },
      (err) => {
        console.warn('Geolocation denied or unavailable:', err.message);
        setGeoDenied(true);
        setLocating(false);
        fetchHospitals(null, null, hospitalSearch);
      },
      { timeout: 8000, enableHighAccuracy: false }
    );
  };

  // 2. Fetch Nearby Hospitals
  const fetchHospitals = async (lat: number | null, lng: number | null, searchStr: string) => {
    setLoadingHospitals(true);
    try {
      let query = '';
      if (lat !== null && lng !== null) {
        query += `lat=${lat}&lng=${lng}&radius=15`;
      }
      if (searchStr.trim()) {
        query += (query ? '&' : '') + `search=${encodeURIComponent(searchStr.trim())}`;
      }

      const res = await apiFetch(`/hospitals/nearby?${query}`);
      const list = res.hospitals || [];
      setHospitals(list);
      if (list.length > 0 && !selectedHospital) {
        setSelectedHospital(list[0]);
      }
    } catch (err: any) {
      console.error('Failed to load nearby hospitals:', err);
    } finally {
      setLoadingHospitals(false);
    }
  };

  // Unified real backend refresh
  const handleRefreshAll = async () => {
    setRefreshing(true);
    try {
      await fetchHospitals(userCoords?.lat || null, userCoords?.lng || null, hospitalSearch);
      if (selectedHospital) {
        await fetchDoctors(selectedHospital.id, specializationFilter);
      }
      if (selectedDoctor && selectedDoctor.bookingEnabled !== false && selectedDate) {
        await fetchDoctorSlots(selectedDoctor.id, selectedDate);
      }
      await fetchMyAppointments();
    } catch (err) {
      console.error('Error refreshing directory data:', err);
    } finally {
      setRefreshing(false);
    }
  };

  // 3. Fetch Doctors for Selected Hospital & Specialization
  useEffect(() => {
    if (selectedHospital) {
      fetchDoctors(selectedHospital.id, specializationFilter);
    }
  }, [selectedHospital, specializationFilter]);

  const fetchDoctors = async (hospitalId: string, spec: string) => {
    setLoadingDoctors(true);
    try {
      let url = `/hospitals/${hospitalId}/doctors`;
      if (spec !== 'ALL') {
        url += `?specialization=${encodeURIComponent(spec)}`;
      }
      const data = await apiFetch(url);
      if (data && Array.isArray(data.doctors)) {
        setDoctors(data.doctors);
      } else if (Array.isArray(data)) {
        setDoctors(data);
      } else {
        // Fallback to /doctors endpoint
        let fallbackUrl = `/doctors?hospitalId=${hospitalId}`;
        if (spec !== 'ALL') fallbackUrl += `&specialization=${encodeURIComponent(spec)}`;
        const fallback = await apiFetch(fallbackUrl);
        setDoctors(fallback || []);
      }
      setSelectedDoctor(null);
      setSlots([]);
      setSelectedSlot(null);
    } catch (err) {
      console.error('Failed to load doctors via /hospitals/:id/doctors, trying fallback:', err);
      try {
        let fallbackUrl = `/doctors?hospitalId=${hospitalId}`;
        if (spec !== 'ALL') fallbackUrl += `&specialization=${encodeURIComponent(spec)}`;
        const fallback = await apiFetch(fallbackUrl);
        setDoctors(fallback || []);
      } catch (fErr) {
        console.error('Fallback also failed:', fErr);
        setDoctors([]);
      }
    } finally {
      setLoadingDoctors(false);
    }
  };

  // Dynamic specialties list extracted from real doctors at this facility
  const dynamicSpecialties = useMemo(() => {
    const set = new Set<string>();
    for (const doc of doctors) {
      if (doc.specialization) {
        set.add(doc.specialization.trim());
      }
      if (Array.isArray(doc.specialtiesList)) {
        doc.specialtiesList.forEach((s: string) => {
          if (s && s.trim()) set.add(s.trim());
        });
      }
    }
    return Array.from(set).sort();
  }, [doctors]);

  // Filter doctors by search query across name, specialization, designation, qualifications
  const filteredDoctors = useMemo(() => {
    if (!doctorSearch.trim()) return doctors;
    const q = doctorSearch.trim().toLowerCase();
    return doctors.filter((doc) => {
      const nameMatch = doc.name?.toLowerCase().includes(q);
      const specMatch = doc.specialization?.toLowerCase().includes(q);
      const desigMatch = doc.designation?.toLowerCase().includes(q);
      const qualMatch = doc.qualifications?.toLowerCase().includes(q);
      const listMatch = Array.isArray(doc.specialtiesList) && doc.specialtiesList.some((s: string) => s.toLowerCase().includes(q));
      return nameMatch || specMatch || desigMatch || qualMatch || listMatch;
    });
  }, [doctors, doctorSearch]);

  // 4. Fetch Slots for Selected Doctor and Date
  useEffect(() => {
    if (selectedDoctor && selectedDate) {
      fetchDoctorSlots(selectedDoctor.id, selectedDate);
    }
  }, [selectedDoctor, selectedDate]);

  const fetchDoctorSlots = async (doctorId: string, dateStr: string) => {
    setLoadingSlots(true);
    try {
      const data = await apiFetch(`/doctors/${doctorId}/slots?date=${dateStr}`);
      setSlots(data.slots || []);
      setDoctorOnLeave(Boolean(data.doctorOnLeave));
      setSelectedSlot(null);
    } catch (err) {
      console.error('Failed to load doctor slots:', err);
      setSlots([]);
      setDoctorOnLeave(false);
    } finally {
      setLoadingSlots(false);
    }
  };

  // Fetch Slots for Rescheduling
  useEffect(() => {
    if (reschedulingAppointment && rescheduleDate) {
      fetchRescheduleSlots(reschedulingAppointment.doctorId, rescheduleDate);
    }
  }, [reschedulingAppointment, rescheduleDate]);

  const fetchRescheduleSlots = async (doctorId: string, dateStr: string) => {
    setLoadingRescheduleSlots(true);
    try {
      const data = await apiFetch(`/doctors/${doctorId}/slots?date=${dateStr}`);
      const available = (data.slots || []).filter(
        (s: any) => s.id !== reschedulingAppointment?.slotId
      );
      setRescheduleSlots(available);
      setSelectedRescheduleSlot(null);
    } catch (err) {
      console.error('Failed to load slots for reschedule:', err);
      setRescheduleSlots([]);
    } finally {
      setLoadingRescheduleSlots(false);
    }
  };

  // 5. Fetch Patient's Booked Appointments
  const fetchMyAppointments = async () => {
    setLoadingMyAppointments(true);
    try {
      const list = await apiFetch('/appointments/my');
      setMyAppointments(list);
    } catch (err) {
      console.error('Failed to fetch patient appointments:', err);
    } finally {
      setLoadingMyAppointments(false);
    }
  };

  // 6. Transactional Atomic Booking with Idempotency Key & Debouncing
  const handleConfirmBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSlot || bookingLoading) return; // Prevent repeated taps

    setBookingLoading(true);
    setBookingError('');

    try {
      const idempotencyKey = `apt_${selectedSlot.id}_${Date.now()}`;
      const res = await apiFetch('/appointments', {
        method: 'POST',
        headers: {
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          slotId: selectedSlot.id,
          symptoms: symptomsInput.trim() || undefined,
          idempotencyKey,
        }),
      });

      setConfirmedAppointment(res.appointment);
      setBookingModalOpen(false);
      setSymptomsInput(''); // Only reset draft symptoms input on success!

      if (selectedDoctor && selectedDate) {
        fetchDoctorSlots(selectedDoctor.id, selectedDate);
      }
      fetchMyAppointments();
    } catch (err: any) {
      // User draft input (symptomsInput) is intentionally preserved after error
      setBookingError(err.message || 'Failed to book appointment. Slot may be fully booked or blocked.');
    } finally {
      setBookingLoading(false);
    }
  };

  // Reconnect recovery: reconcile authoritative appointments and slots
  useEffect(() => {
    const handleReconnected = () => {
      fetchMyAppointments();
      if (selectedDoctor && selectedDate) {
        fetchDoctorSlots(selectedDoctor.id, selectedDate);
      }
    };
    window.addEventListener('lifelink:reconnected', handleReconnected);
    return () => window.removeEventListener('lifelink:reconnected', handleReconnected);
  }, [selectedDoctor?.id, selectedDate]);

  // 7. Cancel Appointment
  const handleCancelAppointment = async (appointmentId: string) => {
    if (!confirm('Are you sure you want to cancel this appointment? Your reserved token will be released.')) return;
    setCancellingId(appointmentId);
    try {
      await apiFetch(`/appointments/${appointmentId}/cancel`, {
        method: 'PUT',
        body: JSON.stringify({ reason: 'Cancelled by patient' }),
      });
      fetchMyAppointments();
      if (selectedDoctor && selectedDate) {
        fetchDoctorSlots(selectedDoctor.id, selectedDate);
      }
    } catch (err: any) {
      alert(err.message || 'Failed to cancel appointment');
    } finally {
      setCancellingId(null);
    }
  };

  // 8. Reschedule Appointment
  const handleConfirmReschedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reschedulingAppointment || !selectedRescheduleSlot) return;

    setReschedulingLoading(true);
    setRescheduleError('');

    try {
      const res = await apiFetch(`/appointments/${reschedulingAppointment.id}/reschedule`, {
        method: 'POST',
        body: JSON.stringify({
          targetSlotId: selectedRescheduleSlot.id,
          reason: rescheduleReason.trim() || 'Rescheduled by patient',
        }),
      });

      setConfirmedAppointment(res.appointment);
      setReschedulingAppointment(null);
      setSelectedRescheduleSlot(null);
      setRescheduleReason('');

      fetchMyAppointments();
      if (selectedDoctor && selectedDate) {
        fetchDoctorSlots(selectedDoctor.id, selectedDate);
      }
    } catch (err: any) {
      setRescheduleError(err.message || 'Failed to reschedule appointment. Target slot may be full.');
    } finally {
      setReschedulingLoading(false);
    }
  };

  // 9. View Audit Trail
  const handleViewAuditTrail = async (appointmentId: string) => {
    setAuditModalAppointmentId(appointmentId);
    setLoadingAudit(true);
    setAuditLogs([]);
    try {
      const res = await apiFetch(`/appointments/${appointmentId}/audit-trail`);
      setAuditLogs(res.auditLogs || []);
    } catch (err: any) {
      console.error('Failed to load audit trail:', err);
    } finally {
      setLoadingAudit(false);
    }
  };

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* -------------------------------------------------------------
          Section Header & Geolocation Status
          ------------------------------------------------------------- */}
      <div className="bg-white dark:bg-slate-950 border border-gray-200 dark:border-slate-800 rounded-3xl p-6 md:p-8 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-2xl bg-rose-600/10 text-rose-600 dark:text-rose-400 flex items-center justify-center">
                <Calendar className="w-5 h-5" />
              </div>
              <h2 className="text-xl font-black text-slate-900 dark:text-white">
                Book Doctor Appointment
              </h2>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Select nearby hospital, choose your specialist, pick an hourly slot, and receive your priority OPD token.
            </p>
          </div>

          {/* Geolocation & Unified Refresh Directory Button */}
          <div className="flex items-center gap-2 self-start md:self-auto flex-wrap">
            {userCoords && !geoDenied ? (
              <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-bold border border-emerald-500/20">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                Live GPS Active
              </span>
            ) : (
              <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs font-bold border border-amber-500/20">
                <AlertCircle className="w-3.5 h-3.5" />
                GPS Inactive (Fallback Search)
              </span>
            )}
            <button
              onClick={handleRefreshAll}
              disabled={refreshing || loadingHospitals || loadingDoctors}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-gray-50 dark:hover:bg-slate-900 transition-colors cursor-pointer text-xs font-bold"
              title="Reload all hospital records and doctor directories from backend"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              <span>{refreshing ? 'Refreshing...' : 'Refresh Directory'}</span>
            </button>
          </div>
        </div>

        {/* Search Bar for Hospital Fallback */}
        <div className="mt-6 flex gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search hospital by name, alias (e.g. Alexis, Max), locality, or specialty..."
              value={hospitalSearch}
              onChange={(e) => setHospitalSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  fetchHospitals(
                    userCoords?.lat || null,
                    userCoords?.lng || null,
                    hospitalSearch
                  );
                }
              }}
              className="w-full pl-10 pr-4 py-3 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-rose-500 transition-colors"
            />
          </div>
          <button
            onClick={() =>
              fetchHospitals(
                userCoords?.lat || null,
                userCoords?.lng || null,
                hospitalSearch
              )
            }
            className="px-6 py-3 bg-slate-900 hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 text-white rounded-2xl text-xs font-bold transition-colors cursor-pointer"
          >
            Search
          </button>
        </div>
      </div>

      {/* -------------------------------------------------------------
          STEP 1: Select Hospital
          ------------------------------------------------------------- */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
            <Building2 className="w-4 h-4 text-rose-500" />
            <span>Step 1: Choose Medical Center</span>
          </h3>
          <span className="text-3xs text-slate-400 font-medium">
            {hospitals.length} center{hospitals.length !== 1 ? 's' : ''} available
          </span>
        </div>

        {loadingHospitals ? (
          <div className="py-8 text-center text-xs text-slate-400">Loading hospitals...</div>
        ) : hospitals.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-400 bg-white dark:bg-slate-950 rounded-2xl border border-gray-200 dark:border-slate-800 p-6 space-y-2">
            <p className="font-semibold text-slate-700 dark:text-slate-300">No medical centers matched your search.</p>
            <p className="text-3xs text-slate-400">Try searching "Max", "Alexis", "GMCH", "Mayo", "AIIMS", or clearing the search query.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {hospitals.map((hosp) => {
              const isSelected = selectedHospital?.id === hosp.id;
              const hasAliases = Array.isArray(hosp.aliases) && hosp.aliases.length > 0;
              const primaryAlias = hasAliases
                ? (hosp.aliases.find((a: string) => a.toLowerCase().includes('alexis')) ? 'Formerly Alexis Hospital' : hosp.aliases[0])
                : null;
              const isPartner = hosp.isLifeLinkPartner !== false && hosp.linkStatus === 'LINKED_PARTNER';

              return (
                <div
                  key={hosp.id}
                  onClick={() => setSelectedHospital(hosp)}
                  className={`p-5 rounded-3xl border transition-all cursor-pointer flex flex-col justify-between space-y-4 ${
                    isSelected
                      ? 'bg-rose-50/50 dark:bg-rose-950/20 border-rose-500 dark:border-rose-500/50 shadow-md shadow-rose-500/10'
                      : 'bg-white dark:bg-slate-950 border-gray-200 dark:border-slate-800 hover:border-gray-300 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h4 className="font-bold text-sm text-slate-900 dark:text-white leading-snug">
                          {hosp.name}
                        </h4>
                        {primaryAlias && (
                          <span className="text-3xs font-semibold text-rose-600 dark:text-rose-400 block mt-0.5">
                            {primaryAlias}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        {isPartner ? (
                          <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold border border-emerald-500/20 flex items-center gap-1">
                            <ShieldCheck className="w-2.5 h-2.5" />
                            Partner
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 text-[10px] font-bold border border-blue-500/20 flex items-center gap-1">
                            <BadgeInfo className="w-2.5 h-2.5" />
                            Directory
                          </span>
                        )}
                        {hosp.distanceKm !== undefined && (
                          <span className="text-3xs font-black font-mono px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                            {Number(hosp.distanceKm).toFixed(1)} km
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      {hosp.locality && (
                        <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 text-[10px] font-semibold">
                          {hosp.locality}
                        </span>
                      )}
                      <p className="text-3xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                        <span className="line-clamp-1">{hosp.address || 'Nagpur, MH'}</span>
                      </p>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-gray-100 dark:border-slate-850 flex items-center justify-between">
                    <span className="text-3xs text-slate-400">
                      Emergency: <strong className="text-slate-700 dark:text-slate-300">{hosp.contactNumber || '108'}</strong>
                    </span>
                    <span
                      className={`text-2xs font-bold flex items-center gap-1 ${
                        isSelected ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400'
                      }`}
                    >
                      {isSelected ? 'Selected' : 'Select'}
                      <ChevronRight className="w-3.5 h-3.5" />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* -------------------------------------------------------------
          STEP 2: Choose Doctor Specialist & Specialization
          ------------------------------------------------------------- */}
      {selectedHospital && (
        <div className="space-y-4 pt-4 border-t border-gray-200 dark:border-slate-800">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
                <Stethoscope className="w-4 h-4 text-rose-500" />
                <span>Step 2: Choose Specialist at {selectedHospital.name}</span>
              </h3>
              <p className="text-3xs text-slate-400 mt-0.5">
                Showing {filteredDoctors.length} of {doctors.length} doctors listed at this center
              </p>
            </div>

            {/* Specialization Filter Dropdown */}
            <div className="flex items-center gap-2">
              <span className="text-2xs font-bold text-slate-400 uppercase tracking-wider">
                Specialty:
              </span>
              <select
                value={specializationFilter}
                onChange={(e) => setSpecializationFilter(e.target.value)}
                className="px-3 py-1.5 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-200 focus:outline-none focus:border-rose-500 max-w-[200px]"
              >
                <option value="ALL">All Specialties ({dynamicSpecialties.length || MEDICAL_SPECIALIZATIONS.length})</option>
                {(dynamicSpecialties.length > 0 ? dynamicSpecialties : MEDICAL_SPECIALIZATIONS).map((spec) => (
                  <option key={spec} value={spec}>
                    {spec}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Search within hospital's doctor directory */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search doctors at this hospital by doctor name, designation, or sub-specialty..."
              value={doctorSearch}
              onChange={(e) => setDoctorSearch(e.target.value)}
              className="w-full pl-9 pr-9 py-2 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-rose-500"
            />
            {doctorSearch && (
              <button
                onClick={() => setDoctorSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {loadingDoctors ? (
            <div className="py-8 text-center text-xs text-slate-400">Loading doctor specialists...</div>
          ) : filteredDoctors.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400 bg-white dark:bg-slate-950 rounded-2xl border border-gray-200 dark:border-slate-800 p-6 space-y-1">
              <p className="font-semibold text-slate-700 dark:text-slate-300">
                {doctorSearch ? `No doctors match "${doctorSearch}" at this hospital.` : 'No doctors listed for the selected specialization at this facility.'}
              </p>
              <p className="text-3xs text-slate-400">Try selecting "All Specialties" or clearing the doctor search filter.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredDoctors.map((doc) => {
                const isSelected = selectedDoctor?.id === doc.id;
                const isPublicListed = doc.bookingEnabled === false || doc.verificationStatus === 'PUBLIC_DIRECTORY_LISTED';

                return (
                  <div
                    key={doc.id}
                    onClick={() => setSelectedDoctor(doc)}
                    className={`p-5 rounded-3xl border transition-all cursor-pointer flex flex-col justify-between space-y-4 ${
                      isSelected
                        ? 'bg-rose-50/50 dark:bg-rose-950/20 border-rose-500 dark:border-rose-500/50 shadow-md shadow-rose-500/10'
                        : 'bg-white dark:bg-slate-950 border-gray-200 dark:border-slate-800 hover:border-gray-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <div className="space-y-3">
                      <div className="flex items-start gap-3">
                        {/* Doctor Photo or Avatar */}
                        {doc.imageUrl ? (
                          <img
                            src={doc.imageUrl}
                            alt={doc.name}
                            onError={(e) => {
                              // Fallback on image load error
                              (e.target as HTMLElement).style.display = 'none';
                            }}
                            className="w-12 h-12 rounded-2xl object-cover shrink-0 border border-gray-100 dark:border-slate-800 bg-slate-100 dark:bg-slate-900"
                          />
                        ) : (
                          <div className="w-12 h-12 rounded-2xl bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
                            <User className="w-6 h-6" />
                          </div>
                        )}

                        <div className="flex-1 min-w-0">
                          <h4 className="font-bold text-sm text-slate-900 dark:text-white truncate">
                            {doc.name}
                          </h4>
                          {doc.designation ? (
                            <p className="text-3xs text-slate-500 dark:text-slate-400 line-clamp-1">
                              {doc.designation}
                            </p>
                          ) : (
                            <p className="text-3xs text-slate-400">Consultant Specialist</p>
                          )}
                          <div className="flex flex-wrap items-center gap-1.5 mt-1">
                            <span className="inline-block px-2 py-0.5 rounded-md bg-rose-500/10 text-rose-600 dark:text-rose-400 text-[10px] font-black uppercase tracking-wider">
                              {doc.specialization}
                            </span>
                            {isPublicListed ? (
                              <span className="inline-block px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[9px] font-bold border border-amber-500/20">
                                📋 Public Listing
                              </span>
                            ) : (
                              <span className="inline-block px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[9px] font-bold border border-emerald-500/20">
                                ⚡ Partner
                              </span>
                            )}
                            {doc.affiliation?.status === 'VISITING_CONSULTANT' && (
                              <span className="inline-block px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 text-[9px] font-bold border border-blue-500/20">
                                Visiting
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {doc.qualifications && (
                        <p className="text-3xs text-slate-500 dark:text-slate-400">
                          {doc.qualifications} {doc.experienceYears ? `· ${doc.experienceYears} yrs experience` : ''}
                        </p>
                      )}

                      {doc.registrationNumber && (
                        <p className="text-[10px] text-slate-600 dark:text-slate-300 flex items-center gap-1 font-mono">
                          <Award className="w-3 h-3 text-emerald-500 shrink-0" />
                          <span>MMC Reg: {doc.registrationNumber}</span>
                        </p>
                      )}

                      {/* Source Provenance */}
                      {doc.sourceUrl && (
                        <p className="text-[10px] text-slate-400 flex items-center gap-1 truncate">
                          <span>Source:</span>
                          <span className="font-mono text-slate-500 dark:text-slate-300">
                            {doc.sourceUrl.includes('maxhealthcare') ? 'maxhealthcare.in (Official)' : (doc.sourceUrl.includes('gmch') ? 'gmchnagpur.org' : 'Official Directory')}
                          </span>
                        </p>
                      )}
                    </div>

                    <div className="pt-3 border-t border-gray-100 dark:border-slate-850 flex items-center justify-between gap-2">
                      {isPublicListed ? (
                        <div className="flex items-center gap-2">
                          {doc.profileUrl && (
                            <a
                              href={doc.profileUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 text-3xs font-bold inline-flex items-center gap-1"
                            >
                              <span>Profile</span>
                              <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                          )}
                          {selectedHospital?.contactNumber && (
                            <a
                              href={`tel:${selectedHospital.contactNumber}`}
                              onClick={(e) => e.stopPropagation()}
                              className="px-2.5 py-1 rounded-lg bg-rose-50 dark:bg-rose-950/30 hover:bg-rose-100 text-rose-600 dark:text-rose-400 text-3xs font-bold inline-flex items-center gap-1"
                            >
                              <Phone className="w-2.5 h-2.5" />
                              <span>Call</span>
                            </a>
                          )}
                        </div>
                      ) : (
                        <span className="text-3xs text-emerald-600 dark:text-emerald-400 font-bold">
                          {doc.isActive ? 'Available for OPD' : 'Unavailable'}
                        </span>
                      )}

                      <span
                        className={`text-2xs font-bold flex items-center gap-1 shrink-0 ${
                          isSelected ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400'
                        }`}
                      >
                        {isSelected ? 'Selected' : (isPublicListed ? 'View Info' : 'Pick Doctor')}
                        <ChevronRight className="w-3.5 h-3.5" />
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* -------------------------------------------------------------
          STEP 3: Pick Date & Time Slot OR Public Directory Info
          ------------------------------------------------------------- */}
      {selectedDoctor && (
        <div className="space-y-4 pt-4 border-t border-gray-200 dark:border-slate-800">
          {/* Public Doctor Directory Notice: Real Invariant - Never generate fake slots! */}
          {selectedDoctor.bookingEnabled === false || selectedDoctor.verificationStatus === 'PUBLIC_DIRECTORY_LISTED' ? (
            <div className="p-6 rounded-3xl bg-amber-500/5 dark:bg-amber-950/20 border border-amber-500/20 space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <h4 className="font-bold text-sm text-slate-900 dark:text-white">
                    Public Doctor Directory Profile — Direct LifeLink Booking Unavailable
                  </h4>
                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                    <strong>{selectedDoctor.name}</strong> ({selectedDoctor.designation || selectedDoctor.specialization}) is publicly listed at <strong>{selectedHospital?.name}</strong>. LifeLink maintains public doctor directory provenance, but online OPD token booking is reserved for verified partner integrations with live EHR slot synchronization.
                  </p>
                  <p className="text-3xs text-slate-400">
                    Source: {selectedDoctor.sourceUrl} · Retrieved: {selectedDoctor.sourceRetrievedAt ? new Date(selectedDoctor.sourceRetrievedAt).toLocaleDateString() : 'Official Public Record'}
                  </p>
                </div>
              </div>

              <div className="pt-2 flex flex-wrap items-center gap-3">
                {selectedHospital?.contactNumber && (
                  <a
                    href={`tel:${selectedHospital.contactNumber}`}
                    className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition-colors inline-flex items-center gap-2"
                  >
                    <Phone className="w-4 h-4" />
                    Call Hospital OPD: {selectedHospital.contactNumber}
                  </a>
                )}
                {selectedDoctor.profileUrl && (
                  <a
                    href={selectedDoctor.profileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 text-white rounded-xl text-xs font-bold transition-colors inline-flex items-center gap-2"
                  >
                    <span>View Official Hospital Profile</span>
                    <ExternalLink className="w-4 h-4" />
                  </a>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-rose-500" />
                  <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider">
                    Step 3: Select Date & Time Slot for {selectedDoctor.name}
                  </h3>
                </div>

                {/* Date Picker */}
                <div className="flex items-center gap-2">
                  <label className="text-2xs font-bold text-slate-400 uppercase tracking-wider">
                    Date:
                  </label>
                  <input
                    type="date"
                    value={selectedDate}
                    min={new Date().toISOString().split('T')[0]}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="px-3 py-1.5 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-200 focus:outline-none focus:border-rose-500"
                  />
                </div>
              </div>

              {doctorOnLeave && (
                <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs font-bold flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>Dr. {selectedDoctor.name} is on leave on {selectedDate}. Please select another date.</span>
                </div>
              )}

              {loadingSlots ? (
                <div className="py-8 text-center text-xs text-slate-400">Loading slots & live capacity...</div>
              ) : slots.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400 bg-gray-50 dark:bg-slate-900/50 rounded-2xl">
                  No consultation slots posted for {selectedDoctor.name} on {selectedDate}. Please select another date or doctor.
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {slots.map((slot) => {
                    const isSelected = selectedSlot?.id === slot.id;
                    const isFull = slot.remainingCapacity <= 0;
                    const isBlocked = Boolean(slot.isBlocked);
                    const isPast = Boolean(slot.isPast);
                    const isUnavailable = !slot.isAvailable || isFull || isBlocked || isPast;

                    return (
                      <button
                        key={slot.id}
                        disabled={isUnavailable}
                        onClick={() => setSelectedSlot(slot)}
                        className={`p-4 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                          isUnavailable
                            ? 'opacity-40 bg-gray-100 dark:bg-slate-900 border-gray-200 dark:border-slate-800 cursor-not-allowed'
                            : isSelected
                            ? 'bg-rose-600 text-white border-rose-600 shadow-md shadow-rose-600/20'
                            : 'bg-gray-50 dark:bg-slate-900 border-gray-200 dark:border-slate-800 hover:border-rose-500/50'
                        }`}
                      >
                        <div>
                          <span className={`text-xs font-black block ${isSelected ? 'text-white' : 'text-slate-900 dark:text-white'}`}>
                            {slot.startTime} - {slot.endTime}
                          </span>
                        </div>

                        <div className="mt-3">
                          {isBlocked ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 text-[10px] font-bold">
                              <Lock className="w-2.5 h-2.5" />
                              Blocked
                            </span>
                          ) : isPast ? (
                            <span className="inline-block px-2 py-0.5 rounded-full bg-slate-500/10 text-slate-500 text-[10px] font-bold">
                              Past Time
                            </span>
                          ) : isFull ? (
                            <span className="inline-block px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-500 text-[10px] font-bold">
                              Fully Booked
                            </span>
                          ) : (
                            <span
                              className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                isSelected
                                  ? 'bg-white/20 text-white'
                                  : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                              }`}
                            >
                              {slot.remainingCapacity} seat{slot.remainingCapacity > 1 ? 's' : ''} left
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Book Action Button */}
              {selectedSlot && (
                <div className="pt-4 border-t border-gray-100 dark:border-slate-850 flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div className="text-xs text-slate-600 dark:text-slate-300">
                    Selected: <span className="font-bold text-slate-900 dark:text-white">{selectedDoctor.name}</span> on{' '}
                    <span className="font-bold text-slate-900 dark:text-white">{selectedDate}</span> ({selectedSlot.startTime} - {selectedSlot.endTime})
                  </div>
                  <button
                    onClick={() => setBookingModalOpen(true)}
                    className="w-full sm:w-auto px-8 py-3 bg-rose-600 hover:bg-rose-500 text-white rounded-2xl text-xs font-black shadow-lg shadow-rose-600/20 transition-all cursor-pointer"
                  >
                    Proceed to Book Token →
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* -------------------------------------------------------------
          Booking Symptoms Modal
          ------------------------------------------------------------- */}
      {bookingModalOpen && selectedSlot && selectedDoctor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white dark:bg-slate-950 border border-gray-200 dark:border-slate-800 rounded-3xl p-6 md:p-8 max-w-lg w-full shadow-2xl space-y-6">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-black text-slate-900 dark:text-white">
                  Confirm OPD Appointment
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  A sequential token will be issued for {selectedDoctor.name}
                </p>
              </div>
              <button
                onClick={() => setBookingModalOpen(false)}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-900 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {bookingError && (
              <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-500 text-xs font-semibold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{bookingError}</span>
              </div>
            )}

            {/* Summary card */}
            <div className="p-4 rounded-2xl bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-800 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">Doctor:</span>
                <span className="font-bold text-slate-800 dark:text-slate-200">{selectedDoctor.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Specialization:</span>
                <span className="font-bold text-slate-800 dark:text-slate-200">{selectedDoctor.specialization}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Hospital:</span>
                <span className="font-bold text-slate-800 dark:text-slate-200">{selectedHospital.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Schedule:</span>
                <span className="font-bold text-slate-800 dark:text-slate-200">
                  {selectedDate} · {selectedSlot.startTime} - {selectedSlot.endTime}
                </span>
              </div>
            </div>

            <form onSubmit={handleConfirmBooking} className="space-y-4">
              <div>
                <label className="block text-2xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Reason for Visit / Symptoms (Optional)
                </label>
                <textarea
                  rows={3}
                  placeholder="Describe your current symptoms or reason for consultation..."
                  value={symptomsInput}
                  onChange={(e) => setSymptomsInput(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-rose-500 transition-colors"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setBookingModalOpen(false)}
                  className="flex-1 py-3 border border-gray-200 dark:border-slate-800 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-900 transition-colors cursor-pointer"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={bookingLoading}
                  className="flex-1 py-3 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white rounded-xl text-xs font-black shadow-lg shadow-rose-600/20 transition-all cursor-pointer"
                >
                  {bookingLoading ? 'Issuing Token...' : 'Confirm & Reserve Token'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------
          Confirmed Token Pass Banner / Modal
          ------------------------------------------------------------- */}
      {confirmedAppointment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fadeIn">
          <div className="bg-white dark:bg-slate-950 border border-emerald-500/30 rounded-3xl p-6 md:p-8 max-w-md w-full shadow-2xl text-center space-y-6 relative overflow-hidden">
            <div className="absolute -top-12 -right-12 w-32 h-32 bg-emerald-500/10 rounded-full blur-2xl" />

            <div className="w-16 h-16 rounded-3xl bg-emerald-500/10 text-emerald-500 mx-auto flex items-center justify-center shadow-lg shadow-emerald-500/10">
              <Ticket className="w-8 h-8" />
            </div>

            <div className="space-y-1">
              <span className="text-2xs font-extrabold uppercase tracking-widest text-emerald-500 font-mono">
                Booking Confirmed
              </span>
              <h3 className="text-2xl font-black text-slate-900 dark:text-white">
                Your Priority OPD Token
              </h3>
            </div>

            {/* Massive Token Number Badge */}
            <div className="p-6 rounded-3xl bg-gradient-to-b from-emerald-500/10 to-emerald-500/5 border border-emerald-500/20">
              <span className="text-4xs font-mono uppercase tracking-widest text-slate-400 block mb-1">
                Queue Token Number
              </span>
              <span className="text-5xl font-black text-emerald-600 dark:text-emerald-400 font-mono tracking-tight block">
                #{String(confirmedAppointment.tokenNumber).padStart(2, '0')}
              </span>
              {confirmedAppointment.tokenString && (
                <div className="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-xs font-mono font-bold text-emerald-700 dark:text-emerald-300">
                  <span className="text-[10px] uppercase tracking-wider text-emerald-600/70 dark:text-emerald-400/70">Pass ID:</span>
                  <span>{confirmedAppointment.tokenString}</span>
                </div>
              )}
            </div>

            <div className="text-left p-4 rounded-2xl bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-800 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">Doctor:</span>
                <span className="font-bold text-slate-800 dark:text-slate-200">
                  {confirmedAppointment.doctor?.name} ({confirmedAppointment.doctor?.specialization})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Hospital:</span>
                <span className="font-bold text-slate-800 dark:text-slate-200">
                  {confirmedAppointment.hospital?.name}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Schedule:</span>
                <span className="font-bold text-slate-800 dark:text-slate-200">
                  {confirmedAppointment.slot?.date} · {confirmedAppointment.slot?.startTime} - {confirmedAppointment.slot?.endTime}
                </span>
              </div>
            </div>

            <p className="text-3xs text-slate-400">
              Please arrive 10 minutes prior to your time window and present this token number at the reception desk.
            </p>

            <button
              onClick={() => setConfirmedAppointment(null)}
              className="w-full py-3.5 bg-slate-900 hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 text-white rounded-2xl text-xs font-black transition-colors cursor-pointer"
            >
              Done / Return to Dashboard
            </button>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------
          My Active & Upcoming Appointments Section
          ------------------------------------------------------------- */}
      <div className="bg-white dark:bg-slate-950 border border-gray-200 dark:border-slate-800 rounded-3xl p-6 md:p-8 shadow-sm space-y-6">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
            <Ticket className="w-5 h-5 text-rose-500" />
            My Booked Doctor Appointments
          </h3>
          <button
            onClick={fetchMyAppointments}
            className="text-xs text-slate-400 hover:text-rose-500 flex items-center gap-1 font-semibold cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingMyAppointments ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {loadingMyAppointments ? (
          <div className="py-8 text-center text-xs text-slate-400">Loading your appointments...</div>
        ) : myAppointments.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-400 bg-gray-50 dark:bg-slate-900/50 rounded-2xl">
            You have no active doctor appointments scheduled.
          </div>
        ) : (
          <div className="space-y-3">
            {myAppointments.map((apt) => {
              const isCancelled = apt.status === 'CANCELLED';
              const isCompleted = apt.status === 'COMPLETED';
              const canReschedule = !isCancelled && !isCompleted;

              return (
                <div
                  key={apt.id}
                  className={`p-5 rounded-3xl border transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 ${
                    isCancelled
                      ? 'bg-gray-50/50 dark:bg-slate-900/30 border-gray-200 dark:border-slate-850 opacity-60'
                      : 'bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-800'
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-rose-500/10 text-rose-600 dark:text-rose-400 font-mono font-black text-lg flex items-center justify-center shrink-0">
                      #{String(apt.tokenNumber).padStart(2, '0')}
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-bold text-sm text-slate-900 dark:text-white">
                          {apt.doctor?.name}
                        </h4>
                        <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[10px] font-bold text-slate-500">
                          {apt.doctor?.specialization}
                        </span>
                        {apt.tokenString && (
                          <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-mono font-bold text-emerald-700 dark:text-emerald-400">
                            {apt.tokenString}
                          </span>
                        )}
                      </div>
                      <p className="text-3xs text-slate-400 flex items-center gap-2">
                        <span>{apt.hospital?.name}</span>
                        <span>•</span>
                        <span>
                          {apt.slot?.date} ({apt.slot?.startTime} - {apt.slot?.endTime})
                        </span>
                      </p>
                      {apt.symptoms && (
                        <p className="text-3xs text-slate-500 italic">
                          Notes: "{apt.symptoms}"
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 self-end md:self-center flex-wrap">
                    <span
                      className={`px-3 py-1 rounded-full text-[10px] font-black uppercase ${
                        isCompleted
                          ? 'bg-blue-500/10 text-blue-500'
                          : isCancelled
                          ? 'bg-slate-500/10 text-slate-400'
                          : apt.status === 'CONFIRMED'
                          ? 'bg-emerald-500/10 text-emerald-500'
                          : apt.status === 'CHECKED_IN' || apt.status === 'IN_CONSULTATION'
                          ? 'bg-purple-500/10 text-purple-500'
                          : 'bg-rose-500/10 text-rose-500'
                      }`}
                    >
                      {apt.status}
                    </span>

                    <button
                      onClick={() => handleViewAuditTrail(apt.id)}
                      className="p-1.5 rounded-xl border border-gray-200 dark:border-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer"
                      title="View Timeline"
                    >
                      <History className="w-3.5 h-3.5" />
                    </button>

                    {canReschedule && (
                      <button
                        onClick={() => {
                          setReschedulingAppointment(apt);
                          setRescheduleDate(apt.slot?.date || new Date().toISOString().split('T')[0]);
                        }}
                        className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center gap-1 cursor-pointer"
                      >
                        <Repeat className="w-3 h-3 text-emerald-500" />
                        <span>Reschedule</span>
                      </button>
                    )}

                    {!isCancelled && !isCompleted && (
                      <button
                        onClick={() => handleCancelAppointment(apt.id)}
                        disabled={cancellingId === apt.id}
                        className="px-3 py-1.5 rounded-xl border border-rose-200 dark:border-rose-900/40 text-rose-600 dark:text-rose-400 text-xs font-bold hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors cursor-pointer"
                      >
                        {cancellingId === apt.id ? 'Cancelling...' : 'Cancel'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* -------------------------------------------------------------
          MODAL: Reschedule Appointment
          ------------------------------------------------------------- */}
      {reschedulingAppointment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white dark:bg-slate-950 border border-gray-200 dark:border-slate-800 rounded-3xl p-6 md:p-8 max-w-lg w-full shadow-2xl space-y-6">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                  <Repeat className="w-5 h-5 text-emerald-500" />
                  Reschedule Appointment
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Pick a new date and available slot for {reschedulingAppointment.doctor?.name}
                </p>
              </div>
              <button
                onClick={() => setReschedulingAppointment(null)}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-900 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {rescheduleError && (
              <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-500 text-xs font-semibold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{rescheduleError}</span>
              </div>
            )}

            <form onSubmit={handleConfirmReschedule} className="space-y-4">
              <div>
                <label className="block text-2xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                  New Date *
                </label>
                <input
                  type="date"
                  required
                  value={rescheduleDate}
                  min={new Date().toISOString().split('T')[0]}
                  onChange={(e) => setRescheduleDate(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-rose-500"
                />
              </div>

              <div>
                <label className="block text-2xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                  Choose New Time Slot *
                </label>
                {loadingRescheduleSlots ? (
                  <p className="text-xs text-slate-400">Loading available slots...</p>
                ) : rescheduleSlots.length === 0 ? (
                  <p className="text-xs text-slate-400 bg-gray-50 dark:bg-slate-900 p-3 rounded-xl">
                    No alternate slots available on this date.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                    {rescheduleSlots.map((slot) => {
                      const isSelected = selectedRescheduleSlot?.id === slot.id;
                      const isUnavailable = !slot.isAvailable || slot.remainingCapacity <= 0 || slot.isBlocked || slot.isPast;

                      return (
                        <button
                          type="button"
                          key={slot.id}
                          disabled={isUnavailable}
                          onClick={() => setSelectedRescheduleSlot(slot)}
                          className={`p-3 rounded-xl border text-left text-xs font-bold transition-all cursor-pointer ${
                            isUnavailable
                              ? 'opacity-40 bg-gray-100 dark:bg-slate-900 border-gray-200 dark:border-slate-800 cursor-not-allowed'
                              : isSelected
                              ? 'bg-emerald-600 text-white border-emerald-600 shadow-md shadow-emerald-600/20'
                              : 'bg-gray-50 dark:bg-slate-900 border-gray-200 dark:border-slate-800 hover:border-emerald-500/50'
                          }`}
                        >
                          <div>{slot.startTime} - {slot.endTime}</div>
                          <span className={`text-3xs block mt-1 ${isSelected ? 'text-white/80' : 'text-slate-400'}`}>
                            {slot.isBlocked ? 'Blocked' : `${slot.remainingCapacity} seats left`}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-2xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Reason for Rescheduling (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Schedule conflict / personal emergency"
                  value={rescheduleReason}
                  onChange={(e) => setRescheduleReason(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-rose-500"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setReschedulingAppointment(null)}
                  className="flex-1 py-3 border border-gray-200 dark:border-slate-800 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-900 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!selectedRescheduleSlot || reschedulingLoading}
                  className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs font-black shadow-lg shadow-emerald-600/20 transition-all cursor-pointer"
                >
                  {reschedulingLoading ? 'Rescheduling...' : 'Confirm Reschedule'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------
          MODAL: Patient Audit Trail Viewer
          ------------------------------------------------------------- */}
      {auditModalAppointmentId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white dark:bg-slate-950 border border-gray-200 dark:border-slate-800 rounded-3xl p-6 md:p-8 max-w-md w-full shadow-2xl space-y-6">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                  <History className="w-5 h-5 text-rose-500" />
                  Appointment Timeline
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono">
                  ID: {auditModalAppointmentId}
                </p>
              </div>
              <button
                onClick={() => setAuditModalAppointmentId(null)}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-gray-100 dark:hover:bg-slate-900"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {loadingAudit ? (
              <div className="py-8 text-center text-xs text-slate-400">Loading timeline...</div>
            ) : auditLogs.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400 bg-gray-50 dark:bg-slate-900 rounded-2xl">
                No history recorded for this appointment.
              </div>
            ) : (
              <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                {auditLogs.map((log: any) => (
                  <div
                    key={log.id}
                    className="p-3.5 rounded-2xl bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-800 space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="px-2 py-0.5 rounded text-3xs font-black uppercase bg-rose-500/10 text-rose-600 dark:text-rose-400">
                        {log.action}
                      </span>
                      <span className="text-3xs text-slate-400 font-mono">
                        {new Date(log.timestamp).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>

                    <div className="text-xs text-slate-800 dark:text-slate-200 font-medium">
                      {log.reason || `Status: ${log.newStatus}`}
                    </div>

                    <div className="text-3xs text-slate-400 flex items-center gap-2">
                      <span>Updated by: {log.actorName || log.actorRole}</span>
                      {log.previousStatus && (
                        <span>• {log.previousStatus} → {log.newStatus}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={() => setAuditModalAppointmentId(null)}
              className="w-full py-3 bg-slate-900 hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
