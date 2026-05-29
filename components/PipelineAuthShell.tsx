import React from 'react';
import Layout from './Layout';
import { Button } from './UI';
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
      <div className="min-h-screen bg-gradient-to-b from-[#f7fbff] to-[#eef6ff] flex items-center justify-center p-4">
        <p className="text-sm text-[#6f7b8d]">Loading session...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#f7fbff] to-[#eef6ff] flex items-center justify-center p-4">
        <div className="bg-white border border-[#d9e9fb] p-8 rounded-[24px] shadow w-full max-w-sm">
          <h2 className="text-xl font-bold text-[#0B1B34] mb-1 text-center">{title}</h2>
          <p className="text-sm text-[#6f7b8d] text-center mb-6">{subtitle}</p>
          <form
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
            className="space-y-4"
          >
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-[#cfe3f9]"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-[#cfe3f9]"
            />
            <Button fullWidth type="submit">Sign in</Button>
            <div className="relative py-1">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-[#d9e9fb]" />
              </div>
              <div className="relative flex justify-center text-[10px] uppercase tracking-wide text-[#95a6bd]">
                <span className="bg-white px-2">or</span>
              </div>
            </div>
            <Button
              fullWidth
              type="button"
              variant="outline"
              onClick={async () => {
                setAuthError(null);
                setGoogleLoading(true);
                const { error } = await signInWithGoogle(redirectPath);
                if (error) setAuthError(error);
                setGoogleLoading(false);
              }}
              disabled={googleLoading}
            >
              {googleLoading ? 'Redirecting...' : 'Continue with Google'}
            </Button>
            {authError && <p className="text-sm text-red-600 text-center">{authError}</p>}
          </form>
        </div>
      </div>
    );
  }

  return <Layout isAdmin>{children}</Layout>;
};

export default PipelineAuthShell;
