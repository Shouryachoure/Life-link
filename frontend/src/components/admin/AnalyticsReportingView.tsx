import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { getApiBaseUrl } from '../../config/apiConfig';
import {
  BarChart3,
  TrendingUp,
  Clock,
  ShieldCheck,
  Ambulance,
  Building,
  Calendar,
  Download,
  RefreshCw,
  FileSpreadsheet,
  AlertTriangle,
  CheckCircle2,
  Users,
  Activity,
  Layers,
  PhoneCall,
  Bell,
  EyeOff,
  Filter,
  CheckSquare
} from 'lucide-react';

interface DurationStat {
  sampleCount: number;
  averageMinutes: number | null;
  medianMinutes: number | null;
  minMinutes: number | null;
  maxMinutes: number | null;
  definition: string;
}

interface AnalyticsData {
  timeWindow: {
    startDate: string;
    endDate: string;
    timezone: string;
    isDemoIncluded: boolean;
  };
  organizationScope: {
    role: string;
    hospitalId: string | null;
    operatorId: string | null;
    isSuperAdmin: boolean;
  };
  emergencyRequests: {
    totalRequests: number;
    completionRatePercentage: number | null;
    unservedRatePercentage: number | null;
    statusCounts: Record<string, number>;
    dailyBreakdown: Record<string, { total: number; completed: number; cancelled: number; noAmbulance: number }>;
  };
  dispatchPerformance: {
    totalOffers: number;
    acceptedCount: number;
    rejectedCount: number;
    expiredCount: number;
    pendingCount: number;
    acceptanceRatePercentage: number | null;
    timeoutRatePercentage: number | null;
    rejectionRatePercentage: number | null;
  };
  lifecycleDurations: {
    requestToAssignmentMinutes: DurationStat;
    assignmentToArrivalMinutes: DurationStat;
    arrivalToPickupMinutes: DurationStat;
    pickupToCompletionMinutes: DurationStat;
    totalMissionMinutes: DurationStat;
    disclaimer: string;
  };
  unservedEmergencyDemand: {
    noEligibleAmbulanceCount: number;
    unservedPercentage: number | null;
    escalation112FallbackNotice: string;
  };
  fleetAvailability: {
    totalFleetSize: number;
    availableCount: number;
    dispatchedCount: number;
    availabilityPercentage: number | null;
    breakdownByOrganization: Array<{
      organizationType: 'HOSPITAL' | 'PRIVATE_OPERATOR';
      organizationId: string;
      organizationName: string;
      totalAmbulances: number;
      availableCount: number;
      dispatchedCount: number;
      availabilityPercentage: number | null;
    }>;
    breakdownByServiceArea: Array<{
      serviceAreaId: string;
      serviceAreaName: string;
      centerLat: number;
      centerLng: number;
      radiusKm: number;
      ambulancesInArea: number;
      availableInArea: number;
    }>;
  };
  gpsTrackingFreshness: {
    totalTrackedAmbulances: number;
    liveCount: number;
    staleCount: number;
    outageCount: number;
    trackingHealthPercentage: number | null;
    criteria: string;
    ambulances: Array<{
      id: string;
      vehicleNumber: string;
      type: string;
      organizationName: string;
      isAvailable: boolean;
      gpsFreshnessStatus: 'LIVE' | 'STALE' | 'OFFLINE_OUTAGE';
      lastSignalIso: string | null;
      signalAgeMinutes: number | null;
    }>;
  };
  hospitalCapacityFreshness: {
    totalHospitalsMonitored: number;
    freshCount: number;
    staleCount: number;
    outdatedCount: number;
    totalCapacityBeds: number;
    availableCapacityBeds: number;
    utilizationPercentage: number | null;
    criteria: string;
    hospitals: Array<{
      id: string;
      name: string;
      city: string;
      totalBeds: number;
      availableBeds: number;
      capacityFreshnessStatus: 'FRESH' | 'STALE' | 'OUTDATED';
      lastUpdatedIso: string | null;
      updateAgeHours: number | null;
    }>;
  };
  appointmentAndQueueMetrics: {
    appointments: {
      totalBookings: number;
      confirmedCount: number;
      completedCount: number;
      cancelledCount: number;
      cancellationRatePercentage: number | null;
    };
    queues: {
      activeWaitingPatients: number;
      averageWaitMinutes: number | null;
      longestWaitMinutes: number | null;
    };
  };
  notificationsHealth: {
    totalNotifications: number;
    sentCount: number;
    deliveredCount: number;
    failedCount: number;
    readCount: number;
    readRatePercentage: number | null;
  };
  organizationVerificationBacklog: {
    pendingHospitalsCount: number;
    pendingOperatorsCount: number;
    pendingDriversCount: number;
    totalPendingReview: number;
  };
}

interface AnalyticsReportingViewProps {
  scopedHospitalId?: string;
  scopedOperatorId?: string;
}

export const AnalyticsReportingView: React.FC<AnalyticsReportingViewProps> = ({
  scopedHospitalId,
  scopedOperatorId,
}) => {
  const { apiFetch, token } = useAuth();

  // Filter state
  const [datePreset, setDatePreset] = useState<'TODAY' | '7D' | '30D' | 'CUSTOM'>('30D');
  const [customStart, setCustomStart] = useState<string>(() => {
    const d = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    return d.toISOString().split('T')[0];
  });
  const [customEnd, setCustomEnd] = useState<string>(() => {
    return new Date().toISOString().split('T')[0];
  });
  const [includeDemo, setIncludeDemo] = useState<boolean>(false);

  // Data & loading state
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [exportingType, setExportingType] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  // Active section view
  const [activeReportTab, setActiveReportTab] = useState<
    'OVERVIEW' | 'LIFECYCLE' | 'FLEET_GPS' | 'CAPACITY' | 'OPD_QUEUES' | 'OPERATIONS'
  >('OVERVIEW');

  // Compute date strings from preset
  const getDateRangeParams = useCallback(() => {
    const now = new Date();
    let startDate = '';
    let endDate = now.toISOString().split('T')[0];

    if (datePreset === 'TODAY') {
      startDate = endDate;
    } else if (datePreset === '7D') {
      const past7 = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
      startDate = past7.toISOString().split('T')[0];
    } else if (datePreset === '30D') {
      const past30 = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
      startDate = past30.toISOString().split('T')[0];
    } else {
      startDate = customStart;
      endDate = customEnd;
    }

    return { startDate, endDate };
  }, [datePreset, customStart, customEnd]);

  // Fetch report data
  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { startDate, endDate } = getDateRangeParams();
      const query = new URLSearchParams({
        startDate,
        endDate,
        includeDemo: String(includeDemo),
      });

      if (scopedHospitalId) query.set('hospitalId', scopedHospitalId);
      if (scopedOperatorId) query.set('operatorId', scopedOperatorId);

      const res = await apiFetch(`/analytics/reports?${query.toString()}`);
      if (res && res.data) {
        setData(res.data);
      } else {
        setError('No analytics data received from reporting endpoint.');
      }
    } catch (err: any) {
      console.error('Error fetching analytics report:', err);
      setError(err?.message || 'Failed to fetch operational analytics.');
    } finally {
      setLoading(false);
    }
  }, [apiFetch, getDateRangeParams, includeDemo, scopedHospitalId, scopedOperatorId]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  // Export CSV handler with Bearer token authentication and safe blob download
  const handleExportCsv = async (exportType: string) => {
    setExportingType(exportType);
    setExportNotice(null);
    try {
      const { startDate, endDate } = getDateRangeParams();
      const query = new URLSearchParams({
        type: exportType,
        startDate,
        endDate,
        includeDemo: String(includeDemo),
      });

      if (scopedHospitalId) query.set('hospitalId', scopedHospitalId);
      if (scopedOperatorId) query.set('operatorId', scopedOperatorId);

      const apiUrl = getApiBaseUrl();
      const authToken = token || localStorage.getItem('lifelink_token');

      const response = await fetch(`${apiUrl}/analytics/export?${query.toString()}`, {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Export failed with HTTP status ${response.status}`);
      }

      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `lifelink_${exportType}_analytics_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);

      setExportNotice(`Exported ${exportType} CSV with spreadsheet formula injection protection.`);
      setTimeout(() => setExportNotice(null), 5000);
    } catch (err: any) {
      console.error('Error downloading CSV export:', err);
      setError(err?.message || 'CSV export failed.');
    } finally {
      setExportingType(null);
    }
  };

  // Helper to format minute durations
  const formatMins = (val: number | null | undefined): string => {
    if (val === null || val === undefined) return '—';
    return `${val} min`;
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Header */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-850 to-slate-900 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 border border-slate-800 rounded-3xl p-6 md:p-8 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-rose-600/10 rounded-full blur-3xl pointer-events-none" />
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="flex items-center gap-2.5 mb-2">
              <span className="px-3 py-1 rounded-full text-xs font-bold bg-rose-600/20 text-rose-400 border border-rose-500/30 flex items-center gap-1.5">
                <BarChart3 className="w-3.5 h-3.5" /> Operations Analytics & Reporting
              </span>
              <span className="px-2.5 py-1 rounded-full text-3xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                <ShieldCheck className="w-3 h-3" /> De-identified Aggregate
              </span>
              <span className="px-2.5 py-1 rounded-full text-3xs font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center gap-1">
                <EyeOff className="w-3 h-3" /> Zero PHI Exposed
              </span>
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
              Emergency Operations Intelligence
            </h1>
            <p className="text-sm text-slate-400 mt-1 max-w-2xl">
              Audited performance telemetry across dispatch acceptance, life-cycle turnaround milestones, GPS tracking freshness, and hospital bed availability.
            </p>
          </div>

          {/* Quick Actions & CSV Export Dropdown */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={fetchReport}
              disabled={loading}
              className="px-4 py-2.5 rounded-2xl bg-slate-800/80 hover:bg-slate-700 text-slate-200 text-xs font-bold flex items-center gap-2 border border-slate-700 transition cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>

            <div className="relative group">
              <button
                className="px-4 py-2.5 rounded-2xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold flex items-center gap-2 shadow-lg shadow-rose-600/20 transition cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                {exportingType ? 'Exporting...' : 'Export Safe CSV'}
              </button>
              <div className="absolute right-0 top-full mt-2 w-56 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-2 hidden group-hover:block z-50">
                <div className="text-3xs uppercase tracking-wider text-slate-400 px-3 py-1.5 font-bold">
                  Select Export Dataset
                </div>
                <button
                  onClick={() => handleExportCsv('summary')}
                  disabled={exportingType !== null}
                  className="w-full text-left px-3 py-2 rounded-xl text-xs text-slate-200 hover:bg-slate-800 flex items-center gap-2 cursor-pointer"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-rose-400" />
                  Executive Summary CSV
                </button>
                <button
                  onClick={() => handleExportCsv('emergency_requests')}
                  disabled={exportingType !== null}
                  className="w-full text-left px-3 py-2 rounded-xl text-xs text-slate-200 hover:bg-slate-800 flex items-center gap-2 cursor-pointer"
                >
                  <Activity className="w-3.5 h-3.5 text-blue-400" />
                  Emergency Requests Log
                </button>
                <button
                  onClick={() => handleExportCsv('dispatch_attempts')}
                  disabled={exportingType !== null}
                  className="w-full text-left px-3 py-2 rounded-xl text-xs text-slate-200 hover:bg-slate-800 flex items-center gap-2 cursor-pointer"
                >
                  <Clock className="w-3.5 h-3.5 text-amber-400" />
                  Dispatch Attempts & Timeouts
                </button>
                <button
                  onClick={() => handleExportCsv('fleet')}
                  disabled={exportingType !== null}
                  className="w-full text-left px-3 py-2 rounded-xl text-xs text-slate-200 hover:bg-slate-800 flex items-center gap-2 cursor-pointer"
                >
                  <Ambulance className="w-3.5 h-3.5 text-emerald-400" />
                  Ambulance Fleet & GPS Signals
                </button>
                <button
                  onClick={() => handleExportCsv('hospitals')}
                  disabled={exportingType !== null}
                  className="w-full text-left px-3 py-2 rounded-xl text-xs text-slate-200 hover:bg-slate-800 flex items-center gap-2 cursor-pointer"
                >
                  <Building className="w-3.5 h-3.5 text-indigo-400" />
                  Hospital Capacity & Freshness
                </button>
                <button
                  onClick={() => handleExportCsv('appointments')}
                  disabled={exportingType !== null}
                  className="w-full text-left px-3 py-2 rounded-xl text-xs text-slate-200 hover:bg-slate-800 flex items-center gap-2 cursor-pointer"
                >
                  <Calendar className="w-3.5 h-3.5 text-teal-400" />
                  OPD Appointments & Queues
                </button>
                <div className="border-t border-slate-800 mt-1 pt-1 px-3 py-1 text-3xs text-slate-400">
                  Protected against formula injection (CWE-1236)
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Filter Controls Bar */}
        <div className="mt-6 pt-6 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-400 mr-1 flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5" /> Window:
            </span>
            {(['TODAY', '7D', '30D', 'CUSTOM'] as const).map((preset) => (
              <button
                key={preset}
                onClick={() => setDatePreset(preset)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                  datePreset === preset
                    ? 'bg-rose-600 text-white shadow-md'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {preset === 'TODAY' ? 'Today' : preset === '7D' ? 'Last 7 Days' : preset === '30D' ? 'Last 30 Days' : 'Custom'}
              </button>
            ))}

            {datePreset === 'CUSTOM' && (
              <div className="flex items-center gap-2 ml-2 bg-slate-800/90 border border-slate-700 px-3 py-1 rounded-xl">
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="bg-transparent text-xs text-slate-200 outline-none"
                />
                <span className="text-slate-500 text-xs">to</span>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="bg-transparent text-xs text-slate-200 outline-none"
                />
              </div>
            )}
          </div>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={includeDemo}
                onChange={(e) => setIncludeDemo(e.target.checked)}
                className="rounded border-slate-700 text-rose-600 focus:ring-rose-500"
              />
              <span>Include Demo/Test Records</span>
            </label>
          </div>
        </div>
      </div>

      {/* Success Notification Banner for Export */}
      {exportNotice && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 px-4 py-3 rounded-2xl flex items-center justify-between text-xs animate-in fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>{exportNotice}</span>
          </div>
          <button onClick={() => setExportNotice(null)} className="text-slate-400 hover:text-white">✕</button>
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 text-rose-300 px-4 py-3 rounded-2xl flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-slate-400 hover:text-white">✕</button>
        </div>
      )}

      {/* Navigation Sub-Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 border-b border-slate-800">
        {[
          { id: 'OVERVIEW', label: 'Executive Overview', icon: BarChart3 },
          { id: 'LIFECYCLE', label: 'Turnaround SLAs', icon: Clock },
          { id: 'FLEET_GPS', label: 'Fleet & GPS Health', icon: Ambulance },
          { id: 'CAPACITY', label: 'Hospital Beds & Freshness', icon: Building },
          { id: 'OPD_QUEUES', label: 'OPD & Queues', icon: Users },
          { id: 'OPERATIONS', label: 'Backlog & Notifications', icon: ShieldCheck },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeReportTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveReportTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-bold whitespace-nowrap transition cursor-pointer ${
                isActive
                  ? 'bg-rose-600 text-white shadow-md shadow-rose-600/20'
                  : 'bg-slate-900/60 hover:bg-slate-850 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {loading && !data ? (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-12 text-center">
          <RefreshCw className="w-8 h-8 text-rose-500 animate-spin mx-auto mb-3" />
          <p className="text-slate-300 font-semibold text-sm">Aggregating emergency operations data...</p>
          <p className="text-slate-500 text-xs mt-1">Evaluating persisted operational timestamps and tenant boundaries</p>
        </div>
      ) : !data ? (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-12 text-center">
          <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-3" />
          <p className="text-slate-300 font-semibold text-sm">No analytics available</p>
          <p className="text-slate-500 text-xs mt-1">Please check your filter parameters or network connection.</p>
        </div>
      ) : (
        <>
          {/* TAB 1: EXECUTIVE OVERVIEW */}
          {(activeReportTab === 'OVERVIEW' || activeReportTab === 'LIFECYCLE') && (
            <div className="space-y-6">
              {/* Top Summary Stat Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* 1. Total Requests & Completion */}
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg">
                  <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
                    <span>Emergency Requests</span>
                    <Activity className="w-4 h-4 text-rose-400" />
                  </div>
                  <div className="mt-3 flex items-baseline gap-2">
                    <span className="text-3xl font-extrabold text-white">
                      {data.emergencyRequests.totalRequests}
                    </span>
                    <span className="text-xs font-semibold text-slate-400">total in window</span>
                  </div>
                  <div className="mt-2 text-xs flex items-center justify-between">
                    <span className="text-slate-400">Completion Rate:</span>
                    <span className="font-bold text-emerald-400">
                      {data.emergencyRequests.completionRatePercentage !== null ? `${data.emergencyRequests.completionRatePercentage}%` : '—'}
                    </span>
                  </div>
                  <div className="mt-1 text-xs flex items-center justify-between">
                    <span className="text-slate-400">Unserved Demand:</span>
                    <span className="font-bold text-amber-400">
                      {data.unservedEmergencyDemand.noEligibleAmbulanceCount} requests ({data.unservedEmergencyDemand.unservedPercentage !== null ? `${data.unservedEmergencyDemand.unservedPercentage}%` : '—'})
                    </span>
                  </div>
                </div>

                {/* 2. Dispatch Acceptance & Timeout Rates */}
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg">
                  <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
                    <span>Dispatch Response</span>
                    <Clock className="w-4 h-4 text-blue-400" />
                  </div>
                  <div className="mt-3 flex items-baseline gap-2">
                    <span className="text-3xl font-extrabold text-white">
                      {data.dispatchPerformance.acceptanceRatePercentage !== null ? `${data.dispatchPerformance.acceptanceRatePercentage}%` : '—'}
                    </span>
                    <span className="text-xs font-semibold text-slate-400">acceptance</span>
                  </div>
                  <div className="mt-2 text-xs flex items-center justify-between">
                    <span className="text-slate-400">Driver Timeout Rate:</span>
                    <span className="font-bold text-rose-400">
                      {data.dispatchPerformance.timeoutRatePercentage !== null ? `${data.dispatchPerformance.timeoutRatePercentage}%` : '—'}
                    </span>
                  </div>
                  <div className="mt-1 text-xs flex items-center justify-between">
                    <span className="text-slate-400">Total Dispatch Offers:</span>
                    <span className="font-bold text-slate-200">
                      {data.dispatchPerformance.totalOffers} offers
                    </span>
                  </div>
                </div>

                {/* 3. Turnaround SLA - Request to Assignment */}
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg">
                  <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
                    <span>Response Time (Req → Accept)</span>
                    <TrendingUp className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div className="mt-3 flex items-baseline gap-2">
                    <span className="text-3xl font-extrabold text-white">
                      {formatMins(data.lifecycleDurations.requestToAssignmentMinutes.medianMinutes)}
                    </span>
                    <span className="text-xs font-semibold text-slate-400">median</span>
                  </div>
                  <div className="mt-2 text-xs flex items-center justify-between">
                    <span className="text-slate-400">Average:</span>
                    <span className="font-bold text-slate-200">
                      {formatMins(data.lifecycleDurations.requestToAssignmentMinutes.averageMinutes)}
                    </span>
                  </div>
                  <div className="mt-1 text-xs flex items-center justify-between">
                    <span className="text-slate-400">Sample Count:</span>
                    <span className="font-bold text-slate-200">
                      {data.lifecycleDurations.requestToAssignmentMinutes.sampleCount} recorded
                    </span>
                  </div>
                </div>

                {/* 4. Total Mission Turnaround */}
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg">
                  <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
                    <span>Total Mission Turnaround</span>
                    <ShieldCheck className="w-4 h-4 text-purple-400" />
                  </div>
                  <div className="mt-3 flex items-baseline gap-2">
                    <span className="text-3xl font-extrabold text-white">
                      {formatMins(data.lifecycleDurations.totalMissionMinutes.medianMinutes)}
                    </span>
                    <span className="text-xs font-semibold text-slate-400">median total</span>
                  </div>
                  <div className="mt-2 text-xs flex items-center justify-between">
                    <span className="text-slate-400">Average Turnaround:</span>
                    <span className="font-bold text-slate-200">
                      {formatMins(data.lifecycleDurations.totalMissionMinutes.averageMinutes)}
                    </span>
                  </div>
                  <div className="mt-1 text-xs flex items-center justify-between">
                    <span className="text-slate-400">Sample Count:</span>
                    <span className="font-bold text-slate-200">
                      {data.lifecycleDurations.totalMissionMinutes.sampleCount} completed
                    </span>
                  </div>
                </div>
              </div>

              {/* REPORT 3: Lifecycle Durations & Turnaround Milestones Table */}
              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                  <div>
                    <h2 className="text-lg font-bold text-white flex items-center gap-2">
                      <Clock className="w-5 h-5 text-rose-500" />
                      Lifecycle Durations & Turnaround Milestones
                    </h2>
                    <p className="text-xs text-slate-400 mt-1">
                      {data.lifecycleDurations.disclaimer}
                    </p>
                  </div>
                  <span className="text-3xs font-semibold px-3 py-1 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                    Distinguishes Missing Data from Zero (— = No recorded samples)
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 font-bold uppercase tracking-wider text-3xs">
                        <th className="pb-3 px-3">Lifecycle Milestone Stage</th>
                        <th className="pb-3 px-3">Persisted Operational Definition</th>
                        <th className="pb-3 px-3 text-center">Sample Count</th>
                        <th className="pb-3 px-3 text-right">Avg (min)</th>
                        <th className="pb-3 px-3 text-right">Median (min)</th>
                        <th className="pb-3 px-3 text-right">Min (min)</th>
                        <th className="pb-3 px-3 text-right">Max (min)</th>
                        <th className="pb-3 px-3 text-center">SLA Benchmark</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-medium text-slate-200">
                      {[
                        {
                          stage: '1. Request → Assignment',
                          data: data.lifecycleDurations.requestToAssignmentMinutes,
                          benchmark: '< 3.0 min',
                          color: 'text-blue-400',
                        },
                        {
                          stage: '2. Assignment → Scene Arrival',
                          data: data.lifecycleDurations.assignmentToArrivalMinutes,
                          benchmark: '< 10.0 min',
                          color: 'text-amber-400',
                        },
                        {
                          stage: '3. Scene Arrival → Patient Pickup',
                          data: data.lifecycleDurations.arrivalToPickupMinutes,
                          benchmark: '< 8.0 min',
                          color: 'text-teal-400',
                        },
                        {
                          stage: '4. Pickup → Completion / Transfer',
                          data: data.lifecycleDurations.pickupToCompletionMinutes,
                          benchmark: '< 20.0 min',
                          color: 'text-indigo-400',
                        },
                        {
                          stage: 'Total Mission Turnaround',
                          data: data.lifecycleDurations.totalMissionMinutes,
                          benchmark: '< 35.0 min',
                          color: 'text-purple-400 font-bold',
                        },
                      ].map((row, idx) => (
                        <tr key={idx} className="hover:bg-slate-850/50 transition">
                          <td className={`py-3.5 px-3 font-semibold ${row.color}`}>
                            {row.stage}
                          </td>
                          <td className="py-3.5 px-3 text-slate-400 text-3xs max-w-xs">
                            {row.data.definition}
                          </td>
                          <td className="py-3.5 px-3 text-center">
                            <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-bold">
                              {row.data.sampleCount}
                            </span>
                          </td>
                          <td className="py-3.5 px-3 text-right font-mono font-semibold">
                            {row.data.averageMinutes !== null ? `${row.data.averageMinutes}` : '—'}
                          </td>
                          <td className="py-3.5 px-3 text-right font-mono font-semibold text-rose-300">
                            {row.data.medianMinutes !== null ? `${row.data.medianMinutes}` : '—'}
                          </td>
                          <td className="py-3.5 px-3 text-right font-mono text-slate-400">
                            {row.data.minMinutes !== null ? `${row.data.minMinutes}` : '—'}
                          </td>
                          <td className="py-3.5 px-3 text-right font-mono text-slate-400">
                            {row.data.maxMinutes !== null ? `${row.data.maxMinutes}` : '—'}
                          </td>
                          <td className="py-3.5 px-3 text-center">
                            <span className="px-2.5 py-1 rounded-xl bg-slate-800 text-slate-400 text-3xs font-semibold">
                              {row.benchmark}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* REPORT 1 & 2: Requests & Dispatch Performance Breakdown */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Emergency Requests by Status */}
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl">
                  <h3 className="text-sm font-bold text-white flex items-center justify-between mb-4">
                    <span className="flex items-center gap-2">
                      <Activity className="w-4 h-4 text-rose-500" />
                      Emergency Requests by Operational Status
                    </span>
                    <span className="text-xs text-slate-400">
                      Total: {data.emergencyRequests.totalRequests}
                    </span>
                  </h3>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    {Object.entries(data.emergencyRequests.statusCounts).map(([status, count]) => {
                      if (count === 0) return null;
                      return (
                        <div
                          key={status}
                          className="bg-slate-850 border border-slate-800 rounded-2xl p-3 flex flex-col justify-between"
                        >
                          <span className="text-3xs uppercase tracking-wider text-slate-400 font-bold truncate">
                            {status.replace(/_/g, ' ')}
                          </span>
                          <span className="text-lg font-extrabold text-white mt-1">
                            {count}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Fallback notice for unserved */}
                  {data.unservedEmergencyDemand.noEligibleAmbulanceCount > 0 && (
                    <div className="mt-4 p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      <span>{data.unservedEmergencyDemand.escalation112FallbackNotice}</span>
                    </div>
                  )}
                </div>

                {/* Dispatch Acceptance vs Timeouts */}
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl">
                  <h3 className="text-sm font-bold text-white flex items-center justify-between mb-4">
                    <span className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-blue-500" />
                      Driver Dispatch Acceptance & Timeouts
                    </span>
                    <span className="text-xs text-slate-400">
                      Total Offers: {data.dispatchPerformance.totalOffers}
                    </span>
                  </h3>

                  <div className="space-y-4">
                    <div>
                      <div className="flex justify-between text-xs font-semibold mb-1">
                        <span className="text-slate-300">Accepted by Driver</span>
                        <span className="text-emerald-400 font-bold">
                          {data.dispatchPerformance.acceptedCount} ({data.dispatchPerformance.acceptanceRatePercentage !== null ? `${data.dispatchPerformance.acceptanceRatePercentage}%` : '—'})
                        </span>
                      </div>
                      <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden">
                        <div
                          className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                          style={{ width: `${data.dispatchPerformance.acceptanceRatePercentage || 0}%` }}
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-xs font-semibold mb-1">
                        <span className="text-slate-300">Offer Timed Out (Expired)</span>
                        <span className="text-rose-400 font-bold">
                          {data.dispatchPerformance.expiredCount} ({data.dispatchPerformance.timeoutRatePercentage !== null ? `${data.dispatchPerformance.timeoutRatePercentage}%` : '—'})
                        </span>
                      </div>
                      <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden">
                        <div
                          className="bg-rose-500 h-full rounded-full transition-all duration-500"
                          style={{ width: `${data.dispatchPerformance.timeoutRatePercentage || 0}%` }}
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-xs font-semibold mb-1">
                        <span className="text-slate-300">Rejected by Driver</span>
                        <span className="text-amber-400 font-bold">
                          {data.dispatchPerformance.rejectedCount} ({data.dispatchPerformance.rejectionRatePercentage !== null ? `${data.dispatchPerformance.rejectionRatePercentage}%` : '—'})
                        </span>
                      </div>
                      <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden">
                        <div
                          className="bg-amber-500 h-full rounded-full transition-all duration-500"
                          style={{ width: `${data.dispatchPerformance.rejectionRatePercentage || 0}%` }}
                        />
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-3xs text-slate-400">
                      <span>Live Offers Pending Response: {data.dispatchPerformance.pendingCount}</span>
                      <span className="font-semibold text-rose-400">No Coverage Guarantee Warning active</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: FLEET AVAILABILITY & GPS TRACKING FRESHNESS */}
          {activeReportTab === 'FLEET_GPS' && (
            <div className="space-y-6">
              {/* GPS Freshness Overview Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg">
                  <span className="text-xs font-semibold text-slate-400">Tracked Fleet</span>
                  <div className="text-2xl font-extrabold text-white mt-1">
                    {data.gpsTrackingFreshness.totalTrackedAmbulances}
                  </div>
                  <span className="text-3xs text-slate-400">ambulances in system</span>
                </div>
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg">
                  <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> Live Signals (&lt;2 min)
                  </span>
                  <div className="text-2xl font-extrabold text-emerald-400 mt-1">
                    {data.gpsTrackingFreshness.liveCount}
                  </div>
                  <span className="text-3xs text-slate-400">actively broadcasting</span>
                </div>
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg">
                  <span className="text-xs font-semibold text-amber-400 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-amber-500" /> Stale (2–5 min)
                  </span>
                  <div className="text-2xl font-extrabold text-amber-400 mt-1">
                    {data.gpsTrackingFreshness.staleCount}
                  </div>
                  <span className="text-3xs text-slate-400">delayed telemetry</span>
                </div>
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg">
                  <span className="text-xs font-semibold text-rose-400 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-rose-500" /> Tracking Outage (&gt;5 min)
                  </span>
                  <div className="text-2xl font-extrabold text-rose-400 mt-1">
                    {data.gpsTrackingFreshness.outageCount}
                  </div>
                  <span className="text-3xs text-slate-400">unresponsive vehicle</span>
                </div>
              </div>

              {/* Fleet Availability by Organization & Service Area */}
              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl">
                <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-4">
                  <Building className="w-4 h-4 text-rose-500" />
                  Fleet Availability Breakdown by Organization
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 font-bold uppercase tracking-wider text-3xs">
                        <th className="pb-3 px-3">Organization Name</th>
                        <th className="pb-3 px-3">Type</th>
                        <th className="pb-3 px-3 text-center">Total Vehicles</th>
                        <th className="pb-3 px-3 text-center">Available</th>
                        <th className="pb-3 px-3 text-center">Dispatched</th>
                        <th className="pb-3 px-3 text-right">Availability Rate</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-medium text-slate-200">
                      {data.fleetAvailability.breakdownByOrganization.map((org, idx) => (
                        <tr key={idx} className="hover:bg-slate-850/50">
                          <td className="py-3 px-3 font-semibold text-slate-100">{org.organizationName}</td>
                          <td className="py-3 px-3">
                            <span className={`px-2 py-0.5 rounded-full text-3xs font-bold ${
                              org.organizationType === 'HOSPITAL'
                                ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                                : 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                            }`}>
                              {org.organizationType === 'HOSPITAL' ? 'Hospital' : 'Private Operator'}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-center font-bold">{org.totalAmbulances}</td>
                          <td className="py-3 px-3 text-center text-emerald-400 font-bold">{org.availableCount}</td>
                          <td className="py-3 px-3 text-center text-amber-400 font-bold">{org.dispatchedCount}</td>
                          <td className="py-3 px-3 text-right font-mono font-bold text-rose-400">
                            {org.availabilityPercentage !== null ? `${org.availabilityPercentage}%` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Individual Ambulances GPS Signal Table */}
              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl">
                <h3 className="text-sm font-bold text-white flex items-center justify-between mb-4">
                  <span className="flex items-center gap-2">
                    <Ambulance className="w-4 h-4 text-emerald-500" />
                    Ambulance Telemetry & Signal Age Log
                  </span>
                  <span className="text-3xs text-slate-400">
                    Freshness criteria: Live (&lt;2m) | Stale (2-5m) | Outage (&gt;5m)
                  </span>
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 font-bold uppercase tracking-wider text-3xs">
                        <th className="pb-3 px-3">Vehicle Number</th>
                        <th className="pb-3 px-3">Type</th>
                        <th className="pb-3 px-3">Managing Organization</th>
                        <th className="pb-3 px-3 text-center">Dispatch Status</th>
                        <th className="pb-3 px-3 text-center">GPS Freshness</th>
                        <th className="pb-3 px-3 text-right">Signal Age</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-medium text-slate-200">
                      {data.gpsTrackingFreshness.ambulances.map((amb) => (
                        <tr key={amb.id} className="hover:bg-slate-850/50">
                          <td className="py-3 px-3 font-mono font-bold text-slate-100">{amb.vehicleNumber}</td>
                          <td className="py-3 px-3 text-slate-400 text-3xs">{amb.type.replace(/_/g, ' ')}</td>
                          <td className="py-3 px-3 text-slate-300">{amb.organizationName}</td>
                          <td className="py-3 px-3 text-center">
                            <span className={`px-2 py-0.5 rounded-full text-3xs font-bold ${
                              amb.isAvailable
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                            }`}>
                              {amb.isAvailable ? 'AVAILABLE' : 'DISPATCHED'}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-center">
                            <span className={`px-2.5 py-0.5 rounded-full text-3xs font-bold ${
                              amb.gpsFreshnessStatus === 'LIVE'
                                ? 'bg-emerald-500/20 text-emerald-400'
                                : amb.gpsFreshnessStatus === 'STALE'
                                ? 'bg-amber-500/20 text-amber-400'
                                : 'bg-rose-500/20 text-rose-400'
                            }`}>
                              {amb.gpsFreshnessStatus.replace(/_/g, ' ')}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-right font-mono text-slate-400">
                            {amb.signalAgeMinutes !== null ? `${amb.signalAgeMinutes} min ago` : 'Never'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: HOSPITAL BEDS & CAPACITY FRESHNESS */}
          {activeReportTab === 'CAPACITY' && (
            <div className="space-y-6">
              {/* Capacity Overview Stats */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg">
                  <span className="text-xs font-semibold text-slate-400">Total Monitored Beds</span>
                  <div className="text-2xl font-extrabold text-white mt-1">
                    {data.hospitalCapacityFreshness.totalCapacityBeds}
                  </div>
                  <span className="text-3xs text-slate-400">
                    {data.hospitalCapacityFreshness.availableCapacityBeds} currently vacant
                  </span>
                </div>
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg">
                  <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Fresh Updates (&lt;1 hour)
                  </span>
                  <div className="text-2xl font-extrabold text-emerald-400 mt-1">
                    {data.hospitalCapacityFreshness.freshCount}
                  </div>
                  <span className="text-3xs text-slate-400">reliable bed state</span>
                </div>
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg">
                  <span className="text-xs font-semibold text-amber-400 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" /> Stale (1–6 hours)
                  </span>
                  <div className="text-2xl font-extrabold text-amber-400 mt-1">
                    {data.hospitalCapacityFreshness.staleCount}
                  </div>
                  <span className="text-3xs text-slate-400">needs confirmation</span>
                </div>
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg">
                  <span className="text-xs font-semibold text-rose-400 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" /> Outdated (&gt;6 hours)
                  </span>
                  <div className="text-2xl font-extrabold text-rose-400 mt-1">
                    {data.hospitalCapacityFreshness.outdatedCount}
                  </div>
                  <span className="text-3xs text-slate-400">unverified status</span>
                </div>
              </div>

              {/* Hospital Capacities Table */}
              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl">
                <h3 className="text-sm font-bold text-white flex items-center justify-between mb-4">
                  <span className="flex items-center gap-2">
                    <Building className="w-4 h-4 text-rose-500" />
                    Hospital Bed Capacity & Update Freshness Status
                  </span>
                  <span className="text-3xs text-slate-400">
                    Never assumes admission without formal confirmation
                  </span>
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 font-bold uppercase tracking-wider text-3xs">
                        <th className="pb-3 px-3">Hospital Partner</th>
                        <th className="pb-3 px-3">City</th>
                        <th className="pb-3 px-3 text-center">Total Beds</th>
                        <th className="pb-3 px-3 text-center">Available Beds</th>
                        <th className="pb-3 px-3 text-center">Update Freshness</th>
                        <th className="pb-3 px-3 text-right">Last Verified</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-medium text-slate-200">
                      {data.hospitalCapacityFreshness.hospitals.map((hosp) => (
                        <tr key={hosp.id} className="hover:bg-slate-850/50">
                          <td className="py-3 px-3 font-semibold text-slate-100">{hosp.name}</td>
                          <td className="py-3 px-3 text-slate-400">{hosp.city}</td>
                          <td className="py-3 px-3 text-center font-bold">{hosp.totalBeds}</td>
                          <td className="py-3 px-3 text-center font-bold text-emerald-400">{hosp.availableBeds}</td>
                          <td className="py-3 px-3 text-center">
                            <span className={`px-2.5 py-0.5 rounded-full text-3xs font-bold ${
                              hosp.capacityFreshnessStatus === 'FRESH'
                                ? 'bg-emerald-500/20 text-emerald-400'
                                : hosp.capacityFreshnessStatus === 'STALE'
                                ? 'bg-amber-500/20 text-amber-400'
                                : 'bg-rose-500/20 text-rose-400'
                            }`}>
                              {hosp.capacityFreshnessStatus}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-right font-mono text-slate-400">
                            {hosp.updateAgeHours !== null ? `${hosp.updateAgeHours} hrs ago` : 'Never'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: OPD APPOINTMENTS & CLINICAL QUEUES */}
          {activeReportTab === 'OPD_QUEUES' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg">
                  <span className="text-xs font-semibold text-slate-400">Total Bookings</span>
                  <div className="text-2xl font-extrabold text-white mt-1">
                    {data.appointmentAndQueueMetrics.appointments.totalBookings}
                  </div>
                  <span className="text-3xs text-slate-400">in selected date window</span>
                </div>
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg">
                  <span className="text-xs font-semibold text-rose-400">Cancellation Rate</span>
                  <div className="text-2xl font-extrabold text-rose-400 mt-1">
                    {data.appointmentAndQueueMetrics.appointments.cancellationRatePercentage !== null
                      ? `${data.appointmentAndQueueMetrics.appointments.cancellationRatePercentage}%`
                      : '—'}
                  </div>
                  <span className="text-3xs text-slate-400">
                    {data.appointmentAndQueueMetrics.appointments.cancelledCount} cancelled bookings
                  </span>
                </div>
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg">
                  <span className="text-xs font-semibold text-teal-400">Active Queue Patients</span>
                  <div className="text-2xl font-extrabold text-teal-400 mt-1">
                    {data.appointmentAndQueueMetrics.queues.activeWaitingPatients}
                  </div>
                  <span className="text-3xs text-slate-400">currently waiting</span>
                </div>
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg">
                  <span className="text-xs font-semibold text-amber-400">Average Wait Time</span>
                  <div className="text-2xl font-extrabold text-amber-400 mt-1">
                    {formatMins(data.appointmentAndQueueMetrics.queues.averageWaitMinutes)}
                  </div>
                  <span className="text-3xs text-slate-400">
                    Max: {formatMins(data.appointmentAndQueueMetrics.queues.longestWaitMinutes)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: BACKLOG & NOTIFICATIONS */}
          {activeReportTab === 'OPERATIONS' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Organization Verification Backlog */}
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl">
                  <h3 className="text-sm font-bold text-white flex items-center justify-between mb-4">
                    <span className="flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-rose-500" />
                      Organization Verification Backlog
                    </span>
                    <span className="text-xs font-bold text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded-full border border-amber-500/20">
                      {data.organizationVerificationBacklog.totalPendingReview} Pending Review
                    </span>
                  </h3>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-850 border border-slate-800">
                      <div className="flex items-center gap-3">
                        <Building className="w-4 h-4 text-blue-400" />
                        <span className="text-xs font-semibold text-slate-200">Hospital Partner Applications</span>
                      </div>
                      <span className="font-extrabold text-white text-sm">
                        {data.organizationVerificationBacklog.pendingHospitalsCount}
                      </span>
                    </div>

                    <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-850 border border-slate-800">
                      <div className="flex items-center gap-3">
                        <Ambulance className="w-4 h-4 text-purple-400" />
                        <span className="text-xs font-semibold text-slate-200">Ambulance Operators Pending</span>
                      </div>
                      <span className="font-extrabold text-white text-sm">
                        {data.organizationVerificationBacklog.pendingOperatorsCount}
                      </span>
                    </div>

                    <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-850 border border-slate-800">
                      <div className="flex items-center gap-3">
                        <Users className="w-4 h-4 text-teal-400" />
                        <span className="text-xs font-semibold text-slate-200">Driver Licenses Pending Approval</span>
                      </div>
                      <span className="font-extrabold text-white text-sm">
                        {data.organizationVerificationBacklog.pendingDriversCount}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Notifications Engine Health */}
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl">
                  <h3 className="text-sm font-bold text-white flex items-center justify-between mb-4">
                    <span className="flex items-center gap-2">
                      <Bell className="w-4 h-4 text-blue-500" />
                      Alert & Notification Health
                    </span>
                    <span className="text-xs text-slate-400">
                      Total: {data.notificationsHealth.totalNotifications}
                    </span>
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 rounded-2xl bg-slate-850 border border-slate-800">
                      <span className="text-3xs text-slate-400 font-semibold uppercase">Delivered</span>
                      <div className="text-xl font-extrabold text-emerald-400 mt-1">
                        {data.notificationsHealth.deliveredCount}
                      </div>
                    </div>
                    <div className="p-3 rounded-2xl bg-slate-850 border border-slate-800">
                      <span className="text-3xs text-slate-400 font-semibold uppercase">Pending Dispatch</span>
                      <div className="text-xl font-extrabold text-amber-400 mt-1">
                        {data.notificationsHealth.sentCount}
                      </div>
                    </div>
                    <div className="p-3 rounded-2xl bg-slate-850 border border-slate-800">
                      <span className="text-3xs text-slate-400 font-semibold uppercase">Delivery Failures</span>
                      <div className="text-xl font-extrabold text-rose-400 mt-1">
                        {data.notificationsHealth.failedCount}
                      </div>
                    </div>
                    <div className="p-3 rounded-2xl bg-slate-850 border border-slate-800">
                      <span className="text-3xs text-slate-400 font-semibold uppercase">Read Rate</span>
                      <div className="text-xl font-extrabold text-indigo-400 mt-1">
                        {data.notificationsHealth.readRatePercentage !== null
                          ? `${data.notificationsHealth.readRatePercentage}%`
                          : '—'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
