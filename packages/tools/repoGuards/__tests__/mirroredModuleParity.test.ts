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

import { productionSources, readSource, withoutTsComments } from './roleSplitSources.js';

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
    {
        // ADR-0060. Its natural home, `@radicle-co/infra-shared`, is consumed at a pinned PUBLISHED version only a
        // commit may move, so a new export there cannot reach the apps in the change that adds it. DISCOVERED, not
        // listed: every app that owns a scheduled rule carries one (`nonProdScheduledRules.test.ts`), so the copies
        // are found by name and a fourth is held to the other three the day it lands.
        what: 'the non-prod scheduled-rule gate',
        files: productionSources().filter((file) => file.endsWith('/infra/lib/scheduledRuleGate.ts')),
    },
    {
        // ADR-0062. Same reason as the scheduled-rule gate: its natural home, `@radicle-co/infra-shared`, is consumed at a
        // pinned PUBLISHED version only a commit may move. DISCOVERED, not listed: every app that owns an alarm topic
        // subscribes the relay through one, so a new owner is held to the others the day its copy lands — and
        // `alarmRelayExportContract.test.ts` holds the export name every copy imports to the one the relay stack exports.
        what: 'the alarm relay subscription',
        files: productionSources().filter(
            (file) =>
                file.endsWith('/lib/alarmRelaySubscription.ts') ||
                file.endsWith('/lib/platform/alarmRelaySubscription.ts'),
        ),
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

    it('every group holds at least two copies — a group of one compares nothing', () => {
        for (const group of MIRROR_GROUPS) {
            expect(group.files.length, group.what).toBeGreaterThanOrEqual(2);
        }
    });

    it('names files that exist — a renamed mirror must update this list, not silently stop being checked', () => {
        for (const group of MIRROR_GROUPS) {
            for (const path of group.files) {
                expect(() => readSource(path), path).not.toThrow();
            }
        }
    });
});
