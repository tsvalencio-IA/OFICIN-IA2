/**
 * thIAguinho ERP â€” Service Worker
 *
 * Permite que o sistema funcione como PWA (Progressive Web App):
 *  â€¢ Cliente pode "instalar" o site como Ã­cone na tela do celular
 *  â€¢ Funciona offline parcialmente (cache dos arquivos visitados)
 *  â€¢ AtualizaÃ§Ã£o automÃ¡tica quando volta online
 *
 * EstratÃ©gia: Network First com fallback para Cache.
 * Isso garante que o cliente sempre vÃª a versÃ£o mais nova quando online,
 * mas continua tendo acesso ao Ãºltimo estado conhecido se cair internet.
 *
 * Powered by thIAguinho SoluÃ§Ãµes Digitais
 */
const CACHE_VERSION = 'thiaguinho-cotacao-tecnica-20260514-24';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

// Arquivos crÃ­ticos que prÃ©-carregamos na instalaÃ§Ã£o
const PRECACHE_URLS_RAW = [
  './',
  './selecionar-perfil.html',
  './index.html',
  './jarvis.html',
  './equipe.html',
  './cliente.html',
  './clienteOficial.html',
  './c.html',
  './cotacao.html',
  './superadmin.html',
  './manifest.json',
  './favicon.ico',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './css/design.css',
  './js/core.js',
  './js/clientes.js',
  './js/ia.js',
  './js/financeiro.js',
  './js/nfe-real-pro.js',
  './js/cotacoes.js',
  './js/cotacao-fornecedor.js',
  './js/exportar-pmsp.js',
  './js/os.js',
  './js/os-utils.js',
  './js/tabela-tempa.js',
  './js/ui.js',
  './js/pdf.js',
  './js/config.js',
  './js/links-publicos.js',
  './js/hardening-comercial.js',
  './js/uix-theme-fix.js',
  './js/theme.js',
  './js/fiscal.js',
  './js/final-1010-regras-os.js',
  './js/importar-orcamento-os.js',
  './js/assinatura-os.js',
  './assets/templates/I-30003_PLANILHA_DE_CUSTOS.xlsx',
  './data/tabela-tempa.min.json',
  './elm327-service.js',
  './elm-bridge.js'
];
const SW_BASE = self.location.pathname.includes('/js/service-worker.js') ? '../' : './';
const PRECACHE_URLS = PRECACHE_URLS_RAW.map(url => url === './' ? SW_BASE : SW_BASE + url.replace(/^\.\//, ''));

// â”€â”€ INSTALL: prÃ©-carrega arquivos crÃ­ticos â”€â”€
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        // addAll falha se UM arquivo falhar; usar add() individual + catch Ã© mais robusto
        return Promise.all(
          PRECACHE_URLS.map(url =>
            cache.add(url).catch(err => console.warn('SW skip:', url, err.message))
          )
        );
      })
      .then(() => self.skipWaiting())
  );
});

// â”€â”€ ACTIVATE: limpa caches antigos â”€â”€
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter(key => !key.startsWith(CACHE_VERSION))
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// â”€â”€ FETCH: Network First, depois Cache â”€â”€
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Pula requisiÃ§Ãµes que nÃ£o sÃ£o GET
  if (request.method !== 'GET') return;

  // Pula chamadas para Firebase/Cloudinary/Gemini (sempre online)
  const url = new URL(request.url);
  if (
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('cloudinary.com') ||
    url.hostname.includes('generativelanguage.googleapis.com') ||
    url.hostname.includes('gstatic.com')
  ) {
    return; // deixa o browser fazer normal sem cache
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Salva uma cÃ³pia no cache runtime para uso offline
        if (response && response.status === 200 && response.type === 'basic') {
          const responseClone = response.clone();
          caches.open(RUNTIME_CACHE).then(cache => cache.put(request, responseClone));
        }
        return response;
      })
      .catch(() => {
        // Sem internet: tenta cache
        return caches.match(request).then(cached => {
          if (cached) return cached;
          // Nem cache nem internet: fallback simples
          if (request.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
      })
  );
});

/* Powered by thIAguinho SoluÃ§Ãµes Digitais */
