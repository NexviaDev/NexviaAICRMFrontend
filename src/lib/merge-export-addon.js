/** `same` | `pdfAddon` | `pdfOnly` — 행별 추가 추출(quotation-doc-merge·양식 PDF 설정에서 결정) */
export function normalizeMergeExportAddon(v) {
  const s = String(v || '').trim();
  if (s === 'pdfOnly') return 'pdfOnly';
  if (s === 'pdfAddon' || s === 'preferPdf') return 'pdfAddon';
  return 'same';
}

export function mergeExportAddonWantsPdf(mode) {
  const m = normalizeMergeExportAddon(mode);
  return m === 'pdfAddon' || m === 'pdfOnly';
}

/** PDF 인쇄 영역 등이 잡혀 있으면 PDF 추출 대상으로 간주 */
export function pdfExportOptionsImpliesPdf(opts) {
  if (!opts || typeof opts !== 'object') return false;
  const sel = Array.isArray(opts.printAreaSelections) ? opts.printAreaSelections : [];
  if (sel.length > 0) return true;
  return opts.printAreaMode === 'custom' && String(opts.printArea || '').trim().length > 0;
}

function addonFromPdfOptions(opts) {
  if (!opts || typeof opts !== 'object') return null;
  if (opts.mergeExportAddon != null && String(opts.mergeExportAddon).trim() !== '') {
    return normalizeMergeExportAddon(opts.mergeExportAddon);
  }
  if (pdfExportOptionsImpliesPdf(opts)) return 'pdfAddon';
  return null;
}

/**
 * 시트 행의 추가 추출 모드 — 양식 프로필·행 PDF 옵션·페이지 기본 PDF 설정 순.
 * @param {object} row
 * @param {Record<string, { pdfExportOptions?: object }>} templateProfilesById
 * @param {object} globalPdfOpts
 * @param {string[]} templateIds
 */
export function resolveMergeExportAddonForRow(row, templateProfilesById, globalPdfOpts, templateIds) {
  const ids = Array.isArray(templateIds) ? templateIds.map(String).filter(Boolean) : [];
  const primaryId = ids[0] || '';
  if (primaryId) {
    const prof = templateProfilesById?.[primaryId];
    const fromProf = addonFromPdfOptions(prof?.pdfExportOptions);
    if (fromProf) return fromProf;
  }
  const fromRowOpts = addonFromPdfOptions(row?._pdfExportOptions);
  if (fromRowOpts) return fromRowOpts;
  const fromGlobal = addonFromPdfOptions(globalPdfOpts);
  if (fromGlobal) return fromGlobal;
  return normalizeMergeExportAddon(row?._exportAddon);
}

export function mergeRowsIncludePdfExport(mergeRows, templateProfilesById, globalPdfOpts, templates, selectedTemplateId) {
  const list = Array.isArray(templates) ? templates : [];
  const def = selectedTemplateId || list[0]?._id || '';
  return (mergeRows || []).some((row) => {
    const ids =
      Array.isArray(row?._templateIds) && row._templateIds.length
        ? row._templateIds.map(String)
        : row?._templateId
          ? [String(row._templateId)]
          : def
            ? [String(def)]
            : [];
    const mode = resolveMergeExportAddonForRow(row, templateProfilesById, globalPdfOpts, ids);
    return mergeExportAddonWantsPdf(mode);
  });
}

export function mergeExportAddonSummaryLabel(mode) {
  const m = normalizeMergeExportAddon(mode);
  if (m === 'pdfOnly') return 'PDF 만 추출';
  if (m === 'pdfAddon') return 'PDF 추가 추출';
  return '양식에 맞게만';
}
