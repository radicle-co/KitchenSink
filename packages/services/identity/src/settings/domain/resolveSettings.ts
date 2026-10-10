import type { SettingsRow } from '@kitchensink/identity-db';

import { SETTINGS_DEFAULTS, type UserSettings } from '../settings.schema.js';

/**
 * Resolve a stored settings row to the settings a client sees (ADR-0059).
 *
 * `NULL` means "never chosen" and so does a missing row, and both resolve to the published default. This is the only
 * place a default is applied, which is why no setting column carries a database `DEFAULT`. A stored `false` is a
 * choice and is kept: the test is `=== null`, never truthiness.
 *
 * @pattern Specification — a pure predicate-and-resolve over one row: which value does this user have?
 * @param row - The user's row, or `undefined` when they have none.
 * @returns The fully resolved settings, as a fresh object.
 */
export function resolveSettings(row: Pick<SettingsRow, 'searchShortcut'> | undefined): UserSettings {
    return {
        searchShortcut: row?.searchShortcut ?? SETTINGS_DEFAULTS.searchShortcut,
    };
}
