import { useMemo } from 'react';
import { useParticipants } from '@livekit/components-react';

function getDisplayName(participant) {
  const name = participant?.name?.trim();
  if (name) return name;
  const identity = participant?.identity?.trim();
  if (identity) return identity;
  return '참가자';
}

function getInitial(name) {
  const ch = String(name || '?').trim().charAt(0);
  return ch ? ch.toUpperCase() : '?';
}

export default function ParticipantsPanel({ open, onClose }) {
  const participants = useParticipants();

  const sorted = useMemo(() => {
    return [...participants].sort((a, b) => {
      if (a.isLocal) return -1;
      if (b.isLocal) return 1;
      return getDisplayName(a).localeCompare(getDisplayName(b), 'ko');
    });
  }, [participants]);

  if (!open) return null;

  return (
    <aside className="vm-conf-participants vm-conf-participants--open" aria-label="참석자 목록">
      <header className="vm-conf-participants-header">
        <h3>참석자 ({sorted.length})</h3>
        <button type="button" className="vm-conf-participants-close" onClick={onClose} aria-label="닫기">
          <span className="material-symbols-outlined" aria-hidden>
            close
          </span>
        </button>
      </header>

      <ul className="vm-conf-participants-list">
        {sorted.map((participant) => {
          const name = getDisplayName(participant);
          const micOn = participant.isMicrophoneEnabled;
          const camOn = participant.isCameraEnabled;

          return (
            <li key={participant.identity} className="vm-conf-participant-row">
              <div className="vm-conf-participant-avatar" aria-hidden>
                {getInitial(name)}
              </div>
              <div className="vm-conf-participant-info">
                <div className="vm-conf-participant-name">
                  {name}
                  {participant.isLocal ? <span className="vm-conf-participant-me">나</span> : null}
                </div>
                <div className="vm-conf-participant-status">
                  <span className={micOn ? 'vm-conf-status-on' : 'vm-conf-status-off'}>
                    <span className="material-symbols-outlined" aria-hidden>
                      {micOn ? 'mic' : 'mic_off'}
                    </span>
                    {micOn ? '마이크 켜짐' : '음소거'}
                  </span>
                  <span className={camOn ? 'vm-conf-status-on' : 'vm-conf-status-off'}>
                    <span className="material-symbols-outlined" aria-hidden>
                      {camOn ? 'videocam' : 'videocam_off'}
                    </span>
                    {camOn ? '카메라 켜짐' : '카메라 꺼짐'}
                  </span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
