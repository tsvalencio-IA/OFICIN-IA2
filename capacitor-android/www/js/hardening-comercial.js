/*
 * Camada comercial de preservacao e travas de dominio.
 * Nao substitui Firebase Rules: reforca UI, auditoria, notificacoes e contexto por perfil.
 */
(function () {
  'use strict';

  const D = document;
  const moneyRe = /R\$\s*\d|(?:\btotal\b|\bfaturad|\baprovad[oa]\s*R\$|\bcusto\b|\bmargem\b)/i;

  function role() {
    return String(window.J?.role || sessionStorage.getItem('j_role') || '').toLowerCase();
  }

  function tenantId() {
    return window.J?.tid || sessionStorage.getItem('j_tid') || sessionStorage.getItem('govTid') || '';
  }

  function userName() {
    return window.J?.nome || sessionStorage.getItem('j_nome') || 'usuario';
  }

  function db() {
    return window.db || window.J?.db || null;
  }

  function isEquipe() {
    const r = role();
    return r === 'mecanico' || r === 'equipe';
  }

  function isCliente() {
    const path = location.pathname.toLowerCase();
    return role() === 'cliente' || path.includes('cliente.html') || path.includes('clienteoficial.html');
  }

  function canSeeFinance() {
    const r = role();
    return ['admin', 'gestor', 'gerente', 'superadmin', 'dono', 'proprietario', 'owner', 'financeiro', 'oficina_admin'].includes(r);
  }

  window.thiaCanSeeFinance = canSeeFinance;

  window.thiaAudit = async function (acao, entidade, entidadeId, antes, depois, motivo, extra) {
    const database = db();
    if (!database || !tenantId()) return;
    const payload = {
      tenantId: tenantId(),
      usuario: userName(),
      perfil: role(),
      acao: acao || '',
      entidade: entidade || '',
      entidadeId: entidadeId || '',
      antes: antes || null,
      depois: depois || null,
      motivo: motivo || '',
      extra: extra || null,
      ts: Date.now(),
      createdAt: new Date().toISOString()
    };
    try { await database.collection('lixeira_auditoria').add(payload); } catch (e) { console.warn('[thiaAudit]', e); }
    try { await database.collection('auditoria').add(payload); } catch (e) { /* compat opcional */ }
  };

  window.thiaNotify = async function (opts) {
    const database = db();
    if (!database || !tenantId()) return;
    const payload = Object.assign({
      tenantId: tenantId(),
      tipo: 'sistema',
      titulo: '',
      mensagem: '',
      destinoPerfil: 'admin',
      destinoUsuario: '',
      entidade: '',
      entidadeId: '',
      prioridade: 'normal',
      acaoSugerida: '',
      lida: false,
      ts: Date.now(),
      createdAt: new Date().toISOString()
    }, opts || {});
    try { await database.collection('notificacoes_live').add(payload); } catch (e) { console.warn('[thiaNotify]', e); }
  };

  function hideInternalAndFinance(root) {
    root = root || D;

    if (isCliente()) {
      root.querySelectorAll('[data-interno], .observacao-interna, .obs-interna, #blocoReais, #containerPecasReais').forEach(el => {
        el.style.display = 'none';
      });
    }

    if (isEquipe() || (isCliente() && !location.pathname.toLowerCase().includes('clienteoficial'))) {
      root.querySelectorAll('[data-financ], [data-role-hide*="financeiro"], #kpiComissao, #modalExtratoFunc').forEach(el => {
        el.style.display = 'none';
      });
    }

    if (isEquipe()) {
      root.querySelectorAll('td, th, span, button, small, b, strong, label').forEach(el => {
        if (!el || (el.children && el.children.length)) return;
        const txt = el.textContent || '';
        if (moneyRe.test(txt)) {
          if (el.id === 'kMinhaComissao') el.textContent = 'OCULTO';
          if (/\bR\$\s*\d/.test(txt)) el.textContent = txt.replace(/R\$\s*[\d.,]+/g, 'OCULTO');
        }
      });
      root.querySelectorAll('input, textarea').forEach(el => {
        const txt = el.value || '';
        if (/\bR\$\s*\d/.test(txt)) el.value = txt.replace(/R\$\s*[\d.,]+/g, 'OCULTO');
      });
    }

    const reais = D.getElementById('blocoReais') || D.getElementById('containerPecasReais');
    if (reais && window._pecasReaisDesbloqueadas !== true) reais.style.display = 'none';
  }

  function installObserver() {
    hideInternalAndFinance(D);
    if (typeof MutationObserver === 'undefined' || !D.body) return;
    const obs = new MutationObserver(muts => {
      if (muts.some(m => m.addedNodes && m.addedNodes.length)) hideInternalAndFinance(D);
    });
    obs.observe(D.body, { childList: true, subtree: true });
  }

  function patchStatusNotifications() {
    if (typeof window.moverStatusOS === 'function' && !window.moverStatusOS.__thiaComercial) {
      const old = window.moverStatusOS;
      window.moverStatusOS = async function (id, novoStatus) {
        const lista = window.J?.os || window.dbOS || [];
        const antes = lista.find(o => o.id === id) || null;
        const ret = await old.apply(this, arguments);
        const depois = (window.J?.os || window.dbOS || []).find(o => o.id === id) || Object.assign({}, antes || {}, { status: novoStatus });
        if (novoStatus === 'Pronto' && (!antes || antes.status !== 'Pronto')) {
          await window.thiaNotify({
            tipo: 'os_pronta',
            titulo: 'Veiculo pronto',
            mensagem: `O.S. ${String(id || '').slice(-6).toUpperCase()} marcada como pronta. Conferir caixa e avisar cliente.`,
            destinoPerfil: 'admin',
            entidade: 'ordens_servico',
            entidadeId: id,
            prioridade: 'alta',
            acaoSugerida: 'Enviar aviso ao cliente'
          });
        }
        if (antes && antes.status !== novoStatus) {
          await window.thiaAudit('alteracao_status_os', 'ordens_servico', id, { status: antes.status }, { status: novoStatus }, '', { origem: 'moverStatusOS' });
        }
        return ret;
      };
      window.moverStatusOS.__thiaComercial = true;
    }
  }

  function patchObdMessage() {
    if (!location.pathname.toLowerCase().includes('cliente.html')) return;
    const warn = D.getElementById('obdWarnIOS');
    if (warn) {
      warn.textContent = 'Bluetooth OBD: no iOS/PWA o Web Bluetooth nao e suportado. Use Chrome no Android/Desktop. No APK, Bluetooth classico depende do plugin nativo ELM.';
    }
    if (typeof window.obdConectar === 'function' && !window.obdConectar.__thiaComercial) {
      const old = window.obdConectar;
      window.obdConectar = async function () {
        const hasNative = !!(window.Capacitor?.Plugins?.ELMBluetoothClassic);
        if (!hasNative && !navigator.bluetooth) {
          window.toast?.('Bluetooth indisponivel nesta plataforma. Use Chrome Android/Desktop ou entrada manual.', 'err');
          return;
        }
        return old.apply(this, arguments);
      };
      window.obdConectar.__thiaComercial = true;
    }
  }

  function htmlEscape(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  function iaOsList() {
    if (Array.isArray(window.J?.os)) return window.J.os;
    if (Array.isArray(window.dbOS)) return window.dbOS;
    return [];
  }

  function iaVeiculos() {
    if (Array.isArray(window.J?.veiculos)) return window.J.veiculos;
    if (Array.isArray(window.dbVeiculos)) return window.dbVeiculos;
    return [];
  }

  function iaClientes() {
    if (Array.isArray(window.J?.clientes)) return window.J.clientes;
    if (Array.isArray(window.dbClientes)) return window.dbClientes;
    return [];
  }

  function iaItemLabel(item) {
    return item?.desc || item?.descricao || item?.nome || item?.servico || item?.peca || item?.codigo || 'item sem descricao';
  }

  function iaAprovacaoItem(item) {
    const raw = String(item?.statusAprovacao || item?.aprovacao || item?.status || '').toLowerCase();
    if (item?.aprovado === true || /aprov/.test(raw)) return 'aprovado';
    if (item?.aprovado === false || /reprov|recus|negad|nao aprovado|não aprovado/.test(raw)) return 'nao aprovado';
    return 'orcado/pendente';
  }

  function iaExecucaoItem(item, os) {
    const key = item?.id || item?.uid || item?.codigo || item?.desc || item?.descricao || '';
    const mapa = os?.execucaoItens || os?.execucoesItens || {};
    const exec = item?.execucao || item?.statusExecucao || item?.execStatus || (key && mapa[key]) || null;
    const status = typeof exec === 'object' ? (exec.status || exec.situacao || '') : exec;
    return status ? String(status) : 'sem execucao registrada';
  }

  function iaBuildContext(perfil, pergunta) {
    const osList = iaOsList();
    const veiculos = iaVeiculos();
    const clientes = iaClientes();
    const canFinance = canSeeFinance() && !['equipe', 'mecanico', 'cliente'].includes(perfil);
    const placaRe = /[A-Z]{3}[- ]?[0-9][A-Z0-9][0-9]{2}|[A-Z]{3}[- ]?[0-9]{4}/ig;
    const placas = (String(pergunta || '').match(placaRe) || []).map(p => p.replace(/[^A-Z0-9]/ig, '').toUpperCase());
    const alvo = placas.length
      ? osList.filter(o => {
          const v = veiculos.find(x => x.id === o.veiculoId) || {};
          const placa = String(o.placa || v.placa || '').replace(/[^A-Z0-9]/ig, '').toUpperCase();
          return placas.includes(placa);
        })
      : osList.slice(-30);
    const linhas = [];
    linhas.push(`Perfil: ${perfil || 'admin'}`);
    linhas.push(`Oficina: ${window.J?.tnome || sessionStorage.getItem('j_tnome') || 'nao informada'}`);
    linhas.push('Regra de verdade: item orcado nao e item aprovado; item aprovado nao e item executado; peca comprada nao e peca instalada; so considere executado quando houver status de execucao.');
    linhas.push('Se faltar dado, responda literalmente que nao ha dado registrado.');
    if (perfil === 'equipe' || perfil === 'mecanico') linhas.push('Perfil equipe: nao exponha valores, custos, faturamento, margens, comissoes ou financeiro.');
    if (!alvo.length) linhas.push('Nenhuma O.S. correspondente encontrada no contexto local.');
    alvo.slice(0, 30).forEach(o => {
      const v = veiculos.find(x => x.id === o.veiculoId) || {};
      const c = clientes.find(x => x.id === (o.clienteId || v.clienteId)) || {};
      linhas.push(`OS ${String(o.numero || o.id || '').slice(-8)} | placa ${o.placa || v.placa || 'S/P'} | veiculo ${o.veiculo || v.modelo || o.modelo || o.tipoVeiculo || 'N/I'} | cliente ${c.nome || o.cliente || 'N/I'} | status ${o.status || 'N/I'} | etapa ${o.etapa || 'N/I'} | data ${o.data || o.createdAt || 'N/I'}`);
      if (o.desc || o.relato) linhas.push(`Relato: ${o.desc || o.relato}`);
      if (o.diagnostico) linhas.push(`Diagnostico: ${o.diagnostico}`);
      const pecas = Array.isArray(o.pecas) ? o.pecas : [];
      const servicos = Array.isArray(o.servicos) ? o.servicos : [];
      pecas.slice(0, 20).forEach(p => linhas.push(`Peca: ${iaItemLabel(p)} | aprovacao ${iaAprovacaoItem(p)} | execucao ${iaExecucaoItem(p, o)}`));
      servicos.slice(0, 20).forEach(s => linhas.push(`Servico: ${iaItemLabel(s)} | aprovacao ${iaAprovacaoItem(s)} | execucao ${iaExecucaoItem(s, o)}`));
      if (canFinance && Array.isArray(o.pecasReais) && o.pecasReais.length) {
        o.pecasReais.slice(0, 20).forEach(p => linhas.push(`Auditoria interna peca real: ${iaItemLabel(p)} | codigo ${p.codigo || p.codigoFornecedor || p.codigoComercial || 'N/I'} | NF ${p.nf || p.nfNumero || 'N/I'} | fornecedor ${p.fornecedor || 'N/I'} | compra ${p.dataCompra || p.dataNF || 'N/I'} | status ${p.statusAplicacao || 'comprada/vinculada, nao executada'}`));
      }
      if (Array.isArray(o.timeline) && o.timeline.length) {
        linhas.push('Timeline recente: ' + o.timeline.slice(-5).map(t => `${t.data || t.dt || t.createdAt || ''} ${t.acao || t.status || ''}`).join(' | '));
      }
      if (canFinance) linhas.push(`Financeiro OS: total ${o.total || o.valorTotal || 0}; aprovado ${o.totalAprovado || o.valorAprovado || 0}; nao aprovado ${o.totalNaoAprovado || 0}.`);
    });
    if (canFinance && Array.isArray(window.J?.financeiro)) {
      linhas.push(`Financeiro geral: ${window.J.financeiro.length} lancamentos carregados no painel.`);
    }
    return linhas.join('\n');
  }

  function iaFallback(pergunta, perfil, erro) {
    const ctx = iaBuildContext(perfil, pergunta);
    const achouOS = !/Nenhuma O\.S\./.test(ctx);
    const intro = erro ? `API indisponivel (${htmlEscape(erro)}). Resposta local com dados carregados:<br>` : 'Resposta local com dados carregados:<br>';
    if (!achouOS) {
      return intro + 'Nao ha dado registrado suficiente para afirmar troca, execucao, compra ou financeiro. Informe placa, numero da O.S. ou abra a O.S. correta para eu cruzar os dados.';
    }
    const resumo = ctx.split('\n').slice(0, 18).map(htmlEscape).join('<br>');
    return intro + resumo + '<br><br><strong>Regra aplicada:</strong> nao vou afirmar que uma peca foi trocada ou instalada sem status de execucao registrado.';
  }

  function iaAddUser(txt) {
    if (typeof window._iaMsgUser === 'function') return window._iaMsgUser(txt);
    if (typeof window.adicionarMsgIA === 'function') return window.adicionarMsgIA('user', htmlEscape(txt));
    const c = D.getElementById('iaMsgs'); if (!c) return;
    const d = D.createElement('div'); d.className = 'ia-msg user'; d.textContent = txt; c.appendChild(d); c.scrollTop = c.scrollHeight;
  }

  function iaAddBot(html) {
    if (typeof window._iaMsgBot === 'function') return window._iaMsgBot(html);
    if (typeof window.adicionarMsgIA === 'function') {
      window.adicionarMsgIA('bot', html);
      return '__legacy_bot__';
    }
    const c = D.getElementById('iaMsgs'); if (!c) return null;
    const id = 'thia-ia-' + Date.now();
    const d = D.createElement('div'); d.id = id; d.className = 'ia-msg bot'; d.innerHTML = '<strong>thIAguinho:</strong> ' + html; c.appendChild(d); c.scrollTop = c.scrollHeight;
    return id;
  }

  function iaReplaceBot(id, html) {
    if (typeof window._iaReplace === 'function' && id && id !== '__legacy_bot__') return window._iaReplace(id, html);
    if (id === '__legacy_bot__') {
      const c = D.getElementById('iaMsgs');
      const el = c?.lastElementChild;
      if (el) el.innerHTML = '<strong>thIAguinho:</strong> ' + html;
      return;
    }
    const el = id ? D.getElementById(id) : null;
    if (el) el.innerHTML = '<strong>thIAguinho:</strong> ' + html;
  }

  async function iaPerguntarComercial(inputId, perfil) {
    const inp = D.getElementById(inputId || 'iaInput');
    const msg = inp?.value?.trim();
    if (!msg) return;
    inp.value = '';
    iaAddUser(msg);
    const lid = iaAddBot('<span class="j-spinner"></span> Analisando contexto real...');
    const key = window.J?.gemini || window.J?.oficina?.apiKeys?.gemini || sessionStorage.getItem('j_gemini') || '';
    if (!key) {
      iaReplaceBot(lid, iaFallback(msg, perfil, 'chave Gemini nao configurada'));
      return;
    }
    try {
      const systemPrompt = `Voce e o thIAguinho, consultor tecnico e operacional de oficina.
Use somente o contexto estruturado abaixo.
Nao invente dado. Diferencie orcamento, aprovacao, execucao, compra, estoque e financeiro.
Nunca diga que peca foi trocada se ela apenas foi orcada, comprada ou aprovada.
Cliente/equipe nao recebem dados internos nem valores quando o perfil nao permite.
Responda em portugues do Brasil, direto e pratico.

${iaBuildContext(perfil, msg)}`;
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: msg }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: { temperature: 0.35, maxOutputTokens: 1600 },
          safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' }
          ]
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
      const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('\n');
      if (!text) throw new Error(data?.promptFeedback?.blockReason || 'resposta vazia');
      iaReplaceBot(lid, htmlEscape(text).replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'));
    } catch (e) {
      iaReplaceBot(lid, iaFallback(msg, perfil, e.message || e));
    }
  }

  function patchIAComercial() {
    const path = location.pathname.toLowerCase();
    const input = D.getElementById('iaInput');
    if (!input) return;
    window.thiaIAAsk = iaPerguntarComercial;
    const bindEnter = (fnName) => {
      if (input.__thiaIAEnterBound === fnName) return;
      input.__thiaIAEnterBound = fnName;
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter' && typeof window[fnName] === 'function') window[fnName]();
      });
    };
    if (path.includes('jarvis')) {
      window.iaPerguntar = function () { return iaPerguntarComercial('iaInput', canSeeFinance() ? 'jarvis' : role()); };
      window.iaPerguntar.__thiaComercial = true;
      bindEnter('iaPerguntar');
    }
    if (path.includes('equipe')) {
      window.iaEnviar = function () { return iaPerguntarComercial('iaInput', 'equipe'); };
      window.iaEnviar.__thiaComercial = true;
      bindEnter('iaEnviar');
    }
    if (path.includes('superadmin')) {
      window.iaPerguntar = function () { return iaPerguntarComercial('iaInput', 'superadmin'); };
      window.iaEnviar = window.iaPerguntar;
      window.iaPerguntar.__thiaComercial = true;
      bindEnter('iaPerguntar');
    }
  }

  function init() {
    installObserver();
    patchStatusNotifications();
    patchObdMessage();
    patchIAComercial();
    setInterval(() => {
      hideInternalAndFinance(D);
      patchStatusNotifications();
      patchIAComercial();
    }, 1500);
  }

  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', init);
  else init();
})();
