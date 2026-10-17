"""How much precision do recipe authors already WRITE into an ingredient line, and in whose words?

⛔ WHY THIS FILE EXISTS. `docs/design/ingredientSpecialization.md` has to decide where a cook adds depth to an
ingredient ("80/20 ground beef", "boneless chicken thighs", "canned tomatoes"). If authors already write that
depth into the line, the natural entry point is the line itself, and a separate "add details" control is a
fallback. If they do not, the control is the only way in. This measures which it is, and whether the words
authors use are the words USDA's catalog uses.

CORPUS. The New York Times Cooking ingredient snapshot (2015), 179,207 tagged lines, released under Apache 2.0
with `nytimes/ingredient-phrase-tagger` (README: "License: Apache 2.0"). OPERATOR-DOWNLOADED to the scratchpad
and never committed, the same posture as the Gutenberg corpus in CLAUDE.md. ⚠️ BIAS, stated once: these are
professionally edited recipes. A home cook typing into an app writes LESS precision than an NYT editor, so every
"authors write X" share below is an UPPER bound for this app's typed lines. Imported recipes from published
sources sit closer to it.

METHOD. Word patterns over the lowercased `input` column, counted over DISTINCT lines (the corpus repeats lines
such as "Salt to taste"). A pattern is a descriptive tally, not a parser: it answers "how often does this kind
of word appear", never "what did this line mean".

Run: python3 recipeLinePrecision.py [path to nytIngredients.csv]
"""

import csv
import re
import sys
from collections import Counter

CORPUS = sys.argv[1] if len(sys.argv) > 1 else (
    '/tmp/claude-1000/-home-brandon-Development-KitchenSink/bbe8f514-fa60-456a-939f-f34f2867d6d5/scratchpad/'
    'nytIngredients.csv')

# What a cook buys. Each axis is a thing a shopper chooses at the shelf.
PURCHASE_AXES = {
    'fat ratio or leanness': r'\b\d{2}\s*/\s*\d{2}\b|\b\d{2}\s*(?:%|percent)\s*(?:lean|fat)\b|\bextra[- ]lean\b|\blean\b',
    'bone or skin': r'\bboneless\b|\bbone[- ]in\b|\bskinless\b|\bskin[- ]on\b|\bwith (?:the )?skin\b',
    'form or pack': r'\bcanned\b|\bfrozen\b|\bfresh\b|\bdried\b|\bjarred\b|\bin (?:heavy |light )?syrup\b'
                    r'|\bpacked in\b|\bin (?:its own )?juice\b|\boil[- ]packed\b|\bwater[- ]packed\b',
    'salt': r'\bunsalted\b|\bsalted\b|\blow[- ]sodium\b|\breduced[- ]sodium\b|\bno[- ]salt[- ]added\b',
    'dairy fat level': r'\bwhole milk\b|\bskim\b|\bnon[- ]?fat\b|\blow[- ]?fat\b|\breduced[- ]fat\b|\bpart[- ]skim\b'
                       r'|\bfull[- ]fat\b|\b[12] ?(?:%|percent)\b',
    'size': r'\b(?:extra[- ])?large\b|\bmedium\b|\bsmall\b|\bjumbo\b',
}
# The ingredient is ALREADY cooked when it goes into this recipe.
ALREADY_COOKED = r'\bcooked\b|\bleftover\b|\bprecooked\b|\bpre-cooked\b'
# Words only a food-composition table uses. A cook who writes one of these is quoting a label.
USDA_ANALYSIS = (r'\bseparable\b|\bunheated\b|\bwater added\b|\bnatural juices\b|\ball grades\b'
                 r'|\btrimmed to\b|\bsolids and liquids\b|\bdrained solids\b|\bwith added\b|\bdistribution program\b')

FOODS = {
    'ground beef or chuck': (r'\bground (?:beef|chuck|sirloin|round)\b', 'fat ratio or leanness'),
    'ham': (r'\bham\b', None),
    'chicken breast or thigh': (r'\bchicken (?:breasts?|thighs?)\b', 'bone or skin'),
    'tomatoes': (r'\btomato(?:es)?\b', 'form or pack'),
    'milk': (r'\bmilk\b', 'dairy fat level'),
    'butter': (r'\bbutter\b', 'salt'),
}


def has(pattern, text):
    """True when the pattern occurs in the text. Pure."""
    return re.search(pattern, text) is not None


def main():
    lines = sorted({(row.get('input') or '').strip().lower()
                    for row in csv.DictReader(open(CORPUS, encoding='utf-8', errors='replace'))} - {''})
    total = len(lines)
    pct = lambda n, d=total: f'{100 * n / d:5.1f}%'

    print('=' * 88)
    print(f'1. DISTINCT ingredient lines: {total}')
    print('=' * 88)
    any_purchase = 0
    for axis, pattern in PURCHASE_AXES.items():
        n = sum(1 for line in lines if has(pattern, line))
        print(f'  {axis:<26}: {pct(n)}  ({n})')
    any_purchase = sum(1 for line in lines if any(has(p, line) for p in PURCHASE_AXES.values()))
    print(f'  ⛔ ANY purchase attribute   : {pct(any_purchase)}  ({any_purchase})')
    cooked = sum(1 for line in lines if has(ALREADY_COOKED, line))
    usda = [line for line in lines if has(USDA_ANALYSIS, line)]
    print(f'  already cooked when added  : {pct(cooked)}  ({cooked})')
    print(f'  ⛔ a USDA analysis word     : {pct(len(usda))}  ({len(usda)})')
    for line in usda[:6]:
        print(f'       e.g. {line[:90]}')

    print('\n' + '=' * 88)
    print('2. PER FOOD — how often the line already names the axis a catalog would ask about')
    print('=' * 88)
    for food, (pattern, axis) in FOODS.items():
        hits = [line for line in lines if has(pattern, line)]
        if not hits:
            continue
        words = Counter()
        for line in hits:
            for name, p in PURCHASE_AXES.items():
                if has(p, line):
                    words[name] += 1
        stated = sum(1 for line in hits if axis and has(PURCHASE_AXES[axis], line))
        cooked_here = sum(1 for line in hits if has(ALREADY_COOKED, line))
        print(f'  {food:<24} lines {len(hits):>5}'
              + (f' · states {axis}: {pct(stated, len(hits))}' if axis else '')
              + f' · already cooked: {pct(cooked_here, len(hits))}')
        print('      axes present: ' + ', '.join(f'{k} {100 * v / len(hits):.0f}%' for k, v in words.most_common(4)))
        if food == 'ham':
            for line in hits[:0]:
                print(f'       {line}')
    ham = [line for line in lines if has(r'\bham\b', line)]
    print('  ham — words beside "ham" that name WHICH ham (top 12):')
    context = Counter()
    for line in ham:
        for word in re.findall(r'[a-z][a-z-]+', line):
            if word not in {'ham', 'cup', 'cups', 'pound', 'pounds', 'ounces', 'ounce', 'about', 'into', 'and', 'or',
                            'the', 'a', 'of', 'cut', 'inch', 'diced', 'chopped', 'thinly', 'sliced', 'finely',
                            'slices', 'slice', 'minced', 'to', 'for', 'in', 'with', 'optional', 'thin', 'small',
                            'pieces', 'piece', 'strips', 'cubes', 'dice', 'coarsely', 'julienned', 'trimmed'}:
                context[word] += 1
    print('      ' + ', '.join(f'{w} {n}' for w, n in context.most_common(12)))


if __name__ == '__main__':
    main()
