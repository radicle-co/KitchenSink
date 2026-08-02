/**
 * `@SkipErasureLock()` — exempts a single mutating handler from {@link ErasureLockGuard} (HAZ-052).
 *
 * Exactly one route needs this: `POST /api/v1/account/erasure` itself. `ErasureLockGuard` locks a mutating
 * request once a `queued`/`running` `account_erasure_jobs` row exists for the caller — but that same row
 * is what makes a REPEAT `POST /api/v1/account/erasure` idempotent (C-007: it returns `202` with the
 * EXISTING job, never a second enqueue). Without this exemption the lock would shadow its own gateway:
 * the very endpoint that reports "erasure is already in flight" would itself start answering `423`
 * instead. The exemption is declared at the route (via `Reflector.getAllAndOverride`, mirroring
 * `@nestjs/throttler`'s `@SkipThrottle()`), not hard-coded as a path string inside the guard — the guard
 * stays generic over every controller and the one intentional exception stays visible where it applies.
 */
import { SetMetadata } from '@nestjs/common';

/** Reflector metadata key {@link ErasureLockGuard} reads via `getAllAndOverride`. */
export const SKIP_ERASURE_LOCK = 'skipErasureLock';

/**
 * Route/class decorator: exempts the handler (or every handler in a controller) from the write-lock.
 *
 * MUST be applied at METHOD level only — never at class level. `ErasureLockGuard` reads this metadata via
 * `getAllAndOverride([handler, class])`, so a class-level application would silently exempt EVERY route in
 * that controller from the erasure lock, not just the one intended route.
 */
export const SkipErasureLock = (): MethodDecorator & ClassDecorator => SetMetadata(SKIP_ERASURE_LOCK, true);
