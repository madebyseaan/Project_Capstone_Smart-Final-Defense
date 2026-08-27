import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { adminApi } from "../../lib/api";
import { useTheme } from "../../contexts/ThemeContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
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
} from "lucide-react";

interface TransmutationRow {
  id?: string;
  minGrade: number;
  maxGrade: number;
  transmutedGrade: number;
  isDefault?: boolean;
}

export default function TransmutationTable() {
  const navigate = useNavigate();
  const { colors } = useTheme();
  const [rows, setRows] = useState<TransmutationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");

  const showMessage = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  };

  const fetchTable = useCallback(async () => {
    try {
      setLoading(true);
      const res = await adminApi.getTransmutationTable();
      setRows(res.data);
      setHasChanges(false);
    } catch (err: any) {
      showMessage("error", err.message || "Failed to load transmutation table");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTable();
  }, [fetchTable]);

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
    setRows((prev) => {
      const next = prev.map((r, i) => (i === index ? { ...r, [field]: value } : r));
      const r = next[index];
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
      fetchTable();
    } catch (err: any) {
      showMessage("error", err.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    try {
      setSaving(true);
      const res = await adminApi.resetTransmutationTable();
      setRows(res.data);
      setHasChanges(false);
      setConfirmReset(false);
      showMessage("success", "Transmutation table restored to DepEd defaults");
    } catch (err: any) {
      showMessage("error", err.message || "Failed to reset");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: colors.primary }} />
          <p className="text-gray-500">Loading transmutation table...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Transmutation Table</h1>
          <p className="text-gray-600 mt-1">
            DepEd grading transmutation — initial grade to quarterly grade
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setConfirmReset(true)}
            className="gap-2 rounded-xl"
          >
            <RotateCcw className="w-4 h-4" />
            Reset Defaults
          </Button>
          <Button
            onClick={handleSave}
            disabled={!hasChanges || saving}
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
        </div>
      </div>

      {/* Success / Error Alert */}
      {message && (
        <div
          className="flex items-center gap-3 p-4 rounded-xl border"
          style={{
            backgroundColor: message.type === "success" ? `${colors.primary}15` : "#fef2f2",
            borderColor: message.type === "success" ? `${colors.primary}40` : "#fecaca",
          }}
        >
          {message.type === "success" ? (
            <CheckCircle2 className="w-5 h-5" style={{ color: colors.primary }} />
          ) : (
            <AlertTriangle className="w-5 h-5 text-red-500" />
          )}
          <p
            className="text-sm font-medium"
            style={{ color: message.type === "success" ? colors.primary : "#dc2626" }}
          >
            {message.text}
          </p>
        </div>
      )}

      {/* Main Card */}
      <Card className="border border-slate-200">
        <CardHeader className="border-b border-slate-100 pb-4">
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
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  placeholder="Search grades..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 w-48 rounded-xl border-gray-200"
                />
              </div>
              <Select value={sourceFilter} onValueChange={setSourceFilter}>
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
          {/* Unsaved Changes Banner */}
          {hasChanges && (
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

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-8 h-8 animate-spin" style={{ color: colors.primary }} />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50/80">
                    <TableHead className="w-12 font-bold text-gray-700">#</TableHead>
                    <TableHead className="font-bold text-gray-700">Min Grade</TableHead>
                    <TableHead className="font-bold text-gray-700">Max Grade</TableHead>
                    <TableHead className="font-bold text-gray-700">Transmuted Grade</TableHead>
                    <TableHead className="font-bold text-gray-700">Source</TableHead>
                    <TableHead className="text-right font-bold text-gray-700">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-12 text-gray-500">
                        No transmutation entries found
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((row, idx) => {
                      const realIndex = rows.indexOf(row);
                      return (
                        <TableRow key={realIndex}>
                          <TableCell>
                            <span className="font-mono text-sm text-gray-400">{realIndex + 1}</span>
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              step="0.01"
                              value={row.minGrade}
                              onChange={(e) =>
                                updateCell(realIndex, "minGrade", parseFloat(e.target.value) || 0)
                              }
                              className="w-28 h-9 rounded-xl border-gray-200 text-sm font-mono"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              step="0.01"
                              value={row.maxGrade}
                              onChange={(e) =>
                                updateCell(realIndex, "maxGrade", parseFloat(e.target.value) || 0)
                              }
                              className="w-28 h-9 rounded-xl border-gray-200 text-sm font-mono"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              value={row.transmutedGrade}
                              onChange={(e) =>
                                updateCell(
                                  realIndex,
                                  "transmutedGrade",
                                  parseInt(e.target.value) || 60
                                )
                              }
                              className="w-24 h-9 rounded-xl border-gray-200 text-sm font-mono"
                            />
                          </TableCell>
                          <TableCell>
                            {row.isDefault ? (
                              <Badge
                                className="border-0 font-medium"
                                style={{
                                  backgroundColor: `${colors.primary}15`,
                                  color: colors.primary,
                                }}
                              >
                                DepEd Default
                              </Badge>
                            ) : (
                              <Badge className="bg-amber-100 text-amber-700 border-0 font-medium">
                                Custom
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => deleteRow(realIndex)}
                              className="w-8 h-8 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50"
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
          )}

          {/* Footer */}
          <div className="border-t border-gray-100 px-6 py-4 flex items-center justify-between bg-gray-50/30">
            <div className="flex items-center gap-4 text-sm font-semibold text-slate-800">
              <span>
                Showing {filtered.length} of {rows.length} entries
              </span>
              <div className="h-4 w-px bg-slate-300" />
              <span className="text-slate-500">
                {rows.filter((r) => r.isDefault).length} default, {rows.filter((r) => !r.isDefault).length} custom
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Reset Confirmation Dialog */}
      <Dialog open={confirmReset} onOpenChange={setConfirmReset}>
        <DialogContent className="sm:max-w-[425px] rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div
                className="p-2 rounded-lg"
                style={{ backgroundColor: `${colors.primary}15` }}
              >
                <RotateCcw className="w-5 h-5" style={{ color: colors.primary }} />
              </div>
              Reset to DepEd Defaults
            </DialogTitle>
            <DialogDescription>
              This will replace all current entries with the 41 official DepEd default transmutation
              rows. Any custom entries will be lost.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setConfirmReset(false)}
              className="rounded-xl"
            >
              Cancel
            </Button>
            <Button
              onClick={handleReset}
              disabled={saving}
              className="gap-2 text-white font-semibold rounded-xl"
              style={{ backgroundColor: "#dc2626" }}
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RotateCcw className="w-4 h-4" />
              )}
              {saving ? "Resetting..." : "Yes, Reset"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
