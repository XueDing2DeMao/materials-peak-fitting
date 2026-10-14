export interface DatasetRows {
  sheet: string;
  columns: string[];
  offset: number;
  limit: number;
  total_rows: number;
  row_numbers: number[];
  rows: Array<Array<string | number | boolean | null>>;
}
export type DatasetRowsLoader = (datasetId: string, sheet: string, offset: number, limit: number) => Promise<DatasetRows>;
