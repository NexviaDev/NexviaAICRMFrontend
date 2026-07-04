import { useCallback, useEffect, useMemo, useState } from 'react';
import { hasCrmSession, getCrmToken, getCrmAuthHeaders, crmFetchInit, markCrmSessionActive, clearCrmSessionLocal, logoutCrmSession } from '@/lib/crm-auth';
import { useSearchParams } from 'react-router-dom';
import { API_BASE } from '@/config';
import PageHeaderNotifyChat from '@/components/page-header-notify-chat/page-header-notify-chat';
import { getStoredCrmUser, isAdminOrAboveRole } from '@/lib/crm-role-utils';
import ExchangeRateHistoryModal, {
  RATE_CHART_PARAM,
  RATE_PERIOD_PARAM,
  RATE_PERIODS
} from './exchange-rate-history-modal';
import ExchangeRatePricingPanel from './exchange-rate-pricing-panel/exchange-rate-pricing-panel';
import './exchange-rates.css';
import { getCurrencyFlagSources } from './exchange-rate-flags';
import {
  buildFormulaRefColorMaps,
  buildRateFieldToken,
  getFormulaRefPaletteEntry
} from '@/lib/exchange-rate-formula-fields';

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

const AUTO_POLL_MS = 5 * 60 * 1000;

function formatKrwNumber(value) {
  if (value == null || !Number.isFinite(Number(value))) return null;
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

function formatSearchDate(raw) {
  const s = String(raw || '').replace(/-/g, '').trim();
  if (s.length !== 8) return raw || '—';
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

function refHighlightStyle(colorIndex) {
  const entry = getFormulaRefPaletteEntry(colorIndex);
  if (!entry) return undefined;
  return {
    '--er-ref-bg': entry.bg,
    '--er-ref-border': entry.border,
    '--er-ref-accent': entry.accent
  };
}

function RateCell({
  value,
  emphasize = false,
  pickable = false,
  onPick,
  pickTitle,
  refColorIndex = null
}) {
  const formatted = formatKrwNumber(value);
  const refClass =
    refColorIndex != null ? ` exchange-rates-td-ref exchange-rates-td-ref--${refColorIndex}` : '';
  const refStyle = refColorIndex != null ? refHighlightStyle(refColorIndex) : undefined;

  if (formatted == null) {
    return <td className="exchange-rates-td-num">—</td>;
  }
  if (pickable && onPick) {
    return (
      <td
        className={`exchange-rates-td-num exchange-rates-td-pickable${refClass}${
          emphasize ? ' exchange-rates-td-deal' : ''
        }`}
        style={refStyle}
        title={pickTitle}
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onClick={(e) => {
          e.stopPropagation();
          onPick();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            onPick();
          }
        }}
        tabIndex={0}
        role="button"
      >
        {formatted}
      </td>
    );
  }
  return (
    <td
      className={`exchange-rates-td-num${refClass}${emphasize ? ' exchange-rates-td-deal' : ''}`}
      style={refStyle}
    >
      {formatted}
    </td>
  );
}

function hasPerCountryNumericValue(rows, key) {
  return (rows || []).some((row) => {
    const v = row?.[key];
    return v != null && v !== '' && Number.isFinite(Number(v));
  });
}

/** 수출입은행 AP01 통화(행)별 필드만 — RESULT·미화환산율 등 비(非)국가별 항목 제외 */
const EXIM_TABLE_COLUMN_DEFS = [
  { key: 'curUnit', label: '통화코드', title: 'CUR_UNIT', kind: 'code', alwaysShow: true },
  { key: 'curNm', label: '국가/통화명', title: 'CUR_NM', kind: 'text', alwaysShow: true },
  { key: 'dealBasR', label: '매매기준율', title: 'DEAL_BAS_R', kind: 'rate', emphasize: true, alwaysShow: true },
  { key: 'tts', label: '보내실 때', title: 'TTS · 전신환(송금) 보내실 때', kind: 'rate', alwaysShow: true },
  { key: 'ttb', label: '받으실 때', title: 'TTB · 전신환(송금) 받으실 때', kind: 'rate', alwaysShow: true },
  { key: 'bkpr', label: '장부가격', title: 'BKPR', kind: 'rate' },
  { key: 'yyEfeeR', label: '년환가료율', title: 'YY_EFEE_R', kind: 'rate' },
  { key: 'tenDdEfeeR', label: '10일환가료율', title: 'TEN_DD_EFEE_R', kind: 'rate' },
  { key: 'kftcDealBasR', label: '중개 매매기준', title: 'KFTC_DEAL_BAS_R', kind: 'rate' },
  { key: 'kftcBkpr', label: '중개 장부가격', title: 'KFTC_BKPR', kind: 'rate' }
];

function getVisibleEximColumns(rows) {
  return EXIM_TABLE_COLUMN_DEFS.filter(
    (col) => col.alwaysShow || hasPerCountryNumericValue(rows, col.key)
  );
}

function renderEximTableCell(row, col, formulaEditSession, refColorMaps) {
  const rowCode = String(row.code || row.id || '')
    .trim()
    .toUpperCase();
  const cellRefKey = `${rowCode}:${col.key}`;
  const cellRefColor = refColorMaps?.cellColorIndex?.get(cellRefKey) ?? null;
  const rowRefColor =
    col.kind === 'code' ? refColorMaps?.rowColorIndex?.get(rowCode) ?? null : null;

  const pickable =
    formulaEditSession?.editing &&
    col.kind === 'rate' &&
    row?.[col.key] != null &&
    Number.isFinite(Number(row[col.key]));
  const token = pickable ? buildRateFieldToken(row.code || row.id, col.label) : '';
  const onPick = pickable ? () => formulaEditSession.insertToken(token) : undefined;
  const pickTitle = pickable
    ? cellRefColor != null
      ? `${token} · 수식 참조 (클릭 시 삽입)`
      : `${token} 수식에 삽입`
    : undefined;

  if (col.kind === 'code') {
    const codeRefClass =
      rowRefColor != null
        ? ` exchange-rates-td-ref exchange-rates-td-ref--row exchange-rates-td-ref--${rowRefColor}`
        : '';
    return (
      <td
        key={col.key}
        className={`exchange-rates-td-code${codeRefClass}`}
        style={rowRefColor != null ? refHighlightStyle(rowRefColor) : undefined}
      >
        <span className="exchange-rates-currency-cell">
          <CurrencyFlag code={row.code} country={row.country} />
          <span className="exchange-rates-currency-link">{row.curUnit || row.code}</span>
        </span>
      </td>
    );
  }
  if (col.kind === 'text') {
    return (
      <td key={col.key} className="exchange-rates-td-text" title={row.curNm || row.country}>
        {row.curNm || row.country}
        {row.label && row.label !== row.code ? (
          <span className="exchange-rates-unit-note"> ({row.label})</span>
        ) : null}
      </td>
    );
  }
  return (
    <RateCell
      key={col.key}
      value={row[col.key]}
      emphasize={!!col.emphasize}
      pickable={pickable}
      onPick={onPick}
      pickTitle={pickTitle}
      refColorIndex={cellRefColor}
    />
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
  const [formulaEditSession, setFormulaEditSession] = useState(null);

  const chartCatalogId = String(searchParams.get(RATE_CHART_PARAM) || '').trim().toUpperCase();
  const chartPeriod = normalizeRatePeriod(searchParams.get(RATE_PERIOD_PARAM));
  const isChartOpen = Boolean(chartCatalogId);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/exchange-rates/latest`, crmFetchInit());
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

  const pricingProfile = meta?.pricingProfile || null;
  const canEditPricing = isAdminOrAboveRole(getStoredCrmUser()?.role);
  const availableCount = meta?.availableCount ?? rows.filter((r) => r.available).length;
  const totalCount = meta?.totalCount ?? rows.length;
  const displayRows = useMemo(() => rows.filter((row) => row.available !== false), [rows]);
  const visibleColumns = useMemo(() => getVisibleEximColumns(displayRows), [displayRows]);

  const formulaRefColorMaps = useMemo(() => {
    if (!formulaEditSession?.editing) {
      return {
        refColorIndex: new Map(),
        cellColorIndex: new Map(),
        columnColorIndex: new Map(),
        rowColorIndex: new Map()
      };
    }
    return buildFormulaRefColorMaps(formulaEditSession.activeFormula || '');
  }, [formulaEditSession?.editing, formulaEditSession?.activeFormula]);

  return (
    <div className="exchange-rates-page">
      <PageHeaderNotifyChat title="환율" />
      <div className="page-content exchange-rates-content">
        <div className="exchange-rates-board">
          <div className="exchange-rates-board-head">
            <div className="exchange-rates-board-title-wrap">
              <h2 className="exchange-rates-board-title">환전 고시 환율</h2>
              <p className="exchange-rates-board-sub">
                한국수출입은행 · 기준일 {formatSearchDate(meta?.searchDate)} · 수집{' '}
                {formatFetchedAt(meta?.fetchedAt)} ({availableCount}/{totalCount})
                {meta?.scheduleNote ? ` · ${meta.scheduleNote}` : ''}
                {meta?.eximKeyPool?.keyCount > 1
                  ? ` · API키 ${meta.eximKeyPool.activeKeyIndex != null ? meta.eximKeyPool.activeKeyIndex + 1 : '—'}/${meta.eximKeyPool.keyCount} 사용 중`
                  : ''}
              </p>
            </div>

            <ExchangeRatePricingPanel
              rateRows={displayRows}
              initialProfile={pricingProfile}
              canEdit={canEditPricing}
              onSaved={() => void load(true)}
              onEditSessionChange={setFormulaEditSession}
            />
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
                  서버에 <code>KOREAEXIM_AUTH_KEY</code> 또는 <code>KOREAEXIM_AUTH_KEYS</code>를 설정하면
                  자동 수집·표시됩니다. (수출입은행 Open API 현재환율 AP01)
                </p>
              ) : null}
            </div>
          ) : null}

          {meta?.providerNote ? <p className="exchange-rates-note">{meta.providerNote}</p> : null}

          {formulaEditSession?.editing ? (
            <p className="exchange-rates-pick-hint" role="status">
              수식 수정 중 — 수식에 있는 <code>[통화-항목]</code> 과 같은 색으로 아래 표 셀이
              표시됩니다. 숫자 셀을 클릭하면 활성 수식에 필드가 추가됩니다. (엑셀 참조 방식)
            </p>
          ) : null}

          <div className="exchange-rates-table-wrap">
            <table className="exchange-rates-table exchange-rates-table--exim-full">
              <thead>
                <tr>
                  {visibleColumns.map((col) => {
                    const colRefColor = formulaRefColorMaps.columnColorIndex.get(col.key);
                    const thRefClass =
                      colRefColor != null
                        ? ` exchange-rates-th-ref exchange-rates-th-ref--${colRefColor}`
                        : '';
                    return (
                      <th
                        key={col.key}
                        scope="col"
                        className={
                          (col.kind === 'text'
                            ? 'exchange-rates-th-text'
                            : col.kind === 'code'
                              ? 'exchange-rates-th-code'
                              : 'exchange-rates-th-num') + thRefClass
                        }
                        style={colRefColor != null ? refHighlightStyle(colRefColor) : undefined}
                        title={col.title}
                      >
                        {col.label}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {loading && displayRows.length === 0 ? (
                  <tr>
                    <td colSpan={visibleColumns.length || 1} className="exchange-rates-empty">
                      불러오는 중…
                    </td>
                  </tr>
                ) : displayRows.length === 0 ? (
                  <tr>
                    <td colSpan={visibleColumns.length || 1} className="exchange-rates-empty">
                      표시할 환율 고시가 없습니다.
                    </td>
                  </tr>
                ) : (
                  displayRows.map((row) => (
                    <tr
                      key={row.id}
                      className={`exchange-rates-row${row.available ? '' : ' exchange-rates-row--missing'}${
                        chartCatalogId === row.id ? ' exchange-rates-row--active' : ''
                      }${formulaEditSession?.editing ? ' exchange-rates-row--formula-pick' : ''}`}
                      onClick={() => {
                        if (formulaEditSession?.editing) return;
                        openChart(row);
                      }}
                      onKeyDown={(e) => {
                        if (formulaEditSession?.editing) return;
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openChart(row);
                        }
                      }}
                      tabIndex={formulaEditSession?.editing ? -1 : 0}
                      role={formulaEditSession?.editing ? undefined : 'button'}
                      aria-label={
                        formulaEditSession?.editing
                          ? undefined
                          : `${row.country} ${row.code} 환율 추이 그래프 보기`
                      }
                    >
                      {visibleColumns.map((col) =>
                        renderEximTableCell(row, col, formulaEditSession, formulaRefColorMaps)
                      )}
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
