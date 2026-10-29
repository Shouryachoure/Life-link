import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getApiBaseUrl } from '../config/apiConfig';
import { 
  Building, 
  Mail, 
  Lock, 
  Phone, 
  MapPin, 
  CheckCircle, 
  AlertCircle, 
  ArrowLeft, 
  ShieldCheck, 
  Activity,
  Stethoscope,
  Clock
} from 'lucide-react';
import { ThemeToggle } from '../components/ui/ThemeToggle';

const defaultServices = [
  '24/7 Emergency ER',
  'Level-1 Trauma Center',
  'Intensive Care Unit (ICU)',
  'Cardiology / Cath Lab',
  'Neurology & Stroke Care',
  'Pediatric Emergency',
  'Burn & Critical Resuscitation',
  'Orthopedic Surgery'
];

export const HospitalRegister: React.FC = () => {
  const navigate = useNavigate();
  const [hospitalName, setHospitalName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [address, setAddress] = useState('');
  const [selectedServices, setSelectedServices] = useState<string[]>([
    '24/7 Emergency ER',
    'Intensive Care Unit (ICU)'
  ]);
  const [customService, setCustomService] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const toggleService = (srv: string) => {
    if (selectedServices.includes(srv)) {
      setSelectedServices(selectedServices.filter((s) => s !== srv));
    } else {
      setSelectedServices([...selectedServices, srv]);
    }
  };

  const handleAddCustomService = (e: React.KeyboardEvent | React.MouseEvent) => {
    if ('key' in e && e.key !== 'Enter') return;
    e.preventDefault();
    if (customService.trim() && !selectedServices.includes(customService.trim())) {
      setSelectedServices([...selectedServices, customService.trim()]);
      setCustomService('');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!hospitalName.trim() || !email.trim() || !password || !contactNumber.trim()) {
      setError('Please provide hospital name, email, phone number, and a secure password.');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters in length.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match. Please re-enter.');
      return;
    }

    setLoading(true);
    const apiUrl = getApiBaseUrl();
    try {
      const response = await fetch(`${apiUrl}/auth/register-hospital`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hospitalName,
          email,
          password,
          contactNumber,
          address,
          services: selectedServices.join(', ') || 'General Medicine, Emergency ER',
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Failed to submit registration application.');
      }

      setSubmitted(true);
    } catch (err: any) {
      setError(err.message || 'Network error occurred while submitting registration.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-gray-900 dark:text-slate-100 flex flex-col justify-between transition-colors">
      {/* Top Header */}
      <header className="px-6 py-4 border-b border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-950 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <Link 
            to="/" 
            className="flex items-center gap-2 text-xs font-semibold text-gray-500 dark:text-slate-400 hover:text-emerald-500 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Return to Overview</span>
          </Link>
          <div className="h-4 w-px bg-gray-200 dark:bg-slate-800 hidden sm:block" />
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-emerald-600 flex items-center justify-center">
              <Building className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-sm tracking-tight">Hospital Network Onboarding</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <Link 
            to="/admin/login" 
            className="text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:underline px-3 py-1.5"
          >
            Staff Sign In
          </Link>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-3xl w-full mx-auto px-6 py-10">
        {submitted ? (
          <div className="bg-white dark:bg-slate-950 border border-gray-200 dark:border-slate-800 rounded-3xl p-8 sm:p-12 shadow-xl text-center space-y-6">
            <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 flex items-center justify-center mx-auto text-3xl shadow-lg">
              <CheckCircle className="w-9 h-9" />
            </div>

            <div className="space-y-2">
              <span className="text-2xs font-extrabold uppercase tracking-widest text-emerald-500 font-mono bg-emerald-500/10 px-3 py-1 rounded-full">
                Application Received • Status: PENDING
              </span>
              <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-gray-900 dark:text-white">
                Registration Submitted Successfully
              </h2>
              <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400 max-w-lg mx-auto leading-relaxed">
                Thank you for registering <strong className="text-gray-800 dark:text-slate-200">{hospitalName}</strong>. 
                Your facility application has been queued for validation by the LifeLink Super Administration team.
              </p>
            </div>

            <div className="p-5 bg-gray-50 dark:bg-slate-900/60 rounded-2xl border border-gray-200 dark:border-slate-800 text-left space-y-3 max-w-md mx-auto text-2xs text-gray-600 dark:text-slate-400">
              <div className="flex items-center gap-2 text-xs font-bold text-gray-800 dark:text-slate-200">
                <ShieldCheck className="w-4 h-4 text-emerald-500" />
                <span>Next Steps in Verification</span>
              </div>
              <ul className="space-y-2 pl-4 list-disc">
                <li>Your administrative password has been cryptographically hashed and secured.</li>
                <li>Once approved by Super Admin, your login credentials will be immediately activated.</li>
                <li>You can access the facility management console at <span className="font-mono text-emerald-600 dark:text-emerald-400">/admin/login</span> upon approval.</li>
              </ul>
            </div>

            <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                to="/"
                className="w-full sm:w-auto px-6 py-3 rounded-xl bg-gray-100 hover:bg-gray-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-bold transition-all text-center"
              >
                Back to Landing Page
              </Link>
              <Link
                to="/admin/login"
                className="w-full sm:w-auto px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all text-center shadow-lg shadow-emerald-600/25"
              >
                Go to Hospital Staff Portal
              </Link>
            </div>
          </div>
        ) : (
          <div className="bg-white dark:bg-slate-950 border border-gray-200 dark:border-slate-800 rounded-3xl p-6 sm:p-10 shadow-xl space-y-8">
            {/* Header / Intro */}
            <div className="space-y-2 text-center sm:text-left">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 text-3xs font-mono font-bold uppercase tracking-wider">
                <Activity className="w-3 h-3 animate-pulse" />
                <span>Healthcare Facility Accreditation</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-gray-900 dark:text-white">
                Register Your Hospital
              </h1>
              <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400">
                Connect your medical center with LifeLink's emergency ambulance dispatch grid. Coordinate inbound patient vitals, telemetry, and trauma bed allocations.
              </p>
            </div>

            {error && (
              <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-2xl flex items-center gap-3 text-rose-500 text-xs font-medium">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Section 1: Facility Details */}
              <div className="space-y-4">
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-gray-400 dark:text-slate-500 font-mono">
                  1. Facility Details
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-2xs font-bold uppercase tracking-wider text-gray-700 dark:text-slate-300 mb-1.5">
                      Hospital / Clinic Name *
                    </label>
                    <div className="relative">
                      <Building className="w-4 h-4 text-gray-400 absolute left-3.5 top-3" />
                      <input
                        type="text"
                        required
                        value={hospitalName}
                        onChange={(e) => setHospitalName(e.target.value)}
                        placeholder="e.g. Metro Memorial Trauma Center"
                        className="w-full bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-xs text-gray-900 dark:text-white focus:outline-none focus:border-emerald-500 transition-colors"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-2xs font-bold uppercase tracking-wider text-gray-700 dark:text-slate-300 mb-1.5">
                      Emergency Contact Number *
                    </label>
                    <div className="relative">
                      <Phone className="w-4 h-4 text-gray-400 absolute left-3.5 top-3" />
                      <input
                        type="tel"
                        required
                        value={contactNumber}
                        onChange={(e) => setContactNumber(e.target.value)}
                        placeholder="+1 (555) 019-2834"
                        className="w-full bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-xs text-gray-900 dark:text-white focus:outline-none focus:border-emerald-500 transition-colors"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-2xs font-bold uppercase tracking-wider text-gray-700 dark:text-slate-300 mb-1.5">
                    Physical Address
                  </label>
                  <div className="relative">
                    <MapPin className="w-4 h-4 text-gray-400 absolute left-3.5 top-3" />
                    <input
                      type="text"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder="e.g. 500 Parnassus Ave, San Francisco, CA"
                      className="w-full bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-xs text-gray-900 dark:text-white focus:outline-none focus:border-emerald-500 transition-colors"
                    />
                  </div>
                </div>
              </div>

              {/* Section 2: Administrative Login Credentials */}
              <div className="space-y-4 pt-4 border-t border-gray-100 dark:border-slate-850">
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-gray-400 dark:text-slate-500 font-mono">
                  2. Administrator Account Credentials
                </h3>

                <div>
                  <label className="block text-2xs font-bold uppercase tracking-wider text-gray-700 dark:text-slate-300 mb-1.5">
                    Official Admin Email *
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-gray-400 absolute left-3.5 top-3" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="admin@metromemorial.org"
                      className="w-full bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-xs text-gray-900 dark:text-white focus:outline-none focus:border-emerald-500 transition-colors"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-2xs font-bold uppercase tracking-wider text-gray-700 dark:text-slate-300 mb-1.5">
                      Password *
                    </label>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-gray-400 absolute left-3.5 top-3" />
                      <input
                        type="password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-xs text-gray-900 dark:text-white focus:outline-none focus:border-emerald-500 transition-colors"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-2xs font-bold uppercase tracking-wider text-gray-700 dark:text-slate-300 mb-1.5">
                      Confirm Password *
                    </label>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-gray-400 absolute left-3.5 top-3" />
                      <input
                        type="password"
                        required
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-xs text-gray-900 dark:text-white focus:outline-none focus:border-emerald-500 transition-colors"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Section 3: Clinical Services Offered */}
              <div className="space-y-4 pt-4 border-t border-gray-100 dark:border-slate-850">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-extrabold uppercase tracking-wider text-gray-400 dark:text-slate-500 font-mono">
                    3. Emergency & Clinical Services
                  </h3>
                  <span className="text-3xs text-gray-400">Select all that apply</span>
                </div>

                <div className="flex flex-wrap gap-2">
                  {defaultServices.map((service) => {
                    const isSelected = selectedServices.includes(service);
                    return (
                      <button
                        key={service}
                        type="button"
                        onClick={() => toggleService(service)}
                        className={`text-2xs font-semibold px-3 py-2 rounded-xl border transition-all cursor-pointer flex items-center gap-1.5 ${
                          isSelected
                            ? 'bg-emerald-500/15 border-emerald-500 text-emerald-600 dark:text-emerald-400 shadow-sm'
                            : 'bg-gray-50 dark:bg-slate-900 border-gray-200 dark:border-slate-800 text-gray-600 dark:text-slate-400 hover:border-gray-300 dark:hover:border-slate-700'
                        }`}
                      >
                        {isSelected && <CheckCircle className="w-3 h-3 text-emerald-500" />}
                        <span>{service}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={customService}
                    onChange={(e) => setCustomService(e.target.value)}
                    onKeyDown={handleAddCustomService}
                    placeholder="Add other medical specialty (press Enter)"
                    className="flex-1 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl px-4 py-2 text-xs focus:outline-none focus:border-emerald-500"
                  />
                  <button
                    type="button"
                    onClick={handleAddCustomService}
                    className="px-4 py-2 rounded-xl bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-750 text-xs font-semibold"
                  >
                    Add
                  </button>
                </div>
              </div>

              {/* Submit Button */}
              <div className="pt-6 border-t border-gray-100 dark:border-slate-850 space-y-3">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-xs font-bold tracking-wide uppercase shadow-lg shadow-emerald-600/25 transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Submitting Registration...</span>
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-4 h-4" />
                      <span>Submit Hospital Registration for Review</span>
                    </>
                  )}
                </button>

                <p className="text-3xs text-center text-gray-400 dark:text-slate-500">
                  By submitting, you certify that this facility is licensed for healthcare operations. Passwords are securely hashed with bcrypt upon submit.
                </p>
              </div>
            </form>
          </div>
        )}
      </main>

      {/* Simple Footer */}
      <footer className="py-6 px-6 border-t border-gray-200 dark:border-slate-800 text-center text-3xs text-gray-400 font-mono">
        LifeLink Emergency Dispatch System &bull; Healthcare Network Partner Portal
      </footer>
    </div>
  );
};

export default HospitalRegister;
