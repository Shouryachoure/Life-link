import React, { useEffect, useState } from 'react';
import { CheckCircle2, ArrowRight, ShieldCheck, Heart, Sparkles } from 'lucide-react';

interface VerificationSuccessProps {
  userName: string;
  role: string;
  verifiedChannel?: 'EMAIL' | 'PHONE';
  onProceed: () => void;
  autoProceedSeconds?: number;
}

export const VerificationSuccess: React.FC<VerificationSuccessProps> = ({
  userName,
  role,
  verifiedChannel = 'EMAIL',
  onProceed,
  autoProceedSeconds = 3,
}) => {
  const [countdown, setCountdown] = useState(autoProceedSeconds);

  useEffect(() => {
    if (countdown <= 0) {
      onProceed();
      return;
    }
    const timer = setInterval(() => {
      setCountdown((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown, onProceed]);

  return (
    <div className="w-full max-w-md mx-auto p-8 bg-white dark:bg-slate-900 rounded-3xl border border-teal-100 dark:border-teal-900/60 shadow-xl shadow-teal-950/10 text-center animate-in fade-in zoom-in-95 duration-300">
      {/* Animated Success Badge */}
      <div className="relative mx-auto w-20 h-20 mb-6 flex items-center justify-center">
        <div className="absolute inset-0 rounded-full bg-teal-100 dark:bg-teal-950/60 animate-ping opacity-75" />
        <div className="relative w-20 h-20 rounded-full bg-teal-600 flex items-center justify-center text-white shadow-lg shadow-teal-600/30">
          <CheckCircle2 className="w-10 h-10 stroke-[2.5]" />
        </div>
      </div>

      <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-teal-50 dark:bg-teal-950/50 border border-teal-200/60 dark:border-teal-800 text-teal-700 dark:text-teal-300 text-xs font-semibold mb-3">
        <Sparkles className="w-3.5 h-3.5 text-teal-500" />
        <span>Identity Confirmed & Activated</span>
      </div>

      <h2 className="text-2xl font-black tracking-tight text-slate-900 dark:text-slate-100">
        Welcome to LifeLink, {userName || 'Patient'}!
      </h2>

      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 leading-relaxed max-w-sm mx-auto">
        Your {verifiedChannel === 'EMAIL' ? 'email address' : 'mobile phone'} has been cryptographically verified. Your LifeLink emergency profile is now active and ready for dispatch coordination.
      </p>

      {/* Profile Details Card */}
      <div className="mt-6 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 text-left space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-500 dark:text-slate-400">Account Type</span>
          <span className="font-bold text-slate-900 dark:text-slate-100">{role}</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-500 dark:text-slate-400">Verification Channel</span>
          <span className="font-bold text-teal-600 dark:text-teal-400">
            {verifiedChannel === 'EMAIL' ? 'Email OTP' : 'SMS Phone OTP'}
          </span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-500 dark:text-slate-400">Dispatch Status</span>
          <span className="inline-flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Active & Protected
          </span>
        </div>
      </div>

      {/* Action Button */}
      <div className="mt-8">
        <button
          type="button"
          onClick={onProceed}
          className="w-full h-12 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-sm tracking-wide transition-all shadow-md shadow-teal-600/20 active:scale-[0.99] flex items-center justify-center gap-2 cursor-pointer"
        >
          <span>Proceed to Dashboard</span>
          <ArrowRight className="w-4 h-4" />
        </button>
        <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
          Redirecting automatically in {countdown} second{countdown === 1 ? '' : 's'}...
        </p>
      </div>
    </div>
  );
};
