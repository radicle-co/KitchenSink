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
 *   marker, and prints the Artifact tool's `url`, `root`, `files` and the `label` to pass unchanged. It prints nothing
 *   and exits 0 when a marker already names `--main`.
 *
 * Exit codes: 0 ok or clean, 1 drift (or `stage` refused), 2 bad input, git failure, unknown id, invalid marker, a
 * marker that is not on main, a list that names a marker that was not downloaded, or a `--main` behind the tip whose
 * canvas folder changed since.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { DesignArtifactError, isDesignArtifactError } from '../src/errors.js';
import {
    CANVASES_DIR,
    MAIN_REF,
    blobBytes,
    canvasDiffers,
    canvasTree,
    isAncestor,
    resolveMain,
    showText,
    snapshotCommit,
} from '../src/publish/gitCanvasHistory.js';
import { hashLive, readLiveList, readMarker } from '../src/publish/liveFiles.js';
import { MARKER_PATH, chooseBaseline, driftVerdict, planCanvas, publishInput } from '../src/publish/publishPlan.js';
import type { Baseline, CanvasPlan, DriftVerdict } from '../src/publish/publishPlan.js';
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
): Promise<{ plan: CanvasPlan; baseline: Baseline }> {
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
): Promise<{ plan: CanvasPlan; baseline: Baseline; verdict: DriftVerdict }> {
    const { plan, baseline } = await planOne(run, main, canvas, liveDir);
    const livePaths = await readLiveList(listFile);

    // No marker was read, yet the live canvas has one: the baseline would silently fall back to the snapshot.
    if (baseline.from === 'snapshot' && livePaths.includes(MARKER_PATH)) {
        throw new DesignArtifactError(
            'marker-not-downloaded',
            `The live list of ${canvas.id} holds ${MARKER_PATH}, but it is not in ${liveDir}/${canvas.folder}. Read it with the Artifact tool and run \`plan\` again.`,
        );
    }

    const liveOids = await hashLive(run, liveDir, canvas.folder, plan.download);
    const verdict = driftVerdict({ plan, liveOids, livePaths });

    return { plan, baseline, verdict };
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

    if (mainSha !== tip && (await canvasDiffers(run, mainSha, tip, canvas.folder))) {
        throw new DesignArtifactError(
            'stale-main',
            `--main ${mainSha} is behind ${MAIN_REF} (${tip}), and ${canvas.id} changed since. Publish ${tip}.`,
        );
    }

    const { plan, baseline, verdict } = await checkOne(run, mainSha, canvas, liveDir, resolve(need('list')));

    if (command === 'check') {
        process.stdout.write(`${JSON.stringify({ id: canvas.id, ...verdict })}\n`);

        return verdict.verdict === 'clean' ? 0 : 1;
    }

    // The marker already names main: nothing to publish, and no Artifact call is needed.
    if (plan.status === 'unchanged' && baseline.from === 'marker') {
        return 0;
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
    process.stdout.write(
        `${JSON.stringify({
            url: input.url,
            root: input.root,
            files: input.files,
            label: `canvas ${canvas.id}: ${baseline.sha}..${mainSha}`,
        })}\n`,
    );

    return 0;
}

try {
    process.exitCode = await main();
} catch (error) {
    process.stderr.write(`${isDesignArtifactError(error) ? `[${error.code}] ` : ''}${String(error)}\n`);
    process.exitCode = 2;
}
