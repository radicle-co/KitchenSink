"""Builds the two S2 boards (Luna plan 0001 U5; Stellar plan 0100 design part; Luna designer D16-D18).
Writes CookingModeIngredientsS2Mobile.dc.html and CookingModeIngredientsS2Web.dc.html next to this script.
Run: python3 -I buildS2Boards.py
"""
import sys
from pathlib import Path

HERE = Path(__file__).parent
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.cwd()  # the folder the boards are written to
THEMES = (HERE / 'themes.css').read_text()
NB = ' '

GLYPH = {  # Lucide shapes, registered meanings (listChecks: decisions/0068 in Stellar)
    'close': '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>',
    'chevronDown': '<path d="m6 9 6 6 6-6"></path>',
    'listChecks': '<path d="m3 17 2 2 4-4"></path><path d="m3 7 2 2 4-4"></path><path d="M13 6h8"></path>'
    '<path d="M13 12h8"></path><path d="M13 18h8"></path>',
    'minus': '<path d="M5 12h14"></path>',
    'plus': '<path d="M5 12h14"></path><path d="M12 5v14"></path>',
    'check': '<path d="M20 6 9 17l-5-5"></path>',
    'alert': '<circle cx="12" cy="12" r="10"></circle><line x1="12" x2="12" y1="8" y2="12"></line>'
    '<line x1="12" x2="12.01" y1="16" y2="16"></line>',
    'back': '<path d="M15 6l-6 6 6 6"></path>',
    'next': '<path d="M9 6l6 6-6 6"></path>',
}


def svg(name, size=20, sw=2):
    return (
        f'<svg class="g" aria-hidden="true" width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" '
        f'stroke="currentColor" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round">{GLYPH[name]}</svg>'
    )


CSS = """
body { margin: 0; background: #e4e8ec; font-family: Inter, system-ui, sans-serif; color: #171b20; }
* { box-sizing: border-box; margin: 0; padding: 0; }
button { font: inherit; color: inherit; background: none; border: 0; text-align: left; cursor: pointer; }
.sheetBoard { padding: 48px; }
.boardTitle { font: 600 28px/32px Manrope, Inter, sans-serif; margin-bottom: 8px; }
.boardNote { font-size: 16px; line-height: 24px; color: #5c646e; max-width: 1100px; margin-bottom: 40px; }
section { margin-bottom: 56px; }
.secTitle { font-size: 18px; line-height: 24px; font-weight: 600; margin-bottom: 16px; }
.row { display: flex; flex-wrap: wrap; gap: 40px; align-items: flex-start; }
figure { display: flex; flex-direction: column; gap: 10px; }
figcaption { font-size: 14px; line-height: 20px; color: #5c646e; max-width: 420px; }
figcaption b { color: #171b20; font-weight: 600; }
/* A screen. Heights are the device's; content that does not fit scrolls (shown clipped). */
.scr { background: var(--canvas); color: var(--ink); position: relative; overflow: hidden; border-radius: 16px;
  box-shadow: 0 0 0 1px rgba(0,0,0,.08), 0 12px 32px rgba(0,0,0,.14); display: flex; flex-direction: column; }
.t14 { font-size: 14px; line-height: 20px; }
.t16 { font-size: 16px; line-height: 24px; }
.t18 { font-size: 18px; line-height: 24px; }
.t28 { font-size: 28px; line-height: 36px; }
.w6 { font-weight: 600; }
.muted { color: var(--ink-muted); }
/* Top bar (D-1): Exit, the place, Ingredients. Wraps by whole controls; a label never wraps inside its button. */
.top { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; padding: 8px 8px 4px; }
.qbtn { min-height: 44px; padding: 0 12px; border-radius: 22px; display: inline-flex; align-items: center; gap: 6px;
  font-weight: 600; color: var(--ink); flex: none; }
.qbtn .g { color: var(--action-text); flex: none; }
.place { min-height: 44px; display: inline-flex; align-items: center; gap: 4px; font-weight: 500; flex: 1 1 auto; }
.top .ingBtn { margin-left: auto; }
.track { display: flex; gap: 4px; padding: 4px 16px 8px; }
.track i { flex: 1; height: 4px; border-radius: 2px; background: var(--line-divider); }
.track i.done { background: var(--ink-muted); } .track i.now { background: var(--here-bar); }
/* The scale note (D-6, D17): Notice neutral, role note, alert glyph; then "Open ingredients" at L1 only. */
.note { margin: 4px 16px 0; display: flex; gap: 8px; align-items: flex-start; color: var(--ink-muted); }
.note .g { flex: none; margin-top: 2px; }
.openIng { margin: 0 16px 0 40px; min-height: 44px; display: inline-flex; align-items: center; color: var(--action-text);
  font-weight: 600; align-self: flex-start; }
.body { flex: 1; min-height: 0; padding: 12px 16px; overflow: hidden; }
.over { color: var(--ink-muted); margin-bottom: 8px; }
.line { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 16px; }
.box { width: 18px; height: 18px; border-radius: 4px; border: 1.5px solid var(--line-control); flex: none;
  margin-top: 1px; display: inline-flex; align-items: center; justify-content: center; }
.line .box { margin-top: 9px; }
.box.on { background: var(--ink); border-color: var(--ink); color: var(--paper); }
.navBlock { padding: 8px 16px 16px; }
.nextPrev { margin-bottom: 8px; } .nextPrev .steel { color: var(--action-text); }
.nav { display: flex; gap: 12px; }
.btn { flex: 1; min-height: 52px; border-radius: 999px; background: var(--paper); box-shadow: inset 0 0 0 1px var(--line-control);
  display: flex; align-items: center; justify-content: center; gap: 6px; font-weight: 600; }
.btn .g { color: var(--action-text); }
/* The list: sheet at L1/L1w, column at L2/L3. Rows are the recipe page's row. */
.scrim { position: absolute; inset: 0; background: var(--scrim); }
.sheet { position: absolute; left: 0; right: 0; bottom: 0; top: 96px; background: var(--paper-raised);
  border-radius: 16px 16px 0 0; display: flex; flex-direction: column; box-shadow: var(--shadow-lg); }
.sheet.inset { left: 84px; right: 84px; }
.grab { width: 40px; height: 4px; border-radius: 2px; background: var(--line-divider); margin: 8px auto 0; flex: none; }
.head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 16px 0; flex: none; }
.head h2 { font-size: 18px; line-height: 24px; font-weight: 600; flex: 1 1 auto; }
.textAct { min-height: 44px; padding: 0 4px; display: inline-flex; align-items: center; font-weight: 600; flex: none; }
.list { flex: 1; min-height: 0; overflow: hidden; padding: 0 16px; display: flex; flex-direction: column; }
.serv { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px 12px; min-height: 52px; }
.stepper { display: flex; align-items: center; gap: 8px; margin-left: auto; }
.sb { width: 44px; height: 44px; border-radius: 22px; background: var(--paper); display: flex; align-items: center;
  justify-content: center; color: var(--ink); flex: none;
  box-shadow: inset 0 0 0 1px var(--line-control); }
.sb[aria-disabled="true"] { opacity: 0.38; }
.sv { min-width: 3ch; text-align: center; font-variant-numeric: tabular-nums; font-weight: 600; }
.ing { display: flex; gap: 12px; align-items: flex-start; min-height: 44px; padding: 12px 0; }
.ing.on .txt { color: var(--ink-muted); }
.ing b { font-weight: 600; }
.clear { align-self: flex-start; margin-top: 8px; }
.snack { position: absolute; left: 16px; right: 16px; bottom: 16px; display: flex; align-items: center; justify-content: space-between;
  gap: 12px; min-height: 56px; padding: 6px 6px 6px 16px; border-radius: 14px; background: var(--inverse); color: var(--inverse-ink);
  z-index: 3; }
.snackUndo { min-height: 44px; padding: 0 14px; display: inline-flex; align-items: center; font-weight: 600; flex: none;
  border-radius: 22px; box-shadow: 0 0 0 2px var(--inverse-ink); }
/* L2/L3: the column (300) on the left, the step column (max 680) centred in the rest. */
.split { flex: 1; min-height: 0; display: flex; }
.col { width: 300px; flex: none; border-right: 1px solid var(--line-divider); background: var(--paper); display: flex;
  flex-direction: column; padding-top: 12px; position: relative; }
.col .head { padding-top: 0; }
.stepCol { flex: 1; min-width: 0; display: flex; flex-direction: column; position: relative; }
.stepCol > * { width: 100%; max-width: 680px; margin-left: auto; margin-right: auto; }
.stepCol .snack { position: static; max-width: 440px; width: calc(100% - 32px); margin: 0 auto 8px; }
/* Android: 48 dp touch areas by hit slop, dashed. */
.slop .sb, .slop .qbtn, .slop .textAct { outline: 1px dashed var(--attention); outline-offset: 2px; }
/* Largest text: the shared cap (2x) on every text role; glyphs scale to 28 inside the 44 target. */
.big .t14, .big .ing, .big .note { font-size: 28px; line-height: 36px; }
.big .t16, .big .qbtn, .big .place, .big .btn, .big .textAct, .big .serv, .big .snack, .big .openIng { font-size: 32px; line-height: 40px; }
.big .head h2, .big .t18 { font-size: 36px; line-height: 44px; }
.big .t28 { font-size: 56px; line-height: 64px; }
.big .g { width: 28px; height: 28px; }
.big .box { width: 36px; height: 36px; }
.big .sheet { top: 24px; }
.big .navBlock { display: none; }
.big .openIng { margin-left: 16px; }
.scr > *, .list > *, .stepCol > *, .col > * { flex-shrink: 0; }
.scr > .body, .stepCol > .body, .col > .list, .scr > .split { flex-shrink: 1; }
.clear { margin-left: -12px; }
"""

INGREDIENTS = [
    ('1', 'whole chicken, about 1.6 kg'), ('60 g', 'butter, soft'), ('1', 'lemon'),
    ('800 g', 'potatoes, quartered'), ('3', 'carrots, in chunks'), ('2', 'red onions, in wedges'),
    ('2 tbsp', 'olive oil'), ('1 tsp', 'sea salt'), (None, 'Black pepper, to taste'),
]
DOUBLED = [
    ('2', 'whole chickens, about 1.6 kg'), ('120 g', 'butter, soft'), ('2', 'lemons'),
    ('1.6 kg', 'potatoes, quartered'), ('6', 'carrots, in chunks'), ('4', 'red onions, in wedges'),
    ('4 tbsp', 'olive oil'), ('2 tsp', 'sea salt'), (None, 'Black pepper, to taste'),
]
CLEARED_MSG = 'Ticks cleared'
SCALE_NOTE = "The steps give amounts for 4. You're making 8, so use the amounts in Ingredients."


def box(on):
    inner = svg('check', 14, 3) if on else ''
    return f'<span class="box{" on" if on else ""}" role="checkbox" aria-checked="{"true" if on else "false"}">{inner}</span>'


def ing_rows(items, ticked=()):
    out = []
    for i, (amt, text) in enumerate(items):
        on = i in ticked
        words = f'<b>{amt}</b> {text}' if amt else text
        out.append(f'<div class="ing t14{" on" if on else ""}">{box(on)}<span class="txt">{words}</span></div>')
    return ''.join(out)


def top_bar(place='Step 2 of 5', ingredients=True):
    ing = (
        f'<button type="button" class="qbtn ingBtn">{svg("listChecks")}<span class="t16">Ingredients</span></button>'
        if ingredients
        else ''
    )
    return (
        f'<div class="top"><button type="button" class="qbtn" aria-label="Exit cooking mode">{svg("close")}'
        f'<span class="t16">Exit</span></button>'
        f'<span class="place t16" role="button" aria-label="{place}. Open all steps">{place}{svg("chevronDown", 18)}</span>'
        f'{ing}</div>'
    )


def track(n=5, now=1):
    return '<div class="track" aria-hidden="true">' + ''.join(
        f'<i class="{"done" if i < now else "now" if i == now else ""}"></i>' for i in range(n)
    ) + '</div>'


def step_body():
    return (
        '<div class="body"><div class="over t14">Line 1 of 3</div>'
        f'<div class="line">{box(False)}<div class="t28">Rub the chicken all over with 60{NB}g butter and season it well.</div></div>'
        f'<div class="line">{box(False)}<div class="t18">Squeeze the lemon over the top and put the halves inside.</div></div>'
        '</div>'
    )


def nav():
    return (
        f'<div class="navBlock"><div class="nextPrev t14"><span class="steel">Next</span> · step{NB}3</div>'
        f'<div class="nav"><button type="button" class="btn t16" aria-label="Back to step{NB}1">{svg("back")}Back</button>'
        f'<button type="button" class="btn t16" aria-label="Next step, step{NB}3">Next step{svg("next")}</button></div></div>'
    )


def scale_note(open_button=True):
    btn = '<button type="button" class="openIng t16" aria-haspopup="dialog">Open ingredients</button>' if open_button else ''
    return f'<div class="note t14" role="note">{svg("alert", 18)}<span>{SCALE_NOTE}</span></div>{btn}'


def servings(n, lo=False, hi=False):
    dis = lambda b: ' aria-disabled="true"' if b else ''
    return (
        f'<div class="serv t16"><span>Servings</span><span class="stepper">'
        f'<button type="button" class="sb" aria-label="Fewer servings"{dis(lo)}>{svg("minus")}</button>'
        f'<span class="sv">{n}</span>'
        f'<button type="button" class="sb" aria-label="More servings"{dis(hi)}>{svg("plus")}</button></span></div>'
    )


def list_inner(n, items, ticked=(), lo=False, hi=False, done=True):
    count = len(items)
    title = f'Ingredients for {n} · {count} item{"s" if count != 1 else ""}'
    done_btn = '<button type="button" class="textAct" aria-label="Close ingredients">Done</button>' if done else ''
    clear = '<button type="button" class="qbtn clear t16">Clear ticks</button>' if ticked else ''
    return (
        f'<div class="head"><h2>{title}</h2>{done_btn}</div>'
        f'<div class="list">{servings(n, lo, hi)}{ing_rows(items, ticked)}{clear}</div>'
    )


def phone(theme, w, h, n=4, items=INGREDIENTS, ticked=(), lo=False, hi=False, snack=False, cls='', inset=False):
    """L1/L1w: the step behind the scrim, the list in a sheet."""
    snack_html = (
        f'<div class="snack t16" role="status"><span>{CLEARED_MSG}</span><button type="button" class="snackUndo">Undo</button></div>'
        if snack
        else ''
    )
    return (
        f'<div class="scr {cls}" data-theme="{theme}" style="width:{w}px;height:{h}px">{top_bar()}{track()}{step_body()}{nav()}'
        f'<div class="scrim"></div><div class="sheet{" inset" if inset else ""}" role="dialog" aria-label="Ingredients">'
        f'<div class="grab"></div>{list_inner(n, items, ticked, lo, hi)}</div>{snack_html}</div>'
    )


def step_screen(theme, w, h, note=True, ingredients=True, cls=''):
    """D-6 (scale note) or D-9 (no ingredients) at L1."""
    return (
        f'<div class="scr {cls}" data-theme="{theme}" style="width:{w}px;height:{h}px">{top_bar(ingredients=ingredients)}{track()}'
        f'{scale_note() if note else ""}{step_body()}{nav()}</div>'
    )


def wide(theme, w, h, n=8, items=DOUBLED, ticked=(), snack=False, note=True):
    """L2/L3: the column (no Done, no Ingredients button), the step column with the note and no Open ingredients."""
    snack_html = (
        f'<div class="snack t16" role="status"><span>{CLEARED_MSG}</span><button type="button" class="snackUndo">Undo</button></div>'
        if snack
        else ''
    )
    return (
        f'<div class="scr" data-theme="{theme}" style="width:{w}px;height:{h}px">{top_bar(ingredients=False)}{track()}'
        f'<div class="split"><aside class="col" aria-label="Ingredients">{list_inner(n, items, ticked, done=False)}</aside>'
        f'<div class="stepCol">{scale_note(open_button=False) if note else ""}{step_body()}{snack_html}{nav()}</div></div></div>'
    )


def fig(caption, body):
    return f'<figure>{body}<figcaption>{caption}</figcaption></figure>'


def board(title, note, sections, width, height):
    body = ''.join(
        f'<section><h2 class="secTitle">{h}</h2><div class="row">{"".join(figs)}</div></section>' for h, figs in sections
    )
    return f"""<!doctype html>
<html lang="en">
    <head>
        <meta charset="utf-8" />
        <title>{title}</title>
        <script src="./support.js"></script>
        <link rel="stylesheet" href="ds/commise/tokens.css" />
    </head>
    <body>
        <!-- S2 board, built by buildS2Boards.py (Luna designer, D16-D18; Stellar plan 0100 design part). Design artifact, not app code. -->
        <x-dc><helmet><style>
{THEMES}
{CSS}
{ADD_CSS}
</style></helmet><div class="sheetBoard"><h1 class="boardTitle">{title}</h1><p class="boardNote">{note}</p>{body}</div></x-dc>
        <script type="text/x-dc" data-dc-script data-props='{{"$preview": {{"width": {width}, "height": {height}}}}}'>
            class Component extends DCLogic {{
            renderVals() {{
            return {{}};
            }}
            }}
        </script>
    </body>
</html>
"""


NOTE = (
    'S2: the ingredient list and servings inside cooking mode, the shape that is built (one list in recipe order, no '
    'groups; owner 0049 dropped the grouped list on the older Ingredients boards). States D-1 to D-9 of Stellar plan '
    '0100 §3; copy keys in Luna decisions/0001-designer.md D16 to D18. The rows, the checkbox and the Servings stepper '
    'are the recipe page\'s own components. Ticks are one record with the recipe page. Expert opinion, untested with users.'
)


def phone_sections(device, w, h, slop=False):
    cls = 'slop' if slop else ''
    out = []
    for theme in ('light', 'dark'):
        out.append((f'{device}, {theme}', [
            fig(f'<b>D-2 · List open, nothing ticked</b>. Title "Ingredients for 4 · 9 items" (PluralText). Done closes; '
                'its name is "Close ingredients". No Clear ticks while nothing is ticked.',
                phone(theme, w, h, cls=cls)),
            fig('<b>D-3 · Ticks, and Clear ticks</b>. A ticked row looks as on the recipe page. Clear ticks is a quiet '
                'Button md at the foot of the list.',
                phone(theme, w, h, ticked=(0, 1, 2), cls=cls)),
            fig(f'<b>D-4 · Cleared, with Undo</b>. "{CLEARED_MSG}" (D18 amended: short, for the dock budget). The snackbar sits above the sheet and its scrim, '
                'and Undo is in the sheet\'s focus order. Focus stays on the list title. No confirm.',
                phone(theme, w, h, snack=True, cls=cls)),
            fig('<b>D-5 · Servings changed to 8</b>. Count, title and every amount change together; a number and its '
                'unit never split. The stepper\'s own value is announced; the title is not a live region.',
                phone(theme, w, h, n=8, items=DOUBLED, cls=cls)),
            fig('<b>D-7 · At a limit</b>. At 1 serving, "Fewer servings" is disabled. At 100 (the recipe page\'s top '
                'limit), "More servings" is disabled the same way.',
                phone(theme, w, h, n=1, lo=True, cls=cls)),
            fig('<b>D-1 and D-6 · Step, servings changed</b>. Top bar: Exit, the place, Ingredients (listChecks). The '
                'note is a Notice, role note, not dismissible. "Open ingredients" opens the sheet (D17); its name is '
                'its label.',
                step_screen(theme, w, h, cls=cls)),
            fig('<b>D-9 · No ingredients</b>. No Ingredients button, no note, no way to open an empty list.',
                step_screen(theme, w, h, note=False, ingredients=False, cls=cls)),
        ]))
    return out


def big_section(w=320, h=568):
    figs = []
    for theme in ('light', 'dark'):
        figs += [
            fig(f'<b>Largest text, {w} × {h}, {theme}</b>. The top bar wraps by whole controls (Exit, the place, '
                'Ingredients); no label wraps inside its button. The note and Open ingredients wrap; the step scrolls. Back and Next at this size are S1\'s boards, left off here.',
                step_screen(theme, w, h, cls='big')),
            fig(f'<b>Largest text, list, {theme}</b>. The sheet takes the screen; title and Done stay in view and the '
                'body scrolls. Servings wraps: label above, the stepper below; + never leaves the screen. Rows wrap '
                'whole and never clip.',
                phone(theme, w, h, ticked=(0,), cls='big')),
        ]
    return ('Smallest phone, largest system text (iOS AX5 / Android 2.0), capped at 2x', figs)


def mobile():
    sections = phone_sections('iPhone 390', 390, 844) + phone_sections('Android 384 (48 dp touch areas dashed)', 384, 832, slop=True)[:1]
    sections.append(('iPad 820, light and dark (L2: the column, no sheet, no Done, no Ingredients button)', [
        fig('<b>D-3 and D-6 at L2, light</b>. The column is 300 on the left; the step column is centred in the rest. '
            'The note has no Open ingredients, because the list is in view.', wide('light', 820, 1180, ticked=(0, 1))),
        fig(f'<b>D-4 at L2, dark</b>. The snackbar sits at the foot of the step column.',
            wide('dark', 820, 1180, ticked=(), snack=True)),
    ]))
    sections.append(('iPad 1194 (L3: L2\'s structure; the step column max 680; the 360 right column is owed to S3/S9)', [
        fig('<b>D-3 at L3, light</b>.', wide('light', 1194, 834, ticked=(0, 1))),
        fig('<b>D-3 at L3, dark</b>.', wide('dark', 1194, 834, ticked=(0, 1))),
    ]))
    sections.append(big_section())
    return board('Cooking mode, S2 ingredients and servings (mobile)', NOTE, sections, 2400, 10224)


def web():
    sections = []
    for theme in ('light', 'dark'):
        sections.append((f'Web 390 (L1), {theme}', [
            fig('<b>D-2</b>. The sheet. Escape closes it; focus returns to the control that opened it.', phone(theme, 390, 844)),
            fig('<b>D-3</b>.', phone(theme, 390, 844, ticked=(0, 1, 2))),
            fig(f'<b>D-4</b>. Tab from the last control in the sheet reaches Undo.', phone(theme, 390, 844, snack=True)),
            fig('<b>D-7</b>, at 1.', phone(theme, 390, 844, n=1, lo=True)),
            fig('<b>D-1 and D-6</b>. "Open ingredients" carries aria-haspopup="dialog".', step_screen(theme, 390, 844)),
            fig('<b>D-9</b>.', step_screen(theme, 390, 844, note=False, ingredients=False)),
        ]))
    sections.append(('Web 768 (L1w: the sheet inset 84)', [
        fig('<b>D-3, light</b>.', phone('light', 768, 1024, ticked=(0, 1), inset=True)),
        fig('<b>D-5, dark</b>.', phone('dark', 768, 1024, n=8, items=DOUBLED, inset=True)),
    ]))
    sections.append(('Web 1024 (L2) and 1280 (L3)', [
        fig('<b>D-3 and D-6 at 1024, light</b>.', wide('light', 1024, 768, ticked=(0, 1))),
        fig('<b>D-4 at 1280, light</b>. The snackbar at the foot of the step column, max 440.', wide('light', 1280, 800, snack=True)),
        fig('<b>D-3 at 1280, dark</b>.', wide('dark', 1280, 800, ticked=(0, 1))),
    ]))
    sections.append(big_section())
    return board('Cooking mode, S2 ingredients and servings (web)', NOTE.replace('Expert', 'Web 320 at 200% is the largest-text case. Expert'), sections, 2400, 8638)



ADD_CSS = """
.field { display: flex; flex-direction: column; gap: 6px; margin-top: 12px; }
.lbl { font-weight: 600; }
.input { min-height: 48px; border-radius: 10px; box-shadow: inset 0 0 0 1px var(--line-control); background: var(--paper);
  padding: 10px 12px; color: var(--ink-muted); }
.durRow { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; }
.unitBox { display: inline-flex; align-items: center; gap: 6px; }
.dbox { width: 4.5ch; min-height: 48px; border-radius: 10px; box-shadow: inset 0 0 0 1px var(--line-control); background: var(--paper);
  display: inline-flex; align-items: center; justify-content: center; font-variant-numeric: tabular-nums; }
.err .dbox { box-shadow: inset 0 0 0 2px var(--danger); }
.errLine { display: flex; gap: 6px; align-items: flex-start; color: var(--danger-text); font-weight: 500; }
.acts { display: flex; flex-direction: column; gap: 8px; margin-top: 20px; }
.primary { min-height: 52px; border-radius: 999px; background: var(--action); color: var(--on-action); display: flex;
  align-items: center; justify-content: center; font-weight: 600; }
.kb { position: absolute; left: 0; right: 0; bottom: 0; height: 300px; background: #d1d5db; display: flex; align-items: center;
  justify-content: center; color: #5c646e; }
[data-theme='dark'] .kb { background: #2b2f36; color: #a3acb6; }
.addSheet { top: auto; padding-bottom: 16px; }
.pop { position: absolute; width: 360px; background: var(--paper-overlay); border-radius: 16px; box-shadow: var(--shadow-lg);
  padding: 16px; z-index: 2; }
.big .dbox, .big .input { min-height: 56px; }
.big .lbl, .big .input, .big .primary, .big .unitBox, .big .errLine { font-size: 32px; line-height: 40px; }
"""


def add_form(state='empty', big=False):
    vals = {'empty': ('', '', ''), 'short': ('0', '0', '4'), 'long': ('24', '0', '1'), 'ok': ('0', '20', '0')}[state]
    err = {'short': 'Set at least 5 seconds.', 'long': 'Timers can run for up to 24 hours.'}.get(state)
    boxes = ''.join(
        f'<span class="unitBox t16"><span class="dbox" role="textbox" aria-label="{a}">{v}</span><span aria-hidden="true">{u}</span></span>'
        for v, a, u in zip(vals, ('Hours', 'Minutes', 'Seconds'), ('h', 'min', 'sec'))
    )
    err_html = f'<div class="errLine t14">{svg("alert", 18)}<span>{err}</span></div>' if err else ''
    return (
        f'<div class="head" style="padding:4px 0 0"><h2>Add a timer</h2>'
        f'<button type="button" class="textAct">Cancel</button></div>'
        f'<div class="field"><span class="lbl t16">Name (optional)</span><span class="input t16" role="textbox" aria-label="Name (optional)"></span></div>'
        f'<div class="field{" err" if err else ""}" role="group" aria-label="Duration"><span class="lbl t16">Duration</span>'
        f'<div class="durRow">{boxes}</div>{err_html}</div>'
        f'<div class="acts"><button type="button" class="primary t16">Start timer</button></div>'
    )


def add_phone(theme, w, h, state='empty', kb=False, cls=''):
    kb_html = '<div class="kb t14">Keyboard</div>' if kb else ''
    bottom = 'bottom:300px;' if kb else ''
    return (
        f'<div class="scr {cls}" data-theme="{theme}" style="width:{w}px;height:{h}px">{top_bar()}{track()}{step_body()}{nav()}'
        f'<div class="scrim"></div><div class="sheet addSheet" role="dialog" aria-label="Add a timer" style="{bottom}padding-left:16px;padding-right:16px">'
        f'<div class="grab"></div>{add_form(state)}</div>{kb_html}</div>'
    )


def add_wide(theme, w, h, state='empty'):
    return (
        f'<div class="scr" data-theme="{theme}" style="width:{w}px;height:{h}px">{top_bar(ingredients=False)}{track()}'
        f'<div class="split"><aside class="col" aria-label="Ingredients">{list_inner(4, INGREDIENTS, done=False)}</aside>'
        f'<div class="stepCol">{step_body()}'
        f'<div style="padding:0 16px 8px"><span class="qbtn t16" style="color:var(--action-text)">{svg("plus")}Add a timer</span></div>{nav()}'
        f'<div class="pop" role="dialog" aria-label="Add a timer" style="bottom:150px;left:calc(50% - 300px)">{add_form(state)}</div>'
        f'</div></div></div>'
    )


ADD_NOTE = (
    'S3a "Add a timer" (SPECIFY S36; plan 0110 U4, KTD16). L1: a sheet that rides above the keyboard, Start timer always '
    'in view. L2 and L3: a popover anchored to "Add a timer". Duration is one labelled group of three boxes sized to '
    'two digits (hours, minutes, seconds), DurationField\'s own parts; the seconds box is KTD16\'s. Start timer stays '
    'enabled; an out-of-range press shows the error under the group and starts nothing. Focus opens on the hours box and '
    'returns to "Add a timer" on Cancel; after Start it goes to the new row\'s Pause. Keys: Luna designer D16. Expert '
    'opinion, untested with users.'
)


def add_mobile():
    sections = []
    for theme in ('light', 'dark'):
        sections.append((f'iPhone 390, {theme}', [
            fig('<b>Open</b>. Name is optional; the boxes are empty.', add_phone(theme, 390, 844)),
            fig('<b>Too short</b> (4 s; a blank or all-zero duration shows the same). "Set at least 5 seconds." Native: the message is also the boxes\' hint.', add_phone(theme, 390, 844, 'short')),
            fig('<b>Too long</b> (24:00:01). "Timers can run for up to 24 hours."', add_phone(theme, 390, 844, 'long')),
            fig('<b>Keyboard open</b>. The sheet sits above it; Start timer stays visible.', add_phone(theme, 390, 844, 'ok', kb=True)),
        ]))
    sections.append(('Android 384 (48 dp areas dashed) and iPad 820 (popover)', [
        fig('<b>Android, open, light</b>.', add_phone('light', 384, 832, cls='slop')),
        fig('<b>iPad 820, popover, light</b>.', add_wide('light', 820, 1180)),
        fig('<b>iPad 820, popover, too short, dark</b>.', add_wide('dark', 820, 1180, 'short')),
    ]))
    sections.append(('Smallest phone, largest text', [
        fig('<b>320 × 568, largest text, light</b>. The three boxes wrap as whole units; the sheet body scrolls; Start timer is reached by scroll, then by the keyboard\'s return.', add_phone('light', 320, 568, 'short', cls='big')),
        fig('<b>320 × 568, largest text, dark</b>.', add_phone('dark', 320, 568, cls='big')),
    ]))
    return board('Cooking mode, S3a Add a timer (mobile)', ADD_NOTE, sections, 2400, 4380)


def add_web():
    sections = [
        ('Web 390 (L1, sheet)', [
            fig('<b>Open, light</b>.', add_phone('light', 390, 844)),
            fig('<b>Too short, dark</b>.', add_phone('dark', 390, 844, 'short')),
        ]),
        ('Web 1024 and 1280 (popover)', [
            fig('<b>1024, open, light</b>.', add_wide('light', 1024, 768)),
            fig('<b>1280, too long, dark</b>. The error is linked with aria-describedby; the boxes get aria-invalid.', add_wide('dark', 1280, 800, 'long')),
        ]),
        ('Web 320 at 200%', [
            fig('<b>Too short, light</b>.', add_phone('light', 320, 568, 'short', cls='big')),
        ]),
    ]
    return board('Cooking mode, S3a Add a timer (web)', ADD_NOTE, sections, 2400, 3744)


(OUT / 'CookingModeIngredientsS2Mobile.dc.html').write_text(mobile())
(OUT / 'CookingModeIngredientsS2Web.dc.html').write_text(web())
print('written')
(OUT / 'CookingModeAddTimerS3aMobile.dc.html').write_text(add_mobile())
(OUT / 'CookingModeAddTimerS3aWeb.dc.html').write_text(add_web())
