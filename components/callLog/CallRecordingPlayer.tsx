import React from 'react';
import { Loader2, Pause, Play } from 'lucide-react';
import './call-recording-player.css';

const SPEED_OPTIONS = [1, 1.5, 2] as const;
type PlaybackSpeed = (typeof SPEED_OPTIONS)[number];

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

async function decodeWaveformPeaks(url: string, bars: number): Promise<number[] | null> {
  try {
    const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (!res.ok) return null;
    const buffer = await res.arrayBuffer();
    const ctx = new AudioContext();
    try {
      const audioBuffer = await ctx.decodeAudioData(buffer.slice(0));
      const channel = audioBuffer.getChannelData(0);
      const block = Math.max(1, Math.floor(channel.length / bars));
      const peaks: number[] = [];
      for (let i = 0; i < bars; i += 1) {
        const start = i * block;
        const end = Math.min(channel.length, start + block);
        let max = 0;
        for (let j = start; j < end; j += 1) {
          const v = Math.abs(channel[j]);
          if (v > max) max = v;
        }
        peaks.push(max);
      }
      const peakMax = Math.max(...peaks, 0.001);
      return peaks.map((v) => v / peakMax);
    } finally {
      void ctx.close();
    }
  } catch {
    return null;
  }
}

function drawWaveform(
  canvas: HTMLCanvasElement,
  peaks: number[] | null,
  progress: number,
  hoverProgress: number | null,
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return;

  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const barCount = peaks?.length || 80;
  const gap = 1.5;
  const barWidth = Math.max(1.5, (width - gap * (barCount - 1)) / barCount);
  const mid = height / 2;

  for (let i = 0; i < barCount; i += 1) {
    const amp = peaks ? peaks[i] : 0.15 + 0.55 * Math.abs(Math.sin(i * 0.35));
    const barH = Math.max(3, amp * (height - 8));
    const x = i * (barWidth + gap);
    const pct = i / barCount;
    const played = pct <= progress;
    ctx.fillStyle = played ? '#005EB8' : '#9bc4e8';
    ctx.fillRect(x, mid - barH / 2, barWidth, barH);
  }

  const playheadX = progress * width;
  ctx.fillStyle = '#0B1B34';
  ctx.fillRect(Math.max(0, playheadX - 1), 0, 2, height);

  if (hoverProgress != null) {
    const hx = hoverProgress * width;
    ctx.fillStyle = 'rgba(11, 27, 52, 0.12)';
    ctx.fillRect(hx - 1, 0, 2, height);
  }
}

type CallRecordingPlayerProps = {
  url: string;
  durationHint?: number | null;
};

const CallRecordingPlayer: React.FC<CallRecordingPlayerProps> = ({ url, durationHint }) => {
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const peaksRef = React.useRef<number[] | null>(null);
  const rafRef = React.useRef<number | null>(null);

  const [playing, setPlaying] = React.useState(false);
  const [buffering, setBuffering] = React.useState(false);
  const [duration, setDuration] = React.useState(
    durationHint && durationHint > 0 ? durationHint : 0,
  );
  const [currentTime, setCurrentTime] = React.useState(0);
  const [speed, setSpeed] = React.useState<PlaybackSpeed>(1);
  const [waveLoading, setWaveLoading] = React.useState(true);
  const [hoverPct, setHoverPct] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;

  const paint = React.useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawWaveform(canvas, peaksRef.current, progress, hoverPct);
  }, [progress, hoverPct]);

  React.useEffect(() => {
    let cancelled = false;
    peaksRef.current = null;
    setWaveLoading(true);
    setError(null);
    setCurrentTime(0);
    setPlaying(false);
    setDuration(durationHint && durationHint > 0 ? durationHint : 0);

    void decodeWaveformPeaks(url, 96).then((peaks) => {
      if (cancelled) return;
      peaksRef.current = peaks;
      setWaveLoading(false);
      paint();
    });

    return () => {
      cancelled = true;
    };
  }, [url, durationHint, paint]);

  React.useEffect(() => {
    paint();
  }, [paint]);

  React.useEffect(() => {
    const onResize = () => paint();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [paint]);

  React.useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [url, speed]);

  React.useEffect(() => {
    const tick = () => {
      const audio = audioRef.current;
      if (audio && !audio.paused) {
        setCurrentTime(audio.currentTime);
        paint();
      }
      rafRef.current = window.requestAnimationFrame(tick);
    };
    rafRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) window.cancelAnimationFrame(rafRef.current);
    };
  }, [paint]);

  const seekToPct = (pct: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    const next = Math.max(0, Math.min(1, pct)) * audio.duration;
    audio.currentTime = next;
    setCurrentTime(next);
    paint();
  };

  const onWaveClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    seekToPct((e.clientX - rect.left) / rect.width);
  };

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    setError(null);
    if (audio.paused) {
      try {
        await audio.play();
        setPlaying(true);
      } catch {
        setError('Could not play — try opening the recording in a new tab.');
        setPlaying(false);
      }
    } else {
      audio.pause();
      setPlaying(false);
    }
  };

  return (
    <div className="call-recording-player">
      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
        crossOrigin="anonymous"
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDuration(d);
        }}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onWaiting={() => setBuffering(true)}
        onCanPlay={() => setBuffering(false)}
        onPlaying={() => {
          setPlaying(true);
          setBuffering(false);
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrentTime(0);
        }}
        onError={() => setError('Recording could not be loaded.')}
      />

      <div className="call-recording-player__top">
        <button
          type="button"
          className="call-recording-player__play"
          onClick={() => void togglePlay()}
          disabled={buffering && !playing}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {buffering && playing ? (
            <Loader2 size={16} className="animate-spin" />
          ) : playing ? (
            <Pause size={16} fill="currentColor" />
          ) : (
            <Play size={16} fill="currentColor" className="ml-0.5" />
          )}
        </button>

        <div className="call-recording-player__meta">
          <div className="call-recording-player__time">
            {formatTime(currentTime)} / {formatTime(duration)}
            {buffering && <span className="ml-2 text-[#6b84a8]">Buffering…</span>}
          </div>

          <div
            className={`call-recording-player__wave-wrap${buffering ? ' is-buffering' : ''}`}
            onClick={onWaveClick}
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              if (!rect.width) return;
              setHoverPct((e.clientX - rect.left) / rect.width);
            }}
            onMouseLeave={() => setHoverPct(null)}
            role="slider"
            aria-valuemin={0}
            aria-valuemax={duration}
            aria-valuenow={currentTime}
            aria-label="Recording timeline"
          >
            <canvas ref={canvasRef} className="call-recording-player__wave-canvas" />
            {waveLoading && <div className="call-recording-player__wave-shimmer" aria-hidden />}
          </div>
        </div>

        <div className="call-recording-player__speeds">
          {SPEED_OPTIONS.map((rate) => (
            <button
              key={rate}
              type="button"
              className={`call-recording-player__speed${speed === rate ? ' is-active' : ''}`}
              onClick={() => {
                setSpeed(rate);
                if (audioRef.current) audioRef.current.playbackRate = rate;
              }}
            >
              {rate}x
            </button>
          ))}
        </div>
      </div>

      {error && <p className="call-recording-player__status is-error">{error}</p>}
      {!error && (
        <p className="call-recording-player__status">
          Click the waveform to jump — quiet gaps show as shorter bars.
          {' '}
          <a href={url} target="_blank" rel="noopener noreferrer" className="text-[#005EB8] hover:underline">
            Open file
          </a>
        </p>
      )}
    </div>
  );
};

export default CallRecordingPlayer;
