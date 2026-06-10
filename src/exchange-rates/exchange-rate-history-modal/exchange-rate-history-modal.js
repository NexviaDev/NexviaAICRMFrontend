import { useCallback, useEffect, useMemo, useState } from 'react';
import { API_BASE } from '@/config';
import { getCurrencyFlagSources } from '../exchange-rate-flags';
import ExchangeRateLineChart from '../exchange-rate-line-chart';
import { RATE_PERIODS } from '../exchange-rate-chart-params.js';
import './exchange-rate-history-modal.css';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function formatKrwNumber(value) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
}

function formatFetchedAt(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return '—';
  }
}

function CurrencyFlagSmall({ code, country }) {
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

function ExchangeRateHistoryModal({ catalogId, period, onClose, onPeriodChange }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadHistory = useCallback(async () => {
    if (!catalogId) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(
        `${API_BASE}/exchange-rates/history/${encodeURIComponent(catalogId)}?period=${encodeURIComponent(period)}`,
        { headers: getAuthHeader(), credentials: 'include' }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setData(null);
        setError(json.error || '환율 이력을 불러오지 못했습니다.');
        return;
      }
      setData(json);
    } catch {
      setData(null);
      setError('서버에 연결할 수 없습니다.');
    } finally {
      setLoading(false);
    }
  }, [catalogId, period]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const stats = useMemo(() => {
    const pts = (data?.points || []).filter((p) => Number.isFinite(Number(p.value)));
    if (!pts.length) return null;
    const values = pts.map((p) => Number(p.value));
    const latest = values[values.length - 1];
    const earliest = values[0];
    const min = Math.min(...values);
    const max = Math.max(...values);
    return { latest, earliest, min, max };
  }, [data]);

  const periodLabel = RATE_PERIODS.find((p) => p.id === period)?.label || period;

  return (
    <div className="er-history-overlay" role="presentation">
      <div className="er-history-panel" role="dialog" aria-modal="true" aria-labelledby="er-history-title">
        <header className="er-history-head">
          <div className="er-history-title-wrap">
            <h2 id="er-history-title" className="er-history-title">
              <CurrencyFlagSmall code={data?.code || catalogId} country={data?.country || ''} />
              <span>
                {data?.country || catalogId} {data?.code || catalogId} 환율 추이
              </span>
            </h2>
            <p className="er-history-sub">
              매매기준율(KRW) · {periodLabel} · KST 기준 · 같은 날 5분 갱신 시 해당 일자 데이터가
              갱신되고, 날짜가 바뀌면 이력에 누적됩니다.
            </p>
          </div>
          <button type="button" className="er-history-close" onClick={onClose} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>

        <div className="er-history-body">
          <div className="er-history-period-tabs" role="tablist" aria-label="기간 단위">
            {RATE_PERIODS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={period === item.id}
                className={`er-history-period-btn${period === item.id ? ' is-active' : ''}`}
                onClick={() => onPeriodChange(item.id)}
                disabled={loading && period === item.id}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="er-history-meta">
            <span>
              데이터 <strong>{data?.pointCount ?? 0}</strong>건
            </span>
            <span>
              최종 갱신 <strong>{formatFetchedAt(data?.updatedAt)}</strong>
            </span>
            {data?.label && data.label !== data?.code ? <span>단위 {data.label}</span> : null}
          </div>

          {loading ? (
            <div className="er-history-loading" role="status">
              그래프 불러오는 중…
            </div>
          ) : error ? (
            <div className="er-history-error" role="alert">
              {error}
            </div>
          ) : (
            <>
              <ExchangeRateLineChart points={data?.points || []} />
              {stats ? (
                <div className="er-history-stats" aria-label="환율 요약">
                  <div className="er-history-stat">
                    <span className="er-history-stat-label">최신</span>
                    <span className="er-history-stat-value">{formatKrwNumber(stats.latest)}</span>
                  </div>
                  <div className="er-history-stat">
                    <span className="er-history-stat-label">기간 최저</span>
                    <span className="er-history-stat-value">{formatKrwNumber(stats.min)}</span>
                  </div>
                  <div className="er-history-stat">
                    <span className="er-history-stat-label">기간 최고</span>
                    <span className="er-history-stat-value">{formatKrwNumber(stats.max)}</span>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>

        <footer className="er-history-foot">
          <button type="button" className="er-history-btn-close" onClick={onClose}>
            <span className="material-symbols-outlined">close</span>
            닫기
          </button>
        </footer>
      </div>
    </div>
  );
}

export default ExchangeRateHistoryModal;
