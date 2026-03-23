import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import './employee-work-report.css';

import { API_BASE } from '@/config';

const activities = [
  { date: '2023.10.24', time: '09:30', title: '고객 Q4 전략 회의', sub: '준비 및 발표', category: 'Meeting', duration: '1시간 45분', status: 'Completed' },
  { date: '2023.10.24', time: '11:15', title: '리드 검토', sub: '신규 15건 연락', category: 'Sales', duration: '2시간 30분', status: 'Completed' },
  { date: '2023.10.23', time: '14:00', title: '월간 경비 보고', sub: '청구 및 내부 검토', category: 'Admin', duration: '1시간', status: 'In Progress' },
  { date: '2023.10.23', time: '16:30', title: 'Smith & Co 후속', sub: '데모 후 제안서 발송', category: 'Sales', duration: '45분', status: 'Pending' },
  { date: '2023.10.22', time: '10:00', title: '팀 주간 동기화', sub: '주간 목표 정렬', category: 'Meeting', duration: '30분', status: 'Completed' }
];

const categoryClass = { Meeting: 'cat-meeting', Sales: 'cat-sales', Admin: 'cat-admin' };
const statusDot = { Completed: 'green', 'In Progress': 'orange', Pending: 'gray' };

export default function EmployeeWorkReport() {
  const navigate = useNavigate();
  const { employeeId } = useParams();
  const [data, setData] = useState(null);

  useEffect(() => {
    let c = false;
    const id = employeeId || 'default';
    fetch(`${API_BASE}/reports/work-report/${id}`)
      .then((r) => r.ok ? r.json() : {})
      .then((d) => { if (!c) setData(d); })
      .catch(() => { if (!c) setData({}); });
    return () => { c = true; };
  }, [employeeId]);

  const emp = data?.employee ?? {
    name: 'Alex Johnson',
    title: '시니어 영업 담당',
    email: 'alex.j@company.com',
    location: '뉴욕 오피스',
    hoursLogged: 164.5,
    tasksDone: 42,
    completionRate: 98
  };

  const workload = data?.workload ?? { sales: 60, meetings: 25, admin: 15 };
  const rating = data?.efficiencyRating ?? 9.2;

  return (
    <div className="page work-report-page">
      <header className="page-header work-report-header">
        <h2>직원 업무 보고</h2>
        <div className="header-search">
          <span className="material-symbols-outlined">search</span>
          <input type="text" placeholder="직원 검색..." />
        </div>
        <div className="header-actions">
          <div className="date-picker">
            <span className="material-symbols-outlined">calendar_month</span>
            <span>2023.10.01 - 2023.10.31</span>
            <span className="material-symbols-outlined">expand_more</span>
          </div>
          <button type="button" className="icon-btn" aria-label="공지사항" onClick={() => navigate('/notification')}><span className="material-symbols-outlined">notifications</span></button>
          <button type="button" className="icon-btn" aria-label="채팅" onClick={() => navigate('/chat')}><span className="material-symbols-outlined">chat_bubble</span></button>
          <button type="button" className="icon-btn"><span className="material-symbols-outlined">download</span></button>
        </div>
      </header>

      <div className="page-content">
        <div className="employee-summary panel">
          <div className="employee-profile">
            <div className="employee-avatar-wrap">
              <div className="employee-avatar" />
              <span className="status-dot green" />
            </div>
            <div className="employee-info">
              <h3>{emp.name}</h3>
              <p className="employee-title">{emp.title}</p>
              <div className="employee-meta">
                <span><span className="material-symbols-outlined">mail</span> {emp.email}</span>
                <span><span className="material-symbols-outlined">location_on</span> {emp.location}</span>
              </div>
            </div>
          </div>
          <div className="employee-stats">
            <div className="stat-box">
              <p className="stat-box-label">근무 시간</p>
              <p className="stat-box-value">{emp.hoursLogged}</p>
              <p className="stat-box-meta up"><span className="material-symbols-outlined">trending_up</span> 전월 대비 12%</p>
            </div>
            <div className="stat-box">
              <p className="stat-box-label">완료 업무</p>
              <p className="stat-box-value">{emp.tasksDone}</p>
              <p className="stat-box-meta"><span className="material-symbols-outlined">check_circle</span> 완료율 {emp.completionRate}%</p>
            </div>
          </div>
        </div>

        <div className="panel table-panel">
          <div className="panel-head">
            <h4>활동 타임라인</h4>
            <select className="chart-select"><option>전체 카테고리</option><option>영업</option><option>회의</option><option>관리</option></select>
          </div>
          <div className="table-wrap">
            <table className="data-table activity-table">
              <thead>
                <tr>
                  <th>일시</th>
                  <th>업무 제목</th>
                  <th>카테고리</th>
                  <th>소요 시간</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {activities.map((a, i) => (
                  <tr key={i}>
                    <td>
                      <div className="date-cell">
                        <span className="date-main">{a.date}</span>
                        <span className="date-sub">{a.time}</span>
                      </div>
                    </td>
                    <td>
                      <p className="task-title">{a.title}</p>
                      <p className="task-sub">{a.sub}</p>
                    </td>
                    <td><span className={`category-badge ${categoryClass[a.category] || ''}`}>{a.category === 'Meeting' ? '회의' : a.category === 'Sales' ? '영업' : a.category === 'Admin' ? '관리' : a.category}</span></td>
                    <td>{a.duration}</td>
                    <td>
                      <div className="status-cell">
                        <span className={`status-dot ${statusDot[a.status] || 'gray'}`} />
                        <span>{a.status === 'Completed' ? '완료' : a.status === 'In Progress' ? '진행 중' : a.status === 'Pending' ? '대기' : a.status}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pagination-bar">
            <p className="pagination-info">업무 42건 중 5건 표시</p>
            <div className="pagination-btns">
              <button type="button" className="pagination-btn small">이전</button>
              <button type="button" className="pagination-btn small active">1</button>
              <button type="button" className="pagination-btn small">2</button>
              <button type="button" className="pagination-btn small">다음</button>
            </div>
          </div>
        </div>

        <div className="insights-grid">
          <div className="panel workload-panel">
            <div className="panel-head">
              <h4>업무 부하 분포</h4>
              <span className="material-symbols-outlined text-muted">info</span>
            </div>
            <div className="workload-bars">
              <div className="workload-item">
                <div className="workload-label"><span>영업·파이프라인</span><span className="font-bold">{workload.sales}%</span></div>
                <div className="workload-bar-wrap"><div className="workload-bar primary" style={{ width: workload.sales + '%' }} /></div>
              </div>
              <div className="workload-item">
                <div className="workload-label"><span>회의·동기화</span><span className="font-bold">25%</span></div>
                <div className="workload-bar-wrap"><div className="workload-bar blue" style={{ width: (workload.meetings ?? 25) + '%' }} /></div>
              </div>
              <div className="workload-item">
                <div className="workload-label"><span>관리 업무</span><span className="font-bold">{workload.admin}%</span></div>
                <div className="workload-bar-wrap"><div className="workload-bar gray" style={{ width: (workload.admin ?? 15) + '%' }} /></div>
              </div>
            </div>
          </div>
          <div className="panel rating-panel">
            <h4>효율 점수</h4>
            <p className="rating-desc">업무 완료율과 근무 시간 비율 기준입니다.</p>
            <p className="rating-value">{rating}</p>
            <p className="rating-badge">우수</p>
            <button type="button" className="rating-btn">전체 분석 보기</button>
          </div>
        </div>
      </div>
    </div>
  );
}
