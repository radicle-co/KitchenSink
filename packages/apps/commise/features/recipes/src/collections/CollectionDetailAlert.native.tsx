/**
 * @module @commise/features-recipes/collections — the native twin of the web `CollectionDetailAlert`: the line the
 * collection detail says when an action failed, as an alert in the body role and the danger text colour, like the web
 * `text-body text-danger-text`. It draws no side gutter: `CollectionDetailGutter` around it does.
 *
 * Presentational: props → JSX.
 */
import { Text } from '@commise/ui/text';
import type { FC } from 'react';

import type { CollectionDetailAlertProps } from './CollectionDetailAlert.js';

export const CollectionDetailAlert: FC<CollectionDetailAlertProps> = ({ text }) => (
    <Text role="alert" typeRole="body" color="$dangerText" paddingVertical="$2">
        {text}
    </Text>
);
