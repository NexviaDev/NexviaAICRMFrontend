import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { hasCrmSession, getCrmToken, getCrmAuthHeaders, crmFetchInit, markCrmSessionActive, clearCrmSessionLocal, logoutCrmSession, getAuthHeader } from '@/lib/crm-auth';
import ParticipantModal from '@/shared/participant-modal/participant-modal';
import { API_BASE } from '@/config';
import {
  LEAVE_TYPES,
  HALF_PERIOD_OPTIONS,
  QUARTER_PERIOD_OPTIONS,
  normalizeVacationFormData,
  toDateInputValue,
  normalizeDateTypingValue,
  isPartialDayLeave,
  formatVacationTimeDisplay,
  formatVacationDaysLabel
} from '../vacation-leave-utils';
import { ApprovalContentSheet, ApprovalSheetRow, ApprovalSheetPairRow, ApprovalSheetPair, ApprovalSheetCellStack } from '../approval-content-sheet';
import { ApprovalRouteBoard } from '../approval-route-board';
import '../approval-route-board.css';
import { resolveDeptDisplayLabel } from '../resolve-dept-display';
import {
  normalizeExpenseFormData,
  getExpenseItems,
  emptyExpenseLine,
  toExpenseDateTimeValue
} from '../approval-expense-utils';
import ExpenseLinesEditor from '../approval-expense-lines';
import '../approval-expense-lines.css';
import ApprovalExpenseExcelMappingModal from '../approval-expense-excel-mapping-modal';
import ApprovalExpenseColumnTemplateModal from '../approval-expense-column-template-modal';
import { normalizeExpenseColumnTemplateColumns, getExpenseColumnTemplateFromOverview } from '../approval-expense-column-template';
import { formatNumberInput, parseNumber } from '@/lib/sales-opportunity-form-shared';
import './approval-form-modal.css';

const DOC_TYPES = [
  { key: 'vacation', label: '휴가' },
  { key: 'expense', label: '지출' },
  { key: 'quotation', label: '견적' },
  { key: 'proposal', label: '품의' }
];

const DOC_TYPE_TITLE = {
  vacation: '휴가 신청서',
  expense: '지출 결의서',
  quotation: '견적 결재서',
  proposal: '품의서'
};

const DOC_TYPE_SECTION = {
  vacation: '휴가 신청 내역',
  expense: '지출 신청 내역',
  quotation: '견적 신청 내역',
  proposal: '품의 신청 내역'
};

const DOC_TYPE_DECLARATION = {
  vacation: '휴가기준에 의거하여 위와 같이 휴가를 신청하오니 허락하여 주시기 바랍니다.',
  expense: '위와 같이 지출을 신청하오니 검토 후 결재하여 주시기 바랍니다.',
  quotation: '위와 같이 견적 결재를 신청하오니 검토 후 승인하여 주시기 바랍니다.',
  proposal: '위와 같이 품의하오니 검토 후 결재하여 주시기 바랍니다.'
};

function formatDraftDate(date = new Date()) {
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d} (${days[date.getDay()]})`;
}

function formatDraftDateLong(date = new Date()) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  return `${y}년 ${String(m).padStart(2, '0')}월 ${String(d).padStart(2, '0')}일`;
}

function mapPersonLine(raw) {
  return (raw || []).map((s) => ({
    userId: String(s.userId),
    name: s.name || '',
    department: s.department || ''
  }));
}

function emptyFormData(docType) {
  if (docType === 'vacation') {
    return normalizeVacationFormData({});
  }
  if (docType === 'expense') {
    return normalizeExpenseFormData({});
  }
  if (docType === 'quotation') {
    return { customerName: '', amount: '', productSummary: '', validUntil: '' };
  }
  return { subject: '', summary: '', expectedEffect: '' };
}

function initFormData(docType, editFormData) {
  if (docType === 'vacation') {
    return normalizeVacationFormData(editFormData || {});
  }
  if (docType === 'expense') {
    return normalizeExpenseFormData(editFormData || {});
  }
  const base = emptyFormData(docType);
  if (!editFormData) return base;
  const merged = { ...base, ...editFormData };
  if (docType === 'quotation' && merged.amount != null && merged.amount !== '') {
    merged.amount = formatNumberInput(String(merged.amount));
  }
  return merged;
}

function todayDateIsoText() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function DateTextInput({ value, onChange, onBlur, disabled = false, placeholder = 'YYYY-MM-DD' }) {
  const nativePickerRef = useRef(null);
  const normalizedText = normalizeDateTypingValue(value);
  const nativeValue = toDateInputValue(value);

  const openNativePicker = () => {
    if (disabled) return;
    const el = nativePickerRef.current;
    if (!el) return;
    if (typeof el.showPicker === 'function') {
      el.showPicker();
      return;
    }
    el.focus();
    el.click();
  };

  return (
    <div className="approval-form-date-wrap">
      <input
        type="text"
        inputMode="numeric"
        className="approval-form-input"
        value={normalizedText}
        onChange={(e) => onChange?.(normalizeDateTypingValue(e.target.value))}
        onBlur={(e) => onBlur?.(e)}
        placeholder={placeholder}
        disabled={disabled}
      />
      <button
        type="button"
        className="approval-form-date-icon-btn"
        onClick={openNativePicker}
        disabled={disabled}
        aria-label="달력에서 날짜 선택"
      >
        <span className="material-symbols-outlined" aria-hidden>calendar_today</span>
      </button>
      <input
        ref={nativePickerRef}
        type="date"
        className="approval-form-native-picker"
        tabIndex={-1}
        aria-hidden="true"
        value={nativeValue}
        onChange={(e) => onChange?.(e.target.value)}
      />
    </div>
  );
}

export default function ApprovalFormModal({ currentUser, editDoc, onClose, onSaved }) {
  const [docType, setDocType] = useState(editDoc?.docType || 'vacation');
  const [title, setTitle] = useState(editDoc?.title || '');
  const [memo, setMemo] = useState(editDoc?.memo || '');
  const [formData, setFormData] = useState(() => {
    if (editDoc?.formData) {
      return initFormData(editDoc.docType, editDoc.formData);
    }
    return emptyFormData('vacation');
  });
  const [approvalLine, setApprovalLine] = useState(() => mapPersonLine(editDoc?.approvalLine));
  const [agreementLine, setAgreementLine] = useState(() => mapPersonLine(editDoc?.agreementLine));
  const [referenceLine, setReferenceLine] = useState(() => mapPersonLine(editDoc?.referenceLine));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTarget, setPickerTarget] = useState('approval');
  const [teamMembers, setTeamMembers] = useState([]);
  const [organizationChart, setOrganizationChart] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [docNumberPreview, setDocNumberPreview] = useState('');
  const [expenseExcelOpen, setExpenseExcelOpen] = useState(false);
  const [expenseColumnTemplateOpen, setExpenseColumnTemplateOpen] = useState(false);
  const [expenseColumnTemplateSaving, setExpenseColumnTemplateSaving] = useState(false);
  const [expenseColumnTemplateColumns, setExpenseColumnTemplateColumns] = useState(
    normalizeExpenseColumnTemplateColumns([])
  );

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !pickerOpen) onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, pickerOpen]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/companies/overview`, crmFetchInit());
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        setOrganizationChart(json?.company?.organizationChart ?? null);
        setExpenseColumnTemplateColumns(getExpenseColumnTemplateFromOverview(json));
        const employees = Array.isArray(json?.employees) ? json.employees : [];
        setTeamMembers(
          employees.map((e) => ({
            _id: String(e.id || e._id || ''),
            userId: String(e.id || e._id || ''),
            name: e.name || e.email || '',
            email: e.email || '',
            phone: e.phone || '',
            department: e.department || e.companyDepartment || '',
            companyDepartment: e.department || e.companyDepartment || ''
          }))
        );
      } catch (_) {
        if (!cancelled) {
          setTeamMembers([]);
          setExpenseColumnTemplateColumns(normalizeExpenseColumnTemplateColumns([]));
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (editDoc?.docNumber) {
      setDocNumberPreview(editDoc.docNumber);
      return;
    }
    let cancelled = false;
    fetch(`${API_BASE}/approvals/doc-number-preview?docType=${encodeURIComponent(docType)}`, crmFetchInit())
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.preview) setDocNumberPreview(data.preview);
      })
      .catch(() => {
        if (!cancelled) setDocNumberPreview('');
      });
    return () => { cancelled = true; };
  }, [docType, editDoc?.docNumber]);

  const handleTypeChange = useCallback((next) => {
    if (editDoc) return;
    setDocType(next);
    setFormData(emptyFormData(next));
    setTitle('');
  }, [editDoc]);

  const patchVacationForm = useCallback((patch) => {
    setFormData((prev) => normalizeVacationFormData({ ...prev, ...patch }));
  }, []);

  const patchForm = useCallback((key, value) => {
    if (docType === 'vacation') {
      patchVacationForm({ [key]: value });
      return;
    }
    setFormData((prev) => ({ ...prev, [key]: value }));
  }, [docType, patchVacationForm]);

  const pickerMeta = useMemo(() => {
    if (pickerTarget === 'agreement') {
      return {
        title: '합의자 선택',
        bulkAddLabel: '표시된 인원 모두 합의선에 추가',
        line: agreementLine,
        setter: setAgreementLine
      };
    }
    if (pickerTarget === 'reference') {
      return {
        title: '참조자 선택',
        bulkAddLabel: '표시된 인원 모두 참조에 추가',
        line: referenceLine,
        setter: setReferenceLine
      };
    }
    return {
      title: '결재자 선택',
      bulkAddLabel: '표시된 인원 모두 결재선에 추가',
      line: approvalLine,
      setter: setApprovalLine
    };
  }, [agreementLine, approvalLine, pickerTarget, referenceLine]);

  const pickerSelected = useMemo(
    () => pickerMeta.line.map((s) => ({ userId: s.userId, name: s.name, department: s.department })),
    [pickerMeta.line]
  );

  const openPicker = useCallback((target) => {
    setPickerTarget(target);
    setPickerOpen(true);
  }, []);

  const handlePickerConfirm = useCallback((selected) => {
    pickerMeta.setter(mapPersonLine(selected));
    setPickerOpen(false);
  }, [pickerMeta]);

  const enabledExpenseColumns = useMemo(
    () => normalizeExpenseColumnTemplateColumns(expenseColumnTemplateColumns).filter((c) => c.enabled !== false),
    [expenseColumnTemplateColumns]
  );

  const getExpenseCellValue = useCallback((row, col) => {
    if (col.key === 'expenseDate') return row?.expenseDate || '';
    if (col.key === 'amount') return row?.amount || '';
    if (col.key === 'category') return row?.category || '';
    if (col.key === 'content') return row?.content || '';
    if (col.key === 'user') return row?.user || '';
    if (col.key === 'note') return row?.note || '';
    return row?.customValues?.[col.key] || '';
  }, []);

  const buildPayload = useCallback(
    (submit) => {
      const fd = { ...formData };
      if (docType === 'vacation') {
        fd.days = fd.days === '' ? null : Number(fd.days);
      }
      if (docType === 'expense') {
        fd.items = getExpenseItems(fd).map((row) => ({
          expenseDate: toExpenseDateTimeValue(row.expenseDate) || null,
          category: String(row.category || '').trim(),
          content: String(row.content || '').trim(),
          amount: row.amount === '' ? 0 : parseNumber(row.amount),
          user: String(row.user || '').trim(),
          note: String(row.note || '').trim(),
          customValues: (() => {
            const out = {};
            enabledExpenseColumns.forEach((col) => {
              if (['expenseDate', 'amount', 'category', 'content', 'user', 'note'].includes(col.key)) return;
              const raw = String(row?.customValues?.[col.key] || '').trim();
              if (!raw) return;
              out[col.key] = col.type === 'amount' ? formatNumberInput(raw) : raw;
            });
            return out;
          })()
        }));
      } else if (docType === 'quotation') {
        fd.amount = fd.amount === '' ? 0 : parseNumber(fd.amount);
      }
      return {
        docType,
        title: title.trim(),
        memo: memo.trim(),
        formData: fd,
        approvalLine,
        agreementLine,
        referenceLine,
        submit
      };
    },
    [agreementLine, approvalLine, docType, enabledExpenseColumns, formData, memo, referenceLine, title]
  );

  const save = useCallback(
    async (submit) => {
      setError('');
      if (submit && approvalLine.length === 0) {
        setError('결재선을 1명 이상 지정해 주세요.');
        return;
      }
      if (submit && docType === 'expense') {
        const rows = getExpenseItems(formData);
        for (let i = 0; i < rows.length; i += 1) {
          const row = rows[i];
          const missing = enabledExpenseColumns.find((col) => col.required && !String(getExpenseCellValue(row, col) || '').trim());
          if (missing) {
            setError(`${i + 1}행 "${missing.label}"은(는) 필수 입력입니다.`);
            return;
          }
        }
      }
      setBusy(true);
      try {
        const payload = buildPayload(submit);
        const isEdit = Boolean(editDoc?._id);
        const url = isEdit ? `${API_BASE}/approvals/${editDoc._id}` : `${API_BASE}/approvals`;
        const method = isEdit ? 'PATCH' : 'POST';
        let res = await fetch(url, {
          method,
          headers: getAuthHeader(),
          body: JSON.stringify(isEdit ? { ...payload, submit: undefined } : payload)
        });
        let json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || '저장하지 못했습니다.');

        if (isEdit && submit) {
          res = await fetch(`${API_BASE}/approvals/${editDoc._id}/submit`, crmFetchInit({ method: 'POST' }));
          json = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(json.error || '상신하지 못했습니다.');
        }

        onSaved?.(json);
        onClose?.();
      } catch (e) {
        setError(e.message || '저장하지 못했습니다.');
      } finally {
        setBusy(false);
      }
    },
    [approvalLine.length, buildPayload, docType, editDoc, enabledExpenseColumns, formData, getExpenseCellValue, onClose, onSaved]
  );

  const vacationTimeDisplay = useMemo(
    () => (docType === 'vacation' ? formatVacationTimeDisplay(formData) : ''),
    [docType, formData]
  );

  const [profileContact, setProfileContact] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/auth/me`, crmFetchInit())
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.user) return;
        setProfileContact({
          phone: String(data.user.phone || '').trim(),
          email: String(data.user.email || '').trim(),
          department: String(data.user.companyDepartment || '').trim()
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const myUserId = String(currentUser?._id || currentUser?.id || '');
  const drafterName = currentUser?.name || currentUser?.email || profileContact?.email || '—';
  const drafterDeptRaw =
    currentUser?.companyDepartment || currentUser?.department || profileContact?.department || '';
  const drafterDept = useMemo(() => {
    const label = resolveDeptDisplayLabel(drafterDeptRaw, organizationChart, currentUser);
    return label || '—';
  }, [currentUser, drafterDeptRaw, organizationChart]);
  const drafterContact = useMemo(() => {
    if (editDoc?.drafterPhone || editDoc?.drafterEmail) {
      return {
        phone: String(editDoc.drafterPhone || '').trim(),
        email: String(editDoc.drafterEmail || '').trim()
      };
    }
    const fromUser = {
      phone: String(currentUser?.phone || profileContact?.phone || '').trim(),
      email: String(currentUser?.email || profileContact?.email || '').trim()
    };
    if (fromUser.phone && fromUser.email) return fromUser;
    const me = teamMembers.find((m) => String(m.userId) === myUserId);
    return {
      phone: fromUser.phone || String(me?.phone || '').trim(),
      email: fromUser.email || String(me?.email || '').trim()
    };
  }, [currentUser, editDoc?.drafterEmail, editDoc?.drafterPhone, myUserId, profileContact, teamMembers]);
  const draftDateLabel = formatDraftDate();
  const draftDateLong = formatDraftDateLong();
  const draftShortMmDd = (() => {
    const d = new Date();
    return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
  })();
  const docTitleLabel = DOC_TYPE_TITLE[docType] || '결재 문서';
  const signName = drafterName;

  const addExpenseLine = useCallback(() => {
    const today = todayDateIsoText();
    const seed = emptyExpenseLine();
    enabledExpenseColumns.forEach((col) => {
      if (col.type !== 'date') return;
      if (col.key === 'expenseDate') {
        seed.expenseDate = seed.expenseDate || today;
        return;
      }
      seed.customValues = { ...(seed.customValues || {}), [col.key]: today };
    });
    enabledExpenseColumns.forEach((col) => {
      if (col.type !== 'text') return;
      const first = Array.isArray(col.allowedValues) && col.allowedValues.length ? col.allowedValues[0] : '';
      if (!first) return;
      if (col.key === 'category') {
        seed.category = first;
      } else if (col.key === 'content') {
        seed.content = first;
      } else if (col.key === 'user') {
        seed.user = first;
      } else if (col.key === 'note') {
        seed.note = first;
      } else {
        seed.customValues = { ...(seed.customValues || {}), [col.key]: first };
      }
    });
    setFormData((prev) => ({
      ...prev,
      items: [...getExpenseItems(prev), seed]
    }));
  }, [enabledExpenseColumns]);

  const handleImportExpenseItems = useCallback((importedItems) => {
    if (!Array.isArray(importedItems) || importedItems.length === 0) return;
    setFormData((prev) => {
      const current = getExpenseItems(prev);
      const isCurrentEmpty =
        current.length === 1
        && !String(current[0]?.expenseDate || '').trim()
        && !String(current[0]?.amount || '').trim()
        && !String(current[0]?.category || '').trim()
        && !String(current[0]?.content || '').trim()
        && !String(current[0]?.user || '').trim()
        && !String(current[0]?.note || '').trim();
      const nextItems = isCurrentEmpty ? importedItems : [...current, ...importedItems];
      return { ...prev, items: nextItems };
    });
  }, []);

  const saveExpenseColumnTemplate = useCallback(async (nextColumns) => {
    setExpenseColumnTemplateSaving(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/companies/expense-line-template`, {
        method: 'PATCH',
        headers: getAuthHeader(),
        credentials: 'include',
        body: JSON.stringify({ columns: nextColumns })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || '지출 컬럼 템플릿을 저장하지 못했습니다.');
      setExpenseColumnTemplateColumns(normalizeExpenseColumnTemplateColumns(json?.columns || nextColumns));
      setExpenseColumnTemplateOpen(false);
    } catch (e) {
      setError(e?.message || '지출 컬럼 템플릿을 저장하지 못했습니다.');
    } finally {
      setExpenseColumnTemplateSaving(false);
    }
  }, []);

  const expenseItems = useMemo(
    () => (docType === 'expense' ? getExpenseItems(formData) : []),
    [docType, formData]
  );

  const typeFields = () => {
    if (docType === 'vacation') {
      const partial = isPartialDayLeave(formData.leaveType);
      return (
        <>
          <ApprovalSheetPairRow>
            <ApprovalSheetPair label="휴가 종류">
              <select className="approval-form-select" value={formData.leaveType} onChange={(e) => patchForm('leaveType', e.target.value)}>
                {LEAVE_TYPES.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </ApprovalSheetPair>
            <ApprovalSheetPair label="일수">
              <span className="approval-sheet-field">{formatVacationDaysLabel(formData.days)}</span>
            </ApprovalSheetPair>
          </ApprovalSheetPairRow>
          <ApprovalSheetPairRow wide={!partial}>
            <ApprovalSheetPair label={partial ? '휴가일' : '휴가 기간'}>
              <ApprovalSheetCellStack>
                <div className="approval-form-date-range">
                  <DateTextInput
                    value={formData.startDate}
                    onChange={(next) => patchForm('startDate', next)}
                    onBlur={(e) => patchForm('startDate', toDateInputValue(e.target.value) || normalizeDateTypingValue(e.target.value))}
                  />
                  {!partial ? (
                    <>
                      <span className="approval-form-date-sep">~</span>
                      <DateTextInput
                        value={formData.endDate}
                        onChange={(next) => patchForm('endDate', next)}
                        onBlur={(e) => patchForm('endDate', toDateInputValue(e.target.value) || normalizeDateTypingValue(e.target.value))}
                      />
                    </>
                  ) : null}
                </div>
                {!partial ? <p className="approval-form-days-note">시작·종료일 기준 일수가 자동 계산됩니다.</p> : null}
              </ApprovalSheetCellStack>
            </ApprovalSheetPair>
            {partial ? (
              <ApprovalSheetPair label={formData.leaveType === 'half' ? '반차 시간' : '반반차 시간'}>
                <ApprovalSheetCellStack>
                  <select
                    className="approval-form-select"
                    value={formData.leaveType === 'half' ? (formData.halfPeriod || 'am') : (formData.quarterPeriod || 'am1')}
                    onChange={(e) => patchForm(formData.leaveType === 'half' ? 'halfPeriod' : 'quarterPeriod', e.target.value)}
                  >
                    {(formData.leaveType === 'half' ? HALF_PERIOD_OPTIONS : QUARTER_PERIOD_OPTIONS).map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  {vacationTimeDisplay ? <p className="approval-form-time-hint">휴가 시간: {vacationTimeDisplay}</p> : null}
                </ApprovalSheetCellStack>
              </ApprovalSheetPair>
            ) : null}
          </ApprovalSheetPairRow>
          <ApprovalSheetRow label="휴가 사유">
            <textarea className="approval-form-textarea" value={formData.reason || ''} onChange={(e) => patchForm('reason', e.target.value)} placeholder="휴가 사유를 구체적으로 입력해 주세요." rows={4} />
          </ApprovalSheetRow>
        </>
      );
    }
    if (docType === 'quotation') {
      return (
        <>
          <ApprovalSheetRow label="고객사/고객">
            <input type="text" className="approval-form-input" value={formData.customerName || ''} onChange={(e) => patchForm('customerName', e.target.value)} />
          </ApprovalSheetRow>
          <ApprovalSheetRow label="견적 금액">
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              className="approval-form-input approval-form-input--amount"
              value={formData.amount ?? ''}
              onChange={(e) => patchForm('amount', formatNumberInput(e.target.value))}
              placeholder="0"
            />
          </ApprovalSheetRow>
          <ApprovalSheetRow label="유효기간">
            <DateTextInput
              value={formData.validUntil}
              onChange={(next) => patchForm('validUntil', next)}
              onBlur={(e) => patchForm('validUntil', toDateInputValue(e.target.value) || normalizeDateTypingValue(e.target.value))}
            />
          </ApprovalSheetRow>
          <ApprovalSheetRow label="품목/내용">
            <textarea className="approval-form-textarea" value={formData.productSummary || ''} onChange={(e) => patchForm('productSummary', e.target.value)} rows={4} />
          </ApprovalSheetRow>
        </>
      );
    }
    return (
      <>
        <ApprovalSheetRow label="품의 제목">
          <input type="text" className="approval-form-input" value={formData.subject || ''} onChange={(e) => patchForm('subject', e.target.value)} />
        </ApprovalSheetRow>
        <ApprovalSheetRow label="품의 내용">
          <textarea className="approval-form-textarea" value={formData.summary || ''} onChange={(e) => patchForm('summary', e.target.value)} rows={4} />
        </ApprovalSheetRow>
        <ApprovalSheetRow label="기대 효과">
          <textarea className="approval-form-textarea" value={formData.expectedEffect || ''} onChange={(e) => patchForm('expectedEffect', e.target.value)} rows={3} />
        </ApprovalSheetRow>
      </>
    );
  };

  return (
    <>
      <div className="approval-form-overlay" role="presentation">
        <div className="approval-form-panel" role="dialog" aria-modal="true" aria-labelledby="approval-form-title">
          <div className="approval-form-topbar">
            <div className="approval-form-topbar-left">
              <p className="approval-form-topbar-title">Nexvia CRM</p>
              <span className="approval-form-topbar-divider" aria-hidden />
              <span className="approval-form-topbar-sub">전자결재 작성</span>
            </div>
            <button type="button" className="approval-form-close" onClick={onClose} disabled={busy} aria-label="닫기">
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>

          <div className={`approval-form-body${docType === 'expense' ? ' approval-form-body--expense' : ''}`}>
            {error ? <p className="approval-form-error">{error}</p> : null}

            {!editDoc ? (
              <div className="approval-form-type-row">
                {DOC_TYPES.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    className={`approval-form-type-btn${docType === t.key ? ' is-active' : ''}`}
                    onClick={() => handleTypeChange(t.key)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            ) : null}

            <div className={`approval-form-doc${docType === 'expense' ? ' approval-form-doc--expense-sticky' : ''}`}>
              <div className="approval-form-doc-glow" aria-hidden />

              <div className="approval-doc-corner-meta">
                <span className="approval-doc-corner-date">
                  <span className="approval-doc-corner-label">기안일</span>
                  {draftDateLabel}
                </span>
                <span className="approval-doc-corner-docno">
                  <span className="approval-doc-corner-label">문서번호</span>
                  {editDoc?.docNumber || docNumberPreview || '부여 중…'}
                </span>
              </div>

              <div className="approval-form-doc-title-wrap">
                <h2 id="approval-form-title" className="approval-form-doc-title">{docTitleLabel}</h2>
                <div className="approval-form-doc-title-bar" aria-hidden />
              </div>

              <ApprovalRouteBoard
                drafterName={drafterName}
                draftShortMmDd={draftShortMmDd}
                approvalLine={approvalLine}
                agreementLine={agreementLine}
                referenceLine={referenceLine}
                organizationChart={organizationChart}
                editable
                pickDisabled={busy}
                onPickLine={openPicker}
              />

              <div className="approval-form-meta-block approval-doc-meta-sheet">
                <div className="approval-doc-meta-sheet-head">기안 정보</div>
                <div className="approval-form-meta-list">
                  <div className="approval-form-meta-row">
                    <span className="approval-form-meta-label">기안자</span>
                    <span className="approval-form-meta-value">{drafterName}</span>
                    <span className="approval-form-meta-label">기안부서</span>
                    <span className="approval-form-meta-value">{drafterDept}</span>
                  </div>
                  <div className="approval-form-meta-row">
                    <span className="approval-form-meta-label">연락처</span>
                    <span className="approval-form-meta-value">{drafterContact.phone || '—'}</span>
                    <span className="approval-form-meta-label">이메일</span>
                    <span className="approval-form-meta-value">{drafterContact.email || '—'}</span>
                  </div>
                  {docType === 'expense' ? (
                    <div className="approval-form-meta-row approval-form-meta-row--notes">
                      <span className="approval-form-meta-label">특이사항</span>
                      <span className="approval-form-meta-value approval-form-meta-value--notes">
                        <textarea
                          className="approval-form-textarea approval-form-meta-notes-textarea"
                          value={memo}
                          onChange={(e) => setMemo(e.target.value)}
                          placeholder="지출 결의서 특이사항을 입력해 주세요. (선택)"
                          rows={2}
                        />
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>

              <section className={`approval-form-section${docType === 'expense' ? ' approval-form-section--expense' : ''}`}>
                <ApprovalContentSheet
                  title={DOC_TYPE_SECTION[docType] || '신청 내역'}
                  className={docType === 'expense' ? 'approval-sheet--expense-sticky' : ''}
                  headerAction={
                    docType === 'expense' ? (
                      <div className="approval-sheet-head-actions">
                        <button
                          type="button"
                          className="approval-sheet-head-add"
                          onClick={() => setExpenseColumnTemplateOpen(true)}
                          disabled={busy}
                          title="지출 컬럼 설정"
                          aria-label="지출 컬럼 설정"
                        >
                          <span className="material-symbols-outlined">tune</span>
                        </button>
                        <button
                          type="button"
                          className="approval-sheet-head-add"
                          onClick={() => setExpenseExcelOpen(true)}
                          disabled={busy}
                          title="엑셀 매핑 가져오기"
                          aria-label="엑셀 매핑 가져오기"
                        >
                          <span className="material-symbols-outlined">upload_file</span>
                        </button>
                        <button
                          type="button"
                          className="approval-sheet-head-add"
                          onClick={addExpenseLine}
                          disabled={busy}
                          title="지출 내역 추가"
                          aria-label="지출 내역 추가"
                        >
                          <span className="material-symbols-outlined">add</span>
                        </button>
                      </div>
                    ) : null
                  }
                >
                  {docType === 'expense' ? (
                    <ExpenseLinesEditor
                      items={expenseItems}
                      onItemsChange={(items) => setFormData((prev) => ({ ...prev, items }))}
                      disabled={busy}
                      columnTemplateColumns={expenseColumnTemplateColumns}
                    />
                  ) : (
                    <>
                      <ApprovalSheetRow label="문서 제목">
                        <input type="text" className="approval-form-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="비우면 자동 생성됩니다" />
                      </ApprovalSheetRow>
                      {typeFields()}
                      <ApprovalSheetRow label="비고">
                        <textarea className="approval-form-textarea" value={memo} onChange={(e) => setMemo(e.target.value)} rows={2} placeholder="추가 참고 사항 (선택)" />
                      </ApprovalSheetRow>
                    </>
                  )}
                </ApprovalContentSheet>
              </section>

              <div className="approval-form-declaration">
                <p>{DOC_TYPE_DECLARATION[docType]}</p>
                <p className="approval-form-declaration-date">{draftDateLong}</p>
                <p className="approval-form-declaration-sign">신청인 : {signName}</p>
              </div>
            </div>
          </div>

          <div className="approval-form-foot">
            <button type="button" className="approval-form-btn-draft" onClick={() => save(false)} disabled={busy}>
              {busy ? '저장 중…' : '임시저장'}
            </button>
            <button type="button" className="approval-form-btn-cancel" onClick={onClose} disabled={busy}>
              취소
            </button>
            <button type="button" className="approval-form-btn-submit" onClick={() => save(true)} disabled={busy}>
              <span>{busy ? '처리 중…' : '결재 요청'}</span>
              <span className="material-symbols-outlined">send</span>
            </button>
          </div>
        </div>
      </div>

      {pickerOpen ? (
        <ParticipantModal
          teamMembers={teamMembers}
          selected={pickerSelected}
          currentUser={currentUser}
          title={pickerMeta.title}
          bulkAddLabel={pickerMeta.bulkAddLabel}
          onConfirm={handlePickerConfirm}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}

      {expenseExcelOpen && docType === 'expense' ? (
        <ApprovalExpenseExcelMappingModal
          open={expenseExcelOpen}
          saving={busy}
          onClose={() => setExpenseExcelOpen(false)}
          onImport={handleImportExpenseItems}
          columnTemplateColumns={expenseColumnTemplateColumns}
        />
      ) : null}

      {expenseColumnTemplateOpen && docType === 'expense' ? (
        <ApprovalExpenseColumnTemplateModal
          open={expenseColumnTemplateOpen}
          columns={expenseColumnTemplateColumns}
          saving={expenseColumnTemplateSaving}
          onClose={() => setExpenseColumnTemplateOpen(false)}
          onSave={saveExpenseColumnTemplate}
        />
      ) : null}
    </>
  );
}
