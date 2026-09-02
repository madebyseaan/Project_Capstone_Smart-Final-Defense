import { useEffect, useState } from "react";
import {
  Loader2,
  RefreshCw,
  Users,
  BookOpen,
  AlertTriangle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { registrarApi } from "@/lib/api";

interface EffectiveAssignment {
  subjectId: number;
  sectionId: number;
  facultyId: number;
  facultyName: string;
  specializationCode: string | null;
  specializationLabel: string | null;
}

interface TeachingLoadData {
  source: {
    schoolId: number;
    schoolYearId: number;
    state: "EMPTY" | "POPULATED";
    version: number;
    initializedAt: string;
    updatedAt: string;
    isActiveSchoolYear: boolean;
  };
  assignments: EffectiveAssignment[];
  coverageTotals: {
    assignedPairs: number;
    activeAssignedPairs: number;
    totalPairs: number;
    unassignedPairs: number;
  };
}

export default function TeachingLoadPage() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<TeachingLoadData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await registrarApi.getAtlasTeachingLoads();
      setData(res.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to fetch teaching load data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <div className="flex items-center gap-2 text-red-700 dark:text-red-300">
            <AlertTriangle className="h-5 w-5" />
            <span className="font-medium">Error loading teaching load</span>
          </div>
          <p className="text-sm text-red-600 dark:text-red-400 mt-1">{error}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={fetchData}>
            <RefreshCw className="h-4 w-4 mr-1" /> Retry
          </Button>
        </div>
      </div>
    );
  }

  const isEmpty = data?.source?.state === "EMPTY" || !data?.assignments?.length;
  const assignments = data?.assignments ?? [];
  const totals = data?.coverageTotals;

  // Group assignments by faculty
  const byFaculty = new Map<string, EffectiveAssignment[]>();
  for (const a of assignments) {
    const key = a.facultyName ?? `Faculty ${a.facultyId}`;
    const list = byFaculty.get(key) ?? [];
    list.push(a);
    byFaculty.set(key, list);
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Teaching Load</h1>
          <p className="text-sm text-muted-foreground">
            ATLAS annual faculty assignments for the active school year
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchData}>
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh
        </Button>
      </div>

      {/* Source info */}
      {data?.source && (
        <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <div className="flex items-center gap-4 text-sm">
            <span className="font-medium text-blue-700 dark:text-blue-300">
              State: <Badge variant={isEmpty ? "secondary" : "default"}>{data.source.state}</Badge>
            </span>
            <span className="text-blue-600 dark:text-blue-400">
              Version: {data.source.version}
            </span>
            <span className="text-blue-600 dark:text-blue-400">
              School Year ID: {data.source.schoolYearId}
            </span>
            {data.source.updatedAt && (
              <span className="text-blue-600 dark:text-blue-400">
                Updated: {new Date(data.source.updatedAt).toLocaleString()}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Coverage summary */}
      {totals && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-slate-900 border rounded-lg p-4">
            <div className="text-sm text-muted-foreground">Total Pairs</div>
            <div className="text-2xl font-bold">{totals.totalPairs}</div>
          </div>
          <div className="bg-white dark:bg-slate-900 border rounded-lg p-4">
            <div className="text-sm text-muted-foreground">Assigned</div>
            <div className="text-2xl font-bold text-green-600">{totals.assignedPairs}</div>
          </div>
          <div className="bg-white dark:bg-slate-900 border rounded-lg p-4">
            <div className="text-sm text-muted-foreground">Unassigned</div>
            <div className="text-2xl font-bold text-orange-600">{totals.unassignedPairs}</div>
          </div>
          <div className="bg-white dark:bg-slate-900 border rounded-lg p-4">
            <div className="text-sm text-muted-foreground">Coverage</div>
            <div className="text-2xl font-bold">
              {totals.totalPairs > 0
                ? `${Math.round((totals.assignedPairs / totals.totalPairs) * 100)}%`
                : "—"}
            </div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {isEmpty && (
        <div className="bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 rounded-lg p-8 text-center">
          <BookOpen className="h-12 w-12 text-yellow-500 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-yellow-700 dark:text-yellow-300">
            No Teaching Load Assigned
          </h3>
          <p className="text-sm text-yellow-600 dark:text-yellow-400 mt-1 max-w-md mx-auto">
            ATLAS has not yet populated faculty assignments for this school year.
            This is expected after a rollover. Teaching load will appear once
            ATLAS schedules are configured.
          </p>
        </div>
      )}

      {/* Assignment list */}
      {!isEmpty && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Users className="h-5 w-5" />
            Faculty Assignments ({assignments.length})
          </h2>

          {Array.from(byFaculty.entries()).map(([faculty, assigns]) => (
            <div key={faculty} className="bg-white dark:bg-slate-900 border rounded-lg overflow-hidden">
              <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800 border-b">
                <span className="font-medium">{faculty}</span>
                <Badge variant="secondary" className="ml-2">{assigns.length}</Badge>
              </div>
              <div className="divide-y">
                {assigns.map((a, i) => (
                  <div key={i} className="px-4 py-2 flex items-center justify-between text-sm">
                    <span>Subject ID: {a.subjectId}</span>
                    <span>Section ID: {a.sectionId}</span>
                    {a.specializationLabel && (
                      <Badge variant="outline">{a.specializationLabel}</Badge>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
