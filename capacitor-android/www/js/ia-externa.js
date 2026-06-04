/*
 * OFICIN-IA — IA Diagnóstico Automotivo modular por oficina
 *
 * Recriação: experiência dentro do OFICIN-IA.
 * - Superadmin libera/bloqueia por tenant.
 * - Usuário/senha são lidos da configuração da oficina.
 * - Sem endpoint/API conhecido, o portal é carregado dentro de uma janela interna (iframe/WebView).
 * - Há tentativa de auto-preenchimento quando o navegador permitir acesso ao frame.
 * - Se o fornecedor bloquear iframe/CORS/X-Frame-Options, o front-end não consegue forçar login; nesse caso é preciso proxy/backend ou app WebView nativo.
 */
(function () {
  'use strict';

  const W = window;
  const D = document;
  const PORTAL_PADRAO = 'https://www.appdiagnosticoautomotivo.com.br/';
  const STORAGE_CACHE_PREFIX = 'thia_diag_auto_cfg_';

  const original = {
    thiaIAAsk: W.thiaIAAsk,
    iaPerguntar: W.iaPerguntar,
    iaEnviar: W.iaEnviar
  };

  let cfgCache = null;
  let cfgLoading = null;

  function txt(v) { return String(v == null ? '' : v).trim(); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }
  function getJ() { return W.J || W.JARVIS || {}; }
  function getTid() {
    const J = getJ();
    return J.tid || J.tenantId || sessionStorage.getItem('j_tid') || localStorage.getItem('j_tid') || '';
  }
  function parseJsonSeguro(v, fallback) {
    try { return JSON.parse(v || 'null') || fallback; } catch (_) { return fallback; }
  }
  function oficinaSessao() {
    return getJ().oficina || parseJsonSeguro(sessionStorage.getItem('j_oficina'), {}) || {};
  }
  function cacheKey() { return STORAGE_CACHE_PREFIX + (getTid() || 'sem_tenant'); }
  function salvarCacheLocal(cfg) { try { localStorage.setItem(cacheKey(), JSON.stringify(cfg || {})); } catch (_) {} }
  function lerCacheLocal() { try { return parseJsonSeguro(localStorage.getItem(cacheKey()), null); } catch (_) { return null; } }

  function normalizarConfig(oficina) {
    oficina = oficina || {};
    const modulos = oficina.modulos || {};
    const integracoes = oficina.integracoes || oficina.integrations || {};
    const raw = integracoes.iaDiagnosticoAutomotivo || oficina.iaDiagnosticoAutomotivo || oficina.diagnosticoAutomotivoIA || {};
    const moduloLiberado = modulos.iaDiagnosticoAutomotivo === true || raw.moduloLiberado === true || raw.ativo === true || raw.enabled === true;
    const ativo = raw.ativo === true || raw.enabled === true || moduloLiberado;
    const endpoint = txt(raw.endpoint || raw.proxyUrl || '');
    return {
      ativo: !!ativo,
      moduloLiberado: !!moduloLiberado,
      modo: endpoint ? 'endpoint' : (raw.modo || raw.mode || 'integrado'),
      portalUrl: txt(raw.portalUrl || raw.url || PORTAL_PADRAO) || PORTAL_PADRAO,
      endpoint,
      usuario: txt(raw.usuario || raw.login || raw.email || ''),
      senha: txt(raw.senha || raw.password || ''),
      autoLogin: raw.autoLogin !== false,
      embedInterno: raw.embedInterno !== false,
      nome: raw.nome || 'Diagnóstico Automotivo',
      atualizadoEm: raw.atualizadoEm || raw.updatedAt || ''
    };
  }

  async function carregarConfigTenant(force) {
    if (cfgCache && !force) return cfgCache;
    if (cfgLoading && !force) return cfgLoading;

    cfgLoading = (async function () {
      let oficina = oficinaSessao();
      const tid = getTid();
      const db = getJ().db || W.db || (W.firebase && W.firebase.firestore ? W.firebase.firestore() : null);

      if (tid && db && db.collection) {
        try {
          const doc = await db.collection('oficinas').doc(tid).get();
          if (doc && doc.exists) {
            oficina = { id: doc.id, ...doc.data() };
            try {
              sessionStorage.setItem('j_oficina', JSON.stringify({
                ...(oficinaSessao() || {}),
                modulos: oficina.modulos || {},
                integracoes: oficina.integracoes || {},
                iaDiagnosticoAutomotivo: oficina.iaDiagnosticoAutomotivo || null
              }));
            } catch (_) {}
          }
        } catch (e) {
          console.warn('[IA Diagnóstico] Não foi possível atualizar config do tenant:', e.message);
        }
      }

      cfgCache = normalizarConfig(oficina);
      const cached = lerCacheLocal();
      if ((!cfgCache.usuario && cached?.usuario) || (!cfgCache.senha && cached?.senha)) {
        cfgCache = { ...cfgCache, usuario: cfgCache.usuario || cached.usuario, senha: cfgCache.senha || cached.senha };
      }
      salvarCacheLocal(cfgCache);
      atualizarBarra();
      return cfgCache;
    })();

    try { return await cfgLoading; }
    finally { cfgLoading = null; }
  }

  function addUser(message) {
    if (typeof W._iaMsgUser === 'function') return W._iaMsgUser(message);
    if (typeof W.adicionarMsgIA === 'function') return W.adicionarMsgIA('user', esc(message));
    const box = D.getElementById('iaMsgs');
    if (!box) return;
    const div = D.createElement('div');
    div.className = 'ia-msg user';
    div.innerHTML = esc(message);
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  }

  function addBot(html) {
    if (typeof W._iaMsgBot === 'function') return W._iaMsgBot(html);
    if (typeof W.adicionarMsgIA === 'function') return W.adicionarMsgIA('bot', html);
    const box = D.getElementById('iaMsgs');
    if (!box) return null;
    const id = 'ia-ext-' + Date.now();
    const div = D.createElement('div');
    div.id = id;
    div.className = 'ia-msg bot';
    div.innerHTML = '<strong>thIAguinho:</strong> ' + html;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
    return id;
  }

  function replaceBot(id, html) {
    const div = id ? D.getElementById(id) : null;
    if (!div) return addBot(html);
    div.innerHTML = '<strong>thIAguinho:</strong> ' + html;
  }

  function montarContexto(perfil) {
    const J = getJ();
    const oficina = oficinaSessao();
    return {
      perfil: perfil || '',
      tenantId: getTid(),
      oficina: {
        nome: oficina.razaoSocial || oficina.nome || oficina.nomeFantasia || '',
        cidade: oficina.cidade || '',
        uf: oficina.uf || ''
      },
      usuario: J.user ? { nome: J.user.nome || J.user.email || '', perfil: J.user.perfil || perfil || '' } : null,
      origem: 'OFICIN-IA'
    };
  }

  async function perguntarEndpoint(pergunta, perfil) {
    const cfg = await carregarConfigTenant();
    if (!cfg.endpoint) throw new Error('Endpoint/proxy da IA Diagnóstico não configurado.');
    const payload = {
      pergunta,
      message: pergunta,
      context: montarContexto(perfil),
      credenciais: { usuario: cfg.usuario, senha: cfg.senha },
      portalUrl: cfg.portalUrl
    };
    const res = await fetch(cfg.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      body: JSON.stringify(payload)
    });
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) throw new Error(data?.erro || data?.message || ('HTTP ' + res.status));
    return data?.resposta || data?.answer || data?.message || data?.texto || '';
  }

  async function tentarAutoLoginNoFrame(iframe, cfg) {
    if (!cfg.usuario || !cfg.senha || cfg.autoLogin === false) return false;
    let doc = null;
    try {
      doc = iframe.contentDocument || iframe.contentWindow.document;
    } catch (e) {
      console.warn('[IA Diagnóstico] Auto-login bloqueado por origem diferente/CORS:', e.message);
      return false;
    }
    if (!doc) return false;

    const camposUsuario = [
      'input[type="email"]', 'input[name*="email" i]', 'input[id*="email" i]',
      'input[name*="usuario" i]', 'input[id*="usuario" i]', 'input[name*="login" i]',
      'input[id*="login" i]', 'input[type="text"]'
    ];
    const camposSenha = ['input[type="password"]', 'input[name*="senha" i]', 'input[id*="senha" i]', 'input[name*="password" i]'];

    const userEl = camposUsuario.map(sel => doc.querySelector(sel)).find(Boolean);
    const passEl = camposSenha.map(sel => doc.querySelector(sel)).find(Boolean);

    function setVal(el, value) {
      if (!el) return;
      el.focus();
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    if (userEl) setVal(userEl, cfg.usuario);
    if (passEl) setVal(passEl, cfg.senha);

    if (userEl && passEl) {
      setTimeout(() => {
        const btn = doc.querySelector('button[type="submit"], input[type="submit"], button, [role="button"]');
        if (btn && cfg.autoLogin !== 'preencher_apenas') {
          try { btn.click(); } catch (_) {}
        }
      }, 450);
      return true;
    }
    return false;
  }

  async function abrirPortalIntegrado(pergunta) {
    const cfg = await carregarConfigTenant(true);
    if (!cfg.moduloLiberado || !cfg.ativo) {
      if (typeof W.toast === 'function') W.toast('IA Diagnóstico bloqueada para esta oficina.', 'warn');
      return;
    }

    const url = cfg.portalUrl || PORTAL_PADRAO;
    const existente = D.getElementById('thiaDiagIaEmbedOverlay');
    if (existente) existente.remove();

    const html = `
      <div id="thiaDiagIaEmbedOverlay" style="position:fixed;inset:0;background:rgba(2,6,23,.88);z-index:999999;display:flex;flex-direction:column;padding:10px;color:var(--text,#e5e7eb);">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;border:1px solid rgba(148,163,184,.25);border-radius:12px 12px 0 0;background:rgba(15,23,42,.96);">
          <div style="min-width:0;">
            <div style="font-weight:900;">IA Diagnóstico Automotivo integrada ao tenant</div>
            <div style="font-size:.72rem;color:var(--muted,#94a3b8);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              ${esc(cfg.usuario || 'usuário não cadastrado')} • ${esc(url)}
            </div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end;">
            <button type="button" class="btn-ghost" onclick="window.thiaCopiarDiagnosticoIA('usuario')">Copiar usuário</button>
            <button type="button" class="btn-ghost" onclick="window.thiaCopiarDiagnosticoIA('senha')">Copiar senha</button>
            <button type="button" class="btn-ghost" onclick="window.thiaRecarregarFrameDiagnosticoIA()">Recarregar</button>
            <button type="button" class="btn-warn" onclick="document.getElementById('thiaDiagIaEmbedOverlay').remove()">Fechar</button>
          </div>
        </div>
        ${pergunta ? `<div style="padding:8px 10px;background:rgba(255,184,0,.08);border-left:1px solid rgba(148,163,184,.25);border-right:1px solid rgba(148,163,184,.25);font-size:.78rem;">Pergunta do OFICIN-IA: <b>${esc(pergunta)}</b></div>` : ''}
        <div id="thiaDiagIaEmbedMsg" style="display:none;padding:8px 10px;background:rgba(239,68,68,.10);border-left:1px solid rgba(148,163,184,.25);border-right:1px solid rgba(148,163,184,.25);font-size:.78rem;"></div>
        <iframe id="thiaDiagIaFrame" src="${esc(url)}" title="Diagnóstico Automotivo" allow="clipboard-read; clipboard-write; fullscreen" referrerpolicy="no-referrer" style="flex:1;width:100%;border:1px solid rgba(148,163,184,.25);border-top:0;border-radius:0 0 12px 12px;background:#fff;"></iframe>
      </div>`;
    D.body.insertAdjacentHTML('beforeend', html);

    const iframe = D.getElementById('thiaDiagIaFrame');
    const msg = D.getElementById('thiaDiagIaEmbedMsg');
    let carregou = false;

    iframe.addEventListener('load', async () => {
      carregou = true;
      const ok = await tentarAutoLoginNoFrame(iframe, cfg);
      if (!ok && msg) {
        msg.style.display = 'block';
        msg.innerHTML =
          'Portal carregado dentro do OFICIN-IA. O auto-login pode ficar bloqueado pelo navegador por segurança quando o site é de outro domínio. ' +
          'Use “Copiar usuário” e “Copiar senha” se os campos não preencherem automaticamente.';
      }
    });

    setTimeout(() => {
      if (!carregou && msg) {
        msg.style.display = 'block';
        msg.innerHTML =
          'Se a área abaixo ficar em branco, o fornecedor bloqueia abertura em iframe. A solução definitiva é criar um proxy/backend ou abrir em WebView nativa no app.';
      }
    }, 3500);
  }

  function copiarTexto(valor, label) {
    if (!valor) {
      if (typeof W.toast === 'function') W.toast(label + ' não cadastrado para esta oficina.', 'warn');
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(valor).then(() => {
        if (typeof W.toast === 'function') W.toast(label + ' copiado.', 'ok');
      }).catch(() => prompt(label, valor));
    } else {
      prompt(label, valor);
    }
  }

  async function copiarCredencial(tipo) {
    const cfg = await carregarConfigTenant();
    if (tipo === 'senha') return copiarTexto(cfg.senha, 'Senha');
    return copiarTexto(cfg.usuario, 'Usuário');
  }

  async function mostrarCredenciais() {
    const cfg = await carregarConfigTenant(true);
    const status = cfg.moduloLiberado && cfg.ativo ? 'Liberado' : 'Bloqueado';
    const senhaMask = cfg.senha ? '••••••••' : 'Não cadastrada';
    const html = `
      <div id="thiaDiagIaOverlay" style="position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:99999;display:flex;align-items:center;justify-content:center;padding:18px;">
        <div style="width:min(720px,96vw);background:var(--surf,#111827);border:1px solid var(--border,#334155);border-radius:14px;padding:18px;color:var(--text,#e5e7eb);box-shadow:0 20px 70px rgba(0,0,0,.45)">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;">
            <div>
              <div style="font-weight:800;font-size:1.05rem;">IA Diagnóstico Automotivo</div>
              <div style="font-size:.78rem;color:var(--muted,#94a3b8);margin-top:4px;">Status do módulo: <b>${esc(status)}</b> • modo: <b>${esc(cfg.endpoint ? 'endpoint' : 'integrado')}</b></div>
            </div>
            <button class="btn-ghost" onclick="document.getElementById('thiaDiagIaOverlay').remove()">✕</button>
          </div>
          <div style="display:grid;gap:10px;margin-top:8px;">
            <div><label style="display:block;font-size:.72rem;color:var(--muted,#94a3b8);margin-bottom:4px;">Portal integrado</label><div class="j-input" style="height:auto;min-height:38px;display:flex;align-items:center;">${esc(cfg.portalUrl || PORTAL_PADRAO)}</div></div>
            <div><label style="display:block;font-size:.72rem;color:var(--muted,#94a3b8);margin-bottom:4px;">Usuário do tenant</label><div style="display:flex;gap:8px;"><div class="j-input" style="height:auto;min-height:38px;display:flex;align-items:center;flex:1;">${esc(cfg.usuario || 'Não cadastrado')}</div><button class="btn-ghost" onclick="window.thiaCopiarDiagnosticoIA('usuario')">Copiar</button></div></div>
            <div><label style="display:block;font-size:.72rem;color:var(--muted,#94a3b8);margin-bottom:4px;">Senha do tenant</label><div style="display:flex;gap:8px;"><div class="j-input" style="height:auto;min-height:38px;display:flex;align-items:center;flex:1;">${esc(senhaMask)}</div><button class="btn-ghost" onclick="window.thiaCopiarDiagnosticoIA('senha')">Copiar</button></div></div>
            <div style="font-size:.72rem;color:var(--muted,#94a3b8);line-height:1.5;background:rgba(148,163,184,.08);padding:10px;border-radius:10px;">
              O OFICIN-IA vai tentar abrir o portal dentro da própria tela e preencher o login. Se o site externo bloquear iframe ou acesso ao formulário por segurança, o navegador não permite auto-login via JavaScript de outro domínio.
            </div>
          </div>
          <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:16px;">
            <button class="btn-ghost" onclick="window.thiaRecarregarConfigDiagnosticoIA()">Recarregar config</button>
            <button class="btn-primary" onclick="document.getElementById('thiaDiagIaOverlay').remove();window.thiaAbrirDiagnosticoAutomotivoIntegrado()">Abrir dentro do OFICIN-IA</button>
          </div>
        </div>
      </div>`;
    D.getElementById('thiaDiagIaOverlay')?.remove();
    D.body.insertAdjacentHTML('beforeend', html);
  }

  async function recarregarConfig() {
    await carregarConfigTenant(true);
    if (typeof W.toast === 'function') W.toast('Configuração da IA Diagnóstico recarregada.', 'ok');
    D.getElementById('thiaDiagIaOverlay')?.remove();
    mostrarCredenciais();
  }

  function recarregarFrame() {
    const iframe = D.getElementById('thiaDiagIaFrame');
    if (iframe) iframe.src = iframe.src;
  }

  async function chamarIA(inputId, perfil) {
    const input = D.getElementById(inputId || 'iaInput');
    const message = txt(input?.value);
    if (!message) return;
    if (input) input.value = '';

    const cfg = await carregarConfigTenant();

    if (!cfg.moduloLiberado || !cfg.ativo) {
      if (typeof original.thiaIAAsk === 'function') {
        if (input) input.value = message;
        return original.thiaIAAsk(inputId || 'iaInput', perfil);
      }
      addUser(message);
      addBot('IA Diagnóstico bloqueada para este tenant. IA local indisponível.');
      return;
    }

    if (cfg.endpoint) {
      addUser(message);
      const lid = addBot('<span class="j-spinner"></span> Consultando IA Diagnóstico Automotivo...');
      try {
        const answer = await perguntarEndpoint(message, perfil);
        W.iaHistorico = W.iaHistorico || [];
        W.iaHistorico.push({ role: 'user', text: message });
        W.iaHistorico.push({ role: 'model', text: answer || '' });
        replaceBot(lid, answer ? esc(answer).replace(/\n/g, '<br>') : 'A IA externa não retornou resposta.');
      } catch (err) {
        replaceBot(lid, 'Não consegui consultar a IA externa agora.<br><small style="color:var(--muted,#94a3b8)">Motivo: ' + esc(err.message || err) + '</small><br><br>Vou responder com a IA local:');
        if (typeof original.thiaIAAsk === 'function') {
          if (input) input.value = message;
          return original.thiaIAAsk(inputId || 'iaInput', perfil);
        }
      }
      return;
    }

    addUser(message);
    addBot(
      '<b>IA Diagnóstico Automotivo liberada para este tenant.</b><br>' +
      'Como ainda não temos endpoint/API, vou abrir o portal dentro do OFICIN-IA usando as credenciais configuradas no Superadmin.<br><br>' +
      '<button class="btn-primary" onclick="window.thiaAbrirDiagnosticoAutomotivoIntegrado(' + JSON.stringify(message).replace(/"/g, '&quot;') + ')">Abrir IA integrada</button> ' +
      '<button class="btn-ghost" onclick="window.thiaMostrarCredenciaisDiagnosticoIA()">Ver status</button><br><br>' +
      '<small style="color:var(--muted,#94a3b8)">Se o fornecedor bloquear iframe ou auto-login por segurança, será necessário proxy/backend para login 100% transparente.</small>'
    );
    abrirPortalIntegrado(message);

    if (typeof original.thiaIAAsk === 'function') {
      if (input) input.value = message;
      return original.thiaIAAsk(inputId || 'iaInput', perfil);
    }
  }

  async function atualizarBarra() {
    const cfg = cfgCache || normalizarConfig(oficinaSessao());
    const ativo = cfg.moduloLiberado && cfg.ativo;
    const endpoint = !!cfg.endpoint;
    const texto = ativo ? (endpoint ? 'IA Diagnóstico conectada por endpoint' : 'IA Diagnóstico integrada ao tenant') : 'IA Diagnóstico bloqueada';
    const cor = ativo ? 'var(--success,#22c55e)' : 'var(--muted,#94a3b8)';
    const conteudo = `
      <span id="thiaDiagIaStatus" style="padding:5px 9px;border-radius:999px;border:1px solid rgba(148,163,184,.25);color:${cor};">${esc(texto)}</span>
      <button type="button" class="btn-primary" onclick="window.thiaAbrirDiagnosticoAutomotivoIntegrado()">Abrir IA dentro do sistema</button>
      <button type="button" class="btn-ghost" onclick="window.thiaMostrarCredenciaisDiagnosticoIA()">Credenciais / status</button>
    `;

    const inline = D.getElementById('thiaDiagIaInlineStatus');
    if (inline) {
      inline.innerHTML = conteudo;
      inline.style.display = 'flex';
      return;
    }

    const host = D.getElementById('iaMsgs')?.parentElement || D.getElementById('s-ia') || D.getElementById('t-ia');
    if (!host) return;
    let bar = D.getElementById('thiaDiagIaBar');
    if (!bar) {
      bar = D.createElement('div');
      bar.id = 'thiaDiagIaBar';
      bar.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 12px;border-bottom:1px solid rgba(148,163,184,.18);background:rgba(15,23,42,.45);font-size:.75rem;';
      const msgs = D.getElementById('iaMsgs');
      if (msgs && msgs.parentElement) msgs.parentElement.insertBefore(bar, msgs);
      else host.prepend(bar);
    }
    bar.innerHTML = conteudo;
  }

  W.thiaDiagnosticoIA = {
    portalUrl: PORTAL_PADRAO,
    carregarConfig: carregarConfigTenant,
    montarContexto,
    perguntar: perguntarEndpoint,
    abrirIntegrado: abrirPortalIntegrado
  };

  W.thiaIAAsk = chamarIA;
  W.iaPerguntar = function () { return chamarIA('iaInput', 'jarvis'); };
  W.iaEnviar = function () { return chamarIA('iaInput', 'equipe'); };
  W.thiaAbrirDiagnosticoAutomotivo = abrirPortalIntegrado;
  W.thiaAbrirDiagnosticoAutomotivoIntegrado = abrirPortalIntegrado;
  W.thiaMostrarCredenciaisDiagnosticoIA = mostrarCredenciais;
  W.thiaCopiarDiagnosticoIA = copiarCredencial;
  W.thiaRecarregarConfigDiagnosticoIA = recarregarConfig;
  W.thiaRecarregarFrameDiagnosticoIA = recarregarFrame;

  D.addEventListener('DOMContentLoaded', function () {
    setTimeout(function () { carregarConfigTenant(false); atualizarBarra(); }, 120);
  });
})();
