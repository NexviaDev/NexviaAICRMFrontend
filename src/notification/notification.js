import { useCallback, useEffect, useMemo, useState } from 'react';
import { API_BASE } from '@/config';
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

export default function NotificationPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [previewOn, setPreviewOn] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ title: '', content: '' });

  const me = useMemo(() => {
    try {
      const raw = localStorage.getItem('crm_user');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }, []);

  const canManage = me?.role === 'owner' || me?.role === 'senior';

  const loadNotifications = useCallback(async () => {
    const token = localStorage.getItem('crm_token');
    if (!token) {
      setRows([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/notifications`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '공지사항을 불러오지 못했습니다.');
      const list = Array.isArray(data.notifications) ? data.notifications : [];
      setRows(list);
      markNotificationsAsSeen(list);
    } catch (err) {
      setError(err.message || '공지사항을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadNotifications();
  }, [loadNotifications]);

  const sanitizeHtml = useCallback((html) => {
    const raw = typeof html === 'string' ? html : String(html || '');
    return DOMPurify.sanitize(raw, {
      USE_PROFILES: { html: true },
      ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i
    });
  }, []);

  const openNew = () => {
    setEditingId(null);
    setForm({ title: '', content: '' });
    setPreviewOn(false);
    setEditorOpen(true);
  };

  const openEdit = (row) => {
    setEditingId(row?._id || null);
    setForm({ title: row?.title || '', content: row?.content || '' });
    setPreviewOn(false);
    setEditorOpen(true);
  };

  const submit = async () => {
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
      setEditorOpen(false);
      setEditingId(null);
      setForm({ title: '', content: '' });
      await loadNotifications();
    } catch (e) {
      setError(e.message || '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
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

  return (
    <div className="page notification-page">
      <header className="page-header notification-header">
        <div>
          <h1 className="notification-title">공지사항</h1>
          <p className="notification-subtitle">
            {canManage ? '사내 공지사항을 등록·수정·삭제할 수 있습니다. (HTML/이모티콘 입력 가능)' : '공지사항 열람만 가능합니다.'}
          </p>
        </div>
        <div className="notification-header-actions">
          {canManage ? (
            <button type="button" className="notification-write-btn" onClick={openNew} disabled={saving}>
              <span className="material-symbols-outlined" aria-hidden>edit</span>
              글쓰기
            </button>
          ) : null}
          <PageHeaderNotifyChat buttonClassName="notification-header-icon-btn" wrapperClassName="notification-header-actions-inner" />
        </div>
      </header>

      <div className="page-content">
        {error && <div className="notification-feedback notification-feedback--error">{error}</div>}

        {editorOpen && canManage ? (
          <section className="notification-editor" aria-label={editingId ? '공지 수정' : '공지 작성'}>
            <div className="notification-editor-head">
              <h2 className="notification-editor-title">{editingId ? '공지 수정' : '새 공지 작성'}</h2>
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
                    <span className="notification-card-badge">공지</span>
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
          {loading ? (
            <div className="notification-empty">공지사항을 불러오는 중입니다…</div>
          ) : rows.length === 0 ? (
            <div className="notification-empty">현재 등록된 공지사항이 없습니다.</div>
          ) : (
            rows.map((item) => (
              <article key={item._id} className="notification-card">
                <div className="notification-card-meta">
                  <span className="notification-card-badge">공지</span>
                  <span>{formatDt(item.publishedAt || item.createdAt)}</span>
                  {canManage ? (
                    <span className="notification-card-actions">
                      <button type="button" className="notification-card-action-btn" onClick={() => openEdit(item)} disabled={saving}>
                        수정
                      </button>
                      <button type="button" className="notification-card-action-btn danger" onClick={() => remove(item._id)} disabled={saving}>
                        삭제
                      </button>
                    </span>
                  ) : null}
                </div>
                <h2 className="notification-card-title">{item.title}</h2>
                <div
                  className="notification-card-content"
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(item.content) }}
                />
              </article>
            ))
          )}
        </section>
      </div>
    </div>
  );
}
