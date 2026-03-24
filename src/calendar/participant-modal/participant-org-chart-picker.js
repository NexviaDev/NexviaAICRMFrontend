import { useEffect, useRef, useCallback, useState } from 'react';
import 'mind-elixir/style.css';
import {
  mindOrgGenerateMainBranch,
  mindOrgGenerateSubBranch,
  mindOrgFitToView,
  CO_ORG_SCALE_MIN,
  CO_ORG_SCALE_MAX,
  coOrgPn
} from '@/lib/org-chart-mind-shared';
import { flattenOrgChartNodeIds } from '@/lib/org-chart-tree-utils';

function applyOrgSelectionHighlight(mind, organizationChart, selectedOrgIds) {
  if (!mind?.findEle || !organizationChart) return;
  const selected = new Set((selectedOrgIds || []).map((id) => String(id)));
  const ids = flattenOrgChartNodeIds(organizationChart);
  for (const id of ids) {
    let tpc;
    try {
      const w = mind.findEle(id);
      tpc = w?.querySelector?.('me-tpc') || null;
    } catch {
      continue;
    }
    if (!tpc) continue;
    if (selected.has(String(id))) tpc.classList.add('participant-org-tpc--selected');
    else tpc.classList.remove('participant-org-tpc--selected');
  }
}

export default function ParticipantOrgChartPicker({ organizationChart, selectedOrgIds, onToggleOrgId }) {
  const mindContainerRef = useRef(null);
  const mindInstanceRef = useRef(null);
  const onToggleRef = useRef(onToggleOrgId);
  const [mindEpoch, setMindEpoch] = useState(0);
  onToggleRef.current = onToggleOrgId;

  const toMindNode = useCallback((node) => {
    if (!node) return null;
    return {
      id: String(node.id || `org_${Date.now().toString(36)}`),
      topic: node.roleLabel ? `${node.name || ''}\n${node.roleLabel}` : (node.name || ''),
      children: (node.children || []).map(toMindNode).filter(Boolean)
    };
  }, []);

  useEffect(() => {
    if (!organizationChart || !mindContainerRef.current) return undefined;
    let cancelled = false;
    let debounceTimer = 0;
    /** @type {ResizeObserver | null} */
    let resizeObs = null;
    let mindForCleanup = null;

    const scheduleFitDebounced = () => {
      window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => {
        debounceTimer = 0;
        if (cancelled || !mindForCleanup) return;
        mindOrgFitToView(mindForCleanup);
      }, 120);
    };

    const scheduleFitSoon = () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (cancelled || !mindForCleanup) return;
          mindOrgFitToView(mindForCleanup);
        });
      });
    };

    const onOperation = () => {
      scheduleFitDebounced();
    };
    const onExpandNode = () => scheduleFitSoon();

    (async () => {
      const mod = await import('mind-elixir');
      const MindElixir = mod.default;
      if (cancelled || !mindContainerRef.current) return;
      if (mindInstanceRef.current) {
        mindInstanceRef.current.destroy();
        mindInstanceRef.current = null;
      }
      const mind = new MindElixir({
        el: mindContainerRef.current,
        direction: MindElixir.RIGHT,
        editable: false,
        contextMenu: false,
        toolBar: false,
        keypress: false,
        allowUndo: false,
        scaleMin: CO_ORG_SCALE_MIN,
        scaleMax: CO_ORG_SCALE_MAX,
        generateMainBranch: mindOrgGenerateMainBranch,
        generateSubBranch: mindOrgGenerateSubBranch,
        handleWheel: (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
        }
      });
      mind.toCenter = function participantOrgMindToCenter() {
        mindOrgFitToView(this);
      };
      mind.linkDiv = function participantOrgLinkDiv(partial) {
        return coOrgPn(this, partial);
      };
      mindForCleanup = mind;
      if (cancelled) {
        mind.destroy();
        mindForCleanup = null;
        return;
      }
      mind.init({ nodeData: toMindNode(organizationChart) });
      if (cancelled) {
        mind.destroy();
        mindForCleanup = null;
        return;
      }
      mind.dragMoveHelper.onMove = () => {};
      mindInstanceRef.current = mind;
      /**
       * Mind Elixir는 editable:false 일 때 노드 클릭으로 selectNewNode를 쏘지 않고 곧바로 return 한다.
       * (dist/MindElixir.js mouseup: `else if (!e.editable) return` → v() 미호출)
       * 읽기 전용 유지 + 다중 선택만 캡처 단계에서 처리한다.
       */
      const onMindPickerClick = (ev) => {
        if (ev.target?.closest?.('me-epd')) return;
        const tpc = ev.target?.closest?.('me-tpc');
        const id = tpc?.nodeObj?.id;
        if (id == null || id === '') return;
        ev.preventDefault();
        ev.stopPropagation();
        onToggleRef.current?.(String(id));
      };
      mind.container.addEventListener('click', onMindPickerClick, true);
      mindForCleanup._participantOrgPickerClick = onMindPickerClick;
      mind.bus.addListener('operation', onOperation);
      mind.bus.addListener('expandNode', onExpandNode);
      if (typeof ResizeObserver !== 'undefined' && mind.container) {
        resizeObs = new ResizeObserver(() => scheduleFitSoon());
        resizeObs.observe(mind.container);
      }
      scheduleFitSoon();
      setMindEpoch((e) => e + 1);
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(debounceTimer);
      if (mindForCleanup?.container && mindForCleanup._participantOrgPickerClick) {
        mindForCleanup.container.removeEventListener('click', mindForCleanup._participantOrgPickerClick, true);
        mindForCleanup._participantOrgPickerClick = null;
      }
      if (mindForCleanup?.bus) {
        mindForCleanup.bus.removeListener('operation', onOperation);
        mindForCleanup.bus.removeListener('expandNode', onExpandNode);
      }
      resizeObs?.disconnect();
      if (mindForCleanup) {
        mindForCleanup.destroy();
        mindForCleanup = null;
      }
      if (mindInstanceRef.current) {
        mindInstanceRef.current = null;
      }
    };
  }, [organizationChart, toMindNode]);

  useEffect(() => {
    const mind = mindInstanceRef.current;
    if (!mind || !organizationChart) return;
    applyOrgSelectionHighlight(mind, organizationChart, selectedOrgIds);
  }, [selectedOrgIds, organizationChart, mindEpoch]);

  return (
    <div
      ref={mindContainerRef}
      className="co-org-mind co-org-mind--readonly participant-modal-org-mind"
      role="application"
      aria-label="조직도에서 노드를 클릭해 다중 선택"
    />
  );
}
