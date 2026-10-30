import { describe, expect, it } from 'vitest';
import { spectrumViewport } from './spectrumViewport';

describe('谱线显示范围与科研数据分离',()=>{
  it('焦点范围忽略区间外强峰，但保留真实原始数据及精度',()=>{
    const traces=[{x:[0,1.123456789,2,3],y:[100000,10.123456789,20,100000]}];
    const before=JSON.stringify(traces),view=spectrumViewport(traces,1,2)!;
    expect(view.x).toEqual([1,2]);expect(view.y![1]).toBeLessThan(25);
    expect(JSON.stringify(traces)).toBe(before);
    expect(spectrumViewport(traces,1,2,true)!.x).toEqual([2,1]);
  });
  it('所有真实曲线参与 Y 范围，空区间和非法区间安全处理',()=>{
    expect(spectrumViewport([{x:[1,2],y:[10,20]},{x:[1,2],y:[0,4]}],1,2)!.y![0]).toBeLessThan(0);
    expect(spectrumViewport([{x:[1],y:[NaN]}],1,2)!.y).toBeUndefined();
    expect(spectrumViewport([],2,1)).toBeNull();
  });
});
