import React from 'react';
import { Moon, RefreshCw, Sun } from 'lucide-react';
import { Navigate, Outlet, useSearchParams } from 'react-router-dom';
import PipelineAuthShell from '../components/PipelineAuthShell';
import LeadManagerTabs from '../components/pipeline/LeadManagerTabs';
import { Button } from '../components/UI';
import { useLeadManagerData, useLeadManagerTone } from '../hooks/useLeadManagerData';

const WORKSPACE_THEME_STORAGE_KEY = 'pipeline-recruiter-workspace-theme';

export type LeadManagerOutletContext = ReturnType<typeof useLeadManagerData> & {
  tone: ReturnType<typeof useLeadManagerTone>;
  themeMode: 'dark' | 'light';
};

const LeadManagerLayout: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [themeMode, setThemeMode] = React.useState<'dark' | 'light'>('light');
  const data = useLeadManagerData();
  const tone = useLeadManagerTone(themeMode);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(WORKSPACE_THEME_STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') setThemeMode(stored);
  }, []);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(WORKSPACE_THEME_STORAGE_KEY, themeMode);
  }, [themeMode]);

  if (searchParams.get('tab') === 'all-leads') {
    return <Navigate to="/pipeline/lead-manager/leads" replace />;
  }

  const outletContext: LeadManagerOutletContext = { ...data, tone, themeMode };

  return (
    <PipelineAuthShell
      title="Lead Manager"
      subtitle="Sign in to review your lead packs and search assigned leads"
      redirectPath="/pipeline/lead-manager"
    >
      <div className={`mx-auto w-full max-w-[1500px] space-y-4 p-4 md:p-6 ${tone.page}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className={`text-[10px] uppercase tracking-[0.2em] ${tone.panelLabel}`}>Workstation</p>
            <h1 className={`text-2xl font-bold ${tone.panelTitle}`}>Lead Manager</h1>
            <p className={`mt-1 max-w-2xl text-sm ${tone.panelMuted}`}>
              Compare lead packs or search every lead assigned to you by name, email, or phone.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setThemeMode((prev) => (prev === 'dark' ? 'light' : 'dark'))}
              className={`inline-flex items-center gap-1 rounded-xl border px-3 py-2 text-xs font-semibold ${tone.actionButton}`}
            >
              {isDarkIcon(themeMode)}
              {themeMode === 'dark' ? 'Light' : 'Dark'}
            </button>
            <Button
              variant="outline"
              className="!min-h-0 h-9 gap-1.5 text-xs"
              onClick={() => void data.loadData('refresh')}
              disabled={data.loading || data.refreshing}
            >
              <RefreshCw size={14} className={data.refreshing ? 'animate-spin' : ''} />
              Refresh
            </Button>
          </div>
        </div>

        {data.error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{data.error}</div>
        )}

        <LeadManagerTabs />

        <Outlet context={outletContext} />
      </div>
    </PipelineAuthShell>
  );
};

function isDarkIcon(themeMode: 'dark' | 'light') {
  return themeMode === 'dark' ? <Sun size={13} /> : <Moon size={13} />;
}

export default LeadManagerLayout;
