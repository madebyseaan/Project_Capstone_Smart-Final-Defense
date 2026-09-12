import { useEffect, useState } from "react";
import { RefreshCw, ToggleLeft, ToggleRight, Trash2, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { toast } from "@/lib/toast";
import { adminApi } from "@/lib/api";
import type { GradingConfig as GradingConfigType } from "@/lib/api";

interface SubjectWeight {
  id: string;
  code: string;
  name: string;
  type: string;
  writtenWorkWeight: number | null;
  perfTaskWeight: number | null;
  quarterlyAssessWeight: number | null;
  hasOverride: boolean;
}

interface SubjectWeightsPanelProps {
  configs: GradingConfigType[];
}

export function SubjectWeightsPanel({ configs }: SubjectWeightsPanelProps) {
  const [subjectWeights, setSubjectWeights] = useState<SubjectWeight[]>([]);
  const [loading, setLoading] = useState(true);
  const [subjectFilter, setSubjectFilter] = useState<string>("ALL");
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [clearing, setClearing] = useState(false);

  const fetchSubjectWeights = async () => {
    try {
      setLoading(true);
      const res = await adminApi.getSubjectWeights();
      setSubjectWeights(res.data as SubjectWeight[]);
    } catch (err) {
      console.error("Failed to fetch subject weights:", err);
      toast.error("Failed to load subject weights");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchSubjectWeights();
  }, []);

  const errorMessage = (err: unknown, fallback: string) => {
    const e = err as { response?: { data?: { message?: string } }; message?: string };
    return e?.response?.data?.message || e?.message || fallback;
  };

  const toggleSubjectOverride = async (subjectId: string) => {
    const subject = subjectWeights.find((s) => s.id === subjectId);
    if (!subject) return;

    if (subject.hasOverride) {
      try {
        await adminApi.clearSubjectWeightOverride(subjectId);
        toast.success("Override cleared");
        fetchSubjectWeights();
      } catch (err) {
        toast.error(errorMessage(err, "Failed to clear override"));
      }
    } else {
      const groupConfig = configs.find((c) => c.subjectType === subject.type);
      setSubjectWeights((prev) =>
        prev.map((s) =>
          s.id !== subjectId
            ? s
            : {
                ...s,
                hasOverride: true,
                writtenWorkWeight: groupConfig?.writtenWorkWeight ?? 20,
                perfTaskWeight: groupConfig?.performanceTaskWeight ?? 50,
                quarterlyAssessWeight: groupConfig?.quarterlyAssessWeight ?? 30,
              }
        )
      );
    }
  };

  const updateSubjectWeight = (
    subjectId: string,
    field: "writtenWorkWeight" | "perfTaskWeight" | "quarterlyAssessWeight",
    value: number
  ) => {
    setSubjectWeights((prev) => prev.map((s) => (s.id === subjectId ? { ...s, [field]: value } : s)));
  };

  const saveSubjectWeight = async (subjectId: string) => {
    const subject = subjectWeights.find((s) => s.id === subjectId);
    if (!subject || !subject.hasOverride) return;
    try {
      await adminApi.updateSubjectWeight(subjectId, {
        writtenWorkWeight: subject.writtenWorkWeight ?? 20,
        perfTaskWeight: subject.perfTaskWeight ?? 50,
        quarterlyAssessWeight: subject.quarterlyAssessWeight ?? 30,
      });
      toast.success("Subject weights saved");
      fetchSubjectWeights();
    } catch (err) {
      toast.error(errorMessage(err, "Failed to save"));
    }
  };

  const clearSubjectOverride = async (subjectId: string) => {
    try {
      await adminApi.clearSubjectWeightOverride(subjectId);
      toast.success("Override cleared");
      fetchSubjectWeights();
    } catch (err) {
      toast.error(errorMessage(err, "Failed to clear"));
    }
  };

  const clearAllOverrides = async () => {
    const overrides = subjectWeights.filter((s) => s.hasOverride);
    if (overrides.length === 0) return;
    setClearing(true);
    try {
      await adminApi.bulkUpdateSubjectWeights(
        overrides.map((s) => ({
          subjectId: s.id,
          writtenWorkWeight: null,
          perfTaskWeight: null,
          quarterlyAssessWeight: null,
        }))
      );
      toast.success("All overrides cleared");
      setConfirmClearAll(false);
      fetchSubjectWeights();
    } catch (err) {
      toast.error(errorMessage(err, "Failed to clear all overrides"));
    } finally {
      setClearing(false);
    }
  };

  const deduped = (() => {
    const seen = new Map<string, SubjectWeight>();
    const filtered = subjectWeights.filter((s) => subjectFilter === "ALL" || s.type === subjectFilter);
    for (const s of filtered) {
      const baseCode = s.code.replace(/\d+$/, "").replace(/_$/, "").toUpperCase();
      if (!seen.has(baseCode)) {
        seen.set(baseCode, s);
      }
    }
    return Array.from(seen.values());
  })();

  const headClass = "text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-6";

  return (
    <Card className="border border-border shadow-sm bg-card rounded-xl p-0 overflow-hidden">
      <div className="px-6 py-4 border-b border-border flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Users className="w-4 h-4 text-muted-foreground" />
          <div>
            <h3 className="font-semibold text-sm text-foreground">Per-Subject Weight Overrides</h3>
            <p className="text-xs text-muted-foreground">Set custom weights for individual subjects (overrides group defaults)</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={subjectFilter} onValueChange={setSubjectFilter}>
            <SelectTrigger className="w-44 h-9 rounded-lg text-xs font-medium">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Types</SelectItem>
              <SelectItem value="CORE">Core (incl. Math &amp; Science)</SelectItem>
              <SelectItem value="MAPEH">MAPEH &amp; TLE</SelectItem>
            </SelectContent>
          </Select>
          {subjectWeights.some((s) => s.hasOverride) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmClearAll(true)}
              className="h-8 rounded-lg text-xs font-semibold text-destructive hover:bg-destructive/10 gap-1"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear All
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={fetchSubjectWeights} className="w-8 h-8 rounded-lg">
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
      <CardContent className="p-0">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <RefreshCw className="w-5 h-5 animate-spin" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-muted/50 border-b border-border bg-muted/50">
                  <TableHead className={headClass}>Subject</TableHead>
                  <TableHead className={headClass}>Type</TableHead>
                  <TableHead className={`${headClass} text-center`}>WW %</TableHead>
                  <TableHead className={`${headClass} text-center`}>PT %</TableHead>
                  <TableHead className={`${headClass} text-center`}>TA %</TableHead>
                  <TableHead className={`${headClass} text-center`}>Override</TableHead>
                  <TableHead className={`${headClass} text-right`}>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deduped.map((subject) => {
                  const groupConfig = configs.find((c) => c.subjectType === subject.type);
                  const displayWw = subject.hasOverride ? subject.writtenWorkWeight : (groupConfig?.writtenWorkWeight ?? 20);
                  const displayPt = subject.hasOverride ? subject.perfTaskWeight : (groupConfig?.performanceTaskWeight ?? 50);
                  const displayQa = subject.hasOverride ? subject.quarterlyAssessWeight : (groupConfig?.quarterlyAssessWeight ?? 30);
                  return (
                    <TableRow key={subject.id} className="border-b border-border/20 hover:bg-muted/50 transition-colors">
                      <TableCell className="py-3.5 px-6 whitespace-nowrap">
                        <div className="font-medium text-sm text-foreground">{subject.name}</div>
                        <div className="text-xs text-muted-foreground font-mono">{subject.code}</div>
                      </TableCell>
                      <TableCell className="py-3.5 px-6">
                        <Badge className="bg-muted text-muted-foreground text-[10px] font-bold uppercase tracking-widest">{subject.type}</Badge>
                      </TableCell>
                      <TableCell className="py-3.5 px-6 text-center">
                        {subject.hasOverride ? (
                          <Input
                            type="number"
                            value={subject.writtenWorkWeight ?? 20}
                            onChange={(e) => updateSubjectWeight(subject.id, "writtenWorkWeight", parseInt(e.target.value) || 0)}
                            className="w-16 h-8 rounded-lg border-border text-sm font-mono text-center mx-auto"
                          />
                        ) : (
                          <span className="text-sm font-mono text-muted-foreground">{displayWw}</span>
                        )}
                      </TableCell>
                      <TableCell className="py-3.5 px-6 text-center">
                        {subject.hasOverride ? (
                          <Input
                            type="number"
                            value={subject.perfTaskWeight ?? 50}
                            onChange={(e) => updateSubjectWeight(subject.id, "perfTaskWeight", parseInt(e.target.value) || 0)}
                            className="w-16 h-8 rounded-lg border-border text-sm font-mono text-center mx-auto"
                          />
                        ) : (
                          <span className="text-sm font-mono text-muted-foreground">{displayPt}</span>
                        )}
                      </TableCell>
                      <TableCell className="py-3.5 px-6 text-center">
                        {subject.hasOverride ? (
                          <Input
                            type="number"
                            value={subject.quarterlyAssessWeight ?? 30}
                            onChange={(e) => updateSubjectWeight(subject.id, "quarterlyAssessWeight", parseInt(e.target.value) || 0)}
                            className="w-16 h-8 rounded-lg border-border text-sm font-mono text-center mx-auto"
                          />
                        ) : (
                          <span className="text-sm font-mono text-muted-foreground">{displayQa}</span>
                        )}
                      </TableCell>
                      <TableCell className="py-3.5 px-6 text-center">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => toggleSubjectOverride(subject.id)}
                          className="w-8 h-8"
                          aria-label={subject.hasOverride ? "Disable override" : "Enable override"}
                        >
                          {subject.hasOverride ? (
                            <ToggleRight className="w-6 h-6 text-primary" />
                          ) : (
                            <ToggleLeft className="w-6 h-6 text-muted-foreground" />
                          )}
                        </Button>
                      </TableCell>
                      <TableCell className="py-3.5 px-6 text-right">
                        {subject.hasOverride && (
                          <div className="flex items-center justify-end gap-1">
                            <Button size="sm" variant="ghost" onClick={() => saveSubjectWeight(subject.id)} className="h-7 rounded-lg text-xs font-semibold text-primary hover:bg-primary/10">
                              Save
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => clearSubjectOverride(subject.id)} className="h-7 rounded-lg text-xs font-semibold text-muted-foreground hover:bg-muted">
                              Clear
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <ConfirmDialog
        open={confirmClearAll}
        onOpenChange={setConfirmClearAll}
        title="Clear all overrides"
        description={`Clear all ${subjectWeights.filter((s) => s.hasOverride).length} subject overrides? This will revert them to group defaults.`}
        confirmLabel="Clear All"
        destructive
        loading={clearing}
        onConfirm={clearAllOverrides}
      />
    </Card>
  );
}
