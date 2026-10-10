/**
 * THE `/api/v1/users/me/settings` WIRE CONTRACT — authored here, in the service, and copied verbatim into
 * `@kitchensink/schema-identity` (`docs/CODING_STANDARDS.md` §15.2, ADR-0014). Decided in ADR-0059.
 *
 * A user's app preferences. Every setting is a typed column on the server, so a preference follows the cook across
 * devices and none is kept in browser storage (owner ruling D19).
 *
 * THE RESPONSE IS ALWAYS FULLY RESOLVED. A setting the user never chose is stored as `NULL` and answered as its
 * default, so a client never branches on "absent". The defaults are published here, beside the shape, so a client
 * uses them as its placeholder while the first read is in flight and restates none.
 *
 * ADDING A SETTING: a nullable column in `@kitchensink/identity-db`, a field on {@link userSettingsSchema}, an
 * optional field on {@link patchUserSettingsRequestSchema}, and its default in {@link SETTINGS_DEFAULTS}. The server
 * deploys before the clients, because the request is strict.
 *
 * IMPORT RESTRICTION (enforced by `@kitchensink/contract-gen`): this file may import ONLY `zod` and flat sibling
 * `*.schema.js` modules.
 */
import { z } from 'zod';

/**
 * A user's settings, fully resolved.
 *
 * NOT strict (`z.object`, which strips unknown keys on parse): a client built before a setting existed must keep
 * working when the server adds one.
 */
export const userSettingsSchema = z.object({
    /** Whether the web "/" key focuses search. */
    searchShortcut: z.boolean(),
});

/** A user's settings, fully resolved. */
export type UserSettings = z.infer<typeof userSettingsSchema>;

/**
 * What a user who never chose a setting gets. The ONE definition: the service resolves `NULL` to it and a client
 * uses it as its placeholder.
 */
export const SETTINGS_DEFAULTS = Object.freeze({ searchShortcut: true }) satisfies UserSettings;

/**
 * Request body for `PATCH /api/v1/users/me/settings`.
 *
 * STRICT (`z.strictObject`) on purpose, as `patchUserMeRequestSchema` is: zod's plain `z.object()` strips unknown
 * keys silently, which would answer `200` to a client that sent a setting this server does not know and drop it. A
 * `400` tells the client the truth. Every key is optional, and a key left out is left as it is; `{}` is a no-op.
 * There is no value that clears a setting back to "never chosen".
 */
export const patchUserSettingsRequestSchema = z.strictObject({
    /** Whether the web "/" key focuses search. */
    searchShortcut: z.boolean().optional(),
});

/** Request body for `PATCH /api/v1/users/me/settings`. */
export type PatchUserSettingsRequest = z.infer<typeof patchUserSettingsRequestSchema>;
