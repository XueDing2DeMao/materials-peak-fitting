import { computed, onBeforeUnmount, onDeactivated, ref, watch, type Ref } from 'vue';
import type { Anchor } from './types';

type Axis={_offset:number;_length:number;range:[number,number]};
type Geometry={x:Axis;y:Axis;left:number;top:number};
export function useAnchorEditing(options:{
  chart:Ref<HTMLElement|null>;anchors:()=>Anchor[];enabled:()=>boolean;
  start:()=>number;end:()=>number;data:()=>number[];
  move:(index:number,point:Anchor)=>void;edit:(index:number)=>void;
}){
  const geometry=ref<Geometry|null>(null),preview=ref<{index:number;point:Anchor}|null>(null);
  let drag:{index:number;pointerId:number;x:number;y:number;point:Anchor;geometry:Geometry;moved:boolean}|null=null;
  function sync(){
    const node=options.chart.value as (HTMLElement&{_fullLayout?:{xaxis:Axis;yaxis:Axis}})|null;
    const x=node?._fullLayout?.xaxis,y=node?._fullLayout?.yaxis;
    if(!node||!x||!y||![x,y].every(a=>a._length>0&&Number.isFinite(a._offset)&&a.range?.length===2&&a.range.every(Number.isFinite)&&a.range[0]!==a.range[1])){geometry.value=null;return;}
    const copy=(a:Axis):Axis=>({_offset:a._offset,_length:a._length,range:[...a.range]});
    geometry.value={x:copy(x),y:copy(y),left:node.offsetLeft,top:node.offsetTop};
  }
  const handles=computed(()=>{
    const g=geometry.value;if(!options.enabled()||!g)return [];
    return options.anchors().flatMap((original,index)=>{
      const p=preview.value?.index===index?preview.value.point:original;
      const x=(p.x-g.x.range[0])/(g.x.range[1]-g.x.range[0]),y=(p.y-g.y.range[0])/(g.y.range[1]-g.y.range[0]);
      if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||x>1||y<0||y>1||p.x<options.start()||p.x>options.end())return [];
      return [{index,left:g.left+g.x._offset+x*g.x._length,top:g.top+g.y._offset+(1-y)*g.y._length}];
    });
  });
  function cleanup(){window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',finish);window.removeEventListener('pointercancel',cancel);window.removeEventListener('keydown',escape);}
  function cancel(){cleanup();drag=null;preview.value=null;}
  function escape(e:KeyboardEvent){if(e.key==='Escape')cancel();}
  function move(e:PointerEvent){
    if(!drag||e.pointerId!==drag.pointerId)return;
    if(!options.enabled()){cancel();return;}
    e.preventDefault();
    if(!drag.moved&&Math.hypot(e.clientX-drag.x,e.clientY-drag.y)<5)return;
    drag.moved=true;
    const g=drag.geometry;
    // 用按下时的坐标轴和锚点计算位移，避免重绘时跳动；限制在当前可见绘图区与分析区间。
    const minX=Math.max(options.start(),Math.min(...g.x.range)),maxX=Math.min(options.end(),Math.max(...g.x.range));
    const x=Math.max(minX,Math.min(maxX,drag.point.x+(e.clientX-drag.x)/g.x._length*(g.x.range[1]-g.x.range[0])));
    const y=Math.max(Math.min(...g.y.range),Math.min(Math.max(...g.y.range),drag.point.y-(e.clientY-drag.y)/g.y._length*(g.y.range[1]-g.y.range[0])));
    preview.value={index:drag.index,point:{x,y}};
  }
  function finish(e:PointerEvent){
    if(!drag||e.pointerId!==drag.pointerId)return;
    move(e);const current=drag,point=preview.value?.point;cancel();
    if(!current||!options.enabled())return;
    if(current.moved&&point){if(point.x!==current.point.x||point.y!==current.point.y)options.move(current.index,point);}
    else options.edit(current.index);
  }
  function begin(index:number,e:PointerEvent){
    if(e.button!==0||!options.enabled()||!options.anchors()[index])return;
    cancel();sync();if(!geometry.value)return;
    e.preventDefault();e.stopPropagation();
    drag={index,pointerId:e.pointerId,x:e.clientX,y:e.clientY,point:{...options.anchors()[index]},geometry:geometry.value,moved:false};
    window.addEventListener('pointermove',move,{passive:false});window.addEventListener('pointerup',finish);window.addEventListener('pointercancel',cancel);window.addEventListener('keydown',escape);
  }
  watch(()=>[options.anchors(),options.enabled(),options.start(),options.end(),options.data()],cancel,{deep:true,flush:'sync'});
  onDeactivated(cancel);onBeforeUnmount(cancel);
  return {handles,preview,sync,begin,cancel};
}
