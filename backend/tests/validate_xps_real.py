"""公开实谱验收。探索峰组不声明化学态；结果与配置保存以便复核。"""
import copy
import csv
import hashlib
import io
import json
import sys
import urllib.error
import urllib.request
import warnings
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend'))
from app.datasets import parse_upload, select_xy
from app.fitting import FitInput, fit_single_peak
from app.main import fit_result_to_dict
from app.xps_backgrounds import preview_background
from app.xps_fitting import fit_xps, suggest_candidates
from app.xps_routes import XpsExport, export_xps
from app.xps_schemas import XpsRequest

DATA = ROOT / 'data/public_spectra/zenodo_18845748'
OLD = ROOT / 'data/analysis/raman_xps_peak_fit_20260920'
OUT = ROOT / 'data/analysis/xps_implementation_20260920'
OUT.mkdir(exist_ok=True)


def save(name, obj):
    (OUT/name).write_text(json.dumps(obj, ensure_ascii=False, indent=2, allow_nan=False), encoding='utf-8')


def post(path, payload):
    req = urllib.request.Request('http://127.0.0.1:5176'+path, data=json.dumps(payload, allow_nan=False).encode(), headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(req, timeout=120) as response:
        return response.read()


def peak(id, area, center, width):
    return {'id':id,'label':f'探索分量 {id}（未归属）','model':'psd_voigt1',
            'parameters':{'A':{'value':max(area,1)},'xc':{'value':center,'lower':center-1.5,'upper':center+1.5},'w':{'value':width,'lower':.15,'upper':6},'mu':{'value':.35}}}


def configuration(book, sheet, sample):
    x,y=select_xy(book,sheet,'Binding Energy (E)',sample)
    n=max(3,len(x)//30)
    cfg={'x':x.tolist(),'y':y.tolist(),'range_start':float(x[0]),'range_end':float(x[-1]),
         'background':{'kind':'line','low_level':float(np.median(y[:n])),'high_level':float(np.median(y[-n:])), 'confirmed':True},
         'source':{'filename':'XPS.xlsx','file_sha256':hashlib.sha256((DATA/'XPS.xlsx').read_bytes()).hexdigest(),'sheet':sheet,'x_column':'Binding Energy (E)','y_column':sample},
         'solver':{'max_nfev':1200,'tolerance':1e-9},'calibration_note':'未做能量平移。探索峰形验收，不作化学态或原子浓度解释。'}
    baseline=np.linspace(cfg['background']['low_level'],cfg['background']['high_level'],len(x))
    net=y-baseline
    if sheet=='Ge2p':
        centers=[1218.1,1249.2,1220.6,1251.7]
        cfg['components']=[peak(f'p{i+1}',float(np.interp(c,x,net))*1.8,c,1.3 if i<2 else 1.8) for i,c in enumerate(centers)]
        cfg['constraints']=[{'target':{'component':b,'parameter':p},'source':{'component':a,'parameter':p},'kind':kind,'value':v}
                            for a,b in [('p1','p2'),('p3','p4')] for p,kind,v in [('xc','offset',31.1),('A','ratio',.5),('w','ratio',1)]]
        cfg['groups']=[{'id':'g1','label':'探索组 1（未归属）','component_ids':['p1','p2']},{'id':'g2','label':'探索组 2（未归属）','component_ids':['p3','p4']}]
    else:
        candidates=suggest_candidates(XpsRequest.model_validate(cfg))['candidates']
        selected=[]
        for c in candidates:
            if all(abs(c['xc']-p['xc'])>1.5 for p in selected):selected.append(c)
            if len(selected)==2:break
        if not selected: selected=[{'A':float(np.ptp(y)), 'xc':float(x[np.argmax(y)]), 'w':1}]
        cfg['components']=[peak(f'p{i+1}',p['A'],p['xc'],min(p['w'],4)) for i,p in enumerate(selected)]
    return XpsRequest.model_validate(cfg)


def main():
    raman=parse_upload('Raman.xlsx',(DATA/'Raman.xlsx').read_bytes())
    xps=parse_upload('XPS.xlsx',(DATA/'XPS.xlsx').read_bytes())
    baseline=json.loads((OLD/'batch_results.json').read_text(encoding='utf-8'))
    report={'purpose':'工程兼容性验收；真实谱无参数真值，不验证化学归属', 'raman':[], 'xps':[], 'previous_warning_cases':[], 'http':[]}
    for row in baseline:
        if row['file']!='Raman.xlsx':continue
        x,y=select_xy(raman,row['sheet'],'Wavenumber',row['sample'])
        r=fit_single_peak(FitInput(x=x,y=y,model='psd_voigt1',baseline_kind='line',anchors=[],range_start=280,range_end=320,anchor_source='endpoint_default'))
        actual=[r.parameters['xc'].value,r.parameters['w'].value]
        expected=[row['xc'],row['fwhm']]
        np.testing.assert_allclose(actual,expected,rtol=1e-6,atol=1e-6)
        report['raman'].append({'sheet':row['sheet'],'sample':row['sample'],'center_difference':actual[0]-expected[0],'width_difference':actual[1]-expected[1],'passed':True})
    print('Raman regression: 33 passed',flush=True)
    old_warnings={(r['sheet'],r['sample']) for r in json.loads((OLD/'uncertainty_checks.json').read_text(encoding='utf-8'))}
    for sheet in xps.sheets:
        for sample in sheet.numeric_columns[1:]:
            config=configuration(xps,sheet.name,sample)
            item={'sheet':sheet.name,'sample':sample}
            try:
                with warnings.catch_warnings(record=True) as caught:
                    warnings.simplefilter('always');result=fit_xps(config)
                json.dumps(result,allow_nan=False)
                np.testing.assert_allclose(np.sum([c['y'] for c in result['components']],axis=0)+result['baseline'],result['total_y'])
                np.testing.assert_allclose(np.array(result['raw_y'])-result['total_y'],result['residuals'])
                np.testing.assert_allclose(preview_background(config)['baseline'],result['baseline'])
                exported=export_xps(XpsExport(kind='curves',request=config)).body.decode('utf-8-sig')
                rows=list(csv.DictReader(io.StringIO(exported)))
                np.testing.assert_allclose([float(r['total_y']) for r in rows],result['total_y'],rtol=1e-6,atol=1e-6)
                item.update(status='computed',converged=result['converged'],statistics=result['statistics'],diagnostics=result['diagnostics'],numeric_warnings=[str(w.message) for w in caught],export_points=len(rows))
                if (sheet.name,sample) in old_warnings:
                    # 另用原先单峰形态复查混合比例边界，避免仅靠换成多峰规避问题。
                    single=copy.deepcopy(config.model_dump());single['components']=single['components'][:1];single['constraints']=[];single['groups']=[]
                    single['components'][0]['parameters']['xc'].update(lower=None,upper=None)
                    single['components'][0]['parameters']['w'].update(upper=None)
                    with warnings.catch_warnings(record=True) as caught_single:
                        warnings.simplefilter('always');sr=fit_xps(XpsRequest.model_validate(single))
                    json.dumps(sr,allow_nan=False)
                    mu=sr['components'][0]['parameters']['mu']
                    assert not(mu['bound'] and mu['standard_error']==0)
                    report['previous_warning_cases'].append({'sheet':sheet.name,'sample':sample,'numeric_warnings':[str(w.message) for w in caught_single],'mu':mu,'diagnostics':sr['diagnostics']})
                if sheet.name=='Ge2p' and sample=='Pristine Ge #1':
                    save('ge2p-line-result.json',result)
                    (OUT/'ge2p-line-configuration.json').write_bytes(export_xps(XpsExport(kind='configuration',request=config)).body)
                    (OUT/'ge2p-line-curves.csv').write_text(exported,encoding='utf-8-sig')
            except ValueError as exc:item.update(status='not_applicable',error=str(exc))
            report['xps'].append(item)
        print(f'XPS {sheet.name}: completed {len(report["xps"])}',flush=True)
    reference=configuration(xps,'Ge2p','Pristine Ge #1')
    single=reference.model_dump();single['components']=single['components'][:1];single['constraints']=[];single['groups']=[]
    single['components'][0]['parameters']['xc'].update(lower=None,upper=None)
    single['components'][0]['parameters']['w'].update(upper=None)
    single_result=fit_xps(XpsRequest.model_validate(single));save('ge2p-single-same-background.json',single_result)
    multi_result=fit_xps(reference)
    report['same_background_comparison']={'single':single_result['statistics'],'four_components':multi_result['statistics'],
        'conditions':'相同原谱、区间、无权重、固定直线背景；四峰约束为探索配置，未归属化学态'}
    report['representative_initializations']=[]
    for shift,area_scale,width_scale in [(-.3,.75,.8),(0,1,1),(.3,1.25,1.2)]:
        cfg=copy.deepcopy(reference.model_dump())
        for c in cfg['components']:
            c['parameters']['xc']['value']+=shift;c['parameters']['A']['value']*=area_scale;c['parameters']['w']['value']*=width_scale
        result=fit_xps(XpsRequest.model_validate(cfg))
        report['representative_initializations'].append({'initial_shift':shift,'area_scale':area_scale,'width_scale':width_scale,'rss':result['statistics']['rss'],'parameters':{c['id']:c['parameters'] for c in result['components']},'diagnostics':result['diagnostics']})
    cfg=reference.model_dump();cfg['background']['kind']='shirley';cfg['background']['confirmed']=True
    try:
        result=fit_xps(XpsRequest.model_validate(cfg));save('ge2p-shirley-result.json',result)
        report['shirley_scenario']={'status':'computed','statistics':result['statistics'],'diagnostics':result['diagnostics']}
        (OUT/'ge2p-shirley-configuration.json').write_bytes(export_xps(XpsExport(kind='configuration',request=cfg)).body)
    except ValueError as exc:report['shirley_scenario']={'status':'not_applicable','error':str(exc)}
    for case in ('raman_pristine','raman_laser','xps_ge2p_full'):
        old=json.loads((OLD/f'{case}.json').read_text(encoding='utf-8'));book=raman if old['file']=='Raman.xlsx' else xps
        x,y=select_xy(book,old['sheet'],'Wavenumber' if book is raman else 'Binding Energy (E)',old['sample'])
        a,b=old['requested_range'];payload={'x':x.tolist(),'y':y.tolist(),'model':'psd_voigt1','baseline_kind':'line','anchors':[],'range_start':a,'range_end':b,'anchor_source':'endpoint_default','baseline_confirmed':True}
        api=json.loads(post('/api/fit',payload));np.testing.assert_allclose(api['total_y'],old['result']['total_y'],rtol=1e-6,atol=1e-6)
        csv_rows=list(csv.DictReader(io.StringIO(post('/api/export',{'kind':'curves','result':api}).decode('utf-8-sig'))))
        assert len(csv_rows)==len(api['x'])
        report['http'].append({'case':case,'curve_equal':True,'export_points':len(csv_rows)})
    api=json.loads(post('/api/xps/fit',reference.model_dump()));core=fit_xps(reference)
    np.testing.assert_allclose(api['total_y'],core['total_y'],rtol=1e-6,atol=1e-6)
    artifact=json.loads(post('/api/xps/export',{'kind':'configuration','request':reference.model_dump()}))
    replay=json.loads(post('/api/xps/fit',artifact['request']));np.testing.assert_allclose(api['total_y'],replay['total_y'],rtol=1e-6,atol=1e-6)
    report['http'].append({'case':'xps_multipeak','curve_equal':True,'configuration_replay':True})
    bad=reference.model_dump();bad['x'][1]=bad['x'][0]
    try:post('/api/xps/fit',bad);raise AssertionError('duplicate energy accepted')
    except urllib.error.HTTPError as exc:assert exc.code==422
    report['http'].append({'case':'invalid_duplicate','http':422})
    report['summary']={'raman_passed':len(report['raman']),'xps_checked':len(report['xps']),'xps_computed':sum(r['status']=='computed' for r in report['xps']),
                       'xps_converged':sum(r.get('converged',False) for r in report['xps']),'previous_warning_cases_checked':len(report['previous_warning_cases'])}
    rss_values=[row['rss'] for row in report['representative_initializations']]
    parameter_values=np.array([[row['parameters'][c][p]['value'] for c in ['p1','p2','p3','p4'] for p in ['A','xc','w','mu']] for row in report['representative_initializations']])
    report['initialization_sensitivity']={'relative_rss_spread':(max(rss_values)-min(rss_values))/min(rss_values),
        'max_scaled_parameter_spread':float(np.max(np.ptp(parameter_values,axis=0)/np.maximum(np.abs(parameter_values[1]),1))),
        'interpretation':'三组所测初值得到相近解；不代表已排除所有局部极小值或模型正确'}
    save('validation.json',report)
    print(json.dumps(report['summary']),flush=True)


if __name__=='__main__':main()
