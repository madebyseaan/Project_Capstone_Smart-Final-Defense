import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

/** Global rate limiter: 300 requests per minute per IP */
export const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
  skip: (req) => {
    const path = (req.originalUrl || req.url).split('?')[0];
    // Exempt auth endpoints (and SSO compatibility aliases) plus SSE stream from rate limiting
    if (path.startsWith('/api/auth/')) return true;
    if (path.startsWith('/api/v1/auth/')) return true;
    if (path.startsWith('/auth/')) return true;
    if (path.startsWith('/api/integration/sync/stream')) return true;
    // Exempt the cheap read endpoints needed by every page
    if (req.method === 'GET' && path === '/api/admin/settings/public') return true;
    if (req.method === 'GET' && path === '/api/admin/settings') return true;
    if (path === '/api/health') return true;
    return false;
  },
});

/** Stricter limiter for sync endpoints: 10 per minute */
export const syncLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Sync rate limit exceeded. Please wait before retrying.' },
});

/** SSO reverse authorize: 20 per minute per IP (user-driven, one per click) */
export const ssoAuthorizeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `sso-authorize:${ipKeyGenerator(req.ip || '127.0.0.1')}`,
  message: { code: 'COMPANION_SSO_RATE_LIMITED', message: 'Too many sign-in attempts. Please try again shortly.' },
});

/** SSO reverse exchange: 60 per minute per IP (server-to-server call from EnrollPro) */
export const ssoExchangeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `sso-exchange:${ipKeyGenerator(req.ip || '127.0.0.1')}`,
  message: { code: 'COMPANION_SSO_RATE_LIMITED', message: 'Too many sign-in attempts. Please try again shortly.' },
});
