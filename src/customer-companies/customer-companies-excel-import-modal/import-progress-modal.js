import '../../lead-capture/lead-capture-crm-mapping/lead-capture-crm-mapping-modal.css';

export default function ImportProgressModal({ inProgressJob }) {
  const stats = inProgressJob?.processingStats || {};
  const percent = Number.isFinite(stats.percent)
    ? stats.percent
    : (inProgressJob?.totalRows
        ? Math.floor(((inProgressJob.processedRows || 0) / inProgressJob.totalRows) * 100)
        : 0);
  const recentSuccess = Array.isArray(stats.recentSuccess) ? stats.recentSuccess : [];
  const recentFailed = Array.isArray(stats.recentFailed) ? stats.recentFailed : [];
  const recentHold = Array.isArray(stats.recentHold) ? stats.recentHold : [];
  const toName = (entry) => (typeof entry === 'string' ? entry : (entry?.name || ''));
  const toReason = (entry) => (typeof entry === 'string' ? '' : (entry?.reason || ''));

  return (
    <div className="lc-crm-map-overlay" role="dialog" aria-modal="true">
      <div className="lc-crm-result-panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '56rem', width: 'min(96vw, 56rem)' }}>
        <div className="lc-crm-result-icon-wrap">
          <span className="material-symbols-outlined lc-crm-result-icon" style={{ color: '#3d5a80' }}>
            schedule
          </span>
        </div>
        <h2 className="lc-crm-result-title">매핑 처리 중입니다</h2>
        <p className="lc-crm-result-sub">
          {inProgressJob?.totalRows != null ? `총 ${inProgressJob.totalRows}행` : ''} · 처리 {inProgressJob?.processedRows || 0}행 · {percent}%
        </p>
        <div className="lc-crm-map-bar" style={{ margin: '0.25rem 0 1rem' }}>
          <div style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
        </div>
        <div className="lc-crm-result-cards" style={{ marginTop: '0.5rem' }}>
          <div className="lc-crm-result-card success">
            <span className="material-symbols-outlined">check_circle</span>
            <div>
              <p className="lc-crm-result-card-num">{stats.created ?? 0}건</p>
              <p className="lc-crm-result-card-label">성공</p>
            </div>
          </div>
          <div className="lc-crm-result-card fail">
            <span className="material-symbols-outlined">error</span>
            <div>
              <p className="lc-crm-result-card-num">{stats.failed ?? 0}건</p>
              <p className="lc-crm-result-card-label">실패</p>
            </div>
          </div>
          <div className="lc-crm-result-card warn">
            <span className="material-symbols-outlined">pending</span>
            <div>
              <p className="lc-crm-result-card-num">{stats.onHold ?? 0}건</p>
              <p className="lc-crm-result-card-label">보류</p>
            </div>
          </div>
        </div>
        <div className="lc-crm-result-detail-section" style={{ marginTop: '0.75rem' }}>
          <h3 className="lc-crm-result-detail-title success"><span className="material-symbols-outlined">check_circle</span>성공 업체 (최근)</h3>
          <ul className="lc-crm-result-detail-list">
            {recentSuccess.length
              ? recentSuccess.map((entry, idx) => (
                  <li key={`s-${idx}`} className="lc-crm-result-detail-item success"><span>{toName(entry)}</span></li>
                ))
              : <li className="lc-crm-result-detail-item">아직 없음</li>}
          </ul>
          <h3 className="lc-crm-result-detail-title fail" style={{ marginTop: '0.6rem' }}><span className="material-symbols-outlined">error</span>실패 업체 (최근)</h3>
          <ul className="lc-crm-result-detail-list">
            {recentFailed.length
              ? recentFailed.map((entry, idx) => (
                  <li key={`f-${idx}`} className="lc-crm-result-detail-item fail">
                    <span>{toName(entry)}{toReason(entry) ? ` — ${toReason(entry)}` : ''}</span>
                  </li>
                ))
              : <li className="lc-crm-result-detail-item">아직 없음</li>}
          </ul>
          <h3 className="lc-crm-result-detail-title skip" style={{ marginTop: '0.6rem' }}><span className="material-symbols-outlined">pending</span>보류 업체 (최근)</h3>
          <ul className="lc-crm-result-detail-list">
            {recentHold.length
              ? recentHold.map((entry, idx) => (
                  <li key={`h-${idx}`} className="lc-crm-result-detail-item skip">
                    <span>{toName(entry)}{toReason(entry) ? ` — ${toReason(entry)}` : ''}</span>
                  </li>
                ))
              : <li className="lc-crm-result-detail-item">아직 없음</li>}
          </ul>
        </div>
        <p className="lc-crm-map-lead-hint" style={{ textAlign: 'left', marginBottom: '1rem' }}>
          작업이 끝나면 이 창에서 실패/보류 목록을 바로 확인할 수 있습니다. 처리 중에는 닫기 대신 잠시 기다려 주세요.
        </p>
        <button type="button" className="lc-crm-result-confirm" disabled>
          처리 중…
        </button>
      </div>
    </div>
  );
}
