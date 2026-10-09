import ast
import types
import unittest
from pathlib import Path


class UpdatePathTests(unittest.TestCase):
    def parse(self, output):
        source = Path(__file__).resolve().parents[1] / "app" / "main.py"
        tree = ast.parse(source.read_text(encoding="utf-8-sig"))
        function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "_git_dirty_entries")
        namespace = {"_run_git": lambda args: types.SimpleNamespace(returncode=0, stdout=output)}
        exec(compile(ast.Module(body=[function], type_ignores=[]), str(source), "exec"), namespace)
        return namespace["_git_dirty_entries"]()

    def test_first_unstaged_path_keeps_its_first_letter(self):
        self.assertEqual(self.parse(" M amy/viewer/graph-data.js\n"), ["amy/viewer/graph-data.js"])

    def test_multiple_status_columns_and_rename(self):
        self.assertEqual(self.parse(" M logs/runtime.log\n?? scratch.txt\nR  old.js -> new.js\n"), ["logs/runtime.log", "scratch.txt", "new.js"])

    def test_clean_checkout(self):
        self.assertEqual(self.parse(""), [])
