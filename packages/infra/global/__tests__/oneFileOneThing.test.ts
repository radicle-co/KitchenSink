/**
 * Repo-wide guard: **one file, one thing** (`docs/CODING_STANDARDS.md` §1, "One file, one thing").
 *
 * The standard says a file does exactly ONE thing — one class, or one component, or one cohesive piece of
 * functionality — and calls out the failure by name: "an emitter _and_ a console fake _and_ builder functions
 * _and_ constants _and_ eight interfaces … is several files wearing one name". That rule shipped as prose with
 * nothing enforcing it, which is the same shape as the §1 naming defect it sits beside: a standard nobody could
 * fail is a standard nobody has to meet.
 *
 * ## What is measured, and why the subject is EXPORTS
 *
 * A module's exports are its surface — the thing another file can depend on, and therefore the thing that makes
 * a file "several files wearing one name". A private helper class is an implementation detail of the one thing
 * the file already is, so counting it would fail files that are not god files. Export-scoping is also what
 * keeps the gate from fighting a CORRECT pattern: `wizard/Wizard.tsx` and `card/RecipeCard.tsx` assemble six
 * and eleven module-local slots into ONE export via `Object.assign` — the Compound Component pattern — and a
 * declaration-counting check flags 37 files where an export-counting one flags 11.
 *
 * ## Library-first: what was checked, and why each was rejected (measured 2026-08-15)
 *
 *   - **`max-classes-per-file`** (ESLint core, present and not deprecated in 10.5.0) — counts every class
 *     including private ones and class expressions, so it flags 21 files where the export-scoped rule flags 14;
 *     the 7 extra are test-local doubles whose only cure is a path glob, which is the §1 kebab mistake again.
 *     It also says nothing about React components.
 *   - **`eslint-plugin-react`'s `react/no-multi-comp`** — 7.37.5, last published 2025-04-03, peer range caps at
 *     `eslint ^9.7`. It does not support ESLint 10, and it counts module-local components (the 37 above).
 *   - **`@eslint-react/eslint-plugin`** — 5.18.6, ESLint-10-clean and actively maintained, but ships no
 *     `no-multi-comp` equivalent.
 *
 * The parsing is still library work: this reads the TypeScript compiler's own AST (`import ts from 'typescript'`,
 * the same mechanism `serviceSecurityInvariants.test.ts` uses) rather than pattern-matching source text.
 *
 * ⚠️ **ESLint 10 DOES ship a native ratchet** — bulk suppressions (`--suppress-rule`, `eslint-suppressions.json`),
 * which self-expire when a violation is fixed. It was the recommended destination while this registry still
 * held DEBT, and it is now the wrong tool: a suppression file records a count, not a REASON, and every group
 * below is a RULING ("an error taxonomy is one thing") rather than a violation awaiting a fix. §16.3 makes an
 * exemption's `why` mandatory, and a JSON count cannot carry one. The remaining improvement is not to move to
 * suppressions but to encode each ruling as a PARSED PROPERTY of the code (a single rooted `Error` tree; an
 * empty-bodied `createZodDto` adapter), so the rulings bind services that do not exist yet instead of being
 * re-litigated file by file. Until then the registry is the authority, and it is the narrower one.
 *
 * ## Why a registry of rulings, and not a clean bill of health
 *
 * The tree has NO pending violations: the nine god files this gate was born recording — `FoodEventEmitter.ts`
 * (the §1 section's own worked example), `foodSourceAdapter.ts`, `workerLogger.ts`, the
 * `RecipeFormSections`/`RecipeRatingControl` web+native pairs, `RecipeSourceTabs.native.tsx` and
 * `SuspensionBanner.tsx` — have all been split, and their entries deleted with them.
 *
 * What is left is 17 files whose multi-class/multi-component shape §1 RULES to be one thing. They are recorded
 * with their EXACT export counts, so:
 *
 *   - a NEW file with two exported classes or two exported components fails;
 *   - an EXEMPTED file that grows a further export fails too, because the count is pinned, not a floor —
 *     "these five DTOs were ruled acceptable" says nothing about a sixth.
 *
 * An exemption is a ruling, so every category carries a substantive `why` — `validateExemptions` fails a
 * missing, blank or one-word reason, exactly as `specTableCollisions.test.ts` does for its table registry. A
 * category that records DEBT rather than a ruling must say so in its `why`; there is no such category today,
 * and adding one is a decision to be argued in the message that adds it.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/** The exported symbols of one file that §1 counts as "a thing". */
interface ExportedThings {
    readonly classes: readonly string[];
    readonly components: readonly string[];
}

/** A file whose multi-export shape has been ruled on, pinned to the counts observed when it was ruled. */
interface ExemptFile {
    readonly file: string;
    readonly classes: number;
    readonly components: number;
}

/** A ruling covering one KIND of multi-export file, plus the exact files (and counts) it covers. */
interface GodFileExemption {
    readonly kind: string;
    readonly why: string;
    readonly files: readonly ExemptFile[];
}

/**
 * Rulings on the multi-export files that exist today.
 *
 * ⛔ Every entry needs a substantive `why`, and every file needs its EXACT counts. An exemption matches only
 * when the observed counts equal the recorded ones — "these five DTOs were ruled acceptable" says nothing about
 * a sixth, so a file that grows still fails.
 */
const GOD_FILE_EXEMPTIONS: readonly GodFileExemption[] = [
    {
        kind: 'error taxonomy',
        why:
            'RULED ONE THING (§1, 2026-08-15). The unit is "the errors this boundary can raise": the set IS the ' +
            'type. CLAUDE.md requires every custom error to extend `Error`, call `Object.setPrototypeOf`, and ship ' +
            'a matching `is*` guard, and callers discriminate across the whole set in a single `catch`. Splitting ' +
            'a taxonomy one-class-per-file puts a base class and its leaves in a cycle-prone import graph and buys ' +
            'nothing a reader wants — the file is named for the taxonomy, not for one member of it. The exemption ' +
            'covers the SHAPE, not the path: a file must hold the taxonomy and nothing else, which is why ' +
            '`authState.ts` does NOT appear here — it is a state module that merely happened to declare two error ' +
            'classes, so its errors were moved out to `authState.errors.ts` and the state model stayed behind. ' +
            'GREW 2026-08-25 (U29): the on-demand USDA lane added `SourceUnavailableError` (an outage we can say ' +
            'nothing about) and `SourceBusyError` (a rate refusal that names when to come back) as DISTINCT ' +
            'members, because the picker renders two different sentences and a cook takes two different actions; ' +
            '`SearchQueryTooShortError` came with FR-010a; `ParseJobExpiredError` came with the parse-job UI, ' +
            'and is the boundary telling a cook that the proposals they are looking at no longer exist — a ' +
            'different sentence and a different action from every other member. Each is a new failure the ' +
            'boundary can raise, which is the exempted unit — not a second subject in the file.',
        files: [
            { file: 'packages/apps/commise/features/account/src/authState.errors.ts', classes: 2, components: 0 },
            { file: 'packages/apps/commise/features/account/src/errors.ts', classes: 7, components: 0 },
            { file: 'packages/clients/food-service/src/errors.ts', classes: 11, components: 0 },
            { file: 'packages/clients/recipe-service/src/errors.ts', classes: 14, components: 0 },
            { file: 'packages/clients/bedrock/src/errors.ts', classes: 6, components: 0 },
            { file: 'packages/clients/usda/src/errors.ts', classes: 7, components: 0 },
            { file: 'packages/services/food-service/src/foods/dao/dao.errors.ts', classes: 2, components: 0 },
            { file: 'packages/services/food-service/src/foods/foods.errors.ts', classes: 12, components: 0 },
            { file: 'packages/services/food-service/src/foods/seed/clearCli.errors.ts', classes: 4, components: 0 },
            { file: 'packages/services/food-service/src/foods/seed/reseedCli.errors.ts', classes: 2, components: 0 },
            { file: 'packages/services/recipe-service/src/ingredients/unlinkCli.errors.ts', classes: 2, components: 0 },
            // Extracted 2026-09-04 when the misrouted-delivery fix made the handler export two classes.
            // Same ruling as its siblings above: the unit is "the refusals this worker can raise", and both
            // are about one boundary — an SQS body that is not a usable erasure instruction, and a body
            // naming an owner this database holds no job for. The handler re-exports them, so the split is
            // invisible to importers.
            {
                file: 'packages/services/recipe-workers/src/handlers/accountErasureWorker.errors.ts',
                classes: 2,
                components: 0,
            },
            { file: 'packages/services/food-service/src/sources/foodSource.errors.ts', classes: 4, components: 0 },
        ],
    },
    {
        kind: 'NestJS zod-DTO adapter module',
        why:
            'RULED ONE THING. The decisive fact is not that these are "DTOs" but that every class here is an ' +
            'EMPTY-BODIED `createZodDto(...)` extension — `export class X extends createZodDto(schema) {}`, no ' +
            'members, no logic, no behaviour. The knowledge lives entirely in the authored zod that §15.2 / ' +
            'ADR-0014 make the single authority; the class exists only because Nest resolves a validator from a ' +
            "handler parameter's runtime `design:paramtypes` METATYPE, so it is the framework's HANDLE on the " +
            'schema, not a second description of it. The unit is therefore "the metatypes this endpoint group ' +
            'needs", and splitting it produces N files whose entire content is one `extends` clause, at a ' +
            'granularity that COMPETES with the `*.schema.ts` files these mirror one-for-one — two places to look ' +
            'for one contract. The rejected counter-argument is that `CreateRecipeDto` and its nested ' +
            '`RecipeIngredientInputDto` are separate shapes; they are not separable, the nested one is part of the ' +
            "outer body's own definition. Weighing ADR-0014/0015 confirms rather than decides it: the repo is " +
            'migrating toward zod schemas over class DTOs, so this whole layer is expected to shrink, and ' +
            'splitting it now would be churn on code scheduled to thin out. ⛔ The exemption is the SHAPE, not the ' +
            'filename: a `*.dto.ts` that grows a class with a BODY (a constructor, a method, a `class-validator` ' +
            'decorator, a hand-written field) is no longer this shape and must not be added here — pin it, split ' +
            'it, or argue a new ruling.',
        files: [
            { file: 'packages/services/food-service/src/foods/dto/foods.dto.ts', classes: 8, components: 0 },
            { file: 'packages/services/identity/src/admin/dto/admin.dto.ts', classes: 5, components: 0 },
            { file: 'packages/services/identity/src/users/dto/user.dto.ts', classes: 3, components: 0 },
            { file: 'packages/services/recipe-service/src/recipes/dto/createRecipe.dto.ts', classes: 3, components: 0 },
        ],
    },
    {
        kind: 'icon set',
        why:
            'RULED ONE THING (§1, 2026-08-15). The unit is "the glyphs this surface draws". An `icons.tsx` is a ' +
            'sheet of inline SVG leaves — no state, no props beyond size/colour, no branching. ' +
            'One file per glyph would be 15 files whose entire content is a `<path d="…">`, and the import site ' +
            'wants the sheet. This is the one place where "one component per file" costs more than it returns.',
        files: [
            { file: 'packages/apps/commise/features/recipes/src/form/icons.tsx', classes: 0, components: 4 },
            { file: 'packages/apps/commise/features/recipes/src/wizard/icons.tsx', classes: 0, components: 7 },
            { file: 'packages/apps/commise/web/src/components/auth/icons.tsx', classes: 0, components: 4 },
        ],
    },
    {
        kind: 'test double mirroring a third-party module',
        why:
            "RULED ONE THING (§1, 2026-08-15). A double must present its subject's surface to be " +
            "substitutable, so a stub's export surface is dictated by the module it replaces, not chosen — `react-native-safe-area-" +
            'context` exports `SafeAreaProvider` and `SafeAreaView`, so a stub that exports one of them does not ' +
            'substitute for it. Splitting the double would make the test setup import two files to replace one, ' +
            'and would let the two halves drift apart from the single upstream surface they mirror.',
        files: [
            {
                file: 'packages/apps/commise/features/recipes/test-utils/safeAreaContextStub.tsx',
                classes: 0,
                components: 2,
            },
            { file: 'packages/apps/commise/mobile/tests/stubs/safeAreaContext.tsx', classes: 0, components: 2 },
        ],
    },
];

/** `true` when the declaration carries an `export` modifier (which `export default` also sets). */
function isExported(node: ts.Node): boolean {
    return (ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export) !== 0;
}

/**
 * Whether a function body produces JSX directly.
 *
 * Stops at a nested function or class so a factory that RETURNS a component (an HOC) is not itself counted as
 * one — the HOC's subject is the wrapping, and the component it builds is the inner declaration.
 */
function producesJsx(node: ts.Node): boolean {
    let found = false;

    const walk = (child: ts.Node): void => {
        if (found) {
            return;
        }

        if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) {
            found = true;

            return;
        }

        // Stop at ANY nested function form, not just declarations. `() => () => <div />` is an HOC whose own
        // body returns a component; descending into the inner arrow counted the wrapper as a component too.
        // (Found by this file's own HOC case — the first draft stopped only at declarations.)
        if (
            ts.isFunctionDeclaration(child) ||
            ts.isClassDeclaration(child) ||
            ts.isArrowFunction(child) ||
            ts.isFunctionExpression(child) ||
            ts.isMethodDeclaration(child)
        ) {
            return;
        }

        ts.forEachChild(child, walk);
    };

    ts.forEachChild(node, walk);

    return found;
}

/**
 * The exported classes and React components declared at the TOP LEVEL of one source file.
 *
 * A component is recognised structurally — a PascalCase exported function (declaration, arrow or expression)
 * whose own body produces JSX — rather than by filename or by a naming convention alone, so a PascalCase
 * factory, type guard or constant is not miscounted.
 *
 * @param file - Repo-relative path, used to pick the TS vs TSX parse.
 * @param text - The file's source text.
 * @returns The exported class and component names.
 */
export function exportedThings(file: string, text: string): ExportedThings {
    const source = ts.createSourceFile(
        file,
        text,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const classes: string[] = [];
    const components: string[] = [];

    for (const statement of source.statements) {
        if (ts.isClassDeclaration(statement) && statement.name !== undefined && isExported(statement)) {
            classes.push(statement.name.text);
        }

        if (
            ts.isFunctionDeclaration(statement) &&
            statement.name !== undefined &&
            isExported(statement) &&
            /^[A-Z]/.test(statement.name.text) &&
            statement.body !== undefined &&
            producesJsx(statement)
        ) {
            components.push(statement.name.text);
        }

        if (ts.isVariableStatement(statement) && isExported(statement)) {
            for (const declaration of statement.declarationList.declarations) {
                if (
                    !ts.isIdentifier(declaration.name) ||
                    !/^[A-Z]/.test(declaration.name.text) ||
                    declaration.initializer === undefined
                ) {
                    continue;
                }

                let initializer = declaration.initializer;

                while (
                    ts.isAsExpression(initializer) ||
                    ts.isSatisfiesExpression(initializer) ||
                    ts.isParenthesizedExpression(initializer)
                ) {
                    initializer = initializer.expression;
                }

                if (
                    (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) &&
                    producesJsx(initializer)
                ) {
                    components.push(declaration.name.text);
                }
            }
        }
    }

    return { classes, components };
}

/**
 * Exemption entries that are not usable as rulings.
 *
 * The registry is this gate's only escape hatch, so it is validated at least as strictly as the thing it
 * exempts: a reason must be written, substantive, and attached to at least one file.
 *
 * @param exemptions - The registry.
 * @returns One message per defective entry; empty when the registry is sound.
 */
export function validateExemptions(exemptions: readonly GodFileExemption[]): readonly string[] {
    const problems: string[] = [];
    const seen = new Set<string>();

    for (const exemption of exemptions) {
        if (exemption.why.trim().split(/\s+/).length < 12) {
            problems.push(`${exemption.kind} — \`why\` is missing or too short to be a reason`);
        }

        if (exemption.files.length === 0) {
            problems.push(`${exemption.kind} — exempts no file, so it rules on nothing`);
        }

        for (const entry of exemption.files) {
            if (seen.has(entry.file)) {
                problems.push(`${entry.file} — exempted twice, so one of the two reasons is not the reason`);
            }

            seen.add(entry.file);

            if (entry.classes < 2 && entry.components < 2) {
                problems.push(`${entry.file} — recorded counts do not violate the rule, so the entry is dead`);
            }
        }
    }

    return problems;
}

/**
 * Files that break "one file, one thing", after exemptions.
 *
 * @param sources - The files to inspect, as `[path, text]`.
 * @param exemptions - The registry.
 * @returns One message per violation; empty when the tree is clean.
 */
export function findGodFiles(
    sources: readonly (readonly [string, string])[],
    exemptions: readonly GodFileExemption[],
): readonly string[] {
    const ruled = new Map(exemptions.flatMap((exemption) => exemption.files.map((entry) => [entry.file, entry])));
    const violations: string[] = [];

    for (const [file, text] of sources) {
        const { classes, components } = exportedThings(file, text);

        if (classes.length < 2 && components.length < 2) {
            continue;
        }

        const entry = ruled.get(file);

        if (entry !== undefined && entry.classes === classes.length && entry.components === components.length) {
            continue;
        }

        const counts = `${classes.length} exported class(es) [${classes.join(', ')}], ${components.length} exported component(s) [${components.join(', ')}]`;

        violations.push(
            entry === undefined
                ? `${file} — ${counts}: a file does ONE thing (CODING_STANDARDS §1)`
                : `${file} — ${counts}: GREW past its recorded exemption (${entry.classes} class(es), ${entry.components} component(s))`,
        );
    }

    return violations.sort();
}

/**
 * Every tracked TypeScript source under `packages/`, excluding ambient declarations.
 *
 * DISCOVERED from git rather than enumerated, so a package added later is in scope without an edit here.
 *
 * ⚠️ `git ls-files` describes the INDEX, not the working tree, so it still lists a file that has been
 * DELETED but not yet staged — and reading it threw `ENOENT`, taking this whole suite down with an error
 * that says nothing about "one file, one thing". Skipping the absent ones is not a weakening: a file that
 * no longer exists cannot violate the rule, and the untracked-new-file direction is covered by the fact
 * that a new file must be staged before it can be committed, which is when this gate runs for real.
 *
 * @returns `[repo-relative path, source text]` pairs.
 * @sideEffect Shells out to `git ls-files` and reads every matched file.
 */
function trackedSources(): readonly (readonly [string, string])[] {
    return execFileSync('git', ['ls-files', 'packages/**/*.ts', 'packages/**/*.tsx'], {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 64,
    })
        .split('\n')
        .map((line) => line.trim())
        .filter((file) => file.length > 0 && !file.endsWith('.d.ts'))
        .filter((file) => existsSync(path.join(repoRoot, file)))
        .map((file) => [file, readFileSync(path.join(repoRoot, file), 'utf8')] as const);
}

describe('one file, one thing — the analyzer', () => {
    it('counts exported classes, and ignores a private one', () => {
        const source = 'class Helper {}\nexport class A {}\nexport class B {}\n';

        expect(exportedThings('x.ts', source).classes).toStrictEqual(['A', 'B']);
    });

    it('counts an exported React component in either declaration form', () => {
        const source = 'export function A() { return <p />; }\nexport const B = () => <div />;\n';

        expect(exportedThings('x.tsx', source).components).toStrictEqual(['A', 'B']);
    });

    it('does NOT count a PascalCase export that produces no JSX, nor an HOC that only returns one', () => {
        const source =
            'export const Config = { a: 1 };\n' +
            'export function IsThing(v: unknown) { return v !== null; }\n' +
            'export const WithBorder = () => () => <div />;\n';

        // `WithBorder`'s own body returns a FUNCTION; the JSX belongs to the inner component it builds. Counting
        // it would fail every HOC in the tree, which is the false positive that makes a gate get switched off.
        expect(exportedThings('x.tsx', source).components).toStrictEqual([]);
    });

    it('passes a file with exactly one exported class and one with exactly one component', () => {
        expect(findGodFiles([['a.ts', 'export class Only {}'] as const], [])).toStrictEqual([]);
        expect(findGodFiles([['b.tsx', 'export const Only = () => <p />;'] as const], [])).toStrictEqual([]);
    });

    it('FAILS two exported classes, and two exported components', () => {
        expect(findGodFiles([['a.ts', 'export class A {}\nexport class B {}'] as const], [])).toHaveLength(1);
        expect(
            findGodFiles([['b.tsx', 'export const A = () => <p />;\nexport const B = () => <p />;'] as const], []),
        ).toHaveLength(1);
    });

    it('an exemption is an EXACT count, so an exempted file that grows still fails', () => {
        const exemption: GodFileExemption = {
            kind: 'test',
            why: 'A reason long enough to be a real reason rather than a single word standing in for one.',
            files: [{ file: 'a.ts', classes: 2, components: 0 }],
        };

        expect(findGodFiles([['a.ts', 'export class A {}\nexport class B {}'] as const], [exemption])).toStrictEqual(
            [],
        );
        expect(
            findGodFiles([['a.ts', 'export class A {}\nexport class B {}\nexport class C {}'] as const], [exemption]),
        ).toHaveLength(1);
    });

    it('REJECTS a `why`-less exemption, one that names no file, and a dead entry', () => {
        const why = 'A reason long enough to be a real reason rather than a single word standing in for one.';

        expect(
            validateExemptions([{ kind: 'k', why: 'legacy', files: [{ file: 'a.ts', classes: 2, components: 0 }] }]),
        ).toHaveLength(1);
        expect(validateExemptions([{ kind: 'k', why, files: [] }])).toHaveLength(1);
        expect(
            validateExemptions([{ kind: 'k', why, files: [{ file: 'a.ts', classes: 1, components: 1 }] }]),
        ).toHaveLength(1);
        expect(
            validateExemptions([
                { kind: 'k', why, files: [{ file: 'a.ts', classes: 2, components: 0 }] },
                { kind: 'j', why, files: [{ file: 'a.ts', classes: 2, components: 0 }] },
            ]),
        ).toHaveLength(1);
        expect(
            validateExemptions([{ kind: 'k', why, files: [{ file: 'a.ts', classes: 2, components: 0 }] }]),
        ).toStrictEqual([]);
    });
});

describe('one file, one thing — the real tree', () => {
    it('every exemption carries a substantive `why`', () => {
        expect(
            validateExemptions(GOD_FILE_EXEMPTIONS),
            "The exemption registry is this gate's only escape hatch. An exemption without a written reason is a " +
                'silenced gate.',
        ).toStrictEqual([]);
    });

    it('is not vacuous: the subject set is the whole tree, not a handful of files', () => {
        // Without this, a `git ls-files` pathspec that quietly stopped matching would make every assertion below
        // pass over an empty set — the exact failure mode `staticAnalysisCoverage.test.ts` exists to catch for lint.
        expect(trackedSources().length).toBeGreaterThan(1000);
    });

    it('holds: no file exports more than one class or more than one component', () => {
        expect(
            findGodFiles(trackedSources(), GOD_FILE_EXEMPTIONS),
            'A file does ONE thing (CODING_STANDARDS §1). Split it, or — if the shape is genuinely one subject — ' +
                'add it to GOD_FILE_EXEMPTIONS with its exact counts and a written reason.',
        ).toStrictEqual([]);
    });

    it('every recorded exemption still names a file that still violates the rule', () => {
        // An exemption that outlives the thing it exempted is a stale ruling nobody will notice is stale.
        const observed = new Map(trackedSources().map(([file, text]) => [file, exportedThings(file, text)]));
        const stale = GOD_FILE_EXEMPTIONS.flatMap((exemption) => exemption.files)
            .filter((entry) => {
                const things = observed.get(entry.file);

                return (
                    things === undefined ||
                    things.classes.length !== entry.classes ||
                    things.components.length !== entry.components
                );
            })
            .map((entry) => entry.file);

        expect(stale, 'Delete the entry: the file was split, moved, or its counts changed.').toStrictEqual([]);
    });
});
