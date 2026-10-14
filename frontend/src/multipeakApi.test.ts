import { afterEach, expect, it, vi } from 'vitest';
import { previewMulti } from './multipeakApi';
import { createMultiConfig } from './multipeakState';

afterEach(()=>vi.unstubAllGlobals());

it.each([404,405])('旧后端缺少多峰接口时说明如何恢复（HTTP %s）',async status=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({detail:'Method Not Allowed'}),{status})));
  await expect(previewMulti(createMultiConfig([0,1,2,3],[0,1,1,0],null,'general'))).rejects.toThrow('重启');
});

it('保留后端返回的参数校验错误',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({detail:'基线锚点不足'}),{status:422})));
  await expect(previewMulti(createMultiConfig([0,1,2,3],[0,1,1,0],null,'general'))).rejects.toThrow('基线锚点不足');
});
