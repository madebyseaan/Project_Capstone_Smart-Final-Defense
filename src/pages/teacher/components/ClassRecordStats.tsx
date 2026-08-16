import React from "react";
import { Award, Target, TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface ClassRecordStatsProps {
  avg: number;
  passed: number;
  total: number;
  highest: number;
}

export function ClassRecordStats({ avg, passed, total, highest }: ClassRecordStatsProps) {
  const needsSupport = total - passed;
  const passingRate = total > 0 ? `${Math.round((passed / total) * 100)}%` : "0%";

  return (
    <div id="tutorial-stats-overview" className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {[
        { label: "Class Average", value: avg.toFixed(1), icon: Target, bg: "bg-indigo-50", fg: "text-indigo-600" },
        { label: "Passing Rate", value: passingRate, icon: TrendingUp, bg: "bg-emerald-50", fg: "text-emerald-600" },
        { label: "Highest Grade", value: highest, icon: Award, bg: "bg-amber-50", fg: "text-amber-600" },
        { label: "Needs Support", value: needsSupport, icon: TrendingDown, bg: "bg-rose-50", fg: "text-rose-600" },
      ].map((stat) => (
        <Card key={stat.label} className="border-0 shadow-sm shadow-slate-100 rounded-xl bg-white overflow-hidden hover:shadow-md transition-all duration-350">
          <CardContent className="p-3 flex items-center gap-3.5">
            <div className={`p-2 rounded-lg ${stat.bg} ${stat.fg} shrink-0`}>
              <stat.icon className="w-4 h-4" />
            </div>
            <div>
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider leading-none">{stat.label}</p>
              <p className="text-lg font-black text-slate-900 mt-1 leading-none">{stat.value}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
