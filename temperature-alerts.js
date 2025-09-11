// Temperature crossing alert system
class TemperatureCrossingAlert {
    constructor() {
        this.lastCrossingState = null; // 'outdoor_higher', 'indoor_higher', or null
        this.lastIndoorTemp = null;
        this.lastOutdoorTemp = null;
        this.alertHistory = []; // Store recent alerts to avoid spam
        this.maxHistorySize = 10;
        this.cooldownPeriod = 15 * 60 * 1000; // 15 minutes in milliseconds

        // Create alert container in the DOM
        this.createAlertContainer();

        console.log('Temperature crossing alert system initialized');
    }

    createAlertContainer() {
        // Create alert container if it doesn't exist
        if (!document.getElementById('temperatureAlerts')) {
            const alertContainer = document.createElement('div');
            alertContainer.id = 'temperatureAlerts';
            alertContainer.className = 'temperature-alerts-container';
            document.body.appendChild(alertContainer);
        }
    }

    checkTemperatureCrossing(indoorTemp, outdoorTemp) {
        // Skip if we don't have valid temperature readings
        if (!indoorTemp || !outdoorTemp || indoorTemp <= 0 || outdoorTemp <= -50) {
            return;
        }

        const currentTime = new Date();

        // Determine current state
        let currentState = null;
        if (outdoorTemp > indoorTemp) {
            currentState = 'outdoor_higher';
        } else if (indoorTemp > outdoorTemp) {
            currentState = 'indoor_higher';
        } else {
            currentState = 'equal'; // Exactly equal (rare)
        }

        // Check if we have previous readings to compare
        if (this.lastIndoorTemp !== null && this.lastOutdoorTemp !== null && this.lastCrossingState !== null) {

            // Detect crossing events
            let crossingDetected = false;
            let alertMessage = '';
            let alertType = 'info';

            if (this.lastCrossingState !== currentState && currentState !== 'equal') {
                if (this.lastCrossingState === 'indoor_higher' && currentState === 'outdoor_higher') {
                    // Outdoor temperature crossed above indoor
                    crossingDetected = true;
                    alertMessage = `🌡️ Outdoor temp (${outdoorTemp}°F) crossed ABOVE indoor temp (${indoorTemp}°F)`;
                    alertType = 'warning';
                } else if (this.lastCrossingState === 'outdoor_higher' && currentState === 'indoor_higher') {
                    // Outdoor temperature crossed below indoor
                    crossingDetected = true;
                    alertMessage = `🌡️ Outdoor temp (${outdoorTemp}°F) crossed BELOW indoor temp (${indoorTemp}°F)`;
                    alertType = 'info';
                }
            }

            if (crossingDetected) {
                // Check cooldown period to avoid spam alerts
                if (this.shouldShowAlert(alertMessage, currentTime)) {
                    this.showAlert(alertMessage, alertType, currentTime);
                    this.playAlertSound();

                    // Log to console
                    console.log(`Temperature Crossing Alert: ${alertMessage}`);

                    // Add to history
                    this.addToHistory(alertMessage, currentTime);
                }
            }
        }

        // Update tracking variables
        this.lastIndoorTemp = indoorTemp;
        this.lastOutdoorTemp = outdoorTemp;
        this.lastCrossingState = currentState;
    }

    shouldShowAlert(message, currentTime) {
        // Check if we've shown a similar alert recently
        return !this.alertHistory.some(alert => {
            const timeDiff = currentTime.getTime() - alert.timestamp.getTime();
            const isSimilar = alert.message.includes('crossed ABOVE') === message.includes('crossed ABOVE');
            return isSimilar && timeDiff < this.cooldownPeriod;
        });
    }

    showAlert(message, type, timestamp) {
        const alertContainer = document.getElementById('temperatureAlerts');

        // Create alert element
        const alert = document.createElement('div');
        alert.className = `temperature-alert temperature-alert-${type}`;

        const alertTime = timestamp.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });

        alert.innerHTML = `
            <div class="alert-content">
                <div class="alert-message">${message}</div>
                <div class="alert-time">${alertTime}</div>
            </div>
            <button class="alert-close" onclick="this.parentElement.remove()">×</button>
        `;

        // Add to container at the top
        alertContainer.insertBefore(alert, alertContainer.firstChild);

        // Auto-dismiss after 30 seconds
        setTimeout(() => {
            if (alert.parentNode) {
                alert.classList.add('fade-out');
                setTimeout(() => {
                    if (alert.parentNode) {
                        alert.remove();
                    }
                }, 500);
            }
        }, 30000);

        // Keep only recent alerts visible (max 5)
        const alerts = alertContainer.querySelectorAll('.temperature-alert');
        if (alerts.length > 5) {
            for (let i = 5; i < alerts.length; i++) {
                alerts[i].remove();
            }
        }
    }

    playAlertSound() {
        try {
            // Create a short beep sound using Web Audio API
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);

            oscillator.frequency.value = 800; // 800Hz tone
            oscillator.type = 'sine';

            gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);

            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.5);

        } catch (error) {
            // Fallback to console beep if Web Audio API fails
            console.log('🔔 Temperature crossing alert!');

            // Try system beep as fallback (limited browser support)
            try {
                if ('Notification' in window && Notification.permission === 'granted') {
                    new Notification('Temperature Alert', {
                        body: 'Outdoor and indoor temperatures have crossed',
                        icon: '🌡️'
                    });
                }
            } catch (notificationError) {
                console.log('Notification failed:', notificationError);
            }
        }
    }

    addToHistory(message, timestamp) {
        this.alertHistory.unshift({ message, timestamp });

        // Keep only recent history
        if (this.alertHistory.length > this.maxHistorySize) {
            this.alertHistory = this.alertHistory.slice(0, this.maxHistorySize);
        }
    }

    // Method to manually test the alert system
    testAlert() {
        const testMessage = "🧪 Test Alert: Outdoor temp (75°F) crossed ABOVE indoor temp (72°F)";
        this.showAlert(testMessage, 'warning', new Date());
        this.playAlertSound();
        console.log('Temperature crossing alert test executed');
    }

    // Get alert history for debugging
    getAlertHistory() {
        return this.alertHistory.map(alert => ({
            message: alert.message,
            time: alert.timestamp.toLocaleString()
        }));
    }

    // Request notification permissions
    async requestNotificationPermission() {
        if ('Notification' in window && Notification.permission === 'default') {
            try {
                const permission = await Notification.requestPermission();
                console.log('Notification permission:', permission);
                return permission === 'granted';
            } catch (error) {
                console.log('Error requesting notification permission:', error);
                return false;
            }
        }
        return Notification.permission === 'granted';
    }
}

// Global instance
let temperatureAlertSystem = null;

// Initialize the alert system when DOM is loaded
document.addEventListener('DOMContentLoaded', function () {
    temperatureAlertSystem = new TemperatureCrossingAlert();

    // Request notification permissions
    temperatureAlertSystem.requestNotificationPermission();

    console.log('Temperature alert system ready');
});

// Expose test function globally for debugging
window.testTemperatureAlert = function () {
    if (temperatureAlertSystem) {
        temperatureAlertSystem.testAlert();
    } else {
        console.log('Temperature alert system not initialized yet');
    }
};

// Expose history function globally for debugging
window.getTemperatureAlertHistory = function () {
    if (temperatureAlertSystem) {
        console.table(temperatureAlertSystem.getAlertHistory());
        return temperatureAlertSystem.getAlertHistory();
    } else {
        console.log('Temperature alert system not initialized yet');
        return [];
    }
};