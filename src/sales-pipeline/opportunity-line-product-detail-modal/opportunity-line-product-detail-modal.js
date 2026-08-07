import { useEffect, useMemo, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { API_BASE } from '@/config';
import { crmFetchInit } from '@/lib/crm-auth';
import { pingBackendHealth } from '@/lib/backend-wake';
import { buildExchangeRateFormulaBuiltin } from '@/lib/exchange-rate-formula-builtin';
import { computeCustomFieldFormulas, formatFormulaExpressionForLabel } from '@/lib/custom-field-formula';
import {
  formatCustomFieldDisplayValue,
  normalizeCustomFieldDefinition
} from '@/lib/custom-field-display-format';
import { filterActiveCustomFieldDefinitions } from '@/lib/custom-field-definition-utils';
import {
  mergeResolvedProductRow,
  normalizeProductFieldFormulas
} from '@/lib/product-field-formulas';
import { listPriceFromProduct } from '@/lib/product-price-utils';
import { getConsumerMargin, getChannelMargin } from '@/lib/product-margin';
import {
  hasProductCatalogSnapshot,
  hasProductCatalogOverrides
} from '@/lib/sales-opportunity-form-shared';
import '../opportunity-modal/opportunity-modal.css';
import './opportunity-line-product-detail-modal.css';

const STATUS_LABELS = { Active: '활성', EndOfLife: 'End of Life', Draft: '초안' };
const BILLING_LABELS = { Monthly: '월간', Annual: '연간', Perpetual: '영구' };
const BILLING_OPTIONS = ['Monthly', 'Annual', 'Perpetual'];

const BUILTIN_MONEY_KEYS = new Set([
  'listPrice',
  'costPrice',
  'channelPrice',
  'consumerMargin',
  'channelMargin'
]);

function formatPriceView(price) {
  if (price == null || price === '') return '—';
  const n = Number(price);
  if (!Number.isFinite(n)) return String(price);
  return n.toLocaleString();
}

function formatMoneyInput(raw) {
  const n = Number(String(raw ?? '').replace(/,/g, '').trim());
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString();
}

function parseMoneyInput(str) {
  const n = Number(String(str ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

function formatCapturedAt(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function valuesEqual(a, b, kind) {
  if (kind === 'money') {
    return Math.round(parseMoneyInput(a) * 1000) === Math.round(parseMoneyInput(b) * 1000);
  }
  return String(a ?? '').trim() === String(b ?? '').trim();
}

function FieldLabelCell({ label, expression, forced }) {
  return (
    <td className="opp-line-sheet-td opp-line-prod-sheet-td--label" data-label="항목">
      <div className="opp-line-prod-sheet-label">
        <span>{label}</span>
        {expression ? (
          <>
            <span className="custom-fields-formula-expression-label">
              {formatFormulaExpressionForLabel(expression)}
            </span>
            <span className="custom-fields-display-formula-badge">함수</span>
          </>
        ) : null}
        {forced ? <span className="opp-line-prod-forced-badge">강제</span> : null}
      </div>
    </td>
  );
}

/**
 * 영업기회 라인 제품명 클릭 — 시트형 표 + 현재값 강제 수정(라인 전용)
 */
export default function OpportunityLineProductDetailModal({
  productId,
  productName = '',
  initialCatalogSnapshot = null,
  catalogOverrides = null,
  seedProduct = null,
  customDefinitions = [],
  dealBasRMap = {},
  usdSummary = null,
  pricingProfile = null,
  rateRows = [],
  linePriceBasis = 'consumer',
  lineQuantity = '1',
  onApply,
  onClose
}) {
  const [loading, setLoading] = useState(Boolean(productId));
  const [error, setError] = useState('');
  const [loadedProduct, setLoadedProduct] = useState(seedProduct || null);
  const [draft, setDraft] = useState(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!productId) {
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        await pingBackendHealth();
        const res = await fetch(`${API_BASE}/products/${encodeURIComponent(productId)}`, crmFetchInit());
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setError(data?.error || '제품을 불러오지 못했습니다.');
          if (seedProduct) setLoadedProduct(seedProduct);
        } else {
          const doc = data?.item || data;
          setLoadedProduct(doc && typeof doc === 'object' ? doc : seedProduct);
        }
      } catch {
        if (!cancelled) {
          setError('제품을 불러오지 못했습니다.');
          if (seedProduct) setLoadedProduct(seedProduct);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const formulaExchangeCtx = useMemo(
    () => ({ dealBasRMap, usdSummary, pricingProfile, rateRows }),
    [dealBasRMap, usdSummary, pricingProfile, rateRows]
  );

  const activeDefinitions = useMemo(
    () => filterActiveCustomFieldDefinitions(customDefinitions.map(normalizeCustomFieldDefinition)),
    [customDefinitions]
  );

  const liveProduct = useMemo(() => {
    if (!loadedProduct) return null;
    return mergeResolvedProductRow(loadedProduct, formulaExchangeCtx, activeDefinitions);
  }, [loadedProduct, formulaExchangeCtx, activeDefinitions]);

  const liveCustomComputed = useMemo(() => {
    if (!liveProduct) return {};
    const currency = liveProduct.currency || 'KRW';
    const productFormulas =
      liveProduct.customFieldFormulas && typeof liveProduct.customFieldFormulas === 'object'
        ? liveProduct.customFieldFormulas
        : loadedProduct?.customFieldFormulas || {};
    return computeCustomFieldFormulas(activeDefinitions, {
      entityType: 'product',
      definitions: activeDefinitions,
      pricingProfile,
      customFieldFormulas: productFormulas,
      missingCustomRefAsZero: true,
      customFields: liveProduct.customFields || {},
      builtIn: {
        listPrice: listPriceFromProduct(liveProduct),
        price: listPriceFromProduct(liveProduct),
        costPrice: Number(liveProduct.costPrice) || 0,
        channelPrice: Number(liveProduct.channelPrice) || 0,
        consumerMargin: getConsumerMargin(liveProduct),
        channelMargin: getChannelMargin(liveProduct),
        ...buildExchangeRateFormulaBuiltin(usdSummary, dealBasRMap, currency, {
          profile: pricingProfile,
          rateRows
        })
      }
    });
  }, [
    liveProduct,
    loadedProduct,
    activeDefinitions,
    pricingProfile,
    usdSummary,
    dealBasRMap,
    rateRows
  ]);

  const liveValues = useMemo(() => {
    if (!liveProduct) return null;
    const cf = { ...(liveProduct.customFields || {}) };
    for (const [k, v] of Object.entries(liveCustomComputed || {})) {
      if (v != null) cf[k] = v;
    }
    return {
      name: liveProduct.name || '',
      code: liveProduct.code || '',
      version: liveProduct.version || '',
      category: liveProduct.category || '',
      status: liveProduct.status || 'Active',
      currency: liveProduct.currency || 'KRW',
      billingType: liveProduct.billingType || 'Monthly',
      billingInterval: String(liveProduct.billingInterval || 1),
      listPrice: formatMoneyInput(listPriceFromProduct(liveProduct)),
      costPrice: formatMoneyInput(liveProduct.costPrice),
      channelPrice: formatMoneyInput(liveProduct.channelPrice),
      consumerMargin: formatMoneyInput(getConsumerMargin(liveProduct)),
      channelMargin: formatMoneyInput(getChannelMargin(liveProduct)),
      customFields: Object.fromEntries(
        activeDefinitions.map((def) => {
          const raw = cf[def.key];
          if (def.type === 'number' || def.type === 'formula' || def.type === 'currency') {
            return [def.key, raw == null || raw === '' ? '' : formatMoneyInput(raw)];
          }
          return [def.key, raw == null ? '' : String(raw)];
        })
      )
    };
  }, [liveProduct, liveCustomComputed, activeDefinitions]);

  useEffect(() => {
    if (!liveValues) return;
    const ov = hasProductCatalogOverrides(catalogOverrides) ? catalogOverrides : null;
    const next = {
      ...liveValues,
      customFields: { ...liveValues.customFields }
    };
    if (ov) {
      for (const key of [
        'name',
        'code',
        'version',
        'category',
        'status',
        'currency',
        'billingType',
        'billingInterval'
      ]) {
        if (ov[key] != null && ov[key] !== '') next[key] = String(ov[key]);
      }
      for (const key of BUILTIN_MONEY_KEYS) {
        if (ov[key] != null && ov[key] !== '') next[key] = formatMoneyInput(ov[key]);
      }
      if (ov.customFields && typeof ov.customFields === 'object') {
        for (const def of activeDefinitions) {
          if (Object.prototype.hasOwnProperty.call(ov.customFields, def.key)) {
            const raw = ov.customFields[def.key];
            if (def.type === 'number' || def.type === 'formula' || def.type === 'currency') {
              next.customFields[def.key] =
                raw == null || raw === '' ? '' : formatMoneyInput(raw);
            } else {
              next.customFields[def.key] = raw == null ? '' : String(raw);
            }
          }
        }
      }
    }
    setDraft(next);
  }, [liveValues, catalogOverrides, activeDefinitions]);

  const viewFieldFormulas = useMemo(
    () => normalizeProductFieldFormulas(loadedProduct || {}),
    [loadedProduct]
  );

  const snap = hasProductCatalogSnapshot(initialCatalogSnapshot) ? initialCatalogSnapshot : null;
  const productFormulas =
    liveProduct?.customFieldFormulas && typeof liveProduct.customFieldFormulas === 'object'
      ? liveProduct.customFieldFormulas
      : loadedProduct?.customFieldFormulas || {};

  const patchDraft = useCallback((key, value) => {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  }, []);

  const patchCustom = useCallback((key, value) => {
    setDraft((prev) =>
      prev
        ? { ...prev, customFields: { ...(prev.customFields || {}), [key]: value } }
        : prev
    );
  }, []);

  const resetField = useCallback(
    (key, isCustom = false) => {
      if (!liveValues) return;
      if (isCustom) {
        setDraft((prev) =>
          prev
            ? {
                ...prev,
                customFields: {
                  ...(prev.customFields || {}),
                  [key]: liveValues.customFields?.[key] ?? ''
                }
              }
            : prev
        );
        return;
      }
      setDraft((prev) => (prev ? { ...prev, [key]: liveValues[key] } : prev));
    },
    [liveValues]
  );

  const buildOverridesFromDraft = useCallback(() => {
    if (!draft || !liveValues) return null;
    const out = {};
    const textKeys = ['name', 'code', 'version', 'category', 'status', 'currency', 'billingType', 'billingInterval'];
    for (const key of textKeys) {
      if (!valuesEqual(draft[key], liveValues[key], 'text')) {
        out[key] = String(draft[key] ?? '').trim();
      }
    }
    for (const key of BUILTIN_MONEY_KEYS) {
      if (!valuesEqual(draft[key], liveValues[key], 'money')) {
        out[key] = parseMoneyInput(draft[key]);
      }
    }
    const cf = {};
    for (const def of activeDefinitions) {
      const kind =
        def.type === 'number' || def.type === 'formula' || def.type === 'currency' ? 'money' : 'text';
      const dVal = draft.customFields?.[def.key] ?? '';
      const lVal = liveValues.customFields?.[def.key] ?? '';
      if (!valuesEqual(dVal, lVal, kind)) {
        cf[def.key] = kind === 'money' ? parseMoneyInput(dVal) : String(dVal);
      }
    }
    if (Object.keys(cf).length) out.customFields = cf;
    return Object.keys(out).length ? out : null;
  }, [draft, liveValues, activeDefinitions]);

  const handleApply = () => {
    if (!onApply || !draft) {
      onClose?.();
      return;
    }
    setApplying(true);
    try {
      const overrides = buildOverridesFromDraft();
      const qty = Math.max(0, Number(lineQuantity) || 1);
      const patch = { productCatalogOverrides: overrides };
      if (overrides?.listPrice != null && linePriceBasis !== 'channel') {
        const p = Number(overrides.listPrice);
        if (Number.isFinite(p) && p >= 0) patch.unitPrice = p > 0 ? p.toLocaleString() : '';
      }
      if (overrides?.channelPrice != null && linePriceBasis === 'channel') {
        const p = Number(overrides.channelPrice);
        if (Number.isFinite(p) && p >= 0) patch.unitPrice = p > 0 ? p.toLocaleString() : '';
      }
      if (overrides?.costPrice != null) {
        const c = Number(overrides.costPrice);
        if (Number.isFinite(c) && c >= 0 && qty > 0) {
          patch.purchaseCostTotal = Math.round(c * qty).toLocaleString();
        }
      }
      if (overrides?.name) patch.productName = overrides.name;
      onApply(patch);
      onClose?.();
    } finally {
      setApplying(false);
    }
  };

  const handleResetAll = () => {
    if (!liveValues) return;
    setDraft({
      ...liveValues,
      customFields: { ...liveValues.customFields }
    });
  };

  const isForced = (key, isCustom = false) => {
    if (!draft || !liveValues) return false;
    if (isCustom) {
      const kind = (() => {
        const def = activeDefinitions.find((d) => d.key === key);
        return def?.type === 'number' || def?.type === 'formula' || def?.type === 'currency'
          ? 'money'
          : 'text';
      })();
      return !valuesEqual(draft.customFields?.[key], liveValues.customFields?.[key], kind);
    }
    const kind = BUILTIN_MONEY_KEYS.has(key) ? 'money' : 'text';
    return !valuesEqual(draft[key], liveValues[key], kind);
  };

  const formatInitial = (value, kind = 'text', def = null) => {
    if (value == null || value === '') return '—';
    if (kind === 'money') return formatPriceView(value);
    if (def) {
      return formatCustomFieldDisplayValue(value, normalizeCustomFieldDefinition(def), {
        currency: draft?.currency || liveValues?.currency || 'KRW'
      });
    }
    return String(value);
  };

  const rows = [];
  if (draft) {
    const pushBuiltin = (key, label, expression, kind = 'text', inputType = 'text') => {
      rows.push({
        key,
        label,
        expression: expression || '',
        kind,
        inputType,
        isCustom: false,
        initial: snap ? snap[key] : null
      });
    };
    pushBuiltin('name', '제품명', viewFieldFormulas.name);
    pushBuiltin('code', '코드', viewFieldFormulas.code);
    pushBuiltin('category', '카테고리', viewFieldFormulas.category);
    pushBuiltin('version', '버전', viewFieldFormulas.version);
    pushBuiltin('listPrice', '소비자가', viewFieldFormulas.listPrice, 'money', 'money');
    pushBuiltin('costPrice', '원가', viewFieldFormulas.costPrice, 'money', 'money');
    pushBuiltin('channelPrice', '유통가', viewFieldFormulas.channelPrice, 'money', 'money');
    pushBuiltin('consumerMargin', '순 마진', viewFieldFormulas.consumerMargin, 'money', 'money');
    pushBuiltin('channelMargin', '유통 마진', viewFieldFormulas.channelMargin, 'money', 'money');
    pushBuiltin('billingType', '청구 주기', '', 'billing');
    pushBuiltin('billingInterval', '청구 간격', viewFieldFormulas.billingInterval, 'text');
    pushBuiltin('currency', '통화', '', 'text');
    pushBuiltin('status', '상태', '', 'status');

    for (const def of activeDefinitions) {
      const expr = productFormulas[def.key] || (def.type === 'formula' ? def.options?.expression : '') || '';
      const moneyLike = def.type === 'number' || def.type === 'formula' || def.type === 'currency';
      rows.push({
        key: def.key,
        label: def.label || def.key,
        expression: expr,
        kind: moneyLike ? 'money' : 'text',
        inputType: moneyLike ? 'money' : 'text',
        isCustom: true,
        def,
        initial: snap?.customFields ? snap.customFields[def.key] : null
      });
    }
  }

  const modal = (
    <div className="opp-line-prod-detail-overlay" role="presentation">
      <div
        className="opp-line-prod-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="opp-line-prod-detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="opp-basic-info-sheet opp-line-prod-sheet-wrap">
          <div className="opp-basic-info-sheet-head">
            <span className="opp-basic-info-sheet-head-title" id="opp-line-prod-detail-title">
              제품 세부정보
            </span>
            <button type="button" className="opp-line-prod-sheet-close" onClick={onClose} aria-label="닫기">
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
          <div className="opp-basic-info-sheet-body opp-line-prod-sheet-body">
            <p className="opp-schedule-won-banner opp-line-prod-sheet-intro">
              현재값은 환율·수식에 따라 다시 계산됩니다. 필요할 때만 값을 직접 고쳐{' '}
              <strong>이 영업기회 라인</strong>에 강제값으로 둡니다(제품 목록은 바뀌지 않습니다).
              {snap?.capturedAt ? (
                <>
                  {' '}
                  등록 초기는 <time dateTime={snap.capturedAt}>{formatCapturedAt(snap.capturedAt)}</time>{' '}
                  기준입니다.
                </>
              ) : (
                <> 저장하면 그때의 값이 등록 초기로 기회에 남습니다.</>
              )}
            </p>

            {loading ? <p className="opp-line-prod-detail-status">불러오는 중…</p> : null}
            {error ? <p className="opp-line-prod-detail-error">{error}</p> : null}

            {draft && liveProduct ? (
              <div className="opp-line-sheet-scroll opp-line-prod-sheet-scroll">
                <div className="opp-line-sheet-table-wrap">
                  <table className="opp-line-sheet opp-line-prod-catalog-sheet">
                    <thead>
                      <tr>
                        <th scope="col" className="opp-line-sheet-th opp-line-sheet-th--product">
                          항목
                        </th>
                        <th scope="col" className="opp-line-sheet-th">
                          현재값
                        </th>
                        <th scope="col" className="opp-line-sheet-th">
                          등록 초기
                        </th>
                        <th scope="col" className="opp-line-sheet-th opp-line-prod-sheet-th--actions">
                          되돌리기
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, idx) => {
                        const stripe =
                          idx % 2 === 0
                            ? 'opp-line-sheet-group--stripe-a'
                            : 'opp-line-sheet-group--stripe-b';
                        const forced = isForced(row.key, row.isCustom);
                        const value = row.isCustom
                          ? draft.customFields?.[row.key] ?? ''
                          : draft[row.key] ?? '';
                        return (
                          <tr key={row.isCustom ? `cf-${row.key}` : row.key} className={stripe}>
                            <FieldLabelCell
                              label={row.label}
                              expression={row.expression}
                              forced={forced}
                            />
                            <td className="opp-line-sheet-td" data-label="현재값">
                              {row.inputType === 'billing' ? (
                                <select
                                  className="opp-select opp-line-sheet-select"
                                  value={draft.billingType || 'Monthly'}
                                  onChange={(e) => patchDraft('billingType', e.target.value)}
                                  aria-label={`${row.label} 현재값`}
                                >
                                  {BILLING_OPTIONS.map((b) => (
                                    <option key={b} value={b}>
                                      {BILLING_LABELS[b] || b}
                                    </option>
                                  ))}
                                </select>
                              ) : row.inputType === 'status' ? (
                                <select
                                  className="opp-select opp-line-sheet-select"
                                  value={draft.status || 'Active'}
                                  onChange={(e) => patchDraft('status', e.target.value)}
                                  aria-label={`${row.label} 현재값`}
                                >
                                  {Object.entries(STATUS_LABELS).map(([k, lab]) => (
                                    <option key={k} value={k}>
                                      {lab}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  type="text"
                                  className="opp-input opp-line-sheet-input"
                                  value={value}
                                  inputMode={row.inputType === 'money' ? 'decimal' : undefined}
                                  onChange={(e) => {
                                    const raw = e.target.value;
                                    if (row.isCustom) patchCustom(row.key, raw);
                                    else patchDraft(row.key, raw);
                                  }}
                                  aria-label={`${row.label} 현재값`}
                                />
                              )}
                            </td>
                            <td
                              className="opp-line-sheet-td opp-line-prod-sheet-td--initial"
                              data-label="등록 초기"
                            >
                              {row.key === 'billingType'
                                ? formatInitial(
                                    snap
                                      ? `${BILLING_LABELS[snap.billingType] || snap.billingType || ''}${
                                          snap.billingType && snap.billingType !== 'Perpetual'
                                            ? ` × ${snap.billingInterval || 1}`
                                            : ''
                                        }`
                                      : '',
                                    'text'
                                  )
                                : row.key === 'status'
                                  ? formatInitial(
                                      snap?.status
                                        ? STATUS_LABELS[snap.status] || snap.status
                                        : '',
                                      'text'
                                    )
                                  : formatInitial(
                                      row.initial,
                                      row.kind === 'money' ? 'money' : 'text',
                                      row.def || null
                                    )}
                            </td>
                            <td className="opp-line-sheet-td opp-line-prod-sheet-td--actions">
                              {forced ? (
                                <button
                                  type="button"
                                  className="opp-line-prod-reset-btn"
                                  onClick={() => resetField(row.key, row.isCustom)}
                                  title="환율·수식 현재값으로 되돌리기"
                                >
                                  되돌리기
                                </button>
                              ) : (
                                <span className="opp-line-sheet-na">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : !loading ? (
              <p className="opp-line-prod-detail-status">표시할 제품이 없습니다.</p>
            ) : null}

            <div className="opp-line-prod-sheet-footer">
              <button type="button" className="opp-line-prod-footer-secondary" onClick={handleResetAll} disabled={!draft}>
                전부 되돌리기
              </button>
              <div className="opp-line-prod-sheet-footer-right">
                <button type="button" className="opp-line-prod-footer-secondary" onClick={onClose}>
                  취소
                </button>
                <button
                  type="button"
                  className="opp-save-btn opp-line-prod-footer-apply"
                  onClick={handleApply}
                  disabled={applying || !draft}
                >
                  {applying ? '적용 중…' : '라인에 적용'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(modal, document.body);
}
