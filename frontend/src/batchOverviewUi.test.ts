import { afterEach,describe,expect,it,vi } from 'vitest';
import { mount,flushPromises } from '@vue/test-utils';
import BatchBackgroundOverview from './components/BatchBackgroundOverview.vue';
import BatchTrendChart from './components/BatchTrendChart.vue';
import Plotly from 'plotly.js-dist-min';
vi.mock('plotly.js-dist-min',()=>({default:{register:vi.fn(),react:vi.fn((el:any)=>{el.on=vi.fn((name:string,cb:any)=>el[name]=cb);el.removeAllListeners=vi.fn();return Promise.resolve();}),purge:vi.fn()}}));
const wrappers:any[]=[];afterEach(()=>{wrappers.splice(0).forEach(w=>w.unmount());vi.clearAllMocks();});
describe('背景概览和趋势交互',()=>{
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
    const last=vi.mocked(Plotly.react).mock.calls.at(-1)!;expect(last[3]).toMatchObject({scrollZoom:false});expect((last[1] as any[]).flatMap(t=>t.y)).toEqual([2]);
    await w.get('[aria-label="定位谱线 2 的 p1"]').trigger('click');expect(w.emitted('select')?.[0]).toEqual(['missing','p1']);
    (w.get('.batch-trend-plot').element as any).plotly_click({points:[{customdata:'task'}]});expect(w.emitted('select')?.[1]).toEqual(['task','p1']);
    expect(w.get('[aria-label="趋势横轴"] option[value=condition]').attributes('disabled')).toBeDefined();
  });
});
