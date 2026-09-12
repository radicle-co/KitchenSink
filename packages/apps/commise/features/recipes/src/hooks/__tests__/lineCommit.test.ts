/**
 * Unit tests for `commitRouteFor` (`../lineCommit.ts`) — the ONE decision of whether a pick on an ingredient row
 * goes through the rebind COMMAND or stays a DRAFT transition.
 *
 * ⛔ WHY BOTH DIRECTIONS MATTER. ADR-0045 (lines 265-269): an ordinary save records no correction, so re-pointing a
 * line the server already stores teaches only through the rebind command (plan 002 R17). Route a persisted line to
 * the draft and the correction is silently never recorded; route a line the server does not store to the command and
 * the command re-points whatever line happens to sit at that position. The table is pick kind × target, with the
 * stored position checked on every command answer — the position is the half that re-points the wrong line.
 */
import { describe, expect, it } from 'vitest';

import { mintedLineKey, persistedLineKeysOf, seedLineKey } from '../../form/lineKey.js';
import { commitRouteFor, type IngredientPick, type LineCommitTarget } from '../lineCommit.js';

const stored = [
    { key: seedLineKey(5, 0), ingredientId: null },
    { key: seedLineKey(5, 1), ingredientId: 'ing_a' },
    { key: seedLineKey(5, 2), ingredientId: 'ing_b' },
];
const persistedKeys = persistedLineKeysOf(stored);

const PERSISTED: LineCommitTarget = { kind: 'line', key: seedLineKey(5, 2) };
const UNSAVED_NO_FOOD: LineCommitTarget = { kind: 'line', key: seedLineKey(5, 0) };
const APPENDED_THIS_SESSION: LineCommitTarget = { kind: 'line', key: mintedLineKey('appended') };
const NEW_LINE: LineCommitTarget = { kind: 'newLine' };

const catalogFood: IngredientPick = { kind: 'catalogFood', foodId: 'food_9', name: 'Lacinato kale' };
const name: IngredientPick = { kind: 'name', text: 'cavolo nero' };
const declared: IngredientPick = { kind: 'declared', text: 'my aunt’s spice mix' };
const admitted: IngredientPick = { kind: 'admitted', ingredientId: 'ing_new', foodId: 'food_mine', name: 'Mix' };

describe('commitRouteFor', () => {
    it.each([
        // A persisted line re-pointed to a food or a name: the command, at the STORED position (2 → 1, because the
        // no-food line above it is never sent and so never stored).
        {
            pick: catalogFood,
            target: PERSISTED,
            expected: { route: 'command', position: 1, target: { kind: 'catalogFood', foodId: 'food_9' } },
        },
        {
            pick: name,
            target: PERSISTED,
            expected: { route: 'command', position: 1, target: { kind: 'name', name: 'cavolo nero' } },
        },
        // The cook's own new food: the command takes it as a catalog food (the schema's own reasoning: a `catalogFood`
        // rebind with the new id reaches the same end state as a create arm would).
        {
            pick: admitted,
            target: PERSISTED,
            expected: { route: 'command', position: 1, target: { kind: 'catalogFood', foodId: 'food_mine' } },
        },
        // A declaration has no rebind target: always the draft.
        { pick: declared, target: PERSISTED, expected: { route: 'draft' } },
        // Lines the server does not store: always the draft, whatever the pick.
        ...[catalogFood, name, declared, admitted].flatMap((pick) => [
            { pick, target: UNSAVED_NO_FOOD, expected: { route: 'draft' } },
            { pick, target: APPENDED_THIS_SESSION, expected: { route: 'draft' } },
            { pick, target: NEW_LINE, expected: { route: 'draft' } },
        ]),
    ] as const)('$pick.kind on $target.kind $target.key → $expected.route', ({ pick, target, expected }) => {
        expect(commitRouteFor(pick, target, persistedKeys)).toEqual(expected);
    });

    it('reads the PERSISTED keys, not the draft: a create form (nothing persisted) never reaches the command', () => {
        expect(commitRouteFor(catalogFood, PERSISTED, [])).toEqual({ route: 'draft' });
    });
});
