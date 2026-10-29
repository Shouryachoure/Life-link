import React, { useState, useEffect } from 'react';
import {
  PhoneCall,
  UserPlus,
  Trash2,
  AlertTriangle,
  Send,
  CheckCircle2,
  ShieldAlert,
  MessageSquare,
  Sparkles,
  Info
} from 'lucide-react';
import { formatIndianPhone, validateIndianPhone } from '../../utils/localization';

interface EmergencyContactsSectionProps {
  apiFetch: (url: string, options?: any) => Promise<any>;
  currentLat?: number;
  currentLng?: number;
}

export const EmergencyContactsSection: React.FC<EmergencyContactsSectionProps> = ({
  apiFetch,
  currentLat,
  currentLng,
}) => {
  const [contacts, setContacts] = useState<any[]>([]);
  const [customAlertMessage, setCustomAlertMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [savingContact, setSavingContact] = useState(false);
  const [savingMessage, setSavingMessage] = useState(false);
  const [notifying, setNotifying] = useState(false);
  const [actionSuccess, setActionSuccess] = useState('');
  const [actionError, setActionError] = useState('');

  // Form inputs
  const [nameInput, setNameInput] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [relationInput, setContactRelation] = useState('Parent');
  const [canReceiveTripUpdates, setCanReceiveTripUpdates] = useState(true);

  // Active Trip Shares
  const [activeShares, setActiveShares] = useState<any[]>([]);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  useEffect(() => {
    fetchEmergencyContacts();
    fetchActiveTripShares();
  }, []);

  const fetchActiveTripShares = async () => {
    try {
      const res = await apiFetch('/trip-share/active');
      setActiveShares(res.shares || []);
    } catch {
      // Non-blocking
    }
  };

  const fetchEmergencyContacts = async () => {
    setLoading(true);
    try {
      const data = await apiFetch('/emergency-contacts');
      setContacts(data.contacts || []);
      setCustomAlertMessage(data.customAlertMessage || '');
    } catch (err: any) {
      console.error('Failed to load emergency contacts:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyContact = async (contactId: string) => {
    setActionError('');
    setActionSuccess('');
    try {
      const res = await apiFetch(`/emergency-contacts/${contactId}/verify`, {
        method: 'POST',
      });
      setActionSuccess(res.message || 'Contact phone number verified successfully.');
      fetchEmergencyContacts();
    } catch (err: any) {
      setActionError(err.message || 'Failed to verify contact phone');
    }
  };

  const handleRevokeShare = async (shareToken: string) => {
    if (!confirm('Are you sure you want to revoke this trip sharing link? It will be disabled immediately.')) return;
    try {
      await apiFetch('/trip-share/revoke', {
        method: 'POST',
        body: JSON.stringify({ shareToken }),
      });
      setActionSuccess('Trip sharing link revoked successfully.');
      fetchActiveTripShares();
    } catch (err: any) {
      setActionError(err.message || 'Failed to revoke trip share');
    }
  };

  const copyShareLink = (tokenStr: string) => {
    const url = `${window.location.origin}/track-trip?token=${tokenStr}`;
    navigator.clipboard.writeText(url);
    setCopiedToken(tokenStr);
    setTimeout(() => setCopiedToken(null), 3000);
  };

  const handleAddContact = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError('');
    setActionSuccess('');

    if (contacts.length >= 3) {
      setActionError('Maximum limit of 3 emergency contacts reached.');
      return;
    }

    setSavingContact(true);
    try {
      await apiFetch('/emergency-contacts', {
        method: 'POST',
        body: JSON.stringify({
          name: nameInput.trim(),
          phone: phoneInput.trim(),
          email: emailInput ? emailInput.trim() : undefined,
          relation: relationInput.trim(),
          canReceiveTripUpdates,
        }),
      });

      setNameInput('');
      setPhoneInput('');
      setEmailInput('');
      setActionSuccess('Emergency contact added successfully (unverified until phone verification).');
      fetchEmergencyContacts();
    } catch (err: any) {
      setActionError(err.message || 'Failed to add emergency contact');
    } finally {
      setSavingContact(false);
    }
  };

  const handleDeleteContact = async (contactId: string) => {
    if (!confirm('Are you sure you want to remove this emergency contact?')) return;
    setActionError('');
    setActionSuccess('');

    try {
      await apiFetch(`/emergency-contacts/${contactId}`, {
        method: 'DELETE',
      });
      setActionSuccess('Emergency contact removed.');
      fetchEmergencyContacts();
    } catch (err: any) {
      setActionError(err.message || 'Failed to remove contact');
    }
  };

  const handleSaveAlertMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError('');
    setActionSuccess('');
    setSavingMessage(true);

    try {
      await apiFetch('/emergency-contacts/alert-message', {
        method: 'PUT',
        body: JSON.stringify({
          customAlertMessage: customAlertMessage.trim(),
        }),
      });
      setActionSuccess('Custom emergency SMS message saved.');
    } catch (err: any) {
      setActionError(err.message || 'Failed to update alert message');
    } finally {
      setSavingMessage(false);
    }
  };

  const handleManualNotify = async () => {
    if (contacts.length === 0) {
      alert('Please add at least one emergency contact before sending an alert.');
      return;
    }

    if (!confirm(`Broadcast urgent emergency alert SMS to all ${contacts.length} saved contact(s) now?`)) {
      return;
    }

    setActionError('');
    setActionSuccess('');
    setNotifying(true);

    try {
      const res = await apiFetch('/emergency-contacts/notify', {
        method: 'POST',
        body: JSON.stringify({
          lat: currentLat,
          lng: currentLng,
        }),
      });

      setActionSuccess(res.message || `Emergency SMS successfully dispatched to ${contacts.length} contact(s)!`);
    } catch (err: any) {
      setActionError(err.message || 'Failed to notify emergency contacts');
    } finally {
      setNotifying(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header card with standalone manual trigger */}
      <div className="bg-white dark:bg-slate-950 border border-gray-200 dark:border-slate-800 rounded-3xl p-6 md:p-8 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-2xl bg-rose-600/10 text-rose-600 dark:text-rose-400 flex items-center justify-center">
                <PhoneCall className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-black text-slate-900 dark:text-white">
                  Emergency Contacts & SMS Network
                </h3>
                <span className="text-2xs font-mono font-bold text-rose-600 dark:text-rose-400 uppercase tracking-wider">
                  Capped at 3 Trusted Contacts · Real-Time Cellular SMS Alerts
                </span>
              </div>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 pt-1">
              Your registered contacts will receive an instantaneous SMS containing your live GPS location link whenever you trigger an SOS or use the button below.
            </p>
          </div>

          {/* Standalone Button: Notify My Emergency Contacts */}
          <button
            onClick={handleManualNotify}
            disabled={notifying || contacts.length === 0}
            className="px-6 py-3 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 disabled:opacity-40 text-white rounded-2xl text-xs font-black shadow-lg shadow-rose-600/20 flex items-center gap-2 shrink-0 cursor-pointer transition-all"
          >
            <Send className={`w-4 h-4 ${notifying ? 'animate-bounce' : ''}`} />
            <span>{notifying ? 'Broadcasting SMS...' : 'Notify My Emergency Contacts'}</span>
          </button>
        </div>

        {/* Feedback Banners */}
        {actionSuccess && (
          <div className="mt-4 p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 text-xs font-semibold flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{actionSuccess}</span>
          </div>
        )}
        {actionError && (
          <div className="mt-4 p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-500 text-xs font-semibold flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{actionError}</span>
          </div>
        )}
      </div>

      {/* Grid: Existing Contacts & Add Contact */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Existing Contacts (7 cols) */}
        <div className="lg:col-span-7 bg-white dark:bg-slate-950 border border-gray-200 dark:border-slate-800 rounded-3xl p-6 md:p-8 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider">
              Saved Contacts ({contacts.length} / 3)
            </h4>
            {contacts.length >= 3 && (
              <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400">
                Max Limit Reached
              </span>
            )}
          </div>

          {loading ? (
            <div className="py-8 text-center text-xs text-slate-400">Loading emergency contacts...</div>
          ) : contacts.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400 bg-gray-50 dark:bg-slate-900/50 rounded-2xl">
              No emergency contacts added yet. Add trusted family or friends to receive instant SMS alerts.
            </div>
          ) : (
            <div className="space-y-3">
              {contacts.map((contact, idx) => (
                <div
                  key={contact.id}
                  className="p-4 rounded-2xl border border-gray-200 dark:border-slate-850 bg-gray-50/50 dark:bg-slate-900/40 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-rose-500/10 text-rose-500 font-mono font-bold text-xs flex items-center justify-center shrink-0">
                      0{idx + 1}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs text-slate-900 dark:text-white">
                          {contact.name}
                        </span>
                        {contact.relation && (
                          <span className="px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                            {contact.relation}
                          </span>
                        )}
                        {contact.isVerified ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                            <CheckCircle2 className="w-3 h-3" />
                            Verified
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                            <AlertTriangle className="w-3 h-3" />
                            Unverified
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-3xs text-slate-500 dark:text-slate-400 font-mono">
                          {formatIndianPhone(contact.phone)}
                        </span>
                        {contact.email && (
                          <span className="text-3xs text-slate-400 font-mono">
                            • {contact.email}
                          </span>
                        )}
                        {contact.canReceiveTripUpdates && (
                          <span className="text-[9px] font-bold uppercase tracking-wider text-blue-500 bg-blue-500/10 px-1 rounded">
                            Trip Updates
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {!contact.isVerified && (
                      <button
                        type="button"
                        onClick={() => handleVerifyContact(contact.id)}
                        className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 transition-colors cursor-pointer"
                        title="Simulate OTP phone verification without paid SMS gateway"
                      >
                        Verify
                      </button>
                    )}
                    <button
                      onClick={() => handleDeleteContact(contact.id)}
                      className="p-2 rounded-xl text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors cursor-pointer"
                      title="Remove Contact"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right Column: Add Contact Form (5 cols) */}
        <div className="lg:col-span-5 bg-white dark:bg-slate-950 border border-gray-200 dark:border-slate-800 rounded-3xl p-6 md:p-8 shadow-sm space-y-4">
          <h4 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-rose-500" />
            Add Trusted Contact
          </h4>

          {contacts.length >= 3 ? (
            <div className="p-4 rounded-2xl bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-800 text-xs text-slate-500 space-y-2">
              <p className="font-bold text-slate-700 dark:text-slate-300">
                Contact limit of 3 reached.
              </p>
              <p className="text-3xs text-slate-400">
                To add a new contact, please delete an existing one above. This security cap ensures rapid parallel cellular dispatch without network congestion.
              </p>
            </div>
          ) : (
            <form onSubmit={handleAddContact} className="space-y-3.5">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Full Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Sarah Jenkins"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-rose-500"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Phone Number (+91 Mobile or International E.164) *
                </label>
                <input
                  type="tel"
                  required
                  placeholder="+91 98765 43210 or +12025550199"
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-rose-500 font-mono"
                />
                <span className="text-[10px] text-slate-400 block mt-1">
                  Saved as unverified until real phone verification is performed.
                </span>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Email Address (Optional)
                </label>
                <input
                  type="email"
                  placeholder="family@example.com"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-rose-500"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Relationship
                </label>
                <select
                  value={relationInput}
                  onChange={(e) => setContactRelation(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-200 focus:outline-none focus:border-rose-500"
                >
                  <option value="Parent">Parent</option>
                  <option value="Spouse">Spouse / Partner</option>
                  <option value="Sibling">Sibling</option>
                  <option value="Child">Child</option>
                  <option value="Friend">Friend / Colleague</option>
                  <option value="Guardian">Legal Guardian</option>
                </select>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="canReceiveTripUpdates"
                  checked={canReceiveTripUpdates}
                  onChange={(e) => setCanReceiveTripUpdates(e.target.checked)}
                  className="rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                />
                <label htmlFor="canReceiveTripUpdates" className="text-xs text-slate-600 dark:text-slate-300 select-none cursor-pointer">
                  Authorize this contact to receive emergency trip sharing links
                </label>
              </div>

              <button
                type="submit"
                disabled={savingContact}
                className="w-full py-3 bg-slate-900 hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 text-white rounded-xl text-xs font-black transition-colors cursor-pointer"
              >
                {savingContact ? 'Saving...' : 'Add Trusted Contact'}
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Active Trip Shares & Security Status */}
      <div className="bg-white dark:bg-slate-950 border border-gray-200 dark:border-slate-800 rounded-3xl p-6 md:p-8 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-indigo-500" />
            <div>
              <h4 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider">
                Active Emergency Trip Shares
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Secure, time-bounded tracking links issued to your authorized contacts during emergencies.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={fetchActiveTripShares}
            className="text-xs text-indigo-500 hover:underline font-semibold"
          >
            Refresh Links
          </button>
        </div>

        {activeShares.length === 0 ? (
          <div className="py-6 text-center text-xs text-slate-400 bg-gray-50 dark:bg-slate-900/50 rounded-2xl">
            No active emergency trip shares currently running. Trip share links are automatically generated when an SOS request is initiated.
          </div>
        ) : (
          <div className="space-y-3">
            {activeShares.map((share) => (
              <div
                key={share.id}
                className="p-4 rounded-2xl border border-indigo-100 dark:border-indigo-950/60 bg-indigo-50/40 dark:bg-indigo-950/20 flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-xs text-slate-900 dark:text-white">
                      Recipient: {share.recipientName}
                    </span>
                    <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded font-bold ${
                      share.status === 'ACTIVE'
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                        : 'bg-slate-500/10 text-slate-500'
                    }`}>
                      {share.status}
                    </span>
                    {share.allowLiveLocation && (
                      <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded">
                        GPS Active
                      </span>
                    )}
                  </div>
                  <p className="text-3xs text-slate-500 dark:text-slate-400 font-mono">
                    Token: {share.shareToken.slice(0, 8)}...{share.shareToken.slice(-6)} · Expires: {new Date(share.expiresAt).toLocaleTimeString()}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => copyShareLink(share.shareToken)}
                    className="px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 text-xs font-bold text-slate-700 dark:text-slate-300 hover:border-indigo-500 transition-colors cursor-pointer"
                  >
                    {copiedToken === share.shareToken ? 'Copied Link!' : 'Copy Tracking Link'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRevokeShare(share.shareToken)}
                    className="px-3 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 text-xs font-bold transition-colors cursor-pointer"
                  >
                    Revoke Now
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Customizable Alert Message Card */}
      <div className="bg-white dark:bg-slate-950 border border-gray-200 dark:border-slate-800 rounded-3xl p-6 md:p-8 shadow-sm space-y-4">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-rose-500" />
          <h4 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider">
            Customizable Emergency SMS Message
          </h4>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          This customized note will be attached to every SMS alert dispatched to your contacts alongside your real-time Google Maps coordinates.
        </p>

        <form onSubmit={handleSaveAlertMessage} className="space-y-3">
          <textarea
            rows={2}
            value={customAlertMessage}
            onChange={(e) => setCustomAlertMessage(e.target.value)}
            placeholder="e.g. Please check on me, house keys are with apartment manager or in lockbox code 1234. I take insulin daily."
            className="w-full px-4 py-3 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-rose-500 resize-none"
          />

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={savingMessage}
              className="px-6 py-2.5 bg-slate-900 hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
            >
              {savingMessage ? 'Saving Note...' : 'Save Custom Alert Note'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
