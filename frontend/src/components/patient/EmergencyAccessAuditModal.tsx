import React, { useEffect, useState } from 'react';
import { Shield, Clock, X, Lock, CheckCircle2, AlertCircle } from 'lucide-react';
import { HeartbeatLoader } from '../ui/HeartbeatLoader';

interface EmergencyAccessAuditModalProps {
  isOpen: boolean;
  onClose: () => void;
  apiFetch: (endpoint: string, options?: RequestInit) => Promise<any>;
}

export const EmergencyAccessAuditModal: React.FC<EmergencyAccessAuditModalProps> = ({
  isOpen,
  onClose,
  apiFetch,
}) => {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    fetchLogs();
  }, [isOpen]);

  const fetchLogs = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch('/api/v1/emergency-profile/access-logs?take=50');
      setLogs(data?.logs || (Array.isArray(data) ? data : []));
    } catch (err: any) {
      setError(err.message || 'Network error loading access audit records');
    } finally {
      setLoading(false);
    }
  };


  if (!isOpen) return null;

  const getAccessBadge = (type: string) => {
    switch (type) {
      case 'BREAK_GLASS_QR':
        return (
          <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/30">
            🚨 Break-Glass Emergency
          </span>
        );
      case 'ACTIVE_DISPATCH_TRIAGE':
        return (
          <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30">
            🚑 Dispatch Triage
          </span>
        );
      case 'PUBLIC_QR_SAFETY_CARD':
        return (
          <span className="px-2.5 py-1 rounded-full text-[10px] font-medium bg-sky-500/10 text-sky-400 border border-sky-500/30">
            📱 Public Safety Scan
          </span>
        );
      case 'PATIENT_DIRECT_VIEW':
        return (
          <span className="px-2.5 py-1 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
            👤 Patient Self-View
          </span>
        );
      case 'HOSPITAL_ADMISSION_TRIAGE':
        return (
          <span className="px-2.5 py-1 rounded-full text-[10px] font-medium bg-purple-500/10 text-purple-400 border border-purple-500/30">
            🏥 Clinical Verification
          </span>
        );
      default:
        return (
          <span className="px-2.5 py-1 rounded-full text-[10px] font-medium bg-slate-500/10 text-slate-400 border border-slate-500/30">
            {type}
          </span>
        );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-3xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-3xl shadow-2xl p-6 md:p-8 space-y-6 text-gray-900 dark:text-slate-100 my-8 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 dark:border-slate-800 pb-4 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-sky-500/10 text-sky-400 border border-sky-500/20 flex items-center justify-center">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold">Emergency Health Access Audit Log</h2>
              <p className="text-xs text-slate-400">
                Immutable audit trail of all responder and bystander inquiries (DPDP Act 2023)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* DPDP Act Notice */}
        <div className="p-3 bg-slate-50 dark:bg-slate-950 border border-gray-200 dark:border-slate-800 rounded-2xl text-[11px] text-slate-400 flex items-start gap-2.5 flex-shrink-0">
          <Lock className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-slate-200">Statutory Data Protection Disclosure: </span>
            In compliance with India's Digital Personal Data Protection Act 2023, access to your emergency records is strictly limited to authorized emergency personnel and tracked. Full medical values are never duplicated into audit storage.
          </div>
        </div>

        {/* Content Area */}
        <div className="overflow-y-auto flex-1 space-y-3 pr-1">
          {loading ? (
            <div className="py-16 flex flex-col items-center justify-center space-y-3">
              <HeartbeatLoader size="medium" />
              <p className="text-xs text-slate-400">Loading access audit trail...</p>
            </div>
          ) : error ? (
            <div className="p-4 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-2xl text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4" />
              <span>{error}</span>
            </div>
          ) : logs.length === 0 ? (
            <div className="py-16 text-center text-xs text-slate-500">
              No emergency access inquiries recorded for your profile.
            </div>
          ) : (
            logs.map((log) => (
              <div
                key={log.id}
                className="p-4 bg-gray-50 dark:bg-slate-950/70 border border-gray-200 dark:border-slate-800/80 rounded-2xl space-y-2 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {getAccessBadge(log.accessType)}
                    <span className="font-semibold text-gray-800 dark:text-slate-200">
                      {log.accessorName || 'Anonymous Bystander'} ({log.accessorRole})
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-[11px] text-slate-500">
                    <Clock className="w-3 h-3" />
                    <span>{new Date(log.timestamp).toLocaleString()}</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] text-slate-400 pt-1">
                  <div>
                    <span className="font-medium text-slate-500">Organization: </span>
                    <span className="text-slate-300">{log.organization || 'LifeLink Platform'}</span>
                  </div>
                  <div>
                    <span className="font-medium text-slate-500">Lawful Basis: </span>
                    <span className="text-slate-300 font-mono text-[10px]">{log.lawfulBasis}</span>
                  </div>
                </div>

                {log.accessReason && (
                  <div className="text-[11px] bg-slate-900/60 p-2.5 rounded-xl border border-slate-800/60 text-slate-300">
                    <span className="font-semibold text-rose-400">Reason declared: </span>
                    {log.accessReason}
                  </div>
                )}

                {log.fieldsAccessed && Array.isArray(log.fieldsAccessed) && (
                  <div className="text-[10px] text-slate-500 flex flex-wrap gap-1 items-center pt-0.5">
                    <span className="font-medium">Fields returned:</span>
                    {log.fieldsAccessed.map((f: string) => (
                      <span key={f} className="px-1.5 py-0.5 bg-slate-800 text-slate-300 rounded font-mono">
                        {f}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end pt-3 border-t border-gray-100 dark:border-slate-800 flex-shrink-0">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-gray-200 dark:bg-slate-800 hover:bg-gray-300 dark:hover:bg-slate-700 text-xs font-semibold rounded-xl transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
