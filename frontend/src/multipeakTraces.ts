import { componentLine, FIGURE_COLORS } from './figureStyle';
import type { MultiPreview } from './multipeakTypes';
export interface MultiPlotResult { x:number[]; total_y:number[]; residuals:number[]; components:{id:string;label:string;y:number[];parameters:{xc?:{value:number}}}[] }
export function multiTraces(x:number[],y:number[],preview:MultiPreview|null,result:MultiPlotResult|null){
  const traces:Array<Record<string,unknown>>=[{x,y,name:'原始谱',type:'scatter',mode:'markers',marker:{size:3.5,color:FIGURE_COLORS.observation,opacity:.7}}];
  if(preview)traces.push({x:preview.x,y:preview.baseline,name:'固定背景',type:'scatter',mode:'lines',line:{color:FIGURE_COLORS.background,dash:'dash',width:1.5}});
  if(result){traces.push({x:result.x,y:result.total_y,name:'总拟合',type:'scatter',mode:'lines',line:{color:FIGURE_COLORS.fit,width:2.2}});result.components.forEach(c=>traces.push({x:result.x,y:c.y,name:`${c.id} · ${c.label}（净峰）`,type:'scatter',mode:'lines',line:componentLine(c.id)}));}
  return traces;
}
