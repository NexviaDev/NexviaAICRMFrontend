import { useState, useEffect } from 'react';
import { getCrmAuthHeaders } from '@/lib/crm-auth';
import './company-drive-settings-modal.css';

import { API_BASE } from '@/config';

/**
 * 회사 연동 설정 모달
 * - 공유 드라이브 주소
 * - Gemini API 키 (내부 필드명 유지, UI는 「클라우드 AI」로 표기)
 */
export default function CompanyDriveSettingsModal({
  initialDriveRootUrl = '',
  onClose,
  onSaved
}) {
  const [driveRootUrl, setDriveRootUrl] = useState(initialDriveRootUrl);
  const [geminiApiKeyInput, setGeminiApiKeyInput] = useState('');
  const [hasGeminiApiKey, setHasGeminiApiKey] = useState(false);
  const [geminiApiKeyHint, setGeminiApiKeyHint] = useState('');
  const [clearGeminiKey, setClearGeminiKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingAi, setLoadingAi] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    setDriveRootUrl(initialDriveRootUrl);
  }, [initialDriveRootUrl]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingAi(true);
      try {
        const res = await fetch(`${API_BASE}/companies/ai-settings`, {
          headers: { ...getCrmAuthHeaders() },
          credentials: 'include'
        });
        const json = await res.json().catch(() => ({}));
        if (!cancelled && res.ok) {
          setHasGeminiApiKey(!!json.hasGeminiApiKey);
          setGeminiApiKeyHint(String(json.geminiApiKeyHint || '').trim());
        }
      } catch (_) {
        /* ignore */
      } finally {
        if (!cancelled) setLoadingAi(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
      const driveRes = await fetch(`${API_BASE}/custom-field-definitions/drive-root`, {
        method: 'PATCH',
        headers: { ...getCrmAuthHeaders(), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ driveRootUrl: driveRootUrl.trim() })
      });
      const driveJson = await driveRes.json().catch(() => ({}));
      if (!driveRes.ok) {
        setError(driveJson.error || '드라이브 주소 저장에 실패했습니다.');
        return;
      }
      const savedUrl = (driveJson.driveRootUrl != null ? String(driveJson.driveRootUrl) : '').trim();
      setDriveRootUrl(savedUrl);

      const shouldUpdateGemini = clearGeminiKey || geminiApiKeyInput.trim().length > 0;
      if (shouldUpdateGemini) {
        const aiRes = await fetch(`${API_BASE}/companies/ai-settings`, {
          method: 'PATCH',
          headers: { ...getCrmAuthHeaders(), 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            geminiApiKey: clearGeminiKey ? '' : geminiApiKeyInput.trim()
          })
        });
        const aiJson = await aiRes.json().catch(() => ({}));
        if (!aiRes.ok) {
          setError(aiJson.error || '클라우드 AI API 키 저장에 실패했습니다.');
          return;
        }
        setHasGeminiApiKey(!!aiJson.hasGeminiApiKey);
        setGeminiApiKeyHint(String(aiJson.geminiApiKeyHint || '').trim());
        setGeminiApiKeyInput('');
        setClearGeminiKey(false);
      }

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
            <span className="material-symbols-outlined">settings</span>
            회사 연동 설정
          </h2>
          <button type="button" className="company-drive-settings-close" onClick={onClose} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>
        <div className="company-drive-settings-body">
          <h3 className="company-drive-settings-section-title">전체 공유 드라이브 주소</h3>
          <p className="company-drive-settings-hint">
            직원 간 증서·자료 공유를 위해 회사에서 사용할 Google Drive 폴더(또는 공유 드라이브) 주소를 입력하세요. 설정 후 CRM에서 업로드한 파일이 이 루트 아래에 저장됩니다. 고객사 상세의 증서·자료 폴더는 이 루트 아래에{' '}
            <strong>[고객사명]_[사업자번호]</strong> 형식으로 만들어지며, 링크는 MongoDB 고객사 문서에 저장되어 다른 계정으로 로그인한 팀원에게도 동일하게 보입니다.
          </p>
          <p className="company-drive-settings-hint company-drive-settings-hint--sub">
            브라우저에서 해당 폴더를 연 뒤 <strong>주소창의 URL</strong>을 그대로 붙여 넣는 것을 권장합니다.
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
          </div>

          <h3 className="company-drive-settings-section-title company-drive-settings-section-title--gap">
            클라우드 AI API 키 (기술지원 도우미)
          </h3>
          <p className="company-drive-settings-hint">
            「로컬 AI 사용」을 끄면 이 회사 키로 클라우드 AI를 호출합니다. 키는 서버에 암호화되어 저장되며, 저장 후에는 전체 키를 다시 볼 수 없습니다. 개발사 관리 화면에도 평문이 노출되지 않습니다.
          </p>
          {loadingAi ? (
            <p className="company-drive-settings-hint company-drive-settings-hint--sub">키 상태 확인 중…</p>
          ) : (
            <p className="company-drive-settings-hint company-drive-settings-hint--sub">
              {hasGeminiApiKey
                ? `현재 저장됨${geminiApiKeyHint ? ` (${geminiApiKeyHint})` : ''}. 새 키를 입력하면 교체됩니다.`
                : '아직 저장되지 않았습니다. 발급받은 API 키를 입력하세요.'}
            </p>
          )}
          <div className="company-drive-settings-row">
            <input
              type="password"
              className="company-drive-settings-input"
              placeholder={hasGeminiApiKey ? '새 키로 교체하려면 입력' : 'API 키 입력'}
              value={geminiApiKeyInput}
              autoComplete="off"
              onChange={(e) => {
                setGeminiApiKeyInput(e.target.value);
                setClearGeminiKey(false);
                setError('');
                setSuccess(false);
              }}
              disabled={saving || clearGeminiKey}
            />
          </div>
          {hasGeminiApiKey ? (
            <label className="company-drive-settings-check">
              <input
                type="checkbox"
                checked={clearGeminiKey}
                onChange={(e) => {
                  setClearGeminiKey(e.target.checked);
                  if (e.target.checked) setGeminiApiKeyInput('');
                  setError('');
                  setSuccess(false);
                }}
                disabled={saving}
              />
              저장된 클라우드 AI API 키 삭제
            </label>
          ) : null}

          <div className="company-drive-settings-actions">
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
