import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Hash, Phone, RefreshCw, Search, Users } from 'lucide-react';
import { Button } from '../components/UI';
import { useStaffAuthenticated } from '../hooks/useStaffAuthenticated';
import {
  canAccessStaffDirectory,
  getCurrentUserProfile,
  listAllUserProfiles,
  type AppRole,
  type UserProfile,
} from '../services/accessControl';
import { referenceExtensionForEmail } from '../services/recruiter3cxExtensions';
import { profileInitials } from '../services/webinarGeekRecruiterAnalytics';

const ROLE_LABEL: Record<AppRole, string> = {
  admin: 'Admin',
  leadership: 'Leadership',
  recruiter: 'Recruiter',
  webinar: 'Webinar',
  hr: 'HR',
  viewer: 'Viewer',
};

const CALLING_ROLES = new Set<AppRole>(['recruiter', 'leadership', 'admin']);

function normalizeExtension(value: string | null | undefined): string {
  return String(value || '').replace(/\D/g, '');
}

function extensionStatus(
  profile: UserProfile,
  referenceExt: string | null,
): 'set' | 'missing' | 'mismatch' {
  const profileExt = normalizeExtension(profile.extension);
  if (!profileExt) return 'missing';
  if (referenceExt && normalizeExtension(referenceExt) !== profileExt) return 'mismatch';
  return 'set';
}

const StaffDirectoryPage: React.FC = () => {
  const isAuthenticated = useStaffAuthenticated();
  const [accessAllowed, setAccessAllowed] = useState<boolean | null>(null);
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [extensionFilter, setExtensionFilter] = useState<'all' | 'missing' | 'mismatch'>('all');

  useEffect(() => {
    if (!isAuthenticated) {
      setAccessAllowed(null);
      return;
    }
    void getCurrentUserProfile().then((profile) => {
      setAccessAllowed(canAccessStaffDirectory(profile?.role ?? null));
    });
  }, [isAuthenticated]);

  const loadProfiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listAllUserProfiles();
      setProfiles(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!accessAllowed) return;
    void loadProfiles();
  }, [accessAllowed, loadProfiles]);

  const enriched = useMemo(() => {
    return profiles.map((profile) => {
      const referenceExt = referenceExtensionForEmail(profile.email);
      const status = extensionStatus(profile, referenceExt);
      const needsExtension = CALLING_ROLES.has(profile.role);
      return { profile, referenceExt, status, needsExtension };
    });
  }, [profiles]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return enriched
      .filter((row) => {
        if (roleFilter !== 'all' && row.profile.role !== roleFilter) return false;
        if (extensionFilter === 'missing' && row.status !== 'missing') return false;
        if (extensionFilter === 'mismatch' && row.status !== 'mismatch') return false;
        if (!q) return true;
        const hay = [
          row.profile.full_name || '',
          row.profile.email || '',
          row.profile.phone || '',
          row.profile.extension || '',
          row.referenceExt || '',
          ROLE_LABEL[row.profile.role] || row.profile.role,
        ]
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => {
        const aMissing = a.needsExtension && a.status === 'missing' ? 0 : 1;
        const bMissing = b.needsExtension && b.status === 'missing' ? 0 : 1;
        if (aMissing !== bMissing) return aMissing - bMissing;
        const aName = (a.profile.full_name || a.profile.email || '').toLowerCase();
        const bName = (b.profile.full_name || b.profile.email || '').toLowerCase();
        return aName.localeCompare(bName);
      });
  }, [enriched, search, roleFilter, extensionFilter]);

  const summary = useMemo(() => {
    const calling = enriched.filter((r) => r.needsExtension);
    const missingCalling = calling.filter((r) => r.status === 'missing');
    const setCalling = calling.filter((r) => r.status === 'set');
    const mismatch = enriched.filter((r) => r.status === 'mismatch');
    return {
      total: enriched.length,
      calling: calling.length,
      setCalling: setCalling.length,
      missingCalling: missingCalling.length,
      mismatch: mismatch.length,
    };
  }, [enriched]);

  if (!isAuthenticated) {
    return <div className="w-full p-6 text-sm text-[#5c6b82]">Sign in to view staff profiles.</div>;
  }

  if (accessAllowed === false) {
    return (
      <div className="w-full p-6">
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Staff directory is limited to admins.
        </div>
      </div>
    );
  }

  if (accessAllowed === null) {
    return <div className="w-full p-6 text-sm text-[#5c6b82]">Checking access…</div>;
  }

  return (
    <div className="w-full space-y-4 p-5 text-[#1A2942] lg:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Users size={20} className="shrink-0 text-[#005EB8]" />
          <div>
            <h1 className="text-lg font-bold text-[#0B1B34]">Staff directory</h1>
            <p className="text-xs text-[#5c7594]">
              All portal users and 3CX extensions from Account → Recruiter call settings.
            </p>
          </div>
        </div>
        <Button type="button" variant="secondary" onClick={() => void loadProfiles()} disabled={loading}>
          <RefreshCw size={16} className={loading ? 'mr-1.5 inline animate-spin' : 'mr-1.5 inline'} />
          {loading ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>

      {summary.missingCalling > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <p>
            <strong>{summary.missingCalling}</strong> recruiter/leadership/admin user
            {summary.missingCalling === 1 ? ' has' : 's have'} no 3CX extension in their profile. Ask them to set it
            under <strong>Account → Recruiter call settings</strong>.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <div className="rounded-xl border border-[#d6deea] bg-white p-3">
          <p className="text-[10px] uppercase tracking-wide text-[#7a8ba1]">Staff</p>
          <p className="text-xl font-bold text-[#0B1B34]">{summary.total}</p>
        </div>
        <div className="rounded-xl border border-[#d6deea] bg-white p-3">
          <p className="text-[10px] uppercase tracking-wide text-[#7a8ba1]">Call roles</p>
          <p className="text-xl font-bold text-[#0B1B34]">{summary.calling}</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
          <p className="text-[10px] uppercase tracking-wide text-emerald-800">Extension set</p>
          <p className="text-xl font-bold text-emerald-900">{summary.setCalling}</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3">
          <p className="text-[10px] uppercase tracking-wide text-amber-800">Missing</p>
          <p className="text-xl font-bold text-amber-900">{summary.missingCalling}</p>
        </div>
        <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-3">
          <p className="text-[10px] uppercase tracking-wide text-rose-800">Mismatch</p>
          <p className="text-xl font-bold text-rose-900">{summary.mismatch}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6d86a3]" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email, phone, extension…"
            className="w-full rounded-lg border border-[#d6deea] bg-white py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#8bc3ff]/40"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="rounded-lg border border-[#d6deea] bg-white px-3 py-2 text-sm"
        >
          <option value="all">All roles</option>
          <option value="admin">Admin</option>
          <option value="leadership">Leadership</option>
          <option value="recruiter">Recruiter</option>
          <option value="hr">HR</option>
          <option value="webinar">Webinar</option>
          <option value="viewer">Viewer</option>
        </select>
        <select
          value={extensionFilter}
          onChange={(e) => setExtensionFilter(e.target.value as typeof extensionFilter)}
          className="rounded-lg border border-[#d6deea] bg-white px-3 py-2 text-sm"
        >
          <option value="all">All extensions</option>
          <option value="missing">Missing only</option>
          <option value="mismatch">Mismatch only</option>
        </select>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">{error}</div>
      )}

      <div className="overflow-x-auto rounded-xl border border-[#d6deea] bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-[#e8edf4] bg-[#f7fafd] text-[11px] uppercase tracking-wide text-[#6d86a3]">
            <tr>
              <th className="px-3 py-2.5 font-semibold">User</th>
              <th className="px-3 py-2.5 font-semibold">Role</th>
              <th className="px-3 py-2.5 font-semibold">Phone</th>
              <th className="px-3 py-2.5 font-semibold">3CX extension</th>
              <th className="px-3 py-2.5 font-semibold">Reference</th>
              <th className="px-3 py-2.5 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#eef2f7]">
            {loading && profiles.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-[#5c7594]">
                  Loading staff profiles…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-[#5c7594]">
                  No users match your filters.
                </td>
              </tr>
            ) : (
              filtered.map(({ profile, referenceExt, status, needsExtension }) => {
                const name = profile.full_name?.trim() || profile.email?.split('@')[0] || '—';
                const profileExt = profile.extension?.trim() || '';
                return (
                  <tr key={profile.user_id} className="hover:bg-[#fafcff]">
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2.5 min-w-[200px]">
                        {profile.avatar_url ? (
                          <img
                            src={profile.avatar_url}
                            alt=""
                            className="h-8 w-8 shrink-0 rounded-full object-cover"
                          />
                        ) : (
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#dff0ff] text-xs font-bold text-[#0B1B34]">
                            {profileInitials(name)}
                          </span>
                        )}
                        <div className="min-w-0">
                          <p className="truncate font-medium text-[#0B1B34]">{name}</p>
                          <p className="truncate text-xs text-[#5c7594]">{profile.email || '—'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span className="rounded-md bg-[#eef5fc] px-2 py-0.5 text-xs font-medium text-[#2f6ea8]">
                        {ROLE_LABEL[profile.role] || profile.role}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-[#334155]">
                      {profile.phone?.trim() ? (
                        <span className="inline-flex items-center gap-1">
                          <Phone size={13} className="text-[#8aa3be]" />
                          {profile.phone.trim()}
                        </span>
                      ) : (
                        <span className="text-[#9aa8b8]">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap font-mono text-[#0B1B34]">
                      {profileExt ? (
                        <span className="inline-flex items-center gap-1">
                          <Hash size={13} className="text-[#8aa3be]" />
                          {profileExt}
                        </span>
                      ) : (
                        <span className="text-amber-700 font-sans font-medium">Not set</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap font-mono text-[#5c7594]">
                      {referenceExt || '—'}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {status === 'set' && (
                        <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">
                          Set
                        </span>
                      )}
                      {status === 'missing' && (
                        <span
                          className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                            needsExtension
                              ? 'bg-amber-100 text-amber-900'
                              : 'bg-[#f1f5f9] text-[#64748b]'
                          }`}
                        >
                          {needsExtension ? 'Missing — ask to set' : 'Not set'}
                        </span>
                      )}
                      {status === 'mismatch' && (
                        <span className="rounded-md bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-800">
                          Mismatch
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-[#8aa3be]">
        Reference column is the expected extension from the internal map (used by Call log sync). Profile extension
        comes from each user&apos;s Account settings.
      </p>
    </div>
  );
};

export default StaffDirectoryPage;
