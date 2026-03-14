import { useState, useEffect } from 'react';
import CompanyDriveSettingsModal from './company-drive-settings-modal/company-drive-settings-modal';
import './company-overview.css';

import { API_BASE } from '@/config';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function CompanyOverview() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showDriveSettingsModal, setShowDriveSettingsModal] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetchOverview = async () => {
      try {
        const res = await fetch(`${API_BASE}/companies/overview`, { headers: getAuthHeader() });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error || '조회에 실패했습니다.');
        }
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) setError(e.message || '사내 현황을 불러올 수 없습니다.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchOverview();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="page company-overview-page">
        <header className="page-header">
          <h1 className="page-title">사내 현황</h1>
        </header>
        <div className="page-content company-overview-content">
          <p className="company-overview-loading">불러오는 중...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page company-overview-page">
        <header className="page-header">
          <h1 className="page-title">사내 현황</h1>
        </header>
        <div className="page-content company-overview-content">
          <p className="company-overview-error">{error}</p>
        </div>
      </div>
    );
  }

  const { company = {}, employees = [] } = data || {};
  const fullAddress = [company.address, company.addressDetail].filter(Boolean).join(' ');

  return (
    <div className="page company-overview-page">
      <header className="page-header company-overview-header">
        <h1 className="page-title">사내 현황</h1>
        <button
          type="button"
          className="company-overview-settings-btn"
          onClick={() => setShowDriveSettingsModal(true)}
          title="전체 공유 드라이브 설정"
          aria-label="전체 공유 드라이브 설정"
        >
          <span className="material-symbols-outlined">settings</span>
        </button>
      </header>
      <div className="page-content company-overview-content">
        <section className="company-overview-card company-info-card">
          <h2 className="company-overview-section-title">
            <span className="material-symbols-outlined">business</span>
            소속 회사
          </h2>
          <dl className="company-info-list">
            <div className="company-info-row">
              <dt>회사명</dt>
              <dd>{company.name || '—'}</dd>
            </div>
            <div className="company-info-row">
              <dt>주소</dt>
              <dd>{fullAddress || '—'}</dd>
            </div>
          </dl>
        </section>

        <section className="company-overview-card employees-card">
          <h2 className="company-overview-section-title">
            <span className="material-symbols-outlined">group</span>
            직원 리스트
            <span className="company-overview-count">({employees.length}명)</span>
          </h2>
          {employees.length === 0 ? (
            <p className="company-overview-empty">등록된 직원이 없습니다.</p>
          ) : (
            <div className="company-overview-table-wrap">
              <table className="company-overview-table">
                <thead>
                  <tr>
                    <th>이름</th>
                    <th>이메일</th>
                    <th>연락처</th>
                    <th>부서</th>
                    <th>역할</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map((emp) => (
                    <tr key={emp.id}>
                      <td>{emp.name || '—'}</td>
                      <td>{emp.email || '—'}</td>
                      <td>{emp.phone || '—'}</td>
                      <td>{emp.department || '—'}</td>
                      <td>{emp.role || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {showDriveSettingsModal && (
        <CompanyDriveSettingsModal
          initialDriveRootUrl={(data?.company?.driveRootUrl ?? '').trim()}
          onClose={() => setShowDriveSettingsModal(false)}
          onSaved={(savedUrl) => {
            setData((prev) => prev ? { ...prev, company: { ...prev.company, driveRootUrl: savedUrl } } : null);
          }}
        />
      )}
    </div>
  );
}
