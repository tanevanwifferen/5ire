import useAppearanceStore from 'stores/useAppearanceStore';
// @ts-ignore
import * as echarts from 'echarts';
import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Parses an ECharts option string and converts it to a JavaScript object
 * @param {string} optStr - The option string containing ECharts configuration
 * @returns {object} The parsed ECharts option object
 * @throws {Error} When the option format is invalid
 */
const parseOption = (optStr: string) => {
  try {
    const match = optStr.match(/\{(.+)\}/s);
    if (!match) return {};
    return new Function(`return {${match[1]}}`)();
  } catch (error) {
    throw new Error('Invalid ECharts option format');
  }
};

/**
 * Custom React hook for managing ECharts instances within message components
 * @param {object} params - Hook parameters
 * @param {object} params.message - Message object containing an id
 * @param {string} params.message.id - Unique identifier for the message
 * @returns {object} Object containing methods to initialize and dispose ECharts instances
 * @returns {Function} returns.disposeECharts - Function to clean up all chart instances
 * @returns {Function} returns.initECharts - Function to initialize a new chart instance
 */
export default function useECharts({ message }: { message: { id: string } }) {
  const { t } = useTranslation();
  const theme = useAppearanceStore((state) => state.theme);
  const messageId = useMemo(() => message.id, [message]);
  const containersRef = useRef<{ [key: string]: echarts.EChartsType }>({});

  /**
   * Disposes all ECharts instances and cleans up event listeners
   */
  const disposeECharts = () => {
    const chartInstances = Object.values(containersRef.current);
    chartInstances.forEach(({ cleanup }: { cleanup: Function }) => {
      cleanup();
    });
    containersRef.current = {};
  };

  /**
   * Initializes an ECharts instance for a specific chart container
   * @param {string} prefix - Prefix for the chart instance key
   * @param {string} chartId - Unique identifier for the chart
   */
  const initECharts = (prefix: string, chartId: string) => {
    if (containersRef.current[`${prefix}-${chartId}`]) return; // already initialized
    const chartInstances = containersRef.current;
    const container = document.querySelector(
      `#${messageId} .echarts-container#${chartId}`,
    ) as HTMLDivElement;
    if (!container) return;
    const encodedConfig = container.getAttribute('data-echarts-config');
    if (!encodedConfig) return;
    try {
      const config = decodeURIComponent(encodedConfig);
      const option = parseOption(config);
      const chart = echarts.init(container, theme);
      chart.setOption(option);
      const resizeHandler = () => chart.resize();
      window.addEventListener('resize', resizeHandler);
      chartInstances[`${prefix}-${chartId}`] = {
        chartId,
        instance: chart,
        /**
         * Cleans up the chart instance and removes event listeners
         */
        cleanup: () => {
          window.removeEventListener('resize', resizeHandler);
          chart.dispose();
        },
      };
    } catch (error: any) {
      container.innerHTML = `
        <div class="text-gray-400">
          ${t('Message.Error.EChartsRenderFailed')}
        </div>
      `;
    }
  };

  return {
    disposeECharts,
    initECharts,
  };
}
