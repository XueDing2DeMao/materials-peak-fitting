import {readFileSync} from 'node:fs';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {exportXpsResult,xpsExportRows} from './xpsResultExport';
import * as files from './resultExport';

const fixture=()=>JSON.parse(readFileSync('../examples/public/results/xps-result.json','utf8'));
afterEach(()=>vi.restoreAllMocks());
describe('XPS 当前结果导出',()=>{
  it('曲线逐点保留求解结果，包括净信号与每个分量',()=>{
    const result=fixture(),rows=xpsExportRows('curves',result);
    expect(rows[0]).toEqual(['energy_raw_eV','binding_energy_eV','raw_y','baseline','total_y','residual','net_total',...result.components.map((c:any)=>`component_${c.id}`)]);
    expect(rows).toHaveLength(result.x.length+1);
    result.x.forEach((_:number,i:number)=>expect(rows[i+1]).toEqual([result.x_raw[i],result.x[i],result.raw_y[i],result.baseline[i],result.total_y[i],result.residuals[i],result.net_total[i],...result.components.map((c:any)=>c.y[i])]));
  });
  it('参数保留边界、约束状态、峰组、几何量缺失原因与追溯信息',()=>{
    const result=fixture(),peak=result.components[0];
    peak.parameters.A.linked_to='p2.A';peak.parameters.A.fixed=true;
    peak.peak_geometry.fwhm=null;peak.peak_geometry.reasons.fwhm='半高点不可求';
    peak.peak_geometry.warnings=['测试几何警告'];
    const rows=xpsExportRows('parameters',result),p=peak.parameters.A;
    expect(rows[0]).toEqual(['component','label','parameter','value','standard_error','uncertainty_reason','linked_to','fixed','bound','model','lower','upper','state']);
    expect(rows.find(row=>row[0]===peak.id&&row[2]==='A')).toEqual([peak.id,peak.label,'A',p.value,p.standard_error,p.uncertainty_reason,'p2.A','True',p.bound?'True':'False',peak.model,p.lower,p.upper,'linked_fixed']);
    expect(rows).toContainEqual([peak.id,'geometry.fwhm',null,'X 单位','半高点不可求']);
    expect(rows).toContainEqual([peak.id,'geometry.warning','测试几何警告','','']);
    expect(rows).toContainEqual(['data_sha256',result.data_sha256]);
    expect(JSON.parse(rows.find(row=>row[0]==='configuration_json')![1] as string)).toEqual(result.configuration);
    for(const group of result.groups)expect(rows).toContainEqual([group.id,group.label,'area_window',group.area_window]);
  });
  it('JSON 沿用可复用配置格式，完整保存当前结果而不改写它',()=>{
    const save=vi.spyOn(files,'saveFile').mockImplementation(()=>{}),result=fixture();
    const before=JSON.stringify(result);exportXpsResult('configuration',result);
    expect(save.mock.calls[0][0]).toBe('xps-configuration.json');
    expect(JSON.parse(save.mock.calls[0][1])).toEqual({schema_version:result.configuration.schema_version,application:'peak-fitting-xps',request:result.configuration,result});
    expect(JSON.stringify(result)).toBe(before);
  });
  it('CSV 防止标签被表格软件当作公式，下载失败交给界面处理',()=>{
    const save=vi.spyOn(files,'saveFile').mockImplementation(()=>{}),result=fixture();
    result.components[0].label='=1+1';exportXpsResult('parameters',result);
    expect(save.mock.calls[0][1]).toContain('"\'=1+1"');
    save.mockImplementation(()=>{throw new Error('下载不可用');});
    expect(()=>exportXpsResult('curves',result)).toThrow('下载不可用');
  });
});
