import {
  Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { format } from 'date-fns';

const COLORS = { line: '#2563eb', band: '#93c5fd', max: '#dc2626', min: '#0891b2', grid: '#e5e7eb', axis: '#6b7280' };

// Przerwa w danych (plytka offline) = przerwa na wykresie, zamiast prostej linii laczacej punkty
function withGaps(points, bucketS) {
  const maxGap = Math.max(bucketS, 300) * 3;
  const result = [];
  points.forEach((p, i) => {
    if (i > 0 && p.ts - points[i - 1].ts > maxGap) {
      result.push({ ts: points[i - 1].ts + 1, avg: null, range: null });
    }
    result.push({ ...p, range: [p.min, p.max] });
  });
  return result;
}

function tickFormatter(span) {
  if (span <= 36 * 3600) return (ts) => format(new Date(ts * 1000), 'HH:mm');
  if (span <= 8 * 86400) return (ts) => format(new Date(ts * 1000), 'dd.MM HH:mm');
  return (ts) => format(new Date(ts * 1000), 'dd.MM');
}

function ChartTooltip({ active, payload, bucketS }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  if (p.avg === null) return null;
  return (
    <div className="chart-tooltip">
      <div className="muted small">{format(new Date(p.ts * 1000), 'dd.MM.yyyy HH:mm')}</div>
      <div><strong>{p.avg.toFixed(1)} °C</strong>{bucketS > 0 && ' (średnia)'}</div>
      {bucketS > 0 && <div className="small">min {p.min.toFixed(1)} / max {p.max.toFixed(1)} °C</div>}
    </div>
  );
}

export default function TemperatureChart({ points, bucketS, start, end, minTemp, maxTemp }) {
  if (!points.length) {
    return <div className="chart-empty">Brak pomiarów w wybranym zakresie</div>;
  }

  const data = withGaps(points, bucketS);
  const values = points.flatMap((p) => [p.min, p.max]);
  if (minTemp != null) values.push(minTemp);
  if (maxTemp != null) values.push(maxTemp);
  const yDomain = [Math.floor(Math.min(...values) - 1), Math.ceil(Math.max(...values) + 1)];

  return (
    <ResponsiveContainer width="100%" height={360}>
      <ComposedChart data={data} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
        <XAxis
          dataKey="ts" type="number" scale="time" domain={[start, end]}
          tickFormatter={tickFormatter(end - start)} minTickGap={40} stroke={COLORS.axis} fontSize={12}
        />
        <YAxis domain={yDomain} width={56} tickFormatter={(v) => `${v}°`} stroke={COLORS.axis} fontSize={12} allowDecimals={false} />
        <Tooltip content={<ChartTooltip bucketS={bucketS} />} />
        {bucketS > 0 && (
          <Area dataKey="range" stroke="none" fill={COLORS.band} fillOpacity={0.45} isAnimationActive={false} connectNulls={false} />
        )}
        <Line dataKey="avg" stroke={COLORS.line} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
        {maxTemp != null && (
          <ReferenceLine y={maxTemp} stroke={COLORS.max} strokeDasharray="6 4"
            label={{ value: `max ${maxTemp}°`, position: 'insideTopRight', fill: COLORS.max, fontSize: 12 }} />
        )}
        {minTemp != null && (
          <ReferenceLine y={minTemp} stroke={COLORS.min} strokeDasharray="6 4"
            label={{ value: `min ${minTemp}°`, position: 'insideBottomRight', fill: COLORS.min, fontSize: 12 }} />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
