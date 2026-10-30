import {describe,it,expect,vi} from 'vitest';
import {mount,flushPromises} from '@vue/test-utils';
import PeakRecordTable from './components/PeakRecordTable.vue';
import DerivedCalculationPanel from './components/DerivedCalculationPanel.vue';
import {calculationCatalog,evaluateCalculation,validateCalculation} from './peakResultImportApi';
vi.mock('./peakResultImportApi',()=>({calculationCatalog:vi.fn(async()=>({schema_version:1,methods:[{id:'formula',title:'自定义公式',description:'按字段计算',fields:[],default_config:{variables:{area:{field:'area'}},outputs:[{name:'result',expression:'area',unit:'a.u.'}]}}]})),validateCalculation:vi.fn(async()=>({valid:true,issues:[]})),evaluateCalculation:vi.fn(async()=>({method:'formula',method_version:'1',input_hash:'abc',configuration:{},results:[]}))}));
const record:any={id:'p',sample_id:'样品',spectrum_id:'s',peak_id:'p1',model:'unknown',fields:Object.fromEntries(['position','width','height','area'].map(k=>[k,{value:k==='position'?60:null,unit:k==='position'?'deg':null,definition:'unknown',reason:'未提供'}])),source:{filename:'results.csv',file_sha256:'abc',sheet:'data',row:2}};
describe('无原谱的参数工作区',()=>{
 it('展示外部峰参数和未知质量，不显示伪造收敛/重拟合提示',()=>{
  const w=mount(PeakRecordTable,{props:{analysis:{schema_version:1,records:[record],spectra:[],issues:[]}}});
  expect(w.text()).toContain('60');expect(w.text()).toContain('未提供');expect(w.text()).not.toContain('重新拟合');expect(w.text()).not.toContain('已收敛');
 });
 it('单位复核保留原值和来源，并明确通知工作区旧计算失效',async()=>{
  const w=mount(PeakRecordTable,{props:{analysis:{schema_version:1,records:[record],spectra:[],issues:[]}}});
  await w.get('[data-test="review-unit-position"]').setValue('deg');await w.get('[data-test="review-confirm"]').setValue(true);
  await w.get('[data-test="apply-quantity-review"]').trigger('click');
  const next=w.emitted('revised')?.[0]?.[0] as any;expect(next.records[0].fields.position.value).toBe(60);expect(next.records[0].source).toEqual(record.source);expect(next.records[0].metadata.quantity_reviews).toHaveLength(1);
 });
 it('提供真正可编辑的变量和多步表达式，修改后发出失效通知',async()=>{
  const w=mount(DerivedCalculationPanel,{props:{records:[record],modelValue:{method:'formula',config:{variables:{area:{field:'area'}},outputs:[{name:'result',expression:'area',unit:'a.u.'}]}},history:[]}});
  await flushPromises();await w.get('[data-test="formula-expression-0"]').setValue('area * 2');
  expect(w.emitted('change')).toBeTruthy();expect(w.find('[data-test="add-formula-variable"]').exists()).toBe(true);
  await w.get('[data-test="add-formula-output"]').trigger('click');expect(w.findAll('[data-formula-output]')).toHaveLength(2);
 });
 it('仪器校正采用可操作的表单，数值与条件确认进入计算请求',async()=>{
  const config={correction:{mode:'gaussian',source:'标样',conditions_match:false,instrument_width:{value:.1,unit:'deg'}}};
  vi.mocked(calculationCatalog).mockResolvedValueOnce({schema_version:1,methods:[{id:'scherrer',title:'尺寸',description:'',default_config:config,fields:[{key:'correction',label:'仪器展宽校正',type:'json'}]}]});
  const w=mount(DerivedCalculationPanel,{props:{records:[record],modelValue:{method:'scherrer',config},history:[]}});await flushPromises();
  await w.get('[data-test="instrument-width-value"]').setValue('0.2');await w.get('[data-test="correction-conditions"]').setValue(true);
  await w.get('[data-test="calculate-material"]').trigger('click');await flushPromises();
  expect(vi.mocked(evaluateCalculation).mock.calls.at(-1)?.[0].config.correction).toMatchObject({instrument_width:{value:.2,unit:'deg'},conditions_match:true});
 });
 it('计算期间收到新参数时，返回的旧输入结果必须标记失效',async()=>{
  let resolve:any;vi.mocked(evaluateCalculation).mockImplementationOnce(()=>new Promise(r=>resolve=r));
  const props={records:[record],modelValue:{method:'formula',config:{variables:{area:{field:'area'}},outputs:[{name:'a',expression:'area',unit:'a.u.'}]}},history:[]};
  const w=mount(DerivedCalculationPanel,{props});await flushPromises();await w.get('[data-test="calculate-material"]').trigger('click');await flushPromises();
  await w.setProps({records:[{...record,id:'new'}]});resolve({method:'formula',method_version:'1',input_hash:'a',configuration:{},results:[]});await flushPromises();
  expect((w.emitted('calculated')?.[0]?.[0]as any).stale).toBe(true);
 });
 it('切换已有校正宽度时不提交隐藏仪器宽度，切回时恢复可编辑输入',async()=>{
  const config={correction:{mode:'gaussian',source:'已校正宽度来源',conditions_match:true,instrument_width:{value:.1,unit:'deg'}}};
  vi.mocked(calculationCatalog).mockResolvedValueOnce({schema_version:1,methods:[{id:'scherrer',title:'尺寸',description:'',default_config:config,fields:[{key:'correction',label:'仪器展宽校正',type:'json'}]}]});
  const w=mount(DerivedCalculationPanel,{props:{records:[record],modelValue:{method:'scherrer',config},history:[]}});await flushPromises();
  const select=w.findAll('select').find(s=>s.find('option[value="corrected"]').exists())!;
  await select.setValue('corrected');await w.get('[data-test="calculate-material"]').trigger('click');await flushPromises();
  const correction=vi.mocked(evaluateCalculation).mock.calls.at(-1)?.[0].config.correction;
  expect(correction.mode).toBe('corrected');expect(correction.instrument_width).toBeUndefined();expect(correction.instrument_table).toBeUndefined();
  await select.setValue('lorentz');expect(w.find('[data-test="instrument-width-value"]').exists()).toBe(true);
  await w.get('[data-test="instrument-width-value"]').setValue('0.05');await w.get('[data-test="calculate-material"]').trigger('click');await flushPromises();
  expect(vi.mocked(evaluateCalculation).mock.calls.at(-1)?.[0].config.correction.instrument_width.value).toBe(.05);
 });
 it('混合好坏记录的验证错误不阻止其他记录计算',async()=>{
  vi.mocked(validateCalculation).mockResolvedValueOnce({valid:false,issues:[{code:'MISSING_VALUE',message:'第二峰缺少面积',record_ids:['bad']}]});
  vi.mocked(evaluateCalculation).mockClear();vi.mocked(evaluateCalculation).mockResolvedValueOnce({method:'formula',method_version:'1',input_hash:'a',configuration:{},results:[{record_ids:['p'],sample_id:'s',values:{a:{value:10,unit:'a.u.'}},status:'valid',warnings:[]},{record_ids:['bad'],sample_id:'s',values:{},status:'invalid',warnings:[],error:{code:'MISSING_VALUE',message:'缺少面积'}}]});
  const w=mount(DerivedCalculationPanel,{props:{records:[record,{...record,id:'bad'}],modelValue:{method:'formula',config:{variables:{area:{field:'area'}},outputs:[{name:'a',expression:'area',unit:'a.u.'}]}},history:[]}});await flushPromises();await w.get('[data-test="calculate-material"]').trigger('click');await flushPromises();
  expect(evaluateCalculation).toHaveBeenCalledTimes(1);expect((w.emitted('calculated')?.[0]?.[0]as any).response.results.map((r:any)=>r.status)).toEqual(['valid','invalid']);
 });
 it('全局表达式语法错误会阻止执行',async()=>{
  vi.mocked(validateCalculation).mockResolvedValueOnce({valid:false,issues:[{code:'SYNTAX_ERROR',message:'表达式无效'}]});vi.mocked(evaluateCalculation).mockClear();
  const w=mount(DerivedCalculationPanel,{props:{records:[record],modelValue:{method:'formula',config:{variables:{},outputs:[]}},history:[]}});await flushPromises();await w.get('[data-test="calculate-material"]').trigger('click');await flushPromises();
  expect(evaluateCalculation).not.toHaveBeenCalled();expect(w.text()).toContain('表达式无效');
 });
 it('恢复草稿保留已选峰，计算不会悄然扩大到全批次',async()=>{
  vi.mocked(evaluateCalculation).mockClear();vi.mocked(evaluateCalculation).mockResolvedValueOnce({method:'formula',method_version:'1',input_hash:'a',configuration:{},results:[]});
  const w=mount(DerivedCalculationPanel,{props:{records:[record,{...record,id:'other'}],modelValue:{method:'formula',config:{record_ids:['p'],variables:{area:{field:'area'}},outputs:[{name:'a',expression:'area',unit:'a.u.'}]}},history:[]}});await flushPromises();await w.get('[data-test="calculate-material"]').trigger('click');await flushPromises();
  expect(vi.mocked(evaluateCalculation).mock.calls.at(-1)?.[0].records.map(r=>r.id)).toEqual(['p']);
 });
});
