import { useState, useEffect, useCallback, useMemo } from 'react';
import { API_BASE } from '@/config';

export const PIPELINE_STAGES_ENTITY_TYPE = 'salesPipelineStage';
export const PIPELINE_STAGES_UPDATED_EVENT = 'nexvia-pipeline-stages-updated';

/** pipeline-stages-manage-modal.js DEFAULT_STAGE_SEED 와 동일 — DB 미등록 시 폴백 */
export const DEFAULT_PIPELINE_STAGE_SEED = [
  { key: 'NewLead', label: '신규 리드 & 추가 구매건', forecastPercent: 20 },
  { key: 'Contacted', label: '연락 완료', forecastPercent: 30 },
  { key: 'ProposalSent', label: '제안서 전달 완료', forecastPercent: 50 },
  { key: 'TechDemo', label: '기술 시연', forecastPercent: 60 },
  { key: 'Quotation', label: '견적', forecastPercent: 70 },
  { key: 'Negotiation', label: '최종 협상', forecastPercent: 90 },
  { key: 'Won', label: '수주 성공', forecastPercent: 100 }
];

export const DEFAULT_PIPELINE_STAGE_LABELS = Object.fromEntries(
  DEFAULT_PIPELINE_STAGE_SEED.map((row) => [row.key, row.label])
);

const DROP_ZONE_STAGE_LABELS = {
  Lost: '기회 상실',
  Abandoned: '보류'
};

let cachedLabelMap = null;
let fetchInFlight = null;

export function invalidatePipelineStageLabelCache() {
  cachedLabelMap = null;
  fetchInFlight = null;
}

/** custom-field-definitions(salesPipelineStage) → key→표시이름 (동적 stage_* 포함) */
export function buildStageLabelMapFromDefinitions(definitions) {
  const map = { ...DEFAULT_PIPELINE_STAGE_LABELS, ...DROP_ZONE_STAGE_LABELS };
  for (const def of Array.isArray(definitions) ? definitions : []) {
    const key = String(def?.key ?? '').trim();
    if (!key) continue;
    const label = String(def?.label ?? '').trim();
    map[key] = label || map[key] || key;
  }
  return map;
}

export async function fetchPipelineStageDefinitions(getAuthHeader) {
  const res = await fetch(`${API_BASE}/custom-field-definitions?entityType=${PIPELINE_STAGES_ENTITY_TYPE}`, {
    headers: typeof getAuthHeader === 'function' ? getAuthHeader() : getAuthHeader || {}
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !Array.isArray(data.items)) return [];
  return data.items;
}

export async function fetchPipelineStageLabelMap(getAuthHeader, { force = false } = {}) {
  if (!force && cachedLabelMap) return cachedLabelMap;
  if (!force && fetchInFlight) return fetchInFlight;

  fetchInFlight = (async () => {
    try {
      const items = await fetchPipelineStageDefinitions(getAuthHeader);
      const map = buildStageLabelMapFromDefinitions(items);
      cachedLabelMap = map;
      return map;
    } catch {
      const fallback = { ...DEFAULT_PIPELINE_STAGE_LABELS, ...DROP_ZONE_STAGE_LABELS };
      cachedLabelMap = fallback;
      return fallback;
    } finally {
      fetchInFlight = null;
    }
  })();

  return fetchInFlight;
}

export function resolvePipelineStageLabel(stageKey, stageLabels) {
  const sk = String(stageKey ?? '').trim();
  if (!sk) return '';
  const map = stageLabels && typeof stageLabels === 'object' ? stageLabels : {};
  if (map[sk]) return map[sk];
  if (DEFAULT_PIPELINE_STAGE_LABELS[sk]) return DEFAULT_PIPELINE_STAGE_LABELS[sk];
  if (DROP_ZONE_STAGE_LABELS[sk]) return DROP_ZONE_STAGE_LABELS[sk];
  return sk;
}

export function notifyPipelineStagesUpdated() {
  invalidatePipelineStageLabelCache();
  try {
    window.dispatchEvent(new CustomEvent(PIPELINE_STAGES_UPDATED_EVENT));
  } catch {
    /* ignore */
  }
}

/**
 * 파이프라인 단계 관리 모달과 동일 API — 표·필터 등에서 동적 단계명 사용
 */
export function usePipelineStageLabelMap(getAuthHeader) {
  const [stageLabelMap, setStageLabelMap] = useState(() => ({
    ...DEFAULT_PIPELINE_STAGE_LABELS,
    ...DROP_ZONE_STAGE_LABELS
  }));
  const [loading, setLoading] = useState(true);

  const reload = useCallback(
    async (force = true) => {
      setLoading(true);
      try {
        const map = await fetchPipelineStageLabelMap(getAuthHeader, { force });
        setStageLabelMap(map);
      } finally {
        setLoading(false);
      }
    },
    [getAuthHeader]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const map = await fetchPipelineStageLabelMap(getAuthHeader, { force: false });
        if (!cancelled) setStageLabelMap(map);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getAuthHeader]);

  useEffect(() => {
    const onUpdated = () => {
      void reload(true);
    };
    window.addEventListener(PIPELINE_STAGES_UPDATED_EVENT, onUpdated);
    return () => window.removeEventListener(PIPELINE_STAGES_UPDATED_EVENT, onUpdated);
  }, [reload]);

  const mergedMap = useMemo(() => stageLabelMap, [stageLabelMap]);

  return { stageLabelMap: mergedMap, loading, reload };
}
