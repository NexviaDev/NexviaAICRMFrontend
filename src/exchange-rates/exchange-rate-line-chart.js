function formatRate(value) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
}

function buildChartGeometry(points, width, height, padding) {
  const values = points.map((p) => Number(p.value)).filter((v) => Number.isFinite(v));
  if (!values.length) return null;

  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const spread = maxV - minV || Math.max(maxV * 0.02, 1);
  const yMin = minV - spread * 0.08;
  const yMax = maxV + spread * 0.08;
  const yRange = yMax - yMin || 1;

  const coords = points.map((pt, i) => {
    const x =
      points.length === 1
        ? padding.left + innerW / 2
        : padding.left + (innerW * i) / (points.length - 1);
    const y = padding.top + innerH - ((Number(pt.value) - yMin) / yRange) * innerH;
    return { x, y, point: pt };
  });

  return { coords, yMin, yMax, innerW, innerH };
}

/** Catmull-Rom → cubic Bézier 곡선 path */
function buildSmoothPath(coords) {
  if (!coords.length) return '';
  if (coords.length === 1) {
    const { x, y } = coords[0];
    return `M ${x} ${y}`;
  }
  if (coords.length === 2) {
    return `M ${coords[0].x} ${coords[0].y} L ${coords[1].x} ${coords[1].y}`;
  }

  let d = `M ${coords[0].x} ${coords[0].y}`;
  for (let i = 0; i < coords.length - 1; i += 1) {
    const p0 = coords[i - 1] || coords[i];
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const p3 = coords[i + 2] || p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

function buildAreaPath(linePath, coords, height, padding) {
  if (!coords.length) return '';
  const baseY = padding.top + (height - padding.top - padding.bottom);
  const first = coords[0];
  const last = coords[coords.length - 1];
  return `${linePath} L ${last.x} ${baseY} L ${first.x} ${baseY} Z`;
}

export default function ExchangeRateLineChart({ points, width = 720, height = 280 }) {
  const padding = { top: 18, right: 16, bottom: 36, left: 56 };
  const validPoints = (points || []).filter((p) => p?.value != null && Number.isFinite(Number(p.value)));

  if (!validPoints.length) {
    return (
      <div className="er-chart-empty" role="status">
        표시할 환율 이력이 없습니다. KST 기준으로 데이터가 쌓이면 그래프가 표시됩니다.
      </div>
    );
  }

  const geometry = buildChartGeometry(validPoints, width, height, padding);
  if (!geometry) return null;

  const { coords, yMin, yMax } = geometry;
  const linePath = buildSmoothPath(coords);
  const areaPath = buildAreaPath(linePath, coords, height, padding);

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
    y: padding.top + (height - padding.top - padding.bottom) * (1 - t),
    value: yMin + (yMax - yMin) * t
  }));

  const xLabelStep = Math.max(1, Math.ceil(validPoints.length / 6));
  const xLabels = coords.filter((_, i) => i === 0 || i === coords.length - 1 || i % xLabelStep === 0);

  return (
    <div className="er-chart-wrap">
      <svg
        className="er-chart-svg"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="환율 변화 곡선 그래프"
      >
        {yTicks.map((tick) => (
          <g key={tick.y}>
            <line
              x1={padding.left}
              y1={tick.y}
              x2={width - padding.right}
              y2={tick.y}
              className="er-chart-grid-line"
            />
            <text x={padding.left - 8} y={tick.y + 4} className="er-chart-axis-label" textAnchor="end">
              {formatRate(tick.value)}
            </text>
          </g>
        ))}

        <path d={areaPath} className="er-chart-area" />
        <path d={linePath} className="er-chart-line" fill="none" />

        {coords.map(({ x, y, point }) => (
          <circle key={`${point.periodKey}-${x}`} cx={x} cy={y} r={3.5} className="er-chart-dot">
            <title>
              {point.label}: {formatRate(point.value)} KRW
            </title>
          </circle>
        ))}

        {xLabels.map(({ x, point }) => (
          <text key={`${point.periodKey}-x`} x={x} y={height - 10} className="er-chart-x-label" textAnchor="middle">
            {point.label}
          </text>
        ))}
      </svg>
    </div>
  );
}
