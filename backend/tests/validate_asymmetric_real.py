"""代表性实谱的工程回放；输出另存，不推断化学态或峰形的物理机制。"""
import copy
import csv
import io
import json
import sys
import time
from pathlib import Path

import numpy as np

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'backend'))
from app.datasets import parse_upload,select_xy
from app.fitting import FitInput,fit_single_peak
from app.main import fit_result_to_dict,export
from app.schemas import ExportPayload
from app.peaks import evaluate_peak
from app.xps_fitting import fit_xps
from app.xps_schemas import XpsRequest
from app.xps_routes import export_xps,XpsExport

OUT=ROOT/'data/analysis/asymmetric_20260920'
OUT.mkdir(exist_ok=True)
OLD=ROOT/'data/analysis/raman_xps_peak_fit_20260920'
def save(name,data):
    (OUT/name).write_text(json.dumps(data,ensure_ascii=False,indent=2,allow_nan=False),encoding='utf-8')

def main():
    data=ROOT/'data/public_spectra/zenodo_18845748'
    books={name:parse_upload(name,(data/name).read_bytes()) for name in ('Raman.xlsx','XPS.xlsx')}
    report={'purpose':'工程验证：固定同一数据、区间、基线；不据此判定模型物理适用性','single':[],'old_replay':[],'xps':[]}
    for case in ('raman_pristine','raman_laser','xps_ge2p_local','xps_ti2p_full','xps_ti3p_full'):
        old=json.loads((OLD/f'{case}.json').read_text(encoding='utf-8'))
        x,y=select_xy(books[old['file']],old['sheet'],'Wavenumber' if old['file']=='Raman.xlsx' else 'Binding Energy (E)',old['sample'])
        low,high=old['requested_range']
        for model in ('psd_voigt1','split_psd_voigt','emg_high','emg_low'):
            start=time.perf_counter()
            result=fit_result_to_dict(fit_single_peak(FitInput(x,y,model,'line',[],range_start=low,range_end=high,anchor_source='endpoint_default')))
            seconds=time.perf_counter()-start
            save(f'{case}-{model}.json',result)
            params=export(ExportPayload(kind='parameters',result=result)).body.decode()
            rows=list(csv.reader(io.StringIO(params)))
            for name in ('fwhm','area_total','area_in_range'):
                value=next(row[1] for row in rows if row and row[0]==f'geometry.{name}')
                assert float(value)==result['peak_geometry'][name]
            (OUT/f'{case}-{model}-parameters.csv').write_text(params,encoding='utf-8-sig')
            if model=='psd_voigt1':
                np.testing.assert_allclose(result['total_y'],old['result']['total_y'],rtol=1e-6,atol=1e-6)
                report['old_replay'].append({'case':case,'curve_equal':True})
            report['single'].append({'case':case,'model':model,'seconds':seconds,'converged':result['converged'],
                                     'statistics':result['statistics'],'geometry':result['peak_geometry'],'diagnostics':result['analysis_metadata']})
        print(f'{case}: four models and CSV checked',flush=True)
    old=json.loads((ROOT/'data/analysis/xps_implementation_20260920/ge2p-shirley-result.json').read_text(encoding='utf-8'))
    request=old['configuration']
    replay=fit_xps(XpsRequest.model_validate(request))
    np.testing.assert_allclose(replay['total_y'],old['total_y'],rtol=1e-6,atol=1e-6)
    report['old_replay'].append({'case':'ge2p-shirley-result.json','curve_equal':True,'schema_version':replay['configuration']['schema_version']})
    for model in ('split_psd_voigt','emg_high','emg_low'):
        cfg=copy.deepcopy(request);cfg['schema_version']=2
        width_names=['h_low','h_high'] if model=='split_psd_voigt' else ['sigma']
        # 明确把旧同宽关联转换为同语义的新宽度关联，仅用于这份探索配置。
        links=[]
        for link in cfg['constraints']:
            if link['target']['parameter']=='w':
                for name in width_names:
                    new=copy.deepcopy(link);new['source']['parameter']=name;new['target']['parameter']=name;links.append(new)
            else:links.append(link)
        cfg['constraints']=links
        for c in cfg['components']:
            oldp=c['parameters'];w=oldp['w']['value'];c['model']=model
            p={name:oldp[name] for name in ('A','xc')}
            for name in width_names:
                factor=.5 if name.startswith('h_') else 1/2.354820045
                p[name]={**oldp['w'],'value':w*factor,
                         'lower':oldp['w']['lower']*factor if oldp['w']['lower'] is not None else None,
                         'upper':oldp['w']['upper']*factor if oldp['w']['upper'] is not None else None}
            if model=='split_psd_voigt':p['mu']=oldp['mu']
            else:p['tau']={'value':w/2.354820045*.25,'fixed':False}
            c['parameters']=p
        start=time.perf_counter();result=fit_xps(XpsRequest.model_validate(cfg));seconds=time.perf_counter()-start
        np.testing.assert_allclose(np.sum([c['y'] for c in result['components']],axis=0)+result['baseline'],result['total_y'])
        artifact=json.loads(export_xps(XpsExport(kind='configuration',request=cfg)).body)
        assert artifact['schema_version']==artifact['request']['schema_version']==2
        np.testing.assert_allclose(fit_xps(XpsRequest.model_validate(artifact['request']))['total_y'],result['total_y'])
        save(f'ge2p-shirley-{model}-result.json',result);save(f'ge2p-shirley-{model}-configuration.json',artifact)
        report['xps'].append({'model':model,'seconds':seconds,'converged':result['converged'],'statistics':result['statistics'],'diagnostics':result['diagnostics'],'version_two_replay':True})
        print(f'Ge2p XPS {model}: version 2 replay checked',flush=True)
    points=np.linspace(-6,12,2001);p=dict(A=4,xc=0,sigma=1,tau=2)
    start=time.perf_counter()
    for _ in range(1000):evaluate_peak('emg_high',points,p)
    report['emg_evaluation_ms_per_2001_points']=(time.perf_counter()-start)
    report['summary']={'old_replays':len(report['old_replay']),'single_fits':len(report['single']),'single_converged':sum(r['converged'] for r in report['single']),'xps_fits':len(report['xps'])}
    save('validation.json',report);print(json.dumps(report['summary']),flush=True)

if __name__=='__main__':main()
