import React from 'react';
import { Camera, Hash, Mail, Phone, Save, User } from 'lucide-react';
import { Button } from '../components/UI';
import RecruiterCallSettingsPanel from '../components/account/RecruiterCallSettingsPanel';
import { canAccessSection, getCurrentUserProfile, getStaffRoleLabel, type AppRole } from '../services/accessControl';
import { removeProfileAvatar, uploadProfileAvatar } from '../services/profileAvatarService';
import { updateUserProfileDetails } from '../services/profileService';

const AccountSettingsPage: React.FC = () => {
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [photoSaving, setPhotoSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);

  const [fullName, setFullName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [role, setRole] = React.useState<AppRole | ''>('');
  const [phone, setPhone] = React.useState('');
  const [extension, setExtension] = React.useState('');
  const [avatarUrl, setAvatarUrl] = React.useState<string | null>(null);
  const [showCallSettings, setShowCallSettings] = React.useState(false);

  const loadProfile = React.useCallback(async () => {
    const profile = await getCurrentUserProfile();
    setFullName(profile?.full_name || '');
    setEmail(profile?.email || '');
    setRole(profile?.role || '');
    setPhone(profile?.phone || '');
    setExtension(profile?.extension || '');
    setAvatarUrl(profile?.avatar_url || null);
    setShowCallSettings(canAccessSection(profile?.role ?? null, 'pipeline-settings', profile?.email));
    setLoading(false);
  }, []);

  React.useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  React.useEffect(() => {
    if (!showCallSettings) return;
    if (window.location.hash === '#recruiter-call-settings') {
      window.requestAnimationFrame(() => {
        document.getElementById('recruiter-call-settings')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }, [showCallSettings, loading]);

  const initials = fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || 'U';

  const roleLabel = getStaffRoleLabel(role || null, email, fullName);

  const onSaveProfile = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await updateUserProfileDetails({
        full_name: fullName,
        phone,
        extension,
      });
      setMessage('Profile saved.');
      await loadProfile();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setPhotoSaving(true);
    setError(null);
    setMessage(null);
    try {
      const url = await uploadProfileAvatar(file);
      setAvatarUrl(url);
      setMessage('Profile photo updated.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPhotoSaving(false);
    }
  };

  const onRemovePhoto = async () => {
    setPhotoSaving(true);
    setError(null);
    setMessage(null);
    try {
      await removeProfileAvatar();
      setAvatarUrl(null);
      setMessage('Profile photo removed.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPhotoSaving(false);
    }
  };

  return (
      <div className="mx-auto max-w-3xl space-y-6 p-4 pb-10 md:p-8">
        <div className="overflow-hidden rounded-3xl border border-[#2a2847]/20 bg-gradient-to-br from-[#11101d] via-[#1a1830] to-[#252244] text-white shadow-xl">
          <div className="relative px-6 pb-6 pt-8 md:px-8 md:pb-8">
            <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/5 blur-2xl" />
            <div className="pointer-events-none absolute bottom-0 left-1/3 h-32 w-32 rounded-full bg-[#37B06D]/10 blur-3xl" />

            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Account</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight md:text-3xl">My profile</h1>
            <p className="mt-2 max-w-xl text-sm text-slate-300">
              Update how you appear in the app, contact details, and recruiter call settings in one place.
            </p>

            <div className="mt-6 flex flex-col gap-5 sm:flex-row sm:items-end" data-tour="profile-avatar">
              <div className="relative shrink-0">
                <div className="h-28 w-28 overflow-hidden rounded-2xl bg-[#2a2847] ring-4 ring-white/10 shadow-2xl md:h-32 md:w-32">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-3xl font-semibold text-white">{initials}</div>
                  )}
                </div>
                <label className="absolute -bottom-2 -right-2 inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl border border-white/20 bg-[#11101d] text-white shadow-lg transition hover:bg-[#252244]">
                  <Camera size={16} />
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="hidden"
                    disabled={photoSaving || loading}
                    onChange={(e) => void onFile(e.target.files?.[0])}
                  />
                </label>
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate text-xl font-semibold">{fullName || email || 'Staff member'}</p>
                <p className="truncate text-sm text-slate-300">{email || '—'}</p>
                <span className="mt-2 inline-flex rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium capitalize text-slate-100">
                  {roleLabel}
                </span>
                <div className="mt-3 flex flex-wrap gap-2">
                  <label className="inline-flex cursor-pointer items-center rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/10">
                    {photoSaving ? 'Uploading…' : 'Change photo'}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      className="hidden"
                      disabled={photoSaving || loading}
                      onChange={(e) => void onFile(e.target.files?.[0])}
                    />
                  </label>
                  {avatarUrl && (
                    <button
                      type="button"
                      onClick={() => void onRemovePhoto()}
                      disabled={photoSaving}
                      className="rounded-xl border border-white/15 bg-transparent px-3 py-2 text-xs font-semibold text-slate-200 transition hover:bg-white/10 disabled:opacity-50"
                    >
                      Remove photo
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}
        {message && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div>
        )}

        <section className="rounded-2xl border border-[#d6deea] bg-white p-6 shadow-sm md:p-8" data-tour="profile-personal-details">
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-[#0B1B34]">Personal details</h2>
            <p className="mt-1 text-sm text-[#6b84a8]">Optional fields help teammates reach you. Your sign-in email stays managed by IT.</p>
          </div>

          {loading ? (
            <p className="text-sm text-[#6b84a8]">Loading profile…</p>
          ) : (
            <div className="space-y-5">
              <label className="block">
                <span className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[#6b84a8]">
                  <User size={14} />
                  Display name
                </span>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Your full name"
                  className="w-full rounded-xl border border-[#c8ddf4] bg-[#f8fbff] px-4 py-3 text-sm text-[#0B1B34] outline-none transition focus:border-[#005EB8] focus:ring-2 focus:ring-[#005EB8]/20"
                />
              </label>

              <label className="block">
                <span className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[#6b84a8]">
                  <Mail size={14} />
                  Work email
                </span>
                <input
                  type="email"
                  value={email}
                  readOnly
                  className="w-full cursor-not-allowed rounded-xl border border-[#e8eef5] bg-[#f4f7fb] px-4 py-3 text-sm text-[#6b84a8]"
                />
              </label>

              <div className="grid gap-5 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[#6b84a8]">
                    <Phone size={14} />
                    Phone
                  </span>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="e.g. (416) 555-0100"
                    className="w-full rounded-xl border border-[#c8ddf4] bg-[#f8fbff] px-4 py-3 text-sm text-[#0B1B34] outline-none transition focus:border-[#005EB8] focus:ring-2 focus:ring-[#005EB8]/20"
                  />
                </label>

                <label className="block">
                  <span className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[#6b84a8]">
                    <Hash size={14} />
                    Extension
                  </span>
                  <input
                    type="text"
                    value={extension}
                    onChange={(e) => setExtension(e.target.value)}
                    placeholder="e.g. 2042"
                    className="w-full rounded-xl border border-[#c8ddf4] bg-[#f8fbff] px-4 py-3 text-sm text-[#0B1B34] outline-none transition focus:border-[#005EB8] focus:ring-2 focus:ring-[#005EB8]/20"
                  />
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <Button onClick={() => void onSaveProfile()} disabled={saving || loading} className="inline-flex items-center gap-2">
                  <Save size={16} />
                  {saving ? 'Saving…' : 'Save profile'}
                </Button>
                <p className="text-xs text-[#6b84a8]">Changes update your sidebar name and avatar across the app.</p>
              </div>
            </div>
          )}
        </section>

        {showCallSettings && <RecruiterCallSettingsPanel />}
      </div>
  );
};

export default AccountSettingsPage;
