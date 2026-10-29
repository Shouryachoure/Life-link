import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  KeyRound,
  Mail,
  Phone,
  ArrowRight,
  ArrowLeft,
  Lock,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  ShieldAlert,
} from 'lucide-react';
import { OtpInput } from '../components/auth/OtpInput';
import { ThemeToggle } from '../components/ui/ThemeToggle';
import { HeartbeatLoader } from '../components/ui/HeartbeatLoader';

export const ForgotPassword: React.FC = () => {
  const { apiFetch } = useAuth();
  const navigate = useNavigate();

  // Steps: 1: IDENTIFIER -> 2: OTP -> 3: NEW_PASSWORD -> 4: SUCCESS
  const [step, setStep] = useState<'IDENTIFIER' | 'OTP' | 'NEW_PASSWORD' | 'SUCCESS'>('IDENTIFIER');

  // Form states
  const [identifier, setIdentifier] = useState('');
  const [channel, setChannel] = useState<'EMAIL' | 'PHONE'>('EMAIL');
  const [maskedRecipient, setMaskedRecipient] = useState('');
  const [mockCode, setMockCode] = useState<string | undefined>();
  const [providerConfigured, setProviderConfigured] = useState(false);
  const [deliveryFeedback, setDeliveryFeedback] = useState('');

  // OTP state
  const [otpCode, setOtpCode] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [remainingAttempts, setRemainingAttempts] = useState<number | undefined>();
  const [cooldown, setCooldown] = useState(60);

  // New Password state
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Cooldown timer
  React.useEffect(() => {
    if (step !== 'OTP' || cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(timer);
  }, [step, cooldown]);

  // Live password validation
  const isLengthValid = newPassword.length >= 12;
  const isMatchValid = newPassword.length > 0 && newPassword === confirmPassword;

  // 1. Submit Identifier (Request Reset OTP)
  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!identifier.trim()) {
      setError('Please provide your registered email address or mobile number.');
      return;
    }

    setLoading(true);
    try {
      const data = await apiFetch('/auth/forgot-password/request', {
        method: 'POST',
        body: JSON.stringify({ identifier: identifier.trim() }),
      });

      setMaskedRecipient(data.maskedRecipient || identifier);
      setChannel(data.channel || (identifier.includes('@') ? 'EMAIL' : 'PHONE'));
      setProviderConfigured(Boolean(data.providerConfigured));
      setDeliveryFeedback(data.deliveryFeedback || '');
      setMockCode(data.mockCode);
      setCooldown(60);
      setStep('OTP');
    } catch (err: any) {
      setError(err.message || 'Failed to request password reset code.');
    } finally {
      setLoading(false);
    }
  };

  // 2. Resend Reset OTP
  const handleResendOtp = async () => {
    if (cooldown > 0 || loading) return;
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch('/auth/forgot-password/request', {
        method: 'POST',
        body: JSON.stringify({ identifier: identifier.trim() }),
      });
      setCooldown(60);
      setOtpCode('');
      setDeliveryFeedback(data.deliveryFeedback || '');
      setMockCode(data.mockCode);
    } catch (err: any) {
      setError(err.message || 'Failed to resend reset code.');
    } finally {
      setLoading(false);
    }
  };

  // 3. Verify OTP
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otpCode.length !== 6) return;

    setLoading(true);
    setError('');
    try {
      const data = await apiFetch('/auth/otp/verify', {
        method: 'POST',
        body: JSON.stringify({
          identifier: identifier.trim(),
          channel,
          purpose: 'PASSWORD_RESET',
          code: otpCode,
        }),
      });

      setResetToken(data.resetToken);
      setStep('NEW_PASSWORD');
    } catch (err: any) {
      setError(err.message || 'Invalid verification code.');
      if (err.remainingAttempts !== undefined) {
        setRemainingAttempts(err.remainingAttempts);
      }
    } finally {
      setLoading(false);
    }
  };

  // 4. Set New Password
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!isLengthValid) {
      setError('Password must be at least 12 characters long.');
      return;
    }

    if (!isMatchValid) {
      setError('Passwords do not match. Please verify your entries.');
      return;
    }

    setLoading(true);
    try {
      await apiFetch('/auth/forgot-password/reset', {
        method: 'POST',
        body: JSON.stringify({
          resetToken,
          newPassword,
          confirmPassword,
        }),
      });

      setStep('SUCCESS');
    } catch (err: any) {
      setError(err.message || 'Failed to reset password. Token may have expired.');
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
            Back to Sign In
          </Link>
        </div>
      </header>

      {/* Main Content Card */}
      <main className="w-full max-w-md mx-auto px-6 py-8">
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xl shadow-slate-950/5 p-6 sm:p-8">
          
          {/* STEP 1: IDENTIFIER INPUT */}
          {step === 'IDENTIFIER' && (
            <div>
              <div className="text-center mb-6">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-teal-50 dark:bg-teal-950/50 text-teal-600 dark:text-teal-400 border border-teal-100 dark:border-teal-900/60 mb-3">
                  <KeyRound className="w-6 h-6" />
                </div>
                <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  Password Recovery
                </h1>
                <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                  Enter your registered LifeLink email address or Indian mobile number to receive a secure recovery code.
                </p>
              </div>

              {error && (
                <div className="mb-5 p-3.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 rounded-xl flex items-start gap-2.5 text-xs text-rose-700 dark:text-rose-400">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-500" />
                  <span>{error}</span>
                </div>
              )}

              <form onSubmit={handleRequestOtp} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                    Email or Mobile Number
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      placeholder="e.g. ananya@lifelink.org or 9876543210"
                      className="w-full h-11 pl-10 pr-4 bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 text-slate-900 dark:text-slate-100"
                    />
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading || !identifier.trim()}
                  className="w-full h-11 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs uppercase tracking-wider transition-all shadow-md shadow-teal-600/20 active:scale-[0.99] flex items-center justify-center gap-2 cursor-pointer disabled:bg-slate-200 dark:disabled:bg-slate-800 disabled:text-slate-400 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <div className="flex items-center gap-2">
                      <HeartbeatLoader size="small" />
                      <span>Sending code...</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span>Send Recovery Code</span>
                      <ArrowRight className="w-4 h-4" />
                    </div>
                  )}
                </button>
              </form>
            </div>
          )}

          {/* STEP 2: OTP VERIFICATION */}
          {step === 'OTP' && (
            <div>
              <button
                type="button"
                onClick={() => setStep('IDENTIFIER')}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 mb-4 group"
              >
                <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
                Change Contact
              </button>

              <div className="text-center mb-6">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-teal-50 dark:bg-teal-950/50 text-teal-600 dark:text-teal-400 border border-teal-100 dark:border-teal-900/60 mb-3">
                  {channel === 'EMAIL' ? <Mail className="w-6 h-6" /> : <Phone className="w-6 h-6" />}
                </div>
                <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  Enter Recovery Code
                </h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  We sent a 6-digit code to <strong className="font-mono text-slate-700 dark:text-slate-300">{maskedRecipient}</strong>
                </p>
              </div>

              {!providerConfigured && mockCode && (
                <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                  <span className="font-semibold block mb-0.5">Development Sandbox Mode:</span>
                  Provider not configured in .env. Test code: <strong className="font-mono bg-white dark:bg-slate-900 px-1.5 py-0.5 rounded border border-amber-300 dark:border-amber-700">{mockCode}</strong>
                </div>
              )}

              {error && (
                <div className="mb-4 p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-xl text-xs text-rose-700 dark:text-rose-400 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    {error}
                    {remainingAttempts !== undefined && remainingAttempts > 0 && (
                      <span className="block font-semibold">({remainingAttempts} attempt(s) remaining)</span>
                    )}
                  </div>
                </div>
              )}

              <form onSubmit={handleVerifyOtp} className="space-y-5">
                <OtpInput
                  value={otpCode}
                  onChange={setOtpCode}
                  disabled={loading}
                  hasError={Boolean(error)}
                  autoFocus
                />

                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500 dark:text-slate-400">Didn't receive code?</span>
                  <button
                    type="button"
                    onClick={handleResendOtp}
                    disabled={cooldown > 0 || loading}
                    className={`font-semibold ${
                      cooldown > 0
                        ? 'text-slate-400 cursor-not-allowed'
                        : 'text-teal-600 dark:text-teal-400 hover:underline cursor-pointer'
                    }`}
                  >
                    {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
                  </button>
                </div>

                <button
                  type="submit"
                  disabled={otpCode.length !== 6 || loading}
                  className="w-full h-11 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs uppercase tracking-wider transition-all shadow-md shadow-teal-600/20 active:scale-[0.99] flex items-center justify-center gap-2 cursor-pointer disabled:bg-slate-200 dark:disabled:bg-slate-800 disabled:text-slate-400 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <div className="flex items-center gap-2">
                      <HeartbeatLoader size="small" />
                      <span>Verifying code...</span>
                    </div>
                  ) : (
                    <span>Confirm Code</span>
                  )}
                </button>
              </form>
            </div>
          )}

          {/* STEP 3: SET NEW PASSWORD */}
          {step === 'NEW_PASSWORD' && (
            <div>
              <div className="text-center mb-6">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-teal-50 dark:bg-teal-950/50 text-teal-600 dark:text-teal-400 border border-teal-100 dark:border-teal-900/60 mb-3">
                  <Lock className="w-6 h-6" />
                </div>
                <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  Set New Password
                </h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Choose a robust password with a minimum of 12 characters to protect your medical account.
                </p>
              </div>

              {error && (
                <div className="mb-4 p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-xl text-xs text-rose-700 dark:text-rose-400 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <form onSubmit={handleResetPassword} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                    New Password (Min 12 Characters)
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
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

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                    Confirm New Password
                  </label>
                  <div className="relative">
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="••••••••••••"
                      className="w-full h-11 pl-10 pr-10 bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 text-slate-900 dark:text-slate-100"
                    />
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3.5 top-3.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                    >
                      {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Live validation checklist */}
                <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-800 text-xs space-y-1.5">
                  <div className={`flex items-center gap-1.5 ${isLengthValid ? 'text-teal-600 dark:text-teal-400' : 'text-slate-400'}`}>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Minimum 12 characters long</span>
                  </div>
                  <div className={`flex items-center gap-1.5 ${isMatchValid ? 'text-teal-600 dark:text-teal-400' : 'text-slate-400'}`}>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Passwords match</span>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading || !isLengthValid || !isMatchValid}
                  className="w-full h-11 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs uppercase tracking-wider transition-all shadow-md shadow-teal-600/20 active:scale-[0.99] flex items-center justify-center gap-2 cursor-pointer disabled:bg-slate-200 dark:disabled:bg-slate-800 disabled:text-slate-400 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <div className="flex items-center gap-2">
                      <HeartbeatLoader size="small" />
                      <span>Updating password...</span>
                    </div>
                  ) : (
                    <span>Update Password</span>
                  )}
                </button>
              </form>
            </div>
          )}

          {/* STEP 4: SUCCESS */}
          {step === 'SUCCESS' && (
            <div className="text-center py-4">
              <div className="w-16 h-16 rounded-full bg-teal-100 dark:bg-teal-950/60 text-teal-600 dark:text-teal-400 flex items-center justify-center mx-auto mb-4 shadow-sm shadow-teal-500/10">
                <CheckCircle2 className="w-8 h-8 stroke-[2.5]" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                Password Successfully Reset
              </h2>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Your LifeLink account password has been updated securely. All prior active sessions have been revoked.
              </p>

              <button
                type="button"
                onClick={() => navigate('/login')}
                className="mt-6 w-full h-11 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs uppercase tracking-wider transition-all shadow-md shadow-teal-600/20 flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>Sign In with New Password</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}

        </div>
      </main>

      {/* Footer */}
      <footer className="max-w-6xl w-full mx-auto px-6 py-6 text-center text-xs text-slate-400 dark:text-slate-600">
        &copy; {new Date().getFullYear()} LifeLink Emergency Network. Certified DPDP & HIPAA compliant.
      </footer>
    </div>
  );
};

export default ForgotPassword;
