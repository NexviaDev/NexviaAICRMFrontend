import { useState, useEffect, useCallback, useRef } from 'react';
import AllEmployeesModal from './all-employees-modal/all-employees-modal';
import AllHistoryModal from './all-history-modal/all-history-modal';
import ProductSalesModal from '../../shared/product-sales-modal/product-sales-modal';
import RegisterSaleModal from '../../product-list/register-sale-modal/register-sale-modal';
import ContactDetailModal from '../../customer-company-employees/customer-company-employees-detail-modal/customer-company-employees-detail-modal';
import AddCompanyModal from '../add-company-modal/add-company-modal';
import CustomFieldsDisplay from '../../shared/custom-fields-display';
import './customer-company-detail-modal.css';

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

function formatBusinessNumber(num) {
  if (!num) return '—';
  const s = String(num).replace(/\D/g, '');
  if (s.length <= 3) return s;
  if (s.length <= 5) return `${s.slice(0, 3)}-${s.slice(3)}`;
  return `${s.slice(0, 3)}-${s.slice(3, 5)}-${s.slice(5, 10)}`;
}

const STATUS_LABEL = { active: '활성', inactive: '비활성', lead: '리드' };

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

/** 고객사 세부정보 모달 - customer-companies-detail.html 기반 */
export default function CustomerCompanyDetailModal({ company, onClose, onUpdated, onDeleted }) {
  const [historyItems, setHistoryItems] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [journalText, setJournalText] = useState('');
  const [journalDateTime, setJournalDateTime] = useState(() => toDatetimeLocalValue(new Date()));
  const [savingNote, setSavingNote] = useState(false);
  const [journalError, setJournalError] = useState('');
  const [employees, setEmployees] = useState([]);
  const [loadingEmployees, setLoadingEmployees] = useState(true);
  const [showAllEmployeesModal, setShowAllEmployeesModal] = useState(false);
  const [showAllHistoryModal, setShowAllHistoryModal] = useState(false);
  const [showProductSalesModal, setShowProductSalesModal] = useState(false);
  const [showRegisterSaleModal, setShowRegisterSaleModal] = useState(false);
  const [selectedSaleForEdit, setSelectedSaleForEdit] = useState(null);
  const [productSalesList, setProductSalesList] = useState([]);
  const [loadingProductSales, setLoadingProductSales] = useState(true);
  const [contactForDetailModal, setContactForDetailModal] = useState(null);
  const [customDefinitions, setCustomDefinitions] = useState([]);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [driveFolderLink, setDriveFolderLink] = useState('');
  const [driveFolderId, setDriveFolderId] = useState(null);
  const [driveUploading, setDriveUploading] = useState(false);
  const [driveError, setDriveError] = useState('');
  const [docsDropActive, setDocsDropActive] = useState(false);
  const [dragInModal, setDragInModal] = useState(false);
  const [driveEmbedKey, setDriveEmbedKey] = useState(0);
  const fileInputRef = useRef(null);
  const modalContentRef = useRef(null);

  const companyId = company?._id;

  const driveFolderName = (() => {
    if (!company) return '미소속_미등록';
    const namePart = sanitizeFolderNamePart(company.name || '미소속');
    const numPart = sanitizeFolderNamePart(company.businessNumber != null ? String(company.businessNumber) : '') || '미등록';
    return `${namePart}_${numPart}`;
  })();

  const fetchCustomDefinitions = async () => {
    try {
      const res = await fetch(`${API_BASE}/custom-field-definitions?entityType=customerCompany`, { headers: getAuthHeader() });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.items)) setCustomDefinitions(data.items);
    } catch (_) {}
  };

  useEffect(() => {
    fetchCustomDefinitions();
  }, [companyId]);

  useEffect(() => {
    if (!companyId || !driveFolderName) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/drive/folders/ensure`, {
          method: 'POST',
          headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ folderName: driveFolderName })
        });
        const data = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (r.ok && data.id) {
          const folderLink = data.webViewLink || `https://drive.google.com/drive/folders/${data.id}`;
          setDriveFolderId(data.id);
          setDriveFolderLink(folderLink);
        }
      } catch (_) {}
    })();
    return () => { cancelled = true; };
  }, [companyId, driveFolderName]);

  const handleDirectFileUpload = useCallback(
    async (files) => {
      const filesArray = Array.from(files || []);
      if (!filesArray.length) return;
      setDriveUploading(true);
      setDriveError('');
      try {
        let parentId = driveFolderId;
        if (!parentId) {
          const r = await fetch(`${API_BASE}/drive/folders/ensure`, {
            method: 'POST',
            headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ folderName: driveFolderName })
          });
          const data = await r.json().catch(() => ({}));
          if (!r.ok) {
            setDriveError(data.error || '폴더를 준비할 수 없습니다.');
            setDriveUploading(false);
            return;
          }
          parentId = data.id;
          const folderLink = data.webViewLink || `https://drive.google.com/drive/folders/${parentId}`;
          setDriveFolderId(parentId);
          setDriveFolderLink(folderLink);
        }
        const uploadOne = async (file) => {
          const contentBase64 = await fileToBase64(file);
          if (!contentBase64) {
            setDriveError((e) => (e ? e : `"${file.name}" 변환 실패`));
            return;
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
          if (!up.ok) setDriveError((e) => (e ? e : (upData.error || '업로드 실패')));
        };
        await Promise.all(filesArray.map((file) => uploadOne(file)));
      } catch (_) {
        setDriveError('Drive에 연결할 수 없습니다.');
      } finally {
        setDriveUploading(false);
        setDriveEmbedKey((k) => k + 1);
      }
    },
    [driveFolderName, driveFolderId]
  );

  if (!company) return null;

  /** 지원 업무기록 기준 가장 최근 한 명의 직원 정보 */
  const latestEmployeeByHistory =
    historyItems.length > 0 && employees.length > 0
      ? employees.find((e) => String(e._id) === String(historyItems[0].customerCompanyEmployeeId)) || null
      : null;

  const status = (company.status || 'active').toLowerCase();
  const displayStatus = STATUS_LABEL[status] || company.status || '활성';

  const fetchHistory = async () => {
    if (!companyId) return;
    setLoadingHistory(true);
    try {
      const res = await fetch(`${API_BASE}/customer-companies/${companyId}/history`, { headers: getAuthHeader() });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setHistoryItems(data.items || []);
      else setHistoryItems([]);
    } catch (_) {
      setHistoryItems([]);
    } finally {
      setLoadingHistory(false);
    }
  };

  const fetchEmployees = async () => {
    if (!companyId) return;
    setLoadingEmployees(true);
    try {
      const res = await fetch(`${API_BASE}/customer-company-employees?customerCompanyId=${companyId}&limit=100`, { headers: getAuthHeader() });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setEmployees(data.items || []);
      else setEmployees([]);
    } catch (_) {
      setEmployees([]);
    } finally {
      setLoadingEmployees(false);
    }
  };

  const fetchProductSales = async () => {
    if (!companyId) return;
    setLoadingProductSales(true);
    try {
      const res = await fetch(`${API_BASE}/sales-opportunities?customerCompanyId=${companyId}`, { headers: getAuthHeader() });
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
    fetchHistory();
    fetchEmployees();
    fetchProductSales();
  }, [companyId]);

  useEffect(() => {
    setJournalDateTime(toDatetimeLocalValue(new Date()));
  }, [companyId]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (showDeleteConfirm) setShowDeleteConfirm(false);
      else if (contactForDetailModal) setContactForDetailModal(null);
      else if (showEditModal) setShowEditModal(false);
      else if (showAllHistoryModal) setShowAllHistoryModal(false);
      else if (showAllEmployeesModal) setShowAllEmployeesModal(false);
      else if (showRegisterSaleModal) setShowRegisterSaleModal(false);
      else if (showProductSalesModal) setShowProductSalesModal(false);
      else onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, showDeleteConfirm, contactForDetailModal, showEditModal, showAllHistoryModal, showAllEmployeesModal, showProductSalesModal, showRegisterSaleModal]);

  const handleDeleteHistory = async (historyId) => {
    if (!historyId) return;
    try {
      const res = await fetch(`${API_BASE}/customer-companies/${companyId}/history/${historyId}`, {
        method: 'DELETE',
        headers: getAuthHeader()
      });
      if (res.ok) fetchHistory();
    } catch (_) {}
  };

  const handleSaveNote = async () => {
    const content = journalText.trim();
    if (!content) return;
    setJournalError('');
    setSavingNote(true);
    try {
      const createdAt = journalDateTime && !Number.isNaN(new Date(journalDateTime).getTime())
        ? new Date(journalDateTime).toISOString()
        : undefined;
      const res = await fetch(`${API_BASE}/customer-companies/${companyId}/history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ content, ...(createdAt ? { createdAt } : {}) })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setJournalText('');
        setJournalDateTime(toDatetimeLocalValue(new Date()));
        fetchHistory();
      } else {
        setJournalError(data.error || '저장에 실패했습니다.');
      }
    } catch (_) {
      setJournalError('서버에 연결할 수 없습니다.');
    } finally {
      setSavingNote(false);
    }
  };

  const handleDeleteCompany = async () => {
    if (!companyId) return;
    setDeleting(true);
    try {
      const res = await fetch(`${API_BASE}/customer-companies/${companyId}`, {
        method: 'DELETE',
        headers: getAuthHeader()
      });
      if (res.ok) {
        onDeleted?.();
        onClose?.();
      } else {
        const data = await res.json().catch(() => ({}));
        setShowDeleteConfirm(false);
        window.alert(data.error || '삭제에 실패했습니다.');
      }
    } catch (_) {
      setShowDeleteConfirm(false);
      window.alert('서버에 연결할 수 없습니다.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <div className="customer-company-detail-overlay" aria-hidden="true" />
      <div
        ref={modalContentRef}
        className="customer-company-detail-panel"
        onDragEnter={(e) => { e.preventDefault(); setDragInModal(true); }}
        onDragLeave={(e) => { if (!modalContentRef.current?.contains(e.relatedTarget)) setDragInModal(false); }}
      >
        <div className="customer-company-detail-inner">
          <header className="customer-company-detail-header">
            <div className="customer-company-detail-header-title">
              <span className="material-symbols-outlined">business</span>
              <h2>고객사 세부정보</h2>
            </div>
            <div className="customer-company-detail-header-actions">
              <button type="button" className="customer-company-detail-icon-btn" onClick={() => setShowEditModal(true)} title="수정">
                <span className="material-symbols-outlined">edit</span>
              </button>
              <button type="button" className="customer-company-detail-icon-btn customer-company-detail-delete-btn" onClick={() => setShowDeleteConfirm(true)} title="삭제">
                <span className="material-symbols-outlined">delete</span>
              </button>
              <button type="button" className="customer-company-detail-icon-btn" onClick={onClose} aria-label="닫기">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
          </header>

          {showDeleteConfirm && (
            <div className="customer-company-detail-delete-confirm">
              <span className="material-symbols-outlined">warning</span>
              <p>이 고객사를 삭제하시겠습니까?<br />삭제하면 소속 연락처·업무 기록 등 관련 데이터에 영향을 줄 수 있습니다.</p>
              <div className="customer-company-detail-delete-confirm-btns">
                <button type="button" className="customer-company-detail-confirm-cancel" onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>취소</button>
                <button type="button" className="customer-company-detail-confirm-delete" onClick={handleDeleteCompany} disabled={deleting}>
                  {deleting ? '삭제 중...' : '삭제'}
                </button>
              </div>
            </div>
          )}

          <div className="customer-company-detail-body">
            <section className="customer-company-detail-card">
              <div className="customer-company-detail-logo">
                <span className="material-symbols-outlined">business</span>
              </div>
              <div className="customer-company-detail-info">
                <div className="customer-company-detail-name-row">
                  <h1 className="customer-company-detail-name">{company.name || '—'}</h1>
                  <span className={`customer-company-detail-status-badge status-${status}`}>{displayStatus}</span>
                </div>
                <div className="customer-company-detail-meta">
                  {company.businessNumber != null && (
                    <div className="customer-company-detail-meta-item">
                      <span className="material-symbols-outlined">fingerprint</span>
                      <span>사업자번호: {formatBusinessNumber(company.businessNumber)}</span>
                    </div>
                  )}
                  {company.representativeName && (
                    <div className="customer-company-detail-meta-item">
                      <span className="material-symbols-outlined">person</span>
                      <span>대표: {company.representativeName}</span>
                    </div>
                  )}
                  {company.address && (
                    <div className="customer-company-detail-meta-item full">
                      <span className="material-symbols-outlined">location_on</span>
                      <span>{company.address}</span>
                    </div>
                  )}
                </div>
              </div>
            </section>

            <CustomFieldsDisplay
              definitions={customDefinitions}
              values={company.customFields || {}}
              className="customer-company-detail-custom-fields"
            />

            <section className="customer-company-detail-section">
              <div className="customer-company-detail-section-head">
                <h3 className="customer-company-detail-section-title">
                  <span className="material-symbols-outlined">group</span>
                  직원 리스트
                </h3>
                {!loadingEmployees && (
                  <button
                    type="button"
                    className="customer-company-detail-btn-all"
                    onClick={() => setShowAllEmployeesModal(true)}
                  >
                    전체 보기
                    <span className="material-symbols-outlined">arrow_forward</span>
                  </button>
                )}
              </div>
              {loadingEmployees || loadingHistory ? (
                <p className="customer-company-detail-employees-empty">불러오는 중...</p>
              ) : latestEmployeeByHistory ? (
                <div className="customer-company-detail-employee-preview">
                  <span className="customer-company-detail-employee-preview-label">지원 업무기록 기준 (가장 최근)</span>
                  <div className="customer-company-detail-employee-item">
                    <div className="customer-company-detail-employee-name">{latestEmployeeByHistory.name || '—'}</div>
                    <div className="customer-company-detail-employee-meta">
                      {latestEmployeeByHistory.phone && (
                        <span className="customer-company-detail-employee-meta-item">
                          <span className="material-symbols-outlined">phone</span>
                          {latestEmployeeByHistory.phone}
                        </span>
                      )}
                      {latestEmployeeByHistory.email && (
                        <span className="customer-company-detail-employee-meta-item">
                          <span className="material-symbols-outlined">mail</span>
                          {latestEmployeeByHistory.email}
                        </span>
                      )}
                      {!latestEmployeeByHistory.phone && !latestEmployeeByHistory.email && (
                        <span className="customer-company-detail-employee-meta-item">연락처 없음</span>
                      )}
                    </div>
                  </div>
                </div>
              ) : employees.length === 0 ? (
                <p className="customer-company-detail-employees-empty">등록된 직원이 없습니다.</p>
              ) : (
                <p className="customer-company-detail-employees-empty">최근 업무 기록이 없어 표시할 직원이 없습니다. 전체 보기에서 목록을 확인하세요.</p>
              )}
            </section>

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

            {/* 증서 · 자료 (Google Drive: [고객사]_[사업자번호] 폴더) */}
            <section className="customer-company-detail-section register-sale-docs">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => { handleDirectFileUpload(e.target.files); e.target.value = ''; }}
                disabled={driveUploading}
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
                  onClick={() => { if (!driveUploading && fileInputRef.current) fileInputRef.current.click(); }}
                  disabled={driveUploading}
                  title="파일 추가"
                  aria-label="파일 추가"
                >
                  파일 추가
                  <span className="material-symbols-outlined">add</span>
                </button>
              </div>
              {driveFolderLink && getDriveFolderIdFromLink(driveFolderLink) ? (
                <div
                  className={`register-sale-docs-embed-wrap ${docsDropActive ? 'register-sale-docs-dropzone-active' : ''} ${driveUploading ? 'register-sale-docs-dropzone-disabled' : ''} ${dragInModal ? 'register-sale-docs-drag-in-modal' : ''}`}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (!driveUploading) setDocsDropActive(true); }}
                  onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDocsDropActive(false); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDocsDropActive(false);
                    setDragInModal(false);
                    if (!driveUploading && e.dataTransfer?.files?.length) handleDirectFileUpload(e.dataTransfer.files);
                  }}
                  aria-label="Drive 폴더 (드래그하여 파일 추가, 리스트 클릭 시 열람)"
                >
                  <iframe
                    key={driveEmbedKey}
                    title="Google Drive 폴더 현황"
                    src={`https://drive.google.com/embeddedfolderview?id=${getDriveFolderIdFromLink(driveFolderLink)}#list`}
                    className="register-sale-docs-embed"
                  />
                  {driveUploading ? (
                    <div className="register-sale-docs-embed-overlay">업로드 중…</div>
                  ) : docsDropActive ? (
                    <div className="register-sale-docs-embed-overlay">여기에 놓기</div>
                  ) : null}
                </div>
              ) : (
                <div
                  className={`register-sale-docs-dropzone ${docsDropActive ? 'register-sale-docs-dropzone-active' : ''} ${driveUploading ? 'register-sale-docs-dropzone-disabled' : ''}`}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (!driveUploading) setDocsDropActive(true); }}
                  onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDocsDropActive(false); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDocsDropActive(false);
                    if (!driveUploading && e.dataTransfer?.files?.length) handleDirectFileUpload(e.dataTransfer.files);
                  }}
                  onClick={() => { if (!driveUploading && fileInputRef.current) fileInputRef.current.click(); }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !driveUploading && fileInputRef.current) fileInputRef.current.click(); }}
                  aria-label="파일 업로드 (드래그 앤 드롭 또는 클릭)"
                >
                  <span className="material-symbols-outlined register-sale-docs-dropzone-icon">upload_file</span>
                  <span>{driveUploading ? '업로드 중…' : '파일을 여기에 놓거나 클릭하여 선택'}</span>
                </div>
              )}
              {driveError && <p className="register-sale-docs-error">{driveError}</p>}
            </section>

            {showProductSalesModal && (
              <ProductSalesModal
                companyName={company.name}
                companyId={companyId}
                items={productSalesList}
                driveFolderLink={driveFolderLink || undefined}
                onClose={() => setShowProductSalesModal(false)}
                onAddSale={() => { setShowProductSalesModal(false); setShowRegisterSaleModal(true); }}
                onSelectItem={(row) => { setShowProductSalesModal(false); setSelectedSaleForEdit(row); }}
              />
            )}
            {showRegisterSaleModal && (
              <RegisterSaleModal
                initialCustomerCompany={{ _id: companyId, name: company.name, businessNumber: company.businessNumber }}
                onClose={() => setShowRegisterSaleModal(false)}
                onSaved={() => { setShowRegisterSaleModal(false); fetchProductSales(); }}
              />
            )}
            {selectedSaleForEdit && (
              <RegisterSaleModal
                saleId={selectedSaleForEdit._id}
                initialCustomerCompany={{ _id: companyId, name: company.name, businessNumber: company.businessNumber }}
                onClose={() => setSelectedSaleForEdit(null)}
                onSaved={() => { setSelectedSaleForEdit(null); fetchProductSales(); }}
              />
            )}

            {showAllEmployeesModal && (
              <AllEmployeesModal
                employees={employees}
                customerCompany={company}
                onClose={() => setShowAllEmployeesModal(false)}
                onSelectContact={(emp) => {
                  setContactForDetailModal(emp);
                  setShowAllEmployeesModal(false);
                }}
                onRefreshEmployees={fetchEmployees}
              />
            )}

            {contactForDetailModal && (
              <ContactDetailModal
                contact={contactForDetailModal}
                onClose={() => setContactForDetailModal(null)}
                onUpdated={() => {
                  fetchEmployees();
                  fetchHistory();
                }}
              />
            )}

            {showEditModal && (
              <AddCompanyModal
                company={company}
                onClose={() => setShowEditModal(false)}
                onUpdated={(updatedCompany) => {
                  setShowEditModal(false);
                  onUpdated?.(updatedCompany);
                }}
              />
            )}

            {showAllHistoryModal && (
              <AllHistoryModal
                historyItems={historyItems}
                companyId={companyId}
                onClose={() => setShowAllHistoryModal(false)}
                onRefresh={fetchHistory}
              />
            )}

            <section className="customer-company-detail-section">
              <div className="customer-company-detail-section-head">
                <h3 className="customer-company-detail-section-title">
                  <span className="material-symbols-outlined">history_edu</span>
                  지원 및 업무 기록
                </h3>
                {!loadingHistory && historyItems.length > 0 && (
                  <button
                    type="button"
                    className="customer-company-detail-btn-all"
                    onClick={() => setShowAllHistoryModal(true)}
                  >
                    전체 보기
                    <span className="material-symbols-outlined">arrow_forward</span>
                  </button>
                )}
              </div>
              <div className="customer-company-detail-journal-input-wrap">
                {journalError && <p className="customer-company-detail-journal-error">{journalError}</p>}
                <div className="customer-company-detail-journal-datetime-row">
                  <label htmlFor="customer-company-detail-journal-datetime" className="customer-company-detail-journal-datetime-label">등록일시</label>
                  <input
                    id="customer-company-detail-journal-datetime"
                    type="datetime-local"
                    className="customer-company-detail-journal-datetime"
                    value={journalDateTime}
                    onChange={(e) => setJournalDateTime(e.target.value)}
                    aria-label="업무 기록 등록일시"
                  />
                </div>
                <textarea
                  className="customer-company-detail-journal-input"
                  placeholder="회사 단위 메모 또는 업무 기록 (여러 직원 미팅 등)..."
                  rows={3}
                  value={journalText}
                  onChange={(e) => setJournalText(e.target.value)}
                />
                <div className="customer-company-detail-journal-actions">
                  <button
                    type="button"
                    className="customer-company-detail-journal-save"
                    onClick={handleSaveNote}
                    disabled={savingNote || !journalText.trim()}
                  >
                    {savingNote ? '저장 중...' : '메모 저장'}
                  </button>
                </div>
              </div>
              <div className="customer-company-detail-timeline">
                {loadingHistory ? (
                  <p className="customer-company-detail-timeline-empty">불러오는 중...</p>
                ) : historyItems.length === 0 ? (
                  <p className="customer-company-detail-timeline-empty">등록된 업무 기록이 없습니다.</p>
                ) : (
                  historyItems.map((entry) => (
                    <div key={entry._id} className="customer-company-detail-timeline-item">
                      <div className="customer-company-detail-timeline-dot" />
                      <div className="customer-company-detail-timeline-card">
                        <div className="customer-company-detail-timeline-head">
                          <div>
                            {entry.employeeName && <span className="customer-company-detail-timeline-emp">{entry.employeeName}</span>}
                            <time>{formatHistoryDate(entry.createdAt)}</time>
                          </div>
                          <button
                            type="button"
                            className="customer-company-detail-timeline-delete"
                            onClick={() => handleDeleteHistory(entry._id)}
                            aria-label="삭제"
                          >
                            <span className="material-symbols-outlined">delete</span>
                          </button>
                        </div>
                        <div className="customer-company-detail-timeline-content-wrap">
                          {splitContentIntoBlocks(entry.content).map((paragraphSentences, pIdx) => (
                            <p key={pIdx} className="customer-company-detail-timeline-paragraph">
                              {paragraphSentences.map((sentence, sIdx) => (
                                <span key={sIdx} className="customer-company-detail-timeline-sentence">{sentence}{sIdx < paragraphSentences.length - 1 ? ' ' : ''}</span>
                              ))}
                            </p>
                          ))}
                        </div>
                        <div className="customer-company-detail-timeline-footer">
                          <span className="customer-company-detail-timeline-logged">
                            등록: {(entry.createdByCurrentName !== undefined ? entry.createdByCurrentName : entry.createdByName) || '—'}
                            {(entry.createdByCurrentContact !== undefined ? entry.createdByCurrentContact : entry.createdByContact) ? ' · ' + (entry.createdByCurrentContact !== undefined ? entry.createdByCurrentContact : entry.createdByContact) : ''}
                            {entry.createdByChanged && <span className="customer-company-detail-timeline-changed"> 변경됨</span>}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
