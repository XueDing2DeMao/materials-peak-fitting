import type { Anchor } from './types';

export function suggestBaselineAnchors(x:number[],y:number[],start:number,end:number,count: number): Anchor[] {
  const points = x.map((x, index) => ({ x, y: y[index] ?? 0 }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= start && point.x <= end)
    .sort((left, right) => left.x - right.x);
  const requestedCount = Math.min(count, points.length);
  if (!points.length || requestedCount <= 0) return [];
  const window = Math.max(1, Math.ceil(points.length * 0.05));
  const median = (values: number[]): number => {
    const ordered = [...values].sort((left, right) => left - right);
    return ordered[Math.floor(ordered.length / 2)] ?? 0;
  };
  const endpointAnchors = [
    { x: points[0].x, y: median(points.slice(0, window).map((point) => point.y)) },
    { x: points.at(-1)!.x, y: median(points.slice(-window).map((point) => point.y)) },
  ];
  if (requestedCount <= 2) return endpointAnchors.slice(0, requestedCount);
  const peakIndex = points.reduce((best, point, index) => point.y > points[best].y ? index : best, 0);
  const exclusion = Math.max(1, Math.ceil(points.length * 0.1));
  const background = points.filter((_, index) => index > 0 && index < points.length - 1 && Math.abs(index - peakIndex) > exclusion);
  const interiorCount = requestedCount - 2;
  const interior = Array.from({ length: interiorCount }, (_, index) => {
    const target = Math.round((index + 1) * (background.length - 1) / (interiorCount + 1));
    const radius = Math.max(1, Math.ceil(background.length / Math.max(24, interiorCount * 8)));
    const candidates = background.slice(Math.max(0, target - radius), target + radius + 1);
    const targetPoint = background[target] ?? candidates[0] ?? points[peakIndex];
    const targetY = median(candidates.map((point) => point.y));
    return candidates.reduce((best, point) => {
      const bestDistance = Math.abs(best.y - targetY);
      const pointDistance = Math.abs(point.y - targetY);
      if (pointDistance !== bestDistance) return pointDistance < bestDistance ? point : best;
      return Math.abs(point.x - targetPoint.x) < Math.abs(best.x - targetPoint.x) ? point : best;
    }, candidates[0] ?? points[peakIndex]);
  });
  return [...endpointAnchors, ...interior].sort((left, right) => left.x - right.x);
}
