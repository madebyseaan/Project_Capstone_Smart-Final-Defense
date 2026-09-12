import { KeyRound, Shield } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SystemSettings as SystemSettingsType } from "@/lib/api";

interface SecuritySectionProps {
  settings: SystemSettingsType;
  onChange: (field: keyof SystemSettingsType, value: string | boolean | number) => void;
}

export function SecuritySection({ settings, onChange }: SecuritySectionProps) {
  return (
    <Card className="p-0 gap-0 border border-border shadow-sm rounded-xl bg-card overflow-hidden">
      <CardHeader className="px-6 py-4 border-b border-border bg-primary/5">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-xl bg-primary/10 text-primary">
            <Shield className="w-6 h-6" />
          </div>
          <div>
            <CardTitle className="text-lg text-foreground">Security &amp; Retention</CardTitle>
            <CardDescription className="normal-case">
              Login policy and how long automatic records are kept
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <KeyRound className="w-4 h-4 text-primary" />
          <p className="text-sm font-semibold text-foreground">Login &amp; Password Policy</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="space-y-2">
            <Label htmlFor="maxLoginAttempts" className="text-sm font-semibold text-foreground">Max Login Attempts</Label>
            <Select value={String(settings.maxLoginAttempts || 5)} onValueChange={(val) => val && onChange("maxLoginAttempts", parseInt(val))}>
              <SelectTrigger id="maxLoginAttempts">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="3">3 attempts</SelectItem>
                <SelectItem value="5">5 attempts</SelectItem>
                <SelectItem value="10">10 attempts</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Failed attempts per 15 minutes before lockout.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="passwordMinLength" className="text-sm font-semibold text-foreground">Min Password Length</Label>
            <Select value={String(settings.passwordMinLength || 6)} onValueChange={(val) => val && onChange("passwordMinLength", parseInt(val))}>
              <SelectTrigger id="passwordMinLength">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="6">6 characters</SelectItem>
                <SelectItem value="8">8 characters</SelectItem>
                <SelectItem value="10">10 characters</SelectItem>
                <SelectItem value="12">12 characters</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Enforced when creating or resetting users.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="requireSpecialChar" className="text-sm font-semibold text-foreground">Require Special Character</Label>
            <label
              htmlFor="requireSpecialChar"
              className="flex items-center gap-2 h-10 px-3 rounded-xl border border-border cursor-pointer"
            >
              <Checkbox
                id="requireSpecialChar"
                checked={settings.requireSpecialChar || false}
                onChange={(e) => onChange("requireSpecialChar", e.target.checked)}
              />
              <span className="text-sm text-foreground">Password must include a symbol</span>
            </label>
            <p className="text-xs text-muted-foreground">Applies to new passwords only.</p>
          </div>
        </div>

        <Separator className="my-6" />

        <div className="space-y-4">
          <p className="text-sm font-semibold text-foreground">Data Retention</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label htmlFor="auditLogRetentionDays" className="text-xs text-muted-foreground">Audit Logs (days)</Label>
              <Input
                id="auditLogRetentionDays"
                type="number"
                min={0}
                max={3650}
                value={settings.auditLogRetentionDays ?? 365}
                onChange={(e) => onChange("auditLogRetentionDays", parseInt(e.target.value) || 0)}
              />
              <p className="text-[11px] text-muted-foreground">Older activity records are deleted automatically.</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="syncHistoryRetentionDays" className="text-xs text-muted-foreground">Sync History (days)</Label>
              <Input
                id="syncHistoryRetentionDays"
                type="number"
                min={0}
                max={3650}
                value={settings.syncHistoryRetentionDays ?? 90}
                onChange={(e) => onChange("syncHistoryRetentionDays", parseInt(e.target.value) || 0)}
              />
              <p className="text-[11px] text-muted-foreground">EnrollPro/ATLAS sync run history.</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="gradeSnapshotRetentionDays" className="text-xs text-muted-foreground">Grade Snapshots (days)</Label>
              <Input
                id="gradeSnapshotRetentionDays"
                type="number"
                min={0}
                max={3650}
                value={settings.gradeSnapshotRetentionDays ?? 0}
                onChange={(e) => onChange("gradeSnapshotRetentionDays", parseInt(e.target.value) || 0)}
              />
              <p className="text-[11px] text-muted-foreground">0 = keep forever. Snapshots are the audit trail for grades.</p>
            </div>
          </div>
        </div>

        <Separator className="my-6" />

        <div className="flex items-start gap-2 rounded-xl border-2 border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          <Shield className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
          <span>
            Database connectivity, sync history, and integration health are on the{" "}
            <Link to="/admin/system-health" className="font-medium text-primary underline-offset-2 hover:underline">
              System Health
            </Link>{" "}
            page.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
