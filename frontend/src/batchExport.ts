import { experimentArchive } from './batchExperimentArchive';
import { conditionAxis, emptyMetadata, trendPoints, trendUnit, type MetadataByTask, type TrendMetric } from './batchTrend';
import type { BatchRow } from './batchTypes';
import type { BatchRunner } from './batchRunner';
import { csv, saveFile } from './resultExport';
import { isMulti } from './fitAdapter';
import { spectrumUnits, quantityUnit } from './spectrumUnits';
import type { XpsParameterResult } from './xpsTypes';
import { derivedUncertainty } from './peakGeometry';
type BatchSnapshot=Pick<BatchRunner,'id'|'status'|'sequential'|'rows'>;
type TrendOptions={peak:string;metric:TrendMetric;axis:'sequence'|'condition';unit:string};
export function batchTrendRows(rows:BatchRow[],metadata:MetadataByTask,options:TrendOptions):unknown[][]{
  const condition=conditionAxis(rows.map(row=>metadata[row.id]??emptyMetadata()));
  const axis=options.axis==='condition'&&condition.available?'condition':'sequence';
  const first=metadata[rows[0]?.id]??emptyMetadata();
  return [
    ['task_id','label','sequence','sample_id','replicate_id','peak_id','metric','axis','axis_name','axis_unit','x','value','value_unit','status'],
    ...trendPoints(rows,options.peak,options.metric,metadata,axis).map((point,index)=>[
      point.rowId,point.label,point.index,point.sample,point.replicate,point.peakId,options.metric,axis,
      axis==='condition'?first.condition_name.trim():'执行序号',axis==='condition'?first.condition_unit.trim():'',
      point.x,point.value,trendUnit(rows[index],options.metric,options.unit),point.status,
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
  const peakIds=new Set<string>();
  if(kind==='curves')for(const row of run.rows){
    for(const c of row.request.components)if(c.enabled)peakIds.add(c.id);
    for(const attempt of row.attempts)for(const c of attempt.result?.components??[])peakIds.add(c.id);
  }
  const ids=[...peakIds];
  const header=kind==='parameters'?[...head,'component_id','parameter','value','standard_error','reason','ci95_lower','ci95_upper','unit']:[...head,'point_index','x','raw_y','baseline','total_y','residual',...ids.map(id=>`peak:${id}`),'error','x_unit','y_unit'];
  const rows:unknown[][]=[header];
  for(const row of run.rows){
    for(const a of row.attempts.length?row.attempts:[null]){
      const base=[row.id,row.label,row.status,a?.id,a?.initialization_source,a?.parent_task_id,a?.parent_attempt_id,a?.invalidated,a?.manually_accepted,row.accepted_attempt_id];
      const request=a?.request??row.request;
      const units=spectrumUnits(isMulti(request)?request.analysis_mode:'xps',request.source);
      if(!a?.result){
        const message=a?.error||'尚无拟合结果';
        rows.push(kind==='parameters'?[...base,'',a?.error?'error':'status',message,null,null,null,null,null]:[...base,...Array(6+ids.length).fill(null),message,units.x,units.y]);
        continue;
      }
      const r=a.result;
      if(kind==='parameters'){
        const add=(id:string,name:string,value:unknown,p?:Pick<XpsParameterResult,'standard_error'|'confidence_interval'|'uncertainty_reason'>)=>{
          const ci=p?.confidence_interval;
          const missing=p?.uncertainty_reason??(p&&!ci?'结果未记录 95% 置信区间':null);
          rows.push([...base,id,name,value,p?.standard_error??null,missing,ci?.[0]??null,ci?.[1]??null,quantityUnit(name,units)]);
        };
        for(const c of r.components){
          for(const [name,p] of Object.entries(c.parameters))add(c.id,name,p.value,p);
          for(const [name,value] of Object.entries({area_total:c.area_total,area_window:c.area_window,fwhm:c.fwhm,height:c.height,area_fraction_window:c.area_fraction_window})){
            const uncertainty=derivedUncertainty(c,name);
            add(c.id,name,value,{...uncertainty,uncertainty_reason:uncertainty.reason});
          }
        }
        for(const [name,value] of Object.entries(r.statistics))add('',name,value);
        add('','converged',r.converged);if(a.error)add('','error',a.error);
        for(const warning of [...r.diagnostics.warnings,...a.warnings])add('','warning',warning);
      }else{
        const curves=new Map(r.components.map(c=>[c.id,c.y]));
        r.x.forEach((x,i)=>rows.push([...base,i,x,r.raw_y[i],r.baseline[i],r.total_y[i],r.residuals[i],...ids.map(id=>curves.get(id)?.[i]??null),a.error,units.x,units.y]));
      }
    }
  }
  return rows;
}
export function exportBatch(run:BatchSnapshot,kind:'parameters'|'curves'|'json',metadata:MetadataByTask={}){
  if(kind==='json'){saveFile('batch-results.json',JSON.stringify(experimentArchive(run,metadata),null,2),'application/json');return;}
  saveFile(`batch-${kind}.csv`,csv(batchRows(run,kind)));
}
