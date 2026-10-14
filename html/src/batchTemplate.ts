import { isMulti } from './fitAdapter';
import { loadMultiConfiguration } from './multipeakState';
import { loadConfiguration } from './xpsState';
import type { BatchRequest } from './batchTypes';

/** 从现有配置/结果导出文件读取模板，沿用原有校验，不转换分析类型或单位。 */
export function readBatchTemplate(artifact:unknown,mode:'general'|'xrd'|'xps'):BatchRequest {
  if(!artifact||typeof artifact!=='object')throw new Error('请选择配置或拟合结果 JSON');
  const data=artifact as {request?:BatchRequest;configuration?:BatchRequest};
  const c=data.request??data.configuration;
  if(!c||typeof c!=='object'||!Array.isArray(c.x)||!Array.isArray(c.y))throw new Error('配置中缺少谱线数据');
  const actual=isMulti(c)?c.analysis_mode:'xps';
  if(actual!==mode)throw new Error('模板分析类型与当前页面不一致，请切换分析类型后加载');
  const template=isMulti(c)?loadMultiConfiguration({configuration:c},c.x,c.y,c.source,c.analysis_mode):loadConfiguration(artifact,c.x,c.y,c.source);
  if(!template.components.some(c=>c.enabled))throw new Error('模板至少需要一个启用峰，请先在单谱工作区手动选峰');
  if(isMulti(template))template.baseline.confirmed=false;else template.background.confirmed=false;
  return template;
}
