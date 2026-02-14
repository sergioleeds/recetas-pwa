const CACHE_NAME = 'recipe-pwa-v6';
const ASSETS = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './importer.js',
    './manifest.json',
    './icon-192.png'
];

// Install: cache assets
self.addEventListener('install', (e) => {
    console.log('SW: Installing new version');
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('SW: Caching assets');
            return cache.addAll(ASSETS);
        }).then(() => self.skipWaiting()) // Force activate immediately
    );
});

// Activate: clean old caches
self.addEventListener('activate', (e) => {
    console.log('SW: Activating new version');
    e.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('SW: Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim()) // Take control immediately
    );
});

// Fetch: Network First for HTML/JS/CSS, Cache First for others
self.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url);
    
    // Network First for app files (always get latest)
    if (url.pathname.endsWith('.html') || 
        url.pathname.endsWith('.js') || 
        url.pathname.endsWith('.css')) {
        e.respondWith(
            fetch(e.request)
                .then((response) => {
                    // Cache the new version
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(e.request, responseClone);
                    });
                    return response;
                })
                .catch(() => caches.match(e.request)) // Fallback to cache if offline
        );
    } else {
        // Cache First for other resources
        e.respondWith(
            caches.match(e.request).then((response) => response || fetch(e.request))
        );
    }
});
