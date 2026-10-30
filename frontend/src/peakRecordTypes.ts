/** 峰参数解析协议独立于必须包含曲线的拟合求解协议。 */
export type PeakField='position'|'width'|'height'|'area';
export type SpectrumMetric='rmse'|'r_squared'|'rss'|'chi_square';
export type Technique='general'|'xrd'|'raman'|'ftir'|'xps';
export type Scalar=string|number|boolean|null;
export interface PeakIssue {code:string;message:string;severity:'warning'|'error';row?:number;column?:string;record_id?:string;path?:string;source_file?:string|null;source_sha256?:string|null;source_sheet?:string|null}
export interface PeakQuantity {
 value:number|null;unit:string|null;definition:string|null;raw_value?:unknown;raw_definition?:string|null;
 source_column?:string|null;source_row?:number|null;source_cell?:string|null;reason?:string|null;
 standard_error?:number|null;standard_error_column?:string|null;
}
export interface PeakRecord {
 id:string;sample_id:string;spectrum_id:string;peak_id:string;label?:string;model?:string|null;technique?:Technique;
 fields:Record<PeakField,PeakQuantity>;source:{filename:string;file_sha256:string|null;sheet:string;row:number|null;columns?:Record<string,unknown>;parser_version?:string;[key:string]:unknown};
 status?:'valid'|'review'|'invalid';metadata?:Record<string,unknown>;issues?:PeakIssue[];warnings?:string[];
}
export interface SpectrumRecord {id:string;sample_id:string;metrics:Record<string,PeakQuantity>;warnings:string[]}
export interface PeakMapping {
 sheet:string;layout:'wide'|'long';header_row:number;data_start_row?:number|null;data_end_row?:number|null;
 columns:Record<string,string|number>;units:Partial<Record<PeakField|SpectrumMetric,string>>;
 width_definition:'fwhm'|'hwhm'|'sigma'|'unknown';position_definition:'two_theta'|'apex'|'model_position'|'centroid'|'unknown';
 area_definition:'total'|'range'|'unknown';default_model:string;technique:Technique;
 parameter_aliases?:Record<string,string>;fingerprint?:string;template_version:1;metadata?:Record<string,unknown>;
}
export interface NormalizedAnalysis {schema_version:1;records:PeakRecord[];spectra:SpectrumRecord[];issues:PeakIssue[];mapping?:PeakMapping;fingerprint?:string}
export interface ResultSheet {name:string;columns:string[];row_count:number;preview_rows:Scalar[][];row_numbers:number[]}
export interface ResultUpload {upload_id:string;filename:string;file_sha256:string;sheets:ResultSheet[];suggested_mapping:PeakMapping}
export interface MappingTemplate {format:'peak-mapping';schema_version:1;name:string;mapping:PeakMapping}
export interface CalculationRequest {records:PeakRecord[];method:string;config:Record<string,any>}
export interface CalculatedValue {value:number|null;unit:string;definition?:string}
export interface CalculationResult {record_ids:string[];sample_id:string;values:Record<string,CalculatedValue>;status:'valid'|'apparent'|'invalid';warnings:string[];error?:{code:string;message:string};details?:Record<string,unknown>}
export interface CalculationResponse {method:string;method_version:string;input_hash:string;configuration:Record<string,unknown>;results:CalculationResult[]}
export interface CalculationHistory {id:string;created_at:string;request:CalculationRequest;response:CalculationResponse;stale:boolean;stale_reason?:string}
export interface FormulaDraft {method:string;config:Record<string,any>}
export interface PeakWorkspace {analysis:NormalizedAnalysis|null;templates:MappingTemplate[];formulaDraft:FormulaDraft;calculations:CalculationHistory[];revision:number;note:string}
export interface MethodField {key:string;label:string;type:'number'|'text'|'select'|'boolean'|'json';default?:any;options?:Array<string|{value:string;label:string}>;help?:string}
export interface CalculationMethod {id:string;title:string;description:string;fields:MethodField[];default_config:Record<string,any>}
export interface MethodCatalog {schema_version:1;methods:CalculationMethod[]}
