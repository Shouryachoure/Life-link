import React from 'react';
import {
  Home,
  ShieldAlert,
  Building2,
  CalendarCheck,
  Bed,
  User,
  Truck,
  Sparkles,
  Bell,
  Activity,
  Settings,
  ChevronRight,
} from 'lucide-react';

export type DashboardTab =
  | 'HOME'
  | 'SOS'
  | 'DIRECTORY'
  | 'APPOINTMENTS'
  | 'HOSPITAL_BEDS'
  | 'PROFILE'
  | 'HISTORY'
  | 'NANI'
  | 'NOTIFICATIONS'
  | 'HEALTH_METRICS'
  | 'SETTINGS';

interface DashboardSidebarProps {
  activeTab: DashboardTab;
  onSelectTab: (tab: DashboardTab) => void;
  userName: string;
  userRole?: string;
  unreadNotifications?: number;
}

export const DashboardSidebar: React.FC<DashboardSidebarProps> = ({
  activeTab,
  onSelectTab,
  userName,
  userRole = 'PATIENT',
  unreadNotifications = 3,
}) => {
  const navItems = [
    { id: 'HOME' as DashboardTab, label: 'Home', icon: Home, accent: 'text-teal-600 dark:text-teal-400' },
    { id: 'SOS' as DashboardTab, label: 'Emergency SOS', icon: ShieldAlert, accent: 'text-rose-500', isEmergency: true },
    { id: 'DIRECTORY' as DashboardTab, label: 'Find Hospitals', icon: Building2, accent: 'text-emerald-500' },
    { id: 'APPOINTMENTS' as DashboardTab, label: 'Book Doctor', icon: CalendarCheck, accent: 'text-blue-500' },
    { id: 'HOSPITAL_BEDS' as DashboardTab, label: 'Available Beds', icon: Bed, accent: 'text-indigo-500' },
    { id: 'PROFILE' as DashboardTab, label: 'Medical Profile', icon: User, accent: 'text-teal-600 dark:text-teal-400' },
    { id: 'HISTORY' as DashboardTab, label: 'Ride & Ambulance', icon: Truck, accent: 'text-amber-500' },
    { id: 'NANI' as DashboardTab, label: 'NANI Assistant', icon: Sparkles, accent: 'text-teal-600 dark:text-teal-400', isAi: true },
    { id: 'NOTIFICATIONS' as DashboardTab, label: 'Notifications', icon: Bell, badge: unreadNotifications, accent: 'text-slate-500' },
    { id: 'HEALTH_METRICS' as DashboardTab, label: 'Health Records', icon: Activity, accent: 'text-rose-500' },
    { id: 'SETTINGS' as DashboardTab, label: 'Settings', icon: Settings, accent: 'text-slate-400' },
  ];

  const userInitial = userName ? userName.charAt(0).toUpperCase() : 'P';

  return (
    <aside className="w-64 h-screen sticky top-0 bg-white/95 dark:bg-slate-900/95 border-r border-slate-200/80 dark:border-slate-800 flex flex-col justify-between p-4 z-40 transition-colors select-none shrink-0 hidden lg:flex">
      {/* Brand Header */}
      <div>
        <div className="flex items-center gap-3 px-3 py-3 mb-4">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-teal-600 to-teal-500 flex items-center justify-center text-white shadow-md shadow-teal-600/30">
            <span className="font-mono font-black text-lg">✚</span>
          </div>
          <div>
            <span className="text-base font-black tracking-tight uppercase font-mono text-slate-900 dark:text-slate-100 block leading-tight">
              LifeLink
            </span>
            <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 tracking-wider">
              Care Beyond Time
            </span>
          </div>
        </div>

        {/* Navigation List */}
        <nav className="space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  isActive
                    ? item.isEmergency
                      ? 'bg-rose-600 text-white shadow-md shadow-rose-600/20'
                      : 'bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 shadow-sm border border-teal-200/50 dark:border-teal-900/40'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100/70 dark:hover:bg-slate-800/60'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon
                    className={`w-4 h-4 ${
                      isActive ? (item.isEmergency ? 'text-white' : 'text-teal-600 dark:text-teal-400') : item.accent
                    }`}
                  />
                  <span>{item.label}</span>
                </div>

                {item.badge !== undefined && item.badge > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full text-[10px] font-black bg-rose-500 text-white leading-none">
                    {item.badge}
                  </span>
                )}

                {item.isAi && !isActive && (
                  <span className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse" />
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Bottom User Card */}
      <div
        onClick={() => onSelectTab('PROFILE')}
        className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800 hover:border-teal-300 dark:hover:border-teal-800/80 transition-colors cursor-pointer flex items-center justify-between group"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-slate-200 to-slate-300 dark:from-slate-700 dark:to-slate-600 flex items-center justify-center font-bold text-slate-800 dark:text-slate-100 shadow-inner shrink-0">
            {userInitial}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate group-hover:text-teal-600 dark:group-hover:text-teal-400 transition-colors">
              {userName || 'Patient'}
            </p>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">View Profile</p>
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
      </div>
    </aside>
  );
};

