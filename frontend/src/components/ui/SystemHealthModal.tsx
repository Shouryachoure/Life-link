import React, { useState, useEffect } from 'react';
import { getBackendBaseUrl } from '../../config/apiConfig';
import { Activity, CheckCircle2, AlertTriangle, X, RefreshCw, Database, Server, ShieldCheck, Zap } from 'lucide-react';

interface HealthData {
  status: string;
  service: string;
  version: string;
  environment: string;
  uptimeSeconds: number;
  timestamp: string;
}

interface ReadinessData {
  status: string;
  database?: {
    status: string;
    type?: string;
    latencyMs?: number;
    message?: string;
  };
  timestamp: string;
}

export const SystemHealthModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [readiness, setReadiness] = useState<ReadinessData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkStatus = async () => {
    setLoading(true);
    setError(null);
    const baseUrl = getBackendBaseUrl();

    try {
      // 1. Process Health
      const healthRes = await fetch(`${baseUrl}/api/v1/health`);
      if (healthRes.ok) {
        const data = await healthRes.json();
        setHealth(data);
      } else {
        setError(`API process returned HTTP ${healthRes.status}`);
      }

      // 2. DB Readiness
      const readyRes = await fetch(`${baseUrl}/api/v1/health/ready`);
      const readyData = await readyRes.json();
      setReadiness(readyData);
    } catch (err: any) {
      setError(err?.message || 'Failed to reach LifeLink Backend API. Ensure backend server is running on port 5001.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      checkStatus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const isDbReady = readiness?.database?.status === 'connected';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-lg bg-slate-900 border border-slate-700/60 rounded-3xl p-6 sm:p-8 text-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-600/20 border border-rose-500/30 flex items-center justify-center text-rose-500">
              <Activity className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white tracking-wide">System & Service Health</h3>
              <p className="text-xs text-slate-400 font-mono">LifeLink Architecture Diagnostic</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full border border-slate-700 flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="mt-6 space-y-4">
          {error && (
            <div className="p-3.5 rounded-2xl bg-amber-950/40 border border-amber-600/30 text-amber-200 text-xs flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Backend Unreachable</p>
                <p className="text-[11px] text-amber-300/80 mt-0.5">{error}</p>
              </div>
            </div>
          )}

          {/* Service Cards */}
          <div className="grid grid-cols-2 gap-3">
            {/* API Process */}
            <div className="p-4 rounded-2xl bg-slate-800/50 border border-slate-700/50 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <Server className="w-3.5 h-3.5 text-cyan-400" />
                  API Process
                </span>
                {health?.status === 'ok' ? (
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                ) : (
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                )}
              </div>
              <div className="mt-3">
                <div className="text-sm font-bold font-mono">
                  {health?.status === 'ok' ? 'HEALTHY (200)' : 'OFFLINE'}
                </div>
                <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                  Uptime: {health ? `${health.uptimeSeconds}s` : 'N/A'}
                </div>
              </div>
            </div>

            {/* Database Readiness */}
            <div className="p-4 rounded-2xl bg-slate-800/50 border border-slate-700/50 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <Database className="w-3.5 h-3.5 text-indigo-400" />
                  PostgreSQL DB
                </span>
                {isDbReady ? (
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                ) : (
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                )}
              </div>
              <div className="mt-3">
                <div className="text-sm font-bold font-mono">
                  {isDbReady ? 'CONNECTED' : 'DISCONNECTED'}
                </div>
                <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                  {isDbReady ? `${readiness?.database?.latencyMs}ms latency` : 'Service offline (503)'}
                </div>
              </div>
            </div>
          </div>

          {/* Architecture Checklist */}
          <div className="p-4 rounded-2xl bg-slate-800/30 border border-slate-700/40 text-xs space-y-2">
            <span className="text-[10px] uppercase font-mono tracking-wider font-bold text-slate-400 block mb-2">
              Zero-Cost Baseline Controls
            </span>
            <div className="flex items-center justify-between text-slate-300 text-[11px]">
              <span className="flex items-center gap-2">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                Mandatory Paid API Dependencies
              </span>
              <span className="font-mono text-emerald-400 font-semibold">₹0 Required</span>
            </div>
            <div className="flex items-center justify-between text-slate-300 text-[11px]">
              <span className="flex items-center gap-2">
                <Zap className="w-3.5 h-3.5 text-cyan-400" />
                Real-Time Transport
              </span>
              <span className="font-mono text-slate-300">Socket.IO / OpenStreetMap</span>
            </div>
            <div className="flex items-center justify-between text-slate-300 text-[11px]">
              <span className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                AI & SMS Fallbacks
              </span>
              <span className="font-mono text-slate-300">Graceful Local Mock Adapters</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 pt-4 border-t border-slate-800 flex items-center justify-between">
          <button
            onClick={checkStatus}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Recheck Health</span>
          </button>
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
