import { useState, useEffect, useMemo, useCallback } from 'react';
import './participant-modal.css';

export default function ParticipantModal({ teamMembers, selected, currentUser, onConfirm, onClose }) {
  const [localSelected, setLocalSelected] = useState(selected || []);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const url = new URL(window.location);
    url.searchParams.set('participantModal', '1');
    window.history.pushState({}, '', url);

    const onPop = () => onClose?.();
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      const u = new URL(window.location);
      if (u.searchParams.has('participantModal')) {
        u.searchParams.delete('participantModal');
        window.history.replaceState({}, '', u);
      }
    };
  }, [onClose]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggle = useCallback((member) => {
    setLocalSelected((prev) => {
      const exists = prev.some((p) => p.userId === member._id);
      if (exists) return prev.filter((p) => p.userId !== member._id);
      return [...prev, { userId: member._id, name: member.name || member.email }];
    });
  }, []);

  const removeChip = useCallback((userId) => {
    setLocalSelected((prev) => prev.filter((p) => p.userId !== userId));
  }, []);

  const filtered = useMemo(() => {
    return teamMembers.filter((m) => {
      if (currentUser && m._id === currentUser._id) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (m.name || '').toLowerCase().includes(q) || (m.email || '').toLowerCase().includes(q);
    });
  }, [teamMembers, currentUser, search]);

  const handleConfirm = () => {
    onConfirm?.(localSelected);
    if (window.history.state && new URL(window.location).searchParams.has('participantModal')) {
      window.history.back();
    } else {
      onClose?.();
    }
  };

  const handleCancel = () => {
    if (window.history.state && new URL(window.location).searchParams.has('participantModal')) {
      window.history.back();
    } else {
      onClose?.();
    }
  };

  return (
    <div className="participant-modal-overlay">
      <div className="participant-modal" onClick={(e) => e.stopPropagation()}>

        <div className="participant-modal-header">
          <h3>참여자 선택</h3>
          <button type="button" className="participant-modal-close" onClick={handleCancel} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="participant-modal-body">
          {localSelected.length > 0 && (
            <div className="participant-modal-chips">
              {localSelected.map((p) => (
                <span key={p.userId} className="participant-modal-chip" onClick={() => removeChip(p.userId)}>
                  {p.name || '(이름 없음)'} <span className="chip-x">✕</span>
                </span>
              ))}
            </div>
          )}

          <div className="participant-modal-search-wrap">
            <span className="material-symbols-outlined participant-modal-search-icon">search</span>
            <input
              type="text"
              className="participant-modal-search"
              placeholder="이름 또는 이메일로 검색…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </div>

          <div className="participant-modal-list">
            {filtered.length === 0 && (
              <p className="participant-modal-empty">선택 가능한 팀원이 없습니다.</p>
            )}
            {filtered.map((m) => {
              const checked = localSelected.some((p) => p.userId === m._id);
              return (
                <label key={m._id} className={`participant-modal-item${checked ? ' checked' : ''}`}>
                  <input type="checkbox" checked={checked} onChange={() => toggle(m)} />
                  <span className="participant-modal-avatar">
                    {(m.name || m.email || '?').charAt(0)}
                  </span>
                  <span className="participant-modal-info">
                    <span className="participant-modal-name">{m.name || '(이름 없음)'}</span>
                    <span className="participant-modal-email">{m.email}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        <div className="participant-modal-footer">
          <span className="participant-modal-count">
            {localSelected.length}명 선택됨
          </span>
          <div className="participant-modal-actions">
            <button type="button" className="participant-modal-btn cancel" onClick={handleCancel}>취소</button>
            <button type="button" className="participant-modal-btn confirm" onClick={handleConfirm}>확인</button>
          </div>
        </div>
      </div>
    </div>
  );
}
