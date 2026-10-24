/**
 * The Home appShell container factory both apps build their singleton with (it was written out identically in web and
 * mobile). The factory owns two facts: the reporter is bound under `errorReporterToken` (DA9) so the widget boundaries
 * resolve the SAME seam in production that tests bind a fake onto, and every supplied feature registers, in order.
 */
import { describe, expect, it, vi } from 'vitest';

import { errorReporterToken, registerHomeWidget, resolveErrorReporter, resolveHomeWidgets } from '../../appShell.js';
import type { AddFeature } from '../../appShell.js';
import type { HomeWidgetDescriptor } from '../../contract.js';
import { createHomeContainer } from '../createHomeContainer.js';

const descriptorOf = (id: string): HomeWidgetDescriptor => ({
    id,
    load: () => Promise.resolve({ default: null }),
    defaultWeight: 1,
    capability: id,
});

const featureOf =
    (id: string): AddFeature =>
    (container) => {
        registerHomeWidget(container, descriptorOf(id));
    };

describe('createHomeContainer', () => {
    it('binds the supplied reporter under errorReporterToken', () => {
        const errorReporter = vi.fn();
        const container = createHomeContainer({ features: [], errorReporter });

        expect(container.get(errorReporterToken)).toBe(errorReporter);
        expect(resolveErrorReporter(container)).toBe(errorReporter);
    });

    it('applies every feature registration, in order', () => {
        const container = createHomeContainer({
            features: [featureOf('a'), featureOf('b'), featureOf('c')],
            errorReporter: vi.fn(),
        });

        expect(resolveHomeWidgets(container).map((descriptor) => descriptor.id)).toEqual(['a', 'b', 'c']);
    });

    it('builds an isolated container per call (no shared mutable state)', () => {
        const first = createHomeContainer({ features: [featureOf('a')], errorReporter: vi.fn() });
        const second = createHomeContainer({ features: [], errorReporter: vi.fn() });

        expect(resolveHomeWidgets(first)).toHaveLength(1);
        expect(resolveHomeWidgets(second)).toHaveLength(0);
    });
});
