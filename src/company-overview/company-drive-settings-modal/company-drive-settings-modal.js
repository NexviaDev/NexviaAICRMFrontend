import { useState, useEffect } from 'react';
import './company-drive-settings-modal.css';

import { API_BASE } from '@/config';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * 전체 공유 드라이브 주소 설정 모달
 * - initialDriveRootUrl: 초기 값 (회사 overview에서 전달)
 * - onClose: 닫기 콜백
 * - onSaved: 저장 성공 시 (driveRootUrl) => void
 */
export default function CompanyDriveSettingsModal({
  initialDriveRootUrl = '',
  onClose,
  onSaved
}) {
  const [driveRootUrl, setDriveRootUrl] = useState(initialDriveRootUrl);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    setDriveRootUrl(initialDriveRootUrl);
  }, [initialDriveRootUrl]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleSave = async () => {
    setError('');
    setSuccess(false);
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/custom-field-definitions/drive-root`, {
        method: 'PATCH',
        headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ driveRootUrl: driveRootUrl.trim() })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || '저장에 실패했습니다.');
        return;
      }
      const savedUrl = (json.driveRootUrl != null ? String(json.driveRootUrl) : '').trim();
      setDriveRootUrl(savedUrl);
      setSuccess(true);
      onSaved?.(savedUrl);
    } catch (e) {
      setError(e.message || '저장 중 오류가 났습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="company-drive-settings-overlay" onClick={onClose} aria-hidden="true" />
      <div className="company-drive-settings-modal" onClick={(e) => e.stopPropagation()}>
      <header className="company-drive-settings-header">
        <h2 className="company-drive-settings-title">
          <span className="material-symbols-outlined">folder</span>
          전체 공유 드라이브 주소
        </h2>
        <button type="button" className="company-drive-settings-close" onClick={onClose} aria-label="닫기">
          <span className="material-symbols-outlined">close</span>
        </button>
      </header>
      <div className="company-drive-settings-body">
        <p className="company-drive-settings-hint">
          직원 간 증서·자료 공유를 위해 회사에서 사용할 Google Drive 폴더(또는 공유 드라이브) 주소를 입력하세요. 설정 후 CRM에서 업로드한 파일이 이 루트 아래에 저장됩니다. 고객사 상세의 증서·자료 폴더는 이 루트 아래에{' '}
          <strong>[고객사명]_[사업자번호]</strong> 형식으로 만들어지며, 링크는 MongoDB 고객사 문서에 저장되어 다른 계정으로 로그인한 팀원에게도 동일하게 보입니다.
        </p>
        <p className="company-drive-settings-hint company-drive-settings-hint--sub">
          브라우저에서 해당 폴더를 연 뒤 <strong>주소창의 URL</strong>을 그대로 붙여 넣는 것을 권장합니다. 이 설정이 비어 있거나 ID를 읽을 수 없으면, 예전에는 「내 드라이브」 최상위에 폴더가 생겨 <strong>개인 휴지통</strong>에만 보이는 것처럼 느껴질 수 있습니다.
        </p>
        <p className="company-drive-settings-hint company-drive-settings-hint--sub">
          <strong>팀원이 같은 폴더·파일을 보려면</strong> 각자의 Google 계정이 이 공유 드라이브에 <strong>멤버로 추가</strong>되어 있어야 합니다(Workspace 관리자 또는 드라이브 관리 권한이 있는 사람이 Drive 웹에서 멤버 초대). 멤버가 아니면 CRM에 링크가 있어도 다른 사람 화면에서는 비어 있거나 404에 가깝게 보일 수 있습니다.
        </p>
        <div className="company-drive-settings-row">
          <input
            type="url"
            className="company-drive-settings-input"
            placeholder="https://drive.google.com/drive/folders/..."
            value={driveRootUrl}
            onChange={(e) => {
              setDriveRootUrl(e.target.value);
              setError('');
              setSuccess(false);
            }}
            disabled={saving}
          />
          <button
            type="button"
            className="company-drive-settings-save"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
        {error && <p className="company-drive-settings-error">{error}</p>}
        {success && <p className="company-drive-settings-success">저장되었습니다.</p>}
      </div>
    </div>
  </>
  );
}
