import { describe, expect, it } from 'vitest';
import { csv } from './resultExport';
import { batchRows, batchTrendRows } from './batchExport';
import { BatchRunner } from './batchRunner';
import { createMultiConfig, addMultiComponent } from './multipeakState';
describe('实际批次导出',()=>{
  it('趋势导出保留零值、缺失与原始精度，并使用实际峰顶和统一条件轴',()=>{
    const result:any={converged:true,components:[{id:'p1',peak_geometry:{peak_position:0,fwhm:.123456789},area_window:20,area_total:25,parameters:{xc:{value:99}}}],statistics:{},diagnostics:{identifiable:true,warnings:[],strong_correlations:[]}};
    const rows:any[]=['success','failed','skipped','pending','review'].map((status,i)=>({id:String(i),label:'=样品,"A"',status,request:{components:[{id:'p1'}]},result,attempts:[]}));
    const options={peak:'p1',metric:'position' as const,axis:'condition' as const,unit:'eV'};
    const data=batchTrendRows(rows,{},options);
    expect(data[0]).toEqual(['task_id','label','sequence','sample_id','replicate_id','peak_id','metric','axis','axis_name','axis_unit','x','value','value_unit','status']);
    expect(data.slice(1).map(r=>r[11])).toEqual([0,null,null,null,0]);
    expect(data[1].slice(7,13)).toEqual(['sequence','执行序号','',1,0,'eV']);
    expect(csv(data)).toContain("'=样品");
    const metadata=Object.fromEntries(rows.map((r,i)=>[r.id,{sample_id:'样品',replicate_id:String(i),condition_name:'温度',condition_unit:'K',condition_value:300-i}]));
    const width=batchTrendRows(rows,metadata,{...options,metric:'fwhm'});
    expect(width[1].slice(7,13)).toEqual(['condition','温度','K',300,.123456789,'eV']);
    expect(width.slice(1).map(r=>r[10])).toEqual([300,299,298,297,296]);
    expect(batchTrendRows(rows,{}, {...options,metric:'area_window'})[1].slice(11,13)).toEqual([20,'Y × eV']);
    expect(batchTrendRows(rows,{}, {...options,metric:'area_total'})[1][11]).toBe(25);
  });
  it('失败尝试和空结果保留来源，不填零或启动求解',async()=>{
    const c=createMultiConfig([0,1,2,3],[0,1,2,0],null,'general');addMultiComponent(c);
    const run=new BatchRunner([{id:'a',label:'=bad,"name"',request:c}],async()=>{throw new Error('求解失败');});
    await run.start();const rows=batchRows(run,'parameters'),curves=batchRows(run,'curves');
    expect(rows.some(r=>r.includes('求解失败'))).toBe(true);expect(csv(rows)).toContain("'=bad");
    expect(curves[1].length).toBe(curves[0].length);expect(curves[1].at(-1)).toBe('求解失败');
    expect(run.rows[0].attempts).toHaveLength(2);
  });
  it('CSV 转义换行与引号，保留负数值',()=>{
    expect(csv([['x','a"b\nc',-2,'=1+1']])).toBe('\ufeff"x","a""b\nc","-2","\'=1+1"');
  });
});
