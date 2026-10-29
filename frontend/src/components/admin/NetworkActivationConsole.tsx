import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  Building2,
  Truck,
  Users,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Radio,
  FileText,
  Search,
  RefreshCw,
  Plus,
  Play,
  Pause,
  AlertOctagon,
  Check,
  ChevronRight,
  MapPin,
  Calendar,
  Phone,
  Mail,
  Activity,
  Layers,
} from 'lucide-react';

interface NetworkActivationConsoleProps {
  apiFetch: (url: string, options?: RequestInit) => Promise<any>;
}

export const NetworkActivationConsole: React.FC<NetworkActivationConsoleProps> = ({ apiFetch }) => {
  const [activeTab, setActiveTab] = useState<
    'HOSPITAL_ONBOARDING' | 'OPERATOR_ONBOARDING' | 'DRIVER_VERIFICATION' | 'VEHICLE_ASSIGNMENTS' | 'DISPATCH_INSPECTOR' | 'PILOT_SWITCHBOARD'
  >('HOSPITAL_ONBOARDING');

  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<any>(null);

  // Data lists
  const [hospitalApps, setHospitalApps] = useState<any[]>([]);
  const [operatorApps, setOperatorApps] = useState<any[]>([]);
  const [driverApps, setDriverApps] = useState<any[]>([]);
  const [ambulances, setAmbulances] = useState<any[]>([]);
  const [pilotChecklists, setPilotChecklists] = useState<any[]>([]);

  // Action modals & state
  const [reviewingItem, setReviewingItem] = useState<any | null>(null);
  const [reviewDecision, setReviewDecision] = useState<'APPROVED' | 'NEEDS_MORE_INFO' | 'REJECTED' | 'SUSPENDED'>('APPROVED');
  const [reviewerNotes, setReviewerNotes] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Inspector state
  const [inspectAmbulanceId, setInspectAmbulanceId] = useState('');
  const [inspectionResult, setInspectionResult] = useState<any | null>(null);
  const [inspecting, setInspecting] = useState(false);

  // Assignment modal
  const [assigningAmb, setAssigningAmb] = useState<any | null>(null);
  const [selectedDriverId, setSelectedDriverId] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const sumRes = await apiFetch('/onboarding/admin/summary');
      if (sumRes.status === 'success') setSummary(sumRes.summary);

      const hospRes = await apiFetch('/onboarding/admin/hospitals');
      if (hospRes.status === 'success') setHospitalApps(hospRes.applications || []);

      const opRes = await apiFetch('/onboarding/admin/operators');
      if (opRes.status === 'success') setOperatorApps(opRes.applications || []);

      const drvRes = await apiFetch('/onboarding/admin/drivers');
      if (drvRes.status === 'success') setDriverApps(drvRes.applications || []);

      const ambRes = await apiFetch('/ambulances/inventory?limit=50');
      if (ambRes.success || ambRes.fleet) setAmbulances(ambRes.fleet || ambRes.data || []);

      const chkRes = await apiFetch('/onboarding/admin/pilot-checklists');
      if (chkRes.status === 'success') setPilotChecklists(chkRes.checklists || []);
    } catch (err) {
      console.error('Failed to load activation data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [activeTab]);

  const handleReviewSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reviewingItem) return;
    setActionLoading(true);
    setActionMessage(null);

    let endpoint = '';
    if (activeTab === 'HOSPITAL_ONBOARDING') endpoint = `/onboarding/admin/hospitals/${reviewingItem.id}/review`;
    else if (activeTab === 'OPERATOR_ONBOARDING') endpoint = `/onboarding/admin/operators/${reviewingItem.id}/review`;
    else if (activeTab === 'DRIVER_VERIFICATION') endpoint = `/onboarding/admin/drivers/${reviewingItem.id}/review`;

    try {
      const res = await apiFetch(endpoint, {
        method: 'POST',
        body: JSON.stringify({
          decision: reviewDecision,
          reviewerNotes,
          rejectionReason: reviewDecision === 'REJECTED' ? reviewerNotes : undefined,
        }),
      });

      if (res.status === 'success') {
        setActionMessage({ type: 'success', text: `Application successfully marked as ${reviewDecision}.` });
        setTimeout(() => {
          setReviewingItem(null);
          setReviewerNotes('');
          setActionMessage(null);
          loadData();
        }, 1200);
      } else {
        setActionMessage({ type: 'error', text: res.message || 'Operation failed' });
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err?.message || 'Server error' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleRunInspection = async (ambId: string) => {
    if (!ambId) return;
    setInspecting(true);
    try {
      const res = await apiFetch(`/onboarding/admin/dispatch-eligibility/inspect/${ambId}`);
      if (res.status === 'success') {
        setInspectionResult(res.inspection);
      }
    } catch (err) {
      console.error('Inspection failed:', err);
    } finally {
      setInspecting(false);
    }
  };

  const handleActivatePilot = async (orgId: string) => {
    setActionLoading(true);
    try {
      const res = await apiFetch(`/onboarding/admin/pilot-checklists/${orgId}/activate`, {
        method: 'POST',
        body: JSON.stringify({ notes: 'Super-Admin manual activation authorization' }),
      });
      if (res.status === 'success') {
        alert(res.message);
        loadData();
      } else {
        alert(`Pilot activation blocked: ${res.message}\nBlockers: ${(res.blockers || []).join(', ')}`);
      }
    } catch (err: any) {
      alert(`Activation error: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleSuspendPilot = async (orgId: string) => {
    const reason = prompt('Enter mandatory operational reason for temporary suspension:');
    if (!reason) return;
    try {
      const res = await apiFetch(`/onboarding/admin/pilot-checklists/${orgId}/suspend`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      if (res.status === 'success') {
        alert(res.message);
        loadData();
      }
    } catch (err: any) {
      alert(`Suspension error: ${err.message}`);
    }
  };

  const handleAssignDriver = async () => {
    if (!assigningAmb || !selectedDriverId) return;
    setActionLoading(true);
    try {
      const res = await apiFetch(`/ambulances/${assigningAmb.id}/assign-driver`, {
        method: 'POST',
        body: JSON.stringify({ driverUserId: selectedDriverId }),
      });
      if (res.status === 'success') {
        alert('Driver assigned successfully.');
        setAssigningAmb(null);
        setSelectedDriverId('');
        loadData();
      } else {
        alert(`Assignment failed: ${res.message}`);
      }
    } catch (err: any) {
      alert(`Assignment error: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleUnassignDriver = async (ambId: string) => {
    if (!confirm('Are you sure you want to unassign the current driver from this ambulance?')) return;
    try {
      const res = await apiFetch(`/ambulances/${ambId}/unassign-driver`, { method: 'POST' });
      if (res.status === 'success') {
        alert('Driver unassigned.');
        loadData();
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-rose-600/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <span className="p-2.5 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400">
                <ShieldCheck className="w-6 h-6" />
              </span>
              <div>
                <h1 className="text-xl font-bold text-white tracking-tight">Real-World Network Activation Console</h1>
                <p className="text-xs text-slate-400 mt-0.5">
                  Audited onboarding, credential verification, driver assignments & dispatch eligibility gatekeeper
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={loadData}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl border border-slate-700 transition"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Sync Network
            </button>
          </div>
        </div>

        {/* 4 Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
          <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-4">
            <span className="text-3xs font-bold text-slate-400 uppercase tracking-wider block">Hospital Onboarding</span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-black text-rose-400">{summary?.hospital?.pending ?? 0}</span>
              <span className="text-3xs font-medium text-slate-500">pending review</span>
            </div>
          </div>

          <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-4">
            <span className="text-3xs font-bold text-slate-400 uppercase tracking-wider block">Operator Fleets</span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-black text-amber-400">{summary?.operator?.pending ?? 0}</span>
              <span className="text-3xs font-medium text-slate-500">pending review</span>
            </div>
          </div>

          <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-4">
            <span className="text-3xs font-bold text-slate-400 uppercase tracking-wider block">Driver Credentials</span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-black text-blue-400">{summary?.driver?.pending ?? 0}</span>
              <span className="text-3xs font-medium text-slate-500">pending review</span>
            </div>
          </div>

          <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-4">
            <span className="text-3xs font-bold text-slate-400 uppercase tracking-wider block">Pilot Active Orgs</span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-black text-emerald-400">{summary?.pilotActiveCount ?? 0}</span>
              <span className="text-3xs font-medium text-emerald-500">live in Nagpur</span>
            </div>
          </div>
        </div>
      </div>

      {/* Sub-Tab Navigation */}
      <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-2">
        <button
          onClick={() => setActiveTab('HOSPITAL_ONBOARDING')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition ${
            activeTab === 'HOSPITAL_ONBOARDING'
              ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/20'
              : 'bg-slate-900 text-slate-400 hover:bg-slate-800'
          }`}
        >
          <Building2 className="w-4 h-4" />
          Hospital Applications ({hospitalApps.filter((a) => a.status === 'SUBMITTED').length})
        </button>

        <button
          onClick={() => setActiveTab('OPERATOR_ONBOARDING')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition ${
            activeTab === 'OPERATOR_ONBOARDING'
              ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/20'
              : 'bg-slate-900 text-slate-400 hover:bg-slate-800'
          }`}
        >
          <Truck className="w-4 h-4" />
          Operator Applications ({operatorApps.filter((a) => a.status === 'SUBMITTED').length})
        </button>

        <button
          onClick={() => setActiveTab('DRIVER_VERIFICATION')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition ${
            activeTab === 'DRIVER_VERIFICATION'
              ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/20'
              : 'bg-slate-900 text-slate-400 hover:bg-slate-800'
          }`}
        >
          <Users className="w-4 h-4" />
          Driver Verification ({driverApps.filter((a) => a.status === 'SUBMITTED').length})
        </button>

        <button
          onClick={() => setActiveTab('VEHICLE_ASSIGNMENTS')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition ${
            activeTab === 'VEHICLE_ASSIGNMENTS'
              ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/20'
              : 'bg-slate-900 text-slate-400 hover:bg-slate-800'
          }`}
        >
          <Layers className="w-4 h-4" />
          Fleet & Assignments ({ambulances.length})
        </button>

        <button
          onClick={() => setActiveTab('DISPATCH_INSPECTOR')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition ${
            activeTab === 'DISPATCH_INSPECTOR'
              ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/20'
              : 'bg-slate-900 text-slate-400 hover:bg-slate-800'
          }`}
        >
          <Activity className="w-4 h-4" />
          Dispatch Inspector (12-Pt Engine)
        </button>

        <button
          onClick={() => setActiveTab('PILOT_SWITCHBOARD')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition ${
            activeTab === 'PILOT_SWITCHBOARD'
              ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/20'
              : 'bg-slate-900 text-slate-400 hover:bg-slate-800'
          }`}
        >
          <Radio className="w-4 h-4" />
          Nagpur Pilot Switchboard
        </button>
      </div>

      {/* Tab 1: Hospital Applications */}
      {activeTab === 'HOSPITAL_ONBOARDING' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Building2 className="w-4 h-4 text-rose-400" />
              Hospital Onboarding Dossiers
            </h3>
            <span className="text-xs text-slate-400">Total: {hospitalApps.length}</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="text-3xs uppercase bg-slate-950/60 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4">Hospital Name & City</th>
                  <th className="py-3 px-4">Reg Number</th>
                  <th className="py-3 px-4">Contact Person</th>
                  <th className="py-3 px-4">Beds (Total / ICU / ER)</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {hospitalApps.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-500">
                      No hospital onboarding applications submitted yet.
                    </td>
                  </tr>
                ) : (
                  hospitalApps.map((app) => (
                    <tr key={app.id} className="hover:bg-slate-850/50 transition">
                      <td className="py-3 px-4">
                        <span className="font-semibold text-white block">{app.hospitalName}</span>
                        <span className="text-3xs text-slate-500">{app.address}, {app.city}</span>
                      </td>
                      <td className="py-3 px-4 font-mono text-3xs text-slate-400">{app.registrationNumber}</td>
                      <td className="py-3 px-4">
                        <span className="block text-slate-200">{app.contactPersonName}</span>
                        <span className="text-3xs text-slate-500">{app.contactPhone}</span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-bold text-white">{app.bedCapacityTotal}</span>
                        <span className="text-3xs text-slate-500"> ({app.bedCapacityIcu} ICU, {app.bedCapacityEr} ER)</span>
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded-full text-3xs font-extrabold ${
                            app.status === 'APPROVED'
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                              : app.status === 'REJECTED' || app.status === 'SUSPENDED'
                              ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                              : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                          }`}
                        >
                          {app.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={() => {
                            setReviewingItem(app);
                            setReviewDecision('APPROVED');
                            setReviewerNotes(app.reviewerNotes || '');
                          }}
                          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg font-semibold text-3xs border border-slate-700 transition"
                        >
                          Review Dossier
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: Operator Applications */}
      {activeTab === 'OPERATOR_ONBOARDING' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Truck className="w-4 h-4 text-amber-400" />
              Private Ambulance Operator Onboarding Dossiers
            </h3>
            <span className="text-xs text-slate-400">Total: {operatorApps.length}</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="text-3xs uppercase bg-slate-950/60 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4">Operator Name</th>
                  <th className="py-3 px-4">Trade License</th>
                  <th className="py-3 px-4">Contact Person & Phone</th>
                  <th className="py-3 px-4">Operating Area & Fleet</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {operatorApps.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-500">
                      No operator applications submitted yet.
                    </td>
                  </tr>
                ) : (
                  operatorApps.map((app) => (
                    <tr key={app.id} className="hover:bg-slate-850/50 transition">
                      <td className="py-3 px-4 font-semibold text-white">{app.operatorName}</td>
                      <td className="py-3 px-4 font-mono text-3xs text-slate-400">{app.tradeLicense}</td>
                      <td className="py-3 px-4">
                        <span className="block text-slate-200">{app.contactPersonName}</span>
                        <span className="text-3xs text-slate-500">{app.contactPhone}</span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="block text-slate-300">{app.operatingArea}</span>
                        <span className="text-3xs text-slate-500">{app.declaredFleetSize} vehicles</span>
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded-full text-3xs font-extrabold ${
                            app.status === 'APPROVED'
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                              : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                          }`}
                        >
                          {app.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={() => {
                            setReviewingItem(app);
                            setReviewDecision('APPROVED');
                            setReviewerNotes(app.reviewerNotes || '');
                          }}
                          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg font-semibold text-3xs border border-slate-700 transition"
                        >
                          Review Dossier
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: Driver Verification Applications */}
      {activeTab === 'DRIVER_VERIFICATION' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Users className="w-4 h-4 text-blue-400" />
              Driver Credentials & License Audit Queue
            </h3>
            <span className="text-xs text-slate-400">Total: {driverApps.length}</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="text-3xs uppercase bg-slate-950/60 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4">Driver Name & Phone</th>
                  <th className="py-3 px-4">Commercial Driving License</th>
                  <th className="py-3 px-4">License Expiry</th>
                  <th className="py-3 px-4">Organization Type</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {driverApps.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-500">
                      No driver verification applications submitted yet.
                    </td>
                  </tr>
                ) : (
                  driverApps.map((app) => {
                    const isExpired = new Date(app.licenseExpiry).getTime() <= Date.now();
                    return (
                      <tr key={app.id} className="hover:bg-slate-850/50 transition">
                        <td className="py-3 px-4">
                          <span className="font-semibold text-white block">{app.fullName}</span>
                          <span className="text-3xs text-slate-500">{app.phone}</span>
                        </td>
                        <td className="py-3 px-4 font-mono text-3xs text-slate-300">{app.licenseNumber}</td>
                        <td className="py-3 px-4">
                          <span className={`block font-medium ${isExpired ? 'text-rose-400 font-bold' : 'text-slate-300'}`}>
                            {new Date(app.licenseExpiry).toLocaleDateString('en-IN')}
                          </span>
                          {isExpired && (
                            <span className="text-3xs text-rose-500 font-extrabold flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" /> EXPIRED LICENSE
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-3xs font-semibold text-slate-400">{app.organizationType}</td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-2 py-0.5 rounded-full text-3xs font-extrabold ${
                              app.status === 'APPROVED'
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                            }`}
                          >
                            {app.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            onClick={() => {
                              setReviewingItem(app);
                              setReviewDecision('APPROVED');
                              setReviewerNotes(app.reviewerNotes || '');
                            }}
                            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg font-semibold text-3xs border border-slate-700 transition"
                          >
                            Audit
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 4: Fleet & Assignments */}
      {activeTab === 'VEHICLE_ASSIGNMENTS' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Layers className="w-4 h-4 text-emerald-400" />
              Verified Fleet & Driver-to-Vehicle Assignment Manager
            </h3>
            <span className="text-xs text-slate-400">Total Registered Vehicles: {ambulances.length}</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="text-3xs uppercase bg-slate-950/60 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4">Vehicle Reg</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">Organization</th>
                  <th className="py-3 px-4">Current Driver</th>
                  <th className="py-3 px-4">GPS Freshness</th>
                  <th className="py-3 px-4 text-right">Assignment Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {ambulances.map((amb) => {
                  const hasDriver = !!amb.driver || !!amb.driverId;
                  const driverName = amb.driver?.name || (hasDriver ? 'Assigned' : 'Unassigned');
                  return (
                    <tr key={amb.id} className="hover:bg-slate-850/50 transition">
                      <td className="py-3 px-4 font-mono font-bold text-white">{amb.vehicleNumber}</td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded-full text-3xs font-extrabold bg-blue-500/20 text-blue-400 border border-blue-500/30">
                          {amb.ambulanceType}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-300">{amb.owningOrganization?.name || 'LifeLink Fleet'}</td>
                      <td className="py-3 px-4">
                        <span className={`font-semibold ${hasDriver ? 'text-emerald-400' : 'text-slate-500'}`}>
                          {driverName}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded-full text-3xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1 w-max">
                          <Radio className="w-2.5 h-2.5 animate-pulse" /> LIVE
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right space-x-2">
                        {hasDriver ? (
                          <button
                            onClick={() => handleUnassignDriver(amb.id)}
                            className="px-2.5 py-1 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 rounded-lg text-3xs font-bold border border-rose-500/30 transition"
                          >
                            Unassign
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              setAssigningAmb(amb);
                              setSelectedDriverId('');
                            }}
                            className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-3xs font-bold shadow-md transition"
                          >
                            Assign Driver
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 5: Dispatch Eligibility Inspector */}
      {activeTab === 'DISPATCH_INSPECTOR' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Activity className="w-5 h-5 text-rose-500" />
              12-Point Authoritative Dispatch Eligibility Gatekeeper
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Select an ambulance or enter vehicle ID to inspect why it qualifies or fails real emergency dispatch eligibility.
            </p>
          </div>

          <div className="flex gap-3 max-w-xl">
            <select
              value={inspectAmbulanceId}
              onChange={(e) => {
                setInspectAmbulanceId(e.target.value);
                handleRunInspection(e.target.value);
              }}
              className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-xs text-white"
            >
              <option value="">-- Select Ambulance to Inspect --</option>
              {ambulances.map((amb) => (
                <option key={amb.id} value={amb.id}>
                  {amb.vehicleNumber} ({amb.ambulanceType}) - {amb.owningOrganization?.name || 'Fleet'}
                </option>
              ))}
            </select>

            <button
              onClick={() => handleRunInspection(inspectAmbulanceId)}
              disabled={!inspectAmbulanceId || inspecting}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-xl transition"
            >
              {inspecting ? 'Auditing...' : 'Run Audit'}
            </button>
          </div>

          {inspectionResult && (
            <div className="bg-slate-950 border border-slate-800/80 rounded-2xl p-6 space-y-5">
              <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <div>
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Overall Verdict</span>
                  <div className="flex items-center gap-2 mt-1">
                    {inspectionResult.isEligible ? (
                      <span className="px-3 py-1 bg-emerald-500/20 text-emerald-400 font-black rounded-full text-xs border border-emerald-500/40 flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4" /> DISPATCH_ELIGIBLE
                      </span>
                    ) : (
                      <span className="px-3 py-1 bg-rose-500/20 text-rose-400 font-black rounded-full text-xs border border-rose-500/40 flex items-center gap-1.5">
                        <XCircle className="w-4 h-4" /> DISPATCH_INELIGIBLE
                      </span>
                    )}
                  </div>
                </div>

                <div className="text-right">
                  <span className="text-3xs text-slate-500 block">Vehicle: {inspectionResult.vehicleNumber || 'N/A'}</span>
                  <span className="text-3xs text-slate-500 block">Driver: {inspectionResult.driverName || 'N/A'}</span>
                </div>
              </div>

              {/* 12 Check Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {Object.entries(inspectionResult.details || {}).map(([key, val]) => (
                  <div
                    key={key}
                    className={`flex items-center justify-between p-3 rounded-xl border ${
                      val
                        ? 'bg-emerald-950/20 border-emerald-800/30 text-emerald-300'
                        : 'bg-rose-950/20 border-rose-800/30 text-rose-300'
                    }`}
                  >
                    <span className="text-xs font-mono">{key}</span>
                    {val ? (
                      <span className="text-3xs font-extrabold bg-emerald-500/20 px-2 py-0.5 rounded text-emerald-400">PASS</span>
                    ) : (
                      <span className="text-3xs font-extrabold bg-rose-500/20 px-2 py-0.5 rounded text-rose-400">FAIL</span>
                    )}
                  </div>
                ))}
              </div>

              {inspectionResult.reasons && inspectionResult.reasons.length > 0 && (
                <div className="bg-rose-950/30 border border-rose-800/40 rounded-xl p-4">
                  <span className="text-xs font-bold text-rose-400 block mb-1">Disqualification Blockers:</span>
                  <ul className="list-disc list-inside text-xs text-rose-300 space-y-1">
                    {inspectionResult.reasons.map((r: string, idx: number) => (
                      <li key={idx} className="font-mono text-3xs">{r}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tab 6: Nagpur Pilot Switchboard */}
      {activeTab === 'PILOT_SWITCHBOARD' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Radio className="w-5 h-5 text-emerald-400" />
              Nagpur Pilot Network Activation Switchboard
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Controlled, auditable activation of approved partner organizations in the Nagpur Pilot Zone (30km radius).
            </p>
          </div>

          <div className="space-y-4">
            {pilotChecklists.length === 0 ? (
              <div className="p-8 text-center text-slate-500 border border-dashed border-slate-800 rounded-2xl">
                No organizations queued for pilot activation. Approve a hospital or operator application first.
              </div>
            ) : (
              pilotChecklists.map((chk) => {
                const isLive = chk.activationStatus === 'PILOT_ACTIVE';
                return (
                  <div
                    key={chk.id}
                    className={`p-5 rounded-2xl border transition ${
                      isLive
                        ? 'bg-emerald-950/10 border-emerald-800/40 shadow-lg shadow-emerald-950/20'
                        : 'bg-slate-950 border-slate-800'
                    }`}
                  >
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2.5">
                          <h4 className="text-sm font-bold text-white">{chk.organizationName}</h4>
                          <span className="px-2 py-0.5 rounded text-3xs font-extrabold bg-slate-800 text-slate-300">
                            {chk.organizationType}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-full text-3xs font-black ${
                              isLive
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                            }`}
                          >
                            {chk.activationStatus}
                          </span>
                        </div>
                        <div className="flex items-center gap-4 text-3xs text-slate-400 mt-2">
                          <span>Verified Fleet: <strong className="text-white">{chk.verifiedFleetCount}</strong></span>
                          <span>Verified Drivers: <strong className="text-white">{chk.verifiedDriverCount}</strong></span>
                          <span>Active Assignments: <strong className="text-white">{chk.activeAssignmentsCount}</strong></span>
                          <span>GPS Telemetry: <strong className="text-white">{chk.hasRecentGpsPing ? 'LIVE' : 'OFFLINE'}</strong></span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {isLive ? (
                          <button
                            onClick={() => handleSuspendPilot(chk.organizationId)}
                            className="px-4 py-2 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-600/30 text-xs font-bold rounded-xl transition"
                          >
                            Suspend Pilot Live
                          </button>
                        ) : (
                          <button
                            onClick={() => handleActivatePilot(chk.organizationId)}
                            disabled={actionLoading}
                            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl shadow-lg transition"
                          >
                            Authorize Pilot Activation
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Review Dossier Modal */}
      {reviewingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-lg w-full space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-rose-400" />
                Audit Dossier: {reviewingItem.hospitalName || reviewingItem.operatorName || reviewingItem.fullName}
              </h3>
              <button
                onClick={() => setReviewingItem(null)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleReviewSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">Decision</label>
                <select
                  value={reviewDecision}
                  onChange={(e: any) => setReviewDecision(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-xs text-white"
                >
                  <option value="APPROVED">APPROVED — Authorize as verified LifeLink partner</option>
                  <option value="NEEDS_MORE_INFO">NEEDS_MORE_INFO — Request additional documents from applicant</option>
                  <option value="REJECTED">REJECTED — Deny application</option>
                  <option value="SUSPENDED">SUSPENDED — Suspend active operations</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  Reviewer Notes / Operational Reason
                </label>
                <textarea
                  value={reviewerNotes}
                  onChange={(e) => setReviewerNotes(e.target.value)}
                  placeholder="Record verification methodology, document reference numbers, or missing criteria..."
                  rows={3}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-xs text-white"
                />
              </div>

              {actionMessage && (
                <div
                  className={`p-3 rounded-xl text-xs ${
                    actionMessage.type === 'success' ? 'bg-emerald-950/40 text-emerald-300' : 'bg-rose-950/40 text-rose-300'
                  }`}
                >
                  {actionMessage.text}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setReviewingItem(null)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-xl shadow-lg transition"
                >
                  {actionLoading ? 'Recording Decision...' : 'Commit Decision'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Driver Assignment Modal */}
      {assigningAmb && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-md w-full space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Layers className="w-4 h-4 text-emerald-400" />
                Assign Driver to {assigningAmb.vehicleNumber}
              </h3>
              <button onClick={() => setAssigningAmb(null)} className="text-slate-400 hover:text-white text-sm">
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">Select Verified Driver</label>
                <select
                  value={selectedDriverId}
                  onChange={(e) => setSelectedDriverId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-xs text-white"
                >
                  <option value="">-- Choose Driver --</option>
                  {driverApps
                    .filter((d) => d.status === 'APPROVED')
                    .map((d) => (
                      <option key={d.driverUserId} value={d.driverUserId}>
                        {d.fullName} ({d.phone}) - DL: {d.licenseNumber}
                      </option>
                    ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAssigningAmb(null)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleAssignDriver}
                  disabled={!selectedDriverId || actionLoading}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl shadow-lg transition"
                >
                  {actionLoading ? 'Assigning...' : 'Confirm Assignment'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
