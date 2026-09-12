/**
 * The optimistic projection — what a write looks like on screen before the server has seen it.
 *
 * ⛔ WRITTEN FROM THE SPECIFICATION, BEFORE THE IMPLEMENTATION EXISTS.
 *
 * Offline is a PAUSE (owner ruling), so the optimistic display is the NORMAL path — online and offline, web
 * and mobile — and offline only lengthens the delay. These assertions are therefore about every write, not
 * about an offline corner.
 */
import { describe, expect, it } from 'vitest';

import { projectOptimistic, type ServerFacts } from '../projection.js';

/** The server's last known state of a recipe, as the cache holds it. */
const CACHED: ServerFacts = {
    currentVersion: 3,
    visibility: 'private',
    sourceType: 'user_created',
    nutrition: { calories: 420 },
};

describe('projectOptimistic', () => {
    it('shows the values the cook just typed', () => {
        const projected = projectOptimistic(CACHED, { title: 'Weeknight Pasta' });

        expect(projected.value.title).toBe('Weeknight Pasta');
    });

    /**
     * ⛔ THE SINGLE MOST LOAD-BEARING ASSERTION IN THE WHOLE DESIGN. `versionNumber` is the CAS token the next
     * sync attempt sends as `expectedVersion`. If the optimistic overlay advanced it, the next attempt would
     * claim to be based on a version the server never issued — and the 409 that protects the cook's work
     * would stop firing. Optimism that MASKS a conflict is precisely the defect `useUpdateRecipe`'s docstring
     * was written against; this is what makes masking structurally impossible rather than merely avoided.
     */
    it('⛔ NEVER advances the version — that number is the next attempt’s CAS token', () => {
        const projected = projectOptimistic(CACHED, { title: 'edited' });

        expect(projected.value.currentVersion).toBe(3);
    });

    /**
     * ⛔ POLICY-DERIVED FIELDS ARE MARKED UNKNOWN, NEVER GUESSED. `visibility` is decided server-side by
     * C-004 and `sourceType` by the provenance policy. A client that guessed "private" would tell a free-tier
     * cook their recipe is private when the server is about to refuse exactly that — a promise the product
     * cannot keep, made by the layer that is supposed to be honest about what it does not know.
     */
    it('⛔ marks server-decided fields UNKNOWN on a create rather than inventing them', () => {
        const projected = projectOptimistic(undefined, { title: 'Brand new' });

        expect(projected.unknown).toContain('visibility');
        expect(projected.unknown).toContain('sourceType');
        expect(projected.unknown).toContain('nutrition');
    });

    /**
     * ⚠️ An EDIT merges onto the cached server copy, so every policy field is real and nothing is unknown.
     * That asymmetry is why editing needs no consumer change while creating does: the edit's type is
     * unchanged, the create's widens.
     */
    it('an edit over cached data knows every policy field, so nothing is unknown', () => {
        const projected = projectOptimistic(CACHED, { title: 'edited' });

        expect(projected.unknown).toStrictEqual([]);
        expect(projected.value.visibility).toBe('private');
    });

    /**
     * ⛔ NUTRITION FRESHNESS MUST NOT BE FABRICATED. Its own contract records that "an optional marker's
     * absence would read as 'current', which is exactly the defect it closes" — so a locally projected
     * recipe must not claim fresh nutrition it never computed.
     */
    it('⛔ never claims fresh nutrition for a recipe the server has not costed', () => {
        const projected = projectOptimistic(undefined, { title: 'Brand new' });

        expect(projected.value.nutrition).toBeUndefined();
    });

    it('marks the projection as pending, so a surface can show the quiet syncing status', () => {
        expect(projectOptimistic(CACHED, { title: 'edited' }).pending).toBe(true);
    });
});
