import type { Anchor, BaselineKind, PeakModel } from './types';
import type { PeakParameterName } from './peakModels';
import type { XpsParameter, XpsSource, XpsResult, XpsComponentResult } from './xpsTypes';

export type MultiMode = 'general' | 'xrd';
export interface MultiComponent { id:string; label:string; enabled:boolean; model:PeakModel; parameters:Partial<Record<PeakParameterName,XpsParameter>> }
export interface MultiConstraint { source:{component:string;parameter:PeakParameterName}; target:{component:string;parameter:PeakParameterName}; kind:'offset'|'ratio';value:number }
export interface MultiRequest {
  schema_version:1; analysis_mode:MultiMode; x:number[]; y:number[];
  range_start:number; range_end:number;
  baseline:{kind:BaselineKind;anchors:Anchor[];degree:number;smoothing:number;confirmed:boolean};
  components:MultiComponent[]; constraints:MultiConstraint[];
  solver:{max_nfev:number;tolerance:number};source:XpsSource|null;
}
export interface MultiPreview { x:number[];raw_y:number[];baseline:number[];baseline_configuration:MultiRequest['baseline'] & {resolved_anchors:Anchor[]} }
export interface MultiResult extends Omit<XpsResult,'configuration'|'components'|'background'|'x_raw'>, MultiPreview {
  configuration:MultiRequest; components:(Omit<XpsComponentResult,'model'> & {model:PeakModel})[];
  computed_only:boolean; statistics_definition:Record<string,string>;
}
