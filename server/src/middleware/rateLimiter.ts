import rateLimit from 'express-rate-limit';

/** Global rate limiter: 300 requests per minute per IP */
export const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
  skip: (req) => {
    // Exempt auth endpoints and SSE stream from rate limiting
    if (req.path.startsWith('/api/auth/')) return true;
    if (req.path.startsWith('/api/integration/sync/stream')) return true;
    // Exempt cheap GET endpoints needed by every page
    if (req.path.startsWith('/api/admin/settings')) return true;
    if (req.path === '/api/health') return true;
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
