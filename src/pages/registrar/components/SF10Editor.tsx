import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Loader2, Save, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { registrarApi } from "@/lib/api";
import type { SF10Data, Sf10ProfileUpdatePayload } from "@/lib/api";
import { toast } from "@/lib/toast";

interface SF10EditorProps {
  data: SF10Data;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
  /** Emits a live preview patch (SF10 student fields) as the registrar types. */
  onPreview?: (patch: Record<string, unknown>) => void;
  /** Emits which SF10 block the registrar is editing, for on-form highlighting. */
  onFocusSection?: (section: "learner" | "eligibility" | "transferee") => void;
}

const toDateOnly = (value?: string | null): string => {
  if (!value) return "";
  const part = String(value).split("T")[0];
  return /^\d{4}-\d{2}-\d{2}$/.test(part) ? part : "";
};

// The SF10 payload renders sex as "Male"/"Female", but the API expects the
// MALE/FEMALE enum. Normalize before sending or every save fails validation.
const toGenderEnum = (value?: string | null): "" | "MALE" | "FEMALE" => {
  const v = String(value ?? "").trim().toUpperCase();
  if (v === "MALE" || v === "M") return "MALE";
  if (v === "FEMALE" || v === "F") return "FEMALE";
  return "";
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <Checkbox checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="text-sm font-medium text-foreground">{label}</span>
    </label>
  );
}

interface EditorForm {
  birthDate: string;
  gender: string;
  previousSchool: string;
  lastGradeCompleted: string;
  transferCertNo: string;
  transferInDate: string;
  elementarySchoolCompleter: boolean;
  elementarySchoolName: string;
  elementaryGeneralAverage: string;
  peptPasser: boolean;
  peptRating: string;
  peptExamDate: string;
  alsAePasser: boolean;
}

/** Builds the SF10 preview patch. Sex is converted back to the form's display case. */
function toPreviewPatch(form: EditorForm): Record<string, unknown> {
  return {
    birthDate: form.birthDate || null,
    gender: form.gender === "MALE" ? "Male" : form.gender === "FEMALE" ? "Female" : "",
    previousSchool: form.previousSchool || null,
    lastGradeCompleted: form.lastGradeCompleted || null,
    transferCertNo: form.transferCertNo || null,
    transferInDate: form.transferInDate || null,
    elementarySchoolCompleter: form.elementarySchoolCompleter,
    elementarySchoolName: form.elementarySchoolName || null,
    elementaryGeneralAverage: form.elementaryGeneralAverage === "" ? null : Number(form.elementaryGeneralAverage),
    peptPasser: form.peptPasser,
    peptRating: form.peptRating === "" ? null : Number(form.peptRating),
    peptExamDate: form.peptExamDate || null,
    alsAePasser: form.alsAePasser,
  };
}

export default function SF10Editor({ data, onCancel, onSaved, onPreview, onFocusSection }: SF10EditorProps) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    birthDate: toDateOnly(data.student.birthDate),
    gender: toGenderEnum(data.student.gender),
    previousSchool: data.student.previousSchool || "",
    lastGradeCompleted: data.student.lastGradeCompleted || "",
    transferCertNo: data.student.transferCertNo || "",
    transferInDate: toDateOnly(data.student.transferInDate),
    elementarySchoolCompleter: !!data.student.elementarySchoolCompleter,
    elementarySchoolName: data.student.elementarySchoolName || "",
    elementaryGeneralAverage:
      data.student.elementaryGeneralAverage != null ? String(data.student.elementaryGeneralAverage) : "",
    peptPasser: !!data.student.peptPasser,
    peptRating: data.student.peptRating != null ? String(data.student.peptRating) : "",
    peptExamDate: toDateOnly(data.student.peptExamDate),
    alsAePasser: !!data.student.alsAePasser,
  });

  const set = (patch: Partial<typeof form>) => setForm((prev) => ({ ...prev, ...patch }));

  // Live preview: push field edits to the SF10 form as the registrar types.
  useEffect(() => {
    onPreview?.(toPreviewPatch(form));
  }, [form, onPreview]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: Sf10ProfileUpdatePayload = {
        birthDate: form.birthDate || null,
        gender: form.gender ? (form.gender as "MALE" | "FEMALE") : null,
        previousSchool: form.previousSchool || null,
        lastGradeCompleted: form.lastGradeCompleted || null,
        transferCertNo: form.transferCertNo || null,
        transferInDate: form.transferInDate || null,
        elementarySchoolCompleter: form.elementarySchoolCompleter,
        elementarySchoolName: form.elementarySchoolName || null,
        elementaryGeneralAverage: form.elementaryGeneralAverage === "" ? null : Number(form.elementaryGeneralAverage),
        peptPasser: form.peptPasser,
        peptRating: form.peptRating === "" ? null : Number(form.peptRating),
        peptExamDate: form.peptExamDate || null,
        alsAePasser: form.alsAePasser,
      };
      await registrarApi.updateSf10Profile(data.student.id, payload);
      toast.success("SF10 profile saved");
      await onSaved();
    } catch (err) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e?.response?.data?.message || "Failed to save SF10 profile");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border-0 shadow-none rounded-none bg-background p-0 overflow-hidden h-full flex flex-col">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2 shrink-0">
        <p className="text-sm font-bold text-foreground">Edit SF10 Profile</p>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onCancel} disabled={saving}>
          <X className="w-4 h-4" />
        </Button>
      </div>
      <CardContent className="p-4 space-y-5 flex-1 min-h-0 overflow-y-auto">
        <div className="space-y-3" onFocusCapture={() => onFocusSection?.("learner")}>
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Learner</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Birthdate">
              <Input type="date" value={form.birthDate} onChange={(e) => set({ birthDate: e.target.value })} />
            </Field>
            <Field label="Sex">
              <Select value={form.gender || undefined} onValueChange={(v) => set({ gender: v === "MALE" || v === "FEMALE" ? v : undefined })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MALE">Male</SelectItem>
                  <SelectItem value="FEMALE">Female</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <p className="text-[11px] text-muted-foreground">Name and LRN are managed in EnrollPro and cannot be edited here.</p>
        </div>

        <div className="space-y-3 pt-3 border-t border-border" onFocusCapture={() => onFocusSection?.("transferee")}>
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Transferee</p>
          <Field label="Previous School">
            <Input value={form.previousSchool} onChange={(e) => set({ previousSchool: e.target.value })} placeholder="Name of previous school" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Last Grade Completed">
              <Input value={form.lastGradeCompleted} onChange={(e) => set({ lastGradeCompleted: e.target.value })} placeholder="e.g. Grade 6" />
            </Field>
            <Field label="Transfer Cert No.">
              <Input value={form.transferCertNo} onChange={(e) => set({ transferCertNo: e.target.value })} />
            </Field>
          </div>
          <Field label="Date Transferred In">
            <Input type="date" value={form.transferInDate} onChange={(e) => set({ transferInDate: e.target.value })} />
          </Field>
        </div>

        <div className="space-y-3 pt-3 border-t border-border" onFocusCapture={() => onFocusSection?.("eligibility")}>
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Eligibility for JHS Enrolment</p>
          <ToggleRow label="Elementary School Completer" checked={form.elementarySchoolCompleter} onChange={(v) => set({ elementarySchoolCompleter: v })} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name of Elementary School">
              <Input value={form.elementarySchoolName} onChange={(e) => set({ elementarySchoolName: e.target.value })} />
            </Field>
            <Field label="General Average">
              <Input type="number" min={0} max={100} value={form.elementaryGeneralAverage} onChange={(e) => set({ elementaryGeneralAverage: e.target.value })} placeholder="e.g. 85" />
            </Field>
          </div>
          <ToggleRow label="PEPT Passer" checked={form.peptPasser} onChange={(v) => set({ peptPasser: v })} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="PEPT Rating">
              <Input type="number" min={0} max={100} value={form.peptRating} onChange={(e) => set({ peptRating: e.target.value })} />
            </Field>
            <Field label="Date of Examination / Assessment">
              <Input type="date" value={form.peptExamDate} onChange={(e) => set({ peptExamDate: e.target.value })} />
            </Field>
          </div>
          <ToggleRow label="ALS A & E Passer" checked={form.alsAePasser} onChange={(v) => set({ alsAePasser: v })} />
        </div>
      </CardContent>

      <div className="px-4 py-3 border-t border-border flex items-center justify-end gap-2 shrink-0">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button size="sm" onClick={handleSave} disabled={saving} className="font-semibold">
          {saving ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Save className="w-4 h-4 mr-1.5" />}
          Save
        </Button>
      </div>
    </Card>
  );
}
