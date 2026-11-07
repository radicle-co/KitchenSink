/**
 * Metro swaps `useScreenTrace.ts` for `useScreenTrace.maestro.ts` only when the bundle is built with
 * `COMMISE_SCREEN_TRACE=1`. The swap is a source extension placed AHEAD of the plain ones, the same mechanism as
 * `.native`; without the flag the config must be byte-for-byte what it was, so a production bundle cannot find the twin.
 */
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const MOBILE_DIR = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function sourceExts(flag: string | undefined): readonly string[] {
    const env: NodeJS.ProcessEnv = { ...process.env };

    delete env['COMMISE_SCREEN_TRACE'];

    if (flag !== undefined) {
        env['COMMISE_SCREEN_TRACE'] = flag;
    }

    const run = spawnSync(
        process.execPath,
        ['-e', "process.stdout.write(JSON.stringify(require('./metro.config.cjs').resolver.sourceExts))"],
        { cwd: MOBILE_DIR, env, encoding: 'utf8' },
    );

    if (run.status !== 0) {
        throw new Error(`metro.config.cjs did not load: ${run.stderr}`);
    }

    return JSON.parse(run.stdout) as string[];
}

describe('metro.config.cjs sourceExts', () => {
    it('has no recorder extension without the flag', () => {
        expect(sourceExts(undefined).filter((ext) => ext.startsWith('maestro'))).toEqual([]);
    });

    it('has none for any value but 1', () => {
        expect(sourceExts('0').filter((ext) => ext.startsWith('maestro'))).toEqual([]);
        expect(sourceExts('true').filter((ext) => ext.startsWith('maestro'))).toEqual([]);
    });

    it('puts maestro.ts and maestro.tsx ahead of every other extension with COMMISE_SCREEN_TRACE=1', () => {
        const exts = sourceExts('1');

        expect(exts.slice(0, 2)).toEqual(['maestro.ts', 'maestro.tsx']);
        expect(exts.slice(2)).toEqual(sourceExts(undefined));
    });
});
