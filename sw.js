// Service worker for phone alerts — nothing else. The collector (PhoneAlertManager.cs)
// sends web-push messages; this turns each into a notification and opens the dashboard
// when one is tapped. There is deliberately no fetch handler: the dashboard's own requests
// never pass through here, so this can't serve stale files the way a caching worker would.

self.addEventListener('push', event => {
    let message = {};
    try {
        message = event.data ? event.data.json() : {};
    } catch {
        message = { body: event.data ? event.data.text() : '' };
    }
    // iOS revokes push permission from a web app that receives a push without showing a
    // notification, so every push shows one.
    event.waitUntil(self.registration.showNotification(message.title || 'Energy Dashboard', {
        body: message.body || '',
        tag: message.tag,
        icon: 'icon-192.png',
        data: { url: new URL(message.url || './', self.registration.scope).href }
    }));
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    event.waitUntil((async () => {
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const open = windows.find(w => w.url.startsWith(self.registration.scope));
        if (open) return open.focus();
        return self.clients.openWindow(event.notification.data.url);
    })());
});
