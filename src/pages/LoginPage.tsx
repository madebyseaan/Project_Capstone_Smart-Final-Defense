import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff, LogIn, User, Lock, AlertCircle, CheckCircle, BookOpen, ClipboardList, Sparkles, Loader2, Users2, TrendingUp } from "lucide-react";
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
      // A pending SSO authorize request is role-agnostic — only then skip the portal gate.
      const rawReturnUrl = new URLSearchParams(window.location.search).get("returnUrl");
      const safeReturnUrl = rawReturnUrl && rawReturnUrl.startsWith("/") && !rawReturnUrl.startsWith("//")
        ? rawReturnUrl
        : null;

      const response = await axios.post<LoginResponse>(`${API_URL}/auth/login`, {
        email,
        password,
        ...(safeReturnUrl ? {} : { portal: "TEACHER" }),
      });

      // Store in role-specific keys so multiple users can be logged in simultaneously
      const userRole = response.data.user.role === "ADMIN" ? "admin" : response.data.user.role === "REGISTRAR" ? "registrar" : "teacher";
      sessionStorage.setItem(`user_${userRole}`, JSON.stringify(response.data.user));
      sessionStorage.setItem(`token_${userRole}`, response.data.token);
      if (response.data.refreshToken) {
        sessionStorage.setItem(`refreshToken_${userRole}`, response.data.refreshToken);
      }
      // Also set legacy keys for backward compatibility
      sessionStorage.setItem("user", JSON.stringify(response.data.user));
      sessionStorage.setItem("token", response.data.token);

      setSuccess(response.data);

      // Resume an SSO authorize request if login was required first
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
      className="min-h-dvh w-full flex bg-background lg:h-screen lg:overflow-hidden"
      style={{
        backgroundImage:
          'linear-gradient(to bottom right, #f8fafc 0%, rgba(var(--theme-primary-rgb), 0.08) 50%, rgba(var(--theme-primary-rgb), 0.06) 100%)',
        '--primary': 'var(--theme-primary)',
        '--accent': 'var(--theme-accent)'
      } as React.CSSProperties}
    >
      {/* Left Panel - Branding */}
      <div className="hidden lg:flex lg:w-[55%] xl:w-3/5 relative overflow-hidden bg-primary shrink-0">
        {/* Solid brand background */}
        <div
          className="absolute inset-0"
          style={{
            background: 'var(--theme-primary)',
          }}
        />

        <div className="relative z-10 flex flex-col justify-center py-12 xl:py-16 px-12 xl:px-20 text-white w-full h-full">
          <div className="w-full">
            {/* School header */}
            <h2 className="text-lg xl:text-xl font-bold uppercase tracking-[0.08em] text-white font-sans">
              {schoolName}
            </h2>
            <p className="mt-1.5 text-sm xl:text-base font-medium text-white/75 font-sans">
              Student Management and Records Tracking System
            </p>

            {/* Acronym + portal subtitle */}
            <h1 className="mt-9 xl:mt-12 text-6xl xl:text-[64px] font-bold tracking-tight text-white font-sans">
              {acronym}
            </h1>
            <p className="mt-4 xl:mt-5 text-base xl:text-xl font-medium text-white/85 font-sans">
              DepEd Junior High School (Grades 7-10) Management and Records Portal
            </p>

            {/* Teacher-specific Feature cards */}
            <div className="mt-9 xl:mt-12 grid gap-3 xl:gap-3.5">
              {[
                { icon: ClipboardList, title: "Class Records", desc: "Manage and input student grades" },
                { icon: Users2, title: "Advisory Class", desc: "Monitor your advisee's progress" },
                { icon: TrendingUp, title: "Grade Analytics", desc: "Track student performance trends" },
                { icon: BookOpen, title: "DepEd-Compliant", desc: "K-12 curriculum aligned" }
              ].map((feature, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 xl:gap-4 p-4 xl:p-5 rounded-2xl bg-white/[0.07] backdrop-blur-sm border border-white/10 hover:bg-white/10 hover:border-white/20 group transition-all duration-300"
                >
                  <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center group-hover:scale-105 transition-transform flex-shrink-0">
                    <feature.icon className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h3 className="text-base xl:text-lg font-bold text-white font-sans">{feature.title}</h3>
                    <p className="text-sm xl:text-[15px] font-normal text-white/75 font-sans">{feature.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>

      {/* Right Panel - Login Form */}
      <div
        className="relative w-full lg:w-[45%] xl:w-2/5 flex items-center justify-center px-5 py-8 sm:px-6 lg:p-8 lg:overflow-y-auto"
      >
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          <svg
            className="absolute inset-0 h-full w-full opacity-[0.08]"
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              <pattern
                id="login-pixel-grid"
                x="0"
                y="0"
                width="80"
                height="80"
                patternUnits="userSpaceOnUse"
              >
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
          {/* Login card with premium styling */}
          <Card className="border border-border/60 shadow-[0_24px_48px_-16px_rgba(15,23,42,0.18)] bg-card rounded-3xl overflow-hidden">
            <CardHeader className="text-left px-5 pt-6 pb-0 sm:px-7 lg:pt-7 bg-transparent border-b-0">
              <div className="flex items-center gap-3">
                <div className="flex shrink-0 items-center justify-center w-12 h-12 lg:w-14 lg:h-14 rounded-2xl overflow-hidden bg-card border border-border shadow-sm p-1">
                  {fullLogoUrl ? (
                    <img src={fullLogoUrl} alt={schoolName} className="w-full h-full object-contain" />
                  ) : (
                    <Sparkles className="w-5 h-5 text-primary" />
                  )}
                </div>
                <div className="min-w-0">
                  <span className="block text-base lg:text-lg font-bold tracking-tight text-foreground">{acronym}</span>
                  <p className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground leading-snug text-balance">
                    {schoolName}
                  </p>
                </div>
              </div>

              <div className="mt-5 border-t border-border/60 pt-5">
                <CardTitle className="text-xl sm:text-2xl font-bold text-foreground tracking-tight">
                  Welcome back
                </CardTitle>
                <CardDescription className="normal-case tracking-normal text-sm text-muted-foreground mt-1 leading-snug">
                  Sign in to access the <span className="font-semibold text-primary">Teacher Portal</span>
                </CardDescription>
              </div>
            </CardHeader>

            <CardContent className="px-5 pb-6 pt-5 sm:px-7 lg:pb-7">
              {/* Error Message */}
              {error && (
                <div role="alert" className="mb-4 flex items-start gap-2.5 rounded-xl border border-destructive/20 bg-destructive/5 px-3.5 py-3 animate-login-scale-in">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-destructive" aria-hidden="true" />
                  <span className="text-sm font-medium text-destructive">{error}</span>
                </div>
              )}

              {/* Success Message */}
              {success && (
                <div role="status" className="mb-4 flex items-start gap-2.5 rounded-xl border border-primary/20 bg-primary/5 px-3.5 py-3 animate-login-scale-in">
                  <CheckCircle className="w-4 h-4 mt-0.5 shrink-0 text-primary" aria-hidden="true" />
                  <div>
                    <p className="text-sm font-semibold text-foreground">Welcome back!</p>
                    <p className="text-xs text-muted-foreground">Loading your classes...</p>
                  </div>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Employee ID Field */}
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-sm font-medium text-foreground">
                    Employee ID or Email
                  </Label>
                  <div className="relative">
                    <User className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="email"
                      type="text"
                      placeholder="Enter your ID or email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        if (error) setError(null);
                      }}
                      className="pl-10 h-12 lg:h-11 bg-muted/60 border-transparent hover:bg-muted focus:bg-background focus:border-primary focus:ring-2 focus:ring-primary/15 focus:outline-none rounded-xl transition-all duration-200 placeholder:text-muted-foreground/70 text-foreground text-sm font-medium"
                      autoComplete="username"
                      autoCapitalize="none"
                      autoCorrect="off"
                      name="identifier"
                      spellCheck={false}
                      required
                    />
                  </div>
                </div>

                {/* Password Field */}
                <div className="space-y-1.5">
                  <Label htmlFor="password" className="text-sm font-medium text-foreground">
                    Password
                  </Label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        if (error) setError(null);
                      }}
                      className="pl-10 pr-12 h-12 lg:h-11 bg-muted/60 border-transparent hover:bg-muted focus:bg-background focus:border-primary focus:ring-2 focus:ring-primary/15 focus:outline-none rounded-xl transition-all duration-200 placeholder:text-muted-foreground/70 text-foreground text-sm font-medium"
                      autoComplete="current-password"
                      name="password"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-0.5 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors duration-200"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      aria-pressed={showPassword}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
                    </button>
                  </div>
                  <p className="pt-0.5 text-right text-xs leading-relaxed text-muted-foreground">
                    <span className="font-medium text-foreground">Forgot password?</span> Contact the System Admin.
                  </p>
                </div>

                {/* Login Button */}
                <Button
                  type="submit"
                  disabled={isLoading}
                  className="w-full h-12 lg:h-11 font-semibold text-sm rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.99] transition-all duration-200 disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {isLoading ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="animate-spin h-4 w-4" />
                      Signing in...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <LogIn className="w-4 h-4" />
                      Sign In
                    </span>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
