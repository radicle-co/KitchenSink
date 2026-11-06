"""Tests for the side-spacing rule (owner ruling T31, 2026-11-01): 16 pt everywhere, unless a platform guideline sets
a value for that exact context and the exception cites it."""

import json
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))

from nativeTokens import side_spacing  # noqa: E402

DEVICES = json.loads((HERE / "devices.json").read_text())["devices"]


class SideSpacingTest(unittest.TestCase):
    def test_every_board_device_pads_16_on_screens_and_sheets(self) -> None:
        for key, device in DEVICES.items():
            for context in ("screen", "sheet"):
                with self.subTest(device=key, context=context):
                    self.assertEqual(side_spacing(device, context), 16)

    def test_a_cited_exception_wins_for_its_exact_context_only(self) -> None:
        rule = {
            "default": 16,
            "exceptions": [{"os": "ios", "kind": "tablet", "context": "screen", "value": 20, "source": "x"}],
        }
        ipad = DEVICES["Ipad820"]
        self.assertEqual(side_spacing(ipad, "screen", rule), 20)
        self.assertEqual(side_spacing(ipad, "sheet", rule), 16)
        self.assertEqual(side_spacing(DEVICES["Iphone390"], "screen", rule), 16)

    def test_an_exception_without_a_source_is_refused(self) -> None:
        rule = {"default": 16, "exceptions": [{"os": "ios", "kind": "tablet", "context": "screen", "value": 20}]}
        with self.assertRaises(SystemExit):
            side_spacing(DEVICES["Ipad820"], "screen", rule)


if __name__ == "__main__":
    unittest.main()
