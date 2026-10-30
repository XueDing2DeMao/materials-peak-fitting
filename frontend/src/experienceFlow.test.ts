import {afterEach,expect,it,vi} from 'vitest';
import {mount,flushPromises} from '@vue/test-utils';
import {ref} from 'vue';
import SessionActions from './components/SessionActions.vue';
import {usePeakRemovalUndo} from './usePeakRemovalUndo';
import MultiPeakWorkbench from './components/MultiPeakWorkbench.vue';
import MultiPeakControls from './components/MultiPeakControls.vue';
import XpsWorkbench from './components/XpsWorkbench.vue';
import XpsFitControls from './components/XpsFitControls.vue';
vi.mock('plotly.js-dist-min',()=>({default:{register:vi.fn(),react:vi.fn((el:any)=>{el.on=vi.fn();el.removeAllListeners=vi.fn();return Promise.resolve();}),purge:vi.fn()}}));
const wrappers:Array<{unmount:()=>void}>=[];
afterEach(()=>wrappers.splice(0).forEach(w=>w.unmount()));
it('撤销恢复峰参数与组；后续编辑后不得覆盖新工作',()=>{
 const state=ref({components:[{id:'p1',enabled:false,parameters:{xc:{value:2,fixed:true}}}],constraints:[],groups:[{id:'g1',component_ids:['p1']}]});
 const undo=usePeakRemovalUndo(()=>state.value,(c,id)=>{c.components=c.components.filter(p=>p.id!==id);c.groups=[];});
 const before=JSON.stringify(state.value);undo.remove('p1');expect(undo.canUndo.value).toBe(true);undo.undo();expect(JSON.stringify(state.value)).toBe(before);
 undo.remove('p1');state.value.components.push({id:'p2',enabled:true,parameters:{xc:{value:3,fixed:false}}});expect(undo.canUndo.value).toBe(false);undo.undo();expect(state.value.components[0].id).toBe('p2');
});
for(const kind of ['multi','xps'] as const)it(`${kind}：定位峰设置，列表删除可撤销，换数据清除撤销`,async()=>{
 const w=mount(kind==='multi'?MultiPeakWorkbench:XpsWorkbench,{props:{x:[0,1,2,3,4],y:[0,1,5,1,0],source:null,...(kind==='multi'?{mode:'general',unified:true}:{})},attachTo:document.body});wrappers.push(w);
 await w.get('[data-test="next-fit-step"]').trigger('click');
 expect(w.get('[data-test="parameter-tab-peaks"]').attributes('aria-selected')).toBe('true');
 await w.get(`[data-test="${kind==='multi'?'multi-add':'xps-add'}"]`).trigger('click');
 const c=w.getComponent(kind==='multi'?MultiPeakControls:XpsFitControls).props('config');const before=JSON.stringify(c.components);
 await w.findAll('button').find(b=>b.text()==='删除 p1')!.trigger('click');expect(c.components).toHaveLength(0);
 await w.get('[data-test="undo-delete-peak"]').trigger('click');expect(JSON.stringify(c.components)).toBe(before);
 await w.findAll('button').find(b=>b.text()==='删除 p1')!.trigger('click');await flushPromises();await w.setProps({y:[0,2,6,2,0]});expect(w.find('[data-test="undo-delete-peak"]').exists()).toBe(false);
});

it('保存前说明当前工作区范围，不读取或保存其他工作区',()=>{
 const capture=vi.fn();const w=mount(SessionActions,{props:{capture,restore:vi.fn(),busy:false,scopeLabel:'XRD · 单谱分析'}});wrappers.push(w);
 expect(w.text()).toContain('XRD · 单谱分析');expect(w.text()).toContain('其他工作区不包含在此文件中');expect(w.text()).toContain('保存分析进度');expect(capture).not.toHaveBeenCalled();
});
