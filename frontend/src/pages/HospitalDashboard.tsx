import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { LeafletMap } from '../components/LeafletMap';
import { ThemeToggle } from '../components/ui/ThemeToggle';
import { HeartbeatLoader } from '../components/ui/HeartbeatLoader';
import { ConfirmationModal } from '../components/ui/ConfirmationModal';
import { DoctorAppointmentsSection } from '../components/hospital/DoctorAppointmentsSection';
import { formatIndianPhone, maskIndianPhone, formatIndianDateTime } from '../utils/localization';
import {
  Activity,
  Heart,
  Plus,
  Minus,
  AlertOctagon,
  Clock,
  ShieldCheck,
  User,
  CheckCircle,
  Truck,
  LogOut,
  Settings,
  Sparkles,
  Bed,
  Filter,
  Search,
  Calendar,
  Stethoscope,
  Trash2,
  RefreshCw,
  Check,
  X,
  AlertTriangle,
  ArrowRight,
  Phone,
  ClipboardList,
  Thermometer,
  UserCheck,
  ShieldAlert,
  ChevronRight,
  CheckSquare,
  Layers,
  Wrench,
  Droplets,
  Sliders,
  History,
  BarChart3
} from 'lucide-react';
import { AnalyticsReportingView } from '../components/admin/AnalyticsReportingView';

export const HospitalDashboard: React.FC = () => {
  const { user, logout, apiFetch, updateUser } = useAuth();
  const { socket } = useSocket();

  // Active dashboard view tab
  const [activeDashboardTab, setActiveDashboardTab] = useState<
    'DISPATCHES' | 'BEDS' | 'BOOKINGS' | 'APPOINTMENTS_DOCTORS' | 'CLEANING' | 'QUEUE' | 'FLEET' | 'ROSTER' | 'ANALYTICS'
  >('BEDS');

  // ER Beds & Clinical Capacity State
  const [bedsList, setBedsList] = useState<any[]>([]);
  const [bedStats, setBedStats] = useState({
    total: 0,
    available: 0,
    occupied: 0,
    cleaning: 0,
    maintenance: 0,
    reserved: 0,
    icuAvailable: 0,
    erAvailable: 0,
  });
  const [loadingBeds, setLoadingBeds] = useState(false);
  const [selectedWardFilter, setSelectedWardFilter] = useState<string>('ALL');
  const [selectedBedStatusFilter, setSelectedBedStatusFilter] = useState<string>('ALL');
  const [bedSearchQuery, setBedSearchQuery] = useState('');

  // Bed Modals State
  const [showAdmitModal, setShowAdmitModal] = useState(false);
  const [selectedBedForAdmit, setSelectedBedForAdmit] = useState<any>(null);
  const [admitPatientName, setAdmitPatientName] = useState('');
  const [admitDoctorName, setAdmitDoctorName] = useState('');
  const [admitNotes, setAdmitNotes] = useState('');
  const [admittingLoading, setAdmittingLoading] = useState(false);

  const [showAddBedModal, setShowAddBedModal] = useState(false);
  const [newBedNumber, setNewBedNumber] = useState('');
  const [newBedWard, setNewBedWard] = useState('EMERGENCY_ER');
  const [newBedCategory, setNewBedCategory] = useState('EMERGENCY');
  const [newBedNotes, setNewBedNotes] = useState('');
  const [addingBedLoading, setAddingBedLoading] = useState(false);
  const [dischargeModalBed, setDischargeModalBed] = useState<any | null>(null);
  const [dischargingLoading, setDischargingLoading] = useState(false);

  // Hospital Capacity & Audit Log State (Requirement 2, 3, 5, 6)
  const [showCapacityModal, setShowCapacityModal] = useState(false);
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [capacityTotalBeds, setCapacityTotalBeds] = useState(0);
  const [capacityAvailBeds, setCapacityAvailBeds] = useState(0);
  const [capacityReason, setCapacityReason] = useState('');
  const [updatingCapacity, setUpdatingCapacity] = useState(false);
  const [capacityAuditLogs, setCapacityAuditLogs] = useState<any[]>([]);
  const [loadingAuditLogs, setLoadingAuditLogs] = useState(false);

  // Bookings & Admissions State
  const [bookingsList, setBookingsList] = useState<any[]>([]);
  const [loadingBookings, setLoadingBookings] = useState(false);
  const [bookingTypeFilter, setBookingTypeFilter] = useState<string>('ALL');
  const [bookingStatusFilter, setBookingStatusFilter] = useState<string>('ALL');
  const [bookingSearch, setBookingSearch] = useState('');
  const [showNewBookingModal, setShowNewBookingModal] = useState(false);

  // New Booking Form
  const [bkPatientName, setBkPatientName] = useState('');
  const [bkPatientPhone, setBkPatientPhone] = useState('');
  const [bkType, setBkType] = useState('EMERGENCY_ADMISSION');
  const [bkDepartment, setBkDepartment] = useState('Emergency & Trauma ER');
  const [bkDoctor, setBkDoctor] = useState('Dr. Sarah Connor');
  const [bkTriage, setBkTriage] = useState('RED_CRITICAL');
  const [bkSymptoms, setBkSymptoms] = useState('');
  const [bkAssignedBedId, setBkAssignedBedId] = useState('');
  const [bkNotes, setBkNotes] = useState('');
  const [submittingBooking, setSubmittingBooking] = useState(false);

  // Housekeeping & Sanitation State
  const [cleaningStaffName, setCleaningStaffName] = useState('');
  const [cleaningBedActionLoading, setCleaningBedActionLoading] = useState<string | null>(null);

  // Inbound ER Dispatches & Ambulances State
  const [emergencies, setEmergies] = useState<any[]>([]);
  const [selectedEmergency, setSelectedEmergency] = useState<any>(null);
  const [assigningBayModal, setAssigningBayModal] = useState<any>(null);
  const [selectedBayToAssign, setSelectedBayToAssign] = useState('ER Trauma Bay 1');
  const [selectedDoctorForBay, setSelectedDoctorForBay] = useState('Dr. Sarah Connor (Trauma Surgeon)');
  const [savingBayAssignment, setSavingBayAssignment] = useState(false);

  // Specialist clinic queue states
  const [queueEntries, setQueueEntries] = useState<any[]>([]);
  const [loadingQueue, setLoadingQueue] = useState(false);
  const [walkInEmail, setWalkInEmail] = useState('');
  const [walkInSpecialty, setWalkInSpecialty] = useState('Cardiology');
  const [walkInPriority, setWalkInPriority] = useState('STANDARD');
  const [addingWalkIn, setAddingWalkIn] = useState(false);

  // Roster Tab states
  const [rosterDrivers, setRosterDrivers] = useState<any[]>([]);
  const [loadingRoster, setLoadingRoster] = useState(false);

  // Fleet Tab states
  const [fleetAmbulances, setFleetAmbulances] = useState<any[]>([]);
  const [loadingFleet, setLoadingFleet] = useState(false);
  const [newVehicleNumber, setNewVehicleNumber] = useState('');
  const [newAmbulanceType, setNewAmbulanceType] = useState('BASIC_LIFE_SUPPORT');
  const [registerSuccess, setRegisterSuccess] = useState('');
  const [registerError, setRegisterError] = useState('');
  const [registering, setRegistering] = useState(false);

  // -------------------------------------------------------------
  // Data Fetching Functions
  // -------------------------------------------------------------

  const fetchBeds = async () => {
    try {
      setLoadingBeds(true);
      const data = await apiFetch('/hospitals/beds');
      if (data) {
        setBedsList(data.beds || []);
        setBedStats(data.stats || bedStats);
      }
    } catch (err) {
      console.error('Error fetching hospital beds:', err);
    } finally {
      setLoadingBeds(false);
    }
  };

  const fetchBookings = async () => {
    try {
      setLoadingBookings(true);
      const data = await apiFetch('/hospitals/bookings');
      setBookingsList(data || []);
    } catch (err) {
      console.error('Error fetching bookings:', err);
    } finally {
      setLoadingBookings(false);
    }
  };

  const fetchRoster = async () => {
    try {
      setLoadingRoster(true);
      const data = await apiFetch('/hospitals/drivers');
      setRosterDrivers(data || []);
    } catch (err) {
      console.error('Error fetching roster:', err);
    } finally {
      setLoadingRoster(false);
    }
  };

  const fetchFleet = async () => {
    try {
      setLoadingFleet(true);
      const data = await apiFetch('/hospitals/ambulances');
      setFleetAmbulances(data || []);
    } catch (err) {
      console.error('Error fetching fleet:', err);
    } finally {
      setLoadingFleet(false);
    }
  };

  const fetchQueueEntries = async () => {
    try {
      setLoadingQueue(true);
      const data = await apiFetch('/queue');
      setQueueEntries(data || []);
    } catch (err) {
      console.error('Failed to fetch queue entries:', err);
    } finally {
      setLoadingQueue(false);
    }
  };

  const fetchIncomingRequests = async () => {
    try {
      const activeTrip = await apiFetch('/requests/active');
      if (activeTrip) {
        setEmergies([activeTrip]);
        setSelectedEmergency(activeTrip);
      }
    } catch (err) {
      console.error('Error fetching incoming requests:', err);
    }
  };

  // Initial mount load
  useEffect(() => {
    fetchBeds();
    fetchBookings();
    fetchIncomingRequests();
  }, []);

  // Tab switch data loaders
  useEffect(() => {
    if (activeDashboardTab === 'BEDS' || activeDashboardTab === 'CLEANING') {
      fetchBeds();
    } else if (activeDashboardTab === 'BOOKINGS') {
      fetchBookings();
      fetchBeds();
    } else if (activeDashboardTab === 'ROSTER') {
      fetchRoster();
    } else if (activeDashboardTab === 'FLEET') {
      fetchFleet();
      fetchRoster();
    } else if (activeDashboardTab === 'QUEUE') {
      fetchQueueEntries();
    } else if (activeDashboardTab === 'DISPATCHES') {
      fetchIncomingRequests();
      fetchBeds();
    }
  }, [activeDashboardTab]);

  // -------------------------------------------------------------
  // Socket Events
  // -------------------------------------------------------------
  useEffect(() => {
    if (!socket) return;

    socket.emit('hospital:register', user?.id);

    // Live ER new incoming emergency
    socket.on('hospital:new_emergency', (data: any) => {
      const newEmergency = {
        ...data.request,
        patient: {
          name: data.patientName,
          phone: data.patientPhone,
          patientProfile: data.patientProfile,
        },
      };
      setEmergies((prev) => {
        if (prev.some((e) => e.id === newEmergency.id)) return prev;
        return [newEmergency, ...prev];
      });
      setSelectedEmergency((curr: any) => curr || newEmergency);

      // Alert audio
      try {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.frequency.setValueAtTime(700, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.4);
      } catch (e) {}
    });

    // Driver claimed
    socket.on('hospital:emergency_claimed', (data: any) => {
      setEmergies((prev) =>
        prev.map((e) => (e.id === data.request.id ? { ...e, ...data.request } : e))
      );
    });

    // Status changed
    socket.on('hospital:emergency_status_changed', (data: any) => {
      const req = data.request;
      if (req.status === 'COMPLETED' || req.status === 'REJECTED') {
        setEmergies((prev) => prev.filter((e) => e.id !== req.id));
        setSelectedEmergency((curr: any) => (curr?.id === req.id ? null : curr));
        fetchBeds();
      } else {
        setEmergies((prev) => prev.map((e) => (e.id === req.id ? { ...e, ...req } : e)));
      }
    });

    // Driver location update
    socket.on('driver:location_changed', (data: any) => {
      setSelectedEmergency((curr: any) => {
        if (curr && curr.driver && curr.driver.ambulance) {
          return {
            ...curr,
            driver: {
              ...curr.driver,
              ambulance: {
                ...curr.driver.ambulance,
                currentLat: data.lat,
                currentLng: data.lng,
              },
            },
          };
        }
        return curr;
      });
    });

    // Real-time bed updates
    socket.on('hospital:bed_updated', () => {
      fetchBeds();
    });

    // Real-time booking updates
    socket.on('hospital:booking_created', () => {
      fetchBookings();
      fetchBeds();
    });
    socket.on('hospital:booking_updated', () => {
      fetchBookings();
      fetchBeds();
    });

    return () => {
      socket.off('hospital:new_emergency');
      socket.off('hospital:emergency_claimed');
      socket.off('hospital:emergency_status_changed');
      socket.off('driver:location_changed');
      socket.off('hospital:bed_updated');
      socket.off('hospital:booking_created');
      socket.off('hospital:booking_updated');
    };
  }, [socket, user]);

  // -------------------------------------------------------------
  // Bed Management Actions
  // -------------------------------------------------------------

  const handleAdmitPatientToBed = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBedForAdmit) return;
    setAdmittingLoading(true);

    try {
      await apiFetch(`/hospitals/beds/${selectedBedForAdmit.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          status: 'OCCUPIED',
          patientName: admitPatientName,
          assignedDoctor: admitDoctorName,
          notes: admitNotes,
        }),
      });

      setShowAdmitModal(false);
      setSelectedBedForAdmit(null);
      setAdmitPatientName('');
      setAdmitDoctorName('');
      setAdmitNotes('');
      fetchBeds();
    } catch (err: any) {
      alert(err.message || 'Failed to admit patient to bed');
    } finally {
      setAdmittingLoading(false);
    }
  };

  const handleDischargePatient = (bed: any) => {
    setDischargeModalBed(bed);
  };

  const executeDischargePatient = async () => {
    if (!dischargeModalBed) return;
    setDischargingLoading(true);
    try {
      await apiFetch(`/hospitals/beds/${dischargeModalBed.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          status: 'CLEANING',
          cleaningPriority:
            dischargeModalBed.ward === 'ICU' || dischargeModalBed.ward === 'TRAUMA'
              ? 'TERMINAL_DISINFECTION'
              : 'ROUTINE',
        }),
      });
      setDischargeModalBed(null);
      fetchBeds();
    } catch (err: any) {
      alert(err.message || 'Discharge action failed');
    } finally {
      setDischargingLoading(false);
    }
  };

  const handleQuickCleanBed = async (bedId: string, action: 'START' | 'COMPLETE', staff?: string) => {
    setCleaningBedActionLoading(bedId);
    try {
      await apiFetch(`/hospitals/beds/${bedId}/clean`, {
        method: 'POST',
        body: JSON.stringify({
          action,
          cleanedBy: staff || cleaningStaffName || 'Sanitation Team',
        }),
      });
      fetchBeds();
    } catch (err: any) {
      alert(err.message || 'Sanitization update failed');
    } finally {
      setCleaningBedActionLoading(null);
    }
  };

  const handleCreateBed = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddingBedLoading(true);
    try {
      await apiFetch('/hospitals/beds', {
        method: 'POST',
        body: JSON.stringify({
          bedNumber: newBedNumber,
          ward: newBedWard,
          category: newBedCategory,
          notes: newBedNotes,
        }),
      });
      setShowAddBedModal(false);
      setNewBedNumber('');
      setNewBedNotes('');
      fetchBeds();
    } catch (err: any) {
      alert(err.message || 'Failed to register bed');
    } finally {
      setAddingBedLoading(false);
    }
  };

  const handleUpdateCapacity = async (e: React.FormEvent) => {
    e.preventDefault();
    const hospitalId = user?.hospital?.id || (user as any)?.hospitalId;
    if (!hospitalId) {
      alert('Hospital record is not configured for this user.');
      return;
    }

    setUpdatingCapacity(true);
    try {
      await apiFetch(`/hospitals/${hospitalId}/capacity`, {
        method: 'PATCH',
        body: JSON.stringify({
          availableBeds: Number(capacityAvailBeds),
          totalBeds: Number(capacityTotalBeds),
          reason: capacityReason || 'Administrative capacity quota adjustment',
        }),
      });

      setShowCapacityModal(false);
      setCapacityReason('');
      await fetchBeds();
      alert('Hospital capacity updated and audited successfully.');
    } catch (err: any) {
      alert(err.message || 'Failed to update hospital capacity');
    } finally {
      setUpdatingCapacity(false);
    }
  };

  const fetchAuditLogs = async () => {
    const hospitalId = user?.hospital?.id || (user as any)?.hospitalId;
    if (!hospitalId) return;
    setLoadingAuditLogs(true);
    try {
      const data = await apiFetch(`/hospitals/${hospitalId}/capacity-history`);
      setCapacityAuditLogs(data.auditLogs || []);
    } catch (err: any) {
      console.error('Failed to load capacity audit logs:', err);
    } finally {
      setLoadingAuditLogs(false);
    }
  };

  const handleSetBedStatus = async (bedId: string, status: string, notes?: string) => {
    try {
      await apiFetch(`/hospitals/beds/${bedId}`, {
        method: 'PUT',
        body: JSON.stringify({ status, notes }),
      });
      fetchBeds();
    } catch (err: any) {
      alert(err.message || 'Failed to update bed status');
    }
  };

  const handleDeleteBed = async (bedId: string, bedNumber: string) => {
    if (!confirm(`Are you sure you want to remove Bed ${bedNumber} from capacity inventory?`)) return;
    try {
      await apiFetch(`/hospitals/beds/${bedId}`, { method: 'DELETE' });
      fetchBeds();
    } catch (err: any) {
      alert(err.message || 'Failed to delete bed');
    }
  };

  // -------------------------------------------------------------
  // Admissions & Bookings Actions
  // -------------------------------------------------------------

  const handleCreateBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingBooking(true);
    try {
      await apiFetch('/hospitals/bookings', {
        method: 'POST',
        body: JSON.stringify({
          patientName: bkPatientName,
          patientPhone: bkPatientPhone,
          bookingType: bkType,
          department: bkDepartment,
          doctorName: bkDoctor,
          triageLevel: bkTriage,
          symptoms: bkSymptoms,
          assignedBedId: bkAssignedBedId || null,
          notes: bkNotes,
        }),
      });

      setShowNewBookingModal(false);
      setBkPatientName('');
      setBkPatientPhone('');
      setBkSymptoms('');
      setBkAssignedBedId('');
      setBkNotes('');
      fetchBookings();
      fetchBeds();
    } catch (err: any) {
      alert(err.message || 'Failed to create booking admission');
    } finally {
      setSubmittingBooking(false);
    }
  };

  const handleUpdateBookingStatus = async (bookingId: string, newStatus: string, bedId?: string) => {
    try {
      await apiFetch(`/hospitals/bookings/${bookingId}/status`, {
        method: 'PUT',
        body: JSON.stringify({
          status: newStatus,
          assignedBedId: bedId,
        }),
      });
      fetchBookings();
      fetchBeds();
    } catch (err: any) {
      alert(err.message || 'Failed to update booking status');
    }
  };

  // -------------------------------------------------------------
  // Assign ER Bay for Inbound Rig
  // -------------------------------------------------------------
  const handleAssignBaySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assigningBayModal) return;
    setSavingBayAssignment(true);

    try {
      // Find bed id if matching
      const targetBed = bedsList.find((b) => b.bedNumber === selectedBayToAssign);
      await apiFetch(`/hospitals/requests/${assigningBayModal.id}/assign-bay`, {
        method: 'POST',
        body: JSON.stringify({
          assignedBay: selectedBayToAssign,
          bedId: targetBed?.id,
          doctorName: selectedDoctorForBay,
        }),
      });

      setAssigningBayModal(null);
      fetchIncomingRequests();
      fetchBeds();
      alert(`Bay ${selectedBayToAssign} assigned and reserved for incoming ambulance! Driver alerted.`);
    } catch (err: any) {
      alert(err.message || 'Failed to assign bay');
    } finally {
      setSavingBayAssignment(false);
    }
  };

  // -------------------------------------------------------------
  // Fleet & Roster Actions
  // -------------------------------------------------------------
  const handleVerifyDriver = async (driverId: string, status: 'APPROVED' | 'REJECTED') => {
    try {
      await apiFetch(`/hospitals/drivers/${driverId}/verify`, {
        method: 'PUT',
        body: JSON.stringify({ status }),
      });
      fetchRoster();
    } catch (err: any) {
      alert(err.message || 'Verification update failed.');
    }
  };

  const handleToggleDriverStatus = async (driverId: string, currentIsActive: boolean) => {
    try {
      await apiFetch(`/hospitals/drivers/${driverId}/status`, {
        method: 'PUT',
        body: JSON.stringify({ isActive: !currentIsActive }),
      });
      fetchRoster();
    } catch (err: any) {
      alert(err.message || 'Driver activation update failed.');
    }
  };

  const handleRegisterAmbulance = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegisterSuccess('');
    setRegisterError('');
    setRegistering(true);
    try {
      await apiFetch('/hospitals/ambulances', {
        method: 'POST',
        body: JSON.stringify({
          vehicleNumber: newVehicleNumber,
          ambulanceType: newAmbulanceType,
        }),
      });
      setRegisterSuccess(`Ambulance ${newVehicleNumber} registered successfully!`);
      setNewVehicleNumber('');
      fetchFleet();
    } catch (err: any) {
      setRegisterError(err.message || 'Failed to register ambulance.');
    } finally {
      setRegistering(false);
    }
  };

  const handleUpdateAmbulance = async (ambulanceId: string, driverId?: string | null, maintenanceStatus?: string) => {
    try {
      const payload: any = {};
      if (driverId !== undefined) payload.driverId = driverId;
      if (maintenanceStatus !== undefined) payload.maintenanceStatus = maintenanceStatus;

      await apiFetch(`/hospitals/ambulances/${ambulanceId}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      fetchFleet();
    } catch (err: any) {
      alert(err.message || 'Fleet update failed.');
    }
  };

  // Queue actions
  const handleUpdateQueueStatus = async (id: string, status: string) => {
    try {
      await apiFetch(`/queue/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      fetchQueueEntries();
    } catch (err) {
      console.error('Failed to update queue status:', err);
    }
  };

  const handleUpdateQueuePriority = async (id: string, priority: string) => {
    try {
      await apiFetch(`/queue/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ priority }),
      });
      fetchQueueEntries();
    } catch (err) {
      console.error('Failed to update priority:', err);
    }
  };

  const handleAddWalkIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!walkInEmail) return;
    setAddingWalkIn(true);
    try {
      await apiFetch('/queue/walkin', {
        method: 'POST',
        body: JSON.stringify({
          email: walkInEmail,
          specialty: walkInSpecialty,
          priority: walkInPriority,
        }),
      });
      setWalkInEmail('');
      fetchQueueEntries();
    } catch (err: any) {
      alert(err.message || 'Failed to register walk-in patient.');
    } finally {
      setAddingWalkIn(false);
    }
  };

  // -------------------------------------------------------------
  // Filtered Lists
  // -------------------------------------------------------------
  const filteredBeds = bedsList.filter((bed) => {
    const matchesWard = selectedWardFilter === 'ALL' || bed.ward === selectedWardFilter;
    const matchesStatus = selectedBedStatusFilter === 'ALL' || bed.status === selectedBedStatusFilter;
    const matchesSearch =
      !bedSearchQuery ||
      bed.bedNumber.toLowerCase().includes(bedSearchQuery.toLowerCase()) ||
      (bed.patientName && bed.patientName.toLowerCase().includes(bedSearchQuery.toLowerCase())) ||
      (bed.assignedDoctor && bed.assignedDoctor.toLowerCase().includes(bedSearchQuery.toLowerCase()));
    return matchesWard && matchesStatus && matchesSearch;
  });

  const cleaningQueueBeds = bedsList.filter((bed) => bed.status === 'CLEANING');

  const filteredBookings = bookingsList.filter((bk) => {
    const matchesType = bookingTypeFilter === 'ALL' || bk.bookingType === bookingTypeFilter;
    const matchesStatus = bookingStatusFilter === 'ALL' || bk.status === bookingStatusFilter;
    const matchesSearch =
      !bookingSearch ||
      bk.patientName.toLowerCase().includes(bookingSearch.toLowerCase()) ||
      bk.patientPhone.includes(bookingSearch) ||
      (bk.doctorName && bk.doctorName.toLowerCase().includes(bookingSearch.toLowerCase())) ||
      (bk.department && bk.department.toLowerCase().includes(bookingSearch.toLowerCase()));
    return matchesType && matchesStatus && matchesSearch;
  });

  // Ward display helpers
  const getWardBadge = (ward: string) => {
    switch (ward) {
      case 'ICU':
        return <span className="px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 text-[10px] font-extrabold uppercase">ICU Unit</span>;
      case 'TRAUMA':
      case 'EMERGENCY_ER':
        return <span className="px-2 py-0.5 rounded-full bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20 text-[10px] font-extrabold uppercase">ER Resus</span>;
      case 'GENERAL_WARD':
        return <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-[10px] font-extrabold uppercase">General Inpatient</span>;
      case 'PEDIATRIC':
        return <span className="px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 text-[10px] font-extrabold uppercase">Pediatric</span>;
      case 'SURGICAL':
        return <span className="px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20 text-[10px] font-extrabold uppercase">Surgical Post-Op</span>;
      default:
        return <span className="px-2 py-0.5 rounded-full bg-slate-500/10 text-slate-400 border border-slate-500/20 text-[10px] font-extrabold uppercase">{ward}</span>;
    }
  };

  const getCategoryBadge = (category?: string) => {
    if (!category) return null;
    return (
      <span className="px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 text-[9px] font-extrabold uppercase">
        {category}
      </span>
    );
  };

  const getBedStatusBadge = (status: string) => {
    switch (status) {
      case 'AVAILABLE':
        return <span className="px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-black text-2xs uppercase tracking-wider flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Available</span>;
      case 'OCCUPIED':
        return <span className="px-2.5 py-1 rounded-full bg-rose-500/15 text-rose-600 dark:text-rose-400 font-black text-2xs uppercase tracking-wider flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-rose-500" /> Occupied</span>;
      case 'CLEANING':
        return <span className="px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 font-black text-2xs uppercase tracking-wider flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-spin" /> Cleaning / Sanitizing</span>;
      case 'MAINTENANCE':
        return <span className="px-2.5 py-1 rounded-full bg-slate-500/15 text-slate-500 dark:text-slate-400 font-black text-2xs uppercase tracking-wider flex items-center gap-1.5"><Wrench className="w-3 h-3" /> Maintenance</span>;
      case 'UNAVAILABLE':
        return <span className="px-2.5 py-1 rounded-full bg-neutral-500/15 text-neutral-500 dark:text-neutral-400 font-black text-2xs uppercase tracking-wider flex items-center gap-1.5"><ShieldAlert className="w-3 h-3" /> Unavailable</span>;
      case 'RESERVED':
        return <span className="px-2.5 py-1 rounded-full bg-blue-500/15 text-blue-600 dark:text-blue-400 font-black text-2xs uppercase tracking-wider flex items-center gap-1.5"><Clock className="w-3 h-3" /> Inbound Reserved</span>;
      default:
        return <span className="px-2 py-0.5 rounded-full bg-slate-500/10 text-slate-400 text-xs">{status}</span>;
    }
  };

  const getTriageBadge = (level: string) => {
    switch (level) {
      case 'RED_CRITICAL':
        return <span className="px-2 py-0.5 rounded bg-red-600 text-white font-extrabold text-[9px] uppercase tracking-wider">Level 1: Red Critical</span>;
      case 'YELLOW_URGENT':
        return <span className="px-2 py-0.5 rounded bg-amber-500 text-slate-950 font-extrabold text-[9px] uppercase tracking-wider">Level 2: Yellow Urgent</span>;
      case 'GREEN_ROUTINE':
        return <span className="px-2 py-0.5 rounded bg-emerald-600 text-white font-extrabold text-[9px] uppercase tracking-wider">Level 3: Green Standard</span>;
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 flex flex-col font-sans select-none transition-colors">
      
      {/* -------------------------------------------------------------
          Header Bar with Status Indicators
          ------------------------------------------------------------- */}
      <header className="bg-white dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 py-3.5 px-6 sticky top-0 z-30 shadow-sm flex items-center justify-between transition-colors">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <Activity className="w-5 h-5 text-white animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-black tracking-tight text-slate-900 dark:text-white">
                {user?.hospital?.name || 'LifeLink Regional Medical Center'}
              </span>
              <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold rounded-full border border-emerald-500/20 uppercase font-mono">
                ER Active Station
              </span>
            </div>
            <span className="text-[11px] text-slate-500 dark:text-slate-400 block font-medium">
              Administrative Operations Console · {user?.name || 'Hospital Admin'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 md:gap-5">
          <ThemeToggle />
          <button
            onClick={logout}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30 dark:hover:text-rose-400 transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Logout</span>
          </button>
        </div>
      </header>

      {/* -------------------------------------------------------------
          Live Clinical KPI Ribbon
          ------------------------------------------------------------- */}
      <section className="bg-slate-100/70 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800/80 px-6 py-3 transition-colors">
        <div className="max-w-7xl mx-auto grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-blue-500/10 text-blue-500 flex items-center justify-center shrink-0">
              <Bed className="w-4 h-4" />
            </div>
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block font-mono">Total Beds</span>
              <span className="text-lg font-black text-slate-800 dark:text-slate-100">{bedStats.total}</span>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center shrink-0">
              <CheckCircle className="w-4 h-4" />
            </div>
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block font-mono">Available</span>
              <span className="text-lg font-black text-emerald-600 dark:text-emerald-400">{bedStats.available}</span>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-rose-500/10 text-rose-500 flex items-center justify-center shrink-0">
              <User className="w-4 h-4" />
            </div>
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block font-mono">Occupied</span>
              <span className="text-lg font-black text-rose-600 dark:text-rose-400">{bedStats.occupied}</span>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center shrink-0">
              <Droplets className="w-4 h-4" />
            </div>
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block font-mono">Cleaning Queue</span>
              <span className="text-lg font-black text-amber-600 dark:text-amber-400">{bedStats.cleaning}</span>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-rose-500/10 text-rose-500 flex items-center justify-center shrink-0">
              <Heart className="w-4 h-4" />
            </div>
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block font-mono">ICU Vacant</span>
              <span className="text-lg font-black text-rose-500">{bedStats.icuAvailable}</span>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-red-500/10 text-red-500 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block font-mono">ER Bays Free</span>
              <span className="text-lg font-black text-red-500">{bedStats.erAvailable}</span>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-cyan-500/10 text-cyan-500 flex items-center justify-center shrink-0">
              <Truck className="w-4 h-4" />
            </div>
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block font-mono">Inbound Rigs</span>
              <span className="text-lg font-black text-cyan-500">{emergencies.length}</span>
            </div>
          </div>

        </div>
      </section>

      {/* -------------------------------------------------------------
          Navigation Tabs Bar
          ------------------------------------------------------------- */}
      <section className="bg-white dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 px-6 transition-colors">
        <div className="max-w-7xl mx-auto flex gap-2 overflow-x-auto py-2.5">
          
          <button
            onClick={() => setActiveDashboardTab('BEDS')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer shrink-0 ${
              activeDashboardTab === 'BEDS'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900'
            }`}
          >
            <Bed className="w-4 h-4" />
            <span>Ward & Bed Floor Grid</span>
            <span className="px-1.5 py-0.2 rounded-md bg-white/20 text-[10px]">{bedStats.total}</span>
          </button>

          <button
            onClick={() => setActiveDashboardTab('DISPATCHES')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer shrink-0 ${
              activeDashboardTab === 'DISPATCHES'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900'
            }`}
          >
            <Activity className="w-4 h-4" />
            <span>Inbound ER Command</span>
            {emergencies.length > 0 && (
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
            )}
          </button>

          <button
            onClick={() => setActiveDashboardTab('BOOKINGS')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer shrink-0 ${
              activeDashboardTab === 'BOOKINGS'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900'
            }`}
          >
            <Calendar className="w-4 h-4" />
            <span>Admissions & Bookings</span>
            <span className="px-1.5 py-0.2 rounded-md bg-slate-200 dark:bg-slate-800 text-[10px] text-slate-700 dark:text-slate-300">
              {bookingsList.length}
            </span>
          </button>

          <button
            onClick={() => setActiveDashboardTab('APPOINTMENTS_DOCTORS')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer shrink-0 ${
              activeDashboardTab === 'APPOINTMENTS_DOCTORS'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900'
            }`}
          >
            <Stethoscope className="w-4 h-4" />
            <span>Doctors & Appointment Slots</span>
          </button>

          <button
            onClick={() => setActiveDashboardTab('CLEANING')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer shrink-0 ${
              activeDashboardTab === 'CLEANING'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900'
            }`}
          >
            <Droplets className="w-4 h-4" />
            <span>Housekeeping & Sanitation</span>
            {cleaningQueueBeds.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-md bg-amber-500 text-slate-950 font-black text-[10px]">
                {cleaningQueueBeds.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveDashboardTab('QUEUE')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer shrink-0 ${
              activeDashboardTab === 'QUEUE'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900'
            }`}
          >
            <ClipboardList className="w-4 h-4" />
            <span>Specialist OPD Queue</span>
            <span className="px-1.5 py-0.2 rounded-md bg-slate-200 dark:bg-slate-800 text-[10px] text-slate-700 dark:text-slate-300">
              {queueEntries.length}
            </span>
          </button>

          <button
            onClick={() => setActiveDashboardTab('FLEET')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer shrink-0 ${
              activeDashboardTab === 'FLEET'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900'
            }`}
          >
            <Truck className="w-4 h-4" />
            <span>Ambulance Fleet</span>
          </button>

          <button
            onClick={() => setActiveDashboardTab('ROSTER')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer shrink-0 ${
              activeDashboardTab === 'ROSTER'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900'
            }`}
          >
            <UserCheck className="w-4 h-4" />
            <span>Driver Roster</span>
          </button>

          <button
            onClick={() => setActiveDashboardTab('ANALYTICS')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer shrink-0 ${
              activeDashboardTab === 'ANALYTICS'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900'
            }`}
          >
            <BarChart3 className="w-4 h-4 text-emerald-400" />
            <span>Operations Analytics</span>
          </button>

        </div>
      </section>

      {/* -------------------------------------------------------------
          Main Content View Area
          ------------------------------------------------------------- */}
      <main className="max-w-7xl w-full mx-auto p-4 md:p-6 flex-1 flex flex-col gap-6">

        {/* ============================================================
            TAB: OPERATIONS ANALYTICS & REPORTING (Prompt 27)
            ============================================================ */}
        {activeDashboardTab === 'ANALYTICS' && (
          <AnalyticsReportingView scopedHospitalId={user?.hospital?.id} />
        )}

        {/* ============================================================
            TAB 1: WARD & BED FLOOR GRID
            ============================================================ */}
        {activeDashboardTab === 'BEDS' && (
          <div className="space-y-6">
            
            {/* Filter & Action Toolbar */}
            <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-4 rounded-2xl flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4 shadow-sm">
              
              {/* Ward Filter Chips */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 lg:pb-0">
                {[
                  { key: 'ALL', label: 'All Wards' },
                  { key: 'ICU', label: 'ICU' },
                  { key: 'EMERGENCY_ER', label: 'ER Resus' },
                  { key: 'TRAUMA', label: 'Trauma' },
                  { key: 'GENERAL_WARD', label: 'General' },
                  { key: 'PEDIATRIC', label: 'Pediatric' },
                  { key: 'SURGICAL', label: 'Surgical' },
                ].map((w) => (
                  <button
                    key={w.key}
                    onClick={() => setSelectedWardFilter(w.key)}
                    className={`px-3 py-1.5 rounded-xl text-2xs font-bold uppercase tracking-wider transition-colors cursor-pointer shrink-0 ${
                      selectedWardFilter === w.key
                        ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/20'
                        : 'bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-850'
                    }`}
                  >
                    {w.label}
                  </button>
                ))}
              </div>

              {/* Search & Actions */}
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="relative flex-1 sm:w-60">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search bed, patient, doctor..."
                    value={bedSearchQuery}
                    onChange={(e) => setBedSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                {/* Status dropdown filter */}
                <select
                  value={selectedBedStatusFilter}
                  onChange={(e) => setSelectedBedStatusFilter(e.target.value)}
                  className="px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 focus:outline-none"
                >
                  <option value="ALL">Status: All</option>
                  <option value="AVAILABLE">Available</option>
                  <option value="OCCUPIED">Occupied</option>
                  <option value="CLEANING">Cleaning Queue</option>
                  <option value="RESERVED">Reserved</option>
                  <option value="MAINTENANCE">Maintenance</option>
                  <option value="UNAVAILABLE">Unavailable</option>
                </select>

                <button
                  onClick={() => {
                    setCapacityTotalBeds(bedStats.total);
                    setCapacityAvailBeds(bedStats.available);
                    setShowCapacityModal(true);
                  }}
                  className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shrink-0 border border-slate-200 dark:border-slate-700"
                  title="Configure total capacity, category quotas and baseline bed allotments"
                >
                  <Sliders className="w-3.5 h-3.5 text-blue-500" />
                  <span>Capacity Quotas</span>
                </button>

                <button
                  onClick={() => {
                    fetchAuditLogs();
                    setShowAuditModal(true);
                  }}
                  className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shrink-0 border border-slate-200 dark:border-slate-700"
                  title="View immutable capacity and bed modification audit history"
                >
                  <History className="w-3.5 h-3.5 text-purple-500" />
                  <span>Audit Trail</span>
                </button>

                <button
                  onClick={() => setShowAddBedModal(true)}
                  className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl transition-all shadow-md shadow-emerald-600/20 flex items-center gap-1.5 cursor-pointer shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Bed</span>
                </button>
              </div>

            </div>

            {/* Visual Ward Bed Grid */}
            {loadingBeds ? (
              <div className="py-20 flex flex-col items-center justify-center gap-4">
                <HeartbeatLoader size="large" />
                <span className="text-xs text-slate-400 font-semibold">Synchronizing clinical bed matrix...</span>
              </div>
            ) : filteredBeds.length === 0 ? (
              <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-3xl p-12 text-center text-slate-500 text-xs">
                No hospital beds matching this ward or status filter.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {filteredBeds.map((bed) => {
                  const isOccupied = bed.status === 'OCCUPIED';
                  const isAvailable = bed.status === 'AVAILABLE';
                  const isCleaning = bed.status === 'CLEANING';
                  const isReserved = bed.status === 'RESERVED';
                  const isMaintenance = bed.status === 'MAINTENANCE';
                  const isUnavailable = bed.status === 'UNAVAILABLE';

                  return (
                    <div
                      key={bed.id}
                      className={`relative bg-white dark:bg-slate-950 border rounded-2xl p-5 flex flex-col justify-between transition-all duration-300 hover:shadow-lg ${
                        isAvailable
                          ? 'border-emerald-500/30 dark:border-emerald-500/20 hover:border-emerald-500'
                          : isOccupied
                          ? 'border-rose-500/30 dark:border-rose-500/20 hover:border-rose-500'
                          : isCleaning
                          ? 'border-amber-500/40 dark:border-amber-500/30 bg-amber-500/[0.02]'
                          : isReserved
                          ? 'border-blue-500/30 dark:border-blue-500/20'
                          : isUnavailable
                          ? 'border-neutral-400 dark:border-neutral-800 bg-neutral-500/5'
                          : 'border-slate-300 dark:border-slate-800 opacity-75'
                      }`}
                    >
                      {/* Top Bed Header */}
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-base font-black text-slate-900 dark:text-white font-mono tracking-tight">
                              {bed.bedNumber}
                            </span>
                            {getWardBadge(bed.ward)}
                            {getCategoryBadge(bed.category)}
                          </div>
                          {getBedStatusBadge(bed.status)}
                        </div>

                        {/* Bed Details / Patient Details */}
                        <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-900 min-h-[5.5rem] space-y-2">
                          {isOccupied && (
                            <>
                              <div>
                                <span className="text-[10px] uppercase font-bold text-slate-400 font-mono block">Patient Admitted</span>
                                <span className="text-xs font-bold text-slate-800 dark:text-slate-100 block truncate">
                                  {bed.patientName || 'Admitted Patient'}
                                </span>
                              </div>
                              <div className="flex items-center justify-between text-2xs text-slate-500">
                                <span>Dr. {bed.assignedDoctor || 'On-Call MD'}</span>
                                {bed.admittedAt && (
                                  <span className="font-mono text-[9px] text-slate-400">
                                    Admitted {new Date(bed.admittedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                )}
                              </div>
                              {bed.notes && (
                                <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2 italic bg-slate-50 dark:bg-slate-900/50 p-1.5 rounded-lg">
                                  &ldquo;{bed.notes}&rdquo;
                                </p>
                              )}
                            </>
                          )}

                          {isAvailable && (
                            <div className="space-y-1.5">
                              <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                                <Check className="w-3.5 h-3.5" /> Ready for Clinical Admission
                              </span>
                              <p className="text-[11px] text-slate-400">
                                {bed.notes || 'Full sterilization complete. Vitals monitors connected.'}
                              </p>
                              {bed.lastCleanedAt && (
                                <span className="text-[9px] text-slate-400 font-mono block">
                                  Sanitized {new Date(bed.lastCleanedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              )}
                            </div>
                          )}

                          {isCleaning && (
                            <div className="space-y-1.5">
                              <span className="text-xs font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1">
                                <Droplets className="w-3.5 h-3.5" />
                                {bed.cleaningPriority === 'TERMINAL_DISINFECTION' ? 'Terminal Disinfection Required' : 'Housekeeping Turnaround'}
                              </span>
                              <p className="text-[11px] text-slate-400">
                                Staff: {bed.cleanedBy || 'Housekeeping Unit Active'}
                              </p>
                              <span className="text-[10px] text-amber-500/80 font-mono block">
                                Awaiting sanitization sign-off before admission.
                              </span>
                            </div>
                          )}

                          {isReserved && (
                            <div className="space-y-1.5">
                              <span className="text-xs font-bold text-blue-500 flex items-center gap-1">
                                <Clock className="w-3.5 h-3.5" /> Reserved for Inbound Patient
                              </span>
                              <p className="text-[11px] text-slate-400">
                                Patient: {bed.patientName || 'In-transit SOS Rig'}
                              </p>
                            </div>
                          )}

                          {isMaintenance && (
                            <div className="space-y-1">
                              <span className="text-xs font-bold text-slate-400 flex items-center gap-1">
                                <Wrench className="w-3.5 h-3.5" /> Out of Clinical Service
                              </span>
                              <p className="text-[11px] text-slate-500">{bed.notes || 'Under engineering inspection.'}</p>
                            </div>
                          )}

                          {isUnavailable && (
                            <div className="space-y-1">
                              <span className="text-xs font-bold text-neutral-400 flex items-center gap-1">
                                <ShieldAlert className="w-3.5 h-3.5" /> Offline / Decommissioned
                              </span>
                              <p className="text-[11px] text-slate-500">{bed.notes || 'Decommissioned from active roster.'}</p>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-900 flex items-center gap-2">
                        {isAvailable && (
                          <div className="flex items-center gap-1.5 w-full">
                            <button
                              onClick={() => {
                                setSelectedBedForAdmit(bed);
                                setShowAdmitModal(true);
                              }}
                              className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-1 cursor-pointer"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              <span>Admit</span>
                            </button>
                            <button
                              onClick={() => handleSetBedStatus(bed.id, 'MAINTENANCE')}
                              className="p-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-900 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-xl transition-colors cursor-pointer"
                              title="Set Maintenance"
                            >
                              <Wrench className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleSetBedStatus(bed.id, 'UNAVAILABLE')}
                              className="p-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-900 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-xl transition-colors cursor-pointer"
                              title="Set Unavailable"
                            >
                              <ShieldAlert className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteBed(bed.id, bed.bedNumber)}
                              className="p-2 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/30 dark:hover:bg-rose-900/40 text-rose-600 dark:text-rose-400 rounded-xl transition-colors cursor-pointer"
                              title="Remove Bed"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}

                        {isOccupied && (
                          <button
                            onClick={() => handleDischargePatient(bed)}
                            className="w-full py-2 bg-rose-600/10 hover:bg-rose-600 text-rose-600 hover:text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            <CheckSquare className="w-3.5 h-3.5" />
                            <span>Discharge & Sanitize</span>
                          </button>
                        )}

                        {isCleaning && (
                          <button
                            onClick={() => handleQuickCleanBed(bed.id, 'COMPLETE')}
                            disabled={cleaningBedActionLoading === bed.id}
                            className="w-full py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl text-xs font-extrabold transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>Mark Sanitized & Ready</span>
                          </button>
                        )}

                        {(isReserved || isMaintenance || isUnavailable) && (
                          <div className="flex items-center gap-1.5 w-full">
                            <button
                              onClick={() => handleSetBedStatus(bed.id, 'AVAILABLE')}
                              className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-900 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold transition-colors cursor-pointer"
                            >
                              Restore to Available
                            </button>
                            <button
                              onClick={() => handleDeleteBed(bed.id, bed.bedNumber)}
                              className="p-2 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/30 dark:hover:bg-rose-900/40 text-rose-600 dark:text-rose-400 rounded-xl transition-colors cursor-pointer"
                              title="Remove Bed"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ============================================================
            TAB 2: INBOUND ER COMMAND & BAY ASSIGNMENT
            ============================================================ */}
        {activeDashboardTab === 'DISPATCHES' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* Left Column: Inbound Dispatches List */}
            <div className="lg:col-span-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-black uppercase tracking-wider text-slate-800 dark:text-slate-100">
                    Live Inbound ER Dispatches
                  </h3>
                  <span className="text-[11px] text-slate-400">Ambulances routing to this hospital</span>
                </div>
                <span className="px-2.5 py-1 rounded-full bg-rose-500/10 text-rose-500 text-xs font-black">
                  {emergencies.length} Active Rigs
                </span>
              </div>

              {emergencies.length === 0 ? (
                <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-3xl p-10 text-center text-slate-400 text-xs">
                  <ShieldCheck className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-700 mb-2" />
                  No inbound ambulances currently routing to this ER board.
                </div>
              ) : (
                <div className="space-y-3">
                  {emergencies.map((emg) => {
                    const isSelected = selectedEmergency?.id === emg.id;
                    return (
                      <div
                        key={emg.id}
                        onClick={() => setSelectedEmergency(emg)}
                        className={`p-4 rounded-2xl border transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-500 shadow-md'
                            : 'bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-black text-slate-900 dark:text-white uppercase font-mono">
                            {emg.tripType === 'SOS' ? '🚨 Red SOS Trauma' : '🚑 Urgent Transport'}
                          </span>
                          <span className="px-2 py-0.5 rounded-full bg-rose-500 text-white font-mono text-[10px] font-bold">
                            ETA: {emg.etaMinutes || 4} mins
                          </span>
                        </div>

                        <div className="space-y-1">
                          <span className="text-sm font-bold text-slate-800 dark:text-slate-100 block">
                            Patient: {emg.patient?.name || 'Anonymous Emergency'}
                          </span>
                          <span className="text-2xs text-slate-400 block font-mono">
                            Driver: {emg.driver?.name || 'Medic En-Route'} ({emg.driver?.ambulance?.vehicleNumber || 'AMB-Active'})
                          </span>
                        </div>

                        {/* Assigned Bay Banner */}
                        <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-900 flex items-center justify-between">
                          <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                            <Bed className="w-3.5 h-3.5" />
                            <span>{emg.assignedBay || 'ER Bay: Unassigned'}</span>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setAssigningBayModal(emg);
                            }}
                            className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-2xs font-extrabold rounded-lg transition-colors cursor-pointer"
                          >
                            Assign Bay →
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Right Column: Live Map & Selected Patient Vitals */}
            <div className="lg:col-span-7 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 flex flex-col gap-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-black text-slate-800 dark:text-slate-200 uppercase tracking-wider font-mono">
                    Inbound GPS Telemetry & OSRM Corridors
                  </h4>
                  <span className="text-3xs text-slate-400">Real-time coordinates synced via websockets</span>
                </div>
                {selectedEmergency && (
                  <button
                    onClick={() => setAssigningBayModal(selectedEmergency)}
                    className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-md shadow-emerald-600/20 cursor-pointer"
                  >
                    <Bed className="w-3.5 h-3.5" />
                    <span>Allocate Bay ({selectedEmergency.assignedBay || 'Unassigned'})</span>
                  </button>
                )}
              </div>

              {/* Map View */}
              <div className="h-[360px] w-full rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 relative">
                <LeafletMap
                  hospitalLoc={[user?.hospital?.lat || 21.1458, user?.hospital?.lng || 79.0882]}
                  driverLoc={
                    selectedEmergency?.driver?.ambulance
                      ? [selectedEmergency.driver.ambulance.currentLat, selectedEmergency.driver.ambulance.currentLng]
                      : undefined
                  }
                  patientLoc={
                    selectedEmergency
                      ? [selectedEmergency.pickupLat, selectedEmergency.pickupLng]
                      : undefined
                  }
                />
              </div>

              {/* Patient Vitals & Medical Profile Card */}
              {selectedEmergency && (
                <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase font-mono block">Blood Type</span>
                    <span className="font-extrabold text-rose-500 text-sm">
                      {selectedEmergency.patient?.patientProfile?.bloodGroup || 'O+'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase font-mono block">Known Allergies</span>
                    <span className="font-bold text-slate-700 dark:text-slate-300 truncate block">
                      {selectedEmergency.patient?.patientProfile?.allergies || 'NKDA (None Known)'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase font-mono block">Contact Phone</span>
                    <span className="font-bold text-slate-700 dark:text-slate-300 truncate block">
                      {selectedEmergency.patient?.phone || '+15550199'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase font-mono block">Designated Bay</span>
                    <span className="font-extrabold text-emerald-500 truncate block">
                      {selectedEmergency.assignedBay || 'Pending Staff Allocation'}
                    </span>
                  </div>
                </div>
              )}
            </div>

          </div>
        )}

        {/* ============================================================
            TAB 3: ADMISSIONS & BOOKINGS HUB
            ============================================================ */}
        {activeDashboardTab === 'BOOKINGS' && (
          <div className="space-y-6">
            
            {/* Action & Filter Header */}
            <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-4 rounded-2xl flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4 shadow-sm">
              
              <div className="flex items-center gap-2 overflow-x-auto pb-1 lg:pb-0">
                {[
                  { key: 'ALL', label: 'All Bookings' },
                  { key: 'EMERGENCY_ADMISSION', label: 'Emergency Admissions' },
                  { key: 'OPD_CONSULTATION', label: 'OPD Consultations' },
                  { key: 'BED_RESERVATION', label: 'Bed Reservations' },
                  { key: 'SCHEDULED_SURGERY', label: 'Scheduled Surgeries' },
                ].map((b) => (
                  <button
                    key={b.key}
                    onClick={() => setBookingTypeFilter(b.key)}
                    className={`px-3 py-1.5 rounded-xl text-2xs font-bold uppercase tracking-wider transition-colors cursor-pointer shrink-0 ${
                      bookingTypeFilter === b.key
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : 'bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-850'
                    }`}
                  >
                    {b.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2.5">
                <div className="relative w-56">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search patient, doctor..."
                    value={bookingSearch}
                    onChange={(e) => setBookingSearch(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none"
                  />
                </div>

                <select
                  value={bookingStatusFilter}
                  onChange={(e) => setBookingStatusFilter(e.target.value)}
                  className="px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 focus:outline-none"
                >
                  <option value="ALL">Status: All</option>
                  <option value="CONFIRMED">Confirmed</option>
                  <option value="ADMITTED">Admitted</option>
                  <option value="PENDING">Pending</option>
                  <option value="COMPLETED">Completed</option>
                  <option value="CANCELLED">Cancelled</option>
                </select>

                <button
                  onClick={() => setShowNewBookingModal(true)}
                  className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl transition-all shadow-md shadow-emerald-600/20 flex items-center gap-1.5 cursor-pointer shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>New Booking / Admission</span>
                </button>
              </div>

            </div>

            {/* Bookings Table */}
            {loadingBookings ? (
              <div className="py-20 flex flex-col items-center justify-center gap-4">
                <HeartbeatLoader size="large" />
                <span className="text-xs text-slate-400 font-semibold">Loading admissions registry...</span>
              </div>
            ) : filteredBookings.length === 0 ? (
              <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-3xl p-12 text-center text-slate-400 text-xs">
                No admissions or patient bookings registered under these filters.
              </div>
            ) : (
              <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-3xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-900/80 border-b border-slate-200 dark:border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono">
                      <tr>
                        <th className="py-3.5 px-4">Patient & Phone</th>
                        <th className="py-3.5 px-4">Category & Department</th>
                        <th className="py-3.5 px-4">Triage Priority</th>
                        <th className="py-3.5 px-4">Attending Doctor</th>
                        <th className="py-3.5 px-4">Assigned Bed</th>
                        <th className="py-3.5 px-4">Status</th>
                        <th className="py-3.5 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-900">
                      {filteredBookings.map((bk) => (
                        <tr key={bk.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/40 transition-colors">
                          <td className="py-3.5 px-4">
                            <span className="font-bold text-slate-900 dark:text-white block">{bk.patientName}</span>
                            <span className="text-2xs text-slate-400 font-mono">{bk.patientPhone}</span>
                          </td>
                          <td className="py-3.5 px-4">
                            <span className="font-semibold text-slate-800 dark:text-slate-200 block">{bk.department}</span>
                            <span className="text-3xs text-slate-400 uppercase font-mono">{bk.bookingType.replace('_', ' ')}</span>
                          </td>
                          <td className="py-3.5 px-4">
                            {getTriageBadge(bk.triageLevel)}
                          </td>
                          <td className="py-3.5 px-4 text-slate-700 dark:text-slate-300 font-medium">
                            {bk.doctorName || 'Assigned Staff'}
                          </td>
                          <td className="py-3.5 px-4">
                            {bk.assignedBed ? (
                              <span className="px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-black font-mono text-2xs border border-emerald-500/20">
                                {bk.assignedBed.bedNumber} ({bk.assignedBed.ward})
                              </span>
                            ) : (
                              <span className="text-2xs text-slate-400 italic">No bed allocated</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4">
                            <span
                              className={`px-2 py-0.5 rounded-full font-bold text-3xs uppercase tracking-wider ${
                                bk.status === 'ADMITTED'
                                  ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/20'
                                  : bk.status === 'CONFIRMED'
                                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                                  : bk.status === 'COMPLETED'
                                  ? 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                                  : 'bg-amber-500/15 text-amber-500'
                              }`}
                            >
                              {bk.status}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {bk.status === 'CONFIRMED' && !bk.assignedBedId && (
                                <button
                                  onClick={() => {
                                    // Allocate first available bed
                                    const freeBed = bedsList.find((b) => b.status === 'AVAILABLE');
                                    if (freeBed) {
                                      handleUpdateBookingStatus(bk.id, 'ADMITTED', freeBed.id);
                                    } else {
                                      alert('No available beds currently. Please clear or sanitize a bed first.');
                                    }
                                  }}
                                  className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-2xs font-bold transition-colors cursor-pointer"
                                >
                                  Admit to Bed
                                </button>
                              )}

                              {bk.status === 'ADMITTED' && (
                                <button
                                  onClick={() => handleUpdateBookingStatus(bk.id, 'COMPLETED')}
                                  className="px-2.5 py-1 bg-rose-600/10 hover:bg-rose-600 text-rose-600 hover:text-white rounded-lg text-2xs font-bold transition-all cursor-pointer"
                                >
                                  Discharge
                                </button>
                              )}

                              {bk.status === 'PENDING' && (
                                <button
                                  onClick={() => handleUpdateBookingStatus(bk.id, 'CONFIRMED')}
                                  className="px-2.5 py-1 bg-blue-600 text-white rounded-lg text-2xs font-bold transition-colors cursor-pointer"
                                >
                                  Confirm
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

          </div>
        )}

        {/* ============================================================
            TAB: DOCTORS & OUTPATIENT APPOINTMENT SLOTS
            ============================================================ */}
        {activeDashboardTab === 'APPOINTMENTS_DOCTORS' && (
          <DoctorAppointmentsSection apiFetch={apiFetch} hospitalName={user?.hospital?.name} />
        )}

        {/* ============================================================
            TAB 4: HOUSEKEEPING & SANITATION BOARD
            ============================================================ */}
        {activeDashboardTab === 'CLEANING' && (
          <div className="space-y-6">
            
            {/* Header info */}
            <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-6 rounded-3xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-sm">
              <div>
                <div className="flex items-center gap-2">
                  <Droplets className="w-5 h-5 text-amber-500" />
                  <h3 className="text-base font-black text-slate-900 dark:text-white">
                    Housekeeping & Terminal Disinfection Queue
                  </h3>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Beds vacated following patient discharge require sterilization sign-off before being returned to available pool.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <input
                  type="text"
                  placeholder="Sanitation Officer Name..."
                  value={cleaningStaffName}
                  onChange={(e) => setCleaningStaffName(e.target.value)}
                  className="px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none"
                />
              </div>
            </div>

            {/* Cleaning Queue Grid */}
            {cleaningQueueBeds.length === 0 ? (
              <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-3xl p-16 text-center">
                <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto mb-3 opacity-90" />
                <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">100% Sanitation Compliance</h4>
                <p className="text-xs text-slate-400 mt-1">All hospital beds sanitized and ready for patient admissions.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {cleaningQueueBeds.map((bed) => (
                  <div
                    key={bed.id}
                    className="bg-white dark:bg-slate-950 border border-amber-500/30 rounded-2xl p-5 space-y-4 shadow-md"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-lg font-black text-slate-900 dark:text-white font-mono">{bed.bedNumber}</span>
                        {getWardBadge(bed.ward)}
                      </div>
                      <span className="px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400 text-2xs font-extrabold uppercase">
                        {bed.cleaningPriority || 'Sanitation Needed'}
                      </span>
                    </div>

                    <div className="space-y-1.5 text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/50 p-3 rounded-xl">
                      <div className="flex justify-between">
                        <span>Assigned Staff:</span>
                        <span className="font-bold text-slate-700 dark:text-slate-200">{bed.cleanedBy || 'Unassigned Housekeeper'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Sterilization Protocol:</span>
                        <span className="font-bold text-amber-500">
                          {bed.ward === 'ICU' || bed.ward === 'TRAUMA' ? 'UV-C Terminal Disinfection' : 'Level-2 Medical Sanitization'}
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={() => handleQuickCleanBed(bed.id, 'COMPLETE', cleaningStaffName || 'Sanitation Team A')}
                      disabled={cleaningBedActionLoading === bed.id}
                      className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-emerald-600/20 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                    >
                      <Check className="w-4 h-4" />
                      <span>Mark Sanitized & Ready for Patients</span>
                    </button>
                  </div>
                ))}
              </div>
            )}

          </div>
        )}

        {/* ============================================================
            TAB 5: SPECIALIST OPD QUEUE
            ============================================================ */}
        {activeDashboardTab === 'QUEUE' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* Left: Register Walk-In Form */}
            <div className="lg:col-span-4 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-6 rounded-3xl shadow-sm space-y-4">
              <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                <User className="w-5 h-5" />
                <h4 className="text-sm font-bold uppercase tracking-wider">Walk-in OPD Admission</h4>
              </div>

              <form onSubmit={handleAddWalkIn} className="space-y-3.5">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                    Patient LifeLink Email
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="patient@example.com"
                    value={walkInEmail}
                    onChange={(e) => setWalkInEmail(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                    Specialist Department
                  </label>
                  <select
                    value={walkInSpecialty}
                    onChange={(e) => setWalkInSpecialty(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-slate-200 focus:outline-none"
                  >
                    <option value="Cardiology">Cardiology</option>
                    <option value="Orthopedics">Orthopedics</option>
                    <option value="Neurology">Neurology</option>
                    <option value="Pediatrics">Pediatrics</option>
                    <option value="General Medicine">General Medicine</option>
                    <option value="Pulmonology">Pulmonology</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                    Triage Priority
                  </label>
                  <select
                    value={walkInPriority}
                    onChange={(e) => setWalkInPriority(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-slate-200 focus:outline-none"
                  >
                    <option value="STANDARD">Standard Consultation</option>
                    <option value="HIGH">High Priority</option>
                    <option value="EMERGENCY">Emergency Triage</option>
                  </select>
                </div>

                <button
                  type="submit"
                  disabled={addingWalkIn}
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-emerald-600/20 cursor-pointer disabled:opacity-50"
                >
                  {addingWalkIn ? 'Registering...' : 'Add to OPD Waitlist'}
                </button>
              </form>
            </div>

            {/* Right: Active OPD Queue List */}
            <div className="lg:col-span-8 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-6 rounded-3xl shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-black text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                    Live Specialist Queue Registry
                  </h4>
                  <span className="text-3xs text-slate-400">{queueEntries.length} Active Patients Waiting</span>
                </div>
                <button
                  onClick={fetchQueueEntries}
                  className="p-2 hover:bg-slate-100 dark:hover:bg-slate-900 rounded-lg text-slate-400 hover:text-slate-200 transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>

              {loadingQueue ? (
                <div className="py-12 flex justify-center">
                  <HeartbeatLoader size="medium" />
                </div>
              ) : queueEntries.length === 0 ? (
                <div className="py-12 text-center text-slate-400 text-xs">No patients currently in the specialist queue.</div>
              ) : (
                <div className="space-y-3">
                  {queueEntries.map((q) => (
                    <div
                      key={q.id}
                      className="p-4 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl flex items-center justify-between gap-4"
                    >
                      <div className="flex items-center gap-3.5">
                        <span className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-black font-mono text-sm">
                          #{q.queuePosition}
                        </span>
                        <div>
                          <span className="font-bold text-xs text-slate-800 dark:text-slate-100 block">
                            {q.patient?.name || 'Walk-in Patient'}
                          </span>
                          <span className="text-2xs text-slate-400 block font-mono">
                            {q.specialty} · Joined {new Date(q.joinedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <select
                          value={q.priority}
                          onChange={(e) => handleUpdateQueuePriority(q.id, e.target.value)}
                          className="px-2 py-1 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-2xs font-bold"
                        >
                          <option value="STANDARD">Standard</option>
                          <option value="HIGH">High</option>
                          <option value="EMERGENCY">Emergency</option>
                        </select>

                        <select
                          value={q.status}
                          onChange={(e) => handleUpdateQueueStatus(q.id, e.target.value)}
                          className="px-2 py-1 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-2xs font-bold"
                        >
                          <option value="WAITING">Waiting</option>
                          <option value="IN_CONSULTATION">In Consultation</option>
                          <option value="COMPLETED">Completed</option>
                          <option value="SKIPPED">Skipped</option>
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        )}

        {/* ============================================================
            TAB 6: FLEET COMMAND
            ============================================================ */}
        {activeDashboardTab === 'FLEET' && (
          <div className="space-y-6">
            <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-6 rounded-3xl space-y-4 shadow-sm">
              <h3 className="text-sm font-black uppercase tracking-wider text-slate-800 dark:text-slate-200">
                Register New Emergency Ambulance Rig
              </h3>
              {registerSuccess && <div className="p-3 bg-emerald-500/10 text-emerald-500 text-xs rounded-xl">{registerSuccess}</div>}
              {registerError && <div className="p-3 bg-rose-500/10 text-rose-500 text-xs rounded-xl">{registerError}</div>}

              <form onSubmit={handleRegisterAmbulance} className="flex flex-col sm:flex-row gap-3">
                <input
                  type="text"
                  required
                  placeholder="Vehicle Number (e.g. AMB-707)"
                  value={newVehicleNumber}
                  onChange={(e) => setNewVehicleNumber(e.target.value)}
                  className="flex-1 px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs focus:outline-none"
                />
                <select
                  value={newAmbulanceType}
                  onChange={(e) => setNewAmbulanceType(e.target.value)}
                  className="px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs focus:outline-none"
                >
                  <option value="BASIC_LIFE_SUPPORT">Basic Life Support (BLS)</option>
                  <option value="ADVANCED_LIFE_SUPPORT">Advanced Life Support (ALS)</option>
                  <option value="OXYGEN_SUPPORT">Oxygen Support</option>
                </select>
                <button
                  type="submit"
                  disabled={registering}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  {registering ? 'Adding...' : 'Add Ambulance'}
                </button>
              </form>
            </div>

            {/* Fleet List */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {fleetAmbulances.map((amb) => (
                <div key={amb.id} className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-black text-sm text-slate-900 dark:text-white">{amb.vehicleNumber}</span>
                    <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 text-[10px] font-bold">
                      {amb.ambulanceType.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 space-y-1">
                    <div>Assigned Driver: <span className="font-bold text-slate-700 dark:text-slate-300">{amb.driver?.name || 'Unassigned'}</span></div>
                    <div>Maintenance: <span className="font-bold">{amb.maintenanceStatus}</span></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ============================================================
            TAB 7: DRIVER ROSTER
            ============================================================ */}
        {activeDashboardTab === 'ROSTER' && (
          <div className="space-y-4">
            <h3 className="text-sm font-black uppercase tracking-wider text-slate-800 dark:text-slate-200">
              Hospital Driver Personnel Roster
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {rosterDrivers.map((drv) => (
                <div key={drv.id} className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sm text-slate-900 dark:text-white">{drv.name}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      drv.ambulance?.verificationStatus === 'APPROVED' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'
                    }`}>
                      {drv.ambulance?.verificationStatus || 'PENDING'}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 space-y-1 font-mono">
                    <div>Email: {drv.email}</div>
                    <div>Phone: {drv.phone || 'N/A'}</div>
                    <div>Vehicle: {drv.ambulance?.vehicleNumber || 'Unassigned'}</div>
                  </div>
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-900 flex gap-2">
                    <button
                      onClick={() => handleVerifyDriver(drv.id, 'APPROVED')}
                      className="flex-1 py-1.5 bg-emerald-600 text-white rounded-lg text-2xs font-bold hover:bg-emerald-500 cursor-pointer"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => handleToggleDriverStatus(drv.id, drv.isActive)}
                      className="flex-1 py-1.5 bg-slate-100 dark:bg-slate-900 text-slate-700 dark:text-slate-300 rounded-lg text-2xs font-bold hover:bg-slate-200 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      {drv.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </main>

      {/* ============================================================
          MODAL: ADMIT PATIENT TO BED
          ============================================================ */}
      {showAdmitModal && selectedBedForAdmit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 max-w-md w-full p-6 rounded-3xl shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bed className="w-5 h-5 text-emerald-500" />
                <h4 className="text-sm font-black text-slate-900 dark:text-white">
                  Admit Patient to {selectedBedForAdmit.bedNumber}
                </h4>
              </div>
              <button onClick={() => setShowAdmitModal(false)} className="text-slate-400 hover:text-slate-200 text-sm">✕</button>
            </div>

            <form onSubmit={handleAdmitPatientToBed} className="space-y-3.5">
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Patient Full Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. John Doe"
                  value={admitPatientName}
                  onChange={(e) => setAdmitPatientName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Attending Physician</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Dr. Sarah Connor"
                  value={admitDoctorName}
                  onChange={(e) => setAdmitDoctorName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Admission Diagnosis & Clinical Notes</label>
                <textarea
                  rows={2}
                  placeholder="e.g. Admitted with acute respiratory failure..."
                  value={admitNotes}
                  onChange={(e) => setAdmitNotes(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs focus:outline-none"
                />
              </div>

              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowAdmitModal(false)}
                  className="flex-1 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={admittingLoading}
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
                >
                  {admittingLoading ? 'Admitting...' : 'Confirm Admission'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================
          MODAL: ADD NEW BED
          ============================================================ */}
      {showAddBedModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 max-w-md w-full p-6 rounded-3xl shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Plus className="w-5 h-5 text-emerald-500" />
                <h4 className="text-sm font-black text-slate-900 dark:text-white">Register Clinical Bed</h4>
              </div>
              <button onClick={() => setShowAddBedModal(false)} className="text-slate-400 hover:text-slate-200 text-sm">✕</button>
            </div>

            <form onSubmit={handleCreateBed} className="space-y-3.5">
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Bed / Bay Identifier</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. ICU-05 or GW-109"
                  value={newBedNumber}
                  onChange={(e) => setNewBedNumber(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Ward Department</label>
                <select
                  value={newBedWard}
                  onChange={(e) => setNewBedWard(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs focus:outline-none"
                >
                  <option value="ICU">Intensive Care Unit (ICU)</option>
                  <option value="EMERGENCY_ER">Emergency ER Resuscitation</option>
                  <option value="TRAUMA">Trauma Bay</option>
                  <option value="GENERAL_WARD">General Inpatient Ward</option>
                  <option value="PEDIATRIC">Pediatric Ward</option>
                  <option value="SURGICAL">Surgical Post-Op</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Bed Category / Specialty</label>
                <select
                  value={newBedCategory}
                  onChange={(e) => setNewBedCategory(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs focus:outline-none"
                >
                  <option value="EMERGENCY">Emergency / Trauma</option>
                  <option value="ICU">ICU Critical Care</option>
                  <option value="GENERAL">General Inpatient</option>
                  <option value="PEDIATRIC">Pediatric Ward</option>
                  <option value="SURGICAL">Surgical Post-Op</option>
                  <option value="NEONATAL">Neonatal Intensive Care (NICU)</option>
                  <option value="BURN_UNIT">Burn Unit Care</option>
                  <option value="CARDIAC">Cardiac Telemetry</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Equipment Notes</label>
                <input
                  type="text"
                  placeholder="e.g. Mechanical ventilator & invasive monitor equipped"
                  value={newBedNotes}
                  onChange={(e) => setNewBedNotes(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs focus:outline-none"
                />
              </div>

              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddBedModal(false)}
                  className="flex-1 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addingBedLoading}
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
                >
                  {addingBedLoading ? 'Adding...' : 'Add Bed to Floor'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================
          MODAL: CAPACITY & QUOTA CONFIGURATION (Requirement 2, 4, 5, 9)
          ============================================================ */}
      {showCapacityModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 max-w-lg w-full p-6 rounded-3xl shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sliders className="w-5 h-5 text-blue-500" />
                <h4 className="text-sm font-black text-slate-900 dark:text-white">
                  Hospital Capacity & Quotas Management
                </h4>
              </div>
              <button onClick={() => setShowCapacityModal(false)} className="text-slate-400 hover:text-slate-200 text-sm">✕</button>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400">
              Configure baseline total beds and available capacity. Changes are atomically validated and permanently recorded in the immutable clinical audit log.
            </p>

            <form onSubmit={handleUpdateCapacity} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Total Configured Beds</label>
                  <input
                    type="number"
                    min={0}
                    required
                    value={capacityTotalBeds}
                    onChange={(e) => setCapacityTotalBeds(parseInt(e.target.value, 10) || 0)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-bold focus:outline-none"
                  />
                  <span className="text-[10px] text-slate-400 block mt-1">Currently occupied: {bedStats.occupied} beds</span>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Available Ready Beds</label>
                  <input
                    type="number"
                    min={0}
                    max={capacityTotalBeds}
                    required
                    value={capacityAvailBeds}
                    onChange={(e) => setCapacityAvailBeds(parseInt(e.target.value, 10) || 0)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-bold focus:outline-none"
                  />
                  <span className="text-[10px] text-slate-400 block mt-1">Max: {capacityTotalBeds} beds</span>
                </div>
              </div>

              {capacityAvailBeds > capacityTotalBeds && (
                <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-600 dark:text-rose-400 font-semibold flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>Validation Error: Available beds cannot exceed total configured beds.</span>
                </div>
              )}

              {capacityTotalBeds < bedStats.occupied && (
                <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-600 dark:text-rose-400 font-semibold flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>Validation Error: Total beds cannot be less than currently admitted patients ({bedStats.occupied}).</span>
                </div>
              )}

              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Reason for Capacity Adjustment (Audit Trail)</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Ward 4 expansion commissioned / seasonal surge allocation"
                  value={capacityReason}
                  onChange={(e) => setCapacityReason(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs focus:outline-none"
                />
              </div>

              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowCapacityModal(false)}
                  className="flex-1 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={updatingCapacity || capacityAvailBeds > capacityTotalBeds || capacityTotalBeds < bedStats.occupied}
                  className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
                >
                  {updatingCapacity ? 'Saving...' : 'Update & Record Audit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================
          MODAL: CAPACITY & AVAILABILITY AUDIT TRAIL (Requirement 5, 6, 10)
          ============================================================ */}
      {showAuditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 max-w-4xl w-full p-6 rounded-3xl shadow-2xl space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <History className="w-5 h-5 text-purple-500" />
                <div>
                  <h4 className="text-sm font-black text-slate-900 dark:text-white">
                    Clinical Capacity & Bed Availability Audit Trail
                  </h4>
                  <span className="text-[11px] text-slate-400">
                    Cryptographically authenticated log of all capacity modifications and bed allocations
                  </span>
                </div>
              </div>
              <button onClick={() => setShowAuditModal(false)} className="text-slate-400 hover:text-slate-200 text-sm">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {loadingAuditLogs ? (
                <div className="py-12 flex justify-center">
                  <HeartbeatLoader />
                </div>
              ) : capacityAuditLogs.length === 0 ? (
                <div className="py-12 text-center text-slate-400 text-xs">
                  No capacity changes recorded yet in the audit log for this facility.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-[10px] font-mono text-slate-400 uppercase">
                        <th className="py-2.5 px-3">Timestamp</th>
                        <th className="py-2.5 px-3">Operator</th>
                        <th className="py-2.5 px-3">Action</th>
                        <th className="py-2.5 px-3">Category</th>
                        <th className="py-2.5 px-3">Available Bed Delta</th>
                        <th className="py-2.5 px-3">Total Bed Delta</th>
                        <th className="py-2.5 px-3">Reason / Clinical Notes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                      {capacityAuditLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                          <td className="py-2.5 px-3 font-mono text-[11px] text-slate-500">
                            {new Date(log.timestamp).toLocaleString([], {
                              month: 'short',
                              day: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </td>
                          <td className="py-2.5 px-3">
                            <span className="font-bold text-slate-800 dark:text-slate-200 block truncate max-w-[120px]">
                              {log.changedByName}
                            </span>
                            <span className="text-[9px] font-mono text-slate-400 uppercase block">
                              {log.changedByRole}
                            </span>
                          </td>
                          <td className="py-2.5 px-3">
                            <span className="px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase font-mono bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
                              {log.action}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 font-mono text-[10px] text-slate-500">
                            {log.category || 'ALL'}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-[11px]">
                            <span className="text-slate-400">{log.previousAvailable}</span>
                            <span className="text-slate-400 mx-1">→</span>
                            <span className="font-bold text-emerald-600 dark:text-emerald-400">{log.newAvailable}</span>
                          </td>
                          <td className="py-2.5 px-3 font-mono text-[11px]">
                            <span className="text-slate-400">{log.previousTotal}</span>
                            <span className="text-slate-400 mx-1">→</span>
                            <span className="font-bold text-blue-600 dark:text-blue-400">{log.newTotal}</span>
                          </td>
                          <td className="py-2.5 px-3 text-[11px] text-slate-600 dark:text-slate-300 max-w-[200px] truncate" title={log.reason}>
                            {log.reason || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex justify-end">
              <button
                onClick={() => setShowAuditModal(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold rounded-xl cursor-pointer"
              >
                Close Audit Trail
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================
          MODAL: NEW BOOKING / WALK-IN ADMISSION
          ============================================================ */}
      {showNewBookingModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 max-w-lg w-full p-6 rounded-3xl shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-emerald-500" />
                <h4 className="text-sm font-black text-slate-900 dark:text-white">
                  New Clinical Admission / Reservation
                </h4>
              </div>
              <button onClick={() => setShowNewBookingModal(false)} className="text-slate-400 hover:text-slate-200 text-sm">✕</button>
            </div>

            <form onSubmit={handleCreateBooking} className="space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Patient Full Name</label>
                  <input
                    type="text"
                    required
                    placeholder="Jane Doe"
                    value={bkPatientName}
                    onChange={(e) => setBkPatientName(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Phone Number</label>
                  <input
                    type="tel"
                    required
                    placeholder="+1 555-0199"
                    value={bkPatientPhone}
                    onChange={(e) => setBkPatientPhone(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Admission Category</label>
                  <select
                    value={bkType}
                    onChange={(e) => setBkType(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs focus:outline-none"
                  >
                    <option value="EMERGENCY_ADMISSION">Emergency Admission</option>
                    <option value="OPD_CONSULTATION">OPD Consultation</option>
                    <option value="BED_RESERVATION">Bed Reservation</option>
                    <option value="SCHEDULED_SURGERY">Scheduled Surgery</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Triage Priority</label>
                  <select
                    value={bkTriage}
                    onChange={(e) => setBkTriage(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs focus:outline-none"
                  >
                    <option value="RED_CRITICAL">Level 1: Red Critical</option>
                    <option value="YELLOW_URGENT">Level 2: Yellow Urgent</option>
                    <option value="GREEN_ROUTINE">Level 3: Green Routine</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Department</label>
                  <select
                    value={bkDepartment}
                    onChange={(e) => setBkDepartment(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs focus:outline-none"
                  >
                    <option value="Emergency & Trauma ER">Emergency & Trauma ER</option>
                    <option value="Cardiology">Cardiology</option>
                    <option value="Trauma & Orthopedics">Trauma & Orthopedics</option>
                    <option value="Neurology">Neurology</option>
                    <option value="Pediatrics">Pediatrics</option>
                    <option value="General Medicine">General Medicine</option>
                    <option value="Pulmonology">Pulmonology</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Attending Doctor</label>
                  <input
                    type="text"
                    placeholder="Dr. Sarah Connor"
                    value={bkDoctor}
                    onChange={(e) => setBkDoctor(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Allocate Bed Immediately (Optional)</label>
                <select
                  value={bkAssignedBedId}
                  onChange={(e) => setBkAssignedBedId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs focus:outline-none"
                >
                  <option value="">Leave Unassigned (Queue for Triage)</option>
                  {bedsList
                    .filter((b) => b.status === 'AVAILABLE')
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.bedNumber} &mdash; {b.ward} (Available)
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Symptoms & Clinical Presentation</label>
                <textarea
                  rows={2}
                  placeholder="e.g. Severe chest pain radiating to jaw, SpO2 91%..."
                  value={bkSymptoms}
                  onChange={(e) => setBkSymptoms(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs focus:outline-none"
                />
              </div>

              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowNewBookingModal(false)}
                  className="flex-1 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingBooking}
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
                >
                  {submittingBooking ? 'Registering...' : 'Register Admission'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================
          MODAL: ASSIGN ER BAY TO INBOUND RIG
          ============================================================ */}
      {assigningBayModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 max-w-md w-full p-6 rounded-3xl shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-rose-500">
                <Truck className="w-5 h-5" />
                <h4 className="text-sm font-black text-slate-900 dark:text-white">
                  Allocate ER Bay for Inbound Ambulance
                </h4>
              </div>
              <button onClick={() => setAssigningBayModal(null)} className="text-slate-400 hover:text-slate-200 text-sm">✕</button>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Patient: <strong className="text-slate-800 dark:text-slate-200">{assigningBayModal.patient?.name || 'Incoming Trauma'}</strong> · Driver: {assigningBayModal.driver?.name || 'In-transit'}
            </p>

            <form onSubmit={handleAssignBaySubmit} className="space-y-3.5">
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Select Resuscitation Bay / Bed</label>
                <select
                  value={selectedBayToAssign}
                  onChange={(e) => setSelectedBayToAssign(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs focus:outline-none"
                >
                  <option value="ER Trauma Bay 1">ER Trauma Bay 1 (Rapid Infuser Ready)</option>
                  <option value="ER Trauma Bay 2">ER Trauma Bay 2 (Resuscitation Bay)</option>
                  <option value="ICU Bay A">ICU Bay A (Mechanical Ventilator)</option>
                  <option value="Cath Lab Bay 1">Cath Lab Bay 1 (STEMI Protocol)</option>
                  {bedsList
                    .filter((b) => b.status === 'AVAILABLE')
                    .map((b) => (
                      <option key={b.id} value={b.bedNumber}>
                        {b.bedNumber} &mdash; {b.ward}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Receiving Trauma Physician</label>
                <input
                  type="text"
                  required
                  value={selectedDoctorForBay}
                  onChange={(e) => setSelectedDoctorForBay(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs focus:outline-none"
                />
              </div>

              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setAssigningBayModal(null)}
                  className="flex-1 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingBayAssignment}
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
                >
                  {savingBayAssignment ? 'Alerting Driver...' : 'Confirm & Notify Driver'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Accessible Confirmation Modal for Patient Discharge & Bed Terminal Sanitation */}
      <ConfirmationModal
        isOpen={!!dischargeModalBed}
        title="Discharge Patient & Begin Terminal Sanitation"
        description={`Are you sure you want to discharge ${dischargeModalBed?.patientName || 'the patient'} from Bed ${dischargeModalBed?.bedNumber}? This bed will automatically transition to Housekeeping for Terminal Disinfection.`}
        confirmLabel="Confirm Discharge"
        cancelLabel="Cancel"
        isDestructive={true}
        loading={dischargingLoading}
        onConfirm={executeDischargePatient}
        onCancel={() => setDischargeModalBed(null)}
      />

    </div>
  );
};

export default HospitalDashboard;
