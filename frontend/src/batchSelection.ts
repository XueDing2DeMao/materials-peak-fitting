import type { DatasetInfo } from './types';

/** 仅前端导入草稿，不改变拟合请求与批次结果合同。 */
export interface SheetSelection { key:string; dataset:DatasetInfo; sheet:string; xColumn:string; yColumns:string[] }
export interface SpectrumSelection { dataset:DatasetInfo; sheet:string; xColumn:string; yColumn:string; columns:string[] }
export type SpectrumOrder='original'|'file'|'column';
export function createSelection(dataset:DatasetInfo):SheetSelection[]{
  return dataset.sheets.filter(s=>s.numeric_columns.length>=2).map(s=>({key:crypto.randomUUID(),dataset,sheet:s.name,xColumn:s.numeric_columns[0],yColumns:[]}));
}
export function selectedSpectra(drafts:SheetSelection[],existing=0):SpectrumSelection[]{
  const rows=drafts.flatMap(d=>{
    const columns=d.dataset.sheets.find(s=>s.name===d.sheet)?.numeric_columns??[];
    if(d.yColumns.length&&!columns.includes(d.xColumn))throw new Error('请选择有效 X 数值列');
    return d.yColumns.map(yColumn=>{
      if(yColumn===d.xColumn)throw new Error('X / Y 不能为同一列');
      if(!columns.includes(yColumn))throw new Error('所选 Y 不在数值列中');
      return {dataset:d.dataset,sheet:d.sheet,xColumn:d.xColumn,yColumn,columns};
    });
  });
  if(existing+rows.length>100)throw new Error(`将纳入 ${existing+rows.length} 条谱线，超过 100 条上限；请减少选择。`);
  return rows;
}
export function selectionIdentity(r:SpectrumSelection){return JSON.stringify([r.dataset.file_sha256??r.dataset.dataset_id,r.sheet,r.xColumn,r.yColumn]);}
export function duplicateSelections(rows:SpectrumSelection[],existing:SpectrumSelection[]){
  const seen=new Set(existing.map(selectionIdentity));
  return rows.filter(r=>{const key=selectionIdentity(r),duplicate=seen.has(key);seen.add(key);return duplicate;});
}
const natural=new Intl.Collator('zh-CN',{numeric:true,sensitivity:'base'});
export function sortSpectra<T extends SpectrumSelection&{originalOrder:number}>(rows:T[],order:SpectrumOrder):T[]{
  return [...rows].sort((a,b)=>order==='original'?a.originalOrder-b.originalOrder:
    (order==='file'?natural.compare(a.dataset.filename,b.dataset.filename):natural.compare(a.yColumn,b.yColumn))||a.originalOrder-b.originalOrder);
}
