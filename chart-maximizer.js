// Chart Maximizer functionality
class ChartMaximizer {
    constructor() {
        this.maximizedChart = null;
        this.originalParent = null;
        this.placeholder = null;
        this.initializeEventListeners();
    }

    initializeEventListeners() {
        // Temperature Chart
        const tempBtn = document.getElementById('temperatureMaximizeBtn');
        if (tempBtn) {
            tempBtn.addEventListener('click', () => this.toggleMaximize('temperatureChartContainer', 'temperatureChart'));
        }

        // Solar Chart
        const solarBtn = document.getElementById('solarMaximizeBtn');
        if (solarBtn) {
            solarBtn.addEventListener('click', () => this.toggleMaximize('solarChartContainer', 'solarChart'));
        }

        // Battery Chart
        const batteryBtn = document.getElementById('batteryMaximizeBtn');
        if (batteryBtn) {
            batteryBtn.addEventListener('click', () => this.toggleMaximize('batteryChartContainer', 'batteryChart'));
        }

        // Handle ESC key to minimize
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.maximizedChart) {
                this.minimize();
            }
        });
    }

    toggleMaximize(containerId, chartId) {
        if (this.maximizedChart) {
            this.minimize();
        } else {
            this.maximize(containerId, chartId);
        }
    }

    maximize(containerId, chartId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        // Store references
        this.maximizedChart = container;
        this.originalParent = container.parentNode;

        // ✅ Store original dimensions
        this.originalWidth = container.clientWidth;
        this.originalHeight = container.clientHeight;

        // Create placeholder
        this.placeholder = document.createElement('div');
        this.placeholder.className = container.className;
        this.placeholder.style.height = `${this.originalHeight}px`;
        this.placeholder.style.width = `${this.originalWidth}px`;

        // Replace container with placeholder
        this.originalParent.replaceChild(this.placeholder, container);

        // Move container to body
        document.body.appendChild(container);

        // Add maximized class and reset inline styles
        container.classList.add('chart-maximized');
        container.style.width = '';
        container.style.height = '';
        document.body.classList.add('chart-maximized-active');

        // Update button text and functionality
        const button = container.querySelector('.maximize-btn');
        if (button) {
            button.textContent = 'Minimize';
            button.className = 'close-btn';
        }

        setTimeout(() => this.resizeChart(chartId), 100);
    }

    minimize() {
        if (!this.maximizedChart) return;

        const container = this.maximizedChart;
        const chartId = container.querySelector('canvas').id;

        // Remove maximized class and reset inline styles
        container.classList.remove('chart-maximized');
        document.body.classList.remove('chart-maximized-active');

        // Remove container from body
        document.body.removeChild(container);

        // Replace placeholder with container
        this.originalParent.replaceChild(container, this.placeholder);
        this.placeholder = null;

        // ✅ Restore original size
        container.style.width = this.originalWidth + 'px';
        container.style.height = this.originalHeight + 'px';

        const button = container.querySelector('.close-btn');
        if (button) {
            button.textContent = 'Maximize';
            button.className = 'maximize-btn';
        }

        setTimeout(() => {
            this.resizeChart(chartId);
            window.dispatchEvent(new Event('resize'));
        }, 100);

        // Clear references
        this.maximizedChart = null;
        this.originalParent = null;
    }

    resizeChart(chartId) {
        let chart = null;

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
}

// Initialize the chart maximizer when the DOM is loaded
document.addEventListener('DOMContentLoaded', function () {
    new ChartMaximizer();
});