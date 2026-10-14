import { describe, expect, it } from 'vitest';
import { createSelection, selectedSpectra, duplicateSelections, sortSpectra } from './batchSelection';
import type { DatasetInfo } from './types';
const dataset=(name='sample2.csv'):DatasetInfo=>({dataset_id:name,filename:name,file_sha256:'hash',sheets:[{name:'data',columns:[],numeric_columns:['x',...Array.from({length:120},(_,i)=>`spectrum_${i+1}`)],row_count:5,preview_rows:[]}]});
describe('批量选择与排序',()=>{
  it('120 个候选列先暂存，只对实际选中的 20 条应用限额',()=>{
    const draft=createSelection(dataset());expect(draft[0].yColumns).toEqual([]);
    draft[0].yColumns=draft[0].dataset.sheets[0].numeric_columns.slice(1,21);
    expect(selectedSpectra(draft,80)).toHaveLength(20);expect(()=>selectedSpectra(draft,81)).toThrow('100');
    draft[0].yColumns=draft[0].dataset.sheets[0].numeric_columns.slice(1,102);expect(()=>selectedSpectra(draft)).toThrow('100');
  });
  it('重复原文件列仅提示，不自动去重；X/Y 相同或不存在拒绝提交',()=>{
    const draft=createSelection(dataset());draft[0].yColumns=['spectrum_1'];const rows=selectedSpectra(draft);
    expect(duplicateSelections(rows,rows)).toHaveLength(1);expect(selectedSpectra([...draft,...draft])).toHaveLength(2);
    draft[0].yColumns=['x'];expect(()=>selectedSpectra(draft)).toThrow('X / Y');
    draft[0].yColumns=['missing'];expect(()=>selectedSpectra(draft)).toThrow('数值列');
  });
  it('自然排序 2 在 10 前，保留稳定身份且原始顺序可恢复',()=>{
    const rows=['sample10.csv','sample2.csv'].flatMap(n=>{const d=createSelection(dataset(n));d[0].yColumns=['spectrum_10','spectrum_2'];return selectedSpectra(d);}).map((r,i)=>({...r,id:String(i),originalOrder:i}));
    expect(sortSpectra(rows,'file').map(r=>r.dataset.filename)).toEqual(['sample2.csv','sample2.csv','sample10.csv','sample10.csv']);
    expect(sortSpectra(rows,'column').map(r=>r.yColumn)).toEqual(['spectrum_2','spectrum_2','spectrum_10','spectrum_10']);
    expect(sortSpectra(sortSpectra(rows,'column'),'original').map(r=>r.id)).toEqual(['0','1','2','3']);expect(rows[0].id).toBe('0');
  });
});
