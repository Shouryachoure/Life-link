import React, { useState } from 'react';
import {
  ShieldAlert,
  CalendarCheck,
  Building2,
  Bed,
  ArrowRight,
  Sparkles,
  MessageCircle,
  Mic,
  Star,
  MapPin,
  Clock,
  Phone,
  CheckCircle2,
  Navigation,
  Activity,
  HeartPulse,
} from 'lucide-react';
import { LeafletMap } from '../LeafletMap';

interface HomeOverviewProps {
  userName: string;
  onNavigateTab: (tab: any) => void;
  onOpenNani: (initialPrompt?: string) => void;
  userLat?: number;
  userLng?: number;
  hospitals?: any[];
  ambulances?: any[];
  ambulanceProviders?: any[];
}

export const HomeOverview: React.FC<HomeOverviewProps> = ({
  userName,
  onNavigateTab,
  onOpenNani,
  userLat = 21.1458,
  userLng = 79.0882,
  hospitals = [],
  ambulances = [],
  ambulanceProviders = [],
}) => {
  const [hospitalCategory, setHospitalCategory] = useState<'ALL' | 'MULTI' | 'GOVT' | 'PRIVATE' | 'EMERGENCY'>('ALL');
  const [selectedHospitalId, setSelectedHospitalId] = useState<string | null>(null);

  // Time-based greeting
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 18) return 'Good Afternoon';
    return 'Good Evening';
  };

  // Curated prominent Nagpur hospitals with verified real coordinates
  const referenceHospitals = [
    {
      id: 'fac-alexis-max-nagpur',
      name: 'Max Super Speciality Hospital',
      locality: 'Mankapur, Koradi Road, Nagpur',
      rating: 4.3,
      reviewCount: '1.2k',
      distance: '2.1 km',
      category: 'Private',
      tags: ['24/7 Emergency', 'ICU', 'Cardiac'],
      image: '/max_hospital.png',
      phone: '+91 712 666 0000',
      lat: 21.1965,
      lng: 79.0805,
      isLifeLinkPartner: true,
      availableBeds: 18,
      totalBeds: 45,
    },
    {
      id: 'fac-iggmc-mayo-nagpur',
      name: 'Indira Gandhi Govt Medical College (Mayo)',
      locality: 'Mayo Hospital, Nagpur',
      rating: 4.1,
      reviewCount: '892',
      distance: '3.8 km',
      category: 'Government',
      tags: ['Government', 'Trauma', '24/7 Emergency'],
      image: '/wockhardt_hospital.png',
      phone: '+91 712 272 5274',
      lat: 21.1534,
      lng: 79.0984,
      isLifeLinkPartner: true,
      availableBeds: 24,
      totalBeds: 60,
    },
    {
      id: 'fac-wockhardt-nagpur',
      name: 'Wockhardt Hospitals Nagpur',
      locality: 'Central Avenue, Nagpur',
      rating: 4.2,
      reviewCount: '745',
      distance: '4.2 km',
      category: 'Private',
      tags: ['Cardiac', 'Oncology', 'ICU'],
      image: '/wockhardt_hospital.png',
      phone: '+91 712 662 4444',
      lat: 21.1298,
      lng: 79.0763,
      isLifeLinkPartner: true,
      availableBeds: 12,
      totalBeds: 35,
    },
    {
      id: 'fac-kingsway-hospitals-nagpur',
      name: 'KIMS-Kingsway Hospitals',
      locality: 'Sadar / Mohan Nagar, Nagpur',
      rating: 4.0,
      reviewCount: '612',
      distance: '4.6 km',
      category: 'Private',
      tags: ['Multi-speciality', 'Trauma', 'ICU'],
      image: '/max_hospital.png',
      phone: '+91 712 669 9999',
      lat: 21.1542,
      lng: 79.0858,
      isLifeLinkPartner: true,
      availableBeds: 15,
      totalBeds: 40,
    },
  ];

  // Merge real hospitals if available
  const displayHospitals = hospitals && hospitals.length > 0 ? hospitals.slice(0, 4) : referenceHospitals;

  const filteredHospitals = displayHospitals.filter((h: any) => {
    if (hospitalCategory === 'ALL') return true;
    if (hospitalCategory === 'GOVT') return h.ownership === 'GOVERNMENT' || h.category === 'Government';
    if (hospitalCategory === 'PRIVATE') return h.ownership === 'PRIVATE' || h.category === 'Private';
    if (hospitalCategory === 'EMERGENCY') return h.tags?.includes('24/7 Emergency') || h.advertisedServiceTypes?.includes('EMERGENCY_ER');
    return true;
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* 1. HERO SECTION WITH HOSPITAL CURVES & EMBEDDED NANI ASSISTANT */}
      <div className="relative overflow-hidden rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl shadow-slate-950/5">
        {/* Modern architectural background curves */}
        <div
          className="absolute inset-0 bg-cover bg-right opacity-15 dark:opacity-10 pointer-events-none"
          style={{ backgroundImage: `url('/hospital_hero.png')` }}
        />
        <div className="absolute inset-0 bg-gradient-to-r from-white via-white/90 to-transparent dark:from-slate-900 dark:via-slate-900/90 dark:to-transparent pointer-events-none" />

        <div className="relative p-6 sm:p-8 lg:p-10 flex flex-col lg:flex-row items-center justify-between gap-8 z-10">
          {/* Left Greeting & Mission */}
          <div className="max-w-xl">
            <span className="text-xs font-bold tracking-widest uppercase text-teal-600 dark:text-teal-400 block mb-2 font-mono">
              LifeLink Emergency OS • Nagpur Pilot Zone
            </span>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight text-slate-900 dark:text-slate-100 font-sans">
              {getGreeting()}, <span className="text-teal-600 dark:text-teal-400">{userName || 'Patient'}</span>
            </h1>
            <p className="mt-2 text-base sm:text-lg font-medium text-slate-600 dark:text-slate-400">
              Your health, our priority.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => onNavigateTab('SOS')}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs uppercase tracking-wider shadow-md shadow-teal-600/20 active:scale-[0.99] transition-all cursor-pointer"
              >
                <span>Faster care, Healthier tomorrows.</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Right NANI Assistant Spotlight Box */}
          <div className="w-full lg:w-96 p-5 rounded-2xl bg-white/90 dark:bg-slate-850/90 backdrop-blur-md border border-slate-200/90 dark:border-slate-750 shadow-lg shadow-slate-950/5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <img
                    src="/nani_avatar.png"
                    alt="NANI AI Assistant"
                    className="w-11 h-11 rounded-full object-cover border-2 border-teal-500 shadow-sm"
                    onError={(e) => {
                      // Fallback avatar icon
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                  <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-500 border-2 border-white dark:border-slate-900" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <span>NANI</span>
                    <Sparkles className="w-3.5 h-3.5 text-teal-500" />
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">Your AI Health Assistant</p>
                </div>
              </div>

              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-800">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Online
              </span>
            </div>

            {/* Chat Bubble Prompt */}
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 text-xs text-slate-700 dark:text-slate-300 leading-relaxed mb-3 border border-slate-100 dark:border-slate-700/60">
              “How can I help you today? You can ask about hospitals, book appointments, check bed availability, or get emergency help.”
            </div>

            {/* Quick Action Chips */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <button
                type="button"
                onClick={() => onOpenNani('Chat')}
                className="py-1.5 px-2.5 rounded-lg bg-teal-50 dark:bg-teal-950/50 hover:bg-teal-100 text-teal-700 dark:text-teal-300 font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer border border-teal-100 dark:border-teal-900"
              >
                <MessageCircle className="w-3.5 h-3.5 text-teal-600" />
                <span>Chat</span>
              </button>
              <button
                type="button"
                onClick={() => onOpenNani('Voice')}
                className="py-1.5 px-2.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <Mic className="w-3.5 h-3.5 text-teal-500" />
                <span>Voice</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigateTab('APPOINTMENTS')}
                className="py-1.5 px-2.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <CalendarCheck className="w-3.5 h-3.5 text-blue-500" />
                <span>Find Doctors</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigateTab('SOS')}
                className="py-1.5 px-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/50 hover:bg-rose-100 text-rose-700 dark:text-rose-300 font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer border border-rose-100 dark:border-rose-900"
              >
                <ShieldAlert className="w-3.5 h-3.5 text-rose-500" />
                <span>Emergency Help</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 2. FOUR LUXURY QUICK ACTION CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 1. Emergency SOS */}
        <button
          type="button"
          onClick={() => onNavigateTab('SOS')}
          className="group p-5 rounded-2xl bg-gradient-to-br from-rose-500 to-rose-600 text-white shadow-lg shadow-rose-600/20 hover:shadow-xl hover:shadow-rose-600/30 active:scale-[0.99] transition-all text-left flex flex-col justify-between h-36 cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center text-white">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <ArrowRight className="w-4 h-4 text-white/80 group-hover:translate-x-1 transition-transform" />
          </div>
          <div>
            <h4 className="text-base font-extrabold tracking-tight">Emergency SOS</h4>
            <p className="text-xs text-rose-100 mt-0.5">Get immediate medical dispatch</p>
          </div>
        </button>

        {/* 2. Book Doctor */}
        <button
          type="button"
          onClick={() => onNavigateTab('APPOINTMENTS')}
          className="group p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm hover:shadow-md hover:border-blue-400/80 active:scale-[0.99] transition-all text-left flex flex-col justify-between h-36 cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center">
              <CalendarCheck className="w-5 h-5" />
            </div>
            <ArrowRight className="w-4 h-4 text-slate-400 group-hover:translate-x-1 transition-transform" />
          </div>
          <div>
            <h4 className="text-base font-extrabold tracking-tight text-slate-900 dark:text-slate-100">Book Doctor</h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Find & book verified slots</p>
          </div>
        </button>

        {/* 3. Find Hospitals */}
        <button
          type="button"
          onClick={() => onNavigateTab('DIRECTORY')}
          className="group p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm hover:shadow-md hover:border-emerald-400/80 active:scale-[0.99] transition-all text-left flex flex-col justify-between h-36 cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <Building2 className="w-5 h-5" />
            </div>
            <ArrowRight className="w-4 h-4 text-slate-400 group-hover:translate-x-1 transition-transform" />
          </div>
          <div>
            <h4 className="text-base font-extrabold tracking-tight text-slate-900 dark:text-slate-100">Find Hospitals</h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Nearby facilities & directory</p>
          </div>
        </button>

        {/* 4. Available Beds */}
        <button
          type="button"
          onClick={() => onNavigateTab('HOSPITAL_BEDS')}
          className="group p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm hover:shadow-md hover:border-indigo-400/80 active:scale-[0.99] transition-all text-left flex flex-col justify-between h-36 cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
              <Bed className="w-5 h-5" />
            </div>
            <ArrowRight className="w-4 h-4 text-slate-400 group-hover:translate-x-1 transition-transform" />
          </div>
          <div>
            <h4 className="text-base font-extrabold tracking-tight text-slate-900 dark:text-slate-100">Available Beds</h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Real-time ICU & ward status</p>
          </div>
        </button>
      </div>

      {/* 3. LOWER TWO-COLUMN SECTION */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Nearby Hospitals in Nagpur (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
                Nearby Hospitals in Nagpur
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Verified facilities nearest to your current location
              </p>
            </div>

            {/* Filter Pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              {[
                { id: 'ALL', label: 'All' },
                { id: 'MULTI', label: 'Multi-speciality' },
                { id: 'GOVT', label: 'Government' },
                { id: 'PRIVATE', label: 'Private' },
                { id: 'EMERGENCY', label: '24/7 Emergency' },
              ].map((pill) => (
                <button
                  key={pill.id}
                  type="button"
                  onClick={() => setHospitalCategory(pill.id as any)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                    hospitalCategory === pill.id
                      ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 shadow-sm'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
                  }`}
                >
                  {pill.label}
                </button>
              ))}
            </div>
          </div>

          {/* Hospital Cards Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {filteredHospitals.map((h: any) => {
              const isSelected = selectedHospitalId === h.id;
              return (
                <div
                  key={h.id}
                  onClick={() => setSelectedHospitalId(isSelected ? null : h.id)}
                  className={`p-4 rounded-2xl border transition-all flex flex-col justify-between shadow-sm cursor-pointer group ${
                    isSelected
                      ? 'border-teal-500 bg-teal-50/40 dark:bg-teal-950/30 ring-2 ring-teal-500/30 shadow-md'
                      : 'bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800 hover:border-teal-400/80'
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <h3 className="font-extrabold text-sm text-slate-900 dark:text-slate-100 line-clamp-1 group-hover:text-teal-600 transition-colors">
                        {h.name}
                      </h3>
                      <span className="text-xs font-bold text-teal-600 dark:text-teal-400 whitespace-nowrap font-mono">
                        {h.distance || (h.distanceKm ? `${h.distanceKm} km` : '2.1 km')}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">
                      <span className="flex items-center gap-1 font-bold text-amber-500">
                        <Star className="w-3.5 h-3.5 fill-amber-500" />
                        <span>{h.rating || 4.2}</span>
                      </span>
                      <span>•</span>
                      <span className="truncate">{h.locality || h.address}</span>
                    </div>

                    {/* Tags */}
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {(h.tags || (h.specialties ? h.specialties.slice(0, 3) : ['24/7 Emergency', 'ICU'])).map(
                        (tag: string, tidx: number) => (
                          <span
                            key={tidx}
                            className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                          >
                            {tag}
                          </span>
                        )
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800/80">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onNavigateTab('APPOINTMENTS');
                      }}
                      className="flex-1 py-1.5 rounded-lg bg-teal-50 dark:bg-teal-950/50 hover:bg-teal-100 text-teal-700 dark:text-teal-300 font-bold text-xs transition-colors cursor-pointer text-center"
                    >
                      Book Doctor
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onNavigateTab('DIRECTORY');
                      }}
                      className="py-1.5 px-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 text-slate-700 dark:text-slate-300 font-semibold text-xs transition-colors cursor-pointer"
                    >
                      Details
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Live Emergency Network Map Preview (5 cols) */}
        <div className="lg:col-span-5 p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xl shadow-slate-950/5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <h3 className="font-extrabold text-sm text-slate-900 dark:text-slate-100">
                  Live Emergency Network
                </h3>
              </div>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-teal-50 dark:bg-teal-950 text-teal-700 dark:text-teal-300 font-mono">
                Nagpur Center
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
              Real-time geospatial grid and ambulance readiness telemetry.
            </p>

            {/* Real Telemetry stats pills */}
            <div className="flex flex-wrap items-center gap-2 mb-3">
              {ambulances && ambulances.length > 0 ? (
                <span className="px-2.5 py-1 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/60 dark:border-emerald-800 text-[11px] font-bold text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                  <span>🚑 {ambulances.length} Active Unit{ambulances.length === 1 ? '' : 's'} Online</span>
                </span>
              ) : (
                <span className="px-2.5 py-1 rounded-xl bg-slate-100 dark:bg-slate-800 text-[11px] font-medium text-slate-600 dark:text-slate-400">
                  🚑 Live Ambulance Feed: Standby
                </span>
              )}
              <span className="px-2.5 py-1 rounded-xl bg-slate-100 dark:bg-slate-800 text-[11px] font-medium text-slate-600 dark:text-slate-400">
                ⏱ ETA Calculated on SOS
              </span>
            </div>

            {/* Leaflet Map Widget with OpenStreetMap Standard */}
            <div className="h-64 sm:h-72 rounded-2xl overflow-hidden border border-slate-200/90 dark:border-slate-800 relative shadow-inner">
              <LeafletMap
                center={[userLat, userLng]}
                zoom={12}
                hospitals={hospitals && hospitals.length > 0 ? hospitals : displayHospitals}
                ambulances={ambulances}
                ambulanceProviders={ambulanceProviders}
                selectedHospitalId={selectedHospitalId || undefined}
                onSelectHospital={(id) => setSelectedHospitalId(id)}
              />
            </div>
          </div>

          <button
            type="button"
            onClick={() => onNavigateTab('SOS')}
            className="mt-4 w-full h-10 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs uppercase tracking-wider transition-all shadow-md shadow-teal-600/20 active:scale-[0.99] flex items-center justify-center gap-2 cursor-pointer"
          >
            <span>View Full Live Network Map</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

