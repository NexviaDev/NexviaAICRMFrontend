import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { API_BASE } from '@/config';
import ContactRegisterModal from './ContactRegisterModal';
import AddMemberModal from './AddMemberModal';
import NewChatModal from './NewChatModal';
import './chat.css';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** space name에서 id만 추출 (spaces/xxx → xxx) */
function spaceIdFromName(name) {
  if (!name || typeof name !== 'string') return '';
  const parts = name.split('/');
  return parts[parts.length - 1] || name;
}

/** member.name(users/xxx)에서 이메일 또는 식별자 추출 */
function memberNameToLabel(name) {
  if (!name || typeof name !== 'string') return '';
  const part = name.split('/').pop() || '';
  if (part.includes('@')) return part;
  if (/^\d+$/.test(part)) return `사용자 ${part}`;
  return part || '';
}

/** 한 명의 표시 이름 (resolved 맵 사용 시 실제 이름으로 표시) */
function memberDisplayName(memberOrSender, resolved) {
  const user = memberOrSender?.member ?? memberOrSender;
  if (!user) return memberOrSender?.groupMember?.name ? `그룹: ${memberOrSender.groupMember.name}` : '';
  const rn = user.name;
  if (resolved && rn && resolved[rn]) return resolved[rn];
  return user.displayName || memberNameToLabel(rn) || '';
}

/** 멤버 목록으로 스페이스 표시 이름 생성 (resolved: People API로 조회한 users/ID → 이름 맵) */
function labelFromMembers(space, members, resolved) {
  const list = members || [];
  const names = list
    .map((m) => (m.member ? memberDisplayName(m, resolved) : (m.groupMember?.name ? `그룹: ${m.groupMember.name}` : '')))
    .filter(Boolean);
  const spaceType = space.spaceType || space.type;
  if (spaceType === 'DIRECT_MESSAGE' || spaceType === 'DM') {
    return names.length ? names.join(', ') : '1:1 대화';
  }
  if (spaceType === 'GROUP_CHAT') {
    return names.length ? `그룹 채팅 (${names.length}명)` : '그룹 채팅';
  }
  return names.length ? names.slice(0, 3).join(', ') + (names.length > 3 ? ` 외 ${names.length - 3}명` : '') : null;
}

/** 메시지 목록에서 발신자 표시이름만 추출 (resolved 사용 시 실제 이름) */
function labelFromMessages(messages, resolved) {
  const list = messages || [];
  const seen = new Set();
  const names = list
    .map((msg) => memberDisplayName({ member: msg.sender }, resolved))
    .filter(Boolean)
    .filter((n) => {
      if (seen.has(n)) return false;
      seen.add(n);
      return true;
    });
  return names.length ? names.join(', ') : null;
}

/** 백엔드 People API로 users/ID → 표시 이름 조회. 반환: { resolved: {}, error?, hint? } */
async function fetchResolvedUserNames(resourceNames) {
  const list = [...new Set(resourceNames)].filter(Boolean);
  if (list.length === 0) return { resolved: {} };
  try {
    const res = await fetch(`${API_BASE}/google-chat/resolve-user-names`, {
      method: 'POST',
      headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ resourceNames: list })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { resolved: {}, error: data.error || '이름 조회 실패', hint: data.hint };
    }
    const hint = data._hint || data.hint;
    const resolved = { ...data };
    delete resolved._hint;
    delete resolved.hint;
    return { resolved, hint };
  } catch {
    return { resolved: {} };
  }
}

export default function GoogleChat() {
  const [spaces, setSpaces] = useState([]);
  const [spaceDisplayNames, setSpaceDisplayNames] = useState({});
  const [resolvedUserNames, setResolvedUserNames] = useState({});
  const [mySenderName, setMySenderName] = useState(null);
  const [selectedSpaceId, setSelectedSpaceId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [error, setError] = useState('');
  const [nameResolveHint, setNameResolveHint] = useState('');
  const [sendText, setSendText] = useState('');
  const [sending, setSending] = useState(false);
  const [savedContacts, setSavedContacts] = useState({});
  const [contactModal, setContactModal] = useState(null);
  const [contactSaving, setContactSaving] = useState(false);
  const [newChatModalOpen, setNewChatModalOpen] = useState(false);
  const [newChatCreating, setNewChatCreating] = useState(false);
  const [addMemberModalOpen, setAddMemberModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [customSpaceNames, setCustomSpaceNames] = useState(() => {
    try {
      const raw = localStorage.getItem('nexvia_chat_custom_space_names');
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });
  const [favoriteSpaceIds, setFavoriteSpaceIds] = useState(() => {
    try {
      const raw = localStorage.getItem('nexvia_chat_favorite_space_ids');
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [hiddenSpaceIds, setHiddenSpaceIds] = useState(() => {
    try {
      const raw = localStorage.getItem('nexvia_chat_hidden_space_ids');
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [spaceListTab, setSpaceListTab] = useState('all');
  const [editingSpaceName, setEditingSpaceName] = useState(false);
  const [editingSpaceNameValue, setEditingSpaceNameValue] = useState('');
  const messagesWrapRef = useRef(null);

  useEffect(() => {
    try {
      localStorage.setItem('nexvia_chat_custom_space_names', JSON.stringify(customSpaceNames));
    } catch (_) {}
  }, [customSpaceNames]);

  useEffect(() => {
    try {
      localStorage.setItem('nexvia_chat_favorite_space_ids', JSON.stringify(favoriteSpaceIds));
    } catch (_) {}
  }, [favoriteSpaceIds]);

  useEffect(() => {
    try {
      localStorage.setItem('nexvia_chat_hidden_space_ids', JSON.stringify(hiddenSpaceIds));
    } catch (_) {}
  }, [hiddenSpaceIds]);

  /** 새 메시지 추가/로드 시 맨 아래로 스크롤 */
  useEffect(() => {
    const el = messagesWrapRef.current;
    if (!el) return;
    const scrollToBottom = () => { el.scrollTop = el.scrollHeight; };
    scrollToBottom();
    requestAnimationFrame(scrollToBottom);
  }, [messages, selectedSpaceId, messagesLoading]);

  const fetchSpaces = useCallback(async () => {
    try {
      setError('');
      const res = await fetch(`${API_BASE}/google-chat/spaces`, { headers: getAuthHeader(), credentials: 'include' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '스페이스 목록을 불러올 수 없습니다.');
      }
      const data = await res.json();
      const items = data.spaces || [];
      setSpaces(items);
      setSpaceDisplayNames({});
      items.forEach((space) => {
        const id = spaceIdFromName(space.name);
        const hasName = !!(space.displayName && space.displayName.trim());
        if (hasName) {
          setSpaceDisplayNames((prev) => ({ ...prev, [id]: space.displayName.trim() }));
          return;
        }
        const headers = getAuthHeader();
        const encId = encodeURIComponent(id);
        fetch(`${API_BASE}/google-chat/spaces/${encId}/members?pageSize=20`, { headers, credentials: 'include' })
          .then((r) => r.json())
          .then(async (memberData) => {
            const members = memberData.memberships || [];
            const resourceNames = members.map((m) => m.member?.name).filter(Boolean);
            const { resolved, hint } = resourceNames.length ? await fetchResolvedUserNames(resourceNames) : { resolved: {} };
            if (hint) setNameResolveHint(hint);
            if (Object.keys(resolved).length) setResolvedUserNames((prev) => ({ ...prev, ...resolved }));
            let label = labelFromMembers(space, members, resolved) || '';
            const hasRealNames = label && label !== id && !/^사용자 \d+/.test(label) && label !== '1:1 대화' && label !== '그룹 채팅';
            if (!hasRealNames) {
              try {
                const msgRes = await fetch(`${API_BASE}/google-chat/spaces/${encId}/messages?pageSize=15`, { headers, credentials: 'include' });
                if (msgRes.ok) {
                  const msgData = await msgRes.json();
                  const msgList = msgData.messages || [];
                  const senderNames = msgList.map((m) => m.sender?.name).filter(Boolean);
                  const { resolved: msgResolved, hint: msgHint } = senderNames.length ? await fetchResolvedUserNames(senderNames) : { resolved: {} };
                  if (msgHint) setNameResolveHint(msgHint);
                  if (Object.keys(msgResolved).length) setResolvedUserNames((prev) => ({ ...prev, ...msgResolved }));
                  const fromMsg = labelFromMessages(msgList, msgResolved);
                  if (fromMsg) label = fromMsg;
                }
              } catch (_) {}
            }
            setSpaceDisplayNames((prev) => ({ ...prev, [id]: label || id }));
          })
          .catch(async () => {
            let label = id;
            try {
              const msgRes = await fetch(`${API_BASE}/google-chat/spaces/${encodeURIComponent(id)}/messages?pageSize=15`, {
                headers: getAuthHeader(),
                credentials: 'include'
              });
              if (msgRes.ok) {
                const msgData = await msgRes.json();
                const msgList = msgData.messages || [];
                const senderNames = msgList.map((m) => m.sender?.name).filter(Boolean);
                const { resolved, hint: catchHint } = senderNames.length ? await fetchResolvedUserNames(senderNames) : { resolved: {} };
                if (catchHint) setNameResolveHint(catchHint);
                if (Object.keys(resolved).length) setResolvedUserNames((prev) => ({ ...prev, ...resolved }));
                const fromMsg = labelFromMessages(msgList, resolved);
                if (fromMsg) label = fromMsg;
              }
            } catch (_) {}
            setSpaceDisplayNames((prev) => ({ ...prev, [id]: label }));
          });
      });
    } catch (err) {
      setError(err.message || '스페이스 조회 실패');
      setSpaces([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSpaces();
  }, [fetchSpaces]);

  useEffect(() => {
    fetch(`${API_BASE}/google-chat/me`, { headers: getAuthHeader(), credentials: 'include' })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data?.resourceName) setMySenderName(data.resourceName); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch(`${API_BASE}/google-chat/my-contacts`, { headers: getAuthHeader(), credentials: 'include' })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.contacts?.length) {
          const map = {};
          data.contacts.forEach((c) => { map[c.chatResourceName] = c; });
          setSavedContacts(map);
          setResolvedUserNames((prev) => {
            const next = { ...prev };
            data.contacts.forEach((c) => { next[c.chatResourceName] = c.displayName; });
            return next;
          });
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const validIds = new Set(spaces.map((space) => spaceIdFromName(space.name)));
    setFavoriteSpaceIds((prev) => prev.filter((id) => validIds.has(id)));
    setHiddenSpaceIds((prev) => prev.filter((id) => validIds.has(id)));
  }, [spaces]);

  const fetchMessages = useCallback(async (spaceId, silent = false) => {
    if (!spaceId) {
      setMessages([]);
      return;
    }
    if (!silent) setMessagesLoading(true);
    try {
      if (!silent) setError('');
      const res = await fetch(`${API_BASE}/google-chat/spaces/${encodeURIComponent(spaceId)}/messages?pageSize=50`, {
        headers: getAuthHeader(),
        credentials: 'include'
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '메시지를 불러올 수 없습니다.');
      }
      const data = await res.json();
      const list = data.messages || [];
      const sorted = list.sort((a, b) => new Date(a.createTime || 0) - new Date(b.createTime || 0));
      if (silent) {
        setMessages((prev) => {
          const byName = new Map(prev.map((m) => [m.name, m]));
          sorted.forEach((m) => byName.set(m.name, m));
          return [...byName.values()].sort((a, b) => new Date(a.createTime || 0) - new Date(b.createTime || 0));
        });
        return;
      }
      setMessages(sorted);
      const senderNames = list.map((m) => m.sender?.name).filter(Boolean);
      const { resolved: toResolve, hint: resolveHint } = senderNames.length ? await fetchResolvedUserNames(senderNames) : { resolved: {} };
      if (resolveHint) setNameResolveHint(resolveHint);
      if (Object.keys(toResolve).length) setResolvedUserNames((prev) => ({ ...prev, ...toResolve }));
      const fromSenders = labelFromMessages(list, toResolve);
      if (fromSenders) {
        setSpaceDisplayNames((prev) => {
          const current = prev[spaceId];
          if (!current || current === spaceId || /^사용자 \d+/.test(current) || current === '1:1 대화' || current === '그룹 채팅') {
            return { ...prev, [spaceId]: fromSenders };
          }
          return prev;
        });
      }
    } catch (err) {
      if (!silent) setError(err.message || '메시지 조회 실패');
      if (!silent) setMessages([]);
    } finally {
      if (!silent) setMessagesLoading(false);
    }
  }, []);

  useEffect(() => {
    setSelectedSpaceId((current) => current);
    if (selectedSpaceId) fetchMessages(selectedSpaceId);
    else setMessages([]);
  }, [selectedSpaceId, fetchMessages]);

  useEffect(() => {
    if (!selectedSpaceId) return;
    const interval = setInterval(() => fetchMessages(selectedSpaceId, true), 2000);
    return () => clearInterval(interval);
  }, [selectedSpaceId, fetchMessages]);

  const handleSend = async (e) => {
    e.preventDefault();
    const text = (sendText || '').trim();
    if (!text || !selectedSpaceId || sending) return;
    setSending(true);
    try {
      setError('');
      const res = await fetch(`${API_BASE}/google-chat/spaces/${encodeURIComponent(selectedSpaceId)}/messages`, {
        method: 'POST',
        headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ text })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '메시지 전송 실패');
      }
      const created = await res.json();
      if (created.sender?.name) setMySenderName(created.sender.name);
      setSendText('');
      await fetchMessages(selectedSpaceId);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  const selectedSpace = spaces.find((s) => spaceIdFromName(s.name) === selectedSpaceId);
  const selectedDisplayName = selectedSpaceId
    ? (customSpaceNames[selectedSpaceId] ?? spaceDisplayNames[selectedSpaceId] ?? selectedSpace?.displayName ?? selectedSpaceId)
    : '';

  const filteredSpaces = useMemo(() => {
    const q = (searchQuery || '').trim().toLowerCase();
    const visibleByTab = spaces.filter((space) => {
      const id = spaceIdFromName(space.name);
      const isHidden = hiddenSpaceIds.includes(id);
      return spaceListTab === 'hidden' ? isHidden : !isHidden;
    });
    const filtered = !q ? visibleByTab : visibleByTab.filter((space) => {
      const id = spaceIdFromName(space.name);
      const name = customSpaceNames[id] ?? spaceDisplayNames[id] ?? space.displayName ?? id;
      return (name || '').toLowerCase().includes(q);
    });
    const order = new Map(filtered.map((space, index) => [spaceIdFromName(space.name), index]));
    return [...filtered].sort((a, b) => {
      const aId = spaceIdFromName(a.name);
      const bId = spaceIdFromName(b.name);
      const aFav = favoriteSpaceIds.includes(aId);
      const bFav = favoriteSpaceIds.includes(bId);
      if (aFav !== bFav) return aFav ? -1 : 1;
      return (order.get(aId) ?? 0) - (order.get(bId) ?? 0);
    });
  }, [spaces, searchQuery, spaceDisplayNames, customSpaceNames, favoriteSpaceIds, hiddenSpaceIds, spaceListTab]);

  const saveCustomSpaceName = () => {
    if (!selectedSpaceId) return;
    const v = editingSpaceNameValue.trim();
    setCustomSpaceNames((prev) => (v ? { ...prev, [selectedSpaceId]: v } : (() => { const next = { ...prev }; delete next[selectedSpaceId]; return next; })()));
    setEditingSpaceName(false);
    setEditingSpaceNameValue('');
  };

  const toggleFavoriteSpace = (spaceId) => {
    if (!spaceId) return;
    setFavoriteSpaceIds((prev) => (
      prev.includes(spaceId)
        ? prev.filter((id) => id !== spaceId)
        : [spaceId, ...prev]
    ));
  };

  const toggleHiddenSpace = (spaceId) => {
    if (!spaceId) return;
    const willHide = !hiddenSpaceIds.includes(spaceId);
    setHiddenSpaceIds((prev) => (
      prev.includes(spaceId)
        ? prev.filter((id) => id !== spaceId)
        : [spaceId, ...prev]
    ));
    if (willHide && selectedSpaceId === spaceId && spaceListTab !== 'hidden') {
      setSelectedSpaceId(null);
      setMessages([]);
    }
  };

  const openContactModal = (chatResourceName) => {
    const saved = savedContacts[chatResourceName];
    const initial = {
      chatResourceName,
      displayName: saved?.displayName || '',
      email: saved?.email || '',
      phone: saved?.phone || '',
      memo: saved?.memo || ''
    };
    setContactModal(initial);
    if (saved) return;
    fetch(
      `${API_BASE}/google-chat/profile?resourceName=${encodeURIComponent(chatResourceName)}`,
      { headers: getAuthHeader(), credentials: 'include' }
    )
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!data) return;
        setContactModal((prev) => ({
          ...prev,
          displayName: prev.displayName || data.displayName || '',
          email: prev.email || data.email || '',
          phone: prev.phone || data.phone || ''
        }));
      })
      .catch(() => {});
  };

  const handleSaveContact = async (e, payload) => {
    e?.preventDefault?.();
    const data = payload ?? contactModal;
    if (!data?.chatResourceName || !data.displayName?.trim() || contactSaving) return;
    setContactSaving(true);
    setError('');
    const displayName = data.displayName.trim();
    const email = data.email?.trim() || '';
    const phone = data.phone?.trim() || '';
    const memo = data.memo?.trim() || '';
    const headers = { ...getAuthHeader(), 'Content-Type': 'application/json' };
    try {
      const res = await fetch(`${API_BASE}/google-chat/my-contacts`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          chatResourceName: data.chatResourceName,
          displayName,
          email,
          phone,
          memo
        })
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || '저장 실패');
      }
      const resData = await res.json();
      const c = resData.contact;
      setSavedContacts((prev) => ({ ...prev, [c.chatResourceName]: c }));
      setResolvedUserNames((prev) => ({ ...prev, [c.chatResourceName]: c.displayName }));
      setContactModal(null);

      // 고객사 직원(연락처 리스트)에 등록
      const empRes = await fetch(`${API_BASE}/customer-company-employees`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          name: displayName,
          email: email || undefined,
          phone: phone || undefined,
          memo: memo || undefined,
          status: 'Lead',
          isIndividual: true
        })
      });
      if (!empRes.ok) {
        const empErr = await empRes.json().catch(() => ({}));
        setError((prev) => (prev ? `${prev} 연락처 리스트 저장 실패: ${empErr.error || ''}` : `채팅 이름 저장됨. 연락처 리스트 저장 실패: ${empErr.error || ''}`.trim()));
      }

      // 구글 주소록에 등록
      if (displayName || email || phone) {
        const gcRes = await fetch(`${API_BASE}/google-contacts/contacts`, {
          method: 'POST',
          headers,
          credentials: 'include',
          body: JSON.stringify({
            contacts: [{ name: displayName || undefined, email: email || undefined, phone: phone || undefined }]
          })
        });
        if (!gcRes.ok) {
          const gcErr = await gcRes.json().catch(() => ({}));
          setError((prev) => (prev ? `${prev} 구글 주소록 실패: ${gcErr.error || ''}` : `채팅 이름 저장됨. 구글 주소록 저장 실패: ${gcErr.error || ''}`.trim()));
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setContactSaving(false);
    }
  };

  const isUnresolvedSender = (senderName, displayedName) => {
    if (!senderName || displayedName === '나') return false;
    return !resolvedUserNames[senderName] && (/^사용자 \d+/.test(displayedName) || displayedName === '알 수 없음');
  };

  /** 선택한 대화상대로 채팅방 생성 후 해당 방 열기 */
  const handleStartChat = async (selectedList) => {
    if (!selectedList?.length || newChatCreating) return;
    setNewChatCreating(true);
    setError('');
    const displayName =
      selectedList.length === 1
        ? (selectedList[0].name || selectedList[0].email || '1:1 채팅').trim()
        : '그룹 채팅';
    try {
      const createRes = await fetch(`${API_BASE}/google-chat/spaces`, {
        method: 'POST',
        headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ displayName })
      });
      const spaceData = await createRes.json().catch(() => ({}));
      if (!createRes.ok) throw new Error(spaceData.error || '채팅방 생성 실패');
      const newSpaceId = spaceIdFromName(spaceData.name);
      for (const person of selectedList) {
        const email = (person.email || '').trim();
        if (!email) continue;
        const addRes = await fetch(
          `${API_BASE}/google-chat/spaces/${encodeURIComponent(newSpaceId)}/members`,
          {
            method: 'POST',
            headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ email })
          }
        );
        if (!addRes.ok) {
          const addData = await addRes.json().catch(() => ({}));
          throw new Error(addData.error || `${email} 초대 실패`);
        }
      }
      setNewChatModalOpen(false);
      await fetchSpaces();
      setSelectedSpaceId(newSpaceId);
    } catch (err) {
      setError(err.message || '채팅을 시작할 수 없습니다.');
    } finally {
      setNewChatCreating(false);
    }
  };

  return (
    <div className="google-chat-page">
      {error && (
        <div className="google-chat-error">
          <span className="material-symbols-outlined">error</span>
          {error}
        </div>
      )}
      {nameResolveHint && (
        <div className="google-chat-hint">
          <span className="material-symbols-outlined">info</span>
          {nameResolveHint}
        </div>
      )}

      <div className="google-chat-body">
        <aside className="google-chat-spaces">
          <div className="google-chat-spaces-header">
            <h2 className="google-chat-spaces-title">Internal Chat</h2>
            <button
              type="button"
              className="google-chat-new-chat-btn"
              aria-label="새 채팅"
              onClick={() => setNewChatModalOpen(true)}
            >
              <span className="material-symbols-outlined">add</span>
              New Chat
            </button>
            <input
              type="text"
              className="google-chat-search-input"
              placeholder={spaceListTab === 'hidden' ? '숨긴 채팅방 검색' : '채팅방 검색'}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="채팅방 검색"
            />
            <div className="google-chat-space-tabs" role="tablist" aria-label="대화 목록 탭">
              <button
                type="button"
                className={`google-chat-space-tab ${spaceListTab === 'all' ? 'is-active' : ''}`}
                onClick={() => setSpaceListTab('all')}
                role="tab"
                aria-selected={spaceListTab === 'all'}
              >
                전체
              </button>
              <button
                type="button"
                className={`google-chat-space-tab ${spaceListTab === 'hidden' ? 'is-active' : ''}`}
                onClick={() => setSpaceListTab('hidden')}
                role="tab"
                aria-selected={spaceListTab === 'hidden'}
              >
                숨김
              </button>
            </div>
          </div>
          <div className="google-chat-space-list-wrap">
            {loading ? (
              <p className="google-chat-loading">불러오는 중...</p>
            ) : filteredSpaces.length === 0 ? (
              <p className="google-chat-empty">
                {spaces.length === 0
                  ? '참여 중인 스페이스가 없습니다.'
                  : spaceListTab === 'hidden'
                    ? '숨긴 채팅방이 없습니다.'
                    : '검색 결과가 없습니다.'}
              </p>
            ) : (
              <ul className="google-chat-space-list">
                {filteredSpaces.map((space) => {
                  const id = spaceIdFromName(space.name);
                  const displayName = customSpaceNames[id] ?? spaceDisplayNames[id] ?? space.displayName ?? space.name ?? id;
                  const isSelected = selectedSpaceId === id;
                  const isFavorite = favoriteSpaceIds.includes(id);
                  const isHidden = hiddenSpaceIds.includes(id);
                  const spaceType = space.spaceType || space.type;
                  const isGroup = spaceType !== 'DIRECT_MESSAGE' && spaceType !== 'DM';
                  return (
                    <li key={id}>
                      <div className={`google-chat-space-item-shell ${isSelected ? 'selected' : ''}`}>
                        <button
                          type="button"
                          className={`google-chat-space-item ${isSelected ? 'selected' : ''}`}
                          onClick={() => setSelectedSpaceId(id)}
                        >
                          <div className={`google-chat-space-avatar ${isGroup ? 'groups' : ''}`}>
                            <span className="material-symbols-outlined">
                              {isGroup ? 'groups' : 'person'}
                            </span>
                          </div>
                          <div className="google-chat-space-item-content">
                            <div className="google-chat-space-item-row">
                              <span className="google-chat-space-name">{displayName}</span>
                              <span className="google-chat-space-time">
                                {isSelected && messages.length ? (
                                  new Date(messages[messages.length - 1]?.createTime).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
                                ) : (
                                  ''
                                )}
                              </span>
                            </div>
                            <p className="google-chat-space-preview">
                              {isSelected && messages.length
                                ? (messages[messages.length - 1]?.text || '').slice(0, 40) + (messages[messages.length - 1]?.text?.length > 40 ? '…' : '')
                                : '대화'}
                            </p>
                          </div>
                        </button>
                        <div className="google-chat-space-item-actions">
                          <button
                            type="button"
                            className={`google-chat-space-favorite-btn ${isFavorite ? 'is-active' : ''}`}
                            onClick={() => toggleFavoriteSpace(id)}
                            aria-label={isFavorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}
                            title={isFavorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}
                          >
                            <span className="material-symbols-outlined">star</span>
                          </button>
                          <button
                            type="button"
                            className={`google-chat-space-visibility-btn ${isHidden ? 'is-active' : ''}`}
                            onClick={() => toggleHiddenSpace(id)}
                            aria-label={isHidden ? '숨기기 해제' : '대화 숨기기'}
                            title={isHidden ? '숨기기 해제' : '대화 숨기기'}
                          >
                            <span className="material-symbols-outlined">{isHidden ? 'visibility' : 'visibility_off'}</span>
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        <main className="google-chat-main">
          {!selectedSpaceId ? (
            <div className="google-chat-placeholder">
              <span className="material-symbols-outlined">chat_bubble_outline</span>
              <p>스페이스를 선택하면 대화가 표시됩니다.</p>
            </div>
          ) : (
            <>
              <header className="google-chat-main-header">
                <div className="google-chat-main-header-left">
                  <div className="google-chat-main-header-avatar">
                    <span className="material-symbols-outlined">
                      {selectedSpace && (selectedSpace.spaceType || selectedSpace.type) !== 'DIRECT_MESSAGE' && (selectedSpace.spaceType || selectedSpace.type) !== 'DM'
                        ? 'groups'
                        : 'person'}
                    </span>
                  </div>
                  <div className="google-chat-main-header-title-wrap">
                    {editingSpaceName ? (
                      <input
                        type="text"
                        className="google-chat-main-title-edit"
                        value={editingSpaceNameValue}
                        onChange={(e) => setEditingSpaceNameValue(e.target.value)}
                        onBlur={saveCustomSpaceName}
                        onKeyDown={(e) => { if (e.key === 'Enter') saveCustomSpaceName(); if (e.key === 'Escape') { setEditingSpaceName(false); setEditingSpaceNameValue(''); } }}
                        autoFocus
                        placeholder="채팅방 이름"
                      />
                    ) : (
                      <>
                        <h2 className="google-chat-main-title">{selectedDisplayName}</h2>
                        <button
                          type="button"
                          className="google-chat-header-rename-btn"
                          onClick={() => { setEditingSpaceNameValue(selectedDisplayName); setEditingSpaceName(true); }}
                          aria-label="이름 변경"
                          title="이름 변경 (본인 화면에서만)"
                        >
                          <span className="material-symbols-outlined">edit</span>
                        </button>
                      </>
                    )}
                    <p className="google-chat-main-subtitle">Google Chat</p>
                  </div>
                </div>
                <div className="google-chat-main-header-actions">
                  {selectedSpace && (
                    <button
                      type="button"
                      className={`google-chat-header-action-btn ${hiddenSpaceIds.includes(selectedSpaceId) ? 'is-active' : ''}`}
                      onClick={() => toggleHiddenSpace(selectedSpaceId)}
                      aria-label={hiddenSpaceIds.includes(selectedSpaceId) ? '숨기기 해제' : '대화 숨기기'}
                      title={hiddenSpaceIds.includes(selectedSpaceId) ? '숨기기 해제' : '대화 숨기기'}
                    >
                      <span className="material-symbols-outlined">
                        {hiddenSpaceIds.includes(selectedSpaceId) ? 'visibility' : 'visibility_off'}
                      </span>
                    </button>
                  )}
                  {selectedSpace && (selectedSpace.spaceType || selectedSpace.type) !== 'DIRECT_MESSAGE' && (selectedSpace.spaceType || selectedSpace.type) !== 'DM' && (
                    <button
                      type="button"
                      className="google-chat-header-action-btn"
                      onClick={() => setAddMemberModalOpen(true)}
                      aria-label="대화상대 추가"
                      title="대화상대 추가"
                    >
                      <span className="material-symbols-outlined">person_add</span>
                    </button>
                  )}
                </div>
              </header>
              <div ref={messagesWrapRef} className="google-chat-messages-wrap">
                {messagesLoading ? (
                  <p className="google-chat-loading">메시지 불러오는 중...</p>
                ) : (
                  <>
                    {messages.length > 0 && (
                      <div className="google-chat-date-pill">
                        <span>
                          {new Date(messages[0]?.createTime).toLocaleDateString('ko-KR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) ===
                          new Date().toLocaleDateString('ko-KR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
                            ? 'Today'
                            : new Date(messages[0]?.createTime).toLocaleDateString('ko-KR')}
                        </span>
                      </div>
                    )}
                    <ul className="google-chat-messages">
                      {messages.map((msg) => {
                        const isMine = msg.sender?.name && msg.sender.name === mySenderName;
                        const senderDisplay = isMine ? '나' : (resolvedUserNames[msg.sender?.name] || msg.sender?.displayName || memberNameToLabel(msg.sender?.name) || '알 수 없음');
                        const showRegisterBtn = !isMine && msg.sender?.name && isUnresolvedSender(msg.sender.name, senderDisplay);
                        const hasSavedContact = !isMine && msg.sender?.name && savedContacts[msg.sender.name];
                        const timeStr = msg.createTime
                          ? new Date(msg.createTime).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
                          : '';
                        return (
                          <li
                            key={msg.name || msg.createTime}
                            className={`google-chat-message ${isMine ? 'google-chat-message-mine' : ''}`}
                          >
                            {!isMine && (
                              <div className="google-chat-message-avatar">
                                <span className="material-symbols-outlined">person</span>
                              </div>
                            )}
                            <div className="google-chat-message-body">
                              {!isMine && (
                                <div className="google-chat-message-sender-row">
                                  <span className="google-chat-message-sender">{senderDisplay}</span>
                                  {showRegisterBtn && (
                                    <button
                                      type="button"
                                      className="google-chat-register-name-btn"
                                      onClick={() => openContactModal(msg.sender.name)}
                                      title="이름·연락처 등록"
                                    >
                                      <span className="material-symbols-outlined">person_add</span>
                                      이름 등록
                                    </button>
                                  )}
                                  {hasSavedContact && (
                                    <button
                                      type="button"
                                      className="google-chat-register-name-btn google-chat-edit-contact-btn"
                                      onClick={() => openContactModal(msg.sender.name)}
                                      title="연락처 수정"
                                    >
                                      <span className="material-symbols-outlined">edit</span>
                                      수정
                                    </button>
                                  )}
                                </div>
                              )}
                              <div className="google-chat-message-bubble">
                                <p className="google-chat-message-text">{msg.text || '(메시지 없음)'}</p>
                              </div>
                              {isMine ? (
                                <div className="google-chat-message-time-wrap">
                                  <span className="google-chat-message-time">{timeStr}</span>
                                  <span className="material-symbols-outlined google-chat-message-done">done_all</span>
                                </div>
                              ) : (
                                <span className="google-chat-message-time">{timeStr}</span>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                    {messages.length === 0 && !messagesLoading && (
                      <p className="google-chat-messages-empty">메시지가 없습니다.</p>
                    )}
                  </>
                )}
              </div>
              <form onSubmit={handleSend} className="google-chat-send-form">
                <div className="google-chat-send-inner">
                  <div className="google-chat-send-actions-left">
                    <button type="button" aria-label="추가">
                      <span className="material-symbols-outlined">add_circle</span>
                    </button>
                    <button type="button" aria-label="이미지">
                      <span className="material-symbols-outlined">image</span>
                    </button>
                    <button type="button" aria-label="첨부">
                      <span className="material-symbols-outlined">attach_file</span>
                    </button>
                  </div>
                  <div className="google-chat-send-input-wrap">
                    <textarea
                      className="google-chat-send-input"
                      placeholder="Type your message here..."
                      rows={1}
                      value={sendText}
                      onChange={(e) => setSendText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          if (sendText?.trim()) handleSend(e);
                        }
                      }}
                      disabled={sending}
                    />
                  </div>
                  <div className="google-chat-send-actions-right">
                    <button type="button" aria-label="이모지">
                      <span className="material-symbols-outlined">sentiment_satisfied</span>
                    </button>
                    <button
                      type="submit"
                      className="google-chat-send-submit"
                      disabled={sending || !sendText?.trim()}
                      aria-label="전송"
                    >
                      <span className="material-symbols-outlined">send</span>
                    </button>
                  </div>
                </div>
                <p className="google-chat-send-hint">Enter로 전송, Shift+Enter로 줄 바꿈</p>
              </form>
            </>
          )}
        </main>
      </div>

      <NewChatModal
        open={newChatModalOpen}
        onClose={() => setNewChatModalOpen(false)}
        onStartChat={handleStartChat}
        creating={newChatCreating}
        onError={setError}
      />

      <AddMemberModal
        open={addMemberModalOpen}
        onClose={() => setAddMemberModalOpen(false)}
        spaceId={selectedSpaceId}
        mode="addToSpace"
        myResourceName={mySenderName}
        onError={setError}
      />

      <ContactRegisterModal
        data={contactModal}
        onClose={() => setContactModal(null)}
        onSave={handleSaveContact}
        saving={contactSaving}
      />
    </div>
  );
}
