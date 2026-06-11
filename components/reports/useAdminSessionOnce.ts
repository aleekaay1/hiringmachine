import React from 'react';
import { useNavigate } from 'react-router-dom';
import { canAccessReports, getCurrentUserProfile } from '../../services/accessControl';

let cachedCanViewReports: boolean | undefined;

/** One profile read per browser session — avoids "Checking access…" on every Reports navigation. */
export function useAdminSessionOnce(): { canViewReports: boolean } {
  const navigate = useNavigate();
  const canViewReports = cachedCanViewReports ?? false;

  React.useEffect(() => {
    if (cachedCanViewReports !== undefined) {
      if (!cachedCanViewReports) navigate('/home', { replace: true });
      return;
    }
    let cancelled = false;
    void getCurrentUserProfile().then((profile) => {
      if (cancelled) return;
      cachedCanViewReports = canAccessReports(profile?.role ?? null, profile?.email);
      if (!cachedCanViewReports) navigate('/home', { replace: true });
    });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return { canViewReports: cachedCanViewReports === true };
}
