import { useCallback, useEffect, useRef, useState } from 'react';
import './conference-lobby.css';

function getUserDisplayName() {
  try {
    const raw = localStorage.getItem('crm_user');
    const user = raw ? JSON.parse(raw) : null;
    return user?.name || user?.email || '참가자';
  } catch {
    return '참가자';
  }
}

export default function ConferenceLobby({
  meetingTitle,
  meetingId,
  loading,
  error,
  onJoin,
  onLeave
}) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [previewError, setPreviewError] = useState('');

  const stopStream = useCallback(() => {
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const startPreview = useCallback(async () => {
    stopStream();
    if (!camOn) return;
    try {
      // 대기실에서는 카메라만 미리보기 — 마이크는 LiveKit 입장 시 점유 (충돌 방지)
      const stream = await navigator.mediaDevices.getUserMedia({
        video: camOn,
        audio: false
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setPreviewError('');
    } catch (err) {
      setPreviewError('카메라·마이크 권한을 허용해 주세요.');
    }
  }, [camOn, stopStream]);

  useEffect(() => {
    startPreview();
    return () => stopStream();
  }, [startPreview, stopStream]);

  useEffect(() => {
    const stream = streamRef.current;
    if (!stream) return;
    stream.getVideoTracks().forEach((t) => {
      t.enabled = camOn;
    });
  }, [camOn]);

  const handleJoin = () => {
    stopStream();
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) {
        const ctx = new Ctx();
        void ctx.resume();
      }
    } catch (_) {
      /* ignore */
    }
    onJoin?.({ micOn, camOn });
  };

  const shortId = meetingId ? String(meetingId).slice(-8).toUpperCase() : '—';
  const displayName = getUserDisplayName();

  return (
    <div className="vm-lobby">
      <div className="vm-lobby-grid">
        <section className="vm-lobby-preview-wrap">
          <div className="vm-lobby-preview-card">
            {camOn ? (
              <video ref={videoRef} className="vm-lobby-video" playsInline muted autoPlay />
            ) : (
              <div className="vm-lobby-video-off">
                <span className="material-symbols-outlined" aria-hidden>
                  videocam_off
                </span>
                <p>카메라가 꺼져 있습니다</p>
              </div>
            )}
            <div className="vm-lobby-name-badge">
              <span className="material-symbols-outlined" aria-hidden>
                person
              </span>
              {displayName} (나)
            </div>
            <div className="vm-lobby-preview-controls">
              <button
                type="button"
                className={`vm-lobby-ctrl${micOn ? '' : ' vm-lobby-ctrl--off'}`}
                onClick={() => setMicOn((v) => !v)}
              >
                <span className="material-symbols-outlined" aria-hidden>
                  {micOn ? 'mic' : 'mic_off'}
                </span>
                <span>{micOn ? '마이크' : '음소거'}</span>
              </button>
              <button
                type="button"
                className={`vm-lobby-ctrl${camOn ? '' : ' vm-lobby-ctrl--off'}`}
                onClick={() => setCamOn((v) => !v)}
              >
                <span className="material-symbols-outlined" aria-hidden>
                  {camOn ? 'videocam' : 'videocam_off'}
                </span>
                <span>{camOn ? '카메라' : '카메라 끔'}</span>
              </button>
            </div>
          </div>
          {previewError ? <p className="vm-lobby-preview-error">{previewError}</p> : null}
        </section>

        <aside className="vm-lobby-side">
          <div className="vm-lobby-join-card">
            <h3>입장 준비</h3>
            <p className="vm-lobby-join-desc">
              <strong>{meetingTitle || '화상 회의'}</strong>에 참여합니다.
            </p>
            <p className="vm-lobby-meeting-id">
              <span className="vm-lobby-pulse" aria-hidden />
              회의 ID: {shortId}
            </p>
            {error ? (
              <p className="vm-lobby-error" role="alert">
                {error}
              </p>
            ) : null}
            <button
              type="button"
              className="vm-lobby-join-btn"
              onClick={handleJoin}
              disabled={loading || !!error}
            >
              {loading ? '연결 준비 중…' : '회의 입장'}
            </button>
          </div>

          <div className="vm-lobby-tips-card">
            <h4>입장 전 확인</h4>
            <ul>
              <li>마이크·카메라 상태를 미리 확인하세요.</li>
              <li>입장 후 하단에서 화면 공유·채팅을 사용할 수 있습니다.</li>
            </ul>
            <button type="button" className="vm-lobby-leave-btn" onClick={onLeave}>
              나가기
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
