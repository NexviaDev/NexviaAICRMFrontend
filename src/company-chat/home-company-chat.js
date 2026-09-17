import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { API_BASE } from '@/config';
import { crmFetchInit } from '@/lib/crm-auth';
import { COMPANY_CHAT_POLL_MS } from '@/lib/polling-intervals';
import { COMPANY_CHAT_OPEN_EVENT } from '@/company-chat/company-chat-events';
import { answerWithBrowserOllama } from '@/lib/browser-ollama';
import './home-company-chat.css';

const PANEL_SIZE_STORAGE_KEY = 'nexvia-company-chat-panel-size-v1';
const LOCAL_AI_STORAGE_KEY = 'nexvia-support-use-local-ai';
const DEFAULT_PANEL_SIZE = { w: 420, h: 620 };
const MIN_PANEL_SIZE = { w: 340, h: 420 };
const AI_MENTION_SPLIT_RE = /(@(?:AI|Ai|ai|에이아이)(?=[\s,.!?:;…)\]」』"'”}]|$))/g;
const AI_MENTION_TOKEN_RE = /^@(?:AI|Ai|ai|에이아이)$/;
const AI_MENTION_TEST_RE = /(?:^|[\s([{「『"'“])@(?:AI|Ai|ai|에이아이)(?=[\s,.!?:;…)\]」』"'”}]|$)/u;

function messageHasAiMention(text) {
  return AI_MENTION_TEST_RE.test(String(text || ''));
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function previewText(text, max = 80) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (raw.length <= max) return raw;
  return `${raw.slice(0, max)}…`;
}

/** 입력 커서 앞의 @검색어 (카카오톡식 멘션) */
function getActiveMentionQuery(text, caret) {
  const value = String(text || '');
  const pos = Math.max(0, Math.min(Number(caret) || 0, value.length));
  const before = value.slice(0, pos);
  const match = before.match(/(^|[\s([{「『"'“])@([^\s@]*)$/);
  if (!match) return null;
  const query = match[2] || '';
  const start = before.length - query.length - 1;
  return { start, end: pos, query };
}

function buildMentionSplitRegex(mentionNames) {
  const names = [...new Set((mentionNames || []).map((n) => String(n || '').trim()).filter(Boolean))].sort(
    (a, b) => b.length - a.length
  );
  const nameAlt = names.map(escapeRegExp).join('|');
  const aiAlt = 'AI|Ai|ai|에이아이';
  const body = nameAlt ? `${aiAlt}|${nameAlt}` : aiAlt;
  return new RegExp(`(@(?:${body})(?=[\\s,.!?:;…)\\]」』"'”}]|$))`, 'g');
}

function isAiMentionToken(part) {
  return AI_MENTION_TOKEN_RE.test(part);
}

function isUserMentionToken(part, mentionNames) {
  if (!part || part[0] !== '@') return false;
  const name = part.slice(1);
  return (mentionNames || []).some((n) => n === name);
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function readPanelSize() {
  try {
    const raw = window.localStorage.getItem(PANEL_SIZE_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PANEL_SIZE };
    const parsed = JSON.parse(raw);
    const w = Number(parsed?.w);
    const h = Number(parsed?.h);
    if (!Number.isFinite(w) || !Number.isFinite(h)) return { ...DEFAULT_PANEL_SIZE };
    return { w, h };
  } catch (_) {
    return { ...DEFAULT_PANEL_SIZE };
  }
}

function maxPanelSize() {
  if (typeof window === 'undefined') return { w: 520, h: 820 };
  return {
    w: Math.max(MIN_PANEL_SIZE.w, Math.floor(window.innerWidth - 24)),
    h: Math.max(MIN_PANEL_SIZE.h, Math.floor(window.innerHeight - 88))
  };
}

function normalizePanelSize(size) {
  const max = maxPanelSize();
  return {
    w: clamp(Number(size?.w) || DEFAULT_PANEL_SIZE.w, MIN_PANEL_SIZE.w, max.w),
    h: clamp(Number(size?.h) || DEFAULT_PANEL_SIZE.h, MIN_PANEL_SIZE.h, max.h)
  };
}

function formatTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function readLocalUser() {
  try {
    const raw = localStorage.getItem('crm_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function isEligibleLocalUser(user) {
  if (!user) return false;
  const role = String(user.role || '').trim().toLowerCase();
  if (role === 'pending') return false;
  return Boolean(user.companyId || user.company?._id || user.companyName);
}

function readLocalAiPref() {
  try {
    return window.localStorage.getItem(LOCAL_AI_STORAGE_KEY) === '1';
  } catch (_) {
    return false;
  }
}

function isMobileSupportClient() {
  if (typeof window === 'undefined') return false;
  try {
    return window.matchMedia('(max-width: 768px)').matches;
  } catch (_) {
    return false;
  }
}

function mergeMessagesById(prev, ...incoming) {
  const map = new Map();
  for (const m of prev || []) {
    const id = String(m?.id || '');
    if (id) map.set(id, m);
  }
  for (const m of incoming) {
    if (!m) continue;
    const id = String(m.id || '');
    if (!id) continue;
    map.set(id, m);
  }
  return Array.from(map.values()).sort((a, b) => {
    const ta = new Date(a.createdAt || 0).getTime();
    const tb = new Date(b.createdAt || 0).getTime();
    if (ta !== tb) return ta - tb;
    return String(a.id).localeCompare(String(b.id));
  });
}

function renderMessageBody(text, mentionNames = []) {
  const raw = String(text || '');
  const splitRe = mentionNames.length ? buildMentionSplitRegex(mentionNames) : AI_MENTION_SPLIT_RE;
  const parts = raw.split(splitRe);
  return parts.map((part, i) => {
    if (isAiMentionToken(part)) {
      return (
        <span key={`m-${i}`} className="home-company-chat-ai-mention">
          <span className="home-company-chat-ai-mention-icon" aria-hidden>
            smart_toy
          </span>
          {part}
        </span>
      );
    }
    if (isUserMentionToken(part, mentionNames)) {
      return (
        <span key={`u-${i}`} className="home-company-chat-user-mention">
          {part}
        </span>
      );
    }
    return <span key={`t-${i}`}>{part}</span>;
  });
}

function citationHref(c) {
  if (c?.href) return c.href;
  if (c?.contactId) {
    return `/customer-company-employees?modal=detail&id=${encodeURIComponent(c.contactId)}`;
  }
  if (c?.companyId) {
    return `/customer-companies?modal=detail&id=${encodeURIComponent(c.companyId)}`;
  }
  if (c?.salesId) {
    return `/sales-pipeline?oppModal=edit&oppId=${encodeURIComponent(c.salesId)}`;
  }
  if (c?.employeeId) {
    return `/reports/work-report/${encodeURIComponent(c.employeeId)}`;
  }
  return null;
}

function MessageBubble({
  m,
  mentionNames,
  onReply,
  onJumpToReply,
  onConfirmAction,
  confirmingActionId,
  onPreviewImage
}) {
  const isAi = m.senderKind === 'ai';
  const cites = Array.isArray(m.citations) ? m.citations : [];
  const pending = m.actionPayload;
  const replyTo = m.replyTo;
  const hasAiMention = !isAi && messageHasAiMention(m.body);
  const needCompany =
    isAi &&
    (pending?.type === 'calendar.create' || pending?.type === 'journal.create') &&
    Array.isArray(pending.candidates) &&
    pending.candidates.length > 0 &&
    !pending.resolvedAt;
  const needContactConfirm =
    isAi && pending?.type === 'contact.create' && !pending.resolvedAt;
  const needCustomerCompanyConfirm =
    isAi && pending?.type === 'customerCompany.create' && !pending.resolvedAt;
  const contactCandidates = Array.isArray(pending?.candidates) ? pending.candidates : [];
  const contactNeedsCompanyPick = needContactConfirm && contactCandidates.length > 0;
  const companyCandidates = contactCandidates;
  const companyNeedsPick = needCustomerCompanyConfirm && companyCandidates.length > 0;
  const [selectedId, setSelectedId] = useState('');
  const confirming = confirmingActionId === m.id;
  const senderLabel = isAi ? 'CRM 도우미' : m.sender?.name || '멤버';
  const draft = pending?.draft || {};

  const contactConfirmReady = needContactConfirm
    ? contactNeedsCompanyPick
      ? Boolean(selectedId)
      : true
    : false;
  const customerCompanyConfirmReady = needCustomerCompanyConfirm
    ? companyNeedsPick
      ? Boolean(selectedId)
      : true
    : false;

  return (
    <div
      className={`home-company-chat-msg${m.mine ? ' is-mine' : ''}`}
      data-message-id={m.id}
    >
      <div
        className={`home-company-chat-bubble${m.mine ? ' is-mine' : ''}${isAi ? ' is-ai' : ''}${hasAiMention ? ' has-ai-mention' : ''}${m.mentionsMe ? ' mentions-me' : ''}`}
      >
        {!m.mine ? (
          <span className="home-company-chat-bubble-name">{senderLabel}</span>
        ) : null}
        {hasAiMention ? (
          <span className="home-company-chat-msg-ai-badge" title="AI 호출">
            <span className="material-symbols-outlined" aria-hidden>
              smart_toy
            </span>
            AI
          </span>
        ) : null}
        {replyTo ? (
          <button
            type="button"
            className="home-company-chat-reply-quote"
            onClick={() => onJumpToReply?.(replyTo.messageId)}
            title="원본 메시지로 이동"
          >
            <strong>{replyTo.senderName || '대화 상대'}</strong>
            <span>{replyTo.bodyPreview || '메시지'}</span>
          </button>
        ) : null}
        {Array.isArray(m.imageAttachments) && m.imageAttachments.length ? (
          <ul className="home-company-chat-msg-thumbs">
            {m.imageAttachments.map((img, idx) => (
              <li key={String(img.id || img.url || idx)}>
                <button
                  type="button"
                  className="home-company-chat-msg-thumb"
                  title="클릭하여 확대"
                  onClick={() => onPreviewImage?.(img)}
                >
                  <img src={img.url} alt={img.name || '첨부 이미지'} />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <p>{renderMessageBody(m.body, mentionNames)}</p>
        {needContactConfirm ? (
          <div className="home-company-chat-pick">
            <p className="home-company-chat-pick-label">명함 인식 결과</p>
            <ul className="home-company-chat-draft-list">
              {draft.name ? (
                <li>
                  <em>이름</em>
                  <strong>{draft.name}</strong>
                </li>
              ) : null}
              {draft.companyName ? (
                <li>
                  <em>고객사</em>
                  <strong>{draft.companyName}</strong>
                </li>
              ) : null}
              {draft.position ? (
                <li>
                  <em>직책</em>
                  <strong>{draft.position}</strong>
                </li>
              ) : null}
              {draft.phone ? (
                <li>
                  <em>전화</em>
                  <strong>{draft.phone}</strong>
                </li>
              ) : null}
              {draft.email ? (
                <li>
                  <em>이메일</em>
                  <strong>{draft.email}</strong>
                </li>
              ) : null}
              {draft.address ? (
                <li>
                  <em>주소</em>
                  <strong>{draft.address}</strong>
                </li>
              ) : null}
            </ul>
            {contactNeedsCompanyPick ? (
              <>
                <p className="home-company-chat-pick-label">고객사 연결</p>
                <ul className="home-company-chat-pick-list">
                  {contactCandidates.map((c) => {
                    const id = String(c.id);
                    const checked = selectedId === id;
                    return (
                      <li key={id}>
                        <label className={checked ? 'is-checked' : ''}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={confirming}
                            onChange={() => setSelectedId((prev) => (prev === id ? '' : id))}
                          />
                          <span>
                            <strong>{c.name || '고객사'}</strong>
                            {c.address ? <em>{c.address}</em> : null}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                  {pending.allowNewCompany ? (
                    <li>
                      <label className={selectedId === '__new__' ? 'is-checked' : ''}>
                        <input
                          type="checkbox"
                          checked={selectedId === '__new__'}
                          disabled={confirming}
                          onChange={() =>
                            setSelectedId((prev) => (prev === '__new__' ? '' : '__new__'))
                          }
                        />
                        <span>
                          <strong>신규 고객사로 등록</strong>
                          <em>{draft.companyName || '명함의 회사명'}</em>
                        </span>
                      </label>
                    </li>
                  ) : null}
                </ul>
              </>
            ) : null}
            <button
              type="button"
              className="home-company-chat-pick-confirm"
              disabled={!contactConfirmReady || confirming}
              onClick={() =>
                onConfirmAction?.(
                  m.id,
                  contactNeedsCompanyPick
                    ? selectedId
                    : draft.companyName
                      ? '__new__'
                      : ''
                )
              }
            >
              {confirming ? '등록 중…' : '확인 · 연락처 등록'}
            </button>
          </div>
        ) : null}
        {needCustomerCompanyConfirm ? (
          <div className="home-company-chat-pick">
            <p className="home-company-chat-pick-label">업체 인식 결과</p>
            <ul className="home-company-chat-draft-list">
              {draft.name ? (
                <li>
                  <em>상호</em>
                  <strong>{draft.name}</strong>
                </li>
              ) : null}
              {draft.businessNumber ? (
                <li>
                  <em>사업자번호</em>
                  <strong>{draft.businessNumber}</strong>
                </li>
              ) : null}
              {draft.representativeName ? (
                <li>
                  <em>대표자</em>
                  <strong>{draft.representativeName}</strong>
                </li>
              ) : null}
              {draft.address ? (
                <li>
                  <em>주소</em>
                  <strong>{draft.address}</strong>
                </li>
              ) : null}
            </ul>
            {companyNeedsPick ? (
              <>
                <p className="home-company-chat-pick-label">기존 고객사 / 신규</p>
                <ul className="home-company-chat-pick-list">
                  {companyCandidates.map((c) => {
                    const id = String(c.id);
                    const checked = selectedId === id;
                    return (
                      <li key={id}>
                        <label className={checked ? 'is-checked' : ''}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={confirming}
                            onChange={() => setSelectedId((prev) => (prev === id ? '' : id))}
                          />
                          <span>
                            <strong>{c.name || '고객사'}</strong>
                            {c.businessNumber ? <em>사업자 {c.businessNumber}</em> : null}
                            {c.address ? <em>{c.address}</em> : null}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                  {pending.allowNewCompany !== false ? (
                    <li>
                      <label className={selectedId === '__new__' ? 'is-checked' : ''}>
                        <input
                          type="checkbox"
                          checked={selectedId === '__new__'}
                          disabled={confirming}
                          onChange={() =>
                            setSelectedId((prev) => (prev === '__new__' ? '' : '__new__'))
                          }
                        />
                        <span>
                          <strong>신규 고객사로 등록</strong>
                          <em>{draft.name || '인식된 상호'}</em>
                        </span>
                      </label>
                    </li>
                  ) : null}
                </ul>
              </>
            ) : null}
            <button
              type="button"
              className="home-company-chat-pick-confirm"
              disabled={!customerCompanyConfirmReady || confirming}
              onClick={() =>
                onConfirmAction?.(
                  m.id,
                  companyNeedsPick ? selectedId : '__new__'
                )
              }
            >
              {confirming ? '등록 중…' : '확인 · 업체 등록'}
            </button>
          </div>
        ) : null}
        {needCompany ? (
          <div className="home-company-chat-pick">
            <p className="home-company-chat-pick-label">고객사 선택 (하나)</p>
            <ul className="home-company-chat-pick-list">
              {pending.candidates.map((c) => {
                const id = String(c.id);
                const checked = selectedId === id;
                return (
                  <li key={id}>
                    <label className={checked ? 'is-checked' : ''}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={confirming}
                        onChange={() => setSelectedId((prev) => (prev === id ? '' : id))}
                      />
                      <span>
                        <strong>{c.name || '고객사'}</strong>
                        {c.address ? <em>{c.address}</em> : null}
                        {c.phone ? <em>전화 {c.phone}</em> : null}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <button
              type="button"
              className="home-company-chat-pick-confirm"
              disabled={!selectedId || confirming}
              onClick={() => onConfirmAction?.(m.id, selectedId)}
            >
              {confirming
                ? '등록 중…'
                : pending.type === 'journal.create'
                  ? '확인 · 일지 등록'
                  : '확인 · 일정 등록'}
            </button>
          </div>
        ) : null}
        {pending?.resolvedAt ? (
          <p className="home-company-chat-pick-done">선택이 완료되었습니다.</p>
        ) : null}
        {cites.length ? (
          <ul className="home-company-chat-cites">
            {cites.slice(0, 6).map((c) => {
              const href = citationHref(c);
              const label = c.label || c.id || '출처';
              return (
                <li key={String(c.id || label)}>
                  {href ? (
                    <Link to={href} onClick={() => {}}>
                      {label}
                    </Link>
                  ) : (
                    <span>{label}</span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : null}
        <time>{formatTime(m.createdAt)}</time>
      </div>
      <button
        type="button"
        className="home-company-chat-reply-btn"
        title="답장"
        aria-label={`${senderLabel} 메시지에 답장`}
        onClick={() => onReply?.(m)}
      >
        <span className="material-symbols-outlined" aria-hidden>
          reply
        </span>
      </button>
    </div>
  );
}

export default function HomeCompanyChat() {
  const titleId = useId();
  const localUser = useMemo(() => readLocalUser(), []);
  const eligible = isEligibleLocalUser(localUser);

  const [open, setOpen] = useState(false);
  const [panelSize, setPanelSize] = useState(() =>
    typeof window === 'undefined' ? { ...DEFAULT_PANEL_SIZE } : normalizePanelSize(readPanelSize())
  );
  const [view, setView] = useState('rooms'); // rooms | chat | create | invite
  const [rooms, setRooms] = useState([]);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [roomsError, setRoomsError] = useState('');
  const [activeRoomId, setActiveRoomId] = useState('');
  const [activeRoom, setActiveRoom] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [directory, setDirectory] = useState([]);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryError, setDirectoryError] = useState('');
  const [createTitle, setCreateTitle] = useState('');
  const [selectedMemberIds, setSelectedMemberIds] = useState([]);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState('');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [aiThinking, setAiThinking] = useState(false);
  const [isMobile, setIsMobile] = useState(() => isMobileSupportClient());
  const [useLocalAi, setUseLocalAi] = useState(false);
  const [confirmingActionId, setConfirmingActionId] = useState('');
  const [replyingTo, setReplyingTo] = useState(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [caret, setCaret] = useState(0);
  const [uploadingCard, setUploadingCard] = useState(false);
  const [pendingImages, setPendingImages] = useState([]);
  const [previewImage, setPreviewImage] = useState(null);
  const [composerDropActive, setComposerDropActive] = useState(false);

  const listRef = useRef(null);
  const inputRef = useRef(null);
  const pendingImagesRef = useRef([]);

  useEffect(() => {
    pendingImagesRef.current = pendingImages;
  }, [pendingImages]);

  useEffect(() => {
    return () => {
      pendingImagesRef.current.forEach((img) => {
        try {
          URL.revokeObjectURL(img.url);
        } catch (_) {
          /* ignore */
        }
      });
    };
  }, []);
  const panelSizeRef = useRef(panelSize);
  const resizeSessionRef = useRef(null);
  const activeRoomIdRef = useRef('');
  const sendingRef = useRef(false);
  const composingRef = useRef(false);

  useEffect(() => {
    setUseLocalAi(readLocalAiPref());
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener?.('change', sync);
    return () => mq.removeEventListener?.('change', sync);
  }, []);

  useEffect(() => {
    panelSizeRef.current = panelSize;
  }, [panelSize]);

  useEffect(() => {
    activeRoomIdRef.current = activeRoomId;
  }, [activeRoomId]);

  const persistPanelSize = useCallback((next) => {
    const normalized = normalizePanelSize(next);
    setPanelSize(normalized);
    try {
      window.localStorage.setItem(PANEL_SIZE_STORAGE_KEY, JSON.stringify(normalized));
    } catch (_) {
      /* ignore */
    }
  }, []);

  const loadRooms = useCallback(async () => {
    setRoomsError('');
    setRoomsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/company-chat/rooms`, crmFetchInit());
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '채팅방 목록을 불러오지 못했습니다.');
      setRooms(Array.isArray(data.rooms) ? data.rooms : []);
    } catch (err) {
      setRooms([]);
      setRoomsError(err.message || '채팅방 목록을 불러오지 못했습니다.');
    } finally {
      setRoomsLoading(false);
    }
  }, []);

  const loadDirectory = useCallback(async () => {
    setDirectoryLoading(true);
    setDirectoryError('');
    try {
      const res = await fetch(`${API_BASE}/company-chat/directory`, crmFetchInit());
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.members) && data.members.length) {
        setDirectory(data.members);
        return;
      }
      // 빈 배열·오류여도 사내 현황으로 한 번 더 맞춤
      const ov = await fetch(`${API_BASE}/companies/overview`, crmFetchInit());
      const ovData = await ov.json().catch(() => ({}));
      if (!ov.ok) {
        if (res.ok && Array.isArray(data.members)) {
          setDirectory(data.members);
          return;
        }
        throw new Error(data.error || ovData.error || '직원 목록을 불러오지 못했습니다.');
      }
      const rows = (Array.isArray(ovData.employees) ? ovData.employees : [])
        .filter((e) => String(e?.role || '').toLowerCase() !== 'pending')
        .map((e) => ({
          id: String(e.id || e._id || ''),
          name: e.name || e.email || '직원',
          email: e.email || '',
          avatar: e.avatar || '',
          role: e.role || '',
          department: e.department || '',
          position: e.position || e.title || ''
        }))
        .filter((e) => e.id);
      if (rows.length) {
        setDirectory(rows);
        return;
      }
      setDirectory(Array.isArray(data.members) ? data.members : []);
      if (data.error) setDirectoryError(data.error);
    } catch (err) {
      setDirectory([]);
      setDirectoryError(err.message || '직원 목록을 불러오지 못했습니다.');
    } finally {
      setDirectoryLoading(false);
    }
  }, []);

  const loadMessages = useCallback(async (roomId, { silent = false } = {}) => {
    if (!roomId) return;
    if (silent && sendingRef.current) return;
    if (!silent) {
      setMessagesLoading(true);
      setMessagesError('');
    }
    try {
      const res = await fetch(
        `${API_BASE}/company-chat/rooms/${encodeURIComponent(roomId)}/messages?limit=80`,
        crmFetchInit()
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 403 || res.status === 404) {
          setActiveRoomId('');
          setActiveRoom(null);
          setMessages([]);
          setView('rooms');
          setMessagesError(data.error || '이 채팅방을 열람할 수 없습니다.');
          await loadRooms();
          return;
        }
        throw new Error(data.error || '메시지를 불러오지 못했습니다.');
      }
      if (silent && sendingRef.current) return;
      setActiveRoom(data.room || null);
      setMessages(Array.isArray(data.messages) ? data.messages : []);
      setMessagesError('');
    } catch (err) {
      if (!silent) setMessagesError(err.message || '메시지를 불러오지 못했습니다.');
    } finally {
      if (!silent) setMessagesLoading(false);
    }
  }, [loadRooms]);

  const openRoom = useCallback(
    async (roomId) => {
      const id = String(roomId || '').trim();
      if (!id) return;
      setOpen(true);
      setActiveRoomId(id);
      setView('chat');
      setDraft('');
      setReplyingTo(null);
      setMentionIndex(0);
      setCaret(0);
      setPreviewImage(null);
      setPendingImages((prev) => {
        prev.forEach((img) => {
          try {
            URL.revokeObjectURL(img.url);
          } catch (_) {
            /* ignore */
          }
        });
        return [];
      });
      await loadMessages(id);
    },
    [loadMessages]
  );

  useEffect(() => {
    if (!eligible) return undefined;
    const onOpen = (e) => {
      const roomId = String(e?.detail?.roomId || '').trim();
      const wantCreate = e?.detail?.create === true;
      setOpen(true);
      if (roomId) {
        openRoom(roomId);
        return;
      }
      if (wantCreate) {
        setView('create');
        setCreateTitle(String(e?.detail?.title || '').trim());
        setSelectedMemberIds(
          Array.isArray(e?.detail?.memberIds)
            ? e.detail.memberIds.map((id) => String(id)).filter(Boolean)
            : []
        );
        setCreateError('');
        loadDirectory();
        return;
      }
      setView('rooms');
      loadRooms();
    };
    window.addEventListener(COMPANY_CHAT_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(COMPANY_CHAT_OPEN_EVENT, onOpen);
  }, [eligible, openRoom, loadRooms, loadDirectory]);

  useEffect(() => {
    if (!open || !eligible) return undefined;
    if (view === 'rooms') loadRooms();
    if (view === 'create' || view === 'invite') loadDirectory();
    return undefined;
  }, [open, eligible, view, loadRooms, loadDirectory]);

  useEffect(() => {
    if (!open || !eligible) return undefined;
    const tick = () => {
      if (view === 'rooms') loadRooms();
      const rid = activeRoomIdRef.current;
      if (view === 'chat' && rid) loadMessages(rid, { silent: true });
    };
    const id = window.setInterval(tick, COMPANY_CHAT_POLL_MS);
    return () => window.clearInterval(id);
  }, [open, eligible, view, loadRooms, loadMessages]);

  useEffect(() => {
    if (!open || view !== 'chat') return undefined;
    const t = window.setTimeout(() => inputRef.current?.focus(), 80);
    return () => window.clearTimeout(t);
  }, [open, view, activeRoomId]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, open, view, aiThinking]);

  useEffect(() => {
    const onResize = () => setPanelSize((prev) => normalizePanelSize(prev));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const onResizePointerDown = useCallback(
    (e) => {
      if (e.button != null && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      const startW = panelSizeRef.current.w;
      const startH = panelSizeRef.current.h;
      const pointerId = e.pointerId;
      const target = e.currentTarget;
      resizeSessionRef.current = { startX, startY, startW, startH };
      try {
        target.setPointerCapture(pointerId);
      } catch (_) {
        /* ignore */
      }
      const onMove = (ev) => {
        const s = resizeSessionRef.current;
        if (!s) return;
        const dw = s.startX - ev.clientX;
        const dh = s.startY - ev.clientY;
        persistPanelSize({ w: s.startW + dw, h: s.startH + dh });
      };
      const onUp = () => {
        resizeSessionRef.current = null;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [persistPanelSize]
  );

  const myId = String(localUser?._id || localUser?.id || '');
  const myIds = useMemo(() => {
    const s = new Set();
    [localUser?._id, localUser?.id, myId].forEach((v) => {
      const id = String(v || '').trim();
      if (id) s.add(id);
    });
    return s;
  }, [localUser, myId]);

  const toggleMember = (id) => {
    const uid = String(id);
    setSelectedMemberIds((prev) =>
      prev.includes(uid) ? prev.filter((x) => x !== uid) : [...prev, uid]
    );
  };

  const createRoom = async (e) => {
    e?.preventDefault?.();
    const title = String(createTitle || '').trim();
    if (!title) {
      setCreateError('채팅방 이름을 입력해 주세요.');
      return;
    }
    setCreateBusy(true);
    setCreateError('');
    try {
      const res = await fetch(`${API_BASE}/company-chat/rooms`, {
        ...crmFetchInit(),
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(crmFetchInit().headers || {}) },
        body: JSON.stringify({ title, memberIds: selectedMemberIds })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '채팅방 생성에 실패했습니다.');
      const roomId = String(data?.room?.id || '');
      setCreateTitle('');
      setSelectedMemberIds([]);
      await loadRooms();
      if (roomId) await openRoom(roomId);
      else setView('rooms');
    } catch (err) {
      setCreateError(err.message || '채팅방 생성에 실패했습니다.');
    } finally {
      setCreateBusy(false);
    }
  };

  const inviteMembers = async (e) => {
    e?.preventDefault?.();
    if (!activeRoomId) return;
    const already = new Set((activeRoom?.memberIds || []).map(String));
    const addMemberIds = selectedMemberIds.filter((id) => !already.has(String(id)));
    if (!addMemberIds.length) {
      setInviteError('새로 초대할 직원을 선택해 주세요.');
      return;
    }
    setInviteBusy(true);
    setInviteError('');
    try {
      const res = await fetch(
        `${API_BASE}/company-chat/rooms/${encodeURIComponent(activeRoomId)}/members`,
        {
          ...crmFetchInit(),
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(crmFetchInit().headers || {}) },
          body: JSON.stringify({ addMemberIds })
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '초대에 실패했습니다.');
      setActiveRoom(data.room || activeRoom);
      setSelectedMemberIds([]);
      setView('chat');
      await loadMessages(activeRoomId, { silent: true });
    } catch (err) {
      setInviteError(err.message || '초대에 실패했습니다.');
    } finally {
      setInviteBusy(false);
    }
  };

  const isAiRoom = activeRoom?.kind === 'ai';
  const myUserId = String(localUser?.id || localUser?._id || '');

  const mentionCandidates = useMemo(() => {
    const members = Array.isArray(activeRoom?.members) ? activeRoom.members : [];
    const list = [];
    if (!isAiRoom) {
      list.push({
        id: 'ai',
        name: 'AI',
        kind: 'ai',
        subtitle: 'CRM 도우미',
        insertToken: '@AI'
      });
    }
    for (const m of members) {
      const id = String(m?.id || '');
      const name = String(m?.name || '').trim();
      if (!id || !name || id === myUserId) continue;
      list.push({
        id,
        name,
        kind: 'user',
        subtitle: m.department || m.email || '',
        insertToken: `@${name}`
      });
    }
    return list;
  }, [activeRoom?.members, isAiRoom, myUserId]);

  const mentionNames = useMemo(
    () => mentionCandidates.filter((c) => c.kind === 'user').map((c) => c.name),
    [mentionCandidates]
  );

  const activeMention = useMemo(() => getActiveMentionQuery(draft, caret), [draft, caret]);

  const filteredMentions = useMemo(() => {
    if (!activeMention) return [];
    const q = String(activeMention.query || '').toLowerCase();
    if (!q) return mentionCandidates;
    return mentionCandidates.filter((c) => {
      const hay = `${c.name} ${c.subtitle}`.toLowerCase();
      return hay.includes(q);
    });
  }, [activeMention, mentionCandidates]);

  useEffect(() => {
    setMentionIndex(0);
  }, [activeMention?.start, activeMention?.query, filteredMentions.length]);

  const syncCaret = useCallback(() => {
    if (composingRef.current) return;
    const el = inputRef.current;
    if (!el) return;
    setCaret(el.selectionStart ?? String(draft || '').length);
  }, [draft]);

  const onDraftChange = useCallback((e) => {
    const next = e.target.value;
    // 한글 IME 조합 중에는 caret state만 건드리지 않음 (자모 분리 방지)
    if (!composingRef.current) {
      setCaret(e.target.selectionStart ?? next.length);
    }
    setDraft(next);
  }, []);

  const applyMention = useCallback(
    (candidate) => {
      if (!candidate || !activeMention) return;
      const cur = String(draft || '');
      const before = cur.slice(0, activeMention.start);
      const after = cur.slice(activeMention.end);
      const token = `${candidate.insertToken} `;
      const next = `${before}${token}${after}`;
      const nextCaret = before.length + token.length;
      setDraft(next);
      setCaret(nextCaret);
      window.requestAnimationFrame(() => {
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(nextCaret, nextCaret);
      });
    },
    [activeMention, draft]
  );

  const startReply = useCallback((message) => {
    if (!message?.id) return;
    setReplyingTo(message);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const cancelReply = useCallback(() => setReplyingTo(null), []);

  const jumpToReply = useCallback((messageId) => {
    const id = String(messageId || '').trim();
    if (!id || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-message-id="${id}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('is-flash');
    window.setTimeout(() => el.classList.remove('is-flash'), 1200);
  }, []);

  const openMentionPicker = useCallback(() => {
    const el = inputRef.current;
    const cur = String(draft || '');
    const caret = el?.selectionStart ?? cur.length;
    const before = cur.slice(0, caret);
    const after = cur.slice(caret);
    const needsAt = !/(^|[\s([{「『"'“])@$/.test(before);
    const insert = needsAt ? (before && !/\s$/.test(before) ? ' @' : '@') : '';
    const next = `${before}${insert}${after}`;
    const nextCaret = before.length + insert.length;
    setDraft(next);
    setCaret(nextCaret);
    window.requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(nextCaret, nextCaret);
    });
  }, [draft]);

  const onComposerKeyDown = useCallback(
    (e) => {
      if (composingRef.current || e.nativeEvent?.isComposing) return;
      if (filteredMentions.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setMentionIndex((i) => (i + 1) % filteredMentions.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setMentionIndex((i) => (i - 1 + filteredMentions.length) % filteredMentions.length);
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          applyMention(filteredMentions[mentionIndex] || filteredMentions[0]);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          const cur = String(draft || '');
          const m = activeMention;
          if (m) {
            const next = `${cur.slice(0, m.start)}${cur.slice(m.end)}`;
            setDraft(next);
            setCaret(m.start);
          }
          return;
        }
      }
      if (e.key === 'Escape' && replyingTo) {
        e.preventDefault();
        cancelReply();
      }
    },
    [
      filteredMentions,
      mentionIndex,
      applyMention,
      draft,
      activeMention,
      replyingTo,
      cancelReply
    ]
  );

  const onToggleLocalAi = useCallback((checked) => {
    if (isMobileSupportClient()) {
      setUseLocalAi(false);
      try {
        window.localStorage.setItem(LOCAL_AI_STORAGE_KEY, '0');
      } catch (_) {
        /* ignore */
      }
      return;
    }
    setUseLocalAi(checked);
    try {
      window.localStorage.setItem(LOCAL_AI_STORAGE_KEY, checked ? '1' : '0');
    } catch (_) {
      /* ignore */
    }
  }, []);

  const effectiveUseLocalAi = isMobile ? false : useLocalAi;

  const persistAiReply = useCallback(
    async (roomId, { answer, citations, aiMode }) => {
      const res = await fetch(
        `${API_BASE}/company-chat/rooms/${encodeURIComponent(roomId)}/ai-reply`,
        {
          ...crmFetchInit(),
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(crmFetchInit().headers || {}) },
          body: JSON.stringify({ answer, citations, aiMode })
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'AI 답변 저장에 실패했습니다.');
      return data.aiMessage || null;
    },
    []
  );

  const clearPendingImages = useCallback(() => {
    setPendingImages((prev) => {
      prev.forEach((img) => {
        try {
          URL.revokeObjectURL(img.url);
        } catch (_) {
          /* ignore */
        }
      });
      return [];
    });
  }, []);

  const removePendingImage = useCallback((id) => {
    setPendingImages((prev) => {
      const target = prev.find((x) => x.id === id);
      if (target) {
        try {
          URL.revokeObjectURL(target.url);
        } catch (_) {
          /* ignore */
        }
      }
      return prev.filter((x) => x.id !== id);
    });
    setPreviewImage((cur) => (cur?.id === id ? null : cur));
  }, []);

  const addPendingImages = useCallback((fileList) => {
    const files = Array.from(fileList || []).filter(Boolean);
    if (!files.length) return;
    const accepted = [];
    for (const file of files) {
      const okType = /^image\/(jpeg|png|webp|gif)$/i.test(file.type || '');
      if (!okType) {
        setMessagesError('이미지는 jpg/png/webp/gif 만 첨부할 수 있습니다.');
        continue;
      }
      if (file.size > 10 * 1024 * 1024) {
        setMessagesError('이미지는 10MB 이하여야 합니다.');
        continue;
      }
      accepted.push(file);
    }
    if (!accepted.length) return;
    setMessagesError('');
    setPendingImages((prev) => {
      const room = 4 - prev.length;
      if (room <= 0) {
        setMessagesError('이미지는 최대 4장까지 첨부할 수 있습니다.');
        return prev;
      }
      const next = accepted.slice(0, room).map((file) => ({
        id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        url: URL.createObjectURL(file),
        name: file.name || 'image'
      }));
      return [...prev, ...next];
    });
  }, []);

  const uploadBusinessCard = useCallback(
    async (file, caption = '') => {
      if (!file || !activeRoomId) return null;
      const form = new FormData();
      form.append('file', file);
      const note = String(caption || '').trim();
      if (note) form.append('caption', note);
      const init = crmFetchInit();
      const headers = { ...(init.headers || {}) };
      delete headers['Content-Type'];
      const res = await fetch(
        `${API_BASE}/company-chat/rooms/${encodeURIComponent(activeRoomId)}/business-card`,
        {
          ...init,
          method: 'POST',
          headers,
          body: form
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '이미지 처리에 실패했습니다.');
      return data;
    },
    [activeRoomId]
  );

  const confirmCompanyAction = useCallback(
    async (messageId, selectedCompanyId) => {
      if (!activeRoomId || !messageId || confirmingActionId) return;
      setConfirmingActionId(messageId);
      setMessagesError('');
      try {
        const res = await fetch(
          `${API_BASE}/company-chat/rooms/${encodeURIComponent(activeRoomId)}/actions/confirm`,
          {
            ...crmFetchInit(),
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(crmFetchInit().headers || {}) },
            body: JSON.stringify({
              messageId,
              selectedCompanyId: selectedCompanyId || ''
            })
          }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || '확인에 실패했습니다.');
        setMessages((prev) => mergeMessagesById(prev, data.pendingMessage, data.aiMessage));
        loadRooms();
      } catch (err) {
        setMessagesError(err.message || '확인에 실패했습니다.');
      } finally {
        setConfirmingActionId('');
        window.requestAnimationFrame(() => inputRef.current?.focus());
      }
    },
    [activeRoomId, confirmingActionId, loadRooms]
  );

  const sendMessage = async (e) => {
    e?.preventDefault?.();
    const body = String(draft || '').trim();
    const images = pendingImages.slice();
    if ((!body && !images.length) || !activeRoomId || sendingRef.current) return;
    if (filteredMentions.length > 0) return;

    const roomId = activeRoomId;

    // 첨부 이미지 → 캡션 의도(설명 vs 등록) → AI 답변
    if (images.length) {
      sendingRef.current = true;
      setSending(true);
      setUploadingCard(true);
      setMessagesError('');
      setPreviewImage(null);
      setDraft('');
      setReplyingTo(null);

      const caption = body;
      const optimisticTemps = images.map((img, idx) => {
        const tempId = `local-card-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`;
        return {
          id: tempId,
          body: caption || '(이미지)',
          mine: true,
          senderKind: 'user',
          sender: { name: localUser?.name || '나' },
          citations: [],
          imageAttachments: [
            {
              id: img.id,
              url: img.url,
              name: img.name || '이미지'
            }
          ],
          createdAt: new Date(Date.now() + idx).toISOString()
        };
      });
      setMessages((prev) => [...prev, ...optimisticTemps]);
      setPendingImages([]); // URL은 optimistic 메시지에서 유지 → 나중에 revoke
      // 내 말풍선이 먼저 그려진 뒤 인식 중 표시 (같은 틱 배치 방지)
      window.setTimeout(() => {
        if (activeRoomIdRef.current === roomId) setAiThinking(true);
      }, 40);

      let uploadFailed = false;
      try {
        for (let i = 0; i < images.length; i += 1) {
          const data = await uploadBusinessCard(images[i].file, caption);
          if (activeRoomIdRef.current === roomId && data) {
            setMessages((prev) => {
              const withoutTemp = prev.filter((m) => m.id !== optimisticTemps[i]?.id);
              return mergeMessagesById(withoutTemp, data.userMessage, data.aiMessage);
            });
          }
        }
        loadRooms();
        // 이미지와 함께 보낸 문구는 이미 사용자 메시지로 저장됨
        return;
      } catch (err) {
        uploadFailed = true;
        if (activeRoomIdRef.current === roomId) {
          setMessages((prev) =>
            prev.filter((m) => !optimisticTemps.some((t) => t.id === m.id))
          );
          setPendingImages(images);
          setDraft(body);
        }
        setMessagesError(err.message || '이미지 처리에 실패했습니다.');
        return;
      } finally {
        if (!uploadFailed) {
          images.forEach((img) => {
            try {
              URL.revokeObjectURL(img.url);
            } catch (_) {
              /* ignore */
            }
          });
        }
        setUploadingCard(false);
        setAiThinking(false);
        sendingRef.current = false;
        setSending(false);
        window.requestAnimationFrame(() => inputRef.current?.focus());
      }
    }

    if (!body || sendingRef.current) return;

    const replyTarget = replyingTo;
    sendingRef.current = true;
    setSending(true);
    setMessagesError('');

    const wantsAi = isAiRoom || AI_MENTION_TEST_RE.test(body);
    const tempId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimisticReplyTo = replyTarget
      ? {
          messageId: replyTarget.id,
          bodyPreview: previewText(replyTarget.body, 200),
          senderName:
            replyTarget.senderKind === 'ai'
              ? 'CRM 도우미'
              : replyTarget.sender?.name || '멤버',
          senderKind: replyTarget.senderKind === 'ai' ? 'ai' : 'user',
          senderUserId: replyTarget.sender?.id || null
        }
      : null;
    const optimistic = {
      id: tempId,
      body,
      mine: true,
      senderKind: 'user',
      sender: { name: localUser?.name || '나' },
      citations: [],
      replyTo: optimisticReplyTo,
      createdAt: new Date().toISOString()
    };

    setDraft('');
    setReplyingTo(null);
    setCaret(0);
    setMessages((prev) => [...prev, optimistic]);
    if (wantsAi) setAiThinking(true);
    window.requestAnimationFrame(() => inputRef.current?.focus());

    const useLocal = isMobileSupportClient() ? false : useLocalAi;
    const stillInRoom = () => activeRoomIdRef.current === roomId;
    let savedUserMessage = false;

    try {
      const res = await fetch(
        `${API_BASE}/company-chat/rooms/${encodeURIComponent(roomId)}/messages`,
        {
          ...crmFetchInit(),
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(crmFetchInit().headers || {}) },
          body: JSON.stringify({
            body,
            useLocalAi: useLocal,
            replyToMessageId: replyTarget?.id || undefined
          })
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (stillInRoom()) {
          setMessages((prev) => prev.filter((m) => m.id !== tempId));
          setDraft(body);
          if (replyTarget) setReplyingTo(replyTarget);
        }
        if (res.status === 403 || res.status === 404) {
          setMessagesError(data.error || '이 채팅방을 열람할 수 없습니다.');
          setView('rooms');
          setActiveRoomId('');
          await loadRooms();
          return;
        }
        throw new Error(data.error || '전송에 실패했습니다.');
      }

      savedUserMessage = true;
      if (stillInRoom()) {
        setMessages((prev) => {
          const withoutTemp = prev.filter((m) => m.id !== tempId);
          return mergeMessagesById(withoutTemp, data.message);
        });
        setDraft('');
        inputRef.current?.focus();
      }

      if (data.needsAi && data.question) {
        if (stillInRoom()) setAiThinking(true);
        const aiRes = await fetch(
          `${API_BASE}/company-chat/rooms/${encodeURIComponent(roomId)}/ai-generate`,
          {
            ...crmFetchInit(),
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(crmFetchInit().headers || {}) },
            body: JSON.stringify({ question: data.question, useLocalAi: useLocal })
          }
        );
        const aiData = await aiRes.json().catch(() => ({}));
        if (!aiRes.ok) {
          throw new Error(aiData.error || 'AI 답변 생성에 실패했습니다.');
        }

        if (stillInRoom() && aiData.aiMessage) {
          setMessages((prev) => mergeMessagesById(prev, aiData.aiMessage));
        }

        if (useLocal && aiData.aiPending?.mode === 'needs-client-ollama') {
          try {
            const out = await answerWithBrowserOllama({
              prompt: aiData.aiPending.prompt,
              chunks: aiData.aiPending.chunks,
              model: aiData.aiPending.ollamaModel
            });
            const allCites = Array.isArray(aiData.aiPending.citations)
              ? aiData.aiPending.citations
              : [];
            const idSet = out.citationIds?.length
              ? new Set(out.citationIds)
              : new Set(allCites.map((c) => c.id));
            const cites = allCites.filter((c) => idSet.has(c.id));
            const answer =
              String(out.answer || '').trim() ||
              (cites.length ? '검색된 출처는 아래와 같습니다.' : '답변이 비어 있습니다.');
            const saved = await persistAiReply(roomId, {
              answer,
              citations: cites,
              aiMode: 'ollama-client'
            });
            if (stillInRoom() && saved) setMessages((prev) => mergeMessagesById(prev, saved));
          } catch (ollamaErr) {
            const allCites = Array.isArray(aiData.aiPending.citations)
              ? aiData.aiPending.citations
              : [];
            const fallback =
              allCites.length > 0
                ? '로컬 AI 답변은 실패했지만, 검색된 출처는 아래 링크에서 확인할 수 있습니다.'
                : ollamaErr?.message ||
                  '로컬 AI에 연결하지 못했습니다. 로컬 AI 실행 여부를 확인하거나 토글을 끄고 클라우드 키를 사용해 주세요.';
            try {
              const saved = await persistAiReply(roomId, {
                answer: fallback,
                citations: allCites,
                aiMode: 'retrieval-fallback'
              });
              if (stillInRoom() && saved) setMessages((prev) => mergeMessagesById(prev, saved));
            } catch (_) {
              if (stillInRoom()) {
                setMessagesError(ollamaErr?.message || '로컬 AI 호출에 실패했습니다.');
              }
            }
          }
        }
      }

      loadRooms();
    } catch (err) {
      if (stillInRoom()) {
        if (!savedUserMessage) {
          setMessages((prev) => prev.filter((m) => m.id !== tempId));
          setDraft(body);
          if (replyTarget) setReplyingTo(replyTarget);
        }
        setMessagesError(err.message || '전송에 실패했습니다.');
      }
    } finally {
      sendingRef.current = false;
      setSending(false);
      setAiThinking(false);
      if (stillInRoom()) {
        window.requestAnimationFrame(() => inputRef.current?.focus());
      }
    }
  };

  if (!eligible) return null;

  const inviteCandidates = directory.filter((m) => {
    if (myIds.has(String(m.id))) return false;
    if (view === 'invite') {
      const already = new Set((activeRoom?.memberIds || []).map(String));
      return !already.has(String(m.id));
    }
    return Boolean(m.id);
  });

  return (
    <div className="home-company-chat">
      {open ? (
        <div
          className="home-company-chat-panel"
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          style={{ width: panelSize.w, height: panelSize.h }}
        >
          <button
            type="button"
            className="home-company-chat-resize"
            aria-label="채팅 패널 크기 조절"
            onPointerDown={onResizePointerDown}
          />
          <header className="home-company-chat-head">
            <div className="home-company-chat-head-main">
              {view === 'chat' ? (
                <button
                  type="button"
                  className="home-company-chat-back-btn"
                  title="채팅방 목록"
                  aria-label="채팅방 목록으로 돌아가기"
                  onClick={() => {
                    setView('rooms');
                    setActiveRoomId('');
                    setAiThinking(false);
                    loadRooms();
                  }}
                >
                  <span className="material-symbols-outlined" aria-hidden>
                    arrow_back
                  </span>
                </button>
              ) : null}
              <div className="home-company-chat-head-text">
                <h2 id={titleId}>사내 채팅</h2>
                <p>
                  {view === 'chat' && activeRoom?.kind === 'ai'
                    ? 'CRM 도우미 · 메뉴·고객·영업 질문'
                    : view === 'chat' && activeRoom?.title
                      ? `${activeRoom.title} · @AI 로 도우미 호출`
                      : view === 'create'
                        ? '새 채팅방'
                        : view === 'invite'
                          ? '멤버 초대'
                          : '도우미 · 초대된 직원 채팅'}
                </p>
              </div>
            </div>
            <div className="home-company-chat-head-actions">
              {view === 'chat' ? (
                <>
                  {!isAiRoom ? (
                    <button
                      type="button"
                      className="home-company-chat-icon-btn"
                      title="멤버 초대"
                      aria-label="멤버 초대"
                      onClick={() => {
                        setSelectedMemberIds([]);
                        setInviteError('');
                        setView('invite');
                      }}
                    >
                      <span className="material-symbols-outlined" aria-hidden>
                        person_add
                      </span>
                    </button>
                  ) : null}
                </>
              ) : null}
              {view === 'rooms' ? (
                <button
                  type="button"
                  className="home-company-chat-icon-btn"
                  title="새 채팅방"
                  aria-label="새 채팅방"
                  onClick={() => {
                    setCreateTitle('');
                    setSelectedMemberIds([]);
                    setCreateError('');
                    setView('create');
                  }}
                >
                  <span className="material-symbols-outlined" aria-hidden>
                    add_comment
                  </span>
                </button>
              ) : null}
              {(view === 'create' || view === 'invite') && (
                <button
                  type="button"
                  className="home-company-chat-icon-btn"
                  title="뒤로"
                  aria-label="뒤로"
                  onClick={() => setView(view === 'invite' ? 'chat' : 'rooms')}
                >
                  <span className="material-symbols-outlined" aria-hidden>
                    arrow_back
                  </span>
                </button>
              )}
              <button
                type="button"
                className="home-company-chat-icon-btn"
                aria-label="닫기"
                onClick={() => setOpen(false)}
              >
                <span className="material-symbols-outlined" aria-hidden>
                  close
                </span>
              </button>
            </div>
          </header>

          {view === 'rooms' ? (
            <div className="home-company-chat-body">
              {roomsLoading && !rooms.length ? (
                <p className="home-company-chat-empty">불러오는 중…</p>
              ) : roomsError ? (
                <p className="home-company-chat-error">{roomsError}</p>
              ) : rooms.length === 0 ? (
                <p className="home-company-chat-empty">
                  채팅방이 없습니다. 사내 현황에서 직원을 초대해 방을 만들어 보세요.
                </p>
              ) : (
                <ul className="home-company-chat-room-list">
                  {rooms.map((room) => (
                    <li key={room.id}>
                      <button
                        type="button"
                        className={room.kind === 'ai' ? 'is-ai-room' : ''}
                        onClick={() => openRoom(room.id)}
                      >
                        <strong>
                          {room.kind === 'ai' ? (
                            <span className="home-company-chat-ai-badge" aria-hidden>
                              smart_toy
                            </span>
                          ) : null}
                          {room.kind === 'ai' ? 'CRM 도우미' : room.title}
                        </strong>
                        <span>
                          {room.kind === 'ai'
                            ? room.lastMessagePreview || 'CRM 질문 · 메뉴 안내'
                            : room.lastMessagePreview || `${room.memberCount || 0}명`}
                        </span>
                        <em>{formatTime(room.lastMessageAt || room.updatedAt)}</em>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          {view === 'chat' ? (
            <>
              <div className="home-company-chat-ai-bar">
                <label
                  className={`home-company-chat-local-ai${isMobile ? ' is-mobile-locked' : ''}`}
                >
                  <span className="home-company-chat-local-ai-label">로컬 AI 사용</span>
                  <input
                    type="checkbox"
                    className="home-company-chat-toggle-input"
                    checked={effectiveUseLocalAi}
                    onChange={(e) => onToggleLocalAi(e.target.checked)}
                    disabled={sending || isMobile}
                    aria-label="로컬 AI 사용"
                  />
                  <span className="home-company-chat-toggle" aria-hidden />
                </label>
                <p className="home-company-chat-ai-hint">
                  {isMobile
                    ? '스마트폰에서는 로컬 AI를 사용할 수 없습니다. 사내 현황에 저장한 클라우드 AI 키만 사용합니다.'
                    : effectiveUseLocalAi
                      ? '이 PC에서 로컬 AI를 실행해 두세요. 꺼 두면 사내 현황에 저장한 클라우드 AI 키를 사용합니다.'
                      : '클라우드 AI 키는 사내 현황 → 톱니바퀴 설정에서 저장합니다.'}
                </p>
              </div>
              <div className="home-company-chat-messages" ref={listRef}>
                {messagesLoading && !messages.length ? (
                  <p className="home-company-chat-empty">불러오는 중…</p>
                ) : null}
                {messagesError ? <p className="home-company-chat-error">{messagesError}</p> : null}
                {!messagesLoading && !messages.length && isAiRoom ? (
                  <p className="home-company-chat-empty">
                    예: 「내일 오후 2~4시 천진엔지니어링 미팅 캘린더에 넣어줘」, 「방금 입력한 ○○회사 일정」
                  </p>
                ) : null}
                {messages.map((m) => (
                  <MessageBubble
                    key={m.id}
                    m={m}
                    mentionNames={mentionNames}
                    onReply={startReply}
                    onJumpToReply={jumpToReply}
                    onConfirmAction={confirmCompanyAction}
                    confirmingActionId={confirmingActionId}
                    onPreviewImage={setPreviewImage}
                  />
                ))}
                {aiThinking ? (
                  <div className="home-company-chat-bubble is-ai home-company-chat-bubble--thinking">
                    <span className="home-company-chat-bubble-name">CRM 도우미</span>
                    <p>{uploadingCard ? '이미지 확인 중…' : '찾는 중…'}</p>
                  </div>
                ) : null}
              </div>
              <div className="home-company-chat-composer-wrap">
                {replyingTo ? (
                  <div className="home-company-chat-reply-bar">
                    <div className="home-company-chat-reply-bar-body">
                      <strong>
                        {(replyingTo.senderKind === 'ai'
                          ? 'CRM 도우미'
                          : replyingTo.sender?.name || '멤버') + '님에게 답장'}
                      </strong>
                      <span>{previewText(replyingTo.body, 100)}</span>
                    </div>
                    <button
                      type="button"
                      className="home-company-chat-reply-bar-close"
                      aria-label="답장 취소"
                      onClick={cancelReply}
                    >
                      <span className="material-symbols-outlined" aria-hidden>
                        close
                      </span>
                    </button>
                  </div>
                ) : null}
                {filteredMentions.length > 0 ? (
                  <ul className="home-company-chat-mention-menu" role="listbox">
                    {filteredMentions.map((c, idx) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={idx === mentionIndex}
                          className={idx === mentionIndex ? 'is-active' : ''}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            applyMention(c);
                          }}
                        >
                          <span
                            className={`home-company-chat-mention-avatar${c.kind === 'ai' ? ' is-ai' : ''}`}
                            aria-hidden
                          >
                            {c.kind === 'ai' ? (
                              <span className="material-symbols-outlined">smart_toy</span>
                            ) : (
                              (c.name || '?').slice(0, 1)
                            )}
                          </span>
                          <span className="home-company-chat-mention-meta">
                            <strong>{c.name}</strong>
                            {c.subtitle ? <em>{c.subtitle}</em> : null}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div
                  className={`home-company-chat-composer-box${composerDropActive ? ' is-drop' : ''}`}
                  onDragEnter={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setComposerDropActive(true);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setComposerDropActive(true);
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    if (!e.currentTarget.contains(e.relatedTarget)) {
                      setComposerDropActive(false);
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setComposerDropActive(false);
                    addPendingImages(e.dataTransfer?.files);
                  }}
                >
                  {pendingImages.length > 0 ? (
                    <ul className="home-company-chat-attach-thumbs">
                      {pendingImages.map((img) => (
                        <li key={img.id}>
                          <button
                            type="button"
                            className="home-company-chat-attach-thumb"
                            title="클릭하여 확대"
                            onClick={() => setPreviewImage(img)}
                          >
                            <img src={img.url} alt={img.name || '첨부 이미지'} />
                          </button>
                          <button
                            type="button"
                            className="home-company-chat-attach-remove"
                            aria-label="첨부 제거"
                            onClick={() => removePendingImage(img.id)}
                          >
                            <span className="material-symbols-outlined" aria-hidden>
                              close
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <form className="home-company-chat-composer" onSubmit={sendMessage}>
                    {!isAiRoom ? (
                      <button
                        type="button"
                        className="home-company-chat-mention-btn"
                        title="@ 멘션"
                        aria-label="@ 멘션 열기"
                        onClick={openMentionPicker}
                      >
                        @
                      </button>
                    ) : null}
                    <input
                      ref={inputRef}
                      type="text"
                      value={draft}
                      onChange={onDraftChange}
                      onCompositionStart={() => {
                        composingRef.current = true;
                      }}
                      onCompositionEnd={(e) => {
                        composingRef.current = false;
                        const next = e.target.value;
                        setDraft(next);
                        setCaret(e.target.selectionStart ?? next.length);
                      }}
                      onClick={syncCaret}
                      onKeyUp={(e) => {
                        if (composingRef.current || e.nativeEvent?.isComposing) return;
                        syncCaret();
                      }}
                      onSelect={syncCaret}
                      onKeyDown={onComposerKeyDown}
                      onPaste={(e) => {
                        const items = Array.from(e.clipboardData?.items || []);
                        const imageFiles = items
                          .filter((it) => it.kind === 'file' && /^image\//i.test(it.type || ''))
                          .map((it) => it.getAsFile())
                          .filter(Boolean);
                        if (imageFiles.length) {
                          e.preventDefault();
                          addPendingImages(imageFiles);
                        }
                      }}
                      placeholder={
                        isAiRoom
                          ? '질문 입력 · 이미지 붙여넣기/드롭 (내용 / 연락처·업체 등록)'
                          : '메시지 · @멘션 · 이미지 붙여넣기/드롭'
                      }
                      maxLength={4000}
                      disabled={uploadingCard}
                    />
                    <button
                      type="submit"
                      disabled={sending || uploadingCard || (!draft.trim() && !pendingImages.length)}
                    >
                      {uploadingCard ? '인식 중…' : '전송'}
                    </button>
                  </form>
                </div>
              </div>
            </>
          ) : null}

          {previewImage ? (
            <div
              className="home-company-chat-img-modal"
              role="dialog"
              aria-modal="true"
              aria-label="이미지 확대"
              onClick={() => setPreviewImage(null)}
            >
              <button
                type="button"
                className="home-company-chat-img-modal-close"
                aria-label="닫기"
                onClick={() => setPreviewImage(null)}
              >
                <span className="material-symbols-outlined" aria-hidden>
                  close
                </span>
              </button>
              <img
                src={previewImage.url}
                alt={previewImage.name || '첨부 이미지'}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          ) : null}

          {view === 'create' || view === 'invite' ? (
            <form
              className="home-company-chat-create"
              onSubmit={view === 'create' ? createRoom : inviteMembers}
            >
              {view === 'create' ? (
                <label>
                  채팅방 이름
                  <input
                    type="text"
                    value={createTitle}
                    onChange={(e) => setCreateTitle(e.target.value)}
                    placeholder="예: 영업팀 공지"
                    maxLength={120}
                  />
                </label>
              ) : null}
              <p className="home-company-chat-create-hint">
                권한 대기(pending) 직원은 초대·열람할 수 없습니다.
              </p>
              <ul className="home-company-chat-member-pick">
                {directoryLoading ? (
                  <li className="home-company-chat-empty">직원 목록 불러오는 중…</li>
                ) : directoryError && inviteCandidates.length === 0 ? (
                  <li className="home-company-chat-error">{directoryError}</li>
                ) : inviteCandidates.length === 0 ? (
                  <li className="home-company-chat-empty">초대 가능한 직원이 없습니다.</li>
                ) : (
                  inviteCandidates.map((m) => {
                    const checked = selectedMemberIds.includes(String(m.id));
                    return (
                      <li key={m.id}>
                        <label>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleMember(m.id)}
                          />
                          <span>
                            <strong>{m.name}</strong>
                            <em>{m.email}</em>
                          </span>
                        </label>
                      </li>
                    );
                  })
                )}
              </ul>
              {(view === 'create' ? createError : inviteError) ? (
                <p className="home-company-chat-error">
                  {view === 'create' ? createError : inviteError}
                </p>
              ) : null}
              <button
                type="submit"
                className="home-company-chat-primary"
                disabled={view === 'create' ? createBusy : inviteBusy}
              >
                {view === 'create'
                  ? createBusy
                    ? '만드는 중…'
                    : '채팅방 만들기'
                  : inviteBusy
                    ? '초대 중…'
                    : '선택한 직원 초대'}
              </button>
            </form>
          ) : null}
        </div>
      ) : null}

      <button
        type="button"
        className={`home-company-chat-fab${open ? ' is-open' : ''}`}
        aria-expanded={open}
        aria-controls={open ? titleId : undefined}
        onClick={() => {
          setOpen((v) => {
            const next = !v;
            if (next) {
              setView('rooms');
              loadRooms();
            }
            return next;
          });
        }}
      >
        <span className="material-symbols-outlined" aria-hidden>
          {open ? 'close' : 'forum'}
        </span>
        <span className="home-company-chat-fab-label">{open ? '닫기' : '사내 채팅'}</span>
      </button>
    </div>
  );
}
