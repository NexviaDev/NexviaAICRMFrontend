import { useEffect } from 'react';
import { MERGE_EXCEL_FORMATS, MERGE_FIELD_VALUE_KINDS } from '@/lib/merge-field-editor-constants';
import './merge-field-editor-modal.css';

/**
 * 문서 메일머지 — 문서에 넣을 치환 항목 편집 전체 화면(시트 모달 위).
 * 스타일은 페이지의 quotation-doc-merge.css 의 .qdm-field-editor* 를 사용합니다.
 */
export default function MergeFieldEditorModal({
  open,
  onClose,
  fieldDraft,
  setFieldDraft,
  fieldSaving,
  onSave,
  onResetDefault,
  resetButtonLabel = '기본값 복원',
  fieldGuideUsingCustom,
  /** DB에 저장된 필드 구성 이름(항상 표시; 매니저는 편집 가능) */
  fieldProfileName = '',
  setFieldProfileName,
  /** 시트에서 저장된 필드 구성(Mongo)을 고른 경우 true — 저장 시 해당 구성 PATCH */
  hasActiveProfile = false,
  canManageProfiles = false,
  /** 회사 기본 한 벌 모드에서: POST로 새 필드 구성 추가 */
  onCreateProfile,
  /** 저장된 구성 선택 시: 그 구성 전체 삭제(확인은 부모) */
  onDeleteProfile,
  fieldProfileNameMaxLength = 60
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !fieldDraft) return null;

  return (
    <div
      className="merge-field-editor-modal-root"
      role="dialog"
      aria-modal="true"
      aria-labelledby="merge-field-editor-modal-title"
    >
      <div className="merge-field-editor-modal-backdrop" aria-hidden />
      <div className="merge-field-editor-modal-panel">
        <header className="merge-field-editor-modal-head">
          <div className="merge-field-editor-modal-head-main">
            <h2 id="merge-field-editor-modal-title">문서 치환 항목 편집 (매니저 이상)</h2>
            <div className="merge-field-editor-modal-profile-name-row">
              <label htmlFor="merge-field-editor-profile-name" className="merge-field-editor-modal-profile-name-label">
                구성 이름 (저장될 때 쓰는 이름)
              </label>
              <input
                id="merge-field-editor-profile-name"
                className="merge-field-editor-modal-profile-name-input qdm-cell"
                value={fieldProfileName}
                onChange={(e) => {
                  if (!canManageProfiles) return;
                  setFieldProfileName?.(e.target.value.slice(0, fieldProfileNameMaxLength));
                }}
                maxLength={fieldProfileNameMaxLength}
                placeholder={
                  !canManageProfiles
                    ? '매니저 이상만 편집할 수 있습니다'
                    : hasActiveProfile
                      ? '예: 표준 견적 항목'
                      : '새 구성 이름을 적은 뒤 아래에서 DB 등록'
                }
                disabled={fieldSaving || !canManageProfiles}
                aria-describedby="merge-field-editor-profile-name-hint"
              />
              {canManageProfiles ? (
                <div className="merge-field-editor-modal-profile-actions">
                  {!hasActiveProfile ? (
                    <button
                      type="button"
                      className="qdm-btn qdm-btn-primary qdm-btn-small merge-field-editor-modal-profile-action-btn"
                      onClick={() => void onCreateProfile?.()}
                      disabled={fieldSaving || !String(fieldProfileName || '').trim()}
                      title="지금 표에 있는 항목 목록을 그대로, 이름 붙여 새 구성으로 DB에 만듭니다"
                    >
                      새 구성 DB 등록
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="qdm-btn qdm-btn-ghost qdm-btn-small merge-field-editor-modal-profile-action-btn"
                      onClick={() => void onDeleteProfile?.()}
                      disabled={fieldSaving}
                      title="이 이름의 저장 구성 전체를 DB에서 지웁니다(확인 후 진행)"
                    >
                      이 구성 삭제
                    </button>
                  )}
                </div>
              ) : null}
              <span id="merge-field-editor-profile-name-hint" className="merge-field-editor-modal-profile-name-hint">
                {!canManageProfiles
                  ? '구성 이름·DB에 새로 넣기·삭제는 매니저 이상만 할 수 있습니다.'
                  : hasActiveProfile
                    ? '표의 항목을 고친 뒤 하단 「저장」으로 DB에 반영합니다. 「이 구성 삭제」는 이 이름으로 저장된 구성 전체를 없앱니다.'
                    : '지금은 회사에 한 벌만 있는 기본 목록입니다. 위에 이름을 적고 「새 구성 DB 등록」을 누르면 그 이름으로 저장되고, 시트 맨 위 드롭다운에서도 고를 수 있습니다. 하단 「저장」만 누르면 여전히 회사 기본 한 벌만 바뀝니다.'}
              </span>
            </div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="편집 닫기" title="닫기" disabled={fieldSaving}>
            <span className="material-symbols-outlined" aria-hidden>
              close
            </span>
          </button>
        </header>

        <div className="merge-field-editor-modal-body">
          {fieldGuideUsingCustom ? (
            <p className="qdm-banner qdm-banner-ok merge-field-editor-modal-banner">
              이 회사는 Word/Excel에 넣을 {'{{항목}}'} 목록을 직접 맞춰 둔 상태입니다.
            </p>
          ) : null}

          <div className="qdm-field-editor">
            <div className="qdm-field-editor-toolbar">
              <button
                type="button"
                className="qdm-btn qdm-btn-ghost qdm-btn-small"
                onClick={() =>
                  setFieldDraft((d) => [
                    ...d,
                    {
                      key: '',
                      label: '',
                      example: '',
                      multiline: false,
                      excelSpreadLines: false,
                      valueKind: 'text',
                      excelFormat: 'general'
                    }
                  ])
                }
                disabled={fieldSaving}
              >
                필드 추가
              </button>
            </div>
            <div className="qdm-field-editor-table-wrap">
              <table className="qdm-field-editor-table">
                <thead>
                  <tr>
                    <th className="qdm-field-editor-th-key">키 (양식 {'{{키}}'})</th>
                    <th>표시 이름</th>
                    <th>예시</th>
                    <th className="qdm-field-editor-th-kind" title="Word는 항상 문자. Excel은 숫자·날짜·서식 적용 시">
                      값 종류
                    </th>
                    <th className="qdm-field-editor-th-format" title="Excel만. 셀에 {{키}}만 있을 때 표시 형식">
                      Excel 표시
                    </th>
                    <th>여러 줄</th>
                    <th className="qdm-field-editor-th-excel" title="Excel(.xlsx)만 적용. {{키}}가 있는 열에서 줄마다 아래 행에 값">
                      줄→아래 셀
                    </th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {fieldDraft.map((f, i) => (
                    <tr key={i}>
                      <td>
                        <input
                          className="qdm-cell"
                          value={f.key}
                          onChange={(e) =>
                            setFieldDraft((d) => d.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))
                          }
                          placeholder="예: unitPrice"
                          spellCheck={false}
                          disabled={fieldSaving}
                        />
                      </td>
                      <td>
                        <input
                          className="qdm-cell"
                          value={f.label}
                          onChange={(e) =>
                            setFieldDraft((d) => d.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                          }
                          placeholder="목록에 보일 이름"
                          disabled={fieldSaving}
                        />
                      </td>
                      <td>
                        <input
                          className="qdm-cell"
                          value={f.example}
                          onChange={(e) =>
                            setFieldDraft((d) => d.map((x, j) => (j === i ? { ...x, example: e.target.value } : x)))
                          }
                          disabled={fieldSaving}
                        />
                      </td>
                      <td>
                        <select
                          className="qdm-field-editor-select"
                          value={f.valueKind === 'number' ? 'number' : 'text'}
                          onChange={(e) => {
                            const vk = e.target.value === 'number' ? 'number' : 'text';
                            setFieldDraft((d) =>
                              d.map((x, j) =>
                                j === i
                                  ? {
                                      ...x,
                                      valueKind: vk,
                                      excelFormat: vk === 'text' ? 'general' : x.excelFormat || 'general'
                                    }
                                  : x
                              )
                            );
                          }}
                          aria-label="값 종류"
                          disabled={fieldSaving}
                        >
                          {MERGE_FIELD_VALUE_KINDS.map((opt) => (
                            <option key={opt.id} value={opt.id}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          className="qdm-field-editor-select"
                          value={f.valueKind === 'number' && f.excelFormat ? f.excelFormat : 'general'}
                          disabled={f.valueKind !== 'number' || fieldSaving}
                          onChange={(e) =>
                            setFieldDraft((d) => d.map((x, j) => (j === i ? { ...x, excelFormat: e.target.value } : x)))
                          }
                          aria-label="Excel 표시 형식"
                          title={f.valueKind !== 'number' ? '값 종류를 「숫자·날짜·서식」으로 바꾸면 선택할 수 있습니다.' : undefined}
                        >
                          {MERGE_EXCEL_FORMATS.map((opt) => (
                            <option key={opt.id} value={opt.id}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="qdm-field-editor-td-center">
                        <input
                          type="checkbox"
                          checked={Boolean(f.multiline)}
                          disabled={fieldSaving}
                          onChange={(e) =>
                            setFieldDraft((d) =>
                              d.map((x, j) =>
                                j === i
                                  ? {
                                      ...x,
                                      multiline: e.target.checked,
                                      excelSpreadLines: e.target.checked ? x.excelSpreadLines : false
                                    }
                                  : x
                              )
                            )
                          }
                        />
                      </td>
                      <td className="qdm-field-editor-td-center">
                        <input
                          type="checkbox"
                          checked={Boolean(f.multiline) && Boolean(f.excelSpreadLines)}
                          disabled={!f.multiline || fieldSaving}
                          title="Excel: 줄바꿈마다 같은 열의 다음 행(B2→B3…). Word·한 셀 줄바꿈만이면 끄기"
                          aria-label="Excel에서 줄마다 아래 셀에 채우기"
                          onChange={(e) =>
                            setFieldDraft((d) => d.map((x, j) => (j === i ? { ...x, excelSpreadLines: e.target.checked } : x)))
                          }
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="qdm-icon-btn"
                          title="이 필드 제거"
                          aria-label="이 필드 제거"
                          disabled={fieldSaving}
                          onClick={() => setFieldDraft((d) => (d.length <= 1 ? d : d.filter((_, j) => j !== i)))}
                        >
                          <span className="material-symbols-outlined">delete</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="qdm-field-editor-actions">
              <button type="button" className="qdm-btn qdm-btn-ghost qdm-btn-small" onClick={onClose} disabled={fieldSaving}>
                닫기
              </button>
              <button type="button" className="qdm-btn qdm-btn-ghost qdm-btn-small" onClick={() => void onResetDefault()} disabled={fieldSaving}>
                {resetButtonLabel}
              </button>
              <button type="button" className="qdm-btn qdm-btn-primary qdm-btn-small" onClick={() => void onSave()} disabled={fieldSaving}>
                {fieldSaving ? '저장 중…' : '저장'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
