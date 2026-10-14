/** 下载实际结果快照；不在导出时再次求解。 */
export function csv(rows:unknown[][]):string {
  return '\ufeff'+rows.map(row=>row.map(value=>{
    let s=value==null?'':String(value);
    if(typeof value==='string'&&/^[\s]*[=+@-]/.test(s))s="'"+s;
    return '"'+s.replaceAll('"','""')+'"';
  }).join(',')).join('\r\n');
}
export function saveFile(name:string,content:string,type='text/csv;charset=utf-8'){
  const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
