/**
 * @module bin/canvasPublishPlan — the publish planner for repo-source canvases.
 *
 * @pattern Entry Point — the process boundary: it parses arguments, runs git and the file adapters, and turns the pure
 * decisions of `src/publish/publishPlan.ts` into JSON on stdout and an exit code. Procedure:
 * `docs/design/canvases/README.md`, "Repo-source canvases".
 *
 * Commands (run from inside the repository, after `git fetch origin main`):
 * - `plan --live <dir>`: per canvas, the changes since its baseline and what to download into `<dir>/<folder>/`.
 * - `check <id> --main <sha> --live <dir> --list <json>`: whether the downloaded files may be overwritten.
 * - `stage <id> --main <sha> --live <dir> --list <json> --out <dir>`: re-checks, then writes main's blobs and the
 *   marker, and prints the Artifact tool's `url`, `root` and `files`.
 *
 * Exit codes: 0 ok or clean, 1 drift (or `stage` refused), 2 bad input, git failure, unknown id, invalid marker or a
 * marker that is not on main.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { DesignArtifactError, isDesignArtifactError } from '../src/errors.js';
import {
    CANVASES_DIR,
    MAIN_REF,
    blobBytes,
    canvasTree,
    isAncestor,
    resolveMain,
    showText,
    snapshotCommit,
} from '../src/publish/gitCanvasHistory.js';
import { hashLive, readLiveList, readMarker } from '../src/publish/liveFiles.js';
import { chooseBaseline, driftVerdict, planCanvas, publishInput } from '../src/publish/publishPlan.js';
import type { CanvasPlan, DriftVerdict } from '../src/publish/publishPlan.js';
import { parseRepoCanvases } from '../src/publish/repoCanvases.js';
import type { RepoCanvas } from '../src/publish/repoCanvases.js';
import { execGit } from '../src/sources/gitHead.js';
import type { RunGit } from '../src/sources/gitHead.js';

const SHA = /^[0-9a-f]{40}$/u;

function usage(message: string): never {
    throw new DesignArtifactError(
        'missing-source',
        `${message}\nUsage: plan --live <dir> | check <id> --main <sha> --live <dir> --list <json> | stage <id> --main <sha> --live <dir> --list <json> --out <dir>`,
    );
}

async function planOne(
    run: RunGit,
    main: string,
    canvas: RepoCanvas,
    liveDir: string,
): Promise<{ plan: CanvasPlan; baseline: ReturnType<typeof chooseBaseline> }> {
    const marker = await readMarker(liveDir, canvas.folder);

    if (marker !== null && !(await isAncestor(run, marker, main))) {
        throw new DesignArtifactError(
            'marker-not-on-main',
            `The live marker ${marker} of ${canvas.id} is not a commit on ${MAIN_REF}.`,
        );
    }

    const baseline = chooseBaseline(marker, marker ?? (await snapshotCommit(run, main, canvas.folder)));
    const plan = planCanvas({
        baseline: await canvasTree(run, baseline.sha, canvas.folder),
        main: await canvasTree(run, main, canvas.folder),
        from: baseline.from,
    });

    return { plan, baseline };
}

async function checkOne(
    run: RunGit,
    main: string,
    canvas: RepoCanvas,
    liveDir: string,
    listFile: string,
): Promise<{ plan: CanvasPlan; verdict: DriftVerdict }> {
    const { plan } = await planOne(run, main, canvas, liveDir);
    const liveOids = await hashLive(run, liveDir, canvas.folder, plan.download);
    const verdict = driftVerdict({ plan, liveOids, livePaths: await readLiveList(listFile) });

    return { plan, verdict };
}

async function main(): Promise<number> {
    const { positionals, values } = parseArgs({
        allowPositionals: true,
        options: {
            live: { type: 'string' },
            main: { type: 'string' },
            list: { type: 'string' },
            out: { type: 'string' },
        },
    });
    const [command, id] = positionals;
    const need = (name: 'live' | 'main' | 'list' | 'out'): string => values[name] ?? usage(`Missing --${name}.`);

    if (command !== 'plan' && command !== 'check' && command !== 'stage') {
        return usage('Unknown or missing command.');
    }

    const top = (await execGit(process.cwd())(['rev-parse', '--show-toplevel'])).trim();
    const run = execGit(top);
    const tip = await resolveMain(run);
    const liveDir = resolve(need('live'));
    const canvases = parseRepoCanvases(await showText(run, tip, `${CANVASES_DIR}/registry.json`));

    if (command === 'plan') {
        const entries = [];

        for (const canvas of canvases) {
            const { plan, baseline } = await planOne(run, tip, canvas, liveDir);
            entries.push({ ...canvas, baseline, ...plan });
        }

        process.stdout.write(`${JSON.stringify({ main: { sha: tip }, canvases: entries })}\n`);

        return 0;
    }

    const mainSha = need('main');

    if (!SHA.test(mainSha) || !(await isAncestor(run, mainSha, tip))) {
        throw new DesignArtifactError('marker-not-on-main', `--main ${mainSha} is not a commit on ${MAIN_REF}.`);
    }

    const canvas = canvases.find((c) => c.id === id);

    if (canvas === undefined) {
        throw new DesignArtifactError('unknown-canvas', `No repo-canvas entry has the id ${String(id)}.`);
    }

    const { plan, verdict } = await checkOne(run, mainSha, canvas, liveDir, resolve(need('list')));

    if (command === 'check') {
        process.stdout.write(`${JSON.stringify({ id: canvas.id, ...verdict })}\n`);

        return verdict.verdict === 'clean' ? 0 : 1;
    }

    if (verdict.verdict !== 'clean') {
        process.stderr.write(
            `Refusing to stage ${canvas.id}: the live canvas has drifted.\n${JSON.stringify(verdict)}\n`,
        );

        return 1;
    }

    const input = publishInput({ url: canvas.url, folder: canvas.folder, outDir: resolve(need('out')), plan, mainSha });

    for (const path of plan.changed) {
        const target = join(input.root, path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, await blobBytes(top, mainSha, canvas.folder, path));
    }

    await mkdir(dirname(input.marker.path), { recursive: true });
    await writeFile(input.marker.path, input.marker.content);
    process.stdout.write(`${JSON.stringify({ url: input.url, root: input.root, files: input.files })}\n`);

    return 0;
}

try {
    process.exitCode = await main();
} catch (error) {
    process.stderr.write(`${isDesignArtifactError(error) ? `[${error.code}] ` : ''}${String(error)}\n`);
    process.exitCode = 2;
}
