"""通用多峰：独立解析真值、参数约束与输入边界。"""
import importlib
import json
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def gaussian(x, area, center, width):
    return area * np.sqrt(4*np.log(2)/np.pi) / width * np.exp(-4*np.log(2)*((x-center)/width)**2)


def fixture():
    x = np.linspace(0, 12, 501)
    y = 3 + .2*x + gaussian(x, 80, 5, 1.5) + gaussian(x, 50, 6.4, 1.2)
    return dict(x=x.tolist(), y=y.tolist(), range_start=0, range_end=12,
                baseline=dict(kind='line', anchors=[dict(x=0, y=3), dict(x=12, y=5.4)], confirmed=True),
                components=[dict(id=id, model='gaussian', parameters={
                    'A': dict(value=a*.9), 'xc': dict(value=c+.1), 'w': dict(value=w*1.1)})
                    for id, a, c, w in [('p1',80,5,1.5), ('p2',50,6.4,1.2)]])


class MultiPeakTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(importlib.util.find_spec('app.multipeak_fitting'), '通用多峰尚未实现')
        self.schema = importlib.import_module('app.multipeak_schemas').MultiPeakRequest
        self.engine = importlib.import_module('app.multipeak_fitting')

    def fit(self, payload):
        return self.engine.fit_multipeak(self.schema.model_validate(payload))

    def test_overlapping_peaks_recover_truth(self):
        r = self.fit(fixture())
        self.assertTrue(r['converged'])
        for c, truth in zip(r['components'], [(80,5,1.5),(50,6.4,1.2)]):
            np.testing.assert_allclose([c['parameters'][p]['value'] for p in ['A','xc','w']], truth, rtol=1e-5)
        np.testing.assert_allclose(r['total_y'], np.array(r['baseline']) + np.sum([c['y'] for c in r['components']],axis=0))
        self.assertLess(r['statistics']['rmse'],1e-6)
        self.assertNotIn('能量校准', ' '.join(r['diagnostics']['warnings']))
        json.dumps(r, allow_nan=False)

    def test_constraints_and_fixed_values(self):
        p = fixture()
        p['constraints'] = [dict(source=dict(component='p1',parameter='xc'),target=dict(component='p2',parameter='xc'),kind='offset',value=1.4)]
        p['components'][0]['parameters']['w'] = dict(value=1.5,fixed=True)
        r = self.fit(p)
        self.assertEqual(r['statistics']['free_parameters'],4)
        self.assertAlmostEqual(r['components'][1]['parameters']['xc']['value']-r['components'][0]['parameters']['xc']['value'],1.4)

    def test_psdvoigt2_width_ratio(self):
        p = fixture()
        x = np.array(p['x'])
        def peak(a,c,wg,wl,mu):
            return (1-mu)*gaussian(x,a,c,wg)+mu*a*wl/(2*np.pi*((x-c)**2+wl**2/4))
        p['y'] = (3+.2*x+peak(80,4,1,1.4,.3)+peak(50,8,1.2,1.5,.4)).tolist()
        p['components'] = [dict(id=id,model='psd_voigt2',parameters={k:dict(value=v) for k,v in zip(['A','xc','wG','wL','mu'],[a,c,wg,wl,m])}) for id,a,c,wg,wl,m in [('p1',75,4.1,1,1.4,.3),('p2',45,8.1,1.2,1.5,.4)]]
        p['constraints'] = [dict(source=dict(component='p1',parameter='wG'),target=dict(component='p2',parameter='wG'),kind='ratio',value=1.2)]
        r = self.fit(p)
        self.assertTrue(r['converged'])
        self.assertLess(r['statistics']['rmse'],1e-5)
        self.assertAlmostEqual(r['components'][1]['parameters']['wG']['value']/r['components'][0]['parameters']['wG']['value'],1.2)

    def test_reject_bad_data_and_unreviewed_background(self):
        for change, message in [({'x':[0]*501},'X'),({'components':[]},'峰'),({'baseline':{'kind':'line','confirmed':False}},'复核')]:
            with self.subTest(change=change):
                with self.assertRaisesRegex(ValueError,message): self.fit({**fixture(),**change})

    def test_cycles_and_disabled_references(self):
        p=fixture()
        p['constraints']=[dict(source=dict(component=a,parameter='xc'),target=dict(component=b,parameter='xc'),kind='offset',value=v) for a,b,v in [('p1','p2',1.4),('p2','p1',-1.4)]]
        with self.assertRaisesRegex(ValueError,'循环'):self.fit(p)
        p['constraints']=p['constraints'][:1]
        p['components'][1]['enabled']=False
        with self.assertRaisesRegex(ValueError,'停用'):self.fit(p)

    def test_rank_deficiency(self):
        p=fixture()
        p['components'][1]['parameters']=dict(p['components'][0]['parameters'])
        for c in p['components']:
            c['parameters']={k:{**v,'fixed':k!='A'} for k,v in c['parameters'].items()}
        r=self.fit(p)
        self.assertFalse(r['diagnostics']['identifiable'])

    def test_preview_and_candidates_without_components(self):
        p=fixture();p['components']=[]
        request=self.schema.model_validate(p)
        preview=self.engine.preview_multipeak(request)
        np.testing.assert_allclose(preview['baseline'],3+.2*np.array(p['x']))
        self.assertTrue(self.engine.suggest_multipeak(request)['candidates'])

    def test_three_mixed_peaks_from_independent_reference(self):
        from scipy.stats import exponnorm
        from scipy.optimize import minimize_scalar
        x=np.linspace(-6,18,601)
        mode=minimize_scalar(lambda z:-exponnorm.pdf(z,1.5),bounds=(-1,4),method='bounded').x
        low,high,mu=.6,1.1,.3
        h=np.where(x<0,low,high)
        split=30/(low+high)*((1-mu)*np.sqrt(4*np.log(2)/np.pi)*np.exp(-np.log(2)*(x/h)**2)+mu*2/np.pi/(1+(x/h)**2))
        emg=20/.5*exponnorm.pdf((x-5)/.5+mode,1.5)
        lorentz=15*.8/(2*np.pi*((x-11)**2+.8**2/4))
        specs=[('split_psd_voigt',dict(A=30,xc=0,h_low=low,h_high=high,mu=mu)),('emg_high',dict(A=20,xc=5,sigma=.5,tau=.75)),('lorentz',dict(A=15,xc=11,w=.8))]
        p=dict(x=x.tolist(),y=(split+emg+lorentz).tolist(),baseline=dict(kind='none'),components=[dict(id=f'p{i}',model=model,parameters={k:dict(value=v+.05 if k=='xc' else v*.95) for k,v in pars.items()}) for i,(model,pars) in enumerate(specs)])
        r=self.fit(p)
        self.assertTrue(r['converged']);self.assertLess(r['statistics']['rmse'],1e-4)
        for c,(_,truth) in zip(r['components'],specs):
            np.testing.assert_allclose([c['parameters'][k]['value'] for k in truth],list(truth.values()),atol=1e-4,rtol=1e-4)

    def test_route_rejects_empty_peak_set_with_422(self):
        from fastapi import HTTPException
        from app.multipeak_routes import fit
        p=fixture();p['components']=[]
        with self.assertRaises(HTTPException) as error:fit(self.schema.model_validate(p))
        self.assertEqual(error.exception.status_code,422)
        from app.main import app
        self.assertIn('/api/multipeak/fit',app.openapi()['paths'])

    def test_batch_preflight_checks_degrees_of_freedom(self):
        self.assertTrue(hasattr(self.engine,'validate_multipeak'),'批量预检缺少参数图校验')
        p=fixture();p['x']=[0,4,8,12];p['y']=[3,4,5,5.4]
        with self.assertRaisesRegex(ValueError,'自由参数'):self.engine.validate_multipeak(self.schema.model_validate(p))

    def test_preflight_rejects_fixed_values_outside_sampled_range(self):
        p=fixture();p['components'][0]['parameters']['xc']=dict(value=15,fixed=True)
        with self.assertRaisesRegex(ValueError,'固定参数'):self.engine.validate_multipeak(self.schema.model_validate(p))


if __name__=='__main__':unittest.main()
