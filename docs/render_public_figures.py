"""从复算 JSON 生成手册插图；使用独立的 matplotlib 环境即可。"""
import argparse
import json
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs/images"
RESULTS = ROOT / "examples/public/results"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--qa-helper", type=Path, help="nature-figure 的 scripts 目录；提供时执行面板对齐检查")
    args = parser.parse_args()
    if args.qa_helper:
        sys.path.insert(0, str(args.qa_helper))
        from audit_panel_alignment import require_matplotlib_panel_alignment
    plt.rcParams.update({"font.family": "sans-serif", "font.sans-serif": ["Microsoft YaHei", "SimHei", "DejaVu Sans"],
                         "font.size": 10, "axes.spines.top": False, "axes.spines.right": False,
                         "pdf.fonttype": 42, "svg.fonttype": "none", "axes.unicode_minus": False,
                         "legend.frameon": False})
    for name, title, subtitle, xlabel in [
        ("raman", "公开 Raman｜检查局部峰形与残差", "Bare Ge / Pristine #1 · PsdVoigt1 · 52 个点", r"波数 / cm$^{-1}$"),
        ("xrd", "公开 XRD｜单峰区间与采样分辨率", "BareGe / Pristine Ge · PsdVoigt1 · 31 个点", "2θ / °"),
        ("xps", "公开 XPS｜收敛后仍需检查残差", "Ge2p / Pristine Ge #1 · 四个探索分量 · 521 个点", "结合能 / eV"),
    ]:
        payload = json.loads((RESULTS / f"{name}-result.json").read_text(encoding="utf-8"))
        r = payload if name == "xps" else payload["result"]
        fig, (ax, residual) = plt.subplots(2, 1, figsize=(7.2, 5.4), sharex=True,
                                         gridspec_kw={"height_ratios": [3, 1], "hspace": .15})
        fig.subplots_adjust(left=.14, right=.97, bottom=.12, top=.78)
        fig.suptitle(title, x=.14, y=.98, ha="left", fontsize=14, fontweight="bold")
        fig.text(.14, .92, subtitle, fontsize=10, color="#4c5965")
        x = r["x"]
        ax.plot(x, r["raw_y"], "o", color="#677985", markersize=3, alpha=.75, label="原始观测", zorder=3)
        ax.plot(x, r["total_y"], color="#087f8c", linewidth=1.8, label="总拟合", zorder=4)
        ax.plot(x, r["baseline"], color="#b97936", linestyle="--", linewidth=1.4, label="固定背景")
        if name == "xps":
            colors = ["#668db4", "#668db4", "#ad86ac", "#ad86ac"]
            for c, color in zip(r["components"], colors):
                ax.plot(x, c["y"], color=color, linewidth=1, alpha=.8)
            residuals = r["residuals"]
            ax.invert_xaxis()
        else:
            residuals = r["residual"]
        ax.set_ylabel("强度 / 原始单位")
        ax.ticklabel_format(axis="y", style="sci", scilimits=(0, 0), useMathText=False)
        ax.legend(loc="lower left", bbox_to_anchor=(0, 1.02), ncol=3, borderaxespad=0, fontsize=9)
        residual.axhline(0, color="#75838d", linewidth=.8, linestyle="--")
        residual.plot(x, residuals, color="#a65262", marker=".", markersize=3, linewidth=.85)
        residual.set_ylabel("残差")
        residual.set_xlabel(xlabel)
        residual.ticklabel_format(axis="y", style="sci", scilimits=(0, 0), useMathText=False)
        for a in (ax, residual):
            a.grid(axis="y", color="#e4e9ec", linewidth=.6)
            a.margins(x=.025)
        fig.canvas.draw()
        if args.qa_helper:
            qa = ROOT / ".logs/figure-qa"
            qa.mkdir(parents=True, exist_ok=True)
            require_matplotlib_panel_alignment(fig, json_out=qa / f"{name}.alignment.json", strict=True)
        fig.savefig(OUT / f"{name}-public-fit.png", dpi=300, facecolor="white")
        fig.savefig(OUT / f"{name}-public-fit.pdf", facecolor="white")
        fig.savefig(OUT / f"{name}-public-fit.svg", facecolor="white")
        # 清除 SVG 路径行尾空格，不改变坐标、标签或视觉内容。
        svg = OUT / f"{name}-public-fit.svg"
        svg.write_text("\n".join(line.rstrip() for line in svg.read_text(encoding="utf-8").splitlines()) + "\n", encoding="utf-8")
        plt.close(fig)
        print(name, "exported")


if __name__ == "__main__":
    main()
