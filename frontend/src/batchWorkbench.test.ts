import * as protection from './useWorkProtection';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { addMultiComponent, createMultiConfig } from './multipeakState';
import * as api from './api';
import * as multi from './multipeakApi';
import * as batchExports from './batchExport';
import { createConfig as createXpsConfig, addComponent as addXpsComponent } from './xpsState';
import { BatchRunner } from './batchRunner';
vi.mock('plotly.js-dist-min',()=>({default:{register:vi.fn(),react:vi.fn((el:any)=>{el.on=vi.fn();el.removeAllListeners=vi.fn();return Promise.resolve();}),purge:vi.fn(),downloadImage:vi.fn()}}));
vi.mock('./api',()=>({uploadDataset:vi.fn(),previewDataset:vi.fn()}));
vi.mock('./multipeakApi',()=>({validateMultiInput:vi.fn(),fitMulti:vi.fn()}));

const wrappers: ReturnType<typeof mount>[]=[];
beforeEach(()=>{
  Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,writable:true,value:function(){this.setAttribute('open','');}});
  Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,writable:true,value:function(){this.removeAttribute('open');this.dispatchEvent(new Event('close'));}});
});
afterEach(()=>{wrappers.splice(0).forEach(w=>w.unmount());vi.restoreAllMocks();vi.resetAllMocks();});
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
  vi.mocked(multi.fitMulti).mockImplementation(async request=>({configuration:request,x:request.x,raw_y:request.y,baseline:request.x.map(()=>0),total_y:request.y,residuals:request.x.map(()=>0),converged:true,statistics:{rmse:.5},components:[{id:'p1',label:'峰1',parameters:{A:{value:3},xc:{value:2.1},w:{value:1},mu:{value:.3}},area_total:3,fwhm:1}],diagnostics:{identifiable:true,bound_parameters:[],strong_correlations:[],warnings:[]}} as any));
  const w=mount(Component,{attachTo:document.body,props:{template:c},global:{stubs:{MultiPeakChart:true,MultiPeakResults:true,BatchResultChart:true}}});wrappers.push(w);
  const file=w.get('input[type=file][multiple]');Object.defineProperty(file.element,'files',{value:[new File(['x,a,b,c'],'sample.csv')]});await file.trigger('change');await flushPromises();
  await w.get('[data-test="batch-select-all"]').trigger('click');await w.get('[data-test="batch-commit-selection"]').trigger('click');await flushPromises();
  if(prepare){await w.get('[data-test="batch-units"]').setValue(true);
    await w.get('[data-test="batch-prepare"]').trigger('click');await flushPromises();}
  return w;
}

describe('批量结果浏览与背景复核',()=>{
  it('失败项快捷入口清除筛选并定位，展开结果不重新运行拟合',async()=>{
    const w=await preparedBatch(),original=vi.mocked(multi.fitMulti).getMockImplementation()!;
    vi.mocked(multi.fitMulti).mockImplementation(async request=>{
      if(request.source?.y_column==='b')throw new Error('测试求解失败');
      return original(request);
    });
    await w.get('[data-test="batch-confirm-all"]').trigger('click');
    await w.get('[data-test="batch-start"]').trigger('click');await flushPromises();
    await w.get('[data-test="batch-view-3"]').trigger('click');
    await w.get('[data-test="batch-search"]').setValue('c');
    await w.get('[data-test="batch-locate-failure"]').trigger('click');await flushPromises();
    expect(w.get('[data-test="batch-detail-title"]').text()).toContain('/ b');
    expect(w.findAll('[data-test="batch-row"]')).toHaveLength(3);
    expect(w.get('[data-test="batch-warning"]').text()).toContain('测试求解失败');
    const calls=vi.mocked(multi.fitMulti).mock.calls.length;
    await w.get('[data-test="batch-expand-results"]').trigger('click');
    expect(w.classes()).toContain('results-expanded');
    expect(w.get('[data-test="batch-expand-results"]').attributes('aria-expanded')).toBe('true');
    await w.get('[data-test="batch-expand-results"]').trigger('click');
    expect(w.classes()).not.toContain('results-expanded');
    expect(multi.fitMulti).toHaveBeenCalledTimes(calls);
  });
  it('批量复核所选跨筛选保留，查看谱线不勾选，撤销不影响原有复核',async()=>{
    const w=await preparedBatch();
    await w.get('[data-test="batch-confirm-current"]').trigger('click');
    await w.get('[data-test="batch-bulk-toggle"]').trigger('click');
    expect(w.get('[aria-label="选择批量复核谱线 1"]').attributes('disabled')).toBeDefined();
    await w.get('[aria-label="选择批量复核谱线 2"]').setValue(true);
    await w.get('[data-test="batch-view-3"]').trigger('click');
    expect((w.get('[aria-label="选择批量复核谱线 3"]').element as HTMLInputElement).checked).toBe(false);
    await w.get('[data-test="batch-search"]').setValue('no-match');
    expect(w.get('[data-test="batch-bulk-scope"]').text()).toContain('1 条在筛选之外');
    await w.get('[data-test="batch-confirm-selected"]').trigger('click');
    await w.get('[data-test="batch-search"]').setValue('');
    expect([1,2,3].map(i=>(w.get(`[aria-label="复核背景 ${i}"]`).element as HTMLInputElement).checked)).toEqual([true,true,false]);
    await w.get('[data-test="batch-undo-review"]').trigger('click');
    expect([1,2,3].map(i=>(w.get(`[aria-label="复核背景 ${i}"]`).element as HTMLInputElement).checked)).toEqual([true,false,false]);
  });
  it('全选当前筛选只选择有效待复核项，全部复核明确包含隐藏项并跳过失败',async()=>{
    const w=await preparedBatch('c');
    await w.get('[data-test="batch-bulk-toggle"]').trigger('click');
    expect(w.get('[aria-label="选择批量复核谱线 3"]').attributes('disabled')).toBeDefined();
    await w.get('[data-test="batch-search"]').setValue('b');
    await w.get('[data-test="batch-select-visible"]').trigger('click');
    expect(w.get('[data-test="batch-confirm-selected"]').text()).toContain('1 条');
    expect(w.get('[data-test="batch-confirm-all"]').text()).toContain('2 条');
    expect(w.get('[data-test="batch-bulk-scope"]').text()).toContain('包含筛选隐藏项');
    await w.get('[data-test="batch-confirm-all"]').trigger('click');
    expect(w.get('[data-test="batch-review-message"]').text()).toContain('跳过 1 条');
    expect(w.get('[data-test="batch-bulk-toggle"]').text()).toContain('无可复核项');
    await w.get('[data-test="batch-undo-review"]').trigger('click');
    expect(w.get('[data-test="batch-bulk-toggle"]').attributes('disabled')).toBeUndefined();
  });
  it('全部已复核提示、失效清空选择及已结束批次锁定沿用原规则',async()=>{
    const w=await preparedBatch();
    await w.get('[data-test="batch-bulk-toggle"]').trigger('click');
    await w.get('[data-test="batch-select-visible"]').trigger('click');
    await w.get('[data-test="batch-edit-inputs"]').trigger('click');
    await w.get('[aria-label="第 1 条 Y 列"]').setValue('b');
    await w.get('[data-test="batch-prepare"]').trigger('click');await flushPromises();
    await w.get('[data-test="batch-bulk-toggle"]').trigger('click');
    expect(w.get('[data-test="batch-confirm-selected"]').attributes('disabled')).toBeDefined();
    await w.get('[data-test="batch-confirm-all"]').trigger('click');
    expect(w.get('[data-test="batch-bulk-toggle"]').text()).toBe('全部已复核');
    await w.get('[aria-label="收起批量复核操作"]').trigger('click');await flushPromises();
    expect(document.activeElement).toBe(w.get('[data-test="batch-open-overview"]').element);
    await w.get('[data-test="batch-start"]').trigger('click');await flushPromises();
    await w.get('[data-test="batch-step-review"]').trigger('click');
    expect(w.get('[data-test="batch-bulk-toggle"]').attributes('disabled')).toBeDefined();
    expect(w.get('[data-test="batch-confirm-all"]').attributes('disabled')).toBeDefined();
    expect(w.find('[data-test="batch-undo-review"]').exists()).toBe(false);
  });
  it('折叠配置打开后可键盘操作，Esc 收起返回入口焦点',async()=>{
    const w=await preparedBatch(undefined,false),trigger=w.get('.setup-footer .setup-config-toggle');
    await trigger.trigger('click');await flushPromises();
    expect(document.activeElement).toBe(w.get('.setup-config').element);
    await w.get('.setup-config').trigger('keydown',{key:'Escape'});await flushPromises();
    expect(trigger.attributes('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger.element);
  });
  it('导入工作台沿用人工确认和映射失效规则，排除不删除数据且顺序绑定实际执行',async()=>{
    const w=await preparedBatch(undefined,false);
    expect(w.classes()).toContain('is-import-workbench');
    expect(w.emitted('importLayout')?.at(-1)).toEqual([true]);
    expect((w.get('[data-test="batch-units"]').element as HTMLInputElement).checked).toBe(false);
    await w.get('[aria-label="谱线 2 样品编号"]').setValue('sample-b');
    await w.get('[aria-label="纳入 1"]').setValue(false);
    expect(w.findAll('.batch-input-table tbody tr')).toHaveLength(3);
    expect(w.get('[data-test="batch-import-summary"]').text()).toContain('2 条谱线参与拟合');
    expect(w.findAll('.setup-sequence').map(e=>e.text())).toEqual(['—','1','2']);
    await w.get('[aria-label="上移 2"]').trigger('click');
    expect((w.get('[aria-label="谱线 1 样品编号"]').element as HTMLInputElement).value).toBe('sample-b');
    await w.get('[data-test="batch-units"]').setValue(true);
    await w.get('[data-test="batch-prepare"]').trigger('click');await flushPromises();
    expect(vi.mocked(multi.validateMultiInput).mock.calls.map(([r])=>r.source?.y_column)).toEqual(['b','c']);
    await w.get('[data-test="batch-step-import"]').trigger('click');
    await w.get('[aria-label="第 1 条 Y 列"]').setValue('a');
    // 现有规则只失效预检与复核，不擅自重置人工勾选。
    expect((w.get('[data-test="batch-units"]').element as HTMLInputElement).checked).toBe(true);
    expect(w.get('[data-test="batch-step-review"]').attributes('disabled')).toBeDefined();
    expect(w.get('.setup-mapping-state').text()).toBe('已映射 · 待预检');
  });
  it('单谱复核工作台、总览与缩略图共享选择和真实复核状态',async()=>{
    const w=await preparedBatch();
    expect(w.classes()).toContain('is-review-workbench');
    expect(w.find('[data-test="batch-overview-view"]').isVisible()).toBe(false);
    await w.get('[data-test="batch-open-overview"]').trigger('click');
    await w.get('[data-test="batch-overview-view"] [aria-label^="查看背景 2"]').trigger('click');
    expect(w.get('[data-test="batch-detail-title"]').text()).toContain('/ b');
    await w.get('[data-test="batch-confirm-current"]').trigger('click');
    expect((w.get('[aria-label="复核背景 2"]').element as HTMLInputElement).checked).toBe(true);
    expect(w.get('[data-row-index="1"] .batch-state').text()).toBe('✓ 背景已复核');
    await w.get('[data-test="batch-revoke-current"]').trigger('click');
    expect((w.get('[aria-label="复核背景 2"]').element as HTMLInputElement).checked).toBe(false);
    await w.get('[data-test="batch-confirm-next"]').trigger('click');
    expect(w.get('[data-test="batch-detail-title"]').text()).toContain('/ c');
    await w.get('[data-test="batch-confirm-next"]').trigger('click');
    await w.get('[data-test="batch-confirm-next"]').trigger('click');
    expect(w.get('[data-test="batch-review-message"]').text()).toContain('全部');
    await w.get('[data-test="batch-start"]').trigger('click');await flushPromises();
    expect(multi.fitMulti).toHaveBeenCalledTimes(3);
    expect(vi.mocked(multi.fitMulti).mock.calls.every(([r])=>r.baseline.confirmed)).toBe(true);
  });
  it('左右切换仅作用于复核区，输入与下拉编辑不截获',async()=>{
    const w=await preparedBatch();
    await w.get('[data-test="batch-review-stage"]').trigger('keydown',{key:'ArrowRight'});
    expect(w.get('[data-test="batch-detail-title"]').text()).toContain('/ b');
    await w.get('[data-test="batch-search"]').trigger('keydown',{key:'ArrowRight'});
    await w.get('[data-test="batch-filter"]').trigger('keydown',{key:'ArrowRight'});
    expect(w.get('[data-test="batch-detail-title"]').text()).toContain('/ b');
  });
  it('连续切换使用列表自己的坐标滚动，不受侧栏搜索区偏移影响',async()=>{
    const w=await preparedBatch(),list=w.get('.batch-list').element as HTMLElement;
    Object.defineProperty(list,'clientHeight',{value:100});
    vi.spyOn(list,'getBoundingClientRect').mockReturnValue({top:200} as DOMRect);
    const row=w.get('[data-row-index="1"]').element as HTMLElement;
    Object.defineProperty(row,'offsetHeight',{value:80});
    vi.spyOn(row,'getBoundingClientRect').mockReturnValue({top:320} as DOMRect);
    await w.get('[data-test="batch-next"]').trigger('click');await flushPromises();
    expect(list.scrollTop).toBe(100);
  });
  it.each([['general','X 单位'],['xrd','°'],['xps','eV']] as const)('%s 恢复后导出保留正确单位且不能绕过背景复核',async(mode,unit)=>{
    const config=mode==='xps'?createXpsConfig([0,1,2,3],[0,1,2,0],null):createMultiConfig([0,1,2,3],[0,1,2,0],null,mode);
    if('analysis_mode' in config)addMultiComponent(config);else addXpsComponent(config);
    const runner=new BatchRunner([{id:'mode-row',label:'模式谱线',request:config}]);
    const Component=(await import('./components/BatchWorkbench.vue')).default;
    const w=mount(Component,{attachTo:document.body,props:{template:null,analysisMode:mode},global:{stubs:{BatchResultChart:true}}});wrappers.push(w);await flushPromises();
    (w.vm as any).restoreSession({kind:'batch',template:config,batch_id:runner.id,status:runner.status,sequential:true,rows:runner.rows,metadata:{'mode-row':{sample_id:'',replicate_id:'',condition_name:'',condition_value:null,condition_unit:''}},audits:{}});await flushPromises();
    expect(w.get('[data-test="batch-step-review"]').attributes('aria-selected')).toBe('true');
    expect((w.get('[data-test="batch-start"]').element as HTMLButtonElement).disabled).toBe(true);
    await w.get('[data-test="batch-step-export"]').trigger('click');
    expect(w.get('[data-test="batch-export-panel"]').text()).toContain(`峰顶位置 / ${unit}`);
    const trend=vi.spyOn(batchExports,'exportBatchTrend').mockImplementation(()=>{});
    await w.get('[data-test="export-trend"]').trigger('click');expect(trend.mock.calls[0][2].unit).toBe(unit);
    expect(multi.fitMulti).not.toHaveBeenCalled();
  });
  it('返回背景页不覆盖未应用初值，且清除不适用的结果状态筛选',async()=>{
    const w=await preparedBatch();await w.get('[data-test="batch-confirm-all"]').trigger('click');
    await w.get('[data-test="batch-start"]').trigger('click');await flushPromises();
    await w.get('input[max="20000"]').setValue(4321);
    await w.get('[data-test="batch-filter"]').setValue('success');
    await w.get('[data-test="batch-step-review"]').trigger('click');
    expect((w.get('[data-test="batch-filter"]').element as HTMLSelectElement).value).toBe('all');
    expect(w.findAll('[data-test="batch-row"]')).toHaveLength(3);
    expect(w.get('[aria-label="整批背景概览"]').isVisible()).toBe(false);
    await w.get('[data-test="batch-open-overview"]').trigger('click');
    expect(w.get('[aria-label="整批背景概览"]').isVisible()).toBe(true);
    await w.get('[data-test="batch-step-results"]').trigger('click');
    expect((w.get('input[max="20000"]').element as HTMLInputElement).value).toBe('4321');
  });
  it('导出失败时只提示错误，重试成功才提示下载且不重新拟合',async()=>{
    const w=await preparedBatch();await w.get('[data-test="batch-confirm-all"]').trigger('click');
    await w.get('[data-test="batch-start"]').trigger('click');await flushPromises();
    await w.get('[data-test="batch-step-export"]').trigger('click');
    const fit=vi.spyOn(batchExports,'exportBatch').mockImplementationOnce(()=>{throw new Error('文件生成失败');}).mockImplementation(()=>{});
    await w.get('[data-test="export-fit"]').trigger('click');
    const panel=w.get('[data-test="batch-export-panel"]');
    expect(panel.get('[role="alert"]').text()).toContain('文件生成失败');
    expect(panel.text()).not.toContain('已发起');expect(panel.text()).not.toContain('已生成');
    await w.get('[data-test="export-fit"]').trigger('click');
    expect(panel.find('[role="alert"]').exists()).toBe(false);expect(panel.text()).toContain('已发起');
    expect(fit).toHaveBeenCalledTimes(2);
    await w.get('[aria-label="拟合结果导出范围"]').setValue('all');expect(panel.text()).not.toContain('已发起');
    const trend=vi.spyOn(batchExports,'exportBatchTrend').mockImplementationOnce(()=>{throw new Error('趋势生成失败');}).mockImplementation(()=>{});
    await w.get('[data-test="export-trend"]').trigger('click');expect(panel.get('[role="alert"]').text()).toContain('趋势生成失败');
    await w.get('[data-test="export-trend"]').trigger('click');expect(panel.find('[role="alert"]').exists()).toBe(false);
    expect(panel.text()).toContain('已发起');expect(trend).toHaveBeenCalledTimes(2);expect(multi.fitMulti).toHaveBeenCalledTimes(3);
  });
  it('导出状态随范围变化，待复核和失败入口清除筛选并准确定位',async()=>{
    const w=await preparedBatch(),original=vi.mocked(multi.fitMulti).getMockImplementation()!;
    vi.mocked(multi.fitMulti).mockImplementation(async request=>{
      if(request.source?.y_column==='b')throw new Error('测试失败');
      const r=await original(request);
      if(request.source?.y_column==='a')r.diagnostics.bound_parameters=['p1.A'];return r;
    });
    await w.get('[data-test="batch-confirm-all"]').trigger('click');await w.get('[data-test="batch-start"]').trigger('click');await flushPromises();
    await w.get('[data-test="batch-view-3"]').trigger('click');await w.get('[data-test="batch-search"]').setValue('c');
    await w.get('[data-test="batch-step-export"]').trigger('click');
    const panel=w.get('[data-test="batch-export-panel"]');
    expect(panel.get('[data-test="export-status-summary"]').text()).toContain('已完成计算 1');
    expect(panel.find('[data-test="export-review"]').exists()).toBe(false);
    await w.get('[aria-label="拟合结果导出范围"]').setValue('all');
    expect(panel.get('[data-test="export-status-summary"]').text()).toContain('待复核 1');
    expect(panel.get('[data-test="export-status-summary"]').text()).toContain('失败 1');
    const calls=vi.mocked(multi.fitMulti).mock.calls.length;
    await panel.get('[data-test="export-review"]').trigger('click');await flushPromises();
    expect(w.get('[data-test="batch-step-results"]').attributes('aria-selected')).toBe('true');
    expect(w.get('[data-test="batch-detail-title"]').text()).toContain('/ a');
    expect(w.findAll('[data-test="batch-row"]')).toHaveLength(3);
    await w.get('[data-test="batch-step-export"]').trigger('click');
    await w.get('[aria-label="拟合结果导出范围"]').setValue('all');
    await w.get('[data-test="export-failed"]').trigger('click');await flushPromises();
    expect(w.get('[data-test="batch-detail-title"]').text()).toContain('/ b');
    expect(w.get('[data-test="batch-warning"]').text()).toContain('测试失败');
    expect(multi.fitMulti).toHaveBeenCalledTimes(calls);
  });
  it('统一导出绑定当前谱、整个批次及当前趋势选择',async()=>{
    const w=await preparedBatch();await w.get('[data-test="batch-confirm-all"]').trigger('click');
    await w.get('[data-test="batch-start"]').trigger('click');await flushPromises();
    await w.get('[data-test="batch-view-2"]').trigger('click');
    const fit=vi.spyOn(batchExports,'exportBatch').mockImplementation(()=>{});
    const trend=vi.spyOn(batchExports,'exportBatchTrend').mockImplementation(()=>{});
    await w.get('[data-test="batch-step-export"]').trigger('click');
    await w.get('[data-test="export-fit"]').trigger('click');
    expect(fit.mock.calls[0][0].rows.map(row=>row.request.source?.y_column)).toEqual(['b']);
    await w.get('[aria-label="拟合结果导出范围"]').setValue('all');
    await w.get('[aria-label="拟合结果导出内容"]').setValue('configuration');
    await w.get('[data-test="export-fit"]').trigger('click');
    expect(fit.mock.calls[1][0].rows).toHaveLength(3);expect(fit.mock.calls[1][1]).toBe('json');
    await w.get('[data-test="batch-step-trend"]').trigger('click');
    await w.get('[aria-label="趋势指标"]').setValue('area_window');
    await w.get('[data-test="batch-step-export"]').trigger('click');
    await w.get('[data-test="export-trend"]').trigger('click');
    expect(trend.mock.calls[0][0]).toHaveLength(3);expect(trend.mock.calls[0][2]).toEqual({peak:'p1',metric:'area_window',axis:'sequence',unit:'X 单位'});
    expect(multi.fitMulti).toHaveBeenCalledTimes(3);
  });
  it('运行时切页和导出不打断队列，完成后保留当前页面',async()=>{
    const w=await preparedBatch();const original=vi.mocked(multi.fitMulti).getMockImplementation()!;
    let release!:()=>void;const wait=new Promise<void>(resolve=>{release=resolve;});
    vi.mocked(multi.fitMulti).mockImplementationOnce(async request=>{await wait;return original(request);});
    await w.get('[data-test="batch-confirm-all"]').trigger('click');
    await w.get('[data-test="batch-start"]').trigger('click');await flushPromises();
    await w.get('[data-test="batch-step-export"]').trigger('click');
    const fit=vi.spyOn(batchExports,'exportBatch').mockImplementation(()=>{});
    await w.get('[data-test="export-fit"]').trigger('click');expect(fit).toHaveBeenCalledTimes(1);
    expect(w.get('[data-test="batch-export-panel"]').text()).toContain('批次正在运行');
    release();await flushPromises();
    expect(multi.fitMulti).toHaveBeenCalledTimes(3);
    expect(w.get('[data-test="batch-step-export"]').attributes('aria-selected')).toBe('true');
    await w.get('[data-test="batch-step-export"]').trigger('keydown',{key:'Home'});
    expect(w.get('[data-test="batch-step-import"]').attributes('aria-selected')).toBe('true');
    await w.get('[data-test="batch-step-import"]').trigger('keydown',{key:'End'});
    expect(w.get('[data-test="batch-step-export"]').attributes('aria-selected')).toBe('true');
  });
  it('五项导航隔离面板，趋势设置跨页保留且定位返回结果，不重复求解',async()=>{
    const w=await preparedBatch();
    expect(w.findAll('.batch-flow [role="tab"]')).toHaveLength(5);
    expect(w.get('[data-test="batch-step-review"]').attributes('aria-selected')).toBe('true');
    expect(w.get('[data-test="batch-step-trend"]').attributes('disabled')).toBeDefined();
    await w.get('[data-test="batch-confirm-all"]').trigger('click');
    await w.get('[data-test="batch-start"]').trigger('click');await flushPromises();
    await w.get('[data-test="batch-step-trend"]').trigger('click');await flushPromises();
    expect(w.get('[data-test="batch-results"]').isVisible()).toBe(false);
    await w.get('[aria-label="趋势指标"]').setValue('area_total');
    await w.get('[data-test="batch-step-export"]').trigger('click');
    expect(w.get('[data-test="batch-export-panel"]').text()).toContain('全域面积');
    expect(w.find('[aria-label="趋势指标"]').exists()).toBe(false);
    await w.get('[data-test="batch-step-trend"]').trigger('click');await flushPromises();
    expect((w.get('[aria-label="趋势指标"]').element as HTMLSelectElement).value).toBe('area_total');
    await w.get('[aria-label="定位谱线 2 的 p1"]').trigger('click');await flushPromises();
    expect(w.get('[data-test="batch-step-results"]').attributes('aria-selected')).toBe('true');
    expect(w.get('[data-test="batch-detail-title"]').text()).toContain('b');
    expect(multi.fitMulti).toHaveBeenCalledTimes(3);
  });
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
    await w.get('[data-test="batch-step-trend"]').trigger('click');await flushPromises();
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
    expect(w.get('[data-test="batch-settings"]').isVisible()).toBe(false);
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
    const first=w.get('[data-test="batch-view-1"]');(first.element as HTMLButtonElement).focus();
    await first.trigger('keydown',{key:'ArrowDown'});await flushPromises();
    expect(document.activeElement).toBe(w.get('[data-test="batch-view-2"]').element);
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
  it('默认算完所有曲线，保留待复核警告且运行后可逐条接受',async()=>{
    const w=await preparedBatch();
    vi.mocked(multi.fitMulti).mockImplementation(async request=>({configuration:request,x:request.x,raw_y:request.y,baseline:request.x.map(()=>0),total_y:request.y,residuals:request.x.map(()=>0),converged:true,statistics:{rmse:190},components:[{id:'p1',parameters:{xc:{value:2}},area_total:3}],diagnostics:{identifiable:false,bound_parameters:[],strong_correlations:[],warnings:[]}} as any));
    await w.get('[data-test="batch-confirm-all"]').trigger('click');
    await w.get('[data-test="batch-view-2"]').trigger('click');
    await w.get('[data-test="batch-start"]').trigger('click');await flushPromises();
    expect(w.get('[data-test="batch-status"]').text()).toContain('已计算 3 / 3');
    expect(w.get('[data-test="batch-status"]').text()).toContain('待复核 3');
    expect(w.get('[data-test="batch-status"]').text()).toContain('已结束');
    expect(w.get('[data-test="batch-detail-title"]').text()).toContain('b');
    expect(w.get('[data-test="batch-warning"]').text()).toContain('峰分量不可独立辨识');
    expect((w.get('[data-test="batch-start"]').element as HTMLButtonElement).disabled).toBe(true);
    await w.get('[data-test="batch-step-review"]').trigger('click');
    expect((w.get('[data-test="batch-confirm-all"]').element as HTMLButtonElement).disabled).toBe(true);
    await w.get('[data-test="batch-step-results"]').trigger('click');
    expect(w.get('[data-test="batch-settings"]').isVisible()).toBe(false);
    await w.findAll('button').find(b=>b.text()==='接受当前结果')!.trigger('click');
    expect(w.get('[data-test="batch-status"]').text()).toContain('待复核 2');expect(multi.fitMulti).toHaveBeenCalledTimes(3);
    const saved=(w.vm as any).sessionState();(w.vm as any).restoreSession(saved);await flushPromises();
    await w.findAll('button').find(b=>b.text()==='重新预览恢复背景')!.trigger('click');await flushPromises();
    await w.get('[data-test="batch-confirm-all"]').trigger('click');
    expect((w.get('[data-test="batch-start"]').element as HTMLButtonElement).disabled).toBe(false);
    await w.get('[data-test="batch-start"]').trigger('click');await flushPromises();
    await w.findAll('button').find(b=>b.text()==='接受当前结果')!.trigger('click');
    expect(w.get('[data-test="batch-status"]').text()).toContain('待复核 1');expect(multi.fitMulti).toHaveBeenCalledTimes(3);
  });
  it('搜索和上下条只浏览可见谱线，不改变实际执行顺序',async()=>{
    const w=await preparedBatch();
    await w.get('[data-test="batch-search"]').setValue('b');
    expect(w.findAll('[data-test="batch-row"]')).toHaveLength(1);
    await w.get('[data-test="batch-view-2"]').trigger('click');
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
    await w.get('[data-test="batch-step-review"]').trigger('click');
    expect((w.get('[data-test="batch-confirm-all"]').element as HTMLButtonElement).disabled).toBe(true);
    await w.get('[data-test="batch-step-results"]').trigger('click');
    await w.get('[data-test="batch-view-2"]').trigger('click');
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
    vi.mocked(multi.fitMulti).mockImplementation(async request=>({configuration:request,x:request.x,raw_y:request.y,baseline:request.x.map(()=>0),total_y:request.y,residuals:request.x.map(()=>0),converged:true,statistics:{rmse:0},components:[{id:'p1',parameters:{A:{value:3},xc:{value:2.1},w:{value:1},mu:{value:.3}}}],diagnostics:{identifiable:true,bound_parameters:[],strong_correlations:[],warnings:[]}} as any));
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
    await load('{');expect(w.get('[role="alert"]').text()).toContain('模板 JSON 格式无效');expect(w.text()).toContain('1 个启用峰');w.unmount();
  });
});


it('XPS逐谱背景缺少端点窗口时提前说明，补齐窗口后提示消失且不改写模板',async()=>{
  const Component=(await import('./components/BatchWorkbench.vue')).default;
  const c=createXpsConfig([1,2,3],[1,3,2],null);addXpsComponent(c);
  c.background.kind='shirley';c.background.low_window=null;c.background.high_window=null;
  c.background.low_level=1;c.background.high_level=2;
  const w=mount(Component,{props:{template:c,analysisMode:'xps'},global:{stubs:{BatchResultChart:true}}});wrappers.push(w);
  expect(w.get('[data-test="batch-background-window-hint"]').text()).toContain('逐谱背景需要两端窗口');
  expect(c.background.low_level).toBe(1);
  await w.setProps({template:{...c,background:{...c.background,low_window:[1,1],high_window:[3,3]}}});
  expect(w.find('[data-test="batch-background-window-hint"]').exists()).toBe(false);
});


it('并存的不同分析工作区使用各自的背景和单位说明，不产生重复 ARIA ID',async()=>{
  const Component=(await import('./components/BatchWorkbench.vue')).default;
  const ids:string[]=[];
  for(const mode of ['general','xrd'] as const){
    const c=createMultiConfig([1,2,3,4],[1,3,2,1],null,mode);addMultiComponent(c);
    c.baseline.kind='line';c.baseline.anchors=[{x:1,y:1},{x:3,y:2}];
    const w=mount(Component,{props:{template:c,analysisMode:mode},global:{stubs:{BatchResultChart:true}}});wrappers.push(w);
    for(const input of w.findAll('input[aria-describedby]')){
      const id=input.attributes('aria-describedby')!;
      expect(w.find(`[id="${id}"]`).exists()).toBe(true);
      ids.push(id);
    }
  }
  expect(ids.length).toBe(4);
  expect(new Set(ids).size).toBe(ids.length);
});
