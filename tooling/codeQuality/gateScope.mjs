// What the GATE judge is asked to look at (ADR-0097; owner ruling 2026-11-20, "We should only run on files that
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
 * The judge must not raise findings on files outside the scope it was given. The brief says so, and this enforces
 * it, because a prompt is a request and not a guarantee. A finding that names no file is kept. Pure.
 *
 * @param {Array<{file?: string}>} findings
 * @param {string[]} judgedFiles
 */
export function scopeFindings(findings, judgedFiles) {
    const judged = new Set(judgedFiles);
    const kept = findings.filter((f) => f.file === undefined || judged.has(f.file));
    return { kept, dropped: findings.length - kept.length };
}

const SHARED_RULES = [
    'Judge only these files and only their changed lines (the diff file below holds exactly those changes).',
    'You may read other files only to understand the changed code. You must not raise a finding on a file that is not',
    'listed, and a finding names the listed file it is about. Files that did not change keep their earlier verdict.',
];

/**
 * The brief the judge reads: the scope, once. Pure.
 *
 * @param {{mode: 'docs' | 'code', files: string[], diffPath: string}} input
 */
export function renderBrief({ mode, files, diffPath }) {
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
        `The diff of exactly these files is in ${diffPath}. Read it once; do not run git diff for the rest of the pull request.`,
        '',
        ...SHARED_RULES,
        '',
    ].join('\n');
}
