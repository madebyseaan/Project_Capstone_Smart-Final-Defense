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
  user: {
    id: string;
    username: string;
    role: "TEACHER" | "ADMIN" | "REGISTRAR";
    firstName?: string;
    lastName?: string;
    email?: string;
    isDeveloper?: boolean;
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
      const response = await axios.post<LoginResponse>(`${API_URL}/auth/login`, {
        email,
        password,
      });

      // Verify admin role or developer access
      const isDev = Boolean(response.data.user.isDeveloper || response.data.user.username === "999999");
      if (response.data.user.role !== "ADMIN" && !isDev) {
        setError("Access denied. This portal is for administrators only.");
        setIsLoading(false);
        return;
      }

      sessionStorage.setItem("user_admin", JSON.stringify(response.data.user));
      sessionStorage.setItem("token_admin", response.data.token);
      if (response.data.refreshToken) {
        sessionStorage.setItem("refreshToken_admin", response.data.refreshToken);
      }
      sessionStorage.setItem("user", JSON.stringify(response.data.user));
      sessionStorage.setItem("token", response.data.token);

      setSuccess(response.data);

      setTimeout(() => {
        navigate("/admin");
      }, 1000);
    } catch (err) {
      if (axios.isAxiosError(err) && err.response) {
        setError(err.response.data.message || "Login failed");
      } else {
        setError("Unable to connect to server. Please try again.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="h-screen w-full flex overflow-hidden bg-gradient-to-br from-[#f8fafc] via-primary/8 to-accent/6"
      style={{
        '--primary': 'var(--theme-primary)',
        '--accent': 'var(--theme-accent)'
      } as React.CSSProperties}
    >
      <style>{`
        @keyframes login-gradient-shift {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }

        @keyframes login-float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-16px); }
        }

        @keyframes login-scale-in {
          0% { opacity: 0; transform: scale(0.98); }
          100% { opacity: 1; transform: scale(1); }
        }

        .login-gradient {
          animation: login-gradient-shift 14s ease infinite;
          background-size: 200% 200%;
        }

        .login-float {
          animation: login-float 9s ease-in-out infinite;
        }

        .login-scale-in {
          animation: login-scale-in 220ms ease-out forwards;
        }
      `}</style>

      {/* Left Panel - Branding */}
      <div className="hidden lg:flex lg:w-[55%] xl:w-3/5 relative overflow-hidden bg-primary shrink-0">
        {/* Animated gradient background */}
        <div
          className="absolute inset-0 login-gradient"
          style={{
            background: `linear-gradient(to bottom right, var(--theme-primary), rgba(var(--theme-primary-rgb), 0.88), rgba(var(--theme-accent-rgb), 0.88))`,
          }}
        />

        {/* Decorative patterns */}
        <div className="absolute inset-0">
          {/* Floating orbs */}
          <div className="absolute top-20 left-20 w-96 h-96 rounded-full bg-white/10 blur-3xl login-float" />
          <div
            className="absolute bottom-32 right-16 w-80 h-80 rounded-full blur-3xl login-float"
            style={{
              backgroundColor: 'var(--theme-accent)',
              opacity: 0.18,
              animationDelay: '2s'
            }}
          />
          <div
            className="absolute top-1/2 left-1/4 w-64 h-64 rounded-full blur-2xl login-float"
            style={{
              backgroundColor: 'var(--theme-primary)',
              opacity: 0.2,
              animationDelay: '4s'
            }}
          />

          {/* Grid pattern overlay */}
          <div
            className="absolute inset-0 opacity-[0.03]"
            style={{
              backgroundImage:
                'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)',
              backgroundSize: '50px 50px',
            }}
          />

          <div className="absolute -top-1/2 -right-1/4 w-full h-full bg-[radial-gradient(circle,_rgba(255,255,255,0.08)_0%,_transparent_70%)] rounded-full" />
        </div>

        <div className="relative z-10 flex flex-col justify-center py-12 xl:py-16 px-12 xl:px-20 text-white w-full h-full">
          {/* Brand header (top left) - No logo, text only */}
          <div className="flex items-center gap-4 mb-6">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-4xl font-bold tracking-tight text-white">{acronym}</h1>
                <span className="px-2 py-0.5 text-xs font-bold rounded bg-amber-500 text-white shadow-sm">ADMIN</span>
              </div>
              <p className="text-white text-sm font-bold max-w-md">System Administration Portal</p>
            </div>
          </div>

          {/* School Name + Details */}
          <div className="space-y-3 mb-6">
            <h2 className="text-3xl xl:text-4xl font-bold leading-tight tracking-tight text-white">
              {schoolName}
            </h2>
            <p className="text-white text-sm font-bold">Junior High School (Grades 7-10)</p>
            <div className="flex flex-col gap-1.5 mt-3">
              <p className="text-white text-sm font-bold">
                DepEd Public School Student Management and Records Tracking Portal
              </p>
            </div>
          </div>

          {/* Admin-specific Feature cards */}
          <div className="grid gap-2.5 max-w-xl">
            {[
              { icon: Users, title: "User Management", desc: "Complete control over system access" },
              { icon: Settings, title: "System Configuration", desc: "Customize grading and policies" },
              { icon: Database, title: "Audit Logs", desc: "Track all system activities" },
              { icon: Activity, title: "Analytics Dashboard", desc: "Monitor system performance" }
            ].map((feature, i) => (
              <div
                key={i}
                className="flex items-center gap-3 p-3 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10 hover:bg-white/10 hover:border-white/20 group transition-all duration-300"
              >
                <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center group-hover:scale-110 transition-transform flex-shrink-0">
                  <feature.icon className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="font-bold text-white">{feature.title}</h3>
                  <p className="text-white text-sm font-semibold">{feature.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer attribution */}
        <div className="absolute bottom-8 left-12 xl:left-20 flex items-center gap-3 text-white/50 text-sm">
          <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
            <Shield className="w-4 h-4 text-white" />
          </div>
          <span>Administrative Access • Restricted Portal</span>
        </div>
      </div>

      {/* Right Panel - Login Form */}
      <div
        className="relative w-full lg:w-[45%] xl:w-2/5 flex items-center justify-center p-4 sm:p-6 lg:p-8 overflow-y-auto"
      >
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          <div
            className="absolute inset-0"
            style={{
              background: 'hsl(var(--sidebar-background)/0.5)',
            }}
          />

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
                <rect
                  x="2"
                  y="2"
                  width="36"
                  height="36"
                  rx="2"
                  fill="none"
                  stroke="var(--theme-primary)"
                  strokeWidth="1.5"
                />
                <rect
                  x="42"
                  y="2"
                  width="36"
                  height="36"
                  rx="2"
                  fill="none"
                  stroke="var(--theme-primary)"
                  strokeWidth="1.5"
                />
                <rect
                  x="2"
                  y="42"
                  width="36"
                  height="36"
                  rx="2"
                  fill="none"
                  stroke="var(--theme-primary)"
                  strokeWidth="1.5"
                />
                <rect
                  x="42"
                  y="42"
                  width="36"
                  height="36"
                  rx="2"
                  fill="none"
                  stroke="var(--theme-primary)"
                  strokeWidth="1.5"
                />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#login-pixel-grid)" />
          </svg>

          <div
            className="absolute inset-0"
            style={{
              background:
                'radial-gradient(circle at center, rgba(var(--theme-primary-rgb), 0.05) 0%, transparent 70%)',
            }}
          />
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
                <span className="text-xl font-bold text-gray-900">{acronym}</span>
                <span className="px-2 py-0.5 text-xs font-bold rounded bg-amber-500 text-white">ADMIN</span>
              </div>
              <p className="text-xs text-gray-500">{schoolName}</p>
            </div>
          </div>

          {/* Login card with premium styling */}
          <Card className="border-0 shadow-2xl shadow-gray-200 bg-white/90 backdrop-blur-xl rounded-lg overflow-hidden">
            <CardHeader className="space-y-1 text-center pt-5 pb-0 px-6">
              <div
                className="w-14 h-14 mx-auto rounded-full flex items-center justify-center shadow-lg overflow-hidden"
                style={{
                  background: fullLogoUrl
                    ? 'white'
                    : 'linear-gradient(to bottom right, var(--theme-primary), var(--theme-accent))',
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
              <CardTitle className="text-xl font-bold text-gray-900 pt-2">
                Welcome Back
              </CardTitle>
              <CardDescription className="text-gray-600 text-sm">
                Sign in to your Admin account to manage <span className="font-semibold text-primary">{acronym}</span>
              </CardDescription>
            </CardHeader>

            <CardContent className="px-6 pb-5 pt-4">
              {/* Error Message */}
              {error && (
                <div className="mb-4 p-3 rounded-xl bg-gradient-to-r from-red-50 to-rose-50 border border-red-100 flex items-center gap-2.5 login-scale-in">
                  <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center flex-shrink-0">
                    <AlertCircle className="w-4 h-4 text-red-600" />
                  </div>
                  <span className="text-sm font-bold text-red-700">{error}</span>
                </div>
              )}

              {/* Success Message */}
              {success && (
                <div className="mb-4 p-3 rounded-xl border flex items-center gap-2.5 login-scale-in bg-gradient-to-r from-primary/10 to-accent/10 border-primary/25">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-primary/15">
                    <CheckCircle className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-primary">Admin access granted!</p>
                    <p className="text-xs text-gray-500">Redirecting to dashboard...</p>
                  </div>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-3">
                {/* Employee ID Field */}
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-gray-800 font-semibold text-sm pl-1">
                    Employee ID or Email
                  </Label>
                  <div className="relative group">
                    <div className="absolute left-0 top-0 bottom-0 w-11 flex items-center justify-center pointer-events-none z-10">
                      <div className="w-8 h-8 rounded-lg bg-gray-100 group-focus-within:bg-gray-200 flex items-center justify-center transition-colors duration-200">
                        <User className="w-4 h-4 text-gray-500 transition-colors duration-200" />
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
                      className="pl-12 h-11 bg-gray-50 border-gray-200 hover:border-gray-300 focus:ring-4 focus:ring-primary/15 rounded-xl transition-all duration-200 placeholder:text-gray-400 text-gray-900 font-bold"
                      autoComplete="username"
                      required
                    />
                  </div>
                </div>

                {/* Password Field */}
                <div className="space-y-1.5">
                  <Label htmlFor="password" className="text-gray-800 font-semibold text-sm pl-1">
                    Password
                  </Label>
                  <div className="relative group">
                    <div className="absolute left-0 top-0 bottom-0 w-11 flex items-center justify-center pointer-events-none z-10">
                      <div className="w-8 h-8 rounded-lg bg-gray-100 group-focus-within:bg-gray-200 flex items-center justify-center transition-colors duration-200">
                        <Lock className="w-4 h-4 text-gray-500 transition-colors duration-200" />
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
                      className="pl-12 pr-11 h-11 bg-gray-50 border-gray-200 hover:border-gray-300 focus:ring-4 focus:ring-primary/15 rounded-xl transition-all duration-200 placeholder:text-gray-400 text-gray-900 font-bold"
                      autoComplete="current-password"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 transition-all duration-200"
                      tabIndex={-1}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Remember Me & Contact IT Admin */}
                <div className="flex items-center justify-between text-sm py-1">
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <div className="relative flex items-center justify-center">
                      <input
                        type="checkbox"
                        className="peer sr-only"
                      />
                      <div className="w-4 h-4 rounded border border-gray-300 bg-white peer-checked:bg-primary peer-checked:border-primary flex items-center justify-center transition-all duration-150">
                        <svg className="w-2.5 h-2.5 text-white opacity-0 peer-checked:opacity-100 transition-opacity duration-150" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    </div>
                    <span className="text-gray-600 group-hover:text-gray-900 transition-colors font-bold text-sm select-none">Remember me</span>
                  </label>
                  <a href="#" className="font-semibold text-primary transition-colors hover:underline underline-offset-4 decoration-2 text-sm">
                    Contact IT Admin
                  </a>
                </div>

                {/* Login Button */}
                <Button
                  type="submit"
                  disabled={isLoading}
                  className="w-full h-11 font-semibold text-sm rounded-xl shadow-lg hover:shadow-xl transition-all duration-0 disabled:opacity-70 disabled:cursor-not-allowed bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {isLoading ? (
                    <span className="flex items-center gap-3">
                      <Loader2 className="animate-spin h-5 w-5" />
                      Verifying credentials...
                    </span>
                  ) : (
                    <span className="flex items-center gap-3">
                      <Shield className="w-5 h-5" />
                      Sign In
                    </span>
                  )}
                </Button>
              </form>

              {/* Footer */}
              <p className="text-[10px] text-gray-400 text-center mt-4 leading-relaxed">
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
