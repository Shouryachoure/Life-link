import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { HeartbeatLoader } from '../components/ui/HeartbeatLoader';
import { getBackendBaseUrl } from '../config/apiConfig';
import {
  Phone,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Lock,
  Heart,
  ChevronRight,
  ExternalLink,
  Activity,
  UserCheck,
  AlertCircle,
} from 'lucide-react';

export const PublicEmergencyMedicalId: React.FC = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [cardData, setCardData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  // Break-glass modal state
  const [showBreakGlassModal, setShowBreakGlassModal] = useState(false);
  const [breakGlassReason, setBreakGlassReason] = useState('');
  const [breakGlassSubmitting, setBreakGlassSubmitting] = useState(false);
  const [breakGlassError, setBreakGlassError] = useState<string | null>(null);
  const [clinicalProfile, setClinicalProfile] = useState<any>(null);

  useEffect(() => {
    if (!token) {
      setError('No emergency access token provided in URL. Please scan a valid LifeLink Emergency Medical ID QR code.');
      setLoading(false);
      return;
    }
    fetchSafetyCard();
  }, [token]);

  const baseHost = getBackendBaseUrl();

  const fetchSafetyCard = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${baseHost}/api/v1/emergency-profile/qr-card/${token}`);
      if (res.ok) {
        const data = await res.json();
        setCardData(data);
      } else {
        const err = await res.json();
        setError(err.message || 'This Emergency Access Token is invalid, expired, or has been revoked by the patient.');
      }
    } catch {
      setError('Unable to reach the LifeLink emergency server. Please check your internet connection or dial 112 directly.');
    } finally {
      setLoading(false);
    }
  };

  const handleBreakGlassSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!breakGlassReason.trim() || breakGlassReason.trim().length < 8) {
      setBreakGlassError('Please provide a specific clinical emergency reason (minimum 8 characters).');
      return;
    }

    setBreakGlassSubmitting(true);
    setBreakGlassError(null);

    try {
      const tokenHeader = localStorage.getItem('lifelink_token') || localStorage.getItem('token') || '';
      const res = await fetch(`${baseHost}/api/v1/emergency-profile/break-glass`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(tokenHeader ? { Authorization: `Bearer ${tokenHeader}` } : {}),
        },
        body: JSON.stringify({
          token,
          accessReason: breakGlassReason.trim(),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setClinicalProfile(data);
        setShowBreakGlassModal(false);
      } else {
        const err = await res.json();
        if (res.status === 401) {
          setBreakGlassError('Authentication required: Please log in as an authorized ambulance driver, hospital ER staff, or administrator.');
        } else if (res.status === 403) {
          setBreakGlassError(err.message || 'Only verified healthcare personnel and ambulance drivers may unlock clinical records.');
        } else {
          setBreakGlassError(err.message || 'Break-glass authorization failed.');
        }
      }
    } catch {
      setBreakGlassError('Network error executing break-glass emergency unlock.');
    } finally {
      setBreakGlassSubmitting(false);
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
          Unknown
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/30">
        Patient-Reported (Unverified)
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between p-4 md:p-8">
      {/* Top Banner */}
      <header className="max-w-2xl w-full mx-auto flex items-center justify-between pb-6 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-500">
            <Heart className="w-5 h-5 fill-rose-500" />
          </div>
          <div>
            <h1 className="font-extrabold text-base tracking-wide flex items-center gap-2">
              <span>LifeLink</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/30 uppercase tracking-widest font-mono">
                Emergency ID
              </span>
            </h1>
            <p className="text-[11px] text-slate-400">Emergency Medical Response Network (India)</p>
          </div>
        </div>

        <a
          href="tel:112"
          className="flex items-center gap-2 px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-rose-600/30 transition-all animate-pulse"
        >
          <Phone className="w-3.5 h-3.5" />
          <span>Call 112</span>
        </a>
      </header>

      {/* Main Container */}
      <main className="max-w-2xl w-full mx-auto my-8 space-y-6">
        {loading ? (
          <div className="py-24 flex flex-col items-center justify-center space-y-4">
            <HeartbeatLoader size="large" />
            <p className="text-xs text-slate-400">Accessing secure emergency safety card...</p>
          </div>
        ) : error ? (
          <div className="p-6 bg-slate-900 border border-rose-500/30 rounded-3xl space-y-4 text-center">
            <div className="w-12 h-12 rounded-2xl bg-rose-500/10 text-rose-400 border border-rose-500/30 mx-auto flex items-center justify-center">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-bold text-rose-400">Emergency Access Unavailable</h2>
            <p className="text-xs text-slate-300 max-w-md mx-auto leading-relaxed">{error}</p>

            <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-3">
              <a
                href="tel:112"
                className="w-full sm:w-auto px-6 py-3 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-2 shadow-lg shadow-rose-600/20"
              >
                <Phone className="w-4 h-4" />
                <span>Dial 112 (National Emergency)</span>
              </a>
              <button
                onClick={() => navigate('/')}
                className="w-full sm:w-auto px-6 py-3 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold transition-colors"
              >
                Go to LifeLink Home
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Non-Confidential Safety Card */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 md:p-8 space-y-6 shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 right-0 w-48 h-48 bg-rose-500/5 rounded-full blur-3xl pointer-events-none" />

              {/* Status Indicator */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-emerald-500 animate-ping" />
                  <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
                    Emergency Safety Card Active
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  <Lock className="w-3 h-3 text-sky-400" />
                  <span>DPDP Act 2023 Compliant</span>
                </div>
              </div>

              {/* Patient Identification */}
              <div className="space-y-1">
                <span className="text-[10px] uppercase font-semibold text-slate-500 tracking-wider">
                  Patient Identity
                </span>
                <h2 className="text-2xl font-black tracking-tight text-white">
                  {cardData?.maskedPatientName || 'Emergency Patient'}
                </h2>
                <p className="text-xs text-slate-400">
                  Identity masked for privacy. If this individual is lost, disoriented, or injured, please contact their registered emergency contact or call 112 immediately.
                </p>
              </div>

              {/* Emergency Contacts Dial Section */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                  <Phone className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Immediate Emergency Contacts</span>
                </h3>

                {cardData?.emergencyContacts && cardData.emergencyContacts.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {cardData.emergencyContacts.map((contact: any, idx: number) => (
                      <div
                        key={idx}
                        className="p-4 bg-slate-950/80 border border-slate-800/80 rounded-2xl flex items-center justify-between gap-3 hover:border-slate-700 transition-colors"
                      >
                        <div className="space-y-0.5">
                          <p className="font-bold text-sm text-slate-100">{contact.name}</p>
                          <p className="text-[11px] text-slate-400">{contact.relation || 'Emergency Contact'}</p>
                          <p className="text-xs font-mono text-emerald-400 font-semibold">{contact.phone}</p>
                        </div>
                        <a
                          href={`tel:${contact.phone}`}
                          className="p-3 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-xl transition-all shadow-md"
                          title="Call emergency contact"
                        >
                          <Phone className="w-4 h-4" />
                        </a>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-4 bg-slate-950/60 border border-slate-800/60 rounded-2xl text-xs text-slate-400">
                    No private emergency contacts specified. Please dial 112 below for emergency services.
                  </div>
                )}
              </div>

              {/* Direct Indian Emergency Helpline Buttons */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <a
                  href="tel:112"
                  className="p-4 bg-rose-600 hover:bg-rose-500 text-white rounded-2xl font-bold flex items-center justify-between shadow-xl shadow-rose-600/20 transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
                      <Phone className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <span className="text-xs uppercase tracking-wider block text-rose-200">National Helpline</span>
                      <span className="text-lg font-black">Dial 112 (Pan-India)</span>
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </a>

                <a
                  href="tel:108"
                  className="p-4 bg-amber-600 hover:bg-amber-500 text-white rounded-2xl font-bold flex items-center justify-between shadow-xl shadow-amber-600/20 transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
                      <Activity className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <span className="text-xs uppercase tracking-wider block text-amber-200">Ambulance Emergency</span>
                      <span className="text-lg font-black">Dial 108</span>
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </a>
              </div>

              {/* Privacy Callout */}
              <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-2xl flex items-start gap-3 text-xs text-slate-400">
                <Lock className="w-4 h-4 text-sky-400 flex-shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold text-slate-200">Clinical Data Protection Notice</p>
                  <p className="text-[11px] leading-relaxed">
                    {cardData?.protectionNotice ||
                      'Sensitive medical history (blood group, allergies, conditions, and medications) is protected under the Digital Personal Data Protection Act 2023 and cannot be accessed anonymously.'}
                  </p>
                </div>
              </div>

              {/* Responder Break-Glass Accordion / Trigger */}
              {!clinicalProfile ? (
                <div className="pt-4 border-t border-slate-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-slate-200">Are you a responding doctor or paramedic?</h4>
                      <p className="text-[11px] text-slate-400">
                        Authorized medical personnel can unlock clinical triage data via emergency break-glass protocol.
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      setShowBreakGlassModal(true);
                      setBreakGlassError(null);
                    }}
                    className="w-full py-3 px-4 bg-slate-800 hover:bg-slate-700 text-rose-400 hover:text-rose-300 border border-rose-500/20 rounded-2xl text-xs font-bold flex items-center justify-center gap-2 transition-colors"
                  >
                    <ShieldAlert className="w-4 h-4 text-rose-500" />
                    <span>Authorized Responder Break-Glass Access</span>
                  </button>
                </div>
              ) : (
                /* Unlocked Clinical Profile View (Break-Glass Success) */
                <div className="pt-6 border-t border-slate-800 space-y-5 animate-in fade-in duration-300">
                  <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-2xl space-y-1">
                    <div className="flex items-center gap-2 text-rose-400 font-bold text-xs uppercase tracking-wider">
                      <ShieldAlert className="w-4 h-4" />
                      <span>Break-Glass Clinical Access Authorized</span>
                    </div>
                    <p className="text-[11px] text-slate-300 leading-relaxed">
                      {clinicalProfile.clinicalDisclaimer}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl space-y-1">
                      <span className="text-[10px] uppercase font-semibold text-slate-500">Full Patient Name</span>
                      <p className="font-bold text-base text-white">{clinicalProfile.patientName}</p>
                    </div>

                    <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] uppercase font-semibold text-slate-500">Blood Group</span>
                        {getProvenanceBadge(clinicalProfile.clinicalProfile?.bloodGroup?.provenance)}
                      </div>
                      <p className="font-extrabold text-lg text-rose-500">
                        {clinicalProfile.clinicalProfile?.bloodGroup?.value || 'UNKNOWN'}
                      </p>
                    </div>

                    <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] uppercase font-semibold text-slate-500">Known Allergies</span>
                        {getProvenanceBadge(clinicalProfile.clinicalProfile?.allergies?.provenance)}
                      </div>
                      <p className="font-semibold text-slate-200">
                        {clinicalProfile.clinicalProfile?.allergies?.value || 'None reported'}
                      </p>
                    </div>

                    <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] uppercase font-semibold text-slate-500">Medical Conditions</span>
                        {getProvenanceBadge(clinicalProfile.clinicalProfile?.medicalConditions?.provenance)}
                      </div>
                      <p className="font-semibold text-slate-200">
                        {clinicalProfile.clinicalProfile?.medicalConditions?.value || 'None reported'}
                      </p>
                    </div>

                    <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] uppercase font-semibold text-slate-500">Current Medications</span>
                        {getProvenanceBadge(clinicalProfile.clinicalProfile?.currentMedications?.provenance)}
                      </div>
                      <p className="font-semibold text-slate-200">
                        {clinicalProfile.clinicalProfile?.currentMedications?.value || 'None reported'}
                      </p>
                    </div>

                    <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl space-y-1">
                      <span className="text-[10px] uppercase font-semibold text-slate-500">Organ Donor Status</span>
                      <p className="font-bold text-sm text-slate-200">
                        {clinicalProfile.clinicalProfile?.organDonorStatus === 'YES'
                          ? 'Registered Organ Donor 🕊️'
                          : clinicalProfile.clinicalProfile?.organDonorStatus === 'NO'
                          ? 'No'
                          : 'Not Specified'}
                      </p>
                    </div>
                  </div>

                  {clinicalProfile.clinicalProfile?.medicalNotes && (
                    <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl space-y-1 text-xs">
                      <span className="text-[10px] uppercase font-semibold text-slate-500">Critical Medical Notes</span>
                      <p className="text-slate-300 whitespace-pre-wrap">{clinicalProfile.clinicalProfile.medicalNotes}</p>
                    </div>
                  )}

                  <div className="text-[11px] text-slate-500 text-center">
                    Last updated on record: {new Date(clinicalProfile.clinicalProfile?.lastUpdated).toLocaleString()}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </main>

      {/* Break-Glass Authorization Dialog */}
      {showBreakGlassModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl p-6 md:p-8 space-y-6 text-slate-100 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-rose-500/10 text-rose-500 border border-rose-500/30 flex items-center justify-center">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-base">Break-Glass Emergency Declaration</h3>
                <p className="text-xs text-slate-400">Section 7 Medical Emergency Protocol (DPDP Act 2023)</p>
              </div>
            </div>

            <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-2xl text-xs text-amber-300 space-y-1">
              <span className="font-bold">Legal Notice:</span>
              <p className="text-[11px] leading-relaxed">
                Break-glass access is strictly reserved for medical professionals and emergency ambulance crews treating this patient.
                Your user identity, IP address, organization, and timestamp will be permanently recorded in the immutable audit log.
              </p>
            </div>

            {breakGlassError && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs rounded-xl flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{breakGlassError}</span>
              </div>
            )}

            <form onSubmit={handleBreakGlassSubmit} className="space-y-4">
              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                  Emergency Clinical Justification *
                </label>
                <textarea
                  rows={3}
                  required
                  value={breakGlassReason}
                  onChange={(e) => setBreakGlassReason(e.target.value)}
                  placeholder="e.g. Patient unconscious at accident site, assessing trauma risk and blood group compatibility"
                  className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-2xl text-xs text-slate-100 focus:outline-none focus:border-rose-500 placeholder:text-slate-600"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowBreakGlassModal(false)}
                  className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-xs font-semibold rounded-xl text-slate-300 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={breakGlassSubmitting}
                  className="px-6 py-2.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-rose-600/30 transition-all flex items-center gap-2 disabled:opacity-50"
                >
                  {breakGlassSubmitting ? (
                    <>
                      <HeartbeatLoader size="small" />
                      <span>Verifying Authorization...</span>
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-4 h-4" />
                      <span>Submit Declaration & Unlock</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="max-w-2xl w-full mx-auto text-center text-xs text-slate-500 pt-6 border-t border-slate-800 space-y-1">
        <p>LifeLink Emergency Health Network • Nagpur Pilot Zone</p>
        <p className="text-[10px] text-slate-600">
          In case of severe or life-threatening symptoms, always dial 112 directly.
        </p>
      </footer>
    </div>
  );
};

export default PublicEmergencyMedicalId;
