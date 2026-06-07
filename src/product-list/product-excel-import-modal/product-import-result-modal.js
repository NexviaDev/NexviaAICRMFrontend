import '../../lead-capture/lead-capture-crm-mapping/lead-capture-crm-mapping-modal.css';

/**
 * @param {{
 *   result: {
 *     totalRows: number;
 *     success: number;
 *     skipped: number;
 *     failed: number;
 *     fileName?: string;
 *     successSamples?: { rowIndex: number; name: string }[];
 *     failedItems?: { rowIndex: number; name: string; error: string }[];
 *   };
 *   onConfirm: () => void;
 * }} props
 */
export default function ProductImportResultModal({ result, onConfirm }) {
  const {
    totalRows = 0,
    success = 0,
    skipped = 0,
    failed = 0,
    fileName = '',
    successSamples = [],
    failedItems = []
  } = result || {};

  const hasFailed = failed > 0;
  const title = hasFailed ? '가져오기 완료 (일부 실패)' : '가져오기 완료';
  const sub = fileName
    ? `파일 「${fileName}」 · 총 ${totalRows}행 처리 · 제품 리스트`
    : `총 ${totalRows}행 처리 · 제품 리스트`;

  return (
    <div className="lc-crm-map-overlay" role="dialog" aria-modal="true" aria-labelledby="pl-excel-result-title">
      <div className="lc-crm-result-panel" onClick={(e) => e.stopPropagation()}>
        <div className="lc-crm-result-icon-wrap">
          <span
            className="material-symbols-outlined lc-crm-result-icon"
            style={{ color: hasFailed ? '#f59e0b' : '#10b981' }}
          >
            {hasFailed ? 'warning' : 'check_circle'}
          </span>
        </div>
        <h2 className="lc-crm-result-title" id="pl-excel-result-title">
          {title}
        </h2>
        <p className="lc-crm-result-sub">{sub}</p>

        <div className="lc-crm-result-cards">
          <div className="lc-crm-result-card success">
            <span className="material-symbols-outlined">check_circle</span>
            <div>
              <p className="lc-crm-result-card-num">{success}건</p>
              <p className="lc-crm-result-card-label">등록 성공</p>
            </div>
          </div>
          <div className="lc-crm-result-card skip">
            <span className="material-symbols-outlined">skip_next</span>
            <div>
              <p className="lc-crm-result-card-num">{skipped}건</p>
              <p className="lc-crm-result-card-label">건너뜀 (빈 행·제품명 없음)</p>
            </div>
          </div>
          <div className="lc-crm-result-card fail">
            <span className="material-symbols-outlined">error</span>
            <div>
              <p className="lc-crm-result-card-num">{failed}건</p>
              <p className="lc-crm-result-card-label">실패</p>
            </div>
          </div>
        </div>

        {successSamples.length > 0 ? (
          <div className="lc-crm-result-detail-section">
            <h3 className="lc-crm-result-detail-title success">
              <span className="material-symbols-outlined">inventory_2</span>
              등록된 제품 예시 {successSamples.length > 10 ? '(최대 10건)' : ''}
            </h3>
            <ul className="lc-crm-result-detail-list">
              {successSamples.slice(0, 10).map((item) => (
                <li key={`ok-${item.rowIndex}`} className="lc-crm-result-detail-item success">
                  <span className="lc-crm-result-detail-id">
                    {item.rowIndex + 1}행
                  </span>
                  <span>{item.name || '—'}</span>
                </li>
              ))}
            </ul>
            {success > successSamples.length ? (
              <p className="lc-crm-map-save-msg" style={{ margin: '0.35rem 0 0', color: '#64748b' }}>
                외 {success - Math.min(successSamples.length, 10)}건이 더 등록되었습니다.
              </p>
            ) : null}
          </div>
        ) : null}

        {failedItems.length > 0 ? (
          <div className="lc-crm-result-detail-section">
            <h3 className="lc-crm-result-detail-title fail">
              <span className="material-symbols-outlined">error</span>
              실패 상세
            </h3>
            <ul className="lc-crm-result-detail-list">
              {failedItems.slice(0, 15).map((item) => (
                <li key={`fail-${item.rowIndex}`} className="lc-crm-result-detail-item fail">
                  <span className="lc-crm-result-detail-id">
                    {item.rowIndex + 1}행 {item.name ? `· ${item.name}` : ''}
                  </span>
                  <span>{item.error || '알 수 없는 오류'}</span>
                </li>
              ))}
            </ul>
            {failedItems.length > 15 ? (
              <p className="lc-crm-map-save-msg" style={{ margin: '0.35rem 0 0', color: '#64748b' }}>
                외 {failedItems.length - 15}건의 실패가 더 있습니다.
              </p>
            ) : null}
          </div>
        ) : null}

        <div style={{ marginTop: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
          <p className="lc-crm-map-save-msg" style={{ margin: 0, color: '#475569', lineHeight: 1.5 }}>
            확인을 누르면 결과 화면과 매핑 창이 모두 닫힙니다.
          </p>
          <button type="button" className="lc-crm-result-confirm" onClick={onConfirm}>
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
