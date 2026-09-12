import { Calendar, Info, Lock, PencilRuler } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTheme } from "@/contexts/ThemeContext";
import type { SystemSettings as SystemSettingsType } from "@/lib/api";

interface AcademicSectionProps {
  settings: SystemSettingsType;
  schoolYears: Array<{ id: string; label: string; status: string }>;
  onChange: (field: keyof SystemSettingsType, value: string | boolean | number) => void;
}

const TERM_KEYS = [
  { key: "T1", label: "Term 1", start: "t1StartDate", end: "t1EndDate" },
  { key: "T2", label: "Term 2", start: "t2StartDate", end: "t2EndDate" },
  { key: "T3", label: "Term 3", start: "t3StartDate", end: "t3EndDate" },
] as const;

function formatDate(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function toDateInput(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().split("T")[0];
}

export function AcademicSection({ settings, schoolYears, onChange }: AcademicSectionProps) {
  const { colors } = useTheme();
  const activeYear = schoolYears.find((sy) => sy.label === settings.currentSchoolYear);
  const currentTerm = settings.currentTerm || "T1";
  const demo = !!settings.demoTermMode;

  return (
    <Card className="p-0 gap-0 border border-border shadow-sm rounded-xl bg-card overflow-hidden">
      <CardHeader className="px-6 py-4 border-b border-border bg-primary/5">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-xl bg-primary/10 text-primary">
            <Calendar className="w-6 h-6" />
          </div>
          <div>
            <CardTitle className="text-lg text-foreground">Academic Calendar</CardTitle>
            <CardDescription className="normal-case">
              School year and term schedule
            </CardDescription>
          </div>
          {demo && (
            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-800">
              <PencilRuler className="w-3.5 h-3.5" /> Demo / Offline mode
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-6">
        {demo && (
          <div className="mb-5 p-3 rounded-xl border-2 border-amber-200 bg-amber-50 flex items-start gap-2">
            <PencilRuler className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
            <p className="text-xs text-amber-800">
              <strong>DEMO_TERM_MODE is on.</strong> EnrollPro term syncing is paused and these
              values are managed locally. This is for demos/development only — turn it off to let
              EnrollPro govern the schedule again.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="p-4 rounded-xl border-2 border-primary/20 bg-primary/5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Active School Year</p>
            <p className="text-lg font-bold text-foreground mt-1">{settings.currentSchoolYear || "—"}</p>
            {activeYear && <p className="text-xs text-muted-foreground mt-0.5">Status: {activeYear.status}</p>}
          </div>
          <div className="p-4 rounded-xl border-2 border-secondary/20 bg-secondary/5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Current Term</p>
            {demo ? (
              <Select value={currentTerm} onValueChange={(val) => val && onChange("currentTerm", val)}>
                <SelectTrigger className="mt-2 h-9 rounded-lg text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="T1">Term 1</SelectItem>
                  <SelectItem value="T2">Term 2</SelectItem>
                  <SelectItem value="T3">Term 3</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <p className="text-lg font-bold text-foreground mt-1">
                {TERM_KEYS.find((t) => t.key === currentTerm)?.label || currentTerm}
              </p>
            )}
            {!demo && <p className="text-xs text-muted-foreground mt-0.5">Resolved live from EnrollPro</p>}
          </div>
        </div>

        {!demo && (
          <div className="mt-4 p-3 rounded-xl border-2 border-primary/20 bg-primary/5 flex items-start gap-2">
            <Info className="w-4 h-4 text-primary mt-0.5 shrink-0" />
            <p className="text-xs text-muted-foreground">
              The school year, current term, and term dates are <strong>managed in EnrollPro</strong> and
              resolved automatically. SMART never advances terms on its own — it follows the live
              EnrollPro term.
            </p>
          </div>
        )}

        <Separator className="my-6" />

        <div>
          <div className="flex items-center justify-between mb-4">
            <div>
              <Label className="text-sm font-semibold text-foreground">Term Dates</Label>
              <p className="text-xs text-muted-foreground mt-1">
                Each term locks automatically on its end date. Admin can also lock manually under Grade Locks.
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Lock className="w-3.5 h-3.5" /> Auto-locked by schedule
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {TERM_KEYS.map((term, index) => {
              const color = [colors.primary, colors.secondary, colors.accent][index];
              const isCurrent = currentTerm === term.key;
              return (
                <div key={term.key} className="p-4 rounded-xl border border-border bg-muted/40">
                  <div className="flex items-center gap-2 mb-3">
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white"
                      style={{ backgroundColor: color }}
                    >
                      {index + 1}
                    </div>
                    <span className="font-semibold text-foreground">{term.label}</span>
                    {isCurrent && (
                      <span
                        className="ml-auto px-2 py-0.5 text-xs font-medium rounded-full text-white"
                        style={{ backgroundColor: colors.primary }}
                      >
                        Current
                      </span>
                    )}
                  </div>

                  {demo ? (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Start</Label>
                        <Input
                          type="date"
                          value={toDateInput(settings[term.start] as string | undefined)}
                          onChange={(e) => onChange(term.start, e.target.value)}
                          className="h-9 rounded-lg text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">End</Label>
                        <Input
                          type="date"
                          value={toDateInput(settings[term.end] as string | undefined)}
                          onChange={(e) => onChange(term.end, e.target.value)}
                          className="h-9 rounded-lg text-sm"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Start</span>
                        <span className="font-medium text-foreground">{formatDate(settings[term.start] as string | undefined)}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">End</span>
                        <span className="font-medium text-foreground">{formatDate(settings[term.end] as string | undefined)}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <p className="text-xs text-muted-foreground mt-4">
            Term display labels (e.g. “First Quarter”) are configured in{" "}
            <Link to="/admin/grading-config" className="font-medium text-primary underline-offset-2 hover:underline">
              Grading Config
            </Link>
            .
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
