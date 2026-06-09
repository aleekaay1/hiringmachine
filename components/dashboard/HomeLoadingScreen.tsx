import React from 'react';
import { motion } from 'framer-motion';

export type HomeLoadingProgress = {
  pct: number;
  label: string;
};

type HomeLoadingScreenProps = {
  progress: HomeLoadingProgress;
  title?: string;
  subtitle?: string;
  compact?: boolean;
};

const HomeLoadingScreen: React.FC<HomeLoadingScreenProps> = ({
  progress,
  title = 'Loading your workspace',
  subtitle = 'Pulling your stats and quick links…',
  compact = false,
}) => {
  const pct = Math.max(0, Math.min(100, Math.round(progress.pct)));

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="overflow-hidden rounded-3xl border border-[#d4e4f7] bg-gradient-to-br from-white via-[#f4f9ff] to-[#eef6ff] p-6 shadow-[0_24px_60px_-40px_rgba(0,94,184,0.35)]"
    >
      <div className="flex flex-col items-center text-center">
        <div className="relative mb-4 flex h-20 w-20 items-center justify-center rounded-3xl border border-[#c8ddf4] bg-white shadow-[0_12px_32px_-20px_rgba(0,94,184,0.45)]">
          <img src="/logo.png" alt="Paz Organization" className="h-14 w-14 object-contain" />
          <motion.div
            className="absolute -inset-1 rounded-3xl border-2 border-[#67b5ff]/40"
            animate={{ scale: [1, 1.06, 1], opacity: [0.35, 0.7, 0.35] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
          />
        </div>
        <p className="text-[10px] uppercase tracking-[0.28em] text-[#4e79a9]">Paz Talent Journey</p>
        <h2
          className="mt-1 text-xl font-semibold text-[#0B1B34]"
          style={{ fontFamily: 'Outfit, Inter, system-ui, sans-serif' }}
        >
          {title}
        </h2>
        {!compact && subtitle ? <p className="mt-1 max-w-md text-xs text-[#5c7594]">{subtitle}</p> : null}
      </div>

      <div className="mt-6">
        <div className="mb-2 flex items-center justify-between gap-3 text-xs">
          <span className="truncate font-medium text-[#365274]">{progress.label}</span>
          <span
            className="shrink-0 text-lg font-bold tabular-nums text-[#2f6ea8]"
            style={{ fontFamily: 'Outfit, Inter, system-ui, sans-serif' }}
          >
            {pct}%
          </span>
        </div>
        <div className="relative h-3 overflow-hidden rounded-full bg-[#e3eef9]">
          <motion.div
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-[#67b5ff] via-[#4e9ae8] to-[#37B06D]"
            initial={{ width: '0%' }}
            animate={{ width: `${Math.max(pct, pct > 0 ? 5 : 0)}%` }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
          />
          <motion.div
            className="absolute inset-y-0 w-16 bg-gradient-to-r from-transparent via-white/50 to-transparent"
            animate={{ x: ['-20%', '420%'] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'linear' }}
          />
        </div>
        {!compact ? (
          <p className="mt-2 text-center text-[11px] text-[#6a839f]">
            {pct >= 100 ? 'Almost there…' : 'If this stays below 100% for a long time, try Refresh or submit a Support ticket.'}
          </p>
        ) : null}
      </div>
    </motion.div>
  );
};

export default HomeLoadingScreen;
