import { useState, useEffect, useRef, useCallback } from 'react';
import './assignee-picker-modal.css';

import { API_BASE } from '@/config';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function getCurrentUserId() {
  try {
    const u = JSON.parse(localStorage.getItem('crm_user') || '{}');
    return u?._id ? String(u._id) : null;
  } catch (_) {
    return null;
  }
}

/**
 * 담당자 선택 모달: company-overview와 동일한 직원 리스트를 검색·선택 (이름, 이메일, 연락처, 부서 검색, Shift+클릭 범위 선택).
 * @param {boolean} open
 * @param {() => void} onClose
 * @param {string[]} selectedIds - 현재 선택된 담당자 ID 배열 (본인 기본 포함 권장)
 * @param {(ids: string[]) => void} onConfirm - 확인 시 선택된 ID 배열 전달
 */
export default function AssigneePickerModal({ open, onClose, selectedIds = [], onConfirm }) {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selected, setSelected] = useState(() => [...(selectedIds || [])]);
  const lastClickIndexRef = useRef(null);
  const searchInputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setSelected([...(selectedIds || [])]);
    setSearchQuery('');
    lastClickIndexRef.current = null;
    setLoading(true);
    let cancelled = false;
    fetch(`${API_BASE}/companies/overview`, { headers: getAuthHeader() })
      .then((r) => r.json().catch(() => ({})))
      .then((data) => {
        if (!cancelled && Array.isArray(data?.employees)) setEmployees(data.employees);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, selectedIds]);

  useEffect(() => {
    if (open && searchInputRef.current) searchInputRef.current.focus();
  }, [open]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      onClose?.();
    };
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const q = (searchQuery || '').trim().toLowerCase();
  const filteredList = q
    ? employees.filter((emp) =>
        (emp.name || '').toLowerCase().includes(q) ||
        (emp.email || '').toLowerCase().includes(q) ||
        (emp.phone || '').toLowerCase().includes(q) ||
        (emp.department || '').toLowerCase().includes(q)
      )
    : employees;

  const toggleOne = useCallback((userId) => {
    const id = userId != null ? String(userId) : '';
    if (!id) return;
    setSelected((prev) => {
      const has = prev.includes(id);
      if (has) return prev.filter((x) => x !== id);
      return [...prev, id];
    });
  }, []);

  const handleRangeSelect = useCallback((fromIndex, toIndex) => {
    const idsInRange = filteredList
      .slice(Math.min(fromIndex, toIndex), Math.max(fromIndex, toIndex) + 1)
      .map((e) => (e.id != null ? String(e.id) : ''))
      .filter(Boolean);
    setSelected((prev) => [...new Set([...prev, ...idsInRange])]);
  }, [filteredList]);

  const handleRowClick = useCallback((emp, index, e) => {
    const empId = emp.id != null ? String(emp.id) : '';
    if (!empId) return;
    if (e.shiftKey) {
      const last = lastClickIndexRef.current;
      if (last != null) handleRangeSelect(last, index);
      else toggleOne(empId);
      lastClickIndexRef.current = index;
    } else {
      toggleOne(empId);
      lastClickIndexRef.current = index;
    }
  }, [toggleOne, handleRangeSelect]);

  const handleConfirm = useCallback(() => {
    onConfirm?.([...selected]);
    onClose?.();
  }, [selected, onConfirm, onClose]);

  if (!open) return null;

  return (
    <div className="assignee-picker-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="담당자 선택">
      <div className="assignee-picker-modal" onClick={(e) => e.stopPropagation()}>
        <div className="assignee-picker-header">
          <h3 className="assignee-picker-title">담당자 선택</h3>
          <button type="button" className="assignee-picker-close" onClick={onClose} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="assignee-picker-search-wrap">
          <input
            ref={searchInputRef}
            type="text"
            className="assignee-picker-search-input"
            placeholder="이름, 이메일, 연락처, 부서로 검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="담당자 검색"
          />
          <span className="material-symbols-outlined assignee-picker-search-icon">search</span>
        </div>
        <p className="assignee-picker-hint">Shift+클릭으로 범위 선택 가능. 기본으로 본인이 포함됩니다.</p>
        <div className="assignee-picker-table-wrap">
          {loading ? (
            <p className="assignee-picker-loading">직원 목록을 불러오는 중...</p>
          ) : employees.length === 0 ? (
            <p className="assignee-picker-empty">등록된 직원이 없습니다.</p>
          ) : filteredList.length === 0 ? (
            <p className="assignee-picker-empty">검색 결과가 없습니다.</p>
          ) : (
            <table className="assignee-picker-table">
              <thead>
                <tr>
                  <th className="assignee-picker-th-check"><span className="sr-only">선택</span></th>
                  <th>이름</th>
                  <th>이메일</th>
                  <th>연락처</th>
                  <th>부서</th>
                </tr>
              </thead>
              <tbody>
                {filteredList.map((emp, index) => {
                  const empId = emp.id != null ? String(emp.id) : '';
                  const checked = selected.includes(empId);
                  return (
                    <tr
                      key={empId || index}
                      className="assignee-picker-row"
                      onClick={(e) => handleRowClick(emp, index, e)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleRowClick(emp, index, { ...e, shiftKey: e.shiftKey });
                        }
                      }}
                      aria-pressed={checked}
                    >
                      <td className="assignee-picker-td-check">
                        <input
                          type="checkbox"
                          checked={checked}
                          readOnly
                          tabIndex={-1}
                          aria-label={`${emp.name || '—'} 선택`}
                          onChange={() => {}}
                        />
                      </td>
                      <td>{emp.name || '—'}</td>
                      <td>{emp.email || '—'}</td>
                      <td>{emp.phone || '—'}</td>
                      <td>{emp.department || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className="assignee-picker-footer">
          <button type="button" className="assignee-picker-btn-cancel" onClick={onClose}>취소</button>
          <button type="button" className="assignee-picker-btn-confirm" onClick={handleConfirm}>
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
