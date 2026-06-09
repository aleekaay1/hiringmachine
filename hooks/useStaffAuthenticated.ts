import React from 'react';
import {
  ensureStaffAuth,
  getStaffAuthState,
  subscribeStaffAuth,
} from '../services/staffSessionCache';

/** True when staff session exists; hydrates from cache to avoid login flashes between routes. */
export function useStaffAuthenticated(): boolean {
  const [isAuthenticated, setIsAuthenticated] = React.useState(
    () => getStaffAuthState().isAuthenticated,
  );

  React.useEffect(() => {
    let cancelled = false;
    void ensureStaffAuth().then(() => {
      if (!cancelled) setIsAuthenticated(getStaffAuthState().isAuthenticated);
    });
    const unsubscribe = subscribeStaffAuth(() => {
      if (!cancelled) setIsAuthenticated(getStaffAuthState().isAuthenticated);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return isAuthenticated;
}
