self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const relative = event.notification?.data?.url || '/MycoMap/';
  const target = new URL(relative, self.location.origin).href;

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      try {
        if ('navigate' in client) await client.navigate(target);
        await client.focus();
        return;
      } catch {
        // On tente la fenêtre suivante puis openWindow.
      }
    }
    await self.clients.openWindow(target);
  })());
});
