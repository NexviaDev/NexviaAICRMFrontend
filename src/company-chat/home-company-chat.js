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
const AI_MENTION_TEST_RE = /(?:^|[\s([{「『"'“])@(?:AI|Ai|ai|에이아이)\b/u;

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

function renderMessageBody(text) {
  const raw = String(text || '');
  const parts = raw.split(/(@(?:AI|Ai|ai|에이아이)\b)/g);
  return parts.map((part, i) => {
    if (/^@(?:AI|Ai|ai|에이아이)$/.test(part)) {
      return (
        <span key={`m-${i}`} className="home-company-chat-ai-mention">
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

function MessageBubble({ m }) {
  const isAi = m.senderKind === 'ai';
  const cites = Array.isArray(m.citations) ? m.citations : [];
  return (
    <div
      className={`home-company-chat-bubble${m.mine ? ' is-mine' : ''}${isAi ? ' is-ai' : ''}`}
    >
      {!m.mine ? (
        <span className="home-company-chat-bubble-name">
          {isAi ? 'CRM 도우미' : m.sender?.name || '멤버'}
        </span>
      ) : null}
      <p>{renderMessageBody(m.body)}</p>
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

  const listRef = useRef(null);
  const inputRef = useRef(null);
  const panelSizeRef = useRef(panelSize);
  const resizeSessionRef = useRef(null);
  const activeRoomIdRef = useRef('');
  const sendingRef = useRef(false);

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

  const insertAiMention = useCallback(() => {
    setDraft((prev) => {
      const cur = String(prev || '');
      if (AI_MENTION_TEST_RE.test(cur)) return cur;
      return cur ? `${cur.replace(/\s+$/, '')} @AI ` : '@AI ';
    });
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

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

  const sendMessage = async (e) => {
    e?.preventDefault?.();
    const body = String(draft || '').trim();
    if (!body || !activeRoomId || sendingRef.current) return;

    const roomId = activeRoomId;
    sendingRef.current = true;
    setSending(true);
    setMessagesError('');

    const wantsAi = isAiRoom || AI_MENTION_TEST_RE.test(body);
    const tempId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic = {
      id: tempId,
      body,
      mine: true,
      senderKind: 'user',
      sender: { name: localUser?.name || '나' },
      citations: [],
      createdAt: new Date().toISOString()
    };

    setDraft('');
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
          body: JSON.stringify({ body, useLocalAi: useLocal })
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (stillInRoom()) {
          setMessages((prev) => prev.filter((m) => m.id !== tempId));
          setDraft(body);
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
                    예: 「영업기회 열어줘」, 「내일 오후 2시~4시 미팅 캘린더에 넣어줘」, 「○○ 프린터 고장」
                  </p>
                ) : null}
                {messages.map((m) => (
                  <MessageBubble key={m.id} m={m} />
                ))}
                {aiThinking ? (
                  <div className="home-company-chat-bubble is-ai home-company-chat-bubble--thinking">
                    <span className="home-company-chat-bubble-name">CRM 도우미</span>
                    <p>찾는 중…</p>
                  </div>
                ) : null}
              </div>
              <form className="home-company-chat-composer" onSubmit={sendMessage}>
                {!isAiRoom ? (
                  <button
                    type="button"
                    className="home-company-chat-mention-btn"
                    title="@AI 언급"
                    aria-label="@AI 언급 삽입"
                    onClick={insertAiMention}
                  >
                    @AI
                  </button>
                ) : null}
                <input
                  ref={inputRef}
                  type="text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={
                    isAiRoom ? 'CRM에 대해 물어보기' : '메시지 입력 · @AI 로 도우미 호출'
                  }
                  maxLength={4000}
                />
                <button type="submit" disabled={sending || !draft.trim()}>
                  전송
                </button>
              </form>
            </>
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
