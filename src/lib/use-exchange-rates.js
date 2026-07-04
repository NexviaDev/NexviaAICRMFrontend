import { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE } from '@/config';
import { crmFetchInit } from '@/lib/crm-auth';
import { pingBackendHealth } from '@/lib/backend-wake';
import { buildDealBasRMapFromRows } from '@/lib/exchange-rate-convert';

export const EXCHANGE_RATES_FREEZE_STORAGE_KEY = 'nexvia_crm_exchange_rates_frozen';
export const EXCHANGE_RATES_FREEZE_CHANGED_EVENT = 'nexvia-exchange-rates-freeze-changed';

function emitExchangeRatesFreezeChanged() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(EXCHANGE_RATES_FREEZE_CHANGED_EVENT));
}

export function readFrozenExchangeRatesFromStorage() {
  try {
    const raw = sessionStorage.getItem(EXCHANGE_RATES_FREEZE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.dealBasRMap && typeof parsed.dealBasRMap === 'object') {
      return {
        dealBasRMap: parsed.dealBasRMap,
        usdSummary: parsed.usdSummary || null,
        pricingProfile: parsed.pricingProfile || null,
        frozenAt: parsed.frozenAt || null
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function writeFrozenExchangeRatesToStorage(dealBasRMap, usdSummary = null, pricingProfile = null) {
  try {
    sessionStorage.setItem(
      EXCHANGE_RATES_FREEZE_STORAGE_KEY,
      JSON.stringify({
        dealBasRMap,
        usdSummary,
        pricingProfile,
        frozenAt: new Date().toISOString()
      })
    );
    emitExchangeRatesFreezeChanged();
  } catch {
    /* ignore */
  }
}

export function clearFrozenExchangeRatesStorage() {
  try {
    sessionStorage.removeItem(EXCHANGE_RATES_FREEZE_STORAGE_KEY);
    emitExchangeRatesFreezeChanged();
  } catch {
    /* ignore */
  }
}

/**
 * @param {object} opts
 * @param {() => Record<string, string>} opts.getAuthHeader
 * @param {boolean} [opts.enabled=true]
 * @param {number} [opts.pollMs=120000] 동기화 중일 때 주기적 갱신(0이면 1회만)
 * @param {boolean} [opts.respectSessionFreeze=true] sessionStorage 동기화 중지 반영
 */
export function useExchangeRates({
  getAuthHeader,
  enabled = true,
  pollMs = 120000,
  respectSessionFreeze = true
} = {}) {
  const [liveDealBasRMap, setLiveDealBasRMap] = useState({});
  const [liveUsdSummary, setLiveUsdSummary] = useState(null);
  const [livePricingProfile, setLivePricingProfile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [frozenSnapshot, setFrozenSnapshot] = useState(() =>
    respectSessionFreeze ? readFrozenExchangeRatesFromStorage() : null
  );
  const mountedRef = useRef(true);

  const exchangeRatesFrozen = Boolean(frozenSnapshot?.dealBasRMap);
  const dealBasRMap = exchangeRatesFrozen ? frozenSnapshot.dealBasRMap : liveDealBasRMap;
  const usdSummary = exchangeRatesFrozen ? frozenSnapshot?.usdSummary ?? null : liveUsdSummary;
  const pricingProfile = exchangeRatesFrozen
    ? frozenSnapshot?.pricingProfile ?? livePricingProfile
    : livePricingProfile;

  const fetchRates = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      await pingBackendHealth(getAuthHeader);
      const res = await fetch(`${API_BASE}/exchange-rates/latest`, crmFetchInit());
      const data = await res.json().catch(() => ({}));
      if (!mountedRef.current) return;
      if (Array.isArray(data.rows)) {
        setLiveDealBasRMap(buildDealBasRMapFromRows(data.rows));
      }
      if (data.usdSummary && typeof data.usdSummary === 'object') {
        setLiveUsdSummary(data.usdSummary);
      }
      if (data.pricingProfile && typeof data.pricingProfile === 'object') {
        setLivePricingProfile(data.pricingProfile);
      }
    } catch {
      /* 환율 없으면 원화 환산 힌트만 생략 */
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [enabled, getAuthHeader]);

  const freezeExchangeRates = useCallback(() => {
    const snap = { ...liveDealBasRMap };
    const next = {
      dealBasRMap: snap,
      usdSummary: liveUsdSummary,
      pricingProfile: livePricingProfile,
      frozenAt: new Date().toISOString()
    };
    setFrozenSnapshot(next);
    writeFrozenExchangeRatesToStorage(snap, liveUsdSummary, livePricingProfile);
  }, [liveDealBasRMap, liveUsdSummary, livePricingProfile]);

  const resumeExchangeRates = useCallback(() => {
    setFrozenSnapshot(null);
    clearFrozenExchangeRatesStorage();
    void fetchRates();
  }, [fetchRates]);

  const toggleExchangeRatesFreeze = useCallback(() => {
    if (exchangeRatesFrozen) resumeExchangeRates();
    else freezeExchangeRates();
  }, [exchangeRatesFrozen, freezeExchangeRates, resumeExchangeRates]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void fetchRates();
  }, [enabled, fetchRates]);

  useEffect(() => {
    if (!enabled || !pollMs || exchangeRatesFrozen) return undefined;
    const id = window.setInterval(() => {
      void fetchRates();
    }, pollMs);
    return () => window.clearInterval(id);
  }, [enabled, pollMs, exchangeRatesFrozen, fetchRates]);

  useEffect(() => {
    if (!respectSessionFreeze || typeof window === 'undefined') return undefined;
    const syncFrozenFromStorage = () => {
      setFrozenSnapshot(readFrozenExchangeRatesFromStorage());
    };
    window.addEventListener(EXCHANGE_RATES_FREEZE_CHANGED_EVENT, syncFrozenFromStorage);
    window.addEventListener('storage', (e) => {
      if (e.key === EXCHANGE_RATES_FREEZE_STORAGE_KEY) syncFrozenFromStorage();
    });
    return () => {
      window.removeEventListener(EXCHANGE_RATES_FREEZE_CHANGED_EVENT, syncFrozenFromStorage);
    };
  }, [respectSessionFreeze]);

  return {
    dealBasRMap,
    usdSummary,
    pricingProfile,
    liveDealBasRMap,
    liveUsdSummary,
    loading,
    exchangeRatesFrozen,
    frozenAt: frozenSnapshot?.frozenAt || null,
    freezeExchangeRates,
    resumeExchangeRates,
    toggleExchangeRatesFreeze,
    refreshExchangeRates: fetchRates
  };
}
