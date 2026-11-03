import asyncio
from io import BytesIO
import json
from pathlib import Path
import sys
import unittest
from zipfile import ZipFile
from openpyxl import Workbook

from fastapi import HTTPException, UploadFile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.datasets import parse_upload, select_xy
from app.main import upload_dataset
from test_result_import import xls, xlsx


def xlsm(rows):
    result = BytesIO()
    with ZipFile(BytesIO(xlsx(rows))) as source, ZipFile(result, 'w') as target:
        for member in source.namelist():
            content = source.read(member)
            if member == '[Content_Types].xml':
                content = content.replace(b'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
                                          b'application/vnd.ms-excel.sheet.macroEnabled.main+xml')
            target.writestr(member, content)
    return result.getvalue()


class SpectrumImportTests(unittest.TestCase):
    def assert_xy(self, name, content, columns):
        book = parse_upload(name, content)
        x, y = select_xy(book, None, *columns)
        self.assertEqual(x.tolist(), [3, 4, 5])
        self.assertEqual(y.tolist(), [13, 14, 15])

    def test_all_nine_formats_preserve_headered_rows_and_xy_columns(self):
        rows = [['x', 'other', 'y'], [5, 50, 15], [3, 30, 13], [4, 40, 14]]
        for ext, sep in [('csv', ','), ('txt', ' '), ('tsv', '\t'), ('dat', ';'), ('xy', ' '), ('xye', ' ')]:
            with self.subTest(ext=ext):
                data = '\n'.join(sep.join(map(str, row)) for row in rows).encode()
                self.assert_xy('test.' + ext, data, ['x', 'y'])
        for ext, writer in [('xls', xls), ('xlsx', xlsx), ('xlsm', xlsm)]:
            with self.subTest(ext=ext):
                self.assert_xy('test.' + ext, writer(rows), ['x', 'y'])

    def test_no_first_point_loss_in_headerless_text_and_spreadsheets(self):
        rows = [[3, 13], [4, 14], [5, 15]]
        samples = {'sample.xy': b'  3  13\n  4    14\n  5   15', 'sample.xls': xls(rows),
                   'sample.xlsx': xlsx(rows), 'sample.xlsm': xlsm(rows)}
        for name, data in samples.items():
            with self.subTest(name=name):
                book = parse_upload(name, data)
                x, y = select_xy(book, None, *book.sheets[0].numeric_columns)
                self.assertEqual(list(zip(x, y)), [(3, 13), (4, 14), (5, 15)])

    def test_declared_columns_with_variable_spacing_and_quoted_csv_fields(self):
        self.assert_xy('test.xye', b'# Columns: x other y\n3    30   13\n4  40  14\n5    50  15', ['x', 'y'])
        self.assert_xy('test.csv', b'x,"note, id",y\n3,"a,b",13\n4,"a,c",14\n5,"d,e",15', ['x', 'y'])

    def test_wrong_field_count_and_empty_inputs_get_specific_upload_errors(self):
        for name, content, reason in [
            ('wide.csv', b'x,y\n1,3,4\n2,5,6\n3,7,8', '列数'),
            ('short.csv', b'x,y,z\n3,13\n4,14', '列数'),
            ('declared.xy', b'# Columns: x y\n1 3 4\n2 5 6', '列数'),
            ('empty.csv', b'', '空'),
            ('comments.xy', b'# data file\n// no points\n', '空'),
            ('ambiguous.csv', b'x, x,y\n3,4,13\n4,5,14', '重复'),
        ]:
            with self.subTest(name=name):
                with self.assertRaises(HTTPException) as error:
                    asyncio.run(upload_dataset(UploadFile(BytesIO(content), filename=name)))
                self.assertEqual(error.exception.status_code, 422)
                self.assertIn(reason, error.exception.detail)

    def test_preview_preserves_missing_and_nonfinite_cells_in_rows(self):
        data = b'; export comment\nx;y\n3;13\n;14\n5;inf\n6;16'
        result = asyncio.run(upload_dataset(UploadFile(BytesIO(data), filename='sample.dat')))
        summary = result['sheets'][0]
        self.assertEqual(summary['row_count'], 4)
        self.assertEqual(summary['preview_rows'][1], {'x': None, 'y': 14})
        self.assertEqual(summary['preview_rows'][2], {'x': 5, 'y': 'Infinity'})
        json.dumps(result, allow_nan=False)

    def test_quoted_csv_fields_preserve_line_breaks_and_comment_like_content(self):
        data = '"X\nenergy","Y","备注"\n3,13,"a\n# Columns: no yes\n\n// note\n; note\nb"\n4,14,"工件,乙"'.encode()
        book = parse_upload('quoted.csv', data)
        self.assertEqual(book.sheets[0].numeric_columns, ['X\nenergy', 'Y'])
        self.assertEqual(book.sheets[0].frame.iloc[0]['备注'], 'a\n# Columns: no yes\n\n// note\n; note\nb')
        self.assertEqual(book.sheets[0].frame.iloc[1]['备注'], '工件,乙')

    def test_semicolon_delimited_text_accepts_comments_between_records(self):
        data = b'; Columns: x other y\n3;30;13\n; instrument comment\n4;40;14\n5;50;15'
        self.assert_xy('comments.dat', data, ['x', 'y'])

    def test_commas_in_tsv_labels_are_not_field_separators(self):
        data = b'X, deg\tY, counts\n3\t13\n4\t14\n5\t15'
        self.assert_xy('spectrum.tsv', data, ['X, deg', 'Y, counts'])

    def test_text_sheet_and_duplicate_chinese_headers_in_excel(self):
        workbook = Workbook()
        workbook.active.append(['说明'])
        sheet = workbook.create_sheet('谱')
        for row in [['位置', '强度', '强度'], [3, 31, 13], [4, 41, 14], [5, 51, 15]]:
            sheet.append(row)
        stream = BytesIO()
        workbook.save(stream)
        book = parse_upload('mixed.xlsx', stream.getvalue())
        self.assertEqual(book.sheets[0].numeric_columns, [])
        self.assertEqual(book.sheets[1].numeric_columns, ['位置', '强度', '强度.1'])
        self.assertEqual(select_xy(book, '谱', '位置', '强度.1')[1].tolist(), [13, 14, 15])
