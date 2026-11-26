// @vitest-environment node
/**
 * Repo guard: how the Maestro flows write the cooking step and line labels.
 *
 * The labels are the cooking `top.place` and `step.lineOf` copy (messages.ts), and the space after `Step` and `Line` is
 * a no-break space. A flow that asserts it with a plain space matches nothing on a device, and one that types the
 * no-break space hides an invisible character in a file nobody can read it in. So every flow writes such a label as
 * `Step.N of M` or `Line.N of M`, with `.` for the space, and the label must match the real copy.
 *
 * The real copy is read from messages.ts as text, so a change to the copy cannot leave this guard checking a stale
 * copy of it. Which number a flow expects at a point is the flow's own assertion, and the device run is its oracle.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT, committedFlowFiles, isRecord, parseFlow } from './maestroFlowYaml.js';

const MESSAGES = join(REPO_ROOT, 'packages/apps/commise/features/cooking/src/messages.ts');

/** The English `<group>.<key>` template of messages.ts, with its `\\uXXXX` escapes turned into characters. */
function template(group: string, key: string): string {
    const text = readFileSync(MESSAGES, 'utf8');
    const english = text.slice(text.search(/\ben:\s*\{/u));
    const found = new RegExp(`\\b${group}:\\s*\\{[^}]*?\\b${key}:\\s*'([^']*)'`, 'u').exec(english);

    if (found?.[1] === undefined) {
        throw new Error(
            `no en ${group}.${key} copy found in ${MESSAGES}: the guard would check nothing, so fix its reader`,
        );
    }

    return found[1].replace(/\\u([0-9a-f]{4})/giu, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)));
}

const LABELS = { Step: template('top', 'place'), Line: template('step', 'lineOf') } as const;

type Kind = keyof typeof LABELS;

/** What the device shows for `kind` at `current` of `total`. */
const real = (kind: Kind, current: number, total: number): string =>
    LABELS[kind].replace('{current}', String(current)).replace('{total}', String(total));

/** Every text in a parsed flow, whatever command or selector form holds it. Pure. */
function* texts(value: unknown): Generator<string> {
    if (typeof value === 'string') {
        yield value;
    } else if (Array.isArray(value)) {
        for (const item of value) {
            yield* texts(item);
        }
    } else if (isRecord(value)) {
        for (const item of Object.values(value)) {
            yield* texts(item);
        }
    }
}

/** Text that is written like a step or line label, whatever its separator or anchoring. */
const LABEL_LIKE = /(?:Step|Line).{1,4}\d+ of \d+/u;

/** The one form a flow may write a label in: `.` stands for the space. */
const LABEL_FORM = /^(Step|Line)\.(\d+) of (\d+)$/u;

/** Maestro matches the whole text of an element against the selector as a regex. */
const matchesWholeText = (selector: string, text: string): boolean => new RegExp(`^(?:${selector})$`, 'u').test(text);

/** Every text of a parsed flow that is written like a label, in file order. */
const labelTexts = (documents: readonly unknown[]): string[] =>
    documents.flatMap((document) => [...texts(document)]).filter((text) => LABEL_LIKE.test(text));

/** The label-like texts that are not in the one form, or whose form does not match the real copy. */
function offenders(found: readonly string[]): string[] {
    return found.filter((text) => {
        const parts = LABEL_FORM.exec(text);
        const kind = parts?.[1];

        return !(
            (kind === 'Step' || kind === 'Line') &&
            matchesWholeText(text, real(kind, Number(parts?.[2]), Number(parts?.[3])))
        );
    });
}

/** Every committed flow's label-like texts, each with its flow. */
const committed = (): { readonly file: string; readonly text: string }[] =>
    committedFlowFiles().flatMap((file) =>
        labelTexts(parseFlow(file, readFileSync(join(REPO_ROOT, file), 'utf8'))).map((text) => ({ file, text })),
    );

describe.each(Object.entries(LABELS))('the %s label this guard reads from messages.ts', (kind, label) => {
    it('is a template with both slots, led by its word', () => {
        expect(label).toContain('{current}');
        expect(label).toContain('{total}');
        expect(label.startsWith(kind)).toBe(true);
    });
});

describe('every committed flow writes its step and line labels in the one form', () => {
    it('finds labels at all, so a broken reader cannot pass by finding none', () => {
        expect(committed().length).toBeGreaterThan(0);
    });

    it('never with the space typed out, plain or no-break', () => {
        const typed = committed().filter(({ text }) => /^(?:Step|Line)[ \u00a0]/u.test(text));

        expect(typed.map(({ file, text }) => `${file}: ${text}`)).toEqual([]);
    });

    it('and each label matches the real copy: `.` for the space, the number the flow expects', () => {
        const wrong = committed().filter(({ text }) => offenders([text]).length > 0);

        expect(wrong.map(({ file, text }) => `${file}: ${text}`)).toEqual([]);
    });
});

describe('the label reader sees every selector form', () => {
    const fixture = (source: string): string[] => labelTexts(parseFlow('inline', source));

    it('finds a bare selector, a text selector and a visible condition, whatever the quoting', () => {
        const flow = [
            "- assertVisible: 'Step.1 of 3'",
            '- tapOn:',
            '    text: "Line.2 of 2"',
            '- runFlow:',
            '    when:',
            "      visible: 'Step 2 of 3'",
        ].join('\n');

        expect(fixture(flow)).toEqual(['Step.1 of 3', 'Line.2 of 2', 'Step 2 of 3']);
    });

    it('catches an anchored form, a regex-space form and a wrong word, which a narrower reader would skip', () => {
        const flow = [
            "- assertVisible: '^Step 1 of 3$'",
            "- assertVisible: 'Step\\s1 of 3'",
            "- assertVisible: 'Steps.1 of 3'",
        ].join('\n');

        expect(offenders(fixture(flow))).toEqual(['^Step 1 of 3$', 'Step\\s1 of 3', 'Steps.1 of 3']);
    });

    it('accepts the one form when it matches the copy', () => {
        expect(offenders(['Step.1 of 3', 'Line.2 of 2'])).toEqual([]);
    });
});
