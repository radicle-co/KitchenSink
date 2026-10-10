import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { SettingsDAO } from '@kitchensink/identity-db';

import type { AuthorizerContext } from '../auth/decorators/currentUser.decorator.js';
import { resolveSettings } from './domain/resolveSettings.js';
import type { PatchUserSettingsRequest, UserSettings } from './settings.schema.js';

/** The two DAO operations this service uses, so a test stands in for the DAO without a cast. */
export type SettingsStore = Pick<SettingsDAO, 'findByUserId' | 'upsertForActiveUser'>;

/**
 * The signed-in viewer's settings (ADR-0059).
 *
 * Authentication is the global `AuthMiddleware`, which has already refused a closed or erased account before a
 * request reaches here; the active-user predicate on the write is the second line, for an account closed between
 * that check and this write.
 */
@Injectable()
export class SettingsService {
    constructor(@Inject(SettingsDAO) private readonly store: SettingsStore) {}

    /**
     * Read the viewer's settings. A viewer who never chose any gets the defaults, and nothing is written.
     *
     * @param ctx - The verified caller.
     * @returns The fully resolved settings.
     */
    async getSettings(ctx: AuthorizerContext): Promise<UserSettings> {
        return resolveSettings(await this.store.findByUserId(ctx.userId));
    }

    /**
     * Change the settings the body names; every other setting is left as it is. Last write wins, per column.
     * An empty body writes nothing and answers the current settings.
     *
     * @param ctx - The verified caller.
     * @param body - The settings to change.
     * @returns The fully resolved settings after the change.
     * @throws ForbiddenException `Account is closed` when the user is no longer active, in which case nothing was
     *         written, so personal data is never recreated after an erasure.
     * @sideEffect Inserts or updates the viewer's `settings` row.
     */
    async patchSettings(ctx: AuthorizerContext, body: PatchUserSettingsRequest): Promise<UserSettings> {
        if (body.searchShortcut === undefined) {
            return this.getSettings(ctx);
        }

        const row = await this.store.upsertForActiveUser(ctx.userId, { searchShortcut: body.searchShortcut });

        if (row === undefined) {
            throw new ForbiddenException('Account is closed');
        }

        return resolveSettings(row);
    }
}
