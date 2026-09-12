import { CheckCircle2, Image, Link2, Loader2, MapPin, RefreshCw, School } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { SERVER_URL } from "@/lib/api";
import type { SystemSettings as SystemSettingsType } from "@/lib/api";

interface SchoolInformationSectionProps {
  settings: SystemSettingsType;
  onChange: (field: keyof SystemSettingsType, value: string | boolean) => void;
  syncing: boolean;
  syncError: string | null;
  syncSuccess: boolean;
  onSync: () => void;
}

const readOnlyInput = "rounded-xl border-border bg-muted text-muted-foreground cursor-not-allowed";
const editableInput = "rounded-xl border-border";

export function SchoolInformationSection({
  settings,
  onChange,
  syncing,
  syncError,
  syncSuccess,
  onSync,
}: SchoolInformationSectionProps) {
  return (
    <div className="space-y-6">
      {/* ── Synced from EnrollPro (read-only) ─────────────────────────────── */}
      <Card className="p-0 gap-0 border border-border shadow-sm rounded-xl bg-card overflow-hidden">
        <CardHeader className="px-6 py-4 border-b border-border bg-primary/5">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-xl bg-primary/10 text-primary">
              <Link2 className="w-6 h-6" />
            </div>
            <div className="flex-1">
              <CardTitle className="text-lg text-foreground">Synced from EnrollPro</CardTitle>
              <CardDescription className="normal-case">
                EnrollPro is the source of truth for these fields
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl shrink-0 border-primary/40 text-primary hover:bg-primary/10"
              onClick={onSync}
              disabled={syncing}
            >
              {syncing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
              {syncing ? "Syncing..." : "Sync from EnrollPro"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <div className="mb-4 p-3 bg-primary/5 border-2 border-primary/20 rounded-xl text-sm text-foreground">
            These values update automatically from EnrollPro every hour. To change them, edit them in
            EnrollPro first, then click <strong>Sync from EnrollPro</strong>.
            {!syncing && settings.lastEnrollProSync && (
              <span className="block text-xs text-muted-foreground mt-1">
                Last synced: {new Date(settings.lastEnrollProSync).toLocaleString()}
              </span>
            )}
            {!syncing && !settings.lastEnrollProSync && (
              <span className="block text-xs text-amber-600 mt-1">
                Not synced yet — auto-sync runs shortly, or click the button.
              </span>
            )}
            {syncError && <span className="block text-xs text-destructive mt-1">{syncError}</span>}
            {syncSuccess && (
              <span className="flex items-center gap-1.5 text-xs text-primary font-medium mt-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> Synced successfully
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="schoolName" className="text-sm font-semibold text-foreground">School Name</Label>
              <Input id="schoolName" value={settings.schoolName} disabled className={readOnlyInput} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="schoolHeadName" className="text-sm font-semibold text-foreground">School Head / Principal</Label>
              <Input id="schoolHeadName" value={settings.schoolHeadName || ""} disabled className={readOnlyInput} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-semibold text-foreground">School Email</Label>
              <Input id="email" value={settings.email || ""} disabled className={readOnlyInput} />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-semibold text-foreground">School Logo</Label>
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full border border-border flex items-center justify-center bg-muted overflow-hidden shrink-0">
                  {settings.logoUrl ? (
                    <img
                      src={settings.logoUrl.startsWith("http") ? settings.logoUrl : `${SERVER_URL}${settings.logoUrl}`}
                      alt="School Logo"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Image className="w-5 h-5 text-muted-foreground" />
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  Managed in EnrollPro — shown on login, reports, and printed forms.
                </span>
              </div>
            </div>
          </div>

          <Separator className="my-6" />

          <div className="flex items-center gap-2 mb-3">
            <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
              <Image className="w-4 h-4" />
            </div>
            <span className="text-sm font-semibold text-foreground">Color Scheme</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { label: "Primary", value: settings.primaryColor },
              { label: "Secondary", value: settings.secondaryColor },
              { label: "Accent", value: settings.accentColor },
            ].map((color) => (
              <div key={color.label} className="flex items-center gap-3 p-3 rounded-xl bg-muted border border-border">
                <div className="w-8 h-8 rounded-lg border border-border shrink-0" style={{ backgroundColor: color.value }} />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted-foreground">{color.label}</p>
                  <p className="text-xs font-mono text-foreground truncate">{color.value}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── Local school information (editable, SMART-only) ───────────────── */}
      <Card className="p-0 gap-0 border border-border shadow-sm rounded-xl bg-card overflow-hidden">
        <CardHeader className="px-6 py-4 border-b border-border bg-secondary/10">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-xl bg-secondary/15 text-secondary">
              <School className="w-6 h-6" />
            </div>
            <div>
              <CardTitle className="text-lg text-foreground">Local School Information</CardTitle>
              <CardDescription className="normal-case">
                DepEd identifiers stored in SMART only
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <div className="mb-4 p-3 bg-muted border-2 border-border rounded-xl flex items-center gap-2 text-sm text-foreground">
            <MapPin className="w-4 h-4 flex-shrink-0 text-secondary" />
            These fields are not provided by EnrollPro, so they are saved in SMART and are never
            overwritten by a sync.
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="schoolId" className="text-sm font-semibold text-foreground">School ID</Label>
              <Input
                id="schoolId"
                value={settings.schoolId || ""}
                onChange={(e) => onChange("schoolId", e.target.value)}
                placeholder="e.g. 123456"
                className={editableInput}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="division" className="text-sm font-semibold text-foreground">Division</Label>
              <Input
                id="division"
                value={settings.division || ""}
                onChange={(e) => onChange("division", e.target.value)}
                placeholder="e.g. Division of Sample City"
                className={editableInput}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="region" className="text-sm font-semibold text-foreground">Region</Label>
              <Input
                id="region"
                value={settings.region || ""}
                onChange={(e) => onChange("region", e.target.value)}
                placeholder="e.g. Region IV-A CALABARZON"
                className={editableInput}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contactNumber" className="text-sm font-semibold text-foreground">Contact Number</Label>
              <Input
                id="contactNumber"
                value={settings.contactNumber || ""}
                onChange={(e) => onChange("contactNumber", e.target.value)}
                placeholder="Enter contact number"
                className={editableInput}
              />
            </div>
            <div className="md:col-span-2 space-y-2">
              <Label htmlFor="address" className="text-sm font-semibold text-foreground">Address</Label>
              <Input
                id="address"
                value={settings.address || ""}
                onChange={(e) => onChange("address", e.target.value)}
                placeholder="Enter school address"
                className={editableInput}
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
