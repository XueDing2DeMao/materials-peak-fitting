# 峰参数解析 P0 软件验证样例

本目录全部为合成算术样例，不是实验测量结果，也不是任何拟合软件的专用导出模板。实际厂商及 FTIR 标样的验证仍需使用真实文件。

| 文件 | 目的 |
| --- | --- |
| `xrd-single.csv` / `xrd-single.xlsx` | 单行宽表，两个格式的峰位、FWHM、峰高、全域面积和标准误一致 |
| `ftir-long.csv` | 单峰长表；参数误差与谱级 RMSE 分开；区间面积用于合成标样校准 |
| `mixed-quality.csv` | 好行和坏行并存；非法峰位、负峰宽和缺面积可定位，不阻断好行 |
| `reproduce.py` | 只读上述文件，核对解析、公式依赖、六类计算及坏行隔离 |

在项目根目录运行：

```powershell
.\.venv\Scripts\python.exe examples/acceptance/peak_analysis/reproduce.py
```

算术基准：立方晶格常数 `a=0.26683974741406125 nm`；Gaussian 校正的 Scherrer 尺寸 `D=52.96192675071276 nm`；相对晶面应变 `2000 με`；Lorentz 型 WH `D=50 nm`、`epsilon_WH=0.001`；合成 FTIR 校准含量 `3 mg/mL`。基准误差容限只用于浮点算术核对，不代表材料测量精度或任务书规定的阈值。

页面入口、映射步骤和科学适用条件见 [使用手册](../../../docs/USER_GUIDE.md#拟合结果解析与材料参数计算)。XRD 案例使用 2θ、deg、FWHM、全域面积；FTIR 案例使用峰顶位置、cm^-1、FWHM、指定区间面积。原值、字段定义和来源应随独立解析档案保留。
