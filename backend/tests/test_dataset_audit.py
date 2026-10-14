import unittest
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import numpy as np
import pandas as pd
from app.datasets import ParsedWorkbook, ParsedSheet, select_xy
from app.dataset_audit import select_xy_audited


class DatasetAuditTests(unittest.TestCase):
    def test_reconcile_exclusions_alignment_and_stable_duplicates(self):
        frame = pd.DataFrame({"x": [3, "bad", 1, 1, 2, np.inf, 4], "y": [30, 3, 10, 11, None, 6, "bad"]})
        book = ParsedWorkbook("a.csv", [ParsedSheet("s", frame, ["x", "y"])])
        x, y, audit = select_xy_audited(book, "s", "x", "y")
        expected = select_xy(book, "s", "x", "y")
        np.testing.assert_array_equal(x, expected[0]); np.testing.assert_array_equal(y, expected[1])
        self.assertEqual(y.tolist(), [10, 11, 30])
        self.assertEqual(audit["sheet_rows"], audit["valid_pairs"] + audit["excluded_pairs"])
        self.assertEqual(audit["source_rows"], [3, 4, 1])
        self.assertEqual(audit["duplicate_x_count"], 1)
        self.assertTrue(audit["sorting_changed"])
        self.assertEqual(audit["exclusion_reasons"], {"x_non_numeric": 1, "y_missing": 1, "x_non_finite": 1, "y_non_numeric": 1})

    def test_parsed_row_mapping_and_detail_limit(self):
        frame = pd.DataFrame({"x": [1, 2] + [None]*205, "y": [4, 5] + [" "]*205}, index=range(2, 209))
        book = ParsedWorkbook("a.csv", [ParsedSheet("s", frame, ["x", "y"])])
        _, _, audit = select_xy_audited(book, "s", "x", "y")
        self.assertEqual(audit["source_rows"], [3, 4]); self.assertFalse(audit["sorting_changed"])
        self.assertEqual(len(audit["excluded_rows"]), 200); self.assertTrue(audit["excluded_rows_truncated"])
        self.assertEqual(audit["exclusion_reasons"], {"x_missing": 205, "y_missing": 205})

    def test_invalid_input_still_rejected(self):
        book = ParsedWorkbook("a.csv", [ParsedSheet("s", pd.DataFrame({"x": [1, 2], "y": [None, 2]}), ["x"])])
        with self.assertRaises(ValueError): select_xy_audited(book, "s", "x", "y")


if __name__ == "__main__": unittest.main()
