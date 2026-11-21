/**
 * The label read from the words in front of a line's one duration (S3a.U3 C1 item 5, AR4; po P23). The table is the
 * designer's to confirm and amend (reviews/0021-S3aU3-eng1.md). Cases beyond it pin each rule of the reader.
 */
import { describe, expect, it } from 'vitest';

import { lineLabelOf } from '../lineLabel.js';

describe('lineLabelOf', () => {
    it.each([
        ['Roast 20 min', 'Roast'],
        ['Bake for about 25 minutes', 'Bake'],
        ['Simmer, covered, for 10 to 15 minutes', 'Simmer'],
        ['Preheat the oven. Roast 1 h 30', 'Roast'],
        ['After 5 minutes, flip', undefined],
        ['20 minutes', undefined],
        ['Cook for an hour and a half', 'Cook'],
        ['Bake 20 min, then 10 min more', undefined],
    ])('%s gives %s', (line, label) => {
        expect(lineLabelOf(line)).toBe(label);
    });

    it.each([
        ['cuts the text before the span after the last full stop', 'Mix well. Stir gently. Cook 10 min', 'Cook'],
        ['cuts after an exclamation mark', 'Stir! Rest 10 min', 'Rest'],
        ['cuts after a question mark', 'Done? Rest 10 min', 'Rest'],
        ['cuts after a semicolon', 'Salt the water; boil 10 min', 'Boil'],
        ['keeps a comma inside a label of several words', 'Fry the onions, garlic, 5 min', 'Fry the onions, garlic'],
        ['drops several trailing connectors, in any case', 'Bake FOR ABOUT 25 minutes', 'Bake'],
        ['drops connectors one after another', 'Simmer for another 10 minutes', 'Simmer'],
        ['drops "until" and "within"', 'Chill until 2 hours', 'Chill'],
        ['upper-cases the first letter only', 'slow roast 3 hours', 'Slow roast'],
        ['gives none when only connectors are left', 'For about 10 minutes', undefined],
        ['gives none when only punctuation is left', '... 10 minutes', undefined],
        ['reads a word duration', 'Whisk for ten minutes', 'Whisk'],
        ['keeps a word that only starts like a connector', 'Rest the andouille 10 minutes', 'Rest the andouille'],
        ['gives none for a line with no duration', 'Stir the sauce', undefined],
        ['gives none for two durations', 'Bake 10 min and rest 5 min', undefined],
        // D80 (designer, 2026-11-20): "then" ends a clause like a full stop.
        ['cuts after the last "then"', 'Mix, then roast 20 min', 'Roast'],
        [
            'cuts after "then", in any case, and leaves nothing when nothing follows',
            'Stir and Then 10 minutes more',
            undefined,
        ],
        [
            'cuts after "then" in the designer\'s example',
            'Bring the water to a boil, then cook the pasta 10 minutes',
            'Cook the pasta',
        ],
        // D80: one word before the first comma is the label.
        ['takes the one word before the first comma', 'Simmer, covered, for 10 minutes', 'Simmer'],
        // D80: four words at most, and a label is never cut to fit.
        ['keeps a label of four words', 'Bake the loaf slowly 20 min', 'Bake the loaf slowly'],
        ['gives none for a label of five words', 'Bake the whole loaf slowly 20 min', undefined],
        // qse: a connector glued to a digit is part of a measure, not a connector.
        ['keeps a connector glued to a digit', 'Cut into 2in 10 min', 'Cut into 2in'],
        // Staff, 2026-11-20: a stop that is not a sentence end.
        ['does not cut at a decimal point', 'Bake at 180.5 degrees for 20 min', 'Bake at 180.5 degrees'],
        ['does not cut at an abbreviation', 'Simmer approx. 20 min', 'Simmer'],
    ])('%s', (_name, line, label) => {
        expect(lineLabelOf(line)).toBe(label);
    });

    it.each([
        'for',
        'about',
        'around',
        'roughly',
        'approximately',
        'another',
        'further',
        'more',
        'a',
        'an',
        'in',
        'after',
        'within',
        'over',
        'until',
        'or',
        'and',
        'approx',
    ])('drops the connector "%s" in front of the time', (word) => {
        expect(lineLabelOf(`Bake ${word} 10 minutes`)).toBe('Bake');
    });
});
