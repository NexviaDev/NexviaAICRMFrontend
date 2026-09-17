/**
 * 연락처 대량 등록 미리보기 (엑셀 가져오기 · 구글 주소록 · TXT 추출 공용).
 *
 * 회사 연결은 행 단위가 아니라 "회사 묶음" 단위로 합니다.
 *  - 같은 회사명(공백·㈜·주식회사 등 무시)은 한 묶음 — 서버의 대량 등록 묶음 규칙과 같습니다.
 *  - 묶음마다 기존 고객사 후보를 한 번에 조회해, 표기만 다른 같은 회사가 1곳뿐이면 자동 연결합니다.
 *    (서버는 이름이 "정확히" 같을 때만 기존 고객사를 재사용하므로, 연결하지 않으면
 *     "(주)넥스비아" / "넥스비아 주식회사" 같은 표기 차이로 고객사가 중복 생성됩니다.)
 *  - 후보가 여러 곳이면 사용자가 고르게 합니다.
 *
 * 이전 화면은 고객사 목록 템플릿의 대표자명·업종·사업자번호·상태·커스텀 필드 열을 편집하게 했지만,
 * 대량 등록 요청에는 그 값들이 실리지 않아 저장되지 않았습니다. 실제로 저장되는 필드만 보여 줍니다.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { crmFetchInit } from '@/lib/crm-auth';
import { API_BASE } from '@/config';
import CustomerCompanySearchModal from '../../customer-companies/customer-company-search-modal/customer-company-search-modal';
import { normalizeBulkImportCompanyGroupKey } from '@/lib/bulk-import-company-group-key';
import '../../shared/excel-import-mapping-modal.css';
import './contact-import-preview-modal.css';

/** add-customer-company-employees-modal.js 의 formatPhoneInput 과 동일 */
function formatPhoneInput(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 0) return '';
  if (digits.startsWith('010') && digits.length <= 11) {
    if (digits.length <= 3) return digits;
    if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 11)}`;
  }
  if (digits.startsWith('02') && digits.length <= 10) {
    if (digits.length <= 2) return digits;
    if (digits.length <= 5) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
    if (digits.length <= 9) return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`;
    return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6, 10)}`;
  }
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SIMILAR_BATCH_SIZE = 500;
const SIMILAR_DEBOUNCE_MS = 350;
const EDITABLE_FIELDS = new Set(['name', 'email', 'phone', 'position', 'companyName', 'address', 'memo', 'birthDate']);

let rowSeq = 0;
const nextRowKey = () => `cip-${Date.now().toString(36)}-${(rowSeq += 1)}`;

const str = (v) => (v == null ? '' : String(v));

/** 엑셀·구글·TXT 에서 키 이름이 달라도 한 모양으로 통일 */
function normalizeIncomingRow(r) {
  const src = r && typeof r === 'object' ? r : {};
  return {
    ...src,
    _key: nextRowKey(),
    name: str(src.name ?? src.contactName ?? src.employeeName),
    email: str(src.email ?? src.workEmail),
    phone: str(src.phone ?? src.mobile ?? src.tel),
    position: str(src.position ?? src.title ?? src.jobTitle),
    companyName: str(src.companyName ?? src.linkedCompany?.name),
    address: str(src.address),
    memo: str(src.memo),
    birthDate: str(src.birthDate),
    customerCompanyId: src.customerCompanyId ? String(src.customerCompanyId) : null,
    linkedCompany: src.linkedCompany || null,
    error: str(src.error)
  };
}

/** 회사 묶음 키 — 연결된 행은 고객사 id, 아니면 정규화한 회사명(서버 대량 등록 규칙과 동일) */
function companyGroupKeyOf(row) {
  if (row.customerCompanyId) return `id:${row.customerCompanyId}`;
  const k = normalizeBulkImportCompanyGroupKey(row.companyName);
  return k ? `name:${k}` : '';
}

function linkRowToCompany(row, company) {
  return {
    ...row,
    // 연결 해제 시 되돌릴 이름 (이미 연결돼 있던 행이면 처음 이름 유지)
    _preLinkCompanyName: row.customerCompanyId ? row._preLinkCompanyName ?? row.companyName : row.companyName,
    customerCompanyId: String(company._id),
    linkedCompany: company,
    companyName: company.name || row.companyName
  };
}

function unlinkRow(row) {
  const restored = row._preLinkCompanyName ?? row.companyName;
  return { ...row, customerCompanyId: null, linkedCompany: null, companyName: restored, _preLinkCompanyName: undefined };
}

/** 행 검사: error = 등록 불가(체크 해제), warn = 확인 권장 */
function inspectRow(row, dupOfRowNo) {
  const errors = [];
  const warns = [];
  if (row.error) errors.push(row.error);
  const hasId = row.name.replace(/\s/g, '') || row.email.trim() || row.phone.trim();
  if (!hasId) errors.push('이름·이메일·전화 중 하나는 있어야 합니다');
  if (row.email.trim() && !EMAIL_RE.test(row.email.trim())) warns.push('이메일 형식을 확인해 주세요');
  const pd = row.phone.replace(/\D/g, '');
  if (pd && (pd.length < 9 || pd.length > 11)) warns.push('전화번호 자릿수를 확인해 주세요');
  if (dupOfRowNo) warns.push(`${dupOfRowNo}행과 이름·전화가 같습니다`);
  if (errors.length) return { level: 'error', text: errors.concat(warns).join(' · ') };
  if (warns.length) return { level: 'warn', text: warns.join(' · ') };
  return { level: '', text: '' };
}

/* ------------------------------------------------------------------ */
/*  행                                                                  */
/* ------------------------------------------------------------------ */

const PreviewRow = memo(function PreviewRow({
  row,
  rowNo,
  checked,
  issueLevel,
  issueText,
  companyState,
  groupKey,
  showCompany,
  showBirthDate,
  disabled,
  onToggle,
  onPatch,
  onUnlinkRow,
  onFocusGroup
}) {
  const k = row._key;
  const field = (name, props = {}) => (
    <input
      className={`cipv-input${props.invalid ? ' is-invalid' : ''}`}
      value={row[name]}
      onChange={(e) => onPatch(k, name, e.target.value)}
      disabled={disabled}
      aria-label={`${rowNo}행 ${props.label}`}
      placeholder={props.placeholder || props.label}
      type={props.type || 'text'}
      inputMode={props.inputMode}
      autoComplete="off"
    />
  );

  return (
    <tr className={`cipv-row${checked ? '' : ' is-excluded'}${issueLevel ? ` has-${issueLevel}` : ''}`}>
      <td className="cipv-td-check">
        <input
          type="checkbox"
          className="cipv-check"
          checked={checked}
          disabled={disabled}
          onChange={() => {}}
          onClick={(e) => onToggle(k, e.shiftKey)}
          aria-label={`${rowNo}행 등록 포함`}
        />
      </td>
      <td className="cipv-td-no">{rowNo}</td>
      <td className="cipv-td-issue">
        {issueLevel ? (
          <span className={`cipv-issue is-${issueLevel}`} title={issueText} aria-label={issueText}>
            <span className="material-symbols-outlined">{issueLevel === 'error' ? 'error' : 'warning'}</span>
          </span>
        ) : null}
      </td>
      <td>{field('name', { label: '이름' })}</td>
      <td>{field('phone', { label: '전화', type: 'tel', inputMode: 'numeric' })}</td>
      <td>{field('email', { label: '이메일', type: 'email', invalid: issueText.includes('이메일') })}</td>
      {showCompany ? (
        <td className="cipv-td-company">
          {row.customerCompanyId ? (
            <span className={`cipv-company-chip${companyState === 'auto' ? ' is-auto' : ''}`}>
              <span className="material-symbols-outlined" aria-hidden>
                link
              </span>
              <button type="button" className="cipv-company-chip-name" onClick={() => onFocusGroup(groupKey)} title="회사 묶음 보기">
                {row.companyName || row.linkedCompany?.name || '연결된 고객사'}
              </button>
              <button
                type="button"
                className="cipv-company-chip-x"
                onClick={() => onUnlinkRow(k)}
                disabled={disabled}
                title="이 행만 연결 해제"
                aria-label={`${rowNo}행 고객사 연결 해제`}
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </span>
          ) : (
            <div className="cipv-company-edit">
              {field('companyName', { label: '회사', placeholder: '회사 없음(개인)' })}
              {companyState ? (
                <button
                  type="button"
                  className={`cipv-company-state is-${companyState}`}
                  onClick={() => onFocusGroup(groupKey)}
                  title="회사 묶음 보기"
                >
                  {companyState === 'check' ? '확인' : companyState === 'loading' ? '…' : '신규'}
                </button>
              ) : null}
            </div>
          )}
        </td>
      ) : null}
      <td>{field('position', { label: '직책' })}</td>
      <td>{field('address', { label: '주소' })}</td>
      <td>{field('memo', { label: '메모' })}</td>
      {showBirthDate ? <td>{field('birthDate', { label: '생년월일' })}</td> : null}
    </tr>
  );
});

/* ------------------------------------------------------------------ */
/*  회사 묶음 카드                                                        */
/* ------------------------------------------------------------------ */

function CompanyGroupCard({ group, state, similar, active, disabled, onFocus, onLink, onUnlink, onDismiss, onUndismiss, onSearch }) {
  const candidates = similar?.candidates || [];
  const count = group.rowKeys.length;

  const stateLabel = {
    linked: '기존 고객사에 연결',
    auto: '표기만 다른 기존 고객사에 자동 연결',
    check: `비슷한 고객사 ${candidates.length}곳 — 확인 필요`,
    loading: '기존 고객사 확인 중…',
    error: '기존 고객사 확인 실패',
    new: '신규 고객사로 생성'
  }[state];

  return (
    <li className={`cipv-group is-${state}${active ? ' is-active' : ''}`}>
      <button type="button" className="cipv-group-head" onClick={() => onFocus(group.key)} aria-pressed={active}>
        <span className="material-symbols-outlined cipv-group-icon" aria-hidden>
          {state === 'linked' || state === 'auto' ? 'link' : state === 'check' ? 'help' : state === 'error' ? 'cloud_off' : 'add_business'}
        </span>
        <span className="cipv-group-name" title={group.displayName}>
          {group.displayName}
        </span>
        <span className="cipv-group-count">
          {group.checkedCount !== count ? `${group.checkedCount}/` : ''}
          {count}명
        </span>
      </button>
      <p className="cipv-group-state">{stateLabel}</p>

      {state === 'check' ? (
        <ul className="cipv-cands">
          {candidates.slice(0, 3).map((c) => (
            <li key={String(c._id)} className="cipv-cand">
              <div className="cipv-cand-main">
                <strong>{c.name}</strong>
                <span>{[c.businessNumber, c.address].filter(Boolean).join(' · ') || '추가 정보 없음'}</span>
              </div>
              <button type="button" className="cipv-btn cipv-btn--primary" onClick={() => onLink(group.key, c)} disabled={disabled}>
                연결
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="cipv-group-actions">
        {state === 'auto' || state === 'linked' ? (
          <button type="button" className="cipv-btn" onClick={() => onUnlink(group.key)} disabled={disabled}>
            {state === 'auto' ? '되돌리기' : '연결 해제'}
          </button>
        ) : null}
        {state === 'check' ? (
          <button type="button" className="cipv-btn" onClick={() => onDismiss(group.nameKey)} disabled={disabled}>
            신규로 등록
          </button>
        ) : null}
        {state === 'new' && similar?.status === 'done' && candidates.length > 0 ? (
          <button type="button" className="cipv-btn cipv-btn--ghost" onClick={() => onUndismiss(group.nameKey)} disabled={disabled}>
            비슷한 고객사 {candidates.length}곳 다시 보기
          </button>
        ) : null}
        {state !== 'linked' && state !== 'auto' ? (
          <button type="button" className="cipv-btn cipv-btn--ghost" onClick={() => onSearch(group)} disabled={disabled}>
            <span className="material-symbols-outlined" aria-hidden>
              search
            </span>
            직접 찾기
          </button>
        ) : null}
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/*  본체                                                                */
/* ------------------------------------------------------------------ */

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {object[]} props.items
 * @param {boolean} props.bulkSaving
 * @param {boolean} props.fixedCompany  true 면 모든 연락처가 호출부의 고정 고객사로 등록됨 (회사 열·묶음 숨김)
 * @param {() => void} props.onClose
 * @param {(rows: object[]) => void} props.onConfirm
 */
export default function ContactImportPreviewModal({ open, items, bulkSaving, fixedCompany, onClose, onConfirm }) {
  const [draft, setDraft] = useState([]);
  const [checked, setChecked] = useState(() => new Set());
  const [filter, setFilter] = useState('all');
  const [groupFilter, setGroupFilter] = useState(null);
  /** nameKey → { status: 'loading'|'done'|'error', candidates, exactMatchCount } */
  const [similar, setSimilar] = useState({});
  /** "신규로 등록"을 고른 회사명 키 — 자동 연결·확인 요청 대상에서 뺌 */
  const [dismissed, setDismissed] = useState(() => new Set());
  /** 자동 연결로 연결된 고객사 id */
  const [autoLinked, setAutoLinked] = useState({});
  const [searchCtx, setSearchCtx] = useState(null);

  const openRef = useRef(open);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const similarRef = useRef(similar);
  const visibleKeysRef = useRef([]);
  const checkedRef = useRef(checked);
  const anchorRef = useRef(null);
  const panelRef = useRef(null);
  const disabled = !!bulkSaving;
  const showCompany = !fixedCompany;

  useEffect(() => {
    openRef.current = open;
  }, [open]);
  useEffect(() => {
    similarRef.current = similar;
  }, [similar]);
  useEffect(() => {
    checkedRef.current = checked;
  }, [checked]);

  // 열릴 때 초기화 — 등록할 수 없는 행(식별 정보 없음·추출 오류)은 처음부터 제외
  useEffect(() => {
    if (!open) return;
    const next = (items || []).map(normalizeIncomingRow);
    setDraft(next);
    setChecked(new Set(next.filter((r) => inspectRow(r, 0).level !== 'error').map((r) => r._key)));
    setFilter('all');
    setGroupFilter(null);
    setSimilar({});
    setDismissed(new Set());
    setAutoLinked({});
    setSearchCtx(null);
    anchorRef.current = null;
  }, [open, items]);

  useEffect(() => {
    if (!open) return undefined;
    const t = window.setTimeout(() => panelRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (e) => {
      if (e.key !== 'Escape' || bulkSaving) return;
      e.preventDefault();
      if (searchCtx) setSearchCtx(null);
      else onClose?.();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, bulkSaving, onClose, searchCtx]);

  /* ---------- 행 검사 ---------- */

  const issues = useMemo(() => {
    const firstByContact = new Map();
    const out = new Map();
    draft.forEach((row, i) => {
      const nameKey = row.name.replace(/\s/g, '');
      const pd = row.phone.replace(/\D/g, '');
      let dupOf = 0;
      if (nameKey && pd) {
        const key = `${nameKey}|${pd}`;
        if (firstByContact.has(key)) dupOf = firstByContact.get(key) + 1;
        else firstByContact.set(key, i);
      }
      out.set(row._key, inspectRow(row, dupOf));
    });
    return out;
  }, [draft]);

  /* ---------- 회사 묶음 ---------- */

  const groups = useMemo(() => {
    if (!showCompany) return [];
    const map = new Map();
    for (const row of draft) {
      const key = companyGroupKeyOf(row);
      if (!key) continue;
      let g = map.get(key);
      if (!g) {
        g = {
          key,
          nameKey: key.startsWith('name:') ? key.slice(5) : '',
          companyId: row.customerCompanyId || '',
          displayName: (row.customerCompanyId ? row.linkedCompany?.name || row.companyName : row.companyName).trim(),
          rowKeys: [],
          checkedCount: 0
        };
        map.set(key, g);
      }
      g.rowKeys.push(row._key);
      if (checked.has(row._key)) g.checkedCount += 1;
    }
    return Array.from(map.values());
  }, [draft, checked, showCompany]);

  const groupState = useCallback(
    (g) => {
      if (g.companyId) return autoLinked[g.companyId] ? 'auto' : 'linked';
      const s = similar[g.nameKey];
      if (!s || s.status === 'loading') return 'loading';
      if (s.status === 'error') return 'error';
      if (s.candidates.length > 0 && !dismissed.has(g.nameKey)) return 'check';
      return 'new';
    },
    [similar, dismissed, autoLinked]
  );

  // 회사명 묶음마다 기존 고객사 후보를 한 번에 조회 (회사명을 고치는 동안은 잠시 기다림)
  const newGroupNames = useMemo(
    () => groups.filter((g) => !g.companyId).map((g) => [g.nameKey, g.displayName]),
    [groups]
  );
  const newGroupSig = useMemo(() => newGroupNames.map(([k]) => k).sort().join('|'), [newGroupNames]);
  const newGroupNamesRef = useRef(newGroupNames);
  newGroupNamesRef.current = newGroupNames;

  useEffect(() => {
    if (!open || !showCompany || !newGroupSig) return undefined;
    const timer = window.setTimeout(async () => {
      const todo = newGroupNamesRef.current.filter(([k]) => !similarRef.current[k]);
      if (!todo.length) return;
      setSimilar((prev) => {
        const n = { ...prev };
        todo.forEach(([k]) => {
          if (!n[k]) n[k] = { status: 'loading', candidates: [], exactMatchCount: 0 };
        });
        return n;
      });
      for (let i = 0; i < todo.length; i += SIMILAR_BATCH_SIZE) {
        const chunk = todo.slice(i, i + SIMILAR_BATCH_SIZE);
        let results = null;
        try {
          const res = await fetch(
            `${API_BASE}/customer-companies/similar-name-candidates/batch`,
            crmFetchInit({
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ names: chunk.map(([, name]) => name) })
            })
          );
          const data = await res.json().catch(() => ({}));
          if (res.ok && data && typeof data.results === 'object') results = data.results;
        } catch (_) {
          results = null;
        }
        // 결과는 회사명 키 기준이라 그사이 표가 바뀌어도 유효합니다. 모달이 닫혔을 때만 버립니다.
        if (!openRef.current) return;
        setSimilar((prev) => {
          const n = { ...prev };
          chunk.forEach(([k, name]) => {
            const r = results ? results[name] : null;
            n[k] = r
              ? { status: 'done', candidates: Array.isArray(r.candidates) ? r.candidates : [], exactMatchCount: Number(r.exactMatchCount) || 0 }
              : { status: 'error', candidates: [], exactMatchCount: 0 };
          });
          return n;
        });
      }
    }, SIMILAR_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [open, showCompany, newGroupSig]);

  // 표기만 다른 기존 고객사가 정확히 1곳이면 자동 연결
  useEffect(() => {
    if (!showCompany) return;
    const toLink = new Map();
    for (const g of groups) {
      if (g.companyId || dismissed.has(g.nameKey)) continue;
      const s = similar[g.nameKey];
      if (!s || s.status !== 'done' || s.exactMatchCount !== 1) continue;
      const exact = s.candidates.find((c) => c.exactKeyMatch);
      if (exact) toLink.set(g.key, exact);
    }
    if (!toLink.size) return;
    setDraft((prev) =>
      prev.map((r) => {
        const c = toLink.get(companyGroupKeyOf(r));
        return c ? linkRowToCompany(r, c) : r;
      })
    );
    setAutoLinked((prev) => {
      const n = { ...prev };
      toLink.forEach((c) => {
        n[String(c._id)] = true;
      });
      return n;
    });
  }, [groups, similar, dismissed, showCompany]);

  /* ---------- 편집·연결 동작 ---------- */

  const patchRow = useCallback((rowKey, fieldName, value) => {
    if (!EDITABLE_FIELDS.has(fieldName)) return;
    const v = fieldName === 'phone' ? formatPhoneInput(value) : str(value);
    setDraft((prev) => prev.map((r) => (r._key === rowKey ? { ...r, [fieldName]: v } : r)));
  }, []);

  const linkGroup = useCallback((groupKey, company) => {
    setDraft((prev) => prev.map((r) => (companyGroupKeyOf(r) === groupKey ? linkRowToCompany(r, company) : r)));
    // 사용자가 직접 연결한 경우에는 "자동" 표시를 붙이지 않습니다.
    setAutoLinked((prev) => {
      const id = String(company._id);
      if (!prev[id]) return prev;
      const n = { ...prev };
      delete n[id];
      return n;
    });
  }, []);

  /**
   * 연결을 풀면 원래 회사명으로 돌리고, 그 이름은 자동 연결 대상에서 뺍니다(바로 다시 연결되지 않게).
   * 풀린 이름 키를 setDraft 업데이터 안에서 모으면 업데이터가 다음 렌더에 실행돼 순서가 보장되지 않으므로,
   * 최신 draft(ref)로 미리 계산한 뒤 두 상태를 같은 이벤트에서 함께 반영합니다.
   */
  const unlinkWhere = useCallback((predicate) => {
    const restoredKeys = [];
    const next = draftRef.current.map((r) => {
      if (!r.customerCompanyId || !predicate(r)) return r;
      const restored = unlinkRow(r);
      const k = normalizeBulkImportCompanyGroupKey(restored.companyName);
      if (k) restoredKeys.push(k);
      return restored;
    });
    setDraft(next);
    if (restoredKeys.length) {
      setDismissed((prev) => {
        const n = new Set(prev);
        restoredKeys.forEach((k) => n.add(k));
        return n;
      });
    }
  }, []);

  const unlinkGroup = useCallback((groupKey) => unlinkWhere((r) => companyGroupKeyOf(r) === groupKey), [unlinkWhere]);
  const unlinkSingleRow = useCallback((rowKey) => unlinkWhere((r) => r._key === rowKey), [unlinkWhere]);

  const dismissName = useCallback((nameKey) => {
    setDismissed((prev) => new Set(prev).add(nameKey));
  }, []);
  const undismissName = useCallback((nameKey) => {
    setDismissed((prev) => {
      const n = new Set(prev);
      n.delete(nameKey);
      return n;
    });
  }, []);

  const focusGroup = useCallback((groupKey) => {
    setGroupFilter((prev) => (prev === groupKey ? null : groupKey));
  }, []);

  /* ---------- 체크 ---------- */

  /** Shift+클릭: 기준 행과 같은 상태를 보이는 범위에 적용 · 그냥 클릭: 한 행 토글 */
  const toggleRow = useCallback((rowKey, shiftKey) => {
    const keys = visibleKeysRef.current;
    const current = checkedRef.current;
    if (shiftKey && anchorRef.current && keys.includes(anchorRef.current)) {
      const a = keys.indexOf(anchorRef.current);
      const b = keys.indexOf(rowKey);
      const [s, e] = a < b ? [a, b] : [b, a];
      const target = current.has(anchorRef.current);
      setChecked((prev) => {
        const n = new Set(prev);
        for (let i = s; i <= e; i += 1) {
          if (target) n.add(keys[i]);
          else n.delete(keys[i]);
        }
        return n;
      });
      return;
    }
    anchorRef.current = rowKey;
    setChecked((prev) => {
      const n = new Set(prev);
      if (n.has(rowKey)) n.delete(rowKey);
      else n.add(rowKey);
      return n;
    });
  }, []);

  /* ---------- 보이는 행 · 통계 ---------- */

  const groupFilterObj = useMemo(() => groups.find((g) => g.key === groupFilter) || null, [groups, groupFilter]);

  const visibleRows = useMemo(() => {
    let list = draft;
    if (groupFilterObj) {
      const set = new Set(groupFilterObj.rowKeys);
      list = list.filter((r) => set.has(r._key));
    }
    if (filter === 'issues') list = list.filter((r) => issues.get(r._key)?.level);
    if (filter === 'excluded') list = list.filter((r) => !checked.has(r._key));
    return list;
  }, [draft, groupFilterObj, filter, issues, checked]);

  visibleKeysRef.current = visibleRows.map((r) => r._key);

  const rowNoByKey = useMemo(() => new Map(draft.map((r, i) => [r._key, i + 1])), [draft]);
  const showBirthDate = useMemo(() => draft.some((r) => r.birthDate.trim()), [draft]);

  const stats = useMemo(() => {
    let checkedCount = 0;
    let checkedErrors = 0;
    let issueCount = 0;
    for (const r of draft) {
      const lv = issues.get(r._key)?.level;
      if (lv) issueCount += 1;
      if (checked.has(r._key)) {
        checkedCount += 1;
        if (lv === 'error') checkedErrors += 1;
      }
    }
    const counts = { linked: 0, auto: 0, check: 0, loading: 0, error: 0, new: 0 };
    for (const g of groups) {
      if (g.checkedCount === 0) continue;
      counts[groupState(g)] += 1;
    }
    const individuals = showCompany
      ? draft.filter((r) => checked.has(r._key) && !companyGroupKeyOf(r)).length
      : 0;
    return {
      total: draft.length,
      checkedCount,
      checkedErrors,
      toRegister: checkedCount - checkedErrors,
      excluded: draft.length - checkedCount,
      issueCount,
      linkedGroups: counts.linked + counts.auto,
      newGroups: counts.new + counts.error,
      checkGroups: counts.check,
      loadingGroups: counts.loading,
      individuals
    };
  }, [draft, checked, issues, groups, groupState, showCompany]);

  const sortedGroups = useMemo(() => {
    const order = { check: 0, loading: 1, error: 2, new: 3, auto: 4, linked: 5 };
    return groups
      .map((g) => ({ g, state: groupState(g) }))
      .sort((a, b) => order[a.state] - order[b.state] || b.g.rowKeys.length - a.g.rowKeys.length);
  }, [groups, groupState]);

  /** 행마다 묶음을 찾지 않도록 묶음 키 → 상태 맵 (500행 × 수백 묶음 선형 탐색 방지) */
  const stateByGroupKey = useMemo(() => new Map(sortedGroups.map(({ g, state }) => [g.key, state])), [sortedGroups]);

  const visibleAllChecked = visibleRows.length > 0 && visibleRows.every((r) => checked.has(r._key));
  const visibleSomeChecked = !visibleAllChecked && visibleRows.some((r) => checked.has(r._key));

  const toggleVisibleAll = () => {
    const keys = visibleRows.map((r) => r._key);
    setChecked((prev) => {
      const n = new Set(prev);
      keys.forEach((k) => (visibleAllChecked ? n.delete(k) : n.add(k)));
      return n;
    });
  };

  const handleConfirm = () => {
    const rows = draft
      .filter((r) => checked.has(r._key) && issues.get(r._key)?.level !== 'error')
      .map(({ _key, _preLinkCompanyName, ...rest }) => rest);
    if (!rows.length) return;
    onConfirm?.(rows);
  };

  if (!open) return null;

  const hasGroups = showCompany && groups.length > 0;

  return (
    <div className="cipv-overlay" role="dialog" aria-modal="true" aria-labelledby="cipv-title">
      <div className="cipv-panel" ref={panelRef} tabIndex={-1}>
        {/* ---------- 헤더 ---------- */}
        <header className="cipv-header">
          <div className="cipv-header-main">
            <h3 id="cipv-title" className="cipv-title">
              연락처 등록 미리보기
            </h3>
            <p className="cipv-subtitle">
              값을 바로 고칠 수 있습니다. 체크한 행만 등록되며, 회사는 오른쪽 묶음에서 기존 고객사와 연결합니다.
            </p>
          </div>
          <div className="cipv-stats" aria-live="polite">
            <span className="cipv-stat is-primary">
              <strong>{stats.toRegister.toLocaleString()}</strong>명 등록
            </span>
            {hasGroups ? (
              <>
                <span className="cipv-stat is-linked">
                  <span className="material-symbols-outlined" aria-hidden>
                    link
                  </span>
                  기존 고객사 <strong>{stats.linkedGroups}</strong>
                </span>
                <span className="cipv-stat is-new">
                  <span className="material-symbols-outlined" aria-hidden>
                    add_business
                  </span>
                  신규 고객사 <strong>{stats.newGroups}</strong>
                </span>
                {stats.checkGroups > 0 ? (
                  <span className="cipv-stat is-check">
                    <span className="material-symbols-outlined" aria-hidden>
                      help
                    </span>
                    확인 필요 <strong>{stats.checkGroups}</strong>
                  </span>
                ) : null}
              </>
            ) : null}
          </div>
          <button type="button" className="cipv-close" onClick={() => onClose?.()} disabled={disabled} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>

        {/* ---------- 도구 줄 ---------- */}
        <div className="cipv-toolbar">
          <div className="cipv-tabs" role="tablist" aria-label="행 필터">
            {[
              ['all', '전체', stats.total],
              ['issues', '확인 필요', stats.issueCount],
              ['excluded', '제외됨', stats.excluded]
            ].map(([key, label, n]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={filter === key}
                className={`cipv-tab${filter === key ? ' is-active' : ''}${key === 'issues' && n > 0 ? ' has-issues' : ''}`}
                onClick={() => setFilter(key)}
              >
                {label}
                <span className="cipv-tab-count">{n.toLocaleString()}</span>
              </button>
            ))}
          </div>
          {groupFilterObj ? (
            <button type="button" className="cipv-filter-chip" onClick={() => setGroupFilter(null)}>
              <span className="material-symbols-outlined" aria-hidden>
                business
              </span>
              {groupFilterObj.displayName}
              <span className="material-symbols-outlined" aria-hidden>
                close
              </span>
            </button>
          ) : null}
          {fixedCompany ? (
            <span className="cipv-fixed-note">
              <span className="material-symbols-outlined" aria-hidden>
                lock
              </span>
              모든 연락처가 현재 고객사에 등록됩니다
            </span>
          ) : null}
          <span className="cipv-toolbar-hint">Shift+클릭으로 여러 행을 한 번에 체크</span>
        </div>

        {/* ---------- 본문 ---------- */}
        <div className={`cipv-body${hasGroups ? ' has-aside' : ''}`}>
          <div className="cipv-table-wrap">
            <table className="cipv-table">
              <thead>
                <tr>
                  <th className="cipv-th-check">
                    <input
                      type="checkbox"
                      className="cipv-check"
                      checked={visibleAllChecked}
                      ref={(el) => {
                        if (el) el.indeterminate = visibleSomeChecked;
                      }}
                      disabled={disabled || visibleRows.length === 0}
                      onChange={toggleVisibleAll}
                      aria-label="보이는 행 전체 선택"
                    />
                  </th>
                  <th className="cipv-th-no">#</th>
                  <th className="cipv-th-issue" aria-label="상태" />
                  <th>이름</th>
                  <th>전화</th>
                  <th>이메일</th>
                  {showCompany ? <th>회사</th> : null}
                  <th>직책</th>
                  <th>주소</th>
                  <th>메모</th>
                  {showBirthDate ? <th>생년월일</th> : null}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => {
                  const issue = issues.get(row._key) || { level: '', text: '' };
                  const gk = showCompany ? companyGroupKeyOf(row) : '';
                  return (
                    <PreviewRow
                      key={row._key}
                      row={row}
                      rowNo={rowNoByKey.get(row._key)}
                      checked={checked.has(row._key)}
                      issueLevel={issue.level}
                      issueText={issue.text}
                      companyState={gk ? stateByGroupKey.get(gk) || '' : ''}
                      groupKey={gk}
                      showCompany={showCompany}
                      showBirthDate={showBirthDate}
                      disabled={disabled}
                      onToggle={toggleRow}
                      onPatch={patchRow}
                      onUnlinkRow={unlinkSingleRow}
                      onFocusGroup={focusGroup}
                    />
                  );
                })}
              </tbody>
            </table>
            {visibleRows.length === 0 ? (
              <p className="cipv-empty">
                {filter === 'issues' ? '확인이 필요한 행이 없습니다.' : filter === 'excluded' ? '제외한 행이 없습니다.' : '표시할 행이 없습니다.'}
              </p>
            ) : null}
          </div>

          {hasGroups ? (
            <aside className="cipv-aside" aria-label="회사 묶음">
              <div className="cipv-aside-head">
                <h4>회사 묶음</h4>
                <span>
                  {groups.length}곳
                  {stats.loadingGroups > 0 ? ` · ${stats.loadingGroups}곳 확인 중` : ''}
                  {stats.individuals > 0 ? ` · 회사 없음 ${stats.individuals}명` : ''}
                </span>
              </div>
              <p className="cipv-aside-hint">
                같은 회사명(띄어쓰기·㈜·주식회사 차이 무시)은 한 묶음으로 처리됩니다. 묶음을 누르면 해당 행만 보여 줍니다.
              </p>
              <ul className="cipv-groups">
                {sortedGroups.map(({ g, state }) => (
                  <CompanyGroupCard
                    key={g.key}
                    group={g}
                    state={state}
                    similar={g.nameKey ? similar[g.nameKey] : null}
                    active={groupFilter === g.key}
                    disabled={disabled}
                    onFocus={focusGroup}
                    onLink={linkGroup}
                    onUnlink={unlinkGroup}
                    onDismiss={dismissName}
                    onUndismiss={undismissName}
                    onSearch={(grp) => setSearchCtx({ groupKey: grp.key, initialQuery: grp.displayName })}
                  />
                ))}
              </ul>
            </aside>
          ) : null}
        </div>

        {/* ---------- 푸터 ---------- */}
        <footer className="cipv-footer">
          <p className="cipv-footer-note">
            {stats.checkedErrors > 0 ? (
              <span className="is-error">등록할 수 없는 {stats.checkedErrors}행은 제외하고 등록합니다. </span>
            ) : null}
            {stats.checkGroups > 0 ? (
              <span className="is-check">
                확인하지 않은 회사 {stats.checkGroups}곳은 신규 고객사로 만들어집니다.
              </span>
            ) : null}
          </p>
          <div className="cipv-footer-actions">
            <button type="button" className="cipv-btn cipv-btn--lg" onClick={() => onClose?.()} disabled={disabled}>
              취소
            </button>
            <button
              type="button"
              className="cipv-btn cipv-btn--lg cipv-btn--primary"
              onClick={handleConfirm}
              disabled={disabled || stats.toRegister === 0}
            >
              <span className="material-symbols-outlined" aria-hidden>
                {bulkSaving ? 'hourglass_empty' : 'check_circle'}
              </span>
              {bulkSaving ? '등록 중…' : `${stats.toRegister.toLocaleString()}명 등록`}
            </button>
          </div>
        </footer>
      </div>

      {searchCtx ? (
        <CustomerCompanySearchModal
          key={`cipv-search-${searchCtx.groupKey}`}
          initialSearchQuery={searchCtx.initialQuery}
          includeSimilarSearch
          onClose={() => setSearchCtx(null)}
          onSelect={(company) => {
            linkGroup(searchCtx.groupKey, company);
            setSearchCtx(null);
          }}
        />
      ) : null}
    </div>
  );
}
