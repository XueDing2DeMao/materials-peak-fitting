import {describe,it,expect} from 'vitest';
import {readPeakArchive,writePeakArchive,createPeakWorkspace,invalidateCalculations} from './peakAnalysisArchive';
import {peakRows,calculationRows,peakAnalysisReport,issueRows} from './peakAnalysisExport';

const analysis:any={schema_version:1,records:[{id:'r1',sample_id:'s1',spectrum_id:'s1',peak_id:'p1',label:'<script>x</script>',model:null,fields:{position:{value:60,unit:'deg',definition:'two_theta',raw_value:60,source_column:'center',reason:null},width:{value:null,unit:null,definition:null,raw_value:null,source_column:null,reason:'未提供'},height:{value:5,unit:'a.u.',definition:'peak_height',raw_value:5,source_column:'height',reason:null},area:{value:10,unit:'a.u.*deg',definition:'total',raw_value:10,source_column:'area',reason:null}},source:{filename:'result.csv',file_sha256:'a'.repeat(64),sheet:'数据',row:2},issues:[]}],spectra:[],issues:[]};

describe('独立峰分析档案与导出',()=>{
 it('无原谱、无质量指标也可保存恢复；恢复不需要调用计算服务',()=>{
  const w=createPeakWorkspace();w.analysis=analysis;w.formulaDraft={method:'formula',config:{outputs:[{name:'result',expression:'area / k',unit:'a.u.*deg'}],variables:{area:{field:'area'},k:{value:2,unit:'1'}}}};
  const restored=readPeakArchive(writePeakArchive(w));
  expect(restored.workspace.analysis).toEqual(analysis);expect(restored.workspace.formulaDraft).toEqual(w.formulaDraft);
  expect(JSON.stringify(restored)).not.toContain('converged');
 });
 it('修改输入使历史计算失效但保留结果和来源',()=>{
  const w=createPeakWorkspace();w.analysis=analysis;w.calculations=[{id:'c1',created_at:'2026-10-30',request:{records:analysis.records,method:'custom',config:{}},response:{method:'formula',method_version:'1',input_hash:'abc',configuration:{},results:[{record_ids:['r1'],sample_id:'s1',values:{d:{value:5,unit:'nm'}},status:'valid',warnings:[]}]},stale:false}];
  invalidateCalculations(w,'字段映射改变');expect(w.calculations[0].stale).toBe(true);expect(w.calculations[0].response.results[0].values.d.value).toBe(5);
 });
 it('拒绝未知档案、重复记录和非有限输入',()=>{
  expect(()=>readPeakArchive('{"format":"spectral-fit-session"}')).toThrow();
  const w=createPeakWorkspace();w.analysis=structuredClone(analysis);w.analysis!.records.push(structuredClone(w.analysis!.records[0]));expect(()=>writePeakArchive(w)).toThrow(/重复/);
  w.analysis!.records.pop();w.analysis!.records[0].fields.position.value=Infinity;expect(()=>writePeakArchive(w)).toThrow(/有限/);
 });
 it('参数导出保留缺失，不将未知误差伪造为零；报告转义用户内容',()=>{
  const rows=peakRows(analysis);expect(rows.flat()).toContain('未提供');expect(rows.flat()).not.toContain('converged');
  const w=createPeakWorkspace();w.analysis=analysis;const html=peakAnalysisReport(w);expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('<script>x</script>');expect(html).not.toContain('等权残差最小二乘');
  expect(calculationRows(w.calculations).length).toBe(1);
 });
 it('损坏的计算结果不能恢复后引发界面异常',()=>{
  const w=createPeakWorkspace();w.analysis=analysis;w.calculations=[{id:'c',created_at:'2026-10-30',request:{records:analysis.records,method:'formula',config:{}},response:{method:'formula',method_version:'1',input_hash:'a',configuration:{},results:[{sample_id:'s1',record_ids:['r1'],status:'valid',values:{d:{value:'坏值',unit:'nm'}},warnings:[]}]},stale:false}]as any;
  expect(()=>writePeakArchive(w)).toThrow(/计算结果/);
 });
 it('内部结果缺少原文件哈希或物理行号仍能往返',()=>{
  const w=createPeakWorkspace();w.analysis=structuredClone(analysis);w.analysis!.records[0].source.file_sha256=null;w.analysis!.records[0].source.row=null;
  expect(readPeakArchive(writePeakArchive(w)).workspace.analysis?.records[0].source.row).toBeNull();
 });
 it('拒绝缺少渲染所需结构的公式和材料草稿，未完成的表达式仍可保存',()=>{
  const w=createPeakWorkspace();const a=JSON.parse(writePeakArchive(w));a.workspace.formulaDraft={method:'formula',config:{}};expect(()=>readPeakArchive(JSON.stringify(a))).toThrow(/草稿/);
  a.workspace.formulaDraft={method:'scherrer',config:{}};expect(()=>readPeakArchive(JSON.stringify(a))).toThrow(/草稿/);
  w.formulaDraft.config.outputs[0].expression='';expect(readPeakArchive(writePeakArchive(w)).workspace.formulaDraft.config.outputs[0].expression).toBe('');
 });
 it('CSV和HTML的谱级误差携带所属文件来源',()=>{
  const w=createPeakWorkspace();w.analysis=structuredClone(analysis);w.analysis!.spectra=[{id:'s1',sample_id:'s1',metrics:{rmse:{value:.5,unit:'a.u.',definition:'rmse',source_row:2,source_column:'RMSE'}},warnings:[]}];
  const rows=peakRows(w.analysis!);const metric=rows.find(r=>r[6]==='rmse')!;expect(metric[14]).toBe('result.csv');expect(metric[15]).toBe('a'.repeat(64));expect(metric[16]).toBe('数据');
  const html=peakAnalysisReport(w);expect(html).toContain('谱级拟合误差');expect(html).toContain('rmse');expect(html).toContain('0.5');
 });
 it('异常导出保留可定位的文件、哈希、工作表',()=>{
  const w=createPeakWorkspace();w.analysis=structuredClone(analysis);w.analysis!.issues=[{code:'unknown_unit',severity:'warning',message:'需声明单位',source_file:'issue-source.csv',source_sha256:'b'.repeat(64),source_sheet:'峰表',row:3,column:'width'}];
  const rows=issueRows(w.analysis!);expect(rows[0]).toContain('source_file');expect(rows[1]).toContain('issue-source.csv');expect(rows[1]).toContain('b'.repeat(64));expect(rows[1]).toContain('峰表');
  const html=peakAnalysisReport(w);expect(html).toContain('issue-source.csv');expect(html).toContain('峰表');
 });
 it('保存时拒绝累计超过读取上限的合法草稿，不生成无法恢复的文件',()=>{
  const w=createPeakWorkspace();w.formulaDraft.config.extra_notes=Array(530).fill('x'.repeat(99000));
  expect(()=>writePeakArchive(w)).toThrow(/50 MiB/);
 });
});
