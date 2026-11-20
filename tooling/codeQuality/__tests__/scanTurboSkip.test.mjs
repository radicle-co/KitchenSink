// scan.mjs end to end on a throwaway repository: the turbo-boundaries tool with no local turbo binary must report
// SKIPPED. It once threw a ReferenceError instead, because a destructured `skipped` later in the same callback shadowed
// the module's `skipped` helper (temporal dead zone), so the tool was FAILED for the wrong reason.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCAN = join(dirname(fileURLToPath(import.meta.url)), '..', 'scan.mjs');
let root;

describe('scan.mjs turbo-boundaries without a turbo binary', () => {
    before(() => {
        root = mkdtempSync(join(tmpdir(), 'scanTurbo-'));
        const git = (...args) => execFileSync('git', args, { cwd: join(root, 'repo'), stdio: 'ignore' });
        mkdirSync(join(root, 'repo'));
        git('init', '-q', '-b', 'main');
        writeFileSync(join(root, 'repo', 'turbo.json'), '{}\n');
        git('add', 'turbo.json');
        git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'one');
        writeFileSync(join(root, 'repo', 'a.ts'), 'export const a = 1;\n');
        git('add', 'a.ts');
        git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'two');
    });
    after(() => rmSync(root, { recursive: true, force: true }));

    it('reports SKIPPED with the reason, not a crash', () => {
        const out = join(root, 'out');
        execFileSync(
            'node',
            [SCAN, '--repo', join(root, 'repo'), '--base', 'HEAD~1', '--out', out, '--tools', 'turbo-boundaries'],
            { stdio: 'ignore' },
        );
        const status = JSON.parse(readFileSync(join(out, 'status.json'), 'utf8'));
        const turbo = status.tools.find((t) => t.tool === 'turbo-boundaries');
        assert.equal(turbo.status, 'SKIPPED');
        assert.match(turbo.detail, /no local turbo binary/);
    });
});
