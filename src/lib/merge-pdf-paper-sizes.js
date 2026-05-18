/** Excel / ExcelJS pageSetup.paperSize (Open XML) */
export const MERGE_PDF_PAPER_OPTIONS = Object.freeze([
  { id: 'a0', excelPaperSizeId: 64, label: 'A0 (841×1189mm)' },
  { id: 'a1', excelPaperSizeId: 65, label: 'A1 (594×841mm)' },
  { id: 'a2', excelPaperSizeId: 66, label: 'A2 (420×594mm)' },
  { id: 'a3', excelPaperSizeId: 8, label: 'A3 (297×420mm)' },
  { id: 'a4', excelPaperSizeId: 9, label: 'A4 (210×297mm)' },
  { id: 'letter', excelPaperSizeId: 1, label: 'Letter (216×279mm)' }
]);

export function normalizeMergePdfPaperSize(raw) {
  const key = String(raw || 'a4')
    .trim()
    .toLowerCase();
  return MERGE_PDF_PAPER_OPTIONS.find((p) => p.id === key) || MERGE_PDF_PAPER_OPTIONS.find((p) => p.id === 'a4');
}

export function formatMergePdfPaperSizeLabel(paperSizeId) {
  const hit = MERGE_PDF_PAPER_OPTIONS.find((p) => p.id === paperSizeId);
  return hit ? hit.label.split(' ')[0] : 'A4';
}
