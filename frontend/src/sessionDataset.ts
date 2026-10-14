import type {BatchRequest} from './batchTypes';
import type {DatasetInfo} from './types';
/** 只用于展示来源；恢复计算使用快照，不把本地 ID 发往服务器。 */
export function sessionDataset(c:BatchRequest):DatasetInfo{
  const s=c.source,columns=[s?.x_column??'X',s?.y_column??'Y'];
  return {dataset_id:`session:${s?.file_sha256??crypto.randomUUID()}`,filename:s?.filename??'会话原谱',file_sha256:s?.file_sha256,
    sheets:[{name:s?.sheet??'恢复谱线',columns,numeric_columns:columns,row_count:c.x.length,preview_rows:[]}]};
}
