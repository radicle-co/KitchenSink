import { existsSync, statSync } from 'node:fs';
import { basename } from 'node:path';

import { describe, expect, it } from 'vitest';

import { isDesignArtifactError } from '../../errors.js';
import { fontFaces } from '../fontFaces.js';
import { fontFiles, fontLicences } from '../fontFiles.js';

describe('fontFiles', () => {
    const files = fontFiles();

    it('resolves a real font file for every registration', () => {
        expect(files).toHaveLength(fontFaces().length);

        for (const file of files) {
            expect(file.source.startsWith('/'), file.source).toBe(true);
            expect(existsSync(file.source), file.source).toBe(true);
            expect(statSync(file.source).size, file.source).toBeGreaterThan(10_000);
            expect(basename(file.source)).toBe(file.file);
            expect(file.file.endsWith('.ttf')).toBe(true);
        }
    });

    it('registers the families and the native names the components ask for', () => {
        const registered = files.map((file) => `${file.family}@${file.weight}`);

        expect(registered).toContain('Inter@400');
        expect(registered).toContain('Inter@700');
        expect(registered).toContain('Inter_400Regular@400');
        expect(registered).toContain('Playfair Display@600');
        expect(registered).toContain('PlayfairDisplay_700Bold@400');
    });

    it('raises missing-font when a font cannot be resolved', () => {
        const resolver = (): string => {
            throw new Error('Cannot find module');
        };

        expect(() => fontFiles(resolver)).toThrow(/Inter/);

        try {
            fontFiles(resolver);
        } catch (error) {
            expect(isDesignArtifactError(error) && error.code).toBe('missing-font');
        }
    });

    it('raises missing-font when the resolved file is not on disk', () => {
        const resolver = (): string => 'file:///nowhere/at/all.ttf';

        try {
            fontFiles(resolver);
            expect.unreachable('fontFiles must throw');
        } catch (error) {
            expect(isDesignArtifactError(error) && error.code).toBe('missing-font');
        }
    });
});

describe('fontLicences', () => {
    it('ships the SIL Open Font Licence text of both families', () => {
        const licences = fontLicences();

        expect(licences.map((licence) => licence.file).sort()).toEqual(['OFL-Inter.txt', 'OFL-PlayfairDisplay.txt']);

        for (const licence of licences) {
            expect(existsSync(licence.source), licence.source).toBe(true);
        }
    });

    it('raises missing-font when a licence cannot be resolved', () => {
        const resolver = (): string => {
            throw new Error('Cannot find module');
        };

        try {
            fontLicences(resolver);
            expect.unreachable('fontLicences must throw');
        } catch (error) {
            expect(isDesignArtifactError(error) && error.code).toBe('missing-font');
        }
    });
});
