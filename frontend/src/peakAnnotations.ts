import { componentLine, FIGURE_COLORS, FIGURE_FONT } from './figureStyle';

// 仅表示输入／结果中的 xc，不把非对称峰的 xc 解释为实际峰顶。
export interface AnnotatedPeak {
  id: string;
  enabled?: boolean;
  parameters: { xc?: { value: number } };
}

export function peakAnnotations(peaks: AnnotatedPeak[], start: number, end: number, unit = '') {
  const visible = peaks.filter(p => p.enabled !== false && Number.isFinite(p.parameters.xc?.value)
    && p.parameters.xc!.value >= start && p.parameters.xc!.value <= end);
  const annotations = visible.map((p, i) => {
    const x = p.parameters.xc!.value;
    const id = p.id.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return {
      x, xref: 'x', y: 1 - (i % 3) * .19, yref: 'paper',
      text: `${id}<br>${Number(x.toPrecision(6))}${unit}`, showarrow: false,
      xanchor: 'center', yanchor: 'top', captureevents: false,
      bgcolor: 'rgba(255,255,255,.9)', borderpad: 2,
      font: { family: FIGURE_FONT, size: 11, color: FIGURE_COLORS.ink },
    };
  });
  const shapes = visible.map(p => ({
    type: 'line', xref: 'x', yref: 'paper', x0: p.parameters.xc!.value, x1: p.parameters.xc!.value,
    y0: 0, y1: 1, layer: 'below', editable: false,
    line: { color: componentLine(p.id).color, width: 1, dash: 'dot' },
  }));
  return { annotations, shapes };
}
