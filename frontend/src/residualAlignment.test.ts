import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import Plotly from 'plotly.js-dist-min';
import MultiPeakChart from './components/MultiPeakChart.vue';
import XpsChart from './components/XpsChart.vue';

vi.mock('plotly.js-dist-min', () => {
  function extent(node: any) {
    const x = node.traces.flatMap((trace: any) => trace.x ?? []);
    const range=[Math.min(...x) - .1, Math.max(...x) + .1];
    return node.layout?.xaxis.autorange==='reversed'?range.reverse():range;
  }
  return { default: {
    purge: vi.fn(), downloadImage: vi.fn(),
    react: vi.fn(async (node: any, traces: any[], layout: any) => {
      const previous = node.layout;
      node.traces = traces;
      node.layout = layout;
      const range = layout.xaxis.range ?? (previous?.uirevision === layout.uirevision && node.zoomed
        ? node._fullLayout.xaxis.range : extent(node));
      node.layout = layout;
      node._fullLayout = { xaxis: { range, _offset: layout.margin.l, _length: 500 }, yaxis: { _offset: 40, _length: 200 } };
      node.events ??= {};
      node.on = (name: string, fn: unknown) => node.events[name] = fn;
      node.removeAllListeners = (name: string) => delete node.events[name];
    }),
    relayout: vi.fn(async (node: any, update: any) => {
      if (update['xaxis.autorange']) { node._fullLayout.xaxis.range = extent(node); node.zoomed = false; }
      else if (update['xaxis.range']) { node._fullLayout.xaxis.range = [...update['xaxis.range']]; node.zoomed = true; }
      node.events.plotly_relayout?.(update);
    }),
  } };
});
it('XPS 倒序主图与残差共享视口，双向缩放和重置仍保持倒序',async()=>{
  const w=mount(XpsChart,{props:{x:[2,3,4,5,6],y:[1,10,1,20,1],shift:0,start:2,end:3,preview:null,
    result:{x:[2,3],total_y:[1,9],residuals:[0,1],components:[]} as any}});
  wrappers.push(w);await flushPromises();
  const main=w.get('[data-test="xps-plot"]').element as any,residual=w.get('[data-test="xps-residual"]').element as any;
  expect(residual._fullLayout.xaxis.range).toEqual(main._fullLayout.xaxis.range);
  const fullRange=[...main._fullLayout.xaxis.range];
  expect(fullRange[0]).toBeGreaterThan(fullRange[1]);
  await Plotly.relayout(main,{'xaxis.range':[5,3]});await flushPromises();
  expect(residual._fullLayout.xaxis.range).toEqual([5,3]);
  await Plotly.relayout(residual,{'xaxis.range':[4,2.5]});await flushPromises();
  expect(main._fullLayout.xaxis.range).toEqual([4,2.5]);
  await w.setProps({selectedPeak:'p1'});await flushPromises();
  expect(residual._fullLayout.xaxis.range).toEqual([4,2.5]);
  await Plotly.relayout(residual,{'xaxis.autorange':true});await flushPromises();
  expect(main._fullLayout.xaxis.range).toEqual(fullRange);
  expect(residual._fullLayout.xaxis.range).toEqual(fullRange);
});
const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => { wrappers.splice(0).forEach(w => w.unmount()); vi.clearAllMocks(); });
async function chart(mode: 'general' | 'xrd') {
  const w = mount(MultiPeakChart, { props: {
    x: [2, 3, 4, 5, 6], y: [1, 10, 1, 20, 1], mode, start: 2, end: 3,
    preview: null, result: { x: [2, 3], total_y: [1, 9], residuals: [0, 1], components: [] },
  } });
  wrappers.push(w); await flushPromises();
  return { w, main: w.get('[data-test="multi-plot"]').element as any, residual: w.get('[data-test="multi-residual"]').element as any };
}
describe.each(['general', 'xrd'] as const)('%s 残差与拟合图对齐', mode => {
  it('局部拟合的残差保留原始 X 坐标，两图可视范围和左右边距相同', async () => {
    const { main, residual } = await chart(mode);
    expect(residual._fullLayout.xaxis.range).toEqual(main._fullLayout.xaxis.range);
    expect(residual.layout.margin.l).toBe(main.layout.margin.l);
    expect(residual.layout.margin.r).toBe(main.layout.margin.r);
    expect(residual.traces[0].x).toEqual([2, 3]);
  });
  it('两图双向同步缩放和平移，Y轴操作不改变另一图，重绘保留视口', async () => {
    const { w, main, residual } = await chart(mode);
    main._fullLayout.xaxis.range = [2.4, 3.2]; main.zoomed = true;
    main.events.plotly_relayout({ 'xaxis.range[0]': 2.4, 'xaxis.range[1]': 3.2 });
    await flushPromises(); expect(residual._fullLayout.xaxis.range).toEqual([2.4, 3.2]);
    residual._fullLayout.xaxis.range = [2.6, 3.4];
    residual.events.plotly_relayout({ 'xaxis.range': [2.6, 3.4] });
    await flushPromises(); expect(main._fullLayout.xaxis.range).toEqual([2.6, 3.4]);
    vi.mocked(Plotly.relayout).mockClear();
    residual.events.plotly_relayout({ 'yaxis.range': [-10, 10] });
    await flushPromises(); expect(Plotly.relayout).not.toHaveBeenCalled();
    await w.setProps({ start: 2.5 }); await flushPromises();
    expect(residual._fullLayout.xaxis.range).toEqual([2.6, 3.4]);
    expect(main._fullLayout.xaxis.range).toEqual([2.6, 3.4]);
  });
  it('从任一图自动缩放都恢复完整主图范围，不只放大残差区间', async () => {
    const { main, residual } = await chart(mode);
    const fullRange = [...main._fullLayout.xaxis.range];
    await Plotly.relayout(residual, { 'xaxis.range': [2.4, 3.2] }); await flushPromises();
    await Plotly.relayout(residual, { 'xaxis.autorange': true }); await flushPromises();
    expect(main._fullLayout.xaxis.range).toEqual(fullRange);
    expect(residual._fullLayout.xaxis.range).toEqual(fullRange);
    await Plotly.relayout(main, { 'xaxis.range': [2.5, 3] }); await flushPromises();
    await Plotly.relayout(main, { 'xaxis.autorange': true }); await flushPromises();
    expect(residual._fullLayout.xaxis.range).toEqual(fullRange);
    expect(vi.mocked(Plotly.relayout).mock.calls.length).toBeLessThan(15);
  });
});

it('XPS 校准清除旧缩放缓存，按新的结合能区间倒序显示',async()=>{
  const w=mount(XpsChart,{props:{x:[2,3,4,5,6],y:[1,10,1,20,1],shift:0,start:2,end:3,preview:null,result:null}});wrappers.push(w);await flushPromises();
  const main=w.get('[data-test="xps-plot"]').element as any;
  await Plotly.relayout(main,{'xaxis.range':[2.8,2.2]});await flushPromises();
  await w.setProps({shift:10,start:12,end:13});await flushPromises();
  expect(main._fullLayout.xaxis.range).toEqual([13,12]);
  expect(w.emitted('range')).toBeUndefined();
});
it('仅高度变化也重绘主图与残差，卸载后断开尺寸监听',async()=>{
  let callback:ResizeObserverCallback=()=>{};
  const disconnect=vi.fn(),observe=vi.fn();
  vi.stubGlobal('ResizeObserver',class {constructor(fn:ResizeObserverCallback){callback=fn;}observe=observe;disconnect=disconnect;});
  try{
    const {w,main}=await chart('general');vi.mocked(Plotly.react).mockClear();
    callback([{target:main,contentRect:{width:700,height:300}}] as any,{} as ResizeObserver);await flushPromises();
    const first=vi.mocked(Plotly.react).mock.calls.length;
    callback([{target:main,contentRect:{width:700,height:250}}] as any,{} as ResizeObserver);await flushPromises();
    expect(vi.mocked(Plotly.react).mock.calls.length).toBeGreaterThan(first);expect(observe).toHaveBeenCalledTimes(2);
    w.unmount();wrappers.splice(wrappers.indexOf(w),1);expect(disconnect).toHaveBeenCalledOnce();
  }finally{vi.unstubAllGlobals();}
});

for(const kind of ['multi','xps'] as const)it(kind+'：结果面板改变宽度后主图与残差跟随容器，隐藏后恢复仍重绘',async()=>{
 let callback:ResizeObserverCallback=()=>{};vi.stubGlobal('ResizeObserver',class {constructor(fn:ResizeObserverCallback){callback=fn;}observe(){}disconnect(){}});
 try {
 const w=mount(kind==='multi'?MultiPeakChart:XpsChart,{props:{x:[1,2,3],y:[0,3,0],start:1,end:3,preview:null,result:null,...(kind==='multi'?{mode:'general' as const}:{shift:0})}});wrappers.push(w);await flushPromises();
 const main=w.get('[data-test="'+kind+'-plot"]').element as any,residual=w.get('[data-test="'+kind+'-residual"]').element as any;
 let width=700;for(const el of [main,residual])Object.defineProperty(el,'clientWidth',{get:()=>width,configurable:true});
 const resized=async()=>{callback([{target:main,contentRect:{width,height:300}}] as any,{} as ResizeObserver);await flushPromises();};
 await resized();width=340;await resized();expect(main.layout.width).toBe(340);expect(residual.layout.width).toBe(340);
 width=0;await resized();vi.mocked(Plotly.react).mockClear();width=340;await resized();expect(Plotly.react).toHaveBeenCalled();
 }finally{vi.unstubAllGlobals();}
});
