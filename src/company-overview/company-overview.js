import { useState, useEffect } from 'react';
import CompanyDriveSettingsModal from './company-drive-settings-modal/company-drive-settings-modal';
import './company-overview.css';

import { API_BASE } from '@/config';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
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

  useEffect(() => {
    let cancelled = false;
    const fetchOverview = async () => {
      try {
        const res = await fetch(`${API_BASE}/companies/overview`, { headers: getAuthHeader() });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error || '조회에 실패했습니다.');
        }
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) setError(e.message || '사내 현황을 불러올 수 없습니다.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchOverview();
    return () => { cancelled = true; };
  }, []);

  const { company = {}, employees = [] } = data || {};
  const me = data?.me || {};
  const fullAddress = [company.address, company.addressDetail].filter(Boolean).join(' ');
  const isPendingUser = me.role === 'pending';
  const canManageRoles = ['owner', 'senior'].includes(me.role);
  const canEditRole = (emp) => canManageRoles && String(emp.id) !== String(me.id) && emp.role !== 'owner';

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
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          employees: (prev.employees || []).map((emp) => (
            String(emp.id) === String(memberId)
              ? {
                  ...emp,
                  ...(patch.role ? { role: json.item?.role || patch.role } : {}),
                  ...(patch.role ? { roleLabel: json.item?.roleLabel || roleLabel(patch.role) } : {})
                }
              : emp
          ))
        };
      });
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

        <section className="company-overview-card employees-card">
          <h2 className="company-overview-section-title">
            <span className="material-symbols-outlined">group</span>
            직원 리스트
            <span className="company-overview-count">({employees.length}명)</span>
          </h2>
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
          {employees.length === 0 ? (
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
                  {employees.map((emp) => (
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
                            <option value="staff">직원 (Staff)</option>
                            {me.role === 'owner' && <option value="senior">책임 (Senior)</option>}
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
