"""Drops CSS rules whose class selectors match nothing in a board's markup .

prune(html, keep=frozenset()) -> html. A rule is a selector list; each selector survives when every class it names is
used in the markup outside <style>, or the class is in `keep` (classes already dead on the base, which this
change must leave alone). A rule with no surviving selector is removed, and a comment goes with the rule right
after it. @media blocks are pruned inside, and dropped when empty.

CLI: python3 -I pruneCss.py <worktree> <base> -- prunes every staged .dc.html that differs from <base>.
"""

from html.parser import HTMLParser
import re
from pathlib import Path
import subprocess
import sys

CLASS = re.compile(r'\.(-?[A-Za-z_][\w-]*)')


def used_classes(html):
    body = re.sub(r'<style[^>]*>.*?</style>', '', html, flags=re.S)
    used = set()
    for c in re.findall(r'class(?:Name)?=["\']([^"\']*)["\']', body):
        used |= set(c.split())
    used |= set(re.findall(r'classList\.\w+\(["\']([\w-]+)', body))
    return used


VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'}


class _Tree(HTMLParser):
    """Each element as (tag, classes, ancestor classes), for the nested check."""

    def __init__(self):
        super().__init__()
        self.stack, self.nodes = [], []

    def handle_starttag(self, tag, attrs):
        cls = set((dict(attrs).get('class') or '').split())
        anc = set().union(*(s[1] for s in self.stack)) if self.stack else set()
        self.nodes.append((tag, cls, anc))
        if tag not in VOID:
            self.stack.append((tag, cls))

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]
                break


def element_tree(html):
    t = _Tree()
    t.feed(re.sub(r'<style[^>]*>.*?</style>', '', html, flags=re.S))
    return t.nodes


COMPOUND = re.compile(r'^([a-z][a-z0-9]*)?((?:\.[A-Za-z_][\w-]*)*)$')


def nested_match(sel, nodes):
    """True when a plain descendant selector (tags and classes, spaces only) matches some element, or when the
    selector is not of that plain form (then the class rule alone decides)."""
    parts = sel.split()
    comps = [COMPOUND.match(p) for p in parts]
    if len(parts) < 2 or not all(comps):
        return True
    last = comps[-1]
    need_anc = set()
    for c in comps[:-1]:
        need_anc |= set(CLASS.findall(c.group(2)))
    last_cls = set(CLASS.findall(last.group(2)))
    return any(
        (last.group(1) in (None, tag)) and last_cls <= cls and need_anc <= anc for tag, cls, anc in nodes
    )


def _tokens(css):
    """Top-level items: ('comment', text), ('rule', selector, block), ('at', prelude, inner), ('ws', text)."""
    i, out = 0, []
    while i < len(css):
        if css.startswith('/*', i):
            j = css.index('*/', i) + 2
            out.append(('comment', css[i:j]))
            i = j
        elif css[i].isspace():
            j = i
            while j < len(css) and css[j].isspace():
                j += 1
            out.append(('ws', css[i:j]))
            i = j
        else:
            j = css.index('{', i)
            depth, k = 1, j + 1
            while depth:
                if css.startswith('/*', k):
                    k = css.index('*/', k) + 2
                    continue
                depth += {'{': 1, '}': -1}.get(css[k], 0)
                k += 1
            head, inner = css[i:j], css[j + 1 : k - 1]
            out.append(('at', head, inner) if head.lstrip().startswith('@') else ('rule', head, inner))
            i = k
    return out


def _split_selectors(head):
    parts, depth, cur = [], 0, ''
    for ch in head:
        if ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
        if ch == ',' and depth == 0:
            parts.append(cur)
            cur = ''
        else:
            cur += ch
    return parts + [cur]


def _prune_css(css, used, keep, nodes=None):
    items = _tokens(css)
    kept = []
    for it in items:
        if it[0] == 'rule':
            sels = [
                s
                for s in _split_selectors(it[1])
                if all(c in used or c in keep for c in CLASS.findall(s)) and (nodes is None or nested_match(s, nodes))
            ]
            if not sels:
                kept.append(None)
                continue
            head = it[1]
            lead, tail = head[: len(head) - len(head.lstrip())], head[len(head.rstrip()):]
            kept.append(lead + ','.join(sels).strip() + tail + '{' + it[2] + '}')
        elif it[0] == 'at':
            if it[1].lstrip().startswith(('@media', '@supports', '@container')):
                inner = _prune_css(it[2], used, keep, nodes)
                kept.append(f'{it[1]}{{{inner}}}' if inner.strip() else None)
            else:
                kept.append(f'{it[1]}{{{it[2]}}}')
        else:
            kept.append(it[1])
    out, dropped = [], False
    for n, it in enumerate(items):
        if it[0] == 'ws':
            if not dropped:
                out.append(it[1])
            continue
        if it[0] == 'comment':
            # a comment describes the rule right after it: it goes when that rule goes, so it never lands on another
            nxt = next((m for m in range(n + 1, len(items)) if items[m][0] != 'ws'), None)
            dropped = nxt is not None and items[nxt][0] in ('rule', 'at') and kept[nxt] is None
        else:
            dropped = kept[n] is None
        if not dropped:
            out.append(kept[n])
    return ''.join(out)


def prune(html, keep=frozenset(), nested=False):
    """nested=True also drops a plain descendant selector (".big .ask h2") that no element matches. Builders of new
    boards use it; the CLI over edited base boards does not, so a base board's own dead combinations stay."""
    used = used_classes(html)
    nodes = element_tree(html) if nested else None
    return re.sub(
        r'(<style[^>]*>)(.*?)(</style>)',
        lambda m: m.group(1) + _prune_css(m.group(2), used, keep, nodes) + m.group(3),
        html,
        flags=re.S,
    )


def dead_classes(html):
    """Classes named in a selector that the markup does not use (the audit's unit)."""
    used = used_classes(html)
    dead = set()
    for m in re.finditer(r'<style[^>]*>(.*?)</style>', html, flags=re.S):
        stack = [m.group(1)]
        while stack:
            for it in _tokens(stack.pop()):
                if it[0] == 'rule':
                    dead |= {c for c in CLASS.findall(it[1]) if c not in used}
                elif it[0] == 'at':
                    stack.append(it[2])
    return dead


if __name__ == '__main__':
    wt, base = sys.argv[1:3]
    def git(*a):
        return subprocess.run(['git', '-C', wt, *a], capture_output=True, text=True)

    files = [f for f in git('diff', '--cached', '--name-only', base).stdout.split() if f.endswith('.dc.html')]
    for f in files:
        b = git('show', f'{base}:{f}')
        keep = frozenset(dead_classes(b.stdout)) if b.returncode == 0 else frozenset()
        path = f'{wt}/{f}'
        t = Path(path).read_text(encoding='utf-8')
        t2 = prune(t, keep)
        if t2 != t:
            Path(path).write_text(t2, encoding='utf-8')
            print('pruned', f, len(t) - len(t2), 'chars')
