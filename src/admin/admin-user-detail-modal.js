import { useCallback, useEffect, useMemo, useState } from 'react';
import { API_BASE } from '@/config';
import { getAdminSiteFetchHeaders } from '@/lib/admin-site-headers';
import { SIDEBAR_CATEGORY_ITEMS, SIDEBAR_SUBMENU_BY_CATEGORY } from '@/lib/sidebar-menu-restrictions';
import './admin-user-detail-modal.css';

const ROLE_OPTIONS = [
  { value: 'owner', label: '대표 (owner)' },
  { value: 'admin', label: '관리자 (admin)' },
  { value: 'senior', label: '관리자 (senior · 레거시)' },
  { value: 'manager', label: '실무자 (manager)' },
  { value: 'practitioner', label: '실무자 (practitioner · 레거시)' },
  { value: 'contributor', label: '실무자 (contributor · 레거시)' },
  { value: 'staff', label: 'Staff' },
  { value: 'pending', label: '권한 대기' }
];

function formatDateTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return '—';
  }
}

export default function AdminUserDetailModal({ userId, onClose, onSaved }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState(null);
  const [name, setName] = useState('');
  const [role, setRole] = useState('pending');
  const [hiddenMenus, setHiddenMenus] = useState([]);

  const loadDetail = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/admin/users/${encodeURIComponent(userId)}`, {
        headers: getAdminSiteFetchHeaders()
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '사용자 정보를 불러오지 못했습니다.');
      const u = data.user || {};
      setDetail(u);
      setName(String(u.name || ''));
      setRole(String(u.rawRole || u.role || 'pending'));
      setHiddenMenus(Array.isArray(u.hiddenSidebarMenus) ? u.hiddenSidebarMenus : []);
    } catch (e) {
      setError(e.message || '사용자 정보를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !saving) onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const hiddenSet = useMemo(() => new Set(hiddenMenus), [hiddenMenus]);

  const toggleHiddenMenu = (menuTo) => {
    setHiddenMenus((prev) => {
      const set = new Set(prev);
      if (set.has(menuTo)) set.delete(menuTo);
      else set.add(menuTo);
      return [...set];
    });
  };

  const save = async () => {
    if (!userId) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/admin/users/${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        headers: { ...getAdminSiteFetchHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: String(name || '').trim(),
          role,
          hiddenSidebarMenus: hiddenMenus
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '저장에 실패했습니다.');
      onSaved?.(data.user);
      onClose?.();
    } catch (e) {
      setError(e.message || '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  if (!userId) return null;

  return (
    <div className="admin-user-modal-overlay" role="presentation">
      <div className="admin-user-modal" role="dialog" aria-modal="true" aria-labelledby="admin-user-modal-title">
        <header className="admin-user-modal-head">
          <div>
            <h2 id="admin-user-modal-title" className="admin-user-modal-title">사용자 설정</h2>
            {detail ? (
              <p className="admin-user-modal-sub">{detail.email}</p>
            ) : null}
          </div>
          <button type="button" className="admin-user-modal-close" onClick={onClose} disabled={saving} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>

        {loading ? (
          <p className="admin-user-modal-loading">불러오는 중…</p>
        ) : (
          <div className="admin-user-modal-body">
            {error ? <p className="admin-user-modal-error">{error}</p> : null}

            <section className="admin-user-modal-section">
              <h3 className="admin-user-modal-section-title">기본 정보</h3>
              <label className="admin-user-modal-label">
                이름
                <input
                  className="admin-user-modal-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={saving}
                />
              </label>
              <label className="admin-user-modal-label">
                권한
                <select className="admin-user-modal-select" value={role} onChange={(e) => setRole(e.target.value)} disabled={saving}>
                  {ROLE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              {detail ? (
                <dl className="admin-user-modal-meta">
                  <div>
                    <dt>회사</dt>
                    <dd>{detail.companyName || '—'}</dd>
                  </div>
                  <div>
                    <dt>생성일</dt>
                    <dd>{formatDateTime(detail.createdAt)}</dd>
                  </div>
                </dl>
              ) : null}
            </section>

            <section className="admin-user-modal-section">
              <h3 className="admin-user-modal-section-title">사이드바 메뉴 숨김</h3>
              <p className="admin-user-modal-hint">
                체크한 메뉴는 해당 사용자 CRM 사이드바에 <strong>표시되지 않으며</strong>, URL 직접 입력으로도 접근할 수 없습니다.
              </p>
              {SIDEBAR_CATEGORY_ITEMS.map((cat) => {
                const items = SIDEBAR_SUBMENU_BY_CATEGORY[cat.key] || [];
                if (!items.length) return null;
                return (
                  <div key={cat.key} className="admin-user-modal-menu-group">
                    <p className="admin-user-modal-menu-group-title">{cat.label}</p>
                    <ul className="admin-user-modal-menu-list">
                      {items.map((item) => (
                        <li key={item.to}>
                          <label className="admin-user-modal-menu-check">
                            <input
                              type="checkbox"
                              checked={hiddenSet.has(item.to)}
                              onChange={() => toggleHiddenMenu(item.to)}
                              disabled={saving || ((detail?.role === 'pending' || detail?.rawRole === 'pending') && item.to === '/company-overview')}
                            />
                            <span>{item.label}</span>
                            <span className="admin-user-modal-menu-path">{item.to}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </section>
          </div>
        )}

        <footer className="admin-user-modal-foot">
          <button type="button" className="admin-sub-btn" onClick={onClose} disabled={saving}>
            취소
          </button>
          <button type="button" className="admin-sub-btn admin-sub-btn-primary" onClick={() => void save()} disabled={saving || loading}>
            {saving ? '저장 중…' : '저장'}
          </button>
        </footer>
      </div>
    </div>
  );
}
