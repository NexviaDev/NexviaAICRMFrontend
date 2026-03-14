import { useState, useEffect } from 'react';
import './sales-report.css';

import { API_BASE } from '@/config';

export default function SalesReport() {
  const [data, setData] = useState(null);

  useEffect(() => {
    let c = false;
    fetch(`${API_BASE}/reports/sales`)
      .then((r) => r.ok ? r.json() : {})
      .then((d) => { if (!c) setData(d); })
      .catch(() => { if (!c) setData({}); });
    return () => { c = true; };
  }, []);

  const totalSales = data?.totalSales ?? 1240000;
  const conversionRate = data?.conversionRate ?? 24.5;
  const avgDeal = data?.avgDealValue ?? 8500;
  const yearly = data?.yearlyTrend ?? [320, 380, 420, 480, 520];
  const quarterly = data?.quarterly ?? [
    { label: 'Q1 2024', percent: 85 },
    { label: 'Q2 2024', percent: 92 },
    { label: 'Q3 2024', percent: 78 },
    { label: 'Q4 2024', percent: 65 }
  ];

  return (
    <div className="page sales-report-page">
      <header className="page-header">
        <div className="header-search">
          <span className="material-symbols-outlined">search</span>
          <input type="text" placeholder="판매, 고객, 리포트 검색..." />
        </div>
        <div className="header-actions">
          <button type="button" className="icon-btn"><span className="material-symbols-outlined">notifications</span></button>
        </div>
      </header>

      <div className="page-content">
        <div className="report-top">
          <div>
            <h1>판매 현황</h1>
            <p className="page-desc">매출 및 전환 추이를 실시간으로 확인합니다.</p>
          </div>
          <button type="button" className="btn-primary"><span className="material-symbols-outlined">add_circle</span> 판매 등록</button>
        </div>

        <div className="metrics-row">
          <div className="metric-card">
            <div className="metric-head">
              <span className="metric-icon"><span className="material-symbols-outlined">payments</span></span>
              <span className="metric-trend up"><span className="material-symbols-outlined">trending_up</span> +12.3%</span>
            </div>
            <p className="metric-label">총 매출</p>
            <p className="metric-value">${(totalSales / 1000).toFixed(0)},000</p>
          </div>
          <div className="metric-card">
            <div className="metric-head">
              <span className="metric-icon"><span className="material-symbols-outlined">conversion_path</span></span>
              <span className="metric-trend up"><span className="material-symbols-outlined">trending_up</span> +2.1%</span>
            </div>
            <p className="metric-label">전환율</p>
            <p className="metric-value">{conversionRate}%</p>
          </div>
          <div className="metric-card">
            <div className="metric-head">
              <span className="metric-icon"><span className="material-symbols-outlined">receipt_long</span></span>
              <span className="metric-trend down"><span className="material-symbols-outlined">trending_down</span> -1.5%</span>
            </div>
            <p className="metric-label">평균 거래 금액</p>
            <p className="metric-value">${avgDeal.toLocaleString()}</p>
          </div>
        </div>

        <div className="charts-row">
          <div className="panel chart-panel">
            <div className="panel-head">
              <h3>연도별 매출 추이</h3>
              <select className="chart-select"><option>최근 5년</option></select>
            </div>
            <div className="yearly-bars">
              {yearly.map((h, i) => (
                <div key={i} className="yearly-col">
                  <div className="yearly-bar-wrap">
                    <div className="yearly-bar" style={{ height: (h / 600) * 100 + '%' }} />
                  </div>
                  <span>{2020 + i}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="panel chart-panel">
            <div className="panel-head">
              <h3>분기별 실적</h3>
              <div className="legend">
                <span><i className="dot primary" /> 목표</span>
                <span><i className="dot blue" /> 실적</span>
              </div>
            </div>
            <div className="quarterly-bars">
              {quarterly.map((q) => (
                <div key={q.label} className="quarterly-item">
                  <div className="quarterly-label">
                    <span>{q.label}</span>
                    <span>목표의 {q.percent}%</span>
                  </div>
                  <div className="quarterly-bar-wrap">
                    <div className="quarterly-bar" style={{ width: q.percent + '%' }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="panel table-panel">
          <div className="panel-head">
            <h3>최근 거래 내역</h3>
            <button type="button" className="link-btn">전체 보기</button>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>거래 ID</th>
                  <th>고객명</th>
                  <th>상품 / 딜</th>
                  <th>금액</th>
                  <th>일자</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { id: '#TX-9402', name: 'Alex Kim', product: 'Enterprise SaaS Annual', amount: '$12,400', date: 'Oct 24, 2024', status: 'Completed' },
                  { id: '#TX-9391', name: 'Sarah Lee', product: 'Cloud Storage Expansion', amount: '$3,200', date: 'Oct 23, 2024', status: 'Pending' },
                  { id: '#TX-9388', name: 'John Doe', product: 'Consulting Services (Q4)', amount: '$5,000', date: 'Oct 22, 2024', status: 'Completed' }
                ].map((row) => (
                  <tr key={row.id}>
                    <td className="font-medium">{row.id}</td>
                    <td><div className="cell-user"><span className="avatar-initials">{row.name.split(' ').map((n) => n[0]).join('')}</span>{row.name}</div></td>
                    <td className="text-muted">{row.product}</td>
                    <td className="font-bold">{row.amount}</td>
                    <td className="text-muted">{row.date}</td>
                    <td><span className={`status-badge status-${row.status.toLowerCase()}`}>{row.status === 'Completed' ? '완료' : row.status === 'Pending' ? '대기' : row.status === 'Cancelled' ? '취소' : row.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
