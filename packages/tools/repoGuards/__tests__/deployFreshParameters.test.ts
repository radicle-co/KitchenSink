/**
 * Repo-wide guard: EVERY `cdk deploy` carries `--no-previous-parameters`.
 *
 * The CDK CLI reuses a stack's PREVIOUS parameter values for every parameter the template still has
 * (`UsePreviousValue: true`). Every stack that was first deployed through the default bootstrap therefore keeps
 * `BootstrapVersion=/cdk-bootstrap/hnb659fds/version` for ever, and a deploy through a KitchenSink qualifier would
 * resolve the other application's parameter with a role that may not read it (and, when it can, would silently check
 * the wrong bootstrap). `--no-previous-parameters` takes the template's defaults. It is safe for these stacks because
 * every parameter they carry is an SSM-path parameter whose template default is its value.
 *
 * The subject set is DISCOVERED, not listed: every workflow job and composite action step (parsed as YAML, so a
 * comment is not a deploy), every `.github/scripts` shell file, every tracked `package.json` script, and the fenced
 * commands of the bootstrap runbook. `npm run deploy` is covered through the package script it runs.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import { repoRoot, trackedFiles } from './serviceSources.js';

const FLAG = '--no-previous-parameters';
const DEPLOY = /\bcdk deploy\b/u;

/**
 * The logical commands in a block of shell or JSON-embedded text that run `cdk deploy`, comments excluded and
 * backslash continuations joined.
 *
 * @returns One string per command. Pure.
 */
function deployCommands(text: string): readonly string[] {
    const commands: string[] = [];
    let open: string | undefined;

    for (const raw of text.split('\n')) {
        const line = raw.trim();

        if (open === undefined && line.startsWith('#')) {
            continue;
        }

        const joined = open === undefined ? line : `${open} ${line}`;

        if (joined.endsWith('\\')) {
            open = joined.slice(0, -1);
            continue;
        }

        open = undefined;

        if (DEPLOY.test(joined)) {
            commands.push(joined);
        }
    }

    return commands;
}

const missingFlag = (where: string, text: string): readonly string[] =>
    deployCommands(text)
        .filter((command) => !command.includes(FLAG))
        .map((command) => `${where}: ${command.slice(0, 120)}`);

interface Step {
    readonly run?: string;
}

function workflowAndActionRuns(): readonly { where: string; run: string }[] {
    const runs: { where: string; run: string }[] = [];
    const workflows = join(repoRoot, '.github/workflows');
    const actions = join(repoRoot, '.github/actions');

    for (const file of readdirSync(workflows).filter((name) => name.endsWith('.yml'))) {
        const doc = parse(readFileSync(join(workflows, file), 'utf8')) as { jobs?: Record<string, { steps?: Step[] }> };

        for (const [job, body] of Object.entries(doc.jobs ?? {})) {
            (body.steps ?? []).forEach((step, index) =>
                runs.push({ where: `workflows/${file} job ${job} step ${index}`, run: step.run ?? '' }),
            );
        }
    }

    for (const dir of readdirSync(actions)) {
        const doc = parse(readFileSync(join(actions, dir, 'action.yml'), 'utf8')) as { runs?: { steps?: Step[] } };

        (doc.runs?.steps ?? []).forEach((step, index) =>
            runs.push({ where: `actions/${dir} step ${index}`, run: step.run ?? '' }),
        );
    }

    return runs;
}

/** The fenced code blocks of a Markdown file, joined; prose and tables are not commands. */
const fenced = (markdown: string): string =>
    markdown
        .split('```')
        .filter((_, index) => index % 2 === 1)
        .join('\n');

describe('deployCommands: the reader finds what it must', () => {
    it('joins a continued command and reads the flag from any line of it', () => {
        expect(deployCommands('cdk deploy "x" \\\n  --require-approval never')).toHaveLength(1);
        expect(missingFlag('w', 'cdk deploy "x" \\\n  --require-approval never')).toHaveLength(1);
        expect(missingFlag('w', `cdk deploy "x" \\\n  ${FLAG}`)).toEqual([]);
    });

    it('ignores a comment that mentions the command', () => {
        expect(deployCommands('# run cdk deploy later\necho ok')).toEqual([]);
    });

    it('names a deploy without the flag', () => {
        expect(missingFlag('w', 'npx cdk deploy --all')).toEqual([expect.stringContaining('cdk deploy --all')]);
    });
});

describe('every cdk deploy takes the template defaults', () => {
    it('judges real subjects (a vacuous pass here would hide every rule below)', () => {
        const total = workflowAndActionRuns().flatMap(({ run }) => deployCommands(run)).length;

        expect(total).toBeGreaterThan(10);
    });

    it('in every workflow job and composite action step', () => {
        expect(workflowAndActionRuns().flatMap(({ where, run }) => missingFlag(where, run))).toEqual([]);
    });

    it('in every .github/scripts shell file', () => {
        const scripts = trackedFiles('.github/scripts').filter((file) => file.endsWith('.sh'));

        expect(scripts.length).toBeGreaterThan(0);
        expect(scripts.flatMap((file) => missingFlag(file, readFileSync(join(repoRoot, file), 'utf8')))).toEqual([]);
    });

    it('in every package.json script (npm run deploy runs these)', () => {
        const manifests = trackedFiles('packages').filter((file) => file.endsWith('/package.json'));
        const deploys = manifests.flatMap((file) => {
            const scripts = (
                JSON.parse(readFileSync(join(repoRoot, file), 'utf8')) as { scripts?: Record<string, string> }
            ).scripts;

            return Object.entries(scripts ?? {})
                .filter(([, command]) => DEPLOY.test(command))
                .map(([name, command]) => ({ where: `${file}#${name}`, command }));
        });

        expect(deploys.length).toBeGreaterThan(5);
        expect(deploys.flatMap(({ where, command }) => missingFlag(where, command))).toEqual([]);
    });

    it('in the commands of the bootstrap runbook', () => {
        const runbook = readFileSync(join(repoRoot, 'docs/runbooks/cdkBootstrapQualifiers.md'), 'utf8');

        expect(
            missingFlag('docs/runbooks/cdkBootstrapQualifiers.md', fenced(runbook).replaceAll('$CDK', 'cdk')),
        ).toEqual([]);
    });
});
