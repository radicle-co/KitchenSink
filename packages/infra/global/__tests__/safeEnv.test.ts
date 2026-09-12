// @vitest-environment node
/**
 * `.github/scripts/safe-env.sh` — the ONE way a step in this repository writes to `$GITHUB_ENV` while carrying a
 * `zizmor: ignore[github-env]` suppression.
 *
 * ## Why this exists
 *
 * zizmor's `github-env` audit objects to writing `$GITHUB_ENV` because a value that can carry a NEWLINE can
 * smuggle a second assignment — `NODE_OPTIONS=--require=…`, `LD_PRELOAD=…`, `BASH_ENV=…` — and every later step
 * then runs attacker-chosen code. The composite `infra-package` action genuinely needs `$GITHUB_ENV`: its
 * platform inputs, its food origin and its image tag are exported under names the CALLER chooses, and a step
 * output cannot be re-exported under a dynamic name. So the suppression is justified only if the property the
 * audit protects still holds, and this script is where it is made to hold: a strict name, a denylist of the
 * names that change how a process starts, and a value charset with no whitespace, no quote, no `$` and — above
 * all — no newline.
 *
 * Executed against the REAL script, the way `prScope.test.ts` runs `pr-scope.sh`.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { repoRoot, trackedFiles } from './serviceSources.js';

const SCRIPT = fileURLToPath(new URL('../../../../.github/scripts/safe-env.sh', import.meta.url));

let scratch = '';

afterEach(() => {
    if (scratch !== '') {
        rmSync(scratch, { recursive: true, force: true });
        scratch = '';
    }
});

/** Run the script with a fresh env file and report what it wrote. */
function write(name: string, value: string): { readonly status: number | null; readonly written: string } {
    scratch = mkdtempSync(path.join(tmpdir(), 'safe-env-'));
    const envFile = path.join(scratch, 'github_env');

    writeFileSync(envFile, '');
    const result = spawnSync('bash', [SCRIPT, name, value], {
        encoding: 'utf8',
        env: { PATH: process.env['PATH'] ?? '', GITHUB_ENV: envFile },
    });

    return { status: result.status, written: readFileSync(envFile, 'utf8') };
}

describe('safe-env.sh writes only a validated NAME=VALUE line', () => {
    it.each([
        ['ALARMS_ENABLED', 'true'],
        ['IMAGE_TAG', 'pr-91-626b19f6d7c1e0a9b3f4e5d6c7b8a9f0e1d2c3b4'],
        ['RECIPE_VPC_ID', 'vpc-0abc123'],
        ['HANDLE_SYNC_TOPIC_ARN', 'arn:aws:sns:us-east-1:123456789012:kitchensink-handle-sync-sandbox'],
        ['RECIPE_FOOD_SERVICE_URL', 'https://food-pr-91.commise.app'],
        ['RECIPE_DB_ENDPOINT', 'db.abc123.us-east-1.rds.amazonaws.com'],
        ['EMPTY_IS_A_VALUE', ''],
    ])('accepts %s=%j', (name, value) => {
        // The positive half: without it, a script that refused everything would pass every refusal below.
        expect(write(name, value)).toEqual({ status: 0, written: `${name}=${value}\n` });
    });

    it.each([
        ['a newline smuggling a second assignment', 'true\nNODE_OPTIONS=--require=/tmp/payload.js'],
        ['a carriage return', 'true\rNODE_OPTIONS=x'],
        ['whitespace', 'two words'],
        ['a command substitution', '$(id)'],
        ['a quote', "it's"],
        ['a heredoc delimiter shape', 'EOF<<'],
    ])('refuses a value with %s, and writes NOTHING', (_label, value) => {
        const { status, written } = write('SOME_VALUE', value);

        expect(status).toBe(2);
        expect(written).toBe('');
    });

    it.each(['lower_case', '1LEADING_DIGIT', 'HAS-DASH', '', 'A B'])('refuses the name %j', (name) => {
        expect(write(name, 'x')).toEqual({ status: 2, written: '' });
    });

    it.each([
        'NODE_OPTIONS',
        'LD_PRELOAD',
        'LD_LIBRARY_PATH',
        'BASH_ENV',
        'ENV',
        'PATH',
        'GITHUB_TOKEN',
        'RUNNER_TEMP',
        'ACTIONS_RUNTIME_TOKEN',
    ])('refuses %s, a name that changes how a later process starts', (name) => {
        // Syntactically valid names, so the name regex alone would admit every one of them.
        expect(write(name, 'x')).toEqual({ status: 2, written: '' });
    });
});

/** Every workflow and composite action, as raw text — comments matter here, and a YAML parse drops them. */
function workflowSources(): readonly { readonly file: string; readonly text: string }[] {
    return trackedFiles('.github')
        .filter((file) => /^\.github\/(?:workflows\/[^/]+|actions\/.+\/action)\.ya?ml$/u.test(file))
        .map((file) => ({ file, text: readFileSync(path.join(repoRoot, file), 'utf8') }));
}

/** Split a file into step blocks: each starts at a `- name:` / `- uses:` / `- run:` list item. */
function stepBlocks(text: string): readonly string[] {
    return text.split(/^(?=\s*- (?:name|uses|run|id):)/mu);
}

describe('a step that suppresses `github-env` writes $GITHUB_ENV ONLY through safe-env.sh', () => {
    const suppressed = workflowSources().flatMap(({ file, text }) =>
        stepBlocks(text)
            .filter((block) => /zizmor: ignore\[[^\]]*\bgithub-env\b/u.test(block))
            .map((block) => ({ file, block })),
    );

    it('finds the suppressed sites at all', () => {
        // Non-vacuity: the infra-package action carries four today.
        expect(suppressed.length).toBeGreaterThanOrEqual(4);
    });

    it.each(
        suppressed.map(({ file, block }) => [`${file}: ${/- name: (.*)/u.exec(block)?.[1] ?? '?'}`, block] as const),
    )('%s', (_label, block) => {
        // A raw append is exactly what the suppression claims does not happen here.
        expect(block).not.toMatch(/>>\s*"?\$\{?GITHUB_ENV/u);
        expect(block).toMatch(/safe-env\.sh/u);
    });
});
