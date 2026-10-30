import {afterEach, expect, it, vi} from 'vitest';
import {flushPromises, mount} from '@vue/test-utils';
import {defineComponent, ref} from 'vue';
import {useWorkbenchLayout} from './useWorkbenchLayout';
import WorkbenchSplitHandle from './components/WorkbenchSplitHandle.vue';
import MultiPeakWorkbench from './components/MultiPeakWorkbench.vue';
import XpsWorkbench from './components/XpsWorkbench.vue';
import ResultWorkspace from './components/ResultWorkspace.vue';

vi.mock('plotly.js-dist-min',()=>({default:{register:vi.fn(),react:vi.fn((el:any)=>{el.on=vi.fn();el.removeAllListeners=vi.fn();return Promise.resolve();}),purge:vi.fn()}}));
const wrappers:Array<{unmount:()=>void}>=[];
afterEach(()=>{wrappers.splice(0).forEach(w=>w.unmount());vi.unstubAllGlobals();});

it('有效宽度缩小时保留图谱空间，扩大后恢复用户选择的栏宽',async()=>{
 let resized:ResizeObserverCallback=()=>{};
 vi.stubGlobal('ResizeObserver',class {constructor(callback:ResizeObserverCallback){resized=callback;}observe(){}disconnect(){}});
 const host=defineComponent({setup(){return useWorkbenchLayout(ref(true));},template:'<div ref="grid" :style="layoutStyle" />'});
 const w=mount(host);wrappers.push(w);
 const resize=async(width:number)=>{resized([{target:w.element,contentRect:{width}}] as any,{} as ResizeObserver);await flushPromises();};
 await resize(1800);w.vm.setWidth('settings',380);w.vm.setWidth('results',480);await flushPromises();
 expect(w.vm.settingsWidth).toBe(380);expect(w.vm.resultWidth).toBe(480);
 await resize(887);expect(w.vm.settingsWidth+w.vm.resultWidth+16+320).toBeLessThanOrEqual(887);expect(w.vm.stacked).toBe(false);
 await resize(1800);expect(w.vm.settingsWidth).toBe(380);expect(w.vm.resultWidth).toBe(480);
 await resize(820);expect(w.vm.stacked).toBe(true);
});

it('栏间边界支持鼠标与方向键调宽，并限制在可用范围内',async()=>{
 const w=mount(WorkbenchSplitHandle,{props:{label:'调整设置栏宽度',controls:'analysis-settings',side:'settings',value:260,min:232,max:400}});wrappers.push(w);
 await w.trigger('keydown',{key:'ArrowRight'});expect(w.emitted('resize')?.at(-1)).toEqual([284]);
 await w.trigger('pointerdown',{button:0,pointerId:1,clientX:260});await w.trigger('pointermove',{pointerId:1,clientX:800});expect(w.emitted('resize')?.at(-1)).toEqual([400]);
 await w.trigger('pointercancel',{pointerId:1});expect(w.emitted('resize')?.at(-1)).toEqual([260]);
 await w.setProps({side:'results',value:320,min:288,max:480});await w.trigger('keydown',{key:'ArrowLeft'});expect(w.emitted('resize')?.at(-1)).toEqual([344]);
});

for(const kind of ['multi','xps'] as const)it(kind+'：放大图谱及恢复不卸载图表、不丢结果页签与配置',async()=>{
 const w=mount(kind==='multi'?MultiPeakWorkbench:XpsWorkbench,{attachTo:document.body,props:{x:[1,2,3],y:[1,3,1],source:null,...(kind==='multi'?{mode:'general',unified:true}:{})}});wrappers.push(w);
 const plot=w.get('#analysis-plot').element;
 await w.get('[data-test="toggle-results"]').trigger('click');await w.get('[data-test="result-view-diagnostics"]').trigger('click');
 const before=JSON.stringify((w.vm as any).sessionState());
 await w.get('[data-test="expand-chart"]').trigger('click');expect(w.classes()).toContain('chart-expanded');
 await w.get('#analysis-plot').trigger('keydown',{key:'Escape'});expect(w.classes()).not.toContain('chart-expanded');
 expect(w.classes()).toContain('results-open');expect(w.getComponent(ResultWorkspace).attributes('data-result-view')).toBe('diagnostics');
 expect(w.get('#analysis-plot').element).toBe(plot);expect(JSON.stringify((w.vm as any).sessionState())).toBe(before);
 await w.get('[data-test="expand-chart"]').trigger('click');await w.get('[data-test="toggle-results"]').trigger('click');expect(w.classes()).not.toContain('chart-expanded');expect(w.classes()).toContain('results-open');
});
