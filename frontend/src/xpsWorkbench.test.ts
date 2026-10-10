import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {flushPromises,mount} from "@vue/test-utils";
import XpsWorkbench from "./components/XpsWorkbench.vue";
import App from "./App.vue";
import DatasetSummary from "./components/DatasetSummary.vue";
import * as api from "./xpsApi";
import * as single from "./api";
import { createConfig, makeDoublet } from "./xpsState";
vi.mock("plotly.js-dist-min",()=>({default:{react:vi.fn((el:any)=>{el.on=vi.fn();el.removeAllListeners=vi.fn();return Promise.resolve();}),purge:vi.fn(),downloadImage:vi.fn()}}));
vi.mock("./xpsApi",()=>({previewXps:vi.fn(),fitXps:vi.fn(),candidatesXps:vi.fn(),exportXps:vi.fn()}));
vi.mock("./api",()=>({uploadDataset:vi.fn(),previewDataset:vi.fn()}));
const x=[90,95,100,105,110],y=[2,3,10,6,3];
const source={filename:"XPS.xlsx",file_sha256:"a".repeat(64),sheet:"Ge2p",x_column:"E",y_column:"I"};
const preview={x,x_raw:x,raw_y:y,baseline:[1,1,1,1,1],background:{kind:"line",iterations:0,converged:true}};
const result:any={...preview,components:[],groups:[],total_y:y,residuals:[1,1,1,1,1],converged:true,message:"done",statistics:{},evaluations:5,diagnostics:{identifiable:true,uncertainty_available:true,strong_correlations:[],warnings:[]}};
const mounted:Array<{unmount:()=>void}>=[];
function workbench(){const w=mount(XpsWorkbench,{props:{x,y,source}});mounted.push(w);return w;}
beforeEach(()=>{vi.clearAllMocks();vi.mocked(api.fitXps).mockResolvedValue(result);vi.mocked(api.previewXps).mockResolvedValue(preview);});
afterEach(()=>mounted.splice(0).forEach(w=>w.unmount()));
describe("XPS 页面行为",()=>{
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
    await w.get('[data-test="xps-preview"]').trigger("click");await flushPromises();await w.get('[data-test="xps-confirm"]').setValue(true);
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
