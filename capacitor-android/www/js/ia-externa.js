/*
 * OFICIN-IA — IA Diagnóstico Automotivo modular por oficina
 *
 * Versão recriada para cenário sem endpoint conhecido.
 * - O Superadmin libera/bloqueia por tenant.
 * - O Superadmin pode guardar login/senha por oficina.
 * - Sem endpoint/API oficial, o sistema não força automação de login.
 * - O chat mantém IA local e oferece acesso ao portal externo com credenciais do tenant.
 * - Quando um endpoint/proxy seguro existir, basta salvar endpoint no tenant.
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

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  function txt(v) { return String(v == null ? '' : v).trim(); }

  function getJ() { return W.J || {}; }

  function getTid() {
    const J = getJ();
    return J.tid || J.tenantId || sessionStorage.getItem('j_tid') || '';
  }

  function parseJsonSeguro(v, fallback) {
    try { return JSON.parse(v || 'null') || fallback; } catch (_) { return fallback; }
  }

  function oficinaSessao() {
    return getJ().oficina || parseJsonSeguro(sessionStorage.getItem('j_oficina'), {}) || {};
  }

  function normalizarConfig(oficina) {
    oficina = oficina || {};
    const modulos = oficina.modulos || {};
    const integracoes = oficina.integracoes || oficina.integrations || {};
    const raw = integracoes.iaDiagnosticoAutomotivo || oficina.iaDiagnosticoAutomotivo || oficina.diagnosticoAutomotivoIA || {};

    const moduloLiberado = modulos.iaDiagnosticoAutomotivo === true || raw.ativo === true || raw.enabled === true;
    const ativo = raw.ativo === true || raw.enabled === true || moduloLiberado;

    return {
      ativo: !!ativo,
      moduloLiberado: !!moduloLiberado,
      modo: raw.modo || raw.mode || 'portal',
      portalUrl: txt(raw.portalUrl || raw.url || PORTAL_PADRAO) || PORTAL_PADRAO,
      endpoint: txt(raw.endpoint || raw.proxyUrl || ''),
      usuario: txt(raw.usuario || raw.login || raw.email || ''),
      senha: txt(raw.senha || raw.password || ''),
      nome: raw.nome || 'Diagnóstico Automotivo',
      atualizadoEm: raw.atualizadoEm || raw.updatedAt || ''
    };
  }

  function cacheKey() {
    return STORAGE_CACHE_PREFIX + (getTid() || 'sem_tenant');
  }

  function salvarCacheLocal(cfg) {
    try { localStorage.setItem(cacheKey(), JSON.stringify(cfg || {})); } catch (_) {}
  }

  function lerCacheLocal() {
    try { return parseJsonSeguro(localStorage.getItem(cacheKey()), null); } catch (_) { return null; }
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
    if (typeof W._iaReplace === 'function' && id) return W._iaReplace(id, html);
    const el = id ? D.getElementById(id) : null;
    if (el) el.innerHTML = '<strong>thIAguinho:</strong> ' + html;
  }

  function montarContexto() {
    const J = getJ();
    const os = Array.isArray(J.os) ? J.os : (Array.isArray(W.dbOS) ? W.dbOS : []);
    const clientes = Array.isArray(J.clientes) ? J.clientes : (Array.isArray(W.dbClientes) ? W.dbClientes : []);
    const veiculos = Array.isArray(J.veiculos) ? J.veiculos : (Array.isArray(W.dbVeiculos) ? W.dbVeiculos : []);

    const abertas = os
      .filter(o => !/finaliz|entreg|cancel/i.test(String(o.status || '')))
      .slice(0, 12)
      .map(o => ({
        id: o.id || '',
        numero: o.numero || '',
        status: o.status || '',
        placa: o.placa || '',
        defeito: o.defeito || o.diagnostico || o.observacoes || '',
        servicos: Array.isArray(o.servicos) ? o.servicos.slice(0, 10).map(s => s.desc || s.descricao || s.nome || '') : []
      }));

    return {
      origem: 'OFICIN-IA',
      tenantId: J.tid || J.tenantId || '',
      perfil: J.role || sessionStorage.getItem('j_role') || '',
      usuario: J.nome || J.usuario || '',
      oficina: J.tnome || sessionStorage.getItem('j_tnome') || '',
      resumo: { ordensServico: os.length, clientes: clientes.length, veiculos: veiculos.length },
      osAbertas: abertas
    };
  }

  async function perguntarEndpoint(message, perfil) {
    const cfg = await carregarConfigTenant();
    if (!cfg.moduloLiberado || !cfg.ativo) throw new Error('Módulo de IA Diagnóstico Automotivo não liberado para esta oficina.');
    if (!cfg.endpoint) throw new Error('Endpoint/proxy da IA externa ainda não cadastrado.');

    const payload = {
      pergunta: message,
      perfil: perfil || getJ().role || '',
      contexto: montarContexto(),
      historico: Array.isArray(W.iaHistorico) ? W.iaHistorico.slice(-12) : []
    };

    const res = await fetch(cfg.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      body: JSON.stringify(payload)
    });

    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) throw new Error(data?.erro || data?.error || ('Falha HTTP ' + res.status));
    return data?.resposta || data?.answer || data?.text || data?.mensagem || '';
  }

  async function chamarIA(inputId, perfil) {
    const input = D.getElementById(inputId || 'iaInput');
    const message = txt(input?.value);
    if (!message) return;
    if (input) input.value = '';

    const cfg = await carregarConfigTenant();

    // Sem módulo liberado: deixa a IA local original trabalhar normalmente.
    if (!cfg.moduloLiberado || !cfg.ativo) {
      if (typeof original.thiaIAAsk === 'function') {
        if (input) input.value = message;
        return original.thiaIAAsk(inputId || 'iaInput', perfil);
      }
      addUser(message);
      addBot('IA local indisponível.');
      return;
    }

    // Com endpoint: vira chat integrado de verdade.
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

    // Sem endpoint conhecido: avisa e mantém o chat local.
    addUser(message);
    addBot(
      '<b>IA Diagnóstico Automotivo liberada para esta oficina.</b><br>' +
      'Ainda não existe endpoint/API cadastrado, então não consigo enviar esta pergunta automaticamente para o fornecedor.<br>' +
      'Use o botão abaixo para abrir o portal externo e consultar com o login cadastrado no Superadmin.<br><br>' +
      '<button class="btn-warn" onclick="window.thiaAbrirDiagnosticoAutomotivo()">Abrir portal Diagnóstico Automotivo</button> ' +
      '<button class="btn-ghost" onclick="window.thiaMostrarCredenciaisDiagnosticoIA()">Ver credenciais</button><br><br>' +
      '<small style="color:var(--muted,#94a3b8)">Enquanto isso, vou responder com a IA local do OFICIN-IA.</small>'
    );

    if (typeof original.thiaIAAsk === 'function') {
      if (input) input.value = message;
      return original.thiaIAAsk(inputId || 'iaInput', perfil);
    }
  }

  async function abrirPortal() {
    const cfg = await carregarConfigTenant();
    W.open(cfg.portalUrl || PORTAL_PADRAO, '_blank', 'noopener,noreferrer');
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

  async function mostrarCredenciais() {
    const cfg = await carregarConfigTenant(true);
    const status = cfg.moduloLiberado && cfg.ativo ? 'Liberado' : 'Bloqueado';
    const senhaMask = cfg.senha ? '••••••••' : 'Não cadastrada';
    const html = `
      <div id="thiaDiagIaOverlay" style="position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:99999;display:flex;align-items:center;justify-content:center;padding:18px;">
        <div style="width:min(640px,96vw);background:var(--surf,#111827);border:1px solid var(--border,#334155);border-radius:14px;padding:18px;color:var(--text,#e5e7eb);box-shadow:0 20px 70px rgba(0,0,0,.45)">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;">
            <div>
              <div style="font-weight:800;font-size:1.05rem;">IA Diagnóstico Automotivo</div>
              <div style="font-size:.78rem;color:var(--muted,#94a3b8);margin-top:4px;">Status do módulo: <b>${esc(status)}</b></div>
            </div>
            <button class="btn-ghost" onclick="document.getElementById('thiaDiagIaOverlay').remove()">✕</button>
          </div>

          <div style="display:grid;gap:10px;margin-top:8px;">
            <div>
              <label style="display:block;font-size:.72rem;color:var(--muted,#94a3b8);margin-bottom:4px;">Portal</label>
              <div class="j-input" style="height:auto;min-height:38px;display:flex;align-items:center;">${esc(cfg.portalUrl || PORTAL_PADRAO)}</div>
            </div>
            <div>
              <label style="display:block;font-size:.72rem;color:var(--muted,#94a3b8);margin-bottom:4px;">Usuário</label>
              <div style="display:flex;gap:8px;">
                <div class="j-input" style="height:auto;min-height:38px;display:flex;align-items:center;flex:1;">${esc(cfg.usuario || 'Não cadastrado')}</div>
                <button class="btn-ghost" onclick="window.thiaCopiarDiagnosticoIA('usuario')">Copiar</button>
              </div>
            </div>
            <div>
              <label style="display:block;font-size:.72rem;color:var(--muted,#94a3b8);margin-bottom:4px;">Senha</label>
              <div style="display:flex;gap:8px;">
                <div class="j-input" style="height:auto;min-height:38px;display:flex;align-items:center;flex:1;">${esc(senhaMask)}</div>
                <button class="btn-ghost" onclick="window.thiaCopiarDiagnosticoIA('senha')">Copiar</button>
              </div>
            </div>
          </div>

          <div style="font-size:.75rem;color:var(--muted,#94a3b8);line-height:1.45;margin-top:12px;">
            Sem endpoint/API, o navegador não consegue transformar o portal externo em chat integrado com segurança.
            O uso atual é abrir o portal e colar a pergunta. Quando houver endpoint/proxy, o chat passa a enviar direto.
          </div>

          <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px;flex-wrap:wrap;">
            <button class="btn-ghost" onclick="window.thiaRecarregarConfigDiagnosticoIA()">Recarregar config</button>
            <button class="btn-primary" onclick="window.thiaAbrirDiagnosticoAutomotivo()">Abrir portal</button>
          </div>
        </div>
      </div>`;
    D.getElementById('thiaDiagIaOverlay')?.remove();
    D.body.insertAdjacentHTML('beforeend', html);
  }

  async function copiarCredencial(tipo) {
    const cfg = await carregarConfigTenant();
    if (tipo === 'senha') return copiarTexto(cfg.senha, 'Senha');
    return copiarTexto(cfg.usuario, 'Usuário');
  }

  async function recarregarConfig() {
    await carregarConfigTenant(true);
    if (typeof W.toast === 'function') W.toast('Configuração da IA Diagnóstico recarregada.', 'ok');
    D.getElementById('thiaDiagIaOverlay')?.remove();
    mostrarCredenciais();
  }

  async function atualizarBarra() {
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

    const cfg = cfgCache || normalizarConfig(oficinaSessao());
    const ativo = cfg.moduloLiberado && cfg.ativo;
    const endpoint = !!cfg.endpoint;
    const texto = ativo ? (endpoint ? 'IA Diagnóstico conectada' : 'IA Diagnóstico liberada sem endpoint') : 'IA Diagnóstico bloqueada';
    const cor = ativo ? 'var(--success,#22c55e)' : 'var(--muted,#94a3b8)';

    bar.innerHTML = `
      <span id="thiaDiagIaStatus" style="padding:5px 9px;border-radius:999px;border:1px solid rgba(148,163,184,.25);color:${cor};">
        ${esc(texto)}
      </span>
      <button type="button" class="btn-ghost" onclick="window.thiaMostrarCredenciaisDiagnosticoIA()">Credenciais / status</button>
      <button type="button" class="btn-ghost" onclick="window.thiaAbrirDiagnosticoAutomotivo()">Abrir Diagnóstico Automotivo</button>
    `;
  }

  W.thiaDiagnosticoIA = {
    portalUrl: PORTAL_PADRAO,
    carregarConfig: carregarConfigTenant,
    montarContexto,
    perguntar: perguntarEndpoint
  };

  W.thiaIAAsk = chamarIA;
  W.iaPerguntar = function () { return chamarIA('iaInput', 'jarvis'); };
  W.iaEnviar = function () { return chamarIA('iaInput', 'equipe'); };
  W.thiaAbrirDiagnosticoAutomotivo = abrirPortal;
  W.thiaMostrarCredenciaisDiagnosticoIA = mostrarCredenciais;
  W.thiaCopiarDiagnosticoIA = copiarCredencial;
  W.thiaRecarregarConfigDiagnosticoIA = recarregarConfig;

  D.addEventListener('DOMContentLoaded', function () {
    setTimeout(function () { carregarConfigTenant(false); atualizarBarra(); }, 120);
  });
})();
