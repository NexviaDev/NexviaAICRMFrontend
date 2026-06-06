import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { API_BASE } from '@/config';
import PageHeaderNotifyChat from '@/components/page-header-notify-chat/page-header-notify-chat';
import ExchangeRateHistoryModal, {
  RATE_CHART_PARAM,
  RATE_PERIOD_PARAM,
  RATE_PERIODS
} from './exchange-rate-history-modal/exchange-rate-history-modal';
import './exchange-rates.css';
import { getCurrencyFlagSources } from './exchange-rate-flags';

function CurrencyFlag({ code, country }) {
  const flag = getCurrencyFlagSources(code);
  if (!flag) return null;
  return (
    <img
      className="exchange-rates-flag-img"
      src={flag.src}
      srcSet={flag.srcSet}
      alt=""
      title={country}
      width={24}
      height={18}
      loading="lazy"
      decoding="async"
    />
  );
}

const AUTO_POLL_MS = 90_000;

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function formatKrwNumber(value) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  return Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
}

function formatUsdRate(value) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  return Number(value).toLocaleString('ko-KR', {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4
  });
}

function formatFetchedAt(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return '—';
  }
}

function formatSearchDate(raw) {
  const s = String(raw || '').replace(/-/g, '').trim();
  if (s.length !== 8) return raw || '—';
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

function RateCell({ value, emphasize = false }) {
  const formatted = formatKrwNumber(value);
  if (formatted == null) {
    return <td className="exchange-rates-td-num">—</td>;
  }
  return (
    <td className={`exchange-rates-td-num${emphasize ? ' exchange-rates-td-deal' : ''}`}>
      {formatted}
    </td>
  );
}

function UsdRateCell({ value }) {
  const formatted = formatUsdRate(value);
  return (
    <td className="exchange-rates-td-num exchange-rates-td-usd">
      {formatted ?? '—'}
    </td>
  );
}

const DEFAULT_RATE_PERIOD = 'daily';

function normalizeRatePeriod(raw) {
  const id = String(raw || DEFAULT_RATE_PERIOD).trim().toLowerCase();
  return RATE_PERIODS.some((p) => p.id === id) ? id : DEFAULT_RATE_PERIOD;
}

export default function ExchangeRates() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const chartCatalogId = String(searchParams.get(RATE_CHART_PARAM) || '').trim().toUpperCase();
  const chartPeriod = normalizeRatePeriod(searchParams.get(RATE_PERIOD_PARAM));
  const isChartOpen = Boolean(chartCatalogId);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/exchange-rates/latest`, {
        headers: getAuthHeader(),
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const hasRows = Array.isArray(data.rows) && data.rows.some((r) => r.available);
        setRows(Array.isArray(data.rows) ? data.rows : []);
        setMeta(data);
        if (!hasRows) {
          setError(data.error || '환율을 불러오지 못했습니다.');
        }
        return;
      }
      setRows(Array.isArray(data.rows) ? data.rows : []);
      setMeta(data);
      if (data.notice) setError('');
    } catch {
      if (!silent) setError('서버에 연결할 수 없습니다.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
    const timer = setInterval(() => void load(true), AUTO_POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const openChart = useCallback(
    (row) => {
      if (!row?.id) return;
      const next = new URLSearchParams(searchParams);
      next.set(RATE_CHART_PARAM, row.id);
      if (!next.get(RATE_PERIOD_PARAM)) next.set(RATE_PERIOD_PARAM, DEFAULT_RATE_PERIOD);
      setSearchParams(next);
    },
    [searchParams, setSearchParams]
  );

  const closeChart = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete(RATE_CHART_PARAM);
    next.delete(RATE_PERIOD_PARAM);
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const changeChartPeriod = useCallback(
    (periodId) => {
      if (!chartCatalogId) return;
      const next = new URLSearchParams(searchParams);
      next.set(RATE_CHART_PARAM, chartCatalogId);
      next.set(RATE_PERIOD_PARAM, periodId);
      setSearchParams(next, { replace: true });
    },
    [chartCatalogId, searchParams, setSearchParams]
  );

  const usdSummary = meta?.usdSummary || null;
  const availableCount = meta?.availableCount ?? rows.filter((r) => r.available).length;
  const totalCount = meta?.totalCount ?? rows.length;

  return (
    <div className="exchange-rates-page">
      <PageHeaderNotifyChat title="환율" />
      <div className="page-content exchange-rates-content">
        <div className="exchange-rates-board">
          <div className="exchange-rates-board-head">
            <div className="exchange-rates-board-title-wrap">
              <h2 className="exchange-rates-board-title">환전 고시 환율</h2>
              <p className="exchange-rates-board-sub">
                ExchangeRate-API · 기준일 {formatSearchDate(meta?.searchDate)} · 수집{' '}
                {formatFetchedAt(meta?.fetchedAt)} ({availableCount}/{totalCount})
                {meta?.scheduleNote ? ` · ${meta.scheduleNote}` : ''}
              </p>
            </div>

            <div className="exchange-rates-summary-box" aria-label="USD 환율 요약">
              <table className="exchange-rates-summary-table">
                <thead>
                  <tr>
                    <th scope="col">환율</th>
                    <th scope="col">발주환율</th>
                    <th scope="col">RPI환율</th>
                    <th scope="col">소비자가</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="exchange-rates-summary-label">USD</td>
                    <td>{formatKrwNumber(usdSummary?.orderRate) ?? '—'}</td>
                    <td>{formatKrwNumber(usdSummary?.rpiRate) ?? '—'}</td>
                    <td>{formatKrwNumber(usdSummary?.consumerRate) ?? '—'}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {meta?.notice ? (
            <div className="exchange-rates-info" role="status">
              {meta.notice}
            </div>
          ) : null}

          {error ? (
            <div className="exchange-rates-alert" role="alert">
              {error}
              {!meta?.configured ? (
                <p className="exchange-rates-alert-sub">
                  서버에 <code>EXCHANGERATE_API_KEY</code>를 설정하면 자동 수집·표시됩니다.
                </p>
              ) : null}
            </div>
          ) : null}

          {meta?.providerNote ? <p className="exchange-rates-note">{meta.providerNote}</p> : null}

          <div className="exchange-rates-table-wrap">
            <table className="exchange-rates-table">
              <thead>
                <tr className="exchange-rates-head-row-1">
                  <th rowSpan={2} scope="col" className="exchange-rates-th-currency">
                    통화명
                  </th>
                  <th rowSpan={2} scope="col" className="exchange-rates-th-num">
                    매매기준율
                  </th>
                  <th colSpan={2} scope="colgroup" className="exchange-rates-th-group">
                    송금
                  </th>
                  <th rowSpan={2} scope="col" className="exchange-rates-th-num">
                    미화환산율
                  </th>
                </tr>
                <tr className="exchange-rates-head-row-2">
                  <th scope="col" className="exchange-rates-th-sub exchange-rates-th-num">
                    보내실 때
                  </th>
                  <th scope="col" className="exchange-rates-th-sub exchange-rates-th-num">
                    받으실 때
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading && rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="exchange-rates-empty">
                      불러오는 중…
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr
                      key={row.id}
                      className={`exchange-rates-row${row.available ? '' : ' exchange-rates-row--missing'}${
                        chartCatalogId === row.id ? ' exchange-rates-row--active' : ''
                      }`}
                      onClick={() => openChart(row)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openChart(row);
                        }
                      }}
                      tabIndex={0}
                      role="button"
                      aria-label={`${row.country} ${row.code} 환율 추이 그래프 보기`}
                    >
                      <td className="exchange-rates-td-currency">
                        <span className="exchange-rates-currency-cell">
                          <CurrencyFlag code={row.code} country={row.country} />
                          <span className="exchange-rates-currency-link">
                            {row.country} {row.code}
                          </span>
                        </span>
                        {row.label && row.label !== row.code ? (
                          <span className="exchange-rates-unit-note"> ({row.label})</span>
                        ) : null}
                      </td>
                      <RateCell value={row.dealBasR} emphasize />
                      <RateCell value={row.tts} />
                      <RateCell value={row.ttb} />
                      <UsdRateCell value={row.usdRate} />
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {isChartOpen ? (
        <ExchangeRateHistoryModal
          catalogId={chartCatalogId}
          period={chartPeriod}
          onClose={closeChart}
          onPeriodChange={changeChartPeriod}
        />
      ) : null}
    </div>
  );
}
