// Keeps every card in .charts-grid the same height as the Energy Flow hero
// card, so scroll-snapping between cards reads as flipping full-height pages.
// A ResizeObserver (rather than load/resize listeners) tracks the hero card's
// actual rendered size, since it settles asynchronously as data loads.
(function () {
    const reference = document.querySelector('.energy-flow-section');
    if (!reference) return;

    function apply() {
        const height = reference.getBoundingClientRect().height;
        if (!height) return;
        document.documentElement.style.setProperty('--card-height', `${height}px`);
    }

    new ResizeObserver(apply).observe(reference);
})();
