import { useState, useEffect, useRef, useMemo } from 'react';
import CustomFieldsSection from '../../shared/custom-fields-section';
import CustomFieldsDisplay from '../../shared/custom-fields-display';
import CustomFieldsManageModal from '../../shared/custom-fields-manage-modal/custom-fields-manage-modal';
import CustomFieldsFormulaPickerPanel from '../../shared/custom-fields-formula-picker-panel/custom-fields-formula-picker-panel';
import { listPriceFromProduct } from '@/lib/product-price-utils';
import {
  getConsumerMargin,
  getChannelMargin,
  shouldDashChannelMargin,
  PRODUCT_BUILTIN_MARGIN_EXPRESSIONS
} from '@/lib/product-margin';
import { mergeCustomFieldsForSave } from '@/lib/custom-field-formula';
import { formatProductBillingDisplay } from '@/lib/product-billing-utils';
import { getPresetCategoryAvatar } from '../product-category-avatar-config';
import './add-product-modal.css';

import { API_BASE } from '@/config';
import { getStoredCrmUser, isAdminOrAboveRole } from '@/lib/crm-role-utils';
import { getSavedAddProductModalDefaults, patchAddProductModalDefaults } from '@/lib/list-templates';
import {
  billingIntervalUnitLabel,
  normalizeBillingInterval,
  parseBillingIntervalInput,
  showBillingIntervalInput
} from '@/lib/product-billing-utils';
import {
  excelObjectToProductFormDraft,
  isExcelRowEffectivelyEmpty,
  parseExcelFileToRows
} from '../product-excel-import-modal/product-excel-import-utils';
import '../../customer-companies/customer-companies-excel-import-modal/customer-companies-excel-import-modal.css';
import {
  buildEximAvailableCurrencySelectOptions
} from '@/lib/exchange-rate-currency-options';
import { useExchangeRates } from '@/lib/use-exchange-rates';
import { buildExchangeRateFormulaBuiltin } from '@/lib/exchange-rate-formula-builtin';
import {
  buildLiveProductDraft,
  buildProductFieldPayload,
  buildProductFormulaCatalogGroups,
  buildProductFormulaPickerOptions,
  isProductFieldFormulaInput,
  mergeResolvedProductRow,
  productFieldInputFromStored,
  resolveProductFormulasUnified
} from '@/lib/product-field-formulas';
import { useProductFormulaPicker } from '@/lib/use-product-formula-picker';
import { parseNumericFieldValueOrZero } from '@/lib/numeric-field-value';

const STATUS_LABELS = { Active: '활성', EndOfLife: 'End of Life', Draft: '초안' };
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

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** 복제 시 _id 등 제거 */
function productToDuplicateDraft(source) {
  if (!source) return null;
  const { _id, __v, createdAt, updatedAt, companyId, ...rest } = source;
  return {
    ...rest,
    customFields: source.customFields && typeof source.customFields === 'object'
      ? { ...source.customFields }
      : {}
  };
}

function formatPriceView(price) {
  if (price == null) return '—';
  return Number(price).toLocaleString();
}

function resolveInitialPanelMode({ product, variant, initialMode }) {
  if (!product) return 'create';
  if (variant === 'duplicate') return 'duplicate';
  if (initialMode === 'view') return 'view';
  if (product._id) return 'edit';
  return 'create';
}

function applyProductToFormState(product, savedNew) {
  const cat = parseCategoryFromStored(product?.category);
  const priceFmt = { formatPriceDisplay: (n) => formatPriceDisplay(n) };
  const categoryFromFormula = product?.fieldFormulas?.category;
  return {
    form: {
      currency: product?.currency ?? 'KRW',
      billingType: product?.billingType ?? savedNew?.billingType ?? 'Monthly',
      billingInterval: normalizeBillingInterval(
        product?.billingType ?? savedNew?.billingType ?? 'Monthly',
        product?.billingInterval ?? savedNew?.billingInterval ?? 1
      ),
      status: product?.status ?? 'Active',
      customFields: product?.customFields ? { ...product.customFields } : {}
    },
    nameInput: productFieldInputFromStored('name', product, priceFmt),
    codeInput: productFieldInputFromStored('code', product, priceFmt),
    versionInput: productFieldInputFromStored('version', product, priceFmt),
    listPriceInput: productFieldInputFromStored('listPrice', product, priceFmt),
    costPriceInput: productFieldInputFromStored('costPrice', product, priceFmt),
    channelPriceInput: productFieldInputFromStored('channelPrice', product, priceFmt),
    consumerMarginInput: productFieldInputFromStored('consumerMargin', product, priceFmt),
    channelMarginInput: productFieldInputFromStored('channelMargin', product, priceFmt),
    billingIntervalInput: productFieldInputFromStored('billingInterval', product, priceFmt),
    categoryKey: categoryFromFormula ? 'other' : cat.key,
    categoryOther: categoryFromFormula
      ? productFieldInputFromStored('category', product, priceFmt)
      : cat.other
  };
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

/** 입력 문자열 → 숫자 (수식 입력은 0 — fieldFormulas에서 별도 계산) */
function parsePriceInput(str) {
  const v = String(str ?? '').replace(/,/g, '').trim();
  if (v === '' || v === '.') return 0;
  if (isProductFieldFormulaInput(v)) return 0;
  return parseNumericFieldValueOrZero(v);
}

/**
 * 입력 중 천 단위 쉼표 삽입 (정수부만). 소수점 이하 원문 유지.
 */
function formatPriceWhileTyping(raw) {
  const s = String(raw).replace(/,/g, '');
  if (s.trimStart().startsWith('=')) return String(raw);
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

function handleFormulaCapableTextChange(setter, raw) {
  setter(String(raw ?? ''));
}

function handleFormulaCapablePriceChange(setter, raw) {
  setter(formatPriceWhileTyping(raw));
}

function handleFormulaCapablePriceBlur(getter, setter) {
  const val = getter();
  if (isProductFieldFormulaInput(val)) return;
  const n = parsePriceInput(val);
  setter(formatPriceDisplay(n));
}

function formatFormulaFieldPreview(value, kind, currency) {
  if (value == null || value === '') return '—';
  if (kind === 'money') return formatPriceView(value);
  if (kind === 'number') {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return Number.isInteger(n) ? String(n) : n.toLocaleString('ko-KR', { maximumFractionDigits: 4 });
  }
  const text = String(value).trim();
  return text || '—';
}

/** 수식(=…) 입력 시 라벨 오른쪽에 계산 결과 미리보기 */
function FormulaFieldLabel({ htmlFor, required = false, formulaInput, preview, children }) {
  if (!isProductFieldFormulaInput(formulaInput)) {
    return (
      <label htmlFor={htmlFor}>
        {children}
        {required ? <span className="required"> *</span> : null}
      </label>
    );
  }
  return (
    <div className="add-product-modal-field-label-row">
      <label htmlFor={htmlFor}>
        {children}
        {required ? <span className="required"> *</span> : null}
      </label>
      <span className="add-product-modal-formula-preview" title="수식 결과 미리보기">
        {preview ?? '—'}
      </span>
    </div>
  );
}

export default function AddProductModal({
  product,
  onClose,
  onSaved,
  presentation = 'centered',
  variant,
  /** create | view | edit | duplicate — 목록 행 클릭 시 view */
  initialMode,
  onDelete,
  /** 2행 이상 엑셀 시 일괄 등록 모달로 넘김 (제품 목록에서만 전달) */
  onOpenBulkImport
}) {
  const [panelMode, setPanelMode] = useState(() => resolveInitialPanelMode({ product, variant, initialMode }));
  const isViewMode = panelMode === 'view';
  const isEdit = panelMode === 'edit' && !!product?._id;
  const isDuplicate = panelMode === 'duplicate';
  const isDetailSlideFlow = presentation === 'slide' && initialMode === 'view';
  /** 신규 제품 등록(목록에서 열기)일 때만 listTemplates.addProductModal 저장·복원 */
  const isNewProductRegistration = panelMode === 'create';
  const canManageCustomFieldDefinitions = isAdminOrAboveRole(getStoredCrmUser()?.role);
  const isSlidePanel = presentation === 'slide' && (isViewMode || isEdit || isDuplicate);
  const showExcelDrop = panelMode === 'create' && typeof onOpenBulkImport === 'function';
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState(() => {
    const savedNew = isNewProductRegistration ? getSavedAddProductModalDefaults() : null;
    return applyProductToFormState(product, savedNew).form;
  });
  const [customDefinitions, setCustomDefinitions] = useState([]);
  const [showCustomFieldsModal, setShowCustomFieldsModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [nameInput, setNameInput] = useState(() => {
    const savedNew = isNewProductRegistration ? getSavedAddProductModalDefaults() : null;
    return applyProductToFormState(product, savedNew).nameInput;
  });
  const [codeInput, setCodeInput] = useState(() => {
    const savedNew = isNewProductRegistration ? getSavedAddProductModalDefaults() : null;
    return applyProductToFormState(product, savedNew).codeInput;
  });
  const [versionInput, setVersionInput] = useState(() => {
    const savedNew = isNewProductRegistration ? getSavedAddProductModalDefaults() : null;
    return applyProductToFormState(product, savedNew).versionInput;
  });
  const [billingIntervalInput, setBillingIntervalInput] = useState(() => {
    const savedNew = isNewProductRegistration ? getSavedAddProductModalDefaults() : null;
    return applyProductToFormState(product, savedNew).billingIntervalInput;
  });
  const [listPriceInput, setListPriceInput] = useState(() => {
    const savedNew = isNewProductRegistration ? getSavedAddProductModalDefaults() : null;
    return applyProductToFormState(product, savedNew).listPriceInput;
  });
  const [costPriceInput, setCostPriceInput] = useState(() => {
    const savedNew = isNewProductRegistration ? getSavedAddProductModalDefaults() : null;
    return applyProductToFormState(product, savedNew).costPriceInput;
  });
  const [channelPriceInput, setChannelPriceInput] = useState(() => {
    const savedNew = isNewProductRegistration ? getSavedAddProductModalDefaults() : null;
    return applyProductToFormState(product, savedNew).channelPriceInput;
  });
  const [consumerMarginInput, setConsumerMarginInput] = useState(() => {
    const savedNew = isNewProductRegistration ? getSavedAddProductModalDefaults() : null;
    return applyProductToFormState(product, savedNew).consumerMarginInput;
  });
  const [channelMarginInput, setChannelMarginInput] = useState(() => {
    const savedNew = isNewProductRegistration ? getSavedAddProductModalDefaults() : null;
    return applyProductToFormState(product, savedNew).channelMarginInput;
  });
  const [categoryKey, setCategoryKey] = useState(() => {
    if (panelMode === 'create') return getSavedAddProductModalDefaults().categoryKey;
    return applyProductToFormState(product, null).categoryKey;
  });
  const [categoryOther, setCategoryOther] = useState(() => {
    if (panelMode === 'create') return getSavedAddProductModalDefaults().categoryOther;
    return applyProductToFormState(product, null).categoryOther;
  });
  const [formProductId, setFormProductId] = useState(isDuplicate ? null : product?._id ?? null);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const categoryPickerRef = useRef(null);
  const excelFileInputRef = useRef(null);
  const [excelDragOver, setExcelDragOver] = useState(false);
  const { dealBasRMap, usdSummary, pricingProfile } = useExchangeRates({
    getAuthHeader,
    respectSessionFreeze: true
  });

  const currencySelectOptions = useMemo(
    () => buildEximAvailableCurrencySelectOptions(dealBasRMap, form.currency),
    [dealBasRMap, form.currency]
  );

  const formulaExchangeCtx = useMemo(
    () => ({ usdSummary, dealBasRMap, pricingProfile }),
    [usdSummary, dealBasRMap, pricingProfile]
  );

  const liveProductDraft = useMemo(
    () => buildLiveProductDraft({
      nameInput,
      codeInput,
      versionInput,
      categoryKey,
      categoryOther,
      listPriceInput,
      costPriceInput,
      channelPriceInput,
      consumerMarginInput,
      channelMarginInput,
      billingIntervalInput,
      currency: form.currency,
      customFields: form.customFields,
      parsePriceInput
    }),
    [
      nameInput,
      codeInput,
      versionInput,
      categoryKey,
      categoryOther,
      listPriceInput,
      costPriceInput,
      channelPriceInput,
      consumerMarginInput,
      channelMarginInput,
      billingIntervalInput,
      form.currency,
      form.customFields
    ]
  );

  const resolvedLiveProduct = useMemo(
    () => resolveProductFormulasUnified(liveProductDraft, formulaExchangeCtx, customDefinitions),
    [liveProductDraft, formulaExchangeCtx, customDefinitions]
  );

  const formulaFieldOptions = useMemo(
    () => buildProductFormulaPickerOptions(customDefinitions),
    [customDefinitions]
  );
  const formulaCatalogGroups = useMemo(() => buildProductFormulaCatalogGroups(), []);

  const fieldValuesRef = useRef({});
  const fieldSettersRef = useRef({});
  fieldValuesRef.current = {
    name: () => nameInput,
    code: () => codeInput,
    version: () => versionInput,
    category: () => (categoryKey === 'other' ? categoryOther : categoryKey),
    listPrice: () => listPriceInput,
    costPrice: () => costPriceInput,
    channelPrice: () => channelPriceInput,
    consumerMargin: () => consumerMarginInput,
    channelMargin: () => channelMarginInput,
    billingInterval: () => billingIntervalInput
  };
  fieldSettersRef.current = {
    name: setNameInput,
    code: setCodeInput,
    version: setVersionInput,
    category: setCategoryOther,
    listPrice: setListPriceInput,
    costPrice: setCostPriceInput,
    channelPrice: setChannelPriceInput,
    consumerMargin: setConsumerMarginInput,
    channelMargin: setChannelMarginInput,
    billingInterval: setBillingIntervalInput
  };

  const { bindFormulaField, insertFieldLabel, insertFunctionName } = useProductFormulaPicker(
    fieldValuesRef,
    fieldSettersRef
  );

  const customFieldFormulaContext = useMemo(() => {
    const fxBuiltIn = buildExchangeRateFormulaBuiltin(usdSummary, dealBasRMap, form.currency, {
      profile: pricingProfile
    });
    return {
      entityType: 'product',
      definitions: customDefinitions,
      builtIn: {
        listPrice: resolvedLiveProduct.listPrice,
        price: resolvedLiveProduct.listPrice,
        costPrice: resolvedLiveProduct.costPrice,
        channelPrice: resolvedLiveProduct.channelPrice,
        consumerMargin: resolvedLiveProduct.consumerMargin,
        channelMargin: resolvedLiveProduct.channelMargin,
        ...fxBuiltIn
      },
      computedFormulas: resolvedLiveProduct.customFields || {}
    };
  }, [resolvedLiveProduct, customDefinitions, dealBasRMap, usdSummary, pricingProfile, form.currency]);

  const viewResolvedProduct = useMemo(
    () => (product ? mergeResolvedProductRow(product, formulaExchangeCtx, customDefinitions) : null),
    [product, formulaExchangeCtx, customDefinitions]
  );

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
    if (panelMode !== 'view' || !product) return;
    const next = applyProductToFormState(product, null);
    setForm(next.form);
    setNameInput(next.nameInput);
    setCodeInput(next.codeInput);
    setVersionInput(next.versionInput);
    setListPriceInput(next.listPriceInput);
    setCostPriceInput(next.costPriceInput);
    setChannelPriceInput(next.channelPriceInput);
    setConsumerMarginInput(next.consumerMarginInput);
    setChannelMarginInput(next.channelMarginInput);
    setBillingIntervalInput(next.billingIntervalInput);
    setCategoryKey(next.categoryKey);
    setCategoryOther(next.categoryOther);
    setFormProductId(product._id ?? null);
  }, [
    panelMode,
    product?._id,
    product?.updatedAt,
    product?.name,
    product?.price,
    product?.listPrice,
    product?.costPrice,
    product?.channelPrice,
    product?.currency,
    product?.category,
    product?.version,
    product?.billingType,
    product?.billingInterval,
    product?.status
  ]);

  useEffect(() => {
    if (panelMode !== 'duplicate' || !product) return;
    const draft = productToDuplicateDraft(product);
    const next = applyProductToFormState(draft, null);
    setForm(next.form);
    setNameInput(next.nameInput);
    setCodeInput(next.codeInput);
    setVersionInput(next.versionInput);
    setListPriceInput(next.listPriceInput);
    setCostPriceInput(next.costPriceInput);
    setChannelPriceInput(next.channelPriceInput);
    setConsumerMarginInput(next.consumerMarginInput);
    setChannelMarginInput(next.channelMarginInput);
    setBillingIntervalInput(next.billingIntervalInput);
    setCategoryKey(next.categoryKey);
    setCategoryOther(next.categoryOther);
    setFormProductId(null);
  }, [panelMode, product?._id]);

  /** 신규 등록 모달이 열릴 때마다 마운트되며, 초기 state에서 listTemplates.addProductModal 복원됨. 저장 시 변경분만 서버·crm_user 갱신. */

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (showDeleteConfirm) setShowDeleteConfirm(false);
      else if (showCustomFieldsModal) setShowCustomFieldsModal(false);
      else if (categoryOpen) setCategoryOpen(false);
      else if ((panelMode === 'edit' || panelMode === 'duplicate') && isDetailSlideFlow) setPanelMode('view');
      else onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, showCustomFieldsModal, categoryOpen, showDeleteConfirm, panelMode, isDetailSlideFlow]);

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
    setNameInput(draft.form?.name ?? draft.name ?? '');
    setCodeInput(draft.form?.code ?? draft.code ?? '');
    setVersionInput(draft.form?.version ?? draft.version ?? '');
    setListPriceInput(formatPriceDisplay(draft.listPrice));
    setCostPriceInput(formatPriceDisplay(draft.costPrice));
    setChannelPriceInput(formatPriceDisplay(draft.channelPrice));
    setBillingIntervalInput(String(draft.form?.billingInterval ?? draft.billingInterval ?? 1));
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
    setForm((prev) => ({
      ...prev,
      billingType: value,
      billingInterval: value === 'Perpetual' ? 1 : normalizeBillingInterval(value, prev.billingInterval)
    }));
    setError('');
  };

  const setBillingInterval = (raw) => {
    const n = parseBillingIntervalInput(raw, form.billingType);
    setForm((prev) => ({ ...prev, billingInterval: n }));
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const payload = buildProductFieldPayload({
      inputs: {
        name: nameInput,
        code: codeInput,
        version: versionInput,
        listPrice: listPriceInput,
        costPrice: costPriceInput,
        channelPrice: channelPriceInput,
        consumerMargin: consumerMarginInput,
        channelMargin: channelMarginInput,
        billingInterval: billingIntervalInput,
        customFields: form.customFields
      },
      categoryKey,
      categoryOther,
      currency: form.currency,
      definitions: customDefinitions,
      exchangeCtx: formulaExchangeCtx,
      parsePriceInput
    });
    if (!payload.ok) {
      setError(payload.error || '입력값을 확인해 주세요.');
      return;
    }
    const addModalSnapshot = isNewProductRegistration ? getSavedAddProductModalDefaults() : null;
    setSaving(true);
    try {
      const url = isEdit ? `${API_BASE}/products/${formProductId || product._id}` : `${API_BASE}/products`;
      const method = isEdit ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({
          ...payload.body,
          currency: form.currency,
          billingType: form.billingType,
          billingInterval: normalizeBillingInterval(form.billingType, payload.body.billingInterval),
          status: form.status,
          customFields: mergeCustomFieldsForSave(
            customDefinitions,
            form.customFields,
            customFieldFormulaContext
          )
        })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || '저장에 실패했습니다.');
        return;
      }
      if (addModalSnapshot && !isEdit) {
        const billingChanged =
          addModalSnapshot.billingType !== form.billingType ||
          Number(addModalSnapshot.billingInterval) !== Number(form.billingInterval);
        const catChanged =
          addModalSnapshot.categoryKey !== categoryKey ||
          String(addModalSnapshot.categoryOther || '') !== String(categoryOther || '');
        if (billingChanged || catChanged) {
          try {
            await patchAddProductModalDefaults({
              categoryKey,
              categoryOther,
              billingType: form.billingType,
              billingInterval: normalizeBillingInterval(form.billingType, form.billingInterval)
            });
          } catch {
            /* listTemplates 갱신 실패해도 제품 저장은 완료된 상태 */
          }
        }
      }
      if (isEdit && isDetailSlideFlow) {
        onSaved?.();
        setPanelMode('view');
      } else {
        onSaved?.();
        onClose?.();
      }
    } catch (_) {
      setError('서버에 연결할 수 없습니다.');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = () => {
    if (!product?._id) return;
    setPanelMode('edit');
    setFormProductId(product._id);
    setError('');
  };

  const startDuplicate = () => {
    if (!product) return;
    setPanelMode('duplicate');
    setError('');
  };

  const handleDeleteConfirm = async () => {
    if (!product || !onDelete) return;
    setDeleting(true);
    try {
      await onDelete(product);
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleFormDismiss = () => {
    if ((panelMode === 'edit' || panelMode === 'duplicate') && isDetailSlideFlow) {
      setPanelMode('view');
      setError('');
      return;
    }
    onClose?.();
  };

  const categoryTriggerAvatar = getPresetCategoryAvatar(categoryKey);

  if (!product && panelMode !== 'create') return null;

  if (isViewMode && product) {
    const displayProduct = viewResolvedProduct || product;
    const statusClass = displayProduct.status === 'Active' ? 'active' : displayProduct.status === 'EndOfLife' ? 'eol' : 'draft';
    const catParsed = parseCategoryFromStored(displayProduct.category);
    const categoryDisplay = catParsed.key
      ? getCategoryTriggerLabel(catParsed.key, catParsed.other)
      : '—';

    return (
      <div className={`add-product-modal-overlay ${isSlidePanel ? 'add-product-modal-overlay--slide' : ''}`}>
        <div className={`add-product-modal add-product-modal--view ${isSlidePanel ? 'add-product-modal--slide' : ''}`}>
          <header className="product-detail-header">
            <div className="product-detail-header-title">
              <h2>제품 세부정보</h2>
            </div>
            <div className="product-detail-header-actions">
              {onSaved ? (
                <button type="button" className="product-detail-icon-btn" onClick={startEdit} title="수정">
                  <span className="material-symbols-outlined">edit</span>
                </button>
              ) : null}
              {onSaved ? (
                <button type="button" className="product-detail-icon-btn" onClick={startDuplicate} title="복제하여 새 제품 등록">
                  <span className="material-symbols-outlined">content_copy</span>
                </button>
              ) : null}
              {onDelete ? (
                <button
                  type="button"
                  className="product-detail-icon-btn product-detail-delete-btn"
                  onClick={() => setShowDeleteConfirm(true)}
                  title="삭제"
                >
                  <span className="material-symbols-outlined">delete</span>
                </button>
              ) : null}
              <button type="button" className="product-detail-icon-btn" onClick={onClose} aria-label="닫기">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
          </header>

          {showDeleteConfirm ? (
            <div className="product-detail-delete-confirm">
              <span className="material-symbols-outlined">warning</span>
              <p>이 제품을 삭제하시겠습니까?<br />삭제된 제품은 복구할 수 없습니다.</p>
              <div className="product-detail-delete-confirm-btns">
                <button
                  type="button"
                  className="product-detail-confirm-cancel"
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={deleting}
                >
                  취소
                </button>
                <button
                  type="button"
                  className="product-detail-confirm-delete"
                  onClick={() => void handleDeleteConfirm()}
                  disabled={deleting}
                >
                  {deleting ? '삭제 중...' : '삭제'}
                </button>
              </div>
            </div>
          ) : null}

          <div className="product-detail-body">
            <section className="product-detail-card">
              <div className="product-detail-icon-wrap">
                <span className="material-symbols-outlined">inventory_2</span>
              </div>
              <div className="product-detail-info">
                <div className="product-detail-name-row">
                  <h1 className="product-detail-name">{displayProduct.name || '—'}</h1>
                  <span className={`product-detail-status-badge status-${statusClass}`}>
                    {STATUS_LABELS[displayProduct.status] || displayProduct.status}
                  </span>
                </div>
                {displayProduct.code ? (
                  <p className="product-detail-uid">UID: {displayProduct.code}</p>
                ) : null}
              </div>
            </section>

            <section className="product-detail-section">
              <h3 className="product-detail-section-title">기본 정보</h3>
              <dl className="product-detail-dl">
                <div className="product-detail-dl-row">
                  <dt>카테고리</dt>
                  <dd>{categoryDisplay}</dd>
                </div>
                <div className="product-detail-dl-row">
                  <dt>버전</dt>
                  <dd>{displayProduct.version || '—'}</dd>
                </div>
                <div className="product-detail-dl-row">
                  <dt>소비자가</dt>
                  <dd>{formatPriceView(listPriceFromProduct(displayProduct))}</dd>
                </div>
                <div className="product-detail-dl-row">
                  <dt>원가</dt>
                  <dd>{formatPriceView(displayProduct.costPrice)}</dd>
                </div>
                <div className="product-detail-dl-row">
                  <dt>유통가</dt>
                  <dd>{formatPriceView(displayProduct.channelPrice)}</dd>
                </div>
                <div className="product-detail-dl-row">
                  <dt>순 마진</dt>
                  <dd>{formatPriceView(getConsumerMargin(displayProduct))}</dd>
                </div>
                <div className="product-detail-dl-row">
                  <dt>유통시 순 마진</dt>
                  <dd>
                    {shouldDashChannelMargin(displayProduct)
                      ? '—'
                      : formatPriceView(getChannelMargin(displayProduct))}
                  </dd>
                </div>
                <div className="product-detail-dl-row">
                  <dt>결제 주기</dt>
                  <dd>{formatProductBillingDisplay(product.billingType, product.billingInterval)}</dd>
                </div>
                <div className="product-detail-dl-row">
                  <dt>통화</dt>
                  <dd>{product.currency || '—'}</dd>
                </div>
              </dl>
            </section>
            <CustomFieldsDisplay
              definitions={customDefinitions}
              values={product.customFields || {}}
              className="product-detail-custom-fields"
              formulaContext={{
                entityType: 'product',
                builtIn: {
                  listPrice: listPriceFromProduct(product),
                  price: listPriceFromProduct(product),
                  costPrice: Number(product.costPrice) || 0,
                  channelPrice: Number(product.channelPrice) || 0,
                  ...buildExchangeRateFormulaBuiltin(usdSummary, dealBasRMap, product.currency, {
                    profile: pricingProfile
                  })
                }
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`add-product-modal-overlay ${isSlidePanel ? 'add-product-modal-overlay--slide' : ''}`}>
      <div className={`add-product-modal add-product-modal--with-formula-picker ${isSlidePanel ? 'add-product-modal--slide' : ''}`}>
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
          <button type="button" className="add-product-modal-close" onClick={handleFormDismiss} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="add-product-modal-form">
          <div className="add-product-modal-body-layout">
            <div className="add-product-modal-body">
            {error && <p className="add-product-modal-error">{error}</p>}
            <p className="add-product-modal-formula-hint">
              드롭다운·선택 UI가 아닌 입력란은 <strong>=</strong> 로 시작하는 수식을 쓸 수 있습니다. 오른쪽 패널에서 필드·함수를 클릭하면 커서 위치에 삽입됩니다.
            </p>

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
                  <FormulaFieldLabel
                    htmlFor="add-product-name"
                    required
                    formulaInput={nameInput}
                    preview={formatFormulaFieldPreview(resolvedLiveProduct.name, 'text')}
                  >
                    제품명
                  </FormulaFieldLabel>
                  <input
                    id="add-product-name"
                    type="text"
                    className={isProductFieldFormulaInput(nameInput) ? 'add-product-modal-input--formula' : ''}
                    value={nameInput}
                    onChange={(e) => {
                      handleFormulaCapableTextChange(setNameInput, e.target.value);
                      setError('');
                    }}
                    placeholder="제품 이름 또는 =[발주환율]*100"
                    spellCheck={false}
                    autoComplete="off"
                    required
                    {...bindFormulaField('name')}
                  />
                </div>
                <div className="add-product-modal-field">
                  <FormulaFieldLabel
                    htmlFor="add-product-code"
                    formulaInput={codeInput}
                    preview={formatFormulaFieldPreview(resolvedLiveProduct.code, 'text')}
                  >
                    제품 코드 (UID)
                  </FormulaFieldLabel>
                  <div className="add-product-modal-input-icon-wrap">
                    <input
                      id="add-product-code"
                      type="text"
                      value={codeInput}
                      onChange={(e) => {
                        handleFormulaCapableTextChange(setCodeInput, e.target.value);
                        setError('');
                      }}
                      placeholder="예: SP-9920 또는 =round([발주환율])"
                      className={`add-product-modal-input-mono${isProductFieldFormulaInput(codeInput) ? ' add-product-modal-input--formula' : ''}`}
                      autoComplete="off"
                      spellCheck={false}
                      {...bindFormulaField('code')}
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
                    <>
                      <FormulaFieldLabel
                        htmlFor="add-product-category-other"
                        formulaInput={categoryOther}
                        preview={formatFormulaFieldPreview(resolvedLiveProduct.category, 'text')}
                      >
                        기타 카테고리
                      </FormulaFieldLabel>
                      <input
                      id="add-product-category-other"
                      type="text"
                      value={categoryOther}
                      onChange={(e) => {
                        handleFormulaCapableTextChange(setCategoryOther, e.target.value);
                        setError('');
                      }}
                      placeholder="카테고리를 직접 입력하세요"
                      className={`add-product-modal-category-other${isProductFieldFormulaInput(categoryOther) ? ' add-product-modal-input--formula' : ''}`}
                      autoComplete="off"
                      spellCheck={false}
                      aria-label="기타 카테고리 직접 입력"
                      {...bindFormulaField('category')}
                    />
                    </>
                  ) : null}
                </div>
                <div className="add-product-modal-field">
                  <FormulaFieldLabel
                    htmlFor="add-product-version"
                    formulaInput={versionInput}
                    preview={formatFormulaFieldPreview(resolvedLiveProduct.version, 'text')}
                  >
                    버전
                  </FormulaFieldLabel>
                  <input
                    id="add-product-version"
                    type="text"
                    value={versionInput}
                    onChange={(e) => {
                      handleFormulaCapableTextChange(setVersionInput, e.target.value);
                      setError('');
                    }}
                    placeholder="v1.0.0"
                    className={isProductFieldFormulaInput(versionInput) ? 'add-product-modal-input--formula' : ''}
                    spellCheck={false}
                    autoComplete="off"
                    {...bindFormulaField('version')}
                  />
                </div>
              </div>
            </section>

            <section className="add-product-modal-section">
              <div className="add-product-modal-section-head add-product-modal-section-head--pricing">
                <span className="add-product-modal-section-accent add-product-modal-section-accent--tertiary" aria-hidden />
                <h3 className="add-product-modal-section-title add-product-modal-section-title--tertiary">가격 및 금융 설정</h3>
              </div>
              <div className="add-product-modal-grid add-product-modal-grid--pricing">
                <div className="add-product-modal-field add-product-modal-field--billing-full">
                  <FormulaFieldLabel
                    htmlFor="add-product-list-price"
                    formulaInput={listPriceInput}
                    preview={formatFormulaFieldPreview(resolvedLiveProduct.listPrice, 'money', form.currency)}
                  >
                    소비자 가격
                  </FormulaFieldLabel>
                  <div className="add-product-modal-price-currency-row">
                    <input
                      id="add-product-list-price"
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="0 또는 =[발주환율]*100"
                      className={isProductFieldFormulaInput(listPriceInput) ? 'add-product-modal-input--formula' : ''}
                      value={listPriceInput}
                      onChange={(e) => {
                        handleFormulaCapablePriceChange(setListPriceInput, e.target.value);
                        setError('');
                      }}
                      onBlur={() => handleFormulaCapablePriceBlur(() => listPriceInput, setListPriceInput)}
                      {...bindFormulaField('listPrice')}
                    />
                    <select
                      id="add-product-currency"
                      name="currency"
                      value={form.currency}
                      onChange={handleChange}
                      className="add-product-modal-currency-select"
                      aria-label="통화"
                    >
                      {currencySelectOptions.map((c) => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="add-product-modal-field add-product-modal-field--pricing-half">
                  <FormulaFieldLabel
                    htmlFor="add-product-cost-price"
                    formulaInput={costPriceInput}
                    preview={formatFormulaFieldPreview(resolvedLiveProduct.costPrice, 'money', form.currency)}
                  >
                    원가 (Cost)
                  </FormulaFieldLabel>
                  <input
                    id="add-product-cost-price"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="0 또는 =[발주환율]*80"
                    className={isProductFieldFormulaInput(costPriceInput) ? 'add-product-modal-input--formula' : ''}
                    value={costPriceInput}
                    onChange={(e) => {
                      handleFormulaCapablePriceChange(setCostPriceInput, e.target.value);
                      setError('');
                    }}
                    onBlur={() => handleFormulaCapablePriceBlur(() => costPriceInput, setCostPriceInput)}
                    {...bindFormulaField('costPrice')}
                  />
                </div>
                <div className="add-product-modal-field add-product-modal-field--pricing-half">
                  <FormulaFieldLabel
                    htmlFor="add-product-channel-price"
                    formulaInput={channelPriceInput}
                    preview={formatFormulaFieldPreview(resolvedLiveProduct.channelPrice, 'money', form.currency)}
                  >
                    유통가
                  </FormulaFieldLabel>
                  <input
                    id="add-product-channel-price"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="0 또는 =[유통가]"
                    className={isProductFieldFormulaInput(channelPriceInput) ? 'add-product-modal-input--formula' : ''}
                    value={channelPriceInput}
                    onChange={(e) => {
                      handleFormulaCapablePriceChange(setChannelPriceInput, e.target.value);
                      setError('');
                    }}
                    onBlur={() => handleFormulaCapablePriceBlur(() => channelPriceInput, setChannelPriceInput)}
                    {...bindFormulaField('channelPrice')}
                  />
                </div>
                <div className="add-product-modal-field add-product-modal-field--pricing-half">
                  <FormulaFieldLabel
                    htmlFor="add-product-consumer-margin"
                    formulaInput={consumerMarginInput}
                    preview={formatFormulaFieldPreview(resolvedLiveProduct.consumerMargin, 'money', form.currency)}
                  >
                    순 마진
                  </FormulaFieldLabel>
                  <input
                    id="add-product-consumer-margin"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={`0 또는 =${PRODUCT_BUILTIN_MARGIN_EXPRESSIONS.consumerMargin}`}
                    className={isProductFieldFormulaInput(consumerMarginInput) ? 'add-product-modal-input--formula' : ''}
                    value={consumerMarginInput}
                    onChange={(e) => {
                      handleFormulaCapablePriceChange(setConsumerMarginInput, e.target.value);
                      setError('');
                    }}
                    onBlur={() => handleFormulaCapablePriceBlur(() => consumerMarginInput, setConsumerMarginInput)}
                    {...bindFormulaField('consumerMargin')}
                  />
                </div>
                <div className="add-product-modal-field add-product-modal-field--pricing-half">
                  <FormulaFieldLabel
                    htmlFor="add-product-channel-margin"
                    formulaInput={channelMarginInput}
                    preview={formatFormulaFieldPreview(resolvedLiveProduct.channelMargin, 'money', form.currency)}
                  >
                    유통시 순 마진
                  </FormulaFieldLabel>
                  <input
                    id="add-product-channel-margin"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={`0 또는 =${PRODUCT_BUILTIN_MARGIN_EXPRESSIONS.channelMargin}`}
                    className={isProductFieldFormulaInput(channelMarginInput) ? 'add-product-modal-input--formula' : ''}
                    value={channelMarginInput}
                    onChange={(e) => {
                      handleFormulaCapablePriceChange(setChannelMarginInput, e.target.value);
                      setError('');
                    }}
                    onBlur={() => handleFormulaCapablePriceBlur(() => channelMarginInput, setChannelMarginInput)}
                    {...bindFormulaField('channelMargin')}
                  />
                </div>
                <div className="add-product-modal-field add-product-modal-field--billing-full">
                  <span id="add-product-billing-label" className="add-product-modal-label">결제 주기</span>
                  <div className="add-product-modal-billing-row">
                    <div
                      className="add-product-modal-segmented add-product-modal-segmented--billing"
                      role="group"
                      aria-labelledby="add-product-billing-label"
                    >
                      {BILLING_OPTIONS.map((b) => (
                        <button
                          key={b}
                          type="button"
                          className={`add-product-modal-segment ${form.billingType === b ? 'is-active' : ''}`}
                          onClick={() => setBillingType(b)}
                        >
                          {BILLING_LABELS[b]}
                        </button>
                      ))}
                    </div>
                    {showBillingIntervalInput(form.billingType) ? (
                      <div className="add-product-modal-billing-interval">
                        <FormulaFieldLabel
                          htmlFor="add-product-billing-interval"
                          formulaInput={billingIntervalInput}
                          preview={
                            isProductFieldFormulaInput(billingIntervalInput)
                              ? `${formatFormulaFieldPreview(resolvedLiveProduct.billingInterval, 'number')}${billingIntervalUnitLabel(form.billingType) ? ` ${billingIntervalUnitLabel(form.billingType)}` : ''}`
                              : null
                          }
                        >
                          기간
                        </FormulaFieldLabel>
                        <input
                          id="add-product-billing-interval"
                          type="text"
                          inputMode="numeric"
                          className={`add-product-modal-billing-interval-input${
                            isProductFieldFormulaInput(billingIntervalInput) ? ' add-product-modal-input--formula' : ''
                          }`}
                          value={billingIntervalInput}
                          onChange={(e) => {
                            handleFormulaCapableTextChange(setBillingIntervalInput, e.target.value);
                            setError('');
                          }}
                          onBlur={() => {
                            if (isProductFieldFormulaInput(billingIntervalInput)) return;
                            const n = parseBillingIntervalInput(billingIntervalInput, form.billingType);
                            setForm((prev) => ({ ...prev, billingInterval: n }));
                            setBillingIntervalInput(String(n));
                          }}
                          aria-describedby="add-product-billing-interval-hint"
                          spellCheck={false}
                          autoComplete="off"
                          {...bindFormulaField('billingInterval')}
                        />
                        <span id="add-product-billing-interval-hint" className="add-product-modal-billing-interval-unit">
                          {billingIntervalUnitLabel(form.billingType)}
                        </span>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </section>

            {customDefinitions.length > 0 ? (
              <section className="add-product-modal-section add-product-modal-section--custom">
                <div className="add-product-modal-section-head">
                  <span className="add-product-modal-section-accent add-product-modal-section-accent--custom" aria-hidden />
                  <h3 className="add-product-modal-section-title add-product-modal-section-title--custom">추가된 필드</h3>
                </div>
                <div className="add-product-modal-grid add-product-modal-grid--custom">
                  <CustomFieldsSection
                    definitions={customDefinitions}
                    values={form.customFields || {}}
                    formulaContext={customFieldFormulaContext}
                    hideTitle
                    onChangeValues={(key, value) => setForm((prev) => ({
                      ...prev,
                      customFields: { ...(prev.customFields || {}), [key]: value }
                    }))}
                    fieldClassName="add-product-modal-field add-product-modal-field--custom"
                  />
                </div>
              </section>
            ) : null}
            </div>
            <CustomFieldsFormulaPickerPanel
              className="add-product-modal-formula-picker-panel"
              formulaFieldOptions={formulaFieldOptions}
              formulaCatalogGroups={formulaCatalogGroups}
              onInsertFieldLabel={insertFieldLabel}
              onInsertFunctionName={insertFunctionName}
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
              <button type="button" className="add-product-modal-cancel" onClick={handleFormDismiss}>취소</button>
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
          onDefinitionsUpdated={fetchCustomDefinitions}
          apiBase={API_BASE}
          getAuthHeader={getAuthHeader}
        />
      )}
    </div>
  );
}
