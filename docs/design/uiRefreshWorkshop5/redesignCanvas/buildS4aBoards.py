"""Builds the S4a composite boards: the entry meta lines, the Resume
lines in order and their worst case, ResumeEarlier with an edited recipe and an ended timer, and the cooking-mode Done
row with "+ 10 min" and "Clear".

Writes CookingModeResumeS4aMobile.dc.html and CookingModeResumeS4aWeb.dc.html next to this script. Run:
python3 -I buildS4aBoards.py
"""

from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from pruneCss import prune  # noqa: E402
from doneRowCss import DOCK_ACTS_CSS  # noqa: E402

HERE = Path(__file__).parent
OUT = Path.cwd()  # the boards are written to the folder it is run from
THEMES = (HERE / 'themes.css').read_text()
NB = ' '

GLYPH = {
    'timer': '<line x1="10" x2="14" y1="2" y2="2"></line><line x1="12" x2="15" y1="14" y2="11"></line><circle cx="12" cy="14" r="8"></circle>',
    'bell': '<path d="M10.268 21a2 2 0 0 0 3.464 0"></path><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"></path>',
    'close': '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>',
    'back': '<path d="M15 6l-6 6 6 6"></path>',
    'next': '<path d="M9 6l6 6-6 6"></path>',
    'chevD': '<path d="M6 9l6 6 6-6"></path>',
    'list': '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"></path>',
    'wifiOff': '<path d="M12 20h.01"></path><path d="M8.5 16.429a5 5 0 0 1 7 0"></path><path d="M5 12.859a10 10 0 0 1 5.17-2.69"></path><path d="M19 12.859a10 10 0 0 0-2.007-1.523"></path><path d="M2 8.82a15 15 0 0 1 4.177-2.643"></path><path d="M22 8.82a15 15 0 0 0-11.288-3.764"></path><path d="m2 2 20 20"></path>',
}


def svg(name, size=20, cls=''):
    c = f' class="{cls}"' if cls else ''
    return (
        f'<svg{c} aria-hidden="true" width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
        f'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{GLYPH[name]}</svg>'
    )


CSS = """
body { margin: 0; background: #e4e8ec; font-family: Inter, system-ui, sans-serif; color: #171b20; }
* { box-sizing: border-box; margin: 0; padding: 0; }
button { font: inherit; color: inherit; background: none; border: 0; text-align: left; cursor: pointer; }
.sheet { padding: 48px; }
.sheetTitle { font: 600 28px/32px Manrope, Inter, sans-serif; margin-bottom: 8px; }
.sheetNote { font-size: 16px; line-height: 24px; color: #5c646e; max-width: 1100px; margin-bottom: 40px; }
section { margin-bottom: 56px; }
.secTitle { font-size: 18px; line-height: 24px; font-weight: 600; margin-bottom: 16px; }
.row { display: flex; flex-wrap: wrap; gap: 40px; align-items: flex-start; }
figure { display: flex; flex-direction: column; gap: 10px; }
figcaption { font-size: 14px; line-height: 20px; color: #5c646e; max-width: 420px; }
figcaption b { color: #171b20; font-weight: 600; }
.frag { background: var(--canvas); color: var(--ink); position: relative; overflow: hidden; border-radius: 16px;
  box-shadow: 0 0 0 1px rgba(0,0,0,.08), 0 12px 32px rgba(0,0,0,.14); display: flex; flex-direction: column; }
.t28 { font-size: 28px; line-height: 32px; }
.t16 { font-size: 16px; line-height: 24px; }
.t14 { font-size: 14px; line-height: 20px; }
.w500 { font-weight: 500; }
.muted { color: var(--ink-muted); }
.col { width: 100%; max-width: 600px; margin: 0 auto; }
/* The Resume region (under 4 h): the lines in order, then the offline notice, then the two text actions. */
.center { padding: 20px; display: flex; flex-direction: column; gap: 12px; }
.resumeNote { display: flex; flex-direction: column; gap: 8px; padding-bottom: 12px; border-bottom: 1px solid var(--line-divider); }
.offNote { display: flex; gap: 8px; align-items: flex-start; color: var(--ink-muted); }
.offNote svg { flex: none; margin-top: 1px; }
.noteActions { display: flex; flex-wrap: wrap; column-gap: 20px; }
.noteAction { color: var(--action-text); font-weight: 500; min-height: 44px; display: inline-flex; align-items: center; }
.stepHead { font-size: 28px; line-height: 32px; font-weight: 400; }
/* The 4-hour question. */
.ask { padding: 24px 20px; display: flex; flex-direction: column; gap: 16px; }
.ask h2 { font: 400 28px/32px Inter, system-ui, sans-serif; }
.fill { min-height: 52px; border-radius: 999px; background: var(--action); color: var(--on-action); font-weight: 600;
  display: flex; align-items: center; justify-content: center; padding: 8px 16px; text-align: center; }
.quietBtn { min-height: 52px; border-radius: 999px; background: var(--surface-muted); font-weight: 600;
  display: flex; align-items: center; justify-content: center; padding: 8px 16px; text-align: center; }
.askLink { color: var(--action-text); font-weight: 500; min-height: 44px; display: inline-flex; align-items: center; }
/* The cooking-mode Done row: two sibling text buttons on one line when they fit, else stacked, right-aligned. */
.dock { flex: none; margin: 0 16px; border-top: 1px solid var(--line-divider); }
.dockRow { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; padding: 6px 0; min-height: 52px; }
.dockRow > .glyph { color: var(--attention); flex: none; }
.lab { flex: 1 1 160px; min-width: 0; display: flex; flex-direction: column; }
.figureLarge { font: 600 28px/32px Inter, system-ui, sans-serif; }
""" + DOCK_ACTS_CSS + """
.textBtn { min-height: 48px; padding: 0 16px; border-radius: 999px; display: inline-flex; align-items: center;
  color: var(--action-text); font-weight: 600; flex: none; position: relative; }
.slop .textBtn::after { content: ''; position: absolute; inset: 0; border: 1px dashed var(--attention); border-radius: 999px; }
/* The whole screen at 320 x 568. */
.screen320 { width: 320px; height: 568px; }
.top { flex: none; display: flex; align-items: center; gap: 12px; padding: 6px 16px; min-height: 60px; }
.exitBtn { width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; flex: none; }
.track { flex: none; display: flex; gap: 4px; padding: 2px 16px 0; }
.track i { flex: 1; height: 4px; border-radius: 2px; background: var(--line-divider); }
.track i.done { background: var(--ink-muted); }
.track i.now { background: var(--here-bar); }
.scroller { flex: 1; min-height: 0; overflow: hidden; position: relative; }
.scrollInner { position: relative; }
.navBlock { flex: none; padding: 8px 16px 12px; display: flex; gap: 12px; }
.btn { flex: 1; min-height: 52px; border-radius: 999px; background: var(--paper); box-shadow: inset 0 0 0 1px var(--line-control);
  display: flex; align-items: center; justify-content: center; gap: 6px; font-weight: 600; padding: 6px 12px; }
.btn svg { color: var(--action-text); flex: none; }
/* The whole content, unclipped, beside the screen: the dashed band is what the 320 x 568 screen shows. */
.strip { width: 320px; position: relative; }
.band { position: absolute; left: 2px; right: 2px; border: 2px dashed var(--attention); border-radius: 6px; pointer-events: none; }
/* Recipe detail entry. */
.entry { padding: 20px; display: flex; flex-direction: column; gap: 10px; }
.entry .fill { align-self: stretch; }
.entryMeta { color: var(--ink-muted); }
.wideEntry .fill { align-self: flex-start; min-width: 280px; padding: 8px 32px; }
.snack { margin: 8px 16px 12px; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px 12px;
  min-height: 56px; padding: 6px 6px 6px 16px; border-radius: 14px; background: var(--inverse); color: var(--inverse-ink); }
.snackUndo { min-height: 44px; padding: 0 14px; display: inline-flex; align-items: center; font-weight: 600; margin-left: auto; }
/* Largest text: body roles x2 (16 -> 32, 14 -> 28), the 28 role at its 28 x 2 cap (56/64), figureLarge x1.5 (42/48). */
.big .t16, .big .btn, .big .fill, .big .quietBtn, .big .noteAction, .big .askLink, .big .textBtn, .big .snack { font-size: 32px; line-height: 40px; }
.big .t14 { font-size: 28px; line-height: 40px; }
.big .t28, .big .stepHead, .big .ask h2 { font-size: 56px; line-height: 64px; }
.big .figureLarge { font-size: 42px; line-height: 48px; }
.big .dockRow > .glyph { display: none; }
.big .btn svg, .big .offNote svg, .big .exitBtn svg { width: 28px; height: 28px; }
.big .offNote svg { margin-top: 6px; }
.big .noteActions { flex-direction: column; }
"""


def fig(caption, body):
    return f'<figure>{body}<figcaption>{caption}</figcaption></figure>'


# ---- copy ----
WELCOME = '<span class="w500">Welcome back.</span> You left at step 4, 25 min ago.'
WELCOME_NOW = '<span class="w500">Welcome back.</span> You left at step 4 just now.'
WELCOME_CHANGED = (
    '<span class="w500">Welcome back.</span> This recipe was edited since you started, so you’re on step 3.'
)
RECIPE_CHANGED = 'This recipe was edited since you started.'
KEPT = 'The Roast timer kept going.'
ENDED = 'The Roast timer ended 18 min ago.'
ENDED_NOW = 'The Roast timer just ended.'
OFFLINE = 'You’re offline. This recipe and your timers still work.'
STEP4 = 'Roast 20 min at 220°C, then check the chicken.'
STEP3 = 'Toss the potatoes in 2 tbsp oil and tip them round the chicken.'


def resume_region(lines, offline=False, step=STEP4):
    """Under 4 h: the lines above the step. One paragraph per line, in the order the build must assert."""
    paras = ''.join(f'<p class="t16">{line}</p>' for line in lines)
    off = f'<p class="offNote t14" role="status">{svg("wifiOff", 16)}<span>{OFFLINE}</span></p>' if offline else ''
    return (
        f'<div class="center"><div class="resumeNote" role="status">{paras}{off}'
        '<span class="noteActions"><button type="button" class="noteAction t16">Start from step 1</button>'
        '<button type="button" class="noteAction t16">End this session</button></span></div>'
        f'<h2 class="stepHead" tabindex="-1">{step}</h2></div>'
    )


def done_row(slop=False, ago='ended 18 min ago'):
    cls = 'dockRow slop' if slop else 'dockRow'
    return (
        f'<div class="{cls}" role="group" aria-label="Roast timer"><span class="glyph">{svg("bell", 22)}</span>'
        f'<div class="lab"><span class="figureLarge">Done</span><span class="t14 muted">Roast · step 4 · {ago}</span></div>'
        '<span class="dockActs"><button type="button" class="textBtn t16" aria-label="Add 10 minutes to the Roast timer">+ 10 min</button>'
        '<button type="button" class="textBtn t16" aria-label="Clear the Roast timer">Clear</button></span></div>'
    )


def frag(theme, width, inner, cls='', dock=False, ago='ended 18 min ago'):
    dock_html = f'<div class="dock">{done_row(ago=ago)}</div>' if dock else ''
    return f'<div class="frag {cls}" data-theme="{theme}" style="width:{width}px">{inner}{dock_html}</div>'


def col(inner, wide):
    return f'<div class="col">{inner}</div>' if wide else inner


def ask(lines, n=4):
    paras = ''.join(f'<p class="t16">{line}</p>' for line in lines)
    return (
        '<div class="ask"><h2 tabindex="-1">Carry on from earlier?</h2>'
        f'<div class="resumeNote">{paras}<p class="t16">Your finished steps and ticks are kept. If you already ate it, end the session.</p></div>'
        f'<button type="button" class="fill t16">Carry on at step {n}</button>'
        '<button type="button" class="quietBtn t16">End this session</button>'
        '<button type="button" class="askLink t16">Start from step 1</button></div>'
    )


WORST = [WELCOME, RECIPE_CHANGED, ENDED]


def screen320(theme, scroll_to_head=False, offset=0):
    """The whole cooking screen at 320 x 568, largest text, worst case. offset: how far the step body is scrolled."""
    inner = resume_region(WORST, offline=True)
    shift = f' style="top:-{offset}px"' if scroll_to_head else ''
    return (
        f'<div class="frag big screen320" data-theme="{theme}">'
        f'<div class="top"><button type="button" class="exitBtn" aria-label="Exit cooking mode">{svg("close", 22)}</button>'
        '<span class="t16 w500">Step 4 of 6</span></div>'
        '<div class="track" aria-hidden="true"><i class="done"></i><i class="done"></i><i class="done"></i><i class="now"></i><i></i><i></i></div>'
        f'<div class="scroller"><div class="scrollInner"{shift}>{inner}</div></div>'
        f'<div class="dock">{done_row()}</div>'
        f'<div class="navBlock"><button type="button" class="btn" aria-label="Back to step 3">{svg("back")}<span>Back</span></button>'
        f'<button type="button" class="btn" aria-label="Next step, step 5"><span>Next step</span>{svg("next")}</button></div></div>'
    )


def strip(theme, band_top, band_h):
    return (
        f'<div class="frag big strip" data-theme="{theme}">{resume_region(WORST, offline=True)}'
        f'<span class="band" style="top:{band_top}px;height:{band_h}px"></span></div>'
    )


# ---- recipe detail entry ----
# The dock carries the timer, so the entry meta names only the step.
META_STEP = f'Step{NB}4 of 6'


def entry(theme, width, meta, cls='', snack=None):
    snack_html = (
        f'<div class="snack" role="status"><span>{snack}</span><button type="button" class="snackUndo">Undo</button></div>'
        if snack
        else ''
    )
    return (
        f'<div class="frag {cls}" data-theme="{theme}" style="width:{width}px"><div class="entry">'
        '<button type="button" class="fill t16">Continue cooking</button>'
        f'<p class="entryMeta t14">{meta}</p></div>{snack_html}</div>'
    )


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
        <!-- S4a board. Design artifact, not app code. -->
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
    'Under 4 hours, Resume goes straight to the step with its '
    'lines above it, in this order, which the build must assert: 1, the welcome line (welcomeBack, welcomeBackJustNow '
    'or welcomeBackChanged); 2, recipeChanged; 3, the timer line (timerKept, timerEnded, timerEndedJustNow); 4, the '
    'offline notice. welcomeBackChanged (the step moved) and recipeChanged (the step stayed, the recipe changed) never '
    'show together. The step heading takes focus; the line region mounts empty and gets its text after the focus move, '
    'so it is announced once. At 4 hours or more, "Carry on from earlier?" comes first and takes focus, and the lines '
    'sit under it. "Just now" (under 1 minute) uses its own keys, never "just now ago". Dock rows are not live regions.'
)

DONE_NOTE = (
    'Timer ended while away and restored from storage: no alarm, no sound. The Done row carries "+ 10 min" '
    'and "Clear" as sibling buttons, named "Add 10 minutes to the Roast timer" (cooking.dock.addTenA11y) and "Clear the '
    'Roast timer" (cooking.dock.clearA11y). Each is 48 tall: at least 44 pt on iOS and 48 dp on Android. The pair sits '
    'on one line when it fits; at the largest text on a narrow screen it stacks, right-aligned, and nothing is cut. The '
    'meta reads cooking.dock.metaEnded "ended {ago} ago", or metaEndedJustNow "ended just now" under 1 minute. The step body has no "Add 10 min" of its own.'
)

ENTRY_NOTE = (
    'Recipe detail entry. "Continue cooking" replaces "Start cooking"; the meta line names only the step. The '
    'dock carries the timer, running, paused or ended, so the line has no timer clause. Before '
    'the device store is read, the slot keeps the button\'s size, empty and hidden from assistive tech, with no spinner.'
)


def worst_caption(theme):
    return f'<b>Worst case</b> · {theme}. Welcome, recipe edited, timer ended while away, offline. Four lines, then the two actions, then the step.'


def mobile(m):
    return board('Cooking mode, S4a leave and come back (mobile)', NOTE, [
        ('iPhone 390 · the Resume lines', [
            fig('<b>Just now</b> · light. Under 1 minute: welcomeBackJustNow, timerEndedJustNow and the Done row\'s '
                'cooking.dock.metaEndedJustNow "ended just now".',
                frag('light', 390, resume_region([WELCOME_NOW, ENDED_NOW]), dock=True, ago='ended just now')),
            fig('<b>Recipe edited, step moved</b> · light. welcomeBackChanged names the new step; the timer kept going.',
                frag('light', 390, resume_region([WELCOME_CHANGED, KEPT], step=STEP3))),
            fig(worst_caption('light'), frag('light', 390, resume_region(WORST, offline=True), dock=True)),
            fig(worst_caption('dark'), frag('dark', 390, resume_region(WORST, offline=True), dock=True)),
        ]),
        ('iPad 820 · step column (max 600)', [
            fig(worst_caption('light'), frag('light', 820, col(resume_region(WORST, offline=True), True))),
            fig('<b>4 hours or more, recipe edited</b> · dark. The question first, then welcomeBackChanged and the ended '
                'timer; Carry on names the new step.',
                frag('dark', 820, col(ask([WELCOME_CHANGED, 'The Roast timer ended 12 h 49 min ago.'], 3), True))),
        ]),
        ('iPhone 390 · 4 hours or more, recipe edited, timer ended while away', [
            fig('<b>Light</b>. "Carry on from earlier?" takes focus; after Carry on, the timer row reads Done.',
                frag('light', 390, ask([WELCOME_CHANGED, 'The Roast timer ended 12 h 49 min ago.'], 3))),
            fig('<b>Light, largest text</b> · 320. Everything wraps whole words; the buttons grow in height.',
                frag('light', 320, ask([WELCOME_CHANGED, 'The Roast timer ended 12 h 49 min ago.'], 3), 'big')),
        ]),
        ('Phone 320 x 568 · largest text · worst case and its scroll budget', [
            fig(f'<b>Opened</b> · light. {m["opened"]}', screen320('light')),
            fig(f'<b>Focus on the step heading</b> · light. {m["focused"]} On native, the screen opens at the top for sighted '
                'cooks; only VoiceOver and TalkBack move to the heading.', screen320('light', True, m['offset'])),
            fig(f'<b>The whole step body</b>, unclipped. {m["strip"]}', strip('light', m['bandTop'], m['bandH'])),
            fig('<b>Opened</b> · dark.', screen320('dark')),
        ]),
        ('The cooking-mode Done row', [
            fig(f'<b>iPhone 390</b> · light. {DONE_NOTE}', frag('light', 390, '', dock=True)),
            fig('<b>Android 384</b> · dark. Dashed: each button\'s 48 dp touch area.',
                f'<div class="frag" data-theme="dark" style="width:384px"><div class="dock">{done_row(True)}</div></div>'),
            fig('<b>320, largest text</b> · light. The label wraps. The two buttons do not fit one line, so they stack under it, '
                'right-aligned, each 48 tall.',
                frag('light', 320, '', 'big', dock=True)),
            fig('<b>320, largest text</b> · dark.', frag('dark', 320, '', 'big', dock=True)),
        ]),
        ('Recipe detail entry · meta line with the S4b dock', [
            fig(f'<b>Running</b> · light. {ENTRY_NOTE}', entry('light', 390, META_STEP)),
            fig('<b>Largest text</b> · 320 · light. The step-only line fits on one line; a longer line would wrap under '
                'the button, never cut.', entry('light', 320, META_STEP, 'big')),
            fig('<b>After End this session, then Undo</b> · light, largest text. The house snackbar; Undo wraps under the '
                'message. After Undo the button reads Continue cooking again, and "Cooking session restored." is '
                'announced politely.',
                entry('light', 320, META_STEP, 'big', snack='Cooking session ended')),
        ]),
    ], 2400, 5080)


def web(m):
    return board('Cooking mode, S4a leave and come back (web)', NOTE, [
        ('Web 1280 · step column (max 600)', [
            fig(worst_caption('light'), frag('light', 1280, col(resume_region(WORST, offline=True), True))),
            fig(worst_caption('dark'), frag('dark', 1280, col(resume_region(WORST, offline=True), True))),
        ]),
        ('Web 1024 and 768', [
            fig('<b>1024</b> · light. Recipe edited, step moved; just now.',
                frag('light', 1024, col(resume_region([WELCOME_CHANGED, ENDED_NOW], step=STEP3), True))),
            fig('<b>768</b> · dark. 4 hours or more, recipe edited, timer ended while away.',
                frag('dark', 768, col(ask([WELCOME_CHANGED, 'The Roast timer ended 12 h 49 min ago.'], 3), True))),
        ]),
        ('Web 390', [
            fig('<b>Just now</b> · light.', frag('light', 390, resume_region([WELCOME_NOW, ENDED_NOW]), dock=True, ago='ended just now')),
            fig(worst_caption('dark'), frag('dark', 390, resume_region(WORST, offline=True), dock=True)),
        ]),
        ('Web 320 x 568 · 200% text · worst case', [
            fig(f'<b>Opened</b> · light. {m["opened"]}', screen320('light')),
            fig(f'<b>Focus on the step heading</b> · light. {m["focused"]} The top bar, dock and Back / Next are flex '
                'siblings of the scrolling step body, not overlays, so the focus scroll cannot put the heading under '
                'them (WCAG 2.4.11).', screen320('light', True, m['offset'])),
            fig('<b>The Done row at 200%</b> · dark.', frag('dark', 320, '', 'big', dock=True)),
        ]),
        ('Recipe detail entry · meta line with the S4b dock', [
            fig(f'<b>Running</b> · light, 1280 main column. {ENTRY_NOTE}', entry('light', 600, META_STEP, 'wideEntry')),
            fig('<b>200%</b> · 320 · light. The step-only line fits on one line; a longer line would wrap under the '
                'button, never cut.', entry('light', 320, META_STEP, 'big')),
        ]),
    ], 2800, 3220)


def write(m):
    (OUT / 'CookingModeResumeS4aMobile.dc.html').write_text(prune(mobile(m), nested=True))
    (OUT / 'CookingModeResumeS4aWeb.dc.html').write_text(prune(web(m), nested=True))


if __name__ == '__main__':
    import json
    import sys

    m = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {
        'opened': '', 'focused': '', 'strip': '', 'offset': 0, 'bandTop': 0, 'bandH': 0,
    }
    write(m)
    print('ok')
