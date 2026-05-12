import { useState, useEffect } from 'react';
import { API_BASE } from '@/config';
import { pingBackendHealth } from '@/lib/backend-wake';
import { formatPhone, phoneDigitsOnly } from '@/register/phoneFormat';
import './find-id-modal.css';

export default function FindIdModal({ open, onClose }) {
  const [companyName, setCompanyName] = useState('');
  const [businessNumber, setBusinessNumber] = useState('');
  const [personName, setPersonName] = useState('');
  const [phone, setPhone] = useState('');
  const [maskedEmails, setMaskedEmails] = useState([]);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [searchAttempted, setSearchAttempted] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCompanyName('');
    setBusinessNumber('');
    setPersonName('');
    setPhone('');
    setMaskedEmails([]);
    setTruncated(false);
    setError('');
    setLoading(false);
    setSearchAttempted(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const handlePhoneChange = (value) => {
    setPhone(formatPhone(value));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setMaskedEmails([]);
    setTruncated(false);
    const c = companyName.trim();
    const bn = businessNumber.replace(/\D/g, '');
    const n = personName.trim();
    const pd = phoneDigitsOnly(phone);
    if (!c) {
      setError('회사명을 입력해 주세요.');
      return;
    }
    if (bn.length < 8) {
      setError('사업자 번호를 입력해 주세요.');
      return;
    }
    if (!n) {
      setError('이름을 입력해 주세요.');
      return;
    }
    if (pd.length < 9) {
      setError('연락처를 입력해 주세요.');
      return;
    }
    setLoading(true);
    try {
      await pingBackendHealth();
      const res = await fetch(`${API_BASE}/auth/find-id`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: c,
          businessNumber,
          name: n,
          phone: pd
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || '조회에 실패했습니다.');
        setSearchAttempted(false);
        return;
      }
      setSearchAttempted(true);
      const list = Array.isArray(data.maskedEmails) ? data.maskedEmails : [];
      setMaskedEmails(list);
      setTruncated(!!data.truncated);
    } catch (_) {
      setError('서버에 연결할 수 없습니다.');
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="find-id-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="find-id-modal-title">
      <div className="find-id-modal-panel">
        <header className="find-id-modal-header">
          <h2 id="find-id-modal-title" className="find-id-modal-title">
            아이디 찾기
          </h2>
          <button type="button" className="find-id-modal-close" onClick={onClose} aria-label="닫기">
            <span className="material-symbols-outlined" aria-hidden>close</span>
          </button>
        </header>
        <div className="find-id-modal-body">
          <p className="find-id-modal-desc">
            가입 시 등록한 회사명, 사업자 번호, 이름, 연락처가 모두 일치하면 로그인 아이디(이메일) 앞부분만 일부 표시합니다.
          </p>
          {error && <p className="find-id-modal-error">{error}</p>}
          <form onSubmit={handleSubmit} className="find-id-modal-form">
            <label className="find-id-modal-label" htmlFor="find-id-company">회사명 *</label>
            <input
              id="find-id-company"
              type="text"
              className="find-id-modal-input"
              value={companyName}
              onChange={(ev) => setCompanyName(ev.target.value)}
              autoComplete="organization"
              disabled={loading}
            />
            <label className="find-id-modal-label" htmlFor="find-id-biz">사업자 번호 *</label>
            <input
              id="find-id-biz"
              type="text"
              className="find-id-modal-input"
              inputMode="numeric"
              value={businessNumber}
              onChange={(ev) => setBusinessNumber(ev.target.value.replace(/[^\d-]/g, ''))}
              placeholder="123-45-67890"
              disabled={loading}
            />
            <label className="find-id-modal-label" htmlFor="find-id-name">이름 *</label>
            <input
              id="find-id-name"
              type="text"
              className="find-id-modal-input"
              value={personName}
              onChange={(ev) => setPersonName(ev.target.value)}
              autoComplete="name"
              disabled={loading}
            />
            <label className="find-id-modal-label" htmlFor="find-id-phone">연락처 *</label>
            <input
              id="find-id-phone"
              type="tel"
              className="find-id-modal-input"
              value={phone}
              onChange={(ev) => handlePhoneChange(ev.target.value)}
              placeholder="010-1234-5678"
              autoComplete="tel"
              disabled={loading}
            />
            <button type="submit" className="find-id-modal-submit" disabled={loading}>
              {loading ? <span className="find-id-modal-spinner" aria-hidden /> : null}
              {loading ? '조회 중…' : '아이디 조회'}
            </button>
          </form>
          {maskedEmails.length > 0 ? (
            <div className="find-id-modal-results" role="region" aria-label="조회 결과">
              <p className="find-id-modal-results-title">일치하는 로그인 아이디</p>
              <ul className="find-id-modal-result-list">
                {maskedEmails.map((m, idx) => (
                  <li key={`${m}-${idx}`} className="find-id-modal-result-item">{m}</li>
                ))}
              </ul>
              {truncated ? (
                <p className="find-id-modal-results-note">표시는 최대 20건까지입니다. 관리자에게 문의해 주세요.</p>
              ) : null}
            </div>
          ) : null}
          {searchAttempted && maskedEmails.length === 0 && !error ? (
            <p className="find-id-modal-info">일치하는 계정이 없습니다. 입력 정보를 다시 확인해 주세요.</p>
          ) : null}
          {!searchAttempted ? (
            <p className="find-id-modal-empty-hint">위 네 가지를 가입 시와 동일하게 입력한 뒤 조회해 주세요.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
