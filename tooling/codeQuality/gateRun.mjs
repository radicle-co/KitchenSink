#!/usr/bin/env node
// Adapter between gate.yml and the pure GATE policies (gateScope.mjs, gateLedger.mjs). Two steps:
//
//   node gateRun.mjs plan   --repo <dir> --base <sha> --head <sha> --ledger <dir> --out <dir> [--rejudge-blocked]
//       Finds the files this PR changes, hashes their content at <head>, restores the earlier verdicts from <ledger>
//       (one sub-directory per earlier run, oldest first, each holding gateVerdict.json), and writes what to judge:
//       plan.json, judgeBrief.md and changes.diff in <out>. Prints `mode=none|reuse|judge`. A deleted code or test file
//       is judged too. The brief also lists the merge-base copy of every plan or tasks file the whole PR changes, and the
//       judged files the checkout holds at the base version. --rejudge-blocked (a `gate-rerun`) judges a file whose latest verdict is BLOCK again.
//   node gateRun.mjs record --out <dir> --sha <head> [--judge <file holding the judge's structured output>]
//       Merges the judge's verdict for the judged files with the carried ones, writes gateVerdict.json (the `gate-<sha>`
//       artifact) and gateReview.md, and prints `state=` and `description=` for the commit status.
//
// @pattern Adapter — the only file here that touches git and the filesystem for the GATE; the rules are in the Policies.
// @sideEffect Reads git and the ledger directory, writes into <out>, prints to stdout, sets the exit code.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import {
    buildRecord,
    describeOutcome,
    foldLedger,
    mergeVerdicts,
    parseRecord,
    perFileVerdicts,
    planRun,
    renderReview,
} from './gateLedger.mjs';
import { isDocFile, judgeMode, renderBrief, restoredFilesOf, scopeFindings, wrapUpSourcesOf } from './gateScope.mjs';

const [command, ...rest] = process.argv.slice(2);
const arg = (name) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined);
const need = (name) => {
    const value = arg(name);
    if (value === undefined) {
        console.error(`gateRun.mjs ${command}: missing ${name}`);
        process.exit(2);
    }
    return value;
};

/** The verdict key of a file the PR deletes: it has no content to hash. */
const DELETED = 'deleted';

const git = (repo, args) =>
    execFileSync('git', args, {
        cwd: repo,
        encoding: 'utf8',
        maxBuffer: 512 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
    });

/** The blob id of every path at <head>: a hash of the file's content, untouched by filters or line-ending rules. */
function blobIds(repo, head, paths) {
    const ids = new Map();
    if (paths.length === 0) {
        return ids;
    }
    for (const row of git(repo, ['ls-tree', '-z', head, '--', ...paths])
        .split('\0')
        .filter(Boolean)) {
        const [meta, path] = row.split('\t');
        ids.set(path, meta.split(' ')[2]);
    }
    return ids;
}

/**
 * The base copy of every plan or tasks file the whole PR changes or deletes, written under <out>/base/<path>. A path is
 * absent from the merge base only when `ls-tree` succeeds with no output; a failing git command throws, so the plan
 * step fails and GATE posts a failure instead of calling a file new because git broke.
 */
function baseCopies(repo, mergeBase, out, sources, removed) {
    git(repo, ['rev-parse', '--verify', `${mergeBase}^{commit}`]);
    const atBase = blobIds(repo, mergeBase, sources);
    return sources.map((path) => {
        const gone = removed.includes(path);
        if (!atBase.has(path)) {
            return { path, basePath: null };
        }
        const basePath = join(out, 'base', path);
        mkdirSync(dirname(basePath), { recursive: true });
        writeFileSync(basePath, git(repo, ['show', `${mergeBase}:${path}`]));
        return { path, basePath, deleted: gone };
    });
}

function loadRecords(ledgerDir) {
    if (!existsSync(ledgerDir)) {
        return [];
    }
    return readdirSync(ledgerDir)
        .sort()
        .map((dir) => join(ledgerDir, dir, 'gateVerdict.json'))
        .filter(existsSync)
        .map((file) => parseRecord(readFileSync(file, 'utf8')))
        .filter((record) => record !== null);
}

function plan() {
    const repo = resolve(arg('--repo') ?? '.');
    const base = need('--base');
    const head = need('--head');
    const out = need('--out');
    const mergeBase = git(repo, ['merge-base', base, head]).trim();
    // --no-renames: a rename is a deletion of the old path plus an addition of the new one, so neither goes unjudged.
    // `d` keeps every change but a deletion, so a type change (a file turned into a symlink) is judged too.
    const names = git(repo, ['diff', '--name-only', '--no-renames', '--diff-filter=d', '-z', mergeBase, head])
        .split('\0')
        .filter(Boolean);
    const ids = blobIds(repo, head, names);
    const changed = new Map(names.filter((n) => ids.has(n)).map((n) => [n, ids.get(n)]));
    // A deleted code or test file is judged too (what its deletion removes); a deleted document is not. A deleted
    // file has no content, so its verdict is keyed on a marker and a rerun at the same head still reuses it.
    const removed = git(repo, ['diff', '--name-only', '--no-renames', '--diff-filter=D', '-z', mergeBase, head])
        .split('\0')
        .filter(Boolean);
    const deleted = removed.filter((n) => !isDocFile(n));
    for (const path of deleted) {
        changed.set(path, DELETED);
    }
    const run = planRun({
        changed,
        ledger: foldLedger(loadRecords(need('--ledger'))),
        rejudgeBlocked: rest.includes('--rejudge-blocked'),
    });
    const mode = changed.size === 0 ? 'none' : run.reuse ? 'reuse' : 'judge';
    const diffPath = join(out, 'changes.diff');
    if (mode === 'judge') {
        writeFileSync(
            diffPath,
            git(repo, ['diff', '--no-ext-diff', '--no-textconv', mergeBase, head, '--', ...run.toJudge]),
        );
        writeFileSync(
            join(out, 'judgeBrief.md'),
            renderBrief({
                mode: judgeMode(run.toJudge),
                files: run.toJudge,
                deleted: run.toJudge.filter((path) => changed.get(path) === DELETED),
                diffPath,
                baseCopies: baseCopies(repo, mergeBase, out, wrapUpSourcesOf([...names, ...removed]), removed),
                restored: restoredFilesOf(run.toJudge),
            }),
        );
    }
    writeFileSync(
        join(out, 'plan.json'),
        JSON.stringify(
            {
                mode,
                toJudge: run.toJudge,
                deleted: run.toJudge.filter((path) => changed.get(path) === DELETED),
                carried: run.carried,
                reusedFrom: run.reusedFrom,
                changed: Object.fromEntries(changed),
            },
            null,
            2,
        ),
    );
    console.log(`mode=${mode}`);
    console.log(`judge_files=${run.toJudge.length}`);
}

function record() {
    const out = need('--out');
    const sha = need('--sha');
    const planned = JSON.parse(readFileSync(join(out, 'plan.json'), 'utf8'));
    let judged = {};
    if (planned.mode === 'judge') {
        const output = JSON.parse(readFileSync(need('--judge'), 'utf8'));
        const { kept } = scopeFindings(output.findings, planned.toJudge);
        judged = perFileVerdicts({
            judged: new Map(planned.toJudge.map((path) => [path, planned.changed[path]])),
            verdict: output.verdict,
            findings: kept,
        });
    }
    const result = buildRecord({ sha, carried: planned.carried, judged });
    const merged = mergeVerdicts(result.files);
    const outcome = describeOutcome(merged, {
        reusedFrom: planned.mode === 'judge' ? undefined : planned.reusedFrom,
        judgedCount: planned.toJudge.length,
    });
    writeFileSync(join(out, 'gateVerdict.json'), JSON.stringify(result, null, 2));
    // A review comment only when the judge ran: a reused verdict adds nothing new to say.
    const review = planned.mode === 'judge' && merged.verdict === 'BLOCK' ? renderReview(result.files) : '';
    writeFileSync(join(out, 'gateReview.md'), review);
    console.log(`state=${outcome.state}`);
    console.log(`description=${outcome.description}`);
    console.log(`review=${review === '' ? 'false' : 'true'}`);
}

if (command === 'plan') {
    plan();
} else if (command === 'record') {
    record();
} else {
    console.error('usage: gateRun.mjs plan|record ...');
    process.exit(2);
}
