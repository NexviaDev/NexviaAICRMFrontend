import { useCallback, useEffect, useState } from 'react';
import {
  fetchArAging,
  fetchSalesPicker,
  formatMoneyDisplay,
  formatDateDisplay,
  toDateInputValue
} from '@/lib/erp-sales-api';
import './erp-ar-aging.css';

/**
 * 매출채권 연령(aging) 화면.
 * 통화가 섞이면 합산이 무의미하므로 서버가 통화별로 나눠 집계한 결과를 그대로 표시합니다.
 * 금액은 문자열(Decimal)이므로 Number 변환 없이 표시 포맷만 합니다.
 */
export default function ErpArAging() {
  const [asOf, setAsOf] = useState(() => toDateInputValue(new Date()));
  const [partnerId, setPartnerId] = useState('');
  const [currency, setCurrency] = useState('');

  const [partners, setPartners] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchSalesPicker('business-partners')
      .then((items) => {
        if (!cancelled) setPartners(items);
      })
      .catch(() => {
        if (!cancelled) setPartners([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await fetchArAging({ asOf, partnerId, currency: currency.trim().toUpperCase() }));
    } catch (err) {
      setData(null);
      setError(err.message || '채권 연령을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [asOf, partnerId, currency]);

  useEffect(() => {
    void load();
  }, [load]);

  const buckets = data?.buckets || [];
  const columnCount = buckets.length + 2;

  return (
    <div className="erp-aging">
      <div className="erp-aging-toolbar">
        <label className="erp-aging-control">
          <span>기준일</span>
          <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </label>
        <label className="erp-aging-control">
          <span>거래처</span>
          <select value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
            <option value="">전체</option>
            {partners.map((partner) => (
              <option key={partner._id} value={partner._id}>
                {partner.code} · {partner.name}
              </option>
            ))}
          </select>
        </label>
        <label className="erp-aging-control">
          <span>통화</span>
          <input
            type="text"
            autoComplete="off"
            placeholder="전체"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          />
        </label>
        <button type="button" className="btn-outline" disabled={loading} onClick={() => load()}>
          {loading ? <span className="erp-spinner" aria-hidden /> : (
            <span className="material-symbols-outlined">refresh</span>
          )}
          다시 계산
        </button>
      </div>

      {error ? (
        <p className="erp-aging-error" role="alert">
          {error}
        </p>
      ) : null}

      {data?.truncated ? (
        <p className="erp-aging-notice">
          {data.notice || '미수 문서가 많아 일부만 집계했습니다. 거래처·통화 조건을 좁혀 주세요.'}
        </p>
      ) : null}

      {data ? (
        <p className="erp-aging-asof">
          {formatDateDisplay(data.asOf)} 기준 · 미수 매출 {data.invoiceCount || 0}건
        </p>
      ) : null}

      <div className="panel">
        <div className="erp-aging-panel-head">
          <h2>통화별 합계</h2>
        </div>
        <div className="table-wrap">
          <table className="data-table erp-aging-table">
            <thead>
              <tr>
                <th>통화</th>
                {buckets.map((bucket) => (
                  <th key={bucket.key} className="is-right">
                    {bucket.label}
                  </th>
                ))}
                <th className="is-right">합계</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={columnCount} className="text-center erp-aging-state">
                    <span className="erp-spinner erp-spinner--dark" aria-hidden />
                    불러오는 중입니다…
                  </td>
                </tr>
              ) : !data || (data.byCurrency || []).length === 0 ? (
                <tr>
                  <td colSpan={columnCount} className="text-center erp-aging-state">
                    미수 채권이 없습니다.
                  </td>
                </tr>
              ) : (
                data.byCurrency.map((row) => (
                  <tr key={row.currency}>
                    <td>{row.currency}</td>
                    {buckets.map((bucket) => (
                      <td key={bucket.key} className="is-right">
                        {formatMoneyDisplay(row[bucket.key])}
                      </td>
                    ))}
                    <td className="is-right erp-aging-total">{formatMoneyDisplay(row.total, row.currency)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <div className="erp-aging-panel-head">
          <h2>거래처별 채권</h2>
        </div>
        <div className="table-wrap">
          <table className="data-table erp-aging-table">
            <thead>
              <tr>
                <th>거래처</th>
                <th>통화</th>
                {buckets.map((bucket) => (
                  <th key={bucket.key} className="is-right">
                    {bucket.label}
                  </th>
                ))}
                <th className="is-right">합계</th>
                <th className="is-right">최장 연체</th>
                <th className="is-right">건수</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={buckets.length + 5} className="text-center erp-aging-state">
                    <span className="erp-spinner erp-spinner--dark" aria-hidden />
                    불러오는 중입니다…
                  </td>
                </tr>
              ) : !data || (data.partners || []).length === 0 ? (
                <tr>
                  <td colSpan={buckets.length + 5} className="text-center erp-aging-state">
                    조건에 맞는 미수 채권이 없습니다.
                  </td>
                </tr>
              ) : (
                data.partners.map((row) => (
                  <tr key={`${row.partnerId}-${row.currency}`}>
                    <td>{row.partnerName || '-'}</td>
                    <td>{row.currency}</td>
                    {buckets.map((bucket) => (
                      <td key={bucket.key} className="is-right">
                        {formatMoneyDisplay(row[bucket.key])}
                      </td>
                    ))}
                    <td className="is-right erp-aging-total">{formatMoneyDisplay(row.total, row.currency)}</td>
                    <td className="is-right">
                      {row.oldestOverdueDays > 0 ? (
                        <span className="erp-aging-overdue">{row.oldestOverdueDays}일 연체</span>
                      ) : (
                        <span className="erp-aging-ontime">미도래</span>
                      )}
                    </td>
                    <td className="is-right">{row.invoiceCount}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
