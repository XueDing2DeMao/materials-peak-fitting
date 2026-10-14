import { describe, expect, it } from 'vitest';
import { overviewBounds, overviewPoints } from './backgroundOverview';
describe('批量背景缩略图',()=>{
  it('共享原始强度坐标，保留负值与全部观测点，XPS 可倒序',()=>{
    const data=[{x:[1,2,3],raw_y:[-2,10,3],baseline:[-1,0,1]},{x:[1,2,3],raw_y:[0,30,4],baseline:[0,0,0]}];
    const b=overviewBounds(data);expect(b).toEqual({xmin:1,xmax:3,ymin:-2,ymax:30});
    const points=overviewPoints(data[0].x,data[0].raw_y,b,false);expect(points.split(' ')).toHaveLength(3);expect(points.startsWith('36,')).toBe(true);
    expect(overviewPoints(data[0].x,data[0].raw_y,b,true).startsWith('304,')).toBe(true);
  });
  it('空值与非有限值不会产生 NaN 坐标',()=>{const b=overviewBounds([]);expect(b).toBeNull();expect(overviewPoints([1],[NaN],null,false)).toBe('');});
});
