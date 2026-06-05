import React from 'react';
import Layout from './Layout';
import StaffLoginPage from './StaffLoginPage';
import { supabase } from '../services/supabaseClient';
import { signInWithGoogle } from '../services/googleAuth';

type PipelineAuthShellProps = {
  title: string;
  subtitle: string;
  redirectPath: string;
  children: React.ReactNode;
};

const PipelineAuthShell: React.FC<PipelineAuthShellProps> = ({
  title,
  subtitle,
  redirectPath,
  children,
}) => {
  const [authReady, setAuthReady] = React.useState(false);
  const [isAuthenticated, setIsAuthenticated] = React.useState(false);
  const [email, setEmail] = React.useState('admin@globelife-paz.com');
  const [password, setPassword] = React.useState('');
  const [authError, setAuthError] = React.useState<string | null>(null);
  const [googleLoading, setGoogleLoading] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setIsAuthenticated(Boolean(data.session));
      setAuthReady(true);
    });
    const { data: authSub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      setIsAuthenticated(Boolean(session));
      setAuthReady(true);
    });
    return () => {
      cancelled = true;
      authSub.subscription.unsubscribe();
    };
  }, []);

  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#e8f2fc] flex items-center justify-center p-4">
        <p className="text-sm text-[#6f7b8d]">Loading session…</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <StaffLoginPage
        title={title}
        subtitle={subtitle}
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
          setIsAuthenticated(true);
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

  return <Layout isAdmin>{children}</Layout>;
};

export default PipelineAuthShell;
