import sys
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.datasets import ParsedSheet, ParsedWorkbook
from app.dataset_rows import dataset_page


class DatasetRowsTests(unittest.TestCase):
    def book(self):
        frame = pd.DataFrame({'x': range(205), 'y': range(205), 'note': ['raw'] * 205})
        return ParsedWorkbook('test.xlsx', [ParsedSheet('s', frame, ['x', 'y'])])

    def test_pages_include_all_columns_last_page_and_original_order(self):
        book = self.book()
        pages = [dataset_page(book, 's', offset, 100) for offset in (0, 100, 200)]
        self.assertEqual(pages[0]['columns'], ['x', 'y', 'note'])
        self.assertEqual([row[0] for page in pages for row in page['rows']], list(range(205)))
        self.assertEqual(pages[-1]['row_numbers'], [201, 202, 203, 204, 205])
        self.assertEqual(pages[-1]['total_rows'], 205)

    def test_missing_nonfinite_text_and_dates_are_distinguishable(self):
        frame = pd.DataFrame({'v': [None, np.inf, -np.inf, 'bad', pd.Timestamp('2026-10-13')]}, index=[0, 2, 3, 4, 5])
        page = dataset_page(ParsedWorkbook('a', [ParsedSheet('s', frame, [])]), 's', 0, 100)
        self.assertEqual(page['rows'], [[None], ['Infinity'], ['-Infinity'], ['bad'], ['2026-10-13T00:00:00']])
        self.assertEqual(page['row_numbers'], [1, 3, 4, 5, 6])

    def test_duplicate_headers_and_empty_sheet(self):
        frame = pd.DataFrame([[1, 2]], columns=['x', 'x'])
        book = ParsedWorkbook('a', [ParsedSheet('s', frame, []), ParsedSheet('empty', frame.iloc[:0], [])])
        self.assertEqual(dataset_page(book, 's', 0, 10)['rows'], [[1, 2]])
        self.assertEqual(dataset_page(book, 'empty', 0, 10)['rows'], [])

    def test_invalid_sheet_and_pagination_rejected(self):
        for sheet, offset, limit in [('missing', 0, 100), ('s', -1, 100), ('s', 0, 0), ('s', 0, 501)]:
            with self.assertRaises(ValueError):
                dataset_page(self.book(), sheet, offset, limit)

    def test_out_of_range_page_is_empty_and_does_not_modify_frame(self):
        book = self.book()
        original = book.sheets[0].frame.copy(deep=True)
        self.assertEqual(dataset_page(book, 's', 1000, 100)['rows'], [])
        pd.testing.assert_frame_equal(book.sheets[0].frame, original)

    def test_endpoint_missing_and_expired_dataset(self):
        from app.main import _datasets, StoredDataset, dataset_rows, DATASET_TTL_SECONDS
        from fastapi import HTTPException
        from time import monotonic
        key = 'rows-test-expired'
        _datasets[key] = StoredDataset(self.book(), monotonic() - DATASET_TTL_SECONDS - 1)
        for dataset_id in (key, 'rows-test-missing'):
            with self.assertRaises(HTTPException) as error:
                dataset_rows(dataset_id, 's', 0, 100)
            self.assertEqual(error.exception.status_code, 404)
        self.assertNotIn(key, _datasets)
