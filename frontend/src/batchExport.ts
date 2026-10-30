import { experimentArchive } from './batchExperimentArchive';
import { conditionAxis, emptyMetadata, trendPoints, type MetadataByTask, type TrendMetric } from './batchTrend';
import type { BatchRow } from './batchTypes';
import type { BatchRunner } from './batchRunner';
import { csv, saveFile } from './resultExport';
type BatchSnapshot=Pick<BatchRunner,'id'|'status'|'sequential'|'rows'>;
type TrendOptions={peak:string;metric:TrendMetric;axis:'sequence'|'condition';unit:string};
export function batchTrendRows(rows:BatchRow[],metadata:MetadataByTask,options:TrendOptions):unknown[][]{
  const condition=conditionAxis(rows.map(row=>metadata[row.id]??emptyMetadata()));
  const axis=options.axis==='condition'&&condition.available?'condition':'sequence';
  const first=metadata[rows[0]?.id]??emptyMetadata();
  const valueUnit=options.metric.startsWith('area')?`Y × ${options.unit}`:options.unit;
  return [
    ['task_id','label','sequence','sample_id','replicate_id','peak_id','metric','axis','axis_name','axis_unit','x','value','value_unit','status'],
    ...trendPoints(rows,options.peak,options.metric,metadata,axis).map(point=>[
      point.rowId,point.label,point.index,point.sample,point.replicate,point.peakId,options.metric,axis,
      axis==='condition'?first.condition_name.trim():'执行序号',axis==='condition'?first.condition_unit.trim():'',
      point.x,point.value,valueUnit,point.status,
    ]),
  ];
}
export function exportBatchTrend(rows:BatchRow[],metadata:MetadataByTask,options:TrendOptions){
  const data=batchTrendRows(rows,metadata,options);
  const name=`batch-trend-${options.peak}-${options.metric}-${data[1]?.[7]??'sequence'}`.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_');
  saveFile(`${name}.csv`,csv(data));
}
export function batchRows(run:BatchSnapshot,kind:'parameters'|'curves'):unknown[][]{
  const head=['task_id','label','status','attempt_id','initialization_source','parent_task_id','parent_attempt_id','invalidated','manually_accepted','accepted_attempt_id'];
  const ids=run.rows[0].request.components.filter(c=>c.enabled).map(c=>c.id);
  const rows:unknown[][]=[kind==='parameters'?[...head,'component_id','parameter','value','standard_error','reason']:[...head,'point_index','x','raw_y','baseline','total_y','residual',...ids.map(id=>`peak:${id}`),'error']];
  for(const row of run.rows){
    if(!row.attempts.length){rows.push([row.id,row.label,row.status]);continue;}
    for(const a of row.attempts){
      const base=[row.id,row.label,row.status,a.id,a.initialization_source,a.parent_task_id,a.parent_attempt_id,a.invalidated,a.manually_accepted,row.accepted_attempt_id];
      if(!a.result){rows.push(kind==='parameters'?[...base,'','error',a.error]:[...base,...Array(6+ids.length).fill(null),a.error]);continue;}
      const r=a.result;
      if(kind==='parameters'){
        for(const c of r.components){for(const [name,p] of Object.entries(c.parameters))rows.push([...base,c.id,name,p.value,p.standard_error,p.uncertainty_reason]);
          for(const [name,value] of Object.entries({area_total:c.area_total,area_window:c.area_window,fwhm:c.fwhm,height:c.height,area_fraction_window:c.area_fraction_window}))rows.push([...base,c.id,name,value,null,'派生性质未计算标准误']);}
        for(const [name,value] of Object.entries(r.statistics))rows.push([...base,'',name,value]);
        rows.push([...base,'','converged',r.converged]);if(a.error)rows.push([...base,'','error',a.error]);
        for(const warning of [...r.diagnostics.warnings,...a.warnings])rows.push([...base,'','warning',warning]);
      }else{
        const curves=new Map(r.components.map(c=>[c.id,c.y]));
        r.x.forEach((x,i)=>rows.push([...base,i,x,r.raw_y[i],r.baseline[i],r.total_y[i],r.residuals[i],...ids.map(id=>curves.get(id)?.[i]??null),a.error]));
      }
    }
  }
  return rows;
}
export function exportBatch(run:BatchSnapshot,kind:'parameters'|'curves'|'json',metadata:MetadataByTask={}){
  if(kind==='json'){saveFile('batch-results.json',JSON.stringify(experimentArchive(run,metadata),null,2),'application/json');return;}
  saveFile(`batch-${kind}.csv`,csv(batchRows(run,kind)));
}
