import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, Pause, Play, RotateCcw } from 'lucide-react';

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

const CallRecordingPlayer: React.FC<{ url: string; durationHint?: number | null }> = ({
  url,
  durationHint,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(durationHint && durationHint > 0 ? durationHint : 0);
  const [current, setCurrent] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setPlaying(false);
    setCurrent(0);
    setReady(false);
    if (durationHint && durationHint > 0) setDuration(durationHint);
  }, [url, durationHint]);

  const togglePlay = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      void el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    } else {
      el.pause();
      setPlaying(false);
    }
  }, []);

  const seek = useCallback((value: number) => {
    const el = audioRef.current;
    if (!el || !Number.isFinite(value)) return;
    el.currentTime = value;
    setCurrent(value);
  }, []);

  const skip = useCallback((delta: number) => {
    const el = audioRef.current;
    if (!el) return;
    const next = Math.max(0, Math.min(el.duration || duration || 0, el.currentTime + delta));
    seek(next);
  }, [duration, seek]);

  const maxDuration = duration > 0 ? duration : Math.max(current, 1);

  return (
    <div className="w-full rounded-xl border border-[#d6deea] bg-[#f8fafc] p-3 space-y-2">
      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) {
            setDuration(d);
            setReady(true);
          }
        }}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={togglePlay}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#005EB8] text-white hover:bg-[#004a94]"
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
        </button>
        <button
          type="button"
          onClick={() => skip(-10)}
          className="rounded-lg border border-[#cfe3f9] px-2 py-1 text-[11px] font-medium text-[#334155] hover:bg-white"
        >
          −10s
        </button>
        <button
          type="button"
          onClick={() => skip(10)}
          className="rounded-lg border border-[#cfe3f9] px-2 py-1 text-[11px] font-medium text-[#334155] hover:bg-white"
        >
          +10s
        </button>
        <span className="ml-auto text-xs tabular-nums text-[#5c6b82]">
          {formatClock(current)} / {ready || duration > 0 ? formatClock(maxDuration) : '—'}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={maxDuration}
        step={0.1}
        value={Math.min(current, maxDuration)}
        onChange={(e) => seek(Number(e.target.value))}
        className="w-full h-2 accent-[#005EB8] cursor-pointer"
        aria-label="Seek recording"
      />
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs text-[#005EB8] hover:underline"
      >
        <ExternalLink size={12} />
        Open / download
        <RotateCcw size={10} className="opacity-0" aria-hidden />
      </a>
    </div>
  );
};

export default CallRecordingPlayer;
