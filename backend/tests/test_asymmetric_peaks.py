"""非对称模型的独立面积、卷积、峰顶和拟合回归。"""
import sys
import unittest
from pathlib import Path

import numpy as np
from scipy.integrate import quad
from scipy.optimize import minimize_scalar
from scipy.stats import exponnorm, norm

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app.peaks import evaluate_peak
from app.peak_properties import peak_geometry
from app.fitting import FitInput, fit_single_peak, analyze_single_peak, compare_single_peak_models


class AsymmetricTests(unittest.TestCase):
    def test_truncated_peak_initialization_warns_about_missing_half_height(self):
        x=np.linspace(-.1,3,100)
        p=dict(A=3,xc=0,h_low=1,h_high=1,mu=.3)
        r=analyze_single_peak(FitInput(x,evaluate_peak('split_psd_voigt',x,p),'split_psd_voigt','none',[]))
        self.assertTrue(r.warnings)

    def test_bound_diagnostic_is_independent_of_x_units(self):
        for scale in (1.,1e-7):
            x=np.linspace(-6,6,301)*scale
            params=dict(A=4*scale,xc=0,sigma=scale,tau=.5*scale)
            y=evaluate_peak('emg_high',x,params)+.001*np.cos(4*x/scale)
            result=fit_single_peak(FitInput(x,y,'emg_high','none',[],initial_parameters={'sigma':scale},
                   fixed_parameters={k:v for k,v in params.items() if k!='sigma'},staged_fit=False))
            self.assertGreater(result.parameters['sigma'].standard_error,0)

    def test_fixed_zero_tail_retains_identifiable_gaussian_width_error(self):
        x=np.linspace(-6,6,301)
        result=fit_single_peak(FitInput(x,4*norm.pdf(x)+.001*np.cos(4*x),'emg_high','none',[],
                               initial_parameters={'sigma':1},fixed_parameters={'A':4,'xc':0,'tau':0},staged_fit=False))
        self.assertGreater(result.parameters['sigma'].standard_error,0)

    def test_tiny_positive_tail_has_a_finite_gaussian_limit(self):
        x=np.array([-2.,0.,2.])
        p=dict(A=1,xc=0,sigma=1,tau=1e-200)
        np.testing.assert_allclose(evaluate_peak('emg_high',x,p),norm.pdf(x),rtol=1e-12)
        self.assertAlmostEqual(peak_geometry('emg_high',p,-3,3)['fwhm'],2*np.sqrt(2*np.log(2)))

    def test_bound_tail_does_not_claim_valid_standard_error(self):
        x=np.linspace(-6,15,301)
        mode=minimize_scalar(lambda z:-exponnorm.pdf(z,2),bounds=(0,2),method='bounded').x
        y=3*exponnorm.pdf(x+mode,2)
        r=fit_single_peak(FitInput(x,y,'emg_high','none',[],parameter_bounds={'tau':(0,.1)},staged_fit=False))
        self.assertIsNone(r.parameters['tau'].standard_error)
        self.assertIsNone(r.parameters['tau'].confidence_interval)
        self.assertTrue(r.parameters['tau'].uncertainty_reason)
    def test_split_normalization_halfmax_mirror_and_limit(self):
        for mu in [0,.35,1]:
            for lo,hi in [(.1,1),(1,.1),(.5,.5)]:
                p=dict(A=3,xc=0,h_low=lo,h_high=hi,mu=mu)
                f=lambda t:float(evaluate_peak('split_psd_voigt',np.array([t]),p)[0])
                self.assertAlmostEqual(quad(f,-np.inf,0)[0]+quad(f,0,np.inf)[0],3,places=7)
                np.testing.assert_allclose([f(-lo),f(hi)],f(0)/2,rtol=1e-10)
                # 两侧一阶导数在峰顶均趋于零。
                step=min(lo,hi)*1e-7
                self.assertAlmostEqual((f(step)-f(0))/step,0,delta=1e-4*f(0)/hi)
                self.assertAlmostEqual((f(0)-f(-step))/step,0,delta=1e-4*f(0)/lo)
                g=peak_geometry('split_psd_voigt',p,-2,3)
                self.assertAlmostEqual(g['area_in_range'],quad(f,-2,0)[0]+quad(f,0,3)[0],places=8)
                self.assertAlmostEqual(g['fwhm'],lo+hi)
                x=np.linspace(-5,5,301)
                np.testing.assert_allclose(evaluate_peak('split_psd_voigt',x,p),evaluate_peak('split_psd_voigt',-x,{**p,'h_low':hi,'h_high':lo}))
                if lo==hi:
                    np.testing.assert_allclose(evaluate_peak('split_psd_voigt',x,p),evaluate_peak('psd_voigt1',x,dict(A=3,xc=0,w=2*lo,mu=mu)),rtol=1e-10)

    def test_emg_independent_convolution_mode_and_area(self):
        for k in [.01,1.,10.]:
            # 参考峰顶由 SciPy 分布独立求极大，再通过卷积直接构造参考。
            mode=minimize_scalar(lambda z:-exponnorm.pdf(z,k),bounds=(-1,max(2,k)),method='bounded',options={'xatol':1e-12}).x
            p=dict(A=2.,xc=5.,sigma=.7,tau=k*.7)
            for direction in ['high','low']:
                sign=1 if direction=='high' else -1
                for t in [-2.,0.,1.,3.]:
                    expected=2/.7*quad(lambda u:np.exp(-u)*norm.pdf(sign*t+mode-k*u),0,np.inf,epsabs=1e-11)[0]
                    actual=evaluate_peak('emg_'+direction,np.array([5+.7*t]),p)[0]
                    self.assertAlmostEqual(actual,expected,delta=2e-6)
                g=peak_geometry('emg_'+direction,p,-30,60)
                np.testing.assert_allclose(evaluate_peak('emg_'+direction,np.array([g['halfmax_low'],g['halfmax_high']]),p),g['peak_height']/2,rtol=1e-8)
                self.assertEqual(g['peak_position'],5)
                self.assertAlmostEqual(g['hwhm_low']+g['hwhm_high'],g['fwhm'])

    def test_emg_extreme_scales_gaussian_limit_and_finite_integrals(self):
        for k in [0,1e-4,1e-2,1,10,100]:
            p=dict(A=1.,xc=0.,sigma=1.,tau=k)
            f=lambda t:float(evaluate_peak('emg_high',np.array([t]),p)[0])
            self.assertAlmostEqual(quad(f,-np.inf,0,epsabs=1e-9)[0]+quad(f,0,np.inf,epsabs=1e-9)[0],1,places=7)
            g=peak_geometry('emg_high',p,-3,7)
            self.assertAlmostEqual(g['area_in_range'],quad(f,-3,7,epsabs=1e-10)[0],places=7)
            x=np.linspace(-10,20,301)
            self.assertTrue(np.all(np.isfinite(evaluate_peak('emg_high',x,p))))
            np.testing.assert_allclose(evaluate_peak('emg_high',x,p),evaluate_peak('emg_low',-x,p))
            self.assertGreater(f(0),max(f(-1e-3),f(1e-3)))
            if k==0:
                np.testing.assert_allclose(evaluate_peak('emg_high',x,p),norm.pdf(x),rtol=1e-12)
                self.assertAlmostEqual(g['fwhm'],2*np.sqrt(2*np.log(2)))

    def test_new_models_fit_independent_spectra_and_auto_initialization(self):
        x=np.linspace(-8,14,551)
        unit=lambda u:(.7*np.sqrt(np.log(2)/np.pi)*np.exp(-np.log(2)*u*u)+.3/(np.pi*(1+u*u)))
        y=8/(.7+1.4)*unit((x-.3)/np.where(x<=.3,.7,1.4))
        cases=[('split_psd_voigt',y,dict(A=4.,xc=.3,h_low=.7,h_high=1.4,mu=.3))]
        mode=minimize_scalar(lambda z:-exponnorm.pdf(z,2.),bounds=(0,2),method='bounded',options={'xatol':1e-12}).x
        for sign,direction in [(1,'high'),(-1,'low')]:
            cases.append(('emg_'+direction,4/.7*exponnorm.pdf(sign*(x-.3)/.7+mode,2.),dict(A=4.,xc=.3,sigma=.7,tau=1.4)))
        for model,y,truth in cases:
            for factor in [.8,1.3]:
                initial={n:v*factor for n,v in truth.items()};initial['xc']=-.1
                request=FitInput(x,y,model,'none',[],initial_parameters=initial,tolerance=1e-10)
                automatic=analyze_single_peak(request)
                self.assertEqual(set(automatic.initial_parameters),set(truth))
                result=fit_single_peak(request)
                self.assertTrue(result.converged,result.message)
                self.assertAlmostEqual(result.parameters['xc'].value,.3,delta=1e-4)
                self.assertAlmostEqual(result.parameters['A'].value,4.,delta=4e-3)
                self.assertIsNotNone(result.peak_geometry['fwhm'])
                expected_width=peak_geometry(model,truth,float(x[0]),float(x[-1]))['fwhm']
                self.assertAlmostEqual(result.peak_geometry['fwhm'],expected_width,delta=expected_width*1e-3)

    def test_continuous_properties_do_not_depend_on_sampling_or_order(self):
        random=np.random.default_rng(42)
        grids=[np.linspace(-4,8,51),np.r_[-4,np.sort(random.uniform(-4,8,97)),8]]
        for model,p in [('split_psd_voigt',dict(A=4,xc=.3,h_low=.5,h_high=1.1,mu=.3)),
                        ('emg_high',dict(A=4,xc=.3,sigma=.5,tau=1.1)),('emg_low',dict(A=4,xc=.3,sigma=.5,tau=1.1))]:
            expected=peak_geometry(model,p,-4,8)
            for x in grids+[grids[0][::-1]]:
                result=fit_single_peak(FitInput(x,evaluate_peak(model,x,p),model,'none',[],fixed_parameters=p,staged_fit=False))
                self.assertEqual(result.peak_geometry,expected)

    def test_expanded_comparison_is_opt_in(self):
        x=np.linspace(-4,4,101);y=3*norm.pdf(x)
        request=FitInput(x,y,'gaussian','none',[],staged_fit=False)
        self.assertEqual(len(compare_single_peak_models(request).rows),4)
        self.assertEqual(len(compare_single_peak_models(request,include_asymmetric=True).rows),7)


if __name__=='__main__':unittest.main()
