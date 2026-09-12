import { useState, useEffect } from "react";
import {
  Sliders,
  Save,
  RotateCcw,
  AlertCircle,
  CheckCircle2,
  Info,
  BookOpen,
  Music,
  Wrench,
  History,
  ChevronRight,
  Loader2,
  Calculator,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageError } from "@/components/layout/PageError";
import { adminApi } from "@/lib/api";
import type { GradingConfig as GradingConfigType, TermLabels } from "@/lib/api";
import { useTheme } from "@/contexts/ThemeContext";
import { toast } from "@/lib/toast";
import { SubjectWeightsPanel } from "./components/SubjectWeightsPanel";

const subjectTypeInfo: Record<string, { label: string; subjects: string[]; icon: React.ElementType; defaultWeights: string; groupWith?: string; followsNote?: string }> = {
  CORE: {
    label: "Core Academic Subjects",
    subjects: ["English", "Filipino", "Araling Panlipunan", "Edukasyon sa Pagpapakatao", "Mathematics", "Science", "GMRC", "Values Education"],
    icon: BookOpen,
    defaultWeights: "20% WW · 50% PT · 30% TA",
    followsNote: "STE (Science Technology Engineering) subjects also follow this group's weights.",
  },
  MATH_SCIENCE: {
    label: "Core Academic Subjects",
    subjects: ["Mathematics", "Science"],
    icon: Calculator,
    defaultWeights: "20% WW · 50% PT · 30% TA",
    groupWith: "CORE",
  },
  MAPEH: {
    label: "MAPEH & TLE (EPP)",
    subjects: ["Music", "Arts", "Physical Education", "Health", "TLE", "Home Economics", "Industrial Arts", "Computer Education"],
    icon: Music,
    defaultWeights: "20% WW · 60% PT · 20% TA",
    followsNote: "SPA (Special Program in the Arts) and SPS (Special Program in Sports) subjects also follow this group's weights.",
  },
  TLE: {
    label: "MAPEH & TLE (EPP)",
    subjects: ["TLE", "Home Economics", "Industrial Arts", "Computer Education"],
    icon: Wrench,
    defaultWeights: "20% WW · 60% PT · 20% TA",
    groupWith: "MAPEH",
  },
};

export default function GradingConfig() {
  const [configs, setConfigs] = useState<GradingConfigType[]>([]);
  const [originalConfigs, setOriginalConfigs] = useState<GradingConfigType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { colors } = useTheme();
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [configHistory, setConfigHistory] = useState<Array<{ date: string; user: string; change: string }>>([]);

  // Term display labels
  const [termLabels, setTermLabels] = useState<TermLabels>({ T1: "Term 1", T2: "Term 2", T3: "Term 3" });
  const [termLabelsDirty, setTermLabelsDirty] = useState(false);
  const [termLabelsSaving, setTermLabelsSaving] = useState(false);

  const fetchConfigs = async () => {
    try {
      setLoading(true);
      const response = await adminApi.getGradingConfig();
      setConfigs(response.data.configs);
      setOriginalConfigs(response.data.configs);
      if (response.data.termLabels) {
        setTermLabels(response.data.termLabels);
      }
      setError(null);
    } catch (err) {
      console.error("Failed to fetch grading config:", err);
      setError("Failed to load grading configuration");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfigs();
  }, []);

  useEffect(() => {
    if (originalConfigs.length === 0) return;

    const hasAnyChange = configs.some((config) => {
      const original = originalConfigs.find(c => c.subjectType === config.subjectType);
      if (!original) return true;
      return (
        config.writtenWorkWeight !== original.writtenWorkWeight ||
        config.performanceTaskWeight !== original.performanceTaskWeight ||
        config.quarterlyAssessWeight !== original.quarterlyAssessWeight
      );
    });
    setHasChanges(hasAnyChange);
  }, [configs, originalConfigs]);

  const handleWeightChange = (
    subjectType: string,
    field: "writtenWorkWeight" | "performanceTaskWeight" | "quarterlyAssessWeight",
    value: string
  ) => {
    const numValue = parseInt(value) || 0;
    setConfigs((prev) =>
      prev.map((c) => {
        if (c.subjectType === subjectType) {
          return { ...c, [field]: numValue, isDepEdDefault: false };
        }
        return c;
      })
    );
    setSaveSuccess(false);
  };

  const validateWeights = (config: GradingConfigType): boolean => {
    return config.writtenWorkWeight + config.performanceTaskWeight + config.quarterlyAssessWeight === 100;
  };

  const handleSave = async () => {
    try {
      setSaving(true);

      for (const config of configs) {
        const original = originalConfigs.find(c => c.subjectType === config.subjectType);
        if (!original) continue;

        const hasChanged =
          config.writtenWorkWeight !== original.writtenWorkWeight ||
          config.performanceTaskWeight !== original.performanceTaskWeight ||
          config.quarterlyAssessWeight !== original.quarterlyAssessWeight;

        if (hasChanged) {
          await adminApi.updateGradingConfig(config.subjectType, {
            writtenWorkWeight: config.writtenWorkWeight,
            performanceTaskWeight: config.performanceTaskWeight,
            quarterlyAssessWeight: config.quarterlyAssessWeight,
          });
        }
      }

      const response = await adminApi.getGradingConfig();
      setConfigs(response.data.configs);
      setOriginalConfigs(response.data.configs);

      setHasChanges(false);
      setSaveSuccess(true);

      setConfigHistory(prev => [{
        date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        user: 'Admin',
        change: 'Updated grading weights'
      }, ...prev.slice(0, 4)]);

      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error("Failed to save grading config:", err);
      toast.error("Failed to save changes");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    try {
      setResetting(true);
      const response = await adminApi.resetGradingConfig();
      setConfigs(response.data.configs);
      setOriginalConfigs(response.data.configs);
      if (response.data.termLabels) {
        setTermLabels(response.data.termLabels);
      }
      setHasChanges(false);
      setSaveSuccess(true);

      setConfigHistory(prev => [{
        date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        user: 'Admin',
        change: 'Reset all weights to DepEd default values'
      }, ...prev.slice(0, 4)]);

      toast.success("Reset to DepEd defaults");
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error("Failed to reset grading config:", err);
      toast.error("Failed to reset to defaults");
    } finally {
      setResetting(false);
    }
  };

  const handleSaveTermLabels = async () => {
    try {
      setTermLabelsSaving(true);
      await adminApi.updateTermLabels({
        termLabelT1: termLabels.T1,
        termLabelT2: termLabels.T2,
        termLabelT3: termLabels.T3,
      });
      setTermLabelsDirty(false);
      setSaveSuccess(true);
      setConfigHistory(prev => [{
        date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        user: 'Admin',
        change: `Updated term labels: T1="${termLabels.T1}", T2="${termLabels.T2}", T3="${termLabels.T3}"`
      }, ...prev.slice(0, 4)]);
      toast.success("Term labels saved");
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e?.response?.data?.message || "Failed to save term labels");
    } finally {
      setTermLabelsSaving(false);
    }
  };

  const allValid = configs.every(validateWeights);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Loading grading configuration...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6 animate-fade-in max-w-[1400px] mx-auto w-full">
        <PageError
          title="Unable to Load Grading Configuration"
          message={error}
          onRetry={fetchConfigs}
          retryLabel="Retry"
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-[1400px] mx-auto w-full">
      <PageHeader
        title="Grading Configuration"
        description="Configure grading component weights for each subject type"
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              className="border-border/70 bg-background hover:bg-muted/70 text-foreground font-medium text-xs"
              onClick={handleReset}
              disabled={resetting}
            >
              {resetting ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <RotateCcw className="w-4 h-4 mr-1.5" />}
              Reset to Default
            </Button>
            <Button
              size="sm"
              className="font-semibold text-xs shadow-sm shadow-primary/20"
              onClick={handleSave}
              disabled={!allValid || saving}
            >
              {saving ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Save className="w-4 h-4 mr-1.5" />}
              Save Changes
            </Button>
          </>
        }
      />

      {saveSuccess && (
        <div className="flex items-center gap-3 p-4 rounded-xl border-2 bg-primary/5 border-primary/20 text-primary">
          <CheckCircle2 className="w-5 h-5" />
          <p className="text-sm font-medium">Grading configuration saved successfully!</p>
        </div>
      )}

      {hasChanges && !allValid && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-50 border-2 border-amber-200">
          <AlertCircle className="w-5 h-5 text-amber-600" />
          <p className="text-sm font-medium text-amber-700">All weights must add up to exactly 100% before saving.</p>
        </div>
      )}

      {/* DepEd Guidelines Info Banner */}
      <Card className="p-0 gap-0 border border-border shadow-sm overflow-hidden bg-primary/5 rounded-xl">
        <CardContent className="p-5">
          <div className="flex items-start gap-4">
            <div className="p-2.5 rounded-xl shrink-0 bg-primary/10">
              <Info className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-sm mb-1 text-foreground">DepEd Grading Guidelines (Revised 2026)</h3>
              <p className="text-xs text-muted-foreground mb-3">
                Per the Revised Guidelines on Classroom Assessment (April 2026), weights are now aligned across Core, Math, and Science subjects.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div className="bg-card rounded-lg px-3 py-2 border border-border">
                  <span className="text-xs text-muted-foreground font-medium block">Core, Math &amp; Science</span>
                  <span className="text-xs font-semibold text-foreground">WW 20% · PT 50% · TA 30%</span>
                </div>
                <div className="bg-card rounded-lg px-3 py-2 border border-border">
                  <span className="text-xs text-muted-foreground font-medium block">MAPEH &amp; TLE</span>
                  <span className="text-xs font-semibold text-foreground">WW 20% · PT 60% · TA 20%</span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Term Display Labels */}
      <Card className="p-0 gap-0 border border-border shadow-sm overflow-hidden bg-primary/5 rounded-xl">
        <CardContent className="p-5">
          <div className="flex items-start gap-4">
            <div className="p-2.5 rounded-xl shrink-0 bg-primary/10">
              <BookOpen className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-sm mb-1 text-foreground">Term Display Labels</h3>
              <p className="text-xs text-muted-foreground mb-4">
                Customize the labels shown for each grading term. These appear in teacher dashboards, class records, and school forms.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {(["T1", "T2", "T3"] as const).map((term) => (
                  <div key={term} className="space-y-1.5">
                    <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{term}</Label>
                    <Input
                      value={termLabels[term]}
                      onChange={(e) => {
                        setTermLabels(prev => ({ ...prev, [term]: e.target.value }));
                        setTermLabelsDirty(true);
                      }}
                      className="h-9 text-sm border-border rounded-lg"
                      placeholder={`e.g. Term ${term.slice(1)}`}
                    />
                  </div>
                ))}
              </div>
              {termLabelsDirty && (
                <div className="mt-3 flex items-center gap-2">
                  <Button
                    size="sm"
                    className="font-semibold text-xs"
                    onClick={handleSaveTermLabels}
                    disabled={termLabelsSaving}
                  >
                    {termLabelsSaving ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}
                    Save Labels
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-xs text-muted-foreground"
                    onClick={() => {
                      setTermLabels({ T1: "Term 1", T2: "Term 2", T3: "Term 3" });
                      setTermLabelsDirty(false);
                    }}
                  >
                    Reset
                  </Button>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Grading Weight Cards */}
      <div className="grid grid-cols-1 gap-6">
        {configs.map((config) => {
          const info = subjectTypeInfo[config.subjectType];
          if (info?.groupWith && configs.some(c => c.subjectType === info.groupWith)) {
            return null;
          }

          const isValid = validateWeights(config);
          const total = config.writtenWorkWeight + config.performanceTaskWeight + config.quarterlyAssessWeight;
          const displayInfo = info || {
            label: config.subjectType,
            subjects: [],
            icon: BookOpen,
            defaultWeights: "",
          };
          const Icon = displayInfo.icon;

          return (
            <Card key={config.id} className="p-0 gap-0 border border-border shadow-sm overflow-hidden bg-card rounded-xl">
              {/* Card Header */}
              <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-primary/5">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
                    <Icon className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm text-foreground">{displayInfo.label}</h3>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {displayInfo.subjects.map((subject) => (
                        <Badge key={subject} variant="outline" className="text-xs py-0 h-5">
                          {subject}
                        </Badge>
                      ))}
                    </div>
                    {displayInfo.followsNote && (
                      <p className="text-[11px] text-muted-foreground mt-1.5 italic">{displayInfo.followsNote}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-3">
                  {config.isDepEdDefault && (
                    <Badge variant="outline" className="text-xs font-medium bg-primary/10 text-primary border-primary/20">
                      <CheckCircle2 className="w-3 h-3 mr-1" />
                      DepEd Default
                    </Badge>
                  )}
                  {isValid && !config.isDepEdDefault && (
                    <Badge variant="outline" className="text-xs font-medium bg-amber-50 text-amber-700 border-amber-200">
                      Custom
                    </Badge>
                  )}
                  {!isValid && (
                    <Badge variant="outline" className="text-xs font-medium bg-destructive/10 text-destructive border-destructive/20">
                      <AlertCircle className="w-3 h-3 mr-1" />
                      {total}% / 100%
                    </Badge>
                  )}
                </div>
              </div>

              {/* Card Body */}
              <CardContent className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-6">
                  <div className="space-y-2">
                    <Label htmlFor={`${config.id}-ww`} className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Written Work (WW)
                    </Label>
                    <div className="relative">
                      <Input
                        id={`${config.id}-ww`}
                        type="number"
                        min="0"
                        max="100"
                        value={config.writtenWorkWeight}
                        onChange={(e) => handleWeightChange(config.subjectType, "writtenWorkWeight", e.target.value)}
                        className="pr-9 text-xl font-bold border-border rounded-xl h-12"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground font-semibold text-sm">%</span>
                    </div>
                    <p className="text-xs text-muted-foreground">Quizzes, unit tests, essays</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor={`${config.id}-pt`} className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Performance Task (PT)
                    </Label>
                    <div className="relative">
                      <Input
                        id={`${config.id}-pt`}
                        type="number"
                        min="0"
                        max="100"
                        value={config.performanceTaskWeight}
                        onChange={(e) => handleWeightChange(config.subjectType, "performanceTaskWeight", e.target.value)}
                        className="pr-9 text-xl font-bold border-border rounded-xl h-12"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground font-semibold text-sm">%</span>
                    </div>
                    <p className="text-xs text-muted-foreground">Projects, performances, outputs</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor={`${config.id}-TA`} className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Term Assessment (TA)
                    </Label>
                    <div className="relative">
                      <Input
                        id={`${config.id}-TA`}
                        type="number"
                        min="0"
                        max="100"
                        value={config.quarterlyAssessWeight}
                        onChange={(e) => handleWeightChange(config.subjectType, "quarterlyAssessWeight", e.target.value)}
                        className="pr-9 text-xl font-bold border-border rounded-xl h-12"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground font-semibold text-sm">%</span>
                    </div>
                    <p className="text-xs text-muted-foreground">Term examination</p>
                  </div>
                </div>

                {/* Weight Distribution Bar */}
                <div className="pt-5 border-t border-border">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Weight Distribution</span>
                    <span className={`text-sm font-bold ${isValid ? "text-primary" : "text-destructive"}`}>
                      {total}% total
                    </span>
                  </div>
                  <div className="h-3 bg-muted rounded-full overflow-hidden flex">
                    <div
                      className="transition-all duration-300 rounded-l-full"
                      style={{ width: `${config.writtenWorkWeight}%`, backgroundColor: colors.primary }}
                    />
                    <div
                      className="transition-all duration-300"
                      style={{ width: `${config.performanceTaskWeight}%`, backgroundColor: colors.secondary }}
                    />
                    <div
                      className="transition-all duration-300 rounded-r-full"
                      style={{ width: `${config.quarterlyAssessWeight}%`, backgroundColor: colors.accent }}
                    />
                  </div>
                  <div className="flex items-center gap-5 mt-2">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: colors.primary }} />
                      <span className="text-xs text-muted-foreground">WW {config.writtenWorkWeight}%</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: colors.secondary }} />
                      <span className="text-xs text-muted-foreground">PT {config.performanceTaskWeight}%</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: colors.accent }} />
                      <span className="text-xs text-muted-foreground">TA {config.quarterlyAssessWeight}%</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Change History */}
      <Card className="p-0 gap-0 border border-border shadow-sm bg-card overflow-hidden rounded-xl">
        <div className="px-6 py-4 border-b border-border flex items-center gap-3 bg-primary/5">
          <History className="w-4 h-4 text-primary" />
          <div>
            <h3 className="font-semibold text-sm text-foreground">Recent Configuration Changes</h3>
            <p className="text-xs text-muted-foreground">History of grading weight updates this session</p>
          </div>
        </div>
        <CardContent className="p-6">
          {configHistory.length === 0 ? (
            <div className="text-center py-8">
              <History className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No configuration changes recorded yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {configHistory.map((log, index) => (
                <div key={index} className="flex items-center gap-4 p-3 rounded-xl bg-muted">
                  <div className="p-2 rounded-lg shrink-0 bg-primary/10">
                    <Sliders className="w-3.5 h-3.5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{log.change}</p>
                    <p className="text-xs text-muted-foreground">{log.date} · by {log.user}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Per-Subject Weight Overrides */}
      <SubjectWeightsPanel configs={configs} />
    </div>
  );
}
