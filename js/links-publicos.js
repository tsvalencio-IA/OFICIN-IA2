/*
 * Configuracao central dos links publicos do SaaS.
 * Preencha os valores abaixo depois que o novo GitHub Pages/Vercel estiver definido.
 */
(function () {
  'use strict';

  const PLACEHOLDER_BASE = '';

  window.THIA_PUBLIC_LINKS = Object.assign({
    baseUrl: PLACEHOLDER_BASE,
    cliente: '',
    clienteOficial: '',
    cotacaoFornecedor: '',
    cotacaoFornecedorCurta: '',
    usarLinkCurtoCotacao: true,
    incluirFirebaseConfigNoLink: false,
    qrCliente: '',
    apkShareBase: ''
  }, window.THIA_PUBLIC_LINKS || {});

  function cleanBase(url) {
    return String(url || '').trim().replace(/\/+$/, '');
  }

  function runtimeBase() {
    try {
      const loc = window.location || {};
      if (!/^https?:$/i.test(loc.protocol || '')) return '';
      const path = String(loc.pathname || '/');
      const dir = path.endsWith('/') ? path : path.slice(0, path.lastIndexOf('/') + 1);
      return cleanBase(loc.origin + dir);
    } catch (_) {
      return '';
    }
  }

  function joinUrl(base, path) {
    base = cleanBase(base);
    path = String(path || '').replace(/^\/+/, '');
    if (!base) return path || '';
    return path ? `${base}/${path}` : base;
  }

  window.thiaGetPublicUrl = function (kind, params) {
    const cfg = window.THIA_PUBLIC_LINKS || {};
    const base = cleanBase(cfg.baseUrl) || runtimeBase();
    let url = '';

    if (kind === 'cotacaoFornecedor') url = cfg.cotacaoFornecedorCurta || cfg.cotacaoFornecedor || joinUrl(base, cfg.usarLinkCurtoCotacao === false ? 'cotacao.html' : 'c.html');
    else if (kind === 'clienteOficial') url = cfg.clienteOficial || joinUrl(base, 'clienteOficial.html');
    else if (kind === 'qrCliente') url = cfg.qrCliente || cfg.cliente || joinUrl(base, 'cliente.html');
    else url = cfg.cliente || joinUrl(base, 'cliente.html');

    if (!url) {
      const page = kind === 'cotacaoFornecedor' ? 'cotacao.html' : (kind === 'clienteOficial' ? 'clienteOficial.html' : 'cliente.html');
      url = page;
    }

    const qp = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value) !== '') qp.set(key, String(value));
    });
    const qs = qp.toString();
    return qs ? `${url}${url.includes('?') ? '&' : '?'}${qs}` : url;
  };
})();
