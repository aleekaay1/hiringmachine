import React from 'react';
import { Loader2 } from 'lucide-react';
import type { RecordingTranscript } from '../../services/threecxCallLogAdmin';

type CallRecordingTranscriptProps = {
  transcript: RecordingTranscript | null;
  loading: boolean;
  error: string | null;
  statusMessage?: string | null;
  currentTime: number;
  onSeek: (seconds: number) => void;
};

const CallRecordingTranscript: React.FC<CallRecordingTranscriptProps> = ({
  transcript,
  loading,
  error,
  statusMessage,
  currentTime,
  onSeek,
}) => {
  const activeRef = React.useRef<HTMLButtonElement | null>(null);

  const activeIndex = React.useMemo(() => {
    if (!transcript?.segments.length) return -1;
    return transcript.segments.findIndex(
      (seg) => currentTime >= seg.start && currentTime < seg.end,
    );
  }, [transcript, currentTime]);

  React.useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [activeIndex]);

  if (loading) {
    return (
      <div className="call-recording-transcript call-recording-transcript--loading">
        <Loader2 size={18} className="call-recording-transcript__spinner" />
        <div className="min-w-0">
          <p className="call-recording-transcript__title">Transcribing your call</p>
          <p className="call-recording-transcript__subtitle">
            {statusMessage || 'This runs on your computer and may take a minute.'}
          </p>
          <div className="call-recording-transcript__track" aria-hidden>
            <div className="call-recording-transcript__bar" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="call-recording-transcript call-recording-transcript--error">
        <p className="call-recording-transcript__title">Couldn&apos;t transcribe</p>
        <p className="call-recording-transcript__subtitle">{error}</p>
      </div>
    );
  }

  if (!transcript?.text) {
    return (
      <div className="call-recording-transcript call-recording-transcript--empty">
        <p className="call-recording-transcript__subtitle">No speech detected in this recording.</p>
      </div>
    );
  }

  if (!transcript.segments.length) {
    return (
      <div className="call-recording-transcript">
        <p className="call-recording-transcript__plain">{transcript.text}</p>
      </div>
    );
  }

  return (
    <div className="call-recording-transcript">
      <div className="call-recording-transcript__segments">
        {transcript.segments.map((seg, index) => {
          const active = index === activeIndex;
          return (
            <button
              key={`${seg.start}-${index}`}
              ref={active ? activeRef : null}
              type="button"
              onClick={() => onSeek(seg.start)}
              className={`call-recording-transcript__segment${active ? ' is-active' : ''}`}
            >
              <span className="call-recording-transcript__time">
                {formatSegmentTime(seg.start)}
              </span>
              <span>{seg.text}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

function formatSegmentTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default CallRecordingTranscript;
