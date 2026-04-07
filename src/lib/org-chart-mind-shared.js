/** Mind Elixir 기본 연결선은 Q/C 스플라인 — 루트~1차 자식용 직교(꺾은) 경로 */
export function mindOrgGenerateMainBranch({ pT, pL, pW, pH, cT, cL, cW, cH, direction }) {
  const py = pT + pH / 2;
  const cy = cT + cH / 2;
  if (direction === 'lhs') {
    const px = pL;
    const cx = cL + cW;
    const midX = (px + cx) / 2;
    return `M ${px} ${py} L ${midX} ${py} L ${midX} ${cy} L ${cx} ${cy}`;
  }
  const px = pL + pW;
  const cx = cL;
  const midX = (px + cx) / 2;
  return `M ${px} ${py} L ${midX} ${py} L ${midX} ${cy} L ${cx} ${cy}`;
}

/**
 * 깊은 단계 직교 연결선.
 * 이전 구현은 y=s+c(자식 하단)·끝점 i+l-gap(오른쪽)이라 선이 카드 안·글자를 가로지름.
 * RHS: 부모 오른쪽 → 자식 왼쪽 모서리(i)·세로 중앙(s+c/2)에서 종료.
 */
export function mindOrgGenerateSubBranch({ pT: e, pL: t, pW: n, pH: o, cT: s, cL: i, cW: l, cH: c, direction: r, isFirst: a }) {
  const h = a ? e + o / 2 : e + o;
  const cy = s + c / 2;
  if (r === 'lhs') {
    const gx = t;
    const endX = i + l;
    const midX = (gx + endX) / 2;
    return `M ${gx} ${h} L ${midX} ${h} L ${midX} ${cy} L ${endX} ${cy}`;
  }
  const gx = t + n;
  const endX = i;
  const midX = (gx + endX) / 2;
  return `M ${gx} ${h} L ${midX} ${h} L ${midX} ${cy} L ${endX} ${cy}`;
}

/** 조직도 전체가 보이도록 스케일·이동 (트리가 크면 축소 → 글자·노드가 함께 작아짐) */
export const CO_ORG_FIT_PAD = 16;
export const CO_ORG_SCALE_MIN = 0.06;
export const CO_ORG_SCALE_MAX = 1;
/** 좁은 화면: 가로 트리에서 vw/cw만으로 과축소되는 것을 막기 위한 하한(대략 읽기 가능한 크기) */
export const CO_ORG_MOBILE_MIN_READABLE_SCALE = 0.38;

function coOrgIsNarrowViewport() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(max-width: 768px)').matches;
}

export function mindOrgFitToView(mind) {
  const { map, nodes, container } = mind;
  if (!map || !nodes || !container) return;
  const vw = container.clientWidth - CO_ORG_FIT_PAD * 2;
  const vh = container.clientHeight - CO_ORG_FIT_PAD * 2;
  if (vw <= 1 || vh <= 1) return;

  const cw = Math.max(nodes.scrollWidth, nodes.offsetWidth, 1);
  const ch = Math.max(nodes.scrollHeight, nodes.offsetHeight, 1);

  const narrow = coOrgIsNarrowViewport();
  /** 모바일: 세로 기준 스케일 + 최소 확대(가로는 컨테이너 스크롤·패닝) — 가로만 맞추면 글자가 너무 작아짐 */
  let raw;
  if (narrow) {
    raw = Math.max(CO_ORG_MOBILE_MIN_READABLE_SCALE, Math.min(CO_ORG_SCALE_MAX, vh / ch));
  } else {
    raw = Math.min(CO_ORG_SCALE_MAX, vw / cw, vh / ch);
  }
  const scale = narrow ? raw : Math.max(raw, CO_ORG_SCALE_MIN);
  mind.scaleVal = scale;

  map.style.transformOrigin = '0 0';
  const scaledW = scale * cw;
  const scaledH = scale * ch;
  let ox = CO_ORG_FIT_PAD + (vw - scaledW) / 2;
  let oy = CO_ORG_FIT_PAD + (vh - scaledH) / 2;
  if (narrow) {
    ox = CO_ORG_FIT_PAD;
    oy = CO_ORG_FIT_PAD + Math.max(0, (vh - scaledH) / 2);
  }
  map.style.transform = `translate3d(${ox}px, ${oy}px, 0) scale(${scale})`;
}

const CO_ORG_SVG_NS = 'http://www.w3.org/2000/svg';

/** subLines가 붙는 컬럼 me-wrapper 기준 — 자식 me-tpc의 실제 박스 좌표(맵 변환 반영) */
function coOrgRectRelToAnchor(anchor, el) {
  if (!anchor || !el) return { left: 0, top: 0, width: 0, height: 0 };
  const ar = anchor.getBoundingClientRect();
  const er = el.getBoundingClientRect();
  return {
    left: er.left - ar.left,
    top: er.top - ar.top,
    width: er.width,
    height: er.height
  };
}

function coOrgSvgPath(d, stroke, strokeWidth) {
  const o = document.createElementNS(CO_ORG_SVG_NS, 'path');
  o.setAttribute('d', d);
  o.setAttribute('stroke', stroke || '#666');
  o.setAttribute('fill', 'none');
  o.setAttribute('stroke-width', strokeWidth);
  return o;
}

function coOrgSvgSubLines() {
  const t = document.createElementNS(CO_ORG_SVG_NS, 'svg');
  t.setAttribute('class', 'subLines');
  t.setAttribute('overflow', 'visible');
  return t;
}

function jMindNodes(nodesEl, topicEl) {
  let n = 0;
  let o = 0;
  let t = topicEl;
  for (; t && t !== nodesEl; ) {
    n += t.offsetLeft;
    o += t.offsetTop;
    t = t.offsetParent;
  }
  return { offsetLeft: n, offsetTop: o };
}

/**
 * Mind Elixir 기본 dt는 자식 offset을 자식 me-wrapper 기준으로만 넘겨,
 * subLines SVG(상위 me-wrapper 좌표)와 어긋남 → 선이 박스 앞에서 끊김.
 * 앵커(해당 컬럼 최상위 me-wrapper) 대비 부모·자식 me-tpc 박스로 generateSubBranch 호출.
 */
function coOrgDt(mind, svg, branchColor, wrapper, directionClass, isFirst, anchor) {
  const rootAnchor = anchor || wrapper;
  const parentMeParent = wrapper.firstChild;
  const meChildren = wrapper.children[1];
  if (!parentMeParent || !meChildren?.children?.length) return;

  const parentTpc = parentMeParent.querySelector('me-tpc');
  if (!parentTpc) return;

  const pr = coOrgRectRelToAnchor(rootAnchor, parentTpc);

  for (let u = 0; u < meChildren.children.length; u += 1) {
    const y = meChildren.children[u];
    const childMeParent = y.firstChild;
    if (!childMeParent) continue;
    const childTpc = childMeParent.querySelector('me-tpc');
    if (!childTpc) continue;

    const cr = coOrgRectRelToAnchor(rootAnchor, childTpc);
    const subColor = childTpc.nodeObj?.branchColor || branchColor;
    const dPath = mind.generateSubBranch({
      pT: pr.top,
      pL: pr.left,
      pW: pr.width,
      pH: pr.height,
      cT: cr.top,
      cL: cr.left,
      cW: cr.width,
      cH: cr.height,
      direction: directionClass,
      isFirst
    });
    svg.appendChild(coOrgSvgPath(dPath, subColor, '2'));

    const deeper = childMeParent.children[1];
    if (deeper && deeper.expanded) {
      coOrgDt(mind, svg, subColor, y, directionClass, undefined, rootAnchor);
    }
  }
}

export function coOrgPn(mind, partialWrapper) {
  const root = mind.map.querySelector('me-root');
  if (!root) return;
  const n = root.offsetTop;
  const o = root.offsetLeft;
  const s = root.offsetWidth;
  const i = root.offsetHeight;
  const wrappers = mind.map.querySelectorAll('me-main > me-wrapper');
  mind.lines.innerHTML = '';

  for (let c = 0; c < wrappers.length; c += 1) {
    const r = wrappers[c];
    const topic = r.querySelector('me-tpc');
    if (!topic) continue;
    const { offsetLeft: d, offsetTop: h } = jMindNodes(mind.nodes, topic);
    const u = topic.offsetWidth;
    const y = topic.offsetHeight;
    const v = r.parentNode.className;
    const p = mind.generateMainBranch({
      pT: n,
      pL: o,
      pW: s,
      pH: i,
      cT: h,
      cL: d,
      cW: u,
      cH: y,
      direction: v,
      containerHeight: mind.nodes.offsetHeight
    });
    const palette = mind.theme.palette;
    const m = topic.nodeObj.branchColor || palette[c % palette.length];
    topic.style.borderColor = m;
    mind.lines.appendChild(coOrgSvgPath(p, m, '3'));
    if (partialWrapper && partialWrapper !== r) continue;

    const b = coOrgSvgSubLines();
    const last = r.lastChild;
    if (last?.tagName === 'svg') last.remove();
    r.appendChild(b);
    coOrgDt(mind, b, m, r, v, true, r);
  }

  mind.labelContainer.innerHTML = '';
  mind.renderArrow();
  mind.renderSummary();
  mind.bus.fire('linkDiv');
}
