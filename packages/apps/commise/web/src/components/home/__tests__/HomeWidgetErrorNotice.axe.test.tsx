// @vitest-environment jsdom
/**
 * The web axe check on a web-owned component: the Home widget's failure notice has no accessibility violation. The
 * rule set comes from the one shared helper, so this file states none of its own.
 */
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { renderWithProviders } from '@commise/test-utils';
import { axe } from '@commise/ui/testing/axe';

import { HomeWidgetErrorNotice } from '../HomeWidgetErrorNotice';

afterEach(cleanup);

describe('HomeWidgetErrorNotice (web), accessibility', () => {
    it('has no axe violation', async () => {
        const { container } = renderWithProviders(<HomeWidgetErrorNotice />);

        expect(await axe(container)).toHaveNoViolations();
    });

    it('is caught when a sibling breaks a rule, so the web tier can fail', async () => {
        const { container } = renderWithProviders(
            <>
                <HomeWidgetErrorNotice />
                <img src="/x.png" />
            </>,
        );
        const results = await axe(container);

        expect(() => expect(results).toHaveNoViolations()).toThrow(/image-alt/u);
    });
});
