import { useState, useEffect, useCallback, useRef } from 'react';
import AddContactModal from '../../../customer-company-employees/add-customer-company-employees-modal/add-customer-company-employees-modal';
import SmsDraftModal, { phoneToSmsHref } from '../../../customer-company-employees/sms-draft-modal/sms-draft-modal';
import EmailComposeModal from '../../../email/email-compose-modal.jsx';
import BringContactsModal from './bring-contacts-modal';
import './all-employees-modal.css';

import { API_BASE } from '@/config';
const LIMIT = 200;

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** 고객사 세부 모달 내 "전체 직원 목록" 모달 - DB 조회, 체크박스(Shift 범위 선택), 직원 추가, 연락처 가지고 오기 */
export default function AllEmployeesModal({ employees: initialEmployees, customerCompany, onClose, onSelectContact, onRefreshEmployees }) {
  const [showAddContactModal, setShowAddContactModal] = useState(false);
  const [showBringContactsModal, setShowBringContactsModal] = useState(false);
  const [emailCompose, setEmailCompose] = useState(null);
  const [smsBulkRows, setSmsBulkRows] = useState(null);
  const [list, setList] = useState(initialEmployees || []);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const lastClickedIdx = useRef(null);

  const companyId = customerCompany?._id;

  const fetchEmployees = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ customerCompanyId: companyId, limit: String(LIMIT) });
      const res = await fetch(`${API_BASE}/customer-company-employees?${params}`, { headers: getAuthHeader() });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setList(data.items || []);
      else setList([]);
    } catch (_) {
      setList([]);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    fetchEmployees();
  }, [fetchEmployees]);

  useEffect(() => {
    setSelected(new Set());
    lastClickedIdx.current = null;
  }, [list]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (emailCompose) setEmailCompose(null);
      else if (smsBulkRows) setSmsBulkRows(null);
      else if (showBringContactsModal) setShowBringContactsModal(false);
      else if (showAddContactModal) setShowAddContactModal(false);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, showAddContactModal, showBringContactsModal, emailCompose, smsBulkRows]);

  const handleItemClick = (emp) => {
    if (onSelectContact) onSelectContact(emp);
    onClose();
  };

  const handleCheckboxClick = (idx, e) => {
    e.stopPropagation();
    if (e.shiftKey && lastClickedIdx.current !== null) {
      const start = Math.min(lastClickedIdx.current, idx);
      const end = Math.max(lastClickedIdx.current, idx);
      setSelected((prev) => {
        const next = new Set(prev);
        for (let i = start; i <= end; i++) {
          if (list[i]) next.add(list[i]._id);
        }
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        const id = list[idx]._id;
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    }
    lastClickedIdx.current = idx;
  };

  const handleSelectAll = () => {
    if (selected.size === list.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(list.map((r) => r._id)));
    }
  };

  const selectedEmployees = () => [...selected].map((id) => list.find((emp) => String(emp._id) === String(id))).filter(Boolean);

  const openEmailForSelected = () => {
    const rows = selectedEmployees();
    if (rows.length === 0) {
      window.alert('메일을 보낼 직원을 체크박스로 선택해 주세요.');
      return;
    }
    const withEmail = rows.filter((emp) => String(emp.email || '').trim());
    if (withEmail.length === 0) {
      window.alert('선택한 직원 중 이메일이 등록된 사람이 없습니다.');
      return;
    }
    const skipped = rows.length - withEmail.length;
    if (skipped > 0) {
      window.alert(`이메일이 없는 ${skipped}명은 제외하고 ${withEmail.length}명에게 메일을 준비합니다.`);
    }
    const uniqueEmails = [...new Set(withEmail.map((emp) => String(emp.email).trim()))];
    setEmailCompose({ initialTo: uniqueEmails.join(','), contacts: withEmail });
  };

  const openSmsForSelected = () => {
    const rows = selectedEmployees();
    if (rows.length === 0) {
      window.alert('문자를 보낼 직원을 체크박스로 선택해 주세요.');
      return;
    }
    const withPhone = rows.filter((emp) => phoneToSmsHref(emp.phone, ''));
    if (withPhone.length === 0) {
      window.alert('선택한 직원 중 전화번호가 등록된 사람이 없습니다.');
      return;
    }
    const skipped = rows.length - withPhone.length;
    if (skipped > 0) {
      window.alert(`전화번호가 없는 ${skipped}명은 제외하고 ${withPhone.length}명에게 문자를 준비합니다.`);
    }
    setSmsBulkRows(withPhone);
  };

  if (!customerCompany) return null;

  return (
    <>
      <div className="all-employees-modal-overlay" aria-hidden="true" />
      <div className="all-employees-modal">
        <div className="all-employees-modal-inner">
          <header className="all-employees-modal-header">
            <h3>전체 직원 목록</h3>
            <div className="all-employees-modal-header-actions">
              <button type="button" className="all-employees-modal-add-btn" onClick={() => setShowAddContactModal(true)}>
                <span className="material-symbols-outlined">person_add</span>
                새 직원 추가
              </button>
              <button type="button" className="all-employees-modal-close" onClick={onClose} aria-label="닫기">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
          </header>

          <div className="all-employees-list-toolbar">
            <button type="button" className="all-employees-modal-bring-btn" onClick={() => setShowBringContactsModal(true)}>
              <span className="material-symbols-outlined">group_add</span>
              DB에서 연락처 가지고 오기
            </button>
            <div className="all-employees-bulk-actions" aria-label="선택 직원 일괄 연락">
              <button
                type="button"
                className="all-employees-bulk-action-btn all-employees-bulk-action-btn--mail"
                onClick={openEmailForSelected}
                disabled={selected.size === 0}
                title="체크한 직원에게 메일 보내기"
              >
                <span className="material-symbols-outlined">mail</span>
                메일 보내기
              </button>
              <button
                type="button"
                className="all-employees-bulk-action-btn all-employees-bulk-action-btn--sms"
                onClick={openSmsForSelected}
                disabled={selected.size === 0}
                title="체크한 직원에게 문자 보내기"
              >
                <span className="material-symbols-outlined">sms</span>
                문자 보내기
              </button>
            </div>
          </div>

          <ul className="all-employees-list">
            {loading ? (
              <li className="all-employees-empty">
                <p>불러오는 중...</p>
              </li>
            ) : list.length === 0 ? (
              <li className="all-employees-empty">
                <p>등록된 직원이 없습니다.</p>
              </li>
            ) : (
              <>
                <li className="all-employees-list-header">
                    <label className="all-employees-check-wrap">
                      <input
                        type="checkbox"
                        checked={selected.size === list.length && list.length > 0}
                        onChange={handleSelectAll}
                        onClick={(e) => e.stopPropagation()}
                        aria-label="전체 선택"
                      />
                    </label>
                    <span className="all-employees-list-header-name">이름</span>
                    <span className="all-employees-list-header-meta">연락처 / 이메일</span>
                </li>
                {list.map((emp, idx) => (
                  <li
                    key={emp._id}
                    className="all-employees-item all-employees-item-clickable"
                    role="button"
                    tabIndex={0}
                    onClick={() => handleItemClick(emp)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleItemClick(emp); } }}
                    aria-label={`${emp.name || '이름 없음'} 연락처 상세 보기`}
                  >
                    <label className="all-employees-check-wrap" onClick={(e) => handleCheckboxClick(idx, e)}>
                      <input
                        type="checkbox"
                        checked={selected.has(emp._id)}
                        onChange={() => {}}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`${emp.name || '이름 없음'} 선택`}
                      />
                    </label>
                    <div className="all-employees-item-body">
                      <div className="all-employees-item-name">{emp.name || '—'}</div>
                      <div className="all-employees-item-meta">
                        {emp.phone && (
                          <span className="all-employees-item-meta-item">
                            <span className="material-symbols-outlined">phone</span>
                            {emp.phone}
                          </span>
                        )}
                        {emp.email && (
                          <span className="all-employees-item-meta-item">
                            <span className="material-symbols-outlined">mail</span>
                            {emp.email}
                          </span>
                        )}
                        {emp.address && (
                          <span className="all-employees-item-meta-item">
                            <span className="material-symbols-outlined">location_on</span>
                            {emp.address}
                          </span>
                        )}
                        {!emp.phone && !emp.email && !emp.address && (
                          <span className="all-employees-item-meta-item">연락처 없음</span>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </>
            )}
          </ul>
        </div>
      </div>
      {showBringContactsModal && (
        <BringContactsModal
          companyId={customerCompany._id}
          companyName={customerCompany.name}
          companyAddress={customerCompany.address != null ? String(customerCompany.address).trim() : ''}
          onClose={() => setShowBringContactsModal(false)}
          onAssigned={() => {
            onRefreshEmployees?.();
            fetchEmployees();
          }}
        />
      )}
      {showAddContactModal && (
        <AddContactModal
          initialCustomerCompany={{
            _id: customerCompany._id,
            name: customerCompany.name,
            address: customerCompany.address != null ? String(customerCompany.address).trim() : ''
          }}
          onClose={() => setShowAddContactModal(false)}
          onSaved={() => {
            onRefreshEmployees?.();
            fetchEmployees();
            setShowAddContactModal(false);
          }}
        />
      )}
      <SmsDraftModal
        open={Array.isArray(smsBulkRows) && smsBulkRows.length > 0}
        onClose={() => setSmsBulkRows(null)}
        companyName={customerCompany.name}
        bulkContacts={smsBulkRows || undefined}
      />
      {emailCompose ? (
        <EmailComposeModal
          key={emailCompose.initialTo}
          initialTo={emailCompose.initialTo}
          onClose={() => setEmailCompose(null)}
          onSent={() => setEmailCompose(null)}
        />
      ) : null}
    </>
  );
}
