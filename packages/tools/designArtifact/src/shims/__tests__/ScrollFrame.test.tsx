// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const seen = vi.hoisted(() => ({
    props: undefined as undefined | { sections?: readonly string[]; activationOffset?: number },
}));

vi.mock('@commise/ui/scroll-host', () => ({
    ScrollHost: (props: {
        sections?: readonly string[];
        activationOffset?: number;
        children: (bind: unknown) => ReactNode;
    }): ReactElement => {
        seen.props = { sections: props.sections, activationOffset: props.activationOffset };

        return <div data-testid="host">{props.children({})}</div>;
    },
}));

import { ScrollFrame } from '../scrollFrame.js';

describe('ScrollFrame', () => {
    it('hands the host a render-prop that returns the markup children, and forwards sections and offset', () => {
        render(
            <ScrollFrame sections={['a', 'b']} activationOffset={12}>
                <p>page</p>
            </ScrollFrame>,
        );

        expect(screen.getByTestId('host').textContent).toBe('page');
        expect(seen.props).toEqual({ sections: ['a', 'b'], activationOffset: 12 });
    });

    it('defaults to no sections', () => {
        render(
            <ScrollFrame>
                <p>page</p>
            </ScrollFrame>,
        );

        expect(seen.props?.sections).toEqual([]);
    });
});
