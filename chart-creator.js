function createCharts() {
    if (typeof Chart === 'undefined') {
        console.error('Chart.js is not loaded');
        return;
    }

    const todayData = getTodayData();
    console.log(`Creating charts with ${todayData.length} today's data points`);

    if (todayData.length === 0) {
        console.warn('No data for today to display in charts');
        return;
    }

    createTemperatureChart(todayData);
    createSolarChart(todayData);
    createBatteryChart(todayData);
}

function createTemperatureChart(todayData) {
    const ctx = document.getElementById('temperatureChart').getContext('2d');

    // Destroy existing chart
    if (temperatureChart) {
        temperatureChart.destroy();
    }

    // Filter data to every 15 minutes
    const filteredData = todayData.filter((point, index) => {
        if (index === 0) return true; // Always include first point

        const date = convertToPDT(point.LocalTimestamp);
        return date.getMinutes() % 15 === 0; // Include points at :00, :15, :30, :45
    });

    const timeLabels = filteredData.map(point => {
        const date = convertToPDT(point.LocalTimestamp);
        return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    });

    const indoorTemps = filteredData.map(point =>
        (point.ThermostatCurrentTempF && point.ThermostatCurrentTempF > 0) ? point.ThermostatCurrentTempF : null
    );

    const outdoorTemps = filteredData.map(point =>
        (point.WeatherTemperatureF && point.WeatherTemperatureF > -50) ? point.WeatherTemperatureF : null
    );

    // Generate simple forecast for remaining hours (only for outdoor temperature)
    const now = new Date();
    const lastOutdoorTemp = filteredData.length > 0 ? (filteredData[filteredData.length - 1].WeatherTemperatureF || 70) : 70;
    const outdoorForecast = [];

    // Create forecast points for next few hours
    const currentTime = now;
    for (let i = 1; i <= 8; i++) { // Next 2 hours in 15-minute intervals
        const futureTime = new Date(currentTime);
        futureTime.setMinutes(currentTime.getMinutes() + (i * 15));

        if (futureTime.getDate() === now.getDate()) { // Only for today
            // Simple forecast: cooler at night, warmer during day
            const hour = futureTime.getHours();
            let tempAdjustment = 0;
            if (hour >= 6 && hour <= 18) {
                // Daytime: slightly warmer
                tempAdjustment = Math.sin((hour - 6) / 12 * Math.PI) * 4;
            } else {
                // Nighttime: cooler
                tempAdjustment = -3;
            }

            timeLabels.push(futureTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }));
            indoorTemps.push(null);
            outdoorTemps.push(null);
            outdoorForecast.push(Math.round(lastOutdoorTemp + tempAdjustment));
        }
    }

    const datasets = [
        {
            label: 'Indoor Temperature',
            data: indoorTemps,
            borderColor: '#4a9eff',
            backgroundColor: 'rgba(74, 158, 255, 0.1)',
            tension: 0.4,
            borderWidth: 3,
            pointRadius: 2, // Smaller circles
            pointBackgroundColor: '#4a9eff',
            spanGaps: true
        },
        {
            label: 'Outdoor Temperature',
            data: outdoorTemps,
            borderColor: '#ffcc00',
            backgroundColor: 'rgba(255, 204, 0, 0.1)',
            tension: 0.4,
            borderWidth: 3,
            pointRadius: 2, // Smaller circles
            pointBackgroundColor: '#ffcc00',
            spanGaps: true
        },
        {
            label: 'Outdoor Forecast',
            data: Array(filteredData.length).fill(null).concat(outdoorForecast),
            borderColor: 'transparent',
            backgroundColor: 'rgba(255, 204, 0, 0.3)',
            pointRadius: 2, // Smaller circles
            pointBackgroundColor: 'rgba(255, 204, 0, 0.6)',
            pointBorderColor: '#ffcc00',
            pointBorderWidth: 2,
            showLine: false,
            spanGaps: false
        }
    ];

    temperatureChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: timeLabels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: {
                        color: '#ffffff'
                    }
                }
            },
            scales: {
                x: {
                    ticks: {
                        color: '#888',
                        maxTicksLimit: 12
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    }
                },
                y: {
                    ticks: {
                        color: '#888',
                        callback: function (value) {
                            return value + '°F';
                        }
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    }
                }
            }
        }
    });
}

function createSolarChart(todayData) {
    const ctx = document.getElementById('solarChart').getContext('2d');

    // Destroy existing chart
    if (solarChart) {
        solarChart.destroy();
    }

    // Get yesterday's data
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    const endOfYesterday = new Date(yesterday);
    endOfYesterday.setHours(23, 59, 59, 999);

    const yesterdayData = energyData.filter(point => {
        const pointDate = convertToPDT(point.LocalTimestamp);
        return pointDate >= yesterday && pointDate <= endOfYesterday;
    });

    // Get all solar data (not filtered by time) for both days to find meaningful start/end points
    const allTodayData = todayData;
    const allYesterdayData = yesterdayData;

    // Function to find meaningful solar start point (last 0kW before production begins)
    function findSolarStartPoint(data) {
        if (data.length === 0) return null;

        // Sort data by time
        const sortedData = data.sort((a, b) => convertToPDT(a.LocalTimestamp) - convertToPDT(b.LocalTimestamp));

        // Find the last 0kW point before production starts
        for (let i = 0; i < sortedData.length - 1; i++) {
            const currentPower = Math.max(0, sortedData[i].SolarPowerKw || 0);
            const nextPower = Math.max(0, sortedData[i + 1].SolarPowerKw || 0);

            if (currentPower === 0 && nextPower > 0) {
                const date = convertToPDT(sortedData[i].LocalTimestamp);
                return (date.getHours() - 6) * 60 + date.getMinutes(); // Minutes since 6am
            }
        }

        return null; // No start point found
    }

    // Function to find meaningful solar end point (first 0kW where production ends)
    function findSolarEndPoint(data) {
        if (data.length === 0) return null;

        // Sort data by time
        const sortedData = data.sort((a, b) => convertToPDT(a.LocalTimestamp) - convertToPDT(b.LocalTimestamp));

        // Find the first point where solar drops to 0 and stays 0 for the rest of the day
        for (let i = 0; i < sortedData.length; i++) {
            const solarPower = Math.max(0, sortedData[i].SolarPowerKw || 0);

            if (solarPower === 0) {
                // Check if this is after some production (not initial zeros)
                const hasHadProduction = sortedData.slice(0, i).some(point => Math.max(0, point.SolarPowerKw || 0) > 0);

                if (hasHadProduction) {
                    // Check if all remaining points are also 0
                    const remainingPoints = sortedData.slice(i);
                    const allZero = remainingPoints.every(point => Math.max(0, point.SolarPowerKw || 0) === 0);

                    if (allZero) {
                        const date = convertToPDT(sortedData[i].LocalTimestamp);
                        return (date.getHours() - 6) * 60 + date.getMinutes(); // Minutes since 6am
                    }
                }
            }
        }

        return null; // No end point found
    }

    // Find start and end points for both datasets
    const todayStartPoint = findSolarStartPoint(allTodayData);
    const todayEndPoint = findSolarEndPoint(allTodayData);
    const yesterdayStartPoint = findSolarStartPoint(allYesterdayData);
    const yesterdayEndPoint = findSolarEndPoint(allYesterdayData);

    // Determine the overall start and end times for the chart
    let chartStartMinute = null;
    let chartEndMinute = null;

    // Use the earliest start point and latest end point from both days
    if (todayStartPoint !== null && yesterdayStartPoint !== null) {
        chartStartMinute = Math.min(todayStartPoint, yesterdayStartPoint);
    } else if (todayStartPoint !== null) {
        chartStartMinute = todayStartPoint;
    } else if (yesterdayStartPoint !== null) {
        chartStartMinute = yesterdayStartPoint;
    }

    if (todayEndPoint !== null && yesterdayEndPoint !== null) {
        chartEndMinute = Math.max(todayEndPoint, yesterdayEndPoint);
    } else if (todayEndPoint !== null) {
        chartEndMinute = todayEndPoint;
    } else if (yesterdayEndPoint !== null) {
        chartEndMinute = yesterdayEndPoint;
    }

    // Fallback to reasonable defaults if no meaningful points found
    if (chartStartMinute === null) chartStartMinute = 0; // 6:00 AM
    if (chartEndMinute === null) chartEndMinute = 14 * 60; // 8:00 PM

    // Filter data to meaningful time range and convert to time-of-day
    const todayTimeData = allTodayData
        .map(point => {
            const date = convertToPDT(point.LocalTimestamp);
            const minutesSince6am = (date.getHours() - 6) * 60 + date.getMinutes();
            return {
                minutes: minutesSince6am,
                power: Math.max(0, point.SolarPowerKw || 0)
            };
        })
        .filter(d => d.minutes >= chartStartMinute && d.minutes <= chartEndMinute);

    const yesterdayTimeData = allYesterdayData
        .map(point => {
            const date = convertToPDT(point.LocalTimestamp);
            const minutesSince6am = (date.getHours() - 6) * 60 + date.getMinutes();
            return {
                minutes: minutesSince6am,
                power: Math.max(0, point.SolarPowerKw || 0)
            };
        })
        .filter(d => d.minutes >= chartStartMinute && d.minutes <= chartEndMinute);

    // Create time labels for the meaningful range (5-minute intervals)
    const timeLabels = [];
    const todaySolarPowerData = [];
    const yesterdaySolarPowerData = [];

    for (let minute = Math.floor(chartStartMinute / 5) * 5; minute <= chartEndMinute; minute += 5) {
        // Convert minutes back to time format
        const hour = Math.floor(minute / 60) + 6;
        const min = minute % 60;

        // Handle negative hours (before 6am) and hours beyond 24
        let displayHour = hour;
        let ampm = 'AM';

        if (hour < 0) {
            displayHour = 12 + hour; // e.g., -1 becomes 11 PM previous day
            ampm = 'PM';
        } else if (hour === 0) {
            displayHour = 12;
            ampm = 'AM';
        } else if (hour < 12) {
            displayHour = hour;
            ampm = 'AM';
        } else if (hour === 12) {
            displayHour = 12;
            ampm = 'PM';
        } else {
            displayHour = hour - 12;
            ampm = 'PM';
        }

        const timeLabel = `${displayHour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')} ${ampm}`;
        timeLabels.push(timeLabel);

        // Find closest today data point (within 2 minutes)
        const todayMatch = todayTimeData.find(d => Math.abs(d.minutes - minute) <= 2);
        todaySolarPowerData.push(todayMatch ? todayMatch.power : null);

        // Find closest yesterday data point (within 2 minutes)
        const yesterdayMatch = yesterdayTimeData.find(d => Math.abs(d.minutes - minute) <= 2);
        yesterdaySolarPowerData.push(yesterdayMatch ? yesterdayMatch.power : null);
    }

    const datasets = [{
        label: 'Today\'s Solar Production (kW)',
        data: todaySolarPowerData,
        borderColor: '#ffcc00',
        backgroundColor: 'rgba(255, 204, 0, 0.2)',
        fill: true,
        tension: 0.4,
        borderWidth: 2,
        pointRadius: 2,
        spanGaps: true
    }];

    // Only add yesterday's data if we have any
    if (yesterdayTimeData.length > 0) {
        datasets.push({
            label: 'Yesterday\'s Solar Production (kW)',
            data: yesterdaySolarPowerData,
            borderColor: '#888888',
            backgroundColor: 'rgba(136, 136, 136, 0.1)',
            fill: false,
            tension: 0.4,
            borderWidth: 2,
            pointRadius: 1,
            spanGaps: true
        });
    }

    solarChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: timeLabels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: {
                        color: '#ffffff'
                    }
                }
            },
            scales: {
                x: {
                    ticks: {
                        color: '#888',
                        maxTicksLimit: 12
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    }
                },
                y: {
                    beginAtZero: true,
                    ticks: {
                        color: '#888',
                        callback: function (value) {
                            return value + ' kW';
                        }
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    }
                }
            }
        }
    });
}

function createBatteryChart(todayData) {
    const ctx = document.getElementById('batteryChart').getContext('2d');

    // Destroy existing chart
    if (batteryChart) {
        batteryChart.destroy();
    }

    const timeLabels = todayData.map(point => {
        const date = convertToPDT(point.LocalTimestamp);
        return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    });

    const powerwallData = todayData.map(point => point.BatteryPercentage || 0);

    // Function to create vehicle data with proper gap handling
    function createVehicleData(vehiclePrefix) {
        const vehicleData = [];
        let lastKnownLevel = null;
        let lastKnownTimestamp = null;

        // First, find the last datapoint before today to establish starting level
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        // Look for last available data before today
        for (let i = energyData.length - 1; i >= 0; i--) {
            const point = energyData[i];
            const pointDate = convertToPDT(point.LocalTimestamp);

            if (pointDate < todayStart && point[`${vehiclePrefix}IsAvailable`] && point[`${vehiclePrefix}Battery`] != null) {
                lastKnownLevel = point[`${vehiclePrefix}Battery`];
                lastKnownTimestamp = pointDate;
                break;
            }
        }

        // Process today's data
        for (let i = 0; i < todayData.length; i++) {
            const point = todayData[i];
            const pointDate = convertToPDT(point.LocalTimestamp);

            if (point[`${vehiclePrefix}IsAvailable`] && point[`${vehiclePrefix}Battery`] != null) {
                // Vehicle is available with valid battery data
                lastKnownLevel = point[`${vehiclePrefix}Battery`];
                lastKnownTimestamp = pointDate;
                vehicleData.push(lastKnownLevel);
            } else if (lastKnownLevel !== null) {
                // Vehicle data not available but we have a last known level
                // For gaps, we omit the datapoint (push null)
                vehicleData.push(null);
            } else {
                // No previous data available
                vehicleData.push(null);
            }
        }

        // Always ensure we have a datapoint for the current time (last datapoint)
        if (vehicleData.length > 0 && lastKnownLevel !== null) {
            // Replace the last datapoint with the last known level to ensure continuity
            vehicleData[vehicleData.length - 1] = lastKnownLevel;
        }

        return {
            data: vehicleData,
            lastKnownLevel: lastKnownLevel
        };
    }

    // Create vehicle datasets
    const model3Result = createVehicleData('Model3');
    const modelXResult = createVehicleData('ModelX');

    // Generate predictions for the rest of the day
    const predictions = generateBatteryPredictions(todayData);
    const actualDataCount = todayData.length;

    const datasets = [
        // Actual Powerwall data
        {
            label: 'Powerwall',
            data: powerwallData,
            borderColor: '#00cc00',
            backgroundColor: 'rgba(0, 204, 0, 0.1)',
            tension: 0.4,
            borderWidth: 2,
            spanGaps: true,
            pointStyle: 'circle',
            pointRadius: 2
        },
        // Predicted Powerwall data
        {
            label: 'Powerwall (Predicted)',
            data: Array(actualDataCount).fill(null).concat(predictions.powerwall),
            borderColor: 'transparent', // No connecting lines
            backgroundColor: 'rgba(0, 204, 0, 0.3)',
            pointStyle: 'circle',
            pointRadius: 2,
            pointBorderColor: '#00cc00',
            pointBackgroundColor: 'rgba(0, 204, 0, 0.6)',
            showLine: false
        }
    ];

    // Add Model 3 dataset if we have data
    if (model3Result.lastKnownLevel !== null) {
        datasets.push({
            label: 'Model 3',
            data: model3Result.data,
            borderColor: '#ff4444',
            backgroundColor: 'rgba(255, 68, 68, 0.1)',
            tension: 0.4,
            borderWidth: 2,
            spanGaps: true, // This will connect across null values
            pointStyle: 'circle',
            pointRadius: 3
        });

        // Add Model 3 predictions if available
        if (predictions.model3.some(val => val !== null)) {
            datasets.push({
                label: 'Model 3 (Predicted)',
                data: Array(actualDataCount).fill(null).concat(predictions.model3),
                borderColor: 'transparent',
                backgroundColor: 'rgba(255, 68, 68, 0.3)',
                pointStyle: 'circle',
                pointRadius: 2,
                pointBorderColor: '#ff4444',
                pointBackgroundColor: 'rgba(255, 68, 68, 0.6)',
                showLine: false
            });
        }
    }

    // Add Model X dataset if we have data
    if (modelXResult.lastKnownLevel !== null) {
        datasets.push({
            label: 'Model X',
            data: modelXResult.data,
            borderColor: '#4477ff',
            backgroundColor: 'rgba(68, 119, 255, 0.1)',
            tension: 0.4,
            borderWidth: 2,
            spanGaps: true, // This will connect across null values
            pointStyle: 'circle',
            pointRadius: 3
        });

        // Add Model X predictions if available
        if (predictions.modelX.some(val => val !== null)) {
            datasets.push({
                label: 'Model X (Predicted)',
                data: Array(actualDataCount).fill(null).concat(predictions.modelX),
                borderColor: 'transparent',
                backgroundColor: 'rgba(68, 119, 255, 0.3)',
                pointStyle: 'circle',
                pointRadius: 2,
                pointBorderColor: '#4477ff',
                pointBackgroundColor: 'rgba(68, 119, 255, 0.6)',
                showLine: false
            });
        }
    }

    batteryChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: timeLabels.concat(predictions.labels),
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: {
                        color: '#ffffff'
                    }
                }
            },
            scales: {
                x: {
                    ticks: {
                        color: '#888',
                        maxTicksLimit: 12
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    }
                },
                y: {
                    min: 0,
                    max: 100,
                    ticks: {
                        color: '#888',
                        callback: function (value) {
                            return value + '%';
                        }
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    }
                }
            }
        }
    });
}
