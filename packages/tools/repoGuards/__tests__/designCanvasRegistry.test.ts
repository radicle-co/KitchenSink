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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const CANVAS_DIR = join(__dirname, '..', '..', '..', '..', 'docs', 'design', 'canvases');

const STATUSES = ['current', 'archive', 'unused'] as const;
const SOURCES = ['repo', 'live', 'none'] as const;
const KINDS = ['designSystem', 'page', 'feature', 'unused'] as const;
const PLATFORMS = ['web', 'mobile', 'combined'] as const;

/** A claude.ai artifact link with its 22-character id. */
const ARTIFACT_URL = /^https:\/\/claude\.ai\/artifact\/[A-Za-z0-9]{22}$/;

interface CanvasEntry {
    readonly id: string;
    readonly title: string;
    readonly url: string;
    readonly kind: (typeof KINDS)[number];
    readonly status: (typeof STATUSES)[number];
    readonly source: (typeof SOURCES)[number];
    readonly platform?: (typeof PLATFORMS)[number];
    readonly subject?: string;
}

const isOneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
    typeof value === 'string' && (values as readonly string[]).includes(value);

/** Parses the registry file, throwing on any entry that does not fit the shape the README documents. */
function parseRegistry(text: string): readonly CanvasEntry[] {
    const parsed: unknown = JSON.parse(text);

    if (typeof parsed !== 'object' || parsed === null || !('canvases' in parsed) || !Array.isArray(parsed.canvases)) {
        throw new Error('registry.json must be an object with a "canvases" array');
    }

    return parsed.canvases.map((raw: unknown, index): CanvasEntry => {
        if (typeof raw !== 'object' || raw === null) {
            throw new Error(`entry ${index} is not an object`);
        }
        const entry = raw as Record<string, unknown>;

        for (const field of ['id', 'title', 'url'] as const) {
            if (typeof entry[field] !== 'string' || entry[field] === '') {
                throw new Error(`entry ${index} has no ${field}`);
            }
        }
        if (!isOneOf(KINDS, entry['kind'])) {
            throw new Error(`entry ${index} has an unknown kind`);
        }
        if (!isOneOf(STATUSES, entry['status'])) {
            throw new Error(`entry ${index} has an unknown status`);
        }
        if (!isOneOf(SOURCES, entry['source'])) {
            throw new Error(`entry ${index} has an unknown source`);
        }
        if (entry['platform'] !== undefined && !isOneOf(PLATFORMS, entry['platform'])) {
            throw new Error(`entry ${index} has an unknown platform`);
        }

        return {
            id: entry['id'] as string,
            title: entry['title'] as string,
            url: entry['url'] as string,
            kind: entry['kind'],
            status: entry['status'],
            source: entry['source'],
            platform: entry['platform'] as CanvasEntry['platform'],
            subject: typeof entry['subject'] === 'string' ? entry['subject'] : undefined,
        };
    });
}

/** Every rule the README states about the registry, as a list of broken-rule messages (empty when it holds). */
function registryProblems(entries: readonly CanvasEntry[]): readonly string[] {
    const problems: string[] = [];
    const seen = (values: readonly string[], what: string): void => {
        const duplicates = values.filter((value, index) => values.indexOf(value) !== index);

        if (duplicates.length > 0) {
            problems.push(`duplicate ${what}: ${duplicates.join(', ')}`);
        }
    };

    seen(
        entries.map((entry) => entry.id),
        'id',
    );
    seen(
        entries.map((entry) => entry.url),
        'url',
    );

    for (const entry of entries) {
        if (!ARTIFACT_URL.test(entry.url)) {
            problems.push(`${entry.id}: not a claude.ai artifact link: ${entry.url}`);
        }
        if ((entry.kind === 'page' || entry.kind === 'feature') && (entry.subject === undefined || !entry.platform)) {
            problems.push(`${entry.id}: a screen canvas needs a subject and a platform`);
        }
        if (entry.status === 'current' && entry.platform === 'combined') {
            problems.push(`${entry.id}: a combined canvas cannot be current`);
        }
    }

    const designSystems = entries.filter((entry) => entry.kind === 'designSystem');

    if (designSystems.length !== 1 || designSystems[0]?.source !== 'repo' || designSystems[0].status !== 'current') {
        problems.push('there must be exactly one current Design System, with source "repo"');
    }

    const currentScreens = entries.filter(
        (entry) => entry.status === 'current' && (entry.kind === 'page' || entry.kind === 'feature'),
    );
    const subjects = [...new Set(currentScreens.map((entry) => entry.subject ?? ''))];

    for (const subject of subjects) {
        for (const platform of ['web', 'mobile'] as const) {
            const count = currentScreens.filter(
                (entry) => entry.subject === subject && entry.platform === platform,
            ).length;

            if (count !== 1) {
                problems.push(`"${subject}" has ${count} current ${platform} canvases; it needs exactly one`);
            }
        }
    }
    for (const entry of currentScreens) {
        if (entry.source !== 'live') {
            problems.push(`${entry.id}: a current screen canvas has source "live"`);
        }
    }

    return problems;
}

const registry = (): readonly CanvasEntry[] => parseRegistry(readFileSync(join(CANVAS_DIR, 'registry.json'), 'utf8'));

const screen = (overrides: Partial<CanvasEntry>): CanvasEntry => ({
    id: 'homeWeb',
    title: 'Commise Screens, web: Home',
    url: 'https://claude.ai/artifact/CEyW2KKB5e5k4RWAWkmRBR',
    kind: 'page',
    status: 'current',
    source: 'live',
    platform: 'web',
    subject: 'Home',
    ...overrides,
});

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

    it('is named by the README that tells agents how to use it', () => {
        const readme = readFileSync(join(CANVAS_DIR, 'README.md'), 'utf8');

        expect(readme).toContain('registry.json');
        expect(readme).toContain('designCanvasRegistry.test.ts');
    });
});

describe('registryProblems', () => {
    const mobile = screen({ id: 'homeMobile', platform: 'mobile', url: 'https://claude.ai/artifact/RrYBCYnYTZe6p6i5uwvZQK' });

    it('accepts one Design System and a web and mobile pair', () => {
        expect(registryProblems([designSystem, screen({}), mobile])).toEqual([]);
    });

    it('reports a current subject with no mobile canvas', () => {
        expect(registryProblems([designSystem, screen({})])).toEqual([
            '"Home" has 0 current mobile canvases; it needs exactly one',
        ]);
    });

    it('reports two current web canvases for one subject', () => {
        const second = screen({ id: 'homeWeb2', url: 'https://claude.ai/artifact/NgDDxhpxbSgQ48NZbsAWdv' });

        expect(registryProblems([designSystem, screen({}), second, mobile])).toEqual([
            '"Home" has 2 current web canvases; it needs exactly one',
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

    it('reports a missing or live-sourced Design System', () => {
        expect(registryProblems([screen({}), mobile])).toEqual([
            'there must be exactly one current Design System, with source "repo"',
        ]);
        expect(registryProblems([{ ...designSystem, source: 'live' }, screen({}), mobile])).toEqual([
            'there must be exactly one current Design System, with source "repo"',
        ]);
    });

    it('reports a combined canvas marked current', () => {
        const combined = screen({ id: 'homeCombined', platform: 'combined', url: 'https://claude.ai/artifact/NgDDxhpxbSgQ48NZbsAWdv' });

        expect(registryProblems([designSystem, screen({}), mobile, combined])).toContain(
            'homeCombined: a combined canvas cannot be current',
        );
    });

    it('rejects an entry with an unknown status', () => {
        expect(() => parseRegistry(JSON.stringify({ canvases: [{ ...designSystem, status: 'draft' }] }))).toThrow(
            'entry 0 has an unknown status',
        );
    });
});
