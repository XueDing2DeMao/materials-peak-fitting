import {afterEach,describe,expect,it,vi} from 'vitest';
import {flushPromises,mount} from '@vue/test-utils';
import DatasetTable from './components/DatasetTable.vue';
import type {DatasetRows} from './datasetRows';
const sheet={name:'s',columns:['x','y','note'],numeric_columns:['x','y'],row_count:205,preview_rows:[]};
const page=(offset=0,name='s'):DatasetRows=>({sheet:name,columns:sheet.columns,offset,limit:100,total_rows:205,row_numbers:[offset+1],rows:[[offset,2,'<script>raw</script>']]});
const wrappers:ReturnType<typeof mount>[]=[];
afterEach(()=>wrappers.splice(0).forEach(w=>w.unmount()));
describe('全部数据分页浏览',()=>{
  it('读取全部列并翻页、跳页，单元格文本不执行 HTML',async()=>{
    const load=vi.fn(async(_id,_s,offset)=>page(offset));
    const w=mount(DatasetTable,{props:{datasetId:'a',sheet,load}});wrappers.push(w);await flushPromises();
    expect(load).toHaveBeenLastCalledWith('a','s',0,100);expect(w.findAll('thead th')).toHaveLength(4);expect(w.find('script').exists()).toBe(false);
    await w.get('[data-test="data-next"]').trigger('click');await flushPromises();expect(load).toHaveBeenLastCalledWith('a','s',100,100);
    await w.get('input').setValue(3);await w.get('[data-test="data-jump"]').trigger('click');await flushPromises();expect(load).toHaveBeenLastCalledWith('a','s',200,100);expect(w.get('[data-test="data-next"]').attributes('disabled')).toBeDefined();
  });
  it('切换表后拒绝晚返回旧页，失败清除旧页并提供重试',async()=>{
    let finish!:(v:DatasetRows)=>void;
    const load=vi.fn().mockReturnValueOnce(new Promise(r=>finish=r)).mockResolvedValueOnce(page(0,'other')).mockRejectedValueOnce(new Error('数据已失效'));
    const w=mount(DatasetTable,{props:{datasetId:'a',sheet,load}});wrappers.push(w);
    await w.setProps({sheet:{...sheet,name:'other'}});await flushPromises();finish({...page(),rows:[['OLD',2,3]]});await flushPromises();expect(w.text()).not.toContain('OLD');
    await w.get('[data-test="data-next"]').trigger('click');await flushPromises();expect(w.get('[role="alert"]').text()).toContain('已失效');expect(w.find('tbody').exists()).toBe(false);
    load.mockResolvedValueOnce(page(100,'other'));await w.get('[data-test="data-retry"]').trigger('click');await flushPromises();expect(w.find('tbody').exists()).toBe(true);
  });
  it('会话快照分页不调用服务，明确只是已保存的 X/Y',async()=>{
    const load=vi.fn(),x=Array.from({length:205},(_,i)=>i),y=x.map(i=>i*2);
    const w=mount(DatasetTable,{props:{datasetId:'session:a',sheet:{...sheet,columns:['x','y']},snapshot:{x,y},load}});wrappers.push(w);await flushPromises();
    expect(load).not.toHaveBeenCalled();expect(w.text()).toContain('会话');expect(w.findAll('tbody tr')).toHaveLength(100);
    await w.get('input').setValue(3);await w.get('[data-test="data-jump"]').trigger('click');await flushPromises();expect(w.findAll('tbody tr')).toHaveLength(5);expect(w.text()).toContain('408');
  });
});
