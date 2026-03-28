import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { API_BASE } from '@/config';
import PageHeaderNotifyChat from '@/components/page-header-notify-chat/page-header-notify-chat';
import ParticipantModal from '@/shared/participant-modal/participant-modal';
import NewChatModal from './new-chat-modal/new-chat-modal';
import { GoogleWorkspaceChatPolicyHint } from '@/lib/google-workspace-chat-hint';
import './messenger.css';

const CHAT_API_DOCS = 'https://developers.google.com/workspace/chat/api/reference/rest?apix=true&hl=ko';

/** 열린 대화 메시지 자동 갱신(초) — 수동 새로고침 없이 상대 메시지 반영 */
const MESSAGE_POLL_MS = 10000;
/** 대화 목록·미리보기 갱신: N회 메시지 폴링마다 1번 (백엔드 부하 완화) */
const SPACES_POLL_EVERY_N_MESSAGE_TICKS = 3;
/** 메시지 폴링 시 멤버 API는 N회에 1번만(헤더·표시명 최신화) */
const MEMBERS_POLL_EVERY_N_MESSAGE_TICKS = 5;

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Railway 등 슬립/게이트웨이 타임아웃 시 짧은 재시도 */
async function fetchWithColdStartRetry(url, options = {}, retries = 2) {
  let last;
  for (let i = 0; i <= retries; i += 1) {
    if (i > 0) await sleep(2800);
    last = await fetch(url, { ...options, credentials: 'include' });
    if (![502, 503, 504].includes(last.status)) break;
  }
  return last;
}

function spaceIdFromName(name) {
  if (!name || typeof name !== 'string') return '';
  return name.startsWith('spaces/') ? name.slice('spaces/'.length) : name;
}

function extractMessageText(m) {
  if (!m) return '';
  const raw = m.text || m.formattedText || m.argumentText || m.fallbackText || '';
  return String(raw).trim();
}

function attachmentsOf(m) {
  const a = m.attachment;
  if (!a) return [];
  return Array.isArray(a) ? a : [a];
}

function formatListTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: true });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYest =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate();
  if (isYest) return '어제';
  return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
}

function formatMsgTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function dayKey(iso) {
  const d = new Date(iso || 0);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function dayLabel(iso) {
  const d = new Date(iso || 0);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  if (dayKey(iso) === dayKey(now.toISOString())) return '오늘';
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (dayKey(iso) === dayKey(y.toISOString())) return '어제';
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
}

function spaceTypeKo(spaceType) {
  switch (spaceType) {
    case 'DIRECT_MESSAGE':
      return '1:1';
    case 'GROUP_CHAT':
      return '그룹';
    case 'SPACE':
    default:
      return '스페이스';
  }
}

function defaultSpaceTitle(s) {
  const st = s?.spaceType || s?.type;
  if (s?.displayName?.trim()) return s.displayName.trim();
  return `${spaceTypeKo(st)} 대화`;
}

/**
 * Google Chat sender는 displayName이 비어 있는 경우가 많습니다.
 * 순서: 메시지 sender.displayName → People API/DB 보강 맵 → 멤버십 displayName → users/… 일부 표시
 */
function getSenderDisplayName(message, memberships, resolvedByRn) {
  const s = message?.sender;
  if (!s) return '';
  const rn = s.name || '';
  const direct = (s.displayName || '').trim();
  if (direct) return direct;
  if (resolvedByRn && rn && resolvedByRn[rn]) return resolvedByRn[rn];
  const hit = (memberships || []).find((x) => x?.member?.name === rn);
  const fromMember = (hit?.member?.displayName || '').trim();
  if (fromMember) return fromMember;
  if (rn.startsWith('users/')) {
    const rest = rn.slice('users/'.length);
    return rest || '';
  }
  return rn;
}

const MOBILE_MQ = '(max-width: 768px)';

export default function Messenger() {
  const navigate = useNavigate();
  const listSearchRef = useRef(null);
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(MOBILE_MQ).matches
  );
  const [mobileThreadOpen, setMobileThreadOpen] = useState(false);

  const [spaces, setSpaces] = useState([]);
  const [spacesLoading, setSpacesLoading] = useState(true);
  const [selectedName, setSelectedName] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [members, setMembers] = useState([]);
  /** Chat 메시지 sender만으로 부족할 때 People API·UserChatContact로 보강한 표시명 */
  const [senderNamesByResource, setSenderNamesByResource] = useState(() => ({}));
  const senderNamesRef = useRef({});
  const [myResourceName, setMyResourceName] = useState('');
  const [compose, setCompose] = useState('');
  const [sendLoading, setSendLoading] = useState(false);
  const [error, setError] = useState('');
  const [needsReauth, setNeedsReauth] = useState(false);
  const [listFilter, setListFilter] = useState('');
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [newChatLoading, setNewChatLoading] = useState(false);
  const [newChatInviteEmails, setNewChatInviteEmails] = useState([]);
  const [participantPickerOpen, setParticipantPickerOpen] = useState(false);
  const [teamMembers, setTeamMembers] = useState([]);
  const [previews, setPreviews] = useState(() => ({}));
  const msgsEndRef = useRef(null);

  const currentUser = useMemo(() => {
    try {
      const raw = localStorage.getItem('crm_user');
      const u = raw ? JSON.parse(raw) : null;
      if (!u) return null;
      return { ...u, _id: u._id || u.id };
    } catch {
      return null;
    }
  }, []);

  const fetchTeamMembers = useCallback(() => {
    const headers = getAuthHeader();
    Promise.all([
      fetch(`${API_BASE}/calendar-events/team-members`, { headers }).then((r) => r.json().catch(() => ({}))).catch(() => ({})),
      fetch(`${API_BASE}/companies/overview`, { headers }).then((r) => r.json().catch(() => ({}))).catch(() => ({}))
    ])
      .then(([teamData, overviewData]) => {
        const fromTeam = Array.isArray(teamData?.members) ? teamData.members : [];
        const fromOverview = Array.isArray(overviewData?.employees) ? overviewData.employees : [];
        const overviewMap = new Map(fromOverview.map((e) => [String(e.id), e]));
        const merged = fromTeam.map((m) => {
          const o = overviewMap.get(String(m._id));
          return {
            ...m,
            phone: m.phone || o?.phone || '',
            department: m.department || m.companyDepartment || o?.department || ''
          };
        });
        setTeamMembers(merged);
      })
      .catch(() => {});
  }, []);

  const participantPickerInitialSelection = useMemo(() => {
    if (!newChatInviteEmails.length || !teamMembers.length) return [];
    const set = new Set(newChatInviteEmails.map((e) => String(e).trim().toLowerCase()));
    return teamMembers
      .filter((m) => m.email && set.has(String(m.email).trim().toLowerCase()))
      .map((m) => ({ userId: m._id, name: m.name || m.email }));
  }, [newChatInviteEmails, teamMembers]);

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MQ);
    const onChange = () => setIsMobile(mq.matches);
    mq.addEventListener('change', onChange);
    setIsMobile(mq.matches);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (!isMobile) setMobileThreadOpen(false);
  }, [isMobile]);

  useEffect(() => {
    if (!selectedName) setMobileThreadOpen(false);
  }, [selectedName]);

  useEffect(() => {
    senderNamesRef.current = senderNamesByResource;
  }, [senderNamesByResource]);

  /** 메시지에 등장한 발신자 resourceName에 대해 People API(백엔드 resolve-user-names)로 표시명 보강 */
  useEffect(() => {
    if (!messages.length) return;
    const prev = senderNamesRef.current;
    const need = new Set();
    for (const m of messages) {
      const rn = m.sender?.name;
      if (rn && rn !== myResourceName) need.add(rn);
    }
    const missing = [...need].filter((rn) => !prev[rn]);
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchWithColdStartRetry(`${API_BASE}/google-chat/resolve-user-names`, {
          method: 'POST',
          headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ resourceNames: missing })
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled || !res.ok) return;
        const next = {};
        Object.entries(data).forEach(([k, v]) => {
          if (k.startsWith('_')) return;
          if (typeof v === 'string' && v.trim()) next[k] = v.trim();
        });
        if (Object.keys(next).length === 0) return;
        setSenderNamesByResource((p) => {
          const merged = { ...p, ...next };
          senderNamesRef.current = merged;
          return merged;
        });
      } catch (_) {
        /* 조용히 실패 — 말풍선은 users/… 폴백 유지 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [messages, myResourceName]);

  useEffect(() => {
    if (!newChatOpen) return;
    setNewChatInviteEmails([]);
    fetchTeamMembers();
  }, [newChatOpen, fetchTeamMembers]);

  const handleNewChatParticipantConfirm = useCallback(
    (selected) => {
      const emails = selected
        .map((s) => teamMembers.find((t) => String(t._id) === String(s.userId)))
        .filter(Boolean)
        .map((m) => m.email)
        .filter(Boolean);
      setNewChatInviteEmails((prev) => {
        const seen = new Set(prev.map((e) => String(e).trim().toLowerCase()));
        const merged = [...prev];
        for (const em of emails) {
          const k = em.trim().toLowerCase();
          if (!seen.has(k)) {
            seen.add(k);
            merged.push(em.trim());
          }
        }
        return merged;
      });
      setParticipantPickerOpen(false);
    },
    [teamMembers]
  );

  const openNewChatParticipantPicker = useCallback(() => {
    if (teamMembers.length === 0) fetchTeamMembers();
    setParticipantPickerOpen(true);
  }, [teamMembers.length, fetchTeamMembers]);

  const selectedSpace = useMemo(
    () => spaces.find((s) => s.name === selectedName) || null,
    [spaces, selectedName]
  );

  const headerTitle = useMemo(() => {
    if (!selectedSpace) return '';
    if (selectedSpace.displayName?.trim()) return selectedSpace.displayName.trim();
    const st = selectedSpace.spaceType || selectedSpace.type;
    if (st === 'DIRECT_MESSAGE' && members.length > 0) {
      const other = members.find((x) => x?.member?.name && x.member.name !== myResourceName);
      const dn = other?.member?.displayName;
      if (dn) return dn;
    }
    if (st === 'GROUP_CHAT') {
      const humans = members.filter((x) => x?.member?.type === 'HUMAN');
      if (humans.length) return `그룹 (${humans.length}명)`;
    }
    return defaultSpaceTitle(selectedSpace);
  }, [selectedSpace, members, myResourceName]);

  const headerSubtitle = useMemo(() => {
    if (!selectedSpace) return '';
    const st = selectedSpace.spaceType || selectedSpace.type;
    if (st === 'SPACE' || st === 'GROUP_CHAT') return spaceTypeKo(st);
    return 'Google Chat · Direct';
  }, [selectedSpace]);

  const loadMe = useCallback(async () => {
    try {
      const res = await fetchWithColdStartRetry(`${ API_BASE }/google-chat/me`, { headers: { ...getAuthHeader() } });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.resourceName) setMyResourceName(data.resourceName);
    } catch {
      /* 선택 */
    }
  }, []);

  const loadSpaces = useCallback(async (opts = {}) => {
    const silent = opts.silent === true;
    if (!silent) {
      setSpacesLoading(true);
      setError('');
      setNeedsReauth(false);
    }
    try {
      const res = await fetchWithColdStartRetry(
        `${ API_BASE }/google-chat/spaces?pageSize=100`,
        { headers: { ...getAuthHeader() } }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (!silent) {
          if (data.needsReauth) setNeedsReauth(true);
          setError(data.error || '대화 목록을 불러오지 못했습니다.');
          setSpaces([]);
        }
        return;
      }
      const list = Array.isArray(data.spaces) ? data.spaces : [];
      setSpaces(list);
      setSelectedName((prev) => {
        if (prev && list.some((s) => s.name === prev)) return prev;
        return list[0]?.name || null;
      });
    } catch (_) {
      if (!silent) {
        setError('네트워크 오류로 목록을 불러오지 못했습니다.');
        setSpaces([]);
      }
    } finally {
      if (!silent) setSpacesLoading(false);
    }
  }, []);

  const loadThread = useCallback(async (spaceFullName, opts = {}) => {
    const silent = opts.silent === true;
    const skipMembers = opts.skipMembers === true;
    if (!spaceFullName) {
      setMessages([]);
      setMembers([]);
      return;
    }
    const sid = encodeURIComponent(spaceIdFromName(spaceFullName));
    if (!silent) {
      setMessagesLoading(true);
      setError('');
      setNeedsReauth(false);
    }
    try {
      const msgReq = fetchWithColdStartRetry(
        `${ API_BASE }/google-chat/spaces/${ sid }/messages?pageSize=100`,
        { headers: { ...getAuthHeader() } }
      );
      const memReq = skipMembers
        ? Promise.resolve(null)
        : fetchWithColdStartRetry(
            `${ API_BASE }/google-chat/spaces/${ sid }/members?pageSize=100`,
            { headers: { ...getAuthHeader() } }
          );
      const [msgRes, memRes] = await Promise.all([msgReq, memReq]);

      const msgData = await msgRes.json().catch(() => ({}));
      if (!msgRes.ok) {
        if (!silent) {
          if (msgData.needsReauth) setNeedsReauth(true);
          setError(msgData.error || '메시지를 불러오지 못했습니다.');
          setMessages([]);
          setMembers([]);
        }
        return;
      }
      const raw = Array.isArray(msgData.messages) ? msgData.messages : [];
      const sorted = [...raw].sort((a, b) => {
        const ta = new Date(a.createTime || 0).getTime();
        const tb = new Date(b.createTime || 0).getTime();
        return ta - tb;
      });
      setMessages(sorted);

      const last = sorted[sorted.length - 1];
      if (last) {
        const preview = extractMessageText(last) || (attachmentsOf(last).length ? '첨부' : '메시지');
        setPreviews((p) => ({ ...p, [spaceFullName]: { text: preview, time: last.createTime } }));
      }

      if (memRes) {
        const memData = await memRes.json().catch(() => ({}));
        if (memRes.ok) {
          setMembers(Array.isArray(memData.memberships) ? memData.memberships : []);
        } else if (!silent) {
          setMembers([]);
        }
      }
    } catch (_) {
      if (!silent) {
        setError('메시지를 불러오는 중 오류가 났습니다.');
        setMessages([]);
        setMembers([]);
      }
    } finally {
      if (!silent) setMessagesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMe();
    void loadSpaces();
  }, [loadMe, loadSpaces]);

  useEffect(() => {
    void loadThread(selectedName);
  }, [selectedName, loadThread]);

  useEffect(() => {
    if (!selectedName) return undefined;
    let cancelled = false;
    let ticks = 0;

    const pollMessages = () => {
      if (cancelled || document.visibilityState !== 'visible') return;
      ticks += 1;
      const skipMembers = ticks % MEMBERS_POLL_EVERY_N_MESSAGE_TICKS !== 0;
      void loadThread(selectedName, { silent: true, skipMembers });
      if (ticks % SPACES_POLL_EVERY_N_MESSAGE_TICKS === 0) {
        void loadSpaces({ silent: true });
      }
    };

    const onVisible = () => {
      if (cancelled || document.visibilityState !== 'visible') return;
      void loadThread(selectedName, { silent: true, skipMembers: false });
      void loadSpaces({ silent: true });
    };

    const onFocus = () => {
      if (cancelled) return;
      void loadThread(selectedName, { silent: true, skipMembers: true });
    };

    const id = window.setInterval(pollMessages, MESSAGE_POLL_MS);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);

    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
    };
  }, [selectedName, loadThread, loadSpaces]);

  useEffect(() => {
    msgsEndRef.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    const text = compose.trim();
    if (!text || !selectedName) return;
    const sid = encodeURIComponent(spaceIdFromName(selectedName));
    setSendLoading(true);
    setError('');
    setNeedsReauth(false);
    try {
      const res = await fetch(`${ API_BASE }/google-chat/spaces/${ sid }/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ text })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.needsReauth) setNeedsReauth(true);
        setError(data.error || '전송에 실패했습니다.');
        return;
      }
      setCompose('');
      void loadThread(selectedName);
      void loadSpaces();
    } catch (_) {
      setError('전송할 수 없습니다.');
    } finally {
      setSendLoading(false);
    }
  };

  const onKeyDownInput = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  const handleNewChat = async ({ displayName, inviteEmails: rawInviteEmails }) => {
    setNewChatLoading(true);
    setError('');
    setNeedsReauth(false);
    const myEmail = String(currentUser?.email || '').trim().toLowerCase();
    const inviteEmails = [
      ...new Set((rawInviteEmails || []).map((e) => String(e).trim()).filter(Boolean))
    ].filter((e) => e.toLowerCase() !== myEmail);
    try {
      const res = await fetch(`${ API_BASE }/google-chat/spaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ displayName })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.needsReauth) setNeedsReauth(true);
        setError(data.error || '채팅방을 만들지 못했습니다.');
        return;
      }
      const createdName = data.name;
      if (inviteEmails.length > 0 && createdName) {
        const sid = encodeURIComponent(spaceIdFromName(createdName));
        const failures = [];
        for (const email of inviteEmails) {
          const inv = await fetch(`${ API_BASE }/google-chat/spaces/${ sid }/members`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
            body: JSON.stringify({ email })
          });
          const invData = await inv.json().catch(() => ({}));
          if (!inv.ok) {
            failures.push(`${email}: ${invData.error || '실패'}`);
          }
        }
        if (failures.length > 0) {
          setError(
            `일부 초대에 실패했습니다. (${failures.length}건) ${failures.slice(0, 3).join(' · ')}` +
              (failures.length > 3 ? ' …' : '') +
              ' 방은 생성되었습니다. 권한·이메일을 확인해 주세요.'
          );
        }
      }
      setNewChatOpen(false);
      setParticipantPickerOpen(false);
      await loadSpaces();
      if (createdName) setSelectedName(createdName);
    } catch (_) {
      setError('채팅방 생성 요청에 실패했습니다.');
    } finally {
      setNewChatLoading(false);
    }
  };

  const filteredSpaces = useMemo(() => {
    const q = listFilter.trim().toLowerCase();
    if (!q) return spaces;
    return spaces.filter((s) => {
      const title = (s.displayName || defaultSpaceTitle(s)).toLowerCase();
      return title.includes(q);
    });
  }, [spaces, listFilter]);

  const showMobileListChrome = isMobile && !mobileThreadOpen;

  return (
    <div className={`messenger-page ${isMobile ? 'messenger-page--mobile' : ''}`}>
      {!isMobile ? (
        <header className="messenger-top">
          <div>
            <h1 className="messenger-top-title">내부 메신저</h1>
            <p className="messenger-top-meta">
              Google 계정 OAuth로{' '}
              <a href={CHAT_API_DOCS} target="_blank" rel="noreferrer">
                Chat API
              </a>
              를 사용합니다.
            </p>
          </div>
          <PageHeaderNotifyChat buttonClassName="email-header-icon-btn" wrapperClassName="email-header-notify-chat" />
        </header>
      ) : null}

      {!isMobile ? (
        <p className="messenger-workspace-hint" role="note">
          <GoogleWorkspaceChatPolicyHint />
        </p>
      ) : null}

      {showMobileListChrome ? (
        <header className="messenger-mobile-appbar">
          <button
            type="button"
            className="messenger-mobile-appbar-btn"
            aria-label="홈으로"
            onClick={() => navigate('/')}
          >
            <span className="material-symbols-outlined">menu</span>
          </button>
          <h1 className="messenger-mobile-appbar-title">메시지</h1>
          <div className="messenger-mobile-appbar-actions">
            <button
              type="button"
              className="messenger-mobile-appbar-btn"
              aria-label="검색"
              onClick={() => listSearchRef.current?.focus()}
            >
              <span className="material-symbols-outlined">search</span>
            </button>
            <PageHeaderNotifyChat buttonClassName="messenger-mobile-appbar-btn" wrapperClassName="messenger-mobile-notify-wrap" />
          </div>
        </header>
      ) : null}

      {showMobileListChrome ? (
        <p className="messenger-workspace-hint messenger-workspace-hint--mobile" role="note">
          <GoogleWorkspaceChatPolicyHint />
        </p>
      ) : null}

      {(error || needsReauth) && (
        <div className="messenger-banner-error">
          {error}
          {needsReauth ? (
            <a href="/login" className="messenger-banner-reauth">
              Google로 다시 로그인
            </a>
          ) : null}
        </div>
      )}

      {needsReauth && (
        <div className="messenger-banner-soft">
          Chat 스코프(chat.messages, chat.spaces.create 등)가 없거나 refresh token이 없으면 이 화면이 동작하지 않을 수 있습니다. Google 로그인으로 다시 인증해 주세요.
        </div>
      )}

      <div className={`messenger-layout ${isMobile ? 'messenger-layout--mobile' : ''}`}>
        <aside
          className={`messenger-list-panel ${isMobile ? 'messenger-list-panel--mobile' : ''} ${
            isMobile && mobileThreadOpen ? 'messenger-list-panel--mobile-hidden' : ''
          }`}
        >
          {isMobile && !mobileThreadOpen ? (
            <div className="messenger-mobile-editorial">
              <h2 className="messenger-mobile-recent-title">최근</h2>
              <p className="messenger-mobile-recent-sub">대화를 선택하거나 새 채팅을 시작하세요.</p>
            </div>
          ) : null}

          {isMobile && !mobileThreadOpen ? (
            <div className="messenger-mobile-search-wrap">
              <span className="material-symbols-outlined messenger-mobile-search-icon" aria-hidden>
                search
              </span>
              <input
                ref={listSearchRef}
                type="search"
                value={listFilter}
                onChange={(e) => setListFilter(e.target.value)}
                placeholder="대화 검색…"
                aria-label="대화 검색"
                className="messenger-mobile-search-input"
              />
            </div>
          ) : null}

          {isMobile && !mobileThreadOpen && filteredSpaces.length > 0 ? (
            <div className="messenger-mobile-stories" aria-label="대화 바로가기">
              {filteredSpaces.slice(0, 12).map((s) => {
                const isGroup =
                  (s.spaceType || s.type) === 'GROUP_CHAT' || (s.spaceType || s.type) === 'SPACE';
                const title = (s.displayName?.trim() || defaultSpaceTitle(s)).slice(0, 8);
                const active = s.name === selectedName;
                return (
                  <button
                    key={`story-${s.name}`}
                    type="button"
                    className={`messenger-mobile-story ${active ? 'messenger-mobile-story--active' : ''}`}
                    onClick={() => {
                      setSelectedName(s.name);
                      setMobileThreadOpen(true);
                    }}
                  >
                    <div
                      className={`messenger-mobile-story-avatar ${
                        isGroup ? 'messenger-mobile-story-avatar--group' : ''
                      }`}
                    >
                      <span className="material-symbols-outlined">
                        {isGroup ? 'groups' : 'person'}
                      </span>
                    </div>
                    <span className="messenger-mobile-story-label">{title}</span>
                  </button>
                );
              })}
            </div>
          ) : null}

          {!isMobile ? (
            <div className="messenger-list-head">
              <h2>대화</h2>
              <button
                type="button"
                className="messenger-new-chat-btn"
                onClick={() => setNewChatOpen(true)}
                disabled={needsReauth}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
                  add
                </span>
                새 채팅
              </button>
            </div>
          ) : null}
          <div className="messenger-list-search">
            <input
              type="search"
              value={listFilter}
              onChange={(e) => setListFilter(e.target.value)}
              placeholder="대화 검색…"
              aria-label="대화 검색"
            />
          </div>
          <div className="messenger-list-scroll">
            {spacesLoading ? (
              <div className="messenger-loading-inline">목록 불러오는 중…</div>
            ) : filteredSpaces.length === 0 ? (
              <div className="messenger-list-empty">
                대화가 없습니다. 새 채팅으로 스페이스를 만드세요.
              </div>
            ) : (
              filteredSpaces.map((s) => {
                const isGroup =
                  (s.spaceType || s.type) === 'GROUP_CHAT' || (s.spaceType || s.type) === 'SPACE';
                const title = s.displayName?.trim() || defaultSpaceTitle(s);
                const pv = previews[s.name];
                const previewText = pv?.text || '메시지를 열어 확인하세요';
                const timeShow = formatListTime(pv?.time);
                const active = s.name === selectedName;
                return (
                  <button
                    key={s.name}
                    type="button"
                    className={`messenger-list-item ${active ? 'messenger-list-item--active' : ''}`}
                    onClick={() => {
                      setSelectedName(s.name);
                      if (isMobile) setMobileThreadOpen(true);
                    }}
                  >
                    <div
                      className={`messenger-list-avatar ${isGroup ? 'messenger-list-avatar--group' : ''}`}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '26px' }}>
                        {isGroup ? 'groups' : 'person'}
                      </span>
                    </div>
                    <div className="messenger-list-item-body">
                      <div className="messenger-list-item-top">
                        <p className="messenger-list-item-name">{title}</p>
                        {timeShow ? <span className="messenger-list-item-time">{timeShow}</span> : null}
                      </div>
                      <p
                        className={`messenger-list-item-preview ${
                          active ? 'messenger-list-item-preview--active' : ''
                        }`}
                      >
                        {previewText}
                      </p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {showMobileListChrome ? (
          <>
            <button
              type="button"
              className="messenger-mobile-fab"
              aria-label="새 채팅"
              disabled={needsReauth}
              onClick={() => setNewChatOpen(true)}
            >
              <span className="material-symbols-outlined">add_comment</span>
            </button>
            <nav className="messenger-mobile-bottomnav" aria-label="메신저 하단 메뉴">
              <Link
                to="/messenger"
                className="messenger-mobile-bottomnav-item messenger-mobile-bottomnav-item--active"
                aria-current="page"
              >
                <span className="material-symbols-outlined">forum</span>
                <span>채팅</span>
              </Link>
              <Link to="/customer-company-employees" className="messenger-mobile-bottomnav-item">
                <span className="material-symbols-outlined">contacts</span>
                <span>연락처</span>
              </Link>
              <Link to="/company-overview" className="messenger-mobile-bottomnav-item">
                <span className="material-symbols-outlined">settings</span>
                <span>설정</span>
              </Link>
            </nav>
          </>
        ) : null}

        <section
          className={`messenger-thread ${isMobile ? 'messenger-thread--mobile' : ''} ${
            isMobile && !mobileThreadOpen ? 'messenger-thread--mobile-hidden' : ''
          }`}
        >
          {!selectedSpace ? (
            <div className="messenger-placeholder">
              {isMobile ? '대화를 선택하세요.' : '왼쪽에서 대화를 선택하세요.'}
            </div>
          ) : (
            <>
              {isMobile && mobileThreadOpen ? (
                <header className="messenger-mobile-thread-appbar">
                  <button
                    type="button"
                    className="messenger-mobile-thread-back"
                    aria-label="목록으로"
                    onClick={() => setMobileThreadOpen(false)}
                  >
                    <span className="material-symbols-outlined">arrow_back</span>
                  </button>
                  <div className="messenger-mobile-thread-appbar-center">
                    <div
                      className={`messenger-mobile-thread-avatar ${
                        (selectedSpace.spaceType || selectedSpace.type) !== 'DIRECT_MESSAGE'
                          ? 'messenger-mobile-thread-avatar--group'
                          : ''
                      }`}
                    >
                      {(selectedSpace.spaceType || selectedSpace.type) !== 'DIRECT_MESSAGE' ? (
                        <span className="material-symbols-outlined">groups</span>
                      ) : (
                        <span className="material-symbols-outlined">person</span>
                      )}
                    </div>
                    <div className="messenger-mobile-thread-titles">
                      <h3>{headerTitle}</h3>
                      <p>{headerSubtitle}</p>
                    </div>
                  </div>
                  <div className="messenger-mobile-thread-appbar-actions">
                    <button
                      type="button"
                      title="목록 새로고침"
                      aria-label="새로고침"
                      onClick={() => {
                        void loadSpaces();
                        void loadThread(selectedName);
                      }}
                    >
                      <span className="material-symbols-outlined">refresh</span>
                    </button>
                    <button
                      type="button"
                      title="Google Chat 웹"
                      aria-label="Google Chat 열기"
                      onClick={() => window.open('https://chat.google.com', '_blank', 'noopener,noreferrer')}
                    >
                      <span className="material-symbols-outlined">open_in_new</span>
                    </button>
                  </div>
                </header>
              ) : null}

              {!isMobile ? (
                <header className="messenger-thread-header">
                  <div className="messenger-thread-peer">
                    <div
                      className={`messenger-thread-peer-avatar ${
                        (selectedSpace.spaceType || selectedSpace.type) !== 'DIRECT_MESSAGE'
                          ? 'messenger-thread-peer-avatar--group'
                          : ''
                      }`}
                    >
                      {(selectedSpace.spaceType || selectedSpace.type) !== 'DIRECT_MESSAGE' ? (
                        <span className="material-symbols-outlined">groups</span>
                      ) : null}
                    </div>
                    <div className="messenger-thread-peer-text">
                      <h3>{headerTitle}</h3>
                      <p>{headerSubtitle}</p>
                    </div>
                  </div>
                  <div className="messenger-thread-actions">
                    <button
                      type="button"
                      title="목록 새로고침"
                      aria-label="새로고침"
                      onClick={() => {
                        void loadSpaces();
                        void loadThread(selectedName);
                      }}
                    >
                      <span className="material-symbols-outlined">refresh</span>
                    </button>
                    <button
                      type="button"
                      title="Google Chat 웹"
                      aria-label="Google Chat 열기"
                      onClick={() => window.open('https://chat.google.com', '_blank', 'noopener,noreferrer')}
                    >
                      <span className="material-symbols-outlined">open_in_new</span>
                    </button>
                  </div>
                </header>
              ) : null}

              <div className="messenger-msgs">
                {messagesLoading ? (
                  <div className="messenger-loading-inline">메시지 불러오는 중…</div>
                ) : (
                  messages.map((m, i) => {
                    const body = extractMessageText(m);
                    const atts = attachmentsOf(m);
                    const senderRn = m.sender?.name || '';
                    const isOut = !!(myResourceName && senderRn === myResourceName);
                    const prev = i > 0 ? messages[i - 1] : null;
                    const showDay =
                      !!dayKey(m.createTime) &&
                      (!prev || dayKey(m.createTime) !== dayKey(prev.createTime));
                    const senderDisplay = getSenderDisplayName(m, members, senderNamesByResource);
                    const prevSenderRn = prev?.sender?.name || '';
                    const showIncomingSender =
                      !isOut &&
                      senderDisplay &&
                      (i === 0 || prevSenderRn !== senderRn);
                    const avatarInitial =
                      !isOut && senderDisplay ? senderDisplay.charAt(0).toUpperCase() : '';
                    return (
                      <div key={m.name || m.createTime + (m.text || '')}>
                        {showDay ? (
                          <div className="messenger-day-pill">
                            <span>{dayLabel(m.createTime)}</span>
                          </div>
                        ) : null}
                        <div className={`messenger-row ${isOut ? 'messenger-row--out' : ''}`}>
                          {!isOut ? (
                            <div
                              className={`messenger-msg-avatar${avatarInitial ? '' : ' messenger-msg-avatar--empty'}`}
                              aria-hidden
                            >
                              {avatarInitial || null}
                            </div>
                          ) : null}
                          <div className="messenger-msg-col">
                            {showIncomingSender ? (
                              <div className="messenger-sender-label">{senderDisplay}</div>
                            ) : null}
                            <div className="messenger-bubble">
                              {body || (atts.length ? '' : '(내용 없음)')}
                              {atts.length > 0 ? (
                                <div className="messenger-attach">
                                  첨부 {atts.length}건 (Google Chat에서 미리보기)
                                </div>
                              ) : null}
                            </div>
                            <div className="messenger-msg-meta">
                              {formatMsgTime(m.createTime)}
                              {isOut ? (
                                <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>
                                  done_all
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={msgsEndRef} />
              </div>

              <footer className="messenger-input-wrap">
                <div className="messenger-input-shell">
                  <div className="messenger-input-tools">
                    <button type="button" disabled title="첨부는 Google Chat에서 지원합니다" aria-label="추가">
                      <span className="material-symbols-outlined">add_circle</span>
                    </button>
                    <button type="button" disabled title="이미지는 API 업로드 별도" aria-label="이미지">
                      <span className="material-symbols-outlined">image</span>
                    </button>
                    <button type="button" disabled title="파일 첨부는 chat.googleapis.com media API" aria-label="첨부">
                      <span className="material-symbols-outlined">attach_file</span>
                    </button>
                  </div>
                  <textarea
                    className="messenger-input-field"
                    rows={1}
                    placeholder="메시지를 입력하세요…"
                    value={compose}
                    onChange={(e) => setCompose(e.target.value)}
                    onKeyDown={onKeyDownInput}
                    disabled={needsReauth || sendLoading}
                  />
                  <div className="messenger-input-tools">
                    <button type="button" disabled title="이모지" aria-label="이모지">
                      <span className="material-symbols-outlined">sentiment_satisfied</span>
                    </button>
                    <button
                      type="button"
                      className="messenger-send-btn"
                      aria-label="전송"
                      disabled={needsReauth || sendLoading || !compose.trim()}
                      onClick={() => void sendMessage()}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
                        send
                      </span>
                    </button>
                  </div>
                </div>
                <p className="messenger-input-hint">Enter로 전송 · Shift+Enter로 줄 바꿈</p>
              </footer>
            </>
          )}
        </section>
      </div>

      <NewChatModal
        open={newChatOpen}
        loading={newChatLoading}
        inviteEmails={newChatInviteEmails}
        onInviteEmailsChange={setNewChatInviteEmails}
        onRequestParticipantPicker={openNewChatParticipantPicker}
        onClose={() => {
          if (newChatLoading) return;
          if (participantPickerOpen) {
            setParticipantPickerOpen(false);
            return;
          }
          setNewChatOpen(false);
        }}
        onSubmit={handleNewChat}
      />

      {participantPickerOpen ? (
        <div className="messenger-new-chat-participant-layer">
          <ParticipantModal
            key={`new-chat-picker-${newChatInviteEmails.join('|')}`}
            teamMembers={teamMembers}
            selected={participantPickerInitialSelection}
            currentUser={currentUser}
            title="초대할 팀원 선택"
            bulkAddLabel="표시된 인원 모두 초대 목록에 추가"
            onConfirm={handleNewChatParticipantConfirm}
            onClose={() => setParticipantPickerOpen(false)}
          />
        </div>
      ) : null}
    </div>
  );
}
