import { useState, useEffect } from 'react';
import { API_BASE } from '@/config';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function memberDisplayLabel(m, resolvedNames, myResourceName) {
  const user = m?.member;
  if (!user) return m?.groupMember?.name ? `그룹: ${m.groupMember.name}` : '알 수 없음';
  const rn = user.name;
  if (myResourceName && rn === myResourceName) return '나';
  if (resolvedNames && rn && resolvedNames[rn]) return resolvedNames[rn];
  if (user.displayName) return user.displayName;
  const part = (rn || '').split('/').pop() || '';
  if (part.includes('@')) return part;
  if (/^\d+$/.test(part)) return `사용자 ${part}`;
  return part || rn || '알 수 없음';
}

/**
 * 대화상대 추가 모달
 * - addToSpace: 기존 스페이스에 초대 (spaceId 필수)
 * - selectFor1to1: 1:1 채팅 상대 선택 → 구글 주소록 / 사내 검색 / 직접 입력 후 onSelectFor1to1 호출
 */
export default function AddMemberModal({
  open,
  onClose,
  spaceId,
  mode = 'addToSpace',
  myResourceName,
  onError,
  onAdded,
  onSelectFor1to1
}) {
  const [members, setMembers] = useState([]);
  const [resolvedNames, setResolvedNames] = useState({});
  const [membersLoading, setMembersLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [adding, setAdding] = useState(false);
  const [inviteSuccessMessage, setInviteSuccessMessage] = useState('');

  // 1:1 모드: 구글 주소록
  const [googleQuery, setGoogleQuery] = useState('');
  const [googleContacts, setGoogleContacts] = useState([]);
  const [googleLoading, setGoogleLoading] = useState(false);
  // 1:1 모드: 사내 검색
  const [companyQuery, setCompanyQuery] = useState('');
  const [companyMembers, setCompanyMembers] = useState([]);
  const [companyLoading, setCompanyLoading] = useState(false);
  // 1:1 모드: 직접 입력
  const [directEmail, setDirectEmail] = useState('');
  const [directName, setDirectName] = useState('');
  const [directPhone, setDirectPhone] = useState('');
  const [directCompany, setDirectCompany] = useState('');
  const [directSubmitting, setDirectSubmitting] = useState(false);

  const is1to1 = mode === 'selectFor1to1';

  useEffect(() => {
    if (!open || !spaceId || is1to1) return;
    setInviteSuccessMessage('');
    setMembers([]);
    setResolvedNames({});
    setMembersLoading(true);
    fetch(`${API_BASE}/google-chat/spaces/${encodeURIComponent(spaceId)}/members?pageSize=100`, {
      headers: getAuthHeader(),
      credentials: 'include'
    })
      .then((r) => (r.ok ? r.json() : null))
      .then(async (data) => {
        const list = data?.memberships || [];
        setMembers(list);
        const resourceNames = list.map((m) => m.member?.name).filter(Boolean);
        if (resourceNames.length === 0) return;
        try {
          const res = await fetch(`${API_BASE}/google-chat/resolve-user-names`, {
            method: 'POST',
            headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ resourceNames })
          });
          const resolved = await res.json().catch(() => ({}));
          if (res.ok && resolved && typeof resolved === 'object') {
            const map = {};
            Object.keys(resolved).forEach((k) => { if (k && resolved[k]) map[k] = resolved[k]; });
            setResolvedNames(map);
          }
        } catch (_) {}
      })
      .catch(() => setMembers([]))
      .finally(() => setMembersLoading(false));
  }, [open, spaceId, is1to1]);

  useEffect(() => {
    if (!open && is1to1) {
      setGoogleQuery('');
      setGoogleContacts([]);
      setCompanyQuery('');
      setCompanyMembers([]);
      setDirectEmail('');
      setDirectName('');
      setDirectPhone('');
      setDirectCompany('');
    }
  }, [open, is1to1]);

  const searchGoogleContacts = async () => {
    const q = googleQuery.trim();
    if (!q) {
      setGoogleContacts([]);
      return;
    }
    setGoogleLoading(true);
    if (onError) onError('');
    try {
      const res = await fetch(
        `${API_BASE}/google-contacts/contacts?query=${encodeURIComponent(q)}&pageSize=30`,
        { headers: getAuthHeader(), credentials: 'include' }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '구글 주소록 검색 실패');
      setGoogleContacts(data.contacts || []);
    } catch (err) {
      if (onError) onError(err.message);
      setGoogleContacts([]);
    } finally {
      setGoogleLoading(false);
    }
  };

  const searchCompanyMembers = async () => {
    setCompanyLoading(true);
    if (onError) onError('');
    try {
      const res = await fetch(
        `${API_BASE}/auth/company-members?search=${encodeURIComponent(companyQuery.trim())}&pageSize=50`,
        { headers: getAuthHeader(), credentials: 'include' }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '사내 검색 실패');
      setCompanyMembers(data.members || []);
    } catch (err) {
      if (onError) onError(err.message);
      setCompanyMembers([]);
    } finally {
      setCompanyLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const value = email.trim();
    if (!value || !spaceId || adding) return;
    setAdding(true);
    if (onError) onError('');
    try {
      const res = await fetch(`${API_BASE}/google-chat/spaces/${encodeURIComponent(spaceId)}/members`, {
        method: 'POST',
        headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: value })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '대화상대 추가 실패');
      setEmail('');
      setInviteSuccessMessage(`"${value}"에게 초대를 보냈습니다. 상대방이 Google Chat에서 초대를 수락하면 채팅방이 표시됩니다.`);
      setMembers((prev) => {
        const added = { member: { name: `users/${value}`, displayName: value }, state: 'INVITED' };
        return prev.some((m) => (m.member?.name || '').toLowerCase() === `users/${value}`.toLowerCase()) ? prev : [...prev, added];
      });
      onAdded?.();
    } catch (err) {
      if (onError) onError(err.message || '대화상대를 추가할 수 없습니다.');
    } finally {
      setAdding(false);
    }
  };

  const handleSelectFor1to1 = (payload) => {
    if (onSelectFor1to1) onSelectFor1to1(payload);
    onClose();
  };

  const handleDirectSubmit = (e) => {
    e.preventDefault();
    const em = directEmail.trim();
    if (!em || directSubmitting) return;
    if (onError) onError('');
    setDirectSubmitting(true);
    handleSelectFor1to1({
      email: em,
      name: directName.trim(),
      phone: directPhone.trim(),
      company: directCompany.trim()
    });
    setDirectSubmitting(false);
  };

  if (!open) return null;

  if (is1to1) {
    return (
      <div className="google-chat-modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
        <div className="google-chat-modal add-member-modal add-member-modal-1to1" onClick={(e) => e.stopPropagation()}>
          <div className="google-chat-modal-header">
            <h3>1:1 채팅 상대 선택</h3>
            <button type="button" className="google-chat-modal-close" onClick={onClose} aria-label="닫기">
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
          <div className="add-member-1to1-tabs">
            <div className="add-member-1to1-section">
              <h4 className="add-member-1to1-section-title">
                <span className="material-symbols-outlined">contacts</span>
                구글 주소록 검색
              </h4>
              <div className="add-member-1to1-search-row">
                <input
                  type="text"
                  className="add-member-1to1-input"
                  placeholder="이름 또는 이메일로 검색"
                  value={googleQuery}
                  onChange={(e) => setGoogleQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), searchGoogleContacts())}
                />
                <button type="button" className="google-chat-btn-secondary" onClick={searchGoogleContacts} disabled={googleLoading}>
                  {googleLoading ? '검색 중…' : '검색'}
                </button>
              </div>
              <div className="add-member-1to1-list-wrap">
                {googleContacts.length === 0 && !googleLoading ? (
                  <p className="add-member-empty">검색어를 입력하고 검색 버튼을 누르세요.</p>
                ) : (
                  <ul className="add-member-1to1-list">
                    {googleContacts.map((c, i) => (
                      <li key={c.resourceName || c.email || i} className="add-member-1to1-item">
                        <button
                          type="button"
                          className="add-member-1to1-item-btn"
                          onClick={() => handleSelectFor1to1({
                            email: c.email || '',
                            name: c.name || '',
                            phone: c.phone || '',
                            company: c.company || ''
                          })}
                          disabled={!c.email}
                        >
                          <span className="material-symbols-outlined">person</span>
                          <span className="add-member-1to1-item-name">{c.name || c.email || '-'}</span>
                          {c.email && <span className="add-member-1to1-item-email">{c.email}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="add-member-1to1-section">
              <h4 className="add-member-1to1-section-title">
                <span className="material-symbols-outlined">business</span>
                사내 검색
              </h4>
              <div className="add-member-1to1-search-row">
                <input
                  type="text"
                  className="add-member-1to1-input"
                  placeholder="이름 또는 이메일로 검색"
                  value={companyQuery}
                  onChange={(e) => setCompanyQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), searchCompanyMembers())}
                />
                <button type="button" className="google-chat-btn-secondary" onClick={searchCompanyMembers} disabled={companyLoading}>
                  {companyLoading ? '검색 중…' : '검색'}
                </button>
              </div>
              <div className="add-member-1to1-list-wrap">
                {companyMembers.length === 0 && !companyLoading ? (
                  <p className="add-member-empty">검색어 입력 후 검색 버튼을 누르세요.</p>
                ) : (
                  <ul className="add-member-1to1-list">
                    {companyMembers.map((m) => (
                      <li key={m.id || m.email} className="add-member-1to1-item">
                        <button
                          type="button"
                          className="add-member-1to1-item-btn"
                          onClick={() => handleSelectFor1to1({
                            email: m.email || '',
                            name: m.name || '',
                            phone: m.phone || '',
                            company: m.companyName || ''
                          })}
                          disabled={!m.email}
                        >
                          <span className="material-symbols-outlined">person</span>
                          <span className="add-member-1to1-item-name">{m.name || m.email || '-'}</span>
                          {m.email && <span className="add-member-1to1-item-email">{m.email}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="add-member-1to1-section">
              <h4 className="add-member-1to1-section-title">
                <span className="material-symbols-outlined">edit</span>
                직접 입력 (구글/사내에 없는 경우)
              </h4>
              <form onSubmit={handleDirectSubmit} className="add-member-1to1-direct-form">
                <div className="google-chat-modal-field">
                  <label htmlFor="direct-email">이메일 주소 *</label>
                  <input
                    id="direct-email"
                    type="email"
                    value={directEmail}
                    onChange={(e) => setDirectEmail(e.target.value)}
                    placeholder="example@company.com"
                    required
                  />
                </div>
                <div className="google-chat-modal-field">
                  <label htmlFor="direct-name">이름</label>
                  <input
                    id="direct-name"
                    type="text"
                    value={directName}
                    onChange={(e) => setDirectName(e.target.value)}
                    placeholder="이름"
                  />
                </div>
                <div className="google-chat-modal-field">
                  <label htmlFor="direct-phone">연락처</label>
                  <input
                    id="direct-phone"
                    type="text"
                    value={directPhone}
                    onChange={(e) => setDirectPhone(e.target.value)}
                    placeholder="010-0000-0000"
                  />
                </div>
                <div className="google-chat-modal-field">
                  <label htmlFor="direct-company">회사명</label>
                  <input
                    id="direct-company"
                    type="text"
                    value={directCompany}
                    onChange={(e) => setDirectCompany(e.target.value)}
                    placeholder="회사명"
                  />
                </div>
                <div className="google-chat-modal-actions">
                  <button type="button" className="google-chat-btn-cancel" onClick={onClose}>
                    취소
                  </button>
                  <button type="submit" className="google-chat-send-btn" disabled={directSubmitting || !directEmail.trim()}>
                    {directSubmitting ? '열기 중…' : '등록하고 채팅 열기'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="google-chat-modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="google-chat-modal add-member-modal" onClick={(e) => e.stopPropagation()}>
        <div className="google-chat-modal-header">
          <h3>대화상대 추가</h3>
          <button type="button" className="google-chat-modal-close" onClick={onClose} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="google-chat-modal-form">
          <div className="google-chat-modal-field">
            <label className="add-member-label">참여자 명단</label>
            <div className="add-member-list-wrap">
              {membersLoading ? (
                <p className="google-chat-loading">불러오는 중...</p>
              ) : members.length === 0 ? (
                <p className="add-member-empty">참여자가 없습니다.</p>
              ) : (
                <ul className="add-member-list">
                  {members.map((m, i) => (
                    <li key={m.name || m.member?.name || `m-${i}`} className="add-member-item">
                      <span className="material-symbols-outlined add-member-item-icon">person</span>
                      <span className="add-member-item-name">{memberDisplayLabel(m, resolvedNames, myResourceName)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          {inviteSuccessMessage && (
            <p className="add-member-invite-success" role="status">
              {inviteSuccessMessage}
            </p>
          )}
          <p className="add-member-hint">
            상대방은 Google Chat(채팅) 앱 또는 chat.google.com에서 초대를 수락해야 채팅방이 보입니다.
          </p>
          <form onSubmit={handleSubmit} className="google-chat-modal-field">
            <label htmlFor="add-member-email">초대할 사용자 이메일 *</label>
            <input
              id="add-member-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="예: colleague@company.com"
              required
            />
            <div className="google-chat-modal-actions">
              <button type="button" className="google-chat-btn-cancel" onClick={onClose}>
                취소
              </button>
              <button type="submit" className="google-chat-send-btn" disabled={adding || !email.trim()}>
                {adding ? '추가 중…' : '초대'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
