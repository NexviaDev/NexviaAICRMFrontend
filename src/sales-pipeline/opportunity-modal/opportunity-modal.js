import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import CustomerCompanySearchModal from '../../customer-companies/customer-company-search-modal/customer-company-search-modal';
import CustomerCompanyEmployeesSearchModal from '../../customer-company-employees/customer-company-employees-search-modal/customer-company-employees-search-modal';
import ProductSearchModal from '../product-search-modal/product-search-modal';
import '../../customer-companies/customer-company-detail-modal/customer-company-detail-modal.css';
import './opportunity-modal.css';

import { API_BASE } from '@/config';
import { suggestedPriceFromProduct, OPPORTUNITY_PRICE_BASIS_OPTIONS } from '@/lib/product-price-utils';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const STAGE_OPTIONS = [
  { value: 'NewLead', label: '신규 리드' },
  { value: 'Contacted', label: '연락 완료' },
  { value: 'ProposalSent', label: '제안서 발송' },
  { value: 'Negotiation', label: '최종 협상' },
  { value: 'Won', label: '수주 성공' },
  { value: 'Lost', label: '기회 상실' },
  { value: 'Abandoned', label: '보류' }
];

const CURRENCY_OPTIONS = [
  { value: 'KRW', label: 'KRW' },
  { value: 'USD', label: 'USD' },
  { value: 'JPY', label: 'JPY' }
];

const PRODUCT_BILLING_LABELS = { Monthly: '월간', Annual: '연간', Perpetual: '영구' };


function formatNumberInput(val) {
  const num = String(val).replace(/[^0-9]/g, '');
  if (!num) return '';
  return Number(num).toLocaleString();
}

function parseNumber(val) {
  return Number(String(val).replace(/[^0-9]/g, '')) || 0;
}

function getCurrentUserId() {
  try {
    const raw = localStorage.getItem('crm_user');
    const u = raw ? JSON.parse(raw) : null;
    return u?._id || u?.id || null;
  } catch {
    return null;
  }
}

function formatCommentDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '';
  }
}

function isCommentAuthor(comment, userId) {
  if (userId == null || !comment?.userId) return false;
  return String(comment.userId) === String(userId);
}

function sanitizeFolderNamePart(s) {
  return String(s ?? '')
    .replace(/[/\\*?:<>"|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}

function getDriveFolderIdFromLink(url) {
  if (!url || typeof url !== 'string') return null;
  const s = url.trim();
  const m = s.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

function fileToBase64(file) {
  return file.arrayBuffer().then((buf) => {
    const bytes = new Uint8Array(buf);
    let binary = '';
    const chunk = 8192;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  });
}

/** 평면 코멘트 배열 → 루트 목록 + 부모 id → 자식 배열 맵 */
function organizeComments(comments) {
  const list = Array.isArray(comments) ? [...comments] : [];
  const byId = new Map();
  list.forEach((c) => {
    const id = c?._id != null ? String(c._id) : c?.id != null ? String(c.id) : '';
    if (id) byId.set(id, c);
  });
  const sortByDate = (a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
  const childrenMap = new Map();
  const roots = [];
  list.forEach((c) => {
    const id = c?._id != null ? String(c._id) : c?.id != null ? String(c.id) : '';
    if (!id) return;
    const pid = c.parentCommentId != null ? String(c.parentCommentId) : '';
    if (!pid || !byId.has(pid)) {
      roots.push(c);
    } else {
      if (!childrenMap.has(pid)) childrenMap.set(pid, []);
      childrenMap.get(pid).push(c);
    }
  });
  roots.sort(sortByDate);
  childrenMap.forEach((arr) => arr.sort(sortByDate));
  return { roots, childrenMap };
}

export default function OpportunityModal({
  mode, oppId, defaultStage, stageOptions, onClose, onSaved,
  initialCustomerCompany = null, initialContact = null
}) {
  const isEdit = mode === 'edit';
  const stageSelectOptions = Array.isArray(stageOptions) && stageOptions.length > 0 ? stageOptions : STAGE_OPTIONS;
  const firstStageValue = stageSelectOptions[0]?.value || 'NewLead';
  const [form, setForm] = useState({
    customerCompanyId: '',
    customerCompanyName: '',
    contactName: '',
    productId: '',
    productName: '',
    unitPrice: '',
    priceBasis: 'consumer',
    quantity: '1',
    discountRate: '',
    discountAmount: '',
    currency: 'KRW',
    stage: defaultStage || 'NewLead',
    description: ''
  });
  const [businessNumber, setBusinessNumber] = useState(
    String(initialCustomerCompany?.businessNumber ?? initialContact?.customerCompanyBusinessNumber ?? '')
  );
  const [driveFolderLink, setDriveFolderLink] = useState('');
  const [driveFolderId, setDriveFolderId] = useState(null);
  const [driveUploading, setDriveUploading] = useState(false);
  const [docsDropActive, setDocsDropActive] = useState(false);
  const [documentRefs, setDocumentRefs] = useState([]);
  const [driveError, setDriveError] = useState('');
  const [driveEmbedRevision, setDriveEmbedRevision] = useState(0);
  const fileInputRef = useRef(null);
  const lastEnsuredFolderKeyRef = useRef('');
  const [showCompanySearchModal, setShowCompanySearchModal] = useState(false);
  const [showContactSearchModal, setShowContactSearchModal] = useState(false);
  const [showProductSearchModal, setShowProductSearchModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingOpp, setLoadingOpp] = useState(false);
  const [error, setError] = useState('');
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [showProductFields, setShowProductFields] = useState(false);
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [commentBusy, setCommentBusy] = useState(false);
  const [commentError, setCommentError] = useState('');
  const [editingCommentId, setEditingCommentId] = useState(null);
  const [editDraft, setEditDraft] = useState('');
  const [replyingToId, setReplyingToId] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [renewalCalBusy, setRenewalCalBusy] = useState(false);
  /** 서버에서 불러온 직후 단계 — 저장 시 Won→다른 단계면 갱신 캘린더 삭제 반영용 */
  const stageAtLoadRef = useRef(null);

  const currentUserId = useMemo(() => getCurrentUserId(), []);

  const fetchOpp = useCallback(async () => {
    if (!isEdit || !oppId) return;
    setLoadingOpp(true);
    try {
      const res = await fetch(`${API_BASE}/sales-opportunities/${oppId}`, { headers: getAuthHeader() });
      if (!res.ok) throw new Error();
      const data = await res.json();
      const cc = data.customerCompanyId;
      const product = data.productId;
      const qty = data.quantity ?? 1;
      const unit = data.unitPrice ?? 0;
      const unitForDisplay = unit > 0 ? unit : (data.value && qty >= 1 ? Math.round(data.value / qty) : 0);
      const rate = data.discountRate ?? (data.discountType === 'rate' ? data.discountValue : 0);
      const amt = data.discountAmount ?? (data.discountType === 'amount' ? data.discountValue : 0);
      const loadedStage = data.stage || 'NewLead';
      stageAtLoadRef.current = loadedStage;
      setForm({
        customerCompanyId: cc?._id || cc || '',
        customerCompanyName: cc?.name || '',
        contactName: data.contactName || '',
        productId: product?._id || product || '',
        productName: product?.name || '',
        unitPrice: unitForDisplay > 0 ? unitForDisplay.toLocaleString() : '',
        priceBasis: data.unitPriceBasis === 'channel' ? 'channel' : 'consumer',
        quantity: String(qty),
        discountRate: rate > 0 ? String(rate) : '',
        discountAmount: amt > 0 ? amt.toLocaleString() : '',
        currency: data.currency || 'KRW',
        stage: loadedStage,
        description: data.description || ''
      });
      setBusinessNumber(String(cc?.businessNumber ?? ''));
      setDriveFolderLink(String(data.driveFolderLink || ''));
      setDriveFolderId(getDriveFolderIdFromLink(String(data.driveFolderLink || '')));
      setDocumentRefs(Array.isArray(data.documentRefs)
        ? data.documentRefs.map((url) => (typeof url === 'string' ? { url, name: '파일' } : { url: url?.url, name: url?.name || '파일' })).filter((d) => d?.url)
        : []);
      setSelectedProduct(null);
      setShowProductFields(false);
      setComments(Array.isArray(data.comments) ? data.comments : []);
      setNewComment('');
      setCommentError('');
      setEditingCommentId(null);
      setEditDraft('');
      setReplyingToId(null);
      setReplyText('');
    } catch {
      setError('기회 정보를 불러올 수 없습니다.');
    } finally {
      setLoadingOpp(false);
    }
  }, [isEdit, oppId]);

  useEffect(() => {
    fetchOpp();
  }, [fetchOpp]);

  useEffect(() => {
    if (isEdit) return;
    if (initialCustomerCompany?._id || initialCustomerCompany?.name) {
      setForm((f) => ({
        ...f,
        customerCompanyId: initialCustomerCompany?._id || f.customerCompanyId,
        customerCompanyName: initialCustomerCompany?.name || f.customerCompanyName
      }));
      setBusinessNumber(String(initialCustomerCompany?.businessNumber ?? ''));
    } else if (initialContact?._id || initialContact?.name) {
      setForm((f) => ({
        ...f,
        contactName: initialContact?.name || f.contactName,
        customerCompanyId: initialContact?.customerCompanyId || f.customerCompanyId,
        customerCompanyName: initialContact?.customerCompanyName || f.customerCompanyName
      }));
      setBusinessNumber(String(initialContact?.customerCompanyBusinessNumber ?? ''));
    }
  }, [isEdit, initialCustomerCompany, initialContact]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (showProductSearchModal) setShowProductSearchModal(false);
      else if (showContactSearchModal) setShowContactSearchModal(false);
      else if (showCompanySearchModal) setShowCompanySearchModal(false);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, showCompanySearchModal, showContactSearchModal, showProductSearchModal]);

  /** 단계 미선택(또는 현재 단계가 옵션에 없음)인 경우 첫 번째 단계를 자동 선택 */
  useEffect(() => {
    const available = stageSelectOptions.map((s) => s.value);
    setForm((prev) => {
      if (prev.stage && available.includes(prev.stage)) return prev;
      return { ...prev, stage: firstStageValue };
    });
  }, [stageSelectOptions, firstStageValue]);

  const handleChange = (key, val) => {
    setForm((f) => ({ ...f, [key]: val }));
    setError('');
  };

  const driveFolderName = useMemo(() => {
    const namePart = sanitizeFolderNamePart(form.customerCompanyName || '미소속');
    const numPart = sanitizeFolderNamePart(String(businessNumber || '').replace(/\D/g, '')) || '미등록';
    return `${namePart}_${numPart}`;
  }, [form.customerCompanyName, businessNumber]);

  const productFolderName = useMemo(() => {
    const name = sanitizeFolderNamePart(form.productName || '');
    return name || '';
  }, [form.productName]);

  const ensureTargetDriveFolder = useCallback(async () => {
    if (!form.customerCompanyName?.trim()) {
      return { ok: false, error: '고객사를 먼저 선택해 주세요.' };
    }
    const r1 = await fetch(`${API_BASE}/drive/folders/ensure`, {
      method: 'POST',
      headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ folderName: driveFolderName })
    });
    const data1 = await r1.json().catch(() => ({}));
    if (!r1.ok) return { ok: false, error: data1.error || '폴더를 준비할 수 없습니다.' };
    const companyId = data1.id;
    let targetId = companyId;
    let targetLink = data1.webViewLink || `https://drive.google.com/drive/folders/${companyId}`;
    if (productFolderName) {
      const r2 = await fetch(`${API_BASE}/drive/folders/ensure`, {
        method: 'POST',
        headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ folderName: productFolderName, parentFolderId: companyId })
      });
      const data2 = await r2.json().catch(() => ({}));
      if (!r2.ok) return { ok: false, error: data2.error || '제품 폴더를 준비할 수 없습니다.' };
      targetId = data2.id;
      targetLink = data2.webViewLink || `https://drive.google.com/drive/folders/${data2.id}`;
    }
    return { ok: true, id: targetId, webViewLink: targetLink };
  }, [form.customerCompanyName, driveFolderName, productFolderName]);

  useEffect(() => {
    if (!form.customerCompanyName?.trim()) return;
    const key = `${driveFolderName}|${productFolderName}`;
    if (lastEnsuredFolderKeyRef.current === key) return;
    let cancelled = false;
    (async () => {
      const result = await ensureTargetDriveFolder();
      if (cancelled || !result.ok) return;
      lastEnsuredFolderKeyRef.current = key;
      setDriveFolderId(result.id);
      setDriveFolderLink(result.webViewLink);
      setDriveError('');
    })();
    return () => { cancelled = true; };
  }, [form.customerCompanyName, driveFolderName, productFolderName, ensureTargetDriveFolder]);

  const addDocumentRef = useCallback((url, name) => {
    const link = (url || '').trim();
    if (!link) return;
    setDocumentRefs((prev) => (prev.some((r) => (typeof r === 'string' ? r : r?.url) === link) ? prev : [...prev, { url: link, name: name || '파일' }]));
  }, []);

  const handleDirectFileUpload = useCallback(async (files) => {
    const filesArray = Array.from(files || []);
    if (!filesArray.length) return;
    setDriveUploading(true);
    setDriveError('');
    try {
      const result = await ensureTargetDriveFolder();
      if (!result.ok) {
        setDriveError(result.error);
        return;
      }
      setDriveFolderId(result.id);
      setDriveFolderLink(result.webViewLink);
      let uploadedOkCount = 0;
      for (const file of filesArray) {
        try {
          const contentBase64 = await fileToBase64(file);
          if (!contentBase64) {
            setDriveError(`"${file.name}" 변환 실패`);
            continue;
          }
          const up = await fetch(`${API_BASE}/drive/upload`, {
            method: 'POST',
            headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              name: file.name,
              mimeType: file.type || 'application/octet-stream',
              contentBase64,
              parentFolderId: result.id
            })
          });
          const upData = await up.json().catch(() => ({}));
          if (up.ok && upData.webViewLink) {
            addDocumentRef(upData.webViewLink, upData.name || file.name);
            uploadedOkCount += 1;
          } else setDriveError(upData.error || upData.details || '업로드 실패');
        } catch (err) {
          setDriveError(err?.message || '업로드 중 오류가 났습니다.');
        }
      }
      if (uploadedOkCount > 0) setDriveEmbedRevision((n) => n + 1);
    } catch (err) {
      setDriveError(err?.message || 'Drive에 연결할 수 없습니다.');
    } finally {
      setDriveUploading(false);
    }
  }, [ensureTargetDriveFolder, addDocumentRef]);

  const canDocsUpload = Boolean(form.customerCompanyName?.trim()) && !driveUploading;

  const handleDocsDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (canDocsUpload) setDocsDropActive(true);
  }, [canDocsUpload]);

  const handleDocsDragEnter = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (canDocsUpload) setDocsDropActive(true);
  }, [canDocsUpload]);

  const handleDocsDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    const rel = e.relatedTarget;
    if (rel && e.currentTarget.contains(rel)) return;
    setDocsDropActive(false);
  }, []);

  const handleDocsDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDocsDropActive(false);
    if (canDocsUpload && e.dataTransfer?.files?.length) handleDirectFileUpload(e.dataTransfer.files);
  }, [canDocsUpload, handleDirectFileUpload]);

  const handleUnitPriceChange = (e) => {
    handleChange('unitPrice', formatNumberInput(e.target.value));
  };
  const handleDiscountRateChange = (e) => {
    const v = e.target.value.replace(/[^0-9.]/g, '');
    handleChange('discountRate', v);
  };
  const handleDiscountAmountChange = (e) => {
    handleChange('discountAmount', formatNumberInput(e.target.value));
  };

  const computeFinalAmount = () => {
    const qty = Math.max(0, Number(form.quantity) || 1);
    const unit = parseNumber(form.unitPrice) || 0;
    let subtotal = qty * unit;
    const dRate = Math.max(0, Math.min(100, Number(form.discountRate) || 0));
    const dAmount = parseNumber(form.discountAmount) || 0;
    if (dRate > 0) subtotal = subtotal * (1 - dRate / 100);
    subtotal = Math.max(0, subtotal - dAmount);
    return Math.round(subtotal);
  };

  const formatCurrencyDisplay = (num, currency) => {
    if (currency === 'USD') return '$' + num.toLocaleString();
    if (currency === 'JPY') return '¥' + num.toLocaleString();
    return num.toLocaleString() + ' KRW';
  };

  const computeDeduction = () => {
    const qty = Math.max(0, Number(form.quantity) || 1);
    const unit = parseNumber(form.unitPrice) || 0;
    const subtotal = qty * unit;
    const finalAmt = computeFinalAmount();
    return Math.max(0, subtotal - finalAmt);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const titleToUse = form.productName?.trim() || form.customerCompanyName?.trim() || '';
    if (!titleToUse) {
      setError('고객사 또는 제품을 선택해 주세요.');
      return;
    }
    setSaving(true);
    setError('');
    const selectedStage = stageSelectOptions.some((s) => s.value === form.stage) ? form.stage : firstStageValue;
    try {
      const body = {
        title: titleToUse,
        customerCompanyId: form.customerCompanyId || null,
        contactName: form.contactName.trim(),
        productId: form.productId || null,
        productName: form.productName?.trim() || '',
        unitPrice: parseNumber(form.unitPrice),
        unitPriceBasis: form.priceBasis === 'channel' ? 'channel' : 'consumer',
        quantity: Math.max(0, Number(form.quantity) || 1),
        discountRate: Math.max(0, Math.min(100, Number(form.discountRate) || 0)),
        discountAmount: parseNumber(form.discountAmount) || 0,
        currency: form.currency,
        stage: selectedStage,
        description: form.description.trim(),
        documentRefs: documentRefs.filter((d) => d?.url),
        driveFolderLink: (driveFolderLink || '').trim() || undefined
      };
      const url = isEdit
        ? `${API_BASE}/sales-opportunities/${oppId}`
        : `${API_BASE}/sales-opportunities`;
      const method = isEdit ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify(body)
      });
      const savedPayload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(savedPayload.error || '저장 실패');
      }
      if (savedPayload.renewalCalendar?.followUpOpportunityId) {
        try {
          window.dispatchEvent(new CustomEvent('nexvia-crm-pipeline-refresh'));
        } catch {
          /* ignore */
        }
      }
      if (isEdit && stageAtLoadRef.current === 'Won' && selectedStage !== 'Won') {
        try {
          window.dispatchEvent(new CustomEvent('nexvia-crm-calendar-refresh'));
        } catch {
          /* ignore */
        }
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message || '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!isEdit || !oppId) return;
    if (!window.confirm('이 기회를 삭제하시겠습니까?')) return;
    try {
      await fetch(`${API_BASE}/sales-opportunities/${oppId}`, { method: 'DELETE', headers: getAuthHeader() });
      try {
        window.dispatchEvent(new CustomEvent('nexvia-crm-calendar-refresh'));
      } catch {
        /* ignore */
      }
      onSaved();
      onClose();
    } catch { /* ignore */ }
  };

  const handleEnsureRenewalCalendar = useCallback(async () => {
    if (!isEdit || !oppId || form.stage !== 'Won' || !form.productId) return;
    setRenewalCalBusy(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/sales-opportunities/${oppId}/renewal-calendar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '갱신 일정을 처리할 수 없습니다.');
      const rc = data.renewalCalendar;
      if (rc?.scheduled && (rc.eventStart || rc.noticeEventStart || rc.preReminderEventStart)) {
        try {
          window.dispatchEvent(new CustomEvent('nexvia-crm-calendar-refresh'));
        } catch {
          /* ignore */
        }
        const fmt = (iso) =>
          new Date(iso).toLocaleString('ko-KR', { dateStyle: 'long', timeStyle: 'short' });
        let msg = (rc.alreadyHad ? '이미 등록된 일정이 있습니다.\n\n' : '') +
          '회사 캘린더에 일정이 등록되었습니다.\n\n';
        if (rc.noticeEventStart) msg += `· 수주 당일 안내: ${fmt(rc.noticeEventStart)}\n`;
        if (rc.preReminderEventStart) {
          msg += `· 사전 알림(월간=갱신 2주 전 / 연간=갱신 1개월 전): ${fmt(rc.preReminderEventStart)}\n`;
        }
        if (rc.eventStart) msg += `· 실제 갱신(1개월/1년 후): ${fmt(rc.eventStart)}\n`;
        msg += '\n«회사 일정» 탭에서 확인하세요.';
        window.alert(msg);
      } else if (rc?.skipReason === 'not_subscription') {
        window.alert(
          '제품 결제 주기가 월간/연간이 아니면 갱신 일정이 만들어지지 않습니다. 제품 목록에서 해당 제품의 결제 주기를 확인하세요.'
        );
      } else if (rc?.skipReason === 'no_product_id') {
        window.alert('제품이 연결되어 있지 않습니다.');
      } else if (rc?.skipReason === 'product_not_found') {
        window.alert('제품 정보를 찾을 수 없습니다.');
      } else {
        window.alert(rc?.skipReason ? `일정을 만들 수 없습니다: ${rc.skipReason}` : '일정을 만들 수 없습니다.');
      }
    } catch (e) {
      setError(e.message || '갱신 일정 처리에 실패했습니다.');
    } finally {
      setRenewalCalBusy(false);
    }
  }, [isEdit, oppId, form.stage, form.productId]);

  const { roots, childrenMap } = useMemo(() => organizeComments(comments), [comments]);
  const commentById = useMemo(() => {
    const m = new Map();
    (Array.isArray(comments) ? comments : []).forEach((c) => {
      const cid = c?._id != null ? String(c._id) : c?.id != null ? String(c.id) : '';
      if (cid) m.set(cid, c);
    });
    return m;
  }, [comments]);

  const handleAddComment = async (parentCommentId = null) => {
    const text = (parentCommentId ? replyText : newComment).trim();
    if (!text || !oppId) return;
    setCommentBusy(true);
    setCommentError('');
    try {
      const res = await fetch(`${API_BASE}/sales-opportunities/${oppId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({
          text,
          ...(parentCommentId ? { parentCommentId } : {})
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '코멘트를 등록할 수 없습니다.');
      setComments(Array.isArray(data.comments) ? data.comments : []);
      if (parentCommentId) {
        setReplyText('');
        setReplyingToId(null);
      } else {
        setNewComment('');
      }
    } catch (err) {
      setCommentError(err.message || '코멘트 등록에 실패했습니다.');
    } finally {
      setCommentBusy(false);
    }
  };

  const handleSaveEditComment = async (commentId) => {
    const text = editDraft.trim();
    if (!text || !oppId || !commentId) return;
    setCommentBusy(true);
    setCommentError('');
    try {
      const res = await fetch(`${API_BASE}/sales-opportunities/${oppId}/comments/${commentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ text })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '코멘트를 수정할 수 없습니다.');
      setComments(Array.isArray(data.comments) ? data.comments : []);
      setEditingCommentId(null);
      setEditDraft('');
    } catch (err) {
      setCommentError(err.message || '코멘트 수정에 실패했습니다.');
    } finally {
      setCommentBusy(false);
    }
  };

  const handleDeleteComment = async (commentId) => {
    if (!oppId || !commentId) return;
    if (!window.confirm('이 코멘트를 삭제하시겠습니까?')) return;
    setCommentBusy(true);
    setCommentError('');
    try {
      const res = await fetch(`${API_BASE}/sales-opportunities/${oppId}/comments/${commentId}`, {
        method: 'DELETE',
        headers: getAuthHeader()
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '코멘트를 삭제할 수 없습니다.');
      setComments(Array.isArray(data.comments) ? data.comments : []);
      if (editingCommentId === commentId) {
        setEditingCommentId(null);
        setEditDraft('');
      }
      if (replyingToId === commentId) {
        setReplyingToId(null);
        setReplyText('');
      }
    } catch (err) {
      setCommentError(err.message || '코멘트 삭제에 실패했습니다.');
    } finally {
      setCommentBusy(false);
    }
  };

  function renderCommentItem(c) {
    const id = String(c._id || c.id);
    const mine = isCommentAuthor(c, currentUserId);
    const isEditing = editingCommentId === id;
    const replies = childrenMap.get(id) || [];
    const parentId = c.parentCommentId != null ? String(c.parentCommentId) : null;
    const parentComment = parentId ? commentById.get(parentId) : null;

    return (
      <li key={id} className="opp-comment-item">
        {parentComment ? (
          <p className="opp-comment-reply-hint">
            <span className="material-symbols-outlined" aria-hidden>subdirectory_arrow_right</span>
            {parentComment.authorName || '사용자'}님에게 답글
          </p>
        ) : null}
        <div className="opp-comment-meta">
          <span className="opp-comment-author">{c.authorName || '사용자'}</span>
          <span className="opp-comment-date">
            {formatCommentDate(c.createdAt)}
            {c.updatedAt && c.createdAt && new Date(c.updatedAt) > new Date(c.createdAt) ? ' · 수정됨' : ''}
          </span>
          {!isEditing ? (
            <span className="opp-comment-actions">
              <button
                type="button"
                className="opp-comment-action-btn"
                disabled={commentBusy}
                onClick={() => {
                  if (replyingToId === id) {
                    setReplyingToId(null);
                    setReplyText('');
                  } else {
                    setReplyingToId(id);
                    setReplyText('');
                    setEditingCommentId(null);
                    setEditDraft('');
                  }
                }}
              >
                답글
              </button>
              {mine ? (
                <>
                  <button
                    type="button"
                    className="opp-comment-action-btn"
                    disabled={commentBusy}
                    onClick={() => {
                      setEditingCommentId(id);
                      setEditDraft(c.text || '');
                      setReplyingToId(null);
                      setReplyText('');
                    }}
                  >
                    수정
                  </button>
                  <button
                    type="button"
                    className="opp-comment-action-btn opp-comment-action-btn--danger"
                    disabled={commentBusy}
                    onClick={() => handleDeleteComment(id)}
                  >
                    삭제
                  </button>
                </>
              ) : null}
            </span>
          ) : null}
        </div>
        {isEditing ? (
          <div className="opp-comment-edit">
            <textarea
              className="opp-textarea opp-comment-edit-input"
              value={editDraft}
              onChange={(e) => setEditDraft(e.target.value)}
              rows={3}
              maxLength={5000}
            />
            <div className="opp-comment-edit-btns">
              <button type="button" className="opp-comment-cancel-btn" disabled={commentBusy} onClick={() => { setEditingCommentId(null); setEditDraft(''); }}>
                취소
              </button>
              <button type="button" className="opp-comment-save-btn" disabled={commentBusy || !editDraft.trim()} onClick={() => handleSaveEditComment(id)}>
                {commentBusy ? '저장 중…' : '저장'}
              </button>
            </div>
          </div>
        ) : (
          <p className="opp-comment-text">{c.text}</p>
        )}
        {replyingToId === id && !isEditing ? (
          <div className="opp-comment-reply-compose">
            <textarea
              className="opp-textarea"
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder={`${c.authorName || '사용자'}님에게 답글 작성...`}
              rows={2}
              maxLength={5000}
              disabled={commentBusy}
            />
            <div className="opp-comment-reply-compose-row">
              <button type="button" className="opp-comment-cancel-btn" disabled={commentBusy} onClick={() => { setReplyingToId(null); setReplyText(''); }}>
                취소
              </button>
              <button
                type="button"
                className="opp-comment-add-btn"
                disabled={commentBusy || !replyText.trim()}
                onClick={() => handleAddComment(id)}
                aria-label="답글 등록"
                title="답글 등록"
              >
                <span className={'material-symbols-outlined' + (commentBusy ? ' opp-comment-add-btn-icon--spin' : '')} aria-hidden>
                  {commentBusy ? 'progress_activity' : 'send'}
                </span>
              </button>
            </div>
          </div>
        ) : null}
        {replies.length > 0 ? (
          <ul className="opp-comment-replies">
            {replies.map((r) => renderCommentItem(r))}
          </ul>
        ) : null}
      </li>
    );
  }

  return (
    <div className="opp-modal-overlay">
      <div className="opp-modal" onClick={(e) => e.stopPropagation()}>
        <div className="opp-modal-header">
          <h3 className="opp-modal-title">{isEdit ? '기회 수정' : '새 영업 기회 추가'}</h3>
          <button className="opp-modal-close" onClick={onClose}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {loadingOpp ? (
          <div className="opp-modal-loading">로딩 중...</div>
        ) : (
          <>
            <form className="opp-modal-form" onSubmit={handleSubmit} id="opp-form">
              {/* 고객사 / 담당자 2열 */}
              <div className="opp-form-grid-2">
                <div className="opp-label">
                  <span>고객사</span>
                  <div className="opp-company-wrap">
                    <span className="opp-company-display">{form.customerCompanyName || '고객사 선택'}</span>
                    <button type="button" className="opp-company-search-btn" onClick={() => setShowCompanySearchModal(true)}>
                      <span className="material-symbols-outlined">search</span>
                      검색
                    </button>
                  </div>
                </div>
                <div className="opp-label">
                  <span>담당자</span>
                  <div className="opp-company-wrap">
                    <span className="opp-company-display">{form.contactName || '담당자 선택'}</span>
                    <button type="button" className="opp-company-search-btn" onClick={() => setShowContactSearchModal(true)}>
                      <span className="material-symbols-outlined">search</span>
                      검색
                    </button>
                  </div>
                </div>
              </div>

              {/* 제품 - pills + 제품 추가 */}
              <div className="opp-label">
                <span>제품</span>
                <div className="opp-product-pills">
                  {form.productName ? (
                    <span className="opp-product-pill">
                      {form.productName}
                      <button type="button" onClick={() => { setForm((f) => ({ ...f, productId: '', productName: '', unitPrice: '', currency: 'KRW', priceBasis: f.priceBasis || 'consumer' })); setSelectedProduct(null); setShowProductFields(false); }} aria-label="제거">
                        <span className="material-symbols-outlined">close</span>
                      </button>
                    </span>
                  ) : null}
                  <button type="button" className="opp-product-add-btn" onClick={() => setShowProductSearchModal(true)}>
                    <span className="material-symbols-outlined">add</span>
                    제품 추가
                  </button>
                </div>
              </div>

              {/* 제품 관련 필드 표시 (제품 선택 시) */}
              {selectedProduct && (
                <>
                  <label className="opp-label opp-checkbox-wrap">
                    <input type="checkbox" checked={showProductFields} onChange={(e) => setShowProductFields(e.target.checked)} />
                    <span>제품 관련 필드 표시</span>
                  </label>
                  {showProductFields && (
                    <div className="opp-product-fields">
                      <div className="opp-product-fields-title">선택 제품 정보</div>
                      <dl className="opp-product-fields-list">
                        {selectedProduct.code != null && selectedProduct.code !== '' && <><dt>코드</dt><dd>{selectedProduct.code}</dd></>}
                        {selectedProduct.category != null && selectedProduct.category !== '' && <><dt>카테고리</dt><dd>{selectedProduct.category}</dd></>}
                        {selectedProduct.version != null && selectedProduct.version !== '' && <><dt>버전</dt><dd>{selectedProduct.version}</dd></>}
                        {selectedProduct.billingType != null && selectedProduct.billingType !== '' && <><dt>결제 유형</dt><dd>{PRODUCT_BILLING_LABELS[selectedProduct.billingType] ?? selectedProduct.billingType}</dd></>}
                        {selectedProduct.status != null && selectedProduct.status !== '' && <><dt>상태</dt><dd>{selectedProduct.status}</dd></>}
                        {selectedProduct.customFields && typeof selectedProduct.customFields === 'object' && Object.entries(selectedProduct.customFields).filter(([, v]) => v != null && v !== '').map(([k, v]) => (
                          <React.Fragment key={k}><dt>{k}</dt><dd>{String(v)}</dd></React.Fragment>
                        ))}
                      </dl>
                    </div>
                  )}
                </>
              )}

              {/* 단계 - 버튼 그룹 */}
              <div className="opp-label">
                <span>단계</span>
                <div className="opp-stage-group">
                  {stageSelectOptions.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      className={'opp-stage-btn' + (form.stage === s.value ? ' opp-stage-btn--selected' : '')}
                      onClick={() => handleChange('stage', s.value)}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
              {isEdit && form.stage === 'Won' && form.productId ? (
                <div className="opp-renewal-cal-row">
                  <button
                    type="button"
                    className="opp-renewal-cal-btn"
                    disabled={renewalCalBusy}
                    onClick={handleEnsureRenewalCalendar}
                  >
                    {renewalCalBusy ? '처리 중…' : '갱신 캘린더 일정 등록·확인'}
                  </button>
                  <p className="opp-renewal-cal-hint">
                    월간·연간 제품만 해당합니다. 수주 당일 안내 일정(이번 달에 표시)과 실제 갱신 일정(1개월 또는 1년 뒤) 두 가지가 «회사 일정»에 등록됩니다. «개인 일정» 탭에는 표시되지 않습니다.
                  </p>
                </div>
              ) : null}

              {/* 가격 기준(제품 목록: 소비자 마진 / 유통 마진 축) */}
              <div className="opp-label">
                <span>가격 기준</span>
                <p className="opp-price-basis-hint">제품 목록의 소비자 마진·유통 마진과 같은 가격 축을 선택합니다. 제품 선택 시 아래 가격이 자동 채워집니다.</p>
                <div className="opp-price-basis-group" role="group" aria-label="가격 기준">
                  {OPPORTUNITY_PRICE_BASIS_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className={'opp-price-basis-btn' + (form.priceBasis === opt.value ? ' opp-price-basis-btn--selected' : '')}
                      onClick={() => {
                        const basis = opt.value;
                        setForm((f) => {
                          const next = { ...f, priceBasis: basis };
                          if (selectedProduct) {
                            const p = suggestedPriceFromProduct(selectedProduct, basis);
                            next.unitPrice = p > 0 ? p.toLocaleString() : '';
                          }
                          return next;
                        });
                        setError('');
                      }}
                      title={opt.desc}
                    >
                      <span className="opp-price-basis-btn-label">{opt.label}</span>
                      <span className="opp-price-basis-btn-sub">{opt.shortLabel}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* 가격 및 통화 / 수량 / 할인율 / 차감금액 */}
              <div className="opp-financial-grid">
                <div className="opp-label">
                  <span>가격 및 통화</span>
                  <div className="opp-unit-currency-wrap">
                    <input
                      type="text"
                      className="opp-input"
                      value={form.unitPrice}
                      onChange={handleUnitPriceChange}
                      placeholder="0"
                      inputMode="numeric"
                    />
                    <select className="opp-select" value={form.currency} onChange={(e) => handleChange('currency', e.target.value)}>
                      {CURRENCY_OPTIONS.map((c) => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <label className="opp-label">
                  <span>수량</span>
                  <input type="number" className="opp-input" min={1} value={form.quantity} onChange={(e) => handleChange('quantity', e.target.value)} placeholder="1" />
                </label>
                <label className="opp-label">
                  <span>할인율 (%)</span>
                  <input type="text" className="opp-input" value={form.discountRate} onChange={handleDiscountRateChange} placeholder="0" inputMode="decimal" />
                </label>
                <label className="opp-label opp-label--span2">
                  <span>차감금액</span>
                  <input type="text" className="opp-input" value={form.discountAmount} onChange={handleDiscountAmountChange} placeholder="0" inputMode="numeric" />
                </label>
              </div>

              {/* 계산 요약: 차감 금액 / 최종 금액 */}
              <div className="opp-summary-box">
                <div className="opp-summary-item">
                  <span className="opp-summary-label">차감 금액</span>
                  <span className="opp-summary-value">- {formatCurrencyDisplay(computeDeduction(), form.currency)}</span>
                </div>
                <div className="opp-summary-item opp-summary-item--end">
                  <span className="opp-summary-label">최종 금액</span>
                  <span className="opp-summary-value">{formatCurrencyDisplay(computeFinalAmount(), form.currency)}</span>
                </div>
              </div>

              {/* 설명 */}
              <label className="opp-label">
                <span>설명</span>
                <textarea
                  className="opp-textarea"
                  value={form.description}
                  onChange={(e) => handleChange('description', e.target.value)}
                  placeholder="거래에 대한 추가 상세 내용을 입력하세요."
                  rows={3}
                />
              </label>

              {/* 증서 · 자료 (Google Drive) — customer-company-detail-modal register-sale-docs 와 동일 UI */}
              <section className="customer-company-detail-section register-sale-docs opp-modal-register-sale-docs">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  style={{ display: 'none' }}
                  onChange={(e) => { handleDirectFileUpload(e.target.files); e.target.value = ''; }}
                  disabled={driveUploading || !form.customerCompanyName?.trim()}
                  aria-hidden="true"
                />
                <div className="customer-company-detail-section-head">
                  <h3 className="customer-company-detail-section-title">
                    <span className="material-symbols-outlined">folder</span>
                    증서 · 자료
                  </h3>
                  <button
                    type="button"
                    className="customer-company-detail-btn-all"
                    onClick={() => { if (form.customerCompanyName?.trim() && !driveUploading && fileInputRef.current) fileInputRef.current.click(); }}
                    disabled={driveUploading || !form.customerCompanyName?.trim()}
                    title={!form.customerCompanyName?.trim() ? '고객사 선택 후 업로드 가능' : '파일 추가'}
                    aria-label="파일 추가"
                  >
                    <span className="material-symbols-outlined">add</span>
                  </button>
                </div>
                <p className="opp-modal-docs-folder-hint">
                  폴더: {driveFolderName}{productFolderName ? ` / ${productFolderName}` : ''}
                </p>
                {driveFolderLink && getDriveFolderIdFromLink(driveFolderLink) ? (
                  <div
                    className={`register-sale-docs-embed-wrap register-sale-docs-drag-in-modal ${docsDropActive && canDocsUpload ? 'register-sale-docs-dropzone-active' : ''} ${driveUploading || !canDocsUpload ? 'register-sale-docs-dropzone-disabled' : ''}`}
                    onDragEnter={handleDocsDragEnter}
                    onDragOver={handleDocsDragOver}
                    onDragLeave={handleDocsDragLeave}
                    onDrop={handleDocsDrop}
                    aria-label="Drive 폴더 (드래그하여 파일 추가)"
                  >
                    <iframe
                      key={`${getDriveFolderIdFromLink(driveFolderLink)}-${driveEmbedRevision}`}
                      title="Google Drive 폴더 현황"
                      src={`https://drive.google.com/embeddedfolderview?id=${getDriveFolderIdFromLink(driveFolderLink)}#list`}
                      className="register-sale-docs-embed"
                    />
                    {!form.customerCompanyName?.trim() ? (
                      <div className="register-sale-docs-embed-overlay opp-modal-docs-embed-overlay--blocking">고객사 선택 후 파일 등록 가능</div>
                    ) : driveUploading ? (
                      <div className="register-sale-docs-embed-overlay opp-modal-docs-embed-overlay--blocking">업로드 중…</div>
                    ) : docsDropActive && canDocsUpload ? (
                      <div className="register-sale-docs-embed-overlay">여기에 놓기</div>
                    ) : null}
                  </div>
                ) : (
                  <div
                    className={`register-sale-docs-dropzone ${docsDropActive && canDocsUpload ? 'register-sale-docs-dropzone-active' : ''} ${!canDocsUpload ? 'register-sale-docs-dropzone-disabled' : ''}`}
                    onDragEnter={handleDocsDragEnter}
                    onDragOver={handleDocsDragOver}
                    onDragLeave={handleDocsDragLeave}
                    onDrop={handleDocsDrop}
                    onClick={() => { if (canDocsUpload && fileInputRef.current) fileInputRef.current.click(); }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if ((e.key === 'Enter' || e.key === ' ') && canDocsUpload && fileInputRef.current) {
                        e.preventDefault();
                        fileInputRef.current.click();
                      }
                    }}
                    aria-label="파일 업로드 (드래그 앤 드롭 또는 클릭)"
                  >
                    <span className="material-symbols-outlined register-sale-docs-dropzone-icon">upload_file</span>
                    <span>
                      {!form.customerCompanyName?.trim()
                        ? '고객사 선택 후 업로드 가능'
                        : driveUploading
                          ? '업로드 중…'
                          : '파일을 여기에 놓거나 클릭하여 선택'}
                    </span>
                  </div>
                )}
                {driveError ? <p className="register-sale-docs-error">{driveError}</p> : null}
              </section>

              {isEdit && oppId ? (
                <div className="opp-comments-section">
                  <div className="opp-comments-heading">코멘트</div>
                  <p className="opp-comments-hint">기회에 대한 메모와 답글을 남깁니다. 본인이 작성한 코멘트만 수정·삭제할 수 있습니다.</p>
                  <ul className="opp-comments-list">
                    {roots.map((c) => renderCommentItem(c))}
                  </ul>
                  <div className="opp-comment-compose">
                    <div className="opp-comment-compose-wrap">
                      <textarea
                        className="opp-textarea opp-comment-compose-textarea"
                        value={newComment}
                        onChange={(e) => setNewComment(e.target.value)}
                        placeholder="코멘트를 입력하세요."
                        rows={2}
                        maxLength={5000}
                        disabled={commentBusy}
                      />
                      <button
                        type="button"
                        className="opp-comment-add-btn opp-comment-add-btn--inset"
                        disabled={commentBusy || !newComment.trim()}
                        onClick={() => handleAddComment()}
                        aria-label={commentBusy ? '등록 중' : '코멘트 등록'}
                        title={commentBusy ? '등록 중' : '코멘트 등록'}
                      >
                        <span className={'material-symbols-outlined' + (commentBusy ? ' opp-comment-add-btn-icon--spin' : '')} aria-hidden>
                          {commentBusy ? 'progress_activity' : 'send'}
                        </span>
                      </button>
                    </div>
                  </div>
                  {commentError ? <p className="opp-comment-error">{commentError}</p> : null}
                </div>
              ) : null}

              {error && <p className="opp-error">{error}</p>}
            </form>

            <div className="opp-modal-footer">
              {isEdit && (
                <button type="button" className="opp-delete-btn" onClick={handleDelete}>
                  <span className="material-symbols-outlined">delete</span>
                  삭제
                </button>
              )}
              <button type="button" className="opp-cancel-btn" onClick={onClose}>취소</button>
              <button type="submit" form="opp-form" className="opp-save-btn" disabled={saving}>
                {saving ? '저장 중...' : isEdit ? '수정' : '추가'}
              </button>
            </div>
          </>
        )}
        {showCompanySearchModal && (
          <CustomerCompanySearchModal
            onClose={() => setShowCompanySearchModal(false)}
            onSelect={(company) => {
              setForm((f) => ({ ...f, customerCompanyId: company._id, customerCompanyName: company.name || '' }));
              setBusinessNumber(String(company?.businessNumber ?? ''));
              setShowCompanySearchModal(false);
            }}
          />
        )}
        {showContactSearchModal && (
          <CustomerCompanyEmployeesSearchModal
            customerCompanyId={form.customerCompanyId || null}
            onClose={() => setShowContactSearchModal(false)}
            onSelect={(contact) => {
              setForm((f) => ({
                ...f,
                contactName: contact.name || '',
                ...(contact.customerCompanyId && {
                  customerCompanyId: contact.customerCompanyId._id || contact.customerCompanyId,
                  customerCompanyName: contact.customerCompanyId?.name || contact.company || ''
                })
              }));
              setBusinessNumber(String(contact?.customerCompanyId?.businessNumber ?? businessNumber ?? ''));
              setShowContactSearchModal(false);
            }}
          />
        )}
        {showProductSearchModal && (
          <ProductSearchModal
            onClose={() => setShowProductSearchModal(false)}
            onSelect={(products) => {
              const product = Array.isArray(products) ? products[0] : products;
              if (!product) return;
              setSelectedProduct(product);
              setShowProductFields(false);
              setForm((f) => {
                const basis = f.priceBasis === 'channel' ? 'channel' : 'consumer';
                const price = suggestedPriceFromProduct(product, basis);
                return {
                  ...f,
                  productId: product._id,
                  productName: product.name || '',
                  unitPrice: price > 0 ? price.toLocaleString() : '',
                  currency: product.currency || f.currency || 'KRW'
                };
              });
              setShowProductSearchModal(false);
            }}
          />
        )}
      </div>
    </div>
  );
}
