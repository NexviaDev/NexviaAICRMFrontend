import { useState } from 'react';
import './create-meeting-modal.css';

export default function CreateMeetingModal({ onClose, onCreated, creating }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setError('회의 제목을 입력해 주세요.');
      return;
    }
    setError('');
    await onCreated({ title: trimmed, description: description.trim() });
  };

  return (
    <div className="vm-create-overlay" role="presentation">
      <div
        className="vm-create-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vm-create-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="vm-create-header">
          <div>
            <h2 id="vm-create-title" className="vm-create-title">
              새 화상 회의
            </h2>
            <p className="vm-create-subtitle">회의 제목을 입력하고 바로 시작하세요.</p>
          </div>
          <button type="button" className="vm-create-close" onClick={onClose} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>

        <form className="vm-create-body" onSubmit={handleSubmit}>
          {error ? (
            <p className="vm-create-error" role="alert">
              {error}
            </p>
          ) : null}

          <label className="vm-create-field">
            <span className="vm-create-label">회의 제목 *</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="예: 주간 영업 회의"
              maxLength={120}
              autoFocus
              disabled={creating}
            />
          </label>

          <label className="vm-create-field">
            <span className="vm-create-label">설명 (선택)</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="회의 안건이나 참고 사항"
              rows={3}
              maxLength={500}
              disabled={creating}
            />
          </label>

          <footer className="vm-create-footer">
            <button type="button" className="vm-btn-cancel" onClick={onClose} disabled={creating}>
              취소
            </button>
            <button type="submit" className="vm-btn-submit" disabled={creating}>
              {creating ? '생성 중…' : '회의 시작'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
