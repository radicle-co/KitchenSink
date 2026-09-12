// @vitest-environment node
/**
 * Repo-wide guard: no `run:` body contains a line that is really a local composite action's `with:` input.
 *
 * ## Why this exists
 *
 * `deploy-infra.yml`'s identity job lost six of its `infra-package` inputs — `workspace-package`,
 * `workspace-dir`, `image-tag-env`, `ecr-repo`, `image-build-context`, `dockerfile` — into the `run: |` block of
 * the smoke step below it, in the 2026-09-08 refactor. YAML accepted it: inside a block scalar they are just
 * text. The action then ran with no image inputs, and the smoke would have tried to EXECUTE
 * `workspace-package: '@kitchensink/identity-service'` as a shell command. Nothing noticed, because the PR
 * checks never deploy identity; zizmor surfaced it only incidentally, as a `template-injection` on the stray
 * `aws-region: ${{ … }}` line.
 *
 * The population is derived: every input name declared by an action under `.github/actions/`, and every
 * `run:` in a workflow or composite action. A shell line spelled `<input-name>: <value>` is not something a
 * script says.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { repoRoot, trackedFiles } from './serviceSources.js';

interface Step {
    readonly name?: string;
    readonly run?: string;
}

/** Every input name a local composite action declares. */
function localActionInputs(): ReadonlySet<string> {
    return new Set(
        trackedFiles('.github/actions')
            .filter((file) => /\/action\.ya?ml$/u.test(file))
            .flatMap((file) =>
                Object.keys(
                    (parse(readFileSync(path.join(repoRoot, file), 'utf8')) as { inputs?: Record<string, unknown> })
                        .inputs ?? {},
                ),
            ),
    );
}

/** Every `run:` body in every workflow job and composite action, labelled. */
function runBodies(): readonly { readonly label: string; readonly run: string }[] {
    return trackedFiles('.github')
        .filter((file) => /^\.github\/(?:workflows\/[^/]+|actions\/.+\/action)\.ya?ml$/u.test(file))
        .flatMap((file) => {
            const doc = parse(readFileSync(path.join(repoRoot, file), 'utf8')) as {
                jobs?: Record<string, { steps?: Step[] }>;
                runs?: { steps?: Step[] };
            } | null;
            const lists = [
                ...Object.entries(doc?.jobs ?? {}).map(([job, definition]) => [job, definition.steps ?? []] as const),
                ['runs', doc?.runs?.steps ?? []] as const,
            ];

            return lists.flatMap(([owner, steps]) =>
                steps
                    .filter((step) => typeof step.run === 'string')
                    .map((step) => ({
                        label: `${file} › ${owner} › ${step.name ?? '(unnamed)'}`,
                        run: step.run ?? '',
                    })),
            );
        });
}

describe('no run: body swallowed an action input', () => {
    const inputs = localActionInputs();

    it('reads the action inputs at all', () => {
        // Non-vacuity: `infra-package` declares these, and they are the ones that went missing.
        expect([...inputs]).toEqual(expect.arrayContaining(['workspace-package', 'ecr-repo', 'dockerfile']));
    });

    it.each(runBodies().map((body) => [body.label, body.run] as const))('%s', (_label, run) => {
        const stray = run.split('\n').filter((line) => {
            const key = /^\s*([a-z][a-z0-9-]*):\s/u.exec(line)?.[1];

            return key !== undefined && inputs.has(key);
        });

        expect(stray, 'these lines are `with:` inputs, not shell').toEqual([]);
    });
});
