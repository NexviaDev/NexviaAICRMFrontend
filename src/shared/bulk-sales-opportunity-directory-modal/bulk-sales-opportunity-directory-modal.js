import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ProductSearchModal from '@/sales-pipeline/product-search-modal/product-search-modal';
import ParticipantModal from '@/shared/participant-modal/participant-modal';
import CustomFieldsManageModal from '@/shared/custom-fields-manage-modal/custom-fields-manage-modal';
import { API_BASE } from '@/config';
import { pingBackendHealth } from '@/lib/backend-wake';
import { getStoredCrmUser, isAdminOrAboveRole } from '@/lib/crm-role-utils';
import { resolveDepartmentDisplayFromChart } from '@/lib/org-chart-tree-utils';
import { buildStageForecastPercentMap } from '@/sales-pipeline/pipeline-forecast-utils';
import { OPPORTUNITY_PRICE_BASIS_OPTIONS, suggestedPriceFromProduct } from '@/lib/product-price-utils';
import {
  buildPipelineStageSelectOptionsFromDefinitions,
  buildLineFromProduct,
  buildOpportunityCreatePayload,
  computeLineDeduction,
  computeLineFinalAmount,
  computeTotalDeduction,
  computeTotalFinalAmount,
  createEmptyCommissionRow,
  formatNumberInput,
  newCommissionRecipientId,
  parseNumber,
  priceBasisLabelsForValue
} from '@/lib/sales-opportunity-form-shared';
import './bulk-sales-opportunity-directory-modal.css';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function todayYmd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function newCollectionEntryId() {
  return `coll-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** opportunity-modal 과 동일 — commissionRecipients 비어 있을 때 플레이스홀더 행 */
function emptyCommissionRowForLine(lineId) {
  return { id: `comm-blank-${lineId}`, remarks: '', commissionAmount: '' };
}

function formatCurrencyDisplay(num, currency) {
  if (!Number.isFinite(num)) return '—';
  const s = Math.round(num).toLocaleString();
  if (currency === 'USD') return `$${s}`;
  if (currency === 'JPY') return `${s} 엔`;
  return `${s} 원`;
}

function getInitialAssignee() {
  try {
    const u = getStoredCrmUser();
    return {
      assignedToUserId: u?._id ? String(u._id) : '',
      assignedToName: (u?.name && String(u.name).trim()) || ''
    };
  } catch {
    return { assignedToUserId: '', assignedToName: '' };
  }
}

export default function BulkSalesOpportunityDirectoryModal({
  open,
  mode,
  /** 고객사: { _id, name, address, businessNumber } / 연락처: 목록 행 객체 */
  entities,
  onClose,
  onCompleted
}) {
  const [showProductSearch, setShowProductSearch] = useState(false);
  const [lineItems, setLineItems] = useState([]);
  const [productById, setProductById] = useState({});
  const [channelDistributorList, setChannelDistributorList] = useState([]);
  const [scheduleFieldDefs, setScheduleFieldDefs] = useState([]);
  const [scheduleCustomDates, setScheduleCustomDates] = useState({});
  const [collectionEntries, setCollectionEntries] = useState(() => [
    { id: newCollectionEntryId(), amount: '', date: '' }
  ]);
  const [pipelineStageDefinitions, setPipelineStageDefinitions] = useState([]);
  const [companyEmployees, setCompanyEmployees] = useState([]);
  const [overviewOrgChart, setOverviewOrgChart] = useState(null);
  const [showInternalAssigneePicker, setShowInternalAssigneePicker] = useState(false);
  const [showScheduleFieldsManageModal, setShowScheduleFieldsManageModal] = useState(false);
  const [form, setForm] = useState(() => ({
    currency: 'KRW',
    stage: 'NewLead',
    description: '',
    saleDate: '',
    startDate: todayYmd(),
    targetDate: '',
    expectedCloseMonth: '',
    contractAmount: '',
    invoiceAmount: '',
    invoiceAmountDate: '',
    fullCollectionCompleteDate: '',
    licenseCertificateDeliveredDate: '',
    ...getInitialAssignee()
  }));
  const [contactByCompanyId, setContactByCompanyId] = useState({});
  const [employeesByCompanyId, setEmployeesByCompanyId] = useState({});
  const [employeesLoading, setEmployeesLoading] = useState(false);
  const [personalPurchase, setPersonalPurchase] = useState(mode === 'employees');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const entityList = useMemo(() => (Array.isArray(entities) ? entities : []), [entities]);

  const refetchScheduleFieldDefs = useCallback(async () => {
    try {
      const res = await fetch(
        `${API_BASE}/custom-field-definitions?entityType=salesOpportunitySchedule`,
        { headers: getAuthHeader() }
      );
      const data = await res.json().catch(() => ({}));
      if (Array.isArray(data.items)) setScheduleFieldDefs(data.items);
      else setScheduleFieldDefs([]);
    } catch {
      setScheduleFieldDefs([]);
    }
  }, []);

  const stageSelectOptions = useMemo(
    () => buildPipelineStageSelectOptionsFromDefinitions(pipelineStageDefinitions),
    [pipelineStageDefinitions]
  );

  const stageForecastMap = useMemo(
    () => buildStageForecastPercentMap(pipelineStageDefinitions),
    [pipelineStageDefinitions]
  );

  const teamMembersForParticipantModal = useMemo(
    () =>
      (companyEmployees || []).map((e) => {
        const deptId = String(e.companyDepartment || e.department || '').trim();
        const departmentDisplay =
          String(e.departmentDisplay || '').trim() ||
          resolveDepartmentDisplayFromChart(overviewOrgChart, deptId) ||
          undefined;
        return {
          _id: e.id,
          name: e.name,
          email: e.email,
          phone: e.phone || '',
          companyDepartment: deptId,
          department: e.department || deptId,
          departmentDisplay
        };
      }),
    [companyEmployees, overviewOrgChart]
  );

  const internalAssigneeParticipantSelected = useMemo(() => {
    const uid = (form.assignedToUserId || '').trim();
    if (uid) {
      const nm = (form.assignedToName || '').trim();
      const emp = companyEmployees.find((e) => e?.id != null && String(e.id) === uid);
      return [{ userId: uid, name: nm || (emp?.name && String(emp.name).trim()) || emp?.email || '—' }];
    }
    const me = getStoredCrmUser();
    const myId = me?._id != null ? String(me._id) : '';
    if (!myId) return [];
    const emp = companyEmployees.find((e) => e?.id != null && String(e.id) === myId);
    const nm =
      (emp?.name && String(emp.name).trim()) ||
      (me?.name && String(me.name).trim()) ||
      (me?.email && String(me.email).trim()) ||
      '나';
    return [{ userId: myId, name: nm }];
  }, [form.assignedToUserId, form.assignedToName, companyEmployees]);

  const currentUserForParticipantModal = useMemo(() => {
    const me = getStoredCrmUser();
    return me?._id ? { _id: me._id } : null;
  }, []);

  const canManageScheduleFieldDefs = useMemo(() => isAdminOrAboveRole(getStoredCrmUser()?.role), []);
  const wonOnlyScheduleEditable = form.stage === 'Won';

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        await pingBackendHealth(getAuthHeader);
        const res = await fetch(
          `${API_BASE}/custom-field-definitions?entityType=salesPipelineStage`,
          { headers: getAuthHeader() }
        );
        const data = await res.json().catch(() => ({}));
        if (!cancelled) {
          setPipelineStageDefinitions(Array.isArray(data?.items) ? data.items : []);
        }
      } catch {
        if (!cancelled) setPipelineStageDefinitions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch(`${API_BASE}/companies/overview`, { headers: getAuthHeader() })
      .then((r) => r.json().catch(() => ({})))
      .then((data) => {
        if (cancelled) return;
        if (Array.isArray(data?.employees)) setCompanyEmployees(data.employees);
        setOverviewOrgChart(data?.company?.organizationChart ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const uid = (form.assignedToUserId || '').trim();
    if (!uid || (form.assignedToName || '').trim()) return;
    const emp = companyEmployees.find((e) => e?.id != null && String(e.id) === uid);
    if (!emp?.name) return;
    setForm((f) => ({ ...f, assignedToName: String(emp.name).trim() }));
  }, [open, companyEmployees, form.assignedToUserId, form.assignedToName]);

  useEffect(() => {
    if (!open || stageSelectOptions.length === 0) return;
    const ok = stageSelectOptions.some((s) => s.value === form.stage);
    if (ok) return;
    const next = stageSelectOptions[0]?.value || 'NewLead';
    setForm((f) => ({ ...f, stage: next }));
  }, [open, stageSelectOptions, form.stage]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${API_BASE}/custom-field-definitions?entityType=salesOpportunitySchedule`,
          { headers: getAuthHeader() }
        );
        const data = await res.json().catch(() => ({}));
        if (!cancelled && Array.isArray(data.items)) setScheduleFieldDefs(data.items);
        else if (!cancelled) setScheduleFieldDefs([]);
      } catch {
        if (!cancelled) setScheduleFieldDefs([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        await pingBackendHealth(getAuthHeader);
        const res = await fetch(`${API_BASE}/companies/channel-distributors`, { headers: getAuthHeader() });
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok && Array.isArray(data.items)) setChannelDistributorList(data.items);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open || mode !== 'companies' || entityList.length === 0) {
      setEmployeesByCompanyId({});
      return;
    }
    let cancelled = false;
    setEmployeesLoading(true);
    (async () => {
      const next = {};
      await Promise.all(
        entityList.map(async (co) => {
          const id = co?._id != null ? String(co._id) : '';
          if (!id) return;
          try {
            const res = await fetch(
              `${API_BASE}/customer-company-employees?customerCompanyId=${encodeURIComponent(id)}&page=1&limit=400`,
              { headers: getAuthHeader() }
            );
            const data = await res.json().catch(() => ({}));
            if (res.ok && Array.isArray(data.items)) next[id] = data.items;
            else next[id] = [];
          } catch {
            next[id] = [];
          }
        })
      );
      if (!cancelled) {
        setEmployeesByCompanyId(next);
        setEmployeesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, mode, entityList]);

  useEffect(() => {
    if (open && mode === 'employees') setPersonalPurchase(true);
    if (open && mode === 'companies') setPersonalPurchase(false);
  }, [open, mode]);

  const removeLine = useCallback((lineId) => {
    setLineItems((rows) => {
      const dropped = rows.find((r) => r.lineId === lineId);
      const next = rows.filter((r) => r.lineId !== lineId);
      if (dropped?.productId) {
        const pid = String(dropped.productId);
        setProductById((prev) => {
          const n = { ...prev };
          if (!next.some((l) => String(l.productId) === pid)) delete n[pid];
          return n;
        });
      }
      return next;
    });
  }, []);

  const addCollectionRow = useCallback(() => {
    setCollectionEntries((rows) => [...rows, { id: newCollectionEntryId(), amount: '', date: '' }]);
  }, []);

  const removeCollectionRow = useCallback((entryId) => {
    setCollectionEntries((rows) => {
      const next = rows.filter((e) => e.id !== entryId);
      return next.length > 0 ? next : [{ id: newCollectionEntryId(), amount: '', date: '' }];
    });
  }, []);

  const addCommissionRecipientToLine = useCallback((lineId) => {
    setLineItems((rows) =>
      rows.map((l) => {
        if (l.lineId !== lineId) return l;
        const cr =
          Array.isArray(l.commissionRecipients) && l.commissionRecipients.length > 0
            ? l.commissionRecipients
            : [emptyCommissionRowForLine(l.lineId)];
        return { ...l, commissionRecipients: [...cr, createEmptyCommissionRow()] };
      })
    );
  }, []);

  const removeCommissionRecipientFromLine = useCallback((lineId, recipientId) => {
    setLineItems((rows) =>
      rows.map((l) => {
        if (l.lineId !== lineId) return l;
        const cr = Array.isArray(l.commissionRecipients) ? l.commissionRecipients.filter((r) => r.id !== recipientId) : [];
        return { ...l, commissionRecipients: cr.length > 0 ? cr : [emptyCommissionRowForLine(l.lineId)] };
      })
    );
  }, []);

  const updateCommissionRecipientOnLine = useCallback((lineId, recipientId, patch) => {
    setLineItems((rows) =>
      rows.map((l) => {
        if (l.lineId !== lineId) return l;
        const base =
          Array.isArray(l.commissionRecipients) && l.commissionRecipients.length > 0
            ? l.commissionRecipients
            : [emptyCommissionRowForLine(l.lineId)];
        return {
          ...l,
          commissionRecipients: base.map((r) => (r.id === recipientId ? { ...r, ...patch } : r))
        };
      })
    );
  }, []);

  const onProductsChosen = useCallback((products) => {
    const list = Array.isArray(products) ? products : [];
    const newLines = list.map((p) => buildLineFromProduct(p, 'consumer'));
    setLineItems((prev) => [...prev, ...newLines]);
    setProductById((prev) => {
      const docs = { ...prev };
      for (const p of list) {
        if (p?._id) docs[String(p._id)] = p;
      }
      return docs;
    });
    if (list[0]?.currency) {
      setForm((f) => ({ ...f, currency: list[0].currency || f.currency }));
    }
  }, []);

  const registerDistributorsIfNeeded = useCallback(async () => {
    const toAdd = new Set();
    for (const line of lineItems) {
      if (line.priceBasis === 'channel') {
        const d = String(line.channelDistributor || '').trim();
        if (d && !channelDistributorList.includes(d)) toAdd.add(d);
      }
    }
    for (const distTrim of toAdd) {
      const cdRes = await fetch(`${API_BASE}/companies/channel-distributors`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ add: distTrim })
      });
      const cdData = await cdRes.json().catch(() => ({}));
      if (!cdRes.ok) throw new Error(cdData.error || '유통사 목록에 추가할 수 없습니다.');
      if (Array.isArray(cdData.items)) setChannelDistributorList(cdData.items);
    }
  }, [lineItems, channelDistributorList]);

  const buildTitle = useCallback(
    (fallbackName) => {
      const names = lineItems.map((l) => l.productName?.trim()).filter(Boolean);
      if (names.length) return names.join(', ');
      return String(fallbackName || '').trim() || '영업 기회';
    },
    [lineItems]
  );

  const handleSubmit = async () => {
    setError('');
    if (entityList.length === 0) {
      setError('선택된 항목이 없습니다.');
      return;
    }
    if (lineItems.length === 0) {
      setError('제품을 한 개 이상 추가해 주세요.');
      return;
    }
    const selectedStage =
      stageSelectOptions.length > 0 && stageSelectOptions.some((s) => s.value === form.stage)
        ? form.stage
        : stageSelectOptions[0]?.value || 'NewLead';
    if (selectedStage === 'Won' && !String(form.saleDate || '').trim()) {
      setError('수주 성공으로 저장하려면 수주·판매일을 입력해 주세요.');
      return;
    }
    if (mode === 'companies') {
      for (const co of entityList) {
        const cid = String(co._id);
        if (!contactByCompanyId[cid]) {
          setError(`「${co.name || '고객사'}」의 구매 담당자(연락처)를 선택해 주세요.`);
          return;
        }
      }
    }
    if (mode === 'employees' && !personalPurchase) {
      for (const emp of entityList) {
        const ccRaw = emp.customerCompanyId;
        const hasCc =
          (ccRaw && typeof ccRaw === 'object' && ccRaw._id != null) ||
          (ccRaw && typeof ccRaw !== 'object' && String(ccRaw).trim().length === 24);
        if (!hasCc) {
          setError(`「${emp.name || '연락처'}」는 소속 고객사가 없어 회사 연동 저장을 할 수 없습니다. 개인 구매를 켜 주세요.`);
          return;
        }
      }
    }

    setSaving(true);
    try {
      await pingBackendHealth(getAuthHeader);
      await registerDistributorsIfNeeded();

      let ok = 0;
      const errors = [];

      if (mode === 'companies') {
        for (const co of entityList) {
          const cid = String(co._id);
          const empId = contactByCompanyId[cid];
          const opts = employeesByCompanyId[cid] || [];
          const emp = opts.find((e) => String(e._id) === String(empId));
          if (!emp) {
            errors.push(`${co.name}: 담당자 없음`);
            continue;
          }
          const title = buildTitle(co.name);
          const body = buildOpportunityCreatePayload({
            title,
            personalPurchase: false,
            customerCompanyId: cid,
            customerCompanyEmployeeId: String(emp._id),
            contactName: String(emp.name || '').trim(),
            contactPhone: String(emp.phone || '').trim(),
            contactEmail: String(emp.email || '').trim(),
            snapshotCompanyName: String(co.name || '').trim(),
            snapshotCompanyBusinessNumber: String(co.businessNumber || '').trim(),
            snapshotCompanyAddress: String(co.address || '').trim(),
            snapshotContactName: String(emp.name || '').trim(),
            snapshotContactPhone: String(emp.phone || '').trim(),
            snapshotContactEmail: String(emp.email || '').trim(),
            lineItemsClient: lineItems,
            currency: form.currency,
            stage: selectedStage,
            description: form.description,
            saleDateYmd: form.saleDate,
            startDateYmd: form.startDate,
            targetDateYmd: form.targetDate,
            expectedCloseMonth: form.expectedCloseMonth,
            assignedToUserId: form.assignedToUserId,
            contractAmountStr: form.contractAmount,
            fullCollectionCompleteDateYmd: form.fullCollectionCompleteDate,
            invoiceAmountStr: form.invoiceAmount,
            invoiceAmountDateYmd: form.invoiceAmountDate,
            licenseCertificateDeliveredDateYmd: form.licenseCertificateDeliveredDate,
            collectionEntriesClient: collectionEntries,
            scheduleFieldDefs,
            scheduleCustomDates,
            documentRefs: []
          });
          const res = await fetch(`${API_BASE}/sales-opportunities`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
            body: JSON.stringify(body)
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) errors.push(`${co.name}: ${data.error || res.status}`);
          else ok += 1;
        }
      } else {
        for (const emp of entityList) {
          const ccRaw = emp.customerCompanyId;
          const ccDoc =
            ccRaw && typeof ccRaw === 'object' && ccRaw._id != null ? ccRaw : null;
          const ccIdString =
            !personalPurchase && ccDoc?._id != null
              ? String(ccDoc._id)
              : !personalPurchase && ccRaw && typeof ccRaw !== 'object' && String(ccRaw).trim().length === 24
                ? String(ccRaw).trim()
                : '';
          const ccId = personalPurchase ? null : ccIdString || null;
          const title = buildTitle(emp.name);
          const body = buildOpportunityCreatePayload({
            title,
            personalPurchase,
            customerCompanyId: ccId,
            customerCompanyEmployeeId: String(emp._id),
            contactName: String(emp.name || '').trim(),
            contactPhone: String(emp.phone || '').trim(),
            contactEmail: String(emp.email || '').trim(),
            snapshotCompanyName: !personalPurchase && ccDoc ? String(ccDoc.name || emp.company || '').trim() : '',
            snapshotCompanyBusinessNumber:
              !personalPurchase && ccDoc ? String(ccDoc.businessNumber || '').trim() : '',
            snapshotCompanyAddress: !personalPurchase && ccDoc ? String(ccDoc.address || '').trim() : '',
            snapshotContactName: String(emp.name || '').trim(),
            snapshotContactPhone: String(emp.phone || '').trim(),
            snapshotContactEmail: String(emp.email || '').trim(),
            lineItemsClient: lineItems,
            currency: form.currency,
            stage: selectedStage,
            description: form.description,
            saleDateYmd: form.saleDate,
            startDateYmd: form.startDate,
            targetDateYmd: form.targetDate,
            expectedCloseMonth: form.expectedCloseMonth,
            assignedToUserId: form.assignedToUserId,
            contractAmountStr: form.contractAmount,
            fullCollectionCompleteDateYmd: form.fullCollectionCompleteDate,
            invoiceAmountStr: form.invoiceAmount,
            invoiceAmountDateYmd: form.invoiceAmountDate,
            licenseCertificateDeliveredDateYmd: form.licenseCertificateDeliveredDate,
            collectionEntriesClient: collectionEntries,
            scheduleFieldDefs,
            scheduleCustomDates,
            documentRefs: []
          });
          const res = await fetch(`${API_BASE}/sales-opportunities`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
            body: JSON.stringify(body)
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) errors.push(`${emp.name || emp._id}: ${data.error || res.status}`);
          else ok += 1;
        }
      }

      if (errors.length && ok === 0) {
        setError(errors.slice(0, 5).join('\n'));
        return;
      }
      if (errors.length) {
        window.alert(`일부만 성공: ${ok}건 / 실패 ${errors.length}건\n${errors.slice(0, 8).join('\n')}`);
      }
      try {
        window.dispatchEvent(new CustomEvent('nexvia-crm-pipeline-refresh'));
      } catch {
        /* ignore */
      }
      onCompleted?.(ok);
      onClose?.();
    } catch (e) {
      setError(e?.message || '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const getEffectivePurchaseCostForLine = (line) => {
    const raw = String(line.purchaseCostTotal ?? '').replace(/,/g, '').trim();
    if (raw !== '') {
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 0) return Math.round(n);
    }
    const p = line.productId ? productById[line.productId] : null;
    if (!p) return null;
    const cost = Number(p.costPrice);
    if (!Number.isFinite(cost) || cost < 0) return null;
    const qty = Math.max(0, Number(line.quantity) || 1);
    return Math.round(cost * qty);
  };

  const computeLineNetMarginLocal = (line) => {
    const costTotal = getEffectivePurchaseCostForLine(line);
    if (costTotal == null) return null;
    return computeLineFinalAmount(line) - costTotal;
  };

  const computeTotalNetMarginLocal = () => {
    if (lineItems.length === 0) return null;
    let sum = 0;
    let any = false;
    for (const line of lineItems) {
      const m = computeLineNetMarginLocal(line);
      if (m != null) {
        any = true;
        sum += m;
      }
    }
    return any ? sum : null;
  };

  const totalCommissionAmount = lineItems.reduce(
    (sum, line) =>
      sum +
      (Array.isArray(line.commissionRecipients) ? line.commissionRecipients : []).reduce(
        (s, r) => s + parseNumber(r.commissionAmount),
        0
      ),
    0
  );
  const netMarginAmount = computeTotalNetMarginLocal();
  const netMarginAfterCommission = netMarginAmount != null ? netMarginAmount - totalCommissionAmount : null;
  const totalFinalForForecast = computeTotalFinalAmount(lineItems);
  const forecastPctForStage = stageForecastMap[form.stage];
  const forecastExpectedRevenue =
    lineItems.length > 0 && Number.isFinite(forecastPctForStage) && Number.isFinite(totalFinalForForecast)
      ? Math.round(totalFinalForForecast * (forecastPctForStage / 100))
      : null;
  const forecastStageLabel =
    stageSelectOptions.find((s) => s.value === form.stage)?.label || form.stage;

  if (!open) return null;

  const scheduleDateDefs = scheduleFieldDefs.filter((d) => d.type === 'date');

  return (
    <div className="bulk-opp-dir-overlay" role="presentation" onClick={onClose}>
      <div
        className="bulk-opp-dir-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-opp-dir-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bulk-opp-dir-head">
          <div>
            <h3 id="bulk-opp-dir-title">
              {mode === 'companies' ? '선택 고객사 → 세일즈 파이프라인 등록' : '선택 연락처 → 세일즈 파이프라인 등록'}
            </h3>
            <p>
              단계·통화·추가 설명·일정·제품 행은 기회 등록과 동일한 API 형식(
              <code>sales-opportunity-form-shared.js</code>)을 사용합니다. 제품·가격 기준·유통사·할인은 아래 공통
              제품 행에 입력하면 선택된 각 고객(또는 연락처)마다 동일 내용으로 등록됩니다.
            </p>
          </div>
          <button type="button" className="bulk-opp-dir-close" onClick={onClose} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        {error ? (
          <pre className="bulk-opp-dir-err" style={{ whiteSpace: 'pre-wrap' }}>
            {error}
          </pre>
        ) : null}
        <div className="bulk-opp-dir-body">
          {mode === 'employees' ? (
            <label className="bulk-opp-dir-label bulk-opp-dir-check" style={{ marginBottom: 12 }}>
              <input
                type="checkbox"
                checked={personalPurchase}
                onChange={(e) => setPersonalPurchase(e.target.checked)}
              />
              <span>개인 구매로 등록 (해제 시 연락처에 연결된 고객사가 함께 저장됩니다)</span>
            </label>
          ) : null}

          <p className="bulk-opp-dir-section-title">공통 — 단계·통화·설명·일정 (기회와 동일 필드)</p>
          <div className="bulk-opp-dir-grid">
            <label className="bulk-opp-dir-label">
              통화
              <select
                value={form.currency}
                onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
              >
                <option value="KRW">KRW</option>
                <option value="USD">USD</option>
                <option value="JPY">JPY</option>
              </select>
            </label>
            <label className="bulk-opp-dir-label">
              수주·판매일 (단계가 수주 성공일 때)
              <input
                type="date"
                value={form.saleDate}
                onChange={(e) => setForm((f) => ({ ...f, saleDate: e.target.value }))}
              />
            </label>
            <label className="bulk-opp-dir-label">
              시작일
              <input
                type="date"
                value={form.startDate}
                onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
              />
            </label>
            <label className="bulk-opp-dir-label">
              목표일
              <input
                type="date"
                value={form.targetDate}
                onChange={(e) => setForm((f) => ({ ...f, targetDate: e.target.value }))}
              />
            </label>
            <label className="bulk-opp-dir-label">
              예상 마감 월 (YYYY-MM)
              <input
                type="month"
                value={form.expectedCloseMonth}
                onChange={(e) => setForm((f) => ({ ...f, expectedCloseMonth: e.target.value }))}
              />
            </label>
            <label className="bulk-opp-dir-label">
              전체 수금 완료일
              <input
                type="date"
                value={form.fullCollectionCompleteDate}
                disabled={!wonOnlyScheduleEditable}
                onChange={(e) => setForm((f) => ({ ...f, fullCollectionCompleteDate: e.target.value }))}
              />
            </label>
            <label className="bulk-opp-dir-label">
              라이선스 증서 전달일
              <input
                type="date"
                value={form.licenseCertificateDeliveredDate}
                disabled={!wonOnlyScheduleEditable}
                onChange={(e) => setForm((f) => ({ ...f, licenseCertificateDeliveredDate: e.target.value }))}
              />
            </label>
          </div>

          <div className="bulk-opp-dir-assignee-row">
            <span className="bulk-opp-dir-assignee-label">판매 담당</span>
            <button type="button" className="bulk-opp-dir-btn" onClick={() => setShowInternalAssigneePicker(true)}>
              {(form.assignedToName || '').trim() ||
                (form.assignedToUserId ? '직원 선택됨' : '사내 담당 선택…')}
            </button>
          </div>

          <p className="bulk-opp-dir-section-title">계약·계산서·수금 (공통)</p>
          <div className="bulk-opp-dir-finance-grid">
            <label className="bulk-opp-dir-label">
              계약 금액
              <input
                value={form.contractAmount}
                onChange={(e) => setForm((f) => ({ ...f, contractAmount: formatNumberInput(e.target.value) }))}
                inputMode="numeric"
              />
            </label>
            <label className="bulk-opp-dir-label">
              계산서 금액
              <input
                value={form.invoiceAmount}
                onChange={(e) => setForm((f) => ({ ...f, invoiceAmount: formatNumberInput(e.target.value) }))}
                inputMode="numeric"
              />
            </label>
            <label className="bulk-opp-dir-label">
              계산서 일자
              <input
                type="date"
                value={form.invoiceAmountDate}
                onChange={(e) => setForm((f) => ({ ...f, invoiceAmountDate: e.target.value }))}
              />
            </label>
          </div>
          <div className="bulk-opp-dir-collection-block">
            <div className="bulk-opp-dir-collection-head">
              <span className="bulk-opp-dir-section-title" style={{ margin: 0 }}>
                수금 내역
              </span>
              <button type="button" className="bulk-opp-dir-btn bulk-opp-dir-btn--small" onClick={addCollectionRow}>
                + 행 추가
              </button>
            </div>
            {collectionEntries.map((entry) => (
              <div key={entry.id} className="bulk-opp-dir-collection-row">
                <label className="bulk-opp-dir-label">
                  금액
                  <input
                    value={entry.amount}
                    onChange={(e) =>
                      setCollectionEntries((rows) =>
                        rows.map((row) =>
                          row.id === entry.id ? { ...row, amount: formatNumberInput(e.target.value) } : row
                        )
                      )
                    }
                    inputMode="numeric"
                  />
                </label>
                <label className="bulk-opp-dir-label">
                  일자
                  <input
                    type="date"
                    value={entry.date}
                    onChange={(e) =>
                      setCollectionEntries((rows) =>
                        rows.map((row) => (row.id === entry.id ? { ...row, date: e.target.value } : row))
                      )
                    }
                  />
                </label>
                <button
                  type="button"
                  className="bulk-opp-dir-btn bulk-opp-dir-btn--small"
                  onClick={() => removeCollectionRow(entry.id)}
                  aria-label="수금 행 제거"
                  disabled={collectionEntries.length <= 1}
                >
                  제거
                </button>
              </div>
            ))}
          </div>

          <p className="bulk-opp-dir-section-title">단계 (회사 파이프라인 정의)</p>
          <div className="bulk-opp-dir-product-bar" style={{ flexWrap: 'wrap' }}>
            {stageSelectOptions.map((s) => (
              <button
                key={s.value}
                type="button"
                className="bulk-opp-dir-btn"
                style={{
                  borderColor: form.stage === s.value ? '#6b8fa8' : undefined,
                  background: form.stage === s.value ? '#e8f1f6' : '#fff'
                }}
                onClick={() => setForm((f) => ({ ...f, stage: s.value }))}
              >
                {s.label}
              </button>
            ))}
          </div>

          <label className="bulk-opp-dir-label" style={{ marginTop: 10 }}>
            추가 설명 (프로모션 등)
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              maxLength={8000}
              rows={3}
            />
          </label>

          {scheduleDateDefs.length > 0 ? (
            <>
              <div className="bulk-opp-dir-schedule-head">
                <p className="bulk-opp-dir-section-title" style={{ marginTop: 14, marginBottom: 0 }}>
                  회사 맞춤 일정
                </p>
                {canManageScheduleFieldDefs ? (
                  <button
                    type="button"
                    className="bulk-opp-dir-btn bulk-opp-dir-btn--small"
                    onClick={() => setShowScheduleFieldsManageModal(true)}
                  >
                    항목 관리
                  </button>
                ) : null}
              </div>
              <div className="bulk-opp-dir-grid">
                {scheduleDateDefs.map((d) => {
                  const scheduleFieldEditable = wonOnlyScheduleEditable || Boolean(d.options?.editableBeforeWon);
                  return (
                    <label key={d.key} className="bulk-opp-dir-label">
                      {d.label || d.key}
                      <input
                        type="date"
                        value={scheduleCustomDates[d.key] || ''}
                        disabled={!scheduleFieldEditable}
                        onChange={(e) =>
                          setScheduleCustomDates((prev) => ({ ...prev, [d.key]: e.target.value }))
                        }
                      />
                    </label>
                  );
                })}
              </div>
            </>
          ) : null}

          <p className="bulk-opp-dir-section-title" style={{ marginTop: 16 }}>
            공통 제품 행 (가격 기준·유통·단가·수량·할인)
          </p>
          <div className="bulk-opp-dir-product-bar">
            {lineItems.map((line) => (
              <span key={line.lineId} className="bulk-opp-dir-pill">
                {line.productName || '제품'}
                <button type="button" onClick={() => removeLine(line.lineId)} aria-label="제거">
                  ×
                </button>
              </span>
            ))}
            <button type="button" className="bulk-opp-dir-add-prod" onClick={() => setShowProductSearch(true)}>
              + 제품 추가
            </button>
          </div>

          {lineItems.map((line) => {
            const product = line.productId ? productById[line.productId] : null;
            return (
              <div key={line.lineId} className="bulk-opp-dir-line-editor">
                <h4>{line.productName || '제품'}</h4>
                <div className="bulk-opp-dir-product-bar" style={{ marginBottom: 8 }}>
                  {OPPORTUNITY_PRICE_BASIS_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className="bulk-opp-dir-btn"
                      style={{
                        borderColor: line.priceBasis === opt.value ? '#6b8fa8' : undefined,
                        background: line.priceBasis === opt.value ? '#e8f1f6' : '#fff'
                      }}
                      onClick={() => {
                        const basis = opt.value;
                        const fb = priceBasisLabelsForValue(basis);
                        const sug = product ? suggestedPriceFromProduct(product, basis) : 0;
                        setLineItems((rows) =>
                          rows.map((r) =>
                            r.lineId === line.lineId
                              ? {
                                  ...r,
                                  priceBasis: basis,
                                  priceBasisLabel: opt.label,
                                  priceBasisShortLabel: opt.shortLabel != null ? String(opt.shortLabel) : '',
                                  channelDistributor: basis !== 'channel' ? '' : r.channelDistributor,
                                  unitPrice: product && sug > 0 ? sug.toLocaleString() : r.unitPrice
                                }
                              : r
                          )
                        );
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {line.priceBasis === 'channel' ? (
                  <label className="bulk-opp-dir-label">
                    유통사
                    <input
                      list={`bulk-ch-${line.lineId}`}
                      value={line.channelDistributor}
                      onChange={(e) =>
                        setLineItems((rows) =>
                          rows.map((r) =>
                            r.lineId === line.lineId ? { ...r, channelDistributor: e.target.value } : r
                          )
                        )
                      }
                      maxLength={200}
                    />
                    <datalist id={`bulk-ch-${line.lineId}`}>
                      {channelDistributorList.map((x) => (
                        <option key={x} value={x} />
                      ))}
                    </datalist>
                  </label>
                ) : null}
                <div className="bulk-opp-dir-line-grid">
                  <label className="bulk-opp-dir-label">
                    단가
                    <input
                      value={line.unitPrice}
                      onChange={(e) =>
                        setLineItems((rows) =>
                          rows.map((r) =>
                            r.lineId === line.lineId ? { ...r, unitPrice: formatNumberInput(e.target.value) } : r
                          )
                        )
                      }
                    />
                  </label>
                  <label className="bulk-opp-dir-label">
                    수량
                    <input
                      type="number"
                      min={1}
                      value={line.quantity}
                      onChange={(e) =>
                        setLineItems((rows) =>
                          rows.map((r) =>
                            r.lineId === line.lineId ? { ...r, quantity: e.target.value } : r
                          )
                        )
                      }
                    />
                  </label>
                  <label className="bulk-opp-dir-label">
                    할인율(%)
                    <input
                      value={line.discountRate}
                      onChange={(e) =>
                        setLineItems((rows) =>
                          rows.map((r) =>
                            r.lineId === line.lineId
                              ? { ...r, discountRate: e.target.value.replace(/[^0-9.]/g, '') }
                              : r
                          )
                        )
                      }
                    />
                  </label>
                  <label className="bulk-opp-dir-label">
                    할인금액
                    <input
                      value={line.discountAmount}
                      onChange={(e) =>
                        setLineItems((rows) =>
                          rows.map((r) =>
                            r.lineId === line.lineId
                              ? { ...r, discountAmount: formatNumberInput(e.target.value) }
                              : r
                          )
                        )
                      }
                    />
                  </label>
                  <label className="bulk-opp-dir-label">
                    매입 원가
                    <input
                      value={line.purchaseCostTotal}
                      onChange={(e) =>
                        setLineItems((rows) =>
                          rows.map((r) =>
                            r.lineId === line.lineId
                              ? { ...r, purchaseCostTotal: formatNumberInput(e.target.value) }
                              : r
                          )
                        )
                      }
                      inputMode="numeric"
                    />
                  </label>
                </div>
                <div className="bulk-opp-dir-commission-block">
                  <div className="bulk-opp-dir-commission-head">
                    <span className="bulk-opp-dir-commission-title">기타 금액</span>
                    <button
                      type="button"
                      className="bulk-opp-dir-btn bulk-opp-dir-btn--small"
                      onClick={() => addCommissionRecipientToLine(line.lineId)}
                      aria-label="기타 금액 행 추가"
                    >
                      + 행
                    </button>
                  </div>
                  {(() => {
                    const commRows =
                      Array.isArray(line.commissionRecipients) && line.commissionRecipients.length > 0
                        ? line.commissionRecipients
                        : [emptyCommissionRowForLine(line.lineId)];
                    return commRows.map((row, idx) => (
                      <div key={row.id} className="bulk-opp-dir-commission-row">
                        <label className="bulk-opp-dir-label">
                          비고
                          <textarea
                            value={row.remarks}
                            onChange={(e) =>
                              updateCommissionRecipientOnLine(line.lineId, row.id, {
                                remarks: e.target.value
                              })
                            }
                            rows={2}
                            maxLength={2000}
                            className="bulk-opp-dir-commission-remarks"
                          />
                        </label>
                        <label className="bulk-opp-dir-label">
                          금액
                          <input
                            value={row.commissionAmount}
                            onChange={(e) =>
                              updateCommissionRecipientOnLine(line.lineId, row.id, {
                                commissionAmount: formatNumberInput(e.target.value)
                              })
                            }
                            inputMode="numeric"
                          />
                        </label>
                        <button
                          type="button"
                          className="bulk-opp-dir-btn bulk-opp-dir-btn--small"
                          onClick={() => removeCommissionRecipientFromLine(line.lineId, row.id)}
                          disabled={commRows.length <= 1}
                          aria-label={`기타 금액 행 ${idx + 1} 제거`}
                        >
                          제거
                        </button>
                      </div>
                    ));
                  })()}
                </div>
                <div className="bulk-opp-dir-line-summary" aria-label={`${line.productName || '제품'} 요약`}>
                  <span>차감 − {formatCurrencyDisplay(computeLineDeduction(line), form.currency)}</span>
                  <span className="bulk-opp-dir-line-summary-main">
                    최종 {formatCurrencyDisplay(computeLineFinalAmount(line), form.currency)}
                  </span>
                  <span>
                    순마진{' '}
                    {(() => {
                      const lineComm = (Array.isArray(line.commissionRecipients)
                        ? line.commissionRecipients
                        : []
                      ).reduce((s, r) => s + parseNumber(r.commissionAmount), 0);
                      const lineNet = computeLineNetMarginLocal(line);
                      const shown = lineNet != null ? lineNet - lineComm : null;
                      return product && shown != null
                        ? formatCurrencyDisplay(shown, form.currency)
                        : '—';
                    })()}
                  </span>
                </div>
              </div>
            );
          })}

          {lineItems.length > 0 ? (
            <div className="bulk-opp-dir-summary-box">
              <p className="bulk-opp-dir-section-title" style={{ marginTop: 12 }}>
                금액·Forecast 요약 (공통 제품 기준)
              </p>
              <div className="bulk-opp-dir-summary-totals">
                <span>전체 차감 − {formatCurrencyDisplay(computeTotalDeduction(lineItems), form.currency)}</span>
                <span className="bulk-opp-dir-summary-hero">
                  전체 최종 {formatCurrencyDisplay(computeTotalFinalAmount(lineItems), form.currency)}
                </span>
                <span>
                  마진 합{' '}
                  {netMarginAfterCommission != null
                    ? formatCurrencyDisplay(netMarginAfterCommission, form.currency)
                    : '—'}
                </span>
                {forecastExpectedRevenue != null ? (
                  <span className="bulk-opp-dir-summary-forecast">
                    Forecast ({forecastStageLabel} · {forecastPctForStage}%) —{' '}
                    {formatCurrencyDisplay(forecastExpectedRevenue, form.currency)}
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}

          <p className="bulk-opp-dir-section-title" style={{ marginTop: 18 }}>
            등록 미리보기 (제품 2개 이상이면 1 · 1.1 · 1.2 트리)
          </p>
          <div className="bulk-opp-dir-table-wrap">
            <table className="bulk-opp-dir-table">
              <thead>
                <tr>
                  <th className="bulk-opp-dir-rownum">No</th>
                  <th>{mode === 'companies' ? '고객사 / 제품' : '연락처 / 제품'}</th>
                  <th>단가</th>
                  <th>수량</th>
                  <th className="bulk-opp-dir-select">
                    {mode === 'companies' ? '구매 담당자' : '비고'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {entityList.flatMap((ent, idx) => {
                  const n = idx + 1;
                  const lines = lineItems.length ? lineItems : [null];
                  const out = [];
                  if (mode === 'companies') {
                    const cid = String(ent._id);
                    const opts = employeesByCompanyId[cid] || [];
                    out.push(
                      <tr key={`h-${cid}`} className="bulk-opp-dir-row--summary">
                        <td className="bulk-opp-dir-rownum">{n}</td>
                        <td>{ent.name || '—'}</td>
                        <td colSpan={2} />
                        <td>
                          <select
                            className="bulk-opp-dir-select"
                            value={contactByCompanyId[cid] || ''}
                            disabled={employeesLoading}
                            onChange={(e) =>
                              setContactByCompanyId((m) => ({ ...m, [cid]: e.target.value }))
                            }
                          >
                            <option value="">담당자 선택…</option>
                            {opts.map((em) => (
                              <option key={String(em._id)} value={String(em._id)}>
                                {em.name || em.email || em._id}
                              </option>
                            ))}
                          </select>
                          <p className="bulk-opp-dir-hint">해당 고객사에 등록된 직원만 표시됩니다.</p>
                        </td>
                      </tr>
                    );
                  } else {
                    const ccRaw = ent.customerCompanyId;
                    const ccDoc =
                      ccRaw && typeof ccRaw === 'object' && ccRaw._id != null ? ccRaw : null;
                    const ccLabel = personalPurchase
                      ? '개인 구매'
                      : String(ccDoc?.name || ent.company || '고객사').trim() || '—';
                    out.push(
                      <tr key={`h-${ent._id}`} className="bulk-opp-dir-row--summary">
                        <td className="bulk-opp-dir-rownum">{n}</td>
                        <td>
                          {ent.name || '—'}
                          <span style={{ color: '#64748b', fontWeight: 400 }}> · {ccLabel}</span>
                        </td>
                        <td colSpan={2} />
                        <td style={{ color: '#64748b', fontSize: '0.75rem' }}>—</td>
                      </tr>
                    );
                  }
                  lines.forEach((li, j) => {
                    out.push(
                      <tr
                        key={`${ent._id}-li-${j}`}
                        className="bulk-opp-dir-row--line"
                      >
                        <td className="bulk-opp-dir-rownum">{li ? `${n}.${j + 1}` : `${n}.—`}</td>
                        <td>{li ? li.productName || '제품' : '—'}</td>
                        <td>{li ? li.unitPrice || '—' : '—'}</td>
                        <td>{li ? li.quantity || '1' : '—'}</td>
                        <td />
                      </tr>
                    );
                  });
                  return out;
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div className="bulk-opp-dir-foot">
          <button type="button" className="bulk-opp-dir-btn" onClick={onClose} disabled={saving}>
            취소
          </button>
          <button type="button" className="bulk-opp-dir-btn bulk-opp-dir-btn--primary" disabled={saving} onClick={() => void handleSubmit()}>
            {saving ? '등록 중…' : `파이프라인에 등록 (${entityList.length}건)`}
          </button>
        </div>
      </div>
      {showProductSearch ? (
        <ProductSearchModal onClose={() => setShowProductSearch(false)} onSelect={onProductsChosen} />
      ) : null}
      {showInternalAssigneePicker ? (
        <ParticipantModal
          title="사내 영업 담당 선택"
          bulkAddLabel="표시된 인원 모두 선택에 반영"
          teamMembers={teamMembersForParticipantModal}
          selected={internalAssigneeParticipantSelected}
          currentUser={currentUserForParticipantModal}
          onClose={() => setShowInternalAssigneePicker(false)}
          onConfirm={(picked) => {
            setShowInternalAssigneePicker(false);
            if (!picked || picked.length === 0) {
              setForm((f) => ({ ...f, assignedToUserId: '', assignedToName: '' }));
              return;
            }
            const last = picked[picked.length - 1];
            const id = String(last.userId || '').trim();
            const namePick = String(last.name || '').trim();
            const emp = companyEmployees.find((e) => e?.id != null && String(e.id) === id);
            const nameFromList = emp?.name != null ? String(emp.name).trim() : '';
            const name = namePick || nameFromList;
            setForm((f) => ({
              ...f,
              assignedToUserId: id,
              assignedToName: name || (id ? f.assignedToName : '')
            }));
          }}
        />
      ) : null}
      {showScheduleFieldsManageModal ? (
        <CustomFieldsManageModal
          entityType="salesOpportunitySchedule"
          fixedType="date"
          title="기회 일정 — 회사 맞춤 항목"
          description="추가 날짜 항목의 표시 이름만 입력합니다. 아래에서 수주 전 입력 가능 여부를 선택할 수 있으며, 필드 키는 자동으로 부여됩니다."
          getAuthHeader={getAuthHeader}
          onClose={() => setShowScheduleFieldsManageModal(false)}
          onFieldAdded={() => void refetchScheduleFieldDefs()}
          onDefinitionsUpdated={() => void refetchScheduleFieldDefs()}
          deleteConfirmMessage="이 일정 항목 정의를 삭제할까요? 이미 기회에 저장된 값은 DB에 남을 수 있습니다."
        />
      ) : null}
    </div>
  );
}
