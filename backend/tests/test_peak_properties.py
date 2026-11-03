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
    def test_height_error_uses_area_width_cross_covariance_and_student_t_interval(self):
        from scipy.stats import t
        from app.fitting import FitInput, fit_single_peak
        x=np.linspace(-4,4,161)
        noise=np.random.default_rng(28).normal(0,.025,len(x))
        for model in ['gaussian','lorentz']:
            y=evaluate_peak(model,x,dict(A=8,xc=.15,w=1.2))+noise
            for fixed in [{},{'w':1.2},{'A':8.}]:
                r=fit_single_peak(FitInput(x,y,model,'none',[],fixed_parameters=fixed,staged_fit=False))
                p=r.parameters
                h=r.peak_geometry['peak_height']
                gradient={'A':h/p['A'].value,'w':-h/p['w'].value,'xc':0.}
                g=np.array([gradient[key] for key in p if key not in fixed])
                cov=np.asarray(r.covariance_matrix)
                expected=np.sqrt(g@cov@g)
                if not fixed:
                    self.assertGreater(abs(expected-np.sqrt((g*g)@np.diag(cov))),expected*.05)
                self.assertIn('peak_height_uncertainty',r.peak_geometry)
                u=r.peak_geometry['peak_height_uncertainty']
                self.assertAlmostEqual(u['standard_error'],expected,places=10)
                half_width=t.ppf(.975,len(x)-len(g))*expected
                np.testing.assert_allclose(u['confidence_interval'],[h-half_width,h+half_width])
                self.assertIsNone(u['reason'])

    def test_height_unavailable_on_width_bound_and_when_fixed(self):
        from app.fitting import FitInput, fit_single_peak
        x=np.linspace(-4,4,161)
        y=evaluate_peak('gaussian',x,dict(A=8,xc=.15,w=2.2))
        for kwargs,explanation in [({'parameter_bounds':{'w':(.1,1.)}},'贴边'),
                                   ({'fixed_parameters':{'w':1.,'A':8.}},'固定')]:
            r=fit_single_peak(FitInput(x,y,'gaussian','none',[],staged_fit=False,**kwargs))
            u=r.peak_geometry['peak_height_uncertainty']
            self.assertIsNone(u['standard_error'])
            self.assertIsNone(u['confidence_interval'])
            self.assertIn(explanation,u['reason'])

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

    def test_single_export_uses_saved_axis_units_for_curves_and_uncertainties(self):
        import csv
        from io import StringIO
        from app.main import export
        from app.schemas import ExportPayload
        result = {key: [0.5] for key in ('x','raw_y','baseline','net_y','peak_y','total_y','residual')}
        result.update(parameters={'xc': {'value': 0.5, 'standard_error': 0.01, 'confidence_interval': [0.48,0.52]},
                                  'A': {'value': 1}}, statistics={'rmse': 0.1},
                      peak_geometry={'fwhm': 0.5}, analysis_metadata={'x_unit': '°', 'y_unit': 'counts'})
        def read(kind):
            output = export(ExportPayload(kind=kind, result=result))
            return list(csv.reader(StringIO(output.body.decode('utf-8-sig'))))
        curves = read('curves')
        self.assertEqual(curves[0][-2:], ['x_unit','y_unit'])
        self.assertEqual(curves[1][-2:], ['°','counts'])
        rows = read('parameters')
        self.assertEqual(rows[0][-1], 'unit')
        by_name = {row[0]:row for row in rows if row}
        self.assertEqual(by_name['xc'][1:5], ['0.5','0.01','0.48','0.52'])
        self.assertEqual(by_name['xc'][-1], '°')
        self.assertEqual(by_name['A'][-1], 'counts × °')
        self.assertEqual(by_name['geometry.fwhm'][2], '°')
        self.assertEqual(by_name['rmse'][-1], 'counts')
        del result['analysis_metadata']
        self.assertEqual(read('curves')[1][-2:], ['X 单位','Y 单位'])


if __name__=='__main__': unittest.main()
