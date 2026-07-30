import { SetMetadata } from '@nestjs/common';

/**
 * Reflector metadata key {@link ScopesGuard} reads to discover the scopes a route/controller requires.
 * Not intended for direct use outside this pattern's own guard — consumers apply {@link RequireScopes}.
 */
export const SCOPES_METADATA_KEY = 'requiredScopes';

/**
 * Decorator half of the declarative-authorization Guard pattern (see `ScopesGuard`). Marks a handler or
 * controller as requiring every listed scope (present in the caller's `scopes` OR `permissions`) —
 * replacing the old imperative `assertAdmin(ctx)` call that had to be remembered at the top of every
 * method. Apply at the controller level to cover every route without relying on each handler author to
 * remember the check: `@UseGuards(ScopesGuard) @RequireScopes('admin:users')`.
 *
 * @param scopes - Scope strings ALL of which must be present (scopes-or-permissions) to pass the guard.
 */
export const RequireScopes = (...scopes: string[]): ReturnType<typeof SetMetadata> =>
    SetMetadata(SCOPES_METADATA_KEY, scopes);
