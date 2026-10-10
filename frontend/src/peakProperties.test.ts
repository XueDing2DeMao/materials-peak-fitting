import {afterEach,describe,expect,it,vi} from "vitest";
import {mount} from "@vue/test-utils";
import ResultsPanel from "./components/ResultsPanel.vue";
import FitControls from "./components/FitControls.vue";
import {createConfig,addComponent,makeDoublet,changeComponentModel,loadConfiguration,validateConstraints,shiftConfiguration} from "./xpsState";
import {overallWidthText} from "./peakGeometry";

const x=[0,1,2,3,4],y=[1,3,8,3,1],source={filename:'X.xlsx',file_sha256:'a'.repeat(64),sheet:'谱',x_column:'E',y_column:'I'};
const mounted:Array<{unmount:()=>void}>=[];
afterEach(()=>mounted.splice(0).forEach(w=>w.unmount()));
const result:any={x,raw_y:y,parameters:{wG:{value:1,standard_error:null},wL:{value:4,standard_error:null}},statistics:{r_squared:1,rmse:0,sse:0,adjusted_r_squared:1},model:'psd_voigt2',converged:true,message:'done'};
describe('峰性质和非对称模型交互',()=>{
  it('整体宽度与分量宽度分开，旧结果不猜测整体宽度',()=>{
    expect(overallWidthText(result,'°')).toContain('未计算');
    const r={...result,peak_geometry:{fwhm:2.34,peak_position:2,peak_height:5,area_total:10,area_in_range:8,area_fraction_in_range:.8,hwhm_low:1.17,hwhm_high:1.17,halfmax_low:.83,halfmax_high:3.17,range_start:0,range_end:4,halfmax_within_range:true,reasons:{},warnings:[],area_method:'模型积分',width_method:'连续模型半高交点',uncertainty_note:'未计算派生量标准误'}};
    expect(overallWidthText(r,'°')).toContain('2.34000');
    const w=mount(ResultsPanel,{props:{result:r,analysisMode:'xrd'}});mounted.push(w);
    expect(w.text()).toContain('整体 FWHM');expect(w.text()).toContain('模型全域面积');expect(w.text()).toContain('区间覆盖比例');expect(w.text()).toContain('Gaussian 分量');
  });
  it('新增模型可在单峰设置中选择并发出相应参数',async()=>{
    const w=mount(FitControls,{props:{x,y}});mounted.push(w);
    await w.get('[data-test="control-tab-peak"]').trigger('click');
    const emg=w.findAll('button').find(b=>b.text().includes('EMG（高 X 拖尾）'))!;
    expect(emg).toBeDefined();await emg.trigger('click');
    expect(w.text()).toContain('尾尺度');expect(w.text()).toContain('高斯核标准差');
  });
  it('扩展模型比较需用户主动启用',async()=>{
    const w=mount(ResultsPanel,{props:{result}});mounted.push(w);
    await w.get('[data-test="compare-models"]').trigger('click');expect(w.emitted('compare')?.at(-1)).toEqual([false]);
    await w.get('[data-test="include-asymmetric"]').setValue(true);
    await w.get('[data-test="compare-models"]').trigger('click');expect(w.emitted('compare')?.at(-1)).toEqual([true]);
  });
  it('XPS 模型切换更新参数和版本，有冲突约束时不改变状态',()=>{
    const c=createConfig(x,y,source);addComponent(c);changeComponentModel(c,'p1','emg_high');
    expect(c.schema_version).toBe(2);expect(Object.keys(c.components[0].parameters)).toEqual(['A','xc','sigma','tau']);validateConstraints(c);
    const old=JSON.parse(JSON.stringify(c));shiftConfiguration(c,3);
    expect(c.components[0].parameters.xc!.value).toBe(old.components[0].parameters.xc.value+3);
    expect(c.components[0].parameters.sigma).toEqual(old.components[0].parameters.sigma);
    expect(c.components[0].parameters.tau).toEqual(old.components[0].parameters.tau);
    const pair=createConfig(x,y,source);makeDoublet(pair,1,.5);const before=JSON.stringify(pair);
    expect(()=>changeComponentModel(pair,'p1','emg_low')).toThrow(/解除/);expect(JSON.stringify(pair)).toBe(before);
  });
  it('版本 2 配置和结果均能加载，版本伪装和冲突不能绕过',()=>{
    const c=createConfig(x,y,source);addComponent(c);changeComponentModel(c,'p1','split_psd_voigt');
    expect(loadConfiguration({schema_version:2,request:c},x,y,source)).toEqual(c);
    expect(loadConfiguration({configuration:c},x,y,source)).toEqual(c);
    expect(()=>loadConfiguration({schema_version:1,request:c},x,y,source)).toThrow(/不一致/);
    expect(()=>loadConfiguration({configuration:{...c,schema_version:1}},x,y,source)).toThrow(/版本 2/);
    expect(()=>loadConfiguration({configuration:{...c,schema_version:3}},x,y,source)).toThrow(/不支持/);
  });
});
