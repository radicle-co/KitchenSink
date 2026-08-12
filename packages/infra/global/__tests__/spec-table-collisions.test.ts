/**
 * Guard: no two owners declare the same database table name.
 *
 * ## The defect this exists to prevent
 *
 * Feature 010 declared a `webhook_events` table for Stripe idempotency. A table of that name **already ships**, in
 * the very database ADR-0017 puts 010's webhook in — `packages/shared/identity-db/src/schema/webhookEvents.ts`,
 * keyed `svix_id text PRIMARY KEY` with `identity_id text NOT NULL`, used for Clerk's svix delivery dedup. Same
 * name, disjoint columns, different sender, one deployable. That is a migration which fails at deploy time or, far
 * worse, one that succeeds and corrupts dedup for **both** senders. Resolved by
 * [ADR-0018](../../../../docs/architecture/decisions/0018-per-sender-webhook-dedup-tables.md): one dedup table per
 * sender.
 *
 * It was found by accident, and it was not alone. Feature 011 planned a **second** `recipe_versions` table in its
 * own service's database while `recipe_versions` already ships in the recipe service — two independent
 * `(recipe_id, version_number)` sequences over one recipe's history. 011's own pre-implementation review
 * meanwhile assumed it was reusing the shipped table. Nobody noticed either.
 *
 * ## What this checks — three rules, and the owner model that makes them non-noisy
 *
 * An **owner** is a feature directory (`010-subscriptions`) for a spec declaration, or a package root
 * (`packages/shared/identity-db`) for shipped code.
 *
 *   1. **spec ↔ spec** — two different features declaring one table name. This is what catches 002-vs-010.
 *   2. **spec ↔ shipped** — a feature declaring a table that ships in a package which is NOT that feature's
 *      designated implementation, i.e. planning a table in somebody else's database.
 *   3. **not-yet-implemented spec CREATE TABLE ↔ any shipped table** — the sharpest rule and the one that catches
 *      011 directly. A feature that has not shipped must not `CREATE TABLE` a name that already exists anywhere,
 *      because that statement can only fail or clobber.
 *
 * Rules 1 and 2 need to know which packages implement an already-shipped feature, or every retrospective spec
 * would collide with its own implementation — 001 documents the 11 tables `recipe-service` ships, and reporting
 * those 11 as collisions is how a gate earns 31 baseline entries and then gets deleted. That mapping is
 * {@link IMPLEMENTED_FEATURES}: three entries, each asserted to point at packages that actually exist.
 *
 * ## Why this parses instead of grepping
 *
 * See the docblock of `./spec-declarations.ts`. Three measurements from this repository:
 *
 *   - 010's `plan.md` discusses the `webhook_events` collision in prose, at length, in the same file whose fenced
 *     DDL causes it. A text search cannot tell the `CREATE TABLE` from the paragraph warning about it.
 *   - Shipped drizzle schemas write `pgTable(\n    'recipes',` across lines. A single-line regex finds **3** of
 *     this repository's tables; the TypeScript AST finds all of them.
 *   - SQL comments name tables constantly, and a commented-out `CREATE TABLE` creates nothing.
 *
 * ## ⚠️ Stated blind spot
 *
 * A declaration is recognised only in a fenced ```sql / ```ts block or in real code. A feature that plans a table
 * in **prose only** is invisible here — which is exactly how 011's `recipe_versions` escaped the first automated
 * pass and had to be found by reading. Six of fourteen features declare no tables structurally. That is why
 * GR-021 is written as an obligation on the spec author (declare your DDL in a fenced block) rather than as a
 * claim that this suite sees everything. Do not "fix" the blind spot with a prose heuristic; make the specs
 * declarative.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
    describeTableCollisions,
    findCreateTables,
    findMarkdownTableDeclarations,
    findPgTables,
    findTableCollisions,
    validateExemptions,
} from './spec-declarations.js';
import type { TableDeclaration, TableExemption } from './spec-declarations.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/**
 * Features that have SHIPPED, mapped to the package roots that implement them.
 *
 * A shipped feature's spec legitimately documents the tables its own implementation created, so those pairs are
 * the same table correctly described in two places — not a collision. Without this map, feature 001 alone would
 * report 11 false collisions against `recipe-service`.
 *
 * This is a THREE-entry configuration rather than ~31 exemptions on purpose, and it is self-checking: the suite
 * asserts every package path below exists, so an entry that goes stale fails rather than silently widening the
 * escape hatch.
 *
 * ⚠️ When a feature ships, add it here — and note that adding it is the moment its table names must already be
 * coherent with everything else, because rule 3 stops applying to it.
 */
const IMPLEMENTED_FEATURES: ReadonlyMap<string, readonly string[]> = new Map([
    ['001-commise-recipe-app', ['packages/services/recipe-service']],
    [
        '002-user-auth',
        ['packages/services/identity', 'packages/shared/identity-db', 'packages/services/identity-webhooks'],
    ],
    ['003-usda-food-data', ['packages/services/food-service']],
]);

/**
 * Ruled exemptions from the one-declarer rule.
 *
 * ⛔ Every entry needs a substantive `why` — `validateExemptions` fails a missing, blank or one-word reason, and
 * fails an entry naming fewer than two owners. The precedent is deliberate: `contract-gen`'s
 * `AllowedPackageImport.why` and `ColumnAccount.why` are both mandatory, because the difference between recording
 * a decision and silencing a gate is that somebody had to write the reason down.
 *
 * An exemption matches only when the observed owner set is EXACTLY the recorded one. A third declarer appearing
 * later still fails, because "two of these were ruled acceptable" says nothing about a third.
 */
const TABLE_EXEMPTIONS: readonly TableExemption[] = [
    {
        table: 'ingredients',
        // Canonical owners: 001 and 003 have shipped, so each folds into its implementing package (see
        // `canonicaliseOwners`). Write exemptions against the CANONICAL owner, never the feature directory.
        owners: ['packages/services/food-service', 'packages/services/recipe-service'],
        why:
            "003's research.md QUOTES 001's shipped `ingredients` DDL under the heading \"Existing `ingredients` " +
            'Table (from 001 data-model.md)" for reference; it does not create one. The single declarer is the ' +
            'recipe service, and the two live in different logical databases (`kitchensink_recipes` vs ' +
            '`kitchensink_food`) in any case. ⚠️ Residual risk accepted: a quoted DDL is a second copy of a shape ' +
            'that can drift from the table it describes — it is a reference, so it is not load-bearing.',
    },
    {
        table: 'recipe_ingredients',
        owners: ['007-grocery-lists', 'packages/services/recipe-service'],
        why:
            "007's research/research.md QUOTES 001's shipped `recipe_ingredients` DDL under the heading " +
            '"`recipe_ingredients` (from 001)" because the ingredient aggregator READS it; 007 creates no such ' +
            'table, and per ADR-0017 it lands in the same recipe service that already owns it. Same accepted ' +
            'residual risk as `ingredients`: a quoted shape can drift from the real one.',
    },
    {
        table: 'users',
        owners: ['packages/services/identity', 'packages/shared/identity-db'],
        why:
            '⛔ RECORDED DEFECT, not an approval. `packages/services/identity/src/types/schema/users.ts` is a ' +
            'DRIFTED duplicate of the authoritative `packages/shared/identity-db/src/schema/users.ts`: `id` is ' +
            '`varchar(255) COLLATE "C"` vs `text`, `email` is `varchar(320)` vs case-insensitive `citext`, and the ' +
            'authoritative copy has `identity_id` and `external_id_synced_at` columns the duplicate lacks — while ' +
            'its own comment claims the two are "kept in lockstep". Nothing in production imports it; its only ' +
            'consumer is a test. Baselined so the guard can ship; deleting it is follow-up work in `packages/**`, ' +
            'which this change does not own.',
    },
    {
        table: 'accounts',
        owners: ['packages/services/identity', 'packages/shared/identity-db'],
        why:
            '⛔ RECORDED DEFECT, same root cause as `users`: the identity service keeps a second, drifted copy of ' +
            'the authoritative `identity-db` schema (`user_id` is `varchar COLLATE "C"` vs `text`). Nothing in ' +
            'production imports it. Baselined so the guard can ship; the duplicate should be deleted.',
    },
    {
        table: 'profiles',
        owners: ['packages/services/identity', 'packages/shared/identity-db'],
        why:
            '⛔ RECORDED DEFECT, and the worst of the three: the duplicate declares `user_id` as `uuid` where the ' +
            'authoritative `identity-db` schema declares `text`. That is not a stylistic drift, it is an ' +
            'incompatible foreign-key type on a live table. Nothing in production imports the duplicate. ' +
            'Baselined so the guard can ship; the duplicate should be deleted.',
    },
    {
        table: 'lifecycle_events',
        owners: ['packages/services/identity', 'packages/shared/identity-db'],
        why:
            'The authoritative declaration is `packages/shared/identity-db/src/schema/lifecycleEvents.ts`; the ' +
            "second site is the identity service's own migration SQL that CREATES it (`0011_lifecycle_events_" +
            'audit.sql`). Migration DDL and the Drizzle schema for the same table in the same database are the ' +
            'intended pair, not two owners — the owner-attribution model just cannot tell a package apart from ' +
            'its own migrations directory.',
    },
    {
        table: 'webhook_events',
        owners: ['packages/services/identity', 'packages/shared/identity-db'],
        why:
            "The shipped svix dedup table: declared by 002's data-model.md (the feature that created it, so it " +
            "canonicalises to the identity service), by that service's migration which CREATES it " +
            '(`0006_webhook_idempotency.sql`), and by the authoritative Drizzle schema in `identity-db`. One logical ' +
            'table, three legitimate sites across two owners. ⚠️ `010-subscriptions` must NOT appear in this owner ' +
            'set — that was the original collision, and per ADR-0018 Stripe writes `stripe_webhook_events` instead. ' +
            'If 010 shows up here, the rename has been reverted.',
    },
];

/**
 * Tracked files matching a pathspec.
 *
 * @param pathspec - A git pathspec.
 * @returns Repo-relative paths.
 * @sideEffect Shells out to `git ls-files`.
 */
function tracked(pathspec: string): readonly string[] {
    return execFileSync('git', ['ls-files', pathspec], { cwd: repoRoot, encoding: 'utf8' })
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '');
}

/**
 * The feature directory a spec path belongs to, or `undefined` for a non-feature spec document.
 *
 * @param file - Repo-relative path.
 * @returns The feature directory name, e.g. `010-subscriptions`. Pure.
 */
function featureOf(file: string): string | undefined {
    return /^specs\/(\d{3}-[a-z0-9-]+)\//u.exec(file)?.[1];
}

/**
 * The package root owning a path under `packages/`, e.g. `packages/shared/identity-db`.
 *
 * @param file - Repo-relative path.
 * @returns The package root, or the file itself when the path is shallower than expected. Pure.
 */
function packageOf(file: string): string {
    return /^(packages\/[a-z-]+\/[a-z0-9-]+)\//u.exec(file)?.[1] ?? file;
}

/**
 * Read a tracked file, tolerating one that the index still lists but the working tree no longer has.
 *
 * `git ls-files` reports the INDEX. A file deleted in the working tree (mid-refactor, or a staged deletion) is
 * still listed, and reading it throws `ENOENT` — which would turn any in-progress rename into a crashed guard
 * rather than a result. A file that does not exist declares nothing, so skipping it is also correct on the merits.
 * Vacuity is guarded separately by the declaration-count floor below.
 *
 * @param file - Repo-relative path.
 * @returns File contents, or `undefined` when the path is not present on disk.
 * @sideEffect Reads the filesystem.
 */
function readIfPresent(file: string): string | undefined {
    const absolute = path.join(repoRoot, file);

    return existsSync(absolute) ? readFileSync(absolute, 'utf8') : undefined;
}

/**
 * Collect every table declaration in the repository.
 *
 * @returns Spec and shipped declarations, in discovery order.
 * @sideEffect Reads tracked files.
 */
function collectDeclarations(): readonly TableDeclaration[] {
    const declarations: TableDeclaration[] = [];

    for (const file of tracked('specs/**/*.md')) {
        const owner = featureOf(file);
        const text = readIfPresent(file);
        if (owner === undefined || text === undefined) {
            continue;
        }
        for (const hit of findMarkdownTableDeclarations(text)) {
            declarations.push({ ...hit, owner, origin: 'spec', file });
        }
    }

    for (const file of tracked('packages/**/*.ts')) {
        // A test fixture may legitimately declare a throwaway table; it is not a schema anyone migrates.
        if (file.includes('/__tests__/') || file.includes('/tests/')) {
            continue;
        }
        const text = readIfPresent(file);
        if (text === undefined) {
            continue;
        }
        for (const hit of findPgTables(text, file)) {
            declarations.push({ ...hit, owner: packageOf(file), origin: 'shipped', file, form: 'drizzle-pgTable' });
        }
    }

    for (const file of tracked('packages/**/*.sql')) {
        const text = readIfPresent(file);
        if (text === undefined) {
            continue;
        }
        for (const hit of findCreateTables(text)) {
            declarations.push({ ...hit, owner: packageOf(file), origin: 'shipped', file, form: 'sql-ddl' });
        }
    }

    return declarations;
}

const declarations = collectDeclarations();

/**
 * Declarations with a shipped feature's spec folded into its implementing package, so a retrospective spec is not
 * a second owner of the table it documents.
 *
 * @param all - Every declaration.
 * @returns The same declarations with `owner` canonicalised. Pure.
 */
function canonicaliseOwners(all: readonly TableDeclaration[]): readonly TableDeclaration[] {
    return all.map((declaration) => {
        const implementations = IMPLEMENTED_FEATURES.get(declaration.owner);
        return implementations === undefined
            ? declaration
            : { ...declaration, owner: implementations[0] ?? declaration.owner };
    });
}

describe('spec table declarations', () => {
    it('discovers declarations from both specs and shipped code', () => {
        // Guards the vacuous-green case: if either collector breaks, every assertion below passes having examined
        // nothing.
        const specs = declarations.filter((declaration) => declaration.origin === 'spec');
        const shipped = declarations.filter((declaration) => declaration.origin === 'shipped');

        expect(specs.length).toBeGreaterThan(30);
        expect(shipped.length).toBeGreaterThan(20);
        expect(new Set(shipped.map((declaration) => declaration.table))).toContain('webhook_events');
    });

    it('every IMPLEMENTED_FEATURES entry points at packages that exist', () => {
        const missing = [...IMPLEMENTED_FEATURES.entries()].flatMap(([feature, packages]) =>
            packages
                .filter((pkg) => !existsSync(path.join(repoRoot, pkg)))
                .map((pkg) => `${feature} -> ${pkg} does not exist`),
        );

        expect(
            missing,
            'A stale entry here silently widens the escape hatch: it folds a spec into a package that is gone, so ' +
                'that spec stops being checked against anything.',
        ).toStrictEqual([]);
    });

    it('every exemption carries a substantive `why` and at least two owners', () => {
        expect(
            validateExemptions(TABLE_EXEMPTIONS),
            "The exemption registry is this gate's only escape hatch, so it is validated at least as strictly as " +
                'the thing it exempts. An exemption without a written reason is a silenced gate.',
        ).toStrictEqual([]);
    });

    it('declares no table name under more than one owner', () => {
        const collisions = findTableCollisions(canonicaliseOwners(declarations), TABLE_EXEMPTIONS);

        expect(collisions.length === 0 ? '' : describeTableCollisions(collisions)).toBe('');
    });

    it('no unshipped feature CREATEs a table name that already ships', () => {
        // The sharpest rule, and the one that catches feature 011's second `recipe_versions`. A feature that has
        // not shipped cannot legitimately issue `CREATE TABLE` for an existing name: the statement can only fail
        // or clobber, and if the intent was to reuse the table then the owning service should be writing it.
        const shippedNames = new Set(
            declarations.filter((declaration) => declaration.origin === 'shipped').map((entry) => entry.table),
        );

        // Exempted tables are excluded here too: an exemption is a ruling that the multiple declarations are
        // correct, and 007's quoted `recipe_ingredients` DDL is exactly that case — a reference, not a CREATE it
        // intends to run. Leaving them in would make the ruling apply to one rule and not the other.
        //
        // ⚠️ This skip is NOT a hole, and the reason matters. An exemption pins the EXACT owner set, so a new
        // declarer of an exempted table still fails rule 1 above — verified by mutation: reverting 010's rename
        // grows `webhook_events`'s owner set from two to three and rule 1 fails, even though rule 3 skips it.
        // If exemptions ever become owner-set *floors* rather than exact matches, this skip becomes a hole.
        const exempted = new Set(TABLE_EXEMPTIONS.map((exemption) => exemption.table));

        const offenders = declarations
            .filter(
                (declaration) =>
                    declaration.origin === 'spec' &&
                    declaration.form === 'sql-ddl' &&
                    !IMPLEMENTED_FEATURES.has(declaration.owner) &&
                    !exempted.has(declaration.table) &&
                    shippedNames.has(declaration.table),
            )
            .map(
                (declaration) =>
                    `${declaration.owner} CREATEs shipped \`${declaration.table}\` at ${declaration.file}:${declaration.line}`,
            );

        expect(
            offenders,
            'A not-yet-implemented feature declares `CREATE TABLE` for a name that ALREADY SHIPS. Either it means ' +
                'to reuse the existing table — in which case the owning service writes it and this DDL should not ' +
                'exist — or it means a new table, which needs a new name. Both `webhook_events` (010) and ' +
                '`recipe_versions` (011) were this exact defect.',
        ).toStrictEqual([]);
    });
});

describe('table declaration parsers — mutation proof', () => {
    it('FAILS the real 010-vs-shipped collision (rebuilt from both sources)', () => {
        const collisions = findTableCollisions(
            [
                {
                    table: 'webhook_events',
                    owner: '010-subscriptions',
                    origin: 'spec',
                    file: 'specs/010-subscriptions/plan.md',
                    line: 85,
                    form: 'sql-ddl',
                },
                {
                    table: 'webhook_events',
                    owner: 'packages/shared/identity-db',
                    origin: 'shipped',
                    file: 'packages/shared/identity-db/src/schema/webhookEvents.ts',
                    line: 4,
                    form: 'drizzle-pgTable',
                },
            ],
            [],
        );

        expect(collisions).toHaveLength(1);
        expect(collisions[0]?.owners).toStrictEqual(['010-subscriptions', 'packages/shared/identity-db']);
        expect(describeTableCollisions(collisions)).toContain('`webhook_events`');
    });

    it('does NOT accept an exemption whose owner set has grown a third declarer', () => {
        const three: readonly TableDeclaration[] = ['a-feature', 'b-feature', 'c-feature'].map((owner) => ({
            table: 'shared_thing',
            owner,
            origin: 'spec' as const,
            file: `specs/${owner}/plan.md`,
            line: 1,
            form: 'sql-ddl' as const,
        }));

        const exemption: TableExemption = {
            table: 'shared_thing',
            owners: ['a-feature', 'b-feature'],
            why: 'Two features were ruled acceptable here for a reason long enough to count as a real reason.',
        };

        expect(findTableCollisions(three.slice(0, 2), [exemption])).toStrictEqual([]);
        expect(findTableCollisions(three, [exemption])).toHaveLength(1);
    });

    it('REJECTS a `why`-less exemption, a one-word one, and a single-owner one', () => {
        expect(validateExemptions([{ table: 't', owners: ['a', 'b'] } as unknown as TableExemption])).toHaveLength(1);
        expect(validateExemptions([{ table: 't', owners: ['a', 'b'], why: '   ' }])).toHaveLength(1);
        expect(validateExemptions([{ table: 't', owners: ['a', 'b'], why: 'legacy' }])).toHaveLength(1);
        expect(validateExemptions([{ table: 't', owners: ['a'], why: 'x'.repeat(80) }])).toHaveLength(1);
        expect(
            validateExemptions([
                { table: 't', owners: ['a', 'b'], why: 'x'.repeat(80) },
                { table: 't', owners: ['a', 'b'], why: 'y'.repeat(80) },
            ]),
        ).toHaveLength(1);
        expect(validateExemptions([{ table: 't', owners: ['a', 'b'], why: 'x'.repeat(80) }])).toStrictEqual([]);
    });

    it('finds a multi-line `pgTable(` call, which a single-line regex misses', () => {
        // Not hypothetical: every recipe-service schema is written this way, and the regex version of this parser
        // found 3 of the repository's tables instead of all of them.
        const source = [
            "import { pgTable, text } from 'drizzle-orm/pg-core';",
            '',
            'export const recipes = pgTable(',
            "    'recipes',",
            '    { id: text() },',
            ');',
            '',
        ].join('\n');

        expect(findPgTables(source)).toStrictEqual([{ table: 'recipes', line: 4 }]);
    });

    it('is NOT fooled by `pgTable` inside a comment or a string literal', () => {
        // This is the documented failure that motivated the whole module: a text gate passed against broken code
        // because the docstring above it contained the words the gate searched for.
        const source = [
            '/**',
            " * Do not reintroduce pgTable('webhook_events', …) here — see ADR-0018.",
            ' */',
            'const message = "pgTable(\'accounts\', {})";',
            "// pgTable('users', {})",
            '',
        ].join('\n');

        expect(findPgTables(source)).toStrictEqual([]);
    });

    it('ignores a commented-out or string-literal CREATE TABLE in SQL', () => {
        const sql = [
            '-- CREATE TABLE commented_out (id uuid);',
            '/* CREATE TABLE block_commented (id uuid); */',
            "SELECT 'CREATE TABLE in_a_string (id uuid)';",
            'CREATE TABLE IF NOT EXISTS the_real_one (id uuid PRIMARY KEY);',
            '',
        ].join('\n');

        expect(findCreateTables(sql)).toStrictEqual([{ table: 'the_real_one', line: 4 }]);
    });

    it('handles a doubled quote inside a SQL string without losing the rest of the file', () => {
        const sql = ["SELECT 'it''s fine';", 'CREATE TABLE after_the_string (id uuid);', ''].join('\n');

        expect(findCreateTables(sql)).toStrictEqual([{ table: 'after_the_string', line: 2 }]);
    });

    it('reduces a schema-qualified name to the bare table name', () => {
        // Namespacing by Postgres schema is a DECISION that must be recorded as an exemption, not silently
        // assumed by the parser — otherwise `billing.webhook_events` quietly stops colliding.
        expect(findCreateTables('CREATE TABLE billing.webhook_events (id uuid);')).toStrictEqual([
            { table: 'webhook_events', line: 1 },
        ]);
    });

    it('counts DDL only inside a language-tagged fence, never in prose or an untagged diagram', () => {
        const markdown = [
            '# Plan',
            '',
            'We must not CREATE TABLE webhook_events, because it already exists. Discussion follows.',
            '',
            '```',
            'CREATE TABLE inside_an_untagged_diagram (id uuid);',
            '```',
            '',
            '```sql',
            'CREATE TABLE the_declared_one (id uuid);',
            '```',
            '',
            '```ts',
            "export const t = pgTable('the_drizzle_one', {});",
            '```',
            '',
        ].join('\n');

        expect(findMarkdownTableDeclarations(markdown)).toStrictEqual([
            { table: 'the_declared_one', line: 10, form: 'sql-ddl' },
            { table: 'the_drizzle_one', line: 14, form: 'drizzle-pgTable' },
        ]);
    });

    it('does not let a nested fence close the outer one early', () => {
        const markdown = ['````sql', 'CREATE TABLE outer_one (id uuid);', '```', '````', ''].join('\n');

        expect(findMarkdownTableDeclarations(markdown)).toStrictEqual([
            { table: 'outer_one', line: 2, form: 'sql-ddl' },
        ]);
    });

    it("does not count this guard's OWN docblock, which names every table it warns about", () => {
        // The self-referential check. `spec-declarations.ts` and this file both discuss `webhook_events`,
        // `pgTable(...)` and `CREATE TABLE` at length in comments. If either registered as a declaration, the
        // guard would report itself — and the fix would be to weaken the guard.
        const guardSources = ['spec-declarations.ts', 'spec-table-collisions.test.ts', 'spec-task-ids.test.ts'];

        for (const file of guardSources) {
            const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), file), 'utf8');
            const tables = findPgTables(source, file).map((hit) => hit.table);

            expect(tables, `${file} must contribute no table declarations from its own prose`).toStrictEqual([]);
        }
    });
});
