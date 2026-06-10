import React, { useMemo } from 'react';
import AudioPlayer from 'react-h5-audio-player';
import 'react-h5-audio-player/lib/styles.css';
import './call-recording-player.css';

const CallRecordingPlayer: React.FC<{ url: string; durationHint?: number | null }> = ({
  url,
  durationHint,
}) => {
  const playerKey = useMemo(() => `${url}-${durationHint ?? 0}`, [url, durationHint]);

  return (
    <div className="call-recording-player-wrap">
      <AudioPlayer
        key={playerKey}
        src={url}
        preload="metadata"
        showJumpControls
        showSkipControls={false}
        showFilledProgress
        showDownloadProgress={false}
        defaultCurrentTime="--:--"
        defaultDuration={durationHint && durationHint > 0 ? formatClock(durationHint) : '--:--'}
        layout="horizontal-reverse"
        customAdditionalControls={[]}
        customVolumeControls={[]}
        progressJumpStep={10000}
        progressJumpSteps={{
          backward: 10000,
          forward: 10000,
        }}
        listenInterval={250}
      />
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="call-recording-open-link"
      >
        Open / download recording
      </a>
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
