import { useState, useEffect, useRef } from "react";
import { Save, Loader2, RotateCcw, AlertTriangle, FlaskConical, Route } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { adminApi, getPortalToken } from "@/lib/api";
import type { SystemSettings as SystemSettingsType } from "@/lib/api";
import { useTheme } from "@/contexts/ThemeContext";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageError } from "@/components/layout/PageError";
import { toast } from "@/lib/toast";
import { SchoolInformationSection } from "./components/SchoolInformationSection";
import { GradeLockSection } from "./components/GradeLockSection";
import { AcademicSection } from "./components/AcademicSection";
import { SecuritySection } from "./components/SecuritySection";
import DeveloperToolsCard from "./components/DeveloperToolsCard";

export default function SystemSettings() {
  const [settings, setSettings] = useState<SystemSettingsType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [schoolYears, setSchoolYears] = useState<Array<{ id: string; label: string; status: string }>>([]);
  const [tab, setTab] = useState("school");
  const { refreshTheme } = useTheme();
  const hasAutoSyncedRef = useRef(false);
  const hasChangesRef = useRef(false);
  const syncNoticeShownRef = useRef(false);

  useEffect(() => {
    hasChangesRef.current = hasChanges;
  }, [hasChanges]);

  const fetchSettings = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const response = await adminApi.getSettings();
      setSettings(response.data.settings);
      setError(null);
    } catch (err) {
      console.error("Failed to fetch settings:", err);
      if (!silent) setError("Failed to load system settings");
    } finally {
      if (!silent) setLoading(false);
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

  // SSE subscription for realtime settings updates.
  // Never clobber unsaved local edits — notify instead.
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
        let updatedSettings: SystemSettingsType;
        try {
          updatedSettings = JSON.parse(event.data);
        } catch {
          return;
        }
        if (hasChangesRef.current) {
          if (!syncNoticeShownRef.current) {
            syncNoticeShownRef.current = true;
            toast.info("Settings changed in EnrollPro — save/discard to load the latest.");
          }
          return;
        }
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

  // Auto-sync branding from EnrollPro on page load if stale (> 1 hour) or never
  // synced — but never while there are unsaved local edits.
  useEffect(() => {
    if (!settings || hasAutoSyncedRef.current || hasChangesRef.current) return;
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
          if (hasChangesRef.current) return;
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

  const handleChange = (field: keyof SystemSettingsType, value: string | boolean | number) => {
    if (!settings) return;
    setSettings((prev) => (prev ? ({ ...prev, [field]: value } as SystemSettingsType) : prev));
    setHasChanges(true);
    syncNoticeShownRef.current = false;
  };

  const handleSave = async () => {
    if (!settings) return;
    try {
      setSaving(true);
      const response = await adminApi.updateSettings(settings);
      if (response.data?.settings) setSettings(response.data.settings);
      setHasChanges(false);
      await refreshTheme();
      toast.success("System settings saved");
    } catch (err) {
      console.error("Failed to save settings:", err);
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = async () => {
    await fetchSettings(true);
    setHasChanges(false);
    syncNoticeShownRef.current = false;
    toast.info("Changes discarded");
  };

  const handleSyncFromEnrollPro = async () => {
    try {
      setSyncing(true);
      setSyncError(null);
      setSyncSuccess(false);
      const response = await adminApi.syncFromEnrollPro();
      setSettings(response.data.settings);
      setHasChanges(false);
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
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Loading system settings...</p>
        </div>
      </div>
    );
  }

  if (error || !settings) {
    return (
      <div className="space-y-6 animate-fade-in max-w-[1400px] mx-auto w-full">
        <PageError
          title="Unable to Load System Settings"
          message={error || "No settings found"}
          onRetry={fetchSettings}
          retryLabel="Retry"
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-[1400px] mx-auto w-full">
      <PageHeader
        title="System Settings"
        description="School identity, academic calendar, access locks, and security"
        actions={
          <div className="flex items-center gap-2">
            {hasChanges && (
              <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-[11px] font-medium">
                Unsaved changes
              </Badge>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleDiscard}
              disabled={!hasChanges || saving}
              className="border-border/70 bg-background hover:bg-muted/70 text-foreground font-medium text-xs"
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
              Discard
            </Button>
            <Button
              size="sm"
              className="font-semibold text-xs shadow-sm shadow-primary/20"
              onClick={handleSave}
              disabled={!hasChanges || saving}
            >
              {saving ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Save className="w-4 h-4 mr-1.5" />}
              Save changes
            </Button>
          </div>
        }
      />

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList variant="line" className="w-full justify-start gap-1 border-b border-border pb-0 overflow-x-auto">
          <TabsTrigger value="school" className="px-4 text-xs font-semibold uppercase tracking-wider">School</TabsTrigger>
          <TabsTrigger value="academic" className="px-4 text-xs font-semibold uppercase tracking-wider">Academic</TabsTrigger>
          <TabsTrigger value="locks" className="px-4 text-xs font-semibold uppercase tracking-wider">Grade Locks</TabsTrigger>
          <TabsTrigger value="security" className="px-4 text-xs font-semibold uppercase tracking-wider">Security &amp; Retention</TabsTrigger>
          <TabsTrigger value="advanced" className="px-4 text-xs font-semibold uppercase tracking-wider">Advanced</TabsTrigger>
        </TabsList>

        <TabsContent value="school" className="space-y-6 mt-4">
          <SchoolInformationSection
            settings={settings}
            onChange={handleChange}
            syncing={syncing}
            syncError={syncError}
            syncSuccess={syncSuccess}
            onSync={handleSyncFromEnrollPro}
          />
        </TabsContent>

        <TabsContent value="academic" className="space-y-6 mt-4">
          <AcademicSection settings={settings} schoolYears={schoolYears} onChange={handleChange} />
        </TabsContent>

        <TabsContent value="locks" className="space-y-4 mt-4">
          <div className="flex items-start gap-2 rounded-xl border-2 border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>Lock controls take effect <strong>immediately</strong> and are not affected by the Save button.</span>
          </div>
          <GradeLockSection
            settings={settings}
            onSettingsChange={(patch) =>
              setSettings((prev) => (prev ? { ...prev, ...patch } : prev))
            }
          />
        </TabsContent>

        <TabsContent value="security" className="space-y-6 mt-4">
          <SecuritySection settings={settings} onChange={handleChange} />
        </TabsContent>

        <TabsContent value="advanced" className="space-y-4 mt-4">
          <div className="flex items-start gap-2 rounded-xl border-2 border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            <FlaskConical className="w-4 h-4 mt-0.5 shrink-0" />
            <span>Demo/testing tools. Use with caution — these modify grades for the active school year.</span>
          </div>
          <div className="flex items-start gap-2 rounded-xl border-2 border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            <Route className="w-4 h-4 mt-0.5 shrink-0" />
            <span>Server health, sync history, and diagnostics live on the <a href="/admin/system-health" className="font-medium text-primary underline-offset-2 hover:underline">System Health</a> page.</span>
          </div>
          <DeveloperToolsCard />
        </TabsContent>
      </Tabs>
    </div>
  );
}
