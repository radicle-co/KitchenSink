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
 * - The baseline itself only falls. Each count is at most the one in the REFERENCE baseline, and no path is added to
 *   it, so a count cannot be raised by re-recording. A rename makes a new path, which cannot carry a count, so an
 *   unmigrated file is migrated before it moves. The reference is the baseline on `origin/main`, the merge target.
 *   Until the baseline reaches main, it is the baseline as first committed, found from history (`git log
 *   --diff-filter=A`), so a long-lived branch is held too. Neither depends on one commit staying reachable, so a squash,
 *   a rebase or a deleted branch does not break the rule. A shallow clone, or a clone without `origin/main`, fails with
 *   the command to fetch, never a silent pass.
 * - The first recording was proven once, by hand: every listed file existed at `5979abcd5` with at least its listed
 *   count (the GATE on the commit that added the baseline, and ADR-0080). That proof is a record, not a live check.
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

import { describe, expect, it } from 'vitest';

import { parseModule } from './appSources.js';
import { valueBindingsOf } from './moduleBindings.js';
import { nativeSources } from './nativeSources.js';
import { nativeStylingUses, type NativeStylingUses } from './nativeStyling.js';
import { repoRoot } from './serviceSources.js';
import { TAMAGUI_MODULE } from './tamaguiElements.js';

const BASELINE_PATH = 'packages/tools/repoGuards/__tests__/nativeStylingBaseline.json';

const BASELINE_FILE = path.join(repoRoot, BASELINE_PATH);

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
    return valueBindingsOf(parseModule(file, readFileSync(path.join(repoRoot, file), 'utf8')), (specifier) =>
        TAMAGUI_MODULE.test(specifier),
    ).imported;
}

function git(args: readonly string[]): string | undefined {
    try {
        return execFileSync('git', args, {
            cwd: repoRoot,
            encoding: 'utf8',
            maxBuffer: 1 << 26,
            stdio: ['ignore', 'pipe', 'ignore'],
        });
    } catch {
        return undefined;
    }
}

/** The baseline the committed one may only fall from, and where it was read. */
interface Reference {
    readonly source: string;
    readonly baseline: Baseline;
}

/**
 * The reference baseline: `origin/main`'s, or until the baseline reaches main, the one first committed in this
 * history. `undefined` only when no commit in this history adds the baseline, which the test refuses.
 *
 * @sideEffect Reads git history.
 * @throws Error when the clone is shallow or has no `origin/main`, which would make the rule pass on nothing.
 */
function referenceBaseline(): Reference | undefined {
    if (git(['rev-parse', '--is-shallow-repository'])?.trim() === 'true') {
        throw new Error('This clone is shallow, so the baseline history cannot be read: run git fetch --unshallow.');
    }

    if (git(['rev-parse', '--verify', '--quiet', 'origin/main']) === undefined) {
        throw new Error(
            'origin/main is not in this clone, so the baseline has no reference: run git fetch origin main.',
        );
    }

    const onMain = git(['show', `origin/main:${BASELINE_PATH}`]);

    if (onMain !== undefined) {
        return { source: 'origin/main', baseline: JSON.parse(onMain) as Baseline };
    }

    const [introduced] = (git(['log', '--diff-filter=A', '--reverse', '--format=%H', '--', BASELINE_PATH]) ?? '')
        .split('\n')
        .filter((line) => line.length > 0);
    const first = introduced === undefined ? undefined : git(['show', `${introduced}:${BASELINE_PATH}`]);

    return first === undefined ? undefined : { source: introduced ?? '', baseline: JSON.parse(first) as Baseline };
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

    it('only lowers the baseline: no count above the reference, and no path added to it', () => {
        const reference = referenceBaseline();

        // The baseline is committed, so a reference always exists; none means the history read failed.
        expect(reference, 'no committed baseline found in history').toBeDefined();

        if (reference === undefined) {
            return;
        }

        const raised = [
            ...over(baseline.files, reference.baseline.files),
            ...over(baseline.adapterExemptions, reference.baseline.adapterExemptions),
        ].map((line) => `${line} (the reference is ${reference.source})`);

        expect(raised).toEqual([]);
    });
});
