/**
 * Coverage for the `sql.raw(...)` ban carried by the shared config's `no-restricted-syntax` rule.
 *
 * WHY THIS IS A LINT RULE AND NOT A CODE COMMENT. `sql.raw` bypasses parameterisation BY DESIGN: whatever
 * string it is handed is spliced into the statement text, so the value's provenance is the ONLY thing standing
 * between it and SQL injection. At the time this rule was added the repository had exactly three `sql.raw`
 * call sites, and all three were provably safe — every argument was a module-level constant or a construction
 * default. That is precisely the shape of a latent vulnerability rather than a present one: the audit's
 * conclusion ("none is reachable from user input") was a property of the CALLERS, re-derived by hand, with
 * nothing in the build that would notice when a later refactor turned one of those constants into a request
 * value. All three were rewritten to use bound parameters (`$n::interval`, `LIMIT $n`), which leaves the repo
 * with ZERO `sql.raw` — so the ban costs nothing today and is what makes the safety durable instead of audited.
 *
 * The two cases below are the mutation test: the invalid case reds if the selector is removed from the shared
 * config, and the valid case reds if the selector is widened into a ban on the `sql` tag itself (which is the
 * parameterising form and the one every DAL should use).
 */
import { describe, expect, it } from 'vitest';
import { Linter } from 'eslint';

import { createConfig } from '../index.js';

/**
 * The `no-restricted-syntax` options as the shared config actually ships them.
 *
 * Read out of `createConfig()` rather than restated here, so this suite tests the rule the packages receive
 * instead of a copy of it that could agree with itself while the config drifted. The LAST config object that
 * sets the rule is deliberately skipped: it is the `src/config/env.ts` exception, which narrows the rule for
 * bundler-inlined environment maps (see the ⚠️ note in `index.js`) and is not the general posture.
 *
 * @returns {unknown[]} The rule's option objects.
 */
function restrictedSyntaxOptions() {
    const generalBlock = createConfig().find(
        (block) => block.files === undefined && block.rules?.['no-restricted-syntax'] !== undefined,
    );

    if (generalBlock === undefined) {
        throw new Error('the shared config no longer defines an unscoped `no-restricted-syntax` block');
    }

    const [, ...options] = generalBlock.rules['no-restricted-syntax'];

    return options;
}

/**
 * Lint `code` against the shared config's `no-restricted-syntax` options alone.
 *
 * @param {string} code - The source to lint.
 * @returns {import('eslint').Linter.LintMessage[]} The reported messages.
 */
function lint(code) {
    return new Linter().verify(code, {
        rules: { 'no-restricted-syntax': ['error', ...restrictedSyntaxOptions()] },
    });
}

describe('the shared ESLint config bans sql.raw', () => {
    it('reports `sql.raw(...)`, naming parameterisation as the fix', () => {
        const messages = lint('const q = sql`SELECT 1 LIMIT ${sql.raw(String(size))}`;');

        expect(messages).toHaveLength(1);
        expect(messages[0]?.message).toMatch(/sql\.raw/);
        expect(messages[0]?.message).toMatch(/parameter/i);
    });

    it('leaves the parameterising `sql` tag and its interpolations alone', () => {
        // The SAME statement written the correct way — the value is an interpolation, which drizzle emits as a
        // bound parameter. If the selector were widened to the `sql` tag this would red, which is the point.
        expect(lint('const q = sql`SELECT 1 LIMIT ${size}`;')).toHaveLength(0);
    });

    it('does not report an unrelated `.raw` member call on another object', () => {
        // Scoped to the drizzle `sql` builder: `response.raw(...)` is not a SQL statement and must not be
        // swept up, or the rule becomes noise that gets disabled.
        expect(lint('const body = response.raw(payload);')).toHaveLength(0);
    });
});
