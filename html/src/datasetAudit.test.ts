import {describe,expect,it} from 'vitest';
import {mount} from '@vue/test-utils';
import DatasetAuditSummary from './components/DatasetAuditSummary.vue';
describe('预览审计向后兼容展示',()=>{
  it('旧响应不误报零排除',()=>{const w=mount(DatasetAuditSummary);expect(w.text()).toContain('未提供');expect(w.find('details').exists()).toBe(false);w.unmount();});
  it('新响应显示计数、解析行号与多重原因边界',()=>{
    const w=mount(DatasetAuditSummary,{props:{audit:{version:1,row_basis:'parsed_sheet_after_empty_rows_removed',sheet_rows:4,valid_pairs:2,excluded_pairs:2,exclusion_reasons:{x_non_numeric:1,y_missing:2},excluded_rows:[{parsed_row:4,reasons:['x_non_numeric','y_missing']}],excluded_rows_truncated:false,source_rows:[2,1],sorting_changed:true,duplicate_x_count:0}}});
    expect(w.text()).toContain('2 个有效配对 / 4 行');expect(w.text()).toContain('X 非数值；Y 空值');expect(w.text()).toContain('不是原文件物理行号');w.unmount();
  });
});
