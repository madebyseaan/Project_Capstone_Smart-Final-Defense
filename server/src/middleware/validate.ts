/**
 * validate.ts
 *
 * Generic Zod validation middleware for Express.
 * Validates req.body, req.query, and/or req.params against a Zod schema.
 *
 * Usage:
 *   router.post('/endpoint', validate(mySchema), handler)
 *
 * On failure: returns 400 with structured error details.
 * On success: replaces req.body/query/params with parsed (typed) values.
 */

import { Request, Response, NextFunction } from 'express';
import { ZodObject, ZodError } from 'zod';

export function validate(schema: ZodObject<any>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const data = schema.parse({
        body: req.body,
        query: req.query,
        params: req.params,
      }) as { body?: any; query?: any; params?: any };
      if (data.body !== undefined) req.body = data.body;
      if (data.query !== undefined) {
        // Express 5 makes req.query a getter-only property on IncomingMessage.
        // Override it via the prototype to avoid "Cannot set property query" TypeError.
        Object.defineProperty(req, 'query', { value: data.query, writable: true, configurable: true });
      }
      if (data.params !== undefined) req.params = data.params;
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({
          message: 'Validation failed',
          errors: err.issues.map(i => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        });
        return;
      }
      next(err);
    }
  };
}
