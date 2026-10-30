import {describe,it,expect,vi} from 'vitest';
import {mount,flushPromises} from '@vue/test-utils';
import PeakResultImportWorkbench from './components/PeakResultImportWorkbench.vue';
import {normalizePeakResults,evaluateCalculation} from './peakResultImportApi';
vi.mock('./useWorkProtection',()=>({confirmDiscard:vi.fn(async()=>true)}));
vi.mock('./peakResultImportApi',()=>({
 uploadPeakResults:vi.fn(async(file:File)=>({upload_id:file.name,filename:file.name,file_sha256:(file.name==='two.csv'?'b':'a').repeat(64),sheets:[{name:'数据',columns:['peak','center','area'],row_count:1,preview_rows:[['p1',60,10]],row_numbers:[2]}],suggested_mapping:{sheet:'数据',layout:'wide',header_row:1,columns:{peak_id:'peak',position:'center',area:'area'},units:{position:'deg',area:'a.u.*deg'},position_definition:'two_theta',width_definition:'unknown',area_definition:'total',default_model:'unknown',technique:'xrd',template_version:1}})),
 normalizePeakResults:vi.fn(),loadPeakRows:vi.fn(),
 calculationCatalog:vi.fn(async()=>({schema_version:1,methods:[{id:'formula',title:'公式',description:'',fields:[],default_config:{}}]})),
 validateCalculation:vi.fn(async()=>({valid:true,issues:[]})),evaluateCalculation:vi.fn(),
}));
const a:any={schema_version:1,records:[{id:'r1',sample_id:'s1',spectrum_id:'sp1',peak_id:'p1',fields:{position:{value:60,unit:'deg',definition:'two_theta'},width:{value:null,unit:'unknown',definition:'unknown'},height:{value:null,unit:'unknown',definition:'height'},area:{value:10,unit:'a.u.*deg',definition:'total'}},source:{filename:'one.csv',file_sha256:'a'.repeat(64),sheet:'数据',row:2}}],spectra:[],issues:[]};
describe('峰结果解析实际交互',()=>{
 it('多文件逐个解析，坏文件不影响有效峰表，且不调用拟合或材料计算',async()=>{
  vi.mocked(normalizePeakResults).mockResolvedValueOnce(a).mockRejectedValueOnce(new Error('第二份文件不适用'));
  const w=mount(PeakResultImportWorkbench);await flushPromises();const input=w.get('input[type="file"][multiple]');
  Object.defineProperty(input.element,'files',{value:[new File(['x'],'one.csv'),new File(['x'],'two.csv')]});await input.trigger('change');await flushPromises();
  await w.findAll('button').find(b=>b.text()==='解析并纳入 2 个文件')!.trigger('click');await flushPromises();
  expect(w.text()).toContain('本次纳入 1 条峰记录');expect(w.text()).toContain('第二份文件不适用');expect(w.text()).toContain('60 deg');
  expect(evaluateCalculation).not.toHaveBeenCalled();expect(w.emitted('work')?.some(v=>v[0]===true)).toBe(true);
 });
 it('损坏的初始分析只显示错误，不替换当前已载入记录',async()=>{
  const w=mount(PeakResultImportWorkbench,{props:{initialAnalysis:a}});await flushPromises();expect(w.text()).toContain('60 deg');
  await w.setProps({initialAnalysis:{schema_version:1,records:[{}],spectra:[],issues:[]}as any});await flushPromises();
  expect(w.text()).toContain('参数载入失败');expect(w.text()).toContain('60 deg');
 });
 it('只有公式草稿时也发出离开保护状态',async()=>{
  const w=mount(PeakResultImportWorkbench);await flushPromises();await w.get('[data-test="formula-expression-0"]').setValue('area * 2');
  expect(w.emitted('work')?.some(v=>v[0]===true)).toBe(true);
 });
 it('修正一个文件重新解析时只替换该文件工作表的旧异常',async()=>{
  const first=structuredClone(a),second=structuredClone(a);
  first.issues=[{code:'unknown_unit',severity:'warning',message:'一号旧警告',source_file:'one.csv',source_sha256:'a'.repeat(64),source_sheet:'数据'}];
  second.records[0].id='r2';second.records[0].source={...second.records[0].source,filename:'two.csv',file_sha256:'b'.repeat(64)};
  second.issues=[{code:'unknown_unit',severity:'warning',message:'二号保留警告',source_file:'two.csv',source_sha256:'b'.repeat(64),source_sheet:'数据'}];
  vi.mocked(normalizePeakResults).mockReset().mockResolvedValueOnce(first).mockResolvedValueOnce(second).mockResolvedValueOnce(a);
  const w=mount(PeakResultImportWorkbench);await flushPromises();const input=w.get('input[type="file"][multiple]');Object.defineProperty(input.element,'files',{value:[new File(['x'],'one.csv'),new File(['x'],'two.csv')]});await input.trigger('change');await flushPromises();
  await w.findAll('button').find(b=>b.text()==='解析并纳入 2 个文件')!.trigger('click');await flushPromises();expect(w.text()).toContain('一号旧警告');expect(w.text()).toContain('二号保留警告');
  await w.get('.peak-source-list button').trigger('click');await w.findAll('button').find(b=>b.text()==='解析当前文件')!.trigger('click');await flushPromises();
  expect(w.text()).not.toContain('一号旧警告');expect(w.text()).toContain('二号保留警告');
 });
});
