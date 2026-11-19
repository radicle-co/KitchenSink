/**
 * The default host ports `stackPorts` publishes agree with the ports the services themselves default to. Two sources
 * name each port (the table here and `PORT: ...default(n)` in the service's own config), and `localPortFor` reads the
 * second one off the real source. A service that changes its default fails here, instead of compose publishing the
 * new port while the clash check and the `stack:` line keep the old one.
 */
import { describe, expect, it } from 'vitest';

import { localPortFor } from '../bin/adapters.js';
import { defaultPortOf } from '../src/stackPorts.js';

describe('the default host ports', () => {
    it.each([
        ['recipes', 'packages/services/recipe-service'],
        ['identity', 'packages/services/identity'],
        ['food', 'packages/services/food-service'],
    ])('%s publishes the port its service listens on by default', (service, packageDir) => {
        expect(localPortFor(packageDir)).toBe(defaultPortOf(service));
    });
});
