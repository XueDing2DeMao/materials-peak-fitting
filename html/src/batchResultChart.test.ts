import { afterEach, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import Plotly from 'plotly.js-dist-min';
import { createMultiConfig } from './multipeakState';
import BatchResultChart from './components/BatchResultChart.vue';

vi.mock('plotly.js-dist-min',()=>({default:{react:vi.fn().mockResolvedValue(undefined),purge:vi.fn(),downloadImage:vi.fn()}}));
const wrappers:ReturnType<typeof mount>[]=[];
afterEach(()=>{wrappers.splice(0).forEach(w=>w.unmount());vi.clearAllMocks();});
async function chart(xps=false){
  const request:any=createMultiConfig([0,1,2,3,4],[1,2,3,2,1],null,'general');request.range_start=1;request.range_end=3;
  if(xps){delete request.analysis_mode;request.shift_eV=1;}
  const w=mount(BatchResultChart,{props:{request,preview:{x:[1,2,3],raw_y:[1,2,1],baseline:[1,1,1],baseline_configuration:{...request.baseline,resolved_anchors:[]}},result:null,selectedPeak:''}});wrappers.push(w);await flushPromises();return w;
}
it('未执行只绘制原谱与背景；默认聚焦拟合区间，全谱切换不改变拟合请求',async()=>{
  const w=await chart();
  let call=vi.mocked(Plotly.react).mock.calls.at(-1)!;
  expect((call[1] as any[]).map(t=>t.name)).toEqual(['原始谱','固定背景']);
  expect((call[2] as any).xaxis.range).toEqual([1,3]);
  expect((call[2] as any).yaxis2).toBeUndefined();
  expect((w.get('[data-test="batch-plot"]').element as HTMLElement).style.height).toBe('350px');
  await w.get('[data-test="batch-chart-full"]').trigger('click');await flushPromises();
  call=vi.mocked(Plotly.react).mock.calls.at(-1)!;
  expect((call[2] as any).xaxis.range).toEqual([0,4]);
  expect(w.props('request').range_start).toBe(1);
});
it('拟合区间的强度轴不被区间外的高峰压缩',async()=>{
  const w=await chart();
  await w.setProps({request:{...w.props('request'),y:[100000,2,3,2,100000]}});await flushPromises();
  const layout=vi.mocked(Plotly.react).mock.calls.at(-1)![2] as any;
  expect(layout.yaxis.range).toBeDefined();
  expect(layout.yaxis.range[1]).toBeLessThan(10);
  await w.get('[data-test="batch-chart-full"]').trigger('click');await flushPromises();
  expect((vi.mocked(Plotly.react).mock.calls.at(-1)![2] as any).yaxis.range[1]).toBeGreaterThan(100000);
});
it('XPS 原谱使用校准后倒序坐标，残差与主图共享轴，选峰突出对应曲线',async()=>{
  const w=await chart(true);
  await w.setProps({result:{x:[1,2,3],total_y:[1,3,1],residuals:[0,1,0],components:[{id:'p1',label:'峰1',y:[0,2,0]},{id:'p2',label:'峰2',y:[0,1,0]}]} as any,selectedPeak:'p1'});await flushPromises();
  const call=vi.mocked(Plotly.react).mock.calls.at(-1)!;
  const traces=call[1] as any[],layout=call[2] as any;
  expect(traces[0].x).toEqual([1,2,3,4,5]);
  expect(layout.xaxis.range).toEqual([3,1]);
  expect(layout.xaxis2.matches).toBe('x');
  expect(traces.find(t=>t.name.startsWith('残差')).yaxis).toBe('y2');
  expect(traces.find(t=>t.name.startsWith('p1')).line.width).toBeGreaterThan(traces.find(t=>t.name.startsWith('p2')).line.width);
});
it('切换谱线时等待未完成的绘图结束后再释放图表',async()=>{
  let finish!:()=>void;
  vi.mocked(Plotly.react).mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve;}));
  const w=await chart();const node=w.get('[data-test="batch-plot"]').element;
  w.unmount();
  expect(Plotly.purge).not.toHaveBeenCalled();
  finish();await flushPromises();
  expect(Plotly.purge).toHaveBeenCalledWith(node);
});
