import { useState, useEffect, useRef } from 'react';
import CustomFieldsSection from '../../shared/custom-fields-section';
import CustomFieldsManageModal from '../../shared/custom-fields-manage-modal/custom-fields-manage-modal';
import { listPriceFromProduct } from '@/lib/product-price-utils';
import { getPresetCategoryAvatar } from '../product-category-avatar-config';
import './add-product-modal.css';

import { API_BASE } from '@/config';
import { getStoredCrmUser, isAdminOrAboveRole } from '@/lib/crm-role-utils';
import { getSavedAddProductModalDefaults, patchAddProductModalDefaults } from '@/lib/list-templates';
import {
  excelObjectToProductFormDraft,
  isExcelRowEffectivelyEmpty,
  parseExcelFileToRows
} from '../product-excel-import-modal/product-excel-import-utils';
import '../../customer-companies/customer-companies-excel-import-modal/customer-companies-excel-import-modal.css';
const STATUS_OPTIONS = [
  { value: 'Active', label: '활성' },
  { value: 'EndOfLife', label: 'End of Life' },
  { value: 'Draft', label: '초안' }
];
const BILLING_OPTIONS = ['Monthly', 'Annual', 'Perpetual'];
const BILLING_LABELS = { Monthly: '월간', Annual: '연간', Perpetual: '영구' };

/** DB에는 소문자 key 저장 (office, cad, …). 기타는 사용자 입력 문자열 */
const PRODUCT_CATEGORY_KEYS = [
  'office',
  'cad',
  'cam',
  'cae',
  'security',
  'cloud',
  'data',
  'network',
  'dev',
  'design'
];
const PRODUCT_CATEGORY_OPTIONS = [
  { value: 'office', label: 'Office' },
  { value: 'cad', label: 'CAD' },
  { value: 'cam', label: 'CAM' },
  { value: 'cae', label: 'CAE' },
  { value: 'security', label: 'Security' },
  { value: 'cloud', label: 'Cloud' },
  { value: 'data', label: 'Data / DB' },
  { value: 'network', label: 'Network' },
  { value: 'dev', label: '개발 · Dev' },
  { value: 'design', label: 'Design' },
  { value: 'other', label: '기타 (직접 입력)' }
];

function parseCategoryFromStored(category) {
  const raw = String(category ?? '').trim();
  if (!raw) return { key: '', other: '' };
  const lower = raw.toLowerCase();
  if (PRODUCT_CATEGORY_KEYS.includes(lower)) return { key: lower, other: '' };
  return { key: 'other', other: raw };
}

function getCategoryTriggerLabel(categoryKey, categoryOther) {
  if (!categoryKey) return '선택 안 함';
  if (categoryKey === 'other') {
    const t = String(categoryOther || '').trim();
    return t ? `기타 · ${t}` : '기타 (직접 입력)';
  }
  const opt = PRODUCT_CATEGORY_OPTIONS.find((o) => o.value === categoryKey);
  return opt?.label || categoryKey;
}

const CURRENCY_OPTIONS = [
  { value: 'KRW', label: '원' },
  { value: 'USD', label: '달러' }
];

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** 표시용: 천 단위 쉼표 (소수점 유지, 최대 소수 자릿수 제한) */
function formatPriceDisplay(num, maxFractionDigits = 4) {
  const n = Number(num);
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('ko-KR', {
    maximumFractionDigits: maxFractionDigits,
    minimumFractionDigits: 0
  });
}

/** 입력 문자열 → 숫자 */
function parsePriceInput(str) {
  const v = String(str ?? '').replace(/,/g, '').trim();
  if (v === '' || v === '.') return 0;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 입력 중 천 단위 쉼표 삽입 (정수부만). 소수점 이하 원문 유지.
 */
function formatPriceWhileTyping(raw) {
  const s = String(raw).replace(/,/g, '');
  if (s === '') return '';
  if (s === '.') return '.';
  const dot = s.indexOf('.');
  const intRaw = dot === -1 ? s : s.slice(0, dot);
  const decRaw = dot === -1 ? '' : s.slice(dot + 1).replace(/\./g, '');
  if (!/^\d*$/.test(intRaw) || !/^\d*$/.test(decRaw)) return raw;
  const intFmt = intRaw === '' ? '' : intRaw.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (dot === -1) return intFmt;
  return `${intFmt}.${decRaw}`;
}

export default function AddProductModal({
  product,
  onClose,
  onSaved,
  presentation = 'centered',
  variant,
  /** 2행 이상 엑셀 시 일괄 등록 모달로 넘김 (제품 목록에서만 전달) */
  onOpenBulkImport
}) {
  const isEdit = !!product?._id;
  const isDuplicate = variant === 'duplicate';
  /** 신규 제품 등록(목록에서 열기)일 때만 listTemplates.addProductModal 저장·복원 */
  const isNewProductRegistration = !isEdit && !isDuplicate;
  const canManageCustomFieldDefinitions = isAdminOrAboveRole(getStoredCrmUser()?.role);
  const isSlidePanel = (isEdit || isDuplicate) && presentation === 'slide';
  const showExcelDrop = !isEdit && typeof onOpenBulkImport === 'function';
  const [form, setForm] = useState(() => {
    const savedNew = isNewProductRegistration ? getSavedAddProductModalDefaults() : null;
    return {
      name: product?.name ?? '',
      code: product?.code ?? '',
      version: product?.version ?? '',
      currency: product?.currency ?? 'KRW',
      billingType: product?.billingType ?? savedNew?.billingType ?? 'Monthly',
      status: product?.status ?? 'Active',
      customFields: product?.customFields ? { ...product.customFields } : {}
    };
  });
  const [customDefinitions, setCustomDefinitions] = useState([]);
  const [showCustomFieldsModal, setShowCustomFieldsModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [listPriceInput, setListPriceInput] = useState(() => formatPriceDisplay(listPriceFromProduct(product)));
  const [costPriceInput, setCostPriceInput] = useState(() => formatPriceDisplay(Number(product?.costPrice) || 0));
  const [channelPriceInput, setChannelPriceInput] = useState(() => formatPriceDisplay(Number(product?.channelPrice) || 0));
  const [categoryKey, setCategoryKey] = useState(() => {
    if (isEdit || isDuplicate) return parseCategoryFromStored(product?.category).key;
    return getSavedAddProductModalDefaults().categoryKey;
  });
  const [categoryOther, setCategoryOther] = useState(() => {
    if (isEdit || isDuplicate) return parseCategoryFromStored(product?.category).other;
    return getSavedAddProductModalDefaults().categoryOther;
  });
  const [categoryOpen, setCategoryOpen] = useState(false);
  const categoryPickerRef = useRef(null);
  const excelFileInputRef = useRef(null);
  const [excelDragOver, setExcelDragOver] = useState(false);

  const fetchCustomDefinitions = async () => {
    try {
      const res = await fetch(`${API_BASE}/custom-field-definitions?entityType=product`, { headers: getAuthHeader() });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.items)) setCustomDefinitions(data.items);
    } catch (_) {}
  };

  useEffect(() => {
    fetchCustomDefinitions();
  }, []);

  useEffect(() => {
    setListPriceInput(formatPriceDisplay(listPriceFromProduct(product)));
    setCostPriceInput(formatPriceDisplay(Number(product?.costPrice) || 0));
    setChannelPriceInput(formatPriceDisplay(Number(product?.channelPrice) || 0));
  }, [product?._id, product?.price, product?.listPrice, product?.costPrice, product?.channelPrice]);

  useEffect(() => {
    if (!isEdit && !isDuplicate) return;
    const p = parseCategoryFromStored(product?.category);
    setCategoryKey(p.key);
    setCategoryOther(p.other);
  }, [isEdit, isDuplicate, product?._id, product?.category]);

  /** 신규 등록 모달이 열릴 때마다 마운트되며, 초기 state에서 listTemplates.addProductModal 복원됨. 저장 시 변경분만 서버·crm_user 갱신. */

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (showCustomFieldsModal) setShowCustomFieldsModal(false);
      else if (categoryOpen) setCategoryOpen(false);
      else onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, showCustomFieldsModal, categoryOpen]);

  useEffect(() => {
    if (!categoryOpen) return;
    const onDoc = (e) => {
      if (categoryPickerRef.current && !categoryPickerRef.current.contains(e.target)) {
        setCategoryOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [categoryOpen]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setError('');
  };

  const applyExcelDraftToForm = (draft) => {
    setForm((prev) => ({
      ...prev,
      ...draft.form,
      customFields: { ...(prev.customFields || {}), ...(draft.form.customFields || {}) }
    }));
    setListPriceInput(formatPriceDisplay(draft.listPrice));
    setCostPriceInput(formatPriceDisplay(draft.costPrice));
    setChannelPriceInput(formatPriceDisplay(draft.channelPrice));
    const cat = parseCategoryFromStored(draft.categoryRaw);
    setCategoryKey(cat.key);
    setCategoryOther(cat.other);
    setError('');
  };

  const handleExcelFileChosen = async (file) => {
    if (!file) return;
    const name = file.name || '';
    const ok =
      name.endsWith('.xlsx') ||
      name.endsWith('.xls') ||
      name.endsWith('.csv') ||
      /spreadsheet|excel|csv/i.test(file.type || '');
    if (!ok) {
      setError('엑셀(.xlsx, .xls) 또는 CSV만 올려 주세요.');
      return;
    }
    try {
      const json = await parseExcelFileToRows(file);
      const dataRows = (Array.isArray(json) ? json : []).filter((r) => !isExcelRowEffectivelyEmpty(r));
      if (dataRows.length === 0) {
        setError('데이터가 있는 행이 없습니다.');
        return;
      }
      if (dataRows.length > 1) {
        onOpenBulkImport({ rows: dataRows.slice(0, 500), fileName: name });
        return;
      }
      const draft = excelObjectToProductFormDraft(dataRows[0], customDefinitions);
      applyExcelDraftToForm(draft);
    } catch (e) {
      setError(e?.message || '파일을 읽지 못했습니다.');
    }
  };

  const onExcelInputChange = (e) => {
    const f = e.target.files?.[0];
    if (f) void handleExcelFileChosen(f);
    e.target.value = '';
  };

  const onExcelDrop = (e) => {
    e.preventDefault();
    setExcelDragOver(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) void handleExcelFileChosen(f);
  };

  const setBillingType = (value) => {
    setForm((prev) => ({ ...prev, billingType: value }));
    setError('');
  };

  const setStatus = (value) => {
    setForm((prev) => ({ ...prev, status: value }));
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.name?.trim()) {
      setError('제품명을 입력해 주세요.');
      return;
    }
    const listP = parsePriceInput(listPriceInput);
    const costP = parsePriceInput(costPriceInput);
    const channelP = parsePriceInput(channelPriceInput);
    const addModalSnapshot = isNewProductRegistration ? getSavedAddProductModalDefaults() : null;
    setSaving(true);
    try {
      const url = isEdit ? `${API_BASE}/products/${product._id}` : `${API_BASE}/products`;
      const method = isEdit ? 'PATCH' : 'POST';
      const categoryPayload =
        categoryKey === 'other'
          ? String(categoryOther).trim() || undefined
          : categoryKey
            ? categoryKey
            : undefined;
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({
          name: form.name.trim(),
          code: form.code.trim() || undefined,
          category: categoryPayload,
          version: form.version.trim() || undefined,
          listPrice: listP,
          costPrice: costP,
          channelPrice: channelP,
          price: listP,
          currency: form.currency,
          billingType: form.billingType,
          status: form.status,
          customFields: form.customFields && Object.keys(form.customFields).length ? form.customFields : undefined
        })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || '저장에 실패했습니다.');
        return;
      }
      if (addModalSnapshot && !isEdit) {
        const billingChanged = addModalSnapshot.billingType !== form.billingType;
        const catChanged =
          addModalSnapshot.categoryKey !== categoryKey ||
          String(addModalSnapshot.categoryOther || '') !== String(categoryOther || '');
        if (billingChanged || catChanged) {
          try {
            await patchAddProductModalDefaults({
              categoryKey,
              categoryOther,
              billingType: form.billingType
            });
          } catch {
            /* listTemplates 갱신 실패해도 제품 저장은 완료된 상태 */
          }
        }
      }
      onSaved?.();
      onClose?.();
    } catch (_) {
      setError('서버에 연결할 수 없습니다.');
    } finally {
      setSaving(false);
    }
  };

  const categoryTriggerAvatar = getPresetCategoryAvatar(categoryKey);

  return (
    <div className={`add-product-modal-overlay ${isSlidePanel ? 'add-product-modal-overlay--slide' : ''}`}>
      <div className={`add-product-modal ${isSlidePanel ? 'add-product-modal--slide' : ''}`}>
        <div className="add-product-modal-header">
          <div className="add-product-modal-header-text">
            <h2 className="add-product-modal-title">
              {isEdit ? '제품 수정' : isDuplicate ? '제품 복제' : '신규 제품 등록'}
            </h2>
            <p className="add-product-modal-subtitle">
              {isEdit
                ? '제품 정보를 수정합니다.'
                : isDuplicate
                  ? '원본 제품 정보를 불러왔습니다. 수정 후 저장하면 새 제품으로 등록됩니다.'
                  : '시스템에 새로운 제품 정보를 입력합니다.'}
            </p>
          </div>
          <button type="button" className="add-product-modal-close" onClick={onClose} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="add-product-modal-form">
          <div className="add-product-modal-body">
            {error && <p className="add-product-modal-error">{error}</p>}

            {showExcelDrop ? (
              <>
                <input
                  ref={excelFileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                  className="visually-hidden"
                  style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
                  onChange={onExcelInputChange}
                />
                <div
                  role="button"
                  tabIndex={0}
                  className={`cc-excel-dropzone add-product-modal-excel-drop ${excelDragOver ? 'is-dragover' : ''}`}
                  onDragEnter={(e) => { e.preventDefault(); setExcelDragOver(true); }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    if (!e.currentTarget.contains(e.relatedTarget)) setExcelDragOver(false);
                  }}
                  onDragOver={(e) => { e.preventDefault(); }}
                  onDrop={onExcelDrop}
                  onClick={() => excelFileInputRef.current?.click()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      excelFileInputRef.current?.click();
                    }
                  }}
                >
                  <span className="material-symbols-outlined cc-excel-dropzone-icon">cloud_upload</span>
                  <p className="cc-excel-dropzone-title">엑셀·CSV를 놓거나 클릭하여 선택</p>
                  <p className="cc-excel-dropzone-hint">
                    1행(데이터)이면 아래 양식에 자동 기입 · 2행 이상이면 제품 일괄 등록으로 이동합니다
                  </p>
                </div>
              </>
            ) : null}

            <section className="add-product-modal-section">
              <div className="add-product-modal-section-head add-product-modal-section-head--basic">
                <span className="add-product-modal-section-accent" aria-hidden />
                <h3 className="add-product-modal-section-title">기본 정보</h3>
              </div>
              <div className="add-product-modal-grid add-product-modal-grid--basic">
                <div className="add-product-modal-field">
                  <label htmlFor="add-product-name">제품명 <span className="required">*</span></label>
                  <input
                    id="add-product-name"
                    name="name"
                    type="text"
                    value={form.name}
                    onChange={handleChange}
                    placeholder="제품 이름을 입력하세요"
                    required
                  />
                </div>
                <div className="add-product-modal-field">
                  <label htmlFor="add-product-code">제품 코드 (UID)</label>
                  <div className="add-product-modal-input-icon-wrap">
                    <input
                      id="add-product-code"
                      name="code"
                      type="text"
                      value={form.code}
                      onChange={handleChange}
                      placeholder="예: SP-9920"
                      className="add-product-modal-input-mono"
                      autoComplete="off"
                    />
                    <span className="material-symbols-outlined add-product-modal-input-suffix" aria-hidden>fingerprint</span>
                  </div>
                </div>
                <div className="add-product-modal-field add-product-modal-field--category" ref={categoryPickerRef}>
                  <label id="add-product-category-label">카테고리</label>
                  <div className="add-product-modal-category-picker">
                    <button
                      type="button"
                      id="add-product-category"
                      className="add-product-modal-category-trigger"
                      aria-labelledby="add-product-category-label"
                      aria-haspopup="listbox"
                      aria-expanded={categoryOpen}
                      onClick={() => {
                        setCategoryOpen((o) => !o);
                        setError('');
                      }}
                    >
                      <span className="add-product-category-avatar-slot" aria-hidden>
                        {categoryTriggerAvatar ? (
                          <div
                            className={`pl-mcard-icon pl-mcard-icon--${categoryTriggerAvatar.tone} add-product-category-avatar--trigger`}
                          >
                            <span className="material-symbols-outlined">{categoryTriggerAvatar.icon}</span>
                          </div>
                        ) : (
                          <div className="add-product-category-avatar-placeholder add-product-category-avatar--trigger" />
                        )}
                      </span>
                      <span className="add-product-category-trigger-text">
                        {getCategoryTriggerLabel(categoryKey, categoryOther)}
                      </span>
                      <span className="material-symbols-outlined add-product-category-chevron" aria-hidden>
                        expand_more
                      </span>
                    </button>
                    {categoryOpen ? (
                      <ul className="add-product-modal-category-list" role="listbox" aria-labelledby="add-product-category-label">
                        <li role="none">
                          <button
                            type="button"
                            role="option"
                            aria-selected={!categoryKey}
                            className={`add-product-modal-category-option ${!categoryKey ? 'is-active' : ''}`}
                            onClick={() => {
                              setCategoryKey('');
                              setCategoryOther('');
                              setCategoryOpen(false);
                              setError('');
                            }}
                          >
                            <span className="add-product-category-avatar-slot" aria-hidden>
                              <div className="add-product-category-avatar-placeholder add-product-category-avatar--row" />
                            </span>
                            <span>선택 안 함</span>
                          </button>
                        </li>
                        {PRODUCT_CATEGORY_OPTIONS.map((opt) => {
                          const optAv = getPresetCategoryAvatar(opt.value);
                          return (
                            <li key={opt.value} role="none">
                              <button
                                type="button"
                                role="option"
                                aria-selected={categoryKey === opt.value}
                                className={`add-product-modal-category-option ${categoryKey === opt.value ? 'is-active' : ''}`}
                                onClick={() => {
                                  setCategoryKey(opt.value);
                                  if (opt.value !== 'other') setCategoryOther('');
                                  setCategoryOpen(false);
                                  setError('');
                                }}
                              >
                                <span className="add-product-category-avatar-slot" aria-hidden>
                                  {optAv ? (
                                    <div
                                      className={`pl-mcard-icon pl-mcard-icon--${optAv.tone} add-product-category-avatar--row`}
                                    >
                                      <span className="material-symbols-outlined">{optAv.icon}</span>
                                    </div>
                                  ) : (
                                    <div className="add-product-category-avatar-placeholder add-product-category-avatar--row" />
                                  )}
                                </span>
                                <span>{opt.label}</span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </div>
                  {categoryKey === 'other' ? (
                    <input
                      id="add-product-category-other"
                      type="text"
                      value={categoryOther}
                      onChange={(e) => {
                        setCategoryOther(e.target.value);
                        setError('');
                      }}
                      placeholder="카테고리를 직접 입력하세요"
                      className="add-product-modal-category-other"
                      autoComplete="off"
                      aria-label="기타 카테고리 직접 입력"
                    />
                  ) : null}
                </div>
                <div className="add-product-modal-field">
                  <label htmlFor="add-product-version">버전</label>
                  <input id="add-product-version" name="version" type="text" value={form.version} onChange={handleChange} placeholder="v1.0.0" />
                </div>
              </div>
            </section>

            <section className="add-product-modal-section">
              <div className="add-product-modal-section-head add-product-modal-section-head--pricing">
                <span className="add-product-modal-section-accent add-product-modal-section-accent--tertiary" aria-hidden />
                <h3 className="add-product-modal-section-title add-product-modal-section-title--tertiary">가격 및 금융 설정</h3>
              </div>
              <div className="add-product-modal-grid add-product-modal-grid--pricing">
                <div className="add-product-modal-field add-product-modal-field--span2">
                  <label htmlFor="add-product-list-price">소비자 가격</label>
                  <div className="add-product-modal-price-currency-row">
                    <input
                      id="add-product-list-price"
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="0"
                      value={listPriceInput}
                      onChange={(e) => {
                        setListPriceInput(formatPriceWhileTyping(e.target.value));
                        setError('');
                      }}
                      onBlur={() => {
                        const n = parsePriceInput(listPriceInput);
                        setListPriceInput(formatPriceDisplay(n));
                      }}
                    />
                    <select
                      id="add-product-currency"
                      name="currency"
                      value={form.currency}
                      onChange={handleChange}
                      className="add-product-modal-currency-select"
                      aria-label="통화"
                    >
                      {CURRENCY_OPTIONS.map((c) => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="add-product-modal-field add-product-modal-field--pricing-status">
                  <span id="add-product-status-label" className="add-product-modal-label">상태</span>
                  <div className="add-product-modal-segmented" role="group" aria-labelledby="add-product-status-label">
                    {STATUS_OPTIONS.map(({ value, label }) => (
                      <button
                        key={value}
                        type="button"
                        className={`add-product-modal-segment ${form.status === value ? 'is-active' : ''}`}
                        onClick={() => setStatus(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="add-product-modal-field add-product-modal-field--pricing-half">
                  <label htmlFor="add-product-cost-price">원가 (Cost)</label>
                  <input
                    id="add-product-cost-price"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0"
                    value={costPriceInput}
                    onChange={(e) => {
                      setCostPriceInput(formatPriceWhileTyping(e.target.value));
                      setError('');
                    }}
                    onBlur={() => {
                      const n = parsePriceInput(costPriceInput);
                      setCostPriceInput(formatPriceDisplay(n));
                    }}
                  />
                </div>
                <div className="add-product-modal-field add-product-modal-field--pricing-half">
                  <label htmlFor="add-product-channel-price">유통가</label>
                  <input
                    id="add-product-channel-price"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0"
                    value={channelPriceInput}
                    onChange={(e) => {
                      setChannelPriceInput(formatPriceWhileTyping(e.target.value));
                      setError('');
                    }}
                    onBlur={() => {
                      const n = parsePriceInput(channelPriceInput);
                      setChannelPriceInput(formatPriceDisplay(n));
                    }}
                  />
                </div>
                <div className="add-product-modal-field add-product-modal-field--billing-full">
                  <span id="add-product-billing-label" className="add-product-modal-label">결제 주기</span>
                  <div className="add-product-modal-radio-row" role="radiogroup" aria-labelledby="add-product-billing-label">
                    {BILLING_OPTIONS.map((b) => (
                      <label key={b} className={`add-product-modal-radio ${form.billingType === b ? 'is-checked' : ''}`}>
                        <input
                          type="radio"
                          name="billingType"
                          value={b}
                          checked={form.billingType === b}
                          onChange={() => setBillingType(b)}
                        />
                        <span>{BILLING_LABELS[b]}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <CustomFieldsSection
              definitions={customDefinitions}
              values={form.customFields || {}}
              onChangeValues={(key, value) => setForm((prev) => ({
                ...prev,
                customFields: { ...(prev.customFields || {}), [key]: value }
              }))}
              fieldClassName="add-product-modal-field"
            />
          </div>
          <div className="add-product-modal-footer">
            {canManageCustomFieldDefinitions ? (
              <button type="button" className="add-product-modal-extra" onClick={() => setShowCustomFieldsModal(true)}>
                <span className="material-symbols-outlined">add_circle</span>
                추가 필드
              </button>
            ) : null}
            <div className="add-product-modal-footer-actions">
              <button type="button" className="add-product-modal-cancel" onClick={onClose}>취소</button>
              <button type="submit" className="add-product-modal-save" disabled={saving}>
                <span className="material-symbols-outlined add-product-modal-save-icon">save</span>
                {saving ? '저장 중…' : '제품 저장'}
              </button>
            </div>
          </div>
        </form>
      </div>
      {showCustomFieldsModal && canManageCustomFieldDefinitions && (
        <CustomFieldsManageModal
          entityType="product"
          onClose={() => setShowCustomFieldsModal(false)}
          onFieldAdded={() => { fetchCustomDefinitions(); setShowCustomFieldsModal(false); }}
          apiBase={API_BASE}
          getAuthHeader={getAuthHeader}
        />
      )}
    </div>
  );
}
