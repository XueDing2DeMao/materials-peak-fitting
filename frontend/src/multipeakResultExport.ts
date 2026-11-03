import type { MultiResult } from './multipeakTypes';
import { quantityUnit, spectrumUnits } from './spectrumUnits';
import { derivedUncertainty } from './peakGeometry';

export function multiExportRows(kind:'curves'|'parameters',result:MultiResult):unknown[][] {
  const units=spectrumUnits(result.configuration.analysis_mode,result.configuration.source);
  if(kind==='curves'){
    return [
      ['x','raw_y','baseline','total_y','residual',...result.components.map(c=>c.id),'x_unit','y_unit'],
      ...result.x.map((x,i)=>[x,result.raw_y[i],result.baseline[i],result.total_y[i],result.residuals[i],...result.components.map(c=>c.y[i]),units.x,units.y]),
    ];
  }
  const rows:unknown[][]=[['component_id','label','model','parameter','value','standard_error','reason','unit','ci95_lower','ci95_upper']];
  for(const c of result.components){
    for(const [name,p] of Object.entries(c.parameters)){
      rows.push([c.id,c.label,c.model,name,p.value,p.standard_error,p.uncertainty_reason,quantityUnit(name,units),...(p.confidence_interval??[null,null])]);
    }
    for(const name of ['area_total','area_window','fwhm','height'] as const){
      const u=derivedUncertainty(c,name);
      rows.push([c.id,c.label,c.model,name,c[name],u.standard_error,u.reason??'',quantityUnit(name,units),...(u.confidence_interval??[null,null])]);
    }
  }
  for(const [name,value] of Object.entries(result.statistics))rows.push(['','','',name,value,null,'',quantityUnit(name,units)]);
  rows.push(['','','','converged',result.converged]);
  for(const warning of result.diagnostics.warnings)rows.push(['','','','warning',warning]);
  return rows;
}
