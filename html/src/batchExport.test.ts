import { describe, expect, it } from 'vitest';
import { csv } from './resultExport';
import { batchRows } from './batchExport';
import { BatchRunner } from './batchRunner';
import { createMultiConfig, addMultiComponent } from './multipeakState';
describe('实际批次导出',()=>{
  it('失败尝试和空结果保留来源，不填零或启动求解',async()=>{
    const c=createMultiConfig([0,1,2,3],[0,1,2,0],null,'general');addMultiComponent(c);
    const run=new BatchRunner([{id:'a',label:'=bad,"name"',request:c}],async()=>{throw new Error('求解失败');});
    await run.start();const rows=batchRows(run,'parameters'),curves=batchRows(run,'curves');
    expect(rows.some(r=>r.includes('求解失败'))).toBe(true);expect(csv(rows)).toContain("'=bad");
    expect(curves[1].length).toBe(curves[0].length);expect(curves[1].at(-1)).toBe('求解失败');
    expect(run.rows[0].attempts).toHaveLength(2);
  });
  it('CSV 转义换行与引号，保留负数值',()=>{
    expect(csv([['x','a"b\nc',-2,'=1+1']])).toBe('\ufeff"x","a""b\nc","-2","\'=1+1"');
  });
});
