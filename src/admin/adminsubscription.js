import { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '@/config';
import { getAdminSiteFetchHeaders } from '@/lib/admin-site-headers';
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

function clearAdminSession() {
  localStorage.removeItem(ADMIN_TOKEN_KEY);
  localStorage.removeItem(ADMIN_BOUND_USER_KEY);
}

function formatDt(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return '—';
  }
}

export default function AdminSubscription() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [token, setToken] = useState(() => localStorage.getItem(ADMIN_TOKEN_KEY) || '');
  const [chargingId, setChargingId] = useState(null);
  const crmUser = getStoredCrmUser();
  const crmEmail = String(crmUser?.email || '').trim();
  const hasCrmToken = !!getCrmToken();

  const loggedIn = !!token;

  const loadList = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/admin/subscriptions`, { headers: getAdminSiteFetchHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) {
          clearAdminSession();
          setToken('');
          setError(data.error || '다시 로그인해 주세요.');
          return;
        }
        throw new Error(data.error || '목록을 불러오지 못했습니다.');
      }
      setRows(Array.isArray(data.rows) ? data.rows : []);
    } catch (e) {
      setError(e.message || '목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (loggedIn) loadList();
  }, [loggedIn, loadList]);

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

  const manualCharge = async (companyId) => {
    if (!window.confirm('해당 고객 건에 대해 수동으로 정기(월) 결제 1회를 진행합니다. 계속할까요?')) return;
    setChargingId(companyId);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/admin/subscriptions/${encodeURIComponent(companyId)}/manual-charge`, {
        method: 'POST',
        headers: getAdminSiteFetchHeaders()
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) {
          clearAdminSession();
          setToken('');
        }
        throw new Error(data.error || '수동 결제에 실패했습니다.');
      }
      await loadList();
      alert(`결제가 완료되었습니다.\n다음 정기일: ${formatDt(data.nextBillingAt)}`);
    } catch (err) {
      setError(err.message || '수동 결제에 실패했습니다.');
    } finally {
      setChargingId(null);
    }
  };

  if (!loggedIn) {
    return (
      <div className="admin-sub-page">
        <div className="admin-sub-card admin-sub-login-card">
          <h1 className="admin-sub-title">관리자 · 구독 결제</h1>
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
            {error && <p className="admin-sub-error">{error}</p>}
            <button type="submit" className="admin-sub-btn admin-sub-btn-primary" disabled={loading || !hasCrmToken}>
              {loading ? '확인 중…' : '로그인'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-sub-page">
      <header className="admin-sub-header">
        <div>
          <h1 className="admin-sub-title">구독 결제 현황</h1>
          <p className="admin-sub-sub">{crmEmail || '현재 로그인 계정 없음'}</p>
        </div>
      </header>

      <p className="admin-sub-hint">
        다음 정기 결제 예정일로부터 <strong>1개월(30일) 이상</strong> 지난 건에만 &quot;수동 결제&quot;를 사용할 수 있습니다. (자동 결제 실패·비활성 등 복구용)
      </p>

      {error && <p className="admin-sub-error admin-sub-error-banner">{error}</p>}

      <div className="admin-sub-table-wrap">
        {loading && rows.length === 0 ? (
          <p className="admin-sub-loading">불러오는 중…</p>
        ) : (
          <table className="admin-sub-table">
            <thead>
              <tr>
                <th>회사</th>
                <th>상태</th>
                <th>인원</th>
                <th>월 요금(안내)</th>
                <th>파트너 구매</th>
                <th>다음 정기 결제</th>
                <th>마지막 결제</th>
                <th>연체(일)</th>
                <th>수동 결제</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.companyId} className={r.manualEligible ? 'admin-sub-row-alert' : ''}>
                  <td>
                    <div className="admin-sub-co">{r.companyName}</div>
                    <div className="admin-sub-id">{r.companyId}</div>
                  </td>
                  <td>
                    <span className={`admin-sub-badge admin-sub-badge--${r.status === 'active' ? 'on' : 'off'}`}>
                      {r.status === 'active' ? 'active' : r.status}
                    </span>
                  </td>
                  <td>{r.seatCount}명</td>
                  <td>{r.planAmount?.toLocaleString('ko-KR')}원</td>
                  <td>
                    {r.partnerSellerCompanyName ? (
                      <span className="admin-sub-id" title={r.partnerSellerCompanyName}>
                        {r.partnerSellerCompanyName}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>{formatDt(r.nextBillingAt)}</td>
                  <td>{formatDt(r.lastBillingAt)}</td>
                  <td>{r.overdueDays > 0 ? `${r.overdueDays}일` : '—'}</td>
                  <td>
                    {r.manualEligible && r.hasBillingKey ? (
                      <button
                        type="button"
                        className="admin-sub-btn admin-sub-btn-action"
                        disabled={chargingId === r.companyId}
                        onClick={() => manualCharge(r.companyId)}
                      >
                        {chargingId === r.companyId ? '처리 중…' : '수동 결제하기'}
                      </button>
                    ) : (
                      <span className="admin-sub-dash">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="admin-sub-foot">Nexvia CRM 관리자 · 민감 정보 취급 주의</p>
    </div>
  );
}
