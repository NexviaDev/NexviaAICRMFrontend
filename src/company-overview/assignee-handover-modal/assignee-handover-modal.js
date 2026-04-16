import { useState, useEffect, useMemo, useCallback } from 'react';
import { API_BASE } from '@/config';
import { isAdminOrAboveRole } from '@/lib/crm-role-utils';
import './assignee-handover-modal.css';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * 담당 이관 신청 — Admin 메일 승인 후 반영 (POST /api/companies/assignee-handover-requests)
 * targets: 1건 이상 — 서버가 한 통의 메일에 전부 담아 발송 (항목별 동의 링크)
 */
const HANDOVER_REASON_MAX_LEN = 2000;

function consentRoleLabel(role) {
  const r = String(role || '').toLowerCase();
  if (r === 'owner') return '대표 (Owner)';
  if (r === 'admin' || r === 'senior') return '관리자';
  return '';
}

export default function AssigneeHandoverModal({
  open,
  onClose,
  onSubmitted,
  targetType,
  targets = [],
  assigneeIdToName = {},
  currentUserId,
  companyEmployees = [],
  companyEmployeesLoaded = true
}) {
  const [fromUserId, setFromUserId] = useState('');
  const [selectedConsentIds, setSelectedConsentIds] = useState([]);
  const [requestReason, setRequestReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [doneMessage, setDoneMessage] = useState('');

  const list = Array.isArray(targets) ? targets : [];

  const unionAssigneeIds = useMemo(() => {
    const s = new Set();
    for (const t of list) {
      for (const id of t.assigneeUserIds || []) {
        s.add(String(id));
      }
    }
    return [...s];
  }, [list]);

  const eligibleCountForFrom = useMemo(() => {
    if (!fromUserId) return 0;
    return list.filter((t) =>
      (t.assigneeUserIds || []).some((id) => String(id) === String(fromUserId))
    ).length;
  }, [list, fromUserId]);

  const consentCandidates = useMemo(() => {
    const arr = Array.isArray(companyEmployees) ? companyEmployees : [];
    return arr.filter((e) => {
      if (!String(e.email || '').trim()) return false;
      return isAdminOrAboveRole(e.role);
    });
  }, [companyEmployees]);

  const sortedConsentCandidates = useMemo(() => {
    return [...consentCandidates].sort((a, b) => {
      const ao = String(a.role || '').toLowerCase() === 'owner' ? 0 : 1;
      const bo = String(b.role || '').toLowerCase() === 'owner' ? 0 : 1;
      if (ao !== bo) return ao - bo;
      return String(a.name || '').localeCompare(String(b.name || ''), 'ko');
    });
  }, [consentCandidates]);

  useEffect(() => {
    if (!open) return;
    setError('');
    setDoneMessage('');
    setSubmitting(false);
    setFromUserId(unionAssigneeIds[0] || '');
    const ids = consentCandidates.map((e) => String(e._id || e.id)).filter(Boolean);
    setSelectedConsentIds(ids);
    setRequestReason('');
  }, [open, targetType, unionAssigneeIds, consentCandidates]);

  const toggleConsentId = useCallback((id) => {
    const sid = String(id);
    setSelectedConsentIds((prev) => {
      if (prev.includes(sid)) {
        if (prev.length <= 1) return prev;
        return prev.filter((x) => x !== sid);
      }
      return [...prev, sid];
    });
  }, []);

  const handleSubmit = useCallback(
    async (e) => {
      e.preventDefault();
      const toUserId = String(currentUserId || '');
      setError('');
      setDoneMessage('');
      if (!fromUserId || !toUserId) {
        setError('인계 대상과 인수자를 확인해 주세요.');
        return;
      }
      if (fromUserId === toUserId) {
        setError('인계 대상과 인수자는 달라야 합니다.');
        return;
      }
      const eligible = list.filter((t) =>
        (t.assigneeUserIds || []).some((id) => String(id) === String(fromUserId))
      );
      if (eligible.length === 0) {
        setError('선택한 항목 중 인계 대상이 담당으로 지정된 건이 없습니다.');
        return;
      }
      if (selectedConsentIds.length === 0) {
        setError('동의·승인 요청을 받을 사람을 한 명 이상 선택해 주세요.');
        return;
      }
      const reasonTrim = String(requestReason || '').trim();
      if (!reasonTrim) {
        setError('이관 사유를 입력해 주세요.');
        return;
      }
      if (reasonTrim.length > HANDOVER_REASON_MAX_LEN) {
        setError(`이관 사유는 ${HANDOVER_REASON_MAX_LEN}자 이하로 입력해 주세요.`);
        return;
      }

      setSubmitting(true);
      try {
        const res = await fetch(`${API_BASE}/companies/assignee-handover-requests`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
          body: JSON.stringify({
            targetType,
            targets: eligible.map((t) => ({ targetId: t.targetId })),
            fromUserId,
            toUserId,
            consentNotifyUserIds: selectedConsentIds,
            requestReason: reasonTrim
          })
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(json.error || '신청에 실패했습니다.');
          return;
        }
        setDoneMessage(
          json.message ||
            `총 ${eligible.length}건 신청을 접수했습니다. 관리자 메일의 동의 후 반영됩니다.`
        );
        onSubmitted?.();
      } catch (err) {
        setError(err.message || '신청 중 오류가 발생했습니다.');
      } finally {
        setSubmitting(false);
      }
    },
    [list, targetType, fromUserId, currentUserId, onSubmitted, selectedConsentIds, requestReason]
  );

  if (!open) return null;

  const toUserId = String(currentUserId || '');
  const n = list.length;

  return (
    <div className="ahm-overlay" role="dialog" aria-modal="true" aria-labelledby="ahm-title">
      <div className="ahm-panel">
        <div className="ahm-head">
          <h2 id="ahm-title" className="ahm-title">담당 이관 신청</h2>
          <p className="ahm-lead">
            <strong>{n}건</strong>
            <span className="ahm-lead-muted">
              {' '}
              · 선택한 항목마다 동일한 인계(담당 치환)를 신청합니다. 승인 후 반영되며 즉시 바뀌지 않습니다.
            </span>
          </p>
          {n > 1 ? (
            <ul className="ahm-target-list" aria-label="신청 대상 목록">
              {list.map((t) => (
                <li key={String(t.targetId)}>{t.targetLabel || String(t.targetId)}</li>
              ))}
            </ul>
          ) : list[0] ? (
            <p className="ahm-single-label">
              <strong>{list[0].targetLabel || '—'}</strong>
            </p>
          ) : null}
        </div>
        <form className="ahm-form" onSubmit={handleSubmit}>
          <div className="ahm-field">
            <label htmlFor="ahm-from">인계 대상 (기존 담당에서 빠질 사람)</label>
            <select
              id="ahm-from"
              className="ahm-select"
              value={fromUserId}
              onChange={(ev) => setFromUserId(ev.target.value)}
              disabled={submitting || unionAssigneeIds.length === 0}
            >
              {unionAssigneeIds.length === 0 ? <option value="">담당자 없음</option> : null}
              {unionAssigneeIds.map((id) => (
                <option key={id} value={id}>
                  {assigneeIdToName[id] || id}
                </option>
              ))}
            </select>
            <p className="ahm-field-hint">
              위 사람이 담당으로 들어 있는 항목에만 신청이 생성됩니다.
              {fromUserId ? (
                <span className="ahm-field-hint-strong"> ({eligibleCountForFrom}건 해당)</span>
              ) : null}
            </p>
          </div>
          <div className="ahm-field">
            <span className="ahm-label">인수자 (신청자·새 담당으로 들어갈 사람)</span>
            <p className="ahm-static">
              {assigneeIdToName[toUserId] || '본인'}
              <span className="ahm-static-hint"> (본인 계정으로만 신청 가능)</span>
            </p>
          </div>
          <div className="ahm-field">
            <span className="ahm-label" id="ahm-consent-label">
              동의·승인 요청 받을 사람 <span className="ahm-label-sub">(결제·승인 요청 대상)</span>
            </span>
            <p className="ahm-field-hint ahm-consent-lead">
              대표(Owner) 또는 관리자 중, 안내 메일을 받고 동의할 수 있는 사람을 고릅니다. 한 명 이상 유지됩니다.
            </p>
            {!companyEmployeesLoaded ? (
              <p className="ahm-field-hint">직원 정보를 불러오는 중…</p>
            ) : sortedConsentCandidates.length === 0 ? (
              <p className="ahm-error" role="alert">
                동의 요청이 가능한 계정이 없습니다. 사내 현황에 대표·관리자 이메일이 등록되어 있는지 확인해 주세요.
              </p>
            ) : (
              <ul className="ahm-consent-list" aria-labelledby="ahm-consent-label">
                {sortedConsentCandidates.map((e) => {
                  const id = String(e._id || e.id);
                  const checked = selectedConsentIds.includes(id);
                  return (
                    <li key={id} className="ahm-consent-item">
                      <label className="ahm-consent-label">
                        <input
                          type="checkbox"
                          className="ahm-consent-check"
                          checked={checked}
                          onChange={() => toggleConsentId(id)}
                          disabled={submitting || (checked && selectedConsentIds.length <= 1)}
                        />
                        <span className="ahm-consent-text">
                          <span className="ahm-consent-name">{e.name || e.email || id}</span>
                          {consentRoleLabel(e.role) ? (
                            <span className="ahm-consent-role">{consentRoleLabel(e.role)}</span>
                          ) : null}
                          {e.email ? <span className="ahm-consent-email">{e.email}</span> : null}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="ahm-field">
            <label htmlFor="ahm-reason" className="ahm-label">
              이관 사유 <span className="ahm-label-sub">(필수 · 동의 메일·처리 완료 메일에 표시)</span>
            </label>
            <textarea
              id="ahm-reason"
              className="ahm-textarea"
              rows={4}
              maxLength={HANDOVER_REASON_MAX_LEN}
              value={requestReason}
              onChange={(ev) => setRequestReason(ev.target.value)}
              disabled={submitting}
              placeholder="예: 퇴사에 따른 담당 이관, 프로젝트 종료 등"
              aria-required="true"
            />
            <p className="ahm-field-hint">
              {String(requestReason || '').length}/{HANDOVER_REASON_MAX_LEN}자
            </p>
          </div>
          {error ? <p className="ahm-error" role="alert">{error}</p> : null}
          {doneMessage ? <p className="ahm-done" role="status">{doneMessage}</p> : null}
          <div className="ahm-actions">
            <button type="button" className="ahm-btn ahm-btn--ghost" onClick={onClose} disabled={submitting}>
              닫기
            </button>
            <button
              type="submit"
              className="ahm-btn ahm-btn--primary"
              disabled={
                submitting ||
                !companyEmployeesLoaded ||
                sortedConsentCandidates.length === 0 ||
                selectedConsentIds.length === 0 ||
                !fromUserId ||
                !String(requestReason || '').trim() ||
                unionAssigneeIds.length === 0 ||
                (fromUserId && eligibleCountForFrom === 0)
              }
            >
              {submitting
                ? '전송 중…'
                : `신청하기 (${fromUserId ? eligibleCountForFrom : n}건)`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
