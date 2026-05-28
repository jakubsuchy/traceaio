import { useQuery } from "@tanstack/react-query";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { getModelColor } from "@shared/models";

interface DomainTrendsData {
  runs: {
    runId: number;
    date: string;
    totalCitations: number;
    modelCitations: Record<string, number>;
  }[];
  modelLabels: Record<string, string>;
}

interface Props {
  domain: string;
  model?: string;
  runId?: string;
  onSelectRun?: (runId: string) => void;
}

export function DomainTrendChart({ domain, model, runId, onSelectRun }: Props) {
  const params = new URLSearchParams();
  if (model) params.set("model", model);
  const paramStr = params.toString() ? `?${params.toString()}` : "";

  const { data, isLoading } = useQuery<DomainTrendsData>({
    queryKey: [`/api/sources/${encodeURIComponent(domain)}/trends${paramStr}`],
    enabled: !runId,
  });

  if (runId) {
    return (
      <div className="p-4 text-sm text-slate-500">
        Viewing a single run.{' '}
        <button
          onClick={() => onSelectRun?.("all")}
          className="text-indigo-600 hover:text-indigo-800 underline underline-offset-2"
        >
          View all runs
        </button>{' '}
        to see citation trends over time.
      </div>
    );
  }

  if (isLoading) {
    return <div className="p-4"><Skeleton className="h-[220px] w-full" /></div>;
  }

  if (!data || data.runs.length === 0) {
    return (
      <div className="p-4 h-[220px] flex items-center justify-center text-sm text-slate-400">
        Run multiple analyses to see citation trends
      </div>
    );
  }

  const allModelKeys = new Set<string>();
  for (const run of data.runs) {
    for (const m of Object.keys(run.modelCitations)) allModelKeys.add(m);
  }
  const modelKeys = Array.from(allModelKeys);

  // Least-squares linear regression on (index, totalCitations). Skip when
  // there are fewer than 2 points — a slope through one point is undefined.
  const ys = data.runs.map(r => r.totalCitations);
  const n = ys.length;
  let trendOf: (i: number) => number | undefined = () => undefined;
  if (n >= 2) {
    const meanX = (n - 1) / 2;
    const meanY = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      num += (i - meanX) * (ys[i] - meanY);
      den += (i - meanX) * (i - meanX);
    }
    const slope = den === 0 ? 0 : num / den;
    const intercept = meanY - slope * meanX;
    trendOf = (i: number) => slope * i + intercept;
  }

  const chartData = data.runs.map((run, i) => ({
    date: new Date(run.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    runId: run.runId,
    total: run.totalCitations,
    trend: trendOf(i),
    ...run.modelCitations,
  }));

  const overallColor = "hsl(250, 50%, 40%)";
  const trendColor = "hsl(0, 0%, 50%)";
  const chartConfig: ChartConfig = {
    total: { label: "Total citations", color: overallColor },
    trend: { label: "Trend", color: trendColor },
  };
  for (const m of modelKeys) {
    chartConfig[m] = {
      label: data.modelLabels[m] || m,
      color: getModelColor(m),
    };
  }

  const handleChartClick = (state: any) => {
    if (state?.activePayload?.[0]?.payload?.runId && onSelectRun) {
      onSelectRun(state.activePayload[0].payload.runId.toString());
    }
  };

  return (
    <div className="p-4">
      <ChartContainer config={chartConfig} className="h-[220px] w-full">
        <ComposedChart
          data={chartData}
          margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
          onClick={handleChartClick}
          style={{ cursor: onSelectRun ? "pointer" : "default" }}
        >
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} width={40} />
          <ChartTooltip content={<ChartTooltipContent />} />
          {modelKeys.length > 1 && modelKeys.map(m => (
            <Area
              key={m}
              type="linear"
              dataKey={m}
              stroke={`var(--color-${m})`}
              fill={`var(--color-${m})`}
              fillOpacity={0.05}
              strokeWidth={1.5}
              dot={false}
              connectNulls
            />
          ))}
          <Area
            type="linear"
            dataKey="total"
            stroke="var(--color-total)"
            fill="var(--color-total)"
            fillOpacity={0.1}
            strokeWidth={2.5}
            dot={chartData.length <= 10}
          />
          {n >= 2 && (
            <Line
              type="linear"
              dataKey="trend"
              stroke="var(--color-trend)"
              strokeWidth={1.5}
              strokeDasharray="4 4"
              dot={false}
              activeDot={false}
              isAnimationActive={false}
            />
          )}
        </ComposedChart>
      </ChartContainer>
    </div>
  );
}
