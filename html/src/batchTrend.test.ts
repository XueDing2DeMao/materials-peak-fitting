import { describe,expect,it } from 'vitest';
import { conditionAxis,constantTrendRange,emptyMetadata,trendPoints } from './batchTrend';
function row(id:string,status='success'):any{
  const result={converged:true,components:[{id:'p2',label:'第二峰',area_window:20,area_total:25,fwhm:99,peak_geometry:{peak_position:5,fwhm:.4,warnings:[]},parameters:{}}],statistics:{},diagnostics:{identifiable:true,uncertainty_available:true,warnings:[],strong_correlations:[]}};
  return {id,label:id,status,request:{components:[{id:'p2',label:'第二峰'}]},result,accepted_attempt_id:null,attempts:[{id:'a',result,invalidated:false,manually_accepted:false,warnings:[]}]};
}
describe('批量峰趋势',()=>{
  it('常数和浮点尾差序列使用可读坐标范围，实际变化与原始值不改写',()=>{
    const values=[1.5,1.5+Number.EPSILON,null];
    const range=constantTrendRange(values)!;expect(range[0]).toBeLessThan(1.49);expect(range[1]).toBeGreaterThan(1.51);
    expect(constantTrendRange([0,0])).toEqual([-.02,.02]);expect(constantTrendRange([null])).toBeUndefined();
    expect(constantTrendRange([1,2])).toBeUndefined();expect(values[1]).toBe(1.5+Number.EPSILON);
  });
  it('按峰 ID 获取连续性质，零值保留，失败、跳过、缺失及失效均不填零',()=>{
    const rows=[row('a'),row('b','failed'),row('c','skipped'),row('d'),row('e','pending')];
    rows[0].result.components[0].peak_geometry.peak_position=0;delete rows[3].result.components[0].peak_geometry;
    rows[4].attempts[0].invalidated=true;
    expect(trendPoints(rows,'p2','position',{},'sequence').map(p=>p.value)).toEqual([0,null,null,null,null]);
    expect(trendPoints(rows,'p2','fwhm',{},'sequence')[3].value).toBeNull();
    expect(trendPoints(rows,'missing','area_window',{},'sequence')[0].value).toBeNull();
    expect(trendPoints(rows,'p2','area_total',{},'sequence')[0].value).toBe(25);
  });
  it('人工接受与诊断并存，保留身份用于选点定位',()=>{
    const r=row('accepted');r.accepted_attempt_id='a';r.attempts[0].manually_accepted=true;r.result.diagnostics.lag1_correlation=.8;
    const p=trendPoints([r],'p2','fwhm',{},'sequence')[0];expect(p.status).toContain('人工接受');expect(p.status).toContain('警告');expect(p.rowId).toBe('accepted');expect(p.peakId).toBe('p2');
    r.status='review';r.attempts[0].manually_accepted=false;expect(trendPoints([r],'p2','fwhm',{},'sequence')[0].status).toContain('待复核');
  });
  it('条件轴必须全部有有限数值且名称和单位一致，不换算单位、不合并重复实验',()=>{
    const a={...emptyMetadata(),sample_id:'样品A',condition_name:'温度',condition_value:25,condition_unit:'°C',replicate_id:'1'};
    const b={...a,replicate_id:'2'};expect(conditionAxis([a,b]).available).toBe(true);
    expect(conditionAxis([a,{...b,condition_unit:'K'}]).available).toBe(false);
    expect(conditionAxis([a,{...b,condition_name:'时间'}]).available).toBe(false);
    expect(conditionAxis([a,emptyMetadata()]).available).toBe(false);expect(conditionAxis([]).available).toBe(false);
    expect(conditionAxis([a,{...b,condition_value:NaN}]).available).toBe(false);
    expect(trendPoints([row('a'),row('b')],'p2','position',{a,b},'condition').map(p=>p.x)).toEqual([25,25]);
  });
});
