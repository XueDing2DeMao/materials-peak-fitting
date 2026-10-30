"""用户公式的数值、量义及拒算门禁。"""
import importlib
import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


class FormulaEngineTests(unittest.TestCase):
    def setUp(self):
        try:
            self.runner = importlib.import_module('app.calculations.runner')
        except ModuleNotFoundError:
            self.fail('尚未实现 calculations.runner')

    def run_formula(self, config, fields=None):
        record = {'id': 'r1', 'sample_id': 's1', 'spectrum_id': 'sp1', 'technique': 'generic',
                  'status': 'valid', 'fields': fields or {'area': {'value': 7, 'unit': 'a.u.', 'definition': 'range'}},
                  'source': {}, 'metadata': {}, 'warnings': []}
        return self.runner.evaluate_request({'records': [record], 'method': 'formula', 'config': config})

    def test_variable_binding_units_and_multistep_dependencies(self):
        config = {'variables': {'signal': {'field': 'area'}, 'offset': {'value': 1, 'unit': 'a.u.'},
                                'slope': {'value': 2, 'unit': 'a.u./(mg/mL)'}},
                  'outputs': [{'name': 'c', 'expression': '(signal-offset)/slope', 'unit': 'mg/mL'},
                              {'name': 'double_c', 'expression': '2*c', 'unit': 'mg/mL'}]}
        response = self.run_formula(config)
        result = response['results'][0]
        self.assertEqual(result['status'], 'valid')
        self.assertAlmostEqual(result['values']['c']['value'], 3)
        self.assertAlmostEqual(result['values']['double_c']['value'], 6)
        self.assertEqual(len(response['input_hash']), 64)
        self.assertEqual(response['configuration'], config)

    def test_angle_conversion_is_explicit(self):
        variables = {'angle': {'value': 30, 'unit': 'deg'}}
        good = self.run_formula({'variables': variables, 'outputs': [{'name': 's', 'expression': 'sin(radians(angle))', 'unit': '1'}]})
        self.assertAlmostEqual(good['results'][0]['values']['s']['value'], .5)
        bad = self.run_formula({'variables': variables, 'outputs': [{'name': 's', 'expression': 'sin(angle)', 'unit': '1'}]})
        self.assertEqual(bad['results'][0]['error']['code'], 'ANGLE_UNIT')

    def test_dimensionless_scaling_preserves_angle_and_fraction_meaning(self):
        result = self.run_formula({'variables': {'angle': {'value': 30, 'unit': 'deg'}},
                                  'outputs': [{'name': 's', 'expression': 'sin(2*radians(angle))', 'unit': '1'}]})['results'][0]
        self.assertAlmostEqual(result['values']['s']['value'], math.sqrt(3)/2)

    def test_fraction_meaning_survives_commutative_scaling_and_unit_cancellation(self):
        variables = {'x': {'value': .1, 'unit': '1', 'definition': 'mass_fraction'},
                     'length': {'value': 2, 'unit': 'nm'}}
        for expression in ['x*2', '2*x', 'x/2', '(2*x)/2', '(x*length)/length',
                           'length*(x/length)', '1/(1/x)', 'sqrt(x*x)', '(x**2)/x']:
            with self.subTest(expression=expression):
                result = self.run_formula({'variables': variables,
                    'outputs': [{'name': 'wrong', 'expression': expression, 'unit': '1', 'definition': 'mole_fraction'}]})['results'][0]
                self.assertEqual(result['status'], 'invalid')
                self.assertEqual(result['error']['code'], 'MEANING_MISMATCH')
        valid = self.run_formula({'variables': variables,
            'outputs': [{'name': 'same', 'expression': '(x*length)/length', 'unit': '%', 'definition': 'mass_fraction'}]})['results'][0]
        self.assertAlmostEqual(valid['values']['same']['value'], 10)

    def test_fraction_meaning_cannot_be_removed_by_intermediate_untyped_output(self):
        result = self.run_formula({'variables': {'x': {'value': .1, 'unit': '1', 'definition': 'mass_fraction'}},
            'outputs': [{'name': 'intermediate', 'expression': 'x*x', 'unit': '1'},
                        {'name': 'wrong', 'expression': 'sqrt(intermediate)', 'unit': '1', 'definition': 'mole_fraction'}]})['results'][0]
        self.assertEqual(result['status'], 'invalid')
        self.assertEqual(result['error']['code'], 'MEANING_MISMATCH')

    def test_incompatible_units_and_fraction_meanings_rejected(self):
        for left, right in [({'value': 1, 'unit': 'nm'}, {'value': 2, 'unit': 'eV'}),
                            ({'value': 1, 'unit': '%', 'definition': 'mass_fraction'}, {'value': 2, 'unit': '%', 'definition': 'atomic_fraction'})]:
            with self.subTest(left=left):
                result = self.run_formula({'variables': {'a': left, 'b': right}, 'outputs': [{'name': 'out', 'expression': 'a+b', 'unit': left['unit']}]})
                self.assertEqual(result['results'][0]['status'], 'invalid')
                self.assertIn(result['results'][0]['error']['code'], ['UNIT_MISMATCH', 'MEANING_MISMATCH'])

    def test_malformed_unsafe_expressions_and_resource_budgets_rejected(self):
        for expression in ['__import__("os")', '(1).__class__', '[x for x in (1,2)]', 'lambda:1', '2**1000000',
                           '2**x', '['+'1,'*100+']', '('*30+'1'+')'*30, '1+'*1100+'1']:
            with self.subTest(expression=expression[:30]):
                response = self.runner.validate_request({'records': [], 'method': 'formula', 'config': {
                    'variables': {'x': {'value': 2, 'unit': '1'}}, 'outputs': [{'name': 'out', 'expression': expression, 'unit': '1'}]}})
                self.assertFalse(response['valid'])

    def test_unknown_variable_cycle_and_duplicate_output(self):
        outputs_sets = [[{'name': 'a', 'expression': 'unknown+1', 'unit': '1'}],
                        [{'name': 'a', 'expression': 'b+1', 'unit': '1'}, {'name': 'b', 'expression': 'a+1', 'unit': '1'}],
                        [{'name': 'a', 'expression': '1', 'unit': '1'}, {'name': 'a', 'expression': '2', 'unit': '1'}]]
        for outputs in outputs_sets:
            response = self.runner.validate_request({'records': [], 'method': 'formula', 'config': {'variables': {}, 'outputs': outputs}})
            self.assertFalse(response['valid'])

    def test_domain_failure_does_not_hide_independent_output(self):
        result = self.run_formula({'variables': {}, 'outputs': [
            {'name': 'bad', 'expression': 'sqrt(-1)', 'unit': '1'},
            {'name': 'dependent', 'expression': 'bad+1', 'unit': '1'},
            {'name': 'good', 'expression': '2+3', 'unit': '1'}]})['results'][0]
        self.assertEqual(result['status'], 'invalid')
        self.assertEqual(result['values']['good']['value'], 5)
        self.assertIsNone(result['values']['bad']['value'])
        self.assertIsNone(result['values']['dependent']['value'])

    def test_missing_value_and_division_zero_are_not_zero_filled(self):
        for value, expression, code in [(None, 'x+1', 'MISSING_VALUE'), (0, '1/x', 'DIVISION_BY_ZERO')]:
            result = self.run_formula({'variables': {'x': {'field': 'area'}}, 'outputs': [{'name': 'out', 'expression': expression, 'unit': '1'}]},
                                      {'area': {'value': value, 'unit': '1', 'definition': 'range'}})['results'][0]
            self.assertEqual(result['status'], 'invalid')
            self.assertEqual(result['error']['code'], code)

    def test_hash_changes_when_formula_or_input_changes(self):
        config = {'variables': {'x': {'field': 'area'}}, 'outputs': [{'name': 'out', 'expression': 'x', 'unit': 'a.u.'}]}
        first = self.run_formula(config)
        second = self.run_formula(config, {'area': {'value': 8, 'unit': 'a.u.', 'definition': 'range'}})
        self.assertNotEqual(first['input_hash'], second['input_hash'])

    def test_sample_aggregation_metadata_and_definition_gate(self):
        records = [{'id': str(i), 'sample_id': sample, 'spectrum_id': sample, 'metadata': {'temperature': 300},
                    'fields': {'area': {'value': area, 'unit': 'a.u.', 'definition': 'range'}}}
                   for i, (sample, area) in enumerate([('a', 2), ('a', 4), ('b', 8)])]
        config = {'scope': 'sample', 'variables': {'signal': {'field': 'area', 'aggregate': 'sum'},
                                                   'temp': {'metadata': 'temperature', 'unit': 'K'}},
                  'outputs': [{'name': 'normalized', 'expression': 'signal/temp', 'unit': 'a.u./K'}]}
        result = self.runner.evaluate_request({'method': 'formula', 'records': records, 'config': config})
        self.assertEqual(len(result['results']), 2)
        self.assertAlmostEqual(result['results'][0]['values']['normalized']['value'], .02)
        records[1]['fields']['area']['definition'] = 'total'
        invalid = self.runner.evaluate_request({'method': 'formula', 'records': records, 'config': config})
        self.assertEqual(invalid['results'][0]['error']['code'], 'DEFINITION_MISMATCH')
        self.assertEqual(invalid['results'][1]['status'], 'valid')

    def test_group_missing_value_or_ambiguous_metadata_is_not_dropped(self):
        records = [{'id': str(i), 'sample_id': 'a', 'spectrum_id': 'a', 'metadata': {'temperature': temp},
                    'fields': {'area': {'value': area, 'unit': 'a.u.', 'definition': 'range'}}}
                   for i, (temp, area) in enumerate([(300, None), (400, 2)])]
        config = {'scope': 'sample', 'variables': {'signal': {'field': 'area', 'aggregate': 'mean'},
                                                   'temp': {'metadata': 'temperature', 'unit': 'K'}},
                  'outputs': [{'name': 'area_mean', 'expression': 'signal', 'unit': 'a.u.'},
                              {'name': 'temperature', 'expression': 'temp', 'unit': 'K'}]}
        result = self.runner.evaluate_request({'method': 'formula', 'records': records, 'config': config})['results'][0]
        self.assertIsNone(result['values']['area_mean']['value'])
        self.assertIsNone(result['values']['temperature']['value'])
        self.assertEqual({v['code'] for v in result['details']['output_issues']}, {'MISSING_VALUE', 'AMBIGUOUS_GROUP_VALUE'})

    def test_malformed_inputs_return_validation_issue_not_server_exception(self):
        for config in [{'variables': {'x': {'value': 10**1000, 'unit': '1'}}, 'outputs': [{'name': 'out', 'expression': 'x', 'unit': '1'}]},
                       {'variables': {}, 'outputs': [{'name': 'out', 'expression': '9'*1000, 'unit': '1'}]},
                       {'variables': {'x': {'metadata': '__class__', 'unit': '1'}}, 'outputs': [{'name': 'out', 'expression': 'x', 'unit': '1'}]}]:
            self.assertFalse(self.runner.validate_request({'records': [], 'method': 'formula', 'config': config})['valid'])

    def test_selection_and_compound_unit_overflow_are_controlled(self):
        record = {'id': 'r', 'fields': {'area': {'value': 1, 'unit': '1', 'definition': 'range'}}}
        for selection in ['r', [{}], [1], ['missing'], []]:
            config = {'record_ids': selection, 'variables': {}, 'outputs': [{'name': 'out', 'expression': '1', 'unit': '1'}]}
            self.assertFalse(self.runner.validate_request({'records': [record], 'method': 'formula', 'config': config})['valid'])
        for unit in ['(nm^12)^-12', '(nm^-12)^12', '((nm^-12)^12)^12']:
            config = {'variables': {'x': {'value': 1, 'unit': unit}}, 'outputs': [{'name': 'out', 'expression': 'x', 'unit': unit}]}
            self.assertFalse(self.runner.validate_request({'records': [], 'method': 'formula', 'config': config})['valid'])

    def test_nonfinite_function_and_invalid_quantity_schema_are_controlled(self):
        result = self.run_formula({'variables': {}, 'outputs': [{'name': 'overflow', 'expression': 'exp(1000)', 'unit': '1'}]})['results'][0]
        self.assertEqual(result['status'], 'invalid')
        for broken in [{'value': 1, 'unit': []}, {'value': 1, 'unit': '1', 'definition': []}, 'wrong']:
            request = {'records': [{'id': 'r', 'fields': {'area': broken}}], 'method': 'formula',
                       'config': {'variables': {'x': {'field': 'area'}}, 'outputs': [{'name': 'out', 'expression': 'x', 'unit': '1'}]}}
            self.assertFalse(self.runner.validate_request(request)['valid'])

    def test_total_execution_budget_is_checked_before_evaluation(self):
        records = [{'id': str(i), 'fields': {}} for i in range(10000)]
        config = {'variables': {}, 'outputs': [{'name': f'out{i}', 'expression': '+'.join(['1']*12), 'unit': '1'} for i in range(20)]}
        response = self.runner.validate_request({'records': records, 'method': 'formula', 'config': config})
        self.assertFalse(response['valid'])
        self.assertEqual(response['issues'][0]['code'], 'COMPUTATION_LIMIT')


if __name__ == '__main__':
    unittest.main()
