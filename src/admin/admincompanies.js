import { useEffect, useState, useCallback } from 'react';
import { API_BASE } from '@/config';
import { getAdminSiteFetchHeaders } from '@/lib/admin-site-headers';
import './adminsubscription.css';

const ADMIN_TOKEN_KEY = 'admin_site_token';

function clearAdminSession() {
  localStorage.removeItem(ADMIN_TOKEN_KEY);
}

const ROLE_OPTIONS = [
  { value: 'owner', label: '대표(Owner)' },
  { value: 'admin', label: '관리자 (Admin)' },
  { value: 'manager', label: '실무자 (Manager)' },
  { value: 'staff', label: 'Staff' },
  { value: 'pending', label: '권한 대기' }
];

/** DB에 레거시 role이 남아 있어도 셀렉트 value와 맞춤 */
function adminUiRoleValue(role) {
  const r = String(role || '').trim().toLowerCase();
  if (r === 'senior') return 'admin';
  if (r === 'practitioner' || r === 'contributor') return 'manager';
  if (['owner', 'admin', 'manager', 'staff', 'pending'].includes(r)) return r;
  return 'pending';
}

export default function AdminCompanies() {
  const [adminToken, setAdminToken] = useState(() => localStorage.getItem(ADMIN_TOKEN_KEY) || '');
  const loggedIn = !!adminToken;
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [rows, setRows] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [grantSeatInput, setGrantSeatInput] = useState('');
  const [savingGrant, setSavingGrant] = useState(false);
  const [savingPartner, setSavingPartner] = useState(false);
  const [roleSavingId, setRoleSavingId] = useState(null);

  const loadCompanies = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const q = search.trim();
      const url = q
        ? `${API_BASE}/admin/companies?search=${encodeURIComponent(q)}`
        : `${API_BASE}/admin/companies`;
      const res = await fetch(url, { headers: getAdminSiteFetchHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) {
          clearAdminSession();
          setAdminToken('');
        }
        throw new Error(data.error || '회사 목록을 불러오지 못했습니다.');
      }
      setRows(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      setError(e.message || '회사 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    if (!loggedIn) return;
    const t = setTimeout(() => void loadCompanies(), 250);
    return () => clearTimeout(t);
  }, [loggedIn, loadCompanies]);

  const selectCompany = async (id) => {
    setSelectedId(id);
    setSuccessMsg('');
    setError('');
    setUsers([]);
    const row = rows.find((r) => String(r._id) === String(id));
    const sub = row?.subscription;
    setGrantSeatInput(sub ? String(sub.seatCount) : '');
    setUsersLoading(true);
    try {
      const res = await fetch(`${API_BASE}/admin/companies/${encodeURIComponent(id)}/users`, {
        headers: getAdminSiteFetchHeaders()
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '직원 목록을 불러오지 못했습니다.');
      setUsers(Array.isArray(data.users) ? data.users : []);
    } catch (e) {
      setError(e.message || '직원 목록을 불러오지 못했습니다.');
    } finally {
      setUsersLoading(false);
    }
  };

  const saveSubscriptionGrant = async () => {
    if (!selectedId) return;
    const n = Number(String(grantSeatInput).trim());
    if (!Number.isFinite(n) || n < 3) {
      setError('이용 인원(시트)은 3 이상 숫자로 입력해 주세요.');
      return;
    }
    setSavingGrant(true);
    setError('');
    setSuccessMsg('');
    try {
      const res = await fetch(`${API_BASE}/admin/companies/${encodeURIComponent(selectedId)}`, {
        method: 'PATCH',
        headers: getAdminSiteFetchHeaders(),
        body: JSON.stringify({
          adminSubscriptionGrant: { seatCount: n }
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '저장에 실패했습니다.');
      setSuccessMsg('관리자 무료 구독(전체 시트)을 반영했습니다. 해당 회사는 구독 화면에서 활성 상태로 보입니다.');
      void loadCompanies();
      if (data.company?.subscription) {
        setGrantSeatInput(String(data.company.subscription.seatCount));
      }
    } catch (e) {
      setError(e.message || '저장에 실패했습니다.');
    } finally {
      setSavingGrant(false);
    }
  };

  const savePartnerReseller = async (partnerReseller) => {
    if (!selectedId) return;
    setSavingPartner(true);
    setError('');
    setSuccessMsg('');
    try {
      const res = await fetch(`${API_BASE}/admin/companies/${encodeURIComponent(selectedId)}`, {
        method: 'PATCH',
        headers: getAdminSiteFetchHeaders(),
        body: JSON.stringify({ partnerReseller })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '저장에 실패했습니다.');
      setSuccessMsg(
        partnerReseller
          ? '파트너사로 설정했습니다. 발급된 쿠폰 번호를 파트너에 전달해 주세요.'
          : '일반 회사로 변경했습니다. 쿠폰 번호는 해제되었습니다.'
      );
      void loadCompanies();
    } catch (e) {
      setError(e.message || '저장에 실패했습니다.');
    } finally {
      setSavingPartner(false);
    }
  };

  const clearSubscriptionGrant = async () => {
    if (!selectedId || !window.confirm('관리자 무료 구독을 해제할까요? (결제 없이 부여한 구독만 취소됩니다)')) return;
    setSavingGrant(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/admin/companies/${encodeURIComponent(selectedId)}`, {
        method: 'PATCH',
        headers: getAdminSiteFetchHeaders(),
        body: JSON.stringify({ clearAdminSubscriptionGrant: true })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '해제에 실패했습니다.');
      setGrantSeatInput('');
      setSuccessMsg('관리자 무료 구독을 해제했습니다.');
      void loadCompanies();
    } catch (e) {
      setError(e.message || '해제에 실패했습니다.');
    } finally {
      setSavingGrant(false);
    }
  };

  const changeRole = async (userId, role) => {
    if (!selectedId) return;
    setRoleSavingId(userId);
    setError('');
    setSuccessMsg('');
    try {
      const res = await fetch(
        `${API_BASE}/admin/companies/${encodeURIComponent(selectedId)}/users/${encodeURIComponent(userId)}/role`,
        {
          method: 'PATCH',
          headers: getAdminSiteFetchHeaders(),
          body: JSON.stringify({ role })
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '역할 변경에 실패했습니다.');
      setUsers((prev) => prev.map((u) => (String(u._id) === String(userId) ? { ...u, role: data.user?.role || role } : u)));
      setSuccessMsg('역할을 변경했습니다.');
      void loadCompanies();
    } catch (e) {
      setError(e.message || '역할 변경에 실패했습니다.');
    } finally {
      setRoleSavingId(null);
    }
  };

  const selectedRow = rows.find((r) => String(r._id) === String(selectedId));

  return (
    <div className="admin-sub-page">
      <header className="admin-sub-header">
        <div>
          <h1 className="admin-sub-title">회사·직원</h1>
          <p className="admin-sub-sub">
            가입 회사 목록, 관리자 무료 구독(전체 시트·결제 없음), 직원 역할·대표 변경을 관리합니다.
          </p>
        </div>
      </header>

      {!loggedIn ? (
        <div className="admin-sub-card admin-sub-notice-wide">
          <p className="admin-sub-lead">먼저 `구독 결제 현황` 메뉴에서 관리자 비밀번호를 입력해 주세요.</p>
        </div>
      ) : (
        <>
          <div className="admin-sub-card admin-sub-toolbar-wrap">
            <div className="admin-sub-users-toolbar">
              <input
                type="text"
                className="admin-sub-input"
                placeholder="회사명·사업자번호 검색"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          {successMsg ? <p className="admin-sub-hint">{successMsg}</p> : null}
          {error && <p className="admin-sub-error admin-sub-error-banner">{error}</p>}

          <div className="admin-sub-table-wrap">
            <h2 style={{ margin: 0, padding: '16px 16px 8px', fontSize: '1rem', color: '#334155' }}>회사 목록</h2>
            {loading ? (
              <p className="admin-sub-loading">불러오는 중…</p>
            ) : (
              <table className="admin-sub-table">
                <thead>
                  <tr>
                    <th>회사명</th>
                    <th>사업자번호</th>
                    <th>DB</th>
                    <th>파트너</th>
                    <th>쿠폰</th>
                    <th>Owner / Sr / St / 대기</th>
                    <th>구독 시트</th>
                    <th>선택</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row._id}
                      style={String(selectedId) === String(row._id) ? { background: 'rgba(107, 157, 184, 0.12)' } : undefined}
                    >
                      <td>
                        <div className="admin-sub-co">{row.name}</div>
                        <div className="admin-sub-id">{row.status || '—'}</div>
                      </td>
                      <td>{row.businessNumber || '—'}</td>
                      <td>{row.dbName ? <span className="admin-sub-id">{row.dbName}</span> : '—'}</td>
                      <td>{row.partnerReseller ? 'O' : 'X'}</td>
                      <td>
                        {row.partnerReseller && row.partnerCouponCode ? (
                          <span className="admin-sub-id" style={{ fontSize: '0.8rem', wordBreak: 'break-all' }}>
                            {row.partnerCouponCode}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        {row.roleCounts
                          ? `${row.roleCounts.owner} / ${row.roleCounts.admin ?? row.roleCounts.senior ?? 0} / ${row.roleCounts.manager ?? row.roleCounts.practitioner ?? 0} / ${row.roleCounts.staff} / ${row.roleCounts.pending}`
                          : '—'}
                      </td>
                      <td>
                        {row.subscription ? (
                          <span className="admin-sub-id">
                            {row.subscription.seatCount}명
                            {row.subscription.adminGranted ? ' · 무료부여' : ''}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="admin-sub-btn admin-sub-btn-primary admin-sub-btn--compact"
                          onClick={() => void selectCompany(row._id)}
                        >
                          열기
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {selectedId && selectedRow ? (
            <div className="admin-sub-card" style={{ maxWidth: '1100px', margin: '18px auto 0' }}>
                <h2 style={{ margin: '0 0 12px', fontSize: '1.05rem', color: '#1e3a4c' }}>
                  {selectedRow.name} — 관리자 무료 구독(전체 시트)
                </h2>
                <div
                  style={{
                    marginBottom: '16px',
                    padding: '12px 14px',
                    background: 'rgba(107, 157, 184, 0.1)',
                    borderRadius: '10px',
                    border: '1px solid rgba(107, 157, 184, 0.25)'
                  }}
                >
                  <p style={{ margin: '0 0 8px', fontWeight: 600, color: '#334155' }}>협업 판매 파트너</p>
                  <p className="admin-sub-lead" style={{ marginBottom: '10px' }}>
                    파트너사로 지정하면 할인 쿠폰 번호가 자동 발급됩니다. 고객이 구독 결제 시 입력하면 요금표에 파트너 할인이 적용됩니다.
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
                    <label className="admin-sub-label" style={{ margin: 0 }}>
                      파트너 여부
                      <select
                        className="admin-sub-input"
                        style={{ minWidth: '100px', marginTop: '6px' }}
                        value={selectedRow.partnerReseller ? 'O' : 'X'}
                        disabled={savingPartner}
                        onChange={(e) => void savePartnerReseller(e.target.value === 'O')}
                      >
                        <option value="X">X (일반)</option>
                        <option value="O">O (파트너)</option>
                      </select>
                    </label>
                    {selectedRow.partnerReseller && selectedRow.partnerCouponCode ? (
                      <div>
                        <span className="admin-sub-id" style={{ fontSize: '0.85rem' }}>
                          쿠폰: <strong>{selectedRow.partnerCouponCode}</strong>
                        </span>
                      </div>
                    ) : null}
                  </div>
                </div>
                <p className="admin-sub-lead" style={{ marginBottom: '14px' }}>
                  결제·카드 등록 없이 <strong>구독 및 인원</strong> 화면과 동일하게 <strong>활성 구독</strong>으로 보이게 합니다. 인원 상한은
                  대표·관리자·실무자·직원 합계 기준 <strong>한 가지 숫자(시트)</strong>입니다.
                </p>
                {selectedRow.subscription && !selectedRow.subscription.adminGranted ? (
                  <p className="admin-sub-hint" style={{ marginBottom: '14px' }}>
                    이 회사는 이미 <strong>일반(결제) 구독</strong>이 있습니다. 관리자 무료 부여는 적용할 수 없습니다.
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'flex-end', marginBottom: '12px' }}>
                    <label className="admin-sub-label" style={{ minWidth: '160px' }}>
                      이용 인원(시트, 최소 3)
                      <input
                        className="admin-sub-input"
                        type="number"
                        min={3}
                        max={500}
                        placeholder="예: 10"
                        value={grantSeatInput}
                        onChange={(e) => setGrantSeatInput(e.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      className="admin-sub-btn admin-sub-btn-primary"
                      disabled={savingGrant}
                      onClick={() => void saveSubscriptionGrant()}
                    >
                      {savingGrant ? '저장 중…' : selectedRow.subscription?.adminGranted ? '시트 저장' : '무료 구독 부여'}
                    </button>
                    {selectedRow.subscription?.adminGranted ? (
                      <button
                        type="button"
                        className="admin-sub-btn admin-sub-btn-ghost"
                        disabled={savingGrant}
                        onClick={() => void clearSubscriptionGrant()}
                      >
                        무료 구독 해제
                      </button>
                    ) : null}
                  </div>
                )}

                <h3 style={{ margin: '20px 0 10px', fontSize: '0.98rem', color: '#334155' }}>직원(User) — 역할 변경</h3>
                {usersLoading ? (
                  <p className="admin-sub-loading">직원 불러오는 중…</p>
                ) : (
                  <table className="admin-sub-table">
                    <thead>
                      <tr>
                        <th>이름 / 이메일</th>
                        <th>역할</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((u) => (
                        <tr key={u._id}>
                          <td>
                            <div className="admin-sub-co">{u.name || '—'}</div>
                            <div className="admin-sub-id">{u.email}</div>
                          </td>
                          <td>
                            <select
                              className="admin-sub-input"
                              style={{ minWidth: '140px' }}
                              value={adminUiRoleValue(u.role)}
                              disabled={roleSavingId === u._id}
                              onChange={(e) => void changeRole(u._id, e.target.value)}
                            >
                              {ROLE_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
