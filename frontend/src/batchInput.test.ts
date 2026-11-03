import { describe, expect, it } from 'vitest';
import { createMultiConfig } from './multipeakState';
import { createConfig } from './xpsState';
async function input(){const modules=import.meta.glob('./batchInput.ts');expect(modules['./batchInput.ts']).toBeDefined();return await modules['./batchInput.ts']() as typeof import('./batchInput');}
describe('批量数据快照',()=>{
  it('XRD/XPS 阻止不兼容的 X 表头；保留显式正确与未标单位的谱线',async()=>{
    const {prepareRequest}=await input(),data={x:[0,1,2,3],y:[0,1,2,0]};
    const source=(label:string)=>({filename:'t',file_sha256:'a'.repeat(64),sheet:'s',x_column:label,y_column:'y'});
    const xrd=createMultiConfig(data.x,data.y,null,'xrd'), xps=createConfig(data.x,data.y,null);
    for(const [config,wrong,allowed] of [[xrd,'θ [rad]','θ [DEG]'],[xps,'E [keV]','E [EV]']] as const){
      config.range_start=0;config.range_end=3;
      expect(()=>prepareRequest(config,data,source(wrong),true)).toThrow('单位');
      expect(prepareRequest(config,data,source(allowed),true).x).toEqual(data.x);
      expect(prepareRequest(config,data,source('X'),true).x).toEqual(data.x);
    }
  });
  it('当前数据与来源独立，端点背景重新估计并撤销确认',async()=>{
    const {prepareRequest}=await input(),c=createMultiConfig([0,1,2,3],[0,1,2,0],null,'general');c.baseline.confirmed=true;
    const source={filename:'b.csv',file_sha256:'b'.repeat(64),sheet:'s',x_column:'x',y_column:'b'};
    const r=prepareRequest(c,{x:[0,1,2,3],y:[10,11,12,10]},source,false);
    expect('baseline' in r&&r.baseline.confirmed).toBe(false);expect(r.source).toEqual(source);expect(r.y[0]).toBe(10);expect(c.y[0]).toBe(0);
  });
  it('显式锚点不允许悄悄跨谱照搬，重复X和区间不足都被拒绝',async()=>{
    const {prepareRequest}=await input(),c=createMultiConfig([0,1,2,3],[0,1,2,0],null,'general');c.baseline.anchors=[{x:0,y:0},{x:3,y:0}];
    expect(()=>prepareRequest(c,{x:c.x,y:c.y},null,false)).toThrow('固定');
    expect(()=>prepareRequest(c,{x:[0,1,1,3],y:c.y},null,true)).toThrow('重复');
    expect(()=>prepareRequest(c,{x:[1,2,3,4],y:c.y},null,true)).toThrow('覆盖');
  });
});
