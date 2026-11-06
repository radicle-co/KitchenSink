"""The native build check: a native board may carry only what React Native, and so Tamagui, can draw.

It refuses CSS grid (Yoga is flexbox only), hover and cursor (no pointer on a phone), backdrop blur (tamaguiAudit.md
X1), sticky and fixed positioning (the native frame pins bars, not CSS), balanced titles on iOS (X2), underline
thickness (X3), weights above 600 and type sizes off the 14/16/18/28 scale (owner ruling T1). The build stops on any
finding, so "looks native" is a gate, not a review note.
"""

import re

SCALE = {14, 16, 18, 28}
STYLE_BLOCK = re.compile(r"<style\b[^>]*>(.*?)</style>", re.S)
INLINE = re.compile(r'\bstyle="([^"]*)"')
RULES = (
    ("CSS grid (React Native lays out with flexbox only)", re.compile(r"display:\s*(?:inline-)?grid|grid-template")),
    ("hover state (no pointer on touch)", re.compile(r":hover")),
    ("cursor (no pointer on touch)", re.compile(r"\bcursor\s*:")),
    ("backdrop blur (tamaguiAudit X1: solid paperRaised)", re.compile(r"backdrop-filter")),
    ("sticky or fixed position (the native frame pins bars)", re.compile(r"position:\s*(?:sticky|fixed)")),
    ("underline thickness (tamaguiAudit X3)", re.compile(r"text-decoration-thickness")),
    ("weight above 600", re.compile(r"font-weight:\s*(?:[7-9]00|bold(?:er)?)\b|font:\s*(?:[7-9]00)\b")),
)
IOS_ONLY = (("balanced title (tamaguiAudit X2: iOS cannot balance)", re.compile(r"text-wrap:\s*(?:balance|pretty)")),)
SIZE = re.compile(r"font-size:\s*(\d+)px|font:\s*(?:\d{3}\s+)?(?:italic\s+)?(\d+)px")


def check_native(html: str, os_name: str) -> list[str]:
    """Every finding in a native board's own CSS and inline styles; an empty list passes."""
    css = "\n".join(STYLE_BLOCK.findall(html)) + "\n" + "\n".join(INLINE.findall(html))
    rules = RULES + (IOS_ONLY if os_name == "ios" else ())
    findings = [label for label, pattern in rules if pattern.search(css)]
    sizes = sorted({int(a or b) for a, b in SIZE.findall(css)} - SCALE)
    if sizes:
        findings.append(f"type size off the 14/16/18/28 scale: {sizes}")
    return findings
