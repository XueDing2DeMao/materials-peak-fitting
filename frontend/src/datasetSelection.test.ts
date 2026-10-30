import * as protection from './useWorkProtection';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import App from './App.vue';
import DatasetSummary from './components/DatasetSummary.vue';
import * as api from './api';
import type { DatasetInfo } from './types';

vi.mock('./api',()=>({uploadDataset:vi.fn(),previewDataset:vi.fn(),loadDatasetRows:vi.fn()}));
vi.mock('plotly.js-dist-min',()=>({default:{purge:vi.fn(),react:vi.fn()}}));
const workbook:DatasetInfo={dataset_id:'old',filename:'Raman.xlsx',file_sha256:'old-hash',sheets:[
  {name:'Figure2bc',columns:['label','mean','error'],numeric_columns:['mean','error'],row_count:3,preview_rows:[{label:'统计',mean:12,error:2}]},
  {name:'Bare Ge',columns:['Wavenumber','Pristine #1'],numeric_columns:['Wavenumber','Pristine #1'],row_count:10,preview_rows:[{Wavenumber:100,'Pristine #1':25}]},
]};
const wrappers:ReturnType<typeof mount>[]=[];
beforeEach(()=>{vi.resetAllMocks();
Object.defineProperty(HTMLDialogElement.prototype,"showModal",{configurable:true,writable:true,value:function(){this.setAttribute("open","");}});
Object.defineProperty(HTMLDialogElement.prototype,"close",{configurable:true,writable:true,value:function(){this.removeAttribute("open");this.dispatchEvent(new Event("close"));}});
vi.mocked(api.loadDatasetRows).mockImplementation(async(_id,name,offset=0,limit=100)=>({sheet:name,columns:workbook.sheets.find(s=>s.name===name)!.columns,offset,limit,total_rows:3,row_numbers:[1],rows:name==="Bare Ge"?[[100,25]]:[["统计",12,2]]}));vi.mocked(api.uploadDataset).mockResolvedValue(workbook);vi.mocked(api.previewDataset).mockResolvedValue({x:[1,2,3],y:[0,2,0]});});
afterEach(()=>{wrappers.splice(0).forEach(w=>w.unmount());vi.restoreAllMocks();});
async function app(){const w=mount(App,{global:{stubs:{MultiPeakWorkbench:{name:'MultiPeakWorkbench',emits:['work'],props:['x','y','source'],template:'<div />'},XpsWorkbench:true,BatchWorkbench:true}}});wrappers.push(w);w.getComponent(DatasetSummary).vm.$emit('upload',new File(['x'],'Raman.xlsx'));await flushPromises();return w;}
describe('导入数据核对',()=>{
  it('清理详情直接展示行记录，切换标签保留列草稿且不会提交，关闭返回摘要入口',async()=>{
    const selected={sheet:'Figure2bc',xColumn:'mean',yColumn:'error'};
    const audit={version:1 as const,row_basis:'parsed_sheet_after_empty_rows_removed' as const,sheet_rows:3,valid_pairs:2,excluded_pairs:1,exclusion_reasons:{y_missing:1},excluded_rows:[{parsed_row:3,reasons:['y_missing']}],excluded_rows_truncated:false,source_rows:[1,2],sorting_changed:false,duplicate_x_count:1};
    const d=mount(DatasetSummary,{attachTo:document.body,props:{dataset:workbook,appliedDataset:workbook,appliedSelection:selected,loading:false,audit}});wrappers.push(d);await flushPromises();
    await d.get('[data-test="open-audit"]').trigger('click');await flushPromises();
    expect(d.get('[data-test="dataset-tab-audit"]').attributes('aria-selected')).toBe('true');
    expect(d.get('.audit-row-list').isVisible()).toBe(true);
    expect(d.get('[data-test="apply-selection"]').isVisible()).toBe(false);
    await d.get('[data-test="dataset-tab-data"]').trigger('click');await d.get('select').setValue('Bare Ge');
    await d.get('[data-test="dataset-tab-audit"]').trigger('click');await d.get('[data-test="dataset-tab-data"]').trigger('click');
    expect((d.get('select').element as HTMLSelectElement).value).toBe('Bare Ge');
    expect(d.emitted('preview')).toBeUndefined();
    await d.get('dialog').trigger('cancel');await flushPromises();
    expect(document.activeElement).toBe(d.get('[data-test="open-audit"]').element);
  });

  it('没有审计记录时不把排除数显示为零',async()=>{
    const d=mount(DatasetSummary,{props:{dataset:workbook,appliedDataset:workbook,appliedSelection:{sheet:'Figure2bc',xColumn:'mean',yColumn:'error'},loading:false}});wrappers.push(d);await flushPromises();
    expect(d.get('[data-test="open-audit"]').text()).toContain('未提供');
    expect(d.get('[data-test="open-audit"]').text()).not.toContain('排除 0');
  });
  it('弹窗 Esc 取消草稿并返回查看入口，浏览不提交数据',async()=>{
    const selected={sheet:'Figure2bc',xColumn:'mean',yColumn:'error'};
    const d=mount(DatasetSummary,{attachTo:document.body,props:{dataset:workbook,appliedDataset:workbook,appliedSelection:selected,loading:false}});wrappers.push(d);await flushPromises();
    await d.get('[data-test="open-selection"]').trigger('click');await flushPromises();
    expect(d.get('dialog').attributes('open')).toBeDefined();await d.get('select').setValue('Bare Ge');
    await d.get('dialog').trigger('cancel');await flushPromises();
    expect(d.emitted('preview')).toBeUndefined();expect(d.emitted('cancel')).toHaveLength(1);expect(d.get('dialog').attributes('open')).toBeUndefined();expect(document.activeElement).toBe(d.get('[data-test="open-selection"]').element);
  });

  it('已有分析取消替换时保持数组和身份；读取失败不弹工作丢失确认',async()=>{
    const w=await app(),d=w.getComponent(DatasetSummary);await d.get('[data-test="apply-selection"]').trigger('click');await flushPromises();
    w.findComponent({name:'MultiPeakWorkbench'}).vm.$emit('work',{mode:'single',dirty:true});await flushPromises();
    const confirm=vi.spyOn(protection,'confirmDiscard').mockResolvedValue(false);
    await d.get('select').setValue('Bare Ge');await d.get('[data-test="apply-selection"]').trigger('click');await flushPromises();
    expect(confirm).toHaveBeenCalled();expect(d.get('.dataset-file').text()).toContain('Figure2bc');
    confirm.mockClear();vi.mocked(api.previewDataset).mockRejectedValueOnce(new Error('读取失败'));
    await d.get('[data-test="apply-selection"]').trigger('click');await flushPromises();expect(confirm).not.toHaveBeenCalled();expect(d.props('pointCount')).toBe(3);
  });
  it('多表首选仅为建议，在弹窗浏览完整数据，显式应用原谱后才提交来源和数组',async()=>{
    const w=await app(),d=w.getComponent(DatasetSummary);
    expect(api.previewDataset).not.toHaveBeenCalled();
    expect(d.get('dialog').attributes('open')).toBeDefined();expect(d.text()).toContain('待应用');expect(d.text()).toContain('统计');
    await d.get('select').setValue('Bare Ge');await flushPromises();expect(d.text()).toContain('25');
    await d.get('[data-test="apply-selection"]').trigger('click');await flushPromises();
    expect(api.previewDataset).toHaveBeenCalledWith('old','Bare Ge','Wavenumber','Pristine #1');
    expect(d.get('.dataset-file').text()).toContain('Bare Ge');
  });
  it('新文件读取及列应用失败均保留已应用的文件身份和图表',async()=>{
    const w=await app(),d=w.getComponent(DatasetSummary);await d.get('[data-test="apply-selection"]').trigger('click');await flushPromises();
    vi.mocked(api.uploadDataset).mockResolvedValue({...workbook,dataset_id:'new',filename:'new.xlsx'});
    d.vm.$emit('upload',new File(['x'],'new.xlsx'));await flushPromises();
    expect(d.get('.dataset-file').text()).toContain('Raman.xlsx');expect(d.text()).toContain('new.xlsx');
    vi.mocked(api.previewDataset).mockRejectedValueOnce(new Error('无有效配对'));await d.get('[data-test="apply-selection"]').trigger('click');await flushPromises();
    expect(d.get('.dataset-file').text()).toContain('Raman.xlsx');expect(d.props('pointCount')).toBe(3);
    vi.mocked(api.uploadDataset).mockRejectedValueOnce(new Error('损坏文件'));
    d.vm.$emit('upload',new File(['x'],'broken.xlsx'));await flushPromises();
    expect(d.props('error')).toContain('当前图表仍为 Raman.xlsx');
  });
  it('旧列请求晚返回不能覆盖新文件的已应用结果',async()=>{
    const w=await app(),d=w.getComponent(DatasetSummary);let finish!:(v:{x:number[];y:number[]})=>void;
    vi.mocked(api.previewDataset).mockReturnValueOnce(new Promise(r=>finish=r));d.vm.$emit('preview',{sheet:'Figure2bc',xColumn:'mean',yColumn:'error'});await flushPromises();
    vi.mocked(api.uploadDataset).mockResolvedValue({...workbook,dataset_id:'new',filename:'new.xlsx'});d.vm.$emit('upload',new File(['x'],'new.xlsx'));await flushPromises();
    await d.get('[data-test="apply-selection"]').trigger('click');await flushPromises();finish({x:[9],y:[9]});await flushPromises();
    expect(d.get('.dataset-file').text()).toContain('new.xlsx');expect(d.props('pointCount')).toBe(3);
  });
  it('无可用列和相同 X/Y 无法应用',async()=>{
    const d=mount(DatasetSummary,{props:{dataset:{...workbook,sheets:[{...workbook.sheets[0],numeric_columns:[]}]},loading:false}});wrappers.push(d);
    expect(d.get('[data-test="apply-selection"]').attributes('disabled')).toBeDefined();expect(d.text()).toContain('没有可用');
    await d.setProps({dataset:workbook});await d.findAll('select')[2].setValue('mean');await d.get('[data-test="apply-selection"]').trigger('click');expect(d.emitted('preview')).toBeUndefined();
  });
  it('取消待应用新文件后恢复原工作表与列草稿',async()=>{
    const w=await app(),d=w.getComponent(DatasetSummary);await d.get('select').setValue('Bare Ge');await d.get('[data-test="apply-selection"]').trigger('click');await flushPromises();
    vi.mocked(api.uploadDataset).mockResolvedValue({...workbook,dataset_id:'new',filename:'new.xlsx'});d.vm.$emit('upload',new File(['x'],'new.xlsx'));await flushPromises();
    await d.get('[data-test="cancel-selection"]').trigger('click');await flushPromises();
    expect((d.get('select').element as HTMLSelectElement).value).toBe('Bare Ge');expect(d.get('.dataset-file').text()).toContain('Raman.xlsx');
  });
});
