import { useMemo, useCallback } from 'react';
import {
  revalidatePreviewRow,
  getPipelineStageOptionsForImport,
  OPP_CURRENCY_PREVIEW_OPTIONS
} from './opportunity-excel-import-utils';

function rowCanBulkImport(row) {
  return row?.isValid || row?.forceImport;
}
import '../../sales-pipeline/opportunity-modal/opportunity-modal.css';
import './opportunity-excel-import.css';

const PERSONAL_COMPANY_VALUE = '__personal__';

export default function OpportunityExcelImportPreviewModal({
  open,
  items,
  meta,
  saving,
  onClose,
  onConfirm,
  onUpdateRow
}) {
  const stageOptions = getPipelineStageOptionsForImport(meta);
  const currencyOptions = OPP_CURRENCY_PREVIEW_OPTIONS;
  const priceBasisOptions = meta?.priceBasisOptions || [
    { value: 'consumer', label: '다이렉트' },
    { value: 'channel', label: '유통' }
  ];
  const channelDistributors = meta?.channelDistributors || [];
  const customerCompanies = meta?.customerCompanies || [];
  const users = meta?.users || [];
  const products = meta?.products || [];

  const stats = useMemo(() => {
    const list = Array.isArray(items) ? items : [];
    const blocked = list.filter((r) => !rowCanBulkImport(r)).length;
    const force = list.filter((r) => r.forceImport && rowCanBulkImport(r)).length;
    return { total: list.length, blocked, force, ready: list.length - blocked };
  }, [items]);

  const patchRow = useCallback(
    (rowIndex, patch) => {
      const list = Array.isArray(items) ? items : [];
      const row = list.find((r) => r.rowIndex === rowIndex);
      if (!row) return;
      const merged = revalidatePreviewRow({ ...row, ...patch }, meta);
      onUpdateRow(rowIndex, merged);
    },
    [items, meta, onUpdateRow]
  );

  if (!open) return null;

  const allValid = stats.blocked === 0 && stats.total > 0;

  return (
    <div
      className="opp-modal-overlay opp-excel-preview-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sp-excel-preview-title"
    >
      <div
        className="opp-modal opp-excel-preview-modal opp-excel-preview-modal--fullscreen"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="opp-modal-header">
          <div className="opp-modal-header-left">
            <h3 className="opp-modal-title" id="sp-excel-preview-title">
              검증·등록
            </h3>
            <span className="excel-import-map-badge excel-import-map-badge--tag">CRM 검증</span>
            <span className="excel-import-map-badge excel-import-map-badge--count">
              {stats.total}행 · 등록 가능 {stats.ready}
              {stats.force > 0 ? ` (경고 무시 ${stats.force})` : ''}
            </span>
          </div>
          <button type="button" className="opp-modal-close" onClick={onClose} disabled={saving} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="opp-excel-preview-modal-body">
          <div className="opp-excel-preview-summary">
            <span>
              등록 가능 <strong>{stats.ready}</strong>건
            </span>
            {stats.blocked > 0 ? (
              <span className="is-err">
                수정 필요 <strong>{stats.blocked}</strong>건 — 붉은 칸을 고치거나 엑셀 미리보기에서 「그대로 등록」을 사용하세요.
              </span>
            ) : (
              <span>
                {stats.force > 0
                  ? `경고 무시 등록 ${stats.force}건 포함 — 나머지는 CRM 목록과 일치합니다.`
                  : '모든 행이 검증을 통과했습니다.'}
              </span>
            )}
          </div>

          <div className="opp-excel-preview-scroll opp-excel-preview-scroll--fill">
            <table className="opp-excel-preview-table">
            <thead>
              <tr>
                <th>#</th>
                <th>제목</th>
                <th>단계</th>
                <th>고객사</th>
                <th>담당(연락처)</th>
                <th>제품</th>
                <th>통화</th>
                <th>가격기준</th>
                <th>유통사</th>
                <th>사내 담당</th>
              </tr>
            </thead>
            <tbody>
              {(items || []).map((row) => (
                <tr key={row.rowIndex} className={rowCanBulkImport(row) ? '' : 'is-invalid-row'}>
                  <td>{row.rowIndex + 1}</td>
                  <td>
                    <input
                      type="text"
                      className={`opp-excel-preview-cell-input ${row.invalidCells?.has('title') ? 'is-invalid' : ''}`}
                      value={row.title || ''}
                      onChange={(e) => patchRow(row.rowIndex, { title: e.target.value })}
                      disabled={saving}
                    />
                  </td>
                  <td>
                    <select
                      className={`opp-excel-preview-cell-select ${row.invalidCells?.has('stage') ? 'is-invalid' : ''}`}
                      value={row.stage || ''}
                      onChange={(e) => patchRow(row.rowIndex, { stage: e.target.value })}
                      disabled={saving}
                    >
                      <option value="">선택…</option>
                      {stageOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label || o.value}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {row.forceImport && !row.customerCompanyId && !row.personalPurchase ? (
                      <div className="opp-excel-preview-snapshot-cell">
                        <input
                          type="text"
                          className="opp-excel-preview-cell-input"
                          value={row.customerCompanyName || ''}
                          onChange={(e) =>
                            patchRow(row.rowIndex, {
                              customerCompanyName: e.target.value,
                              companyValid: !!(e.target.value || '').trim()
                            })
                          }
                          disabled={saving}
                          title={row.companyWarn || 'CRM 미연결 · 엑셀 상호 그대로 등록'}
                        />
                        <span className="opp-excel-preview-snapshot-tag">스냅샷</span>
                      </div>
                    ) : (
                      <select
                        className={`opp-excel-preview-cell-select ${row.invalidCells?.has('customerCompanyName') ? 'is-invalid' : ''}`}
                        value={row.personalPurchase ? PERSONAL_COMPANY_VALUE : row.customerCompanyId || ''}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === PERSONAL_COMPANY_VALUE) {
                            patchRow(row.rowIndex, {
                              personalPurchase: true,
                              customerCompanyId: null,
                              customerCompanyName: '',
                              forceImport: false
                            });
                          } else {
                            const co = customerCompanies.find((c) => c.id === v);
                            patchRow(row.rowIndex, {
                              personalPurchase: false,
                              customerCompanyId: v,
                              customerCompanyName: co?.name || '',
                              forceImport: false
                            });
                          }
                        }}
                        disabled={saving}
                        title={row.companyWarn || undefined}
                      >
                        <option value={PERSONAL_COMPANY_VALUE}>개인구매</option>
                        {customerCompanies.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    )}
                    {row.companyWarn && !row.forceImport ? (
                      <span className="opp-excel-preview-cell-hint">{row.companyWarn}</span>
                    ) : null}
                  </td>
                  <td>
                    <input
                      type="text"
                      className="opp-excel-preview-cell-input"
                      value={row.contactName || ''}
                      onChange={(e) => patchRow(row.rowIndex, { contactName: e.target.value })}
                      disabled={saving}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      className={`opp-excel-preview-cell-input ${row.invalidCells?.has('productName') ? 'is-invalid' : ''}`}
                      value={row.lineItemsClient?.[0]?.productName || ''}
                      onChange={(e) => {
                        const name = e.target.value;
                        const hit = products.find((x) => (x.name || '').trim() === name.trim());
                        const li = { ...(row.lineItemsClient?.[0] || {}) };
                        if (hit) {
                          li.productId = hit.id;
                          li.productName = hit.name;
                        } else {
                          li.productId = '';
                          li.productName = name;
                        }
                        patchRow(row.rowIndex, { lineItemsClient: [li] });
                      }}
                      disabled={saving}
                      placeholder="제품명"
                      title={row.productWarn || undefined}
                      list={`opp-excel-product-datalist-${row.rowIndex}`}
                    />
                    <datalist id={`opp-excel-product-datalist-${row.rowIndex}`}>
                      {products.map((p) => (
                        <option key={p.id} value={p.name} />
                      ))}
                    </datalist>
                    {row.productStatus === 'unregistered' && row.lineItemsClient?.[0]?.productName?.trim() ? (
                      <span className="opp-excel-preview-cell-hint">{row.productWarn}</span>
                    ) : null}
                  </td>
                  <td>
                    <select
                      className={`opp-excel-preview-cell-select ${row.invalidCells?.has('currency') ? 'is-invalid' : ''}`}
                      value={row.currency || 'KRW'}
                      onChange={(e) => patchRow(row.rowIndex, { currency: e.target.value })}
                      disabled={saving}
                    >
                      {currencyOptions.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      className={`opp-excel-preview-cell-select ${row.invalidCells?.has('unitPriceBasis') ? 'is-invalid' : ''}`}
                      value={row.unitPriceBasis || 'consumer'}
                      onChange={(e) => patchRow(row.rowIndex, { unitPriceBasis: e.target.value })}
                      disabled={saving}
                    >
                      {priceBasisOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      className={`opp-excel-preview-cell-select ${row.invalidCells?.has('channelDistributor') ? 'is-invalid' : ''}`}
                      value={row.channelDistributor || ''}
                      onChange={(e) => {
                        const ch = e.target.value;
                        const li = { ...(row.lineItemsClient?.[0] || {}), channelDistributor: ch };
                        patchRow(row.rowIndex, { channelDistributor: ch, lineItemsClient: [li] });
                      }}
                      disabled={saving || row.unitPriceBasis !== 'channel'}
                    >
                      <option value="">—</option>
                      {channelDistributors.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {row.forceImport && !row.assignedToUserId ? (
                      <input
                        type="text"
                        className={`opp-excel-preview-cell-input ${row.invalidCells?.has('assignedToName') ? 'is-invalid' : ''}`}
                        value={row.assignedToName || ''}
                        onChange={(e) => patchRow(row.rowIndex, { assignedToName: e.target.value })}
                        disabled={saving}
                        title="사내 목록 미연결 · 이름만 저장(가능 시 자동 매칭)"
                      />
                    ) : (
                      <select
                        className={`opp-excel-preview-cell-select ${row.invalidCells?.has('assignedToName') ? 'is-invalid' : ''}`}
                        value={row.assignedToUserId || ''}
                        onChange={(e) => {
                          const uid = e.target.value;
                          const u = users.find((x) => x.id === uid);
                          patchRow(row.rowIndex, {
                            assignedToUserId: uid,
                            assignedToName: u?.name || '',
                            forceImport: false
                          });
                        }}
                        disabled={saving}
                      >
                        <option value="">(기본: 본인)</option>
                        {users.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>

        <div className="opp-modal-footer">
          <button type="button" className="opp-btn-secondary" onClick={onClose} disabled={saving}>
            뒤로 (엑셀 미리보기)
          </button>
          <button
            type="button"
            className="opp-btn-primary"
            disabled={saving || !allValid}
            title={!allValid ? '오류 행을 모두 수정해 주세요' : undefined}
            onClick={() => onConfirm(items)}
          >
            {saving ? '등록 중…' : `${stats.valid}건 등록`}
          </button>
        </div>
      </div>
    </div>
  );
}
