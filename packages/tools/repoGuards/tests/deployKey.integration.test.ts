/**
 * `deployKey.sh` against THIS repository's real image closure (ADR-0067): the key of every content-keyed deployable
 * computes at HEAD, is the same twice, and every path the closure names exists at HEAD, so a generated closure that
 * fell behind the tree cannot hide behind a fixture.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { repoRoot } from '../__tests__/serviceSources.js';
import { CONTENT_DEPLOYABLES, MANIFEST_IMAGE_CLOSURES } from '../../../../scripts/infrastructureManifest.mjs';

const SCRIPT = path.join(repoRoot, '.github', 'scripts', 'deployKey.sh');

const key = (deployable: string): string => {
    const result = spawnSync('bash', [SCRIPT, 'key', deployable, 'HEAD'], { cwd: repoRoot, encoding: 'utf8' });

    expect(result.status, result.stderr).toBe(0);

    return result.stdout.trim();
};

describe('deployKey.sh over the committed image closure', () => {
    const deployables = (CONTENT_DEPLOYABLES as readonly { readonly name: string }[]).map(({ name }) => name);

    it.each(deployables)('computes a stable key for %s at HEAD', (deployable) => {
        const first = key(deployable);

        expect(first).toMatch(/^[0-9a-f]{64}$/u);
        expect(key(deployable)).toBe(first);
    });

    it('resolves every path the closure names at HEAD', () => {
        const committed = execFileSync('git', ['show', `HEAD:${MANIFEST_IMAGE_CLOSURES}`], {
            cwd: repoRoot,
            encoding: 'utf8',
        });
        const paths = committed
            .split('\n')
            .filter((line) => line !== '' && !line.startsWith('#'))
            .map((line) => line.split('\t')[1] ?? '');
        const unresolved = paths.filter(
            (file) =>
                spawnSync('git', ['rev-parse', '--verify', '--quiet', `HEAD:${file}`], { cwd: repoRoot }).status !== 0,
        );

        expect(paths.length).toBeGreaterThan(50);
        expect(unresolved).toEqual([]);
        expect(readFileSync(path.join(repoRoot, MANIFEST_IMAGE_CLOSURES), 'utf8')).toBe(committed);
    });
});
