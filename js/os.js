/**
 * JARVIS ERP — os.js
 * Motor de Ordens de Serviço, Kanban Chevron 7 Etapas, WhatsApp B2C, Laudos PDF
 *
 * Powered by thIAguinho Soluções Digitais
 */

'use strict';

const OSU = () => window.JarvisOSUtils || window.JOS || {};
const numBR = value => (OSU().parseNumberBR ? OSU().parseNumberBR(value) : (parseFloat(String(value || 0).replace(',', '.')) || 0));
const taxaDescontoOS = value => {
  const v = numBR(value);
  return v > 1 ? +(v / 100).toFixed(6) : v;
};
const escOS = value => (OSU().escapeHtml ? OSU().escapeHtml(value) : String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));

function isFirestoreSentinelOS(value) {
  if (!value || typeof value !== 'object') return false;
  const ctor = String(value.constructor?.name || '');
  // Compat Firebase v8/v9: FieldValue.delete(), serverTimestamp(), arrayUnion(), etc.
  // Esses objetos NÃO podem ser percorridos/limpos, senão o update perde o sentinel.
  return Boolean(
    value._methodName ||
    value._delegate?._methodName ||
    value._toFieldTransform ||
    /FieldValue|DeleteFieldValue|ServerTimestamp|ArrayUnion|ArrayRemove/i.test(ctor)
  );
}

function limparUndefinedFirestoreOS(value) {
  if (value === undefined) return undefined;
  if (isFirestoreSentinelOS(value)) return value;
  if (value === null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (Array.isArray(value)) {
    return value
      .map(item => limparUndefinedFirestoreOS(item))
      .filter(item => item !== undefined);
  }
  if (value && typeof value === 'object') {
    const out = {};
    Object.entries(value).forEach(([key, val]) => {
      const cleaned = limparUndefinedFirestoreOS(val);
      if (cleaned !== undefined) out[key] = cleaned;
    });
    return out;
  }
  return value;
}

function firestoreDeleteFieldOS() {
  try {
    return window.firebase?.firestore?.FieldValue?.delete?.() || firebase.firestore.FieldValue.delete();
  } catch(e) {
    console.warn('FieldValue.delete indisponível; usando null como fallback.', e);
    return null;
  }
}

function normalizarStatusFluxoOS(status) {
  return String(status || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim();
}

function statusReabreEdicaoOrcamentoOS(status) {
  const s = normalizarStatusFluxoOS(status);
  // Só reabre orçamento real. Não inclui Orcamento_Enviado porque esse status ainda é envio ao cliente.
  return s === 'triagem' || s === 'orcamento' || s === 'em_orcamento' || s === 'em orcamento';
}

function osTemAprovacaoAtivaOS(os) {
  if (!os) return false;
  if (typeof OSU().hasApproval === 'function') return !!OSU().hasApproval(os);
  return Boolean(
    os.aprovacao ||
    os.totalAprovado != null ||
    (Array.isArray(os.itensAprovados) && os.itensAprovados.length > 0) ||
    (os.execucaoItens && Object.keys(os.execucaoItens || {}).length > 0)
  );
}

function montarRegistroReaberturaAprovacaoOS(osAntes, statusDestino, origem) {
  return {
    reabertoEm: new Date().toISOString(),
    reabertoPor: window.J?.nome || 'Gestor',
    reabertoPorTipo: 'jarvis',
    origem: origem || 'os',
    statusAnterior: osAntes?.status || '',
    statusDestino: statusDestino || '',
    aprovacaoAnterior: osAntes?.aprovacao || null,
    itensAprovadosAnteriores: Array.isArray(osAntes?.itensAprovados) ? osAntes.itensAprovados : [],
    totalAprovadoAnterior: osAntes?.totalAprovado ?? null,
    execucaoItensAnterior: osAntes?.execucaoItens || null
  };
}

function aplicarReaberturaAprovacaoNoPayloadOS(payload, osAntes, statusDestino, origem) {
  const historico = Array.isArray(osAntes?.aprovacaoHistorico) ? osAntes.aprovacaoHistorico.slice() : [];
  historico.push(montarRegistroReaberturaAprovacaoOS(osAntes, statusDestino, origem));
  payload.aprovacaoHistorico = historico;
  payload.aprovacao = firestoreDeleteFieldOS();
  payload.itensAprovados = firestoreDeleteFieldOS();
  payload.totalAprovado = firestoreDeleteFieldOS();
  payload.execucaoItens = firestoreDeleteFieldOS();
  payload.aprovacaoAtiva = false;
  payload.reabertoParaEdicaoEm = new Date().toISOString();
  payload.reabertoParaEdicaoPor = window.J?.nome || 'Gestor';
  return historico[historico.length - 1];
}

function usuarioPodeDispararWppProntoOS() {
  const role = String(window.J?.role || sessionStorage.getItem('j_role') || '').toLowerCase();
  return ['admin', 'gestor', 'gerente', 'superadmin', 'dono'].includes(role);
}

function classificarSecaoResumoOS(input) {
  const normalizar = OSU().normalizeText || (v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase());
  const descTexto = normalizar([
    input?.operacao,
    input?.item,
    input?.desc,
    input?.descricao
  ].filter(Boolean).join(' '));
  const metaTexto = normalizar([
    input?.secaoHoraLabel,
    input?.sistemaTabela,
    input?.sistema
  ].filter(Boolean).join(' '));
  const texto = [descTexto, metaTexto].filter(Boolean).join(' ');
  const labelBase = String(input?.secaoHoraLabel || input?.sistemaTabela || input?.sistema || '').trim();
  const mecanicaForte = /\b(amortecedor(?:es)?|mola(?:s)?|suspensao|semi[\s-]*eixo|semieixo|homocinetica|coifa|bieleta|bandeja|pivo|terminal|barra axial|freio|pastilha|disco de freio|tambor|cambio|embreagem|motor|junta|radiador|arrefecimento|direcao|retifica|rolamento|cubo|correia|polia|bomba d[ae] agua)\b/;

  // Prioriza a descrição real digitada/selecionada. Metadados amplos como
  // "MECÂNICA ELÉTRICA GERAL" só entram como fallback.
  if (/\b(funilaria|lanternagem|pintura|pintar|lataria|parachoque|para choque)\b/.test(descTexto)) return 'FUNILARIA / PINTURA';
  if (/\b(tapecaria|capotaria|banco|assento|encosto|forro|estof)\b/.test(descTexto)) return 'TAPECARIA / CAPOTARIA';
  if (/\b(borracharia|pneu|pneus|roda|rodas|calota|balanceamento)\b/.test(descTexto)) return 'BORRACHARIA';
  if (/\b(lavagem|higienizacao|higienizar|limpeza interna|polimento)\b/.test(descTexto)) return 'LAVAGEM / HIGIENIZACAO';
  if (mecanicaForte.test(descTexto)) return 'MECANICA';
  if (/\b(injecao|bico|bicos|injetor(?:es)?|combustivel|alimentacao|tanque)\b/.test(descTexto)) return 'INJECAO / ALIMENTACAO';
  if (/\b(eletrica|eletrico|eletronica|alternador|bateria|lampada|farol|sensor|chicote|fusivel|modulo)\b/.test(descTexto)) return 'ELETRICA';

  if (/\b(funilaria|lanternagem|pintura|pintar|lataria|parachoque|para choque)\b/.test(texto)) return 'FUNILARIA / PINTURA';
  if (/\b(tapecaria|capotaria|banco|assento|encosto|forro|estof)\b/.test(texto)) return 'TAPECARIA / CAPOTARIA';
  if (/\b(borracharia|pneu|pneus|roda|rodas|calota|balanceamento)\b/.test(texto)) return 'BORRACHARIA';
  if (/\b(lavagem|higienizacao|higienizar|limpeza interna|polimento)\b/.test(texto)) return 'LAVAGEM / HIGIENIZACAO';
  if (mecanicaForte.test(texto)) return 'MECANICA';
  if (/\b(injecao|bico|bicos|injetor(?:es)?|combustivel|alimentacao|tanque)\b/.test(texto)) return 'INJECAO / ALIMENTACAO';
  if (/\b(eletrica|eletrico|eletronica|alternador|bateria|lampada|farol|sensor|chicote|fusivel|modulo)\b/.test(texto)) return 'ELETRICA';
  if (/\b(mecanica|motor|cambio|transmissao|arrefecimento|suspensao|freio|direcao|retifica)\b/.test(texto)) return 'MECANICA';
  return labelBase ? labelBase.toUpperCase().slice(0, 54) : 'OUTROS SERVICOS';
}

function extrairTipoVeiculoTempaOS(input, veiculoAtual = {}) {
  const base = String(
    input?.tipoVeiculoTabela || input?.tipoVeiculoTempa || input?.tipoVeiculo || input?.tipo ||
    input?.sistemaTabela || input?.sistema || input?.secaoHoraLabel || ''
  ).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  const direto = String(input?.tipoVeiculoTabela || input?.tipoVeiculoTempa || '').trim();
  if (direto) return direto;
  if (/CAMINHAO|CAMINHÕES|CAMINHOES/.test(base)) return 'CAMINHÃO';
  if (/SUV/.test(base)) return 'SUV';
  if (/COMPACTO/.test(base)) return 'VEÍCULO COMPACTO';
  if (/PEQUENOS? E MEDIOS?|MEDIO/.test(base)) return 'VEÍCULOS PEQUENOS E MÉDIOS';
  if (/UTILITARIO|UTILITÁRIA|VAN/.test(base)) return 'UTILITÁRIO / VAN';
  if (/MOTOCICLETA|MOTO/.test(base)) return 'MOTO';
  if (/DIESEL/.test(base)) return 'DIESEL';
  if (/CICLO OTTO|OTTO/.test(base)) return 'CICLO OTTO';
  const tipoAtual = String(veiculoAtual?.tipo || veiculoAtual?.categoria || '').trim();
  return tipoAtual ? tipoAtual.toUpperCase() : '';
}

function metaServicoResumoOS(input, veiculoAtual = {}) {
  const codigo = String(input?.codigoTabela || input?.codigo || '').trim();
  const sistema = String(input?.sistemaTabela || input?.sistema || input?.secaoHoraLabel || '').trim();
  const tipoVeiculo = extrairTipoVeiculoTempaOS(input, veiculoAtual);
  return { codigo, sistema, tipoVeiculo };
}

function addMetaResumoServicoOS(bucket, meta) {
  if (!bucket || !meta) return;
  if (!bucket.codigos) bucket.codigos = new Set();
  if (!bucket.sistemas) bucket.sistemas = new Set();
  if (!bucket.tiposVeiculo) bucket.tiposVeiculo = new Set();
  if (meta.codigo) bucket.codigos.add(meta.codigo);
  if (meta.sistema) bucket.sistemas.add(meta.sistema);
  if (meta.tipoVeiculo) bucket.tiposVeiculo.add(meta.tipoVeiculo);
}

function listaResumoOS(values, limite = 5) {
  const arr = Array.from(values || []).filter(Boolean);
  if (!arr.length) return '';
  return arr.slice(0, limite).join(', ') + (arr.length > limite ? ` +${arr.length - limite}` : '');
}


function roleDonoOficinaOS() {
  const role = String(window.J?.role || sessionStorage.getItem('j_role') || '').toLowerCase();
  return ['admin', 'gestor', 'gerente', 'superadmin', 'dono', 'proprietario', 'owner'].includes(role);
}

function clienteGovernamentalAtualOS() {
  const cliId = document.getElementById('osCliente')?.value || '';
  const cli = (window.J?.clientes || []).find(c => c.id === cliId);
  return cli?.tipoCliente === 'governo';
}

window.atualizarVisibilidadeDescontosOS = function() {
  const bloco = document.getElementById('blocoDescontoOS');
  if (!bloco) return;
  const podeVer = roleDonoOficinaOS() || clienteGovernamentalAtualOS();
  bloco.style.display = podeVer ? 'block' : 'none';
};

function moedaOS(v) {
  return 'R$ ' + numBR(v).toFixed(2).replace('.', ',');
}

function pctOS(v) {
  return (taxaDescontoOS(v) * 100).toFixed(1).replace('.', ',') + '%';
}

function garantirResumoDescontoOS() {
  const bloco = document.getElementById('blocoDescontoOS');
  if (!bloco) return null;
  let el = document.getElementById('osResumoDescontosLive');
  if (!el) {
    el = document.createElement('div');
    el.id = 'osResumoDescontosLive';
    el.style.cssText = 'margin-top:12px;display:grid;grid-template-columns:repeat(3,minmax(160px,1fr));gap:10px;font-family:var(--fm);';
    bloco.appendChild(el);
  }
  return el;
}

function atualizarResumoDescontosOS(dados) {
  window.atualizarVisibilidadeDescontosOS?.();
  const el = garantirResumoDescontoOS();
  if (!el) return;
  const brutoServicos = numBR(dados?.brutoServicos || 0);
  const liquidoServicos = numBR(dados?.liquidoServicos || 0);
  const brutoPecas = numBR(dados?.brutoPecas || 0);
  const liquidoPecas = numBR(dados?.liquidoPecas || 0);
  const descontoServicos = Math.max(0, brutoServicos - liquidoServicos);
  const descontoPecas = Math.max(0, brutoPecas - liquidoPecas);
  const card = (titulo, pct, bruto, desc, liquido) => `
    <div style="background:rgba(167,139,250,.08);border:1px solid rgba(167,139,250,.22);border-radius:6px;padding:10px;line-height:1.35;">
      <div style="font-size:.66rem;color:#A78BFA;font-weight:800;letter-spacing:.8px;text-transform:uppercase;">${escOS(titulo)}${pct ? ` · ${escOS(pct)}` : ``}</div>
      <div style="display:flex;justify-content:space-between;gap:8px;color:var(--muted);font-size:.68rem;"><span>Bruto</span><b>${moedaOS(bruto)}</b></div>
      <div style="display:flex;justify-content:space-between;gap:8px;color:var(--warn);font-size:.68rem;"><span>Desconto</span><b>- ${moedaOS(desc)}</b></div>
      <div style="display:flex;justify-content:space-between;gap:8px;color:var(--success);font-size:.72rem;"><span>Líquido</span><b>${moedaOS(liquido)}</b></div>
    </div>`;
  el.innerHTML =
    card('Mão de obra', pctOS(dados?.descMO || 0), brutoServicos, descontoServicos, liquidoServicos) +
    card('Peças', pctOS(dados?.descPeca || 0), brutoPecas, descontoPecas, liquidoPecas) +
    card('Desconto total', '', brutoServicos + brutoPecas, descontoServicos + descontoPecas, liquidoServicos + liquidoPecas);
}
window.atualizarResumoDescontosOS = atualizarResumoDescontosOS;

function garantirResumoDescontoTopoOS() {
  const totalsGrid = document.querySelector('.os-totals-inline') || document.getElementById('osTotalValMirror')?.closest('.os-totals-grid');
  if (!totalsGrid) return null;
  let el = document.getElementById('osResumoDescontosTopoLive');
  if (!el) {
    el = document.createElement('div');
    el.id = 'osResumoDescontosTopoLive';
    el.style.cssText = 'margin-top:10px;display:grid;grid-template-columns:repeat(3,minmax(160px,1fr));gap:8px;font-family:var(--fm);grid-column:1/-1;';
    totalsGrid.insertAdjacentElement('afterend', el);
  }
  return el;
}

function renderResumoDescontoCardsOS(el, dados) {
  if (!el) return;
  const brutoServicos = numBR(dados?.brutoServicos || 0);
  const liquidoServicos = numBR(dados?.liquidoServicos || 0);
  const brutoPecas = numBR(dados?.brutoPecas || 0);
  const liquidoPecas = numBR(dados?.liquidoPecas || 0);
  const descontoServicos = Math.max(0, brutoServicos - liquidoServicos);
  const descontoPecas = Math.max(0, brutoPecas - liquidoPecas);
  const card = (titulo, pct, bruto, desc, liquido) => `
    <div style="background:rgba(167,139,250,.08);border:1px solid rgba(167,139,250,.22);border-radius:6px;padding:9px;line-height:1.35;min-width:0;">
      <div style="font-size:.62rem;color:#A78BFA;font-weight:900;letter-spacing:.8px;text-transform:uppercase;margin-bottom:2px;">${escOS(titulo)}${pct ? ` · ${escOS(pct)}` : ``}</div>
      <div style="display:flex;justify-content:space-between;gap:8px;color:var(--muted);font-size:.66rem;"><span>Bruto</span><b>${moedaOS(bruto)}</b></div>
      <div style="display:flex;justify-content:space-between;gap:8px;color:var(--warn);font-size:.66rem;"><span>Desconto</span><b>- ${moedaOS(desc)}</b></div>
      <div style="display:flex;justify-content:space-between;gap:8px;color:var(--success);font-size:.70rem;"><span>Líquido</span><b>${moedaOS(liquido)}</b></div>
    </div>`;
  el.innerHTML =
    card('Mão de obra / serviços', pctOS(dados?.descMO || 0), brutoServicos, descontoServicos, liquidoServicos) +
    card('Peças', pctOS(dados?.descPeca || 0), brutoPecas, descontoPecas, liquidoPecas) +
    card('Total com desconto', '', brutoServicos + brutoPecas, descontoServicos + descontoPecas, liquidoServicos + liquidoPecas);
}

function atualizarResumoDescontosCompletoOS(dados) {
  atualizarResumoDescontosOS(dados);
  renderResumoDescontoCardsOS(garantirResumoDescontoTopoOS(), dados);
}
window.atualizarResumoDescontosCompletoOS = atualizarResumoDescontosCompletoOS;

function garantirBoxDescontoLinhaOS(row, tipo) {
  if (!row) return null;
  let box = row.querySelector(`.${tipo}-desc-box`);
  if (!box) {
    box = document.createElement('div');
    box.className = `${tipo}-desc-box`;
    box.style.cssText = 'grid-column:1/-1;display:flex;justify-content:flex-end;gap:12px;align-items:center;font-family:var(--fm);font-size:.66rem;color:var(--muted);border-top:1px dashed rgba(255,255,255,.10);padding-top:5px;margin-top:2px;';
    box.innerHTML = `
      <span class="${tipo}-bruto-val">Bruto: R$ 0,00</span>
      <span class="${tipo}-desc-pct" style="color:var(--purple,#A78BFA);">-0,0%</span>
      <span class="${tipo}-desc-econ" style="color:var(--warn);">Desc.: R$ 0,00</span>
      <strong class="${tipo}-desc-val" style="color:var(--success);">Líquido: R$ 0,00</strong>`;
    row.appendChild(box);
  }
  return box;
}

function atualizarBoxDescontoLinhaOS(row, tipo, bruto, liquido, taxa) {
  const box = garantirBoxDescontoLinhaOS(row, tipo);
  if (!box) return;
  const desconto = Math.max(0, numBR(bruto) - numBR(liquido));
  const brutoEl = box.querySelector(`.${tipo}-bruto-val`);
  const pctEl = box.querySelector(`.${tipo}-desc-pct`);
  const econEl = box.querySelector(`.${tipo}-desc-econ`);
  const liqEl = box.querySelector(`.${tipo}-desc-val`);
  if (brutoEl) brutoEl.textContent = `Bruto: ${moedaOS(bruto)}`;
  if (pctEl) pctEl.textContent = '-' + (taxaDescontoOS(taxa) * 100).toFixed(1).replace('.', ',') + '%';
  if (econEl) econEl.textContent = `Desc.: ${moedaOS(desconto)}`;
  if (liqEl) liqEl.textContent = `Líquido: ${moedaOS(liquido)}`;
}

function atualizarMetaServicoLinhaOS(row) {
  if (!row) return;
  const veiculoAtual = window._osVeiculoAtual?.() || {};
  const meta = metaServicoResumoOS({
    codigoTabela: row.dataset?.codigoTabela,
    sistemaTabela: row.dataset?.sistemaTabela || row.dataset?.secaoHoraLabel,
    secaoHoraLabel: row.dataset?.secaoHoraLabel,
    tipoVeiculoTabela: row.dataset?.tipoVeiculoTabela
  }, veiculoAtual);
  if (meta.tipoVeiculo && !row.dataset.tipoVeiculoTabela) row.dataset.tipoVeiculoTabela = meta.tipoVeiculo;
  const temMeta = meta.codigo || meta.sistema || meta.tipoVeiculo;
  let el = row.querySelector('.serv-tempa-info-os');
  if (!temMeta) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement('div');
    el.className = 'serv-tempa-info-os';
    el.style.cssText = 'grid-column:1/-1;font-family:var(--fm);font-size:0.60rem;letter-spacing:.35px;color:var(--muted);background:rgba(0,212,255,.045);border:1px solid rgba(0,212,255,.14);border-radius:4px;padding:5px 7px;line-height:1.35;';
    row.appendChild(el);
  }
  el.innerHTML = `${meta.codigo ? `<b style="color:var(--cyan);">CÓD. ${escOS(meta.codigo)}</b>` : ''}${meta.sistema ? ` · Sistema: ${escOS(meta.sistema)}` : ''}${meta.tipoVeiculo ? ` · Tipo veículo: ${escOS(meta.tipoVeiculo)}` : ''}`;
}

async function auditGeralOS(osId, acao, extra = {}) {
  try {
    const idCurto = osId ? String(osId).slice(-6).toUpperCase() : 'NOVA';
    const texto = `OS #${idCurto} — ${acao}`;
    if (typeof window.audit === 'function') {
      await window.audit('OS', texto, { osId: osId || null, origem: 'jarvis_campos_editaveis', ...extra });
    } else if (typeof audit === 'function') {
      await audit('OS', texto);
    }
  } catch(e) {}
}

const KANBAN_STATUSES = ['Triagem', 'Orcamento', 'Orcamento_Enviado', 'Aprovado', 'Andamento', 'Pronto', 'Entregue'];

const STATUS_MAP_LEGACY = { 
    'Aguardando': 'Triagem', 
    'Concluido': 'Entregue', 
    'patio': 'Triagem', 
    'aprovacao': 'Orcamento_Enviado', 
    'box': 'Andamento', 
    'faturado': 'Pronto', 
    'cancelado': 'Cancelado', 
    'orcamento': 'Orcamento', 
    'pronto': 'Pronto', 
    'entregue': 'Entregue',
    'Triagem': 'Triagem',
    'Orcamento': 'Orcamento',
    'Orcamento_Enviado': 'Orcamento_Enviado',
    'Aprovado': 'Aprovado',
    'Andamento': 'Andamento',
    'Pronto': 'Pronto',
    'Entregue': 'Entregue'
};

window.escutarOS = function() {
  db.collection('ordens_servico').where('tenantId', '==', J.tid).onSnapshot(snap => {
    J.os = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if(typeof window.renderKanban === 'function') window.renderKanban(); 
    if(typeof window.renderDashboard === 'function') window.renderDashboard(); 
    if(typeof window.calcComissoes === 'function') window.calcComissoes();
  });
};

window.renderKanban = function() {
  const busca = ($v('searchOS') || '').toLowerCase();
  const filtroNicho = $v('filtroNichoKanban');
  const cols = {}; const cnts = {};
  KANBAN_STATUSES.forEach(s => { cols[s] = []; cnts[s] = 0; });

  J.os.filter(o => (o.status || '').toLowerCase() !== 'cancelado').forEach(o => {
    const stRaw = o.status || 'Triagem';
    const st = STATUS_MAP_LEGACY[stRaw] || 'Triagem'; 
    
    const v = J.veiculos.find(x => x.id === o.veiculoId) || { placa: o.placa, modelo: o.veiculo, tipo: o.tipoVeiculo };
    const c = J.clientes.find(x => x.id === o.clienteId) || { nome: o.cliente };
    
    if (busca && !(v.placa||'').toLowerCase().includes(busca) && !(c.nome||'').toLowerCase().includes(busca) && !(o.placa||'').toLowerCase().includes(busca)) return;
    if (filtroNicho && v.tipo !== filtroNicho) return;
    
    if (cols[st]) { cols[st].push({ os: o, v, c }); cnts[st]++; }
  });

  KANBAN_STATUSES.forEach(s => {
    const cntEl = $('cnt-' + s); if (cntEl) cntEl.innerText = cnts[s];
    const colEl = $('kb-' + s); if (!colEl) return;
    
    colEl.innerHTML = cols[s].sort((a, b) => new Date(b.os.updatedAt || 0) - new Date(a.os.updatedAt || 0)).map(({ os, v, c }) => {
      const tipoCls = v?.tipo || 'carro';
      const tipoLabel = { carro: '🚗 CARRO', moto: '🏍️ MOTO', bicicleta: '🚲 BICICLETA' }[tipoCls] || '🚗 VEÍCULO';
      const cor = { Triagem: 'var(--muted)', Orcamento: 'var(--warn)', Orcamento_Enviado: 'var(--purple)', Aprovado: 'var(--cyan)', Andamento: '#FF8C00', Pronto: 'var(--success)', Entregue: 'var(--green2)' }[s];
      
      const idx = KANBAN_STATUSES.indexOf(s);
      const sPrev = idx > 0 ? KANBAN_STATUSES[idx - 1] : null;
      const sNext = idx < KANBAN_STATUSES.length - 1 ? KANBAN_STATUSES[idx + 1] : null;
      
      const btnPrev = sPrev ? `<button onclick="event.stopPropagation(); window.moverStatusOS('${os.id}', '${sPrev}')" title="Mover para ${sPrev}" style="background:transparent;border:none;color:var(--muted2);cursor:pointer;padding:4px;"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M15 18l-6-6 6-6"/></svg></button>` : '<div></div>';
      const btnNext = sNext ? `<button onclick="event.stopPropagation(); window.moverStatusOS('${os.id}', '${sNext}')" title="Mover para ${sNext}" style="background:transparent;border:none;color:var(--muted2);cursor:pointer;padding:4px;"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M9 18l6-6-6-6"/></svg></button>` : '<div></div>';

      // Sanitização defensiva contra HTML/script em campos de texto livres
      const esc = s => String(s == null ? '' : s).replace(/[<>&"']/g, ch => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[ch]));
      const nomeCli = esc(c?.nome || os.cliente || 'Cliente Avulso').trim() || 'Cliente Avulso';
      const placaRaw = (os.placa || v?.placa || 'S/PLACA').toString().trim().toUpperCase();
      const placaFmt = placaRaw === 'S/PLACA' ? 'S/PLACA' : esc(placaRaw);
      const UOS = window.JarvisOSUtils || window.JOS || {};
      const resumoValores = UOS.getBudgetSummary
        ? UOS.getBudgetSummary(os, c, J.financeiro)
        : { orcamento: os.total || 0, aprovado: os.totalAprovado || 0, faturado: 0, pagamento: {} };
      const valoresHtml = `
        <div style="display:grid;grid-template-columns:repeat(3,minmax(38px,1fr));gap:3px;margin:7px 0;">
          <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);padding:4px;border-radius:3px;min-width:0;">
            <small style="display:block;font-family:var(--fm);font-size:.44rem;color:var(--muted);letter-spacing:.45px;">ORC.</small>
            <strong style="display:block;font-family:var(--fm);font-size:.54rem;color:var(--warn);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${moeda(resumoValores.orcamento || 0)}</strong>
          </div>
          <div style="background:rgba(0,212,255,.05);border:1px solid rgba(0,212,255,.12);padding:4px;border-radius:3px;min-width:0;">
            <small style="display:block;font-family:var(--fm);font-size:.44rem;color:var(--muted);letter-spacing:.45px;">APROV.</small>
            <strong style="display:block;font-family:var(--fm);font-size:.54rem;color:var(--cyan);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${resumoValores.aprovado ? moeda(resumoValores.aprovado) : '-'}</strong>
          </div>
          <div style="background:rgba(0,255,136,.05);border:1px solid rgba(0,255,136,.12);padding:4px;border-radius:3px;min-width:0;">
            <small style="display:block;font-family:var(--fm);font-size:.44rem;color:var(--muted);letter-spacing:.45px;">FAT.</small>
            <strong style="display:block;font-family:var(--fm);font-size:.54rem;color:var(--success);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${resumoValores.faturado ? moeda(resumoValores.faturado) : '-'}</strong>
          </div>
        </div>`;
      const descFmt = esc(os.desc || os.relato || 'Sem descrição inicial...').substring(0, 120);

      // Botão de exclusão definitiva — visível apenas para admin/gestor/superadmin
      const role = (sessionStorage.getItem('j_role') || '').toLowerCase();
      const ehGestor = ['admin','gestor','gerente','superadmin'].includes(role);
      const btnExcluir = ehGestor
        ? `<button title="Excluir definitivamente esta O.S." onclick="event.stopPropagation();window.excluirOSDef('${os.id}')" style="background:transparent;border:1px solid var(--danger);color:var(--danger);font-family:var(--fm);font-size:0.6rem;padding:3px 7px;border-radius:3px;cursor:pointer;">🗑</button>`
        : '';

      return `<div class="k-card" style="border-left-color:${cor}" onclick="window.prepOS('edit','${os.id}');abrirModal('modalOS')">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px;gap:6px;">
            <div class="k-placa" style="color:${cor};margin:0;font-size:1rem;">${placaFmt}</div>
            ${btnExcluir}
        </div>
        <div class="k-cliente" style="font-size:0.85rem;font-weight:700;color:var(--text);margin-bottom:2px;">${nomeCli}</div>
        <div class="k-desc" style="margin-bottom:8px;">${descFmt}</div>
        ${valoresHtml}
        <div class="k-footer" style="margin-bottom:8px;">
          <span class="k-tipo ${tipoCls}">${tipoLabel}</span>
          <span style="font-family:var(--fm);font-size:0.68rem;color:var(--muted);font-weight:700;">${resumoValores.pagamento?.forma ? esc(resumoValores.pagamento.forma).slice(0, 24) : 'Sem pgto'}</span>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;border-top:1px solid rgba(255,255,255,0.05);padding-top:6px;">
          ${btnPrev}
          <span class="k-date">${dtBr(os.createdAt || os.data)}</span>
          ${btnNext}
        </div>
      </div>`;
    }).join('');
  });
};

window.moverStatusOS = async function(id, novoStatus) {
    // Captura status antigo ANTES de atualizar (para comparar)
    const osAntes = J.os.find(x => x.id === id);
    const statusAntes = osAntes?.status || '';

    if ((novoStatus === 'Aprovado' || novoStatus === 'Andamento') && osAntes && !OSU().hasApproval?.(osAntes)) {
        try {
            const res = await OSU().aprovarOrcamentoComSelecao?.({
                db,
                osId: id,
                novoStatus: novoStatus === 'Andamento' ? 'Aprovado' : novoStatus,
                clientes: J.clientes,
                actorName: J.nome || 'Gestor',
                actorType: 'jarvis',
                toast: window.toast
            });
            if (res) {
                window.toast(`✓ Orçamento aprovado: ${moeda(res.totalAprovado || 0)}`);
                audit('KANBAN', `Aprovou OS ${id.slice(-6)} com seleção de itens`);
            }
        } catch(e) {
            window.toast('Erro ao aprovar itens: ' + e.message, 'err');
        }
        return;
    }

    const updateStatus = { status: novoStatus, updatedAt: new Date().toISOString() };

    if (statusReabreEdicaoOrcamentoOS(novoStatus) && osTemAprovacaoAtivaOS(osAntes)) {
        aplicarReaberturaAprovacaoNoPayloadOS(updateStatus, osAntes, novoStatus, 'kanban');
        const tl = Array.isArray(osAntes.timeline) ? osAntes.timeline.slice() : [];
        tl.push({
            dt: new Date().toISOString(),
            user: J.nome || 'Gestor',
            acao: `Reabriu a O.S. para edição/reorçamento. Aprovação ativa arquivada ao voltar para ${novoStatus}.`
        });
        updateStatus.timeline = tl;
    }

    await db.collection('ordens_servico').doc(id).update(limparUndefinedFirestoreOS(updateStatus));
    window.toast(`✓ Movido para ${novoStatus.replace('_', ' ')}`);
    audit('KANBAN', `Moveu OS ${id.slice(-6)} de "${statusAntes}" para "${novoStatus}"`);

    if (novoStatus === 'Orcamento_Enviado') {
        window.enviarWppB2C(id);
    }

    // Equipe apenas avisa internamente. Gestor/admin confirma Pronto e pode enviar WhatsApp.
    if (novoStatus === 'Pronto' && statusAntes !== 'Pronto') {
        if (usuarioPodeDispararWppProntoOS()) {
            setTimeout(() => {
                if (typeof window.dispararAvisoEntregaAutomatico === 'function') {
                    window.dispararAvisoEntregaAutomatico(id, novoStatus);
                }
            }, 300);
        } else {
            window.notificarAdminOSPronta?.(id, 'jarvis');
        }
        return;
    }

    // WhatsApp automatico somente para entrega confirmada pelo gestor/caixa.
    if ((novoStatus === 'Entregue') && statusAntes !== 'Entregue') {
        setTimeout(() => {
            if (typeof window.dispararAvisoEntregaAutomatico === 'function') {
                window.dispararAvisoEntregaAutomatico(id, novoStatus);
            }
        }, 300);
    }
};

/**
 * Dispara aviso via WhatsApp quando a O.S. fica Pronta ou Entregue.
 * Abre o WhatsApp Web/App com mensagem pré-preenchida. Cliente confirma envio.
 */
window.dispararAvisoEntregaAutomatico = function(id, novoStatus) {
    const os = J.os.find(x => x.id === id);
    if (!os) return;
    const c = J.clientes.find(x => x.id === os.clienteId);
    if (!c?.wpp) {
        window.toast('Cliente sem WhatsApp cadastrado — aviso automático não enviado.', 'warn');
        return;
    }
    const v = J.veiculos.find(x => x.id === os.veiculoId);
    const placaFmt = os.placa || v?.placa || 'seu veículo';
    const modelo = v?.modelo ? ` ${v.modelo}` : '';
    const fone = String(c.wpp).replace(/\D/g, '');

    let msg = '';
    if (novoStatus === 'Pronto') {
        msg = `Olá ${c.nome}! 👋\n\nAqui é da ${J.tnome}.\n\n✅ Seu veículo ${placaFmt}${modelo} está *PRONTO PARA RETIRADA*!\n\nPassamos a O.S. #${id.slice(-6).toUpperCase()} para conferência do caixa. Pode vir buscar quando for melhor pra você.\n\nAguardamos!`;
    } else if (novoStatus === 'Entregue') {
        msg = `Olá ${c.nome}! 👋\n\nAqui é da ${J.tnome}.\n\n🚘 Confirmamos a *ENTREGA* do seu veículo ${placaFmt}${modelo} referente à O.S. #${id.slice(-6).toUpperCase()}.\n\nMuito obrigado pela confiança! Qualquer dúvida pós-serviço, é só chamar por aqui.\n\nBoa estrada! 🛣️`;
    }
    if (!msg) return;

    // Confirma com o usuário antes de abrir o WhatsApp (evita spam involuntário)
    if (confirm(`Enviar aviso automático para ${c.nome} via WhatsApp?\n\n"${msg.substring(0, 200)}..."`)) {
        const url = `https://wa.me/55${fone}?text=${encodeURIComponent(msg)}`;
        window.open(url, '_blank');
        audit('WHATSAPP', `Aviso ${novoStatus === 'Pronto' ? 'PRONTO P/ RETIRADA' : 'ENTREGA CONFIRMADA'} enviado para ${c.nome} (OS ${id.slice(-6).toUpperCase()})`);
    }
};

window.notificarAdminOSPronta = async function(id, origem) {
    try {
        const os = (window.J?.os || []).find(x => x.id === id);
        if (!os || !window.db) return;
        const v = (window.J?.veiculos || []).find(x => x.id === os.veiculoId) || {};
        const c = (window.J?.clientes || []).find(x => x.id === os.clienteId) || {};
        const placa = os.placa || v.placa || 'S/PLACA';
        const msg = `OS #${String(id).slice(-6).toUpperCase()} marcada como PRONTO para retirada. Veiculo: ${placa}${v.modelo ? ' - ' + v.modelo : ''}. Cliente: ${c.nome || os.cliente || '-'}. Conferir e enviar WhatsApp ao cliente quando autorizado.`;
        await db.collection('chat_equipe').add({
            tenantId: J.tid,
            de: os.mecId || J.uid || 'sistema',
            para: 'admin',
            sender: 'equipe',
            msg,
            lidaAdmin: false,
            lidaEquipe: true,
            origem: origem || 'status_pronto',
            osId: id,
            ts: Date.now()
        });
        window.toast?.('Admin avisado no chat da equipe.', 'ok');
    } catch(e) {
        console.warn('Aviso interno OS pronta:', e);
    }
};

window.enviarWppB2C = function(id) {
    const os = J.os.find(x => x.id === id);
    if (!os) return;

    // Busca dados REAIS do cliente no Firebase (J.clientes já carregado)
    const cli = J.clientes.find(x => x.id === os.clienteId);
    const veic = J.veiculos.find(x => x.id === os.veiculoId);

    const cel = cli?.wpp || os.celular || '';
    const cliNome = cli?.nome || os.cliente || 'Cliente';
    const veicLabel = veic ? `${veic.modelo} (${veic.placa})` : (os.veiculo || 'Veículo');

    if (!cel) { window.toast('⚠ Cliente sem WhatsApp cadastrado', 'warn'); return; }

    const fone = cel.replace(/\D/g, '');

    // ✅ Login e PIN REAIS do cadastro do cliente no Firebase
    const loginUser = cli?.login || os.placa || cliNome.split(' ')[0].toLowerCase();
    const pin = cli?.pin || os.pin || '';

    // Link correto: governo → clienteOficial, demais → cliente
    const isGov = cli?.tipoCliente === 'governo';
    const portalBase = isGov
      ? 'https://tsvalencio-ia.github.io/ERP-CODEX3/clienteOficial.html'
      : 'https://tsvalencio-ia.github.io/ERP-CODEX3/cliente.html';
    const link = `${portalBase}?tenant=${encodeURIComponent(J.tid || '')}`;

    const totalFmt = (os.total || 0).toFixed(2).replace('.', ',');

    const msg =
        `Olá ${cliNome.split(' ')[0]}! 👋\n\n` +
        `O orçamento do seu *${veicLabel}* está pronto na *${J.tnome}*.\n\n` +
        `💰 *Total: R$ ${totalFmt}*\n\n` +
        `Acesse seu portal exclusivo para aprovar o serviço:\n` +
        `🔗 Link: ${link}\n` +
        `👤 Usuário: *${loginUser}*\n` +
        `🔑 PIN: *${pin}*\n\n` +
        `_(Em conformidade com a LGPD, seus dados estão protegidos conosco.)_`;

    window.open(`https://wa.me/55${fone}?text=${encodeURIComponent(msg)}`, '_blank');
    window.toast('✓ Redirecionando WhatsApp B2C');
    audit('WHATSAPP', `Enviou Link/PIN para ${os.placa || veicLabel}`);
};

let mediaOSAtual = []; 
let timelineOSAtual = [];


// ═══════════════════════════════════════════════════════════════
// DESLOCAMENTO / GUINCHO — cálculo congelado por O.S.
// Referência: saída até 15 km + adicional por km excedente.
// Leve: saída 253,22 + 8,51/km. Pesado: saída 463,86 + 16,66/km.
// Desconto do guincho é separado de mão de obra e peças.
// ═══════════════════════════════════════════════════════════════
function _numGuinchoOS(value) {
  return numBR(value || 0);
}
function _moedaGuinchoOS(value) {
  return 'R$ ' + _numGuinchoOS(value).toFixed(2).replace('.', ',');
}
function _pctGuinchoOS(value) {
  const pct = _numGuinchoOS(value || 0);
  if (!isFinite(pct)) return 0;
  return Math.max(0, Math.min(100, pct));
}
window.atualizarGuinchoCamposPorTipo = function() {
  const tipo = ($('osGuinchoTipo')?.value || 'leve');
  const saida = $('osGuinchoSaida');
  const kmValor = $('osGuinchoKmValor');
  if (!saida || !kmValor) return;
  if (tipo === 'pesado') {
    saida.value = '463,86';
    kmValor.value = '16,66';
  } else {
    saida.value = '253,22';
    kmValor.value = '8,51';
  }
};
window.calcularDeslocamentoGuinchoOS = function() {
  const ativo = !!$('osGuinchoAtivo')?.checked;
  const tipo = $('osGuinchoTipo')?.value || 'leve';
  const kmTotal = _numGuinchoOS($('osGuinchoKm')?.value || 0);
  const franquiaKm = _numGuinchoOS($('osGuinchoFranquia')?.value || 15) || 15;
  const valorSaida = _numGuinchoOS($('osGuinchoSaida')?.value || (tipo === 'pesado' ? 463.86 : 253.22));
  const valorKmAdicional = _numGuinchoOS($('osGuinchoKmValor')?.value || (tipo === 'pesado' ? 16.66 : 8.51));
  const descontoPct = _pctGuinchoOS($('osGuinchoDesconto')?.value || $('osGuinchoAjuste')?.value || 0);
  const kmExcedente = ativo ? Math.max(kmTotal - franquiaKm, 0) : 0;
  const subtotal = ativo ? +(valorSaida + (kmExcedente * valorKmAdicional)).toFixed(2) : 0;
  const descontoValor = ativo ? +(subtotal * (descontoPct / 100)).toFixed(2) : 0;
  const total = ativo ? +Math.max(0, subtotal - descontoValor).toFixed(2) : 0;
  const obj = {
    ativo,
    tipo,
    tipoLabel: tipo === 'pesado' ? 'Pesado acima de 1.500 kg / van / coletivo / carga / semirreboque acima de 750 kg' : 'Leve até 1.500 kg / moto / semirreboque até 750 kg',
    kmTotal,
    franquiaKm,
    kmExcedente,
    valorSaida,
    valorKmAdicional,
    descontoPct,
    descPct: descontoPct,
    ajustePct: descontoPct,
    subtotal,
    descontoValor,
    total,
    obs: $('osGuinchoObs')?.value?.trim() || ''
  };
  if ($('osGuinchoTotal')) $('osGuinchoTotal').value = _moedaGuinchoOS(total);
  if ($('osTotalGuinchoVal')) $('osTotalGuinchoVal').innerText = total.toFixed(2).replace('.', ',');
  return obj;
};
window.setDeslocamentoGuinchoOS = function(g) {
  g = g || {};
  if ($('osGuinchoAtivo')) $('osGuinchoAtivo').checked = !!g.ativo;
  if ($('osGuinchoTipo')) $('osGuinchoTipo').value = g.tipo || 'leve';
  if ($('osGuinchoKm')) $('osGuinchoKm').value = g.kmTotal != null ? String(g.kmTotal).replace('.', ',') : '';
  if ($('osGuinchoFranquia')) $('osGuinchoFranquia').value = g.franquiaKm != null ? String(g.franquiaKm).replace('.', ',') : '15';
  if ($('osGuinchoSaida')) $('osGuinchoSaida').value = g.valorSaida != null ? Number(g.valorSaida).toFixed(2).replace('.', ',') : (g.tipo === 'pesado' ? '463,86' : '253,22');
  if ($('osGuinchoKmValor')) $('osGuinchoKmValor').value = g.valorKmAdicional != null ? Number(g.valorKmAdicional).toFixed(2).replace('.', ',') : (g.tipo === 'pesado' ? '16,66' : '8,51');
  const desc = g.descontoPct ?? g.descPct ?? g.ajustePct ?? 0;
  if ($('osGuinchoDesconto')) $('osGuinchoDesconto').value = desc != null ? String(desc).replace('.', ',') : '';
  if ($('osGuinchoAjuste')) $('osGuinchoAjuste').value = desc != null ? String(desc).replace('.', ',') : '';
  if ($('osGuinchoObs')) $('osGuinchoObs').value = g.obs || '';
  window.calcularDeslocamentoGuinchoOS?.();
};

async function salvarBlobArquivoOS(blob, fileName, mimeType) {
  const capacitor = window.Capacitor;
  const plugins = capacitor?.Plugins || {};
  const Filesystem = plugins.Filesystem;
  const Share = plugins.Share;
  const isNative = !!(capacitor?.isNativePlatform?.() || capacitor?.getPlatform?.() === 'android' || capacitor?.getPlatform?.() === 'ios');
  if (isNative && Filesystem) {
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result || '').split(',')[1] || '');
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    const directory = Filesystem.Directory?.Documents || 'DOCUMENTS';
    const saved = await Filesystem.writeFile({ path: fileName, data: base64, directory, recursive: true });
    if (Share && saved?.uri) {
      try { await Share.share({ title: fileName, text: fileName, url: saved.uri, dialogTitle: 'Compartilhar arquivo' }); } catch(e) {}
    }
    return saved;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  return { uri: url };
}
window.salvarBlobArquivoOS = salvarBlobArquivoOS;


window.prepOS = function(mode, id = null) {
  ['osId', 'osPlaca', 'osVeiculo', 'osCliente', 'osCelular', 'osCpf', 'osDiagnostico', 'osRelato', 'osDescricao', 'chkObs', 'osKm', 'osData'].forEach(f => { if ($(f)) $(f).value = ''; });
  // Checklist tri-state: limpa valor hidden + botões ativos
  ['chkPainel', 'chkPressao', 'chkCarroceria', 'chkDocumentos'].forEach(f => {
    if ($(f)) $(f).value = '';
    if (typeof window._chkTriApply === 'function') window._chkTriApply(f, '');
  });
  
  if ($('osStatus')) $('osStatus').value = 'Triagem';
  if ($('osTipoVeiculo')) $('osTipoVeiculo').value = 'carro';
  if ($('osData')) $('osData').value = new Date().toISOString().split('T')[0];
  if ($('containerItensOS')) $('containerItensOS').innerHTML = '';
  if ($('containerServicosOS')) $('containerServicosOS').innerHTML = '';
  if ($('containerPecasOS')) $('containerPecasOS').innerHTML = '';
  if ($('containerPecasReais')) $('containerPecasReais').innerHTML = '';
  document.getElementById('resumoAprovacaoOS')?.remove();
  if ($('osTotalVal')) $('osTotalVal').innerText = '0,00';
  if ($('osTotalServicosVal')) $('osTotalServicosVal').innerText = '0,00';
  if ($('osTotalPecasVal')) $('osTotalPecasVal').innerText = '0,00';
  if ($('osTotalGuinchoVal')) $('osTotalGuinchoVal').innerText = '0,00';
  if ($('osTotalValMirror')) $('osTotalValMirror').innerText = '0,00';
  if ($('osSecaoKpisOS')) $('osSecaoKpisOS').innerHTML = '';
  if ($('osTotalHidden')) $('osTotalHidden').value = '0';
  window.setDeslocamentoGuinchoOS?.({ ativo: false, tipo: 'leve', franquiaKm: 15, valorSaida: 253.22, valorKmAdicional: 8.51, descontoPct: 0, kmTotal: 0, obs: '' });
  ['osProxRev','osProxKm','osPgtoForma','osPgtoData','osPgtoParcelas','osDescMO','osDescPeca','osEntregueA','osGuinchoKm','osGuinchoAjuste','osGuinchoDesconto','osGuinchoObs'].forEach(f => { if ($(f)) $(f).value = ''; });
  if ($('osMediaGrid')) $('osMediaGrid').innerHTML = ''; 
  if ($('osMediaArray')) $('osMediaArray').value = '[]';
  if ($('osTimeline')) $('osTimeline').innerHTML = ''; 
  if ($('osTimelineData')) $('osTimelineData').value = '[]';
  if ($('osIdBadge')) $('osIdBadge').innerText = 'NOVA O.S.';
  window.atualizarVisibilidadeDescontosOS?.();
  atualizarResumoDescontosOS({ descMO: 0, descPeca: 0, brutoServicos: 0, liquidoServicos: 0, brutoPecas: 0, liquidoPecas: 0 });
  if ($('btnGerarPDFOS')) $('btnGerarPDFOS').style.display = 'none'; 
  if ($('btnExcluirOS')) $('btnExcluirOS').style.display = 'none';   // só aparece editando OS existente
  if ($('areaPgtoOS')) $('areaPgtoOS').style.display = 'none'; 
  if ($('btnEnviarWppOS')) $('btnEnviarWppOS').style.display = 'none';
  
  window.osPecas = [];
  window.osFotos = [];

  // Limpa também o preview local do batch upload (correção #4)
  if (typeof window.limparOsMediaPreview === 'function') window.limparOsMediaPreview();

  if (typeof window.popularSelects === 'function') window.popularSelects();

  if (mode === 'add') { 
      if(typeof window.adicionarServicoOS === 'function') window.adicionarServicoOS(); 
  }

  if (mode === 'edit' && id) {
    const o = J.os.find(x => x.id === id);
    if (!o) return;

    if ($('osId')) $('osId').value = o.id;
    if ($('osIdBadge')) $('osIdBadge').innerText = 'OS #' + o.id.slice(-6).toUpperCase();
    if ($('osPlaca')) $('osPlaca').value = o.placa || '';
    if ($('osTipoVeiculo')) $('osTipoVeiculo').value = o.tipoVeiculo || o.tipo || 'carro';
    
    if ($('osCliente')) {
        $('osCliente').value = o.clienteId || '';
        if(typeof window.filtrarVeiculosOS === 'function') window.filtrarVeiculosOS(); 
    }
    setTimeout(() => { if ($('osVeiculo')) $('osVeiculo').value = o.veiculoId || o.veiculo || ''; }, 100);

    if ($('osMec')) $('osMec').value = o.mecId || ''; 
    if ($('osCelular')) $('osCelular').value = o.celular || '';
    if ($('osCpf')) $('osCpf').value = o.cpf || '';
    if ($('osStatus')) $('osStatus').value = STATUS_MAP_LEGACY[o.status] || o.status || 'Triagem';
    if ($('osDiagnostico')) $('osDiagnostico').value = o.diagnostico || '';
    if ($('osRelato')) $('osRelato').value = o.relato || '';
    if ($('osDescricao')) $('osDescricao').value = o.desc || o.relato || '';
    if ($('osData')) $('osData').value = o.data || ''; 
    if ($('osKm')) $('osKm').value = o.km || '';
    if ($('osEntregueA')) {
      $('osEntregueA').value = o.entreguePara || '';
      const r = document.getElementById('rowEntregueA');
      if (r) r.style.display = (o.status === 'Entregue') ? 'flex' : 'none';
    }
    // Desconto personalizado desta OS
    if ($('osDescMO')) $('osDescMO').value = o.descMO != null ? (parseFloat(o.descMO)*100).toFixed(1) : '';
    if ($('osDescPeca')) $('osDescPeca').value = o.descPeca != null ? (parseFloat(o.descPeca)*100).toFixed(1) : '';
    window.setDeslocamentoGuinchoOS?.(o.deslocamentoGuincho || o.guincho || {});
    // Mostra blocos governo se cliente for gov
    const _cli_load = (window.J?.clientes||[]).find(cl=>cl.id===o.clienteId);
    const _ehGov_load = _cli_load?.tipoCliente === 'governo';
    const _blocoDesc = document.getElementById('blocoDescontoOS');
    const _blocoReais = document.getElementById('blocoReais');
    if (_blocoDesc) window.atualizarVisibilidadeDescontosOS?.();
    if (_blocoReais) {
      // Somente dono (perfil admin) vê peças reais
      const _isDono = ['admin','superadmin'].includes((window.J?.role||'').toLowerCase());
      _blocoReais.style.display = _isDono ? 'block' : 'none';
    }
    // Carregar peças reais
    if ($('containerPecasReais')) {
      $('containerPecasReais').innerHTML = '';
      (o.pecasReais || []).forEach(p => window.adicionarPecaRealRow(p));
    }
    // LOTE C — Traz próxima revisão ao editar
    if ($('osProxRev')) $('osProxRev').value = o.proxRev || '';
    if ($('osProxKm'))  $('osProxKm').value  = o.proxKm  || '';
    // LOTE B — Traz forma de pagamento e parcelas
    if ($('osPgtoForma')) $('osPgtoForma').value = o.pgtoForma || '';
    if ($('osPgtoData'))  $('osPgtoData').value  = o.pgtoData  || '';
    if ($('osPgtoParcelas')) $('osPgtoParcelas').value = o.pgtoParcelas || 1;
    
    window.osPecas = o.pecas || [];
    window.osFotos = o.media || o.fotos || [];
    
    if(typeof window.renderItensOS === 'function') window.renderItensOS();
    
    const servicosOS = Array.isArray(o.servicos) ? o.servicos : [];
    const pecasOS = Array.isArray(o.pecas) ? o.pecas : [];
    const servicosCiliaPorPeca = {};
    const servicosNormais = [];
    servicosOS.forEach(s => {
        if (s && s.relacionadoCilia && s.ciliaPieceIndex !== undefined && s.ciliaPieceIndex !== null && String(s.ciliaPieceIndex) !== '') {
            const key = String(s.ciliaPieceIndex);
            if (!servicosCiliaPorPeca[key]) servicosCiliaPorPeca[key] = [];
            servicosCiliaPorPeca[key].push(s);
        } else {
            servicosNormais.push(s);
        }
    });

    if (servicosNormais.length > 0 && typeof window.renderServicoOSRow === 'function') {
        servicosNormais.forEach(s => window.renderServicoOSRow(s));
    } else if (o.maoObra > 0 && typeof window.renderServicoOSRow === 'function' && servicosOS.length === 0) {
        window.renderServicoOSRow({ desc: 'Mão de Obra Geral', valor: o.maoObra });
    }

    if (pecasOS.length > 0 && typeof window.renderPecaOSRow === 'function') {
        pecasOS.forEach(p => {
            const isCilia = p && p.ciliaPieceIndex !== undefined && p.ciliaPieceIndex !== null && String(p.ciliaPieceIndex) !== '';
            if (isCilia && typeof window.renderCiliaPecaOSRow === 'function') {
                window.renderCiliaPecaOSRow(p, servicosCiliaPorPeca[String(p.ciliaPieceIndex)] || []);
            } else {
                window.renderPecaOSRow(p);
            }
        });
    }

    if (typeof window.aplicarMarcadoresAprovacaoOS === 'function') {
      window.aplicarMarcadoresAprovacaoOS(o);
    }

    if ($('chkComb')) $('chkComb').value = o.chkComb || 'N/A'; 
    if ($('chkPneuDia')) $('chkPneuDia').value = o.chkPneuDia || ''; 
    if ($('chkPneuTra')) $('chkPneuTra').value = o.chkPneuTra || ''; 
    if ($('chkObs')) $('chkObs').value = o.chkObs || '';
    
    // LOTE 1.5 — Checklist tri-state: aceita formato antigo (boolean) e novo (string 'ok'/'atencao'/'critico')
    const _toTri = v => (v === true || v === 'ok') ? 'ok' : (v === 'atencao' || v === 'critico') ? v : '';
    if (typeof window._chkTriApply === 'function') {
      window._chkTriApply('chkPainel',     _toTri(o.chkPainel));
      window._chkTriApply('chkPressao',    _toTri(o.chkPressao));
      window._chkTriApply('chkCarroceria', _toTri(o.chkCarroceria));
      window._chkTriApply('chkDocumentos', _toTri(o.chkDocumentos));
    } else {
      // Fallback compatível com versão antiga
      if (o.chkPainel && $('chkPainel')) $('chkPainel').value = _toTri(o.chkPainel);
      if (o.chkPressao && $('chkPressao')) $('chkPressao').value = _toTri(o.chkPressao);
      if (o.chkCarroceria && $('chkCarroceria')) $('chkCarroceria').value = _toTri(o.chkCarroceria);
      if (o.chkDocumentos && $('chkDocumentos')) $('chkDocumentos').value = _toTri(o.chkDocumentos);
    }

    if($('osTimelineData') && o.timeline) {
        $('osTimelineData').value = JSON.stringify(o.timeline);
        window.renderTimelineOS();
    }
    
    if($('osMediaArray')) {
        $('osMediaArray').value = JSON.stringify(window.osFotos);
        window.renderMediaOS();
    }
    
    window.calcOSTotal();
    window.verificarStatusOS();
    
    // Auto-preenche placa na busca histórica com a placa desta OS
    const _elBuscaPlaca = document.getElementById('histBuscaPlaca');
    if (_elBuscaPlaca && o.placa) _elBuscaPlaca.value = (o.placa||'').toUpperCase();
    const _elBuscaRes = document.getElementById('histBuscaResultado');
    if (_elBuscaRes) _elBuscaRes.innerHTML = '';

    if ($('btnGerarPDFOS')) $('btnGerarPDFOS').style.display = 'block';

    // Botão de exclusão só aparece se for admin/gestor (e estiver editando OS existente)
    if ($('btnExcluirOS')) {
      const role = (sessionStorage.getItem('j_role') || '').toLowerCase();
      const ehGestor = ['admin','gestor','gerente','superadmin'].includes(role);
      $('btnExcluirOS').style.display = ehGestor ? 'block' : 'none';
      $('btnExcluirOS').dataset.osId = id;
    }

    // Botão Exportar Orçamento PMSP — aparece SOMENTE se cliente é governamental
    if ($('btnExportarPMSP')) {
      const ehGov = typeof window._osClienteGovernamental === 'function' && window._osClienteGovernamental();
      $('btnExportarPMSP').style.display = ehGov ? 'block' : 'none';
      $('btnExportarPMSP').dataset.osId = id;
    }
  }
};

// Helper para o botão "EXCLUIR O.S." dentro do modal — pega o ID do dataset e chama excluirOSDef
window._excluirOSDoModal = async function() {
  const btn = document.getElementById('btnExcluirOS');
  const id = btn?.dataset?.osId;
  if (!id) return;
  if (typeof window.excluirOSDef === 'function') {
    const ok = await window.excluirOSDef(id);
    if (ok && typeof window.fecharModal === 'function') {
      window.fecharModal('modalOS');
    }
  }
};

window.adicionarItemOS = function(item = null) {
    const div = document.createElement('div');
    div.style.cssText = 'display:grid;grid-template-columns:1fr 60px 80px 80px 32px;gap:8px;align-items:center;margin-bottom:8px;';
    div.innerHTML = `
        <input class="j-input os-item-desc" value="${item ? item.desc : ''}" placeholder="Descrição">
        <input type="number" class="j-input os-item-qtd" value="${item ? item.q : 1}" min="1" oninput="window.calcOSTotal()">
        <input type="number" class="j-input os-item-venda" value="${item ? (item.v || item.venda) : 0}" step="0.01" oninput="window.calcOSTotal()">
        <select class="j-select os-item-tipo" onchange="window.calcOSTotal()">
            <option value="peca" ${item && item.t === 'peca' ? 'selected' : ''}>Peça</option>
            <option value="servico" ${item && item.t === 'servico' ? 'selected' : ''}>M.O.</option>
        </select>
        <button type="button" onclick="this.parentElement.remove();window.calcOSTotal()" style="background:rgba(255,59,59,0.1);border:1px solid rgba(255,59,59,0.3);border-radius:2px;color:var(--danger);cursor:pointer;width:32px;height:32px;">✕</button>
    `;
    if($('containerItensOS')) $('containerItensOS').appendChild(div);
};

window.renderItensOS = function() {
    if (!$('containerItensOS')) return;
    $('containerItensOS').innerHTML = '';
    window.osPecas.forEach(p => window.adicionarItemOS(p));
    window.calcOSTotal();
};

window._osValorHoraCliente = function() {
  const dadosGov = typeof window._osDadosGovernamental === 'function' ? window._osDadosGovernamental() : null;
  const cliId = document.getElementById('osCliente')?.value;
  const cli = (window.J?.clientes || []).find(c => c.id === cliId) || null;
  return numBR(dadosGov?.valorHora || cli?.govValorHora || cli?.valorHora || window.J?.valorHoraMecanica || 0);
};

window._osVeiculoAtual = function() {
  const id = document.getElementById('osVeiculo')?.value;
  return (window.J?.veiculos || []).find(v => v.id === id) || {};
};

function fmtHoraOS(value) {
  return numBR(value).toFixed(2).replace('.', ',');
}

window._osSecaoHoraOptions = function(selected) {
  const rates = OSU().getPMSPValoresHora?.() || [];
  const opts = ['<option value="">Sem selecao / manual</option>'];
  rates.forEach(rate => {
    opts.push(`<option value="${escOS(rate.key)}" ${rate.key === selected ? 'selected' : ''}>${escOS(rate.label)} - R$ ${fmtHoraOS(rate.valor)}/h</option>`);
  });
  return opts.join('');
};

window.aplicarSecaoMaoObraOS = function(row, key, options) {
  if (!row) return null;
  const opts = options || {};
  const select = row.querySelector('.serv-secao-hora');
  const horaInput = row.querySelector('.serv-valor-hora');
  const rate = key ? OSU().getPMSPValorHora?.(key) : null;

  if (select) select.value = rate ? rate.key : '';
  row.dataset.secaoHora = rate ? rate.key : '';
  row.dataset.secaoHoraLabel = rate ? rate.label : '';
  row.dataset.valorHoraSecao = rate ? String(rate.valor) : '';

  if (horaInput && opts.preserveValorHora !== true) {
    horaInput.value = rate ? fmtHoraOS(rate.valor) : '';
    row.dataset.valorHoraManual = rate ? '0' : '';
  }
  if (opts.recalcular !== false) window.atualizarValorServicoPorHora(row);
  return rate;
};

window.atualizarSecaoMaoObraOS = function(select) {
  const row = select?.closest('div');
  if (!row) return;
  window.aplicarSecaoMaoObraOS(row, select.value, { recalcular: true });
};

window.atualizarValorServicoPorHora = function(row) {
  if (!row) return;
  const tempo = numBR(row.querySelector('.serv-tempo')?.value || 0);
  const horaInput = row.querySelector('.serv-valor-hora');
  const valorHora = horaInput ? numBR(horaInput.value || 0) : window._osValorHoraCliente();
  const valorInput = row.querySelector('.serv-valor');
  if (tempo > 0 && valorHora > 0 && valorInput && row.dataset.valorManual !== '1') {
    valorInput.value = (tempo * valorHora).toFixed(2).replace('.', ',');
  }
  window.calcOSTotal?.();
};

window.adicionarServicoOS = function() {
  const sel = document.createElement('div');
  const ehGov = typeof window._osClienteGovernamental === 'function' && window._osClienteGovernamental();
  const dadosGov = ehGov && typeof window._osDadosGovernamental === 'function' ? window._osDadosGovernamental() : null;
  const descMO = dadosGov ? taxaDescontoOS(dadosGov.descMO || 0) : 0;
  if (ehGov) {
    sel.style.cssText = 'display:grid;grid-template-columns:minmax(150px,0.9fr) minmax(210px,1.4fr) 70px 90px 110px 90px 32px;gap:8px;align-items:center;margin-bottom:8px;';
    sel.innerHTML = `
      <select class="j-select serv-secao-hora" onchange="window.atualizarSecaoMaoObraOS(this)" title="Secao oficial da mao de obra PMSP. Use Sem selecao/manual quando nao houver correspondencia segura.">${window._osSecaoHoraOptions('')}</select>
      <input type="text" class="j-input serv-desc" placeholder="Ex: Alinhamento, Troca de Freio..." oninput="window.calcOSTotal()">
      <input type="text" inputmode="decimal" class="j-input serv-tempo" placeholder="TMO h" title="Tempo de Mão de Obra (horas)" oninput="window.atualizarValorServicoPorHora(this.closest('div'))" style="text-align:center;font-family:var(--fm);font-size:0.78rem;color:var(--warn);">
      <input type="text" inputmode="decimal" class="j-input serv-valor-hora" value="" placeholder="R$/h" oninput="this.closest('div').dataset.valorHoraManual='1';window.atualizarValorServicoPorHora(this.closest('div'))" title="Valor da hora trabalhada desta seção. Vem da tabela oficial quando selecionada, mas é editável pelo admin." style="text-align:center;font-family:var(--fm);font-size:0.78rem;color:var(--cyan);">
      <input type="text" inputmode="decimal" class="j-input serv-valor" value="0,00" placeholder="Total serv." oninput="this.closest('div').dataset.valorManual='1';window.calcOSTotal()" title="Valor bruto total do serviço. Calculado por TMO x valor/hora quando não estiver manual.">
      <div class="serv-desc-box" style="font-family:var(--fm);font-size:0.72rem;color:var(--ok);text-align:right;line-height:1.2;">
        <div class="serv-desc-pct" style="color:var(--purple,#A78BFA);font-size:0.65rem;">-${(descMO*100).toFixed(0)}%</div>
        <div class="serv-desc-val">R$ 0,00</div>
      </div>
      <button type="button" onclick="this.parentElement.remove();window.calcOSTotal()" style="background:rgba(255,59,59,0.1);border:1px solid rgba(255,59,59,0.3);border-radius:2px;color:var(--danger);cursor:pointer;width:32px;height:32px;">✕</button>
    `;
  } else {
    sel.style.cssText = 'display:grid;grid-template-columns:1fr 70px 100px 32px;gap:8px;align-items:center;margin-bottom:8px;';
    sel.innerHTML = `
      <input type="text" class="j-input serv-desc" placeholder="Ex: Alinhamento, Troca de Freio..." oninput="window.calcOSTotal()">
      <input type="text" inputmode="decimal" class="j-input serv-tempo" placeholder="TMO h" title="Tempo de Mão de Obra (horas)" oninput="window.atualizarValorServicoPorHora(this.closest('div'))" style="text-align:center;font-family:var(--fm);font-size:0.78rem;color:var(--warn);">
      <input type="text" inputmode="decimal" class="j-input serv-valor" value="0,00" placeholder="R$ 0,00" oninput="this.closest('div').dataset.valorManual='1';window.calcOSTotal()" title="Valor bruto do serviço. Editável pelo admin.">
      <button type="button" onclick="this.parentElement.remove();window.calcOSTotal()" style="background:rgba(255,59,59,0.1);border:1px solid rgba(255,59,59,0.3);border-radius:2px;color:var(--danger);cursor:pointer;width:32px;height:32px;">✕</button>
    `;
  }
  if($('containerServicosOS')) $('containerServicosOS').appendChild(sel);
};

window.renderServicoOSRow = function(s) {
  const div = document.createElement('div');
  div.dataset.codigoTabela = s.codigoTabela || s.codigo || '';
  div.dataset.sistemaTabela = s.sistemaTabela || s.sistema || '';
  div.dataset.tipoVeiculoTabela = s.tipoVeiculoTabela || s.tipoVeiculoTempa || s.tipoVeiculo || extrairTipoVeiculoTempaOS(s, window._osVeiculoAtual?.() || {});
  div.dataset.tempoTabela = s.tempoTabela || s.tempo || '';
  const ehGov = typeof window._osClienteGovernamental === 'function' && window._osClienteGovernamental();
  const dadosGov = ehGov && typeof window._osDadosGovernamental === 'function' ? window._osDadosGovernamental() : null;
  const descMO = dadosGov ? taxaDescontoOS(dadosGov.descMO || 0) : 0;
  const vBruto = numBR(s.valor || 0);
  const vFinal = +(vBruto * (1 - descMO)).toFixed(2);
  if (ehGov) {
    const resolvido = OSU().resolvePMSPServico?.(s, { veiculo: window._osVeiculoAtual?.(), fallbackValorHora: window._osValorHoraCliente?.() }) || {};
    const secaoKey = s.secaoHora || resolvido.secaoHora || '';
    const valorHora = numBR(s.valorHora || s.valorHoraSecao || resolvido.valorHora || 0);
    div.dataset.secaoHora = secaoKey;
    div.dataset.secaoHoraLabel = s.secaoHoraLabel || resolvido.secaoHoraLabel || '';
    div.dataset.valorHoraSecao = s.valorHoraTabela || resolvido.valorHoraTabela || '';
    div.dataset.valorHoraManual = s.valorHoraManual ? '1' : '';
    div.style.cssText = 'display:grid;grid-template-columns:minmax(150px,0.9fr) minmax(210px,1.4fr) 70px 90px 110px 90px 32px;gap:8px;align-items:center;margin-bottom:8px;';
    div.innerHTML = `
      <select class="j-select serv-secao-hora" onchange="window.atualizarSecaoMaoObraOS(this)" title="Secao oficial da mao de obra PMSP. Use Sem selecao/manual quando nao houver correspondencia segura.">${window._osSecaoHoraOptions(secaoKey)}</select>
      <input type="text" class="j-input serv-desc" value="${escOS(s.desc || '')}" placeholder="Descrição do Serviço" oninput="window.calcOSTotal()">
      <input type="text" inputmode="decimal" class="j-input serv-tempo" value="${String(s.tempo || '').replace('.', ',')}" placeholder="TMO h" title="Tempo de Mão de Obra (horas)" oninput="window.atualizarValorServicoPorHora(this.closest('div'))" style="text-align:center;font-family:var(--fm);font-size:0.78rem;color:var(--warn);">
      <input type="text" inputmode="decimal" class="j-input serv-valor-hora" value="${valorHora ? valorHora.toFixed(2).replace('.', ',') : ''}" placeholder="R$/h" oninput="this.closest('div').dataset.valorHoraManual='1';window.atualizarValorServicoPorHora(this.closest('div'))" title="Valor da hora trabalhada desta seção. Vem da tabela oficial quando selecionada, mas é editável pelo admin." style="text-align:center;font-family:var(--fm);font-size:0.78rem;color:var(--cyan);">
      <input type="text" inputmode="decimal" class="j-input serv-valor" value="${vBruto.toFixed(2).replace('.', ',')}" placeholder="Total serv." oninput="this.closest('div').dataset.valorManual='1';window.calcOSTotal()" title="Valor bruto total do serviço. Calculado por TMO x valor/hora quando não estiver manual.">
      <div class="serv-desc-box" style="font-family:var(--fm);font-size:0.72rem;color:var(--ok);text-align:right;line-height:1.2;">
        <div class="serv-desc-pct" style="color:var(--purple,#A78BFA);font-size:0.65rem;">-${(descMO*100).toFixed(0)}%</div>
        <div class="serv-desc-val">R$ ${vFinal.toFixed(2).replace('.',',')}</div>
      </div>
      <button type="button" onclick="this.parentElement.remove();window.calcOSTotal()" style="background:rgba(255,59,59,0.1);border:1px solid rgba(255,59,59,0.3);border-radius:2px;color:var(--danger);cursor:pointer;width:32px;height:32px;">✕</button>
    `;
  } else {
    div.style.cssText = 'display:grid;grid-template-columns:1fr 70px 100px 32px;gap:8px;align-items:center;margin-bottom:8px;';
    div.innerHTML = `
      <input type="text" class="j-input serv-desc" value="${escOS(s.desc || '')}" placeholder="Descrição do Serviço" oninput="window.calcOSTotal()">
      <input type="text" inputmode="decimal" class="j-input serv-tempo" value="${String(s.tempo || '').replace('.', ',')}" placeholder="TMO h" title="Tempo de Mão de Obra (horas)" oninput="window.atualizarValorServicoPorHora(this.closest('div'))" style="text-align:center;font-family:var(--fm);font-size:0.78rem;color:var(--warn);">
      <input type="text" inputmode="decimal" class="j-input serv-valor" value="${vBruto.toFixed(2).replace('.', ',')}" placeholder="R$ 0,00" oninput="this.closest('div').dataset.valorManual='1';window.calcOSTotal()" title="Valor bruto do serviço. Editável pelo admin.">
      <button type="button" onclick="this.parentElement.remove();window.calcOSTotal()" style="background:rgba(255,59,59,0.1);border:1px solid rgba(255,59,59,0.3);border-radius:2px;color:var(--danger);cursor:pointer;width:32px;height:32px;">✕</button>
    `;
  }
  if($('containerServicosOS')) $('containerServicosOS').appendChild(div);
  atualizarMetaServicoLinhaOS(div);
};

window.adicionarPecaOS = function() {
  const ehGov = typeof window._osClienteGovernamental === 'function' && window._osClienteGovernamental();
  const sel = document.createElement('div');

  if (ehGov) {
    // Cliente governamental — peça AVULSA com badge de desconto
    const dadosGovP = typeof window._osDadosGovernamental === 'function' ? window._osDadosGovernamental() : null;
    const descPecaP = dadosGovP ? taxaDescontoOS(dadosGovP.descPeca || 0) : 0;
    const colsGov = descPecaP > 0
      ? '120px 1fr 60px 100px 80px 32px'
      : '120px 1fr 60px 100px 32px';
    sel.style.cssText = `display:grid;grid-template-columns:${colsGov};gap:8px;align-items:center;background:rgba(167,139,250,0.06);padding:8px;border-radius:3px;border:1px solid rgba(167,139,250,0.2);`;
    sel.dataset.pecaAvulsa = '1';
    const badgePeca = descPecaP > 0 ? `
      <div class="peca-desc-box" style="font-family:var(--fm);font-size:0.72rem;color:var(--ok);text-align:right;line-height:1.2;">
        <div class="peca-desc-pct" style="color:var(--purple,#A78BFA);font-size:0.65rem;">-${(descPecaP*100).toFixed(0)}%</div>
        <div class="peca-desc-val">R$ 0,00</div>
      </div>` : '';
    sel.innerHTML = `
      <input type="text" class="j-input peca-codigo" placeholder="Código original" title="Código original do fabricante (ex: 5207381)" style="font-family:var(--fm);font-size:0.78rem;">
      <input type="text" class="j-input peca-desc-livre" placeholder="Descrição da peça (ex: AMORTECEDOR DIANT. DIREITO)" oninput="window.calcOSTotal()">
      <input type="number" class="j-input peca-qtd" value="1" min="1" placeholder="Qtd" oninput="window.calcOSTotal()" title="Quantidade da peça no orçamento">
      <input type="text" inputmode="decimal" class="j-input peca-venda" value="0,00" placeholder="Valor unit. registrado" oninput="window.calcOSTotal()" title="Valor unitário da ata de registro de preço">
      ${badgePeca}
      <button type="button" onclick="this.parentElement.remove();window.calcOSTotal()" style="background:rgba(255,59,59,0.1);border:1px solid rgba(255,59,59,0.3);border-radius:2px;color:var(--danger);cursor:pointer;width:32px;height:32px;">✕</button>
    `;
  } else {
    // Cliente normal — usa estoque, mas permite peça avulsa se não tiver no estoque
    sel.style.cssText = 'display:grid;grid-template-columns:1fr 80px 90px 90px 32px;gap:8px;align-items:center;';
    const opts = '<option value="">Selecionar peça...</option>'
      + J.estoque.filter(p => (p.qtd || 0) > 0).map(p => `<option value="${p.id}" data-venda="${p.venda || 0}" data-desc="${p.desc || ''}">[${p.qtd}un] ${p.desc} — ${moeda(p.venda)}</option>`).join('')
      + '<option value="__avulsa__" data-venda="0" data-desc="">➕ Peça não cadastrada (digitar manualmente)</option>';
    sel.innerHTML = `
      <select class="j-select peca-sel" onchange="window.selecionarPecaOS(this)">${opts}</select>
      <input type="number" class="j-input peca-qtd" value="1" min="1" placeholder="Qtd" oninput="window.calcOSTotal()" title="Quantidade da peça no orçamento">
      <input type="text" inputmode="decimal" class="j-input peca-custo" value="0,00" placeholder="Custo" oninput="window.calcOSTotal()" title="Custo unitário interno da peça">
      <input type="text" inputmode="decimal" class="j-input peca-venda" value="0,00" placeholder="Venda" oninput="window.calcOSTotal()" title="Valor unitário de venda/orçamento da peça">
      <button type="button" onclick="this.parentElement.remove();window.calcOSTotal()" style="background:rgba(255,59,59,0.1);border:1px solid rgba(255,59,59,0.3);border-radius:2px;color:var(--danger);cursor:pointer;width:32px;height:32px;">✕</button>
    `;
  }
  if($('containerPecasOS')) $('containerPecasOS').appendChild(sel); window.calcOSTotal();
};

window.renderPecaOSRow = function(p) {
  const div = document.createElement('div');
  const ehGov = typeof window._osClienteGovernamental === 'function' && window._osClienteGovernamental();
  const dadosGov = ehGov && typeof window._osDadosGovernamental === 'function' ? window._osDadosGovernamental() : null;
  const descPeca = dadosGov ? taxaDescontoOS(dadosGov.descPeca || 0) : 0;

  if (ehGov && p.codigo !== undefined) {
    // Peça avulsa (governo) — mostra código + desc + qtd + valor + badge desconto
    const vBruto = numBR(p.venda || p.v || 0);
    const qtd = numBR(p.qtd || p.q || 1) || 1;
    const vFinal = +((qtd * vBruto) * (1 - descPeca)).toFixed(2);
    const colsGov = descPeca > 0 ? '120px 1fr 60px 100px 80px 32px' : '120px 1fr 60px 100px 32px';
    div.style.cssText = `display:grid;grid-template-columns:${colsGov};gap:8px;align-items:center;background:rgba(167,139,250,0.06);padding:8px;border-radius:3px;border:1px solid rgba(167,139,250,0.2);`;
    div.dataset.pecaAvulsa = '1';
    const badgePeca = descPeca > 0 ? `
      <div class="peca-desc-box" style="font-family:var(--fm);font-size:0.72rem;color:var(--ok);text-align:right;line-height:1.2;">
        <div class="peca-desc-pct" style="color:var(--purple,#A78BFA);font-size:0.65rem;">-${(descPeca*100).toFixed(0)}%</div>
        <div class="peca-desc-val">R$ ${vFinal.toFixed(2).replace('.',',')}</div>
      </div>` : '';
    div.innerHTML = `
      <input type="text" class="j-input peca-codigo" value="${escOS(p.codigo || '')}" placeholder="Código original" style="font-family:var(--fm);font-size:0.78rem;" title="Código original/OEM da peça">
      <input type="text" class="j-input peca-desc-livre" value="${escOS(p.desc || '')}" placeholder="Descrição da peça" oninput="window.calcOSTotal()" title="Descrição da peça no orçamento">
      <input type="number" class="j-input peca-qtd" value="${qtd}" min="1" oninput="window.calcOSTotal()" title="Quantidade da peça no orçamento">
      <input type="text" inputmode="decimal" class="j-input peca-venda" value="${vBruto.toFixed(2).replace('.', ',')}" placeholder="Valor unit. registrado" oninput="window.calcOSTotal()" title="Valor unitário da peça no orçamento">
      ${badgePeca}
      <button type="button" onclick="this.parentElement.remove();window.calcOSTotal()" style="background:rgba(255,59,59,0.1);border:1px solid rgba(255,59,59,0.3);border-radius:2px;color:var(--danger);cursor:pointer;width:32px;height:32px;">✕</button>
    `;
  } else {
    // Cliente normal (estoque)
    const vBruto = numBR(p.venda || p.v || 0);
    div.style.cssText = 'display:grid;grid-template-columns:1fr 80px 90px 90px 32px;gap:8px;align-items:center;';
    const opts = '<option value="">' + p.desc + '</option>' + (J.estoque||[]).filter(x => (x.qtd || 0) > 0 || x.id === p.estoqueId).map(x => `<option value="${x.id}" data-venda="${x.venda || 0}" data-desc="${x.desc || ''}" ${x.id === p.estoqueId ? 'selected' : ''}>[${x.qtd}un] ${x.desc}</option>`).join('');
    div.innerHTML = `
      <select class="j-select peca-sel" onchange="window.selecionarPecaOS(this)">${opts}</select>
      <input type="number" class="j-input peca-qtd" value="${p.qtd || p.q || 1}" min="1" oninput="window.calcOSTotal()" title="Quantidade da peça no orçamento">
      <input type="text" inputmode="decimal" class="j-input peca-custo" value="${numBR(p.custo || p.c || 0).toFixed(2).replace('.', ',')}" oninput="window.calcOSTotal()" title="Custo unitário interno da peça">
      <input type="text" inputmode="decimal" class="j-input peca-venda" value="${vBruto.toFixed(2).replace('.', ',')}" oninput="window.calcOSTotal()" title="Valor unitário de venda/orçamento da peça">
      <button type="button" onclick="this.parentElement.remove();window.calcOSTotal()" style="background:rgba(255,59,59,0.1);border:1px solid rgba(255,59,59,0.3);border-radius:2px;color:var(--danger);cursor:pointer;width:32px;height:32px;">✕</button>
    `;
  }
  if($('containerPecasOS')) $('containerPecasOS').appendChild(div);
};

window.selecionarPecaOS = function(sel) {
  const opt = sel.options[sel.selectedIndex];
  if (opt.value === '__avulsa__') {
    // Transforma a linha em entrada manual (igual ao modo governo, mas sem código original)
    const row = sel.parentElement;
    row.dataset.pecaAvulsa = '1';
    row.style.cssText = 'display:grid;grid-template-columns:1fr 80px 90px 90px 32px;gap:8px;align-items:center;background:rgba(255,165,0,0.06);padding:4px;border-radius:3px;border:1px solid rgba(255,165,0,0.25);';
    row.innerHTML = `
      <input type="text" class="j-input peca-desc-livre" placeholder="Descrição da peça" oninput="window.calcOSTotal()">
      <input type="number" class="j-input peca-qtd" value="1" min="1" placeholder="Qtd" oninput="window.calcOSTotal()" title="Quantidade da peça no orçamento">
      <input type="text" inputmode="decimal" class="j-input peca-custo" value="0,00" placeholder="Custo" oninput="window.calcOSTotal()" title="Custo unitário interno da peça">
      <input type="text" inputmode="decimal" class="j-input peca-venda" value="0,00" placeholder="Venda" oninput="window.calcOSTotal()" title="Valor unitário de venda/orçamento da peça">
      <button type="button" onclick="this.parentElement.remove();window.calcOSTotal()" style="background:rgba(255,59,59,0.1);border:1px solid rgba(255,59,59,0.3);border-radius:2px;color:var(--danger);cursor:pointer;width:32px;height:32px;">✕</button>
    `;
    row.querySelector('.peca-desc-livre').focus();
  } else {
    sel.parentElement.querySelector('.peca-venda').value = numBR(opt.dataset.venda || 0).toFixed(2).replace('.', ',');
  }
  window.calcOSTotal();
};

window.renderResumoSecoesOS = function(resumoSecoes) {
    const el = $('osSecaoKpisOS');
    if (!el) return;
    const rows = Object.entries(resumoSecoes || {})
      .filter(([, item]) => item.horas || item.total)
      .sort((a, b) => b[1].total - a[1].total);
    if (!rows.length) { el.innerHTML = ''; return; }
    const moedaLocal = v => 'R$ ' + numBR(v).toFixed(2).replace('.', ',');
    el.innerHTML = rows.map(([secao, item]) => {
      const codigos = listaResumoOS(item.codigos, 8);
      const tipos = listaResumoOS(item.tiposVeiculo, 3);
      const sistemas = listaResumoOS(item.sistemas, 3);
      return `
      <div class="os-secao-kpi">
        <small>${escOS(secao)}</small>
        <strong>${moedaLocal(item.total)}</strong>
        <span>${item.horas.toFixed(2).replace('.', ',')}h em ${item.qtd} servico(s)</span>
        ${codigos ? `<span style="display:block;margin-top:3px;color:var(--cyan);">Cód.: ${escOS(codigos)}</span>` : ''}
        ${tipos ? `<span style="display:block;color:var(--muted);">Tipo veículo: ${escOS(tipos)}</span>` : ''}
        ${sistemas ? `<span style="display:block;color:var(--muted);">Sistema: ${escOS(sistemas)}</span>` : ''}
      </div>`;
    }).join('');
};

window.calcOSTotal = function() {
    let total = 0;
    let totalServicos = 0;
    let totalPecas = 0;
    let brutoServicos = 0;
    let brutoPecas = 0;
    const resumoSecoesOS = {};

    // Desconto: prioriza campo da OS; fallback para padrão do cadastro do cliente
    const ehGov = typeof window._osClienteGovernamental === 'function' && window._osClienteGovernamental();
    const dadosGov = ehGov && typeof window._osDadosGovernamental === 'function' ? window._osDadosGovernamental() : null;
    const _osDescMOField = document.getElementById('osDescMO');
    const _osDescPecaField = document.getElementById('osDescPeca');
    const _osDescMOVal = _osDescMOField?.value?.trim();
    const _osDescPecaVal = _osDescPecaField?.value?.trim();
    // Se preenchido na OS, usa ele; senão usa padrão do cliente (já em decimal 0-1)
    const descMO   = _osDescMOVal   !== '' && _osDescMOVal   != null ? taxaDescontoOS(_osDescMOVal)   : taxaDescontoOS(dadosGov?.descMO   || 0);
    const descPeca = _osDescPecaVal !== '' && _osDescPecaVal != null ? taxaDescontoOS(_osDescPecaVal) : taxaDescontoOS(dadosGov?.descPeca || 0);
    window.atualizarVisibilidadeDescontosOS?.();

    document.querySelectorAll('#containerItensOS > div').forEach(div => {
        const q = numBR(div.querySelector('.os-item-qtd')?.value || 0);
        const v = numBR(div.querySelector('.os-item-venda')?.value || 0);
        const bruto = q * v;
        brutoPecas += bruto;
        totalPecas += bruto;
    });

    document.querySelectorAll('#containerServicosOS > div').forEach(row => {
        const vBruto = numBR(row.querySelector('.serv-valor')?.value || 0);
        const vFinal = +(vBruto * (1 - descMO)).toFixed(2);
        brutoServicos += vBruto;
        const tempo = numBR(row.querySelector('.serv-tempo')?.value || 0);
        const desc = row.querySelector('.serv-desc')?.value?.trim() || '';
        // Atualiza badge de desconto em tempo real
        const descBox = row.querySelector('.serv-desc-val');
        const pctBox = row.querySelector('.serv-desc-pct');
        if (pctBox) pctBox.textContent = '-' + (descMO * 100).toFixed(1).replace('.', ',') + '%';
        if (descBox) descBox.textContent = 'R$ ' + vFinal.toFixed(2).replace('.', ',');
        atualizarBoxDescontoLinhaOS(row, 'serv', vBruto, vFinal, descMO);
        totalServicos += vFinal;
        if (desc || vBruto || tempo) {
            const sel = row.querySelector('.serv-secao-hora');
            const sistema = sel?.options?.[sel.selectedIndex]?.text?.replace(/\s+-\s+R\$.*/, '') || row.dataset.secaoHoraLabel || row.dataset.sistemaTabela || '';
            const categoria = classificarSecaoResumoOS({
                secaoHoraLabel: sistema,
                sistemaTabela: row.dataset.sistemaTabela,
                sistema: row.dataset.sistemaTabela,
                codigoTabela: row.dataset.codigoTabela,
                tipoVeiculoTabela: row.dataset.tipoVeiculoTabela,
                desc
            });
            if (!resumoSecoesOS[categoria]) resumoSecoesOS[categoria] = { horas: 0, total: 0, qtd: 0, codigos: new Set(), sistemas: new Set(), tiposVeiculo: new Set() };
            resumoSecoesOS[categoria].horas += tempo;
            resumoSecoesOS[categoria].total += vFinal;
            resumoSecoesOS[categoria].qtd += 1;
            addMetaResumoServicoOS(resumoSecoesOS[categoria], metaServicoResumoOS({
                codigoTabela: row.dataset.codigoTabela,
                sistemaTabela: row.dataset.sistemaTabela || sistema,
                secaoHoraLabel: sistema,
                tipoVeiculoTabela: row.dataset.tipoVeiculoTabela
            }, window._osVeiculoAtual?.() || {}));
            atualizarMetaServicoLinhaOS(row);
        }
    });

    // Serviços relacionados a peças importadas do Cília também entram no total e no resumo por seção
    document.querySelectorAll('#containerPecasOS .cilia-serv-relac').forEach(row => {
        const vBruto = numBR(row.querySelector('.serv-valor')?.value || 0);
        const vFinal = +(vBruto * (1 - descMO)).toFixed(2);
        brutoServicos += vBruto;
        const tempo = numBR(row.querySelector('.serv-tempo')?.value || 0);
        const desc = row.querySelector('.serv-desc')?.value?.trim() || '';
        const descBox = row.querySelector('.serv-desc-val');
        const pctBox = row.querySelector('.serv-desc-pct');
        if (pctBox) pctBox.textContent = '-' + (descMO * 100).toFixed(1).replace('.', ',') + '%';
        if (descBox) descBox.textContent = 'R$ ' + vFinal.toFixed(2).replace('.', ',');
        atualizarBoxDescontoLinhaOS(row, 'serv', vBruto, vFinal, descMO);
        totalServicos += vFinal;
        if (desc || vBruto || tempo) {
            const sel = row.querySelector('.serv-secao-hora');
            const sistema = sel?.options?.[sel.selectedIndex]?.text?.replace(/\s+-\s+R\$.*/, '') || row.dataset.secaoHoraLabel || row.dataset.sistemaTabela || '';
            const categoria = classificarSecaoResumoOS({
                secaoHora: row.dataset.secaoHora || sel?.value || '',
                secaoHoraLabel: sistema,
                sistemaTabela: row.dataset.sistemaTabela,
                sistema: row.dataset.sistemaTabela,
                codigoTabela: row.dataset.codigoTabela,
                tipoVeiculoTabela: row.dataset.tipoVeiculoTabela,
                desc
            });
            if (!resumoSecoesOS[categoria]) resumoSecoesOS[categoria] = { horas: 0, total: 0, qtd: 0, codigos: new Set(), sistemas: new Set(), tiposVeiculo: new Set() };
            resumoSecoesOS[categoria].horas += tempo;
            resumoSecoesOS[categoria].total += vFinal;
            resumoSecoesOS[categoria].qtd += 1;
            addMetaResumoServicoOS(resumoSecoesOS[categoria], metaServicoResumoOS({
                codigoTabela: row.dataset.codigoTabela,
                sistemaTabela: row.dataset.sistemaTabela || sistema,
                secaoHoraLabel: sistema,
                tipoVeiculoTabela: row.dataset.tipoVeiculoTabela
            }, window._osVeiculoAtual?.() || {}));
        }
    });

    document.querySelectorAll('#containerPecasOS [data-peca-avulsa="1"], #containerPecasOS > div:not(.cilia-peca-wrap)').forEach(row => {
        const qtd   = numBR(row.querySelector('.peca-qtd')?.value   || 0);
        const venda = numBR(row.querySelector('.peca-venda')?.value  || 0);
        const vBruto = qtd * venda;
        const vFinal = +(vBruto * (1 - descPeca)).toFixed(2);
        brutoPecas += vBruto;
        // Atualiza badge de desconto em tempo real
        const descBox = row.querySelector('.peca-desc-val');
        const pctBox = row.querySelector('.peca-desc-pct') || row.querySelector('.peca-desc-box div:first-child');
        if (pctBox) pctBox.textContent = '-' + (descPeca * 100).toFixed(1).replace('.', ',') + '%';
        if (descBox) descBox.textContent = 'R$ ' + vFinal.toFixed(2).replace('.', ',');
        atualizarBoxDescontoLinhaOS(row, 'peca', vBruto, vFinal, descPeca);
        totalPecas += vFinal;
    });

    const guinchoOS = window.calcularDeslocamentoGuinchoOS?.() || { ativo: false, total: 0 };
    const totalGuincho = guinchoOS.ativo ? _numGuinchoOS(guinchoOS.total || 0) : 0;
    total = +(totalServicos + totalPecas + totalGuincho).toFixed(2);
    if ($('osTotalGuinchoVal')) $('osTotalGuinchoVal').innerText = totalGuincho.toFixed(2).replace('.', ',');
    if ($('osTotalVal')) $('osTotalVal').innerText = total.toFixed(2).replace('.', ',');
    if ($('osTotalServicosVal')) $('osTotalServicosVal').innerText = totalServicos.toFixed(2).replace('.', ',');
    if ($('osTotalPecasVal')) $('osTotalPecasVal').innerText = totalPecas.toFixed(2).replace('.', ',');
    if ($('osTotalValMirror')) $('osTotalValMirror').innerText = total.toFixed(2).replace('.', ',');
    if ($('osTotalHidden')) $('osTotalHidden').value = total;
    atualizarResumoDescontosCompletoOS({
      descMO,
      descPeca,
      brutoServicos,
      liquidoServicos: totalServicos,
      brutoPecas,
      liquidoPecas: totalPecas,
      totalGuincho: (typeof totalGuincho !== 'undefined' ? totalGuincho : 0),
      total
    });
    window.renderResumoSecoesOS(resumoSecoesOS);
};

window.verificarStatusOS = function() {
  const s = $v('osStatus');
  if($('areaPgtoOS')) $('areaPgtoOS').style.display = (s === 'Pronto' || s === 'Entregue' || s === 'pronto' || s === 'entregue') ? 'block' : 'none';
  if($('btnEnviarWppOS')) $('btnEnviarWppOS').style.display = (s === 'Orcamento_Enviado' || s === 'orcamento' || s === 'aprovacao') && $v('osId') ? 'flex' : 'none';
  if($('btnAvisarProntoOS')) $('btnAvisarProntoOS').style.display = (s === 'Pronto' || s === 'pronto') && $v('osId') ? 'inline-flex' : 'none';
};

window.checkPgtoOS = function() {
  const f = $v('osPgtoForma');
  if($('divParcelasOS')) $('divParcelasOS').style.display = (f === 'Crédito Parcelado' || f === 'Boleto') ? 'block' : 'none';
};

window.salvarOS = async function() {
  const osId = $v('osId');
  if ($('osPlaca') && !$v('osPlaca')) { window.toast('⚠ Preencha a Placa', 'warn'); return; }
  if ($('osCliente') && $('osVeiculo') && !$v('osCliente') && !$v('osVeiculo')) { window.toast('⚠ Selecione cliente e veículo', 'warn'); return; }

  const itens = [];
  document.querySelectorAll('#containerItensOS > div').forEach(div => {
    const desc = div.querySelector('.os-item-desc').value.trim();
    const q = numBR(div.querySelector('.os-item-qtd').value || 0);
    const v = numBR(div.querySelector('.os-item-venda').value || 0);
    const t = div.querySelector('.os-item-tipo').value;
    if (desc && q > 0) itens.push({ desc, q, v, t });
  });

  const servicos = []; 
  let totalMaoObra = 0;

  // Função local que lê uma linha de serviço e empurra pro array
  const _lerLinhaServico = (row) => {
    const desc = row.querySelector('.serv-desc')?.value || '';
    const valor = numBR(row.querySelector('.serv-valor')?.value || 0);
    const tempoStr = row.querySelector('.serv-tempo')?.value || '';
    const tempo = numBR(tempoStr) || 0;
    const codigoTabela = row.dataset?.codigoTabela || '';
    const sistemaTabela = row.dataset?.sistemaTabela || '';
    const tipoVeiculoTabela = row.dataset?.tipoVeiculoTabela || extrairTipoVeiculoTempaOS({ sistemaTabela, sistema: sistemaTabela, secaoHoraLabel: row.dataset?.secaoHoraLabel }, window._osVeiculoAtual?.() || {});
    if (tipoVeiculoTabela && !row.dataset.tipoVeiculoTabela) row.dataset.tipoVeiculoTabela = tipoVeiculoTabela;
    const secaoHora = row.querySelector('.serv-secao-hora')?.value || row.dataset?.secaoHora || '';
    const secaoInfo = secaoHora ? OSU().getPMSPValorHora?.(secaoHora) : null;
    let valorHora = numBR(row.querySelector('.serv-valor-hora')?.value || row.dataset?.valorHoraSecao || (tempo > 0 ? valor / tempo : 0));
    if (row.dataset?.valorManual === '1' && row.dataset?.valorHoraManual !== '1' && tempo > 0 && valor > 0) {
      valorHora = +(valor / tempo).toFixed(2);
    }
    const valorHoraTabela = secaoInfo ? numBR(secaoInfo.valor) : numBR(row.dataset?.valorHoraSecao || 0);
    const secaoHoraLabel = secaoInfo?.label || row.dataset?.secaoHoraLabel || '';
    const valorHoraManual = row.dataset?.valorHoraManual === '1' || (valorHoraTabela > 0 && valorHora > 0 && Math.abs(valorHora - valorHoraTabela) > 0.009);
    if (desc || valor > 0) {
      servicos.push({
        desc,
        valor,
        tempo,
        codigoTabela,
        sistemaTabela,
        tipoVeiculoTabela,
        secaoHora,
        secaoHoraLabel,
        valorHora,
        valorHoraTabela,
        valorHoraManual,
        tempaManual: row.dataset?.tempaManual === '1',
        relacionadoCilia: row.dataset?.servRelacionado === '1',
        origemServico: row.dataset?.servRelacionado === '1'
          ? (codigoTabela ? (row.dataset?.tempaManual === '1' ? 'cilia_tabela_tempa_editado' : 'cilia_tabela_tempa') : 'cilia_manual')
          : 'manual',
        ciliaPieceIndex: row.closest?.('.cilia-peca-wrap')?.dataset?.ciliaPieceIndex || row.dataset?.ciliaPieceIndex || ''
      });
      totalMaoObra += valor;
    }
  };

  document.querySelectorAll('#containerServicosOS > div').forEach(_lerLinhaServico);
  // CORREÇÃO 6: também lê serviços relacionados Cilia (dentro das peças)
  document.querySelectorAll('#containerPecasOS .cilia-serv-relac').forEach(_lerLinhaServico);

  const pecas = [];
  let totalPecas = 0;
  document.querySelectorAll('#containerPecasOS [data-peca-avulsa="1"], #containerPecasOS > div:not(.cilia-peca-wrap)').forEach(row => {
    // Peça AVULSA (cliente governo)
    if (row.dataset?.pecaAvulsa === '1') {
      const codigo = row.querySelector('.peca-codigo')?.value || '';
      const descLivre = row.querySelector('.peca-desc-livre')?.value || '';
      const qtd = numBR(row.querySelector('.peca-qtd')?.value || 1) || 1;
      const venda = numBR(row.querySelector('.peca-venda')?.value || 0);
      if (descLivre || codigo) {
        totalPecas += (qtd * venda);
        pecas.push({
          avulsa: true,        // marcador
          estoqueId: '',       // não baixa estoque
          codigo: codigo,
          desc: descLivre,
          qtd: qtd,
          custo: 0,
          venda: venda,
          ciliaBruto: numBR(row.dataset?.ciliaBruto || venda),
          ciliaValorLiquido: numBR(row.dataset?.ciliaLiquido || 0),
          ciliaDesconto: numBR(row.dataset?.ciliaDesconto || 0),
          ciliaPieceIndex: row.dataset?.ciliaPieceIndex || row.closest?.('.cilia-peca-wrap')?.dataset?.ciliaPieceIndex || ''
        });
      }
      return;
    }
    // Peça normal (estoque)
    const sel = row.querySelector('.peca-sel');
    const opt = sel?.options[sel.selectedIndex];
    const qtd = numBR(row.querySelector('.peca-qtd')?.value || 1) || 1;
    const venda = numBR(row.querySelector('.peca-venda')?.value || 0);
    const custo = numBR(row.querySelector('.peca-custo')?.value || 0);
    totalPecas += (qtd * venda);

    pecas.push({
      estoqueId: sel?.value,
      desc: opt?.dataset.desc || opt?.text || '',
      qtd: qtd, custo: custo, venda: venda
    });
  });

  const totalFormatado = $('osTotalVal') ? $('osTotalVal').innerText : 0;
  const total = numBR(totalFormatado);
  
  const payload = {
    tenantId: J.tid,
    status: $v('osStatus'),
    total: total,
    updatedAt: new Date().toISOString()
  };

  if ($v('osPlaca')) payload.placa = $v('osPlaca').toUpperCase();
  if ($v('osVeiculo')) payload.veiculo = $v('osVeiculo');
  if ($('osVeiculo') && $('osVeiculo').tagName === 'SELECT') payload.veiculoId = $v('osVeiculo');
  if ($v('osCliente')) payload.cliente = $v('osCliente');
  if ($('osCliente') && $('osCliente').tagName === 'SELECT') payload.clienteId = $v('osCliente');
  if ($v('osCelular')) payload.celular = $v('osCelular');
  if ($v('osCpf')) payload.cpf = $v('osCpf');
  if ($v('osDiagnostico')) payload.diagnostico = $v('osDiagnostico');
  if ($v('osRelato')) payload.relato = $v('osRelato');
  if ($v('osDescricao')) payload.desc = $v('osDescricao');
  if ($v('osMec')) payload.mecId = $v('osMec');
  if ($v('osData')) payload.data = $v('osData');
  if ($v('osKm')) payload.km = $v('osKm');
  if ($v('osEntregueA')) payload.entreguePara = $v('osEntregueA');
  // Desconto personalizado desta OS (converte % para decimal)
  const _descMOval = $v('osDescMO');
  const _descPecaval = $v('osDescPeca');
  if (_descMOval !== '' && _descMOval != null) payload.descMO = taxaDescontoOS(_descMOval);
  if (_descPecaval !== '' && _descPecaval != null) payload.descPeca = taxaDescontoOS(_descPecaval);
  const guinchoPayload = window.calcularDeslocamentoGuinchoOS?.() || { ativo: false, total: 0 };
  payload.deslocamentoGuincho = guinchoPayload;
  payload.totalGuincho = guinchoPayload.ativo ? _numGuinchoOS(guinchoPayload.total || 0) : 0;
  // Peças realmente instaladas (somente dono)
  const _pecasReais = [];
  document.querySelectorAll('#containerPecasReais > div').forEach(row => {
    const pr = {
      codigo: row.querySelector('.pr-codigo')?.value?.trim() || '',
      desc: row.querySelector('.pr-desc')?.value?.trim() || '',
      qtd: numBR(row.querySelector('.pr-qtd')?.value || 1) || 1,
      fornecedor: row.querySelector('.pr-fornec')?.value?.trim() || '',
      nf: row.querySelector('.pr-nf')?.value?.trim() || '',
      dataCompra: row.querySelector('.pr-datacompra')?.value?.trim() || '',
      valorCompra: numBR(row.querySelector('.pr-valor')?.value || 0),
      estoqueId: row.querySelector('.pr-estoque')?.value || ''
    };
    if (pr.desc || pr.codigo) _pecasReais.push(pr);
  });
  if (document.getElementById('containerPecasReais')) payload.pecasReais = _pecasReais;
  // LOTE C — Persistir próxima revisão (data e/ou KM) para o cliente ver
  if ($v('osProxRev')) payload.proxRev = $v('osProxRev');
  if ($v('osProxKm'))  payload.proxKm  = $v('osProxKm');
  // Checklist tri-state (cada campo vale '', 'ok', 'atencao' ou 'critico')
  ['chkPainel','chkPressao','chkCarroceria','chkDocumentos'].forEach(f => {
    const v = $v(f);
    if (v) payload[f] = v;
  });
  if ($v('chkObs')) payload.chkObs = $v('chkObs');
  if ($v('chkPneuDia')) payload.chkPneuDia = $v('chkPneuDia');
  if ($v('chkPneuTra')) payload.chkPneuTra = $v('chkPneuTra');
  if ($v('chkComb')) payload.chkComb = $v('chkComb');
  
  // GRAVA ARRAYS SEMPRE. Se o usuário removeu todos os serviços/peças e salvar,
  // o Firestore precisa receber [] para apagar o que existia antes.
  // Antes só gravava quando length > 0, por isso exclusão visual voltava ao reabrir a OS.
  payload.pecasLegacy = itens;
  payload.servicos = servicos;
  payload.pecas = pecas;
  payload.maoObra = totalMaoObra;

  // Mapeia media para o payload antes do Deep Diff para podermos comparar
  if ($('osMediaArray')) {
      payload.media = JSON.parse($('osMediaArray').value || '[]');
  }

  const oldOSParaAprovacao = osId ? (J.os.find(x => x.id === osId) || {}) : {};
  const statusPedeAprovacao = ['Aprovado', 'Andamento'].includes(payload.status);
  const reabrindoParaEdicaoOS = !!(osId && statusReabreEdicaoOrcamentoOS(payload.status) && osTemAprovacaoAtivaOS(oldOSParaAprovacao));
  let registroReaberturaAprovacaoOS = null;

  if (reabrindoParaEdicaoOS) {
      // Ao voltar uma O.S. aprovada para Triagem/Orçamento, ela precisa ficar editável.
      // A aprovação NÃO é apagada da história: ela é arquivada em aprovacaoHistorico.
      // Os campos ativos são removidos para não manter "aprovação fantasma" bloqueando serviços/peças.
      registroReaberturaAprovacaoOS = aplicarReaberturaAprovacaoNoPayloadOS(payload, oldOSParaAprovacao, payload.status, 'salvar_os');
  } else if (statusPedeAprovacao && !osTemAprovacaoAtivaOS(oldOSParaAprovacao)) {
      const cliAprov = (J.clientes || []).find(c => c.id === payload.clienteId);
      const aprov = await OSU().openApprovalModal?.({ id: osId || 'nova-os', ...oldOSParaAprovacao, ...payload }, {
          clientes: J.clientes,
          cliente: cliAprov,
          toast: window.toast
      });
      if (!aprov) return;
      payload.status = 'Aprovado';
      payload.aprovacao = {
          status: aprov.status,
          aprovadoEm: new Date().toISOString(),
          aprovadoPor: J.nome || 'Gestor',
          aprovadoPorTipo: 'jarvis',
          totalOrcamento: aprov.totalOrcamento,
          totalAprovado: aprov.totalAprovado,
          itens: aprov.itens
      };
      payload.itensAprovados = aprov.keys;
      payload.totalAprovado = aprov.totalAprovado;
      payload.aprovacaoAtiva = true;
  } else if (!statusReabreEdicaoOrcamentoOS(payload.status) && osTemAprovacaoAtivaOS(oldOSParaAprovacao)) {
      payload.totalAprovado = oldOSParaAprovacao.totalAprovado;
      payload.aprovacao = oldOSParaAprovacao.aprovacao;
      payload.itensAprovados = oldOSParaAprovacao.itensAprovados || oldOSParaAprovacao.aprovacao?.itens?.map(i => i.key) || [];
      if (oldOSParaAprovacao.execucaoItens) payload.execucaoItens = oldOSParaAprovacao.execucaoItens;
      payload.aprovacaoAtiva = oldOSParaAprovacao.aprovacaoAtiva !== false;
  }

  // --- INÍCIO: DEEP DIFF E GATILHOS (AUDITORIA E WHATSAPP) ---
  const funcUser = J.nome || 'Mecânico/Gestor';
  let tl = [];
  let dispararAvisoEntrega = false;
  let dispararAvisoPronto = false;
  const auditoriaGeralOS = [];

  if (osId) {
      const oldOS = J.os.find(x => x.id === osId) || {};
      tl = oldOS.timeline ? [...oldOS.timeline] : JSON.parse($('osTimelineData')?.value || '[]');
      let registouAlgo = false;
      let alterouCampoAuditavel = false;
      const addAuditoriaCampo = acao => {
          auditoriaGeralOS.push(acao);
          alterouCampoAuditavel = true;
      };
      const fmtAudit = v => {
          if (v == null || v === '') return 'vazio';
          if (typeof v === 'number') return String(v).replace('.', ',');
          return String(v);
      };
      const normAudit = v => JSON.stringify(v == null ? '' : v);
      const auditCampoSeMudou = (key, label) => {
          if (!Object.prototype.hasOwnProperty.call(payload, key)) return;
          if (normAudit(oldOS[key]) !== normAudit(payload[key])) {
              addAuditoriaCampo(`${label}: "${fmtAudit(oldOS[key])}" -> "${fmtAudit(payload[key])}"`);
          }
      };

      // 1. Mudança de Status e Gatilhos de Notificação
      if (oldOS.status !== payload.status) {
          const novoStatusLegivel = STATUS_MAP_LEGACY[payload.status] || payload.status;
          tl.push({ dt: new Date().toISOString(), user: funcUser, acao: `Status alterado para: ${novoStatusLegivel}` });
          registouAlgo = true;
          
          // Equipe avisa internamente; admin/gestor confirma Pronto e pode abrir WhatsApp ao cliente.
          if (payload.status === 'Pronto' && oldOS.status !== 'Pronto') {
              if (usuarioPodeDispararWppProntoOS()) dispararAvisoPronto = true;
              else window.notificarAdminOSPronta?.(osId, 'jarvis_salvar');
          }
          if ((payload.status === 'Entregue') && oldOS.status !== 'Entregue') {
              dispararAvisoEntrega = true;
          }
      }

      // 2. Mudança de Diagnóstico (Texto exato)
      const oldDiag = (oldOS.diagnostico || '').trim();
      const novoDiag = (payload.diagnostico || '').trim();
      if (novoDiag && novoDiag !== oldDiag) {
          tl.push({ dt: new Date().toISOString(), user: funcUser, acao: `Diagnóstico Técnico preenchido/atualizado: "${novoDiag}"` });
          registouAlgo = true;
      }

      // 3. Verificação Individual de Checklist (agora tri-state: ok/atencao/critico)
      const mapCheck = { 
          chkPainel: 'Painel/Instrumentos', 
          chkPressao: 'Pressão dos Pneus', 
          chkCarroceria: 'Carroceria/Pintura', 
          chkDocumentos: 'Documentos' 
      };
      const mapEstadoLabel = { ok: '✓ OK', atencao: '⚠ ATENÇÃO', critico: '✕ CRÍTICO', '': 'neutro' };
      ['chkPainel', 'chkPressao', 'chkCarroceria', 'chkDocumentos'].forEach(chk => {
          // Compatibilidade: antigo era boolean (true/false), novo é string ('ok'/'atencao'/'critico')
          const oldValRaw = oldOS[chk];
          const newValRaw = payload[chk];
          const oldVal = (oldValRaw === true || oldValRaw === 'ok') ? 'ok'
                       : (oldValRaw === 'atencao' || oldValRaw === 'critico') ? oldValRaw : '';
          const newVal = newValRaw || '';
          if (oldVal !== newVal) {
              const labelDe = mapEstadoLabel[oldVal] || 'neutro';
              const labelPara = mapEstadoLabel[newVal] || 'neutro';
              addAuditoriaCampo(`Checklist "${mapCheck[chk]}": ${labelDe} -> ${labelPara}`);
          }
      });

      // 3b. Mudança de mecânico responsável
      if (oldOS.mecId !== payload.mecId && payload.mecId) {
          const mecOld = (J.equipe || []).find(m => m.id === oldOS.mecId);
          const mecNovo = (J.equipe || []).find(m => m.id === payload.mecId);
          addAuditoriaCampo(`Mecanico responsavel: ${mecOld?.nome || '-'} -> ${mecNovo?.nome || '-'}`);
      }

      // 3c. Mudança de KM
      if (oldOS.km && payload.km && String(oldOS.km).trim() !== String(payload.km).trim()) {
          addAuditoriaCampo(`KM do veiculo: ${oldOS.km} -> ${payload.km}`);
      }

      // 3d. Mudança de cliente vinculado
      if (oldOS.clienteId && payload.clienteId && oldOS.clienteId !== payload.clienteId) {
          const cOld = (J.clientes || []).find(c => c.id === oldOS.clienteId);
          const cNovo = (J.clientes || []).find(c => c.id === payload.clienteId);
          addAuditoriaCampo(`Cliente vinculado: "${cOld?.nome || '-'}" -> "${cNovo?.nome || '-'}"`);
      }

      [
          ['placa', 'Placa'],
          ['veiculo', 'Veiculo'],
          ['veiculoId', 'Veiculo vinculado'],
          ['celular', 'Celular'],
          ['cpf', 'CPF/Documento'],
          ['relato', 'Relato/queixa'],
          ['desc', 'Descricao geral'],
          ['data', 'Data da OS'],
          ['entreguePara', 'Entregue para'],
          ['descMO', 'Desconto mao de obra'],
          ['descPeca', 'Desconto pecas'],
          ['proxRev', 'Proxima revisao - data'],
          ['proxKm', 'Proxima revisao - KM'],
          ['chkObs', 'Observacoes do checklist'],
          ['chkPneuDia', 'Pneu dianteiro'],
          ['chkPneuTra', 'Pneu traseiro'],
          ['chkComb', 'Nivel combustivel']
      ].forEach(([key, label]) => auditCampoSeMudou(key, label));

      // 4. Identificação de Peças (Adições, Remoções, Alterações de Qtd/Valor)
      const oldPecas = oldOS.pecas || [];
      const newPecas = payload.pecas || [];
      
      newPecas.forEach(newP => {
          const descNovo = (newP.desc || '').toLowerCase().trim();
          const oldP = oldPecas.find(p => (p.desc || '').toLowerCase().trim() === descNovo);
          
          if (!oldP) {
              tl.push({ dt: new Date().toISOString(), user: funcUser, acao: `Adicionou peça: ${newP.desc} (Qtd: ${newP.qtd})` });
              registouAlgo = true;
          } else {
              if (numBR(oldP.qtd || 0) !== numBR(newP.qtd || 0) || numBR(oldP.venda || 0) !== numBR(newP.venda || 0)) {
                  addAuditoriaCampo(`Alterou peca "${newP.desc}" para Qtd: ${newP.qtd} / Valor: R$ ${(newP.venda||0).toFixed(2).replace('.', ',')}`);
              }
          }
      });
      
      oldPecas.forEach(oldP => {
           const descOld = (oldP.desc || '').toLowerCase().trim();
           const newP = newPecas.find(p => (p.desc || '').toLowerCase().trim() === descOld);
           if (!newP) {
               tl.push({ dt: new Date().toISOString(), user: funcUser, acao: `Removeu peça: ${oldP.desc}` });
               registouAlgo = true;
           }
      });

      // 5. Identificação de Serviços (Adições, Remoções, Alterações de Valor)
      const oldServicos = oldOS.servicos || [];
      const newServicos = payload.servicos || [];
      
      newServicos.forEach(newS => {
          const descNovo = (newS.desc || '').toLowerCase().trim();
          const oldS = oldServicos.find(s => (s.desc || '').toLowerCase().trim() === descNovo);
          
          if (!oldS) {
              tl.push({ dt: new Date().toISOString(), user: funcUser, acao: `Adicionou serviço: ${newS.desc}` });
              registouAlgo = true;
          } else {
              if (numBR(oldS.valor || 0) !== numBR(newS.valor || 0)) {
                  addAuditoriaCampo(`Alterou valor do servico "${newS.desc}" para R$ ${(newS.valor||0).toFixed(2).replace('.', ',')}`);
              }
              if (numBR(oldS.tempo || 0) !== numBR(newS.tempo || 0)) {
                  addAuditoriaCampo(`Alterou horas/TMO do servico "${newS.desc}" de ${String(oldS.tempo || 0).replace('.', ',')}h para ${String(newS.tempo || 0).replace('.', ',')}h`);
              }
              if ((oldS.secaoHora || '') !== (newS.secaoHora || '') || (oldS.secaoHoraLabel || '') !== (newS.secaoHoraLabel || '')) {
                  addAuditoriaCampo(`Alterou secao de mao de obra do servico "${newS.desc}" de "${oldS.secaoHoraLabel || oldS.sistemaTabela || '-'}" para "${newS.secaoHoraLabel || newS.sistemaTabela || '-'}"`);
              }
              if (numBR(oldS.valorHora || 0) !== numBR(newS.valorHora || 0)) {
                  addAuditoriaCampo(`Alterou valor/hora do servico "${newS.desc}" de R$ ${numBR(oldS.valorHora || 0).toFixed(2).replace('.', ',')} para R$ ${numBR(newS.valorHora || 0).toFixed(2).replace('.', ',')}`);
              }
          }
      });
      
      oldServicos.forEach(oldS => {
           const descOld = (oldS.desc || '').toLowerCase().trim();
           const newS = newServicos.find(s => (s.desc || '').toLowerCase().trim() === descOld);
           if (!newS) {
               tl.push({ dt: new Date().toISOString(), user: funcUser, acao: `Removeu serviço: ${oldS.desc}` });
               registouAlgo = true;
           }
      });

      // 6. Novas Fotos/Evidências
      const oldMediaLength = (oldOS.media || oldOS.fotos || []).length;
      const newMediaLength = (payload.media || []).length;
      if (newMediaLength > oldMediaLength) {
          const adicionadas = newMediaLength - oldMediaLength;
          tl.push({ dt: new Date().toISOString(), user: funcUser, acao: `Anexou ${adicionadas} nova(s) foto(s)/vídeo(s) de evidência.` });
          registouAlgo = true;
      } else if (newMediaLength < oldMediaLength) {
          const removidas = oldMediaLength - newMediaLength;
          tl.push({ dt: new Date().toISOString(), user: funcUser, acao: `Removeu ${removidas} foto(s)/vídeo(s) de evidência.` });
          registouAlgo = true;
      }

      // Fallback operacional: se nada entrou no histórico da OS e também não foi
      // alteração de campo auditável, mantém um registro mínimo de edição.
      if (!registouAlgo && !alterouCampoAuditavel) {
          tl.push({ dt: new Date().toISOString(), user: funcUser, acao: `Atualizou os detalhes gerais da Ordem de Serviço.` });
      }
      
  } else {
      // Criação de Nova O.S.
      tl = JSON.parse($('osTimelineData')?.value || '[]');
      tl.push({ dt: new Date().toISOString(), user: funcUser, acao: `Abriu a O.S. (Status inicial: ${STATUS_MAP_LEGACY[payload.status] || payload.status})` });
  }

  if (registroReaberturaAprovacaoOS) {
      tl.push({
          dt: new Date().toISOString(),
          user: funcUser,
          acao: `Reabriu a O.S. para edição/reorçamento. Aprovação ativa arquivada ao voltar para ${payload.status}.`
      });
  }

  if (payload.aprovacao && !isFirestoreSentinelOS(payload.aprovacao) && !oldOSParaAprovacao.aprovacao) {
      tl.push({
          dt: new Date().toISOString(),
          user: funcUser,
          acao: `Orcamento aprovado (${payload.aprovacao.status}) - ${(payload.aprovacao.itens || []).length} item(ns) - Total aprovado ${moeda(payload.aprovacao.totalAprovado || 0)}`
      });
  }

  payload.timeline = tl;
  // --- FIM: DEEP DIFF ---

  // ═══════════════════════════════════════════════════════════════════
  // CORREÇÃO 2: Persistir campos de pagamento SEMPRE no payload,
  //             independente de status ou mecânico atribuído.
  //             Antes: só persistia dentro do gating Pronto+mecId,
  //             então OS sem mecânico perdia a forma de pagamento.
  // ═══════════════════════════════════════════════════════════════════
  payload.pgtoForma    = $v('osPgtoForma') || '';
  payload.pgtoData     = $v('osPgtoData') || '';
  payload.pgtoParcelas = parseInt($v('osPgtoParcelas') || 1) || 1;

  // ═══════════════════════════════════════════════════════════════════
  // BLOCO COMISSÃO — precisa de mecânico atribuído E status final
  // ═══════════════════════════════════════════════════════════════════
  const _statusFinal = ['Pronto','Entregue','pronto','entregue','Concluido','Faturado','Pronto_Retirada'].includes($v('osStatus'));
  if (_statusFinal && payload.mecId) {
      const mec = J.equipe.find(f => f.id === payload.mecId);
      if (mec) {
        const percServico = parseFloat(mec.comissaoServico || mec.comissao || 0);
        const percPeca = parseFloat(mec.comissaoPeca || 0);
        
        const valComServico = totalMaoObra * (percServico / 100);
        const valComPeca = totalPecas * (percPeca / 100);
        const valComTotal = valComServico + valComPeca;

        if (valComTotal > 0) {
            db.collection('financeiro').add({
                tenantId: J.tid, tipo: 'Saída', status: 'Pendente',
                desc: `Comissão (Serv: ${moeda(valComServico)} | Peça: ${moeda(valComPeca)}) — O.S. ${payload.placa || ''}`,
                valor: valComTotal, pgto: 'A Combinar', venc: new Date().toISOString().split('T')[0],
                createdAt: new Date().toISOString(), isComissao: true, mecId: payload.mecId, vinculo: `E_${payload.mecId}`
            });
        }
      }
  }

  // ═══════════════════════════════════════════════════════════════════
  // BLOCO RECEBIMENTO FINANCEIRO (CORREÇÃO 1)
  // Grava SEMPRE que o usuário preencheu Forma de Pagamento + Data,
  // independente de status, independente de mecânico atribuído.
  // Esta é a regra correta: "registrei o recebimento" = vai pro caixa.
  // ═══════════════════════════════════════════════════════════════════
  if (payload.pgtoForma && payload.pgtoData) {
      // Conceitos:
      //  • formaRecebimento (como cliente pagou): Dinheiro, PIX, Débito,
      //    Crédito (1x / 2x / 3x...), Boleto, Crediário próprio
      //  • Do ponto de vista do CLIENTE, se pagou no cartão, está QUITADO
      //  • Do ponto de vista da OFICINA, se foi cartão de crédito Nx, ela
      //    vai receber N parcelas DA OPERADORA (não do cliente)
      //  • Se foi Boleto/Crediário próprio, aí sim o CLIENTE deve em N parcelas
      const formasAVistaCliente = ['Dinheiro', 'PIX', 'Débito'];     // cliente paga e pronto
      const formasCartaoCredito = ['Crédito à Vista', 'Crédito', 'Crédito Parcelado']; // cliente quita, operadora paga a oficina em parcelas
      const formasCreditoOficina = ['Boleto', 'Crediário', 'Boleto (Pendente)']; // cliente DEVE parcelas à oficina

      {
        const parcelas = payload.pgtoParcelas;
        const valorFinanceiro = numBR((!isFirestoreSentinelOS(payload.totalAprovado) && payload.totalAprovado != null) ? payload.totalAprovado : (reabrindoParaEdicaoOS ? payload.total : (oldOSParaAprovacao.totalAprovado || payload.total)));
        payload.totalFaturado = valorFinanceiro;
        const valorParc = valorFinanceiro / parcelas;
        const placaRef  = payload.placa || J.veiculos.find(v => v.id === payload.veiculoId)?.placa || '';
        const cliRef    = J.clientes.find(c => c.id === payload.clienteId)?.nome || payload.cliente || '';

        const pgtoBase = payload.pgtoForma.trim();

        // Apaga recebimentos anteriores desta OS (evita duplicação ao editar)
        if (osId) {
          try {
            const snap = await db.collection('financeiro').where('osId', '==', osId).get();
            for (const docSnap of snap.docs) {
              await db.collection('financeiro').doc(docSnap.id).delete();
            }
          } catch(e) { console.warn('Limpeza financeiro OS:', e); }
        }

        // Decide o tipo de fluxo financeiro pela forma de pagamento
        if (formasAVistaCliente.some(f => pgtoBase.toLowerCase().includes(f.toLowerCase()))) {
          // ═══ CLIENTE PAGOU À VISTA (Dinheiro/PIX/Débito) ═══
          payload.pgtoQuitado = true;
          payload.pgtoResumoCliente = `${pgtoBase} à vista`;
          await db.collection('financeiro').add({
            tenantId:  J.tid,
            tipo:      'Entrada',
            status:    'Pago',
            desc:      `O.S. ${placaRef} — ${cliRef}`,
            valor:     valorFinanceiro,
            pgto:      pgtoBase,
            venc:      payload.pgtoData,
            dataPgto:  payload.pgtoData,
            osId:      osId || null,
            clienteId: payload.clienteId || null,
            quitadoPeloCliente: true,
            origem: 'recebimento_os_avista',
            createdAt: new Date().toISOString()
          });

        } else if (formasCartaoCredito.some(f => pgtoBase.toLowerCase().includes(f.toLowerCase()))) {
          // ═══ CARTÃO DE CRÉDITO Nx ═══
          payload.pgtoQuitado = true;
          payload.pgtoResumoCliente = parcelas > 1
            ? `Cartão de Crédito em ${parcelas}x`
            : `Cartão de Crédito à vista`;

          for (let i = 0; i < parcelas; i++) {
            const dVenc = new Date(payload.pgtoData);
            dVenc.setDate(dVenc.getDate() + 30 * (i + 1));
            await db.collection('financeiro').add({
              tenantId:   J.tid,
              tipo:       'Entrada',
              status:     'A Receber',
              desc:       `Recebimento operadora — O.S. ${placaRef} — ${cliRef} ${parcelas > 1 ? `(${i + 1}/${parcelas})` : ''}`,
              valor:      valorParc,
              pgto:       pgtoBase,
              venc:       dVenc.toISOString().split('T')[0],
              osId:       osId || null,
              clienteId:  payload.clienteId || null,
              quitadoPeloCliente: true,
              aReceberDe: 'Operadora de Cartão',
              origem: 'recebimento_os_cartao',
              createdAt: new Date().toISOString()
            });
          }

        } else if (formasCreditoOficina.some(f => pgtoBase.toLowerCase().includes(f.toLowerCase()))) {
          // ═══ BOLETO / CREDIÁRIO PRÓPRIO ═══
          payload.pgtoQuitado = false;
          payload.pgtoResumoCliente = parcelas > 1
            ? `${pgtoBase} em ${parcelas}x (pendente)`
            : `${pgtoBase} (pendente)`;

          for (let i = 0; i < parcelas; i++) {
            const dVenc = new Date(payload.pgtoData);
            dVenc.setMonth(dVenc.getMonth() + i);
            await db.collection('financeiro').add({
              tenantId:   J.tid,
              tipo:       'Entrada',
              status:     'Pendente',
              desc:       `O.S. ${placaRef} — ${cliRef} ${parcelas > 1 ? `(${i + 1}/${parcelas})` : ''}`,
              valor:      valorParc,
              pgto:       pgtoBase,
              venc:       dVenc.toISOString().split('T')[0],
              osId:       osId || null,
              clienteId:  payload.clienteId || null,
              quitadoPeloCliente: false,
              aReceberDe: 'Cliente',
              origem: 'recebimento_os_credito_oficina',
              createdAt: new Date().toISOString()
            });
          }

        } else {
          // ═══ OUTRAS FORMAS / INDEFINIDO ═══
          payload.pgtoQuitado = false;
          payload.pgtoResumoCliente = `${pgtoBase} — verificar`;
          await db.collection('financeiro').add({
            tenantId:  J.tid,
            tipo:      'Entrada',
            status:    'Pendente',
            desc:      `O.S. ${placaRef} — ${cliRef}`,
            valor:     valorFinanceiro,
            pgto:      pgtoBase,
            venc:      payload.pgtoData,
            osId:      osId || null,
            clienteId: payload.clienteId || null,
            quitadoPeloCliente: false,
            origem: 'recebimento_os_outros',
            createdAt: new Date().toISOString()
          });
        }
      }
  }
  // FIM bloco recebimento financeiro

  const payloadFirestore = limparUndefinedFirestoreOS(payload);

  let savedOsId = osId;
if (osId) {
    await db.collection('ordens_servico').doc(osId).update(payloadFirestore);
    window.toast('✓ O.S. ATUALIZADA');
    audit('OS', `Editou OS ${osId.slice(-6)}`);
  } else {
    payload.createdAt = new Date().toISOString();
    payload.pin = Math.floor(1000 + Math.random() * 9000).toString(); 
    const ref = await db.collection('ordens_servico').add(limparUndefinedFirestoreOS(payload));
    savedOsId = ref.id;
    window.toast('✓ O.S. CRIADA');
    audit('OS', `Criou OS para ${payload.placa || payload.cliente || J.clientes.find(c => c.id === payload.clienteId)?.nome}`);
  }

  if (auditoriaGeralOS.length) {
    for (const acao of auditoriaGeralOS) {
      await auditGeralOS(savedOsId, acao);
    }
  }

  if (_pecasReais.length > 0 || (oldOSParaAprovacao.pecasReais || []).length > 0) {
    await window.baixarEstoquePecasReais?.(savedOsId, oldOSParaAprovacao.pecasReais || [], _pecasReais);
  }

  if(typeof window.fecharModal === 'function') window.fecharModal('modalOS');

  // Disparo de WhatsApp quando o gestor/admin confirmar que esta pronto.
  if (dispararAvisoPronto && savedOsId) {
      setTimeout(() => {
          if (typeof window.dispararAvisoEntregaAutomatico === 'function') {
              window.dispararAvisoEntregaAutomatico(savedOsId, 'Pronto');
          }
      }, 500);
  }

  // Disparo de WhatsApp quando o gestor/caixa confirmar entrega.
  if (dispararAvisoEntrega && payload.clienteId) {
      setTimeout(() => {
          if (confirm('A O.S. foi marcada como ENTREGUE. Deseja avisar o cliente via WhatsApp agora?')) {
              const cli = J.clientes.find(c => c.id === payload.clienteId);
              if (cli && cli.wpp) {
                  const fone = cli.wpp.replace(/\D/g, '');
                  const vLabel = payload.placa || J.veiculos.find(v => v.id === payload.veiculoId)?.placa || 'seu veículo';
                  const msg = `Olá ${cli.nome.split(' ')[0]}! 👋\n\nPassando para avisar que o serviço no *${vLabel}* já foi concluído e está *${STATUS_MAP_LEGACY[payload.status]}* na oficina ${J.tnome}.\n\nAgradecemos a confiança!`;
                  window.open(`https://wa.me/55${fone}?text=${encodeURIComponent(msg)}`, '_blank');
              } else {
                  window.toast('⚠ Cliente não possui WhatsApp cadastrado.', 'warn');
              }
          }
      }, 500);
  }
};

// ═══════════════════════════════════════════════════════════════
// GALERIA DE PROVAS — UPLOAD LEGADO (1 por vez) — MANTIDO COMO FALLBACK
// ═══════════════════════════════════════════════════════════════
window.uploadOsMedia = async function() {
  const f = $('osFileInput')?.files[0]; if (!f) return;
  const btn = $('btnUploadMedia'); btn.innerText = 'ENVIANDO...'; btn.disabled = true;
  try {
    const fd = new FormData(); fd.append('file', f); fd.append('upload_preset', J.cloudPreset);
    const res = await fetch(`https://api.cloudinary.com/v1_1/${J.cloudName}/auto/upload`, { method: 'POST', body: fd });
    const data = await res.json();
    if (data.secure_url) {
      const media = JSON.parse($('osMediaArray').value || '[]');
      media.push({ url: data.secure_url, type: data.resource_type });
      $('osMediaArray').value = JSON.stringify(media); window.renderMediaOS(); window.toast('✓ UPLOAD CONCLUÍDO');
    }
  } catch (e) { window.toast('✕ ERRO UPLOAD', 'err'); }
  btn.innerText = 'ENVIAR TODAS'; btn.disabled = false;
};

// ═══════════════════════════════════════════════════════════════
// CORREÇÃO #4: GALERIA DE PROVAS — BATCH UPLOAD
// Powered by thIAguinho Soluções Digitais
// ═══════════════════════════════════════════════════════════════

// Estado local do preview (arquivos ainda não enviados).
// Acumulativo: o mecânico pode bater foto, bater outra, abrir novamente
// sem perder as anteriores.
window._osBatchFiles = [];

// Dispara quando o mecânico seleciona 1+ arquivos no input.
// Acumula em _osBatchFiles e renderiza grid de prévia.
window.previewOsMediaBatch = function(input) {
  if (!input || !input.files || !input.files.length) { window.renderOsMediaPreview(); return; }
  const novos = Array.from(input.files);
  window._osBatchFiles = window._osBatchFiles.concat(novos);
  // Libera o input para que o usuário possa selecionar/tirar mais fotos
  try { input.value = ''; } catch(e){}
  window.renderOsMediaPreview();
};

window.renderOsMediaPreview = function() {
  const wrap = $('osMediaPreviewLocal');
  const grid = $('osMediaPreviewGrid');
  const count = $('osMediaPreviewCount');
  if (!wrap || !grid) return;

  if (!window._osBatchFiles || !window._osBatchFiles.length) {
    wrap.style.display = 'none';
    grid.innerHTML = '';
    if (count) count.innerText = '0';
    return;
  }

  wrap.style.display = 'block';
  if (count) count.innerText = window._osBatchFiles.length;

  grid.innerHTML = window._osBatchFiles.map((f, i) => {
    const isVideo = /^video\//.test(f.type || '');
    const url = URL.createObjectURL(f);
    const mediaEl = isVideo
      ? `<video src="${url}" muted></video>`
      : `<img src="${url}" alt="prévia">`;
    return `<div class="media-item" data-idx="${i}">
      ${mediaEl}
      <button class="media-del" type="button" onclick="window.removerOsMediaPreview(${i})" title="Remover">✕</button>
    </div>`;
  }).join('');
};

window.removerOsMediaPreview = function(idx) {
  if (!window._osBatchFiles || idx < 0 || idx >= window._osBatchFiles.length) return;
  window._osBatchFiles.splice(idx, 1);
  window.renderOsMediaPreview();
};

window.limparOsMediaPreview = function() {
  window._osBatchFiles = [];
  try { const f = $('osFileInput'); if (f) f.value = ''; } catch(e){}
  window.renderOsMediaPreview();
  const prog = $('osMediaProgress'); if (prog) { prog.style.display = 'none'; prog.innerText = ''; }
};

// Sobe todos os arquivos do preview em lote, concatena com os já gravados,
// atualiza o hidden array e re-renderiza a galeria. Grava no Firestore
// somente quando o usuário clicar "SALVAR O.S." (via salvarOS).
window.uploadOsMediaBatch = async function() {
  // Se o input ainda tem seleção não absorvida, incorpora agora
  const fInput = $('osFileInput');
  if (fInput && fInput.files && fInput.files.length) {
    window._osBatchFiles = (window._osBatchFiles || []).concat(Array.from(fInput.files));
    try { fInput.value = ''; } catch(e){}
    window.renderOsMediaPreview();
  }

  if (!window._osBatchFiles || !window._osBatchFiles.length) {
    window.toast('⚠ Selecione ao menos um arquivo.', 'warn');
    return;
  }

  const btn = $('btnUploadMedia');
  const prog = $('osMediaProgress');
  if (btn) { btn.disabled = true; btn.innerText = 'ENVIANDO...'; }
  if (prog) { prog.style.display = 'inline'; prog.innerText = '0/' + window._osBatchFiles.length; }

  const total = window._osBatchFiles.length;
  const novasUrls = [];
  let sucesso = 0, falhas = 0;

  for (let i = 0; i < total; i++) {
    const f = window._osBatchFiles[i];
    const fd = new FormData();
    fd.append('file', f);
    fd.append('upload_preset', J.cloudPreset);
    try {
      const res = await fetch(`https://api.cloudinary.com/v1_1/${J.cloudName}/auto/upload`, { method: 'POST', body: fd });
      const data = await res.json();
      if (data && data.secure_url) {
        novasUrls.push({ url: data.secure_url, type: data.resource_type || 'image' });
        sucesso++;
      } else {
        falhas++;
      }
    } catch (e) {
      falhas++;
    }
    if (prog) prog.innerText = (i + 1) + '/' + total;
  }

  // Concatena com o que já estava gravado no hidden (em caso de edição de O.S.)
  const jaSalvo = JSON.parse($('osMediaArray').value || '[]');
  const final = jaSalvo.concat(novasUrls);
  $('osMediaArray').value = JSON.stringify(final);
  window.renderMediaOS();

  // Limpa o preview local (as prévias já viraram itens reais da galeria)
  window._osBatchFiles = [];
  window.renderOsMediaPreview();

  if (btn) { btn.disabled = false; btn.innerText = 'ENVIAR TODAS'; }
  if (prog) { prog.style.display = 'none'; prog.innerText = ''; }

  if (sucesso && !falhas) window.toast(`✓ ${sucesso} arquivo(s) enviado(s). Salve a O.S. para persistir.`);
  else if (sucesso && falhas) window.toast(`⚠ ${sucesso} ok, ${falhas} falhou. Salve a O.S. para persistir o que deu certo.`, 'warn');
  else window.toast('✕ Nenhum arquivo enviado.', 'err');
};

window.renderMediaOS = function() {
  const media = JSON.parse($('osMediaArray')?.value || '[]');
  if($('osMediaGrid')) {
      $('osMediaGrid').innerHTML = media.map((m, i) => `
        <div class="media-item">
          ${m.type === 'video' ? `<video src="${m.url}" controls></video>` : `<img src="${m.url}" onclick="window.open('${m.url}')" style="cursor:zoom-in">`}
          <button class="media-del" onclick="window.removerMediaOS(${i})">✕</button>
        </div>`).join('');
  }
};

window.removerMediaOS = function(idx) {
  const media = JSON.parse($('osMediaArray').value || '[]');
  media.splice(idx, 1); $('osMediaArray').value = JSON.stringify(media); window.renderMediaOS();
};

window.renderTimelineOS = function() {
  if(!$('osTimeline')) return;
  const tl = JSON.parse($('osTimelineData')?.value || '[]');
  $('osTimeline').innerHTML = [...tl].reverse().map(e => `<div class="tl-item"><div class="tl-date">${dtHrBr(e.dt)}</div><div class="tl-user">${e.user}</div><div class="tl-action">${e.acao}</div></div>`).join('');
};

window.gerarPDFOS = async function() {
  if (typeof window.jspdf === 'undefined') { window.toast('jsPDF nao carregado', 'err'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('p', 'mm', 'a4');
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const margem = 12;
  let y = 12;

  const U = OSU();
  const moedaPdf = value => (U.moeda ? U.moeda(value) : ('R$ ' + numBR(value).toFixed(2).replace('.', ',')));
  const texto = value => String(value == null || value === '' ? '-' : value);
  const hoje = new Date().toLocaleDateString('pt-BR');
  const v = J.veiculos.find(x => x.id === $v('osVeiculo')) || {};
  const c = J.clientes.find(x => x.id === $v('osCliente')) || {};
  const osAtual = (J.os || []).find(x => x.id === $v('osId')) || {};
  const osId = ($v('osId') || '').slice(-6).toUpperCase() || 'NOVA';
  const pickPdf = (...values) => {
    for (const value of values) {
      if (value === undefined || value === null) continue;
      if (String(value).trim() !== '') return value;
    }
    return '';
  };
  const upperPdf = (...values) => String(pickPdf(...values) || '').toUpperCase();
  const clientePdf = {
    nome: pickPdf(c.govUnidade, c.razaoSocial, c.nome, osAtual.cliente, $v('osCliente')),
    doc: pickPdf(c.doc, c.cnpj, c.cpf, osAtual.cpf, $v('osCpf')),
    telefone: pickPdf(c.wpp, c.telefone, c.celular, osAtual.celular, $v('osCelular')),
    fiscal: pickPdf(c.govFiscal, c.fiscalContrato, c.fiscal, c.responsavel)
  };
  const veiculoPdf = {
    marca: upperPdf(v.marca, osAtual.marca),
    modelo: pickPdf(v.modelo, osAtual.veiculo, osAtual.modelo, $v('osVeiculo')),
    placa: upperPdf(v.placa, osAtual.placa, $v('osPlaca')),
    ano: pickPdf(v.ano, osAtual.ano),
    km: pickPdf($v('osKm'), osAtual.km, v.km),
    chassis: upperPdf(v.chassis, v.chassi, osAtual.chassis, osAtual.chassi),
    patrimonio: pickPdf(v.patrimonio, v.patrimonioNumero, v.patrimonioId, osAtual.patrimonio, osAtual.patrimonioNumero),
    prefixo: upperPdf(v.prefixo, osAtual.prefixo)
  };
  const oficinaNomePdf = String(pickPdf(J.nomeFantasia, J.tnome, J.razaoSocial, J.nome, 'OFICINA')).toUpperCase();

  function linhaTitulo(titulo) {
    if (y > ph - 30) { doc.addPage(); y = 12; }
    doc.setFillColor(28, 39, 58);
    doc.rect(margem, y, pw - margem * 2, 7, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(255, 255, 255);
    doc.text(titulo, margem + 2, y + 5);
    y += 10;
  }

  function blocoTexto(titulo, conteudo) {
    linhaTitulo(titulo);
    const linhas = doc.splitTextToSize(texto(conteudo), pw - margem * 2 - 4);
    doc.setDrawColor(185, 195, 210);
    doc.rect(margem, y - 1, pw - margem * 2, Math.max(12, linhas.length * 4 + 5));
    doc.setTextColor(20, 30, 45);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(linhas, margem + 2, y + 4);
    y += Math.max(14, linhas.length * 4 + 8);
  }

  async function carregarImagem(url) {
    return new Promise(resolve => {
      if (!url) return resolve(null);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const max = 900;
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve({ data: canvas.toDataURL('image/jpeg', 0.82), w: canvas.width, h: canvas.height });
        } catch(e) { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  const dadosGov = typeof window._osDadosGovernamental === 'function' ? window._osDadosGovernamental() : null;
  const descMOField = document.getElementById('osDescMO')?.value?.trim();
  const descPecaField = document.getElementById('osDescPeca')?.value?.trim();
  const descPadrao = OSU().getDescontosCliente ? OSU().getDescontosCliente(c, osAtual) : {
    descMO: taxaDescontoOS(osAtual.descMO ?? dadosGov?.descMO ?? c.govDescMO ?? 0),
    descPeca: taxaDescontoOS(osAtual.descPeca ?? dadosGov?.descPeca ?? c.govDescPeca ?? 0)
  };
  const descMO = descMOField !== '' && descMOField != null ? taxaDescontoOS(descMOField) : taxaDescontoOS(descPadrao.descMO || 0);
  const descPeca = descPecaField !== '' && descPecaField != null ? taxaDescontoOS(descPecaField) : taxaDescontoOS(descPadrao.descPeca || 0);
  const servicos = [];
  const resumoSecoesPDF = {};
  let totalServicos = 0;
  const _coletarServicoParaPDF = row => {
    const desc = row.querySelector('.serv-desc')?.value?.trim() || '';
    const tempo = numBR(row.querySelector('.serv-tempo')?.value || 0);
    const valorHora = numBR(row.querySelector('.serv-valor-hora')?.value || row.dataset?.valorHoraSecao || (tempo ? numBR(row.querySelector('.serv-valor')?.value || 0) / tempo : 0));
    const bruto = numBR(row.querySelector('.serv-valor')?.value || 0);
    const final = +(bruto * (1 - descMO)).toFixed(2);
    const sel = row.querySelector('.serv-secao-hora');
    const sistema = sel?.options?.[sel.selectedIndex]?.text?.replace(/\s+-\s+R\$.*/, '') || row.dataset.secaoHoraLabel || row.dataset.sistemaTabela || '';
    const meta = metaServicoResumoOS({
      codigoTabela: row.dataset.codigoTabela,
      sistemaTabela: row.dataset.sistemaTabela || sistema,
      secaoHoraLabel: sistema,
      tipoVeiculoTabela: row.dataset.tipoVeiculoTabela
    }, window._osVeiculoAtual?.() || {});
    if (meta.tipoVeiculo && !row.dataset.tipoVeiculoTabela) row.dataset.tipoVeiculoTabela = meta.tipoVeiculo;
    if (desc || bruto || tempo) {
      totalServicos += final;
      const categoria = classificarSecaoResumoOS({
        secaoHora: row.dataset.secaoHora || sel?.value || '',
        secaoHoraLabel: sistema,
        sistemaTabela: row.dataset.sistemaTabela,
        sistema: row.dataset.sistemaTabela,
        codigoTabela: meta.codigo,
        tipoVeiculoTabela: meta.tipoVeiculo,
        desc
      });
      if (!resumoSecoesPDF[categoria]) resumoSecoesPDF[categoria] = { horas: 0, total: 0, codigos: new Set(), sistemas: new Set(), tiposVeiculo: new Set() };
      resumoSecoesPDF[categoria].horas += tempo;
      resumoSecoesPDF[categoria].total += final;
      addMetaResumoServicoOS(resumoSecoesPDF[categoria], meta);
      servicos.push({ codigo: meta.codigo || '-', sistema: sistema || meta.sistema || '-', tipoVeiculo: meta.tipoVeiculo || '-', desc: desc || '-', tempo, valorHora, descPct: descMO, total: final, categoria });
    }
  };
  document.querySelectorAll('#containerServicosOS > div').forEach(_coletarServicoParaPDF);
  document.querySelectorAll('#containerPecasOS .cilia-serv-relac').forEach(_coletarServicoParaPDF);

  const pecas = [];
  let totalPecas = 0;
  document.querySelectorAll('#containerPecasOS [data-peca-avulsa="1"], #containerPecasOS > div:not(.cilia-peca-wrap)').forEach(row => {
    const sel = row.querySelector('.peca-sel');
    const opt = sel?.options?.[sel.selectedIndex];
    const codigo = row.querySelector('.peca-codigo')?.value?.trim() || '';
    const descLivre = row.querySelector('.peca-desc-livre')?.value?.trim();
    const desc = descLivre || opt?.dataset?.desc || opt?.text || '';
    const qtd = numBR(row.querySelector('.peca-qtd')?.value || 0) || 1;
    const unit = numBR(row.querySelector('.peca-venda')?.value || 0);
    const final = +(qtd * unit * (1 - descPeca)).toFixed(2);
    if (desc || codigo || unit) {
      totalPecas += final;
      pecas.push([codigo || 'sem oem', desc || '-', qtd, moedaPdf(unit), descPeca ? (descPeca * 100).toFixed(1).replace('.', ',') + '%' : '0,0%', moedaPdf(final)]);
    }
  });

  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, pw, ph, 'F');
  doc.setDrawColor(20, 45, 95);
  doc.setLineWidth(0.7);
  doc.line(margem, 15, pw - margem, 15);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(10, 25, 48);
  doc.text(oficinaNomePdf, margem, 10);
  doc.setFontSize(12);
  doc.text('ORDEM DE SERVICO / LAUDO TECNICO', pw - margem, 10, { align: 'right' });
  y = 22;

  doc.autoTable({
    startY: y,
    theme: 'grid',
    margin: { left: margem, right: margem },
    styles: { fontSize: 8, cellPadding: 2, textColor: [20, 30, 45], lineColor: [185, 195, 210], lineWidth: 0.15 },
    headStyles: { fillColor: [228, 233, 240], textColor: [0, 0, 0], fontStyle: 'bold' },
    body: [
      ['OS', osId, 'Emissao', hoje],
      ['Cliente', texto(clientePdf.nome), 'CPF/CNPJ', texto(clientePdf.doc)],
      ['Telefone', texto(clientePdf.telefone), 'Status', texto($v('osStatus') || osAtual.status)],
      ['Veiculo', texto([veiculoPdf.marca, veiculoPdf.modelo].filter(Boolean).join(' ')), 'Placa', texto(veiculoPdf.placa)],
      ['Ano', texto(veiculoPdf.ano), 'KM', texto(veiculoPdf.km)],
      ['Chassi', texto(veiculoPdf.chassis), 'Prefixo/Patrimonio', texto([veiculoPdf.prefixo, veiculoPdf.patrimonio].filter(Boolean).join(' / '))],
      ['Fiscal Contrato', texto(clientePdf.fiscal), '', '']
    ]
  });
  y = doc.lastAutoTable.finalY + 7;

  blocoTexto('DEFEITO RECLAMADO / QUEIXA DO CLIENTE', $v('osRelato') || $v('osDescricao') || '-');
  blocoTexto('DIAGNOSTICO TECNICO', $v('osDiagnostico') || '-');

  const resumoSecoesRows = Object.entries(resumoSecoesPDF)
    .filter(([, item]) => item.horas || item.total)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([secao, item]) => [
      secao,
      listaResumoOS(item.codigos, 8) || '-',
      [listaResumoOS(item.tiposVeiculo, 3), listaResumoOS(item.sistemas, 2)].filter(Boolean).join(' / ') || '-',
      item.horas.toFixed(2).replace('.', ','),
      moedaPdf(item.total)
    ]);
  if (resumoSecoesRows.length) {
    linhaTitulo('RESUMO POR SECAO DE MAO DE OBRA');
    doc.autoTable({
      startY: y,
      head: [['Secao', 'Codigos', 'Tipo veiculo / sistema', 'Horas', 'Valor']],
      body: resumoSecoesRows,
      theme: 'grid',
      margin: { left: margem, right: margem },
      styles: { fontSize: 6.8, cellPadding: 1.45, lineColor: [190, 198, 210], lineWidth: 0.12, overflow: 'linebreak' },
      headStyles: { fillColor: [28, 39, 58], textColor: [255, 255, 255] },
      columnStyles: { 0: { cellWidth: 40 }, 1: { cellWidth: 32 }, 2: { cellWidth: 62 }, 3: { halign: 'center', cellWidth: 16 }, 4: { halign: 'right', cellWidth: 22 } }
    });
    y = doc.lastAutoTable.finalY + 6;
  }

  if (servicos.length) {
    linhaTitulo('SERVICOS / MAO DE OBRA');
    doc.autoTable({
      startY: y,
      head: [['Cod.', 'Sistema / tipo veic.', 'Descricao do servico', 'TMO', 'Valor h', 'Desc.', 'Valor']],
      body: servicos.map(s => [
        s.codigo,
        [s.sistema, s.tipoVeiculo && s.tipoVeiculo !== '-' ? `Tipo: ${s.tipoVeiculo}` : ''].filter(Boolean).join('\n'),
        s.desc,
        s.tempo ? s.tempo.toFixed(2).replace('.', ',') : '-',
        moedaPdf(s.valorHora),
        s.descPct ? (s.descPct * 100).toFixed(1).replace('.', ',') + '%' : '0,0%',
        moedaPdf(s.total)
      ]),
      theme: 'grid',
      margin: { left: margem, right: margem },
      styles: { fontSize: 6.7, cellPadding: 1.45, lineColor: [190, 198, 210], lineWidth: 0.12, overflow: 'linebreak' },
      headStyles: { fillColor: [28, 39, 58], textColor: [255, 255, 255] },
      columnStyles: { 0: { cellWidth: 20 }, 1: { cellWidth: 48 }, 2: { cellWidth: 57 }, 3: { halign: 'center', cellWidth: 13 }, 4: { halign: 'right', cellWidth: 19 }, 5: { halign: 'center', cellWidth: 15 }, 6: { halign: 'right', cellWidth: 20 } }
    });
    y = doc.lastAutoTable.finalY + 6;
  }

  if (pecas.length) {
    linhaTitulo('PECAS / MATERIAIS');
    doc.autoTable({
      startY: y,
      head: [['Codigo da peca', 'Descricao', 'Qtd', 'Valor unit.', 'Desc.', 'Valor']],
      body: pecas,
      theme: 'grid',
      margin: { left: margem, right: margem },
      styles: { fontSize: 7.3, cellPadding: 1.6, lineColor: [190, 198, 210], lineWidth: 0.12 },
      headStyles: { fillColor: [28, 39, 58], textColor: [255, 255, 255] },
      columnStyles: { 0: { cellWidth: 32 }, 1: { cellWidth: 70 }, 2: { halign: 'center', cellWidth: 12 }, 3: { halign: 'right', cellWidth: 24 }, 4: { halign: 'center', cellWidth: 16 }, 5: { halign: 'right', cellWidth: 26 } }
    });
    y = doc.lastAutoTable.finalY + 6;
  }



  const guinchoPdf = window.calcularDeslocamentoGuinchoOS?.() || osAtual.deslocamentoGuincho || { ativo: false, total: 0 };
  const totalGuinchoPdf = guinchoPdf?.ativo ? _numGuinchoOS(guinchoPdf.total || 0) : 0;
  if (guinchoPdf?.ativo && totalGuinchoPdf > 0) {
    linhaTitulo('DESLOCAMENTO / GUINCHO');
    doc.autoTable({
      startY: y,
      head: [['Tipo', 'KM total', 'Franquia', 'KM excedente', 'Saída', 'KM adicional', 'Desc.', 'Total']],
      body: [[
        guinchoPdf.tipoLabel || (guinchoPdf.tipo === 'pesado' ? 'Pesado' : 'Leve'),
        String(guinchoPdf.kmTotal || 0).replace('.', ',') + ' km',
        String(guinchoPdf.franquiaKm || 15).replace('.', ',') + ' km',
        String(guinchoPdf.kmExcedente || 0).replace('.', ',') + ' km',
        moedaPdf(guinchoPdf.valorSaida || 0),
        moedaPdf(guinchoPdf.valorKmAdicional || 0),
        String(guinchoPdf.descontoPct ?? guinchoPdf.descPct ?? guinchoPdf.ajustePct ?? 0).replace('.', ',') + '%',
        moedaPdf(totalGuinchoPdf)
      ]],
      theme: 'grid',
      margin: { left: margem, right: margem },
      styles: { fontSize: 6.8, cellPadding: 1.3, lineColor: [190, 198, 210], lineWidth: 0.12, overflow: 'linebreak' },
      headStyles: { fillColor: [245, 158, 11], textColor: [20, 20, 20], fontStyle: 'bold' }
    });
    y = doc.lastAutoTable.finalY + 6;
    if (guinchoPdf.obs) blocoTexto('OBSERVACAO DO DESLOCAMENTO', guinchoPdf.obs);
  }

  if (y > ph - 34) { doc.addPage(); y = 12; }
  const totalGeral = +(totalServicos + totalPecas + totalGuinchoPdf).toFixed(2);
  doc.autoTable({
    startY: y,
    theme: 'plain',
    margin: { left: pw - 95, right: margem },
    styles: { fontSize: 9, cellPadding: 1.8 },
    body: [
      ['TOTAL DE PECAS', moedaPdf(totalPecas)],
      ['TOTAL DE MAO DE OBRA', moedaPdf(totalServicos)],
      ['DESLOCAMENTO / GUINCHO', moedaPdf(totalGuinchoPdf)],
      ['VALOR DO CONTRATO', moedaPdf(totalGeral)]
    ],
    columnStyles: { 0: { fontStyle: 'bold', halign: 'right' }, 1: { fontStyle: 'bold', halign: 'right' } },
    didParseCell: data => {
      if (data.row.index === 3) {
        data.cell.styles.fillColor = [205, 200, 160];
        data.cell.styles.fontSize = 12;
      }
    }
  });
  y = doc.lastAutoTable.finalY + 10;

  let media = [];
  try { media = JSON.parse(document.getElementById('osMediaArray')?.value || '[]'); } catch(e) { media = []; }
  const imagens = media.filter(m => (m.type || 'image') !== 'video' && m.url).slice(0, 12);
  if (imagens.length) {
    linhaTitulo('EVIDENCIAS DIGITAIS');
    const thumbW = 55, thumbH = 38, gap = 5;
    let x = margem;
    let count = 0;
    for (const m of imagens) {
      if (y + thumbH > ph - 18) { doc.addPage(); y = 12; x = margem; }
      const img = await carregarImagem(m.url);
      doc.setDrawColor(190, 198, 210);
      doc.rect(x, y, thumbW, thumbH);
      if (img) {
        const ratio = Math.min(thumbW / img.w, thumbH / img.h);
        const w = img.w * ratio;
        const h = img.h * ratio;
        doc.addImage(img.data, 'JPEG', x + (thumbW - w) / 2, y + (thumbH - h) / 2, w, h);
      } else {
        doc.setFontSize(7);
        doc.setTextColor(120, 130, 145);
        doc.text('Imagem nao carregada', x + 3, y + 19);
      }
      count++;
      x += thumbW + gap;
      if (count % 3 === 0) { x = margem; y += thumbH + 8; }
    }
    if (count % 3 !== 0) y += thumbH + 8;
  }

  if (y > ph - 28) { doc.addPage(); y = ph - 28; }
  y = Math.max(y, ph - 28);
  doc.setDrawColor(70, 80, 95);
  doc.line(margem, y, margem + 70, y);
  doc.line(pw - margem - 70, y, pw - margem, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(30, 40, 55);
  doc.text(oficinaNomePdf, margem + 35, y + 5, { align: 'center' });
  doc.text('RESPONSAVEL TECNICO', margem + 35, y + 9, { align: 'center' });
  doc.text(texto(clientePdf.nome || 'CLIENTE'), pw - margem - 35, y + 5, { align: 'center' });
  doc.text('ASSINATURA DO CLIENTE', pw - margem - 35, y + 9, { align: 'center' });

  const nomePDF = `Laudo_${veiculoPdf.placa || 'OS'}_${Date.now()}.pdf`;
  try {
    const blobPDF = doc.output('blob');
    if (typeof window.salvarBlobArquivoOS === 'function') await window.salvarBlobArquivoOS(blobPDF, nomePDF, 'application/pdf');
    else doc.save(nomePDF);
  } catch(e) {
    console.warn('[PDF OS] fallback download comum:', e);
    doc.save(nomePDF);
  }
  window.toast('PDF GERADO', 'ok');
};

/* Powered by thIAguinho Soluções Digitais */


// ══════════════════════════════════════════════════════════════════════
// IMPORTAR PEÇAS DO SISTEMA CÍLIA (PDF ou XML)
// ══════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════
// PEÇAS REAIS INSTALADAS — linha editável
// ══════════════════════════════════════════════════════════════════════
window.adicionarPecaReal = function() {
  window.adicionarPecaRealRow({});
};

window.adicionarPecaRealRow = function(p) {
  const ct = document.getElementById('containerPecasReais');
  if (!ct) return;
  const hoje = new Date().toISOString().slice(0,10);
  const div = document.createElement('div');
  div.style.cssText = 'display:grid;grid-template-columns:110px 1fr 50px 130px 110px 130px 105px 105px 32px;gap:6px;align-items:center;background:rgba(255,59,59,0.05);padding:6px;border-radius:3px;border:1px solid rgba(255,59,59,0.2);';
  const estoqueOpts = '<option value="">Nao baixar estoque</option>' + (window.J?.estoque || [])
    .map(e => `<option value="${escOS(e.id)}" data-codigo="${escOS(e.codigo || '')}" data-desc="${escOS(e.desc || '')}" data-custo="${numBR(e.custo || 0)}" ${e.id === p.estoqueId ? 'selected' : ''}>${escOS(e.codigo || '')} ${escOS(e.desc || '')} (${e.qtd || 0})</option>`)
    .join('');
  div.innerHTML = `
    <input type="text" class="j-input pr-codigo" value="${_escVal(p.codigo||'')}" placeholder="Cód. real" style="font-family:var(--fm);font-size:0.75rem;" title="Código OEM/real da peça instalada">
    <input type="text" class="j-input pr-desc" value="${_escVal(p.desc||'')}" placeholder="Descrição real instalada">
    <input type="number" class="j-input pr-qtd" value="${p.qtd||1}" min="1" placeholder="Qtd">
    <select class="j-select pr-estoque" onchange="window.selecionarPecaRealEstoque(this)" title="Selecione uma peça do estoque somente se esta peça real deve baixar estoque">${estoqueOpts}</select>
    <input type="text" class="j-input pr-fornec" value="${_escVal(p.fornecedor||'')}" placeholder="Fornecedor">
    <input type="text" class="j-input pr-nf" value="${_escVal(p.nf||'')}" placeholder="Nº Nota Fiscal">
    <input type="date" class="j-input pr-datacompra" value="${p.dataCompra||hoje}" title="Data da compra">
    <input type="text" inputmode="decimal" class="j-input pr-valor" value="${numBR(p.valorCompra||0).toFixed(2).replace('.', ',')}" placeholder="R$ compra" title="Valor real de compra da peça instalada">
    <button type="button" onclick="this.parentElement.remove()" style="background:rgba(255,59,59,0.1);border:1px solid rgba(255,59,59,0.3);border-radius:2px;color:var(--danger);cursor:pointer;width:32px;height:32px;">✕</button>
  `;
  ct.appendChild(div);
};

window.selecionarPecaRealEstoque = function(sel) {
  const opt = sel.options[sel.selectedIndex];
  const row = sel.closest('div');
  if (!opt || !row || !sel.value) return;
  const codigo = opt.dataset.codigo || '';
  const desc = opt.dataset.desc || '';
  const custo = numBR(opt.dataset.custo || 0);
  if (codigo && !row.querySelector('.pr-codigo')?.value) row.querySelector('.pr-codigo').value = codigo;
  if (desc && !row.querySelector('.pr-desc')?.value) row.querySelector('.pr-desc').value = desc;
  if (custo && numBR(row.querySelector('.pr-valor')?.value || 0) <= 0) row.querySelector('.pr-valor').value = custo.toFixed(2).replace('.', ',');
};

window.baixarEstoquePecasReais = async function(osId, antigas, novas) {
  const role = (window.J?.role || sessionStorage.getItem('j_role') || '').toLowerCase();
  if (!['admin','superadmin','gestor','gerente'].includes(role)) return;
  const antigasPorEstoque = {};
  (antigas || []).forEach(p => {
    if (!p.estoqueId) return;
    antigasPorEstoque[p.estoqueId] = (antigasPorEstoque[p.estoqueId] || 0) + numBR(p.qtd || 0);
  });
  const novasPorEstoque = {};
  (novas || []).forEach(p => {
    if (!p.estoqueId) return;
    novasPorEstoque[p.estoqueId] = (novasPorEstoque[p.estoqueId] || 0) + numBR(p.qtd || 0);
  });
  for (const estoqueId of Object.keys(novasPorEstoque)) {
    const delta = novasPorEstoque[estoqueId] - (antigasPorEstoque[estoqueId] || 0);
    if (delta <= 0) continue;
    const item = (window.J?.estoque || []).find(x => x.id === estoqueId);
    if (!item) continue;
    await db.collection('estoqueItems').doc(estoqueId).update({
      qtd: Math.max(0, numBR(item.qtd || 0) - delta),
      updatedAt: new Date().toISOString()
    });
    await db.collection('lixeira_auditoria').add({
      tenantId: J.tid,
      modulo: 'ESTOQUE',
      acao: `Baixa por peca real instalada OS ${String(osId || '').slice(-6).toUpperCase()}: ${item.desc || estoqueId} (-${delta})`,
      usuario: J.nome || 'Gestor',
      ts: new Date().toISOString()
    }).catch(() => {});
  }
};

function statusOptionsExecOS(tipo, atual) {
  const opts = tipo === 'peca'
    ? [
        ['pendente', 'Pendente'],
        ['trocada', 'Peça trocada/executada'],
        ['nao_encontrada', 'Peça não encontrada'],
        ['nao_trocada', 'Não trocada']
      ]
    : [
        ['pendente', 'Pendente'],
        ['em_execucao', 'Em execução'],
        ['executado', 'Serviço executado'],
        ['nao_executado', 'Não executado']
      ];
  return opts.map(([value, label]) => `<option value="${value}" ${value === atual ? 'selected' : ''}>${label}</option>`).join('');
}

window.salvarExecucaoAprovadosOS = async function(osId) {
  if (!osId) { window.toast?.('Salve a O.S. antes de marcar execução.', 'warn'); return; }
  const osAtual = (window.J?.os || []).find(o => o.id === osId) || {};
  const execucaoItens = { ...(osAtual.execucaoItens || {}) };
  const rows = document.querySelectorAll('#resumoAprovacaoOS .execucao-aprovado-row');
  rows.forEach(row => {
    const key = row.dataset.key;
    if (!key) return;
    execucaoItens[key] = {
      key,
      tipo: row.dataset.tipo || '',
      status: row.querySelector('.exec-status')?.value || 'pendente',
      obs: row.querySelector('.exec-obs')?.value?.trim() || '',
      usuario: window.J?.nome || 'Gestor',
      updatedAt: new Date().toISOString()
    };
  });
  const timeline = Array.isArray(osAtual.timeline) ? osAtual.timeline.slice() : [];
  timeline.push({
    dt: new Date().toISOString(),
    user: window.J?.nome || 'Gestor',
    acao: `Atualizou execução interna de ${rows.length} item(ns) aprovado(s).`
  });
  await db.collection('ordens_servico').doc(osId).update(limparUndefinedFirestoreOS({
    execucaoItens,
    timeline,
    updatedAt: new Date().toISOString()
  }));
  window.toast?.('Execução interna salva.', 'ok');
};

window.aplicarMarcadoresAprovacaoOS = function(os) {
  const U = OSU();
  document.getElementById('resumoAprovacaoOS')?.remove();
  document.querySelectorAll('#containerServicosOS .aprovacao-item-badge,#containerPecasOS .aprovacao-item-badge').forEach(el => el.remove());
  if (!U.hasApproval?.(os)) return;
  const keys = U.getApprovedKeys?.(os) || new Set();
  const badge = key => `<div class="aprovacao-item-badge" style="grid-column:1/-1;font-family:var(--fm);font-size:.62rem;letter-spacing:.8px;color:${keys.has(key) ? 'var(--success)' : 'var(--danger)'};border-top:1px dashed rgba(255,255,255,.12);padding-top:5px;margin-top:2px;">${keys.has(key) ? 'APROVADO NO ORÇAMENTO' : 'NÃO APROVADO - MANTIDO APENAS COMO HISTÓRICO'}</div>`;

  document.querySelectorAll('#containerServicosOS > div').forEach((row, idx) => {
    row.querySelector('.aprovacao-item-badge')?.remove();
    row.insertAdjacentHTML('beforeend', badge('servico-' + idx));
  });
  document.querySelectorAll('#containerPecasOS [data-peca-avulsa="1"], #containerPecasOS > div:not(.cilia-peca-wrap)').forEach((row, idx) => {
    row.querySelector('.aprovacao-item-badge')?.remove();
    row.insertAdjacentHTML('beforeend', badge('peca-' + idx));
  });
  document.querySelectorAll('#containerPecasOS .cilia-peca-wrap').forEach((wrap, idx) => {
    const pecaRow = wrap.querySelector('[data-cilia="1"], [data-peca-avulsa="1"]');
    if (pecaRow) {
      pecaRow.querySelector('.aprovacao-item-badge')?.remove();
      pecaRow.insertAdjacentHTML('beforeend', badge('peca-' + idx));
    }
  });

  const cliente = (window.J?.clientes || []).find(c => c.id === os?.clienteId);
  const itens = U.buildBudgetItems?.(os, cliente) || [];
  const aprovados = itens.filter(it => keys.has(it.key));
  const historico = itens.filter(it => !keys.has(it.key));
  const totalAprovado = os?.totalAprovado != null ? numBR(os.totalAprovado) : aprovados.reduce((sum, it) => sum + numBR(it.valorFinal), 0);
  const moeda = U.moeda || (v => 'R$ ' + numBR(v).toFixed(2).replace('.', ','));
  const exec = os?.execucaoItens || {};
  const execHtml = aprovados.length ? `
    <div style="margin-top:14px;border-top:1px solid rgba(255,255,255,.12);padding-top:12px;">
      <div style="font-family:var(--fm);font-size:.72rem;color:var(--cyan);font-weight:800;letter-spacing:1px;margin-bottom:8px;">EXECUÇÃO INTERNA DOS ITENS APROVADOS</div>
      <div style="font-family:var(--fm);font-size:.60rem;color:var(--muted);margin-bottom:8px;">Controle interno da oficina/equipe. O cliente não vê estas marcações.</div>
      <div style="display:grid;gap:7px;">
        ${aprovados.map(it => {
          const e = exec[it.key] || {};
          return `<div class="execucao-aprovado-row" data-key="${escOS(it.key)}" data-tipo="${escOS(it.tipo)}" style="display:grid;grid-template-columns:minmax(230px,1fr) 180px minmax(200px,1fr);gap:7px;align-items:center;background:rgba(0,0,0,.16);border:1px solid rgba(255,255,255,.10);border-radius:3px;padding:8px;">
            <div style="font-size:.75rem;color:var(--text);"><b>${escOS(it.labelTipo || it.tipo)}</b> ${it.codigo ? '[' + escOS(it.codigo) + '] ' : ''}${escOS(it.desc || '-')}${it.tempo ? `<br><small style="color:var(--muted);">TMO ${String(it.tempo).replace('.', ',')}h</small>` : ''}</div>
            <select class="j-select exec-status" style="font-size:.72rem;">${statusOptionsExecOS(it.tipo, e.status || 'pendente')}</select>
            <input class="j-input exec-obs" value="${escOS(e.obs || '')}" placeholder="Observação interna: peça não encontrada, aguardando, executado...">
          </div>`;
        }).join('')}
      </div>
      <button type="button" class="btn-primary" style="margin-top:10px;" onclick="window.salvarExecucaoAprovadosOS('${escOS(os.id || '')}')">SALVAR EXECUÇÃO INTERNA</button>
    </div>` : '';
  const resumo = document.createElement('div');
  resumo.id = 'resumoAprovacaoOS';
  resumo.className = 'aprovacao-resumo';
  resumo.innerHTML = `
    <h4>ORÇAMENTO APROVADO - ${aprovados.length}/${itens.length} ITEM(NS) - ${moeda(totalAprovado)}</h4>
    <div class="aprovacao-resumo-grid">
      ${aprovados.map(it => `<div class="aprovacao-resumo-item"><strong style="color:var(--success);">APROVADO</strong><br>${escOS(it.labelTipo || it.tipo)} ${it.codigo ? '[' + escOS(it.codigo) + '] ' : ''}${escOS(it.desc || '-')}${it.tempo ? `<br><small>TMO ${String(it.tempo).replace('.', ',')}h</small>` : ''}<br><b>${moeda(it.valorFinal)}</b></div>`).join('')}
      ${historico.map(it => `<div class="aprovacao-resumo-item nao"><strong style="color:var(--warn);">NÃO APROVADO</strong><br>${escOS(it.labelTipo || it.tipo)} ${it.codigo ? '[' + escOS(it.codigo) + '] ' : ''}${escOS(it.desc || '-')}<br><small>Mantido no histórico do orçamento.</small></div>`).join('')}
    </div>
    ${execHtml}`;
  const alvo = document.getElementById('containerServicosOS')?.closest('div');
  if (alvo) alvo.insertAdjacentElement('beforebegin', resumo);
};

// ══════════════════════════════════════════════════════════════════════
// BUSCA HISTÓRICO POR PLACA + SERVIÇO/PEÇA
// ══════════════════════════════════════════════════════════════════════
window.buscarHistoricoOS = function(opts = {}) {
  const placaId = opts.placaId || 'histBuscaPlaca';
  const termoId = opts.termoId || 'histBuscaTermo';
  const resultadoId = opts.resultadoId || 'histBuscaResultado';
  const placa = OSU().normalizePlate ? OSU().normalizePlate(document.getElementById(placaId)?.value || '') : (document.getElementById(placaId)?.value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
  const termoRaw = document.getElementById(termoId)?.value || '';
  const termo = OSU().normalizeText ? OSU().normalizeText(termoRaw) : termoRaw.trim().toLowerCase();
  const el = document.getElementById(resultadoId);
  if (!el) return;
  if (!placa && !termo) { el.innerHTML = '<div style="color:var(--muted);font-size:0.8rem;">Digite a placa e/ou o serviço/peça.</div>'; return; }

  const hits = (window.J?.os || []).filter(o => {
    const veicOS = (window.J?.veiculos||[]).find(v=>v.id===o.veiculoId)||{};
    const placaOS = OSU().normalizePlate ? OSU().normalizePlate(o.placa || veicOS.placa || '') : String(o.placa || veicOS.placa || '').toUpperCase().replace(/[^A-Z0-9]/g,'');
    const matchPlaca = !placa || placaOS === placa || placaOS.includes(placa);
    if (!matchPlaca) return false;
    if (!termo) return true;
    const textoOS = [
      ...(o.servicos||[]).map(s=>[s.desc,s.codigoTabela,s.sistemaTabela,s.tempo].join(' ')),
      ...(o.pecas||[]).map(p=>[p.desc,p.codigo,p.qtd,p.venda].join(' ')),
      ...(o.pecasReais||[]).map(p=>[p.desc,p.codigo,p.nf,p.fornecedor].join(' ')),
      o.diagnostico || '',
      o.relato || '',
      o.desc || ''
    ].join(' ');
    return (OSU().normalizeText ? OSU().normalizeText(textoOS) : textoOS.toLowerCase()).includes(termo);
  });

  if (!hits.length) {
    el.innerHTML = `<div style="color:var(--muted);font-family:var(--fm);font-size:0.8rem;padding:10px 0;">Nenhuma OS encontrada${placa?' para placa '+escOS(placa):''}${termoRaw?' com "'+escOS(termoRaw)+'"':''}.</div>`;
    return;
  }

  const html = hits.map(o => {
    const cli = (window.J?.clientes||[]).find(c=>c.id===o.clienteId)||{};
    const veic = (window.J?.veiculos||[]).find(v=>v.id===o.veiculoId)||{};
    const matchText = value => !termo || (OSU().normalizeText ? OSU().normalizeText(value) : String(value||'').toLowerCase()).includes(termo);
    const servMatches = (o.servicos||[]).filter(s=>matchText([s.desc,s.codigoTabela,s.sistemaTabela,s.tempo].join(' ')));
    const pecMatches  = (o.pecas||[]).filter(p=>matchText([p.desc,p.codigo,p.qtd,p.venda].join(' ')));
    const reaisMtch   = (o.pecasReais||[]).filter(p=>matchText([p.desc,p.codigo,p.nf,p.fornecedor].join(' ')));
    return `<div style="background:var(--surf3);border:1px solid var(--border);border-radius:3px;padding:12px;margin-bottom:8px;">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:8px;">
        <div>
          <span style="font-family:var(--fm);font-size:0.7rem;color:var(--cyan);font-weight:700;">OS #${(o.id||'').slice(-6).toUpperCase()}</span>
          <span style="font-family:var(--fm);font-size:0.65rem;color:var(--muted);margin-left:10px;">${escOS(o.data||'')}</span>
          <span style="font-family:var(--fm);font-size:0.65rem;color:var(--muted);margin-left:10px;">${escOS(veic.placa || o.placa || '')}</span>
          <span style="font-family:var(--fm);font-size:0.65rem;color:var(--muted);margin-left:10px;">${escOS(cli.nome||o.cliente||'')}</span>
        </div>
        <span style="font-family:var(--fm);font-size:0.7rem;color:var(--success);font-weight:700;">${moeda(o.totalAprovado || o.total || 0)}</span>
      </div>
      ${servMatches.length?`<div style="font-size:0.75rem;margin-bottom:4px;"><strong style="color:var(--cyan);">Serviços:</strong> ${servMatches.map(s=>`${escOS(s.codigoTabela||'')} ${escOS(s.desc||'')} (${String(s.tempo||0).replace('.',',')}h - ${moeda(s.valor||0)})`).join(' | ')}</div>`:''}
      ${pecMatches.length?`<div style="font-size:0.75rem;margin-bottom:4px;"><strong style="color:var(--success);">Peças orç.:</strong> ${pecMatches.map(p=>`${escOS(p.codigo||'')} ${escOS(p.desc||'')} x${p.qtd||1} - ${moeda(numBR(p.venda||0)*(numBR(p.qtd||1)||1))}`).join(' | ')}</div>`:''}
      ${reaisMtch.length?`<div style="font-size:0.75rem;margin-bottom:4px;"><strong style="color:var(--danger);">Peças reais:</strong> ${reaisMtch.map(p=>`${escOS(p.codigo||'')} ${escOS(p.desc||'')} x${p.qtd||1} - NF:${escOS(p.nf||'-')} ${escOS(p.fornecedor||'')}`).join(' | ')}</div>`:''}
    </div>`;
  }).join('');

  el.innerHTML = `<div style="font-family:var(--fm);font-size:0.65rem;color:var(--muted);margin-bottom:6px;">${hits.length} OS encontrada(s)</div>${html}`;
};

window.importarCilia = async function(input) {
  if (!input || !input.files || !input.files.length) return;
  const file = input.files[0];
  const ext = file.name.split('.').pop().toLowerCase();
  input.value = '';

  if (ext === 'xml') {
    _ciliaProcessarXML(file);
  } else if (ext === 'pdf') {
    _ciliaProcessarPDF(file);
  } else {
    if (typeof window.toast === 'function') window.toast('Formato inválido. Use XML ou PDF do Cília.', 'err');
  }
};

async function _ciliaAdicionarPecas(pecas) {
  pecas = OSU().normalizeCiliaPieces ? OSU().normalizeCiliaPieces(pecas) : pecas;
  if (!pecas || !pecas.length) {
    if (typeof window.toast === 'function') window.toast('Nenhuma peça encontrada no arquivo Cília.', 'warn');
    return;
  }

  const ehGov = typeof window._osClienteGovernamental === 'function' && window._osClienteGovernamental();
  const dadosGov = ehGov && typeof window._osDadosGovernamental === 'function' ? window._osDadosGovernamental() : null;
  const descPeca = dadosGov ? taxaDescontoOS(dadosGov.descPeca || 0) : 0;
  const veiculoAtual = typeof _veiculoOS === 'function' ? _veiculoOS() : {};
  const valorHoraOficina = numBR((typeof window._osValorHoraCliente === 'function' ? window._osValorHoraCliente() : 0) || window.J?.valorHoraMecanica || 120);
  const tempaOk = await _ciliaGarantirTabelaTempa();
  const jaImportadas = document.querySelectorAll('#containerPecasOS [data-cilia-piece-index]').length;
  let _ciliaPecaIndexCounter = jaImportadas;
  let servicosTempa = 0;
  let semServicoTempa = 0;

  for (const p of pecas) {
    const wrap = document.createElement('div');
    wrap.className = 'cilia-peca-wrap';
    wrap.dataset.ciliaPieceIndex = String(_ciliaPecaIndexCounter);
    wrap.style.cssText = 'background:rgba(0,212,255,0.04);border:1px solid rgba(0,212,255,0.20);border-radius:6px;padding:10px;margin-bottom:8px;';

    const div = document.createElement('div');
    const vBruto = numBR(p.venda || p.valor || 0);
    const qtd = numBR(p.qtd || 1) || 1;
    const vFinal = +(qtd * vBruto * (1 - descPeca)).toFixed(2);
    const colsGov = (ehGov && descPeca > 0) ? '120px 1fr 60px 100px 80px 32px' : '120px 1fr 60px 100px 32px';
    const badgePeca = (ehGov && descPeca > 0) ? `
      <div class="peca-desc-box" style="font-family:var(--fm);font-size:0.72rem;color:var(--ok);text-align:right;line-height:1.2;">
        <div class="peca-desc-pct" style="color:var(--purple,#A78BFA);font-size:0.65rem;">-${(descPeca*100).toFixed(0)}%</div>
        <div class="peca-desc-val">R$ ${vFinal.toFixed(2).replace('.',',')}</div>
      </div>` : '';

    div.style.cssText = `display:grid;grid-template-columns:${colsGov};gap:8px;align-items:center;`;
    div.dataset.pecaAvulsa = '1';
    div.dataset.cilia = '1';
    div.dataset.ciliaBruto = String(vBruto);
    div.dataset.ciliaLiquido = String(numBR(p.ciliaValorLiquido || 0));
    div.dataset.ciliaDesconto = String(numBR(p.ciliaDesconto || 0));
    div.dataset.ciliaPieceIndex = String(_ciliaPecaIndexCounter);
    div.innerHTML = `
      <input type="text" class="j-input peca-codigo" value="${_escVal(p.codigo)}" placeholder="Código OEM" style="font-family:var(--fm);font-size:0.78rem;" title="Código OEM (editável)">
      <input type="text" class="j-input peca-desc-livre" value="${_escVal(p.desc)}" placeholder="Descrição da peça" oninput="window.calcOSTotal()">
      <input type="number" class="j-input peca-qtd" value="${qtd}" min="1" oninput="window.calcOSTotal()" title="Quantidade importada do Cília">
      <input type="text" inputmode="decimal" class="j-input peca-venda" value="${vBruto.toFixed(2).replace('.', ',')}" placeholder="Valor unit." oninput="this.dataset.editadoManual='1';window.calcOSTotal()" title="Valor unitário bruto importado do Cília (editável)">
      ${badgePeca}
      <button type="button" onclick="this.closest('.cilia-peca-wrap').remove();window.calcOSTotal()" style="background:rgba(255,59,59,0.1);border:1px solid rgba(255,59,59,0.3);border-radius:2px;color:var(--danger);cursor:pointer;width:32px;height:32px;" title="Remover peça e seus serviços">✕</button>
    `;
    wrap.appendChild(div);

    const servBloco = document.createElement('div');
    servBloco.className = 'cilia-servs-relacionados';
    servBloco.style.cssText = 'margin-top:8px;padding-top:8px;border-top:1px dashed rgba(0,212,255,0.20);';
    servBloco.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;gap:8px;flex-wrap:wrap;">
        <span style="font-family:var(--fm);font-size:0.65rem;color:var(--muted);letter-spacing:1px;">SERVIÇOS RELACIONADOS A ESTA PEÇA</span>
        <button type="button" onclick="window._ciliaAddServicoRelacionado(this)" style="background:rgba(0,212,255,0.10);border:1px solid var(--cyan);color:var(--cyan);padding:3px 10px;font-size:0.65rem;border-radius:3px;cursor:pointer;font-family:var(--fm);letter-spacing:0.5px;">+ SERVIÇO MANUAL / TEMPA</button>
      </div>
      <div class="cilia-servs-list"></div>
    `;
    wrap.appendChild(servBloco);

    if (typeof $ === 'function' && $('containerPecasOS')) {
      $('containerPecasOS').appendChild(wrap);
    }

    if (tempaOk) {
      const itemTempa = _ciliaBuscarServicoTempa(p, veiculoAtual);
      if (itemTempa) {
        window._ciliaAddServicoRelacionado(servBloco.querySelector('button'), {
          itemTempa,
          peca: p,
          ehGov,
          veiculoAtual,
          valorHoraOficina,
          auto: true
        });
        servicosTempa++;
      } else {
        semServicoTempa++;
        _ciliaAvisoServicoSemTempa(servBloco, p);
      }
    } else {
      semServicoTempa++;
      _ciliaAvisoServicoSemTempa(servBloco, p, 'Tabela Tempária não carregada. Serviço deve ser preenchido manualmente.');
    }

    _ciliaPecaIndexCounter++;
  }

  if (typeof window.calcOSTotal === 'function') window.calcOSTotal();
  if (typeof window.toast === 'function') {
    const msg = servicosTempa
      ? `✓ ${pecas.length} peça(s) importada(s) do Cília + ${servicosTempa} serviço(s) puxado(s) da Tabela Tempária${semServicoTempa ? ` (${semServicoTempa} sem match)` : ''}`
      : `✓ ${pecas.length} peça(s) importada(s) do Cília. Nenhum serviço automático encontrado na Tabela Tempária.`;
    window.toast(msg, servicosTempa ? 'ok' : 'warn');
  }
}

async function _ciliaGarantirTabelaTempa() {
  try {
    if (typeof window.tempaCarregar !== 'function' || typeof window.tempaBuscarPorTexto !== 'function') return false;
    await window.tempaCarregar();
    return !!window._tabelaTempa?.carregada;
  } catch (e) {
    console.warn('[Cília x Tabela Tempária] Falha ao carregar tabela:', e);
    return false;
  }
}

function _ciliaBuscarServicoTempa(peca, veiculoAtual) {
  if (typeof window.tempaBuscarPorTexto !== 'function') return null;
  const desc = String(peca?.desc || '').trim();
  const codigo = String(peca?.codigo || '').trim();
  if (!desc && !codigo) return null;
  const descLimpa = _ciliaLimparDescParaTempa(desc);
  const consultas = [
    `substituir ${descLimpa}`,
    `troca ${descLimpa}`,
    `remover e instalar ${descLimpa}`,
    descLimpa,
    codigo
  ].filter(Boolean);

  const vistos = new Set();
  for (const consulta of consultas) {
    const resultados = window.tempaBuscarPorTexto(consulta, { veiculo: veiculoAtual, limite: 8 }) || [];
    for (const item of resultados) {
      const chave = `${item.codigo || ''}|${item.sistema || ''}|${item.operacao || ''}|${item.item || ''}`;
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      if (numBR(item.tempo || 0) > 0) return item;
    }
  }
  return null;
}

function _ciliaLimparDescParaTempa(desc) {
  return String(desc || '')
    .replace(/\b(original|genuina|genuino|paralela|paralelo|lado|ld|le|dianteiro|dianteira|traseiro|traseira|direito|direita|esquerdo|esquerda|inferior|superior)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function _ciliaAvisoServicoSemTempa(servBloco, peca, mensagem) {
  const list = servBloco?.querySelector?.('.cilia-servs-list');
  if (!list) return;
  const aviso = document.createElement('div');
  aviso.className = 'cilia-tempa-sem-match';
  aviso.style.cssText = 'font-family:var(--fm);font-size:0.62rem;color:var(--warn);background:rgba(255,184,0,0.06);border:1px solid rgba(255,184,0,0.22);border-radius:3px;padding:6px 8px;margin-bottom:5px;';
  aviso.textContent = mensagem || `Sem correspondência segura na Tabela Tempária para: ${String(peca?.desc || peca?.codigo || '').slice(0, 80)}. Use + SERVIÇO MANUAL se necessário.`;
  list.appendChild(aviso);
}

function _ciliaContextoServico(row) {
  const wrap = row?.closest?.('.cilia-peca-wrap') || null;
  const pecaRow = wrap?.querySelector?.('[data-cilia="1"], [data-peca-avulsa="1"]') || null;
  const ehGov = typeof window._osClienteGovernamental === 'function' && window._osClienteGovernamental();
  return {
    wrap,
    pecaRow,
    ehGov,
    veiculoAtual: window._osVeiculoAtual?.() || {},
    valorHoraOficina: window._osValorHoraCliente?.() || window.J?.valorHoraMecanica || 120,
    pecaDesc: row?.dataset?.pecaDesc || pecaRow?.querySelector?.('.peca-desc-livre')?.value || '',
    pecaCodigo: row?.dataset?.pecaCodigo || pecaRow?.querySelector?.('.peca-codigo')?.value || ''
  };
}

function _ciliaDescricaoServicoTempa(itemTempa) {
  return `${itemTempa?.operacao || 'SERVIÇO'} ${itemTempa?.item || ''}`.replace(/\s+/g, ' ').trim();
}

function _ciliaResolverValorHoraTempa(itemTempa, ctx) {
  const secaoInfo = ctx.ehGov && OSU().inferPMSPValorHora
    ? OSU().inferPMSPValorHora(itemTempa, { veiculo: ctx.veiculoAtual || {} })
    : null;
  const valorHora = secaoInfo?.valor || (!ctx.ehGov ? numBR(ctx.valorHoraOficina || window.J?.valorHoraMecanica || 120) : 0);
  return { secaoInfo, valorHora: numBR(valorHora || 0) };
}

function _ciliaValorServicoFmt(row) {
  const valor = numBR(row?.querySelector?.('.serv-valor')?.value || 0);
  return valor.toFixed(2).replace('.', ',');
}

function _ciliaAtualizarMetaServico(row, texto, tipo) {
  const meta = row?.querySelector?.('.serv-tempa-meta');
  if (!meta) return;
  const cor = tipo === 'warn' ? 'var(--warn)' : tipo === 'ok' ? 'var(--success)' : 'var(--muted)';
  meta.style.color = cor;
  meta.innerHTML = `${texto}<span class="serv-desc-val" style="float:right;color:var(--ok);">R$ ${_ciliaValorServicoFmt(row)}</span>`;
}

function _ciliaMetaTempaHTML(itemTempa, secaoInfo, valorHora, prefixo) {
  const tempo = numBR(itemTempa?.tempo || 0).toFixed(2).replace('.', ',');
  const horaTxt = valorHora ? ` · R$ ${numBR(valorHora).toFixed(2).replace('.', ',')}/h` : '';
  const secaoTxt = secaoInfo?.label ? ` · ${escOS(secaoInfo.label)}` : '';
  const tipoTxt = extrairTipoVeiculoTempaOS({ sistemaTabela: itemTempa?.sistema, sistema: itemTempa?.sistema }, window._osVeiculoAtual?.() || {});
  return `${prefixo || 'Tabela Tempária'} · ${escOS(itemTempa?.sistema || '-')} · cód. ${escOS(itemTempa?.codigo || '-')} · tipo veículo ${escOS(tipoTxt || '-')} · TMO ${tempo}h${secaoTxt}${horaTxt}`;
}

function _ciliaAplicarItemTempaNaLinha(row, itemTempa, opts = {}) {
  if (!row || !itemTempa) return;
  const ctx = _ciliaContextoServico(row);
  const { secaoInfo, valorHora } = _ciliaResolverValorHoraTempa(itemTempa, ctx);
  const tempo = numBR(itemTempa.tempo || 0);
  const valor = tempo > 0 && valorHora > 0 ? +(tempo * valorHora).toFixed(2) : 0;

  row.dataset.ciliaAutoTempa = '1';
  row.dataset.tempaManual = opts.marcadoComoEditado ? '1' : '';
  row.dataset.valorManual = '';
  row.dataset.valorHoraManual = '';
  row.dataset.tempoTabela = String(itemTempa.tempo || '');
  row.dataset.codigoTabela = itemTempa.codigo || '';
  row.dataset.sistemaTabela = itemTempa.sistema || '';
  row.dataset.tipoVeiculoTabela = extrairTipoVeiculoTempaOS({ sistemaTabela: itemTempa.sistema, sistema: itemTempa.sistema }, ctx.veiculoAtual || window._osVeiculoAtual?.() || {});
  row.dataset.secaoHora = secaoInfo?.key || '';
  row.dataset.secaoHoraLabel = secaoInfo?.label || itemTempa.sistema || '';
  row.dataset.valorHoraSecao = secaoInfo?.valor || '';

  const descInput = row.querySelector('.serv-desc');
  const tempoInput = row.querySelector('.serv-tempo');
  const valorHoraInput = row.querySelector('.serv-valor-hora');
  const valorInput = row.querySelector('.serv-valor');
  const descTempa = _ciliaDescricaoServicoTempa(itemTempa);
  if (descInput) descInput.value = descTempa;
  if (tempoInput) tempoInput.value = tempo.toFixed(2).replace('.', ',');
  if (valorHoraInput) valorHoraInput.value = valorHora ? valorHora.toFixed(2).replace('.', ',') : '0,00';
  if (valorInput) valorInput.value = valor.toFixed(2).replace('.', ',');
  const buscaInput = row.querySelector('.serv-tempa-busca');
  const lista = row.querySelector('.serv-tempa-resultados-list');
  if (buscaInput) buscaInput.value = descTempa;
  if (lista) lista.style.display = 'none';

  _ciliaAtualizarMetaServico(row, _ciliaMetaTempaHTML(itemTempa, secaoInfo, valorHora, opts.prefixo || 'Tabela Tempária aplicada'), 'ok');
  if (typeof window.calcOSTotal === 'function') window.calcOSTotal();
}

window._ciliaRecalcularServicoRelacionado = function(row) {
  if (!row) return;
  const tempo = numBR(row.querySelector('.serv-tempo')?.value || 0);
  const valorHora = numBR(row.querySelector('.serv-valor-hora')?.value || 0);
  const valorInput = row.querySelector('.serv-valor');
  if (valorInput && row.dataset.valorManual !== '1') {
    valorInput.value = (tempo * valorHora).toFixed(2).replace('.', ',');
  }
  if (typeof window.calcOSTotal === 'function') window.calcOSTotal();
};

function _ciliaTermoDigitadoServico(row) {
  const buscaEl = row?.querySelector?.('.serv-tempa-busca');
  const descEl = row?.querySelector?.('.serv-desc');
  const busca = buscaEl?.value?.trim() || '';
  const desc = descEl?.value?.trim() || '';
  // Quem manda na Tempária é o campo que o usuário está digitando agora.
  // Se ele trocar "bomba de combustível" por "pastilha", nunca pode continuar buscando bomba.
  if (document.activeElement === buscaEl) return busca;
  if (document.activeElement === descEl) return desc;
  return busca || desc || row?.dataset?.pecaDesc || row?.dataset?.pecaCodigo || '';
}

function _ciliaLimparResultadosTempaServico(row) {
  const lista = row?.querySelector?.('.serv-tempa-resultados-list');
  const aplicar = row?.querySelector?.('.serv-tempa-aplicar');
  if (lista) { lista.innerHTML = ''; lista.style.display = 'none'; }
  if (aplicar) { aplicar.style.display = 'none'; aplicar.dataset.idx = ''; }
  row._ciliaTempaResultados = [];
}

function _ciliaRenderResultadosTempaServico(row, resultados, termo) {
  const lista = row?.querySelector?.('.serv-tempa-resultados-list');
  const aplicar = row?.querySelector?.('.serv-tempa-aplicar');
  if (!lista) return;
  row._ciliaTempaResultados = resultados || [];
  if (!resultados || !resultados.length) {
    lista.style.display = 'block';
    lista.innerHTML = `<div class="cilia-tempa-empty">Nenhum serviço da Tabela Tempária encontrado para “${escOS(termo)}”. Você pode manter digitado manualmente.</div>`;
    if (aplicar) { aplicar.style.display = 'none'; aplicar.dataset.idx = ''; }
    _ciliaAtualizarMetaServico(row, `Sem resultado na Tabela Tempária para “${escOS(termo)}”. Digite outro termo ou mantenha manual.`, 'warn');
    return;
  }
  lista.style.display = 'block';
  lista.innerHTML = resultados.map((it, i) => {
    const tempo = numBR(it.tempo || 0).toFixed(2).replace('.', ',');
    const label = `[${escOS(it.codigo || '-')}] ${escOS(it.sistema || '-')} · ${escOS(it.operacao || '')} ${escOS(it.item || '')}`;
    return `<button type="button" class="cilia-tempa-opcao" data-idx="${i}" onclick="window._ciliaSelecionarResultadoTempaServico(this)" style="width:100%;display:grid;grid-template-columns:minmax(0,1fr) 74px;gap:10px;align-items:center;text-align:left;margin:4px 0;padding:9px 10px;background:rgba(0,212,255,0.06);border:1px solid rgba(0,212,255,0.22);color:var(--text);border-radius:5px;cursor:pointer;font-size:.72rem;font-family:var(--fd);white-space:normal;">
      <span style="min-width:0;white-space:normal;line-height:1.25;">${label}</span>
      <b style="font-family:var(--fm);color:var(--success);text-align:right;white-space:nowrap;">${tempo}h</b>
    </button>`;
  }).join('');
  if (aplicar) { aplicar.style.display = 'none'; aplicar.dataset.idx = ''; }
  _ciliaAtualizarMetaServico(row, `${resultados.length} resultado(s) PRECISO(S) da Tabela Tempária para “${escOS(termo)}”. Clique em um item para aplicar.`, 'ok');
}

async function _ciliaBuscarTempaServicoInline(row, termo, opts = {}) {
  if (!row) return [];
  const q = String(termo || '').trim();
  if (q.length < 2) {
    _ciliaLimparResultadosTempaServico(row);
    return [];
  }
  const ok = await _ciliaGarantirTabelaTempa();
  if (!ok || typeof window.tempaBuscarPorTexto !== 'function') {
    _ciliaAtualizarMetaServico(row, 'Tabela Tempária não carregou. Verifique data/tabela-tempa.min.json.', 'warn');
    return [];
  }
  const ctx = _ciliaContextoServico(row);
  const resultados = window.tempaBuscarPorTexto(q, { veiculo: ctx.veiculoAtual, limite: opts.limite || 120, preciso: true }) || [];
  _ciliaRenderResultadosTempaServico(row, resultados, q);
  return resultados;
}

window._ciliaSelecionarResultadoTempaServico = function(btn) {
  const row = btn?.closest?.('.cilia-serv-relac');
  if (!row) return;
  const idx = parseInt(btn.dataset.idx || '-1', 10);
  const itemTempa = (row._ciliaTempaResultados || [])[idx];
  if (!itemTempa) return;
  _ciliaAplicarItemTempaNaLinha(row, itemTempa, { prefixo: 'Tabela Tempária aplicada pelo serviço digitado' });
  window.toast?.('✓ Serviço aplicado pela Tabela Tempária. Você ainda pode editar livremente.', 'ok');
};

window._ciliaAgendarBuscaTempaServico = function(el) {
  const row = el?.closest?.('.cilia-serv-relac');
  if (!row) return;
  const termo = _ciliaTermoDigitadoServico(row);
  clearTimeout(row._ciliaBuscaTimer);
  if (!termo || termo.trim().length < 2) {
    _ciliaLimparResultadosTempaServico(row);
    return;
  }
  row._ciliaBuscaTimer = setTimeout(() => _ciliaBuscarTempaServicoInline(row, termo, { limite: 120 }), 220);
};

window._ciliaServicoEditado = function(el, tipo) {
  const row = el?.closest?.('.cilia-serv-relac');
  if (!row) return;
  row.dataset.tempaManual = '1';
  if (tipo === 'desc') {
    // Ao trocar "substituir bomba" por "pastilha", a busca TEMPA deve seguir PASTILHA imediatamente.
    const buscaInput = row.querySelector('.serv-tempa-busca');
    if (buscaInput && document.activeElement !== buscaInput) buscaInput.value = el.value || '';
    row.dataset.codigoTabela = row.dataset.codigoTabela || '';
    window._ciliaAgendarBuscaTempaServico(el);
  }
  if (tipo === 'valor') row.dataset.valorManual = '1';
  if (tipo === 'valorHora') row.dataset.valorHoraManual = '1';
  if (tipo === 'tempo' || tipo === 'valorHora') {
    window._ciliaRecalcularServicoRelacionado(row);
  } else if (typeof window.calcOSTotal === 'function') {
    window.calcOSTotal();
  }
  const cod = row.dataset.codigoTabela || '';
  if (cod && tipo !== 'desc') {
    _ciliaAtualizarMetaServico(row, `EDITADO MANUALMENTE · origem Tempária cód. ${escOS(cod)} preservada. Digite no campo do serviço ou na busca TEMPA para trocar por outro item.`, 'warn');
  } else if (!cod && tipo !== 'desc') {
    _ciliaAtualizarMetaServico(row, 'Serviço manual vinculado à peça. Digite o serviço e a Tempária aparecerá conforme o texto.', 'warn');
  }
};

window._ciliaPesquisarTempaServico = async function(btn) {
  const row = btn?.closest?.('.cilia-serv-relac');
  if (!row) return;
  const buscaInput = row.querySelector('.serv-tempa-busca');
  const descInput = row.querySelector('.serv-desc');
  const q = (buscaInput?.value || descInput?.value || row.dataset.pecaDesc || row.dataset.pecaCodigo || '').trim();
  if (!q) { window.toast?.('Digite o serviço/peça que deseja procurar na Tabela Tempária.', 'warn'); return; }
  await _ciliaBuscarTempaServicoInline(row, q, { limite: 160 });
};

window._ciliaAplicarTempaSelecionada = function(btn) {
  const row = btn?.closest?.('.cilia-serv-relac');
  if (!row) return;
  const idx = parseInt(btn?.dataset?.idx || '-1', 10);
  const itemTempa = (row._ciliaTempaResultados || [])[idx];
  if (!itemTempa) { window.toast?.('Clique em um resultado da Tabela Tempária para aplicar.', 'warn'); return; }
  _ciliaAplicarItemTempaNaLinha(row, itemTempa, { prefixo: 'Tabela Tempária aplicada manualmente' });
  window.toast?.('✓ Serviço preenchido pela Tabela Tempária. Você ainda pode editar livremente.', 'ok');
};

window.renderCiliaPecaOSRow = function(p, servicosRelacionados = []) {
  const wrap = document.createElement('div');
  wrap.className = 'cilia-peca-wrap';
  wrap.dataset.ciliaPieceIndex = String(p.ciliaPieceIndex ?? document.querySelectorAll('#containerPecasOS [data-cilia-piece-index]').length);
  wrap.style.cssText = 'border:1px solid rgba(0,212,255,0.18);border-radius:6px;padding:8px;margin-bottom:8px;background:rgba(0,212,255,0.035);';

  const qtd = numBR(p.qtd || p.q || 1) || 1;
  const vBruto = numBR(p.venda || p.v || p.ciliaBruto || 0);
  const div = document.createElement('div');
  div.dataset.pecaAvulsa = '1';
  div.dataset.cilia = '1';
  div.dataset.ciliaBruto = String(p.ciliaBruto || vBruto);
  div.dataset.ciliaLiquido = String(p.ciliaValorLiquido || 0);
  div.dataset.ciliaDesconto = String(p.ciliaDesconto || 0);
  div.dataset.ciliaPieceIndex = String(wrap.dataset.ciliaPieceIndex);
  div.style.cssText = 'display:grid;grid-template-columns:120px 1fr 60px 100px 32px;gap:8px;align-items:center;background:rgba(0,212,255,0.06);padding:8px;border-radius:4px;border:1px solid rgba(0,212,255,0.18);';
  div.innerHTML = `
    <input type="text" class="j-input peca-codigo" value="${_escVal(p.codigo || '')}" placeholder="Código Cília/OEM" style="font-family:var(--fm);font-size:0.78rem;">
    <input type="text" class="j-input peca-desc-livre" value="${_escVal(p.desc || '')}" placeholder="Descrição da peça Cília" oninput="window.calcOSTotal()">
    <input type="number" class="j-input peca-qtd" value="${qtd}" min="1" oninput="window.calcOSTotal()" style="text-align:center;">
    <input type="text" inputmode="decimal" class="j-input peca-venda" value="${vBruto.toFixed(2).replace('.', ',')}" placeholder="Valor" oninput="window.calcOSTotal()">
    <button type="button" onclick="this.closest('.cilia-peca-wrap').remove();window.calcOSTotal()" style="background:rgba(255,59,59,0.1);border:1px solid rgba(255,59,59,0.3);border-radius:2px;color:var(--danger);cursor:pointer;width:32px;height:32px;" title="Remover peça e seus serviços">✕</button>
  `;
  wrap.appendChild(div);

  const servBloco = document.createElement('div');
  servBloco.className = 'cilia-servs-relacionados';
  servBloco.style.cssText = 'margin-top:7px;padding-left:12px;border-left:2px solid rgba(0,212,255,0.28);';
  servBloco.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px;gap:8px;">
      <span style="font-family:var(--fm);font-size:0.62rem;color:var(--muted);letter-spacing:.5px;">SERVIÇOS VINCULADOS À PEÇA CÍLIA</span>
      <button type="button" onclick="window._ciliaAddServicoRelacionado(this)" style="background:rgba(0,212,255,0.10);border:1px solid var(--cyan);color:var(--cyan);padding:3px 10px;font-size:0.65rem;border-radius:3px;cursor:pointer;font-family:var(--fm);letter-spacing:0.5px;">+ SERVIÇO MANUAL / TEMPA</button>
    </div>
    <div class="cilia-servs-list"></div>
  `;
  wrap.appendChild(servBloco);

  if (typeof $ === 'function' && $('containerPecasOS')) $('containerPecasOS').appendChild(wrap);
  (servicosRelacionados || []).forEach(s => {
    window._ciliaAddServicoRelacionado(servBloco.querySelector('button'), { servico: s, peca: p, auto: false });
  });
  if (typeof window.calcOSTotal === 'function') window.calcOSTotal();
};

// Helper: adiciona serviço dentro do bloco da peça importada do Cília.
// Quando recebe opts.itemTempa, já preenche TMO, código, sistema e valor a partir da Tabela Tempária.
window._ciliaAddServicoRelacionado = function(btn, opts = {}) {
  const wrap = btn?.closest?.('.cilia-peca-wrap');
  if (!wrap) return;
  const list = wrap.querySelector('.cilia-servs-list');
  if (!list) return;

  const pecaRow = wrap.querySelector('[data-cilia="1"], [data-peca-avulsa="1"]');
  const pecaDesc = opts.peca?.desc || pecaRow?.querySelector?.('.peca-desc-livre')?.value || '';
  const pecaCodigo = opts.peca?.codigo || pecaRow?.querySelector?.('.peca-codigo')?.value || '';
  const itemTempa = opts.itemTempa || null;
  const servico = opts.servico || null;
  const ehGov = !!opts.ehGov || (typeof window._osClienteGovernamental === 'function' && window._osClienteGovernamental());
  const ctxBase = { ehGov, veiculoAtual: opts.veiculoAtual || window._osVeiculoAtual?.() || {}, valorHoraOficina: opts.valorHoraOficina || window._osValorHoraCliente?.() || window.J?.valorHoraMecanica || 120 };

  let desc = servico?.desc || '';
  let tempo = numBR(servico?.tempo || 0);
  let valorHora = numBR(servico?.valorHora || servico?.valorHoraSecao || 0);
  let valor = numBR(servico?.valor || 0);
  let metaHTML = servico?.codigoTabela
    ? `Tabela Tempária preservada · ${escOS(servico.sistemaTabela || '-')} · cód. ${escOS(servico.codigoTabela || '-')} · TMO ${numBR(servico.tempo || 0).toFixed(2).replace('.', ',')}h`
    : 'Serviço manual vinculado a esta peça. Digite livremente; a Tempária aparece conforme o texto.';
  let metaTipo = servico?.codigoTabela ? 'ok' : 'warn';

  if (itemTempa) {
    const { secaoInfo, valorHora: vh } = _ciliaResolverValorHoraTempa(itemTempa, ctxBase);
    tempo = numBR(itemTempa.tempo || 0);
    valorHora = vh;
    valor = tempo > 0 && valorHora > 0 ? +(tempo * valorHora).toFixed(2) : 0;
    desc = _ciliaDescricaoServicoTempa(itemTempa);
    metaHTML = _ciliaMetaTempaHTML(itemTempa, secaoInfo, valorHora, opts.auto ? 'AUTO: Tabela Tempária' : 'Tabela Tempária');
    metaTipo = 'ok';
  }

  if (!desc) desc = pecaDesc ? `Troca de ${String(pecaDesc).trim()}` : '';

  const row = document.createElement('div');
  row.className = 'cilia-serv-relac';
  row.dataset.servRelacionado = '1';
  row.dataset.ciliaPieceIndex = wrap.dataset.ciliaPieceIndex || '';
  row.dataset.pecaDesc = pecaDesc || '';
  row.dataset.pecaCodigo = pecaCodigo || '';
  row.dataset.tempaManual = servico?.tempaManual ? '1' : (itemTempa ? '' : '1');

  if (itemTempa) {
    const { secaoInfo } = _ciliaResolverValorHoraTempa(itemTempa, ctxBase);
    row.dataset.ciliaAutoTempa = '1';
    row.dataset.tempoTabela = String(itemTempa.tempo || '');
    row.dataset.codigoTabela = itemTempa.codigo || '';
    row.dataset.sistemaTabela = itemTempa.sistema || '';
    row.dataset.tipoVeiculoTabela = extrairTipoVeiculoTempaOS({ sistemaTabela: itemTempa.sistema, sistema: itemTempa.sistema }, ctxBase.veiculoAtual || window._osVeiculoAtual?.() || {});
    row.dataset.secaoHora = secaoInfo?.key || '';
    row.dataset.secaoHoraLabel = secaoInfo?.label || itemTempa.sistema || '';
    row.dataset.valorHoraSecao = secaoInfo?.valor || '';
  } else if (servico) {
    row.dataset.ciliaAutoTempa = servico.origemServico === 'cilia_tabela_tempa' ? '1' : '';
    row.dataset.tempoTabela = String(servico.tempoTabela || servico.tempo || '');
    row.dataset.codigoTabela = servico.codigoTabela || servico.codigo || '';
    row.dataset.sistemaTabela = servico.sistemaTabela || servico.sistema || '';
    row.dataset.tipoVeiculoTabela = servico.tipoVeiculoTabela || servico.tipoVeiculoTempa || extrairTipoVeiculoTempaOS(servico, ctxBase.veiculoAtual || window._osVeiculoAtual?.() || {});
    row.dataset.secaoHora = servico.secaoHora || '';
    row.dataset.secaoHoraLabel = servico.secaoHoraLabel || servico.sistemaTabela || '';
    row.dataset.valorHoraSecao = servico.valorHoraTabela || servico.valorHoraSecao || '';
    row.dataset.valorHoraManual = servico.valorHoraManual ? '1' : '';
    row.dataset.valorManual = servico.valorManual ? '1' : '';
  }

  row.style.cssText = 'display:grid;grid-template-columns:minmax(280px,1fr) 74px 104px 110px 90px 34px;gap:7px;align-items:center;margin-bottom:8px;background:rgba(0,0,0,0.16);border:1px solid rgba(0,212,255,0.14);border-radius:6px;padding:8px;';
  row.innerHTML = `
    <input type="text" class="j-input serv-desc" value="${_escVal(desc)}" placeholder="Digite o serviço: substituir, reparar, recondicionar, regular..." oninput="window._ciliaServicoEditado(this,'desc')" style="font-size:0.78rem;min-width:260px;">
    <input type="text" inputmode="decimal" class="j-input serv-tempo" value="${tempo ? tempo.toFixed(2).replace('.', ',') : '0,00'}" placeholder="h" title="Tempo/TMO" oninput="window._ciliaServicoEditado(this,'tempo')" style="font-size:0.78rem;text-align:center;">
    <input type="text" inputmode="decimal" class="j-input serv-valor-hora" value="${valorHora ? valorHora.toFixed(2).replace('.', ',') : '0,00'}" placeholder="R$/h" title="Valor hora" oninput="window._ciliaServicoEditado(this,'valorHora')" style="font-size:0.78rem;text-align:right;">
    <input type="text" inputmode="decimal" class="j-input serv-valor" value="${valor.toFixed(2).replace('.', ',')}" placeholder="R$" oninput="window._ciliaServicoEditado(this,'valor')" style="font-size:0.78rem;text-align:right;">
    <button type="button" onclick="window._ciliaPesquisarTempaServico(this)" style="background:rgba(0,212,255,0.10);border:1px solid var(--cyan);color:var(--cyan);border-radius:4px;cursor:pointer;height:34px;font-size:0.62rem;font-family:var(--fm);" title="Buscar serviço/TMO na Tabela Tempária">TEMPA</button>
    <button type="button" onclick="this.parentElement.remove();window.calcOSTotal()" style="background:rgba(255,59,59,0.1);border:1px solid rgba(255,59,59,0.3);border-radius:4px;color:var(--danger);cursor:pointer;width:34px;height:34px;font-size:0.85rem;" title="Remover serviço">✕</button>
    <div style="grid-column:1/-1;display:grid;grid-template-columns:minmax(260px,1fr) auto;gap:7px;align-items:start;">
      <input type="text" class="j-input serv-tempa-busca" value="${_escVal(desc || pecaDesc)}" placeholder="Pesquisar na Tempária pelo que você digitar: pastilha, recondicionar bomba, teste tanque..." oninput="window._ciliaAgendarBuscaTempaServico(this)" style="font-size:0.75rem;height:34px;width:100%;">
      <button type="button" class="serv-tempa-aplicar" onclick="window._ciliaAplicarTempaSelecionada(this)" style="display:none;align-items:center;justify-content:center;background:rgba(47,255,107,0.10);border:1px solid var(--success);color:var(--success);border-radius:4px;height:34px;font-size:0.62rem;font-family:var(--fm);cursor:pointer;padding:0 12px;white-space:nowrap;">APLICAR</button>
      <div class="serv-tempa-resultados-list" style="grid-column:1/-1;display:none;max-height:260px;overflow:auto;background:rgba(5,14,34,0.98);border:1px solid rgba(0,212,255,0.30);border-radius:6px;padding:5px;"></div>
    </div>
    <div class="serv-tempa-meta" style="grid-column:1/-1;font-family:var(--fm);font-size:0.60rem;letter-spacing:.4px;color:${metaTipo === 'ok' ? 'var(--success)' : 'var(--warn)'};">
      ${metaHTML}<span class="serv-desc-val" style="float:right;color:var(--ok);">R$ ${valor.toFixed(2).replace('.', ',')}</span>
    </div>
  `;
  list.appendChild(row);
  if (!opts.auto && !opts.servico) {
    setTimeout(() => {
      const inp = row.querySelector('.serv-desc');
      inp?.focus();
      if (inp && !inp.value) window._ciliaAgendarBuscaTempaServico(inp);
    }, 50);
  }
  if (typeof window.calcOSTotal === 'function') window.calcOSTotal();
};

function _escVal(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ── XML: estrutura esperada do Cília ──────────────────────────────────
// <Pecas><Peca><Codigo>XX</Codigo><Descricao>YY</Descricao><Quantidade>1</Quantidade><PrecoUnitario>100.00</PrecoUnitario></Peca></Pecas>
// Também tenta variações comuns de tag
function _ciliaProcessarXML(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const parser = new DOMParser();
      const xml = parser.parseFromString(e.target.result, 'application/xml');
      if (xml.querySelector('parsererror')) throw new Error('XML inválido ou corrompido.');

      const segmentos = Array.from(xml.querySelectorAll('segment')).map(n => n.textContent?.trim() || '').filter(Boolean);
      if (segmentos.length) {
        const pecasSegmentadas = OSU().parseCiliaPiecesFromTokens ? OSU().parseCiliaPiecesFromTokens(segmentos) : [];
        if (!pecasSegmentadas.length) throw new Error('Nenhuma peça encontrada nos segmentos do Cília.');
        _ciliaAdicionarPecas(pecasSegmentadas);
        return;
      }

      // Tenta vários nomes de tag de item
      const tagsCandidatas = ['Peca','peca','PECA','Item','item','ITEM','Produto','produto'];
      let nos = [];
      for (const tag of tagsCandidatas) {
        nos = Array.from(xml.querySelectorAll(tag));
        if (nos.length) break;
      }
      if (!nos.length) throw new Error('Nenhuma tag de peça reconhecida no XML. Verifique o arquivo Cília.');

      const pecas = nos.map(n => {
        const t = tag => n.querySelector(tag)?.textContent?.trim() || '';
        return {
          codigo: t('Codigo') || t('codigo') || t('CODIGO') || t('CodigoOEM') || t('codigoOem') || t('CodPeca') || '',
          desc:   t('Descricao') || t('descricao') || t('DESCRICAO') || t('Descr') || t('Nome') || t('nome') || '',
          qtd:    numBR(t('Quantidade') || t('quantidade') || t('Qtd') || t('qtd') || '1') || 1,
          venda:  numBR(t('PrecoUnitario') || t('precoUnitario') || t('Preco') || t('preco') || t('ValorUnitario') || '0') || 0
        };
      }).filter(p => p.desc || p.codigo);

      _ciliaAdicionarPecas(pecas);
    } catch(err) {
      if (typeof window.toast === 'function') window.toast('Erro ao ler XML Cília: ' + err.message, 'err');
    }
  };
  reader.readAsText(file, 'UTF-8');
}

// ── PDF: extrai texto e tenta parsear tabela de peças ────────────────
// Requer pdf.js (CDN) — carrega dinamicamente se não estiver presente
async function _ciliaProcessarPDF(file) {
  if (typeof window.toast === 'function') window.toast('Lendo PDF do Cília...', 'warn');
  try {
    // Carrega pdf.js dinamicamente
    if (!window.pdfjsLib) {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
        s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      });
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    // Coleta TODOS os spans com coordenadas X,Y de todas as páginas
    const allSpans = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      tc.items.forEach(item => {
        if (item.str.trim()) {
          allSpans.push({
            text: item.str.trim(),
            page: i,
            x: Math.round(item.transform[4]),
            y: Math.round(item.transform[5])
          });
        }
      });
    }

    // Agrupa por linha (Y ±4px), ordena por X dentro de cada linha
    const linhasMap = {};
    allSpans.forEach(sp => {
      const yKey = Math.round(sp.y / 4) * 4;
      if (!linhasMap[yKey]) linhasMap[yKey] = [];
      linhasMap[yKey].push(sp);
    });
    // PDF: Y cresce de baixo pra cima — invertemos para ter ordem natural
    const linhas = Object.keys(linhasMap)
      .map(Number)
      .sort((a, b) => b - a)
      .map(y => linhasMap[y].sort((a, b) => a.x - b.x).map(s => s.text).join(' '));

    const tokensOrdenados = linhas.join(' ').split(/\s+/).filter(Boolean);
    const utils = OSU();
    const sane = lista => !utils.isSaneCiliaPieces || utils.isSaneCiliaPieces(lista || []);
    let pecas = utils.parseCiliaPiecesFromSpans ? utils.parseCiliaPiecesFromSpans(allSpans) : [];
    if (!pecas.length || !sane(pecas)) {
      pecas = utils.parseCiliaPiecesFromLines ? utils.parseCiliaPiecesFromLines(linhas) : [];
    }
    if (!pecas.length || !sane(pecas)) {
      const porTokens = utils.parseCiliaPiecesFromTokens ? utils.parseCiliaPiecesFromTokens(tokensOrdenados) : [];
      pecas = sane(porTokens) ? porTokens : [];
    }
    const brl = s => numBR(s);

    for (const linha of (pecas.length ? [] : linhas)) {
      // ── PADRÃO PRINCIPAL CÍLIA ──────────────────────────────────────────────
      // "T R&I 0,00 1.00 BOMBA DE COMBUSTÍVEL Cód: 172029382R Oficina R$ 1.795,30 % 48,00 R$ 933,56"
      // Captura: operação | TMO | qtd | DESCRIÇÃO Cód: CODIGO Fornec | preçoBruto | %desc | preçoLíquido
      const mPrincipal = linha.match(
        /(?:[TR](?:\s+R&I)?)\s+[\d,]+\s+([\d,]+)\s+(.+?)\s+C.?d[:\.]\s*([A-Z0-9\-\.\/]+)\s+\w+\s+R\$\s*([\d\.,]+)\s+%\s*[\d,]+\s+R\$\s*([\d\.,]+)/i
      );
      if (mPrincipal) {
        pecas.push({
          codigo: mPrincipal[3].trim(),
          desc:   mPrincipal[2].trim(),
          qtd:    numBR(mPrincipal[1]) || 1,
          venda:  brl(mPrincipal[4]), // preço bruto fiel ao PDF; desconto do cliente calcula o líquido
          ciliaValorLiquido: brl(mPrincipal[5])
        });
        continue;
      }

      // ── PADRÃO SEM OPERAÇÃO: "DESCRICAO Cód: CODIGO Qtd R$ PRECO_LIQ" ──────
      const mSemOp = linha.match(/(.+?)\s+C.?d[:\.]\s*([A-Z0-9\-\.\/]+)\s+[\w\/]+\s+R\$\s*([\d\.,]+)\s+%\s*[\d,]+\s+R\$\s*([\d\.,]+)/i);
      if (mSemOp) {
        pecas.push({
          codigo: mSemOp[2].trim(),
          desc:   mSemOp[1].trim(),
          qtd:    1,
          venda:  brl(mSemOp[3]),
          ciliaValorLiquido: brl(mSemOp[4])
        });
        continue;
      }

      // ── PADRÃO LEGADO (espaços largos): "CODIGO   DESCRICAO   QTD   VALOR" ─
      const mLeg = linha.match(/^([A-Z0-9\-\.\/]{4,25})\s{2,}(.+?)\s{2,}(\d+(?:[,.]\d+)?)\s{2,}([\d\.,]+)\s*$/);
      if (mLeg) {
        pecas.push({
          codigo: mLeg[1].trim(),
          desc:   mLeg[2].trim(),
          qtd:    numBR(mLeg[3]) || 1,
          venda:  brl(mLeg[4])
        });
      }
    }

    if (!pecas.length || !sane(pecas)) {
      if (typeof window.toast === 'function') window.toast('Não foi possível extrair as peças do PDF Cília com segurança. Tente exportar o Cília em XML para melhor resultado.', 'warn');
      return;
    }
    _ciliaAdicionarPecas(pecas);
  } catch(err) {
    if (typeof window.toast === 'function') window.toast('Erro ao ler PDF Cília: ' + err.message, 'err');
    console.error('[Cília PDF]', err);
  }
}
