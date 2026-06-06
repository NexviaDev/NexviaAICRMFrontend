import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import PageHeaderNotifyChat from '@/components/page-header-notify-chat/page-header-notify-chat';
import { API_BASE } from '@/config';
import { pingBackendHealth } from '@/lib/backend-wake';
import { notifyCrmAuthChanged } from '@/lib/use-crm-token';
import './account-settings.css';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function syncLocalUserListTemplates(listTemplates) {
  try {
    const raw = localStorage.getItem('crm_user');
    const user = raw ? JSON.parse(raw) : {};
    user.listTemplates = listTemplates || {};
    localStorage.setItem('crm_user', JSON.stringify(user));
    notifyCrmAuthChanged();
  } catch (_) {}
}

export default function AccountSettings() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [userProfile, setUserProfile] = useState(null);
  const [companyBundle, setCompanyBundle] = useState(null);

  const loadData = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      await pingBackendHealth();
      const [meRes, companyRes] = await Promise.all([
        fetch(`${API_BASE}/auth/me`, { headers: getAuthHeader(), credentials: 'include' }),
        fetch(`${API_BASE}/companies/list-templates-bundle`, { headers: getAuthHeader(), credentials: 'include' })
      ]);
      const meData = await meRes.json().catch(() => ({}));
      const companyData = await companyRes.json().catch(() => ({}));
      if (!meRes.ok) throw new Error(meData.error || '내 정보를 불러오지 못했습니다.');
      if (!companyRes.ok) throw new Error(companyData.error || '회사 정보를 불러오지 못했습니다.');
      const u = meData.user || {};
      setUserProfile(u);
      setCompanyBundle(companyData);
      syncLocalUserListTemplates(u.listTemplates);
    } catch (e) {
      setError(e.message || '불러오기 실패');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const company = companyBundle?.company;
  const displayEmail = userProfile?.email || userProfile?.id || '—';

  const pageHeader = (
    <header className="page-header account-settings-header">
      <div className="account-settings-header-main">
        <h1 className="page-title">내 계정 · 설정</h1>
      </div>
      <div className="account-settings-header-tools">
        <PageHeaderNotifyChat noWrapper buttonClassName="icon-btn" />
      </div>
    </header>
  );

  if (loading) {
    return (
      <div className="page account-settings-page">
        {pageHeader}
        <div className="page-content">
          <p className="acct-loading">불러오는 중…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page account-settings-page">
      {pageHeader}
      <div className="page-content">
        {error && <div className="acct-error" role="alert">{error}</div>}

        <section className="acct-card acct-card--profile" aria-labelledby="acct-profile-title">
          <div className="acct-card-head">
            <div className="acct-card-title-wrap">
              <span className="acct-card-icon acct-card-icon--profile material-symbols-outlined" aria-hidden>badge</span>
              <h2 id="acct-profile-title">개인 정보</h2>
            </div>
            <Link to="/register?edit=1" className="acct-edit-link" title="개인 정보 수정" aria-label="개인 정보 수정">
              <span className="material-symbols-outlined" aria-hidden>edit</span>
              <span className="acct-edit-link-label">수정</span>
            </Link>
          </div>
          <div className="acct-profile-panel">
            <div className="acct-avatar-wrap">
              {userProfile?.avatar ? (
                <img src={userProfile.avatar} alt="" className="acct-avatar-img" />
              ) : (
                <div className="acct-avatar-fallback" aria-hidden>
                  <span className="material-symbols-outlined">person</span>
                </div>
              )}
            </div>
            <div className="acct-profile-main">
              <p className="acct-profile-name">{userProfile?.name || '사용자'}</p>
              <p className="acct-profile-email">{displayEmail}</p>
            </div>
          </div>
          <p className="acct-profile-hint">
            <span className="material-symbols-outlined acct-hint-icon" aria-hidden>info</span>
            이름·연락처·회사 소속은 우측 상단 <strong>수정</strong>에서 변경할 수 있습니다.
          </p>
        </section>

        <section className="acct-card acct-card--company" aria-labelledby="acct-company-title">
          <div className="acct-card-head">
            <div className="acct-card-title-wrap">
              <span className="acct-card-icon acct-card-icon--company material-symbols-outlined" aria-hidden>apartment</span>
              <h2 id="acct-company-title">소속 회사</h2>
            </div>
            <span className="acct-card-badge acct-card-badge--company">회사</span>
          </div>
          {!company ? (
            <p className="acct-empty">등록된 소속 회사가 없습니다.</p>
          ) : (
            <div className="acct-company-summary">
              <div className="acct-company-tile acct-company-tile--highlight">
                <span className="acct-company-label">회사명</span>
                <span className="acct-company-value">{company.name || '—'}</span>
              </div>
              <div className="acct-company-tile">
                <span className="acct-company-label">사업자번호</span>
                <span className="acct-company-value">{company.businessNumber || '—'}</span>
              </div>
              <div className="acct-company-tile acct-company-tile--wide">
                <span className="acct-company-label">주소</span>
                <span className="acct-company-value">
                  {[company.address, company.addressDetail].filter(Boolean).join(' ') || '—'}
                </span>
              </div>
              {company.driveRootUrl ? (
                <div className="acct-company-tile acct-company-tile--wide">
                  <span className="acct-company-label">공유 드라이브</span>
                  <a href={company.driveRootUrl} target="_blank" rel="noopener noreferrer" className="acct-company-link">
                    {company.driveRootUrl}
                  </a>
                </div>
              ) : null}
              {company.code ? (
                <div className="acct-company-tile">
                  <span className="acct-company-label">회사 코드</span>
                  <span className="acct-company-value">{company.code}</span>
                </div>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
