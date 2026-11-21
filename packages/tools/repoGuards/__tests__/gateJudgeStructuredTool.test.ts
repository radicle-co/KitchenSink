// @vitest-environment node
/**
 * Repo-wide guard: **a GATE judge step that asks for structured output runs as an agent card that lists the tool.**
 *
 * `claude --agent <card>` applies the card's `tools:` allowlist. The CLI adds its `StructuredOutput` tool for
 * `--json-schema` like any other tool, so a card that does not list it drops the tool and the judge cannot return a
 * verdict (the action fails with "--json-schema was provided but Claude did not return structured_output"). Sources: the
 * Claude Code sub-agents documentation, section "Run the whole session as a subagent", where `tools` is an allowlist,
 * and the Agent SDK structured outputs documentation. The text guards in gateJudgeCard.test.ts prove the card tells the
 * judge to call the tool. This guard proves the tool is allowed.
 *
 * It parses the real `.github/workflows/gate.yml` and the real cards, so a new judge step or a card edit that drops
 * the tool fails here. It proves the allowlist, not that the model calls the tool: the proof is the first judged run
 * that logs "Set structured_output".
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const readRepoFile = (relative: string): string => readFileSync(path.join(repoRoot, relative), 'utf8');

const STRUCTURED_OUTPUT_TOOL = 'StructuredOutput';

/** The `claude_args: |` and `>` block bodies of a workflow: the indented lines under each key. */
const claudeArgsBlocks = (workflow: string): string[] => {
    const lines = workflow.split('\n');
    const blocks: string[] = [];

    lines.forEach((line, index) => {
        const key = /^(\s*)claude_args:\s*[|>][+-]?\s*$/u.exec(line);

        if (key === null) {
            return;
        }

        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- DD19: noUncheckedIndexedAccess is off, so key[1] is typed string but is undefined if the group did not take part.
        const keyIndent = (key[1] ?? '').length;
        const body: string[] = [];

        for (const next of lines.slice(index + 1)) {
            const indent = next.length - next.trimStart().length;

            if (next.trim() !== '' && indent <= keyIndent) {
                break;
            }

            body.push(next);
        }

        blocks.push(body.join('\n'));
    });

    return blocks;
};

/** The agent names of every judge step that passes both `--json-schema` and `--agent`. */
const structuredJudgeAgents = (workflow: string): string[] =>
    claudeArgsBlocks(workflow)
        .filter((block) => block.includes('--json-schema'))
        .flatMap((block) =>
            [...block.matchAll(/--agent[\s=]+([A-Za-z0-9_-]+)/gu)].map(
                // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- DD19: noUncheckedIndexedAccess is off, so match[1] is typed string but is undefined if the group did not take part.
                (match) => match[1] ?? '',
            ),
        );

/** Every `claude_args:` line that is not a block scalar, which this guard cannot read and so must not skip. */
const unreadableClaudeArgs = (workflow: string): string[] =>
    workflow
        .split('\n')
        .filter((line) => /^\s*claude_args:/u.test(line) && !/^\s*claude_args:\s*[|>][+-]?\s*$/u.test(line));

/** The judge steps (with `--json-schema`) whose `--disallowedTools` list removes the structured output tool. */
const stepsDisallowingTheTool = (workflow: string): number =>
    claudeArgsBlocks(workflow)
        .filter((block) => block.includes('--json-schema'))
        .filter((block) =>
            [...block.matchAll(/--disallowedTools[\s=]+("[^"]*"|'[^']*'|\S+)/gu)].some((match) =>
                // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- DD19: noUncheckedIndexedAccess is off, so match[1] is typed string but is undefined if the group did not take part.
                (match[1] ?? '').split(/[\s,"']+/u).includes(STRUCTURED_OUTPUT_TOOL),
            ),
        ).length;

/** The names on the card's `tools:` frontmatter line, or `null` when the card has no such line. */
const cardTools = (card: string, key = 'tools'): string[] | null => {
    const frontmatter = /^---\n([\s\S]*?)\n---/u.exec(card)?.[1] ?? '';
    const line = new RegExp(`^${key}:\\s*(.*)$`, 'mu').exec(frontmatter)?.[1];

    return line === undefined ? null : line.split(',').map((tool) => tool.trim());
};

/** The agents that a structured judge runs as but whose card does not allow the structured output tool. */
const agentsMissingTheTool = (workflow: string, readCard: (agent: string) => string): string[] =>
    structuredJudgeAgents(workflow).filter((agent) => {
        const card = readCard(agent);
        const tools = cardTools(card);

        // A card with no `tools:` line inherits every tool, including this one.
        return (
            (tools !== null && !tools.includes(STRUCTURED_OUTPUT_TOOL)) ||
            (cardTools(card, 'disallowedTools') ?? []).includes(STRUCTURED_OUTPUT_TOOL)
        );
    });

const judgeStep = (agent: string, schema = `--json-schema '{"type":"object"}'`): string =>
    `            with:\n              claude_args: |\n                --max-turns 40\n                --agent ${agent}\n                ${schema}\n            env:\n              X: y\n`;

const cardWith = (toolsLine: string | null): string => {
    const tools = toolsLine === null ? '' : `tools: ${toolsLine}\n`;

    return `---\nname: judge\ndescription: d\n${tools}model: inherit\n---\nbody\n`;
};

describe('GATE judge card allows the structured output tool', () => {
    it('1. every judge step of the real gate.yml runs as a card whose real tools line lists StructuredOutput', () => {
        const workflow = readRepoFile('.github/workflows/gate.yml');
        const agents = structuredJudgeAgents(workflow);

        expect(agents.length, 'gate.yml has no structured judge step to check').toBeGreaterThanOrEqual(2);
        expect(agentsMissingTheTool(workflow, (agent) => readRepoFile(`.claude/agents/${agent}.md`))).toEqual([]);
        expect(stepsDisallowingTheTool(workflow)).toBe(0);
        expect(unreadableClaudeArgs(workflow)).toEqual([]);
    });

    it('2. a card that lists tools without StructuredOutput fails the guard', () => {
        const workflow = judgeStep('judge');

        expect(agentsMissingTheTool(workflow, () => cardWith('Glob, Grep, Read'))).toEqual(['judge']);
    });

    it('3. a card that lists StructuredOutput passes, wherever it sits in the list', () => {
        const workflow = judgeStep('judge');

        expect(agentsMissingTheTool(workflow, () => cardWith('Glob, StructuredOutput, Read'))).toEqual([]);
        expect(agentsMissingTheTool(workflow, () => cardWith('Glob, Read, StructuredOutput'))).toEqual([]);
    });

    it('4. a tool whose name only contains StructuredOutput does not count', () => {
        const workflow = judgeStep('judge');

        expect(agentsMissingTheTool(workflow, () => cardWith('Glob, MyStructuredOutputHelper'))).toEqual(['judge']);
    });

    it('5. a card with no tools line inherits every tool and passes', () => {
        expect(agentsMissingTheTool(judgeStep('judge'), () => cardWith(null))).toEqual([]);
    });

    it('6. a step that passes --agent without --json-schema is not checked', () => {
        const workflow = judgeStep('judge', '--allowedTools Read');

        expect(structuredJudgeAgents(workflow)).toEqual([]);
        expect(agentsMissingTheTool(workflow, () => cardWith('Glob'))).toEqual([]);
    });

    it('7. each judge step in a workflow is checked, not only the first', () => {
        const workflow = `${judgeStep('good')}\n${judgeStep('bad')}`;
        const cards = new Map([
            ['good', cardWith('StructuredOutput')],
            ['bad', cardWith('Read')],
        ]);

        const readCard = (agent: string): string => {
            const card = cards.get(agent);

            if (card === undefined) {
                throw new Error(`the fixture has no card for the agent "${agent}"`);
            }

            return card;
        };

        expect(agentsMissingTheTool(workflow, readCard)).toEqual(['bad']);
    });

    it('8. a judge step whose --disallowedTools names StructuredOutput fails the guard', () => {
        const removed = judgeStep('judge').replace('--max-turns 40', '--disallowedTools "Bash,StructuredOutput,Edit"');
        const kept = judgeStep('judge').replace('--max-turns 40', '--disallowedTools "Bash,MyStructuredOutputHelper"');

        expect(stepsDisallowingTheTool(removed)).toBe(1);
        expect(stepsDisallowingTheTool(kept)).toBe(0);
    });

    it('9. folded block scalars are parsed, and any claude_args form the parser cannot read is reported', () => {
        const folded = judgeStep('judge').replace('claude_args: |', 'claude_args: >-');
        const inline = judgeStep('judge').replace('claude_args: |', 'claude_args: "--agent judge --json-schema {}"');

        expect(agentsMissingTheTool(folded, () => cardWith('Read'))).toEqual(['judge']);
        expect(unreadableClaudeArgs(folded)).toEqual([]);
        expect(unreadableClaudeArgs(inline)).toHaveLength(1);
    });

    it('10. --agent=name is read as well as --agent name', () => {
        const workflow = judgeStep('judge').replace('--agent judge', '--agent=judge');

        expect(agentsMissingTheTool(workflow, () => cardWith('Read'))).toEqual(['judge']);
    });

    it('11. a card whose disallowedTools field names StructuredOutput fails the guard, even when tools lists it', () => {
        const card = `---\nname: judge\ntools: Read, StructuredOutput\ndisallowedTools: Bash, StructuredOutput\n---\nbody\n`;

        expect(agentsMissingTheTool(judgeStep('judge'), () => card)).toEqual(['judge']);
    });
});
