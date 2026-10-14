import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import App from './App.vue';
import { createMultiConfig } from './multipeakState';

vi.mock('plotly.js-dist-min',()=>({default:{purge:vi.fn(),react:vi.fn()}}));
const Single=defineComponent({props:['mode'],emits:['template'],setup(){return {draft:ref('')};},template:'<div><input aria-label="单谱草稿" v-model="draft" /></div>'});
const Batch=defineComponent({props:['template','analysisMode'],emits:['single','activity'],setup(){return {draft:ref('')};},template:'<section><input aria-label="批量草稿" v-model="draft" /><button @click="$emit(\'single\')">从单谱建立模板</button></section>'});
const wrappers:ReturnType<typeof mount>[]=[];
afterEach(()=>wrappers.splice(0).forEach(w=>w.unmount()));
function app(){const w=mount(App,{attachTo:document.body,global:{stubs:{DatasetSummary:{props:['dataset'],template:'<div />'},MultiPeakWorkbench:Single,XpsWorkbench:Single,BatchWorkbench:Batch}}});wrappers.push(w);return w;}
describe('分析类型与处理方式',()=>{
  it('三种分析类型与单谱/批量独立，切换时保留各类型草稿',async()=>{
    const w=app();
    expect(w.get('[data-test="analysis-mode"]').findAll('option').map(x=>x.text())).toEqual(['通用谱线','XRD 峰拟合','XPS 峰拟合']);
    await w.get('input[aria-label="单谱草稿"]').setValue('通用峰参数');
    await w.get('[data-test="processing-batch"]').trigger('click');
    let batch=w.findAllComponents(Batch).find(b=>b.isVisible())!;
    await batch.get('input').setValue('通用批次');
    await w.get('[data-test="analysis-mode"]').setValue('xrd');
    batch=w.findAllComponents(Batch).find(b=>b.isVisible())!;
    expect(batch.props('analysisMode')).toBe('xrd');expect((batch.get('input').element as HTMLInputElement).value).toBe('');
    await w.get('[data-test="analysis-mode"]').setValue('single');
    batch=w.findAllComponents(Batch).find(b=>b.isVisible())!;
    expect((batch.get('input').element as HTMLInputElement).value).toBe('通用批次');
    await batch.get('button').trigger('click');
    expect((w.get('input[aria-label="单谱草稿"]').element as HTMLInputElement).value).toBe('通用峰参数');
  });
  it('发送模板进入对应分析类型的批量页面，运行期间不能切换分析类型',async()=>{
    const w=app();await w.get('[data-test="analysis-mode"]').setValue('xrd');
    const c=createMultiConfig([1,2,3,4],[0,1,2,0],null,'xrd');
    w.findComponent(Single).vm.$emit('template',c);await flushPromises();
    const batch=w.findAllComponents(Batch).find(b=>b.isVisible())!;
    expect(batch.props('template')).toEqual(c);expect(batch.props('analysisMode')).toBe('xrd');
    expect(w.get('[data-test="processing-batch"]').attributes('aria-pressed')).toBe('true');
    batch.vm.$emit('activity',true);await flushPromises();
    expect((w.get('[data-test="analysis-mode"]').element as HTMLSelectElement).disabled).toBe(true);
    batch.vm.$emit('activity',false);await flushPromises();
    expect((w.get('[data-test="analysis-mode"]').element as HTMLSelectElement).disabled).toBe(false);
  });
});
