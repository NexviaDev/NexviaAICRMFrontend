import { useState } from 'react';
import { API_BASE } from '@/config';
import { MERGE_RUNTIME_ADMIN_COMMON } from '@/lib/quotation-doc-merge-runtime';
import QuotationDocMerge from '@/quotation-doc-merge/quotation-doc-merge';
import './adminsubscription.css';

const ADMIN_TOKEN_KEY = 'admin_site_token';
const ADMIN_BOUND_USER_KEY = 'admin_site_bound_user_id';

function getCrmToken() {
  return localStorage.getItem('crm_token') || '';
}

function getStoredCrmUser() {
  try {
    const raw = localStorage.getItem('crm_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export default function AdminQuotationDocMerge() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState(() => localStorage.getItem(ADMIN_TOKEN_KEY) || '');
  const crmUser = getStoredCrmUser();
  const crmEmail = String(crmUser?.email || '').trim();
  const hasCrmToken = !!getCrmToken();
  const loggedIn = !!token;

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const crmToken = getCrmToken();
      if (!crmToken) {
        throw new Error('먼저 CRM에 로그인해 주세요.');
      }
      const res = await fetch(`${API_BASE}/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${crmToken}` },
        body: JSON.stringify({ password })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || '로그인에 실패했습니다.');
      }
      if (data.token) {
        localStorage.setItem(ADMIN_TOKEN_KEY, data.token);
        if (data.userId) localStorage.setItem(ADMIN_BOUND_USER_KEY, String(data.userId));
        setToken(data.token);
        setPassword('');
      }
    } catch (err) {
      setError(err.message || '로그인에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  if (!loggedIn) {
    return (
      <div className="admin-sub-page">
        <div className="admin-sub-card admin-sub-login-card">
          <h1 className="admin-sub-title">관리자 · 공통 문서 메일머지</h1>
          <p className="admin-sub-lead">
            기존 CRM 로그인 상태를 사용합니다. 관리자 비밀번호만 입력하면 됩니다.
          </p>
          <p className="admin-sub-current-user">
            현재 로그인 계정: <strong>{crmEmail || '확인 불가'}</strong>
          </p>
          <form onSubmit={handleLogin} className="admin-sub-form">
            <label className="admin-sub-label">
              비밀번호
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="admin-sub-input"
                required
              />
            </label>
            {error ? <p className="admin-sub-error">{error}</p> : null}
            <button type="submit" className="admin-sub-btn admin-sub-btn-primary" disabled={loading || !hasCrmToken}>
              {loading ? '확인 중…' : '로그인'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return <QuotationDocMerge runtime={MERGE_RUNTIME_ADMIN_COMMON} />;
}
