import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createConfig, addComponent, makeDoublet, removeComponent, loadConfiguration, RevisionGate, chartTraces, validateConstraints } from "./xpsState";

const x = [90, 95, 100, 105, 110];
const y = [2, 3, 10, 6, 3];
const source = { filename: "XPS.xlsx", file_sha256: "a".repeat(64), sheet: "Ge2p", x_column: "E", y_column: "I" };

describe("XPS 状态与可复现配置", () => {
  it("默认初值来自当前能区的净信号，区间外高值不影响初值",()=>{
    const c=createConfig([0,45,50,55,100],[1000,1000,1100,1000,1000],source);c.range_start=45;c.range_end=55;c.background.low_level=1000;c.background.high_level=1000;
    const first=addComponent(c);c.y[0]=1e6;const second=addComponent(c);
    expect(second.parameters.A!.value).toBe(first.parameters.A!.value);
    expect(first.parameters.A!.value).toBeLessThan(1000);
    c.background.kind="shirley";expect(()=>addComponent(c)).toThrow(/预览/);
  });
  it("双峰以结构化关系创建，删除成员清理关系和空组", () => {
    const config = createConfig(x, y, source);
    makeDoublet(config, 4.6, .5);
    expect(config.components).toHaveLength(2);
    expect(config.constraints.map(c => [c.target.parameter, c.kind, c.value])).toEqual([["xc", "offset", 4.6], ["A", "ratio", .5], ["w", "ratio", 1]]);
    expect(()=>removeComponent(config, config.components[1].id)).toThrow(/解除/);
    config.constraints=[];
    removeComponent(config, config.components[1].id);
    expect(config.constraints).toHaveLength(0);
    expect(config.groups[0].component_ids).toHaveLength(1);
    removeComponent(config, config.components[0].id);
    expect(config.groups).toHaveLength(0);
  });
  it("前端阻止循环、固定冲突与不可满足子参数边界",()=>{
    const c=createConfig(x,y,source);makeDoublet(c,4.6,.5);validateConstraints(c);
    c.constraints.push({source:{component:"p2",parameter:"xc"},target:{component:"p1",parameter:"xc"},kind:"offset",value:-4.6});
    expect(()=>validateConstraints(c)).toThrow(/循环/);c.constraints.pop();
    c.components[0].parameters.A={value:100,fixed:true};c.components[1].parameters.A={value:70,fixed:true};
    expect(()=>validateConstraints(c)).toThrow(/固定/);
    c.components[1].parameters.A!.value=50;c.components[0].parameters.xc!.upper=95;c.components[1].parameters.xc!.lower=108;
    expect(()=>validateConstraints(c)).toThrow(/边界/);
  });
  it("新配置或更新请求使旧异步结果失效", () => {
    const gate = new RevisionGate();
    const first = gate.start("fit");
    const second = gate.start("fit");
    expect(gate.current(first)).toBe(false);
    expect(gate.current(second)).toBe(true);
    gate.invalidate();
    expect(gate.current(second)).toBe(false);
  });
  it("加载配置必须匹配原文件、谱列和原数据，并不信任内嵌结果", () => {
    const request = createConfig(x,y,source);
    const artifact = {schema_version:1, request, result:{converged:true}};
    expect(loadConfiguration(artifact,x,y,source)).toEqual(request);
    expect(() => loadConfiguration(artifact,x,y,{...source,y_column:"other"})).toThrow(/不匹配/);
    expect(() => loadConfiguration(artifact,x,[2,3,11,6,3],source)).toThrow(/数据/);
    expect(() => loadConfiguration({...artifact,schema_version:2},x,y,source)).toThrow(/版本/);
  });
  it("载入实际 Shirley 结果文件中的配置，忽略旧拟合结果", () => {
    const artifact = JSON.parse(readFileSync(resolve(__dirname,"../../data/analysis/xps_implementation_20260920/ge2p-shirley-result.json"), "utf8"));
    const request = artifact.configuration;
    const loaded = loadConfiguration({...artifact,total_y:[-999],converged:false},request.x,request.y,request.source);
    expect(loaded).toEqual(request);
    expect(loaded).not.toBe(request);
    expect(loaded).not.toHaveProperty("total_y");
    validateConstraints(loaded);
    loaded.components[0].parameters.A!.value = 123;
    expect(request.components[0].parameters.A.value).not.toBe(123);
  });
  it.each(["配置文件", "结果文件"])("%s仍严格核对来源、原数组和版本", format => {
    const request = createConfig(x,y,source);
    const wrap = (configuration:unknown) => format === "配置文件" ? {schema_version:1,request:configuration} : {configuration};
    expect(() => loadConfiguration(wrap(request),x,y,{...source,sheet:"数据"})).toThrow(/XPS.xlsx.*Ge2p.*E.*I/);
    expect(() => loadConfiguration(wrap(request),x,y,{...source,file_sha256:"b".repeat(64)})).toThrow(/不匹配/);
    expect(() => loadConfiguration(wrap(request),x,[2,3,11,6,3],source)).toThrow(/原始数据/);
    expect(() => loadConfiguration(wrap({...request,schema_version:3}),x,y,source)).toThrow(/版本.*3.*1/);
  });
  it("非配置 JSON 和损坏结构不误报为版本不支持，也不回退绕过外层版本", () => {
    for(const artifact of [null,[],"text",{statistics:{}},{schema_version:1,request:null},{configuration:{}}]) {
      expect(() => loadConfiguration(artifact,x,y,source)).toThrow(/配置.*(?:结构|缺少|未找到)/);
      expect(() => loadConfiguration(artifact,x,y,source)).not.toThrow(/不支持的配置版本/);
    }
    const request=createConfig(x,y,source);
    expect(() => loadConfiguration({schema_version:3,request,configuration:request},x,y,source)).toThrow(/版本.*3.*1/);
  });
  it("原谱、固定背景、各净峰及总谱都有独立图层", () => {
    const data:any = {x,raw_y:y,baseline:[1,1,1,1,1],total_y:y,components:[{id:"p1",label:"峰1",y:[1,2,9,5,2]}]};
    const traces = chartTraces(x,y,data,data);
    expect(traces.map(t => t.name)).toEqual(["原始谱", "固定背景", "总拟合", "峰1（净峰）"]);
    expect(traces[3].y).toEqual([1,2,9,5,2]);
  });
});
