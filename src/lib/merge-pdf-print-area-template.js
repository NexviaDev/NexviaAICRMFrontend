import { isXlsxMergeTemplate } from '@/lib/merge-template-file-types';

function rowTemplateIds(row, selectedTemplateId, templates) {
  const def = selectedTemplateId || templates[0]?._id || '';
  const raw =
    Array.isArray(row?._templateIds) && row._templateIds.length
      ? row._templateIds
      : row?._templateId
        ? [String(row._templateId)]
        : def
          ? [String(def)]
          : [];
  return raw.filter((id) => templates.some((t) => String(t._id) === String(id)));
}

function rowUsesPdf(row) {
  const s = String(row?._exportAddon || '').trim();
  return s === 'pdfAddon' || s === 'pdfOnly' || s === 'preferPdf';
}

/**
 * PDF 인쇄 영역 드래그 선택에 쓸 Excel(.xlsx) 양식 하나를 고릅니다.
 * @returns {{ templateId: string, templateName: string } | null}
 */
export function resolvePdfPrintAreaXlsxTemplate(mergeRows, templates, selectedTemplateId, templateListFileName) {
  if (!templates?.length) return null;
  const nameOf = (t) =>
    typeof templateListFileName === 'function'
      ? templateListFileName(t)
      : String(t.fileName || t.name || '양식');

  const pickFromIds = (ids) => {
    for (const id of ids) {
      const t = templates.find((x) => String(x._id) === String(id));
      if (isXlsxMergeTemplate(t)) return { templateId: String(t._id), templateName: nameOf(t) };
    }
    return null;
  };

  for (const row of mergeRows || []) {
    if (!rowUsesPdf(row)) continue;
    const hit = pickFromIds(rowTemplateIds(row, selectedTemplateId, templates));
    if (hit) return hit;
  }
  for (const row of mergeRows || []) {
    const hit = pickFromIds(rowTemplateIds(row, selectedTemplateId, templates));
    if (hit) return hit;
  }
  const t = templates.find(isXlsxMergeTemplate);
  if (t) return { templateId: String(t._id), templateName: nameOf(t) };
  return null;
}

/**
 * 한 행의「사용 양식」에서 PDF 인쇄 영역용 xlsx를 고릅니다.
 * @returns {{ templateId: string, templateName: string } | null}
 */
export function resolvePdfPrintAreaXlsxTemplateForRow(
  row,
  templates,
  selectedTemplateId,
  templateListFileName
) {
  if (!templates?.length || !row) return null;
  const nameOf = (t) =>
    typeof templateListFileName === 'function'
      ? templateListFileName(t)
      : String(t.fileName || t.name || '양식');
  const ids = rowTemplateIds(row, selectedTemplateId, templates);
  for (const id of ids) {
    const t = templates.find((x) => String(x._id) === String(id));
    if (isXlsxMergeTemplate(t)) return { templateId: String(t._id), templateName: nameOf(t) };
  }
  return null;
}
