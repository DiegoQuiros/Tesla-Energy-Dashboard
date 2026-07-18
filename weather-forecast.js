// 7-day forecast from the National Weather Service (same source as EnergyDataCollector)
const WEATHER_LAT = '33.901084';
const WEATHER_LON = '-117.179254';

function forecastEmoji(shortForecast, isDaytime) {
    const f = (shortForecast || '').toLowerCase();
    if (f.includes('thunder')) return '⛈️';
    if (f.includes('snow') || f.includes('ice') || f.includes('sleet')) return '❄️';
    if (f.includes('rain') || f.includes('shower') || f.includes('drizzle')) return '🌧️';
    if (f.includes('fog') || f.includes('haze') || f.includes('smoke')) return '🌫️';
    if (f.includes('mostly cloudy') || f.includes('overcast')) return '☁️';
    if (f.includes('partly')) return '⛅';
    if (f.includes('cloud')) return '🌥️';
    if (f.includes('wind')) return '💨';
    if (f.includes('sunny') || f.includes('clear')) return isDaytime ? '☀️' : '🌙';
    return isDaytime ? '🌤️' : '🌙';
}

async function loadWeatherForecast() {
    const container = document.getElementById('weatherForecast');
    if (!container) return;

    try {
        const pointsResponse = await fetch(`https://api.weather.gov/points/${WEATHER_LAT},${WEATHER_LON}`);
        const points = await pointsResponse.json();
        const forecastResponse = await fetch(points.properties.forecast);
        const forecast = await forecastResponse.json();
        const periods = forecast.properties.periods || [];

        // NWS returns alternating day/night periods; fold each pair into one day
        const days = [];
        for (const period of periods) {
            if (period.isDaytime) {
                days.push({
                    name: period.name,
                    high: period.temperature,
                    low: null,
                    icon: forecastEmoji(period.shortForecast, true),
                    desc: period.shortForecast
                });
            } else if (days.length > 0 && days[days.length - 1].low === null) {
                days[days.length - 1].low = period.temperature;
            } else {
                // Forecast starts in the evening: only tonight's period exists for day one
                days.push({
                    name: period.name === 'Tonight' ? 'Today' : period.name.replace(' Night', ''),
                    high: null,
                    low: period.temperature,
                    icon: forecastEmoji(period.shortForecast, false),
                    desc: period.shortForecast
                });
            }
        }

        container.innerHTML = days.slice(0, 7).map(day => `
            <div class="forecast-day" title="${day.desc.replace(/"/g, '&quot;')}">
                <div class="forecast-day-name">${day.name}</div>
                <div class="forecast-icon">${day.icon}</div>
                <div class="forecast-temps">
                    <span class="forecast-high">${day.high !== null ? `${day.high}°` : '--'}</span>
                    <span class="forecast-low">${day.low !== null ? `${day.low}°` : ''}</span>
                </div>
                <div class="forecast-desc">${day.desc}</div>
            </div>`).join('');
    } catch (error) {
        console.warn('Weather forecast unavailable:', error);
        container.innerHTML = '<div style="color: #b0c4de;">7-day forecast unavailable</div>';
    }
}

document.addEventListener('DOMContentLoaded', loadWeatherForecast);
