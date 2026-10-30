import type { SheetSelection } from './batchSelection';

/** 仅预览导入草稿的列映射，不改动源数据或批次执行顺序。 */
export function previewColumnMapping(source:SheetSelection,target:SheetSelection,mode:'name'|'position'){
  const sourceSheet=source.dataset.sheets.find(s=>s.name===source.sheet);
  const targetSheet=target.dataset.sheets.find(s=>s.name===target.sheet);
  const fail=(error:string)=>({xColumn:'',yColumns:[] as string[],error});
  if(!sourceSheet||!targetSheet)return fail('工作表不可用');
  if(!source.yColumns.length)return fail('请先选择至少一个 Y 列');
  const chosen=[source.xColumn,...source.yColumns];
  if(new Set(chosen).size!==chosen.length||chosen.some(c=>!sourceSheet.numeric_columns.includes(c)))return fail('来源 X / Y 列无效');
  // 位置按原始列（含文本列）计算，不能按各文件的数值列重新编号。
  const sourceColumns=sourceSheet.columns.length?sourceSheet.columns:sourceSheet.numeric_columns;
  const targetColumns=targetSheet.columns.length?targetSheet.columns:targetSheet.numeric_columns;
  const mapped=chosen.map(c=>mode==='name'?c:targetColumns[sourceColumns.indexOf(c)]);
  const missing=mapped.findIndex(c=>!c||!targetSheet.numeric_columns.includes(c));
  if(missing!==-1)return fail(mode==='name'?`缺少数值列：${chosen[missing]}`:`第 ${sourceColumns.indexOf(chosen[missing])+1} 列不存在或不是数值列`);
  return {xColumn:mapped[0],yColumns:mapped.slice(1),error:''};
}
