/**
 * Sf10Tab.tsx — read-only SF10 (Permanent Record) rendered inside the vault.
 */
import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Printer, Loader2, FileWarning, CloudOff, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { registrarApi } from "@/lib/api";
import { useTheme } from "@/contexts/ThemeContext";
import SF10Form from "../SF10Form";
import { printForm } from "./printForm";
import { isSyntheticStudentId, type VaultStudent } from "./types";

interface Sf10TabProps {
  student: VaultStudent;
  available: boolean;
  onRequestSync: () => void;
}

export default function Sf10Tab({ student, available, onRequestSync }: Sf10TabProps) {
  const { schoolName } = useTheme();
  const formRef = useRef<HTMLDivElement>(null);

  const sf10Query = useQuery({
    queryKey: ["registrar", "vault", "sf10", student.id],
    queryFn: async () => (await registrarApi.getSF10(student.id)).data,
    enabled: available,
    retry: 0,
    staleTime: 60_000,
  });

  if (isSyntheticStudentId(student.id)) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
        <CloudOff className="w-10 h-10 text-muted-foreground/60" />
        <p className="text-sm font-semibold text-foreground">This learner is not yet in SMART</p>
        <p className="text-xs text-muted-foreground max-w-sm">
          The record only exists in EnrollPro. Run <span className="font-medium text-foreground">Sync from EnrollPro</span> so
          their SF10 and report cards become available here.
        </p>
        <Button size="sm" className="mt-1 font-semibold text-xs" onClick={onRequestSync}>
          <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
          Sync from EnrollPro
        </Button>
      </div>
    );
  }

  if (!available) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
        <FileWarning className="w-10 h-10 text-muted-foreground/60" />
        <p className="text-sm font-semibold text-foreground">No SF10 available</p>
        <p className="text-xs text-muted-foreground">This learner has no permanent record data in SMART.</p>
      </div>
    );
  }

  if (sf10Query.isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground text-sm">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading SF10…
      </div>
    );
  }

  if (sf10Query.isError || !sf10Query.data) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
        <FileWarning className="w-10 h-10 text-destructive/70" />
        <p className="text-sm font-semibold text-foreground">Could not load SF10</p>
        <p className="text-xs text-muted-foreground">Try closing and reopening the file.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between print-hide">
        <div>
          <h3 className="text-sm font-semibold text-foreground">SF10 — Permanent Record</h3>
          <p className="text-xs text-muted-foreground">Read-only view · use Print to produce the official copy</p>
        </div>
        <Button
          size="sm"
          className="font-semibold text-xs"
          onClick={() => printForm(formRef.current, "vault-sf10-print-style")}
        >
          <Printer className="w-3.5 h-3.5 mr-1.5" />
          Print SF10
        </Button>
      </div>
      <div className="overflow-x-auto">
        <div ref={formRef} className="min-w-[820px]">
          <SF10Form data={sf10Query.data} schoolName={schoolName} />
        </div>
      </div>
    </div>
  );
}
