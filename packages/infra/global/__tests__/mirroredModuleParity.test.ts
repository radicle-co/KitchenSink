// @vitest-environment node
/**
 * Repo-wide guard: **the modules a service MIRRORS from another service stay identical.**
 *
 * ## Why these are copies at all
 *
 * Each group below is one rule implemented once per service, where the only difference is the domain noun
 * (`food` vs `recipe` vs `identity`) and the constants that name it. They are duplicated because the
 * obvious shared home is unavailable, and the reason differs per group — it is recorded on each group so
 * nobody re-litigates it from scratch:
 *
 * - **`contractSkew`** — its natural home, `@kitchensink/contract-gen`, is a devDependency, and this check
 *   runs from `src/main.ts` on the PRODUCTION boot path. Moving it there would put a dev-only package (and
 *   `typescript` with it) into the pruned runtime image.
 * - **the service-principal erasure auth family** — the token CONTRACT already lives in
 *   `@kitchensink/recipe-core`, but the VERIFIER needs `jose`, and `recipe-core` is imported by the mobile
 *   app and two feature packages. Putting a crypto library there pushes it into client bundles.
 *
 * Both are packaging decisions with deploy-image consequences, not cleanups. What this guard removes is the
 * only thing that actually costs anything while they stay duplicated: **silent drift**.
 *
 * ## That drift is not hypothetical
 *
 * All three `contractSkew.ts` carried an explanation of what the check proves. One was corrected — *"AN
 * EARLIER VERSION OF THIS COMMENT OVERCLAIMED, and the correction matters because false assurance in a
 * comment is worse than no comment"* — and the other two kept the overclaim for months. A reader had to
 * diff three files to learn which account was current.
 *
 * Its sibling: `recipeDatabaseNameForStage` took a CodeQL ReDoS fix that `foodDatabaseNameForStage` never
 * got, and nothing connected them.
 *
 * ## What is compared
 *
 * The files, with comments stripped and the domain noun normalised, must be IDENTICAL. Comments are
 * stripped because a docstring legitimately names its own service; the assertion is about the code. A
 * difference that is genuinely intended must be made explicit — parameterise it, or split the group and say
 * why — rather than accumulating silently.
 */
import { describe, expect, it } from 'vitest';

import { readSource, withoutTsComments } from './roleSplitSources.js';

/** One rule, implemented once per service. */
interface MirrorGroup {
    readonly what: string;
    readonly files: readonly string[];
}

/**
 * Every token that names a domain in these files, with any adjoining underscore.
 *
 * ⚠️ The underscore matters: recipe's names came first and are UNSUFFIXED (`SERVICE_ERASURE_TOKEN_AUDIENCE`,
 * `ServiceErasureAuthService`) while food's carry the domain (`…_AUDIENCE_FOOD`, `FoodServiceErasureAuthService`).
 * That asymmetry is naming, not logic, so it is normalised away rather than reported — the symmetric rename
 * would touch a shared package's exported surface and belongs in its own change.
 */
const DOMAIN_TOKENS = /_?(?:FOOD|RECIPE|IDENTITY|Food|Recipe|Identity|food|recipe|identity)_?/g;

const MIRROR_GROUPS: readonly MirrorGroup[] = [
    {
        what: 'the boot-time contract-hash skew check',
        files: [
            'packages/services/food-service/src/contract/contractSkew.ts',
            'packages/services/identity/src/contract/contractSkew.ts',
            'packages/services/recipe-service/src/contract/contractSkew.ts',
        ],
    },
    {
        what: 'the service-principal erasure token verifier',
        files: [
            'packages/services/food-service/src/auth/foodServiceErasureAuth.service.ts',
            'packages/services/recipe-service/src/auth/serviceErasureAuth.service.ts',
        ],
    },
    {
        what: 'the Authorization: Bearer parser',
        files: [
            'packages/services/food-service/src/auth/bearer.ts',
            'packages/services/recipe-service/src/auth/bearer.ts',
        ],
    },
    {
        what: 'the service-principal request augmentation',
        files: [
            'packages/services/food-service/src/auth/servicePrincipal.ts',
            'packages/services/recipe-service/src/auth/servicePrincipal.ts',
        ],
    },
    {
        what: 'the service-principal parameter decorator',
        files: [
            'packages/services/food-service/src/auth/servicePrincipal.decorator.ts',
            'packages/services/recipe-service/src/auth/servicePrincipal.decorator.ts',
        ],
    },
];

/** A file's code, with comments gone and every domain noun collapsed to one token. Pure. */
function comparable(path: string): string {
    return withoutTsComments(readSource(path)).replace(DOMAIN_TOKENS, '').replace(/\s+/gu, ' ').trim();
}

describe('mirrored service modules', () => {
    it.each(MIRROR_GROUPS.map((group) => [group.what, group] as const))(
        '⛔ %s is identical in every service that carries it',
        (_what, group) => {
            const [first, ...rest] = group.files;
            const reference = comparable(first as string);

            for (const path of rest) {
                expect(comparable(path), `${path} has drifted from ${first as string}`).toBe(reference);
            }
        },
    );

    it('names files that exist — a renamed mirror must update this list, not silently stop being checked', () => {
        for (const group of MIRROR_GROUPS) {
            for (const path of group.files) {
                expect(() => readSource(path), path).not.toThrow();
            }
        }
    });
});
