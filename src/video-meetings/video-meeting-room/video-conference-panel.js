import { useEffect, useRef, useState } from 'react';
import { RoomEvent, Track } from 'livekit-client';
import { isEqualTrackRef, isTrackReference, isWeb } from '@livekit/components-core';
import {
  CarouselLayout,
  Chat,
  ConnectionStateToast,
  FocusLayout,
  FocusLayoutContainer,
  GridLayout,
  LayoutContextProvider,
  ParticipantTile,
  RoomAudioRenderer,
  useCreateLayoutContext,
  usePinnedTracks,
  useTracks
} from '@livekit/components-react';
import NexviaControlBar from './nexvia-control-bar';
import ParticipantsPanel from './participants-panel';
import MediaBootstrap from './media-bootstrap';
import AudioPlaybackPrompt from './audio-playback-prompt';

export default function VideoConferencePanel({ onLeave, audioEnabled = true, videoEnabled = true }) {
  const [widgetState, setWidgetState] = useState({
    showChat: false,
    unreadMessages: 0,
    showSettings: false
  });
  const [showParticipants, setShowParticipants] = useState(false);
  const [deviceError, setDeviceError] = useState('');
  const lastAutoFocusedScreenShareTrack = useRef(null);

  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false }
    ],
    { updateOnlyOn: [RoomEvent.ActiveSpeakersChanged], onlySubscribed: false }
  );

  const layoutContext = useCreateLayoutContext();
  const screenShareTracks = tracks
    .filter(isTrackReference)
    .filter((track) => track.publication.source === Track.Source.ScreenShare);
  const focusTrack = usePinnedTracks(layoutContext)?.[0];
  const carouselTracks = tracks.filter((track) => !isEqualTrackRef(track, focusTrack));

  useEffect(() => {
    if (
      screenShareTracks.some((track) => track.publication.isSubscribed) &&
      lastAutoFocusedScreenShareTrack.current === null
    ) {
      layoutContext.pin.dispatch?.({ msg: 'set_pin', trackReference: screenShareTracks[0] });
      lastAutoFocusedScreenShareTrack.current = screenShareTracks[0];
    } else if (
      lastAutoFocusedScreenShareTrack.current &&
      !screenShareTracks.some(
        (track) =>
          track.publication.trackSid ===
          lastAutoFocusedScreenShareTrack.current?.publication?.trackSid
      )
    ) {
      layoutContext.pin.dispatch?.({ msg: 'clear_pin' });
      lastAutoFocusedScreenShareTrack.current = null;
    }
    if (focusTrack && !isTrackReference(focusTrack)) {
      const updatedFocusTrack = tracks.find(
        (tr) =>
          tr.participant.identity === focusTrack.participant.identity &&
          tr.source === focusTrack.source
      );
      if (updatedFocusTrack !== focusTrack && isTrackReference(updatedFocusTrack)) {
        layoutContext.pin.dispatch?.({ msg: 'set_pin', trackReference: updatedFocusTrack });
      }
    }
  }, [
    screenShareTracks
      .map((ref) => `${ref.publication.trackSid}_${ref.publication.isSubscribed}`)
      .join(),
    focusTrack?.publication?.trackSid,
    tracks,
    layoutContext.pin
  ]);

  useEffect(() => {
    if (!widgetState.showChat) return;
    setShowParticipants(false);
    const input = document.querySelector('.vm-conf-chat .lk-chat-form-input');
    if (input) {
      input.placeholder = '메시지를 입력하세요…';
    }
  }, [widgetState.showChat]);

  const handleToggleParticipants = () => {
    setShowParticipants((prev) => {
      const next = !prev;
      if (next) {
        layoutContext.widget.dispatch?.({ msg: 'hide_chat' });
      }
      return next;
    });
  };

  const handleDeviceError = ({ source, error }) => {
    const label =
      source === Track.Source.Microphone
        ? '마이크'
        : source === Track.Source.Camera
          ? '카메라'
          : '화면 공유';
    setDeviceError(`${label} 오류: ${error?.message || '장치를 사용할 수 없습니다.'}`);
  };

  if (!isWeb()) {
    return <p className="vm-conf-unsupported">이 브라우저에서는 화상 회의를 지원하지 않습니다.</p>;
  }

  const chatOpen = widgetState.showChat;
  const sidePanelOpen = chatOpen || showParticipants;

  return (
    <div
      className={`vm-conf-panel lk-video-conference${sidePanelOpen ? ' vm-conf-panel--side-open' : ''}`}
      data-lk-theme="default"
    >
      <LayoutContextProvider value={layoutContext} onWidgetChange={setWidgetState}>
        <div className="lk-video-conference-inner vm-conf-inner">
          <div className="vm-conf-stage">
            {!focusTrack ? (
              <div className="lk-grid-layout-wrapper vm-conf-grid-wrap">
                <GridLayout tracks={tracks}>
                  <ParticipantTile />
                </GridLayout>
              </div>
            ) : (
              <div className="lk-focus-layout-wrapper vm-conf-focus-wrap">
                <FocusLayoutContainer>
                  <CarouselLayout tracks={carouselTracks}>
                    <ParticipantTile />
                  </CarouselLayout>
                  {focusTrack ? <FocusLayout trackRef={focusTrack} /> : null}
                </FocusLayoutContainer>
              </div>
            )}
          </div>

          {deviceError ? (
            <p className="vm-conf-device-error" role="alert">
              {deviceError}
            </p>
          ) : null}

          <NexviaControlBar
            onDeviceError={handleDeviceError}
            onLeave={onLeave}
            chatOpen={chatOpen}
            participantsOpen={showParticipants}
            onToggleParticipants={handleToggleParticipants}
          />
        </div>

        <Chat
          className={`vm-conf-chat${chatOpen ? ' vm-conf-chat--open' : ''}`}
          style={{ display: chatOpen ? 'grid' : 'none' }}
        />

        <ParticipantsPanel
          open={showParticipants}
          onClose={() => setShowParticipants(false)}
        />
      </LayoutContextProvider>

      <MediaBootstrap audioEnabled={audioEnabled} videoEnabled={videoEnabled} />
      <AudioPlaybackPrompt />
      <RoomAudioRenderer />
      <ConnectionStateToast />
    </div>
  );
}
