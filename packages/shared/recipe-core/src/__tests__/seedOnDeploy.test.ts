/**
 * WHICH STAGES MAY SEED THE RECIPE WORLD ON DEPLOY.
 *
 * ⛔ THE ANSWER IS AN ALLOWLIST, AND THE REASON IS WHAT THE SEED WRITES. `src/database/seed.ts` inserts
 * recipes and a collection owned by two FABRICATED subjects (`SEED_OWNER_FREE` / `SEED_OWNER_PRO`), and
 * some of them are public. Running it against production would put fake public recipes, owned by users
 * who do not exist, into the real discovery feed. So the predicate names the stages that MAY seed rather
 * than the ones that may not: a denylist (`stage !== 'prod'`) admits every value it failed to anticipate,
 * including an unset or misspelled stage, and the failure direction there is production.
 *
 * The per-PR form is the only non-prod stage this service has — `infra/bin/app.ts` REFUSES to deploy the
 * recipe service at `sandbox`, because there is no persistent non-prod instance; every PR deploys its own.
 */
import { describe, expect, it } from 'vitest';

import { seedsRecipeWorldOnDeploy } from '../seedOnDeploy.js';

describe('seedsRecipeWorldOnDeploy', () => {
    it.each(['pr-1', 'pr-7', 'pr-91', 'pr-1234'])('admits the per-PR stage %s', (stage) => {
        expect(seedsRecipeWorldOnDeploy(stage)).toBe(true);
    });

    it.each(['prod', 'Prod', 'PROD', 'production'])('refuses %s', (stage) => {
        expect(seedsRecipeWorldOnDeploy(stage)).toBe(false);
    });

    it.each(['sandbox', 'dev', 'test', 'local', 'staging', 'team-x'])('refuses the named stage %s', (stage) => {
        expect(seedsRecipeWorldOnDeploy(stage)).toBe(false);
    });

    it.each(['pr-', 'pr-7x', 'pr-7-prod', 'prod-pr-1', ' pr-7', 'pr-7 ', 'PR-7'])(
        'refuses %s, which only looks like a per-PR stage',
        (stage) => {
            // Anchored and digits-only. An unanchored or loose match is how `prod-pr-1` or a trailing
            // segment slips through — the same reasoning `PER_PR_ENVIRONMENT` in the sandbox scheduler
            // records, where a prefix rule would have admitted `prod` itself.
            expect(seedsRecipeWorldOnDeploy(stage)).toBe(false);
        },
    );

    it('fails CLOSED on an absent stage', () => {
        // `infra/bin/app.ts` defaults an unset STAGE to 'dev', but the predicate must not depend on that:
        // a caller that forgot to pass one gets the safe answer, not the permissive one.
        expect(seedsRecipeWorldOnDeploy(undefined)).toBe(false);
        expect(seedsRecipeWorldOnDeploy('')).toBe(false);
    });
});
