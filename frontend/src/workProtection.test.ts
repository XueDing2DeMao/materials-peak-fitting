import { describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { confirmDiscard, memorySnapshot, useWorkProtection } from './useWorkProtection';
describe('内存工作保护',()=>{
  it('快照与当前编辑隔离，拒绝跨数据版本恢复',()=>{
    const version={},value={parameters:{xc:2}},snapshot=memorySnapshot(value,version);value.parameters.xc=99;
    const recovered=snapshot.restore(version)!;expect(recovered.parameters.xc).toBe(2);recovered.parameters.xc=77;
    expect(snapshot.restore(version)?.parameters.xc).toBe(2);expect(snapshot.restore({})).toBeNull();
  });
  it('只有存在工作损失才显示非阻塞确认，取消或 Esc 保留，继续才替换',async()=>{
    HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
    expect(await confirmDiscard(false,'清空')).toBe(true);expect(document.querySelector('.work-protection-dialog')).toBeNull();
    const pending=confirmDiscard(true,'清空 3 条结果');const dialog=document.querySelector('.work-protection-dialog')!;
    expect(dialog.textContent).toContain('3 条');(dialog.querySelector('button') as HTMLButtonElement).click();expect(await pending).toBe(false);
    const accepted=confirmDiscard(true,'替换');(document.querySelector('.work-protection-dialog button:last-child') as HTMLButtonElement).click();expect(await accepted).toBe(true);
    const escaped=confirmDiscard(true,'替换');document.querySelector('.work-protection-dialog')!.dispatchEvent(new Event('cancel',{cancelable:true}));expect(await escaped).toBe(false);
    expect(document.querySelector('.work-protection-dialog')).toBeNull();
  });
  it('空工作区允许离开，有工作时阻止离开；卸载清理监听',()=>{
    const dirty=ref(false);const w=mount(defineComponent({setup(){useWorkProtection(()=>dirty.value);return {};},template:'<div />'}));
    const leave=()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented;};
    expect(leave()).toBe(false);dirty.value=true;expect(leave()).toBe(true);w.unmount();expect(leave()).toBe(false);
  });
});
