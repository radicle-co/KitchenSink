/**
 * @module fixtures/ClassBoundary — a CLASS component, the shape an error boundary takes. It names a component, so the
 * per-file coverage guard asks it for one (`exportsAComponentName`) rather than exempting it as an element factory.
 */
import { Component, type ReactNode } from 'react';

/** A class component. */
export class ClassBoundary extends Component<{ readonly children?: ReactNode }> {
    override render(): ReactNode {
        return <div>{this.props.children}</div>;
    }
}
