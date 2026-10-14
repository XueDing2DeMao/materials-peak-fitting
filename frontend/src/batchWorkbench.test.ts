import * as protection from './useWorkProtection';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { addMultiComponent, createMultiConfig } from './multipeakState';
import * as api from './api';
import * as multi from './multipeakApi';
vi.mock('plotly.js-dist-min',()=>({default:{register:vi.fn(),react:vi.fn((el:any)=>{el.on=vi.fn();el.removeAllListeners=vi.fn();return Promise.resolve();}),purge:vi.fn(),downloadImage:vi.fn()}}));
vi.mock('./api',()=>({uploadDataset:vi.fn(),previewDataset:vi.fn()}));
vi.mock('./multipeakApi',()=>({validateMultiInput:vi.fn(),fitMulti:vi.fn()}));

const wrappers: ReturnType<typeof mount>[]=[];
afterEach(()=>{wrappers.splice(0).forEach(w=>w.unmount());vi.resetAllMocks();});
async function preparedBatch(failedColumn?:string,prepare=true){
  vi.resetAllMocks();
  const Component=(await import('./components/BatchWorkbench.vue')).default;
  const c=createMultiConfig([0,1,2,3,4],[0,1,3,1,0],null,'general');
  c.baseline.kind='line';addMultiComponent(c);
  vi.mocked(api.uploadDataset).mockResolvedValue({dataset_id:'a',filename:'sample.csv',file_sha256:'a'.repeat(64),sheets:[{name:'s',columns:['x','a','b','c'],numeric_columns:['x','a','b','c'],row_count:5,preview_rows:[]}]});
  vi.mocked(api.previewDataset).mockImplementation(async(_id,_sheet,_x,y)=>{
    if(y===failedColumn)throw new Error('该谱数据无效');
    return {x:c.x,y:c.y};
  });
  vi.mocked(multi.validateMultiInput).mockResolvedValue({x:c.x,raw_y:c.y,baseline:c.x.map(()=>0),baseline_configuration:{...c.baseline,resolved_anchors:[]}});
  vi.mocked(multi.fitMulti).mockImplementation(async request=>({configuration:request,converged:true,statistics:{rmse:.5},components:[{id:'p1',label:'峰1',parameters:{A:{value:3},xc:{value:2.1},w:{value:1},mu:{value:.3}},area_total:3,fwhm:1}],diagnostics:{identifiable:true,bound_parameters:[],strong_correlations:[],warnings:[]}} as any));
  const w=mount(Component,{attachTo:document.body,props:{template:c},global:{stubs:{MultiPeakChart:true,MultiPeakResults:true,BatchResultChart:true}}});wrappers.push(w);
  const file=w.get('input[type=file][multiple]');Object.defineProperty(file.element,'files',{value:[new File(['x,a,b,c'],'sample.csv')]});await file.trigger('change');await flushPromises();
  await w.get('[data-test="batch-select-all"]').trigger('click');await w.get('[data-test="batch-commit-selection"]').trigger('click');await flushPromises();
  if(prepare){await w.get('[data-test="batch-units"]').setValue(true);
    await w.get('[data-test="batch-prepare"]').trigger('click');await flushPromises();}
  return w;
}

describe('批量结果浏览与背景复核',()=>{
  it('待选择的导入不改旧复核但阻止启动，取消后可继续原批次',async()=>{
    const w=await preparedBatch();await w.get('[data-test="batch-confirm-all"]').trigger('click');
    await w.get('[data-test="batch-edit-inputs"]').trigger('click');
    await w.get('[data-test="batch-dropzone"]').trigger('drop',{dataTransfer:{files:[new File(['x,y'],'new.csv')]}});await flushPromises();
    expect((w.get('[data-test="batch-start"]').element as HTMLButtonElement).disabled).toBe(true);
    expect((w.get('[aria-label="复核背景 1"]').element as HTMLInputElement).checked).toBe(true);
    await w.findAll('button').find(b=>b.text()==='取消本次导入')!.trigger('click');
    expect((w.get('[data-test="batch-start"]').element as HTMLButtonElement).disabled).toBe(false);
  });
  it('实验记录按来源匹配；版本 1、错误文件和取消覆盖均保留已有记录及复核',async()=>{
    const w=await preparedBatch();await w.get('[data-test="batch-confirm-all"]').trigger('click');
    const input=w.get('[data-test="batch-metadata-file"]');
    const record={sample_id:'合金 A',condition_name:'温度',condition_value:300,condition_unit:'K',replicate_id:'R1'};
    const archive={template_version:2,rows:[{id:'old',request:{source:{file_sha256:'a'.repeat(64),sheet:'s',x_column:'x',y_column:'b'}}}],experiment_metadata:{old:record}};
    async function load(data:unknown){Object.defineProperty(input.element,'files',{value:[{text:async()=>JSON.stringify(data),size:100}],configurable:true});await input.trigger('change');await flushPromises();}
    await load(archive);expect((w.get('[aria-label="谱线 2 样品编号"]').element as HTMLInputElement).value).toBe('合金 A');
    await load({template_version:1,rows:[]});expect(w.text()).toContain('当前记录保持不变');
    await load({...archive,experiment_metadata:{old:{...record,condition_value:'300'}}});expect(w.get('[role="alert"]').text()).toContain('有限数值');
    const confirm=vi.spyOn(protection,'confirmDiscard').mockResolvedValue(false);
    await load({...archive,experiment_metadata:{old:{...record,sample_id:'覆盖'}}});
    expect(confirm).toHaveBeenCalled();expect((w.get('[aria-label="谱线 2 样品编号"]').element as HTMLInputElement).value).toBe('合金 A');
    expect((w.get('[aria-label="复核背景 2"]').element as HTMLInputElement).checked).toBe(true);confirm.mockRestore();
  });
  it('条件排序只预览，应用后执行顺序与数值一致并保留样品关联',async()=>{
    const w=await preparedBatch(undefined,false);
    for(const [i,value] of [300,100,200].entries()){
      await w.get(`[aria-label="谱线 ${i+1} 条件名称"]`).setValue('温度');
      await w.get(`[aria-label="谱线 ${i+1} 条件单位"]`).setValue('K');
      await w.get(`[aria-label="谱线 ${i+1} 条件值"]`).setValue(value);
    }
    await w.get('.batch-order-controls select').setValue('condition');
    await w.findAll('button').find(b=>b.text()==='预览排序')!.trigger('click');
    expect(w.get('.batch-order-preview li').text()).toContain('/ b');
    expect((w.get('[aria-label="第 1 条 Y 列"]').element as HTMLSelectElement).value).toBe('a');
    await w.findAll('button').find(b=>b.text()==='应用此顺序')!.trigger('click');
    expect((w.get('[aria-label="谱线 1 条件值"]').element as HTMLInputElement).value).toBe('100');
    await w.get('[data-test="batch-units"]').setValue(true);await w.get('[data-test="batch-prepare"]').trigger('click');await flushPromises();
    await w.get('[data-test="batch-confirm-all"]').trigger('click');await w.get('[data-test="batch-start"]').trigger('click');await flushPromises();
    expect(vi.mocked(multi.fitMulti).mock.calls.map(([r])=>r.source?.y_column)).toEqual(['b','c','a']);
    await w.get('[data-test="batch-search"]').setValue('a');
    await w.get('[aria-label="定位谱线 1 的 p1"]').trigger('click');await flushPromises();
    expect(w.get('[data-test="batch-detail-title"]').text()).toContain('/ b');
    expect((w.get('[data-test="batch-search"]').element as HTMLInputElement).value).toBe('');
  });
  it('取消清空保留预检与复核，确认后清空结果但保留输入供新批次使用',async()=>{
    const w=await preparedBatch();await w.get('[data-test="batch-confirm-all"]').trigger('click');
    const confirm=vi.spyOn(protection,'confirmDiscard').mockResolvedValue(false);
    const clear=w.findAll('button').find(b=>b.text()==='新建批次（清空当前结果）')!;await clear.trigger('click');
    expect(w.find('[data-test="batch-results"]').exists()).toBe(true);expect(confirm).toHaveBeenCalled();
    confirm.mockResolvedValue(true);await clear.trigger('click');expect(w.find('[data-test="batch-results"]').exists()).toBe(false);confirm.mockRestore();
  });
  it('拖入多个文件时保留成功项，并说明失败文件；全部失败不清除已有复核',async()=>{
    const w=await preparedBatch();
    await w.get('[data-test="batch-confirm-all"]').trigger('click');
    await w.get('[data-test="batch-edit-inputs"]').trigger('click');
    vi.mocked(api.uploadDataset).mockRejectedValueOnce(new Error('不支持的文件'));
    await w.get('[data-test="batch-dropzone"]').trigger('drop',{dataTransfer:{files:[new File(['bad'],'bad.csv')]}});await flushPromises();
    expect(w.get('[role="alert"]').text()).toContain('bad.csv');
    expect((w.get('[aria-label="复核背景 1"]').element as HTMLInputElement).checked).toBe(true);
    vi.mocked(api.uploadDataset).mockRejectedValueOnce(new Error('格式错误')).mockResolvedValueOnce({dataset_id:'b',filename:'good.csv',file_sha256:'b'.repeat(64),sheets:[{name:'s',columns:['x','y'],numeric_columns:['x','y'],row_count:5,preview_rows:[]}]});
    await w.get('[data-test="batch-dropzone"]').trigger('drop',{dataTransfer:{files:[new File(['bad'],'bad2.csv'),new File(['x,y'],'good.csv')]}});await flushPromises();
    expect(w.find('[data-test="batch-selection"]').exists()).toBe(true);
    expect((w.get('[aria-label="复核背景 1"]').element as HTMLInputElement).checked).toBe(true);
    await w.get('[data-test="batch-select-all"]').trigger('click');await w.get('[data-test="batch-commit-selection"]').trigger('click');
    expect(w.get('[data-test="batch-import-summary"]').text()).toContain('2 个文件');
    expect(w.get('[data-test="batch-import-summary"]').text()).toContain('4 条谱线');
    expect(w.get('[role="alert"]').text()).toContain('bad2.csv');
    expect(w.find('[data-test="batch-results"]').exists()).toBe(false);
  });
  it('显式锚点的背景选择在预检前提示，不能直接进入错误预检',async()=>{
    const w=await preparedBatch(undefined,false);
    const template=(w.props() as any).template;
    await w.setProps({template:{...template,baseline:{...template.baseline,anchors:[{x:0,y:0},{x:4,y:0}]}}});
    await w.get('[data-test="batch-units"]').setValue(true);
    expect(w.get('[data-test="batch-prepare-hint"]').text()).toContain('模板含显式锚点');
    expect((w.get('[data-test="batch-prepare"]').element as HTMLButtonElement).disabled).toBe(true);
  });
  it('导入后展示摘要与明确下一步，预检前不展示空结果区',async()=>{
    const w=await preparedBatch(undefined,false);
    expect(w.get('[data-test="batch-import-summary"]').text()).toContain('1 个文件');
    expect(w.get('[data-test="batch-import-summary"]').text()).toContain('3 条谱线');
    expect(w.find('[data-test="batch-results"]').exists()).toBe(false);
    expect(w.get('[data-test="batch-prepare-hint"]').text()).toContain('单位');
    await w.get('[data-test="batch-units"]').setValue(true);
    await w.get('[data-test="batch-prepare"]').trigger('click');await flushPromises();
    expect((w.get('[data-test="batch-settings"]').element as HTMLDetailsElement).open).toBe(false);
    expect(w.get('[data-test="batch-step-review"]').attributes('aria-current')).toBe('step');
    expect(w.get('[data-test="batch-next-step"]').text()).toContain('3 条背景待复核');
  });
  it('返回修改只展开数据配置，修改列后才清除旧预检并回到导入阶段',async()=>{
    const w=await preparedBatch();
    await w.get('[data-test="batch-confirm-all"]').trigger('click');
    await w.get('[data-test="batch-edit-inputs"]').trigger('click');
    expect((w.get('[aria-label="复核背景 1"]').element as HTMLInputElement).checked).toBe(true);
    await w.get('[aria-label="第 1 条 Y 列"]').setValue('b');
    expect(w.find('[data-test="batch-results"]').exists()).toBe(false);
    expect(w.get('[data-test="batch-step-import"]').attributes('aria-current')).toBe('step');
    expect(w.find('[data-test="batch-undo-review"]').exists()).toBe(false);
  });
  it('预检失败自动定位失败谱，不能误显示为可运行',async()=>{
    const w=await preparedBatch('c');
    expect(w.get('[data-test="batch-detail-title"]').text()).toContain('/ c');
    expect(w.get('[data-test="batch-next-step"]').text()).toContain('1 条预检失败');
    expect(w.get('[data-test="batch-next-step"]').text()).not.toContain('可以开始');
  });
  it('全部预检失败时没有可复核项，不能生成复核记录或启动',async()=>{
    const w=await preparedBatch(undefined,false);vi.mocked(api.previewDataset).mockRejectedValue(new Error('原谱无效'));
    await w.get('[data-test="batch-units"]').setValue(true);await w.get('[data-test="batch-prepare"]').trigger('click');await flushPromises();
    expect(w.get('[data-test="batch-next-step"]').text()).toContain('3 条预检失败');
    expect((w.get('[data-test="batch-confirm-all"]').element as HTMLButtonElement).disabled).toBe(true);
    expect((w.get('[data-test="batch-start"]').element as HTMLButtonElement).disabled).toBe(true);
    expect(w.find('[data-test="batch-undo-review"]').exists()).toBe(false);expect(multi.fitMulti).not.toHaveBeenCalled();
  });
  it('逐谱复核后直接查看下一条，全部复核后提示开始但不自动求解',async()=>{
    const w=await preparedBatch();
    await w.get('[data-test="batch-confirm-next"]').trigger('click');
    expect(w.get('[data-test="batch-detail-title"]').text()).toContain('/ b');
    expect((w.get('[aria-label="复核背景 1"]').element as HTMLInputElement).checked).toBe(true);
    await w.get('[data-test="batch-confirm-all"]').trigger('click');
    expect(w.get('[data-test="batch-next-step"]').text()).toContain('可以开始拟合');
    expect(multi.fitMulti).not.toHaveBeenCalled();
  });
  it('方向键查看下一条时，焦点同步到新谱线按钮',async()=>{
    const w=await preparedBatch();
    const first=w.get('[aria-label="查看谱线 1"]');(first.element as HTMLButtonElement).focus();
    await first.trigger('keydown',{key:'ArrowDown'});await flushPromises();
    expect(document.activeElement).toBe(w.get('[aria-label="查看谱线 2"]').element);
  });
  it('全部复核覆盖筛选隐藏的有效谱线，跳过失败项；撤销保留原先的人工复核',async()=>{
    const w=await preparedBatch('c');
    await w.get('[aria-label="复核背景 1"]').setValue(true);
    await w.get('[data-test="batch-search"]').setValue('b');
    expect(w.findAll('[data-test="batch-row"]')).toHaveLength(1);
    await w.get('[data-test="batch-confirm-all"]').trigger('click');
    expect(w.get('[data-test="batch-review-message"]').text()).toContain('已标记 1 条');
    expect(w.get('[data-test="batch-review-message"]').text()).toContain('跳过 1 条');
    await w.get('[data-test="batch-confirm-all"]').trigger('click');
    await w.get('[data-test="batch-search"]').setValue('');
    expect((w.get('[aria-label="复核背景 2"]').element as HTMLInputElement).checked).toBe(true);
    expect((w.get('[aria-label="复核背景 3"]').element as HTMLInputElement).checked).toBe(false);
    await w.get('[data-test="batch-undo-review"]').trigger('click');
    expect((w.get('[aria-label="复核背景 1"]').element as HTMLInputElement).checked).toBe(true);
    expect((w.get('[aria-label="复核背景 2"]').element as HTMLInputElement).checked).toBe(false);
    expect((w.get('[data-test="batch-start"]').element as HTMLButtonElement).disabled).toBe(true);
  });
  it('预检失效后不允许使用旧复核和撤销记录',async()=>{
    const w=await preparedBatch();
    await w.get('[data-test="batch-confirm-all"]').trigger('click');
    expect((w.get('[data-test="batch-start"]').element as HTMLButtonElement).disabled).toBe(false);
    await w.get('[data-test="batch-units"]').setValue(false);
    expect(w.find('[data-test="batch-undo-review"]').exists()).toBe(false);
    expect(w.find('[data-test="batch-confirm-all"]').exists()).toBe(false);
  });
  it('待复核计入已计算数量，暂停定位异常谱，继续运行前仍需接受拟合警告',async()=>{
    const w=await preparedBatch();
    vi.mocked(multi.fitMulti).mockImplementation(async request=>({configuration:request,converged:true,statistics:{rmse:190},components:[{id:'p1',parameters:{xc:{value:2}},area_total:3}],diagnostics:{identifiable:false,bound_parameters:[],strong_correlations:[],warnings:[]}} as any));
    await w.get('[data-test="batch-confirm-all"]').trigger('click');
    await w.get('[aria-label="查看谱线 2"]').trigger('click');
    await w.get('[data-test="batch-start"]').trigger('click');await flushPromises();
    expect(w.get('[data-test="batch-status"]').text()).toContain('已计算 1 / 3');
    expect(w.get('[data-test="batch-status"]').text()).toContain('待复核 1');
    expect(w.get('[data-test="batch-detail-title"]').text()).toContain('a');
    expect(w.get('[data-test="batch-warning"]').text()).toContain('峰分量不可独立辨识');
    expect((w.get('[data-test="batch-start"]').element as HTMLButtonElement).disabled).toBe(true);
    expect((w.get('[data-test="batch-confirm-all"]').element as HTMLButtonElement).disabled).toBe(true);
    expect((w.get('[data-test="batch-settings"]').element as HTMLDetailsElement).open).toBe(false);
  });
  it('搜索和上下条只浏览可见谱线，不改变实际执行顺序',async()=>{
    const w=await preparedBatch();
    await w.get('[data-test="batch-search"]').setValue('b');
    expect(w.findAll('[data-test="batch-row"]')).toHaveLength(1);
    await w.get('[aria-label="查看谱线 2"]').trigger('click');
    expect(w.get('[data-test="batch-detail-title"]').text()).toContain('b');
    await w.get('[data-test="batch-search"]').setValue('');
    await w.get('[data-test="batch-next"]').trigger('click');
    expect(w.get('[data-test="batch-detail-title"]').text()).toContain('c');
    await w.get('[data-test="batch-confirm-all"]').trigger('click');
    await w.get('[data-test="batch-start"]').trigger('click');await flushPromises();
    expect(vi.mocked(multi.fitMulti).mock.calls.map(([r])=>r.source?.y_column)).toEqual(['a','b','c']);
  });
  it('运行完成不抢走用户查看的谱线，运行时禁止全部复核',async()=>{
    const w=await preparedBatch();
    const original=vi.mocked(multi.fitMulti).getMockImplementation()!;
    let resolve!:()=>void;
    const pending=new Promise<void>(r=>{resolve=r;});
    vi.mocked(multi.fitMulti).mockImplementationOnce(async request=>{await pending;return original(request);});
    await w.get('[data-test="batch-confirm-all"]').trigger('click');
    await w.get('[data-test="batch-start"]').trigger('click');await flushPromises();
    expect((w.get('[data-test="batch-confirm-all"]').element as HTMLButtonElement).disabled).toBe(true);
    await w.get('[aria-label="查看谱线 2"]').trigger('click');
    resolve();await flushPromises();
    expect(w.get('[data-test="batch-detail-title"]').text()).toContain('b');
    expect(w.get('[data-test="batch-status"]').text()).toContain('已结束');
  });
});
describe('批量界面',()=>{
  it.each([true,false])('导入两个Y列并执行，顺序继承=%s',async(sequential)=>{
    vi.clearAllMocks();
    const Component=(await import('./components/BatchWorkbench.vue')).default;
    const c=createMultiConfig([0,1,2,3,4],[0,1,3,1,0],null,'general');c.baseline.kind='none';addMultiComponent(c);
    vi.mocked(api.uploadDataset).mockResolvedValue({dataset_id:'a',filename:'a.csv',file_sha256:'a'.repeat(64),sheets:[{name:'s',columns:['x','a','b'],numeric_columns:['x','a','b'],row_count:5,preview_rows:[]}]});
    vi.mocked(api.previewDataset).mockResolvedValue({x:c.x,y:c.y});
    vi.mocked(multi.validateMultiInput).mockResolvedValue({x:c.x,raw_y:c.y,baseline:c.x.map(()=>0),baseline_configuration:{...c.baseline,resolved_anchors:[]}});
    vi.mocked(multi.fitMulti).mockImplementation(async request=>({configuration:request,converged:true,statistics:{rmse:0},components:[{id:'p1',parameters:{A:{value:3},xc:{value:2.1},w:{value:1},mu:{value:.3}}}],diagnostics:{identifiable:true,bound_parameters:[],strong_correlations:[],warnings:[]}} as any));
    const w=mount(Component,{props:{template:c},global:{stubs:{MultiPeakChart:true,MultiPeakResults:true}}});
    const file=w.get('input[type=file][multiple]');Object.defineProperty(file.element,'files',{value:[new File(['x,a,b'],'a.csv')]});await file.trigger('change');await flushPromises();
  await w.get('[data-test="batch-select-all"]').trigger('click');await w.get('[data-test="batch-commit-selection"]').trigger('click');await flushPromises();
    await w.get('[data-test="batch-strategy"]').setValue(String(sequential));
    await w.get('[data-test="batch-units"]').setValue(true);
    await w.get('[data-test="batch-prepare"]').trigger('click');await flushPromises();
    await w.get('[data-test="batch-start"]').trigger('click');await flushPromises();
    expect(w.get('[data-test="batch-status"]').text()).toContain('已结束');
    expect(vi.mocked(multi.fitMulti).mock.calls[1][0].components[0].parameters.xc!.value).toBe(sequential?2.1:2);w.unmount();
  });
  it('没有模板时不能开始，模板带入后清楚显示顺序继承模式',async()=>{
    const modules=import.meta.glob('./components/BatchWorkbench.vue');expect(modules['./components/BatchWorkbench.vue']).toBeDefined();
    const Component=(await modules['./components/BatchWorkbench.vue']() as any).default;
    const w=mount(Component,{props:{template:null}});
    expect(w.text()).toContain('从单谱建立模板');
    const c=createMultiConfig([0,1,2,3],[0,1,2,0],null,'general');addMultiComponent(c);await w.setProps({template:c});await flushPromises();
    expect(w.text()).toContain('上一条获准结果');expect(w.find('[data-test="batch-prepare"]').exists()).toBe(true);w.unmount();
  });
  it('空页面可返回单谱或加载同类型模板；类型错误和无效 JSON 保留现有模板',async()=>{
    const Component=(await import('./components/BatchWorkbench.vue')).default;
    const c=createMultiConfig([0,1,2,3,4],[0,1,3,1,0],{filename:'a.csv',file_sha256:'a'.repeat(64),sheet:'s',x_column:'x',y_column:'y'},'xrd');addMultiComponent(c);
    const w=mount(Component,{props:{template:null,analysisMode:'xrd'}});
    await w.get('[data-test="batch-from-single"]').trigger('click');expect(w.emitted('single')).toHaveLength(1);
    const input=w.get('[data-test="batch-template-file"]');
    async function load(text:string){Object.defineProperty(input.element,'files',{value:[{text:async()=>text}],configurable:true});await input.trigger('change');await flushPromises();}
    await load(JSON.stringify({configuration:c}));
    expect(w.text()).toContain('XRD · 顺序拟合');expect(w.text()).toContain('1 个启用峰');
    await load(JSON.stringify({configuration:{...c,analysis_mode:'general'}}));
    expect(w.get('[role="alert"]').text()).toContain('类型');expect(w.text()).toContain('1 个启用峰');
    await load('{');expect(w.find('[role="alert"]').exists()).toBe(true);expect(w.text()).toContain('1 个启用峰');w.unmount();
  });
});
