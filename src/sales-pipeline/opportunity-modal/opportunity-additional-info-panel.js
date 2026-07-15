import React, { useEffect, useMemo, useState } from 'react';
import { API_BASE } from '@/config';
import { crmFetchInit } from '@/lib/crm-auth';
import {
  listSafeProductFieldsForAdditionalInfo,
  newAdditionalInfoRowId
} from './opportunity-additional-info';

/**
 * @param {{
 *   rows: { id: string, key: string, value: string }[],
 *   onChange: (rows: { id: string, key: string, value: string }[] | ((prev: { id: string, key: string, value: string }[]) => { id: string, key: string, value: string }[])) => void,
 *   lineItems: object[],
 *   productById: Record<string, object>,
 *   disabled?: boolean
 * }} props
 */
export function OpportunityAdditionalInfoPanel({
  rows,
  onChange,
  lineItems,
  productById,
  disabled = false
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerProductId, setPickerProductId] = useState('');
  const [selectedFieldKeys, setSelectedFieldKeys] = useState(() => new Set());
  const [fetchedProductById, setFetchedProductById] = useState({});
  const [fetchingProduct, setFetchingProduct] = useState(false);

  const productOptions = useMemo(() => {
    const seen = new Set();
    const opts = [];
    for (const line of lineItems || []) {
      const pid = line?.productId != null ? String(line.productId) : '';
      if (!pid || seen.has(pid)) continue;
      seen.add(pid);
      const doc = productById?.[pid] || fetchedProductById[pid] || null;
      const name = String(doc?.name || line.productName || '').trim() || pid;
      opts.push({ id: pid, name, product: doc });
    }
    return opts;
  }, [lineItems, productById, fetchedProductById]);

  const activeProduct = useMemo(() => {
    if (!pickerProductId) return null;
    return productOptions.find((o) => o.id === pickerProductId) || null;
  }, [pickerProductId, productOptions]);

  useEffect(() => {
    if (!pickerOpen || !pickerProductId) return;
    if (productById?.[pickerProductId] || fetchedProductById[pickerProductId]) return;
    let cancelled = false;
    setFetchingProduct(true);
    fetch(`${API_BASE}/products/${encodeURIComponent(pickerProductId)}`, crmFetchInit())
      .then((r) => r.json().catch(() => ({})))
      .then((data) => {
        if (cancelled || !data?._id) return;
        setFetchedProductById((prev) => ({ ...prev, [String(data._id)]: data }));
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setFetchingProduct(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pickerOpen, pickerProductId, productById, fetchedProductById]);

  const safeFields = useMemo(() => {
    if (!activeProduct?.product) return [];
    return listSafeProductFieldsForAdditionalInfo(activeProduct.product);
  }, [activeProduct]);

  const openPicker = () => {
    if (disabled) return;
    const first = productOptions[0]?.id || '';
    setPickerProductId(first);
    setSelectedFieldKeys(new Set());
    setPickerOpen(true);
  };

  const toggleField = (fieldKey) => {
    setSelectedFieldKeys((prev) => {
      const next = new Set(prev);
      if (next.has(fieldKey)) next.delete(fieldKey);
      else next.add(fieldKey);
      return next;
    });
  };

  const selectAllFields = () => {
    setSelectedFieldKeys(new Set(safeFields.map((f) => f.key)));
  };

  const applyProductFields = () => {
    if (!activeProduct || selectedFieldKeys.size === 0) {
      setPickerOpen(false);
      return;
    }
    const productName = activeProduct.name;
    const additions = safeFields
      .filter((f) => selectedFieldKeys.has(f.key))
      .map((f) => ({
        id: newAdditionalInfoRowId(),
        key: `${productName}.${f.label}`,
        value: f.value
      }));
    onChange((prev) => [...(Array.isArray(prev) ? prev : []), ...additions]);
    setPickerOpen(false);
    setSelectedFieldKeys(new Set());
  };

  const addEmptyRow = (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    if (disabled) return;
    onChange((prev) => [
      ...(Array.isArray(prev) ? prev : []),
      { id: newAdditionalInfoRowId(), key: '', value: '' }
    ]);
  };

  const patchRow = (id, patch) => {
    onChange((prev) =>
      (Array.isArray(prev) ? prev : []).map((r) => (r.id === id ? { ...r, ...patch } : r))
    );
  };

  const removeRow = (id) => {
    onChange((prev) => (Array.isArray(prev) ? prev : []).filter((r) => r.id !== id));
  };

  return (
    <aside className="opp-modal-form-finance opp-modal-form-finance--full-width opp-additional-info-aside" aria-label="추가정보">
      <div className="opp-basic-info-sheet opp-basic-info-sheet--panel opp-additional-info-sheet" aria-label="추가정보 항목·내용">
        <div className="opp-basic-info-sheet-head">
          <span className="opp-basic-info-sheet-head-title">추가정보</span>
          <div className="opp-additional-info-head-actions">
            <button
              type="button"
              className="opp-basic-info-sheet-head-btn"
              disabled={disabled || productOptions.length === 0}
              onClick={openPicker}
              title={
                productOptions.length === 0
                  ? '제품·금액 탭에서 제품을 먼저 추가해 주세요'
                  : '등록된 제품의 안전 필드를 항목·내용으로 가져옵니다'
              }
            >
              <span className="material-symbols-outlined" aria-hidden>
                inventory_2
              </span>
              제품 필드 가져오기
            </button>
            <button
              type="button"
              className="opp-basic-info-sheet-head-btn"
              disabled={disabled}
              onClick={addEmptyRow}
            >
              <span className="material-symbols-outlined" aria-hidden>
                add
              </span>
              행 추가
            </button>
          </div>
        </div>
        <div className="opp-basic-info-sheet-body opp-additional-info-body">
          <p className="opp-schedule-sheet-hint opp-additional-info-hint">
            비정형 메모·참고 항목용입니다. <strong>원가·RPI·핸들링·환율·순이익·판매수수료</strong> 등 금액·재무 정보는{' '}
            <strong>제품·금액</strong> 탭에서 입력·확인하세요. 제품에서 가져올 때는 원가·마진·요율·수식 등 보안상 민감한 필드는 제외됩니다.
          </p>
          <div className="opp-line-sheet-scroll opp-additional-info-table-scroll">
            <div className="opp-line-sheet-table-wrap">
              <table className="opp-line-sheet opp-additional-info-table" aria-label="추가정보 항목·내용 목록">
                <thead>
                  <tr>
                    <th scope="col" className="opp-line-sheet-th opp-additional-info-th opp-additional-info-th--index">
                      #
                    </th>
                    <th scope="col" className="opp-line-sheet-th opp-additional-info-th opp-additional-info-th--key">
                      항목
                    </th>
                    <th scope="col" className="opp-line-sheet-th opp-additional-info-th opp-additional-info-th--value">
                      내용
                    </th>
                    <th scope="col" className="opp-line-sheet-th opp-additional-info-th opp-additional-info-th--actions">
                      관리
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(rows || []).length === 0 ? (
                    <tr className="opp-additional-info-empty-row">
                      <td colSpan={4} className="opp-line-sheet-td opp-additional-info-empty-cell">
                        등록된 추가정보가 없습니다. 「행 추가」또는 「제품 필드 가져오기」를 사용해 주세요.
                      </td>
                    </tr>
                  ) : (
                    (rows || []).map((row, rowIdx) => (
                      <tr key={row.id} className="opp-additional-info-data-row">
                        <td className="opp-line-sheet-td opp-additional-info-td opp-additional-info-td--index">
                          {rowIdx + 1}
                        </td>
                        <td className="opp-line-sheet-td opp-additional-info-td opp-additional-info-td--key">
                          <input
                            type="text"
                            className="opp-basic-info-sheet-field opp-basic-info-sheet-field--input"
                            spellCheck={false}
                            placeholder="예: 라이선스 유형"
                            value={row.key}
                            disabled={disabled}
                            onChange={(e) => patchRow(row.id, { key: e.target.value })}
                          />
                        </td>
                        <td className="opp-line-sheet-td opp-additional-info-td opp-additional-info-td--value">
                          <input
                            type="text"
                            className="opp-basic-info-sheet-field opp-basic-info-sheet-field--input"
                            placeholder="내용 입력"
                            value={row.value}
                            disabled={disabled}
                            onChange={(e) => patchRow(row.id, { value: e.target.value })}
                          />
                        </td>
                        <td className="opp-line-sheet-td opp-additional-info-td opp-additional-info-td--actions">
                          <button
                            type="button"
                            className="opp-additional-info-row-delete"
                            disabled={disabled}
                            onClick={() => removeRow(row.id)}
                            aria-label="행 삭제"
                            title="삭제"
                          >
                            <span className="material-symbols-outlined" aria-hidden>
                              delete
                            </span>
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {pickerOpen ? (
        <div className="opp-additional-info-picker-overlay" role="presentation" onClick={() => setPickerOpen(false)}>
          <div
            className="opp-additional-info-picker"
            role="dialog"
            aria-modal="true"
            aria-labelledby="opp-additional-info-picker-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="opp-additional-info-picker-header">
              <h4 id="opp-additional-info-picker-title">제품 필드 가져오기</h4>
              <button
                type="button"
                className="opp-btn-light opp-btn-icon"
                onClick={() => setPickerOpen(false)}
                aria-label="닫기"
              >
                <span className="material-symbols-outlined" aria-hidden>
                  close
                </span>
              </button>
            </header>
            <div className="opp-additional-info-picker-body">
              <label className="opp-label">
                <span>제품</span>
                <select
                  className="opp-input"
                  value={pickerProductId}
                  onChange={(e) => {
                    setPickerProductId(e.target.value);
                    setSelectedFieldKeys(new Set());
                  }}
                >
                  {productOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
              {fetchingProduct ? (
                <p className="opp-schedule-sheet-hint">제품 정보를 불러오는 중…</p>
              ) : !activeProduct?.product ? (
                <p className="opp-schedule-sheet-hint">
                  제품 상세를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
                </p>
              ) : safeFields.length === 0 ? (
                <p className="opp-schedule-sheet-hint">가져올 수 있는 안전 필드가 없습니다.</p>
              ) : (
                <>
                  <div className="opp-additional-info-picker-toolbar">
                    <button type="button" className="opp-schedule-inline-btn" onClick={selectAllFields}>
                      전체 선택
                    </button>
                    <button
                      type="button"
                      className="opp-schedule-inline-btn"
                      onClick={() => setSelectedFieldKeys(new Set())}
                    >
                      선택 해제
                    </button>
                  </div>
                  <ul className="opp-additional-info-picker-fields">
                    {safeFields.map((f) => {
                      const checked = selectedFieldKeys.has(f.key);
                      return (
                        <li key={f.key}>
                          <label className="opp-additional-info-picker-field">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleField(f.key)}
                            />
                            <span className="opp-additional-info-picker-field-label">{f.label}</span>
                            <span className="opp-additional-info-picker-field-value" title={f.value}>
                              {f.value}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </div>
            <footer className="opp-additional-info-picker-footer">
              <button type="button" className="opp-cancel-btn" onClick={() => setPickerOpen(false)}>
                취소
              </button>
              <button
                type="button"
                className="opp-apply-btn"
                disabled={selectedFieldKeys.size === 0}
                onClick={applyProductFields}
              >
                {selectedFieldKeys.size > 0 ? `${selectedFieldKeys.size}개 추가` : '추가'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
