/** The guards that must name the registered mobile screens ask the selector, so the two cannot disagree. */
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { registeredMobileScreens } from '../src/registeredMobileScreens.js';
import { loadRepoModels } from '../src/repoModels.js';

const repo = resolve(import.meta.dirname, '../../../..');

describe('registeredMobileScreens over the real tree', () => {
    it('is the screen list of the selector’s own mobile model', async () => {
        const [screens, models] = await Promise.all([registeredMobileScreens(repo), loadRepoModels(repo)]);

        expect(screens.length).toBeGreaterThanOrEqual(10);
        expect(screens).toContain('HomeScreen');
        expect(screens).toEqual(models.mobile.screens);
    });
});
