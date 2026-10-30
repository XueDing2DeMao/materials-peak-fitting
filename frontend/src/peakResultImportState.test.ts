import {describe,it,expect} from 'vitest';
import {mappingTemplate,readMappingTemplate,applyMappingTemplate,mergeAnalyses} from './peakResultImportState';
import {mount} from '@vue/test-utils';
import PeakFieldMapping from './components/PeakFieldMapping.vue';
describe('峰结果映射与纳入',()=>{
 it('映射模板不绑定暂时上传ID，缺列必须重新复核',()=>{
  const t=mappingTemplate('XRD',{sheet:'数据',layout:'wide',header_row:1,columns:{position:'center',width:'FWHM'},units:{position:'deg',width:'deg'},position_definition:'two_theta',width_definition:'fwhm',area_definition:'unknown',default_model:'unknown',technique:'xrd',template_version:1});
  expect(readMappingTemplate(JSON.stringify(t))).toEqual(t);
  expect(applyMappingTemplate(t,['FWHM','center']).missing).toEqual([]);
  expect(applyMappingTemplate(t,['center']).missing).toEqual(['FWHM']);
 });
 it('按来源记录身份拒绝重复纳入，同时允许同文件名不同哈希',()=>{
  const a:any={schema_version:1,records:[{id:'a',source:{file_sha256:'a'},fields:{}}],spectra:[],issues:[]};
  expect(mergeAnalyses(a,a).records).toHaveLength(1);
  expect(mergeAnalyses(a,{...a,records:[{id:'b',source:{file_sha256:'b'},fields:{}}]}).records).toHaveLength(2);
 });
 it('谱级误差单位可明确声明而不被猜成无量纲',async()=>{
  const mapping:any={sheet:'数据',layout:'wide',header_row:1,columns:{position:'center',rmse:'RMSE',r_squared:'R2'},units:{position:'deg'},position_definition:'two_theta',width_definition:'unknown',area_definition:'unknown',default_model:'unknown',technique:'xrd',template_version:1};
  const w=mount(PeakFieldMapping,{props:{modelValue:mapping,upload:{upload_id:'u',filename:'x.csv',file_sha256:'a',sheets:[{name:'数据',columns:['center','RMSE','R2'],row_count:1,preview_rows:[],row_numbers:[]}],suggested_mapping:mapping}}});
  expect(mapping.units.r_squared).toBeUndefined();await w.get('[data-test="metric-unit-rmse"]').setValue('a.u.');expect(mapping.units.rmse).toBe('a.u.');
 });
});
