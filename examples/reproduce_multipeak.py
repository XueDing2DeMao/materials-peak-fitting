"""生成可复算的双峰连续谱，并保存首谱配置用于界面演练。"""
import csv
import hashlib
import json
import sys
from pathlib import Path
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))
from app.datasets import parse_upload, select_xy
from app.multipeak_schemas import MultiPeakRequest
from app.multipeak_fitting import fit_multipeak


def main():
    x=np.linspace(0,12,501)
    ys=[]
    for i in range(20):
        y=3+.2*x
        for area,center,width in [(80,5+i*.01,1.5),(50,6.4+i*.01,1.2)]:
            y=y+area*np.sqrt(4*np.log(2)/np.pi)/width*np.exp(-4*np.log(2)*((x-center)/width)**2)
        ys.append(y)
    path=ROOT/'examples/multipeak_sequence_demo.csv'
    with path.open('w',newline='',encoding='utf-8') as stream:
        writer=csv.writer(stream);writer.writerow(['x']+[f'spectrum_{i+1:02d}' for i in range(20)]);writer.writerows(zip(x,*ys))
    content=path.read_bytes();workbook=parse_upload(path.name,content)
    xx,yy=select_xy(workbook,'数据','x','spectrum_01')
    payload=dict(analysis_mode='general',x=xx.tolist(),y=yy.tolist(),range_start=0,range_end=12,
        baseline=dict(kind='line',anchors=[dict(x=0,y=3),dict(x=12,y=5.4)],confirmed=True),
        components=[dict(id=id,label=id,model='gaussian',parameters={'A':dict(value=a*.9),'xc':dict(value=c+.1),'w':dict(value=w*1.1)}) for id,a,c,w in [('p1',80,5,1.5),('p2',50,6.4,1.2)]],
        source=dict(filename=path.name,file_sha256=hashlib.sha256(content).hexdigest(),sheet='数据',x_column='x',y_column='spectrum_01'))
    result=fit_multipeak(MultiPeakRequest.model_validate(payload))
    if not result['converged'] or result['statistics']['rmse']>1e-6:raise RuntimeError('首谱复算失败')
    artifact=ROOT/'examples/multipeak_demo_configuration.json'
    artifact.write_text(json.dumps({'configuration':result['configuration']},ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(dict(spectra=20,points=501,rmse=result['statistics']['rmse'],configuration=str(artifact)),ensure_ascii=False))


if __name__=='__main__':main()
