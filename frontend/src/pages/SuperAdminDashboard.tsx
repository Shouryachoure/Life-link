import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import { ThemeToggle } from '../components/ui/ThemeToggle';
import { HeartbeatLoader } from '../components/ui/HeartbeatLoader';
import { ConfirmationModal } from '../components/ui/ConfirmationModal';
import { formatIndianPhone, maskIndianPhone, formatIndianDateTime } from '../utils/localization';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Activity,
  Heart,
  Plus,
  Trash2,
  Edit2,
  ShieldCheck,
  Truck,
  MapPin,
  Clock,
  TrendingUp,
  Bed,
  CheckCircle,
  Database,
  Building,
  LogOut,
  Settings,
  Users,
  FileText,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Filter,
  Eye,
  RefreshCw,
  X,
  Radio,
  BarChart3
} from 'lucide-react';
import { CommandCenterView } from '../components/admin/CommandCenterView';
import { AnalyticsReportingView } from '../components/admin/AnalyticsReportingView';
import { NagpurDirectoryManagement } from '../components/admin/NagpurDirectoryManagement';
import { NetworkActivationConsole } from '../components/admin/NetworkActivationConsole';

// Custom icons
const hospitalIcon = L.divIcon({
  html: `<div class="relative w-8 h-8 rounded-full bg-emerald-600 border-2 border-white flex items-center justify-center shadow-lg"><span class="text-white text-xs">🏥</span></div>`,
  className: 'custom-leaflet-icon',
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

const driverIconOnline = L.divIcon({
  html: `<div class="relative w-8 h-8 rounded-full bg-blue-600 border-2 border-white flex items-center justify-center shadow-lg"><div class="absolute inset-0 rounded-full bg-blue-500 animate-ping opacity-75"></div><span class="text-white text-xs">🚑</span></div>`,
  className: 'custom-leaflet-icon',
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

const driverIconOffline = L.divIcon({
  html: `<div class="relative w-8 h-8 rounded-full bg-gray-600 border-2 border-white flex items-center justify-center shadow-lg"><span class="text-white text-xs">🚑</span></div>`,
  className: 'custom-leaflet-icon',
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

export const SuperAdminDashboard: React.FC = () => {
  const { logout, apiFetch } = useAuth();
  const { socket } = useSocket();

  // Active view tab
  const [activeTab, setActiveTab] = useState<
    'COMMAND_CENTER' | 'ANALYTICS' | 'DIRECTORY' | 'ACTIVATION' | 'TELEMETRY' | 'HOSPITALS' | 'HOSPITAL_ADMINS' | 'REGISTRATIONS' | 'ACTIVITY_LOGS' | 'SEED' | 'USERS'
  >('COMMAND_CENTER');

  // Server telemetry data
  const [telemetry, setTelemetry] = useState<any>({
    totalTrips: 0,
    activeCount: 0,
    onlineDriversCount: 0,
    totalBeds: 0,
    successRate: 100,
  });
  const [requests, setRequests] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [hospitals, setHospitals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Form to add hospital
  const [showAddHospital, setShowAddHospital] = useState(false);
  const [hName, setHName] = useState('');
  const [hAddress, setHAddress] = useState('');
  const [hPhone, setHPhone] = useState('');
  const [hLat, setHLat] = useState('21.1458');
  const [hLng, setHLng] = useState('79.0882');
  const [hBeds, setHBeds] = useState('10');
  const [hAdminName, setHAdminName] = useState('');
  const [hAdminEmail, setHAdminEmail] = useState('');
  const [hAdminPassword, setHAdminPassword] = useState('');
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');
  const [formLoading, setFormLoading] = useState(false);

  // Seed editing state
  const [editingSeed, setEditingSeed] = useState<any>(null);
  const [seedType, setSeedType] = useState<'driver' | 'hospital'>('driver');
  const [seedSuccess, setSeedSuccess] = useState('');

  // User accounts management states
  const [users, setUsers] = useState<any[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [userSearch, setUserSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [editUserForm, setEditUserForm] = useState<any>({
    name: '',
    email: '',
    phone: '',
    role: '',
    bloodGroup: '',
    allergies: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
    medicalNotes: '',
    vehicleNumber: '',
    ambulanceType: 'BASIC_LIFE_SUPPORT',
    isAvailable: false,
  });

  // Feature 3: Hospital Admins state (Management & Soft-delete)
  const [hospitalAdmins, setHospitalAdmins] = useState<any[]>([]);
  const [adminsLoading, setAdminsLoading] = useState(false);
  const [editingAdmin, setEditingAdmin] = useState<any>(null);
  const [editAdminForm, setEditAdminForm] = useState({
    name: '',
    email: '',
    phone: '',
    hospitalName: '',
    address: '',
    contactNumber: '',
    availableBeds: '10',
  });

  // Feature 4: Pending Hospital Registrations state
  const [registrations, setRegistrations] = useState<any[]>([]);
  const [registrationsLoading, setRegistrationsLoading] = useState(false);
  const [regFilter, setRegFilter] = useState<'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED'>('PENDING');
  // Confirmation Modal Configuration
  const [confirmModalConfig, setConfirmModalConfig] = useState<{
    isOpen: boolean;
    title: string;
    description: string;
    confirmLabel?: string;
    cancelLabel?: string;
    isDestructive?: boolean;
    requireReason?: boolean;
    reasonLabel?: string;
    onConfirm: (reason?: string) => Promise<void>;
  }>({
    isOpen: false,
    title: '',
    description: '',
    onConfirm: async () => {},
  });
  const [confirmActionLoading, setConfirmActionLoading] = useState(false);

  // Feature 3: Real-Time Activity Monitoring state
  const [activityLogs, setActivityLogs] = useState<any[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityFilterAdmin, setActivityFilterAdmin] = useState('ALL');
  const [selectedLogPayload, setSelectedLogPayload] = useState<any>(null);

  // Fetch telemetry from server
  const fetchTelemetry = async () => {
    try {
      const data = await apiFetch('/admin/telemetry');
      setTelemetry(data.telemetry);
      setRequests(data.requests);
      setDrivers(data.drivers);
      setHospitals(data.hospitals);
      setLoading(false);
    } catch (err) {
      console.error('Error fetching telemetry:', err);
    }
  };

  useEffect(() => {
    fetchTelemetry();
  }, []);

  // User Management Actions
  const fetchUsers = async () => {
    setUsersLoading(true);
    try {
      const data = await apiFetch('/admin/users');
      setUsers(data || []);
    } catch (err) {
      console.error('Error fetching users:', err);
    } finally {
      setUsersLoading(false);
    }
  };

  const handleDeleteUser = (userId: string, userName?: string) => {
    setConfirmModalConfig({
      isOpen: true,
      title: 'Delete User Account',
      description: `Are you sure you want to permanently delete the user account for "${userName || userId}"? This action will remove all profile and audit records.`,
      confirmLabel: 'Permanently Delete',
      isDestructive: true,
      requireReason: true,
      reasonLabel: 'Operational Rationale for Account Deletion',
      onConfirm: async (reason?: string) => {
        setConfirmActionLoading(true);
        try {
          await apiFetch(`/admin/users/${userId}`, {
            method: 'DELETE',
            body: JSON.stringify({ reason }),
          });
          setConfirmModalConfig((prev) => ({ ...prev, isOpen: false }));
          fetchUsers();
          fetchActivityLogs();
        } catch (err: any) {
          alert(err.message || 'Failed to delete user.');
        } finally {
          setConfirmActionLoading(false);
        }
      },
    });
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch(`/admin/users/${editingUser.id}`, {
        method: 'PUT',
        body: JSON.stringify(editUserForm),
      });
      alert('User details updated successfully.');
      setEditingUser(null);
      fetchUsers();
    } catch (err: any) {
      alert(err.message || 'Failed to update user.');
    }
  };

  // Fetch Hospital Admins (Feature 3)
  const fetchHospitalAdmins = async () => {
    setAdminsLoading(true);
    try {
      const data = await apiFetch('/admin/hospital-admins');
      setHospitalAdmins(data || []);
    } catch (err) {
      console.error('Error fetching hospital admins:', err);
    } finally {
      setAdminsLoading(false);
    }
  };

  const handleToggleAdminStatus = (id: string, currentStatus: boolean, adminName: string) => {
    const action = currentStatus ? 'deactivate' : 'reactivate';
    setConfirmModalConfig({
      isOpen: true,
      title: `${action.toUpperCase()} Hospital Administrator`,
      description: `Are you sure you want to ${action} the hospital administrator account for "${adminName}"?`,
      confirmLabel: `Confirm ${action}`,
      isDestructive: currentStatus,
      requireReason: currentStatus,
      reasonLabel: `Audit Rationale for ${action}`,
      onConfirm: async (reason?: string) => {
        setConfirmActionLoading(true);
        try {
          await apiFetch(`/admin/hospital-admins/${id}/toggle-status`, {
            method: 'PATCH',
            body: JSON.stringify({ reason }),
          });
          setConfirmModalConfig((prev) => ({ ...prev, isOpen: false }));
          fetchHospitalAdmins();
          fetchActivityLogs();
        } catch (err: any) {
          alert(err.message || `Failed to ${action} hospital admin.`);
        } finally {
          setConfirmActionLoading(false);
        }
      },
    });
  };

  const handleSaveEditAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAdmin) return;
    try {
      await apiFetch(`/admin/hospital-admins/${editingAdmin.id}`, {
        method: 'PUT',
        body: JSON.stringify(editAdminForm),
      });
      alert('Hospital administrator and facility details updated successfully.');
      setEditingAdmin(null);
      fetchHospitalAdmins();
    } catch (err: any) {
      alert(err.message || 'Failed to update hospital admin.');
    }
  };

  // Fetch Hospital Registrations (Feature 4)
  const fetchRegistrations = async () => {
    setRegistrationsLoading(true);
    try {
      const query = regFilter === 'ALL' ? '' : `?status=${regFilter}`;
      const data = await apiFetch(`/admin/hospital-registrations${query}`);
      setRegistrations(data || []);
    } catch (err) {
      console.error('Error fetching registrations:', err);
    } finally {
      setRegistrationsLoading(false);
    }
  };

  const handleApproveRegistration = (id: string, hospitalName: string) => {
    setConfirmModalConfig({
      isOpen: true,
      title: 'Approve Hospital Onboarding',
      description: `Approve registration for "${hospitalName}"? This will activate the facility and provision an operational hospital admin account.`,
      confirmLabel: 'Approve & Activate Facility',
      isDestructive: false,
      onConfirm: async () => {
        setConfirmActionLoading(true);
        try {
          const res = await apiFetch(`/admin/hospital-registrations/${id}/approve`, { method: 'POST' });
          setConfirmModalConfig((prev) => ({ ...prev, isOpen: false }));
          fetchRegistrations();
          fetchHospitalAdmins();
          fetchTelemetry();
          fetchActivityLogs();
        } catch (err: any) {
          alert(err.message || 'Failed to approve hospital registration.');
        } finally {
          setConfirmActionLoading(false);
        }
      },
    });
  };

  const promptRejectRegistration = (id: string, hospitalName: string) => {
    setConfirmModalConfig({
      isOpen: true,
      title: 'Reject Hospital Application',
      description: `Are you sure you want to reject the application for "${hospitalName}"? You must provide an audit reason that will be logged and communicated.`,
      confirmLabel: 'Reject Application',
      isDestructive: true,
      requireReason: true,
      reasonLabel: 'Mandatory Rejection Rationale',
      onConfirm: async (reason?: string) => {
        setConfirmActionLoading(true);
        try {
          await apiFetch(`/admin/hospital-registrations/${id}/reject`, {
            method: 'POST',
            body: JSON.stringify({ reason }),
          });
          setConfirmModalConfig((prev) => ({ ...prev, isOpen: false }));
          fetchRegistrations();
          fetchActivityLogs();
        } catch (err: any) {
          alert(err.message || 'Failed to reject registration.');
        } finally {
          setConfirmActionLoading(false);
        }
      },
    });
  };

  // Fetch Activity Logs (Feature 3)
  const fetchActivityLogs = async () => {
    setActivityLoading(true);
    try {
      const query = activityFilterAdmin === 'ALL' ? '' : `?adminId=${activityFilterAdmin}`;
      const data = await apiFetch(`/admin/activity-logs${query}`);
      setActivityLogs(data || []);
    } catch (err) {
      console.error('Error fetching activity logs:', err);
    } finally {
      setActivityLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'USERS') fetchUsers();
    if (activeTab === 'HOSPITAL_ADMINS') fetchHospitalAdmins();
    if (activeTab === 'REGISTRATIONS') fetchRegistrations();
    if (activeTab === 'ACTIVITY_LOGS') fetchActivityLogs();
  }, [activeTab, regFilter, activityFilterAdmin]);

  // Real-time socket updates & live activity stream
  useEffect(() => {
    if (!socket) return;

    socket.emit('superadmin:register');

    socket.on('telemetry:update', () => {
      fetchTelemetry();
    });

    socket.on('telemetry:driver_moved', (data: { driverId: string; lat: number; lng: number }) => {
      setDrivers((prev) =>
        prev.map((d) => {
          if (d.driverId === data.driverId) {
            return { ...d, currentLat: data.lat, currentLng: data.lng };
          }
          return d;
        })
      );
    });

    const handleAdminActivity = (newLog: any) => {
      setActivityLogs((prev) => [newLog, ...prev.slice(0, 99)]);
    };
    socket.on('admin-activity', handleAdminActivity);

    return () => {
      socket.off('telemetry:update');
      socket.off('telemetry:driver_moved');
      socket.off('admin-activity', handleAdminActivity);
    };
  }, [socket]);

  // Create Partner Hospital
  const handleCreateHospital = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setFormSuccess('');
    setFormLoading(true);

    try {
      await apiFetch('/admin/hospitals', {
        method: 'POST',
        body: JSON.stringify({
          name: hName,
          address: hAddress,
          contactNumber: hPhone,
          lat: parseFloat(hLat),
          lng: parseFloat(hLng),
          availableBeds: parseInt(hBeds),
          adminName: hAdminName,
          adminEmail: hAdminEmail,
          adminPassword: hAdminPassword,
        }),
      });

      setFormSuccess('Partner hospital and admin account successfully created.');
      // Reset
      setHName('');
      setHAddress('');
      setHPhone('');
      setHAdminName('');
      setHAdminEmail('');
      setHAdminPassword('');
      fetchTelemetry();
    } catch (err: any) {
      setFormError(err.message || 'Failed to create hospital.');
    } finally {
      setFormLoading(false);
    }
  };

  // Delete hospital
  const handleDeleteHospital = async (id: string) => {
    if (!confirm('Are you sure you want to deactivate and remove this hospital partner? This deletes the linked admin account as well.')) return;
    try {
      await apiFetch(`/admin/hospitals/${id}`, {
        method: 'DELETE',
      });
      fetchTelemetry();
    } catch (err: any) {
      alert(err.message || 'Failed to delete hospital.');
    }
  };

  // Save Seed Edit
  const handleSaveSeed = async (e: React.FormEvent) => {
    e.preventDefault();
    setSeedSuccess('');

    try {
      await apiFetch('/admin/seed-data', {
        method: 'PUT',
        body: JSON.stringify({
          type: seedType,
          id: editingSeed.id,
          ...editingSeed,
        }),
      });
      setSeedSuccess('Seed record updated.');
      setEditingSeed(null);
      fetchTelemetry();
    } catch (err: any) {
      alert(err.message || 'Failed to save seed modifications.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 flex flex-col font-sans select-none transition-colors">
      {/* Top Header */}
      <header className="bg-white dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 py-4 px-6 sticky top-0 z-30 shadow-md flex items-center justify-between transition-colors">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-rose-600 flex items-center justify-center">
            <Activity className="w-5 h-5 text-white animate-pulse" />
          </div>
          <div>
            <span className="text-xs font-bold text-slate-500 block leading-none">Global Control Center</span>
            <span className="text-base font-extrabold tracking-tight bg-gradient-to-r from-slate-900 to-slate-800 dark:from-white dark:to-rose-400 bg-clip-text text-transparent">
              LifeLink Telemetry
            </span>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <ThemeToggle />
          <span className="text-xs font-semibold bg-slate-100 dark:bg-slate-800/80 text-rose-600 dark:text-rose-400 border border-slate-200 dark:border-slate-850 px-4 py-1.5 rounded-full flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-rose-500" /> Super Admin console
          </span>
          <button onClick={logout} className="text-slate-500 dark:text-slate-400 hover:text-rose-500 transition-colors cursor-pointer">
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Main Container */}
      <div className="max-w-7xl w-full mx-auto p-4 md:p-6 flex-1 flex flex-col md:flex-row gap-6 transition-colors">
        
        {/* Sidebar Nav */}
        <aside className="w-full md:w-64 flex flex-row md:flex-col gap-2 shrink-0 overflow-x-auto pb-2 md:pb-0">
          <button
            onClick={() => setActiveTab('COMMAND_CENTER')}
            className={`flex-1 md:flex-none flex items-center justify-between px-4 py-3 rounded-2xl text-sm font-semibold transition-all duration-300 ${
              activeTab === 'COMMAND_CENTER'
                ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/20'
                : 'bg-slate-950 text-slate-400 hover:bg-slate-850'
            }`}
          >
            <div className="flex items-center gap-3">
              <Radio className="w-4 h-4 text-rose-300 animate-pulse" />
              <span>Command Center</span>
            </div>
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
          </button>
          <button
            onClick={() => setActiveTab('ANALYTICS')}
            className={`flex-1 md:flex-none flex items-center justify-between px-4 py-3 rounded-2xl text-sm font-semibold transition-all duration-300 ${
              activeTab === 'ANALYTICS'
                ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/20'
                : 'bg-slate-950 text-slate-400 hover:bg-slate-850'
            }`}
          >
            <div className="flex items-center gap-3">
              <BarChart3 className="w-4 h-4 text-rose-300" />
              <span>Operations Analytics</span>
            </div>
            <span className="px-2 py-0.5 rounded-full text-3xs font-extrabold bg-rose-500/20 text-rose-400 border border-rose-500/30">
              Audited
            </span>
          </button>
          <button
            onClick={() => setActiveTab('DIRECTORY')}
            className={`flex-1 md:flex-none flex items-center justify-between px-4 py-3 rounded-2xl text-sm font-semibold transition-all duration-300 ${
              activeTab === 'DIRECTORY'
                ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/20'
                : 'bg-slate-950 text-slate-400 hover:bg-slate-850'
            }`}
          >
            <div className="flex items-center gap-3">
              <MapPin className="w-4 h-4 text-emerald-400" />
              <span>Nagpur Directory</span>
            </div>
            <span className="px-2 py-0.5 rounded-full text-3xs font-extrabold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              Pilot
            </span>
          </button>
          <button
            onClick={() => setActiveTab('ACTIVATION')}
            className={`flex-1 md:flex-none flex items-center justify-between px-4 py-3 rounded-2xl text-sm font-semibold transition-all duration-300 ${
              activeTab === 'ACTIVATION'
                ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/20'
                : 'bg-slate-950 text-slate-400 hover:bg-slate-850'
            }`}
          >
            <div className="flex items-center gap-3">
              <ShieldCheck className="w-4 h-4 text-rose-400" />
              <span>Network Activation</span>
            </div>
            <span className="px-2 py-0.5 rounded-full text-3xs font-extrabold bg-rose-500/20 text-rose-400 border border-rose-500/30">
              Audited
            </span>
          </button>
          <button
            onClick={() => setActiveTab('TELEMETRY')}
            className={`flex-1 md:flex-none flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-semibold transition-all duration-300 ${
              activeTab === 'TELEMETRY'
                ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/20'
                : 'bg-slate-950 text-slate-400 hover:bg-slate-850'
            }`}
          >
            <TrendingUp className="w-4 h-4" />
            Global Telemetry
          </button>
          <button
            onClick={() => setActiveTab('HOSPITALS')}
            className={`flex-1 md:flex-none flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-semibold transition-all duration-300 ${
              activeTab === 'HOSPITALS'
                ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/20'
                : 'bg-slate-950 text-slate-400 hover:bg-slate-850'
            }`}
          >
            <Building className="w-4 h-4" />
            Hospital Partners
          </button>
          <button
            onClick={() => setActiveTab('HOSPITAL_ADMINS')}
            className={`flex-1 md:flex-none flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-semibold transition-all duration-300 ${
              activeTab === 'HOSPITAL_ADMINS'
                ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/20'
                : 'bg-slate-950 text-slate-400 hover:bg-slate-850'
            }`}
          >
            <Users className="w-4 h-4" />
            Hospital Admins
          </button>
          <button
            onClick={() => setActiveTab('REGISTRATIONS')}
            className={`flex-1 md:flex-none flex items-center justify-between px-4 py-3 rounded-2xl text-sm font-semibold transition-all duration-300 ${
              activeTab === 'REGISTRATIONS'
                ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/20'
                : 'bg-slate-950 text-slate-400 hover:bg-slate-850'
            }`}
          >
            <div className="flex items-center gap-3">
              <FileText className="w-4 h-4" />
              <span>Registrations</span>
            </div>
            {registrations.filter((r) => r.status === 'PENDING').length > 0 && (
              <span className="px-2 py-0.5 rounded-full text-3xs font-extrabold bg-amber-500 text-slate-950">
                {registrations.filter((r) => r.status === 'PENDING').length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('ACTIVITY_LOGS')}
            className={`flex-1 md:flex-none flex items-center justify-between px-4 py-3 rounded-2xl text-sm font-semibold transition-all duration-300 ${
              activeTab === 'ACTIVITY_LOGS'
                ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/20'
                : 'bg-slate-950 text-slate-400 hover:bg-slate-850'
            }`}
          >
            <div className="flex items-center gap-3">
              <Activity className="w-4 h-4" />
              <span>Live Activity</span>
            </div>
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          </button>
          <button
            onClick={() => setActiveTab('SEED')}
            className={`flex-1 md:flex-none flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-semibold transition-all duration-300 ${
              activeTab === 'SEED'
                ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/20'
                : 'bg-slate-950 text-slate-400 hover:bg-slate-850'
            }`}
          >
            <Database className="w-4 h-4" />
            Seed Data Editor
          </button>
          <button
            onClick={() => setActiveTab('USERS')}
            className={`flex-1 md:flex-none flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-semibold transition-all duration-300 ${
              activeTab === 'USERS'
                ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/20'
                : 'bg-slate-950 text-slate-400 hover:bg-slate-850'
            }`}
          >
            <Settings className="w-4 h-4" />
            User Accounts
          </button>
        </aside>

        {/* Content Area */}
        <main className="flex-1 min-w-0 space-y-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-10 space-y-4">
              <HeartbeatLoader size="large" />
              <p className="text-xs text-slate-500">Loading system telemetry statistics...</p>
            </div>
          ) : (
            <>
              {/* Command Center Operations Tab (Prompt 25) */}
              {activeTab === 'COMMAND_CENTER' && (
                <CommandCenterView
                  apiFetch={apiFetch}
                  socket={socket}
                  onOpenConfirmModal={setConfirmModalConfig}
                />
              )}

              {/* Operations Analytics & Reporting Tab (Prompt 27) */}
              {activeTab === 'ANALYTICS' && (
                <AnalyticsReportingView />
              )}

              {/* Nagpur Healthcare & Ambulance Directory Tab (Prompt 29) */}
              {activeTab === 'DIRECTORY' && (
                <NagpurDirectoryManagement
                  apiFetch={apiFetch}
                  partnerHospitals={hospitals}
                />
              )}

              {/* Real-World Network Activation Console (Prompt 30) */}
              {activeTab === 'ACTIVATION' && (
                <NetworkActivationConsole apiFetch={apiFetch} />
              )}

              {/* Telemetry Tab */}
              {activeTab === 'TELEMETRY' && (
                <div className="space-y-6">
                  {/* Summary telemetry cards */}
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl">
                      <span className="text-3xs font-bold text-slate-500 uppercase tracking-wider block">Active Dispatches</span>
                      <span className="text-xl font-black text-rose-500 block mt-2">{telemetry.activeCount}</span>
                    </div>
                    <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl">
                      <span className="text-3xs font-bold text-slate-500 uppercase tracking-wider block">Total Dispatches</span>
                      <span className="text-xl font-black text-slate-200 block mt-2">{telemetry.totalTrips}</span>
                    </div>
                    <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl">
                      <span className="text-3xs font-bold text-slate-500 uppercase tracking-wider block">Online Drivers</span>
                      <span className="text-xl font-black text-blue-500 block mt-2">{telemetry.onlineDriversCount}</span>
                    </div>
                    <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl">
                      <span className="text-3xs font-bold text-slate-500 uppercase tracking-wider block">Total Available Beds</span>
                      <span className="text-xl font-black text-emerald-500 block mt-2">{telemetry.totalBeds}</span>
                    </div>
                    <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl col-span-2 md:col-span-1">
                      <span className="text-3xs font-bold text-slate-500 uppercase tracking-wider block">Log Success Rate</span>
                      <span className="text-xl font-black text-purple-400 block mt-2">{telemetry.successRate}%</span>
                    </div>
                  </div>

                  {/* System global Leaflet map */}
                  <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl space-y-4">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">System-Wide Live Map</h3>
                    <div className="h-[400px] w-full rounded-2xl overflow-hidden relative">
                      <MapContainer center={[21.1458, 79.0882]} zoom={12} scrollWheelZoom={true}>
                        <TileLayer
                          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                        />
                        
                        {/* Loop hospitals with coordinate validation */}
                        {hospitals
                          .filter((h: any) => typeof h.lat === 'number' && typeof h.lng === 'number' && !isNaN(h.lat) && !isNaN(h.lng))
                          .map((h: any) => (
                            <Marker key={h.id} position={[h.lat, h.lng]} icon={hospitalIcon}>
                              <Popup>
                                <div className="text-slate-900 font-sans">
                                  <h4 className="font-bold text-sm">{h.name}</h4>
                                  <p className="text-2xs text-slate-500 mt-1">Beds: {h.availableBeds} Available</p>
                                  {h.contactNumber && <p className="text-2xs text-blue-600 mt-0.5">📞 {h.contactNumber}</p>}
                                </div>
                              </Popup>
                            </Marker>
                          ))}

                        {/* Loop drivers with coordinate validation */}
                        {drivers
                          .filter((d: any) => typeof d.currentLat === 'number' && typeof d.currentLng === 'number' && !isNaN(d.currentLat) && !isNaN(d.currentLng))
                          .map((d: any) => (
                            <Marker
                              key={d.id}
                              position={[d.currentLat, d.currentLng]}
                              icon={d.isAvailable ? driverIconOnline : driverIconOffline}
                            >
                              <Popup>
                                <div className="text-slate-900 font-sans">
                                  <h4 className="font-bold text-sm">{d.driver?.name || 'Assigned Driver'}</h4>
                                  <p className="text-2xs text-slate-500 mt-1">Vehicle: {d.vehicleNumber} ({d.ambulanceType ? d.ambulanceType.replace(/_/g, ' ') : 'Ambulance'})</p>
                                  <p className="text-2xs text-slate-500 mt-0.5">Status: {d.isAvailable ? 'Online / Available' : 'Offline / In-Trip'}</p>
                                </div>
                              </Popup>
                            </Marker>
                          ))}
                      </MapContainer>
                    </div>
                  </div>

                  {/* Emergency request dispatcher logs table */}
                  <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-4">Dispatcher Telemetry logs</h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-slate-850 text-slate-500">
                            <th className="pb-3 font-semibold uppercase">Patient</th>
                            <th className="pb-3 font-semibold uppercase">Type</th>
                            <th className="pb-3 font-semibold uppercase">Hospital</th>
                            <th className="pb-3 font-semibold uppercase">Driver</th>
                            <th className="pb-3 font-semibold uppercase">Status</th>
                            <th className="pb-3 font-semibold uppercase">ETA</th>
                            <th className="pb-3 font-semibold uppercase">Date</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-850">
                          {requests.map((r: any) => (
                            <tr key={r.id} className="hover:bg-slate-950/20 text-slate-300">
                              <td className="py-3.5 font-medium text-slate-100">{r.patient?.name}</td>
                              <td className="py-3.5 font-mono text-2xs text-slate-400">{r.tripType}</td>
                              <td className="py-3.5">{r.hospital?.name}</td>
                              <td className="py-3.5">{r.driver?.name || 'Pending'}</td>
                              <td className="py-3.5">
                                <span className={`px-2 py-0.5 rounded-full text-2xs font-semibold ${
                                  r.status === 'COMPLETED' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-450'
                                }`}>
                                  {r.status}
                                </span>
                              </td>
                              <td className="py-3.5 font-semibold text-slate-400">{r.etaMinutes || '0'} mins</td>
                              <td className="py-3.5 text-3xs font-semibold text-slate-500">
                                {formatIndianDateTime(r.createdAt)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* Hospital Management Tab */}
              {activeTab === 'HOSPITALS' && (
                <div className="space-y-6">
                  <div className="flex justify-between items-center bg-slate-900 border border-slate-800 p-5 rounded-3xl shadow-md">
                    <div>
                      <h2 className="text-base font-bold text-slate-200">Registered Partner Hospitals</h2>
                      <p className="text-xs text-slate-400 mt-1">Manage verified facilities and hospital administrators.</p>
                    </div>
                    <button
                      onClick={() => setShowAddHospital(!showAddHospital)}
                      className="bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold px-4 py-2.5 rounded-xl shadow-lg shadow-rose-600/20 transition-colors flex items-center gap-1.5"
                    >
                      <Plus className="w-4 h-4" /> Register Hospital
                    </button>
                  </div>

                  {showAddHospital && (
                    <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl animate-fade-in">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-rose-500 mb-4">Register Hospital Partner</h3>
                      <form onSubmit={handleCreateHospital} className="space-y-4">
                        {formError && <div className="p-3 bg-rose-500/10 text-rose-400 text-xs rounded-xl">{formError}</div>}
                        {formSuccess && <div className="p-3 bg-emerald-500/10 text-emerald-400 text-xs rounded-xl">{formSuccess}</div>}

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div>
                            <label className="block text-2xs font-semibold text-slate-450 uppercase mb-2">Hospital Name</label>
                            <input
                              type="text"
                              required
                              value={hName}
                              onChange={(e) => setHName(e.target.value)}
                              placeholder="e.g. SF General Hospital"
                              className="block w-full px-4 py-2.5 bg-slate-950/60 border border-slate-800 rounded-xl text-slate-200 text-xs focus:outline-none focus:border-rose-500"
                            />
                          </div>
                          <div>
                            <label className="block text-2xs font-semibold text-slate-450 uppercase mb-2">Address</label>
                            <input
                              type="text"
                              required
                              value={hAddress}
                              onChange={(e) => setHAddress(e.target.value)}
                              placeholder="e.g. 1001 Potrero Ave"
                              className="block w-full px-4 py-2.5 bg-slate-950/60 border border-slate-800 rounded-xl text-slate-200 text-xs focus:outline-none focus:border-rose-500"
                            />
                          </div>
                          <div>
                            <label className="block text-2xs font-semibold text-slate-450 uppercase mb-2">Contact Number</label>
                            <input
                              type="text"
                              required
                              value={hPhone}
                              onChange={(e) => setHPhone(e.target.value)}
                              placeholder="e.g. +15550111"
                              className="block w-full px-4 py-2.5 bg-slate-950/60 border border-slate-800 rounded-xl text-slate-200 text-xs focus:outline-none focus:border-rose-500"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div>
                            <label className="block text-2xs font-semibold text-slate-450 uppercase mb-2">Latitude</label>
                            <input
                              type="text"
                              required
                              value={hLat}
                              onChange={(e) => setHLat(e.target.value)}
                              placeholder="e.g. 37.7556"
                              className="block w-full px-4 py-2.5 bg-slate-950/60 border border-slate-800 rounded-xl text-slate-200 text-xs focus:outline-none focus:border-rose-500"
                            />
                          </div>
                          <div>
                            <label className="block text-2xs font-semibold text-slate-450 uppercase mb-2">Longitude</label>
                            <input
                              type="text"
                              required
                              value={hLng}
                              onChange={(e) => setHLng(e.target.value)}
                              placeholder="e.g. -122.4047"
                              className="block w-full px-4 py-2.5 bg-slate-950/60 border border-slate-800 rounded-xl text-slate-200 text-xs focus:outline-none focus:border-rose-500"
                            />
                          </div>
                          <div>
                            <label className="block text-2xs font-semibold text-slate-450 uppercase mb-2">Available Beds</label>
                            <input
                              type="number"
                              required
                              value={hBeds}
                              onChange={(e) => setHBeds(e.target.value)}
                              placeholder="e.g. 10"
                              className="block w-full px-4 py-2.5 bg-slate-950/60 border border-slate-800 rounded-xl text-slate-200 text-xs focus:outline-none focus:border-rose-500"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div>
                            <label className="block text-2xs font-semibold text-slate-450 uppercase mb-2">Admin Full Name</label>
                            <input
                              type="text"
                              required
                              value={hAdminName}
                              onChange={(e) => setHAdminName(e.target.value)}
                              placeholder="Dr. Sarah Connor"
                              className="block w-full px-4 py-2.5 bg-slate-950/60 border border-slate-800 rounded-xl text-slate-200 text-xs focus:outline-none focus:border-rose-500"
                            />
                          </div>
                          <div>
                            <label className="block text-2xs font-semibold text-slate-450 uppercase mb-2">Admin Email</label>
                            <input
                              type="email"
                              required
                              value={hAdminEmail}
                              onChange={(e) => setHAdminEmail(e.target.value)}
                              placeholder="admin@sfgeneral.com"
                              className="block w-full px-4 py-2.5 bg-slate-950/60 border border-slate-800 rounded-xl text-slate-200 text-xs focus:outline-none focus:border-rose-500"
                            />
                          </div>
                          <div>
                            <label className="block text-2xs font-semibold text-slate-450 uppercase mb-2">Admin Password</label>
                            <input
                              type="password"
                              required
                              value={hAdminPassword}
                              onChange={(e) => setHAdminPassword(e.target.value)}
                              placeholder="••••••••"
                              className="block w-full px-4 py-2.5 bg-slate-950/60 border border-slate-800 rounded-xl text-slate-200 text-xs focus:outline-none focus:border-rose-500"
                            />
                          </div>
                        </div>

                        <button
                          type="submit"
                          disabled={formLoading}
                          className="px-6 py-3 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-rose-600/10 transition-colors"
                        >
                          {formLoading ? 'Creating partners...' : 'Confirm Registration'}
                        </button>
                      </form>
                    </div>
                  )}

                  {/* List Hospitals */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {hospitals.map((h) => (
                      <div key={h.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex justify-between gap-4">
                        <div className="space-y-2">
                          <h4 className="font-bold text-sm text-slate-100">{h.name}</h4>
                          <span className="text-[10px] bg-slate-950 border border-slate-850 px-2.5 py-0.5 rounded font-mono text-slate-450 leading-normal block max-w-max">
                            Beds available: {h.availableBeds}
                          </span>
                          <div className="text-3xs text-slate-500 space-y-0.5 pt-2 leading-relaxed">
                            <p>Admin: {h.adminUser?.name} ({h.adminUser?.email})</p>
                            <p>Address: {h.address}</p>
                            <p>GPS: {h.lat}, {h.lng}</p>
                          </div>
                        </div>

                        <div className="flex flex-col gap-2">
                          <button
                            onClick={() => {
                              setSeedType('hospital');
                              setEditingSeed(h);
                              setActiveTab('SEED');
                            }}
                            className="p-2 bg-slate-850 hover:bg-slate-800 text-slate-300 rounded-lg hover:text-blue-400 transition-colors"
                            title="Edit"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteHospital(h.id)}
                            className="p-2 bg-slate-850 hover:bg-slate-800 text-slate-300 rounded-lg hover:text-rose-500 transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Seed Editor Tab */}
              {activeTab === 'SEED' && (
                <div className="space-y-6 bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl">
                  <div>
                    <h2 className="text-base font-bold text-slate-200">Seed Database Editor</h2>
                    <p className="text-xs text-slate-400 mt-1">Select and modify seeded dummy coordinates or availability logs for local testing.</p>
                  </div>

                  {seedSuccess && <div className="p-3 bg-emerald-500/10 text-emerald-400 text-xs rounded-xl">{seedSuccess}</div>}

                  {editingSeed ? (
                    <form onSubmit={handleSaveSeed} className="space-y-4 max-w-xl">
                      <h3 className="text-xs font-bold text-rose-500 uppercase tracking-widest">
                        Modifying {seedType === 'driver' ? `Driver: ${editingSeed.driver?.name}` : `Hospital: ${editingSeed.name}`}
                      </h3>

                      {seedType === 'driver' ? (
                        <>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <label className="block text-2xs font-semibold text-slate-400 uppercase mb-2">Plate ID</label>
                              <input
                                type="text"
                                value={editingSeed.vehicleNumber}
                                onChange={(e) => setEditingSeed({ ...editingSeed, vehicleNumber: e.target.value })}
                                className="block w-full px-4 py-2.5 bg-slate-950/60 border border-slate-800 rounded-xl text-slate-200 text-xs"
                              />
                            </div>
                            <div>
                              <label className="block text-2xs font-semibold text-slate-400 uppercase mb-2">Availability</label>
                              <select
                                value={editingSeed.isAvailable ? 'true' : 'false'}
                                onChange={(e) => setEditingSeed({ ...editingSeed, isAvailable: e.target.value === 'true' })}
                                className="block w-full px-4 py-2.5 bg-slate-950/60 border border-slate-800 rounded-xl text-slate-200 text-xs"
                              >
                                <option value="true">Online</option>
                                <option value="false">Offline</option>
                              </select>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <label className="block text-2xs font-semibold text-slate-400 uppercase mb-2">Latitude</label>
                              <input
                                type="text"
                                value={editingSeed.currentLat}
                                onChange={(e) => setEditingSeed({ ...editingSeed, currentLat: e.target.value })}
                                className="block w-full px-4 py-2.5 bg-slate-950/60 border border-slate-800 rounded-xl text-slate-200 text-xs"
                              />
                            </div>
                            <div>
                              <label className="block text-2xs font-semibold text-slate-400 uppercase mb-2">Longitude</label>
                              <input
                                type="text"
                                value={editingSeed.currentLng}
                                onChange={(e) => setEditingSeed({ ...editingSeed, currentLng: e.target.value })}
                                className="block w-full px-4 py-2.5 bg-slate-950/60 border border-slate-800 rounded-xl text-slate-200 text-xs"
                              />
                            </div>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <label className="block text-2xs font-semibold text-slate-400 uppercase mb-2">Hospital Name</label>
                              <input
                                type="text"
                                value={editingSeed.name}
                                onChange={(e) => setEditingSeed({ ...editingSeed, name: e.target.value })}
                                className="block w-full px-4 py-2.5 bg-slate-950/60 border border-slate-800 rounded-xl text-slate-200 text-xs"
                              />
                            </div>
                            <div>
                              <label className="block text-2xs font-semibold text-slate-400 uppercase mb-2">Beds</label>
                              <input
                                type="number"
                                value={editingSeed.availableBeds}
                                onChange={(e) => setEditingSeed({ ...editingSeed, availableBeds: parseInt(e.target.value) || 0 })}
                                className="block w-full px-4 py-2.5 bg-slate-950/60 border border-slate-800 rounded-xl text-slate-200 text-xs"
                              />
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <label className="block text-2xs font-semibold text-slate-400 uppercase mb-2">Latitude</label>
                              <input
                                type="text"
                                value={editingSeed.lat}
                                onChange={(e) => setEditingSeed({ ...editingSeed, lat: e.target.value })}
                                className="block w-full px-4 py-2.5 bg-slate-950/60 border border-slate-800 rounded-xl text-slate-200 text-xs"
                              />
                            </div>
                            <div>
                              <label className="block text-2xs font-semibold text-slate-400 uppercase mb-2">Longitude</label>
                              <input
                                type="text"
                                value={editingSeed.lng}
                                onChange={(e) => setEditingSeed({ ...editingSeed, lng: e.target.value })}
                                className="block w-full px-4 py-2.5 bg-slate-950/60 border border-slate-800 rounded-xl text-slate-200 text-xs"
                              />
                            </div>
                          </div>
                        </>
                      )}

                      <div className="flex gap-2.5 pt-2">
                        <button
                          type="submit"
                          className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold shadow-lg"
                        >
                          Save Changes
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingSeed(null)}
                          className="px-6 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="space-y-6">
                      {/* Driver seeds */}
                      <div className="space-y-3">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">Seed Ambulance Drivers</h4>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          {drivers.map((d) => (
                            <div key={d.id} className="bg-slate-950/40 p-4 border border-slate-850 rounded-2xl flex justify-between gap-2">
                              <div>
                                <h5 className="font-bold text-xs">{d.driver?.name}</h5>
                                <p className="text-3xs text-slate-500 mt-1">Vehicle: {d.vehicleNumber}</p>
                                <span className={`text-[9px] font-semibold mt-1 inline-block ${
                                  d.isAvailable ? 'text-emerald-500 animate-pulse' : 'text-slate-500'
                                }`}>
                                  {d.isAvailable ? 'Online' : 'Offline'}
                                </span>
                              </div>
                              <button
                                onClick={() => {
                                  setSeedType('driver');
                                  setEditingSeed(d);
                                }}
                                className="p-2 self-start bg-slate-900 border border-slate-800 rounded-lg text-slate-400 hover:text-blue-400 transition-colors"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Hospital seeds */}
                      <div className="space-y-3 pt-4 border-t border-slate-850">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">Seed Hospital Partners</h4>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          {hospitals.map((h) => (
                            <div key={h.id} className="bg-slate-950/40 p-4 border border-slate-850 rounded-2xl flex justify-between gap-2">
                              <div>
                                <h5 className="font-bold text-xs">{h.name}</h5>
                                <p className="text-3xs text-slate-500 mt-1">Beds: {h.availableBeds}</p>
                                <p className="text-3xs text-slate-500">GPS: {h.lat}, {h.lng}</p>
                              </div>
                              <button
                                onClick={() => {
                                  setSeedType('hospital');
                                  setEditingSeed(h);
                                }}
                                className="p-2 self-start bg-slate-900 border border-slate-800 rounded-lg text-slate-400 hover:text-blue-400 transition-colors"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Feature 3: Hospital Admins Management Tab */}
              {activeTab === 'HOSPITAL_ADMINS' && (
                <div className="space-y-6">
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div>
                      <h2 className="text-xl font-bold tracking-tight text-white">Hospital Administrators</h2>
                      <p className="text-xs text-slate-400">
                        Manage credentialed hospital admins, edit facility details, and toggle active status (soft-delete).
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2 text-2xs font-mono">
                        <span className="px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold">
                          {hospitalAdmins.filter((a) => a.isActive).length} Active
                        </span>
                        <span className="px-2.5 py-1 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20 font-bold">
                          {hospitalAdmins.filter((a) => !a.isActive).length} Deactivated
                        </span>
                      </div>

                      <button
                        onClick={fetchHospitalAdmins}
                        className="p-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-xl text-xs flex items-center gap-1.5 transition-colors"
                        title="Refresh list"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${adminsLoading ? 'animate-spin' : ''}`} />
                      </button>
                    </div>
                  </div>

                  {adminsLoading ? (
                    <div className="py-12 flex justify-center">
                      <HeartbeatLoader size="medium" />
                    </div>
                  ) : hospitalAdmins.length === 0 ? (
                    <div className="p-12 text-center bg-slate-950 border border-slate-850 rounded-2xl space-y-2">
                      <Users className="w-8 h-8 text-slate-600 mx-auto" />
                      <p className="text-xs text-slate-400 font-semibold">No hospital administrators found.</p>
                      <p className="text-3xs text-slate-500">Approve pending hospital registrations or create one in Hospital Partners.</p>
                    </div>
                  ) : (
                    <div className="bg-slate-950 border border-slate-850 rounded-2xl overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-slate-900/60 border-b border-slate-850 text-slate-400 uppercase text-3xs font-mono">
                            <tr>
                              <th className="p-4">Admin Name & Email</th>
                              <th className="p-4">Hospital Facility</th>
                              <th className="p-4">Contact Phone</th>
                              <th className="p-4">Status</th>
                              <th className="p-4 text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-850 text-slate-300">
                            {hospitalAdmins.map((admin) => (
                              <tr key={admin.id} className="hover:bg-slate-900/30 transition-colors">
                                <td className="p-4">
                                  <div className="font-bold text-white text-xs">{admin.name}</div>
                                  <div className="text-3xs text-slate-500 font-mono mt-0.5">{admin.email}</div>
                                </td>
                                <td className="p-4">
                                  {admin.hospital ? (
                                    <div>
                                      <div className="font-semibold text-slate-200">{admin.hospital.name}</div>
                                      <div className="text-3xs text-slate-500 truncate max-w-xs">{admin.hospital.address}</div>
                                      <div className="text-4xs text-emerald-400 mt-0.5 font-mono">{admin.hospital.availableBeds} beds available</div>
                                    </div>
                                  ) : (
                                    <span className="text-3xs text-slate-500 italic">No facility assigned</span>
                                  )}
                                </td>
                                <td className="p-4 font-mono text-3xs text-slate-400">
                                  {admin.phone || 'N/A'}
                                </td>
                                <td className="p-4">
                                  {admin.isActive ? (
                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-3xs font-extrabold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                      ACTIVE
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-3xs font-extrabold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                                      <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                                      DEACTIVATED
                                    </span>
                                  )}
                                </td>
                                <td className="p-4 text-right">
                                  <div className="flex items-center justify-end gap-2">
                                    <button
                                      onClick={() => {
                                        setEditingAdmin(admin);
                                        setEditAdminForm({
                                          name: admin.name,
                                          email: admin.email,
                                          phone: admin.phone || '',
                                          hospitalName: admin.hospital?.name || '',
                                          address: admin.hospital?.address || '',
                                          contactNumber: admin.hospital?.contactNumber || admin.phone || '',
                                          availableBeds: admin.hospital?.availableBeds ? String(admin.hospital.availableBeds) : '10',
                                        });
                                      }}
                                      className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-lg text-3xs font-semibold transition-colors flex items-center gap-1 cursor-pointer"
                                    >
                                      <Edit2 className="w-3 h-3" />
                                      <span>Edit</span>
                                    </button>
                                    <button
                                      onClick={() => handleToggleAdminStatus(admin.id, admin.isActive, admin.name)}
                                      className={`px-3 py-1.5 rounded-lg text-3xs font-bold transition-all cursor-pointer ${
                                        admin.isActive
                                          ? 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20'
                                          : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20'
                                      }`}
                                    >
                                      {admin.isActive ? 'Soft-Deactivate' : 'Reactivate'}
                                    </button>
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

              {/* Feature 4: Pending Hospital Registrations Tab */}
              {activeTab === 'REGISTRATIONS' && (
                <div className="space-y-6">
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div>
                      <h2 className="text-xl font-bold tracking-tight text-white">Hospital Registration Applications</h2>
                      <p className="text-xs text-slate-400">
                        Review submissions from healthcare facilities. Approving provisions an active hospital admin account.
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      {(['PENDING', 'APPROVED', 'REJECTED', 'ALL'] as const).map((filter) => (
                        <button
                          key={filter}
                          onClick={() => setRegFilter(filter)}
                          className={`px-3 py-1.5 rounded-xl text-3xs font-bold font-mono transition-all cursor-pointer ${
                            regFilter === filter
                              ? 'bg-rose-600 text-white shadow-md'
                              : 'bg-slate-900 hover:bg-slate-850 text-slate-400 border border-slate-800'
                          }`}
                        >
                          {filter}
                        </button>
                      ))}
                      <button
                        onClick={fetchRegistrations}
                        className="p-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-xl text-xs transition-colors"
                        title="Refresh"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${registrationsLoading ? 'animate-spin' : ''}`} />
                      </button>
                    </div>
                  </div>

                  {registrationsLoading ? (
                    <div className="py-12 flex justify-center">
                      <HeartbeatLoader size="medium" />
                    </div>
                  ) : registrations.length === 0 ? (
                    <div className="p-12 text-center bg-slate-950 border border-slate-850 rounded-2xl space-y-2">
                      <FileText className="w-8 h-8 text-slate-600 mx-auto" />
                      <p className="text-xs text-slate-400 font-semibold">No registrations found matching filter "{regFilter}".</p>
                      <p className="text-3xs text-slate-500">Public hospital registrations submitted at /register-hospital will appear here.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {registrations.map((reg) => (
                        <div
                          key={reg.id}
                          className="bg-slate-950 border border-slate-850 p-5 rounded-2xl space-y-4 shadow-sm hover:border-slate-800 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <span className={`inline-block px-2.5 py-0.5 rounded-full text-4xs font-mono font-extrabold uppercase tracking-wider mb-1.5 ${
                                reg.status === 'PENDING'
                                  ? 'bg-amber-500/15 text-amber-400 border border-amber-500/20'
                                  : reg.status === 'APPROVED'
                                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                                  : 'bg-rose-500/15 text-rose-400 border border-rose-500/20'
                              }`}>
                                {reg.status}
                              </span>
                              <h3 className="text-base font-bold text-white tracking-tight">{reg.hospitalName}</h3>
                              <p className="text-3xs text-slate-500 font-mono mt-0.5">Applied: {formatIndianDateTime(reg.createdAt)}</p>
                            </div>
                            <div className="w-9 h-9 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-400">
                              <Building className="w-4 h-4 text-emerald-400" />
                            </div>
                          </div>

                          <div className="space-y-1.5 text-2xs text-slate-300">
                            <div className="flex items-center gap-2">
                              <span className="text-slate-500 text-3xs font-mono uppercase w-16">Email:</span>
                              <span className="font-mono text-slate-200">{reg.email}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-slate-500 text-3xs font-mono uppercase w-16">Phone:</span>
                              <span className="font-mono text-slate-200">{reg.contactNumber}</span>
                            </div>
                            {reg.address && (
                              <div className="flex items-start gap-2">
                                <span className="text-slate-500 text-3xs font-mono uppercase w-16 shrink-0">Address:</span>
                                <span className="text-slate-300 text-3xs">{reg.address}</span>
                              </div>
                            )}
                          </div>

                          {/* Services badges */}
                          {reg.services && (
                            <div className="pt-2 border-t border-slate-850">
                              <span className="text-4xs text-slate-500 uppercase font-mono block mb-1.5">Clinical Services:</span>
                              <div className="flex flex-wrap gap-1.5">
                                {reg.services.split(',').map((s: string, idx: number) => (
                                  <span key={idx} className="px-2 py-0.5 bg-slate-900 border border-slate-800 rounded-md text-3xs text-slate-300">
                                    {s.trim()}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {reg.rejectionReason && (
                            <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 rounded-xl text-3xs text-rose-400">
                              <span className="font-bold">Rejection Reason:</span> {reg.rejectionReason}
                            </div>
                          )}

                          {/* Action Buttons for PENDING */}
                          {reg.status === 'PENDING' && (
                            <div className="pt-3 border-t border-slate-850 flex items-center gap-2">
                              <button
                                onClick={() => handleApproveRegistration(reg.id, reg.hospitalName)}
                                className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-emerald-600/20 flex items-center justify-center gap-1.5 cursor-pointer"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>Approve Facility</span>
                              </button>
                              <button
                                onClick={() => promptRejectRegistration(reg.id, reg.hospitalName)}
                                className="px-4 py-2 bg-rose-600/20 hover:bg-rose-600/30 text-rose-400 border border-rose-500/30 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                                <span>Reject</span>
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Feature 3: Real-Time Activity Monitoring Tab */}
              {activeTab === 'ACTIVITY_LOGS' && (
                <div className="space-y-6">
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2.5">
                        <h2 className="text-xl font-bold tracking-tight text-white">Live Activity Monitoring</h2>
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-4xs font-mono font-bold uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                          Socket Feed Active
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1">
                        Real-time audit stream of hospital admin actions, emergency status transitions, bed allocations, and registrations.
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-xl text-2xs text-slate-300">
                        <Filter className="w-3.5 h-3.5 text-slate-500" />
                        <select
                          value={activityFilterAdmin}
                          onChange={(e) => setActivityFilterAdmin(e.target.value)}
                          className="bg-transparent text-slate-200 focus:outline-none text-2xs"
                        >
                          <option value="ALL">All Administrators</option>
                          {hospitalAdmins.map((a) => (
                            <option key={a.id} value={a.id}>{a.name} ({a.hospital?.name || 'Admin'})</option>
                          ))}
                        </select>
                      </div>

                      <button
                        onClick={fetchActivityLogs}
                        className="p-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-xl text-xs transition-colors"
                        title="Refresh stream"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${activityLoading ? 'animate-spin' : ''}`} />
                      </button>
                    </div>
                  </div>

                  {activityLoading ? (
                    <div className="py-12 flex justify-center">
                      <HeartbeatLoader size="medium" />
                    </div>
                  ) : activityLogs.length === 0 ? (
                    <div className="p-12 text-center bg-slate-950 border border-slate-850 rounded-2xl space-y-2">
                      <Activity className="w-8 h-8 text-slate-600 mx-auto" />
                      <p className="text-xs text-slate-400 font-semibold">No activity logs recorded yet.</p>
                      <p className="text-3xs text-slate-500">Actions by hospital staff (updating beds, allocating bays) will appear here live.</p>
                    </div>
                  ) : (
                    <div className="bg-slate-950 border border-slate-850 rounded-2xl divide-y divide-slate-850 overflow-hidden">
                      {activityLogs.map((log) => {
                        let actionColor = 'bg-blue-500/15 text-blue-400 border-blue-500/30';
                        if (log.action.includes('APPROVED')) actionColor = 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
                        if (log.action.includes('REJECTED') || log.action.includes('DEACTIVATED')) actionColor = 'bg-rose-500/15 text-rose-400 border-rose-500/30';
                        if (log.action.includes('BED') || log.action.includes('BAY')) actionColor = 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30';

                        return (
                          <div key={log.id} className="p-4 hover:bg-slate-900/30 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div className="flex items-start gap-3">
                              <div className="w-8 h-8 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center shrink-0 mt-0.5">
                                <Activity className="w-4 h-4 text-rose-400" />
                              </div>
                              <div className="space-y-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className={`px-2 py-0.5 rounded-full text-4xs font-mono font-extrabold uppercase border ${actionColor}`}>
                                    {log.action}
                                  </span>
                                  <span className="text-xs font-bold text-white">
                                    {log.admin?.name || 'Administrator'}
                                  </span>
                                  {log.admin?.hospital?.name && (
                                    <span className="text-3xs text-slate-400">
                                      &bull; {log.admin.hospital.name}
                                    </span>
                                  )}
                                </div>
                                {log.metadata && (
                                  <div className="text-3xs text-slate-400 font-mono">
                                    {log.metadata.hospitalName && `Facility: ${log.metadata.hospitalName} | `}
                                    {log.metadata.patientName && `Patient: ${log.metadata.patientName} | `}
                                    {log.metadata.bedNumber && `Bed: ${log.metadata.bedNumber} (${log.metadata.status}) | `}
                                    {log.metadata.assignedBay && `Assigned: ${log.metadata.assignedBay} | `}
                                    {log.metadata.details && log.metadata.details}
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center gap-3 self-end sm:self-center">
                              <span className="text-3xs text-slate-500 font-mono">
                                {formatIndianDateTime(log.timestamp)}
                              </span>
                              {log.metadata && (
                                <button
                                  onClick={() => setSelectedLogPayload(log)}
                                  className="px-2.5 py-1 bg-slate-900 hover:bg-slate-850 border border-slate-800 rounded-lg text-4xs text-slate-400 hover:text-white transition-colors flex items-center gap-1 cursor-pointer"
                                >
                                  <Eye className="w-3 h-3" />
                                  <span>Payload</span>
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* User Management Tab */}
              {activeTab === 'USERS' && (
                <div className="space-y-6">
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div>
                      <h2 className="text-xl font-bold tracking-tight text-white">System Accounts Management</h2>
                      <p className="text-xs text-slate-400">View, modify profile records, and delete user accounts across all roles.</p>
                    </div>

                    <div className="flex items-center gap-3 w-full sm:w-auto">
                      <input
                        type="text"
                        placeholder="Search users..."
                        value={userSearch}
                        onChange={(e) => setUserSearch(e.target.value)}
                        className="bg-slate-900 text-xs px-4 py-2 rounded-xl border border-slate-800 focus:outline-none focus:border-rose-500 w-full sm:w-64 text-slate-200 border-box"
                      />
                      <select
                        value={roleFilter}
                        onChange={(e) => setRoleFilter(e.target.value)}
                        className="bg-slate-900 text-xs px-4 py-2 rounded-xl border border-slate-800 focus:outline-none focus:border-rose-500 text-slate-300 cursor-pointer"
                      >
                        <option value="ALL">All Roles</option>
                        <option value="PATIENT">Patients</option>
                        <option value="DRIVER">Drivers</option>
                        <option value="ADMIN_HOSPITAL">ER Admins</option>
                        <option value="SUPER_ADMIN">Super Admin</option>
                      </select>
                    </div>
                  </div>

                  {usersLoading ? (
                    <p className="text-xs text-slate-500">Loading user accounts...</p>
                  ) : (
                    <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead>
                            <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                              <th className="px-6 py-4">User Details</th>
                              <th className="px-6 py-4">Contact Phone</th>
                              <th className="px-6 py-4">Role</th>
                              <th className="px-6 py-4">Profile Metadata</th>
                              <th className="px-6 py-4 text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800">
                            {users
                              .filter((u) => {
                                const matchesSearch =
                                  u.name.toLowerCase().includes(userSearch.toLowerCase()) ||
                                  u.email.toLowerCase().includes(userSearch.toLowerCase());
                                const matchesRole = roleFilter === 'ALL' || u.role === roleFilter;
                                return matchesSearch && matchesRole;
                              })
                              .map((u) => (
                                <tr key={u.id} className="hover:bg-slate-950/40 transition-colors">
                                  <td className="px-6 py-4">
                                    <div className="font-bold text-slate-200">{u.name}</div>
                                    <div className="text-3xs text-slate-500">{u.email}</div>
                                    {u.googleId && (
                                      <span className="inline-block bg-blue-500/10 text-blue-400 text-[9px] px-1.5 py-0.5 rounded-md font-bold mt-1 uppercase">
                                        Google Account
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-6 py-4 font-medium text-slate-350">{u.phone || 'N/A'}</td>
                                  <td className="px-6 py-4">
                                    <span
                                      className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${
                                        u.role === 'SUPER_ADMIN'
                                          ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                                          : u.role === 'ADMIN_HOSPITAL'
                                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                          : u.role === 'DRIVER'
                                          ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                                          : 'bg-rose-500/10 text-rose-455 border border-rose-500/20'
                                      }`}
                                    >
                                      {u.role}
                                    </span>
                                  </td>
                                  <td className="px-6 py-4 text-slate-400 max-w-xs truncate text-[11px]">
                                    {u.role === 'PATIENT' && u.patientProfile && (
                                      <span>
                                        Blood: <b>{u.patientProfile.bloodGroup}</b> | Allergies: {u.patientProfile.allergies || 'None'}
                                      </span>
                                    )}
                                    {u.role === 'DRIVER' && u.ambulance && (
                                      <span>
                                        Plate: <b>{u.ambulance.vehicleNumber}</b> | Tier: {u.ambulance.ambulanceType.replace(/_/g, ' ')}
                                      </span>
                                    )}
                                    {u.role === 'ADMIN_HOSPITAL' && u.hospital && (
                                      <span>Assigned ER: <b>{u.hospital.name}</b></span>
                                    )}
                                    {!u.patientProfile && !u.ambulance && !u.hospital && '-'}
                                  </td>
                                  <td className="px-6 py-4 text-right space-x-2">
                                    <button
                                      onClick={() => {
                                        setEditingUser(u);
                                        setEditUserForm({
                                          name: u.name,
                                          email: u.email,
                                          phone: u.phone || '',
                                          role: u.role,
                                          bloodGroup: u.patientProfile?.bloodGroup || 'O+',
                                          allergies: u.patientProfile?.allergies || '',
                                          emergencyContactName: u.patientProfile?.emergencyContactName || '',
                                          emergencyContactPhone: u.patientProfile?.emergencyContactPhone || '',
                                          medicalNotes: u.patientProfile?.medicalNotes || '',
                                          vehicleNumber: u.ambulance?.vehicleNumber || '',
                                          ambulanceType: u.ambulance?.ambulanceType || 'BASIC_LIFE_SUPPORT',
                                          isAvailable: !!u.ambulance?.isAvailable,
                                        });
                                      }}
                                      className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg transition-colors inline-flex cursor-pointer"
                                      title="Edit Details"
                                    >
                                      <Edit2 className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      onClick={() => handleDeleteUser(u.id, u.name)}
                                      className="p-1.5 bg-rose-950/20 hover:bg-rose-900/50 text-rose-455 hover:text-rose-400 rounded-lg transition-colors inline-flex cursor-pointer"
                                      title="Delete Account"
                                      disabled={u.role === 'SUPER_ADMIN'}
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
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
            </>
          )}
        </main>
      </div>

      {/* Super Admin Edit User Account Modal Overlay */}
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 animate-fade-in text-slate-100">
          <div className="bg-slate-900 border border-slate-800 shadow-2xl rounded-3xl max-w-lg w-full p-6 md:p-8 space-y-6 relative max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setEditingUser(null)}
              className="absolute top-4 right-4 text-slate-500 hover:text-slate-350 text-sm font-semibold transition-colors cursor-pointer"
            >
              ✕
            </button>

            <div className="text-left">
              <h3 className="text-lg font-bold tracking-tight text-white">Modify System Account</h3>
              <p className="text-xs text-slate-400 mt-1">Editing credentials and telemetry for {editingUser.name}</p>
            </div>

            <form onSubmit={handleUpdateUser} className="space-y-4 text-left">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-2">User Full Name</label>
                  <input
                    type="text"
                    required
                    value={editUserForm.name}
                    onChange={(e) => setEditUserForm({ ...editUserForm, name: e.target.value })}
                    className="w-full bg-slate-950 text-slate-200 border border-slate-800 px-3 py-2.5 rounded-xl text-xs focus:outline-none focus:border-rose-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-2">Email Address</label>
                  <input
                    type="email"
                    required
                    value={editUserForm.email}
                    onChange={(e) => setEditUserForm({ ...editUserForm, email: e.target.value })}
                    className="w-full bg-slate-950 text-slate-200 border border-slate-800 px-3 py-2.5 rounded-xl text-xs focus:outline-none focus:border-rose-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-2">Phone Number</label>
                  <input
                    type="text"
                    value={editUserForm.phone}
                    onChange={(e) => setEditUserForm({ ...editUserForm, phone: e.target.value })}
                    className="w-full bg-slate-950 text-slate-200 border border-slate-800 px-3 py-2.5 rounded-xl text-xs focus:outline-none focus:border-rose-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-2">Account Role</label>
                  <select
                    value={editUserForm.role}
                    onChange={(e) => setEditUserForm({ ...editUserForm, role: e.target.value })}
                    className="w-full bg-slate-950 text-slate-200 border border-slate-800 px-3 py-2.5 rounded-xl text-xs focus:outline-none focus:border-rose-500 text-slate-350"
                  >
                    <option value="PATIENT">PATIENT</option>
                    <option value="DRIVER">DRIVER</option>
                    <option value="ADMIN_HOSPITAL">ADMIN_HOSPITAL</option>
                    <option value="SUPER_ADMIN">SUPER_ADMIN</option>
                  </select>
                </div>
              </div>

              {/* Patient Profile Fields */}
              {editUserForm.role === 'PATIENT' && (
                <div className="bg-slate-950 border border-slate-850 p-4 rounded-2xl space-y-3">
                  <span className="text-[10px] font-bold text-rose-455 block uppercase tracking-wider font-mono">Patient Record Data</span>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[9px] font-semibold text-slate-500 uppercase mb-1">Blood Group</label>
                      <input
                        type="text"
                        value={editUserForm.bloodGroup}
                        onChange={(e) => setEditUserForm({ ...editUserForm, bloodGroup: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-lg text-xs text-slate-200"
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] font-semibold text-slate-500 uppercase mb-1">Allergies</label>
                      <input
                        type="text"
                        value={editUserForm.allergies}
                        onChange={(e) => setEditUserForm({ ...editUserForm, allergies: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-lg text-xs text-slate-200"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[9px] font-semibold text-slate-500 uppercase mb-1">Emergency Contact Name</label>
                      <input
                        type="text"
                        value={editUserForm.emergencyContactName}
                        onChange={(e) => setEditUserForm({ ...editUserForm, emergencyContactName: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-lg text-xs text-slate-200"
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] font-semibold text-slate-500 uppercase mb-1">Emergency Contact Phone</label>
                      <input
                        type="text"
                        value={editUserForm.emergencyContactPhone}
                        onChange={(e) => setEditUserForm({ ...editUserForm, emergencyContactPhone: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-lg text-xs text-slate-200"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[9px] font-semibold text-slate-500 uppercase mb-1">Medical History Notes</label>
                    <textarea
                      rows={2}
                      value={editUserForm.medicalNotes}
                      onChange={(e) => setEditUserForm({ ...editUserForm, medicalNotes: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-lg text-xs text-slate-200"
                    />
                  </div>
                </div>
              )}

              {/* Driver/Ambulance Fields */}
              {editUserForm.role === 'DRIVER' && (
                <div className="bg-slate-950 border border-slate-850 p-4 rounded-2xl space-y-3">
                  <span className="text-[10px] font-bold text-blue-400 block uppercase tracking-wider font-mono">Driver Fleet Data</span>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[9px] font-semibold text-slate-500 uppercase mb-1">Vehicle License Plate</label>
                      <input
                        type="text"
                        value={editUserForm.vehicleNumber}
                        onChange={(e) => setEditUserForm({ ...editUserForm, vehicleNumber: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-lg text-xs text-slate-200"
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] font-semibold text-slate-500 uppercase mb-1">Ambulance Tier</label>
                      <select
                        value={editUserForm.ambulanceType}
                        onChange={(e) => setEditUserForm({ ...editUserForm, ambulanceType: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-lg text-xs text-slate-300"
                      >
                        <option value="BASIC_LIFE_SUPPORT">BASIC_LIFE_SUPPORT</option>
                        <option value="ADVANCED_LIFE_SUPPORT">ADVANCED_LIFE_SUPPORT</option>
                        <option value="OXYGEN_SUPPORT">OXYGEN_SUPPORT</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pt-2">
                    <input
                      type="checkbox"
                      id="isAvailable"
                      checked={editUserForm.isAvailable}
                      onChange={(e) => setEditUserForm({ ...editUserForm, isAvailable: e.target.checked })}
                      className="rounded border-slate-800 bg-slate-900 text-rose-600 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                    />
                    <label htmlFor="isAvailable" className="text-xs text-slate-350 font-medium cursor-pointer">On Duty (Available for Dispatch)</label>
                  </div>
                </div>
              )}

              <button
                type="submit"
                className="w-full py-3 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-semibold shadow-lg transition-colors cursor-pointer"
              >
                Save User Changes
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Feature 3: Edit Hospital Admin & Facility Modal */}
      {editingAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full p-6 space-y-6 shadow-2xl relative animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div>
                <h3 className="text-lg font-bold text-white">Edit Hospital Administrator</h3>
                <p className="text-xs text-slate-400">Update admin account details and facility information</p>
              </div>
              <button
                onClick={() => setEditingAdmin(null)}
                className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEditAdmin} className="space-y-4">
              <div className="bg-slate-950 border border-slate-850 p-4 rounded-2xl space-y-3">
                <span className="text-3xs font-bold text-rose-400 block uppercase tracking-wider font-mono">Admin Account Profile</span>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-3xs font-semibold text-slate-400 uppercase mb-1">Full Name</label>
                    <input
                      type="text"
                      required
                      value={editAdminForm.name}
                      onChange={(e) => setEditAdminForm({ ...editAdminForm, name: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 px-3 py-2 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-rose-500"
                    />
                  </div>
                  <div>
                    <label className="block text-3xs font-semibold text-slate-400 uppercase mb-1">Email Address</label>
                    <input
                      type="email"
                      required
                      value={editAdminForm.email}
                      onChange={(e) => setEditAdminForm({ ...editAdminForm, email: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 px-3 py-2 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-rose-500"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-3xs font-semibold text-slate-400 uppercase mb-1">Phone Number</label>
                  <input
                    type="tel"
                    value={editAdminForm.phone}
                    onChange={(e) => setEditAdminForm({ ...editAdminForm, phone: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-800 px-3 py-2 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-rose-500"
                  />
                </div>
              </div>

              {editingAdmin.hospital && (
                <div className="bg-slate-950 border border-slate-850 p-4 rounded-2xl space-y-3">
                  <span className="text-3xs font-bold text-emerald-400 block uppercase tracking-wider font-mono">Linked Facility Information</span>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-3xs font-semibold text-slate-400 uppercase mb-1">Facility Name</label>
                      <input
                        type="text"
                        value={editAdminForm.hospitalName}
                        onChange={(e) => setEditAdminForm({ ...editAdminForm, hospitalName: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-800 px-3 py-2 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-rose-500"
                      />
                    </div>
                    <div>
                      <label className="block text-3xs font-semibold text-slate-400 uppercase mb-1">Total Available Beds</label>
                      <input
                        type="number"
                        min="0"
                        value={editAdminForm.availableBeds}
                        onChange={(e) => setEditAdminForm({ ...editAdminForm, availableBeds: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-800 px-3 py-2 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-rose-500"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-3xs font-semibold text-slate-400 uppercase mb-1">Facility Address</label>
                    <input
                      type="text"
                      value={editAdminForm.address}
                      onChange={(e) => setEditAdminForm({ ...editAdminForm, address: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 px-3 py-2 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-rose-500"
                    />
                  </div>
                  <div>
                    <label className="block text-3xs font-semibold text-slate-400 uppercase mb-1">Emergency Desk Contact</label>
                    <input
                      type="tel"
                      value={editAdminForm.contactNumber}
                      onChange={(e) => setEditAdminForm({ ...editAdminForm, contactNumber: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 px-3 py-2 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-rose-500"
                    />
                  </div>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingAdmin(null)}
                  className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-rose-600/20 transition-colors cursor-pointer"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Feature 4: Accessible Confirmation Modal for Destructive/High-Impact Actions */}
      <ConfirmationModal
        isOpen={confirmModalConfig.isOpen}
        title={confirmModalConfig.title}
        description={confirmModalConfig.description}
        confirmLabel={confirmModalConfig.confirmLabel}
        cancelLabel={confirmModalConfig.cancelLabel}
        isDestructive={confirmModalConfig.isDestructive}
        loading={confirmActionLoading}
        requireReason={confirmModalConfig.requireReason}
        reasonLabel={confirmModalConfig.reasonLabel}
        onConfirm={confirmModalConfig.onConfirm}
        onCancel={() => setConfirmModalConfig((prev) => ({ ...prev, isOpen: false }))}
      />

      {/* Feature 3: Activity Log Payload Inspector Modal */}
      {selectedLogPayload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-850 rounded-3xl max-w-lg w-full p-6 space-y-4 shadow-2xl relative animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <span className="text-4xs font-mono font-bold uppercase text-rose-400">Activity Telemetry Inspector</span>
                <h3 className="text-sm font-bold text-white mt-0.5">{selectedLogPayload.action}</h3>
              </div>
              <button
                onClick={() => setSelectedLogPayload(null)}
                className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 text-2xs">
              <div className="flex justify-between py-1 border-b border-slate-850 font-mono">
                <span className="text-slate-500">Log ID:</span>
                <span className="text-slate-300">{selectedLogPayload.id}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-850 font-mono">
                <span className="text-slate-500">Administrator:</span>
                <span className="text-slate-300">{selectedLogPayload.admin?.name || selectedLogPayload.adminId || 'System'}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-850 font-mono">
                <span className="text-slate-500">Timestamp:</span>
                <span className="text-slate-300">{new Date(selectedLogPayload.timestamp).toLocaleString()}</span>
              </div>
            </div>

            <div>
              <label className="block text-3xs font-semibold text-slate-400 uppercase mb-1 font-mono">Metadata Payload (JSON)</label>
              <pre className="bg-slate-950 border border-slate-850 p-4 rounded-xl text-3xs font-mono text-emerald-400 overflow-x-auto max-h-60 leading-relaxed">
                {JSON.stringify(selectedLogPayload.metadata, null, 2)}
              </pre>
            </div>

            <button
              onClick={() => setSelectedLogPayload(null)}
              className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
            >
              Close Inspector
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
export default SuperAdminDashboard;
