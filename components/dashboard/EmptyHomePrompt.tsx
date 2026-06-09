import React from 'react';
import { RefreshCw } from 'lucide-react';

export function EmptyHomePrompt({ message }: { message: string }) {
  return (
    <div className="rounded-3xl border border-dashed border-[#c8ddf4] bg-white/70 p-8 text-center">
      <RefreshCw className="mx-auto h-8 w-8 text-[#9bb8d9]" strokeWidth={1.5} />
      <p className="mt-3 text-sm text-[#4f6886]">{message}</p>
    </div>
  );
}

export function HomeRefreshButton({
  onRefresh,
  refreshing,
  title,
}: {
  onRefresh: () => void;
  refreshing: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      data-tour="home-refresh"
      onClick={() => void onRefresh()}
      disabled={refreshing}
      title={title || 'Refresh dashboard'}
      aria-label="Refresh dashboard"
      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#cfe0f5] bg-white/95 text-[#5c8ab8] shadow-sm transition hover:border-[#9bc8f6] hover:bg-[#f0f7ff] hover:text-[#005EB8] disabled:opacity-55"
    >
      <RefreshCw className={`h-[15px] w-[15px] ${refreshing ? 'animate-spin' : ''}`} strokeWidth={2.25} />
    </button>
  );
}
