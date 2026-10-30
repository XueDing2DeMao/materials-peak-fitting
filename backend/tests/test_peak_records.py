import importlib.util
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


class PeakRecordTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(importlib.util.find_spec('app.peak_records'), '标准峰记录尚未实现')
        from app import peak_records
        self.m = peak_records

    def test_quantity_rejects_nonfinite_and_negative_uncertainty(self):
        for values in ({'value': float('nan')}, {'value': 1, 'standard_error': -1}):
            with self.assertRaises(ValueError):
                self.m.Quantity.model_validate(values)

    def test_safe_json_rejects_unsafe_keys_nonfinite_and_excess_depth(self):
        for value in ({'x': float('inf')}, {'__proto__': {}}, {'x': object()}):
            with self.assertRaises(ValueError): self.m.validate_json_value(value)
        nested = 1
        for _ in range(40): nested = {'x': nested}
        with self.assertRaises(ValueError): self.m.validate_json_value(nested)

    def test_internal_single_uses_continuous_geometry_without_fake_error(self):
        result = {'model': 'psd_voigt2', 'parameters': {'xc': {'value': 60, 'standard_error': .01}, 'wG': {'value': .1}},
                  'peak_geometry': {'peak_position': 60, 'fwhm': .4, 'peak_height': 12, 'area_total': 8},
                  'statistics': {'rmse': 2, 'r_squared': .9}, 'converged': True}
        a = self.m.adapt_internal_result('single', result, mode='xrd')
        p = a['records'][0]
        self.assertEqual(p['fields']['width']['value'], .4)
        self.assertEqual(p['fields']['position']['definition'], 'two_theta')
        self.assertIsNone(p['fields']['width']['standard_error'])
        self.assertEqual(a['spectra'][0]['metrics']['rmse']['value'], 2)
        self.assertEqual(p['fields']['position']['standard_error'], .01)
        json.dumps(a, allow_nan=False)

    def test_internal_multi_preserves_source_and_bad_fit_warning(self):
        result = {'components': [{'id': 'p1', 'label': 'A', 'model': 'gaussian',
                  'parameters': {'xc': {'value': 1}, 'w': {'value': 2}},
                  'peak_geometry': {'peak_position': 1, 'fwhm': 2, 'peak_height': 3, 'area_total': 4}}],
                  'statistics': {'rmse': .1}, 'converged': False, 'diagnostics': {'warnings': ['贴边']}}
        a = self.m.adapt_internal_result('multi', result, source={'filename': 'a.csv', 'file_sha256': 'a'*64, 'sheet': 'S'}, metadata={'attempt_id': 't1'})
        p = a['records'][0]
        self.assertEqual(p['source']['file_sha256'], 'a'*64)
        self.assertEqual(p['metadata']['attempt_id'], 't1')
        self.assertEqual(p['status'], 'review')
        self.assertTrue(any('收敛' in w for w in p['warnings']))

    def test_explicit_invalid_geometry_is_not_replaced_with_model_parameters(self):
        result = {'model': 'gaussian', 'converged': True,
                  'parameters': {'A': {'value': 0}, 'xc': {'value': 60, 'standard_error': .1}, 'w': {'value': .2}},
                  'peak_geometry': {'peak_position': None, 'fwhm': None, 'area_total': 0, 'peak_height': 0,
                                    'reasons': {'peak_position': '峰面积为零，无有效峰顶', 'fwhm': '峰面积为零，无有效宽度'}}}
        r = self.m.adapt_internal_result('single', result, mode='xrd')['records'][0]
        self.assertIsNone(r['fields']['position']['value'])
        self.assertIsNone(r['fields']['position']['standard_error'])
        self.assertIsNone(r['fields']['width']['value'])
        self.assertEqual(r['fields']['area']['value'], 0)
        self.assertIn('面积为零', r['fields']['position']['reason'])
        del result['peak_geometry']
        r = self.m.adapt_internal_result('single', result, mode='xrd')['records'][0]
        self.assertEqual(r['fields']['position']['value'], 60)
        self.assertEqual(r['fields']['position']['source_column'], 'parameters.xc.value')

    def test_external_records_need_no_raw_spectrum(self):
        p = self.m.PeakRecord.model_validate({'id': 'r', 'sample_id': 's', 'spectrum_id': 'sp', 'peak_id': 'p',
            'fields': {'position': {'value': 60, 'unit': 'deg', 'definition': 'two_theta'}},
            'source': {'filename': 'a', 'file_sha256': 'b'*64, 'sheet': 'S', 'row': 2}})
        self.assertIsNone(p.fields.width.value)

    def test_internal_identity_includes_column_and_result_revision(self):
        result = {'model': 'gaussian', 'parameters': {'xc': {'value': 60}, 'w': {'value': .2}}, 'converged': True}
        source = {'filename': 'a.xlsx', 'file_sha256': 'a'*64, 'sheet': 'S', 'x_column': 'x', 'y_column': 'y1'}
        first = self.m.adapt_internal_result('single', result, source, 'xrd')['records'][0]
        second = self.m.adapt_internal_result('single', result, {**source, 'y_column': 'y2'}, 'xrd')['records'][0]
        changed = self.m.adapt_internal_result('single', {**result, 'converged': False}, source, 'xrd')['records'][0]
        self.assertEqual(len({first['id'], second['id'], changed['id']}), 3)
        self.assertEqual(first['source']['y_column'], 'y1')

    def test_normalized_analysis_validates_ids_references_and_mapping_json(self):
        p = {'id': 'r', 'sample_id': 's', 'spectrum_id': 'sp', 'peak_id': 'p',
             'source': {'filename': 'a'}}
        for payload in ({'records': [p], 'spectra': []},
                        {'records': [p, p], 'spectra': [{'id': 'sp', 'sample_id': 's'}]},
                        {'mapping': {'__proto__': {}}, 'records': [], 'spectra': []}):
            with self.assertRaises(ValueError): self.m.NormalizedAnalysis.model_validate(payload)

    def test_malformed_internal_shapes_are_validation_errors(self):
        for engine, result in [('single', {'parameters': None}), ('multi', {'components': [None]}),
                               ('single', {'diagnostics': {'warnings': 'bad'}}),
                               ('multi', {'components': 'bad'})]:
            with self.subTest(result=result):
                with self.assertRaises(ValueError): self.m.adapt_internal_result(engine, result)


if __name__ == '__main__': unittest.main()
