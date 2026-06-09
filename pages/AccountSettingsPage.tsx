import React from 'react';
import Layout from '../components/Layout';
import { Button } from '../components/UI';
import { getCurrentUserProfile } from '../services/accessControl';
import { removeProfileAvatar, uploadProfileAvatar } from '../services/profileAvatarService';

const AccountSettingsPage: React.FC = () => {
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [displayName, setDisplayName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [role, setRole] = React.useState('');
  const [avatarUrl, setAvatarUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    void getCurrentUserProfile().then((profile) => {
      setDisplayName(profile?.full_name || '');
      setEmail(profile?.email || '');
      setRole(profile?.role || '');
      setAvatarUrl(profile?.avatar_url || null);
      setLoading(false);
    });
  }, []);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const url = await uploadProfileAvatar(file);
      setAvatarUrl(url);
      setMessage('Profile photo updated.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const onRemove = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await removeProfileAvatar();
      setAvatarUrl(null);
      setMessage('Profile photo removed.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || 'U';

  return (
    <Layout isAdmin>
      <div className="mx-auto max-w-lg space-y-6 p-4 md:p-8">
        <h1 className="text-2xl font-bold text-[#0B1B34]">My profile</h1>

        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {message && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div>}

        <section className="rounded-2xl border border-[#cde0f4] bg-white p-6">
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            <div className="h-24 w-24 overflow-hidden rounded-2xl bg-[#eef2f7] ring-2 ring-[#cde0f4]">
              {avatarUrl ? (
                <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-2xl font-semibold text-[#4b6d95]">{initials}</div>
              )}
            </div>
            <div className="flex-1 space-y-3 text-center sm:text-left">
              <div>
                <p className="text-lg font-semibold text-[#0B1B34]">{displayName || '—'}</p>
                <p className="text-sm text-[#4b6d95]">{email || '—'}</p>
                <p className="text-xs capitalize text-[#6b84a8]">{role || '—'}</p>
              </div>
              <div className="flex flex-wrap justify-center gap-2 sm:justify-start">
                <label className="inline-flex cursor-pointer items-center rounded-xl border border-[#c8ddf4] bg-[#f4f8ff] px-3 py-2 text-xs font-semibold text-[#0B1B34] hover:bg-[#e8f3ff]">
                  {saving ? 'Uploading…' : 'Upload photo'}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="hidden"
                    disabled={saving || loading}
                    onChange={(e) => void onFile(e.target.files?.[0])}
                  />
                </label>
                {avatarUrl && (
                  <Button variant="outline" className="!min-h-0 h-9 text-xs" onClick={() => void onRemove()} disabled={saving}>
                    Remove
                  </Button>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </Layout>
  );
};

export default AccountSettingsPage;
