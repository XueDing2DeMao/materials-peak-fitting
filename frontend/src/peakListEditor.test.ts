import { afterEach, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { reactive } from 'vue';
import PeakListEditor from './components/PeakListEditor.vue';
import { addMultiComponent, createMultiConfig } from './multipeakState';

const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); });

function setup() {
  const config = reactive(createMultiConfig([0, 1, 2, 3], [0, 5, 2, 0], null, 'xrd'));
  addMultiComponent(config);
  addMultiComponent(config);
  const wrapper = mount(PeakListEditor, {
    attachTo: document.body,
    props: { components: config.components, constraints: config.constraints, unit: '°', busy: false },
  });
  wrappers.push(wrapper);
  return { config, wrapper };
}

it('选择峰与启用峰独立，快捷编辑只影响当前峰', async () => {
  const { config, wrapper } = setup();
  await wrapper.get('[data-peak-id="p2"] .peak-select').trigger('click');
  expect(wrapper.emitted('select')?.at(-1)).toEqual(['p2']);
  expect(config.components.every(component => component.enabled)).toBe(true);
  await wrapper.get('[aria-label="p2 xc 快捷初值"]').setValue(1.4);
  expect(config.components[1].parameters.xc?.value).toBe(1.4);
  expect(config.components[0].parameters.xc?.value).toBe(1);
  await wrapper.get('[aria-label="启用 p1"]').setValue(false);
  expect(wrapper.get('[data-peak-id="p2"] .peak-select').attributes('aria-pressed')).toBe('true');
  expect(config.components[0].enabled).toBe(false);
});

it('参数弹窗返回实际触发按钮，诊断入口仍定位参数并返回对应峰的行内按钮', async () => {
  const { wrapper } = setup();
  const details = wrapper.get('.peak-details-button');
  const row = wrapper.get('[data-peak-id="p1"]');
  const more = row.get('button[aria-haspopup="dialog"]');
  const dialog = row.get('dialog').element as HTMLDialogElement;
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; dialog.dispatchEvent(new Event('close')); };

  await details.trigger('click');
  await wrapper.vm.$nextTick();
  expect(document.activeElement?.getAttribute('aria-label')).toBe('p1 xc 初值');
  dialog.close();
  expect(document.activeElement).toBe(details.element);

  await more.trigger('click');
  dialog.close();
  expect(document.activeElement).toBe(more.element);

  await wrapper.vm.focusParameter('p1', 'A');
  expect(document.activeElement?.getAttribute('aria-label')).toBe('p1 A 初值');
  dialog.close();
  expect(document.activeElement).toBe(more.element);
});

it('快捷输入遵守绑定和运行锁定，删除所选峰后显示现存峰', async () => {
  const { config, wrapper } = setup();
  config.constraints.push({ source: { component: 'p1', parameter: 'xc' }, target: { component: 'p2', parameter: 'xc' }, kind: 'offset', value: 0.2 });
  await wrapper.setProps({ selectedPeak: 'p2' });
  expect(wrapper.get('[aria-label="p2 xc 快捷初值"]').attributes('disabled')).toBeDefined();
  config.components[1].parameters.xc!.fixed = true;
  await wrapper.vm.$nextTick();
  expect(wrapper.get('[aria-label="p2 xc 快捷初值"]').attributes('disabled')).toBeUndefined();
  await wrapper.setProps({ busy: true });
  expect(wrapper.get('[aria-label="p2 xc 快捷初值"]').attributes('disabled')).toBeDefined();
  expect(wrapper.get('[aria-label="启用 p2"]').attributes('disabled')).toBeDefined();
  await wrapper.setProps({ busy: false });
  config.components.splice(1, 1);
  await wrapper.vm.$nextTick();
  expect(wrapper.find('[aria-label="p1 常用参数"]').exists()).toBe(true);
  expect(wrapper.find('[aria-label="p2 常用参数"]').exists()).toBe(false);
});
