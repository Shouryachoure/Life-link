import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  User,
  Mail,
  Lock,
  Phone,
  Heart,
  ShieldAlert,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ShieldCheck,
  Sparkles,
  Smartphone,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { ThemeToggle } from '../components/ui/ThemeToggle';
import { HeartbeatLoader } from '../components/ui/HeartbeatLoader';
import { OtpScreen } from '../components/auth/OtpScreen';
import { VerificationSuccess } from '../components/auth/VerificationSuccess';
import { supabase, isSupabaseConfigured } from '../utils/supabaseClient';

function maskEmailAddress(emailStr: string): string {
  const parts = emailStr.split('@');
  if (parts.length !== 2) return emailStr;
  const name = parts[0];
  const domain = parts[1];
  const visible = name.slice(0, 2);
  return `${visible}***@${domain}`;
}

const COUNTRY_CODES = [
  { code: '+91', label: 'India (+91)', flag: '🇮🇳' },
  { code: '+1', label: 'United States (+1)', flag: '🇺🇸' },
  { code: '+44', label: 'United Kingdom (+44)', flag: '🇬🇧' },
  { code: '+971', label: 'UAE (+971)', flag: '🇦🇪' },
  { code: '+65', label: 'Singapore (+65)', flag: '🇸🇬' },
  { code: '+61', label: 'Australia (+61)', flag: '🇦🇺' },
];

export const Register: React.FC = () => {
  const { user, login, apiFetch, syncSupabaseSession } = useAuth();
  const navigate = useNavigate();

  // Stages: 'FORM' | 'OTP' | 'SUCCESS'
  const [stage, setStage] = useState<'FORM' | 'OTP' | 'SUCCESS'>('FORM');

  // Auto-redirect if already logged in (only during initial form view)
  useEffect(() => {
    if (user && stage === 'FORM') {
      if (user.role === 'PATIENT') navigate('/patient');
      else if (user.role === 'DRIVER') navigate('/driver');
      else if (user.role === 'ADMIN_HOSPITAL') navigate('/hospital');
      else if (user.role === 'SUPER_ADMIN') navigate('/super-admin');
    }
  }, [user, stage, navigate]);

  // Form Fields
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [countryCode, setCountryCode] = useState('+91');
  const [rawPhone, setRawPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [verificationMethod, setVerificationMethod] = useState<'EMAIL' | 'PHONE'>('EMAIL');

  // Optional Patient Emergency Medical Profile
  const [bloodGroup, setBloodGroup] = useState('O+');
  const [allergies, setAllergies] = useState('');
  const [emergencyContactName, setEmergencyContactName] = useState('');
  const [emergencyContactPhone, setEmergencyContactPhone] = useState('');
  const [medicalNotes, setMedicalNotes] = useState('');
  const [showMedicalProfile, setShowMedicalProfile] = useState(false);

  // Password visibility
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // OTP Verification state
  const [maskedRecipient, setMaskedRecipient] = useState('');
  const [otpTargetIdentifier, setOtpTargetIdentifier] = useState('');
  const [providerConfigured, setProviderConfigured] = useState(false);
  const [deliveryFeedback, setDeliveryFeedback] = useState('');
  const [mockCode, setMockCode] = useState<string | undefined>();
  const [remainingAttempts, setRemainingAttempts] = useState<number | undefined>();

  // Success state
  const [createdUser, setCreatedUser] = useState<any>(null);

  // UI status
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Inline validation checks
  const isPasswordLongEnough = password.length >= 12;
  const doPasswordsMatch = password.length > 0 && password === confirmPassword;

  // Format full international phone
  const fullPhone = rawPhone.trim()
    ? rawPhone.startsWith('+')
      ? rawPhone.trim()
      : `${countryCode}${rawPhone.trim()}`
    : '';

  // 1. Submit Registration Form -> Dispatches OTP
  const handleInitiateRegistration = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('Please provide your full legal name.');
      return;
    }

    if (!email.trim() || !email.includes('@')) {
      setError('Please provide a valid email address for your LifeLink record.');
      return;
    }

    if (verificationMethod === 'PHONE' && !rawPhone.trim()) {
      setError('A mobile number is required to receive SMS verification.');
      return;
    }

    if (!isPasswordLongEnough) {
      setError('Password must be at least 12 characters long.');
      return;
    }

    if (!doPasswordsMatch) {
      setError('Passwords do not match. Please re-enter your password.');
      return;
    }

    if (!acceptedTerms) {
      setError('You must accept the LifeLink terms of emergency care to register.');
      return;
    }

    if (loading) return;
    setLoading(true);
    const identifier = verificationMethod === 'EMAIL' ? email.trim().toLowerCase() : fullPhone;

    // Supabase Email OTP Registration
    if (verificationMethod === 'EMAIL' && isSupabaseConfigured() && supabase) {
      try {
        const redirectUrl = typeof window !== 'undefined' ? `${window.location.origin}/register` : undefined;
        const { data: sbData, error: sbError } = await supabase.auth.signUp({
          email: identifier,
          password,
          options: {
            emailRedirectTo: redirectUrl,
            data: {
              name: name.trim(),
              role: 'PATIENT',
              bloodGroup,
              allergies: allergies.trim() || undefined,
              emergencyContactName: emergencyContactName.trim() || undefined,
              emergencyContactPhone: emergencyContactPhone.trim() || undefined,
              medicalNotes: medicalNotes.trim() || undefined,
            },
          },
        });

        if (sbError) {
          const rawMsg = sbError.message.toLowerCase();
          if (rawMsg.includes('already registered') || rawMsg.includes('already exists')) {
            setError('An account with this email address already exists. Please log in instead.');
          } else {
            setError(sbError.message);
          }
          setLoading(false);
          return;
        }

        // Supabase returns user with empty identities when user already exists & email confirmation is on
        if (sbData.user && Array.isArray(sbData.user.identities) && sbData.user.identities.length === 0) {
          setError('An account with this email address already exists. Please log in instead.');
          setLoading(false);
          return;
        }

        setOtpTargetIdentifier(identifier);
        setMaskedRecipient(maskEmailAddress(identifier));
        setProviderConfigured(true);
        setDeliveryFeedback('Enter the 6-digit verification code sent to your email. You do NOT need to click any link in the email.');
        setStage('OTP');
        setLoading(false);
        return;
      } catch (sbEx: any) {
        setError(sbEx?.message || 'Supabase authentication failed. Please try again.');
        setLoading(false);
        return;
      }
    }

    try {
      const data = await apiFetch('/auth/otp/send', {
        method: 'POST',
        body: JSON.stringify({
          identifier,
          channel: verificationMethod,
          purpose: 'REGISTRATION',
        }),
      });

      setOtpTargetIdentifier(data.identifier || identifier);
      setMaskedRecipient(data.maskedRecipient || identifier);
      setProviderConfigured(Boolean(data.providerConfigured));
      setDeliveryFeedback(data.deliveryFeedback || '');
      setMockCode(data.mockCode);
      setStage('OTP');
    } catch (err: any) {
      setError(err.message || 'Registration failed. Please review your details.');
    } finally {
      setLoading(false);
    }
  };

  // 2. Resend Registration OTP
  const handleResendOtp = async () => {
    if (verificationMethod === 'EMAIL' && isSupabaseConfigured() && supabase) {
      try {
        const redirectUrl = typeof window !== 'undefined' ? `${window.location.origin}/register` : undefined;
        const { error: resendError } = await supabase.auth.resend({
          type: 'signup',
          email: otpTargetIdentifier,
          options: {
            emailRedirectTo: redirectUrl,
          },
        });
        if (resendError) {
          const rawMsg = resendError.message.toLowerCase();
          if (rawMsg.includes('rate limit')) {
            setError('Too many resend requests. Please wait a minute before requesting another code.');
          } else {
            setError(resendError.message);
          }
          return { success: false };
        }
        return {
          success: true,
          deliveryFeedback: 'A new 6-digit verification code has been dispatched to your email. Enter the code below without clicking any link.',
          providerConfigured: true,
        };
      } catch (err: any) {
        setError(err.message || 'Failed to resend verification code.');
        return { success: false };
      }
    }

    try {
      const data = await apiFetch('/auth/otp/send', {
        method: 'POST',
        body: JSON.stringify({
          identifier: otpTargetIdentifier,
          channel: verificationMethod,
          purpose: 'REGISTRATION',
        }),
      });
      return {
        success: true,
        deliveryFeedback: data.deliveryFeedback,
        providerConfigured: data.providerConfigured,
        mockCode: data.mockCode,
      };
    } catch (err: any) {
      setError(err.message || 'Failed to resend verification code.');
      return { success: false };
    }
  };

  // 3. Confirm OTP and Activate Account
  const handleVerifyOtp = async (code: string) => {
    if (loading) return;
    setLoading(true);
    setError('');

    const registrationPayload = {
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: fullPhone || undefined,
      password,
      confirmPassword,
      acceptedTerms: true,
      bloodGroup,
      allergies: allergies.trim() || undefined,
      emergencyContactName: emergencyContactName.trim() || undefined,
      emergencyContactPhone: emergencyContactPhone.trim() || undefined,
      medicalNotes: medicalNotes.trim() || undefined,
    };

    if (verificationMethod === 'EMAIL' && isSupabaseConfigured() && supabase) {
      try {
        const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
          email: otpTargetIdentifier,
          token: code.trim(),
          type: 'signup',
        });

        let accessToken = verifyData?.session?.access_token;

        // Resilient Fallback: If OTP confirmed the email but didn't return an access token, authenticate using password
        if (!accessToken && !verifyError && verifyData?.user) {
          const { data: signinData, error: signinError } = await supabase.auth.signInWithPassword({
            email: otpTargetIdentifier,
            password,
          });
          if (signinData?.session?.access_token) {
            accessToken = signinData.session.access_token;
          } else if (signinError) {
            console.warn('[Supabase Auth] Fallback signInWithPassword notice:', signinError.message);
          }
        }

        if (verifyError || !accessToken) {
          let errorMessage = 'Invalid or expired 6-digit verification code. Please check and try again.';
          if (verifyError) {
            const rawMsg = verifyError.message.toLowerCase();
            if (rawMsg.includes('expired')) {
              errorMessage = 'The verification code has expired. Please tap "Resend code" to receive a new one.';
            } else if (rawMsg.includes('invalid') || rawMsg.includes('token') || rawMsg.includes('otp')) {
              errorMessage = 'Invalid verification code. Please enter the latest 6-digit code sent to your email.';
            } else {
              errorMessage = verifyError.message;
            }
          }
          setError(errorMessage);
          setLoading(false);
          return;
        }

        // Idempotently sync user profile with LifeLink backend
        const syncedUser = await syncSupabaseSession(accessToken, registrationPayload);
        setCreatedUser(syncedUser);
        setStage('SUCCESS');
      } catch (syncErr: any) {
        setError(syncErr?.message || 'Account verified, but profile synchronization failed. Please refresh.');
      } finally {
        setLoading(false);
      }
      return;
    }

    try {
      const data = await apiFetch('/auth/otp/verify', {
        method: 'POST',
        body: JSON.stringify({
          identifier: otpTargetIdentifier,
          channel: verificationMethod,
          purpose: 'REGISTRATION',
          code,
          registrationData: registrationPayload,
        }),
      });

      login(data.token, data.user);
      setCreatedUser(data.user);
      setStage('SUCCESS');
    } catch (err: any) {
      setError(err.message || 'Invalid verification code. Please check and try again.');
      if (err.remainingAttempts !== undefined) {
        setRemainingAttempts(err.remainingAttempts);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col justify-between selection:bg-teal-500/20 transition-colors">
      {/* Top Header */}
      <header className="max-w-6xl w-full mx-auto px-6 py-6 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3 group">
          <div className="w-9 h-9 rounded-xl bg-teal-600 flex items-center justify-center text-white shadow-md shadow-teal-600/30 group-hover:scale-105 transition-transform">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <span className="text-lg font-black tracking-tight uppercase font-mono">LifeLink</span>
        </Link>
        <div className="flex items-center gap-4">
          <ThemeToggle />
          <Link to="/login" className="text-xs font-semibold text-teal-600 dark:text-teal-400 hover:underline">
            Already have an account? Sign In
          </Link>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-2xl w-full mx-auto px-6 py-6">
        {/* STAGE 1: REGISTRATION FORM */}
        {stage === 'FORM' && (
          <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-3xl p-6 sm:p-10 shadow-xl shadow-slate-950/5">
            {/* Header */}
            <div className="text-center mb-8">
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-teal-50 dark:bg-teal-950/50 text-teal-700 dark:text-teal-300 rounded-full text-xs font-semibold mb-3 border border-teal-100 dark:border-teal-900/60">
                <ShieldCheck className="w-3.5 h-3.5 text-teal-600" />
                <span>Verified Patient Enrollment</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
                Create Your LifeLink Account
              </h1>
              <p className="mt-2 text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                Secure access to emergency medical dispatch, real-time ambulance tracking, and emergency health profiles.
              </p>
            </div>

            {error && (
              <div className="mb-6 p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 flex items-start gap-3 text-xs sm:text-sm text-rose-700 dark:text-rose-400">
                <AlertCircle className="w-5 h-5 shrink-0 text-rose-500 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleInitiateRegistration} className="space-y-6">
              {/* Full Legal Name */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                  Full Legal Name *
                </label>
                <div className="relative">
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Ananya Deshmukh"
                    className="w-full h-11 pl-10 pr-4 bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 text-slate-900 dark:text-slate-100"
                  />
                  <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                </div>
              </div>

              {/* Email & Phone Row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Email Address */}
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                    Email Address *
                  </label>
                  <div className="relative">
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@example.com"
                      className="w-full h-11 pl-10 pr-4 bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 text-slate-900 dark:text-slate-100"
                    />
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                  </div>
                </div>

                {/* Mobile Phone with Country Code */}
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                    Mobile Phone {verificationMethod === 'PHONE' ? '*' : '(Recommended)'}
                  </label>
                  <div className="flex gap-2">
                    <select
                      value={countryCode}
                      onChange={(e) => setCountryCode(e.target.value)}
                      className="h-11 px-2.5 bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono outline-none focus:border-teal-500 text-slate-800 dark:text-slate-200"
                    >
                      {COUNTRY_CODES.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.flag} {c.code}
                        </option>
                      ))}
                    </select>
                    <div className="relative flex-1">
                      <input
                        type="tel"
                        value={rawPhone}
                        onChange={(e) => setRawPhone(e.target.value.replace(/[^0-9]/g, ''))}
                        placeholder="98765 43210"
                        className="w-full h-11 pl-10 pr-4 bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-mono outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 text-slate-900 dark:text-slate-100"
                      />
                      <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Verification Method Selection Cards */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                  Choose Preferred Verification Method *
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Option A: Email OTP */}
                  <button
                    type="button"
                    onClick={() => setVerificationMethod('EMAIL')}
                    className={`p-4 rounded-2xl border text-left transition-all flex items-start gap-3 cursor-pointer ${
                      verificationMethod === 'EMAIL'
                        ? 'border-teal-500 bg-teal-50/50 dark:bg-teal-950/30 ring-2 ring-teal-500/20 shadow-sm'
                        : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 bg-slate-50/50 dark:bg-slate-850'
                    }`}
                  >
                    <div className={`p-2.5 rounded-xl ${verificationMethod === 'EMAIL' ? 'bg-teal-600 text-white' : 'bg-slate-200 dark:bg-slate-800 text-slate-500'}`}>
                      <Mail className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                        <span>Email OTP</span>
                        {verificationMethod === 'EMAIL' && (
                          <span className="text-[10px] bg-teal-100 dark:bg-teal-900 text-teal-700 dark:text-teal-300 font-semibold px-1.5 py-0.5 rounded">
                            Selected
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 leading-normal">
                        Receive 6-digit code in your email inbox. Instant delivery.
                      </p>
                    </div>
                  </button>

                  {/* Option B: SMS Phone OTP */}
                  <button
                    type="button"
                    onClick={() => setVerificationMethod('PHONE')}
                    className={`p-4 rounded-2xl border text-left transition-all flex items-start gap-3 cursor-pointer ${
                      verificationMethod === 'PHONE'
                        ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/30 ring-2 ring-emerald-500/20 shadow-sm'
                        : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 bg-slate-50/50 dark:bg-slate-850'
                    }`}
                  >
                    <div className={`p-2.5 rounded-xl ${verificationMethod === 'PHONE' ? 'bg-emerald-600 text-white' : 'bg-slate-200 dark:bg-slate-800 text-slate-500'}`}>
                      <Smartphone className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                        <span>SMS Phone OTP</span>
                        {verificationMethod === 'PHONE' && (
                          <span className="text-[10px] bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 font-semibold px-1.5 py-0.5 rounded">
                            Selected
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 leading-normal">
                        Receive 6-digit code on your mobile phone via SMS.
                      </p>
                    </div>
                  </button>
                </div>
              </div>

              {/* Password & Confirm Password */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                    Create Password *
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••••••"
                      className="w-full h-11 pl-10 pr-10 bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 text-slate-900 dark:text-slate-100"
                    />
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3.5 top-3.5 text-slate-400 hover:text-slate-600"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                    Confirm Password *
                  </label>
                  <div className="relative">
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      required
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="••••••••••••"
                      className="w-full h-11 pl-10 pr-10 bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 text-slate-900 dark:text-slate-100"
                    />
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3.5 top-3.5 text-slate-400 hover:text-slate-600"
                    >
                      {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Password Policy Live Status */}
              <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-800 text-xs space-y-1">
                <div className={`flex items-center gap-1.5 ${isPasswordLongEnough ? 'text-teal-600 dark:text-teal-400' : 'text-slate-400'}`}>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Minimum 12 characters (LifeLink security policy)</span>
                </div>
                <div className={`flex items-center gap-1.5 ${doPasswordsMatch ? 'text-teal-600 dark:text-teal-400' : 'text-slate-400'}`}>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Passwords match</span>
                </div>
              </div>

              {/* Collapsible Emergency Medical Profile */}
              <div className="border border-slate-200/80 dark:border-slate-800 rounded-2xl overflow-hidden bg-slate-50/50 dark:bg-slate-850/50">
                <button
                  type="button"
                  onClick={() => setShowMedicalProfile(!showMedicalProfile)}
                  className="w-full p-4 text-left flex items-center justify-between hover:bg-slate-100/50 dark:hover:bg-slate-800/50 transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <Heart className="w-4 h-4 text-rose-500" />
                    <div>
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                        Emergency Health Profile (Optional)
                      </span>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Blood group, critical allergies & emergency contacts for first responders.
                      </p>
                    </div>
                  </div>
                  {showMedicalProfile ? (
                    <ChevronUp className="w-4 h-4 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-slate-400" />
                  )}
                </button>

                {showMedicalProfile && (
                  <div className="p-4 pt-0 space-y-3 border-t border-slate-200/50 dark:border-slate-800">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                          Blood Group
                        </label>
                        <select
                          value={bloodGroup}
                          onChange={(e) => setBloodGroup(e.target.value)}
                          className="w-full h-10 px-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs outline-none focus:border-teal-500"
                        >
                          {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'UNKNOWN'].map((bg) => (
                            <option key={bg} value={bg}>
                              {bg}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                          Known Drug/Food Allergies
                        </label>
                        <input
                          type="text"
                          value={allergies}
                          onChange={(e) => setAllergies(e.target.value)}
                          placeholder="e.g. Penicillin, Aspirin, Latex"
                          className="w-full h-10 px-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs outline-none focus:border-teal-500"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                          Emergency Contact Name
                        </label>
                        <input
                          type="text"
                          value={emergencyContactName}
                          onChange={(e) => setEmergencyContactName(e.target.value)}
                          placeholder="e.g. Rohan Deshmukh (Brother)"
                          className="w-full h-10 px-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs outline-none focus:border-teal-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                          Emergency Contact Phone
                        </label>
                        <input
                          type="tel"
                          value={emergencyContactPhone}
                          onChange={(e) => setEmergencyContactPhone(e.target.value)}
                          placeholder="+91 98765 00002"
                          className="w-full h-10 px-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono outline-none focus:border-teal-500"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                        Medical Notes (Conditions, Inhalers, Implants)
                      </label>
                      <input
                        type="text"
                        value={medicalNotes}
                        onChange={(e) => setMedicalNotes(e.target.value)}
                        placeholder="e.g. Asthmatic, carries inhaler. Diabetic type-2."
                        className="w-full h-10 px-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs outline-none focus:border-teal-500"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Terms and Privacy Consent */}
              <div className="flex items-start gap-2.5 pt-1">
                <input
                  type="checkbox"
                  id="acceptedTerms"
                  checked={acceptedTerms}
                  onChange={(e) => setAcceptedTerms(e.target.checked)}
                  className="mt-1 w-4 h-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 cursor-pointer"
                />
                <label htmlFor="acceptedTerms" className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed cursor-pointer">
                  I agree to the <span className="text-teal-600 dark:text-teal-400 font-semibold underline">LifeLink Emergency Terms of Service</span> and consent to my emergency health data being shared with verified dispatchers and paramedics during critical medical responses.
                </label>
              </div>

              {/* Submit Action */}
              <button
                type="submit"
                disabled={loading || !acceptedTerms || !isPasswordLongEnough || !doPasswordsMatch}
                className="w-full h-12 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs uppercase tracking-wider transition-all shadow-md shadow-teal-600/20 active:scale-[0.99] flex items-center justify-center gap-2 cursor-pointer disabled:bg-slate-200 dark:disabled:bg-slate-800 disabled:text-slate-400 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <div className="flex items-center gap-2">
                    <HeartbeatLoader size="small" />
                    <span>Preparing Verification...</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span>Continue to {verificationMethod === 'EMAIL' ? 'Email' : 'SMS'} Verification</span>
                    <ArrowRight className="w-4 h-4" />
                  </div>
                )}
              </button>
            </form>
          </div>
        )}

        {/* STAGE 2: DEDICATED 6-DIGIT OTP SCREEN */}
        {stage === 'OTP' && (
          <OtpScreen
            identifier={otpTargetIdentifier}
            channel={verificationMethod}
            purpose="REGISTRATION"
            maskedRecipient={maskedRecipient}
            initialCooldown={60}
            initialExpiresIn={verificationMethod === 'EMAIL' ? 600 : 300}
            providerConfigured={providerConfigured}
            deliveryFeedback={deliveryFeedback}
            mockCode={mockCode}
            onVerify={handleVerifyOtp}
            onResend={handleResendOtp}
            onBackOrChange={() => setStage('FORM')}
            loading={loading}
            error={error}
            remainingAttempts={remainingAttempts}
          />
        )}

        {/* STAGE 3: VERIFICATION SUCCESS */}
        {stage === 'SUCCESS' && (
          <VerificationSuccess
            userName={createdUser?.name || name}
            role={createdUser?.role || 'PATIENT'}
            verifiedChannel={verificationMethod}
            onProceed={() => navigate('/patient')}
            autoProceedSeconds={3}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="max-w-6xl w-full mx-auto px-6 py-6 text-center text-xs text-slate-400 dark:text-slate-600">
        &copy; {new Date().getFullYear()} LifeLink Emergency Network. Certified DPDP & HIPAA compliant.
      </footer>
    </div>
  );
};

export default Register;
