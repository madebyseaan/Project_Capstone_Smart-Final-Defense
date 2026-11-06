import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff, User, Lock, AlertCircle, CheckCircle, GraduationCap, Settings, Shield, Sparkles, Loader2, Users, Database, Activity } from "lucide-react";
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

export default function AdminLoginPage() {
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
        ...(safeReturnUrl ? {} : { portal: "ADMIN" }),
      });

      sessionStorage.setItem("user_admin", JSON.stringify(response.data.user));
      sessionStorage.setItem("token_admin", response.data.token);
      if (response.data.refreshToken) {
        sessionStorage.setItem("refreshToken_admin", response.data.refreshToken);
      }
      sessionStorage.setItem("user", JSON.stringify(response.data.user));
      sessionStorage.setItem("token", response.data.token);

      setSuccess(response.data);

      // Resume an SSO authorize request if login was required first
      if (safeReturnUrl) {
        navigate(safeReturnUrl, { replace: true });
        return;
      }

      setTimeout(() => {
        navigate("/admin");
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
            <div className="mt-9 xl:mt-12 flex items-center gap-3">
              <h1 className="text-6xl xl:text-[64px] font-bold tracking-tight text-white font-sans">
                {acronym}
              </h1>
              <span className="px-2 py-0.5 text-xs font-bold rounded bg-amber-500 text-white shadow-sm">ADMIN</span>
            </div>
            <p className="mt-4 xl:mt-5 text-base xl:text-xl font-medium text-white/85 font-sans">
              DepEd Junior High School (Grades 7-10) System Administration Portal
            </p>

            {/* Admin-specific Feature cards */}
            <div className="mt-9 xl:mt-12 grid gap-3 xl:gap-3.5">
              {[
                { icon: Users, title: "User Management", desc: "Complete control over system access" },
                { icon: Settings, title: "System Configuration", desc: "Customize grading and policies" },
                { icon: Database, title: "Audit Logs", desc: "Track all system activities" },
                { icon: Activity, title: "Analytics Dashboard", desc: "Monitor system performance" }
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
        className="relative w-full lg:w-[45%] xl:w-2/5 flex items-center justify-center p-4 sm:p-6 lg:p-8 overflow-y-auto"
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
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center justify-center gap-3 mb-6">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center shadow-lg overflow-hidden bg-white border border-slate-200"
            >
              {fullLogoUrl ? (
                <img src={fullLogoUrl} alt={schoolName} className="w-full h-full object-cover" />
              ) : (
                <GraduationCap className="w-7 h-7 text-[var(--theme-primary)]" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xl font-bold text-slate-900">{acronym}</span>
                <span className="px-2 py-0.5 text-xs font-bold rounded bg-amber-500 text-white">ADMIN</span>
              </div>
              <p className="text-xs text-slate-500">{schoolName}</p>
            </div>
          </div>

          {/* Login card with premium styling */}
          <Card className="border border-black/[0.06] shadow-[0_24px_48px_-16px_rgba(15,23,42,0.18)] bg-white rounded-3xl overflow-hidden">
            <CardHeader className="space-y-1 text-center pt-7 pb-2 px-7 bg-transparent border-b-0">
              <div
                className="w-16 h-16 mx-auto rounded-full flex items-center justify-center overflow-hidden"
                style={{
                  background: fullLogoUrl
                    ? 'white'
                    : 'var(--theme-primary)',
                  boxShadow: '0 0 0 6px rgba(var(--theme-primary-rgb), 0.06), 0 12px 24px -8px rgba(var(--theme-primary-rgb), 0.35)',
                  border: fullLogoUrl ? '2px solid rgba(var(--theme-primary-rgb), 0.2)' : 'none',
                }}
              >
                {fullLogoUrl ? (
                  <img src={fullLogoUrl} alt={schoolName} className="w-12 h-12 object-cover" />
                ) : (
                  <Sparkles className="w-6 h-6 text-white" />
                )}
              </div>
              <CardTitle className="text-2xl font-bold text-slate-900 tracking-tight pt-2">
                Welcome Back
              </CardTitle>
              <CardDescription className="normal-case tracking-normal text-slate-900 text-[15px] font-semibold mt-1.5 leading-snug">
                Sign in to access the <span className="font-bold text-primary">Admin Portal</span>
              </CardDescription>
            </CardHeader>

            <CardContent className="px-7 pb-7 pt-4">
              {/* Error Message */}
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

              {/* Success Message */}
              {success && (
                <div className="mb-4 p-3 rounded-xl border flex items-center gap-2.5 login-scale-in bg-primary/10 border-primary/25">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-primary/15">
                    <CheckCircle className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-primary">Admin access granted!</p>
                    <p className="text-xs text-slate-500">Redirecting to dashboard...</p>
                  </div>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-3">
                {/* Employee ID Field */}
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-sm font-bold text-slate-900">
                    Employee ID or Email
                  </Label>
                  <div className="relative">
                    <User className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <Input
                      id="email"
                      type="text"
                      placeholder="Employee ID or Email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        if (error) setError(null);
                      }}
                      className="pl-11 h-11 bg-muted/60 border-transparent hover:bg-muted focus:bg-white focus:border-primary focus:ring-2 focus:ring-primary/15 focus:outline-none rounded-full transition-all duration-200 placeholder:text-slate-400 text-slate-800 text-sm font-medium"
                      autoComplete="username"
                      required
                    />
                  </div>
                </div>

                {/* Password Field */}
                <div className="space-y-1.5">
                  <Label htmlFor="password" className="text-sm font-bold text-slate-900">
                    Password
                  </Label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        if (error) setError(null);
                      }}
                      className="pl-11 pr-11 h-11 bg-muted/60 border-transparent hover:bg-muted focus:bg-white focus:border-primary focus:ring-2 focus:ring-primary/15 focus:outline-none rounded-full transition-all duration-200 placeholder:text-slate-400 text-slate-800 text-sm font-medium"
                      autoComplete="current-password"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all duration-200"
                      tabIndex={-1}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Remember Me & Contact System Admin */}
                <div className="flex items-start justify-between gap-4 py-1">
                  <label className="flex items-center gap-2.5 cursor-pointer group">
                    <input
                      type="checkbox"
                      className="peer sr-only"
                    />
                    <div className="w-4 h-4 rounded-full border-2 border-primary/70 bg-white peer-checked:border-[5px] peer-checked:border-primary transition-all duration-150" />
                    <span className="text-slate-900 group-hover:text-primary transition-colors font-semibold text-sm select-none">Remember me</span>
                  </label>
                  <div className="text-right leading-snug">
                    <span className="block text-[13px] font-medium text-slate-500 select-none">Forgot password?</span>
                    <span className="block text-[13px] text-slate-500 mt-0.5 select-none">Contact the System Admin.</span>
                  </div>
                </div>

                {/* Login Button */}
                <Button
                  type="submit"
                  disabled={isLoading}
                  className="w-full h-11 font-semibold text-sm rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.99] transition-all duration-200 disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {isLoading ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="animate-spin h-4 w-4" />
                      Verifying credentials...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <Shield className="w-4 h-4" />
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
