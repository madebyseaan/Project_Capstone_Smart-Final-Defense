/**
 * PriorRecordsTab.tsx — saved prior-school (external) records for the learner.
 */
import { useQuery } from "@tanstack/react-query";
import { Loader2, History, ExternalLink, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { registrarApi } from "@/lib/api";
import { formatVaultGradeLevel, type VaultStudent } from "./types";

interface PriorRecordsTabProps {
  student: VaultStudent;
  count: number;
  onManage: () => void;
}

export default function PriorRecordsTab({ student, count, onManage }: PriorRecordsTabProps) {
  const recordsQuery = useQuery({
    queryKey: ["registrar", "vault", "prior-records", student.id],
    queryFn: async () => (await registrarApi.getExternalRecords(student.id)).data.records,
    enabled: count > 0,
    retry: 0,
    staleTime: 60_000,
  });

  if (count === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
        <History className="w-10 h-10 text-muted-foreground/60" />
        <p className="text-sm font-semibold text-foreground">No prior school records</p>
        <p className="text-xs text-muted-foreground max-w-sm">
          Scanned or encoded records from the learner&apos;s previous school will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between print-hide">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Prior School Records</h3>
          <p className="text-xs text-muted-foreground">Records carried over from another school</p>
        </div>
        <Button variant="outline" size="sm" className="text-xs font-medium" onClick={onManage}>
          <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
          Manage records
        </Button>
      </div>

      {recordsQuery.isLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading prior records…
        </div>
      ) : recordsQuery.isError || !recordsQuery.data?.length ? (
        <p className="text-sm text-muted-foreground text-center py-16">No prior records could be loaded.</p>
      ) : (
        <div className="space-y-2">
          {recordsQuery.data.map((record) => (
            <div key={record.id} className="rounded-xl border border-border bg-card px-4 py-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-foreground">
                  {record.schoolYear || "Unknown SY"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {record.gradeLevel ? formatVaultGradeLevel(record.gradeLevel) : ""}
                </span>
                {record.isPartialYear && (
                  <Badge variant="outline" className="text-[10px] font-medium">Partial year</Badge>
                )}
                {record.locked && (
                  <Badge variant="outline" className="text-[10px] font-medium inline-flex items-center gap-1">
                    <Lock className="w-3 h-3" /> Locked
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1 truncate">
                {record.schoolName || "Previous school"} · {record.subjects.length} subject{record.subjects.length !== 1 ? "s" : ""}
                {record.generalAverage != null ? ` · Average ${record.generalAverage}` : ""}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
