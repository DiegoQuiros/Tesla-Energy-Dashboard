// Ctrl + mouse wheel zooms every chart on both axes around the cursor, dragging
// pans it, and a double-click resets it. Set once on Chart.defaults so every chart gets it.
//
// The charts are destroyed and rebuilt on each data refresh, which would throw a
// zoom away every few minutes; the zoomed ranges are carried across instead.
//
// Pan and pinch stay off on touch screens: Hammer claims the touch gesture there
// and the page could no longer scroll past a chart.

(function () {
    if (typeof Chart === 'undefined') return;
    if (window.ChartZoom) Chart.register(window.ChartZoom);

    const finePointer = window.matchMedia && window.matchMedia('(pointer: fine)').matches;

    Chart.defaults.set('plugins.zoom', {
        zoom: {
            wheel: { enabled: true, modifierKey: 'ctrl', speed: 0.15 },
            pinch: { enabled: false },
            mode: 'xy'
        },
        pan: { enabled: finePointer, mode: 'xy' },
        limits: {
            x: { min: 'original', max: 'original', minRange: 2 },
            y: { min: 'original', max: 'original' }
        }
    });

    // canvas id → { scaleId: { min, max[, minLabel, maxLabel] } } of the last zoom.
    // The category x axis is kept by label (the slots shift as samples arrive);
    // value axes by value.
    const savedRanges = {};

    function labelAt(chart, i) {
        const labels = chart.data.labels || [];
        return JSON.stringify(labels[i]);
    }

    function indexOfLabel(chart, label, hint) {
        const labels = (chart.data.labels || []).map(l => JSON.stringify(l));
        if (labels[hint] === label) return hint;
        return labels.indexOf(label);
    }

    Chart.register({
        id: 'zoomKeeper',
        afterInit(chart) {
            // The canvas outlives its charts, so listen once and act on whichever is live
            const canvas = chart.canvas;
            if (canvas.$zoomResetBound) return;
            canvas.$zoomResetBound = true;
            canvas.addEventListener('dblclick', () => {
                const live = Chart.getChart(canvas);
                if (live && live.isZoomedOrPanned && live.isZoomedOrPanned()) live.resetZoom();
            });
        },
        afterUpdate(chart) {
            if (chart.$zoomRestored) return;
            chart.$zoomRestored = true;
            const saved = savedRanges[chart.canvas.id];
            if (!saved || !chart.zoomScale) return;
            Object.entries(saved).forEach(([id, r]) => {
                if (!chart.scales[id]) return;
                let { min, max } = r;
                if (r.minLabel !== undefined) {
                    min = indexOfLabel(chart, r.minLabel, r.min);
                    max = indexOfLabel(chart, r.maxLabel, r.max);
                    if (min < 0) return;
                }
                if (max > min) chart.zoomScale(id, { min, max }, 'none');
            });
        },
        beforeDestroy(chart) {
            const id = chart.canvas && chart.canvas.id;
            if (!id) return;
            if (!(chart.isZoomedOrPanned && chart.isZoomedOrPanned())) {
                delete savedRanges[id];
                return;
            }
            // Only the axes actually zoomed — an untouched y axis keeps auto-fitting
            const zoomed = chart.getZoomedScaleBounds ? chart.getZoomedScaleBounds() : chart.scales;
            const ranges = {};
            Object.keys(zoomed).forEach(scaleId => {
                const scale = chart.scales[scaleId];
                if (!scale) return;
                if (scale.type === 'category') {
                    const min = Math.round(scale.min), max = Math.round(scale.max);
                    ranges[scale.id] = { min, max, minLabel: labelAt(chart, min), maxLabel: labelAt(chart, max) };
                } else {
                    ranges[scale.id] = { min: scale.min, max: scale.max };
                }
            });
            savedRanges[id] = ranges;
        }
    });
})();
