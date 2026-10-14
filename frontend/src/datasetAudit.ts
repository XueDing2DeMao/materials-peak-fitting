/** /api/preview 的可选 v1 审计；旧服务没有 audit 时保留“未提供”。 */
export interface DatasetAudit {
  version:1;row_basis:'parsed_sheet_after_empty_rows_removed';sheet_rows:number;valid_pairs:number;excluded_pairs:number;
  exclusion_reasons:Record<string,number>;excluded_rows:{parsed_row:number;reasons:string[]}[];excluded_rows_truncated:boolean;
  source_rows:number[];sorting_changed:boolean;duplicate_x_count:number;
}
export interface AuditedPreview {x:number[];y:number[];audit?:DatasetAudit}
export const auditReasons:Record<string,string>={x_missing:'X 空值',y_missing:'Y 空值',x_non_numeric:'X 非数值',y_non_numeric:'Y 非数值',x_non_finite:'X 无穷值',y_non_finite:'Y 无穷值'};
export function auditSummary(a?:DatasetAudit|null){return a?`${a.valid_pairs} 个有效配对 / ${a.sheet_rows} 行 · 排除 ${a.excluded_pairs} 行 · ${a.sorting_changed?'已按 X 稳定排序':'原顺序未变'} · 重复 X ${a.duplicate_x_count} 个`:'数据清理审计未提供（当前服务或会话无此记录）';}
