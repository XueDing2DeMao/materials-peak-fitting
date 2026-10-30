import {computed, onBeforeUnmount, onMounted, ref, type Ref} from 'vue';

const clamp=(value:number,min:number,max:number)=>Math.round(Math.max(min,Math.min(max,value)));

// 布局只保留在当前工作区内存中，不写入拟合配置或会话文件。
export function useWorkbenchLayout(resultsOpen:Ref<boolean>){
 const grid=ref<HTMLElement|null>(null),width=ref(1200);
 const preferredSettings=ref(260),preferredResults=ref(320);
 const chartExpanded=ref(false);
 const stacked=computed(()=>width.value<880);
 const panelBudget=computed(()=>Math.max(520,width.value-16-320));
 const settingsWidth=computed(()=>clamp(preferredSettings.value,232,
  resultsOpen.value&&!stacked.value?Math.min(420,panelBudget.value-288):Math.min(420,width.value-8-320)));
 const resultWidth=computed(()=>clamp(preferredResults.value,288,
  stacked.value?520:Math.min(520,panelBudget.value-settingsWidth.value)));
 const settingsMax=computed(()=>Math.max(232,Math.min(420,width.value-320-(resultsOpen.value&&!stacked.value?resultWidth.value+16:8))));
 const resultMax=computed(()=>Math.max(288,Math.min(520,panelBudget.value-settingsWidth.value)));
 const layoutStyle=computed(()=>({'--settings-width':settingsWidth.value+'px','--results-width':resultWidth.value+'px'}));
 function setWidth(panel:'settings'|'results',value:number){
  if(!Number.isFinite(value))return;
  if(panel==='settings')preferredSettings.value=clamp(value,232,settingsMax.value);
  else preferredResults.value=clamp(value,288,resultMax.value);
 }
 function resetWidths(){preferredSettings.value=260;preferredResults.value=320;}
 let observer:ResizeObserver|undefined;
 onMounted(()=>{
  if(!grid.value)return;
  if(grid.value.clientWidth>0)width.value=grid.value.clientWidth;
  if(typeof ResizeObserver==='undefined')return;
  observer=new ResizeObserver(entries=>{for(const entry of entries)if(entry.contentRect.width>0)width.value=entry.contentRect.width;});
  observer.observe(grid.value);
 });
 onBeforeUnmount(()=>observer?.disconnect());
 return {grid,stacked,chartExpanded,settingsWidth,resultWidth,settingsMax,resultMax,layoutStyle,setWidth,resetWidths};
}
