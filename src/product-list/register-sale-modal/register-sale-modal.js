import { useState, useEffect, useCallback, useRef } from 'react';
import CustomerCompanySearchModal from '../../customer-companies/customer-company-search-modal/customer-company-search-modal';
import CustomerCompanyEmployeesSearchModal from '../../customer-company-employees/customer-company-employees-search-modal/customer-company-employees-search-modal';
import ProductSearchModal from '../../sales-pipeline/product-search-modal/product-search-modal';
import './register-sale-modal.css';

import { API_BASE } from '@/config';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const CURRENCY_OPTIONS = [
  { value: 'KRW', label: '₩ KRW' },
  { value: 'USD', label: '$ USD' }
];

const DISCOUNT_OPTIONS = [
  { value: 'none', label: '할인 없음' },
  { value: 'rate', label: '할인율 (%)' },
  { value: 'amount', label: '할인가 (고정금액)' }
];

function parseNum(v) {
  return Number(String(v).replace(/[^0-9.-]/g, '')) || 0;
}

function formatNumInput(v) {
  const s = String(v).replace(/[^0-9]/g, '');
  if (!s) return '';
  return Number(s).toLocaleString();
}

/**
 * 판매 등록·수정 모달 (한 파일에서 관리)
 * - saleId: 있으면 수정 모드 (기존 데이터 로드 후 PATCH)
 * - initialCustomerCompany: 고객사 세부에서 열 때 → 고객사 자동, 고객명(선택)
 * - initialContact: 연락처 세부에서 열 때 → 고객명으로 표시, 해당 연락처로 저장
 * - 증서/자료: 구글 드라이브 [고객사]_[사업자번호] 폴더에 저장
 */
const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';

function sanitizeFolderNamePart(s) {
  return String(s ?? '')
    .replace(/[/\\*?:<>"|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 이메일 컴포즈와 동일: arrayBuffer → chunk + fromCharCode → btoa */
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

/** Google Drive 폴더 URL에서 폴더 ID 추출 (embeddedfolderview용) */
function getDriveFolderIdFromLink(url) {
  if (!url || typeof url !== 'string') return null;
  const s = url.trim();
  const m = s.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

export default function RegisterSaleModal({
  onClose,
  onSaved,
  saleId = null,
  initialCustomerCompany = null,
  initialContact = null,
  initialProduct = null
}) {
  const isEditMode = Boolean(saleId);
  const contactMode = Boolean(initialContact);
  const [loadingSale, setLoadingSale] = useState(!!saleId);
  const [productMode, setProductMode] = useState(initialProduct ? 'registered' : 'registered');
  const [productId, setProductId] = useState(initialProduct?._id || '');
  const [productName, setProductName] = useState(initialProduct?.name || '');
  const [unitPrice, setUnitPrice] = useState(initialProduct?.price != null ? String(initialProduct.price) : '');
  const [currency, setCurrency] = useState(initialProduct?.currency || 'KRW');
  const [quantity, setQuantity] = useState('1');
  const [discountType, setDiscountType] = useState('none');
  const [discountValue, setDiscountValue] = useState('');
  const [customerCompanyId, setCustomerCompanyId] = useState(
    contactMode ? (initialContact?.customerCompanyId || '') : (initialCustomerCompany?._id || '')
  );
  const [customerCompanyName, setCustomerCompanyName] = useState(
    contactMode ? (initialContact?.customerCompanyName || '') : (initialCustomerCompany?.name || '')
  );
  const [businessNumber, setBusinessNumber] = useState(
    contactMode ? (initialContact?.customerCompanyBusinessNumber ?? '') : (initialCustomerCompany?.businessNumber ?? '')
  );
  const [contactId, setContactId] = useState(contactMode ? (initialContact?._id || '') : '');
  const [contactName, setContactName] = useState(contactMode ? (initialContact?.name || '') : '');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [documentRefs, setDocumentRefs] = useState([]);
  const [showCompanySearch, setShowCompanySearch] = useState(false);
  const [showContactSearch, setShowContactSearch] = useState(false);
  const [showProductSearch, setShowProductSearch] = useState(false);
  const [showDrivePicker, setShowDrivePicker] = useState(false);
  const [drivePath, setDrivePath] = useState([]);
  const [driveFiles, setDriveFiles] = useState([]);
  const [driveFolderId, setDriveFolderId] = useState(null);
  const [driveFolderLink, setDriveFolderLink] = useState('');
  const [driveLoading, setDriveLoading] = useState(false);
  const [driveError, setDriveError] = useState('');
  const [driveUploading, setDriveUploading] = useState(false);
  const [docsDropActive, setDocsDropActive] = useState(false);
  const [dragInModal, setDragInModal] = useState(false);
  const modalContentRef = useRef(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmedCustomProductName, setConfirmedCustomProductName] = useState('');
  const fileInputRef = useRef(null);

  const qtyNum = Math.max(1, parseNum(quantity));
  const unitNum = Math.max(0, parseNum(unitPrice));
  const subtotal = qtyNum * unitNum;
  const dVal = Math.max(0, parseNum(discountValue));
  const discountAmount =
    discountType === 'rate' ? subtotal * (dVal / 100) : discountType === 'amount' ? dVal : 0;
  const finalValue = Math.max(0, Math.round(subtotal - discountAmount));

  useEffect(() => {
    if (initialProduct) {
      setProductId(initialProduct._id);
      setProductName(initialProduct.name || '');
      setUnitPrice(initialProduct.price != null ? String(initialProduct.price) : '');
      setCurrency(initialProduct.currency || 'KRW');
      setProductMode('registered');
    }
  }, [initialProduct]);

  useEffect(() => {
    if (initialCustomerCompany) {
      setCustomerCompanyId(initialCustomerCompany._id);
      setCustomerCompanyName(initialCustomerCompany.name || '');
      if (initialCustomerCompany.businessNumber !== undefined) setBusinessNumber(initialCustomerCompany.businessNumber ?? '');
    }
  }, [initialCustomerCompany]);

  useEffect(() => {
    if (initialContact) {
      setContactId(initialContact._id);
      setContactName(initialContact.name || '');
      if (initialContact.customerCompanyId) setCustomerCompanyId(initialContact.customerCompanyId);
      if (initialContact.customerCompanyName) setCustomerCompanyName(initialContact.customerCompanyName);
      if (initialContact.customerCompanyBusinessNumber !== undefined) setBusinessNumber(initialContact.customerCompanyBusinessNumber ?? '');
    }
  }, [initialContact]);

  /** 수정 모드: saleId로 기존 판매 기회 로드 후 폼에 반영 */
  useEffect(() => {
    if (!saleId) return;
    let cancelled = false;
    setLoadingSale(true);
    setError('');
    fetch(`${API_BASE}/sales-opportunities/${saleId}`, { headers: getAuthHeader(), credentials: 'include' })
      .then((r) => r.json().catch(() => ({})))
      .then((data) => {
        if (cancelled) return;
        if (!data._id) {
          setError(data.error || '불러오기에 실패했습니다.');
          setLoadingSale(false);
          return;
        }
        const cust = data.customerCompanyId;
        const prod = data.productId;
        setCustomerCompanyId(cust?._id || '');
        setCustomerCompanyName(cust?.name || '');
        setBusinessNumber(cust?.businessNumber ?? '');
        setContactId(data.customerCompanyEmployeeId || '');
        setContactName((data.contactName || '').trim());
        setProductId(prod?._id || '');
        setProductName((prod?.name || data.productName || '').trim());
        setProductMode(prod?._id ? 'registered' : 'custom');
        if (!prod?._id && (data.productName || '').trim()) {
          setConfirmedCustomProductName(sanitizeFolderNamePart(String(data.productName).trim()) || '');
        }
        setUnitPrice(data.unitPrice != null ? String(data.unitPrice) : '');
        setCurrency(data.currency || 'KRW');
        setQuantity(String(data.quantity != null ? data.quantity : 1));
        setDiscountType(['none', 'rate', 'amount'].includes(data.discountType) ? data.discountType : 'none');
        setDiscountValue(data.discountValue != null ? String(data.discountValue) : '');
        setTitle(data.title || '');
        setDescription(data.description || '');
        setDocumentRefs(Array.isArray(data.documentRefs)
          ? data.documentRefs.map((url) => (typeof url === 'string' ? { url, name: '파일' } : { url: url?.url, name: url?.name || '파일' }))
          : []);
        setLoadingSale(false);
      })
      .catch(() => {
        if (!cancelled) {
          setError('서버에 연결할 수 없습니다.');
          setLoadingSale(false);
        }
      });
    return () => { cancelled = true; };
  }, [saleId]);

  const driveFolderName = (() => {
    const namePart = sanitizeFolderNamePart(customerCompanyName || '미소속');
    const numPart = sanitizeFolderNamePart(businessNumber) || '미등록';
    return `${namePart}_${numPart}`;
  })();

  /** 미등록 제품 직접 입력일 때는 확인 버튼을 눌러야만 파일 업로드 가능 */
  const canUploadFiles = productMode !== 'custom' || !!confirmedCustomProductName.trim();

  /** 제품명으로 쓸 폴더명. 등록 제품: 선택한 제품명. 미등록 직접 입력: 확인 버튼으로 확정한 값만 사용 */
  const productFolderName = (() => {
    if (productMode === 'custom') return (confirmedCustomProductName || '').trim();
    const name = (productName || '').trim();
    if (!name) return '';
    return sanitizeFolderNamePart(name) || '';
  })();

  const loadDriveFiles = useCallback(async (folderId) => {
    setDriveLoading(true);
    setDriveError('');
    try {
      const params = new URLSearchParams({ pageSize: '50', folderId: folderId || 'root' });
      const r = await fetch(`${API_BASE}/drive/files?${params}`, { headers: getAuthHeader(), credentials: 'include' });
      const data = await r.json().catch(() => ({}));
      if (r.ok) setDriveFiles(data.files || []);
      else setDriveError(data.error || 'Drive 목록을 불러올 수 없습니다.');
    } catch (_) {
      setDriveError('Drive에 연결할 수 없습니다.');
    } finally {
      setDriveLoading(false);
    }
  }, []);

  /** 회사 폴더 확보 후, 제품명이 있으면 그 하위 폴더까지 확보해 { id, webViewLink } 반환 */
  const ensureTargetDriveFolder = useCallback(async () => {
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
  }, [driveFolderName, productFolderName]);

  const ensureDriveFolderAndOpen = useCallback(async () => {
    setDriveLoading(true);
    setDriveError('');
    try {
      const result = await ensureTargetDriveFolder();
      if (!result.ok) {
        setDriveError(result.error);
        return;
      }
      setDriveFolderId(result.id);
      setDriveFolderLink(result.webViewLink);
      setDrivePath([{ id: result.id, name: productFolderName || driveFolderName }]);
      setShowDrivePicker(true);
      await loadDriveFiles(result.id);
    } catch (_) {
      setDriveError('Drive에 연결할 수 없습니다.');
    } finally {
      setDriveLoading(false);
    }
  }, [driveFolderName, productFolderName, ensureTargetDriveFolder, loadDriveFiles]);

  useEffect(() => {
    if (loadingSale) return;
    let cancelled = false;
    (async () => {
      const result = await ensureTargetDriveFolder();
      if (cancelled || !result.ok) return;
      setDriveFolderId(result.id);
      setDriveFolderLink(result.webViewLink);
    })();
    return () => { cancelled = true; };
  }, [ensureTargetDriveFolder, loadingSale, productFolderName]);

  const addDocumentRef = useCallback((url, name) => {
    const link = (url || '').trim();
    if (!link) return;
    setDocumentRefs((prev) => (prev.some((r) => (typeof r === 'string' ? r : r?.url) === link) ? prev : [...prev, { url: link, name: name || '파일' }]));
  }, []);

  const removeDocumentRef = useCallback((url) => {
    setDocumentRefs((prev) => prev.filter((r) => (typeof r === 'string' ? r : r?.url) !== url));
  }, []);

  const insertDriveLink = useCallback(async (fileId) => {
    try {
      const r = await fetch(`${API_BASE}/drive/files/${fileId}`, { headers: getAuthHeader() });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return;
      const url = data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`;
      addDocumentRef(url, data.name || '파일');
      setShowDrivePicker(false);
    } catch (_) {}
  }, [addDocumentRef]);

  const driveEnterFolder = useCallback(
    (item) => {
      setDrivePath((prev) => [...prev, item]);
      loadDriveFiles(item.id);
    },
    [loadDriveFiles]
  );

  const driveNavigateTo = useCallback((index) => {
    if (index < 0) {
      setDrivePath([]);
      return;
    }
    const newPath = drivePath.slice(0, index + 1);
    setDrivePath(newPath);
    const last = newPath[newPath.length - 1];
    if (last) loadDriveFiles(last.id);
  }, [drivePath, loadDriveFiles]);

  const handleDriveFileUpload = useCallback(
    async (files) => {
      if (!driveFolderId || !files?.length) return;
      setDriveUploading(true);
      setDriveError('');
      for (const file of Array.from(files)) {
        try {
          const contentBase64 = await fileToBase64(file);
          if (!contentBase64) { setDriveError(`"${file.name}" 변환 실패`); continue; }
          const r = await fetch(`${API_BASE}/drive/upload`, {
            method: 'POST',
            headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              name: file.name,
              mimeType: file.type || 'application/octet-stream',
              contentBase64,
              parentFolderId: driveFolderId
            })
          });
          const data = await r.json().catch(() => ({}));
          if (r.ok && data.webViewLink) addDocumentRef(data.webViewLink, data.name || file.name);
          else setDriveError(data.error || '업로드 실패');
        } catch (_) {
          setDriveError('업로드 중 오류가 났습니다.');
        }
      }
      setDriveUploading(false);
      if (driveFolderId) loadDriveFiles(driveFolderId);
    },
    [driveFolderId, addDocumentRef, loadDriveFiles]
  );

  /** 파일 선택 시 회사(·제품) 폴더 확보 후 해당 폴더에 업로드. 미등록 제품은 확인 버튼 누른 후에만 허용 */
  const handleDirectFileUpload = useCallback(
    async (files) => {
      const filesArray = Array.from(files || []);
      if (!filesArray.length) return;
      if (productMode === 'custom' && !confirmedCustomProductName.trim()) return;
      setDriveUploading(true);
      setDriveError('');
      try {
        const result = await ensureTargetDriveFolder();
        if (!result.ok) {
          setDriveError(result.error);
          setDriveUploading(false);
          return;
        }
        const parentId = result.id;
        setDriveFolderId(parentId);
        setDriveFolderLink(result.webViewLink);
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
                parentFolderId: parentId
              })
            });
            const upData = await up.json().catch(() => ({}));
            if (up.ok && upData.webViewLink) {
              addDocumentRef(upData.webViewLink, upData.name || file.name);
            } else {
              setDriveError(upData.error || upData.details || '업로드 실패');
            }
          } catch (err) {
            setDriveError(err?.message || '업로드 중 오류가 났습니다.');
          }
        }
      } catch (err) {
        setDriveError(err?.message || 'Drive에 연결할 수 없습니다.');
      } finally {
        setDriveUploading(false);
      }
    },
    [ensureTargetDriveFolder, addDocumentRef, productMode, confirmedCustomProductName]
  );

  const suggestTitle = useCallback(() => {
    const name = productName.trim() || '제품';
    const cust = contactMode ? (contactName || customerCompanyName).trim() : (customerCompanyName || contactName).trim();
    if (cust) return `${cust} - ${name} × ${qtyNum}`;
    return `${name} × ${qtyNum}`;
  }, [contactMode, contactName, customerCompanyName, productName, qtyNum]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (showDrivePicker) setShowDrivePicker(false);
      else if (showCompanySearch || showContactSearch || showProductSearch) {
        setShowCompanySearch(false);
        setShowContactSearch(false);
        setShowProductSearch(false);
      } else onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, showCompanySearch, showContactSearch, showProductSearch, showDrivePicker]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!contactMode) {
      const custId = customerCompanyId || null;
      if (!custId) {
        setError('고객사를 선택해 주세요.');
        return;
      }
    }
    const t = title.trim() || suggestTitle();
    if (!t) {
      setError('제목을 입력하거나 고객사·제품을 선택해 주세요.');
      return;
    }
    if (productMode === 'registered' && !productId) {
      setError('등록 제품을 선택하거나 "미등록 제품 직접 입력"으로 제품명을 입력해 주세요.');
      return;
    }
    if (productMode === 'custom' && !productName.trim()) {
      setError('제품명을 입력해 주세요.');
      return;
    }

    setSaving(true);
    try {
      const folderResult = await ensureTargetDriveFolder();
      const linkToSave = folderResult.ok ? folderResult.webViewLink : ((driveFolderLink || '').trim() || undefined);
      const docRefsList = documentRefs
        .map((r) => {
          const url = (typeof r === 'string' ? r : r?.url || '').trim();
          const name = (typeof r === 'string' ? '파일' : (r?.name || '파일')).trim() || '파일';
          return url ? { url, name } : null;
        })
        .filter(Boolean);
      const body = {
        title: t,
        ...(isEditMode ? {} : { stage: 'Won' }),
        customerCompanyId: contactMode ? (customerCompanyId || null) : (customerCompanyId || null),
        customerCompanyEmployeeId: contactId || null,
        contactName: (contactName || '').trim() || undefined,
        productId: productMode === 'registered' && productId ? productId : null,
        productName: (productName || '').trim() || undefined,
        quantity: qtyNum,
        unitPrice: unitNum,
        discountType: discountType === 'none' ? 'none' : discountType,
        discountValue: discountType === 'none' ? 0 : dVal,
        currency,
        value: finalValue,
        description: description.trim(),
        documentRefs: docRefsList,
        driveFolderLink: linkToSave
      };
      const url = isEditMode ? `${API_BASE}/sales-opportunities/${saleId}` : `${API_BASE}/sales-opportunities`;
      const method = isEditMode ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || '저장에 실패했습니다.');
        return;
      }
      onSaved?.();
      onClose?.();
    } catch (_) {
      setError('서버에 연결할 수 없습니다.');
    } finally {
      setSaving(false);
    }
  };

  if (loadingSale) {
    return (
      <div className="register-sale-overlay">
        <div className="register-sale-modal" onClick={(e) => e.stopPropagation()}>
          <header className="register-sale-header">
            <h3>판매 수정</h3>
            <button type="button" className="register-sale-close" onClick={onClose} aria-label="닫기">
              <span className="material-symbols-outlined">close</span>
            </button>
          </header>
          <div className="register-sale-body"><p className="register-sale-loading">불러오는 중…</p></div>
        </div>
      </div>
    );
  }

  if (isEditMode && error && !title && !customerCompanyId) {
    return (
      <div className="register-sale-overlay">
        <div className="register-sale-modal" onClick={(e) => e.stopPropagation()}>
          <header className="register-sale-header">
            <h3>판매 수정</h3>
            <button type="button" className="register-sale-close" onClick={onClose} aria-label="닫기">
              <span className="material-symbols-outlined">close</span>
            </button>
          </header>
          <div className="register-sale-body"><p className="register-sale-error">{error}</p></div>
        </div>
      </div>
    );
  }

  return (
    <div className="register-sale-overlay">
      <div
        ref={modalContentRef}
        className="register-sale-modal"
        onClick={(e) => e.stopPropagation()}
        onDragEnter={(e) => { e.preventDefault(); setDragInModal(true); }}
        onDragLeave={(e) => { if (!modalContentRef.current?.contains(e.relatedTarget)) setDragInModal(false); }}
      >
        <header className="register-sale-header">
          <h3>{isEditMode ? '판매 수정' : '판매 등록'}</h3>
          <button type="button" className="register-sale-close" onClick={onClose} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>

        <form className="register-sale-form" onSubmit={handleSubmit}>
          {/* 연락처 세부에서 열었을 때: 고객명 + 소속 고객사(있을 때만) */}
          {contactMode ? (
            <>
              <div className="register-sale-field">
                <label>고객명</label>
                <div className="register-sale-search-wrap">
                  <span className="register-sale-display">{contactName || '—'}</span>
                </div>
              </div>
              {customerCompanyName && (
                <div className="register-sale-field">
                  <label>소속 고객사</label>
                  <div className="register-sale-search-wrap">
                    <span className="register-sale-display">{customerCompanyName}</span>
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              {/* 고객사 (고객사 세부에서 열면 자동 등록, 필수) */}
              <div className="register-sale-field">
                <label>고객사 <em>*</em></label>
                <div className="register-sale-search-wrap">
                  <span className="register-sale-display">{customerCompanyName || '선택 안함'}</span>
                  {!initialCustomerCompany && (
                    <button type="button" className="register-sale-search-btn" onClick={() => setShowCompanySearch(true)}>
                      <span className="material-symbols-outlined">search</span> 검색
                    </button>
                  )}
                </div>
              </div>
              {/* 고객명 (선택, 해당 고객사 소속만 검색) */}
              {initialCustomerCompany && (
                <div className="register-sale-field">
                  <label>고객명</label>
                  <div className="register-sale-search-wrap">
                    <span className="register-sale-display">{contactName || '선택 안함'}</span>
                    <button type="button" className="register-sale-search-btn" onClick={() => setShowContactSearch(true)}>
                      <span className="material-symbols-outlined">search</span> 검색
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* 제품: 등록 제품 선택 / 미등록 직접 입력 */}
          <div className="register-sale-field">
            <label>제품</label>
            <div className="register-sale-mode-tabs">
              <button
                type="button"
                className={productMode === 'registered' ? 'active' : ''}
                onClick={() => setProductMode('registered')}
              >
                등록 제품 선택
              </button>
              <button
                type="button"
                className={productMode === 'custom' ? 'active' : ''}
                onClick={() => setProductMode('custom')}
              >
                미등록 제품 직접 입력
              </button>
            </div>
            {productMode === 'registered' ? (
              <div className="register-sale-search-wrap">
                <span className="register-sale-display">{productName || '선택 안함'}</span>
                <button type="button" className="register-sale-search-btn" onClick={() => setShowProductSearch(true)}>
                  <span className="material-symbols-outlined">search</span> 검색
                </button>
              </div>
            ) : (
              <div className="register-sale-custom-product-row">
                <input
                  type="text"
                  className="register-sale-input"
                  placeholder="제품명 입력"
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                />
                <button
                  type="button"
                  className="register-sale-confirm-product-btn"
                  onClick={() => setConfirmedCustomProductName(sanitizeFolderNamePart((productName || '').trim()) || '')}
                  title="Drive 폴더명 확정 (입력한 제품명으로 폴더 생성)"
                  aria-label="Drive 폴더명 확정"
                >
                  <span className="material-symbols-outlined">check</span>
                </button>
              </div>
            )}
          </div>

          {/* 수량 · 단가 · 통화 */}
          <div className="register-sale-row">
            <div className="register-sale-field">
              <label>수량</label>
              <input
                type="text"
                inputMode="numeric"
                className="register-sale-input"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="1"
              />
            </div>
            <div className="register-sale-field">
              <label>단가</label>
              <input
                type="text"
                inputMode="numeric"
                className="register-sale-input"
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="register-sale-field register-sale-currency">
              <label>통화</label>
              <select
                className="register-sale-select"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                {CURRENCY_OPTIONS.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* 할인 */}
          <div className="register-sale-row">
            <div className="register-sale-field">
              <label>할인</label>
              <select
                className="register-sale-select"
                value={discountType}
                onChange={(e) => setDiscountType(e.target.value)}
              >
                {DISCOUNT_OPTIONS.map((d) => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </select>
            </div>
            {discountType !== 'none' && (
              <div className="register-sale-field">
                <label>{discountType === 'rate' ? '할인율 (%)' : '할인가 (금액)'}</label>
                <input
                  type="text"
                  inputMode="numeric"
                  className="register-sale-input"
                  value={discountValue}
                  onChange={(e) => setDiscountValue(e.target.value)}
                  placeholder={discountType === 'rate' ? '10' : '0'}
                />
              </div>
            )}
          </div>

          {/* 금액 요약 */}
          <div className="register-sale-summary">
            <span>소계: {currency === 'USD' ? '$' : '₩'}{subtotal.toLocaleString()}</span>
            {discountType !== 'none' && (
              <span>할인: -{currency === 'USD' ? '$' : '₩'}{discountAmount.toLocaleString()}</span>
            )}
            <strong>최종 금액: {currency === 'USD' ? '$' : '₩'}{finalValue.toLocaleString()}</strong>
          </div>

          {/* 제목 */}
          <div className="register-sale-field">
            <label>기회 제목</label>
            <input
              type="text"
              className="register-sale-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={suggestTitle()}
            />
          </div>

          {/* 설명 */}
          <div className="register-sale-field">
            <label>설명</label>
            <textarea
              className="register-sale-textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="메모..."
              rows={2}
            />
          </div>

          {/* 증서 · 자료 (Google Drive: [고객사]_[사업자번호] 폴더) */}
          <div className="register-sale-field register-sale-docs">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => { handleDirectFileUpload(e.target.files); e.target.value = ''; }}
              disabled={driveUploading || !canUploadFiles}
              aria-hidden="true"
            />
            {productMode === 'custom' && !canUploadFiles && (
              <p className="register-sale-docs-require-confirm">제품명을 입력한 뒤 확인(✓) 버튼을 누른 후 파일을 등록해 주세요.</p>
            )}
            <div className="register-sale-docs-head">
              <div className="register-sale-docs-head-left">
                <label className="register-sale-docs-label">증서 · 자료</label>
                <span className="register-sale-docs-hint">폴더: {driveFolderName}{productFolderName ? ` / ${productFolderName}` : ''}</span>
              </div>
              <button
                type="button"
                className="register-sale-docs-add-btn"
                onClick={() => { if (canUploadFiles && !driveUploading && fileInputRef.current) fileInputRef.current.click(); }}
                disabled={driveUploading || !canUploadFiles}
                title={!canUploadFiles ? '제품명 확인 후 업로드 가능' : '파일 추가'}
                aria-label="파일 추가"
              >
                <span className="material-symbols-outlined">add</span>
              </button>
            </div>
            {driveFolderLink && getDriveFolderIdFromLink(driveFolderLink) ? (
              <div
                className={`register-sale-docs-embed-wrap ${docsDropActive && canUploadFiles ? 'register-sale-docs-dropzone-active' : ''} ${driveUploading || !canUploadFiles ? 'register-sale-docs-dropzone-disabled' : ''} ${dragInModal ? 'register-sale-docs-drag-in-modal' : ''}`}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (canUploadFiles && !driveUploading) setDocsDropActive(true); }}
                onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDocsDropActive(false); }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDocsDropActive(false);
                  setDragInModal(false);
                  if (canUploadFiles && !driveUploading && e.dataTransfer?.files?.length) handleDirectFileUpload(e.dataTransfer.files);
                }}
                aria-label="Drive 폴더 (드래그하여 파일 추가, 리스트 클릭 시 열람)"
              >
                <iframe
                  title="Google Drive 폴더 현황"
                  src={`https://drive.google.com/embeddedfolderview?id=${getDriveFolderIdFromLink(driveFolderLink)}#list`}
                  className="register-sale-docs-embed"
                />
                {!canUploadFiles ? (
                  <div className="register-sale-docs-embed-overlay">제품명 확인 후 파일 등록 가능</div>
                ) : driveUploading ? (
                  <div className="register-sale-docs-embed-overlay">업로드 중…</div>
                ) : docsDropActive ? (
                  <div className="register-sale-docs-embed-overlay">여기에 놓기</div>
                ) : null}
              </div>
            ) : (
              <div
                className={`register-sale-docs-dropzone ${docsDropActive && canUploadFiles ? 'register-sale-docs-dropzone-active' : ''} ${driveUploading || !canUploadFiles ? 'register-sale-docs-dropzone-disabled' : ''}`}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (canUploadFiles && !driveUploading) setDocsDropActive(true); }}
                onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDocsDropActive(false); }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDocsDropActive(false);
                  if (canUploadFiles && !driveUploading && e.dataTransfer?.files?.length) handleDirectFileUpload(e.dataTransfer.files);
                }}
                onClick={() => { if (canUploadFiles && !driveUploading && fileInputRef.current) fileInputRef.current.click(); }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && canUploadFiles && !driveUploading && fileInputRef.current) fileInputRef.current.click(); }}
                aria-label="파일 업로드 (드래그 앤 드롭 또는 클릭)"
              >
                <span className="material-symbols-outlined register-sale-docs-dropzone-icon">upload_file</span>
                <span>{!canUploadFiles ? '제품명 확인 후 업로드 가능' : driveUploading ? '업로드 중…' : '파일을 여기에 놓거나 클릭하여 선택'}</span>
              </div>
            )}
            {driveError && <p className="register-sale-docs-error">{driveError}</p>}
          </div>

          {error && <p className="register-sale-error">{error}</p>}

          <div className="register-sale-actions">
            <button type="button" className="register-sale-cancel" onClick={onClose}>취소</button>
            <button type="submit" className="register-sale-submit" disabled={saving}>
              {saving ? '저장 중...' : isEditMode ? '저장' : '판매 등록'}
            </button>
          </div>
        </form>
      </div>

      {showCompanySearch && (
        <CustomerCompanySearchModal
          onClose={() => setShowCompanySearch(false)}
          onSelect={(company) => {
            setCustomerCompanyId(company._id);
            setCustomerCompanyName(company.name || '');
            setShowCompanySearch(false);
          }}
        />
      )}
      {showContactSearch && customerCompanyId && (
        <CustomerCompanyEmployeesSearchModal
          customerCompanyId={customerCompanyId}
          onClose={() => setShowContactSearch(false)}
          onSelect={(contact) => {
            setContactId(contact._id);
            setContactName(contact.name || '');
            setShowContactSearch(false);
          }}
        />
      )}
      {showProductSearch && (
        <ProductSearchModal
          onClose={() => setShowProductSearch(false)}
          onSelect={(product) => {
            setProductId(product._id);
            setProductName(product.name || '');
            setUnitPrice(product.price != null ? String(product.price) : '');
            setCurrency(product.currency || 'KRW');
            setShowProductSearch(false);
          }}
        />
      )}

      {showDrivePicker && (
        <div className="register-sale-drive-overlay" onClick={() => setShowDrivePicker(false)}>
          <div className="register-sale-drive-modal" onClick={(e) => e.stopPropagation()}>
            <div className="register-sale-drive-header">
              <h4>증서 · 자료 — Google Drive</h4>
              <button type="button" className="register-sale-drive-close" onClick={() => setShowDrivePicker(false)} aria-label="닫기">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="register-sale-drive-body">
              {drivePath.length > 0 && (
                <div className="register-sale-drive-breadcrumb">
                  <button type="button" className="register-sale-drive-breadcrumb-item" onClick={() => { setDrivePath([]); }}>
                    <span className="material-symbols-outlined">home</span> 최상위
                  </button>
                  {drivePath.map((p, i) => (
                    <span key={p.id + i} className="register-sale-drive-breadcrumb-wrap">
                      <span className="register-sale-drive-breadcrumb-sep">/</span>
                      <button type="button" className="register-sale-drive-breadcrumb-item" onClick={() => driveNavigateTo(i)}>
                        {p.name}
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {driveError && <p className="register-sale-drive-error">{driveError}</p>}
              {driveLoading ? (
                <p className="register-sale-drive-loading">불러오는 중…</p>
              ) : driveFiles.length === 0 ? (
                <p className="register-sale-drive-empty">이 폴더가 비어 있습니다. 닫은 뒤 증서·자료의 &quot;파일 업로드&quot;를 누르면 폴더가 없을 경우 자동 생성됩니다.</p>
              ) : (
                <ul className="register-sale-drive-list">
                  {driveFiles.map((f) => {
                    const isFolder = f.mimeType === DRIVE_FOLDER_MIME;
                    return (
                      <li key={f.id}>
                        <button
                          type="button"
                          className={`register-sale-drive-item ${isFolder ? 'register-sale-drive-item-folder' : ''}`}
                          onClick={() => (isFolder ? driveEnterFolder({ id: f.id, name: f.name }) : insertDriveLink(f.id))}
                        >
                          <span className="material-symbols-outlined">{isFolder ? 'folder' : 'description'}</span>
                          <span className="register-sale-drive-item-name">{f.name}</span>
                          {isFolder ? <span className="material-symbols-outlined">chevron_right</span> : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
