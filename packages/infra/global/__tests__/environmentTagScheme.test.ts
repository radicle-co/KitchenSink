// @vitest-environment node
/**
 * Repo-wide guard: the `Environment` tag VALUES the CDK apps emit are exactly the values the reclamation
 * path selects on — in BOTH directions.
 *
 * ## Why a second suite beside `environmentTagCoverage.test.ts`
 *
 * That one asks "does every app tag at all", which is a question about presence. This one asks the question
 * presence cannot answer: **what string comes out, and what does the teardown do with it.** They were the
 * same question only while the answer was a constant. It stopped being a constant when the scheme became
 * `pr-{N}-sandbox` for an ephemeral preview and `sandbox` / `production` for the persistent tier — a value
 * with structure, produced by an expression, read by a matcher in another language.
 *
 * ## The two failures this pins, which are the two ADR-0005 names
 *
 * 1. **A preview nothing reclaims.** The producer moves and the selector does not: every sweep still runs,
 *    matches nothing, and reports success. That is the expensive direction and the silent one — it is how
 *    22 Container Insights log groups accumulated behind a routine that looked implemented.
 * 2. **Something shared, deleted.** The new scheme introduced a collision the old one could not have: the
 *    per-PR value `pr-{N}-sandbox` now CONTAINS the persistent value `sandbox`, where `pr-{N}` and `global`
 *    shared no substring at all. So "can a per-PR matcher reach a persistent value" is a question that must
 *    be answered rather than assumed, and it is answered here against the real `bash` predicates.
 *
 * ## Why the value is EVALUATED rather than pattern-matched
 *
 * The tag's value is an expression over `stage`, so the only honest way to learn what an app emits is to
 * run it. The expression's SOURCE is lifted out by `appTagValueSource` — the same AST reader the coverage
 * guard uses, so the two cannot disagree about which call is the tag — and evaluated with the stage bound.
 * A regex over the source would be a THIRD spelling of the scheme, free to drift from both the code that
 * produces it and the shell that consumes it; that is precisely the "copy of a list" failure ADR-0025 §3
 * records, one representation up.
 *
 * ⚠️ The per-PR population is likewise DERIVED BEHAVIOURALLY — an app is per-PR-capable iff its value
 * CHANGES with the stage — not from the spelling of its condition. An app that produced a constant would
 * simply not be asked the per-PR questions, which is correct, and a fifth service that ships the three-way
 * expression is covered the day it is committed.
 *
 * DESIGN PATTERN: Specification module over a derived set — the producer (TypeScript) and the selector
 * (bash) are each read from their real source and compared, so neither side can move alone.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { cdkApps } from './cdkApps.js';
import { appTagValueSource } from './appTags.js';
import { presentFiles, repoRoot } from './serviceSources.js';

/** The tag key ADR-0005 reclaims by. */
const ENVIRONMENT_TAG = 'Environment';

/** The scope predicates the teardown actually runs — executed, never re-implemented. */
const SCOPE_SCRIPT = fileURLToPath(new URL('../../../../.github/scripts/pr-scope.sh', import.meta.url));

/** The value every stage that is neither `prod` nor a preview must produce. */
const PERSISTENT_NON_PROD = 'sandbox';

/** The value the production stage must produce. */
const PERSISTENT_PROD = 'production';

/**
 * The ACCOUNT-scoped value — a third category, not a third spelling of "persistent".
 *
 * `sandbox` and `production` name a STAGE: there is one of each shared platform per stage. `global` names
 * the whole AWS account: one budget, one anomaly monitor, watching every stage's spend including sandbox's.
 * The two are different kinds of thing, and collapsing them is what let an account-scoped stack be reachable
 * only through `if (stage === 'prod')` and be labelled `production` as a result.
 *
 * It is admitted here for the same reason the tier words are: it carries no digits, so no `pr-{N}` matcher
 * can claim it — which is the property this block actually enforces, asserted below for every token.
 */
const ACCOUNT_SCOPED = 'global';

/**
 * The stages a deploy can actually name, and what tier each belongs to.
 *
 * `prod` is the literal `prod-deploy.yml` exports as `STAGE`; `sandbox` is the shared tier every preview
 * signs in against; `dev`/`local` are the named non-PR stages `packages/infra/alb` already registers.
 */
const PERSISTENT_STAGES = ['sandbox', 'dev', 'local', 'test'] as const;

/** Preview stages, including the adversarial neighbours a delimiter rule has to separate. */
const PREVIEW_STAGES = ['pr-1', 'pr-15', 'pr-91', 'pr-100', 'pr-999'] as const;

/**
 * The value an app's `Environment` expression produces for a stage.
 *
 * @param app - Repo-relative entrypoint path.
 * @param stage - The stage to bind.
 * @returns The tag value. Impure — reads the entrypoint.
 * @sideEffect Reads the app's source file.
 */
function environmentTagFor(app: string, stage: string): string {
    const absolute = path.join(repoRoot, app);
    const expression = appTagValueSource(readFileSync(absolute, 'utf8'), absolute, ENVIRONMENT_TAG);

    if (expression === undefined) {
        throw new Error(`${app} applies no ${ENVIRONMENT_TAG} tag to the app it constructs`);
    }

    // The app's own expression, run with the one free variable bound. Not a re-implementation of it.
    return String(new Function('stage', `return (${expression});`)(stage));
}

/**
 * Ask a real scope predicate.
 *
 * @param args - `<predicate> <token> [candidate]`.
 * @returns The exit status (0 = yes, 1 = no, 2 = misuse). Impure.
 * @sideEffect Spawns `bash`.
 */
function scope(...args: readonly string[]): number {
    const result = spawnSync('bash', [SCOPE_SCRIPT, ...args], { encoding: 'utf8' });

    if (result.error) {
        throw result.error;
    }

    return result.status ?? -1;
}

/** The `Values=` filter list the two tag sweeps pass to the tagging API, for one token. */
function tagFilterValues(token: string): readonly string[] {
    const result = spawnSync('bash', [SCOPE_SCRIPT, 'env-tag-values', token], { encoding: 'utf8' });

    expect(result.status, `pr-scope.sh refused to print a filter for ${token}`).toBe(0);

    return result.stdout.trim().split(',');
}

const apps = cdkApps();

/** The apps whose tag value is a FUNCTION of the stage — i.e. the ones that can deploy a preview. */
const perPrApps = apps.filter((app) => environmentTagFor(app, 'pr-999') !== environmentTagFor(app, 'sandbox'));

/**
 * The ACCOUNT-scoped apps: their value is a constant that names no stage at all.
 *
 * ⛔ A THIRD CATEGORY, not a third spelling of the second. `sandbox` and `production` name a STAGE — there
 * is one shared platform per stage. `global` names the whole AWS ACCOUNT: one budget, one anomaly monitor,
 * watching every stage's spend including sandbox's. Collapsing the two is what let an account-scoped stack
 * be reachable only through `if (stage === 'prod')` and be labelled `production` as a consequence.
 *
 * Derived, not listed: an app is account-scoped iff it answers `global` at the production stage. An app
 * that stops doing so leaves this population and is judged as a stage app instead, which is the correct
 * direction — the categories are defined by what the code emits, never by which file it is.
 */
const accountApps = apps.filter((app) => environmentTagFor(app, 'prod') === ACCOUNT_SCOPED);

/** The STAGE-shared apps: a constant per stage — the persistent tier, which must never produce a preview. */
const persistentApps = apps.filter((app) => !perPrApps.includes(app) && !accountApps.includes(app));

describe('the Environment tag scheme, as the CDK apps actually emit it', () => {
    it('finds every app and can evaluate every expression', () => {
        // Non-vacuity. `it.each` over an empty derivation is a green suite that asserts nothing, and both
        // populations below are filters of this one.
        expect(apps.length).toBeGreaterThanOrEqual(9);
        expect(perPrApps.length).toBeGreaterThanOrEqual(5);
        expect(persistentApps.length).toBeGreaterThanOrEqual(3);
        expect(accountApps.length).toBeGreaterThanOrEqual(1);
    });

    it.each([...perPrApps, ...persistentApps])('%s tags the production stage `production`', (app) => {
        expect(environmentTagFor(app, 'prod')).toBe(PERSISTENT_PROD);
    });

    it.each(
        [...perPrApps, ...persistentApps].flatMap((app) => PERSISTENT_STAGES.map((stage) => [app, stage] as const)),
    )('%s tags the persistent stage %s `sandbox`', (app, stage) => {
        expect(environmentTagFor(app, stage)).toBe(PERSISTENT_NON_PROD);
    });

    // ⛔ The account-scoped apps answer the SAME value for every stage they are handed, including stages
    // that do not exist. That is the executable form of "this app has no stage": not a guard that refuses
    // the wrong stage, but an expression in which the stage is not an input at all.
    it.each(
        accountApps.flatMap((app) =>
            ['prod', ...PERSISTENT_STAGES, ...PREVIEW_STAGES].map((stage) => [app, stage] as const),
        ),
    )('%s tags %s `global` — the stage is not an input', (app, stage) => {
        expect(environmentTagFor(app, stage)).toBe(ACCOUNT_SCOPED);
    });

    it.each(perPrApps.flatMap((app) => PREVIEW_STAGES.map((stage) => [app, stage] as const)))(
        '%s tags the preview stage %s `%s-sandbox`',
        (app, stage) => {
            expect(environmentTagFor(app, stage)).toBe(`${stage}-sandbox`);
        },
    );

    // ⛔ The persistent apps deploy no preview and must not be able to invent one. `packages/infra/global`
    // owns the VPC and the RDS instance; a stage-dependent value there would put the shared data tier one
    // mis-set variable away from a per-PR sweep, which is the single outcome ADR-0005 exists to prevent.
    it.each(persistentApps.flatMap((app) => PREVIEW_STAGES.map((stage) => [app, stage] as const)))(
        '%s cannot emit a preview value even when handed the stage %s',
        (app, stage) => {
            expect(environmentTagFor(app, stage)).toBe(PERSISTENT_NON_PROD);
        },
    );
});

describe('every value a preview can carry IS reclaimed (nothing becomes unreapable)', () => {
    it.each(perPrApps.flatMap((app) => PREVIEW_STAGES.map((stage) => [app, stage] as const)))(
        "%s's %s tag is claimed by that PR's teardown",
        (app, stage) => {
            expect(scope('env-tag-belongs', stage, environmentTagFor(app, stage))).toBe(0);
        },
    );

    // ⛔ The equality read (teardown §2, per stack) and the API filter (teardown §3 and `ecs-quiesce.sh`,
    // everything a stack does not own) are two different code paths asking one question. A value the first
    // claims but the second does not enumerate is a resource deleted only when a stack happened to own it.
    it.each(perPrApps.flatMap((app) => PREVIEW_STAGES.map((stage) => [app, stage] as const)))(
        "%s's %s tag is enumerated in the tag-sweep filter",
        (app, stage) => {
            expect(tagFilterValues(stage)).toContain(environmentTagFor(app, stage));
        },
    );

    // The legacy spelling has to stay claimable for as long as resources carry it — six `pr-91` stacks did
    // at the moment the scheme changed, and the sweep is their only reclamation.
    it.each(PREVIEW_STAGES)('still claims the pre-change bare token %s', (stage) => {
        expect(scope('env-tag-belongs', stage, stage)).toBe(0);
        expect(tagFilterValues(stage)).toContain(stage);
    });
});

describe('no persistent or account value is EVER claimed by a per-PR teardown', () => {
    /**
     * Every value a non-preview app can carry, derived from the same expressions.
     *
     * ⚠️ This set now spans BOTH surviving categories — the stage tier (`sandbox`, `production`) and the
     * account scope (`global`) — and it should: what makes a value safe here is not which category it is in
     * but that no `pr-{N}` matcher can claim it. Deriving them together means a fourth category invented
     * tomorrow is judged by the same rule automatically, instead of being added to a list someone has to
     * remember.
     */
    const persistentValues = [
        ...new Set(
            apps.flatMap((app) => [
                environmentTagFor(app, 'prod'),
                ...PERSISTENT_STAGES.map((s) => environmentTagFor(app, s)),
            ]),
        ),
    ];

    it('derives the persistent values from the apps rather than restating them', () => {
        expect(persistentValues.toSorted()).toStrictEqual(
            [PERSISTENT_PROD, PERSISTENT_NON_PROD, ACCOUNT_SCOPED].toSorted(),
        );
    });

    // ⛔ THE COLLISION THE NEW SCHEME CREATED. `pr-{N}-sandbox` contains `sandbox`; `pr-{N}` contained no
    // part of `global`. Every matcher is asked, including `path-belongs`, which is the loose one — it finds
    // its token delimited by `/` or `-` ANYWHERE inside a string, so it is the one that could plausibly be
    // fooled. It cannot be: the token always carries digits and no value in this set contains one.
    it.each(persistentValues.flatMap((value) => PREVIEW_STAGES.map((token) => [token, value] as const)))(
        'refuses %s → %s under every matcher',
        (token, value) => {
            expect(scope('env-tag-belongs', token, value), 'tag equality').toBe(1);
            expect(scope('belongs', token, value), 'name prefix').toBe(1);
            expect(scope('path-belongs', token, value), 'path anchor').toBe(1);
            expect(tagFilterValues(token)).not.toContain(value);
        },
    );

    // The two classes must not merely be un-matchable — they must be disjoint as SETS, so no future stage
    // name can be read as belonging to both tiers at once.
    it('keeps the preview and persistent value spaces disjoint', () => {
        const previewValues = new Set(
            perPrApps.flatMap((app) => PREVIEW_STAGES.map((stage) => environmentTagFor(app, stage))),
        );

        for (const value of persistentValues) {
            expect(previewValues.has(value), `${value} is emitted by both tiers`).toBe(false);
        }
    });
});

describe('a stack-level override can only ever name the persistent tier', () => {
    // ⛔ WHY THIS EXISTS AT ALL. A `Tags.of(this)` inside a stack overrides the app-level aspect for that
    // stack's resources, so it is a SECOND authority over the one value the teardown selects on — exactly
    // what `ingredient-parser/infra/bin/app.ts` warns is "how the teardown selector and the deploy drift
    // apart". One such override is legitimate — `CostGuardrailsStack` is ACCOUNT-scoped, deployed by an app
    // (`bin/account.ts`) that has no stage to derive a value from — and the rule that keeps it safe is that
    // no override may name a value a `pr-{N}` teardown could claim.
    const overrides = presentFiles(['packages/**/*.ts'])
        .flatMap((file) => {
            const source = readFileSync(path.join(repoRoot, file), 'utf8');

            return [...source.matchAll(/Tags\.of\(this\)\.add\(\s*'Environment',\s*'([^']*)'/gu)].map((match) => ({
                file,
                value: match[1] ?? '',
            }));
        })
        .filter(({ file }) => !file.includes('__tests__'));

    it('finds the overrides it judges', () => {
        // Non-vacuity, and deliberately not a count: if the last override is removed this becomes an empty
        // population, which is the SAFE state — so the assertion is that the reader still works, proven by
        // the negative case below rather than by a number that would have to be maintained.
        expect(overrides.every(({ value }) => value.length > 0)).toBe(true);
    });

    it.each(overrides.map(({ file, value }) => [file, value] as const))(
        '%s overrides Environment to %s — a tier or account word, unclaimable by any PR',
        (file, value) => {
            expect(
                [PERSISTENT_PROD, PERSISTENT_NON_PROD, ACCOUNT_SCOPED],
                `${file} names a value outside the scheme`,
            ).toContain(value);

            for (const token of PREVIEW_STAGES) {
                expect(scope('env-tag-belongs', token, value), `${token} could claim ${file}`).toBe(1);
            }
        },
    );
});

describe('both sweeps read the shared predicate rather than spelling the filter themselves', () => {
    /** The two scripts that select AWS resources by this tag. */
    const readers = ['.github/scripts/teardown-sandbox-pr.sh', '.github/scripts/ecs-quiesce.sh'] as const;

    it.each(readers)('%s derives its Environment filter from pr-scope.sh', (script) => {
        const source = readFileSync(path.join(repoRoot, script), 'utf8');

        // ⛔ A LITERAL `Values=$PR` IS THE BUG, not a style choice: it is what the tagging API matched
        // exactly, and what silently matched nothing the moment the emitted value gained a suffix.
        expect(source, `${script} still spells the tag filter inline`).toMatch(/pr_scope_environment_tag_values/u);
        expect(source).not.toMatch(/Key=Environment,Values=\$\{?(?:PR|pr)\}?"/u);
    });

    it('teardown reads a stack tag through the predicate, not a bare equality', () => {
        const source = readFileSync(path.join(repoRoot, readers[0]), 'utf8');

        expect(source).toMatch(/pr_scope_environment_tag_belongs/u);
        // The exact comparison that stopped being true. `$envtag` is the value read out of `describe-stacks`.
        expect(source).not.toMatch(/\[\s*"\$envtag"\s*=\s*"\$PR"\s*\]/u);
    });
});
