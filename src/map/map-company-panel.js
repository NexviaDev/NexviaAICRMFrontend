/**
 * 지도에서 마커 클릭 시 열리는 고객사 위치 정보 패널(모달)
 */
export default function MapCompanyPanel({ selected, onClose, onAddToCalendar, onViewDetail }) {
  return (
    <aside className={`map-side-panel ${selected ? 'open' : ''}`}>
      <div className="map-side-panel-header">
        <h2 className="map-side-panel-title">위치 정보</h2>
        <button
          type="button"
          className="map-side-panel-close"
          onClick={onClose}
          aria-label="닫기"
        >
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>
      {selected ? (
        <>
          <div className="map-side-panel-body">
            <div className="map-side-panel-content">
              <div className="map-side-panel-heading">
                <span className="map-side-panel-badge">활성 고객사</span>
                <h3 className="map-side-panel-company-name">{selected.name || '—'}</h3>
              </div>
              <div className="map-side-panel-details">
                <div className="map-side-panel-row">
                  <span className="material-symbols-outlined map-side-panel-row-icon">location_on</span>
                  <div className="map-side-panel-row-text">
                    <p>{selected.address || '—'}</p>
                  </div>
                </div>
                <div className="map-side-panel-row">
                  <span className="material-symbols-outlined map-side-panel-row-icon">business</span>
                  <div className="map-side-panel-row-text">
                    <p>{selected.representativeName ? `대표: ${selected.representativeName}` : '—'}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="map-side-panel-footer">
            <button
              type="button"
              className="map-side-panel-btn map-side-panel-btn-primary"
              onClick={onAddToCalendar}
            >
              <span className="material-symbols-outlined">event</span>
              일정에 추가
            </button>
            <button
              type="button"
              className="map-side-panel-btn map-side-panel-btn-outline"
              onClick={onViewDetail}
            >
              <span className="material-symbols-outlined">visibility</span>
              상세 보기
            </button>
          </div>
        </>
      ) : (
        <div className="map-side-panel-empty">
          <span className="material-symbols-outlined map-side-panel-empty-icon">location_on</span>
          <p>지도에서 마커를 클릭하면 고객사 정보를 볼 수 있습니다.</p>
        </div>
      )}
    </aside>
  );
}
