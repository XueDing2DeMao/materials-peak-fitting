import {afterEach, expect, it, vi} from 'vitest';
import {flushPromises, mount} from '@vue/test-utils';
import {defineComponent, h, ref} from 'vue';
import {useWorkbenchLayout} from './useWorkbenchLayout';
import WorkbenchSplitHandle from './components/WorkbenchSplitHandle.vue';
import MultiPeakWorkbench from './components/MultiPeakWorkbench.vue';
import XpsWorkbench from './components/XpsWorkbench.vue';
import ResultWorkspace from './components/ResultWorkspace.vue';
import CompactFitResults from './components/CompactFitResults.vue';
import resultWorkspaceSource from './components/ResultWorkspace.vue?raw';

vi.mock('plotly.js-dist-min',()=>({default:{register:vi.fn(),react:vi.fn((el:any)=>{el.on=vi.fn();el.removeAllListeners=vi.fn();return Promise.resolve();}),purge:vi.fn()}}));
const wrappers:Array<{unmount:()=>void}>=[];
afterEach(()=>{wrappers.splice(0).forEach(w=>w.unmount());vi.unstubAllGlobals();});

it('结果停靠下方，视口缩小时约束尺寸，扩大后恢复用户选择',async()=>{
 let resized:ResizeObserverCallback=()=>{};
 vi.stubGlobal('ResizeObserver',class {constructor(callback:ResizeObserverCallback){resized=callback;}observe(){}disconnect(){}});
 const host=defineComponent({setup(){return useWorkbenchLayout(ref(true));},template:'<div ref="grid" :style="layoutStyle" />'});
 const w=mount(host);wrappers.push(w);
 const resize=async(width:number,height=1000,viewportHeight=1080)=>{vi.stubGlobal('innerHeight',viewportHeight);resized([{target:w.element,contentRect:{width,height}}] as any,{} as ResizeObserver);await flushPromises();};
 await resize(1800);w.vm.setSize('settings',380);w.vm.setSize('results',480);await flushPromises();
 expect(w.vm.settingsWidth).toBe(380);expect(w.vm.resultHeight).toBe(480);
 await resize(700,600,768);expect(w.vm.settingsWidth+8+400).toBeLessThanOrEqual(700);expect(w.vm.resultHeight+406).toBeLessThanOrEqual(600);expect(w.vm.stacked).toBe(true);
 await resize(1800);expect(w.vm.settingsWidth).toBe(380);expect(w.vm.resultHeight).toBe(480);
 await resize(820);expect(w.vm.stacked).toBe(true);expect(w.vm.layoutStyle['--results-height']).toBe('480px');
 for(const [height,viewportHeight,chartMin] of [[698.5,900,440],[566.5,768,398]]){
  await resize(1440,height,viewportHeight);w.vm.setSize('results',999);await flushPromises();
  expect(height-w.vm.resultHeight-8).toBeGreaterThanOrEqual(chartMin);
  expect(w.vm.layoutStyle['--chart-min-height']).toBe(chartMin+'px');
 }
});

it('栏间边界支持鼠标与方向键调宽，并限制在可用范围内',async()=>{
 const w=mount(WorkbenchSplitHandle,{props:{label:'调整设置栏宽度',controls:'analysis-settings',side:'settings',value:260,min:232,max:400}});wrappers.push(w);
 await w.trigger('keydown',{key:'ArrowRight'});expect(w.emitted('resize')?.at(-1)).toEqual([284]);
 await w.trigger('pointerdown',{button:0,pointerId:1,clientX:260});await w.trigger('pointermove',{pointerId:1,clientX:800});expect(w.emitted('resize')?.at(-1)).toEqual([400]);
 await w.trigger('pointercancel',{pointerId:1});expect(w.emitted('resize')?.at(-1)).toEqual([260]);
 await w.setProps({side:'results',value:320,min:288,max:480});await w.trigger('keydown',{key:'ArrowLeft'});expect(w.emitted('resize')?.at(-1)).toEqual([344]);
});


it('结果区分隔线使用上下方向键和竖向拖动调整高度',async()=>{
 const w=mount(WorkbenchSplitHandle,{props:{label:'调整结果区高度',controls:'analysis-results',side:'results',orientation:'horizontal',value:220,min:180,max:480}});wrappers.push(w);
 expect(w.attributes('aria-orientation')).toBe('horizontal');
 await w.trigger('keydown',{key:'ArrowUp'});expect(w.emitted('resize')?.at(-1)).toEqual([244]);
 await w.trigger('pointerdown',{button:0,pointerId:1,clientY:600});
 await w.trigger('pointermove',{pointerId:1,clientY:500});expect(w.emitted('resize')?.at(-1)).toEqual([320]);
 await w.trigger('pointercancel',{pointerId:1});expect(w.emitted('resize')?.at(-1)).toEqual([220]);
});

it('结果视图标签组仅包含页签，收起操作独立于标签组',()=>{
 const w=mount(ResultWorkspace,{props:{workstation:true},slots:{tools:'<button>收起结果</button>'}});wrappers.push(w);
 const tablist=w.get('[role="tablist"]');
 expect(tablist.findAll('button').every(button=>button.attributes('role')==='tab')).toBe(true);
 expect(w.get('.result-view-tools button').element.closest('[role="tablist"]')).toBeNull();
});

it('未拟合时展开结果概览仍显示空状态提示',()=>{
 // Vitest 不注入组件样式；应用真实样式并展开 Vue deep 选择器，验证级联后的可见性。
 const style=document.createElement('style');
 style.textContent=(resultWorkspaceSource.match(/<style scoped>([\s\S]*?)<\/style>/)?.[1]??'').replace(/:deep\(([^)]+)\)/g,'$1');
 document.head.append(style);
 try{
  const w=mount(ResultWorkspace,{attachTo:document.body,props:{workstation:true},slots:{default:()=>h(CompactFitResults,{result:null,stale:false,busy:false,unit:'eV',prefix:'xps'})}});wrappers.push(w);
  const empty=w.get('.compact-fit-results>p.hint');
  expect(empty.text()).toBe('暂无拟合结果');
  expect(empty.isVisible()).toBe(true);
 }finally{style.remove();}
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
