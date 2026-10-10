import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { nextTick } from "vue";
import Plotly from "plotly.js-dist-min";
import App from "./App.vue";
import FitChart from "./components/FitChart.vue";
import FitControls from "./components/FitControls.vue";
import DatasetSummary from "./components/DatasetSummary.vue";
import ResultsPanel from "./components/ResultsPanel.vue";
import XpsWorkbench from "./components/XpsWorkbench.vue";
import * as api from "./api";
import type { DatasetInfo, FitResult } from "./types";

// jsdom 没有图形引擎，只替换 Plotly 边界，保留实际 Vue 组件和交互。
vi.mock("plotly.js-dist-min", () => ({ default: {
  register: vi.fn(), purge: vi.fn(), downloadImage: vi.fn(),
  react: vi.fn((node: any) => {
    node._fullLayout = { xaxis: { _offset: 50, _length: 500, range: [0, 10] }, yaxis: { _offset: 40, _length: 300 } };
    node.events ??= {};
    node.on = (name: string, callback: (event: any) => void) => { node.events[name] = callback; };
    node.removeAllListeners = (name: string) => { delete node.events[name]; };
    return Promise.resolve();
  }),
} }));
vi.mock("./api", () => ({
  analyzePeak: vi.fn(), compareModels: vi.fn(), downloadExport: vi.fn(),
  previewBaseline: vi.fn(), previewDataset: vi.fn(), runFit: vi.fn(), uploadDataset: vi.fn(),
}));

const x = Array.from({ length: 11 }, (_, index) => index);
const y = x.map((value) => 1 + Math.exp(-((value - 5) ** 2)));
const result: FitResult = {
  x, raw_y: y, baseline: x.map(() => 1), net_y: y.map((value) => value - 1),
  peak_y: y.map((value) => value - 1), total_y: y, residual: x.map(() => 0),
  parameters: { A: { value: 2, standard_error: 0.1 }, xc: { value: 5, standard_error: 0.1 }, w: { value: 2, standard_error: 0.1 } },
  statistics: { r_squared: 1, adjusted_r_squared: 1, rmse: 0, sse: 0 },
  converged: true, message: "完成", model: "gaussian", range_start: 0, range_end: 10,
};
const mounted: Array<{ unmount: () => void }> = [];
function track<T extends { unmount: () => void }>(wrapper: T): T { mounted.push(wrapper); return wrapper; }
function chart(extra = {}) {
  return track(mount(FitChart, { props: { x, y, result: null, anchors: [], baselinePreview: null, analysisRange: { start: 2, end: 8 }, ...extra } }));
}
function pointer(target: EventTarget, type: string, clientX: number) {
  target.dispatchEvent(new MouseEvent(type, { clientX, bubbles: true, cancelable: true }));
}
beforeEach(() => vi.clearAllMocks());
afterEach(() => { mounted.splice(0).forEach((wrapper) => wrapper.unmount()); });

describe("分析范围合并", () => {
  it("参数弹窗保留完整初值、边界与固定设置，关闭后不丢失修改", async () => {
    const wrapper = track(mount(FitControls, { props: { x, y } }));
    await wrapper.get('[data-test="peak-model"]').setValue('psd_voigt2');
    const dialog = wrapper.get('dialog').element as HTMLDialogElement;
    dialog.showModal = () => dialog.setAttribute('open', '');
    dialog.close = () => { dialog.removeAttribute('open'); dialog.dispatchEvent(new Event('close')); };
    await wrapper.get('[data-test="edit-parameters"]').trigger('click');
    expect(dialog.open).toBe(true);
    const initial = 28914.576388375;
    await wrapper.get('[data-test="initial-A"]').setValue(String(initial));
    await wrapper.get('[data-test="bound-wG-lower"]').setValue('0.01');
    await wrapper.get('[data-test="bound-wG-upper"]').setValue('2');
    await wrapper.get('[data-test="fixed-A"]').setValue(true);
    expect(wrapper.emitted('settings-change')).toBeTruthy();
    await wrapper.get('[data-test="finish-parameters"]').trigger('click');
    expect(dialog.open).toBe(false);
    const request = (wrapper.vm as any).buildFitRequest();
    expect(request.initial_parameters.A).toBe(initial);
    expect(request.fixed_parameters.A).toBe(initial);
    expect(request.parameter_bounds.wG).toEqual({ lower: 0.01, upper: 2 });
    await wrapper.get('[data-test="edit-parameters"]').trigger('click');
    expect((wrapper.get('[data-test="initial-A"]').element as HTMLInputElement).value).toBe(String(initial));
    expect(wrapper.findAll('.parameter-row')).toHaveLength(5);
  });
  it('改模型后丢弃旧的模型比较与自动初值响应', async()=>{
    const wrapper=track(mount(App));
    let finishComparison!:(value:any)=>void,finishAnalysis!:(value:any)=>void;
    vi.mocked(api.compareModels).mockImplementationOnce(()=>new Promise(resolve=>finishComparison=resolve));
    vi.mocked(api.analyzePeak).mockImplementationOnce(()=>new Promise(resolve=>finishAnalysis=resolve));
    const controls=wrapper.getComponent(FitControls);
    wrapper.getComponent(ResultsPanel).vm.$emit('compare',true);
    controls.vm.$emit('auto-analyze',{});
    controls.vm.$emit('settings-change');
    finishComparison({active_model:'emg_high',recommended_model:'emg_high',rows:[]});
    finishAnalysis({model:'emg_high',initial_parameters:{A:3,xc:2,sigma:1,tau:2}});
    await flushPromises();
    expect(wrapper.getComponent(ResultsPanel).props('comparison')).toBeNull();
    expect(controls.props('autoAnalysis')).toBeNull();
  });
  it("加载数据后发布完整范围，手动修改同步到图表", async () => {
    const wrapper = track(mount(FitControls, { props: { x, y } }));
    expect(wrapper.emitted("range-change")?.at(-1)).toEqual([{ start: 0, end: 10 }]);
    await wrapper.get('[data-test="range-start"]').setValue(2);
    expect(wrapper.emitted("range-change")?.at(-1)).toEqual([{ start: 2, end: 10 }]);
    await wrapper.get('[data-test="range-end"]').setValue(1);
    expect(wrapper.emitted("range-change")?.at(-1)).toEqual([null]);
  });

  it("点击端点时切回基线页并聚焦输入框", async () => {
    const wrapper = track(mount(FitControls, { props: { x, y }, attachTo: document.body }));
    const tabs = wrapper.findAll('[role="tab"]');
    await tabs[1].trigger("click");
    (wrapper.vm as any).focusRangeEndpoint("end");
    await nextTick();
    expect(tabs[0].attributes("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(wrapper.get('[data-test="range-end"]').element);
  });

  it("拖动边界更新区间且不能越过另一端", async () => {
    const wrapper = chart();
    await wrapper.get('[data-test="range-edit-toggle"]').trigger("click");
    await flushPromises();
    pointer(wrapper.get('[data-test="range-start-handle"]').element, "pointerdown", 150);
    pointer(window, "pointermove", 200);
    pointer(window, "pointerup", 200);
    expect(wrapper.emitted("range")?.at(-1)).toEqual([{ start: 3, end: 8 }]);
    await nextTick();
    pointer(wrapper.get('[data-test="range-start-handle"]').element, "pointerdown", 200);
    pointer(window, "pointermove", 550);
    pointer(window, "pointerup", 550);
    const changed = wrapper.emitted("range")?.at(-1)?.[0] as { start: number; end: number };
    expect(changed.start).toBeLessThan(changed.end);
    expect(changed.end).toBe(8);
  });

  it("整体平移保留宽度并限制在数据范围内，Escape 收起手柄", async () => {
    const wrapper = chart();
    await wrapper.get('[data-test="range-edit-toggle"]').trigger("click");
    await flushPromises();
    pointer(wrapper.get('[data-test="range-window-handle"]').element, "pointerdown", 300);
    pointer(window, "pointermove", 550);
    pointer(window, "pointerup", 550);
    expect(wrapper.emitted("range")?.at(-1)).toEqual([{ start: 4, end: 10 }]);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await nextTick();
    expect(wrapper.find('[data-test="range-manipulator"]').exists()).toBe(false);
  });

  it.each([
    { start: 0, end: 1, handle: "start", pointerX: 55, expected: { start: 0.1, end: 1 } },
    { start: 1999, end: 2000, handle: "end", pointerX: 545, expected: { start: 1999, end: 1999.9 } },
  ])("对长曲线的窄区间拖动 $handle 不越界", async ({ start, end, handle, pointerX, expected }) => {
    const wrapper = chart({ x: [0, 0.1, 0.5, 1, 1999, 1999.9, 2000], y: [1, 2, 3, 2, 3, 2, 1], analysisRange: { start, end } });
    await wrapper.get('[data-test="range-edit-toggle"]').trigger("click");
    await flushPromises();
    const node = wrapper.get(".chart").element as any;
    node._fullLayout.xaxis.range = [start, start + 10];
    if (handle === "end") node._fullLayout.xaxis.range = [1990, 2000];
    pointer(wrapper.get(`[data-test="range-${handle}-handle"]`).element, "pointerdown", pointerX);
    pointer(window, "pointermove", pointerX);
    pointer(window, "pointerup", pointerX);
    expect(wrapper.emitted("range")?.at(-1)).toEqual([expected]);
  });

  it("框选完成更新范围并退出选择模式，端点点击不添加基线锚点", async () => {
    const wrapper = chart();
    await wrapper.get('[data-test="range-selection-toggle"]').trigger("click");
    await flushPromises();
    const node = wrapper.get(".chart").element as any;
    node.events.plotly_selected({ points: [{ x: 7 }, { x: 3 }, { x: 5 }] });
    await flushPromises();
    expect(wrapper.emitted("range")?.at(-1)).toEqual([{ start: 3, end: 7 }]);
    expect(wrapper.get('[data-test="range-selection-toggle"]').attributes("aria-pressed")).toBe("false");
    node.events.plotly_click({ points: [{ x: 2, y: 1, data: { name: "分析区间端点" }, customdata: "start" }] });
    expect(wrapper.emitted("range-endpoint-focus")).toEqual([["start"]]);
    expect(wrapper.emitted("anchor")).toBeUndefined();
  });
});

describe("旧拟合结果与当前设置", () => {
  it("保留旧曲线时仍显示当前基线预览", () => {
    const preview = { x, baseline: x.map(() => 2) };
    const wrapper = chart({ result, stale: true, baselinePreview: preview });
    const call = vi.mocked(Plotly.react).mock.calls.find((args: any[]) => args[0] === wrapper.get(".chart").element);
    const traces = call?.[1] as any[];
    expect(traces.find((trace) => trace.name === "待复核基线")?.y).toEqual(preview.baseline);
    expect(traces.find((trace) => trace.name.includes("总拟合"))?.y).toEqual(result.total_y);
    expect(wrapper.text()).toContain("上一次拟合");
  });

  it("结果面板说明旧结果并禁止按当前设置导出", async () => {
    const wrapper = track(mount(ResultsPanel, { props: { result, stale: true } }));
    expect(wrapper.text()).toContain("以下为上一次拟合");
    expect(wrapper.text()).toContain("模型全域面积（Y × X 单位）");
    for (const button of wrapper.findAll(".export-actions button")) {
      expect((button.element as HTMLButtonElement).disabled).toBe(true);
    }
    await wrapper.setProps({ stale: false });
    await wrapper.get('[data-test="export-image"]').trigger("click");
    expect(wrapper.emitted("export-image")).toHaveLength(1);
  });

  it("完整工作台接入区间联动，设置变化保留结果，重新拟合清除过期状态", async () => {
    vi.mocked(api.uploadDataset).mockResolvedValue({ dataset_id: "example", filename: "sample.csv", sheets: [{ name: "data", columns: ["x", "y"], numeric_columns: ["x", "y"], row_count: 11, preview_rows: [] }] });
    vi.mocked(api.previewDataset).mockResolvedValue({ x, y });
    vi.mocked(api.runFit).mockResolvedValue(result);
    const wrapper = track(mount(App));
    wrapper.getComponent(DatasetSummary).vm.$emit("upload", new File(["x,y"], "sample.csv"));
    await flushPromises();
    const controls = wrapper.getComponent(FitControls);
    const plot = wrapper.getComponent(FitChart);
    expect(plot.props("analysisRange")).toEqual({ start: 0, end: 10 });
    controls.vm.$emit("fit", (controls.vm as any).buildFitRequest());
    await flushPromises();
    plot.vm.$emit("range", { start: 2, end: 8 });
    await flushPromises();
    expect((controls.get('[data-test="range-start"]').element as HTMLInputElement).value).toBe("2");
    expect(plot.props("result")).toEqual(result);
    expect(plot.props("stale")).toBe(true);
    expect(wrapper.getComponent(ResultsPanel).props("result")).toEqual(result);
    wrapper.getComponent(ResultsPanel).vm.$emit("export", "curves");
    await flushPromises();
    expect(api.downloadExport).not.toHaveBeenCalled();
    controls.vm.$emit("fit", (controls.vm as any).buildFitRequest());
    await flushPromises();
    expect(api.runFit).toHaveBeenLastCalledWith(expect.objectContaining({ range_start: 2, range_end: 8 }));
    expect(plot.props("stale")).toBe(false);
  });
});

describe("XRD 分析模式", () => {
  it("可从模式菜单进入 XRD，沿用单峰拟合及当前区间", async () => {
    vi.mocked(api.uploadDataset).mockResolvedValue({ dataset_id: "xrd", filename: "XRD.csv", sheets: [{ name: "data", columns: ["2theta", "intensity"], numeric_columns: ["2theta", "intensity"], row_count: 11, preview_rows: [] }] });
    vi.mocked(api.previewDataset).mockResolvedValue({ x, y });
    vi.mocked(api.runFit).mockResolvedValue(result);
    const wrapper = track(mount(App));
    expect(wrapper.get('[data-test="analysis-mode"]').findAll("option").map(option => option.text())).toContain("XRD 单峰拟合");
    wrapper.getComponent(DatasetSummary).vm.$emit("upload", new File(["2theta,intensity"], "XRD.csv"));
    await flushPromises();
    await wrapper.get('[data-test="analysis-mode"]').setValue("xrd");
    expect(wrapper.get(".workbench-grid").isVisible()).toBe(true);
    expect(wrapper.getComponent(FitChart).props("analysisMode")).toBe("xrd");
    expect(wrapper.getComponent(FitChart).text()).toContain("2θ（°）");
    const controls = wrapper.getComponent(FitControls);
    await controls.get('[data-test="range-start"]').setValue(2);
    await controls.get('[data-test="range-end"]').setValue(8);
    await controls.get('[data-test="fit-button"]').trigger("click");
    await flushPromises();
    expect(api.runFit).toHaveBeenLastCalledWith(expect.objectContaining({ x, y, range_start: 2, range_end: 8 }));
    expect(wrapper.getComponent(ResultsPanel).text()).toContain("峰顶 2θ（°）");
    await wrapper.get('[data-test="analysis-mode"]').setValue("single");
    await wrapper.get('[data-test="analysis-mode"]').setValue("xrd");
    expect((controls.get('[data-test="range-start"]').element as HTMLInputElement).value).toBe("2");
    expect(wrapper.getComponent(ResultsPanel).props("result")).toEqual(result);
  });

  it("XRD 主图、残差图和 PNG 使用衍射角标识，切回后恢复通用标识", async () => {
    const wrapper = chart({ result });
    await wrapper.setProps({ analysisMode: "xrd" } as any);
    await flushPromises();
    const main = vi.mocked(Plotly.react).mock.calls.filter((args: any[]) => args[0] === wrapper.get(".chart").element).at(-1) as any[];
    const residual = vi.mocked(Plotly.react).mock.calls.filter((args: any[]) => args[0] === wrapper.get(".residual-chart").element).at(-1) as any[];
    expect(main[2].xaxis.title.text).toBe("2θ（°）");
    expect(residual[2].xaxis.title.text).toBe("2θ（°）");
    expect(main[2].yaxis.title.text).toBe("衍射强度（原数据单位）");
    expect(wrapper.text()).toContain("整体 FWHM = 2.00000 °");
    (wrapper.vm as any).downloadImage();
    expect(Plotly.downloadImage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ filename: "xrd-peak-fit" }));
    await wrapper.setProps({ analysisMode: "single" } as any);
    await flushPromises();
    const restored = vi.mocked(Plotly.react).mock.calls.filter((args: any[]) => args[0] === wrapper.get(".chart").element).at(-1) as any[];
    expect(restored[2].xaxis.title.text).toBe("X");
  });
});

const workbook: DatasetInfo = {
  dataset_id: "review", filename: "public.xlsx", file_sha256: "a".repeat(64),
  sheets: ["first", "second"].map(name => ({ name, columns: ["x", "y"], numeric_columns: ["x", "y"], row_count: 12, preview_rows: [] })),
};
async function loadedApp() {
  vi.mocked(api.uploadDataset).mockResolvedValue(workbook);
  vi.mocked(api.previewDataset).mockResolvedValue({ x, y });
  const wrapper = track(mount(App));
  wrapper.getComponent(DatasetSummary).vm.$emit("upload", new File(["data"], "public.xlsx"));
  await flushPromises();
  return wrapper;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("数据与拟合生命周期", () => {
  it("峰形选择保留设置失效通知并提交所选模型", async () => {
    const wrapper = track(mount(FitControls, { props: { x, y } }));
    await wrapper.get('[data-test="control-tab-peak"]').trigger("click");
    await wrapper.get('[data-test="peak-model"]').setValue("psd_voigt1");
    expect(wrapper.emitted("settings-change")).toHaveLength(1);
    await wrapper.get('[data-test="fit-button"]').trigger("click");
    expect(wrapper.emitted("fit")?.at(-1)?.[0]).toEqual(expect.objectContaining({ model: "psd_voigt1" }));
  });
  it("数值输入尚未失焦时也丢弃旧拟合响应", async () => {
    const wrapper = await loadedApp(), pending = deferred<FitResult>();
    vi.mocked(api.runFit).mockReturnValueOnce(pending.promise);
    const controls = wrapper.getComponent(FitControls);
    controls.vm.$emit("fit", {});
    const input = controls.get('[data-test="range-start"]');
    (input.element as HTMLInputElement).value = "2";
    await input.trigger("input");
    pending.resolve(result); await flushPromises();
    expect(wrapper.getComponent(ResultsPanel).props("result")).toBeNull();
    expect(wrapper.getComponent(ResultsPanel).props("fitting")).toBe(false);
  });
  it("计算期间禁用主按钮并忽略重复提交", async () => {
    const wrapper = await loadedApp(), pending = deferred<FitResult>();
    vi.mocked(api.runFit).mockReturnValueOnce(pending.promise);
    const controls = wrapper.getComponent(FitControls);
    controls.vm.$emit("fit", {}); controls.vm.$emit("fit", {});
    await nextTick();
    expect(api.runFit).toHaveBeenCalledTimes(1);
    expect(controls.get('[data-test="fit-button"]').attributes("disabled")).toBeDefined();
    expect(controls.get('[data-test="fit-button"]').text()).toContain("拟合中");
    pending.resolve(result); await flushPromises();
    expect(wrapper.getComponent(ResultsPanel).props("fitting")).toBe(false);
  });
  it("修改设置后可重新提交，旧请求结束不清除新任务状态或覆盖结果", async () => {
    const wrapper = await loadedApp(), old = deferred<FitResult>(), latest = deferred<FitResult>();
    vi.mocked(api.runFit).mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    const controls = wrapper.getComponent(FitControls);
    controls.vm.$emit("fit", {}); controls.vm.$emit("settings-change"); controls.vm.$emit("fit", {});
    old.resolve({ ...result, message: "old" }); await flushPromises();
    expect(wrapper.getComponent(ResultsPanel).props("fitting")).toBe(true);
    expect(wrapper.getComponent(ResultsPanel).props("result")).toBeNull();
    latest.resolve(result); await flushPromises();
    expect(wrapper.getComponent(ResultsPanel).props("result")).toEqual(result);
  });
  it("最新结果先返回时也不会被过期结果覆盖", async () => {
    const wrapper = await loadedApp(), old = deferred<FitResult>(), latest = deferred<FitResult>();
    vi.mocked(api.runFit).mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    const controls = wrapper.getComponent(FitControls);
    controls.vm.$emit("fit", {}); controls.vm.$emit("settings-change"); controls.vm.$emit("fit", {});
    latest.resolve(result); await flushPromises(); old.resolve({ ...result, message: "old" }); await flushPromises();
    expect(wrapper.getComponent(ResultsPanel).props("result")).toEqual(result);
    expect(wrapper.getComponent(ResultsPanel).props("stale")).toBe(false);
  });
  it("更换数据后丢弃旧拟合错误", async () => {
    const wrapper = await loadedApp(), old = deferred<FitResult>();
    vi.mocked(api.runFit).mockReturnValueOnce(old.promise);
    wrapper.getComponent(FitControls).vm.$emit("fit", {});
    vi.mocked(api.uploadDataset).mockResolvedValueOnce({ ...workbook, dataset_id: "new" });
    wrapper.getComponent(DatasetSummary).vm.$emit("upload", new File(["new"], "new.xlsx"));
    await flushPromises(); old.reject(new Error("old failure")); await flushPromises();
    expect(wrapper.getComponent(ResultsPanel).props("error")).toBe("");
    expect(wrapper.getComponent(ResultsPanel).props("result")).toBeNull();
    expect(wrapper.getComponent(ResultsPanel).props("fitting")).toBe(false);
  });
  it("草稿不改变已应用摘要，取消恢复当前选择，成功后原子更新", async () => {
    const wrapper = await loadedApp(), data = wrapper.getComponent(DatasetSummary);
    await data.get('select').setValue("second");
    expect(data.get(".dataset-file").text()).toContain("first");
    expect(data.get(".dataset-file").text()).toContain("11 个有效点");
    await data.get('[data-test="cancel-selection"]').trigger("click");
    expect((data.get('select').element as HTMLSelectElement).value).toBe("first");
    await data.get('select').setValue("second");
    const pending = deferred<{x:number[];y:number[]}>();
    vi.mocked(api.previewDataset).mockReturnValueOnce(pending.promise);
    await data.get('[data-test="apply-selection"]').trigger("click");
    expect(wrapper.getComponent(FitChart).props("x")).toEqual(x);
    expect(data.get(".dataset-file").text()).toContain("first");
    pending.resolve({x:[2,3,4,5],y:[1,3,2,1]}); await flushPromises();
    expect(data.get(".dataset-file").text()).toContain("second");
    expect(wrapper.getComponent(FitChart).props("x")).toEqual([2,3,4,5]);
  });
  it("列预览失败保留当前数据并显示可重试错误", async () => {
    const wrapper = await loadedApp(), data = wrapper.getComponent(DatasetSummary);
    vi.mocked(api.previewDataset).mockRejectedValueOnce(new Error("所选列没有有效配对"));
    data.vm.$emit("preview", {sheet:"second",xColumn:"x",yColumn:"y"}); await flushPromises();
    expect(wrapper.getComponent(FitChart).props("x")).toEqual(x);
    expect(data.get(".dataset-file").text()).toContain("first");
    expect(data.get('[role="alert"]').text()).toContain("所选列没有有效配对");
  });
  it("XPS 来源与数组只在新列预览成功后共同更新", async () => {
    const wrapper = await loadedApp(), data = wrapper.getComponent(DatasetSummary);
    await wrapper.get('[data-test="analysis-mode"]').setValue("xps");
    const workbench = wrapper.getComponent(XpsWorkbench);
    const initialSource = workbench.props("source");
    await data.get('select').setValue("second");
    const pending = deferred<{x:number[];y:number[]}>();
    vi.mocked(api.previewDataset).mockReturnValueOnce(pending.promise);
    await data.get('[data-test="apply-selection"]').trigger("click");
    expect(workbench.props("source")).toEqual(initialSource);
    expect(workbench.props("x")).toEqual(x);
    pending.resolve({x:[2,3,4,5],y:[1,3,2,1]}); await flushPromises();
    expect(workbench.props("source")).toEqual({...initialSource,sheet:"second"});
    expect(workbench.props("x")).toEqual([2,3,4,5]);
    expect(workbench.props("y")).toEqual([1,3,2,1]);
  });
  it("更换文件失败保留旧文件并显示错误", async () => {
    const wrapper = await loadedApp(), data = wrapper.getComponent(DatasetSummary);
    vi.mocked(api.uploadDataset).mockRejectedValueOnce(new Error("文件损坏"));
    data.vm.$emit("upload",new File(["bad"],"bad.xlsx")); await flushPromises();
    expect(data.get('[role="alert"]').text()).toContain("文件损坏");
    expect(data.get('[role="alert"]').text()).toContain("public.xlsx");
    expect(wrapper.getComponent(FitChart).props("x")).toEqual(x);
  });
  it("页签方向键移动焦点并同步关联面板", async () => {
    const wrapper = track(mount(FitControls,{props:{x,y},attachTo:document.body}));
    const tabs = wrapper.findAll('[role="tab"]');
    await tabs[0].trigger("keydown",{key:"ArrowRight"});
    expect(tabs[1].attributes("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tabs[1].element);
    expect(tabs[0].attributes("tabindex")).toBe("-1");
    expect(wrapper.get(`#${tabs[1].attributes("aria-controls")}`).attributes("aria-labelledby")).toBe(tabs[1].attributes("id"));
    await tabs[1].trigger("keydown",{key:"End"}); expect(tabs[2].attributes("aria-selected")).toBe("true");
    await tabs[2].trigger("keydown",{key:"Home"}); expect(tabs[0].attributes("aria-selected")).toBe("true");
  });
});
