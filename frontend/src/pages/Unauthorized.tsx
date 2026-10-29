import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldAlert, ArrowLeft, Home, LogIn } from 'lucide-react';

export const Unauthorized: React.FC = () => {
  return (
    <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-6 selection:bg-rose-500/30">
      <div className="relative max-w-md w-full bg-slate-800/80 border border-slate-700/80 rounded-3xl p-8 text-center shadow-2xl backdrop-blur-md">
        <div className="w-16 h-16 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-500 flex items-center justify-center mx-auto mb-6">
          <ShieldAlert className="w-8 h-8" />
        </div>

        <span className="text-[10px] font-extrabold uppercase font-mono tracking-widest text-rose-400 block mb-2">
          HTTP 403 Forbidden
        </span>

        <h1 className="text-2xl font-bold tracking-tight text-white mb-3">
          Access Restricted
        </h1>

        <p className="text-xs text-slate-400 leading-relaxed mb-8">
          You do not have the required role permissions to access this healthcare dashboard or resource. Please log in with an authorized account or return to the main portal.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            to="/"
            className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl border border-slate-700 hover:bg-slate-700/50 text-xs font-semibold text-slate-300 transition-colors"
          >
            <Home className="w-4 h-4" />
            <span>Return Home</span>
          </Link>
          <Link
            to="/login"
            className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs font-semibold text-white transition-colors"
          >
            <LogIn className="w-4 h-4" />
            <span>Switch Account</span>
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Unauthorized;
