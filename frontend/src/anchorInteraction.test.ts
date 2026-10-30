import {afterEach,describe,expect,it,vi} from 'vitest';
import {flushPromises,mount} from '@vue/test-utils';
import MultiPeakChart from './components/MultiPeakChart.vue';
vi.mock('plotly.js-dist-min',()=>({default:{register:vi.fn(),purge:vi.fn(),react:vi.fn((node:any)=>{
  node._fullLayout={xaxis:{_offset:50,_length:500,range:[0,10]},yaxis:{_offset:40,_length:300,range:[0,100]}};
  node.events??={};node.on=(name:string,fn:unknown)=>node.events[name]=fn;node.removeAllListeners=(name:string)=>delete node.events[name];return Promise.resolve();
})}}));
const mounted:Array<{unmount:()=>void}>=[];
afterEach(()=>mounted.splice(0).forEach(w=>w.unmount()));
async function chart(readOnly=false){const w=mount(MultiPeakChart,{props:{x:[0,2,4,6,8,10],y:[0,20,100,60,20,0],start:2,end:8,mode:'general',preview:null,result:null,anchors:[{x:2,y:20},{x:8,y:80}],canAddAnchors:true,readOnly}});mounted.push(w);await flushPromises();return w;}
function pointer(target:EventTarget,type:string,x:number,y:number){target.dispatchEvent(new MouseEvent(type,{button:0,clientX:x,clientY:y,bubbles:true,cancelable:true}));}
describe('图上锚点快捷编辑',()=>{
  it('浏览时点击锚点只打开精确编辑，不重复添加',async()=>{
    const w=await chart(),node=w.get('[data-test="multi-plot"]').element as any;
    node.events.plotly_click({points:[{data:{name:'基线锚点'},pointNumber:1,x:8,y:80}]});
    expect(w.emitted('edit-anchor')).toEqual([[1]]);expect(w.emitted('anchor')).toBeUndefined();
  });
  it('拖动只在松开时提交，手柄使用当前轴坐标并限制在区间内',async()=>{
    const w=await chart();await w.get('[data-test="chart-edit-anchors"]').trigger('click');await flushPromises();
    const handle=w.get('[data-test="anchor-handle-0"]');expect(handle.attributes('style')).toContain('left: 150px');
    pointer(handle.element,'pointerdown',150,280);pointer(window,'pointermove',200,250);await flushPromises();
    expect(w.emitted('move-anchor')).toBeUndefined();expect(w.get('[data-test="anchor-handle-0"]').attributes('style')).toContain('left: 200px');
    pointer(window,'pointerup',200,250);expect(w.emitted('move-anchor')).toEqual([[0,{x:3,y:30}]]);
    pointer(handle.element,'pointerdown',150,280);pointer(window,'pointermove',950,-500);pointer(window,'pointerup',950,-500);
    expect(w.emitted('move-anchor')?.at(-1)).toEqual([0,{x:8,y:100}]);expect(w.emitted('edit-anchor')).toBeUndefined();
  });
  it('单击和键盘打开对应锚点，Esc、取消与换数据均不提交拖动',async()=>{
    const w=await chart();await w.get('[data-test="chart-edit-anchors"]').trigger('click');await flushPromises();const handle=w.get('[data-test="anchor-handle-0"]');
    pointer(handle.element,'pointerdown',150,280);pointer(window,'pointerup',150,280);expect(w.emitted('edit-anchor')).toEqual([[0]]);
    handle.element.dispatchEvent(new MouseEvent('click',{detail:0,bubbles:true}));expect(w.emitted('edit-anchor')).toHaveLength(2);
    for(const end of ['escape','pointercancel','data']){
      pointer(handle.element,'pointerdown',150,280);pointer(window,'pointermove',250,200);
      if(end==='escape')window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));
      else if(end==='data')await w.setProps({anchors:[{x:3,y:30}]});
      else pointer(window,'pointercancel',250,200);
      pointer(window,'pointerup',250,200);
    }
    expect(w.emitted('move-anchor')).toBeUndefined();expect(w.emitted('edit-anchor')).toHaveLength(2);
  });
  it('区间和选峰模式互斥，只读和禁用时没有锚点修改入口',async()=>{
    const w=await chart();await w.get('[data-test="chart-edit-anchors"]').trigger('click');await flushPromises();
    await w.get('[data-test="range-edit-toggle"]').trigger('click');await flushPromises();expect(w.find('[data-test="anchor-handle-0"]').exists()).toBe(false);
    await w.get('[data-test="chart-edit-anchors"]').trigger('click');await flushPromises();expect(w.find('[data-test="range-manipulator"]').exists()).toBe(false);
    await w.get('[data-test="chart-add-peak"]').trigger('click');expect(w.get('[data-test="chart-edit-anchors"]').attributes('aria-pressed')).toBe('false');
    await w.setProps({canAddAnchors:false});expect(w.find('[data-test="chart-edit-anchors"]').exists()).toBe(false);
    const readonly=await chart(true),node=readonly.get('[data-test="multi-plot"]').element as any;
    node.events.plotly_click({points:[{data:{name:'基线锚点'},pointNumber:0,x:2,y:20}]});expect(readonly.emitted('edit-anchor')).toBeUndefined();
  });
});
