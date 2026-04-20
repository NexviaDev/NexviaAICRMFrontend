function renderInfoRows(rows) {
  return rows.filter((row) => String(row?.value || '').trim() !== '').map((row) => (
    <div key={row.label} style={{ fontSize: '0.72rem', color: '#64748b', lineHeight: 1.45 }}>
      <strong style={{ color: '#475569', fontWeight: 700 }}>{row.label}</strong> {row.value}
    </div>
  ));
}

function renderCustomFieldRows(customFields) {
  return Object.entries(customFields || {})
    .filter(([, value]) => value != null && String(value).trim() !== '')
    .map(([key, value]) => (
      <div key={key} style={{ fontSize: '0.72rem', color: '#64748b', lineHeight: 1.45 }}>
        <strong style={{ color: '#475569', fontWeight: 700 }}>{key}</strong> {String(value)}
      </div>
    ));
}

export default function ImportResultModal({
  isPreviewPhase,
  failed,
  total,
  previewReadyCount,
  completedTotal,
  skipped,
  onHold,
  failedItems,
  skippedDup,
  emptySk,
  successItems,
  stagedResolvedItems,
  saving,
  canConfirmPreview,
  onConfirm,
  saveMsg,
  /** 'company' | 'contact' — 연락처 엑셀은 'contact' */
  variant = 'company'
}) {
  const isContact = variant === 'contact';
  const isRunning = !!saving;
  const saveMsgIsError = saveMsg && (saveMsg.includes('실패') || saveMsg.includes('남아') || saveMsg.includes('먼저'));
  const rowLabel = (item, i) =>
    String(isContact ? item.contactName || '' : item.companyName || '').trim() || `행 ${(item.rowIndex ?? i) + 1}`;

  const doneTitle = isPreviewPhase
    ? failed > 0
      ? '가져오기 완료 (검사 중 일부 오류)'
      : '가져오기 완료'
    : failed > 0
      ? '가져오기 완료 (일부 실패)'
      : '가져오기 완료';

  const doneSub = isPreviewPhase
    ? isContact
      ? `총 ${total}행 검사 완료 · 아직 MongoDB에는 저장되지 않았습니다. 중복·보류 그룹은 기본 규칙(기존 연락처 병합 또는 그룹 대표 행 기준)으로 반영되었습니다. 확인을 누르면 연락처가 일괄 등록됩니다.`
      : `총 ${total}행 검사 완료 · 아직 MongoDB에는 저장되지 않았습니다. 중복·보류 그룹은 기본 규칙(기존 고객사 병합 또는 그룹 대표 행 기준)으로 반영되었습니다. 확인을 누르면 주소 기준 위도·경도 계산 후 고객사가 등록됩니다.`
    : isContact
      ? `총 ${total}행 처리 · 연락처 목록`
      : `총 ${total}행 처리 · 고객사 리스트`;

  const runningSub =
    saveMsg && String(saveMsg).trim()
      ? saveMsg
      : isContact
        ? '연락처를 서버에 반영하는 중입니다. 잠시만 기다려 주세요.'
        : '위도·경도 계산 또는 서버 등록이 진행 중입니다. 잠시만 기다려 주세요.';

  return (
    <div className="lc-crm-map-overlay" role="dialog" aria-modal="true">
      <div
        className={`lc-crm-result-panel${isRunning ? ' lc-crm-result-panel--running' : ''}`}
        onClick={(e) => e.stopPropagation()}
        aria-busy={isRunning}
      >
        <div className="lc-crm-result-icon-wrap">
          {isRunning ? (
            <div className="lc-crm-result-spinner" role="status" aria-live="polite" aria-label="처리 중" />
          ) : (
            <span
              className="material-symbols-outlined lc-crm-result-icon"
              style={{ color: failed > 0 ? '#f59e0b' : '#10b981' }}
            >
              {failed > 0 ? 'warning' : 'check_circle'}
            </span>
          )}
        </div>
        <h2 className="lc-crm-result-title">{isRunning ? '실행 중입니다…' : doneTitle}</h2>
        <p className="lc-crm-result-sub">{isRunning ? runningSub : doneSub}</p>

        <div className="lc-crm-result-cards">
          <div className="lc-crm-result-card success">
            <span className="material-symbols-outlined">check_circle</span>
            <div>
              <p className="lc-crm-result-card-num">
                {isPreviewPhase ? `${previewReadyCount}건` : `${completedTotal}건`}
              </p>
              <p className="lc-crm-result-card-label">
                {isPreviewPhase ? (isContact ? '처리 예정 (신규+보류적용)' : '처리 예정 (신규)') : '완료 처리'}
              </p>
            </div>
          </div>
          <div className="lc-crm-result-card skip">
            <span className="material-symbols-outlined">content_copy</span>
            <div>
              <p className="lc-crm-result-card-num">{skipped}건</p>
              <p className="lc-crm-result-card-label">{isContact ? '스킵 (중복·빈 행)' : '스킵 (빈 행)'}</p>
            </div>
          </div>
          <div className="lc-crm-result-card fail">
            <span className="material-symbols-outlined">error</span>
            <div>
              <p className="lc-crm-result-card-num">{failed}건</p>
              <p className="lc-crm-result-card-label">실패</p>
            </div>
          </div>
          {(isContact ? onHold > 0 : false) && (
            <div className="lc-crm-result-card warn">
              <span className="material-symbols-outlined">pending</span>
              <div>
                <p className="lc-crm-result-card-num">{onHold}건</p>
                <p className="lc-crm-result-card-label">
                  {isPreviewPhase ? '보류 (해결 필요)' : '보류'}
                </p>
              </div>
            </div>
          )}
        </div>

        {failedItems.length > 0 && (
          <div className="lc-crm-result-detail-section">
            <h3 className="lc-crm-result-detail-title fail">
              <span className="material-symbols-outlined">error</span>
              실패 상세
            </h3>
            <ul className="lc-crm-result-detail-list">
              {failedItems.map((item, i) => (
                <li key={i} className="lc-crm-result-detail-item fail">
                  <span className="lc-crm-result-detail-id">
                    {rowLabel(item, i)}
                  </span>
                  <span>{item.error || '알 수 없는 오류'}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {isContact && skippedDup > 0 && (
          <div className="lc-crm-result-detail-section">
            <h3 className="lc-crm-result-detail-title skip">
              <span className="material-symbols-outlined">content_copy</span>
              중복 스킵 (이름+전화 동일)
            </h3>
          </div>
        )}
        {emptySk > 0 && (
          <p className="lc-crm-map-save-msg" style={{ margin: '0.5rem 0 0', color: '#64748b' }}>
            빈 행 {emptySk}건은 자동으로 건너뛰었습니다.
          </p>
        )}

        {successItems.length > 0 && (
          <div className="lc-crm-result-detail-section">
            <h3 className="lc-crm-result-detail-title success">
              <span className="material-symbols-outlined">check_circle</span>
              {isPreviewPhase ? `신규 등록 예정 ${successItems.length}건` : `신규 등록 ${successItems.length}건`}
            </h3>
          </div>
        )}

        {isPreviewPhase && isContact && stagedResolvedItems.length > 0 && (
          <div className="lc-crm-result-detail-section">
            <h3 className="lc-crm-result-detail-title success">
              <span className="material-symbols-outlined">task_alt</span>
              보류 적용 완료 {stagedResolvedItems.length}건
            </h3>
            <ul className="lc-crm-result-detail-list">
              {stagedResolvedItems.map((item, i) => (
                <li key={`resolved-${item.rowIndex ?? i}`} className="lc-crm-result-detail-item success">
                  <span className="lc-crm-result-detail-id">
                    {rowLabel(item, i)}
                  </span>
                  <span>확인 버튼을 누르면 이 설정대로 등록됩니다.</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div style={{ marginTop: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
          {!isRunning ? (
            <p className="lc-crm-map-save-msg" style={{ margin: 0, color: '#475569', lineHeight: 1.5 }}>
              {isPreviewPhase
                ? (
                  isContact
                    ? '확인을 누르면 연락처가 일괄 등록됩니다.'
                    : '확인을 누르면 주소 기준 위도·경도를 계산한 후 고객사가 등록됩니다.'
                )
                : '처리가 끝났습니다. 확인을 누르면 결과 화면을 닫습니다.'}
            </p>
          ) : (
            <p className="lc-crm-map-save-msg" style={{ margin: 0, color: '#64748b', fontSize: '0.78rem', lineHeight: 1.5 }}>
              완료되면 요약이 갱신되고 확인 버튼이 다시 눌리게 됩니다.
            </p>
          )}
          <button
            type="button"
            className="lc-crm-result-confirm"
            onClick={onConfirm}
            disabled={saving || (isPreviewPhase && !canConfirmPreview)}
          >
            확인
          </button>
        </div>
        {saveMsg && !isRunning && (
          <p className={`lc-crm-map-save-msg ${saveMsgIsError ? 'err' : ''}`}>
            {saveMsg}
          </p>
        )}
      </div>
    </div>
  );
}
