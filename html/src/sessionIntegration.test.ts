import {afterEach,describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {flushPromises,mount} from '@vue/test-utils';
import App from './App.vue';
import SessionActions from './components/SessionActions.vue';
import XpsWorkbench from './components/XpsWorkbench.vue';
import BatchWorkbench from './components/BatchWorkbench.vue';
import {readSession,writeSession,attachSessionData,type SingleSession,type BatchSession} from './sessionArchive';
import {emptyMetadata} from './batchTrend';
vi.mock('plotly.js-dist-min',()=>({default:{purge:vi.fn(),react:vi.fn(),newPlot:vi.fn(),relayout:vi.fn()}}));
const mocks=vi.hoisted(()=>({fit:vi.fn(),preview:vi.fn(),confirm:vi.fn(async()=>true)}));
vi.mock('./xpsApi',()=>({fitXps:mocks.fit,previewXps:mocks.preview,validateXpsInput:mocks.preview,candidatesXps:vi.fn(),exportXps:vi.fn()}));
vi.mock('./useWorkProtection',async original=>({...await original<any>(),confirmDiscard:mocks.confirm}));
const fixture=()=>JSON.parse(readFileSync('../examples/public/results/xps-result.json','utf8'));
const single=():SingleSession=>{const r=fixture();return {kind:'single',configuration:structuredClone(r.configuration),result:{engine:'xps',configuration:r.configuration,result:r,stale:false}};};
const wrappers:ReturnType<typeof mount>[]=[];
afterEach(()=>{wrappers.splice(0).forEach(w=>w.unmount());vi.clearAllMocks();});
describe('本地会话页面恢复',()=>{
  it('应用层切换正确工作区，恢复保留结果且不访问服务；重新预览复核才计算',async()=>{
    const w=mount(App,{global:{stubs:{XpsChart:true,MultiPeakChart:true,BatchTrendChart:true}}});wrappers.push(w);const a=readSession(writeSession(single()));
    await w.getComponent(SessionActions).props('restore')(a);await flushPromises();
    expect(w.get('[data-test="analysis-mode"]').element).toHaveProperty('value','xps');
    const child=w.getComponent(XpsWorkbench),state=(child.vm as any).sessionState();
    expect(state.result.result.statistics).toEqual(fixture().statistics);expect(state.configuration.background.confirmed).toBe(false);
    expect(mocks.fit).not.toHaveBeenCalled();expect(mocks.preview).not.toHaveBeenCalled();
    expect(w.text()).toContain('会话已恢复');expect(w.text()).toContain('未发起计算');
  });
  it('错误文件不确认覆盖；取消完整会话不调用恢复',async()=>{
    const restore=vi.fn(),w=mount(SessionActions,{props:{capture:single,restore,busy:false}});wrappers.push(w);
    const file=w.get('[data-test="session-file"]');
    Object.defineProperty(file.element,'files',{value:[{size:1,text:async()=>'{'}],configurable:true});await file.trigger('change');await flushPromises();
    expect(w.text()).toContain('当前工作未替换');expect(mocks.confirm).not.toHaveBeenCalled();expect(restore).not.toHaveBeenCalled();
    mocks.confirm.mockResolvedValueOnce(false);
    Object.defineProperty(file.element,'files',{value:[{size:1,text:async()=>writeSession(single())}],configurable:true});await file.trigger('change');await flushPromises();
    expect(mocks.confirm).toHaveBeenCalledOnce();expect(restore).not.toHaveBeenCalled();
  });
  it('批次恢复不启动，重新预览全部背景且手工复核后才能继续',async()=>{
    const r=fixture(),batch:BatchSession={kind:'batch',template:r.configuration,batch_id:'restored',status:'running',sequential:true,rows:[{id:'one',label:'第一谱',request:r.configuration,result:null,status:'running',accepted_attempt_id:null,attempts:[]}],metadata:{one:emptyMetadata()},audits:{}};
    const w=mount(BatchWorkbench,{props:{template:null,analysisMode:'xps'}});wrappers.push(w);
    (w.vm as any).restoreSession(readSession(writeSession(batch)).workspace);await flushPromises();
    expect(w.get('[data-test="batch-status"]').text()).toContain('已暂停');expect(mocks.fit).not.toHaveBeenCalled();
    expect(w.get('[data-test="batch-start"]').attributes('disabled')).toBeDefined();
    mocks.preview.mockResolvedValueOnce(r);
    await w.findAll('button').find(b=>b.text()==='重新预览恢复背景')!.trigger('click');await flushPromises();
    expect(mocks.preview).toHaveBeenCalledOnce();expect(w.get('[data-test="batch-start"]').attributes('disabled')).toBeDefined();
    await w.get('[data-test="batch-confirm-all"]').trigger('click');await flushPromises();
    expect(w.get('[data-test="batch-start"]').attributes('disabled')).toBeUndefined();
    expect(mocks.fit).not.toHaveBeenCalled();
    mocks.fit.mockResolvedValueOnce(r);await w.get('[data-test="batch-start"]').trigger('click');await flushPromises();expect(mocks.fit).toHaveBeenCalledOnce();
  });
  it('缺失快照只读，错误哈希拒绝，匹配原谱后完整复核观测才解除只读',()=>{
    const original=single(),missing=single();missing.configuration.x=[];missing.configuration.y=[];missing.result!.configuration.x=[];missing.result!.configuration.y=[];
    const a=readSession(writeSession(missing)),c=original.configuration;
    expect(()=>attachSessionData(a,{...c.source!,file_sha256:'0'.repeat(64)},c.x,c.y)).toThrow('不匹配');
    expect(()=>attachSessionData(a,c.source!,c.x,c.y.map(v=>v+1))).toThrow('观测');
    const restored=attachSessionData(a,c.source!,c.x,c.y);expect(restored.read_only).toBe(false);expect(a.read_only).toBe(true);
  });
});
