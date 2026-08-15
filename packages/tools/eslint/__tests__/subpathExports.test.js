/**
 * Guard on the `no-restricted-imports` subpath allow-list in `../index.js`.
 *
 * ## The defect this exists to prevent
 *
 * The rule's stated intent is "block reaching into another package's internals, but allow its DECLARED granular
 * export barrels". The allow-list that implements it is a hand-written copy of what the manifests declare, and a
 * copy cannot detect that the original has grown. It had already diverged: `@kitchensink/recipe-core` declares
 * `./database-name` and `@kitchensink/recipe-workers` declares `./infra`, neither was in the list, and the rule
 * therefore reported five imports of a PUBLISHED entry point as reaching into internals.
 *
 * That divergence survived because the files holding those imports — `infra/**` in two services — were excluded
 * from the lint run by an `ignores: ['infra/**']` workaround. It became visible the moment coverage widened
 * (`packages/infra/global/__tests__/staticAnalysisCoverage.test.ts`), which is the general lesson: a false
 * positive in an unlinted directory is indistinguishable from no rule at all.
 *
 * ## Why the subjects are DISCOVERED
 *
 * The expected set is read from every workspace manifest's own `exports` map, so a package that declares a new
 * subpath tomorrow fails this test rather than silently accumulating false positives. Enumerating the packages
 * here would rebuild the very copy the test exists to police.
 *
 * The verdict is computed by handing the patterns to the SAME `ignore` matcher `no-restricted-imports`
 * constructs internally, applied to the real `group` array pulled out of the exported config — so neither the
 * matcher nor the list is a second copy of anything.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import ignore from 'ignore';
import { describe, expect, it } from 'vitest';

import { createConfig } from '../index.js';

const repoRoot = path.resolve(import.meta.dirname, '../../../..');

/** Repo-relative paths of every tracked workspace manifest. */
function manifestPaths() {
    const rootManifest = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    const globs = rootManifest.workspaces ?? [];

    return execFileSync('git', ['ls-files', '--', '*/package.json'], {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 1 << 28,
    })
        .split('\n')
        .filter((file) => file.length > 0 && !file.includes('node_modules/') && existsSync(path.join(repoRoot, file)))
        .filter((file) => {
            const dir = path.posix.dirname(file);

            // Depth match rather than a glob library: every workspace glob here is `<a>/<b>/*`-shaped or an
            // exact path, so "the directory equals the glob, or the glob's parent equals the directory's parent"
            // decides it without pulling in a dependency this package does not have.
            return globs.some((glob) =>
                glob.endsWith('/*') ? path.posix.dirname(dir) === glob.slice(0, -2) : dir === glob,
            );
        });
}

/** Extensions `no-restricted-imports` can meaningfully govern: an ES-module import specifier. */
const MODULE_TARGET = /\.(?:js|mjs|cjs|ts|tsx)$/u;

/** Any subpath of a package that publishes a wildcard surface — probed with a name nothing else matches. */
const WILDCARD_PROBE = 'wildcardSubpathProbe';

/**
 * Resolve an `exports` value to its target string, following the conditional-export object form.
 *
 * @param value - The `exports` entry.
 * @returns The first target string found, or `undefined`.
 */
function targetOf(value) {
    if (typeof value === 'string') {
        return value;
    }

    if (typeof value === 'object' && value !== null) {
        for (const nested of Object.values(value)) {
            const found = targetOf(nested);

            if (found !== undefined) {
                return found;
            }
        }
    }

    return undefined;
}

/**
 * Every `@kitchensink/<pkg>/<subpath>` MODULE specifier the workspaces publish.
 *
 * Two filters, both deliberate. The bare `.` barrel is skipped because the rule never restricts a barrel. A
 * non-module target is skipped because the rule governs `import` specifiers and nothing else: `@kitchensink/
 * typescript/base.json` is a tsconfig reached through `extends`, and `@kitchensink/schema-food/openapi.yaml` is
 * a document for `oasdiff` — neither is ever an import, so demanding the allow-list name them would be a gate
 * asserting something the rule cannot observe.
 *
 * A wildcard key (`./*`) publishes an OPEN set, which is the whole API of the `packages/tools/*` config
 * packages. It contributes one probe specifier, so the allow-list has to permit the package's subpaths as a
 * class rather than one name at a time.
 *
 * @returns Specifiers, sorted and de-duplicated.
 */
function declaredSubpathSpecifiers() {
    const specifiers = [];

    for (const manifestPath of manifestPaths()) {
        const manifest = JSON.parse(readFileSync(path.join(repoRoot, manifestPath), 'utf8'));
        const name = manifest.name ?? '';

        if (!name.startsWith('@kitchensink/') || typeof manifest.exports !== 'object' || manifest.exports === null) {
            continue;
        }

        for (const [key, value] of Object.entries(manifest.exports)) {
            const target = targetOf(value);

            if (key === '.' || key === './package.json' || target === undefined || !MODULE_TARGET.test(target)) {
                continue;
            }

            const subpath = key.replace(/^\.\//u, '');

            specifiers.push(`${name}/${subpath === '*' ? WILDCARD_PROBE : subpath}`);
        }
    }

    return [...new Set(specifiers)].sort();
}

/** The live `group` array out of the exported config — never a second copy of it. */
function restrictedGroup() {
    const config = createConfig('./tsconfig.json', repoRoot);
    const blocks = config.filter(
        (block) => block.rules !== undefined && block.rules['no-restricted-imports'] !== undefined,
    );
    const [, options] = blocks.at(-1).rules['no-restricted-imports'];

    return options.patterns[0].group;
}

/**
 * Whether `group` permits `specifier`.
 *
 * Uses `ignore` with the SAME options `no-restricted-imports` constructs internally
 * (`allowRelativePaths: true`, case-sensitive), rather than a regex translation of the patterns. A hand-rolled
 * matcher was tried first and was wrong in the direction that hides bugs: gitignore semantics ignore every
 * DESCENDANT of a matched directory, so `@kitchensink/*\/*` restricts `pkg/src/internal/secret` through its
 * `pkg/src` prefix, while an anchored regex called that path allowed. A gate whose matcher disagrees with the
 * rule proves nothing about the rule.
 *
 * @param group - The pattern list.
 * @param specifier - The import specifier to test.
 * @returns True when the specifier is allowed.
 */
function isAllowed(group, specifier) {
    return !ignore({ allowRelativePaths: true, ignorecase: false }).add(group).ignores(specifier);
}

describe('the no-restricted-imports subpath allow-list', () => {
    const declared = declaredSubpathSpecifiers();
    const group = restrictedGroup();

    it('discovers the declared subpath exports, so the assertion below is not vacuous', () => {
        expect(declared.length).toBeGreaterThanOrEqual(5);
        expect(declared).toContain('@kitchensink/recipe-core/database-name');
        expect(declared).toContain('@kitchensink/recipe-workers/infra');
        expect(group.length).toBeGreaterThanOrEqual(10);
    });

    it('matches the rule semantics in both directions', () => {
        // An undeclared internal path must stay blocked, or "everything is allowed" would pass this suite.
        expect(isAllowed(group, '@kitchensink/recipe-core/src/internal/secret')).toBe(false);
        expect(isAllowed(group, '@kitchensink/identity-service/users/internals')).toBe(false);
        // …and a barrel is never restricted in the first place.
        expect(isAllowed(group, '@kitchensink/recipe-core')).toBe(true);
    });

    it('permits every subpath the workspaces declare', () => {
        expect(
            declared.filter((specifier) => !isAllowed(group, specifier)),
            'This subpath is a DECLARED export but the allow-list in index.js does not name it, so the rule ' +
                'reports importing a published entry point as reaching into internals. Add a `!` negation for it.',
        ).toEqual([]);
    });
});
