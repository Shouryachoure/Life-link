import React from 'react';
import { Link } from 'react-router-dom';
import { HelpCircle, Home, ArrowLeft } from 'lucide-react';

export const NotFound: React.FC = () => {
  return (
    <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-6 selection:bg-rose-500/30">
      <div className="relative max-w-md w-full bg-slate-800/80 border border-slate-700/80 rounded-3xl p-8 text-center shadow-2xl backdrop-blur-md">
        <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center mx-auto mb-6">
          <HelpCircle className="w-8 h-8" />
        </div>

        <span className="text-[10px] font-extrabold uppercase font-mono tracking-widest text-indigo-400 block mb-2">
          HTTP 404 Not Found
        </span>

        <h1 className="text-2xl font-bold tracking-tight text-white mb-3">
          Page Not Located
        </h1>

        <p className="text-xs text-slate-400 leading-relaxed mb-8">
          The requested LifeLink route or resource does not exist. Please check the URL or return to the main portal navigation.
        </p>

        <Link
          to="/"
          className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-slate-700 hover:bg-slate-600 text-xs font-semibold text-white transition-colors"
        >
          <Home className="w-4 h-4" />
          <span>Back to LifeLink Main Portal</span>
        </Link>
      </div>
    </div>
  );
};

export default NotFound;
