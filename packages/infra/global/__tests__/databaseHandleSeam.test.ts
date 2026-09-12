// @vitest-environment node
/**
 * Repo-wide guard: **a database handle crosses a seam as a TYPE THAT IS TRUE, never as a cast.**
 *
 * ## The convention this exists to keep buried
 *
 * Three packages used to declare their database handle as `PostgresJsDatabase` — a driver this repo has never
 * installed, while production passes a `NodePgDatabase`. Every call site bridged the difference with
 * `as unknown as`, and `packages/utils/identity/src/provisioning.ts` documented that as policy: *"Callers
 * pass `db as unknown as PostgresJsDatabase` per the repo cast convention."*
 *
 * Eleven sites carried it, eight of them in suites — a suite casting to build the thing it means to exercise
 * is a suite reaching past an interface, so the interface was wrong rather than the callers.
 * `eraseIdentityRow.ts` reached that conclusion first and stated it: *"a cast that appears at every call site
 * is not a call-site problem: the signature was simply too narrow."*
 *
 * The cure was a structural write surface per package (`IdentityWriter`, `FoodWriter`, recipe-service's
 * `Writer` — the S-R1 seam ADR-0034 names), satisfied by ANY driver and by an open transaction. What this
 * guard adds is the only thing that stops the convention coming back: a rule. The way back is one line, and
 * it looks exactly like the code that used to be everywhere.
 *
 * ## Why the assertion is shaped this way
 *
 * ⛔ It bans the CAST, not the type name. A test may legitimately mention `PostgresJsDatabase` in prose — all
 * three surviving references in this repo are docstrings explaining why it went away — and banning the word
 * would make those explanations unwritable, which is how a rule ends up deleting its own rationale.
 *
 * ⛔ IT SCOPES TO PRODUCTION, and the reason is a distinction the first draft of this guard got wrong. Run
 * repo-wide it reported 19 files, of which 17 cast a hand-built FAKE to the handle type — a different act
 * entirely: a double implements only the members its test exercises, so a cast there is how a fake is built,
 * not how a real mismatch is hidden. The eight identity TEST casts that are now gone were NOT that; they cast
 * a REAL `NodePgDatabase` from `makeDb(pool)`, and they disappeared on their own the moment the production
 * type they were compensating for became true. So production is the right scope: fix the type there and the
 * honest test casts are the only ones left.
 *
 * ⚠️ Comments are STRIPPED before matching. The first draft flagged `food-service`'s own seam file, whose
 * docstring QUOTES the cast it replaced — a rule that cannot tolerate its own rationale being written down
 * deletes the explanation along with the defect.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The repo root — this file sits at `packages/infra/global/__tests__/`. */
const REPO_ROOT = join(import.meta.dirname, '../../../..');

/**
 * Every PRODUCTION TypeScript file the repo tracks — suites, fixtures and doubles excluded (see the scope
 * note in the module docstring for why).
 *
 * DISCOVERED from git rather than enumerated, so a package added later is in scope without an edit here —
 * the same discipline `roleSplitSources.ts` and `oneFileOneThing.test.ts` use.
 *
 * @returns Repo-relative paths.
 * @sideEffect Runs `git ls-files`.
 */
function productionTypeScript(): readonly string[] {
    return execFileSync('git', ['ls-files', '*.ts', '*.tsx'], { cwd: REPO_ROOT, encoding: 'utf8' })
        .split('\n')
        .filter(
            (path) =>
                path.length > 0 &&
                !path.includes('/dist/') &&
                !path.includes('/.claude/') &&
                !path.includes('/__tests__/') &&
                !path.includes('/__testing__/') &&
                !path.includes('/__fixtures__/') &&
                !path.includes('/tests/') &&
                !/\.(?:test|spec)\.tsx?$/u.test(path),
        );
}

/** A file's code with comments removed, so a docstring explaining the rule cannot violate it. Pure. */
function withoutComments(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '');
}

/**
 * A cast whose target is a drizzle database handle.
 *
 * ⛔ `as unknown as` is the spelling that matters: it is the double cast TypeScript requires when the two
 * types have nothing in common, which is precisely the situation a wrong handle type creates. A plain
 * `as Foo` between related types is a different act and is not what this rule is about.
 */
const HANDLE_CAST =
    /as\s+unknown\s+as\s+(?:PostgresJsDatabase|NodePgDatabase|PgDatabase|FoodDrizzle|RecipeDrizzle|IdentityWriter|FoodWriter)\b/u;

describe('a database handle crosses a seam as a true type', () => {
    it('discovers the production tree — an empty scan would pass everything below', () => {
        const files = productionTypeScript();

        expect(files.length).toBeGreaterThan(500);
        // …and it really excluded the suites, or the scope claim above is decoration.
        expect(files.filter((path) => /\.test\.tsx?$/u.test(path))).toEqual([]);
    });

    it('⛔ is never reached by an `as unknown as` cast in production code', () => {
        const offenders = productionTypeScript().filter((path) =>
            HANDLE_CAST.test(withoutComments(readFileSync(join(REPO_ROOT, path), 'utf8'))),
        );

        expect(offenders).toEqual([]);
    });

    it('keeps the three structural write surfaces, so the cure cannot be deleted quietly', () => {
        // ⛔ THE OTHER HALF OF THE RULE. Banning the cast alone is satisfiable by widening a signature back to
        // a concrete client, which needs no cast and reintroduces the coupling the seams removed. These three
        // types ARE the fix; if one disappears, this fails and whoever removed it owes an argument.
        const seams = [
            'packages/shared/identity-db/src/identityWriter.ts',
            'packages/services/food-service/src/database/unitOfWork.ts',
            'packages/services/recipe-service/src/database/unitOfWork.ts',
        ];

        for (const seam of seams) {
            expect(() => readFileSync(join(REPO_ROOT, seam), 'utf8'), seam).not.toThrow();
        }
    });
});
