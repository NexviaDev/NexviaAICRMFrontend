import { useState, useEffect, useMemo, useCallback } from 'react';
import { API_BASE } from '@/config';
import { collectExactSelectedMemberDeptIds } from '@/lib/org-chart-tree-utils';
import ParticipantOrgChartPicker from './participant-org-chart-picker';
import './participant-modal.css';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function ParticipantModal({
  teamMembers,
  selected,
  currentUser,
  onConfirm,
  onClose,
  title = '참여자 선택',
  bulkAddLabel = '표시된 인원 모두 참여자에 추가'
}) {
  const [localSelected, setLocalSelected] = useState(selected || []);
  const [search, setSearch] = useState('');
  const [lastClickedIndex, setLastClickedIndex] = useState(null);
  const [orgPickerOpen, setOrgPickerOpen] = useState(false);
  const [organizationChart, setOrganizationChart] = useState(null);
  const [orgChartLoading, setOrgChartLoading] = useState(false);
  const [orgChartError, setOrgChartError] = useState('');
  const [selectedOrgIds, setSelectedOrgIds] = useState([]);

  useEffect(() => {
    const url = new URL(window.location);
    url.searchParams.set('participantModal', '1');
    window.history.pushState({}, '', url);

    const onPop = () => onClose?.();
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      const u = new URL(window.location);
      if (u.searchParams.has('participantModal')) {
        u.searchParams.delete('participantModal');
        window.history.replaceState({}, '', u);
      }
    };
  }, [onClose]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const removeChip = useCallback((userId) => {
    setLocalSelected((prev) => prev.filter((p) => p.userId !== userId));
  }, []);

  useEffect(() => {
    if (!orgPickerOpen) return undefined;
    let cancelled = false;
    setOrgChartError('');
    setOrgChartLoading(true);
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/companies/organization-chart`, {
          headers: getAuthHeader(),
          credentials: 'include'
        });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) throw new Error(json.error || '조직도를 불러오지 못했습니다.');
        setOrganizationChart(json.organizationChart || null);
      } catch (e) {
        if (!cancelled) setOrgChartError(e.message || '조직도를 불러오지 못했습니다.');
      } finally {
        if (!cancelled) setOrgChartLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [orgPickerOpen]);

  const orgDeptFilter = useMemo(() => {
    if (!organizationChart || selectedOrgIds.length === 0) return null;
    return collectExactSelectedMemberDeptIds(organizationChart, selectedOrgIds);
  }, [organizationChart, selectedOrgIds]);

  /** 조직 선택이 바뀔 때만 의존 (Set 참조 변화로 effect 중복 실행 방지) */
  const orgSelectionKey = useMemo(
    () => (selectedOrgIds.length === 0 ? '' : [...selectedOrgIds].sort().join('|')),
    [selectedOrgIds]
  );

  /** 조직도에서 조직을 고르면 해당 조직에 직접 배정된 직원만 체크 목록에 자동 반영 (하위 부서 제외) */
  useEffect(() => {
    if (!orgSelectionKey || !organizationChart) return;
    const allowed = collectExactSelectedMemberDeptIds(organizationChart, selectedOrgIds);
    if (allowed.size === 0) return;
    setLocalSelected((prev) => {
      const map = new Map(prev.map((p) => [String(p.userId), p]));
      for (const m of teamMembers) {
        const deptId = String(m.companyDepartment || '').trim();
        if (!deptId || !allowed.has(deptId)) continue;
        map.set(String(m._id), { userId: m._id, name: m.name || m.email });
      }
      return Array.from(map.values());
    });
  }, [orgSelectionKey, organizationChart, selectedOrgIds, teamMembers]);

  const handleToggleOrgId = useCallback((id) => {
    const sid = String(id);
    setSelectedOrgIds((prev) => (prev.includes(sid) ? prev.filter((x) => x !== sid) : [...prev, sid]));
  }, []);

  const clearOrgSelection = useCallback(() => {
    setSelectedOrgIds([]);
  }, []);

  const filtered = useMemo(() => {
    return teamMembers.filter((m) => {
      if (orgDeptFilter) {
        const deptId = String(m.companyDepartment || '').trim();
        if (!deptId || !orgDeptFilter.has(deptId)) return false;
      }
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      const deptRaw = (m.department || m.companyDepartment || '').toLowerCase();
      const deptShown = (m.departmentDisplay || '').toLowerCase();
      return (
        (m.name || '').toLowerCase().includes(q) ||
        (m.email || '').toLowerCase().includes(q) ||
        (m.phone || '').toLowerCase().includes(q) ||
        deptRaw.includes(q) ||
        deptShown.includes(q)
      );
    });
  }, [teamMembers, search, orgDeptFilter]);

  const addAllVisibleToSelection = useCallback(() => {
    setLocalSelected((prev) => {
      const map = new Map(prev.map((p) => [String(p.userId), p]));
      for (const m of filtered) {
        map.set(String(m._id), { userId: m._id, name: m.name || m.email });
      }
      return Array.from(map.values());
    });
  }, [filtered]);

  const toggle = useCallback((member, index, withShift = false) => {
    setLocalSelected((prev) => {
      const selectedMap = new Map(prev.map((p) => [String(p.userId), p]));
      const targetId = String(member._id);
      const exists = selectedMap.has(targetId);
      const willCheck = !exists;

      if (withShift && lastClickedIndex !== null && index !== null) {
        const start = Math.min(lastClickedIndex, index);
        const end = Math.max(lastClickedIndex, index);
        for (let i = start; i <= end; i++) {
          const m = filtered[i];
          if (!m) continue;
          const mid = String(m._id);
          if (willCheck) selectedMap.set(mid, { userId: m._id, name: m.name || m.email });
          else selectedMap.delete(mid);
        }
      } else if (exists) {
        selectedMap.delete(targetId);
      } else {
        selectedMap.set(targetId, { userId: member._id, name: member.name || member.email });
      }
      return Array.from(selectedMap.values());
    });
    setLastClickedIndex(index);
  }, [filtered, lastClickedIndex]);

  const handleConfirm = () => {
    onConfirm?.(localSelected);
    if (window.history.state && new URL(window.location).searchParams.has('participantModal')) {
      window.history.back();
    } else {
      onClose?.();
    }
  };

  const handleCancel = () => {
    if (window.history.state && new URL(window.location).searchParams.has('participantModal')) {
      window.history.back();
    } else {
      onClose?.();
    }
  };

  return (
    <div className="participant-modal-overlay">
      <div
        className={`participant-modal${orgPickerOpen ? ' participant-modal--with-org' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >

        <div className="participant-modal-header">
          <h3>{title}</h3>
          <button type="button" className="participant-modal-close" onClick={handleCancel} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="participant-modal-body" data-participant-modal-scroll>
          {localSelected.length > 0 && (
            <div className="participant-modal-chips">
              {localSelected.map((p) => (
                <span key={p.userId} className="participant-modal-chip" onClick={() => removeChip(p.userId)}>
                  {p.name || '(이름 없음)'} <span className="chip-x">✕</span>
                </span>
              ))}
            </div>
          )}

          <div className="participant-modal-search-wrap">
            <span className="material-symbols-outlined participant-modal-search-icon">search</span>
            <input
              type="text"
              className="participant-modal-search"
              placeholder="이름, 이메일, 연락처, 부서 검색…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </div>

          <div className="participant-modal-org-actions">
            <button
              type="button"
              className={`participant-modal-org-toggle${orgPickerOpen ? ' is-open' : ''}`}
              onClick={() => setOrgPickerOpen((o) => !o)}
            >
              <span className="material-symbols-outlined" aria-hidden>account_tree</span>
              조직도로 선택하기
            </button>
            {selectedOrgIds.length > 0 ? (
              <span className="participant-modal-org-filter-meta">
                조직 {selectedOrgIds.length}개 · 필터 적용
                <button type="button" className="participant-modal-org-clear" onClick={clearOrgSelection}>
                  초기화
                </button>
              </span>
            ) : null}
          </div>

          {orgPickerOpen ? (
            <div className="participant-modal-org-wrap">
              <p className="participant-modal-org-hint">
                노드를 클릭하면 조직이 선택·해제됩니다. 각 노드에 <strong>직접</strong> 소속된 직원(프로필 부서 = 해당 조직)만 목록에
                나오고 자동 체크됩니다. 하위 부서 직원은 포함되지 않으니, 필요하면 하위 노드도 따로 선택하세요. 조직도를 접으려면 위의{' '}
                <strong>조직도로 선택하기</strong>를 다시 누르세요.
              </p>
              {orgChartLoading ? (
                <p className="participant-modal-org-loading">조직도를 불러오는 중…</p>
              ) : null}
              {orgChartError ? (
                <p className="participant-modal-org-error">{orgChartError}</p>
              ) : null}
              {!orgChartLoading && !orgChartError && organizationChart ? (
                <div className="participant-modal-org-tree-panel">
                  <div className="participant-modal-org-tree-panel-head" aria-hidden>
                    <span className="material-symbols-outlined">account_tree</span>
                    조직 트리 (노드 클릭으로 부서 선택)
                  </div>
                  <div className="participant-modal-org-tree-panel-body">
                    <ParticipantOrgChartPicker
                      organizationChart={organizationChart}
                      selectedOrgIds={selectedOrgIds}
                      onToggleOrgId={handleToggleOrgId}
                    />
                  </div>
                </div>
              ) : null}
              {!orgChartLoading && !orgChartError && !organizationChart ? (
                <p className="participant-modal-org-empty">표시할 조직도가 없습니다.</p>
              ) : null}
            </div>
          ) : null}

          {orgDeptFilter && filtered.length > 0 ? (
            <div className="participant-modal-bulk-row">
              <button type="button" className="participant-modal-bulk-add" onClick={addAllVisibleToSelection}>
                {bulkAddLabel}
              </button>
            </div>
          ) : null}

          <div className="participant-modal-list">
            {filtered.length === 0 && (
              <p className="participant-modal-empty">선택 가능한 팀원이 없습니다.</p>
            )}
            {filtered.length > 0 && (
              <div className="participant-modal-list-head">
                <span>선택</span>
                <span>이름</span>
                <span>이메일</span>
                <span>연락처</span>
                <span>부서</span>
              </div>
            )}
            {filtered.map((m, idx) => {
              const checked = localSelected.some((p) => p.userId === m._id);
              return (
                <label key={m._id} className={`participant-modal-item${checked ? ' checked' : ''}`}>
                  <input type="checkbox" checked={checked} onChange={(e) => toggle(m, idx, !!e.nativeEvent?.shiftKey)} />
                  <span className="participant-modal-name">
                    {m.name || '(이름 없음)'}
                    {currentUser && String(m._id) === String(currentUser._id) ? (
                      <span className="participant-modal-me-note"> (나)</span>
                    ) : null}
                  </span>
                  <span className="participant-modal-email">{m.email || '—'}</span>
                  <span className="participant-modal-phone">{m.phone || '—'}</span>
                  <span className="participant-modal-department">
                    {m.departmentDisplay || m.department || m.companyDepartment || '—'}
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        <div className="participant-modal-footer">
          <span className="participant-modal-count">
            {localSelected.length}명 선택됨
          </span>
          <div className="participant-modal-actions">
            <button type="button" className="participant-modal-btn cancel" onClick={handleCancel}>취소</button>
            <button type="button" className="participant-modal-btn confirm" onClick={handleConfirm}>확인</button>
          </div>
        </div>
      </div>
    </div>
  );
}
