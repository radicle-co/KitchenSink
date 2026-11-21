// scan.mjs end to end on a throwaway repository: a changed code file outside every package must make jscpd scan that
// file's own directory, never the repository root. The root group once ran `jscpd <repo>`, a whole-monorepo scan whose
// 179 MB report ran CI's scanner job out of heap (#429, decision S96). A fake jscpd records its path arguments.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
    chmodSync,
    mkdirSync,
    symlinkSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCAN = join(dirname(fileURLToPath(import.meta.url)), '..', 'scan.mjs');
const FAKE_JSCPD = `#!/bin/sh
# Records the scanned path (the last argument) and writes an empty report to --output.
while [ $# -gt 1 ]; do
    if [ "$1" = "--output" ]; then out="$2"; fi
    shift
done
mkdir -p "$out"
printf '%s\\n' "$1" >> "$SCQ_HOME/paths.log"
printf '{"statistics":{"total":{"sources":1}},"duplicates":[]}' > "$out/jscpd-report.json"
`;
let root;
let repo;

describe('scan.mjs jscpd for a code file outside every package', () => {
    before(() => {
        root = realpathSync(mkdtempSync(join(tmpdir(), 'scanJscpd-')));
        repo = join(root, 'repo');
        const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
        mkdirSync(join(repo, 'scripts'), { recursive: true });
        mkdirSync(join(root, 'home', 'node_modules', '.bin'), { recursive: true });
        // findingLocations.mjs loads `typescript` from SCQ_HOME, so the fake home borrows this checkout's copy.
        const tsDir = dirname(createRequire(import.meta.url).resolve('typescript/package.json'));
        symlinkSync(tsDir, join(root, 'home', 'node_modules', 'typescript'));
        writeFileSync(join(root, 'home', 'package.json'), '{}\n');
        const bin = join(root, 'home', 'node_modules', '.bin', 'jscpd');
        writeFileSync(bin, FAKE_JSCPD);
        chmodSync(bin, 0o755);
        git('init', '-q', '-b', 'main');
        writeFileSync(join(repo, 'README.md'), 'x\n');
        git('add', 'README.md');
        git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'one');
        writeFileSync(join(repo, 'scripts', 'tool.mjs'), 'export const a = 1;\n');
        git('add', 'scripts/tool.mjs');
        git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'two');
        mkdirSync(join(repo, 'tools', 'pkg'), { recursive: true });
        writeFileSync(join(repo, 'tools', 'pkg', 'package.json'), '{}\n');
        writeFileSync(join(repo, 'tools', 'loose.mjs'), 'export const c = 3;\n');
        git('add', 'tools/pkg/package.json', 'tools/loose.mjs');
        git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'three');
        writeFileSync(join(repo, 'rootTool.mjs'), 'export const b = 2;\n');
        git('add', 'rootTool.mjs');
        git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'four');
    });
    after(() => rmSync(root, { recursive: true, force: true }));

    const scanPaths = (base) => {
        rmSync(join(root, 'home', 'paths.log'), { force: true });
        execFileSync('node', [SCAN, '--repo', repo, '--base', base, '--out', join(root, 'out'), '--tools', 'jscpd'], {
            stdio: 'ignore',
            env: { ...process.env, SCQ_HOME: join(root, 'home') },
        });
        return readFileSync(join(root, 'home', 'paths.log'), 'utf8')
            .trim()
            .split('\n');
    };

    it('scans the changed file directory and never the repository root', () => {
        assert.deepEqual(scanPaths('HEAD~3..HEAD~2'), [join(repo, 'scripts')]);
    });

    it('scans a file in a folder that holds a package as that file alone', () => {
        assert.deepEqual(scanPaths('HEAD~2..HEAD~1'), [join(repo, 'tools', 'loose.mjs')]);
    });

    it('scans a file directly in the repository root as that file alone', () => {
        assert.deepEqual(scanPaths('HEAD~1'), [join(repo, 'rootTool.mjs')]);
    });
});
