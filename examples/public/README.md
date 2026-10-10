# 公开实谱教程与复现

这里保存手册使用的三份公开原始工作簿、一个 XPS 教学配置和本项目重新计算的结果。合成入门数据仍保留在上一级目录。

## 来源、署名和许可

**数据作者：** Dmytro Gnatyuk、Sara Hamed、Masoud Ebrahimzadeh、Hanchen Liu、Ville Vähänissi、Pekka Laukkanen、Hele Savin、Xiaolong Liu。

**数据集：** *Dataset for Challenges in Simultaneous Microstructuring and Hyperdoping of Germanium with Ultrafast Laser*（2026-03-03）。Zenodo，DOI：[10.5281/zenodo.18845748](https://doi.org/10.5281/zenodo.18845748)。[数据记录](https://zenodo.org/records/18845748)；关联出版物：[10.1002/pssa.202500987](https://doi.org/10.1002/pssa.202500987)。

**许可：** [Creative Commons Attribution 4.0 International（CC BY 4.0）](https://creativecommons.org/licenses/by/4.0/)。以上数据许可适用于此处转载的公开数据，不代表整个软件仓库已采用同一许可证。使用数据时应保留原作者、数据集及关联出版物署名。

三份 XLSX 未改变单元格、工作表、顺序、格式或文件字节；2026-10-10 与 Zenodo API 提供的 MD5 逐一核对一致。校验信息及 SHA-256 见 [source.json](zenodo_18845748/source.json)，作者原说明见 [ORIGINAL_README.md](zenodo_18845748/ORIGINAL_README.md)（保留原文内容，改用此文件名；Git 将文本换行统一为 LF）。原数据包含原始谱和处理结果，教程明确选取下表中的原谱工作表。

| 文件 | 工作表 | X 列 | Y 列 | 教学区间 |
| --- | --- | --- | --- | --- |
| [Raman.xlsx](zenodo_18845748/Raman.xlsx) | `Bare Ge` | `Wavenumber` | `Pristine #1` | 280～320 cm⁻¹ |
| [XRD.xlsx](zenodo_18845748/XRD.xlsx) | `BareGe` | `2Theta` | `Pristine Ge` | 65.8～66.6° |
| [XPS.xlsx](zenodo_18845748/XPS.xlsx) | `Ge2p` | `Binding Energy (E)` | `Pristine Ge #1` | 1208～1260 eV |

Raman 的 `Figure2bc` 是统计汇总表，不可作为原谱导入。XRD 工作表实际名称为 `BareGe`（无空格），与 Raman 的 `Bare Ge` 不同。

## 处理说明

每种测量只选一条谱用于操作示范，不合并重复测量，也不作跨样品推断。读取器将 X/Y 数值化、丢弃无效配对行并排序；所选完整有效点数分别为 Raman 1600、XRD 2670、XPS 521。局部拟合分别使用 52、31、521 点；区间内不抽样、不平滑、不归一化。插图实线连接原采样位置上的模型值，不增加新的观测点。

`results/` 内的拟合、截图和图表由本项目生成，不是原作者提供的拟合结论。XPS 配置沿用本项目先前的探索性峰组，用于演示约束和配置恢复；其 31.1 eV 峰位偏移、0.5 面积比和同宽约束是教学配置，不是可通用于其他谱的默认值。该例有贴边参数和明显结构化残差，不能作为可靠化学态定量案例。

## 复算

先按根 README 安装后端依赖，然后在项目根目录执行：

```powershell
.\.venv\Scripts\python.exe examples/public/reproduce.py
```

脚本先核对原文件 SHA-256，再生成 `results/` 下的 JSON、曲线 CSV、参数 CSV 和 `summary.json`。重复执行会覆盖这些派生结果，不改动原始工作簿。配置文件 [xps-ge2p-configuration.json](xps-ge2p-configuration.json) 可在选中原 XPS 谱后从界面加载；仍须预览并复核 Shirley 背景。

绘图是可选文档工具，不是软件运行依赖。在装有 matplotlib 的 Python 环境执行：

```powershell
python docs/render_public_figures.py
```

输出位于 `docs/images/`，包括 PNG、PDF 和 SVG。安装 Microsoft YaHei 或兼容中文字体后可正常显示中文。图源是本次复算 JSON；截图通过应用真实操作获取，不是绘制的界面模拟图。
