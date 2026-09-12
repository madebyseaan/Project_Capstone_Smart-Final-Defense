import { useState } from "react";
import { AlertOctagon, Info, Loader2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { adminApi } from "@/lib/api";
import type { SystemSettings as SystemSettingsType } from "@/lib/api";
import { toast } from "@/lib/toast";
import GradeLocksPanel from "./GradeLocksPanel";
import RolloverStatusCard from "./RolloverStatusCard";

interface GradeLockSectionProps {
  settings: SystemSettingsType;
  onSettingsChange: (patch: Partial<SystemSettingsType>) => void;
}

const PRECEDENCE = [
  { label: "Archived year", hint: "Permanent. Set when a school year is archived (rollover). No bypass." },
  { label: "Year lock", hint: "Blocks the whole school year. Only an admin unlock opens it." },
  { label: "Term lock", hint: "Blocks a single term. An approved edit request lets a teacher through." },
  { label: "Emergency lock", hint: "Below: blocks grade editing for every school year at once." },
];

export function GradeLockSection({ settings, onSettingsChange }: GradeLockSectionProps) {
  const [gradeLockModalOpen, setGradeLockModalOpen] = useState(false);
  const [gradeLockLoading, setGradeLockLoading] = useState(false);
  const [transitionModalOpen, setTransitionModalOpen] = useState(false);
  const [transitionLoading, setTransitionLoading] = useState(false);
  const [transitionNote, setTransitionNote] = useState("");

  const confirmGradeLock = async () => {
    setGradeLockLoading(true);
    try {
      await adminApi.toggleGradeLock(!settings.gradeLock);
      onSettingsChange({ gradeLock: !settings.gradeLock });
      setGradeLockModalOpen(false);
      toast.success(settings.gradeLock ? "Emergency grade lock removed" : "Emergency grade lock enabled");
    } catch (err) {
      console.error("Failed to toggle grade lock:", err);
      toast.error("Failed to toggle grade lock");
    } finally {
      setGradeLockLoading(false);
    }
  };

  const confirmTransitionLock = async () => {
    setTransitionLoading(true);
    try {
      const next = !settings.transitionLock;
      const res = await adminApi.toggleTransitionLock(next, next ? (transitionNote || undefined) : undefined);
      onSettingsChange({
        transitionLock: res.data.transitionLock,
        transitionNote: next ? (transitionNote || undefined) : undefined,
      });
      setTransitionModalOpen(false);
      if (!next) setTransitionNote("");
      toast.success(next ? "Teacher logins locked" : "Teacher logins unlocked");
    } catch (err) {
      console.error("Failed to toggle transition lock:", err);
      toast.error("Failed to toggle teacher login lock");
    } finally {
      setTransitionLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* How locks work */}
      <div className="p-4 rounded-xl border border-border bg-muted/40">
        <div className="flex items-center gap-2 mb-3">
          <Info className="w-4 h-4 text-primary" />
          <p className="text-sm font-semibold text-foreground">How grade locks work</p>
        </div>
        <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {PRECEDENCE.map((step, i) => (
            <li key={step.label} className="p-3 rounded-xl bg-background border border-border">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-[11px] font-bold mb-1.5">
                {i + 1}
              </span>
              <p className="text-sm font-medium text-foreground">{step.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{step.hint}</p>
            </li>
          ))}
        </ol>
        <p className="text-xs text-muted-foreground mt-3">
          A blocked edit returns a clear reason (Archived, Year locked, Term locked, or System locked).
        </p>
      </div>

      <GradeLocksPanel />

      {/* Emergency system-wide lock */}
      <div className="p-4 rounded-xl border-2 border-destructive/30 bg-destructive/5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-destructive/10 shrink-0">
              <AlertOctagon className="w-5 h-5 text-destructive" />
            </div>
            <div>
              <Label className="text-sm font-semibold text-foreground">Emergency: Lock All Grade Editing</Label>
              <p className="text-sm text-muted-foreground mt-1">
                {settings.gradeLock
                  ? "LOCKED for every school year. No teacher can edit grades anywhere."
                  : "Open. Teachers can edit grades where year/term locks allow."}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                This is the broadest lock (all years). Use only for emergencies — prefer per-term or per-year locks.
              </p>
            </div>
          </div>
          <Button
            variant={settings.gradeLock ? "outline" : "destructive"}
            size="sm"
            disabled={gradeLockLoading}
            onClick={() => setGradeLockModalOpen(true)}
          >
            {gradeLockLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {settings.gradeLock ? "Remove Emergency Lock" : "Lock All Grades"}
          </Button>
        </div>
      </div>

      {/* Transition (teacher login) lock */}
      <div className="p-4 rounded-xl border border-border bg-muted/40">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-primary/10 shrink-0">
              <ShieldAlert className="w-5 h-5 text-primary" />
            </div>
            <div className="min-w-0">
              <Label className="text-sm font-semibold text-foreground">Teacher Login Lock (Transition)</Label>
              <p className="text-sm text-muted-foreground mt-1">
                {settings.transitionLock
                  ? "Teachers are BLOCKED from logging in. Admin and Registrar are unaffected."
                  : "Teachers can log in normally."}
              </p>
              {settings.transitionLock && settings.transitionNote && (
                <p className="text-xs text-muted-foreground mt-1">Reason shown to teachers: “{settings.transitionNote}”</p>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                Enable during school-year transition so teachers don’t edit while data migrates.
              </p>
              {!settings.transitionLock && (
                <Input
                  value={transitionNote}
                  onChange={(e) => setTransitionNote(e.target.value)}
                  placeholder="Optional reason shown to teachers"
                  className="mt-2 h-9 max-w-md rounded-lg text-xs"
                />
              )}
            </div>
          </div>
          <Button
            variant={settings.transitionLock ? "outline" : "destructive"}
            size="sm"
            disabled={transitionLoading}
            onClick={() => setTransitionModalOpen(true)}
          >
            {transitionLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {settings.transitionLock ? "Unlock Teachers" : "Lock Teachers"}
          </Button>
        </div>
      </div>

      <RolloverStatusCard />

      <ConfirmDialog
        open={gradeLockModalOpen}
        onOpenChange={setGradeLockModalOpen}
        title={settings.gradeLock ? "Remove emergency grade lock?" : "Lock all grade editing?"}
        description={
          settings.gradeLock
            ? "Grade editing will be re-opened for every school year (still subject to term and year locks)."
            : "Every teacher will be blocked from editing grades in every school year until this is turned off."
        }
        confirmLabel={settings.gradeLock ? "Remove lock" : "Lock all grades"}
        destructive={!settings.gradeLock}
        loading={gradeLockLoading}
        onConfirm={confirmGradeLock}
      />

      <ConfirmDialog
        open={transitionModalOpen}
        onOpenChange={setTransitionModalOpen}
        title={settings.transitionLock ? "Unlock teacher logins?" : "Lock teacher logins?"}
        description={
          settings.transitionLock
            ? "Teachers will be able to log in again immediately."
            : "All teachers will be blocked from logging in until this is turned off. Admin and Registrar can still log in."
        }
        confirmLabel={settings.transitionLock ? "Unlock" : "Lock teachers"}
        destructive={!settings.transitionLock}
        loading={transitionLoading}
        onConfirm={confirmTransitionLock}
      />
    </div>
  );
}
