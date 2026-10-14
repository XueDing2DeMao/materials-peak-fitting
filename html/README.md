# 材料谱线拟合工作台 · 前端设计副本

此文件夹提取自项目当前前端，供其他编辑器或设计软件继续调整界面。技术栈为 Vue 3、TypeScript、Vite 和 Plotly；不包含 Python 后端、原始实验文件、依赖缓存或运行日志。

如使用 Google Stitch，请优先使用 [stitch 导入材料包](stitch/README.md)：其中包含 PNG 界面参考、`DESIGN.md` 及可直接粘贴的提示词。`stitch-import.zip` 是该材料包的便携副本，解压后按说明选择文件。

## 选择导入方式

- 支持 Vue 工程的软件：打开整个 `html` 文件夹，编辑 `src` 内的组件和样式。
- 支持静态网站的软件：导入 `preview` 文件夹，其中包含编译后的 HTML、CSS 和 JavaScript。该目录适合展示参考；持续设计和维护请优先修改 `src`。
- 仅支持单个 HTML 文件的软件：本工程不是单文件网页，不能仅导入 `index.html` 就获得完整界面；需要支持关联资源或 Vue 工程。

## 主要文件

| 路径 | 内容 |
| --- | --- |
| `src/App.vue` | 主界面、分析模式及区域布局 |
| `src/components/` | 数据导入弹窗、峰参数、图表、结果表、批次等组件 |
| `src/styles/tokens.css` | 颜色、间距等设计变量 |
| `src/styles/workstation.css` | 工作台布局、控件与响应式样式 |
| `src/style.css` | 基础样式 |
| `src/api.ts`、`src/multipeakApi.ts`、`src/xpsApi.ts` | 前端接口调用，供后续联调使用 |
| `index.html` | Vue 源码入口，需通过开发服务器打开 |
| `preview/index.html` | 已编译静态入口，使用相对资源路径 |

## 编辑并预览源码

在此文件夹中运行：

```sh
npm ci
npm run dev
```

开发地址默认是 `http://localhost:5175`。如端口已被其他项目占用，可运行 `npm run dev -- --port 5185`。

生成新的静态构建：

```sh
npm run build -- --base ./
```

新构建输出到 `dist`。随包提供的 `preview` 是提取时的构建快照，不会随源码编辑自动更新。静态预览请通过设计软件的本地 HTTP 预览服务打开 `preview/index.html`，不要直接双击打开：浏览器可能限制 `file://` 下的模块加载。

## 功能边界

页面和样式可独立编辑；上传文件、完整数据分页、背景计算和拟合等仍需要后端 API。本副本未加入模拟后端，也未更改原有计算行为。开发模式 API 地址为 `http://127.0.0.1:5176`，生产构建请求同源 `/api`。

此目录是独立副本，对它的修改不会自动同步回原项目的 `frontend`。已保留前端测试与依赖锁文件，便于设计完成后继续开发与验证。
