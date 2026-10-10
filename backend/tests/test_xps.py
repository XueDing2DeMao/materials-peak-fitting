"""独立参考谱与 XPS 行为验收；不调用生产峰函数构造真值。"""
import copy
import importlib
import json
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def reference(x, area, center, width, mu=0.35):
    g = np.sqrt(4 * np.log(2) / np.pi) / width * np.exp(-4 * np.log(2) * ((x-center)/width)**2)
    l = width / (2*np.pi*((x-center)**2 + width**2/4))
    return area * ((1-mu)*g + mu*l)


def component(id, area, center, width=1.2, mu=0.35):
    return {"id": id, "label": id, "model": "psd_voigt1", "parameters": {
        "A": {"value": area}, "xc": {"value": center}, "w": {"value": width}, "mu": {"value": mu}}}


def relation(target, source, parameter, kind, value):
    return {"target": {"component": target, "parameter": parameter},
            "source": {"component": source, "parameter": parameter}, "kind": kind, "value": value}


def fixture(noise=0):
    x = np.linspace(90, 115, 501)
    specs = [(12000,100,1.2,.35),(6000,104.6,1.2,.35),(8000,101.6,1.4,.35),(4000,106.2,1.4,.35)]
    y = 300 + 2*(x-90) + sum(reference(x,*p) for p in specs)
    if noise: y += np.random.default_rng(813).normal(0,noise,len(x))
    cs = [component(f"p{i+1}",a*.92,c+.08,w*1.1,m) for i,(a,c,w,m) in enumerate(specs)]
    constraints = [relation(b,a,p,k,v) for a,b in [('p1','p2'),('p3','p4')]
                   for p,k,v in [('xc','offset',4.6),('A','ratio',.5),('w','ratio',1)]]
    return {"x":x.tolist(),"y":y.tolist(),"range_start":90,"range_end":115,
            "background":{"kind":"line","low_level":300,"high_level":350,"confirmed":True},
            "components":cs,"constraints":constraints,
            "groups":[{"id":"g1","label":"组1","component_ids":["p1","p2"]},
                      {"id":"g2","label":"组2","component_ids":["p3","p4"]}]}, specs


class XpsTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(importlib.util.find_spec('app.xps_fitting'), 'XPS 多峰引擎尚未实现')
        self.schema = importlib.import_module('app.xps_schemas').XpsRequest
        self.fit = importlib.import_module('app.xps_fitting').fit_xps
        self.preview = importlib.import_module('app.xps_backgrounds').preview_background

    def run_fit(self, payload):
        return self.fit(self.schema.model_validate(payload))

    def test_two_doublets_recover_independent_truth_and_constraints(self):
        payload,truth=fixture(); r=self.run_fit(payload)
        self.assertTrue(r['converged']); self.assertEqual(r['statistics']['free_parameters'],10)
        for c,expected in zip(r['components'],truth):
            for name,value in zip(['A','xc','w','mu'],expected):
                np.testing.assert_allclose(c['parameters'][name]['value'],value,rtol=1e-4,atol=1e-4)
        np.testing.assert_allclose(r['total_y'],r['raw_y'],rtol=1e-6,atol=1e-6)
        np.testing.assert_allclose(np.sum([c['y'] for c in r['components']],axis=0)+r['baseline'],r['total_y'])
        json.dumps(r,allow_nan=False)

    def test_noisy_recovery(self):
        p,truth=fixture(20);r=self.run_fit(p)
        for c,expected in zip(r['components'],truth):
            self.assertLess(abs(c['parameters']['xc']['value']-expected[1]),.05)
            for name,value in [('A',expected[0]),('w',expected[2])]:
                self.assertLess(abs(c['parameters'][name]['value']/value-1),.05)

    def test_statistics_use_net_signal_and_information_criteria(self):
        p,_=fixture(20);r=self.run_fit(p)
        net=np.array(r['raw_y'])-r['baseline'];res=np.array(r['residuals'])
        n,k=len(net),r['statistics']['free_parameters'];rss=float(res@res)
        self.assertAlmostEqual(r['statistics']['r_squared'],1-rss/np.sum((net-net.mean())**2),12)
        self.assertAlmostEqual(r['statistics']['durbin_watson'],float(np.sum(np.diff(res)**2)/rss),12)
        self.assertAlmostEqual(r['statistics']['aicc'],n*np.log(rss/n)+2*k+2*k*(k+1)/(n-k-1),10)

    def test_single_peak_models_and_bound_uncertainty(self):
        for model,mu in [('gaussian',0),('lorentz',1),('psd_voigt1',.35)]:
            p,_=fixture();x=np.array(p['x']);p['y']=reference(x,12000,100,1.2,mu).tolist()
            c=component('p',11000,100.1,1.4,mu);c['model']=model
            if model!='psd_voigt1':del c['parameters']['mu']
            p.update(components=[c],constraints=[],groups=[],background={'kind':'none'})
            r=self.run_fit(p)
            for name,value in [('A',12000),('xc',100),('w',1.2)]:
                np.testing.assert_allclose(r['components'][0]['parameters'][name]['value'],value,rtol=1e-4,atol=1e-4)
            from app.fitting import FitInput,fit_single_peak
            old=fit_single_peak(FitInput(x=x,y=np.array(p['y']),model=model,baseline_kind='none',anchors=[],staged_fit=False))
            np.testing.assert_allclose(r['total_y'],old.total_y,rtol=1e-5,atol=1e-4)

    def test_shirley_end_windows_and_aicc_insufficient_sample(self):
        p,_=fixture();p['background']={'kind':'line','low_window':[90,90.1],'high_window':[114.9,115]}
        r=self.preview(self.schema.model_validate(p))
        self.assertAlmostEqual(r['baseline'][0],float(np.median(p['y'][:3])))
        p['background']['low_window']=[89,90]
        with self.assertRaisesRegex(ValueError,'窗口'):self.preview(self.schema.model_validate(p))
        p={'x':[0,1,2,3,4],'y':[1,3,7,3,1],'components':[component('p',12,2,1)],'background':{'kind':'none'}}
        r=self.run_fit(p);self.assertIsNone(r['statistics']['aicc'])

    def test_direction_and_energy_shift(self):
        p,_=fixture();a=self.run_fit(p)
        p['x'].reverse();p['y'].reverse();b=self.run_fit(p)
        np.testing.assert_allclose(a['total_y'],b['total_y'],rtol=1e-10)
        p['shift_eV']=1;p['range_start']+=1;p['range_end']+=1
        for c in p['components']:c['parameters']['xc']['value']+=1
        c=self.run_fit(p)
        np.testing.assert_allclose(c['x'],np.array(a['x'])+1)
        np.testing.assert_allclose(c['x_raw'],a['x_raw'])

    def test_reject_cycle_fixed_conflict_and_infeasible_child_bounds(self):
        p,_=fixture();p['constraints'].append(relation('p1','p2','xc','offset',-4.6))
        with self.assertRaisesRegex(ValueError,'循环'):self.run_fit(p)
        p,_=fixture();p['components'][0]['parameters']['A'].update(value=12000,fixed=True)
        p['components'][1]['parameters']['A'].update(value=7000,fixed=True)
        with self.assertRaisesRegex(ValueError,'固定|冲突'):self.run_fit(p)
        p,_=fixture();p['components'][0]['parameters']['xc'].update(lower=99,upper=101)
        p['components'][1]['parameters']['xc'].update(lower=110,upper=112)
        with self.assertRaisesRegex(ValueError,'边界'):self.run_fit(p)

    def test_child_bound_limits_root_during_fit(self):
        p,_=fixture();p['components'][1]['parameters']['xc'].update(lower=104.7,upper=104.9)
        r=self.run_fit(p); cs=r['components']
        self.assertGreaterEqual(cs[1]['parameters']['xc']['value'],104.7-1e-8)
        self.assertAlmostEqual(cs[1]['parameters']['xc']['value']-cs[0]['parameters']['xc']['value'],4.6,10)
        self.assertIsNone(cs[0]['parameters']['xc']['standard_error'])

    def test_shirley_against_known_integral_on_nonuniform_grid(self):
        # 构造固定点：净谱 f=sin(pi*x)^2，精确累计积分 F=x/2-sin(2*pi*x)/(4*pi)。
        x=np.linspace(0,1,3001)**1.1; f=np.sin(np.pi*x)**2
        exact=10+4*(x/2-np.sin(2*np.pi*x)/(4*np.pi))
        p={'x':x.tolist(),'y':(exact+20*f).tolist(),'range_start':0,'range_end':1,
           'components':[], 'background':{'kind':'shirley','low_level':10,'high_level':12,'confirmed':True,'tolerance':1e-10}}
        a=self.preview(self.schema.model_validate(p))
        np.testing.assert_allclose(a['baseline'],exact,rtol=1e-6,atol=1e-6)
        p['x'].reverse();p['y'].reverse();b=self.preview(self.schema.model_validate(p))
        np.testing.assert_allclose(a['baseline'],b['baseline'])

    def test_shirley_failure_is_explicit_and_confirmation_required(self):
        p,_=fixture();p['background']={'kind':'shirley','low_level':0,'high_level':0,'confirmed':True}
        p['y']=[0]*len(p['x'])
        with self.assertRaisesRegex(ValueError,'积分|信号'):self.preview(self.schema.model_validate(p))
        p,_=fixture();p['background'].update(kind='shirley',confirmed=False)
        with self.assertRaisesRegex(ValueError,'复核'):self.run_fit(p)
        p['background'].update(confirmed=True,max_iterations=1,tolerance=1e-14)
        with self.assertRaisesRegex(ValueError,'收敛'):self.preview(self.schema.model_validate(p))

    def test_singular_model_does_not_report_zero_uncertainty(self):
        p,_=fixture();p['components']=[component('a',12000,100),component('b',12000,100)]
        for c in p['components']:
            for name in ['xc','w','mu']:c['parameters'][name]['fixed']=True
        p['constraints']=[];p['groups']=[]
        x=np.array(p['x']);p['y']=(300+2*(x-90)+reference(x,24000,100,1.2)).tolist()
        r=self.run_fit(p)
        self.assertFalse(r['diagnostics']['identifiable'])
        self.assertTrue(all(c['parameters']['A']['standard_error'] is None for c in r['components']))
        json.dumps(r,allow_nan=False)

    def test_nonfinite_duplicate_and_disabled_reference_rejected(self):
        p,_=fixture();p['x'][1]=p['x'][0]
        with self.assertRaisesRegex(ValueError,'重复'):self.run_fit(p)
        p,_=fixture();p['y'][1]=float('nan')
        with self.assertRaises(ValueError):self.run_fit(p)
        p,_=fixture();p['components'][0]['enabled']=False
        with self.assertRaisesRegex(ValueError,'停用|启用'):self.run_fit(p)


if __name__=='__main__':unittest.main()
