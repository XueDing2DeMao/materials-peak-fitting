import { describe,expect,it } from 'vitest';
import { hasCorrelatedResiduals,resultDiagnostics } from './resultDiagnostics';
import { presentSinglePeak } from './resultPresentation';
const single=()=>({converged:true,parameters:{A:{value:1.234567891,standard_error:.1}},statistics:{r_squared:1,rmse:0,sse:0},analysis_metadata:{},peak_geometry:{peak_position:2,fwhm:1,area_total:10,area_in_range:8,reasons:{},warnings:[]}} as any);
describe('计算、诊断与人工状态',()=>{
  it('残差门禁严格沿用后端阈值且排除缺失与非有限值',()=>{
    expect([null,undefined,NaN,.5,-.5].map(hasCorrelatedResiduals)).toEqual([false,false,false,false,false]);expect(hasCorrelatedResiduals(.50001)).toBe(true);expect(hasCorrelatedResiduals(-.6)).toBe(true);
  });
  it('固定参数计算不显示优化收敛，人工接受也不抹去外推警告',()=>{
    const r=single();r.parameters.A.fixed=true;r.peak_geometry.warnings=['半高点超出拟合区间'];const d=resultDiagnostics(r,{accepted:true});
    expect(d.calculation).toBe('固定参数计算');expect(d.review).toBe('人工接受');expect(d.diagnostic).toBe('有警告');expect(d.warnings).toContain('半高点超出拟合区间');
  });
  it('单峰展示适配区分区间和全域面积，不修改原始数值与标准误',()=>{
    const r=single(),before=JSON.stringify(r),p=presentSinglePeak(r,'p4','样品峰');
    expect(p.areaTotal).toBe(10);expect(p.areaWindow).toBe(8);expect(p.parameters.A.value).toBe(1.234567891);expect(JSON.stringify(r)).toBe(before);
    delete r.peak_geometry;expect(presentSinglePeak(r).areaWindow).toBeNull();expect(presentSinglePeak(r).geometry).toBeUndefined();
  });
});
