"""Tests for `phoneOnly`: a state the iPad never shows (e.g. the ingredients sheet, when the iPad keeps the
ingredients beside the steps) gets phone boards and no iPad board, with its reason recorded, like `webOnly`."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import buildNativeBoards as build  # noqa: E402

PAGE = "phoneOnlyTestPage"


class PhoneOnlyTest(unittest.TestCase):
    def tearDown(self) -> None:
        build.LAYOUTS.pop(PAGE, None)

    def test_a_phone_only_state_is_built_for_phones_and_not_the_ipad(self) -> None:
        build.LAYOUTS[PAGE] = {"phoneOnly": {"ThingSheet": "the iPad keeps it on screen"}}
        self.assertEqual(build.devices_for(PAGE, "ThingSheet"), ["Iphone390", "Android384"])
        self.assertEqual(build.devices_for(PAGE, "Thing"), list(build.DEVICES))

    def test_a_phone_only_entry_needs_a_reason(self) -> None:
        build.LAYOUTS[PAGE] = {"phoneOnly": {"ThingSheet": ""}}
        with self.assertRaises(SystemExit):
            build.devices_for(PAGE, "ThingSheet")


if __name__ == "__main__":
    unittest.main()
