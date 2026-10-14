import { expect, it } from 'vitest';
import { peakAnnotations } from './peakAnnotations';

it('区间外、停用或无效峰位不标注，相邻标签错开且不允许拖动标线', () => {
  const peaks = [
    {id:'p1',parameters:{xc:{value:2.95}}},
    {id:'p2',parameters:{xc:{value:3.025}}},
    {id:'p3',enabled:false,parameters:{xc:{value:3}}},
    {id:'p4',parameters:{xc:{value:5}}},
    {id:'p5',parameters:{xc:{value:NaN}}},
  ];
  const result=peakAnnotations(peaks,2.55,3.3,'°');
  expect(result.annotations.map(a=>a.x)).toEqual([2.95,3.025]);
  expect(result.annotations[0].y).not.toBe(result.annotations[1].y);
  expect(result.annotations[1].text).toBe('p2<br>3.025°');
  expect(result.shapes.every(s=>s.editable===false)).toBe(true);
});
