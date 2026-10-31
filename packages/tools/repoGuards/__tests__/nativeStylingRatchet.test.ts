/**
 * Mobile UI is styled with Tamagui only (owner rulings 2026-10-31: "Make sure all React Native styling is replaced by
 * tamagui"; constitution Principle VII; ADR-0080). This ratchet holds the count of React Native styling uses, as
 * `nativeStyling.ts` defines them, so it can only fall until it reaches zero.
 *
 * ⛔ IT ENUMERATES NOTHING. Candidates are every native module (`nativeSources.ts`); the detector is proven against its
 * own fixture table (`nativeStyling.test.ts`) before it is trusted with the tree.
 *
 * ## The rules
 *
 * - A file may not exceed its count in `nativeStylingBaseline.json`, and a file not listed may not have any. A NEW
 *   native file is therefore styled with Tamagui from its first line.
 * - A file that drops below its count fails until the count is lowered in the same change, so the number recorded is
 *   always true. A file that reaches zero leaves the baseline.
 * - Every listed file existed at {@link RECORDED_AT}, with at least its listed count. A count cannot be raised by
 *   re-recording, and a new file cannot be added to the list. A rename makes a new path, which cannot carry a count, so
 *   an unmigrated file is migrated before it moves.
 * - A file that imports Tamagui is migrated whole: its count is zero. No file mixes the two.
 * - `// NATIVE-STYLE-ADAPTER: <reason>` is honoured only in `ui/src`, for an Adapter over a style surface with no
 *   Tamagui path yet. Those uses are held in their own count, which also only falls.
 *
 * ✅ THE FIX FOR A FAILURE: style the element with Tamagui (`styled()` from `tamagui`, or a design-system primitive),
 * with tokens from `@commise/ui/tamagui-config`. Then lower the file's count, or remove its entry at zero.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { parseModule } from './appSources.js';
import { nativeSources } from './nativeSources.js';
import { nativeStylingUses, type NativeStylingUses } from './nativeStyling.js';
import { repoRoot } from './serviceSources.js';

/**
 * The commit the baseline was measured at. Changing it is a re-record, which the provenance rule makes unable to raise a
 * count; changing it at all is a decision a reviewer sees here.
 */
const RECORDED_AT = '5979abcd5efc8557f51d7fcd2c06c4add5d0442d';

const BASELINE_FILE = path.join(import.meta.dirname, 'nativeStylingBaseline.json');

interface Baseline {
    readonly files: Readonly<Record<string, number>>;
    readonly adapterExemptions: Readonly<Record<string, number>>;
}

const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) as Baseline;

const sources = nativeSources();

const usesOf = new Map<string, NativeStylingUses>(
    sources.map((file) => [file, nativeStylingUses(readFileSync(path.join(repoRoot, file), 'utf8'), file)]),
);

function countsBy(pick: (uses: NativeStylingUses) => number): Readonly<Record<string, number>> {
    return Object.fromEntries(
        [...usesOf].map(([file, uses]) => [file, pick(uses)] as const).filter(([, count]) => count > 0),
    );
}

const counts = countsBy((uses) => uses.counted.length);

const exemptCounts = countsBy((uses) => uses.exempt.length);

function over(actual: Readonly<Record<string, number>>, recorded: Readonly<Record<string, number>>): string[] {
    return Object.entries(actual)
        .filter(([file, count]) => count > (recorded[file] ?? 0))
        .map(([file, count]) => `${file}: ${count} > ${recorded[file] ?? 0}`);
}

function stale(actual: Readonly<Record<string, number>>, recorded: Readonly<Record<string, number>>): string[] {
    return Object.entries(recorded)
        .filter(([file, count]) => (actual[file] ?? 0) < count)
        .map(([file, count]) => `${file}: recorded ${count}, now ${actual[file] ?? 0}`);
}

function importsTamagui(file: string): boolean {
    return parseModule(file, readFileSync(path.join(repoRoot, file), 'utf8')).statements.some(
        (statement) =>
            ts.isImportDeclaration(statement) &&
            ts.isStringLiteral(statement.moduleSpecifier) &&
            /^(?:tamagui|@tamagui\/[^/]+)$/u.test(statement.moduleSpecifier.text) &&
            statement.importClause !== undefined &&
            !statement.importClause.isTypeOnly,
    );
}

function sourceAt(commit: string, file: string): string | undefined {
    try {
        return execFileSync('git', ['show', `${commit}:${file}`], {
            cwd: repoRoot,
            encoding: 'utf8',
            maxBuffer: 1 << 26,
            stdio: ['ignore', 'pipe', 'ignore'],
        });
    } catch {
        return undefined;
    }
}

describe('React Native styling only falls (ADR-0080)', () => {
    it('discovers the native modules, the mobile root included (a vacuous pass would hide the rule)', () => {
        expect(sources).toContain('packages/apps/commise/ui/src/button/Button.native.tsx');
        expect(sources).toContain('packages/apps/commise/mobile/src/components/home/HomeGreeting.tsx');
        expect(sources).toContain('packages/apps/commise/mobile/App.tsx');
    });

    it('reads real uses, so an empty baseline cannot pass by reading nothing', () => {
        expect(Object.keys(counts).length).toBeGreaterThan(0);
    });

    it('lets no file exceed its recorded count, and no unrecorded file have any', () => {
        expect(over(counts, baseline.files)).toEqual([]);
    });

    it('records no file above its true count; a drop is written down in the same change', () => {
        expect(stale(counts, baseline.files)).toEqual([]);
    });

    it('holds the adapter exemptions the same way, apart from the counted uses', () => {
        expect(over(exemptCounts, baseline.adapterExemptions)).toEqual([]);
        expect(stale(exemptCounts, baseline.adapterExemptions)).toEqual([]);
    });

    it('refuses an adapter exemption outside the design system', () => {
        const misplaced = [...usesOf].flatMap(([file, uses]) =>
            uses.misplacedExemptions.map(({ line, text }) => `${file}:${line} ${text}`),
        );

        expect(misplaced).toEqual([]);
    });

    it('lets a file that imports Tamagui hold no React Native styling at all', () => {
        const mixed = sources.filter((file) => importsTamagui(file) && (counts[file] ?? 0) > 0);

        expect(mixed).toEqual([]);
    });

    it(`lists only files that existed at ${RECORDED_AT.slice(0, 9)}, at no more than their count there`, () => {
        const unproven = Object.entries({ ...baseline.files, ...baseline.adapterExemptions }).flatMap(
            ([file, count]) => {
                const before = sourceAt(RECORDED_AT, file);

                if (before === undefined) {
                    return [
                        `${file}: not readable at ${RECORDED_AT}. A new or renamed file cannot carry a count; if the ` +
                            `commit is missing, fetch full history (git fetch --unshallow).`,
                    ];
                }

                const uses = nativeStylingUses(before, file);
                const then = uses.counted.length + uses.exempt.length;

                return count > then ? [`${file}: recorded ${count}, but ${then} at ${RECORDED_AT}`] : [];
            },
        );

        expect(unproven).toEqual([]);
    });
});
