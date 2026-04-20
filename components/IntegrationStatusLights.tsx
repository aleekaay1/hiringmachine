import React, { useEffect, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { fetchIntegrationHealth } from '../services/liveSessionsIntegrations';

type Light = 'loading' | 'ok' | 'error' | 'off';

/**
 * Two small dots: Zoom API vs Calendly API (admin toolbar).
 * Green = reachable; red = misconfigured or API error; gray = Calendly token not set.
 */
const IntegrationStatusLights: React.FC<{ className?: string; dark?: boolean }> = ({
  className = '',
  dark = false,
}) => {
  const [zoom, setZoom] = useState<Light>('loading');
  const [cal, setCal] = useState<Light>('loading');
  const [zoomTip, setZoomTip] = useState('Zoom');
  const [calTip, setCalTip] = useState('Calendly');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        setZoom('off');
        setCal('off');
        setZoomTip('Zoom — sign in to check');
        setCalTip('Calendly — sign in to check');
        return;
      }
      const result = await fetchIntegrationHealth(token);
      if (cancelled) return;
      if (!result.ok) {
        setZoom('error');
        setCal('error');
        setZoomTip(`Zoom — ${result.error}`);
        setCalTip(`Calendly — ${result.error}`);
        return;
      }
      const h = result.data;
      setZoom(h.zoom_ok ? 'ok' : 'error');
      setZoomTip(
        h.zoom_ok ? 'Zoom API OK (OAuth + host user)' : `Zoom: ${h.zoom_error || 'Error'}`,
      );
      if (!h.calendly_configured) {
        setCal('off');
        setCalTip('Calendly — not connected (no CALENDLY_API_TOKEN)');
      } else if (h.calendly_ok) {
        setCal('ok');
        setCalTip('Calendly API OK');
      } else {
        setCal('error');
        setCalTip(`Calendly: ${h.calendly_error || 'Error'}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dot = (state: Light) => {
    const color =
      state === 'loading'
        ? 'bg-slate-300 animate-pulse'
        : state === 'ok'
          ? 'bg-[#37B06D] shadow-[0_0_8px_rgba(55,176,109,0.75)]'
          : state === 'off'
            ? 'bg-slate-400'
            : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.55)]';
    return <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${color}`} aria-hidden />;
  };

  const shell = dark
    ? 'border border-slate-700 bg-slate-900/60'
    : 'border border-gray-200 bg-gray-50/90';
  const labelCls = dark
    ? 'text-[10px] font-medium text-slate-400 hidden sm:inline'
    : 'text-[10px] font-medium text-gray-600 hidden sm:inline';
  const sep = dark ? 'bg-slate-600' : 'bg-gray-200';

  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full px-2 py-1 ${shell} ${className}`}
      role="status"
      aria-label={`Integrations: ${zoomTip}; ${calTip}`}
    >
      <span className="inline-flex items-center gap-1" title={zoomTip}>
        {dot(zoom)}
        <span className={labelCls}>Zoom</span>
      </span>
      <span className={`h-3 w-px ${sep}`} aria-hidden />
      <span className="inline-flex items-center gap-1" title={calTip}>
        {dot(cal)}
        <span className={labelCls}>Calendly</span>
      </span>
    </div>
  );
};

export default IntegrationStatusLights;
