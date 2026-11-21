/**
 * The reason names `publicRefusalOf` returns are the recipe state model's refusal names (board P6, plan
 * makePublicRefusalNotice U1). The model is a repo document with no package of its own, so the check lives here and
 * reads both files as text: a name the model does not list would make the editor and the recipe page speak of a
 * refusal the state model never defined.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// .../packages/tools/repoGuards/__tests__ → repo root is four levels up.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

const modelReasons = (): string[] => {
    const model: unknown = JSON.parse(
        readFileSync(path.join(repoRoot, 'docs/architecture/recipeStateModel.json'), 'utf8'),
    );
    const refusals = typeof model === 'object' && model !== null && 'refusals' in model ? model.refusals : undefined;

    return Array.isArray(refusals)
        ? refusals.flatMap((refusal: unknown) =>
              typeof refusal === 'object' &&
              refusal !== null &&
              'reason' in refusal &&
              typeof refusal.reason === 'string'
                  ? [refusal.reason]
                  : [],
          )
        : [];
};

/** The quoted names of the `PUBLIC_REFUSALS` array in the source, minus the `none` that means no refusal. */
const shownReasons = (): string[] => {
    const source = readFileSync(
        path.join(repoRoot, 'packages/apps/commise/features/recipes/src/actions/publicRefusal.ts'),
        'utf8',
    );
    const body = /export const PUBLIC_REFUSALS = \[([^\]]*)\] as const;/.exec(source)?.[1] ?? '';

    return [...body.matchAll(/'([^']+)'/g)].map(([, name]) => name).filter((name) => name !== 'none');
};

describe('publicRefusalOf: the reason names are the state model’s', () => {
    it('finds the names it checks', () => {
        expect(modelReasons().length).toBeGreaterThan(0);
        expect(shownReasons().length).toBeGreaterThan(0);
    });

    it('uses only refusal names that docs/architecture lists for the reasons P6 shows', () => {
        const names = modelReasons();

        expect(shownReasons().filter((reason) => !names.includes(reason))).toEqual([]);
    });
});
