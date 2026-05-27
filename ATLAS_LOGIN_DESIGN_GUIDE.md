# ATLAS Login Design — Reference & Implementation Guide
> Use this as your prompt/instruction to any AI to replicate the ATLAS login design for Teacher, Admin, and Registrar login pages.

---

## 🎨 Design Structure Overview

The ATLAS login is a **two-panel full-screen layout**:

```
┌─────────────────────────────────┬──────────────────────────┐
│                                 │                          │
│   LEFT PANEL (55–60% width)     │  RIGHT PANEL (40–45%)    │
│   Decorative / Branding Side    │  Login Card              │
│   - Primary gradient bg         │  - White/glass card      │
│   - Animated blobs              │  - Logo + title          │
│   - School name + info          │  - Input fields          │
│   - 3 feature cards             │  - Submit button         │
│   - Grid pixel pattern overlay  │                          │
│                                 │                          │
└─────────────────────────────────┴──────────────────────────┘
         Hidden on mobile — full width right panel only
```

---

## 🏗️ Layout Details

### Outer Wrapper
```
h-screen w-full flex overflow-hidden
background: linear-gradient(to bottom right, #f8fafc, primary/8%, accent/6%)
```

### Left Panel (lg:w-[55%] xl:w-3/5) — Hidden on mobile
- **Background:** `linear-gradient(to bottom right, hsl(--primary), hsl(--primary/88%), hsl(--accent/88%))`
- **Animated with:** `login-gradient-shift` keyframe (14s infinite ease)
- **Decorative blobs:** 3 absolutely-positioned blurred circles (`blur-3xl`) with `login-float` animation (9s ease-in-out infinite), each with `animationDelay` offset
- **Grid pattern:** SVG `<pattern>` of 80×80 grid with small rounded rectangles, opacity 8%
- **Radial gradient overlay:** `radial-gradient(circle at center, primary/5% 0%, transparent 70%)`
- **Content:** Left-aligned, `px-12 xl:px-20`, white text, flex column centered vertically

### Right Panel (lg:w-[45%] xl:w-2/5)
- Slightly tinted: `background: hsl(--sidebar-background / 50%)`
- Flex center, `p-4 sm:p-6 lg:p-8`, `overflow-y-auto`
- Contains the login **Card** (max-w-[420px])

---

## 🧩 Left Panel Content Breakdown

### 1. Header (top)
```
Acronym (first 3 words' initials of school name) — text-4xl font-bold
Tagline — text-sm font-bold white
```

### 2. School Info Block
```
School Name — text-3xl xl:text-4xl font-bold
Scope label — "Junior High School (Grades 7-10)" text-sm font-bold
Optional address (MapPin icon + text)
Optional division (Building2 icon + "Division of [name]")
Optional region (Globe icon + text)
Fallback: "DepEd Public School Timetabling..." text
```

### 3. Feature Cards (3 items, grid gap-4)
Each card:
```
Container: flex items-center gap-4 p-4 rounded-2xl bg-white/5 backdrop-blur-sm 
           border border-white/10 hover:bg-white/10 hover:border-white/20
Icon box:  w-12 h-12 rounded-xl bg-white/10 — group-hover:scale-110 transition
Title:     font-bold text-white
Desc:      text-white text-sm font-semibold
```

**Default features shown:**
| Icon | Title | Description |
|---|---|---|
| BookOpen | Preference Collection | Collect faculty time and room preferences before generation. |
| BarChart3 | Automated Generation | Build draft timetables with policy and workload-aware scheduling. |
| Shield | Review and Publish Workflow | Validate violations, resolve conflicts, and publish approved schedules. |

### 4. Bottom Footer (absolute bottom-8 left-12)
```
Shield icon (w-8 h-8 rounded-lg bg-white/10) + project full name text
Color: text-white/50 text-sm
```

---

## 🪪 Login Card (Right Panel)

### Card Wrapper
```
border-0 shadow-2xl shadow-gray-200
bg-white/90 backdrop-blur-xl
rounded-lg overflow-hidden
```

### Card Header
```
space-y-1 text-center pt-5 pb-0 px-6
```

**Logo Circle:**
```
w-14 h-14 mx-auto rounded-full flex items-center justify-center shadow-lg overflow-hidden
IF logo: white bg, border 2px primary/20, shows <img w-10 h-10>
ELSE: gradient bg (primary → accent), boxShadow primary/30, shows <Sparkles w-5 h-5 text-white>
```

**Title:** `"Welcome Back"` — text-xl font-bold text-gray-900 pt-2

**Description:** `"Sign in to continue to "` + `<span class="font-semibold text-primary">ATLAS</span>` — text-gray-600 text-sm

### Card Content (px-6 pb-5 pt-4)

**Error Alert:**
```
p-3 rounded-xl bg-gradient-to-r from-red-50 to-rose-50 border border-red-100
Icon box: w-8 h-8 rounded-lg bg-red-100 → AlertCircle w-4 h-4 text-red-600
Text: text-sm font-bold text-red-700
Animation: login-scale-in (220ms ease-out)
```

**Success Alert:**
```
p-3 rounded-xl border bg-gradient-to-r from-primary/10 to-accent/10 border-primary/25
Icon box: w-8 h-8 rounded-lg bg-primary/15 → CheckCircle w-4 h-4 text-primary
Text: text-sm font-semibold text-primary
Animation: login-scale-in
```

### Form Fields

**Input group structure (both fields):**
```
Outer: space-y-1.5
Label: text-gray-800 font-semibold text-sm pl-1
Input wrapper: relative group
Icon box (left): absolute left-0 top-0 bottom-0 w-11 flex items-center justify-center
  → w-8 h-8 rounded-lg bg-gray-100 group-focus-within:bg-gray-200
  → Icon: w-4 h-4 text-gray-500
Input: pl-12 h-11 bg-gray-50 border-gray-200 hover:border-gray-300
       focus:ring-4 focus:ring-primary/15 rounded-xl
       placeholder:text-gray-400 text-gray-900 font-bold
```

**Field 1 — Employee ID or Email**
- Icon: `<User />`
- Placeholder: "Employee ID or Email"
- autoComplete: "username"

**Field 2 — Password**
- Icon: `<Lock />`
- Placeholder: "Enter your password"
- autoComplete: "current-password"
- Toggle button (right): `absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg`
  - Shows `<Eye />` or `<EyeOff />` based on showPassword state

### Remember Me + Forgot Password Row
```
flex items-center justify-between text-sm
Checkbox: data-[state=checked]:bg-primary data-[state=checked]:border-primary
Label: text-gray-600 group-hover:text-gray-900 font-bold text-sm
Forgot link: font-semibold text-primary hover:underline underline-offset-4 decoration-2
```

### Submit Button
```
w-full h-11 font-semibold text-sm rounded-xl shadow-lg hover:shadow-xl
bg-primary text-primary-foreground hover:bg-primary/90
disabled:opacity-70 disabled:cursor-not-allowed

Loading state: <Loader2 class="animate-spin h-5 w-5" /> + "Signing in..."
Normal state:  <LogIn class="w-5 h-5" /> + "Sign In"
Both wrapped in: flex items-center gap-3
```

### Footer Text
```
text-[10px] text-gray-400 text-center mt-4 leading-relaxed
"By signing in, you agree to our Terms and Privacy Policy"
Links: hover:underline text-primary
```

---

## 🎬 Animations (CSS Keyframes)

```css
@keyframes login-gradient-shift {
  0%   { background-position: 0% 50%; }
  50%  { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
/* Applied to left panel bg: 14s ease infinite, background-size: 200% 200% */

@keyframes login-float {
  0%, 100% { transform: translateY(0px); }
  50%       { transform: translateY(-16px); }
}
/* Applied to decorative blobs: 9s ease-in-out infinite */
/* Blob 2: animationDelay 2s, Blob 3: animationDelay 4s */

@keyframes login-scale-in {
  0%   { opacity: 0; transform: scale(0.98); }
  100% { opacity: 1; transform: scale(1); }
}
/* Applied to alert banners: 220ms ease-out */
```

---

## 🎨 Color Variables Used (Tailwind CSS custom properties)
```
--primary            (main brand color — all buttons, focus rings, accents)
--primary-foreground (button text)
--accent             (secondary brand — gradient end, success alert)
--accent-foreground  (decorative blob color at 18% opacity)
--sidebar-background (right panel tint at 50% opacity)
```

---

## 📋 Icons Used (from lucide-react)
```
AlertCircle, BarChart3, BookOpen, Building2, CheckCircle,
Eye, EyeOff, Globe, Loader2, Lock, LogIn, MapPin,
Shield, Sparkles, User
```

---

## 💬 Exact Prompt to Give Any AI

Copy and paste this to apply this design to your Teacher/Admin/Registrar login pages:

---

> **"Redesign this login page to exactly match the ATLAS login design system described below. Keep all existing form fields, field names, validation logic, API calls, and state management exactly as they are — only change the visual design/layout/styling.**
>
> **Layout:** Two-panel full-screen layout. Left panel (55% width, hidden on mobile) has a primary-colored animated gradient background with floating blurred circle decorations, an SVG grid pixel pattern overlay, the system/role name as a large heading, and 3 feature cards with white/5 background. Right panel (45% width) centers a white/90 backdrop-blur login card (max-w-[420px], shadow-2xl, rounded-lg).
>
> **Card:** Has a logo circle (gradient background with Sparkles icon if no logo), 'Welcome Back' title, subtitle with the system name in primary color, error/success alert banners (scale-in animation), form fields with left-side icon boxes (gray-100 bg, transitions on focus), password toggle button, Remember Me checkbox, Forgot Password link, and a full-width primary-colored submit button.
>
> **Animations:** login-gradient-shift (14s, left panel bg), login-float (9s, decorative blobs with staggered delays), login-scale-in (220ms, alert banners).
>
> **Colors:** Use CSS custom properties -- primary, --accent, --sidebar-background, --primary-foreground throughout.
>
> **Icons from lucide-react:** User, Lock, Eye, EyeOff, Loader2, LogIn, AlertCircle, CheckCircle, Sparkles, Shield (footer), plus role-specific icons for the feature cards."**

---

## 🔧 What to Change Per Role

| Role | Left Panel Title | Feature Card Icons | Feature Card Titles | Card Subtitle |
|---|---|---|---|---|
| **Teacher** | "Teacher Portal" | BookOpen, Calendar, ClipboardList | "My Classes", "Schedule View", "Grade Submission" | "Sign in to your Teacher account" |
| **Admin** | "Admin Portal" | Shield, Settings, BarChart3 | "User Management", "System Settings", "Analytics" | "Sign in to your Admin account" |
| **Registrar** | "Registrar Portal" | FileText, Users, BookOpen | "Enrollment Records", "Student Management", "Reports" | "Sign in to your Registrar account" |

Keep the left panel school name, address, division, and region the same across all three (fetched from branding API/cache).
