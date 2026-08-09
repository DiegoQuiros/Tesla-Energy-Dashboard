// Measures the fixed top band and publishes its height as --topbar-h, and marks
// the "last updated" pill .band-crowded when the expanded navigator would cover it.
//
// The band holds the time navigator (centered, collapsible -> its height changes)
// and the "last updated" pill (left). Both are position:fixed, so they take no
// flow space; .container reserves the band with an equal top padding and every
// card is sized to `100svh - --topbar-h - --card-gap` (see indexStyleSheet.css),
// which is what makes exactly one card fill the screen.
//
// The band is always ONE row: both elements share it and the height is the taller
// of the two. That keeps --topbar-h small — growing it shrinks every card on the
// page — which is why a crowded pill hides instead of moving somewhere roomier.
//
// On phones the navigator is display:none, so the band shrinks to just the pill.
(function () {
    const FALLBACK_PX = 30;
    // Gap the expanded navigator must leave beside the pill before they read as crowded
    const PILL_CLEARANCE_PX = 12;
    const IDS = ['timeNavigator', 'lastUpdated'];
    const observed = new WeakSet();
    const resizeObserver = 'ResizeObserver' in window ? new ResizeObserver(apply) : null;
    let lastPx = null;

    function apply() {
        const navEl = document.getElementById('timeNavigator');
        const pillEl = document.getElementById('lastUpdated');
        for (const el of [navEl, pillEl]) {
            if (!el) continue;
            if (resizeObserver && !observed.has(el)) {
                observed.add(el);
                resizeObserver.observe(el);
            }
        }
        // display:none elements (the navigator on phones) measure 0 and are skipped
        const navRect = navEl ? navEl.getBoundingClientRect() : null;
        const pillRect = pillEl ? pillEl.getBoundingClientRect() : null;
        const navHeight = navRect ? navRect.height : 0;
        const pillHeight = pillRect ? pillRect.height : 0;

        // Both sit on the same single row, so the band is only as tall as the
        // taller of the two. Stacking them would grow --topbar-h and shrink
        // every card on the page.
        // + 4px top inset + 4px breathing room below
        const px = Math.round(Math.max(navHeight, pillHeight) + 8) || FALLBACK_PX;
        if (px !== lastPx) {
            lastPx = px;
            document.documentElement.style.setProperty('--topbar-h', `${px}px`);
        }

        // Expanded, the centered navigator is wide enough to reach the pill's
        // left-hand spot on a narrow viewport. There is nowhere to move the pill
        // to without growing the band, so it hides — but only when the measured
        // boxes actually overlap, not on every expand.
        if (pillEl) {
            const expanded = navHeight > 0 && !navEl.classList.contains('collapsed');
            const overlaps = expanded && navRect.left < pillRect.right + PILL_CLEARANCE_PX
                && navRect.top < pillRect.bottom && navRect.bottom > pillRect.top;
            pillEl.classList.toggle('band-crowded', overlaps);
        }
    }

    // The navigator is built by time-navigator.js at runtime, so wait for it to
    // appear rather than assuming it exists when this file runs. Once both band
    // elements are attached, the ResizeObserver covers every later change and
    // this (expensive, whole-document) watcher is no longer needed.
    const waitForBand = new MutationObserver(() => {
        apply();
        if (IDS.every(id => document.getElementById(id))) waitForBand.disconnect();
    });
    waitForBand.observe(document.documentElement, { childList: true, subtree: true });

    window.addEventListener('resize', apply);
    window.addEventListener('orientationchange', apply);
    // Expanding/collapsing the navigator changes the band's height. The
    // ResizeObserver already covers that, but it is only delivered as part of a
    // rendering update, so re-measure straight after any click in the band too.
    document.addEventListener('click', e => {
        if (e.target.closest && e.target.closest('#timeNavigator')) requestAnimationFrame(apply);
    }, true);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
    apply();
})();
