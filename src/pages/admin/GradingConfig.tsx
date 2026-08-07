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
  RefreshCw,
  AlertTriangle,
  Calculator,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { adminApi } from "@/lib/api";
import type { GradingConfig as GradingConfigType } from "@/lib/api";
import { useTheme } from "@/contexts/ThemeContext";

const subjectTypeInfo: Record<string, { label: string; subjects: string[]; icon: React.ElementType; defaultWeights: string }> = {
  CORE: {
    label: "Core Academic Subjects",
    subjects: ["English", "Filipino", "Araling Panlipunan", "Edukasyon sa Pagpapakatao"],
    icon: BookOpen,
    defaultWeights: "20% WW · 50% PT · 30% TA",
  },
  MATH_SCIENCE: {
    label: "Mathematics & Science",
    subjects: ["Mathematics", "Science"],
    icon: Calculator,
    defaultWeights: "20% WW · 50% PT · 30% TA",
  },
  MAPEH: {
    label: "MAPEH",
    subjects: ["Music", "Arts", "Physical Education", "Health"],
    icon: Music,
    defaultWeights: "20% WW · 60% PT · 20% TA",
  },
  TLE: {
    label: "Technology & Livelihood Education",
    subjects: ["TLE", "Home Economics", "Industrial Arts", "Computer Education"],
    icon: Wrench,
    defaultWeights: "20% WW · 60% PT · 20% TA",
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

  const fetchConfigs = async () => {
    try {
      setLoading(true);
      const response = await adminApi.getGradingConfig();
      setConfigs(response.data.configs);
      setOriginalConfigs(response.data.configs);
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

  // Check if there are changes by comparing configs deeply
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
      
      // Update each changed config
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
      
      // Refresh configs from server
      const response = await adminApi.getGradingConfig();
      setConfigs(response.data.configs);
      setOriginalConfigs(response.data.configs);
      
      setHasChanges(false);
      setSaveSuccess(true);
      
      // Add to history
      setConfigHistory(prev => [{
        date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        user: 'Admin',
        change: 'Updated grading weights'
      }, ...prev.slice(0, 4)]);
      
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error("Failed to save grading config:", err);
      alert("Failed to save changes");
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
      setHasChanges(false);
      setSaveSuccess(true);
      
      // Add to history
      setConfigHistory(prev => [{
        date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        user: 'Admin',
        change: 'Reset all weights to DepEd default values'
      }, ...prev.slice(0, 4)]);
      
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error("Failed to reset grading config:", err);
      alert("Failed to reset to defaults");
    } finally {
      setResetting(false);
    }
  };

  const allValid = configs.every(validateWeights);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: colors.primary }} />
          <p className="text-gray-500">Loading grading configuration...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="flex flex-col items-center gap-3 text-center">
          <AlertTriangle className="w-12 h-12 text-amber-500" />
          <p className="text-gray-700 font-medium">{error}</p>
          <Button onClick={fetchConfigs} variant="outline" className="gap-2">
            <RefreshCw className="w-4 h-4" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Page Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold" style={{ color: '#111827' }}>
            Grading Configuration
          </h1>
          <p style={{ color: '#6b7280' }} className="mt-1">
            Configure grading component weights for each subject type
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            className="gap-2 rounded-xl border-gray-200"
            onClick={handleReset}
            disabled={resetting}
          >
            {resetting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
            Reset to Default
          </Button>
          <Button
            className="gap-2 text-white font-semibold rounded-xl shadow-lg"
            style={{ backgroundColor: colors.primary }}
            onClick={handleSave}
            disabled={!allValid || saving}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Changes
          </Button>
        </div>
      </div>

      {/* Status Alerts */}
      {saveSuccess && (
        <div className="flex items-center gap-3 p-4 rounded-xl border" style={{ backgroundColor: `${colors.primary}12`, borderColor: `${colors.primary}30` }}>
          <CheckCircle2 className="w-5 h-5" style={{ color: colors.primary }} />
          <p className="text-sm font-medium" style={{ color: colors.primary }}>Grading configuration saved successfully!</p>
        </div>
      )}

      {hasChanges && !allValid && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200">
          <AlertCircle className="w-5 h-5 text-amber-600" />
          <p className="text-sm font-medium text-amber-700">All weights must add up to exactly 100% before saving.</p>
        </div>
      )}

      {/* DepEd Guidelines Info Banner */}
      <Card className="p-0 gap-0 border-0 shadow-md overflow-hidden" style={{ backgroundColor: `${colors.primary}08` }}>
        <CardContent className="p-5">
          <div className="flex items-start gap-4">
            <div className="p-2.5 rounded-xl shrink-0" style={{ backgroundColor: `${colors.primary}18` }}>
              <Info className="w-5 h-5" style={{ color: colors.primary }} />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-sm mb-1" style={{ color: '#111827' }}>DepEd Grading Guidelines (Revised 2026)</h3>
              <p className="text-xs text-gray-500 mb-3">
                Per the Revised Guidelines on Classroom Assessment (April 2026), weights are now aligned across Core, Math, and Science subjects.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div className="bg-white rounded-lg px-3 py-2 border border-white/80">
                  <span className="text-xs text-gray-500 font-medium block">Core, Math &amp; Science</span>
                  <span className="text-xs font-semibold" style={{ color: '#111827' }}>WW 20% · PT 50% · TA 30%</span>
                </div>
                <div className="bg-white rounded-lg px-3 py-2 border border-white/80">
                  <span className="text-xs text-gray-500 font-medium block">MAPEH &amp; TLE</span>
                  <span className="text-xs font-semibold" style={{ color: '#111827' }}>WW 20% · PT 60% · TA 20%</span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Grading Weight Cards */}
      <div className="grid grid-cols-1 gap-6">
        {configs.map((config) => {
          const isValid = validateWeights(config);
          const total = config.writtenWorkWeight + config.performanceTaskWeight + config.quarterlyAssessWeight;
          const info = subjectTypeInfo[config.subjectType] || {
            label: config.subjectType,
            subjects: [],
            icon: BookOpen,
            defaultWeights: "",
          };
          const Icon = info.icon;

          return (
            <Card key={config.id} className="p-0 gap-0 border-0 shadow-lg overflow-hidden bg-white">
              {/* Card Header — fills full width including corners */}
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between" style={{ backgroundColor: `${colors.primary}0d` }}>
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl" style={{ backgroundColor: `${colors.primary}18`, color: colors.primary }}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm" style={{ color: '#111827' }}>{info.label}</h3>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {info.subjects.map((subject) => (
                        <Badge key={subject} variant="outline" className="text-xs py-0 h-5">
                          {subject}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-3">
                  {config.isDepEdDefault && (
                    <Badge className="border-0 text-xs font-medium" style={{ backgroundColor: `${colors.primary}18`, color: colors.primary }}>
                      <CheckCircle2 className="w-3 h-3 mr-1" />
                      DepEd Default
                    </Badge>
                  )}
                  {isValid && !config.isDepEdDefault && (
                    <Badge className="border-0 text-xs font-medium bg-amber-100 text-amber-700">
                      Custom
                    </Badge>
                  )}
                  {!isValid && (
                    <Badge className="border-0 text-xs font-medium bg-red-100 text-red-700">
                      <AlertCircle className="w-3 h-3 mr-1" />
                      {total}% / 100%
                    </Badge>
                  )}
                </div>
              </div>

              {/* Card Body */}
              <CardContent className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-6">
                  {/* Written Work */}
                  <div className="space-y-2">
                    <Label htmlFor={`${config.id}-ww`} className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
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
                        className="pr-9 text-xl font-bold border-gray-200 rounded-xl h-12"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 font-semibold text-sm">%</span>
                    </div>
                    <p className="text-xs text-gray-400">Quizzes, unit tests, essays</p>
                  </div>

                  {/* Performance Task */}
                  <div className="space-y-2">
                    <Label htmlFor={`${config.id}-pt`} className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
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
                        className="pr-9 text-xl font-bold border-gray-200 rounded-xl h-12"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 font-semibold text-sm">%</span>
                    </div>
                    <p className="text-xs text-gray-400">Projects, performances, outputs</p>
                  </div>

                  {/* Term Assessment */}
                  <div className="space-y-2">
                    <Label htmlFor={`${config.id}-TA`} className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
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
                        className="pr-9 text-xl font-bold border-gray-200 rounded-xl h-12"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 font-semibold text-sm">%</span>
                    </div>
                    <p className="text-xs text-gray-400">Term examination</p>
                  </div>
                </div>

                {/* Weight Distribution Bar */}
                <div className="pt-5 border-t border-gray-100">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Weight Distribution</span>
                    <span
                      className={`text-sm font-bold ${!isValid ? "text-red-600" : ""}`}
                      style={isValid ? { color: colors.primary } : undefined}
                    >
                      {total}% total
                    </span>
                  </div>
                  <div className="h-3 bg-gray-100 rounded-full overflow-hidden flex">
                    <div
                      className="transition-all duration-300 rounded-l-full"
                      style={{ width: `${config.writtenWorkWeight}%`, backgroundColor: colors.primary }}
                    />
                    <div
                      className="transition-all duration-300"
                      style={{ width: `${config.performanceTaskWeight}%`, backgroundColor: colors.secondary || '#8b5cf6' }}
                    />
                    <div
                      className="transition-all duration-300 rounded-r-full"
                      style={{ width: `${config.quarterlyAssessWeight}%`, backgroundColor: colors.accent || '#f59e0b' }}
                    />
                  </div>
                  <div className="flex items-center gap-5 mt-2">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: colors.primary }} />
                      <span className="text-xs text-gray-500">WW {config.writtenWorkWeight}%</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: colors.secondary || '#8b5cf6' }} />
                      <span className="text-xs text-gray-500">PT {config.performanceTaskWeight}%</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: colors.accent || '#f59e0b' }} />
                      <span className="text-xs text-gray-500">TA {config.quarterlyAssessWeight}%</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Change History */}
      <Card className="p-0 gap-0 border-0 shadow-lg bg-white overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3" style={{ backgroundColor: `${colors.primary}06` }}>
          <History className="w-4 h-4" style={{ color: colors.primary }} />
          <div>
            <h3 className="font-semibold text-sm" style={{ color: '#111827' }}>Recent Configuration Changes</h3>
            <p className="text-xs text-gray-500">History of grading weight updates this session</p>
          </div>
        </div>
        <CardContent className="p-6">
          {configHistory.length === 0 ? (
            <div className="text-center py-8">
              <History className="w-8 h-8 mx-auto mb-2 text-gray-200" />
              <p className="text-sm text-gray-400">No configuration changes recorded yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {configHistory.map((log, index) => (
                <div key={index} className="flex items-center gap-4 p-3 rounded-xl bg-gray-50">
                  <div className="p-2 rounded-lg shrink-0" style={{ backgroundColor: `${colors.primary}12` }}>
                    <Sliders className="w-3.5 h-3.5" style={{ color: colors.primary }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{log.change}</p>
                    <p className="text-xs text-gray-400">{log.date} · by {log.user}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
