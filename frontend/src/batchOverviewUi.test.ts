import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { mount,flushPromises } from '@vue/test-utils';
import BatchBackgroundOverview from './components/BatchBackgroundOverview.vue';
import BatchTrendChart from './components/BatchTrendChart.vue';
import Plotly from 'plotly.js-dist-min';
import { emptyMetadata } from './batchTrend';
vi.mock('plotly.js-dist-min',()=>({default:{register:vi.fn(),react:vi.fn((el:any)=>{el.on=vi.fn((name:string,cb:any)=>el[name]=cb);el.removeAllListeners=vi.fn();return Promise.resolve();}),purge:vi.fn()}}));
beforeEach(()=>{vi.spyOn(Element.prototype,'clientWidth','get').mockReturnValue(960);});
const wrappers:any[]=[];afterEach(()=>{wrappers.splice(0).forEach(w=>w.unmount());vi.restoreAllMocks();vi.unstubAllGlobals();vi.clearAllMocks();});
function trendRow(id:string,value:number|null,status='success'):any{
  const result={converged:true,components:[{id:'p1',label:'峰1',parameters:{},peak_geometry:{peak_position:value,fwhm:1,warnings:[]}}],statistics:{},diagnostics:{identifiable:true,uncertainty_available:true,warnings:[],strong_correlations:[]}};
  return {id,label:id,status,request:{components:[{id:'p1',label:'峰1',enabled:true}]},result,attempts:[],accepted_attempt_id:null};
}
const trendTraces=()=>vi.mocked(Plotly.react).mock.calls.at(-1)![1] as any[];
describe('背景概览和趋势交互',()=>{
  it('总览默认统一坐标，可切换独立范围；确认状态与当前页选择同步',async()=>{
    const rows=Array.from({length:100},(_,index)=>({id:String(index),index,label:`spectrum_${index}`,confirmed:false,error:'',preview:{x:[1,2],raw_y:[3,5+index],baseline:[1,2]}}));
    const w=mount(BatchBackgroundOverview,{props:{rows,selected:0,unit:'X',reversed:false}});wrappers.push(w);
    const shared=w.get('.overview-raw').attributes('points');
    await w.get('input[type="checkbox"]').setValue(false);
    expect(w.get('.overview-raw').attributes('points')).not.toBe(shared);
    await w.setProps({selected:99,rows:rows.map(r=>r.index===99?{...r,confirmed:true}:r)});
    expect(w.findAll('.background-tile')).toHaveLength(4);
    expect(w.get('.background-tile[aria-pressed="true"]').text()).toContain('已复核');
    expect(w.text()).toContain('第 17 / 17 页');
  });
  it('隐藏容器不绘制，显示和调整宽度后趋势图始终使用实际容器宽度',async()=>{
    let width=0,resize!:(entries:any[])=>void;
    vi.spyOn(Element.prototype,'clientWidth','get').mockImplementation(()=>width);
    vi.stubGlobal('ResizeObserver',class {constructor(callback:(entries:any[])=>void){resize=callback;}observe(){}disconnect(){}});
    const w=mount(BatchTrendChart,{props:{rows:[trendRow('a',2),trendRow('b',3)],metadata:{},unit:'°'}});wrappers.push(w);await flushPromises();
    expect(Plotly.react).not.toHaveBeenCalled();
    width=1280;resize([{contentRect:{width}}]);await flushPromises();
    expect(vi.mocked(Plotly.react).mock.calls.at(-1)![2]).toMatchObject({width:1280,autosize:false});
    width=1960;resize([{contentRect:{width}}]);await flushPromises();
    expect(vi.mocked(Plotly.react).mock.calls.at(-1)![2]).toMatchObject({width:1960});
  });
  it('每页只渲染 6 条，失败保留文字，点击不自动复核',async()=>{
    const rows=Array.from({length:7},(_,index)=>({id:String(index),index,label:`spectrum_${index}`,confirmed:false,error:index===6?'预检失败原因':'',preview:index===6?null:{x:[1,2],raw_y:[3,5],baseline:[1,2]}}));
    const w=mount(BatchBackgroundOverview,{props:{rows,selected:0,unit:'eV',reversed:true}});wrappers.push(w);
    expect(w.findAll('.background-tile')).toHaveLength(6);await w.findAll('.batch-inline-actions button')[1].trigger('click');
    expect(w.findAll('.background-tile')).toHaveLength(1);expect(w.text()).toContain('预检失败原因');await w.get('.background-tile').trigger('click');
    expect(w.emitted('select')?.[0]).toEqual([6]);expect(rows.every(r=>!r.confirmed)).toBe(true);
  });
  it('趋势图与等价表格都按任务和峰 ID 定位，缺失值不画零，滚轮缩放关闭',async()=>{
    const result:any={converged:true,components:[{id:'p1',label:'峰1',parameters:{},peak_geometry:{peak_position:2,fwhm:1,warnings:[]}}],statistics:{},diagnostics:{identifiable:true,uncertainty_available:true,warnings:[],strong_correlations:[]}};
    const rows:any=[{id:'task',label:'sample',status:'success',request:{components:[{id:'p1',label:'峰1',enabled:true}]},result,attempts:[],accepted_attempt_id:null},{id:'missing',label:'失败谱',status:'failed',request:{components:[{id:'p1',label:'峰1'}]},result:null,attempts:[]}];
    const w=mount(BatchTrendChart,{props:{rows,metadata:{},unit:'°'}});wrappers.push(w);await flushPromises();
    const last=vi.mocked(Plotly.react).mock.calls.at(-1)!;expect(last[3]).toMatchObject({scrollZoom:false});
    expect(trendTraces().filter(t=>t.mode==='markers').flatMap(t=>t.y)).toEqual([2]);
    expect(trendTraces().find(t=>t.mode==='lines')).toMatchObject({x:[1,2],y:[2,null],connectgaps:false});
    await w.get('[aria-label="定位谱线 2 的 p1"]').trigger('click');expect(w.emitted('select')?.[0]).toEqual(['missing','p1']);
    (w.get('.batch-trend-plot').element as any).plotly_click({points:[{customdata:'task'}]});expect(w.emitted('select')?.[1]).toEqual(['task','p1']);
    expect(w.get('[aria-label="趋势横轴"] option[value=condition]').attributes('disabled')).toBeDefined();
  });
  it('跨诊断状态连续连线，零值保留，失败、跳过和缺失处断开',async()=>{
    const rows=[trendRow('zero',0),trendRow('review',3,'review'),trendRow('accepted',4),trendRow('failed',5,'failed'),trendRow('skipped',6,'skipped'),trendRow('missing',null),trendRow('last',8)];
    rows[2].accepted_attempt_id='a';rows[2].attempts=[{id:'a',result:rows[2].result,manually_accepted:true,invalidated:false}];
    const w=mount(BatchTrendChart,{props:{rows,metadata:{},unit:'°'}});wrappers.push(w);await flushPromises();
    const traces=trendTraces();
    expect(traces[0]).toMatchObject({mode:'lines',x:[1,2,3,4,5,6,7],y:[0,3,4,null,null,null,8],connectgaps:false,showlegend:false,hoverinfo:'skip',line:{shape:'linear'}});
    const markers=traces.filter(t=>t.mode==='markers');
    expect(markers.find(t=>t.customdata.includes('zero'))).toMatchObject({marker:{symbol:'circle'}});
    expect(markers.find(t=>t.customdata.includes('review'))).toMatchObject({marker:{symbol:'triangle-up'}});
    expect(markers.find(t=>t.customdata.includes('accepted'))).toMatchObject({marker:{symbol:'diamond'}});
    expect(markers.flatMap(t=>t.customdata)).not.toContain('failed');expect(markers.flatMap(t=>t.customdata)).not.toContain('skipped');
    (w.get('.batch-trend-plot').element as any).plotly_click({points:[{customdata:'accepted'}]});
    expect(w.emitted('select')?.[0]).toEqual(['accepted','p1']);
    await w.get('[aria-label="趋势指标"]').setValue('fwhm');await flushPromises();
    expect(trendTraces()[0].y).toEqual([1,1,1,null,null,1,1]);
  });
  it('条件轴仅排序连线；重复条件保留独立标记并断线，原行顺序与定位不变',async()=>{
    const rows=[trendRow('a',10),trendRow('b',20),trendRow('c',30),trendRow('d',40)];
    const metadata=Object.fromEntries(['a','b','c','d','e'].map((id,i)=>[id,{...emptyMetadata(),condition_name:'温度',condition_unit:'K',condition_value:[30,10,20,40,20][i]}]));
    const w=mount(BatchTrendChart,{props:{rows,metadata,unit:'°'}});wrappers.push(w);await flushPromises();
    await w.get('[aria-label="趋势横轴"]').setValue('condition');await flushPromises();
    expect(trendTraces()[0]).toMatchObject({x:[10,20,30,40],y:[20,30,10,40]});
    await w.setProps({rows:[...rows,trendRow('e',50)]});await flushPromises();
    expect(trendTraces()[0]).toMatchObject({x:[10,20,20,30,40],y:[20,null,null,10,40],connectgaps:false});
    expect(trendTraces().find(t=>t.mode==='markers')).toMatchObject({x:[30,10,20,40,20],y:[10,20,30,40,50],customdata:['a','b','c','d','e']});
    expect(w.findAll('tbody tr th').map(th=>th.text())).toEqual(['1 · a','2 · b','3 · c','4 · d','5 · e']);
    (w.get('.batch-trend-plot').element as any).plotly_click({points:[{customdata:'c'}]});expect(w.emitted('select')?.[0]).toEqual(['c','p1']);
    expect(rows.map(r=>r.id)).toEqual(['a','b','c','d']);
  });
  it.each([[],[trendRow('single',2)],[trendRow('missing',null)]])('空序列、单点和全缺失正常绘制：%j',async(...rows)=>{
    const w=mount(BatchTrendChart,{props:{rows,metadata:{},unit:'°'}});wrappers.push(w);await flushPromises();
    expect(w.find('[role="alert"]').exists()).toBe(false);
    expect(trendTraces()[0].y).toEqual(rows.map(r=>r.result.components[0].peak_geometry.peak_position));
  });
});
