import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_BASE } from '@/config';
import { getStoredCrmUser, isAdminOrAboveRole } from '@/lib/crm-role-utils';
import { markNotificationsAsSeen } from '@/lib/notification-read-state';
import PageHeaderNotifyChat from '@/components/page-header-notify-chat/page-header-notify-chat';
import DOMPurify from 'dompurify';
import './notification.css';

function formatDt(iso) {
  if (!iso) return '등록 시각 없음';
  try {
    return new Date(iso).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return '등록 시각 없음';
  }
}

/** 목록·푸시 미리보기용 — HTML 제거 후 짧은 요약 */
function plainExcerpt(html, maxLen = 120) {
  const text = String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  return text.length > maxLen ? `${text.slice(0, maxLen - 1)}…` : text;
}

const PAGE_SIZE = 20;

/** 사내 공지(회사 companyId) — CRM 글쓰기·수정·삭제 대상. 전체 공지(companyId 없음)는 열람만 */
function isCompanyNotice(item) {
  const cid = item?.companyId;
  return cid != null && String(cid).trim() !== '';
}

export default function NotificationPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [mentionRows, setMentionRows] = useState([]);
  const [page, setPage] = useState(1);
  const [mentionPage, setMentionPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 0, limit: PAGE_SIZE });
  const [mentionPagination, setMentionPagination] = useState({ total: 0, totalPages: 0, limit: PAGE_SIZE });
  const [loading, setLoading] = useState(true);
  const [mentionLoading, setMentionLoading] = useState(true);
  const [openingMentionId, setOpeningMentionId] = useState('');
  const [error, setError] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [previewOn, setPreviewOn] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ title: '', content: '' });
  /** 대표(Owner)·관리자(Admin)만 등록·수정·삭제 — 백엔드 requireOwnerOrAdmin 과 동일 */
  const canManage = useMemo(() => isAdminOrAboveRole(getStoredCrmUser()?.role), []);

  const loadNotifications = useCallback(async (forcedPage, options = {}) => {
    const token = localStorage.getItem('crm_token');
    if (!token) {
      setRows([]);
      setLoading(false);
      return;
    }

    const pageNum = forcedPage != null ? forcedPage : page;
    const markSeenExcludeIds = Array.isArray(options.markSeenExcludeIds)
      ? options.markSeenExcludeIds
      : [];

    setLoading(true);
    setError('');
    try {
      const res = await fetch(
        `${API_BASE}/notifications?page=${pageNum}&limit=${PAGE_SIZE}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '공지사항을 불러오지 못했습니다.');
      const list = Array.isArray(data.notifications) ? data.notifications : [];
      setRows(list);
      const p = data.pagination;
      if (p && typeof p === 'object') {
        setPagination({
          total: Number(p.total) || 0,
          totalPages: Number(p.totalPages) || 0,
          limit: Number(p.limit) || PAGE_SIZE
        });
      }
      markNotificationsAsSeen(list, { excludeIds: markSeenExcludeIds });
    } catch (err) {
      setError(err.message || '공지사항을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [page]);

  const loadMentions = useCallback(async (forcedPage) => {
    const token = localStorage.getItem('crm_token');
    if (!token) {
      setMentionRows([]);
      setMentionLoading(false);
      return;
    }

    const pageNum = forcedPage != null ? forcedPage : mentionPage;
    setMentionLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/notifications/mentions?page=${pageNum}&limit=${PAGE_SIZE}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '프로젝트 언급 알림을 불러오지 못했습니다.');
      setMentionRows(Array.isArray(data.mentions) ? data.mentions : []);
      const p = data.pagination;
      if (p && typeof p === 'object') {
        setMentionPagination({
          total: Number(p.total) || 0,
          totalPages: Number(p.totalPages) || 0,
          limit: Number(p.limit) || PAGE_SIZE
        });
      }
    } catch (err) {
      setError((prev) => prev || err.message || '프로젝트 언급 알림을 불러오지 못했습니다.');
    } finally {
      setMentionLoading(false);
    }
  }, [mentionPage]);

  useEffect(() => {
    void loadNotifications();
  }, [loadNotifications]);

  useEffect(() => {
    void loadMentions();
  }, [loadMentions]);

  /** 현재 페이지에 글이 없으면 앞 페이지로(삭제 후 빈 페이지 방지) */
  useEffect(() => {
    if (!loading && rows.length === 0 && page > 1) {
      setPage((p) => Math.max(1, p - 1));
    }
  }, [loading, rows.length, page]);

  const sanitizeHtml = useCallback((html) => {
    const raw = typeof html === 'string' ? html : String(html || '');
    return DOMPurify.sanitize(raw, {
      USE_PROFILES: { html: true },
      ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i
    });
  }, []);

  const openNew = () => {
    if (!canManage) return;
    setEditingId(null);
    setForm({ title: '', content: '' });
    setPreviewOn(false);
    setEditorOpen(true);
  };

  const openEdit = (row) => {
    if (!canManage || !isCompanyNotice(row)) return;
    setEditingId(row?._id || null);
    setForm({ title: row?.title || '', content: row?.content || '' });
    setPreviewOn(false);
    setEditorOpen(true);
  };

  const submit = async () => {
    if (!canManage) {
      setError('등록·수정은 대표(Owner) 또는 관리자(Admin)만 가능합니다.');
      return;
    }
    const token = localStorage.getItem('crm_token');
    if (!token) return;
    const title = String(form.title || '').trim();
    const content = String(form.content || '').trim();
    if (!title) { setError('제목을 입력해 주세요.'); return; }
    if (!content) { setError('내용을 입력해 주세요.'); return; }
    setSaving(true);
    setError('');
    try {
      const url = editingId
        ? `${API_BASE}/notifications/${encodeURIComponent(editingId)}`
        : `${API_BASE}/notifications`;
      const method = editingId ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ title, content, isPublished: true })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '저장에 실패했습니다.');
      const saved = data.notification;
      const savedId = saved?._id ? String(saved._id) : '';
      setEditorOpen(false);
      setEditingId(null);
      setForm({ title: '', content: '' });
      setPage(1);
      await loadNotifications(1, { markSeenExcludeIds: savedId ? [savedId] : [] });
    } catch (e) {
      setError(e.message || '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id, row) => {
    if (!canManage) return;
    if (row && !isCompanyNotice(row)) return;
    const token = localStorage.getItem('crm_token');
    if (!token || !id) return;
    if (!window.confirm('이 공지사항을 삭제할까요? 삭제 후에는 복구되지 않습니다.')) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/notifications/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '삭제에 실패했습니다.');
      await loadNotifications();
    } catch (e) {
      setError(e.message || '삭제에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const markInboxRead = async (item) => {
    const mentionId = String(item?._id || '').trim();
    const token = localStorage.getItem('crm_token');
    if (!token || !mentionId || item?.readAt) return;
    try {
      const res = await fetch(`${API_BASE}/notifications/mentions/${encodeURIComponent(mentionId)}/read`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setMentionRows((prev) =>
          prev.map((row) =>
            String(row?._id || '') === mentionId ? { ...row, readAt: new Date().toISOString() } : row
          )
        );
        try {
          window.dispatchEvent(new CustomEvent('crm-notifications-seen'));
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* 이동은 계속 */
    }
  };

  const openInboxItem = async (item) => {
    const mentionId = String(item?._id || '').trim();
    setOpeningMentionId(mentionId);
    await markInboxRead(item);
    if (item?.type === 'admin-user-signup') {
      navigate(String(item?.linkUrl || '/admin/users').trim() || '/admin/users');
      setOpeningMentionId('');
      return;
    }
    const linkId = String(item?.linkProjectId || '').trim();
    if (!linkId) {
      setOpeningMentionId('');
      return;
    }
    navigate(`/project?projectModal=edit&projectId=${encodeURIComponent(linkId)}`);
    setOpeningMentionId('');
  };

  const listLoading = loading || mentionLoading;
  const listEmpty = !listLoading && rows.length === 0 && mentionRows.length === 0;

  return (
    <div className="page notification-page">
      <header className="page-header notification-header">
        <div>
          <h1 className="notification-title">알림</h1>
          <p className="notification-lead">
            프로젝트 코멘트 @언급, 회원가입·정보 수정(관리자), 사내 공지가 여기에 표시됩니다. Nexvia 전체 공지는
            열람만 가능합니다.
          </p>
        </div>
        <div className="notification-header-actions">
          {canManage ? (
            <button type="button" className="notification-write-btn" onClick={openNew} disabled={saving}>
              <span className="material-symbols-outlined" aria-hidden>edit</span>
              사내 공지 작성
            </button>
          ) : null}
          <PageHeaderNotifyChat buttonClassName="notification-header-icon-btn" wrapperClassName="notification-header-actions-inner" />
        </div>
      </header>

      <div className="page-content">
        {error && <div className="notification-feedback notification-feedback--error">{error}</div>}

        <p className="notification-push-sidebar-hint">
          스마트폰·PWA 푸시는 왼쪽 사이드바 하단 <strong>알림(종) 아이콘</strong>으로 켜고 끌 수 있습니다. 프로젝트
          @언급·회원가입 알림(관리자)·공지 모두 로그인한 계정에만 알림이 갑니다.
        </p>

        {editorOpen && canManage ? (
          <section className="notification-editor" aria-label={editingId ? '사내 공지 수정' : '사내 공지 작성'}>
            <div className="notification-editor-head">
              <h2 className="notification-editor-title">{editingId ? '사내 공지 수정' : '사내 공지 작성'}</h2>
              <div className="notification-editor-actions">
                <button
                  type="button"
                  className={`notification-editor-tab ${!previewOn ? 'active' : ''}`}
                  onClick={() => setPreviewOn(false)}
                >
                  편집
                </button>
                <button
                  type="button"
                  className={`notification-editor-tab ${previewOn ? 'active' : ''}`}
                  onClick={() => setPreviewOn(true)}
                >
                  미리보기
                </button>
                <button
                  type="button"
                  className="notification-editor-close"
                  onClick={() => { setEditorOpen(false); setEditingId(null); }}
                  aria-label="닫기"
                >
                  <span className="material-symbols-outlined" aria-hidden>close</span>
                </button>
              </div>
            </div>

            {!previewOn ? (
              <div className="notification-editor-form">
                <label className="notification-editor-label">
                  제목
                  <input
                    className="notification-editor-input"
                    value={form.title}
                    onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                    placeholder="제목을 입력하세요"
                  />
                </label>
                <label className="notification-editor-label">
                  내용 (HTML/이모티콘 가능)
                  <textarea
                    className="notification-editor-textarea"
                    value={form.content}
                    onChange={(e) => setForm((p) => ({ ...p, content: e.target.value }))}
                    placeholder={`예)\n<p>문단</p>\n<b>굵게</b>\n<br />\n😀`}
                  />
                </label>
                <p className="notification-editor-push-hint">
                  사내 공지 등록·수정 저장 시, 사이드바에서 푸시 알림을 켠 같은 회사 소속(작성자 본인 포함)에게 제목·내용
                  요약이 푸시로 자동 발송됩니다.
                </p>
                <div className="notification-editor-submit-row">
                  <button type="button" className="notification-editor-submit" onClick={submit} disabled={saving}>
                    {saving ? '저장 중…' : editingId ? '수정 저장' : '등록'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="notification-editor-preview">
                <div className="notification-card">
                  <div className="notification-card-meta">
                    <span className="notification-card-badge">사내 공지</span>
                    <span>미리보기</span>
                  </div>
                  <h2 className="notification-card-title">{form.title || '제목 없음'}</h2>
                  <div
                    className="notification-card-content"
                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(form.content) }}
                  />
                </div>
              </div>
            )}
          </section>
        ) : null}

        <section className="notification-list">
          {listLoading ? (
            <div className="notification-empty">알림을 불러오는 중입니다…</div>
          ) : listEmpty ? (
            <div className="notification-empty">현재 받은 알림이 없습니다.</div>
          ) : (
            <>
            {mentionRows.length > 0 ? (
              <>
                {mentionRows.map((item) => {
                  const type = String(item?.type || 'project-comment-mention');
                  const isAdminSignup = type === 'admin-user-signup';
                  const authorName = String(item?.authorName || '동료').trim();
                  const projectTitle = String(item?.projectTitle || '프로젝트').trim();
                  const excerpt = String(item?.messageExcerpt || '').trim();
                  const unread = !item?.readAt;
                  const mentionId = String(item?._id || '');
                  const actionKind = item?.actionKind === 'profile-update' ? 'profile-update' : 'register';
                  return (
                    <button
                      key={`mention-${mentionId}`}
                      type="button"
                      className={`notification-card notification-card--mention${unread ? ' notification-card--unread' : ''}`}
                      onClick={() => void openInboxItem(item)}
                      disabled={openingMentionId === mentionId}
                    >
                      <div className="notification-card-meta">
                        <span
                          className={`notification-card-badge ${
                            isAdminSignup
                              ? 'notification-card-badge--admin-signup'
                              : 'notification-card-badge--mention'
                          }`}
                        >
                          {isAdminSignup
                            ? actionKind === 'profile-update'
                              ? '회원 정보 수정'
                              : '신규 회원가입'
                            : '프로젝트 언급'}
                        </span>
                        <span>{formatDt(item.createdAt)}</span>
                        {unread ? <span className="notification-card-unread-dot" aria-label="읽지 않음" /> : null}
                      </div>
                      <h2 className="notification-card-title">
                        {isAdminSignup
                          ? actionKind === 'profile-update'
                            ? `${authorName}님이 회원 정보를 수정했습니다`
                            : `${authorName}님이 회원가입했습니다`
                          : `${authorName}님이 프로젝트 코멘트에서 언급했습니다`}
                      </h2>
                      <p className="notification-card-excerpt">
                        {isAdminSignup
                          ? excerpt || `${item?.subjectEmail || ''} · ${item?.subjectCompanyName || ''}`.trim()
                          : `[${projectTitle}]${excerpt ? ` ${excerpt}` : ''}`}
                      </p>
                      <p className="notification-card-open-hint">
                        {isAdminSignup ? '탭하면 유저 현황(/admin)으로 이동합니다' : '탭하면 해당 프로젝트가 열립니다'}
                      </p>
                    </button>
                  );
                })}
                {mentionPagination.totalPages > 1 ? (
                  <div className="notification-pagination">
                    <button
                      type="button"
                      className="notification-page-btn"
                      disabled={mentionPage <= 1}
                      onClick={() => setMentionPage((p) => Math.max(1, p - 1))}
                    >
                      이전 언급
                    </button>
                    <span className="notification-page-info">
                      언급 {mentionPage} / {mentionPagination.totalPages} · 총{' '}
                      {mentionPagination.total.toLocaleString()}건
                    </span>
                    <button
                      type="button"
                      className="notification-page-btn"
                      disabled={mentionPage >= mentionPagination.totalPages}
                      onClick={() => setMentionPage((p) => p + 1)}
                    >
                      다음 언급
                    </button>
                  </div>
                ) : null}
              </>
            ) : null}
            {rows.length > 0 && mentionRows.length > 0 ? (
              <h2 className="notification-section-title">사내·전체 공지</h2>
            ) : null}
            {rows.map((item) => {
              const companyNotice = isCompanyNotice(item);
              return (
              <article key={item._id} className="notification-card">
                <div className="notification-card-meta">
                  <span
                    className={`notification-card-badge ${companyNotice ? '' : 'notification-card-badge--global'}`}
                  >
                    {companyNotice ? '사내 공지' : '전체 공지'}
                  </span>
                  <span>{formatDt(item.publishedAt || item.createdAt)}</span>
                  {canManage && companyNotice ? (
                    <span className="notification-card-actions">
                      <button type="button" className="notification-card-action-btn" onClick={() => openEdit(item)} disabled={saving}>
                        수정
                      </button>
                      <button type="button" className="notification-card-action-btn danger" onClick={() => remove(item._id, item)} disabled={saving}>
                        삭제
                      </button>
                    </span>
                  ) : null}
                </div>
                <h2 className="notification-card-title">{item.title}</h2>
                {plainExcerpt(item.content) ? (
                  <p className="notification-card-excerpt">{plainExcerpt(item.content)}</p>
                ) : null}
                <div
                  className="notification-card-content"
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(item.content) }}
                />
              </article>
              );
            })}
            {pagination.totalPages > 1 ? (
              <div className="notification-pagination">
                <button
                  type="button"
                  className="notification-page-btn"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  이전
                </button>
                <span className="notification-page-info">
                  {page} / {pagination.totalPages} 페이지 · 총 {pagination.total.toLocaleString()}건
                </span>
                <button
                  type="button"
                  className="notification-page-btn"
                  disabled={page >= pagination.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  다음
                </button>
              </div>
            ) : null}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
