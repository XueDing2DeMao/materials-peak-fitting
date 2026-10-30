import { expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import PeakDiagnosticLinks from './components/PeakDiagnosticLinks.vue';
import type { PresentedPeak } from './resultPresentation';

it('仅结构化参数诊断生成可定位入口，强相关定位两端且不猜测未知 ID',async()=>{
  const peaks:PresentedPeak[]=[{id:'p7',label:'七',model:'gaussian',parameters:{xc:{value:3,standard_error:null,bound:true}},areaTotal:null,areaWindow:null,areaFraction:null}];
  const w=mount(PeakDiagnosticLinks,{props:{peaks,correlations:[{a:'p7.xc',b:'deleted.A',correlation:.99}]}});
  expect(w.findAll('button')).toHaveLength(2);
  await w.findAll('button')[1].trigger('click');
  expect(w.emitted('locate')).toEqual([['p7','xc']]);
  expect(peaks[0].parameters.xc.value).toBe(3);w.unmount();
});
