import { useState, useEffect } from 'react';
import './home.css';

import { API_BASE } from '@/config';

export default function Home() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      try {
        const res = await fetch(`${API_BASE}/reports/dashboard`);
        if (!cancelled && res.ok) {
          const json = await res.json();
          setData(json);
        }
      } catch (_) {
        if (!cancelled) setData({
          totalRevenue: 425890,
          activeDeals: 128,
          newLeads: 45,
          taskCompletion: 82
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchData();
    return () => { cancelled = true; };
  }, []);

  const stats = data || {};
  const cards = [
    { label: '총 매출', value: `$${(stats.totalRevenue || 0).toLocaleString()}`, trend: '+12.5%', up: true, color: 'primary' },
    { label: '진행 중인 딜', value: stats.activeDeals ?? 128, trend: '-2.4%', up: false, color: 'rose' },
    { label: '신규 리드', value: stats.newLeads ?? 45, trend: '+5.0%', up: true, color: 'mint' },
    { label: '업무 완료율', value: `${stats.taskCompletion ?? 82}%`, trend: '+8.2%', up: true, color: 'primary' }
  ];

  return (
    <div className="page home-page">
      <header className="page-header">
        <div className="header-search">
          <span className="material-symbols-outlined">search</span>
          <input type="text" placeholder="딜, 연락처, 업무 검색..." />
        </div>
        <div className="header-actions">
          <button type="button" className="icon-btn"><span className="material-symbols-outlined">notifications</span></button>
          <button type="button" className="icon-btn"><span className="material-symbols-outlined">chat_bubble</span></button>
          <button type="button" className="btn-primary"><span className="material-symbols-outlined">add</span> 새로 만들기</button>
        </div>
      </header>

      <div className="page-content">
        <div className="cards-grid">
          {cards.map((card) => (
            <div key={card.label} className="stat-card">
              <div className="stat-card-top">
                <p className="stat-label">{card.label}</p>
                <span className={`stat-trend ${card.up ? 'up' : 'down'}`}>{card.trend}</span>
              </div>
              <h3 className="stat-value">{loading ? '—' : card.value}</h3>
              <div className="stat-bar-wrap">
                <div className={`stat-bar stat-bar-${card.color}`} style={{ width: typeof card.value === 'string' && card.value.includes('%') ? card.value : '65%' }} />
              </div>
            </div>
          ))}
        </div>

        <div className="panel sales-pipeline">
          <div className="panel-head">
            <h2>영업 파이프라인</h2>
            <div className="panel-actions">
              <button type="button" className="chip active">최근 30일</button>
              <button type="button" className="chip">최근 90일</button>
            </div>
          </div>
          <div className="pipeline-bars">
            {['리드 (24)', '검토 (18)', '제안 (12)', '협상 (8)', '계약 (32)'].map((label, i) => (
              <div key={label} className="pipeline-col">
                <div className="pipeline-label">
                  <span>{label}</span>
                  <span className="pipeline-value">{['$240k', '$185k', '$310k', '$215k', '$1.2M'][i]}</span>
                </div>
                <div className="pipeline-bar-wrap">
                  <div className="pipeline-bar" style={{ height: [40, 65, 50, 75, 95][i] + '%' }} />
                  <div className="pipeline-bar alt" style={{ height: [65, 80, 60, 90, 100][i] + '%' }} />
                  <div className="pipeline-bar dark" style={{ height: [50, 70, 60, 85, 90][i] + '%' }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="home-bottom">
          <div className="panel tasks-panel">
            <div className="panel-head"><h2>예정 업무</h2></div>
            <div className="tasks-list">
              <div className="task-item done">
                <span className="material-symbols-outlined text-mint">check_circle</span>
                <div>
                  <p>Acme Corp 후속 연락</p>
                  <span className="task-meta">오늘 14:30</span>
                </div>
              </div>
              <div className="task-item">
                <span className="material-symbols-outlined">radio_button_unchecked</span>
                <div>
                  <p>GlobalX 제안서 검토</p>
                  <span className="task-meta">내일 10:00</span>
                </div>
              </div>
              <div className="task-item">
                <span className="material-symbols-outlined">radio_button_unchecked</span>
                <div>
                  <p>팀 분기 정기 회의</p>
                  <span className="task-meta">금요일 16:00</span>
                </div>
              </div>
            </div>
            <button type="button" className="link-btn">전체 업무 보기</button>
          </div>
          <div className="panel reps-panel">
            <div className="panel-head">
              <h2>우수 영업 담당자</h2>
              <span className="panel-badge">3분기 실적</span>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>담당자</th>
                    <th>계약 건수</th>
                    <th>총 금액</th>
                    <th>목표 달성률</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { name: 'Sarah Jenkins', init: 'SR', deals: 24, value: '$184,000', quota: 95 },
                    { name: 'Mark Thompson', init: 'MT', deals: 19, value: '$142,500', quota: 82 },
                    { name: 'David Lee', init: 'DL', deals: 15, value: '$98,000', quota: 65 }
                  ].map((row) => (
                    <tr key={row.name}>
                      <td>
                        <div className="cell-user">
                          <span className="avatar-initials">{row.init}</span>
                          {row.name}
                        </div>
                      </td>
                      <td>{row.deals}</td>
                      <td className="font-semibold">{row.value}</td>
                      <td>
                        <div className="quota-cell">
                          <div className="quota-bar"><div className="quota-fill" style={{ width: row.quota + '%' }} /></div>
                          <span>{row.quota}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
