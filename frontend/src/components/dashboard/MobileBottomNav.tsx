import React from 'react';
import { Home, Building2, ShieldAlert, CalendarCheck, User } from 'lucide-react';
import { type DashboardTab } from './DashboardSidebar';

interface MobileBottomNavProps {
  activeTab: DashboardTab;
  onSelectTab: (tab: DashboardTab) => void;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({ activeTab, onSelectTab }) => {
  return (
    <nav
      aria-label="Mobile Navigation"
      className="lg:hidden fixed bottom-0 left-0 right-0 h-16 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200/80 dark:border-slate-800 flex items-center justify-around px-2 z-50 transition-colors shadow-lg shadow-black/10"
    >
      {/* 1. Home */}
      <button
        type="button"
        onClick={() => onSelectTab('HOME')}
        className={`flex flex-col items-center justify-center gap-1 w-14 py-1 rounded-xl transition-colors cursor-pointer ${
          activeTab === 'HOME'
            ? 'text-teal-600 dark:text-teal-400 font-bold'
            : 'text-slate-500 dark:text-slate-400 hover:text-slate-900'
        }`}
      >
        <Home className="w-5 h-5" />
        <span className="text-[10px]">Home</span>
      </button>

      {/* 2. Hospitals */}
      <button
        type="button"
        onClick={() => onSelectTab('DIRECTORY')}
        className={`flex flex-col items-center justify-center gap-1 w-14 py-1 rounded-xl transition-colors cursor-pointer ${
          activeTab === 'DIRECTORY'
            ? 'text-teal-600 dark:text-teal-400 font-bold'
            : 'text-slate-500 dark:text-slate-400 hover:text-slate-900'
        }`}
      >
        <Building2 className="w-5 h-5" />
        <span className="text-[10px]">Hospitals</span>
      </button>

      {/* 3. Floating Emergency SOS Action */}
      <div className="relative -top-3">
        <button
          type="button"
          onClick={() => onSelectTab('SOS')}
          aria-label="Trigger Emergency SOS"
          className="w-13 h-13 rounded-full bg-rose-600 text-white shadow-lg shadow-rose-600/40 border-3 border-white dark:border-slate-900 flex items-center justify-center active:scale-95 transition-transform cursor-pointer"
        >
          <ShieldAlert className="w-6 h-6 animate-pulse" />
        </button>
      </div>

      {/* 4. Appointments */}
      <button
        type="button"
        onClick={() => onSelectTab('APPOINTMENTS')}
        className={`flex flex-col items-center justify-center gap-1 w-14 py-1 rounded-xl transition-colors cursor-pointer ${
          activeTab === 'APPOINTMENTS'
            ? 'text-teal-600 dark:text-teal-400 font-bold'
            : 'text-slate-500 dark:text-slate-400 hover:text-slate-900'
        }`}
      >
        <CalendarCheck className="w-5 h-5" />
        <span className="text-[10px]">Doctors</span>
      </button>

      {/* 5. Profile */}
      <button
        type="button"
        onClick={() => onSelectTab('PROFILE')}
        className={`flex flex-col items-center justify-center gap-1 w-14 py-1 rounded-xl transition-colors cursor-pointer ${
          activeTab === 'PROFILE'
            ? 'text-teal-600 dark:text-teal-400 font-bold'
            : 'text-slate-500 dark:text-slate-400 hover:text-slate-900'
        }`}
      >
        <User className="w-5 h-5" />
        <span className="text-[10px]">Profile</span>
      </button>
    </nav>
  );
};

