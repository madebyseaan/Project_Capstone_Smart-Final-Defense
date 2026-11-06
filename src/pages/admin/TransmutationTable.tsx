import { useState, useEffect, useCallback, useMemo } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { adminApi, type GradingMode, type GradingModeResponse } from "../../lib/api";
import { useTheme } from "../../contexts/ThemeContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";
import { Switch } from "../../components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import {
  Sliders,
  Plus,
  Trash2,
  RotateCcw,
  Save,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Search,
  Info,
  Lock,
} from "lucide-react";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";

interface TransmutationRow {
  id?: string;
  minGrade: number;
  maxGrade: number;
  transmutedGrade: number;
  isDefault?: boolean;
}

function errorMessage(err: any): string {
  return err?.response?.data?.message || err?.message || "Something went wrong";
}

export default function TransmutationTable() {
  const { colors } = useTheme();
  const [rows, setRows] = useState<TransmutationRow[]>([]);
  const [modeInfo, setModeInfo] = useState<GradingModeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modeSaving, setModeSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmModeChange, setConfirmModeChange] = useState<GradingMode | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");

  const showMessage = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  };

  const refreshAll = useCallback(async (showLoader = false) => {
    if (showLoader) setLoading(true);
    try {
      const [tableRes, modeRes] = await Promise.all([
        adminApi.getTransmutationTable(),
        adminApi.getGradingMode(),
      ]);
      setRows(tableRes.data);
      setModeInfo(modeRes.data);
      setHasChanges(false);
    } catch (err: any) {
      showMessage("error", errorMessage(err));
    } finally {
      if (showLoader) setLoading(false);
    }
  }, []);

  const fetchTable = useCallback(async () => {
    try {
      const res = await adminApi.getTransmutationTable();
      setRows(res.data);
      setHasChanges(false);
    } catch (err: any) {
      showMessage("error", errorMessage(err));
    }
  }, []);

  useEffect(() => {
    refreshAll(true);
  }, [refreshAll]);

  const gradingMode: GradingMode = modeInfo?.mode ?? "TRANSMUTED";
  const canEditTable = gradingMode === "TRANSMUTED";
  const targetMode: GradingMode = gradingMode === "TRANSMUTED" ? "ZERO_BASED" : "TRANSMUTED";
  const modeBlocked = modeInfo ? !modeInfo.canChange : true;
  const switchDisabled = loading || modeSaving || !modeInfo || modeBlocked || hasChanges;
  const recommendedMismatch = !!modeInfo && modeInfo.recommendedMode !== modeInfo.mode;

  const blockedText = (() => {
    switch (modeInfo?.blockedReason) {
      case "ARCHIVED_SCHOOL_YEAR":
        return "The active school year is archived. Grading mode cannot be changed.";
      case "FINALIZED_GRADES":
        return "This school year has finalized grades. Unfinalize the term grades before changing the grading mode.";
      case "EOSY_FINALIZED":
        return "This school year is EOSY-finalized. Unfinalize EOSY before changing the grading mode.";
      default:
        return "The grading mode cannot be changed right now.";
    }
  })();

  const filtered = useMemo(() => {
    let result = rows;
    if (sourceFilter === "default") {
      result = result.filter((r) => r.isDefault);
    } else if (sourceFilter === "custom") {
      result = result.filter((r) => !r.isDefault);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (r) =>
          String(r.minGrade).includes(q) ||
          String(r.maxGrade).includes(q) ||
          String(r.transmutedGrade).includes(q)
      );
    }
    return result;
  }, [rows, search, sourceFilter]);

  const updateCell = (index: number, field: keyof TransmutationRow, value: number) => {
    if (!canEditTable) return;
    setRows((prev) => {
      const next = prev.map((r, i) => (i === index ? { ...r, [field]: value } : r));
      const round2 = (n: number) => Math.round(n * 100) / 100;

      if (field === "maxGrade" && index < next.length - 1) {
        const newMin = round2(value + 0.01);
        const neighbor = { ...next[index + 1], minGrade: newMin };
        if (newMin <= neighbor.maxGrade) {
          next[index + 1] = neighbor;
        } else {
          next.splice(index + 1, 1);
        }
      }

      if (field === "minGrade" && index > 0) {
        const newMax = round2(value - 0.01);
        const neighbor = { ...next[index - 1], maxGrade: newMax };
        if (neighbor.minGrade <= newMax) {
          next[index - 1] = neighbor;
        } else {
          next.splice(index - 1, 1);
        }
      }

      return next;
    });
    setHasChanges(true);
  };

  const addRow = () => {
    if (!canEditTable) return;
    const lastRow = rows[rows.length - 1];
    const newMin = lastRow ? lastRow.minGrade - 1 : 50;
    setRows((prev) => [
      ...prev,
      {
        minGrade: Math.max(0, newMin),
        maxGrade: newMin + 0.99,
        transmutedGrade: 60,
      },
    ]);
    setHasChanges(true);
  };

  const deleteRow = (index: number) => {
    if (!canEditTable) return;
    setRows((prev) => prev.filter((_, i) => i !== index));
    setHasChanges(true);
  };

  const validateRows = (data: TransmutationRow[]): string | null => {
    if (data.length === 0) {
      return "Table must contain at least one entry";
    }
    const EPSILON = 0.005;
    const sorted = [...data]
      .map((r) => ({
        minGrade: Math.round(r.minGrade * 100) / 100,
        maxGrade: Math.round(r.maxGrade * 100) / 100,
        transmutedGrade: r.transmutedGrade,
      }))
      .sort((a, b) => a.minGrade - b.minGrade);

    for (const r of sorted) {
      if (!Number.isFinite(r.minGrade) || !Number.isFinite(r.maxGrade) || !Number.isFinite(r.transmutedGrade)) {
        return "Invalid numeric value in a row";
      }
      if (r.minGrade < 0 || r.maxGrade > 100 || r.minGrade > r.maxGrade) {
        return `Row ${r.minGrade.toFixed(2)} → ${r.maxGrade.toFixed(2)} is invalid: grades must satisfy 0 ≤ min ≤ max ≤ 100`;
      }
      if (!Number.isInteger(r.transmutedGrade) || r.transmutedGrade < 0 || r.transmutedGrade > 100) {
        return `Row ${r.minGrade.toFixed(2)} → ${r.maxGrade.toFixed(2)}: transmuted grade must be an integer between 0 and 100`;
      }
    }

    if (Math.abs(sorted[0].minGrade - 0) > EPSILON) {
      return `Table must start at 0.00 (first minGrade is ${sorted[0].minGrade.toFixed(2)})`;
    }
    const last = sorted[sorted.length - 1];
    if (Math.abs(last.maxGrade - 100) > EPSILON) {
      return `Table must end at 100.00 (last maxGrade is ${last.maxGrade.toFixed(2)})`;
    }

    for (let i = 0; i < sorted.length - 1; i++) {
      const curr = sorted[i];
      const next = sorted[i + 1];
      const expectedNextMin = Math.round((curr.maxGrade + 0.01) * 100) / 100;
      if (next.minGrade < expectedNextMin - EPSILON) {
        return `Overlap detected: range ${next.minGrade.toFixed(2)} → ${next.maxGrade.toFixed(2)} overlaps previous range ending at ${curr.maxGrade.toFixed(2)}`;
      }
      if (next.minGrade > expectedNextMin + EPSILON) {
        return `Gap detected between ${curr.maxGrade.toFixed(2)} and ${next.minGrade.toFixed(2)} — grades in this gap would transmute to 60`;
      }
    }
    return null;
  };

  const handleSave = async () => {
    if (!canEditTable) return;
    const validationError = validateRows(rows);
    if (validationError) {
      showMessage("error", validationError);
      return;
    }
    try {
      setSaving(true);
      await adminApi.updateTransmutationTable(
        rows.map((r) => ({
          minGrade: r.minGrade,
          maxGrade: r.maxGrade,
          transmutedGrade: r.transmutedGrade,
        }))
      );
      showMessage("success", "Transmutation table updated successfully");
      setHasChanges(false);
      await fetchTable();
    } catch (err: any) {
      showMessage("error", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!canEditTable) return;
    try {
      setSaving(true);
      const res = await adminApi.resetTransmutationTable();
      setRows(res.data);
      setHasChanges(false);
      setConfirmReset(false);
      showMessage("success", "Transmutation table restored to DepEd defaults");
    } catch (err: any) {
      showMessage("error", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleModeConfirm = async () => {
    if (!confirmModeChange) return;
    const nextMode = confirmModeChange;
    try {
      setModeSaving(true);
      const res = await adminApi.updateGradingMode(nextMode);
      setConfirmModeChange(null);
      showMessage(
        "success",
        `${nextMode === "ZERO_BASED" ? "Zero-Based Grading" : "Transmutation"} is now active for SY ${res.data.schoolYear.label}. ${res.data.recompute.updated} term grades recomputed.`
      );
      await refreshAll(false);
    } catch (err: any) {
      showMessage("error", errorMessage(err));
    } finally {
      setModeSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: colors.primary }} />
          <p className="text-muted-foreground">Loading grading mode and transmutation table...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-[1400px] mx-auto w-full">
      <PageHeader
        title="Transmutation Table"
        description="DepEd grading mode and transmutation — initial grade to term grade"
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => setConfirmReset(true)}
              disabled={!canEditTable || saving}
              className="gap-2 rounded-xl"
            >
              <RotateCcw className="w-4 h-4" />
              Reset Defaults
            </Button>
            <Button
              onClick={handleSave}
              disabled={!canEditTable || !hasChanges || saving}
              className="gap-2 text-white font-semibold rounded-xl shadow-lg disabled:opacity-50"
              style={{ backgroundColor: colors.primary }}
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </>
        }
      />

      {message && (
        <div
          className={`flex items-center gap-3 p-4 rounded-xl border-2 ${
            message.type === "success"
              ? "bg-primary/5 border-primary/20 text-primary"
              : "bg-destructive/5 border-destructive/20 text-destructive"
          }`}
        >
          {message.type === "success" ? (
            <CheckCircle2 className="w-5 h-5" />
          ) : (
            <AlertTriangle className="w-5 h-5" />
          )}
          <p className="text-sm font-medium">{message.text}</p>
        </div>
      )}

      <Card className="border border-border" data-testid="grading-mode-card">
        <CardHeader className="border-b border-border pb-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <div className="flex items-center gap-3 flex-1">
              <div
                className="p-2 rounded-xl text-white"
                style={{ backgroundColor: colors.primary }}
              >
                <Info className="w-5 h-5" />
              </div>
              <div>
                <CardTitle>Grading Mode</CardTitle>
                <CardDescription>
                  Applies to the active school year. The passing grade remains 75.
                </CardDescription>
              </div>
            </div>
            <Badge
              variant="outline"
              data-testid="grading-mode-badge"
              className="font-semibold"
              style={{
                backgroundColor: `${colors.primary}15`,
                color: colors.primary,
                borderColor: `${colors.primary}30`,
              }}
            >
              {gradingMode === "ZERO_BASED" ? "Zero-Based" : "Transmuted"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-foreground">Use transmutation table</p>
              <p className="max-w-3xl text-sm text-muted-foreground">
                ON: the Initial Grade is converted using the adjusted table. OFF: the Initial Grade is
                reported directly, rounded to the nearest whole number (60 floor). Passing is still 75.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {gradingMode === "TRANSMUTED" ? "ON" : "OFF"}
              </span>
              <Switch
                data-testid="grading-mode-switch"
                checked={gradingMode === "TRANSMUTED"}
                disabled={switchDisabled}
                onCheckedChange={() => {
                  if (!switchDisabled) setConfirmModeChange(targetMode);
                }}
                aria-label="Use transmutation table"
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground" data-testid="grading-mode-sy-label">
            Active school year: {modeInfo?.schoolYear.label ?? "—"} · DepEd Order No. 015, s. 2026
          </p>

          {recommendedMismatch && modeInfo && (
            <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                DepEd recommends{" "}
                <strong>
                  {modeInfo.recommendedMode === "ZERO_BASED" ? "Zero-Based Grading" : "Transmutation"}
                </strong>{" "}
                for this school year. You can still choose either mode.
              </p>
            </div>
          )}

          {modeInfo && !modeInfo.canChange && (
            <div
              className="flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive"
              data-testid="grading-mode-blocked"
            >
              <Lock className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{blockedText}</p>
            </div>
          )}

          {hasChanges && (
            <p className="text-xs font-medium text-muted-foreground">
              Save or discard table edits before changing the grading mode.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="border border-border" data-testid="transmutation-table-card">
        <CardHeader className="border-b border-border pb-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <div className="flex items-center gap-3 flex-1">
              <div
                className="p-2 rounded-xl text-white"
                style={{ backgroundColor: colors.primary }}
              >
                <Sliders className="w-5 h-5" />
              </div>
              <div>
                <CardTitle>Transmutation Ranges</CardTitle>
                <CardDescription>{rows.length} total entries</CardDescription>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search grades..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 w-48 rounded-xl border-border"
                />
              </div>
              <Select value={sourceFilter} onValueChange={(v) => setSourceFilter(v ?? "")}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="All Sources">
                    {sourceFilter === "all"
                      ? "All Sources"
                      : sourceFilter === "default"
                      ? "DepEd Default"
                      : "Custom"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sources</SelectItem>
                  <SelectItem value="default">DepEd Default</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
              <Button
                onClick={addRow}
                disabled={!canEditTable}
                className="gap-2 text-white font-semibold rounded-xl shadow-lg"
                style={{ backgroundColor: colors.primary }}
              >
                <Plus className="w-4 h-4" />
                Add Row
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {!canEditTable && (
            <div
              className="flex items-start gap-3 px-6 py-3 border-b border-border bg-muted/40"
              data-testid="transmutation-table-readonly-banner"
            >
              <Lock className="w-4 h-4 mt-0.5 text-muted-foreground" />
              <p className="text-sm font-medium text-muted-foreground">
                Zero-Based Grading is active. The transmutation table is retained for reference but is
                not applied. Passing grade remains 75.
              </p>
            </div>
          )}

          {hasChanges && canEditTable && (
            <div
              className="flex items-center gap-3 px-6 py-3 border-b"
              style={{
                backgroundColor: `${colors.primary}08`,
                borderColor: `${colors.primary}20`,
              }}
            >
              <AlertTriangle className="w-4 h-4" style={{ color: colors.primary }} />
              <p className="text-sm font-medium" style={{ color: colors.primary }}>
                You have unsaved changes
              </p>
            </div>
          )}

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-muted/50 border-b border-border bg-muted/50">
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Min Grade</TableHead>
                  <TableHead>Max Grade</TableHead>
                  <TableHead>Transmuted Grade</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                      No transmutation entries found
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((row) => {
                    const realIndex = rows.indexOf(row);
                    return (
                      <TableRow key={realIndex} data-testid="transmutation-table-row">
                        <TableCell>
                          <span className="font-mono text-sm text-muted-foreground">{realIndex + 1}</span>
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            step="0.01"
                            value={row.minGrade}
                            disabled={!canEditTable}
                            onChange={(e) =>
                              updateCell(realIndex, "minGrade", parseFloat(e.target.value) || 0)
                            }
                            className="w-28 h-9 rounded-xl border-border text-sm font-mono"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            step="0.01"
                            value={row.maxGrade}
                            disabled={!canEditTable}
                            onChange={(e) =>
                              updateCell(realIndex, "maxGrade", parseFloat(e.target.value) || 0)
                            }
                            className="w-28 h-9 rounded-xl border-border text-sm font-mono"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            value={row.transmutedGrade}
                            disabled={!canEditTable}
                            onChange={(e) =>
                              updateCell(
                                realIndex,
                                "transmutedGrade",
                                parseInt(e.target.value) || 60
                              )
                            }
                            className="w-24 h-9 rounded-xl border-border text-sm font-mono"
                          />
                        </TableCell>
                        <TableCell>
                          {row.isDefault ? (
                            <Badge
                              variant="outline"
                              className="font-medium"
                              style={{
                                backgroundColor: `${colors.primary}15`,
                                color: colors.primary,
                                borderColor: `${colors.primary}30`,
                              }}
                            >
                              DepEd Default
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 font-medium">
                              Custom
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => deleteRow(realIndex)}
                            disabled={!canEditTable}
                            className="w-8 h-8 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          <div className="border-t border-border px-6 py-4 flex items-center justify-between bg-muted/30">
            <div className="flex items-center gap-4 text-sm font-semibold text-foreground">
              <span>
                Showing {filtered.length} of {rows.length} entries
              </span>
              <div className="h-4 w-px bg-border" />
              <span className="text-muted-foreground">
                {rows.filter((r) => r.isDefault).length} default, {rows.filter((r) => !r.isDefault).length} custom
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Reset to DepEd Defaults"
        description="This will replace all current entries with the 41 official DepEd default transmutation rows. Any custom entries will be lost."
        confirmLabel={saving ? "Resetting..." : "Yes, Reset"}
        destructive
        loading={saving}
        onConfirm={handleReset}
      />

      <ConfirmDialog
        open={!!confirmModeChange}
        onOpenChange={(open) => {
          if (!open && !modeSaving) setConfirmModeChange(null);
        }}
        title={confirmModeChange === "ZERO_BASED" ? "Switch to Zero-Based Grading?" : "Switch to Transmutation?"}
        description={`This applies to SY ${modeInfo?.schoolYear.label ?? "the active school year"} and recomputes ${
          modeInfo?.gradeCount ?? 0
        } stored term grades. Raw scores will not change. The passing grade remains 75.`}
        confirmLabel={
          modeSaving
            ? "Switching..."
            : confirmModeChange === "ZERO_BASED"
            ? "Switch to Zero-Based"
            : "Switch to Transmutation"
        }
        loading={modeSaving}
        onConfirm={handleModeConfirm}
        testId="grading-mode-confirm-dialog"
        confirmTestId="grading-mode-confirm-submit"
      >
        <div className="rounded-xl border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          {confirmModeChange === "ZERO_BASED"
            ? "The Initial Grade will be reported directly. A raw grade of 75 is needed to pass."
            : "The adjusted transmutation table will be applied. A raw grade of 70 maps to a passing 75."}
        </div>
      </ConfirmDialog>
    </div>
  );
}
