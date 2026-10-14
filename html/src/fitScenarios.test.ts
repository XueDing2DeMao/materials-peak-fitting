import {describe,expect,it} from 'vitest';
import {calculateScenario,type FitScenario} from './fitScenarios';
import {createMultiConfig} from './multipeakState';
describe('独立方案快照',()=>{
  it('成功或失败都不改主配置，保存请求并保留失败原因',async()=>{
    const config=createMultiConfig([0,1,2],[1,3,1],null,'general'),base:any={engine:'multi',configuration:config,result:{},stale:false};
    const original=JSON.stringify(base),item:FitScenario={id:'a',name:'替代',configuration:structuredClone(config),result:null,error:'',origin:original,running:false};
    await calculateScenario(item,base,async(b,c)=>{c.range_start=.5;b.configuration.x[0]=99;return {...b,configuration:c};});
    expect(JSON.stringify(base)).toBe(original);expect(item.configuration.range_start).toBe(0);expect(item.result?.configuration.range_start).toBe(.5);
    await calculateScenario(item,base,async()=>{throw new Error('求解失败');});expect(item.error).toBe('求解失败');expect(item.running).toBe(false);expect(item.result).toBeNull();expect(JSON.stringify(base)).toBe(original);
  });
});
