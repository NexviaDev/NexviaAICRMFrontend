import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import CompanyDriveSettingsModal from './company-drive-settings-modal/company-drive-settings-modal';
import './company-overview.css';
import 'mind-elixir/style.css';

import { API_BASE } from '@/config';
import PageHeaderNotifyChat from '@/components/page-header-notify-chat/page-header-notify-chat';
import {
  mindOrgGenerateMainBranch,
  mindOrgGenerateSubBranch,
  mindOrgFitToView,
  CO_ORG_SCALE_MIN,
  CO_ORG_SCALE_MAX,
  coOrgPn
} from '@/lib/org-chart-mind-shared';
import { GoogleWorkspaceChatPolicyHint } from '@/lib/google-workspace-chat-hint';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

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

function deptLegacySelectValue(raw) {
  return `legacy:${encodeURIComponent(raw)}`;
}

function formatSubscriptionDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return '—';
  }
}

/** 구독 카드용 — 백엔드 정책(app.js 전역 PATCH·역할 미들웨어·컨트롤러)과 엄격히 맞춘 안내 문구 */
const CRM_ROLE_PERMISSION_GUIDE = [
  {
    id: 'owner',
    title: '대표 (Owner)',
    usesSeat: true,
    bullets: [
      '구독 시트 1명분을 사용합니다.',
      '직원 역할·부서 변경, 조직도 편집, 권한 승인 요청 수신 등 인사·조직을 총괄합니다.',
      '다른 계정을 관리자(Admin)로 올리는 것은 대표만 할 수 있습니다.',
      '고객사·연락처·제품 삭제, 커스텀 필드 정의, 리드 캡처 채널 관리, 전체 엑셀보내기 등 관리자 전용(Admin 이상) 작업을 포함해 넓은 범위의 CRM 설정이 가능합니다.',
      '고객사의 기업명(상호) 변경은 관리자(Admin) 이상만 서버에서 허용됩니다. 대표·관리자는 해당 변경을 할 수 있습니다.'
    ]
  },
  {
    id: 'admin',
    title: '관리자 (Admin, 구 Senior)',
    usesSeat: true,
    bullets: [
      '구독 시트 1명분을 사용합니다.',
      '대표를 제외한 구성원을 권한 대기·직원·실무자·관리자까지 변경하고, 부서를 배정하며 조직도를 편집할 수 있습니다.',
      '「관리자」로 승격시키는 작업은 대표만 가능합니다.',
      '삭제·민감 API, 리드 캡처 채널 관리, 알림 관리, 전체 엑셀보내기 등 Admin 이상이 필요한 기능을 사용할 수 있습니다.',
      '고객사의 기업명(상호) 변경은 Admin 이상만 가능합니다(실무자는 기업명 변경 PATCH가 거절됩니다).'
    ]
  },
  {
    id: 'manager',
    title: '실무자 (Manager, 구 Practitioner / Contributor)',
    usesSeat: true,
    bullets: [
      '구독 시트 1명분을 사용합니다.',
      '서버 전역 정책상 수정(PATCH)·삭제(DELETE)는 실무자(Manager) 이상부터 허용됩니다. 고객사·연락처·제품·일정 등 대부분의 데이터 수정·삭제가 여기에 해당합니다.',
      '고객사의 기업명(상호)을 바꾸는 것만은 예외로, 관리자(Admin) 이상만 허용됩니다. 대표자명·주소·담당·메모 등 다른 필드는 실무자가 수정할 수 있습니다.',
      '회사·연락처·제품 단건 삭제, 히스토리 삭제, 커스텀 필드 정의 변경 등 그 밖의 Admin 전용 항목도 따로 있습니다.'
    ]
  },
  {
    id: 'staff',
    title: '직원 (Staff)',
    usesSeat: true,
    bullets: [
      '구독 시트 1명분을 사용합니다.',
      '서버 전역 정책상 권한 대기(Pending)만 수정(PATCH)·삭제(DELETE)에서 제외됩니다. 직원(Staff)도 대부분의 데이터 수정·삭제 API를 호출할 수 있습니다.',
      '다만 고객사 기업명(상호) 변경, 일부 삭제·관리자 전용 API 등은 Admin 이상만 허용되는 경우가 따로 있습니다(거절 시 서버 메시지·코드 참고).',
      '본인 리스트 열 설정·사이드바 순서, 할 일 코멘트 등 일부 개인 설정은 직원도 저장할 수 있습니다.'
    ]
  },
  {
    id: 'pending',
    title: '권한 대기 (Pending)',
    usesSeat: false,
    bullets: [
      '구독 시트를 쓰지 않습니다.',
      '회사 동의 전 상태라 CRM 데이터에 접근할 수 없습니다. 아래 직원 목록에서 대표·관리자에게 승인 요청 메일을 보낼 수 있습니다.',
      '승인 후에는 보통 직원(Staff)으로 시작하며, 이후 대표·관리자가 역할을 올려 줄 수 있습니다.'
    ]
  }
];

function SubscriptionRolePermissionGuide() {
  return (
    <div className="company-subscription-role-guide" role="region" aria-label="역할별 권한 안내">
      <h3 className="company-subscription-role-guide-title">역할별로 할 수 있는 일</h3>
      <p className="company-subscription-role-guide-lead">
        아래는 이 CRM의 <strong>서버에서 실제로 거절·허용하는 기준</strong>과 맞춘 요약입니다. UI는 편의상 숨길 수 있으나, 권한이 없으면 저장 시 API가 403 등으로 막습니다.
      </p>
      <div className="company-subscription-role-guide-list">
        {CRM_ROLE_PERMISSION_GUIDE.map((block) => (
          <div key={block.id} className="company-subscription-role-block">
            <div className="company-subscription-role-block-head">
              <span className="company-subscription-role-name">{block.title}</span>
              {block.usesSeat ? (
                <span className="company-subscription-role-badge">시트 사용</span>
              ) : (
                <span className="company-subscription-role-badge company-subscription-role-badge-muted">시트 미사용</span>
              )}
            </div>
            <ul className="company-subscription-role-ul">
              {block.bullets.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
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
  const [editingRoleMemberId, setEditingRoleMemberId] = useState('');
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
    const res = await fetch(`${API_BASE}/companies/overview`, { headers: getAuthHeader() });
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
      const r = await fetch(`${API_BASE}/companies/assignee-handover-requests/pending`, { headers: getAuthHeader() });
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
          headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
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
      const res = await fetch(`${API_BASE}/companies/department-leaders`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ leaders: next })
      });
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
      const res = await fetch(`${API_BASE}/companies/organization-chart`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ organizationChart: nextTree })
      });
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
        handleWheel: (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
        }
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
  const fullAddress = [company.address, company.addressDetail].filter(Boolean).join(' ');
  const isPendingUser = me.role === 'pending';
  /** 구독·시트 블록: Admin·Owner (레거시 senior 포함) */
  const canSeeSubscriptionSection = ['owner', 'admin', 'senior'].includes(me.role);
  const canEditRole = (emp) => canManageRoles && String(emp.id) !== String(me.id) && emp.role !== 'owner';
  /** 구독 시트: 대표·관리자·실무자·직원(비-pending) 인원만큼만 부여 가능 */
  const subActive = subscription?.hasActiveSubscription === true;
  const seatsRemaining = subscription?.seatsRemaining;
  const noSeatForPromotion = subActive && typeof seatsRemaining === 'number' && seatsRemaining <= 0;

  const sortedEmployees = useMemo(() => {
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
    return [...employees].sort((a, b) => {
      const ra = order[a.role] ?? 99;
      const rb = order[b.role] ?? 99;
      if (ra !== rb) return ra - rb;
      return (a.name || a.email || '').localeCompare(b.name || b.email || '', 'ko');
    });
  }, [employees]);

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

  const updateMemberAccess = async (memberId, patch) => {
    setActionError('');
    setRequestMessage('');
    setSavingMemberId(String(memberId));
    try {
      const res = await fetch(`${API_BASE}/companies/members/${memberId}/access`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify(patch)
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || '직원 정보 변경에 실패했습니다.');
      await refreshOverview();
      setEditingRoleMemberId('');
    } catch (e) {
      setActionError(e.message || '직원 정보 변경에 실패했습니다.');
    } finally {
      setSavingMemberId('');
    }
  };

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
      const res = await fetch(`${API_BASE}/companies/access-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ approverUserIds: selectedApproverIds })
      });
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
          <h2 className="company-overview-section-title">
            <span className="material-symbols-outlined">business</span>
            소속 회사
          </h2>
          <dl className="company-info-list">
            <div className="company-info-row">
              <dt>회사명</dt>
              <dd>{company.name || '—'}</dd>
            </div>
            <div className="company-info-row">
              <dt>주소</dt>
              <dd>{fullAddress || '—'}</dd>
            </div>
          </dl>
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
            <span className="company-overview-count">({sortedEmployees.length}명)</span>
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
          {sortedEmployees.length === 0 ? (
            <p className="company-overview-empty">등록된 직원이 없습니다.</p>
          ) : (
            <div className="company-overview-table-wrap">
              <table className="company-overview-table">
                <thead>
                  <tr>
                    <th>이름</th>
                    <th>이메일</th>
                    <th>연락처</th>
                    <th>부서</th>
                    <th
                      className="company-overview-th-dept-leader"
                      title="대표·관리자만 체크할 수 있습니다."
                    >
                      부서 팀장
                    </th>
                    <th>CRM 관리 역할</th>
                    {isPendingUser && <th>선택</th>}
                  </tr>
                </thead>
                <tbody>
                  {sortedEmployees.map((emp) => {
                    const deptRaw = String(emp.department || '').trim();
                    const deptInOrg = deptRaw && orgDeptOptions.some((o) => o.id === deptRaw);
                    const isDeptLeader = deptRaw && departmentLeaderList.some(
                      (l) => String(l.userId) === String(emp.id) && String(l.departmentId) === deptRaw
                    );
                    return (
                    <tr key={emp.id}>
                      <td>
                        <div className="company-overview-name-with-badge">
                          <span>{emp.name || '—'}</span>

                        </div>
                      </td>
                      <td>{emp.email || '—'}</td>
                      <td>{emp.phone || '—'}</td>
                      <td>
                        {canManageRoles ? (
                          <select
                            className="company-overview-select"
                            value={(() => {
                              const raw = String(emp.department || '').trim();
                              if (!raw) return '';
                              if (orgDeptOptions.some((o) => o.id === raw)) return raw;
                              return deptLegacySelectValue(raw);
                            })()}
                            disabled={savingMemberId === String(emp.id) || orgDeptOptions.length === 0}
                            title={
                              orgDeptOptions.length === 0
                                ? '조직도 노드가 없으면 부서를 지정할 수 없습니다.'
                                : '조직도에 있는 부서(노드)를 선택하세요. 값은 노드 ID로 저장됩니다.'
                            }
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v.startsWith('legacy:')) return;
                              void updateMemberAccess(emp.id, { department: v });
                            }}
                          >
                            <option value="">미배정</option>
                            {(() => {
                              const raw = String(emp.department || '').trim();
                              const matched = orgDeptOptions.some((o) => o.id === raw);
                              if (raw && !matched) {
                                return (
                                  <option value={deptLegacySelectValue(raw)}>
                                    (기존·조직도 외) {resolveDeptDisplay(orgChart, raw)}
                                  </option>
                                );
                              }
                              return null;
                            })()}
                            {orgDeptOptions.map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          resolveDeptDisplay(orgChart, emp.department) || '—'
                        )}
                      </td>
                      <td className="company-overview-dept-leader-cell">
                        {canManageDepartmentLeaders && deptInOrg ? (
                          <label className="company-overview-dept-leader-label">
                            <input
                              type="checkbox"
                              checked={isDeptLeader}
                              disabled={savingDeptLeader || savingMemberId === String(emp.id)}
                              onChange={() => void applyDepartmentLeaderToggle(emp)}
                            />
                          </label>
                        ) : (
                          <span className="company-overview-muted">—</span>
                        )}
                      </td>
                      <td>
                        {editingRoleMemberId === String(emp.id) && canEditRole(emp) ? (
                          <select
                            className="company-overview-select"
                            value={emp.role || 'pending'}
                            disabled={savingMemberId === String(emp.id)}
                            autoFocus
                            onBlur={() => {
                              if (savingMemberId !== String(emp.id)) setEditingRoleMemberId('');
                            }}
                            onChange={(e) => updateMemberAccess(emp.id, { role: e.target.value })}
                          >
                            <option value="pending">권한 대기 (Pending Approval)</option>
                            <option
                              value="staff"
                              disabled={emp.role === 'pending' && noSeatForPromotion}
                              title={emp.role === 'pending' && noSeatForPromotion ? '구독 시트가 부족합니다. 구독 관리에서 인원을 늘리세요.' : undefined}
                            >
                              직원 (Staff)
                            </option>
                            <option
                              value="manager"
                              disabled={emp.role === 'pending' && noSeatForPromotion}
                              title={emp.role === 'pending' && noSeatForPromotion ? '구독 시트가 부족합니다.' : undefined}
                            >
                              실무자 (Manager)
                            </option>
                            {me.role === 'owner' && (
                              <option
                                value="admin"
                                disabled={emp.role === 'pending' && noSeatForPromotion}
                                title={emp.role === 'pending' && noSeatForPromotion ? '구독 시트가 부족합니다.' : undefined}
                              >
                                관리자 (Admin)
                              </option>
                            )}
                          </select>
                        ) : (
                          canEditRole(emp) ? (
                            <button
                              type="button"
                              className="company-overview-role-trigger"
                              onClick={() => setEditingRoleMemberId(String(emp.id))}
                              disabled={savingMemberId === String(emp.id)}
                            >
                              <span className={`company-overview-badge role-${emp.role || 'staff'}`}>
                                {roleLabel(emp.role)}
                              </span>
                            </button>
                          ) : (
                            <span className={`company-overview-badge role-${emp.role || 'staff'}`}>
                              {roleLabel(emp.role)}
                            </span>
                          )
                        )}
                      </td>
                      {isPendingUser && (
                        <td>
                          <label className="company-overview-approval-check">
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
    </div>
  );
}
