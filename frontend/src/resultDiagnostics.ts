import type { BatchResult } from './batchTypes';
import type { FitResult } from './types';

// 与 backend/app/multipeak_core.py 保持一致；不新增科学判定阈值。
export const hasCorrelatedResiduals=(lag:number|null|undefined)=>typeof lag==='number'&&Number.isFinite(lag)&&Math.abs(lag)>.5;
const unique=(items:(string|null|undefined)[])=>[...new Set(items.filter((s):s is string=>Boolean(s)).map(s=>s.replace(/[。；]+$/,'')))];
export function resultDiagnostics(result:BatchResult|FitResult|null,options:{busy?:boolean;accepted?:boolean}={}){
  const warnings:string[]=[],notes:string[]=[],tags:string[]=[];
  let fixed=false;
  if(result){
    if('components' in result){
      fixed=('computed_only' in result&&result.computed_only)||result.statistics.free_parameters===0;
      const d=result.diagnostics;
      if(!fixed&&!d.identifiable){tags.push('不可独立辨识');warnings.push('峰分量不可独立辨识，请检查峰数与约束。');}
      if(d.bound_parameters?.length||result.components.some(c=>Object.values(c.parameters).some(p=>p.bound))){tags.push('参数贴边');warnings.push('存在贴边参数，相关线性标准误不可用。');}
      if(d.strong_correlations?.length){tags.push('参数强相关');warnings.push('存在强参数相关，请检查峰数、区间及初值敏感性。');}
      if(hasCorrelatedResiduals(d.lag1_correlation)){tags.push('残差相关');warnings.push('残差具有明显相邻相关性；收敛和高 R² 不代表模型适用。');}
      if(!fixed&&!d.uncertainty_available){tags.push('部分标准误不可用');}
      for(const warning of d.warnings??[]){
        // 旧接口未给说明分配代码，仅将明确的通用口径移入说明；其他文字原样保留。
        if(warning.startsWith('标准误仅在当前固定背景、模型及约束下成立'))notes.push(warning);
        else warnings.push(warning);
      }
      for(const c of result.components)warnings.push(...(c.peak_geometry?.warnings??[]).map(w=>`${c.id}：${w}`));
    }else{
      fixed=result.statistics.free_parameters===0||(Object.keys(result.parameters).length>0&&Object.values(result.parameters).every(p=>p.fixed));
      warnings.push(...(result.peak_geometry?.warnings??[]));
      if(result.analysis_metadata?.initialization_warning)warnings.push(result.analysis_metadata.initialization_warning);
      if(result.analysis_metadata?.uncertainty_warning&&!fixed)warnings.push(result.analysis_metadata.uncertainty_warning);
      if(result.statistics.has_trend){tags.push('残差趋势');warnings.push('残差存在明显趋势，请复核基线、区间或峰模型。');}
      for(const [name,p] of Object.entries(result.parameters))if(!p.fixed&&p.uncertainty_reason)warnings.push(`${name}：${p.uncertainty_reason}`);
      notes.push('标准误及置信区间仅在当前固定基线、模型及参数约束下成立，不含基线选择误差。');
    }
    if(!result.converged&&!fixed){tags.push('未收敛');warnings.push('本次优化未收敛，请检查初值、分析区间和求解设置。');}
  }
  // 兼容旧结果仅带文字的诊断显示；批量残差门禁只使用结构化数值。
  for(const w of warnings)tags.push(/残差.*相关/.test(w)?'残差相关':/强.*相关/.test(w)?'参数强相关':/贴边/.test(w)?'参数贴边':/外推|超出.*区间/.test(w)?'区间外推':'其他诊断提示');
  return {warnings:unique(warnings),notes:unique(notes),tags:unique(tags),
    calculation:options.busy?'进行中':!result?'未运行':fixed?'固定参数计算':result.converged?'已收敛':'未收敛',
    diagnostic:!result?'尚无结果':warnings.length||tags.length?'有警告':'未触发已实现诊断',
    review:options.accepted?'人工接受':'未复核'};
}
