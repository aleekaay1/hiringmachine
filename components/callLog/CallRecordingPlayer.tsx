import React from 'react';
import './call-recording-player.css';

const CallRecordingPlayer: React.FC<{ url: string; durationHint?: number | null }> = ({
  url,
}) => {
  return (
    <div className="call-recording-player-wrap">
      <audio controls preload="metadata" className="call-recording-native" src={url}>
        <a href={url} target="_blank" rel="noopener noreferrer">
          Open recording
        </a>
      </audio>
    </div>
  );
};

export default CallRecordingPlayer;
