// Phone alerts: the 🔕/🔔 button in the Energy Flow header subscribes this device to the
// collector's web-push alerts (PhoneAlertManager.cs): the Powerwall back on the grid and
// ready to go off-grid again, or a car charging while on grid. sw.js shows them.
//
// iPhone: web push only reaches a dashboard opened from its Home Screen icon (iOS 16.4+), so
// in plain Safari the button explains how to add it.
//
// Turning alerts on hands the browser's PushSubscription to the collector by creating one
// blob in a private container, through the upload-only URL in push-config.json (written by
// `dotnet run -- push-setup`). The blob is named after a hash of the endpoint, so handing the
// same subscription over again is a harmless "already stored".

(function () {
    const button = document.getElementById('alertsButton');
    if (!button) return;

    const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

    let current = null; // this device's PushSubscription, once known

    function show(on) {
        button.textContent = on ? '🔔 Alerts on' : '🔕 Alerts';
        button.classList.toggle('on', on);
        button.title = on
            ? 'Phone alerts are on for this device. Tap to turn them off.'
            : 'Get a notification when the Powerwall is back on the grid';
    }

    function fromBase64Url(s) {
        const b64 = (s + '='.repeat((4 - s.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/');
        return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    }

    function toBase64Url(buffer) {
        return btoa(String.fromCharCode(...new Uint8Array(buffer)))
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    async function pushConfig() {
        const response = await fetch(PUSH_CONFIG_URL, { cache: 'no-store' });
        if (!response.ok) throw new Error(`push-config.json: HTTP ${response.status}`);
        return response.json();
    }

    // 201 = stored. The upload URL may create but never overwrite, so a subscription stored
    // earlier comes back 403 UnauthorizedBlobOverwrite — success too. (An expired or revoked
    // URL is a 403 with AuthenticationFailed instead.)
    async function upload(subscription, config) {
        const json = subscription.toJSON();
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json.endpoint));
        const name = Array.from(new Uint8Array(digest).slice(0, 16), b => b.toString(16).padStart(2, '0')).join('');
        const [container, sas] = config.subscriptionUploadUrl.split('?');
        const response = await fetch(`${container}/${name}.json?${sas}`, {
            method: 'PUT',
            headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': 'application/json', 'If-None-Match': '*' },
            body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, createdUtc: new Date().toISOString() })
        });
        const storedEarlier = response.status === 409
            || response.headers.get('x-ms-error-code') === 'UnauthorizedBlobOverwrite';
        if (!response.ok && !storedEarlier) throw new Error(`saving the subscription: HTTP ${response.status}`);
    }

    async function enable() {
        // First, straight from the tap: Safari shows the permission prompt only inside a user gesture.
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            alert('Notifications are blocked for this dashboard. Allow them in Settings → Notifications, then try again.');
            return;
        }
        const [config, registration] = await Promise.all([pushConfig(), navigator.serviceWorker.ready]);
        let subscription = await registration.pushManager.getSubscription();
        const key = subscription && subscription.options && subscription.options.applicationServerKey;
        if (key && toBase64Url(key) !== config.vapidPublicKey) {
            // Subscribed under keys the collector no longer signs with.
            await subscription.unsubscribe();
            subscription = null;
        }
        subscription = subscription || await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: fromBase64Url(config.vapidPublicKey)
        });
        await upload(subscription, config);
        current = subscription;
        show(true);
    }

    async function disable() {
        if (!confirm('Turn off phone alerts on this device?')) return;
        await current.unsubscribe();
        // The collector deletes its copy the first time the push service reports it gone.
        current = null;
        show(false);
    }

    button.addEventListener('click', async () => {
        if (!supported) {
            alert(isIos && !standalone
                ? 'To get alerts on iPhone: tap Share → Add to Home Screen, open the dashboard from that icon, then tap 🔕 Alerts again.'
                : "This browser can't receive push alerts.");
            return;
        }
        button.disabled = true;
        try {
            if (current && Notification.permission === 'granted') await disable();
            else await enable();
        } catch (err) {
            console.error('Phone alerts:', err);
            alert(`Couldn't turn alerts on: ${err.message}`);
        } finally {
            button.disabled = false;
        }
    });

    show(false);
    if (!supported) {
        button.hidden = !(isIos && !standalone);
        return;
    }

    navigator.serviceWorker.register('sw.js')
        .then(() => navigator.serviceWorker.ready)
        .then(registration => registration.pushManager.getSubscription())
        .then(subscription => {
            if (!subscription || Notification.permission !== 'granted') return;
            current = subscription;
            show(true);
            // Hand it over again in case the first upload never arrived.
            return pushConfig().then(config => upload(subscription, config));
        })
        .catch(err => console.warn('Phone alerts:', err.message || err));
})();
