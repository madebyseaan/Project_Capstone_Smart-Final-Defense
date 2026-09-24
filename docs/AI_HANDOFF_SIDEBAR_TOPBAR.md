# AI Handoff — SMART Shell Design (Sidebar + Topbar) for MRF

**How to use this document:** paste it into the MRF-side AI coding agent as the task brief. It is fully self-contained: the agent does not need access to the SMART repository. The MRF team supplies its own navigation content, routes, auth, logo, and API wiring; the visual design (geometry, typography, icons, colors, motion) must match this spec exactly.

---

## 0. Task brief for the agent

You are implementing the application shell (fixed left sidebar + sticky top header) in the MRF codebase. A reference implementation was extracted from the SMART system. Reproduce its visual design and interaction behavior in MRF's stack, but **use MRF's own navigation items, routes, labels, user object, and logout behavior**. The navigation content in this document is placeholder data and must be replaced.

Deliverables:
1. Sidebar component (collapsible 280px ↔ 70px on desktop, off-canvas drawer on mobile).
2. Topbar component (64px sticky, frosted, with menu toggle, portal label + page title, optional right-side actions, school-year badge, user block).
3. Font loading (DM Sans) and the design tokens from §4.
4. Acceptance criteria in §9 verified.

Assumption: the reference code in §7 is React + Tailwind CSS. If MRF uses another framework or styling system, use Appendix A (computed values) to translate; keep every dimension, color, radius, and duration identical.

---

## 1. Hard rules

### 1.1 KEEP (do not alter)
- Sidebar widths: **280px** expanded, **70px** collapsed; topbar height **64px**; logo header height **96px**.
- Nav items are **full pills** (`border-radius: 9999px`), not rounded rectangles.
- Active nav item: solid theme-primary background, white text and icon, `shadow-sm`.
- Hover nav item: `rgba(255,255,255,0.8)` on the `#fafafa` sidebar.
- Icon sizes: **20px** top-level, **16px** nested children, **16px** chevron; nav icons use **strokeWidth 2.2**.
- Collapse/expand transition: **200ms cubic-bezier(0.4, 0, 0.2, 1)** on width, transform, and content padding.
- Labels fade with `opacity 0`, `scale 0.9`, `translateX(-16px)`, width `0`, `transform-origin: left` — never `display:none`.
- Topbar: `position: sticky; top: 0; z-index: 30`, frosted glass (`rgba(255,255,255,0.8)` + `backdrop-filter: blur(12px)`), 1px bottom border `#e2e8f0`.
- DM Sans as the font; sidebar font hard-set so it cannot be overridden.
- Accent color must come from a single CSS variable (`--theme-primary`), never hardcoded per-item.

### 1.2 REPLACE (MRF content)
- All nav items, group titles, hrefs, icons, badges.
- Portal label text, page-title source, user name/role, avatar logic, school-year value.
- Logout handler, auth guard, routing primitives (`<a>` → MRF router link).
- Logo source and school/brand name.

### 1.3 DO NOT
- Do not restyle the pills, change radii, change durations, or substitute icon stroke width.
- Do not add borders to nav items, section dividers other than the specified `slate-100` rules, or drop shadows on the sidebar pills (except the active item’s `shadow-sm`).
- Do not use `display: none` for collapsing labels (causes layout jump).
- Do not add a search bar, breadcrumb, or extra chrome not specified here.

---

## 2. Dependencies

```bash
# icons (required)
pnpm add lucide-react
# or: npm install lucide-react

# if using the optional dropdown reveal animation from tw-animate-css
pnpm add -D tw-animate-css
```

DM Sans is loaded from Google Fonts via CSS import — no package install needed.

---

## 3. Fonts (exact)

```css
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&display=swap');

:root {
  --sans: 'DM Sans', system-ui, -apple-system, sans-serif;
  --mono: 'SF Mono', ui-monospace, Consolas, monospace;

  font: 16px/1.6 var(--sans);
  letter-spacing: -0.011em;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  font-feature-settings: 'cv02', 'cv03', 'cv04', 'cv11';
}

@media (max-width: 640px) {
  :root { font-size: 15px; }
}
```

If MRF uses Tailwind v4, also map the theme font (v3: `fontFamily.sans` in the config):

```css
@theme inline {
  --font-sans: 'DM Sans', sans-serif;
}
```

Sidebar element additionally hard-sets, so a future global font change cannot break it:

```tsx
style={{ fontFamily: "'DM Sans', 'Poppins', sans-serif" }}
```

---

## 4. Design tokens

### 4.1 Dimensions

| Token | Value |
|---|---|
| Sidebar expanded width | 280px |
| Sidebar collapsed width | 70px (only ≥1024px) |
| Sidebar logo header height | 96px |
| Topbar height | 64px |
| Main content padding | 16px mobile / 32px desktop |
| Logo tile | 48×48px, radius 8px, padding 4px |
| Nav icon box | 24×24px (icon 20px inside) |
| Nested icon | 16px |
| Avatar (sidebar footer / topbar) | 36×36px |
| Nav pill padding | 16px horizontal, 6px vertical |
| Nav icon→label gap | 16px top-level, 12px nested |
| Collapsed icon button | 40×40px, centered |

### 4.2 Radii

| Use | Value |
|---|---|
| Nav pills | 9999px |
| Logo tile, role pill, school-year badge | 8px |
| Topbar icon buttons | 12px |
| Drawer backdrop | n/a |

### 4.3 Colors

Dynamic accent (one variable drives everything):

| Token | Value |
|---|---|
| `--theme-primary` | school-configurable; default `#10b981` |
| `--theme-primary-rgb` | `16, 185, 129` (default) — used for 10% translucent active-parent bg and the page backdrop tint |
| `--theme-primary-text` | auto contrast: `#1f2937` if primary is light, else `#ffffff` |

Fixed neutrals:

| Role | Value |
|---|---|
| Sidebar background | `#fafafa` |
| Sidebar right border | `#e2e8f0` (slate-200) |
| Nav text / icons | `#0F1729` (icons 70%, group labels 60%, sub-text 50%) |
| Nav hover surface | `rgba(255,255,255,0.8)` |
| Footer top border, dividers | `#f1f5f9` (slate-100) |
| Topbar background | `rgba(255,255,255,0.8)` + blur |
| Topbar title | `#0f172a` (slate-900) |
| Topbar portal label | `#64748b` (slate-500) |
| Topbar icon buttons | `#475569` (slate-600), hover `#f1f5f9` |
| School-year badge | bg `#f1f5f9`, text `#475569` |
| Avatar fallback | sidebar: bg `#f1f5f9` / text `#334155`; topbar: bg `#e2e8f0` / text `#334155` |
| Disabled / unavailable | `opacity: 0.4`, `cursor: not-allowed` |
| Badge “In Dev” | bg `#fef3c7` / text `#b45309`; on active pill: bg `rgba(255,255,255,0.2)` / text `rgba(255,255,255,0.9)` |
| Role tones | Admin: `#059669` on `#ecfdf5`; Registrar: `#2563eb` on `#eff6ff`; Teacher: theme primary on `rgba(primary, 0.06)` |
| Logout hover | text `#dc2626`, bg white |

### 4.4 Motion

| Element | Duration | Easing |
|---|---|---|
| Sidebar width/transform + content padding | 200ms | `cubic-bezier(0.4, 0, 0.2, 1)` |
| Label collapse fade/slide | 200ms | `cubic-bezier(0.4, 0, 0.2, 1)`, origin left |
| Hover/active color transitions | 200ms | ease |
| Chevron rotate | 200ms | ease |
| Dropdown children reveal | 200ms | fade + slide-from-top 4px |
| Button press feedback | instant | `transform: scale(0.95)` |
| Logo scale when collapsed | 200ms | ease-out (`scale 0.85`) |

---

## 5. Icon spec

Library: `lucide-react`.

| Where | Icon size | Stroke |
|---|---|---|
| Sidebar top-level items | 20px (`w-5 h-5`) | `2.2` |
| Sidebar nested children | 16px (`w-4 h-4`) | `2.2` |
| Sidebar chevron | 16px | default |
| Mobile sidebar close | 20px | default |
| Topbar hamburger | 20px | default |
| Topbar bell | 20px | default |
| Sidebar logout | 16px | default |

Every sidebar icon sits in a fixed 24×24px box (`display:flex; align-items:center; justify-content:center`) so nothing shifts during collapse. Logo fallback (when no image): 24px icon in theme primary (SMART used `Shield` for admin, `GraduationCap` for teacher/registrar — pick MRF-appropriate equivalents, e.g. `Wrench`).

---

## 6. Placeholder data shape (MRF replaces this)

```ts
import type { LucideIcon } from "lucide-react";

export interface NavChild {
  name: string;
  href: string;
  icon: LucideIcon;
  badge?: string;
}

export interface NavItem {
  name: string;
  href?: string;
  icon: LucideIcon;
  children?: NavChild[];
  disabled?: boolean;
  badge?: string;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}
```

Rules for MRF content:
- Group titles are short uppercase words (`OPERATIONS`, `ACADEMICS`, `SYSTEM`, or MRF equivalents such as `MAINTENANCE`, `REQUESTS`, `REPORTS`).
- Item names use title case and must fit one line at 280px.
- An expandable item is an item with `children` and no `href`.
- Items with `disabled: true` render as non-interactive rows at 40% opacity with a native `title` explaining why.
- `badge` renders the amber “In Dev”-style chip; use it for status identifiers, not counts.

---

## 7. Reference implementation (React + Tailwind)

Single-file reference. Replace placeholder nav/user values with MRF’s; keep all class strings and values.

```tsx
import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, LogOut, Menu, X, type LucideIcon } from "lucide-react";

export interface NavChild {
  name: string;
  href: string;
  icon: LucideIcon;
  badge?: string;
}

export interface NavItem {
  name: string;
  href?: string;
  icon: LucideIcon;
  children?: NavChild[];
  disabled?: boolean;
  badge?: string;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export interface ShellUser {
  name: string;
  roleLabel: string;
  roleTone?: "emerald" | "blue" | "primary";
}

export interface AppShellProps {
  brand: { name: string; logoUrl?: string | null; fallbackIcon: LucideIcon };
  navGroups: NavGroup[];
  portalLabel: string;
  pageTitle: string;
  user: ShellUser;
  schoolYear?: string;
  activePath: string;
  onLogout: () => void;
  onNavigate?: (href: string) => void;
  headerActions?: ReactNode;
  persistKey?: string;
  children: ReactNode;
}

const ROLE_TONES: Record<string, string> = {
  emerald: "text-emerald-600 bg-emerald-50",
  blue: "text-blue-600 bg-blue-50",
};

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function initials(name: string) {
  const first = name.trim().charAt(0);
  return first ? first.toUpperCase() : "?";
}

function isActivePath(pathname: string, href: string, rootHref: string) {
  if (pathname === href) return true;
  if (href === rootHref) return false;
  return pathname.startsWith(href);
}

export function AppShell({
  brand,
  navGroups,
  portalLabel,
  pageTitle,
  user,
  schoolYear,
  activePath,
  onLogout,
  onNavigate,
  headerActions,
  persistKey = "mrfSidebarCollapsed",
  children,
}: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setCollapsed(localStorage.getItem(persistKey) === "true");
  }, [persistKey]);

  const toggleCollapse = () => {
    setCollapsed((prev) => {
      localStorage.setItem(persistKey, String(!prev));
      return !prev;
    });
  };

  const toggleGroup = (name: string) => {
    setOpenGroups((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  const rootHref = navGroups[0]?.items[0]?.href ?? "/";

  const BrandFallback = brand.fallbackIcon;
  const UserInitials = initials(user.name);
  const roleToneClass = user.roleTone ? ROLE_TONES[user.roleTone] : undefined;

  return (
    <div className="isolate min-h-screen">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden transition-opacity"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={cx(
          "fixed inset-y-0 left-0 z-50 bg-[#fafafa] border-r border-slate-200 transition-[width,transform] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] flex flex-col shadow-sm will-change-[width,transform]",
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
          collapsed ? "lg:w-[70px] w-[280px]" : "w-[280px]",
        )}
        style={{ fontFamily: "'DM Sans', 'Poppins', sans-serif" }}
      >
        <div
          className={cx(
            "h-24 flex items-center overflow-hidden transition-all duration-200",
            collapsed ? "px-0 justify-center" : "px-6",
          )}
        >
          {collapsed ? (
            <div className="w-12 h-12 rounded-lg bg-white border border-slate-100 shadow-sm flex items-center justify-center overflow-hidden transition-transform duration-200 ease-out p-1 scale-[0.85]">
              {brand.logoUrl ? (
                <img src={brand.logoUrl} alt="Logo" className="w-full h-full object-contain" />
              ) : (
                <BrandFallback className="w-6 h-6 text-[var(--theme-primary)]" />
              )}
            </div>
          ) : (
            <div className="flex items-center w-full min-w-[240px] transition-all duration-200">
              <div className="w-12 h-12 flex flex-shrink-0 items-center justify-center">
                <div className="w-12 h-12 rounded-lg bg-white border border-slate-100 shadow-sm flex items-center justify-center overflow-hidden p-1">
                  {brand.logoUrl ? (
                    <img src={brand.logoUrl} alt="Logo" className="w-full h-full object-contain" />
                  ) : (
                    <BrandFallback className="w-6 h-6 text-[var(--theme-primary)]" />
                  )}
                </div>
              </div>
              <div className="ml-3 transition-all duration-200 origin-left flex-shrink-0">
                <span className="font-bold text-sm leading-tight tracking-tight uppercase block max-w-[160px] text-[var(--theme-primary)]">
                  {brand.name}
                </span>
              </div>
            </div>
          )}
          <button
            className="lg:hidden ml-auto p-2 rounded-lg hover:bg-slate-100 text-slate-400 transition-colors"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-2 px-3 custom-scrollbar overflow-x-hidden">
          {navGroups.map((group) => (
            <div key={group.title} className="mb-5 first:mt-2">
              {!collapsed && (
                <span className="px-4 mb-1 text-[0.625rem] font-bold text-[#0F1729]/60 uppercase tracking-normal block whitespace-nowrap">
                  {group.title}
                </span>
              )}
              <div className="space-y-1">
                {group.items.map((item) => {
                  if (item.children) {
                    const hasActiveChild = item.children.some((child) =>
                      isActivePath(activePath, child.href, rootHref),
                    );
                    const isOpen = !!openGroups[item.name];

                    return (
                      <div key={item.name}>
                        <button
                          type="button"
                          onClick={() => toggleGroup(item.name)}
                          disabled={item.disabled}
                          className={cx(
                            "w-full flex items-center rounded-full text-[14px] font-medium transition-all duration-200 group overflow-hidden py-1.5",
                            collapsed ? "px-0 justify-center h-10 w-10 mx-auto" : "px-4",
                            item.disabled
                              ? "text-[#0F1729] opacity-40 cursor-not-allowed select-none"
                              : "text-[#0F1729] hover:bg-white/80",
                          )}
                          style={{
                            backgroundColor:
                              hasActiveChild && !collapsed && !item.disabled
                                ? "rgba(var(--theme-primary-rgb), 0.1)"
                                : "transparent",
                          }}
                          title={collapsed ? item.name : undefined}
                        >
                          <div
                            className={cx(
                              "flex items-center transition-all duration-200",
                              collapsed ? "justify-center" : "w-full",
                            )}
                          >
                            <div className="w-6 h-6 flex flex-shrink-0 items-center justify-center">
                              <item.icon
                                className={cx(
                                  "w-5 h-5 transition-colors duration-200",
                                  hasActiveChild
                                    ? "text-[#0F1729]"
                                    : "text-[#0F1729]/70 group-hover:text-[#0F1729]",
                                )}
                                strokeWidth={2.2}
                              />
                            </div>
                            <div
                              className={cx(
                                "flex items-center justify-between flex-1 transition-[opacity,transform,margin] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] origin-left",
                                collapsed
                                  ? "opacity-0 scale-90 -translate-x-4 pointer-events-none w-0 m-0"
                                  : "opacity-100 scale-100 translate-x-0 ml-4",
                              )}
                            >
                              <div className="flex min-w-0 items-center gap-2">
                                <span className="truncate whitespace-nowrap">{item.name}</span>
                                {item.badge && (
                                  <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-700 whitespace-nowrap">
                                    <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
                                    {item.badge}
                                  </span>
                                )}
                              </div>
                              <ChevronDown
                                className={cx(
                                  "w-4 h-4 transition-transform duration-200 opacity-60 shrink-0",
                                  isOpen && "transform rotate-180",
                                )}
                              />
                            </div>
                          </div>
                        </button>

                        {isOpen && !collapsed && (
                          <div className="mt-0.5 space-y-0.5 pl-4 animate-in fade-in slide-in-from-top-1 duration-200 border-l border-slate-100 ml-7">
                            {item.children.map((child) => {
                              const childActive = isActivePath(activePath, child.href, rootHref);

                              return (
                                <a
                                  key={child.name}
                                  href={child.href}
                                  onClick={() => {
                                    setSidebarOpen(false);
                                    onNavigate?.(child.href);
                                  }}
                                  className="flex items-center gap-3 rounded-full text-[13px] font-medium transition-all duration-200 px-4 py-1.5"
                                  style={{
                                    backgroundColor: childActive ? "var(--theme-primary)" : "transparent",
                                    color: childActive ? "#ffffff" : "#0F1729",
                                  }}
                                >
                                  <child.icon
                                    className={cx(
                                      "w-4 h-4 flex-shrink-0",
                                      childActive ? "text-white" : "text-[#0F1729]/60",
                                    )}
                                    strokeWidth={2.2}
                                  />
                                  <span className="flex-1 min-w-0 truncate">{child.name}</span>
                                </a>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  }

                  const itemActive =
                    !item.disabled && !!item.href && isActivePath(activePath, item.href, rootHref);

                  return (
                    <a
                      key={item.name}
                      href={item.href}
                      onClick={() => {
                        setSidebarOpen(false);
                        if (item.href) onNavigate?.(item.href);
                      }}
                      aria-disabled={item.disabled || undefined}
                      className={cx(
                        "flex items-center rounded-full text-[14px] font-medium transition-all duration-200 group overflow-hidden py-1.5",
                        collapsed ? "px-0 justify-center h-10 w-10 mx-auto" : "px-4",
                        item.disabled && "opacity-40 cursor-not-allowed select-none",
                        !item.disabled && itemActive && "text-white shadow-sm",
                        !item.disabled && !itemActive && "text-[#0F1729] hover:bg-white/80",
                      )}
                      style={{
                        backgroundColor: itemActive ? "var(--theme-primary)" : "transparent",
                      }}
                      title={collapsed ? item.name : undefined}
                    >
                      <div
                        className={cx(
                          "flex items-center transition-all duration-200",
                          collapsed ? "justify-center" : "w-full",
                        )}
                      >
                        <div className="w-6 h-6 flex flex-shrink-0 items-center justify-center">
                          <item.icon
                            className={cx(
                              "w-5 h-5 transition-colors duration-200",
                              itemActive ? "text-white" : "text-[#0F1729]/70 group-hover:text-[#0F1729]",
                            )}
                            strokeWidth={2.2}
                          />
                        </div>
                        <span
                          className={cx(
                            "transition-[opacity,transform,margin] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] origin-left whitespace-nowrap flex-shrink-0",
                            collapsed
                              ? "opacity-0 scale-90 -translate-x-4 pointer-events-none w-0 m-0"
                              : "opacity-100 scale-100 translate-x-0 ml-4",
                          )}
                        >
                          {item.name}
                        </span>
                      </div>
                    </a>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div
          className={cx(
            "p-4 border-t border-slate-100 transition-all duration-200 bg-white/20 overflow-hidden",
            collapsed ? "px-2 py-4" : "p-4",
          )}
        >
          <div
            className={cx(
              "flex items-center transition-all duration-200 px-1 py-1",
              collapsed ? "justify-center" : "w-full",
            )}
          >
            <div className="w-9 h-9 flex flex-shrink-0 items-center justify-center">
              <div
                className="w-9 h-9 rounded-full border border-white shadow-sm transition-transform duration-200 flex items-center justify-center bg-slate-100 text-slate-700 font-bold text-xs uppercase"
                style={{ transform: collapsed ? "scale(0.9)" : "scale(1)" }}
              >
                {UserInitials}
              </div>
            </div>
            <div
              className={cx(
                "flex-1 min-w-0 flex items-center justify-between transition-[opacity,transform,margin] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] origin-left",
                collapsed
                  ? "opacity-0 scale-90 -translate-x-4 pointer-events-none w-0 m-0"
                  : "opacity-100 scale-100 translate-x-0 ml-3",
              )}
            >
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-[#0F1729] truncate leading-none mb-1">{user.name}</p>
                <p className="text-[10px] font-bold text-[#0F1729]/50 truncate uppercase tracking-tight">
                  {user.roleLabel}
                </p>
              </div>
              <button
                onClick={onLogout}
                className="p-1.5 rounded-lg hover:bg-white hover:text-red-600 text-slate-400 transition-colors duration-200 ml-1"
                title="Sign Out"
                aria-label="Sign Out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </aside>

      <div
        className={cx(
          "transition-[padding] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] flex flex-col min-h-screen will-change-[padding]",
          collapsed ? "lg:pl-[70px]" : "lg:pl-[280px]",
        )}
      >
        <header className="sticky top-0 z-30 h-16 bg-white/80 backdrop-blur-md border-b border-slate-200 px-4 lg:px-6">
          <div className="h-full flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                className="p-2 rounded-xl hover:bg-slate-100 text-slate-600 transition-all active:scale-95"
                onClick={() => {
                  if (window.innerWidth >= 1024) {
                    toggleCollapse();
                  } else {
                    setSidebarOpen(true);
                  }
                }}
                aria-label="Toggle sidebar"
              >
                <Menu className="w-5 h-5" />
              </button>

              <div className="flex flex-col">
                <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                  {portalLabel}
                </span>
                <span className="text-base font-bold text-slate-900 -mt-1">{pageTitle}</span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {headerActions}

              {schoolYear && (
                <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-bold tracking-wider px-2 py-1 rounded-lg bg-slate-100 text-slate-600">
                  S.Y. {schoolYear}
                </span>
              )}

              <div className="flex items-center gap-3 pl-3 border-l border-slate-100">
                <div className="hidden sm:flex flex-col items-end mr-1">
                  <span className="text-sm font-bold text-slate-900 leading-none">{user.name}</span>
                  <span
                    className={cx(
                      "text-[10px] font-medium px-1.5 py-0.5 rounded-md mt-1",
                      user.roleTone === "primary" ? "" : roleToneClass,
                    )}
                    style={
                      user.roleTone === "primary"
                        ? { color: "var(--theme-primary)", backgroundColor: "rgba(var(--theme-primary-rgb), 0.06)" }
                        : undefined
                    }
                  >
                    {user.roleLabel}
                  </span>
                </div>
                <div className="w-9 h-9 rounded-full ring-2 ring-slate-100 ring-offset-2 flex items-center justify-center bg-slate-200 text-slate-700 text-sm font-bold">
                  {UserInitials}
                </div>
              </div>
            </div>
          </div>
        </header>

        <main className="p-4 lg:p-8 flex-1">{children}</main>
      </div>
    </div>
  );
}
```

### 7.1 Required global CSS (sidebar scrollbar)

```css
.custom-scrollbar::-webkit-scrollbar { width: 4px; }
.custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
.custom-scrollbar::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 4px; }
.custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #cbd5e1; }

:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}
```

### 7.2 Usage example (MRF replaces all values)

```tsx
import { Wrench, ClipboardList, Users, BarChart3, Settings, LayoutDashboard } from "lucide-react";
import { AppShell, type NavGroup } from "./AppShell";

const navGroups: NavGroup[] = [
  {
    title: "OPERATIONS",
    items: [{ name: "Dashboard", href: "/", icon: LayoutDashboard }],
  },
  {
    title: "MAINTENANCE",
    items: [
      { name: "Work Orders", href: "/work-orders", icon: Wrench },
      { name: "Requests", href: "/requests", icon: ClipboardList, badge: "New" },
    ],
  },
  {
    title: "ADMINISTRATION",
    items: [
      { name: "Technicians", href: "/technicians", icon: Users },
      { name: "Reports", href: "/reports", icon: BarChart3 },
      { name: "Settings", href: "/settings", icon: Settings },
    ],
  },
];

<AppShell
  brand={{ name: "MRF", logoUrl: null, fallbackIcon: Wrench }}
  navGroups={navGroups}
  portalLabel="MRF Portal"
  pageTitle="Work Orders"
  user={{ name: "Juan Dela Cruz", roleLabel: "Technician", roleTone: "blue" }}
  schoolYear="2026-2027"
  activePath={window.location.pathname}
  onLogout={() => { /* MRF logout */ }}
  headerActions={null}
>
  {/* MRF page content */}
</AppShell>
```

Adaptation notes:
- If MRF uses a router, replace `<a href>` with the router’s `Link` and feed `activePath` from the router’s location.
- Set `--theme-primary` (and `--theme-primary-rgb`) on `:root` from MRF branding.
- Pass MRF’s notification bell or other icons via `headerActions`; keep them at 20px icons inside `p-2 rounded-xl hover:bg-slate-100 text-slate-600 transition-all active:scale-95` buttons.
- `animate-in fade-in slide-in-from-top-1` on the dropdown container requires `tw-animate-css` (or `tailwindcss-animate`); without it the dropdown still works, just without the entrance animation.

---

## 8. Responsive behavior

| Condition | Behavior |
|---|---|
| Width ≥1024px | Sidebar pinned. Topbar hamburger toggles 280px ↔ 70px. Content padding-left matches (280px/70px) with the same 200ms ease. Collapse state persisted to `localStorage`. |
| Width <1024px | Sidebar is off-canvas (`translateX(-100%)`), always 280px wide. Hamburger opens it; a `rgba(0,0,0,0.5)` backdrop (z-index 40) covers the page and closes it on tap. Content has no left padding. |
| Width <640px | Topbar hides the school-year badge and the name/role text (avatar only). Base font 15px. |

---

## 9. Acceptance criteria (verify each)

- [ ] Sidebar is 280px expanded and 70px collapsed on desktop; off-canvas below 1024px.
- [ ] Collapse animates in 200ms with `cubic-bezier(0.4, 0, 0.2, 1)`; labels fade to `opacity 0, scale 0.9, translateX(-16px)` and collapse to width 0 with no layout jump.
- [ ] Active nav item is a full pill with solid `--theme-primary` background, white text and icon, subtle shadow.
- [ ] Inactive hover is `rgba(255,255,255,0.8)`; no borders on items.
- [ ] Nav icons are 20px with strokeWidth 2.2 inside 24px boxes; nested icons 16px.
- [ ] Group labels are 10px, bold, uppercase, `#0F1729` at 60% opacity, indented 16px.
- [ ] Sidebar background `#fafafa`, 1px right border `#e2e8f0`, `shadow-sm`.
- [ ] Logo header is 96px tall; 48px white tile with 8px radius, 1px `#f1f5f9` border, `shadow-sm`, 4px inner padding; brand name 14px bold uppercase in theme primary, max 160px.
- [ ] Footer profile: 36px avatar (white border, shadow), 12px bold name, 10px bold uppercase role at 50% opacity, logout icon button hovering to red on white.
- [ ] Topbar is 64px, sticky at z-30, frosted (`rgba(255,255,255,0.8)` + 12px blur), 1px bottom border `#e2e8f0`.
- [ ] Topbar left: 20px hamburger in a 12px-radius button (`active:scale-95`), then a two-line stack: 12px uppercase `#64748b` label above a 16px bold `#0f172a` title pulled up 4px.
- [ ] Topbar right: 12px gap between actions; school-year badge 10px bold in an 8px-radius `#f1f5f9` chip; user block separated by a 1px `#f1f5f9` left border with 12px padding; role pill 10px; 36px avatar with 2px `#f1f5f9` ring and 2px offset.
- [ ] Scrollbar inside the sidebar is 4px, transparent track, `#e2e8f0` thumb.
- [ ] DM Sans is the rendered font everywhere in the shell; sidebar hard-sets it.
- [ ] No hardcoded accent colors: changing `--theme-primary` updates active pills, brand name, logo fallback, and teacher-style role pill.
- [ ] Keyboard focus shows a 2px ring using `--ring` with 2px offset.

---

## 10. Banned substitutions

| Don’t | Why |
|---|---|
| `rounded-lg`/`rounded-md` on nav items | They must be full pills. |
| `gray`/`zinc`/`slate` text classes for nav labels | Nav text is `#0F1729` with opacity variants for a warm, branded look. |
| Default Lucide stroke (2) | Nav icons use 2.2. |
| 150ms / 300ms transitions | The shell uses 200ms. |
| Different cubic-bezier | Must be `cubic-bezier(0.4, 0, 0.2, 1)`. |
| `display: none` on collapsing labels | Causes layout jump; use the opacity/scale/translate/width pattern. |
| Full-width square active state | Active state is a pill inset by the 12px nav padding. |
| Hardcoded `#10b981` anywhere | Use `var(--theme-primary)` / `rgba(var(--theme-primary-rgb), α)`. |
| Purple/green gradients, glow, neumorphism | The design is flat, neutral, and utilitarian. |

---

## Appendix A — Computed values (for non-Tailwind stacks)

| Tailwind class | Computed value |
|---|---|
| `w-[280px]` / `lg:w-[70px]` | `width: 280px` / `70px` |
| `h-24` | `height: 96px` |
| `h-16` | `height: 64px` |
| `w-12 h-12` | `48px × 48px` |
| `w-9 h-9` | `36px × 36px` |
| `w-6 h-6` | `24px × 24px` |
| `w-5 h-5` | `20px × 20px` |
| `w-4 h-4` | `16px × 16px` |
| `px-4 py-1.5` | `padding: 6px 16px` |
| `gap-3` / `gap-4` | `12px` / `16px` |
| `rounded-lg` | `8px` |
| `rounded-xl` | `12px` |
| `rounded-md` | `6px` |
| `shadow-sm` (Tailwind) | `0 1px 2px 0 rgb(0 0 0 / 0.05)` |
| `ring-2 ring-offset-2` | `box-shadow: 0 0 0 2px #fff, 0 0 0 4px #f1f5f9` (approx.) |
| `bg-white/80` | `rgba(255,255,255,0.8)` |
| `backdrop-blur-md` | `backdrop-filter: blur(12px)` |
| `opacity-40` | `opacity: 0.4` |
| `text-[0.625rem]` | `10px` |
| `text-xs` / `text-sm` / `text-base` | `12px` / `14px` / `16px` |
| `tracking-tight` / `tracking-wider` / `tracking-normal` | `-0.025em` / `0.05em` / `0em` |
| `-translate-x-4` | `translateX(-16px)` |
| `scale-90` / `scale-[0.85]` / `scale-95` | `0.9` / `0.85` / `0.95` |

---

## Appendix B — Optional extras (design-consistent)

1. **Page backdrop (subtle, recommended).** Fixed, `z-index -10`, pointer-events none:
   - Layer 1: `linear-gradient(to bottom right, #f8fafc 0%, rgba(var(--theme-primary-rgb), 0.08) 50%, rgba(var(--theme-primary-rgb), 0.06) 100%)`
   - Layer 2: inline SVG pattern, 80×80 tile, four 36×36 rounded squares (`rx 2`) with 1.5px `var(--theme-primary)` stroke at 8% container opacity.
2. **Notification bell (topbar action).** Button: `position: relative; padding: 8px; border-radius: 12px; color: #64748b;` hover `background: #f1f5f9`; `active:scale-95`. Unread badge: absolutely positioned top 2px/right 2px, `min-width: 16px; height: 16px; padding: 0 4px; border-radius: 9999px; background: var(--destructive); color: #fff; font-size: 10px; font-weight: 700;` cap display at `9+`.
3. **Status chip (“In Dev”-style).** `display:inline-flex; align-items:center; gap:4px; border-radius:6px; padding:2px 6px; font-size:10px; font-weight:600; text-transform:uppercase;` amber background/text; 6px dot (`6×6px`, `border-radius:9999px`, `opacity:0.8`) using `currentColor`. On an active (primary) pill, switch to `rgba(255,255,255,0.2)` background with `rgba(255,255,255,0.9)` text.
4. **Disabled items.** Non-interactive element, `opacity: 0.4`, `cursor: not-allowed`, `user-select: none`, native `title="Name (Unavailable)"`.
5. **Dropdown groups.** Parent with an active child gets `rgba(var(--theme-primary-rgb), 0.1)` background. Children container: `margin-top: 2px; padding-left: 16px; margin-left: 28px; border-left: 1px solid #f1f5f9;` 2px vertical gap; children are 13px pills with 12px icon-to-label gap. Keep the open/closed state if MRF wants it; otherwise flatten nav items and ignore this section.
