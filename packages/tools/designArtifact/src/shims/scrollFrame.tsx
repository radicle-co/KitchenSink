/**
 * @module scrollFrame — a pass-through over the native ScrollHost for markup that cannot pass a render-prop child. Its
 * children are written as markup and ignore the scroll binding, which a static artboard does not need.
 *
 * @pattern Adapter — turns the host's render-prop children into plain children
 */
import { ScrollHost, type ScrollHostProps } from '@commise/ui/scroll-host';
import type { FC, ReactNode } from 'react';

type Props = Omit<ScrollHostProps, 'children'> & { readonly children?: ReactNode };

/** The native ScrollHost with plain children. */
export const ScrollFrame: FC<Props> = ({ sections = [], activationOffset, headingId, children }) => (
    <ScrollHost sections={sections} activationOffset={activationOffset} headingId={headingId}>
        {() => children}
    </ScrollHost>
);
