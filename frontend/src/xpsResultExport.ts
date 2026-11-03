import {csv,saveFile} from './resultExport';
import {quantityUnit,spectrumUnits} from './spectrumUnits';
import {derivedUncertainty,peakHeightUncertainty} from './peakGeometry';
import type {XpsResult,XpsParameterResult} from './xpsTypes';

// 这些字段已由求解器返回；局部读取附加信息，保持现有接口与文件列名。
type ExportResult=XpsResult & {net_total?:number[]};
type ExportParameter=XpsParameterResult & {lower?:number|null;upper?:number|null};
const booleanText=(value:boolean)=>value?'True':'False';
const areaKeys=['area_total','area_window','area_fraction_window'] as const;

export function xpsExportRows(kind:'curves'|'parameters',result:XpsResult):unknown[][]{
  const units=spectrumUnits('xps',result.configuration.source);
  if(kind==='curves'){
    const net=(result as ExportResult).net_total;
    return [
      ['energy_raw_eV','binding_energy_eV','raw_y','baseline','total_y','residual','net_total',...result.components.map(c=>`component_${c.id}`),'x_unit','y_unit'],
      ...result.x.map((x,i)=>[result.x_raw[i],x,result.raw_y[i],result.baseline[i],result.total_y[i],result.residuals[i],net?.[i]??result.components.reduce((sum,c)=>sum+c.y[i],0),...result.components.map(c=>c.y[i]),units.x,units.y]),
    ];
  }
  const rows:unknown[][]=[['component','label','parameter','value','standard_error','uncertainty_reason','linked_to','fixed','bound','model','lower','upper','state','unit','ci95_lower','ci95_upper']];
  function derivedRow(id:string,label:string,name:string,value:number|null,component?:XpsResult['components'][number]){
    const u=component?derivedUncertainty(component,name):null;
    return [id,label,name,value,u?.standard_error??null,u?.reason??null,null,null,null,null,null,null,null,quantityUnit(name,units),...(u?.confidence_interval??[null,null])];
  }
  for(const c of result.components){
    for(const [name,parameter] of Object.entries(c.parameters)){
      const p=parameter as ExportParameter;
      const state=p.linked_to?(p.fixed?'linked_fixed':'linked'):(p.fixed?'fixed':'free');
      rows.push([c.id,c.label,name,p.value,p.standard_error,p.uncertainty_reason,p.linked_to,booleanText(p.fixed),booleanText(p.bound),c.model,p.lower,p.upper,state,quantityUnit(name,units),...(p.confidence_interval??[null,null])]);
    }
    for(const name of [...areaKeys,'height','fwhm'] as const)rows.push(derivedRow(c.id,c.label,name,c[name],c));
  }
  for(const group of result.groups)for(const name of areaKeys)rows.push(derivedRow(group.id,group.label,name,group[name]));
  rows.push([],['metric','value','unit'],...Object.entries(result.statistics).map(([name,value])=>[name,value,quantityUnit(name,units)]),['converged',booleanText(result.converged)],['identifiable',booleanText(result.diagnostics.identifiable)],['data_sha256',result.data_sha256],['configuration_json',JSON.stringify(result.configuration)],[],['component','property','value','unit','reason','standard_error','ci95_lower','ci95_upper']);
  for(const c of result.components){
    const geometry=c.peak_geometry;if(!geometry)continue;
    for(const [key,value] of Object.entries(geometry)){
      if(key==='reasons'||key==='warnings'||key==='peak_height_uncertainty')continue;
      const unit=quantityUnit(key,units);
      const u=key==='peak_height'?peakHeightUncertainty(geometry):null;
      rows.push([c.id,`geometry.${key}`,typeof value==='boolean'?booleanText(value):value,unit,u?.reason??geometry.reasons[key]??'',...(u?[u.standard_error,...(u.confidence_interval??[null,null])]:[])]);
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
