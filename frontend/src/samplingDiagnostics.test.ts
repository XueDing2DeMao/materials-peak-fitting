import {describe,expect,it} from 'vitest';
import {samplingDiagnostics} from './samplingDiagnostics';
const geometry=(lo:number,hi:number)=>({halfmax_low:lo,halfmax_high:hi,fwhm:hi-lo} as any);
describe('实际观测采样支持',()=>{
  it('非均匀采样使用实际点和间隔，倒序保持同一统计',()=>{
    const x=[0,1,1.1,2.8,5],g=geometry(1,3);
    expect(samplingDiagnostics(x,g)).toMatchObject({count:3,minimum:expect.closeTo(.1),median:expect.closeTo(.9),maximum:expect.closeTo(1.7),extrapolated:false});
    expect(samplingDiagnostics([...x].reverse(),g)).toEqual(samplingDiagnostics(x,g));
  });
  it('稀疏、外推和缺失宽度不伪造精度或合格阈值',()=>{
    expect(samplingDiagnostics([0,2,4],geometry(1,3))).toMatchObject({count:1,median:null});
    expect(samplingDiagnostics([1,2,3],geometry(0,2))).toMatchObject({count:2,extrapolated:true});
    expect(samplingDiagnostics([1,2],geometry(1,1)).count).toBeNull();
    expect(samplingDiagnostics([1,2]).count).toBeNull();
  });
});
