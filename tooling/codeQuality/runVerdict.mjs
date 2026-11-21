#!/usr/bin/env node
// Adapter between the CI job and scanVerdict.mjs: reads scan.mjs's output and the baseline files, writes the verdict,
// prints one annotation per blocking finding and the summary, and exits 1 on FAIL.
//
//   node runVerdict.mjs --out <scan out dir> --base <git ref> [--labels a,b] [--repo <dir>]
//
// @pattern Adapter — the only file that touches the filesystem and git on behalf of the pure Policy in scanVerdict.mjs.
// @sideEffect Reads the scan output and git, writes verdict.json beside it, prints to stdout, sets the exit code.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { formatAnnotation, judgeScan, renderSummary } from './scanVerdict.mjs';

/** Every committed baseline: the files a PR may only shrink. Add a new ratchet's baseline here when it is created. */
const BASELINE_FILES = [
    'tooling/codeQuality/boundariesBaseline.json',
    'packages/tools/repoGuards/__tests__/colourRolesBaseline.json',
    'packages/tools/repoGuards/__tests__/nativeStylingBaseline.json',
    'packages/tools/repoGuards/__tests__/nativeTextScaleCapBaseline.json',
    'packages/tools/repoGuards/__tests__/themeColourReadsBaseline.json',
];

const args = process.argv.slice(2);
const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const out = arg('--out');
const base = arg('--base');
if (out === undefined || base === undefined) {
    console.error('usage: runVerdict.mjs --out <scan out dir> --base <git ref> [--labels a,b] [--repo <dir>]');
    process.exit(2);
}
const repo = resolve(arg('--repo') ?? '.');
const labels = (arg('--labels') ?? '').split(',').filter(Boolean);

const readJson = (text) => (text === null ? null : JSON.parse(text));
const atBase = (file) => {
    try {
        return execFileSync('git', ['show', `${base}:${file}`], {
            cwd: repo,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        });
    } catch {
        return null; // the file does not exist at the base
    }
};
const atHead = (file) => (existsSync(join(repo, file)) ? readFileSync(join(repo, file), 'utf8') : null);

const status = JSON.parse(readFileSync(join(out, 'status.json'), 'utf8'));
const findings = readFileSync(join(out, 'findings.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
const baselines = BASELINE_FILES.map((file) => ({ file, base: readJson(atBase(file)), head: readJson(atHead(file)) }));

const verdict = judgeScan({ status, findings, baselines, labels });
writeFileSync(
    join(out, 'verdict.json'),
    JSON.stringify(
        { pass: verdict.pass, violations: verdict.violations.map(({ rule, message }) => ({ rule, message })) },
        null,
        2,
    ),
);
writeFileSync(join(out, 'verdictSummary.md'), renderSummary(verdict));

for (const violation of verdict.violations) {
    console.log(
        violation.finding === undefined
            ? `::error::[${violation.rule}] ${violation.message.replaceAll('\n', ' ')}`
            : formatAnnotation(violation.finding),
    );
}
console.log(renderSummary(verdict));
process.exit(verdict.pass ? 0 : 1);
