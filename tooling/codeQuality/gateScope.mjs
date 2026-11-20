// What the GATE judge is asked to look at (ADR-0098; owner ruling 2026-11-20, "We should only run on files that
// change"): the files whose content changed since the last verdict, the diff of those files, nothing else.
//
// @pattern Policy — pure scope rules; gateRun.mjs (Adapter) does the git and file I/O around them.

const DOC_EXTENSIONS = /\.(md|mdx|txt|rst)$/i;

/** A document, not code: reviewed as prose, never as a code change. Pure. */
export const isDocFile = (path) => DOC_EXTENSIONS.test(path);

/**
 * `docs` when every file to judge is a document: a docs-only change still gets a GATE result, from one run over its
 * doc set and not a code review of the repository. `code` otherwise. Pure.
 *
 * @param {string[]} files
 * @returns {'docs' | 'code'}
 */
export const judgeMode = (files) => (files.every(isDocFile) ? 'docs' : 'code');

/**
 * The judged file a finding's `file` names, or undefined. The judge writes paths loosely (`./src/b.ts`, `src/b.ts:12`,
 * an absolute checkout path, a diff's `b/` prefix), so a path is read back to the listed file it ends with. Pure.
 *
 * @param {string | undefined} file
 * @param {string[]} judgedFiles
 */
export function matchJudgedFile(file, judgedFiles) {
    if (typeof file !== 'string') {
        return undefined;
    }
    const path = file.replace(/(:\d+){1,2}$/, '').replace(/^(\.\/)+/, '');
    if (judgedFiles.includes(path)) {
        return path;
    }
    return judgedFiles
        .filter((judged) => path.endsWith(`/${judged}`))
        .sort((a, b) => b.length - a.length)
        .at(0);
}

/**
 * The judge must not raise findings on files outside the scope it was given. The brief says so, and this enforces
 * it, because a prompt is a request and not a guarantee. Paths are normalised first (see matchJudgedFile). An
 * ADVISORY finding on a file that matches no judged file is dropped. A BLOCKING one is never dropped: it loses its
 * file and so blocks every judged file, because dropping it would let a mis-pathed finding turn a BLOCK into a PASS.
 * A finding that names no file is kept. Pure.
 *
 * @param {Array<{file?: string, severity?: string, title?: string, detail?: string}>} findings
 * @param {string[]} judgedFiles
 */
export function scopeFindings(findings, judgedFiles) {
    const kept = [];
    let dropped = 0;
    for (const f of findings) {
        if (f.file === undefined) {
            kept.push(f);
            continue;
        }
        const file = matchJudgedFile(f.file, judgedFiles);
        if (file !== undefined) {
            kept.push({ ...f, file });
        } else if (f.severity === 'blocking') {
            const { file: named, ...rest } = f;
            kept.push({ ...rest, title: `${f.title ?? ''} (named ${named}, which is not a judged file)`.trim() });
        } else {
            dropped += 1;
        }
    }
    return { kept, dropped };
}

const SHARED_RULES = [
    'Judge only these files and only their changed lines (the diff file below holds exactly those changes).',
    'You may read other files only to understand the changed code. You must not raise a finding on a file that is not',
    'listed, and a finding names the listed file it is about. Files that did not change keep their earlier verdict.',
];

/**
 * The brief the judge reads: the scope, once. Pure.
 *
 * @param {{mode: 'docs' | 'code', files: string[], deleted?: string[], diffPath: string}} input
 */
export function renderBrief({ mode, files, deleted = [], diffPath }) {
    return [
        '# GATE scope',
        '',
        `Mode: ${mode === 'docs' ? 'documentation only' : 'code'}.`,
        '',
        ...(mode === 'docs'
            ? [
                  'Every changed file is a document. Review the documentation only, as prose: wrong or stale claims, hand-kept',
                  'counts and lists, contradictions with the rest of the docs, and broken references. This is not a code review',
                  'of the repository.',
                  '',
              ]
            : []),
        'Files to judge (these only):',
        '',
        ...files.map((f) => `- ${f}`),
        '',
        ...(deleted.length === 0
            ? []
            : [
                  'Deleted files:',
                  '',
                  ...deleted.map((f) => `- ${f} (deleted)`),
                  '',
                  'A deleted file has no new content. Judge what the deletion removes: a test that guarded a behaviour, a',
                  'module other files still import, a guard that kept a rule enforced.',
                  '',
              ]),
        `The diff of exactly these files is in ${diffPath}. Read it once; do not run git diff for the rest of the pull request.`,
        '',
        ...SHARED_RULES,
        '',
    ].join('\n');
}
