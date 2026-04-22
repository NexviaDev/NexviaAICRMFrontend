import { useState, useEffect, useCallback, useMemo } from 'react';
import EmailComposeModal, { buildReplyEmailSubject, buildForwardEmailSubject } from './email-compose-modal.jsx';
import './email.css';
import PageHeaderNotifyChat from '@/components/page-header-notify-chat/page-header-notify-chat';

import { API_BASE } from '@/config';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** "Name <email@x.com>" → { name, email } */
function parseFromHeader(from) {
  if (!from || typeof from !== 'string') return { name: '', email: '' };
  const match = from.match(/^(.+?)\s*<([^>]+)>$/);
  if (match) return { name: match[1].trim(), email: match[2].trim() };
  if (from.includes('@')) return { name: '', email: from.trim() };
  return { name: from.trim(), email: '' };
}

/** 목록 아바타용 이니셜 (최대 2글자) */
function getSenderInitials(displayName) {
  const s = (displayName || '?').trim();
  if (!s) return '?';
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const a = (parts[0][0] || '') + (parts[1][0] || '');
    return a.toUpperCase().slice(0, 2);
  }
  return s.slice(0, 2).toUpperCase();
}

/** 모바일 날짜 구간 헤더 (오늘 / 어제 / 이전) */
function getDateBucket(dateStr) {
  const d = dateStr ? new Date(dateStr) : null;
  if (!d || Number.isNaN(d.getTime())) return 'older';
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startMsg = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((startToday - startMsg) / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  return 'older';
}

const DATE_BUCKET_LABELS = { today: '오늘', yesterday: '어제', older: '이전' };

function avatarVariantFromId(id) {
  if (!id || typeof id !== 'string') return 0;
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h + id.charCodeAt(i)) % 3;
  return h;
}

function buildEmailListSections(items) {
  if (!items?.length) return [];
  const out = [];
  let last = null;
  for (const mail of items) {
    const bucket = getDateBucket(mail.date);
    if (bucket !== last) {
      out.push({ type: 'header', key: `hdr-${bucket}-${mail.id}`, label: DATE_BUCKET_LABELS[bucket] });
      last = bucket;
    }
    out.push({ type: 'row', key: mail.id, mail });
  }
  return out;
}

/** 보낸/받은 메일 본문에서 링크를 박스·버튼 형태로 보여주는 스타일 */
const EMAIL_VIEW_LINK_STYLES = `
  a.email-compose-drive-link-inline,
  a[target="_blank"] {
    display: inline-block;
    padding: 10px 14px;
    margin: 6px 4px 6px 0;
    border: 1px solid #94a3b8;
    border-radius: 8px;
    background: #f1f5f9;
    color: #2563eb;
    text-decoration: none;
    font-weight: 500;
    word-break: break-all;
  }
  a.email-compose-drive-link-inline:hover,
  a[target="_blank"]:hover {
    background: #e2e8f0;
    text-decoration: underline;
  }
`;

/** HTML 메일 본문을 sandbox iframe으로 렌더링 (스크립트 비실행, 링크는 박스/버튼 스타일) */
function EmailHtmlFrame({ html }) {
  const blobUrl = useMemo(() => {
    if (!html) return null;
    const doc = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${EMAIL_VIEW_LINK_STYLES}</style></head><body>${html}</body></html>`;
    const blob = new Blob([doc], { type: 'text/html; charset=utf-8' });
    return URL.createObjectURL(blob);
  }, [html]);
  useEffect(() => {
    return () => { if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [blobUrl]);
  if (!blobUrl) return null;
  return (
    <iframe
      src={blobUrl}
      title="메일 본문"
      className="email-detail-body-iframe"
      sandbox="allow-same-origin allow-popups"
    />
  );
}

export default function Email() {
  const [listItems, setListItems] = useState([]);
  const [nextPageToken, setNextPageToken] = useState(null);
  const [pageTokenUsed, setPageTokenUsed] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [sendLoading, setSendLoading] = useState(false);
  const [error, setError] = useState('');
  const [needsReauth, setNeedsReauth] = useState(false);
  /** OAuth에서 gmail.readonly / gmail.modify 제거 시 API 대신 웹 Gmail 안내 */
  const [gmailWebOnly, setGmailWebOnly] = useState(false);
  const [gmailLabels, setGmailLabels] = useState([]);
  const [showLabelPicker, setShowLabelPicker] = useState(false);
  const [labelPickerLoading, setLabelPickerLoading] = useState(false);
  const [selectedLabelId, setSelectedLabelId] = useState(null);
  /** null | 'new' | 'reply' | 'forward' — 상세 패널에서 작성 모달 */
  const [detailCompose, setDetailCompose] = useState(null);

  const fetchList = useCallback(async (pageToken = '') => {
    setLoading(true);
    setError('');
    setNeedsReauth(false);
    try {
      const params = new URLSearchParams();
      if (selectedLabelId) params.set('labelId', selectedLabelId);
      else params.set('folder', 'inbox');
      params.set('maxResults', '15');
      if (pageToken) params.set('pageToken', pageToken);
      const res = await fetch(`${API_BASE}/gmail/messages?${params}`, { headers: getAuthHeader() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.needsReauth) setNeedsReauth(true);
        setGmailWebOnly(false);
        setError(data.error || '메일 목록을 불러올 수 없습니다.');
        setListItems([]);
        return;
      }
      if (data.gmailWebOnly) {
        setGmailWebOnly(true);
        setListItems([]);
        setNextPageToken(null);
        setPageTokenUsed(null);
        setSelectedId(null);
        setSelectedEmail(null);
        setError('');
        return;
      }
      setGmailWebOnly(false);
      setListItems(data.items || []);
      setNextPageToken(data.nextPageToken || null);
      setPageTokenUsed(pageToken || null);
    } catch (_) {
      setError('서버에 연결할 수 없습니다.');
      setListItems([]);
    } finally {
      setLoading(false);
    }
  }, [selectedLabelId]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  const fetchLabels = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/gmail/labels`, { headers: getAuthHeader() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;
      if (data.gmailWebOnly) {
        setGmailWebOnly(true);
        setGmailLabels([]);
      } else if (Array.isArray(data.labels)) {
        setGmailLabels(data.labels);
      }
    } catch (_) {}
  }, []);

  useEffect(() => {
    fetchLabels();
  }, [fetchLabels]);

  /** 받은편지함 API 없음(gmailWebOnly) — 안내 카드 대신 CRM에서 바로 새 메일 작성만 */
  useEffect(() => {
    if (!gmailWebOnly) return;
    if (detailCompose === 'reply' || detailCompose === 'forward') return;
    if (!detailCompose) setDetailCompose('new');
  }, [gmailWebOnly, detailCompose]);

  useEffect(() => {
    if (!selectedId) {
      setSelectedEmail(null);
      return;
    }
    setDetailLoading(true);
    setError('');
    fetch(`${API_BASE}/gmail/messages/${selectedId}`, { headers: getAuthHeader() })
      .then((r) => r.json().catch(() => ({})))
      .then((data) => {
        if (data.gmailWebOnly) {
          setGmailWebOnly(true);
          setSelectedEmail(null);
          setSelectedId(null);
          return;
        }
        if (data.error) {
          setError(data.error);
          setSelectedEmail(null);
        } else {
          setSelectedEmail(data);
        }
      })
      .catch(() => {
        setError('메일을 불러올 수 없습니다.');
        setSelectedEmail(null);
      })
      .finally(() => setDetailLoading(false));
  }, [selectedId]);

  const handleRefresh = () => {
    fetchList();
    if (selectedId) {
      setDetailLoading(true);
      fetch(`${API_BASE}/gmail/messages/${selectedId}`, { headers: getAuthHeader() })
        .then((r) => r.json().catch(() => ({})))
        .then((data) => {
          if (data.gmailWebOnly) {
            setGmailWebOnly(true);
            setSelectedId(null);
            setSelectedEmail(null);
            return;
          }
          if (!data.error) setSelectedEmail(data);
        })
        .finally(() => setDetailLoading(false));
    }
  };

  const handleTrash = async () => {
    if (!selectedId) return;
    setSendLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/gmail/messages/${selectedId}/trash`, {
        method: 'POST',
        headers: getAuthHeader()
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.needsReauth) setNeedsReauth(true);
        setError(data.error || '휴지통으로 이동하지 못했습니다.');
        return;
      }
      setSelectedId(null);
      setSelectedEmail(null);
      fetchList();
    } catch (_) {
      setError('요청을 처리할 수 없습니다.');
    } finally {
      setSendLoading(false);
    }
  };

  const handleLabelToggle = async (labelId) => {
    if (!selectedId || !selectedEmail) return;
    const current = selectedEmail.labelIds || [];
    const hasLabel = current.includes(labelId);
    const addLabelIds = hasLabel ? [] : [labelId];
    const removeLabelIds = hasLabel ? [labelId] : [];
    setLabelPickerLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/gmail/messages/${selectedId}/modify`, {
        method: 'POST',
        headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ addLabelIds, removeLabelIds })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.needsReauth) setNeedsReauth(true);
        setError(data.error || '라벨을 변경할 수 없습니다.');
        return;
      }
      const nextIds = hasLabel ? current.filter((id) => id !== labelId) : [...current, labelId];
      setSelectedEmail((prev) => (prev ? { ...prev, labelIds: nextIds } : null));
      fetchList();
    } catch (_) {
      setError('라벨 변경에 실패했습니다.');
    } finally {
      setLabelPickerLoading(false);
    }
  };

  const systemLabelNames = {
    INBOX: '받은편지함',
    SENT: '보낸편지함',
    DRAFT: '임시보관',
    TRASH: '휴지통',
    UNREAD: '읽지 않음',
    STARRED: '별표',
    IMPORTANT: '중요',
    SPAM: '스팸',
    CATEGORY_PERSONAL: '개인',
    CATEGORY_SOCIAL: '소셜',
    CATEGORY_PROMOTIONS: '프로모션',
    CATEGORY_UPDATES: '업데이트',
    CATEGORY_FORUMS: '포럼'
  };

  /** 답장 인용용 — 동일 메일에서 리렌더 시 객체 참조만 바뀌어 에디터가 덮어쓰이지 않도록 */
  const replyQuoteSourceMemo = useMemo(() => {
    if (!selectedEmail) return null;
    return {
      from: selectedEmail.from,
      to: selectedEmail.to,
      subject: selectedEmail.subject,
      date: selectedEmail.date,
      bodyPlain: selectedEmail.body,
      bodyHtml: selectedEmail.bodyHtml
    };
  }, [
    selectedEmail?.id,
    selectedEmail?.from,
    selectedEmail?.to,
    selectedEmail?.subject,
    selectedEmail?.date,
    selectedEmail?.body,
    selectedEmail?.bodyHtml
  ]);

  const listSections = useMemo(() => buildEmailListSections(listItems), [listItems]);
  const detailChromeOpen = Boolean(selectedId || detailCompose);

  return (
    <div className={`email-page${detailChromeOpen ? ' email-page--detail-open' : ''}`}>
      <header className="email-header">
        <div className="email-header-actions">
          <button type="button" className="email-header-icon-btn" aria-label="설정">
            <span className="material-symbols-outlined">settings</span>
          </button>
          <PageHeaderNotifyChat buttonClassName="email-header-icon-btn" wrapperClassName="email-header-notify-chat" />
        </div>
      </header>

      {(error || needsReauth) && (
        <div className="email-banner email-banner-error">
          {error}
          {needsReauth && (
            <a href="/login" className="email-banner-reauth">Google 계정으로 다시 로그인</a>
          )}
        </div>
      )}

      <div className={`email-body${gmailWebOnly ? ' email-body--send-only' : ''}`}>
        <aside className="email-sidebar">
          <button type="button" className="email-compose-btn" onClick={() => setDetailCompose('new')}>
            <span className="material-symbols-outlined">edit</span>
            새 메일 작성
          </button>
          {!gmailWebOnly && (
            <>
              {gmailLabels.length > 0 && (
                <nav className="email-labels-nav">
                  <div className="email-labels-title">
                    <span>라벨</span>
                  </div>
                  <div className="email-labels-list">
                    <button
                      type="button"
                      className={`email-label-item ${!selectedLabelId ? 'active' : ''}`}
                      onClick={() => { setSelectedLabelId(null); setSelectedId(null); }}
                    >
                      <span className="email-label-dot" style={{ backgroundColor: 'var(--text-muted)' }} />
                      <span className="email-label-name">받은편지함</span>
                    </button>
                    {gmailLabels
                      .filter((l) => l.type === 'user')
                      .map((l) => (
                        <button
                          key={l.id}
                          type="button"
                          className={`email-label-item ${selectedLabelId === l.id ? 'active' : ''}`}
                          onClick={() => { setSelectedLabelId(l.id); setSelectedId(null); }}
                        >
                          <span className="email-label-dot" style={{ backgroundColor: (l.color && l.color.backgroundColor) ? (String(l.color.backgroundColor).startsWith('#') ? l.color.backgroundColor : `#${l.color.backgroundColor}`) : 'var(--text-muted)' }} />
                          <span className="email-label-name">{l.name}</span>
                        </button>
                      ))}
                  </div>
                </nav>
              )}
            </>
          )}
        </aside>

        <section className="email-list-panel">
          <div className="email-list-header">
            <h2 className="email-list-title">
              {selectedLabelId
                ? (gmailLabels.find((l) => l.id === selectedLabelId)?.name || selectedLabelId)
                : '받은편지함'}
            </h2>
            <div className="email-list-toolbar">
              <button type="button" className="email-list-toolbar-btn" title="새로고침" onClick={handleRefresh} disabled={loading}>
                <span className="material-symbols-outlined">refresh</span>
              </button>
            </div>
          </div>
          <div className="email-list">
            {loading ? (
              <div className="email-list-loading">
                <span className="material-symbols-outlined">progress_activity</span>
                불러오는 중…
              </div>
            ) : listItems.length === 0 ? (
              <div className="email-list-empty">메일이 없습니다.</div>
            ) : (
              <>
                {listSections.map((section, idx) => {
                  if (section.type === 'header') {
                    return (
                      <div key={section.key} className="email-list-date-header">
                        {section.label}
                      </div>
                    );
                  }
                  const mail = section.mail;
                  const fromParsed = parseFromHeader(mail.from);
                  const fromDisplay = fromParsed.name || fromParsed.email || mail.from || '—';
                  const avatarClass = `email-list-item-avatar email-list-item-avatar--${avatarVariantFromId(mail.id)}`;
                  return (
                    <div
                      key={mail.id}
                      role="button"
                      tabIndex={0}
                      className={`email-list-item ${selectedId === mail.id ? 'selected' : ''} ${!mail.isRead ? 'unread' : ''}`}
                      onClick={() => setSelectedId(mail.id)}
                      onKeyDown={(e) => e.key === 'Enter' && setSelectedId(mail.id)}
                    >
                      <div className="email-list-item-inner">
                        <div className={avatarClass} aria-hidden>
                          {getSenderInitials(fromDisplay)}
                        </div>
                        <div className="email-list-item-main">
                          <div className="email-list-item-top">
                            <span className="email-list-item-from">{fromDisplay}</span>
                            <span className={`email-list-item-time ${!mail.isRead ? 'email-list-item-time--unread' : ''}`}>{mail.date}</span>
                          </div>
                          <h3 className="email-list-item-subject">{mail.subject || '(제목 없음)'}</h3>
                          <p className="email-list-item-snippet">{mail.snippet || ''}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div className="email-list-pagination">
                  {pageTokenUsed != null && (
                    <button type="button" className="email-list-pagination-btn" onClick={() => fetchList('')} disabled={loading} aria-label="이전 페이지">
                      ‹
                    </button>
                  )}
                  {nextPageToken && (
                    <button type="button" className="email-list-pagination-btn email-list-pagination-next" onClick={() => fetchList(nextPageToken)} disabled={loading} aria-label="다음 페이지">
                      ›
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </section>

        <section className="email-detail-panel">
          {detailCompose ? (
            <EmailComposeModal
              key={
                detailCompose === 'new'
                  ? 'compose-new'
                  : `${detailCompose}-${selectedEmail?.id ?? 'mail'}`
              }
              inline
              composeMode={
                detailCompose === 'reply' ? 'reply' : detailCompose === 'forward' ? 'forward' : 'new'
              }
              initialTo={
                detailCompose === 'reply' && selectedEmail
                  ? (parseFromHeader(selectedEmail.from).email || selectedEmail.from).trim()
                  : ''
              }
              initialCc={detailCompose === 'reply' && selectedEmail?.cc ? String(selectedEmail.cc) : ''}
              initialSubject={
                detailCompose === 'reply' && selectedEmail
                  ? buildReplyEmailSubject(selectedEmail.subject)
                  : detailCompose === 'forward' && selectedEmail
                    ? buildForwardEmailSubject(selectedEmail.subject)
                    : ''
              }
              replyThreadId={detailCompose === 'reply' && selectedEmail?.threadId ? selectedEmail.threadId : null}
              replyQuoteSource={
                detailCompose === 'reply' || detailCompose === 'forward' ? replyQuoteSourceMemo : null
              }
              replyQuoteMessageId={
                (detailCompose === 'reply' || detailCompose === 'forward') && selectedEmail?.id
                  ? selectedEmail.id
                  : null
              }
              onClose={() => setDetailCompose(null)}
              onSent={() => {
                setDetailCompose(null);
                fetchList();
              }}
            />
          ) : detailLoading && selectedId ? (
            <div className="email-detail-empty">
              <span className="material-symbols-outlined email-detail-empty-icon">progress_activity</span>
              <p>메일 불러오는 중…</p>
            </div>
          ) : selectedEmail ? (
            <>
              <div className="email-detail-toolbar">
                <div className="email-detail-toolbar-left">
                  <button
                    type="button"
                    className="email-detail-back-mobile"
                    onClick={() => setSelectedId(null)}
                    aria-label="목록으로"
                  >
                    <span className="material-symbols-outlined">arrow_back</span>
                  </button>
                  <button type="button" className="email-detail-btn" onClick={() => setDetailCompose('new')}>
                    <span className="material-symbols-outlined">edit</span>
                    새 메일
                  </button>
                  <button type="button" className="email-detail-btn" onClick={() => setDetailCompose('reply')} disabled={!selectedEmail}>
                    <span className="material-symbols-outlined">reply</span>
                    답장
                  </button>
                  <button
                    type="button"
                    className="email-detail-btn"
                    onClick={() => setDetailCompose('forward')}
                    disabled={!selectedEmail}
                  >
                    <span className="material-symbols-outlined">forward</span>
                    전달
                  </button>
                  <button
                    type="button"
                    className="email-detail-btn email-detail-btn-danger"
                    onClick={handleTrash}
                    disabled={sendLoading}
                  >
                    <span className="material-symbols-outlined">delete</span>
                    삭제
                  </button>
                </div>
                <div className="email-detail-toolbar-right">
                  <div className="email-detail-label-wrap">
                    <button
                      type="button"
                      className="email-detail-icon-btn"
                      title="라벨"
                      onClick={() => setShowLabelPicker((v) => !v)}
                      aria-expanded={showLabelPicker}
                    >
                      <span className="material-symbols-outlined">label</span>
                    </button>
                    {showLabelPicker && (
                      <>
                        <div className="email-detail-label-backdrop" onClick={() => setShowLabelPicker(false)} aria-hidden="true" />
                        <div className="email-detail-label-dropdown">
                          <div className="email-detail-label-dropdown-title">라벨 적용</div>
                          {labelPickerLoading && <div className="email-detail-label-loading">처리 중…</div>}
                          <div className="email-detail-label-list">
                            {gmailLabels
                              .filter((l) => !['INBOX', 'SENT', 'DRAFT', 'TRASH', 'UNREAD', 'SPAM'].includes(l.id))
                              .map((l) => {
                                const applied = (selectedEmail.labelIds || []).includes(l.id);
                                const displayName = systemLabelNames[l.id] || l.name;
                                return (
                                  <button
                                    key={l.id}
                                    type="button"
                                    className={`email-detail-label-option ${applied ? 'applied' : ''}`}
                                    onClick={() => handleLabelToggle(l.id)}
                                    disabled={labelPickerLoading}
                                  >
                                    <span className="material-symbols-outlined">{applied ? 'check_box' : 'check_box_outline_blank'}</span>
                                    <span>{displayName}</span>
                                  </button>
                                );
                              })}
                          </div>
                          {gmailLabels.filter((l) => !['INBOX', 'SENT', 'DRAFT', 'TRASH', 'UNREAD', 'SPAM'].includes(l.id)).length === 0 && (
                            <div className="email-detail-label-empty">Gmail에서 만든 라벨이 여기 표시됩니다.</div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                  <button type="button" className="email-detail-icon-btn" title="별표">
                    <span className="material-symbols-outlined">star</span>
                  </button>
                  <button type="button" className="email-detail-icon-btn" title="더보기">
                    <span className="material-symbols-outlined">more_vert</span>
                  </button>
                </div>
              </div>
              <div className="email-detail-content">
                {(selectedEmail.labelIds || []).length > 0 && (
                  <div className="email-detail-labels-inline">
                    {(selectedEmail.labelIds || [])
                      .filter((id) => !['INBOX', 'UNREAD'].includes(id))
                      .map((id) => {
                        const label = gmailLabels.find((l) => l.id === id);
                        const name = label ? (systemLabelNames[label.id] || label.name) : id;
                        return (
                          <span key={id} className="email-detail-label-chip">
                            {name}
                          </span>
                        );
                      })}
                  </div>
                )}
                <h1 className="email-detail-subject">{selectedEmail.subject || '(제목 없음)'}</h1>
                <div className="email-detail-meta">
                  <div className="email-detail-avatar">
                    {(parseFromHeader(selectedEmail.from).name || selectedEmail.from || '?').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="email-detail-meta-text">
                    <div className="email-detail-from-row">
                      <strong>{parseFromHeader(selectedEmail.from).name || selectedEmail.from}</strong>
                      <span className="email-detail-from-email">{selectedEmail.from}</span>
                      <span className="email-detail-date">{selectedEmail.date}</span>
                    </div>
                    {selectedEmail.to && (
                      <p className="email-detail-to">받는 사람: {selectedEmail.to}</p>
                    )}
                    {selectedEmail.cc && (
                      <p className="email-detail-to">참조: {selectedEmail.cc}</p>
                    )}
                  </div>
                </div>
                <div className="email-detail-body">
                  {selectedEmail.bodyHtml ? (
                    <EmailHtmlFrame html={selectedEmail.bodyHtml} />
                  ) : (
                    (selectedEmail.body || '').split('\n').map((line, i) => (
                      <p key={i}>{line || '\u00A0'}</p>
                    ))
                  )}
                </div>
                {selectedEmail.attachments && selectedEmail.attachments.length > 0 && (
                  <div className="email-detail-attachments">
                    <h4 className="email-detail-attachments-title">첨부파일 ({selectedEmail.attachments.length})</h4>
                    <div className="email-detail-attachments-list">
                      {selectedEmail.attachments.map((att, i) => (
                        <button
                          key={i}
                          type="button"
                          className="email-detail-attachment-item"
                          onClick={async () => {
                            try {
                              const r = await fetch(`${API_BASE}/gmail/messages/${selectedEmail.id}/attachments/${att.attachmentId}`, { headers: getAuthHeader() });
                              if (!r.ok) return;
                              const blob = await r.blob();
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = att.filename || 'download';
                              a.click();
                              URL.revokeObjectURL(url);
                            } catch (_) {}
                          }}
                        >
                          <span className={`material-symbols-outlined email-detail-attachment-icon ${(att.mimeType || '').includes('pdf') ? 'icon-pdf' : ''}`}>
                            {(att.mimeType || '').includes('pdf') ? 'picture_as_pdf' : 'table_chart'}
                          </span>
                          <div>
                            <p className="email-detail-attachment-name">{att.filename}</p>
                            <p className="email-detail-attachment-size">{att.size ? `${(att.size / 1024).toFixed(1)} KB` : ''}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="email-detail-reply">
                <button
                  type="button"
                  className="email-detail-reply-open-compose"
                  onClick={() => setDetailCompose('reply')}
                >
                  <span className="material-symbols-outlined">reply</span>
                  답장 작성
                </button>
              </div>
            </>
          ) : (
            <div className="email-detail-empty">
              <span className="material-symbols-outlined email-detail-empty-icon">mail</span>
              <p>이메일을 선택하세요</p>
            </div>
          )}
        </section>
      </div>

      <button
        type="button"
        className="email-mobile-fab-compose"
        onClick={() => setDetailCompose('new')}
        aria-label="새 메일 작성"
      >
        <span className="material-symbols-outlined">edit</span>
      </button>
    </div>
  );
}
