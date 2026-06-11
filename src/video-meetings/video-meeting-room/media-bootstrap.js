import { useEffect } from 'react';
import { ConnectionState, RoomEvent } from 'livekit-client';
import { useRoomContext } from '@livekit/components-react';

/**
 * 입장 직후 마이크·카메라 발행을 한 번 더 보장하고, 원격 음성 재생을 시도합니다.
 */
export default function MediaBootstrap({ audioEnabled, videoEnabled }) {
  const room = useRoomContext();

  useEffect(() => {
    if (!room) return;

    const ensurePublish = async () => {
      const local = room.localParticipant;
      try {
        if (audioEnabled) {
          await local.setMicrophoneEnabled(true, {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          });
        }
        if (videoEnabled) {
          await local.setCameraEnabled(true);
        }
      } catch (_) {
        /* TrackToggle·device error UI에서 안내 */
      }

      try {
        if (typeof room.startAudio === 'function') {
          await room.startAudio();
        }
      } catch (_) {
        /* StartMediaButton으로 대체 */
      }
    };

    if (room.state === ConnectionState.Connected) {
      ensurePublish();
    }

    room.on(RoomEvent.Connected, ensurePublish);
    return () => {
      room.off(RoomEvent.Connected, ensurePublish);
    };
  }, [room, audioEnabled, videoEnabled]);

  return null;
}
