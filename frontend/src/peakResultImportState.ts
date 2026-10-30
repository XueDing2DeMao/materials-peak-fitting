import type {MappingTemplate,NormalizedAnalysis,PeakMapping} from './peakRecordTypes';
export const clonePeak=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
export function mappingTemplate(name:string,mapping:PeakMapping):MappingTemplate{return {format:'peak-mapping',schema_version:1,name:name.trim()||'字段映射',mapping:clonePeak(mapping)};}
export function readMappingTemplate(text:string):MappingTemplate{
 const t=JSON.parse(text);if(t?.format!=='peak-mapping'||t.schema_version!==1||typeof t.name!=='string'||!t.mapping||!['wide','long'].includes(t.mapping.layout)||!t.mapping.columns||!t.mapping.units||t.mapping.template_version!==1)throw new Error('映射模板格式或版本无效');
 for(const [key,value] of Object.entries(t.mapping.columns)){if(['__proto__','constructor','prototype'].includes(key)||!['number','string'].includes(typeof value))throw new Error('映射列无效');}return t;
}
export function applyMappingTemplate(t:MappingTemplate,columns:string[]){
 const mapping=clonePeak(t.mapping);const missing=Object.values(mapping.columns).filter(c=>typeof c==='string'?!columns.includes(c):c<0||c>=columns.length).map(String);
 return {mapping,missing:[...new Set(missing)]};
}
export function mergeAnalyses(a:NormalizedAnalysis|null,b:NormalizedAnalysis):NormalizedAnalysis{
 if(!a)return clonePeak(b);const records=new Map(a.records.map(r=>[r.id,r]));for(const r of b.records)records.set(r.id,r);
 const spectra=new Map(a.spectra.map(s=>[s.id,s]));for(const s of b.spectra)spectra.set(s.id,s);
 return {schema_version:1,records:[...records.values()],spectra:[...spectra.values()],issues:[...a.issues,...b.issues],mapping:b.mapping,fingerprint:b.fingerprint};
}
