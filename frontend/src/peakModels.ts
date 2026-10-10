import type { PeakModel } from "./types";

export interface PeakModelInfo {
  id: PeakModel;
  label: string;
  shortDescription: string;
  formula: string;
  parameterMeaning: string;
}

export const PEAK_MODEL_OPTIONS: PeakModelInfo[] = [
  { id: "gaussian", label: "Gaussian（高斯）", shortDescription: "对称、短尾，适合仪器展宽。", formula: "G(x; A, xc, FWHM)", parameterMeaning: "A 为峰面积（积分强度），xc 为峰中心位置，w 为半高全宽（FWHM）。" },
  { id: "lorentz", label: "Lorentz（洛伦兹）", shortDescription: "对称、长尾，适合寿命展宽。", formula: "L(x; A, xc, FWHM)", parameterMeaning: "A 为峰面积（积分强度），xc 为峰中心位置，w 为半高全宽（FWHM）。" },
  { id: "psd_voigt1", label: "PsdVoigt1", shortDescription: "Gaussian 与 Lorentz 共用 FWHM。", formula: "μL(x; w) + (1−μ)G(x; w)", parameterMeaning: "A 为峰面积（积分强度），xc 为峰中心位置；w 是共用 FWHM；μ 为 Lorentzian 分量权重，1−μ 为 Gaussian 分量权重。" },
  { id: "psd_voigt2", label: "PsdVoigt2", shortDescription: "Gaussian 与 Lorentz 使用独立宽度。", formula: "μL(x; wL) + (1−μ)G(x; wG)", parameterMeaning: "A 为峰面积（积分强度），xc 为峰中心位置；wG/wL 分别为 Gaussian/Lorentzian 分量的 FWHM；μ 为 Lorentzian 分量权重，1−μ 为 Gaussian 分量权重。" },
  { id:"split_psd_voigt", label:"Split Pseudo-Voigt", shortDescription:"两侧宽度不同，峰顶连续。", formula:"归一化分段 Pseudo-Voigt", parameterMeaning:"A 为模型全域积分面积，xc 为峰顶；h_low/h_high 分别为低/高 X 侧半高半宽，整体 FWHM 为两者之和；μ 为 Lorentzian 权重。" },
  { id:"emg_high", label:"EMG（高 X 拖尾）", shortDescription:"Gaussian 与单侧指数卷积，向高 X 拖尾。", formula:"Gaussian ⊗ 高 X 单侧指数", parameterMeaning:"A 为模型全域积分面积，xc 为实际峰顶；σ 为高斯核标准差，τ 为指数尾尺度，均不是整体 FWHM；τ=0 时退化为 Gaussian。方向按 X 数值定义。" },
  { id:"emg_low", label:"EMG（低 X 拖尾）", shortDescription:"Gaussian 与单侧指数卷积，向低 X 拖尾。", formula:"Gaussian ⊗ 低 X 单侧指数", parameterMeaning:"A 为模型全域积分面积，xc 为实际峰顶；σ 为高斯核标准差，τ 为指数尾尺度，均不是整体 FWHM；τ=0 时退化为 Gaussian。方向按 X 数值定义。" },
];

export type PeakParameterName = "A"|"xc"|"w"|"wG"|"wL"|"mu"|"h_low"|"h_high"|"sigma"|"tau";
export const PEAK_MODEL_PARAMETERS:Record<PeakModel,PeakParameterName[]> = {
  gaussian:['A','xc','w'],lorentz:['A','xc','w'],psd_voigt1:['A','xc','w','mu'],psd_voigt2:['A','xc','wG','wL','mu'],
  split_psd_voigt:['A','xc','h_low','h_high','mu'],emg_high:['A','xc','sigma','tau'],emg_low:['A','xc','sigma','tau'],
};
export const MODEL_GROUPS = [
  {label:'对称峰',models:PEAK_MODEL_OPTIONS.slice(0,4)},
  {label:'两侧宽度不等',models:PEAK_MODEL_OPTIONS.slice(4,5)},
  {label:'单侧拖尾（按 X 数值方向）',models:PEAK_MODEL_OPTIONS.slice(5)},
];
export const PARAMETER_LABELS:Record<PeakParameterName,string> = {
  A:'模型全域面积 A',xc:'峰顶位置 xc',w:'整体 FWHM w',wG:'Gaussian 分量 FWHM wG',wL:'Lorentzian 分量 FWHM wL',mu:'Lorentzian 权重 μ',
  h_low:'低 X 侧半高半宽',h_high:'高 X 侧半高半宽',sigma:'高斯核标准差 σ',tau:'指数尾尺度 τ',
};

export function peakModelInfo(model?: string): PeakModelInfo | undefined {
  return PEAK_MODEL_OPTIONS.find((item) => item.id === model);
}
