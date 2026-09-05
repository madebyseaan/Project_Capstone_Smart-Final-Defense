import { useState, useEffect, useRef } from "react";
import {
  Settings,
  Save,
  School,
  Calendar,
  Shield,
  CheckCircle2,
  RefreshCw,
  Palette,
  Loader2,
  AlertTriangle,
  Image,
  Info,
  Link2,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { adminApi, SERVER_URL, getPortalToken } from "@/lib/api";
import type { SystemSettings as SystemSettingsType } from "@/lib/api";
import GradeLocksPanel from "./components/GradeLocksPanel";
import RolloverStatusCard from "./components/RolloverStatusCard";
import { useTheme } from "@/contexts/ThemeContext";
import { PageHeader } from "@/components/layout/PageHeader";


const settingsSections = [
  {
    id: "school",
    title: "School Information",
    description: "Basic school details and DepEd identification",
    icon: School,
    opacity: 0.12,
  },
  {
    id: "branding",
    title: "Branding & Theme",
    description: "Logo and colors synced from EnrollPro",
    icon: Palette,
    opacity: 0.16,
  },
  {
    id: "academic",
    title: "Academic Settings",
    description: "School year and grading configuration",
    icon: Calendar,
    opacity: 0.20,
  },
  {
    id: "system",
    title: "Contact Information",
    description: "School contact details",
    icon: Settings,
    opacity: 0.24,
  },
  {
    id: "security",
    title: "Security & Backup",
    description: "Security policies and data backup",
    icon: Shield,
    opacity: 0.28,
  },
];

// Philippine DepEd Divisions
const DEPED_DIVISIONS = [
  // NCR
  "Division of Manila",
  "Division of Quezon City",
  "Division of Las Piñas",
  "Division of Makati",
  "Division of Pasay",
  "Division of Taguig",
  "Division of Valenzuela",
  "Division of Caloocan",
  // Region I - Ilocos
  "Division of Ilocos Norte",
  "Division of Ilocos Sur",
  "Division of La Union",
  "Division of Pangasinan",
  "Division of Dagupan",
  // Region II - Cagayan Valley
  "Division of Cagayan",
  "Division of Isabela",
  "Division of Nueva Vizcaya",
  "Division of Quirino",
  // Region III - Central Luzon
  "Division of Batangas",
  "Division of Bulacan",
  "Division of Cabanatuan",
  "Division of Cavite",
  "Division of Nueva Ecija",
  "Division of Pampanga",
  "Division of Tarlac",
  // Region IV-A - CALABARZON
  "Division of Laguna",
  "Division of Quezon",
  "Division of Rizal",
  // Region IV-B - MIMAROPA
  "Division of Marinduque",
  "Division of Occidental Mindoro",
  "Division of Oriental Mindoro",
  "Division of Palawan",
  "Division of Puerto Princesa",
  "Division of Romblon",
  // Region V - Bicol
  "Division of Albay",
  "Division of Camarines Norte",
  "Division of Camarines Sur",
  "Division of Catanduanes",
  "Division of Masbate",
  "Division of Sorsogon",
  // Region VI - Western Visayas
  "Division of Aklan",
  "Division of Antique",
  "Division of Capiz",
  "Division of Guimaras",
  "Division of Iloilo",
  "Division of Iloilo City",
  "Division of Negros Occidental",
  "Division of Silay",
  // Region VII - Central Visayas
  "Division of Bohol",
  "Division of Cebu",
  "Division of Cebu City",
  "Division of Mandaue",
  "Division of Lapu-Lapu",
  "Division of Siquijor",
  // Region VIII - Eastern Visayas
  "Division of Biliran",
  "Division of Eastern Samar",
  "Division of Guiuan",
  "Division of Leyte",
  "Division of Northern Samar",
  "Division of Samar",
  "Division of Southern Leyte",
  // Region IX - Zamboanga
  "Division of Pagadian",
  "Division of Zamboanga City",
  "Division of Zamboanga del Norte",
  "Division of Zamboanga del Sur",
  // Region X - Northern Mindanao
  "Division of Butuan",
  "Division of Cagayan de Oro",
  "Division of Compostela Valley",
  "Division of Dinagat Islands",
  "Division of Misamis Occidental",
  "Division of Misamis Oriental",
  // Region XI - Davao
  "Division of Davao City",
  "Division of Davao del Norte",
  "Division of Davao del Sur",
  "Division of Davao Oriental",
  "Division of Generoso Santos",
  // Region XII - SOCCSKSARGEN
  "Division of Cotabato",
  "Division of General Santos",
  "Division of Maguindanao",
  "Division of Sarangani",
  "Division of South Cotabato",
  "Division of Sultan Kudarat",
  // Region XIII - CARAGA
  "Division of Agusan del Norte",
  "Division of Agusan del Sur",
  "Division of Surigao del Norte",
  "Division of Surigao del Sur",
  // ARMM
  "Division of Autonomous Region in Muslim Mindanao",
  // BARMM
  "Division of Basilan",
  "Division of Cotabato City",
  "Division of Jolo",
  "Division of Lanao del Norte",
  "Division of Lanao del Sur",
  "Division of Maguindanao del Norte",
  "Division of Maguindanao del Sur",
  "Division of Marawi",
  "Division of Tawi-Tawi",
].sort();

export default function SystemSettings() {
  const [settings, setSettings] = useState<SystemSettingsType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [schoolYears, setSchoolYears] = useState<Array<{ id: string; label: string; status: string }>>([]);
  const [gradeLockModalOpen, setGradeLockModalOpen] = useState(false);
  const [transitionLockLoading, setTransitionLockLoading] = useState(false);
  const { refreshTheme, colors: themeColors } = useTheme();
  const hasAutoSyncedRef = useRef(false);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      const response = await adminApi.getSettings();
      setSettings(response.data.settings);
      setError(null);
    } catch (err) {
      console.error("Failed to fetch settings:", err);
      setError("Failed to load system settings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  useEffect(() => {
    adminApi.getSchoolYears().then((res) => {
      setSchoolYears(res.data.schoolYears);
    }).catch(() => {});
  }, []);

  // SSE subscription for realtime settings updates
  useEffect(() => {
    const token = getPortalToken();
    if (!token) return;

    let es: EventSource | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let backoffMs = 2000;
    let cancelled = false;

    function connect() {
      if (cancelled) return;
      const url = `/api/admin/settings/stream?token=${encodeURIComponent(token)}`;
      es = new EventSource(url);

      es.onmessage = (event) => {
        const updatedSettings = JSON.parse(event.data);
        setSettings(updatedSettings);
        refreshTheme();
      };

      es.onopen = () => {
        backoffMs = 2000;
      };

      es.onerror = () => {
        es?.close();
        if (!cancelled) {
          reconnectTimeout = setTimeout(() => {
            backoffMs = Math.min(backoffMs * 2, 30000);
            connect();
          }, backoffMs);
        }
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      es?.close();
    };
  }, [refreshTheme]);

  // Auto-sync branding from EnrollPro on page load if stale (> 1 hour) or never synced
  useEffect(() => {
    if (!settings || hasAutoSyncedRef.current) return;
    const ONE_HOUR = 60 * 60 * 1000;
    const lastSync = settings.lastEnrollProSync
      ? new Date(settings.lastEnrollProSync).getTime()
      : 0;
    if (Date.now() - lastSync > ONE_HOUR) {
      hasAutoSyncedRef.current = true;
      setSyncing(true);
      setSyncError(null);
      adminApi
        .syncFromEnrollPro()
        .then((response) => {
          setSettings(response.data.settings);
          refreshTheme();
          setSyncSuccess(true);
          setTimeout(() => setSyncSuccess(false), 5000);
        })
        .catch((err) => {
          console.warn("[Auto-sync] EnrollPro branding sync failed:", err);
        })
        .finally(() => setSyncing(false));
    }
  }, [settings?.lastEnrollProSync]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = (field: keyof SystemSettingsType, value: string | boolean) => {
    if (!settings) return;
    setSettings((prev) => prev ? { ...prev, [field]: value } : prev);
    setHasChanges(true);
    setSaveSuccess(false);
  };

  const handleSave = async () => {
    if (!settings) return;
    try {
      setSaving(true);
      await adminApi.updateSettings(settings);
      setHasChanges(false);
      setSaveSuccess(true);
      // Refresh theme so title and other components update immediately
      await refreshTheme();
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error("Failed to save settings:", err);
      alert("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const handleCancelLogo = () => {
    // kept for compatibility — no longer used
  };

  const handleSyncFromEnrollPro = async () => {
    try {
      setSyncing(true);
      setSyncError(null);
      setSyncSuccess(false);
      const response = await adminApi.syncFromEnrollPro();
      setSettings(response.data.settings);
      await refreshTheme();
      setSyncSuccess(true);
      setTimeout(() => setSyncSuccess(false), 5000);
    } catch (err) {
      console.error("Failed to sync from EnrollPro:", err);
      setSyncError("Failed to sync from EnrollPro. Please check the connection and try again.");
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: themeColors.primary }} />
          <p className="text-muted-foreground">Loading system settings...</p>
        </div>
      </div>
    );
  }

  if (error || !settings) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="flex flex-col items-center gap-3 text-center">
          <AlertTriangle className="w-12 h-12 text-amber-500" />
          <p className="text-foreground font-medium">{error || "No settings found"}</p>
          <Button onClick={fetchSettings} variant="outline" className="gap-2">
            <RefreshCw className="w-4 h-4" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="System Settings"
        description="Configure system-wide settings and preferences"
        actions={
          <Button
            className="gap-2 text-white font-semibold rounded-xl shadow-lg w-fit"
            style={{ backgroundColor: themeColors.primary }}
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Settings
          </Button>
        }
      />

      {/* Status Alert */}
      {saveSuccess && (
        <div className="flex items-center gap-3 p-4 rounded-xl border" style={{ backgroundColor: `${themeColors.primary}15`, borderColor: `${themeColors.primary}40` }}>
          <CheckCircle2 className="w-5 h-5" style={{ color: themeColors.primary }} />
          <p className="text-sm font-medium" style={{ color: themeColors.primary }}>System settings saved successfully!</p>
        </div>
      )}

      {/* Quick Navigation */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {settingsSections.map((section) => (
          <a
            key={section.id}
            href={`#${section.id}`}
            className="p-4 rounded-xl border border-gray-100 transition-all group cursor-pointer"
            style={{ ['--section-color' as any]: themeColors.primary }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = `${themeColors.primary}40`; e.currentTarget.style.backgroundColor = `${themeColors.primary}08`; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = ''; e.currentTarget.style.backgroundColor = ''; }}
          >
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl transition-colors" style={{ backgroundColor: `${themeColors.primary}${Math.round(section.opacity * 255).toString(16).padStart(2, '0')}`, color: themeColors.primary }}>
                <section.icon className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-semibold text-sm text-foreground">{section.title}</h4>
                <p className="text-xs text-muted-foreground">{section.description}</p>
              </div>
            </div>
          </a>
        ))}
      </div>

      {/* School Information */}
      <Card id="school" className="p-0 gap-0 border-0 shadow-xl shadow-gray-200/50 rounded-2xl bg-white overflow-hidden">
        <CardHeader className="px-6 py-4 border-b border-gray-100" style={{ backgroundColor: `${themeColors.primary}10` }}>
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-xl" style={{ backgroundColor: `${themeColors.primary}20`, color: themeColors.primary }}>
              <School className="w-6 h-6" />
            </div>
            <div>
              <CardTitle className="text-lg text-foreground">School Information</CardTitle>
              <CardDescription>Basic school details for DepEd records</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-xl flex items-center gap-2 text-sm text-blue-700">
            <Info className="w-4 h-4 flex-shrink-0" />
            School information is synced from EnrollPro and cannot be edited manually.
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="schoolName" className="text-sm font-semibold text-foreground">
                School Name
              </Label>
              <Input
                id="schoolName"
                value={settings.schoolName}
                disabled
                className="rounded-xl border-gray-200 bg-gray-50 text-muted-foreground cursor-not-allowed"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="schoolId" className="text-sm font-semibold text-foreground">
                School ID
              </Label>
              <Input
                id="schoolId"
                value={settings.schoolId}
                disabled
                className="rounded-xl border-gray-200 bg-gray-50 text-muted-foreground cursor-not-allowed"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="division" className="text-sm font-semibold text-foreground">
                Division
              </Label>
              <Input
                id="division"
                value={settings.division}
                disabled
                className="rounded-xl border-gray-200 bg-gray-50 text-muted-foreground cursor-not-allowed"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="region" className="text-sm font-semibold text-foreground">
                Region
              </Label>
              <Input
                id="region"
                value={settings.region}
                disabled
                className="rounded-xl border-gray-200 bg-gray-50 text-muted-foreground cursor-not-allowed"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="schoolHeadName" className="text-sm font-semibold text-foreground">
                School Head / Principal Name
              </Label>
              <Input
                id="schoolHeadName"
                value={settings.schoolHeadName || ""}
                onChange={(e) => handleChange("schoolHeadName", e.target.value)}
                placeholder="e.g. Juan Dela Cruz"
                className="rounded-xl border-gray-200"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Branding & Theme */}
      <Card id="branding" className="p-0 gap-0 border-0 shadow-xl shadow-gray-200/50 rounded-2xl bg-white overflow-hidden">
        <CardHeader className="px-6 py-4 border-b border-gray-100" style={{ backgroundColor: `${themeColors.primary}10` }}>
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-xl" style={{ backgroundColor: `${themeColors.primary}20`, color: themeColors.primary }}>
              <Palette className="w-6 h-6" />
            </div>
            <div>
              <CardTitle className="text-lg text-foreground">Branding & Theme</CardTitle>
              <CardDescription>Logo and colors synchronized from EnrollPro</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          {/* EnrollPro Sync Status */}
          <div className="mb-8 p-4 rounded-xl border border-blue-100 bg-blue-50/50">
            <div className="flex items-start gap-4">
              <div className="p-2 rounded-lg bg-blue-100 shrink-0">
                <Link2 className="w-5 h-5 text-blue-600" />
              </div>
              <div className="flex-1">
                <h4 className="font-semibold text-blue-900">Connected to EnrollPro</h4>
                <p className="text-sm text-blue-700 mt-1">
                  School branding, logo, and color scheme are automatically synchronized from EnrollPro every hour. You can also sync manually anytime.
                </p>
                {syncing && (
                  <p className="text-xs text-blue-600 mt-1.5 flex items-center gap-1.5">
                    <Loader2 className="w-3 h-3 animate-spin inline" />
                    Syncing from EnrollPro...
                  </p>
                )}
                {!syncing && settings.lastEnrollProSync && (
                  <p className="text-xs text-blue-600 mt-1.5">
                    Last synced: {new Date(settings.lastEnrollProSync).toLocaleString()}
                  </p>
                )}
                {!syncing && !settings.lastEnrollProSync && (
                  <p className="text-xs text-amber-600 mt-1.5">
                    Not synced yet � auto-sync will run shortly, or click the button.
                  </p>
                )}
                {syncError && (
                  <p className="text-xs text-red-600 mt-1.5">{syncError}</p>
                )}
                {syncSuccess && (
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                    <p className="text-xs text-green-700 font-medium">Branding synced successfully!</p>
                  </div>
                )}
              </div>
              <Button
                variant="outline"
                className="gap-2 rounded-xl shrink-0"
                style={{ borderColor: `${themeColors.primary}50`, color: themeColors.primary }}
                onClick={handleSyncFromEnrollPro}
                disabled={syncing}
              >
                {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                {syncing ? "Syncing..." : "Sync from EnrollPro"}
              </Button>
            </div>
          </div>

          {/* Grade Lock Control */}
          <div className="mb-8 p-4 rounded-xl border border-gray-200 bg-gray-50">
            <Label className="text-sm font-semibold text-foreground mb-2 block">Grade Editing</Label>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">
                  {settings.gradeLock ? "Grade editing is currently LOCKED. Teachers cannot edit grades." : "Grade editing is open. Teachers can edit grades."}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Lock grades during EOSY processing or after term ends.
                </p>
              </div>
              <Button
                variant={settings.gradeLock ? "destructive" : "default"}
                size="sm"
                disabled={saving}
                onClick={() => setGradeLockModalOpen(true)}
              >
                {settings.gradeLock ? "Unlock Grades" : "Lock Grades"}
              </Button>
            </div>
          </div>

          <GradeLocksPanel />

          {/* Transition Lock Control */}
          <div className="mb-8 p-4 rounded-xl border border-gray-200 bg-gray-50">
            <Label className="text-sm font-semibold text-foreground mb-2 block">Teacher Login Lock (Transition)</Label>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">
                  {settings.transitionLock ? "Teachers are BLOCKED from logging in. Admin/Registrar unaffected." : "Teachers can log in normally."}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Enable during year transition to prevent teachers from accessing the system while data migrates.
                </p>
              </div>
              <Button
                variant={settings.transitionLock ? "destructive" : "default"}
                size="sm"
                disabled={transitionLockLoading}
                onClick={async () => {
                  setTransitionLockLoading(true);
                  try {
                    const res = await adminApi.toggleTransitionLock(!settings.transitionLock);
                    setSettings({ ...settings!, transitionLock: res.data.transitionLock });
                  } finally {
                    setTransitionLockLoading(false);
                  }
                }}
              >
                {settings.transitionLock ? "Unlock Teachers" : "Lock Teachers"}
              </Button>
            </div>
          </div>

          <RolloverStatusCard />

          {/* School Logo (read-only) */}
          <div className="mb-8">
            <Label className="text-sm font-semibold text-foreground mb-4 block">School Logo</Label>
            <div className="flex items-start gap-6">
              <div className="w-32 h-32 rounded-full border-2 border-dashed border-gray-200 flex items-center justify-center bg-gray-50 overflow-hidden">
                {settings.logoUrl ? (
                  <img
                    src={settings.logoUrl.startsWith("http") ? settings.logoUrl : `${SERVER_URL}${settings.logoUrl}`}
                    alt="School Logo"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Image className="w-12 h-12 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 space-y-2">
                <p className="text-sm text-muted-foreground">
                  Your school logo is pulled from EnrollPro. To change the logo, upload it in EnrollPro first, then click <strong>Sync from EnrollPro</strong> above.
                </p>
                <p className="text-xs text-muted-foreground">
                  The logo is displayed as a circle on login pages, reports, and printed forms.
                </p>
              </div>
            </div>
          </div>

          <Separator className="my-6" />

          {/* Color Scheme (read-only) */}
          <div>
            <Label className="text-sm font-semibold text-foreground mb-2 block">Color Scheme</Label>
            <p className="text-sm text-muted-foreground mb-4">
              Colors are automatically extracted from your school logo in EnrollPro and applied system-wide.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label className="text-sm font-medium text-muted-foreground">Primary</Label>
                <div className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 border border-gray-100">
                  <div className="w-10 h-10 rounded-lg border border-gray-200 shrink-0" style={{ backgroundColor: settings.primaryColor }} />
                  <span className="text-sm font-mono text-foreground">{settings.primaryColor}</span>
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium text-muted-foreground">Secondary</Label>
                <div className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 border border-gray-100">
                  <div className="w-10 h-10 rounded-lg border border-gray-200 shrink-0" style={{ backgroundColor: settings.secondaryColor }} />
                  <span className="text-sm font-mono text-foreground">{settings.secondaryColor}</span>
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium text-muted-foreground">Accent</Label>
                <div className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 border border-gray-100">
                  <div className="w-10 h-10 rounded-lg border border-gray-200 shrink-0" style={{ backgroundColor: settings.accentColor }} />
                  <span className="text-sm font-mono text-foreground">{settings.accentColor}</span>
                </div>
              </div>
            </div>

            {/* Color Preview */}
            <div className="mt-6 p-4 rounded-xl bg-gray-50">
              <Label className="text-sm font-medium text-muted-foreground mb-3 block">Preview</Label>
              <div className="flex items-center gap-4">
                <div className="flex-1 h-12 rounded-xl flex items-center justify-center text-white font-semibold text-sm" style={{ backgroundColor: settings.primaryColor }}>
                  Primary
                </div>
                <div className="flex-1 h-12 rounded-xl flex items-center justify-center text-white font-semibold text-sm" style={{ backgroundColor: settings.secondaryColor }}>
                  Secondary
                </div>
                <div className="flex-1 h-12 rounded-xl flex items-center justify-center text-white font-semibold text-sm" style={{ backgroundColor: settings.accentColor }}>
                  Accent
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Academic Settings */}
      <Card id="academic" className="p-0 gap-0 border-0 shadow-xl shadow-gray-200/50 rounded-2xl bg-white overflow-hidden">
        <CardHeader className="px-6 py-4 border-b border-gray-100" style={{ backgroundColor: `${themeColors.primary}10` }}>
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-xl" style={{ backgroundColor: `${themeColors.primary}20`, color: themeColors.primary }}>
              <Calendar className="w-6 h-6" />
            </div>
            <div>
              <CardTitle className="text-lg text-foreground">Academic Settings</CardTitle>
              <CardDescription>School year, term configuration, and academic calendar</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          {/* Basic Academic Settings */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <div className="space-y-2">
              <Label htmlFor="currentSchoolYear" className="text-sm font-semibold text-foreground">
                Academic Year
              </Label>
              <Select value={settings.currentSchoolYear} disabled>
                <SelectTrigger className="bg-gray-100 cursor-not-allowed">
                  <SelectValue placeholder="Select school year" />
                </SelectTrigger>
                <SelectContent>
                  {schoolYears.map((sy) => (
                    <SelectItem key={sy.id} value={sy.label}>{sy.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Synced from EnrollPro — cannot be changed manually</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="currentTerm" className="text-sm font-semibold text-foreground">
                Current Term
              </Label>
              <Select value={settings.currentTerm || "T1"} disabled>
                <SelectTrigger className="bg-gray-100 cursor-not-allowed">
                  <SelectValue placeholder="Term 1" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="T1">Term 1</SelectItem>
                  <SelectItem value="T2">Term 2</SelectItem>
                  <SelectItem value="T3">Term 3</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Synced from EnrollPro — cannot be changed manually</p>
            </div>
          </div>

          <Separator className="my-6" />

          {/* Academic Calendar */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <Label className="text-sm font-semibold text-foreground">Academic Calendar</Label>
                <p className="text-xs text-muted-foreground mt-1">Term dates are synced from EnrollPro and cannot be edited manually</p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="autoAdvanceTerm"
                  checked={settings.autoAdvanceTerm || false}
                  onChange={(e) => handleChange("autoAdvanceTerm", e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300"
                  style={{ accentColor: themeColors.primary }}
                />
                <Label htmlFor="autoAdvanceTerm" className="text-sm text-muted-foreground cursor-pointer">
                  Auto-advance term when end date is reached
                </Label>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* 1st Term */}
              <div className="p-4 rounded-xl border border-gray-100 bg-gray-50/50">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ backgroundColor: themeColors.primary }}>1</div>
                  <span className="font-semibold text-foreground">1st Term</span>
                  {settings.currentTerm === "T1" && (
                    <span className="ml-auto px-2 py-0.5 text-xs font-medium rounded-full text-white" style={{ backgroundColor: themeColors.primary }}>Current</span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Start Date</Label>
                    <Input
                      type="date"
                      value={settings.t1StartDate ? new Date(settings.t1StartDate).toISOString().split('T')[0] : ""}
                      onChange={(e) => setSettings({ ...settings, t1StartDate: e.target.value || null })}
                      className="rounded-lg border-gray-200 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">End Date</Label>
                    <Input
                      type="date"
                      value={settings.t1EndDate ? new Date(settings.t1EndDate).toISOString().split('T')[0] : ""}
                      onChange={(e) => setSettings({ ...settings, t1EndDate: e.target.value || null })}
                      className="rounded-lg border-gray-200 text-sm"
                    />
                  </div>
                </div>
              </div>

              {/* 2nd Term */}
              <div className="p-4 rounded-xl border border-gray-100 bg-gray-50/50">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ backgroundColor: themeColors.secondary }}>2</div>
                  <span className="font-semibold text-foreground">2nd Term</span>
                  {settings.currentTerm === "T2" && (
                    <span className="ml-auto px-2 py-0.5 text-xs font-medium rounded-full text-white" style={{ backgroundColor: themeColors.primary }}>Current</span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Start Date</Label>
                    <Input
                      type="date"
                      value={settings.t2StartDate ? new Date(settings.t2StartDate).toISOString().split('T')[0] : ""}
                      onChange={(e) => setSettings({ ...settings, t2StartDate: e.target.value || null })}
                      className="rounded-lg border-gray-200 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">End Date</Label>
                    <Input
                      type="date"
                      value={settings.t2EndDate ? new Date(settings.t2EndDate).toISOString().split('T')[0] : ""}
                      onChange={(e) => setSettings({ ...settings, t2EndDate: e.target.value || null })}
                      className="rounded-lg border-gray-200 text-sm"
                    />
                  </div>
                </div>
              </div>

              {/* 3rd Term */}
              <div className="p-4 rounded-xl border border-gray-100 bg-gray-50/50">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ backgroundColor: themeColors.accent }}>3</div>
                  <span className="font-semibold text-foreground">3rd Term</span>
                  {settings.currentTerm === "T3" && (
                    <span className="ml-auto px-2 py-0.5 text-xs font-medium rounded-full text-white" style={{ backgroundColor: themeColors.primary }}>Current</span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Start Date</Label>
                    <Input
                      type="date"
                      value={settings.t3StartDate ? new Date(settings.t3StartDate).toISOString().split('T')[0] : ""}
                      onChange={(e) => setSettings({ ...settings, t3StartDate: e.target.value || null })}
                      className="rounded-lg border-gray-200 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">End Date</Label>
                    <Input
                      type="date"
                      value={settings.t3EndDate ? new Date(settings.t3EndDate).toISOString().split('T')[0] : ""}
                      onChange={(e) => setSettings({ ...settings, t3EndDate: e.target.value || null })}
                      className="rounded-lg border-gray-200 text-sm"
                    />
                  </div>
                </div>
              </div>

            </div>

            {/* Info Box */}
            <div className="mt-4 p-3 rounded-xl bg-blue-50 border border-blue-100">
              <div className="flex items-start gap-2">
                <Info className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-blue-700">
                  When "Auto-advance term" is enabled, the system will automatically switch to the next term when the current term's end date is reached. This ensures fresh grading data for each term.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* System Configuration */}
      <Card id="system" className="p-0 gap-0 border-0 shadow-xl shadow-gray-200/50 rounded-2xl bg-white overflow-hidden">
        <CardHeader className="px-6 py-4 border-b border-gray-100" style={{ backgroundColor: `${themeColors.secondary}10` }}>
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-xl" style={{ backgroundColor: `${themeColors.secondary}20`, color: themeColors.secondary }}>
              <Settings className="w-6 h-6" />
            </div>
            <div>
              <CardTitle className="text-lg text-foreground">Contact Information</CardTitle>
              <CardDescription>School contact details</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="md:col-span-2 space-y-2">
              <Label htmlFor="address" className="text-sm font-semibold text-foreground">
                Address
              </Label>
              <Input
                id="address"
                value={settings.address || ""}
                onChange={(e) => handleChange("address", e.target.value)}
                placeholder="Enter school address"
                className="rounded-xl border-gray-200"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contactNumber" className="text-sm font-semibold text-foreground">
                Contact Number
              </Label>
              <Input
                id="contactNumber"
                value={settings.contactNumber || ""}
                onChange={(e) => handleChange("contactNumber", e.target.value)}
                placeholder="Enter contact number"
                className="rounded-xl border-gray-200"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-semibold text-foreground">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                value={settings.email || ""}
                onChange={(e) => handleChange("email", e.target.value)}
                placeholder="Enter school email"
                className="rounded-xl border-gray-200"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Security & Backup */}
      <Card id="security" className="p-0 gap-0 border-0 shadow-xl shadow-gray-200/50 rounded-2xl bg-white overflow-hidden">
        <CardHeader className="px-6 py-4 border-b border-gray-100" style={{ backgroundColor: `${themeColors.primary}10` }}>
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-xl" style={{ backgroundColor: `${themeColors.primary}20`, color: themeColors.primary }}>
              <Shield className="w-6 h-6" />
            </div>
            <div>
              <CardTitle className="text-lg text-foreground">Security & Backup</CardTitle>
              <CardDescription>Security policies and data protection</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-2">
              <Label htmlFor="sessionTimeout" className="text-sm font-semibold text-foreground">
                Session Timeout (minutes)
              </Label>
              <Select value={String(settings.sessionTimeout || 30)} onValueChange={(val) => val && handleChange("sessionTimeout", parseInt(val) as any)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="15">15 minutes</SelectItem>
                  <SelectItem value="30">30 minutes</SelectItem>
                  <SelectItem value="60">60 minutes</SelectItem>
                  <SelectItem value="120">120 minutes</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="maxLoginAttempts" className="text-sm font-semibold text-foreground">
                Max Login Attempts
              </Label>
              <Select value={String(settings.maxLoginAttempts || 5)} onValueChange={(val) => val && handleChange("maxLoginAttempts", parseInt(val) as any)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="3">3 attempts</SelectItem>
                  <SelectItem value="5">5 attempts</SelectItem>
                  <SelectItem value="10">10 attempts</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="passwordMinLength" className="text-sm font-semibold text-foreground">
                Min Password Length
              </Label>
              <Select value={String(settings.passwordMinLength || 8)} onValueChange={(val) => val && handleChange("passwordMinLength", parseInt(val) as any)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="6">6 characters</SelectItem>
                  <SelectItem value="8">8 characters</SelectItem>
                  <SelectItem value="10">10 characters</SelectItem>
                  <SelectItem value="12">12 characters</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Separator className="my-6" />

          <div className="space-y-4">
            <p className="text-sm font-semibold text-foreground">Data Retention</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Audit Logs (days)</Label>
                <Input
                  type="number"
                  min={0}
                  max={3650}
                  value={settings.auditLogRetentionDays ?? 365}
                  onChange={(e) => handleChange("auditLogRetentionDays", parseInt(e.target.value) || 0)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Sync History (days)</Label>
                <Input
                  type="number"
                  min={0}
                  max={3650}
                  value={settings.syncHistoryRetentionDays ?? 90}
                  onChange={(e) => handleChange("syncHistoryRetentionDays", parseInt(e.target.value) || 0)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Grade Snapshots (days, 0=off)</Label>
                <Input
                  type="number"
                  min={0}
                  max={3650}
                  value={settings.gradeSnapshotRetentionDays ?? 0}
                  onChange={(e) => handleChange("gradeSnapshotRetentionDays", parseInt(e.target.value) || 0)}
                />
              </div>
            </div>
          </div>

          <Separator className="my-6" />

          <div className="flex items-center justify-between p-4 rounded-xl bg-gray-50">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg" style={{ backgroundColor: `${themeColors.primary}20` }}>
                <Shield className="w-5 h-5" style={{ color: themeColors.primary }} />
              </div>
              <div>
                <p className="font-semibold text-sm text-foreground">Database Status</p>
                <p className="text-xs text-muted-foreground">Connected and operational</p>
              </div>
            </div>
            <Button variant="outline" size="sm" className="rounded-xl gap-2">
              <RefreshCw className="w-4 h-4" />
              Test Connection
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Grade Lock Confirmation Modal */}
      <Dialog open={gradeLockModalOpen} onOpenChange={setGradeLockModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {settings?.gradeLock ? "Unlock Grade Editing" : "Lock Grade Editing"}
            </DialogTitle>
            <DialogDescription>
              {settings?.gradeLock
                ? "Are you sure you want to unlock grade editing? Teachers will be able to edit grades again."
                : "Are you sure you want to lock grade editing? Teachers will no longer be able to edit grades."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setGradeLockModalOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              variant={settings?.gradeLock ? "default" : "destructive"}
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                try {
                  await adminApi.toggleGradeLock(!settings?.gradeLock);
                  setSettings({ ...settings!, gradeLock: !settings?.gradeLock });
                  setGradeLockModalOpen(false);
                } catch (err) {
                  console.error("Failed to toggle grade lock:", err);
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              {settings?.gradeLock ? "Unlock" : "Lock"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
