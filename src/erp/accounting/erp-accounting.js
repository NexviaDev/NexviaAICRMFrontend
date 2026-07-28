import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import ListPaginationButtons from '@/components/list-pagination-buttons/list-pagination-buttons';
import PageHeaderNotifyChat from '@/components/page-header-notify-chat/page-header-notify-chat';
import { fetchErpPermissions } from '@/lib/erp-master-api';
import {
  fetchAccounts,
  seedAccounts,
  fetchPeriods,
  createPeriod,
  closePeriod,
  fetchJournals
} from '@/lib/erp-accounting-api';
import './erp-accounting.css';

const LIMIT = 20;
const TABS = [
  { key: 'journals', label: '전표' },
  { key: 'accounts', label: '계정과목' },
  { key: 'periods', label: '회계기간' }
];

function formatDate(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function ErpAccounting() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('view') || 'journals';
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: LIMIT, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [permissions, setPermissions] = useState([]);
  const [busy, setBusy] = useState(false);
  const [periodForm, setPeriodForm] = useState({ startDate: '', endDate: '', name: '' });
  const reqRef = useRef(0);

  const canWrite = permissions.includes('accounting.write');
  const canClose = permissions.includes('accounting.close');

  useEffect(() => {
    fetchErpPermissions()
      .then((d) => setPermissions(Array.isArray(d.permissions) ? d.permissions : []))
      .catch(() => setPermissions([]));
  }, []);

  const loadList = useCallback(async () => {
    const id = ++reqRef.current;
    setLoading(true);
    setError('');
    try {
      let data;
      if (tab === 'accounts') data = await fetchAccounts({ page, limit: LIMIT });
      else if (tab === 'periods') data = await fetchPeriods({ page, limit: LIMIT });
      else data = await fetchJournals({ page, limit: LIMIT });
      if (id !== reqRef.current) return;
      setRows(Array.isArray(data.items) ? data.items : []);
      setPagination(data.pagination || { page: 1, limit: LIMIT, total: 0, totalPages: 1 });
    } catch (err) {
      if (id !== reqRef.current) return;
      setRows([]);
      setError(err.message || '목록을 불러오지 못했습니다.');
    } finally {
      if (id === reqRef.current) setLoading(false);
    }
  }, [tab, page]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  function patchParams(mutator) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        mutator(next);
        return next;
      },
      { replace: true }
    );
  }

  async function handleSeed() {
    setBusy(true);
    setError('');
    try {
      await seedAccounts();
      await loadList();
    } catch (err) {
      setError(err.message || '기본 계정 생성 실패');
    } finally {
      setBusy(false);
    }
  }

  async function handleCreatePeriod(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await createPeriod(periodForm);
      setPeriodForm({ startDate: '', endDate: '', name: '' });
      await loadList();
    } catch (err) {
      setError(err.message || '기간 등록 실패');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page erp-accounting-page">
      <header className="page-header">
        <div className="erp-accounting-header-text">
          <h1 className="erp-accounting-title">회계</h1>
          <p className="page-desc">
            복식부기 전표·계정과목·회계기간. 매출/매입/수금/지급 확정 시 열린 기간이 있으면 자동분개됩니다.
          </p>
        </div>
        <PageHeaderNotifyChat />
      </header>

      <div className="page-content">
      <div className="erp-accounting-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`erp-accounting-tab${t.key === tab ? ' is-active' : ''}`}
            onClick={() =>
              patchParams((n) => {
                n.set('view', t.key);
                n.delete('page');
              })
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {canWrite && tab === 'accounts' ? (
        <button type="button" className="erp-accounting-primary" disabled={busy} onClick={handleSeed}>
          기본 계정과목 생성
        </button>
      ) : null}

      {canWrite && tab === 'periods' ? (
        <form className="erp-accounting-form" onSubmit={handleCreatePeriod}>
          <input
            type="date"
            required
            value={periodForm.startDate}
            onChange={(e) => setPeriodForm((f) => ({ ...f, startDate: e.target.value }))}
          />
          <input
            type="date"
            required
            value={periodForm.endDate}
            onChange={(e) => setPeriodForm((f) => ({ ...f, endDate: e.target.value }))}
          />
          <input
            type="text"
            placeholder="기간명 (선택)"
            value={periodForm.name}
            onChange={(e) => setPeriodForm((f) => ({ ...f, name: e.target.value }))}
          />
          <button type="submit" className="erp-accounting-primary" disabled={busy}>
            기간 등록
          </button>
        </form>
      ) : null}

      {error ? <p className="erp-accounting-error">{error}</p> : null}

      <div className="erp-accounting-table-wrap">
        {loading ? (
          <p className="erp-accounting-muted">불러오는 중…</p>
        ) : rows.length === 0 ? (
          <p className="erp-accounting-muted">데이터가 없습니다.</p>
        ) : (
          <table className="erp-accounting-table">
            <thead>
              <tr>
                {tab === 'journals' ? (
                  <>
                    <th>전표번호</th>
                    <th>일자</th>
                    <th>상태</th>
                    <th>적요</th>
                    <th>차변</th>
                    <th>대변</th>
                    <th>원천</th>
                  </>
                ) : null}
                {tab === 'accounts' ? (
                  <>
                    <th>코드</th>
                    <th>계정명</th>
                    <th>구분</th>
                    <th>잔액방향</th>
                    <th>상태</th>
                  </>
                ) : null}
                {tab === 'periods' ? (
                  <>
                    <th>코드</th>
                    <th>이름</th>
                    <th>시작</th>
                    <th>종료</th>
                    <th>상태</th>
                    <th>작업</th>
                  </>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row._id}>
                  {tab === 'journals' ? (
                    <>
                      <td>{row.code}</td>
                      <td>{formatDate(row.entryDate)}</td>
                      <td>{row.status}</td>
                      <td>{row.description || '-'}</td>
                      <td>{row.debitTotal}</td>
                      <td>{row.creditTotal}</td>
                      <td>
                        {row.sourceType}
                        {row.sourceCode ? ` · ${row.sourceCode}` : ''}
                      </td>
                    </>
                  ) : null}
                  {tab === 'accounts' ? (
                    <>
                      <td>{row.code}</td>
                      <td>{row.name}</td>
                      <td>{row.accountType}</td>
                      <td>{row.normalBalance}</td>
                      <td>{row.status}</td>
                    </>
                  ) : null}
                  {tab === 'periods' ? (
                    <>
                      <td>{row.code}</td>
                      <td>{row.name}</td>
                      <td>{formatDate(row.startDate)}</td>
                      <td>{formatDate(row.endDate)}</td>
                      <td>{row.status === 'open' ? '개설' : '마감'}</td>
                      <td>
                        {canClose && row.status === 'open' ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={async () => {
                              setBusy(true);
                              try {
                                await closePeriod(row._id);
                                await loadList();
                              } catch (err) {
                                setError(err.message || '마감 실패');
                              } finally {
                                setBusy(false);
                              }
                            }}
                          >
                            마감
                          </button>
                        ) : (
                          '-'
                        )}
                      </td>
                    </>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <ListPaginationButtons
        page={pagination.page}
        totalPages={pagination.totalPages}
        onPageChange={(nextPage) => {
          patchParams((n) => {
            if (nextPage <= 1) n.delete('page');
            else n.set('page', String(nextPage));
          });
        }}
      />
      </div>
    </div>
  );
}
