import './approval-content-sheet.css';

export function ApprovalContentSheet({ title, headerAction, children, className = '' }) {
  const rootClass = ['approval-sheet', 'approval-sheet--panel', className].filter(Boolean).join(' ');
  return (
    <div className={rootClass}>
      <div className="approval-sheet-head">
        <span className="approval-sheet-head-title">{title}</span>
        {headerAction}
      </div>
      <div className="approval-sheet-body">{children}</div>
    </div>
  );
}

export function ApprovalSheetRow({ label, children }) {
  return (
    <div className="approval-sheet-row">
      <span className="approval-sheet-label">{label}</span>
      <div className="approval-sheet-cell">{children}</div>
    </div>
  );
}

/** 기ain 정보·휴가 내역 등 2칸(라벨·값 ×2) 한 줄 */
export function ApprovalSheetPairRow({ children, wide = false }) {
  const cls = ['approval-sheet-pair-row', wide ? 'approval-sheet-pair-row--wide' : ''].filter(Boolean).join(' ');
  return <div className={cls}>{children}</div>;
}

export function ApprovalSheetPair({ label, children }) {
  return (
    <>
      <span className="approval-sheet-label">{label}</span>
      <div className="approval-sheet-cell">{children}</div>
    </>
  );
}

export function ApprovalSheetReadonly({ value, multiline }) {
  const text = value == null || value === '' ? '—' : String(value);
  const empty = text === '—';
  const cls = [
    'approval-sheet-field',
    multiline ? 'approval-sheet-field--multiline' : '',
    empty ? 'approval-sheet-field--empty' : ''
  ].filter(Boolean).join(' ');
  return <span className={cls}>{text}</span>;
}

export function ApprovalSheetCellStack({ children }) {
  return <div className="approval-sheet-cell-inner">{children}</div>;
}
