import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { ArrowLeft, Plus, Pencil, Trash2, Loader2, X, ScanLine, FileSpreadsheet, History, Printer } from "lucide-react";
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
  registrarApi,
  type ExternalSchoolRecord,
  type ExternalSchoolRecordPayload,
  type ExternalSubjectInput,
  type SF10Data,
} from "@/lib/api";
import SF10Form from "./components/SF10Form";
import { useTheme } from "@/contexts/ThemeContext";
import { toast } from "@/lib/toast";

const gradeLevelLabels: Record<string, string> = {
  GRADE_7: "Grade 7",
  GRADE_8: "Grade 8",
  GRADE_9: "Grade 9",
  GRADE_10: "Grade 10",
};

interface SubjectForm {
  subjectCode: string;
  subjectName: string;
  t1: string;
  t2: string;
  t3: string;
  finalRating: string;
}

const emptySubject = (): SubjectForm => ({
  subjectCode: "",
  subjectName: "",
  t1: "",
  t2: "",
  t3: "",
  finalRating: "",
});

const MAX_IMAGE_DIM = 2200;

function loadImageEl(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("decode failed"));
    };
    img.src = url;
  });
}

/**
 * Mobile photos may be HEIC or very large. Re-encode to a resized JPEG so OCR
 * and upload are reliable. Non-images (e.g. .xlsx) pass through unchanged.
 * Fail-soft: returns the original file if conversion isn't possible.
 */
async function prepareImageForUpload(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  try {
    const img = await loadImageEl(file);
    const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob) return file;
    const base = file.name.replace(/\.[^.]+$/, "");
    return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
  }
}

export default function Sf10RecordsPage() {
  const { studentId = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const studentName = (location.state as { studentName?: string } | null)?.studentName;

  const { colors } = useTheme();
  const [records, setRecords] = useState<ExternalSchoolRecord[]>([]);
  const [lrn, setLrn] = useState("");
  const [loading, setLoading] = useState(true);
  const [sf10Data, setSf10Data] = useState<SF10Data | null>(null);
  const [sf10Loading, setSf10Loading] = useState(true);
  const [recordsOpen, setRecordsOpen] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [ocrRawText, setOcrRawText] = useState("");
  const [scanSource, setScanSource] = useState<"MANUAL" | "SF10_SCAN" | "SF9_SCAN" | "SF10_XLSX">("MANUAL");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const excelInputRef = useRef<HTMLInputElement>(null);
  const sf10Ref = useRef<HTMLDivElement>(null);

  const [schoolYear, setSchoolYear] = useState("");
  const [gradeLevel, setGradeLevel] = useState("GRADE_8");
  const [schoolName, setSchoolName] = useState("");
  const [schoolId, setSchoolId] = useState("");
  const [sectionName, setSectionName] = useState("");
  const [adviserName, setAdviserName] = useState("");
  const [promotionStatus, setPromotionStatus] = useState("");
  const [formType, setFormType] = useState<"SF10" | "SF9">("SF10");
  const [isPartialYear, setIsPartialYear] = useState(false);
  const [subjects, setSubjects] = useState<SubjectForm[]>([emptySubject()]);

  const loadData = useCallback(async () => {
    if (!studentId) return;
    setLoading(true);
    setSf10Loading(true);
    try {
      const res = await registrarApi.getExternalRecords(studentId);
      setRecords(res.data.records || []);
      setLrn(res.data.lrn || "");
    } catch (err) {
      console.error("Failed to load prior-school records:", err);
      toast.error("Failed to load prior-school records");
      setRecords([]);
    } finally {
      setLoading(false);
    }
    try {
      const sf = await registrarApi.getSF10(studentId);
      setSf10Data(sf.data);
    } catch {
      setSf10Data(null);
    } finally {
      setSf10Loading(false);
    }
  }, [studentId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const resetForm = () => {
    setEditingId(null);
    setSchoolYear("");
    setGradeLevel("GRADE_8");
    setSchoolName("");
    setSchoolId("");
    setSectionName("");
    setAdviserName("");
    setPromotionStatus("");
    setFormType("SF10");
    setIsPartialYear(false);
    setSubjects([emptySubject()]);
    setOcrRawText("");
    setScanSource("MANUAL");
  };

  const openAdd = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEdit = (record: ExternalSchoolRecord) => {
    setEditingId(record.id);
    setSchoolYear(record.schoolYear);
    setGradeLevel(record.gradeLevel);
    setSchoolName(record.schoolName);
    setSchoolId(record.schoolId ?? "");
    setSectionName(record.sectionName ?? "");
    setAdviserName(record.adviserName ?? "");
    setPromotionStatus(record.promotionStatus ?? "");
    setFormType(record.formType === "SF9" ? "SF9" : "SF10");
    setIsPartialYear(record.isPartialYear);
    setSubjects(
      record.subjects.length > 0
        ? record.subjects.map((s) => {
            const term = (label: string) =>
              String(s.terms?.find((t) => t.label.toUpperCase() === label)?.value ?? "");
            return {
              subjectCode: s.subjectCode ?? "",
              subjectName: s.subjectName,
              t1: term("T1"),
              t2: term("T2"),
              t3: term("T3"),
              finalRating: s.finalRating != null ? String(s.finalRating) : "",
            };
          })
        : [emptySubject()]
    );
    setDialogOpen(true);
  };

  const updateSubject = (index: number, patch: Partial<SubjectForm>) => {
    setSubjects((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  const handleSave = async () => {
    const cleanedSubjects = subjects
      .filter((s) => s.subjectName.trim())
      .map<ExternalSubjectInput>((s) => {
        const terms = [
          s.t1 ? { label: "T1", value: Math.round(Number(s.t1)) } : null,
          s.t2 ? { label: "T2", value: Math.round(Number(s.t2)) } : null,
          s.t3 ? { label: "T3", value: Math.round(Number(s.t3)) } : null,
        ].filter(Boolean) as Array<{ label: string; value: number }>;
        return {
          subjectCode: s.subjectCode.trim() || undefined,
          subjectName: s.subjectName.trim(),
          terms: terms.length > 0 ? terms : undefined,
          finalRating: s.finalRating ? Math.round(Number(s.finalRating)) : undefined,
        };
      });

    if (!/^\d{4}-\d{4}$/.test(schoolYear.trim())) {
      toast.error("School year must look like YYYY-YYYY");
      return;
    }
    if (!schoolName.trim()) {
      toast.error("Previous school name is required");
      return;
    }
    if (cleanedSubjects.length === 0) {
      toast.error("Add at least one subject with a name");
      return;
    }

    const payload: ExternalSchoolRecordPayload = {
      schoolYear: schoolYear.trim(),
      gradeLevel: gradeLevel as ExternalSchoolRecordPayload["gradeLevel"],
      schoolName: schoolName.trim(),
      schoolId: schoolId.trim() || undefined,
      sectionName: sectionName.trim() || undefined,
      adviserName: adviserName.trim() || undefined,
      promotionStatus: promotionStatus.trim() || undefined,
      formType,
      isPartialYear,
      ocrRawText: ocrRawText || undefined,
      source: scanSource,
      subjects: cleanedSubjects,
    };

    setSaving(true);
    try {
      if (editingId) {
        await registrarApi.updateExternalRecord(editingId, payload);
        toast.success("Prior-school record updated");
      } else {
        await registrarApi.createExternalRecord(studentId, payload);
        toast.success("Prior-school record saved");
      }
      setDialogOpen(false);
      resetForm();
      void loadData();
    } catch (err) {
      const data = (err as { response?: { data?: { message?: string; error?: string } } })?.response?.data;
      toast.error(data?.message || data?.error || "Failed to save prior-school record");
    } finally {
      setSaving(false);
    }
  };

  const handleScanFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const isSheet = /\.xlsx?$/i.test(file.name) || /spreadsheetml|ms-excel/.test(file.type);
    setScanning(true);
    try {
      const uploadFile = await prepareImageForUpload(file);
      const res = await registrarApi.scanSf10(uploadFile);
      const { draft, rawText, confidence, reason } = res.data;
      if (reason) {
        toast.error(reason);
        return;
      }
      resetForm();
      setIsPartialYear(!isSheet && draft.documentType === "SF9");
      setScanSource(isSheet ? "SF10_XLSX" : draft.documentType === "SF9" ? "SF9_SCAN" : "SF10_SCAN");
      setSchoolYear(draft.schoolYear || "");
      setGradeLevel(draft.gradeLevel || "GRADE_8");
      setSchoolName(draft.schoolName || "");
      setSchoolId(draft.schoolId || "");
      setSectionName(draft.sectionName || "");
      setAdviserName(draft.adviserName || "");
      setFormType(draft.documentType === "SF9" ? "SF9" : "SF10");
      setOcrRawText(rawText || "");
      setSubjects(
        draft.subjects.length > 0
          ? draft.subjects.map((s) => {
              const term = (label: string) => {
                const t = s.terms.find((x) => x.label === label);
                return t != null ? String(t.value) : "";
              };
              return {
                subjectCode: "",
                subjectName: s.subjectName,
                t1: term("T1"),
                t2: term("T2"),
                t3: term("T3"),
                finalRating: s.finalRating != null ? String(s.finalRating) : "",
              };
            })
          : [emptySubject()]
      );
      setDialogOpen(true);
      toast.success(`Scanned (${Math.round((confidence || 0) * 100)}% confidence) — review and correct before saving`);
    } catch (err) {
      const data = (err as { response?: { data?: { message?: string; error?: string } } })?.response?.data;
      toast.error(data?.message || data?.error || "Scan failed — enter manually instead");
    } finally {
      setScanning(false);
    }
  };

  const handleDelete = async (record: ExternalSchoolRecord) => {
    if (!window.confirm(`Delete the ${record.schoolYear} ${gradeLevelLabels[record.gradeLevel] || record.gradeLevel} record?`)) {
      return;
    }
    try {
      await registrarApi.deleteExternalRecord(record.id);
      toast.success("Prior-school record deleted");
      void loadData();
    } catch (err) {
      const data = (err as { response?: { data?: { message?: string; error?: string } } })?.response?.data;
      toast.error(data?.message || data?.error || "Failed to delete prior-school record");
    }
  };

  const handlePrint = () => {
    const node = sf10Ref.current;
    if (!node) return;
    const container = document.createElement("div");
    container.className = "sf10-records-print-root";
    container.appendChild(node.cloneNode(true));
    document.body.appendChild(container);

    const style = document.createElement("style");
    style.id = "sf10-records-print-style";
    style.textContent = `
      @media print {
        @page { size: A4 portrait; margin: 10mm 8mm; }
        body > *:not(.sf10-records-print-root) { display: none !important; }
        .sf10-records-print-root { display: block !important; width: 100% !important; }
        .sf10-records-print-root .print-form { box-shadow: none !important; margin: 0 !important; padding: 4mm !important; border: none !important; width: 100% !important; max-width: none !important; }
        .sf10-records-print-root * { font-size: 9pt !important; line-height: 1.3 !important; }
        .sf10-records-print-root table { width: 100% !important; border-collapse: collapse !important; table-layout: fixed; }
        .sf10-records-print-root th, .sf10-records-print-root td { border: 1px solid #000 !important; padding: 1.5px 3px !important; }
        .sf10-records-print-root .bg-gray-200, .sf10-records-print-root .bg-gray-100 { background: #eee !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      }`;
    document.head.appendChild(style);

    const cleanup = () => {
      container.remove();
      style.remove();
    };
    window.addEventListener("afterprint", cleanup, { once: true });
    window.setTimeout(cleanup, 60000);
    window.print();
  };

  return (
    <>
      <div className={`space-y-6 animate-fade-in transition-[padding] duration-200 ${recordsOpen ? "lg:pr-[460px]" : ""}`}>
        {/* Header */}
        <div className="space-y-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/registrar/transferees")}
            className="h-8 -ml-2 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-3.5 h-3.5 mr-1.5" /> Back to Transferees
          </Button>

          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center text-primary-foreground font-bold text-lg shrink-0"
                style={{ backgroundColor: colors.primary }}
                aria-hidden="true"
              >
                {(studentName || "?").charAt(0)}
              </div>
              <div className="min-w-0">
                <h1 className="text-2xl font-bold tracking-tight text-foreground truncate">
                  SF10 - Learner&apos;s Permanent Academic Record
                </h1>
                <p className="text-sm text-muted-foreground truncate mt-0.5">
                  {studentName || "Learner"}
                  {lrn ? ` · LRN ${lrn}` : ""}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={() => setRecordsOpen(true)}
                variant="outline"
                size="sm"
                className="border-border/70 bg-background hover:bg-muted/70 text-foreground font-medium text-xs"
              >
                <History className="w-4 h-4 mr-1.5" /> Prior records{records.length > 0 ? ` (${records.length})` : ""}
              </Button>
              <Button onClick={handlePrint} variant="default" size="sm" className="font-semibold text-xs shadow-sm shadow-primary/20">
                <Printer className="w-4 h-4 mr-1.5" /> Print SF10
              </Button>
            </div>
          </div>
        </div>

        {/* SF10 preview (main) */}
        {sf10Loading ? (
          <Card className="border-0 shadow-sm bg-card rounded-xl p-6">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading SF10...
            </div>
          </Card>
        ) : sf10Data ? (
          <div className="mx-auto w-full max-w-[900px]">
            <div ref={sf10Ref}>
              <SF10Form data={sf10Data} />
            </div>
          </div>
        ) : (
          <Card className="border-0 shadow-sm bg-card rounded-xl">
            <CardContent className="py-16 text-center">
              <p className="text-sm font-medium text-foreground">No SF10 data available</p>
              <p className="text-sm text-muted-foreground mt-1">This learner has no academic records yet.</p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Docked prior-records panel (non-modal — SF10 stays visible) */}
      <aside className={`fixed top-16 bottom-0 right-0 z-20 w-full sm:w-[440px] bg-background border-l border-border shadow-xl flex flex-col print-hide transition-transform duration-200 ${recordsOpen ? "translate-x-0" : "translate-x-full"}`}>
        <div className="px-4 py-3 border-b border-border flex items-start justify-between gap-2 shrink-0">
          <div className="min-w-0">
            <p className="text-sm font-bold text-foreground">Prior-school records</p>
            <p className="text-xs text-muted-foreground truncate">
              {records.length} saved · {studentName || "Learner"}
            </p>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => setRecordsOpen(false)}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="px-4 py-3 border-b border-border flex flex-wrap gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={scanning}
            className="h-8 text-xs border-border/70"
          >
            {scanning ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <ScanLine className="w-3.5 h-3.5 mr-1.5" />}
            Scan
          </Button>
          <input ref={fileInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void handleScanFile(e)} />
          <Button
            variant="outline"
            size="sm"
            onClick={() => excelInputRef.current?.click()}
            disabled={scanning}
            className="h-8 text-xs border-border/70"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" /> Excel
          </Button>
          <input ref={excelInputRef} type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(e) => void handleScanFile(e)} />
          <Button onClick={openAdd} size="sm" className="h-8 text-xs font-semibold shadow-sm shadow-primary/20">
            <Plus className="w-3.5 h-3.5 mr-1.5" /> Add record
          </Button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
          {loading ? (
        <Card className="border-0 shadow-sm bg-card rounded-xl p-6">
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading records...
          </div>
        </Card>
      ) : records.length === 0 ? (
        <Card className="border-0 shadow-sm bg-card rounded-xl">
          <CardContent className="py-16 text-center">
            <p className="text-sm font-medium text-foreground">No prior-school records yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Add the previous school's SF10/SF9 grades so they appear on this learner's SF10.
            </p>
            <Button onClick={openAdd} size="sm" className="mt-4 font-semibold text-xs">
              <Plus className="w-4 h-4 mr-1.5" /> Add record
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {records.map((record) => (
            <Card key={record.id} className="border-0 shadow-sm bg-card rounded-xl">
              <CardContent className="p-4 sm:p-6 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold text-foreground">{record.schoolName}</h2>
                      <Badge variant="outline" className="text-[11px] font-medium">
                        {record.formType}
                      </Badge>
                      <Badge variant="outline" className="text-[11px] font-medium text-muted-foreground">
                        {record.source === "MANUAL" ? "Manual" : record.source === "SF10_XLSX" ? "Excel" : "Scanned"}
                      </Badge>
                      {record.isPartialYear && (
                        <Badge variant="outline" className="text-[11px] font-medium bg-amber-50 text-amber-700 border-amber-200">
                          Partial year
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {gradeLevelLabels[record.gradeLevel] || record.gradeLevel} · S.Y. {record.schoolYear}
                      {record.sectionName ? ` · ${record.sectionName}` : ""}
                      {record.schoolId ? ` · School ID ${record.schoolId}` : ""}
                    </p>
                    {record.generalAverage != null && (
                      <p className="text-xs text-muted-foreground mt-0.5">General average: {record.generalAverage}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openEdit(record)}
                      className="h-8 text-xs border-border/70"
                    >
                      <Pencil className="w-3.5 h-3.5 mr-1.5" /> Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleDelete(record)}
                      className="h-8 text-xs border-destructive/30 text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Delete
                    </Button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse min-w-[520px]">
                    <thead>
                      <tr className="border-b border-border/40 text-muted-foreground">
                        <th className="text-left font-medium uppercase tracking-wide py-2 px-2">Learning area</th>
                        <th className="text-center font-medium uppercase tracking-wide py-2 px-2 w-16">T1</th>
                        <th className="text-center font-medium uppercase tracking-wide py-2 px-2 w-16">T2</th>
                        <th className="text-center font-medium uppercase tracking-wide py-2 px-2 w-16">T3</th>
                        <th className="text-center font-medium uppercase tracking-wide py-2 px-2 w-16">Final</th>
                      </tr>
                    </thead>
                    <tbody>
                      {record.subjects.map((s) => {
                        const term = (label: string) => s.terms?.find((t) => t.label.toUpperCase() === label)?.value;
                        return (
                          <tr key={s.id} className="border-b border-border/20">
                            <td className="py-2 px-2 text-foreground">{s.subjectName}</td>
                            <td className="py-2 px-2 text-center tabular-nums text-muted-foreground">{term("T1") ?? "—"}</td>
                            <td className="py-2 px-2 text-center tabular-nums text-muted-foreground">{term("T2") ?? "—"}</td>
                            <td className="py-2 px-2 text-center tabular-nums text-muted-foreground">{term("T3") ?? "—"}</td>
                            <td className="py-2 px-2 text-center tabular-nums text-foreground font-medium">{s.finalRating ?? "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
        </div>
      </aside>

      <Dialog open={dialogOpen} onOpenChange={(open) => !open && !saving && setDialogOpen(false)}>
        <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-foreground">
              {editingId ? "Edit prior-school record" : "Add prior-school record"}
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Enter grades from the learner's previous school SF10/SF9. These are display-only and do not affect promotion.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs font-medium text-foreground">School year</Label>
              <Input value={schoolYear} onChange={(e) => setSchoolYear(e.target.value)} placeholder="2029-2030" disabled={saving} />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-medium text-foreground">Grade level</Label>
              <Select value={gradeLevel} onValueChange={(v) => v && setGradeLevel(v)} disabled={saving}>
                <SelectTrigger className="h-9 rounded-lg text-xs font-medium">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(gradeLevelLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2 space-y-2">
              <Label className="text-xs font-medium text-foreground">Previous school</Label>
              <Input value={schoolName} onChange={(e) => setSchoolName(e.target.value)} placeholder="Name of previous school" disabled={saving} />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-medium text-foreground">School ID</Label>
              <Input value={schoolId} onChange={(e) => setSchoolId(e.target.value)} placeholder="e.g. 123456" disabled={saving} />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-medium text-foreground">Section</Label>
              <Input value={sectionName} onChange={(e) => setSectionName(e.target.value)} placeholder="Section" disabled={saving} />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-medium text-foreground">
                Adviser / Teacher <span className="text-muted-foreground font-normal">(previous school)</span>
              </Label>
              <Input value={adviserName} onChange={(e) => setAdviserName(e.target.value)} placeholder="Name of adviser" disabled={saving} />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-medium text-foreground">Form type</Label>
              <Select value={formType} onValueChange={(v) => setFormType(v === "SF9" ? "SF9" : "SF10")} disabled={saving}>
                <SelectTrigger className="h-9 rounded-lg text-xs font-medium">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SF10">SF10 (permanent record)</SelectItem>
                  <SelectItem value="SF9">SF9 (report card)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-medium text-foreground">Promotion status</Label>
              <Input value={promotionStatus} onChange={(e) => setPromotionStatus(e.target.value)} placeholder="e.g. Promoted" disabled={saving} />
            </div>
            <div className="sm:col-span-2">
              <label className="flex items-center gap-2 text-xs font-medium text-foreground">
                <input
                  type="checkbox"
                  checked={isPartialYear}
                  onChange={(e) => setIsPartialYear(e.target.checked)}
                  disabled={saving}
                  className="h-4 w-4 rounded border-border"
                />
                Partial year (learner transferred in mid-year; merge with this school's terms)
              </label>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium text-foreground">
                Subjects <span className="text-muted-foreground font-normal">(whole numbers 60–100)</span>
              </Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSubjects((prev) => [...prev, emptySubject()])}
                disabled={saving}
                className="h-8 text-xs border-border/70"
              >
                <Plus className="w-3.5 h-3.5 mr-1.5" /> Add subject
              </Button>
            </div>

            {subjects.map((s, index) => (
              <div key={index} className="rounded-lg border border-border/40 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Input
                    value={s.subjectName}
                    onChange={(e) => updateSubject(index, { subjectName: e.target.value })}
                    placeholder="Learning area (e.g. Mathematics)"
                    disabled={saving}
                    className="text-xs"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setSubjects((prev) => prev.filter((_, i) => i !== index))}
                    disabled={saving || subjects.length === 1}
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  <Input value={s.subjectCode} onChange={(e) => updateSubject(index, { subjectCode: e.target.value })} placeholder="Code" disabled={saving} className="text-xs" />
                  <Input value={s.t1} onChange={(e) => updateSubject(index, { t1: e.target.value })} placeholder="T1" inputMode="decimal" disabled={saving} className="text-xs" />
                  <Input value={s.t2} onChange={(e) => updateSubject(index, { t2: e.target.value })} placeholder="T2" inputMode="decimal" disabled={saving} className="text-xs" />
                  <Input value={s.t3} onChange={(e) => updateSubject(index, { t3: e.target.value })} placeholder="T3" inputMode="decimal" disabled={saving} className="text-xs" />
                  <Input value={s.finalRating} onChange={(e) => updateSubject(index, { finalRating: e.target.value })} placeholder="Final" inputMode="decimal" disabled={saving} className="text-xs" />
                </div>
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
              className="border-border/70 bg-background hover:bg-muted/70 text-foreground font-medium text-xs"
            >
              Cancel
            </Button>
            <Button onClick={() => void handleSave()} disabled={saving} size="sm" className="font-semibold text-xs shadow-sm shadow-primary/20">
              {saving && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
