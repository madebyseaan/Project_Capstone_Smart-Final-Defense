import { useState, useEffect } from "react";
import { Layers, Loader2, AlertTriangle, RefreshCw, Users } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { registrarApi } from "@/lib/api";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { useTheme } from "@/contexts/ThemeContext";

export default function SectionRosterViewer() {
  const { colors } = useTheme();
  const [sections, setSections] = useState<any[]>([]);
  const [sectionsLoading, setSectionsLoading] = useState(true);
  const [sectionsError, setSectionsError] = useState<string | null>(null);

  const [selectedSectionId, setSelectedSectionId] = useState<string>("");
  // enrollProId is the numeric EnrollPro section ID needed for the roster API
  const [selectedEnrollProId, setSelectedEnrollProId] = useState<number | null>(null);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [roster, setRoster] = useState<{ section: any; learners: any[]; total: number } | null>(null);

  const loadSections = async () => {
    setSectionsLoading(true);
    setSectionsError(null);
    try {
      const res = await registrarApi.getSections();
      const payload = res.data as any;
      const raw: any[] = payload.sections ?? payload.data ?? payload ?? [];
      setSections(raw.filter((s: any) => s.id && s.name));
    } catch (err: any) {
      setSectionsError("Failed to load sections.");
    } finally {
      setSectionsLoading(false);
    }
  };

  const loadRoster = async (enrollProId: number) => {
    setRosterLoading(true);
    setRosterError(null);
    setRoster(null);
    try {
      const res = await registrarApi.getSectionRoster(enrollProId);
      const payload = res.data as any;
      // Normalise the learner fields from integration v1 shape:
      // data.learners[].learner.{lrn, firstName, lastName, middleName, sex}
      const rawLearners: any[] = payload.learners ?? [];
      const learners = rawLearners.map((row: any) => {
        const l = row.learner ?? row;
        return {
          enrollmentRecordId: row.enrollmentRecordId,
          lrn: l.lrn ?? row.lrn,
          firstName: l.firstName ?? row.firstName,
          lastName: l.lastName ?? row.lastName,
          middleName: l.middleName ?? row.middleName,
          sex: l.sex ?? row.sex,
          motherTongue: l.motherTongue ?? row.motherTongue,
        };
      });
      setRoster({ section: payload.section, learners, total: payload.total ?? learners.length });
    } catch (err: any) {
      setRosterError(err?.response?.data?.message ?? "Failed to load roster from EnrollPro.");
    } finally {
      setRosterLoading(false);
    }
  };

  useEffect(() => { void loadSections(); }, []);
  useEffect(() => {
    if (selectedEnrollProId) void loadRoster(selectedEnrollProId);
  }, [selectedEnrollProId]);

  const handleSectionChange = (smartId: string) => {
    setSelectedSectionId(smartId);
    setRoster(null);
    setRosterError(null);
    const sec = sections.find((s: any) => String(s.id) === smartId);
    const epId: number | null = sec?.enrollProId ?? null;
    setSelectedEnrollProId(epId);
    if (epId) void loadRoster(epId);
    else setRosterError("This section has no EnrollPro ID — try refreshing the page to re-sync.");
  };

  const selectedSection = sections.find((s) => String(s.id) === selectedSectionId);

  return (
    <div className="space-y-6 animate-fade-in">
      <Breadcrumb items={[{ label: "Dashboard", href: "/registrar" }, { label: "Section Roster" }]} />

      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Section Roster Viewer</h1>
          <p className="text-gray-600 mt-1">
            View the official learner list for any section from EnrollPro — read-only.
          </p>
        </div>
        {selectedSectionId && selectedEnrollProId && (
          <Button onClick={() => void loadRoster(selectedEnrollProId)} variant="outline" className="rounded-xl">
            <RefreshCw className="w-4 h-4 mr-2" /> Refresh Roster
          </Button>
        )}
      </div>

      {/* Section picker */}
      <Card className="border border-slate-200">
        <CardHeader className="pb-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl text-white" style={{ backgroundColor: colors.primary }}>
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <CardTitle>Select Section</CardTitle>
              <CardDescription>Choose a section to view its official learner roster</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          {sectionsLoading ? (
            <div className="flex items-center gap-3 text-gray-500">
              <Loader2 className="w-5 h-5 animate-spin" style={{ color: colors.primary }} />
              <span>Loading sections…</span>
            </div>
          ) : sectionsError ? (
            <div className="flex items-center gap-3 text-red-500">
              <AlertTriangle className="w-5 h-5" />
              <span>{sectionsError}</span>
              <Button onClick={loadSections} variant="outline" size="sm" className="rounded-xl ml-2">Retry</Button>
            </div>
          ) : (
            <Select value={selectedSectionId} onValueChange={handleSectionChange}>
              <SelectTrigger className="w-full max-w-sm">
                <SelectValue placeholder="— Select a section —">
                  {(() => {
                    const s = sections.find((sec) => String(sec.id) === selectedSectionId);
                    return s ? `${s.name}${s.gradeLevel ? ` (${String(s.gradeLevel).replace("GRADE_", "Grade ")})` : ""}${!s.enrollProId ? " ⚠" : ""}` : "— Select a section —";
                  })()}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {sections.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.name}{s.gradeLevel ? ` (${String(s.gradeLevel).replace("GRADE_", "Grade ")})` : ""}
                    {!s.enrollProId ? " ⚠" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </CardContent>
      </Card>

      {/* Roster table */}
      {selectedSectionId && (
        <Card className="border border-slate-200">
          <CardHeader className="border-b border-slate-100 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl text-white" style={{ backgroundColor: colors.primary }}>
                <Users className="w-5 h-5" />
              </div>
              <div>
                <CardTitle>{selectedSection?.name ?? "Section Roster"}</CardTitle>
                <CardDescription>
                  {selectedSection?.gradeLevel?.name ?? selectedSection?.schoolYear ?? ""}{" "}
                  {roster ? `— ${roster.total} learner(s)` : ""}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {rosterLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-8 h-8 animate-spin" style={{ color: colors.primary }} />
              </div>
            ) : rosterError ? (
              <div className="flex flex-col items-center justify-center py-16 text-center px-4">
                <AlertTriangle className="w-10 h-10 text-amber-500 mb-3" />
                <p className="text-gray-700 font-medium">Unable to load roster</p>
                <p className="text-gray-500 text-sm mt-1">{rosterError}</p>
                <Button onClick={() => void loadRoster(selectedSectionId)} variant="outline" className="mt-4 rounded-xl">Try Again</Button>
              </div>
            ) : roster ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gray-50/80">
                      <TableHead className="font-bold text-gray-700 w-8">#</TableHead>
                      <TableHead className="font-bold text-gray-700">LRN</TableHead>
                      <TableHead className="font-bold text-gray-700">Learner Name</TableHead>
                      <TableHead className="font-bold text-gray-700">Sex</TableHead>
                      <TableHead className="font-bold text-gray-700">Mother Tongue</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {roster.learners.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-12 text-gray-500">
                          No learners in this section
                        </TableCell>
                      </TableRow>
                    ) : (
                      roster.learners.map((l: any, i: number) => (
                        <TableRow key={l.lrn ?? l.enrollmentRecordId ?? i}>
                          <TableCell className="text-gray-500 text-sm">{i + 1}</TableCell>
                          <TableCell className="font-mono text-sm text-gray-600">{l.lrn ?? "—"}</TableCell>
                          <TableCell className="font-medium text-gray-900">
                            {l.lastName}, {l.firstName} {l.middleName ?? ""}
                          </TableCell>
                          <TableCell>
                            <Badge className={l.sex === "MALE" ? "bg-blue-100 text-blue-700" : "bg-pink-100 text-pink-700"}>
                              {l.sex ?? "—"}
                            </Badge>
                          </TableCell>
                          <TableCell>{l.motherTongue ?? "—"}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
