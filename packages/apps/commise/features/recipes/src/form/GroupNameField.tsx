'use client';

/**
 * @module @commise/features-recipes/form — `GroupNameField` (web): the inline name field of "+ Add a group" and Rename
 * group (build spec §7.5.5): a labelled field, Save and Cancel. Enter saves; Escape cancels. It takes focus as it shows.
 *
 * Presentational: `props → JSX` over the field's view (`GroupNameFieldView`).
 */
import { Button } from '@commise/ui/button';
import { FieldLabel, Input } from '@commise/ui/input';
import type { FC } from 'react';

import type { GroupNameFieldView } from './useIngredientGroups.js';

/** The inline group-name field. */
export const GroupNameField: FC<{ readonly field: GroupNameFieldView }> = ({ field }) => (
    <div
        className="flex flex-col gap-2"
        onKeyDown={(event) => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                field.onCancel();
            }
        }}
    >
        <FieldLabel forId={field.id} label={field.label} />
        <Input
            id={field.id}
            value={field.value}
            onChangeText={field.onChange}
            onSubmit={field.onSubmit}
            enterKeyHint="done"
            autoCapitalize="sentences"
            focusRequested={field.focusRequested}
            onFocusRequestHandled={field.onFocusRequestHandled}
        />
        <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onPress={field.onCancel}>
                {field.cancelLabel}
            </Button>
            <Button variant="secondary" icon="check" onPress={field.onSubmit}>
                {field.saveLabel}
            </Button>
        </div>
    </div>
);
