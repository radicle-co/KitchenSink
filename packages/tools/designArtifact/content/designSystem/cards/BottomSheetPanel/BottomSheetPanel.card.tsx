/**
 * @module BottomSheetPanel.card — the design-system card of BottomSheetPanel: a content-sized sheet with a footer,
 * and one with a search toolbar, each in a bottom-anchored stage. Native only.
 */
import type { CSSProperties } from 'react';

import { defineCard } from '../../../../src/cards/defineCard.js';

const noop = (): void => undefined;

const stageStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'flex-end',
    height: 400,
    borderRadius: 12,
    overflow: 'hidden',
    background: 'rgba(0,0,0,.4)',
    transform: 'translateZ(0)',
};

const rowStyle: CSSProperties = { padding: '12px 0', borderBottom: '1px solid var(--line)', fontSize: 16 };

export default defineCard({
    group: 'Overlays',
    height: 930,
    platforms: 'native',
    reason: 'the web sheet’s panel is SheetPanel, a different shape with different props.',
    uses: ['BottomSheetPanel', 'Button', 'SearchField'],
    render: ({ BottomSheetPanel, Button, SearchField }) => (
        <div className="col" style={{ gap: 16 }}>
            <div style={stageStyle}>
                <BottomSheetPanel
                    title="Add to collection"
                    closeLabel="Close add to collection"
                    size="content"
                    focusSignal={1}
                    reduceMotion
                    onClose={noop}
                    footer={
                        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                            <Button variant="secondary" icon="x" onPress={noop}>
                                Cancel
                            </Button>
                            <Button variant="primary" icon="plus" onPress={noop}>
                                Add recipe
                            </Button>
                        </div>
                    }
                >
                    <div style={rowStyle}>Sunday dinners</div>
                    <div style={rowStyle}>Weeknight pasta</div>
                    <div style={rowStyle}>Baking projects</div>
                </BottomSheetPanel>
            </div>
            <div style={stageStyle}>
                <BottomSheetPanel
                    title="Choose an ingredient"
                    closeLabel="Close ingredient picker"
                    size="content"
                    focusSignal={1}
                    reduceMotion
                    onClose={noop}
                    toolbar={{
                        heading: <div style={{ font: '600 17px Inter,system-ui' }}>Chicken</div>,
                        controls: (
                            <SearchField
                                id="bsp-s"
                                value="thigh"
                                onChangeText={noop}
                                label="Search ingredients"
                                clearLabel="Clear search"
                                labelVisibility="hidden"
                                placeholder="Search ingredients"
                            />
                        ),
                    }}
                >
                    <div style={rowStyle}>Chicken thighs, raw</div>
                    <div style={rowStyle}>Chicken thighs, roasted</div>
                    <div style={rowStyle}>Chicken thighs, skinless</div>
                </BottomSheetPanel>
            </div>
        </div>
    ),
});
