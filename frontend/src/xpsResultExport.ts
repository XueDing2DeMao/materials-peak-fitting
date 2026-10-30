import {csv,saveFile} from './resultExport';
import type {XpsResult,XpsParameterResult} from './xpsTypes';

// 这些字段已由求解器返回；局部读取附加信息，保持现有接口与文件列名。
type ExportResult=XpsResult & {net_total?:number[]};
type ExportParameter=XpsParameterResult & {lower?:number|null;upper?:number|null};
const booleanText=(value:boolean)=>value?'True':'False';
const areaKeys=['area_total','area_window','area_fraction_window'] as const;

export function xpsExportRows(kind:'curves'|'parameters',result:XpsResult):unknown[][]{
  if(kind==='curves'){
    const net=(result as ExportResult).net_total;
    return [
      ['energy_raw_eV','binding_energy_eV','raw_y','baseline','total_y','residual','net_total',...result.components.map(c=>`component_${c.id}`)],
      ...result.x.map((x,i)=>[result.x_raw[i],x,result.raw_y[i],result.baseline[i],result.total_y[i],result.residuals[i],net?.[i]??result.components.reduce((sum,c)=>sum+c.y[i],0),...result.components.map(c=>c.y[i])]),
    ];
  }
  const rows:unknown[][]=[['component','label','parameter','value','standard_error','uncertainty_reason','linked_to','fixed','bound','model','lower','upper','state']];
  for(const c of result.components){
    for(const [name,parameter] of Object.entries(c.parameters)){
      const p=parameter as ExportParameter;
      const state=p.linked_to?(p.fixed?'linked_fixed':'linked'):(p.fixed?'fixed':'free');
      rows.push([c.id,c.label,name,p.value,p.standard_error,p.uncertainty_reason,p.linked_to,booleanText(p.fixed),booleanText(p.bound),c.model,p.lower,p.upper,state]);
    }
    for(const name of [...areaKeys,'height','fwhm'] as const)rows.push([c.id,c.label,name,c[name]]);
  }
  for(const group of result.groups)for(const name of areaKeys)rows.push([group.id,group.label,name,group[name]]);
  rows.push([],['metric','value'],...Object.entries(result.statistics),['converged',booleanText(result.converged)],['identifiable',booleanText(result.diagnostics.identifiable)],['data_sha256',result.data_sha256],['configuration_json',JSON.stringify(result.configuration)],[],['component','property','value','unit','reason']);
  for(const c of result.components){
    const geometry=c.peak_geometry;if(!geometry)continue;
    for(const [key,value] of Object.entries(geometry)){
      if(key==='reasons'||key==='warnings')continue;
      const unit=['area_total','area_in_range'].includes(key)?'Y 单位 × X 单位':key==='peak_height'?'Y 单位':key==='area_fraction_in_range'?'无量纲':['peak_position','fwhm','hwhm_low','hwhm_high','halfmax_low','halfmax_high','range_start','range_end'].includes(key)?'X 单位':'';
      rows.push([c.id,`geometry.${key}`,typeof value==='boolean'?booleanText(value):value,unit,geometry.reasons[key]??'']);
    }
    for(const warning of geometry.warnings)rows.push([c.id,'geometry.warning',warning,'','']);
  }
  return rows;
}

export function exportXpsResult(kind:'curves'|'parameters'|'configuration',result:XpsResult){
  if(kind==='configuration'){
    saveFile('xps-configuration.json',JSON.stringify({schema_version:result.configuration.schema_version,application:'peak-fitting-xps',request:result.configuration,result},null,2),'application/json');
  }else saveFile(`xps-${kind}.csv`,csv(xpsExportRows(kind,result)));
}
