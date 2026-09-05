import { useState, useEffect, useCallback } from "react";
import {
  ArrowLeftRight,
  AlertTriangle,
  ClipboardCheck,
  Loader2,
  CloudDownload,
  RefreshCw,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { registrarApi, type TransfereeRow, type TransfereesResponse } from "@/lib/api";
import { useTheme } from "@/contexts/ThemeContext";
import { useSyncStream } from "@/hooks/useSyncStream";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatCard } from "@/components/layout/StatCard";
import { LoadingSkeleton, EmptyState, Dash } from "@/components/data-table";
import { toast } from "@/lib/toast";
import { SyncProgressModal } from "@/components/common/SyncProgressModal";

const gradeLevelLabels: Record<string, string> = {
  "GRADE_7": "Grade 7",
  "GRADE_8": "Grade 8",
  "GRADE_9": "Grade 9",
  "GRADE_10": "Grade 10",
};

const formatDate = (iso?: string | null): string => {
  if (!iso) return "";
  const datePart = iso.split("T")[0];
  if (!datePart) return "";
  const [y, m, d] = datePart.split("-");
  if (!y || !m || !d) return "";
  return `${m}/${d}/${y}`;
};

export default function Transferees() {
  const { colors } = useTheme();
  const { syncVersion } = useSyncStream();
  const [data, setData] = useState<TransfereesResponse | null>(null);
  const [transferees, setTransferees] = useState<TransfereeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [selected, setSelected] = useState<TransfereeRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "success" | "error">("idle");
  const [syncError, setSyncError] = useState<string | undefined>();

  const [previousSchool, setPreviousSchool] = useState("");
  const [lastGradeCompleted, setLastGradeCompleted] = useState("");
  const [transferCertNo, setTransferCertNo] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [gender, setGender] = useState("");
  const [transferInDate, setTransferInDate] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await registrarApi.getTransferees();
      setData(res.data);
      setTransferees(res.data.transferees || []);
    } catch (err) {
      console.error("Failed to load transferees:", err);
      toast.error("Failed to load transferee records");
      setTransferees([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData, syncVersion]);

  const handleSync = async () => {
    setSyncModalOpen(true);
    setSyncStatus("syncing");
    setSyncError(undefined);
    try {
      await registrarApi.runSync();
      setSyncStatus("success");
      void loadData();
    } catch {
      setSyncStatus("error");
      setSyncError("Failed to sync with EnrollPro. Please try again.");
    }
  };

  const filtered = transferees.filter((t) => {
    const name = t.studentName.toLowerCase();
    const q = search.toLowerCase();
    return name.includes(q) || t.lrn.includes(q);
  });

  const incompleteCount = transferees.filter((t) =>
    t.completeness.missingBirthDate || t.completeness.missingGender ||
    t.completeness.missingPreviousSchool || t.completeness.missingTransferCertNo
  ).length;

  const openDialog = (row: TransfereeRow) => {
    setSelected(row);
    setPreviousSchool(row.details.previousSchool ?? "");
    setLastGradeCompleted(row.details.lastGradeCompleted ?? "");
    setTransferCertNo(row.details.transferCertNo ?? "");
    setGender("");
    setBirthDate("");
    setTransferInDate(row.transferInDate?.split("T")[0] ?? "");
  };

  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const payload: Record<string, string> = {};
      if (previousSchool.trim()) payload.previousSchool = previousSchool.trim();
      if (lastGradeCompleted.trim()) payload.lastGradeCompleted = lastGradeCompleted.trim();
      if (transferCertNo.trim()) payload.transferCertNo = transferCertNo.trim();
      if (birthDate) payload.birthDate = `${birthDate}T00:00:00.000Z`;
      if (gender) payload.gender = gender;
      if (transferInDate) payload.transferInDate = `${transferInDate}T00:00:00.000Z`;
      await registrarApi.updateTransferee(selected.enrollmentId, payload);
      toast.success("Transferee details saved");
      setSelected(null);
      void loadData();
    } catch (err) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(message || "Failed to save transferee details");
    } finally {
      setSaving(false);
    }
  };

  const total = transferees.length;

  return (
    <div className="space-y-6 animate-fade-in max-w-[1400px] mx-auto w-full">
      <PageHeader
        title="Transferees"
        description="Learners who transferred into the school this school year (T/I)"
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="px-3 py-1 text-xs font-medium bg-primary/5 text-primary border-primary/20">
              S.Y. {data?.schoolYear || "—"}
            </Badge>
            <Button
              onClick={() => void handleSync()}
              variant="default"
              size="sm"
              className="font-semibold text-xs shadow-sm shadow-primary/20"
              disabled={syncStatus === "syncing"}
            >
              <CloudDownload className="w-4 h-4 mr-1.5" />
              Sync from EnrollPro
            </Button>
            <Button
              onClick={() => void loadData()}
              variant="outline"
              size="sm"
              className="border-border/70 bg-background hover:bg-muted/70 text-foreground font-medium text-xs"
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh
            </Button>
          </div>
        }
      />

      {/* Stats Row */}
      <div className="grid grid-cols-2 gap-4">
        <StatCard
          label="Transferees (this SY)"
          value={total}
          numericValue={total}
          icon={<ArrowLeftRight className="w-5 h-5 text-primary" />}
          iconClassName="bg-primary/10"
        />
        <StatCard
          label="Incomplete records"
          value={incompleteCount}
          numericValue={incompleteCount}
          icon={<AlertTriangle className="w-5 h-5 text-amber-600" />}
          iconClassName="bg-amber-500/10"
        />
      </div>

      {/* Main Table Card */}
      <Card className="border-0 shadow-sm bg-card overflow-hidden rounded-xl p-0">
        <div className="px-6 py-4 border-b border-border/30">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-foreground">Transferee List</h2>
              <p className="text-sm text-muted-foreground">
                {filtered.length} learner{filtered.length !== 1 ? "s" : ""} found
              </p>
            </div>
            <div className="relative">
              <Input
                placeholder="Search name or LRN..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 pr-4 h-9 w-64 rounded-lg text-xs"
              />
            </div>
          </div>
        </div>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table className="w-full table-fixed">
              <TableHeader>
                <TableRow className="hover:bg-muted/50 border-b border-border/30 bg-muted/50">
                  <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4 w-[13%] text-left">LRN</TableHead>
                  <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4 w-[28%] text-left">Learner Name</TableHead>
                  <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4 w-[18%] text-left">Section</TableHead>
                  <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4 w-[14%] text-left whitespace-nowrap">Transferred In</TableHead>
                  <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4 w-[15%] text-left">Status</TableHead>
                  <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4 w-[14%] text-left">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <LoadingSkeleton columnCount={6} rowCount={8} />
                ) : filtered.length === 0 ? (
                  <EmptyState
                    columnCount={6}
                    icon={<ArrowLeftRight className="h-5 w-5 text-muted-foreground/60" />}
                    title={search ? "No transferees match your search" : "No transferees this school year"}
                    hint={
                      search
                        ? "Try adjusting your search criteria."
                        : "Transferees are tagged automatically from EnrollPro after a sync, or manually from Student Records."
                    }
                  />
                ) : (
                  filtered.map((row) => {
                    const missing = [
                      row.completeness.missingBirthDate ? "Birth date" : null,
                      row.completeness.missingGender ? "Sex" : null,
                      row.completeness.missingPreviousSchool ? "Prev. school" : null,
                      row.completeness.missingTransferCertNo ? "TC no." : null,
                    ].filter(Boolean) as string[];
                    return (
                      <TableRow key={row.enrollmentId} className="border-b border-border/20 hover:bg-muted/50 transition-colors">
                        <TableCell className="py-3.5 px-4 font-mono text-[13px] text-muted-foreground tabular-nums text-left align-middle whitespace-nowrap">
                          {row.lrn || <Dash />}
                        </TableCell>
                        <TableCell className="py-3.5 px-4 text-left align-middle">
                          <div className="flex items-center gap-3 min-w-0">
                            <div
                              className="w-8 h-8 rounded-full flex items-center justify-center text-primary-foreground font-semibold text-xs shrink-0"
                              style={{ backgroundColor: colors.primary }}
                              aria-hidden="true"
                            >
                              {(row.studentName || "?").charAt(0)}
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold text-foreground text-sm truncate">{row.studentName}</p>
                              {!row.matchedBySync && (
                                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
                                  Tagged by registrar
                                </p>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="py-3.5 px-4 text-left align-middle">
                          <div className="flex flex-col">
                            <span className="text-sm text-foreground font-medium">{row.section.name}</span>
                            <span className="text-[11px] text-muted-foreground">
                              {gradeLevelLabels[row.section.gradeLevel] || row.section.gradeLevel}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="py-3.5 px-4 text-sm text-muted-foreground text-left align-middle whitespace-nowrap">
                          {row.transferInDate ? formatDate(row.transferInDate) : <Dash />}
                        </TableCell>
                        <TableCell className="py-3.5 px-4 text-left align-middle">
                          {missing.length === 0 ? (
                            <Badge variant="outline" className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border-emerald-200 whitespace-nowrap">
                              Complete
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border-amber-200 whitespace-nowrap">
                              {missing.length} missing
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="py-3.5 px-4 text-left align-middle">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openDialog(row)}
                            className="h-8 px-3 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground whitespace-nowrap -ml-2.5"
                          >
                            <ClipboardCheck className="h-3.5 w-3.5 mr-1.5" />
                            Complete details
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Complete Details Dialog */}
      <Dialog open={!!selected} onOpenChange={(open) => !open && !saving && setSelected(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-foreground">
              Complete Transferee Details
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              {selected?.studentName} · LRN {selected?.lrn}
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2 space-y-2">
                <Label htmlFor="previousSchool" className="text-xs font-medium text-foreground">
                  Previous school <span className="text-muted-foreground font-normal">(transferred from)</span>
                </Label>
                <Input
                  id="previousSchool"
                  value={previousSchool}
                  onChange={(e) => setPreviousSchool(e.target.value)}
                  placeholder="Name of previous school"
                  disabled={saving}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastGradeCompleted" className="text-xs font-medium text-foreground">
                  Last grade completed
                </Label>
                <Input
                  id="lastGradeCompleted"
                  value={lastGradeCompleted}
                  onChange={(e) => setLastGradeCompleted(e.target.value)}
                  placeholder="e.g. Grade 6"
                  disabled={saving}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="transferCertNo" className="text-xs font-medium text-foreground">
                  Transfer Certificate No.
                </Label>
                <Input
                  id="transferCertNo"
                  value={transferCertNo}
                  onChange={(e) => setTransferCertNo(e.target.value)}
                  placeholder="TC / SF10 reference no."
                  disabled={saving}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="birthDate" className="text-xs font-medium text-foreground">
                  Birth date
                </Label>
                <Input
                  id="birthDate"
                  type="date"
                  value={birthDate}
                  onChange={(e) => setBirthDate(e.target.value)}
                  disabled={saving}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="gender" className="text-xs font-medium text-foreground">
                  Sex
                </Label>
                <Select value={gender || undefined} onValueChange={(v) => setGender(v)}>
                  <SelectTrigger id="gender" className="h-9 rounded-lg text-xs font-medium">
                    <SelectValue placeholder="Select sex" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MALE">Male</SelectItem>
                    <SelectItem value="FEMALE">Female</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="sm:col-span-2 space-y-2">
                <Label htmlFor="transferInDate" className="text-xs font-medium text-foreground">
                  Date transferred in
                </Label>
                <Input
                  id="transferInDate"
                  type="date"
                  value={transferInDate}
                  onChange={(e) => setTransferInDate(e.target.value)}
                  disabled={saving}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setSelected(null)} disabled={saving} className="border-border/70 bg-background hover:bg-muted/70 text-foreground font-medium text-xs">
              Cancel
            </Button>
            <Button onClick={() => void handleSave()} disabled={saving} size="sm" className="font-semibold text-xs shadow-sm shadow-primary/20">
              {saving && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <SyncProgressModal isOpen={syncModalOpen} onClose={() => { setSyncModalOpen(false); setSyncStatus("idle"); }} status={syncStatus} errorMessage={syncError} />
    </div>
  );
}
