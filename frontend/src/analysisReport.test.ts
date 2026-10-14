import {describe,expect,it} from 'vitest';
import {analysisReport} from './analysisReport';
import {createMultiConfig} from './multipeakState';
describe('可打印分析摘要',()=>{
  it('用户文本正确转义，失败不冒充结果且无脚本执行',()=>{
    const html=analysisReport([{label:'<img src=x onerror=alert(1)>',snapshot:null,status:'失败',note:'a&b'}],'<script>alert(1)</script>');
    expect(html).not.toContain('<script>');expect(html).toContain('&lt;script&gt;');expect(html).toContain('没有可用结果');expect(html).toContain('a&amp;b');
  });
  it('绑定原配置与结果，标明过期、单位、背景和科学边界，不改变输入',()=>{
    const configuration=createMultiConfig([0,1,2],[1,3,1],null,'xrd');
    const result:any={x:[0,1,2],raw_y:[1,3,1],baseline:[1,1,1],total_y:[1,3,1],parameters:{},converged:true,statistics:{r_squared:1,rmse:0},model:'gaussian'};
    const entry:any={label:'样品',status:'完成',snapshot:{engine:'single',configuration,result,stale:true}};const original=JSON.stringify(entry),html=analysisReport([entry]);
    expect(html).toContain('过期结果');expect(html).toContain('未扣除仪器展宽');expect(html).toContain('<svg');expect(html).toContain('0');expect(JSON.stringify(entry)).toBe(original);
  });
});
