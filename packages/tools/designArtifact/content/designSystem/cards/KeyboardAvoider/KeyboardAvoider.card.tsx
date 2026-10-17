/**
 * @module KeyboardAvoider.card — the design-system card of the KeyboardAvoider: a note form in a phone frame, at
 * rest. Native only.
 */
import { useState } from 'react';

import { defineCard } from '../../../../src/cards/defineCard.js';

export default defineCard({
    group: 'Layout',
    height: 530,
    platforms: 'native',
    reason: 'a web page is resized by the browser when the keyboard opens. react-native-web has no keyboard, so this shows the resting state; on a device the form is padded up by the part of it the keyboard covers.',
    uses: ['KeyboardAvoider', 'Input', 'Button'],
    render: ({ KeyboardAvoider, Input, Button }) => {
        function Form() {
            const [note, setNote] = useState('');

            return (
                <KeyboardAvoider style={{ flex: 1 }}>
                    <div
                        style={{
                            flex: 1,
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'flex-end',
                            gap: 12,
                            padding: 16,
                        }}
                    >
                        <Input
                            id="note"
                            label="Recipe note"
                            value={note}
                            onChangeText={setNote}
                            placeholder="Less salt next time"
                        />
                        <Button variant="primary" icon="save">
                            Save note
                        </Button>
                    </div>
                </KeyboardAvoider>
            );
        }

        return (
            <div
                style={{
                    border: '1px solid var(--line-divider)',
                    borderRadius: 24,
                    background: 'var(--canvas)',
                    overflow: 'hidden',
                    height: 360,
                    display: 'flex',
                    flexDirection: 'column',
                }}
            >
                <Form />
            </div>
        );
    },
});
