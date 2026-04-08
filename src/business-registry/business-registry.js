import { useMemo, useState } from 'react';
import { API_BASE } from '@/config';
import './business-registry.css';

function normalizeBusinessNumber(raw) {
  const s = String(raw || '').replace(/\D/g, '').slice(0, 10);
  if (s.length <= 3) return s;
  if (s.length <= 5) return `${s.slice(0, 3)}-${s.slice(3)}`;
  return `${s.slice(0, 3)}-${s.slice(3, 5)}-${s.slice(5, 10)}`;
}

function toBusinessNumberDigits(raw) {
  return String(raw || '').replace(/\D/g, '').slice(0, 10);
}

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function BusinessRegistryPage() {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [rows, setRows] = useState([]);

  const candidateNumbers = useMemo(() => {
    const parts = String(input || '')
      .split(/[\n,\s;]+/)
      .map((v) => toBusinessNumberDigits(v))
      .filter((v) => v.length === 10);
    return [...new Set(parts)].slice(0, 100);
  }, [input]);

  const runLookup = async () => {
    if (!candidateNumbers.length) {
      setError('사업자번호 10자리를 1개 이상 입력해 주세요.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/business-registry/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ b_no: candidateNumbers })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '사업자 상태를 조회하지 못했습니다.');
      setRows(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      setRows([]);
      setError(e.message || '사업자 상태를 조회하지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page business-registry-page">
      <header className="page-header">
        <h1>사업자 상태 조회</h1>
      </header>
      <div className="page-content">
        <section className="business-registry-card">
          <p className="business-registry-desc">
            국세청 사업자등록 상태조회 API를 통해 사업자번호의 운영 상태(계속·휴업·폐업)와 과세유형을 확인합니다.
            한 번에 최대 100개까지 조회할 수 있습니다.
          </p>
          <label className="business-registry-label" htmlFor="business-registry-input">
            사업자번호 입력 (줄바꿈, 쉼표 구분)
          </label>
          <textarea
            id="business-registry-input"
            className="business-registry-input"
            rows={5}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={'예)\n2208162517\n1058765432, 123-45-67890'}
          />
          <div className="business-registry-meta">
            유효 번호 {candidateNumbers.length}건
          </div>
          <div className="business-registry-actions">
            <button
              type="button"
              className="business-registry-btn"
              onClick={runLookup}
              disabled={loading || candidateNumbers.length === 0}
            >
              {loading ? '조회 중...' : '상태 조회'}
            </button>
          </div>
          {error ? <div className="business-registry-error">{error}</div> : null}
        </section>

        <section className="business-registry-card">
          <h2 className="business-registry-table-title">조회 결과</h2>
          {rows.length === 0 ? (
            <p className="business-registry-empty">{loading ? '조회 중...' : '조회 결과가 없습니다.'}</p>
          ) : (
            <div className="business-registry-table-wrap">
              <table className="business-registry-table">
                <thead>
                  <tr>
                    <th>사업자번호</th>
                    <th>상태</th>
                    <th>과세유형</th>
                    <th>폐업일자</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.businessNumber}>
                      <td>{normalizeBusinessNumber(row.businessNumber)}</td>
                      <td>{row.statusText || '—'}</td>
                      <td>{row.taxType || '—'}</td>
                      <td>{row.closedAt || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

