import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import Plotly from 'plotly.js-dist-min';
import MultiPeakChart from './components/MultiPeakChart.vue';

vi.mock('plotly.js-dist-min', () => {
  function extent(node: any) {
    const x = node.traces.flatMap((trace: any) => trace.x ?? []);
    return [Math.min(...x) - .1, Math.max(...x) + .1];
  }
  return { default: {
    purge: vi.fn(), downloadImage: vi.fn(),
    react: vi.fn(async (node: any, traces: any[], layout: any) => {
      const previous = node.layout;
      node.traces = traces;
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
