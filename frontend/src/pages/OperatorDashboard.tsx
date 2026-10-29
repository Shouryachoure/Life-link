import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { ThemeToggle } from '../components/ui/ThemeToggle';
import { HeartbeatLoader } from '../components/ui/HeartbeatLoader';
import {
  Truck,
  Users,
  ShieldCheck,
  AlertTriangle,
  Clock,
  MapPin,
  Phone,
  CheckCircle2,
  RefreshCw,
  LogOut,
  Building2,
  Activity,
  FileText,
  BadgeAlert
} from 'lucide-react';
import { ConfirmationModal } from '../components/ui/ConfirmationModal';
import { formatIndianPhone, formatIndianDateTime } from '../utils/localization';

export const OperatorDashboard: React.FC = () => {
  const { user, logout, apiFetch } = useAuth();
  const { socket } = useSocket();

  const [loading, setLoading] = useState(true);
  const [operatorData, setOperatorData] = useState<any>(null);
  const [ambulances, setAmbulances] = useState<any[]>([]);
  const [activeRequests, setActiveRequests] = useState<any[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [vehicleToOffline, setVehicleToOffline] = useState<{ id: string; vehicleNumber: string } | null>(null);
  const [isTogglingAvailability, setIsTogglingAvailability] = useState(false);

  const fetchFleetData = async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const data = await apiFetch('/sos/fleet/operator');
      setOperatorData(data.operator);
      setAmbulances(data.ambulances || []);
      setActiveRequests(data.activeRequests || []);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to load operator fleet');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFleetData();
  }, []);

  // Real-time socket listeners
  useEffect(() => {
    if (!socket || !operatorData?.id) return;

    const handleUpdate = () => {
      fetchFleetData();
    };

    socket.on('dispatch:accepted', handleUpdate);
    socket.on('trip:status_changed', handleUpdate);
    socket.on('emergency:cancelled', handleUpdate);

    return () => {
      socket.off('dispatch:accepted', handleUpdate);
      socket.off('trip:status_changed', handleUpdate);
      socket.off('emergency:cancelled', handleUpdate);
    };
  }, [socket, operatorData?.id]);

  const handleToggleClick = (amb: any) => {
    if (amb.isAvailable) {
      setVehicleToOffline({ id: amb.id, vehicleNumber: amb.vehicleNumber });
    } else {
      executeToggleAvailability(amb.id, false);
    }
  };

  const executeToggleAvailability = async (ambulanceId: string, currentStatus: boolean) => {
    setIsTogglingAvailability(true);
    setErrorMsg('');
    try {
      await apiFetch(`/ambulances/${ambulanceId}`, {
        method: 'PATCH',
        body: JSON.stringify({ isAvailable: !currentStatus }),
      });
      await fetchFleetData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to update vehicle availability');
    } finally {
      setIsTogglingAvailability(false);
      setVehicleToOffline(null);
    }
  };

  if (loading && !operatorData) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
        <HeartbeatLoader size="large" />
      </div>
    );
  }

  const isVerified = operatorData?.verificationState === 'VERIFIED';

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 transition-colors">
      {/* Header */}
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 sticky top-0 z-30 px-6 py-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-600 rounded-lg text-white">
            <Building2 className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight">{operatorData?.name || 'Private Ambulance Fleet'}</h1>
              <span className="px-2 py-0.5 text-xs font-semibold rounded bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                PRIVATE OPERATOR
              </span>
              {operatorData?.isDemo && (
                <span className="px-2 py-0.5 text-xs font-bold rounded bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300 border border-amber-300">
                  DEMO SIMULATION
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {operatorData?.city || 'Nagpur'}, {operatorData?.state || 'Maharashtra'} • License: {operatorData?.tradeLicense || 'Pending'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={fetchFleetData}
            className="p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
            title="Refresh Fleet Data"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
          <ThemeToggle />
          <button
            onClick={logout}
            className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors border border-rose-200 dark:border-rose-900/60"
          >
            <LogOut className="w-4 h-4" />
            <span>Logout</span>
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {errorMsg && (
          <div role="alert" className="alert-banner alert-danger">
            <AlertTriangle className="w-5 h-5 flex-shrink-0" />
            <div className="flex-1 text-sm font-medium">{errorMsg}</div>
            <button
              onClick={() => setErrorMsg('')}
              className="text-xs font-bold underline hover:no-underline"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Verification Status Banner */}
        {!isVerified ? (
          <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 flex items-start gap-4">
            <AlertTriangle className="w-6 h-6 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <h2 className="text-base font-bold text-amber-900 dark:text-amber-200">
                Organization Verification Status: {operatorData?.verificationState || 'PENDING_REVIEW'}
              </h2>
              <p className="text-sm text-amber-800 dark:text-amber-300 mt-1">
                Your private ambulance operator profile has not yet been verified by LifeLink compliance administrators. Under Nagpur Pilot operating rules, ambulances belonging to unverified operators are strictly excluded from receiving live emergency dispatch offers.
              </p>
              <div className="mt-3 text-xs font-semibold text-amber-900 dark:text-amber-200">
                Required action: Submit trade license and GST documents to compliance verification staff for review.
              </div>
            </div>
          </div>
        ) : (
          <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ShieldCheck className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
              <div>
                <h2 className="text-sm font-bold text-emerald-900 dark:text-emerald-200">
                  Verified Private Operator Fleet (Nagpur Pilot)
                </h2>
                <p className="text-xs text-emerald-800 dark:text-emerald-300">
                  Eligible for emergency dispatch in Nagpur metropolitan zone. Available units participate in candidate ranking.
                </p>
              </div>
            </div>
            <span className="px-3 py-1 text-xs font-bold rounded-full bg-emerald-600 text-white">
              ACTIVE PROVIDER
            </span>
          </div>
        )}

        {/* Fleet KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="p-5 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
            <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
              <span className="text-xs font-bold uppercase tracking-wider">Total Fleet</span>
              <Truck className="w-5 h-5 text-indigo-500" />
            </div>
            <div className="text-2xl font-black">{ambulances.length}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">Registered vehicles</div>
          </div>

          <div className="p-5 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
            <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
              <span className="text-xs font-bold uppercase tracking-wider">Available Online</span>
              <Activity className="w-5 h-5 text-emerald-500" />
            </div>
            <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400">
              {ambulances.filter((a) => a.isAvailable).length}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">Ready for dispatch</div>
          </div>

          <div className="p-5 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
            <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
              <span className="text-xs font-bold uppercase tracking-wider">Assigned Drivers</span>
              <Users className="w-5 h-5 text-sky-500" />
            </div>
            <div className="text-2xl font-black">
              {ambulances.filter((a) => a.driverId).length}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">Drivers on duty</div>
          </div>

          <div className="p-5 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
            <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
              <span className="text-xs font-bold uppercase tracking-wider">Active Dispatches</span>
              <Clock className="w-5 h-5 text-amber-500" />
            </div>
            <div className="text-2xl font-black text-amber-600 dark:text-amber-400">
              {activeRequests.length}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">Trips in progress</div>
          </div>
        </div>

        {/* Fleet Inventory Table */}
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold">Ambulance Fleet Inventory</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Manage operational status, vehicle assignments, and driver availability
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 text-xs uppercase font-bold tracking-wider">
                <tr>
                  <th className="px-6 py-3">Vehicle</th>
                  <th className="px-6 py-3">Service Tier</th>
                  <th className="px-6 py-3">Assigned Driver</th>
                  <th className="px-6 py-3">Verification</th>
                  <th className="px-6 py-3">Location Freshness</th>
                  <th className="px-6 py-3">Operational Status</th>
                  <th className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {ambulances.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-8 text-center text-slate-500 dark:text-slate-400">
                      No ambulance vehicles registered in your fleet yet.
                    </td>
                  </tr>
                ) : (
                  ambulances.map((amb) => {
                    const driver = amb.driver;
                    const driverProfile = driver?.driverProfile;
                    const isDriverVerified = driverProfile?.verificationState === 'VERIFIED';

                    return (
                      <tr key={amb.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors">
                        <td className="px-6 py-4 font-bold">
                          <div className="flex items-center gap-2">
                            <span>{amb.vehicleNumber}</span>
                            {amb.isDemo && (
                              <span className="px-1.5 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-800 rounded">
                                DEMO
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="px-2 py-0.5 text-xs font-semibold rounded bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                            {amb.ambulanceType || amb.type}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          {driver ? (
                            <div>
                              <div className="font-semibold">{driver.name}</div>
                              <div className="text-xs text-slate-500 flex items-center gap-1">
                                <Phone className="w-3 h-3 text-slate-400" />
                                <span>{driver.phone ? formatIndianPhone(driver.phone) : 'No phone registered'}</span>
                              </div>
                            </div>
                          ) : (
                            <span className="text-xs text-rose-500 font-semibold flex items-center gap-1">
                              <BadgeAlert className="w-3.5 h-3.5" /> No driver assigned
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <span
                            className={`px-2 py-0.5 text-xs font-semibold rounded ${
                              amb.verificationState === 'VERIFIED'
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                                : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                            }`}
                          >
                            {amb.verificationState}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-xs text-slate-500 dark:text-slate-400">
                          {amb.lastUpdated ? formatIndianDateTime(amb.lastUpdated) : 'Never'}
                        </td>
                        <td className="px-6 py-4">
                          <span
                            className={`px-2.5 py-1 text-xs font-bold rounded-full ${
                              amb.isAvailable
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300'
                                : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
                            }`}
                          >
                            {amb.isAvailable ? 'AVAILABLE' : 'OFFLINE / ON TRIP'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button
                            onClick={() => handleToggleClick(amb)}
                            disabled={!isVerified || !isDriverVerified || isTogglingAvailability}
                            className={`min-h-[44px] px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
                              amb.isAvailable
                                ? 'bg-rose-50 text-rose-600 hover:bg-rose-100 dark:bg-rose-950/40 dark:text-rose-400 focus-visible:ring-rose-500'
                                : 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:ring-emerald-500'
                            }`}
                            title={
                              !isVerified || !isDriverVerified
                                ? 'Cannot toggle available: operator or driver must be VERIFIED first'
                                : 'Toggle vehicle operational availability'
                            }
                          >
                            {amb.isAvailable ? 'Go Offline' : 'Mark Available'}
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

        {/* Active Emergency Requests Scope */}
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-5">
          <h3 className="text-base font-bold mb-3">Active Dispatch Trips</h3>
          {activeRequests.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              No active emergency trips currently dispatched to your operator fleet.
            </p>
          ) : (
            <div className="space-y-3">
              {activeRequests.map((req) => (
                <div
                  key={req.id}
                  className="p-4 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center justify-between"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold">Request #{req.id.slice(-6).toUpperCase()}</span>
                      <span className="px-2 py-0.5 text-xs font-bold rounded bg-sky-100 text-sky-800">
                        {req.status}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      Patient: {req.patient?.name || 'Emergency Patient'} • Driver: {req.driver?.name || 'Assigned Driver'}
                    </div>
                  </div>
                  <div className="text-right text-xs text-slate-400">
                    {formatIndianDateTime(req.createdAt)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Take Offline Confirmation Modal */}
        <ConfirmationModal
          isOpen={!!vehicleToOffline}
          title="Take Ambulance Unit Offline?"
          description={`Taking ambulance vehicle "${vehicleToOffline?.vehicleNumber}" offline will immediately withdraw it from the active emergency dispatch candidate pool in the Nagpur pilot region.`}
          confirmLabel="Yes, Go Offline"
          cancelLabel="Keep Online"
          isDestructive={true}
          loading={isTogglingAvailability}
          onConfirm={() => {
            if (vehicleToOffline) {
              executeToggleAvailability(vehicleToOffline.id, true);
            }
          }}
          onCancel={() => setVehicleToOffline(null)}
        />
      </main>
    </div>
  );
};

export default OperatorDashboard;
