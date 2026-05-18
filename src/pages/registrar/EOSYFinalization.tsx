import { useState, useEffect } from "react";
import { GraduationCap, Loader2, AlertTriangle, RefreshCw, CheckCircle, XCircle, Search } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { registrarApi } from "@/lib/api";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { useTheme } from "@/contexts/ThemeContext";

// NOTE: This page is intentionally read-only.
// EOSY finalization (POST /eosy/sections/:id/finalize) writes to EnrollPro and is STRICTLY FORBIDDEN
// in SMART. All finalization actions must be performed directly in EnrollPro.

export default function EOSYFinalization() {
  const { colors } = useTheme();
  
  const [schoolYearsLoading, setSchoolYearsLoading] = useState(true);
  const [schoolYears, setSchoolYears] = useState<any[]>([]);
  const [selectedSchoolYearId, setSelectedSchoolYearId] = useState<string>("");

  const [sectionsLoading, setSectionsLoading] = useState(false);
  const [sectionsError, setSectionsError] = useState<string | null>(null);
  const [sections, setSections] = useState<any[]>([]);

  const [selectedSectionId, setSelectedSectionId] = useState<string>("");
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordsError, setRecordsError] = useState<string | null>(null);
  const [records, setRecords] = useState<any[]>([]);
  const [sectionMeta, setSectionMeta] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState("");

  const loadSchoolYears = async () => {
    setSchoolYearsLoading(true);
    try {
      const res = await registrarApi.getEosySchoolYears();
      const years = (res.data as any) || [];
      setSchoolYears(years);
      
      // Select the active one by default if available
      const active = years.find((y: any) => y.status === "ACTIVE");
      if (active) {
        setSelectedSchoolYearId(String(active.id));
      } else if (years.length > 0) {
        setSelectedSchoolYearId(String(years[0].id));
      }
    } catch (err: any) {
      console.error("Failed to load school years", err);
    } finally {
      setSchoolYearsLoading(false);
    }
  };

  const loadSections = async (syId?: string) => {
    const targetSyId = syId || selectedSchoolYearId;
    if (!targetSyId) return;

    setSectionsLoading(true);
    setSectionsError(null);
    setSelectedSectionId("");
    setRecords([]);
    try {
      const res = await registrarApi.getEosySections(parseInt(targetSyId, 10));
      const payload = res.data as any;
      setSections(payload.sections ?? payload.data ?? payload ?? []);
    } catch (err: any) {
      setSectionsError(err?.response?.data?.message ?? "Failed to load EOSY sections from EnrollPro.");
    } finally {
      setSectionsLoading(false);
    }
  };

  const loadRecords = async (sectionId: string) => {
    setRecordsLoading(true);
    setRecordsError(null);
    setRecords([]);
    setSectionMeta(null);
    try {
      const res = await registrarApi.getEosySectionRecords(parseInt(sectionId, 10));
      const payload = res.data as any;
      const rawRecords: any[] = payload.records ?? payload.learners ?? payload.data ?? [];

      // Normalize: EnrollPro EOSY records nest learner under rec.enrollmentApplication.learner
      const normalized = rawRecords.map((rec: any) => {
        const l = rec.enrollmentApplication?.learner ?? rec.learner ?? rec;
        const rawSex = (l.sex ?? rec.sex ?? "").toString().trim().toUpperCase();
        const sex = rawSex === "MALE" || rawSex === "M" ? "Male" : rawSex === "FEMALE" || rawSex === "F" ? "Female" : "";
        
        // Determine the source of the grade
        const isCurrentYear = rec.finalAverage != null || rec.finalGrade != null || l.finalAverage != null;
        const finalAverage = rec.finalAverage ?? rec.finalGrade ?? l.finalAverage ?? l.previousGenAve ?? null;

        return {
          enrollmentRecordId: rec.id ?? rec.enrollmentRecordId,
          learnerId: l.id ?? rec.learnerId,
          lrn: l.lrn ?? rec.lrn ?? "",
          firstName: l.firstName ?? rec.firstName ?? "",
          lastName: l.lastName ?? rec.lastName ?? "",
          middleName: l.middleName ?? rec.middleName ?? "",
          sex,
          finalAverage,
          isCurrentYear,
          // Promotion status
          promoted: rec.eosyStatus === "PROMOTED" || l.promotionStatus === "PROMOTED" || rec.promoted || rec.isPromoted,
          finalStatus: rec.eosyStatus ?? l.promotionStatus ?? rec.finalStatus ?? "",
          promotedToGradeLevel: rec.promotedToGradeLevel ?? rec.nextGradeLevel ?? "",
        };
      });

      setRecords(normalized);
      setSectionMeta(payload.section ?? payload.meta ?? null);
    } catch (err: any) {
      setRecordsError(err?.response?.data?.message ?? "Failed to load EOSY records from EnrollPro.");
    } finally {
      setRecordsLoading(false);
    }
  };

  useEffect(() => { void loadSchoolYears(); }, []);
  
  useEffect(() => {
    if (selectedSchoolYearId) void loadSections(selectedSchoolYearId);
  }, [selectedSchoolYearId]);

  useEffect(() => {
    if (selectedSectionId) void loadRecords(selectedSectionId);
  }, [selectedSectionId]);

  const filteredRecords = records.filter(r => 
    `${r.firstName} ${r.lastName} ${r.lrn}`.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const promotedCount = records.filter((r) => r.promoted || r.finalStatus === "PROMOTED").length;
  const heldCount = records.filter((r) => !r.promoted && r.finalStatus !== "PROMOTED" && r.finalStatus).length;

  return (
    <div className="space-y-6 animate-fade-in">
      <Breadcrumb items={[{ label: "Dashboard", href: "/registrar" }, { label: "EOSY Finalization" }]} />

      <Card className="border-slate-200 shadow-sm overflow-hidden bg-white">
        <CardHeader className="border-b border-slate-100 bg-white pb-6">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
            <div className="flex flex-col gap-3">
              <div>
                <CardTitle className="text-2xl font-bold text-gray-900 flex items-center gap-3">
                  <div className="p-2 rounded-lg text-white" style={{ backgroundColor: colors.primary }}>
                    <GraduationCap className="w-5 h-5" />
                  </div>
                  EOSY Section List
                </CardTitle>
                <CardDescription className="mt-2 font-medium text-slate-500">
                  Hinigaran National High School — End of School Year Monitoring
                </CardDescription>
              </div>
              
              {/* Read-only notice integrated into header */}
              <div className="bg-amber-50/80 border border-amber-100 rounded-lg px-4 py-2 inline-flex items-center gap-3 mt-1 w-fit">
                <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                <p className="text-amber-800 text-xs">
                  <strong>Read-Only:</strong> SMART displays EOSY data from EnrollPro for reference only. Finalization must be done in EnrollPro directly.
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <Button onClick={() => void loadSections()} variant="outline" className="rounded-xl shadow-sm">
                <RefreshCw className="w-4 h-4 mr-2" /> Refresh
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {/* Controls Area */}
          <div className="p-6 border-b border-slate-100 bg-slate-50/30">
            <div className="flex flex-col gap-4">
              {sectionsLoading || schoolYearsLoading ? (
                <div className="flex items-center gap-3 text-gray-500 py-2">
                  <Loader2 className="w-5 h-5 animate-spin" style={{ color: colors.primary }} />
                  <span className="text-sm">Loading EOSY data…</span>
                </div>
              ) : sectionsError ? (
                <div className="flex items-center gap-3 text-red-500 py-2">
                  <AlertTriangle className="w-5 h-5" />
                  <span className="text-sm">{sectionsError}</span>
                  <Button onClick={() => void loadSections()} variant="outline" size="sm" className="rounded-xl ml-2">Retry</Button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex flex-wrap items-center gap-4">
                    {/* Section Dropdown */}
                    <Select value={selectedSectionId} onValueChange={setSelectedSectionId}>
                      <SelectTrigger className="w-[280px] rounded-xl border-gray-200 bg-white">
                        <SelectValue placeholder="— Select a section —">
                          {(() => {
                            const s = sections.find((s) => String(s.id) === selectedSectionId);
                            if (!s) return null;
                            return `${s.name ?? s.sectionName}${s.gradeLevel?.name ? ` (${s.gradeLevel.name})` : ""}`;
                          })()}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {sections.map((s) => (
                          <SelectItem key={s.id} value={String(s.id)}>
                            {s.name ?? s.sectionName}{s.gradeLevel?.name ? ` (${s.gradeLevel.name})` : ""}
                            {s.finalized ? " ✓ Finalized" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {/* School Year Dropdown */}
                    {schoolYears.length > 0 && (
                      <Select value={selectedSchoolYearId} onValueChange={setSelectedSchoolYearId}>
                        <SelectTrigger className="w-[140px] rounded-xl border-gray-200 bg-white">
                          <SelectValue placeholder="Select SY">
                            {schoolYears.find(sy => String(sy.id) === selectedSchoolYearId)?.yearLabel}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {schoolYears.map((sy) => (
                            <SelectItem key={sy.id} value={String(sy.id)}>
                              {sy.yearLabel} {sy.status === "ACTIVE" ? "(Active)" : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}

                    {/* Status Text */}
                    <span className="text-sm font-medium text-slate-500">
                      {sections.length} section(s) available
                    </span>
                  </div>

                  {/* Search Bar */}
                  <div className="relative w-full md:w-64">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <Input 
                      placeholder="Search learners..." 
                      className="pl-9 rounded-xl border-slate-200 bg-white shadow-sm focus:ring-primary/20"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Table Area */}
          {selectedSectionId ? (
            <div className="bg-white">
              {recordsLoading ? (
                <div className="flex flex-col items-center justify-center py-32 text-center">
                  <Loader2 className="w-10 h-10 animate-spin text-slate-300 mb-4" />
                  <p className="text-slate-500 font-medium">Fetching learner records...</p>
                </div>
              ) : recordsError ? (
                <div className="flex flex-col items-center justify-center py-24 text-center px-4">
                  <AlertTriangle className="w-12 h-12 text-amber-500 mb-4" />
                  <p className="text-gray-700 font-semibold text-lg">Unable to load records</p>
                  <p className="text-gray-500 text-sm mt-1 max-w-sm">{recordsError}</p>
                  <Button onClick={() => void loadRecords(selectedSectionId)} variant="outline" className="mt-6 rounded-xl">Try Again</Button>
                </div>
              ) : (
                <>
                  {/* Table Header/Metadata */}
                  <div className="px-6 py-4 bg-white border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="text-sm">
                      <span className="text-slate-500">Learner records for </span>
                      <span className="font-bold text-slate-900">
                        {sectionMeta?.name ?? sections.find((s) => String(s.id) === selectedSectionId)?.name ?? "Section"}
                      </span>
                      {searchTerm && (
                        <span className="ml-2 text-slate-400">
                          (Found {filteredRecords.length} of {records.length})
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-xs font-medium">
                      <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-50 text-emerald-700">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                        <span>{promotedCount} Promoted</span>
                      </div>
                      {heldCount > 0 && (
                        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-red-50 text-red-700">
                          <div className="w-1.5 h-1.5 rounded-full bg-red-500"></div>
                          <span>{heldCount} Held</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-gray-50/50 hover:bg-gray-50/50">
                          <TableHead className="font-bold text-gray-700 w-12 pl-6">#</TableHead>
                          <TableHead className="font-bold text-gray-700">LRN</TableHead>
                          <TableHead className="font-bold text-gray-700">Learner Name</TableHead>
                          <TableHead className="font-bold text-gray-700">Sex</TableHead>
                          <TableHead className="font-bold text-gray-700">Final Average</TableHead>
                          <TableHead className="font-bold text-gray-700">Status</TableHead>
                          <TableHead className="font-bold text-gray-700 pr-6">Promoted To</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredRecords.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={7} className="text-center py-20 text-gray-500">
                              {searchTerm ? "No learners match your search" : "No EOSY records for this section"}
                            </TableCell>
                          </TableRow>
                        ) : (
                          filteredRecords.map((rec: any, i: number) => {
                            const isPromoted = rec.promoted || rec.finalStatus === "PROMOTED";
                            return (
                              <TableRow key={rec.enrollmentRecordId ?? rec.learnerId ?? i} className="hover:bg-slate-50/50 transition-colors">
                                <TableCell className="text-gray-400 text-sm pl-6">{i + 1}</TableCell>
                                <TableCell className="font-mono text-sm text-gray-600">{rec.lrn ?? "—"}</TableCell>
                                <TableCell className="font-medium text-gray-900">
                                  {rec.lastName}, {rec.firstName} {rec.middleName ?? ""}
                                </TableCell>
                                <TableCell>
                                  <Badge className={rec.sex === "Male" ? "bg-blue-50 text-blue-700 border-blue-100" : "bg-pink-50 text-pink-700 border-pink-100"} variant="outline">
                                    {rec.sex ?? "—"}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  <div className="flex flex-col gap-1">
                                    <span className="font-semibold text-gray-900">
                                      {rec.finalAverage != null ? rec.finalAverage.toFixed(2) : "—"}
                                    </span>
                                    {rec.finalAverage != null && (
                                      rec.isCurrentYear ? (
                                        <Badge variant="outline" className="w-fit text-[10px] py-0 px-1.5 bg-blue-50 text-blue-600 border-blue-200">
                                          Current SY
                                        </Badge>
                                      ) : (
                                        <Badge variant="outline" className="w-fit text-[10px] py-0 px-1.5 bg-amber-50 text-amber-600 border-amber-200">
                                          Historical
                                        </Badge>
                                      )
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  {isPromoted ? (
                                    <Badge className="bg-emerald-100 text-emerald-700 gap-1 border-emerald-200">
                                      <CheckCircle className="w-3 h-3" /> PROMOTED
                                    </Badge>
                                  ) : rec.finalStatus ? (
                                    <Badge className="bg-red-100 text-red-700 gap-1 border-red-200">
                                      <XCircle className="w-3 h-3" /> {rec.finalStatus}
                                    </Badge>
                                  ) : (
                                    <Badge className="bg-gray-100 text-gray-500 border-gray-200" variant="outline">—</Badge>
                                  )}
                                </TableCell>
                                <TableCell className="text-sm text-gray-600 pr-6">
                                  {rec.promotedToGradeLevel?.name ?? rec.nextGradeLevel?.name ?? "—"}
                                </TableCell>
                              </TableRow>
                            );
                          })
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-40 text-center px-4 bg-slate-50/10 border-t border-slate-100">
               <GraduationCap className="w-16 h-16 text-slate-200 mb-6" />
               <p className="text-slate-500 font-semibold text-xl">No Section Selected</p>
               <p className="text-slate-400 text-sm mt-2 max-w-sm">
                 Please select a section and academic year from the filters above to view the End of School Year records.
               </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
