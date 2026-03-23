import { useEffect, useMemo, useState } from 'react';
import { API_BASE } from '@/config';
import { getAdminSiteFetchHeaders } from '@/lib/admin-site-headers';
import './adminsubscription.css';

const ADMIN_TOKEN_KEY = 'admin_site_token';
const ADMIN_BOUND_USER_KEY = 'admin_site_bound_user_id';

function clearAdminSession() {
  localStorage.removeItem(ADMIN_TOKEN_KEY);
  localStorage.removeItem(ADMIN_BOUND_USER_KEY);
}

function formatDateTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return '—';
  }
}

function roleLabel(role) {
  if (role === 'owner') return '대표';
  if (role === 'senior') return 'Senior';
  if (role === 'staff') return 'Staff';
  return '권한 대기';
}

export default function AdminUsers() {
  const [adminToken, setAdminToken] = useState(() => localStorage.getItem(ADMIN_TOKEN_KEY) || '');
  const loggedIn = !!adminToken;
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({
    totalUsers: 0,
    owners: 0,
    seniors: 0,
    staffs: 0,
    pending: 0,
    verifiedEmails: 0,
    linkedCompanies: 0
  });

  const query = useMemo(() => search.trim(), [search]);

  useEffect(() => {
    if (!loggedIn) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const url = query
          ? `${API_BASE}/admin/users?search=${encodeURIComponent(query)}`
          : `${API_BASE}/admin/users`;
        const res = await fetch(url, { headers: getAdminSiteFetchHeaders() });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (res.status === 401) {
            clearAdminSession();
            setAdminToken('');
          }
          throw new Error(data.error || '유저 현황을 불러오지 못했습니다.');
        }
        if (cancelled) return;
        setRows(Array.isArray(data.rows) ? data.rows : []);
        setSummary(data.summary || {});
      } catch (e) {
        if (!cancelled) setError(e.message || '유저 현황을 불러오지 못했습니다.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [loggedIn, query]);

  return (
    <div className="admin-sub-page">
      <header className="admin-sub-header">
        <div>
          <h1 className="admin-sub-title">유저 현황</h1>
          <p className="admin-sub-sub">전체 사용자, 권한, 회사 연결 상태를 한 번에 확인합니다.</p>
        </div>
      </header>

      {!loggedIn ? (
        <div className="admin-sub-card admin-sub-login-card">
          <p className="admin-sub-lead">먼저 `구독 결제 현황` 메뉴에서 관리자 비밀번호를 입력해 주세요.</p>
        </div>
      ) : (
        <>
          <div className="admin-sub-card" style={{ maxWidth: '1100px', margin: '0 auto 18px' }}>
            <div className="admin-sub-users-toolbar">
              <input
                type="text"
                className="admin-sub-input"
                placeholder="이름, 이메일, 회사명, 사업자번호 검색"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="admin-sub-users-summary">
            <div className="admin-sub-users-stat"><strong>{summary.totalUsers || 0}</strong><span>전체 유저</span></div>
            <div className="admin-sub-users-stat"><strong>{summary.owners || 0}</strong><span>대표</span></div>
            <div className="admin-sub-users-stat"><strong>{summary.seniors || 0}</strong><span>Senior</span></div>
            <div className="admin-sub-users-stat"><strong>{summary.staffs || 0}</strong><span>Staff</span></div>
            <div className="admin-sub-users-stat"><strong>{summary.pending || 0}</strong><span>권한 대기</span></div>
            <div className="admin-sub-users-stat"><strong>{summary.linkedCompanies || 0}</strong><span>연결 회사</span></div>
            <div className="admin-sub-users-stat"><strong>{summary.verifiedEmails || 0}</strong><span>이메일 인증</span></div>
          </div>

          {error && <p className="admin-sub-error admin-sub-error-banner">{error}</p>}

          <div className="admin-sub-table-wrap">
            {loading ? (
              <p className="admin-sub-loading">불러오는 중…</p>
            ) : (
              <table className="admin-sub-table">
                <thead>
                  <tr>
                    <th>사용자</th>
                    <th>권한</th>
                    <th>이메일 인증</th>
                    <th>회사</th>
                    <th>사업자번호</th>
                    <th>생성일</th>
                    <th>수정일</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.userId}>
                      <td>
                        <div className="admin-sub-co">{row.name}</div>
                        <div className="admin-sub-id">{row.email}</div>
                      </td>
                      <td>
                        <span className={`admin-sub-badge admin-sub-badge--${row.role === 'pending' ? 'off' : 'on'}`}>
                          {roleLabel(row.role)}
                        </span>
                      </td>
                      <td>{row.emailVerified ? '완료' : '미인증'}</td>
                      <td>{row.companyName || '—'}</td>
                      <td>{row.companyBusinessNumber || '—'}</td>
                      <td>{formatDateTime(row.createdAt)}</td>
                      <td>{formatDateTime(row.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
