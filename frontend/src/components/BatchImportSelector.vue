<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import DatasetBrowserDialog from './DatasetBrowserDialog.vue';
import DataSelectionPreview from './DataSelectionPreview.vue';
import { duplicateSelections, selectedSpectra, type SheetSelection, type SpectrumSelection } from '../batchSelection';
import { previewColumnMapping } from '../batchColumnMapping';
const props=defineProps<{drafts:SheetSelection[];existing:SpectrumSelection[];disabled:boolean}>();
const emit=defineEmits<{commit:[rows:SpectrumSelection[]];cancel:[]}>();
const browser=ref<InstanceType<typeof DatasetBrowserDialog>|null>(null),dialog=ref<HTMLDialogElement|null>(null),trigger=ref<HTMLButtonElement|null>(null);
const opened=ref(false),activeKey=ref(''),fileSearch=ref(''),columnSearch=ref(''),fullNames=ref(false);
const lastSheet=ref<Record<string,string>>({}),issues=ref<Record<string,string>>({}),message=ref('');
const ruleOpen=ref(false),ruleMode=ref<'name'|'position'>('name'),ruleTargets=ref<string[]>([]);
const rulePanel=ref<HTMLElement|null>(null),ruleTrigger=ref<HTMLButtonElement|null>(null);
let autoOpened=false,disposed=false;
const files=computed(()=>[...new Map(props.drafts.map(d=>[d.dataset.dataset_id,d.dataset])).values()]);
const visibleFiles=computed(()=>files.value.filter(f=>f.filename.toLowerCase().includes(fileSearch.value.trim().toLowerCase())));
const active=computed(()=>props.drafts.find(d=>d.key===activeKey.value)??props.drafts[0]);
function sheets(id:string){return props.drafts.filter(d=>d.dataset.dataset_id===id);}
function sheet(d:SheetSelection){return d.dataset.sheets.find(s=>s.name===d.sheet)!;}
function fileCount(id:string){return sheets(id).reduce((n,d)=>n+d.yColumns.length,0);}
function fileIssue(id:string){return sheets(id).some(d=>Boolean(issues.value[d.key]));}
const count=computed(()=>props.drafts.reduce((n,d)=>n+d.yColumns.length,0));
const selectedFileCount=computed(()=>files.value.filter(f=>fileCount(f.dataset_id)>0).length);
const completedFiles=computed(()=>files.value.filter(f=>sheets(f.dataset_id).some(d=>d.yColumns.length)&&sheets(f.dataset_id).every(d=>!d.yColumns.length||(!issues.value[d.key]&&d.yColumns.every(y=>y!==d.xColumn&&sheet(d).numeric_columns.includes(y))&&sheet(d).numeric_columns.includes(d.xColumn)))).length);
const validation=computed(()=>{try{return {rows:selectedSpectra(props.drafts,props.existing.length),error:''};}catch(e){return {rows:[],error:(e as Error).message};}});
const duplicates=computed(()=>duplicateSelections(validation.value.rows,props.existing));
const columns=computed(()=>{
  if(!active.value)return [];
  const s=sheet(active.value),names=s.columns.length?s.columns:s.numeric_columns;
  return names.map((name,index)=>({name,index:index+1,numeric:s.numeric_columns.includes(name),sample:s.preview_rows.slice(0,3).map(row=>row[name]??'—').join(' · ')||'无行预览'}))
    .filter(c=>c.name.toLowerCase().includes(columnSearch.value.trim().toLowerCase()));
});
const otherSheets=computed(()=>props.drafts.filter(d=>d.dataset.dataset_id!==active.value?.dataset.dataset_id));
const mappings=computed(()=>active.value?otherSheets.value.map(target=>({target,...previewColumnMapping(active.value!,target,ruleMode.value)})):[]);
const applicable=computed(()=>mappings.value.filter(m=>ruleTargets.value.includes(m.target.key)&&!m.error));
function chooseFile(id:string){activeKey.value=lastSheet.value[id]??sheets(id)[0]?.key??'';}
watch(activeKey,()=>{if(active.value)lastSheet.value[active.value.dataset.dataset_id]=active.value.key;columnSearch.value='';ruleOpen.value=false;});
function edited(d:SheetSelection){delete issues.value[d.key];message.value='';}
function setX(d:SheetSelection,column:string){if(props.disabled)return;d.xColumn=column;d.yColumns=d.yColumns.filter(c=>c!==column);edited(d);}
function select(group:SheetSelection[],all:boolean){if(props.disabled)return;for(const d of group){d.yColumns=all?sheet(d).numeric_columns.filter(c=>c!==d.xColumn):[];edited(d);}}
async function open(){if(props.disabled||disposed)return;opened.value=true;await nextTick();if(!disposed&&opened.value&&dialog.value&&!dialog.value.open)dialog.value.showModal();}
function close(restoreFocus=true){opened.value=false;if(dialog.value?.open)dialog.value.close();if(restoreFocus)void nextTick(()=>{if(trigger.value?.isConnected)trigger.value.focus({preventScroll:true});});}
watch([()=>props.drafts.length,()=>props.disabled],()=>{
  if(!props.drafts.some(d=>d.key===activeKey.value))activeKey.value=props.drafts[0]?.key??'';
  if(props.drafts.length&&!props.disabled&&!autoOpened){autoOpened=true;void open();}
},{immediate:true,flush:'post'});
onBeforeUnmount(()=>{disposed=true;close(false);});
function cancel(){if(props.disabled)return;close();emit('cancel');}
function commit(){if(props.disabled||!count.value||validation.value.error)return;close();emit('commit',validation.value.rows);}
async function showRule(){ruleTargets.value=otherSheets.value.map(d=>d.key);ruleOpen.value=true;await nextTick();rulePanel.value?.focus({preventScroll:true});rulePanel.value?.scrollIntoView?.({block:'nearest'});}
function hideRule(){ruleOpen.value=false;void nextTick(()=>ruleTrigger.value?.focus({preventScroll:true}));}
function applyRule(){
  if(props.disabled||!applicable.value.length)return;
  let applied=0,skipped=0;
  for(const m of mappings.value.filter(m=>ruleTargets.value.includes(m.target.key))){
    if(m.error){issues.value[m.target.key]=m.error;skipped++;continue;}
    m.target.xColumn=m.xColumn;m.target.yColumns=[...m.yColumns];delete issues.value[m.target.key];applied++;
  }
  message.value=`已应用到 ${applied} 个工作表${skipped?`；${skipped} 个未匹配，原选择已保留`:''}。`;hideRule();
}
</script>
<template>
  <section class="batch-selection selection-launcher" aria-label="待纳入谱线选择" data-test="batch-selection">
    <div><strong>待纳入：{{files.length}} 个文件</strong><p class="hint">已选 {{selectedFileCount}} 个文件 · {{count}} 条谱线。确认列选择后才加入当前批次。</p></div>
    <button ref="trigger" type="button" class="primary" :disabled="disabled" :aria-expanded="opened" aria-haspopup="dialog" @click="open">选择 X / Y 数据</button>
    <dialog ref="dialog" class="parameter-dialog batch-column-dialog" aria-label="选择 X / Y 数据" @cancel.prevent="close()" @close="opened=false">
      <header class="parameter-dialog-header"><div><h2>导入数据与列映射</h2><p class="hint">{{files.length}} 个文件 · {{drafts.length}} 个可选工作表 · 每个 Y 列生成一条谱线</p></div><div class="column-progress" role="status" data-test="batch-mapping-progress"><strong>已配置 {{completedFiles}} / {{files.length}} 个文件</strong><progress :value="completedFiles" :max="files.length" aria-label="文件映射完成度" /><small>{{completedFiles===files.length?'所选列已配置，请核对后纳入':`还有 ${files.length-completedFiles} 个文件未配置有效 Y，可按需纳入部分文件`}}</small></div></header>
      <div class="column-global-actions" role="group" aria-label="全部文件 Y 选择">
        <div class="column-actions"><strong>全部文件</strong><button type="button" data-test="batch-select-all" :disabled="disabled" @click="select(drafts,true)">选择全部候选 Y</button><button type="button" data-test="batch-clear-all" :disabled="disabled||!count" @click="select(drafts,false)">清空全部 Y</button></div>
        <p class="hint">作用于全部 {{files.length}} 个文件（含搜索隐藏项），请核对误差、温度等列。</p>
      </div>
      <fieldset class="column-picker-body" :disabled="disabled"><legend class="sr-only">暂存文件与列选择</legend>
        <aside class="column-file-panel" aria-label="导入文件列表">
          <label>搜索文件<input v-model="fileSearch" type="search" placeholder="输入文件名" /></label>
          <div class="column-file-list">
            <button v-for="file in visibleFiles" :key="file.dataset_id" type="button" :data-file-name="file.filename" :aria-pressed="active?.dataset.dataset_id===file.dataset_id" @click="chooseFile(file.dataset_id)">
              <span class="sr-only">配置文件 </span><strong :title="file.filename">{{file.filename}}</strong><span>{{sheets(file.dataset_id).length}} 个工作表 · {{fileCount(file.dataset_id)}} 个 Y 已选</span>
              <small :class="{'column-issue':fileIssue(file.dataset_id)}">{{fileIssue(file.dataset_id)?'! 需处理':fileCount(file.dataset_id)?'✓ 已选择':'待选择'}}</small>
            </button>
            <p v-if="!visibleFiles.length" class="hint">没有匹配的文件。<button type="button" @click="fileSearch=''">清除搜索</button></p>
          </div>
        </aside>
        <section v-if="active" class="column-editor" aria-label="当前工作表列配置">
          <div class="column-editor-heading"><div><h3>{{active.dataset.filename}}</h3><p class="hint">{{sheet(active).row_count}} 行 · 已选 {{active.yColumns.length}} 个 Y</p></div><label>工作表<select v-model="activeKey" aria-label="配置工作表"><option v-for="d in sheets(active.dataset.dataset_id)" :key="d.key" :value="d.key">{{d.sheet}} · {{d.yColumns.length}} 个 Y</option></select></label></div>
          <p class="hint">X 单选，Y 可多选。请核对各列含义；误差列不会自动用于加权。</p>
          <div class="column-x-selection"><label>X 列<select :value="active.xColumn" :aria-label="`${active.dataset.filename} / ${active.sheet} X 列`" @change="setX(active,($event.target as HTMLSelectElement).value)"><option v-for="name in sheet(active).numeric_columns" :key="name" :value="name">{{name}}</option></select></label><p class="hint">已选 X 列不会作为 Y 纳入。</p></div>
          <div class="column-tools"><label class="column-search">搜索列<input v-model="columnSearch" type="search" placeholder="输入列名" /></label><button type="button" :aria-pressed="fullNames" @click="fullNames=!fullNames">{{fullNames?'收起完整列名':'展开完整列名'}}</button></div>
          <div class="column-role-scroll" tabindex="0" role="region" aria-label="X Y 列角色表">
            <table class="column-role-table"><colgroup><col class="role-name" /><col class="role-sample" /><col class="role-choice" /></colgroup><thead><tr><th scope="col">列名</th><th scope="col">前 3 行示例</th><th scope="col">作为 Y</th></tr></thead><tbody>
              <tr v-for="c in columns" :key="c.name" :class="{'is-x':active.xColumn===c.name,'is-y':active.yColumns.includes(c.name)}">
                <th scope="row"><span class="column-name" :title="c.name" :class="{'is-expanded':fullNames}">{{c.name}}</span><small>第 {{c.index}} 列{{c.numeric?' · 数值列':' · 非数值列，不可选'}}</small></th><td><span class="column-sample">{{c.sample}}</span></td>
                <td><label class="role-control"><input v-model="active.yColumns" type="checkbox" :value="c.name" :disabled="!c.numeric||active.xColumn===c.name" :aria-label="`${active.dataset.filename} / ${active.sheet} 纳入 ${c.name}`" @change="edited(active)" /></label></td>
              </tr>
              <tr v-if="!columns.length"><td colspan="3">没有匹配的列。<button type="button" @click="columnSearch=''">清除搜索</button></td></tr>
            </tbody></table>
          </div>
          <div class="column-actions"><button type="button" @click="select([active],true)">选择本表其余数值列</button><button type="button" :disabled="!active.yColumns.length" @click="select([active],false)">清空本表 Y</button><button ref="ruleTrigger" type="button" :disabled="!active.yColumns.length||!otherSheets.length" @click="showRule">应用列规则到其他文件…</button></div>
          <p v-if="issues[active.key]" class="warning" role="status">规则未应用：{{issues[active.key]}}。原选择已保留，请手动核对。</p>
          <p v-if="message" class="column-message" role="status">{{message}}</p>
          <section v-if="ruleOpen" ref="rulePanel" tabindex="-1" class="column-rule" aria-label="批量列规则预览">
            <div class="column-editor-heading"><h3>应用前核对</h3><button type="button" @click="hideRule">收起预览</button></div>
            <label>匹配方式<select v-model="ruleMode" aria-label="列规则匹配方式"><option value="name">按列名匹配</option><option value="position">按原始列位置匹配</option></select></label>
            <p class="hint">以当前工作表为准，替换勾选工作表的 X / Y 选择；无法匹配的保持原样。按位置时包含文本列，请核对列顺序。</p>
            <div class="column-rule-targets"><label v-for="m in mappings" :key="m.target.key" class="column-rule-target"><input v-model="ruleTargets" type="checkbox" :value="m.target.key" :aria-label="`应用规则到 ${m.target.dataset.filename} / ${m.target.sheet}`" /><span><strong>{{m.target.dataset.filename}} / {{m.target.sheet}}</strong><small :class="{'column-issue':m.error}">{{m.error?`无法匹配：${m.error}`:`X：${m.xColumn} → Y：${m.yColumns.join('、')}`}}</small></span></label></div>
            <button type="button" class="primary" :disabled="!applicable.length" @click="applyRule">应用到 {{applicable.length}} 个匹配工作表</button>
          </section>
          <details :key="active.key" class="column-preview"><summary>映射预览 · 前 5 行原始数据</summary><DataSelectionPreview :sheet="sheet(active)" :x-column="active.xColumn" :y-column="active.yColumns[0]??''" /><button type="button" @click="browser?.open(active.dataset,$event)">查看全部数据</button></details>
        </section>
      </fieldset>
      <footer class="column-picker-footer">
        <p v-if="duplicates.length" role="status" class="warning">{{duplicates.length}} 条选择重复，仍可纳入；重复导入不代表独立重复实验。</p>
        <p v-if="validation.error" role="alert" class="error">{{validation.error}}</p>
        <div class="column-footer-row"><div role="status"><strong>已选 {{selectedFileCount}} 个文件 · 将新增 {{validation.rows.length}} 条有效谱线</strong><small>当前批次 {{existing.length}} 条 / 上限 100 条 · {{count?'Esc 暂存选择':'请至少选择一个有效 Y 列'}}</small></div><div class="column-actions"><button type="button" aria-label="暂存并关闭列选择" @click="close()">暂存并关闭</button><button type="button" :disabled="disabled" @click="cancel">取消本次导入</button><button type="button" class="primary" data-test="batch-commit-selection" :title="validation.error||(!count?'请至少选择一个有效 Y 列':undefined)" :disabled="disabled||!count||Boolean(validation.error)" @click="commit">纳入所选谱线（{{validation.rows.length}}）</button></div></div>
      </footer>
    </dialog>
    <DatasetBrowserDialog ref="browser" />
  </section>
</template>
<style scoped src="../styles/batchImport.css"></style>
