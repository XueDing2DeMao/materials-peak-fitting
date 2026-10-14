import { describe, expect, it } from 'vitest';
import { createMultiConfig } from './multipeakState';
async function input(){const modules=import.meta.glob('./batchInput.ts');expect(modules['./batchInput.ts']).toBeDefined();return await modules['./batchInput.ts']() as typeof import('./batchInput');}
describe('批量数据快照',()=>{
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
