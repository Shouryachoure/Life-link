import React, { useState, useEffect } from 'react';
import {
  Stethoscope,
  Clock,
  Plus,
  Calendar,
  User,
  Phone,
  CheckCircle2,
  AlertCircle,
  Trash2,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  X,
  Ticket,
  Filter,
  Check,
  AlertTriangle,
  Lock,
  Unlock,
  History,
  CalendarX,
  Sliders,
} from 'lucide-react';
import { MEDICAL_SPECIALIZATIONS } from '../../constants/specializations';
import { formatINR, formatIndianPhone } from '../../utils/localization';

interface DoctorAppointmentsSectionProps {
  apiFetch: (url: string, options?: any) => Promise<any>;
  hospitalName?: string;
}

export const DoctorAppointmentsSection: React.FC<DoctorAppointmentsSectionProps> = ({
  apiFetch,
  hospitalName,
}) => {
  // Active sub-tab
  const [subTab, setSubTab] = useState<'SLOTS_ROSTER' | 'DOCTORS_MANAGEMENT'>('SLOTS_ROSTER');

  // Doctors State
  const [doctors, setDoctors] = useState<any[]>([]);
  const [loadingDoctors, setLoadingDoctors] = useState(false);
  const [showAddDoctorModal, setShowAddDoctorModal] = useState(false);
  const [docName, setDocName] = useState('');
  const [docSpecialization, setDocSpecialization] = useState<string>(MEDICAL_SPECIALIZATIONS[0]);
  const [docQualifications, setDocQualifications] = useState('');
  const [docExperience, setDocExperience] = useState('5');
  const [docFee, setDocFee] = useState('500');
  const [docDefaultSlotDuration, setDocDefaultSlotDuration] = useState('15');
  const [addingDoctor, setAddingDoctor] = useState(false);
  const [doctorActionMsg, setDoctorActionMsg] = useState('');

  // Daily Slots Roster State
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [selectedDoctorFilter, setSelectedDoctorFilter] = useState<string>('ALL');
  const [slotsRoster, setSlotsRoster] = useState<any[]>([]);
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [expandedSlotId, setExpandedSlotId] = useState<string | null>(null);

  // Add Single Slot Modal State
  const [showAddSlotModal, setShowAddSlotModal] = useState(false);
  const [slotDoctorId, setSlotDoctorId] = useState('');
  const [slotDate, setSlotDate] = useState(new Date().toISOString().split('T')[0]);
  const [slotStartTime, setSlotStartTime] = useState('09:00');
  const [slotEndTime, setSlotEndTime] = useState('10:00');
  const [slotMaxPatients, setSlotMaxPatients] = useState('5');
  const [slotDurationMinutes, setSlotDurationMinutes] = useState('15');
  const [addingSlot, setAddingSlot] = useState(false);
  const [slotError, setSlotError] = useState('');

  // Batch Schedule Generator State
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchDoctorId, setBatchDoctorId] = useState('');
  const [batchStartDate, setBatchStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [batchEndDate, setBatchEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [batchStartTime, setBatchStartTime] = useState('09:00');
  const [batchEndTime, setBatchEndTime] = useState('17:00');
  const [batchSlotDuration, setBatchSlotDuration] = useState('15');
  const [batchMaxPatients, setBatchMaxPatients] = useState('5');
  const [generatingSchedule, setGeneratingSchedule] = useState(false);
  const [batchMessage, setBatchMessage] = useState('');

  // Doctor Leave / Unavailable Dates Management
  const [leaveModalDoctor, setLeaveModalDoctor] = useState<any | null>(null);
  const [newLeaveDate, setNewLeaveDate] = useState(new Date().toISOString().split('T')[0]);
  const [savingLeave, setSavingLeave] = useState(false);

  // Slot Blocking State
  const [blockingSlot, setBlockingSlot] = useState<any | null>(null);
  const [blockReasonInput, setBlockReasonInput] = useState('');
  const [savingBlock, setSavingBlock] = useState(false);

  // Audit Trail Viewer Modal State
  const [auditModalAppointmentId, setAuditModalAppointmentId] = useState<string | null>(null);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);

  // Status updating
  const [updatingAptId, setUpdatingAptId] = useState<string | null>(null);

  useEffect(() => {
    fetchDoctors();
  }, []);

  useEffect(() => {
    fetchSlotsRoster();
  }, [selectedDate, selectedDoctorFilter]);

  // Fetch Doctors for this Hospital
  const fetchDoctors = async () => {
    setLoadingDoctors(true);
    try {
      const data = await apiFetch('/doctors');
      setDoctors(data);
      if (data.length > 0) {
        if (!slotDoctorId) setSlotDoctorId(data[0].id);
        if (!batchDoctorId) setBatchDoctorId(data[0].id);
      }
    } catch (err) {
      console.error('Failed to load doctors:', err);
    } finally {
      setLoadingDoctors(false);
    }
  };

  // Fetch Day's Slots Roster
  const fetchSlotsRoster = async () => {
    setLoadingRoster(true);
    try {
      let url = `/doctors/hospital/slots?date=${selectedDate}`;
      if (selectedDoctorFilter !== 'ALL') {
        url += `&doctorId=${selectedDoctorFilter}`;
      }
      const data = await apiFetch(url);
      setSlotsRoster(data.slots || []);
    } catch (err) {
      console.error('Failed to load slots roster:', err);
    } finally {
      setLoadingRoster(false);
    }
  };

  // Create Doctor
  const handleCreateDoctor = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddingDoctor(true);
    setDoctorActionMsg('');

    try {
      await apiFetch('/doctors', {
        method: 'POST',
        body: JSON.stringify({
          name: docName.trim(),
          specialization: docSpecialization,
          qualifications: docQualifications.trim() || undefined,
          experienceYears: parseInt(docExperience) || 0,
          consultationFee: parseFloat(docFee) || 0,
          defaultSlotDuration: parseInt(docDefaultSlotDuration) || 15,
        }),
      });

      setShowAddDoctorModal(false);
      setDocName('');
      setDocQualifications('');
      setDoctorActionMsg('Doctor added successfully.');
      fetchDoctors();
    } catch (err: any) {
      alert(err.message || 'Failed to create doctor');
    } finally {
      setAddingDoctor(false);
    }
  };

  // Toggle Doctor Active Status
  const handleToggleDoctorActive = async (doctor: any) => {
    try {
      await apiFetch(`/doctors/${doctor.id}`, {
        method: 'PUT',
        body: JSON.stringify({ isActive: !doctor.isActive }),
      });
      fetchDoctors();
    } catch (err: any) {
      alert(err.message || 'Failed to update doctor status');
    }
  };

  // Create Single Slot
  const handleCreateSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!slotDoctorId) return;

    setAddingSlot(true);
    setSlotError('');

    try {
      await apiFetch(`/doctors/${slotDoctorId}/slots`, {
        method: 'POST',
        body: JSON.stringify({
          date: slotDate,
          startTime: slotStartTime,
          endTime: slotEndTime,
          maxPatients: parseInt(slotMaxPatients) || 5,
          slotDurationMinutes: parseInt(slotDurationMinutes) || 15,
        }),
      });

      setShowAddSlotModal(false);
      fetchSlotsRoster();
    } catch (err: any) {
      setSlotError(err.message || 'Failed to create slot');
    } finally {
      setAddingSlot(false);
    }
  };

  // Batch Generate Schedule
  const handleBatchGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!batchDoctorId) return;

    setGeneratingSchedule(true);
    setBatchMessage('');

    try {
      const res = await apiFetch(`/doctors/${batchDoctorId}/schedule`, {
        method: 'POST',
        body: JSON.stringify({
          startDate: batchStartDate,
          endDate: batchEndDate,
          startTime: batchStartTime,
          endTime: batchEndTime,
          slotDurationMinutes: parseInt(batchSlotDuration) || 15,
          maxPatients: parseInt(batchMaxPatients) || 5,
        }),
      });

      setBatchMessage(`Generated ${res.slotsCreated} slots successfully! (Skipped ${res.slotsSkipped} duplicates/leaves)`);
      setTimeout(() => {
        setShowBatchModal(false);
        setBatchMessage('');
        fetchSlotsRoster();
      }, 1500);
    } catch (err: any) {
      alert(err.message || 'Failed to batch generate schedule');
    } finally {
      setGeneratingSchedule(false);
    }
  };

  // Toggle Slot Block/Unblock
  const handleToggleBlockSlot = async () => {
    if (!blockingSlot) return;
    setSavingBlock(true);
    const newBlockedState = !blockingSlot.isBlocked;

    try {
      await apiFetch(`/doctors/slots/${blockingSlot.id}/block`, {
        method: 'PUT',
        body: JSON.stringify({
          isBlocked: newBlockedState,
          reason: newBlockedState ? (blockReasonInput.trim() || 'Blocked by hospital administration') : undefined,
        }),
      });

      setBlockingSlot(null);
      setBlockReasonInput('');
      fetchSlotsRoster();
    } catch (err: any) {
      alert(err.message || 'Failed to update slot blocking state');
    } finally {
      setSavingBlock(false);
    }
  };

  // Manage Doctor Unavailable Dates
  const handleAddUnavailableDate = async () => {
    if (!leaveModalDoctor || !newLeaveDate) return;
    setSavingLeave(true);
    const currentDates: string[] = leaveModalDoctor.unavailableDates || [];
    if (currentDates.includes(newLeaveDate)) {
      alert('This date is already marked as unavailable.');
      setSavingLeave(false);
      return;
    }

    const updated = [...currentDates, newLeaveDate].sort();
    try {
      await apiFetch(`/doctors/${leaveModalDoctor.id}/unavailable-dates`, {
        method: 'PUT',
        body: JSON.stringify({ unavailableDates: updated }),
      });

      setLeaveModalDoctor({ ...leaveModalDoctor, unavailableDates: updated });
      fetchDoctors();
      fetchSlotsRoster();
    } catch (err: any) {
      alert(err.message || 'Failed to update doctor leaves');
    } finally {
      setSavingLeave(false);
    }
  };

  const handleRemoveUnavailableDate = async (dateToRemove: string) => {
    if (!leaveModalDoctor) return;
    setSavingLeave(true);
    const updated = (leaveModalDoctor.unavailableDates || []).filter((d: string) => d !== dateToRemove);

    try {
      await apiFetch(`/doctors/${leaveModalDoctor.id}/unavailable-dates`, {
        method: 'PUT',
        body: JSON.stringify({ unavailableDates: updated }),
      });

      setLeaveModalDoctor({ ...leaveModalDoctor, unavailableDates: updated });
      fetchDoctors();
      fetchSlotsRoster();
    } catch (err: any) {
      alert(err.message || 'Failed to remove unavailable date');
    } finally {
      setSavingLeave(false);
    }
  };

  // Delete Slot
  const handleDeleteSlot = async (slotId: string) => {
    if (!confirm('Are you sure you want to delete this time slot?')) return;
    try {
      await apiFetch(`/doctors/slots/${slotId}`, {
        method: 'DELETE',
      });
      fetchSlotsRoster();
    } catch (err: any) {
      alert(err.message || 'Failed to delete slot');
    }
  };

  // Update Appointment Status
  const handleUpdateAppointmentStatus = async (appointmentId: string, status: string, reason?: string) => {
    setUpdatingAptId(appointmentId);
    try {
      if (status === 'CONFIRMED') {
        await apiFetch(`/appointments/${appointmentId}/confirm`, { method: 'PUT' });
      } else if (status === 'CANCELLED') {
        const cancelReason = reason || prompt('Please enter cancellation reason:') || 'Cancelled by hospital staff';
        await apiFetch(`/appointments/${appointmentId}/cancel`, {
          method: 'PUT',
          body: JSON.stringify({ reason: cancelReason }),
        });
      } else {
        await apiFetch(`/appointments/${appointmentId}/status`, {
          method: 'PUT',
          body: JSON.stringify({ status, reason: reason || `Updated to ${status} by hospital staff` }),
        });
      }
      fetchSlotsRoster();
    } catch (err: any) {
      alert(err.message || 'Failed to update appointment');
    } finally {
      setUpdatingAptId(null);
    }
  };

  // View Audit Trail
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
    <div className="space-y-6">
      {/* Sub navigation bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 md:p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
            <Stethoscope className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-black text-slate-900 dark:text-white">
              Doctors & OPD Queue Reliability
            </h3>
            <span className="text-2xs text-slate-500 dark:text-slate-400">
              Manage doctor specialists, configure discrete appointment slots, block unavailable periods, and track live queues
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setSubTab('SLOTS_ROSTER')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              subTab === 'SLOTS_ROSTER'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900'
            }`}
          >
            Day's Slot Roster
          </button>
          <button
            onClick={() => setSubTab('DOCTORS_MANAGEMENT')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              subTab === 'DOCTORS_MANAGEMENT'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900'
            }`}
          >
            Manage Doctors ({doctors.length})
          </button>
        </div>
      </div>

      {/* -------------------------------------------------------------
          SUBTAB 1: SLOTS ROSTER
          ------------------------------------------------------------- */}
      {subTab === 'SLOTS_ROSTER' && (
        <div className="space-y-6">
          {/* Controls Bar: Date, Doctor Filter, + Batch Generate, + Add Slot */}
          <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              {/* Date selector */}
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-emerald-500" />
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="px-3 py-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-200 focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* Doctor filter */}
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-slate-400" />
                <select
                  value={selectedDoctorFilter}
                  onChange={(e) => setSelectedDoctorFilter(e.target.value)}
                  className="px-3 py-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-200 focus:outline-none focus:border-emerald-500"
                >
                  <option value="ALL">All Doctors</option>
                  {doctors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.specialization})
                    </option>
                  ))}
                </select>
              </div>

              <button
                onClick={fetchSlotsRoster}
                className="p-2 rounded-xl text-slate-400 hover:text-emerald-500 hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors cursor-pointer"
                title="Refresh Roster"
              >
                <RefreshCw className={`w-4 h-4 ${loadingRoster ? 'animate-spin' : ''}`} />
              </button>
            </div>

            <div className="flex items-center gap-2.5 flex-wrap">
              {/* Batch Generate Button */}
              <button
                onClick={() => setShowBatchModal(true)}
                className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-850 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <Sliders className="w-3.5 h-3.5 text-emerald-500" />
                <span>Batch Schedule</span>
              </button>

              {/* + Add Slot Button */}
              <button
                onClick={() => setShowAddSlotModal(true)}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-600/20 flex items-center gap-2 shrink-0 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Create Time Slot</span>
              </button>
            </div>
          </div>

          {/* Slots Table */}
          {loadingRoster ? (
            <div className="py-12 text-center text-xs text-slate-400 bg-white dark:bg-slate-950 rounded-3xl border border-slate-200 dark:border-slate-800">
              Loading appointment slots & capacity...
            </div>
          ) : slotsRoster.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400 bg-white dark:bg-slate-950 rounded-3xl border border-slate-200 dark:border-slate-800 space-y-2">
              <p>No appointment slots scheduled for {selectedDate}.</p>
              <div className="flex justify-center gap-3">
                <button
                  onClick={() => setShowAddSlotModal(true)}
                  className="text-emerald-500 font-bold hover:underline cursor-pointer"
                >
                  + Create a slot for today
                </button>
                <span>·</span>
                <button
                  onClick={() => setShowBatchModal(true)}
                  className="text-emerald-500 font-bold hover:underline cursor-pointer"
                >
                  Batch generate weekly slots
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-3xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800 text-[10px] font-black uppercase tracking-wider text-slate-400">
                    <tr>
                      <th className="py-3 px-4">Doctor & Specialization</th>
                      <th className="py-3 px-4">Time Window</th>
                      <th className="py-3 px-4 text-center">Status</th>
                      <th className="py-3 px-4 text-center">Capacity</th>
                      <th className="py-3 px-4 text-center">Booked</th>
                      <th className="py-3 px-4 text-center">Remaining</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-850">
                    {slotsRoster.map((slot) => {
                      const isExpanded = expandedSlotId === slot.id;
                      const hasPatients = slot.patients && slot.patients.length > 0;
                      const isBlocked = slot.isBlocked;

                      return (
                        <React.Fragment key={slot.id}>
                          <tr className={`transition-colors ${isBlocked ? 'bg-amber-500/5' : 'hover:bg-slate-50/70 dark:hover:bg-slate-900/40'}`}>
                            <td className="py-3.5 px-4 font-bold text-slate-900 dark:text-white">
                              <div>
                                <span>{slot.doctorName}</span>
                                <span className="block text-3xs font-semibold text-emerald-600 dark:text-emerald-400">
                                  {slot.specialization}
                                </span>
                              </div>
                            </td>
                            <td className="py-3.5 px-4 font-mono font-semibold text-slate-600 dark:text-slate-300">
                              {slot.startTime} - {slot.endTime}
                            </td>
                            <td className="py-3.5 px-4 text-center">
                              {isBlocked ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] font-black">
                                  <Lock className="w-3 h-3" />
                                  BLOCKED
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-black">
                                  <Check className="w-3 h-3" />
                                  ACTIVE
                                </span>
                              )}
                            </td>
                            <td className="py-3.5 px-4 text-center font-bold">
                              <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                                {slot.capacity}
                              </span>
                            </td>
                            <td className="py-3.5 px-4 text-center font-bold">
                              <span className="px-2 py-0.5 rounded-md bg-rose-500/10 text-rose-600 dark:text-rose-400">
                                {slot.booked}
                              </span>
                            </td>
                            <td className="py-3.5 px-4 text-center font-bold">
                              {isBlocked ? (
                                <span className="text-3xs text-amber-600 dark:text-amber-400 font-semibold">
                                  {slot.blockedReason || 'Blocked'}
                                </span>
                              ) : slot.remaining > 0 ? (
                                <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                                  {slot.remaining} Available
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400">
                                  FULL
                                </span>
                              )}
                            </td>
                            <td className="py-3.5 px-4 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                {/* Block/Unblock toggle */}
                                <button
                                  onClick={() => {
                                    setBlockingSlot(slot);
                                    setBlockReasonInput(slot.blockedReason || '');
                                  }}
                                  className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                                    isBlocked
                                      ? 'text-amber-600 bg-amber-500/10 hover:bg-amber-500/20'
                                      : 'text-slate-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30'
                                  }`}
                                  title={isBlocked ? 'Unblock Slot' : 'Block Slot'}
                                >
                                  {isBlocked ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                                </button>

                                <button
                                  onClick={() => setExpandedSlotId(isExpanded ? null : slot.id)}
                                  className={`px-2.5 py-1 rounded-lg text-2xs font-bold transition-colors flex items-center gap-1 cursor-pointer ${
                                    isExpanded
                                      ? 'bg-emerald-600 text-white'
                                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                                  }`}
                                >
                                  <span>{slot.booked} Patient{slot.booked !== 1 ? 's' : ''}</span>
                                  {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                </button>

                                {slot.booked === 0 && (
                                  <button
                                    onClick={() => handleDeleteSlot(slot.id)}
                                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors cursor-pointer"
                                    title="Delete empty slot"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>

                          {/* Expandable Row Revealing Booked Patient Details & Actions */}
                          {isExpanded && (
                            <tr>
                              <td colSpan={7} className="bg-slate-50/90 dark:bg-slate-900/80 p-4 border-t border-b border-slate-200 dark:border-slate-800">
                                {!hasPatients ? (
                                  <div className="text-center py-4 text-3xs text-slate-400 font-semibold">
                                    No patients booked for this time slot yet.
                                  </div>
                                ) : (
                                  <div className="space-y-3">
                                    <span className="text-2xs font-mono font-extrabold uppercase tracking-wider text-slate-400 block">
                                      Booked Queue ({slot.patients.length} Registered Patients)
                                    </span>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                      {slot.patients.map((pat: any) => (
                                        <div
                                          key={pat.appointmentId}
                                          className="p-3.5 rounded-2xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col justify-between space-y-2.5"
                                        >
                                          <div className="flex items-start justify-between">
                                            <div className="flex items-center gap-2.5">
                                              <span className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-mono font-black text-xs flex items-center justify-center shrink-0">
                                                #{String(pat.tokenNumber).padStart(2, '0')}
                                              </span>
                                              <div>
                                                <h5 className="font-bold text-xs text-slate-900 dark:text-white">
                                                  {pat.patientName}
                                                </h5>
                                                <p className="text-3xs text-slate-400 font-mono">
                                                  {formatIndianPhone(pat.patientPhone)}
                                                </p>
                                              </div>
                                            </div>

                                            <div className="flex items-center gap-1.5">
                                              <span
                                                className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase ${
                                                  pat.status === 'COMPLETED'
                                                    ? 'bg-blue-500/10 text-blue-500'
                                                    : pat.status === 'CANCELLED' || pat.status === 'NO_SHOW'
                                                    ? 'bg-rose-500/10 text-rose-500'
                                                    : pat.status === 'CHECKED_IN' || pat.status === 'IN_CONSULTATION'
                                                    ? 'bg-purple-500/10 text-purple-500'
                                                    : 'bg-emerald-500/10 text-emerald-500'
                                                }`}
                                              >
                                                {pat.status}
                                              </span>

                                              <button
                                                onClick={() => handleViewAuditTrail(pat.appointmentId)}
                                                className="p-1 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                                                title="View Audit Trail"
                                              >
                                                <History className="w-3.5 h-3.5" />
                                              </button>
                                            </div>
                                          </div>

                                          <div className="grid grid-cols-2 gap-2 text-3xs text-slate-500 pt-1 border-t border-slate-100 dark:border-slate-850">
                                            <div>
                                              <span className="text-slate-400">Pass Token:</span>{' '}
                                              <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                                                {pat.tokenString || `#${pat.tokenNumber}`}
                                              </span>
                                            </div>
                                            <div>
                                              <span className="text-slate-400">Blood Group:</span>{' '}
                                              <span className="font-bold text-slate-700 dark:text-slate-300">
                                                {pat.bloodGroup || 'N/A'}
                                              </span>
                                            </div>
                                          </div>

                                          {pat.symptoms && (
                                            <div className="text-3xs text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-900 p-2 rounded-xl">
                                              <span className="font-semibold text-slate-400">Symptoms:</span> "{pat.symptoms}"
                                            </div>
                                          )}

                                          {/* State Transition Actions */}
                                          <div className="flex gap-1.5 pt-1 border-t border-slate-100 dark:border-slate-850 flex-wrap">
                                            {pat.status === 'BOOKED' && (
                                              <button
                                                onClick={() => handleUpdateAppointmentStatus(pat.appointmentId, 'CONFIRMED')}
                                                disabled={updatingAptId === pat.appointmentId}
                                                className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-3xs font-bold transition-colors cursor-pointer"
                                              >
                                                Confirm Booking
                                              </button>
                                            )}

                                            {(pat.status === 'BOOKED' || pat.status === 'CONFIRMED') && (
                                              <button
                                                onClick={() => handleUpdateAppointmentStatus(pat.appointmentId, 'CHECKED_IN')}
                                                disabled={updatingAptId === pat.appointmentId}
                                                className="px-2.5 py-1 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-3xs font-bold transition-colors cursor-pointer"
                                              >
                                                Check In
                                              </button>
                                            )}

                                            {pat.status === 'CHECKED_IN' && (
                                              <button
                                                onClick={() => handleUpdateAppointmentStatus(pat.appointmentId, 'IN_CONSULTATION')}
                                                disabled={updatingAptId === pat.appointmentId}
                                                className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-3xs font-bold transition-colors cursor-pointer"
                                              >
                                                In Consultation
                                              </button>
                                            )}

                                            {(pat.status === 'CHECKED_IN' || pat.status === 'IN_CONSULTATION') && (
                                              <button
                                                onClick={() => handleUpdateAppointmentStatus(pat.appointmentId, 'COMPLETED')}
                                                disabled={updatingAptId === pat.appointmentId}
                                                className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-3xs font-bold transition-colors cursor-pointer"
                                              >
                                                Complete
                                              </button>
                                            )}

                                            {pat.status !== 'COMPLETED' && pat.status !== 'CANCELLED' && pat.status !== 'NO_SHOW' && (
                                              <>
                                                <button
                                                  onClick={() => handleUpdateAppointmentStatus(pat.appointmentId, 'NO_SHOW')}
                                                  disabled={updatingAptId === pat.appointmentId}
                                                  className="px-2 py-1 rounded-lg border border-amber-300 dark:border-amber-900/50 text-amber-600 text-3xs font-bold hover:bg-amber-50 dark:hover:bg-amber-950/20 cursor-pointer"
                                                >
                                                  No-Show
                                                </button>
                                                <button
                                                  onClick={() => handleUpdateAppointmentStatus(pat.appointmentId, 'CANCELLED')}
                                                  disabled={updatingAptId === pat.appointmentId}
                                                  className="px-2 py-1 rounded-lg border border-rose-200 dark:border-rose-900/50 text-rose-500 text-3xs font-bold hover:bg-rose-50 dark:hover:bg-rose-950/20 cursor-pointer"
                                                >
                                                  Cancel
                                                </button>
                                              </>
                                            )}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* -------------------------------------------------------------
          SUBTAB 2: DOCTORS MANAGEMENT
          ------------------------------------------------------------- */}
      {subTab === 'DOCTORS_MANAGEMENT' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider">
              Hospital Doctors Directory ({doctors.length} Registered)
            </h4>
            <button
              onClick={() => setShowAddDoctorModal(true)}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-600/20 flex items-center gap-2 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Add New Doctor</span>
            </button>
          </div>

          {loadingDoctors ? (
            <div className="py-12 text-center text-xs text-slate-400 bg-white dark:bg-slate-950 rounded-3xl border border-slate-200 dark:border-slate-800">
              Loading doctors directory...
            </div>
          ) : doctors.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400 bg-white dark:bg-slate-950 rounded-3xl border border-slate-200 dark:border-slate-800 space-y-2">
              <p>No doctors currently registered for this medical center.</p>
              <button
                onClick={() => setShowAddDoctorModal(true)}
                className="text-emerald-500 font-bold hover:underline cursor-pointer"
              >
                + Register your first doctor specialist
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {doctors.map((doc) => (
                <div
                  key={doc.id}
                  className={`p-5 rounded-3xl border transition-all flex flex-col justify-between space-y-4 ${
                    doc.isActive
                      ? 'bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800'
                      : 'bg-slate-50/50 dark:bg-slate-900/30 border-slate-200 dark:border-slate-850 opacity-60'
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h5 className="font-bold text-sm text-slate-900 dark:text-white">
                          {doc.name}
                        </h5>
                        <span className="inline-block mt-0.5 px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-extrabold">
                          {doc.specialization}
                        </span>
                      </div>
                      <span className="text-xs font-black text-slate-800 dark:text-slate-200 font-mono">
                        {formatINR(Number(doc.consultationFee) || 0)}
                      </span>
                    </div>

                    {doc.qualifications && (
                      <p className="text-3xs text-slate-500 dark:text-slate-400">
                        {doc.qualifications} · {doc.experienceYears || 0} yrs exp
                      </p>
                    )}

                    {doc.unavailableDates && doc.unavailableDates.length > 0 && (
                      <div className="pt-1">
                        <span className="text-4xs font-mono uppercase text-amber-500 font-bold block mb-1">
                          Upcoming Leaves:
                        </span>
                        <div className="flex flex-wrap gap-1">
                          {doc.unavailableDates.map((dateStr: string) => (
                            <span
                              key={dateStr}
                              className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 text-3xs font-mono font-bold"
                            >
                              {dateStr}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="pt-3 border-t border-slate-100 dark:border-slate-850 flex items-center justify-between gap-2">
                    <button
                      onClick={() => setLeaveModalDoctor(doc)}
                      className="px-2.5 py-1 rounded-lg border border-amber-300 dark:border-amber-900/50 text-amber-600 text-3xs font-bold hover:bg-amber-50 dark:hover:bg-amber-950/20 transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <CalendarX className="w-3 h-3" />
                      <span>Leaves</span>
                    </button>

                    <button
                      onClick={() => handleToggleDoctorActive(doc)}
                      className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-800 text-3xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-900 transition-colors cursor-pointer"
                    >
                      {doc.isActive ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* -------------------------------------------------------------
          MODAL: Add Doctor
          ------------------------------------------------------------- */}
      {showAddDoctorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 md:p-8 max-w-lg w-full shadow-2xl space-y-6">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-black text-slate-900 dark:text-white">
                  Add Doctor Specialist
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Register a medical specialist to your hospital roster
                </p>
              </div>
              <button
                onClick={() => setShowAddDoctorModal(false)}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-900"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateDoctor} className="space-y-4">
              <div>
                <label className="block text-2xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Doctor Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Dr. Robert Chen, MD"
                  value={docName}
                  onChange={(e) => setDocName(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-2xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Medical Specialization *
                </label>
                <select
                  value={docSpecialization}
                  onChange={(e) => setDocSpecialization(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-200 focus:outline-none focus:border-emerald-500"
                >
                  {MEDICAL_SPECIALIZATIONS.map((spec) => (
                    <option key={spec} value={spec}>
                      {spec}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-2xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Qualifications & Certifications
                </label>
                <input
                  type="text"
                  placeholder="e.g. MBBS, MD (Cardiology), FACC"
                  value={docQualifications}
                  onChange={(e) => setDocQualifications(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-2xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                    Experience (Yrs)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="60"
                    value={docExperience}
                    onChange={(e) => setDocExperience(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-2xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                    Fee (₹)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={docFee}
                    onChange={(e) => setDocFee(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-2xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                    Slot Duration
                  </label>
                  <select
                    value={docDefaultSlotDuration}
                    onChange={(e) => setDocDefaultSlotDuration(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-200 focus:outline-none focus:border-emerald-500"
                  >
                    <option value="15">15 min</option>
                    <option value="20">20 min</option>
                    <option value="30">30 min</option>
                    <option value="45">45 min</option>
                    <option value="60">60 min</option>
                  </select>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddDoctorModal(false)}
                  className="flex-1 py-3 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addingDoctor}
                  className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs font-black shadow-md shadow-emerald-600/20 transition-all cursor-pointer"
                >
                  {addingDoctor ? 'Registering...' : 'Add Doctor'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------
          MODAL: Create Single Time Slot
          ------------------------------------------------------------- */}
      {showAddSlotModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 md:p-8 max-w-lg w-full shadow-2xl space-y-6">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-black text-slate-900 dark:text-white">
                  Create Consultation Slot
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Configure hourly capacity and availability window
                </p>
              </div>
              <button
                onClick={() => setShowAddSlotModal(false)}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-900"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {slotError && (
              <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-500 text-xs font-semibold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{slotError}</span>
              </div>
            )}

            <form onSubmit={handleCreateSlot} className="space-y-4">
              <div>
                <label className="block text-2xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Assign Doctor Specialist *
                </label>
                <select
                  value={slotDoctorId}
                  onChange={(e) => setSlotDoctorId(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-200 focus:outline-none focus:border-emerald-500"
                >
                  {doctors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.specialization})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-2xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Date (YYYY-MM-DD) *
                </label>
                <input
                  type="date"
                  required
                  value={slotDate}
                  min={new Date().toISOString().split('T')[0]}
                  onChange={(e) => setSlotDate(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-2xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                    Start Time *
                  </label>
                  <input
                    type="time"
                    required
                    value={slotStartTime}
                    onChange={(e) => setSlotStartTime(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-2xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                    End Time *
                  </label>
                  <input
                    type="time"
                    required
                    value={slotEndTime}
                    onChange={(e) => setSlotEndTime(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-2xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                    Max Patients Cap *
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    required
                    value={slotMaxPatients}
                    onChange={(e) => setSlotMaxPatients(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-2xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                    Duration (Minutes)
                  </label>
                  <select
                    value={slotDurationMinutes}
                    onChange={(e) => setSlotDurationMinutes(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-200 focus:outline-none focus:border-emerald-500"
                  >
                    <option value="15">15 min</option>
                    <option value="20">20 min</option>
                    <option value="30">30 min</option>
                    <option value="45">45 min</option>
                    <option value="60">60 min</option>
                  </select>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddSlotModal(false)}
                  className="flex-1 py-3 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addingSlot}
                  className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs font-black shadow-md shadow-emerald-600/20 transition-all cursor-pointer"
                >
                  {addingSlot ? 'Creating...' : 'Create Slot'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------
          MODAL: Batch Generate Schedule
          ------------------------------------------------------------- */}
      {showBatchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 md:p-8 max-w-lg w-full shadow-2xl space-y-6">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-black text-slate-900 dark:text-white">
                  Batch Generate Doctor Schedule
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Generate uniform discrete consultation slots across multiple days
                </p>
              </div>
              <button
                onClick={() => setShowBatchModal(false)}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-900"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {batchMessage && (
              <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-semibold flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{batchMessage}</span>
              </div>
            )}

            <form onSubmit={handleBatchGenerate} className="space-y-4">
              <div>
                <label className="block text-2xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Doctor Specialist *
                </label>
                <select
                  value={batchDoctorId}
                  onChange={(e) => setBatchDoctorId(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-200 focus:outline-none focus:border-emerald-500"
                >
                  {doctors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.specialization})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-2xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                    Start Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={batchStartDate}
                    min={new Date().toISOString().split('T')[0]}
                    onChange={(e) => setBatchStartDate(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-2xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                    End Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={batchEndDate}
                    min={batchStartDate}
                    onChange={(e) => setBatchEndDate(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-2xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                    Daily Shift Start *
                  </label>
                  <input
                    type="time"
                    required
                    value={batchStartTime}
                    onChange={(e) => setBatchStartTime(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-2xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                    Daily Shift End *
                  </label>
                  <input
                    type="time"
                    required
                    value={batchEndTime}
                    onChange={(e) => setBatchEndTime(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-2xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                    Slot Duration (Minutes)
                  </label>
                  <select
                    value={batchSlotDuration}
                    onChange={(e) => setBatchSlotDuration(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-200 focus:outline-none focus:border-emerald-500"
                  >
                    <option value="15">15 min</option>
                    <option value="20">20 min</option>
                    <option value="30">30 min</option>
                    <option value="45">45 min</option>
                    <option value="60">60 min</option>
                  </select>
                </div>
                <div>
                  <label className="block text-2xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                    Max Patients per Slot
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    required
                    value={batchMaxPatients}
                    onChange={(e) => setBatchMaxPatients(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowBatchModal(false)}
                  className="flex-1 py-3 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={generatingSchedule}
                  className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs font-black shadow-md shadow-emerald-600/20 transition-all cursor-pointer"
                >
                  {generatingSchedule ? 'Generating Slots...' : 'Generate Slots'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------
          MODAL: Doctor Unavailable Dates / Leaves
          ------------------------------------------------------------- */}
      {leaveModalDoctor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 md:p-8 max-w-md w-full shadow-2xl space-y-6">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-black text-slate-900 dark:text-white">
                  Manage Doctor Leaves
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {leaveModalDoctor.name} ({leaveModalDoctor.specialization})
                </p>
              </div>
              <button
                onClick={() => setLeaveModalDoctor(null)}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-900"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-2xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Add Leave / Unavailable Date (YYYY-MM-DD)
                </label>
                <div className="flex gap-2">
                  <input
                    type="date"
                    value={newLeaveDate}
                    min={new Date().toISOString().split('T')[0]}
                    onChange={(e) => setNewLeaveDate(e.target.value)}
                    className="flex-1 px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-emerald-500"
                  />
                  <button
                    onClick={handleAddUnavailableDate}
                    disabled={savingLeave}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold cursor-pointer"
                  >
                    Add
                  </button>
                </div>
              </div>

              <div>
                <span className="block text-2xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                  Scheduled Leave Dates ({leaveModalDoctor.unavailableDates?.length || 0})
                </span>
                {(!leaveModalDoctor.unavailableDates || leaveModalDoctor.unavailableDates.length === 0) ? (
                  <p className="text-xs text-slate-400 italic">No unavailable dates currently scheduled.</p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {leaveModalDoctor.unavailableDates.map((dateStr: string) => (
                      <div
                        key={dateStr}
                        className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-mono"
                      >
                        <span className="font-bold text-slate-800 dark:text-slate-200">{dateStr}</span>
                        <button
                          onClick={() => handleRemoveUnavailableDate(dateStr)}
                          disabled={savingLeave}
                          className="text-rose-500 hover:text-rose-600 p-1 rounded cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <button
              onClick={() => setLeaveModalDoctor(null)}
              className="w-full py-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold transition-colors cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------
          MODAL: Block/Unblock Slot
          ------------------------------------------------------------- */}
      {blockingSlot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 md:p-8 max-w-md w-full shadow-2xl space-y-6">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-black text-slate-900 dark:text-white">
                  {blockingSlot.isBlocked ? 'Unblock Consultation Slot' : 'Block Consultation Slot'}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {blockingSlot.doctorName} · {blockingSlot.date} ({blockingSlot.startTime} - {blockingSlot.endTime})
                </p>
              </div>
              <button
                onClick={() => setBlockingSlot(null)}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-900"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4">
              {!blockingSlot.isBlocked ? (
                <div>
                  <label className="block text-2xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                    Reason for Blocking Slot
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Doctor emergency surgery / Hospital meeting"
                    value={blockReasonInput}
                    onChange={(e) => setBlockReasonInput(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-emerald-500"
                  />
                  <span className="text-3xs text-slate-400 mt-1 block">
                    Patients will be prevented from booking this slot until it is unblocked.
                  </span>
                </div>
              ) : (
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  Unblocking this slot will restore it for patient booking up to its max capacity.
                </p>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setBlockingSlot(null)}
                  className="flex-1 py-3 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleToggleBlockSlot}
                  disabled={savingBlock}
                  className={`flex-1 py-3 text-white rounded-xl text-xs font-black shadow-md transition-all cursor-pointer ${
                    blockingSlot.isBlocked
                      ? 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-600/20'
                      : 'bg-amber-600 hover:bg-amber-500 shadow-amber-600/20'
                  }`}
                >
                  {savingBlock
                    ? 'Updating...'
                    : blockingSlot.isBlocked
                    ? 'Unblock Slot'
                    : 'Block Slot'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------
          MODAL: Audit Trail Viewer
          ------------------------------------------------------------- */}
      {auditModalAppointmentId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 md:p-8 max-w-lg w-full shadow-2xl space-y-6">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                  <History className="w-5 h-5 text-emerald-500" />
                  Appointment Audit Trail
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono">
                  ID: {auditModalAppointmentId}
                </p>
              </div>
              <button
                onClick={() => setAuditModalAppointmentId(null)}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-900"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {loadingAudit ? (
              <div className="py-8 text-center text-xs text-slate-400">Loading audit history...</div>
            ) : auditLogs.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400 bg-slate-50 dark:bg-slate-900 rounded-2xl">
                No audit events recorded for this appointment yet.
              </div>
            ) : (
              <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                {auditLogs.map((log: any) => (
                  <div
                    key={log.id}
                    className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="px-2 py-0.5 rounded text-3xs font-black uppercase bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                        {log.action}
                      </span>
                      <span className="text-3xs text-slate-400 font-mono">
                        {new Date(log.timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                      </span>
                    </div>

                    <div className="text-xs text-slate-800 dark:text-slate-200 font-medium">
                      {log.reason || `Transitioned to ${log.newStatus}`}
                    </div>

                    <div className="text-3xs text-slate-400 flex items-center gap-2">
                      <span>Actor: <strong className="text-slate-600 dark:text-slate-300">{log.actorName || log.actorRole}</strong> ({log.actorRole})</span>
                      {log.previousStatus && (
                        <span>• Status: {log.previousStatus} → {log.newStatus}</span>
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
