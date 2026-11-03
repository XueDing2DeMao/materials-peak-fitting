import {describe,expect,it,vi} from 'vitest';
import {flushPromises,mount} from '@vue/test-utils';
import {calculateScenario,type FitScenario} from './fitScenarios';
import {createMultiConfig} from './multipeakState';
import FitScenarioComparison from './components/FitScenarioComparison.vue';
import {createConfig} from './xpsState';
import {previewXps} from './xpsApi';
import type {XpsResult} from './xpsTypes';

vi.mock('plotly.js-dist-min',()=>({default:{register:vi.fn()}}));
vi.mock('./xpsApi',async original=>({...await original<typeof import('./xpsApi')>(),previewXps:vi.fn()}));
describe('独立方案快照',()=>{
  it('成功或失败都不改主配置，保存请求并保留失败原因',async()=>{
    const config=createMultiConfig([0,1,2],[1,3,1],null,'general'),base:any={engine:'multi',configuration:config,result:{},stale:false};
    const original=JSON.stringify(base),item:FitScenario={id:'a',name:'替代',configuration:structuredClone(config),result:null,error:'',origin:original,running:false};
    await calculateScenario(item,base,async(b,c)=>{c.range_start=.5;b.configuration.x[0]=99;return {...b,configuration:c};});
    expect(JSON.stringify(base)).toBe(original);expect(item.configuration.range_start).toBe(0);expect(item.result?.configuration.range_start).toBe(.5);
    await calculateScenario(item,base,async()=>{throw new Error('求解失败');});expect(item.error).toBe('求解失败');expect(item.running).toBe(false);expect(item.result).toBeNull();expect(JSON.stringify(base)).toBe(original);
  });
  it('独立 XPS 方案的空端点和零值分别传给预览，恢复原背景不更改主配置',async()=>{
    const config=createConfig([0,1,2],[4,6,5],null);
    config.background.kind='shirley';
    config.background.low_level=4;
    config.background.high_level=5;
    const initial=JSON.stringify(config);
    const w=mount(FitScenarioComparison,{props:{snapshot:{engine:'xps',configuration:config,result:{components:[]} as unknown as XpsResult,stale:false},currentKey:'sample',busy:false}});
    try{
      await w.get('.archive-action-row button').trigger('click');
      await w.get('.scenario-fields select').setValue('line');
      const [low,high]=w.findAll('.scenario-endpoints input');
      await high.setValue(5);
      vi.mocked(previewXps).mockRejectedValue(new Error('缺少端点'));
      const inspect=w.get('.scenario-settings .archive-action-row button');
      await inspect.trigger('click');await flushPromises();
      expect(vi.mocked(previewXps).mock.calls.at(-1)?.[0].background.low_level).toBeNull();
      await low.setValue(0);await inspect.trigger('click');await flushPromises();
      expect(vi.mocked(previewXps).mock.calls.at(-1)?.[0].background).toMatchObject({kind:'line',low_level:0,high_level:5});
      await low.setValue('');await inspect.trigger('click');await flushPromises();
      expect(vi.mocked(previewXps).mock.calls.at(-1)?.[0].background.low_level).toBeNull();
      await w.get('.scenario-fields select').setValue('shirley');
      expect((low.element as HTMLInputElement).value).toBe('4');
      expect(JSON.stringify(config)).toBe(initial);
    }finally{w.unmount();vi.mocked(previewXps).mockReset();}
  });
});
