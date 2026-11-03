"""单峰约束边界的不确定度回归；参考谱由独立解析公式生成。"""
import csv
from io import StringIO
from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.fitting import FitInput, fit_single_peak
from app.main import export, fit_result_to_dict
from app.schemas import ExportPayload


def reference_peak(model, x, area=102.2, center=5., width=1.2):
    z = (x - center) / width
    if model == 'gaussian':
        return area / width * np.sqrt(4 * np.log(2) / np.pi) * np.exp(-4 * np.log(2) * z**2)
    return area / width * 2 / np.pi / (1 + 4 * z**2)


class SinglePeakUncertaintyTests(unittest.TestCase):
    def fit_reference(self, model, **options):
        x = np.linspace(0, 10, 201)
        y = reference_peak(model, x) + .01 * np.cos(3 * x)
        return fit_single_peak(FitInput(x, y, model, 'none', [], staged_fit=False, **options))

    def test_active_upper_and_lower_bounds_suppress_linear_uncertainty_and_export_reason(self):
        for model in ('gaussian', 'lorentz'):
            with self.subTest(model=model):
                result = self.fit_reference(model, initial_parameters={'A': 90, 'w': 1.8},
                    parameter_bounds={'A': (None, 95), 'w': (1.3, None)}, fixed_parameters={'xc': 5})
                self.assertTrue(result.converged)
                self.assertAlmostEqual(95, result.parameters['A'].value, places=6)
                self.assertAlmostEqual(1.3, result.parameters['w'].value, places=6)
                for name in ('A', 'w'):
                    estimate = result.parameters[name]
                    self.assertIsNone(estimate.standard_error)
                    self.assertIsNone(estimate.confidence_interval)
                    self.assertIn('贴边', estimate.uncertainty_reason)
                self.assertEqual('固定参数', result.parameters['xc'].uncertainty_reason)
                self.assertIsNone(result.parameters['xc'].standard_error)
                self.assertIsNone(result.parameters['xc'].confidence_interval)
                self.assertIsNone(result.covariance_matrix)
                self.assertIsNone(result.correlation_matrix)
                self.assertIn('贴边', result.analysis_metadata['uncertainty_warning'])
                self.assertIn('贴边', result.peak_geometry['peak_height_uncertainty']['reason'])
                response = export(ExportPayload(kind='parameters', result=fit_result_to_dict(result)))
                rows = list(csv.reader(StringIO(response.body.decode('utf-8-sig'))))
                for name in ('A', 'w'):
                    row = next(row for row in rows if row[0] == name)
                    self.assertEqual(['', '', ''], row[2:5])
                    self.assertIn('贴边', row[rows[0].index('uncertainty_reason')])

    def test_active_center_bound_invalidates_joint_covariance(self):
        for model in ('gaussian', 'lorentz'):
            for bounds, expected in (((None, 4.8), 4.8), ((5.2, None), 5.2)):
                with self.subTest(model=model, bounds=bounds):
                    result = self.fit_reference(model, parameter_bounds={'xc': bounds})
                    self.assertAlmostEqual(expected, result.parameters['xc'].value, places=6)
                    for estimate in result.parameters.values():
                        self.assertIsNone(estimate.confidence_interval)
                        self.assertIn('贴边', estimate.uncertainty_reason)

    def test_interior_parameters_keep_uncertainty_in_lm_and_bounded_solvers(self):
        # 小于 1 的宽度与面积在 LM 中使用负对数坐标，不能用其判断物理边界。
        for model in ('gaussian', 'lorentz'):
            for scale in (1., 1e-7):
                for bounded in (False, True):
                    with self.subTest(model=model, scale=scale, bounded=bounded):
                        x = np.linspace(-2, 2, 201) * scale
                        y = reference_peak(model, x, .3 * scale, 0, .4 * scale) + .001 * np.cos(x / scale)
                        result = fit_single_peak(FitInput(x, y, model, 'none', [],
                            initial_parameters={'A': .3 * scale, 'w': .4 * scale},
                            parameter_bounds={'w': (.1 * scale, .8 * scale)} if bounded else {},
                            fixed_parameters={'xc': 0}, staged_fit=False))
                        self.assertTrue(result.converged)
                        for name in ('A', 'w'):
                            estimate = result.parameters[name]
                            self.assertGreater(estimate.standard_error, 0)
                            self.assertLess(estimate.confidence_interval[0], estimate.value)
                            self.assertGreater(estimate.confidence_interval[1], estimate.value)
                            self.assertIsNone(estimate.uncertainty_reason)
                        self.assertNotIn('uncertainty_warning', result.analysis_metadata)


if __name__ == '__main__':
    unittest.main()
