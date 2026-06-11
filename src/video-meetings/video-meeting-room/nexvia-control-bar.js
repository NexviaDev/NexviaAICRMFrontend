import { useCallback, useEffect, useMemo, useState } from 'react';
import { Track } from 'livekit-client';
import { supportsScreenSharing } from '@livekit/components-core';
import {
  TrackToggle,
  ChatToggle,
  MediaDeviceMenu,
  useLocalParticipant,
  useLocalParticipantPermissions
} from '@livekit/components-react';
import MicWaveform from './mic-waveform';

export default function NexviaControlBar({
  onDeviceError,
  onLeave,
  chatOpen,
  participantsOpen,
  onToggleParticipants
}) {
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [sharing, setSharing] = useState(false);

  const permissions = useLocalParticipantPermissions();
  const { isMicrophoneEnabled } = useLocalParticipant();
  const canScreenShare = supportsScreenSharing();

  useEffect(() => {
    setMicOn(isMicrophoneEnabled);
  }, [isMicrophoneEnabled]);

  const canUseMedia = useMemo(() => {
    if (!permissions) return false;
    return Boolean(permissions.canPublish);
  }, [permissions]);

  const canChat = useMemo(() => {
    if (!permissions) return false;
    return permissions.canPublishData !== false;
  }, [permissions]);

  const onMicChange = useCallback((enabled) => setMicOn(enabled), []);
  const onCamChange = useCallback((enabled) => setCamOn(enabled), []);
  const onShareChange = useCallback((enabled) => setSharing(enabled), []);

  if (!canUseMedia) {
    return (
      <footer className="vm-conf-control-bar" />
    );
  }

  return (
    <footer className="vm-conf-control-bar" role="toolbar" aria-label="회의 도구">
      <div className="vm-conf-control-left">
        <div className="vm-conf-control-group vm-conf-control-group--mic">
          <TrackToggle
            className="vm-conf-ctrl-btn"
            source={Track.Source.Microphone}
            showIcon={false}
            onChange={onMicChange}
            onDeviceError={(error) => onDeviceError?.({ source: Track.Source.Microphone, error })}
            title={micOn ? '마이크 끄기' : '마이크 켜기'}
          >
            <span className="material-symbols-outlined" aria-hidden>
              {micOn ? 'mic' : 'mic_off'}
            </span>
            <span className="vm-conf-ctrl-label">{micOn ? '마이크' : '음소거'}</span>
          </TrackToggle>
          <MicWaveform active={micOn} />
          <MediaDeviceMenu kind="audioinput" className="vm-conf-device-menu" />
        </div>

        <div className="vm-conf-control-group">
          <TrackToggle
            className="vm-conf-ctrl-btn"
            source={Track.Source.Camera}
            showIcon={false}
            onChange={onCamChange}
            onDeviceError={(error) => onDeviceError?.({ source: Track.Source.Camera, error })}
            title={camOn ? '카메라 끄기' : '카메라 켜기'}
          >
            <span className="material-symbols-outlined" aria-hidden>
              {camOn ? 'videocam' : 'videocam_off'}
            </span>
            <span className="vm-conf-ctrl-label">{camOn ? '카메라' : '카메라 끔'}</span>
          </TrackToggle>
          <MediaDeviceMenu kind="videoinput" className="vm-conf-device-menu" />
        </div>
      </div>

      <div className="vm-conf-control-center">
        {canScreenShare ? (
          <TrackToggle
            className={`vm-conf-ctrl-btn vm-conf-ctrl-btn--primary${sharing ? ' vm-conf-ctrl-btn--active' : ''}`}
            source={Track.Source.ScreenShare}
            captureOptions={{ audio: true, selfBrowserSurface: 'include' }}
            showIcon={false}
            onChange={onShareChange}
            onDeviceError={(error) => onDeviceError?.({ source: Track.Source.ScreenShare, error })}
            title={sharing ? '화면 공유 중지' : '화면 공유'}
          >
            <span className="material-symbols-outlined" aria-hidden>
              {sharing ? 'stop_screen_share' : 'present_to_all'}
            </span>
            <span className="vm-conf-ctrl-label">{sharing ? '공유 중지' : '화면 공유'}</span>
          </TrackToggle>
        ) : null}

        <button
          type="button"
          className={`vm-conf-ctrl-btn${participantsOpen ? ' vm-conf-ctrl-btn--active' : ''}`}
          onClick={onToggleParticipants}
          title="참석자"
        >
          <span className="material-symbols-outlined" aria-hidden>
            group
          </span>
          <span className="vm-conf-ctrl-label">참석자</span>
        </button>

        {canChat ? (
          <ChatToggle
            className={`vm-conf-ctrl-btn${chatOpen ? ' vm-conf-ctrl-btn--active' : ''}`}
            title="채팅"
          >
            <span className="material-symbols-outlined" aria-hidden>
              chat
            </span>
            <span className="vm-conf-ctrl-label">채팅</span>
          </ChatToggle>
        ) : null}
      </div>

      <div className="vm-conf-control-right">
        <button type="button" className="vm-conf-leave-btn" onClick={onLeave} title="나가기">
          <span className="material-symbols-outlined" aria-hidden>
            call_end
          </span>
          <span>나가기</span>
        </button>
      </div>

    </footer>
  );
}
