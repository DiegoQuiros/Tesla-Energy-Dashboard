// Chart Collapse/Expand functionality
class ChartCollapser {
    constructor() {
        this.collapsedCharts = new Set();
        this.initializeEventListeners();
    }

    initializeEventListeners() {
        // Temperature Chart
        const tempBtn = document.getElementById('temperatureCollapseBtn');
        if (tempBtn) {
            tempBtn.addEventListener('click', () => this.toggleCollapse('temperatureChartContainer'));
        }

        // Solar Chart
        const solarBtn = document.getElementById('solarCollapseBtn');
        if (solarBtn) {
            solarBtn.addEventListener('click', () => this.toggleCollapse('solarChartContainer'));
        }

        // Battery Chart
        const batteryBtn = document.getElementById('batteryCollapseBtn');
        if (batteryBtn) {
            batteryBtn.addEventListener('click', () => this.toggleCollapse('batteryChartContainer'));
        }
    }

    toggleCollapse(containerId) {
        const container = document.getElementById(containerId);
        const chartWrapper = container.querySelector('.chart-wrapper');
        const button = container.querySelector('.collapse-btn');

        if (!container || !chartWrapper || !button) return;

        const isCollapsed = this.collapsedCharts.has(containerId);

        if (isCollapsed) {
            this.expand(containerId, chartWrapper, button);
        } else {
            this.collapse(containerId, chartWrapper, button);
        }
    }

    collapse(containerId, chartWrapper, button) {
        // Add to collapsed set
        this.collapsedCharts.add(containerId);

        // Update button text and icon
        button.textContent = 'Expand';
        button.title = 'Expand chart';

        // Hide chart wrapper with animation
        chartWrapper.style.transition = 'all 0.3s ease';
        chartWrapper.style.height = chartWrapper.offsetHeight + 'px'; // Set explicit height

        // Force reflow
        chartWrapper.offsetHeight;

        // Collapse to 0 height
        chartWrapper.style.height = '0px';
        chartWrapper.style.overflow = 'hidden';
        chartWrapper.style.opacity = '0';

        // Add collapsed class to container
        const container = document.getElementById(containerId);
        container.classList.add('chart-collapsed');

        console.log(`Chart ${containerId} collapsed`);
    }

    expand(containerId, chartWrapper, button) {
        // Remove from collapsed set
        this.collapsedCharts.delete(containerId);

        // Update button text and icon
        button.textContent = 'Collapse';
        button.title = 'Collapse chart';

        // Remove collapsed class from container
        const container = document.getElementById(containerId);
        container.classList.remove('chart-collapsed');

        // Expand chart wrapper
        chartWrapper.style.transition = 'all 0.3s ease';
        chartWrapper.style.height = '400px'; // Default height
        chartWrapper.style.overflow = 'visible';
        chartWrapper.style.opacity = '1';

        // Clean up inline styles after animation
        setTimeout(() => {
            chartWrapper.style.transition = '';
            chartWrapper.style.height = '';
            chartWrapper.style.overflow = '';
            chartWrapper.style.opacity = '';

            // Resize chart after expansion
            this.resizeChart(containerId);
        }, 300);

        console.log(`Chart ${containerId} expanded`);
    }

    resizeChart(containerId) {
        let chart = null;
        const chartId = containerId.replace('Container', '');

        // Get the appropriate chart instance
        switch (chartId) {
            case 'temperatureChart':
                chart = temperatureChart;
                break;
            case 'solarChart':
                chart = solarChart;
                break;
            case 'batteryChart':
                chart = batteryChart;
                break;
        }

        if (chart) {
            chart.resize();
        }
    }

    // Check if a chart is currently collapsed
    isCollapsed(containerId) {
        return this.collapsedCharts.has(containerId);
    }

    // Get list of collapsed charts
    getCollapsedCharts() {
        return Array.from(this.collapsedCharts);
    }

    // Expand all charts
    expandAll() {
        this.collapsedCharts.forEach(containerId => {
            const container = document.getElementById(containerId);
            const chartWrapper = container.querySelector('.chart-wrapper');
            const button = container.querySelector('.collapse-btn');

            if (container && chartWrapper && button) {
                this.expand(containerId, chartWrapper, button);
            }
        });
    }

    // Collapse all charts
    collapseAll() {
        const chartContainers = ['temperatureChartContainer', 'solarChartContainer', 'batteryChartContainer'];

        chartContainers.forEach(containerId => {
            const container = document.getElementById(containerId);
            const chartWrapper = container?.querySelector('.chart-wrapper');
            const button = container?.querySelector('.collapse-btn');

            if (container && chartWrapper && button && !this.collapsedCharts.has(containerId)) {
                this.collapse(containerId, chartWrapper, button);
            }
        });
    }
}

// Global instance
let chartCollapser = null;

// Initialize the chart collapser when the DOM is loaded
document.addEventListener('DOMContentLoaded', function () {
    chartCollapser = new ChartCollapser();
    console.log('Chart collapser initialized');
});

// Expose functions globally for debugging
window.expandAllCharts = function () {
    if (chartCollapser) {
        chartCollapser.expandAll();
    } else {
        console.log('Chart collapser not initialized yet');
    }
};

window.collapseAllCharts = function () {
    if (chartCollapser) {
        chartCollapser.collapseAll();
    } else {
        console.log('Chart collapser not initialized yet');
    }
};