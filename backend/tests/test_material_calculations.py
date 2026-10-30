"""二次材料参数的独立算术基准和科学适用边界。"""
import copy
import importlib
import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def peak(identifier='p1', sample='s1', position=60, width=.2, signal=7, **metadata):
    return {'id': identifier, 'sample_id': sample, 'spectrum_id': sample, 'peak_id': identifier,
            'technique': 'xrd', 'model': 'gaussian', 'status': 'valid', 'warnings': [], 'source': {},
            'metadata': metadata, 'fields': {
                'position': {'value': position, 'unit': 'deg', 'definition': 'two_theta'},
                'width': {'value': width, 'unit': 'deg', 'definition': 'fwhm'},
                'height': {'value': signal, 'unit': 'a.u.', 'definition': 'height'},
                'area': {'value': signal, 'unit': 'a.u.*cm^-1', 'definition': 'range'}}}


def size_config(mode='gaussian'):
    return {'wavelength': {'value': .15406, 'unit': 'nm'}, 'K': .9, 'K_source': '测试中指定的形状假设',
            'correction': {'mode': mode, 'source': '标样编号001', 'conditions_match': True,
                           'instrument_width': {'value': .1, 'unit': 'deg'}}}


class MaterialCalculationTests(unittest.TestCase):
    def setUp(self):
        try:
            self.runner = importlib.import_module('app.calculations.runner')
        except ModuleNotFoundError:
            self.fail('尚未实现 calculations.runner')

    def run_method(self, method, config, records=None):
        return self.runner.evaluate_request({'records': records or [peak()], 'method': method, 'config': config})

    def test_bragg_and_cubic_lattice_known_answer(self):
        response = self.run_method('lattice', {'wavelength': {'value': .15406, 'unit': 'nm'}, 'crystal_system': 'cubic', 'hkl': [1, 1, 1]})
        result = response['results'][0]
        self.assertEqual(result['status'], 'valid')
        self.assertAlmostEqual(result['values']['d']['value'], .15406)
        self.assertAlmostEqual(result['values']['a']['value'], .266839747414)

    def test_bragg_without_hkl_keeps_d_but_does_not_guess_a(self):
        result = self.run_method('lattice', {'wavelength': {'value': 1.5406, 'unit': 'angstrom'}})['results'][0]
        self.assertAlmostEqual(result['values']['d']['value'], .15406)
        self.assertNotIn('a', result['values'])

    def test_lattice_rejects_bad_hkl_crystal_unit_or_angle(self):
        base = {'wavelength': {'value': .15406, 'unit': 'nm'}, 'crystal_system': 'cubic', 'hkl': [1, 1, 1]}
        for changes in [{'hkl': [0, 0, 0]}, {'crystal_system': 'hexagonal'}, {'wavelength': {'value': 1, 'unit': 'unknown'}}]:
            self.assertEqual(self.run_method('lattice', {**base, **changes})['results'][0]['status'], 'invalid')
        self.assertEqual(self.run_method('lattice', base, [peak(position=0)])['results'][0]['status'], 'invalid')

    def test_scherrer_gaussian_lorentz_and_corrected(self):
        g = self.run_method('scherrer', size_config())['results'][0]
        self.assertAlmostEqual(g['values']['D']['value'], 52.9619267507)
        lorentz = peak(); lorentz['model'] = 'lorentz'
        l = self.run_method('scherrer', size_config('lorentz'), [lorentz])['results'][0]
        self.assertAlmostEqual(l['values']['D']['value'], .9*.15406/(math.radians(.1)*math.cos(math.radians(30))))
        c = size_config('corrected'); c['correction'].pop('instrument_width')
        r = peak(width=math.sqrt(.03)); r['metadata']['width_corrected'] = True
        self.assertAlmostEqual(self.run_method('scherrer', c, [r])['results'][0]['values']['D']['value'], g['values']['D']['value'])

    def test_instrument_interpolation_and_outside_range(self):
        config = size_config(); config['correction'].pop('instrument_width')
        config['correction']['instrument_table'] = [{'position': 40, 'width': .05}, {'position': 80, 'width': .15}]
        config['correction']['position_unit'] = 'deg'; config['correction']['width_unit'] = 'deg'
        self.assertAlmostEqual(self.run_method('scherrer', config)['results'][0]['values']['D']['value'], 52.9619267507)
        self.assertEqual(self.run_method('scherrer', config, [peak(position=90)])['results'][0]['error']['code'], 'INSTRUMENT_RANGE')

    def test_scherrer_refuses_mixed_profile_and_double_correction(self):
        record = peak(); record['model'] = 'psd_voigt1'
        self.assertEqual(self.run_method('scherrer', size_config(), [record])['results'][0]['error']['code'], 'PROFILE_MISMATCH')
        record = peak(width=.05)
        self.assertEqual(self.run_method('scherrer', size_config(), [record])['results'][0]['error']['code'], 'NONPOSITIVE_WIDTH')
        record = peak(); record['metadata']['width_corrected'] = True
        self.assertEqual(self.run_method('scherrer', size_config(), [record])['results'][0]['error']['code'], 'DOUBLE_CORRECTION')

    def test_apparent_size_requires_explicit_mode(self):
        self.assertEqual(self.run_method('scherrer', {'wavelength': {'value': .15406, 'unit': 'nm'}, 'K': .9})['results'][0]['status'], 'invalid')
        config = size_config('apparent'); config['correction'] = {'mode': 'apparent'}
        self.assertEqual(self.run_method('scherrer', config)['results'][0]['status'], 'apparent')

    def test_relative_strain_known_answer_reference_required(self):
        config = {'measured_d': {'value': .2004, 'unit': 'nm'}, 'd0': {'value': .2, 'unit': 'nm'},
                  'hkl': [1, 1, 1], 'reference_hkl': [1, 1, 1], 'reference_source': '无应力标样', 'conditions_match': True}
        result = self.run_method('strain', config)['results'][0]
        self.assertAlmostEqual(result['values']['strain']['value'], .002)
        self.assertAlmostEqual(result['values']['microstrain']['value'], 2000)
        config['reference_hkl'] = [2, 0, 0]
        self.assertEqual(self.run_method('strain', config)['results'][0]['error']['code'], 'REFERENCE_MISMATCH')

    def wh_records(self, strain=.001, intercept=.9*.15406/50):
        records = []
        for i, angle in enumerate([30, 45, 60, 75, 90]):
            theta = math.radians(angle/2)
            record = peak(str(i), position=angle, width=math.degrees((intercept+4*strain*math.sin(theta))/math.cos(theta)), phase='alpha')
            record['model'] = 'lorentz'; record['metadata']['width_corrected'] = True
            records.append(record)
        return records

    def wh_config(self):
        config = size_config('corrected'); config['correction'].pop('instrument_width')
        return {**config, 'profile': 'lorentz', 'isotropic': True, 'phase': 'alpha', 'group_by': 'sample'}

    def test_wh_five_peak_recovery_and_diagnostics(self):
        result = self.run_method('williamson_hall', self.wh_config(), self.wh_records())['results'][0]
        self.assertEqual(result['status'], 'valid')
        self.assertAlmostEqual(result['values']['D']['value'], 50)
        self.assertAlmostEqual(result['values']['epsilon_WH']['value'], .001)
        self.assertEqual(len(result['details']['points']), 5)
        self.assertEqual(len(result['details']['residuals']), 5)

    def test_wh_rejects_negative_slope_insufficient_or_mixed_phase(self):
        negative = self.run_method('williamson_hall', self.wh_config(), self.wh_records(-.0001))['results'][0]
        self.assertEqual(negative['status'], 'invalid')
        self.assertLess(negative['details']['slope'], 0)
        self.assertNotIn('D', negative['values'])
        for records in [self.wh_records()[:2], [peak('a', phase='a'), peak('b', phase='b'), peak('c', phase='a')]]:
            self.assertEqual(self.run_method('williamson_hall', self.wh_config(), records)['results'][0]['status'], 'invalid')

    def calibration_config(self):
        return {'response_field': 'area', 'response_definition': 'range', 'signal_unit': 'a.u.*cm^-1',
                'component': '示例组分', 'concentration_unit': 'mg/mL', 'concentration_kind': 'concentration',
                'standards': [{'concentration': 0, 'signal': 1}, {'concentration': 2, 'signal': 5}, {'concentration': 4, 'signal': 9}],
                'calibration_source': '标样系列001', 'measurement_conditions': '相同ATR条件', 'conditions_match': True,
                'signal_basis': 'absorbance', 'background': 'line', 'integration_range': [1000, 1100]}

    def test_calibration_known_answer_and_ftIR_semantics(self):
        record = peak(); record['technique'] = 'ftir'
        result = self.run_method('calibration', self.calibration_config(), [record])['results'][0]
        self.assertAlmostEqual(result['values']['concentration']['value'], 3)
        self.assertAlmostEqual(result['details']['slope'], 2)
        self.assertAlmostEqual(result['details']['intercept'], 1)
        config = self.calibration_config(); config['signal_basis'] = 'transmittance'
        self.assertEqual(self.run_method('calibration', config, [record])['results'][0]['error']['code'], 'SIGNAL_BASIS')

    def test_calibration_no_extrapolation_or_missing_standards(self):
        self.assertEqual(self.run_method('calibration', self.calibration_config(), [peak(signal=11)])['results'][0]['error']['code'], 'CALIBRATION_RANGE')
        config = self.calibration_config(); config['standards'] = config['standards'][:2]
        self.assertEqual(self.run_method('calibration', config)['results'][0]['error']['code'], 'INSUFFICIENT_STANDARDS')

    def test_batch_error_isolation_and_no_input_mutation(self):
        records = [peak('good', 'a'), peak('bad', 'b', position=0)]
        original = copy.deepcopy(records)
        result = self.run_method('lattice', {'wavelength': {'value': .15406, 'unit': 'nm'}}, records)
        self.assertEqual([r['status'] for r in result['results']], ['valid', 'invalid'])
        self.assertEqual(records, original)

    def test_unrelated_invalid_field_does_not_block_valid_scientific_input(self):
        record = peak(); record['status'] = 'invalid'; record['fields']['area']['value'] = None
        record['warnings'] = ['面积缺失']
        result = self.run_method('lattice', {'wavelength': {'value': .15406, 'unit': 'nm'}}, [record])['results'][0]
        self.assertEqual(result['status'], 'valid')
        self.assertIn('面积缺失', result['warnings'])

    def test_existing_calibration_coefficients_and_fraction_physical_range(self):
        config = self.calibration_config(); config['standards'] = []
        config['coefficients'] = {'slope': 2, 'intercept': 1, 'min_concentration': 0, 'max_concentration': 4, 'source': '验证过的校准档案'}
        self.assertAlmostEqual(self.run_method('calibration', config)['results'][0]['values']['concentration']['value'], 3)
        config['concentration_kind'] = 'mass_fraction'; config['concentration_unit'] = '1'
        self.assertEqual(self.run_method('calibration', config)['results'][0]['error']['code'], 'CALIBRATION_RANGE')

    def test_malformed_scientific_configuration_returns_issue(self):
        for config in [{**self.calibration_config(), 'concentration_kind': []},
                       {**self.calibration_config(), 'signal_unit': []}]:
            response = self.runner.validate_request({'records': [peak()], 'method': 'calibration', 'config': config})
            self.assertFalse(response['valid'])

    def test_wh_nonpositive_intercept_retains_fit_without_false_size(self):
        result = self.run_method('williamson_hall', self.wh_config(), self.wh_records(.001, -.0001))['results'][0]
        self.assertEqual(result['status'], 'invalid')
        self.assertLessEqual(result['details']['intercept'], 0)
        self.assertNotIn('D', result['values'])

    def test_invalid_metadata_integration_range_is_isolated_per_record(self):
        for interval in [1, '1000,1100', [1000], [1000, 'bad'], [1100, 1000]]:
            records = [peak('bad', 'a', integration_range=interval), peak('good', 'b')]
            result = self.run_method('calibration', self.calibration_config(), records)['results']
            self.assertEqual(result[0]['status'], 'invalid')
            self.assertEqual(result[0]['error']['code'], 'INTEGRATION_RANGE')
            self.assertEqual(result[1]['status'], 'valid')


if __name__ == '__main__':
    unittest.main()
