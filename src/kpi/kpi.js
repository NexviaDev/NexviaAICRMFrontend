import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { API_BASE } from '@/config';
import PageHeaderNotifyChat from '@/components/page-header-notify-chat/page-header-notify-chat';
import ParticipantModal from '@/shared/participant-modal/participant-modal';
import KpiDetailModal from './kpi-detail-modal/kpi-detail-modal';
import KpiTargetModal from './kpi-target-modal/kpi-target-modal';
import '../home/home.css';
import './kpi.css';

const PERIODS = [
  { key: 'monthly', label: '월간' },
  { key: 'quarterly', label: '분기' },
  { key: 'semiannual', label: '반기' },
  { key: 'annual', label: '연간' }
];

const KPI_SCOPE_OPTIONS = [
  { key: 'team', label: '팀별' },
  { key: 'user', label: '개인별' }
];

/** 개인별 범위에서 «전체 직원» — 백엔드 `KPI_ALL_STAFF_USER_ID` 와 동일 */
const KPI_ALL_STAFF_VALUE = '__kpi_all_staff__';
const KPI_LIST_MODAL_PARAM = 'kpiList';
const KPI_LIST_METRIC_PARAM = 'kpiMetric';
const KPI_TARGET_MODAL_PARAM = 'kpiTarget';

/** 브라우저 주소창에 노출되는 KPI 필터 쿼리 키 (다른 기능과 충돌 방지) */
const KPI_URL = {
  SCOPE: 'kpiScope',
  PERIOD: 'kpiPeriod',
  DEPT: 'kpiDept',
  STAFF: 'kpiStaff',
  VIEW: 'kpiView',
  LB_DEPT: 'kpiLbDept',
  LB_RANK: 'kpiLbRank'
};

function parseKpiFiltersFromSearchParams(sp) {
  const raw = sp instanceof URLSearchParams ? sp : new URLSearchParams(sp);
  const scopeRaw = String(raw.get(KPI_URL.SCOPE) || '').trim();
  const scopeType = scopeRaw === 'user' ? 'user' : scopeRaw === 'team' ? 'team' : null;

  const periodRaw = String(raw.get(KPI_URL.PERIOD) || '').trim();
  const period = PERIODS.some((x) => x.key === periodRaw) ? periodRaw : null;

  const viewRaw = String(raw.get(KPI_URL.VIEW) || '').trim();
  const viewBy = ['overall', 'department', 'rank'].includes(viewRaw) ? viewRaw : null;

  const kpiDept = String(raw.get(KPI_URL.DEPT) || '').trim();
  const kpiStaff = String(raw.get(KPI_URL.STAFF) || '').trim();
  const kpiLbDept = String(raw.get(KPI_URL.LB_DEPT) || '').trim();
  const kpiLbRank = String(raw.get(KPI_URL.LB_RANK) || '').trim();

  return { scopeType, period, viewBy, kpiDept, kpiStaff, kpiLbDept, kpiLbRank };
}

function readInitialKpiFiltersFromWindow() {
  if (typeof window === 'undefined') return parseKpiFiltersFromSearchParams('');
  return parseKpiFiltersFromSearchParams(new URLSearchParams(window.location.search));
}

function resolvedKpiFiltersFromParsed(f) {
  return {
    period: f.period || 'monthly',
    scopeType: f.scopeType || 'team',
    selectedScopeDepartment: f.scopeType === 'team' && f.kpiDept ? f.kpiDept : '',
    selectedScopeUser: f.scopeType === 'user' && f.kpiStaff ? f.kpiStaff : '',
    viewBy: f.viewBy || 'overall',
    selectedDepartment: f.viewBy === 'department' && f.kpiLbDept ? f.kpiLbDept : '',
    selectedRank: f.viewBy === 'rank' && f.kpiLbRank ? f.kpiLbRank : ''
  };
}

function mergeKpiFilterSearchParams(next, filters) {
  const {
    scopeType,
    period,
    viewBy,
    selectedScopeDepartment,
    selectedScopeUser,
    selectedDepartment,
    selectedRank
  } = filters;
  next.set(KPI_URL.SCOPE, scopeType);
  next.set(KPI_URL.PERIOD, period);
  next.set(KPI_URL.VIEW, viewBy);
  if (scopeType === 'team') {
    if (selectedScopeDepartment) next.set(KPI_URL.DEPT, selectedScopeDepartment);
    else next.delete(KPI_URL.DEPT);
    next.delete(KPI_URL.STAFF);
  } else {
    if (selectedScopeUser) next.set(KPI_URL.STAFF, selectedScopeUser);
    else next.delete(KPI_URL.STAFF);
    next.delete(KPI_URL.DEPT);
  }
  if (viewBy === 'department' && selectedDepartment) next.set(KPI_URL.LB_DEPT, selectedDepartment);
  else next.delete(KPI_URL.LB_DEPT);
  if (viewBy === 'rank' && selectedRank) next.set(KPI_URL.LB_RANK, selectedRank);
  else next.delete(KPI_URL.LB_RANK);
}

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
    const found = findOrgChartNodeById(c, sid);
    if (found) return found;
  }
  return null;
}

function collectOrgChartDeptIds(node, acc = []) {
  if (!node || typeof node !== 'object') return acc;
  const id = String(node.id || '').trim();
  if (id) acc.push(id);
  for (const c of node.children || []) collectOrgChartDeptIds(c, acc);
  return acc;
}

function resolveDeptDisplay(orgChartRoot, stored) {
  const s = String(stored || '').trim();
  if (!s) return '';
  const node = findOrgChartNodeById(orgChartRoot, s);
  if (node) return formatOrgDeptPickerLabel(node);
  return s;
}

function getInitials(name) {
  const source = String(name || '').trim().replace(/\s+/g, '');
  if (!source) return '?';
  if (source.length <= 2) return source;
  return `${source[0]}${source[source.length - 1]}`;
}

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('ko-KR');
}

function formatRevenue(value) {
  return `${formatNumber(Math.round(Number(value) || 0))}원`;
}

/** 기여도 막대 안 짧은 표기 (이미지 스타일) */
function formatRevenueCompact(value) {
  const v = Math.round(Number(value) || 0);
  if (v >= 100000000) return `₩${(v / 100000000).toFixed(1)}억`;
  if (v >= 10000) return `₩${Math.round(v / 10000)}만`;
  return `₩${formatNumber(v)}`;
}

function formatDelta(current, previous, suffix = '') {
  const cur = Number(current) || 0;
  const prev = Number(previous) || 0;
  if (prev <= 0 && cur <= 0) return { text: `변동 없음${suffix}`, positive: true };
  if (prev <= 0) return { text: `신규 ${formatNumber(cur)}${suffix}`, positive: true };
  const diffPct = ((cur - prev) / prev) * 100;
  const sign = diffPct >= 0 ? '+' : '';
  return {
    text: `${sign}${diffPct.toFixed(1)}%`,
    positive: diffPct >= 0
  };
}

function calcAchievement(current, target) {
  const cur = Number(current) || 0;
  const tgt = Number(target) || 0;
  if (tgt <= 0) return 0;
  return Math.max(0, Math.min(999, Math.round((cur / tgt) * 100)));
}

function buildPeriodDescription(periodType, label) {
  const name = PERIODS.find((item) => item.key === periodType)?.label || label || '현재 기간';
  if (periodType === 'monthly') return `${name} 실적과 전달 대비 변화를 확인합니다.`;
  if (periodType === 'quarterly') return `${name} 실적과 직전 분기 비교, 목표 진행률을 함께 봅니다.`;
  if (periodType === 'semiannual') return `${name} 누적 실적과 직전 반기 대비 차이를 확인합니다.`;
  return `${name} 누적 실적과 직전 연도 대비 흐름을 확인합니다.`;
}

function getCurrentPeriodValueForType(periodType, now = new Date()) {
  const month = now.getMonth() + 1;
  if (periodType === 'quarterly') return Math.ceil(month / 3);
  if (periodType === 'semiannual') return month <= 6 ? 1 : 2;
  if (periodType === 'annual') return 1;
  return month;
}

function buildPeriodValueOptions(periodType) {
  if (periodType === 'quarterly') {
    return [
      { value: 1, label: '1분기' },
      { value: 2, label: '2분기' },
      { value: 3, label: '3분기' },
      { value: 4, label: '4분기' }
    ];
  }
  if (periodType === 'semiannual') {
    return [
      { value: 1, label: '상반기' },
      { value: 2, label: '하반기' }
    ];
  }
  if (periodType === 'annual') {
    return [{ value: 1, label: '연간' }];
  }
  return Array.from({ length: 12 }, (_, idx) => ({ value: idx + 1, label: `${idx + 1}월` }));
}

const KPI_MONTHS = Array.from({ length: 12 }, (_, idx) => idx + 1);

function sumByMonthRange(values, startMonth, endMonth) {
  let sum = 0;
  for (let month = startMonth; month <= endMonth; month += 1) {
    sum += Number(values?.[month - 1] || 0);
  }
  return sum;
}

function aggregateTargetByPeriod(values, periodType, periodValue) {
  if (periodType === 'annual') return sumByMonthRange(values, 1, 12);
  if (periodType === 'semiannual') {
    return Number(periodValue) === 1 ? sumByMonthRange(values, 1, 6) : sumByMonthRange(values, 7, 12);
  }
  if (periodType === 'quarterly') {
    const q = Math.min(4, Math.max(1, Number(periodValue) || 1));
    const start = (q - 1) * 3 + 1;
    return sumByMonthRange(values, start, start + 2);
  }
  const month = Math.min(12, Math.max(1, Number(periodValue) || 1));
  return Number(values?.[month - 1] || 0);
}

function parseMonthlyProjectEntriesFromNote(note) {
  if (note == null) return [];
  const raw = String(note || '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.projectEntries)) {
      return parsed.projectEntries
        .map((item) => {
          const title = String(item?.title || '').trim();
          const participantIds = Array.isArray(item?.participantIds)
            ? item.participantIds.map((v) => String(v || '').trim()).filter(Boolean)
            : [];
          return title ? { title, participantIds } : null;
        })
        .filter(Boolean)
        .slice(0, 50);
    }
    if (Array.isArray(parsed?.projectTitles)) {
      return parsed.projectTitles
        .map((v) => String(v || '').trim())
        .filter(Boolean)
        .slice(0, 50)
        .map((title) => ({ title, participantIds: [] }));
    }
    return [];
  } catch {
    return [];
  }
}

function buildMonthlyProjectNote(projectEntries = []) {
  const entries = (Array.isArray(projectEntries) ? projectEntries : [])
    .map((item) => {
      const title = String(item?.title || '').trim();
      if (!title) return null;
      const participantIds = Array.isArray(item?.participantIds)
        ? item.participantIds.map((v) => String(v || '').trim()).filter(Boolean)
        : [];
      return { title, participantIds };
    })
    .filter(Boolean)
    .slice(0, 50);
  return JSON.stringify({
    projectEntries: entries,
    projectTitles: entries.map((item) => item.title)
  });
}

function buildDetailRows(dashboard, metricKey = 'all') {
  const metrics = dashboard?.metrics || {};
  const target = dashboard?.target || {};
  const revenueCurrent = Number(metrics?.revenue?.current) || 0;
  const revenuePrevious = Number(metrics?.revenue?.previous) || 0;
  const revenueTarget = Number(metrics?.revenue?.target) || 0;
  const dealsCurrent = Number(metrics?.wonDeals?.current) || 0;
  const dealsPrevious = Number(metrics?.wonDeals?.previous) || 0;
  const projectsCurrent = Number(metrics?.completedProjects?.current) || 0;
  const projectsPrevious = Number(metrics?.completedProjects?.previous) || 0;
  const projectsTarget = Number(metrics?.completedProjects?.target) || Number(target?.targetProjects) || 0;
  const activeProjectsCurrent = Number(metrics?.activeProjects?.current) || 0;
  const activeProjectsPrevious = Number(metrics?.activeProjects?.previous) || 0;
  const workCurrent = Number(metrics?.workLogs?.current) || 0;
  const workPrevious = Number(metrics?.workLogs?.previous) || 0;
  const opAmtCur = Number(metrics?.otherPerformance?.amountCurrent) || 0;
  const opAmtPrev = Number(metrics?.otherPerformance?.amountPrevious) || 0;
  const opCntCur = Number(metrics?.otherPerformance?.countCurrent) || 0;
  const opCntPrev = Number(metrics?.otherPerformance?.countPrevious) || 0;

  const avgDealValue = dealsCurrent > 0
    ? revenueCurrent / dealsCurrent
    : dealsPrevious > 0
      ? revenuePrevious / Math.max(1, dealsPrevious)
      : 0;
  const dealTarget = revenueTarget > 0 && avgDealValue > 0
    ? Math.max(1, Math.round(revenueTarget / avgDealValue))
    : Math.max(dealsCurrent, dealsPrevious, 1);
  const workTarget = projectsTarget > 0
    ? Math.max(projectsTarget * 3, workPrevious, 1)
    : Math.max(workCurrent, workPrevious, 1);
  const formatGap = (key, value) => {
    const safe = Math.max(0, Number(value) || 0);
    if (key === 'revenue' || key === 'wonSales' || key === 'otherPerformance') return formatRevenue(safe);
    if (key === 'projects' || key === 'activeProjects') return `${formatNumber(safe)}개`;
    return `${formatNumber(safe)}건`;
  };

  const rawRows = [
    {
      key: 'wonSales',
      label: '수주 매출·성공',
      previous: revenuePrevious,
      current: revenueCurrent,
      target: revenueTarget,
      previousDisplay: `${formatRevenue(revenuePrevious)} · ${formatNumber(dealsPrevious)}건`,
      currentDisplay: `${formatRevenue(revenueCurrent)} · ${formatNumber(dealsCurrent)}건`,
      targetDisplay: revenueTarget > 0 ? formatRevenue(revenueTarget) : '미설정',
      dealsPrevious,
      dealsCurrent,
      dealTarget
    },
    {
      key: 'projects',
      label: '완료 프로젝트',
      previous: projectsPrevious,
      current: projectsCurrent,
      target: projectsTarget,
      previousDisplay: `${formatNumber(projectsPrevious)}개`,
      currentDisplay: `${formatNumber(projectsCurrent)}개`,
      targetDisplay: projectsTarget > 0 ? `${formatNumber(projectsTarget)}개` : '미설정',
      summaryText: projectsTarget > 0 ? `목표 ${formatNumber(projectsTarget)}개` : '목표 미설정'
    },
    {
      key: 'activeProjects',
      label: '진행중 프로젝트',
      previous: activeProjectsPrevious,
      current: activeProjectsCurrent,
      target: 0,
      previousDisplay: `${formatNumber(activeProjectsPrevious)}개`,
      currentDisplay: `${formatNumber(activeProjectsCurrent)}개`,
      targetDisplay: '-',
      summaryText: '백엔드 진행중 기준'
    },
    {
      key: 'workLogs',
      label: '업무 기록',
      previous: workPrevious,
      current: workCurrent,
      target: workTarget,
      previousDisplay: `${formatNumber(workPrevious)}건`,
      currentDisplay: `${formatNumber(workCurrent)}건`,
      targetDisplay: `${formatNumber(workTarget)}건`
    },
    {
      key: 'otherPerformance',
      label: '기타 성과',
      previous: opAmtPrev,
      current: opAmtCur,
      target: 0,
      previousDisplay: `${formatRevenue(opAmtPrev)} · ${formatNumber(opCntPrev)}건`,
      currentDisplay: `${formatRevenue(opAmtCur)} · ${formatNumber(opCntCur)}건`,
      targetDisplay: '-'
    }
  ];

  const maxValue = Math.max(
    1,
    ...rawRows.flatMap((row) => [row.previous, row.current, row.target])
  );

  const allRows = rawRows.map((row) => ({
    ...row,
    achievementPct: row.target > 0 ? calcAchievement(row.current, row.target) : null,
    gapDisplay:
      row.key === 'activeProjects'
        ? '백엔드 stage 기준 진행중'
        : row.key === 'otherPerformance'
        ? '직접 등록한 기타 성과 합계'
        : row.target > 0
        ? row.current >= row.target
          ? `목표 초과 ${formatGap(row.key, row.current - row.target)}`
          : `목표까지 ${formatGap(row.key, row.target - row.current)}`
        : '목표 미설정',
    previousPct: row.previous > 0 ? Math.max(8, Math.round((row.previous / maxValue) * 100)) : 0,
    currentPct: row.current > 0 ? Math.max(8, Math.round((row.current / maxValue) * 100)) : 0,
    targetPct: row.target > 0 ? Math.max(8, Math.round((row.target / maxValue) * 100)) : 0
  }));

  if (metricKey === 'wonSales' || metricKey === 'revenue' || metricKey === 'wonDeals') {
    return allRows.filter((row) => row.key === 'wonSales');
  }
  if (metricKey === 'projects') return allRows.filter((row) => row.key === 'projects' || row.key === 'activeProjects');
  if (metricKey === 'workLogs') return allRows.filter((row) => row.key === 'workLogs');
  if (metricKey === 'otherPerformance') return allRows.filter((row) => row.key === 'otherPerformance');
  return allRows.filter((row) => row.key !== 'activeProjects');
}

function buildChartRows(dashboard) {
  return buildDetailRows(dashboard, 'all');
}

function getDetailModalMeta(metricKey) {
  if (metricKey === 'wonSales' || metricKey === 'revenue' || metricKey === 'wonDeals') {
    return {
      title: '수주 매출·성공 상세',
      description: '현재 기간의 수주 매출 및 성공 건을 통합하여 확인합니다.'
    };
  }
  if (metricKey === 'projects') {
    return {
      title: '프로젝트 상세',
      description: '현재 범위에 속한 프로젝트를 낱개 단위로 확인합니다.'
    };
  }
  if (metricKey === 'workLogs') {
    return {
      title: '업무 기록 상세',
      description: '현재 기간의 업무 기록을 개별 항목으로 확인합니다.'
    };
  }
  if (metricKey === 'otherPerformance') {
    return {
      title: '기타 성과',
      description: '내용·참여자·기간·액수를 등록한 기타 성과 목록입니다.'
    };
  }
  return {
    title: 'KPI 상세',
    description: '차트에 보이는 핵심 지표를 표 형식으로 더 자세히 확인합니다.'
  };
}

/**
 * 체크리스트 API의 scopeType·scopeId.
 * 대시보드가 «개인» 범위일 때 직원만 바꿔도(전체 직원 ↔ 특정 직원) 동일한 체크리스트 문서를 써야
 * 입력한 점수가 유지됩니다. 전체 직원일 때는 이미 company였고, 특정 직원일 때만 user로 바뀌며
 * 빈 문서가 조회되어 0점처럼 보이던 문제가 있었습니다.
 * 목록·집계 필터는 그대로 kpiUserId 등으로 분리되고, 여기 값은 «누가 어떤 체크리스트 파일에 저장하는지»만 결정합니다.
 */
function resolveChecklistScope(scopeType, departmentId) {
  if (scopeType === 'team' && departmentId) {
    return { scopeType: 'team', scopeId: String(departmentId || '').trim() };
  }
  if (scopeType === 'user') {
    return { scopeType: 'company', scopeId: '' };
  }
  return { scopeType: 'company', scopeId: '' };
}

/** ObjectId / { $oid } / 문자열 혼재 시 KPI 참여자 키로 통일 */
function normalizeMongoIdString(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'string') {
    const t = v.trim();
    return /^[a-fA-F0-9]{24}$/.test(t) ? t : '';
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    const t = String(Math.trunc(v));
    return /^[a-fA-F0-9]{24}$/.test(t) ? t : '';
  }
  if (typeof v === 'object') {
    if (typeof v.$oid === 'string') {
      const t = v.$oid.trim();
      return /^[a-fA-F0-9]{24}$/.test(t) ? t : '';
    }
    if (v._id != null) return normalizeMongoIdString(v._id);
  }
  const t = String(v).trim();
  return /^[a-fA-F0-9]{24}$/.test(t) ? t : '';
}

function isProjectKpiRow(row) {
  return String(row?.key || '').startsWith('project:');
}

function projectParticipantCountFromRow(row) {
  const parts = Array.isArray(row?.projectParticipants) ? row.projectParticipants : [];
  const nList = parts.length;
  const nField = Math.max(0, Math.floor(Number(row?.projectParticipantCount) || 0));
  return Math.max(1, nList || nField || 1);
}

/** 저장된 점수 행을 현재 상세 API의 참여자 목록에 맞춤(재오픈·인원 변동 시 누락 방지) */
function reconcileParticipantScoresForProject(parts, scores) {
  const list = Array.isArray(parts) ? parts : [];
  const byUser = new Map();
  for (const s of Array.isArray(scores) ? scores : []) {
    const uid = normalizeMongoIdString(s?.userId);
    if (!uid) continue;
    byUser.set(uid, Math.max(0, Number(s?.score) || 0));
  }
  return list
    .map((p) => {
      const uid = normalizeMongoIdString(p?.userId);
      if (!uid) return null;
      return { userId: uid, score: byUser.has(uid) ? byUser.get(uid) : 0 };
    })
    .filter(Boolean);
}

function mergeChecklistItems(rows, checklistItems = []) {
  const byKey = new Map(
    (Array.isArray(checklistItems) ? checklistItems : []).map((item) => [String(item?.itemKey || '').trim(), item])
  );
  return rows.map((row) => {
    const saved = byKey.get(row.key);
    const base = {
      ...row,
      score: Math.max(0, Number(saved?.score) || 0),
      checked: Boolean(saved?.checked)
    };
    if (!isProjectKpiRow(row)) return base;

    const parts = Array.isArray(row.projectParticipants) ? row.projectParticipants : [];
    const nFromRow = projectParticipantCountFromRow(row);
    const nSaved = Math.max(0, Math.floor(Number(saved?.projectParticipantCount) || 0));
    const n = Math.max(1, nFromRow, nSaved || 0);
    const rawMode = String(saved?.projectScoreMode || '').trim();
    const hasSavedMode = rawMode === 'uniform_each' || rawMode === 'individual' || rawMode === 'flat';
    let mode = hasSavedMode
      ? rawMode
      : (parts.length >= 1 ? 'individual' : 'flat');

    let projectUniformUnit = Math.max(0, Math.floor(Number(saved?.projectUniformUnit) || 0));
    let participantScores = Array.isArray(saved?.participantScores)
      ? saved.participantScores.map((p) => ({
        userId: normalizeMongoIdString(p?.userId),
        score: Math.max(0, Number(p.score) || 0)
      })).filter((p) => p.userId)
      : [];

    if (mode === 'uniform_each' && n < 2) {
      mode = 'flat';
      projectUniformUnit = 0;
      participantScores = [];
    }

    if (mode === 'uniform_each') {
      const denom = nSaved > 0 ? nSaved : nFromRow;
      if (!projectUniformUnit && denom > 0) {
        projectUniformUnit = Math.max(0, Math.floor(base.score / denom));
      }
    } else if (mode === 'individual') {
      participantScores = reconcileParticipantScoresForProject(parts, participantScores);
      if (participantScores.length === 0 && parts.length > 0) {
        const per = n > 0 ? Math.max(0, Math.floor(base.score / n)) : 0;
        participantScores = parts
          .map((p) => ({ userId: normalizeMongoIdString(p.userId), score: per }))
          .filter((p) => p.userId);
      } else if (participantScores.length > 0 && participantScores.every((r) => r.score === 0) && base.score > 0) {
        const per = n > 0 ? Math.max(0, Math.floor(base.score / n)) : 0;
        participantScores = participantScores.map((r) => ({ ...r, score: per }));
      }
    }

    const uniformOut = mode === 'uniform_each' ? projectUniformUnit : 0;
    const scoresOut = mode === 'individual' ? participantScores : [];
    const scoreOut = mode === 'individual'
      ? scoresOut.reduce((s, r) => s + Math.max(0, Number(r.score) || 0), 0)
      : base.score;

    return {
      ...base,
      score: scoreOut,
      projectScoreMode: mode,
      projectUniformUnit: uniformOut,
      participantScores: scoresOut,
      projectParticipantCount: n
    };
  });
}

function normalizeDetailItems(items = []) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    ...item,
    key: String(item?.key || '').trim(),
    label: String(item?.label || '항목'),
    currentDisplay: String(item?.currentDisplay || ''),
    previousDisplay: String(item?.previousDisplay || ''),
    targetDisplay: String(item?.targetDisplay || '-'),
    summaryText: String(item?.summaryText || ''),
    gapDisplay: String(item?.gapDisplay || ''),
    customerCompanyDisplay: String(item?.customerCompanyDisplay || '').trim(),
    businessNumberDisplay: String(item?.businessNumberDisplay || '').trim(),
    productName: String(item?.productName || '').trim(),
    quantity: Math.max(0, Number(item?.quantity) || 0),
    unitPriceLabel: String(item?.unitPriceLabel || '').trim(),
    contactPhone: String(item?.contactPhone || '').trim(),
    contactEmail: String(item?.contactEmail || '').trim(),
    assigneeDisplay: String(item?.assigneeDisplay || '').trim(),
    contactDisplay: String(item?.contactDisplay || '').trim(),
    dateLabelTitle: String(item?.dateLabelTitle || '완료일').trim(),
    completedDateDisplay: String(item?.completedDateDisplay || '').trim(),
    detailLines: (Array.isArray(item?.detailLines) ? item.detailLines : []).map((line) => String(line || '').trim()).filter(Boolean),
    achievementPct: item?.achievementPct == null ? null : Number(item.achievementPct),
    kind: String(item?.kind || '').trim(),
    otherStartAt: String(item?.otherStartAt || ''),
    otherEndAt: String(item?.otherEndAt || ''),
    otherParticipants: Array.isArray(item?.otherParticipants) ? item.otherParticipants : [],
    projectParticipants: Array.isArray(item?.projectParticipants)
      ? item.projectParticipants
        .map((p) => ({
          userId: normalizeMongoIdString(p?.userId),
          name: String(p?.name || '').trim()
        }))
        .filter((p) => p.userId)
      : [],
    projectParticipantCount: Math.max(
      1,
      Number(item?.projectParticipantCount) || (Array.isArray(item?.projectParticipants) ? item.projectParticipants.length : 0) || 1
    ),
    projectScoreMode: String(item?.projectScoreMode || 'flat').trim(),
    projectUniformUnit: Math.max(0, Math.floor(Number(item?.projectUniformUnit) || 0)),
    participantScores: Array.isArray(item?.participantScores)
      ? item.participantScores.map((p) => ({
        userId: normalizeMongoIdString(p?.userId),
        score: Math.max(0, Number(p?.score) || 0)
      })).filter((p) => p.userId)
      : []
  })).filter((item) => item.key);
}

function buildChecklistPayloadItem(item) {
  const base = {
    itemKey: item.key,
    score: Math.max(0, Number(item.score) || 0),
    checked: Boolean(item.checked)
  };
  if (!isProjectKpiRow(item)) return base;
  const n = projectParticipantCountFromRow(item);
  const mode = item.projectScoreMode === 'individual' ? 'individual' : (item.projectScoreMode === 'uniform_each' ? 'uniform_each' : 'flat');
  if (mode === 'uniform_each') {
    const unit = Math.max(0, Math.floor(Number(item.projectUniformUnit) || 0));
    return {
      ...base,
      score: unit * n,
      projectScoreMode: 'uniform_each',
      projectUniformUnit: unit,
      projectParticipantCount: n,
      participantScores: []
    };
  }
  if (mode === 'individual') {
    const scores = (Array.isArray(item.participantScores) ? item.participantScores : []).map((p) => ({
      userId: normalizeMongoIdString(p.userId),
      score: Math.max(0, Number(p.score) || 0)
    })).filter((p) => p.userId);
    const total = scores.reduce((sum, row) => sum + row.score, 0);
    return {
      ...base,
      score: total,
      projectScoreMode: 'individual',
      projectUniformUnit: 0,
      projectParticipantCount: n,
      participantScores: scores
    };
  }
  return {
    ...base,
    score: Math.max(0, Number(item.score) || 0),
    projectScoreMode: 'flat',
    projectUniformUnit: 0,
    projectParticipantCount: n,
    participantScores: []
  };
}

function hasChecklistSummary(summary) {
  return Boolean(summary && Number(summary?.totalCount) > 0);
}

function getUserName() {
  try {
    const raw = localStorage.getItem('crm_user');
    const user = raw ? JSON.parse(raw) : null;
    const name = String(user?.name || '').trim();
    return name || '사용자';
  } catch {
    return '사용자';
  }
}

function getStoredUser() {
  try {
    const raw = localStorage.getItem('crm_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export default function Kpi() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialFilters = useMemo(() => {
    const f = readInitialKpiFiltersFromWindow();
    return {
      period: f.period || 'monthly',
      scopeType: f.scopeType || 'team',
      selectedScopeDepartment: f.scopeType === 'team' && f.kpiDept ? f.kpiDept : '',
      selectedScopeUser: f.scopeType === 'user' && f.kpiStaff ? f.kpiStaff : '',
      viewBy: f.viewBy || 'overall',
      selectedDepartment: f.viewBy === 'department' && f.kpiLbDept ? f.kpiLbDept : '',
      selectedRank: f.viewBy === 'rank' && f.kpiLbRank ? f.kpiLbRank : ''
    };
  }, []);
  const [period, setPeriod] = useState(initialFilters.period);
  const [scopeType, setScopeType] = useState(initialFilters.scopeType);
  const [selectedScopeDepartment, setSelectedScopeDepartment] = useState(initialFilters.selectedScopeDepartment);
  const [selectedScopeUser, setSelectedScopeUser] = useState(initialFilters.selectedScopeUser);
  const [viewBy, setViewBy] = useState(initialFilters.viewBy);
  const [selectedDepartment, setSelectedDepartment] = useState(initialFilters.selectedDepartment);
  const [selectedRank, setSelectedRank] = useState(initialFilters.selectedRank);
  const skipFirstUrlHydrateRef = useRef(true);
  const [dashboard, setDashboard] = useState(null);
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [targetRevenueInput, setTargetRevenueInput] = useState('');
  const [targetProjectsInput, setTargetProjectsInput] = useState('');
  const [targetNote, setTargetNote] = useState('');
  const [savingTarget, setSavingTarget] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [targetOverview, setTargetOverview] = useState(null);
  const [targetModalScopeType, setTargetModalScopeType] = useState('team');
  const [targetModalDepartmentId, setTargetModalDepartmentId] = useState('');
  const [targetModalUserId, setTargetModalUserId] = useState('');
  const [targetModalYear, setTargetModalYear] = useState(new Date().getFullYear());
  const [targetModalMonthlyRevenue, setTargetModalMonthlyRevenue] = useState(() => Array(12).fill(''));
  const [targetModalMonthlyProjects, setTargetModalMonthlyProjects] = useState(() => Array(12).fill(''));
  const [targetModalMonthlyProjectTitles, setTargetModalMonthlyProjectTitles] = useState(
    () => Array.from({ length: 12 }, () => [])
  );
  const [targetModalMonthlyProjectEntries, setTargetModalMonthlyProjectEntries] = useState(
    () => Array.from({ length: 12 }, () => [])
  );
  const [targetModalMonthlyProjectTitleDrafts, setTargetModalMonthlyProjectTitleDrafts] = useState(
    () => Array(12).fill('')
  );
  const [targetModalMonthlyProjectParticipantDrafts, setTargetModalMonthlyProjectParticipantDrafts] = useState(
    () => Array.from({ length: 12 }, () => [])
  );
  const [targetModalLoadedUserMonthlyRevenue, setTargetModalLoadedUserMonthlyRevenue] = useState(() => Array(12).fill(0));
  const [targetModalLoadedUserMonthlyProjects, setTargetModalLoadedUserMonthlyProjects] = useState(() => Array(12).fill(0));
  const [targetModalTeamMonthlyRevenue, setTargetModalTeamMonthlyRevenue] = useState(() => Array(12).fill(0));
  const [targetModalTeamMonthlyProjects, setTargetModalTeamMonthlyProjects] = useState(() => Array(12).fill(0));
  const [targetModalLoading, setTargetModalLoading] = useState(false);
  const [targetModalSaving, setTargetModalSaving] = useState(false);
  const [targetModalMessage, setTargetModalMessage] = useState('');
  const [checklistSummaryByMetric, setChecklistSummaryByMetric] = useState({});
  const [detailChecklistItems, setDetailChecklistItems] = useState([]);
  const [detailChecklistLoading, setDetailChecklistLoading] = useState(false);
  const [detailChecklistSaving, setDetailChecklistSaving] = useState(false);
  const [detailChecklistMessage, setDetailChecklistMessage] = useState('');
  const [otherPerfForm, setOtherPerfForm] = useState({
    title: '',
    amount: '',
    startDate: '',
    endDate: '',
    participants: []
  });
  const [participantPickerOpen, setParticipantPickerOpen] = useState(false);
  const [otherPerfSubmitting, setOtherPerfSubmitting] = useState(false);
  const [otherPerfRefresh, setOtherPerfRefresh] = useState(0);

  const displayName = useMemo(() => getUserName(), []);
  const storedUser = useMemo(() => getStoredUser(), []);
  const currentUserId = String(storedUser?._id || storedUser?.id || overview?.me?.id || '').trim();
  const availableDepartments = dashboard?.filters?.availableDepartments || [];
  const availableRanks = dashboard?.filters?.availableRanks || [];
  const overviewEmployees = overview?.employees || [];
  const overviewOrgChart = overview?.company?.organizationChart || null;
  const currentEmployee = useMemo(
    () => overviewEmployees.find((employee) => String(employee.id) === currentUserId) || null,
    [overviewEmployees, currentUserId]
  );
  const currentDepartmentId = String(currentEmployee?.department || '').trim();
  const kpiAccess = dashboard?.kpiAccess || null;
  const kpiScopeTabOptions = useMemo(
    () => (kpiAccess?.mode === 'self' ? KPI_SCOPE_OPTIONS.filter((x) => x.key === 'user') : KPI_SCOPE_OPTIONS),
    [kpiAccess?.mode]
  );
  const scopeDepartmentOptions = useMemo(() => {
    const orgOptions = flattenOrgChartOptions(overviewOrgChart, []);
    const seen = new Set(orgOptions.map((item) => item.id));
    const legacy = [];
    for (const employee of overviewEmployees) {
      const raw = String(employee?.department || '').trim();
      if (!raw || seen.has(raw)) continue;
      seen.add(raw);
      legacy.push({ id: raw, label: resolveDeptDisplay(overviewOrgChart, raw) || raw });
    }
    return [...orgOptions, ...legacy].sort((a, b) => a.label.localeCompare(b.label, 'ko'));
  }, [overviewEmployees, overviewOrgChart]);
  const allowedDeptIdSet = useMemo(() => {
    if (kpiAccess?.mode !== 'leader' || !Array.isArray(kpiAccess.allowedDepartmentIds)) return null;
    return new Set(kpiAccess.allowedDepartmentIds);
  }, [kpiAccess]);
  const filteredScopeDepartmentOptions = useMemo(() => {
    if (!allowedDeptIdSet) return scopeDepartmentOptions;
    return scopeDepartmentOptions.filter((o) => allowedDeptIdSet.has(o.id));
  }, [scopeDepartmentOptions, allowedDeptIdSet]);
  const scopeUserOptions = useMemo(() => (
    [...overviewEmployees]
      .map((employee) => ({
        id: String(employee.id),
        name: employee.name || employee.email || '사용자',
        avatar: String(employee.avatar || '').trim(),
        label: `${employee.name || employee.email || '사용자'} · ${resolveDeptDisplay(overviewOrgChart, employee.department) || '부서 미배정'}`
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  ), [overviewEmployees, overviewOrgChart]);
  const filteredScopeUserOptions = useMemo(() => {
    if (kpiAccess?.mode === 'self' && currentUserId) {
      return scopeUserOptions.filter((o) => o.id === currentUserId);
    }
    if (kpiAccess?.mode === 'leader' && Array.isArray(kpiAccess.allowedUserIds)) {
      const allow = new Set(kpiAccess.allowedUserIds);
      return scopeUserOptions.filter((o) => allow.has(o.id));
    }
    return scopeUserOptions;
  }, [scopeUserOptions, kpiAccess, currentUserId]);
  const selectedScopeUserOption = useMemo(
    () => {
      const hit = filteredScopeUserOptions.find((item) => item.id === selectedScopeUser);
      if (hit) return hit;
      if (kpiAccess?.mode === 'self' || kpiAccess?.mode === 'leader') return null;
      return scopeUserOptions.find((item) => item.id === selectedScopeUser) || null;
    },
    [filteredScopeUserOptions, scopeUserOptions, selectedScopeUser, kpiAccess?.mode]
  );
  const participantTeamMembers = useMemo(
    () => overviewEmployees.map((e) => ({
      _id: e.id || e._id,
      name: e.name,
      email: e.email || '',
      phone: e.phone || '',
      companyDepartment: e.companyDepartment || e.department || '',
      department: resolveDeptDisplay(overviewOrgChart, e.department || e.companyDepartment),
      departmentDisplay: resolveDeptDisplay(overviewOrgChart, e.department || e.companyDepartment)
    })),
    [overviewEmployees, overviewOrgChart]
  );
  const targetModalDepartmentOptions = useMemo(
    () => {
      const myDept = String(currentDepartmentId || '').trim();
      if (!myDept) return [];

      const baseById = new Map(filteredScopeDepartmentOptions.map((item) => [item.id, item]));
      const isDeptLeader = kpiAccess?.mode === 'leader';

      if (!isDeptLeader) {
        const own = baseById.get(myDept);
        return own ? [{ ...own, readOnly: false }] : [{ id: myDept, label: resolveDeptDisplay(overviewOrgChart, myDept) || myDept, readOnly: false }];
      }

      const root = findOrgChartNodeById(overviewOrgChart, myDept);
      const descendants = root ? collectOrgChartDeptIds(root, []) : [myDept];
      const allowedIds = new Set(descendants);
      const out = descendants.map((id) => {
        const hit = baseById.get(id);
        return hit
          ? { ...hit, readOnly: id !== myDept }
          : { id, label: resolveDeptDisplay(overviewOrgChart, id) || id, readOnly: id !== myDept };
      });
      return out.filter((item) => allowedIds.has(item.id));
    },
    [filteredScopeDepartmentOptions, currentDepartmentId, kpiAccess?.mode, overviewOrgChart]
  );
  const targetModalUserOptions = useMemo(
    () => {
      const uid = String(currentUserId || '').trim();
      if (!uid) return [];
      return filteredScopeUserOptions.filter((item) => item.id === uid);
    },
    [filteredScopeUserOptions, currentUserId]
  );
  const targetModalSelectedUserDeptId = useMemo(() => {
    const uid = String(targetModalUserId || '').trim();
    if (!uid) return '';
    const hit = overviewEmployees.find((item) => String(item?.id || '').trim() === uid);
    return String(hit?.department || hit?.companyDepartment || '').trim();
  }, [overviewEmployees, targetModalUserId]);
  const effectiveTeamDeptIdForTargetModal = useMemo(() => {
    const explicit = String(targetModalDepartmentId || '').trim();
    if (explicit) return explicit;
    return targetModalSelectedUserDeptId;
  }, [targetModalDepartmentId, targetModalSelectedUserDeptId]);
  const teamUserIdsForTargetModal = useMemo(() => {
    const dept = String(effectiveTeamDeptIdForTargetModal || '').trim();
    if (!dept) return [];
    return overviewEmployees
      .filter((item) => String(item?.department || item?.companyDepartment || '').trim() === dept)
      .map((item) => String(item.id || '').trim())
      .filter(Boolean);
  }, [overviewEmployees, effectiveTeamDeptIdForTargetModal]);
  const teamDeptAndDescendantIdsForTargetModal = useMemo(() => {
    const dept = String(effectiveTeamDeptIdForTargetModal || '').trim();
    if (!dept) return [];
    const startNode = findOrgChartNodeById(overviewOrgChart, dept);
    if (!startNode) return [dept];
    return collectOrgChartDeptIds(startNode, []);
  }, [effectiveTeamDeptIdForTargetModal, overviewOrgChart]);
  const canSelectTeamProjectParticipants = useMemo(() => {
    if (targetModalScopeType !== 'team') return false;
    if (kpiAccess?.mode !== 'leader') return false;
    if (!allowedDeptIdSet) return false;
    return teamDeptAndDescendantIdsForTargetModal.some((id) => allowedDeptIdSet.has(id));
  }, [targetModalScopeType, kpiAccess?.mode, allowedDeptIdSet, teamDeptAndDescendantIdsForTargetModal]);
  const targetModalTeamProjectParticipantOptions = useMemo(() => {
    if (targetModalScopeType !== 'team') return [];
    const allowedDepts = new Set(teamDeptAndDescendantIdsForTargetModal);
    return overviewEmployees
      .filter((emp) => {
        const dept = String(emp?.department || emp?.companyDepartment || '').trim();
        return dept && allowedDepts.has(dept);
      })
      .map((emp) => ({
        id: String(emp.id || '').trim(),
        label: `${emp.name || emp.email || '사용자'} · ${resolveDeptDisplay(overviewOrgChart, emp?.department || emp?.companyDepartment) || '부서 미배정'}`
      }))
      .filter((item) => item.id)
      .sort((a, b) => a.label.localeCompare(b.label, 'ko'));
  }, [targetModalScopeType, teamDeptAndDescendantIdsForTargetModal, overviewEmployees, overviewOrgChart]);
  const targetModalCurrentUserMonthlyRevenueNums = useMemo(
    () => KPI_MONTHS.map((month) => Number(String(targetModalMonthlyRevenue[month - 1] || '').replace(/\D/g, '')) || 0),
    [targetModalMonthlyRevenue]
  );
  const targetModalCurrentUserMonthlyProjectNums = useMemo(
    () => KPI_MONTHS.map((month) => Number(String(targetModalMonthlyProjects[month - 1] || '').replace(/\D/g, '')) || 0),
    [targetModalMonthlyProjects]
  );
  const targetModalTeamMonthlyRevenueDisplay = useMemo(() => {
    const base = Array.isArray(targetModalTeamMonthlyRevenue) ? targetModalTeamMonthlyRevenue : Array(12).fill(0);
    if (!teamUserIdsForTargetModal.includes(String(targetModalUserId || '').trim())) return base;
    return base.map((v, idx) =>
      Math.max(
        0,
        Number(v || 0) - Number(targetModalLoadedUserMonthlyRevenue[idx] || 0) + Number(targetModalCurrentUserMonthlyRevenueNums[idx] || 0)
      )
    );
  }, [
    targetModalTeamMonthlyRevenue,
    teamUserIdsForTargetModal,
    targetModalUserId,
    targetModalLoadedUserMonthlyRevenue,
    targetModalCurrentUserMonthlyRevenueNums
  ]);
  const targetModalTeamMonthlyProjectsDisplay = useMemo(() => {
    const base = Array.isArray(targetModalTeamMonthlyProjects) ? targetModalTeamMonthlyProjects : Array(12).fill(0);
    if (!teamUserIdsForTargetModal.includes(String(targetModalUserId || '').trim())) return base;
    return base.map((v, idx) =>
      Math.max(
        0,
        Number(v || 0) - Number(targetModalLoadedUserMonthlyProjects[idx] || 0) + Number(targetModalCurrentUserMonthlyProjectNums[idx] || 0)
      )
    );
  }, [
    targetModalTeamMonthlyProjects,
    teamUserIdsForTargetModal,
    targetModalUserId,
    targetModalLoadedUserMonthlyProjects,
    targetModalCurrentUserMonthlyProjectNums
  ]);
  const canSubmitTargetModal = useMemo(
    () => targetModalScopeType === 'user' && String(targetModalUserId || '').trim() === String(currentUserId || '').trim() && !!currentUserId,
    [targetModalScopeType, targetModalUserId, currentUserId]
  );
  const targetModalScopeNotice = useMemo(() => {
    if (targetModalScopeType === 'user') {
      return '개인별은 본인 목표만 조회·수정할 수 있습니다.';
    }
    const selectedDept = String(targetModalDepartmentId || '').trim();
    const myDept = String(currentDepartmentId || '').trim();
    if (kpiAccess?.mode === 'leader') {
      if (selectedDept && myDept && selectedDept !== myDept) {
        return '하위 부서는 조회만 가능합니다. 수정은 본인 부서에서만 가능합니다.';
      }
      return '팀별은 본인 팀과 하위 부서를 조회할 수 있습니다.';
    }
    return '팀별은 본인 팀 데이터만 조회할 수 있습니다.';
  }, [targetModalScopeType, targetModalDepartmentId, currentDepartmentId, kpiAccess?.mode]);

  const handleScopeTypeChange = useCallback((key) => {
    setScopeType(key);
    if (key === 'team') {
      setSelectedScopeUser('');
    } else {
      setSelectedScopeDepartment('');
      setSelectedScopeUser(KPI_ALL_STAFF_VALUE);
    }
  }, []);

  /** KPI 필터 상태 → 주소창 (모달 kpiList / kpiMetric / kpiTarget 유지) */
  useEffect(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      mergeKpiFilterSearchParams(next, {
        scopeType,
        period,
        viewBy,
        selectedScopeDepartment,
        selectedScopeUser,
        selectedDepartment,
        selectedRank
      });
      return next;
    }, { replace: true });
  }, [
    scopeType,
    period,
    viewBy,
    selectedScopeDepartment,
    selectedScopeUser,
    selectedDepartment,
    selectedRank,
    setSearchParams
  ]);

  /** 뒤로가기·직접 주소 수정 시에만 동작 (searchParams만 의존 — UI로 바꾼 직후 옛 URL로 되돌리지 않음) */
  useEffect(() => {
    if (skipFirstUrlHydrateRef.current) {
      skipFirstUrlHydrateRef.current = false;
      return;
    }
    const fromUrl = resolvedKpiFiltersFromParsed(parseKpiFiltersFromSearchParams(searchParams));
    setPeriod((p) => (fromUrl.period !== p ? fromUrl.period : p));
    setScopeType((s) => (fromUrl.scopeType !== s ? fromUrl.scopeType : s));
    setSelectedScopeDepartment((d) => (fromUrl.selectedScopeDepartment !== d ? fromUrl.selectedScopeDepartment : d));
    setSelectedScopeUser((u) => (fromUrl.selectedScopeUser !== u ? fromUrl.selectedScopeUser : u));
    setViewBy((v) => (fromUrl.viewBy !== v ? fromUrl.viewBy : v));
    setSelectedDepartment((d) => (fromUrl.selectedDepartment !== d ? fromUrl.selectedDepartment : d));
    setSelectedRank((r) => (fromUrl.selectedRank !== r ? fromUrl.selectedRank : r));
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;
    const fetchOverview = async () => {
      try {
        const res = await fetch(`${API_BASE}/companies/overview`, {
          headers: getAuthHeader(),
          credentials: 'include'
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || '사내 현황 데이터를 불러오지 못했습니다.');
        if (!cancelled) setOverview(json);
      } catch (_) {
        if (!cancelled) setOverview(null);
      }
    };
    fetchOverview();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ periodType: period, viewBy });
    params.set('scopeType', scopeType);
    if (scopeType === 'team' && selectedScopeDepartment) params.set('departmentId', selectedScopeDepartment);
    if (scopeType === 'user' && selectedScopeUser) params.set('userId', selectedScopeUser);
    if (selectedDepartment) params.set('department', selectedDepartment);
    if (selectedRank) params.set('rank', selectedRank);

    const fetchDashboard = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`${API_BASE}/kpi/dashboard?${params.toString()}`, {
          headers: getAuthHeader(),
          credentials: 'include'
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || 'KPI 데이터를 불러오지 못했습니다.');
        if (cancelled) return;
        setDashboard(json);
        setTargetRevenueInput(String(Number(json?.target?.targetRevenue) || 0));
        setTargetProjectsInput(String(Number(json?.target?.targetProjects) || 0));
        setTargetNote(String(json?.target?.note || ''));
      } catch (err) {
        if (!cancelled) {
          setDashboard(null);
          setError(err.message || 'KPI 데이터를 불러오지 못했습니다.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchDashboard();
    return () => { cancelled = true; };
  }, [period, scopeType, selectedScopeDepartment, selectedScopeUser, viewBy, selectedDepartment, selectedRank]);

  const skipLbFilterResetRef = useRef(true);
  useEffect(() => {
    if (skipLbFilterResetRef.current) {
      skipLbFilterResetRef.current = false;
      return;
    }
    setSelectedDepartment('');
    setSelectedRank('');
  }, [viewBy, period]);

  useEffect(() => {
    if (scopeType !== 'user') return;
    if (selectedScopeUser) return;
    if (kpiAccess?.mode === 'self' && currentUserId) {
      setSelectedScopeUser(currentUserId);
      return;
    }
    if (scopeUserOptions.length === 0) return;
    setSelectedScopeUser(KPI_ALL_STAFF_VALUE);
  }, [scopeType, selectedScopeUser, scopeUserOptions, kpiAccess?.mode, currentUserId]);

  /**
   * stale URL·권한 변경 등으로 현재 사용자가 고를 수 없는 직원 id가 남아 있으면
   * UI에는 다른 직원처럼 보이는데 백엔드는 actorId(로그인 사용자)로 대체할 수 있다.
   * 이 경우 프론트에서 바로 정리해 실제 요청 대상과 표시가 어긋나지 않게 한다.
   */
  useEffect(() => {
    if (scopeType !== 'user') return;
    const selected = String(selectedScopeUser || '').trim();
    if (!selected || selected === KPI_ALL_STAFF_VALUE) return;
    const allowed = new Set(filteredScopeUserOptions.map((item) => item.id));
    if (allowed.has(selected)) return;
    if (kpiAccess?.mode === 'self' && currentUserId) {
      setSelectedScopeUser(currentUserId);
      return;
    }
    setSelectedScopeUser(KPI_ALL_STAFF_VALUE);
  }, [scopeType, selectedScopeUser, filteredScopeUserOptions, kpiAccess?.mode, currentUserId]);

  useEffect(() => {
    if (!kpiAccess || kpiAccess.mode !== 'self' || !currentUserId) return;
    if (scopeType !== 'user') setScopeType('user');
    setSelectedScopeDepartment('');
    if (selectedScopeUser !== currentUserId) setSelectedScopeUser(currentUserId);
  }, [kpiAccess?.mode, currentUserId, scopeType, selectedScopeUser]);

  const currentPeriodLabel = dashboard?.period?.current?.label || (PERIODS.find((item) => item.key === period)?.label || '현재 기간');
  const comparisonRows = useMemo(() => buildChartRows(dashboard), [dashboard]);
  const isListModalOpen = searchParams.get(KPI_LIST_MODAL_PARAM) === '1';
  const selectedListMetric = String(searchParams.get(KPI_LIST_METRIC_PARAM) || 'all').trim() || 'all';
  const isTargetModalOpen = searchParams.get(KPI_TARGET_MODAL_PARAM) === '1';
  const detailModalRows = useMemo(() => buildDetailRows(dashboard, selectedListMetric), [dashboard, selectedListMetric]);
  const detailModalMeta = useMemo(() => getDetailModalMeta(selectedListMetric), [selectedListMetric]);
  const checklistScope = useMemo(
    () => resolveChecklistScope(scopeType, selectedScopeDepartment),
    [scopeType, selectedScopeDepartment]
  );
  /** 개인별 + 특정 직원 선택 시 상세 모달에서 참여자·직원별 점수를 해당 직원만 표시 */
  const checklistStaffFilterUserId = useMemo(() => {
    if (scopeType !== 'user') return null;
    const u = String(selectedScopeUser || '').trim();
    if (!u || u === KPI_ALL_STAFF_VALUE) return null;
    return u;
  }, [scopeType, selectedScopeUser]);
  const checklistPeriod = dashboard?.period?.current || null;
  const leaderboardRows = dashboard?.leaderboard?.items || [];
  const contributionBar = dashboard?.contributionBar || null;
  const target = dashboard?.target || {};
  const metrics = dashboard?.metrics || {};
  const isAllStaffUserScope = scopeType === 'user' && selectedScopeUser === KPI_ALL_STAFF_VALUE;
  const targetOverviewScopeId = scopeType === 'team' ? selectedScopeDepartment : selectedScopeUser;
  const targetOverviewScopeLabel = scopeType === 'team'
    ? scopeDepartmentOptions.find((item) => item.id === selectedScopeDepartment)?.label || ''
    : isAllStaffUserScope
      ? '전체 직원'
      : scopeUserOptions.find((item) => item.id === selectedScopeUser)?.name || '';
  const targetOverviewTitle = scopeType === 'team'
    ? targetOverviewScopeLabel ? `${targetOverviewScopeLabel} 목표 현황` : '팀 목표 현황'
    : isAllStaffUserScope
      ? '회사 목표 현황'
      : targetOverviewScopeLabel ? `${targetOverviewScopeLabel} 목표 현황` : '개인 목표 현황';

  const cards = useMemo(() => {
    const revenueDelta = formatDelta(metrics?.revenue?.current, metrics?.revenue?.previous);
    const projectDelta = formatDelta(metrics?.completedProjects?.current, metrics?.completedProjects?.previous, '개');
    const workDelta = formatDelta(metrics?.workLogs?.current, metrics?.workLogs?.previous, '건');
    const opAmtCur = Number(metrics?.otherPerformance?.amountCurrent) || 0;
    const opAmtPrev = Number(metrics?.otherPerformance?.amountPrevious) || 0;
    const opDelta = formatDelta(opAmtCur, opAmtPrev);
    const opCnt = Number(metrics?.otherPerformance?.countCurrent) || 0;
    const wonHint = [
      `수주 성공 ${formatNumber(metrics?.wonDeals?.current)}건`,
      target?.targetRevenue > 0 ? `목표 ${formatRevenue(target?.targetRevenue)}` : '목표 미설정'
    ].join(' · ');
    const projHint = target?.targetProjects > 0
      ? `목표 ${formatNumber(target?.targetProjects)}개 · 큰 숫자는 완료 개수`
      : '목표 미설정 · 큰 숫자는 완료 개수';
    const workHint = `이전 ${formatNumber(metrics?.workLogs?.previous)}건`;
    const otherHint = `${formatNumber(opCnt)}건 등록 · 직접 등록`;

    return [
      {
        key: 'wonSales',
        detailKey: 'wonSales',
        label: '수주 매출',
        hint: wonHint,
        value: formatRevenue(metrics?.revenue?.current),
        delta: revenueDelta.text,
        deltaNeutral: revenueDelta.text.includes('변동 없음'),
        positive: revenueDelta.positive,
        icon: 'payments'
      },
      {
        key: 'projects',
        detailKey: 'projects',
        label: '완료 프로젝트',
        hint: projHint,
        value: `${formatNumber(metrics?.completedProjects?.current)}개`,
        valueMeta: '완료 개수',
        delta: projectDelta.text,
        deltaNeutral: projectDelta.text.includes('변동 없음'),
        positive: projectDelta.positive,
        icon: 'assignment_turned_in'
      },
      {
        key: 'workLogs',
        detailKey: 'workLogs',
        label: '업무 기록',
        hint: workHint,
        value: `${formatNumber(metrics?.workLogs?.current)}건`,
        delta: workDelta.text,
        deltaNeutral: workDelta.text.includes('변동 없음'),
        positive: workDelta.positive,
        icon: 'edit_note'
      },
      {
        key: 'otherPerformance',
        detailKey: 'otherPerformance',
        label: '기타 성과',
        hint: otherHint,
        value: formatRevenue(opAmtCur),
        delta: opDelta.text,
        deltaNeutral: opDelta.text.includes('변동 없음'),
        positive: opDelta.positive,
        icon: 'interests'
      }
    ];
  }, [metrics, target]);

  const goalRate = calcAchievement(metrics?.revenue?.current, target?.targetRevenue);
  const projectGoalRate = calcAchievement(metrics?.completedProjects?.current, target?.targetProjects);
  const strongestLeaderboard = leaderboardRows[0];
  const hideKpiScoreMethod = Boolean(kpiAccess?.hideScoreMethodology);
  const workInsightDelta = formatDelta(metrics?.workLogs?.current, metrics?.workLogs?.previous, '건');
  const insightCards = useMemo(() => ([
    {
      key: 'revenue-goal',
      tone: 'goal',
      title: '매출 목표 달성률',
      kind: 'ring',
      value: `${goalRate}%`,
      description:
        target?.targetRevenue > 0
          ? `현재 매출 ${formatRevenue(metrics?.revenue?.current)}으로 목표 ${formatRevenue(target?.targetRevenue)} 대비 ${goalRate}% 달성했습니다.`
          : `현재 매출은 ${formatRevenue(metrics?.revenue?.current)}이며 아직 목표액이 설정되지 않았습니다.`
    },
    {
      key: 'project-goal',
      tone: 'project',
      title: '완료 프로젝트 달성률',
      kind: 'ring',
      value: `${projectGoalRate}%`,
      description:
        target?.targetProjects > 0
          ? `완료 프로젝트 ${formatNumber(metrics?.completedProjects?.current)}개로 목표 ${formatNumber(target?.targetProjects)}개 대비 ${projectGoalRate}% 달성했습니다.`
          : `현재 완료 프로젝트는 ${formatNumber(metrics?.completedProjects?.current)}개이며 아직 목표가 설정되지 않았습니다.`
    },
    {
      key: 'leader',
      tone: 'recommendation',
      title: '이번 기간 선두',
      kind: 'icon',
      icon: 'military_tech',
      description: strongestLeaderboard
        ? (hideKpiScoreMethod || strongestLeaderboard.score == null
          ? `${strongestLeaderboard.name}님이 이번 기간 선두입니다. ${strongestLeaderboard.departmentDisplay || strongestLeaderboard.department || '미지정'} 부서 소속입니다.`
          : `${strongestLeaderboard.name}님이 현재 ${Number(strongestLeaderboard.score).toFixed(1)}점으로 선두입니다. ${strongestLeaderboard.departmentDisplay || strongestLeaderboard.department || '미지정'} 부서에서 가장 높은 성과를 보이고 있습니다.`)
        : '아직 집계된 리더보드 데이터가 없습니다.'
    },
    {
      key: 'work-logs',
      tone: 'activity',
      title: '업무 기록 흐름',
      kind: 'icon',
      icon: 'edit_note',
      description: `현재 업무 기록은 ${formatNumber(metrics?.workLogs?.current)}건이며 이전 기간 ${formatNumber(metrics?.workLogs?.previous)}건 대비 ${workInsightDelta.text} 변화했습니다.`
    }
  ]), [goalRate, projectGoalRate, strongestLeaderboard, metrics, target, workInsightDelta, hideKpiScoreMethod]);
  const scopeTitle = kpiAccess?.mode === 'self'
    ? '개인 KPI 대시보드'
    : scopeType === 'team'
      ? '팀별 KPI 대시보드'
      : '개인별 KPI 대시보드';
  const scopeDescription = kpiAccess?.mode === 'self'
    ? `${displayName}님 본인의 실적·목표만 조회됩니다. 타 직원·타 부서 범위는 표시되지 않습니다.`
    : scopeType === 'team'
      ? `${displayName}님, 사내 현황의 부서 기준으로 팀 KPI를 비교할 수 있습니다.`
      : `${displayName}님, 사내 현황의 직원 기준으로 개인 KPI를 비교할 수 있습니다.`;

  const handleSaveTarget = async (e) => {
    e.preventDefault();
    if (!dashboard?.period?.current) return;
    setSavingTarget(true);
    setSaveMessage('');
    try {
      const res = await fetch(`${API_BASE}/kpi/targets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeader()
        },
        credentials: 'include',
        body: JSON.stringify({
          year: dashboard.period.current.year,
          periodType: dashboard.period.current.periodType,
          periodValue: dashboard.period.current.periodValue,
          targetRevenue: Number(targetRevenueInput) || 0,
          targetProjects: Number(targetProjectsInput) || 0,
          note: targetNote
        })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || '목표 저장에 실패했습니다.');
      setDashboard((prev) => prev ? { ...prev, target: json.target } : prev);
      setSaveMessage(json?.message || '목표가 저장되었습니다.');
    } catch (err) {
      setSaveMessage(err.message || '목표 저장에 실패했습니다.');
    } finally {
      setSavingTarget(false);
    }
  };

  useEffect(() => {
    if (!dashboard?.period?.current) return;
    setTargetModalYear(dashboard.period.current.year);
    setTargetModalScopeType('user');
    setTargetModalDepartmentId(currentDepartmentId);
    setTargetModalUserId(currentUserId);
  }, [dashboard?.period?.current, period, scopeType, currentDepartmentId, currentUserId]);

  useEffect(() => {
    if (!isTargetModalOpen) return;
    if (targetModalScopeType === 'user') {
      const uid = String(currentUserId || '').trim();
      if (uid && String(targetModalUserId || '').trim() !== uid) setTargetModalUserId(uid);
      return;
    }
    const deptIds = targetModalDepartmentOptions.map((item) => String(item.id || '').trim()).filter(Boolean);
    const current = String(targetModalDepartmentId || '').trim();
    if (deptIds.length === 0) {
      if (current) setTargetModalDepartmentId('');
      return;
    }
    if (!deptIds.includes(current)) {
      setTargetModalDepartmentId(deptIds[0]);
    }
  }, [
    isTargetModalOpen,
    targetModalScopeType,
    currentUserId,
    targetModalUserId,
    targetModalDepartmentId,
    targetModalDepartmentOptions
  ]);

  useEffect(() => {
    if (!isTargetModalOpen) return;
    if (!targetModalUserId) {
      setTargetModalMonthlyRevenue(Array(12).fill(''));
      setTargetModalMonthlyProjects(Array(12).fill(''));
      setTargetModalMonthlyProjectTitles(Array.from({ length: 12 }, () => []));
      setTargetModalMonthlyProjectEntries(Array.from({ length: 12 }, () => []));
      setTargetModalMonthlyProjectTitleDrafts(Array(12).fill(''));
      setTargetModalMonthlyProjectParticipantDrafts(Array.from({ length: 12 }, () => []));
      setTargetModalLoadedUserMonthlyRevenue(Array(12).fill(0));
      setTargetModalLoadedUserMonthlyProjects(Array(12).fill(0));
      setTargetModalMessage('직원을 먼저 선택해 주세요.');
      return;
    }
    let cancelled = false;
    const fetchTargetMonthly = async () => {
      setTargetModalLoading(true);
      try {
        const rows = await Promise.all(
          KPI_MONTHS.map(async (month) => {
            const params = new URLSearchParams({
              year: String(targetModalYear),
              periodType: 'monthly',
              periodValue: String(month),
              scopeType: 'user',
              scopeId: targetModalUserId
            });
            const res = await fetch(`${API_BASE}/kpi/targets?${params.toString()}`, {
              headers: getAuthHeader(),
              credentials: 'include'
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(json?.error || '월별 개인 목표 정보를 불러오지 못했습니다.');
            return json?.target || null;
          })
        );
        if (cancelled) return;
        const loadedRevenueNums = rows.map((row) => Number(row?.targetRevenue) || 0);
        const loadedProjectNums = rows.map((row) => Number(row?.targetProjects) || 0);
        const loadedProjectEntries = rows.map((row) => parseMonthlyProjectEntriesFromNote(row?.note));
        const loadedProjectTitles = loadedProjectEntries.map((entries) => entries.map((item) => item.title));
        setTargetModalLoadedUserMonthlyRevenue(loadedRevenueNums);
        setTargetModalLoadedUserMonthlyProjects(loadedProjectNums);
        setTargetModalMonthlyProjectEntries(loadedProjectEntries);
        setTargetModalMonthlyProjectTitles(loadedProjectTitles);
        setTargetModalMonthlyProjectTitleDrafts(Array(12).fill(''));
        setTargetModalMonthlyProjectParticipantDrafts(Array.from({ length: 12 }, () => []));
        setTargetModalMonthlyRevenue(
          loadedRevenueNums.map((n) => {
            return n > 0 ? String(n) : '';
          })
        );
        setTargetModalMonthlyProjects(
          loadedProjectTitles.map((titles, idx) => {
            const fromTitles = Array.isArray(titles) ? titles.length : 0;
            const n = fromTitles > 0 ? fromTitles : loadedProjectNums[idx] || 0;
            return n > 0 ? String(n) : '';
          })
        );
        setTargetModalMessage('');
      } catch (err) {
        if (!cancelled) {
          setTargetModalMonthlyRevenue(Array(12).fill(''));
          setTargetModalMonthlyProjects(Array(12).fill(''));
          setTargetModalMonthlyProjectEntries(Array.from({ length: 12 }, () => []));
          setTargetModalMonthlyProjectTitles(Array.from({ length: 12 }, () => []));
          setTargetModalMonthlyProjectTitleDrafts(Array(12).fill(''));
          setTargetModalMonthlyProjectParticipantDrafts(Array.from({ length: 12 }, () => []));
          setTargetModalLoadedUserMonthlyRevenue(Array(12).fill(0));
          setTargetModalLoadedUserMonthlyProjects(Array(12).fill(0));
          setTargetModalMessage(err.message || '목표 정보를 불러오지 못했습니다.');
        }
      } finally {
        if (!cancelled) setTargetModalLoading(false);
      }
    };
    fetchTargetMonthly();
    return () => { cancelled = true; };
  }, [isTargetModalOpen, targetModalUserId, targetModalYear, saveMessage]);

  useEffect(() => {
    if (!isTargetModalOpen) return;
    if (!effectiveTeamDeptIdForTargetModal || teamUserIdsForTargetModal.length === 0) {
      setTargetModalTeamMonthlyRevenue(Array(12).fill(0));
      setTargetModalTeamMonthlyProjects(Array(12).fill(0));
      return;
    }
    let cancelled = false;
    const fetchTeamTotals = async () => {
      try {
        const baseRevenue = Array(12).fill(0);
        const baseProjects = Array(12).fill(0);
        await Promise.all(
          teamUserIdsForTargetModal.map(async (uid) => {
            const monthlyRows = await Promise.all(
              KPI_MONTHS.map(async (month) => {
                const params = new URLSearchParams({
                  year: String(targetModalYear),
                  periodType: 'monthly',
                  periodValue: String(month),
                  scopeType: 'user',
                  scopeId: uid
                });
                const res = await fetch(`${API_BASE}/kpi/targets?${params.toString()}`, {
                  headers: getAuthHeader(),
                  credentials: 'include'
                });
                const json = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(json?.error || '팀 누적 목표를 불러오지 못했습니다.');
                return json?.target || null;
              })
            );
            for (let i = 0; i < 12; i += 1) {
              baseRevenue[i] += Number(monthlyRows[i]?.targetRevenue || 0);
              baseProjects[i] += Number(monthlyRows[i]?.targetProjects || 0);
            }
          })
        );
        if (cancelled) return;
        setTargetModalTeamMonthlyRevenue(baseRevenue);
        setTargetModalTeamMonthlyProjects(baseProjects);
      } catch (err) {
        if (!cancelled) {
          setTargetModalTeamMonthlyRevenue(Array(12).fill(0));
          setTargetModalTeamMonthlyProjects(Array(12).fill(0));
          setTargetModalMessage(err.message || '팀 누적 목표를 불러오지 못했습니다.');
        }
      }
    };
    fetchTeamTotals();
    return () => { cancelled = true; };
  }, [isTargetModalOpen, effectiveTeamDeptIdForTargetModal, teamUserIdsForTargetModal, targetModalYear, saveMessage]);

  useEffect(() => {
    const overviewParams = (() => {
      if (scopeType === 'team') {
        if (!selectedScopeDepartment) return null;
        return { scopeType: 'team', scopeId: selectedScopeDepartment };
      }
      if (scopeType === 'user') {
        if (!selectedScopeUser) return null;
        if (selectedScopeUser === KPI_ALL_STAFF_VALUE) {
          return { scopeType: 'company', scopeId: '' };
        }
        return { scopeType: 'user', scopeId: selectedScopeUser };
      }
      return null;
    })();
    if (!overviewParams) {
      setTargetOverview(null);
      return;
    }
    let cancelled = false;
    const fetchOverview = async () => {
      try {
        const params = new URLSearchParams({
          year: String(dashboard?.period?.current?.year || new Date().getFullYear()),
          scopeType: overviewParams.scopeType,
          ...(overviewParams.scopeId ? { scopeId: overviewParams.scopeId } : {})
        });
        const res = await fetch(`${API_BASE}/kpi/targets/overview?${params.toString()}`, {
          headers: getAuthHeader(),
          credentials: 'include'
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || '목표 현황을 불러오지 못했습니다.');
        if (!cancelled) setTargetOverview(json);
      } catch (_) {
        if (!cancelled) setTargetOverview(null);
      }
    };
    fetchOverview();
    return () => { cancelled = true; };
  }, [scopeType, selectedScopeDepartment, selectedScopeUser, dashboard?.period?.current?.year, saveMessage]);

  useEffect(() => {
    if (!checklistPeriod) {
      setChecklistSummaryByMetric({});
      return;
    }
    let cancelled = false;
    const fetchChecklistSummary = async () => {
      try {
        const params = new URLSearchParams({
          year: String(checklistPeriod.year),
          periodType: checklistPeriod.periodType,
          periodValue: String(checklistPeriod.periodValue),
          scopeType: checklistScope.scopeType
        });
        if (checklistScope.scopeId) params.set('scopeId', checklistScope.scopeId);
        params.set('kpiFilterScopeType', scopeType);
        if (scopeType === 'team' && selectedScopeDepartment) params.set('kpiDepartmentId', selectedScopeDepartment);
        if (scopeType === 'user' && selectedScopeUser) params.set('kpiUserId', selectedScopeUser);
        const res = await fetch(`${API_BASE}/kpi/checklists/summary?${params.toString()}`, {
          headers: getAuthHeader(),
          credentials: 'include'
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || '체크리스트 요약을 불러오지 못했습니다.');
        if (!cancelled) setChecklistSummaryByMetric(json?.byMetric || {});
      } catch (_) {
        if (!cancelled) setChecklistSummaryByMetric({});
      }
    };
    fetchChecklistSummary();
    return () => { cancelled = true; };
  }, [
    checklistPeriod?.year,
    checklistPeriod?.periodType,
    checklistPeriod?.periodValue,
    checklistScope.scopeType,
    checklistScope.scopeId,
    scopeType,
    selectedScopeDepartment,
    selectedScopeUser
  ]);

  useEffect(() => {
    if (!isListModalOpen) return;
    if (selectedListMetric === 'all' && detailModalRows.length === 0) {
      setDetailChecklistItems([]);
      setDetailChecklistMessage('');
      return;
    }
    if (!checklistPeriod) {
      setDetailChecklistItems(mergeChecklistItems(detailModalRows, []));
      setDetailChecklistMessage('');
      return;
    }
    let cancelled = false;
    const fetchChecklist = async () => {
      setDetailChecklistLoading(true);
      setDetailChecklistMessage('');
      try {
        let baseItems = detailModalRows;
        if (selectedListMetric !== 'all') {
          const detailParams = new URLSearchParams({
            year: String(checklistPeriod.year),
            periodType: checklistPeriod.periodType,
            periodValue: String(checklistPeriod.periodValue),
            scopeType: checklistScope.scopeType,
            metricKey: selectedListMetric
          });
          if (checklistScope.scopeId) detailParams.set('scopeId', checklistScope.scopeId);
          detailParams.set('kpiFilterScopeType', scopeType);
          if (scopeType === 'team' && selectedScopeDepartment) detailParams.set('kpiDepartmentId', selectedScopeDepartment);
          if (scopeType === 'user' && selectedScopeUser) detailParams.set('kpiUserId', selectedScopeUser);
          const detailRes = await fetch(`${API_BASE}/kpi/detail-items?${detailParams.toString()}`, {
            headers: getAuthHeader(),
            credentials: 'include'
          });
          const detailJson = await detailRes.json().catch(() => ({}));
          if (!detailRes.ok) throw new Error(detailJson?.error || '상세 리스트를 불러오지 못했습니다.');
          baseItems = normalizeDetailItems(detailJson?.items || []);
        }

        const params = new URLSearchParams({
          year: String(checklistPeriod.year),
          periodType: checklistPeriod.periodType,
          periodValue: String(checklistPeriod.periodValue),
          scopeType: checklistScope.scopeType,
          metricKey: selectedListMetric
        });
        if (checklistScope.scopeId) params.set('scopeId', checklistScope.scopeId);
        const res = await fetch(`${API_BASE}/kpi/checklists?${params.toString()}`, {
          headers: getAuthHeader(),
          credentials: 'include'
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || '체크리스트를 불러오지 못했습니다.');
        if (cancelled) return;
        setDetailChecklistItems(mergeChecklistItems(baseItems, json?.checklist?.items || []));
      } catch (err) {
        if (!cancelled) {
          setDetailChecklistItems(mergeChecklistItems(selectedListMetric === 'all' ? detailModalRows : [], []));
          setDetailChecklistMessage(err.message || '체크리스트를 불러오지 못했습니다.');
        }
      } finally {
        if (!cancelled) setDetailChecklistLoading(false);
      }
    };
    fetchChecklist();
    return () => { cancelled = true; };
  }, [
    isListModalOpen,
    selectedListMetric,
    detailModalRows,
    checklistPeriod?.year,
    checklistPeriod?.periodType,
    checklistPeriod?.periodValue,
    checklistScope.scopeType,
    checklistScope.scopeId,
    otherPerfRefresh,
    scopeType,
    selectedScopeDepartment,
    selectedScopeUser
  ]);

  const ensureSelfInParticipants = useCallback((list) => {
    const uid = String(currentUserId || '').trim();
    if (!uid) return Array.isArray(list) ? list : [];
    const name = String(storedUser?.name || displayName || '나').trim() || '나';
    const arr = Array.isArray(list)
      ? list.map((p) => ({ userId: String(p.userId), name: String(p.name || '').trim() || '사용자' }))
      : [];
    if (!arr.some((p) => String(p.userId) === uid)) {
      arr.unshift({ userId: uid, name });
    }
    return arr;
  }, [currentUserId, storedUser, displayName]);

  const participantModalCurrentUser = useMemo(
    () => ({ userId: currentUserId, name: displayName }),
    [currentUserId, displayName]
  );

  useEffect(() => {
    if (!isListModalOpen || selectedListMetric !== 'otherPerformance') return;
    setOtherPerfForm({
      title: '',
      amount: '',
      startDate: '',
      endDate: '',
      participants: ensureSelfInParticipants([])
    });
  }, [isListModalOpen, selectedListMetric, ensureSelfInParticipants]);

  const handleOtherParticipantConfirm = useCallback((sel) => {
    setOtherPerfForm((prev) => ({ ...prev, participants: ensureSelfInParticipants(sel) }));
    setParticipantPickerOpen(false);
  }, [ensureSelfInParticipants]);

  const openListModal = (metricKey = 'all') => {
    const next = new URLSearchParams(searchParams);
    next.set(KPI_LIST_MODAL_PARAM, '1');
    if (metricKey && metricKey !== 'all') next.set(KPI_LIST_METRIC_PARAM, metricKey);
    else next.delete(KPI_LIST_METRIC_PARAM);
    setSearchParams(next);
  };

  const openTargetModal = () => {
    const next = new URLSearchParams(searchParams);
    next.set(KPI_TARGET_MODAL_PARAM, '1');
    setSearchParams(next);
  };

  const closeListModal = () => {
    const next = new URLSearchParams(searchParams);
    next.delete(KPI_LIST_MODAL_PARAM);
    next.delete(KPI_LIST_METRIC_PARAM);
    setSearchParams(next, { replace: true });
  };

  const closeTargetModal = () => {
    const next = new URLSearchParams(searchParams);
    next.delete(KPI_TARGET_MODAL_PARAM);
    setSearchParams(next, { replace: true });
  };

  const handleSubmitOtherPerformance = async () => {
    if (!checklistPeriod) return;
    const title = String(otherPerfForm.title || '').trim();
    if (!title) {
      setDetailChecklistMessage('내용을 입력해 주세요.');
      return;
    }
    setOtherPerfSubmitting(true);
    setDetailChecklistMessage('');
    try {
      const res = await fetch(`${API_BASE}/kpi/other-performance/entries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        credentials: 'include',
        body: JSON.stringify({
          title,
          amount: Number(otherPerfForm.amount) || 0,
          note: '',
          startAt: otherPerfForm.startDate || null,
          endAt: otherPerfForm.endDate || null,
          participants: otherPerfForm.participants,
          year: checklistPeriod.year,
          periodType: checklistPeriod.periodType,
          periodValue: checklistPeriod.periodValue,
          scopeType: checklistScope.scopeType,
          scopeId: checklistScope.scopeId
        })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || '등록에 실패했습니다.');
      setDetailChecklistMessage(json?.message || '등록되었습니다.');
      setOtherPerfRefresh((t) => t + 1);
      setOtherPerfForm((prev) => ({
        title: '',
        amount: '',
        startDate: '',
        endDate: '',
        participants: ensureSelfInParticipants(prev.participants)
      }));
    } catch (err) {
      setDetailChecklistMessage(err.message || '등록에 실패했습니다.');
    } finally {
      setOtherPerfSubmitting(false);
    }
  };

  const handleDeleteOtherEntry = async (entryKey) => {
    const raw = String(entryKey || '').replace(/^other:/, '');
    if (!raw || !checklistPeriod) return;
    setDetailChecklistMessage('');
    try {
      const params = new URLSearchParams({
        year: String(checklistPeriod.year),
        periodType: checklistPeriod.periodType,
        periodValue: String(checklistPeriod.periodValue),
        scopeType: checklistScope.scopeType
      });
      if (checklistScope.scopeId) params.set('scopeId', checklistScope.scopeId);
      const res = await fetch(`${API_BASE}/kpi/other-performance/entries/${encodeURIComponent(raw)}?${params}`, {
        method: 'DELETE',
        headers: getAuthHeader(),
        credentials: 'include'
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || '삭제에 실패했습니다.');
      setDetailChecklistMessage(json?.message || '삭제되었습니다.');
      setOtherPerfRefresh((t) => t + 1);
    } catch (err) {
      setDetailChecklistMessage(err.message || '삭제에 실패했습니다.');
    }
  };

  const handleChecklistItemPatch = useCallback((itemKey, patch) => {
    setDetailChecklistItems((prev) => prev.map((item) => (item.key === itemKey ? { ...item, ...patch } : item)));
  }, []);

  const handleTargetMonthlyRevenueChange = useCallback((month, next) => {
    const idx = Number(month) - 1;
    if (idx < 0 || idx > 11) return;
    setTargetModalMonthlyRevenue((prev) => {
      const out = [...prev];
      out[idx] = String(next ?? '');
      return out;
    });
  }, []);

  const handleTargetMonthlyProjectsChange = useCallback((month, next) => {
    const idx = Number(month) - 1;
    if (idx < 0 || idx > 11) return;
    setTargetModalMonthlyProjects((prev) => {
      const out = [...prev];
      out[idx] = String(next ?? '');
      return out;
    });
  }, []);

  const handleTargetProjectTitleDraftChange = useCallback((month, next) => {
    const idx = Number(month) - 1;
    if (idx < 0 || idx > 11) return;
    setTargetModalMonthlyProjectTitleDrafts((prev) => {
      const out = [...prev];
      out[idx] = String(next || '');
      return out;
    });
  }, []);

  const handleTargetProjectParticipantDraftChange = useCallback((month, nextIds) => {
    const idx = Number(month) - 1;
    if (idx < 0 || idx > 11) return;
    setTargetModalMonthlyProjectParticipantDrafts((prev) => {
      const out = prev.map((arr) => (Array.isArray(arr) ? [...arr] : []));
      out[idx] = Array.isArray(nextIds)
        ? nextIds.map((v) => String(v || '').trim()).filter(Boolean)
        : [];
      return out;
    });
  }, []);

  const handleAddTargetProjectTitle = useCallback((month) => {
    const idx = Number(month) - 1;
    if (idx < 0 || idx > 11) return;
    const raw = String(targetModalMonthlyProjectTitleDrafts[idx] || '').trim();
    if (!raw) return;
    const participantIds = canSelectTeamProjectParticipants
      ? (Array.isArray(targetModalMonthlyProjectParticipantDrafts[idx]) ? targetModalMonthlyProjectParticipantDrafts[idx] : [])
      : [];
    setTargetModalMonthlyProjectEntries((prev) => {
      const out = prev.map((arr) => (Array.isArray(arr) ? [...arr] : []));
      out[idx] = [...out[idx], { title: raw, participantIds }].slice(0, 50);
      setTargetModalMonthlyProjectTitles((prevTitles) => {
        const nextTitles = prevTitles.map((arr) => (Array.isArray(arr) ? [...arr] : []));
        nextTitles[idx] = out[idx].map((item) => String(item?.title || '').trim()).filter(Boolean);
        return nextTitles;
      });
      setTargetModalMonthlyProjects((prevCounts) => {
        const nextCounts = [...prevCounts];
        nextCounts[idx] = String(out[idx].length || 0);
        return nextCounts;
      });
      return out;
    });
    setTargetModalMonthlyProjectTitleDrafts((prev) => {
      const out = [...prev];
      out[idx] = '';
      return out;
    });
    setTargetModalMonthlyProjectParticipantDrafts((prev) => {
      const out = prev.map((arr) => (Array.isArray(arr) ? [...arr] : []));
      out[idx] = [];
      return out;
    });
  }, [targetModalMonthlyProjectTitleDrafts, targetModalMonthlyProjectParticipantDrafts, canSelectTeamProjectParticipants]);

  const handleChecklistScoreChange = (itemKey, value) => {
    const v = Math.max(0, Number(value) || 0);
    setDetailChecklistItems((prev) => prev.map((item) => {
      if (item.key !== itemKey) return item;
      if (isProjectKpiRow(item) && (Array.isArray(item.projectParticipants) ? item.projectParticipants.length : 0) >= 1) {
        return item;
      }
      return { ...item, score: v };
    }));
  };

  const handleSaveChecklist = async () => {
    if (!checklistPeriod) return;
    setDetailChecklistSaving(true);
    setDetailChecklistMessage('');
    try {
      const res = await fetch(`${API_BASE}/kpi/checklists`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeader()
        },
        credentials: 'include',
        body: JSON.stringify({
          metricKey: selectedListMetric,
          scopeType: checklistScope.scopeType,
          scopeId: checklistScope.scopeId,
          year: checklistPeriod.year,
          periodType: checklistPeriod.periodType,
          periodValue: checklistPeriod.periodValue,
          items: detailChecklistItems.map((item) => buildChecklistPayloadItem(item))
        })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || '체크리스트 저장에 실패했습니다.');
      const savedItems = json?.checklist?.items || [];
      setDetailChecklistItems((prev) => mergeChecklistItems(prev, savedItems));
      setDetailChecklistMessage(json?.message || '체크리스트가 저장되었습니다.');
      if (selectedListMetric !== 'all') {
        setChecklistSummaryByMetric((prev) => ({
          ...prev,
          [selectedListMetric]: json?.checklist?.summary || prev?.[selectedListMetric]
        }));
      }
    } catch (err) {
      setDetailChecklistMessage(err.message || '체크리스트 저장에 실패했습니다.');
    } finally {
      setDetailChecklistSaving(false);
    }
  };

  const handleSaveTargetModal = async (e) => {
    e.preventDefault();
    if (targetModalScopeType !== 'user') {
      setTargetModalMessage('팀별은 개인별 월간 목표의 누적값으로 자동 계산됩니다. 개인별 탭에서 저장해 주세요.');
      return;
    }
    if (!canSubmitTargetModal) {
      setTargetModalMessage('개인별에서는 본인 목표만 수정할 수 있습니다.');
      return;
    }
    const scopeId = String(targetModalUserId || '').trim();
    if (!scopeId) {
      setTargetModalMessage('직원을 선택해 주세요.');
      return;
    }
    const monthlyRevenueNums = KPI_MONTHS.map((month) => Number(String(targetModalMonthlyRevenue[month - 1] || '').replace(/\D/g, '')) || 0);
    const monthlyProjectNums = KPI_MONTHS.map((month) => {
      const entries = Array.isArray(targetModalMonthlyProjectEntries[month - 1]) ? targetModalMonthlyProjectEntries[month - 1] : [];
      const fromEntries = entries.map((item) => String(item?.title || '').trim()).filter(Boolean).length;
      if (fromEntries > 0) return fromEntries;
      return Number(String(targetModalMonthlyProjects[month - 1] || '').replace(/\D/g, '')) || 0;
    });
    setTargetModalSaving(true);
    setTargetModalMessage('');
    try {
      const year = Number(targetModalYear) || new Date().getFullYear();
      const savePeriod = async (periodType, periodValue, revenue, projects) => {
        const monthlyNote =
          periodType === 'monthly'
            ? buildMonthlyProjectNote(targetModalMonthlyProjectEntries[Number(periodValue) - 1] || [])
            : '월별 목표 자동 합산';
        const res = await fetch(`${API_BASE}/kpi/targets`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
          credentials: 'include',
          body: JSON.stringify({
            scopeType: 'user',
            scopeId,
            year,
            periodType,
            periodValue,
            targetRevenue: Math.max(0, Math.round(Number(revenue) || 0)),
            targetProjects: Math.max(0, Math.round(Number(projects) || 0)),
            note: monthlyNote
          })
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || '목표 저장에 실패했습니다.');
        return json;
      };
      await Promise.all(
        KPI_MONTHS.map((month) => savePeriod('monthly', month, monthlyRevenueNums[month - 1], monthlyProjectNums[month - 1]))
      );
      await Promise.all(
        [1, 2, 3, 4].map((q) => {
          const rev = aggregateTargetByPeriod(monthlyRevenueNums, 'quarterly', q);
          const prj = aggregateTargetByPeriod(monthlyProjectNums, 'quarterly', q);
          return savePeriod('quarterly', q, rev, prj);
        })
      );
      await Promise.all(
        [1, 2].map((h) => {
          const rev = aggregateTargetByPeriod(monthlyRevenueNums, 'semiannual', h);
          const prj = aggregateTargetByPeriod(monthlyProjectNums, 'semiannual', h);
          return savePeriod('semiannual', h, rev, prj);
        })
      );
      await savePeriod(
        'annual',
        1,
        aggregateTargetByPeriod(monthlyRevenueNums, 'annual', 1),
        aggregateTargetByPeriod(monthlyProjectNums, 'annual', 1)
      );

      setTargetModalMessage('개인별 월간 목표를 저장했고 분기·반기·연간 목표를 자동 합산했습니다.');
      setSaveMessage('개인별 월간 목표를 저장했고 분기·반기·연간 목표를 자동 합산했습니다.');
      if (
        scopeType === 'user' &&
        selectedScopeUser === targetModalUserId &&
        dashboard?.period?.current
      ) {
        const currentPeriod = dashboard.period.current;
        const nextRevenue = aggregateTargetByPeriod(monthlyRevenueNums, currentPeriod.periodType, currentPeriod.periodValue);
        const nextProjects = aggregateTargetByPeriod(monthlyProjectNums, currentPeriod.periodType, currentPeriod.periodValue);
        setDashboard((prev) => (prev ? {
          ...prev,
          target: {
            ...(prev.target || {}),
            targetRevenue: nextRevenue,
            targetProjects: nextProjects
          }
        } : prev));
      }
    } catch (err) {
      setTargetModalMessage(err.message || '목표 저장에 실패했습니다.');
    } finally {
      setTargetModalSaving(false);
    }
  };

  return (
    <div className="page kpi-page">
      <header className="page-header kpi-page-header">
        <div className="kpi-page-header-spacer" />
        <div className="kpi-page-header-actions">
          <PageHeaderNotifyChat noWrapper buttonClassName="icon-btn" />
        </div>
      </header>

      <div className="page-content kpi-page-content">
        <section className="kpi-hero">
          <div className="kpi-hero-copy">
            <nav className="kpi-breadcrumb" aria-label="현재 위치">
              <span>성과 관리</span>
              <span className="material-symbols-outlined" aria-hidden>chevron_right</span>
              <span className="kpi-breadcrumb-current">KPI 분석</span>
            </nav>
            <h1>{scopeTitle}</h1>
            <p>{scopeDescription} {currentPeriodLabel} 기준 KPI 흐름과 목표 달성 현황을 한눈에 확인할 수 있습니다.</p>
          </div>

          <div className="kpi-hero-actions">
            <div className="kpi-scope-period-row">
              <div className="kpi-scope-switch" role="tablist" aria-label="조회 범위">
                {kpiScopeTabOptions.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={scopeType === item.key ? 'is-active' : ''}
                    onClick={() => handleScopeTypeChange(item.key)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <div className="kpi-period-switch" role="tablist" aria-label="조회 기간">
                {PERIODS.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={period === item.key ? 'is-active' : ''}
                    onClick={() => setPeriod(item.key)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="kpi-scope-select-row">
              {scopeType === 'team' ? (
                <select
                  className="kpi-scope-select"
                  value={selectedScopeDepartment}
                  onChange={(e) => setSelectedScopeDepartment(e.target.value)}
                  aria-label="부서 검색"
                >
                  <option value="">전체 부서</option>
                  {filteredScopeDepartmentOptions.map((item) => (
                    <option key={item.id} value={item.id}>{item.label}</option>
                  ))}
                </select>
              ) : (
                <div className="kpi-scope-select-wrap">
                  {selectedScopeUser && selectedScopeUser !== KPI_ALL_STAFF_VALUE && selectedScopeUserOption?.avatar ? (
                    <img src={selectedScopeUserOption.avatar} alt="" className="kpi-scope-select-avatar kpi-scope-select-avatar-img" />
                  ) : (
                    <div className="kpi-scope-select-avatar kpi-scope-select-avatar-fallback" aria-hidden>
                      <span className="material-symbols-outlined">
                        {selectedScopeUser === KPI_ALL_STAFF_VALUE ? 'groups' : 'person'}
                      </span>
                    </div>
                  )}
                  <select
                    className="kpi-scope-select kpi-scope-select-with-avatar"
                    value={selectedScopeUser}
                    onChange={(e) => setSelectedScopeUser(e.target.value)}
                    aria-label="직원·전체 직원 선택"
                    disabled={filteredScopeUserOptions.length === 0}
                  >
                    {kpiAccess?.mode === 'self' ? null : (
                      <option value={KPI_ALL_STAFF_VALUE}>전체 직원</option>
                    )}
                    {filteredScopeUserOptions.map((item) => (
                      <option key={item.id} value={item.id}>{item.label}</option>
                    ))}
                   
                  </select>
                </div>
              )}
              <button type="button" className="kpi-target-open-button" onClick={openTargetModal}>
                목표 설정
              </button>
            </div>
          </div>
        </section>

        {error ? (
          <div className="kpi-status-banner kpi-status-banner-error" role="alert">{error}</div>
        ) : null}
        {saveMessage ? (
          <div className="kpi-status-banner kpi-status-banner-info" role="status">{saveMessage}</div>
        ) : null}

        {!loading && contributionBar?.segments?.length ? (
          <section className="kpi-contribution-panel" aria-labelledby="kpi-contribution-title">
            <div className="kpi-contribution-head">
              <h3 id="kpi-contribution-title">{contributionBar.title}</h3>
              <p>{contributionBar.sublabel}</p>
            </div>
            <div className="kpi-contribution-bar" role="list">
              {contributionBar.segments.map((seg) => (
                <div
                  key={seg.id}
                  role="listitem"
                  className="kpi-contribution-segment"
                  style={{
                    flex: `0 0 ${Math.max(0, Number(seg.pct) || 0)}%`,
                    backgroundColor: seg.color || '#b8c5e0'
                  }}
                  title={`${seg.label} · 매출 ${formatRevenueCompact(seg.amount)} · 비중 ${seg.pct}% · 달성률 ${
                    seg.achievement == null ? '회사 목표 매출 미설정' : `${seg.achievement}%`
                  }`}
                >
                  <div className="kpi-contribution-segment-body">
                    <strong className="kpi-contribution-segment-name">{seg.label}</strong>
                    <span className="kpi-contribution-segment-metric">매출 {formatRevenueCompact(seg.amount)}</span>
                    <span className="kpi-contribution-segment-ach">
                      달성률 {seg.achievement == null ? '목표 미설정' : `${seg.achievement}%`}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="home-kpi-strip kpi-page-kpi-summary" aria-label="핵심 KPI">
          {(loading ? [] : cards).map((card) => {
            const checklistKey = card.detailKey || card.key;
            const clSummary = checklistSummaryByMetric?.[checklistKey];
            const showCl = hasChecklistSummary(clSummary);
            const totalScore = showCl ? Math.max(0, Number(clSummary.totalScore) || 0) : 0;
            const totalItems = showCl ? Math.max(0, Number(clSummary.totalCount) || 0) : 0;
            const checkedN = showCl ? Math.max(0, Number(clSummary.checkedCount) || 0) : 0;
            const checkedPts = showCl ? Math.max(0, Number(clSummary.checkedScore) || 0) : 0;
            const deltaUp = !card.deltaNeutral && card.positive;
            const deltaDown = !card.deltaNeutral && !card.positive;
            return (
              <button
                key={card.key}
                type="button"
                className="home-kpi-card kpi-summary-card-button"
                onClick={() => openListModal(checklistKey)}
              >
                <div className="home-kpi-card-head">
                  <span className="home-kpi-card-title">{card.label}</span>
                  <span className="material-symbols-outlined home-kpi-card-icon" aria-hidden>
                    {card.icon}
                  </span>
                </div>
                <p className="home-kpi-card-value">{card.value}</p>
                {card.valueMeta ? <p className="home-kpi-card-value-meta">{card.valueMeta}</p> : null}
                <p className="home-kpi-card-hint">{card.hint}</p>
                <div className="home-kpi-card-metrics">
                  <div className="home-kpi-metric-line">
                    <span className="home-kpi-dot home-kpi-dot--period" aria-hidden />
                    <span className="home-kpi-metric-label">전기 대비</span>
                    <span
                      className={`home-kpi-metric-trend ${deltaUp ? 'is-up' : ''} ${deltaDown ? 'is-down' : ''}`}
                    >
                      {deltaUp ? (
                        <span className="material-symbols-outlined" aria-hidden>
                          trending_up
                        </span>
                      ) : null}
                      {deltaDown ? (
                        <span className="material-symbols-outlined" aria-hidden>
                          trending_down
                        </span>
                      ) : null}{' '}
                      {card.delta}
                    </span>
                  </div>
                </div>
                {showCl ? (
                  <div className="kpi-summary-footer">
                    <div className="kpi-summary-checklist-total" aria-label={`${card.label} 체크리스트 총점`}>
                      <span className="kpi-summary-checklist-total-label">체크리스트 총점</span>
                      <span className="kpi-summary-checklist-total-num">{formatNumber(totalScore)}</span>
                      <span className="kpi-summary-checklist-total-suffix">점</span>
                    </div>
                    <p className="kpi-summary-checklist-sub">
                      항목 {formatNumber(totalItems)}개
                      {checkedN > 0 ? ` · 완료 ${formatNumber(checkedN)}건(${formatNumber(checkedPts)}점 반영)` : null}
                    </p>
                  </div>
                ) : null}
              </button>
            );
          })}
          {loading ? (
            Array.from({ length: 4 }).map((_, idx) => (
              <div key={`loading-${idx}`} className="home-kpi-card home-kpi-card--skeleton" aria-busy="true">
                <div className="home-kpi-skel-line home-kpi-skel-line--short" />
                <div className="home-kpi-skel-line home-kpi-skel-line--value" />
                <div className="home-kpi-skel-line" />
                <div className="home-kpi-skel-line" />
              </div>
            ))
          ) : null}
        </section>

        <section className="kpi-main-grid">
          <article className="kpi-panel kpi-comparison-panel">
            <div className="kpi-panel-head">
              <div>
                <h3>{currentPeriodLabel} 성과 비교</h3>
                <p>{buildPeriodDescription(period, currentPeriodLabel)}</p>
              </div>
              <div className="kpi-comparison-actions">
                <button type="button" className="kpi-link-button" onClick={() => openListModal('all')}>리스트 보기</button>
                <div className="kpi-legend" aria-hidden>
                  <span><i className="legend-dot legend-dot-current" />현재</span>
                  <span><i className="legend-dot legend-dot-previous" />이전</span>
                  <span><i className="legend-dot legend-dot-target" />목표</span>
                </div>
              </div>
            </div>

            <div className="kpi-bar-chart" aria-label="비교 막대 차트">
              {comparisonRows.map((row) => (
                <div key={row.label} className="kpi-bar-group">
                  <div className="kpi-bar-pair">
                    <div className="kpi-target-line" style={{ bottom: `${row.targetPct}%` }}>
                      <span>{row.targetDisplay}</span>
                    </div>
                    <div className="kpi-bar kpi-bar-previous" style={{ height: `${row.previousPct}%` }} />
                    <div className="kpi-bar kpi-bar-current" style={{ height: `${row.currentPct}%` }} />
                  </div>
                  <div className="kpi-bar-label-stack">
                    <strong>{row.label}</strong>
                    <p>현재 {row.currentDisplay} / 이전 {row.previousDisplay}</p>
                  </div>
                </div>
              ))}
            </div>
          </article>

          <aside className="kpi-panel kpi-manual-panel">
            <div className="kpi-panel-head">
              <div>
                <h3>{targetOverviewTitle}</h3>
                <p>선택한 범위의 월별·분기별·반기별·연간 목표를 확인합니다.</p>
              </div>
            </div>
            <div className="kpi-target-overview-body">
              {!targetOverviewScopeId ? (
                <p className="kpi-manual-note kpi-target-empty-note">
                  {scopeType === 'team' ? '팀 목표를 보려면 부서를 먼저 선택해 주세요.' : '개인 목표를 불러오는 중입니다.'}
                </p>
              ) : targetOverview?.items?.length ? (
                <div className="kpi-target-overview-list">
                  {targetOverview.items.map((item) => (
                    <article
                      key={`${item.scopeType}-${item.periodType}-${item.periodValue}`}
                      className={`kpi-target-overview-card tone-${item.periodType}`}
                    >
                      <div className="kpi-target-overview-top">
                        <strong>{PERIODS.find((periodItem) => periodItem.key === item.periodType)?.label || item.periodType}</strong>
                        <span>{item.label}</span>
                      </div>
                      <p className="kpi-target-overview-metric">목표액 {formatRevenue(item.targetRevenue)}</p>
                      <p className="kpi-target-overview-metric">목표 프로젝트 {formatNumber(item.targetProjects)}개</p>
                      <small className="kpi-target-overview-note">{item.note || '메모 없음'}</small>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="kpi-manual-note kpi-target-empty-note">아직 저장된 목표가 없습니다.</p>
              )}
            </div>
          </aside>
        </section>

        <section className="kpi-panel kpi-leaderboard-panel">
          <div className="kpi-panel-head kpi-leaderboard-head">
            <div>
              <h3>직원 리더보드</h3>
              <p>
                {hideKpiScoreMethod
                  ? `${currentPeriodLabel} 기준 개인 실적 요약입니다. 종합 점수 산정 방식은 표시되지 않습니다.`
                  : `${currentPeriodLabel} 기준 성과 점수 순위입니다. 부서별/직급별 보기로 전환할 수 있습니다.`}
              </p>
            </div>
            <div className="kpi-leaderboard-controls">
              <div className="kpi-view-switch" role="tablist" aria-label="리더보드 보기">
                <button type="button" className={viewBy === 'overall' ? 'is-active' : ''} onClick={() => setViewBy('overall')}>전체</button>
                <button type="button" className={viewBy === 'department' ? 'is-active' : ''} onClick={() => setViewBy('department')}>부서별</button>
                <button type="button" className={viewBy === 'rank' ? 'is-active' : ''} onClick={() => setViewBy('rank')}>직급별</button>
              </div>
              {viewBy === 'department' ? (
                <select value={selectedDepartment} onChange={(e) => setSelectedDepartment(e.target.value)} className="kpi-filter-select">
                  <option value="">전체 부서</option>
                  {availableDepartments.map((department) => (
                    <option key={department} value={department}>{department}</option>
                  ))}
                </select>
              ) : null}
              {viewBy === 'rank' ? (
                <select value={selectedRank} onChange={(e) => setSelectedRank(e.target.value)} className="kpi-filter-select">
                  <option value="">전체 직급</option>
                  {availableRanks.map((rank) => (
                    <option key={rank.value} value={rank.value}>{rank.label}</option>
                  ))}
                </select>
              ) : null}
            </div>
          </div>

          <div className="kpi-leaderboard-table-wrap">
            <table className="kpi-leaderboard-table">
              <thead>
                <tr>
                  <th>순위</th>
                  <th>직원명</th>
                  <th>부서</th>
                  <th>직급</th>
                  <th>종합 점수</th>
                  <th>성과 추이</th>
                </tr>
              </thead>
              <tbody>
                {leaderboardRows.map((row) => (
                  <tr key={`${period}-${row.rankNo}-${row.userId}`}>
                    <td>
                      <div className={`kpi-rank-badge ${row.rankNo === 1 ? 'is-top' : ''}`}>{row.rankNo}</div>
                    </td>
                    <td>
                      <div className="kpi-user-cell">
                        <div className="kpi-user-avatar">{getInitials(row.name)}</div>
                        <strong>{row.name}</strong>
                      </div>
                    </td>
                    <td>{row.departmentDisplay || row.department}</td>
                    <td>{row.rankLabel}</td>
                    <td>
                      <span className="kpi-score-value">
                        {row.score != null && !Number.isNaN(Number(row.score)) ? Number(row.score).toFixed(1) : '—'}
                      </span>
                    </td>
                    <td>
                      {Array.isArray(row.trend) && row.trend.length > 0 ? (
                        <div className="kpi-mini-trend" aria-hidden>
                          {row.trend.map((value, idx) => (
                            <i key={`${row.userId}-trend-${idx}`} style={{ height: `${value}%` }} />
                          ))}
                        </div>
                      ) : (
                        <span className="kpi-score-value kpi-score-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {!loading && leaderboardRows.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="kpi-empty-cell">표시할 직원 데이터가 없습니다.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="kpi-insight-grid">
          {insightCards.map((item) => (
            <article key={item.key} className={`kpi-insight-card tone-${item.tone}`}>
              {item.kind === 'ring' ? (
                <div className={`kpi-progress-ring tone-${item.tone}`} aria-hidden>
                  <span>{item.value}</span>
                </div>
              ) : (
                <div className={`kpi-recommendation-icon tone-${item.tone}`} aria-hidden>
                  <span className="material-symbols-outlined">{item.icon}</span>
                </div>
              )}
              <div>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
              </div>
            </article>
          ))}
        </section>

        {isListModalOpen ? (
          <KpiDetailModal
            periodLabel={currentPeriodLabel}
            title={detailModalMeta.title}
            description={detailModalMeta.description}
            items={detailChecklistItems}
            loading={detailChecklistLoading}
            saving={detailChecklistSaving}
            message={detailChecklistMessage}
            onScoreChange={handleChecklistScoreChange}
            onChecklistItemPatch={handleChecklistItemPatch}
            onSave={handleSaveChecklist}
            onClose={closeListModal}
            variant={selectedListMetric === 'otherPerformance' ? 'otherPerformance' : 'default'}
            otherForm={otherPerfForm}
            onOtherFormChange={setOtherPerfForm}
            onOpenParticipantPicker={() => setParticipantPickerOpen(true)}
            onSubmitOtherPerformance={handleSubmitOtherPerformance}
            onDeleteOtherEntry={handleDeleteOtherEntry}
            otherSubmitting={otherPerfSubmitting}
            staffFilterUserId={checklistStaffFilterUserId}
          />
        ) : null}
        {participantPickerOpen ? (
          <ParticipantModal
            teamMembers={participantTeamMembers}
            selected={otherPerfForm.participants}
            currentUser={participantModalCurrentUser}
            onConfirm={handleOtherParticipantConfirm}
            onClose={() => setParticipantPickerOpen(false)}
            title="기타 성과 참여자"
          />
        ) : null}
        {isTargetModalOpen ? (
          <KpiTargetModal
            scopeType={targetModalScopeType}
            onScopeTypeChange={setTargetModalScopeType}
            departmentId={targetModalDepartmentId}
            onDepartmentChange={setTargetModalDepartmentId}
            userId={targetModalUserId}
            onUserChange={setTargetModalUserId}
            departmentOptions={targetModalDepartmentOptions}
            userOptions={targetModalUserOptions}
            scopeNotice={targetModalScopeNotice}
            year={targetModalYear}
            onYearChange={setTargetModalYear}
            monthlyRevenue={targetModalMonthlyRevenue}
            monthlyProjects={targetModalMonthlyProjects}
            monthlyProjectTitles={targetModalMonthlyProjectTitles}
            monthlyProjectTitleDrafts={targetModalMonthlyProjectTitleDrafts}
            monthlyProjectParticipantDrafts={targetModalMonthlyProjectParticipantDrafts}
            onMonthlyRevenueChange={handleTargetMonthlyRevenueChange}
            onMonthlyProjectsChange={handleTargetMonthlyProjectsChange}
            onMonthlyProjectTitleDraftChange={handleTargetProjectTitleDraftChange}
            onMonthlyProjectParticipantDraftChange={handleTargetProjectParticipantDraftChange}
            onAddMonthlyProjectTitle={handleAddTargetProjectTitle}
            canSelectTeamProjectParticipants={canSelectTeamProjectParticipants}
            teamProjectParticipantOptions={targetModalTeamProjectParticipantOptions}
            teamMonthlyProjects={targetModalTeamMonthlyProjectsDisplay}
            teamMonthlyRevenue={targetModalTeamMonthlyRevenueDisplay}
            loading={targetModalLoading}
            saving={targetModalSaving}
            message={targetModalMessage}
            canSubmit={canSubmitTargetModal}
            onSubmit={handleSaveTargetModal}
            onClose={closeTargetModal}
          />
        ) : null}
      </div>
    </div>
  );
}
