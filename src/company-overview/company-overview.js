import { useState, useEffect, useCallback, useMemo } from 'react';
import CompanyDriveSettingsModal from './company-drive-settings-modal/company-drive-settings-modal';
import './company-overview.css';

import { API_BASE } from '@/config';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function formatSubscriptionDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return '—';
  }
}

export default function CompanyOverview() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [showDriveSettingsModal, setShowDriveSettingsModal] = useState(false);
  const [savingMemberId, setSavingMemberId] = useState('');
  const [editingRoleMemberId, setEditingRoleMemberId] = useState('');
  const [selectedApproverIds, setSelectedApproverIds] = useState([]);
  const [requestSending, setRequestSending] = useState(false);
  const [requestMessage, setRequestMessage] = useState('');

  const roleLabel = (role) => {
    if (role === 'owner') return '대표 (Owner / CEO)';
    if (role === 'senior') return '책임 (Senior)';
    if (role === 'pending') return '권한 대기 (Pending Approval)';
    return '직원 (Staff)';
  };

  const refreshOverview = useCallback(async () => {
    const res = await fetch(`${API_BASE}/companies/overview`, { headers: getAuthHeader() });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || '조회에 실패했습니다.');
    setData(json);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await refreshOverview();
      } catch (e) {
        if (!cancelled) setError(e.message || '사내 현황을 불러올 수 없습니다.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [refreshOverview]);

  const { company = {}, employees = [], subscription = {} } = data || {};
  const me = data?.me || {};
  const fullAddress = [company.address, company.addressDetail].filter(Boolean).join(' ');
  const isPendingUser = me.role === 'pending';
  const canManageRoles = ['owner', 'senior'].includes(me.role);
  /** 역할 단계: Pending → Staff → Senior → Owner. 구독·시트 블록은 Senior 이상만 표시 */
  const canSeeSubscriptionSection = ['senior', 'owner'].includes(me.role);
  const canEditRole = (emp) => canManageRoles && String(emp.id) !== String(me.id) && emp.role !== 'owner';
  /** 구독 시트: 대표·책임·직원(비-pending) 인원만큼만 부여 가능 */
  const subActive = subscription?.hasActiveSubscription === true;
  const seatsRemaining = subscription?.seatsRemaining;
  const noSeatForPromotion = subActive && typeof seatsRemaining === 'number' && seatsRemaining <= 0;

  const sortedEmployees = useMemo(() => {
    const order = { owner: 0, senior: 1, staff: 2, pending: 3 };
    return [...employees].sort((a, b) => {
      const ra = order[a.role] ?? 99;
      const rb = order[b.role] ?? 99;
      if (ra !== rb) return ra - rb;
      return (a.name || a.email || '').localeCompare(b.name || b.email || '', 'ko');
    });
  }, [employees]);

  useEffect(() => {
    if (!isPendingUser) {
      setSelectedApproverIds([]);
      return;
    }
    setSelectedApproverIds((prev) => prev.filter((id) => employees.some((emp) => String(emp.id) === String(id))));
  }, [employees, isPendingUser]);

  if (loading) {
    return (
      <div className="page company-overview-page">
        <header className="page-header">
          <h1 className="page-title">사내 현황</h1>
        </header>
        <div className="page-content company-overview-content">
          <p className="company-overview-loading">불러오는 중...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page company-overview-page">
        <header className="page-header">
          <h1 className="page-title">사내 현황</h1>
        </header>
        <div className="page-content company-overview-content">
          <p className="company-overview-error">{error}</p>
        </div>
      </div>
    );
  }

  const updateMemberAccess = async (memberId, patch) => {
    setActionError('');
    setRequestMessage('');
    setSavingMemberId(String(memberId));
    try {
      const res = await fetch(`${API_BASE}/companies/members/${memberId}/access`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify(patch)
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || '직원 권한 변경에 실패했습니다.');
      await refreshOverview();
      setEditingRoleMemberId('');
    } catch (e) {
      setActionError(e.message || '직원 권한 변경에 실패했습니다.');
    } finally {
      setSavingMemberId('');
    }
  };

  const toggleApproverSelection = (memberId) => {
    const normalizedId = String(memberId);
    setSelectedApproverIds((prev) => (
      prev.includes(normalizedId)
        ? prev.filter((id) => id !== normalizedId)
        : [...prev, normalizedId]
    ));
  };

  const sendAccessRequest = async () => {
    setActionError('');
    setRequestMessage('');
    if (selectedApproverIds.length === 0) {
      setActionError('권한 요청을 받을 대표 또는 책임을 선택해 주세요.');
      return;
    }
    setRequestSending(true);
    try {
      const res = await fetch(`${API_BASE}/companies/access-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ approverUserIds: selectedApproverIds })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || '권한 요청 메일 전송에 실패했습니다.');
      const recipientLabel = (json.approvers || []).map((item) => item.name || item.email).filter(Boolean).join(', ');
      setRequestMessage(recipientLabel ? `${recipientLabel}에게 권한 요청 메일을 보냈습니다.` : '권한 요청 메일을 보냈습니다.');
      setSelectedApproverIds([]);
    } catch (e) {
      setActionError(e.message || '권한 요청 메일 전송에 실패했습니다.');
    } finally {
      setRequestSending(false);
    }
  };

  return (
    <div className="page company-overview-page">
      <header className="page-header company-overview-header">
        <h1 className="page-title">사내 현황</h1>
        <button
          type="button"
          className="company-overview-settings-btn"
          onClick={() => setShowDriveSettingsModal(true)}
          title="전체 공유 드라이브 설정"
          aria-label="전체 공유 드라이브 설정"
        >
          <span className="material-symbols-outlined">settings</span>
        </button>
      </header>
      <div className="page-content company-overview-content">
        {actionError && <p className="company-overview-error company-overview-inline-error">{actionError}</p>}
        <section className="company-overview-card company-info-card">
          <h2 className="company-overview-section-title">
            <span className="material-symbols-outlined">business</span>
            소속 회사
          </h2>
          <dl className="company-info-list">
            <div className="company-info-row">
              <dt>회사명</dt>
              <dd>{company.name || '—'}</dd>
            </div>
            <div className="company-info-row">
              <dt>주소</dt>
              <dd>{fullAddress || '—'}</dd>
            </div>
          </dl>
        </section>

        {canSeeSubscriptionSection && (
          <section className="company-overview-card company-subscription-card" aria-labelledby="co-sub-title">
            <h2 id="co-sub-title" className="company-overview-section-title">
              <span className="material-symbols-outlined">payments</span>
              구독 · 시트 (역할 인원)
            </h2>
            <p className="company-subscription-visibility-note">
              이 섹션은 책임(Senior) 이상만 볼 수 있습니다. 
            </p>
            {subActive ? (
              <>
                <dl className="company-info-list company-subscription-dl">
                  <div className="company-info-row">
                    <dt>구독 이용 인원</dt>
                    <dd>{subscription.seatCount != null ? `${subscription.seatCount}명` : '—'}</dd>
                  </div>
                  <div className="company-info-row">
                    <dt>역할 배정 사용</dt>
                    <dd>
                      {subscription.activeRoleCount != null ? `${subscription.activeRoleCount}명` : '—'}
                      <span className="company-subscription-slots">
                        {' '}(남은 시트 {typeof seatsRemaining === 'number' ? `${seatsRemaining}명` : '—'})
                      </span>
                    </dd>
                  </div>
                  <div className="company-info-row">
                    <dt>월 정기 금액(안내)</dt>
                    <dd>
                      {subscription.planAmount != null
                        ? `${Number(subscription.planAmount).toLocaleString('ko-KR')}원`
                        : '—'}
                    </dd>
                  </div>
                  <div className="company-info-row">
                    <dt>다음 정기 결제 예정</dt>
                    <dd>{formatSubscriptionDate(subscription.nextBillingAt)}</dd>
                  </div>
                </dl>
                <p className="company-subscription-hint">
                  대표·책임·직원 역할은 구독 인원(시트) 수만큼만 올릴 수 있습니다. 권한 대기(Pending)는 시트를 쓰지 않습니다.
                  {noSeatForPromotion && ' 현재 시트가 없어 권한 대기 중인 계정을 직원/책임으로 올릴 수 없습니다.'}
                </p>
              </>
            ) : (
              <p className="company-subscription-hint">
                활성 구독이 없습니다. 구독이 연동되면 위 인원만큼만 대표·책임·직원 역할을 부여할 수 있습니다.
              </p>
            )}
          </section>
        )}

        <section className="company-overview-card employees-card">
          <h2 className="company-overview-section-title">
            <span className="material-symbols-outlined">group</span>
            직원 리스트
            <span className="company-overview-count">({sortedEmployees.length}명)</span>
          </h2>
          {canSeeSubscriptionSection && subscription?.overLimit && (
            <div className="company-overview-seat-warning" role="status">
              <span className="material-symbols-outlined">warning</span>
              <span>
                구독 인원({subscription.seatCount}명)보다 역할이 부여된 직원이 많습니다. 구독에서 인원을 늘리거나,
                일부 직원을 권한 대기로 내려 주세요.
              </span>
            </div>
          )}
          {isPendingUser && (
            <div className="company-overview-approval-box">
              <p className="company-overview-approval-text">
                권한 대기 상태입니다. 아래 대표 또는 책임 중 메일을 받을 사람을 선택한 뒤 승인 요청을 보내세요.
              </p>
              <button
                type="button"
                className="company-overview-request-btn"
                onClick={sendAccessRequest}
                disabled={requestSending || selectedApproverIds.length === 0}
              >
                {requestSending ? '요청 메일 전송 중...' : '선택한 인원에게 권한 요청 메일 보내기'}
              </button>
              {requestMessage && <p className="company-overview-request-message">{requestMessage}</p>}
            </div>
          )}
          {sortedEmployees.length === 0 ? (
            <p className="company-overview-empty">등록된 직원이 없습니다.</p>
          ) : (
            <div className="company-overview-table-wrap">
              <table className="company-overview-table">
                <thead>
                  <tr>
                    <th>이름</th>
                    <th>이메일</th>
                    <th>연락처</th>
                    <th>부서</th>
                    <th>회사 역할</th>
                    {isPendingUser && <th>선택</th>}
                  </tr>
                </thead>
                <tbody>
                  {sortedEmployees.map((emp) => (
                    <tr key={emp.id}>
                      <td>{emp.name || '—'}</td>
                      <td>{emp.email || '—'}</td>
                      <td>{emp.phone || '—'}</td>
                      <td>{emp.department || '—'}</td>
                      <td>
                        {editingRoleMemberId === String(emp.id) && canEditRole(emp) ? (
                          <select
                            className="company-overview-select"
                            value={emp.role || 'pending'}
                            disabled={savingMemberId === String(emp.id)}
                            autoFocus
                            onBlur={() => {
                              if (savingMemberId !== String(emp.id)) setEditingRoleMemberId('');
                            }}
                            onChange={(e) => updateMemberAccess(emp.id, { role: e.target.value })}
                          >
                            <option value="pending">권한 대기 (Pending Approval)</option>
                            <option
                              value="staff"
                              disabled={emp.role === 'pending' && noSeatForPromotion}
                              title={emp.role === 'pending' && noSeatForPromotion ? '구독 시트가 부족합니다. 구독 관리에서 인원을 늘리세요.' : undefined}
                            >
                              직원 (Staff)
                            </option>
                            {me.role === 'owner' && (
                              <option
                                value="senior"
                                disabled={emp.role === 'pending' && noSeatForPromotion}
                                title={emp.role === 'pending' && noSeatForPromotion ? '구독 시트가 부족합니다.' : undefined}
                              >
                                책임 (Senior)
                              </option>
                            )}
                          </select>
                        ) : (
                          canEditRole(emp) ? (
                            <button
                              type="button"
                              className="company-overview-role-trigger"
                              onClick={() => setEditingRoleMemberId(String(emp.id))}
                              disabled={savingMemberId === String(emp.id)}
                            >
                              <span className={`company-overview-badge role-${emp.role || 'staff'}`}>
                                {roleLabel(emp.role)}
                              </span>
                            </button>
                          ) : (
                            <span className={`company-overview-badge role-${emp.role || 'staff'}`}>
                              {roleLabel(emp.role)}
                            </span>
                          )
                        )}
                      </td>
                      {isPendingUser && (
                        <td>
                          <label className="company-overview-approval-check">
                            <input
                              type="checkbox"
                              checked={selectedApproverIds.includes(String(emp.id))}
                              onChange={() => toggleApproverSelection(emp.id)}
                              disabled={requestSending}
                            />
                            <span>선택</span>
                          </label>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {showDriveSettingsModal && (
        <CompanyDriveSettingsModal
          initialDriveRootUrl={(data?.company?.driveRootUrl ?? '').trim()}
          onClose={() => setShowDriveSettingsModal(false)}
          onSaved={(savedUrl) => {
            setData((prev) => prev ? { ...prev, company: { ...prev.company, driveRootUrl: savedUrl } } : null);
          }}
        />
      )}
    </div>
  );
}
