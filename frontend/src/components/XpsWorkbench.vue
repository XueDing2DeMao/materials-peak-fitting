<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { candidatesXps, exportXps, fitXps, previewXps } from "../xpsApi";
import { createConfig, loadConfiguration, RevisionGate, validateConstraints, requiredConfigVersion, shiftConfiguration } from "../xpsState";
import type { Candidate, XpsPreview, XpsResult, XpsSource } from "../xpsTypes";
import XpsFitControls from "./XpsFitControls.vue";
import XpsChart from "./XpsChart.vue";
import XpsResults from "./XpsResults.vue";
const props=defineProps<{x:number[];y:number[];source:XpsSource|null}>();
const config=ref(createConfig(props.x,props.y,props.source)),preview=ref<XpsPreview|null>(null),result=ref<XpsResult|null>(null),candidates=ref<Candidate[]>([]);
const busy=ref(false),error=ref(""),stale=ref(false),notice=ref("");
const chart=ref<{downloadImage:()=>void}|null>(null),fileInput=ref<HTMLInputElement|null>(null);
const gate=new RevisionGate();
const previewKey=computed(()=>JSON.stringify([config.value.x,config.value.y,config.value.shift_eV,config.value.range_start,config.value.range_end,{...config.value.background,confirmed:false}]));
watch(config,()=>{gate.invalidate();if(result.value)stale.value=true;},{deep:true,flush:"sync"});
watch(previewKey,()=>{preview.value=null;candidates.value=[];config.value.background.confirmed=false;},{flush:"sync"});
watch(()=>[props.x,props.y,props.source],()=>{config.value=createConfig(props.x,props.y,props.source);preview.value=null;result.value=null;candidates.value=[];stale.value=false;error.value="";notice.value="";},{flush:"sync"});
const snapshot=()=>({...JSON.parse(JSON.stringify(config.value)),schema_version:requiredConfigVersion(config.value)});
async function action(kind:"preview"|"fit"|"candidates"){
  if(busy.value)return;
  error.value="";notice.value="";const token=gate.start(kind),request=snapshot();busy.value=true;
  try{
    if(kind==="fit"){
      validateConstraints(request);
      const data=await fitXps(request);if(gate.current(token)){result.value=data;preview.value=data;stale.value=false;}
    }else if(kind==="preview"){
      const data=await previewXps(request);if(gate.current(token)){preview.value=data;notice.value=`背景已计算：${data.background.kind}，${data.background.iterations} 次迭代。`;}
    }else{
      const data=await candidatesXps(request);if(gate.current(token)){candidates.value=data.candidates;notice.value=data.note+(data.candidates.length?"":"；未检测到候选峰");}
    }
    if(!gate.current(token))notice.value="计算期间设置已变化，已丢弃过期响应。";
  }catch(e){if(gate.current(token))error.value=e instanceof Error?e.message:String(e);}finally{busy.value=false;}
}
function range(value:{start:number;end:number}){config.value.range_start=value.start;config.value.range_end=value.end;}
function calibrate(value:number){
  if(!Number.isFinite(value)){error.value="能量偏移必须是有限数值";return;}
  shiftConfiguration(config.value,value-config.value.shift_eV);
}
async function download(kind:"curves"|"parameters"|"configuration"){
  if(!result.value||stale.value||busy.value)return;
  const token=gate.start("export");busy.value=true;error.value="";
  try{const blob=await exportXps(kind,snapshot());if(!gate.current(token)){notice.value="设置已变化，已取消过期导出。";return;}
    const link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download=`xps-${kind}.${kind==="configuration"?"json":"csv"}`;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);
  }catch(e){if(gate.current(token))error.value=e instanceof Error?e.message:String(e);}finally{busy.value=false;}
}
async function load(event:Event){
  const input=event.target as HTMLInputElement,file=input.files?.[0];if(!file)return;
  const token=gate.start("load");busy.value=true;error.value="";
  try{const loaded=loadConfiguration(JSON.parse(await file.text()),props.x,props.y,props.source);validateConstraints(loaded);
    // 后端验证完整 schema 与背景，UI 不信任文件内的旧结果。
    const background=await previewXps(loaded);if(gate.current(token)){config.value=loaded;preview.value=background;config.value.background.confirmed=false;result.value=null;stale.value=false;notice.value="配置已载入并核对原数据，请复核背景并重新拟合。";}
  }catch(e){if(gate.current(token))error.value=e instanceof Error?e.message:String(e);}finally{busy.value=false;input.value="";}
}
</script>
<template><section class="xps-workbench">
  <div class="xps-toolbar"><span>多峰 XPS · {{source?`${source.sheet} / ${source.y_column}`:'请先导入并选择谱列'}}</span><button :disabled="busy||!source||!x.length" @click="fileInput?.click()">加载配置 JSON</button><input ref="fileInput" type="file" accept=".json,application/json" hidden @change="load" /></div>
  <p v-if="error" class="error xps-message" role="alert">{{error}}</p><p v-if="notice" class="hint xps-message" role="status">{{notice}}</p>
  <div class="xps-grid"><aside class="xps-control-column"><XpsFitControls :config="config" :previewed="Boolean(preview)" :background-preview="preview" :busy="busy" :candidates="candidates" @preview="action('preview')" @fit="action('fit')" @candidates="action('candidates')" @error="error=$event" @calibrate="calibrate" /></aside>
    <XpsChart ref="chart" :x="x" :y="y" :shift="config.shift_eV" :start="Number(config.range_start)" :end="Number(config.range_end)" :preview="preview" :result="stale?null:result" @range="range" />
    <aside class="xps-result-column"><XpsResults :result="result" :stale="stale" :busy="busy" @export="download" @image="chart?.downloadImage()" /></aside></div>
</section></template>
