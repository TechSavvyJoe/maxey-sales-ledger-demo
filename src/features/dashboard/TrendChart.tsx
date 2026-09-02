import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCurrency } from "@/domain/money";

interface TrendChartPoint {
  month: string;
  units: number;
  commission: number;
}

interface TrendChartProps {
  data: TrendChartPoint[];
  year: number;
}

/** Loaded only when the performance trend is opened, keeping the core dashboard quick on smaller devices. */
export function TrendChart({ data, year }: TrendChartProps) {
  return (
    <div
      className="trend-chart"
      role="img"
      aria-label={`${year} chart of delivered units and estimated commission by month`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart accessibilityLayer={false} data={data} margin={{ top: 10, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid stroke="#dbe3eb" strokeDasharray="3 5" vertical={false} />
          <XAxis dataKey="month" tick={{ fill: "#5e6f7f", fontSize: 12 }} axisLine={false} tickLine={false} />
          <YAxis yAxisId="units" allowDecimals={false} tick={{ fill: "#5e6f7f", fontSize: 12 }} axisLine={false} tickLine={false} width={36} />
          <YAxis yAxisId="commission" orientation="right" tickFormatter={(value) => `$${Math.round(Number(value) / 1_000)}k`} tick={{ fill: "#5e6f7f", fontSize: 12 }} axisLine={false} tickLine={false} width={44} />
          <Tooltip
            cursor={{ fill: "#eaf1f7" }}
            formatter={(value, name) =>
              name === "Commission" ? [formatCurrency(Number(value) * 100), name] : [Number(value), name]
            }
            labelFormatter={(label) => `${label} ${year}`}
            contentStyle={{ borderRadius: 8, borderColor: "#c8d4df", boxShadow: "0 12px 30px rgba(11,42,71,.12)" }}
          />
          <Bar yAxisId="units" dataKey="units" name="Delivered" fill="#1268a7" radius={[4, 4, 0, 0]} barSize={24} />
          <Line yAxisId="commission" type="monotone" dataKey="commission" name="Commission" stroke="#147d64" strokeWidth={3} dot={{ r: 3, fill: "#147d64" }} activeDot={{ r: 5 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
