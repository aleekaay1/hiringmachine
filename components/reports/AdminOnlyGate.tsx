import React from 'react';
import { Navigate } from 'react-router-dom';
import { getCurrentUserProfile } from '../../services/accessControl';

export function AdminOnlyGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = React.useState(false);
  const [isAdmin, setIsAdmin] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    void getCurrentUserProfile()
      .then((profile) => {
        if (!cancelled) {
          setIsAdmin(profile?.role === 'admin');
          setReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setIsAdmin(false);
          setReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-[#5c7594]">
        Checking access…
      </div>
    );
  }

  if (!isAdmin) {
    return <Navigate to="/home" replace />;
  }

  return <>{children}</>;
}
