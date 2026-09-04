// @vitest-environment node
/**
 * Repo-wide guard: **every per-PR logical database is reachable by something that can drop it, and teardown
 * reaches it through the PLATFORM REAPER rather than through any per-service door.**
 *
 * ⚠️ REWRITTEN 2026-09-04 (ADR-0030), and the rewrite is a change of SUBJECT, not a relaxation. This file
 * used to prove that teardown could reach every service's own migration-runner door by SHAPE. Teardown no
 * longer invokes those doors at all: `teardown-sandbox-pr.sh` §1 now invokes `PerPrDatabaseReaperFunction`,
 * which lives in `DataStack` beside the instance, discovers its targets from `pg_database`, and needs no
 * service stack to exist. What is asserted here moved with it — see "What changed and why" below.
 *
 * ## The leak this exists to make impossible
 *
 * ADR-0006 gives every preview its own logical database on the shared instance, created by that service's
 * migration runner on first deploy and dropped by the same runner on PR close. Two exist today:
 * `kitchensink_food_pr_{N}` and `kitchensink_recipes_pr_{N}`.
 *
 * `.github/scripts/teardown-sandbox-pr.sh` §1 dropped exactly ONE of them. It hardcoded the stack name
 * `kitchensink-food-service-$PR` and the output key `FoodMigrationFunctionName`, so every reaped RECIPE
 * preview left `kitchensink_recipes_pr_{N}` behind — even though `RecipeServiceStack` exports
 * `RecipeMigrationFunctionName` and its handler implements `action: 'drop'` with the same base-name refusal
 * food's has. The capability was built, wired into CloudFormation, tested, and then never called.
 *
 * Nothing went red, and nothing could: the leak is invisible from inside the script (it drops what it was
 * told to drop and reports success), invisible in cost (a small empty database), and invisible in the
 * CloudFormation console (the stack deletes cleanly; the database is not its resource).
 *
 * ## ⛔ Why this guard ENUMERATES NOTHING
 *
 * The obvious guard is "assert the reaper knows about food and recipes". That is a COPY OF THE LIST, and a
 * copy of a list cannot detect that the list is incomplete — the exact reasoning
 * `natEgressConsumers.test.ts` and the `handle-sync-worker` incident record. A third service landing
 * tomorrow with its own per-PR database would pass such a guard on day one.
 *
 * So both sides are DISCOVERED:
 *
 * - **The databases** come from the infra tree: every call to a `*DatabaseNameForStage` function is a stack
 *   deriving a per-stage database name. That is the naming convention ADR-0006's two implementations already
 *   share, and it is what a third would copy.
 * - **The doors** come from the same tree: every `CfnOutput` whose logical id matches the migration-runner
 *   shape.
 *
 * Three claims:
 *
 * **1. ⛔ The reaper's base register covers every database FAMILY the tree derives — by EXACT EQUALITY, in
 * both directions.** This is the claim that keeps a third service's per-PR database from being silently
 * unreapable, and it is the one that replaced the old "reachable by pattern" argument. Both directions
 * matter for the same reason ADR-0004's consumer table is bidirectional: a family the register has not heard
 * of leaks forever, and a register entry for a family that no longer exists is a `DROP DATABASE` scope
 * nobody can justify. `PER_PR_DATABASE_BASE_BY_PRODUCER` is keyed by the producing function precisely so
 * this comparison is possible.
 *
 * **2. Every database FAMILY has at least one stack exporting a migration runner.** ⚠️ RE-JUSTIFIED, not
 * merely kept. Its old reason — "otherwise the database cannot be dropped at PR close" — is closed by
 * ADR-0030, which drops without any stack. Its CURRENT reason is the DEPLOY side: `prod-deploy.yml` and
 * `sandbox-deploy.yml` look up `IdentityMigrationFunctionName`, `FoodMigrationFunctionName` and
 * `RecipeMigrationFunctionName` by name to run migrations, so a family whose stacks export no runner has no
 * way to be migrated at all. Grouped by the name-producing function rather than by stack: a stack that
 * merely DERIVES a per-stage name is reading a database somebody else created.
 *
 * **3. The teardown script names no specific per-service door.** It must go through the reaper. This is what
 * stops a well-meaning change from re-introducing the per-stack path alongside it — two authorities for "how
 * a per-PR database is dropped" is the drift DRY governs, and the one that would rot is the one whose
 * failure mode is invisible.
 *
 * ## What changed and why, so the deletions are arguable rather than quiet
 *
 * - The old **claim 2** (the script selects doors by an anchored `# drop-door-pattern:` it publishes) and the
 *   two tests that read that pattern are GONE, along with the marker. The script no longer selects doors at
 *   all; a pattern with no reader is a guard that passes by describing nothing.
 * - The old **claim 3** (every stack that deploys a migration runner exports a door of its OWN) is GONE. Its
 *   entire argument was the partial-deploy leak: `RecipeWorkersStack`'s in-deploy trigger creates
 *   `kitchensink_recipes_pr_{N}` before `RecipeServiceStack` deploys, so a service deploy that wedges — as
 *   ADR-0007 × ADR-0022 wedged `kitchensink-recipe-service-pr-91` in `UPDATE_ROLLBACK_FAILED` — left a
 *   database whose only door was in a stack that did not exist. **The reaper closes that case strictly more
 *   completely**: it needs neither stack, so it also reclaims the database when BOTH are gone, which no
 *   per-stack door ever could. The coverage moved to claim 1 plus
 *   `tests/teardownPerPrDatabases.integration.test.ts`'s "reaps a PR whose stacks are all gone".
 *   ⚠️ Consequence worth knowing: `RecipeWorkersStack`'s `RecipeWorkersMigrationFunctionName` output is now
 *   referenced by nothing outside its own stack test.
 *
 * ## Mutation evidence (each applied, and the named test watched to fail)
 *
 * 1. `foodDatabaseNameForStage` removed from `PER_PR_DATABASE_BASE_BY_PRODUCER` → claim 1 reports it. This
 *    is the red-before-green run for "a third service's database is silently unreapable".
 * 2. A fictitious `billingDatabaseNameForStage` added to the register → claim 1 reports it from the other
 *    side, so the register cannot claim a `DROP DATABASE` scope the tree does not justify.
 * 3. `RecipeServiceStack`'s `RecipeMigrationFunctionName` output renamed to `RecipeMigrateFn` → claim 2
 *    reports `recipeDatabaseNameForStage`.
 * 4. §1 of the teardown script restored to its hardcoded `FoodMigrationFunctionName` literal → claim 3
 *    reports it.
 *
 * DESIGN PATTERN: Specification module over one parser — {@link databaseFamiliesIn} and {@link dropDoorsIn}
 * are pure verdicts over a source file, fired at deliberately-violating fakes below as well as at the tree.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { parse, referenceText, repoRoot, trackedFiles, visit, type SourceFile } from './serviceSources.js';
import { PER_PR_DATABASE_BASE_BY_PRODUCER } from '../src/db-reaper/perPrDatabaseScope.js';

/** The teardown script that must reach per-PR databases through the reaper, and through nothing else. */
const TEARDOWN_SCRIPT = '.github/scripts/teardown-sandbox-pr.sh';

/** A stack deriving a per-stage (and therefore per-PR) logical database name. */
interface DatabaseFamily {
    /** Repo-relative path of the stack that derives it. */
    readonly file: string;
    /** The name-producing function, e.g. `recipeDatabaseNameForStage`. This IS the database's identity. */
    readonly producer: string;
}

/** A `CfnOutput` publishing a migration runner's function name — the door teardown invokes to drop. */
interface DropDoor {
    /** Repo-relative path of the stack that exports it. */
    readonly file: string;
    /** The output's logical id, e.g. `RecipeMigrationFunctionName`. */
    readonly outputKey: string;
}

/**
 * Every per-stage database-name derivation in one infra source.
 *
 * Keys on the CALL, not on an import or a string: `recipeDatabaseNameForStage` is named in prose in four
 * files (`db.ts`'s docstring, `MessageSubstrateStack`'s comment, the handlers' "ACCEPTING side" notes), and a
 * grep would count every one of them as a database.
 *
 * @param source - One infra source file.
 * @returns One entry per derivation, in source order. Pure.
 */
function databaseFamiliesIn(source: SourceFile): readonly DatabaseFamily[] {
    const families: DatabaseFamily[] = [];

    visit(parse(source), (node) => {
        if (!ts.isCallExpression(node)) {
            return;
        }

        const callee = referenceText(node.expression);

        if (callee !== undefined && /DatabaseNameForStage$/.test(callee)) {
            families.push({ file: source.file, producer: callee });
        }
    });

    return families;
}

/**
 * Every migration-runner output published by one infra source.
 *
 * Reads the `CfnOutput` construct id rather than the `exportName` string: the id is what
 * `describe-stacks --query "Stacks[0].Outputs[?OutputKey==…]"` matches, and the export name is a different,
 * stack-qualified thing that teardown never looks at.
 *
 * @param source - One infra source file.
 * @returns One entry per matching output, in source order. Pure.
 */
function dropDoorsIn(source: SourceFile): readonly DropDoor[] {
    const doors: DropDoor[] = [];

    visit(parse(source), (node) => {
        if (!ts.isNewExpression(node) || referenceText(node.expression)?.endsWith('CfnOutput') !== true) {
            return;
        }

        const [, id] = node.arguments ?? [];

        if (id !== undefined && ts.isStringLiteral(id) && /MigrationFunctionName$/.test(id.text)) {
            doors.push({ file: source.file, outputKey: id.text });
        }
    });

    return doors;
}

/**
 * Every CDK stack source in the repo.
 *
 * Discovered from `git ls-files`, never enumerated — the same walk `natEgressConsumers.test.ts` uses, and for
 * the same reason: a service that lands tomorrow is covered the day its stack does.
 *
 * @returns The infra sources, read. Impure.
 * @sideEffect Shells out to git and reads the working tree.
 */
function infraSources(): readonly SourceFile[] {
    return [...trackedFiles('packages/services'), ...trackedFiles('packages/infra')]
        .filter((file) => /(?:^|\/)infra\/lib\//.test(file) || /^packages\/infra\/[^/]+\/lib\//.test(file))
        .filter((file) => file.endsWith('.ts') && !file.endsWith('.d.ts'))
        .map((file) => ({ file, contents: readFileSync(path.join(repoRoot, file), 'utf8') }));
}

describe('per-PR logical databases (ADR-0006) all have a drop door', () => {
    const sources = infraSources();
    const families = sources.flatMap((source) => databaseFamiliesIn(source));
    const doors = sources.flatMap((source) => dropDoorsIn(source));

    it('discovers both sides — a gate that finds nothing passes vacuously', () => {
        expect(
            families.length,
            'no per-stage database derivation found — the gate stopped discovering',
        ).toBeGreaterThan(0);
        expect(doors.length, 'no migration-runner output found — the gate stopped discovering').toBeGreaterThan(0);
    });

    it('⛔ is covered by the REAPER — its base register equals the families the tree derives', () => {
        // ⛔ THE CLAIM ADR-0030 RESTS ON. `teardown-sandbox-pr.sh` §1 invokes one reaper for the whole PR,
        // and the reaper drops exactly the names its register derives. A family missing from the register is
        // a per-PR database nothing will ever reclaim — and it leaks the way the recipe one did: invisibly,
        // because a logical database is not a CloudFormation resource and costs too little to notice.
        //
        // Equality, in BOTH directions, for the reason ADR-0004's consumer table is bidirectional: an
        // unregistered family leaks forever, and a registered family the tree no longer derives is a
        // `DROP DATABASE` scope nobody can justify.
        expect(
            [...new Set(families.map(({ producer }) => producer))].sort(),
            'the reaper (packages/infra/global/src/db-reaper/perPrDatabaseScope.ts) derives the names it is ' +
                'allowed to drop from PER_PR_DATABASE_BASE_BY_PRODUCER. A `*DatabaseNameForStage` producer ' +
                'the register has not heard of is a per-PR database no teardown can reclaim; a register ' +
                'entry with no producer in the tree is a drop scope nothing justifies.',
        ).toEqual(Object.keys(PER_PR_DATABASE_BASE_BY_PRODUCER).sort());
    });

    it('gives every database FAMILY at least one stack that exports a migration runner', () => {
        // Grouped by the producing function, not by stack: `recipeDatabaseNameForStage` is called by both
        // `RecipeServiceStack` and `RecipeWorkersStack` for the SAME database, and only the service stack
        // needs to own the door. A per-stack rule would demand a redundant second runner on the workers
        // stack and would be wrong about the world.
        const doorFiles = new Set(doors.map(({ file }) => file));
        const withoutDoor = [
            ...new Set(
                families
                    .filter(({ producer }) =>
                        families
                            .filter((family) => family.producer === producer)
                            .every(({ file }) => !doorFiles.has(file)),
                    )
                    .map(({ producer }) => producer),
            ),
        ].sort();

        expect(
            withoutDoor,
            'a per-PR database family whose stacks export no *MigrationFunctionName cannot be MIGRATED: ' +
                'prod-deploy.yml and sandbox-deploy.yml look those outputs up by name to run the schema ' +
                "migrations. (Reclaiming it is ADR-0030's reaper's job, not this output's, since 2026-09-04.)",
        ).toEqual([]);
    });

    it('⛔ is reclaimed through the REAPER — the teardown script names no per-service door', () => {
        const script = readFileSync(path.join(repoRoot, TEARDOWN_SCRIPT), 'utf8');
        // Strip comments before looking for literals: the script EXPLAINS the food-only bug it used to have,
        // and a textual gate that fired on its own rationale would get deleted. Same trap
        // `reclaimableStackImports.test.ts` fell into on its first draft.
        const code = script
            .split('\n')
            .filter((line) => !/^\s*#/.test(line))
            .join('\n');
        const named = [...new Set(doors.map(({ outputKey }) => outputKey))].filter((key) => code.includes(key)).sort();

        expect(
            named,
            'teardown must reclaim per-PR databases through PerPrDatabaseReaperFunction (ADR-0030), which ' +
                'needs no service stack to exist. Naming a per-service door here re-introduces the path ' +
                'that could not reach a database whose stack was gone or wedged — and a second authority ' +
                'for "how a per-PR database is dropped" is the drift DRY governs.',
        ).toEqual([]);
    });

    it('invokes the reaper by the output DataStack publishes', () => {
        // The positive half: "names no door" is satisfied by a script that drops nothing at all. Pinned to
        // the output key rather than a function name, because the name is CloudFormation-generated.
        const script = readFileSync(path.join(repoRoot, TEARDOWN_SCRIPT), 'utf8');

        expect(script).toContain('PerPrDatabaseReaperFunctionName');
        expect(script).toMatch(/"action\\":\\"drop/);
    });
});

describe('the discovery predicates read code, not prose', () => {
    it('counts a derivation call but not a docstring naming the same function', () => {
        const found = databaseFamiliesIn({
            file: 'fake/Prose.ts',
            contents: `
                /** Mirrors foodDatabaseNameForStage, which this stack does not call. */
                const note = 'recipeDatabaseNameForStage is the only producer of these names';
                const name = recipeDatabaseNameForStage(stage, baseStage, imported);
            `,
        });

        expect(found.map(({ producer }) => producer)).toEqual(['recipeDatabaseNameForStage']);
    });

    it('counts a CfnOutput but not a comment quoting an output key', () => {
        const found = dropDoorsIn({
            file: 'fake/Outputs.ts',
            contents: `
                // Replaces kitchensink-identity-webhooks-{stage}:MigrationFunctionName, which is gone.
                new CfnOutput(this, 'RecipeServiceUrl', { value: url });
                new CfnOutput(this, 'FoodMigrationFunctionName', { value: fn.functionName });
            `,
        });

        expect(found.map(({ outputKey }) => outputKey)).toEqual(['FoodMigrationFunctionName']);
    });
});
