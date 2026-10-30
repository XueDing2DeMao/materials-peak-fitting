import { afterEach,beforeEach,describe,expect,it } from 'vitest';
import { flushPromises,mount } from '@vue/test-utils';
import { reactive } from 'vue';
import BatchImportSelector from './components/BatchImportSelector.vue';
import { createSelection,selectedSpectra } from './batchSelection';
import { previewColumnMapping } from './batchColumnMapping';
import type { DatasetInfo } from './types';

function file(name:string,columns=['note','x','signal','error'],numeric=columns.filter(c=>c!=='note')):DatasetInfo{
  return {dataset_id:name,filename:name,sheets:[{name:'data',columns,numeric_columns:numeric,row_count:3,preview_rows:[{note:'样品',x:0,signal:12,error:.2}]}]};
}
const wrappers:ReturnType<typeof mount>[]=[];
beforeEach(()=>{
  Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,writable:true,value:function(){this.setAttribute('open','');}});
  Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,writable:true,value:function(){this.removeAttribute('open');this.dispatchEvent(new Event('close'));}});
});
afterEach(()=>wrappers.splice(0).forEach(w=>w.unmount()));
async function setup(files=[file('a.csv'),file('b.csv')],disabled=false){
  const drafts=reactive(files.flatMap(createSelection));
  const w=mount(BatchImportSelector,{attachTo:document.body,props:{drafts,existing:[],disabled}});wrappers.push(w);await flushPromises();return {w,drafts};
}
const button=(w:ReturnType<typeof mount>,name:string)=>w.findAll('button').find(b=>b.text()===name)!;

describe('批量列规则预览',()=>{
  it('按列名匹配允许列顺序不同，预览不改动目标选择',()=>{
    const source=createSelection(file('a'))[0],target=createSelection(file('b',['error','signal','note','x']))[0];source.yColumns=['signal'];target.yColumns=['error'];
    const before=JSON.stringify(target);
    expect(previewColumnMapping(source,target,'name')).toEqual({xColumn:'x',yColumns:['signal'],error:''});expect(JSON.stringify(target)).toBe(before);
  });
  it('按位置映射不同列名，位置计入文本列，非数值或短列目标拒绝匹配',()=>{
    const source=createSelection(file('a'))[0];source.yColumns=['signal','error'];
    const target=createSelection(file('b',['note','angle','intensity','sigma']))[0];
    expect(previewColumnMapping(source,target,'position')).toEqual({xColumn:'angle',yColumns:['intensity','sigma'],error:''});
    expect(previewColumnMapping(source,target,'name').error).toContain('x');
    const text=createSelection(file('c',['x','note','signal','error']))[0];expect(previewColumnMapping(source,text,'position').error).toContain('第 2 列');
    const short=createSelection(file('d',['x','signal']))[0];expect(previewColumnMapping(source,short,'position').error).toContain('第 3 列');
  });
  it('没有 Y、X/Y 冲突和无效来源拒绝批量应用',()=>{
    const source=createSelection(file('a'))[0],target=createSelection(file('b'))[0];
    expect(previewColumnMapping(source,target,'name').error).toContain('至少一个');source.yColumns=['x'];expect(previewColumnMapping(source,target,'name').error).toContain('无效');
    source.yColumns=['missing'];expect(previewColumnMapping(source,target,'position').error).toContain('无效');
  });
});

describe('集中 X/Y 选择弹窗',()=>{
  it('完成度取自有效映射，未选择或无效时不会显示可纳入的模拟数量',async()=>{
    const {w,drafts}=await setup();
    expect(w.get('[data-test="batch-mapping-progress"]').text()).toContain('已配置 0 / 2');
    expect(w.get('[data-test="batch-commit-selection"]').text()).toContain('（0）');
    expect(drafts.every(d=>!d.yColumns.length)).toBe(true);
    await w.get('[aria-label="a.csv / data 纳入 signal"]').setValue(true);
    expect(w.get('[data-test="batch-mapping-progress"]').text()).toContain('已配置 1 / 2');
    expect(w.get('[data-test="batch-commit-selection"]').text()).toContain('（1）');
    drafts[0].yColumns=['missing'];await flushPromises();
    expect(w.get('[data-test="batch-mapping-progress"]').text()).toContain('已配置 0 / 2');
    expect(w.get('[data-test="batch-commit-selection"]').text()).toContain('（0）');
    expect(w.get('[data-test="batch-commit-selection"]').attributes('disabled')).toBeDefined();
  });
  it('全部文件 Y 操作常驻顶部，搜索不改变批量范围，忙碌时禁止操作',async()=>{
    const {w,drafts}=await setup();
    const tools=w.get('[aria-label="全部文件 Y 选择"]');
    expect(tools.element.closest('details')).toBeNull();
    expect(tools.element.closest('.column-picker-body')).toBeNull();
    await w.get('[placeholder="输入文件名"]').setValue('a.csv');
    await tools.get('[data-test="batch-select-all"]').trigger('click');
    expect(drafts.map(d=>d.yColumns)).toEqual([['signal','error'],['signal','error']]);
    await w.setProps({disabled:true});
    expect(tools.get('[data-test="batch-select-all"]').attributes('disabled')).toBeDefined();
    await tools.get('[data-test="batch-clear-all"]').trigger('click');expect(drafts[0].yColumns).toHaveLength(2);
    await w.setProps({disabled:false});
    await tools.get('[data-test="batch-clear-all"]').trigger('click');expect(drafts.every(d=>!d.yColumns.length)).toBe(true);
  });
  it('等待文件读取完成后打开；X/Y 互斥、非数值禁选，切换文件保留选择',async()=>{
    const {w,drafts}=await setup(undefined,true);expect(w.get('.batch-column-dialog').attributes('open')).toBeUndefined();
    await w.setProps({disabled:false});await flushPromises();expect(w.get('.batch-column-dialog').attributes('open')).toBeDefined();
    expect(w.get('[aria-label="a.csv / data X 列 note"]').attributes('disabled')).toBeDefined();
    expect(w.get('[aria-label="a.csv / data 纳入 x"]').attributes('disabled')).toBeDefined();
    await w.get('[aria-label="a.csv / data 纳入 signal"]').setValue(true);
    await w.get('[aria-label="a.csv / data X 列 signal"]').setValue(true);expect(drafts[0].yColumns).toEqual([]);
    await w.get('[aria-label="a.csv / data 纳入 x"]').setValue(true);
    await w.get('[aria-label="配置文件 b.csv"]').trigger('click');await w.get('[aria-label="b.csv / data 纳入 signal"]').setValue(true);
    await w.get('[aria-label="配置文件 a.csv"]').trigger('click');
    expect((w.get('[aria-label="a.csv / data X 列 signal"]').element as HTMLInputElement).checked).toBe(true);
    expect((w.get('[aria-label="a.csv / data 纳入 x"]').element as HTMLInputElement).checked).toBe(true);
    expect(w.get('.column-picker-footer').text()).toContain('已选 2 个文件 · 将新增 2 条有效谱线');
    expect(w.get('[data-test="batch-mapping-progress"]').text()).toContain('已配置 2 / 2 个文件');
  });
  it('工作表、文件和列搜索不丢失隐藏项，Esc 暂存且焦点返回入口',async()=>{
    const workbook=file('book.xlsx');workbook.sheets.push({...workbook.sheets[0],name:'second'});
    const {w,drafts}=await setup([workbook,file('b.csv')]);
    await w.get('[aria-label="配置工作表"]').setValue(drafts[1].key);await w.get('[aria-label="book.xlsx / second 纳入 signal"]').setValue(true);
    await w.get('[placeholder="输入列名"]').setValue('error');expect(w.findAll('.column-role-table tbody tr')).toHaveLength(1);
    await w.get('[placeholder="输入文件名"]').setValue('b.csv');expect(w.findAll('.column-file-list>button')).toHaveLength(1);expect(drafts[1].yColumns).toEqual(['signal']);
    await w.get('[aria-label="配置文件 b.csv"]').trigger('click');await w.get('[placeholder="输入文件名"]').setValue('');await w.get('[aria-label="配置文件 book.xlsx"]').trigger('click');
    expect((w.get('[aria-label="配置工作表"]').element as HTMLSelectElement).value).toBe(drafts[1].key);
    await w.get('.batch-column-dialog').trigger('cancel');await flushPromises();expect(w.emitted('cancel')).toBeUndefined();expect(w.emitted('commit')).toBeUndefined();
    expect(document.activeElement).toBe(w.get('.selection-launcher>button').element);expect(drafts[1].yColumns).toEqual(['signal']);
    await w.get('.selection-launcher>button').trigger('click');await flushPromises();expect(w.get('.batch-column-dialog').attributes('open')).toBeDefined();
    await button(w,'取消本次导入').trigger('click');expect(w.emitted('cancel')).toHaveLength(1);
  });
  it('批量应用须显式确认；只替换勾选且匹配的工作表，异常保留原选择',async()=>{
    const {w,drafts}=await setup([file('a.csv'),file('b.csv'),file('bad.csv',['note','angle','other']),file('excluded.csv')]);
    drafts[2].yColumns=['other'];drafts[3].yColumns=['error'];
    await w.get('[aria-label="a.csv / data 纳入 signal"]').setValue(true);await button(w,'应用列规则到其他文件…').trigger('click');
    expect(drafts[1].yColumns).toEqual([]);expect(w.get('[aria-label="批量列规则预览"]').text()).toContain('缺少数值列');
    await w.get('[aria-label="应用规则到 excluded.csv / data"]').setValue(false);
    await button(w,'应用到 1 个匹配工作表').trigger('click');
    expect(drafts[1].yColumns).toEqual(['signal']);expect(drafts[2].yColumns).toEqual(['other']);expect(drafts[3].yColumns).toEqual(['error']);
    expect(w.get('[aria-label="配置文件 bad.csv"]').text()).toContain('需处理');
    await button(w,'应用列规则到其他文件…').trigger('click');await w.get('[aria-label="列规则匹配方式"]').setValue('position');
    expect(w.get('[aria-label="批量列规则预览"]').text()).toContain('X：angle → Y：other');
    await button(w,'应用到 3 个匹配工作表').trigger('click');expect(drafts[2].xColumn).toBe('angle');expect(w.get('[aria-label="配置文件 bad.csv"]').text()).not.toContain('需处理');
    await w.get('[data-test="batch-commit-selection"]').trigger('click');expect(w.emitted('commit')?.[0][0]).toHaveLength(4);
  });
  it('重复选择提示、100 条限额与忙碌状态仍阻止无效提交',async()=>{
    const {w,drafts}=await setup();drafts[0].yColumns=['signal'];await flushPromises();const existing=selectedSpectra([drafts[0]]);
    await w.setProps({existing});expect(w.text()).toContain('条选择重复');
    await w.setProps({existing:Array.from({length:100},()=>existing[0])});expect(w.get('.column-picker-footer [role=alert]').text()).toContain('100');
    expect(w.get('[data-test="batch-commit-selection"]').attributes('disabled')).toBeDefined();
    await w.setProps({existing:[],disabled:true});await w.get('[data-test="batch-commit-selection"]').trigger('click');expect(w.emitted('commit')).toBeUndefined();
  });
});
