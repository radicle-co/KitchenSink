import { describe, expect, it } from 'vitest';

import { isDesignArtifactError } from '../../errors.js';
import { execGitHead, parseGitHead } from '../gitHead.js';

describe('parseGitHead', () => {
    it('reads the commit id and date from `git show -s --format=%H%n%cI`', () => {
        expect(parseGitHead('0123456789abcdef0123456789abcdef01234567\n2026-10-16T17:55:40-04:00\n')).toEqual({
            sha: '0123456789abcdef0123456789abcdef01234567',
            date: '2026-10-16T17:55:40-04:00',
        });
    });

    it.each([
        ['empty output', ''],
        ['a short id', 'abc123\n2026-10-16T17:55:40-04:00\n'],
        ['a non-hex id', `${'z'.repeat(40)}\n2026-10-16T17:55:40-04:00\n`],
        ['no date', `${'a'.repeat(40)}\n`],
        ['a date that is not ISO-8601', `${'a'.repeat(40)}\nyesterday\n`],
    ])('refuses %s rather than stamp a README with a guess', (_label, output) => {
        expect(() => parseGitHead(output)).toThrowError(/git/iu);

        try {
            parseGitHead(output);
        } catch (error) {
            expect(isDesignArtifactError(error) && error.code).toBe('missing-source');
        }
    });
});

describe('execGitHead over a scripted git', () => {
    const HEAD = `${'a'.repeat(40)}\n2026-10-16T17:55:40-04:00\n`;
    const scripted = (porcelain: string) => async (args: readonly string[]) =>
        args[0] === 'status' ? porcelain : HEAD;

    it.each([
        ['a clean tree', '', false],
        ['a modified file', ' M src/a.ts\n', true],
        ['an untracked file', '?? new.ts\n', true],
    ])('reports %s as dirty=%s', async (_label, porcelain, dirty) => {
        expect(await execGitHead('/repo', scripted(porcelain))()).toEqual({
            sha: 'a'.repeat(40),
            date: '2026-10-16T17:55:40-04:00',
            dirty,
        });
    });

    it('asks git for the machine-readable status, which is stable across versions and locales', async () => {
        const calls: (readonly string[])[] = [];

        await execGitHead('/repo', (args) => {
            calls.push(args);

            return Promise.resolve(args[0] === 'status' ? '' : HEAD);
        })();

        expect(calls).toContainEqual(['status', '--porcelain']);
    });
});
