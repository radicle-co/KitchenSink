// @vitest-environment node
/**
 * Repo-wide guard: **every per-PR logical database has a door teardown can reach, and teardown reaches it by
 * SHAPE rather than by a list.**
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
 * The obvious guard is "assert the teardown script mentions both output keys". That is a COPY OF THE LIST,
 * and a copy of a list cannot detect that the list is incomplete — the exact reasoning
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
 * Then two claims, in both directions:
 *
 * **1. Every database FAMILY has at least one door.** Grouped by the name-producing function rather than by
 * stack: a stack that merely DERIVES a per-stage name is reading a database somebody else created, and
 * demanding a runner from it would be wrong about the world.
 *
 * **2. The teardown script names no specific door.** It must select by the anchored pattern it publishes,
 * and every discovered door must match that pattern. This is the direction that actually catches the recipe
 * leak: with §1 hardcoding `FoodMigrationFunctionName`, claim 1 passes (recipe HAS a door) and claim 2 fails
 * (the script cannot reach it).
 *
 * **3. Every stack that DEPLOYS a migration runner has a door of its own.** ⚠️ This claim CORRECTS a
 * sentence that used to stand in claim 1: that one door between `RecipeServiceStack` and
 * `RecipeWorkersStack` was enough because they share one database, and that a second would be "redundant".
 * Redundant only while both stacks exist. `deploy-recipe` deploys workers FIRST, with two hard-failing steps
 * before the service's `cdk deploy`, and the service deploy has its own failure modes — ADR-0007 × ADR-0022
 * wedged `kitchensink-recipe-service-pr-91` in `UPDATE_ROLLBACK_FAILED` against the nightly-stopped RDS. The
 * workers' in-deploy trigger has ALREADY run `ensureDatabaseExists` by that point, so the PR is left holding
 * a database whose only door is in a stack that does not exist. Claim 1 cannot see that, because it groups
 * by what the SOURCE says rather than by what a stage HAS.
 *
 * Claims 1 and 3 are both kept and neither implies the other: 1 catches a database nobody can drop at all,
 * 3 catches one that becomes undroppable in a partial deploy.
 *
 * The pattern itself is read FROM the script, so the script stays the single authority for what a drop door
 * looks like and this file cannot drift from it.
 *
 * ## Mutation evidence (each applied, and the named test watched to fail)
 *
 * 1. `RecipeServiceStack`'s `RecipeMigrationFunctionName` output renamed to `RecipeMigrateFn` → claim 1
 *    reports `recipeDatabaseNameForStage`, and claim 2's coverage assertion also reports it. Two tests, so
 *    neither is load-bearing alone.
 * 2. §1 of the teardown script restored to its hardcoded `FoodMigrationFunctionName` literal → claim 2
 *    reports it. This is the red-before-green run for the real defect.
 * 3. `RecipeWorkersStack`'s `recipeDatabaseNameForStage` call deleted → claim 1 still passes, confirming it
 *    groups by FAMILY. Claim 3 still reports the stack, because claim 3 keys on the RUNNER, which is the
 *    thing that creates a database.
 * 4. The pattern in the script widened to `MigrationFunctionName` (unanchored) → the pattern-shape test
 *    reports it, so a "fix" that makes the script match more than the convention allows cannot pass.
 * 5. `RecipeWorkersStack`'s `RecipeWorkersMigrationFunctionName` output deleted → claim 3 reports it and
 *    claim 1 does not. That is the red-before-green run for the partial-deploy leak, and the pair of
 *    outcomes is the evidence that the two claims ask different questions.
 *
 * DESIGN PATTERN: Specification module over one parser — {@link databaseFamiliesIn} and {@link dropDoorsIn}
 * are pure verdicts over a source file, fired at deliberately-violating fakes below as well as at the tree.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
    MIGRATION_RUNNER_HANDLER,
    parse,
    referenceText,
    repoRoot,
    stringLiterals,
    trackedFiles,
    visit,
    type SourceFile,
} from './serviceSources.js';

/** The teardown script that must be able to reach every door. */
const TEARDOWN_SCRIPT = '.github/scripts/teardown-sandbox-pr.sh';

/** Delimits the anchored drop-door pattern the script publishes, so this guard reads it rather than a copy. */
const PATTERN_MARKER = '# drop-door-pattern:';

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
 * Whether one infra source DEPLOYS an ADR-0022 schema-migration runner.
 *
 * ⛔ This is a different question from "does this stack name a per-stage database", and the difference is the
 * whole of claim 3 below. A stack that merely derives a name reads a database somebody else created; a stack
 * that ships a RUNNER creates it — `ensureDatabaseExists` runs inside its in-deploy trigger — so it can bring
 * a per-PR database into existence entirely on its own.
 *
 * Keyed on the handler string VALUE, defined once in `serviceSources.ts` and shared with
 * `schemaMigrationBarrier.test.ts`, so prose describing a runner cannot satisfy it.
 *
 * @param source - One infra source file.
 * @returns `true` when the file bundles a migration runner. Pure.
 */
function shipsMigrationRunner(source: SourceFile): boolean {
    return stringLiterals(source).includes(MIGRATION_RUNNER_HANDLER);
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

/**
 * The anchored drop-door pattern the teardown script publishes.
 *
 * @returns The pattern, compiled. Impure.
 * @sideEffect Reads the teardown script.
 */
function scriptDropDoorPattern(): RegExp {
    const script = readFileSync(path.join(repoRoot, TEARDOWN_SCRIPT), 'utf8');
    const declared = new RegExp(`${PATTERN_MARKER}\\s*(\\S+)`).exec(script)?.[1];

    expect(declared, `${TEARDOWN_SCRIPT} must publish its drop-door pattern after "${PATTERN_MARKER}"`).toBeDefined();

    return new RegExp(declared ?? '');
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
            'a per-PR database whose stacks export no *MigrationFunctionName cannot be dropped at PR close, ' +
                'and the database leaks silently on every reap',
        ).toEqual([]);
    });

    it('⛔ gives every stack that DEPLOYS a migration runner a drop door OF ITS OWN', () => {
        // ⛔ THE CLAIM ABOVE IS NECESSARY AND NOT SUFFICIENT, and this is why. Claim 1 groups by database
        // FAMILY on the reasoning that `RecipeServiceStack` and `RecipeWorkersStack` share one database, so
        // one door between them is enough. That is true only while the two stacks are always present
        // together, and they are not: `sandbox-deploy.yml`'s `deploy-recipe` job deploys workers FIRST (they
        // publish the SSM parameters the service resolves at synth), with two hard-failing steps in between —
        // the workers verification and the drift report — before the service's `cdk deploy` is even reached.
        // A failure at either, or in the service deploy itself, leaves the workers stack up and the service
        // stack absent. That is not hypothetical: ADR-0007 × ADR-0022 wedged `kitchensink-recipe-service-pr-91`
        // in `UPDATE_ROLLBACK_FAILED` at 00:31 EDT against the nightly-stopped RDS.
        //
        // In that state the workers stack has ALREADY created `kitchensink_recipes_pr_{N}` — its in-deploy
        // trigger runs `ensureDatabaseExists` — while teardown, which discovers doors from the outputs of the
        // stacks that actually EXIST, finds none. The database survives every reap, on the shared sandbox
        // instance, invisibly: the stack deletes cleanly and the database is not its resource. Exactly the
        // leak claim 1 exists to prevent, reached from a direction claim 1 cannot see.
        //
        // A second door is redundant only when both stacks are deployed. It costs one `CfnOutput` and one
        // extra invoke at teardown, and `dropDatabase` answers `'absent'` without throwing, so the redundant
        // call is a no-op rather than the `FunctionError` teardown now treats as a failed run.
        const undoored = sources
            .filter((source) => shipsMigrationRunner(source))
            .filter((source) => dropDoorsIn(source).length === 0)
            .map(({ file }) => file)
            .sort();

        expect(
            undoored,
            'a stack that deploys a migration runner can create a per-PR database on its own, so it must ' +
                'publish its own *MigrationFunctionName output — teardown discovers doors from the stacks ' +
                'that exist, not from the ones that were supposed to',
        ).toEqual([]);
    });

    it('discovers the runner-shipping stacks — the claim above must not pass on an empty set', () => {
        expect(sources.filter((source) => shipsMigrationRunner(source)).length).toBeGreaterThan(2);
    });

    it('is reachable from teardown by PATTERN — the script names no specific door', () => {
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
            'teardown must SELECT migration-runner outputs by shape, not name them. A hardcoded key drops ' +
                'the databases it lists and silently leaks every other one — which is exactly how ' +
                'kitchensink_recipes_pr_{N} leaked on every reaped recipe preview.',
        ).toEqual([]);
    });

    it('covers every discovered door with the pattern the script actually uses', () => {
        // The other direction: selecting by shape is worthless if the shape excludes a real door.
        const pattern = scriptDropDoorPattern();
        const uncovered = [...new Set(doors.map(({ outputKey }) => outputKey))].filter((key) => !pattern.test(key));

        expect(uncovered, `${TEARDOWN_SCRIPT}'s drop-door pattern does not match these exported outputs`).toEqual([]);
    });

    it('keeps that pattern ANCHORED, so it cannot quietly widen to any output', () => {
        const pattern = scriptDropDoorPattern();

        expect(pattern.source.startsWith('^'), 'the drop-door pattern must be anchored at both ends').toBe(true);
        expect(pattern.source.endsWith('$'), 'the drop-door pattern must be anchored at both ends').toBe(true);
        // An unanchored or over-broad pattern would have teardown invoke `{"action":"drop"}` at whatever a
        // stack happens to export. Fired at a real non-door output name from this repo.
        expect(pattern.test('RecipeServiceUrl')).toBe(false);
        expect(pattern.test('SchedulerFunctionName')).toBe(false);
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
