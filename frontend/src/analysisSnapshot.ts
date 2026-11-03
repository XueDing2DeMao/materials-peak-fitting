import {spectrumUnits} from './spectrumUnits';
import type {BatchRequest,BatchResult} from './batchTypes';
import type {FitResult} from './types';
import type {SingleSolverSettings} from './singleFitAdapter';
import {presentPeaks,presentSinglePeak} from './resultPresentation';
export interface AnalysisSnapshot {
  engine:'single'|'multi'|'xps'; configuration:BatchRequest; result:FitResult|BatchResult;
  singleSettings?:SingleSolverSettings; stale:boolean; accepted?:boolean;
}
export function snapshotPeaks(s:AnalysisSnapshot){
  const p=s.configuration.components.find(p=>p.enabled);
  return s.engine==='single'?[presentSinglePeak(s.result as FitResult,p?.id,p?.label)]:presentPeaks(s.result as BatchResult);
}
export const snapshotUnits=(s:AnalysisSnapshot)=>spectrumUnits('analysis_mode' in s.configuration?s.configuration.analysis_mode:'xps',s.configuration.source);
export const snapshotUnit=(s:AnalysisSnapshot)=>snapshotUnits(s).x;
