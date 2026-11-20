// Per-file GATE verdicts: what was judged, what can be reused, and how the verdicts merge (ADR-0098; owner ruling
// 2026-11-20, "We should only run on files that change").
//
// @pattern Policy — pure rules for reuse and merge. gateRun.mjs (Adapter) reads git and the earlier artifacts.
// @pattern Memento — a record is the state of one GATE run (`gate-<sha>`): per changed file, its content hash, its
//          verdict and its findings. The next run restores earlier records and judges only what they do not cover.
//
// A verdict is keyed by (path, content hash). The same file with the same content has the same verdict wherever it
// appears, so an unchanged file keeps its verdict, a BLOCK on it persists until the file changes, and a file that
// returns to content judged before is not judged again.

const key = (path, hash) => `${path}\u0000${hash}`;
const MAX_DESCRIPTION = 140;

/**
 * Per-file verdicts for the files one run judged. A blocking finding blocks the file it names. One that names no file,
 * or a BLOCK verdict with no blocking finding at all, blocks every judged file: the judge saw only those files, so it
 * cannot be told which of them it meant. Pure.
 *
 * @param {{judged: Map<string, string>, verdict: 'PASS' | 'BLOCK', findings: Array<Record<string, any>>}} input
 * @returns {Record<string, {hash: string, verdict: 'PASS' | 'BLOCK', findings: object[]}>}
 */
export function perFileVerdicts({ judged, verdict, findings }) {
    const blocking = findings.filter((f) => f.severity === 'blocking');
    const blockAll =
        blocking.some((f) => f.file === undefined || !judged.has(f.file)) ||
        (verdict === 'BLOCK' && blocking.length === 0);
    const result = Object.create(null);
    for (const [path, hash] of judged) {
        const mine = findings.filter((f) => f.file === path || (f.file === undefined && f.severity === 'blocking'));
        const blocked = blockAll || blocking.some((f) => f.file === path);
        result[path] = { hash, verdict: blocked ? 'BLOCK' : 'PASS', findings: mine };
    }
    return result;
}

/**
 * Every earlier verdict by (path, hash), the newest record winning. Records are oldest first. Pure.
 *
 * @param {Array<{sha: string, files: Record<string, {hash: string, verdict: string, findings: object[]}>}>} records
 */
export function foldLedger(records) {
    const ledger = new Map();
    for (const [seq, { sha, files }] of records.entries()) {
        for (const [path, entry] of Object.entries(files)) {
            ledger.set(key(path, entry.hash), { ...entry, sha, seq });
        }
    }
    return ledger;
}

/**
 * Which of the PR's changed files need the judge, and which keep an earlier verdict. A file whose (path, hash) is in
 * the ledger is carried; anything else is judged. A file that left the PR is not carried. When nothing needs judging
 * the earlier verdict is reused whole, and `reusedFrom` names the newest record it came from. On a `gate-rerun`
 * (`rejudgeBlocked`) a carried BLOCK is judged again, so a wrong block clears without editing the file. Pure.
 *
 * @param {{changed: Map<string, string>, ledger: Map<string, any>, rejudgeBlocked?: boolean}} input
 */
export function planRun({ changed, ledger, rejudgeBlocked = false }) {
    const carried = Object.create(null);
    const toJudge = [];
    let newest;
    for (const [path, hash] of changed) {
        const found = ledger.get(key(path, hash));
        if (found === undefined || (rejudgeBlocked && found.verdict === 'BLOCK')) {
            toJudge.push(path);
        } else {
            carried[path] = { hash, verdict: found.verdict, findings: found.findings, sha: found.sha };
            newest = newest === undefined || found.seq > newest.seq ? found : newest;
        }
    }
    return { reuse: toJudge.length === 0 && changed.size > 0, toJudge, carried, reusedFrom: newest?.sha };
}

/** BLOCK if any file's latest verdict is BLOCK. Pure. */
export function mergeVerdicts(files) {
    const blocked = Object.entries(files)
        .filter(([, entry]) => entry.verdict === 'BLOCK')
        .map(([path]) => path);
    return { verdict: blocked.length > 0 ? 'BLOCK' : 'PASS', blocked };
}

/** The record one run stores: the carried files and the newly judged ones, under the head sha. Pure. */
export function buildRecord({ sha, carried, judged }) {
    const strip = ({ hash, verdict, findings }) => ({ hash, verdict, findings });
    const files = Object.create(null);
    for (const [path, entry] of Object.entries({ ...carried, ...judged })) {
        files[path] = strip(entry);
    }
    return { sha, files };
}

/**
 * The commit status for a merged verdict. Pure.
 *
 * @returns {{state: 'success' | 'failure', description: string}}
 */
export function describeOutcome({ verdict, blocked }, { reusedFrom, judgedCount }) {
    const reused = reusedFrom === undefined ? '' : `, reused from ${reusedFrom.slice(0, 7)}`;
    const text =
        verdict === 'BLOCK'
            ? `GATE blocked: ${blocked.length} file(s) blocked (${judgedCount} judged now${reused})`
            : judgedCount === 0
              ? `GATE passed (no model call${reused})`
              : `GATE passed (${judgedCount} file(s) judged now${reused})`;
    return { state: verdict === 'BLOCK' ? 'failure' : 'success', description: text.slice(0, MAX_DESCRIPTION) };
}

/**
 * An earlier record read back from its artifact, or null when it is malformed. A record that does not parse is not
 * trusted, so the files it covered are judged again. Pure.
 *
 * @param {string} text
 */
export function parseRecord(text) {
    let json;
    try {
        json = JSON.parse(text);
    } catch {
        return null;
    }
    if (typeof json?.sha !== 'string' || json.files === null || typeof json.files !== 'object') {
        return null;
    }
    const valid = Object.values(json.files).every(
        (e) =>
            typeof e?.hash === 'string' && (e.verdict === 'PASS' || e.verdict === 'BLOCK') && Array.isArray(e.findings),
    );
    return valid ? json : null;
}

const where = (f) => (f.line === undefined ? f.file : `${f.file}:${f.line}`);

/** The review comment: each blocked file with its blocking findings. Pure. */
export function renderReview(files) {
    const lines = Object.entries(files)
        .filter(([, entry]) => entry.verdict === 'BLOCK')
        .flatMap(([path, entry]) => {
            const blocking = entry.findings.filter((f) => f.severity === 'blocking');
            return [
                `- **${path}**`,
                ...(blocking.length === 0
                    ? ['  blocked with no finding that names a line']
                    : blocking.map(
                          (f) => `  - ${where({ ...f, file: f.file ?? path })} ${f.title}: ${f.detail ?? ''}`,
                      )),
            ];
        });
    return ['GATE blocked these files. A block stays until the file changes.', '', ...lines, ''].join('\n');
}
