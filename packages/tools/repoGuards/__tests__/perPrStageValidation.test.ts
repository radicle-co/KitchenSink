/**
 * A workflow validates a per-PR stage through `prScope.sh is-token`, never through a `case` glob.
 *
 * ⛔ A shell glob cannot state the per-PR grammar: `pr-[0-9]*` matches anything after the first digit (`pr-1abc`,
 * `pr-7;x`), so a malformed stage passed the workflow's guard and flowed into derived hostnames and `$GITHUB_OUTPUT`,
 * while the allocator and the scheduler refused the same string later and opaquely. `pr_scope_is_token` is the one
 * predicate (`prScope.test.ts` executes it); a workflow that wants the rule calls it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const WORKFLOWS = fileURLToPath(new URL('../../../../.github/workflows/', import.meta.url));

/** A `case` arm whose pattern list contains a `pr-` glob, e.g. `prod | pr-[0-9]*)`. */
const PR_GLOB_CASE_ARM = /^\s*(?:[^\s|()]+\s*\|\s*)*pr-[^\s|)]*[*?[][^\s|)]*\s*(?:\|[^)]*)?\)/u;

/** The workflow lines that validate a stage with a `pr-` glob. Pure. */
function prGlobArms(text: string): string[] {
    return text.split('\n').filter((line) => PR_GLOB_CASE_ARM.test(line));
}

describe('the case-arm detector', () => {
    it.each([
        ['                      pr-[0-9]*) ;;', true],
        ['                      prod | pr-[0-9]*) ;;', true],
        ['    pr-*) echo x ;;', true],
        ['                      prod) ;;', false],
        ['    if bash .github/scripts/prScope.sh is-token "${stage}"; then', false],
        ["    echo 'expected pr-{N}'", false],
    ])('%s -> %s', (line, matched) => {
        expect(prGlobArms(line).length > 0).toBe(matched);
    });
});

describe('⛔ no workflow validates a per-PR stage with a glob', () => {
    const files = readdirSync(WORKFLOWS).filter((name) => /\.ya?ml$/u.test(name));

    it('reads the workflows', () => {
        expect(files.length).toBeGreaterThan(0);
    });

    it.each(files)('%s', (name) => {
        expect(prGlobArms(readFileSync(join(WORKFLOWS, name), 'utf8'))).toEqual([]);
    });
});
