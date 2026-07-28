import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchSalesDocument,
  fetchSalesList,
  fetchSalesHistory,
  fetchSalesPicker,
  fetchSalesOrderRemaining,
  fetchInvoiceSettlements,
  fetchOpenInvoices,
  createSalesDocument,
  updateSalesDocument,
  deleteSalesDocument,
  runSalesCommand,
  newIdempotencyKey,
  formatMoneyDisplay,
  formatDateDisplay,
  formatDateTimeDisplay,
  toDateInputValue
} from '@/lib/erp-sales-api';
import {
  availableCommands,
  labelOf,
  statusTone,
  AR_STATUS_LABELS,
  FULFILLMENT_STATUS_LABELS,
  INVOICE_PROGRESS_LABELS,
  RECEIPT_METHOD_LABELS,
  CREDIT_REASON_LABELS
} from '../erp-sales-config';
import ErpSalesLineEditor, { emptyLine, toFormLines, toPayloadLines } from './erp-sales-line-editor';
import './erp-sales-document-modal.css';

/**
 * ERP 판매 문서 상세·등록 모달.
 *
 * 프로젝트 규칙:
 *  - 오버레이 클릭으로 닫히지 않습니다.
 *  - URL의 id로 단건 조회하므로 새로고침·딥링크에서도 정상 표시됩니다.
 *  - 저장·확정·취소에는 스피너가 붙고 중복 제출을 막습니다.
 *  - 문서를 새로 만드는 명령(개정·주문전환·출고·매출 생성)은 같은 사용자 동작 동안
 *    같은 Idempotency-Key 를 재사용해 콜드 스타트 재시도가 중복 문서를 만들지 않게 합니다.
 */

const ACTION_LABELS = {
  create: '등록',
  update: '수정',
  delete: '삭제',
  approve: '승인',
  reject: '반려',
  cancel: '취소',
  sync: 'CRM 가져오기'
};

const PICKER_PATHS = {
  'business-partners': 'business-partners',
  items: 'items',
  'tax-codes': 'tax-codes',
  'payment-terms': 'payment-terms',
  warehouses: 'warehouses'
};

function initialForm(fields, record) {
  const out = {};
  for (const field of fields) {
    const raw = record ? record[field.key] : undefined;
    if (field.transient || raw === undefined || raw === null || raw === '') {
      out[field.key] = field.defaultValue !== undefined ? field.defaultValue : '';
      continue;
    }
    out[field.key] = field.type === 'date' ? toDateInputValue(raw) : String(raw);
  }
  /** 신규 문서의 일자 기본값은 오늘 */
  if (!record) {
    for (const field of fields) {
      if (field.type === 'date' && !out[field.key] && field.key !== 'validUntilDate') {
        out[field.key] = toDateInputValue(new Date());
      }
    }
  }
  return out;
}

function StatusBadge({ value, labels }) {
  if (!value) return null;
  return (
    <span className={`erp-sales-badge is-${statusTone(value)}`}>{labelOf(labels, value)}</span>
  );
}

export default function ErpSalesDocumentModal({
  documentConfig,
  recordId,
  canWrite,
  canDelete,
  onClose,
  onSaved,
  onDeleted,
  onOpenTrace
}) {
  const isEdit = Boolean(recordId);
  /** 렌더마다 새 배열이 생기면 선택기 로딩 effect가 반복되므로 참조를 고정합니다 */
  const fields = useMemo(() => documentConfig.fields || [], [documentConfig]);

  const [record, setRecord] = useState(null);
  const [form, setForm] = useState(() => initialForm(fields, null));
  const [formLines, setFormLines] = useState(() => (documentConfig.hasLines ? [emptyLine()] : []));
  const [allocations, setAllocations] = useState({});

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [runningCommand, setRunningCommand] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [conflictLatest, setConflictLatest] = useState(null);

  const [pickers, setPickers] = useState({});
  const [invoiceOptions, setInvoiceOptions] = useState([]);
  const [openInvoices, setOpenInvoices] = useState([]);

  const [pendingCommand, setPendingCommand] = useState(null);
  const [reasonText, setReasonText] = useState('');

  const [panel, setPanel] = useState('');
  const [panelForm, setPanelForm] = useState({});
  const [panelLines, setPanelLines] = useState([]);
  const [panelLoading, setPanelLoading] = useState(false);

  const [settlements, setSettlements] = useState(null);
  const [settlementsOpen, setSettlementsOpen] = useState(false);

  const [history, setHistory] = useState([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);

  /** 같은 사용자 동작에 대해서는 같은 멱등키를 재사용합니다 (성공하면 폐기) */
  const idempotencyKeysRef = useRef({});

  const busy = saving || deleting || Boolean(runningCommand);
  const status = record ? record.status : 'draft';
  const statusEditable = !isEdit || (documentConfig.editableStatuses || []).includes(status);
  /** 문서별 추가 조건 (예: 판매주문에서 생성된 매출은 수정하지 않음) */
  const contentEditable =
    typeof documentConfig.formEditableWhen !== 'function' || documentConfig.formEditableWhen(record);
  const editableStatus = statusEditable && contentEditable;
  const canEditForm = canWrite && editableStatus;
  const linesEditable = documentConfig.hasLines && documentConfig.linesEditable !== false && canEditForm;

  const takeIdempotencyKey = useCallback((name) => {
    if (!idempotencyKeysRef.current[name]) idempotencyKeysRef.current[name] = newIdempotencyKey();
    return idempotencyKeysRef.current[name];
  }, []);

  const dropIdempotencyKey = useCallback((name) => {
    delete idempotencyKeysRef.current[name];
  }, []);

  const applyRecord = useCallback(
    (data) => {
      setRecord(data);
      setForm(initialForm(fields, data));
      if (documentConfig.hasLines) {
        const lines = toFormLines(data);
        setFormLines(lines.length ? lines : [emptyLine()]);
      }
      if (documentConfig.hasAllocations) {
        const next = {};
        for (const allocation of data.allocations || []) {
          next[String(allocation.salesInvoiceId)] = String(allocation.amount);
        }
        setAllocations(next);
      }
    },
    [fields, documentConfig.hasLines, documentConfig.hasAllocations]
  );

  /** URL id 기준 단건 조회 — 목록 상태에 의존하지 않습니다 */
  useEffect(() => {
    if (!isEdit) {
      setRecord(null);
      setForm(initialForm(fields, null));
      setFormLines(documentConfig.hasLines ? [emptyLine()] : []);
      setAllocations({});
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    fetchSalesDocument(documentConfig.path, recordId)
      .then((data) => {
        if (!cancelled) applyRecord(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || '문서를 불러오지 못했습니다.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentConfig.path, recordId, isEdit]);

  /** 선택기(거래처·품목·세금구분·결제조건·창고) — 화면에 필요한 것만 */
  useEffect(() => {
    const needed = new Set(
      fields.filter((f) => f.type === 'ref').map((f) => f.refPath)
    );
    if (documentConfig.hasLines) {
      needed.add(PICKER_PATHS.items);
      needed.add(PICKER_PATHS['tax-codes']);
    }
    /** 후속 문서 생성 패널이 쓰는 선택기 — 폼 필드에는 없지만 미리 받아 둡니다 */
    if (documentConfig.key === 'quotations') needed.add(PICKER_PATHS['payment-terms']);
    if (documentConfig.key === 'sales-orders') needed.add(PICKER_PATHS.warehouses);
    if (needed.size === 0) return undefined;

    let cancelled = false;
    Promise.all(
      [...needed].map((path) =>
        fetchSalesPicker(path)
          .then((items) => [path, items])
          .catch(() => [path, []])
      )
    ).then((entries) => {
      if (!cancelled) setPickers(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [fields, documentConfig.hasLines, documentConfig.key]);

  /** 대변전표 대상 매출 — 거래처를 고르면 확정된 매출만 보여줍니다 */
  const needsInvoicePicker = fields.some((f) => f.type === 'invoiceRef');
  useEffect(() => {
    if (!needsInvoicePicker || !form.partnerId) {
      setInvoiceOptions([]);
      return undefined;
    }
    let cancelled = false;
    fetchSalesList('sales-invoices', {
      partnerId: form.partnerId,
      status: 'issued',
      limit: 100
    })
      .then((data) => {
        if (!cancelled) setInvoiceOptions(Array.isArray(data.items) ? data.items : []);
      })
      .catch(() => {
        if (!cancelled) setInvoiceOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [needsInvoicePicker, form.partnerId]);

  /** 수금 배부 후보 — 거래처·통화가 정해져야 조회할 수 있습니다 */
  useEffect(() => {
    if (!documentConfig.hasAllocations || !form.partnerId) {
      setOpenInvoices([]);
      return undefined;
    }
    let cancelled = false;
    fetchOpenInvoices({ partnerId: form.partnerId, currency: form.currency || '' })
      .then((data) => {
        if (!cancelled) setOpenInvoices(Array.isArray(data.items) ? data.items : []);
      })
      .catch(() => {
        if (!cancelled) setOpenInvoices([]);
      });
    return () => {
      cancelled = true;
    };
  }, [documentConfig.hasAllocations, form.partnerId, form.currency]);

  const loadHistory = useCallback(async () => {
    if (!isEdit) return;
    setHistoryLoading(true);
    try {
      const data = await fetchSalesHistory(documentConfig.path, recordId, { limit: 20 });
      setHistory(Array.isArray(data.items) ? data.items : []);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [documentConfig.path, recordId, isEdit]);

  const toggleHistory = () => {
    const next = !historyOpen;
    setHistoryOpen(next);
    if (next && history.length === 0) void loadHistory();
  };

  const toggleSettlements = async () => {
    const next = !settlementsOpen;
    setSettlementsOpen(next);
    if (next && !settlements) {
      try {
        setSettlements(await fetchInvoiceSettlements(recordId));
      } catch (err) {
        setError(err.message || '정산 내역을 불러오지 못했습니다.');
      }
    }
  };

  const setField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  /* ---------------- 저장 ---------------- */

  const buildPayload = () => {
    const payload = {};
    for (const field of fields) {
      const value = form[field.key];
      payload[field.key] = value == null ? '' : String(value).trim();
    }
    if (documentConfig.hasLines && documentConfig.linesEditable !== false) {
      payload.lines = toPayloadLines(formLines);
    }
    if (documentConfig.hasAllocations) {
      payload.allocations = Object.entries(allocations)
        .filter(([, amount]) => amount !== '' && Number(amount) > 0)
        .map(([salesInvoiceId, amount]) => ({ salesInvoiceId, amount: String(amount).trim() }));
    }
    return payload;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (busy || !canEditForm) return;

    setError('');
    setNotice('');
    setConflictLatest(null);
    setSaving(true);
    try {
      const payload = buildPayload();
      if (isEdit) {
        payload.version = record ? record.version || 0 : 0;
        const saved = await updateSalesDocument(documentConfig.path, recordId, payload);
        applyRecord(saved);
        if (historyOpen) void loadHistory();
        setNotice('저장했습니다.');
        onSaved(saved, { created: false });
      } else {
        const saved = await createSalesDocument(documentConfig.path, payload);
        onSaved(saved, { created: true });
        onClose();
        return;
      }
    } catch (err) {
      setError(err.message || '저장에 실패했습니다.');
      if (err.code === 'VERSION_CONFLICT' && err.latest) setConflictLatest(err.latest);
    } finally {
      setSaving(false);
    }
  };

  const applyLatest = () => {
    if (!conflictLatest) return;
    applyRecord(conflictLatest);
    setConflictLatest(null);
    setError('');
    setNotice('최신 내용을 불러왔습니다. 다시 확인한 뒤 저장해 주세요.');
  };

  const handleDelete = async () => {
    if (busy || !canDelete || !isEdit) return;
    if (!window.confirm(`이 ${documentConfig.label} 문서를 삭제할까요? 삭제 이력은 감사 로그에 남습니다.`)) return;

    setError('');
    setDeleting(true);
    try {
      await deleteSalesDocument(documentConfig.path, recordId);
      onDeleted();
      onClose();
    } catch (err) {
      setError(err.message || '삭제에 실패했습니다.');
    } finally {
      setDeleting(false);
    }
  };

  /* ---------------- 상태 명령 ---------------- */

  const executeCommand = async (command, reason) => {
    if (busy) return;
    setError('');
    setNotice('');
    setRunningCommand(command.key);
    const keyName = `command:${command.key}`;
    try {
      const body = command.reason ? { reason: String(reason || '').trim() } : {};
      const options = command.idempotent ? { idempotencyKey: takeIdempotencyKey(keyName) } : {};
      const result = await runSalesCommand(documentConfig.path, recordId, command.key, body, options);
      if (command.idempotent) dropIdempotencyKey(keyName);

      if (command.creates) {
        /** 개정처럼 새 문서를 만드는 명령 — 원본을 다시 읽고 목록은 재조회합니다 */
        setNotice(`새 문서 ${result.code || ''} 을(를) 만들었습니다.`);
        const refreshed = await fetchSalesDocument(documentConfig.path, recordId);
        applyRecord(refreshed);
        onSaved(refreshed, { created: true });
      } else {
        applyRecord(result);
        onSaved(result, { created: false });
        setNotice(`${command.label} 처리했습니다.`);
      }
      if (historyOpen) void loadHistory();
      /** 실패하면 입력한 사유를 잃지 않도록 성공했을 때만 사유 패널을 닫습니다 */
      setPendingCommand(null);
      setReasonText('');
    } catch (err) {
      setError(err.message || '요청을 처리하지 못했습니다.');
    } finally {
      setRunningCommand('');
    }
  };

  const startCommand = (command) => {
    if (busy) return;
    setError('');
    setNotice('');
    if (command.reason) {
      setPendingCommand(command);
      setReasonText('');
      return;
    }
    /** 확정·취소는 되돌리기 어려우므로 한 번 더 확인합니다 */
    if (command.confirm && !window.confirm(command.confirm)) return;
    void executeCommand(command);
  };

  const submitPendingCommand = () => {
    if (!pendingCommand) return;
    const reason = reasonText.trim();
    if (pendingCommand.reasonRequired && !reason) {
      setError(`${pendingCommand.reasonLabel || '사유'}를 입력해 주세요.`);
      return;
    }
    if (!window.confirm(`${pendingCommand.label} 처리할까요? 되돌릴 수 없습니다.`)) return;
    void executeCommand(pendingCommand, reason);
  };

  /* ---------------- 후속 문서 생성 패널 ---------------- */

  const openPanel = async (mode) => {
    setError('');
    setNotice('');
    /** 패널을 새로 열 때마다 새 사용자 동작이므로 이전 멱등키를 버립니다 */
    dropIdempotencyKey(`panel:${mode}`);
    setPanel(mode);
    setPanelForm(
      mode === 'convert'
        ? { paymentTermId: '', requestedDeliveryDate: '', shippingAddress: record?.shippingAddress || '' }
        : mode === 'shipment'
          ? { warehouseId: '', carrier: '', trackingNumber: '', documentDate: toDateInputValue(new Date()) }
          : { dueDate: '', documentDate: toDateInputValue(new Date()) }
    );

    if (mode === 'convert') {
      setPanelLines([]);
      return;
    }

    setPanelLoading(true);
    try {
      const data = await fetchSalesOrderRemaining(recordId);
      const field = mode === 'shipment' ? 'remainingToShip' : 'remainingToInvoice';
      setPanelLines(
        (data.lines || [])
          .filter((line) => Number(line[field]) > 0)
          .map((line) => ({ ...line, input: String(line[field]) }))
      );
    } catch (err) {
      setError(err.message || '잔량 정보를 불러오지 못했습니다.');
      setPanelLines([]);
    } finally {
      setPanelLoading(false);
    }
  };

  const closePanel = () => {
    setPanel('');
    setPanelLines([]);
    setPanelForm({});
  };

  const setPanelField = (key, value) => {
    /** 입력이 바뀌면 같은 키로 다른 내용을 보내지 않도록 멱등키를 새로 발급합니다 */
    dropIdempotencyKey(`panel:${panel}`);
    setPanelForm((prev) => ({ ...prev, [key]: value }));
  };

  const setPanelLineInput = (lineNo, value) => {
    dropIdempotencyKey(`panel:${panel}`);
    setPanelLines((prev) => prev.map((line) => (line.lineNo === lineNo ? { ...line, input: value } : line)));
  };

  const submitPanel = async () => {
    if (busy || !canWrite) return;
    const keyName = `panel:${panel}`;
    setError('');
    setNotice('');
    setRunningCommand(`panel:${panel}`);
    try {
      if (panel === 'convert') {
        const order = await runSalesCommand(
          documentConfig.path,
          recordId,
          'convert-to-order',
          {
            paymentTermId: panelForm.paymentTermId || '',
            requestedDeliveryDate: panelForm.requestedDeliveryDate || '',
            shippingAddress: panelForm.shippingAddress || ''
          },
          { idempotencyKey: takeIdempotencyKey(keyName) }
        );
        dropIdempotencyKey(keyName);
        setNotice(`판매주문 ${order.code} 을(를) 만들었습니다. 판매주문 탭에서 확정해 주세요.`);
      } else {
        const lines = panelLines
          .filter((line) => line.input !== '' && Number(line.input) > 0)
          .map((line) => ({ salesOrderLineNo: line.lineNo, quantity: String(line.input).trim() }));
        if (lines.length === 0) throw new Error('보낼 수량이 없습니다. 한 줄 이상 수량을 입력해 주세요.');

        const command = panel === 'shipment' ? 'shipments' : 'invoices';
        const body =
          panel === 'shipment'
            ? {
                lines,
                warehouseId: panelForm.warehouseId || '',
                carrier: panelForm.carrier || '',
                trackingNumber: panelForm.trackingNumber || '',
                documentDate: panelForm.documentDate || ''
              }
            : { lines, dueDate: panelForm.dueDate || '', documentDate: panelForm.documentDate || '' };

        const created = await runSalesCommand(documentConfig.path, recordId, command, body, {
          idempotencyKey: takeIdempotencyKey(keyName)
        });
        dropIdempotencyKey(keyName);
        setNotice(
          panel === 'shipment'
            ? `출고 ${created.code} 초안을 만들었습니다. 출고 탭에서 확정해 주세요.`
            : `매출 ${created.code} 초안을 만들었습니다. 매출 탭에서 확정해 주세요.`
        );
      }

      const refreshed = await fetchSalesDocument(documentConfig.path, recordId);
      applyRecord(refreshed);
      onSaved(refreshed, { created: true });
      closePanel();
    } catch (err) {
      setError(err.message || '문서를 만들지 못했습니다.');
    } finally {
      setRunningCommand('');
    }
  };

  /* ---------------- 렌더 ---------------- */

  const commands = useMemo(() => availableCommands(documentConfig, record), [documentConfig, record]);

  const allocatedTotal = useMemo(() => {
    if (!documentConfig.hasAllocations) return 0;
    return Object.values(allocations).reduce((sum, amount) => {
      const n = Number(String(amount || '').replace(/,/g, ''));
      return Number.isFinite(n) ? sum + n : sum;
    }, 0);
  }, [allocations, documentConfig.hasAllocations]);

  const allocationRows = useMemo(() => {
    if (!documentConfig.hasAllocations) return [];
    const rows = [...openInvoices];
    const known = new Set(rows.map((row) => String(row._id)));
    for (const allocation of record?.allocations || []) {
      const id = String(allocation.salesInvoiceId);
      if (known.has(id)) continue;
      rows.push({
        _id: id,
        code: allocation.salesInvoiceCode || id,
        dueDate: null,
        currency: record?.currency,
        totalAmount: null,
        outstandingAmount: null,
        arStatus: ''
      });
    }
    return rows;
  }, [documentConfig.hasAllocations, openInvoices, record]);

  const renderField = (field) => {
    const value = form[field.key] ?? '';
    const id = `erp-sales-field-${field.key}`;
    const locked = field.lockAfterCreate && isEdit;
    const disabled = busy || !canEditForm || locked;

    let control = null;
    if (field.type === 'select') {
      control = (
        <select id={id} value={value} disabled={disabled} onChange={(e) => setField(field.key, e.target.value)}>
          {field.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      );
    } else if (field.type === 'ref') {
      const options = pickers[field.refPath] || [];
      control = (
        <select id={id} value={value} disabled={disabled} onChange={(e) => setField(field.key, e.target.value)}>
          <option value="">선택 안 함</option>
          {options.map((opt) => (
            <option key={opt._id} value={opt._id}>
              {opt.code} · {opt.name}
            </option>
          ))}
        </select>
      );
    } else if (field.type === 'invoiceRef') {
      const hasCurrent = invoiceOptions.some((opt) => String(opt._id) === String(value));
      control = (
        <select id={id} value={value} disabled={disabled} onChange={(e) => setField(field.key, e.target.value)}>
          <option value="">선택 안 함</option>
          {!hasCurrent && value ? (
            <option value={value}>{record?.salesInvoiceCode || '현재 연결된 매출'}</option>
          ) : null}
          {invoiceOptions.map((opt) => (
            <option key={opt._id} value={opt._id}>
              {opt.code} · {formatMoneyDisplay(opt.balanceAmount, opt.currency)} 잔액
            </option>
          ))}
        </select>
      );
    } else if (field.type === 'textarea') {
      control = (
        <textarea
          id={id}
          rows={3}
          value={value}
          disabled={disabled}
          placeholder={field.placeholder || ''}
          onChange={(e) => setField(field.key, e.target.value)}
        />
      );
    } else if (field.type === 'date') {
      control = (
        <input
          id={id}
          type="date"
          value={value}
          disabled={disabled}
          onChange={(e) => setField(field.key, e.target.value)}
        />
      );
    } else {
      control = (
        <input
          id={id}
          type="text"
          inputMode={field.type === 'money' || field.type === 'number' ? 'decimal' : undefined}
          autoComplete="off"
          value={value}
          disabled={disabled}
          placeholder={field.placeholder || ''}
          onChange={(e) => setField(field.key, e.target.value)}
        />
      );
    }

    return (
      <div key={field.key} className={`erp-sales-field ${field.full ? 'is-full' : ''}`}>
        <label htmlFor={id}>
          {field.label}
          {field.required ? <span className="erp-sales-required"> *</span> : null}
        </label>
        {control}
        {field.help ? <p className="erp-sales-help">{field.help}</p> : null}
      </div>
    );
  };

  const totals = record
    ? [
        { label: '공급가액 합계', value: record.subtotalAmount },
        { label: '할인 합계', value: record.discountTotalAmount },
        { label: '과세표준', value: record.netAmount },
        { label: '세액 합계', value: record.taxTotalAmount },
        { label: '문서 합계', value: record.totalAmount, strong: true }
      ]
    : [];

  return (
    /** 오버레이 클릭으로 닫지 않습니다 (프로젝트 규칙) */
    <div className="erp-sales-modal-overlay" role="presentation">
      <div
        className="erp-sales-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="erp-sales-modal-title"
      >
        <div className="erp-sales-modal-header">
          <div className="erp-sales-modal-heading">
            <h2 className="erp-sales-modal-title" id="erp-sales-modal-title">
              {isEdit ? `${documentConfig.label} 상세` : `${documentConfig.label} 등록`}
            </h2>
            <p className="erp-sales-modal-subtitle">
              {isEdit && record ? (
                <>
                  <span>{record.code}</span>
                  <StatusBadge value={record.status} labels={documentConfig.statusLabels} />
                  {record.arStatus ? <StatusBadge value={record.arStatus} labels={AR_STATUS_LABELS} /> : null}
                  {record.fulfillmentStatus ? (
                    <StatusBadge value={record.fulfillmentStatus} labels={FULFILLMENT_STATUS_LABELS} />
                  ) : null}
                  {record.invoiceStatus ? (
                    <StatusBadge value={record.invoiceStatus} labels={INVOICE_PROGRESS_LABELS} />
                  ) : null}
                  {record.revision > 1 ? <span className="erp-sales-chip">{record.revision}차 개정</span> : null}
                  {record.isLatestRevision === false ? (
                    <span className="erp-sales-chip">이전 개정본</span>
                  ) : null}
                </>
              ) : (
                <span>문서번호는 저장 시 자동으로 채번됩니다.</span>
              )}
            </p>
          </div>
          <button
            type="button"
            className="erp-sales-modal-close"
            onClick={onClose}
            aria-label="닫기"
            disabled={busy}
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {loading ? (
          <div className="erp-sales-modal-loading">
            <span className="erp-spinner erp-spinner--dark" aria-hidden />
            불러오는 중입니다…
          </div>
        ) : (
          <form className="erp-sales-modal-form" onSubmit={handleSubmit}>
            <div className="erp-sales-modal-body">
              {error ? (
                <div className="erp-sales-alert is-error" role="alert">
                  <span>{error}</span>
                  {conflictLatest ? (
                    <button type="button" className="btn-outline erp-sales-alert-action" onClick={applyLatest}>
                      최신 내용 불러오기
                    </button>
                  ) : null}
                </div>
              ) : null}
              {notice ? (
                <div className="erp-sales-alert is-notice" role="status">
                  {notice}
                </div>
              ) : null}

              {isEdit && !statusEditable ? (
                <p className="erp-sales-note">
                  {labelOf(documentConfig.statusLabels, status)} 상태라 내용을 수정할 수 없습니다. 아래 명령으로만
                  처리할 수 있습니다.
                </p>
              ) : isEdit && !contentEditable ? (
                <p className="erp-sales-note">{documentConfig.readOnlyNote}</p>
              ) : null}
              {!isEdit && documentConfig.createHint ? (
                <p className="erp-sales-note">{documentConfig.createHint}</p>
              ) : null}
              {isEdit && record?.salesOrderCode ? (
                <p className="erp-sales-note">근거 판매주문: {record.salesOrderCode}</p>
              ) : null}
              {isEdit && record?.cancelReason ? (
                <p className="erp-sales-note">취소 사유: {record.cancelReason}</p>
              ) : null}
              {isEdit && record?.rejectReason ? (
                <p className="erp-sales-note">반려 사유: {record.rejectReason}</p>
              ) : null}

              <div className="erp-sales-grid">{fields.map(renderField)}</div>

              {documentConfig.hasLines ? (
                <section className="erp-sales-section">
                  <h3 className="erp-sales-section-title">품목</h3>
                  <ErpSalesLineEditor
                    formLines={formLines}
                    serverLines={record?.lines}
                    readOnly={!linesEditable}
                    disabled={busy}
                    items={pickers[PICKER_PATHS.items] || []}
                    taxCodes={pickers[PICKER_PATHS['tax-codes']] || []}
                    currency={form.currency || record?.currency || 'KRW'}
                    onChange={setFormLines}
                  />
                </section>
              ) : null}

              {documentConfig.key === 'shipments' && record?.lines?.length ? (
                <section className="erp-sales-section">
                  <h3 className="erp-sales-section-title">출고 수량</h3>
                  <div className="erp-sales-scroll">
                    <table className="erp-sales-subtable">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>품목</th>
                          <th className="is-right">주문 라인</th>
                          <th className="is-right">출고 수량</th>
                        </tr>
                      </thead>
                      <tbody>
                        {record.lines.map((line) => (
                          <tr key={line.lineNo}>
                            <td>{line.lineNo}</td>
                            <td>{line.itemSnapshot?.name || line.description || '-'}</td>
                            <td className="is-right">{line.salesOrderLineNo}</td>
                            <td className="is-right">{formatMoneyDisplay(line.quantity)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="erp-sales-help">
                    수량은 수정할 수 없습니다. 잘못 만들었다면 출고를 취소하고 판매주문에서 다시 만들어 주세요.
                  </p>
                </section>
              ) : null}

              {documentConfig.hasAllocations ? (
                <section className="erp-sales-section">
                  <h3 className="erp-sales-section-title">수금 배부</h3>
                  {!form.partnerId ? (
                    <p className="erp-sales-help">거래처를 먼저 선택하면 미수 매출 목록이 표시됩니다.</p>
                  ) : allocationRows.length === 0 ? (
                    <p className="erp-sales-help">배부할 수 있는 미수 매출이 없습니다. 선수금으로 저장됩니다.</p>
                  ) : (
                    <div className="erp-sales-scroll">
                      <table className="erp-sales-subtable">
                        <thead>
                          <tr>
                            <th>매출번호</th>
                            <th>수금예정일</th>
                            <th className="is-right">매출액</th>
                            <th className="is-right">잔액</th>
                            <th className="is-right">배부액</th>
                          </tr>
                        </thead>
                        <tbody>
                          {allocationRows.map((row) => (
                            <tr key={row._id}>
                              <td>{row.code}</td>
                              <td>{formatDateDisplay(row.dueDate)}</td>
                              <td className="is-right">{formatMoneyDisplay(row.totalAmount)}</td>
                              <td className="is-right">
                                {formatMoneyDisplay(row.outstandingAmount)}
                                {row.outstandingAmount && canEditForm ? (
                                  <button
                                    type="button"
                                    className="erp-sales-mini-btn"
                                    disabled={busy}
                                    onClick={() =>
                                      setAllocations((prev) => ({
                                        ...prev,
                                        [row._id]: String(row.outstandingAmount)
                                      }))
                                    }
                                  >
                                    전액
                                  </button>
                                ) : null}
                              </td>
                              <td className="is-right">
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  autoComplete="off"
                                  aria-label={`${row.code} 배부액`}
                                  className="erp-sales-amount-input"
                                  value={allocations[row._id] || ''}
                                  disabled={busy || !canEditForm}
                                  onChange={(e) =>
                                    setAllocations((prev) => ({ ...prev, [row._id]: e.target.value }))
                                  }
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <p className="erp-sales-help">
                    배부 합계(참고) {formatMoneyDisplay(String(allocatedTotal), form.currency || 'KRW')} · 배부하지 않은
                    금액은 선수금으로 남습니다. 확정 금액은 저장 후 서버 계산 결과가 기준입니다.
                  </p>
                </section>
              ) : null}

              {isEdit && record && (record.totalAmount != null || record.receivedAmount != null) ? (
                <section className="erp-sales-section">
                  <h3 className="erp-sales-section-title">금액</h3>
                  <dl className="erp-sales-totals">
                    {documentConfig.hasAllocations ? (
                      <>
                        <div>
                          <dt>입금액</dt>
                          <dd>{formatMoneyDisplay(record.receivedAmount, record.currency)}</dd>
                        </div>
                        <div>
                          <dt>배부액</dt>
                          <dd>{formatMoneyDisplay(record.allocatedAmount, record.currency)}</dd>
                        </div>
                        <div>
                          <dt>선수금</dt>
                          <dd>{formatMoneyDisplay(record.unallocatedAmount, record.currency)}</dd>
                        </div>
                      </>
                    ) : (
                      totals.map((item) => (
                        <div key={item.label} className={item.strong ? 'is-strong' : undefined}>
                          <dt>{item.label}</dt>
                          <dd>{formatMoneyDisplay(item.value, record.currency)}</dd>
                        </div>
                      ))
                    )}
                    {record.balanceAmount != null ? (
                      <>
                        <div>
                          <dt>수금 누계</dt>
                          <dd>{formatMoneyDisplay(record.paidAmount, record.currency)}</dd>
                        </div>
                        <div>
                          <dt>대변 누계</dt>
                          <dd>{formatMoneyDisplay(record.creditedAmount, record.currency)}</dd>
                        </div>
                        <div className="is-strong">
                          <dt>채권 잔액</dt>
                          <dd>{formatMoneyDisplay(record.balanceAmount, record.currency)}</dd>
                        </div>
                      </>
                    ) : null}
                  </dl>
                </section>
              ) : null}

              {/* 후속 문서 생성 — 견적 전환 / 주문의 출고·매출 */}
              {isEdit && canWrite && documentConfig.key === 'quotations' && status === 'approved' ? (
                <section className="erp-sales-section">
                  <h3 className="erp-sales-section-title">판매주문 전환</h3>
                  {panel === 'convert' ? (
                    <div className="erp-sales-panel">
                      <div className="erp-sales-grid">
                        <div className="erp-sales-field">
                          <label htmlFor="erp-convert-term">결제조건</label>
                          <select
                            id="erp-convert-term"
                            value={panelForm.paymentTermId || ''}
                            disabled={busy}
                            onChange={(e) => setPanelField('paymentTermId', e.target.value)}
                          >
                            <option value="">선택 안 함</option>
                            {(pickers['payment-terms'] || []).map((opt) => (
                              <option key={opt._id} value={opt._id}>
                                {opt.code} · {opt.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="erp-sales-field">
                          <label htmlFor="erp-convert-delivery">납기 희망일</label>
                          <input
                            id="erp-convert-delivery"
                            type="date"
                            value={panelForm.requestedDeliveryDate || ''}
                            disabled={busy}
                            onChange={(e) => setPanelField('requestedDeliveryDate', e.target.value)}
                          />
                        </div>
                        <div className="erp-sales-field is-full">
                          <label htmlFor="erp-convert-address">배송지</label>
                          <input
                            id="erp-convert-address"
                            type="text"
                            autoComplete="off"
                            value={panelForm.shippingAddress || ''}
                            disabled={busy}
                            onChange={(e) => setPanelField('shippingAddress', e.target.value)}
                          />
                        </div>
                      </div>
                      <div className="erp-sales-panel-actions">
                        <button type="button" className="btn-outline" disabled={busy} onClick={closePanel}>
                          닫기
                        </button>
                        <button type="button" className="btn-primary" disabled={busy} onClick={submitPanel}>
                          {runningCommand === 'panel:convert' ? <span className="erp-spinner" aria-hidden /> : null}
                          판매주문 만들기
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" className="btn-outline" disabled={busy} onClick={() => openPanel('convert')}>
                      <span className="material-symbols-outlined">arrow_forward</span>
                      판매주문으로 전환
                    </button>
                  )}
                </section>
              ) : null}

              {isEdit && canWrite && documentConfig.key === 'sales-orders' && status === 'confirmed' ? (
                <section className="erp-sales-section">
                  <h3 className="erp-sales-section-title">후속 문서 만들기</h3>
                  {panel === 'shipment' || panel === 'invoice' ? (
                    <div className="erp-sales-panel">
                      {panelLoading ? (
                        <p className="erp-sales-help">
                          <span className="erp-spinner erp-spinner--dark" aria-hidden /> 잔량을 불러오는 중…
                        </p>
                      ) : panelLines.length === 0 ? (
                        <p className="erp-sales-help">남은 수량이 없습니다.</p>
                      ) : (
                        <div className="erp-sales-scroll">
                          <table className="erp-sales-subtable">
                            <thead>
                              <tr>
                                <th>#</th>
                                <th>품목</th>
                                <th className="is-right">주문 수량</th>
                                <th className="is-right">잔량</th>
                                <th className="is-right">이번 수량</th>
                              </tr>
                            </thead>
                            <tbody>
                              {panelLines.map((line) => (
                                <tr key={line.lineNo}>
                                  <td>{line.lineNo}</td>
                                  <td>{line.itemSnapshot?.name || '-'}</td>
                                  <td className="is-right">{formatMoneyDisplay(line.quantity)}</td>
                                  <td className="is-right">
                                    {formatMoneyDisplay(
                                      panel === 'shipment' ? line.remainingToShip : line.remainingToInvoice
                                    )}
                                  </td>
                                  <td className="is-right">
                                    <input
                                      type="text"
                                      inputMode="decimal"
                                      autoComplete="off"
                                      aria-label={`${line.lineNo}번 라인 수량`}
                                      className="erp-sales-amount-input"
                                      value={line.input}
                                      disabled={busy}
                                      onChange={(e) => setPanelLineInput(line.lineNo, e.target.value)}
                                    />
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      <div className="erp-sales-grid">
                        <div className="erp-sales-field">
                          <label htmlFor="erp-panel-date">문서일자</label>
                          <input
                            id="erp-panel-date"
                            type="date"
                            value={panelForm.documentDate || ''}
                            disabled={busy}
                            onChange={(e) => setPanelField('documentDate', e.target.value)}
                          />
                        </div>
                        {panel === 'shipment' ? (
                          <>
                            <div className="erp-sales-field">
                              <label htmlFor="erp-panel-warehouse">출고 창고</label>
                              <select
                                id="erp-panel-warehouse"
                                value={panelForm.warehouseId || ''}
                                disabled={busy}
                                onChange={(e) => setPanelField('warehouseId', e.target.value)}
                              >
                                <option value="">선택 안 함</option>
                                {(pickers.warehouses || []).map((opt) => (
                                  <option key={opt._id} value={opt._id}>
                                    {opt.code} · {opt.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="erp-sales-field">
                              <label htmlFor="erp-panel-carrier">운송사</label>
                              <input
                                id="erp-panel-carrier"
                                type="text"
                                autoComplete="off"
                                value={panelForm.carrier || ''}
                                disabled={busy}
                                onChange={(e) => setPanelField('carrier', e.target.value)}
                              />
                            </div>
                            <div className="erp-sales-field">
                              <label htmlFor="erp-panel-tracking">송장번호</label>
                              <input
                                id="erp-panel-tracking"
                                type="text"
                                autoComplete="off"
                                value={panelForm.trackingNumber || ''}
                                disabled={busy}
                                onChange={(e) => setPanelField('trackingNumber', e.target.value)}
                              />
                            </div>
                          </>
                        ) : (
                          <div className="erp-sales-field">
                            <label htmlFor="erp-panel-due">수금예정일</label>
                            <input
                              id="erp-panel-due"
                              type="date"
                              value={panelForm.dueDate || ''}
                              disabled={busy}
                              onChange={(e) => setPanelField('dueDate', e.target.value)}
                            />
                            <p className="erp-sales-help">비워 두면 주문의 결제조건으로 자동 계산합니다.</p>
                          </div>
                        )}
                      </div>

                      <div className="erp-sales-panel-actions">
                        <button type="button" className="btn-outline" disabled={busy} onClick={closePanel}>
                          닫기
                        </button>
                        <button
                          type="button"
                          className="btn-primary"
                          disabled={busy || panelLines.length === 0}
                          onClick={submitPanel}
                        >
                          {runningCommand.startsWith('panel:') ? <span className="erp-spinner" aria-hidden /> : null}
                          {panel === 'shipment' ? '출고 초안 만들기' : '매출 초안 만들기'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="erp-sales-panel-actions is-start">
                      <button type="button" className="btn-outline" disabled={busy} onClick={() => openPanel('shipment')}>
                        <span className="material-symbols-outlined">local_shipping</span>
                        출고 만들기
                      </button>
                      <button type="button" className="btn-outline" disabled={busy} onClick={() => openPanel('invoice')}>
                        <span className="material-symbols-outlined">receipt</span>
                        매출 만들기
                      </button>
                    </div>
                  )}
                </section>
              ) : null}

              {isEdit && documentConfig.traceable ? (
                <section className="erp-sales-section">
                  <button
                    type="button"
                    className="btn-outline"
                    onClick={() => onOpenTrace({ salesOrderId: recordId })}
                  >
                    <span className="material-symbols-outlined">timeline</span>
                    리드→수금 추적 보기
                  </button>
                </section>
              ) : null}

              {isEdit && documentConfig.key === 'sales-invoices' ? (
                <section className="erp-sales-section">
                  <button type="button" className="erp-sales-toggle" onClick={toggleSettlements}>
                    <span className="material-symbols-outlined">
                      {settlementsOpen ? 'expand_less' : 'expand_more'}
                    </span>
                    수금·대변 내역
                  </button>
                  {settlementsOpen ? (
                    !settlements ? (
                      <p className="erp-sales-help">
                        <span className="erp-spinner erp-spinner--dark" aria-hidden /> 불러오는 중…
                      </p>
                    ) : (settlements.receipts || []).length === 0 &&
                      (settlements.creditNotes || []).length === 0 ? (
                      <p className="erp-sales-help">아직 반영된 수금·대변전표가 없습니다.</p>
                    ) : (
                      <ul className="erp-sales-list">
                        {(settlements.receipts || []).map((item) => (
                          <li key={`r-${item._id}`}>
                            <span className="erp-sales-list-main">수금 {item.code}</span>
                            <span>{labelOf(RECEIPT_METHOD_LABELS, item.method)}</span>
                            <span>{formatDateDisplay(item.receiptDate)}</span>
                            <strong>{formatMoneyDisplay(item.allocatedAmount, item.currency)}</strong>
                          </li>
                        ))}
                        {(settlements.creditNotes || []).map((item) => (
                          <li key={`c-${item._id}`}>
                            <span className="erp-sales-list-main">대변 {item.code}</span>
                            <span>{labelOf(CREDIT_REASON_LABELS, item.reasonType)}</span>
                            <span>{formatDateDisplay(item.documentDate)}</span>
                            <strong>{formatMoneyDisplay(item.totalAmount, item.currency)}</strong>
                          </li>
                        ))}
                      </ul>
                    )
                  ) : null}
                </section>
              ) : null}

              {isEdit ? (
                <section className="erp-sales-section">
                  <button type="button" className="erp-sales-toggle" onClick={toggleHistory}>
                    <span className="material-symbols-outlined">
                      {historyOpen ? 'expand_less' : 'expand_more'}
                    </span>
                    변경 이력
                  </button>
                  {historyOpen ? (
                    historyLoading ? (
                      <p className="erp-sales-help">
                        <span className="erp-spinner erp-spinner--dark" aria-hidden /> 불러오는 중…
                      </p>
                    ) : history.length === 0 ? (
                      <p className="erp-sales-help">기록된 변경 이력이 없습니다.</p>
                    ) : (
                      <ul className="erp-sales-history">
                        {history.map((event) => (
                          <li key={event._id}>
                            <div className="erp-sales-history-head">
                              <strong>{ACTION_LABELS[event.action] || event.action}</strong>
                              <span>{event.userName || '알 수 없음'}</span>
                              <time>{formatDateTimeDisplay(event.createdAt)}</time>
                            </div>
                            {event.reason ? <p className="erp-sales-history-reason">{event.reason}</p> : null}
                          </li>
                        ))}
                      </ul>
                    )
                  ) : null}
                </section>
              ) : null}
            </div>

            {/* 명령 · 저장 */}
            <div className="erp-sales-modal-footer">
              {pendingCommand ? (
                <div className="erp-sales-reason">
                  <label htmlFor="erp-sales-reason-input">
                    {pendingCommand.reasonLabel || '사유'}
                    {pendingCommand.reasonRequired ? <span className="erp-sales-required"> *</span> : null}
                  </label>
                  <textarea
                    id="erp-sales-reason-input"
                    rows={2}
                    value={reasonText}
                    disabled={busy}
                    onChange={(e) => setReasonText(e.target.value)}
                  />
                  <div className="erp-sales-reason-actions">
                    <button
                      type="button"
                      className="btn-outline"
                      disabled={busy}
                      onClick={() => {
                        setPendingCommand(null);
                        setReasonText('');
                      }}
                    >
                      되돌리기
                    </button>
                    <button type="button" className="erp-sales-danger" disabled={busy} onClick={submitPendingCommand}>
                      {runningCommand === pendingCommand.key ? <span className="erp-spinner" aria-hidden /> : null}
                      {pendingCommand.label} 실행
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="erp-sales-modal-footer-row">
                <div className="erp-sales-modal-footer-left">
                  {isEdit && canDelete && status === 'draft' && documentConfig.deletable ? (
                    <button type="button" className="erp-sales-danger" onClick={handleDelete} disabled={busy}>
                      {deleting ? <span className="erp-spinner" aria-hidden /> : null}
                      삭제
                    </button>
                  ) : null}
                  {isEdit && canWrite
                    ? commands.map((command) => (
                        <button
                          key={command.key}
                          type="button"
                          className={command.danger ? 'erp-sales-danger' : 'btn-outline'}
                          disabled={busy || Boolean(pendingCommand)}
                          onClick={() => startCommand(command)}
                        >
                          {runningCommand === command.key ? <span className="erp-spinner" aria-hidden /> : null}
                          {command.label}
                        </button>
                      ))
                    : null}
                </div>
                <div className="erp-sales-modal-footer-right">
                  <button type="button" className="btn-outline" onClick={onClose} disabled={busy}>
                    닫기
                  </button>
                  {canEditForm && (isEdit || documentConfig.createEnabled) ? (
                    <button type="submit" className="btn-primary" disabled={busy}>
                      {saving ? <span className="erp-spinner" aria-hidden /> : null}
                      {isEdit ? '저장' : '등록'}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
