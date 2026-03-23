import { useCallback, useEffect, useMemo, useState } from 'react';
import { API_BASE } from '@/config';
import { getAdminSiteFetchHeaders } from '@/lib/admin-site-headers';
import './adminsubscription.css';

const ADMIN_TOKEN_KEY = 'admin_site_token';
const ADMIN_BOUND_USER_KEY = 'admin_site_bound_user_id';

function clearAdminSession() {
  localStorage.removeItem(ADMIN_TOKEN_KEY);
  localStorage.removeItem(ADMIN_BOUND_USER_KEY);
}

const EMPTY_DRAFT = {
  title: '',
  content: '',
  isPublished: true
};

function formatDt(iso) {
  if (!iso) return '미발행';
  try {
    return new Date(iso).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return '미발행';
  }
}

export default function AdminNotices() {
  const [rows, setRows] = useState([]);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteId, setDeleteId] = useState('');
  const [adminToken, setAdminToken] = useState(() => localStorage.getItem(ADMIN_TOKEN_KEY) || '');
  const loggedIn = !!adminToken;

  const editingRow = useMemo(
    () => rows.find((item) => item._id === editingId) || null,
    [editingId, rows]
  );

  const loadList = useCallback(async () => {
    if (!loggedIn) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/admin/notifications`, {
        headers: getAdminSiteFetchHeaders()
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) {
          clearAdminSession();
          setAdminToken('');
        }
        throw new Error(data.error || '공지 목록을 불러오지 못했습니다.');
      }
      setRows(Array.isArray(data.notifications) ? data.notifications : []);
    } catch (err) {
      setError(err.message || '공지 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [loggedIn]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const resetDraft = () => {
    setEditingId('');
    setDraft(EMPTY_DRAFT);
  };

  const startEdit = (item) => {
    setEditingId(item._id);
    setDraft({
      title: item.title || '',
      content: item.content || '',
      isPublished: item.isPublished !== false
    });
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const targetUrl = editingId
        ? `${API_BASE}/admin/notifications/${encodeURIComponent(editingId)}`
        : `${API_BASE}/admin/notifications`;
      const res = await fetch(targetUrl, {
        method: editingId ? 'PATCH' : 'POST',
        headers: getAdminSiteFetchHeaders(),
        body: JSON.stringify(draft)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) {
          clearAdminSession();
          setAdminToken('');
        }
        throw new Error(data.error || '공지 저장에 실패했습니다.');
      }
      await loadList();
      resetDraft();
    } catch (err) {
      setError(err.message || '공지 저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('이 공지사항을 삭제할까요? 삭제 후에는 복구되지 않습니다.')) return;
    setDeleteId(id);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/admin/notifications/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: getAdminSiteFetchHeaders()
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) {
          clearAdminSession();
          setAdminToken('');
        }
        throw new Error(data.error || '공지 삭제에 실패했습니다.');
      }
      if (editingId === id) resetDraft();
      await loadList();
    } catch (err) {
      setError(err.message || '공지 삭제에 실패했습니다.');
    } finally {
      setDeleteId('');
    }
  };

  return (
    <div className="admin-sub-page">
      <header className="admin-sub-header">
        <div>
          <h1 className="admin-sub-title">공지 사항</h1>
          <p className="admin-sub-sub">일반 사용자 화면은 열람만 가능하고, 등록·수정·삭제는 관리자만 처리합니다.</p>
        </div>
      </header>

      {!loggedIn ? (
        <div className="admin-sub-card admin-sub-login-card">
          <p className="admin-sub-lead">먼저 `구독 결제 현황` 메뉴에서 관리자 비밀번호를 입력해 주세요.</p>
        </div>
      ) : (
        <>
          {error && <p className="admin-sub-error admin-sub-error-banner">{error}</p>}

          <div className="admin-notice-grid">
            <section className="admin-sub-card admin-notice-editor">
              <h2 className="admin-notice-section-title">{editingId ? '공지 수정' : '공지 등록'}</h2>
              <form className="admin-sub-form" onSubmit={handleSubmit}>
                <label className="admin-sub-label">
                  제목
                  <input
                    type="text"
                    value={draft.title}
                    onChange={(e) => setDraft((prev) => ({ ...prev, title: e.target.value }))}
                    className="admin-sub-input"
                    maxLength={120}
                    required
                  />
                </label>

                <label className="admin-sub-label">
                  내용
                  <textarea
                    value={draft.content}
                    onChange={(e) => setDraft((prev) => ({ ...prev, content: e.target.value }))}
                    className="admin-sub-input admin-notice-textarea"
                    rows={10}
                    required
                  />
                </label>

                <label className="admin-notice-toggle">
                  <input
                    type="checkbox"
                    checked={draft.isPublished}
                    onChange={(e) => setDraft((prev) => ({ ...prev, isPublished: e.target.checked }))}
                  />
                  <span>즉시 사용자 화면에 노출</span>
                </label>

                <div className="admin-notice-form-actions">
                  <button type="submit" className="admin-sub-btn admin-sub-btn-primary" disabled={saving}>
                    {saving ? '저장 중…' : editingId ? '수정 저장' : '공지 등록'}
                  </button>
                  <button type="button" className="admin-sub-btn admin-sub-btn-ghost" onClick={resetDraft} disabled={saving}>
                    새 공지 작성
                  </button>
                </div>
              </form>
            </section>

            <section className="admin-sub-card admin-notice-list-card">
              <div className="admin-notice-list-head">
                <h2 className="admin-notice-section-title">등록된 공지</h2>
                <span className="admin-notice-count">{rows.length}건</span>
              </div>

              {loading ? (
                <p className="admin-sub-loading">공지 목록을 불러오는 중입니다…</p>
              ) : rows.length === 0 ? (
                <p className="admin-notice-empty">등록된 공지사항이 없습니다.</p>
              ) : (
                <div className="admin-notice-list">
                  {rows.map((item) => (
                    <article key={item._id} className={`admin-notice-item ${editingRow?._id === item._id ? 'is-editing' : ''}`}>
                      <div className="admin-notice-item-head">
                        <div>
                          <h3 className="admin-notice-item-title">{item.title}</h3>
                          <p className="admin-notice-item-meta">
                            {item.isPublished ? '노출 중' : '비노출'} · {formatDt(item.publishedAt || item.createdAt)}
                          </p>
                        </div>
                        <div className="admin-notice-item-actions">
                          <button type="button" className="admin-sub-btn admin-sub-btn-ghost" onClick={() => startEdit(item)}>
                            수정
                          </button>
                          <button
                            type="button"
                            className="admin-sub-btn admin-notice-delete-btn"
                            onClick={() => handleDelete(item._id)}
                            disabled={deleteId === item._id}
                          >
                            {deleteId === item._id ? '삭제 중…' : '삭제'}
                          </button>
                        </div>
                      </div>
                      <p className="admin-notice-item-content">{item.content}</p>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
