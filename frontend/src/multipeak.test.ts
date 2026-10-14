import { describe, expect, it } from 'vitest';

async function state() {
  const modules = import.meta.glob('./multipeakState.ts');
  expect(modules['./multipeakState.ts'], '通用多峰状态尚未实现').toBeDefined();
  return await modules['./multipeakState.ts']() as typeof import('./multipeakState');
}

describe('通用多峰配置', () => {
  it('统一切换保留公共参数，约束不兼容时所有峰保持原样',async()=>{
    const s=await state(),c=s.createMultiConfig([0,1,2,3],[0,5,2,0],null,'general');
    s.addMultiComponent(c);s.addMultiComponent(c);s.addMultiComponent(c);
    c.components[0].parameters.xc={value:1.2,lower:1,upper:2,fixed:true};
    s.changeAllMultiModels(c,'psd_voigt2');
    expect(c.components.every(p=>p.model==='psd_voigt2')).toBe(true);
    expect(c.components[0].parameters.xc).toEqual({value:1.2,lower:1,upper:2,fixed:true});
    c.constraints.push({source:{component:'p2',parameter:'wG'},target:{component:'p3',parameter:'wG'},kind:'ratio',value:1});
    const before=s.clone(c);
    expect(()=>s.changeAllMultiModels(c,'gaussian')).toThrow('解除');
    expect(c).toEqual(before);
  });
  it('增加峰使用独立参数，改变模型支持两种宽度，来源数据不被修改', async () => {
    const s = await state(); const x = [0,1,2,3,4];
    const c = s.createMultiConfig(x,[0,1,5,1,0],null,'general');
    s.addMultiComponent(c); s.addMultiComponent(c);
    expect(c.components.map(p=>p.id)).toEqual(['p1','p2']);
    s.changeMultiModel(c,'p1','psd_voigt2');
    expect(Object.keys(c.components[0].parameters)).toEqual(['A','xc','wG','wL','mu']);
    c.x[0] = -1; expect(x[0]).toBe(0);
  });
  it('循环绑定被拒绝，已绑定参数不能随模型切换丢失', async () => {
    const s=await state(); const c=s.createMultiConfig([0,1,2,3],[1,2,3,1],null,'general');
    s.addMultiComponent(c);s.addMultiComponent(c);
    c.constraints.push({source:{component:'p1',parameter:'w'},target:{component:'p2',parameter:'w'},kind:'ratio',value:1});
    expect(()=>s.changeMultiModel(c,'p1','emg_high')).toThrow('解除');
    c.constraints.push({source:{component:'p2',parameter:'w'},target:{component:'p1',parameter:'w'},kind:'ratio',value:1});
    expect(()=>s.validateMulti(c)).toThrow('循环');
  });
  it('配置恢复核对来源与数据，拒绝其他谱线', async () => {
    const s=await state(); const source={filename:'a.csv',file_sha256:'a'.repeat(64),sheet:'数据',x_column:'x',y_column:'y'};
    const c=s.createMultiConfig([0,1,2,3],[1,2,3,1],source,'general');s.addMultiComponent(c);
    expect(s.loadMultiConfiguration({configuration:c},c.x,c.y,source,'general').baseline.confirmed).toBe(false);
    expect(()=>s.loadMultiConfiguration({configuration:c},c.x,c.y,{...source,y_column:'other'},'general')).toThrow('不匹配');
  });
});
