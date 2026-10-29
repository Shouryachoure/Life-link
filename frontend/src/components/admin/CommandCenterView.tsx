import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  AlertTriangle,
  ShieldCheck,
  ShieldAlert,
  Truck,
  Building,
  Users,
  Radio,
  Clock,
  CheckCircle,
  XCircle,
  RefreshCw,
  MapPin,
  Calendar,
  AlertCircle,
  FileText,
  RotateCcw,
  Ban,
  Check,
  Info,
  ExternalLink,
  ChevronRight,
  Filter,
  Eye,
  Send,
  Navigation
} from 'lucide-react';
import { HeartbeatLoader } from '../ui/HeartbeatLoader';
import { formatIndianPhone, maskIndianPhone, formatIndianDateTime } from '../../utils/localization';

interface CommandCenterViewProps {
  apiFetch: (url: string, options?: any) => Promise<any>;
  socket: any;
  onOpenConfirmModal: (config: any) => void;
}

export const CommandCenterView: React.FC<CommandCenterViewProps> = ({
  apiFetch,
  socket,
  onOpenConfirmModal,
}) => {
  const [overview, setOverview] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [actionSuccessMsg, setActionSuccessMsg] = useState<string | null>(null);

  // Sub-tabs for deep module inspection
  const [activeModuleTab, setActiveModuleTab] = useState<
    'OVERVIEW' | 'REQUESTS' | 'FLEET' | 'PENDING' | 'EXPIRATIONS' | 'OUTBOX' | 'AUDIT'
  >('OVERVIEW');

  // Detailed paginated lists
  const [pagedRequests, setPagedRequests] = useState<any[]>([]);
  const [requestsTotal, setRequestsTotal] = useState(0);
  const [requestsPage, setRequestsPage] = useState(1);
  const [requestStatusFilter, setRequestStatusFilter] = useState('ALL');
  const [requestDemoFilter, setRequestDemoFilter] = useState('ALL');
  const [requestsLoading, setRequestsLoading] = useState(false);

  const [pagedFleet, setPagedFleet] = useState<any[]>([]);
  const [fleetTotal, setFleetTotal] = useState(0);
  const [fleetPage, setFleetPage] = useState(1);
  const [fleetTypeFilter, setFleetTypeFilter] = useState('ALL');
  const [fleetFreshnessFilter, setFleetFreshnessFilter] = useState('ALL');
  const [fleetLoading, setFleetLoading] = useState(false);

  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditPage, setAuditPage] = useState(1);
  const [auditLoading, setAuditLoading] = useState(false);

  // Fetch Composite Overview Telemetry
  const fetchOverview = useCallback(async (quiet = false) => {
    if (!quiet) setIsRefreshing(true);
    try {
      setError(null);
      const data = await apiFetch('/admin/command-center/overview');
      setOverview(data);
      setLastRefreshed(new Date());
    } catch (err: any) {
      console.error('Failed to fetch command center telemetry:', err);
      setError(err.message || 'Unable to load Command Center operations telemetry.');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [apiFetch]);

  // Fetch Paginated Requests
  const fetchDetailedRequests = useCallback(async (page = 1) => {
    setRequestsLoading(true);
    try {
      let query = `?page=${page}&limit=10`;
      if (requestStatusFilter !== 'ALL') query += `&status=${requestStatusFilter}`;
      if (requestDemoFilter === 'DEMO') query += '&isDemo=true';
      if (requestDemoFilter === 'PRODUCTION') query += '&isDemo=false';
      const data = await apiFetch(`/admin/command-center/requests${query}`);
      setPagedRequests(data.requests || []);
      setRequestsTotal(data.total || 0);
      setRequestsPage(data.page || 1);
    } catch (err: any) {
      console.error('Failed to fetch detailed requests:', err);
    } finally {
      setRequestsLoading(false);
    }
  }, [apiFetch, requestStatusFilter, requestDemoFilter]);

  // Fetch Paginated Fleet
  const fetchDetailedFleet = useCallback(async (page = 1) => {
    setFleetLoading(true);
    try {
      let query = `?page=${page}&limit=10`;
      if (fleetTypeFilter !== 'ALL') query += `&entityType=${fleetTypeFilter}`;
      if (fleetFreshnessFilter !== 'ALL') query += `&freshness=${fleetFreshnessFilter}`;
      const data = await apiFetch(`/admin/command-center/fleet${query}`);
      setPagedFleet(data.fleet || []);
      setFleetTotal(data.total || 0);
      setFleetPage(data.page || 1);
    } catch (err: any) {
      console.error('Failed to fetch detailed fleet:', err);
    } finally {
      setFleetLoading(false);
    }
  }, [apiFetch, fleetTypeFilter, fleetFreshnessFilter]);

  // Fetch Audit Logs
  const fetchAuditLogs = useCallback(async (page = 1) => {
    setAuditLoading(true);
    try {
      const data = await apiFetch(`/admin/command-center/audit-logs?page=${page}&limit=15`);
      setAuditLogs(data.logs || []);
      setAuditTotal(data.total || 0);
      setAuditPage(data.page || 1);
    } catch (err: any) {
      console.error('Failed to fetch audit logs:', err);
    } finally {
      setAuditLoading(false);
    }
  }, [apiFetch]);

  // Initial load
  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  // Auto-refresh interval (every 30 seconds for live operations telemetry)
  useEffect(() => {
    const interval = setInterval(() => {
      fetchOverview(true);
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchOverview]);

  // Socket.IO real-time event listeners
  useEffect(() => {
    if (!socket) return;

    const handleTelemetryUpdate = () => {
      fetchOverview(true);
    };

    socket.on('command_center:telemetry_update', handleTelemetryUpdate);
    socket.on('telemetry:update', handleTelemetryUpdate);
    socket.on('telemetry:request_created', handleTelemetryUpdate);
    socket.on('telemetry:request_status', handleTelemetryUpdate);

    return () => {
      socket.off('command_center:telemetry_update', handleTelemetryUpdate);
      socket.off('telemetry:update', handleTelemetryUpdate);
      socket.off('telemetry:request_created', handleTelemetryUpdate);
      socket.off('telemetry:request_status', handleTelemetryUpdate);
    };
  }, [socket, fetchOverview]);

  // Handle module tab changes
  useEffect(() => {
    if (activeModuleTab === 'REQUESTS') fetchDetailedRequests(1);
    if (activeModuleTab === 'FLEET') fetchDetailedFleet(1);
    if (activeModuleTab === 'AUDIT') fetchAuditLogs(1);
  }, [activeModuleTab, fetchDetailedRequests, fetchDetailedFleet, fetchAuditLogs]);

  // High-Impact Operational Action Execution
  const triggerOperationalAction = (
    targetType: 'HOSPITAL' | 'OPERATOR' | 'DRIVER' | 'AMBULANCE' | 'USER',
    targetId: string,
    action: 'APPROVE' | 'REJECT' | 'SUSPEND' | 'REINSTATE',
    targetName: string
  ) => {
    const isDestructive = action === 'REJECT' || action === 'SUSPEND';
    const actionLabel =
      action === 'APPROVE'
        ? 'Approve & Certify'
        : action === 'REJECT'
        ? 'Reject Application'
        : action === 'SUSPEND'
        ? 'Suspend Operational Entity'
        : 'Reinstate Entity';

    onOpenConfirmModal({
      isOpen: true,
      title: `${actionLabel} — ${targetType}`,
      description: `Execute "${action}" on ${targetType} "${targetName}"? This is an auditable command center action that immediately impacts real-time emergency dispatch and compliance records.`,
      confirmLabel: actionLabel,
      isDestructive,
      requireReason: true,
      reasonLabel: 'Mandatory Operational Audit Reason (min 3 chars)',
      reasonPlaceholder: 'Specify the clinical, compliance, or regulatory rationale for this action...',
      onConfirm: async (reason: string) => {
        try {
          const res = await apiFetch('/admin/command-center/action', {
            method: 'POST',
            body: JSON.stringify({
              targetType,
              targetId,
              action,
              reason,
            }),
          });
          setActionSuccessMsg(res.message || `Action ${action} executed successfully.`);
          setTimeout(() => setActionSuccessMsg(null), 5000);
          fetchOverview();
          if (activeModuleTab === 'REQUESTS') fetchDetailedRequests(requestsPage);
          if (activeModuleTab === 'FLEET') fetchDetailedFleet(fleetPage);
          if (activeModuleTab === 'AUDIT') fetchAuditLogs(auditPage);
        } catch (err: any) {
          alert(err.message || `Failed to execute action ${action}`);
        }
      },
    });
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-4">
        <HeartbeatLoader size="large" />
        <p className="text-sm text-slate-400">Loading Real-Time Operations Command Center...</p>
      </div>
    );
  }

  const modules = overview?.modules || {};
  const {
    emergencyRequests,
    activeTripsAndOffers,
    unresolvedEscalations,
    fleetStatus,
    pendingVerifications,
    credentialExpirations,
    notificationOutbox,
    gpsFreshness,
    opdAndAppointments,
    nagpurPilotStatus,
  } = modules;

  return (
    <div className="space-y-6">
      {/* Top Banner / Command Center Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 md:p-6 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-rose-600/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <span className="p-2.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-500">
                <Radio className="w-5 h-5 animate-pulse" />
              </span>
              <div>
                <h1 className="text-xl md:text-2xl font-black text-white tracking-tight flex items-center gap-2">
                  Emergency Operations Command Center
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md text-3xs font-extrabold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 uppercase tracking-widest">
                    LIVE
                  </span>
                </h1>
                <p className="text-xs text-slate-400">
                  Authorized Super Administrator Operations • Nagpur Municipal Pilot Zone (30km Radius)
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-end">
            <div className="text-right hidden sm:block">
              <span className="text-3xs text-slate-400 uppercase tracking-wider block">Telemetry Freshness</span>
              <span className="text-xs font-mono text-slate-300">
                {formatIndianDateTime(lastRefreshed)}
              </span>
            </div>
            <button
              onClick={() => fetchOverview()}
              disabled={isRefreshing}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-2 transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>Refresh Now</span>
            </button>
          </div>
        </div>

        {/* Global Operational Notification Banner */}
        {actionSuccessMsg && (
          <div className="mt-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2 animate-in fade-in duration-200">
            <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{actionSuccessMsg}</span>
          </div>
        )}

        {error && (
          <div className="mt-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Module Sub-tabs */}
        <div className="flex items-center gap-2 overflow-x-auto pt-5 mt-2 border-t border-slate-800/80">
          {[
            { id: 'OVERVIEW', label: '10 Modules Overview', icon: Activity },
            { id: 'REQUESTS', label: `Dispatches (${emergencyRequests?.total || 0})`, icon: Clock },
            { id: 'FLEET', label: `Fleet (${fleetStatus?.totalAmbulances || 0})`, icon: Truck },
            { id: 'PENDING', label: `Pending Verifications (${pendingVerifications?.totalPending || 0})`, icon: ShieldCheck },
            { id: 'EXPIRATIONS', label: `Expirations & Alerts (${(credentialExpirations?.expiredCount || 0) + (credentialExpirations?.suspendedEntitiesCount || 0)})`, icon: AlertTriangle },
            { id: 'OUTBOX', label: `Outbox (${notificationOutbox?.queuedCount || 0} queued)`, icon: Send },
            { id: 'AUDIT', label: 'Audit Trail', icon: FileText },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeModuleTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveModuleTab(tab.id as any)}
                className={`px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap flex items-center gap-2 transition-all ${
                  isActive
                    ? 'bg-rose-600 text-white shadow-md shadow-rose-600/30'
                    : 'bg-slate-950/60 text-slate-400 hover:bg-slate-800 hover:text-slate-200 border border-slate-800'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* VIEW: MAIN 10-MODULE OVERVIEW */}
      {activeModuleTab === 'OVERVIEW' && (
        <div className="space-y-6">
          {/* HIGH PRIORITY MODULE 3: Requests with No Eligible Ambulance (112 Escalations) */}
          {(unresolvedEscalations?.count || 0) > 0 && (
            <div className="bg-rose-950/40 border-2 border-rose-600/60 p-5 rounded-3xl shadow-xl space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5 text-rose-400">
                  <AlertCircle className="w-5 h-5 animate-bounce" />
                  <h3 className="text-sm font-black uppercase tracking-wider">
                    Module 3: Urgent Unresolved Incidents ({unresolvedEscalations?.count} Escalated to 112)
                  </h3>
                </div>
                <span className="px-2.5 py-1 rounded-full text-3xs font-extrabold bg-rose-600 text-white uppercase tracking-wider">
                  ACTION REQUIRED
                </span>
              </div>
              <p className="text-xs text-rose-200/80">
                {unresolvedEscalations?.definition}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                {unresolvedEscalations?.requests?.map((req: any) => (
                  <div
                    key={req.id}
                    className="p-3.5 rounded-2xl bg-slate-900/90 border border-rose-500/40 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white">{req.patientName}</span>
                      <span className="px-2 py-0.5 rounded text-3xs font-extrabold bg-rose-500/20 text-rose-400 border border-rose-500/30">
                        {req.status}
                      </span>
                    </div>
                    <div className="text-2xs text-slate-400 space-y-1">
                      <p className="flex items-center gap-1.5">
                        <MapPin className="w-3 h-3 text-rose-400 shrink-0" />
                        <span className="truncate">{req.pickupAddress}</span>
                      </p>
                      <p className="flex items-center justify-between">
                        <span>Category: <strong className="text-slate-300">{req.category}</strong></span>
                        <span>Elapsed: <strong className="text-rose-400">{req.elapsedMinutes} mins</strong></span>
                      </p>
                      <p className="text-3xs text-rose-300/90 font-mono">
                        Fallback: {req.fallbackProtocol}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TOP ROW: MODULES 1, 2, 4, 10 SUMMARY METRICS */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Module 1 Card: Emergency Requests by State */}
            <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl space-y-3 relative overflow-hidden">
              <div className="flex items-center justify-between">
                <span className="text-3xs font-bold uppercase tracking-wider text-slate-400">
                  Module 1: Dispatches
                </span>
                <Clock className="w-4 h-4 text-rose-500" />
              </div>
              <div>
                <span className="text-3xl font-black text-white">
                  {emergencyRequests?.total || 0}
                </span>
                <span className="text-xs text-slate-500 ml-2">Total Requests</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-2xs pt-1 border-t border-slate-800">
                <div>
                  <span className="text-slate-500 block">Active:</span>
                  <span className="font-bold text-rose-400">{emergencyRequests?.activeCount || 0}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Completed:</span>
                  <span className="font-bold text-emerald-400">{emergencyRequests?.completedCount || 0}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Cancelled:</span>
                  <span className="font-bold text-slate-400">{emergencyRequests?.cancelledCount || 0}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Escalated 112:</span>
                  <span className="font-bold text-amber-400">{emergencyRequests?.escalatedCount || 0}</span>
                </div>
              </div>
              <div className="flex items-center justify-between text-3xs pt-1 text-slate-400 border-t border-slate-800/60">
                <span>Production: <strong>{emergencyRequests?.productionCount || 0}</strong></span>
                <span className="text-amber-400">Demo/Sim: <strong>{emergencyRequests?.demoCount || 0}</strong></span>
              </div>
            </div>

            {/* Module 2 Card: Active Trips & Dispatch Offers */}
            <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-3xs font-bold uppercase tracking-wider text-slate-400">
                  Module 2: Live In-Transit
                </span>
                <Truck className="w-4 h-4 text-blue-500" />
              </div>
              <div>
                <span className="text-3xl font-black text-blue-400">
                  {activeTripsAndOffers?.activeTripsCount || 0}
                </span>
                <span className="text-xs text-slate-500 ml-2">Active Trips</span>
              </div>
              <div className="space-y-1 text-2xs pt-1 border-t border-slate-800">
                <div className="flex justify-between">
                  <span className="text-slate-500">Unexpired Offers:</span>
                  <span className="font-bold text-amber-400">
                    {activeTripsAndOffers?.activeOffersCount || 0}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Avg Offer SLA:</span>
                  <span className="font-mono text-slate-300">120 seconds</span>
                </div>
              </div>
              <p className="text-3xs text-slate-400 pt-1 border-t border-slate-800/60 truncate">
                {activeTripsAndOffers?.activeTrips?.length > 0
                  ? `${activeTripsAndOffers.activeTrips.length} ambulances actively en route`
                  : 'No active dispatches currently on-road'}
              </p>
            </div>

            {/* Module 4 Card: Fleet Counts (Hospital vs Private Operator) */}
            <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-3xs font-bold uppercase tracking-wider text-slate-400">
                  Module 4: Dispatchable Fleet
                </span>
                <ShieldCheck className="w-4 h-4 text-emerald-500" />
              </div>
              <div>
                <span className="text-3xl font-black text-emerald-400">
                  {fleetStatus?.totalDispatchable || 0}
                </span>
                <span className="text-xs text-slate-500 ml-2">Available Now</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-2xs pt-1 border-t border-slate-800">
                <div>
                  <span className="text-slate-500 block">Hospital Fleet:</span>
                  <span className="font-bold text-slate-200">
                    {fleetStatus?.hospitalFleet?.available || 0} avail / {fleetStatus?.hospitalFleet?.total || 0}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">Private Operator:</span>
                  <span className="font-bold text-slate-200">
                    {fleetStatus?.operatorFleet?.available || 0} avail / {fleetStatus?.operatorFleet?.total || 0}
                  </span>
                </div>
              </div>
              <p className="text-3xs text-amber-400/90 pt-1 border-t border-slate-800/60 leading-tight">
                *Unverified/suspended vehicles excluded from dispatch.
              </p>
            </div>

            {/* Module 10 Card: Nagpur Pilot Service-Area Status */}
            <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-3xs font-bold uppercase tracking-wider text-slate-400">
                  Module 10: Pilot Zone
                </span>
                <MapPin className="w-4 h-4 text-purple-400" />
              </div>
              <div>
                <span className="text-lg font-black text-white truncate block">
                  {nagpurPilotStatus?.name || 'Nagpur Pilot'}
                </span>
                <span className="text-xs text-purple-400 font-semibold">
                  {nagpurPilotStatus?.radiusKm}km Operational Radius
                </span>
              </div>
              <div className="space-y-1 text-2xs pt-1 border-t border-slate-800">
                <div className="flex justify-between">
                  <span className="text-slate-500">Coordinates:</span>
                  <span className="font-mono text-slate-300">
                    {nagpurPilotStatus?.centerLat}, {nagpurPilotStatus?.centerLng}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Municipal Approval:</span>
                  <span className="text-emerald-400 font-bold">APPROVED</span>
                </div>
              </div>
              <div className="flex items-center justify-between text-3xs pt-1 text-slate-400 border-t border-slate-800/60">
                <span>Hospitals: <strong>{nagpurPilotStatus?.activeHospitalsCount || 0}</strong></span>
                <span>Ambulances: <strong>{nagpurPilotStatus?.activeAmbulancesCount || 0}</strong></span>
              </div>
            </div>
          </div>

          {/* SECOND ROW: MODULE 5 (Pending) & MODULE 6 (Expirations) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Module 5: Hospitals & Organizations Awaiting Verification */}
            <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-amber-500" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                    Module 5: Organizations & Personnel Awaiting Review ({pendingVerifications?.totalPending || 0})
                  </h3>
                </div>
                <button
                  onClick={() => setActiveModuleTab('PENDING')}
                  className="text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1 font-semibold"
                >
                  <span>View All</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="text-2xs text-slate-500">
                {pendingVerifications?.definition}
              </p>

              <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
                {pendingVerifications?.items?.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-2xl">
                    No organizations or personnel currently awaiting verification review.
                  </div>
                ) : (
                  pendingVerifications?.items?.slice(0, 5).map((item: any) => (
                    <div
                      key={item.id}
                      className="p-3 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-3"
                    >
                      <div className="space-y-0.5 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-white truncate">{item.name}</span>
                          <span className="px-2 py-0.5 rounded text-3xs font-extrabold bg-amber-500/10 text-amber-400 border border-amber-500/30">
                            {item.type}
                          </span>
                        </div>
                        <p className="text-2xs text-slate-400 truncate">
                          {item.city} • Contact: {item.contact}
                        </p>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => triggerOperationalAction(item.type, item.id, 'APPROVE', item.name)}
                          className="px-2.5 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600 text-emerald-400 hover:text-white border border-emerald-500/30 text-3xs font-bold transition-all"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => triggerOperationalAction(item.type, item.id, 'REJECT', item.name)}
                          className="px-2.5 py-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600 text-rose-400 hover:text-white border border-rose-500/30 text-3xs font-bold transition-all"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Module 6: Driver & Vehicle Credential Expirations & Suspended Entities */}
            <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-500" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                    Module 6: Credential Expirations & Suspensions ({credentialExpirations?.flaggedItems?.length || 0})
                  </h3>
                </div>
                <button
                  onClick={() => setActiveModuleTab('EXPIRATIONS')}
                  className="text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1 font-semibold"
                >
                  <span>View All</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="text-2xs text-slate-500">
                {credentialExpirations?.definition}
              </p>

              <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
                {credentialExpirations?.flaggedItems?.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-2xl">
                    All fleet vehicles and commercial driver licenses are currently certified and valid.
                  </div>
                ) : (
                  credentialExpirations?.flaggedItems?.slice(0, 5).map((item: any, idx: number) => {
                    const isSuspended = item.status === 'SUSPENDED';
                    const isExpired = item.status === 'EXPIRED';
                    return (
                      <div
                        key={item.id || idx}
                        className="p-3 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-3"
                      >
                        <div className="space-y-0.5 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-white truncate">{item.name}</span>
                            <span
                              className={`px-2 py-0.5 rounded text-3xs font-extrabold border ${
                                isSuspended
                                  ? 'bg-rose-500/20 text-rose-400 border-rose-500/40'
                                  : isExpired
                                  ? 'bg-rose-500/20 text-rose-400 border-rose-500/40'
                                  : 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                              }`}
                            >
                              {item.status}
                            </span>
                          </div>
                          <p className="text-2xs text-slate-400 truncate">
                            {item.entityType} • {item.reason || `Expiry: ${item.daysRemaining} days remaining`}
                          </p>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {isSuspended ? (
                            <button
                              onClick={() => triggerOperationalAction(item.entityType, item.id, 'REINSTATE', item.name)}
                              className="px-2.5 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600 text-emerald-400 hover:text-white border border-emerald-500/30 text-3xs font-bold transition-all"
                            >
                              Reinstate
                            </button>
                          ) : (
                            <button
                              onClick={() => triggerOperationalAction(item.entityType, item.id, 'SUSPEND', item.name)}
                              className="px-2.5 py-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600 text-rose-400 hover:text-white border border-rose-500/30 text-3xs font-bold transition-all"
                            >
                              Suspend
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* THIRD ROW: MODULE 7 (Notification Outbox) & MODULE 8 (GPS Freshness) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Module 7: Notification Failures & Queued Work */}
            <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Send className="w-4 h-4 text-blue-400" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                    Module 7: Notification Outbox Telemetry
                  </h3>
                </div>
                <button
                  onClick={() => setActiveModuleTab('OUTBOX')}
                  className="text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1 font-semibold"
                >
                  <span>Inspect Queue</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="text-2xs text-slate-500">
                {notificationOutbox?.definition}
              </p>

              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="p-2.5 rounded-2xl bg-slate-950 border border-slate-800">
                  <span className="text-3xs text-slate-500 uppercase block">Queued</span>
                  <span className="text-base font-black text-slate-200">{notificationOutbox?.queuedCount || 0}</span>
                </div>
                <div className="p-2.5 rounded-2xl bg-slate-950 border border-slate-800">
                  <span className="text-3xs text-slate-500 uppercase block">Retrying</span>
                  <span className="text-base font-black text-amber-400">{notificationOutbox?.retryingCount || 0}</span>
                </div>
                <div className="p-2.5 rounded-2xl bg-slate-950 border border-slate-800">
                  <span className="text-3xs text-slate-500 uppercase block">Failed</span>
                  <span className="text-base font-black text-rose-400">{notificationOutbox?.failedCount || 0}</span>
                </div>
                <div className="p-2.5 rounded-2xl bg-slate-950 border border-slate-800">
                  <span className="text-3xs text-slate-500 uppercase block">Delivered</span>
                  <span className="text-base font-black text-emerald-400">{notificationOutbox?.deliveredCount || 0}</span>
                </div>
              </div>

              {notificationOutbox?.recentFailures?.length > 0 && (
                <div className="space-y-1.5 pt-2">
                  <span className="text-3xs font-bold text-rose-400 uppercase tracking-wider block">Recent Delivery Errors:</span>
                  {notificationOutbox.recentFailures.slice(0, 3).map((f: any) => (
                    <div key={f.id} className="p-2 rounded-xl bg-rose-500/10 border border-rose-500/20 text-2xs text-rose-300 flex items-center justify-between">
                      <span className="truncate">{f.type} ({f.channel}) • {f.lastError}</span>
                      <span className="text-3xs font-mono ml-2 shrink-0">Retries: {f.retryCount}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Module 8: GPS Freshness & Tracking Outages */}
            <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Navigation className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                    Module 8: Fleet GPS Freshness & Outages
                  </h3>
                </div>
              </div>
              <p className="text-2xs text-slate-500">
                {gpsFreshness?.definition}
              </p>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800">
                  <span className="text-3xs text-emerald-400 uppercase font-bold block">Active (&lt;5m)</span>
                  <span className="text-xl font-black text-emerald-400">{gpsFreshness?.freshCount || 0}</span>
                </div>
                <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800">
                  <span className="text-3xs text-amber-400 uppercase font-bold block">Aging (5-30m)</span>
                  <span className="text-xl font-black text-amber-400">{gpsFreshness?.agingCount || 0}</span>
                </div>
                <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800">
                  <span className="text-3xs text-rose-400 uppercase font-bold block">Outage (&gt;30m)</span>
                  <span className="text-xl font-black text-rose-400">{gpsFreshness?.outageCount || 0}</span>
                </div>
              </div>

              {gpsFreshness?.outages?.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <span className="text-3xs font-bold text-slate-400 uppercase tracking-wider block">Fleet Outages:</span>
                  <div className="space-y-1 max-h-36 overflow-y-auto">
                    {gpsFreshness.outages.slice(0, 4).map((out: any) => (
                      <div key={out.id} className="p-2 rounded-xl bg-slate-950 border border-slate-800 text-2xs flex items-center justify-between text-slate-300">
                        <span className="font-bold">{out.vehicleNumber} ({out.driverName})</span>
                        <span className="text-rose-400 font-mono text-3xs">Stale {out.outageMinutes}m</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* FOURTH ROW: MODULE 9 (Appointment & OPD Summary) */}
          <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-purple-400" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                  Module 9: Appointment & OPD Operational Summary ({opdAndAppointments?.totalAppointments || 0} Appointments)
                </h3>
              </div>
              <div className="text-2xs text-slate-400">
                Active Medical Specialists: <strong className="text-white">{opdAndAppointments?.activeDoctorsCount || 0}</strong>
              </div>
            </div>
            <p className="text-2xs text-slate-500">
              {opdAndAppointments?.definition}
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2 text-center text-2xs">
              <div className="p-2.5 rounded-2xl bg-slate-950 border border-slate-800">
                <span className="text-slate-500 block">Booked</span>
                <span className="text-sm font-bold text-slate-200">{opdAndAppointments?.byStatus?.BOOKED || 0}</span>
              </div>
              <div className="p-2.5 rounded-2xl bg-slate-950 border border-slate-800">
                <span className="text-slate-500 block">Confirmed</span>
                <span className="text-sm font-bold text-blue-400">{opdAndAppointments?.byStatus?.CONFIRMED || 0}</span>
              </div>
              <div className="p-2.5 rounded-2xl bg-slate-950 border border-slate-800">
                <span className="text-slate-500 block">Checked In</span>
                <span className="text-sm font-bold text-amber-400">{opdAndAppointments?.byStatus?.CHECKED_IN || 0}</span>
              </div>
              <div className="p-2.5 rounded-2xl bg-slate-950 border border-slate-800">
                <span className="text-slate-500 block">Completed</span>
                <span className="text-sm font-bold text-emerald-400">{opdAndAppointments?.byStatus?.COMPLETED || 0}</span>
              </div>
              <div className="p-2.5 rounded-2xl bg-slate-950 border border-slate-800">
                <span className="text-slate-500 block">Available Slots</span>
                <span className="text-sm font-bold text-purple-400">{opdAndAppointments?.slotsSummary?.availableSlots || 0}</span>
              </div>
              <div className="p-2.5 rounded-2xl bg-slate-950 border border-slate-800">
                <span className="text-slate-500 block">Blocked Slots</span>
                <span className="text-sm font-bold text-slate-400">{opdAndAppointments?.slotsSummary?.blockedSlots || 0}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* VIEW: PAGINATED DETAILED REQUESTS TAB */}
      {activeModuleTab === 'REQUESTS' && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Emergency Dispatch Requests Log ({requestsTotal} Records)
              </h3>
              <p className="text-2xs text-slate-400">
                Complete persisted history with live status transitions and demo data tagging.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <select
                value={requestStatusFilter}
                onChange={(e) => {
                  setRequestStatusFilter(e.target.value);
                  setTimeout(() => fetchDetailedRequests(1), 50);
                }}
                className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200"
              >
                <option value="ALL">All Statuses</option>
                <option value="REQUESTED">REQUESTED</option>
                <option value="OFFERED">OFFERED</option>
                <option value="ACCEPTED">ACCEPTED</option>
                <option value="IN_TRANSIT">IN_TRANSIT</option>
                <option value="COMPLETED">COMPLETED</option>
                <option value="CANCELLED">CANCELLED</option>
                <option value="NO_ELIGIBLE_AMBULANCE">NO_ELIGIBLE_AMBULANCE</option>
                <option value="ESCALATED_112">ESCALATED_112</option>
              </select>

              <select
                value={requestDemoFilter}
                onChange={(e) => {
                  setRequestDemoFilter(e.target.value);
                  setTimeout(() => fetchDetailedRequests(1), 50);
                }}
                className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200"
              >
                <option value="ALL">All Environments</option>
                <option value="PRODUCTION">Production Only</option>
                <option value="DEMO">Demo/Simulated Only</option>
              </select>
            </div>
          </div>

          {requestsLoading ? (
            <div className="py-12 flex justify-center">
              <HeartbeatLoader size="medium" />
            </div>
          ) : pagedRequests.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-2xl">
              No emergency requests matching the selected filters.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 text-3xs uppercase tracking-wider">
                    <th className="py-3 px-3">Request ID</th>
                    <th className="py-3 px-3">Patient</th>
                    <th className="py-3 px-3">Pickup Location</th>
                    <th className="py-3 px-3">Category</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3">Assigned Fleet</th>
                    <th className="py-3 px-3">Data Tag</th>
                    <th className="py-3 px-3">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {pagedRequests.map((req) => (
                    <tr key={req.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-3 px-3 font-mono text-3xs text-slate-300">
                        {req.id.slice(0, 8)}...
                      </td>
                      <td className="py-3 px-3">
                        <span className="font-bold text-slate-200 block">{req.patient?.name || 'Citizen'}</span>
                        <span className="text-3xs text-slate-500">{req.patient?.phone || 'No Phone'}</span>
                      </td>
                      <td className="py-3 px-3 text-slate-300 max-w-xs truncate">
                        {req.pickupAddress || `${req.pickupLat?.toFixed(4)}, ${req.pickupLng?.toFixed(4)}`}
                      </td>
                      <td className="py-3 px-3">
                        <span className="px-2 py-0.5 rounded text-3xs font-semibold bg-slate-800 text-slate-300">
                          {req.category || 'GENERAL'}
                        </span>
                      </td>
                      <td className="py-3 px-3">
                        <span
                          className={`px-2 py-0.5 rounded text-3xs font-bold ${
                            req.status === 'COMPLETED'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                              : req.status === 'NO_ELIGIBLE_AMBULANCE' || req.status === 'ESCALATED_112'
                              ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                              : 'bg-blue-500/10 text-blue-400 border border-blue-500/30'
                          }`}
                        >
                          {req.status}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-2xs text-slate-300">
                        {req.ambulance?.vehicleNumber ? (
                          <span>{req.ambulance.vehicleNumber} ({req.driver?.name || 'Driver'})</span>
                        ) : (
                          <span className="text-slate-500 italic">Unassigned</span>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        {req.isDemo ? (
                          <span className="px-2 py-0.5 rounded text-3xs font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30">
                            DEMO
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-3xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                            PILOT
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-3xs text-slate-500 font-mono">
                        {formatIndianDateTime(req.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Pagination Controls */}
              <div className="flex items-center justify-between pt-4 border-t border-slate-800 text-xs text-slate-400">
                <span>
                  Showing page {requestsPage} of {Math.ceil(requestsTotal / 10) || 1}
                </span>
                <div className="flex gap-2">
                  <button
                    disabled={requestsPage <= 1}
                    onClick={() => fetchDetailedRequests(requestsPage - 1)}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-xs"
                  >
                    Previous
                  </button>
                  <button
                    disabled={requestsPage >= Math.ceil(requestsTotal / 10)}
                    onClick={() => fetchDetailedRequests(requestsPage + 1)}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-xs"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* VIEW: PAGINATED FLEET TAB */}
      {activeModuleTab === 'FLEET' && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Fleet Telemetry & Dispatch Eligibility ({fleetTotal} Vehicles)
              </h3>
              <p className="text-2xs text-slate-400">
                CRITICAL RULE: Suspended or unverified vehicles are strictly excluded from dispatch eligibility.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <select
                value={fleetTypeFilter}
                onChange={(e) => {
                  setFleetTypeFilter(e.target.value);
                  setTimeout(() => fetchDetailedFleet(1), 50);
                }}
                className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200"
              >
                <option value="ALL">All Organizations</option>
                <option value="HOSPITAL">Hospital Fleet Only</option>
                <option value="OPERATOR">Private Operator Only</option>
              </select>

              <select
                value={fleetFreshnessFilter}
                onChange={(e) => {
                  setFleetFreshnessFilter(e.target.value);
                  setTimeout(() => fetchDetailedFleet(1), 50);
                }}
                className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200"
              >
                <option value="ALL">All GPS Freshness</option>
                <option value="FRESH">Fresh (&lt;5m)</option>
                <option value="AGING">Aging (5-30m)</option>
                <option value="OUTAGE">Tracking Outage (&gt;30m)</option>
              </select>
            </div>
          </div>

          {fleetLoading ? (
            <div className="py-12 flex justify-center">
              <HeartbeatLoader size="medium" />
            </div>
          ) : pagedFleet.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-2xl">
              No fleet vehicles matching the selected filters.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 text-3xs uppercase tracking-wider">
                    <th className="py-3 px-3">Vehicle</th>
                    <th className="py-3 px-3">Organization</th>
                    <th className="py-3 px-3">Driver</th>
                    <th className="py-3 px-3">Type</th>
                    <th className="py-3 px-3">Verification</th>
                    <th className="py-3 px-3">GPS Freshness</th>
                    <th className="py-3 px-3">Dispatchable</th>
                    <th className="py-3 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {pagedFleet.map((amb) => (
                    <tr key={amb.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-3 px-3">
                        <span className="font-bold text-white block">{amb.vehicleNumber}</span>
                        <span className="text-3xs text-slate-500 font-mono">{amb.id.slice(0, 8)}</span>
                      </td>
                      <td className="py-3 px-3 text-slate-300">
                        {amb.hospital?.name ? (
                          <span className="text-blue-400 font-semibold">{amb.hospital.name} (Hospital)</span>
                        ) : amb.operator?.name ? (
                          <span className="text-purple-400 font-semibold">{amb.operator.name} (Operator)</span>
                        ) : (
                          <span className="text-slate-500 italic">Independent</span>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        <span className="text-slate-200 block">{amb.driver?.name || 'Unassigned'}</span>
                        <span className="text-3xs text-slate-500">{amb.driver?.phone || 'No Phone'}</span>
                      </td>
                      <td className="py-3 px-3">
                        <span className="px-2 py-0.5 rounded text-3xs font-semibold bg-slate-800 text-slate-300">
                          {amb.ambulanceType}
                        </span>
                      </td>
                      <td className="py-3 px-3">
                        <span
                          className={`px-2 py-0.5 rounded text-3xs font-bold ${
                            amb.verificationState === 'VERIFIED'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                              : amb.verificationState === 'SUSPENDED'
                              ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                              : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                          }`}
                        >
                          {amb.verificationState}
                        </span>
                      </td>
                      <td className="py-3 px-3">
                        <span
                          className={`px-2 py-0.5 rounded text-3xs font-bold ${
                            amb.freshnessState === 'FRESH'
                              ? 'bg-emerald-500/10 text-emerald-400'
                              : amb.freshnessState === 'AGING'
                              ? 'bg-amber-500/10 text-amber-400'
                              : 'bg-rose-500/20 text-rose-400'
                          }`}
                        >
                          {amb.freshnessState} ({amb.elapsedMinutes}m)
                        </span>
                      </td>
                      <td className="py-3 px-3">
                        {amb.isDispatchable ? (
                          <span className="px-2 py-0.5 rounded text-3xs font-black bg-emerald-600 text-white">
                            YES (ELIGIBLE)
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-3xs font-bold bg-slate-800 text-slate-400 border border-slate-700">
                            NO (INELIGIBLE)
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right">
                        {amb.verificationState === 'SUSPENDED' ? (
                          <button
                            onClick={() => triggerOperationalAction('AMBULANCE', amb.id, 'REINSTATE', amb.vehicleNumber)}
                            className="px-2.5 py-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600 text-emerald-400 hover:text-white border border-emerald-500/30 text-3xs font-bold"
                          >
                            Reinstate
                          </button>
                        ) : (
                          <button
                            onClick={() => triggerOperationalAction('AMBULANCE', amb.id, 'SUSPEND', amb.vehicleNumber)}
                            className="px-2.5 py-1 rounded-lg bg-rose-600/20 hover:bg-rose-600 text-rose-400 hover:text-white border border-rose-500/30 text-3xs font-bold"
                          >
                            Suspend
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Pagination */}
              <div className="flex items-center justify-between pt-4 border-t border-slate-800 text-xs text-slate-400">
                <span>
                  Showing page {fleetPage} of {Math.ceil(fleetTotal / 10) || 1}
                </span>
                <div className="flex gap-2">
                  <button
                    disabled={fleetPage <= 1}
                    onClick={() => fetchDetailedFleet(fleetPage - 1)}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-xs"
                  >
                    Previous
                  </button>
                  <button
                    disabled={fleetPage >= Math.ceil(fleetTotal / 10)}
                    onClick={() => fetchDetailedFleet(fleetPage + 1)}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-xs"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* VIEW: AUDIT LOGS TAB */}
      {activeModuleTab === 'AUDIT' && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Immutable Operational Audit Log ({auditTotal} Entries)
              </h3>
              <p className="text-2xs text-slate-400">
                Tracks all administrative actions, entity reviews, suspensions, and manual overrides with recorded actor and rationale.
              </p>
            </div>
            <button
              onClick={() => fetchAuditLogs(1)}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-slate-200"
            >
              Refresh Logs
            </button>
          </div>

          {auditLoading ? (
            <div className="py-12 flex justify-center">
              <HeartbeatLoader size="medium" />
            </div>
          ) : auditLogs.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-2xl">
              No audit logs recorded yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 text-3xs uppercase tracking-wider">
                    <th className="py-3 px-3">Timestamp</th>
                    <th className="py-3 px-3">Actor</th>
                    <th className="py-3 px-3">Action</th>
                    <th className="py-3 px-3">Target Entity</th>
                    <th className="py-3 px-3">Transition</th>
                    <th className="py-3 px-3">Operational Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono text-2xs">
                  {auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-3 px-3 text-slate-400 whitespace-nowrap">
                        {formatIndianDateTime(log.createdAt)}
                      </td>
                      <td className="py-3 px-3 text-slate-300">
                        {log.actorId ? log.actorId.slice(0, 8) : 'SYSTEM'}
                      </td>
                      <td className="py-3 px-3 font-bold text-rose-400">
                        {log.action}
                      </td>
                      <td className="py-3 px-3 text-slate-200">
                        {log.targetEntityType}: {log.targetEntityId?.slice(0, 10)}
                      </td>
                      <td className="py-3 px-3 text-slate-400">
                        {log.previousState || 'NONE'} &rarr; <strong className="text-white">{log.newState}</strong>
                      </td>
                      <td className="py-3 px-3 text-slate-300 max-w-sm truncate font-sans">
                        {log.notes || 'No reason provided'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Pagination */}
              <div className="flex items-center justify-between pt-4 border-t border-slate-800 text-xs text-slate-400">
                <span>
                  Showing page {auditPage} of {Math.ceil(auditTotal / 15) || 1}
                </span>
                <div className="flex gap-2">
                  <button
                    disabled={auditPage <= 1}
                    onClick={() => fetchAuditLogs(auditPage - 1)}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-xs"
                  >
                    Previous
                  </button>
                  <button
                    disabled={auditPage >= Math.ceil(auditTotal / 15)}
                    onClick={() => fetchAuditLogs(auditPage + 1)}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-xs"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* VIEW: PENDING VERIFICATIONS DEDICATED TAB */}
      {activeModuleTab === 'PENDING' && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Credential Audits & Pending Verifications ({pendingVerifications?.totalPending || 0})
              </h3>
              <p className="text-2xs text-slate-400">
                Review licenses, facility certifications, and paramedic documents before enabling dispatch eligibility.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800">
              <span className="text-3xs text-slate-500 uppercase block font-bold">Hospitals Awaiting Review</span>
              <span className="text-2xl font-black text-amber-400">{pendingVerifications?.pendingHospitalsCount || 0}</span>
            </div>
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800">
              <span className="text-3xs text-slate-500 uppercase block font-bold">Operators Awaiting Review</span>
              <span className="text-2xl font-black text-purple-400">{pendingVerifications?.pendingOperatorsCount || 0}</span>
            </div>
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800">
              <span className="text-3xs text-slate-500 uppercase block font-bold">Drivers Awaiting Review</span>
              <span className="text-2xl font-black text-blue-400">{pendingVerifications?.pendingDriversCount || 0}</span>
            </div>
          </div>

          <div className="space-y-3 pt-2">
            {pendingVerifications?.items?.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-2xl">
                No organizations or personnel currently awaiting verification review.
              </div>
            ) : (
              pendingVerifications?.items?.map((item: any) => (
                <div
                  key={item.id}
                  className="p-4 rounded-2xl bg-slate-950 border border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-white">{item.name}</span>
                      <span className="px-2 py-0.5 rounded text-3xs font-extrabold bg-amber-500/10 text-amber-400 border border-amber-500/30">
                        {item.type}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400">
                      Location: {item.city} • Contact/License: {item.contact} • State: <strong className="text-amber-400">{item.verificationState}</strong>
                    </p>
                    <p className="text-3xs text-slate-500 font-mono">
                      Submitted: {formatIndianDateTime(item.createdAt)}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <button
                      onClick={() => triggerOperationalAction(item.type, item.id, 'APPROVE', item.name)}
                      className="flex-1 sm:flex-none px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all shadow-md shadow-emerald-600/20"
                    >
                      Approve &amp; Activate
                    </button>
                    <button
                      onClick={() => triggerOperationalAction(item.type, item.id, 'REJECT', item.name)}
                      className="flex-1 sm:flex-none px-4 py-2 rounded-xl bg-rose-600/20 hover:bg-rose-600 text-rose-400 hover:text-white border border-rose-500/30 text-xs font-bold transition-all"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* VIEW: EXPIRATIONS DEDICATED TAB */}
      {activeModuleTab === 'EXPIRATIONS' && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Credential Expirations &amp; Suspended Accounts ({credentialExpirations?.flaggedItems?.length || 0})
              </h3>
              <p className="text-2xs text-slate-400">
                Monitors commercial driver licenses and vehicle fitness certificates expiring within 30 days or already expired.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800">
              <span className="text-3xs text-slate-500 uppercase block font-bold">Expired Credentials</span>
              <span className="text-2xl font-black text-rose-400">{credentialExpirations?.expiredCount || 0}</span>
            </div>
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800">
              <span className="text-3xs text-slate-500 uppercase block font-bold">Expiring within 30 Days</span>
              <span className="text-2xl font-black text-amber-400">{credentialExpirations?.expiringSoonCount || 0}</span>
            </div>
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800">
              <span className="text-3xs text-slate-500 uppercase block font-bold">Suspended Entities</span>
              <span className="text-2xl font-black text-purple-400">{credentialExpirations?.suspendedEntitiesCount || 0}</span>
            </div>
          </div>

          <div className="space-y-3 pt-2">
            {credentialExpirations?.flaggedItems?.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-2xl">
                No expired credentials or suspended entities.
              </div>
            ) : (
              credentialExpirations?.flaggedItems?.map((item: any, idx: number) => {
                const isSuspended = item.status === 'SUSPENDED';
                return (
                  <div
                    key={item.id || idx}
                    className="p-4 rounded-2xl bg-slate-950 border border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-white">{item.name}</span>
                        <span
                          className={`px-2 py-0.5 rounded text-3xs font-extrabold border ${
                            isSuspended
                              ? 'bg-rose-500/20 text-rose-400 border-rose-500/40'
                              : 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                          }`}
                        >
                          {item.status}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400">
                        Target: {item.entityType} • License: {item.licenseNumber} • {item.reason || `${item.daysRemaining} days remaining`}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 w-full sm:w-auto">
                      {isSuspended ? (
                        <button
                          onClick={() => triggerOperationalAction(item.entityType, item.id, 'REINSTATE', item.name)}
                          className="flex-1 sm:flex-none px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all shadow-md shadow-emerald-600/20"
                        >
                          Reinstate Entity
                        </button>
                      ) : (
                        <button
                          onClick={() => triggerOperationalAction(item.entityType, item.id, 'SUSPEND', item.name)}
                          className="flex-1 sm:flex-none px-4 py-2 rounded-xl bg-rose-600/20 hover:bg-rose-600 text-rose-400 hover:text-white border border-rose-500/30 text-xs font-bold transition-all"
                        >
                          Suspend Immediately
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* VIEW: OUTBOX DEDICATED TAB */}
      {activeModuleTab === 'OUTBOX' && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Notification Outbox Telemetry &amp; Worker Deliverability
              </h3>
              <p className="text-2xs text-slate-400">
                Transactional outbox messages across cellular SMS, WebSockets, and push channels.
              </p>
            </div>
            <button
              onClick={() => fetchOverview()}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-slate-200"
            >
              Refresh Outbox
            </button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800">
              <span className="text-3xs text-slate-500 uppercase block font-bold">Queued</span>
              <span className="text-2xl font-black text-slate-200">{notificationOutbox?.queuedCount || 0}</span>
            </div>
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800">
              <span className="text-3xs text-slate-500 uppercase block font-bold">Retrying</span>
              <span className="text-2xl font-black text-amber-400">{notificationOutbox?.retryingCount || 0}</span>
            </div>
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800">
              <span className="text-3xs text-slate-500 uppercase block font-bold">Permanently Failed</span>
              <span className="text-2xl font-black text-rose-400">{notificationOutbox?.failedCount || 0}</span>
            </div>
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800">
              <span className="text-3xs text-slate-500 uppercase block font-bold">Delivered</span>
              <span className="text-2xl font-black text-emerald-400">{notificationOutbox?.deliveredCount || 0}</span>
            </div>
          </div>

          <div className="space-y-2 pt-2">
            <span className="text-xs font-bold text-slate-300 uppercase tracking-wider block">Recent Failures &amp; Retries</span>
            {notificationOutbox?.recentFailures?.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-2xl">
                No notification delivery failures in the current operational window.
              </div>
            ) : (
              notificationOutbox?.recentFailures?.map((f: any) => (
                <div key={f.id} className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-200">{f.type} ({f.channel})</span>
                    <span className="px-2 py-0.5 rounded text-3xs font-extrabold bg-rose-500/20 text-rose-400 border border-rose-500/30">
                      {f.status} (Retry #{f.retryCount})
                    </span>
                  </div>
                  <p className="text-2xs text-rose-300 font-mono">
                    Last Error: {f.lastError}
                  </p>
                  <p className="text-3xs text-slate-500 font-mono">
                    Created: {formatIndianDateTime(f.createdAt)}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
