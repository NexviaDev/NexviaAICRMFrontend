import { useCallback, useEffect, useState } from 'react';
import { hasCrmSession, getCrmToken, getCrmAuthHeaders, crmFetchInit, markCrmSessionActive, clearCrmSessionLocal, logoutCrmSession } from '@/lib/crm-auth';

import { LiveKitRoom } from '@livekit/components-react';

import '@livekit/components-styles';

import ConferenceLobby from '../conference-lobby/conference-lobby';

import VideoConferencePanel from './video-conference-panel';

import './video-meeting-room.css';



import { API_BASE } from '@/config';



function formatElapsed(seconds) {

  const m = Math.floor(seconds / 60);

  const s = seconds % 60;

  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

}



function MeetingLiveHeader({ meetingTitle, onEndMeeting, ending }) {

  const [elapsed, setElapsed] = useState(0);



  useEffect(() => {

    const id = window.setInterval(() => setElapsed((v) => v + 1), 1000);

    return () => window.clearInterval(id);

  }, []);



  return (

    <header className="vm-live-header">

      <div className="vm-live-header-left">

        <span className="vm-live-pulse" aria-hidden />

        <div>

          <h2 className="vm-live-title">라이브 회의</h2>

          <p className="vm-live-meeting-name">{meetingTitle || '화상 회의'}</p>

        </div>

        <div className="vm-live-timer" aria-label="경과 시간">

          <span className="material-symbols-outlined" aria-hidden>

            timer

          </span>

          {formatElapsed(elapsed)}

        </div>

      </div>

      <div className="vm-live-header-actions">

        <button

          type="button"

          className="vm-live-btn-end"

          onClick={onEndMeeting}

          disabled={ending}

        >

          {ending ? '종료 중…' : '회의 종료'}

        </button>

      </div>

    </header>

  );

}



export default function VideoMeetingRoom({ meetingId, meetingTitle, onClose, onEnded }) {

  const [token, setToken] = useState('');

  const [livekitUrl, setLivekitUrl] = useState('');

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState('');

  const [ending, setEnding] = useState(false);

  const [joined, setJoined] = useState(false);
  const [joinMedia, setJoinMedia] = useState({ audio: true, video: true });
  const [deviceAlert, setDeviceAlert] = useState('');



  useEffect(() => {

    if (!meetingId) return;

    let cancelled = false;

    setLoading(true);

    setError('');

    setJoined(false);
    setJoinMedia({ audio: true, video: true });
    setDeviceAlert('');

    (async () => {

      try {

        const res = await fetch(`${API_BASE}/video-meetings/${encodeURIComponent(meetingId)}/token`, {

          method: 'POST',

          headers: { ...getCrmAuthHeaders(), 'Content-Type': 'application/json' }

        });

        const data = await res.json().catch(() => ({}));

        if (cancelled) return;

        if (!res.ok) {

          setError(data.error || '입장 토큰을 받지 못했습니다.');

          return;

        }

        const jwt = typeof data.token === 'string' ? data.token.trim() : '';

        setToken(jwt);

        setLivekitUrl(data.livekit?.livekitUrl || '');

        if (!jwt || !data.livekit?.livekitUrl) {

          setError('LiveKit 입장 토큰이 올바르지 않습니다. 백엔드를 재시작한 뒤 다시 시도해 주세요.');

        }

      } catch (_) {

        if (!cancelled) setError('네트워크 오류로 회의에 입장할 수 없습니다.');

      } finally {

        if (!cancelled) setLoading(false);

      }

    })();

    return () => {

      cancelled = true;

    };

  }, [meetingId]);



  const handleDisconnect = useCallback(() => {

    onClose?.();

  }, [onClose]);



  const handleEndMeeting = async () => {

    if (!meetingId || ending) return;

    if (!window.confirm('회의를 종료하면 모든 참가자가 퇴장합니다. 계속할까요?')) return;

    setEnding(true);

    try {

      const res = await fetch(`${API_BASE}/video-meetings/${encodeURIComponent(meetingId)}/end`, crmFetchInit({ method: 'PATCH' }));

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {

        window.alert(data.error || '회의 종료에 실패했습니다.');

        return;

      }

      onEnded?.();

      onClose?.();

    } catch (_) {

      window.alert('네트워크 오류로 회의를 종료하지 못했습니다.');

    } finally {

      setEnding(false);

    }

  };



  const showLobby = !joined;



  return (

    <div className="vm-room-overlay">

      <div className="vm-room-shell">

        {showLobby ? (

          <header className="vm-room-lobby-header">

            <div className="vm-room-lobby-header-main">

              <span className="material-symbols-outlined" aria-hidden>

                meeting_room

              </span>

              <div>

                <h2>회의 대기실</h2>

                <p>{meetingTitle || '화상 회의'}</p>

              </div>

            </div>

          </header>

        ) : (

          <MeetingLiveHeader

            meetingTitle={meetingTitle}

            onEndMeeting={handleEndMeeting}

            ending={ending}

          />

        )}



        <div className={`vm-room-body${joined ? ' vm-room-body--live' : ' vm-room-body--lobby'}`}>

          {showLobby ? (

            <ConferenceLobby

              meetingTitle={meetingTitle}

              meetingId={meetingId}

              loading={loading}

              error={error}

              onJoin={(prefs) => {
                if (!error && token && livekitUrl) {
                  setJoinMedia({
                    audio: prefs?.micOn !== false,
                    video: prefs?.camOn !== false
                  });
                  setJoined(true);
                }
              }}

              onLeave={onClose}

            />

          ) : loading ? (

            <div className="vm-room-status">

              <span className="vm-room-spinner" aria-hidden />

              회의실에 연결하는 중…

            </div>

          ) : error ? (

            <div className="vm-room-status vm-room-status--error" role="alert">

              {error}

            </div>

          ) : token && livekitUrl ? (

            <>
              {deviceAlert ? (
                <p className="vm-room-device-alert" role="alert">
                  {deviceAlert}
                </p>
              ) : null}
              <LiveKitRoom
                key={`${meetingId}-${token.slice(0, 12)}`}
                token={token}
                serverUrl={livekitUrl}
                connect
                audio={joinMedia.audio}
                video={joinMedia.video}
                onDisconnected={handleDisconnect}
                onMediaDeviceFailure={(failure, kind) => {
                  const label =
                    kind === 'audioinput'
                      ? '마이크'
                      : kind === 'videoinput'
                        ? '카메라'
                        : '미디어 장치';
                  const detail =
                    failure === 'PermissionDenied'
                      ? '브라우저 권한을 허용해 주세요.'
                      : failure === 'NotFound'
                        ? '장치를 찾을 수 없습니다.'
                        : '장치를 사용할 수 없습니다.';
                  setDeviceAlert(`${label} 오류: ${detail}`);
                }}
                className="vm-livekit-room"
              >
                <VideoConferencePanel
                  onLeave={onClose}
                  audioEnabled={joinMedia.audio}
                  videoEnabled={joinMedia.video}
                />
              </LiveKitRoom>
            </>

          ) : null}

        </div>

      </div>

    </div>

  );

}

