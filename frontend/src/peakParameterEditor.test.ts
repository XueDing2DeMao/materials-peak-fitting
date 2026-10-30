import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { reactive } from 'vue';
import MultiPeakControls from './components/MultiPeakControls.vue';
import XpsFitControls from './components/XpsFitControls.vue';
import { addMultiComponent, createMultiConfig } from './multipeakState';

const wrappers: Array<{ unmount: () => void }> = [];
afterEach(() => { wrappers.splice(0).forEach(w => w.unmount()); vi.restoreAllMocks(); });

describe('峰参数弹窗', () => {
  it('锚点弹窗支持撤销、Esc 保留修改及返回焦点，换数据关闭旧编辑',async()=>{
    const config=reactive(createMultiConfig([0,1,2,3],[0,5,2,0],null,'general'));
    config.baseline.anchors=[{x:0,y:1},{x:3,y:2}];
    const w=mount(MultiPeakControls,{attachTo:document.body,props:{config,preview:null,busy:false,candidates:[]}});wrappers.push(w);
    const entry=w.get('[data-test="edit-baseline-anchors"]'),dialogWrapper=w.get('[data-test="baseline-anchor-dialog"]');
    const dialog=dialogWrapper.element as HTMLDialogElement;
    dialog.showModal=()=>dialog.setAttribute('open','');dialog.close=()=>{dialog.removeAttribute('open');dialog.dispatchEvent(new Event('close'));};
    expect(dialog.open).toBe(false);await entry.trigger('click');expect(dialog.open).toBe(true);
    await dialogWrapper.get('[aria-label="锚点 1 Y"]').setValue(9);
    await w.get('[data-test="undo-baseline-anchors"]').trigger('click');expect(config.baseline.anchors[0].y).toBe(1);
    await dialogWrapper.get('[aria-label="锚点 2 X"]').setValue(2.5);
    await dialogWrapper.trigger('cancel');expect(dialog.open).toBe(false);expect(config.baseline.anchors[1].x).toBe(2.5);
    expect(document.activeElement).toBe(entry.element);
    await entry.trigger('click');expect(dialog.open).toBe(true);
    const next=reactive(createMultiConfig([4,5,6],[0,2,0],null,'general'));await w.setProps({config:next});
    expect(dialog.open).toBe(false);await w.get('[data-test="undo-baseline-anchors"]').trigger('click');expect(next.baseline.anchors).toEqual([]);
  });
  it('撤销恢复标签、启用、模型、参数与约束，切换数据后旧快照不可恢复',async()=>{
    const config=reactive(createMultiConfig([0,1,2,3],[0,5,2,0],null,'general'));addMultiComponent(config);addMultiComponent(config);
    config.constraints.push({source:{component:'p1',parameter:'xc'},target:{component:'p2',parameter:'xc'},kind:'offset',value:.2});
    const before=JSON.parse(JSON.stringify({components:config.components,constraints:config.constraints}));
    const w=mount(MultiPeakControls,{props:{config,preview:null,busy:false,candidates:[]}});wrappers.push(w);
    const dialog=w.get('dialog').element as HTMLDialogElement;dialog.showModal=()=>dialog.setAttribute('open','');dialog.close=()=>{dialog.removeAttribute('open');dialog.dispatchEvent(new Event('close'));};
    await w.get('[data-test="edit-all-peaks"]').trigger('click');await w.get('[aria-label="p1 显示标签"]').setValue('误改');await w.get('[aria-label="参数表启用 p2"]').setValue(false);
    await w.get('[data-test="all-peaks-model"]').setValue('emg_high');await w.get('[aria-label="p1 A 初值"]').setValue(90);
    config.constraints.splice(0);await w.get('[data-test="undo-parameters"]').trigger('click');
    expect({components:config.components,constraints:config.constraints}).toEqual(before);expect(w.emitted('model')?.at(-1)).toEqual(['psd_voigt1']);
    const next=reactive(createMultiConfig([5,6,7,8],[0,2,1,0],null,'general'));addMultiComponent(next);await w.setProps({config:next});
    expect(dialog.open).toBe(false);await w.get('[data-test="undo-parameters"]').trigger('click');expect(next.components[0].parameters.xc?.value).toBe(6);
  });
  it('一个弹窗并列编辑所有峰，完成和原生关闭保留独立参数并返回焦点', async () => {
    const config = reactive(createMultiConfig([0, 1, 2, 3], [0, 5, 2, 0], null, 'xrd'));
    addMultiComponent(config); addMultiComponent(config);
    const w = mount(MultiPeakControls, { attachTo: document.body, props: { config, preview: null, busy: false, candidates: [] } }); wrappers.push(w);
    const button = w.get('[data-test="edit-all-peaks"]');
    expect(w.findAll('dialog[aria-label="全部峰参数"]')).toHaveLength(1);
    const dialog = w.get('[aria-label="全部峰参数"]').element as HTMLDialogElement;
    dialog.showModal = () => dialog.setAttribute('open', '');
    dialog.close = () => { dialog.removeAttribute('open'); dialog.dispatchEvent(new Event('close')); };
    expect(dialog.open).toBe(false);
    await button.trigger('click'); expect(dialog.open).toBe(true);
    await w.get('[aria-label="p1 A 初值"]').setValue(9);
    await w.get('[aria-label="p2 xc 初值"]').setValue(1.25);
    await w.get('[aria-label="p2 xc 下限"]').setValue(1);
    await w.get('[aria-label="p2 xc 固定"]').setValue(true);
    await w.get('[aria-label="p2 xc 上限"]').setValue('');
    await w.get('[aria-label="全部峰参数"] .primary').trigger('click');
    expect(dialog.open).toBe(false); expect(document.activeElement).toBe(button.element);
    expect(config.components[1].parameters.xc).toMatchObject({ value: 1.25, lower: 1, upper: null, fixed: true });
    expect(config.components[0].parameters.xc?.value).toBe(1);
    expect(config.components[0].parameters.A?.value).toBe(9);
    expect(w.get('[aria-label="p2 参数摘要"]').text()).toContain('1.25');
    await button.trigger('click'); expect((w.get('[aria-label="p2 xc 初值"]').element as HTMLInputElement).value).toBe('1.25');
    dialog.close(); await w.vm.$nextTick(); expect(button.attributes('aria-expanded')).toBe('false');
  });

  it('XPS 复用编辑器并保留单位、绑定只读和固定设置', async () => {
    const config = reactive({ x:[0,1,2,3], y:[0,5,2,0], range_start:0, range_end:3, shift_eV:0, calibration_note:'', schema_version:1 as const,
      background:{kind:'none' as const,low_window:null,high_window:null,low_level:null,high_level:null,tolerance:1e-6,max_iterations:100,confirmed:false},
      components:[{id:'p1',label:'峰 1',enabled:true,model:'gaussian' as const,parameters:{xc:{value:1,fixed:false},A:{value:5,fixed:false},w:{value:.3,fixed:false}}}],
      constraints:[{source:{component:'p2',parameter:'xc' as const},target:{component:'p1',parameter:'xc' as const},kind:'offset' as const,value:1}],groups:[],solver:{max_nfev:100,tolerance:1e-8},source:null });
    const w = mount(XpsFitControls,{props:{config,previewed:false,backgroundPreview:null,busy:false,candidates:[]}}); wrappers.push(w);
    expect(w.find('[aria-label="编辑 p1 参数与约束"]').exists()).toBe(true);
    expect(w.get('[aria-label="p1 xc 初值"]').attributes('disabled')).toBeDefined();
    expect(w.get('[aria-label="p1 · 峰 1 参数初值与约束"]').text()).toContain('/ eV');
    expect(w.get('[aria-label="p1 参数摘要"]').text()).toContain('绑定');
    const dialog=w.get('dialog').element as HTMLDialogElement;
    dialog.showModal=()=>dialog.setAttribute('open','');dialog.close=()=>{dialog.removeAttribute('open');dialog.dispatchEvent(new Event('close'));};
    const before=JSON.parse(JSON.stringify({component:config.components[0],constraints:config.constraints}));
    await w.get('[aria-label="编辑 p1 参数与约束"]').trigger('click');
    await w.get('[aria-label="p1 xc 固定"]').setValue(true);
    expect(w.get('[aria-label="p1 xc 初值"]').attributes('disabled')).toBeUndefined();
    config.components[0].label='误改';config.components[0].enabled=false;config.constraints.splice(0);
    await w.get('[data-test="undo-parameters"]').trigger('click');
    expect({component:config.components[0],constraints:config.constraints}).toEqual(before);
    config.x=[10,11,12,13];await w.vm.$nextTick();
    expect(dialog.open).toBe(false);config.components[0].label='新数据';
    await w.get('[data-test="undo-parameters"]').trigger('click');expect(config.components[0].label).toBe('新数据');
  });
  it('统一弹窗切换峰函数，绑定参数仍受保护且冲突切换不产生部分修改',async()=>{
    const config=reactive(createMultiConfig([0,1,2,3],[0,5,2,0],null,'general'));
    addMultiComponent(config);addMultiComponent(config);
    config.constraints.push({source:{component:'p1',parameter:'xc'},target:{component:'p2',parameter:'xc'},kind:'offset',value:.2});
    const w=mount(MultiPeakControls,{props:{config,preview:null,busy:false,candidates:[]}});wrappers.push(w);
    expect(w.get('[aria-label="p2 xc 初值"]').attributes('disabled')).toBeDefined();
    await w.get('[aria-label="p2 xc 固定"]').setValue(true);
    expect(w.get('[aria-label="p2 xc 初值"]').attributes('disabled')).toBeUndefined();
    await w.get('[data-test="all-peaks-model"]').setValue('psd_voigt2');
    expect(config.components.every(c=>c.model==='psd_voigt2')).toBe(true);
    expect(w.find('[aria-label="p1 wG 初值"]').exists()).toBe(true);
    expect(w.find('[aria-label="p1 w 初值"]').exists()).toBe(false);
    config.constraints.push({source:{component:'p1',parameter:'wG'},target:{component:'p2',parameter:'wG'},kind:'ratio',value:1});
    await w.get('[data-test="all-peaks-model"]').setValue('gaussian');
    expect(config.components.every(c=>c.model==='psd_voigt2')).toBe(true);
    expect(w.get('dialog [role="alert"]').text()).toContain('解除');
    expect((w.get('[data-test="all-peaks-model"]').element as HTMLSelectElement).value).toBe('psd_voigt2');
  });
  it('峰位清空显示占位符，重新输入后恢复摘要',async()=>{
    const config=reactive(createMultiConfig([0,1,2,3],[0,5,2,0],null,'general'));addMultiComponent(config);
    const w=mount(MultiPeakControls,{props:{config,preview:null,busy:false,candidates:[]}});wrappers.push(w);
    await w.get('[aria-label="p1 xc 初值"]').setValue('');
    expect(w.get('[aria-label="p1 参数摘要"]').text()).toContain('—');
    await w.get('[aria-label="p1 xc 初值"]').setValue(1.25);
    expect(w.get('[aria-label="p1 参数摘要"]').text()).toContain('1.25');
  });
});
