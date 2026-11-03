/** 数据不作换算。只接受表头中明确的单位，不从谱型或列名猜测强度标度。 */
export interface SpectrumUnits { x:string; y:string }
const knownUnits = /^(?:°|deg|rad|eV|meV|keV|cm(?:\^?-1|⁻¹)|1\/cm|nm|µm|μm|um|mm|Å|s|ms|ns|ps|Hz|kHz|MHz|GHz|THz|a\.?\s?u\.?|arb\.?\s?units?|counts?|counts?\/s|cps|%|mV|V|mA|A|W|mW|度|计数)$/i;

function columnUnit(column = '') {
  const text = column.trim();
  const suffix = text.match(/(?:\[([^\]]+)\]|\(([^)]+)\)|（([^）]+)）|\s\/\s*(.+))\s*$/);
  const candidate = (suffix?.slice(1).find(Boolean) ?? text).trim();
  return knownUnits.test(candidate) ? candidate : '';
}

type Mode='general'|'xrd'|'xps';
export function axisUnitConflict(mode:Mode,xColumn?:string):string {
  const unit=columnUnit(xColumn);
  if(!unit||mode==='general')return '';
  const compatible=mode==='xrd'?/^(°|度|deg)$/i.test(unit):/^ev$/i.test(unit);
  return compatible?'':`X 列“${xColumn}”的单位为 ${unit}，${mode==='xrd'?'XRD 需要角度（°）':'XPS 需要电子伏（eV）'}。请先换算数据或选择单位正确的 X 列。`;
}

export function spectrumUnits(mode:Mode, source?:{x_column:string;y_column:string}|null):SpectrumUnits {
  return {
    x: axisUnitConflict(mode,source?.x_column)?columnUnit(source?.x_column):
       mode === 'xrd' ? '°' : mode === 'xps' ? 'eV' : columnUnit(source?.x_column) || 'X 单位',
    y: columnUnit(source?.y_column) || 'Y 单位',
  };
}

const xQuantities = new Set(['xc','w','wG','wL','h_low','h_high','sigma','tau','position','peak_position','fwhm','hwhm_low','hwhm_high','halfmax_low','halfmax_high','range_start','range_end']);
const yQuantities = new Set(['height','peak_height','rmse','residual_mean','residual_standard_deviation']);
const areaQuantities = new Set(['A','area_total','area_window','area_in_range']);
const ratioQuantities = new Set(['mu','area_fraction_window','area_fraction_in_range','r_squared','adjusted_r_squared','durbin_watson']);
const squaredQuantities = new Set(['sse','rss','residual_variance','reduced_chi_square']);

/** 对标准误、置信限使用该参数原单位。未定义量纲的标签和状态保持空白。 */
export function quantityUnit(name:string,units:SpectrumUnits):string {
  if (xQuantities.has(name)) return units.x;
  if (yQuantities.has(name)) return units.y;
  if (areaQuantities.has(name)) return `${units.y} × ${units.x}`;
  if (ratioQuantities.has(name)) return '无量纲';
  if (squaredQuantities.has(name)) return `(${units.y})²`;
  return '';
}
