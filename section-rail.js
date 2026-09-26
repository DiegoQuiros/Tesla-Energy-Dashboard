// Section rail (right edge, styled in section-rail.css): clicking or resting the
// mouse on an icon scrolls that card into place, and the icon of the card on
// screen is marked aria-current.
//
// The links are plain #id anchors so they still work if this file fails to load,
// but a click is taken over and done with scrollIntoView instead: the jump is
// smooth, and no #hash is left in the URL (a reload would re-jump to it). It lands
// on the same spot either way — the card's snap position just under the top band,
// since both honor html's scroll-padding-top.
(function () {
    const rail = document.getElementById('sectionRail');
    if (!rail) return;
    const links = [...rail.querySelectorAll('a.rail-item')];
    const cards = links.map(a => document.getElementById(a.hash.slice(1)));
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    function scrollToCard(link) {
        const card = link && document.getElementById(link.hash.slice(1));
        if (card) card.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'start' });
        return !!card;
    }

    rail.addEventListener('click', e => {
        const link = e.target.closest('a.rail-item');
        if (scrollToCard(link)) e.preventDefault();
    });

    // Hovering an item scrolls to its card too, once the pointer rests on it for a
    // moment — so sweeping up or down the rail to reach an item doesn't drag the
    // page through every card on the way. Mouse only: a touch "hover" is the tap,
    // which the click handler already covers.
    const HOVER_DWELL_MS = 150;
    let hoverTimer = null;
    rail.addEventListener('pointerover', e => {
        if (e.pointerType !== 'mouse') return;
        const link = e.target.closest('a.rail-item');
        if (!link || link.contains(e.relatedTarget)) return;
        clearTimeout(hoverTimer);
        hoverTimer = setTimeout(() => scrollToCard(link), HOVER_DWELL_MS);
    });
    // Leaving an item (to the gap, another item, or off the rail) cancels a pending scroll
    rail.addEventListener('pointerout', e => {
        const link = e.target.closest('a.rail-item');
        if (link && !link.contains(e.relatedTarget)) clearTimeout(hoverTimer);
    });

    // A hidden card (the alerts card when there are no alerts) hides its icon too
    function syncHidden() {
        links.forEach((link, i) => { link.hidden = !cards[i] || cards[i].hidden; });
    }

    // The card on screen is the last one whose top edge is above mid-screen: once
    // snapped, that's the one filling the view, and mid-scroll it flips halfway over.
    function markCurrent() {
        const mid = window.innerHeight / 2;
        let current = null;
        cards.forEach((card, i) => {
            if (!card || links[i].hidden || !card.getClientRects().length) return;
            if (card.getBoundingClientRect().top <= mid) current = links[i];
        });
        for (const link of links) {
            if (link === current) link.setAttribute('aria-current', 'true');
            else link.removeAttribute('aria-current');
        }
    }

    let queued = false;
    function queueMark() {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => { queued = false; markCurrent(); });
    }

    window.addEventListener('scroll', queueMark, { passive: true });
    window.addEventListener('resize', queueMark);
    // Cards also move without a scroll: when the dashboard first appears after
    // loading, and when one collapses/expands or the alerts card comes and goes
    // (each changes #dashboard's height).
    const dashboard = document.getElementById('dashboard');
    if (dashboard && 'ResizeObserver' in window) new ResizeObserver(queueMark).observe(dashboard);
    const hiddenWatcher = new MutationObserver(() => { syncHidden(); queueMark(); });
    for (const card of cards) {
        if (card) hiddenWatcher.observe(card, { attributes: true, attributeFilter: ['hidden'] });
    }

    syncHidden();
    markCurrent();
})();
