function buildExistingCandidatesForGroup(group) {
  const map = new Map();
  (group?.items || []).forEach((item) => {
    const list = Array.isArray(item?.conflictCandidates) ? item.conflictCandidates : [];
    list.forEach((candidate) => {
      const id = String(candidate?.companyId || '').trim();
      if (!id || map.has(id)) return;
      map.set(id, {
        companyId: id,
        name: candidate?.name || '',
        businessNumber: candidate?.businessNumber || '',
        representativeName: candidate?.representativeName || '',
        address: candidate?.address || '',
        code: candidate?.code || '',
        status: candidate?.status || '',
        memo: candidate?.memo || '',
        customFields: candidate?.customFields && typeof candidate.customFields === 'object' ? candidate.customFields : {}
      });
    });
  });
  return Array.from(map.values());
}

function buildExistingCandidatesForContactGroup(group) {
  const map = new Map();
  (group?.items || []).forEach((item) => {
    const list = Array.isArray(item?.conflictCandidates) ? item.conflictCandidates : [];
    list.forEach((candidate) => {
      const id = String(candidate?.employeeId || '').trim();
      if (!id || map.has(id)) return;
      map.set(id, {
        employeeId: id,
        name: candidate?.name || '',
        email: candidate?.email || '',
        phone: candidate?.phone || '',
        position: candidate?.position || '',
        companyName: candidate?.companyName || '',
        address: candidate?.address || '',
        status: candidate?.status || '',
        memo: candidate?.memo || '',
        customFields: candidate?.customFields && typeof candidate.customFields === 'object' ? candidate.customFields : {}
      });
    });
  });
  return Array.from(map.values());
}

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
  visibleHoldGroups,
  showHoldList,
  onToggleHoldList,
  holdGroupSelection,
  updateHoldGroupSelection,
  onApplyHoldGroup,
  saving,
  canConfirmPreview,
  onConfirm,
  saveMsg,
  /** 'company' | 'contact' — 연락처 엑셀은 'contact' */
  variant = 'company'
}) {
  const isContact = variant === 'contact';
  const saveMsgIsError = saveMsg && (saveMsg.includes('실패') || saveMsg.includes('남아') || saveMsg.includes('먼저'));
  const rowLabel = (item, i) =>
    String(isContact ? item.contactName || '' : item.companyName || '').trim() || `행 ${(item.rowIndex ?? i) + 1}`;

  return (
    <div className="lc-crm-map-overlay" role="dialog" aria-modal="true">
      <div className="lc-crm-result-panel" onClick={(e) => e.stopPropagation()}>
        <div className="lc-crm-result-icon-wrap">
          <span
            className="material-symbols-outlined lc-crm-result-icon"
            style={{ color: failed > 0 ? '#f59e0b' : '#10b981' }}
          >
            {failed > 0 ? 'warning' : 'check_circle'}
          </span>
        </div>
        <h2 className="lc-crm-result-title">
          {isPreviewPhase
            ? failed > 0
              ? '가져오기 완료 (검사 중 일부 오류)'
              : '가져오기 완료'
            : failed > 0
              ? '가져오기 완료 (일부 실패)'
              : '가져오기 완료'}
        </h2>
        <p className="lc-crm-result-sub">
          {isPreviewPhase
            ? isContact
              ? `총 ${total}행 검사 완료 · 아직 MongoDB에는 저장되지 않았습니다. 보류를 모두 적용한 뒤 확인을 누르면 그때 연락처가 일괄 등록됩니다.`
              : `총 ${total}행 검사 완료 · 아직 MongoDB에는 저장되지 않았습니다. 보류를 모두 적용한 뒤 확인을 누르면, 그때 add-company 모달과 같은 방식으로 주소 기준 위도·경도를 계산한 후 등록합니다.`
            : isContact
              ? `총 ${total}행 처리 · 연락처 목록`
              : `총 ${total}행 처리 · 고객사 리스트`}
        </p>

        <div className="lc-crm-result-cards">
          <div className="lc-crm-result-card success">
            <span className="material-symbols-outlined">check_circle</span>
            <div>
              <p className="lc-crm-result-card-num">
                {isPreviewPhase ? `${previewReadyCount}건` : `${completedTotal}건`}
              </p>
              <p className="lc-crm-result-card-label">
                {isPreviewPhase ? '처리 예정 (신규+보류적용)' : '완료 처리'}
              </p>
            </div>
          </div>
          <div className="lc-crm-result-card skip">
            <span className="material-symbols-outlined">content_copy</span>
            <div>
              <p className="lc-crm-result-card-num">{skipped}건</p>
              <p className="lc-crm-result-card-label">스킵 (중복·빈 행)</p>
            </div>
          </div>
          <div className="lc-crm-result-card fail">
            <span className="material-symbols-outlined">error</span>
            <div>
              <p className="lc-crm-result-card-num">{failed}건</p>
              <p className="lc-crm-result-card-label">실패</p>
            </div>
          </div>
          <div className="lc-crm-result-card warn">
            <span className="material-symbols-outlined">pending</span>
            <div>
              <p className="lc-crm-result-card-num">{onHold}건</p>
              <p className="lc-crm-result-card-label">
                {isPreviewPhase ? '보류 (해결 필요)' : '보류'}
              </p>
            </div>
          </div>
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

        {skippedDup > 0 && (
          <div className="lc-crm-result-detail-section">
            <h3 className="lc-crm-result-detail-title skip">
              <span className="material-symbols-outlined">content_copy</span>
              {isContact ? '중복 스킵 (이름+전화 동일)' : '중복 스킵 (이름+사업자번호 동일)'}
            </h3>
            <p className="lc-crm-map-save-msg" style={{ marginTop: '0.5rem' }}>
              빈 행 {emptySk}건은 자동으로 건너뛰었습니다.
            </p>
          </div>
        )}

        {successItems.length > 0 && (
          <div className="lc-crm-result-detail-section">
            <h3 className="lc-crm-result-detail-title success">
              <span className="material-symbols-outlined">check_circle</span>
              {isPreviewPhase ? `신규 등록 예정 ${successItems.length}건` : `신규 등록 ${successItems.length}건`}
            </h3>
          </div>
        )}

        {isPreviewPhase && stagedResolvedItems.length > 0 && (
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

        {isPreviewPhase && visibleHoldGroups.length > 0 && (
          <div className="lc-crm-result-detail-section">
            <h3 className="lc-crm-result-detail-title skip" style={{ justifyContent: 'space-between' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                <span className="material-symbols-outlined">pending</span>
                보류 {visibleHoldGroups.reduce((acc, group) => acc + group.items.length, 0)}건
              </span>
              <button
                type="button"
                className="lc-crm-map-btn-discard"
                onClick={onToggleHoldList}
                style={{ minWidth: 0, padding: '0.35rem 0.65rem' }}
              >
                {showHoldList ? '숨기기' : '목록 보기'}
              </button>
            </h3>
            {showHoldList && (
              <div>
                {visibleHoldGroups.map((group) => {
                  const existingCandidates = isContact
                    ? buildExistingCandidatesForContactGroup(group)
                    : buildExistingCandidatesForGroup(group);
                  const selected = holdGroupSelection[group.key] || null;
                  return (
                    <div
                      key={group.key}
                      className="lc-crm-result-detail-section"
                      style={{ marginTop: '0.6rem', padding: '0.65rem', border: '1px solid #e2e8f0', borderRadius: '0.6rem' }}
                    >
                      <h4 style={{ margin: 0, fontSize: '0.85rem', color: '#334155' }}>
                        {isContact ? '연락처 그룹' : '사업자번호 그룹'}: {group.businessNumber || '미기입'}
                      </h4>
                      <p style={{ margin: '0.25rem 0 0.55rem', fontSize: '0.75rem', color: '#64748b' }}>
                        {isContact
                          ? '이 그룹에서 하나만 선택하면 그 연락처를 기준으로 나머지 행은 병합됩니다. (기존 DB 연락처가 있으면 우선 표시됩니다.)'
                          : '이 그룹에서 1개만 체크하면 해당 업체를 기준으로 나머지는 합쳐집니다. (기존 업체 우선)'}
                      </p>
                      {existingCandidates.length > 0 && (
                        <>
                          <h5 style={{ margin: '0 0 0.35rem', fontSize: '0.78rem', color: '#475569' }}>
                            {isContact ? '기존 DB 연락처' : '기존 DB 업체'}
                          </h5>
                          <ul className="lc-crm-result-detail-list">
                            {isContact
                              ? existingCandidates.map((candidate) => {
                                const checked =
                                  selected?.type === 'existing' && String(selected?.key) === String(candidate.employeeId);
                                return (
                                  <li key={`existing-${candidate.employeeId}`} className="lc-crm-result-detail-item success">
                                    <label style={{ display: 'inline-flex', alignItems: 'flex-start', gap: '0.45rem', width: '100%' }}>
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() =>
                                          updateHoldGroupSelection(group.key, {
                                            type: 'existing',
                                            key: String(candidate.employeeId)
                                          })}
                                      />
                                      <span style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                                        <span>
                                          {candidate.name || '(이름없음)'} · {candidate.phone || '-'} ·{' '}
                                          {candidate.email || '-'}
                                        </span>
                                        {renderInfoRows([
                                          { label: '회사명', value: candidate.companyName },
                                          { label: '직책', value: candidate.position },
                                          { label: '상태', value: candidate.status },
                                          { label: '주소', value: candidate.address },
                                          { label: '메모', value: candidate.memo }
                                        ])}
                                        {renderCustomFieldRows(candidate.customFields)}
                                      </span>
                                    </label>
                                  </li>
                                );
                              })
                              : existingCandidates.map((candidate) => {
                                const checked =
                                  selected?.type === 'existing' && String(selected?.key) === String(candidate.companyId);
                                return (
                                  <li key={`existing-${candidate.companyId}`} className="lc-crm-result-detail-item success">
                                    <label style={{ display: 'inline-flex', alignItems: 'flex-start', gap: '0.45rem', width: '100%' }}>
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() =>
                                          updateHoldGroupSelection(group.key, {
                                            type: 'existing',
                                            key: String(candidate.companyId)
                                          })}
                                      />
                                      <span style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                                        <span>{candidate.name || '(이름없음)'} / {candidate.businessNumber || '-'}</span>
                                        {renderInfoRows([
                                          { label: '대표자', value: candidate.representativeName },
                                          { label: '상태', value: candidate.status },
                                          { label: '코드', value: candidate.code },
                                          { label: '주소', value: candidate.address },
                                          { label: '메모', value: candidate.memo }
                                        ])}
                                        {renderCustomFieldRows(candidate.customFields)}
                                      </span>
                                    </label>
                                  </li>
                                );
                              })}
                          </ul>
                        </>
                      )}
                      <h5 style={{ margin: '0.45rem 0 0.35rem', fontSize: '0.78rem', color: '#475569' }}>
                        {isContact ? '이번 업로드 해당 행' : '이번 업로드 문제 업체'}
                      </h5>
                      <ul className="lc-crm-result-detail-list">
                        {group.items.map((item, i) => {
                          const checked = selected?.type === 'hold' && String(selected?.key) === String(item.rowIndex);
                          return (
                            <li key={String(item.rowIndex)} className="lc-crm-result-detail-item skip">
                              <label style={{ display: 'inline-flex', alignItems: 'flex-start', gap: '0.45rem', width: '100%' }}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => updateHoldGroupSelection(group.key, { type: 'hold', key: String(item.rowIndex) })}
                                />
                                <span style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                                  <span>
                                    {rowLabel(item, i)}
                                    {item.reason ? ` — 사유: ${item.reason}` : ''}
                                  </span>
                                  {isContact
                                    ? renderInfoRows([
                                      { label: '이메일', value: item?.contactPayload?.email },
                                      { label: '전화', value: item?.contactPayload?.phone },
                                      { label: '회사명', value: item?.contactPayload?.companyName },
                                      { label: '직책', value: item?.contactPayload?.position },
                                      { label: '상태', value: item?.contactPayload?.status },
                                      { label: '주소', value: item?.contactPayload?.address },
                                      { label: '메모', value: item?.contactPayload?.memo }
                                    ])
                                    : renderInfoRows([
                                      { label: '대표자', value: item?.companyPayload?.representativeName },
                                      { label: '상태', value: item?.companyPayload?.status },
                                      { label: '코드', value: item?.companyPayload?.code },
                                      { label: '주소', value: item?.companyPayload?.address },
                                      { label: '메모', value: item?.companyPayload?.memo }
                                    ])}
                                  {renderCustomFieldRows(
                                    isContact ? item?.contactPayload?.customFields : item?.companyPayload?.customFields
                                  )}
                                </span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.55rem', position: 'relative', zIndex: 2 }}>
                        <button
                          type="button"
                          className="lc-crm-result-confirm"
                          onClick={() => onApplyHoldGroup(group)}
                          style={{ minWidth: '7.5rem', width: 'auto', marginTop: 0, position: 'relative', zIndex: 3, pointerEvents: 'auto' }}
                        >
                          이 그룹 적용
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div style={{ marginTop: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
          <p className="lc-crm-map-save-msg" style={{ margin: 0, color: '#475569', lineHeight: 1.5 }}>
            {isPreviewPhase
              ? (
                saving
                  ? isContact
                    ? '확인 버튼을 누른 뒤 MongoDB에 연락처를 저장합니다.'
                    : '확인 버튼을 누른 뒤 주소 기준 위도·경도를 계산하고 MongoDB 저장을 시작합니다.'
                  : canConfirmPreview
                    ? isContact
                      ? '보류 카드가 모두 사라졌습니다. 확인을 누르면 연락처가 저장됩니다.'
                      : '보류 카드가 모두 사라졌습니다. 확인을 누르면 그때 위도·경도 계산 후 저장합니다.'
                    : '보류 카드를 모두 적용해 사라지게 만든 뒤 확인을 눌러 주세요. 확인 전에는 MongoDB에 저장되지 않습니다.'
              )
              : '처리가 끝났습니다. 확인을 누르면 결과 화면을 닫습니다.'}
          </p>
          <button
            type="button"
            className="lc-crm-result-confirm"
            onClick={onConfirm}
            disabled={saving || (isPreviewPhase && !canConfirmPreview)}
          >
            확인
          </button>
        </div>
        {saveMsg && (
          <p className={`lc-crm-map-save-msg ${saveMsgIsError ? 'err' : ''}`}>
            {saveMsg}
          </p>
        )}
      </div>
    </div>
  );
}
