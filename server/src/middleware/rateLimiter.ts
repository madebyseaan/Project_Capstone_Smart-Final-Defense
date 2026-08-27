import rateLimit from 'express-rate-limit';

/** Global rate limiter: 100 requests per minute per IP */
export const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});

/** Stricter limiter for sync endpoints: 10 per minute */
export const syncLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Sync rate limit exceeded. Please wait before retrying.' },
});
