import React, { useState } from 'react';
import { generateQrMatrix } from '../../utils/qrCodeGenerator';
import { ShieldCheck, RefreshCw, Eye, Copy, Check, Lock, Heart, Phone, AlertTriangle, X } from 'lucide-react';

interface EmergencyMedicalIdModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: any;
  user: any;
  contacts: any[];
  onTokenRegenerated: (newToken: string) => void;
  onOpenAuditLogs: () => void;
  apiFetch: (endpoint: string, options?: RequestInit) => Promise<any>;
}

export const EmergencyMedicalIdModal: React.FC<EmergencyMedicalIdModalProps> = ({
  isOpen,
  onClose,
  profile,
  user,
  contacts,
  onTokenRegenerated,
  onOpenAuditLogs,
  apiFetch,
}) => {
  const [regenerating, setRegenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  if (!isOpen) return null;

  const token = profile?.emergencyAccessToken || '';
  const qrUrl = `${window.location.origin}/medical-id?token=${token}`;

  let matrix: boolean[][] = [];
  try {
    matrix = token ? generateQrMatrix(qrUrl) : [];
  } catch (err) {
    console.error('Failed to generate QR matrix:', err);
  }

  const handleCopyLink = () => {
    if (!qrUrl) return;
    navigator.clipboard.writeText(qrUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleRegenerateToken = async () => {
    if (!window.confirm('Regenerating your Emergency Access Token will immediately revoke all previously printed QR codes and shared links. Would you like to proceed?')) {
      return;
    }
    setRegenerating(true);
    setFeedback(null);
    try {
      const data = await apiFetch('/api/v1/emergency-profile/token/regenerate', {
        method: 'POST',
      });
      if (data && data.emergencyAccessToken) {
        onTokenRegenerated(data.emergencyAccessToken);
        setFeedback('New Emergency QR Code generated. Old links are permanently revoked.');
        setTimeout(() => setFeedback(null), 4000);
      } else {
        setFeedback('Failed to regenerate access token');
      }
    } catch (err: any) {
      setFeedback(err.message || 'Network error regenerating access token');
    } finally {
      setRegenerating(false);
    }

  };

  const getProvenanceBadge = (prov?: string) => {
    if (prov === 'VERIFIED_CLINICAL') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
          <ShieldCheck className="w-3 h-3" /> Clinically Verified
        </span>
      );
    }
    if (prov === 'UNKNOWN') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-500/10 text-slate-400 border border-slate-500/30">
          Unknown / Unverified
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/30">
        Self-Reported
      </span>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-2xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-3xl shadow-2xl p-6 md:p-8 space-y-6 text-gray-900 dark:text-slate-100 my-8">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 dark:border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-rose-500/10 text-rose-500 border border-rose-500/20 flex items-center justify-center">
              <Heart className="w-5 h-5 fill-rose-500" />
            </div>
            <div>
              <h2 className="text-lg font-bold">Patient Emergency Health ID</h2>
              <p className="text-xs text-slate-400">Secure, patient-controlled emergency medical telemetry</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Feedback message */}
        {feedback && (
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs rounded-xl flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 flex-shrink-0" />
            <span>{feedback}</span>
          </div>
        )}

        {/* DPDP Act Security & Privacy Callout */}
        <div className="p-4 bg-sky-500/10 border border-sky-500/20 rounded-2xl flex items-start gap-3 text-xs">
          <Lock className="w-4 h-4 text-sky-400 mt-0.5 flex-shrink-0" />
          <div className="space-y-1">
            <p className="font-semibold text-sky-400">Privacy Protection (DPDP Act 2023)</p>
            <p className="text-slate-300 leading-relaxed text-[11px]">
              This QR code acts as a secure access token, NOT an unrestricted record container.
              Anonymous bystanders scanning this QR only see your emergency safety card with emergency contact dials and 112.
              Confidential medical records require authenticated break-glass declaration by verified clinicians and are strictly audit-logged.
            </p>
          </div>
        </div>

        {/* Card Body: QR + Telemetry Summary */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
          {/* QR Code Presentation */}
          <div className="flex flex-col items-center justify-center p-6 bg-gray-50 dark:bg-slate-950 border border-gray-200 dark:border-slate-800/80 rounded-2xl space-y-4">
            <div className="p-3 bg-white rounded-2xl shadow-inner border border-gray-300">
              {matrix.length > 0 ? (
                <svg
                  viewBox={`0 0 ${matrix.length} ${matrix.length}`}
                  className="w-44 h-44"
                  shapeRendering="crispEdges"
                >
                  <rect width="100%" height="100%" fill="#ffffff" />
                  {matrix.map((row, r) =>
                    row.map((cell, c) =>
                      cell ? <rect key={`${r}-${c}`} x={c} y={r} width={1} height={1} fill="#0f172a" /> : null
                    )
                  )}
                </svg>
              ) : (
                <div className="w-44 h-44 flex items-center justify-center text-xs text-slate-400">
                  Generating QR...
                </div>
              )}
            </div>

            <div className="text-center space-y-1">
              <span className="text-[11px] font-mono font-semibold text-rose-500 tracking-wider">
                SECURE MEDICAL ID
              </span>
              <p className="text-[10px] text-slate-400">Scan during medical emergency</p>
            </div>

            {/* Token Controls */}
            <div className="flex items-center gap-2 w-full pt-1">
              <button
                onClick={handleCopyLink}
                className="flex-1 py-2 px-3 bg-gray-200 dark:bg-slate-800 hover:bg-gray-300 dark:hover:bg-slate-700 text-xs rounded-xl flex items-center justify-center gap-1.5 transition-colors font-medium"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied' : 'Copy Link'}</span>
              </button>

              <button
                onClick={handleRegenerateToken}
                disabled={regenerating}
                title="Revoke previous code and issue new token"
                className="py-2 px-3 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 text-xs rounded-xl flex items-center justify-center gap-1.5 transition-colors font-medium disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${regenerating ? 'animate-spin' : ''}`} />
                <span>Regenerate</span>
              </button>
            </div>
          </div>

          {/* Telemetry Summary */}
          <div className="space-y-3.5 text-xs">
            <div className="p-3 bg-gray-50 dark:bg-slate-950/60 border border-gray-200 dark:border-slate-800 rounded-xl space-y-1">
              <span className="text-[10px] uppercase font-semibold text-slate-400">Patient Name</span>
              <p className="font-bold text-sm text-gray-900 dark:text-slate-100">{user?.name || 'Patient'}</p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="p-3 bg-gray-50 dark:bg-slate-950/60 border border-gray-200 dark:border-slate-800 rounded-xl space-y-1">
                <span className="text-[10px] uppercase font-semibold text-slate-400">Blood Group</span>
                <p className="font-bold text-base text-rose-500">{profile?.bloodGroup || 'UNKNOWN'}</p>
                <div>{getProvenanceBadge(profile?.bloodGroupProvenance)}</div>
              </div>

              <div className="p-3 bg-gray-50 dark:bg-slate-950/60 border border-gray-200 dark:border-slate-800 rounded-xl space-y-1">
                <span className="text-[10px] uppercase font-semibold text-slate-400">Organ Donor</span>
                <p className="font-bold text-sm text-gray-900 dark:text-slate-200">
                  {profile?.organDonorStatus === 'YES' ? 'Registered Donor 🕊️' : profile?.organDonorStatus === 'NO' ? 'No' : 'Not Specified'}
                </p>
                <span className="text-[10px] text-slate-500">Choice on record</span>
              </div>
            </div>

            <div className="p-3 bg-gray-50 dark:bg-slate-950/60 border border-gray-200 dark:border-slate-800 rounded-xl space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase font-semibold text-slate-400">Allergies</span>
                {getProvenanceBadge(profile?.allergiesProvenance)}
              </div>
              <p className="text-gray-700 dark:text-slate-300 font-medium">
                {profile?.allergies || 'No critical allergies reported'}
              </p>
            </div>

            <div className="p-3 bg-gray-50 dark:bg-slate-950/60 border border-gray-200 dark:border-slate-800 rounded-xl space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase font-semibold text-slate-400">Conditions</span>
                {getProvenanceBadge(profile?.medicalConditionsProvenance)}
              </div>
              <p className="text-gray-700 dark:text-slate-300 font-medium">
                {profile?.medicalConditions || 'No chronic conditions reported'}
              </p>
            </div>

            <div className="p-3 bg-gray-50 dark:bg-slate-950/60 border border-gray-200 dark:border-slate-800 rounded-xl space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase font-semibold text-slate-400">Medications</span>
                {getProvenanceBadge(profile?.medicationsProvenance)}
              </div>
              <p className="text-gray-700 dark:text-slate-300 font-medium">
                {profile?.currentMedications || 'None reported'}
              </p>
            </div>

            {/* Emergency Contacts */}
            {contacts && contacts.length > 0 && (
              <div className="p-3 bg-gray-50 dark:bg-slate-950/60 border border-gray-200 dark:border-slate-800 rounded-xl space-y-1">
                <span className="text-[10px] uppercase font-semibold text-slate-400">Primary Emergency Contact</span>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-gray-800 dark:text-slate-200">{contacts[0].name} ({contacts[0].relation || 'Contact'})</p>
                    <p className="text-slate-400 font-mono text-[11px]">{contacts[0].phone}</p>
                  </div>
                  <a
                    href={`tel:${contacts[0].phone}`}
                    className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                  >
                    <Phone className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer Audit & Action Buttons */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-gray-100 dark:border-slate-800 text-xs">
          <button
            onClick={() => {
              onClose();
              onOpenAuditLogs();
            }}
            className="flex items-center gap-1.5 text-slate-400 hover:text-slate-200 transition-colors py-2 px-3 rounded-xl hover:bg-slate-800/60"
          >
            <Eye className="w-4 h-4 text-sky-400" />
            <span>View Access History Logs</span>
          </button>

          <button
            onClick={onClose}
            className="px-6 py-2.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl font-semibold shadow-lg shadow-rose-600/20 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
