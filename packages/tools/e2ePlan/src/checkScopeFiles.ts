/**
 * The per-file tiers (ADR-0091): checks that read one file at a time, so a change needs only its own files checked,
 * and a change to the check's configuration needs every file checked.
 *
 * @pattern Registry — tier name to the files it checks and the configuration that widens it
 * @pattern Specification — each tier is a pair of path predicates
 */
import picomatch from 'picomatch';

import { SELECTOR_SOURCES, type ChangeSource } from './checkScope.js';

interface FileTierRule {
    /** The files the tier checks. */
    readonly checks: readonly string[];
    /** A change to any of these re-checks every file. */
    readonly widenedBy: readonly string[];
    /** The arguments that make the tool check every file, as the tool itself spells it. */
    readonly allArgs: readonly string[];
}

export const FILE_TIERS = {
    /** Prettier over the prose no package owns (the root `format:check:docs` globs). */
    docs: {
        checks: ['*.md', 'docs/**/*.md', 'specs/**/*.md'],
        // Prettier expands these globs itself and honours `.prettierignore` while it does.
        allArgs: ['*.md', 'docs/**/*.md', 'specs/**/*.md'],
        widenedBy: [
            'prettier.config.js',
            '.prettierignore',
            'package-lock.json',
            'packages/tools/prettier/**',
            ...SELECTOR_SOURCES,
        ],
    },
    /** actionlint over the workflow files. It reads a called workflow's inputs, so the actions folder widens it too. */
    workflows: {
        checks: ['.github/workflows/*.yml', '.github/workflows/*.yaml'],
        // With no file argument actionlint finds and checks every workflow of the repository.
        allArgs: [],
        widenedBy: ['.github/actionlint.yaml', '.github/actionlint.yml', '.github/actions/**', ...SELECTOR_SOURCES],
    },
} as const satisfies Record<string, FileTierRule>;

export type FileTier = keyof typeof FILE_TIERS;

export type FileScope =
    | { readonly kind: 'all'; readonly reasons: readonly string[] }
    | { readonly kind: 'some'; readonly files: readonly string[] };

/**
 * Whether a string names a per-file tier.
 *
 * @param value - The name to check.
 * @returns True for a key of {@link FILE_TIERS}.
 */
export const isFileTier = (value: string): value is FileTier => Object.hasOwn(FILE_TIERS, value);

/**
 * Decides which files a per-file tier checks.
 *
 * @param tier - The tier.
 * @param change - The change.
 * @returns Every file, with why; or the changed files the tier checks (possibly none).
 */
export function scopeFiles(tier: FileTier, change: ChangeSource): FileScope {
    if (change.kind === 'full') {
        return { kind: 'all', reasons: [change.reason] };
    }

    const rule: FileTierRule = FILE_TIERS[tier];
    const checks = picomatch([...rule.checks], { dot: true });
    const widens = picomatch([...rule.widenedBy], { dot: true });
    const reasons = change.files.filter((file) => widens(file)).map((file) => `${file} configures the check`);

    if (reasons.length > 0) {
        return { kind: 'all', reasons };
    }

    return { kind: 'some', files: change.files.filter((file) => checks(file)) };
}
