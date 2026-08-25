// @vitest-environment node
/**
 * A PACKAGE THAT ADDS ITS OWN RESTRICTED IMPORTS MUST NOT SWITCH THE SHARED ONES OFF.
 *
 * ## The defect this exists for, and why nothing could have caught it
 *
 * In ESLint flat config a later config object's rule entry **REPLACES** the earlier one — options do not
 * merge. `packages/services/recipe-service/eslint.config.js` carried a block (`files: ['src/**\/*.ts']`)
 * that redefined `no-restricted-imports` with only its own `paths`, to confine `revealCallerToken` to one
 * factory. That override silently switched the shared config's `patterns` allow-list — the "don't reach into
 * another package's internals" guard, §14.2's boundary — OFF for **every** `src/**\/*.ts` in the service.
 *
 * MEASURED, on two files with identical contents importing
 * `@kitchensink/recipe-core/src/parsing/parseKey.js`:
 *
 * ```text
 * src/zzprobe.ts       →  clean                          ← guard OFF
 * contract/zzprobe.ts  →  no-restricted-imports error    ← guard ON
 * ```
 *
 * Nothing failed, and nothing could: the lint run was green, the rule was configured, the allow-list
 * existed, and the whole service's source tree was outside it. That is the same shape as the erasure and
 * NAT gaps — a control that is present, reported, and not in force.
 *
 * ## What is asserted, and why in two halves
 *
 * ⛔ **The structural half is DISCOVERED, never enumerated**: every `eslint.config.js` under `packages/` is
 * read, and none may spell a bare `no-restricted-imports` rule entry of its own — it must compose through
 * `restrictedImportsRule` (`@kitchensink/eslint`), which carries the shared `patterns` forward. A package
 * that adds an override tomorrow is covered the day it does, and cannot opt out by not being listed.
 *
 * ⛔ **The empirical half fires real imports at the real config from inside `src/`**, because a config
 * object that LOOKS right is exactly what shipped: the override was well-formed, correctly targeted and
 * fully broken. The probes are VIRTUAL — `lintText` at a `src/…` path, never a file on disk.
 *
 * ⚠️ Both halves of that are load-bearing and each was measured. Writing the probe into the real tree is
 * what the manual reproduction did, and it CANNOT be what a test does: `imageSubpathExports.test.ts` and its
 * neighbours scan the working tree in the same parallel run, and a probe file living for the length of an
 * ESLint invocation was reported by one of them as a real violation. And a virtual path needs
 * `parserOptions.project` turned OFF for this run, because ESLint's type-aware parser answers a path no
 * TSConfig includes with a FATAL parse error rather than a rule report — also measured. Nothing is lost:
 * `no-restricted-imports` takes no type information, and the assertions below reject a fatal message
 * explicitly, so a probe that failed to parse cannot read as "no violations".
 *
 * Both directions are checked: a forbidden deep import must be reported, a DECLARED subpath must not, and
 * the package's own credential restriction must still fire — so the composition cannot pass by turning
 * everything on or everything off.
 *
 * DESIGN PATTERN: Specification module over a pure predicate ({@link overridesRestrictedImports}), fired at
 * deliberately-violating fakes below as well as at the working tree, plus an Adapter around the ESLint API.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

import { presentFiles, repoRoot, type SourceFile } from './serviceSources.js';

/** The rule whose flat-config entry is replaced rather than merged. */
const RULE = 'no-restricted-imports';

/** The composer every package must go through instead of spelling the rule itself. */
const COMPOSER = 'restrictedImportsRule';

/**
 * A deep import that is NOT a declared export of any workspace — so the shared `patterns` allow-list must
 * report it wherever that allow-list is in force.
 *
 * `recipe-core` publishes `parsing/parse-key`; `src/parsing/parseKey.js` is the same module reached through
 * the package's internals, which is precisely the reach the rule exists to stop.
 */
const FORBIDDEN_DEEP_IMPORT = '@kitchensink/recipe-core/src/parsing/parseKey.js';

/** A DECLARED subpath export of the same package — the allow-list must NOT report this one. */
const DECLARED_SUBPATH = '@kitchensink/recipe-core/resolution/normalized-key';

/**
 * The package whose override had the hole, and the only one today with a `src`-scoped rule block.
 *
 * Named here for the EMPIRICAL half only — the structural half above discovers every package — because
 * firing a probe needs a directory the package's own TSConfig includes, which is a per-package fact.
 */
const PROBE_PACKAGE = 'packages/services/recipe-service';

/** Where the probes are addressed: inside `src/`, which is exactly the tree the override had disabled. */
const PROBE_DIR = 'src/ingredients/resolution';

/** The three probes, and what each one proves. */
const PROBES = {
    forbidden: {
        file: `${PROBE_DIR}/zzRestrictedImportProbe.ts`,
        source: `import { PARSE_ENGINES } from '${FORBIDDEN_DEEP_IMPORT}';\n\nexport const probe = PARSE_ENGINES;\n`,
    },
    declared: {
        file: `${PROBE_DIR}/zzDeclaredSubpathProbe.ts`,
        source: `import { normalizedIngredientKey } from '${DECLARED_SUBPATH}';\n\nexport const probe = normalizedIngredientKey;\n`,
    },
    credential: {
        file: `${PROBE_DIR}/zzCredentialProbe.ts`,
        source: "import { revealCallerToken } from '../../auth/CallerToken.js';\n\nexport const probe = revealCallerToken;\n",
    },
} as const;

/**
 * Whether a config source spells the rule itself instead of composing through {@link COMPOSER}.
 *
 * Textual, and safe for this subject in a way it would not be for a migration header: the question is
 * whether the rule NAME appears as a KEY in a `rules` object, so the quoted-key-plus-colon form is required
 * and a comment that merely mentions the rule contributes nothing. A composed entry is recognised by the
 * composer's name appearing on that key's value; a bare entry opens an array literal, and an array literal
 * is what replaces.
 *
 * @param source - One `eslint.config.js`.
 * @returns True when the file redefines the rule without carrying the shared patterns forward. Pure.
 */
export function overridesRestrictedImports(source: SourceFile): boolean {
    const entries = source.contents.matchAll(new RegExp(`['"\`]${RULE}['"\`]\\s*:\\s*([^,\\n]*)`, 'g'));

    for (const entry of entries) {
        if (!(entry[1] ?? '').includes(COMPOSER)) {
            return true;
        }
    }

    return false;
}

/**
 * Every package-level ESLint flat config in the tree.
 *
 * @returns The configs, read. Impure.
 * @sideEffect Shells out to git and reads the working tree.
 */
function packageConfigs(): readonly SourceFile[] {
    return presentFiles(['packages'])
        .filter((file) => path.basename(file) === 'eslint.config.js')
        .map((file) => ({ file, contents: readFileSync(path.join(repoRoot, file), 'utf8') }));
}

describe('the shared restricted-import patterns survive every package override', () => {
    it('discovers the package configs, so the assertion below is not vacuous', () => {
        const configs = packageConfigs();

        expect(configs.length, 'no package eslint.config.js found — discovery has broken').toBeGreaterThan(3);
        expect(configs.map((config) => config.file)).toContain(`${PROBE_PACKAGE}/eslint.config.js`);
    });

    it('⛔ lets NO package spell the rule itself instead of composing the shared patterns', () => {
        // A bare entry REPLACES the shared `patterns`, silently and package-wide. Add your `paths` through
        // `restrictedImportsRule(...)` from `@kitchensink/eslint` instead — never a second copy of the
        // allow-list, which is the duplication this repo has already been bitten by once.
        expect(
            packageConfigs()
                .filter(overridesRestrictedImports)
                .map((config) => config.file),
        ).toEqual([]);
    });

    it('⛔ FAILS a config that redefines the rule with only its own paths', () => {
        expect(
            overridesRestrictedImports({
                file: 'fake/eslint.config.js',
                contents: `
                    export default [
                        ...base,
                        {
                            files: ['src/**/*.ts'],
                            rules: {
                                'no-restricted-imports': ['error', { paths: [{ name: './Secret.js' }] }],
                            },
                        },
                    ];
                `,
            }),
        ).toBe(true);
    });

    it('passes a config that composes through the shared rule, and one that adds nothing', () => {
        expect(
            overridesRestrictedImports({
                file: 'fake/composed.config.js',
                contents: "rules: { 'no-restricted-imports': restrictedImportsRule([{ name: './Secret.js' }]) },",
            }),
        ).toBe(false);
        expect(
            overridesRestrictedImports({
                file: 'fake/prose.config.js',
                contents: `
                    // This package deliberately adds no no-restricted-imports entry of its own.
                    export default [...base];
                `,
            }),
        ).toBe(false);
    });
});

describe(`the guard is IN FORCE inside ${PROBE_PACKAGE}/src`, () => {
    /** Rule ids reported per probe, from the one shared ESLint instance. A `null` id is a FATAL message. */
    let reported: Record<keyof typeof PROBES, readonly (string | null)[]>;

    beforeAll(async () => {
        const cwd = path.join(repoRoot, PROBE_PACKAGE);
        // ⚠️ `project: false` for this run only — see the header. The config resolved for each path is the
        // package's real one; only the type-aware program, which no rule under test needs, is skipped.
        const eslint = new ESLint({
            cwd,
            overrideConfig: { languageOptions: { parserOptions: { project: false, projectService: false } } },
        });
        const rulesFor = async (probe: { file: string; source: string }): Promise<readonly (string | null)[]> => {
            const results = await eslint.lintText(probe.source, { filePath: path.join(cwd, probe.file) });

            return (results[0]?.messages ?? []).map((message) => message.ruleId);
        };

        reported = {
            forbidden: await rulesFor(PROBES.forbidden),
            declared: await rulesFor(PROBES.declared),
            credential: await rulesFor(PROBES.credential),
        };
    });

    it('parses every probe, so a silent fatal cannot read as “no violations”', () => {
        // A fatal message carries a `null` rule id. Without this, a config that failed to load would make the
        // DECLARED-subpath assertion below pass by reporting nothing at all.
        expect(
            Object.values(reported)
                .flat()
                .filter((ruleId) => ruleId === null),
        ).toEqual([]);
    });

    it('⛔ reports a deep import into another package’s internals from inside src/', () => {
        // ⛔ THE DEFECT. This came back EMPTY while the override stood — the same source under `contract/`
        // reported the error, which is how the hole was found.
        expect(reported.forbidden).toContain(RULE);
    });

    it('does NOT report a DECLARED subpath export — so the probe distinguishes, rather than always firing', () => {
        expect(reported.declared).toEqual([]);
    });

    it('⛔ still confines the credential accessor — the override’s own reason for existing', () => {
        // Composing the shared patterns back in must not cost the package's own restriction. Asserting both
        // halves in the same run is what makes "it passes" mean COMPOSED, rather than one of them winning.
        expect(reported.credential).toContain(RULE);
    });
});
