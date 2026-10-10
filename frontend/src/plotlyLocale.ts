/** Plotly modebar text shipped with the local app; no CDN locale script is required. */
export const PLOTLY_CHINESE_CONFIG = {
  responsive: true,
  displaylogo: false,
  displayModeBar: true,
  scrollZoom: true,
  locale: "zh-CN",
  locales: {
    "zh-CN": {
      dictionary: {
        "Download plot as a png": "下载图表为 PNG",
        "Download plot as svg": "下载图表为 SVG",
        "Download plot as jpeg": "下载图表为 JPEG",
        "Download plot as webp": "下载图表为 WebP",
        Zoom: "缩放",
        Pan: "平移",
        "Box Select": "矩形选择",
        "Lasso Select": "套索选择",
        "Zoom in": "放大",
        "Zoom out": "缩小",
        Autoscale: "自动缩放",
        "Reset axes": "重置坐标轴",
        "Reset scale": "重置缩放",
        "Show closest data on hover": "悬停显示最近数据",
        "Compare data on hover": "悬停比较数据",
        "Toggle Spike Lines": "切换参考线",
      },
    },
  },
} as const;
