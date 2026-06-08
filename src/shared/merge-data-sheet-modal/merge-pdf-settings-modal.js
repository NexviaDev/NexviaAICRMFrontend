import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { pingBackendHealth } from '@/lib/backend-wake';
import {
  formatMergePdfExportOptionsSummary,
  normalizeMergePdfExportOptions
} from '@/lib/merge-pdf-export-options';
import {
  fetchAllMergePdfExportPresets,
  fetchCompanyMergePdfExportPresets,
  fetchPersonalMergePdfExportPresets,
  newMergePdfExportPresetId,
  putCompanyMergePdfExportPresets,
  putPersonalMergePdfExportPresets
} from '@/lib/merge-pdf-export-presets-storage';
import {
  buildLegacyPrintAreaString,
  formatPrintAreaSelectionsLines,
  isCustomPrintAreaValid,
  mergePrintPageRangeFromSelections,
  normalizePrintAreaSelections,
  renumberPrintAreaSelectionPages
} from '@/lib/merge-pdf-print-area-selections';
import { MERGE_PDF_PAPER_OPTIONS } from '@/lib/merge-pdf-paper-sizes';
import MergePdfPrintAreaPickerModal from './merge-pdf-print-area-picker-modal';
import './merge-pdf-settings-modal.css';

export default function MergePdfSettingsModal({
  open,
  onClose,
  options,
  onSave,
  onRequestPreview,
  previewCaption,
  apiBase,
  mergeApiPrefix = '/quotation-merge',
  getAuthHeader,
  printAreaTemplateId,
  printAreaTemplateName,
  localXlsxFile = null,
  /** false면 docx 등 — 인쇄 영역 없이도 미리보기·저장 가능 */
  requirePrintAreaForPreview = true
}) {
  const canPickPrintArea =
    !!printAreaTemplateId ||
    (localXlsxFile && /\.xlsx$/i.test(String(localXlsxFile.name || '')));
  const [draft, setDraft] = useState(() => normalizeMergePdfExportOptions(options));
  const [previewLoading, setPreviewLoading] = useState(false);
  const [printAreaError, setPrintAreaError] = useState('');
  const [areaPickerOpen, setAreaPickerOpen] = useState(false);
  const [savedPresets, setSavedPresets] = useState([]);
  const [presetsLoading, setPresetsLoading] = useState(false);
  const [presetSaving, setPresetSaving] = useState(false);
  const [presetDeleting, setPresetDeleting] = useState(false);
  const [presetPickKey, setPresetPickKey] = useState('');
  const [presetNameDraft, setPresetNameDraft] = useState('');
  const [presetDropdownOpen, setPresetDropdownOpen] = useState(false);
  const presetDropdownRef = useRef(null);
  const presetDropdownPanelId = useId();

  useEffect(() => {
    if (open) {
      setDraft(normalizeMergePdfExportOptions(options));
      setPrintAreaError('');
      setPreviewLoading(false);
      setAreaPickerOpen(false);
      setPresetPickKey('');
      setPresetDropdownOpen(false);
    }
  }, [open, options]);

  useEffect(() => {
    if (!open || !getAuthHeader) return;
    let cancelled = false;
    (async () => {
      setPresetsLoading(true);
      try {
        const { merged } = await fetchAllMergePdfExportPresets(getAuthHeader);
        if (!cancelled) setSavedPresets(merged);
      } catch (_) {
        if (!cancelled) setSavedPresets([]);
      } finally {
        if (!cancelled) setPresetsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, getAuthHeader]);

  useEffect(() => {
    if (!presetDropdownOpen) return;
    const onDoc = (e) => {
      if (presetDropdownRef.current && !presetDropdownRef.current.contains(e.target)) {
        setPresetDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [presetDropdownOpen]);

  const activePreset = useMemo(
    () => savedPresets.find((p) => p.pickKey === presetPickKey) || null,
    [savedPresets, presetPickKey]
  );

  const applyPresetByKey = (pickKey) => {
    const p = savedPresets.find((x) => x.pickKey === pickKey);
    if (!p?.options) return;
    setPrintAreaError('');
    setDraft(normalizeMergePdfExportOptions(p.options));
    setPresetPickKey(pickKey);
  };

  const handleSavePreset = async (scope) => {
    const name = String(presetNameDraft || '').trim();
    if (!name) {
      window.alert('저장할 이름을 입력해 주세요.');
      return;
    }
    if (!getAuthHeader) return;
    setPresetSaving(true);
    try {
      await pingBackendHealth();
      const item = {
        id: newMergePdfExportPresetId(),
        name: name.slice(0, 80),
        options: normalizeMergePdfExportOptions(draft)
      };
      if (scope === 'company') {
        const latest = await fetchCompanyMergePdfExportPresets(getAuthHeader);
        const items = await putCompanyMergePdfExportPresets(getAuthHeader, [...latest, item]);
        const personal = await fetchPersonalMergePdfExportPresets(getAuthHeader);
        setSavedPresets([
          ...items.map((p) => ({ ...p, scope: 'company', pickKey: `company:${p.id}` })),
          ...personal.map((p) => ({ ...p, scope: 'personal', pickKey: `personal:${p.id}` }))
        ]);
        window.alert('「자주 쓰는 PDF 설정」에 회사 공용으로 저장했습니다.');
      } else {
        const latest = await fetchPersonalMergePdfExportPresets(getAuthHeader);
        const items = await putPersonalMergePdfExportPresets(getAuthHeader, [...latest, item]);
        const company = await fetchCompanyMergePdfExportPresets(getAuthHeader);
        setSavedPresets([
          ...company.map((p) => ({ ...p, scope: 'company', pickKey: `company:${p.id}` })),
          ...items.map((p) => ({ ...p, scope: 'personal', pickKey: `personal:${p.id}` }))
        ]);
        window.alert('「자주 쓰는 PDF 설정」에 개인으로 저장했습니다.');
      }
      setPresetNameDraft('');
      setPresetDropdownOpen(false);
    } catch (e) {
      window.alert(e?.message || '저장에 실패했습니다.');
    } finally {
      setPresetSaving(false);
    }
  };

  const deletePresetByKey = async (pickKey) => {
    const p = savedPresets.find((x) => x.pickKey === pickKey);
    if (!p || !getAuthHeader) return;
    const scopeLabel = p.scope === 'company' ? '회사 공용' : '개인';
    if (!window.confirm(`「${p.name}」(${scopeLabel}) PDF 설정을 삭제할까요?`)) return;
    setPresetDeleting(true);
    try {
      await pingBackendHealth();
      if (p.scope === 'company') {
        const latest = await fetchCompanyMergePdfExportPresets(getAuthHeader);
        const next = latest.filter((x) => String(x.id) !== String(p.id));
        const items = await putCompanyMergePdfExportPresets(getAuthHeader, next);
        const personal = await fetchPersonalMergePdfExportPresets(getAuthHeader);
        setSavedPresets([
          ...items.map((x) => ({ ...x, scope: 'company', pickKey: `company:${x.id}` })),
          ...personal.map((x) => ({ ...x, scope: 'personal', pickKey: `personal:${x.id}` }))
        ]);
      } else {
        const latest = await fetchPersonalMergePdfExportPresets(getAuthHeader);
        const next = latest.filter((x) => String(x.id) !== String(p.id));
        const items = await putPersonalMergePdfExportPresets(getAuthHeader, next);
        const company = await fetchCompanyMergePdfExportPresets(getAuthHeader);
        setSavedPresets([
          ...company.map((x) => ({ ...x, scope: 'company', pickKey: `company:${x.id}` })),
          ...items.map((x) => ({ ...x, scope: 'personal', pickKey: `personal:${x.id}` }))
        ]);
      }
      setPresetPickKey((cur) => (cur === pickKey ? '' : cur));
    } catch (e) {
      window.alert(e?.message || '삭제하지 못했습니다.');
    } finally {
      setPresetDeleting(false);
    }
  };

  if (!open) return null;

  const needsPrintArea = requirePrintAreaForPreview && canPickPrintArea;

  const handleSave = () => {
    if (needsPrintArea && !isCustomPrintAreaValid(draft)) {
      setPrintAreaError('「양식에서 영역 선택」에서 드래그로 범위를 추가하고 페이지 순서를 정해 주세요.');
      return;
    }
    onSave?.(normalizeMergePdfExportOptions(draft));
    onClose?.();
  };

  const handlePreview = async () => {
    if (!onRequestPreview) return;
    let opts = normalizeMergePdfExportOptions(draft);
    if (needsPrintArea && !isCustomPrintAreaValid(draft)) {
      setPrintAreaError('「양식에서 영역 선택」에서 드래그로 범위를 추가하고 페이지 순서를 정해 주세요.');
      return;
    }
    setPrintAreaError('');
    setPreviewLoading(true);
    try {
      await onRequestPreview(opts);
    } catch (e) {
      window.alert(e?.message || 'PDF 미리보기에 실패했습니다.');
    } finally {
      setPreviewLoading(false);
    }
  };

  return (
    <div
      className="merge-pdf-settings-root"
      role="dialog"
      aria-modal="true"
      aria-labelledby="merge-pdf-settings-title"
    >
      <button type="button" className="merge-pdf-settings-backdrop" aria-label="닫기" onClick={onClose} />
      <div className="merge-pdf-settings-panel">
        <header className="merge-pdf-settings-head">
          <h2 id="merge-pdf-settings-title" className="merge-pdf-settings-title">
            PDF보내기 설정
          </h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="닫기">
            <span className="material-symbols-outlined" aria-hidden>
              close
            </span>
          </button>
        </header>
        <p className="merge-pdf-settings-desc">
          「PDF 추가 추출」「PDF 만 추출」에 적용됩니다. <strong>인쇄 영역</strong>은 CRM 데이터 표가 아니라{' '}
          <strong>등록한 Excel(.xlsx) 양식 파일</strong>의 셀 주소입니다.
        </p>
        <section className="merge-pdf-settings-presets-section">
          <p className="merge-pdf-settings-presets-label">
            <strong>자주 쓰는 PDF 설정</strong>
            <span className="merge-pdf-settings-presets-sublabel">회사 공용 · 개인</span>
          </p>
          <div className="merge-pdf-saved-dropdown" ref={presetDropdownRef}>
            <button
              type="button"
              className="merge-pdf-saved-dropdown-trigger"
              aria-expanded={presetDropdownOpen}
              aria-haspopup="listbox"
              aria-controls={presetDropdownPanelId}
              disabled={previewLoading || presetsLoading || presetDeleting}
              onClick={() => {
                if (previewLoading || presetsLoading || presetDeleting) return;
                setPresetDropdownOpen((o) => !o);
              }}
            >
              <span className="merge-pdf-saved-dropdown-trigger-text">
                {activePreset
                  ? `${activePreset.scope === 'company' ? '[회사] ' : '[개인] '}${activePreset.name}`
                  : '불러오기…'}
              </span>
              <span
                className={`material-symbols-outlined merge-pdf-saved-dropdown-chevron${
                  presetDropdownOpen ? ' is-open' : ''
                }`}
                aria-hidden
              >
                expand_more
              </span>
            </button>
            {presetDropdownOpen ? (
              <div
                id={presetDropdownPanelId}
                className="merge-pdf-saved-dropdown-panel"
                role="listbox"
                aria-label="저장된 PDF 설정"
              >
                {savedPresets.length === 0 ? (
                  <p className="merge-pdf-saved-dropdown-empty">
                    저장된 항목이 없습니다. 아래에서 이름을 적고 개인·회사로 등록하세요.
                  </p>
                ) : (
                  <ul className="merge-pdf-saved-dropdown-list">
                    {savedPresets.map((p) => (
                      <li key={p.pickKey} className="merge-pdf-saved-dropdown-row">
                        <button
                          type="button"
                          role="option"
                          aria-selected={presetPickKey === p.pickKey}
                          className={`merge-pdf-saved-dropdown-option${presetPickKey === p.pickKey ? ' is-active' : ''}`}
                          disabled={presetDeleting}
                          onClick={() => {
                            applyPresetByKey(p.pickKey);
                            setPresetDropdownOpen(false);
                          }}
                        >
                          <span className={`merge-pdf-saved-scope merge-pdf-saved-scope--${p.scope}`}>
                            {p.scope === 'company' ? '회사' : '개인'}
                          </span>
                          {p.name}
                        </button>
                        <button
                          type="button"
                          className="merge-pdf-saved-dropdown-del"
                          aria-label={`「${p.name}」 삭제`}
                          title="삭제"
                          disabled={presetsLoading || presetSaving || presetDeleting}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void deletePresetByKey(p.pickKey);
                          }}
                        >
                          <span className="material-symbols-outlined" aria-hidden>
                            delete_outline
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="merge-pdf-saved-dropdown-footer">
                  <input
                    type="text"
                    className="qdm-cell merge-pdf-saved-dropdown-footer-input"
                    placeholder="새로 저장할 이름"
                    value={presetNameDraft}
                    onChange={(e) => setPresetNameDraft(e.target.value)}
                    maxLength={80}
                    disabled={presetsLoading || presetDeleting || presetSaving}
                    aria-label="PDF 설정 저장 이름"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void handleSavePreset('personal');
                      }
                    }}
                  />
                  <div className="merge-pdf-saved-dropdown-register-row">
                    <button
                      type="button"
                      className="qdm-btn qdm-btn-ghost merge-pdf-saved-register-btn"
                      onClick={() => void handleSavePreset('personal')}
                      disabled={presetsLoading || presetSaving || presetDeleting}
                    >
                      {presetSaving ? '저장 중…' : '개인 등록'}
                    </button>
                    <button
                      type="button"
                      className="qdm-btn qdm-btn-ghost merge-pdf-saved-register-btn merge-pdf-saved-register-btn--company"
                      onClick={() => void handleSavePreset('company')}
                      disabled={presetsLoading || presetSaving || presetDeleting}
                    >
                      {presetSaving ? '저장 중…' : '회사 등록'}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
          {presetsLoading ? (
            <p className="merge-pdf-settings-presets-loading" role="status">
              저장된 설정 목록을 불러오는 중…
            </p>
          ) : null}
        </section>
        <MergePdfSettingsFields
          draft={draft}
          setDraft={setDraft}
          printAreaError={printAreaError}
          setPrintAreaError={setPrintAreaError}
          printAreaTemplateId={printAreaTemplateId}
          canPickPrintArea={canPickPrintArea}
          onOpenAreaPicker={() => setAreaPickerOpen(true)}
        />
        {previewLoading ? (
          <div
            className="merge-pdf-settings-busy"
            role="status"
            aria-live="polite"
            aria-label="PDF 미리보기 생성 중"
          >
            <span className="merge-pdf-spinner" aria-hidden />
            <span>PDF 미리보기 생성 중… (서버에서 변환)</span>
          </div>
        ) : null}
       
        <footer className="merge-pdf-settings-foot">
          <button type="button" className="qdm-btn qdm-btn-ghost" onClick={onClose} disabled={previewLoading}>
            취소
          </button>
          {onRequestPreview ? (
            <button
              type="button"
              className="qdm-btn qdm-btn-ghost"
              onClick={() => void handlePreview()}
              disabled={previewLoading}
            >
              {previewLoading ? (
                <>
                  <span className="merge-pdf-spinner merge-pdf-settings-btn-spinner" aria-hidden />
                  미리보기 생성 중…
                </>
              ) : (
                '미리보기'
              )}
            </button>
          ) : null}
          <button type="button" className="btn-primary" onClick={handleSave} disabled={previewLoading}>
            저장
          </button>
        </footer>
      </div>
      <MergePdfPrintAreaPickerModal
        open={areaPickerOpen}
        onClose={() => setAreaPickerOpen(false)}
        apiBase={apiBase}
        mergeApiPrefix={mergeApiPrefix}
        getAuthHeader={getAuthHeader}
        templateId={printAreaTemplateId}
        templateName={printAreaTemplateName || localXlsxFile?.name || ''}
        localXlsxFile={canPickPrintArea && !printAreaTemplateId ? localXlsxFile : null}
        initialPrintArea={draft.printArea}
        initialSheetName={draft.printSheetNames?.[0] || ''}
        initialPrintAreaSelections={draft.printAreaSelections}
        onApply={({ printArea, printSheetNames, printAreaSelections }) => {
          setPrintAreaError('');
          const list = renumberPrintAreaSelectionPages(printAreaSelections);
          if (!list.length) return;
          const names =
            printSheetNames?.length > 0
              ? printSheetNames
              : list.length
                ? [...new Set(list.map((s) => s.sheetName))]
                : [];
          const area = printArea || buildLegacyPrintAreaString(list);
          const page = mergePrintPageRangeFromSelections(list, draft);
          setDraft((d) => ({
            ...d,
            printAreaMode: 'custom',
            printArea: area,
            printAreaSelections: list,
            printSheetMode: names.length ? 'named' : d.printSheetMode,
            printSheetNames: names.length ? names : d.printSheetNames,
            printPageMode: page.printPageMode,
            printPageFrom: page.printPageFrom,
            printPageTo: page.printPageTo
          }));
        }}
      />
    </div>
  );
}

function MergePdfSettingsFields({
  draft,
  setDraft,
  printAreaError,
  setPrintAreaError,
  printAreaTemplateId,
  canPickPrintArea,
  onOpenAreaPicker
}) {
  return (
    <div className="merge-pdf-settings-fields">
      <fieldset className="merge-pdf-settings-fieldset">
        <legend className="merge-pdf-settings-label">파일 받기 방식</legend>
        <p className="merge-pdf-settings-field-hint merge-pdf-settings-field-hint--fieldset">
          데이터 시트에서는 바꾸지 않습니다. 양식 등록·이 페이지 PDF 설정과 동일하게 적용됩니다.
        </p>
        <label className="merge-pdf-settings-radio">
          <input
            type="radio"
            name="pdf-merge-export-addon"
            checked={(draft.mergeExportAddon || 'same') === 'same'}
            onChange={() => setDraft((d) => ({ ...d, mergeExportAddon: 'same' }))}
          />
          <span>양식만 (Office)</span>
        </label>
        <label className="merge-pdf-settings-radio">
          <input
            type="radio"
            name="pdf-merge-export-addon"
            checked={draft.mergeExportAddon === 'pdfAddon'}
            onChange={() => setDraft((d) => ({ ...d, mergeExportAddon: 'pdfAddon' }))}
          />
          <span>PDF 추가 추출 (양식 + PDF)</span>
        </label>
        <label className="merge-pdf-settings-radio">
          <input
            type="radio"
            name="pdf-merge-export-addon"
            checked={draft.mergeExportAddon === 'pdfOnly'}
            onChange={() => setDraft((d) => ({ ...d, mergeExportAddon: 'pdfOnly' }))}
          />
          <span>PDF 만 추출</span>
        </label>
      </fieldset>
      <label className="merge-pdf-settings-field">
        <span className="merge-pdf-settings-label">용지</span>
        <select
          className="qdm-select merge-pdf-settings-select"
          value={draft.paperSize || 'a4'}
          onChange={(e) => setDraft((d) => ({ ...d, paperSize: e.target.value }))}
        >
          {MERGE_PDF_PAPER_OPTIONS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="merge-pdf-settings-fieldset">
        <legend className="merge-pdf-settings-label">인쇄 영역 (드래그 · 페이지 순서)</legend>
        <p className="merge-pdf-settings-field-hint merge-pdf-settings-field-hint--fieldset">
          Excel 양식에서 셀 범위를 드래그로 고르고, 목록 순서대로 PDF 페이지가 나갑니다. 자동 분할은 사용하지
          않습니다.
        </p>
        <div className="merge-pdf-settings-field merge-pdf-settings-field--indent">
            <span className="merge-pdf-settings-label">선택된 영역</span>
            {draft.printAreaSelections?.length ? (
              <textarea
                className="qdm-cell merge-pdf-settings-input merge-pdf-settings-input--areas"
                readOnly
                rows={Math.min(8, Math.max(3, draft.printAreaSelections.length + 1))}
                value={formatPrintAreaSelectionsLines(draft.printAreaSelections)}
                spellCheck={false}
                aria-readonly="true"
              />
            ) : (
              <p className="merge-pdf-settings-field-hint" role="note">
                아직 영역이 없습니다. 아래 버튼으로 양식을 열어 범위를 추가해 주세요.
              </p>
            )}
            <div className="merge-pdf-settings-print-area-actions">
              <button
                type="button"
                className="qdm-btn qdm-btn-ghost merge-pdf-settings-pick-btn"
                onClick={onOpenAreaPicker}
                disabled={!canPickPrintArea}
                title={
                  canPickPrintArea
                    ? 'Excel 양식을 화면에 띄운 뒤 드래그로 범위를 고릅니다'
                    : 'Excel(.xlsx) 양식이 없어 드래그 선택을 쓸 수 없습니다'
                }
              >
                양식에서 영역 선택
              </button>
            </div>
            {printAreaError ? (
              <span className="merge-pdf-settings-field-error" role="alert">
                {printAreaError}
              </span>
            ) : canPickPrintArea ? (
              <span className="merge-pdf-settings-field-hint">
                「양식에서 영역 선택」에서 드래그로 범위를 추가하고, 목록에서 페이지 순서를 조정하세요.
              </span>
            ) : (
              <span className="merge-pdf-settings-field-hint">
                PDF 인쇄 영역은 Excel(.xlsx) 양식에서만 지정할 수 있습니다.
              </span>
            )}
        </div>
      </fieldset>
      <fieldset className="merge-pdf-settings-fieldset">
        <legend className="merge-pdf-settings-label">방향</legend>
        <label className="merge-pdf-settings-radio">
          <input
            type="radio"
            name="pdf-orientation"
            checked={draft.orientation !== 'landscape'}
            onChange={() => setDraft((d) => ({ ...d, orientation: 'portrait' }))}
          />
          <span>세로 (기본)</span>
        </label>
        <label className="merge-pdf-settings-radio">
          <input
            type="radio"
            name="pdf-orientation"
            checked={draft.orientation === 'landscape'}
            onChange={() => setDraft((d) => ({ ...d, orientation: 'landscape' }))}
          />
          <span>가로 (넓은 양식)</span>
        </label>
      </fieldset>
      <label className="merge-pdf-settings-check">
        <input
          type="checkbox"
          checked={draft.pdfAutoFitToA4 !== false}
          onChange={(e) =>
            setDraft((d) => ({
              ...d,
              pdfAutoFitToA4: e.target.checked,
              fitToWidth: e.target.checked ? true : d.fitToWidth,
              fitToHeight: e.target.checked ? true : d.fitToHeight
            }))
          }
        />
        <span>인쇄 영역을 A4 한 페이지에 맞춤 (여백 유지·자동 확대/축소)</span>
      </label>
      <label className="merge-pdf-settings-check">
        <input
          type="checkbox"
          checked={draft.centerOnPage !== false}
          onChange={(e) => setDraft((d) => ({ ...d, centerOnPage: e.target.checked }))}
        />
        <span>인쇄 영역을 용지 가로 가운데 맞춤</span>
      </label>
    </div>
  );
}
