/**
 * @module EditorSection.card — the design-system card of the EditorSection: the current section with a header
 * action, and a section that is not current.
 */
import { defineCard } from '../../../../src/cards/defineCard.js';

const box = { background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 12, padding: 12 } as const;

export default defineCard({
    group: 'Editor',
    height: 420,
    platforms: 'both',
    uses: ['EditorSection', 'Button'],
    render: ({ EditorSection, Button }) => (
        <div className="col" style={{ gap: 28 }}>
            <EditorSection
                id="ingredients"
                title="Ingredients"
                current
                action={
                    <Button variant="ghost" size="sm">
                        Paste a list
                    </Button>
                }
            >
                <div style={box}>2 cups all-purpose flour</div>
            </EditorSection>
            <EditorSection id="method" title="Method" current={false}>
                <div style={box}>Whisk the eggs, then fold in the flour.</div>
            </EditorSection>
        </div>
    ),
});
