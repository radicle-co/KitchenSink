/**
 * @module @commise/features-recipes/editor — the Ready line of Photos & publish (build spec §7.7 item 3): always
 * there, so the cook reads whether Publish will go through before pressing it. "Ready to publish." is plain text;
 * "Fix {n} things to publish" is a ghost button that takes the cook to the first section that needs it (SC 2.4.4).
 * The action bar's polite line is the one that announces, so this one is not a live region.
 *
 * Presentational: props → JSX. The native leaf is `./PublishLine.native.tsx`.
 */
import { Button } from '@commise/ui/button';
import type { FC } from 'react';

import type { ReadyLine } from './publishNote.js';
import type { EditorSectionId } from './sections.js';

/** Props for `PublishLine`. */
export interface PublishLineProps {
    readonly line: ReadyLine;
    /** Take the cook to a section. */
    readonly onJump: (section: EditorSectionId) => void;
}

/** The web Ready line. */
export const PublishLine: FC<PublishLineProps> = ({ line, onJump }) =>
    line.kind === 'ready' ? (
        <p className="text-caption text-ink-muted">{line.text}</p>
    ) : (
        <div>
            <Button variant="ghost" icon="triangleAlert" onPress={() => onJump(line.section)}>
                {line.text}
            </Button>
        </div>
    );
