import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from 'recharts';
import { format } from 'date-fns';
import { ChartContainer, ChartTooltip } from '@/components/ui/chart';
import { cn } from '@/lib/utils';

const CONFIG = {
  temp: { label: 'Temperatura', color: 'var(--chart-1)' },
};
const MAX_COLOR = 'var(--alarm)';
const MIN_COLOR = 'oklch(0.609 0.126 221.723)';

// Przerwa w danych (plytka offline) = przerwa na wykresie, zamiast prostej linii laczacej punkty
function withGaps(points, bucketS) {
  const maxGap = Math.max(bucketS, 300) * 3;
  const result = [];
  points.forEach((p, i) => {
    if (i > 0 && p.ts - points[i - 1].ts > maxGap) {
      result.push({ ts: points[i - 1].ts + 1, temp: null });
    }
    result.push(p);
  });
  return result;
}

function tickFormatter(span) {
  if (span <= 36 * 3600) return (ts) => format(new Date(ts * 1000), 'HH:mm');
  if (span <= 8 * 86400) return (ts) => format(new Date(ts * 1000), 'dd.MM HH:mm');
  return (ts) => format(new Date(ts * 1000), 'dd.MM');
}

function TooltipContent({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  if (p.temp === null) return null;
  return (
    <div className="grid gap-0.5 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <div className="text-muted-foreground">{format(new Date(p.ts * 1000), 'dd.MM.yyyy HH:mm')}</div>
      <div className="tabular text-sm font-semibold">{p.temp.toFixed(1)} °C</div>
    </div>
  );
}

/**
 * Prawdziwe pomiary {ts, temp} - bez usredniania. bucketS > 0: backend zostawil z kazdego przedzialu
 * najnizszy i najwyzszy pomiar (bardzo dlugi zakres), wiec przekroczenia nadal sa widoczne.
 * className: wysokosc wykresu (domyslnie stala; na pelnym ekranie wypelnia miejsce).
 */
export default function TemperatureChart({ points, bucketS, start, end, minTemp, maxTemp, className = 'h-72 sm:h-80' }) {
  if (!points.length) {
    return (
      <div className={cn('flex items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground', className)}>
        Brak pomiarów w wybranym zakresie
      </div>
    );
  }

  const data = withGaps(points, bucketS);
  const values = points.map((p) => p.temp);
  if (minTemp != null) values.push(minTemp);
  if (maxTemp != null) values.push(maxTemp);
  const yDomain = [Math.floor(Math.min(...values) - 1), Math.ceil(Math.max(...values) + 1)];

  return (
    <ChartContainer config={CONFIG} className={cn('aspect-auto w-full', className)}>
      <LineChart data={data} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="ts" type="number" scale="time" domain={[start, end]}
          tickFormatter={tickFormatter(end - start)} minTickGap={48} tickLine={false} axisLine={false} tickMargin={8}
        />
        <YAxis
          domain={yDomain} width={44} tickFormatter={(v) => `${v}°`} allowDecimals={false}
          tickLine={false} axisLine={false}
        />
        <ChartTooltip content={<TooltipContent />} />
        <Line
          dataKey="temp" stroke="var(--color-temp)" strokeWidth={1.75} dot={false}
          activeDot={{ r: 4 }} isAnimationActive={false} connectNulls={false}
        />
        {maxTemp != null && (
          <ReferenceLine
            y={maxTemp} stroke={MAX_COLOR} strokeDasharray="6 4"
            label={{ value: `max ${maxTemp}°`, position: 'insideTopRight', fill: MAX_COLOR, fontSize: 11 }}
          />
        )}
        {minTemp != null && (
          <ReferenceLine
            y={minTemp} stroke={MIN_COLOR} strokeDasharray="6 4"
            label={{ value: `min ${minTemp}°`, position: 'insideBottomRight', fill: MIN_COLOR, fontSize: 11 }}
          />
        )}
      </LineChart>
    </ChartContainer>
  );
}
