import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  ShieldAlert,
  ArrowRight,
  AlertCircle,
  Building,
  User,
  Truck,
  KeyRound,
  Smartphone,
  ShieldCheck,
  CheckCircle2,
} from 'lucide-react';
import { ThemeToggle } from '../components/ui/ThemeToggle';
import { HeartbeatLoader } from '../components/ui/HeartbeatLoader';
import { OtpScreen } from '../components/auth/OtpScreen';
import { supabase, isSupabaseConfigured } from '../utils/supabaseClient';

function maskEmailAddress(emailStr: string): string {
  const parts = emailStr.split('@');
  if (parts.length !== 2) return emailStr;
  const name = parts[0];
  const domain = parts[1];
  const visible = name.slice(0, 2);
  return `${visible}***@${domain}`;
}

export const Login: React.FC = () => {
  const { user, login, apiFetch, syncSupabaseSession } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Intended destination preserved from ProtectedRoute
  const destination = (location.state as any)?.from?.pathname;

  const getRedirectForRole = (role: string) => {
    if (destination && destination !== '/login' && destination !== '/unauthorized') {
      return destination;
    }
    if (role === 'PATIENT') return '/patient';
    if (role === 'DRIVER') return '/driver';
    if (role === 'ADMIN_HOSPITAL') return '/hospital';
    if (role === 'OPERATOR_ADMIN') return '/operator';
    if (role === 'SUPER_ADMIN') return '/super-admin';
    return '/';
  };

  // Auto-redirect if already authenticated
  useEffect(() => {
    if (user) {
      navigate(getRedirectForRole(user.role), { replace: true });
    }
  }, [user, navigate]);

  // Auth Mode: 'PASSWORD' vs 'OTP'
  const [authMode, setAuthMode] = useState<'PASSWORD' | 'OTP'>('PASSWORD');

  // Password Sign-in state
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // OTP Sign-in state
  const [otpStage, setOtpStage] = useState<'INPUT' | 'VERIFY'>('INPUT');
  const [otpChannel, setOtpChannel] = useState<'EMAIL' | 'PHONE'>('EMAIL');
  const [maskedRecipient, setMaskedRecipient] = useState('');
  const [otpTargetIdentifier, setOtpTargetIdentifier] = useState('');
  const [providerConfigured, setProviderConfigured] = useState(false);
  const [deliveryFeedback, setDeliveryFeedback] = useState('');
  const [mockCode, setMockCode] = useState<string | undefined>();
  const [remainingAttempts, setRemainingAttempts] = useState<number | undefined>();

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // 1. Password Login
  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!identifier.trim() || !password) {
      setError('Email or phone and password are required.');
      return;
    }

    setLoading(true);

    try {
      const isEmail = identifier.includes('@');
      const payload = isEmail
        ? { email: identifier.trim().toLowerCase(), password }
        : { phone: identifier.trim(), password };

      // Try local LifeLink login first
      try {
        const data = await apiFetch('/auth/login', {
          method: 'POST',
          body: JSON.stringify(payload),
        });

        login(data.token, data.user);
        navigate(getRedirectForRole(data.user.role), { replace: true });
        return;
      } catch (localErr: any) {
        // If local login fails and user supplied email, attempt Supabase Auth password sign-in
        if (isEmail && isSupabaseConfigured() && supabase) {
          const { data: sbData, error: sbError } = await supabase.auth.signInWithPassword({
            email: identifier.trim().toLowerCase(),
            password,
          });

          if (!sbError && sbData?.session?.access_token) {
            const syncedUser = await syncSupabaseSession(sbData.session.access_token);
            navigate(getRedirectForRole(syncedUser.role), { replace: true });
            return;
          }
        }
        throw localErr;
      }
    } catch (err: any) {
      setError(err.message || 'Invalid email or password. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  // 2. Initiate OTP Login
  const handleRequestLoginOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError('');

    if (!identifier.trim()) {
      setError('Please provide your registered email address or mobile number.');
      return;
    }

    setLoading(true);
    const isEmail = identifier.includes('@');
    const channel = isEmail ? 'EMAIL' : 'PHONE';

    // Passwordless Email OTP Login with Supabase
    if (isEmail && isSupabaseConfigured() && supabase) {
      try {
        const redirectUrl = typeof window !== 'undefined' ? `${window.location.origin}/login` : undefined;
        const { error: otpError } = await supabase.auth.signInWithOtp({
          email: identifier.trim().toLowerCase(),
          options: {
            shouldCreateUser: false, // Prevents unintended account creation during login
            emailRedirectTo: redirectUrl,
          },
        });

        if (otpError) {
          const rawMsg = otpError.message.toLowerCase();
          if (rawMsg.includes('signups not allowed') || rawMsg.includes('not found') || rawMsg.includes('user')) {
            setError('No account found for this email address. Please register first.');
          } else if (rawMsg.includes('rate limit')) {
            setError('Too many login attempts. Please wait a minute before requesting another code.');
          } else {
            setError(otpError.message);
          }
          setLoading(false);
          return;
        }

        setOtpChannel('EMAIL');
        setOtpTargetIdentifier(identifier.trim().toLowerCase());
        setMaskedRecipient(maskEmailAddress(identifier.trim()));
        setProviderConfigured(true);
        setDeliveryFeedback('Enter the 6-digit login code sent to your email. You do NOT need to click any link in the email.');
        setOtpStage('VERIFY');
        setLoading(false);
        return;
      } catch (err: any) {
        setError(err.message || 'Failed to dispatch login code.');
        setLoading(false);
        return;
      }
    }

    try {
      const data = await apiFetch('/auth/otp/send', {
        method: 'POST',
        body: JSON.stringify({
          identifier: identifier.trim(),
          channel,
          purpose: 'LOGIN',
        }),
      });

      setOtpChannel(data.channel || channel);
      setOtpTargetIdentifier(data.identifier || identifier.trim());
      setMaskedRecipient(data.maskedRecipient || identifier);
      setProviderConfigured(Boolean(data.providerConfigured));
      setDeliveryFeedback(data.deliveryFeedback || '');
      setMockCode(data.mockCode);
      setOtpStage('VERIFY');
    } catch (err: any) {
      setError(err.message || 'Failed to dispatch login code.');
    } finally {
      setLoading(false);
    }
  };

  // 3. Resend Login OTP
  const handleResendLoginOtp = async () => {
    if (otpChannel === 'EMAIL' && isSupabaseConfigured() && supabase) {
      try {
        const redirectUrl = typeof window !== 'undefined' ? `${window.location.origin}/login` : undefined;
        const { error: resendError } = await supabase.auth.signInWithOtp({
          email: otpTargetIdentifier,
          options: {
            shouldCreateUser: false,
            emailRedirectTo: redirectUrl,
          },
        });
        if (resendError) {
          const rawMsg = resendError.message.toLowerCase();
          if (rawMsg.includes('rate limit')) {
            setError('Too many requests. Please wait a minute before requesting another code.');
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
        setError(err.message || 'Failed to resend code.');
        return { success: false };
      }
    }

    try {
      const data = await apiFetch('/auth/otp/send', {
        method: 'POST',
        body: JSON.stringify({
          identifier: otpTargetIdentifier,
          channel: otpChannel,
          purpose: 'LOGIN',
        }),
      });
      return {
        success: true,
        deliveryFeedback: data.deliveryFeedback,
        providerConfigured: data.providerConfigured,
        mockCode: data.mockCode,
      };
    } catch (err: any) {
      setError(err.message || 'Failed to resend code.');
      return { success: false };
    }
  };

  // 4. Verify Login OTP
  const handleVerifyLoginOtp = async (code: string) => {
    if (loading) return;
    setLoading(true);
    setError('');

    if (otpChannel === 'EMAIL' && isSupabaseConfigured() && supabase) {
      try {
        const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
          email: otpTargetIdentifier,
          token: code.trim(),
          type: 'email',
        });

        if (verifyError || !verifyData?.session?.access_token) {
          let errorMessage = 'Invalid or expired 6-digit login code. Please check and try again.';
          if (verifyError) {
            const rawMsg = verifyError.message.toLowerCase();
            if (rawMsg.includes('expired')) {
              errorMessage = 'The verification code has expired. Please tap "Resend code" to receive a new one.';
            } else if (rawMsg.includes('invalid') || rawMsg.includes('token') || rawMsg.includes('otp')) {
              errorMessage = 'Invalid 6-digit login code. Please check your email and enter the latest code.';
            } else {
              errorMessage = verifyError.message;
            }
          }
          setError(errorMessage);
          setLoading(false);
          return;
        }

        // Idempotently sync user profile with LifeLink backend
        const syncedUser = await syncSupabaseSession(verifyData.session.access_token);
        navigate(getRedirectForRole(syncedUser.role), { replace: true });
      } catch (err: any) {
        setError(err.message || 'Verification succeeded, but session restoration failed.');
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
          channel: otpChannel,
          purpose: 'LOGIN',
          code,
        }),
      });

      login(data.token, data.user);
      navigate(getRedirectForRole(data.user.role), { replace: true });
    } catch (err: any) {
      setError(err.message || 'Invalid verification code.');
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
          <Link
            to="/register"
            className="text-xs font-semibold text-teal-600 dark:text-teal-400 hover:underline"
          >
            New Patient? Register Account
          </Link>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-md w-full mx-auto px-6 py-8">
        {authMode === 'OTP' && otpStage === 'VERIFY' ? (
          <OtpScreen
            identifier={otpTargetIdentifier}
            channel={otpChannel}
            purpose="LOGIN"
            maskedRecipient={maskedRecipient}
            initialCooldown={60}
            initialExpiresIn={otpChannel === 'EMAIL' ? 600 : 300}
            providerConfigured={providerConfigured}
            deliveryFeedback={deliveryFeedback}
            mockCode={mockCode}
            onVerify={handleVerifyLoginOtp}
            onResend={handleResendLoginOtp}
            onBackOrChange={() => setOtpStage('INPUT')}
            loading={loading}
            error={error}
            remainingAttempts={remainingAttempts}
          />
        ) : (
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xl shadow-slate-950/5 p-6 sm:p-8">
            {/* Header */}
            <div className="text-center mb-6">
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-teal-50 dark:bg-teal-950/50 text-teal-700 dark:text-teal-300 rounded-full text-xs font-semibold mb-3 border border-teal-100 dark:border-teal-900/60">
                <ShieldCheck className="w-3.5 h-3.5 text-teal-600" />
                <span>Secure LifeLink Portal</span>
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                Sign In to LifeLink
              </h1>
              <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                Access emergency dispatch coordination, live ambulance maps, and health profiles.
              </p>
            </div>

            {/* Segmented Auth Mode Switch */}
            <div className="flex p-1 bg-slate-100 dark:bg-slate-800 rounded-xl mb-6">
              <button
                type="button"
                onClick={() => {
                  setAuthMode('PASSWORD');
                  setError('');
                }}
                className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  authMode === 'PASSWORD'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                <Lock className="w-3.5 h-3.5" />
                <span>Password</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthMode('OTP');
                  setError('');
                }}
                className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  authMode === 'OTP'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                <Smartphone className="w-3.5 h-3.5" />
                <span>One-Time Code (OTP)</span>
              </button>
            </div>

            {/* Error Message */}
            {error && (
              <div className="mb-5 p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 flex items-start gap-2.5 text-xs text-rose-700 dark:text-rose-400">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-500 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {/* MODE A: PASSWORD LOGIN */}
            {authMode === 'PASSWORD' ? (
              <form onSubmit={handlePasswordLogin} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                    Email or Mobile Number
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      required
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      placeholder="name@example.com or 9876543210"
                      className="w-full h-11 pl-10 pr-4 bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 text-slate-900 dark:text-slate-100"
                    />
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Password
                    </label>
                    <Link
                      to="/forgot-password"
                      className="text-xs font-semibold text-teal-600 dark:text-teal-400 hover:underline"
                    >
                      Forgot password?
                    </Link>
                  </div>
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
                      className="absolute right-3.5 top-3.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full h-11 mt-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs uppercase tracking-wider transition-all shadow-md shadow-teal-600/20 active:scale-[0.99] flex items-center justify-center gap-2 cursor-pointer disabled:bg-slate-200 dark:disabled:bg-slate-800 disabled:text-slate-400 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <div className="flex items-center gap-2">
                      <HeartbeatLoader size="small" />
                      <span>Authenticating...</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span>Sign In</span>
                      <ArrowRight className="w-4 h-4" />
                    </div>
                  )}
                </button>
              </form>
            ) : (
              /* MODE B: PASSWORDLESS OTP LOGIN */
              <form onSubmit={handleRequestLoginOtp} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                    Registered Email or Mobile Number
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      required
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      placeholder="name@example.com or 9876543210"
                      className="w-full h-11 pl-10 pr-4 bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 text-slate-900 dark:text-slate-100"
                    />
                    <Smartphone className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                  </div>
                  <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                    We will send a 6-digit verification code to sign you in passwordlessly.
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={loading || !identifier.trim()}
                  className="w-full h-11 mt-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs uppercase tracking-wider transition-all shadow-md shadow-teal-600/20 active:scale-[0.99] flex items-center justify-center gap-2 cursor-pointer disabled:bg-slate-200 dark:disabled:bg-slate-800 disabled:text-slate-400 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <div className="flex items-center gap-2">
                      <HeartbeatLoader size="small" />
                      <span>Sending OTP...</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span>Send One-Time Code</span>
                      <ArrowRight className="w-4 h-4" />
                    </div>
                  )}
                </button>
              </form>
            )}

            {/* Quick Portals Navigation */}
            <div className="mt-8 pt-5 border-t border-slate-100 dark:border-slate-800 text-center">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 block mb-3">
                Other Access Portals
              </span>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <Link
                  to="/admin/login"
                  className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 flex items-center justify-center gap-1.5 font-medium text-slate-700 dark:text-slate-300 transition-colors"
                >
                  <Building className="w-3.5 h-3.5 text-teal-600" />
                  <span>Hospital Admin</span>
                </Link>
                <Link
                  to="/register-hospital"
                  className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 flex items-center justify-center gap-1.5 font-medium text-slate-700 dark:text-slate-300 transition-colors"
                >
                  <Truck className="w-3.5 h-3.5 text-teal-600" />
                  <span>Join Network</span>
                </Link>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="max-w-6xl w-full mx-auto px-6 py-6 text-center text-xs text-slate-400 dark:text-slate-600">
        &copy; {new Date().getFullYear()} LifeLink Emergency Network. Certified DPDP & HIPAA compliant.
      </footer>
    </div>
  );
};

export default Login;
