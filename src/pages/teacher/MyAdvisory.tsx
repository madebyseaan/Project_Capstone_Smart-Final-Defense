import { useEffect, useState, useCallback } from "react";
import { useSyncStream } from "@/hooks/useSyncStream";
import { Link, useLocation } from "react-router-dom";
import {
  Users,
  GraduationCap,
  ChevronRight,
  Search,
  UserCircle,
  ClipboardList,
  SplitSquareHorizontal,
  RefreshCw,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { advisoryApi, type AdvisoryData } from "@/lib/api";
import { useTheme } from "@/contexts/ThemeContext";
import { cn } from "@/lib/utils";

const gradeLevelLabels: Record<string, string> = {
  GRADE_7: "Grade 7",
  GRADE_8: "Grade 8",
  GRADE_9: "Grade 9",
  GRADE_10: "Grade 10",
};

export default function MyAdvisory() {
  const location = useLocation();
  const { colors } = useTheme();
  const { syncVersion } = useSyncStream();
  const [data, setData] = useState<AdvisoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [separateByGender, setSeparateByGender] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const handleSync = async () => {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const res = await advisoryApi.syncFromEnrollPro();
      const { studentsFound, advisorySection: foundSection } = (res.data as any);
      if (!foundSection) {
        setSyncMessage("Sync complete — no advisory section found. If you are assigned an advisory class, please contact the admin.");
      } else {
        setSyncMessage(`Sync complete — ${studentsFound} student${studentsFound !== 1 ? 's' : ''} found for ${foundSection}.`);
      }
      await fetchAdvisory();
    } catch {
      setSyncMessage("Sync failed. Please try again.");
    } finally {
      setSyncing(false);
    }
  };

  const fetchAdvisory = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    if (!silent) setError(null);
    try {
      const res = await advisoryApi.getMyAdvisory();
      setData(res.data);
    } catch (err) {
      if (!silent) setError("Failed to load advisory data");
      console.error(err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // Re-fetch when navigating to the page (location.key changes) or after background sync
  useEffect(() => {
    fetchAdvisory();
  }, [fetchAdvisory, location.key, syncVersion]);

  // Silent background sync on every page load — pulls fresh data from EnrollPro
  // then re-fetches advisory so new students appear automatically
  useEffect(() => {
    advisoryApi.syncFromEnrollPro()
      .then(() => fetchAdvisory(true)) // silent=true: no spinner, no error toast
      .catch(() => {/* silent — manual button still available */});
  }, [location.key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-center">
          <div 
            className="w-20 h-20 mx-auto mb-6 rounded-2xl flex items-center justify-center shadow-lg animate-pulse"
            style={{ backgroundColor: `${colors.primary}10` }}
          >
            <div 
              className="w-10 h-10 border-[3px] border-t-transparent rounded-full animate-spin"
              style={{ borderColor: colors.primary, borderTopColor: 'transparent' }}
            />
          </div>
          <p className="text-slate-500 font-medium text-lg">Loading advisory records...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-[60vh] p-4">
        <div className="text-center max-w-sm p-10 bg-white rounded-[2.5rem] shadow-2xl shadow-slate-200/50 border border-slate-100">
          <div className="w-20 h-20 mx-auto mb-6 rounded-3xl bg-rose-50 flex items-center justify-center">
            <UserCircle className="w-10 h-10 text-rose-500" />
          </div>
          <h3 className="font-black text-slate-900 text-2xl mb-2">Access Denied</h3>
          <p className="text-slate-500 mb-8 text-sm leading-relaxed">{error}</p>
          <Button 
            onClick={() => window.location.reload()} 
            className="w-full h-12 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-bold transition-all"
          >
            Try to Reconnect
          </Button>
        </div>
      </div>
    );
  }

  if (!data?.hasAdvisory) {
    return (
      <div className="flex items-center justify-center h-[60vh] p-4">
        <div className="text-center max-w-md p-10 bg-white rounded-[2.5rem] border border-slate-100 shadow-2xl shadow-slate-200/50">
          <div className="w-20 h-20 mx-auto mb-6 rounded-3xl bg-slate-50 flex items-center justify-center text-slate-300">
            <ClipboardList className="w-10 h-10" />
          </div>
          <h3 className="font-black text-slate-900 text-2xl mb-3">No Advisory Assigned</h3>
          <p className="text-slate-500 mb-8 text-sm leading-relaxed">
            You are not currently designated as an adviser for any section. Please contact the registrar or system administrator for assignment.
          </p>
          <div className="flex flex-col gap-3">
            <Button
              onClick={handleSync}
              disabled={syncing}
              className="w-full h-12 rounded-2xl font-bold transition-all"
              style={{ backgroundColor: syncing ? undefined : colors.primary }}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Syncing from EnrollPro...' : 'Sync from EnrollPro'}
            </Button>
            {syncMessage && <p className="text-xs text-slate-500 text-center">{syncMessage}</p>}
            <Link to="/teacher" className="w-full">
              <Button variant="outline" className="w-full h-12 rounded-2xl border-slate-200 text-slate-600 font-bold hover:bg-slate-50 transition-all">
                Return to Dashboard
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Filter students based on search query
  const filteredStudents = data.students?.filter((student) => {
    const fullName = `${student.lastName}, ${student.firstName} ${student.middleName || ""}`.toLowerCase();
    const lrn = student.lrn.toLowerCase();
    const query = searchQuery.toLowerCase();
    return fullName.includes(query) || lrn.includes(query);
  }) || [];

  // Separate by gender if enabled
  const maleStudents = filteredStudents
    .filter((s) => s.gender?.toLowerCase() === "male")
    .sort((a, b) => {
      const nameA = `${a.lastName}, ${a.firstName}`.toLowerCase();
      const nameB = `${b.lastName}, ${b.firstName}`.toLowerCase();
      return nameA.localeCompare(nameB);
    });

  const femaleStudents = filteredStudents
    .filter((s) => s.gender?.toLowerCase() === "female")
    .sort((a, b) => {
      const nameA = `${a.lastName}, ${a.firstName}`.toLowerCase();
      const nameB = `${b.lastName}, ${b.firstName}`.toLowerCase();
      return nameA.localeCompare(nameB);
    });

  // Combined list (alphabetically sorted)
  const sortedStudents = [...filteredStudents].sort((a, b) => {
    const nameA = `${a.lastName}, ${a.firstName}`.toLowerCase();
    const nameB = `${b.lastName}, ${b.firstName}`.toLowerCase();
    return nameA.localeCompare(nameB);
  });

  return (
    <div className="space-y-8 animate-fade-in max-w-7xl mx-auto pb-12">
      {/* Header Section - Refined Glass Style */}
      <div className="relative overflow-hidden rounded-[2.5rem] bg-white border border-slate-100 p-8 shadow-xl shadow-slate-200/50">
        <div 
          className="absolute top-0 right-0 w-64 h-64 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" 
          style={{ backgroundColor: `${colors.primary}15` }}
        />
        
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-8">
          <div className="flex items-center gap-6">
            <div 
              className="w-20 h-20 rounded-[2rem] text-white flex items-center justify-center shadow-xl transition-all duration-500"
              style={{ 
                backgroundColor: colors.primary,
                boxShadow: `0 20px 25px -5px ${colors.primary}40, 0 10px 10px -5px ${colors.primary}20`
              }}
            >
              <GraduationCap className="w-10 h-10" />
            </div>
            <div>
              <div className="flex items-center gap-3 mb-1.5">
                <Badge 
                  variant="secondary" 
                  className="text-[10px] font-black uppercase tracking-widest px-3 border"
                  style={{ 
                    backgroundColor: `${colors.primary}10`, 
                    color: colors.primary,
                    borderColor: `${colors.primary}20`
                  }}
                >
                  Class Adviser
                </Badge>
                <div className="h-4 w-px bg-slate-200" />
                <span className="text-slate-400 text-[10px] font-black uppercase tracking-widest">S.Y. {data.section?.schoolYear}</span>
              </div>
              <h1 className="text-3xl font-black text-slate-900 tracking-tight">
                {gradeLevelLabels[data.section?.gradeLevel || ""] || data.section?.gradeLevel} &mdash; {data.section?.name}
              </h1>
              <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-1.5 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" />
                {data.stats?.totalStudents || 0} Learners Managed
              </p>
            </div>
          </div>
          
          <div className="flex flex-col items-end gap-3">
            <div className="flex items-center gap-4 bg-slate-50/80 backdrop-blur-sm px-6 py-4 rounded-[2rem] border border-slate-100 shadow-sm">
               <Avatar className="w-12 h-12 border-2 border-white shadow-md">
                 <AvatarFallback 
                    className="text-white font-black text-lg"
                    style={{ backgroundColor: colors.primary }}
                 >
                   {data.teacher.name.charAt(0)}
                 </AvatarFallback>
               </Avatar>
               <div>
                 <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1.5">Assigned Teacher</p>
                 <p className="text-base font-black text-slate-800 tracking-tight">{data.teacher.name}</p>
               </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSync}
              disabled={syncing}
              className="h-10 px-5 rounded-2xl border-slate-200 text-slate-600 font-black text-[10px] uppercase tracking-widest transition-all group/sync"
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-2 ${syncing ? 'animate-spin' : ''} group-hover/sync:text-primary`} />
              <span className="group-hover/sync:text-slate-900">{syncing ? 'SYNCING...' : 'SYNC FROM ENROLLPRO'}</span>
              <style dangerouslySetInnerHTML={{ __html: `
                .group\\/sync:hover {
                  background-color: ${colors.primary}10 !important;
                  border-color: ${colors.primary}30 !important;
                  color: ${colors.primary} !important;
                }
              `}} />
            </Button>
            {syncMessage && (
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{syncMessage}</p>
            )}
          </div>
        </div>
      </div>

      {/* Quick Insights Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-6">
        {[
          { label: "TOTAL CLASS", value: data.stats?.totalStudents || 0, icon: Users, color: "theme" },
          { label: "MALE LEARNERS", value: data.stats?.maleCount || 0, icon: UserCircle, color: "blue" },
          { label: "FEMALE LEARNERS", value: data.stats?.femaleCount || 0, icon: UserCircle, color: "pink" },
        ].map((stat) => (
          <Card key={stat.label} className="border-0 shadow-lg shadow-slate-200/50 overflow-hidden rounded-[2rem] bg-white group hover:-translate-y-1 transition-all duration-300">
            <CardContent className="p-6 flex items-center gap-5">
              <div 
                className={cn(
                  "p-3.5 rounded-2xl group-hover:scale-110 transition-transform",
                  stat.color === "blue" ? "bg-blue-50 text-blue-600" : 
                  stat.color === "pink" ? "bg-pink-50 text-pink-600" : ""
                )}
                style={stat.color === "theme" ? { 
                  backgroundColor: `${colors.primary}15`, 
                  color: colors.primary 
                } : {}}
              >
                <stat.icon className="w-6 h-6" />
              </div>
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{stat.label}</p>
                <p className="text-2xl font-black text-slate-900 leading-none">{stat.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Main Directory Table */}
      <Card className="border-0 shadow-2xl shadow-slate-200/40 bg-white rounded-[2.5rem] overflow-hidden">
        <CardHeader className="border-b border-slate-50 p-8 pb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
          <div className="flex items-center gap-5">
            <h2 className="text-xl font-black text-slate-900 tracking-tight uppercase">Student Directory</h2>
            <div className="h-6 w-px bg-slate-100 hidden sm:block" />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSeparateByGender(!separateByGender)}
              className={cn(
                "h-9 px-4 rounded-xl text-[10px] font-black uppercase tracking-[0.1em] transition-all border",
                separateByGender ? "bg-slate-900 text-white border-slate-900" : "text-slate-400 hover:text-slate-900 hover:bg-slate-50 border-slate-100"
              )}
            >
              <SplitSquareHorizontal className="w-4 h-4 mr-2" />
              {separateByGender ? "GENDER SEPARATED" : "BY GENDER"}
            </Button>
          </div>
          
          <div className="relative w-full sm:w-80 group">
            <div 
              className="absolute left-4 top-1/2 -translate-y-1/2 p-1.5 rounded-lg bg-slate-100 text-slate-400 group-focus-within:text-white transition-all"
              style={{
                // We'll handle background color via style for focus-within if possible, or just use a custom class
              } as any}
            >
              <Search className="w-3.5 h-3.5" />
              <style dangerouslySetInnerHTML={{ __html: `
                .group:focus-within .absolute.left-4 {
                  background-color: ${colors.primary} !important;
                }
              `}} />
            </div>
            <Input
              type="text"
              placeholder="Search by name or LRN..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-14 h-12 text-xs font-bold bg-slate-50 border-0 rounded-2xl transition-all placeholder:text-slate-400"
              style={{
                // focus ring color
                outlineColor: `${colors.primary}20`
              } as any}
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/50 hover:bg-transparent border-0">
                  <TableHead className="w-16 text-center text-[10px] font-black text-slate-400 uppercase tracking-widest px-8">#</TableHead>
                  <TableHead className="w-40 text-[10px] font-black text-slate-400 uppercase tracking-widest">Learner Reference (LRN)</TableHead>
                  <TableHead className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Full Legal Name</TableHead>
                  {!separateByGender && <TableHead className="text-center w-32 text-[10px] font-black text-slate-400 uppercase tracking-widest">Gender</TableHead>}
                  <TableHead className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Parent / Guardian</TableHead>
                  <TableHead className="w-32 text-right pr-8 text-[10px] font-black text-slate-400 uppercase tracking-widest">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(() => {
                  const renderRow = (student: any, idx: number) => (
                    <TableRow key={student.id} className="hover:bg-slate-50/50 transition-all border-slate-50 group">
                      <TableCell className="text-center text-slate-300 font-black text-[10px] px-8">{idx + 1}</TableCell>
                      <TableCell className="font-mono text-xs text-slate-400 font-bold tracking-tighter group-hover:text-slate-900 transition-colors">{student.lrn}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-4">
                          <Avatar className="w-9 h-9 border-2 border-white shadow-sm ring-1 ring-slate-100">
                            <AvatarFallback className={cn(
                              "text-white font-black text-xs",
                              student.gender?.toLowerCase() === "male" ? "bg-blue-500" : "bg-pink-500"
                            )}>
                              {student.lastName.charAt(0)}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-black text-slate-900 text-sm tracking-tight">{student.lastName}, {student.firstName}</p>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">{student.middleName || ""}</p>
                          </div>
                        </div>
                      </TableCell>
                      {!separateByGender && (
                        <TableCell className="text-center">
                          <Badge 
                            variant="secondary" 
                            className={cn(
                              "text-[9px] font-black uppercase px-3 h-6 rounded-lg border-0",
                              student.gender?.toLowerCase() === "male" ? "bg-blue-50 text-blue-600" : "bg-pink-50 text-pink-600"
                            )}
                          >
                            {student.gender || 'N/A'}
                          </Badge>
                        </TableCell>
                      )}
                      <TableCell className="text-xs text-slate-500 font-bold italic">
                        {student.guardianName || student.fatherName || student.motherName
                          ? student.guardianName || `${student.fatherName || ''}${student.fatherName && student.motherName ? ' / ' : ''}${student.motherName || ''}`
                          : <span className="text-slate-200">UNSPECIFIED</span>}
                      </TableCell>
                      <TableCell className="text-right pr-8">
                        <Link to={`/teacher/advisory/student/${student.id}`}>
                          <Button 
                            size="sm" 
                            variant="ghost" 
                            className="h-10 px-4 rounded-xl text-slate-400 font-black text-[10px] tracking-widest uppercase transition-all group/profile"
                          >
                            <span className="group-hover/profile:text-primary">PROFILE</span>
                            <ChevronRight className="w-4 h-4 ml-2 group-hover/profile:translate-x-1 transition-transform" />
                            <style dangerouslySetInnerHTML={{ __html: `
                              .group\\/profile:hover {
                                background-color: ${colors.primary}10 !important;
                                color: ${colors.primary} !important;
                              }
                            `}} />
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  );

                  if (separateByGender) {
                    return (
                      <>
                        {maleStudents.length > 0 && (
                          <>
                            <TableRow className="bg-blue-50/20 hover:bg-blue-50/20 border-y border-blue-100/30">
                              <TableCell colSpan={6} className="py-3 px-8">
                                <span className="text-[11px] font-black text-blue-600 uppercase tracking-[0.2em] flex items-center gap-2">
                                  <div className="w-2 h-2 rounded-full bg-blue-500" />
                                  MALE STUDENTS ({maleStudents.length})
                                </span>
                              </TableCell>
                            </TableRow>
                            {maleStudents.map((s, i) => renderRow(s, i))}
                          </>
                        )}
                        {femaleStudents.length > 0 && (
                          <>
                            <TableRow className="bg-pink-50/20 hover:bg-pink-50/20 border-y border-pink-100/30">
                              <TableCell colSpan={6} className="py-3 px-8">
                                <span className="text-[11px] font-black text-pink-600 uppercase tracking-[0.2em] flex items-center gap-2">
                                  <div className="w-2 h-2 rounded-full bg-pink-500" />
                                  FEMALE STUDENTS ({femaleStudents.length})
                                </span>
                              </TableCell>
                            </TableRow>
                            {femaleStudents.map((s, i) => renderRow(s, i))}
                          </>
                        )}
                      </>
                    );
                  }

                  if (sortedStudents.length === 0) {
                    return (
                      <TableRow>
                        <TableCell colSpan={6} className="py-24 text-center">
                          <div className="w-16 h-16 bg-slate-50 rounded-3xl flex items-center justify-center mx-auto mb-4">
                            <Search className="w-8 h-8 text-slate-200" />
                          </div>
                          <p className="text-slate-400 font-black text-xs uppercase tracking-widest">
                            {searchQuery ? "No matching records found" : "No enrolled students yet"}
                          </p>
                          {!searchQuery && (
                            <p className="text-slate-300 text-xs mt-2">
                              Enrollment for this school year has not yet opened in EnrollPro.
                            </p>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  }

                  return sortedStudents.map((s, i) => renderRow(s, i));
                })()}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
