import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getListColumnWidthPx,
  isListColumnResizable,
  LIST_COLUMN_FIXED_WIDTH_PX,
  LIST_COLUMN_WIDTH_MIN,
  LIST_COLUMN_WIDTH_MAX,
  sumListTableWidthPx
} from '@/lib/list-column-widths';

/**
 * @param {object} params
 * @param {Record<string, number>} params.columnWidths
 * @param {string[]} params.displayColumnKeys
 * @param {(columnWidths: Record<string, number>) => void|Promise<void>} params.onPersistWidths
 * @param {number[]} [params.leadingColWidthsPx]
 */
export function useCrmListColumnResize({
  columnWidths = {},
  displayColumnKeys = [],
  onPersistWidths,
  leadingColWidthsPx = []
}) {
  const [draftWidths, setDraftWidths] = useState(null);
  const resizingRef = useRef(null);
  const effectiveWidths = draftWidths ?? columnWidths ?? {};

  const tableWidthPx = useMemo(
    () => sumListTableWidthPx(displayColumnKeys, effectiveWidths, { leadingPx: leadingColWidthsPx }),
    [displayColumnKeys, effectiveWidths, leadingColWidthsPx]
  );

  const getWidthPx = useCallback(
    (columnKey) => getListColumnWidthPx(columnKey, effectiveWidths),
    [effectiveWidths]
  );

  const endResize = useCallback(() => {
    const ctx = resizingRef.current;
    if (!ctx) return;
    resizingRef.current = null;
    document.body.classList.remove('crm-list-col-resizing');
    document.body.style.removeProperty('cursor');
    document.body.style.removeProperty('user-select');
    const next = { ...columnWidths, ...ctx.latest };
    setDraftWidths(null);
    void onPersistWidths(next);
  }, [columnWidths, onPersistWidths]);

  useEffect(() => {
    const onMove = (e) => {
      const ctx = resizingRef.current;
      if (!ctx) return;
      const delta = e.clientX - ctx.startX;
      const nextW = Math.max(ctx.minW, Math.min(ctx.maxW, ctx.startW + delta));
      ctx.latest = { ...ctx.base, [ctx.key]: nextW };
      setDraftWidths(ctx.latest);
    };
    const onUp = () => endResize();
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [endResize]);

  const startResize = useCallback(
    (e, columnKey) => {
      if (!isListColumnResizable(columnKey)) return;
      e.preventDefault();
      e.stopPropagation();
      const startW = getListColumnWidthPx(columnKey, effectiveWidths);
      const base = { ...effectiveWidths };
      resizingRef.current = {
        key: columnKey,
        startX: e.clientX,
        startW,
        base,
        latest: { ...base, [columnKey]: startW },
        minW: LIST_COLUMN_WIDTH_MIN,
        maxW: LIST_COLUMN_WIDTH_MAX
      };
      document.body.classList.add('crm-list-col-resizing');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [effectiveWidths]
  );

  return {
    getWidthPx,
    tableWidthPx,
    startResize,
    isResizing: Boolean(draftWidths)
  };
}

export function CrmListColgroup({ leadingCols = [], displayColumns = [], getWidthPx }) {
  return (
    <colgroup>
      {leadingCols.map((col) => {
        const w = col.widthPx ?? LIST_COLUMN_FIXED_WIDTH_PX.__rowCheckbox__;
        return (
          <col
            key={col.key}
            style={{ width: `${w}px`, minWidth: `${w}px`, maxWidth: `${w}px` }}
          />
        );
      })}
      {displayColumns.map((col) => {
        const w = getWidthPx(col.key);
        return (
          <col
            key={col.key}
            style={{ width: `${w}px`, minWidth: `${w}px`, maxWidth: `${w}px` }}
          />
        );
      })}
      <col className="crm-list-sheet-fill-col" />
    </colgroup>
  );
}

/**
 * @param {object} props
 * @param {string} props.columnKey
 * @param {(e: React.MouseEvent, key: string) => void} props.onResizeStart
 * @param {boolean} [props.disabled]
 */
export function CrmListColumnResizeHandle({ columnKey, onResizeStart, disabled = false }) {
  if (disabled || !isListColumnResizable(columnKey)) return null;
  return (
    <span
      className="crm-list-col-resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label="열 너비 조절"
      title="드래그하여 열 너비 조절"
      onMouseDown={(e) => onResizeStart(e, columnKey)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    />
  );
}
