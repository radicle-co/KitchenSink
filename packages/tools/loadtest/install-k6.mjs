/**
 * Download the k6 binary into this package's `node_modules/.bin` so `npm run journey` / `npm run loadtest`
 * (which put that dir on PATH) can invoke `k6`. k6 is a Go binary with no real npm package, so we fetch
 * the pinned release for the current OS/arch. Idempotent — a no-op if k6 is already present.
 *
 * Env: K6_VERSION (default v0.54.0).
 * @sideEffect Downloads + extracts the k6 release into node_modules/.bin.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { arch, platform, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const K6_VERSION = process.env['K6_VERSION'] || 'v0.54.0';
const HERE = dirname(fileURLToPath(import.meta.url));
const BIN_DIR = join(HERE, 'node_modules', '.bin');
const K6_PATH = join(BIN_DIR, 'k6');

if (existsSync(K6_PATH)) {
    console.log(`k6 already installed at ${K6_PATH}`);
    execFileSync(K6_PATH, ['version'], { stdio: 'inherit' });
    process.exit(0);
}

const osKey = { linux: 'linux', darwin: 'macos' }[platform()];
const archKey = { x64: 'amd64', arm64: 'arm64' }[arch()];

if (!osKey || !archKey) {
    throw new Error(
        `Unsupported platform ${platform()}/${arch()} for auto k6 install — install k6 manually (https://grafana.com/docs/k6/latest/set-up/install-k6/).`,
    );
}

const ext = osKey === 'linux' ? 'tar.gz' : 'zip';
const name = `k6-${K6_VERSION}-${osKey}-${archKey}`;
const url = `https://github.com/grafana/k6/releases/download/${K6_VERSION}/${name}.${ext}`;

const work = mkdtempSync(join(tmpdir(), 'k6-'));
mkdirSync(BIN_DIR, { recursive: true });

console.log(`Downloading ${url} …`);
const archivePath = join(work, `k6.${ext}`);
execFileSync('curl', ['-sSL', '-o', archivePath, url], { stdio: 'inherit' });

if (ext === 'tar.gz') {
    execFileSync('tar', ['xzf', archivePath, '-C', work], { stdio: 'inherit' });
} else {
    execFileSync('unzip', ['-q', archivePath, '-d', work], { stdio: 'inherit' });
}

execFileSync('cp', [join(work, name, 'k6'), K6_PATH]);
chmodSync(K6_PATH, 0o755);

console.log(`k6 ${K6_VERSION} installed to ${K6_PATH}`);
execFileSync(K6_PATH, ['version'], { stdio: 'inherit' });
