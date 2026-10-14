"""用独立双高斯真值检验 20 条谱的上一条结果继承。"""
import copy
import sys
import unittest
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app.multipeak_schemas import MultiPeakRequest
from app.multipeak_fitting import fit_multipeak
from test_multipeak import fixture, gaussian


class BatchSequenceTests(unittest.TestCase):
    def test_twenty_spectra_warm_start_recover_drifting_peaks(self):
        template=fixture();initial=copy.deepcopy(template['components']);rng=np.random.default_rng(813)
        x=np.asarray(template['x'])
        for i in range(20):
            p=copy.deepcopy(template);p['components']=copy.deepcopy(initial)
            truth=[(80,5+i*.01,1.5),(50,6.4+i*.01,1.2)]
            signal=sum(gaussian(x,*peak) for peak in truth)
            p['y']=(3+.2*x+signal+rng.normal(0,signal.max()*.005,len(x))).tolist()
            result=fit_multipeak(MultiPeakRequest.model_validate(p))
            self.assertTrue(result['converged'],f'谱 {i+1}')
            for c,(a,xc,w) in zip(result['components'],truth):
                self.assertLess(abs(c['parameters']['xc']['value']-xc),.1*w)
                self.assertLess(abs(c['parameters']['A']['value']/a-1),.05)
                self.assertLess(abs(c['parameters']['w']['value']/w-1),.05)
            for c,r in zip(initial,result['components']):
                for name,param in c['parameters'].items():param['value']=r['parameters'][name]['value']


if __name__=='__main__':unittest.main()
