import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchErpRecord,
  fetchErpList,
  fetchErpHistory,
  createErpRecord,
  updateErpRecord,
  deleteErpRecord,
  formatBusinessNumberDisplay
} from '@/lib/erp-master-api';
import './erp-master-detail-modal.css';

/**
 * ERP 기준정보 등록·수정 모달.
 * - 오버레이 클릭으로 닫히지 않습니다.
 * - URL의 id로 단건 조회하므로 새로고침·딥링크에서도 정상 표시됩니다.
 * - 저장·삭제 중에는 스피너를 표시하고 중복 제출을 막습니다.
 */

function initialFormFrom(fields, record) {
  const out = {};
  for (const field of fields) {
    const raw = record ? record[field.key] : undefined;
    if (raw === undefined || raw === null) {
      out[field.key] = field.defaultValue !== undefined ? field.defaultValue : field.type === 'checkbox' ? false : '';
      continue;
    }
    out[field.key] = field.type === 'checkbox' ? Boolean(raw) : String(raw);
  }
  return out;
}

/** 서버로 보낼 값 — 빈 참조는 '' 로 보내 연결 해제를 표현합니다 */
function buildPayload(fields, form) {
  const payload = {};
  for (const field of fields) {
    const value = form[field.key];
    if (field.type === 'checkbox') payload[field.key] = Boolean(value);
    else payload[field.key] = value == null ? '' : String(value).trim();
  }
  return payload;
}

function formatHistoryDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
}

const ACTION_LABELS = {
  create: '등록',
  update: '수정',
  delete: '삭제',
  sync: 'CRM 가져오기'
};

export default function ErpMasterDetailModal({
  entity,
  recordId,
  canWrite,
  canDelete,
  onClose,
  onSaved,
  onDeleted
}) {
  const isEdit = Boolean(recordId);
  const fields = entity.fields;

  const [record, setRecord] = useState(null);
  const [form, setForm] = useState(() => initialFormFrom(fields, null));
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [conflictLatest, setConflictLatest] = useState(null);
  const [refOptions, setRefOptions] = useState({});
  const [history, setHistory] = useState([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);

  const busy = saving || deleting;

  const refFields = useMemo(() => fields.filter((f) => f.type === 'ref'), [fields]);

  /** URL id 기준 단건 조회 — 목록 상태에 의존하지 않습니다 */
  useEffect(() => {
    if (!isEdit) {
      setRecord(null);
      setForm(initialFormFrom(fields, null));
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    fetchErpRecord(entity.path, recordId)
      .then((data) => {
        if (cancelled) return;
        setRecord(data);
        setForm(initialFormFrom(fields, data));
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || '정보를 불러오지 못했습니다.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entity.path, recordId, isEdit, fields]);

  /** 참조 선택지(결제조건·세금구분) — 사용 중인 항목만 */
  useEffect(() => {
    if (refFields.length === 0) return undefined;
    let cancelled = false;
    Promise.all(
      refFields.map((field) =>
        fetchErpList(field.refPath, { picker: '1', status: 'active' })
          .then((data) => [field.key, Array.isArray(data.items) ? data.items : []])
          .catch(() => [field.key, []])
      )
    ).then((entries) => {
      if (!cancelled) setRefOptions(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [refFields]);

  const loadHistory = useCallback(async () => {
    if (!isEdit) return;
    setHistoryLoading(true);
    try {
      const data = await fetchErpHistory(entity.path, recordId, { limit: 20 });
      setHistory(Array.isArray(data.items) ? data.items : []);
    } catch (err) {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [entity.path, recordId, isEdit]);

  const toggleHistory = () => {
    const next = !historyOpen;
    setHistoryOpen(next);
    if (next && history.length === 0) void loadHistory();
  };

  const setField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (busy || !canWrite) return;

    setError('');
    setConflictLatest(null);
    setSaving(true);
    try {
      const payload = buildPayload(fields, form);
      if (isEdit) {
        payload.version = record ? record.version || 0 : 0;
        const saved = await updateErpRecord(entity.path, recordId, payload);
        setRecord(saved);
        setForm(initialFormFrom(fields, saved));
        if (historyOpen) void loadHistory();
        onSaved(saved, { created: false });
      } else {
        const saved = await createErpRecord(entity.path, payload);
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
    setRecord(conflictLatest);
    setForm(initialFormFrom(fields, conflictLatest));
    setConflictLatest(null);
    setError('');
  };

  const handleDelete = async () => {
    if (busy || !canDelete || !isEdit) return;
    if (!window.confirm(`이 ${entity.label}을(를) 삭제할까요? 삭제 이력은 감사 로그에 남습니다.`)) return;

    setError('');
    setDeleting(true);
    try {
      await deleteErpRecord(entity.path, recordId);
      onDeleted();
      onClose();
    } catch (err) {
      setError(err.message || '삭제에 실패했습니다.');
    } finally {
      setDeleting(false);
    }
  };

  const renderField = (field) => {
    const value = form[field.key];
    const id = `erp-field-${field.key}`;
    const disabled = busy || !canWrite;

    if (field.type === 'checkbox') {
      return (
        <label key={field.key} className="erp-modal-check">
          <input
            id={id}
            type="checkbox"
            checked={Boolean(value)}
            disabled={disabled}
            onChange={(e) => setField(field.key, e.target.checked)}
          />
          <span>
            {field.label}
            {field.help ? <span className="erp-modal-help">{field.help}</span> : null}
          </span>
        </label>
      );
    }

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
      const options = refOptions[field.key] || [];
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
    } else {
      control = (
        <input
          id={id}
          type="text"
          inputMode={field.type === 'number' || field.type === 'money' ? 'decimal' : undefined}
          autoComplete="off"
          value={value}
          disabled={disabled}
          placeholder={field.placeholder || ''}
          onChange={(e) => setField(field.key, e.target.value)}
        />
      );
    }

    return (
      <div key={field.key} className={`erp-modal-field ${field.full ? 'is-full' : ''}`}>
        <label htmlFor={id}>
          {field.label}
          {field.required ? <span className="erp-modal-required"> *</span> : null}
        </label>
        {control}
        {field.help ? <p className="erp-modal-help">{field.help}</p> : null}
      </div>
    );
  };

  return (
    /** 오버레이 클릭으로 닫지 않습니다 (프로젝트 규칙) */
    <div className="erp-modal-overlay" role="presentation">
      <div
        className="erp-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="erp-modal-title"
      >
        <div className="erp-modal-header">
          <div>
            <h2 className="erp-modal-title" id="erp-modal-title">
              {isEdit ? `${entity.label} 상세` : `${entity.label} 등록`}
            </h2>
            <p className="erp-modal-subtitle">
              {isEdit && record
                ? `${record.code}${record.updatedAt ? ` · 최근 수정 ${formatHistoryDate(record.updatedAt)}` : ''}`
                : '코드는 저장 시 자동으로 채번됩니다.'}
            </p>
          </div>
          <button type="button" className="erp-modal-close" onClick={onClose} aria-label="닫기" disabled={busy}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {loading ? (
          <div className="erp-modal-loading">
            <span className="erp-spinner erp-spinner--dark" aria-hidden />
            불러오는 중입니다…
          </div>
        ) : (
          <form className="erp-modal-form" onSubmit={handleSubmit}>
            <div className="erp-modal-body">
              {error ? (
                <div className="erp-modal-error" role="alert">
                  <span>{error}</span>
                  {conflictLatest ? (
                    <button type="button" className="btn-outline erp-modal-error-action" onClick={applyLatest}>
                      최신 내용 불러오기
                    </button>
                  ) : null}
                </div>
              ) : null}

              {isEdit && record && entity.key === 'partners' && record.businessNumber ? (
                <p className="erp-modal-note">
                  사업자등록번호: {formatBusinessNumberDisplay(record.businessNumber)}
                </p>
              ) : null}
              {isEdit && record && record.sourceCustomerCompanyId ? (
                <p className="erp-modal-note">CRM 고객사에서 가져온 거래처입니다.</p>
              ) : null}
              {isEdit && record && record.sourceProductId ? (
                <p className="erp-modal-note">CRM 제품에서 가져온 품목입니다.</p>
              ) : null}

              <div className="erp-modal-grid">{fields.map(renderField)}</div>

              {isEdit ? (
                <section className="erp-modal-history">
                  <button type="button" className="erp-modal-history-toggle" onClick={toggleHistory}>
                    <span className="material-symbols-outlined">
                      {historyOpen ? 'expand_less' : 'expand_more'}
                    </span>
                    변경 이력
                  </button>
                  {historyOpen ? (
                    historyLoading ? (
                      <p className="erp-modal-history-empty">
                        <span className="erp-spinner erp-spinner--dark" aria-hidden /> 불러오는 중…
                      </p>
                    ) : history.length === 0 ? (
                      <p className="erp-modal-history-empty">기록된 변경 이력이 없습니다.</p>
                    ) : (
                      <ul className="erp-modal-history-list">
                        {history.map((event) => (
                          <li key={event._id}>
                            <div className="erp-modal-history-head">
                              <strong>{ACTION_LABELS[event.action] || event.action}</strong>
                              <span>{event.userName || '알 수 없음'}</span>
                              <time>{formatHistoryDate(event.createdAt)}</time>
                            </div>
                            {event.changes && Object.keys(event.changes).length ? (
                              <ul className="erp-modal-history-changes">
                                {Object.entries(event.changes).map(([key, change]) => (
                                  <li key={key}>
                                    {key}: {String(change.from ?? '-')} → {String(change.to ?? '-')}
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )
                  ) : null}
                </section>
              ) : null}
            </div>

            <div className="erp-modal-footer">
              {isEdit && canDelete ? (
                <button type="button" className="erp-modal-delete" onClick={handleDelete} disabled={busy}>
                  {deleting ? <span className="erp-spinner" aria-hidden /> : null}
                  삭제
                </button>
              ) : (
                <span />
              )}
              <div className="erp-modal-footer-actions">
                <button type="button" className="btn-outline" onClick={onClose} disabled={busy}>
                  닫기
                </button>
                <button type="submit" className="btn-primary" disabled={busy || !canWrite}>
                  {saving ? <span className="erp-spinner" aria-hidden /> : null}
                  {isEdit ? '저장' : '등록'}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
