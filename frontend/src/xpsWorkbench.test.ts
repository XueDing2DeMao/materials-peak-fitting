import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {flushPromises,mount} from "@vue/test-utils";
import XpsWorkbench from "./components/XpsWorkbench.vue";
import XpsFitControls from "./components/XpsFitControls.vue";
import Plotly from "plotly.js-dist-min";
import App from "./App.vue";
import DatasetSummary from "./components/DatasetSummary.vue";
import * as api from "./xpsApi";
import * as files from "./resultExport";
import * as single from "./api";
import { createConfig, makeDoublet } from "./xpsState";
vi.mock("plotly.js-dist-min",()=>({default:{react:vi.fn((el:any)=>{el.on=vi.fn();el.removeAllListeners=vi.fn();return Promise.resolve();}),purge:vi.fn(),downloadImage:vi.fn()}}));
vi.mock("./xpsApi",()=>({previewXps:vi.fn(),fitXps:vi.fn(),candidatesXps:vi.fn(),exportXps:vi.fn()}));
vi.mock("./api",()=>({uploadDataset:vi.fn(),loadDatasetRows:vi.fn().mockResolvedValue({columns:[],rows:[],row_numbers:[],total_rows:0,offset:0,limit:100}),previewDataset:vi.fn()}));
const x=[90,95,100,105,110],y=[2,3,10,6,3];
const source={filename:"XPS.xlsx",file_sha256:"a".repeat(64),sheet:"Ge2p",x_column:"E",y_column:"I"};
const preview={x,x_raw:x,raw_y:y,baseline:[1,1,1,1,1],background:{kind:"line",iterations:0,converged:true}};
const result:any={...preview,components:[],groups:[],total_y:y,residuals:[1,1,1,1,1],converged:true,message:"done",statistics:{},evaluations:5,diagnostics:{identifiable:true,uncertainty_available:true,strong_correlations:[],warnings:[]}};
const mounted:Array<{unmount:()=>void}>=[];
function workbench(){const w=mount(XpsWorkbench,{props:{x,y,source}});mounted.push(w);return w;}
beforeEach(()=>{
Object.defineProperty(HTMLDialogElement.prototype,"showModal",{configurable:true,writable:true,value:function(){this.setAttribute("open","");}});
Object.defineProperty(HTMLDialogElement.prototype,"close",{configurable:true,writable:true,value:function(){this.removeAttribute("open");this.dispatchEvent(new Event("close"));}});vi.clearAllMocks();vi.mocked(api.fitXps).mockResolvedValue(result);vi.mocked(api.previewXps).mockResolvedValue(preview);});
afterEach(()=>{mounted.splice(0).forEach(w=>w.unmount());vi.restoreAllMocks();});
describe("XPS 页面行为",()=>{
  it('导出当前结果不重新求解，失败后可重试且反馈真实',async()=>{
    const save=vi.spyOn(files,'saveFile').mockImplementationOnce(()=>{throw new Error('下载不可用');}).mockImplementation(()=>{});
    const fitted={...result,configuration:createConfig(x,y,source),net_total:y.map(v=>v-1)};
    vi.mocked(api.fitXps).mockResolvedValue(fitted);
    const w=workbench();await w.get('[data-test="xps-add"]').trigger('click');
    await w.get('[data-test="xps-fit"]').trigger('click');await flushPromises();
    await w.get('[data-test="xps-export-config"]').trigger('click');await flushPromises();
    expect(w.get('[role="alert"]').text()).toContain('下载不可用');
    expect(w.text()).not.toContain('已发起');
    await w.get('[data-test="xps-export-config"]').trigger('click');await flushPromises();
    expect(w.find('[role="alert"]').exists()).toBe(false);expect(w.text()).toContain('已发起');
    expect(JSON.parse(save.mock.calls[1][1]).result).toEqual(fitted);
    expect(api.fitXps).toHaveBeenCalledTimes(1);expect(api.exportXps).not.toHaveBeenCalled();
  });
  it('结果视图切换保留峰参数与图谱，预览仍须人工复核',async()=>{
    const w=workbench();
    await w.get('[data-test="xps-add"]').trigger('click');
    const config=w.getComponent(XpsFitControls).props('config');
    config.components[0].parameters.A!.value=42;
    await w.get('[data-test="xps-background"]').setValue('shirley');
    await w.get('[data-test="xps-preview"]').trigger('click');await flushPromises();
    expect(config.background.confirmed).toBe(false);
    const plot=w.get('[data-test="xps-plot"]').element;
    await w.get('[data-test="result-view-diagnostics"]').trigger('click');
    await w.get('[data-test="result-view-archive"]').trigger('click');
    await w.get('[data-test="result-view-results"]').trigger('click');
    expect(w.get('[data-test="xps-plot"]').element).toBe(plot);
    expect(w.getComponent(XpsFitControls).props('config')).toBe(config);
    expect(config.components[0].parameters.A!.value).toBe(42);
    expect(config.background.confirmed).toBe(false);
    expect(api.fitXps).not.toHaveBeenCalled();
  });
  it('手动背景水平和自定义窗口保持可见，恢复默认后可折叠',async()=>{
    const w=workbench(),config=w.getComponent(XpsFitControls).props('config');
    const details=()=>w.get('[data-test="xps-background-details"]');
    expect(details().attributes('open')).toBeUndefined();
    config.background.low_level=4;await flushPromises();
    expect(details().attributes('open')).toBeDefined();
    expect(details().get('summary').text()).toContain('手动水平');
    config.background.low_level=null;config.background.low_window=[90,92];await flushPromises();
    expect(details().attributes('open')).toBeDefined();
    expect(details().get('summary').text()).toContain('自定义窗口');
    await details().get('button').trigger('click');await flushPromises();
    expect(details().attributes('open')).toBeUndefined();
  });
  it('倒序轴连续左键添加，并右键删除对应标记',async()=>{
    const w=workbench();await w.get('[data-test="xps-background"]').setValue('none');
    const plot=w.get('[data-test="xps-plot"]').element as HTMLElement & {_fullLayout:unknown};
    plot._fullLayout={xaxis:{_offset:20,_length:400,range:[110,90]},yaxis:{_offset:50,_length:200}};
    await w.get('[data-test="chart-add-peak"]').trigger('click');
    for(const clientX of [220,260]){for(const type of ['pointerdown','pointerup'])plot.dispatchEvent(new MouseEvent(type,{clientX,clientY:100,bubbles:true}));await flushPromises();}
    expect((w.get('[aria-label="p2 xc 初值"]').element as HTMLInputElement).value).toBe('98');
    for(const type of ['pointerdown','pointerup'])plot.dispatchEvent(new MouseEvent(type,{button:2,clientX:220,clientY:100,bubbles:true}));
    await flushPromises();expect(w.find('[aria-label="p1 xc 初值"]').exists()).toBe(false);expect(w.find('[aria-label="p2 xc 初值"]').exists()).toBe(true);
    expect(w.get('[data-test="chart-add-peak"]').text()).toBe('取消添加峰');
  });
  it("添加峰后在倒序能量轴上显示相同 xc 的标注，停用峰移除标注",async()=>{
    const w=workbench();await w.get('[data-test="xps-add"]').trigger('click');await flushPromises();
    const plot=w.get('[data-test="xps-plot"]').element;
    const layout=()=>vi.mocked(Plotly.react).mock.calls.filter((call:unknown[])=>call[0]===plot).at(-1)![2] as any;
    expect(layout().xaxis.autorange).toBe(false);expect(layout().xaxis.range[0]).toBeGreaterThan(layout().xaxis.range[1]);
    expect(layout().annotations[0]).toMatchObject({x:100,text:'p1<br>100 eV'});
    await w.findAll('label').find(label=>label.text()==='启用此峰')!.get('input').setValue(false);await flushPromises();
    expect(layout().annotations).toEqual([]);
  });
  it("结果 JSON 可恢复峰设置，但须重新复核 Shirley 背景并拟合",async()=>{
    const w=workbench(),config=createConfig(x,y,source);makeDoublet(config,4.6,.5);
    config.background.kind="shirley";config.background.confirmed=true;
    const artifact={...result,configuration:config};
    const file=new File([JSON.stringify(artifact)],"ge2p-shirley-result.json",{type:"application/json"});
    Object.defineProperty(file,"text",{value:async()=>JSON.stringify(artifact)});
    const input=w.get('input[type="file"]');Object.defineProperty(input.element,"files",{value:[file]});
    await input.trigger("change");await flushPromises();
    expect(w.find('[role="alert"]').exists()).toBe(false);
    expect(w.get('[role="status"]').text()).toContain("配置已载入并核对原数据");
    expect(w.find('[aria-label="p2 A 初值"]').exists()).toBe(true);
    expect(api.previewXps).toHaveBeenCalledWith(expect.objectContaining({components:config.components,background:expect.objectContaining({kind:"shirley"})}));
    expect(w.find('[data-test="xps-export-curves"]').exists()).toBe(false);
    expect((w.get('[data-test="xps-confirm"]').element as HTMLInputElement).checked).toBe(false);
    expect(w.get('[data-test="xps-fit"]').attributes("disabled")).toBeDefined();
    await w.get('[data-test="xps-confirm"]').setValue(true);
    await w.get('[data-test="xps-fit"]').trigger("click");await flushPromises();
    expect(api.fitXps).toHaveBeenCalledWith(config);
    expect(w.get('[data-test="xps-export-curves"]').attributes("disabled")).toBeUndefined();
  });
  it("结果配置与当前谱不匹配时保留已有峰，并提示所需原文件和谱列",async()=>{
    const w=workbench();await w.get('[data-test="xps-add"]').trigger("click");await w.get('[aria-label="p1 A 初值"]').setValue(42);
    const config=createConfig(x,y,{...source,sheet:"其他工作表"});
    const artifact={configuration:config};
    const file=new File([JSON.stringify(artifact)],"result.json",{type:"application/json"});
    Object.defineProperty(file,"text",{value:async()=>JSON.stringify(artifact)});
    const input=w.get('input[type="file"]');Object.defineProperty(input.element,"files",{value:[file]});
    await input.trigger("change");await flushPromises();
    expect(w.get('[role="alert"]').text()).toMatch(/不匹配.*XPS.xlsx.*其他工作表/);
    expect((w.get('[aria-label="p1 A 初值"]').element as HTMLInputElement).value).toBe("42");
    expect(api.previewXps).not.toHaveBeenCalled();
  });
  it("设置变化阻止旧结果导出",async()=>{
    const w=workbench();await w.get('[data-test="xps-add"]').trigger("click");await w.get('[data-test="xps-fit"]').trigger("click");await flushPromises();
    expect(w.get('[data-test="xps-export-curves"]').attributes("disabled")).toBeUndefined();
    await w.get('[aria-label="p1 A 初值"]').setValue(30);
    expect(w.get('[data-test="xps-stale"]').text()).toContain("过期");
    expect(w.get('[data-test="xps-export-curves"]').attributes("disabled")).toBeDefined();
  });
  it("计算中修改参数会丢弃旧响应",async()=>{
    let resolve!:(value:any)=>void;vi.mocked(api.fitXps).mockReturnValue(new Promise(r=>resolve=r));
    const w=workbench();await w.get('[data-test="xps-add"]').trigger("click");await w.get('[data-test="xps-fit"]').trigger("click");
    await w.get('[aria-label="p1 A 初值"]').setValue(30);resolve(result);await flushPromises();
    expect(w.find('[data-test="xps-export-curves"]').exists()).toBe(false);expect(w.text()).toContain("丢弃过期响应");
  });
  it("Shirley 必须预览复核，区间更改取消复核",async()=>{
    const w=workbench();await w.get('[data-test="xps-add"]').trigger("click");await w.get('[data-test="xps-background"]').setValue("shirley");
    expect(w.get('[data-test="xps-confirm"]').attributes("disabled")).toBeDefined();
    expect(w.get('#xps-fit-blocker').text()).toContain('预览');
    expect(w.get('[data-test="xps-fit"]').attributes('aria-describedby')).toBe('xps-fit-blocker');
    await w.get('[data-test="xps-preview"]').trigger('click');await flushPromises();
    expect(w.get('#xps-fit-blocker').text()).toContain('勾选确认');
    await w.get('[data-test="xps-confirm"]').setValue(true);
    expect(w.find('#xps-fit-blocker').exists()).toBe(false);
    expect(w.get('[data-test="xps-fit"]').attributes("disabled")).toBeUndefined();
    await w.get('[data-test="xps-range-start"]').setValue(91);
    expect((w.get('[data-test="xps-confirm"]').element as HTMLInputElement).checked).toBe(false);
    expect(w.get('[data-test="xps-fit"]').attributes("disabled")).toBeDefined();
  });
  it("切换模式保留 XPS 峰设置",async()=>{
    vi.mocked(single.uploadDataset).mockResolvedValue({dataset_id:"1",filename:source.filename,file_sha256:source.file_sha256,sheets:[]});
    vi.mocked(single.previewDataset).mockResolvedValue({x,y});
    const w=mount(App);mounted.push(w);w.findComponent(DatasetSummary).vm.$emit("upload",new File(["x"],"XPS.xlsx"));await flushPromises();
    w.findComponent(DatasetSummary).vm.$emit("preview",{sheet:"Ge2p",xColumn:"E",yColumn:"I"});await flushPromises();
    await w.get('[data-test="analysis-mode"]').setValue("xps");await w.get('[data-test="xps-add"]').trigger("click");await w.get('[aria-label="p1 A 初值"]').setValue(42);
    await w.get('[data-test="analysis-mode"]').setValue("single");await w.get('[data-test="analysis-mode"]').setValue("xps");
    expect((w.get('[aria-label="p1 A 初值"]').element as HTMLInputElement).value).toBe("42");
  });
});
