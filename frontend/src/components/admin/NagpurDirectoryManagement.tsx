import React, { useState, useEffect } from 'react';
import {
  Building2,
  Ambulance,
  CheckCircle2,
  AlertTriangle,
  Link as LinkIcon,
  Search,
  Upload,
  RefreshCw,
  Phone,
  MapPin,
  ExternalLink,
  ShieldAlert,
  FileSpreadsheet,
} from 'lucide-react';

interface NagpurDirectoryManagementProps {
  apiFetch: (url: string, options?: RequestInit) => Promise<any>;
  partnerHospitals: any[];
}

export const NagpurDirectoryManagement: React.FC<NagpurDirectoryManagementProps> = ({
  apiFetch,
  partnerHospitals,
}) => {
  const [subTab, setSubTab] = useState<'FACILITIES' | 'AMBULANCES' | 'IMPORT_REVIEW'>('FACILITIES');
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<any>(null);

  // Facilities list & search
  const [facilities, setFacilities] = useState<any[]>([]);
  const [facSearch, setFacSearch] = useState('');
  const [facTypeFilter, setFacTypeFilter] = useState('');
  const [facLinkFilter, setFacLinkFilter] = useState('');

  // Ambulances list & search
  const [ambulances, setAmbulances] = useState<any[]>([]);
  const [ambSearch, setAmbSearch] = useState('');
  const [ambTypeFilter, setAmbTypeFilter] = useState('');

  // Review issues list
  const [reviewIssues, setReviewIssues] = useState<any[]>([]);

  // Linking modal state
  const [linkingFacility, setLinkingFacility] = useState<any | null>(null);
  const [selectedPartnerId, setSelectedPartnerId] = useState('');
  const [linkingLoading, setLinkingLoading] = useState(false);
  const [linkMessage, setLinkMessage] = useState<string | null>(null);

  // Import states
  const [importLoading, setImportLoading] = useState(false);
  const [importResult, setImportResult] = useState<any | null>(null);

  const loadDirectoryData = async () => {
    setLoading(true);
    try {
      const sumRes = await apiFetch('/directory/admin/summary');
      if (sumRes.success) setSummary(sumRes.summary);

      const facRes = await apiFetch(`/directory/hospitals?search=${encodeURIComponent(facSearch)}&facilityType=${facTypeFilter}&linkedOnly=${facLinkFilter === 'LINKED' ? 'true' : ''}&limit=100`);
      if (facRes.success) setFacilities(facRes.data || []);

      const ambRes = await apiFetch(`/directory/ambulances?search=${encodeURIComponent(ambSearch)}&operatorType=${ambTypeFilter}&limit=50`);
      if (ambRes.success) setAmbulances(ambRes.data || []);

      const issueRes = await apiFetch('/directory/admin/review-issues');
      if (issueRes.success) setReviewIssues(issueRes.data || []);
    } catch (err) {
      console.error('Failed to load directory data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDirectoryData();
  }, [facTypeFilter, facLinkFilter, ambTypeFilter]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loadDirectoryData();
  };

  const handleExecuteLink = async () => {
    if (!linkingFacility || !selectedPartnerId) return;
    setLinkingLoading(true);
    setLinkMessage(null);
    try {
      const res = await apiFetch(`/directory/admin/facilities/${linkingFacility.id}/link-hospital`, {
        method: 'POST',
        body: JSON.stringify({ hospitalId: selectedPartnerId }),
      });
      if (res.success) {
        setLinkMessage(`Successfully linked to ${res.data?.name || 'hospital'}`);
        setTimeout(() => {
          setLinkingFacility(null);
          setLinkMessage(null);
          loadDirectoryData();
        }, 1200);
      }
    } catch (err: any) {
      setLinkMessage(`Error: ${err?.message || 'Failed to link hospital'}`);
    } finally {
      setLinkingLoading(false);
    }
  };

  const handleResolveIssue = async (issueId: string) => {
    try {
      const res = await apiFetch(`/directory/admin/review-issues/${issueId}/resolve`, {
        method: 'PUT',
        body: JSON.stringify({ resolutionNotes: 'Audited and approved by Super-Admin' }),
      });
      if (res.success) {
        setReviewIssues((prev) => prev.filter((i) => i.id !== issueId));
      }
    } catch (err) {
      console.error('Failed to resolve issue:', err);
    }
  };

  const handleSyncPreBundledData = async () => {
    setImportLoading(true);
    setImportResult(null);
    try {
      // Fetch pre-bundled Nagpur JSON datasets
      const hospReq = await fetch('/data/imports/nagpur/nagpur_hospitals_directory.json');
      const hospData = await hospReq.json();
      const res = await apiFetch('/directory/admin/import/execute', {
        method: 'POST',
        body: JSON.stringify({ entityType: 'FACILITY', records: hospData }),
      });
      setImportResult(res.outcome || res);
      loadDirectoryData();
    } catch (err: any) {
      setImportResult({ error: err?.message || 'Failed to sync pre-bundled dataset' });
    } finally {
      setImportLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner / Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">📍</span>
            <h2 className="text-lg font-bold text-slate-100">Nagpur Healthcare & Ambulance Directory</h2>
            <span className="bg-emerald-500/10 text-emerald-400 text-xs px-2.5 py-0.5 rounded-full font-semibold border border-emerald-500/20">
              Pilot Zone: Nagpur District
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl">
            Central repository of publicly listed hospitals, public health centres, and ambulance operators across Nagpur City & District.
            Public directory facilities are isolated from LifeLink dispatch until explicitly linked.
          </p>
        </div>

        <button
          onClick={loadDirectoryData}
          disabled={loading}
          className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold px-3 py-2 rounded-lg border border-slate-700 transition"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-emerald-400' : ''}`} />
          Refresh Directory
        </button>
      </div>

      {/* Metrics Row */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
            <div className="text-slate-400 text-xs font-medium flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-blue-400" /> Total Facilities
            </div>
            <div className="text-xl font-black text-slate-100 mt-1">{summary.totalFacilities}</div>
            <div className="text-3xs text-slate-500 mt-0.5">Nagpur City & District</div>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
            <div className="text-slate-400 text-xs font-medium flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Verified
            </div>
            <div className="text-xl font-black text-emerald-400 mt-1">{summary.verifiedFacilities}</div>
            <div className="text-3xs text-slate-500 mt-0.5">Public records checked</div>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
            <div className="text-slate-400 text-xs font-medium flex items-center gap-1.5">
              <LinkIcon className="w-3.5 h-3.5 text-teal-400" /> LifeLink Partners
            </div>
            <div className="text-xl font-black text-teal-400 mt-1">{summary.linkedFacilities}</div>
            <div className="text-3xs text-slate-500 mt-0.5">Live bed floor active</div>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
            <div className="text-slate-400 text-xs font-medium flex items-center gap-1.5">
              <ExternalLink className="w-3.5 h-3.5 text-amber-400" /> Unlinked Directory
            </div>
            <div className="text-xl font-black text-amber-400 mt-1">{summary.unlinkedFacilities}</div>
            <div className="text-3xs text-slate-500 mt-0.5">Public listings only</div>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
            <div className="text-slate-400 text-xs font-medium flex items-center gap-1.5">
              <Ambulance className="w-3.5 h-3.5 text-indigo-400" /> Ambulance Services
            </div>
            <div className="text-xl font-black text-indigo-400 mt-1">{summary.totalAmbulanceServices}</div>
            <div className="text-3xs text-slate-500 mt-0.5">108/102/112 & private</div>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
            <div className="text-slate-400 text-xs font-medium flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-rose-400" /> Review Queue
            </div>
            <div className="text-xl font-black text-rose-400 mt-1">{summary.openReviewIssues}</div>
            <div className="text-3xs text-slate-500 mt-0.5">Requires audit</div>
          </div>
        </div>
      )}

      {/* Sub Navigation Tabs */}
      <div className="flex border-b border-slate-800 gap-2">
        <button
          onClick={() => setSubTab('FACILITIES')}
          className={`px-4 py-2 text-xs font-semibold rounded-t-lg transition flex items-center gap-2 ${
            subTab === 'FACILITIES'
              ? 'bg-slate-800 text-emerald-400 border-t-2 border-emerald-400'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Building2 className="w-4 h-4" />
          Hospitals & Health Facilities ({facilities.length})
        </button>

        <button
          onClick={() => setSubTab('AMBULANCES')}
          className={`px-4 py-2 text-xs font-semibold rounded-t-lg transition flex items-center gap-2 ${
            subTab === 'AMBULANCES'
              ? 'bg-slate-800 text-indigo-400 border-t-2 border-indigo-400'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Ambulance className="w-4 h-4" />
          Ambulance Services ({ambulances.length})
        </button>

        <button
          onClick={() => setSubTab('IMPORT_REVIEW')}
          className={`px-4 py-2 text-xs font-semibold rounded-t-lg transition flex items-center gap-2 ${
            subTab === 'IMPORT_REVIEW'
              ? 'bg-slate-800 text-amber-400 border-t-2 border-amber-400'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Upload className="w-4 h-4" />
          Import & Review Queue ({reviewIssues.length})
        </button>
      </div>

      {/* SUB-TAB 1: FACILITIES DIRECTORY */}
      {subTab === 'FACILITIES' && (
        <div className="space-y-4">
          <form onSubmit={handleSearchSubmit} className="flex flex-wrap gap-3 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
            <div className="flex-1 min-w-[220px] relative">
              <Search className="w-4 h-4 absolute left-3 top-3 text-slate-500" />
              <input
                type="text"
                placeholder="Search facility by name, locality, address..."
                value={facSearch}
                onChange={(e) => setFacSearch(e.target.value)}
                className="w-full bg-slate-800/80 border border-slate-700/80 rounded-lg pl-9 pr-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <select
              value={facTypeFilter}
              onChange={(e) => setFacTypeFilter(e.target.value)}
              className="bg-slate-800/80 border border-slate-700/80 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
            >
              <option value="">All Categories</option>
              <option value="MEDICAL_COLLEGE">Medical Colleges</option>
              <option value="GOVERNMENT_HOSPITAL">Government Hospitals</option>
              <option value="MUNICIPAL_HOSPITAL">Municipal Hospitals</option>
              <option value="SUB_DISTRICT_HOSPITAL">Sub-District Hospitals</option>
              <option value="RURAL_HOSPITAL">Rural Hospitals</option>
              <option value="PRIVATE_MULTISPECIALTY">Private Multispecialty</option>
              <option value="PRIVATE_SPECIALTY">Private Specialty</option>
            </select>

            <select
              value={facLinkFilter}
              onChange={(e) => setFacLinkFilter(e.target.value)}
              className="bg-slate-800/80 border border-slate-700/80 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
            >
              <option value="">All Link Statuses</option>
              <option value="LINKED">LifeLink Partners Only</option>
              <option value="UNLINKED">Unlinked Public Only</option>
            </select>

            <button
              type="submit"
              className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold px-4 py-2 rounded-lg transition"
            >
              Filter
            </button>
          </form>

          {/* Facilities Table */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-800/60 text-slate-400 font-semibold uppercase text-3xs border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-4">Facility Name & Type</th>
                    <th className="py-3 px-4">Public Contact</th>
                    <th className="py-3 px-4">Address & Locality</th>
                    <th className="py-3 px-4">Coordinates</th>
                    <th className="py-3 px-4">Verification</th>
                    <th className="py-3 px-4">LifeLink Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-300">
                  {facilities.map((fac) => {
                    const isPartner = fac.linkStatus === 'LINKED_PARTNER';
                    return (
                      <tr key={fac.id} className="hover:bg-slate-800/30 transition">
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-100">{fac.name}</div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-3xs bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded font-medium">
                              {fac.facilityType?.replace(/_/g, ' ')}
                            </span>
                            <span className="text-3xs text-slate-500">• {fac.ownership?.replace(/_/g, ' ')}</span>
                          </div>
                        </td>

                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1 text-slate-200 font-mono">
                            <Phone className="w-3 h-3 text-emerald-400" />
                            {fac.contactNumber}
                          </div>
                          {fac.alternateNumber && (
                            <div className="text-3xs text-slate-500 font-mono mt-0.5">{fac.alternateNumber}</div>
                          )}
                        </td>

                        <td className="py-3 px-4 max-w-xs">
                          <div className="flex items-start gap-1">
                            <MapPin className="w-3 h-3 text-slate-500 mt-0.5 shrink-0" />
                            <span className="truncate">{fac.address}</span>
                          </div>
                          <div className="text-3xs text-slate-400 mt-0.5 ml-4">
                            {fac.locality ? `${fac.locality}, ` : ''}{fac.city} ({fac.district} Dist)
                          </div>
                        </td>

                        <td className="py-3 px-4">
                          {fac.lat && fac.lng ? (
                            <span className="text-3xs font-mono bg-slate-800/80 px-2 py-0.5 rounded text-slate-300">
                              {fac.lat.toFixed(4)}, {fac.lng.toFixed(4)}
                            </span>
                          ) : (
                            <span className="text-3xs text-amber-400 font-semibold">Ungeocoded</span>
                          )}
                        </td>

                        <td className="py-3 px-4">
                          <span
                            className={`inline-block text-3xs font-bold px-2 py-0.5 rounded ${
                              fac.verificationStatus === 'VERIFIED'
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                            }`}
                          >
                            {fac.verificationStatus}
                          </span>
                        </td>

                        <td className="py-3 px-4">
                          {isPartner ? (
                            <span className="inline-flex items-center gap-1 text-3xs font-bold bg-teal-500/10 text-teal-400 border border-teal-500/20 px-2 py-0.5 rounded">
                              <CheckCircle2 className="w-3 h-3" /> LifeLink Partner
                            </span>
                          ) : (
                            <span className="inline-block text-3xs text-slate-400 bg-slate-800 px-2 py-0.5 rounded">
                              Public Directory Only
                            </span>
                          )}
                        </td>

                        <td className="py-3 px-4 text-right">
                          {!isPartner && (
                            <button
                              onClick={() => {
                                setLinkingFacility(fac);
                                setSelectedPartnerId(partnerHospitals[0]?.id || '');
                              }}
                              className="inline-flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-teal-400 hover:text-teal-300 text-3xs font-semibold px-2 py-1 rounded border border-slate-700 transition"
                            >
                              <LinkIcon className="w-3 h-3" /> Link Partner
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 2: AMBULANCE SERVICES DIRECTORY */}
      {subTab === 'AMBULANCES' && (
        <div className="space-y-4">
          <form onSubmit={handleSearchSubmit} className="flex flex-wrap gap-3 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
            <div className="flex-1 min-w-[220px] relative">
              <Search className="w-4 h-4 absolute left-3 top-3 text-slate-500" />
              <input
                type="text"
                placeholder="Search ambulance service by name, operating area..."
                value={ambSearch}
                onChange={(e) => setAmbSearch(e.target.value)}
                className="w-full bg-slate-800/80 border border-slate-700/80 rounded-lg pl-9 pr-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <select
              value={ambTypeFilter}
              onChange={(e) => setAmbTypeFilter(e.target.value)}
              className="bg-slate-800/80 border border-slate-700/80 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
            >
              <option value="">All Operator Types</option>
              <option value="PUBLIC_EMERGENCY_SERVICE">Public Emergency Service (108/102/112)</option>
              <option value="HOSPITAL_OPERATED">Hospital-Operated Fleet</option>
              <option value="PRIVATE_OPERATOR">Private Operator</option>
              <option value="CHARITABLE_TRUST">Charitable Trust</option>
            </select>

            <button
              type="submit"
              className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-4 py-2 rounded-lg transition"
            >
              Filter
            </button>
          </form>

          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-800/60 text-slate-400 font-semibold uppercase text-3xs border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-4">Service Name</th>
                    <th className="py-3 px-4">Operator Type</th>
                    <th className="py-3 px-4">Public Business Contact</th>
                    <th className="py-3 px-4">Operating Area</th>
                    <th className="py-3 px-4">Fleet Description</th>
                    <th className="py-3 px-4">Verification</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-300">
                  {ambulances.map((amb) => (
                    <tr key={amb.id} className="hover:bg-slate-800/30 transition">
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-100 flex items-center gap-1.5">
                          <Ambulance className="w-3.5 h-3.5 text-indigo-400" />
                          {amb.serviceName}
                        </div>
                        {amb.address && <div className="text-3xs text-slate-500 mt-0.5">{amb.address}</div>}
                      </td>

                      <td className="py-3 px-4">
                        <span className="text-3xs bg-slate-800 px-2 py-0.5 rounded text-slate-300 font-medium">
                          {amb.operatorType?.replace(/_/g, ' ')}
                        </span>
                      </td>

                      <td className="py-3 px-4 font-mono">
                        <div className="flex items-center gap-1 text-emerald-400 font-bold">
                          <Phone className="w-3 h-3" />
                          {amb.contactNumber}
                        </div>
                        {amb.alternateContact && (
                          <div className="text-3xs text-slate-500 mt-0.5">{amb.alternateContact}</div>
                        )}
                      </td>

                      <td className="py-3 px-4 text-slate-300">
                        {amb.operatingArea || 'Nagpur District Wide'}
                      </td>

                      <td className="py-3 px-4 text-3xs text-slate-400 max-w-xs truncate">
                        {amb.fleetDescription || 'Emergency transport'}
                      </td>

                      <td className="py-3 px-4">
                        <span className="text-3xs font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          {amb.verificationStatus}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 3: IMPORT & REVIEW QUEUE */}
      {subTab === 'IMPORT_REVIEW' && (
        <div className="space-y-6">
          {/* Pre-Bundled Dataset Ingestion */}
          <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-emerald-400" /> Pre-Bundled Nagpur Datasets Sync
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Sync authoritative public listings from <code>data/imports/nagpur/nagpur_hospitals_directory.json</code>.
                  Applies Indian phone normalization, coordinate boundary checking, and anti-duplicate prevention.
                </p>
              </div>

              <button
                onClick={handleSyncPreBundledData}
                disabled={importLoading}
                className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold px-4 py-2 rounded-lg flex items-center gap-2 transition disabled:opacity-50"
              >
                <Upload className="w-3.5 h-3.5" />
                {importLoading ? 'Syncing...' : 'Sync Nagpur Facilities'}
              </button>
            </div>

            {importResult && (
              <div className="bg-slate-800/80 p-3 rounded-lg border border-slate-700 text-xs">
                <span className="font-bold text-emerald-400">Sync Outcome: </span>
                <span className="text-slate-200">
                  {importResult.error
                    ? `Error: ${importResult.error}`
                    : `Inserted: ${importResult.inserted || 0}, Updated: ${importResult.updated || 0}, Issues Generated: ${importResult.issuesRecorded || 0}`}
                </span>
              </div>
            )}
          </div>

          {/* Open Review Issues List */}
          <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl space-y-4">
            <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-400" /> Flagged Records & Review Issues ({reviewIssues.length})
            </h3>
            <p className="text-xs text-slate-400">
              The following facilities or services were flagged by automated duplicate detection, boundary validation, or citizen feedback reports.
            </p>

            {reviewIssues.length === 0 ? (
              <div className="text-center py-6 text-xs text-slate-500">
                ✓ No open review issues in queue. All directory records conform to quality benchmarks.
              </div>
            ) : (
              <div className="space-y-2">
                {reviewIssues.map((issue) => (
                  <div
                    key={issue.id}
                    className="bg-slate-800/50 border border-slate-700/60 p-3.5 rounded-lg flex flex-col md:flex-row justify-between items-start md:items-center gap-3"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-3xs font-bold px-1.5 py-0.5 rounded ${
                            issue.severity === 'HIGH'
                              ? 'bg-rose-500/20 text-rose-400'
                              : 'bg-amber-500/20 text-amber-400'
                          }`}
                        >
                          {issue.issueType}
                        </span>
                        <span className="text-xs font-semibold text-slate-200">{issue.description}</span>
                      </div>
                      <div className="text-3xs text-slate-500 mt-1">
                        Reported by: {issue.reportedBy || 'System Validator'} • Created: {new Date(issue.createdAt).toLocaleString('en-IN')}
                      </div>
                    </div>

                    <button
                      onClick={() => handleResolveIssue(issue.id)}
                      className="bg-slate-700 hover:bg-slate-600 text-slate-200 text-3xs font-semibold px-3 py-1.5 rounded transition shrink-0"
                    >
                      Resolve & Clear
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal: Link Directory Facility to LifeLink Partner Hospital */}
      {linkingFacility && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 space-y-4 shadow-xl">
            <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
              <LinkIcon className="w-4 h-4 text-teal-400" /> Link Public Facility to LifeLink Partner
            </h3>

            <p className="text-xs text-slate-400">
              Linking <b>{linkingFacility.name}</b> attaches real-time bed capacity and live ambulance telemetry to this public directory record.
            </p>

            <div className="space-y-1.5">
              <label className="text-xs text-slate-300 font-medium">Select Approved LifeLink Hospital:</label>
              <select
                value={selectedPartnerId}
                onChange={(e) => setSelectedPartnerId(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-xs text-slate-200 focus:outline-none focus:border-teal-500"
              >
                {partnerHospitals.map((h: any) => (
                  <option key={h.id} value={h.id}>
                    {h.name} (Beds: {h.availableBeds}/{h.totalBeds})
                  </option>
                ))}
              </select>
            </div>

            {linkMessage && (
              <div
                className={`p-2.5 rounded-lg text-xs font-medium ${
                  linkMessage.startsWith('Error') ? 'bg-rose-500/10 text-rose-400' : 'bg-emerald-500/10 text-emerald-400'
                }`}
              >
                {linkMessage}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setLinkingFacility(null)}
                className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs px-3 py-1.5 rounded-lg transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteLink}
                disabled={linkingLoading || !selectedPartnerId}
                className="bg-teal-600 hover:bg-teal-500 text-white text-xs font-semibold px-4 py-1.5 rounded-lg transition disabled:opacity-50"
              >
                {linkingLoading ? 'Linking...' : 'Confirm Link'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
