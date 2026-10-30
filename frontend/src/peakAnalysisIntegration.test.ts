import {afterEach,describe,expect,it,vi} from 'vitest';
import {defineComponent,ref} from 'vue';
import {flushPromises,mount} from '@vue/test-utils';
import App from './App.vue';

vi.mock('plotly.js-dist-min',()=>({default:{purge:vi.fn(),react:vi.fn()}}));
const Single=defineComponent({
  props:['mode'],setup(_, {expose}){
    const draft=ref('');
    expose({sessionState:()=>({kind:'single',configuration:{},result:null}),materialResultHint:()=>draft.value==='已拟合'?'':draft.value==='已修改'?'参数已修改，请重新拟合后再计算材料参数。':'请先完成拟合，再计算材料参数。',isBusy:()=>false});
    return {draft};
  },template:'<input aria-label="保留的原谱设置" v-model="draft" />',
});
const Parsed=defineComponent({props:['initialAnalysis'],emits:['work','activity'],setup(){return {draft:ref('')};},template:'<section><input aria-label="保留的解析设置" v-model="draft" /><button @click="$emit(\'work\',true)">有解析工作</button></section>'});
const wrappers:ReturnType<typeof mount>[]=[];
afterEach(()=>{wrappers.splice(0).forEach(w=>w.unmount());vi.restoreAllMocks();});
function app(){
  const w=mount(App,{attachTo:document.body,global:{stubs:{DatasetSummary:{props:['dataset'],template:'<div />'},MultiPeakWorkbench:Single,XpsWorkbench:Single,BatchWorkbench:true,SessionActions:true,PeakResultImportWorkbench:Parsed}}});
  wrappers.push(w);return w;
}
describe('结果解析入口与原谱拟合隔离',()=>{
  it('默认仍进入原谱拟合，切换输入方式保留双方草稿',async()=>{
    const w=app();
    expect(w.get('[data-test="input-mode"]').element).toHaveProperty('value','raw');
    await w.get('input[aria-label="保留的原谱设置"]').setValue('峰与背景设置');
    await w.get('[data-test="input-mode"]').setValue('results');
    expect(w.getComponent(Parsed).isVisible()).toBe(true);
    await w.get('input[aria-label="保留的解析设置"]').setValue('外部字段映射');
    await w.get('[data-test="input-mode"]').setValue('raw');
    expect(w.get('input[aria-label="保留的原谱设置"]').element).toHaveProperty('value','峰与背景设置');
    await w.get('[data-test="input-mode"]').setValue('results');
    expect(w.get('input[aria-label="保留的解析设置"]').element).toHaveProperty('value','外部字段映射');
  });
  it('没有当前拟合结果时给出说明，不产生伪造峰记录或切换工作区',async()=>{
    const w=app();
    await w.get('[data-test="derive-current-results"]').trigger('click');await flushPromises();
    expect(w.get('[data-test="derive-current-results"]').attributes('disabled')).toBeDefined();
    expect(w.text()).toContain('请先完成拟合');
    expect(w.get('[data-test="input-mode"]').element).toHaveProperty('value','raw');
    expect(w.findComponent(Parsed).exists()).toBe(false);
  });
  it('存在解析工作时关闭提醒有效，解析运行中禁止切换入口',async()=>{
    const w=app();await w.get('[data-test="input-mode"]').setValue('results');
    w.getComponent(Parsed).vm.$emit('work',true);await flushPromises();
    const unload=new Event('beforeunload',{cancelable:true});window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    w.getComponent(Parsed).vm.$emit('activity',true);await flushPromises();
    expect(w.get('[data-test="input-mode"]').attributes('disabled')).toBeDefined();
  });
});

it('材料参数入口响应子工作区结果变化，切换分析类型不串用结果',async()=>{
 const w=app();const entry=()=>w.get('[data-test="derive-current-results"]');
 await w.get('input[aria-label="保留的原谱设置"]').setValue('已拟合');expect(entry().attributes('disabled')).toBeUndefined();
 await w.get('input[aria-label="保留的原谱设置"]').setValue('已修改');expect(entry().attributes('disabled')).toBeDefined();expect(w.text()).toContain('参数已修改');
 await w.get('input[aria-label="保留的原谱设置"]').setValue('已拟合');await w.get('[data-test="analysis-mode"]').setValue('xps');expect(entry().attributes('disabled')).toBeDefined();
 await w.get('[data-test="analysis-mode"]').setValue('single');expect(entry().attributes('disabled')).toBeUndefined();
});
