# SMART Login Pages — Detailed Design Extraction

**What this is:** the complete visual/interaction spec for SMART's three portal login pages (`LoginPage` = Teacher, `AdminLoginPage`, `RegistrarLoginPage`). All three share one design skeleton; only role labels, badges, feature cards, icons, and copy differ.

**Source files:**
- `src/pages/LoginPage.tsx` — Teacher portal (canonical reference, 391 lines)
- `src/pages/AdminLoginPage.tsx` — Admin portal (394 lines)
- `src/pages/RegistrarLoginPage.tsx` — Registrar portal (393 lines)
- Primitives: `src/components/ui/card.tsx`, `input.tsx`, `label.tsx`, `button.tsx`
- Theme: `src/contexts/ThemeContext.tsx`
- Utilities: `src/index.css` (`login-scale-in` keyframes, pixel-grid styles)

Routes: `/login`, `/login/admin`, `/login/registrar` (all use the same visual language).

---

## 1. Concept

A **split-screen premium login**:

- **Left (55–60%)**: a solid brand-color panel that sells the portal — acronym + role tag, organization name, a vertical stack of glass feature cards, and a footer attribution.
- **Right (40–45%)**: a light, softly gridded canvas holding a single 420px card with the sign-in form.

The whole page is themed at runtime: the brand color comes from school branding (`--theme-primary`), so the left panel, logo medallion, success banner, focus rings, and links all shift together.

---

## 2. Canvas & layout

Root:

```tsx
<div
  className="h-screen w-full flex overflow-hidden bg-slate-50"
  style={{
    backgroundImage:
      'linear-gradient(to bottom right, #f8fafc 0%, rgba(var(--theme-primary-rgb), 0.08) 50%, rgba(var(--theme-primary-rgb), 0.06) 100%)',
    '--primary': 'var(--theme-primary)',
    '--accent': 'var(--theme-accent)',
  } as React.CSSProperties}
>
```

| Property | Value |
|---|---|
| Height | Full viewport (`h-screen`), no page scroll (`overflow-hidden`) |
| Base background | `#f8fafc` (slate-50) |
| Gradient overlay | Slate → 8% primary at 50% → 6% primary at bottom-right |
| Theme mapping | `--primary` is remapped to `--theme-primary` so `bg-primary`, `text-primary`, `ring-primary` inside the page follow branding |
| Brand panel width | 55% (`lg`), 60% on `xl` |
| Form panel width | 45% (`lg`), 40% (`xl`); full width below `lg` |
| Form panel padding | 16px → 24px (`sm`) → 32px (`lg`) |
| Form column width | 420px (`max-w-[420px]`), vertically centered, scrolls if short |

---

## 3. Left panel — branding

Container:

```
hidden lg:flex lg:w-[55%] xl:w-3/5 relative overflow-hidden bg-primary shrink-0
```

- A full-bleed solid layer behind everything: `<div className="absolute inset-0" style={{ background: "var(--theme-primary)" }} />` — this is what guarantees an exact brand fill regardless of Tailwind color steps.
- Content column: `relative z-10 flex flex-col justify-center py-12 xl:py-16 px-12 xl:px-20 text-white w-full h-full`.

### 3.1 Brand header (acronym + role tag)

```
row:       flex items-center gap-4 mb-6
acronym:   text-4xl font-bold tracking-tight text-white
role tag:  px-2 py-0.5 text-xs font-bold rounded text-white shadow-sm
subtitle:  text-white text-sm font-bold max-w-md
```

Role tag colors:

| Portal | Badge text | Class | Notes |
|---|---|---|---|
| Teacher | *(none)* | — | Teacher page shows only the acronym + subtitle |
| Admin | `ADMIN` | `bg-amber-500` | Amber signals restricted access |
| Registrar | `REGISTRAR` | `bg-emerald-500` | Emerald (SMART default accent) |

Portal subtitles:

| Portal | Subtitle |
|---|---|
| Teacher | `Student Management and Records Tracking` |
| Admin | `System Administration Portal` |
| Registrar | `Registrar's Portal` |

### 3.2 Organization block

```
h2:       text-3xl xl:text-4xl font-bold leading-tight tracking-tight text-white
line 1:   <schoolName> (from ThemeContext)
line 2:   text-white text-sm font-bold      → "Junior High School (Grades 7-10)"
line 3:   text-white text-sm font-bold      → "DepEd Public School Student Management and Records Tracking Portal"
spacing:  space-y-3 mb-6; extra mt-3 on the detail block
```

### 3.3 Feature cards (glass list)

Four cards, stacked `grid gap-2.5 max-w-xl`:

```
card:      flex items-center gap-3 p-3 rounded-2xl bg-white/5 backdrop-blur-sm
           border border-white/10
           hover:bg-white/10 hover:border-white/20
           group transition-all duration-300
icon well: w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center
           group-hover:scale-110 transition-transform flex-shrink-0
icon:      w-5 h-5 text-white
title:     font-bold text-white
desc:      text-white text-sm font-semibold
```

Feature content per portal:

| Portal | Cards (icon · title · description) |
|---|---|
| Teacher | `ClipboardList` Class Records · Manage and input student grades<br>`Users2` Advisory Class · Monitor your advisee's progress<br>`TrendingUp` Grade Analytics · Track student performance trends<br>`BookOpen` DepEd-Compliant · K-12 curriculum aligned |
| Admin | `Users` User Management · Complete control over system access<br>`Settings` System Configuration · Customize grading and policies<br>`Database` Audit Logs · Track all system activities<br>`Activity` Analytics Dashboard · Monitor system performance |
| Registrar | `UserCheck` Student Records · Manage enrollment and student data<br>`FileText` School Forms · Generate official documents<br>`FolderOpen` Document Management · Organize academic records<br>`ClipboardCheck` Enrollment Processing · Handle student registrations |

### 3.4 Footer attribution

```
container: absolute bottom-8 left-12 xl:left-20 flex items-center gap-3 text-white/50 text-sm
icon well: w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0
icon:      w-4 h-4 text-white
```

| Portal | Icon | Text |
|---|---|---|
| Teacher | `BookOpen` | `Teacher Portal • Academic Excellence` |
| Admin | `Shield` | `Administrative Access • Restricted Portal` |
| Registrar | `FileText` | `Registrar Office • Records Management` |

---

## 4. Right panel — form side

### 4.1 Pixel-grid overlay

Absolute, `pointer-events-none`, behind the card (`aria-hidden`):

```
svg:     absolute inset-0 h-full w-full opacity-[0.08]
pattern: id="login-pixel-grid" x=0 y=0 width=80 height=80 patternUnits="userSpaceOnUse"
tiles:   four 36×36 rounded squares (rx 2), no fill, stroke var(--theme-primary), strokeWidth 1.5,
         placed at (2,2) (42,2) (2,42) (42,42)
```

### 4.2 Mobile brand row (below `lg`)

```
row:       lg:hidden flex items-center justify-center gap-3 mb-6
logo tile: w-12 h-12 rounded-full shadow-lg overflow-hidden bg-white border border-slate-200
           (image object-cover, or GraduationCap w-7 h-7 in theme primary)
acronym:   text-xl font-bold text-slate-900
role tag:  (Admin/Registrar only) px-2 py-0.5 text-xs font-bold rounded text-white
           Admin bg-amber-500 · Registrar bg-emerald-500
org name:  text-xs text-slate-500
```

### 4.3 Login card

```
Card:        border border-black/[0.06] rounded-2xl overflow-hidden
             bg-white/95 backdrop-blur-xl
             shadow-[0_20px_25px_-5px_rgba(0,0,0,0.05),0_8px_10px_-6px_rgba(0,0,0,0.03)]
CardHeader:  space-y-1 text-center pt-8 pb-3 px-8 bg-transparent border-b-0
CardContent: px-8 pb-8 pt-4
```

**(a) Logo medallion** — 56px circle, centered:

```
w-14 h-14 mx-auto rounded-full flex items-center justify-center shadow-lg overflow-hidden

logo present:  background white; border 2px solid rgba(var(--theme-primary-rgb), 0.2)
logo absent:   background var(--theme-primary); no border
glow (always): box-shadow 0 10px 15px -3px rgba(var(--theme-primary-rgb), 0.3)
content:       <img w-10 h-10 object-cover> or Sparkles w-5 h-5 text-white
```

**(b) Titles**

```
Title:        text-2xl font-bold text-slate-900 tracking-tight pt-2   → "Welcome Back"
Description:  text-slate-500 text-sm font-normal mt-1 leading-relaxed
              "Sign in to your <Role> account to manage <span class="font-semibold text-primary">SMART</span>"
```

| Portal | Description |
|---|---|
| Teacher | `Sign in to your Teacher account to manage classes at SMART` |
| Admin | `Sign in to your Admin account to manage SMART` |
| Registrar | `Sign in to your Registrar account to manage SMART` |

---

## 5. Alert banners

**Error** (server message or `Unable to connect to server. Please try again.`):

```
mb-4 p-3 rounded-xl bg-red-50 border border-red-100 login-scale-in
inner:     flex items-center gap-2.5
icon well: w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center flex-shrink-0
icon:      AlertCircle w-4 h-4 text-red-600
text:      text-sm font-bold text-red-700
```

**Success** (shown ~1s before redirect):

```
mb-4 p-3 rounded-xl border flex items-center gap-2.5 login-scale-in
           bg-primary/10 border-primary/25
icon well: w-8 h-8 rounded-lg bg-primary/15, CheckCircle w-4 h-4 text-primary
title:     text-sm font-semibold text-primary
sub:       text-xs text-slate-500
```

| Portal | Success title | Success sub |
|---|---|---|
| Teacher | `Welcome back!` | `Loading your classes...` |
| Admin | `Admin access granted!` | `Redirecting to dashboard...` |
| Registrar | `Access granted!` | `Loading registrar tools...` |

Typing in either field clears the error banner (`if (error) setError(null)`).

---

## 6. Fields

Each field: `space-y-1.5` wrapper, label, then a `relative group` with an icon well.

**Label:** `text-sm font-medium text-slate-700 pl-1`

**Icon well** (absolutely positioned, non-interactive):

```
absolute left-0 top-0 bottom-0 w-11 flex items-center justify-center pointer-events-none z-10
inner: w-8 h-8 rounded-lg bg-slate-100 group-focus-within:bg-slate-200
       flex items-center justify-center transition-colors duration-200
icon:  User / Lock, w-4 h-4 text-slate-400 transition-colors duration-200
```

**Input** (Employee ID or Email / Password):

```
pl-12 h-11 bg-white border-slate-300 rounded-xl text-sm font-medium text-slate-800
placeholder:text-slate-400
hover:border-slate-400
focus:outline-none focus:border-red-700 focus:ring-2 focus:ring-red-100
transition-all duration-200
```

Notes / legacy inconsistency:
- The focus recipe (`red-700` border + `red-100` ring) is a leftover from the original maroon theme and does **not** follow `--theme-primary`. Canonical correction: `focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50` (or `focus:ring-2 focus:ring-[var(--theme-primary)]/20 focus:border-[var(--theme-primary)]`). Flag this when reusing.
- Text fields use `autoComplete="username"` / `"current-password"`, and are `required`.
- Typing clears the error banner.

**Password reveal:**

```
absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg
text-slate-400 hover:text-slate-600 hover:bg-slate-100
transition-all duration-200, tabIndex={-1}
icon: Eye / EyeOff w-4 h-4
```

Accessibility gap to fix when reusing: the reveal button has no `aria-label` — add `aria-label="Show password"` / `"Hide password"` and drop `tabIndex={-1}` if keyboard access is desired.

---

## 7. Meta row (remember / contact)

```
row:       flex items-center justify-between text-sm py-1
left:      label cursor-pointer group, gap-2
checkbox:  sr-only native input + peer
box:       w-4 h-4 rounded border border-slate-300 bg-white
           peer-checked:bg-primary peer-checked:border-primary
           flex items-center justify-center transition-all duration-150
check svg: w-2.5 h-2.5 text-white opacity-0 peer-checked:opacity-100
           transition-opacity duration-150 (3.5 stroke check path)
text:      text-slate-600 group-hover:text-slate-900 font-medium text-sm select-none
right:     text-xs font-medium text-muted-foreground select-none → "Contact System Admin"
```

Note: the checkbox is decorative in all three pages (state is not read) — wire it if persistence is expected.

---

## 8. Submit button

```
w-full py-3 font-semibold text-sm rounded-xl
bg-primary text-primary-foreground
hover:opacity-95 hover:shadow-lg hover:shadow-red-900/20
active:scale-[0.99] transition-all duration-200
disabled:opacity-70 disabled:cursor-not-allowed
```

- Height ≈ 44px (`py-3` + 14px text).
- Idle content: 20px icon + `Sign In`, 12px gap (`gap-3`).
- Busy content: `Loader2` 20px `animate-spin` + busy label; button disabled.
- `hover:shadow-red-900/20` is another maroon-theme leftover — replace with `hover:shadow-lg` (theme-agnostic) or a primary-tinted shadow.

| Portal | Idle icon | Busy label |
|---|---|---|
| Teacher | `LogIn` | `Signing in...` |
| Admin | `Shield` | `Verifying credentials...` |
| Registrar | `LogIn` | `Signing in...` |

---

## 9. Legal footer

```
text-[11px] text-slate-400 text-center mt-4 leading-relaxed
links: text-primary hover:underline → Terms / Privacy Policy
```

---

## 10. Behavior notes

- `returnUrl` query param: if present and safe (starts with `/` but not `//`), the login resumes SSO afterwards and the portal gate in the API call is skipped; otherwise the page sends `portal: "TEACHER" | "ADMIN" | "REGISTRAR"`.
- Session storage keys are per role: `user_<role>`, `token_<role>`, `refreshToken_<role>` (plus legacy `user`/`token`).
- Redirect after success: `/teacher`, `/admin`, `/registrar` after a 1000ms delay.
- Errors: server `message` when available, otherwise `Unable to connect to server. Please try again.`

---

## 11. Motion

| Element | Animation |
|---|---|
| Alert banners | `login-scale-in` — opacity 0→1, scale 0.98→1, **220ms ease-out** |
| Card | No entrance animation (static) |
| Field focus | color + ring transition 200ms |
| Icon well | background 200ms on focus-within |
| Feature card hover | background/border 300ms; icon scales to 1.1 |
| Submit press | scale 0.99, 200ms |
| Spinner | `animate-spin` |

The `.login-scale-in` class is declared **inline per page** in a `<style>` tag. When reusing, move it to global CSS once (SMART's `index.css` already defines a matching `login-scale-in` keyframe and `.animate-login-scale-in` utility).

---

## 12. Responsive

| Breakpoint | Behavior |
|---|---|
| `< 640px` | Form panel 16px padding; mobile brand row visible; card full width up to 420px |
| `640–1023px` | Form padding 24px; brand panel still hidden; mobile brand row visible |
| `≥ 1024px` (`lg`) | Brand panel appears (55%); form panel 45%, padding 32px; mobile brand row hidden |
| `≥ 1280px` (`xl`) | Brand panel 60%; form panel 40%; brand panel padding `px-20 py-16` |
| Short viewports | Form panel scrolls (`overflow-y-auto`); brand panel content vertically centered |

---

## 13. Color & typography tokens

| Token | Value |
|---|---|
| Brand fill | `var(--theme-primary)` (default `#10b981`) |
| Brand alpha | `rgba(var(--theme-primary-rgb), α)` — used for glow (0.3), logo border (0.2), page gradient (0.08/0.06) |
| Panel text | White; secondary lines white with 50% opacity (footer) |
| Glass surfaces | `rgba(255,255,255,0.05)` default, `0.10` hover; borders `white/10` → `white/20` |
| Canvas | `#f8fafc` base |
| Card | `rgba(255,255,255,0.95)` + 12px blur, border `black/[0.06]` |
| Text on light | Title `slate-900`; body `slate-500/600`; labels `slate-700`; legal `slate-400` |
| Borders/inputs | `slate-300` (input), `slate-200` (mobile logo tile) |
| Error | `red-50` bg, `red-100` border, `red-600` icon, `red-700` text |
| Success | primary at 10% bg / 25% border / 15% icon well |
| Font | DM Sans (global), 16px base; titles as sized above |
| Radii | card + inputs + button 16px (`rounded-2xl` card, `rounded-xl` controls), icon wells 8–12px, medallion/mobile logo full |

Icons: `lucide-react`, 16px inside field wells, 20px feature/submit icons, 28px fallback logo, default stroke.

---

## 14. Per-role delta summary

| Element | Teacher | Admin | Registrar |
|---|---|---|---|
| Role badge | — | `ADMIN` amber-500 | `REGISTRAR` emerald-500 |
| Subtitle | Student Management and Records Tracking | System Administration Portal | Registrar's Portal |
| Features | Class Records / Advisory Class / Grade Analytics / DepEd-Compliant | User Management / System Configuration / Audit Logs / Analytics Dashboard | Student Records / School Forms / Document Management / Enrollment Processing |
| Footer icon+text | BookOpen · Teacher Portal • Academic Excellence | Shield · Administrative Access • Restricted Portal | FileText · Registrar Office • Records Management |
| Submit idle icon | LogIn | Shield | LogIn |
| Busy label | Signing in... | Verifying credentials... | Signing in... |
| Success copy | Welcome back! / Loading your classes... | Admin access granted! / Redirecting to dashboard... | Access granted! / Loading registrar tools... |
| Redirect | `/teacher` | `/admin` | `/registrar` |

Everything else (canvas, panel, card, medallion, fields, banners, button, motion) is byte-identical.

---

## 15. Reference implementation (Teacher page — canonical)

```tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Eye, EyeOff, LogIn, User, Lock, AlertCircle, CheckCircle,
  GraduationCap, BookOpen, ClipboardList, Sparkles, Loader2, Users2, TrendingUp,
} from "lucide-react";
import axios from "axios";
import { useTheme } from "@/contexts/ThemeContext";
import { SERVER_URL } from "@/lib/api";

const API_URL = "/api";

interface LoginResponse {
  message: string;
  token: string;
  refreshToken?: string;
  user: {
    id: string;
    username: string;
    role: "TEACHER" | "ADMIN" | "REGISTRAR";
    firstName?: string;
    lastName?: string;
    email?: string;
  };
}

export default function LoginPage() {
  const navigate = useNavigate();
  const { logoUrl, schoolName } = useTheme();
  const acronym = "SMART";
  const fullLogoUrl = logoUrl ? (logoUrl.startsWith("http") ? logoUrl : `${SERVER_URL}${logoUrl}`) : null;
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<LoginResponse | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const rawReturnUrl = new URLSearchParams(window.location.search).get("returnUrl");
      const safeReturnUrl = rawReturnUrl && rawReturnUrl.startsWith("/") && !rawReturnUrl.startsWith("//")
        ? rawReturnUrl
        : null;

      const response = await axios.post<LoginResponse>(`${API_URL}/auth/login`, {
        email,
        password,
        ...(safeReturnUrl ? {} : { portal: "TEACHER" }),
      });

      const userRole = response.data.user.role === "ADMIN" ? "admin" : response.data.user.role === "REGISTRAR" ? "registrar" : "teacher";
      sessionStorage.setItem(`user_${userRole}`, JSON.stringify(response.data.user));
      sessionStorage.setItem(`token_${userRole}`, response.data.token);
      if (response.data.refreshToken) {
        sessionStorage.setItem(`refreshToken_${userRole}`, response.data.refreshToken);
      }
      sessionStorage.setItem("user", JSON.stringify(response.data.user));
      sessionStorage.setItem("token", response.data.token);

      setSuccess(response.data);

      if (safeReturnUrl) {
        navigate(safeReturnUrl, { replace: true });
        return;
      }

      setTimeout(() => {
        navigate("/teacher");
      }, 1000);
    } catch (err) {
      if (axios.isAxiosError(err) && err.response) {
        const data = err.response.data as { message?: string } | undefined;
        setError(data?.message || "Login failed");
      } else {
        setError("Unable to connect to server. Please try again.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="h-screen w-full flex overflow-hidden bg-slate-50"
      style={{
        backgroundImage:
          'linear-gradient(to bottom right, #f8fafc 0%, rgba(var(--theme-primary-rgb), 0.08) 50%, rgba(var(--theme-primary-rgb), 0.06) 100%)',
        '--primary': 'var(--theme-primary)',
        '--accent': 'var(--theme-accent)'
      } as React.CSSProperties}
    >
      <style>{`
        .login-scale-in {
          animation: login-scale-in 220ms ease-out forwards;
        }
      `}</style>

      {/* Left Panel - Branding */}
      <div className="hidden lg:flex lg:w-[55%] xl:w-3/5 relative overflow-hidden bg-primary shrink-0">
        <div className="absolute inset-0" style={{ background: 'var(--theme-primary)' }} />

        <div className="relative z-10 flex flex-col justify-center py-12 xl:py-16 px-12 xl:px-20 text-white w-full h-full">
          <div className="flex items-center gap-4 mb-6">
            <div>
              <h1 className="text-4xl font-bold tracking-tight text-white font-sans">{acronym}</h1>
              <p className="text-white text-sm font-bold max-w-md font-sans">Student Management and Records Tracking</p>
            </div>
          </div>

          <div className="space-y-3 mb-6">
            <h2 className="text-3xl xl:text-4xl font-bold leading-tight tracking-tight text-white font-sans">
              {schoolName}
            </h2>
            <p className="text-white text-sm font-bold font-sans">Junior High School (Grades 7-10)</p>
            <div className="flex flex-col gap-1.5 mt-3">
              <p className="text-white text-sm font-bold font-sans">
                DepEd Public School Student Management and Records Tracking Portal
              </p>
            </div>
          </div>

          <div className="grid gap-2.5 max-w-xl">
            {[
              { icon: ClipboardList, title: "Class Records", desc: "Manage and input student grades" },
              { icon: Users2, title: "Advisory Class", desc: "Monitor your advisee's progress" },
              { icon: TrendingUp, title: "Grade Analytics", desc: "Track student performance trends" },
              { icon: BookOpen, title: "DepEd-Compliant", desc: "K-12 curriculum aligned" }
            ].map((feature, i) => (
              <div
                key={i}
                className="flex items-center gap-3 p-3 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10 hover:bg-white/10 hover:border-white/20 group transition-all duration-300"
              >
                <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center group-hover:scale-110 transition-transform flex-shrink-0">
                  <feature.icon className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="font-bold text-white font-sans">{feature.title}</h3>
                  <p className="text-white text-sm font-semibold font-sans">{feature.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="absolute bottom-8 left-12 xl:left-20 flex items-center gap-3 text-white/50 text-sm">
          <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
            <BookOpen className="w-4 h-4 text-white" />
          </div>
          <span className="font-sans">Teacher Portal • Academic Excellence</span>
        </div>
      </div>

      {/* Right Panel - Login Form */}
      <div className="relative w-full lg:w-[45%] xl:w-2/5 flex items-center justify-center p-4 sm:p-6 lg:p-8 overflow-y-auto">
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          <svg className="absolute inset-0 h-full w-full opacity-[0.08]" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="login-pixel-grid" x="0" y="0" width="80" height="80" patternUnits="userSpaceOnUse">
                <rect x="2" y="2" width="36" height="36" rx="2" fill="none" stroke="var(--theme-primary)" strokeWidth="1.5" />
                <rect x="42" y="2" width="36" height="36" rx="2" fill="none" stroke="var(--theme-primary)" strokeWidth="1.5" />
                <rect x="2" y="42" width="36" height="36" rx="2" fill="none" stroke="var(--theme-primary)" strokeWidth="1.5" />
                <rect x="42" y="42" width="36" height="36" rx="2" fill="none" stroke="var(--theme-primary)" strokeWidth="1.5" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#login-pixel-grid)" />
          </svg>
        </div>

        <div className="relative z-10 w-full max-w-[420px]">
          <div className="lg:hidden flex items-center justify-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-full flex items-center justify-center shadow-lg overflow-hidden bg-white border border-slate-200">
              {fullLogoUrl ? (
                <img src={fullLogoUrl} alt={schoolName} className="w-full h-full object-cover" />
              ) : (
                <GraduationCap className="w-7 h-7 text-[var(--theme-primary)]" />
              )}
            </div>
            <div>
              <span className="text-xl font-bold text-slate-900">{acronym}</span>
              <p className="text-xs text-slate-500">{schoolName}</p>
            </div>
          </div>

          <Card className="border border-black/[0.06] shadow-[0_20px_25px_-5px_rgba(0,0,0,0.05),0_8px_10px_-6px_rgba(0,0,0,0.03)] bg-white/95 rounded-2xl overflow-hidden">
            <CardHeader className="space-y-1 text-center pt-8 pb-3 px-8 bg-transparent border-b-0">
              <div
                className="w-14 h-14 mx-auto rounded-full flex items-center justify-center shadow-lg overflow-hidden"
                style={{
                  background: fullLogoUrl ? 'white' : 'var(--theme-primary)',
                  boxShadow: '0 10px 15px -3px rgba(var(--theme-primary-rgb), 0.3)',
                  border: fullLogoUrl ? '2px solid rgba(var(--theme-primary-rgb), 0.2)' : 'none',
                }}
              >
                {fullLogoUrl ? (
                  <img src={fullLogoUrl} alt={schoolName} className="w-10 h-10 object-cover" />
                ) : (
                  <Sparkles className="w-5 h-5 text-white" />
                )}
              </div>
              <CardTitle className="text-2xl font-bold text-slate-900 tracking-tight pt-2">
                Welcome Back
              </CardTitle>
              <CardDescription className="text-slate-500 text-sm font-normal mt-1 leading-relaxed">
                Sign in to your Teacher account to manage classes at <span className="font-semibold text-primary">{acronym}</span>
              </CardDescription>
            </CardHeader>

            <CardContent className="px-8 pb-8 pt-4">
              {error && (
                <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-100 login-scale-in">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center flex-shrink-0">
                      <AlertCircle className="w-4 h-4 text-red-600" />
                    </div>
                    <span className="text-sm font-bold text-red-700">{error}</span>
                  </div>
                </div>
              )}

              {success && (
                <div className="mb-4 p-3 rounded-xl border flex items-center gap-2.5 login-scale-in bg-primary/10 border-primary/25">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-primary/15">
                    <CheckCircle className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-primary">Welcome back!</p>
                    <p className="text-xs text-slate-500">Loading your classes...</p>
                  </div>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-sm font-medium text-slate-700 pl-1">
                    Employee ID or Email
                  </Label>
                  <div className="relative group">
                    <div className="absolute left-0 top-0 bottom-0 w-11 flex items-center justify-center pointer-events-none z-10">
                      <div className="w-8 h-8 rounded-lg bg-slate-100 group-focus-within:bg-slate-200 flex items-center justify-center transition-colors duration-200">
                        <User className="w-4 h-4 text-slate-400 transition-colors duration-200" />
                      </div>
                    </div>
                    <Input
                      id="email"
                      type="text"
                      placeholder="Employee ID or Email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        if (error) setError(null);
                      }}
                      className="pl-12 h-11 bg-white border-slate-300 hover:border-slate-400 focus:border-red-700 focus:ring-2 focus:ring-red-100 focus:outline-none rounded-xl transition-all duration-200 placeholder:text-slate-400 text-slate-800 text-sm font-medium"
                      autoComplete="username"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="password" className="text-sm font-medium text-slate-700 pl-1">
                    Password
                  </Label>
                  <div className="relative group">
                    <div className="absolute left-0 top-0 bottom-0 w-11 flex items-center justify-center pointer-events-none z-10">
                      <div className="w-8 h-8 rounded-lg bg-slate-100 group-focus-within:bg-slate-200 flex items-center justify-center transition-colors duration-200">
                        <Lock className="w-4 h-4 text-slate-400 transition-colors duration-200" />
                      </div>
                    </div>
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        if (error) setError(null);
                      }}
                      className="pl-12 pr-11 h-11 bg-white border-slate-300 hover:border-slate-400 focus:border-red-700 focus:ring-2 focus:ring-red-100 focus:outline-none rounded-xl transition-all duration-200 placeholder:text-slate-400 text-slate-800 text-sm font-medium"
                      autoComplete="current-password"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all duration-200"
                      tabIndex={-1}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between text-sm py-1">
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <div className="relative flex items-center justify-center">
                      <input type="checkbox" className="peer sr-only" />
                      <div className="w-4 h-4 rounded border border-slate-300 bg-white peer-checked:bg-primary peer-checked:border-primary flex items-center justify-center transition-all duration-150">
                        <svg className="w-2.5 h-2.5 text-white opacity-0 peer-checked:opacity-100 transition-opacity duration-150" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    </div>
                    <span className="text-slate-600 group-hover:text-slate-900 transition-colors font-medium text-sm select-none">Remember me</span>
                  </label>
                  <span className="text-xs font-medium text-muted-foreground select-none">
                    Contact System Admin
                  </span>
                </div>

                <Button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-3 font-semibold text-sm rounded-xl bg-primary text-primary-foreground hover:opacity-95 hover:shadow-lg hover:shadow-red-900/20 active:scale-[0.99] transition-all duration-200 disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {isLoading ? (
                    <span className="flex items-center gap-3">
                      <Loader2 className="animate-spin h-5 w-5" />
                      Signing in...
                    </span>
                  ) : (
                    <span className="flex items-center gap-3">
                      <LogIn className="w-5 h-5" />
                      Sign In
                    </span>
                  )}
                </Button>
              </form>

              <p className="text-[11px] text-slate-400 text-center mt-4 leading-relaxed">
                By signing in, you agree to our{' '}
                <a href="#" className="hover:underline text-primary">Terms</a>
                {' '}and{' '}
                <a href="#" className="hover:underline text-primary">Privacy Policy</a>
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
```

To build Admin or Registrar variants, replace only the §14 delta items.

---

## 16. Acceptance checklist

- [ ] Full-viewport layout: `h-screen`, no outer scroll, slate base with the primary-tinted diagonal gradient.
- [ ] Brand panel is genuinely solid `var(--theme-primary)` (separate absolute fill layer), hidden below 1024px, 55% wide (60% on xl).
- [ ] Acronym is 36px bold; role badge (Admin amber / Registrar emerald) is 12px bold padded 8px/2px with 4px radius; teacher has no badge.
- [ ] Organization name is 30–36px bold with 24px tight tracking, followed by two 14px bold white lines.
- [ ] Four glass feature cards: 12px padding, 16px radius, `white/5` → `white/10` on hover, 1px white/10 border, 40px icon well with a 1.1 scale on hover, 16px title/14px description.
- [ ] Footer attribution is absolutely bottom-left (32px up, 48–80px in), 14px at 50% white with a 32px tinted icon well.
- [ ] Form panel centers a 420px column; mobile brand row shows a 48px round logo + acronym + org name below 1024px.
- [ ] Login card: 24px radius, `white/95` + 12px blur, hairline black/6% border, layered 20/25px shadow, 32px header padding, no header border.
- [ ] Logo medallion: 56px circle, primary fill or white-with-tinted-border when a logo exists, primary glow shadow, 20px Sparkles fallback.
- [ ] Title is 24px bold slate-900; description 14px slate-500 with the acronym emphasized in theme primary.
- [ ] Error banner: 12px padding, 12px radius, red-50/red-100/red-600/red-700 with a 32px icon well, animated 220ms scale-in.
- [ ] Success banner: primary 10% bg / 25% border with a CheckCircle in a 15% primary well; per-role title and sub-copy.
- [ ] Fields: 44px tall, 16px radius, 12px left padding for the icon well, 32px slate-100 well that darkens on focus-within, 16px muted icons.
- [ ] Password field has the Eye/EyeOff reveal button at the right with hover feedback (add `aria-label`).
- [ ] Meta row shows the 16px custom checkbox (primary fill when checked) and the muted "Contact System Admin" text.
- [ ] Submit is a 44px full-width primary button; busy state swaps in a 20px spinner + role-specific label and disables the button.
- [ ] Legal footer is 11px slate-400 centered, links in theme primary with underline on hover.
- [ ] Changing the branding primary updates panel, medallion, success banner, checkbox, links, and submit with no code changes.
- [ ] Known legacy fixes applied if reused: theme-aware focus ring instead of `red-700`/`red-100`; remove `shadow-red-900/20`; move `.login-scale-in` to global CSS; add `aria-label` to the reveal button.
