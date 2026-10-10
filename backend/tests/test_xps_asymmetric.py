import copy
import json
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app.peaks import evaluate_peak
from app.xps_schemas import XpsRequest
from app.xps_fitting import fit_xps
from app.xps_routes import XpsExport, export_xps
from app.xps_constraints import ParameterGraph


def fixture():
    x=np.linspace(-6,12,401)
    specs=[('p1','split_psd_voigt',dict(A=4,xc=0,h_low=.6,h_high=1.1,mu=.3)),
           ('p2','emg_high',dict(A=2,xc=3,sigma=.5,tau=1.)),
           ('p3','gaussian',dict(A=1,xc=6,w=.8))]
    y=sum(evaluate_peak(model,x,p) for _,model,p in specs)
    return dict(schema_version=2,x=x.tolist(),y=y.tolist(),range_start=-6,range_end=12,background=dict(kind='none'),
                components=[dict(id=id,model=model,parameters={k:dict(value=v,fixed=True) for k,v in p.items()}) for id,model,p in specs])


class XpsAsymmetricTests(unittest.TestCase):
    def test_indistinguishable_overlapping_emg_components_report_rank_failure(self):
        request=fixture();c=request['components'][1];c['id']='p1'
        for p in c['parameters'].values():p['fixed']=False
        second=copy.deepcopy(c);second['id']='p2';request['components']=[c,second]
        p={k:v['value'] for k,v in c['parameters'].items()};x=np.array(request['x'])
        request['y']=(2*evaluate_peak('emg_high',x,p)).tolist()
        result=fit_xps(XpsRequest.model_validate(request))
        self.assertFalse(result['diagnostics']['identifiable'])
        self.assertTrue(all(v['standard_error'] is None for component in result['components'] for v in component['parameters'].values()))

    def test_weak_emg_tail_suppresses_sigma_uncertainty(self):
        x=np.linspace(-6,6,301)
        params=dict(A=4,xc=0,sigma=1,tau=.0002)
        request=dict(schema_version=2,x=x.tolist(),y=evaluate_peak('emg_high',x,params).tolist(),range_start=-6,range_end=6,
                     background=dict(kind='none'),components=[dict(id='p1',model='emg_high',parameters={k:dict(value=v,fixed=k not in ('sigma','tau')) for k,v in params.items()})])
        result=fit_xps(XpsRequest.model_validate(request))
        sigma=result['components'][0]['parameters']['sigma']
        self.assertIsNone(sigma['standard_error'])
        self.assertTrue(sigma['uncertainty_reason'])
        self.assertFalse(result['diagnostics']['uncertainty_available'])

    def test_fixed_zero_tail_retains_identifiable_gaussian_width_error(self):
        x=np.linspace(-6,6,301);params=dict(A=4,xc=0,sigma=1,tau=0)
        request=dict(schema_version=2,x=x.tolist(),y=(evaluate_peak('emg_high',x,params)+.001*np.cos(4*x)).tolist(),range_start=-6,range_end=6,
                     background=dict(kind='none'),components=[dict(id='p1',model='emg_high',parameters={k:dict(value=v,fixed=k!='sigma') for k,v in params.items()})])
        result=fit_xps(XpsRequest.model_validate(request))
        self.assertGreater(result['components'][0]['parameters']['sigma']['standard_error'],0)


    def test_free_mixed_components_recover_from_perturbed_initials(self):
        request=fixture()
        truth=copy.deepcopy(request['components'])
        for factor in (.8,1.2):
            for c,t in zip(request['components'],truth):
                for name,p in c['parameters'].items():
                    p['fixed']=False
                    p['value']=t['parameters'][name]['value']*factor if name!='xc' else t['parameters'][name]['value']+.15
            result=fit_xps(XpsRequest.model_validate(request))
            self.assertTrue(result['converged'])
            for c,t in zip(result['components'],truth):
                for name,p in c['parameters'].items():self.assertAlmostEqual(p['value'],t['parameters'][name]['value'],places=5)

    def test_mixed_components_geometry_and_version_two_replay(self):
        request=fixture();result=fit_xps(XpsRequest.model_validate(request))
        np.testing.assert_allclose(result['total_y'],request['y'],rtol=1e-12)
        self.assertEqual(len(result['components']),3)
        for c in result['components']:
            self.assertIsNotNone(c['peak_geometry']['fwhm'])
            self.assertAlmostEqual(c['area_window'],c['peak_geometry']['area_in_range'])
        artifact=json.loads(export_xps(XpsExport(kind='configuration',request=request)).body)
        self.assertEqual(artifact['schema_version'],2)
        self.assertEqual(artifact['request']['schema_version'],2)
        replay=fit_xps(XpsRequest.model_validate(artifact['request']))
        np.testing.assert_array_equal(replay['total_y'],result['total_y'])
        parameters=export_xps(XpsExport(kind='parameters',request=request)).body.decode('utf-8-sig')
        self.assertIn('geometry.fwhm',parameters)
        self.assertIn('geometry.area_method',parameters)

    def test_version_one_rejects_new_model_old_only_export_stays_one(self):
        request=fixture();request['schema_version']=1
        with self.assertRaisesRegex(ValueError,'版本 2'):XpsRequest.model_validate(request)
        request['components']=request['components'][2:]
        request['schema_version']=2
        artifact=json.loads(export_xps(XpsExport(kind='configuration',request=request)).body)
        self.assertEqual(artifact['schema_version'],1)
        self.assertEqual(artifact['request']['schema_version'],1)
        with self.assertRaises(ValueError):XpsRequest.model_validate({**request,'schema_version':3})

    def test_same_semantic_width_constraints_and_cross_width_rejection(self):
        request=fixture();request['components']=request['components'][:1]
        second=copy.deepcopy(request['components'][0]);second['id']='p2'
        request['components'].append(second)
        for c in request['components']:
            for p in c['parameters'].values():p['fixed']=False
        request['constraints']=[dict(source=dict(component='p1',parameter='h_low'),target=dict(component='p2',parameter='h_low'),kind='ratio',value=2)]
        cfg=XpsRequest.model_validate(request);g=ParameterGraph(cfg,np.array(cfg.x))
        values=g.values(g.initial)
        self.assertAlmostEqual(values['p2','h_low'],2*values['p1','h_low'])
        request['constraints'][0]['target']['parameter']='h_high'
        with self.assertRaisesRegex(ValueError,'约束'):ParameterGraph(XpsRequest.model_validate(request),np.array(cfg.x))


if __name__=='__main__':unittest.main()
