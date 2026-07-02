import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { hasCrmSession, getCrmToken, getCrmAuthHeaders, crmFetchInit, markCrmSessionActive, clearCrmSessionLocal, logoutCrmSession, getAuthHeader } from '@/lib/crm-auth';
import { API_BASE } from '@/config';
import { LEAVE_LABEL, formatVacationTimeDisplay, formatVacationDaysLabel, formatVacationDateRangeLabel, isPartialDayLeave } from '../vacation-leave-utils';
import ApprovalCommentsPanel from './approval-comments-panel';
import { ApprovalContentSheet, ApprovalSheetRow, ApprovalSheetPairRow, ApprovalSheetPair, ApprovalSheetReadonly } from '../approval-content-sheet';
import { ApprovalRouteBoard } from '../approval-route-board';
import '../approval-route-board.css';
import { resolveDeptDisplayLabel } from '../resolve-dept-display';
import { getExpenseItems } from '../approval-expense-utils';
import { ExpenseLinesReadonly } from '../approval-expense-lines';
import { getExpenseColumnTemplateFromOverview, normalizeExpenseColumnTemplateColumns } from '../approval-expense-column-template';
import '../approval-expense-lines.css';
import './approval-detail-modal.css';

const STATUS_LABEL = {
  draft: '임시저장',
  pending: '결재중',
  approved: '승인',
  rejected: '반려',
  cancelled: '회수'
};

const DOC_TYPE_TITLE = {
  vacation: '휴가 신청서',
  expense: '지출 결의서',
  quotation: '견적 결재서',
  proposal: '품의서'
};

const DOC_TYPE_SECTION = {
  vacation: '휴가 신청 내역',
  expense: '지출 신청 내역',
  quotation: '견적 신청 내역',
  proposal: '품의 신청 내역'
};

const DOC_TYPE_DECLARATION = {
  vacation: '휴가기준에 의거하여 위와 같이 휴가를 신청하오니 허락하여 주시기 바랍니다.',
  expense: '위와 같이 지출을 신청하오니 검토 후 결재하여 주시기 바랍니다.',
  quotation: '위와 같이 견적 결재를 신청하오니 검토 후 승인하여 주시기 바랍니다.',
  proposal: '위와 같이 품의하오니 검토 후 결재하여 주시기 바랍니다.'
};

function formatDraftDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day} (${days[dt.getDay()]})`;
}

function formatDraftDateLong(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  return `${dt.getFullYear()}년 ${String(dt.getMonth() + 1).padStart(2, '0')}월 ${String(dt.getDate()).padStart(2, '0')}일`;
}

function formatShortMmDd(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return `${String(dt.getMonth() + 1).padStart(2, '0')}/${String(dt.getDate()).padStart(2, '0')}`;
}

function formatDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  const raw = String(d || '');
  const hasTime = /\d{2}:\d{2}/.test(raw) || /T\d{2}:\d{2}/.test(raw);
  return hasTime
    ? dt.toLocaleString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
    : dt.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatAmount(v) {
  if (v == null || v === '') return '—';
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  return `${n.toLocaleString('ko-KR')}원`;
}

function approvalSlotLabel(index, total) {
  if (index === 0) return '검토';
  if (total === 1) return '검토';
  if (total === 2) return index === 1 ? '검토' : '최종';
  return `${index}차`;
}

export default function ApprovalDetailModal({ doc, currentUser, onClose, onUpdated, onRemoved, onEditDraft }) {
  const [actionComment, setActionComment] = useState('');
  const [activeSlot, setActiveSlot] = useState(null);
  const [busy, setBusy] = useState(false);
  const [localDoc, setLocalDoc] = useState(doc);
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [organizationChart, setOrganizationChart] = useState(null);
  const [expenseColumnTemplateColumns, setExpenseColumnTemplateColumns] = useState(
    normalizeExpenseColumnTemplateColumns([])
  );
  const actionRef = useRef(null);

  useEffect(() => {
    setLocalDoc(doc);
    setActionComment('');
    setActiveSlot(null);
  }, [doc]);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/companies/overview`, crmFetchInit())
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled) {
          setOrganizationChart(data?.company?.organizationChart ?? null);
          setExpenseColumnTemplateColumns(getExpenseColumnTemplateFromOverview(data));
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!doc?._id) return;
    let cancelled = false;
    setLoadingDoc(true);
    fetch(`${API_BASE}/approvals/${encodeURIComponent(doc._id)}`, crmFetchInit())
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?._id) setLocalDoc(data);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingDoc(false);
      });
    return () => { cancelled = true; };
  }, [doc?._id]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const meId = String(currentUser?._id || currentUser?.id || '');
  const isDrafter = String(localDoc?.drafterUserId) === meId;
  const drafterMeta = useMemo(() => {
    let phone = String(localDoc?.drafterPhone || '').trim();
    let email = String(localDoc?.drafterEmail || '').trim();
    let dept = String(localDoc?.drafterDepartment || localDoc?.drafterDept || '').trim();
    if (isDrafter) {
      phone = phone || String(currentUser?.phone || '').trim();
      email = email || String(currentUser?.email || '').trim();
      dept = dept || String(currentUser?.companyDepartment || currentUser?.department || '').trim();
    }
    return {
      phone,
      email,
      dept: resolveDeptDisplayLabel(dept, organizationChart, isDrafter ? currentUser : null) || '—'
    };
  }, [currentUser, isDrafter, localDoc?.drafterDepartment, localDoc?.drafterDept, localDoc?.drafterEmail, localDoc?.drafterPhone, organizationChart]);
  const approvalLine = localDoc?.approvalLine || [];
  const agreementLine = localDoc?.agreementLine || [];
  const referenceLine = localDoc?.referenceLine || [];
  const currentIdx = localDoc?.currentStepIndex ?? 0;
  const currentStep = approvalLine[currentIdx];
  const canApprove =
    localDoc?.status === 'pending' &&
    currentStep &&
    String(currentStep.userId) === meId &&
    currentStep.status === 'pending';
  const canWithdraw =
    isDrafter &&
    localDoc?.status === 'pending' &&
    (localDoc?.canWithdraw != null
      ? Boolean(localDoc.canWithdraw)
      : !approvalLine.some((s) => s.status === 'approved' || s.status === 'rejected'));

  const badgeClass = `approval-detail-badge approval-detail-badge--${localDoc?.status || 'draft'}`;
  const docTitleLabel = DOC_TYPE_TITLE[localDoc?.docType] || '결재 문서';
  const sectionTitle = DOC_TYPE_SECTION[localDoc?.docType] || '신청 내역';
  const draftDateSource = localDoc?.submittedAt || localDoc?.createdAt;
  const draftDateLabel = formatDraftDate(draftDateSource);
  const draftDateLong = formatDraftDateLong(draftDateSource);
  const draftShortMmDd = formatShortMmDd(draftDateSource);
  const drafterName = localDoc?.drafterName || '—';
  const drafterDept = drafterMeta.dept;
  const drafterPhone = drafterMeta.phone;
  const drafterEmail = drafterMeta.email;

  const mentionable = useMemo(() => {
    const rows = [];
    const seen = new Set();
    const push = (userId, name, department) => {
      const id = String(userId || '');
      if (!id || seen.has(id)) return;
      seen.add(id);
      rows.push({ userId: id, name: name || '', department: department || '' });
    };
    push(localDoc?.drafterUserId, drafterName, drafterDept);
    approvalLine.forEach((s) => push(s.userId, s.name, s.department));
    agreementLine.forEach((s) => push(s.userId, s.name, s.department));
    referenceLine.forEach((s) => push(s.userId, s.name, s.department));
    return rows;
  }, [agreementLine, approvalLine, drafterDept, drafterName, localDoc?.drafterUserId, referenceLine]);

  const act = useCallback(
    async (action) => {
      if (!localDoc?._id) return;
      if (action === 'cancel') {
        const ok = window.confirm('상신을 취소하면 이 결재 문서가 삭제됩니다. 계속할까요?');
        if (!ok) return;
      }
      setBusy(true);
      try {
        const url = `${API_BASE}/approvals/${localDoc._id}/${action}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: getAuthHeader(),
          body: JSON.stringify({ comment: actionComment.trim() })
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || '처리하지 못했습니다.');
        if (action === 'cancel') {
          onRemoved?.(localDoc._id);
          onClose?.();
          return;
        }
        setLocalDoc(json);
        setActiveSlot(null);
        setActionComment('');
        onUpdated?.(json);
        if (action === 'approve' && json.status === 'approved') onClose?.();
        if (action === 'reject') onClose?.();
      } catch (e) {
        window.alert(e.message || '처리하지 못했습니다.');
      } finally {
        setBusy(false);
      }
    },
    [actionComment, localDoc, onClose, onRemoved, onUpdated]
  );

  const handleSlotClick = useCallback((slotKey, clickable) => {
    if (!clickable || busy) return;
    setActiveSlot((prev) => (prev === slotKey ? null : slotKey));
    setActionComment('');
    requestAnimationFrame(() => actionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  }, [busy]);

  const renderVacationBody = () => {
    const fd = localDoc?.formData || {};
    const partial = isPartialDayLeave(fd.leaveType);
    const timeText = formatVacationTimeDisplay(fd);
    const dateRangeLabel = formatVacationDateRangeLabel(fd.startDate, fd.endDate, fd.leaveType);

    return (
      <>
        <ApprovalSheetPairRow>
          <ApprovalSheetPair label="휴가 종류">
            <ApprovalSheetReadonly value={LEAVE_LABEL[fd.leaveType] || fd.leaveType} />
          </ApprovalSheetPair>
          <ApprovalSheetPair label="일수">
            <ApprovalSheetReadonly value={formatVacationDaysLabel(fd.days)} />
          </ApprovalSheetPair>
        </ApprovalSheetPairRow>
        <ApprovalSheetPairRow wide={!partial && !timeText}>
          <ApprovalSheetPair label={partial ? '휴가일' : '휴가 기간'}>
            <ApprovalSheetReadonly value={dateRangeLabel} />
          </ApprovalSheetPair>
          {timeText ? (
            <ApprovalSheetPair label="휴가 시간">
              <ApprovalSheetReadonly value={timeText} />
            </ApprovalSheetPair>
          ) : null}
        </ApprovalSheetPairRow>
        <ApprovalSheetRow label="휴가 사유">
          <ApprovalSheetReadonly value={fd.reason} multiline />
        </ApprovalSheetRow>
      </>
    );
  };

  const renderTypeBody = () => {
    const fd = localDoc?.formData || {};
    if (localDoc?.docType === 'vacation') return renderVacationBody();
    if (localDoc?.docType === 'expense') {
      const items = getExpenseItems(fd);
      return (
        <ExpenseLinesReadonly
          items={items}
          formatDate={formatDate}
          formatAmount={formatAmount}
          columnTemplateColumns={expenseColumnTemplateColumns}
        />
      );
    }
    if (localDoc?.docType === 'quotation') {
      return (
        <>
          <ApprovalSheetRow label="고객사/고객">
            <ApprovalSheetReadonly value={fd.customerName} />
          </ApprovalSheetRow>
          <ApprovalSheetRow label="견적 금액">
            <ApprovalSheetReadonly value={formatAmount(fd.amount)} />
          </ApprovalSheetRow>
          <ApprovalSheetRow label="유효기간">
            <ApprovalSheetReadonly value={formatDate(fd.validUntil)} />
          </ApprovalSheetRow>
          <ApprovalSheetRow label="품목/내용">
            <ApprovalSheetReadonly value={fd.productSummary} multiline />
          </ApprovalSheetRow>
        </>
      );
    }
    return (
      <>
        <ApprovalSheetRow label="품의 제목">
          <ApprovalSheetReadonly value={fd.subject} />
        </ApprovalSheetRow>
        <ApprovalSheetRow label="품의 내용">
          <ApprovalSheetReadonly value={fd.summary} multiline />
        </ApprovalSheetRow>
        <ApprovalSheetRow label="기대 효과">
          <ApprovalSheetReadonly value={fd.expectedEffect} multiline />
        </ApprovalSheetRow>
      </>
    );
  };

  const slotMap = useMemo(() => {
    const map = new Map();
    map.set('drafter', {
      key: 'drafter',
      head: '기안',
      name: drafterName,
      foot: draftShortMmDd,
      status: localDoc?.status !== 'draft' ? 'approved' : 'pending',
      isCurrent: false,
      clickable: canWithdraw,
      hint: canWithdraw ? '클릭하여 상신 취소' : ''
    });
    approvalLine.forEach((step, idx) => {
      const isMyTurn =
        localDoc?.status === 'pending' &&
        idx === currentIdx &&
        step.status === 'pending' &&
        String(step.userId) === meId;
      const key = `step-${idx}`;
      map.set(key, {
        key,
        head: approvalSlotLabel(idx + 1, approvalLine.length),
        name: step.name || '—',
        foot: step.actedAt ? formatShortMmDd(step.actedAt) : '',
        status: step.status,
        isCurrent: isMyTurn,
        clickable: isMyTurn,
        hint: isMyTurn ? '클릭하여 승인/반려' : ''
      });
    });
    return map;
  }, [approvalLine, canWithdraw, currentIdx, draftShortMmDd, drafterName, localDoc?.status, meId]);

  const renderApprovalSlot = useCallback(({ slotKey, head, name, foot, slotClassName, step, blankHead = false }) => {
    const slot = slotMap.get(slotKey) || {
      key: slotKey,
      head,
      name,
      foot: step?.actedAt ? formatShortMmDd(step.actedAt) : foot,
      status: step?.status || 'pending',
      isCurrent: false,
      clickable: false,
      hint: ''
    };
    const bodyCls = [
      'approval-route-slot-body',
      slot.isCurrent ? 'approval-route-slot-body--current' : '',
      slotKey === 'drafter' ? 'approval-route-slot-body--drafter' : ''
    ].filter(Boolean).join(' ');
    const slotCls = [
      slotClassName,
      slot.clickable ? 'is-clickable' : '',
      activeSlot === slot.key ? 'is-active' : ''
    ].filter(Boolean).join(' ');

    const inner = (
      <>
        <div className={bodyCls}>
          {slot.status === 'approved' ? (
            <div className="approval-detail-stamp">
              승인<br />{(slot.name.split(' ')[0] || slot.name).slice(0, 3)}
            </div>
          ) : slot.status === 'rejected' ? (
            <div className="approval-detail-stamp approval-detail-stamp--reject">
              반려<br />{(slot.name.split(' ')[0] || slot.name).slice(0, 3)}
            </div>
          ) : (
            <span className="approval-detail-slot-name">{slot.name || name}</span>
          )}
        </div>
        <div className="approval-route-slot-foot">{slot.foot || foot}</div>
      </>
    );

    if (slot.clickable) {
      return (
        <button
          key={slot.key}
          type="button"
          className={slotCls}
          title={slot.hint}
          onClick={() => handleSlotClick(slot.key, slot.clickable)}
          disabled={busy}
        >
          {inner}
        </button>
      );
    }
    return (
      <div key={slot.key} className={slotCls}>
        {inner}
      </div>
    );
  }, [activeSlot, busy, handleSlotClick, slotMap]);

  if (!localDoc) return null;

  return (
    <div className="approval-detail-overlay" role="presentation">
      <div className="approval-detail-panel" role="dialog" aria-modal="true" aria-labelledby="approval-detail-title">
        <div className="approval-detail-topbar">
          <div className="approval-detail-topbar-left">
            <p className="approval-detail-topbar-title">Nexvia CRM</p>
            <span className="approval-detail-topbar-divider" aria-hidden />
            <span className="approval-detail-topbar-sub">전자결재 상세</span>
            <span className={badgeClass}>{STATUS_LABEL[localDoc.status] || localDoc.status}</span>
          </div>
          <button type="button" className="approval-detail-close" onClick={onClose} disabled={busy} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="approval-detail-body">
          <div className="approval-detail-layout">
            <div className="approval-detail-main">
              <div className="approval-detail-doc">
                <div className="approval-detail-doc-glow" aria-hidden />

                <div className="approval-doc-corner-meta">
                  <span className="approval-doc-corner-date">
                    <span className="approval-doc-corner-label">기안일</span>
                    {draftDateLabel}
                  </span>
                  <span className="approval-doc-corner-docno">
                    <span className="approval-doc-corner-label">문서번호</span>
                    {localDoc.docNumber || '—'}
                  </span>
                </div>

                <div className="approval-detail-doc-title-wrap">
                  <h2 id="approval-detail-title" className="approval-detail-doc-title">{docTitleLabel}</h2>
                  <div className="approval-detail-doc-title-bar" aria-hidden />
                  {localDoc.title ? <p className="approval-detail-doc-subtitle">{localDoc.title}</p> : null}
                </div>

                <ApprovalRouteBoard
                  drafterName={drafterName}
                  draftShortMmDd={draftShortMmDd}
                  approvalLine={approvalLine}
                  agreementLine={agreementLine}
                  referenceLine={referenceLine}
                  organizationChart={organizationChart}
                  renderApprovalSlot={renderApprovalSlot}
                />

                {activeSlot === 'drafter' && canWithdraw ? (
                  <div className="approval-detail-slot-action" ref={actionRef}>
                    <p className="approval-detail-slot-action-title">기안자 — 상신 취소</p>
                    <p className="approval-detail-slot-action-desc">아직 결재자가 처리하기 전에만 취소할 수 있습니다.</p>
                    <button type="button" className="approval-detail-btn-withdraw" onClick={() => act('cancel')} disabled={busy}>
                      <span className="material-symbols-outlined">undo</span>
                      {busy ? '처리 중…' : '상신취소'}
                    </button>
                  </div>
                ) : null}
                {activeSlot?.startsWith('step-') && canApprove ? (
                  <div className="approval-detail-slot-action" ref={actionRef}>
                    <p className="approval-detail-slot-action-title">결재 처리</p>
                    <textarea
                      className="approval-detail-action-comment"
                      value={actionComment}
                      onChange={(e) => setActionComment(e.target.value)}
                      placeholder="승인·반려 의견 (선택)"
                      rows={3}
                    />
                    <div className="approval-detail-slot-action-btns">
                      <button type="button" className="approval-detail-btn-reject" onClick={() => act('reject')} disabled={busy}>
                        <span className="material-symbols-outlined">block</span>
                        반려
                      </button>
                      <button type="button" className="approval-detail-btn-approve" onClick={() => act('approve')} disabled={busy}>
                        <span className="material-symbols-outlined">check_circle</span>
                        {busy ? '처리 중…' : '승인'}
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="approval-detail-meta-block approval-doc-meta-sheet">
                  <div className="approval-doc-meta-sheet-head">기안 정보</div>
                  <div className="approval-detail-meta-list">
                    <div className="approval-detail-meta-row">
                      <span className="approval-detail-meta-label">기안자</span>
                      <span className="approval-detail-meta-value">{drafterName}</span>
                      <span className="approval-detail-meta-label">기안부서</span>
                      <span className="approval-detail-meta-value">{drafterDept}</span>
                    </div>
                    <div className="approval-detail-meta-row">
                      <span className="approval-detail-meta-label">연락처</span>
                      <span className="approval-detail-meta-value">{drafterPhone || '—'}</span>
                      <span className="approval-detail-meta-label">이메일</span>
                      <span className="approval-detail-meta-value">{drafterEmail || '—'}</span>
                    </div>
                  </div>
                </div>

                <section className="approval-detail-section">
                  <ApprovalContentSheet title={sectionTitle}>
                    {localDoc.docType === 'expense' ? (
                      renderTypeBody()
                    ) : (
                      <>
                        {localDoc.title ? (
                          <ApprovalSheetRow label="문서 제목">
                            <ApprovalSheetReadonly value={localDoc.title} />
                          </ApprovalSheetRow>
                        ) : null}
                        {renderTypeBody()}
                        {localDoc.memo ? (
                          <ApprovalSheetRow label="비고">
                            <ApprovalSheetReadonly value={localDoc.memo} multiline />
                          </ApprovalSheetRow>
                        ) : null}
                      </>
                    )}
                  </ApprovalContentSheet>
                </section>

                <div className="approval-detail-declaration">
                  <p>{DOC_TYPE_DECLARATION[localDoc.docType] || '위와 같이 결재를 요청합니다.'}</p>
                  <p className="approval-detail-declaration-date">{draftDateLong}</p>
                  <p className="approval-detail-declaration-sign">신청인 : {drafterName}</p>
                </div>
              </div>
            </div>

            <ApprovalCommentsPanel
              docId={localDoc._id}
              comments={localDoc.comments || []}
              mentionable={mentionable}
              currentUser={currentUser}
              onCommentsChange={(next) => setLocalDoc((prev) => ({ ...prev, comments: next }))}
            />
          </div>
          {loadingDoc ? <p className="approval-detail-loading">문서 불러오는 중…</p> : null}
        </div>

        <div className="approval-detail-foot">
          <button type="button" className="approval-detail-btn-close" onClick={onClose} disabled={busy}>
            <span className="material-symbols-outlined">close</span>
            닫기
          </button>
          {isDrafter && localDoc.status === 'draft' ? (
            <button type="button" className="approval-detail-btn-edit" onClick={() => onEditDraft?.(localDoc)} disabled={busy}>
              수정
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
