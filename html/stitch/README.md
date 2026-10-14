# Stitch 导入材料包

本包使用 PNG 截图、DESIGN.md 和文字提示词，适合作为 Google Stitch 的设计输入。图片是本项目此前实际验证的界面截图，未重新绘制。它们是用于生成/调整设计的参考，不是可无损导入的 Vue 组件，也不包含后端。

## 使用方法

1. 打开 https://stitch.withgoogle.com/ ，进入设计项目。
2. 在支持图片输入的画布或输入区上传 `screens` 中需要的 PNG。建议先上传 `01-workspace-desktop.png`、`02-import-dialog-desktop.png`、`03-peak-results-desktop.png`，其余图片在扩展批次和移动端时添加。
3. 使用 Stitch 的设计规则导入能力载入 `DESIGN.md`。若当前界面未显示该入口，可将其文字作为设计上下文粘贴到对话中。
4. 复制 `PROMPT.txt` 的全部内容并发送，开始设计。

`stitch-import.zip` 仅供搬运，使用前解压并选择里面的 PNG / DESIGN.md；未确认 Stitch 支持直接上传整个 ZIP 或 Vue 工程。无需上传上级目录的 node_modules、源码工程或编译 JS。

## 截图清单

| 文件 | 作用 |
| --- | --- |
| `screens/01-workspace-desktop.png` | 工作台顶部与整体布局 |
| `screens/02-import-dialog-desktop.png` | 最新完整数据导入弹窗 |
| `screens/03-peak-results-desktop.png` | 最新紧凑结果表，点击峰名查看详情 |
| `screens/04-batch-review-desktop.png` | 批次列表、复核状态与当前谱 |
| `screens/05-workspace-mobile.png` | 移动端工作台布局 |
| `screens/06-import-dialog-mobile.png` | 最新移动端导入弹窗 |

截图记录不同的页面区域与操作状态，并非每个页面的完整长截图。02、03、06 是最新交互参考；其他截图中的旧数据入口以 DESIGN.md 的要求为准。截图里的示例数值用于视觉参考，不用于科学推断。

## 格式依据与验证范围

核实日期：2026-10-13。

- [Google 官方：从图片或线框生成 UI](https://developers.googleblog.com/en/stitch-a-new-way-to-design-uis/)
- [Google 官方：画布上下文与 DESIGN.md 导入/导出](https://blog.google/innovation-and-ai/models-and-research/google-labs/stitch-ai-ui-design/)

已依据官方支持方式准备本地材料，并校验 PNG 与压缩包完整性。未登录你的 Stitch 账号、未上传文件，也未验证账号内具体入口；实际生成的编辑粒度与效果取决于 Stitch。
