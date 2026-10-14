import { describe,expect,it } from 'vitest';
import { experimentArchive,readExperimentMetadata } from './batchExperimentArchive';
import { emptyMetadata } from './batchTrend';
const source={filename:'sample.csv',file_sha256:'hash',sheet:'data',x_column:'x',y_column:'y'};
const run:any={id:'batch',status:'done',sequential:true,rows:[{id:'old',label:'样品',request:{source},attempts:[{id:'a',invalidated:false}],result:{value:1.234567891}}]};
describe('实验记录 JSON v2 草稿兼容',()=>{
  it('仅增加实验记录，数值和尝试记录保持原精度；新任务 ID 按来源匹配',()=>{
    const m={...emptyMetadata(),sample_id:'A',condition_name:'温度',condition_value:25,condition_unit:'°C',replicate_id:'2'};
    const archive=experimentArchive(run,{old:m});expect(archive.template_version).toBe(2);expect(archive.rows).toBe(run.rows);
    expect((archive.rows[0].result as any).value).toBe(1.234567891);
    expect(readExperimentMetadata(JSON.parse(JSON.stringify(archive)),[{id:'new',source}])).toEqual({new:m});
  });
  it('旧版本没有实验记录时返回空映射；不猜测缺失值和单位',()=>{
    expect(readExperimentMetadata({...run,template_version:1},[{id:'new',source}])).toEqual({});
    const a=experimentArchive(run,{});expect(a.experiment_metadata.old.condition_value).toBeNull();
    expect(readExperimentMetadata(a,[{id:'new',source}]).new.condition_unit).toBe('');
  });
  it('未知版本、非法数值、重复来源和不匹配来源均拒绝，不部分导入',()=>{
    const a=experimentArchive(run,{});
    expect(()=>readExperimentMetadata({...a,template_version:3},[])).toThrow('版本');
    expect(()=>readExperimentMetadata({...a,experiment_metadata:{old:{...emptyMetadata(),condition_value:'25'}}},[{id:'new',source}])).toThrow('数值');
    expect(()=>readExperimentMetadata(a,[{id:'new',source:{...source,y_column:'other'}}])).toThrow('匹配');
    expect(()=>readExperimentMetadata(a,[{id:'new',source},{id:'duplicate',source}])).toThrow('重复');
  });
});
