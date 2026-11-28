"""Builds the S3b boards: the alarm opened outside cooking mode with
"Stop and go to step {n}", and the exit-from-cooking-mode snackbars on the page the cook lands on (the recipe page).

Writes CookingModeAlarmGoToStepS3bMobile/Web.dc.html and RecipeDetailExitSnackbarS3bMobile/Web.dc.html next to this
script. Run: python3 -I buildS3bBoards.py
"""

import re
import sys
from pathlib import Path

HERE = Path(__file__).parent
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.cwd()  # the folder the boards are written to
THEMES = (HERE / 'themes.css').read_text()
NBSP = ' '

GLYPH = {
    'bell': '<path d="M10.268 21a2 2 0 0 0 3.464 0"></path><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"></path>',
    'house': '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"></path><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>',
    'bookOpen': '<path d="M12 7v14"></path><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"></path>',
    'compass': '<circle cx="12" cy="12" r="10"></circle><path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"></path>',
    'calendar': '<path d="M8 2v4"></path><path d="M16 2v4"></path><rect width="18" height="18" x="3" y="4" rx="2"></rect><path d="M3 10h18"></path>',
    'user': '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle>',
    'chevL': '<path d="m15 18-6-6 6-6"></path>',
}


def svg(name, size=24):
    return (
        f'<svg aria-hidden="true" width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
        f'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{GLYPH[name]}</svg>'
    )


CSS = """
body { margin: 0; background: #e4e8ec; font-family: Inter, system-ui, sans-serif; color: #171b20; }
* { box-sizing: border-box; margin: 0; padding: 0; }
button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; }
.sheet { padding: 48px; }
.sheetTitle { font: 600 28px/32px Manrope, Inter, sans-serif; margin-bottom: 8px; }
.sheetNote { font-size: 16px; line-height: 24px; color: #5c646e; max-width: 900px; margin-bottom: 40px; }
section { margin-bottom: 56px; }
.secTitle { font-size: 18px; line-height: 24px; font-weight: 600; margin-bottom: 16px; }
.row { display: flex; flex-wrap: wrap; gap: 40px; align-items: flex-start; }
figure { display: flex; flex-direction: column; gap: 10px; }
figcaption { font-size: 14px; line-height: 20px; color: #5c646e; max-width: 420px; }
figcaption b { color: #171b20; font-weight: 600; }
.scr { background: var(--canvas); color: var(--ink); position: relative; overflow: hidden; border-radius: 16px;
  box-shadow: 0 0 0 1px rgba(0,0,0,.08), 0 12px 32px rgba(0,0,0,.14); display: flex; flex-direction: column; }
/* The alarm, opened outside cooking mode: the inverse surface. */
.alarm { background: var(--inverse); color: var(--inverse-ink); flex: 1; display: flex; flex-direction: column;
  justify-content: safe center; padding: 32px 20px; gap: 16px; overflow: auto; }
.alarmCol { width: 100%; max-width: 640px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }
.over { font-size: 14px; line-height: 20px; font-weight: 600; opacity: .85; display: flex; align-items: center; gap: 8px; }
.over svg { flex: none; }
.headline { font-size: 28px; line-height: 32px; font-weight: 600; }
.body { font-size: 18px; line-height: 28px; }
.note { font-size: 16px; line-height: 24px; opacity: .85; }
.stop { height: 52px; border-radius: 999px; background: var(--inverse-ink); color: var(--inverse); font-size: 16px; font-weight: 600;
  width: 100%; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 0 3px var(--inverse), 0 0 0 5px var(--inverse-ink); }
.pair { display: flex; gap: 12px; }
.quiet { flex: 1; height: 52px; border-radius: 999px; box-shadow: inset 0 0 0 1px var(--inverse-ink); font-size: 16px; font-weight: 600;
  display: flex; align-items: center; justify-content: center; }
.goStep { min-height: 48px; font-size: 16px; font-weight: 600; text-decoration: underline; text-underline-offset: 4px;
  align-self: center; padding: 0 12px; }
.big .over { font-size: 28px; line-height: 40px; }
.big .headline { font-size: 42px; line-height: 48px; }
.big .body { font-size: 36px; line-height: 48px; }
.big .note { font-size: 32px; line-height: 40px; }
.big .stop, .big .quiet { height: auto; min-height: 52px; padding: 8px 12px; font-size: 32px; line-height: 40px; text-align: center; }
.big .pair { flex-direction: column; }
/* Largest text: the content scrolls from the top, and Stop alarm stays pinned in view at the foot of the alarm. */
.big .stop { position: sticky; bottom: 0; z-index: 1;
  box-shadow: 0 0 0 3px var(--inverse), 0 0 0 5px var(--inverse-ink), 0 0 0 20px var(--inverse); }
.big .over svg { width: 28px; height: 28px; }
.big .goStep { font-size: 32px; line-height: 40px; text-align: center; }
/* The recipe page under an exit snackbar (house tab chrome comes from the linked house stylesheets). */
.xb-scr { background: var(--canvas); color: var(--ink); position: relative; overflow: hidden; border-radius: 16px;
  box-shadow: 0 0 0 1px rgba(0,0,0,.08), 0 12px 32px rgba(0,0,0,.14); display: flex; flex-direction: column; }
.xb-page { flex: 1; min-height: 0; overflow: hidden; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
.xb-title { font: 600 28px/32px Manrope, Inter, sans-serif; }
.xb-start { height: 52px; border-radius: 999px; background: var(--action); color: var(--on-action); font-weight: 600;
  display: inline-flex; align-items: center; justify-content: center; padding: 0 24px; align-self: flex-start; }
.xb-step { background: var(--paper); border-radius: 14px; padding: 12px 16px; font-size: 16px; line-height: 24px; }
/* The house web tab glyph's own svg attributes are not carried by a <use>-less copy, so state the stroke here. */
.rd .tab .ic { fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; }
/* 8 px above the tab bar's top edge: FAB_SNACKBAR_GAP (ui/src/createFab/fabLift.ts). */
.xb-snack { flex: none; margin: 0 12px 8px; display: flex; align-items: center; min-height: 56px; padding: 12px 16px;
  border-radius: 14px; background: var(--inverse); color: var(--inverse-ink); font-size: 16px; line-height: 24px; }
.xb-wide .xb-snack { align-self: center; width: 440px; margin: 0 0 24px; }
/* Desktop (sidebar at >= 840): the house sidebar, copied from RecipeDetailWeb1024. The snackbar is centred over the
   main column, never over the sidebar, 16 px above the bottom, at most 576 wide. */
.xb-desk { display: grid; grid-template-columns: 232px 1fr; flex: 1; min-height: 0; }
.xb-main { position: relative; display: flex; flex-direction: column; min-height: 0; }
.xb-desk .xb-page { padding: 28px 32px; }
.xb-main .xb-snack { position: absolute; left: 16px; right: 16px; bottom: 16px; margin: 0 auto; max-width: 576px; }
.rd .side { background: var(--paper); border-right: 1px solid var(--line-divider); padding: 22px 14px; display: flex;
  flex-direction: column; gap: 4px; }
.rd .side a { display: flex; align-items: center; gap: 12px; height: 44px; padding: 0 12px; border-radius: 12px;
  font-size: 14px; font-weight: 500; color: var(--ink-muted); text-decoration: none; }
.rd .side a.on { background: var(--surface-muted); color: var(--ink); font-weight: 600; }
.rd .side a.on svg { color: var(--action-text); }
.rd .side .grow { flex: 1; }
.rd .side .me { height: 64px; margin: -12px 0 12px; color: var(--ink); font-weight: 600; }
.rd .avatar.sm { width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 600; flex: none; background: var(--action); color: var(--on-action); }
/* 200% text: body roles x2 (16 -> 32), the title at its 28 x 2 cap; the house tab bar is drawn as on its own boards. */
.big .xb-title { font-size: 56px; line-height: 64px; }
.big .xb-start { font-size: 32px; line-height: 40px; height: auto; min-height: 52px; padding: 6px 24px; }
.big .xb-step, .big .xb-snack { font-size: 32px; line-height: 40px; }
.avatar.xs { width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 600; background: var(--paper); color: var(--ink); box-shadow: inset 0 0 0 1px var(--line-divider); }
"""


def alarm_screen(theme, width, height, cls=''):
    return (
        f'<div class="scr {cls}" data-theme="{theme}" style="width:{width}px;height:{height}px">'
        '<div class="alarm" role="alertdialog" aria-modal="true" aria-labelledby="h" aria-describedby="b">'
        '<div class="alarmCol">'
        f'<p class="over">{svg("bell", 20)}Roast timer · rang just now</p>'
        '<h2 class="headline" id="h">Check the chicken: the juices should run clear</h2>'
        f'<p class="body" id="b">Step{NBSP}4: Roast for 20 minutes, then lower the oven to 190°C.</p>'
        '<p class="note">Not yet? Add time. The oven sets the pace.</p>'
        '<button type="button" class="stop">Stop alarm</button>'
        '<div class="pair"><button type="button" class="quiet">+ 5 min</button>'
        '<button type="button" class="quiet">+ 10 min</button></div>'
        f'<button type="button" class="goStep">Stop and go to step{NBSP}4</button>'
        '</div></div></div>'
    )


HOUSE_TAB = {
    'native': (HERE / 'houseTabNative.html').read_text(),
    'web': (HERE / 'houseTabWeb.html').read_text(),
}
for _sym, _glyph in (('home', 'house'), ('book', 'bookOpen'), ('compass', 'compass'), ('calendar', 'calendar')):
    HOUSE_TAB['web'] = HOUSE_TAB['web'].replace(f'<use href="#{_sym}" />', GLYPH[_glyph])

HOUSE_TAB['web'] = HOUSE_TAB['web'].replace('<svg aria-hidden', '<svg class="ic" aria-hidden')
HOUSE_TAB_WEB_CSS = (HERE / 'houseTabWeb.css').read_text()

HOUSE_CSS = {
    'native': ['ds/commise/tokens.css', 'ds/commise/native.css'],
    'web': ['ds/commise/tokens.css', 'ds/commise/bundle.css', 'ds/commise/redesign.css'],
}


SIDE = (
    '<nav class="side" aria-label="Main">'
    '<a href="#" class="me" aria-label="Profile, Eliza Ramirez"><span class="avatar sm">ER</span>Eliza Ramirez</a>'
    f'<a href="#">{svg("house", 20)}Home</a>'
    f'<a href="#" class="on" aria-current="page">{svg("bookOpen", 20)}Recipes</a>'
    f'<a href="#">{svg("compass", 20)}Discover</a>'
    f'<a href="#">{svg("calendar", 20)}Meal plan</a>'
    f'<span class="grow"></span><a href="#">{svg("chevL", 20)}Collapse</a>'
    '</nav>'
)


def desk_page(theme, width, height, message):
    """Web with the sidebar (>= 840): the snackbar on the one app-wide host, over the main column."""
    content = (
        '<div class="xb-page">'
        '<h1 class="xb-title" tabindex="-1">Lemon and thyme roast chicken</h1>'
        '<span class="xb-start">Start cooking</span>'
        '<div class="xb-step">4 · Roast for 20 minutes, then lower the oven to 190°C (170°C fan).</div>'
        '<div class="xb-step">5 · Lift the chicken onto a board and rest it under foil for 15 minutes.</div>'
        '</div>'
    )
    return (
        f'<div class="xb-scr rd" data-theme="{theme}" style="width:{width}px;height:{height}px">'
        f'<div class="xb-desk">{SIDE}<div class="xb-main">{content}'
        f'<div class="xb-snack" role="status">{message}</div></div></div></div>'
    )


def recipe_page(theme, width, height, message, platform, wide=False, tabs=True, extra=''):
    content = (
        '<div class="xb-page">'
        '<h1 class="xb-title" tabindex="-1">Lemon and thyme roast chicken</h1>'
        '<span class="xb-start">Start cooking</span>'
        '<div class="xb-step">4 · Roast for 20 minutes, then lower the oven to 190°C (170°C fan).</div>'
        '<div class="xb-step">5 · Lift the chicken onto a board and rest it under foil for 15 minutes.</div>'
        '</div>'
    )
    snack = f'<div class="xb-snack" role="status">{message}</div>'
    nav = HOUSE_TAB[platform] if tabs else ''
    if extra == 'big':
        # The four tabs the app ships today (buildSpec: Meal Plan becomes a tab later); five do not fit 320 at 14 px.
        nav = re.sub(r'<a class="tab" href="#"\s*><svg[^>]*>(?:(?!</a).)*Meal plan</a\s*>', '', nav, flags=re.S)
        assert 'Meal plan' not in nav
    cls = ('xb-scr xb-wide' if wide else 'xb-scr') + (f' {extra}' if extra else '')
    if platform == 'web':
        cls += ' rd'
    return (
        f'<div class="{cls}" data-theme="{theme}" style="width:{width}px;height:{height}px">'
        f'{content}{snack}{nav}</div>'
    )


def fig(caption, body):
    return f'<figure>{body}<figcaption>{caption}</figcaption></figure>'


def board(title, note, sections, width, height, links=()):
    link_html = ''.join(f'        <link rel="stylesheet" href="{href}" />\n' for href in links)
    body = ''.join(
        f'<section><h2 class="secTitle">{h}</h2><div class="row">{"".join(figs)}</div></section>' for h, figs in sections
    )
    return f"""<!doctype html>
<html lang="en">
    <head>
        <meta charset="utf-8" />
        <title>{title}</title>
        <script src="./support.js"></script>
{link_html}    </head>
    <body>
        <!-- S3b board, built by buildS3bBoards.py. Design artifact, not app code. -->
        <x-dc><helmet><style>
{THEMES}
{CSS}
{HOUSE_TAB_WEB_CSS}
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


ALARM_NOTE = (
    'The alarm opened OUTSIDE that recipe\'s cooking mode adds one quiet text action under '
    '"+ 10 min": "Stop and go to step N" (cooking.alarm.goToStep). It does what Stop alarm does, then opens that '
    'recipe\'s cooking mode at step N, pushed, so Back returns to where the cook was; focus lands on the step\'s focus '
    'line. Stop alarm keeps the one fill and first focus; tab order Stop alarm, + 5 min, + 10 min, Stop and go to step. '
    'The dialog is labelled by the headline and described by the step text (native: the container accessibility label). '
    'Escape is Stop alarm. Hidden when the recipe is known to be gone. Inside the '
    'recipe\'s own cooking mode the action is not shown (the alarm board). '
    'Sign-out (any cause: this tab, another tab or an expired session) closes the alarm, stops the sound and the '
    'vibration, and drops any Undo; nothing carries over to the next person.'
)

EXIT_NOTE = (
    'Exiting cooking mode with a timer lands on the recipe page and '
    'shows the house snackbar, no action, 8,000 ms, placed by the CURRENT page\'s rule: 8 px (FAB_SNACKBAR_GAP) above the house tab bar on '
    'phone and tablet. Web: it is raised on the ONE app-wide snackbar host, so it outlives '
    'the page change; with the sidebar (>= 840) it is centred over the main column, never over the sidebar, 16 px above '
    'the bottom, at most 576 wide. The message wraps to as many lines as it needs and is never clamped. '
    'The snackbar never takes '
    'focus: focus goes to the page\'s h1. Its message is announced once, when raised. The running-timer dock drawn on '
    'RecipeDetailScrolled is S4, not built in S3; until then the snackbar sits above the tab bar.'
)

RUN_WEB = 'Your Roast timer keeps running. It rings only while this tab is open.'
RUN_NATIVE = 'Your Roast timer keeps running. It rings only while Commise is on screen.'
PAUSED = 'Your Roast timer is paused. Open cooking mode to start it again.'


def alarm_mobile():
    return board('Cooking mode, S3b alarm with "Stop and go to step" (mobile)', ALARM_NOTE, [
        ('iPhone 390', [
            fig('<b>Light</b>. Opened over the shopping list; Stop alarm has focus.', alarm_screen('light', 390, 844)),
            fig('<b>Dark</b>.', alarm_screen('dark', 390, 844)),
        ]),
        ('iPad 820', [fig('<b>Light</b>. The alarm column stays at most 640 wide.', alarm_screen('light', 820, 1180))]),
        ('Phone 320 x 568 · largest text', [
            fig('<b>Light, largest text</b>. The content scrolls from the top; Stop alarm is pinned at the foot, so it is visible without scrolling and has focus; +5, +10 and "Stop '
                'and go to step 4" are reached by vertical scroll inside the alarm. No sideways scroll, no truncation.',
                alarm_screen('light', 320, 568, 'big')),
        ]),
    ], 2400, 3420)


def alarm_web():
    return board('Cooking mode, S3b alarm with "Stop and go to step" (web)', ALARM_NOTE, [
        ('Web 1024', [
            fig('<b>Light</b>. Modal alertdialog over the page; Escape = Stop alarm. Over an open dialog (for example '
                'ConfirmDialog) the alarm mounts on top: one Escape closes only the alarm, and focus returns to the '
                'control that had it inside that dialog, which stays open.', alarm_screen('light', 1024, 700)),
            fig('<b>Dark</b>.', alarm_screen('dark', 1024, 700)),
        ]),
        ('Web 320 · 200% text', [fig('<b>Light, 200%</b>. Same fit mark as mobile.', alarm_screen('light', 320, 568, 'big'))]),
    ], 2400, 1890)


def exit_mobile():
    return board('Recipe detail, S3b exit-from-cooking-mode snackbar (mobile)', EXIT_NOTE, [
        ('iPhone 390', [
            fig('<b>Running</b> · light.', recipe_page('light', 390, 844, RUN_NATIVE, 'native')),
            fig('<b>Running</b> · dark.', recipe_page('dark', 390, 844, RUN_NATIVE, 'native')),
            fig('<b>Paused</b> · light.', recipe_page('light', 390, 844, PAUSED, 'native')),
        ]),
        ('iPad 820', [
            fig('<b>Running</b> · light. Tablet keeps the tab bar; the snackbar sits above it.',
                recipe_page('light', 820, 1180, RUN_NATIVE, 'native')),
            fig('<b>Paused</b> · dark.', recipe_page('dark', 820, 1180, PAUSED, 'native')),
        ]),
    ], 2400, 2630, HOUSE_CSS['native'])


def exit_web():
    return board('Recipe detail, S3b exit-from-cooking-mode snackbar (web)', EXIT_NOTE, [
        ('Web 1024 (sidebar)', [
            fig('<b>Running</b> · light. On the app-wide host, centred over the main column, never over the '
                'sidebar; 16 px above the bottom; focus is on the h1, and the message is announced once.',
                desk_page('light', 1024, 700, RUN_WEB)),
            fig('<b>Paused</b> · dark.', desk_page('dark', 1024, 700, PAUSED)),
        ]),
        ('Web 1280 (desktop)', [
            fig('<b>Running</b> · light. Same rule; at most 576 wide.', desk_page('light', 1280, 800, RUN_WEB)),
            fig('<b>Paused</b> · dark.', desk_page('dark', 1280, 800, PAUSED)),
        ]),
        ('Web 390 (phone width)', [
            fig('<b>Running</b> · light. Above the tab bar.', recipe_page('light', 390, 844, RUN_WEB, 'web')),
            fig('<b>Running</b> · dark.', recipe_page('dark', 390, 844, RUN_WEB, 'web')),
        ]),
        ('Web 320 · 200% text', [
            fig('<b>Running</b> · light, 200%. The message wraps to as many lines as it needs, never clamped; '
                'the snackbar stays 8 px above the tab bar, and the page scrolls under it. The tab bar shows the four tabs the '
                'app ships today.',
                recipe_page('light', 320, 568, RUN_WEB, 'web', extra='big')),
        ]),
    ], 2800, 2230, HOUSE_CSS['web'])


for name, html in [
    ('CookingModeAlarmGoToStepS3bMobile', alarm_mobile()),
    ('CookingModeAlarmGoToStepS3bWeb', alarm_web()),
    ('RecipeDetailExitSnackbarS3bMobile', exit_mobile()),
    ('RecipeDetailExitSnackbarS3bWeb', exit_web()),
]:
    (OUT / f'{name}.dc.html').write_text(html)
print('ok')
