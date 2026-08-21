// @vitest-environment node
/**
 * Local Postgres must track the RDS engine's major version AND its collation provider.
 *
 * ## Why this is an invariant and not a preference
 *
 * `ORDER BY name ASC` is the tiebreak the ingredient ranker falls back on when two rows score equally, and
 * on the `word_similarity` surface equal scores are the COMMON case, not the rare one — `flour` scores 1.0
 * against both `Flour` and `Carob flour`. So the tiebreak decides which food a cook gets, and the tiebreak
 * is collation.
 *
 * Measured on 2026-08-21 against the two images this repo actually runs, same rows, same statement:
 *
 * ```text
 * postgres:16-alpine (musl, C)   Carob flour, Flour, Milk whole, Sugars brown, …, flour, milk, red wine…
 * postgres:16        (glibc)     Carob flour, flour, Flour, milk, Milk whole, red wine vinegar, …
 * ```
 *
 * Byte order against linguistic order: every position but the first differs. musl's `C` collation sorts all
 * upper-case initials ahead of all lower-case ones; glibc — which is what RDS runs — does not. A judgement
 * set authored against the alpine image therefore encodes an ordering production never produces, and the
 * suite that is supposed to detect a ranking regression would instead assert one.
 *
 * ## What is asserted
 *
 * Every Postgres image pinned anywhere in the repo must match `DataStack`'s `PostgresEngineVersion` major
 * AND must not be an `-alpine` variant. Both halves matter and they fail for different reasons: a version
 * skew changes planner behaviour and available syntax, a provider skew changes sort order.
 *
 * ⚠️ The RDS major is READ from `DataStack.ts`, never restated here. The plan's PG 16 → 18 unit moves that
 * constant, and a guard carrying its own copy of the expected version would either fail spuriously on that
 * change or, worse, keep passing against a version nothing runs.
 *
 * Pins are DISCOVERED from the tree rather than enumerated, so a compose file or workflow added tomorrow is
 * covered the day it lands — `presentFiles` includes work in progress, before its first commit.
 *
 * DESIGN PATTERN: Specification module over a pure predicate — {@link postgresPinsIn} is a pure verdict over
 * one file's text, fired at deliberately-violating fakes below as well as at the working tree.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { presentFiles, repoRoot } from './serviceSources.js';

/** Where a Postgres image can be pinned: compose files and CI workflow service containers. */
const SUBJECT_PATHSPECS = ['*.yml', '*.yaml'];

/** `DataStack` owns the engine version; this gate reads it rather than restating it. */
const DATA_STACK = 'packages/infra/global/lib/platform/DataStack.ts';

/** One `postgres:<tag>` pin found in a file. */
interface PostgresPin {
    /** Repo-relative path of the file carrying the pin. */
    readonly file: string;
    /** The tag exactly as written — `16`, `16-alpine`, `18.1`. */
    readonly tag: string;
}

/**
 * The RDS engine's major version, read from the CDK construct that pins it.
 *
 * @returns The major version as a number.
 * @sideEffect Reads `DataStack.ts`.
 */
function rdsMajorVersion(): number {
    const source = readFileSync(path.join(repoRoot, DATA_STACK), 'utf8');
    const match = /PostgresEngineVersion\.VER_(\d+)/u.exec(source);

    expect(match, `${DATA_STACK} must pin a PostgresEngineVersion for this gate to read`).not.toBeNull();

    return Number(match?.[1]);
}

/**
 * Every Postgres image pin in one file.
 *
 * Matches the `image:` value rather than any mention of the word, so a comment explaining the pin is not
 * itself reported as one.
 *
 * @param file - Repo-relative path.
 * @param contents - The file's text.
 * @returns The pins found, in file order. Pure.
 */
function postgresPinsIn(file: string, contents: string): readonly PostgresPin[] {
    return [...contents.matchAll(/^\s*image:\s*["']?(?:docker\.io\/)?(?:library\/)?postgres:([^\s"']+)/gmu)].map(
        (match) => ({ file, tag: match[1] ?? '' }),
    );
}

/**
 * A pin's fault, or `undefined` when it is correct.
 *
 * @param tag - The image tag as written.
 * @param major - The RDS engine major version.
 * @returns A human-readable fault, or `undefined`. Pure.
 */
function faultIn(tag: string, major: number): string | undefined {
    if (tag.includes('alpine')) {
        return `musl \`C\` collation; RDS runs glibc, so \`ORDER BY name ASC\` differs`;
    }

    const pinnedMajor = Number(/^(\d+)/u.exec(tag)?.[1]);

    return pinnedMajor === major ? undefined : `major ${pinnedMajor} against RDS major ${major}`;
}

/**
 * Every discovered Postgres pin in the repo.
 *
 * @returns One entry per pin. Impure.
 * @sideEffect Shells out to git and reads the working tree.
 */
function allPins(): readonly PostgresPin[] {
    return presentFiles(SUBJECT_PATHSPECS).flatMap((file) =>
        postgresPinsIn(file, readFileSync(path.join(repoRoot, file), 'utf8')),
    );
}

describe('local Postgres parity with RDS', () => {
    it('every pinned image matches the RDS major and its collation provider', () => {
        const major = rdsMajorVersion();

        expect(allPins().length, 'no Postgres pin found — the gate has stopped discovering').toBeGreaterThan(0);

        expect(
            allPins()
                .map(({ file, tag }) => ({ file, tag, fault: faultIn(tag, major) }))
                .filter(({ fault }) => fault !== undefined)
                .map(({ file, tag, fault }) => `${file}: postgres:${tag} — ${fault}`),
            'Local Postgres must track the RDS engine. A `-alpine` image sorts with musl `C` collation, so ' +
                "`ORDER BY name ASC` — the ingredient ranker's tiebreak — differs from production.",
        ).toEqual([]);
    });

    it('reads a pin from an image line but not from prose that mentions one', () => {
        const contents = ['services:', '    db:', '        image: postgres:16-alpine', '# use postgres:15 here'].join(
            '\n',
        );

        expect(postgresPinsIn('fake/compose.yml', contents).map(({ tag }) => tag)).toEqual(['16-alpine']);
    });

    it('faults an alpine image and a major skew, and passes a matching glibc pin', () => {
        expect(faultIn('16-alpine', 16)).toContain('musl');
        expect(faultIn('15', 16)).toContain('major 15');
        expect(faultIn('16', 16)).toBeUndefined();
    });
});
