import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import axios from "axios";
import { getPortalToken } from "@/lib/api";

const SETTINGS_URL = "/api/admin/settings";

interface ThemeColors {
  primary: string;
  secondary: string;
  accent: string;
}

interface ThemeContextType {
  colors: ThemeColors;
  logoUrl: string | null;
  schoolName: string;
  schoolAddress: string;
  schoolDivision: string;
  schoolRegion: string;
  schoolId: string;
  currentSchoolYear: string;
  loading: boolean;
  refreshTheme: () => Promise<void>;
}

const defaultColors: ThemeColors = {
  primary: "#10b981", // emerald-500
  secondary: "#34d399", // emerald-400
  accent: "#6ee7b7", // emerald-300
};

const ThemeContext = createContext<ThemeContextType>({
  colors: defaultColors,
  logoUrl: null,
  schoolName: "School Management System",
  schoolAddress: "",
  schoolDivision: "",
  schoolRegion: "",
  schoolId: "",
  currentSchoolYear: "",
  loading: true,
  refreshTheme: async () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

// Helper function to determine if a color is light or dark
function isLightColor(hexColor: string): boolean {
  const hex = hexColor.replace("#", "");
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5;
}

// Helper function to lighten or darken a color
function adjustColor(hexColor: string, amount: number): string {
  const hex = hexColor.replace("#", "");
  const r = Math.min(255, Math.max(0, parseInt(hex.substring(0, 2), 16) + amount));
  const g = Math.min(255, Math.max(0, parseInt(hex.substring(2, 4), 16) + amount));
  const b = Math.min(255, Math.max(0, parseInt(hex.substring(4, 6), 16) + amount));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function applyThemeToDocument(colors: ThemeColors) {
  const root = document.documentElement;
  
  // Set primary theme variables (SMART specific)
  root.style.setProperty("--theme-primary", colors.primary);
  root.style.setProperty("--theme-secondary", colors.secondary);
  root.style.setProperty("--theme-accent", colors.accent);
  
  // Set EnrollPro compatible variables
  root.style.setProperty("--primary-color", colors.primary);
  root.style.setProperty("--secondary-color", colors.secondary);
  root.style.setProperty("--accent-color", colors.accent);
  root.style.setProperty("--text-color", isLightColor(colors.primary) ? "#1f2937" : "#ffffff");
  root.style.setProperty("--bg-color", "#f8fafc");
  
  // Generate color variations
  root.style.setProperty("--theme-primary-light", adjustColor(colors.primary, 40));
  root.style.setProperty("--theme-primary-dark", adjustColor(colors.primary, -40));
  root.style.setProperty("--theme-secondary-light", adjustColor(colors.secondary, 40));
  root.style.setProperty("--theme-secondary-dark", adjustColor(colors.secondary, -40));
  root.style.setProperty("--primary-light", adjustColor(colors.primary, 40));
  root.style.setProperty("--primary-dark", adjustColor(colors.primary, -40));
  
  // Text color for buttons (white or black based on background)
  const primaryTextColor = isLightColor(colors.primary) ? "#1f2937" : "#ffffff";
  const secondaryTextColor = isLightColor(colors.secondary) ? "#1f2937" : "#ffffff";
  root.style.setProperty("--theme-primary-text", primaryTextColor);
  root.style.setProperty("--theme-secondary-text", secondaryTextColor);
  root.style.setProperty("--text-primary", primaryTextColor);
  root.style.setProperty("--text-secondary", secondaryTextColor);
  root.style.setProperty("--on-primary", primaryTextColor);
  root.style.setProperty("--on-secondary", secondaryTextColor);
  
  // Sync Tailwind --primary so bg-primary, text-primary, border-primary reflect branding
  root.style.setProperty("--primary", colors.primary);
  root.style.setProperty("--color-primary", colors.primary);
  root.style.setProperty("--primary-foreground", primaryTextColor);
  root.style.setProperty("--color-primary-foreground", primaryTextColor);
  root.style.setProperty("--ring", colors.primary);
  root.style.setProperty("--color-ring", colors.primary);
  
  // RGB values for gradient/opacity uses
  const hexToRgb = (hex: string) => {
    const h = hex.replace("#", "");
    return `${parseInt(h.substring(0, 2), 16)}, ${parseInt(h.substring(2, 4), 16)}, ${parseInt(h.substring(4, 6), 16)}`;
  };
  root.style.setProperty("--theme-primary-rgb", hexToRgb(colors.primary));
  root.style.setProperty("--theme-secondary-rgb", hexToRgb(colors.secondary));
  root.style.setProperty("--theme-accent-rgb", hexToRgb(colors.accent));
  root.style.setProperty("--primary-rgb", hexToRgb(colors.primary));
  root.style.setProperty("--chart-1", colors.primary);
}

function updateBrowserMetadata(schoolName: string, logoUrl: string | null) {
  // Update document title with SMART suffix
  if (schoolName && schoolName !== "School Management System") {
    document.title = `${schoolName} | SMART`;
  } else {
    document.title = "SMART - Academic Grading System";
  }

  // Update favicon if logo exists
  if (logoUrl) {
    const fullLogoUrl = logoUrl.startsWith("http") ? logoUrl : `${window.location.origin}${logoUrl}`;
    
    // Find or create favicon link
    let link: HTMLLinkElement | null = document.querySelector("link[rel*='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.getElementsByTagName('head')[0].appendChild(link);
    }
    link.href = fullLogoUrl;
    link.type = "image/x-icon"; // Standard for favicons
  }
}

interface ThemeProviderProps {
  children: ReactNode;
}

const THEME_CACHE_KEY = "smart_theme_cache";

function loadCachedTheme(): { colors: ThemeColors; logoUrl: string | null; schoolName: string; schoolAddress: string; schoolDivision: string; schoolRegion: string; schoolId: string; currentSchoolYear: string } | null {
  try {
    const cached = localStorage.getItem(THEME_CACHE_KEY);
    if (cached) return JSON.parse(cached);
  } catch { /* intentionally empty */ }
  return null;
}

function saveThemeCache(data: { colors: ThemeColors; logoUrl: string | null; schoolName: string; schoolAddress: string; schoolDivision: string; schoolRegion: string; schoolId: string; currentSchoolYear: string }) {
  try {
    localStorage.setItem(THEME_CACHE_KEY, JSON.stringify(data));
  } catch { /* intentionally empty */ }
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [colors, setColors] = useState<ThemeColors>(() => loadCachedTheme()?.colors ?? defaultColors);
  const [logoUrl, setLogoUrl] = useState<string | null>(() => loadCachedTheme()?.logoUrl ?? null);
  const [schoolName, setSchoolName] = useState(() => loadCachedTheme()?.schoolName ?? "School Management System");
  const [schoolAddress, setSchoolAddress] = useState(() => loadCachedTheme()?.schoolAddress ?? "");
  const [schoolDivision, setSchoolDivision] = useState(() => loadCachedTheme()?.schoolDivision ?? "");
  const [schoolRegion, setSchoolRegion] = useState(() => loadCachedTheme()?.schoolRegion ?? "");
  const [schoolId, setSchoolId] = useState(() => loadCachedTheme()?.schoolId ?? "");
  const [currentSchoolYear, setCurrentSchoolYear] = useState(() => loadCachedTheme()?.currentSchoolYear ?? "");
  const [loading, setLoading] = useState(true);

  // Apply cached theme immediately so there's no flash on refresh
  useEffect(() => {
    const cached = loadCachedTheme();
    applyThemeToDocument(cached?.colors ?? defaultColors);
    updateBrowserMetadata(cached?.schoolName ?? schoolName, cached?.logoUrl ?? logoUrl);
  }, []);

  const refreshTheme = async () => {
    try {
      const response = await axios.get<{ settings: { primaryColor?: string; secondaryColor?: string; accentColor?: string; logoUrl?: string; schoolName?: string; address?: string; division?: string; region?: string; schoolId?: string } }>(SETTINGS_URL, {
        withCredentials: true,
      });
      const settings = response.data.settings;
      
      const newColors: ThemeColors = {
        primary: settings.primaryColor || defaultColors.primary,
        secondary: settings.secondaryColor || defaultColors.secondary,
        accent: settings.accentColor || defaultColors.accent,
      };
      const newLogoUrl = settings.logoUrl || null;
      const newSchoolName = settings.schoolName || "School Management System";
      const newAddress = settings.address || "";
      const newDivision = settings.division || "";
      const newRegion = settings.region || "";
      const newSchoolId = settings.schoolId || "";
      const newSchoolYear = settings.currentSchoolYear || "";

      setColors(newColors);
      setLogoUrl(newLogoUrl);
      setSchoolName(newSchoolName);
      setSchoolAddress(newAddress);
      setSchoolDivision(newDivision);
      setSchoolRegion(newRegion);
      setSchoolId(newSchoolId);
      setCurrentSchoolYear(newSchoolYear);

      // Persist to localStorage so refresh loads instantly
      saveThemeCache({ colors: newColors, logoUrl: newLogoUrl, schoolName: newSchoolName, schoolAddress: newAddress, schoolDivision: newDivision, schoolRegion: newRegion, schoolId: newSchoolId, currentSchoolYear: newSchoolYear });

      // Apply to document
      applyThemeToDocument(newColors);
      updateBrowserMetadata(newSchoolName, newLogoUrl);
    } catch (error) {
      console.error("Failed to fetch theme settings:", error);
      // Keep using current state (cached or default), just apply to document
      applyThemeToDocument(colors);
      updateBrowserMetadata(schoolName, logoUrl);
    } finally {
      setLoading(false);
    }
  };

  // Apply settings from SSE update
  const applySettingsUpdate = (settings: { primaryColor?: string; secondaryColor?: string; accentColor?: string; logoUrl?: string; schoolName?: string; address?: string; division?: string; region?: string; schoolId?: string }) => {
    const newColors: ThemeColors = {
      primary: settings.primaryColor || defaultColors.primary,
      secondary: settings.secondaryColor || defaultColors.secondary,
      accent: settings.accentColor || defaultColors.accent,
    };
    const newLogoUrl = settings.logoUrl || null;
    const newSchoolName = settings.schoolName || "School Management System";
    const newAddress = settings.address || "";
    const newDivision = settings.division || "";
    const newRegion = settings.region || "";
    const newSchoolId = settings.schoolId || "";

    setColors(newColors);
    setLogoUrl(newLogoUrl);
    setSchoolName(newSchoolName);
    setSchoolAddress(newAddress);
    setSchoolDivision(newDivision);
    setSchoolRegion(newRegion);
    setSchoolId(newSchoolId);

    // Persist to localStorage
    saveThemeCache({ colors: newColors, logoUrl: newLogoUrl, schoolName: newSchoolName, schoolAddress: newAddress, schoolDivision: newDivision, schoolRegion: newRegion, schoolId: newSchoolId });

    // Apply to document
    applyThemeToDocument(newColors);
    updateBrowserMetadata(newSchoolName, newLogoUrl);
  };

  useEffect(() => {
    refreshTheme();
  }, []);

  // SSE subscription for realtime settings updates across all connected clients
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
        try {
          const updatedSettings = JSON.parse(event.data);
          applySettingsUpdate(updatedSettings);
        } catch (err) {
          console.error("Failed to parse settings update:", err);
        }
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
  }, []);

  return (
    <ThemeContext.Provider value={{ colors, logoUrl, schoolName, schoolAddress, schoolDivision, schoolRegion, schoolId, currentSchoolYear, loading, refreshTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export default ThemeContext;
