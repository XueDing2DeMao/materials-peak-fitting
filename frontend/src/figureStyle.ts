// 将科研制图的层次、留白和语义配色用于交互图；屏幕字号不等同于印刷字号。
export const FIGURE_FONT = 'Arial, Helvetica, Microsoft YaHei, sans-serif';
export const FIGURE_COLORS = {
  ink: '#222222', observation: '#666666', fit: '#0072B2',
  background: '#777777', residual: '#555555', reference: '#999999',
};

export function figureAxis(title: string) {
  return {
    title: { text: title, font: { family: FIGURE_FONT, size: 13, color: FIGURE_COLORS.ink }, standoff: 10 },
    tickfont: { family: FIGURE_FONT, size: 12, color: FIGURE_COLORS.ink },
    showline: true, linecolor: FIGURE_COLORS.ink, linewidth: 1,
    mirror: false, ticks: 'outside', ticklen: 4, tickwidth: 1,
    tickcolor: FIGURE_COLORS.ink, showgrid: false, zeroline: false,
    nticks: 5, exponentformat: 'power', showexponent: 'all', automargin: false,
  };
}

export function figureLayout() {
  return {
    font: { family: FIGURE_FONT, size: 12, color: FIGURE_COLORS.ink },
    paper_bgcolor: '#ffffff', plot_bgcolor: '#ffffff',
    hoverlabel: { bgcolor: '#ffffff', bordercolor: '#cccccc', font: { family: FIGURE_FONT, size: 12, color: FIGURE_COLORS.ink } },
    legend: {
      orientation: 'h', x: 0, xanchor: 'left', y: 1.04, yanchor: 'bottom',
      bgcolor: 'rgba(255,255,255,0)', borderwidth: 0,
      font: { family: FIGURE_FONT, size: 12, color: FIGURE_COLORS.ink },
      traceorder: 'normal', itemsizing: 'constant',
    },
  };
}

// 组件标识决定样式，删除或重排其他峰时保持同一峰的颜色。
export function componentLine(id: string) {
  const colors = ['#009E73', '#D55E00', '#CC79A7', '#E69F00', '#56B4E9', '#7A5195'];
  const dashes = ['solid', 'dash', 'dot', 'dashdot'];
  const suffix = id.match(/(\d+)$/);
  const index = suffix ? Math.max(0, Number(suffix[1]) - 1) : Array.from(id).reduce((n, char) => (n * 31 + char.charCodeAt(0)) >>> 0, 0);
  return { color: colors[index % colors.length], width: 1.5, dash: dashes[index % dashes.length] };
}
