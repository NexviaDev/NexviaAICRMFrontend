import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { hasCrmSession, getCrmToken, getCrmAuthHeaders, crmFetchInit, markCrmSessionActive, clearCrmSessionLocal, logoutCrmSession } from '@/lib/crm-auth';
import CompanyDriveSettingsModal from './company-drive-settings-modal/company-drive-settings-modal';
import './company-overview.css';
import 'mind-elixir/style.css';

import { API_BASE } from '@/config';
import PageHeaderNotifyChat from '@/components/page-header-notify-chat/page-header-notify-chat';
import {
  mindOrgGenerateMainBranch,
  mindOrgGenerateSubBranch,
  mindOrgFitToView,
  mindOrgHandleWheelDelegatePageScroll,
  CO_ORG_SCALE_MIN,
  CO_ORG_SCALE_MAX,
  coOrgPn
} from '@/lib/org-chart-mind-shared';
import { GoogleWorkspaceChatPolicyHint } from '@/lib/google-workspace-chat-hint';
import { LIST_IDS, getSavedTemplate, patchListTemplate } from '@/lib/list-templates';

/** 조직도 노드 → 직원 부서 선택 라벨 */
function formatOrgDeptPickerLabel(node) {
  if (!node || typeof node !== 'object') return '';
  const n = String(node.name || '').trim();
  const r = String(node.roleLabel || '').trim();
  if (!n) return '';
  return r ? `${n} (${r})` : n;
}

function flattenOrgChartOptions(node, acc = []) {
  if (!node || typeof node !== 'object') return acc;
  const id = String(node.id || '').trim();
  if (id) acc.push({ id, label: formatOrgDeptPickerLabel(node) });
  for (const c of node.children || []) flattenOrgChartOptions(c, acc);
  return acc;
}

function findOrgChartNodeById(node, id) {
  if (!node || id == null || id === '') return null;
  const sid = String(id);
  if (String(node.id) === sid) return node;
  for (const c of node.children || []) {
    const f = findOrgChartNodeById(c, sid);
    if (f) return f;
  }
  return null;
}

function resolveDeptDisplay(orgChartRoot, stored) {
  const s = String(stored || '').trim();
  if (!s) return '';
  const n = findOrgChartNodeById(orgChartRoot, s);
  if (n) return formatOrgDeptPickerLabel(n);
  return s;
}

function formatBusinessNumberInput(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5, 10)}`;
}

function formatSubBusinessNumberInput(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 4);
}

function formatSubscriptionDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return '—';
  }
}

/** Tableau 스타일 다채로운 팔레트 — 역할 UI·조직도 연결선 (dashboard와 동일 계열) */
const CO_VIVID_PALETTE = [
  '#4e79a7',
  '#f28e2b',
  '#e15759',
  '#76b7b2',
  '#59a14f',
  '#edc948',
  '#af7aa1',
  '#2c7bb6',
  '#9c755f',
  '#ff9da7'
];

const CO_ORG_MIND_THEME = {
  name: 'Nexvia',
  randomColor: false,
  palette: CO_VIVID_PALETTE
};

const COMPANY_OVERVIEW_EMPLOYEE_LIST_ID = LIST_IDS.COMPANY_OVERVIEW_EMPLOYEES;
const COMPANY_OVERVIEW_FILTER_MENU_CURSOR_GAP = 12;
const COMPANY_OVERVIEW_FILTER_MENU_VIEWPORT_MARGIN = 8;
const COMPANY_OVERVIEW_EMPLOYEE_COLUMNS = [
  { key: 'department', label: '부서' },
  { key: 'rank', label: '직급' },
  { key: 'name', label: '이름' },
  { key: 'phone', label: '연락처' },
  { key: 'email', label: '이메일' },
  { key: 'crmRole', label: 'CRM 관리 역할' }
];
const COMPANY_OVERVIEW_EMPLOYEE_COLUMN_KEYS = COMPANY_OVERVIEW_EMPLOYEE_COLUMNS.map((c) => c.key);

function normalizeEmployeeColumnOrder(order, allowedKeys = COMPANY_OVERVIEW_EMPLOYEE_COLUMN_KEYS) {
  const normalizedKeys = Array.isArray(allowedKeys) ? allowedKeys.map((k) => String(k || '').trim()).filter(Boolean) : [];
  const base = Array.isArray(order) ? order.map((k) => String(k || '').trim()).filter((k) => normalizedKeys.includes(k)) : [];
  for (const k of normalizedKeys) {
    if (!base.includes(k)) base.push(k);
  }
  return base;
}

function getEmployeeCellText(row, key) {
  if (!row || typeof row !== 'object') return '';
  if (key === 'name') return String(row.name || row.email || '').trim();
  if (key === 'email') return String(row.email || '').trim();
  if (key === 'phone') return String(row.phone || '').trim();
  if (key === 'department') return String(row._deptLabel || '').trim();
  if (key === 'rank') return String(row.rank || '').trim();
  if (key === 'title') return String(row.title || '').trim();
  if (key === 'crmRole') return String(row._roleLabel || '').trim();
  return '';
}

function getUniqueEmployeeFilterOptions(rows, key) {
  const set = new Set();
  (rows || []).forEach((row) => {
    set.add(getEmployeeCellText(row, key));
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'ko', { numeric: true, sensitivity: 'base' }));
}

function sortEmployeeRows(rows, sortConfig) {
  if (!sortConfig?.key || !sortConfig?.dir) return rows;
  const key = String(sortConfig.key || '').trim();
  const dir = sortConfig.dir === 'desc' ? -1 : 1;
  const next = [...rows];
  next.sort((a, b) => {
    const va = getEmployeeCellText(a, key);
    const vb = getEmployeeCellText(b, key);
    return va.localeCompare(vb, 'ko', { numeric: true, sensitivity: 'base' }) * dir;
  });
  return next;
}

/** 구독 카드용 — 역할별 한 줄 요약(summary)만 표시 */
const CRM_ROLE_PERMISSION_GUIDE = [
  {
    id: 'pending',
    title: '권한 대기 (Pending)',
    usesSeat: false,
    summary: 'CRM 미사용 (승인 전)'
  },
  {
    id: 'staff',
    title: '직원 (Staff)',
    usesSeat: true,
    summary: 'CRM 기본 — 등록·조회·수정'
  },
  {
    id: 'manager',
    title: '실무자 (Manager)',
    usesSeat: true,
    summary: '직원(Staff) 권한 + 팀 단위 보기·견적 필드 설정'
  },
  {
    id: 'admin',
    title: '관리자 (Admin)',
    usesSeat: true,
    summary: '실무자(Manager) 권한 + 삭제·조직·시스템 설정'
  },
  {
    id: 'owner',
    title: '대표 (Owner)',
    usesSeat: true,
    summary: '관리자(Admin) 권한 + 관리자 지정'
  }
];

function SubscriptionRolePermissionGuide() {
  return (
    <div className="company-subscription-role-guide" role="region" aria-label="역할별 권한 안내">
      <h3 className="company-subscription-role-guide-title">역할별로 할 수 있는 일</h3>
      <p className="company-subscription-role-guide-lead">
        아래는 권한이 적은 순서입니다. 각 역할의 <strong>색 한 줄</strong>은 「바로 아래 단계 + 추가로 생기는 일」을 뜻합니다.
        화면에 버튼이 없어도, 권한이 없으면 저장할 때 서버가 막습니다.
      </p>
      <div className="company-subscription-role-guide-list">
        {CRM_ROLE_PERMISSION_GUIDE.map((block) => (
          <div key={block.id} className={`company-subscription-role-block company-subscription-role-block--${block.id}`}>
            <div className="company-subscription-role-block-head">
              <span className="company-subscription-role-name">{block.title}</span>
              {block.usesSeat ? (
                <span className="company-subscription-role-badge">시트 사용</span>
              ) : (
                <span className="company-subscription-role-badge company-subscription-role-badge-muted">시트 미사용</span>
              )}
            </div>
            {block.summary ? (
              <p className="company-subscription-role-summary">{block.summary}</p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CompanyOverview() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [showDriveSettingsModal, setShowDriveSettingsModal] = useState(false);
  const [savingMemberId, setSavingMemberId] = useState('');
  const [savingDeptLeader, setSavingDeptLeader] = useState(false);
  const [memberEditOpen, setMemberEditOpen] = useState(false);
  const [memberEditForm, setMemberEditForm] = useState(null);
  const [selectedApproverIds, setSelectedApproverIds] = useState([]);
  const [requestSending, setRequestSending] = useState(false);
  const [requestMessage, setRequestMessage] = useState('');
  const [orgChart, setOrgChart] = useState(null);
  const [orgSaving, setOrgSaving] = useState(false);
  const [handoverPendingGroups, setHandoverPendingGroups] = useState([]);
  const [handoverPendingLoading, setHandoverPendingLoading] = useState(false);
  const [handoverViewerCanConsent, setHandoverViewerCanConsent] = useState(false);
  const [handoverApprovingKey, setHandoverApprovingKey] = useState('');
  const [handoverActionError, setHandoverActionError] = useState('');
  const [companyProfileEditing, setCompanyProfileEditing] = useState(false);
  const [companyProfileForm, setCompanyProfileForm] = useState(null);
  const [companyProfileSaving, setCompanyProfileSaving] = useState(false);
  const [companyProfileMessage, setCompanyProfileMessage] = useState('');
  const [employeeColumnOrder, setEmployeeColumnOrder] = useState(() => {
    const saved = getSavedTemplate(COMPANY_OVERVIEW_EMPLOYEE_LIST_ID);
    return normalizeEmployeeColumnOrder(saved?.columnOrder, COMPANY_OVERVIEW_EMPLOYEE_COLUMN_KEYS);
  });
  const [employeeDraggingKey, setEmployeeDraggingKey] = useState('');
  const [employeeDragOverKey, setEmployeeDragOverKey] = useState('');
  const [employeeSortConfig, setEmployeeSortConfig] = useState({ key: '', dir: '' });
  const [employeeActiveFilters, setEmployeeActiveFilters] = useState({});
  const [employeeOpenFilterKey, setEmployeeOpenFilterKey] = useState('');
  const [employeeFilterSearch, setEmployeeFilterSearch] = useState('');
  const [employeeDraftSelected, setEmployeeDraftSelected] = useState([]);
  const [employeeFilterMenuPosition, setEmployeeFilterMenuPosition] = useState({ top: 0, left: 0 });
  const [employeeFilterAnchor, setEmployeeFilterAnchor] = useState({ x: 0, y: 0 });
  const employeeFilterMenuRef = useRef(null);
  const mindContainerRef = useRef(null);
  const mindInstanceRef = useRef(null);

  const roleLabel = (role) => {
    if (role === 'owner') return '대표 (Owner)';
    if (role === 'admin' || role === 'senior') return '관리자 (Admin)';
    if (role === 'manager' || role === 'practitioner' || role === 'contributor') return '실무자 (Manager)';
    if (role === 'pending') return '권한 대기 (Pending)';
    return '직원 (Staff)';
  };

  const refreshOverview = useCallback(async () => {
    const res = await fetch(`${API_BASE}/companies/overview`, crmFetchInit());
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || '조회에 실패했습니다.');
    setData(json);
  }, []);

  const loadHandoverPending = useCallback(async () => {
    const role = data?.me?.role;
    if (!['owner', 'admin', 'senior'].includes(role)) {
      setHandoverViewerCanConsent(false);
      setHandoverPendingGroups([]);
      return;
    }
    setHandoverPendingLoading(true);
    try {
      const r = await fetch(`${API_BASE}/companies/assignee-handover-requests/pending`, crmFetchInit());
      const json = await r.json().catch(() => ({}));
      if (Array.isArray(json?.groups)) {
        setHandoverViewerCanConsent(Boolean(json.viewerCanConsent));
        setHandoverPendingGroups(json.groups);
        return;
      }
      if (Array.isArray(json?.items)) {
        setHandoverViewerCanConsent(true);
        setHandoverPendingGroups(
          json.items.map((h) => ({
            batchKey: `legacy:${h.id}`,
            subjectLine: `[Nexvia CRM] 담당 이관 승인 요청 · ${h.targetLabel || '—'}`,
            fromName: h.fromName,
            toName: h.toName,
            requesterName: h.requesterName,
            ownerName: '',
            consentRequiredUsers: [],
            useBatchApprove: false,
            approveBatchId: null,
            approveRequestId: h.id ? String(h.id) : null,
            requestReason: '',
            items: [
              {
                id: h.id,
                targetType: h.targetType,
                targetLabel: h.targetLabel,
                createdAt: h.createdAt,
                expiresAt: h.expiresAt
              }
            ]
          }))
        );
        return;
      }
      setHandoverViewerCanConsent(false);
      setHandoverPendingGroups([]);
    } catch {
      setHandoverViewerCanConsent(false);
      setHandoverPendingGroups([]);
    } finally {
      setHandoverPendingLoading(false);
    }
  }, [data?.me?.role]);

  const approveHandoverInApp = useCallback(
    async (g) => {
      const body =
        g.useBatchApprove && g.approveBatchId
          ? { batchId: g.approveBatchId }
          : g.approveRequestId
            ? { requestId: g.approveRequestId }
            : null;
      if (!body) {
        setHandoverActionError('동의할 수 있는 요청 정보가 없습니다.');
        return;
      }
      setHandoverActionError('');
      setHandoverApprovingKey(g.batchKey);
      try {
        const res = await fetch(`${API_BASE}/companies/assignee-handover-requests/approve-in-app`, {
          method: 'POST',
          headers: { ...getCrmAuthHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out.error || '동의 처리에 실패했습니다.');
        await loadHandoverPending();
        await refreshOverview();
      } catch (e) {
        setHandoverActionError(e.message || '동의 처리에 실패했습니다.');
      } finally {
        setHandoverApprovingKey('');
      }
    },
    [loadHandoverPending, refreshOverview]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await refreshOverview();
      } catch (e) {
        if (!cancelled) setError(e.message || '사내 현황을 불러올 수 없습니다.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [refreshOverview]);

  useEffect(() => {
    if (loading || error) return;
    loadHandoverPending();
  }, [loading, error, loadHandoverPending]);

  const { company = {}, employees = [], subscription = {} } = data || {};
  const departmentLeaderList = data?.departmentLeaderList || [];
  const me = data?.me || {};
  const canManageRoles = ['owner', 'admin', 'senior'].includes(me.role);
  /** 부서 팀장 배지 지정 — Owner / Admin 만 (Manager·Staff 불가) */
  const canManageDepartmentLeaders = ['owner', 'admin'].includes(me.role);
  const showHandoverConsentCard = canManageRoles && (handoverPendingLoading || handoverViewerCanConsent);

  const formatHandoverConsentNames = (users) => {
    if (!Array.isArray(users) || users.length === 0) return '—';
    const s = users.map((u) => (u && (u.name || u.email)) || '').filter(Boolean).join(', ');
    return s || '—';
  };
  const orgDeptOptions = useMemo(() => {
    if (!orgChart || typeof orgChart !== 'object') return [];
    return flattenOrgChartOptions(orgChart);
  }, [orgChart]);

  const applyDepartmentLeaderToggle = useCallback(async (emp) => {
    const uid = String(emp.id || '').trim();
    const dept = String(emp.department || '').trim();
    if (!uid || !dept) return;
    if (!orgDeptOptions.some((o) => o.id === dept)) return;
    const list = (Array.isArray(data?.departmentLeaderList) ? data.departmentLeaderList : []).map((x) => ({
      userId: String(x.userId),
      departmentId: String(x.departmentId || '').trim()
    }));
    const isOn = list.some((l) => l.userId === uid && l.departmentId === dept);
    let next;
    if (isOn) {
      next = list.filter((l) => !(l.userId === uid && l.departmentId === dept));
    } else {
      next = list.filter((l) => l.userId !== uid && l.departmentId !== dept);
      next.push({ userId: uid, departmentId: dept });
    }
    setSavingDeptLeader(true);
    setActionError('');
    try {
      const res = await fetch(`${API_BASE}/companies/department-leaders`, crmFetchInit({ method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leaders: next  })
      }));
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || '부서 팀장 저장에 실패했습니다.');
      await refreshOverview();
    } catch (e) {
      setActionError(e.message || '부서 팀장 저장에 실패했습니다.');
    } finally {
      setSavingDeptLeader(false);
    }
  }, [data?.departmentLeaderList, orgDeptOptions, refreshOverview]);

  useEffect(() => {
    if (company?.organizationChart) setOrgChart(company.organizationChart);
  }, [company?.organizationChart]);

  const saveOrgChart = useCallback(async (nextTree) => {
    setOrgSaving(true);
    try {
      const res = await fetch(`${API_BASE}/companies/organization-chart`, crmFetchInit({ method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationChart: nextTree  })
      }));
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || '조직도 저장 실패');
      setOrgChart(json.organizationChart || nextTree);
      setData((prev) => (prev
        ? {
            ...prev,
            company: { ...prev.company, organizationChart: json.organizationChart || nextTree },
            departmentLeaderList: json.departmentLeaderList ?? prev.departmentLeaderList
          }
        : prev));
    } catch (e) {
      setActionError(e.message || '조직도 저장 실패');
    } finally {
      setOrgSaving(false);
    }
  }, []);

  const toMindNode = useCallback((node) => {
    if (!node) return null;
    return {
      id: String(node.id || `org_${Date.now().toString(36)}`),
      topic: node.roleLabel ? `${node.name || ''}\n${node.roleLabel}` : (node.name || ''),
      children: (node.children || []).map(toMindNode).filter(Boolean)
    };
  }, []);

  const toOrgNode = useCallback((node) => {
    const lines = String(node?.topic || '').split('\n');
    const name = String(lines[0] || '').trim() || '새 조직';
    const roleLabel = String(lines.slice(1).join('\n') || '').trim();
    return {
      id: String(node?.id || `org_${Date.now().toString(36)}`),
      name,
      roleLabel,
      children: Array.isArray(node?.children) ? node.children.map(toOrgNode) : []
    };
  }, []);

  useEffect(() => {
    if (!orgChart || !mindContainerRef.current) return undefined;
    let cancelled = false;
    let debounceTimer = 0;
    /** @type {ResizeObserver | null} */
    let resizeObs = null;
    let mindForCleanup = null;

    const scheduleFitDebounced = () => {
      window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => {
        debounceTimer = 0;
        if (cancelled || !mindForCleanup) return;
        mindOrgFitToView(mindForCleanup);
      }, 120);
    };

    const scheduleFitSoon = () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (cancelled || !mindForCleanup) return;
          mindOrgFitToView(mindForCleanup);
        });
      });
    };

    const onOperation = () => scheduleFitDebounced();
    const onExpandNode = () => scheduleFitSoon();

    (async () => {
      const mod = await import('mind-elixir');
      const MindElixir = mod.default;
      if (cancelled || !mindContainerRef.current) return;
      if (mindInstanceRef.current) {
        mindInstanceRef.current.destroy();
        mindInstanceRef.current = null;
      }
      const editable = canManageRoles;
      const mind = new MindElixir({
        el: mindContainerRef.current,
        direction: MindElixir.RIGHT,
        theme: CO_ORG_MIND_THEME,
        editable,
        contextMenu: editable,
        toolBar: false,
        keypress: editable
          ? {
            F1: (ev) => {
              ev.preventDefault();
            }
          }
          : false,
        allowUndo: editable,
        newTopicName: '새 조직',
        scaleMin: CO_ORG_SCALE_MIN,
        scaleMax: CO_ORG_SCALE_MAX,
        generateMainBranch: mindOrgGenerateMainBranch,
        generateSubBranch: mindOrgGenerateSubBranch,
        handleWheel: mindOrgHandleWheelDelegatePageScroll
      });
      mind.toCenter = function coOrgMindToCenter() {
        mindOrgFitToView(this);
      };
      mind.linkDiv = function coOrgLinkDiv(partial) {
        return coOrgPn(this, partial);
      };
      mindForCleanup = mind;
      if (cancelled) {
        mind.destroy();
        mindForCleanup = null;
        return;
      }
      mind.init({ nodeData: toMindNode(orgChart) });
      if (cancelled) {
        mind.destroy();
        mindForCleanup = null;
        return;
      }
      /** 데스크톱만 드래그 무력화(실수 이동 방지). 모바일은 확대된 조직도를 손가락으로 패닝 */
      if (typeof window !== 'undefined' && window.innerWidth > 768) {
        mind.dragMoveHelper.onMove = () => { };
      }
      mindInstanceRef.current = mind;
      mind.bus.addListener('operation', onOperation);
      mind.bus.addListener('expandNode', onExpandNode);
      if (typeof ResizeObserver !== 'undefined' && mind.container) {
        resizeObs = new ResizeObserver(() => scheduleFitSoon());
        resizeObs.observe(mind.container);
      }
      scheduleFitSoon();
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(debounceTimer);
      if (mindForCleanup?.bus) {
        mindForCleanup.bus.removeListener('operation', onOperation);
        mindForCleanup.bus.removeListener('expandNode', onExpandNode);
      }
      resizeObs?.disconnect();
      if (mindForCleanup) {
        mindForCleanup.destroy();
        mindForCleanup = null;
      }
      if (mindInstanceRef.current) {
        mindInstanceRef.current = null;
      }
    };
  }, [orgChart, toMindNode, canManageRoles]);

  const handleSaveMindOrgChart = async () => {
    if (!canManageRoles) return;
    if (!mindInstanceRef.current) return;
    const data = mindInstanceRef.current.getData();
    const nodeData = data?.nodeData || data;
    const nextTree = toOrgNode(nodeData);
    await saveOrgChart(nextTree);
  };

  const handleOrgMindAddChild = useCallback(() => {
    if (!canManageRoles) return;
    const mind = mindInstanceRef.current;
    if (!mind) return;
    if (!mind.currentNode) {
      setActionError('하위 조직을 추가하려면 부모가 될 칸을 먼저 클릭해 선택하세요.');
      return;
    }
    setActionError('');
    void mind.addChild().catch(() => { });
  }, [canManageRoles]);

  const handleOrgMindRemove = useCallback(() => {
    if (!canManageRoles) return;
    const mind = mindInstanceRef.current;
    if (!mind) return;
    const nodes = mind.currentNodes || [];
    const removable = nodes.filter((n) => n?.nodeObj?.parent);
    if (removable.length === 0) {
      if (nodes.length > 0) setActionError('최상위(대표) 노드는 삭제할 수 없습니다. 하위 노드를 선택하세요.');
      else setActionError('삭제할 노드를 먼저 클릭해 선택하세요.');
      return;
    }
    setActionError('');
    void mind.removeNodes(removable).catch(() => { });
  }, [canManageRoles]);
  const openCompanyProfileEdit = useCallback(() => {
    setCompanyProfileMessage('');
    setCompanyProfileForm({
      name: String(company.name || '').trim(),
      businessNumber: String(company.businessNumber || '').trim(),
      representativeName: String(company.representativeName || '').trim(),
      representativeEmail: String(company.representativeEmail || '').trim(),
      address: String(company.address || '').trim(),
      addressDetail: String(company.addressDetail || '').trim(),
      businessType: String(company.businessType || '').trim(),
      businessItem: String(company.businessItem || '').trim(),
      subBusinessNumber: String(company.subBusinessNumber || '').trim()
    });
    setCompanyProfileEditing(true);
  }, [company]);

  const cancelCompanyProfileEdit = useCallback(() => {
    setCompanyProfileEditing(false);
    setCompanyProfileForm(null);
    setCompanyProfileMessage('');
  }, []);

  const saveCompanyProfile = useCallback(async () => {
    if (!companyProfileForm) return;
    setCompanyProfileSaving(true);
    setCompanyProfileMessage('');
    setActionError('');
    try {
      const res = await fetch(`${API_BASE}/companies/profile`, {
        method: 'PATCH',
        headers: { ...getCrmAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(companyProfileForm)
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || '소속 회사 정보 저장에 실패했습니다.');
      setData((prev) => (prev
        ? { ...prev, company: { ...prev.company, ...(out.company || {}) } }
        : prev));
      setCompanyProfileEditing(false);
      setCompanyProfileForm(null);
      setCompanyProfileMessage('저장되었습니다. 변경 내용은 공지사항에 등록되어 직원들이 확인할 수 있습니다.');
    } catch (e) {
      setActionError(e.message || '소속 회사 정보 저장에 실패했습니다.');
    } finally {
      setCompanyProfileSaving(false);
    }
  }, [companyProfileForm]);
  const isPendingUser = me.role === 'pending';
  /** 구독·시트 블록: Admin·Owner (레거시 senior 포함) */
  const canSeeSubscriptionSection = ['owner', 'admin', 'senior'].includes(me.role);
  const canEditRole = (emp) => canManageRoles && String(emp.id) !== String(me.id) && emp.role !== 'owner';
  const canEditMemberMeta = (emp) => canManageRoles && !!String(emp?.id || '').trim();

  const openMemberEditModal = useCallback((emp) => {
    if (!canEditMemberMeta(emp)) return;
    const deptRaw = String(emp.department || '').trim();
    const deptInOrg = deptRaw && orgDeptOptions.some((o) => o.id === deptRaw);
    const isDeptLeader = deptRaw && departmentLeaderList.some(
      (l) => String(l.userId) === String(emp.id) && String(l.departmentId) === deptRaw
    );
    setMemberEditForm({
      id: String(emp.id),
      name: emp.name || emp.email || '직원',
      role: String(emp.role || 'pending'),
      department: deptRaw,
      rank: String(emp.rank || '').trim(),
      title: String(emp.title || '').trim(),
      deptInOrg: Boolean(deptInOrg),
      isDeptLeader: Boolean(isDeptLeader)
    });
    setMemberEditOpen(true);
  }, [canEditMemberMeta, departmentLeaderList, orgDeptOptions]);

  const closeMemberEditModal = useCallback(() => {
    if (savingMemberId || savingDeptLeader) return;
    setMemberEditOpen(false);
    setMemberEditForm(null);
  }, [savingDeptLeader, savingMemberId]);

  const saveMemberEditModal = useCallback(async () => {
    if (!memberEditForm?.id) return;
    setActionError('');
    const department = String(memberEditForm.department || '').trim();
    const title = String(memberEditForm.title || '').trim();
    if (!department) {
      alert('부서는 필수 입력입니다.');
      return;
    }
    if (!title) {
      alert('역할은 필수 입력입니다.');
      return;
    }
    const patch = {
      role: memberEditForm.role,
      department,
      rank: memberEditForm.rank || '',
      title
    };
    const ok = await updateMemberAccess(memberEditForm.id, patch);
    if (!ok) return;
    if (canManageDepartmentLeaders) {
      const currentDept = String(memberEditForm.department || '').trim();
      const currentLeader = currentDept && departmentLeaderList.some(
        (l) => String(l.userId) === String(memberEditForm.id) && String(l.departmentId) === currentDept
      );
      if (Boolean(currentLeader) !== Boolean(memberEditForm.isDeptLeader) && currentDept && orgDeptOptions.some((o) => o.id === currentDept)) {
        await applyDepartmentLeaderToggle({ id: memberEditForm.id, department: currentDept });
      }
    }
    setMemberEditOpen(false);
    setMemberEditForm(null);
  }, [
    applyDepartmentLeaderToggle,
    canManageDepartmentLeaders,
    departmentLeaderList,
    memberEditForm,
    orgDeptOptions,
    updateMemberAccess
  ]);
  /** 구독 시트: 대표·관리자·실무자·직원(비-pending) 인원만큼만 부여 가능 */
  const subActive = subscription?.hasActiveSubscription === true;
  const seatsRemaining = subscription?.seatsRemaining;
  const noSeatForPromotion = subActive && typeof seatsRemaining === 'number' && seatsRemaining <= 0;

  const baseSortedEmployees = useMemo(() => {
    const order = {
      owner: 0,
      admin: 1,
      senior: 1,
      manager: 2,
      practitioner: 2,
      contributor: 2,
      staff: 3,
      pending: 4
    };
    return [...employees].map((emp) => {
      const deptRaw = String(emp.department || '').trim();
      const isDeptLeader = Boolean(
        deptRaw && departmentLeaderList.some(
          (l) => String(l.userId) === String(emp.id) && String(l.departmentId) === deptRaw
        )
      );
      return {
        ...emp,
        _deptLabel: resolveDeptDisplay(orgChart, emp.department) || '—',
        _isDeptLeader: isDeptLeader,
        _roleLabel: roleLabel(emp.role)
      };
    }).sort((a, b) => {
      const ra = order[a.role] ?? 99;
      const rb = order[b.role] ?? 99;
      if (ra !== rb) return ra - rb;
      return (a.name || a.email || '').localeCompare(b.name || b.email || '', 'ko');
    });
  }, [departmentLeaderList, employees, orgChart]);

  useEffect(() => {
    const saved = getSavedTemplate(COMPANY_OVERVIEW_EMPLOYEE_LIST_ID);
    setEmployeeColumnOrder(normalizeEmployeeColumnOrder(saved?.columnOrder, COMPANY_OVERVIEW_EMPLOYEE_COLUMN_KEYS));
  }, []);

  const orderedEmployeeColumns = useMemo(() => {
    const byKey = new Map(COMPANY_OVERVIEW_EMPLOYEE_COLUMNS.map((col) => [col.key, col]));
    const normalizedOrder = normalizeEmployeeColumnOrder(employeeColumnOrder, COMPANY_OVERVIEW_EMPLOYEE_COLUMN_KEYS);
    return normalizedOrder.map((k) => byKey.get(k)).filter(Boolean);
  }, [employeeColumnOrder]);

  const employeeFilterOptionsByKey = useMemo(() => {
    const map = {};
    orderedEmployeeColumns.forEach((col) => {
      map[col.key] = getUniqueEmployeeFilterOptions(baseSortedEmployees, col.key);
    });
    return map;
  }, [baseSortedEmployees, orderedEmployeeColumns]);

  const filteredAndSortedEmployees = useMemo(() => {
    let rows = [...baseSortedEmployees];
    Object.entries(employeeActiveFilters || {}).forEach(([key, selectedValues]) => {
      if (!Array.isArray(selectedValues) || selectedValues.length === 0) return;
      const allowed = new Set(selectedValues);
      rows = rows.filter((row) => allowed.has(getEmployeeCellText(row, key)));
    });
    return sortEmployeeRows(rows, employeeSortConfig);
  }, [baseSortedEmployees, employeeActiveFilters, employeeSortConfig]);

  const persistEmployeeColumnOrder = useCallback(async (nextOrder) => {
    try {
      await patchListTemplate(COMPANY_OVERVIEW_EMPLOYEE_LIST_ID, { columnOrder: nextOrder });
    } catch (_) {
      // no-op
    }
  }, []);

  const handleEmployeeHeaderDragOver = (e, key) => {
    if (!employeeDraggingKey || employeeDraggingKey === key) return;
    e.preventDefault();
    setEmployeeDragOverKey(key);
  };

  const handleEmployeeHeaderDrop = (targetKey) => {
    if (!employeeDraggingKey || employeeDraggingKey === targetKey) {
      setEmployeeDraggingKey('');
      setEmployeeDragOverKey('');
      return;
    }
    const next = [...normalizeEmployeeColumnOrder(employeeColumnOrder, COMPANY_OVERVIEW_EMPLOYEE_COLUMN_KEYS)];
    const from = next.indexOf(employeeDraggingKey);
    const to = next.indexOf(targetKey);
    if (from < 0 || to < 0) {
      setEmployeeDraggingKey('');
      setEmployeeDragOverKey('');
      return;
    }
    next.splice(from, 1);
    next.splice(to, 0, employeeDraggingKey);
    const normalized = normalizeEmployeeColumnOrder(next, COMPANY_OVERVIEW_EMPLOYEE_COLUMN_KEYS);
    setEmployeeColumnOrder(normalized);
    setEmployeeDraggingKey('');
    setEmployeeDragOverKey('');
    persistEmployeeColumnOrder(normalized);
  };

  const placeEmployeeFilterMenu = useCallback((anchorX, anchorY) => {
    const menuEl = employeeFilterMenuRef.current;
    const menuW = menuEl?.offsetWidth || 220;
    const menuH = menuEl?.offsetHeight || 320;
    let left = anchorX + COMPANY_OVERVIEW_FILTER_MENU_CURSOR_GAP;
    let top = anchorY + COMPANY_OVERVIEW_FILTER_MENU_CURSOR_GAP;
    if (left + menuW > window.innerWidth - COMPANY_OVERVIEW_FILTER_MENU_VIEWPORT_MARGIN) left = anchorX - menuW - COMPANY_OVERVIEW_FILTER_MENU_CURSOR_GAP;
    if (top + menuH > window.innerHeight - COMPANY_OVERVIEW_FILTER_MENU_VIEWPORT_MARGIN) top = anchorY - menuH - COMPANY_OVERVIEW_FILTER_MENU_CURSOR_GAP;
    left = Math.min(
      Math.max(COMPANY_OVERVIEW_FILTER_MENU_VIEWPORT_MARGIN, left),
      Math.max(COMPANY_OVERVIEW_FILTER_MENU_VIEWPORT_MARGIN, window.innerWidth - menuW - COMPANY_OVERVIEW_FILTER_MENU_VIEWPORT_MARGIN)
    );
    top = Math.min(
      Math.max(COMPANY_OVERVIEW_FILTER_MENU_VIEWPORT_MARGIN, top),
      Math.max(COMPANY_OVERVIEW_FILTER_MENU_VIEWPORT_MARGIN, window.innerHeight - menuH - COMPANY_OVERVIEW_FILTER_MENU_VIEWPORT_MARGIN)
    );
    setEmployeeFilterMenuPosition({ top, left });
  }, []);

  const openEmployeeFilter = (key, mousePoint) => {
    const allOptions = employeeFilterOptionsByKey[key] || [];
    const selected = Array.isArray(employeeActiveFilters[key]) && employeeActiveFilters[key].length > 0
      ? employeeActiveFilters[key]
      : allOptions;
    const anchorX = Number(mousePoint?.x) || 0;
    const anchorY = Number(mousePoint?.y) || 0;
    setEmployeeFilterAnchor({ x: anchorX, y: anchorY });
    placeEmployeeFilterMenu(anchorX, anchorY);
    setEmployeeOpenFilterKey(key);
    setEmployeeFilterSearch('');
    setEmployeeDraftSelected(selected);
  };

  const applyEmployeeFilter = () => {
    if (!employeeOpenFilterKey) return;
    const key = employeeOpenFilterKey;
    const allOptions = employeeFilterOptionsByKey[key] || [];
    const normalized = [...new Set(employeeDraftSelected)];
    setEmployeeActiveFilters((prev) => {
      const next = { ...prev };
      if (normalized.length === 0 || normalized.length === allOptions.length) delete next[key];
      else next[key] = normalized;
      return next;
    });
    setEmployeeOpenFilterKey('');
  };

  const clearEmployeeFilter = (key) => {
    setEmployeeActiveFilters((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    if (employeeOpenFilterKey === key) setEmployeeOpenFilterKey('');
  };

  useEffect(() => {
    if (!employeeOpenFilterKey) return undefined;
    const onDocDown = (e) => {
      if (employeeFilterMenuRef.current && !employeeFilterMenuRef.current.contains(e.target)) {
        setEmployeeOpenFilterKey('');
      }
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [employeeOpenFilterKey]);

  useEffect(() => {
    if (!employeeOpenFilterKey) return undefined;
    const closeMenu = () => setEmployeeOpenFilterKey('');
    window.addEventListener('resize', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    return () => {
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
    };
  }, [employeeOpenFilterKey]);

  useEffect(() => {
    if (!isPendingUser) {
      setSelectedApproverIds((prev) => (prev.length ? [] : prev));
      return;
    }
    setSelectedApproverIds((prev) => {
      const next = prev.filter((id) => employees.some((emp) => String(emp.id) === String(id)));
      if (next.length === prev.length && next.every((id, idx) => id === prev[idx])) return prev;
      return next;
    });
  }, [employees, isPendingUser]);

  if (loading) {
    return (
      <div className="page company-overview-page">
        <header className="page-header company-overview-header">
          <h1 className="page-title">사내 현황</h1>
          <div className="company-overview-header-tools">
            <PageHeaderNotifyChat />
          </div>
        </header>
        <div className="page-content company-overview-content">
          <p className="company-overview-loading">불러오는 중...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page company-overview-page">
        <header className="page-header company-overview-header">
          <h1 className="page-title">사내 현황</h1>
          <div className="company-overview-header-tools">
            <PageHeaderNotifyChat />
          </div>
        </header>
        <div className="page-content company-overview-content">
          <p className="company-overview-error">{error}</p>
        </div>
      </div>
    );
  }

  async function updateMemberAccess(memberId, patch) {
    setActionError('');
    setRequestMessage('');
    setSavingMemberId(String(memberId));
    try {
      const res = await fetch(`${API_BASE}/companies/members/${memberId}/access`, crmFetchInit({ method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch)
       }));
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || '직원 정보 변경에 실패했습니다.');
      await refreshOverview();
      return true;
    } catch (e) {
      setActionError(e.message || '직원 정보 변경에 실패했습니다.');
      return false;
    } finally {
      setSavingMemberId('');
    }
  }

  const toggleApproverSelection = (memberId) => {
    const normalizedId = String(memberId);
    setSelectedApproverIds((prev) => (
      prev.includes(normalizedId)
        ? prev.filter((id) => id !== normalizedId)
        : [...prev, normalizedId]
    ));
  };

  const sendAccessRequest = async () => {
    setActionError('');
    setRequestMessage('');
    if (selectedApproverIds.length === 0) {
      setActionError('권한 요청을 받을 대표 또는 관리자를 선택해 주세요.');
      return;
    }
    setRequestSending(true);
    try {
      const res = await fetch(`${API_BASE}/companies/access-requests`, crmFetchInit({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approverUserIds: selectedApproverIds  })
      }));
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || '권한 요청 메일 전송에 실패했습니다.');
      const recipientLabel = (json.approvers || []).map((item) => item.name || item.email).filter(Boolean).join(', ');
      setRequestMessage(recipientLabel ? `${recipientLabel}에게 권한 요청 메일을 보냈습니다.` : '권한 요청 메일을 보냈습니다.');
      setSelectedApproverIds([]);
    } catch (e) {
      setActionError(e.message || '권한 요청 메일 전송에 실패했습니다.');
    } finally {
      setRequestSending(false);
    }
  };

  return (
    <div className="page company-overview-page">
      <header className="page-header company-overview-header">
        <h1 className="page-title">사내 현황</h1>
        <div className="company-overview-header-tools">
          <button
            type="button"
            className="company-overview-settings-btn"
            onClick={() => setShowDriveSettingsModal(true)}
            title="전체 공유 드라이브 설정"
            aria-label="전체 공유 드라이브 설정"
          >
            <span className="material-symbols-outlined">settings</span>
          </button>
          <PageHeaderNotifyChat />
        </div>
      </header>
      <div className="page-content company-overview-content">
        <p className="company-overview-workspace-hint" role="note">
          <GoogleWorkspaceChatPolicyHint />
        </p>
        {actionError && <p className="company-overview-error company-overview-inline-error">{actionError}</p>}
        <section className="company-overview-card company-info-card">
          <div className="company-info-card-head">
            <h2 className="company-overview-section-title">
              <span className="material-symbols-outlined">business</span>
              소속 회사
            </h2>
            {canManageRoles && !companyProfileEditing ? (
              <button
                type="button"
                className="co-company-profile-edit-btn"
                onClick={openCompanyProfileEdit}
                title="소속 회사 정보 수정"
              >
                <span className="material-symbols-outlined">edit</span>
                수정
              </button>
            ) : null}
          </div>
          {companyProfileMessage ? (
            <p className="company-overview-request-message co-company-profile-message" role="status">
              {companyProfileMessage}
            </p>
          ) : null}
          {companyProfileEditing && companyProfileForm ? (
            <div className="co-company-profile-edit">
              <div className="co-company-profile-field">
                <label htmlFor="co-profile-name">회사명</label>
                <input
                  id="co-profile-name"
                  type="text"
                  value={companyProfileForm.name}
                  onChange={(e) => setCompanyProfileForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="co-company-profile-field">
                <label htmlFor="co-profile-bn">사업자번호</label>
                <input
                  id="co-profile-bn"
                  type="text"
                  inputMode="numeric"
                  value={companyProfileForm.businessNumber}
                  onChange={(e) => setCompanyProfileForm((f) => ({
                    ...f,
                    businessNumber: formatBusinessNumberInput(e.target.value)
                  }))}
                  placeholder="000-00-00000"
                />
              </div>
              <div className="co-company-profile-field">
                <label htmlFor="co-profile-rep">대표자</label>
                <input
                  id="co-profile-rep"
                  type="text"
                  value={companyProfileForm.representativeName}
                  onChange={(e) => setCompanyProfileForm((f) => ({ ...f, representativeName: e.target.value }))}
                />
              </div>
              <div className="co-company-profile-field">
                <label htmlFor="co-profile-rep-email">대표이사 이메일</label>
                <input
                  id="co-profile-rep-email"
                  type="email"
                  autoComplete="email"
                  value={companyProfileForm.representativeEmail}
                  onChange={(e) => setCompanyProfileForm((f) => ({ ...f, representativeEmail: e.target.value }))}
                  placeholder="ceo@company.com"
                />
              </div>
              <div className="co-company-profile-field">
                <label htmlFor="co-profile-address">주소</label>
                <input
                  id="co-profile-address"
                  type="text"
                  value={companyProfileForm.address}
                  onChange={(e) => setCompanyProfileForm((f) => ({ ...f, address: e.target.value }))}
                />
              </div>
              <div className="co-company-profile-field">
                <label htmlFor="co-profile-address-detail">상세주소</label>
                <input
                  id="co-profile-address-detail"
                  type="text"
                  value={companyProfileForm.addressDetail}
                  onChange={(e) => setCompanyProfileForm((f) => ({ ...f, addressDetail: e.target.value }))}
                />
              </div>
              <div className="co-company-profile-field">
                <label htmlFor="co-profile-biz-type">업태</label>
                <input
                  id="co-profile-biz-type"
                  type="text"
                  value={companyProfileForm.businessType}
                  onChange={(e) => setCompanyProfileForm((f) => ({ ...f, businessType: e.target.value }))}
                  placeholder="예: 도매 및 소매업"
                />
              </div>
              <div className="co-company-profile-field">
                <label htmlFor="co-profile-biz-item">종목</label>
                <input
                  id="co-profile-biz-item"
                  type="text"
                  value={companyProfileForm.businessItem}
                  onChange={(e) => setCompanyProfileForm((f) => ({ ...f, businessItem: e.target.value }))}
                  placeholder="예: 컴퓨터 프로그램 개발·공급"
                />
              </div>
              <div className="co-company-profile-field">
                <label htmlFor="co-profile-sub-bn">종사업장 번호</label>
                <input
                  id="co-profile-sub-bn"
                  type="text"
                  inputMode="numeric"
                  maxLength={4}
                  value={companyProfileForm.subBusinessNumber}
                  onChange={(e) => setCompanyProfileForm((f) => ({
                    ...f,
                    subBusinessNumber: formatSubBusinessNumberInput(e.target.value)
                  }))}
                  placeholder="0001"
                />
              </div>
              <div className="co-company-profile-actions">
                <button
                  type="button"
                  className="co-company-profile-cancel-btn"
                  onClick={cancelCompanyProfileEdit}
                  disabled={companyProfileSaving}
                >
                  취소
                </button>
                <button
                  type="button"
                  className="co-company-profile-save-btn"
                  onClick={saveCompanyProfile}
                  disabled={companyProfileSaving}
                >
                  <span className="material-symbols-outlined">save</span>
                  {companyProfileSaving ? '저장 중…' : '저장'}
                </button>
              </div>
            </div>
          ) : (
            <dl className="company-info-list">
              <div className="company-info-row">
                <dt>회사명</dt>
                <dd>{company.name || '—'}</dd>
              </div>
              <div className="company-info-row">
                <dt>사업자번호</dt>
                <dd>{company.businessNumber || '—'}</dd>
              </div>
              <div className="company-info-row">
                <dt>대표자</dt>
                <dd>{company.representativeName || '—'}</dd>
              </div>
              <div className="company-info-row">
                <dt>대표이사 이메일</dt>
                <dd>{company.representativeEmail || '—'}</dd>
              </div>
              <div className="company-info-row">
                <dt>주소</dt>
                <dd>{company.address || '—'}</dd>
              </div>
              <div className="company-info-row">
                <dt>상세주소</dt>
                <dd>{company.addressDetail || '—'}</dd>
              </div>
              <div className="company-info-row">
                <dt>업태</dt>
                <dd>{company.businessType || '—'}</dd>
              </div>
              <div className="company-info-row">
                <dt>종목</dt>
                <dd>{company.businessItem || '—'}</dd>
              </div>
              <div className="company-info-row">
                <dt>종사업장 번호</dt>
                <dd>{company.subBusinessNumber || '—'}</dd>
              </div>
            </dl>
          )}
        </section>

        {showHandoverConsentCard && (
          <section className="company-overview-card co-handover-pending-card" aria-labelledby="co-handover-title">
            <h2 id="co-handover-title" className="company-overview-section-title">
              <span className="material-symbols-outlined">swap_horiz</span>
              담당 이관 승인 대기
            </h2>
            <p className="co-handover-pending-lead">
              동의가 필요한 관리자에게만 표시됩니다. 메일과 동일하게 <strong>인수·인계·대표(Owner)·동의·승인</strong> 정보를
              보여 주며, 아래 버튼으로 메일의 「동의하기」와 같은 반영을 할 수 있습니다. 여러 건 묶음은{' '}
              <strong>전체 동의하기 · 반영</strong>으로 한 번에 처리됩니다.
            </p>
            {handoverActionError ? (
              <p className="company-overview-error company-overview-inline-error co-handover-inline-error" role="alert">
                {handoverActionError}
              </p>
            ) : null}
            {handoverPendingLoading ? (
              <p className="company-overview-empty">불러오는 중...</p>
            ) : handoverPendingGroups.length === 0 ? (
              <p className="company-overview-empty">대기 중인 신청이 없습니다.</p>
            ) : (
              <ul className="co-handover-pending-list">
                {handoverPendingGroups.map((g) => (
                  <li key={g.batchKey} className="co-handover-pending-item co-handover-group-card">
                    <p className="co-handover-group-subject">{g.subjectLine}</p>
                    {g.requestReason ? (
                      <div className="co-handover-reason-box">
                        <span className="co-handover-reason-k">이관 사유</span>
                        <p className="co-handover-reason-v">{g.requestReason}</p>
                      </div>
                    ) : null}
                    <div className="co-handover-group-people" role="group" aria-label="인수·인계·대표·동의">
                      <div className="co-handover-ppl-cell">
                        <span className="co-handover-ppl-k">인수자</span>
                        <span className="co-handover-ppl-hint">(새 담당)</span>
                        <strong className="co-handover-ppl-v">{g.toName || '—'}</strong>
                      </div>
                      <div className="co-handover-ppl-cell">
                        <span className="co-handover-ppl-k">인계자</span>
                        <span className="co-handover-ppl-hint">(기존 담당)</span>
                        <strong className="co-handover-ppl-v">{g.fromName || '—'}</strong>
                      </div>
                      <div className="co-handover-ppl-cell">
                        <span className="co-handover-ppl-k">대표 (Owner)</span>
                        <span className="co-handover-ppl-hint">(회사)</span>
                        <strong className="co-handover-ppl-v">{g.ownerName || '—'}</strong>
                      </div>
                      <div className="co-handover-ppl-cell">
                        <span className="co-handover-ppl-k">동의·승인</span>
                        <span className="co-handover-ppl-hint">(관리자)</span>
                        <strong className="co-handover-ppl-v co-handover-ppl-consent">
                          {formatHandoverConsentNames(g.consentRequiredUsers)}
                        </strong>
                      </div>
                    </div>
                    <p className="co-handover-group-requester">
                      신청자: <strong>{g.requesterName || '—'}</strong>
                    </p>
                    {g.items && g.items.length > 0 ? (
                      <ul className="co-handover-group-targets" aria-label="신청 대상 항목">
                        {g.items.map((it) => (
                          <li key={String(it.id)}>{it.targetLabel || '—'}</li>
                        ))}
                      </ul>
                    ) : null}
                    <div className="co-handover-approve-row">
                      <button
                        type="button"
                        className="co-handover-approve-btn"
                        onClick={() => approveHandoverInApp(g)}
                        disabled={
                          handoverApprovingKey === g.batchKey ||
                          (!g.useBatchApprove && !g.approveRequestId) ||
                          (g.useBatchApprove && !g.approveBatchId)
                        }
                      >
                        {handoverApprovingKey === g.batchKey
                          ? '처리 중…'
                          : g.useBatchApprove
                            ? '전체 동의하기 · 반영'
                            : '동의하기 · 반영'}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <section className="company-overview-card employees-card">
          <h2 className="company-overview-section-title">
            <span className="material-symbols-outlined">group</span>
            직원 리스트
            <span className="company-overview-count">({filteredAndSortedEmployees.length}명)</span>
          </h2>
          {canSeeSubscriptionSection && subscription?.overLimit && (
            <div className="company-overview-seat-warning" role="status">
              <span className="material-symbols-outlined">warning</span>
              <span>
                구독 인원({subscription.seatCount}명)보다 역할이 부여된 직원이 많습니다. 구독에서 인원을 늘리거나,
                일부 직원을 권한 대기로 내려 주세요.
              </span>
            </div>
          )}
          {isPendingUser && (
            <div className="company-overview-approval-box">
              <p className="company-overview-approval-text">
                권한 대기 상태입니다. 아래 대표 또는 관리자 중 메일을 받을 사람을 선택한 뒤 승인 요청을 보내세요.
              </p>
              <button
                type="button"
                className="company-overview-request-btn"
                onClick={sendAccessRequest}
                disabled={requestSending || selectedApproverIds.length === 0}
              >
                {requestSending ? '요청 메일 전송 중...' : '선택한 인원에게 권한 요청 메일 보내기'}
              </button>
              {requestMessage && <p className="company-overview-request-message">{requestMessage}</p>}
            </div>
          )}
          {filteredAndSortedEmployees.length === 0 ? (
            <p className="company-overview-empty">등록된 직원이 없습니다.</p>
          ) : (
            <div className="company-overview-table-wrap">
              <table className="company-overview-table">
                <thead>
                  <tr>
                    {orderedEmployeeColumns.map((col) => {
                      const key = col.key;
                      const isDragOver = employeeDragOverKey === key;
                      const isDragging = employeeDraggingKey === key;
                      return (
                        <th
                          key={`head-${key}`}
                          onDragOver={(e) => handleEmployeeHeaderDragOver(e, key)}
                          onDrop={() => handleEmployeeHeaderDrop(key)}
                          onDragEnd={() => { setEmployeeDraggingKey(''); setEmployeeDragOverKey(''); }}
                          className={[
                            'company-overview-table-head-draggable',
                            isDragOver ? 'company-overview-table-head-drag-over' : '',
                            isDragging ? 'company-overview-table-head-dragging' : ''
                          ].filter(Boolean).join(' ')}
                        >
                          <span
                            className="company-overview-table-drag-handle"
                            draggable
                            onDragStart={() => setEmployeeDraggingKey(key)}
                            title="드래그해서 열 순서 변경"
                            aria-label={`${col.label} 순서 변경`}
                          >
                            <span className="material-symbols-outlined" aria-hidden>drag_indicator</span>
                          </span>
                          <button
                            type="button"
                            className="company-overview-table-head-filter-trigger"
                            onClick={(e) => openEmployeeFilter(key, { x: e.clientX, y: e.clientY })}
                            title="정렬/필터"
                          >
                            <span className="company-overview-table-head-label">{col.label}</span>
                            {employeeSortConfig.key === key && employeeSortConfig.dir ? (
                              <span className="material-symbols-outlined company-overview-table-head-sort-icon" aria-hidden>
                                {employeeSortConfig.dir === 'asc' ? 'arrow_upward' : 'arrow_downward'}
                              </span>
                            ) : null}
                            {Array.isArray(employeeActiveFilters[key]) && employeeActiveFilters[key].length > 0 ? (
                              <span className="material-symbols-outlined company-overview-table-head-filter-icon" aria-hidden>filter_alt</span>
                            ) : null}
                          </button>
                          {employeeOpenFilterKey === key ? (
                            <div
                              ref={employeeFilterMenuRef}
                              className="company-overview-table-filter-menu"
                              style={{ top: `${employeeFilterMenuPosition.top}px`, left: `${employeeFilterMenuPosition.left}px` }}
                              onMouseDown={(e) => e.stopPropagation()}
                            >
                              <div className="company-overview-table-filter-menu-actions">
                                <button type="button" onClick={() => setEmployeeSortConfig({ key, dir: 'asc' })} className="company-overview-table-filter-btn">오름차순 정렬</button>
                                <button type="button" onClick={() => setEmployeeSortConfig({ key, dir: 'desc' })} className="company-overview-table-filter-btn">내림차순 정렬</button>
                                <button
                                  type="button"
                                  onClick={() => setEmployeeSortConfig((prev) => (prev.key === key ? { key: '', dir: '' } : prev))}
                                  className="company-overview-table-filter-btn"
                                >
                                  정렬 해제
                                </button>
                              </div>
                              <input
                                type="search"
                                className="company-overview-table-filter-search"
                                value={employeeFilterSearch}
                                onChange={(e) => setEmployeeFilterSearch(e.target.value)}
                                placeholder="검색"
                              />
                              <div className="company-overview-table-filter-options">
                                {(employeeFilterOptionsByKey[key] || [])
                                  .filter((v) => v.toLowerCase().includes(employeeFilterSearch.trim().toLowerCase()))
                                  .map((option) => (
                                    <label key={`f-${key}-${option || '__empty'}`} className="company-overview-table-filter-option">
                                      <input
                                        type="checkbox"
                                        checked={employeeDraftSelected.includes(option)}
                                        onChange={() => setEmployeeDraftSelected((prev) => (
                                          prev.includes(option) ? prev.filter((v) => v !== option) : [...prev, option]
                                        ))}
                                      />
                                      <span>{option || '(빈 값)'}</span>
                                    </label>
                                  ))}
                              </div>
                              <div className="company-overview-table-filter-footer">
                                <button type="button" onClick={applyEmployeeFilter} className="company-overview-table-filter-ok">확인</button>
                                <button type="button" onClick={() => clearEmployeeFilter(key)} className="company-overview-table-filter-cancel">전체</button>
                                <button type="button" onClick={() => setEmployeeOpenFilterKey('')} className="company-overview-table-filter-cancel">취소</button>
                              </div>
                            </div>
                          ) : null}
                        </th>
                      );
                    })}
                    {isPendingUser && <th>선택</th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredAndSortedEmployees.map((emp) => {
                    return (
                    <tr
                      key={emp.id}
                      className={canManageRoles ? 'company-overview-table-row-editable' : ''}
                      onClick={() => {
                        if (!canManageRoles) return;
                        openMemberEditModal(emp);
                      }}
                    >
                      {orderedEmployeeColumns.map((col) => {
                        if (col.key === 'name') {
                          return (
                            <td key={`${emp.id}-${col.key}`}>
                              <div className="company-overview-name-with-badge">
                                <span>{emp.name || '—'}</span>
                                {emp._isDeptLeader ? (
                                  <span className="company-overview-name-leader-mark" title="리더" aria-label="리더">
                                    <span className="material-symbols-outlined" aria-hidden>star</span>
                                  </span>
                                ) : null}
                              </div>
                            </td>
                          );
                        }
                        if (col.key === 'email') return <td key={`${emp.id}-${col.key}`}>{emp.email || '—'}</td>;
                        if (col.key === 'phone') return <td key={`${emp.id}-${col.key}`}>{emp.phone || '—'}</td>;
                        if (col.key === 'department') return <td key={`${emp.id}-${col.key}`}>{emp._deptLabel || '—'}</td>;
                        if (col.key === 'rank') return <td key={`${emp.id}-${col.key}`}>{emp.rank || '—'}</td>;
                        if (col.key === 'title') return <td key={`${emp.id}-${col.key}`}>{emp.title || '—'}</td>;
                        if (col.key === 'crmRole') {
                          return (
                            <td key={`${emp.id}-${col.key}`}>
                              <span className={`company-overview-badge role-${emp.role || 'staff'}`}>
                                {emp._roleLabel}
                              </span>
                            </td>
                          );
                        }
                        return <td key={`${emp.id}-${col.key}`}>{getEmployeeCellText(emp, col.key) || '—'}</td>;
                      })}
                      {isPendingUser && (
                        <td onClick={(e) => e.stopPropagation()}>
                          <label
                            className="company-overview-approval-check"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              checked={selectedApproverIds.includes(String(emp.id))}
                              onChange={() => toggleApproverSelection(emp.id)}
                              disabled={requestSending}
                            />
                            <span>선택</span>
                          </label>
                        </td>
                      )}
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="company-overview-card">
          <h2 className="company-overview-section-title">
            <span className="material-symbols-outlined">account_tree</span>
            조직도
            {orgSaving ? <span className="company-overview-count">(저장 중...)</span> : null}
          </h2>
          {orgChart ? (
            <div className="co-org-wrap">
              {!canManageRoles ? (
                <p className="co-org-readonly-hint">조직도 편집·저장은 대표(Owner) 또는 관리자(Admin)만 가능합니다.</p>
              ) : null}
              <div className="co-org-toolbar">
                <div className="co-org-toolbar-mind-actions" role="group" aria-label="조직 노드 추가·삭제">
                  <button
                    type="button"
                    className="co-org-mind-icon-btn"
                    onClick={handleOrgMindAddChild}
                    disabled={!canManageRoles}
                    title={
                      canManageRoles
                        ? '선택한 노드 아래에 하위 조직 추가'
                        : '대표 또는 관리자만 편집할 수 있습니다.'
                    }
                    aria-label="하위 조직 추가"
                  >
                    <span className="material-symbols-outlined" aria-hidden>add</span>
                  </button>
                  <button
                    type="button"
                    className="co-org-mind-icon-btn"
                    onClick={handleOrgMindRemove}
                    disabled={!canManageRoles}
                    title={
                      canManageRoles
                        ? '선택한 노드 삭제 (최상위 제외)'
                        : '대표 또는 관리자만 편집할 수 있습니다.'
                    }
                    aria-label="선택 노드 삭제"
                  >
                    <span className="material-symbols-outlined" aria-hidden>remove</span>
                  </button>
                </div>
                <button
                  type="button"
                  className="co-org-save-btn"
                  onClick={handleSaveMindOrgChart}
                  disabled={!canManageRoles || orgSaving}
                  title={canManageRoles ? undefined : '대표 또는 관리자만 저장할 수 있습니다.'}
                >
                  <span className="material-symbols-outlined" aria-hidden>
                    {orgSaving ? 'hourglass_empty' : 'save'}
                  </span>
                  {orgSaving ? '저장 중...' : '조직도 저장'}
                </button>
              </div>
              <div
                ref={mindContainerRef}
                className={`co-org-mind${!canManageRoles ? ' co-org-mind--readonly' : ''}`}
              />
            </div>
          ) : (
            <p className="company-overview-empty">조직도 데이터를 불러오는 중입니다.</p>
          )}
        </section>

        {canSeeSubscriptionSection && (
          <section className="company-overview-card company-subscription-card" aria-labelledby="co-sub-title">
            <h2 id="co-sub-title" className="company-overview-section-title">
              <span className="material-symbols-outlined">payments</span>
              구독 · 시트 (역할 인원)
            </h2>
            <p className="company-subscription-visibility-note">
              이 섹션은 관리자(Admin) 이상만 볼 수 있습니다.
            </p>
            {subActive ? (
              <dl className="company-info-list company-subscription-dl">
                <div className="company-info-row">
                  <dt>구독 이용 인원</dt>
                  <dd>{subscription.seatCount != null ? `${subscription.seatCount}명` : '—'}</dd>
                </div>
                <div className="company-info-row">
                  <dt>역할 배정 사용</dt>
                  <dd>
                    {subscription.activeRoleCount != null ? `${subscription.activeRoleCount}명` : '—'}
                    <span className="company-subscription-slots">
                      {' '}(남은 시트 {typeof seatsRemaining === 'number' ? `${seatsRemaining}명` : '—'})
                    </span>
                  </dd>
                </div>
                <div className="company-info-row">
                  <dt>월 정기 금액(안내)</dt>
                  <dd>
                    {subscription.planAmount != null
                      ? `${Number(subscription.planAmount).toLocaleString('ko-KR')}원`
                      : '—'}
                  </dd>
                </div>
                <div className="company-info-row">
                  <dt>다음 정기 결제 예정</dt>
                  <dd>{formatSubscriptionDate(subscription.nextBillingAt)}</dd>
                </div>
              </dl>
            ) : null}
            <SubscriptionRolePermissionGuide />
            {subActive ? (
              <div className="company-subscription-hint-block">
                <p className="company-subscription-hint">
                  <strong>구독 시트</strong>는 <strong>대표·관리자·실무자·직원</strong> 네 가지 역할을 쓰는 계정 수의 합이, 구독에 포함된
                  이용 인원(시트)을 넘지 않아야 합니다. <strong>권한 대기(Pending)</strong>는 시트를 쓰지 않으므로, 초대만 된 상태로
                  두거나 시트가 꽉 찼을 때 임시로 내려 두기에 적합합니다.
                </p>
                <ul className="company-subscription-hint-list">
                  <li>
                    역할을 권한 대기에서 직원·실무자·관리자·대표 쪽으로 올리면, 그 계정이 시트를 &quot;쓰는&quot; 역할이 되는 한
                    사용 중인 시트 수가 늘어납니다. 반대로 Pending으로 내리면 해당 칸이 비워집니다.
                  </li>
                  <li>
                    대표만 다른 계정을 <strong>관리자(Admin)</strong>로 지정할 수 있습니다. 관리자는 그 아래 역할(실무자·직원·대기) 변경과
                    조직도 편집은 할 수 있습니다.
                  </li>
                  <li>
                    위 &quot;역할별로 할 수 있는 일&quot;에서 기능 범위를 확인한 뒤, 필요한 만큼만 시트를 쓰는 역할로 배정하면 됩니다.
                  </li>
                </ul>
                {noSeatForPromotion ? (
                  <p className="company-subscription-hint company-subscription-hint-warn">
                    현재 남은 시트가 없습니다. 권한 대기 중인 계정을 직원·실무자·관리자 등으로 올리려면, 구독 인원을 늘리거나
                    다른 직원을 먼저 권한 대기로 내린 뒤 시트를 확보해 주세요.
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="company-subscription-hint-block">
                <p className="company-subscription-hint">
                  활성 구독이 없으면 시트 한도를 시스템이 알 수 없어, 위와 같은 인원 제한 안내가 적용되지 않을 수 있습니다.
                  구독이 연동되면 <strong>대표·관리자·실무자·직원</strong> 역할을 가진 인원 수가 구독 이용 인원을 넘지 않도록 맞춰야 합니다.
                </p>
                <p className="company-subscription-hint company-subscription-hint-follow">
                  역할별 권한은 위 &quot;역할별로 할 수 있는 일&quot; 안내를 참고하세요. Pending은 시트를 쓰지 않으며, 승인 후 직원으로
                  시작하는 흐름이 일반적입니다.
                </p>
              </div>
            )}
          </section>
        )}
      </div>

      {showDriveSettingsModal && (
        <CompanyDriveSettingsModal
          initialDriveRootUrl={(data?.company?.driveRootUrl ?? '').trim()}
          onClose={() => setShowDriveSettingsModal(false)}
          onSaved={(savedUrl) => {
            setData((prev) => prev ? { ...prev, company: { ...prev.company, driveRootUrl: savedUrl } } : null);
          }}
        />
      )}

      {memberEditOpen && memberEditForm ? (
        <div className="company-member-edit-overlay" role="dialog" aria-modal="true" aria-labelledby="company-member-edit-title">
          <div className="company-member-edit-modal" onClick={(e) => e.stopPropagation()}>
            <div className="company-member-edit-head">
              <div className="company-member-edit-title-wrap">
                <h3 id="company-member-edit-title">직원 정보 수정 · {memberEditForm.name}</h3>
                <p className="company-member-edit-subtitle">부서 · 직급 · 역할 · 리더 상태를 한 번에 수정합니다.</p>
              </div>
              <button type="button" className="company-member-edit-close" onClick={closeMemberEditModal} disabled={savingMemberId || savingDeptLeader} aria-label="닫기">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="company-member-edit-body">
              <label className="company-member-edit-field">
                <span>부서</span>
                <select
                  className="company-overview-select"
                  value={memberEditForm.department || ''}
                  disabled={savingMemberId === memberEditForm.id || orgDeptOptions.length === 0}
                  onChange={(e) => setMemberEditForm((prev) => ({ ...prev, department: e.target.value }))}
                >
                  <option value="">미배정</option>
                  {orgDeptOptions.map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
              </label>
              <label className="company-member-edit-field">
                <span>직급</span>
                <input
                  type="text"
                  className="company-member-edit-input"
                  value={memberEditForm.rank || ''}
                  maxLength={80}
                  onChange={(e) => setMemberEditForm((prev) => ({ ...prev, rank: e.target.value }))}
                  disabled={savingMemberId === memberEditForm.id}
                />
              </label>
              <label className="company-member-edit-field">
                <span>역할</span>
                <input
                  type="text"
                  className="company-member-edit-input"
                  value={memberEditForm.title || ''}
                  maxLength={80}
                  onChange={(e) => setMemberEditForm((prev) => ({ ...prev, title: e.target.value }))}
                  disabled={savingMemberId === memberEditForm.id}
                />
              </label>
              <label className="company-member-edit-field">
                <span>CRM 관리 역할</span>
                <select
                  className="company-overview-select"
                  value={memberEditForm.role || 'pending'}
                  disabled={savingMemberId === memberEditForm.id || !canEditRole({ id: memberEditForm.id, role: memberEditForm.role })}
                  onChange={(e) => setMemberEditForm((prev) => ({ ...prev, role: e.target.value }))}
                >
                  <option value="pending">권한 대기 (Pending Approval)</option>
                  <option value="staff" disabled={memberEditForm.role === 'pending' && noSeatForPromotion}>직원 (Staff)</option>
                  <option value="manager" disabled={memberEditForm.role === 'pending' && noSeatForPromotion}>실무자 (Manager)</option>
                  {me.role === 'owner' ? <option value="admin" disabled={memberEditForm.role === 'pending' && noSeatForPromotion}>관리자 (Admin)</option> : null}
                </select>
              </label>
              <label className="company-member-edit-field company-member-edit-field--check">
                <span>리더</span>
                <input
                  type="checkbox"
                  checked={!!memberEditForm.isDeptLeader}
                  disabled={savingMemberId === memberEditForm.id || savingDeptLeader || !canManageDepartmentLeaders || !memberEditForm.department}
                  onChange={(e) => setMemberEditForm((prev) => ({ ...prev, isDeptLeader: e.target.checked }))}
                />
              </label>
            </div>
            <div className="company-member-edit-foot">
              <button type="button" className="company-member-edit-btn company-member-edit-btn-cancel" onClick={closeMemberEditModal} disabled={savingMemberId || savingDeptLeader}>
                <span className="material-symbols-outlined">close</span>
                취소
              </button>
              <button
                type="button"
                className="company-member-edit-btn company-member-edit-btn-save"
                onClick={() => void saveMemberEditModal()}
                disabled={
                  savingMemberId ||
                  savingDeptLeader ||
                  !String(memberEditForm.department || '').trim() ||
                  !String(memberEditForm.title || '').trim()
                }
              >
                <span className="material-symbols-outlined">save</span>
                {(savingMemberId || savingDeptLeader) ? '저장 중…' : '저장'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
