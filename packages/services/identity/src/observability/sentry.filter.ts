import { HttpException } from '@nestjs/common';

/**
 * Whether an exception should be reported to Sentry. `HttpException`s (404, 401, 400, …) are
 * intentional control flow, not failures, so they are not captured (R12 / AE2).
 *
 * Consumed by the global {@link import('../common/filters/api-exception.filter.js').ApiExceptionFilter},
 * which composes this capture decision with response shaping. Kept as a standalone, side-effect-free
 * predicate so the decision stays independently testable.
 */
export const shouldCaptureException = (exception: unknown): boolean => !(exception instanceof HttpException);
