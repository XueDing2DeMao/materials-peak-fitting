import {computed, onBeforeUnmount, onMounted, ref, type Ref} from 'vue';

const clamp = (value:number, min:number, max:number) => Math.round(Math.max(min, Math.min(max, value)));
const defaultSettingsWidth = 340;

// 布局只保留在当前工作区内存中，不写入拟合配置或会话文件。
export function useWorkbenchLayout(_resultsOpen:Ref<boolean>) {
  const grid = ref<HTMLElement|null>(null);
  const width = ref(1200);
  const height = ref(640);
  const viewportHeight = ref(typeof window === 'undefined' ? 900 : window.innerHeight);
  const preferredSettings = ref(defaultSettingsWidth);
  const preferredResults = ref(220);
  const chartExpanded = ref(false);
  // 结果始终停靠图谱下方，使参数编辑与诊断共享完整图谱宽度。
  const stacked = computed(() => true);
  const settingsMax = computed(() => Math.max(232, Math.min(420, width.value - 8 - 400)));
  // 矮屏将编辑工具收起，主图仍保留约 200px 画布（扣除坐标轴后可读）。
  const chartMinHeight = computed(() => viewportHeight.value <= 800 ? 398 : 440);
  const resultMax = computed(() => Math.max(160, Math.min(480, Math.floor(height.value - chartMinHeight.value - 8))));
  const settingsWidth = computed(() => clamp(preferredSettings.value, 232, settingsMax.value));
  const resultHeight = computed(() => clamp(preferredResults.value, 160, resultMax.value));
  const layoutStyle = computed(() => ({
    '--settings-width': settingsWidth.value + 'px',
    '--results-height': resultHeight.value + 'px',
    '--chart-min-height': chartMinHeight.value + 'px',
  }));
  function setSize(panel:'settings'|'results', value:number) {
    if (!Number.isFinite(value)) return;
    if (panel === 'settings') preferredSettings.value = clamp(value, 232, settingsMax.value);
    else preferredResults.value = clamp(value, 160, resultMax.value);
  }
  function resetSizes() {
    preferredSettings.value = defaultSettingsWidth;
    preferredResults.value = 220;
  }
  let observer:ResizeObserver|undefined;
  function measure(rect:{width:number;height:number}) {
    if (typeof window !== 'undefined') viewportHeight.value = window.innerHeight;
    if (rect.width > 0) width.value = rect.width;
    if (rect.height > 0) height.value = rect.height;
  }
  onMounted(() => {
    if (!grid.value) return;
    measure({width:grid.value.clientWidth,height:grid.value.clientHeight});
    if (typeof ResizeObserver === 'undefined') return;
    observer = new ResizeObserver(entries => entries.forEach(entry => measure(entry.contentRect)));
    observer.observe(grid.value);
  });
  onBeforeUnmount(() => observer?.disconnect());
  return {grid, stacked, chartExpanded, settingsWidth, resultHeight, settingsMax, resultMax, layoutStyle, setSize, resetSizes};
}
