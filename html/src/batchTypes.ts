import type { MultiRequest, MultiResult } from './multipeakTypes';
import type { XpsRequest, XpsResult } from './xpsTypes';
export type BatchRequest=MultiRequest|XpsRequest;
export type BatchResult=MultiResult|XpsResult;
export type RowStatus='pending'|'running'|'success'|'review'|'failed'|'skipped';
export interface BatchInput {id:string;label:string;request:BatchRequest}
export interface BatchAttempt {
  id:string; initialization_source:'template'|'previous_result'|'continuation'; parent_task_id:string|null;parent_attempt_id:string|null;
  request:BatchRequest;result:BatchResult|null;error:string;warnings:string[];manually_accepted:boolean;invalidated:boolean;
}
export interface BatchRow extends BatchInput {status:RowStatus;attempts:BatchAttempt[];result:BatchResult|null;accepted_attempt_id:string|null}
