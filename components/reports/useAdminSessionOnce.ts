import React from 'react';
import { useNavigate } from 'react-router-dom';
import { getCurrentUserProfile } from '../../services/accessControl';

let cachedIsAdmin: boolean | undefined;

/** One profile read per browser session — avoids "Checking access…" on every Reports navigation. */
export function useAdminSessionOnce(): { isAdmin: boolean } {
  const navigate = useNavigate();
  const isAdmin = cachedIsAdmin ?? false;

  React.useEffect(() => {
    if (cachedIsAdmin !== undefined) {
      if (!cachedIsAdmin) navigate('/home', { replace: true });
      return;
    }
    let cancelled = false;
    void getCurrentUserProfile().then((profile) => {
      if (cancelled) return;
      cachedIsAdmin = profile?.role === 'admin';
      if (!cachedIsAdmin) navigate('/home', { replace: true });
    });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return { isAdmin: cachedIsAdmin === true };
}
