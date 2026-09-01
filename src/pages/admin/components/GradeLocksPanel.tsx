import { useCallback, useEffect, useState } from "react";
import { Lock, LockOpen, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { adminApi } from "@/lib/api";
import { useTheme } from "@/contexts/ThemeContext";

interface TermLock {
  term: "T1" | "T2" | "T3";
  isLocked: boolean;
  lockedBy: string | null;
  lockedAt: string | null;
  unlockedBy: string | null;
  unlockedAt: string | null;
}

interface YearLockRow {
  schoolYearId: string;
  label: string;
  status: string;
  yearLock: { isLocked: boolean; lockedBy: string | null; lockedAt: string | null };
  termLocks: TermLock[];
}

export default function GradeLocksPanel() {
  const { colors } = useTheme();
  const [locks, setLocks] = useState<YearLockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.getYearLocks();
      setLocks(res.data.locks ?? []);
      setError(null);
    } catch {
      setError("Failed to load grade locks");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await action();
      await load();
    } catch {
      setError("Failed to update lock");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mb-8 p-4 rounded-xl border border-gray-200 bg-gray-50">
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="text-sm font-semibold text-gray-700">Per-Year / Per-Term Grade Locks</p>
          <p className="text-xs text-gray-500 mt-1">
            Term locks block a single term (an approved edit request bypasses them). A year lock blocks the whole school year (nothing bypasses it except admin unlock + registrar unfinalize).
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Refresh
        </Button>
      </div>

      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}

      {loading ? (
        <div className="flex items-center gap-2 text-gray-500 py-4">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Loading locks...</span>
        </div>
      ) : locks.length === 0 ? (
        <p className="text-sm text-gray-400 py-2">No school years found.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="font-bold text-gray-700">School Year</TableHead>
              <TableHead className="font-bold text-gray-700">Status</TableHead>
              <TableHead className="font-bold text-gray-700 text-center">T1</TableHead>
              <TableHead className="font-bold text-gray-700 text-center">T2</TableHead>
              <TableHead className="font-bold text-gray-700 text-center">T3</TableHead>
              <TableHead className="font-bold text-gray-700 text-center">Whole Year</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {locks.map((row) => (
              <TableRow key={row.schoolYearId}>
                <TableCell className="font-medium text-gray-900">{row.label}</TableCell>
                <TableCell>
                  <Badge variant="outline">{row.status}</Badge>
                </TableCell>
                {row.termLocks.map((tl) => (
                  <TableCell key={tl.term} className="text-center">
                    <Button
                      size="sm"
                      variant={tl.isLocked ? "destructive" : "outline"}
                      disabled={busy === `${row.schoolYearId}:${tl.term}`}
                      onClick={() =>
                        void toggle(`${row.schoolYearId}:${tl.term}`, () =>
                          adminApi.toggleTermLock(row.schoolYearId, tl.term, !tl.isLocked)
                        )
                      }
                    >
                      {busy === `${row.schoolYearId}:${tl.term}` ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : tl.isLocked ? (
                        <Lock className="w-3.5 h-3.5" />
                      ) : (
                        <LockOpen className="w-3.5 h-3.5" />
                      )}
                    </Button>
                  </TableCell>
                ))}
                <TableCell className="text-center">
                  <Button
                    size="sm"
                    variant={row.yearLock.isLocked ? "destructive" : "outline"}
                    disabled={busy === row.schoolYearId}
                    style={row.yearLock.isLocked ? {} : { borderColor: `${colors.primary}50`, color: colors.primary }}
                    onClick={() =>
                      void toggle(row.schoolYearId, () =>
                        adminApi.toggleYearLock(row.schoolYearId, !row.yearLock.isLocked)
                      )
                    }
                  >
                    {busy === row.schoolYearId ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : row.yearLock.isLocked ? (
                      <Lock className="w-3.5 h-3.5" />
                    ) : (
                      <LockOpen className="w-3.5 h-3.5" />
                    )}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
