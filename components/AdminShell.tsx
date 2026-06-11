import React from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import Layout from './Layout';
import StaffLoginPage from './StaffLoginPage';
import { signInWithGoogle } from '../services/googleAuth';
import { supabase } from '../services/supabaseClient';
import {
  canAccessSection,
  defaultRouteForRole,
  resolveAppSectionFromLocation,
} from '../services/accessControl';
import {
  ensureStaffAuth,
  getStaffAuthState,
  getStaffSessionSnapshot,
  resolveStaffSession,
  subscribeStaffAuth,
} from '../services/staffSessionCache';

async function redirectAfterStaffLogin(
  navigate: ReturnType<typeof useNavigate>,
  pathname: string,
  search: string,
): Promise<void> {
  const snapshot = await resolveStaffSession();
  const currentPath = `${pathname}${search}`;
  const section = resolveAppSectionFromLocation(pathname, search);
  if (canAccessSection(snapshot.role, section, snapshot.userEmail, snapshot.displayName)) return;
  const fallback = defaultRouteForRole(snapshot.role);
  if (fallback !== currentPath) {
    navigate(fallback, { replace: true });
  }
}

const AdminShell: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const initialAuth = React.useMemo(() => getStaffAuthState(), []);
  const initialSession = React.useMemo(() => getStaffSessionSnapshot(), []);
  const [authReady, setAuthReady] = React.useState(initialAuth.authReady);
  const [sessionReady, setSessionReady] = React.useState(initialSession.resolved);
  const [isAuthenticated, setIsAuthenticated] = React.useState(initialAuth.isAuthenticated);
  const [email, setEmail] = React.useState('admin@globelife-paz.com');
  const [password, setPassword] = React.useState('');
  const [authError, setAuthError] = React.useState<string | null>(null);
  const [googleLoading, setGoogleLoading] = React.useState(false);

  const syncAuth = React.useCallback(() => {
    const next = getStaffAuthState();
    setAuthReady(next.authReady);
    setIsAuthenticated(next.isAuthenticated);
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const authed = await ensureStaffAuth();
      if (cancelled) return;
      syncAuth();
      if (authed) await resolveStaffSession();
      if (!cancelled) setSessionReady(true);
    })();
    const unsubscribe = subscribeStaffAuth(() => {
      syncAuth();
      void resolveStaffSession().then(() => {
        if (!cancelled) setSessionReady(true);
      });
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [syncAuth]);

  if (!authReady || (isAuthenticated && !sessionReady)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#eef2f7]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#005EB8] border-t-transparent" />
      </div>
    );
  }

  if (!isAuthenticated) {
    const redirectPath = `${location.pathname}${location.search}`;
    return (
      <StaffLoginPage
        title="Staff workspace"
        subtitle="Sign in to continue"
        email={email}
        onEmailChange={setEmail}
        password={password}
        onPasswordChange={setPassword}
        authError={authError}
        googleLoading={googleLoading}
        onSubmit={async (e) => {
          e.preventDefault();
          setAuthError(null);
          const { error } = await supabase.auth.signInWithPassword({ email, password });
          if (error) {
            setAuthError('Invalid email or password.');
            return;
          }
          syncAuth();
          await redirectAfterStaffLogin(navigate, location.pathname, location.search);
        }}
        onGoogleSignIn={async () => {
          setAuthError(null);
          setGoogleLoading(true);
          const { error } = await signInWithGoogle(redirectPath);
          if (error) setAuthError(error);
          setGoogleLoading(false);
        }}
      />
    );
  }

  return (
    <Layout isAdmin>
      <div key={location.pathname} className="admin-route-enter flex min-h-0 flex-1 flex-col">
        <Outlet />
      </div>
    </Layout>
  );
};

export default AdminShell;
