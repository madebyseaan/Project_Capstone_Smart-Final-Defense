import { useState, useEffect } from "react";
import { BookOpen, Plus, Trash2, RefreshCw, AlertTriangle, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { adminApi } from "@/lib/api";

export default function ClassAssignments() {
  const [schoolYear, setSchoolYear] = useState("");
  const [schoolYears, setSchoolYears] = useState<Array<{ id: string; label: string; status: string }>>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [workloadSummary, setWorkloadSummary] = useState<Array<{
    teacherId: string;
    teacherName: string;
    sectionId: string;
    sectionName: string;
    gradeLevel: string;
    hgMinutes: number;
    advisoryRoleMinutes: number;
    otherSubjectMinutes: number;
    totalMinutes: number;
  }>>([]);
  const [options, setOptions] = useState<{ teachers: any[]; subjects: any[]; sections: any[] }>({
    teachers: [],
    subjects: [],
    sections: [],
  });
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ teacherId: "", subjectId: "", sectionId: "" });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    adminApi.getSchoolYears().then((res) => {
      const years = res.data.schoolYears;
      if (Array.isArray(years) && years.length > 0) {
        setSchoolYears(years);
        const active = years.find((y) => y.status === "ACTIVE");
        const defaultYear = active?.label || years[0].label;
        setSchoolYear((prev) => prev || defaultYear);
      }
    }).catch(() => {});
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [assignRes, optRes] = await Promise.all([
        adminApi.getClassAssignments(schoolYear),
        adminApi.getClassAssignmentOptions(schoolYear),
      ]);
      setAssignments(assignRes.data?.assignments ?? []);
      setWorkloadSummary(assignRes.data?.workloadSummary ?? []);
      setOptions(optRes.data);
    } catch (e: any) {
      setError(e.message ?? "Failed to load class assignments");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [schoolYear]);

  const handleCreate = async () => {
    if (!form.teacherId || !form.subjectId || !form.sectionId) {
      setError("Please fill in all fields");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      await adminApi.createClassAssignment({ ...form, schoolYear });
      setForm({ teacherId: "", subjectId: "", sectionId: "" });
      setShowForm(false);
      setSuccess("Assignment created successfully");
      await loadData();
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e.response?.data?.message ?? e.message ?? "Failed to create assignment");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this class assignment?")) return;
    try {
      await adminApi.deleteClassAssignment(id);
      setSuccess("Assignment deleted");
      await loadData();
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e.response?.data?.message ?? "Failed to delete");
    }
  };

  const gradeLevelLabel = (gl: string) =>
    gl?.replace("GRADE_", "Grade ") ?? gl;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Class Assignments</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Teaching load — which teacher handles which subject in which section.
            Synced automatically from Atlas on teacher login.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={schoolYear} onValueChange={setSchoolYear}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {schoolYears.map((sy) => (
                <SelectItem key={sy.id} value={sy.label}>{sy.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => { setShowForm(!showForm); setError(null); }}>
            <Plus className="h-4 w-4 mr-1" />
            Add Assignment
          </Button>
        </div>
      </div>

      {/* Info banner about Atlas */}
      <Card className="border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950">
        <CardContent className="pt-4 pb-3">
          <div className="flex gap-2 text-sm text-blue-800 dark:text-blue-200">
            <BookOpen className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              <strong>Automatic sync:</strong> When a teacher logs in, SMART pulls their teaching load from Atlas and
              updates this list in real-time. If Atlas has no schedules configured yet, you can add assignments manually below.
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Success / Error alerts */}
      {success && (
        <div className="rounded-md bg-green-50 border border-green-200 px-4 py-2 text-sm text-green-800 dark:bg-green-950 dark:text-green-200">
          {success}
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 rounded-md bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Create Form */}
      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New Class Assignment</CardTitle>
            <CardDescription>Manually assign a teacher to a subject and section for {schoolYear}.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <Label className="mb-1 block">Teacher</Label>
                <Select value={form.teacherId} onValueChange={(v) => setForm((f) => ({ ...f, teacherId: v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select teacher..." />
                  </SelectTrigger>
                  <SelectContent>
                    {options.teachers.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.lastName}, {t.firstName} ({t.employeeId})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-1 block">Subject</Label>
                <Select value={form.subjectId} onValueChange={(v) => setForm((f) => ({ ...f, subjectId: v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select subject..." />
                  </SelectTrigger>
                  <SelectContent>
                    {options.subjects.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.code} — {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-1 block">Section</Label>
                <Select value={form.sectionId} onValueChange={(v) => setForm((f) => ({ ...f, sectionId: v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select section..." />
                  </SelectTrigger>
                  <SelectContent>
                    {options.sections.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}{s.program && s.program !== 'REGULAR' ? ` (${s.program})` : ''} ({gradeLevelLabel(s.gradeLevel)})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <Button onClick={handleCreate} disabled={creating}>
                {creating && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Save Assignment
              </Button>
              <Button variant="outline" onClick={() => { setShowForm(false); setError(null); }}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Assignments Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <BookOpen className="h-4 w-4" />
            Assignments — {schoolYear}
            <Badge variant="secondary" className="ml-1">{assignments.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Loading assignments...
            </div>
          ) : assignments.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <BookOpen className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p className="font-medium">No class assignments yet for {schoolYear}</p>
              <p className="text-sm mt-1">
                Assignments will appear here when teachers log in (Atlas sync) or when you add them manually above.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Teacher</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Section</TableHead>
                  <TableHead>Grade Level</TableHead>
                  <TableHead className="w-16"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assignments.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">
                      {a.teacher?.user?.lastName ?? ""}, {a.teacher?.user?.firstName ?? ""}
                      <span className="text-xs text-muted-foreground ml-1">
                        ({a.teacher?.employeeId ?? "—"})
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded mr-1">
                        {a.subject?.code ?? "—"}
                      </span>
                      {a.subject?.name ?? "—"}
                    </TableCell>
                    <TableCell>{a.section?.name ?? "—"}{a.section?.program && a.section.program !== 'REGULAR' ? ` (${a.section.program})` : ''}</TableCell>
                    <TableCell>{gradeLevelLabel(a.section?.gradeLevel ?? "")}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => handleDelete(a.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Workload Summary (DepEd Compliance)</CardTitle>
          <CardDescription>
            Line 1: HG minutes, Line 2: Advisory role credit, Line 3: Other subject minutes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-sm text-muted-foreground">Loading workload summary...</div>
          ) : workloadSummary.length === 0 ? (
            <div className="text-sm text-muted-foreground">No workload summary entries yet for {schoolYear}.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Teacher</TableHead>
                  <TableHead>Section</TableHead>
                  <TableHead>Line 1: HG</TableHead>
                  <TableHead>Line 2: Advisory Role</TableHead>
                  <TableHead>Line 3: Other Subjects</TableHead>
                  <TableHead>Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workloadSummary.map((row) => (
                  <TableRow key={`${row.teacherId}-${row.sectionId}`}>
                    <TableCell className="font-medium">{row.teacherName}</TableCell>
                    <TableCell>{row.sectionName} ({gradeLevelLabel(row.gradeLevel)})</TableCell>
                    <TableCell>{row.hgMinutes} min</TableCell>
                    <TableCell>{row.advisoryRoleMinutes} min</TableCell>
                    <TableCell>{row.otherSubjectMinutes} min</TableCell>
                    <TableCell className="font-semibold">{row.totalMinutes} min</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
