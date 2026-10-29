import React, { useState, useEffect } from 'react';
import { Mail, Phone, ShieldCheck, ArrowLeft, RefreshCw, AlertCircle, Info, Clock } from 'lucide-react';
import { OtpInput } from './OtpInput';
import { HeartbeatLoader } from '../ui/HeartbeatLoader';

interface OtpScreenProps {
  identifier: string;
  channel: 'EMAIL' | 'PHONE';
  purpose: 'REGISTRATION' | 'LOGIN' | 'PASSWORD_RESET';
  maskedRecipient: string;
  initialCooldown?: number;
  initialExpiresIn?: number;
  providerConfigured?: boolean;
  deliveryFeedback?: string;
  mockCode?: string;
  onVerify: (code: string) => Promise<void>;
  onResend: () => Promise<{ success: boolean; deliveryFeedback?: string; providerConfigured?: boolean; mockCode?: string }>;
  onBackOrChange: () => void;
  loading: boolean;
  error?: string;
  remainingAttempts?: number;
}

export const OtpScreen: React.FC<OtpScreenProps> = ({
  identifier,
  channel,
  purpose,
  maskedRecipient,
  initialCooldown = 60,
  initialExpiresIn,
  providerConfigured = false,
  deliveryFeedback,
  mockCode: initialMockCode,
  onVerify,
  onResend,
  onBackOrChange,
  loading,
  error,
  remainingAttempts,
}) => {
  const defaultExpiry = initialExpiresIn ?? (channel === 'EMAIL' ? 600 : 300);
  const [code, setCode] = useState('');
  const [cooldown, setCooldown] = useState(initialCooldown);
  const [expiresIn, setExpiresIn] = useState(defaultExpiry);
  const [resending, setResending] = useState(false);
  const [currentFeedback, setCurrentFeedback] = useState(deliveryFeedback || '');
  const [currentMockCode, setCurrentMockCode] = useState(initialMockCode);
  const [localProviderConfigured, setLocalProviderConfigured] = useState(providerConfigured);

  // Sync incoming delivery feedback
  useEffect(() => {
    if (deliveryFeedback) {
      setCurrentFeedback(deliveryFeedback);
    }
  }, [deliveryFeedback]);

  // Cooldown countdown
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  // Expiry countdown
  useEffect(() => {
    if (expiresIn <= 0) return;
    const timer = setInterval(() => {
      setExpiresIn((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [expiresIn]);

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleResend = async () => {
    if (cooldown > 0 || resending) return;
    setResending(true);
    try {
      const result = await onResend();
      if (result.success) {
        setCooldown(60);
        setExpiresIn(channel === 'EMAIL' ? 600 : 300);
        setCode('');
        if (result.deliveryFeedback) {
          setCurrentFeedback(result.deliveryFeedback);
        }
        if (result.mockCode) {
          setCurrentMockCode(result.mockCode);
        }
        if (result.providerConfigured !== undefined) {
          setLocalProviderConfigured(result.providerConfigured);
        }
      }
    } finally {
      setResending(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length === 6 && !loading) {
      onVerify(code);
    }
  };

  const isExpired = expiresIn <= 0;

  return (
    <div className="w-full max-w-md mx-auto p-6 sm:p-8 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xl shadow-slate-950/5">
      {/* Top Navigation */}
      <button
        type="button"
        onClick={onBackOrChange}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 mb-6 transition-colors group"
      >
        <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
        Back / Change {channel === 'EMAIL' ? 'Email' : 'Mobile Number'}
      </button>

      {/* Header Badge & Title */}
      <div className="text-center mb-6">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-teal-50 dark:bg-teal-950/50 text-teal-600 dark:text-teal-400 border border-teal-100 dark:border-teal-900/60 shadow-sm shadow-teal-500/10 mb-4">
          {channel === 'EMAIL' ? <Mail className="w-7 h-7" /> : <Phone className="w-7 h-7" />}
        </div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          {purpose === 'REGISTRATION'
            ? `Verify Your ${channel === 'EMAIL' ? 'Email Address' : 'Mobile Number'}`
            : purpose === 'PASSWORD_RESET'
            ? 'Enter Security Reset Code'
            : 'Verify Identity'}
        </h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
          We sent a 6-digit verification code to
        </p>
        <div className="inline-block mt-1 px-3 py-1 bg-slate-100 dark:bg-slate-800 rounded-lg text-sm font-semibold font-mono text-slate-800 dark:text-slate-200">
          {maskedRecipient || identifier}
        </div>
      </div>

      {/* Email Direct Code Entry Guidance */}
      {channel === 'EMAIL' && (
        <div className="mb-5 p-3.5 bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200/70 dark:border-blue-900/40 rounded-2xl flex items-start gap-3 text-xs text-blue-900 dark:text-blue-200">
          <div className="w-6 h-6 rounded-lg bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center shrink-0 text-blue-600 dark:text-blue-400 mt-0.5">
            <ShieldCheck className="w-3.5 h-3.5" />
          </div>
          <div className="leading-relaxed">
            <span className="font-semibold block text-blue-950 dark:text-blue-100 mb-0.5">
              Enter 6-digit code directly
            </span>
            Enter the 6-digit verification code sent to your email below. You do <span className="font-semibold underline">not</span> need to click any confirmation link in the email.
          </div>
        </div>
      )}

      {/* Delivery Feedback if available */}
      {currentFeedback && (
        <div className="mb-4 text-center px-3 py-2 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200/60 dark:border-slate-800">
          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            {currentFeedback}
          </p>
        </div>
      )}

      {/* Provider State Feedback Notice */}
      {!localProviderConfigured && (
        <div className="mb-5 p-3.5 bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-800/60 rounded-xl flex items-start gap-3 text-xs text-amber-800 dark:text-amber-300">
          <Info className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
          <div className="leading-relaxed">
            <span className="font-semibold block mb-0.5">Development Sandbox Mode:</span>
            {channel === 'PHONE' ? (
              <>
                SMS provider (Twilio) is not configured in <code className="px-1 py-0.5 bg-amber-100 dark:bg-amber-900 rounded font-mono">.env</code>.
                Live carrier SMS could not be sent. Check your secure server console for the generated OTP code.
              </>
            ) : (
              <>
                SMTP email credentials not set in <code className="px-1 py-0.5 bg-amber-100 dark:bg-amber-900 rounded font-mono">.env</code>.
                Check your server terminal log for the verification code.
              </>
            )}
            {currentMockCode && (
              <div className="mt-2 pt-2 border-t border-amber-200 dark:border-amber-800/60 font-mono font-bold text-amber-900 dark:text-amber-200">
                Sandbox Code: <span className="tracking-widest text-sm bg-white dark:bg-slate-900 px-2 py-0.5 rounded border border-amber-300 dark:border-amber-700">{currentMockCode}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div className="mb-5 p-3.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 rounded-xl flex items-start gap-2.5 text-xs font-medium text-rose-700 dark:text-rose-400">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-500" />
          <div className="leading-relaxed">
            {error}
            {remainingAttempts !== undefined && remainingAttempts > 0 && (
              <span className="block mt-0.5 font-semibold">({remainingAttempts} attempt(s) remaining)</span>
            )}
          </div>
        </div>
      )}

      {/* OTP Input Form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-center text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
            Enter 6-Digit Code
          </label>
          <OtpInput
            value={code}
            onChange={setCode}
            disabled={loading || isExpired}
            hasError={Boolean(error)}
            autoFocus
          />
        </div>

        {/* Timer & Expiry */}
        <div className="flex items-center justify-between text-xs px-1">
          <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 font-medium">
            <Clock className="w-3.5 h-3.5" />
            {isExpired ? (
              <span className="text-rose-600 dark:text-rose-400 font-semibold">Code has expired</span>
            ) : (
              <span>
                Expires in <strong className="font-mono text-slate-700 dark:text-slate-300">{formatTimer(expiresIn)}</strong>
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={handleResend}
            disabled={cooldown > 0 || resending}
            className={`inline-flex items-center gap-1 font-semibold transition-colors ${
              cooldown > 0 || resending
                ? 'text-slate-400 dark:text-slate-600 cursor-not-allowed'
                : 'text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-teal-300 underline'
            }`}
          >
            <RefreshCw className={`w-3 h-3 ${resending ? 'animate-spin' : ''}`} />
            {cooldown > 0 ? `Resend code (${cooldown}s)` : 'Resend code'}
          </button>
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={code.length !== 6 || loading || isExpired}
          className={`w-full h-12 rounded-xl text-sm font-bold tracking-wide transition-all flex items-center justify-center gap-2 shadow-sm
            ${
              code.length === 6 && !loading && !isExpired
                ? 'bg-teal-600 hover:bg-teal-700 text-white shadow-teal-600/20 active:scale-[0.99] cursor-pointer'
                : 'bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed'
            }
          `}
        >
          {loading ? (
            <div className="flex items-center gap-2">
              <HeartbeatLoader size="small" />
              <span>Verifying code...</span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4" />
              <span>Confirm & Activate</span>
            </div>
          )}
        </button>
      </form>

      {/* Security Reassurance Footer */}
      <div className="mt-8 pt-5 border-t border-slate-100 dark:border-slate-800/80 text-center">
        <p className="text-[11px] text-slate-400 dark:text-slate-500 leading-tight">
          🔒 LifeLink Emergency Security: Your verification code is encrypted and single-use. Medical responders will never request this code.
        </p>
      </div>
    </div>
  );
};
