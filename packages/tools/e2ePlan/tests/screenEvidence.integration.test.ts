/**
 * The recorder and the narrowing, end to end on a fixture record file: the record lines a lane writes go through the
 * recorder's check, which writes the JSON report, which the narrowing reads. Neither side parses English any more, so a
 * change to the report's shape fails here.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { narrowRows } from '../src/narrowFlowRows.js';
import { checkScreenFiles, writeScreenEvidence } from '../src/recordedScreens.js';
import { evidenceOf, parseScreenEvidence } from '../src/screenEvidence.js';

describe('recorder check, then narrowing', () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'screenEvidence-'));
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    /** A lane's record file: `a` showed Home and Editor, `b` showed Home and an extra screen, `c` failed. */
    const record = (platform: string, extra: string): string => {
        const file = join(dir, `${platform}.tsv`);

        writeFileSync(
            file,
            [
                'screen\trecipes/a\tHomeScreen',
                'screen\trecipes/a\tRecipeEditorScreen',
                'result\trecipes/a\tpassed',
                'screen\trecipes/b\tHomeScreen',
                `screen\trecipes/b\t${extra}`,
                'result\trecipes/b\tpassed',
                'screen\trecipes/c\tHomeScreen',
                'result\trecipes/c\tfailed',
                '',
            ].join('\n'),
        );

        return file;
    };

    const coverage = new Map([
        ['recipes/a', new Set(['HomeScreen', 'RecipeEditorScreen', 'RecipeVersionsScreen'])],
        ['recipes/b', new Set(['HomeScreen', 'RecipeVersionsScreen'])],
        ['recipes/c', new Set(['HomeScreen', 'RecipeVersionsScreen'])],
    ]);

    function evidenceFor(platform: 'android' | 'ios', extra: string) {
        const report = checkScreenFiles([{ platform, file: record(platform, extra) }], coverage, new Set());

        writeScreenEvidence(report, join(dir, 'evidence'));

        return evidenceOf(
            parseScreenEvidence(readFileSync(join(dir, 'evidence', `${platform}.json`), 'utf8'), platform),
        );
    }

    const table = new Map([
        ['recipes/a', new Set(['HomeScreen', 'RecipeEditorScreen', 'RecipeVersionsScreen'])],
        ['recipes/b', new Set(['HomeScreen', 'RecipeVersionsScreen'])],
        ['recipes/c', new Set(['HomeScreen', 'RecipeVersionsScreen'])],
    ]);
    const input = (branching: string[] = []) => ({
        table,
        subflows: new Set<string>(),
        suppliedBySubflows: () => new Set<string>(),
        branching: new Set(branching),
        android: evidenceFor('android', 'profile'),
        ios: evidenceFor('ios', 'profile'),
    });

    it('removes a screen both reports found unobserved in the passing flow, and nothing for a failed one', () => {
        const result = narrowRows(input());

        expect(result.removed).toEqual([
            { flow: 'recipes/a', screens: ['RecipeVersionsScreen'] },
            { flow: 'recipes/b', screens: ['RecipeVersionsScreen'] },
        ]);
        expect(result.kept).toContainEqual({ flow: 'recipes/c', reason: expect.stringMatching(/did not pass/u) });
    });

    it('lists the screen both platforms showed that the row lacks, and does not add it', () => {
        const result = narrowRows(input());

        expect(result.owedAdditions).toContainEqual({ flow: 'recipes/b', screens: ['profile'] });
        expect(result.table.get('recipes/b')?.has('profile')).toBe(false);
    });

    it('keeps a branching flow whole, however clean its reports', () => {
        const result = narrowRows(input(['recipes/a', 'recipes/b', 'recipes/c']));

        expect(result.removed).toEqual([]);
    });
});
