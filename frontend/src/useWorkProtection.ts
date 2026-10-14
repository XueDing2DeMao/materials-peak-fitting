import { onBeforeUnmount, onMounted } from 'vue';

/** 仅提醒，不写入持久化；CSV、PNG 和配置导出不代表完整会话已保存。 */
export function useWorkProtection(hasWork:()=>boolean){
  const beforeUnload=(event:BeforeUnloadEvent)=>{
    if(!hasWork())return;
    event.preventDefault();event.returnValue='';
  };
  onMounted(()=>window.addEventListener('beforeunload',beforeUnload));
  onBeforeUnmount(()=>window.removeEventListener('beforeunload',beforeUnload));
}
export async function confirmDiscard(hasWork:boolean,impact:string):Promise<boolean>{
  if(!hasWork)return true;
  // 页面内确认不会阻塞浏览器线程，默认聚焦取消；内容仅以纯文本写入。
  const trigger=document.activeElement as HTMLElement|null;
  const dialog=document.createElement('dialog');
  dialog.className='parameter-dialog work-protection-dialog';dialog.setAttribute('aria-label','保护当前工作');
  const header=document.createElement('header');header.className='parameter-dialog-header';
  const title=document.createElement('h2');title.textContent='保护当前工作';header.append(title);
  const body=document.createElement('div');body.className='parameter-dialog-body';
  const message=document.createElement('p');message.textContent=impact;
  const note=document.createElement('p');note.className='hint';note.textContent='当前工作仅保留在内存中，CSV / PNG / 配置导出不等于完整会话。取消可保留当前工作。';body.append(message,note);
  const footer=document.createElement('footer');footer.className='parameter-dialog-footer';
  const cancel=document.createElement('button');cancel.textContent='取消，保留当前工作';cancel.autofocus=true;
  const proceed=document.createElement('button');proceed.textContent='继续，替换当前工作';
  footer.append(cancel,proceed);dialog.append(header,body,footer);document.body.append(dialog);
  return new Promise(resolve=>{
    const finish=(accepted:boolean)=>{dialog.remove();if(trigger?.isConnected)trigger.focus({preventScroll:true});resolve(accepted);};
    cancel.onclick=()=>finish(false);proceed.onclick=()=>finish(true);
    dialog.oncancel=event=>{event.preventDefault();finish(false);};
    dialog.showModal();
  });
}

/** 版本用对象身份判定，不允许将另一份数据的编辑快照恢复回来。 */
export function memorySnapshot<T>(value:T,version:unknown){
  const snapshot=JSON.stringify(value);
  return {restore:(currentVersion:unknown):T|null=>currentVersion===version?JSON.parse(snapshot):null};
}
