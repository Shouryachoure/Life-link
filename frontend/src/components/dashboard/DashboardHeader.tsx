import React, { useState, useEffect } from 'react';
import {
  Search,
  MapPin,
  Bell,
  Sun,
  Calendar,
  LogOut,
  User,
  Check,
  ChevronDown,
  Building2,
  Stethoscope,
  HeartPulse,
} from 'lucide-react';
import { ThemeToggle } from '../ui/ThemeToggle';
import { NetworkStatusIndicator } from '../ui/NetworkStatusIndicator';
import { type SupportedLanguage } from '../../utils/localization';

interface DashboardHeaderProps {
  userName: string;
  userRole?: string;
  lang: SupportedLanguage;
  onLanguageChange: (lang: SupportedLanguage) => void;
  onSearchSelect?: (type: 'hospital' | 'doctor' | 'specialty', query: string) => void;
  onNavigateTab: (tab: any) => void;
  unreadNotificationsCount?: number;
  onLogout: () => void;
}

export const DashboardHeader: React.FC<DashboardHeaderProps> = ({
  userName,
  userRole = 'PATIENT',
  lang,
  onLanguageChange,
  onSearchSelect,
  onNavigateTab,
  unreadNotificationsCount = 3,
  onLogout,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const [currentDateStr, setCurrentDateStr] = useState('');

  useEffect(() => {
    const now = new Date();
    const options: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' };
    setCurrentDateStr(now.toLocaleDateString('en-US', options));
  }, []);

  const sampleQuickSuggestions = [
    { type: 'hospital', title: 'Max Super Speciality Hospital', subtitle: 'Mankapur, Koradi Road • Open 24/7' },
    { type: 'hospital', title: 'Indira Gandhi Govt Medical College', subtitle: 'Mayo Hospital, Nagpur • Government' },
    { type: 'hospital', title: 'Wockhardt Hospitals Nagpur', subtitle: 'Central Avenue • Cardiology & ICU' },
    { type: 'doctor', title: 'Dr. Husain Bhati', subtitle: 'Neurosurgeon • 12+ Years Exp' },
    { type: 'doctor', title: 'Dr. Priya Sharma', subtitle: 'Cardiologist • 10+ Years Exp' },
    { type: 'specialty', title: 'Emergency ER / Trauma Care', subtitle: 'Critical Care & Resuscitation' },
  ];

  const filteredSuggestions = searchQuery.trim()
    ? sampleQuickSuggestions.filter((s) => s.title.toLowerCase().includes(searchQuery.toLowerCase()) || s.subtitle.toLowerCase().includes(searchQuery.toLowerCase()))
    : sampleQuickSuggestions.slice(0, 4);

  const handleSelectSuggestion = (item: (typeof sampleQuickSuggestions)[0]) => {
    if (onSearchSelect) {
      onSearchSelect(item.type as any, item.title);
    }
    if (item.type === 'hospital') {
      onNavigateTab('DIRECTORY');
    } else if (item.type === 'doctor') {
      onNavigateTab('APPOINTMENTS');
    } else {
      onNavigateTab('DIRECTORY');
    }
    setShowSearchDropdown(false);
    setSearchQuery('');
  };

  return (
    <header className="h-18 px-4 sm:px-8 border-b border-slate-200/80 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md flex items-center justify-between gap-4 sticky top-0 z-30 transition-colors">
      {/* Global Search Bar */}
      <div className="relative flex-1 max-w-lg hidden md:block">
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setShowSearchDropdown(true)}
            onBlur={() => setTimeout(() => setShowSearchDropdown(false), 200)}
            placeholder="Search hospitals, doctors, specialties, symptoms..."
            className="w-full h-10 pl-10 pr-4 bg-slate-100/80 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/60 rounded-xl text-xs sm:text-sm outline-none focus:border-teal-500 focus:bg-white dark:focus:bg-slate-900 focus:ring-4 focus:ring-teal-500/10 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 transition-all"
          />
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
        </div>

        {/* Live Search Suggestions Dropdown */}
        {showSearchDropdown && (
          <div className="absolute left-0 right-0 top-12 mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl p-2 z-50 text-xs animate-in fade-in zoom-in-95 duration-150">
            <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Suggestions & Directory
            </div>
            {filteredSuggestions.length > 0 ? (
              filteredSuggestions.map((item, idx) => (
                <button
                  key={idx}
                  type="button"
                  onMouseDown={() => handleSelectSuggestion(item)}
                  className="w-full text-left px-3 py-2 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/80 flex items-center gap-2.5 transition-colors cursor-pointer"
                >
                  <div className="p-1.5 rounded-lg bg-teal-50 dark:bg-teal-950/60 text-teal-600 dark:text-teal-400">
                    {item.type === 'hospital' ? (
                      <Building2 className="w-3.5 h-3.5" />
                    ) : item.type === 'doctor' ? (
                      <Stethoscope className="w-3.5 h-3.5" />
                    ) : (
                      <HeartPulse className="w-3.5 h-3.5" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-800 dark:text-slate-200 truncate">{item.title}</p>
                    <p className="text-[11px] text-slate-400 truncate">{item.subtitle}</p>
                  </div>
                </button>
              ))
            ) : (
              <p className="p-3 text-center text-slate-400 text-xs">No matching healthcare records found.</p>
            )}
          </div>
        )}
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-2 sm:gap-3 ml-auto">
        {/* Location Pill */}
        <div className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100/90 dark:bg-slate-800/90 text-xs font-semibold text-slate-700 dark:text-slate-300 border border-slate-200/80 dark:border-slate-700/60 shadow-sm">
          <MapPin className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
          <span>Nagpur, Maharashtra</span>
        </div>

        {/* Weather Indicator */}
        <div className="hidden xl:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100/90 dark:bg-slate-800/90 text-xs font-semibold text-slate-700 dark:text-slate-300 border border-slate-200/80 dark:border-slate-700/60 shadow-sm">
          <Sun className="w-3.5 h-3.5 text-amber-500" />
          <span>28°C Clear</span>
        </div>

        {/* Date Indicator */}
        <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100/90 dark:bg-slate-800/90 text-xs font-semibold text-slate-700 dark:text-slate-300 border border-slate-200/80 dark:border-slate-700/60 shadow-sm">
          <Calendar className="w-3.5 h-3.5 text-slate-500" />
          <span>{currentDateStr || 'Mon, 28 Oct'}</span>
        </div>

        {/* Notifications Button */}
        <button
          type="button"
          onClick={() => onNavigateTab('NOTIFICATIONS')}
          title="Notifications"
          className="relative w-9 h-9 rounded-xl flex items-center justify-center border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 shadow-sm transition-colors cursor-pointer"
        >
          <Bell className="w-4 h-4" />
          {unreadNotificationsCount > 0 && (
            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-white dark:ring-slate-900" />
          )}
        </button>

        {/* Language Selector */}
        <select
          value={lang}
          onChange={(e) => onLanguageChange(e.target.value as SupportedLanguage)}
          aria-label="Language selection"
          className="h-9 px-2.5 rounded-xl bg-slate-100/90 dark:bg-slate-800/90 border border-slate-200/80 dark:border-slate-700/60 text-xs font-bold text-slate-700 dark:text-slate-300 outline-none cursor-pointer"
        >
          <option value="en">EN</option>
          <option value="hi">हिन्दी</option>
          <option value="mr">मराठी</option>
        </select>

        {/* Unified 3-Way Theme Control (Light / Dark / System) */}
        <ThemeToggle variant="segmented" />

        {/* Logout Quick Action */}
        <button
          type="button"
          onClick={onLogout}
          title="Sign Out"
          className="w-9 h-9 rounded-xl flex items-center justify-center border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-500 hover:text-rose-600 hover:border-rose-200 dark:hover:border-rose-900 shadow-sm transition-colors cursor-pointer"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};

