import './approval-route-board.css';
import { resolveDeptDisplayLabel } from './resolve-dept-display';

function agreementStatusLabel(status) {
  if (status === 'approved') return '합의';
  if (status === 'rejected') return '반려';
  return '—';
}

function PersonLineTable({ rows, statusForRow, deptLabel }) {
  if (!rows.length) return null;
  return (
    <div className="approval-route-ref-layout">
      <div className="approval-route-ref-table">
        <div className="approval-route-ref-head">
          <span>No</span>
          <span>이름</span>
          <span>상태</span>
          <span>부서</span>
        </div>
        <div className="approval-route-ref-rows">
          {rows.map((s, idx) => (
            <div key={String(s.userId)} className="approval-route-ref-row">
              <span className="approval-route-ref-no">{idx + 1}</span>
              <span className="approval-route-ref-name">{s.name || '—'}</span>
              <span className="approval-route-ref-status">{statusForRow(s)}</span>
              <span className="approval-route-ref-dept">{deptLabel(s.department)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StaticSlot({ head, foot, children, className = '', bodyClassName = '', hideFoot = false, hideHead = false, blankHead = false, alwaysFoot = false }) {
  const bodyCls = ['approval-route-slot-body', bodyClassName].filter(Boolean).join(' ');
  const showFoot = !hideFoot && (alwaysFoot || Boolean(foot));
  const showHead = !hideHead && (Boolean(head) || blankHead);
  return (
    <div className={['approval-route-slot', className].filter(Boolean).join(' ')}>
      {showHead ? (
        <div className={`approval-route-slot-head${blankHead ? ' approval-route-slot-head--blank' : ''}`}>
          {head || ''}
        </div>
      ) : null}
      <div className={bodyCls}>{children}</div>
      {showFoot ? <div className="approval-route-slot-foot">{foot || ''}</div> : null}
    </div>
  );
}

function PanelHead({ title, showEdit, onEdit, editDisabled, editTitle }) {
  const titleCls = [
    'approval-route-panel-head-title',
    showEdit ? 'approval-route-panel-head-title--pick' : ''
  ].filter(Boolean).join(' ');

  return (
    <div className="approval-route-panel-head">
      {showEdit ? (
        <button
          type="button"
          className={titleCls}
          onClick={onEdit}
          disabled={editDisabled}
          title={editTitle}
          aria-label={editTitle}
        >
          {title}
        </button>
      ) : (
        <span className={titleCls}>{title}</span>
      )}
    </div>
  );
}

export function ApprovalRouteBoard({
  drafterName,
  draftShortMmDd = '',
  approvalLine = [],
  agreementLine = [],
  referenceLine = [],
  renderApprovalSlot,
  editable = false,
  onPickLine,
  pickDisabled = false,
  organizationChart = null
}) {
  const canPick = editable && typeof onPickLine === 'function' && !pickDisabled;
  const hasAgreement = agreementLine.length > 0;
  const hasReference = referenceLine.length > 0;
  const hasApprovers = approvalLine.length > 0;
  const showAgreementPanel = hasAgreement || (editable && canPick);
  const showReferencePanel = hasReference || (editable && canPick);
  const showApprovalPanel = hasApprovers || editable || Boolean(renderApprovalSlot);

  const pick = (target) => {
    if (canPick) onPickLine(target);
  };

  const refDeptLabel = (raw) => {
    const label = resolveDeptDisplayLabel(raw, organizationChart, null);
    return label || '—';
  };

  const editProps = (target, title) => ({
    showEdit: canPick,
    onEdit: () => pick(target),
    editDisabled: !canPick,
    editTitle: title
  });

  const boardCls = [
    'approval-route-board',
    !showAgreementPanel && 'approval-route-board--no-agreement',
    !showReferencePanel && 'approval-route-board--no-reference',
    showApprovalPanel && !showAgreementPanel && !showReferencePanel && 'approval-route-board--only-approval'
  ].filter(Boolean).join(' ');

  const renderDrafterSlot = () => {
    if (renderApprovalSlot) {
      return renderApprovalSlot({
        slotKey: 'drafter',
        head: '',
        name: drafterName,
        foot: draftShortMmDd,
        slotClassName: 'approval-route-slot'
      });
    }
    return (
      <StaticSlot hideHead alwaysFoot foot={draftShortMmDd} bodyClassName="approval-route-slot-body--drafter">
        {drafterName}
      </StaticSlot>
    );
  };

  const renderApproverSlots = () => {
    if (!hasApprovers) return null;
    return approvalLine.map((s, idx) =>
      renderApprovalSlot ? (
        renderApprovalSlot({
          slotKey: `step-${idx}`,
          stepIndex: idx,
          step: s,
          name: s.name || '—',
          foot: '',
          slotClassName: 'approval-route-slot'
        })
      ) : (
        <StaticSlot key={s.userId} hideHead alwaysFoot foot="">
          {s.name || '—'}
        </StaticSlot>
      )
    );
  };

  if (!showAgreementPanel && !showReferencePanel && !showApprovalPanel) {
    return null;
  }

  return (
    <div className={boardCls}>
      {showAgreementPanel ? (
      <div className={`approval-route-panel approval-route-panel--agreement${hasAgreement ? '' : ' approval-route-panel--pick-only'}`}>
        <PanelHead title="합의" {...editProps('agreement', '합의자 선택')} />
        {hasAgreement ? (
        <div className="approval-route-panel-body">
          <PersonLineTable
            rows={agreementLine}
            statusForRow={(s) => agreementStatusLabel(s.status)}
            deptLabel={refDeptLabel}
          />
        </div>
        ) : null}
      </div>
      ) : null}

      {showApprovalPanel ? (
      <div className="approval-route-panel approval-route-panel--approval">
        <PanelHead title="결재" {...editProps('approval', '결재자 선택')} />
        <div className="approval-route-panel-body">
        <div className="approval-route-approval-table">
          <div className="approval-route-band">
            <div className="approval-route-band-cell">기안</div>
            {hasApprovers ? (
              <div className="approval-route-band-cell approval-route-band-cell--merge">결재</div>
            ) : null}
          </div>
          <div className="approval-route-slot-row">
            {renderDrafterSlot()}
            {renderApproverSlots()}
          </div>
        </div>
        </div>
      </div>
      ) : null}

      {showReferencePanel ? (
      <div className={`approval-route-panel approval-route-panel--reference${hasReference ? '' : ' approval-route-panel--pick-only'}`}>
        <PanelHead title="참조" {...editProps('reference', '참조자 선택')} />
        {hasReference ? (
        <div className="approval-route-panel-body">
          <PersonLineTable
            rows={referenceLine}
            statusForRow={() => '참조'}
            deptLabel={refDeptLabel}
          />
        </div>
        ) : null}
      </div>
      ) : null}
    </div>
  );
}

export function mapPersonPickerLine(raw) {
  return (raw || []).map((p) => ({
    userId: String(p.userId),
    name: p.name || '',
    department: p.department || ''
  }));
}
