import { describe, expect, it } from 'vitest';
import { nearestPeakAt } from './chartPeakPick';
describe('图上点击添加峰',()=>{
  it('按当前轴范围换算坐标，兼容 XPS 倒序并排除边距',async()=>{
    const modules=import.meta.glob('./chartPeakPick.ts');expect(modules['./chartPeakPick.ts']).toBeDefined();
    const {pickX}=await modules['./chartPeakPick.ts']() as typeof import('./chartPeakPick');
    const el={getBoundingClientRect:()=>({left:10,top:20}),_fullLayout:{xaxis:{_offset:80,_length:500,range:[12,0]},yaxis:{_offset:100,_length:300}}} as unknown as HTMLElement;
    expect(pickX(el,340,220)).toBe(6);
    expect(pickX(el,30,220)).toBeNull();expect(pickX(el,340,50)).toBeNull();
  });
  it('右键只命中12像素内的可见峰，兼容倒序与缩放，重叠时优先最后添加者',()=>{
    const axis={_offset:80,_length:500,range:[12,0]};
    const el={getBoundingClientRect:()=>({left:10,top:20}),_fullLayout:{xaxis:axis,yaxis:{_offset:100,_length:300}}} as unknown as HTMLElement;
    const peaks=[{id:'p1',parameters:{xc:{value:6}}},{id:'p2',parameters:{xc:{value:6}}},{id:'p3',enabled:false,parameters:{xc:{value:6}}}];
    expect(nearestPeakAt(el,340,220,peaks,0,12)).toBe('p2');
    expect(nearestPeakAt(el,353,220,peaks,0,12)).toBeNull();
    expect(nearestPeakAt(el,340,50,peaks,0,12)).toBeNull();
    axis.range=[6.5,5.5];expect(nearestPeakAt(el,351,220,peaks,0,12)).toBe('p2');
    expect(nearestPeakAt(el,340,220,peaks,7,12)).toBeNull();
    const outside=[{id:'p4',parameters:{xc:{value:6.51}}}];
    axis.range=[5.5,6.5];expect(nearestPeakAt(el,585,220,outside,0,12)).toBeNull();
    axis.range=[6.5,5.5];expect(nearestPeakAt(el,95,220,outside,0,12)).toBeNull();
  });
});
