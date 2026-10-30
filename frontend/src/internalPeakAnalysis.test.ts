import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {SingleSession,BatchSession} from './sessionArchive';
import {analysisFromSession,usableBatchResult} from './internalPeakAnalysis';
const mocks=vi.hoisted(()=>({adapt:vi.fn()}));
vi.mock('./peakResultImportApi',()=>({adaptFitResult:mocks.adapt}));
const configuration={analysis_mode:'xrd',source:{filename:'x.xlsx',file_sha256:'a'.repeat(64),sheet:'data',x_column:'2theta',y_column:'sample1'}};
const result={configuration,components:[],statistics:{rmse:1},converged:true};
beforeEach(()=>{mocks.adapt.mockReset();mocks.adapt.mockResolvedValue({schema_version:1,records:[],spectra:[],issues:[]});});
describe('内部拟合快照到材料计算入口',()=>{
  it('拒绝缺失和已失效单谱结果',async()=>{
    await expect(analysisFromSession({kind:'single',configuration,result:null} as unknown as SingleSession)).rejects.toThrow('请先完成拟合');
    await expect(analysisFromSession({kind:'single',configuration,result:{engine:'multi',configuration,result,stale:true}} as unknown as SingleSession)).rejects.toThrow('已失效');
    expect(mocks.adapt).not.toHaveBeenCalled();
  });
  it('传递快照来源、分析类型和质量状态，不重新求解或修改当前数据',async()=>{
    const state={kind:'single',configuration,result:{engine:'multi',configuration,result,stale:false,accepted:true}} as unknown as SingleSession;
    const before=JSON.stringify(state);await analysisFromSession(state);
    expect(mocks.adapt).toHaveBeenCalledWith(expect.objectContaining({engine:'multi',result,source:configuration.source,mode:'xrd',metadata:expect.objectContaining({manually_accepted:true})}));
    expect(JSON.stringify(state)).toBe(before);
  });
  it('批次只纳入未失效的当前结果，并保留样品与尝试信息',async()=>{
    const valid={id:'a',status:'review',label:'sample',request:configuration,result,accepted_attempt_id:'try1',attempts:[{id:'try1',result,invalidated:false,manually_accepted:true}]};
    const state={kind:'batch',batch_id:'batch',rows:[valid,{...valid,id:'pending',status:'pending'},{...valid,id:'bad',attempts:[{...valid.attempts[0],invalidated:true}]}],metadata:{a:{sample_id:'S1',condition_name:'temperature',condition_value:300,condition_unit:'K',replicate_id:'r1'}}} as unknown as BatchSession;
    await analysisFromSession(state);
    expect(mocks.adapt).toHaveBeenCalledTimes(1);
    expect(mocks.adapt.mock.calls[0][0].metadata).toMatchObject({sample_id:'S1',task_id:'a',attempt_id:'try1',batch_id:'batch',fit_status:'review',manually_accepted:true});
  });
});

it('批次恢复后的克隆结果仍可计算，失效和过期结果不可用',()=>{
 const row={status:'review',result,attempts:[{result:JSON.parse(JSON.stringify(result)),invalidated:false}]} as unknown as BatchSession['rows'][number];
 expect(usableBatchResult(row)).toBe(true);row.attempts[0].invalidated=true;expect(usableBatchResult(row)).toBe(false);
 row.attempts[0].invalidated=false;row.result={...result,converged:false} as any;expect(usableBatchResult(row)).toBe(false);
});
