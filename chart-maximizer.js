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

        // Create placeholder to hold the grid position
        this.placeholder = document.createElement('div');
        this.placeholder.className = container.className; // Copy classes for styling
        this.placeholder.style.height = `${container.clientHeight}px`;
        this.placeholder.style.width = `${container.clientWidth}px`;

        // Replace container with placeholder in the grid
        this.originalParent.replaceChild(this.placeholder, container);

        // Append container to body for maximization
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

        // Trigger chart resize after DOM changes
        setTimeout(() => {
            this.resizeChart(chartId);
        }, 100);
    }

    minimize() {
        if (!this.maximizedChart) return;

        const container = this.maximizedChart;
        const chartId = container.querySelector('canvas').id;

        // Remove maximized class and reset inline styles
        container.classList.remove('chart-maximized');
        container.style.width = '';
        container.style.height = '';
        document.body.classList.remove('chart-maximized-active');

        // Remove container from body
        document.body.removeChild(container);

        // Replace placeholder with original container
        this.originalParent.replaceChild(container, this.placeholder);
        this.placeholder = null;

        // Restore button
        const button = container.querySelector('.close-btn');
        if (button) {
            button.textContent = 'Maximize';
            button.className = 'maximize-btn';
        }

        // Force grid reflow
        this.originalParent.style.display = 'none';
        this.originalParent.offsetHeight; // Trigger reflow
        this.originalParent.style.display = '';

        // Trigger window resize to update charts and layout
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