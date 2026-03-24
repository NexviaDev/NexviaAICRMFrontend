import { useState, useEffect } from 'react';
import './employee-performance.css';
import PageHeaderNotifyChat from '@/components/page-header-notify-chat/page-header-notify-chat';

import { API_BASE } from '@/config';

export default function EmployeePerformance() {
  const [data, setData] = useState(null);

  useEffect(() => {
    let c = false;
    fetch(`${API_BASE}/reports/performance`)
      .then((r) => r.ok ? r.json() : {})
      .then((d) => { if (!c) setData(d); })
      .catch(() => { if (!c) setData({}); });
    return () => { c = true; };
  }, []);

  const roleLabel = { 'Senior Sales Exec': '시니어 영업', 'Business Developer': '사업 개발', 'Account Manager': '키 account 담당', 'Lead Generation': '리드 발굴' };
  const employees = data?.employees ?? [
    { name: 'James Wilson', role: 'Senior Sales Exec', revenue: 128400, taskPercent: 92, status: 'Active' },
    { name: 'Sarah Chen', role: 'Business Developer', revenue: 94200, taskPercent: 78, status: 'Busy' },
    { name: 'Michael Miller', role: 'Account Manager', revenue: 72800, taskPercent: 65, status: 'Active' },
    { name: 'Elena Garcia', role: 'Lead Generation', revenue: 112000, taskPercent: 85, status: 'Active' }
  ];

  return (
    <div className="page performance-page">
      <header className="page-header">
        <div className="header-search">
          <span className="material-symbols-outlined">search</span>
          <input type="text" placeholder="실적 또는 직원 검색..." />
        </div>
        <div className="header-actions">
          <PageHeaderNotifyChat noWrapper buttonClassName="icon-btn" />
        </div>
      </header>

      <div className="page-content">
        <div className="report-top">
          <div>
            <h2>직원 업무 및 실적 현황</h2>
            <p className="page-desc">팀 생산성, 영업 목표, 업무 완료율을 실시간으로 확인합니다.</p>
          </div>
          <button type="button" className="btn-outline"><span className="material-symbols-outlined">file_download</span> 리포트 내보내기</button>
        </div>

        <div className="metrics-row">
          <div className="metric-card perf-card">
            <span className="metric-icon blue"><span className="material-symbols-outlined">equalizer</span></span>
            <span className="metric-badge up">+12.4%</span>
            <p className="metric-label">팀 평균 목표</p>
            <p className="metric-value">${(data?.teamAverageQuota ?? 42500).toLocaleString()}</p>
          </div>
          <div className="metric-card perf-card">
            <span className="metric-icon amber"><span className="material-symbols-outlined">emoji_events</span></span>
            <span className="metric-badge">우수 담당자</span>
            <p className="metric-label">이번 달 우수 담당자</p>
            <p className="metric-value">{data?.topPerformer ?? 'James Wilson'}</p>
          </div>
          <div className="metric-card perf-card">
            <span className="metric-icon indigo"><span className="material-symbols-outlined">checklist</span></span>
            <span className="metric-badge up">+8%</span>
            <p className="metric-label">완료된 업무 합계</p>
            <p className="metric-value">{(data?.totalCompletedTasks ?? 1284).toLocaleString()}</p>
          </div>
        </div>

        <div className="perf-grid">
          <div className="panel chart-panel sales-chart">
            <div className="panel-head">
              <h4>영업 실적: 목표 대비 실적</h4>
              <select className="chart-select"><option>최근 30일</option></select>
            </div>
            <div className="sales-bars">
              {['Wilson', 'Chen', 'Miller', 'Garcia', 'Taylor'].map((name, i) => (
                <div key={name} className="sales-bar-col">
                  <div className="sales-bar-wrap">
                    <div className="sales-bar target" style={{ height: [48, 40, 32, 44, 36][i] + '%' }} />
                    <div className="sales-bar actual" style={{ height: [40, 44, 28, 36, 42][i] + '%' }} />
                  </div>
                  <p>{name}</p>
                </div>
              ))}
            </div>
            <div className="chart-legend">
              <span><i className="dot target" /> 목표 매출</span>
              <span><i className="dot actual" /> 실적 매출</span>
            </div>
          </div>
          <div className="panel chart-panel task-panel">
            <h4>업무 완료율</h4>
            <div className="task-bars">
              {[
                { name: 'James Wilson', pct: 92 },
                { name: 'Sarah Chen', pct: 78 },
                { name: 'Michael Miller', pct: 65 },
                { name: 'Elena Garcia', pct: 85 },
                { name: 'Chris Taylor', pct: 42 }
              ].map((r) => (
                <div key={r.name} className="task-bar-item">
                  <div className="task-bar-label"><span>{r.name}</span><span>{r.pct}%</span></div>
                  <div className="task-bar-wrap"><div className="task-bar-fill" style={{ width: r.pct + '%' }} /></div>
                </div>
              ))}
            </div>
            <button type="button" className="btn-outline full">전체 업무 보기</button>
          </div>
        </div>

        <div className="panel table-panel">
          <div className="panel-head">
            <h4>직원 영업·업무 요약</h4>
            <button type="button" className="icon-btn small"><span className="material-symbols-outlined">filter_list</span> 필터</button>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>직원</th>
                  <th>역할</th>
                  <th>영업 매출</th>
                  <th>업무 완료율</th>
                  <th>상태</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {employees.map((row) => (
                  <tr key={row.name}>
                    <td>
                      <div className="cell-user">
                        <div className="avatar-img" />
                        <div>
                          <p className="font-bold">{row.name}</p>
                          <p className="text-muted small">email@crmsys.com</p>
                        </div>
                      </div>
                    </td>
                    <td>{roleLabel[row.role] || row.role}</td>
                    <td className="font-bold">${row.revenue?.toLocaleString()}</td>
                    <td>
                      <div className="quota-cell">
                        <span className="quota-pct">{row.taskPercent}%</span>
                        <div className="quota-bar"><div className="quota-fill" style={{ width: row.taskPercent + '%' }} /></div>
                      </div>
                    </td>
                    <td><span className={`status-badge status-${row.status?.toLowerCase()}`}>{row.status === 'Active' ? '활성' : row.status === 'Busy' ? '바쁨' : row.status}</span></td>
                    <td><button type="button" className="icon-btn small"><span className="material-symbols-outlined">more_vert</span></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pagination-bar">
            <p className="pagination-info">직원 24명 중 4명 표시</p>
            <div className="pagination-btns">
              <button type="button" className="pagination-btn"><span className="material-symbols-outlined">chevron_left</span></button>
              <button type="button" className="pagination-btn active">1</button>
              <button type="button" className="pagination-btn">2</button>
              <button type="button" className="pagination-btn"><span className="material-symbols-outlined">chevron_right</span></button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
