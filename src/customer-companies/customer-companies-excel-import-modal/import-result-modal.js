function renderInfoRows(rows) {
  return rows.filter((row) => String(row?.value || '').trim() !== '').map((row) => (
    <div key={row.label} style={{ fontSize: '0.72rem', color: '#64748b', lineHeight: 1.45 }}>
      <strong style={{ color: '#475569', fontWeight: 700 }}>{row.label}</strong> {row.value}
    </div>
  ));
}

import './import-result-dedupe.css';

/** 중복 목록은 수백 건일 수 있어 화면에는 앞부분만 보여 줍니다. */
const DUPLICATE_LIST_LIMIT = 100;

/** 사업자번호 충돌 카드 — 기업명 하나만 등록하거나, 모두 등록(뒤 기업명은 번호 비움) */
function BusinessNumberConflictCard({ conflict, resolution, disabled, onResolve }) {
  const selectedKeep = resolution?.mode === 'keep' ? resolution.nameKey : null;
  const selectedAll = resolution?.mode === 'all';
  const [first, ...rest] = conflict.options || [];
  return (
    <li className={`ird-conflict${resolution ? ' is-resolved' : ''}`}>
      <div className="ird-conflict-head">
        <span className="material-symbols-outlined" aria-hidden>
          {resolution ? 'task_alt' : 'help'}
        </span>
        <strong>{conflict.businessNumber}</strong>
        <span>기업명 {conflict.options.length}개가 같은 번호를 씁니다</span>
      </div>
      <div className="ird-options" role="radiogroup" aria-label={`${conflict.businessNumber} 처리 방법`}>
        {conflict.options.map((o) => (
          <button
            key={o.nameKey}
            type="button"
            role="radio"
            aria-checked={selectedKeep === o.nameKey}
            className={`ird-option${selectedKeep === o.nameKey ? ' is-selected' : ''}`}
            disabled={disabled}
            onClick={() => onResolve(conflict.bnKey, { mode: 'keep', nameKey: o.nameKey })}
          >
            <span className="ird-option-title">「{o.name}」만 등록</span>
            <span className="ird-option-meta">
              {o.rowCount}행{o.address ? ` · ${o.address}` : ''}
            </span>
          </button>
        ))}
        <button
          type="button"
          role="radio"
          aria-checked={selectedAll}
          className={`ird-option${selectedAll ? ' is-selected' : ''}`}
          disabled={disabled}
          onClick={() => onResolve(conflict.bnKey, { mode: 'all' })}
        >
          <span className="ird-option-title">모두 등록</span>
          <span className="ird-option-meta">
            번호는 「{first?.name}」에만 두고 {rest.map((o) => `「${o.name}」`).join(', ')}은 번호 없이 등록
          </span>
        </button>
      </div>
    </li>
  );
}

function describeDuplicate(item) {
  const dup = item?.duplicateOf || {};
  const target = String(dup.companyName || '').trim();
  if (dup.source === 'file') {
    const rowNo = Number.isFinite(Number(dup.rowIndex)) ? `${Number(dup.rowIndex) + 1}행` : '앞 행';
    return `파일 ${rowNo}${target ? `(${target})` : ''}과 사업자번호가 같습니다`;
  }
  return `이미 등록된 고객사${target ? ` 「${target}」` : ''}와 사업자번호가 같습니다`;
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
  /** 사업자번호 중복으로 건너뛴(건너뛸) 행 — 고객사 전용 */
  duplicateItems = [],
  /** 파일 안 같은 사업자번호·기업명이라 합친(합칠) 행 수 */
  mergedCount = 0,
  /** 합쳐지는 묶음의 대표 행 (mergedRowCount, fieldDiffs 포함) — 미리보기 전용 */
  mergeGroups = [],
  /** 사업자번호 충돌 목록 — 미리보기 전용 */
  conflicts = [],
  conflictResolutions = {},
  onResolveConflict,
  resolvingConflict = false,
  /** 충돌에서 선택하지 않은 기업명이라 건너뛴 행 수 */
  conflictSkipped = 0,
  /** 사업자번호 검증숫자가 틀려 번호 확인이 필요한 회사 */
  invalidBnItems = [],
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

  /** 사업자번호 충돌을 아직 고르지 않음 — "완료"로 보이면 안 됩니다 */
  const pendingConflicts = !isContact && isPreviewPhase && conflicts.some((c) => !conflictResolutions[c.bnKey]);

  const doneTitle = pendingConflicts
    ? '등록 전에 선택이 필요합니다'
    : isPreviewPhase
      ? failed > 0
        ? isContact ? '가져오기 완료 (검사 중 일부 오류)' : '등록 전 확인 (검사 중 일부 오류)'
        : isContact ? '가져오기 완료' : '등록 전 확인'
      : failed > 0
        ? '가져오기 완료 (일부 실패)'
        : '가져오기 완료';

  const doneSub = isPreviewPhase
    ? isContact
      ? `총 ${total}행 검사 완료 · 아직 MongoDB에는 저장되지 않았습니다. 중복·보류 그룹은 기본 규칙(기존 연락처 병합 또는 그룹 대표 행 기준)으로 반영되었습니다. 확인을 누르면 연락처가 일괄 등록됩니다.`
      : `총 ${total}행 검사 완료 · 아직 저장되지 않았습니다. 사업자번호가 이미 등록된 행은 건너뛰고, 파일 안에서 사업자번호·기업명이 같은 행은 한 곳으로 합칩니다(사업자번호가 없는 행은 기업명이 같아도 각각 등록). 확인을 누르면 주소 기준 위도·경도 계산 후 고객사가 등록됩니다.`
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
              style={{ color: pendingConflicts || failed > 0 ? '#f59e0b' : '#10b981' }}
            >
              {pendingConflicts ? 'help' : failed > 0 ? 'warning' : 'check_circle'}
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
              <p className="lc-crm-result-card-label">
                {isContact ? '스킵 (중복·빈 행)' : '스킵 (사업자번호 중복·빈 행)'}
              </p>
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

        {!isContact && isPreviewPhase && conflicts.length > 0 && (
          <div className="lc-crm-result-detail-section ird-section">
            <h3 className={`lc-crm-result-detail-title ${pendingConflicts ? 'skip' : 'success'}`}>
              <span className="material-symbols-outlined">{pendingConflicts ? 'help' : 'task_alt'}</span>
              {pendingConflicts
                ? `사업자번호 충돌 ${conflicts.length}건 — ${conflicts.filter((c) => !conflictResolutions[c.bnKey]).length}건 선택 필요`
                : `사업자번호 충돌 ${conflicts.length}건 — 선택 완료`}
            </h3>
            <p className="ird-hint">
              번호는 같은데 기업명이 달라 한쪽 번호가 틀렸을 수 있습니다. 어떻게 등록할지 골라 주세요.
            </p>
            <ul className="ird-conflicts">
              {conflicts.map((c) => (
                <BusinessNumberConflictCard
                  key={c.bnKey}
                  conflict={c}
                  resolution={conflictResolutions[c.bnKey]}
                  disabled={isRunning || resolvingConflict}
                  onResolve={onResolveConflict}
                />
              ))}
            </ul>
          </div>
        )}

        {!isContact && mergedCount > 0 && (
          <div className="lc-crm-result-detail-section ird-section">
            <h3 className="lc-crm-result-detail-title success">
              <span className="material-symbols-outlined">call_merge</span>
              {isPreviewPhase
                ? `같은 회사로 합칠 행 ${mergedCount}건 → ${mergeGroups.length}곳`
                : `같은 회사로 합친 행 ${mergedCount}건`}
            </h3>
            {isPreviewPhase ? (
              <>
                <p className="ird-hint">
                  사업자번호·기업명이 같은 행은 첫 행으로 등록하고 비어 있는 칸만 뒤 행 값으로 채웁니다.
                </p>
                <ul className="lc-crm-result-detail-list ird-scroll">
                  {mergeGroups.slice(0, DUPLICATE_LIST_LIMIT).map((g, i) => (
                    <li key={`merge-${g.rowIndex ?? i}`} className="lc-crm-result-detail-item ird-merge">
                      <div className="ird-merge-main">
                        <span className="lc-crm-result-detail-id">{rowLabel(g, i)}</span>
                        <span>{g.mergedRowCount + 1}행을 한 곳으로</span>
                      </div>
                      {g.fieldDiffs?.length ? (
                        <ul className="ird-diffs">
                          {g.fieldDiffs.map((d) => (
                            <li key={d.field}>
                              {d.label}: 값 {d.otherCount + 1}개 중 <strong>「{d.kept}」</strong> 사용
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {mergeGroups.length > DUPLICATE_LIST_LIMIT ? (
                  <p className="lc-crm-map-save-msg" style={{ margin: '0.35rem 0 0', color: '#64748b' }}>
                    외 {mergeGroups.length - DUPLICATE_LIST_LIMIT}곳
                  </p>
                ) : null}
              </>
            ) : null}
          </div>
        )}

        {!isContact && invalidBnItems.length > 0 && (
          <div className="lc-crm-result-detail-section ird-section">
            <h3 className="lc-crm-result-detail-title skip">
              <span className="material-symbols-outlined">pin</span>
              사업자번호 확인 필요 {invalidBnItems.length}곳
            </h3>
            <p className="ird-hint">
              검증숫자가 맞지 않는 번호입니다(오타·임시 번호). 번호가 같아도 기업명까지 같을 때만 같은 회사로 봅니다.
            </p>
            <ul className="lc-crm-result-detail-list ird-scroll">
              {invalidBnItems.slice(0, DUPLICATE_LIST_LIMIT).map((item, i) => (
                <li key={`bn-${item.rowIndex ?? i}`} className="lc-crm-result-detail-item skip">
                  <span className="lc-crm-result-detail-id">{rowLabel(item, i)}</span>
                  <span>{item.businessNumber || '번호'}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!isContact && !isPreviewPhase && conflictSkipped > 0 && (
          <p className="lc-crm-map-save-msg" style={{ margin: '0.5rem 0 0', color: '#64748b' }}>
            사업자번호 충돌에서 선택하지 않은 기업명 {conflictSkipped}행은 건너뛰었습니다.
          </p>
        )}

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
        {!isContact && duplicateItems.length > 0 && (
          <div className="lc-crm-result-detail-section">
            <h3 className="lc-crm-result-detail-title skip">
              <span className="material-symbols-outlined">content_copy</span>
              {isPreviewPhase
                ? `사업자번호 중복으로 건너뛸 ${duplicateItems.length}건`
                : `사업자번호 중복으로 건너뜀 ${duplicateItems.length}건`}
            </h3>
            <ul
              className="lc-crm-result-detail-list"
              style={{ maxHeight: '14rem', overflowY: 'auto', textAlign: 'left' }}
            >
              {duplicateItems.slice(0, DUPLICATE_LIST_LIMIT).map((item, i) => (
                <li key={`dup-${item.rowIndex ?? i}`} className="lc-crm-result-detail-item skip">
                  <span className="lc-crm-result-detail-id">{rowLabel(item, i)}</span>
                  <span>
                    {item.businessNumber ? `${item.businessNumber} · ` : ''}
                    {describeDuplicate(item)}
                  </span>
                </li>
              ))}
            </ul>
            {duplicateItems.length > DUPLICATE_LIST_LIMIT ? (
              <p className="lc-crm-map-save-msg" style={{ margin: '0.35rem 0 0', color: '#64748b' }}>
                외 {duplicateItems.length - DUPLICATE_LIST_LIMIT}건
              </p>
            ) : null}
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
          {!isContact && isPreviewPhase && conflicts.some((c) => !conflictResolutions[c.bnKey]) ? (
            <p className="lc-crm-map-save-msg" style={{ margin: 0, color: '#9a6a1c', fontWeight: 600 }}>
              위의 사업자번호 충돌을 모두 선택하면 확인을 누를 수 있습니다.
            </p>
          ) : null}
          {resolvingConflict ? (
            <p className="lc-crm-map-save-msg" style={{ margin: 0, color: '#64748b' }}>
              선택을 반영해 다시 계산하는 중…
            </p>
          ) : null}
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
