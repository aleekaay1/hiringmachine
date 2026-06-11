import React from 'react';
import AudioPlayer from 'react-h5-audio-player';
import type H5AudioPlayer from 'react-h5-audio-player';
import { Loader2 } from 'lucide-react';
import { fetchCallRecordingStreamUrl } from '../../services/threecxCallLogAdmin';
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

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSrc(null);

    void fetchCallRecordingStreamUrl(callRecordId)
      .then((blobUrl) => {
        if (cancelled) {
          URL.revokeObjectURL(blobUrl);
          return;
        }
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = blobUrl;
        setSrc(blobUrl);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Recording could not be loaded.');
        setLoading(false);
      });

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

  if (loading) {
    return (
      <div className="call-recording-player call-recording-player--loading">
        <Loader2 size={18} className="animate-spin text-[#005EB8]" />
        <span>Loading recording…</span>
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
    <div className="call-recording-player">
      <AudioPlayer
        ref={playerRef}
        src={src}
        preload="auto"
        showJumpControls={false}
        customAdditionalControls={[]}
        customVolumeControls={[]}
        layout="horizontal-reverse"
        className="call-recording-player__h5"
        onPlayError={(err) => setError(err.message)}
      />
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
    </div>
  );
};

export default CallRecordingPlayer;
