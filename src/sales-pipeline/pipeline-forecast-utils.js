/**
 * 세일즈 파이프라인 단계별 Forecast(%) — sales-pipeline · opportunity-modal 공통
 */
export const DEFAULT_STAGE_FORECAST_PERCENT = {
  NewLead: 20,
  Contacted: 30,
  ProposalSent: 50,
  TechDemo: 60,
  Quotation: 70,
  Negotiation: 90,
  Won: 100,
  Lost: 0,
  Abandoned: 0
};

/**
 * @param {Array<{ key?: string, options?: { forecastPercent?: number } }>} stageDefinitions
 * @returns {Record<string, number>}
 */
export function buildStageForecastPercentMap(stageDefinitions) {
  const map = { ...DEFAULT_STAGE_FORECAST_PERCENT };
  for (const d of stageDefinitions || []) {
    const k = String(d?.key || '').trim();
    if (!k) continue;
    const opt = d.options && typeof d.options === 'object' ? d.options : {};
    if (opt.forecastPercent != null && String(opt.forecastPercent).trim() !== '') {
      const n = Number(opt.forecastPercent);
      if (Number.isFinite(n)) map[k] = Math.min(100, Math.max(0, n));
    }
  }
  map.Lost = 0;
  return map;
}
