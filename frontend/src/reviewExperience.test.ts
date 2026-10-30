import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mount,flushPromises} from '@vue/test-utils';
import MultiPeakWorkbench from './components/MultiPeakWorkbench.vue';
import XpsWorkbench from './components/XpsWorkbench.vue';
import MultiPeakControls from './components/MultiPeakControls.vue';
import XpsFitControls from './components/XpsFitControls.vue';
import ResultWorkspace from './components/ResultWorkspace.vue';
import PeakQuickSummary from './components/PeakQuickSummary.vue';
import FitReviewActions from './components/FitReviewActions.vue';
import PeakDiagnosticLinks from './components/PeakDiagnosticLinks.vue';
vi.mock('plotly.js-dist-min',()=>({default:{register:vi.fn(),react:vi.fn((el:any)=>{el.on=vi.fn();el.removeAllListeners=vi.fn();return Promise.resolve();}),purge:vi.fn()}}));
const wrappers:Array<{unmount:()=>void}>=[];
beforeEach(()=>{Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,writable:true,value:function(){this.setAttribute('open','');}});Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,writable:true,value:function(){this.removeAttribute('open');this.dispatchEvent(new Event('close'));}});});
afterEach(()=>{wrappers.splice(0).forEach(w=>w.unmount());vi.restoreAllMocks();});
for(const kind of ['multi','xps'] as const)it(kind+'：视图切换保留配置与图谱，诊断定位关闭结果并聚焦对应参数',async()=>{
 const w=mount(kind==='multi'?MultiPeakWorkbench:XpsWorkbench,{attachTo:document.body,props:{x:[0,1,2,3,4],y:[0,1,5,1,0],source:null,...(kind==='multi'?{mode:'general',unified:true}:{})}});wrappers.push(w);
 const controls=w.getComponent(kind==='multi'?MultiPeakControls:XpsFitControls);
 await w.get('[data-test="view-settings"]').trigger('click');await w.get('[data-test="'+kind+'-add"]').trigger('click');
 const before=JSON.stringify(controls.props('config'));const canvas=w.get('#analysis-plot').element;
 await w.get('[data-test="view-results"]').trigger('click');await w.get('[data-test="result-view-diagnostics"]').trigger('click');
 await w.get('[data-test="view-chart"]').trigger('click');await w.get('[data-test="view-results"]').trigger('click');
 expect(w.getComponent(ResultWorkspace).attributes('data-result-view')).toBe('diagnostics');
 const dialog=document.createElement('dialog');w.get('#analysis-results').element.append(dialog);dialog.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await flushPromises();dialog.remove();
 expect(w.classes()).toContain('results-open');
 expect(w.attributes('data-active-pane')).toBe('results');expect(w.classes()).toContain('results-open');
 // 通过现有结果组件发出定位事件，检查完整工作台如何显示目标。
 const result=w.findComponent({name:kind==='multi'?'ResultsPanel':'XpsResults'});
 result.vm.$emit('select','p1');await flushPromises();
 expect(w.attributes('data-active-pane')).toBe('results');expect(w.classes()).toContain('results-open');
 result.vm.$emit('locate','p1','xc');await flushPromises();
 expect(w.classes()).not.toContain('results-open');expect(w.attributes('data-active-pane')).toBe('settings');
 expect(document.activeElement?.getAttribute('aria-label')).toBe('p1 xc 初值');
 expect(JSON.stringify(controls.props('config'))).toBe(before);expect(w.get('#analysis-plot').element).toBe(canvas);
});
it('结构化残差趋势提供查看图谱与基线操作，过期结果禁止操作旧诊断',async()=>{
 const result:any={converged:true,parameters:{},statistics:{has_trend:true}};
 const w=mount(FitReviewActions,{props:{result}});wrappers.push(w);
 expect(w.text()).toContain('残差');await w.get('[data-test="review-baseline"]').trigger('click');expect(w.emitted('navigate')).toEqual([['baseline']]);
 await w.setProps({stale:true});expect(w.get('[data-test="review-baseline"]').attributes('disabled')).toBeDefined();expect(w.get('[data-test="review-chart"]').attributes('disabled')).toBeDefined();
});
it('参数诊断显示中文参数名与处理建议，不修改参数；过期时保留原警告',async()=>{
 const peaks:any=[{id:'p1',label:'主峰',parameters:{w:{value:2,standard_error:null,bound:true}},areaTotal:null,areaWindow:null,areaFraction:null}];
 const w=mount(PeakDiagnosticLinks,{props:{peaks}});wrappers.push(w);
 expect(w.text()).toContain('FWHM');expect(w.text()).toContain('检查上下限');await w.setProps({stale:true});
 expect(w.text()).toContain('边界');expect(w.get('button').attributes('disabled')).toBeDefined();
});

it('多峰结果建议可打开基线设置，并保留原配置',async()=>{
 const w=mount(MultiPeakWorkbench,{attachTo:document.body,props:{x:[0,1,2,3,4],y:[0,1,5,1,0],source:null,mode:'general',unified:true}});wrappers.push(w);
 await w.get('[data-test="multi-add"]').trigger('click');await w.get('[data-test="multi-add"]').trigger('click');
 const controls=w.getComponent(MultiPeakControls);const before=JSON.stringify(controls.props('config'));
 await w.get('[data-test="view-results"]').trigger('click');
 w.getComponent({name:'MultiPeakResults'}).vm.$emit('navigate','baseline');await flushPromises();
 expect(w.attributes('data-active-pane')).toBe('settings');expect(w.classes()).not.toContain('results-open');
 expect(w.get('[data-test="parameter-tab-baseline"]').attributes('aria-selected')).toBe('true');
 expect(JSON.stringify(controls.props('config'))).toBe(before);
});

it('计算期间或结果过期时，快捷峰定位不可用',async()=>{
 const peaks:any=[{id:'p1',label:'主峰',parameters:{},areaWindow:null}];const w=mount(PeakQuickSummary,{props:{peaks,unit:'eV',busy:true}});wrappers.push(w);
 expect(w.get('button').attributes('disabled')).toBeDefined();await w.get('button').trigger('click');expect(w.emitted('select')).toBeUndefined();
 await w.setProps({busy:false,stale:true});expect(w.get('button').attributes('disabled')).toBeDefined();
});
it('固定参数计算不显示调整优化初值的建议',()=>{
 const w=mount(FitReviewActions,{props:{result:{converged:false,parameters:{xc:{fixed:true}},statistics:{free_parameters:0}} as any}});wrappers.push(w);expect(w.find('[data-test="review-peaks"]').exists()).toBe(false);
});
