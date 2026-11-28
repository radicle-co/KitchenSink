"""Builds the two "S3 dock row" boards.

Writes CookingModeDockRowS3Mobile.dc.html and CookingModeDockRowS3Web.dc.html next to this script. Run:
python3 -I buildDockRowBoards.py
"""

import sys
from pathlib import Path

HERE = Path(__file__).parent
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.cwd()  # the folder the boards are written to
THEMES = (HERE / 'themes.css').read_text()

GLYPH = {
    # Lucide shapes: `timer` and `x` are registered meanings; `pause` and `play` are requested.
    'timer': '<line x1="10" x2="14" y1="2" y2="2"></line><line x1="12" x2="15" y1="14" y2="11"></line><circle cx="12" cy="14" r="8"></circle>',
    'pause': '<rect x="14" y="4" width="4" height="16" rx="1"></rect><rect x="6" y="4" width="4" height="16" rx="1"></rect>',
    'play': '<polygon points="6 3 20 12 6 21 6 3"></polygon>',
    'close': '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>',
    'back': '<path d="M15 6l-6 6 6 6"></path>',
    'next': '<path d="M9 6l6 6-6 6"></path>',
}


def svg(name, size=20):
    return (
        f'<svg aria-hidden="true" width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
        f'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{GLYPH[name]}</svg>'
    )


CSS = """
body { margin: 0; background: #e4e8ec; font-family: Inter, system-ui, sans-serif; color: #171b20; }
* { box-sizing: border-box; margin: 0; padding: 0; }
button { font: inherit; color: inherit; background: none; border: 0; text-align: left; cursor: pointer; }
.sheet { padding: 48px; }
.sheetTitle { font: 600 28px/32px Manrope, Inter, sans-serif; margin-bottom: 8px; }
.sheetNote { font-size: 16px; line-height: 24px; color: #5c646e; max-width: 900px; margin-bottom: 40px; }
section { margin-bottom: 56px; }
.secTitle { font-size: 18px; line-height: 24px; font-weight: 600; margin-bottom: 16px; }
.row { display: flex; flex-wrap: wrap; gap: 40px; align-items: flex-start; }
figure { display: flex; flex-direction: column; gap: 10px; }
figcaption { font-size: 14px; line-height: 20px; color: #5c646e; max-width: 420px; }
figcaption b { color: #171b20; font-weight: 600; }
.frag { background: var(--canvas); color: var(--ink); position: relative; overflow: hidden; border-radius: 16px;
  box-shadow: 0 0 0 1px rgba(0,0,0,.08), 0 12px 32px rgba(0,0,0,.14); display: flex; flex-direction: column; }
.stepTail { padding: 12px 16px 8px; color: var(--ink-muted); font-size: 18px; line-height: 24px; }
.stepTail .offer { margin-top: 12px; }
.offer { height: 48px; padding: 0 16px; border-radius: 24px; border: 1px solid var(--line-control); display: inline-flex;
  align-items: center; gap: 8px; font-size: 16px; font-weight: 600; color: var(--action-text); }
.dock { margin: 4px 16px 0; }
.dockRow { display: flex; align-items: center; gap: 12px; min-height: 52px; padding: 6px 0; }
.dockRow > .glyph { color: var(--action-text); flex: none; }
.lab { flex: 1; min-width: 0; display: flex; flex-direction: column; }
/* figureLarge: Inter 28/32, 600, tabular and lining digits. Never wraps, never truncates. */
.figureLarge { font: 600 28px/32px Inter, system-ui, sans-serif; font-variant-numeric: tabular-nums lining-nums;
  white-space: nowrap; }
.t16 { font-size: 16px; line-height: 24px; }
.t14 { font-size: 14px; line-height: 20px; }
.num { font-variant-numeric: tabular-nums; }
.muted { color: var(--ink-muted); }
.recipeLink { color: var(--action-text); font-weight: 600; }
.paused { color: var(--ink); font-weight: 600; }
.icons { display: flex; gap: 8px; flex: none; }
.ib { width: 44px; height: 44px; border-radius: 22px; display: flex; align-items: center; justify-content: center;
  color: var(--ink); position: relative; }
/* Android touch area: 48 dp by hit slop, drawn as a dashed outline on the Android figure only. */
.slop .ib::after { content: ''; position: absolute; inset: -2px; border: 1px dashed var(--attention); border-radius: 24px; }
.bodyBtn { flex: 1; min-width: 0; display: flex; align-items: center; gap: 12px; border-radius: 12px; }
.navBlock { padding: 8px 16px 20px; display: flex; gap: 12px; }
.btn { flex: 1; height: 52px; border-radius: 999px; background: var(--paper); box-shadow: inset 0 0 0 1px var(--line-control);
  display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 16px; font-weight: 600; color: var(--ink); }
.btn svg { color: var(--action-text); flex: none; }
.snack { margin: 8px 16px 0; display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 56px;
  padding: 6px 6px 6px 16px; border-radius: 14px; background: var(--inverse); color: var(--inverse-ink); font-size: 16px; line-height: 24px; }
.snackUndo { min-height: 44px; padding: 0 14px; display: inline-flex; align-items: center; font-weight: 600;
  border-radius: 22px; box-shadow: 0 0 0 2px var(--inverse-ink); }
.gapNote { margin: 0 16px; height: 0; border-top: 1px dashed var(--attention); position: relative; }
.colStep .dock, .colStep .navBlock, .colStep .stepTail, .colStep .snack { width: 100%; max-width: 600px; margin-left: auto; margin-right: auto; }
.colStep .snack { max-width: 440px; }
/* Largest text: body roles x2 (FONT_SCALE_CAP), figureLarge x1.5 (DISPLAY_FONT_SCALE_CAP); the glyph hides above 1.3x. */
.big .figureLarge { font-size: 42px; line-height: 48px; }
.big .t14 { font-size: 28px; line-height: 40px; }
.big .t16, .big .btn, .big .stepTail { font-size: 32px; line-height: 40px; }
.big .dockRow > .glyph, .big .bodyBtn > .glyph { display: none; }
.big .ib svg, .big .btn svg { width: 28px; height: 28px; }
.big .btn { height: auto; min-height: 52px; padding: 8px 12px; }
/* Fix 4: the whole dock at 320 at the largest text, on a 320 x 568 screen. */
.screen320 { width: 320px; height: 568px; }
.topBar { flex: none; display: flex; align-items: center; gap: 12px; padding: 24px 16px 6px; }
.exitBtn { width: 48px; height: 48px; border-radius: 24px; background: var(--surface-muted); display: flex; align-items: center; justify-content: center; flex: none; }
.place { font-size: 28px; line-height: 40px; font-weight: 600; }
.stepBody { flex: 1; min-height: 0; overflow: hidden; padding: 8px 16px; position: relative; }
.stepBody .focus { font-size: 56px; line-height: 64px; }
.budget { position: absolute; left: 0; right: 0; bottom: 0; border-top: 2px dashed var(--attention); }
"""


def row(state, time, meta, label='Roast', other=None, slop=False):
    """One CookingTimerRow. state: running | paused | done. other: recipe name for another recipe's row."""
    if state == 'done':
        figure = '<span class="figureLarge">Done</span>'
        icons = f'<button type="button" class="ib" aria-label="Stop {label} timer">{svg("close")}</button>'
    else:
        figure = f'<span class="figureLarge">{time}</span>'
        toggle = (
            f'<button type="button" class="ib" aria-label="Resume {label}">{svg("play")}</button>'
            if state == 'paused'
            else f'<button type="button" class="ib" aria-label="Pause {label}">{svg("pause")}</button>'
        )
        icons = toggle + f'<button type="button" class="ib" aria-label="Cancel {label} timer">{svg("close")}</button>'
    paused = '<span class="paused">Paused</span> · ' if state == 'paused' else ''
    if other:
        lab = (
            f'<div class="lab">{figure}<span class="t14 muted">{paused}<span class="recipeLink">{other}</span> · {meta}</span></div>'
        )
        body = (
            f'<button type="button" class="bodyBtn" aria-label="Open {other}. {label} timer, 43 minutes 12 seconds left">'
            f'<span class="glyph">{svg("timer", 22)}</span>{lab}</button>'
        )
        inner = body
    else:
        inner = f'<span class="glyph">{svg("timer", 22)}</span><div class="lab">{figure}<span class="t14 muted">{paused}{meta}</span></div>'
    cls = 'dockRow slop' if slop else 'dockRow'
    return f'<div class="{cls}">{inner}<div class="icons">{icons}</div></div>'


def nav():
    return (
        f'<div class="navBlock"><button type="button" class="btn" aria-label="Back to step\u00a03">{svg("back")}<span>Back</span></button>'
        f'<button type="button" class="btn" aria-label="Next step, step\u00a05"><span>Next step</span>{svg("next")}</button></div>'
    )


def frag(theme, width, rows, cls='', tail=True, snack=None, offer=False):
    tail_html = ''
    if tail:
        offer_html = f'<div><span class="offer">{svg("timer")}Time 1 h 30</span></div>' if offer else ''
        tail_html = f'<div class="stepTail">…then turn the potatoes and put the tin back.{offer_html}</div>'
    snack_html = (
        f'<div class="snack" role="status"><span>{snack}</span><button type="button" class="snackUndo">Undo</button></div>'
        if snack
        else ''
    )
    dock = f'<div class="dock">{"".join(rows)}</div>' if rows else ''
    nav_html = '' if 'big' in cls else nav()  # the largest-text figures show the row only; Back/Next at that size have their own boards
    return (
        f'<div class="frag {cls}" data-theme="{theme}" style="width:{width}px">{tail_html}{snack_html}{dock}{nav_html}</div>'
    )


NBSP = '\u00a0'
OTHER_ROW = row('running', '43:12', 'roast · step' + NBSP + '4', other='Roast chicken')


def full_dock(theme, budget_note):
    """The whole lower screen at 320 with the largest text: step text, snackbar, another recipe's row, Back and Next."""
    return (
        f'<div class="frag big screen320" data-theme="{theme}">'
        f'<div class="topBar"><button type="button" class="exitBtn" aria-label="Exit cooking mode">{svg("close")}</button>'
        f'<span class="place">Step\u00a04 of 6</span></div>'
        f'<div class="stepBody"><p class="focus">Roast the potatoes until golden, about 40 minutes.</p><span class="budget"></span></div>'
        f'<div class="snack" role="status"><span>Ticks cleared</span><button type="button" class="snackUndo">Undo</button></div>'
        f'<div class="dock">{OTHER_ROW}</div>'
        f'{nav_always()}</div>'
    )


def nav_always():
    return (
        f'<div class="navBlock"><button type="button" class="btn" aria-label="Back to step\u00a03">{svg("back")}<span>Back</span></button>'
        f'<button type="button" class="btn" aria-label="Next step, step\u00a05"><span>Next step</span>{svg("next")}</button></div>'
    )


BUDGET = ('Scroll budget, measured in Chromium on 320 x 568: the step text keeps 78 px (one line of the 56/64 focus line) '
          'while the snackbar shows, and 134 px (two lines) after it closes. The dock is 220, Back/Next 124, the top bar 78. '
          'The dashed line is the bottom of the visible step text. This is the worst case; it is flagged for design review.')


def fig(caption, body):
    return f'<figure>{body}<figcaption>{caption}</figcaption></figure>'


def states(theme, width, cls=''):
    return [
        fig(f'<b>Running</b> · {theme}. The soonest time is figureLarge. Icons: Pause, then Cancel ("Cancel Roast timer").',
            frag(theme, width, [row('running', '1:09:50', 'Roast · step\u00a04')], cls)),
        fig(f'<b>Paused</b> · {theme}. "Paused" in text, the time does not move. Pause becomes Resume ("Resume Roast").',
            frag(theme, width, [row('paused', '1:09:50', 'Roast · step\u00a04')], cls)),
        fig(f'<b>Done</b> · {theme}. "Done" where the time was. One action, `close`: "Stop Roast timer", the same act as Stop alarm.',
            frag(theme, width, [row('done', '', 'Roast · step\u00a04')], cls)),
        fig(f'<b>Another recipe\'s timer</b> · {theme}. The row body opens Roast chicken; Pause and Cancel are sibling buttons, never nested. No offer shows.',
            frag(theme, width, [row('running', '43:12', 'roast · step\u00a04', other='Roast chicken')], cls)),
        fig(f'<b>After Cancel</b> · {theme}. The snackbar sits above the dock, never over it or Back/Next. Focus is on Undo. The offer is back.',
            frag(theme, width, [], cls, snack='Roast timer cancelled', offer=True)),
    ]


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
    </head>
    <body>
        <!-- S3 dock row board, built by buildDockRowBoards.py. Design artifact, not app code. -->
        <x-dc><helmet><style>
{THEMES}
{CSS}
</style></helmet><div class="sheet"><h1 class="sheetTitle">{title}</h1><p class="sheetNote">{note}</p>{body}</div></x-dc>
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
    'CookingTimerRow, cleared as option A with figureLarge. '
    'One timer in the whole app in S3. The countdown is never a live region; a screen reader hears the row as '
    '"Roast, 1 hour 9 minutes 50 seconds left, step 4". Each icon is drawn 44 with an 8 gap. The time never wraps or '
    'truncates; at the largest text the label and meta wrap instead.'
)

FIT_NOTE = (
    'Largest text at 320: body roles x2, figureLarge x1.5 (42/48), the timer glyph hidden above 1.3x by the shared cap. '
    'Hours case "1:09:50" stays on one line; label and meta wrap. Back and Next are left out here (their own boards).'
)


def mobile():
    sections = [
        ('iPhone 390 · light', states('light', 390)),
        ('iPhone 390 · dark', states('dark', 390)),
        ('Android 384 · touch areas', [
            fig('<b>Android</b> · light. Dashed: each 44 icon grows to a 48 dp touch area by hit slop. The two areas do not overlap (8 gap, 2 slop each side).',
                frag('light', 384, [row('running', '1:09:50', 'Roast · step\u00a04', slop=True)])),
            fig('<b>Android</b> · dark, another recipe\'s row with touch areas.',
                frag('dark', 384, [row('running', '43:12', 'roast · step\u00a04', other='Roast chicken', slop=True)])),
        ]),
        ('iPad 820 · step column', [
            fig('<b>iPad 820</b> · light, running. The dock follows the step column (max 600).',
                frag('light', 820, [row('running', '1:09:50', 'Roast · step\u00a04')], 'colStep')),
            fig('<b>iPad 820</b> · dark, after Cancel: the snackbar (max 440) sits above the dock.',
                frag('dark', 820, [], 'colStep', snack='Roast timer cancelled', offer=True)),
        ]),
        ('Phone 320 · largest text (condition 8)', [
            fig(f'<b>Running, hours case</b> · light. {FIT_NOTE}', frag('light', 320, [row('running', '1:09:50', 'Roast · step\u00a04')], 'big', tail=False)),
            fig('<b>Another recipe\'s row</b> · dark, largest text.', frag('dark', 320, [row('running', '43:12', 'roast · step\u00a04', other='Roast chicken')], 'big', tail=False)),
            fig('<b>Done</b> · light, largest text.', frag('light', 320, [row('done', '', 'Roast · step\u00a04')], 'big', tail=False)),
        ]),
        ('Phone 320 x 568 · largest text · the whole dock (fix 4)', [
            fig(f'<b>Whole dock</b> · light. {BUDGET}', full_dock('light', BUDGET)),
            fig('<b>Whole dock</b> · dark. Same budget.', full_dock('dark', BUDGET)),
        ]),
    ]
    return board('Cooking mode, S3 dock row (mobile)', NOTE, sections, 2400, 3110)


def web():
    sections = [
        ('Web 1024 · light', states('light', 1024, 'colStep')),
        ('Web 1024 · dark', states('dark', 1024, 'colStep')),
        ('Web 320 · 200% text', [
            fig(f'<b>Running, hours case</b> · light. {FIT_NOTE} Tooltips ("Pause Roast", "Cancel Roast timer") show on hover and keyboard focus only.',
                frag('light', 320, [row('running', '1:09:50', 'Roast · step\u00a04')], 'big', tail=False)),
            fig('<b>Another recipe\'s row</b> · dark, 200%.', frag('dark', 320, [row('running', '43:12', 'roast · step\u00a04', other='Roast chicken')], 'big', tail=False)),
        ]),
    ]
    return board('Cooking mode, S3 dock row (web)', NOTE, sections, 2400, 2660)


(OUT / 'CookingModeDockRowS3Mobile.dc.html').write_text(mobile())
(OUT / 'CookingModeDockRowS3Web.dc.html').write_text(web())
print('ok')
