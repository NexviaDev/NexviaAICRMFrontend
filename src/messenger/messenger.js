import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { API_BASE } from '@/config';
import PageHeaderNotifyChat from '@/components/page-header-notify-chat/page-header-notify-chat';
import ParticipantModal from '@/shared/participant-modal/participant-modal';
import NewChatModal from './new-chat-modal/new-chat-modal';
import SaveContactModal from './save-contact-modal/save-contact-modal';
import { GoogleWorkspaceChatPolicyHint } from '@/lib/google-workspace-chat-hint';
import { MESSENGER_MESSAGE_POLL_MS } from '@/lib/polling-intervals';
import './messenger.css';

/** Google Chat REST 문서 URL — JSX에서 링크로 쓰일 때 미정의 오류 방지 */
const CHAT_API_DOCS = 'https://developers.google.com/workspace/chat/api/reference/rest';
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

function AttachmentList({ attachments, isOut }) {
  const list = Array.isArray(attachments) ? attachments : [];
  if (!list.length) return null;
  return (
    <div className={`messenger-attach-list${isOut ? ' messenger-attach-list--out' : ''}`}>
      {list.map((att, i) => {
        const thumb = att.thumbnailUri;
        const dl = att.downloadUri;
        const name = (att.contentName || att.name || '').trim() || '첨부';
        return (
          <div key={att.name || `${i}-${name}`} className="messenger-attach messenger-attach--item">
            {thumb ? (
              <a
                href={dl || thumb}
                target="_blank"
                rel="noreferrer"
                className="messenger-attach-img-wrap"
              >
                <img src={thumb} alt="" className="messenger-attach-img" />
              </a>
            ) : dl ? (
              <a href={dl} target="_blank" rel="noreferrer" className="messenger-attach-link">
                {name}
              </a>
            ) : (
              <span className="messenger-attach-muted">{name}</span>
            )}
          </div>
        );
      })}
    </div>
  );
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

/** Google Chat `users/…` resourceName 정규화 (주소록 키·API 일치) */
function normalizeChatResourceName(rn) {
  if (!rn || typeof rn !== 'string') return '';
  const t = rn.trim();
  if (!t) return '';
  return t.startsWith('users/') ? t : `users/${t}`;
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

/** Google `users/` 뒤 숫자만 있는 긴 식별자 — 이메일·표시명 없이 내부 ID만 있는 경우 */
function isOpaqueGoogleUserId(id) {
  if (id == null || typeof id !== 'string') return false;
  const t = id.trim();
  return t.length >= 12 && /^\d+$/.test(t);
}

/** 상대를 사람 이름으로 알 수 없고 숫자 ID만 있는 경우 — 실루엣 아이콘으로 대체 */
function shouldShowDmSilhouette(peer) {
  if (!peer) return false;
  return isOpaqueGoogleUserId(peer.chatUserId) && peer.displayName === peer.chatUserId;
}

/** 멤버십에서 1:1 상대 한 명 추출 — 스레드 헤더·왼쪽 목록 공통 */
function computeDmPeerFromMemberships(memberships, myResourceName, resolvedByRn) {
  if (!Array.isArray(memberships) || !memberships.length) return null;
  const other = memberships.find((x) => x?.member?.name && x.member.name !== myResourceName);
  if (!other?.member?.name) return null;
  const rn = other.member.name;
  const chatUserId = rn.startsWith('users/') ? rn.slice('users/'.length) : rn;
  let displayName = (other.member.displayName || '').trim();
  if (!displayName && resolvedByRn && resolvedByRn[rn]) displayName = String(resolvedByRn[rn]).trim();
  if (!displayName) displayName = chatUserId;
  return { displayName, chatUserId, resourceName: rn };
}

/**
 * 왼쪽 목록·모바일 스토리 텍스트. 1:1은 이름만(식별 가능할 때); 숫자 ID만 있으면 빈 문자열(실루엣은 JSX).
 */
function getSpaceListTitle(s, dmPeerBySpace) {
  const dn = s?.displayName?.trim();
  if (dn) return dn;
  const st = s?.spaceType || s?.type;
  if (st === 'DIRECT_MESSAGE') {
    const peer = dmPeerBySpace[s.name];
    if (peer) {
      if (shouldShowDmSilhouette(peer)) return '';
      if (peer.displayName === peer.chatUserId) return peer.chatUserId;
      return peer.displayName;
    }
  }
  return defaultSpaceTitle(s);
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
  const [addMembersOpen, setAddMembersOpen] = useState(false);
  const [addMembersInviteEmails, setAddMembersInviteEmails] = useState([]);
  const [addMembersLoading, setAddMembersLoading] = useState(false);
  const [participantPickerOpen, setParticipantPickerOpen] = useState(false);
  /** 팀원 선택 모달이 어느 흐름인지 (새 채팅 vs 대화상대 추가) */
  const [participantPickerMode, setParticipantPickerMode] = useState(null);
  const [teamMembers, setTeamMembers] = useState([]);
  const [previews, setPreviews] = useState(() => ({}));
  /** space full name → 1:1 상대 표시용 (목록에서 '1:1 대화' 대신 이름·아이디) */
  const [dmPeerBySpace, setDmPeerBySpace] = useState(() => ({}));
  const dmPeerBySpaceRef = useRef({});
  const dmPeerFetchInFlightRef = useRef(new Set());
  /** 1:1 표시명 일괄 보강(resolve-user-names) — 짧은 연속 갱신은 한 번으로 묶음 */
  const bulkResolveDebounceRef = useRef(null);
  const bulkResolveGenRef = useRef(0);
  const msgsEndRef = useRef(null);
  /** Chat 주소록(UserChatContact)에 등록된 상대 — chatResourceName 정규화 키 */
  const [chatContactsRns, setChatContactsRns] = useState(() => ({}));
  const [saveContactOpen, setSaveContactOpen] = useState(false);
  const [saveContactLoading, setSaveContactLoading] = useState(false);
  const [saveContactPrefillLoading, setSaveContactPrefillLoading] = useState(false);
  const [saveContactRn, setSaveContactRn] = useState('');
  const [saveContactForm, setSaveContactForm] = useState({
    displayName: '',
    email: '',
    phone: '',
    memo: ''
  });
  const [saveContactError, setSaveContactError] = useState('');
  const [saveContactIsEdit, setSaveContactIsEdit] = useState(false);

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

  const loadChatContacts = useCallback(async () => {
    try {
      const res = await fetchWithColdStartRetry(`${API_BASE}/google-chat/my-contacts`, {
        headers: { ...getAuthHeader() },
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;
      const list = Array.isArray(data.contacts) ? data.contacts : [];
      const map = {};
      list.forEach((c) => {
        const k = normalizeChatResourceName(c.chatResourceName);
        if (k) map[k] = true;
      });
      setChatContactsRns(map);
    } catch (_) {
      /* 목록만 실패 — 등록 버튼은 계속 표시 가능 */
    }
  }, []);

  const participantPickerInitialSelection = useMemo(() => {
    const src =
      participantPickerMode === 'addMembers' ? addMembersInviteEmails : newChatInviteEmails;
    if (!src.length || !teamMembers.length) return [];
    const set = new Set(src.map((e) => String(e).trim().toLowerCase()));
    return teamMembers
      .filter((m) => m.email && set.has(String(m.email).trim().toLowerCase()))
      .map((m) => ({ userId: m._id, name: m.name || m.email }));
  }, [participantPickerMode, newChatInviteEmails, addMembersInviteEmails, teamMembers]);

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

  useEffect(() => {
    dmPeerBySpaceRef.current = dmPeerBySpace;
  }, [dmPeerBySpace]);

  /** 목록에 없는 스페이스 키 정리 */
  useEffect(() => {
    const keep = new Set(spaces.map((s) => s.name));
    setDmPeerBySpace((prev) => {
      const keys = Object.keys(prev);
      const stale = keys.filter((k) => !keep.has(k));
      if (stale.length === 0) return prev;
      const next = { ...prev };
      stale.forEach((k) => {
        delete next[k];
      });
      return next;
    });
  }, [spaces]);

  /** 열린 1:1 스레드의 멤버 정보를 목록 캐시에 반영 */
  useEffect(() => {
    if (!selectedName) return;
    const sp = spaces.find((s) => s.name === selectedName);
    if (!sp) return;
    const st = sp.spaceType || sp.type;
    if (st !== 'DIRECT_MESSAGE' || !members.length) return;
    const peer = computeDmPeerFromMemberships(members, myResourceName, senderNamesByResource);
    if (!peer) return;
    setDmPeerBySpace((prev) => ({ ...prev, [selectedName]: peer }));
  }, [selectedName, spaces, members, myResourceName, senderNamesByResource]);

  /** displayName 없는 1:1 방마다 멤버 API로 상대 표시명·users/아이디 조회 (목록 라벨용) */
  useEffect(() => {
    if (!spaces.length || !myResourceName) return;
    let cancelled = false;
    const run = async () => {
      const need = spaces.filter((s) => {
        const st = s.spaceType || s.type;
        if (st !== 'DIRECT_MESSAGE') return false;
        if (s.displayName?.trim()) return false;
        if (dmPeerBySpaceRef.current[s.name]) return false;
        if (dmPeerFetchInFlightRef.current.has(s.name)) return false;
        return true;
      });
      const BATCH = 3;
      for (let i = 0; i < need.length; i += BATCH) {
        if (cancelled) return;
        const chunk = need.slice(i, i + BATCH);
        await Promise.all(
          chunk.map((s) =>
            (async () => {
              if (cancelled) return;
              dmPeerFetchInFlightRef.current.add(s.name);
              try {
                const sid = encodeURIComponent(spaceIdFromName(s.name));
                const res = await fetchWithColdStartRetry(
                  `${API_BASE}/google-chat/spaces/${sid}/members?pageSize=100`,
                  { headers: { ...getAuthHeader() } }
                );
                const data = await res.json().catch(() => ({}));
                if (cancelled || !res.ok) return;
                const memberships = Array.isArray(data.memberships) ? data.memberships : [];
                const peer = computeDmPeerFromMemberships(
                  memberships,
                  myResourceName,
                  senderNamesByResource
                );
                if (!peer || cancelled) return;
                setDmPeerBySpace((prev) => {
                  if (prev[s.name]) return prev;
                  return { ...prev, [s.name]: peer };
                });
              } catch (_) {
                /* 조용히 건너뜀 */
              } finally {
                dmPeerFetchInFlightRef.current.delete(s.name);
              }
            })()
          )
        );
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [spaces, myResourceName, senderNamesByResource]);

  /**
   * 모든 1:1 방: 멤버로 잡힌 각 users/… 에 대해 resolve-user-names를 주기적으로 호출.
   * - 예전: 실루엣일 때만 + senderNames에 없을 때만 요청 → CRM 이름 변경·목록 최신화가 안 됨.
   * - 지금: dmPeer·spaces가 바뀔 때마다 디바운스 후 일괄 요청(캐시 스킵 없음) → 동료 googleId→이름 등 최신 반영.
   */
  useEffect(() => {
    if (!myResourceName) return;
    if (bulkResolveDebounceRef.current) clearTimeout(bulkResolveDebounceRef.current);
    const gen = bulkResolveGenRef.current + 1;
    bulkResolveGenRef.current = gen;
    bulkResolveDebounceRef.current = window.setTimeout(() => {
      bulkResolveDebounceRef.current = null;
      const unique = [
        ...new Set(
          Object.values(dmPeerBySpace)
            .map((p) => p?.resourceName)
            .filter(Boolean)
        )
      ];
      if (unique.length === 0) return;
      (async () => {
        try {
          const res = await fetchWithColdStartRetry(`${API_BASE}/google-chat/resolve-user-names`, {
            method: 'POST',
            headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ resourceNames: unique })
          });
          const data = await res.json().catch(() => ({}));
          if (gen !== bulkResolveGenRef.current || !res.ok) return;
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
          /* 실패 시 기존 표시 유지 */
        }
      })();
    }, 450);
    return () => {
      if (bulkResolveDebounceRef.current) {
        clearTimeout(bulkResolveDebounceRef.current);
        bulkResolveDebounceRef.current = null;
      }
      bulkResolveGenRef.current += 1;
    };
  }, [dmPeerBySpace, myResourceName, spaces]);

  /** resolve-user-names 로 이름이 뒤늦게 채워지면 목록 캐시의 표시명도 갱신 */
  useEffect(() => {
    setDmPeerBySpace((prev) => {
      let next = null;
      for (const [spaceName, peer] of Object.entries(prev)) {
        const rn = peer.resourceName;
        if (!rn) continue;
        const better = senderNamesByResource[rn];
        if (!better || typeof better !== 'string') continue;
        const trimmed = better.trim();
        if (!trimmed || trimmed === peer.displayName) continue;
        if (!next) next = { ...prev };
        next[spaceName] = { ...peer, displayName: trimmed };
      }
      return next || prev;
    });
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

  useEffect(() => {
    if (!addMembersOpen) return;
    setAddMembersInviteEmails([]);
    fetchTeamMembers();
  }, [addMembersOpen, fetchTeamMembers]);

  const handleParticipantPickerConfirm = useCallback(
    (selected) => {
      const emails = selected
        .map((s) => teamMembers.find((t) => String(t._id) === String(s.userId)))
        .filter(Boolean)
        .map((m) => m.email)
        .filter(Boolean);
      const merge = (prev) => {
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
      };
      if (participantPickerMode === 'addMembers') {
        setAddMembersInviteEmails(merge);
      } else {
        setNewChatInviteEmails(merge);
      }
      setParticipantPickerOpen(false);
      setParticipantPickerMode(null);
    },
    [teamMembers, participantPickerMode]
  );

  const openParticipantPicker = useCallback(
    (mode) => {
      if (teamMembers.length === 0) fetchTeamMembers();
      setParticipantPickerMode(mode);
      setParticipantPickerOpen(true);
    },
    [teamMembers.length, fetchTeamMembers]
  );

  /** 새 채팅 모달 등에서 잘못된 핸들러 이름으로 참조될 때 대비 */
  const openNewChatParticipantPicker = useCallback(
    () => openParticipantPicker('newChat'),
    [openParticipantPicker]
  );

  const selectedSpace = useMemo(
    () => spaces.find((s) => s.name === selectedName) || null,
    [spaces, selectedName]
  );

  /**
   * 1:1(DIRECT_MESSAGE) 상대: Google Chat member.name → `users/` 뒤가 이메일 또는 숫자 ID.
   * People API 등으로 보강된 senderNamesByResource 를 이름 후보로 사용.
   */
  const dmPeerDetail = useMemo(
    () =>
      selectedSpace &&
      (selectedSpace.spaceType || selectedSpace.type) === 'DIRECT_MESSAGE' &&
      members.length
        ? computeDmPeerFromMemberships(members, myResourceName, senderNamesByResource)
        : null,
    [selectedSpace, members, myResourceName, senderNamesByResource]
  );

  /** 말풍선 위 발신자 이름 옆 — 주소록 등록·수정 (본인 제외) */
  const shouldShowAddressbookAction = useCallback(
    (senderRn) => {
      if (needsReauth || !senderRn || !myResourceName) return false;
      if (senderRn === myResourceName) return false;
      const key = normalizeChatResourceName(senderRn);
      return !!key;
    },
    [needsReauth, myResourceName]
  );

  const openSaveContactModalForSender = useCallback((senderRn, hintDisplayName) => {
    if (!senderRn) return;
    const rn = normalizeChatResourceName(senderRn);
    setSaveContactRn(rn);
    setSaveContactError('');
    setSaveContactIsEdit(!!chatContactsRns[rn]);
    setSaveContactForm({ displayName: '', email: '', phone: '', memo: '' });
    setSaveContactOpen(true);
    setSaveContactPrefillLoading(true);
    (async () => {
      try {
        const q = encodeURIComponent(rn);
        const res = await fetchWithColdStartRetry(
          `${API_BASE}/google-chat/profile?resourceName=${q}`,
          { headers: { ...getAuthHeader() }, credentials: 'include' }
        );
        const data = await res.json().catch(() => ({}));
        const fromApi = (data.displayName && String(data.displayName).trim()) || '';
        const hint = (hintDisplayName && String(hintDisplayName).trim()) || '';
        const hintOk = hint && !isOpaqueGoogleUserId(hint);
        setSaveContactForm({
          displayName: fromApi || (hintOk ? hint : '') || '',
          email: data.email != null ? String(data.email).trim() : '',
          phone: data.phone != null ? String(data.phone).trim() : '',
          memo: data.memo != null ? String(data.memo).trim() : ''
        });
      } finally {
        setSaveContactPrefillLoading(false);
      }
    })();
  }, [chatContactsRns]);

  const submitSaveContact = useCallback(async () => {
    const name = saveContactForm.displayName.trim();
    if (!name) {
      setSaveContactError('이름을 입력해 주세요.');
      return;
    }
    const rnNorm = normalizeChatResourceName(saveContactRn);
    if (!rnNorm) {
      setSaveContactError('대화 상대 정보를 찾을 수 없습니다.');
      return;
    }
    setSaveContactLoading(true);
    setSaveContactError('');
    try {
      const res = await fetch(`${API_BASE}/google-chat/my-contacts`, {
        method: 'POST',
        headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          chatResourceName: rnNorm,
          displayName: name,
          email: saveContactForm.email.trim(),
          phone: saveContactForm.phone.trim(),
          memo: saveContactForm.memo.trim()
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveContactError(data.error || '저장에 실패했습니다.');
        return;
      }
      setChatContactsRns((p) => ({ ...p, [rnNorm]: true }));
      setSenderNamesByResource((p) => {
        const merged = { ...p, [rnNorm]: name };
        senderNamesRef.current = merged;
        return merged;
      });
      setDmPeerBySpace((prev) => {
        let next = null;
        for (const [spaceName, peer] of Object.entries(prev)) {
          if (normalizeChatResourceName(peer?.resourceName) !== rnNorm) continue;
          if (!next) next = { ...prev };
          next[spaceName] = { ...peer, displayName: name };
        }
        return next || prev;
      });
      setSaveContactOpen(false);
    } catch (_) {
      setSaveContactError('네트워크 오류입니다.');
    } finally {
      setSaveContactLoading(false);
    }
  }, [saveContactForm, saveContactRn]);

  const headerTitle = useMemo(() => {
    if (!selectedSpace) return '';
    if (selectedSpace.displayName?.trim()) return selectedSpace.displayName.trim();
    const st = selectedSpace.spaceType || selectedSpace.type;
    if (st === 'DIRECT_MESSAGE' && dmPeerDetail) {
      if (shouldShowDmSilhouette(dmPeerDetail)) return '';
      return dmPeerDetail.displayName;
    }
    if (st === 'GROUP_CHAT') {
      const humans = members.filter((x) => x?.member?.type === 'HUMAN');
      if (humans.length) return `그룹 (${humans.length}명)`;
    }
    return defaultSpaceTitle(selectedSpace);
  }, [selectedSpace, members, dmPeerDetail]);

  const headerDmTitleSilhouette = useMemo(
    () =>
      !!(
        selectedSpace &&
        dmPeerDetail &&
        (selectedSpace.spaceType || selectedSpace.type) === 'DIRECT_MESSAGE' &&
        shouldShowDmSilhouette(dmPeerDetail)
      ),
    [selectedSpace, dmPeerDetail]
  );

  const threadSubtitleNode = useMemo(() => {
    if (!selectedSpace) return null;
    const st = selectedSpace.spaceType || selectedSpace.type;
    if (st === 'SPACE' || st === 'GROUP_CHAT') return spaceTypeKo(st);
    if (st === 'DIRECT_MESSAGE' && dmPeerDetail?.chatUserId) {
      const showIcon = isOpaqueGoogleUserId(dmPeerDetail.chatUserId);
      return (
        <>
          {showIcon ? (
            <span
              className="messenger-dm-opaque-id-icon"
              title="Google 계정 식별자(비공개)"
              aria-hidden
            >
              <span className="material-symbols-outlined">person</span>
            </span>
          ) : (
            <span className="messenger-dm-peer-id-text">{dmPeerDetail.chatUserId}</span>
          )}
          <span className="messenger-dm-subtitle-sep"> · </span>
          <span>Google Chat · Direct</span>
        </>
      );
    }
    return 'Google Chat · Direct';
  }, [selectedSpace, dmPeerDetail]);

  /** Google Chat 1:1(DM)은 멤버 추가 API 대상이 아님 — 그룹/스페이스만 */
  const canInviteToCurrentSpace = useMemo(() => {
    if (!selectedSpace) return false;
    const st = selectedSpace.spaceType || selectedSpace.type;
    return st === 'GROUP_CHAT' || st === 'SPACE';
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

  const refreshMessengerChrome = useCallback(() => {
    void loadSpaces({ silent: true });
    if (selectedName) void loadThread(selectedName, { silent: true });
    void loadChatContacts();
  }, [loadSpaces, loadThread, selectedName, loadChatContacts]);

  useEffect(() => {
    void loadMe();
    void loadSpaces();
    void loadChatContacts();
  }, [loadMe, loadSpaces, loadChatContacts]);

  useEffect(() => {
    if (!selectedName) {
      setMessages([]);
      setMembers([]);
      return undefined;
    }
    setMessages([]);
    setMembers([]);
    void loadThread(selectedName);
    return undefined;
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
      void loadChatContacts();
    };

    const onFocus = () => {
      if (cancelled) return;
      void loadThread(selectedName, { silent: true, skipMembers: true });
    };

    const id = window.setInterval(pollMessages, MESSENGER_MESSAGE_POLL_MS);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);

    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
    };
  }, [selectedName, loadThread, loadSpaces, loadChatContacts]);

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
      void loadThread(selectedName, { silent: true });
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
      setParticipantPickerMode(null);
      await loadSpaces();
      if (createdName) setSelectedName(createdName);
    } catch (_) {
      setError('채팅방 생성 요청에 실패했습니다.');
    } finally {
      setNewChatLoading(false);
    }
  };

  const handleAddMembersToThread = async ({ inviteEmails: rawInviteEmails }) => {
    if (!selectedName) return;
    setAddMembersLoading(true);
    setError('');
    setNeedsReauth(false);
    const myEmail = String(currentUser?.email || '').trim().toLowerCase();
    const inviteEmails = [
      ...new Set((rawInviteEmails || []).map((e) => String(e).trim()).filter(Boolean))
    ].filter((e) => e.toLowerCase() !== myEmail);
    if (inviteEmails.length === 0) {
      setAddMembersLoading(false);
      setError('초대할 이메일을 한 명 이상 입력해 주세요.');
      return;
    }
    const sid = encodeURIComponent(spaceIdFromName(selectedName));
    try {
      const failures = [];
      for (const email of inviteEmails) {
        const inv = await fetch(`${API_BASE}/google-chat/spaces/${sid}/members`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
          body: JSON.stringify({ email })
        });
        const invData = await inv.json().catch(() => ({}));
        if (!inv.ok) {
          if (invData.needsReauth) setNeedsReauth(true);
          failures.push(`${email}: ${invData.error || '실패'}`);
        }
      }
      if (failures.length > 0) {
        setError(
          `일부 초대에 실패했습니다. (${failures.length}건) ${failures.slice(0, 3).join(' · ')}` +
            (failures.length > 3 ? ' …' : '')
        );
      }
      setAddMembersOpen(false);
      setAddMembersInviteEmails([]);
      setParticipantPickerOpen(false);
      setParticipantPickerMode(null);
      await loadThread(selectedName, { silent: true, skipMembers: false });
      await loadSpaces({ silent: true });
    } catch (_) {
      setError('대화상대 초대 요청에 실패했습니다.');
    } finally {
      setAddMembersLoading(false);
    }
  };

  const filteredSpaces = useMemo(() => {
    const q = listFilter.trim().toLowerCase();
    if (!q) return spaces;
    return spaces.filter((s) => {
      const title = getSpaceListTitle(s, dmPeerBySpace).toLowerCase();
      const pv = (previews[s.name]?.text || '').toLowerCase();
      return title.includes(q) || pv.includes(q);
    });
  }, [spaces, listFilter, dmPeerBySpace, previews]);

  const showMobileListChrome = isMobile && !mobileThreadOpen;

  return (
    <div className={`messenger-page ${isMobile ? 'messenger-page--mobile' : ''}`}>
      {!isMobile ? (
        <header className="messenger-top">
          <div>
            <h1 className="messenger-top-title">내부 메신저</h1>
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
                const peer = dmPeerBySpace[s.name];
                const storySilhouette =
                  !isGroup &&
                  (s.spaceType || s.type) === 'DIRECT_MESSAGE' &&
                  shouldShowDmSilhouette(peer);
                const titleText = getSpaceListTitle(s, dmPeerBySpace);
                const title = titleText.slice(0, 12);
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
                    <span className="messenger-mobile-story-label">
                      {storySilhouette ? (
                        <span
                          className="messenger-mobile-story-silhouette"
                          title="상대를 이름으로 식별하지 못했습니다"
                        >
                          <span className="material-symbols-outlined" aria-hidden>
                            person
                          </span>
                        </span>
                      ) : (
                        title
                      )}
                    </span>
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
                const peer = dmPeerBySpace[s.name];
                const listSilhouette =
                  !isGroup &&
                  (s.spaceType || s.type) === 'DIRECT_MESSAGE' &&
                  shouldShowDmSilhouette(peer);
                const title = getSpaceListTitle(s, dmPeerBySpace);
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
                        <p className="messenger-list-item-name">
                          {listSilhouette ? (
                            <span
                              className="messenger-list-name-silhouette"
                              title="상대를 이름으로 식별하지 못했습니다"
                            >
                              <span className="material-symbols-outlined" aria-hidden>
                                person
                              </span>
                            </span>
                          ) : (
                            title
                          )}
                        </p>
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
                      <h3>
                        {headerDmTitleSilhouette ? (
                          <span
                            className="messenger-header-title-silhouette"
                            title="상대를 이름으로 식별하지 못했습니다"
                          >
                            <span className="material-symbols-outlined" aria-hidden>
                              person
                            </span>
                          </span>
                        ) : (
                          headerTitle || '—'
                        )}
                      </h3>
                      <p className="messenger-thread-peer-sub-dm">{threadSubtitleNode}</p>
                    </div>
                  </div>
                  <div className="messenger-mobile-thread-appbar-actions">
                    <button
                      type="button"
                      title={
                        canInviteToCurrentSpace
                          ? '대화상대 초대'
                          : '1:1 대화에는 추가할 수 없습니다. 그룹 채팅에서 사용하세요.'
                      }
                      aria-label="대화상대 추가"
                      disabled={needsReauth || !canInviteToCurrentSpace}
                      onClick={() => {
                        if (!canInviteToCurrentSpace) return;
                        setAddMembersOpen(true);
                      }}
                    >
                      <span className="material-symbols-outlined">person_add</span>
                    </button>
                    <button
                      type="button"
                      title="목록 새로고침"
                      aria-label="새로고침"
                      onClick={() => {
                        refreshMessengerChrome();
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
                      <h3>
                        {headerDmTitleSilhouette ? (
                          <span
                            className="messenger-header-title-silhouette"
                            title="상대를 이름으로 식별하지 못했습니다"
                          >
                            <span className="material-symbols-outlined" aria-hidden>
                              person
                            </span>
                          </span>
                        ) : (
                          headerTitle || '—'
                        )}
                      </h3>
                      <p className="messenger-thread-peer-sub-dm">{threadSubtitleNode}</p>
                    </div>
                  </div>
                  <div className="messenger-thread-actions">
                    <button
                      type="button"
                      title={
                        canInviteToCurrentSpace
                          ? '대화상대 초대'
                          : '1:1 대화에는 추가할 수 없습니다. 그룹 채팅에서 사용하세요.'
                      }
                      aria-label="대화상대 추가"
                      disabled={needsReauth || !canInviteToCurrentSpace}
                      onClick={() => {
                        if (!canInviteToCurrentSpace) return;
                        setAddMembersOpen(true);
                      }}
                    >
                      <span className="material-symbols-outlined">person_add</span>
                    </button>
                    <button
                      type="button"
                      title="목록 새로고침"
                      aria-label="새로고침"
                      onClick={() => {
                        refreshMessengerChrome();
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
                {messagesLoading && messages.length === 0 ? (
                  <div className="messenger-loading-inline messenger-loading-inline--thread">
                    메시지 불러오는 중…
                  </div>
                ) : null}
                {messages.map((m, i) => {
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
                    const senderAddrKey = normalizeChatResourceName(senderRn);
                    const inMessengerAddressbook = !!(senderAddrKey && chatContactsRns[senderAddrKey]);
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
                              <div className="messenger-sender-row">
                                <span className="messenger-sender-label">{senderDisplay}</span>
                                {shouldShowAddressbookAction(senderRn) ? (
                                  <button
                                    type="button"
                                    className="messenger-sender-save-contact"
                                    title={
                                      inMessengerAddressbook
                                        ? 'CRM 메신저 주소록에 저장된 정보를 수정합니다'
                                        : 'CRM 메신저 주소록에 등록하면 이름·이메일로 표시를 맞출 수 있습니다'
                                    }
                                    disabled={needsReauth}
                                    onClick={() => openSaveContactModalForSender(senderRn, senderDisplay)}
                                  >
                                    {inMessengerAddressbook ? '수정' : '주소록'}
                                  </button>
                                ) : null}
                              </div>
                            ) : null}
                            <div className="messenger-bubble">
                              {body ? <span className="messenger-bubble-text">{body}</span> : null}
                              {!body && !atts.length ? '(내용 없음)' : null}
                              <AttachmentList attachments={atts} isOut={isOut} />
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
                })}
                <div ref={msgsEndRef} />
              </div>

              <footer className="messenger-input-wrap">
                <div className="messenger-input-shell">
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
                <p className="messenger-input-capability">
                  이모티콘은 입력란에 직접 입력하거나 붙여넣을 수 있습니다. 이 화면에서는 텍스트만 전송됩니다. 그림·파일은 Google Chat 웹에서 보내 주세요.
                </p>
              </footer>
            </>
          )}
        </section>
      </div>

      <SaveContactModal
        open={saveContactOpen}
        onClose={() => setSaveContactOpen(false)}
        isEdit={saveContactIsEdit}
        prefillLoading={saveContactPrefillLoading}
        saveLoading={saveContactLoading}
        form={saveContactForm}
        setForm={setSaveContactForm}
        error={saveContactError}
        onSubmit={submitSaveContact}
      />

      <NewChatModal
        open={newChatOpen}
        loading={newChatLoading}
        inviteEmails={newChatInviteEmails}
        onInviteEmailsChange={setNewChatInviteEmails}
        onRequestParticipantPicker={() => openParticipantPicker('newChat')}
        onClose={() => {
          if (newChatLoading) return;
          if (participantPickerOpen) {
            setParticipantPickerOpen(false);
            setParticipantPickerMode(null);
            return;
          }
          setNewChatOpen(false);
        }}
        onSubmit={handleNewChat}
      />

      <NewChatModal
        open={addMembersOpen}
        inviteOnly
        loading={addMembersLoading}
        inviteEmails={addMembersInviteEmails}
        onInviteEmailsChange={setAddMembersInviteEmails}
        onRequestParticipantPicker={() => openParticipantPicker('addMembers')}
        onClose={() => {
          if (addMembersLoading) return;
          if (participantPickerOpen) {
            setParticipantPickerOpen(false);
            setParticipantPickerMode(null);
            return;
          }
          setAddMembersOpen(false);
        }}
        onSubmit={handleAddMembersToThread}
      />

      {participantPickerOpen ? (
        <div className="messenger-new-chat-participant-layer">
          <ParticipantModal
            key={`picker-${participantPickerMode || 'x'}-${newChatInviteEmails.join('|')}-${addMembersInviteEmails.join('|')}`}
            teamMembers={teamMembers}
            selected={participantPickerInitialSelection}
            currentUser={currentUser}
            title="초대할 팀원 선택"
            bulkAddLabel="표시된 인원 모두 초대 목록에 추가"
            onConfirm={handleParticipantPickerConfirm}
            onClose={() => {
              setParticipantPickerOpen(false);
              setParticipantPickerMode(null);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
