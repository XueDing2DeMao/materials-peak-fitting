"""峰性质以独立积分和半高定义检验，不依赖测量采样网格。"""
import json
import sys
import unittest
from pathlib import Path

import numpy as np
from scipy.integrate import quad

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.peaks import evaluate_peak
from app.peak_properties import peak_geometry


class PeakPropertiesTests(unittest.TestCase):
    def test_unavailable_correlation_does_not_emit_nan_json(self):
        from app.fitting import _correlation_from_covariance
        correlation=_correlation_from_covariance(np.diag([1.,0.]))
        self.assertIsNone(correlation)
        json.dumps({'correlation_matrix':correlation},allow_nan=False)

    def test_nearly_pure_mixtures_keep_valid_halfmax_brackets(self):
        for wl,mu in [(10,1e-15),(.001,1-np.finfo(float).eps)]:
            p=dict(A=1,xc=0,wG=1,wL=wl,mu=mu)
            g=peak_geometry('psd_voigt2',p,-20,20)
            self.assertIsNotNone(g['fwhm'],g['reasons'])
            self.assertAlmostEqual(evaluate_peak('psd_voigt2',np.array([g['halfmax_high']]),p)[0]/g['peak_height'],.5,delta=1e-8)

    def test_extremely_different_component_widths_still_find_half_height(self):
        for narrow in [1e-10,1e-13]:
            p=dict(A=1,xc=0,wG=narrow,wL=1.,mu=1-1e-9)
            g=peak_geometry('psd_voigt2',p,-1,1)
            self.assertAlmostEqual(float(evaluate_peak('psd_voigt2',np.array([g['halfmax_high']]),p)[0])/g['peak_height'],.5,delta=1e-8)
    def test_pseudo_voigt2_whole_width_and_analytic_area(self):
        p = dict(A=12., xc=100., wG=1., wL=4., mu=.4)
        g = peak_geometry('psd_voigt2', p, 98., 103.)
        self.assertTrue(1 < g['fwhm'] < 4)
        np.testing.assert_allclose(evaluate_peak('psd_voigt2', np.array([g['halfmax_low'], g['halfmax_high']]), p), g['peak_height']/2, rtol=1e-8)
        expected = quad(lambda t: 12*((1-.4)*np.sqrt(4*np.log(2)/np.pi)*np.exp(-4*np.log(2)*t*t)+.4*4/(2*np.pi*(t*t+4))), -2, 3)[0]
        self.assertAlmostEqual(g['area_in_range'], expected, places=9)
        self.assertEqual(g['area_total'], 12)
        self.assertEqual(g['peak_position'], 100)

    def test_symmetric_limits_and_extrapolation(self):
        for mu, width in [(0, 1), (1, 4)]:
            g = peak_geometry('psd_voigt2', dict(A=2, xc=0, wG=1, wL=4, mu=mu), -.1, .1)
            self.assertEqual(g['fwhm'], width)
            self.assertFalse(g['halfmax_within_range'])
            self.assertTrue(g['warnings'])
        for model in ['gaussian','lorentz','psd_voigt1','psd_voigt2']:
            p=dict(A=3, xc=0, w=2, wG=2, wL=2, mu=.4)
            g=peak_geometry(model,p,-10,10)
            self.assertAlmostEqual(g['fwhm'],2)
            self.assertAlmostEqual(g['area_fraction_in_range'],g['area_in_range']/3)

    def test_zero_area_has_no_defined_width_or_coverage(self):
        g=peak_geometry('gaussian',dict(A=0,xc=0,w=1),-2,2)
        self.assertEqual(g['area_total'],0)
        self.assertIsNone(g['fwhm'])
        self.assertIsNone(g['area_fraction_in_range'])
        self.assertIn('fwhm',g['reasons'])
        json.dumps(g,allow_nan=False)

    def test_single_fit_and_export_preserve_legacy_and_add_geometry(self):
        from app.fitting import FitInput, fit_single_peak
        from app.main import fit_result_to_dict, export
        from app.schemas import ExportPayload
        x=np.linspace(-4,4,41)
        p=dict(A=3.,xc=.1,wG=.8,wL=2.2,mu=.3)
        result=fit_single_peak(FitInput(x,evaluate_peak('psd_voigt2',x,p),'psd_voigt2','none',[],fixed_parameters=p,staged_fit=False))
        self.assertAlmostEqual(result.derived_parameters['area_in_range'],np.trapz(result.peak_y,x))
        d=fit_result_to_dict(result)
        self.assertIn('peak_geometry',d)
        csv=export(ExportPayload(kind='parameters',result=d)).body.decode()
        self.assertIn('geometry.fwhm',csv)
        self.assertIn('模型积分',csv)


if __name__=='__main__': unittest.main()
