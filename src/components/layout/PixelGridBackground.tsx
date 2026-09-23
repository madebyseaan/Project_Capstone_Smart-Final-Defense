/**
 * Full-page "pixel grid" backdrop shared by every portal layout.
 * Matches the login screens: an 80×80 tile of rounded square outlines tinted
 * with the active theme primary.
 */
export default function PixelGridBackground() {
  return (
    <div
      className="pointer-events-none fixed inset-0 -z-10"
      style={{
        // Mirrors EnrollPro's `login-pixel-grid` backdrop exactly: slate-50 fading
        // into the theme primary so the maroon grid reads warm, not grey.
        backgroundImage:
          "linear-gradient(to bottom right, #f8fafc 0%, rgba(var(--theme-primary-rgb), 0.08) 50%, rgba(var(--theme-primary-rgb), 0.06) 100%)",
      }}
      aria-hidden="true"
    >
      <svg className="absolute inset-0 h-full w-full opacity-[0.08]" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern
            id="app-pixel-grid"
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
        <rect width="100%" height="100%" fill="url(#app-pixel-grid)" />
      </svg>
    </div>
  );
}
