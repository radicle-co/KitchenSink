/**
 * @module publish/publishPlan — what a publish of a repo-source canvas has to do, and whether the live canvas may
 * be overwritten. Pure: the git and file adapters hand it blob ids (`git hash-object` oids), it returns decisions.
 *
 * @pattern Functional Core / Policy — no I/O. A path is compared by git blob oid, so binary files are never decoded.
 * Only paths under `project/` take part: the type owns `index.html`, `SKILL.md` and `artifact-type/`, and the marker
 * `project/published.json` is written by the publish, never read from the repository.
 */
import { posix } from 'node:path';

import { z } from 'zod';

import { DesignArtifactError } from '../errors.js';

/** The marker file the publish writes into the live canvas. */
export const MARKER_PATH = 'project/published.json';

const PROJECT_PREFIX = 'project/';

/** Blob oid by path. */
export type Oids = ReadonlyMap<string, string>;

/** Where the baseline commit came from. */
export type BaselineSource = 'marker' | 'snapshot';

/** The commit the live canvas is assumed to equal. */
export interface Baseline {
    readonly sha: string;
    readonly from: BaselineSource;
}

/** One path's blob oid at the baseline and at main; `null` means absent. */
export interface ExpectedOids {
    readonly baseline: string | null;
    readonly main: string | null;
}

/** What a publish of one canvas does. */
export interface CanvasPlan {
    readonly status: 'unchanged' | 'publish';
    readonly changed: readonly string[];
    readonly deleted: readonly string[];
    readonly download: readonly string[];
    readonly expected: Readonly<Record<string, ExpectedOids>>;
}

/** How one downloaded path compares with the baseline and main. */
export interface FileState {
    readonly path: string;
    readonly state: 'atBaseline' | 'atMain' | 'drift';
}

/** The drift check's answer. */
export interface DriftVerdict {
    readonly verdict: 'clean' | 'drift';
    readonly files: readonly FileState[];
    readonly extraLive: readonly string[];
    readonly missingLive: readonly string[];
}

/** The `files` map of the Artifact tool's publish, plus the marker to write first. */
export interface PublishInput {
    readonly url: string;
    readonly root: string;
    readonly files: Readonly<Record<string, string | null>>;
    readonly marker: { readonly path: string; readonly content: string };
}

const MarkerSchema = z.strictObject({ sha: z.string().regex(/^[0-9a-f]{40}$/u) });

/**
 * Reads the text of a live `project/published.json`.
 *
 * @param text - The file's content.
 * @returns The commit sha it names.
 * @throws DesignArtifactError `invalid-marker` for anything but `{"sha": "<40 lowercase hex>"}`.
 */
export function parseMarker(text: string): string {
    let json: unknown;

    try {
        json = JSON.parse(text);
    } catch {
        throw new DesignArtifactError('invalid-marker', 'The live published.json is not JSON.');
    }

    const parsed = MarkerSchema.safeParse(json);

    if (!parsed.success) {
        throw new DesignArtifactError(
            'invalid-marker',
            `The live published.json is malformed: ${parsed.error.message}`,
        );
    }

    return parsed.data.sha;
}

/**
 * Picks the commit the live canvas should equal.
 *
 * @param marker - The sha in the live marker, or `null` when the canvas was never published from the repo.
 * @param snapshotSha - The commit that added the canvas's `snapshot.json`.
 * @returns The baseline. There is no other fallback.
 */
export function chooseBaseline(marker: string | null, snapshotSha: string): Baseline {
    return marker === null ? { sha: snapshotSha, from: 'snapshot' } : { sha: marker, from: 'marker' };
}

function publishable(path: string): boolean {
    return path.startsWith(PROJECT_PREFIX) && path !== MARKER_PATH;
}

function onlyPublishable(tree: Oids): Map<string, string> {
    return new Map([...tree].filter(([path]) => publishable(path)));
}

/**
 * Compares the baseline tree with main's.
 *
 * @param input - Both trees (`project/…` paths to blob oids) and where the baseline came from.
 * @returns Changed, deleted and to-download paths, and every path's expected oids. A rename is a delete plus an add.
 * From a marker only the touched paths are downloaded; from the snapshot every baseline path is, because the live
 * canvas has not been compared with the repo before.
 */
export function planCanvas(input: { baseline: Oids; main: Oids; from: BaselineSource }): CanvasPlan {
    const baseline = onlyPublishable(input.baseline);
    const main = onlyPublishable(input.main);
    const paths = [...new Set([...baseline.keys(), ...main.keys()])].sort();
    const changed = paths.filter((p) => main.has(p) && main.get(p) !== baseline.get(p));
    const deleted = paths.filter((p) => baseline.has(p) && !main.has(p));
    const status = changed.length + deleted.length === 0 ? 'unchanged' : 'publish';
    const touched = new Set([...changed, ...deleted]);
    const download =
        status === 'unchanged'
            ? []
            : paths.filter((p) => touched.has(p) || (input.from === 'snapshot' && baseline.has(p)));
    const expected = Object.fromEntries(
        paths.map((p) => [p, { baseline: baseline.get(p) ?? null, main: main.get(p) ?? null }] as const),
    );

    return { status, changed, deleted, download, expected };
}

function stateOf(expected: ExpectedOids, live: string | undefined, isLive: boolean): FileState['state'] {
    if (!isLive) {
        // Absent live is fine when the repo never had the path or removes it.
        if (expected.baseline === null) {
            return 'atBaseline';
        }

        return expected.main === null ? 'atMain' : 'drift';
    }

    if (live === undefined) {
        return 'drift';
    }

    if (live === expected.baseline) {
        return 'atBaseline';
    }

    return live === expected.main ? 'atMain' : 'drift';
}

/**
 * Decides whether the live canvas may be overwritten. A live file passes when it equals the baseline or main (main
 * covers a merged drift import and a retried publish). A file that should be live but was not downloaded is drift.
 *
 * @param input - The plan, the oids of the downloaded files, and the live path list.
 * @returns The verdict with a state per downloaded path, and live paths neither tree knows or that vanished.
 */
export function driftVerdict(input: { plan: CanvasPlan; liveOids: Oids; livePaths: readonly string[] }): DriftVerdict {
    const livePaths = new Set(input.livePaths.filter(publishable));
    const files = input.plan.download.map((path) => ({
        path,
        state: stateOf(
            input.plan.expected[path] ?? { baseline: null, main: null },
            input.liveOids.get(path),
            livePaths.has(path),
        ),
    }));
    const known = Object.keys(input.plan.expected);
    const extraLive = [...livePaths].filter((p) => input.plan.expected[p] === undefined).sort();
    const missingLive = known.filter((p) => {
        const e = input.plan.expected[p];

        return e !== undefined && e.baseline !== null && e.main !== null && !livePaths.has(p);
    });
    const clean = files.every((f) => f.state !== 'drift') && extraLive.length === 0 && missingLive.length === 0;

    return { verdict: clean ? 'clean' : 'drift', files, extraLive, missingLive };
}

/**
 * Builds the dict-form publish input: changed paths point at the staged blob, deleted paths are `null`, and the
 * marker sits OUTSIDE the canvas folder (a commit cannot contain its own sha).
 *
 * @param input - The canvas, the staging directory, its plan and the main sha being published.
 * @returns The Artifact tool's `url`, `root` and `files`, and the marker to write at `marker.path`.
 */
export function publishInput(input: {
    url: string;
    folder: string;
    outDir: string;
    plan: CanvasPlan;
    mainSha: string;
}): PublishInput {
    const root = posix.join(input.outDir, input.folder);
    const markerPath = posix.join(input.outDir, `${input.folder}.published.json`);
    // The pollution guard requires a null prototype for a map keyed by data, though planCanvas only emits `project/…` keys.
    const files = Object.create(null) as Record<string, string | null>;

    for (const path of input.plan.changed) {
        files[path] = posix.join(root, path);
    }

    for (const path of input.plan.deleted) {
        files[path] = null;
    }

    files[MARKER_PATH] = markerPath;

    return {
        url: input.url,
        root,
        files,
        marker: { path: markerPath, content: `${JSON.stringify({ sha: input.mainSha })}\n` },
    };
}
