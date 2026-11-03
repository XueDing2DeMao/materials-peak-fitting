import { describe, expect, it } from 'vitest';
import { csv } from './resultExport';
import { batchRows, batchTrendRows } from './batchExport';
import { BatchRunner } from './batchRunner';
import { createMultiConfig, addMultiComponent } from './multipeakState';
describe('实际批次导出',()=>{
  it('当前谱与整批逐行一致，参数和曲线保留各谱单位、区间、缺失原因及完整状态',()=>{
    const c=createMultiConfig([1,2,3,4],[1,3,2,1],{filename:'g.csv',file_sha256:'h',sheet:'data',x_column:'Wavenumber [cm^-1]',y_column:'Intensity (counts)'},'general');
    addMultiComponent(c);
    const par={value:2,standard_error:.1,confidence_interval:[1.8,2.2],uncertainty_reason:null};
    const component={id:c.components[0].id,model:'gaussian',parameters:{xc:par,A:{...par,value:4,confidence_interval:[3.8,4.2]},w:{...par,standard_error:null,confidence_interval:null,uncertainty_reason:'固定参数'}},area_total:4,area_window:3.7,fwhm:2,height:1,peak_geometry:{peak_height_uncertainty:{standard_error:.03,confidence_interval:[.94,1.06],reason:null}},area_fraction_window:1,y:[0,2,1,0]};
    const r={x:c.x,raw_y:c.y,baseline:[1,1,1,1],total_y:c.y,residuals:[0,0,0,0],components:[component],statistics:{rmse:0},diagnostics:{warnings:[]},converged:true};
    const attempt={id:'a1',request:c,result:r,warnings:[],error:''};
    const rows:any[]=[{id:'s1',label:'first',status:'success',request:c,attempts:[attempt]},{id:'s2',label:'waiting',status:'pending',request:c,attempts:[]},
      {id:'s3',label:'bad',status:'failed',request:c,attempts:[{...attempt,id:'a2',result:null,error:'无有效拟合'}]}];
    const run={id:'b',status:'done' as const,sequential:false,rows};
    for(const kind of ['parameters','curves'] as const){
      const [header,...items]=batchRows(run,kind);
      const by=(task:string)=>items.filter(row=>row[0]===task);
      expect(items.every(row=>row.length===header.length)).toBe(true);
      expect([...new Set(items.map(row=>row[0]))]).toEqual(['s1','s2','s3']);
      for(const row of rows)expect(batchRows({...run,rows:[row]},kind).slice(1)).toEqual(by(row.id));
      if(kind==='parameters'){
        const param=(k:string)=>by('s1').find(row=>row[header.indexOf('parameter')]===k)!;
        expect([param('xc')[header.indexOf('ci95_lower')],param('xc')[header.indexOf('ci95_upper')],param('xc')[header.indexOf('unit')]]).toEqual([1.8,2.2,'cm^-1']);
        expect(param('A')[header.indexOf('unit')]).toBe('counts × cm^-1');
        expect(param('w')[header.indexOf('reason')]).toBe('固定参数');
        for(const [alias,key] of [['area_total','A'],['fwhm','w']]){
          for(const field of ['value','standard_error','ci95_lower','ci95_upper','unit','reason'])expect(param(alias)[header.indexOf(field)]).toEqual(param(key)[header.indexOf(field)]);
        }
        expect(param('area_window')[header.indexOf('standard_error')]).toBeNull();
        expect(['value','standard_error','ci95_lower','ci95_upper','unit'].map(k=>param('height')[header.indexOf(k)])).toEqual([1,.03,.94,1.06,'counts']);
      }else{
        expect([by('s1')[0][header.indexOf('x_unit')],by('s1')[0][header.indexOf('y_unit')]]).toEqual(['cm^-1','counts']);
        expect(by('s1').map(row=>row[header.indexOf('raw_y')])).toEqual(c.y);
      }
      expect(by('s3')[0]).toContain('无有效拟合');
    }
  });
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
    rows[0].request.analysis_mode='general';
    rows[0].request.source={x_column:'波数 [cm^-1]',y_column:'强度 (counts)'};
    expect(batchTrendRows(rows,{}, {...options,metric:'area_total'})[1][12]).toBe('counts × cm^-1');
    rows[0].request.source=null;
    expect(batchTrendRows(rows,{}, {...options,metric:'area_total'})[1][12]).toBe('Y 单位 × X 单位');
  });
  it('失败尝试和空结果保留来源，不填零或启动求解',async()=>{
    const c=createMultiConfig([0,1,2,3],[0,1,2,0],null,'general');addMultiComponent(c);
    const run=new BatchRunner([{id:'a',label:'=bad,"name"',request:c}],async()=>{throw new Error('求解失败');});
    await run.start();const rows=batchRows(run,'parameters'),curves=batchRows(run,'curves');
    expect(rows.some(r=>r.includes('求解失败'))).toBe(true);expect(csv(rows)).toContain("'=bad");
    expect(curves[1].length).toBe(curves[0].length);expect(curves[1][curves[0].indexOf('error')]).toBe('求解失败');
    expect(run.rows[0].attempts).toHaveLength(2);
  });
  it('恢复的历史尝试和后续谱使用不同峰 ID 时不漏曲线，保留原 error 字段顺序',()=>{
    const c=createMultiConfig([1,2,3,4],[0,1,2,0],null,'general');addMultiComponent(c);
    const result=(id:string)=>({x:c.x,raw_y:c.y,total_y:c.y,baseline:[0,0,0,0],residuals:[0,0,0,0],components:[{id,y:c.y}]});
    const attempt=(id:string,invalidated=false)=>({id,result:result(id),request:c,invalidated});
    const rows:any[]=[{id:'s1',status:'success',request:c,attempts:[attempt('retired',true),attempt('p1')]},
      {id:'s2',status:'review',request:{...c,components:[{...c.components[0],id:'p2'}]},attempts:[attempt('p2')]}];
    const [header,...body]=batchRows({id:'b',status:'done',sequential:false,rows},'curves');
    expect(header.slice(-6)).toEqual(['peak:p1','peak:retired','peak:p2','error','x_unit','y_unit']);
    for(const id of ['p1','retired','p2']){
      const values=body.filter(row=>row[header.indexOf('attempt_id')]===id);
      expect(values.map(row=>row[header.indexOf('peak:'+id)])).toEqual(c.y);
      expect(values.every(row=>row[header.indexOf('peak:'+(id==='p2'?'retired':'p2'))]==null)).toBe(true);
    }
  });
  it('CSV 转义换行与引号，保留负数值',()=>{
    expect(csv([['x','a"b\nc',-2,'=1+1']])).toBe('\ufeff"x","a""b\nc","-2","\'=1+1"');
  });
});
