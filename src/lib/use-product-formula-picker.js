import { useCallback, useLayoutEffect, useRef } from 'react';
import {
  insertFormulaFunctionAtCursor,
  insertFormulaInputFieldAtCursor
} from '@/lib/custom-field-formula';

function getInsertSelection(el, fallbackValue, selectionRef) {
  let start = 0;
  let end = 0;
  if (el && typeof el.selectionStart === 'number' && document.activeElement === el) {
    start = el.selectionStart;
    end = el.selectionEnd ?? start;
  } else if (selectionRef?.current && typeof selectionRef.current.start === 'number') {
    start = selectionRef.current.start;
    end = selectionRef.current.end ?? start;
  } else {
    const cur = String(fallbackValue ?? el?.value ?? '');
    start = cur.length;
    end = start;
  }
  return { start, end };
}

/**
 * 제품 모달 — 수식 입력란 커서 위치 삽입 + 필드/함수 패널 연동
 */
export function useProductFormulaPicker(fieldValuesRef, fieldSettersRef) {
  const activeFieldKeyRef = useRef('listPrice');
  const activeInputRef = useRef(null);
  const selectionRef = useRef({ start: 0, end: 0 });
  const pendingCaretRef = useRef(null);

  const captureSelection = useCallback((fieldKey, e) => {
    const el = e?.target;
    if (!el || typeof el.selectionStart !== 'number') return;
    activeFieldKeyRef.current = fieldKey;
    activeInputRef.current = el;
    selectionRef.current = {
      start: el.selectionStart,
      end: el.selectionEnd ?? el.selectionStart
    };
  }, []);

  const applyTransform = useCallback((transformFn) => {
    const fieldKey = activeFieldKeyRef.current;
    const setValue = fieldSettersRef.current?.[fieldKey];
    const getValue = fieldValuesRef.current?.[fieldKey];
    if (typeof setValue !== 'function' || typeof getValue !== 'function') return;

    const el = activeInputRef.current;
    const current = String(getValue() ?? '');
    const { start, end } = getInsertSelection(el, current, selectionRef);
    const { value, caret } = transformFn(current, start, end);
    setValue(value);
    selectionRef.current = { start: caret, end: caret };
    pendingCaretRef.current = { el, caret };
  }, [fieldSettersRef, fieldValuesRef]);

  const insertFieldLabel = useCallback((label) => {
    applyTransform((cur, start, end) => insertFormulaInputFieldAtCursor(cur, label, start, end));
  }, [applyTransform]);

  const insertFunctionName = useCallback((fnName) => {
    applyTransform((cur, start, end) => insertFormulaFunctionAtCursor(cur, fnName, start, end));
  }, [applyTransform]);

  useLayoutEffect(() => {
    const pending = pendingCaretRef.current;
    if (!pending?.el) return;
    pendingCaretRef.current = null;
    pending.el.focus?.({ preventScroll: true });
    if (typeof pending.caret === 'number') {
      pending.el.setSelectionRange?.(pending.caret, pending.caret);
    }
  });

  const bindFormulaField = useCallback(
    (fieldKey) => ({
      onFocus: (e) => captureSelection(fieldKey, e),
      onClick: (e) => captureSelection(fieldKey, e),
      onSelect: (e) => captureSelection(fieldKey, e),
      onKeyUp: (e) => captureSelection(fieldKey, e),
      onBlur: (e) => captureSelection(fieldKey, e)
    }),
    [captureSelection]
  );

  return {
    bindFormulaField,
    insertFieldLabel,
    insertFunctionName
  };
}
