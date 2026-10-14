import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import MultiPeakResults from './components/MultiPeakResults.vue';
import XpsResults from './components/XpsResults.vue';

function result(): any {
  const parameter={value:2,standard_error:.1,linked_to:null,fixed:false,bound:false,uncertainty_reason:null};
  return {converged:true,computed_only:false,message:'solver finished',evaluations:45,statistics:{r_squared:.977108,rmse:229.058,rss:13431700},
    diagnostics:{identifiable:true,uncertainty_available:true,strong_correlations:[{a:'p1.A',b:'p2.A',correlation:.98}],warnings:['存在强参数相关，请检查峰数','残差具有明显相关性']},
    components:['p1','p2'].map((id,i)=>({id,label:`峰 ${i+1}`,model:'gaussian',parameters:{xc:parameter,A:parameter},area_total:100,area_window:90,area_fraction_window:i===0?0:null,height:8,fwhm:1,
      peak_geometry:{peak_position:2.5+i,fwhm:i===0?.25:null,peak_height:8,hwhm_low:.1,hwhm_high:.15,area_total:100,area_in_range:90,area_fraction_in_range:.9,reasons:{fwhm:'无法计算'},warnings:[],area_method:'解析积分',width_method:'连续模型',uncertainty_note:'标准误限于当前模型'}})),groups:[]};
}
describe.each([{name:'通用谱线',component:MultiPeakResults,prefix:'multi'},{name:'XPS',component:XpsResults,prefix:'xps'}])('$name 紧凑结果',({component,prefix})=>{
  it('通用标准误说明进入计算口径，计算与诊断、人工复核分开',()=>{
    const data=result();data.diagnostics.strong_correlations=[];data.diagnostics.warnings=['标准误仅在当前固定背景、模型及约束下成立，不含背景选择误差'];
    const w=mount(component as any,{props:{result:data,stale:false,busy:false,unit:'X 单位'}});
    expect(w.find('[data-test="result-warning-summary"]').exists()).toBe(false);
    expect(w.text()).toContain('未触发已实现诊断');expect(w.text()).toContain('未复核');expect(w.text()).toContain('计算口径');w.unmount();
  });
  it('缺少连续峰性质不回退到内部宽度，峰名是唯一详情入口',async()=>{
    const data=result();delete data.components[0].peak_geometry;data.components[0].fwhm=77;
    const w=mount(component as any,{props:{result:data,stale:false,busy:false,unit:'X 单位'}});
    expect(w.get('[data-test="peak-overview"] tbody tr').text()).not.toContain('77');
    expect(w.find('[data-test="peak-select-p1"]').exists()).toBe(true);w.unmount();
  });
  it('默认合并各峰对比、折叠统计，使用实际峰顶与整体宽度，保留零占比和缺失值',()=>{
    const w=mount(component as any,{props:{result:result(),stale:false,busy:false,unit:'X 单位'}});
    const rows=w.findAll('[data-test="peak-overview"] tbody tr');
    expect(rows).toHaveLength(2);expect(rows[0].text()).toContain('2.5');expect(rows[0].text()).toContain('0.25');expect(rows[0].text()).toContain('0.00%');
    expect(rows[1].text()).toContain('—');
    expect(rows[0].get('[data-test="result-peak-position"]').attributes('title')).not.toContain('未计算');
    expect(w.find('[data-test="peak-detail"]').exists()).toBe(false);
    expect(w.get('[data-test="result-statistics"]').attributes('open')).toBeUndefined();
    expect(w.get('[data-test="result-warning-summary"]').text()).toContain('参数强相关');
    expect(w.get('[data-test="result-warning-summary"]').text()).toContain('残差相关');w.unmount();
  });
  it('峰详情使用模态弹窗，关闭及 Esc 恢复焦点，更新结果自动关闭且导出不变',async()=>{
    const data=result(),w=mount(component as any,{attachTo:document.body,props:{result:data,stale:false,busy:false,unit:'X 单位'}});
    const dialog=w.get('[data-test="peak-result-dialog"]').element as HTMLDialogElement;
    dialog.showModal=()=>dialog.setAttribute('open','');
    dialog.close=()=>{dialog.removeAttribute('open');dialog.dispatchEvent(new Event('close'));};
    const first=w.get('[data-test="peak-select-p1"]');
    expect(w.get('[data-test="peak-overview"] tbody tr').findAll('button')).toHaveLength(1);
    await first.trigger('click');expect(w.emitted('select')?.at(-1)).toEqual(['p1']);expect(dialog.open).toBe(true);expect(w.get('dialog [data-test="peak-detail"]').text()).toContain('p1');
    expect(first.attributes('aria-haspopup')).toBe('dialog');
    await w.get('[data-test="peak-detail-close"]').trigger('click');expect(dialog.open).toBe(false);expect(document.activeElement).toBe(first.element);
    const second=w.get('[data-test="peak-select-p2"]');
    await second.trigger('click');expect(w.findAll('[data-test="peak-detail"]')).toHaveLength(1);expect(w.get('[data-test="peak-detail"]').text()).toContain('p2');
    await w.get('dialog').trigger('cancel');expect(dialog.open).toBe(false);expect(document.activeElement).toBe(second.element);
    await second.trigger('click');await w.setProps({stale:true});expect(w.get('dialog').text()).toContain('结果已过期');
    await w.setProps({stale:false});dialog.close();await w.vm.$nextTick();expect(second.attributes('aria-expanded')).toBe('false');
    await w.get(`[data-test="${prefix}-export-curves"]`).trigger('click');expect(w.emitted('export')?.[0]).toEqual(['curves']);
    await w.setProps({stale:true});expect(w.get(`[data-test="${prefix}-export-config"]`).attributes('disabled')).toBeDefined();
    await first.trigger('click');await w.setProps({result:result()});expect(dialog.open).toBe(false);expect(w.find('[data-test="peak-detail"]').exists()).toBe(false);expect(data.components[0].parameters.xc.value).toBe(2);w.unmount();
  });
  it('批量嵌入时隐藏导出入口，空结果不显示指标',()=>{
    const w=mount(component as any,{props:{result:result(),hideActions:true,stale:false,busy:false,unit:'X 单位'}});
    expect(w.find('[data-test="result-export-menu"]').exists()).toBe(false);w.unmount();
    const empty=mount(component as any,{props:{result:null,stale:false,busy:false,unit:'X 单位'}});expect(empty.text()).toContain('暂无拟合结果');expect(empty.find('[data-test="peak-overview"]').exists()).toBe(false);empty.unmount();
  });
});
