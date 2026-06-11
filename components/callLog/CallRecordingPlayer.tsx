import React from 'react';
import AudioPlayer from 'react-h5-audio-player';
import type H5AudioPlayer from 'react-h5-audio-player';
import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { transcribeRecordingLocally } from '../../services/callRecordingTranscribeLocal';
import {
  fetchCallRecordingStreamUrl,
  loadCachedRecordingTranscript,
  saveRecordingTranscript,
  type RecordingTranscript,
} from '../../services/threecxCallLogAdmin';
import CallRecordingTranscript from './CallRecordingTranscript';
import 'react-h5-audio-player/lib/styles.css';
import './call-recording-player.css';

const SPEED_OPTIONS = [1, 1.5, 2] as const;
type PlaybackSpeed = (typeof SPEED_OPTIONS)[number];

type CallRecordingPlayerProps = {
  callRecordId: string;
};

const CallRecordingPlayer: React.FC<CallRecordingPlayerProps> = ({ callRecordId }) => {
  const playerRef = React.useRef<H5AudioPlayer>(null);
  const objectUrlRef = React.useRef<string | null>(null);

  const [src, setSrc] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [speed, setSpeed] = React.useState<PlaybackSpeed>(1);
  const [currentTime, setCurrentTime] = React.useState(0);

  const [transcriptOpen, setTranscriptOpen] = React.useState(true);
  const [transcript, setTranscript] = React.useState<RecordingTranscript | null>(null);
  const [transcriptLoading, setTranscriptLoading] = React.useState(true);
  const [transcriptError, setTranscriptError] = React.useState<string | null>(null);
  const [transcriptStatus, setTranscriptStatus] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setLoading(true);
      setTranscriptLoading(true);
      setError(null);
      setTranscriptError(null);
      setTranscript(null);
      setTranscriptStatus(null);
      setSrc(null);

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

        let cached: RecordingTranscript | null = null;
        try {
          cached = await loadCachedRecordingTranscript(callRecordId);
        } catch {
          /* cache miss or API glitch — still try local transcription */
        }
        if (cancelled) return;
        if (cached) {
          setTranscript(cached);
          setTranscriptLoading(false);
          return;
        }

        setTranscriptStatus('Starting free local transcription…');
        const local = await transcribeRecordingLocally(blobUrl, (message) => {
          if (!cancelled) setTranscriptStatus(message);
        });
        if (cancelled) return;

        setTranscript(local);
        setTranscriptLoading(false);
        setTranscriptStatus(null);
        void saveRecordingTranscript(callRecordId, local).catch(() => {
          /* playback still works if save fails */
        });
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Recording could not be loaded.';
        if (!objectUrlRef.current) {
          setError(message);
          setLoading(false);
          setTranscriptLoading(false);
        } else {
          setTranscriptError(message);
          setTranscriptLoading(false);
        }
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
  }, [callRecordId]);

  React.useEffect(() => {
    const audio = playerRef.current?.audio.current;
    if (audio) audio.playbackRate = speed;
  }, [src, speed]);

  const applySpeed = (rate: PlaybackSpeed) => {
    setSpeed(rate);
    const audio = playerRef.current?.audio.current;
    if (audio) audio.playbackRate = rate;
  };

  const seekTo = (seconds: number) => {
    const audio = playerRef.current?.audio.current;
    if (!audio || !Number.isFinite(seconds)) return;
    audio.currentTime = seconds;
    setCurrentTime(seconds);
  };

  if (loading) {
    return (
      <div className="call-recording-player call-recording-player--loading">
        <Loader2 size={18} className="animate-spin text-[#005EB8]" />
        <div className="min-w-0">
          <span>Loading recording…</span>
          <div className="call-recording-load-track mt-2" aria-hidden>
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

  return (
    <div className="call-recording-player call-recording-player--with-transcript">
      <div className="call-recording-player__main">
        <AudioPlayer
          ref={playerRef}
          src={src}
          preload="auto"
          showJumpControls={false}
          customAdditionalControls={[]}
          customVolumeControls={[]}
          layout="horizontal-reverse"
          className="call-recording-player__h5"
          listenInterval={200}
          onListen={(e) => setCurrentTime(e.target.currentTime)}
          onPlayError={(err) => setError(err.message)}
        />
        <div className="call-recording-player__controls-row">
          <div className="call-recording-player__speeds">
            {SPEED_OPTIONS.map((rate) => (
              <button
                key={rate}
                type="button"
                className={`call-recording-player__speed${speed === rate ? ' is-active' : ''}`}
                onClick={() => applySpeed(rate)}
              >
                {rate}x
              </button>
            ))}
          </div>
          <button
            type="button"
            className="call-recording-player__transcript-toggle"
            onClick={() => setTranscriptOpen((open) => !open)}
          >
            {transcriptOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            {transcriptOpen ? 'Hide transcript' : 'Show transcript'}
          </button>
        </div>
      </div>

      {transcriptOpen && (
        <CallRecordingTranscript
          transcript={transcript}
          loading={transcriptLoading}
          error={transcriptError}
          statusMessage={transcriptStatus}
          currentTime={currentTime}
          onSeek={seekTo}
        />
      )}
    </div>
  );
};

export default CallRecordingPlayer;
