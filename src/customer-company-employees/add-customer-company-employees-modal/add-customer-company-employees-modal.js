import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import GoogleContactsModal from '../google-contacts-modal/google-contacts-modal';
import CustomerCompanySearchModal from '../../customer-companies/customer-company-search-modal/customer-company-search-modal';
import CustomFieldsSection from '../../shared/custom-fields-section';
import AssigneePickerModal from '../../company-overview/assignee-picker-modal/assignee-picker-modal';
import '../../customer-companies/add-company-modal/add-company-modal.css';
import './add-customer-company-employees-modal.css';
import ContactImportPreviewModal from './contact-import-preview-modal';

import { API_BASE } from '@/config';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function formatPhoneInput(value) {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 0) return '';
  if (digits.startsWith('010') && digits.length <= 11) {
    if (digits.length <= 3) return digits;
    if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 11)}`;
  }
  if (digits.startsWith('02') && digits.length <= 10) {
    if (digits.length <= 2) return digits;
    if (digits.length <= 5) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
    if (digits.length <= 9) return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`;
    return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6, 10)}`;
  }
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
}

function sanitizeFolderNamePart(s, maxLen = 80) {
  const t = String(s ?? '')
    .replace(/[/\\*?:<>"|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > maxLen ? t.slice(0, maxLen) : t;
}

function getDriveFolderIdFromLink(url) {
  if (!url || typeof url !== 'string') return null;
  const m = url.trim().match(/\/folders\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

/** Drive 업로드용: 고객사명·연락처 기반 파일명 (add-company 사업자등록증 명명 규칙과 동일한 방식) */
function buildBusinessCardDriveFileName(snapshot, file) {
  const namePart = sanitizeFolderNamePart(snapshot.name || '이름없음', 50).replace(/\s+/g, '_') || '이름없음';
  const contactRaw = (snapshot.phone || snapshot.email || '미등록').trim();
  const contactPart = sanitizeFolderNamePart(contactRaw.replace(/[^\w\s가-힣@.-]/g, ' '), 45).replace(/\s+/g, '_') || '미등록';
  const m = (file?.type || '').toLowerCase();
  let ext = 'jpg';
  if (m.includes('png')) ext = 'png';
  else if (m.includes('webp')) ext = 'webp';
  else if (m.includes('gif')) ext = 'gif';
  else {
    const fn = file?.name || '';
    const i = fn.lastIndexOf('.');
    if (i >= 0) ext = fn.slice(i + 1).replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'jpg';
  }
  const base = `명함_${namePart}_${contactPart}.${ext}`;
  return base.length > 200 ? `${base.slice(0, 196 - ext.length)}.${ext}` : base;
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

function isTxtFile(file) {
  if (!file) return false;
  const n = (file.name || '').toLowerCase();
  return file.type === 'text/plain' || n.endsWith('.txt');
}

function isBusinessCardLikeFile(file) {
  if (!file) return false;
  if (isTxtFile(file)) return true;
  return (file.type || '').startsWith('image/');
}

/** 파일 2개 이상일 때만 배치 미리보기 (TXT 1개는 명함 이미지 1개와 동일하게 폼 기입) */
function shouldUseContactBatchPreview(files) {
  const arr = Array.from(files || []);
  return arr.length >= 2;
}

/** 연락처 담당자 초기값: 수정 시 = 저장된 값만(없으면 빈 배열), 등록 시 = 현재 사용자 1명 */
function getInitialAssigneeIds(isEditMode, contact) {
  if (isEditMode && contact != null) {
    if (!Array.isArray(contact.assigneeUserIds)) return [];
    return contact.assigneeUserIds
      .map((id) => {
        if (id == null) return null;
        const raw = id._id ?? id.id ?? id;
        return raw ? String(raw) : null;
      })
      .filter(Boolean);
  }
  try {
    const u = JSON.parse(localStorage.getItem('crm_user') || '{}');
    return u?._id ? [String(u._id)] : [];
  } catch (_) {
    return [];
  }
}

/** 폼 초기값: 등록/수정에 따라 담당자만 다르게, 나머지는 contact 또는 initialCustomerCompany 기준 */
function buildInitialForm(contact, initialCustomerCompany) {
  const isEditMode = Boolean(contact && (contact._id || contact.id));
  const assigneeUserIds = getInitialAssigneeIds(isEditMode, contact);

  const base = {
    name: '',
    company: '',
    email: '',
    phone: '',
    position: '',
    address: '',
    birthDate: '',
    memo: '',
    customerCompanyId: '',
    customFields: {},
    assigneeUserIds,
    status: 'Lead'
  };

  if (isEditMode && contact) {
    const companyId = contact.customerCompanyId?._id ?? contact.customerCompanyId ?? '';
    const companyName = companyId
      ? (typeof contact.company === 'string' ? contact.company : (contact.company?.name ?? ''))
      : ((contact.companyName && String(contact.companyName).trim())
        || (typeof contact.company === 'string' ? contact.company : (contact.company?.name ?? '')) || '');
    return {
      ...base,
      name: String(contact.name ?? '').replace(/\s/g, ''),
      email: contact.email ?? '',
      phone: contact.phone ?? '',
      position: contact.position ?? '',
      address: contact.address ?? '',
      birthDate: contact.birthDate ?? '',
      memo: contact.memo ?? '',
      company: companyName,
      customerCompanyId: companyId ? String(companyId) : '',
      customFields: contact.customFields ? { ...contact.customFields } : {},
      assigneeUserIds,
      status: contact.status || 'Lead'
    };
  }

  if (initialCustomerCompany && (initialCustomerCompany._id || initialCustomerCompany.name)) {
    return {
      ...base,
      company: initialCustomerCompany.name || '',
      customerCompanyId: initialCustomerCompany._id || '',
      address: initialCustomerCompany.address != null ? String(initialCustomerCompany.address).trim() : ''
    };
  }

  return base;
}

export default function AddContactModal({ onClose, onSaved, onUpdated, initialCustomerCompany, contact }) {
  const isEditMode = Boolean(contact && (contact._id || contact.id));
  const effectiveInitialCompany = isEditMode && (contact?.customerCompanyId || contact?.company)
    ? { _id: contact.customerCompanyId?._id ?? contact.customerCompanyId, name: typeof contact.company === 'string' ? contact.company : (contact.company?.name ?? '') }
    : initialCustomerCompany;

  const [form, setForm] = useState(() => buildInitialForm(contact, initialCustomerCompany));
  const [showAssigneePicker, setShowAssigneePicker] = useState(false);
  const [companyEmployeesForDisplay, setCompanyEmployeesForDisplay] = useState([]);
  const [customDefinitions, setCustomDefinitions] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showCompanySearchModal, setShowCompanySearchModal] = useState(false);
  const [showBulkGoogle, setShowBulkGoogle] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);
  const fixedCompany = !!(effectiveInitialCompany && effectiveInitialCompany._id);

  /** 수정 모드: 연결 고객사의 사업자번호(조회 전용, 변경 불가) */
  const editModeCompanyBusinessNumber = useMemo(() => {
    if (!isEditMode || !contact) return '';
    const cc = contact.customerCompanyId;
    if (cc && typeof cc === 'object' && cc.businessNumber != null && String(cc.businessNumber).trim()) {
      return String(cc.businessNumber).trim();
    }
    if (contact.company && typeof contact.company === 'object' && contact.company.businessNumber != null) {
      return String(contact.company.businessNumber).trim();
    }
    return '';
  }, [isEditMode, contact]);

  /** 고객사 칸·검색 선택 모두 비었을 때 = 개인 연락처 (고정 고객사 맥락이 아닐 때만) */
  const isIndividual = useMemo(() => {
    if (fixedCompany) return false;
    const hasId = !!String(form.customerCompanyId || '').trim();
    const hasCompanyText = !!(form.company || '').trim();
    return !hasId && !hasCompanyText;
  }, [fixedCompany, form.customerCompanyId, form.company]);

  const cardInputRef = useRef(null);
  const [businessCardFile, setBusinessCardFile] = useState(null);
  const [businessCardDropActive, setBusinessCardDropActive] = useState(false);
  const [extractingBusinessCard, setExtractingBusinessCard] = useState(false);
  const [showImportPreview, setShowImportPreview] = useState(false);
  const [importPreviewItems, setImportPreviewItems] = useState([]);
  const [importPreviewLoading, setImportPreviewLoading] = useState(false);
  const [importBulkSaving, setImportBulkSaving] = useState(false);

  const [bcDriveFolderId, setBcDriveFolderId] = useState(null);
  const [bcDriveFiles, setBcDriveFiles] = useState([]);
  const [loadingBcFiles, setLoadingBcFiles] = useState(false);

  const fetchCustomDefinitions = async () => {
    try {
      const res = await fetch(`${API_BASE}/custom-field-definitions?entityType=contact`, { headers: getAuthHeader() });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.items)) setCustomDefinitions(data.items);
    } catch (_) {}
  };

  useEffect(() => {
    fetchCustomDefinitions();
  }, []);

  /** 수정 모드에서 열린 연락처(contact)가 바뀌면 폼을 그 연락처 기준으로 다시 채움 (담당자 포함) */
  const contactId = contact?._id ?? contact?.id ?? null;
  useEffect(() => {
    if (!contactId) return;
    setForm(buildInitialForm(contact, initialCustomerCompany));
  }, [contactId]);

  useEffect(() => {
    setBusinessCardFile(null);
    setBcDriveFolderId(null);
    setBcDriveFiles([]);
  }, [contactId]);

  useEffect(() => {
    if (!isEditMode || !contactId || !contact?.driveRootFolderId) {
      setBcDriveFolderId(null);
      setBcDriveFiles([]);
      return;
    }
    let cancelled = false;
    const rootId = String(contact.driveRootFolderId).trim();
    if (!rootId) return;
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/drive/folders/ensure`, {
          method: 'POST',
          headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ folderName: 'business card', parentFolderId: rootId })
        });
        const data = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (r.ok && data.id) {
          setBcDriveFolderId(data.id);
        }
      } catch (_) {}
    })();
    return () => { cancelled = true; };
  }, [isEditMode, contactId, contact?.driveRootFolderId]);

  useEffect(() => {
    if (!bcDriveFolderId) {
      setBcDriveFiles([]);
      return;
    }
    let cancelled = false;
    setLoadingBcFiles(true);
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/drive/files?folderId=${encodeURIComponent(bcDriveFolderId)}&pageSize=50`, {
          headers: getAuthHeader()
        });
        const data = await res.json().catch(() => ({}));
        if (!cancelled) setBcDriveFiles(res.ok && Array.isArray(data.files) ? data.files : []);
      } catch (_) {
        if (!cancelled) setBcDriveFiles([]);
      } finally {
        if (!cancelled) setLoadingBcFiles(false);
      }
    })();
    return () => { cancelled = true; };
  }, [bcDriveFolderId]);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/companies/overview`, { headers: getAuthHeader() })
      .then((r) => r.json().catch(() => ({})))
      .then((data) => {
        if (!cancelled && Array.isArray(data?.employees)) setCompanyEmployeesForDisplay(data.employees);
      });
    return () => { cancelled = true; };
  }, []);

  const assigneeIdToName = useMemo(() => {
    const map = {};
    (companyEmployeesForDisplay || []).forEach((e) => {
      const id = e.id != null ? String(e.id) : null;
      if (id) map[id] = e.name || e.email || id;
    });
    return map;
  }, [companyEmployeesForDisplay]);

  const assigneeInputValue = (form.assigneeUserIds || [])
    .map((id) => assigneeIdToName[String(id)] || id)
    .join(', ');

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (showBulkGoogle) setShowBulkGoogle(false);
      else if (showAssigneePicker) setShowAssigneePicker(false);
      else if (showCompanySearchModal) setShowCompanySearchModal(false);
      else if (showImportPreview) setShowImportPreview(false);
      else onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, showAssigneePicker, showBulkGoogle, showCompanySearchModal, showImportPreview]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === 'phone') setForm((prev) => ({ ...prev, phone: formatPhoneInput(value) }));
    else if (name === 'name') setForm((prev) => ({ ...prev, name: value.replace(/\s/g, '') }));
    else setForm((prev) => ({ ...prev, [name]: value }));
    setError('');
  };

  /** 고객사 직접 입력 시 DB 연결 해제(customerCompanyId null로 저장됨) */
  const handleCompanyInputChange = (e) => {
    setForm((prev) => ({ ...prev, company: e.target.value, customerCompanyId: '' }));
    setError('');
  };

  /** 명함 이미지 → Gemini 추출 → 폼 기입 (회사명은 고객사 칸에, 이름은 띄어쓰기 제거) */
  const extractFromBusinessCardAndFillForm = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('명함은 이미지 파일만 등록할 수 있습니다.');
      return;
    }
    setExtractingBusinessCard(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${API_BASE}/customer-company-employees/extract-from-business-card`, {
        method: 'POST',
        headers: getAuthHeader(),
        body: fd
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || '명함에서 정보를 읽지 못했습니다.');
        return;
      }
      setForm((prev) => {
        const cn = data.companyName && String(data.companyName).trim();
        const nameNoSpace = (s) => String(s || '').replace(/\s/g, '');
        const next = {
          ...prev,
          name: nameNoSpace(data.name && String(data.name).trim()) || nameNoSpace(prev.name),
          email: (data.email && String(data.email).trim()) || prev.email,
          phone: data.phone ? formatPhoneInput(String(data.phone)) : prev.phone,
          position: (data.position && String(data.position).trim()) || prev.position,
          address: (data.address && String(data.address).trim()) || prev.address
        };
        if (!fixedCompany && cn) {
          next.company = cn;
          next.customerCompanyId = '';
        }
        return next;
      });
    } catch (_) {
      setError('서버에 연결할 수 없습니다.');
    } finally {
      setExtractingBusinessCard(false);
    }
  };

  /** TXT 1개 → preview-import 후 연락처 1건이면 명함 단건과 동일하게 폼 반영, 2건 이상이면 배치 미리보기 */
  const extractFromTxtAndFillForm = async (file) => {
    if (!file || isEditMode) return;
    setExtractingBusinessCard(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('files', file);
      const res = await fetch(`${API_BASE}/customer-company-employees/preview-import`, {
        method: 'POST',
        headers: getAuthHeader(),
        body: fd
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || '텍스트에서 정보를 읽지 못했습니다.');
        return;
      }
      const items = Array.isArray(data.items) ? data.items : [];
      const valid = items.filter(
        (r) => !r.error && ((r.name || '').trim() || (r.email || '').trim() || (r.phone || '').trim())
      );
      if (!valid.length) {
        const firstErr = items.find((r) => r.error);
        setError(firstErr?.error || '추출된 연락처가 없습니다.');
        return;
      }
      if (valid.length > 1) {
        setImportPreviewItems(items);
        setShowImportPreview(true);
        return;
      }
      const row = valid[0];
      const nameNoSpace = (s) => String(s || '').replace(/\s/g, '');
      setForm((prev) => {
        const cn = (row.companyName && String(row.companyName).trim()) || '';
        const next = {
          ...prev,
          name: nameNoSpace(row.name && String(row.name).trim()) || nameNoSpace(prev.name),
          email: (row.email && String(row.email).trim()) || prev.email,
          phone: row.phone ? formatPhoneInput(String(row.phone)) : prev.phone,
          position: (row.position && String(row.position).trim()) || prev.position,
          address: (row.address && String(row.address).trim()) || prev.address
        };
        if (!fixedCompany && cn) {
          next.company = cn;
          next.customerCompanyId = '';
        }
        return next;
      });
    } catch (_) {
      setError('서버에 연결할 수 없습니다.');
    } finally {
      setExtractingBusinessCard(false);
    }
  };

  const runContactPreviewImport = useCallback(async (files) => {
    const arr = Array.from(files || []).filter((f) => isBusinessCardLikeFile(f));
    if (!arr.length) {
      setError('파일을 추가해 주세요.');
      return;
    }
    setImportPreviewLoading(true);
    setError('');
    try {
      const fd = new FormData();
      arr.forEach((f) => fd.append('files', f));
      const res = await fetch(`${API_BASE}/customer-company-employees/preview-import`, {
        method: 'POST',
        headers: getAuthHeader(),
        body: fd
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || '미리보기에 실패했습니다.');
        return;
      }
      const items = Array.isArray(data.items) ? data.items : [];
      if (!items.length) {
        setError('추출된 연락처가 없습니다.');
        return;
      }
      setImportPreviewItems(items);
      setShowImportPreview(true);
    } catch (_) {
      setError('서버에 연결할 수 없습니다.');
    } finally {
      setImportPreviewLoading(false);
    }
  }, []);

  const confirmBulkContactImport = async () => {
    const rows = importPreviewItems.filter(
      (r) => !r.error && ((r.name || '').trim() || (r.email || '').trim() || (r.phone || '').trim())
    );
    if (!rows.length) {
      setError('등록할 유효한 행이 없습니다.');
      return;
    }
    setImportBulkSaving(true);
    setError('');
    let ok = 0;
    let fail = 0;
    const assigneeUserIds = Array.isArray(form.assigneeUserIds) ? form.assigneeUserIds : [];
    for (const row of rows) {
      try {
        const payload = {
          name: String(row.name || '').replace(/\s/g, '').trim(),
          email: (row.email || '').trim(),
          phone: row.phone ? formatPhoneInput(String(row.phone)) : '',
          position: (row.position || '').trim() || undefined,
          address: (row.address || '').trim() || undefined,
          status: 'Lead',
          assigneeUserIds
        };
        if (fixedCompany && effectiveInitialCompany?._id) {
          payload.customerCompanyId = String(effectiveInitialCompany._id);
          if ((form.company || '').trim()) payload.companyName = (form.company || '').trim();
        } else {
          const cn = (row.companyName || '').trim();
          if (cn) {
            payload.customerCompanyId = null;
            payload.companyName = cn;
          } else {
            payload.isIndividual = true;
            payload.customerCompanyId = null;
            payload.companyName = '';
          }
        }
        if (form.customFields && Object.keys(form.customFields).length) {
          payload.customFields = form.customFields;
        }
        if (!payload.name && !payload.email && !payload.phone) {
          fail += 1;
          continue;
        }
        const res = await fetch(`${API_BASE}/customer-company-employees`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
          body: JSON.stringify(payload)
        });
        if (res.ok) ok += 1;
        else fail += 1;
      } catch {
        fail += 1;
      }
    }
    setImportBulkSaving(false);
    setShowImportPreview(false);
    setImportPreviewItems([]);
    if (ok > 0) {
      window.alert(`등록 완료: ${ok}건${fail ? `, 실패 ${fail}건` : ''}.`);
      onSaved?.();
      onClose?.();
    } else {
      setError(`등록에 실패했습니다. (${fail}건)`);
    }
  };

  const processBusinessCardFileSelection = useCallback(
    (fileList) => {
      const arr = Array.from(fileList || []).filter((f) => isBusinessCardLikeFile(f));
      if (!arr.length) {
        setError('지원 형식: 이미지, TXT 메모');
        return;
      }
      if (isEditMode) {
        if (arr.length === 1 && !isTxtFile(arr[0]) && (arr[0].type || '').startsWith('image/')) {
          setBusinessCardFile(arr[0]);
          extractFromBusinessCardAndFillForm(arr[0]);
        } else if (arr.length > 1) {
          setError('수정 모드에서는 명함 파일을 하나만 선택해 주세요.');
        } else {
          setError('수정 모드에서는 이미지 한 개만 선택할 수 있습니다.');
        }
        return;
      }
      if (shouldUseContactBatchPreview(arr)) {
        runContactPreviewImport(arr);
        return;
      }
      if (arr.length === 1) {
        if (isTxtFile(arr[0])) {
          extractFromTxtAndFillForm(arr[0]);
        } else {
          setBusinessCardFile(arr[0]);
          extractFromBusinessCardAndFillForm(arr[0]);
        }
      }
    },
    [isEditMode, runContactPreviewImport, fixedCompany]
  );

  /**
   * 연락처 저장 후 명함 업로드:
   *  - customerCompanyId 있으면 → 등록폴더 / [고객사명]_[사업자번호] / business card
   *  - customerCompanyId null 이면 → 등록폴더 / [이름]_[연락처] / business card
   *  (customer-company-employees-detail-modal의 Drive 폴더 로직과 동일)
   */
  const performBusinessCardUpload = useCallback(async (empId, file, snapshot) => {
    const rootRes = await fetch(`${API_BASE}/custom-field-definitions/drive-root`, { headers: getAuthHeader() });
    const rootJson = await rootRes.json().catch(() => ({}));
    const driveRootUrl = rootJson.driveRootUrl != null ? String(rootJson.driveRootUrl).trim() : '';
    if (!driveRootUrl) {
      return { ok: false, error: '회사 공유 드라이브 경로를 먼저 설정해 주세요. (회사 개요 → 전체 공유 드라이브 주소)' };
    }
    const registeredFolderId = getDriveFolderIdFromLink(driveRootUrl);
    if (!registeredFolderId) {
      return { ok: false, error: '드라이브 경로 형식이 올바르지 않습니다.' };
    }

    const ccId = snapshot.customerCompanyId || null;
    let parentFolderName;
    let targetFolderId;

    if (ccId) {
      let ccName = snapshot.companyLabel || '';
      let ccBn = '';
      try {
        const ccRes = await fetch(`${API_BASE}/customer-companies/${ccId}`, { headers: getAuthHeader() });
        const cc = await ccRes.json().catch(() => ({}));
        if (ccRes.ok && cc._id) {
          ccName = cc.name || ccName;
          ccBn = cc.businessNumber || '';
        }
      } catch (_) {}
      const bnPart = String(ccBn || '').replace(/\D/g, '') || '미등록';
      parentFolderName = `${sanitizeFolderNamePart(ccName || '미소속', 80)}_${sanitizeFolderNamePart(bnPart, 20)}`;
    } else {
      parentFolderName = `${sanitizeFolderNamePart(snapshot.name || '이름없음', 80)}_${sanitizeFolderNamePart(snapshot.phone || snapshot.email || '미등록', 40)}`;
    }

    const ensureParent = await fetch(`${API_BASE}/drive/folders/ensure`, {
      method: 'POST',
      headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ folderName: parentFolderName, parentFolderId: registeredFolderId })
    });
    const parentData = await ensureParent.json().catch(() => ({}));
    if (!ensureParent.ok || !parentData.id) {
      return { ok: false, error: parentData.error || '폴더를 준비할 수 없습니다.' };
    }
    targetFolderId = parentData.id;

    const bcRes = await fetch(`${API_BASE}/drive/folders/ensure`, {
      method: 'POST',
      headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ folderName: 'business card', parentFolderId: targetFolderId })
    });
    const bcData = await bcRes.json().catch(() => ({}));
    if (!bcRes.ok || !bcData.id) {
      return { ok: false, error: bcData.error || 'business card 폴더를 준비할 수 없습니다.' };
    }

    const contentBase64 = await fileToBase64(file);
    if (!contentBase64) {
      return { ok: false, error: '파일 변환에 실패했습니다.' };
    }
    const uploadRes = await fetch(`${API_BASE}/drive/upload`, {
      method: 'POST',
      headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        name: buildBusinessCardDriveFileName(snapshot, file),
        mimeType: file.type || 'image/jpeg',
        contentBase64,
        parentFolderId: bcData.id
      })
    });
    const uploadData = await uploadRes.json().catch(() => ({}));
    if (!uploadRes.ok || !uploadData.webViewLink) {
      return { ok: false, error: uploadData.error || 'Drive 명함 업로드에 실패했습니다.' };
    }

    const patchRes = await fetch(`${API_BASE}/customer-company-employees/${empId}`, {
      method: 'PATCH',
      headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessCardDriveUrl: uploadData.webViewLink,
        driveRootFolderId: targetFolderId
      })
    });
    if (!patchRes.ok) {
      const pe = await patchRes.json().catch(() => ({}));
      return { ok: false, error: pe.error || '명함 Drive 링크 저장에 실패했습니다.' };
    }
    return { ok: true, businessCardDriveUrl: uploadData.webViewLink };
  }, []);

  const handleBulkImport = async (contacts) => {
    if (!contacts || contacts.length === 0) return;
    setBulkSaving(true);
    setBulkResult(null);
    setError('');
    const useFixedCompany = !!(initialCustomerCompany && initialCustomerCompany._id);
    const currentUserId = (() => { try { const u = JSON.parse(localStorage.getItem('crm_user') || '{}'); return u?._id ? String(u._id) : null; } catch (_) { return null; } })();
    let success = 0;
    let fail = 0;
    for (const c of contacts) {
      try {
        const gCompany = (c.company || '').trim();
        const payload = {
          name: String(c.name || '').replace(/\s/g, '').trim(),
          email: (c.email || '').trim(),
          phone: c.phone ? formatPhoneInput(c.phone).trim() : '',
          position: (c.title || '').trim(),
          companyName: useFixedCompany ? '' : gCompany,
          address: (useFixedCompany && initialCustomerCompany?.address)
            ? String(initialCustomerCompany.address).trim()
            : (c.address || '').trim(),
          birthDate: (c.birthday || '').trim(),
          memo: (c.biography || '').trim() || undefined,
          status: 'Lead',
          isIndividual: !useFixedCompany && !gCompany,
          assigneeUserIds: currentUserId ? [currentUserId] : []
        };
        if (useFixedCompany) payload.customerCompanyId = initialCustomerCompany._id;
        if (!useFixedCompany && gCompany) payload.customerCompanyId = null;
        if (!payload.name && !payload.email && !payload.phone) { fail++; continue; }
        const res = await fetch(`${API_BASE}/customer-company-employees`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
          body: JSON.stringify(payload)
        });
        if (res.ok) success++;
        else fail++;
      } catch (_) {
        fail++;
      }
    }
    setBulkSaving(false);
    setBulkResult({ success, fail, total: contacts.length });
    if (success > 0) onSaved?.();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const hasName = !!(form.name && form.name.trim());
    const hasEmail = !!(form.email && form.email.trim());
    const hasPhone = !!(form.phone && form.phone.trim());
    const hasContactBit = hasName || hasEmail || hasPhone;
    if (!hasContactBit) {
      setError('이름, 이메일, 전화번호 중 최소 한 가지는 입력해 주세요.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.replace(/\s/g, '').trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        position: (form.position || '').trim() || undefined,
        address: (form.address || '').trim() || undefined,
        birthDate: (form.birthDate || '').trim() || undefined,
        memo: (form.memo || '').trim() || undefined,
        status: isEditMode ? (form.status || 'Lead') : 'Lead'
      };
      if (isIndividual) {
        payload.isIndividual = true;
        payload.customerCompanyId = null;
        payload.companyName = '';
      } else {
        const companyId = String(form.customerCompanyId || '').trim();
        if (companyId) {
          payload.customerCompanyId = companyId;
          if ((form.company || '').trim()) payload.companyName = (form.company || '').trim();
        } else {
          payload.customerCompanyId = null;
          payload.companyName = (form.company || '').trim();
        }
      }
      if (form.customFields && Object.keys(form.customFields).length) payload.customFields = form.customFields;
      payload.assigneeUserIds = Array.isArray(form.assigneeUserIds) ? form.assigneeUserIds : [];

      const url = isEditMode ? `${API_BASE}/customer-company-employees/${contact._id || contact.id}` : `${API_BASE}/customer-company-employees`;
      const method = isEditMode ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409 && data.duplicateId) {
          setError(`동일한 이름·연락처가 이미 존재합니다: ${data.error || '중복된 연락처'}`);
        } else {
          setError(data.error || (isEditMode ? '수정에 실패했습니다.' : '저장에 실패했습니다.'));
        }
        return;
      }
      const empId = isEditMode ? (contact._id || contact.id) : (data._id || data.id);
      const snapshot = {
        name: form.name.replace(/\s/g, '').trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        customerCompanyId: form.customerCompanyId,
        isIndividual,
        companyLabel: form.company.trim()
      };
      let payloadOut = data;
      if (businessCardFile && empId) {
        const up = await performBusinessCardUpload(empId, businessCardFile, snapshot);
        if (!up.ok) {
          setError(
            `${isEditMode ? '연락처는 저장되었으나' : '연락처는 등록되었으나'} 명함 저장에 실패했습니다. ${up.error || ''}`.trim()
          );
          if (isEditMode) onUpdated?.(data);
          else onSaved?.();
          onClose?.();
          return;
        }
        payloadOut = { ...data, businessCardDriveUrl: up.businessCardDriveUrl };
      }
      if (isEditMode) {
        onUpdated?.(payloadOut);
        onClose?.();
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

  return (
    <div className={`add-contact-modal-overlay ${isEditMode ? 'add-contact-modal-overlay--slide' : ''}`}>
      <div className={`add-contact-modal ${isEditMode ? 'add-contact-modal--slide' : ''}`} onClick={(e) => e.stopPropagation()}>
        {showBulkGoogle && (
          <GoogleContactsModal
            mode="bulk"
            onBulkSelect={(contacts) => { setShowBulkGoogle(false); handleBulkImport(contacts); }}
            onClose={() => setShowBulkGoogle(false)}
          />
        )}
        <div className="add-contact-modal-header">
          <h3>{isEditMode ? '연락처 수정' : '새 연락처 추가'}</h3>
          <button type="button" className="add-contact-modal-close" onClick={onClose} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="add-contact-modal-form">
          <div className="add-contact-modal-body">
          {!isEditMode && (
            <>
              <button
                type="button"
                className="add-contact-google-import"
                onClick={() => setShowBulkGoogle(true)}
              >
                <img src="https://www.gstatic.com/images/branding/product/1x/contacts_2022_48dp.png" alt="" className="add-contact-google-icon" />
                Google 주소록에서 가져오기
              </button>
              {bulkSaving && (
                <div className="add-contact-bulk-progress">
                  <span className="material-symbols-outlined add-contact-bulk-spinner">sync</span>
                  대량 등록 중… 잠시 기다려 주세요.
                </div>
              )}
              {bulkResult && (
                <div className={`add-contact-bulk-result ${bulkResult.fail > 0 ? 'has-fail' : ''}`}>
                  <span className="material-symbols-outlined">{bulkResult.fail > 0 ? 'info' : 'check_circle'}</span>
                  총 {bulkResult.total}명 중 <strong>{bulkResult.success}명</strong> 등록 완료
                  {bulkResult.fail > 0 && <>, {bulkResult.fail}명 실패</>}
                  <button type="button" className="add-contact-bulk-dismiss" onClick={() => setBulkResult(null)}>×</button>
                </div>
              )}
            </>
          )}
          {isEditMode && bcDriveFolderId ? (
            <section className="customer-company-detail-section register-sale-docs" aria-label="명함 등록">
              <input
                ref={cardInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  e.target.value = '';
                  if (file) {
                    setBusinessCardFile(file);
                    extractFromBusinessCardAndFillForm(file);
                  }
                }}
                aria-hidden="true"
              />
              <div className="customer-company-detail-section-head">
                <h3 className="customer-company-detail-section-title">
                  <span className="material-symbols-outlined">folder</span>
                  명함
                </h3>
                <button
                  type="button"
                  className="customer-company-detail-btn-all"
                  onClick={() => { if (!extractingBusinessCard && cardInputRef.current) cardInputRef.current.click(); }}
                  disabled={extractingBusinessCard}
                  title="명함 교체"
                  aria-label="명함 교체"
                >
                  <span className="material-symbols-outlined">swap_horiz</span>
                </button>
              </div>
              {businessCardFile && (
                <div className="register-sale-docs-cert-pending">
                  <span className="material-symbols-outlined" style={{ fontSize: '1.1rem' }}>upload_file</span>
                  <span className="register-sale-docs-cert-pending-name">{businessCardFile.name}</span>
                  <button type="button" className="register-sale-docs-cert-pending-cancel" onClick={() => setBusinessCardFile(null)}>
                    <span className="material-symbols-outlined" style={{ fontSize: '1rem' }}>close</span>
                  </button>
                </div>
              )}
              <div
                className={`register-sale-docs-list-wrap ${businessCardDropActive ? 'register-sale-docs-dropzone-active' : ''}`}
                onDragOver={(ev) => { ev.preventDefault(); ev.stopPropagation(); setBusinessCardDropActive(true); }}
                onDragLeave={(ev) => { ev.preventDefault(); ev.stopPropagation(); setBusinessCardDropActive(false); }}
                onDrop={(ev) => {
                  ev.preventDefault();
                  ev.stopPropagation();
                  setBusinessCardDropActive(false);
                  const file = ev.dataTransfer?.files?.[0];
                  if (file) {
                    setBusinessCardFile(file);
                    extractFromBusinessCardAndFillForm(file);
                  }
                }}
                aria-label="Drive 폴더"
              >
                <div className="register-sale-docs-breadcrumb">
                  <button type="button" className="register-sale-docs-breadcrumb-btn" style={{ cursor: 'default' }}>
                    business card
                  </button>
                  <a
                    href={`https://drive.google.com/drive/folders/${bcDriveFolderId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="register-sale-docs-open-drive"
                    title="Drive에서 열기"
                  >
                    <span className="material-symbols-outlined">open_in_new</span>
                  </a>
                </div>
                {loadingBcFiles ? (
                  <p className="register-sale-docs-loading">목록 불러오는 중…</p>
                ) : bcDriveFiles.length === 0 ? (
                  <div
                    className={`register-sale-docs-dropzone register-sale-docs-dropzone-inline ${businessCardDropActive ? 'register-sale-docs-dropzone-active' : ''}`}
                    onClick={() => { if (!extractingBusinessCard && cardInputRef.current) cardInputRef.current.click(); }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(ev) => { if ((ev.key === 'Enter' || ev.key === ' ') && !extractingBusinessCard && cardInputRef.current) cardInputRef.current.click(); }}
                  >
                    <span className="material-symbols-outlined register-sale-docs-dropzone-icon">upload_file</span>
                    <span>비어 있음. 클릭하거나 파일을 놓아 추가</span>
                  </div>
                ) : (
                  <ul className="register-sale-docs-file-list">
                    {bcDriveFiles.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          className="register-sale-docs-file-row register-sale-docs-file-row--file"
                          onClick={() => {
                            const link = item.webViewLink || `https://drive.google.com/file/d/${item.id}/view`;
                            window.open(link, '_blank', 'noopener,noreferrer');
                          }}
                        >
                          <span className="material-symbols-outlined register-sale-docs-file-icon">description</span>
                          <span className="register-sale-docs-file-name">{item.name || '파일'}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {businessCardDropActive && (
                  <div className="register-sale-docs-embed-overlay">여기에 놓기</div>
                )}
              </div>
            </section>
          ) : (
            <section className="add-company-section" aria-label="명함 등록">
              <h3 className="add-company-section-title">명함 일괄</h3>
              <p className="add-company-upload-hint" style={{ marginBottom: '0.5rem' }}>
                아래 영역에 명함 이미지·TXT를 드래그 앤 드롭하거나 클릭하여 선택하세요. 여러 장 또는 TXT 한 개면 Gemini로 분류 후 표에서 확인하고 등록합니다. 이미지 한 장만 올리면 폼에 바로 채웁니다.
              </p>
              <input
                ref={cardInputRef}
                type="file"
                accept="image/*,.txt,text/plain"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => {
                  const list = e.target.files;
                  if (list?.length) processBusinessCardFileSelection(list);
                  e.target.value = '';
                }}
                aria-hidden="true"
              />
              <div
                className={`add-company-upload-zone ${businessCardDropActive ? 'add-company-upload-zone-active' : ''} ${extractingBusinessCard || importPreviewLoading ? 'add-company-upload-zone-disabled' : ''}`}
                onDragOver={(ev) => { ev.preventDefault(); ev.stopPropagation(); if (!extractingBusinessCard && !importPreviewLoading) setBusinessCardDropActive(true); }}
                onDragLeave={(ev) => { ev.preventDefault(); ev.stopPropagation(); setBusinessCardDropActive(false); }}
                onDrop={(ev) => {
                  ev.preventDefault();
                  ev.stopPropagation();
                  setBusinessCardDropActive(false);
                  if (ev.dataTransfer?.files?.length) {
                    processBusinessCardFileSelection(ev.dataTransfer.files);
                  }
                }}
                onClick={() => { if (!extractingBusinessCard && !importPreviewLoading && cardInputRef.current) cardInputRef.current.click(); }}
                role="button"
                tabIndex={0}
                onKeyDown={(ev) => {
                  if ((ev.key === 'Enter' || ev.key === ' ') && !extractingBusinessCard && !importPreviewLoading && cardInputRef.current) {
                    ev.preventDefault();
                    cardInputRef.current.click();
                  }
                }}
                aria-label="명함 이미지·TXT 첨부 (드래그 앤 드롭 또는 클릭)"
              >
                <div className="add-company-upload-icon-wrap">
                  <span className="material-symbols-outlined add-company-upload-icon">upload_file</span>
                </div>
                {extractingBusinessCard || importPreviewLoading ? (
                  <p className="add-company-upload-title">{importPreviewLoading ? '일괄 분석 중…' : '명함에서 정보를 읽는 중…'}</p>
                ) : businessCardFile ? (
                  <p className="add-company-upload-title add-company-upload-filename">{businessCardFile.name}</p>
                ) : (
                  <>
                    <p className="add-company-upload-title">파일을 드래그하거나 클릭하여 업로드하세요</p>
                    <p className="add-company-upload-hint">명함을 올리면 정보를 자동으로 입력합니다. 여러 장·TXT 파일은 미리보기 후 등록합니다. 저장 시 Google Drive business card 폴더에만 등록됩니다.</p>
                  </>
                )}
              </div>
            </section>
          )}
          {error && <p className="add-contact-modal-error">{error}</p>}
          <div className="add-contact-modal-field">
            <label htmlFor="add-contact-name">이름</label>
            <input
              id="add-contact-name"
              name="name"
              type="text"
              value={form.name}
              onChange={handleChange}
              placeholder="띄어쓰기 없이 예: 홍길동"
              autoComplete="name"
              disabled={isEditMode}
              title={isEditMode ? '수정 모드에서는 이름을 바꿀 수 없습니다.' : undefined}
            />
          </div>
          <div className="add-contact-modal-field add-contact-company-field">
            <label htmlFor="add-contact-company">고객사</label>
            {fixedCompany ? (
              <div className="add-contact-company-wrap">
                <span className="add-contact-company-display" title={isEditMode ? '수정 모드에서는 고객사를 바꿀 수 없습니다.' : undefined}>{form.company}</span>
              </div>
            ) : (
              <div className="add-contact-company-wrap">
                <input
                  id="add-contact-company"
                  name="company"
                  type="text"
                  className="add-contact-company-text-input"
                  value={form.company}
                  onChange={handleCompanyInputChange}
                  placeholder=""
                  autoComplete="organization"
                  aria-describedby="add-contact-company-hint"
                  disabled={isEditMode}
                  title={isEditMode ? '수정 모드에서는 고객사를 바꿀 수 없습니다.' : undefined}
                />
                <button
                  type="button"
                  className="add-contact-company-search"
                  title={isEditMode ? '수정 모드에서는 고객사를 바꿀 수 없습니다.' : '고객사 검색'}
                  onClick={() => setShowCompanySearchModal(true)}
                  disabled={isEditMode}
                >
                  <span className="material-symbols-outlined">search</span>
                  검색
                </button>
              </div>
            )}

          </div>
          {isEditMode && editModeCompanyBusinessNumber ? (
            <div className="add-contact-modal-field">
              <label htmlFor="add-contact-company-bn">사업자등록번호</label>
              <input
                id="add-contact-company-bn"
                type="text"
                readOnly
                disabled
                value={editModeCompanyBusinessNumber}
                className="add-contact-company-text-input"
                title="수정 모드에서는 사업자등록번호를 바꿀 수 없습니다."
              />
            </div>
          ) : null}
          <div className="add-contact-modal-row">
            <div className="add-contact-modal-field">
              <label htmlFor="add-contact-email">이메일</label>
              <input id="add-contact-email" name="email" type="email" value={form.email} onChange={handleChange} placeholder="example@company.com" />
            </div>
            <div className="add-contact-modal-field">
              <label htmlFor="add-contact-phone">전화번호</label>
              <input id="add-contact-phone" name="phone" type="tel" inputMode="numeric" autoComplete="tel" value={form.phone} onChange={handleChange} placeholder="010-0000-0000" maxLength={13} />
            </div>
          </div>
          <div className="add-contact-modal-field">
            <label htmlFor="add-contact-position">직책</label>
            <input id="add-contact-position" name="position" type="text" value={form.position} onChange={handleChange} placeholder="예: 과장, 팀장" />
          </div>
          <div className="add-contact-modal-field">
            <label htmlFor="add-contact-address">주소</label>
            <input id="add-contact-address" name="address" type="text" value={form.address} onChange={handleChange} placeholder="주소" />
          </div>
          <div className="add-contact-modal-field">
            <label htmlFor="add-contact-birthDate">생일</label>
            <input id="add-contact-birthDate" name="birthDate" type="text" value={form.birthDate} onChange={handleChange} placeholder="예: 1990-01-15 또는 01-15" />
          </div>
          <div className="add-contact-modal-field">
            <label htmlFor="add-contact-memo">메모</label>
            <textarea id="add-contact-memo" name="memo" value={form.memo} onChange={handleChange} placeholder="메모 (Google 연락처 소개 등)" rows={2} className="add-contact-memo-input" />
          </div>
          <div className="add-contact-modal-field add-contact-assignees-wrap">
            <label htmlFor="add-contact-assignee-input">담당자</label>
            <div className="add-contact-assignee-input-wrap">
              <input
                id="add-contact-assignee-input"
                type="text"
                readOnly
                className="add-contact-assignee-input"
                placeholder="검색 아이콘으로 담당자 선택"
                value={assigneeInputValue}
                aria-label="담당자 (검색으로만 수정 가능)"
              />
              <button
                type="button"
                className="add-contact-assignee-search-icon-btn"
                onClick={() => setShowAssigneePicker(true)}
                title="담당자 검색"
                aria-label="담당자 검색"
              >
                <span className="material-symbols-outlined">search</span>
              </button>
            </div>
          </div>
            <CustomFieldsSection
              definitions={customDefinitions}
              values={form.customFields || {}}
              onChangeValues={(key, value) => setForm((prev) => ({
                ...prev,
                customFields: { ...(prev.customFields || {}), [key]: value }
              }))}
              fieldClassName="add-contact-modal-field"
            />
          </div>
          <div className="add-contact-modal-footer">
            <div className="add-contact-modal-footer-actions">
              <button type="button" className="add-contact-modal-cancel" onClick={onClose}>취소</button>
              <button type="submit" className="add-contact-modal-save" disabled={saving || extractingBusinessCard || importPreviewLoading}>{saving ? '저장 중...' : isEditMode ? '저장' : '연락처 저장'}</button>
            </div>
          </div>
        </form>
        {showAssigneePicker && (
          <AssigneePickerModal
            open={showAssigneePicker}
            onClose={() => setShowAssigneePicker(false)}
            selectedIds={form.assigneeUserIds || []}
            onConfirm={(ids) => setForm((prev) => ({ ...prev, assigneeUserIds: ids }))}
          />
        )}
        {showCompanySearchModal && (
          <CustomerCompanySearchModal
            onClose={() => setShowCompanySearchModal(false)}
            onSelect={(company) => {
              setForm((prev) => ({ ...prev, company: company.name || '', customerCompanyId: company._id }));
              setShowCompanySearchModal(false);
            }}
          />
        )}
        <ContactImportPreviewModal
          open={showImportPreview}
          items={importPreviewItems}
          bulkSaving={importBulkSaving}
          fixedCompany={fixedCompany}
          onClose={() => !importBulkSaving && setShowImportPreview(false)}
          onConfirm={confirmBulkContactImport}
        />
      </div>
    </div>
  );
}
