import {describe, expect, it} from 'vitest';
import { multiExportRows } from './multipeakResultExport';
import type { MultiResult } from './multipeakTypes';
import { spectrumUnits } from './spectrumUnits';

describe('通用多峰结果单位',()=>{
  it('只读取明确标注的单位，不把样品名称或列顺序当作单位',()=>{
    expect(spectrumUnits('general',{x_column:'Raman shift (cm⁻¹)',y_column:'I [counts/s]'})).toEqual({x:'cm⁻¹',y:'counts/s'});
    expect(spectrumUnits('general',{x_column:'wavenumber',y_column:'Intensity (sample A)'})).toEqual({x:'X 单位',y:'Y 单位'});
  });
  it('原列之后附上曲线、参数及统计量的单位，并保存数值置信限',()=>{
    const result={configuration:{analysis_mode:'general',source:{x_column:'frequency [THz]',y_column:'signal (mV)'}},
      x:[2],raw_y:[10],baseline:[1],total_y:[9],residuals:[1],converged:true,
      components:[{id:'p1',label:'peak',model:'gaussian',parameters:{xc:{value:2,standard_error:.05,confidence_interval:[1.9,2.1]}},y:[8],area_total:11,area_window:10,fwhm:1,height:8,peak_geometry:{peak_height_uncertainty:{standard_error:.1,confidence_interval:[7.8,8.2],reason:null}}}],
      statistics:{rmse:1,rss:1},diagnostics:{warnings:[]}} as unknown as MultiResult;
    const curves=multiExportRows('curves',result),parameters=multiExportRows('parameters',result);
    expect(curves).toEqual([['x','raw_y','baseline','total_y','residual','p1','x_unit','y_unit'],[2,10,1,9,1,8,'THz','mV']]);
    const row=(name:string)=>parameters.find(r=>r[3]===name)!;
    expect(row('xc').slice(-3)).toEqual(['THz',1.9,2.1]);
    expect(row('area_total')[7]).toBe('mV × THz');
    expect(row('height').slice(4)).toEqual([8,.1,'','mV',7.8,8.2]);
    expect(row('rss')[7]).toBe('(mV)²');
    const component=result.components[0];
    component.parameters.A={...component.parameters.xc,value:11,confidence_interval:[10.9,11.1]};
    component.parameters.w={...component.parameters.xc,value:1,confidence_interval:[.9,1.1]};
    const aliases=multiExportRows('parameters',result);
    for(const name of ['area_total','fwhm']){
      const cells=aliases.find(r=>r[3]===name)!;
      expect(cells[5]).toBe(.05);
      expect(cells.slice(-2)).toEqual(name==='fwhm'?[.9,1.1]:[10.9,11.1]);
    }
    component.model='psd_voigt2';
    expect(multiExportRows('parameters',result).find(r=>r[3]==='fwhm')![5]).toBeNull();
  });
});
