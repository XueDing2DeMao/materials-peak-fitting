import hashlib
import importlib.util
import io
import json
import math
import struct
import sys
import unittest
from pathlib import Path

from openpyxl import Workbook

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def xlsx(rows):
    w = Workbook(); s = w.active; s.title = 'Results'
    for row in rows: s.append(row)
    b = io.BytesIO(); w.save(b); return b.getvalue()


def xls(rows):
    # 最小真实 BIFF8 工作簿；不依赖额外写入库。
    def rec(code, data=b''): return struct.pack('<HH', code, len(data)) + data
    def bof(kind): return rec(0x0809, struct.pack('<HHHHII', 0x0600, kind, 0x0DBB, 0x07CC, 0, 6))
    name = b'Results'
    bound = lambda offset: rec(0x0085, struct.pack('<IBBBB', offset, 0, 0, len(name), 0) + name)
    prefix = bof(5) + rec(0x0042, struct.pack('<H', 1200))
    offset = len(prefix + bound(0) + rec(0x000A))
    data = prefix + bound(offset) + rec(0x000A) + bof(0x10)
    data += rec(0x0200, struct.pack('<IIHHH', 0, len(rows), 0, max(map(len, rows)), 0))
    for r, row in enumerate(rows):
        for c, value in enumerate(row):
            if isinstance(value, (float, int)): data += rec(0x0203, struct.pack('<HHHd', r, c, 0, value))
            elif value is not None:
                text = str(value).encode('utf-16le')
                data += rec(0x0204, struct.pack('<HHHHB', r, c, 0, len(str(value)), 1) + text)
    return data + rec(0x000A)


class ResultImportTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(importlib.util.find_spec('app.result_import'), '结果导入尚未实现')
        from app.result_import.readers import read_result_file, table_page
        from app.result_import.mapping import suggest_mapping
        from app.result_import.normalize import normalize_result
        self.read, self.page, self.suggest, self.normalize = read_result_file, table_page, suggest_mapping, normalize_result

    def mapping(self, sheet='数据', **changes):
        return dict(sheet=sheet, layout='wide', header_row=1, columns={'peak_id': 'Peak', 'position': 'Center', 'width': 'Width', 'height': 'Height', 'area': 'Area', 'rmse': 'RMSE'},
                    units={'position': 'deg', 'width': 'deg', 'height': 'a.u.', 'area': 'a.u.*deg'}, width_definition='fwhm',
                    position_definition='two_theta', area_definition='total', default_model='gaussian', technique='xrd', **changes)

    def test_single_row_csv_xlsx_xls_are_equivalent(self):
        rows = [['Peak', 'Center', 'Width', 'Height', 'Area', 'RMSE'], ['p1', 60, .2, 100, 21, .01]]
        sources = [('a.csv', b'Peak,Center,Width,Height,Area,RMSE\np1,60,.2,100,21,.01\n', '数据'),
                   ('a.xlsx', xlsx(rows), 'Results'), ('a.xls', xls(rows), 'Results')]
        for name, data, sheet in sources:
            with self.subTest(name=name):
                a = self.normalize(self.read(name, data), self.mapping(sheet))
                self.assertEqual(len(a['records']), 1)
                r = a['records'][0]
                self.assertEqual(r['fields']['position']['value'], 60)
                self.assertEqual(r['source']['row'], 2)
                self.assertEqual(r['source']['file_sha256'], hashlib.sha256(data).hexdigest())
                self.assertEqual(a['spectra'][0]['metrics']['rmse']['value'], .01)
                self.assertIsNone(r['fields']['position']['standard_error'])

    def test_header_range_pagination_keep_actual_rows_and_multiline_csv_location(self):
        data = b'note\nPeak,Center,Width,Height,Area,RMSE\n"p\none",60,.2,1,2,.1\n\np2,70,.3,1,2,.1\n'
        b = self.read('a.csv', data)
        p = self.page(b, '数据', header_row=2, offset=0, limit=1)
        self.assertEqual(p['row_numbers'], [3])
        self.assertEqual(p['locations'][0]['physical_line_end'], 4)
        m = self.mapping(); m.update(header_row=2, data_start_row=5, data_end_row=5)
        a = self.normalize(b, m)
        self.assertEqual(len(a['records']), 1)
        self.assertEqual(a['records'][0]['peak_id'], 'p2')
        self.assertEqual(a['records'][0]['source']['row'], 5)

    def test_long_table_groups_parameters_and_spectrum_metrics_with_se(self):
        data = b'Sample,Spectrum,Peak,Parameter,Value,Unit,SE,Scope\ns1,sp1,p1,Center,60,deg,.01,peak\ns1,sp1,p1,FWHM,.2,deg,.02,peak\ns1,sp1,p1,Area,21,a.u.*deg,,peak\ns1,sp1,,RMSE,.1,a.u.,,spectrum\n'
        m = self.mapping(); m.update(layout='long', columns={'sample_id': 'Sample', 'spectrum_id': 'Spectrum', 'peak_id': 'Peak', 'parameter': 'Parameter', 'value': 'Value', 'unit': 'Unit', 'standard_error': 'SE', 'scope': 'Scope'})
        a = self.normalize(self.read('a.csv', data), m)
        self.assertEqual(len(a['records']), 1)
        r = a['records'][0]
        self.assertEqual(r['fields']['width']['standard_error'], .02)
        self.assertEqual(r['fields']['width']['source_row'], 3)
        self.assertEqual(a['spectra'][0]['metrics']['rmse']['value'], .1)
        self.assertEqual(a['spectra'][0]['metrics']['rmse']['source_row'], 5)

    def test_bad_rows_are_preserved_and_isolated(self):
        data = b'Peak,Center,Width,Height,Area,RMSE\np1,60,.2,1,2,.1\np2,bad,-1,1,2,.1\n'
        a = self.normalize(self.read('a.csv', data), self.mapping())
        self.assertEqual(len(a['records']), 2)
        self.assertEqual(a['records'][0]['fields']['position']['value'], 60)
        self.assertIsNone(a['records'][1]['fields']['position']['value'])
        self.assertEqual(a['records'][1]['status'], 'invalid')
        self.assertTrue(any(i['row'] == 3 and i['column'] == 'Center' for i in a['issues']))
        self.assertTrue(all(i['source_file'] == 'a.csv' and len(i['source_sha256']) == 64 and i['source_sheet'] == '数据' for i in a['issues']))
        json.dumps(a, allow_nan=False)

    def test_width_conversion_overflow_is_isolated_and_mapping_is_retained(self):
        data = b'Peak,Center,Width,Height,Area,RMSE,SE\np1,60,1e308,1,2,.1,.01\np2,60,.2,1,2,.1,1e308\np3,60,.2,1,2,.1,.01\n'
        m = self.mapping(); m['width_definition'] = 'sigma'; m['columns']['width_se'] = 'SE'
        a = self.normalize(self.read('overflow.csv', data), m)
        self.assertIsNone(a['records'][0]['fields']['width']['value'])
        self.assertIsNone(a['records'][1]['fields']['width']['standard_error'])
        self.assertAlmostEqual(a['records'][2]['fields']['width']['value'], .2*math.sqrt(8*math.log(2)))
        self.assertTrue(any(i['code'] == 'invalid_standard_error' for i in a['issues']))
        for record in a['records']:
            self.assertEqual(record['metadata']['import_mapping'], a['mapping'])
            self.assertEqual(record['metadata']['import_fingerprint'], a['fingerprint'])
        json.dumps(a, allow_nan=False)

    def test_width_sigma_hwhm_and_unknown_definitions_are_safe(self):
        b = self.read('a.csv', b'Peak,Center,Width,Height,Area,RMSE\np1,60,.2,1,2,.1\n')
        m = self.mapping(); m['width_definition'] = 'sigma'
        a = self.normalize(b, m)
        self.assertAlmostEqual(a['records'][0]['fields']['width']['value'], .2*math.sqrt(8*math.log(2)))
        self.assertEqual(a['records'][0]['fields']['width']['raw_value'], '.2')
        m['default_model'] = 'emg_high'; m['width_definition'] = 'hwhm'
        self.assertIsNone(self.normalize(b, m)['records'][0]['fields']['width']['value'])
        m['width_definition'] = 'unknown'
        self.assertIsNone(self.normalize(b, m)['records'][0]['fields']['width']['value'])

    def test_suggestions_are_ambiguous_safe_and_template_fingerprint_checked(self):
        b = self.read('a.csv', b'Peak,Center,FWHM,Height,Area,RMSE\np1,60,.2,1,2,.1\n')
        m = self.suggest(b)
        self.assertEqual(m['columns']['position'], 'Center')
        self.assertEqual(m['width_definition'], 'fwhm')
        a = self.normalize(b, m)
        repeated = self.normalize(b, {**a['mapping'], 'fingerprint': a['fingerprint']})
        self.assertEqual(repeated['fingerprint'], a['fingerprint'])
        changed = self.read('b.csv', b'Peak,Center,FWHM,Height,Changed,RMSE\np1,60,.2,1,2,.1\n')
        with self.assertRaisesRegex(ValueError, '模板|指纹|列'): self.normalize(changed, a['mapping'])

    def test_duplicate_headers_require_index_mapping(self):
        b = self.read('a.csv', b'Peak,Center,Center,Width\np1,60,61,.2\n')
        m = self.mapping(); m['columns'] = {'position': 'Center', 'width': 'Width'}
        with self.assertRaisesRegex(ValueError, '重复|歧义'): self.normalize(b, m)
        m['columns']['position'] = 1
        self.assertEqual(self.normalize(b, m)['records'][0]['fields']['position']['value'], 60)

    def test_excel_formula_without_cache_is_not_executed(self):
        b = self.read('a.xlsx', xlsx([['Peak', 'Center', 'Width'], ['p1', '=30+30', .2]]))
        m = self.mapping('Results'); m['columns'] = {'peak_id': 'Peak', 'position': 'Center', 'width': 'Width'}
        a = self.normalize(b, m)
        self.assertIsNone(a['records'][0]['fields']['position']['value'])
        self.assertTrue(any('缓存' in i['message'] for i in a['issues']))

    def test_long_duplicate_fields_and_conflicting_metrics_do_not_silently_overwrite(self):
        data = b'Peak,Parameter,Value\np1,Center,60\np1,Center,61\np1,RMSE,.1\np2,RMSE,.2\n'
        m = self.mapping(); m.update(layout='long', columns={'peak_id': 'Peak', 'parameter': 'Parameter', 'value': 'Value'})
        a = self.normalize(self.read('a.csv', data), m)
        self.assertIsNone(a['records'][0]['fields']['position']['value'])
        self.assertIsNone(a['spectra'][0]['metrics']['rmse']['value'])
        self.assertTrue(any(i['code'] == 'duplicate_field' for i in a['issues']))

    def test_unknown_units_and_missing_fields_stay_visible(self):
        b = self.read('a.csv', b'Peak,Center,Width\np1,60,.2\n')
        m = self.mapping(); m['columns'] = {'position': 'Center', 'width': 'Width'}; m['units'] = {}
        r = self.normalize(b, m)['records'][0]
        self.assertEqual(r['fields']['position']['unit'], 'unknown')
        self.assertIsNone(r['fields']['area']['value'])
        self.assertEqual(r['status'], 'review')

    def test_limits_binary_and_pagination_validation(self):
        with self.assertRaises(ValueError): self.read('x.csv', b'\x00\x01\x02')
        b = self.read('a.csv', b'x,y\n1,2\n')
        for kwargs in ({'limit': 501}, {'offset': -1}, {'header_row': 0}):
            with self.assertRaises(ValueError): self.page(b, '数据', **kwargs)

    def test_named_template_survives_column_reordering(self):
        b = self.read('a.csv', b'Peak,Center,Width,Height,Area,RMSE\np1,60,.2,1,2,.1\n')
        saved = self.normalize(b, self.mapping())['mapping']
        reordered = self.read('b.csv', b'Center,Peak,RMSE,Area,Width,Height\n70,p2,.2,4,.3,2\n')
        r = self.normalize(reordered, saved)['records'][0]
        self.assertEqual(r['fields']['position']['value'], 70)
        self.assertEqual(r['fields']['width']['value'], .3)

    def test_long_template_detects_changed_source_units(self):
        data = b'Peak,Parameter,Value,Unit\np1,Center,60,deg\np1,FWHM,.2,deg\n'
        m = self.mapping(); m.update(layout='long', columns={'peak_id': 'Peak', 'parameter': 'Parameter', 'value': 'Value', 'unit': 'Unit'})
        saved = self.normalize(self.read('a.csv', data), m)['mapping']
        with self.assertRaisesRegex(ValueError, '模板|指纹'):
            self.normalize(self.read('b.csv', data.replace(b'deg', b'rad')), saved)

    def test_duplicate_wide_peak_identity_is_flagged(self):
        data = b'Peak,Center,Width,Height,Area,RMSE\np1,60,.2,1,2,.1\np1,61,.2,1,2,.1\n'
        a = self.normalize(self.read('a.csv', data), self.mapping())
        self.assertEqual(len(a['records']), 2)
        self.assertTrue(any(i['code'] == 'duplicate_peak_id' for i in a['issues']))
        self.assertEqual(len({r['id'] for r in a['records']}), 2)

    def test_routes_upload_page_normalize_and_missing_cache(self):
        import asyncio
        from fastapi import FastAPI, HTTPException, UploadFile
        from app.result_import.routes import router, upload_results, result_rows, normalize_upload, NormalizePayload
        app = FastAPI(); app.include_router(router)
        self.assertIn('/api/peak-results/from-fit', app.openapi()['paths'])
        uploaded = asyncio.run(upload_results(UploadFile(filename='a.csv', file=io.BytesIO(b'Peak,Center,Width,Height,Area,RMSE\np1,60,.2,1,2,.1\n')), header_row=1))
        identity = uploaded['upload_id']
        self.assertEqual(result_rows(identity, '数据', 0, 100, 1)['row_numbers'], [2])
        normalized = normalize_upload(NormalizePayload(upload_id=identity, mapping=self.mapping()))
        self.assertEqual(len(normalized['records']), 1)
        with self.assertRaises(HTTPException) as missing:
            normalize_upload(NormalizePayload(upload_id='missing', mapping=self.mapping()))
        self.assertEqual(missing.exception.status_code, 404)
        with self.assertRaises(HTTPException) as invalid:
            result_rows(identity, '数据', 0, 501, 1)
        self.assertEqual(invalid.exception.status_code, 422)

    def test_semicolon_decimal_comma_is_not_silently_reinterpreted(self):
        b = self.read('a.csv', b'Peak;Center;Width;Height;Area;RMSE\np1;60,5;0,2;1;2;0,1\n')
        a = self.normalize(b, self.mapping())
        self.assertIsNone(a['records'][0]['fields']['position']['value'])
        self.assertTrue(any('小数逗号' in i['message'] for i in a['issues']))

    def test_width_conversion_scales_standard_error_and_preserves_coordinate(self):
        b = self.read('a.xlsx', xlsx([['Peak', 'Center', 'Width', 'Width SE'], ['p1', 60, .2, .01]]))
        m = self.mapping('Results'); m.update(width_definition='sigma', columns={'peak_id': 'Peak', 'position': 'Center', 'width': 'Width', 'width_se': 'Width SE'})
        q = self.normalize(b, m)['records'][0]['fields']['width']
        self.assertAlmostEqual(q['standard_error'], .01*math.sqrt(8*math.log(2)))
        self.assertEqual(q['source_cell'], 'C2')
        self.assertEqual(q['standard_error_cell'], 'D2')

    def test_mapping_rejects_boolean_column_reference_and_unknown_parameter_alias(self):
        from app.result_import.mapping import ResultMapping
        for changes in ({'columns': {'position': True}}, {'parameter_aliases': {'weird': 'executable'}}):
            m = self.mapping(); m.update(changes)
            with self.assertRaises(ValueError): ResultMapping.model_validate(m)

    def test_long_group_model_conflict_is_explicit(self):
        data = b'Peak,Parameter,Value,Model\np1,Center,60,gaussian\np1,Sigma,.2,lorentz\n'
        m = self.mapping(); m.update(layout='long', columns={'peak_id': 'Peak', 'parameter': 'Parameter', 'value': 'Value', 'model': 'Model'})
        a = self.normalize(self.read('a.csv', data), m)
        self.assertTrue(any(i['code'] == 'conflicting_model' for i in a['issues']))
        self.assertIsNone(a['records'][0]['fields']['width']['value'])


if __name__ == '__main__': unittest.main()
