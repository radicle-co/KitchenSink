// @vitest-environment node
/**
 * A cross-reference between two of our own documents must resolve, or the link is a dead end that nothing
 * reports.
 *
 * ## Why this gate exists
 *
 * `docLinkResolution.test.ts` guards TSDoc `@link` targets in SOURCE. Nothing guarded the markdown links
 * between documents, and those carry more weight here than usual: this repo deliberately routes an agent
 * from `CLAUDE.md` to an ADR to a plan and back, and a decision that cannot be reached is a decision that
 * gets re-litigated. `docs/architecture/decisions/README.md` states the rule outright — an ADR needs both an
 * index entry and an inbound pointer, "without those two layers the ADR is invisible at the moment it
 * matters."
 *
 * The defect this was written for is one I introduced the same morning: ADR-0024's "Relates to" line pointed
 * at `0006-per-pr-feature-service-deploys.md`, a filename guessed from the ADR's title rather than read off
 * disk. It rendered as a dead link in the one edit whose entire purpose was making that ADR authoritative,
 * and every check in the repo passed. Measured at the time this landed: 2,071 relative links across 800
 * files under `docs/` and `specs/`, exactly one of them broken.
 *
 * ## Scope, and why it stops where it does
 *
 * `docs/` and `specs/` only — the documentation we author. `.claude/`, `.github/agents/` and `.specify/`
 * hold vendored Spec Kit and plugin content carrying ~700 broken links of their own, which are pre-existing,
 * not ours to fix, and would drown the signal. Widening scope is a separate decision with a cleanup attached.
 *
 * Only the FILE half of a target is resolved. Anchor validity (`#some-heading`) needs heading slugification
 * that differs between GitHub, VS Code and every other renderer, so a gate on it would fire on correct links;
 * the file half is unambiguous and is where the rot actually happens.
 *
 * ⚠️ Fenced code blocks and inline code spans are stripped before scanning. Documents here routinely show
 * link syntax as an EXAMPLE — a template, a shape to copy — and a gate that reports its own illustrations is
 * a gate that gets deleted rather than fixed. Same reasoning as `docLinks.ts` parsing rather than grepping.
 *
 * DESIGN PATTERN: Specification module over a pure predicate — {@link brokenLinksIn} is a pure verdict over
 * one document's text, fired at deliberately-violating fakes below as well as at the working tree.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { presentFiles, repoRoot } from './serviceSources.js';

/** The trees we author. Vendored tool content is deliberately out of scope — see the docblock. */
const SUBJECT_PATHSPECS = ['docs', 'specs'];

/** Targets that are not repo-relative paths and therefore cannot be resolved against the tree. */
const NOT_A_PATH = /^(?:[a-z][a-z0-9+.-]*:|#|<)/iu;

/** A markdown link whose target does not exist on disk. */
interface BrokenLink {
    /** Repo-relative path of the document holding the link. */
    readonly file: string;
    /** The link target exactly as written. */
    readonly target: string;
}

/**
 * One document's text with fenced blocks and inline code spans blanked out.
 *
 * Replaced with spaces rather than removed so that nothing downstream depends on offsets shifting.
 *
 * @param contents - The raw markdown.
 * @returns The text with code regions blanked. Pure.
 */
function withoutCode(contents: string): string {
    const blank = (match: string): string => ' '.repeat(match.length);

    return contents.replace(/```[\s\S]*?```/gu, blank).replace(/`[^`\n]*`/gu, blank);
}

/**
 * The links in one document whose target file is absent from the tree.
 *
 * A target carrying a template placeholder (`{anchor}`, `<name>`) is skipped: it is a shape to fill in, not
 * a path, and resolving it is not meaningful.
 *
 * @param file - Repo-relative path of the document.
 * @param contents - Its raw markdown.
 * @param exists - Existence predicate over a repo-relative path, injected so the pure verdict is testable.
 * @returns The broken links, in document order. Pure.
 */
function brokenLinksIn(file: string, contents: string, exists: (relative: string) => boolean): readonly BrokenLink[] {
    const broken: BrokenLink[] = [];
    const directory = path.posix.dirname(file);

    for (const match of withoutCode(contents).matchAll(/\[[^\]\n]*\]\(([^)\s]+)/gu)) {
        const target = match[1] ?? '';
        const [filePart = ''] = target.split('#');

        if (target.length === 0 || NOT_A_PATH.test(target) || filePart.length === 0 || /[{}<>]/u.test(filePart)) {
            continue;
        }

        if (!exists(path.posix.normalize(path.posix.join(directory, filePart)))) {
            broken.push({ file, target });
        }
    }

    return broken;
}

/**
 * Every markdown document we author, read.
 *
 * @returns Repo-relative path and contents, one entry per document. Impure.
 * @sideEffect Shells out to git and reads the working tree.
 */
function subjects(): readonly { readonly file: string; readonly contents: string }[] {
    return presentFiles(SUBJECT_PATHSPECS)
        .filter((file) => file.endsWith('.md'))
        .map((file) => ({ file, contents: readFileSync(path.join(repoRoot, file), 'utf8') }));
}

describe('document cross-references', () => {
    it('every link between our own documents resolves', () => {
        // `existsSync` rather than a read: a link may legitimately target a DIRECTORY, which reads throw on.
        const exists = (relative: string): boolean => existsSync(path.join(repoRoot, relative));

        expect(
            subjects()
                .flatMap(({ file, contents }) => brokenLinksIn(file, contents, exists))
                .map(({ file, target }) => `${file} -> ${target}`),
            'A cross-reference between our documents must resolve. Read the target filename off disk rather ' +
                'than inferring it from the document title.',
        ).toEqual([]);
    });

    it('⛔ every ADR on disk is listed in the decisions index', () => {
        // ⚠️ THIS FILE'S OWN DOCSTRING ALREADY CLAIMED THIS RULE — "an ADR needs both an index entry and an
        // inbound pointer" — and nothing asserted the first half. ADR-0028 landed 2026-08-30 and was absent
        // from the index until 2026-09-02, so the decision that created `kitchensink-service-logs-{stage}`
        // was invisible at the moment someone needed it: a reader scanning the index would conclude no such
        // decision existed. A rule stated in prose and checked by nobody is the failure this repo keeps
        // paying for.
        //
        // ⛔ DERIVED FROM THE DIRECTORY, never an enumerated list — a copy of the ADR list cannot detect
        // that the list grew, which is the whole defect being closed here.
        const indexPath = 'docs/architecture/decisions/README.md';
        const index = readFileSync(path.join(repoRoot, indexPath), 'utf8');
        const onDisk = presentFiles(['docs/architecture/decisions/*.md'])
            .map((file) => path.basename(file))
            .filter((name) => /^\d{4}-/u.test(name));

        expect(onDisk.length, 'the ADR directory should not be empty — the glob or pathspec is wrong').toBeGreaterThan(
            0,
        );
        expect(
            onDisk.filter((name) => !index.includes(name)),
            `Every ADR must be listed in ${indexPath}. An unlisted ADR is invisible to the reader who needs ` +
                'it, which is exactly when a settled decision gets re-litigated.',
        ).toEqual([]);
    });

    it('reports a dead target and ignores an example inside a code fence', () => {
        const contents = [
            '[real](./there.md) and [dead](./missing.md)',
            '',
            '```md',
            '[template](./does-not-exist.md)',
            '```',
            '',
            'Inline `[also](./nope.md)` is not a link either.',
            '',
            '[external](https://example.com/x.md) [anchor](#section) [placeholder](./{name}.md)',
        ].join('\n');

        expect(
            brokenLinksIn('docs/probe.md', contents, (relative) => relative === 'docs/there.md').map(
                ({ target }) => target,
            ),
        ).toEqual(['./missing.md']);
    });

    it('resolves a target relative to the document, not to the repo root', () => {
        const broken = brokenLinksIn(
            'docs/architecture/decisions/0024-x.md',
            '[sibling](0006-y.md)',
            (relative) => relative === 'docs/architecture/decisions/0006-y.md',
        );

        expect(broken).toEqual([]);
    });
});
