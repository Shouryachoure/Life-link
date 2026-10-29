import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { 
  Search, 
  Sparkles, 
  Inbox, 
  Star, 
  Send, 
  FileText, 
  Archive, 
  Trash2, 
  MoreHorizontal, 
  Paperclip, 
  ChevronRight, 
  Menu, 
  Check, 
  X,
  ArrowRight,
  ShieldAlert,
  Truck,
  Building,
  User,
  Heart,
  Settings,
  AlertCircle,
  Activity,
  ShieldCheck
} from 'lucide-react';
import { SystemHealthModal } from '../components/ui/SystemHealthModal';
import { ThemeToggle } from '../components/ui/ThemeToggle';

// -------------------------------------------------------------
// Shared Primitive Components
// -------------------------------------------------------------

const AppleLogo: React.FC<{ className?: string }> = ({ className = "w-4 h-4" }) => (
  <svg 
    viewBox="0 0 384 512" 
    fill="currentColor" 
    className={className}
  >
    <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
  </svg>
);

const LogoMark: React.FC<{ className?: string }> = ({ className = "w-8 h-8" }) => (
  <svg 
    viewBox="0 0 256 256" 
    fill="currentColor" 
    className={className}
  >
    <path d="M 0 128 C 70.692 128 128 185.308 128 256 L 64 256 C 64 220.654 35.346 192 0 192 Z M 256 192 C 220.654 192 192 220.654 192 256 L 128 256 C 128 185.308 185.308 128 256 128 Z M 128 0 C 128 70.692 70.692 128 0 128 L 0 64 C 35.346 64 64 35.346 64 0 Z M 192 0 C 192 35.346 220.654 64 256 64 L 256 128 C 185.308 128 128 70.692 128 0 Z" />
  </svg>
);

const AppleButton: React.FC<{ label: string; full?: boolean }> = ({ label, full = false }) => (
  <div className={`group inline-flex items-center justify-center gap-2 rounded-full bg-rose-600 text-white font-semibold text-xs px-5 py-3 transition-all hover:bg-rose-500 active:scale-[0.98] cursor-pointer ${full ? 'w-full' : ''}`}>
    <ShieldAlert className="w-3.5 h-3.5" />
    <span>{label}</span>
    <ChevronRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-[1px]" />
  </div>
);

const SectionEyebrow: React.FC<{ label: string; tag?: string }> = ({ label, tag }) => (
  <div className="flex items-center gap-3">
    <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
    <span className="text-[10px] font-extrabold tracking-widest text-slate-400 uppercase font-mono">{label}</span>
    {tag && (
      <span className="px-2.5 py-0.5 rounded-full border border-rose-500/20 bg-rose-500/[0.02] text-rose-400 text-[9px] uppercase font-mono font-bold">
        {tag}
      </span>
    )}
  </div>
);

const gradientStyle: React.CSSProperties = {
  backgroundImage: 'linear-gradient(to right, #091020 0%, #3a0b12 12.5%, #f43f5e 32.5%, #f43f5e 50%, #3a0b12 67.5%, #091020 87.5%, #091020 100%)',
  backgroundSize: '200% auto',
  WebkitBackgroundClip: 'text',
  backgroundClip: 'text',
  color: 'transparent',
  filter: 'url(#c3-noise)',
};

// -------------------------------------------------------------
// Mock Data for Interactive Live Dispatch Mockup
// -------------------------------------------------------------

interface DispatchAlert {
  id: string;
  patientName: string;
  ageGender: string;
  avatarChar: string;
  avatarGradient: string;
  incidentType: string;
  preview: string;
  time: string;
  severity: 'Critical' | 'High' | 'Medium' | 'Low';
  summary: string;
  eventLogs: string[];
  attachmentName?: string;
  unread?: boolean;
}

const mockDispatches: DispatchAlert[] = [
  {
    id: 'trip-108',
    patientName: 'Sophia Chen',
    ageGender: '54, Female',
    avatarChar: 'S',
    avatarGradient: 'from-red-500 to-rose-700',
    incidentType: 'Cardiac Arrest',
    preview: 'Patient presents with crushing substernal chest pain...',
    time: '9:41 AM',
    severity: 'Critical',
    summary: 'Patient presenting with crushing substernal chest pain radiating to left arm. Heart Rate: 110 bpm, Blood Pressure: 145/95 mmHg, SpO2: 92%. Assigned Driver: Medic-12 (ALS Support). AI Recommendation: General Hospital ER (ETA: 4 minutes via OSRM turn-by-turn routing).',
    eventLogs: [
      '09:41 AM — SOS panic button pressed by patient.',
      '09:42 AM — Incident matched with Medic-12 (ALS Support).',
      '09:43 AM — Live coordinate simulation broadcasting via Socket.',
      '09:44 AM — Medical records shared with receiving ER board.'
    ],
    attachmentName: 'Sophia_Chen_EHR.pdf',
    unread: true
  },
  {
    id: 'trip-109',
    patientName: 'Marcus Vance',
    ageGender: '29, Male',
    avatarChar: 'M',
    avatarGradient: 'from-amber-500 to-rose-600',
    incidentType: 'Trauma / Car Collision',
    preview: 'High-velocity impact, patient trapped in vehicle...',
    time: '8:12 AM',
    severity: 'Critical',
    summary: 'High-speed motor vehicle collision. Patient suffers multiple extremity fractures and deep lacerations. Level-1 trauma response initiated. Assigned Driver: Medic-04 (ALS). ETA: 6 mins.',
    eventLogs: [
      '08:12 AM — Bystander reported incident via public SOS.',
      '08:13 AM — Dispatch matched to Medic-04.',
      '08:15 AM — OSRM turn-by-turn routing active, driver in transit.',
      '08:18 AM — Trauma surgeon and ER team pre-alerted.'
    ],
    unread: true
  },
  {
    id: 'trip-110',
    patientName: 'David Lim',
    ageGender: '67, Male',
    avatarChar: 'D',
    avatarGradient: 'from-yellow-450 to-orange-600',
    incidentType: 'Respiratory Distress',
    preview: 'Patient experiencing acute bronchospasm, inhaler unresponsive...',
    time: 'Yesterday',
    severity: 'High',
    summary: 'Patient experiencing severe dyspnea, accessory muscle use observed. SpO2 at 85% on room air. Oxygen support ambulance routed immediately.',
    eventLogs: [
      '07:30 PM — SOS trigger by patient smart watch.',
      '07:32 PM — Medic-09 dispatched with oxygen-support rig.',
      '07:35 PM — Live GPS coordinates syncing with dispatch board.'
    ]
  },
  {
    id: 'trip-111',
    patientName: 'Sarah Connor',
    ageGender: '42, Female',
    avatarChar: 'S',
    avatarGradient: 'from-amber-600 to-red-800',
    incidentType: 'Severe Burn Injury',
    preview: 'Second-degree chemical burn on right forearm...',
    time: 'Yesterday',
    severity: 'High',
    summary: 'Industrial chemical spill resulting in second-degree burns on right upper extremity. Decontamination protocols advised. General Hospital Burn Center selected.',
    eventLogs: [
      '04:15 PM — ER alert received from chemical facility console.',
      '04:17 PM — Medic-02 routed for specialized chemical trauma response.'
    ]
  },
  {
    id: 'trip-112',
    patientName: 'Kyle Reese',
    ageGender: '31, Male',
    avatarChar: 'K',
    avatarGradient: 'from-blue-600 to-indigo-800',
    incidentType: 'Suspected Fracture',
    preview: 'Fall from ladder, closed deformity of right tibia...',
    time: 'Mon',
    severity: 'Medium',
    summary: 'Patient fell from 8ft ladder. Closed deformity and swelling of lower leg. Distal pulses intact. Splinting advised.',
    eventLogs: [
      '11:05 AM — Patient registered fracture request.',
      '11:07 AM — Driver matched (BLS Support Rig).'
    ]
  },
  {
    id: 'trip-113',
    patientName: 'John Connor',
    ageGender: '15, Male',
    avatarChar: 'J',
    avatarGradient: 'from-emerald-500 to-teal-700',
    incidentType: 'Minor Laceration',
    preview: 'Laceration to palm from broken glass, bleeding controlled...',
    time: 'Mon',
    severity: 'Low',
    summary: 'Superficial 3cm laceration to hand. Bleeding controlled via pressure dressing. General sutures required.',
    eventLogs: [
      '09:00 AM — Patient requested non-emergency suture dispatch.'
    ],
    attachmentName: 'John_Connor_ID.pdf'
  }
];

// -------------------------------------------------------------
// Component Definition
// -------------------------------------------------------------

export const Landing: React.FC = () => {
  const navigate = useNavigate();
  const [activeDispatch, setActiveDispatch] = useState<DispatchAlert>(mockDispatches[0]);
  const [dispatches, setDispatches] = useState<DispatchAlert[]>(mockDispatches);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [healthModalOpen, setHealthModalOpen] = useState(false);

  // Mark dispatch as read when clicked
  const handleSelectDispatch = (msg: DispatchAlert) => {
    setActiveDispatch(msg);
    setDispatches(prev => prev.map(m => m.id === msg.id ? { ...m, unread: false } : m));
  };

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#0c0c0c] text-white font-sans selection:bg-rose-650/30">
      
      {/* -------------------------------------------------------------
          Global Background Video & Overlay Elements
          ------------------------------------------------------------- */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <video 
          autoPlay 
          loop 
          muted 
          playsInline
          className="w-full h-full object-cover pointer-events-none opacity-45"
          src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260508_064122_c4750c0e-7476-4b44-94a2-a85a65c63bf2.mp4" 
        />
      </div>

      {/* Hidden-on-mobile fixed vertical guide lines */}
      <div className="hidden md:block pointer-events-none fixed inset-y-0 left-1/2 -translate-x-[calc(50%+36rem)] w-px bg-white/10 z-[5]" />
      <div className="hidden md:block pointer-events-none fixed inset-y-0 left-1/2 translate-x-[calc(-50%+36rem)] w-px bg-white/10 z-[5]" />

      {/* Global SVG noise filters (id: c3-noise) */}
      <svg className="absolute w-0 h-0 pointer-events-none">
        <defs>
          <filter id="c3-noise">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
            <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.35 0" />
            <feComposite in2="SourceGraphic" operator="in" result="noise" />
            <feBlend in="SourceGraphic" in2="noise" mode="multiply" />
          </filter>
        </defs>
      </svg>

      {/* -------------------------------------------------------------
          Section 1 — Navbar
          ------------------------------------------------------------- */}
      <motion.nav 
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="relative z-55 max-w-6xl mx-auto px-6 py-6 flex items-center justify-between"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-rose-600 flex items-center justify-center shadow-lg shadow-rose-600/25">
            <ShieldAlert className="w-5 h-5 text-white" />
          </div>
          <span className="text-lg font-black tracking-tight text-white uppercase font-mono">LifeLink</span>
        </div>

        {/* Center Nav Links (Desktop) */}
        <div className="hidden md:flex items-center gap-8 bg-white/[0.02] border border-white/5 backdrop-blur-md px-6 py-2.5 rounded-full">
          {['Solutions', 'Portals', 'Documentation'].map((link, idx) => (
            <motion.a
              key={link}
              href={`#${link.toLowerCase()}`}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + idx * 0.05, duration: 0.4 }}
              className="text-white/70 text-xs font-semibold hover:text-white transition-colors tracking-wide"
            >
              {link}
            </motion.a>
          ))}
        </div>

        {/* Right Nav Action */}
        <div className="hidden md:flex items-center gap-3">
          <ThemeToggle />
          <button
            onClick={() => setHealthModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-xs font-semibold font-mono transition-colors cursor-pointer"
          >
            <Activity className="w-3.5 h-3.5 animate-pulse" />
            <span>System Health</span>
          </button>
          <Link to="/register-hospital" className="text-white/70 hover:text-emerald-400 text-xs font-semibold px-2.5 py-1.5 transition-colors">
            Register Hospital
          </Link>
          <Link to="/admin/login" className="text-white/60 hover:text-white text-xs font-semibold px-2.5 py-1.5 transition-colors">
            Hospital Staff
          </Link>
          <Link to="/login" className="text-white/80 hover:text-white text-xs font-bold uppercase tracking-wider px-3 py-2 transition-colors">
            Sign In
          </Link>
          <Link to="/register">
            <AppleButton label="Emergency SOS" />
          </Link>
        </div>

        {/* Mobile Menu Toggle */}
        <div className="md:hidden">
          <button 
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="w-10 h-10 rounded-full border border-white/10 bg-white/5 flex items-center justify-center text-white cursor-pointer"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </motion.nav>

      {/* Mobile Drawer Menu */}
      {mobileMenuOpen && (
        <motion.div 
          initial={{ opacity: 0, y: -15 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute top-20 left-6 right-6 z-40 bg-[#0e1014]/95 border border-white/15 rounded-3xl p-6 shadow-2xl backdrop-blur-xl md:hidden space-y-4"
        >
          <div className="flex flex-col gap-4 text-left">
            {['Solutions', 'Portals', 'Documentation'].map((link) => (
              <a 
                key={link}
                href={`#${link.toLowerCase()}`} 
                onClick={() => setMobileMenuOpen(false)}
                className="text-white/70 text-sm font-semibold tracking-wide py-2 border-b border-white/5 hover:text-white"
              >
                {link}
              </a>
            ))}
            <div className="flex items-center justify-between py-2 border-b border-white/5">
              <span className="text-white/70 text-xs font-semibold">Theme</span>
              <ThemeToggle />
            </div>
            <button
              onClick={() => { setMobileMenuOpen(false); setHealthModalOpen(true); }}
              className="w-full flex items-center justify-center gap-2 text-rose-400 bg-rose-950/20 border border-rose-500/20 text-xs font-bold py-2.5 rounded-xl font-mono cursor-pointer"
            >
              <Activity className="w-4 h-4 animate-pulse" />
              <span>System Health Diagnostic</span>
            </button>
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/5">
              <Link to="/register-hospital" onClick={() => setMobileMenuOpen(false)} className="flex items-center justify-center text-emerald-400 bg-emerald-950/20 border border-emerald-500/20 text-2xs font-bold py-2.5 rounded-xl">
                Register Hospital
              </Link>
              <Link to="/admin/login" onClick={() => setMobileMenuOpen(false)} className="flex items-center justify-center text-white/70 bg-white/5 border border-white/10 text-2xs font-bold py-2.5 rounded-xl">
                Hospital Staff
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <Link to="/login" onClick={() => setMobileMenuOpen(false)} className="flex items-center justify-center text-white border border-white/10 text-xs font-bold uppercase tracking-wider py-3.5 rounded-xl">
                Sign In
              </Link>
              <Link to="/register" onClick={() => setMobileMenuOpen(false)}>
                <AppleButton label="SOS Alert" full />
              </Link>
            </div>
          </div>
        </motion.div>
      )}

      {/* -------------------------------------------------------------
          Section 2 — Hero
          ------------------------------------------------------------- */}
      <section className="relative z-10 max-w-6xl mx-auto px-6 pt-16 md:pt-28 pb-20 text-center flex flex-col items-center">
        
        {/* Animated Main Title */}
        <motion.h1 
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="text-4xl md:text-7xl font-semibold tracking-tight leading-[1.0] select-none"
        >
          Emergency Dispatch. <br />
          <span 
            className="animate-shiny select-none font-bold italic"
            style={gradientStyle}
          >
            Revitalized
          </span>
        </motion.h1>

        {/* Subtitle Description */}
        <motion.p 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.6 }}
          className="mt-8 text-white/60 max-w-md text-xs sm:text-sm leading-relaxed tracking-wide"
        >
          LifeLink is a full-stack real-time coordinates layout tracking patient vitals, emergency vehicle fleets, and ER waitlist metrics dynamically.
        </motion.p>

        {/* Action Controls */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7, duration: 0.6 }}
          className="mt-10 flex flex-col items-center gap-4"
        >
          <Link to="/register">
            <AppleButton label="Launch SOS Console" />
          </Link>
          <span className="text-[10px] text-rose-500 font-extrabold uppercase tracking-widest font-mono animate-pulse">
            Warning: Real-time Socket & GPS Sync Active
          </span>
        </motion.div>
      </section>

      {/* -------------------------------------------------------------
          Section 3 — macOS Menu Bar Strip
          ------------------------------------------------------------- */}
      <motion.section 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.9, duration: 0.5 }}
        className="w-full h-10 bg-black/40 backdrop-blur-md border-t border-b border-white/10 relative z-10"
      >
        <div className="max-w-6xl mx-auto px-6 h-full flex items-center justify-between text-[11px] text-white/70">
          <div className="flex items-center gap-4 font-mono font-semibold">
            <AppleLogo className="w-3.5 h-3.5 text-white" />
            <span className="font-extrabold text-white tracking-wider uppercase">LifeLink</span>
            {['SOS System', 'Dispatch', 'ER Board', 'Fleet Telemetry', 'Vitals Sync'].map((item, idx) => (
              <span 
                key={item} 
                className={`cursor-default hover:text-white font-medium ${
                  idx > 2 ? 'hidden sm:inline' : ''
                } ${
                  idx > 3 ? 'hidden md:inline' : ''
                }`}
              >
                {item}
              </span>
            ))}
          </div>

          <div className="flex items-center gap-4 font-mono font-semibold">
            <Search className="w-3.5 h-3.5 text-white/50 cursor-pointer hover:text-white" />
            <span>Wed May 6 1:09 PM</span>
          </div>
        </div>
      </motion.section>

      {/* -------------------------------------------------------------
          Section 4 — Live Dispatch Mockup (Inbox Mockup Refactored)
          ------------------------------------------------------------- */}
      <section className="relative z-10 max-w-6xl mx-auto px-6 py-16 md:py-24">
        
        <motion.div 
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.1, duration: 0.8, ease: "easeOut" }}
          className="relative rounded-2xl overflow-hidden border border-white/10 bg-[#0e1014]/90 backdrop-blur-2xl shadow-2xl"
        >
          
          {/* Mockup Title bar */}
          <div className="h-10 bg-[#161920]/45 border-b border-white/5 px-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-[#ff5f57] cursor-pointer" />
              <span className="w-3 h-3 rounded-full bg-[#febc2e] cursor-pointer" />
              <span className="w-3 h-3 rounded-full bg-[#28c840] cursor-pointer" />
            </div>
            <span className="text-[10px] font-bold text-amber-400 uppercase tracking-widest font-mono flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              Demo Simulation Data — Dispatch Console Preview
            </span>
            <div className="w-12" /> {/* spacer */}
          </div>

          {/* Body structure */}
          <div className="grid grid-cols-12 h-[560px] md:h-[520px] text-xs">
            
            {/* Sidebar (col-span-3) */}
            <div className="col-span-3 bg-black/30 border-r border-white/5 p-4 flex flex-col justify-between overflow-y-auto">
              <div className="space-y-6">
                
                {/* Compose Button -> Trigger SOS */}
                <Link to="/register" className="w-full flex items-center justify-center gap-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold px-3 py-2 transition-all cursor-pointer">
                  <AlertCircle className="w-3.5 h-3.5 fill-current" />
                  <span>Trigger Urgent SOS</span>
                </Link>

                {/* Navigation Items */}
                <nav className="space-y-1">
                  <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-white/10 text-white font-semibold cursor-pointer text-left">
                    <div className="flex items-center gap-2.5">
                      <Inbox className="w-4 h-4 text-rose-500" />
                      <span>Active Map</span>
                    </div>
                    <span className="bg-rose-650 px-1.5 py-0.5 rounded-full text-[9px] font-mono">Live</span>
                  </div>

                  {[
                    { name: 'Dispatches', count: '4' },
                    { name: 'Ambulance Fleet', count: '9' },
                    { name: 'Hospital ERs', count: '12' },
                    { name: 'Vitals Sync', count: 'Active' },
                    { name: 'Incident Reports', count: '' }
                  ].map((item) => (
                    <div key={item.name} className="flex items-center justify-between px-3 py-2 rounded-lg text-white/60 hover:bg-white/5 hover:text-white transition-all cursor-pointer text-left">
                      <div className="flex items-center gap-2.5 text-left">
                        {item.name === 'Dispatches' && <Truck className="w-4 h-4" />}
                        {item.name === 'Ambulance Fleet' && <Activity className="w-4 h-4" />}
                        {item.name === 'Hospital ERs' && <Building className="w-4 h-4" />}
                        {item.name === 'Vitals Sync' && <Heart className="w-4 h-4" />}
                        {item.name === 'Incident Reports' && <FileText className="w-4 h-4" />}
                        <span>{item.name}</span>
                      </div>
                      {item.count && <span className="text-white/40 text-[9px] font-mono">{item.count}</span>}
                    </div>
                  ))}
                </nav>
              </div>

              {/* Severity dot section */}
              <div className="space-y-2 pt-4 border-t border-white/5">
                <span className="block px-3 text-[9px] font-extrabold uppercase tracking-widest text-slate-500 font-mono text-left">
                  Severity Levels
                </span>
                <div className="space-y-1">
                  {[
                    { name: 'Critical (Red)', color: 'bg-red-500' },
                    { name: 'High (Amber)', color: 'bg-amber-500' },
                    { name: 'Medium (Blue)', color: 'bg-cyan-500' },
                    { name: 'Low (Green)', color: 'bg-emerald-500' }
                  ].map((label) => (
                    <div key={label.name} className="flex items-center gap-2 px-3 py-1 text-white/60 hover:text-white transition-colors cursor-pointer text-left">
                      <span className={`w-2 h-2 rounded-full ${label.color}`} />
                      <span>{label.name}</span>
                    </div>
                  ))}
                </div>
              </div>

            </div>

            {/* Message List -> Dispatch List (col-span-4) */}
            <div className="col-span-4 border-r border-white/5 flex flex-col overflow-y-auto">
              
              {/* Search bar */}
              <div className="p-3 border-b border-white/5 flex items-center gap-2 bg-[#12141a]/60">
                <Search className="w-4 h-4 text-white/40" />
                <input 
                  type="text" 
                  disabled
                  placeholder="Search dispatches..."
                  className="bg-transparent border-none outline-none text-white placeholder-white/35 w-full text-xs"
                />
              </div>

              {/* Dispatch items */}
              <div className="divide-y divide-white/5 flex-1 overflow-y-auto">
                {dispatches.map((msg) => {
                  const isActive = activeDispatch.id === msg.id;
                  return (
                    <div 
                      key={msg.id}
                      onClick={() => handleSelectDispatch(msg)}
                      className={`p-3.5 text-left cursor-pointer transition-all ${
                        isActive 
                          ? 'bg-[#1c1417] border-l-2 border-rose-500' 
                          : 'hover:bg-white/[0.02]'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className={`font-bold text-xs ${msg.unread ? 'text-white' : 'text-white/80'}`}>
                          {msg.patientName}
                        </span>
                        <span className="text-[10px] text-white/40 font-mono">
                          {msg.time}
                        </span>
                      </div>
                      <div className={`font-semibold mb-1 truncate ${msg.unread ? 'text-white' : 'text-white/60'}`}>
                        {msg.incidentType}
                      </div>
                      <div className="text-[11px] text-white/40 line-clamp-2 leading-relaxed">
                        {msg.preview}
                      </div>
                      {msg.unread && (
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-rose-500 mt-2" />
                      )}
                    </div>
                  );
                })}
              </div>

            </div>

            {/* Reader -> Dispatch Details (col-span-5) */}
            <div className="col-span-5 flex flex-col overflow-y-auto bg-black/10">
              
              {/* Reader toolbar */}
              <div className="p-3 border-b border-white/5 flex items-center justify-between bg-[#12141a]/60">
                <div className="flex items-center gap-2">
                  {['Dispatch Driver', 'Reroute (OSRM)', 'Complete', 'Cancel'].map((act) => (
                    <button 
                      key={act}
                      className="px-2.5 py-1 rounded-md text-[10px] font-semibold text-white/70 hover:bg-white/5 hover:text-white border border-white/5 transition-all cursor-pointer"
                    >
                      {act}
                    </button>
                  ))}
                </div>
                <button className="p-1 rounded-md hover:bg-white/5 text-white/50 hover:text-white transition-all">
                  <MoreHorizontal className="w-4 h-4" />
                </button>
              </div>

              {/* Reader Content */}
              <div className="p-6 space-y-6 flex-1 overflow-y-auto">
                
                {/* Header */}
                <div className="space-y-3">
                  <h2 className="text-xs sm:text-sm font-bold text-white leading-normal text-left">
                    {activeDispatch.id} — {activeDispatch.incidentType}
                  </h2>
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2.5">
                      <div className={`w-7 h-7 rounded-full bg-gradient-to-br ${activeDispatch.avatarGradient} flex items-center justify-center font-bold text-white text-[11px]`}>
                        {activeDispatch.avatarChar}
                      </div>
                      <div className="text-left">
                        <span className="font-bold text-white block">{activeDispatch.patientName}</span>
                        <span className="text-[10px] text-white/40 block mt-0.5">{activeDispatch.ageGender}</span>
                      </div>
                    </div>
                    <span className="px-2.5 py-0.5 rounded-full bg-rose-950/40 text-rose-455 text-[9px] font-bold uppercase tracking-wider">
                      {activeDispatch.severity}
                    </span>
                  </div>
                </div>

                {/* Summary AI Box -> AI Triage */}
                <div className="p-4 bg-rose-950/20 border border-rose-500/15 rounded-2xl space-y-2">
                  <div className="flex items-center gap-2 text-rose-455 font-extrabold text-[10px] uppercase tracking-wider font-mono">
                    <Sparkles className="w-3.5 h-3.5 fill-current animate-pulse" />
                    <span>AI Triage & Patient Vitals</span>
                  </div>
                  <p className="text-[11px] text-white/80 leading-relaxed font-medium text-left">
                    {activeDispatch.summary}
                  </p>
                </div>

                {/* Event Logs */}
                <div className="space-y-4 text-white/70 leading-relaxed text-[11px] text-left">
                  <div className="font-bold text-[9px] text-slate-500 tracking-wider uppercase font-mono mb-2">
                    System logs
                  </div>
                  {activeDispatch.eventLogs.map((log, pIdx) => (
                    <p key={pIdx} className="font-mono">{log}</p>
                  ))}
                </div>

                {/* Attachment Pill */}
                {activeDispatch.attachmentName && (
                  <div className="p-3 bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] transition-all rounded-xl inline-flex items-center gap-2.5 cursor-pointer">
                    <Paperclip className="w-3.5 h-3.5 text-rose-500" />
                    <span className="font-mono text-white/80 text-[10px]">{activeDispatch.attachmentName}</span>
                  </div>
                )}

              </div>

            </div>

          </div>

        </motion.div>

      </section>

      {/* -------------------------------------------------------------
          Section 5 — FeatureTriage
          ------------------------------------------------------------- */}
      <section id="solutions" className="relative z-10 max-w-6xl mx-auto px-6 py-20 md:py-28">
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-10 md:gap-16 items-start">
          
          {/* Left Column Description */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
            className="space-y-6 text-left"
          >
            <SectionEyebrow label="Triage & Routing" tag="OSRM-Integrated" />
            <h2 className="text-3xl md:text-5xl font-semibold tracking-tight leading-[1.05]">
              Smart routing. <br />
              <span className="text-rose-500">Saved lives.</span>
            </h2>
            <p className="text-white/60 text-xs sm:text-sm leading-relaxed max-w-md">
              LifeLink matches active emergencies with the closest available fleet. By utilizing physical road routing algorithms, coordinate telemetry streams strictly along actual road networks rather than straight-line interpolation.
            </p>

            <div className="flex flex-wrap gap-2.5 pt-2">
              {['OSRM Road Simulation', 'Vitals Sync', 'ER Bed Waitlist Queue', 'SOS Panic Alert'].map((chip) => (
                <span 
                  key={chip} 
                  className="text-[10px] font-bold text-white/70 px-3.5 py-1.5 rounded-full border border-white/10 bg-white/[0.03] transition-colors hover:border-white/20 cursor-default"
                >
                  {chip}
                </span>
              ))}
            </div>
          </motion.div>

          {/* Right Column Layout Card */}
          <div className="liquid-glass rounded-3xl p-6 md:p-8 space-y-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-extrabold uppercase tracking-widest text-amber-400 font-mono">
                SIMULATED DATA · 42 DEMO DISPATCHES TRIAGED
              </span>
              <span className="w-2 h-2 rounded-full bg-rose-600 animate-pulse" />
            </div>

            {/* Sub-cards */}
            <div className="space-y-3">
              {[
                { label: 'Critical', count: 4, items: ['Sophia Chen — Cardiac Arrest', 'Marcus Vance — Trauma / Collision'], color: 'border-l-2 border-red-500' },
                { label: 'High', count: 7, items: ['David Lim — Respiratory', 'Sarah Connor — Severe Burn'], color: 'border-l-2 border-amber-500' },
                { label: 'Moderate', count: 18, items: ['Kyle Reese — Suspected Fracture'], color: 'border-l-2 border-cyan-400' },
                { label: 'Low', count: 13, items: ['John Connor — Minor Laceration'], color: 'border-l-2 border-slate-600' }
              ].map((subCard) => (
                <div key={subCard.label} className={`liquid-glass rounded-2xl p-4 flex justify-between gap-4 items-start ${subCard.color}`}>
                  <div className="space-y-1.5 text-left">
                    <span className="font-bold text-xs text-white">
                      {subCard.label}
                    </span>
                    <div className="text-[10px] text-white/40 space-y-0.5 font-mono">
                      {subCard.items.map((it, itIdx) => (
                        <div key={itIdx}>{it}</div>
                      ))}
                    </div>
                  </div>
                  <span className="bg-white/10 px-2 py-0.5 rounded-full text-[9px] font-mono font-bold text-white/70">
                    {subCard.count}
                  </span>
                </div>
              ))}
            </div>
          </div>

        </div>

      </section>

      {/* -------------------------------------------------------------
          Section 6 — LogoCloud
          ------------------------------------------------------------- */}
      <section className="relative z-10 max-w-6xl mx-auto px-6 py-16 md:py-20 border-t border-white/5">
        <div className="text-center">
          <span className="text-[10px] font-extrabold uppercase tracking-widest text-white/40 font-mono">
            Integrated with top healthcare networks and municipal services
          </span>
          <div className="mt-10 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-8 items-center">
            {['General Hospital', 'City Fire Dept', 'County Medics', 'Red Cross', 'Saint Jude', 'Mayo Clinic', 'OSRM Routing', 'Prisma Database'].map((logo, idx) => (
              <motion.span
                key={logo}
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ delay: idx * 0.05, duration: 0.5 }}
                className="text-xs font-bold tracking-tight text-white/40 hover:text-white cursor-default transition-all duration-300 font-mono"
              >
                {logo}
              </motion.span>
            ))}
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------------
          Section 7 — Role Portals Directory (Brand New visual block)
          ------------------------------------------------------------- */}
      <section id="portals" className="relative z-10 max-w-6xl mx-auto px-6 py-20 md:py-28 border-t border-white/10">
        <div className="text-center max-w-2xl mx-auto space-y-4 mb-16">
          <SectionEyebrow label="Role Directory" tag="Unified portals" />
          <h2 className="text-3xl md:text-5xl font-semibold tracking-tight">
            4 Dedicated Portals. <br />
            <span className="text-rose-500">1 Seamless Pipeline.</span>
          </h2>
          <p className="text-white/60 text-xs sm:text-sm">
            Select your specific portal to sign in or register on the unified coordinates grid.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[
            {
              role: "Patient Portal",
              desc: "Request SOS triggers, configure emergency contacts, and monitor real-time ambulance dispatch telemetry.",
              loginPath: "/login",
              registerPath: "/register",
              registerLabel: "Patient Sign Up",
              icon: <User className="w-6 h-6 text-rose-500" />
            },
            {
              role: "Ambulance Driver",
              desc: "Toggle active duty availability, accept hospital dispatches, and broadcast authentic turn-by-turn road coordinates.",
              loginPath: "/login",
              registerPath: "/register",
              registerLabel: "Driver Sign Up",
              icon: <Truck className="w-6 h-6 text-amber-500" />
            },
            {
              role: "Hospital Administrator",
              desc: "Manage live bed allocations, verify incoming driver credentials, and coordinate trauma bay admissions.",
              loginPath: "/admin/login",
              registerPath: "/register-hospital",
              registerLabel: "Register Facility",
              icon: <Building className="w-6 h-6 text-cyan-400" />
            },
            {
              role: "Super Administrator",
              desc: "Oversee municipal emergency fleet, approve hospital registrations, audit dispatch logs, and manage system security.",
              loginPath: "/super-admin/login",
              icon: <ShieldCheck className="w-6 h-6 text-purple-400" />
            }
          ].map((card, idx) => (
            <motion.div
              key={card.role}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: idx * 0.1, duration: 0.6 }}
              className="liquid-glass rounded-3xl p-6 flex flex-col justify-between text-left shadow-lg hover:border-white/10"
            >
              <div className="space-y-4">
                <div className="w-12 h-12 rounded-2xl bg-white/[0.02] border border-white/5 flex items-center justify-center">
                  {card.icon}
                </div>
                <h3 className="font-bold text-sm text-white">{card.role}</h3>
                <p className="text-[11px] text-white/50 leading-relaxed min-h-[4.5em]">
                  {card.desc}
                </p>
              </div>

              <div className="mt-8 space-y-2">
                <Link 
                  to={card.loginPath} 
                  className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl bg-white text-black font-bold text-[10px] uppercase tracking-wider hover:bg-slate-100 transition-colors"
                >
                  <span>Enter Portal</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
                {card.registerPath ? (
                  <Link 
                    to={card.registerPath} 
                    className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl border border-white/10 text-white font-bold text-[10px] uppercase tracking-wider hover:bg-white/5 transition-colors"
                  >
                    <span>{card.registerLabel || "Register"}</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </Link>
                ) : (
                  <div className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl border border-white/5 text-white/40 text-[10px] uppercase tracking-wider font-mono">
                    <span>Authorized Staff Only</span>
                    <ShieldAlert className="w-3.5 h-3.5" />
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* -------------------------------------------------------------
          Section 8 — Testimonials
          ------------------------------------------------------------- */}
      <section className="relative z-10 max-w-6xl mx-auto px-6 py-20 md:py-28 border-t border-white/10">
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            {
              quote: "LifeLink cut our average response times by four minutes. Having patient vitals pre-synced before arrival is a game changer.",
              name: "Dr. Parker Wilf",
              role: "Chief of Emergency Services",
              company: "CITY GENERAL"
            },
            {
              quote: "The turn-by-turn road simulator ensures our drivers get the optimal route, dodging city bottlenecks. Highly recommended.",
              name: "Chief Andrew von Rosenbach",
              role: "Fire & Rescue Dispatch Command",
              company: "METRO PUBLIC SAFETY"
            },
            {
              quote: "Real-time socket coordinate syncing keeps everyone in visual lockstep. No more radio guesswork on ER arrivals.",
              name: "Mathies Christensen",
              role: "Emergency Fleet Supervisor",
              company: "LUNAR MEDICARE"
            }
          ].map((t, idx) => (
            <motion.figure 
              key={idx}
              initial={{ opacity: 0, y: 15 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: idx * 0.1, duration: 0.6 }}
              className="liquid-glass rounded-3xl p-6 md:p-8 flex flex-col justify-between shadow-xl"
            >
              <blockquote className="text-xs sm:text-sm text-white/80 leading-relaxed font-medium italic text-left">
                &ldquo;{t.quote}&rdquo;
              </blockquote>
              <figcaption className="mt-8 pt-5 border-t border-white/5 flex flex-col gap-1 items-start text-left">
                <span className="text-xs font-bold text-white">{t.name}</span>
                <span className="text-[10px] text-white/40 block">{t.role}</span>
                <span className="text-[9px] font-extrabold text-rose-500 tracking-wider font-mono block mt-1">
                  {t.company}
                </span>
              </figcaption>
            </motion.figure>
          ))}
        </div>

      </section>
      {/* -------------------------------------------------------------
          Section 10 — FinalCTA
          ------------------------------------------------------------- */}
      <section className="relative z-10 max-w-6xl mx-auto px-6 py-20 md:py-32">
        
        <motion.div 
          initial={{ opacity: 0, scale: 0.98 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7 }}
          className="liquid-glass relative overflow-hidden rounded-3xl px-8 py-16 md:py-24 text-center shadow-2xl"
        >
          {/* Radial overlay glow */}
          <div 
            className="absolute inset-0 pointer-events-none opacity-35"
            style={{ 
              background: 'radial-gradient(600px circle at 50% 0%, rgba(244,63,94,0.18), transparent 70%)' 
            }}
          />

          <h2 className="text-3xl md:text-6xl font-semibold tracking-tight leading-[1.02] relative z-10">
            Every second counts. <br />
            <span className="text-rose-500">Launch LifeLink today.</span>
          </h2>
          
          <p className="mt-6 text-white/60 max-w-md mx-auto text-xs sm:text-sm leading-relaxed relative z-10">
            Join emergency medical networks, driver rosters, and patients tracking dispatch coordinates live.
          </p>

          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4 relative z-10">
            <Link to="/login">
              <AppleButton label="Open App Portal" />
            </Link>
            <Link to="/register" className="rounded-full border border-white/15 text-white text-xs font-semibold px-6 py-3.5 hover:bg-white/5 transition-all flex items-center gap-2 group cursor-pointer">
              <span>Register Patient Account</span>
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </div>

        </motion.div>

      </section>

      {/* Footer */}
      <footer className="relative z-10 max-w-6xl mx-auto px-6 py-12 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-6 text-[10px] text-white/40 font-semibold tracking-widest uppercase font-mono">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 rounded-md bg-rose-600 flex items-center justify-center">
            <ShieldAlert className="w-3.5 h-3.5 text-white" />
          </div>
          <span>&copy; 2026 LifeLink Inc.</span>
        </div>
        <div className="flex gap-6 items-center flex-wrap">
          <button onClick={() => setHealthModalOpen(true)} className="text-rose-400 hover:text-rose-300 transition-colors flex items-center gap-1 cursor-pointer">
            <Activity className="w-3 h-3 animate-pulse" />
            <span>System Health</span>
          </button>
          <Link to="/register-hospital" className="text-emerald-400/80 hover:text-emerald-300 transition-colors">Register Hospital</Link>
          <Link to="/admin/login" className="text-white/60 hover:text-white transition-colors">Hospital Staff Portal</Link>
          <Link to="/super-admin/login" className="text-purple-400/80 hover:text-purple-300 transition-colors">Super Admin</Link>
          <a href="#privacy" className="hover:text-white transition-colors">Privacy</a>
          <a href="#terms" className="hover:text-white transition-colors">Terms</a>
          <a href="#security" className="hover:text-white transition-colors">Security</a>
        </div>
      </footer>

      {/* System Health Diagnostic Modal */}
      <SystemHealthModal isOpen={healthModalOpen} onClose={() => setHealthModalOpen(false)} />

    </div>
  );
};

export default Landing;
