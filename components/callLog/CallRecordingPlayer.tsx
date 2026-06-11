import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Captions, Loader2, Pause, Play, X } from 'lucide-react';
import {
  fetchCallRecordingStreamUrl,
  loadCallTranscript,
  syncThreeCxCallTranscript,
  type RecordingTranscript,
} from '../../services/threecxCallLogAdmin';
import CallRecordingTranscript from './CallRecordingTranscript';
import './call-recording-player.css';

const SPEED_OPTIONS = [1, 1.5, 2] as const;
type PlaybackSpeed = (typeof SPEED_OPTIONS)[number];

type CallRecordingPlayerProps = {
  callRecordId: string;
  initialTranscript?: string | null;
  initialSummary?: string | null;
};

const CallRecordingPlayer: React.FC<CallRecordingPlayerProps> = ({
  callRecordId,
  initialTranscript,
  initialSummary,
}) => {
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = React.useRef<string | null>(null);
  const progressRef = React.useRef<HTMLDivElement | null>(null);

  const [src, setSrc] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [playing, setPlaying] = React.useState(false);
  const [speed, setSpeed] = React.useState<PlaybackSpeed>(1);
  const [currentTime, setCurrentTime] = React.useState(0);
  const [duration, setDuration] = React.useState(0);

  const [transcriptOpen, setTranscriptOpen] = React.useState(false);
  const [transcript, setTranscript] = React.useState<RecordingTranscript | null>(
    initialTranscript
      ? { text: initialTranscript, segments: [], model: '3cx-ai', transcribedAt: '', language: 'en' }
      : null,
  );
  const [summary, setSummary] = React.useState<string | null>(initialSummary || null);
  const [transcriptLoading, setTranscriptLoading] = React.useState(false);
  const [transcriptError, setTranscriptError] = React.useState<string | null>(null);
  const [transcriptStatus, setTranscriptStatus] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setLoading(true);
      setError(null);
      setSrc(null);
      setPlaying(false);
      setCurrentTime(0);
      setDuration(0);
      setTranscriptOpen(false);
      setTranscript(
        initialTranscript
          ? { text: initialTranscript, segments: [], model: '3cx-ai', transcribedAt: '', language: 'en' }
          : null,
      );
      setSummary(initialSummary || null);
      setTranscriptLoading(false);
      setTranscriptError(null);
      setTranscriptStatus(null);

      try {
        const blobUrl = await fetchCallRecordingStreamUrl(callRecordId);
        if (cancelled) {
          URL.revokeObjectURL(blobUrl);
          return;
        }
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = blobUrl;
        setSrc(blobUrl);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Recording could not be loaded.');
        setLoading(false);
      }
    };

    void run();

    return () => {
      cancelled = true;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [callRecordId, initialTranscript, initialSummary]);

  React.useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = speed;
  }, [src, speed]);

  const loadThreeCxTranscript = React.useCallback(async () => {
    setTranscriptLoading(true);
    setTranscriptError(null);
    setTranscriptStatus('Loading transcript from 3CX…');

    try {
      let payload = await loadCallTranscript(callRecordId);
      if (!payload.transcript?.text) {
        setTranscriptStatus('Checking 3CX for this call…');
        payload = await syncThreeCxCallTranscript(callRecordId);
      }
      if (payload.transcript?.text) {
        setTranscript(payload.transcript);
        setSummary(payload.summary);
        setTranscriptLoading(false);
        setTranscriptStatus(null);
        return;
      }
      setTranscript(null);
      setSummary(payload.summary);
      setTranscriptError(
        payload.message || 'No transcript from 3CX yet. Enable AI transcription in 3CX and upload CRM template v6.',
      );
      setTranscriptLoading(false);
      setTranscriptStatus(null);
    } catch (err) {
      setTranscriptError(err instanceof Error ? err.message : 'Could not load transcript.');
      setTranscriptLoading(false);
      setTranscriptStatus(null);
    }
  }, [callRecordId]);

  const openTranscript = () => {
    setTranscriptOpen(true);
    if (!transcript?.text && !transcriptLoading) {
      void loadThreeCxTranscript();
    }
  };

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      try {
        await audio.play();
        setPlaying(true);
      } catch {
        setError('Playback was blocked by your browser.');
      }
    } else {
      audio.pause();
      setPlaying(false);
    }
  };

  const seekTo = (seconds: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(seconds)) return;
    audio.currentTime = seconds;
    setCurrentTime(seconds);
  };

  const seekFromClientX = (clientX: number) => {
    const bar = progressRef.current;
    const audio = audioRef.current;
    if (!bar || !audio || !duration) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    seekTo(ratio * duration);
  };

  const onProgressPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    seekFromClientX(event.clientX);
    const onMove = (e: PointerEvent) => seekFromClientX(e.clientX);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  if (loading) {
    return (
      <div className="call-recording-player call-recording-player--loading">
        <Loader2 size={20} className="call-recording-player__spinner" />
        <div className="min-w-0">
          <span className="call-recording-player__loading-label">Loading recording…</span>
          <div className="call-recording-load-track" aria-hidden>
            <div className="call-recording-load-bar" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !src) {
    return (
      <div className="call-recording-player call-recording-player--error">
        <p>{error || 'Recording could not be loaded.'}</p>
      </div>
    );
  }

  const progressPct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  return (
    <div className={`call-recording-shell${transcriptOpen ? ' is-transcript-open' : ''}`}>
      <motion.div
        className="call-recording-shell__player"
        layout
        transition={{ type: 'spring', stiffness: 420, damping: 36 }}
      >
        <audio
          ref={audioRef}
          src={src}
          preload="auto"
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
        />

        <div className="call-recording-deck">
          <button
            type="button"
            className="call-recording-deck__play"
            onClick={() => void togglePlay()}
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-0.5" />}
          </button>

          <div className="call-recording-deck__body">
            <div className="call-recording-deck__times">
              <span>{formatClock(currentTime)}</span>
              <span>{formatClock(duration)}</span>
            </div>
            <div
              ref={progressRef}
              className="call-recording-deck__progress"
              onPointerDown={onProgressPointerDown}
              role="slider"
              aria-valuemin={0}
              aria-valuemax={duration}
              aria-valuenow={currentTime}
              aria-label="Seek"
            >
              <div className="call-recording-deck__progress-rail" />
              <div className="call-recording-deck__progress-fill" style={{ width: `${progressPct}%` }} />
              <div className="call-recording-deck__progress-thumb" style={{ left: `${progressPct}%` }} />
            </div>
            <div className="call-recording-deck__meta">
              <div className="call-recording-deck__speeds">
                {SPEED_OPTIONS.map((rate) => (
                  <button
                    key={rate}
                    type="button"
                    className={`call-recording-deck__speed${speed === rate ? ' is-active' : ''}`}
                    onClick={() => setSpeed(rate)}
                  >
                    {rate}x
                  </button>
                ))}
              </div>
            </div>
          </div>

          {!transcriptOpen && (
            <motion.button
              type="button"
              className="call-recording-deck__transcribe"
              onClick={openTranscript}
              aria-label="Show 3CX transcript"
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.96 }}
              layoutId="transcribe-trigger"
            >
              <Captions size={17} strokeWidth={2.1} />
            </motion.button>
          )}
        </div>
      </motion.div>

      <AnimatePresence>
        {transcriptOpen && (
          <motion.aside
            className="call-recording-shell__transcript"
            initial={{ width: 0, opacity: 0, x: 12 }}
            animate={{ width: 320, opacity: 1, x: 0 }}
            exit={{ width: 0, opacity: 0, x: 12 }}
            transition={{ type: 'spring', stiffness: 380, damping: 34 }}
          >
            <div className="call-recording-transcript-panel">
              <div className="call-recording-transcript-panel__head">
                <motion.div className="call-recording-transcript-panel__icon" layoutId="transcribe-trigger">
                  <Captions size={15} strokeWidth={2.1} />
                </motion.div>
                <span className="call-recording-transcript-panel__label">Transcript</span>
                <button
                  type="button"
                  className="call-recording-transcript-panel__close"
                  onClick={() => setTranscriptOpen(false)}
                  aria-label="Close transcript"
                >
                  <X size={14} />
                </button>
              </div>
              <div className="call-recording-transcript-panel__body">
                {summary && !transcriptLoading && !transcriptError && (
                  <div className="call-recording-transcript-panel__summary">
                    <p className="call-recording-transcript-panel__summary-label">Summary</p>
                    <p>{summary}</p>
                  </div>
                )}
                <CallRecordingTranscript
                  transcript={transcript}
                  loading={transcriptLoading}
                  error={transcriptError}
                  statusMessage={transcriptStatus}
                  currentTime={currentTime}
                  onSeek={seekTo}
                />
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
};

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default CallRecordingPlayer;
