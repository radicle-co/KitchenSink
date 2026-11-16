/**
 * The design canvases live on claude.ai, not in this repository, so the only way an agent finds one is the registry
 * at `docs/design/canvases/registry.json`. Before it existed, the links lived in one session's private notes, and a
 * session started anywhere else could not find most of the screens.
 *
 * This guard holds the registry to the shape its README promises: one Design System built from the repo, and every
 * current screen subject with exactly one web canvas and one mobile canvas, each a distinct claude.ai artifact.
 *
 * @see docs/design/canvases/README.md
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const CANVAS_DIR = join(__dirname, '..', '..', '..', '..', 'docs', 'design', 'canvases');

const canvasSchema = z.strictObject({
    id: z.string().min(1),
    title: z.string().min(1),
    url: z.string().min(1),
    kind: z.enum(['designSystem', 'page', 'feature', 'unused']),
    status: z.enum(['current', 'archive', 'unused']),
    source: z.enum(['repo', 'repo-canvas', 'none']),
    platform: z.enum(['web', 'mobile', 'combined']).optional(),
    subject: z.string().min(1).optional(),
    note: z.string().optional(),
    folder: z
        .string()
        .regex(/^[A-Za-z0-9]+$/u)
        .optional(),
});

const registrySchema = z.strictObject({ canvases: z.array(canvasSchema) });

/** The record written beside each snapshot; only the url is checked here. */
const snapshotSchema = z.object({ url: z.string().min(1) });

type CanvasEntry = z.infer<typeof canvasSchema>;

/** A claude.ai artifact link with its 22-character id. */
const ARTIFACT_URL = /^https:\/\/claude\.ai\/artifact\/[A-Za-z0-9]{22}$/;

const isScreen = (entry: CanvasEntry): boolean => entry.kind === 'page' || entry.kind === 'feature';

function duplicates(values: readonly string[], what: string): readonly string[] {
    const repeated = values.filter((value, index) => values.indexOf(value) !== index);

    return repeated.length > 0 ? [`duplicate ${what}: ${repeated.join(', ')}`] : [];
}

function entryProblems(entry: CanvasEntry): readonly string[] {
    const problems: string[] = [];

    if (!ARTIFACT_URL.test(entry.url)) {
        problems.push(`${entry.id}: not a claude.ai artifact link: ${entry.url}`);
    }

    if (isScreen(entry) && (entry.subject === undefined || entry.platform === undefined)) {
        problems.push(`${entry.id}: a screen canvas needs a subject and a platform`);
    }

    if (entry.status === 'current' && entry.platform === 'combined') {
        problems.push(`${entry.id}: a combined canvas cannot be current`);
    }

    // A screen canvas's source is a folder in this repo, and only a screen canvas has one.
    if (
        isScreen(entry) !== (entry.source === 'repo-canvas') ||
        (entry.source === 'repo-canvas') !== (entry.folder !== undefined)
    ) {
        problems.push(`${entry.id}: a screen canvas has source "repo-canvas" and a folder, and no other entry does`);
    }

    return problems;
}

function designSystemProblems(entries: readonly CanvasEntry[]): readonly string[] {
    const systems = entries.filter((entry) => entry.kind === 'designSystem');
    const valid =
        systems.length === 1 && systems.every((entry) => entry.source === 'repo' && entry.status === 'current');

    return valid ? [] : ['there must be exactly one current Design System, with source "repo"'];
}

function pairingProblems(entries: readonly CanvasEntry[]): readonly string[] {
    const current = entries.filter((entry) => entry.status === 'current' && isScreen(entry));
    const subjects = [...new Set(current.map((entry) => entry.subject))];

    return subjects.flatMap((subject) =>
        (['web', 'mobile'] as const).flatMap((platform) => {
            const count = current.filter((entry) => entry.subject === subject && entry.platform === platform).length;

            return count === 1 ? [] : [`"${String(subject)}" has ${String(count)} current ${platform} canvases`];
        }),
    );
}

/** Every rule the README states about the registry, as broken-rule messages (empty when every rule holds). */
function registryProblems(entries: readonly CanvasEntry[]): readonly string[] {
    return [
        ...duplicates(
            entries.map((entry) => entry.id),
            'id',
        ),
        ...duplicates(
            entries.map((entry) => entry.url),
            'url',
        ),
        ...duplicates(
            entries.flatMap((entry) => (entry.folder === undefined ? [] : [entry.folder])),
            'folder',
        ),
        ...entries.flatMap(entryProblems),
        ...designSystemProblems(entries),
        ...pairingProblems(entries),
    ];
}

const registry = (): readonly CanvasEntry[] =>
    registrySchema.parse(JSON.parse(readFileSync(join(CANVAS_DIR, 'registry.json'), 'utf8'))).canvases;

const screen = (overrides: Partial<CanvasEntry>): CanvasEntry => ({
    id: 'homeWeb',
    title: 'Commise Screens, web: Home',
    url: 'https://claude.ai/artifact/CEyW2KKB5e5k4RWAWkmRBR',
    kind: 'page',
    status: 'current',
    source: 'repo-canvas',
    folder: overrides.id ?? 'homeWeb',
    platform: 'web',
    subject: 'Home',
    ...overrides,
});

const MOBILE_URL = 'https://claude.ai/artifact/RrYBCYnYTZe6p6i5uwvZQK';
const OTHER_URL = 'https://claude.ai/artifact/NgDDxhpxbSgQ48NZbsAWdv';

const designSystem: CanvasEntry = {
    id: 'designSystem',
    title: 'KitchenSink Design System',
    url: 'https://claude.ai/artifact/DN1aFbTBJKfW7bbgDdnzye',
    kind: 'designSystem',
    status: 'current',
    source: 'repo',
};

describe('the design canvas registry', () => {
    it('parses and keeps every rule its README states', () => {
        expect(registryProblems(registry())).toEqual([]);
    });

    // Each screen canvas's folder holds a record of the same canvas. A folder copied under the wrong entry fails by name.
    it('points every screen canvas at a folder whose snapshot.json records the same url', () => {
        const problems = registry()
            .filter(isScreen)
            .flatMap((entry) => {
                const record = join(CANVAS_DIR, entry.folder ?? entry.id, 'snapshot.json');

                if (!existsSync(record)) {
                    return [`${entry.id}: no snapshot.json in its folder`];
                }

                const { url } = snapshotSchema.parse(JSON.parse(readFileSync(record, 'utf8')));

                return url === entry.url ? [] : [`${entry.id}: snapshot.json records ${url}, not ${entry.url}`];
            });

        expect(problems).toEqual([]);
    });

    it('is named by the README that tells agents how to use it', () => {
        const readme = readFileSync(join(CANVAS_DIR, 'README.md'), 'utf8');

        expect(readme).toContain('registry.json');
        expect(readme).toContain('designCanvasRegistry.test.ts');
    });
});

describe('registryProblems', () => {
    const mobile = screen({ id: 'homeMobile', platform: 'mobile', url: MOBILE_URL });

    it('accepts one Design System and a web and mobile pair', () => {
        expect(registryProblems([designSystem, screen({}), mobile])).toEqual([]);
    });

    it('reports a current subject with no mobile canvas', () => {
        expect(registryProblems([designSystem, screen({})])).toEqual(['"Home" has 0 current mobile canvases']);
    });

    it('reports two current web canvases for one subject', () => {
        const second = screen({ id: 'homeWeb2', url: OTHER_URL });

        expect(registryProblems([designSystem, screen({}), second, mobile])).toEqual([
            '"Home" has 2 current web canvases',
        ]);
    });

    it('reports a link that is not a claude.ai artifact', () => {
        const broken = screen({ url: 'https://example.com/canvas' });

        expect(registryProblems([designSystem, broken, mobile])).toEqual([
            'homeWeb: not a claude.ai artifact link: https://example.com/canvas',
        ]);
    });

    it('reports a duplicated link', () => {
        const copy = screen({ id: 'homeMobile', platform: 'mobile' });

        expect(registryProblems([designSystem, screen({}), copy])).toEqual([
            'duplicate url: https://claude.ai/artifact/CEyW2KKB5e5k4RWAWkmRBR',
        ]);
    });

    it('reports a duplicated id', () => {
        const copy = screen({ platform: 'mobile', url: MOBILE_URL, folder: 'copy' });

        expect(registryProblems([designSystem, screen({}), copy])).toEqual(['duplicate id: homeWeb']);
    });

    it('reports a screen canvas with no subject', () => {
        const { subject: _subject, ...withoutSubject } = screen({ status: 'archive', platform: 'combined' });

        expect(
            registryProblems([
                designSystem,
                screen({}),
                mobile,
                { ...withoutSubject, id: 'x', folder: 'x', url: OTHER_URL },
            ]),
        ).toEqual(['x: a screen canvas needs a subject and a platform']);
    });

    it('reports a screen canvas with no folder, and a folder on a non-screen entry', () => {
        const noFolder = screen({ source: 'none', folder: undefined });
        const message = 'homeWeb: a screen canvas has source "repo-canvas" and a folder, and no other entry does';

        expect(registryProblems([designSystem, noFolder, mobile])).toEqual([message]);
        expect(registryProblems([designSystem, screen({ source: 'repo' }), mobile])).toEqual([message]);
        expect(registryProblems([{ ...designSystem, folder: 'designSystem' }, screen({}), mobile])).toEqual([
            'designSystem: a screen canvas has source "repo-canvas" and a folder, and no other entry does',
        ]);
    });

    it('reports a folder two entries share', () => {
        const twin = screen({ id: 'homeMobile', platform: 'mobile', url: MOBILE_URL });

        expect(registryProblems([designSystem, screen({}), { ...twin, folder: 'homeWeb' }])).toEqual([
            'duplicate folder: homeWeb',
        ]);
    });

    it('rejects a folder that is not one segment of letters and digits', () => {
        for (const folder of ['../x', 'a/b', 'a-b', '']) {
            expect(() => registrySchema.parse({ canvases: [screen({ folder })] })).toThrow();
        }
    });

    it('reports a missing or non-repo Design System', () => {
        const expected = ['there must be exactly one current Design System, with source "repo"'];

        expect(registryProblems([screen({}), mobile])).toEqual(expected);
        expect(registryProblems([{ ...designSystem, source: 'none' }, screen({}), mobile])).toEqual(expected);
    });

    it('reports a combined canvas marked current', () => {
        const combined = screen({ id: 'homeCombined', platform: 'combined', url: OTHER_URL });

        expect(registryProblems([designSystem, screen({}), mobile, combined])).toContain(
            'homeCombined: a combined canvas cannot be current',
        );
    });

    it('rejects an entry with an unknown status', () => {
        expect(() => registrySchema.parse({ canvases: [{ ...designSystem, status: 'draft' }] })).toThrow();
    });

    // A misspelt key ("plaform") would otherwise be dropped silently, and the entry would read as having no platform.
    it('rejects an entry or a registry with a key the README does not name', () => {
        expect(() => registrySchema.parse({ canvases: [{ ...designSystem, plaform: 'web' }] })).toThrow();
        expect(() => registrySchema.parse({ canvases: [designSystem], version: 2 })).toThrow();
    });
});
