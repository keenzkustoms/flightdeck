import importlib.util
import unittest
from pathlib import Path


def _actions():
    path = Path(__file__).resolve().parents[1] / "amy" / "workshop_actions.py"
    spec = importlib.util.spec_from_file_location("workshop_actions", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class PrinterVoiceTests(unittest.TestCase):
    def test_pause_on_big_girl(self) -> None:
        actions = _actions()
        self.assertEqual(
            actions.explicit_printer_control("Amy pause the print on Big Girl", True),
            "pause",
        )

    def test_pause_on_any_named_printer(self) -> None:
        actions = _actions()
        for phrase in (
            "pause the print on bigboy",
            "pause the print on the x1c",
            "can you pause greyhound",
        ):
            self.assertEqual(actions.explicit_printer_control(phrase, True), "pause", phrase)

    def test_resume_and_stop_stay_on_the_named_printer(self) -> None:
        actions = _actions()
        self.assertEqual(actions.explicit_printer_control("resume the print on big girl", True), "resume")
        self.assertEqual(actions.explicit_printer_control("stop the print on bigboy", True), "stop")

    def test_music_pause_is_not_a_printer(self) -> None:
        actions = _actions()
        self.assertIsNone(actions.explicit_printer_control("pause the music", False))
        self.assertIsNone(actions.explicit_printer_control("pause spotify", False))

    def test_bare_pause_without_a_printer_is_not_claimed(self) -> None:
        actions = _actions()
        self.assertIsNone(actions.explicit_printer_control("pause", False))


if __name__ == "__main__":
    unittest.main()
