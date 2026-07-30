import { afterEach, describe, expect, it, vi } from 'vitest';

import { derivePreviewBasePath } from '../../src/lib/basePath';

describe('derivePreviewBasePath', () => {
    it('derives /pr-{N} from VERCEL_GIT_PULL_REQUEST_ID', () => {
        expect(derivePreviewBasePath({ VERCEL_GIT_PULL_REQUEST_ID: '123' })).toBe('/pr-123');
    });

    it('prefers an explicit PREVIEW_BASE_PATH (off-Vercel builds)', () => {
        expect(derivePreviewBasePath({ PREVIEW_BASE_PATH: '/pr-7', VERCEL_GIT_PULL_REQUEST_ID: '9' })).toBe('/pr-7');
    });

    it('returns empty string in production (neither set)', () => {
        expect(derivePreviewBasePath({})).toBe('');
    });

    // ── ADR-0001 subdomain cutover: SANDBOX_PREVIEW_MODE=subdomain serves each preview at ROOT ──
    it('returns empty string in subdomain mode even with a PR id (previews serve at root)', () => {
        expect(derivePreviewBasePath({ SANDBOX_PREVIEW_MODE: 'subdomain', VERCEL_GIT_PULL_REQUEST_ID: '123' })).toBe(
            '',
        );
    });

    it('subdomain mode also overrides an explicit PREVIEW_BASE_PATH (mode is the authoritative cutover switch)', () => {
        expect(derivePreviewBasePath({ SANDBOX_PREVIEW_MODE: 'subdomain', PREVIEW_BASE_PATH: '/pr-7' })).toBe('');
    });

    it('still derives /pr-{N} when the mode is explicitly path (default posture, unchanged)', () => {
        expect(derivePreviewBasePath({ SANDBOX_PREVIEW_MODE: 'path', VERCEL_GIT_PULL_REQUEST_ID: '123' })).toBe(
            '/pr-123',
        );
    });

    it('treats an unknown/mistyped mode as path (fail-safe to the current posture)', () => {
        expect(derivePreviewBasePath({ SANDBOX_PREVIEW_MODE: 'subdomainn', VERCEL_GIT_PULL_REQUEST_ID: '123' })).toBe(
            '/pr-123',
        );
    });
});

describe('withBasePath', () => {
    afterEach(() => {
        delete process.env['NEXT_PUBLIC_BASE_PATH'];
        vi.resetModules();
    });

    async function loadWith(basePath: string | undefined) {
        vi.resetModules();

        if (basePath === undefined) {
            delete process.env['NEXT_PUBLIC_BASE_PATH'];
        } else {
            process.env['NEXT_PUBLIC_BASE_PATH'] = basePath;
        }

        return import('../../src/lib/basePath');
    }

    it('prefixes an absolute path when a base path is set', async () => {
        const { withBasePath } = await loadWith('/pr-123');

        expect(withBasePath('/sign-in')).toBe('/pr-123/sign-in');
    });

    it('is a no-op in production (empty base path)', async () => {
        const { withBasePath } = await loadWith('');

        expect(withBasePath('/sign-in')).toBe('/sign-in');
    });

    it('tolerates a path without a leading slash (no double slash)', async () => {
        const { withBasePath } = await loadWith('/pr-1');

        expect(withBasePath('sign-in')).toBe('/pr-1/sign-in');
    });
});
