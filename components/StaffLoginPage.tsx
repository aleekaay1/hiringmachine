import React from 'react';
import { Lock, Mail } from 'lucide-react';

export function GoogleLogo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

export type StaffLoginPageProps = {
  title: string;
  subtitle?: string;
  footerNote?: string;
  email: string;
  onEmailChange: (value: string) => void;
  password: string;
  onPasswordChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onGoogleSignIn: () => void;
  googleLoading?: boolean;
  submitLabel?: string;
  authError?: string | null;
  showLogo?: boolean;
};

const StaffLoginPage: React.FC<StaffLoginPageProps> = ({
  title,
  subtitle,
  footerNote,
  email,
  onEmailChange,
  password,
  onPasswordChange,
  onSubmit,
  onGoogleSignIn,
  googleLoading = false,
  submitLabel = 'Sign in',
  authError,
  showLogo = true,
}) => {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#e8f2fc] flex items-center justify-center p-4 sm:p-6">
      <div className="pointer-events-none absolute -left-24 top-[-6rem] h-[22rem] w-[22rem] rounded-full bg-gradient-to-br from-[#005EB8]/25 via-sky-300/20 to-transparent blur-3xl" />
      <div className="pointer-events-none absolute -right-20 bottom-[-5rem] h-[20rem] w-[20rem] rounded-full bg-gradient-to-tr from-[#37B06D]/30 via-emerald-200/15 to-transparent blur-3xl" />
      <div className="pointer-events-none absolute left-1/2 top-1/3 h-64 w-64 -translate-x-1/2 rounded-full bg-white/50 blur-3xl" />

      <div className="relative z-10 w-full max-w-[420px] rounded-[28px] border border-white/90 bg-white/95 backdrop-blur-xl shadow-[0_28px_90px_-32px_rgba(0,94,184,0.38)] px-7 py-8 sm:px-9 sm:py-10">
        {showLogo && (
          <div className="flex flex-col items-center mb-7">
            <div className="h-[5.5rem] w-[5.5rem] rounded-full bg-white border border-[#d6e6f9] ring-4 ring-[#005EB8]/8 shadow-[0_12px_40px_-18px_rgba(0,94,184,0.45)] flex items-center justify-center overflow-hidden">
              <img
                src="/logo.png"
                alt="Paz Hiring Journey"
                className="h-[4.5rem] w-[4.5rem] object-contain"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            </div>
            <p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.28em] text-[#5a7da8]">
              Paz Hiring Journey
            </p>
          </div>
        )}

        <div className="text-center mb-7">
          <h1 className="text-2xl font-bold tracking-tight text-[#0B1B34]">{title}</h1>
          {subtitle ? <p className="mt-2 text-sm leading-relaxed text-[#6f7b8d]">{subtitle}</p> : null}
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#5c7594]">Email</span>
            <div className="flex items-center gap-3 rounded-2xl border border-[#cfe3f9] bg-[#f8fbff] px-4 py-3 transition focus-within:border-[#005EB8] focus-within:ring-2 focus-within:ring-[#005EB8]/12">
              <Mail size={18} className="shrink-0 text-[#7a9bc4]" aria-hidden />
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => onEmailChange(e.target.value)}
                placeholder="you@globelife-paz.com"
                className="w-full min-w-0 bg-transparent text-sm text-[#0B1B34] placeholder:text-[#9eb0c7] outline-none"
              />
            </div>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#5c7594]">Password</span>
            <div className="flex items-center gap-3 rounded-2xl border border-[#cfe3f9] bg-[#f8fbff] px-4 py-3 transition focus-within:border-[#005EB8] focus-within:ring-2 focus-within:ring-[#005EB8]/12">
              <Lock size={18} className="shrink-0 text-[#7a9bc4]" aria-hidden />
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => onPasswordChange(e.target.value)}
                placeholder="Enter your password"
                className="w-full min-w-0 bg-transparent text-sm text-[#0B1B34] placeholder:text-[#9eb0c7] outline-none"
              />
            </div>
          </label>

          {authError ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700 text-center">
              {authError}
            </div>
          ) : null}

          <button
            type="submit"
            className="w-full min-h-[48px] rounded-2xl bg-gradient-to-r from-[#005EB8] to-[#0a4f96] px-6 py-3 text-sm font-semibold text-white shadow-[0_10px_28px_-12px_rgba(0,94,184,0.65)] transition hover:from-[#004c94] hover:to-[#083f7d] hover:shadow-[0_14px_32px_-12px_rgba(0,94,184,0.7)] disabled:opacity-60"
          >
            {submitLabel}
          </button>

          <div className="relative py-2">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-[#dbe8f6]" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-white px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#95a6bd]">
                or
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onGoogleSignIn}
            disabled={googleLoading}
            className="w-full min-h-[48px] inline-flex items-center justify-center gap-3 rounded-2xl border border-[#d7dee8] bg-white px-6 py-3 text-sm font-semibold text-[#1f2a3d] shadow-sm transition hover:border-[#c5ceda] hover:bg-[#fafbfc] hover:shadow-md disabled:opacity-60"
          >
            <GoogleLogo size={20} />
            <span>{googleLoading ? 'Redirecting to Google…' : 'Continue with Google'}</span>
          </button>
        </form>

        {footerNote ? <p className="mt-6 text-center text-xs leading-relaxed text-[#8a9bb2]">{footerNote}</p> : null}
      </div>
    </div>
  );
};

export default StaffLoginPage;
