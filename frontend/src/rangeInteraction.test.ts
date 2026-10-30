import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import MultiPeakChart from './components/MultiPeakChart.vue';
import XpsChart from './components/XpsChart.vue';
vi.mock('plotly.js-dist-min',()=>({default:{register:vi.fn(),purge:vi.fn(),downloadImage:vi.fn(),react:vi.fn((node:any,_traces:any,layout:any)=>{
  node._fullLayout={xaxis:{_offset:50,_length:500,range:layout.xaxis.autorange==='reversed'?[10,0]:[0,10]},yaxis:{_offset:40,_length:300}};
  node.events??={};node.on=(name:string,fn:unknown)=>node.events[name]=fn;node.removeAllListeners=(name:string)=>delete node.events[name];return Promise.resolve();
})}}));
const mounted:Array<{unmount:()=>void}>=[];
afterEach(()=>mounted.splice(0).forEach(w=>w.unmount()));
function pointer(target:EventTarget,type:string,clientX:number){target.dispatchEvent(new MouseEvent(type,{clientX,bubbles:true,cancelable:true}));}
describe.each(['multi','xps'] as const)('%s 复用单峰范围交互',kind=>{
  function chart(readOnly=false){const w=mount(kind==='multi'?MultiPeakChart:XpsChart,{props:{x:[0,2,4,6,8,10],y:[0,1,3,2,1,0],start:2,end:8,mode:'general',shift:0,preview:null,result:null,readOnly}});mounted.push(w);return w;}
  it('默认平移，框选按数据点更新并自动退出，双击恢复手柄',async()=>{
    const w=chart();await flushPromises();const node=w.get(`[data-test="${kind==='multi'?'multi':'xps'}-plot"]`).element as any;
    expect(w.get('[data-test="range-selection-toggle"]').attributes('aria-pressed')).toBe('false');
    await w.get('.compact-chart-tools-toggle').trigger('click');
    await w.get('[data-test="range-selection-toggle"]').trigger('click');await flushPromises();
    expect(w.find('.chart-canvas [data-test="range-selection-guide"]').exists()).toBe(false);
    expect(w.get('.chart-mode-status [data-test="range-selection-guide"]').text()).toContain('水平拖动');
    expect(w.get('.compact-chart-tools-toggle').attributes('aria-expanded')).toBe('false');
    node.events.plotly_selected({points:[{x:6},{x:2},{x:4}]});await flushPromises();
    expect(w.emitted('range')?.at(-1)).toEqual([{start:2,end:6}]);
    expect(w.get('[data-test="range-selection-toggle"]').attributes('aria-pressed')).toBe('false');
    await w.get(`[data-test="${kind==='multi'?'multi':'xps'}-plot"]`).trigger('dblclick');await flushPromises();
    expect(w.find('[data-test="range-start-handle"]').exists()).toBe(true);
  });
  it('边界拖动保持起终点语义，整体平移限于数据范围，Esc收起手柄',async()=>{
    const w=chart();await w.get('[data-test="spectrum-full"]').trigger('click');await w.get('[data-test="range-edit-toggle"]').trigger('click');await flushPromises();
    const reverse=kind==='xps';
    pointer(w.get('[data-test="range-start-handle"]').element,'pointerdown',reverse?450:150);
    pointer(window,'pointermove',reverse?400:200);pointer(window,'pointerup',reverse?400:200);
    expect(w.emitted('range')?.at(-1)).toEqual([{start:3,end:8}]);await flushPromises();
    pointer(w.get('[data-test="range-window-handle"]').element,'pointerdown',300);
    pointer(window,'pointermove',reverse?50:550);pointer(window,'pointerup',reverse?50:550);
    expect(w.emitted('range')?.at(-1)).toEqual([{start:5,end:10}]);
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));await flushPromises();
    expect(w.find('[data-test="range-manipulator"]').exists()).toBe(false);
  });
  it('选峰与范围编辑互斥，端点点击通知父级聚焦',async()=>{
    const w=chart();await w.get('[data-test="range-edit-toggle"]').trigger('click');await flushPromises();
    await w.get('[data-test="chart-add-peak"]').trigger('click');await flushPromises();
    expect(w.find('[data-test="range-manipulator"]').exists()).toBe(false);
    await w.get('[data-test="range-selection-toggle"]').trigger('click');await flushPromises();
    expect(w.get('[data-test="chart-add-peak"]').attributes('aria-pressed')).toBe('false');
    const node=w.get(`[data-test="${kind==='multi'?'multi':'xps'}-plot"]`).element as any;
    node.events.plotly_deselect();await flushPromises();
    node.events.plotly_click({points:[{data:{name:'分析区间端点'},customdata:'end'}]});
    expect(w.emitted('range-endpoint-focus')?.at(-1)).toEqual(['end']);
  });
  it('批量只读预览不出现范围编辑或选峰控件',async()=>{
    const w=chart(true);await flushPromises();
    expect(w.find('[data-test="range-edit-toggle"]').exists()).toBe(false);
    const plot=w.get(`[data-test="${kind==='multi'?'multi':'xps'}-plot"]`);await plot.trigger('dblclick');await flushPromises();
    expect(w.find('[data-test="range-manipulator"]').exists()).toBe(false);
  });
  it('缩放后遮罩限制在绘图区，视口外边界不覆盖旁边控件',async()=>{
    const w=chart();await w.get('[data-test="range-edit-toggle"]').trigger('click');await flushPromises();
    const node=w.get(`[data-test="${kind==='multi'?'multi':'xps'}-plot"]`).element as any;
    node._fullLayout.xaxis.range=kind==='xps'?[6,4]:[4,6];node.events.plotly_relayout({});await flushPromises();
    expect(w.get('[data-test="range-manipulator"]').attributes('style')).toContain('left: 50px');
    expect(w.get('[data-test="range-manipulator"]').attributes('style')).toContain('width: 500px');
    expect(w.find('[data-test="range-start-handle"]').exists()).toBe(false);
    expect(w.find('[data-test="range-end-handle"]').exists()).toBe(false);
    node._fullLayout.xaxis.range=[11,12];node.events.plotly_relayout({});await flushPromises();
    expect(w.find('[data-test="range-manipulator"]').exists()).toBe(false);
  });
  it('指针取消后不提交半途拖动的区间',async()=>{
    const w=chart();await w.get('[data-test="range-edit-toggle"]').trigger('click');await flushPromises();
    pointer(w.get('[data-test="range-start-handle"]').element,'pointerdown',150);
    pointer(window,'pointermove',250);pointer(window,'pointercancel',250);pointer(window,'pointerup',250);
    expect(w.emitted('range')).toBeUndefined();
  });
});
