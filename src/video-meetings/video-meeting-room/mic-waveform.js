import { useMemo } from 'react';
import { Track } from 'livekit-client';
import { BarVisualizer, useLocalParticipant } from '@livekit/components-react';

const BAR_COUNT = 8;

export default function MicWaveform({ active }) {
  const { microphoneTrack, localParticipant } = useLocalParticipant();

  const trackRef = useMemo(() => {
    if (!active || !microphoneTrack || !localParticipant) return null;
    return {
      participant: localParticipant,
      source: Track.Source.Microphone,
      publication: microphoneTrack
    };
  }, [active, microphoneTrack, localParticipant]);

  if (!active || !trackRef) {
    return (
      <div className="vm-mic-waveform vm-mic-waveform--idle" aria-hidden>
        {Array.from({ length: BAR_COUNT }, (_, i) => (
          <span key={i} className="vm-mic-waveform-bar vm-mic-waveform-bar--idle" />
        ))}
      </div>
    );
  }

  return (
    <BarVisualizer
      className="vm-mic-waveform"
      trackRef={trackRef}
      barCount={BAR_COUNT}
      options={{ minHeight: 18, maxHeight: 100 }}
      aria-label="마이크 음성 입력 표시"
    />
  );
}
