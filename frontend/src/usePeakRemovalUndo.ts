import {computed, shallowRef, watch} from 'vue';

/** 继续编辑后清除撤销记录，避免覆盖新工作。 */
export function usePeakRemovalUndo<T extends {components:unknown[];constraints:unknown[];groups?:unknown[]}>(getConfig:()=>T, removePeak:(config:T,id:string)=>void){
  const pending=shallowRef<{config:T;before:string;after:string;id:string}|null>(null);
  const signature=(c:T)=>JSON.stringify({components:c.components,constraints:c.constraints,...(c.groups?{groups:c.groups}:{})});
  const canUndo=computed(()=>Boolean(pending.value&&pending.value.config===getConfig()&&signature(getConfig())===pending.value.after));
  watch(getConfig,()=>{pending.value=null;},{deep:true,flush:'sync'});
  function remove(id:string){
    const config=getConfig(),before=signature(config);
    removePeak(config,id);
    pending.value={config,before,after:signature(config),id};
  }
  function undo(){
    if(!canUndo.value)return;
    const entry=pending.value!,before=JSON.parse(entry.before);
    pending.value=null;
    Object.assign(getConfig(),before);
    return entry.id;
  }
  return {remove,undo,canUndo};
}
