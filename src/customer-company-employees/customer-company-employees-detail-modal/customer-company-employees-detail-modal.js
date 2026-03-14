import { useState, useEffect, useRef } from 'react';
import CustomFieldsDisplay from '../../shared/custom-fields-display';
import CustomFieldsSection from '../../shared/custom-fields-section';
import ProductSalesModal from '../../shared/product-sales-modal/product-sales-modal';
import RegisterSaleModal from '../../product-list/register-sale-modal/register-sale-modal';
import './customer-company-employees-detail-modal.css';

import { API_BASE } from '@/config';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function formatHistoryDate(d) {
  if (!d) return '';
  const date = new Date(d);
  return date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' }) + ' • ' + date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

/** 업무 기록 내용을 문단·문장 단위로 나눠서 렌더용 배열로 반환 */
function splitContentIntoBlocks(text) {
  if (!text || typeof text !== 'string') return [];
  const trimmed = text.trim();
  if (!trimmed) return [];
  const paragraphs = trimmed.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  return paragraphs.map((para) => {
    const sentences = para.split(/(?<=[.!?。？！])\s+/).map((s) => s.trim()).filter(Boolean);
    return sentences.length ? sentences : [para];
  });
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

const statusClass = { Active: 'status-active', Pending: 'status-pending', Lead: 'status-lead', Inactive: 'status-inactive' };
const statusLabel = { Active: '활성', Pending: '대기', Lead: '리드', Inactive: '비활성' };
const statusHint = {
  Lead: '아직 접촉만 한 잠재 고객',
  Active: '현재 거래 진행 중이거나 소통 중인 고객',
  Pending: '제안서 발송 또는 회신 대기 중',
  Inactive: '거래 종료 또는 더 이상 관리하지 않는 고객'
};
const STATUS_OPTIONS = ['Lead', 'Active', 'Pending', 'Inactive'];

function toDatetimeLocalValue(date) {
  if (!date) return '';
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day}T${h}:${min}`;
}

export default function ContactDetailModal({ contact, onClose, onUpdated }) {
  const [journalText, setJournalText] = useState('');
  const [journalDateTime, setJournalDateTime] = useState(() => toDatetimeLocalValue(new Date()));
  const [historyItems, setHistoryItems] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [savingNote, setSavingNote] = useState(false);
  const [error, setError] = useState('');

  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const [companyList, setCompanyList] = useState([]);
  const [companyDropdownOpen, setCompanyDropdownOpen] = useState(false);
  const [loadingCompanySearch, setLoadingCompanySearch] = useState(false);
  const companyWrapRef = useRef(null);
  const [customDefinitions, setCustomDefinitions] = useState([]);

  const [cardUploading, setCardUploading] = useState(false);
  const [cardDeleting, setCardDeleting] = useState(false);
  const [cardError, setCardError] = useState('');
  const cardInputRef = useRef(null);
  const [displayedContact, setDisplayedContact] = useState(contact);
  const [showCardImageModal, setShowCardImageModal] = useState(false);
  const [googleSaving, setGoogleSaving] = useState(false);
  const [googleResult, setGoogleResult] = useState(null);
  const [showProductSalesModal, setShowProductSalesModal] = useState(false);
  const [showRegisterSaleModal, setShowRegisterSaleModal] = useState(false);
  const [selectedSaleForEdit, setSelectedSaleForEdit] = useState(null);
  const [productSalesList, setProductSalesList] = useState([]);
  const [loadingProductSales, setLoadingProductSales] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/custom-field-definitions?entityType=contact`, { headers: getAuthHeader() });
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok && Array.isArray(data.items)) setCustomDefinitions(data.items);
      } catch (_) {}
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    function handleClickOutside(e) {
      if (companyWrapRef.current && !companyWrapRef.current.contains(e.target)) {
        setCompanyDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (showRegisterSaleModal) setShowRegisterSaleModal(false);
      else if (showProductSalesModal) setShowProductSalesModal(false);
      else if (showCardImageModal) setShowCardImageModal(false);
      else if (showDeleteConfirm) setShowDeleteConfirm(false);
      else if (editing) {
        setEditing(false);
        setEditForm({});
        setEditError('');
      } else onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, editing, showDeleteConfirm, showCardImageModal, showProductSalesModal, showRegisterSaleModal]);

  useEffect(() => {
    setDisplayedContact(contact);
  }, [contact]);

  if (!contact) return null;
  const contactToShow = displayedContact || contact;

  const status = contact.status || 'Lead';
  const displayStatus = statusLabel[status] || status;
  const contactId = contact._id;

  const fetchHistory = async () => {
    if (!contactId) return;
    setLoadingHistory(true);
    try {
      const res = await fetch(`${API_BASE}/customer-company-employees/${contactId}/history`, { headers: getAuthHeader() });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setHistoryItems(data.items || []);
      else setHistoryItems([]);
    } catch (_) {
      setHistoryItems([]);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, [contactId]);

  useEffect(() => {
    setJournalDateTime(toDatetimeLocalValue(new Date()));
  }, [contactId]);

  const companyIdForSales = contactToShow?.customerCompanyId?._id ?? contactToShow?.customerCompanyId ?? null;
  const companyNameForSales = contactToShow?.customerCompanyId?.name ?? contactToShow?.companyName ?? '';
  /** 고객사가 customer-companies에서 확인 가능(사업자 번호 있음)일 때만 소속으로 표시; 아니면 소속 없음으로 간주 */
  const hasConfirmedCompany = companyIdForSales && contactToShow?.customerCompanyId?.businessNumber && String(contactToShow.customerCompanyId.businessNumber).trim();

  const fetchProductSales = async () => {
    if (!contactId) {
      setProductSalesList([]);
      setLoadingProductSales(false);
      return;
    }
    setLoadingProductSales(true);
    try {
      const params = new URLSearchParams();
      params.set('customerCompanyEmployeeId', contactId);
      if (companyIdForSales) params.set('customerCompanyId', companyIdForSales);
      const res = await fetch(`${API_BASE}/sales-opportunities?${params}`, { headers: getAuthHeader() });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.grouped) {
        const flat = (Object.values(data.grouped) || []).flat();
        setProductSalesList(flat);
      } else {
        setProductSalesList([]);
      }
    } catch (_) {
      setProductSalesList([]);
    } finally {
      setLoadingProductSales(false);
    }
  };

  useEffect(() => {
    fetchProductSales();
  }, [contactId, companyIdForSales]);

  const handleSaveNote = async () => {
    const content = journalText.trim();
    if (!content) return;
    setError('');
    setSavingNote(true);
    try {
      const createdAt = journalDateTime ? new Date(journalDateTime).toISOString() : undefined;
      const res = await fetch(`${API_BASE}/customer-company-employees/${contactId}/history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ content, ...(createdAt && !Number.isNaN(new Date(journalDateTime).getTime()) ? { createdAt } : {}) })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setJournalText('');
        setJournalDateTime(toDatetimeLocalValue(new Date()));
        fetchHistory();
      } else {
        setError(data.error || '저장에 실패했습니다.');
      }
    } catch (_) {
      setError('서버에 연결할 수 없습니다.');
    } finally {
      setSavingNote(false);
    }
  };

  const handleDeleteHistory = async (historyId) => {
    if (!historyId) return;
    try {
      const res = await fetch(`${API_BASE}/customer-company-employees/${contactId}/history/${historyId}`, {
        method: 'DELETE',
        headers: getAuthHeader()
      });
      if (res.ok) fetchHistory();
    } catch (_) {}
  };

  const handleCardFileChange = async (e) => {
    const file = e.target?.files?.[0];
    e.target.value = '';
    if (!file || !contactId) return;
    if (!file.type.startsWith('image/')) {
      setCardError('이미지 파일만 업로드할 수 있습니다.');
      return;
    }
    setCardError('');
    setCardUploading(true);
    try {
      const formData = new FormData();
      formData.append('image', file);
      const res = await fetch(`${API_BASE}/customer-company-employees/${contactId}/business-card`, {
        method: 'POST',
        headers: getAuthHeader(),
        body: formData
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.businessCardImageUrl !== undefined) {
        const next = { ...contact, businessCardImageUrl: data.businessCardImageUrl };
        setDisplayedContact(next);
        onUpdated?.(next);
      } else {
        setCardError(data.error || '명함 사진 업로드에 실패했습니다.');
      }
    } catch (_) {
      setCardError('서버에 연결할 수 없습니다.');
    } finally {
      setCardUploading(false);
    }
  };

  const handleCardDelete = async () => {
    if (!contactId || !contact.businessCardImageUrl) return;
    if (!window.confirm('명함 사진을 삭제할까요?')) return;
    setCardError('');
    setCardDeleting(true);
    try {
      const res = await fetch(`${API_BASE}/customer-company-employees/${contactId}/business-card`, {
        method: 'DELETE',
        headers: getAuthHeader()
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const next = { ...contact, businessCardImageUrl: '', businessCardPublicId: '' };
        setDisplayedContact(next);
        onUpdated?.(next);
      } else {
        setCardError(data.error || '명함 사진 삭제에 실패했습니다.');
      }
    } catch (_) {
      setCardError('서버에 연결할 수 없습니다.');
    } finally {
      setCardDeleting(false);
    }
  };

  const handleAddToGoogleContacts = async () => {
    const c = displayedContact || contact;
    const companyName = c.customerCompanyId?.name ?? c.companyName ?? '';
    const payload = {
      name: (c.name || '').trim() || undefined,
      email: (c.email || '').trim() || undefined,
      phone: (c.phone || '').trim() || undefined,
      company: companyName.trim() || undefined
    };
    if (!payload.name && !payload.email && !payload.phone) {
      setGoogleResult({ error: '이름, 이메일, 연락처 중 하나 이상 필요합니다.' });
      return;
    }
    setGoogleResult(null);
    setGoogleSaving(true);
    try {
      const res = await fetch(`${API_BASE}/google-contacts/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ contacts: [payload] })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setGoogleResult({ error: data.error || '구글 주소록 등록에 실패했습니다.', needsReauth: data.needsReauth });
        return;
      }
      setGoogleResult({ success: data.success, fail: data.fail, total: data.total });
      if (data.success > 0) setTimeout(() => setGoogleResult(null), 3000);
    } catch (_) {
      setGoogleResult({ error: '서버에 연결할 수 없습니다.' });
    } finally {
      setGoogleSaving(false);
    }
  };

  const startEdit = () => {
    setEditForm({
      name: contact.name || '',
      email: contact.email || '',
      phone: contact.phone || '',
      position: contact.position || '',
      address: contact.address || '',
      birthDate: contact.birthDate || '',
      memo: contact.memo || '',
      company: contact.company || '',
      companyName: contact.companyName || '',
      customerCompanyId: contact.customerCompanyId || '',
      status: contact.status || 'Lead',
      isIndividual: contact.isIndividual || false,
      customFields: contact.customFields ? { ...contact.customFields } : {}
    });
    setEditError('');
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setEditError('');
  };

  const handleEditChange = (e) => {
    const { name, value } = e.target;
    if (name === 'phone') setEditForm((prev) => ({ ...prev, phone: formatPhoneInput(value) }));
    else setEditForm((prev) => ({ ...prev, [name]: value }));
    if (name === 'company') setEditForm((prev) => ({ ...prev, customerCompanyId: '' }));
    setEditError('');
  };

  const handleCompanySearch = async () => {
    setLoadingCompanySearch(true);
    setCompanyDropdownOpen(false);
    try {
      const res = await fetch(`${API_BASE}/customer-companies`, { headers: getAuthHeader() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setCompanyList([]); return; }
      const items = data.items || [];
      const searchTrim = (editForm.company || '').trim().toLowerCase();
      const filtered = searchTrim
        ? items.filter((c) => (c.name || '').toLowerCase().includes(searchTrim))
        : items;
      setCompanyList(filtered);
      setCompanyDropdownOpen(true);
    } catch (_) {
      setCompanyList([]);
    } finally {
      setLoadingCompanySearch(false);
    }
  };

  const handleCompanySelect = (cc) => {
    setEditForm((prev) => ({ ...prev, company: cc.name || '', customerCompanyId: cc._id }));
    setCompanyDropdownOpen(false);
  };

  const handleIndividualChange = (e) => {
    const checked = e.target.checked;
    setEditForm((prev) => ({
      ...prev,
      isIndividual: checked,
      ...(checked ? { company: '', customerCompanyId: '' } : {})
    }));
    setCompanyDropdownOpen(false);
  };

  const handleEditSubmit = async () => {
    setEditError('');
    const hasName = !!(editForm.name && editForm.name.trim());
    const hasEmail = !!(editForm.email && editForm.email.trim());
    const hasPhone = !!(editForm.phone && editForm.phone.trim());
    const hasCompany = !editForm.isIndividual && !!editForm.customerCompanyId;
    if (!hasCompany && !hasName && !hasEmail && !hasPhone) {
      setEditError('이름, 고객사, 이메일, 전화번호 중 최소한 하나는 기입이 되어야 합니다.');
      return;
    }
    if (!editForm.isIndividual && !editForm.customerCompanyId && (editForm.company || '').trim()) {
      setEditError('고객사를 검색에서 선택해 주세요.');
      return;
    }
    setEditSaving(true);
    try {
      const payload = {
        name: editForm.name.trim(),
        email: editForm.email.trim(),
        phone: editForm.phone.trim(),
        position: (editForm.position || '').trim() || undefined,
        address: (editForm.address || '').trim() || undefined,
        birthDate: (editForm.birthDate || '').trim() || undefined,
        memo: (editForm.memo || '').trim() || undefined,
        status: editForm.status
      };
      if (editForm.isIndividual) {
        payload.isIndividual = true;
        payload.customerCompanyId = null;
      } else if (editForm.customerCompanyId) {
        payload.customerCompanyId = editForm.customerCompanyId;
        payload.isIndividual = false;
      }
      if (editForm.companyName !== undefined) payload.companyName = (editForm.companyName || '').trim() || undefined;
      if (editForm.customFields && Object.keys(editForm.customFields).length) {
        payload.customFields = editForm.customFields;
      }
      const res = await fetch(`${API_BASE}/customer-company-employees/${contactId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setEditError(data.error || '수정에 실패했습니다.');
        return;
      }
      setEditing(false);
      onUpdated?.();
    } catch (_) {
      setEditError('서버에 연결할 수 없습니다.');
    } finally {
      setEditSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`${API_BASE}/customer-company-employees/${contactId}`, {
        method: 'DELETE',
        headers: getAuthHeader()
      });
      if (res.ok) {
        onUpdated?.();
        onClose?.();
      } else {
        const data = await res.json().catch(() => ({}));
        setEditError(data.error || '삭제에 실패했습니다.');
        setShowDeleteConfirm(false);
      }
    } catch (_) {
      setEditError('서버에 연결할 수 없습니다.');
      setShowDeleteConfirm(false);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <div className="contact-detail-overlay" aria-hidden="true" />
      <div className="contact-detail-panel">
        <div className="contact-detail-inner">
          <header className="contact-detail-header">
            <div className="contact-detail-header-title">
              <span className="material-symbols-outlined">account_circle</span>
              <h2>{editing ? '연락처 수정' : '연락처 세부정보'}</h2>
            </div>
            <div className="contact-detail-header-actions">
              {!editing && (
                <>
                  <button
                    type="button"
                    className="contact-detail-icon-btn contact-detail-google-btn"
                    onClick={handleAddToGoogleContacts}
                    disabled={googleSaving}
                    title="구글 주소록에 등록"
                    aria-label="구글 주소록에 등록"
                  >
                    <img src="https://www.gstatic.com/images/branding/product/1x/contacts_2022_48dp.png" alt="" className="contact-detail-google-icon" />
                  </button>
                  <button type="button" className="contact-detail-icon-btn" onClick={startEdit} title="수정">
                    <span className="material-symbols-outlined">edit</span>
                  </button>
                  <button type="button" className="contact-detail-icon-btn contact-detail-delete-btn" onClick={() => setShowDeleteConfirm(true)} title="삭제">
                    <span className="material-symbols-outlined">delete</span>
                  </button>
                </>
              )}
              <button type="button" className="contact-detail-icon-btn" onClick={editing ? cancelEdit : onClose} aria-label={editing ? '수정 취소' : '닫기'}>
                <span className="material-symbols-outlined">{editing ? 'undo' : 'close'}</span>
              </button>
            </div>
          </header>

          {googleResult && (
            <div className={`contact-detail-google-result ${googleResult.error ? 'error' : 'ok'}`}>
              <span className="material-symbols-outlined">{googleResult.error ? 'error' : 'check_circle'}</span>
              <span>
                {googleResult.error
                  ? <>{googleResult.error}{googleResult.needsReauth && ' (Google 계정으로 재로그인 필요)'}</>
                  : `구글 주소록에 등록되었습니다.`}
              </span>
              <button type="button" className="contact-detail-google-result-dismiss" onClick={() => setGoogleResult(null)} aria-label="닫기">×</button>
            </div>
          )}

          {/* 삭제 확인 */}
          {showDeleteConfirm && (
            <div className="contact-detail-delete-confirm">
              <span className="material-symbols-outlined">warning</span>
              <p>이 연락처를 삭제하시겠습니까?<br />삭제하면 업무 기록도 함께 삭제됩니다.</p>
              <div className="contact-detail-delete-confirm-btns">
                <button type="button" className="contact-detail-confirm-cancel" onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>취소</button>
                <button type="button" className="contact-detail-confirm-delete" onClick={handleDelete} disabled={deleting}>
                  {deleting ? '삭제 중...' : '삭제'}
                </button>
              </div>
            </div>
          )}

          <div className="contact-detail-body">
            {editing ? (
              /* ── 수정 모드 ── */
              <div className="contact-detail-edit-form">
                {editError && <p className="contact-detail-edit-error">{editError}</p>}

                <div className="contact-detail-edit-field">
                  <label>이름</label>
                  <input name="name" type="text" value={editForm.name} onChange={handleEditChange} placeholder="예: 홍길동" />
                </div>

                <div className="contact-detail-edit-field contact-detail-edit-company-field" ref={companyWrapRef}>
                  <label>고객사</label>
                  <div className="contact-detail-edit-company-wrap">
                    <input
                      name="company"
                      type="text"
                      value={editForm.company}
                      onChange={handleEditChange}
                      placeholder={editForm.isIndividual ? '개인 선택 시 미등록' : '고객사명 입력 후 검색'}
                      disabled={editForm.isIndividual}
                    />
                    <button type="button" className="contact-detail-edit-company-search" onClick={handleCompanySearch} disabled={loadingCompanySearch || editForm.isIndividual}>
                      <span className="material-symbols-outlined">search</span>
                      <span>{loadingCompanySearch ? '검색 중...' : '검색'}</span>
                    </button>
                  </div>
                  <label className="contact-detail-edit-checkbox">
                    <input type="checkbox" checked={editForm.isIndividual} onChange={handleIndividualChange} />
                    <span>개인 (고객사 없이 연락처만 등록)</span>
                  </label>
                  {companyDropdownOpen && !editForm.isIndividual && (
                    <ul className="contact-detail-edit-company-dropdown">
                      {companyList.length === 0 ? (
                        <li className="contact-detail-edit-dropdown-empty">검색 조건에 맞는 고객사가 없습니다.</li>
                      ) : (
                        companyList.map((c) => (
                          <li key={c._id} className="contact-detail-edit-dropdown-item" onMouseDown={() => handleCompanySelect(c)}>
                            <span className="material-symbols-outlined">business</span>
                            <div className="contact-detail-edit-dropdown-item-content">
                              <span className="contact-detail-edit-dropdown-item-name">{c.name}</span>
                              {(c.representativeName || c.businessNumber) && (
                                <span className="contact-detail-edit-dropdown-item-sub">
                                  {[c.representativeName, c.businessNumber].filter(Boolean).join(' · ')}
                                </span>
                              )}
                            </div>
                          </li>
                        ))
                      )}
                    </ul>
                  )}
                </div>

                <div className="contact-detail-edit-row">
                  <div className="contact-detail-edit-field">
                    <label>이메일</label>
                    <input name="email" type="email" value={editForm.email} onChange={handleEditChange} placeholder="example@company.com" />
                  </div>
                  <div className="contact-detail-edit-field">
                    <label>전화번호</label>
                    <input name="phone" type="tel" inputMode="numeric" value={editForm.phone} onChange={handleEditChange} placeholder="010-0000-0000" maxLength={13} />
                  </div>
                </div>

                <div className="contact-detail-edit-field">
                  <label>직책</label>
                  <input name="position" type="text" value={editForm.position} onChange={handleEditChange} placeholder="예: 과장, 팀장" />
                </div>
                <div className="contact-detail-edit-field">
                  <label>주소</label>
                  <input name="address" type="text" value={editForm.address} onChange={handleEditChange} placeholder="주소" />
                </div>
                <div className="contact-detail-edit-field">
                  <label>생일</label>
                  <input name="birthDate" type="text" value={editForm.birthDate} onChange={handleEditChange} placeholder="예: 1990-01-15" />
                </div>
                <div className="contact-detail-edit-field">
                  <label>메모</label>
                  <textarea name="memo" value={editForm.memo} onChange={handleEditChange} placeholder="메모" rows={2} />
                </div>

                <div className="contact-detail-edit-field">
                  <label>상태</label>
                  <select name="status" value={editForm.status} onChange={handleEditChange}>
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>{statusLabel[s]}</option>
                    ))}
                  </select>
                  <p className="contact-detail-edit-status-hint">
                    <span className="material-symbols-outlined">info</span>
                    {statusHint[editForm.status]}
                  </p>
                </div>

                <CustomFieldsSection
                  definitions={customDefinitions}
                  values={editForm.customFields || {}}
                  onChangeValues={(key, value) => setEditForm((prev) => ({
                    ...prev,
                    customFields: { ...(prev.customFields || {}), [key]: value }
                  }))}
                  fieldClassName="contact-detail-edit-field"
                />

                <div className="contact-detail-edit-footer">
                  <button type="button" className="contact-detail-edit-cancel" onClick={cancelEdit}>취소</button>
                  <button type="button" className="contact-detail-edit-save" disabled={editSaving} onClick={handleEditSubmit}>
                    {editSaving ? '저장 중...' : '저장'}
                  </button>
                </div>
              </div>
            ) : (
              /* ── 조회 모드: 고객사 상세와 동일한 한 장 카드 + 메타 리스트 구조 ── */
              <>
                <section className="contact-detail-main-card customer-company-detail-card">
                  <div className="contact-detail-main-logo customer-company-detail-logo">
                    <div
                      className={`contact-detail-avatar-in-card ${contactToShow.businessCardImageUrl ? 'contact-detail-avatar-clickable' : ''}`}
                      role={contactToShow.businessCardImageUrl ? 'button' : undefined}
                      tabIndex={contactToShow.businessCardImageUrl ? 0 : undefined}
                      aria-label={contactToShow.businessCardImageUrl ? '명함 이미지 크게 보기' : undefined}
                      onClick={() => contactToShow.businessCardImageUrl && setShowCardImageModal(true)}
                      onKeyDown={(e) => {
                        if (!contactToShow.businessCardImageUrl) return;
                        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowCardImageModal(true); }
                      }}
                    >
                      {contactToShow.businessCardImageUrl ? (
                        <img src={contactToShow.businessCardImageUrl} alt="" className="contact-detail-avatar-img" />
                      ) : (
                        <span className="material-symbols-outlined">contact_page</span>
                      )}
                    </div>
                    <div className="contact-detail-card-actions contact-detail-card-actions-in-card">
                      <input
                        ref={cardInputRef}
                        type="file"
                        accept="image/*"
                        className="contact-detail-card-input"
                        onChange={handleCardFileChange}
                        aria-label="명함 사진 선택"
                      />
                      {!contactToShow.businessCardImageUrl && (
                        <button type="button" className="contact-detail-card-btn" onClick={() => cardInputRef.current?.click()} disabled={cardUploading} title="명함 사진 추가" aria-label="명함 사진 추가">
                          <span className="material-symbols-outlined">add_photo_alternate</span>
                        </button>
                      )}
                      {contactToShow.businessCardImageUrl && (
                        <>
                          <button type="button" className="contact-detail-card-btn" onClick={() => cardInputRef.current?.click()} disabled={cardUploading} title="명함 사진 수정" aria-label="명함 사진 수정">
                            <span className="material-symbols-outlined">edit</span>
                          </button>
                          <button type="button" className="contact-detail-card-btn contact-detail-card-btn-danger" onClick={handleCardDelete} disabled={cardDeleting} title="명함 사진 삭제" aria-label="명함 사진 삭제">
                            <span className="material-symbols-outlined">delete</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="customer-company-detail-info">
                    {cardError && <p className="contact-detail-card-error">{cardError}</p>}
                    <div className="customer-company-detail-name-row">
                      <h1 className="customer-company-detail-name contact-detail-name-in-card">{contactToShow.name || '—'}</h1>
                      <span className={`contact-detail-status-badge ${statusClass[status] || ''}`}>{displayStatus}</span>
                    </div>
                    <div className="customer-company-detail-meta">
                      {(contact.company || contact.companyName) && (
                        <div className="customer-company-detail-meta-item">
                          <span className="material-symbols-outlined">business</span>
                          <span>{contact.company || contact.companyName}</span>
                        </div>
                      )}
                      {contact.email && (
                        <div className="customer-company-detail-meta-item">
                          <span className="material-symbols-outlined">mail</span>
                          <span>{contact.email}</span>
                        </div>
                      )}
                      {contact.phone && (
                        <div className="customer-company-detail-meta-item">
                          <span className="material-symbols-outlined">call</span>
                          <span>{contact.phone}</span>
                        </div>
                      )}
                      {contact.position && (
                        <div className="customer-company-detail-meta-item">
                          <span className="material-symbols-outlined">badge</span>
                          <span>{contact.position}</span>
                        </div>
                      )}
                      {contact.address && (
                        <div className="customer-company-detail-meta-item full">
                          <span className="material-symbols-outlined">location_on</span>
                          <span>{contact.address}</span>
                        </div>
                      )}
                      {contact.birthDate && (
                        <div className="customer-company-detail-meta-item">
                          <span className="material-symbols-outlined">cake</span>
                          <span>{contact.birthDate}</span>
                        </div>
                      )}
                      {contact.memo && (
                        <div className="customer-company-detail-meta-item full contact-detail-meta-memo">
                          <span className="material-symbols-outlined">note</span>
                          <span className="contact-detail-memo-value">{contact.memo}</span>
                        </div>
                      )}
                      {!contact.company && !contact.companyName && !contact.email && !contact.phone && !contact.position && !contact.address && !contact.birthDate && !contact.memo && (
                        <div className="customer-company-detail-meta-item">
                          <span className="material-symbols-outlined">info</span>
                          <span>등록된 연락처 정보가 없습니다.</span>
                        </div>
                      )}
                    </div>
                  </div>
                </section>

                <CustomFieldsDisplay
                  definitions={customDefinitions}
                  values={contact.customFields || {}}
                  className="contact-detail-custom-fields"
                />

                {/* 제품 판매 현황 - customer-company-detail-modal (368-403)과 동일 구조·디자인·로직 */}
                <section className="customer-company-detail-section">
                  <div className="customer-company-detail-section-head">
                    <h3 className="customer-company-detail-section-title">
                      <span className="material-symbols-outlined">inventory_2</span>
                      제품 판매 현황
                    </h3>
                    {!loadingProductSales && (
                      <button
                        type="button"
                        className="customer-company-detail-btn-all"
                        onClick={() => setShowProductSalesModal(true)}
                      >
                        전체 보기
                        <span className="material-symbols-outlined">arrow_forward</span>
                      </button>
                    )}
                  </div>
                  {loadingProductSales ? (
                    <p className="customer-company-detail-employees-empty">불러오는 중...</p>
                  ) : productSalesList.length === 0 ? (
                    <p className="customer-company-detail-employees-empty">이 고객사에 대한 제품 판매 기회가 없습니다.</p>
                  ) : (
                    <div className="customer-company-detail-product-sales-preview">
                      <ul className="customer-company-detail-product-sales-preview-list">
                        {productSalesList.slice(0, 3).map((row) => (
                          <li key={row._id} className="customer-company-detail-product-sales-preview-item">
                            <span className="customer-company-detail-product-sales-preview-product">
                              {row.productName || '—'}
                            </span>
                            <span className="customer-company-detail-product-sales-preview-title">{row.title || '—'}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </section>

                <section className="contact-detail-section">
                  <div className="contact-detail-section-head">
                    <h3>업무 기록</h3>
                    <span className="contact-detail-section-badge">{historyItems.length}건</span>
                  </div>
                  <div className="contact-detail-journal-input-wrap">
                    {error && <p className="contact-detail-journal-error">{error}</p>}
                    <div className="contact-detail-journal-datetime-row">
                      <label htmlFor="contact-detail-journal-datetime" className="contact-detail-journal-datetime-label">등록일시</label>
                      <input
                        id="contact-detail-journal-datetime"
                        type="datetime-local"
                        className="contact-detail-journal-datetime"
                        value={journalDateTime}
                        onChange={(e) => setJournalDateTime(e.target.value)}
                        aria-label="업무 기록 등록일시"
                      />
                    </div>
                    <textarea
                      className="contact-detail-journal-input"
                      placeholder="새 메모 또는 기록을 입력하세요..."
                      rows={3}
                      value={journalText}
                      onChange={(e) => setJournalText(e.target.value)}
                    />
                    <div className="contact-detail-journal-actions">
                      <button
                        type="button"
                        className="contact-detail-save-note-btn"
                        disabled={savingNote || !journalText.trim()}
                        onClick={handleSaveNote}
                      >
                        {savingNote ? '저장 중...' : '메모 저장'}
                      </button>
                    </div>
                  </div>
                  <div className="contact-detail-timeline">
                    {loadingHistory ? (
                      <p className="contact-detail-timeline-empty">불러오는 중...</p>
                    ) : historyItems.length === 0 ? (
                      <p className="contact-detail-timeline-empty">등록된 업무 기록이 없습니다.</p>
                    ) : (
                      historyItems.map((entry) => (
                        <div key={entry._id} className="contact-detail-timeline-item">
                          <div className="contact-detail-timeline-icon">
                            <span className="material-symbols-outlined">history_edu</span>
                          </div>
                          <div className="contact-detail-timeline-content">
                            <div className="contact-detail-timeline-meta">
                              <span className="contact-detail-timeline-user">
                                {(entry.createdByCurrentName !== undefined ? entry.createdByCurrentName : entry.createdByName) || '—'}
                                {(entry.createdByCurrentContact !== undefined ? entry.createdByCurrentContact : entry.createdByContact) && ` · ${entry.createdByCurrentContact !== undefined ? entry.createdByCurrentContact : entry.createdByContact}`}
                                {entry.createdByChanged && <span className="contact-detail-timeline-changed"> 변경됨</span>}
                              </span>
                              <time>{formatHistoryDate(entry.createdAt)}</time>
                              <button
                                type="button"
                                className="contact-detail-timeline-delete"
                                onClick={() => handleDeleteHistory(entry._id)}
                                aria-label="삭제"
                              >
                                <span className="material-symbols-outlined">delete</span>
                              </button>
                            </div>
                            <div className="contact-detail-timeline-text-wrap">
                              {splitContentIntoBlocks(entry.content).map((paragraphSentences, pIdx) => (
                                <p key={pIdx} className="contact-detail-timeline-paragraph">
                                  {paragraphSentences.map((sentence, sIdx) => (
                                    <span key={sIdx} className="contact-detail-timeline-sentence">{sentence}{sIdx < paragraphSentences.length - 1 ? ' ' : ''}</span>
                                  ))}
                                </p>
                              ))}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </section>
              </>
            )}
          </div>
        </div>
      </div>

      {showProductSalesModal && (
        <ProductSalesModal
          companyName={companyNameForSales}
          companyId={companyIdForSales}
          items={productSalesList}
          onClose={() => setShowProductSalesModal(false)}
          onAddSale={() => { setShowProductSalesModal(false); setShowRegisterSaleModal(true); }}
          onSelectItem={(row) => { setShowProductSalesModal(false); setSelectedSaleForEdit(row); }}
        />
      )}
      {selectedSaleForEdit && (
        <RegisterSaleModal
          saleId={selectedSaleForEdit._id}
          initialContact={{
            _id: contactId,
            name: contactToShow?.name,
            ...(hasConfirmedCompany
              ? {
                  customerCompanyId: companyIdForSales,
                  customerCompanyName: companyNameForSales,
                  customerCompanyBusinessNumber: contactToShow?.customerCompanyId?.businessNumber
                }
              : {})
          }}
          onClose={() => setSelectedSaleForEdit(null)}
          onSaved={() => { setSelectedSaleForEdit(null); fetchProductSales(); }}
        />
      )}
      {showRegisterSaleModal && (
        <RegisterSaleModal
          initialContact={{
            _id: contactId,
            name: contactToShow?.name,
            ...(hasConfirmedCompany
              ? {
                  customerCompanyId: companyIdForSales,
                  customerCompanyName: companyNameForSales,
                  customerCompanyBusinessNumber: contactToShow?.customerCompanyId?.businessNumber
                }
              : {})
          }}
          onClose={() => setShowRegisterSaleModal(false)}
          onSaved={() => { setShowRegisterSaleModal(false); fetchProductSales(); }}
        />
      )}

      {showCardImageModal && contactToShow.businessCardImageUrl && (
        <div
          className="contact-detail-card-image-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="명함 이미지 미리보기"
          onClick={() => setShowCardImageModal(false)}
        >
          <div className="contact-detail-card-image-content" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="contact-detail-card-image-close"
              onClick={() => setShowCardImageModal(false)}
              aria-label="닫기"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
            <img src={contactToShow.businessCardImageUrl} alt="명함" className="contact-detail-card-image-img" />
          </div>
        </div>
      )}
    </>
  );
}
