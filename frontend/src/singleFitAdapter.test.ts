import { describe, expect, it } from 'vitest';
import { addMultiComponent, changeMultiModel, createMultiConfig, loadMultiConfiguration } from './multipeakState';
import { readSingleSettings, singleRequest } from './singleFitAdapter';

describe('统一界面的单峰适配',()=>{
  it('不收紧原单峰的中心与宽度范围，并能恢复同一配置',()=>{
    const source={filename:'test.csv',file_sha256:'abc',sheet:'data',x_column:'x',y_column:'y'};
    const c=createMultiConfig([0,1,2,3,4],[1,2,3,2,1],source,'general');
    const p=addMultiComponent(c);changeMultiModel(c,p.id,'gaussian');
    p.parameters.xc={value:-1,fixed:true};p.parameters.w={value:1e-10,fixed:true};
    const settings={staged:false,centerEvaluations:35};
    expect(singleRequest(c,settings)).toMatchObject({fixed_parameters:{xc:-1,w:1e-10},staged_fit:false,center_lock_evaluations:35});
    const artifact=JSON.parse(JSON.stringify({configuration:c,single_solver_settings:settings}));
    const restored=loadMultiConfiguration(artifact,c.x,c.y,source,'general',c=>{singleRequest(c,settings);});
    expect(restored.components).toEqual(c.components);
    expect(readSingleSettings(artifact.single_solver_settings)).toEqual(settings);
  });
  it('不静默丢弃关联、固定参数或非法初值',()=>{
    const c=createMultiConfig([0,1,2,3],[1,2,3,1],null,'general'),p=addMultiComponent(c);
    p.parameters.xc!.value=NaN;
    expect(()=>singleRequest(c,{staged:true,centerEvaluations:20})).toThrow('有限数值');
    p.parameters.xc!.value=2;c.constraints.push({source:{component:'p2',parameter:'xc'},target:{component:'p1',parameter:'xc'},kind:'offset',value:1});
    expect(()=>singleRequest(c,{staged:true,centerEvaluations:20})).toThrow('关联');
    expect(()=>readSingleSettings({staged:true,centerEvaluations:-1})).toThrow('求解设置');
  });
});
