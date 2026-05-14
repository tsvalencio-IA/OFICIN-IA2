/*
 * thIAguinho ERP — NFe Entrada PRO 10/10
 * Correção profissional para XML/NFe de autopeças/oficinas.
 * - Mantém o módulo financeiro existente e sobrescreve apenas o fluxo de Entrada NF.
 * - Lê valores fiscais com ponto decimal do XML sem converter para milhares.
 * - Salva espelho completo da NF, itens fiscais, destino por item, vínculos com OS/placa e duplicatas no financeiro.
 * Powered by thIAguinho Soluções Digitais
 */
(function(){
  'use strict';
  const W = window;
  const D = document;
  const $ = (id) => D.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const onlyDigits = (s) => String(s || '').replace(/\D+/g, '');
  const isoToday = () => {
    const d = new Date();
    const z = (n) => String(n).padStart(2,'0');
    return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`;
  };
  const brDate = (iso) => {
    const s = String(iso || '');
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
  };
  const fmtBR = (v) => (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtQtd = (v) => {
    const n = Number(v) || 0;
    return Number.isInteger(n) ? String(n) : String(n).replace('.', ',');
  };
  function parseNum(v){
    if (v == null) return 0;
    let s = String(v).trim();
    if (!s) return 0;
    s = s.replace(/R\$|\s/g, '');
    // XML NFe usa ponto decimal. Campo digitado no Brasil pode usar vírgula.
    if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
    else if (s.includes(',')) s = s.replace(',', '.');
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }
  function dividirDescricaoProdutoNFePro(xProd, cProd){
    const original = String(xProd || '').trim().replace(/\s+/g, ' ');
    let codigoComercial = '';
    let descricaoLimpa = original;
    let marca = '';

    // Padrões reais observados em XML de autopeças:
    // WO150-FILTRO DE OLEO LUBRIFICANTE - WEGA
    // 40859X22XS-CORREIA COMANDO VALVULAS - GATES
    // AMORTECEDOR DIANTEIRO - AMD0356 - PERFECT
    const partes = original.split(/\s+-\s+/).map(x => x.trim()).filter(Boolean);
    if (partes.length >= 2) {
      const primeiro = partes[0];
      const ultimo = partes[partes.length - 1];
      if (/^[A-Z0-9][A-Z0-9\.\/\-]{2,}$/i.test(primeiro) && /[A-Z]/i.test(primeiro) && /\d/.test(primeiro)) {
        codigoComercial = primeiro;
        descricaoLimpa = partes.slice(1, partes.length - 1).join(' - ') || partes[1] || original;
        marca = partes.length >= 3 ? ultimo : '';
      } else {
        descricaoLimpa = partes.slice(0, partes.length - 1).join(' - ') || primeiro;
        marca = ultimo;
        const codInterno = descricaoLimpa.match(/\b([A-Z]{1,4}\d{2,}[A-Z0-9\-\.]*)\b/i);
        if (codInterno) codigoComercial = codInterno[1];
      }
    } else {
      const m = original.match(/^([A-Z0-9][A-Z0-9\.\/\-]{2,})[-\s]+(.+)$/i);
      if (m && /\d/.test(m[1])) { codigoComercial = m[1]; descricaoLimpa = m[2].trim(); }
    }
    descricaoLimpa = descricaoLimpa.replace(/^[-\s]+|[-\s]+$/g, '').replace(/\s+/g, ' ');
    return {
      codigoFornecedor: String(cProd || '').trim(),
      codigoComercial: codigoComercial || String(cProd || '').trim(),
      oem: codigoComercial || String(cProd || '').trim(),
      descricaoOriginal: original,
      descricaoLimpa: descricaoLimpa || original,
      marca: marca || ''
    };
  }
  function setVal(id, val){ const el = $(id); if(el) el.value = val ?? ''; }
  function getVal(id){ return ($(id)?.value || '').trim(); }
  function getFirstText(node, tag){
    if(!node) return '';
    const a = node.getElementsByTagName(tag);
    if(a && a[0]) return (a[0].textContent || '').trim();
    const b = node.getElementsByTagNameNS('*', tag);
    if(b && b[0]) return (b[0].textContent || '').trim();
    return '';
  }
  function child(node, tag){
    if(!node) return null;
    const kids = node.children || [];
    for(const k of kids){ if((k.localName || k.nodeName) === tag) return k; }
    return null;
  }
  function directText(node, path){
    let n = node;
    for(const p of path){ n = child(n, p); if(!n) return ''; }
    return (n.textContent || '').trim();
  }
  function nodes(doc, tag){
    const a = Array.from(doc.getElementsByTagName(tag));
    if(a.length) return a;
    return Array.from(doc.getElementsByTagNameNS('*', tag));
  }
  function icmsData(det){
    const icms = child(child(det, 'imposto'), 'ICMS');
    const grupo = icms ? Array.from(icms.children || [])[0] : null;
    return {
      grupo: grupo ? (grupo.localName || grupo.nodeName) : '',
      origem: getFirstText(grupo, 'orig'),
      cst: getFirstText(grupo, 'CST') || getFirstText(grupo, 'CSOSN'),
      vBC: parseNum(getFirstText(grupo, 'vBC')),
      pICMS: parseNum(getFirstText(grupo, 'pICMS')),
      vICMS: parseNum(getFirstText(grupo, 'vICMS')),
      vBCST: parseNum(getFirstText(grupo, 'vBCST')),
      vST: parseNum(getFirstText(grupo, 'vST')),
      vBCSTRet: parseNum(getFirstText(grupo, 'vBCSTRet')),
      vICMSSTRet: parseNum(getFirstText(grupo, 'vICMSSTRet')),
      pST: parseNum(getFirstText(grupo, 'pST'))
    };
  }
  function impostoGrupo(det, grupoNome, subPrefix){
    const imp = child(det, 'imposto');
    const g = child(imp, grupoNome);
    const sub = g ? Array.from(g.children || [])[0] : null;
    return {
      grupo: sub ? (sub.localName || sub.nodeName) : '',
      cst: getFirstText(sub, 'CST'),
      vBC: parseNum(getFirstText(sub, 'vBC')),
      p: parseNum(getFirstText(sub, subPrefix ? 'p' + subPrefix : 'p' + grupoNome)),
      v: parseNum(getFirstText(sub, subPrefix ? 'v' + subPrefix : 'v' + grupoNome))
    };
  }
  function parseNFeXML(text){
    const xml = new DOMParser().parseFromString(text, 'text/xml');
    const perr = xml.getElementsByTagName('parsererror')[0];
    if(perr) throw new Error('XML inválido: ' + perr.textContent.slice(0,120));
    const inf = nodes(xml, 'infNFe')[0];
    const ide = nodes(xml, 'ide')[0];
    const emit = nodes(xml, 'emit')[0];
    const dest = nodes(xml, 'dest')[0];
    const total = nodes(xml, 'ICMSTot')[0];
    const fat = nodes(xml, 'fat')[0];
    const prot = nodes(xml, 'infProt')[0];
    const chave = (getFirstText(prot, 'chNFe') || String(inf?.getAttribute('Id') || '').replace(/^NFe/, '')).trim();
    const emitEnd = child(emit, 'enderEmit');
    const destEnd = child(dest, 'enderDest');
    const fornecedor = {
      cnpj: getFirstText(emit, 'CNPJ') || getFirstText(emit, 'CPF'),
      nome: getFirstText(emit, 'xNome'),
      fantasia: getFirstText(emit, 'xFant'),
      ie: getFirstText(emit, 'IE'),
      crt: getFirstText(emit, 'CRT'),
      endereco: {
        logradouro: getFirstText(emitEnd, 'xLgr'), numero: getFirstText(emitEnd, 'nro'), complemento: getFirstText(emitEnd, 'xCpl'),
        bairro: getFirstText(emitEnd, 'xBairro'), municipio: getFirstText(emitEnd, 'xMun'), uf: getFirstText(emitEnd, 'UF'), cep: getFirstText(emitEnd, 'CEP'), telefone: getFirstText(emitEnd, 'fone')
      }
    };
    const destinatario = {
      cnpj: getFirstText(dest, 'CNPJ') || getFirstText(dest, 'CPF'), nome: getFirstText(dest, 'xNome'), ie: getFirstText(dest, 'IE'), email: getFirstText(dest, 'email'),
      endereco: { logradouro:getFirstText(destEnd,'xLgr'), numero:getFirstText(destEnd,'nro'), bairro:getFirstText(destEnd,'xBairro'), municipio:getFirstText(destEnd,'xMun'), uf:getFirstText(destEnd,'UF'), cep:getFirstText(destEnd,'CEP'), telefone:getFirstText(destEnd,'fone') }
    };
    const dets = nodes(xml, 'det');
    const itens = dets.map(det => {
      const prod = child(det, 'prod');
      const icms = icmsData(det);
      const ipi = impostoGrupo(det, 'IPI', 'IPI');
      const pis = impostoGrupo(det, 'PIS', 'PIS');
      const cofins = impostoGrupo(det, 'COFINS', 'COFINS');
      const q = parseNum(getFirstText(prod, 'qCom'));
      const vu = parseNum(getFirstText(prod, 'vUnCom'));
      const vp = parseNum(getFirstText(prod, 'vProd'));
      const vd = parseNum(getFirstText(prod, 'vDesc'));
      const vItem = parseNum(getFirstText(det, 'vItem')) || Math.max(vp - vd, 0);
      const _codProd = getFirstText(prod, 'cProd');
      const _xProd = getFirstText(prod, 'xProd');
      const _splitProd = dividirDescricaoProdutoNFePro(_xProd, _codProd);
      return {
        nItem: det.getAttribute('nItem') || '',
        codigoFornecedor: _splitProd.codigoFornecedor,
        codigoComercial: _splitProd.codigoComercial,
        codigo: _splitProd.codigoFornecedor,
        oem: _splitProd.oem,
        ean: getFirstText(prod, 'cEAN'),
        descricaoOriginal: _splitProd.descricaoOriginal,
        descricao: _splitProd.descricaoLimpa,
        marca: _splitProd.marca,
        ncm: getFirstText(prod, 'NCM'), cest: getFirstText(prod, 'CEST'), cfop: getFirstText(prod, 'CFOP'),
        unidade: getFirstText(prod, 'uCom') || getFirstText(prod, 'uTrib') || 'UN',
        quantidade: q, valorUnitario: vu, valorProduto: vp, desconto: vd, valorLiquido: vItem,
        eanTrib: getFirstText(prod, 'cEANTrib'), unidadeTrib: getFirstText(prod, 'uTrib'), quantidadeTrib: parseNum(getFirstText(prod,'qTrib')), valorUnitarioTrib: parseNum(getFirstText(prod,'vUnTrib')),
        icms, ipi, pis, cofins,
        ibsCbs: {
          vIBS: parseNum(getFirstText(det, 'vIBS')),
          vCBS: parseNum(getFirstText(det, 'vCBS')),
          vIBSCBS: parseNum(getFirstText(det, 'vIBSCBS')),
          cClassTrib: getFirstText(det, 'cClassTrib') || getFirstText(det, 'cClassTribIBSCBS')
        },
        infAdProd: getFirstText(det, 'infAdProd'),
        destino: 'estoque', vinculo: '', osId: '', placa: '', observacaoDestino: ''
      };
    });
    const duplicatas = nodes(xml, 'dup').map(d => ({ numero:getFirstText(d,'nDup'), vencimento:getFirstText(d,'dVenc'), valor:parseNum(getFirstText(d,'vDup')) }));
    const pagamentos = nodes(xml, 'detPag').map(p => ({ tipo:getFirstText(p,'tPag'), descricao:getFirstText(p,'xPag'), valor:parseNum(getFirstText(p,'vPag')), data:getFirstText(p,'dPag') }));
    const info = {
      chave, modelo:getFirstText(ide,'mod'), serie:getFirstText(ide,'serie'), numero:getFirstText(ide,'nNF'), natureza:getFirstText(ide,'natOp'),
      dataEmissao:(getFirstText(ide,'dhEmi') || '').slice(0,10), dataSaida:(getFirstText(ide,'dhSaiEnt') || '').slice(0,10), tipoNF:getFirstText(ide,'tpNF'), finalidade:getFirstText(ide,'finNFe'),
      protocolo:getFirstText(prot,'nProt'), statusAutorizacao:getFirstText(prot,'cStat'), motivoAutorizacao:getFirstText(prot,'xMotivo'), recebidoEm:getFirstText(prot,'dhRecbto'),
      fornecedor, destinatario, itens,
      totais: {
        vProd: parseNum(getFirstText(total,'vProd')), vDesc: parseNum(getFirstText(total,'vDesc')), vNF: parseNum(getFirstText(total,'vNF')),
        vFrete: parseNum(getFirstText(total,'vFrete')), vSeg: parseNum(getFirstText(total,'vSeg')), vOutro: parseNum(getFirstText(total,'vOutro')),
        vIPI: parseNum(getFirstText(total,'vIPI')), vPIS: parseNum(getFirstText(total,'vPIS')), vCOFINS: parseNum(getFirstText(total,'vCOFINS')),
        vBC: parseNum(getFirstText(total,'vBC')), vICMS: parseNum(getFirstText(total,'vICMS')), vBCST: parseNum(getFirstText(total,'vBCST')), vST: parseNum(getFirstText(total,'vST')), vTotTrib: parseNum(getFirstText(total,'vTotTrib')),
        vIBS: parseNum(getFirstText(total,'vIBS')), vCBS: parseNum(getFirstText(total,'vCBS')), vIBSCBS: parseNum(getFirstText(total,'vIBSCBS'))
      },
      cobranca: { numero:getFirstText(fat,'nFat'), valorOriginal:parseNum(getFirstText(fat,'vOrig')), desconto:parseNum(getFirstText(fat,'vDesc')), valorLiquido:parseNum(getFirstText(fat,'vLiq')), duplicatas },
      pagamentos, infAdFisco:getFirstText(xml,'infAdFisco'), infCpl:getFirstText(xml,'infCpl'), rawXml:text
    };
    return info;
  }
  function currentOSOptions(selectedOSId){
    const lista = (W.J?.os || []).filter(o => String(o.status || '').toLowerCase() !== 'cancelado').sort((a,b)=>String(b.updatedAt||b.createdAt||'').localeCompare(String(a.updatedAt||a.createdAt||'')));
    return lista.map(o => {
      const v = (W.J?.veiculos || []).find(x => x.id === o.veiculoId) || {};
      const c = (W.J?.clientes || []).find(x => x.id === o.clienteId) || {};
      const placa = (o.placa || v.placa || 'S/PLACA').toUpperCase();
      const veic = [v.marca, v.modelo || o.veiculo].filter(Boolean).join(' ') || 'Veículo';
      const data = brDate((o.data || o.createdAt || o.updatedAt || '').slice(0,10));
      const status = o.status || 'em atendimento';
      const label = `${placa} — ${veic} — ${c.nome || o.cliente || 'Cliente'} — O.S. #${String(o.id||'').slice(-6).toUpperCase()} — ${status}${data ? ' — ' + data : ''}`;
      return `<option value="${esc(o.id)}" data-placa="${esc(placa)}">${esc(label)}</option>`;
    }).join('');
  }
  function rowTemplate(item){
    const i = item || {};
    const options = currentOSOptions(i.osId || '');
    const destino = i.destino || 'estoque';
    return `
      <div class="nf-real-row" style="border:1px solid var(--border);border-radius:4px;padding:10px;background:rgba(0,0,0,.08);display:grid;gap:8px;">
        <div style="display:grid;grid-template-columns:120px 130px minmax(220px,2fr) 120px 80px 105px 105px 105px 105px 34px;gap:8px;align-items:end;" class="nf-real-grid-main">
          <div><label class="j-label">Código fornecedor</label><input class="j-input nf-codforn" value="${esc(i.codigoFornecedor||i.codigo||'')}"></div>
          <div><label class="j-label">Código/OEM</label><input class="j-input nf-codigo" value="${esc(i.codigoComercial||i.oem||'')}"></div>
          <div><label class="j-label">Descrição limpa da peça</label><input class="j-input nf-desc" value="${esc(i.descricao||'')}" title="Original XML: ${esc(i.descricaoOriginal||i.descricao||'')}" placeholder="Descrição da peça"></div>
          <div><label class="j-label">Marca</label><input class="j-input nf-marca" value="${esc(i.marca||'')}"></div>
          <div><label class="j-label">Qtd</label><input class="j-input nf-qtd" inputmode="decimal" value="${esc(fmtQtd(i.quantidade||1))}" oninput="window.calcNFTotal()"></div>
          <div><label class="j-label">Custo un.</label><input class="j-input nf-custo" inputmode="decimal" value="${esc(fmtBR(i.valorUnitario||0))}" oninput="window.calcNFTotal()"></div>
          <div><label class="j-label">Desc.</label><input class="j-input nf-descvalor" inputmode="decimal" value="${esc(fmtBR(i.desconto||0))}" oninput="window.calcNFTotal()"></div>
          <div><label class="j-label">Venda</label><input class="j-input nf-venda" inputmode="decimal" value="${esc(fmtBR(i.venda || ((Number(i.valorUnitario)||0)*1.5)))}"></div>
          <div><label class="j-label">EAN</label><input class="j-input nf-ean" value="${esc(i.ean||'')}"></div>
          <button type="button" title="Remover item" onclick="this.closest('.nf-real-row').remove();window.calcNFTotal()" style="background:rgba(255,59,59,0.1);border:1px solid rgba(255,59,59,0.3);border-radius:2px;color:var(--danger);cursor:pointer;height:32px;">✕</button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;align-items:end;" class="nf-real-grid-fiscal">
          <div><label class="j-label">NCM</label><input class="j-input nf-ncm-input" value="${esc(i.ncm||'')}"></div>
          <div><label class="j-label">CFOP</label><input class="j-input nf-cfop-input" value="${esc(i.cfop||'')}"></div>
          <div><label class="j-label">CEST</label><input class="j-input nf-cest-input" value="${esc(i.cest||'')}"></div>
          <div><label class="j-label">Total item XML</label><input class="j-input" value="R$ ${esc(fmtBR(i.valorLiquido || ((i.quantidade||1)*(i.valorUnitario||0)-(i.desconto||0))))}" readonly></div>
        </div>
        <div style="display:grid;grid-template-columns:170px minmax(220px,1fr) minmax(160px,1fr);gap:8px;align-items:end;" class="nf-real-grid-destino">
          <div><label class="j-label">Destino real da peça</label><select class="j-select nf-finalidade" onchange="window._nfeProToggleDestino(this)">
            <option value="estoque" ${destino==='estoque'?'selected':''}>Estoque</option>
            <option value="os" ${destino==='os'?'selected':''}>Vincular a O.S./veículo</option>
            <option value="placa" ${destino==='placa'?'selected':''}>Separar por placa</option>
            <option value="garantia" ${destino==='garantia'?'selected':''}>Garantia</option>
            <option value="devolucao" ${destino==='devolucao'?'selected':''}>Devolução</option>
            <option value="uso_interno" ${destino==='uso_interno'?'selected':''}>Uso interno</option>
            <option value="outro" ${destino==='outro'?'selected':''}>Outro</option>
          </select></div>
          <div class="nf-os-wrap" style="display:${destino==='os'?'block':'none'}"><label class="j-label">Selecionar O.S. em atendimento</label><select class="j-select nf-os-select"><option value="">Escolha pela placa / O.S. / cliente...</option>${options}</select></div>
          <div><label class="j-label">Placa/finalidade/observação</label><input class="j-input nf-vinculo" value="${esc(i.vinculo||'')}" placeholder="Ex.: ABC1234, garantia, uso interno..."></div>
        </div>
        <div style="font-family:var(--fm);font-size:.64rem;color:var(--muted);display:grid;grid-template-columns:repeat(4,1fr);gap:6px;" class="nf-real-tributos">
          <span>NCM: <b class="nf-ncm">${esc(i.ncm||'')}</b></span><span>CFOP: <b class="nf-cfop">${esc(i.cfop||'')}</b></span><span>CEST: <b class="nf-cest">${esc(i.cest||'')}</b></span><span>Total item: <b class="nf-total-item">R$ ${fmtBR(i.valorLiquido || ((i.quantidade||1)*(i.valorUnitario||0)-(i.desconto||0)))}</b></span>
        </div>
        <input type="hidden" class="nf-json" value="${esc(JSON.stringify(i))}">
      </div>`;
  }
  W._nfeProToggleDestino = function(sel){
    const row = sel.closest('.nf-real-row');
    const wrap = row?.querySelector('.nf-os-wrap');
    if(wrap) wrap.style.display = sel.value === 'os' ? 'block' : 'none';
  };
  function renderParcels(dups){
    let box = $('nfParcelasBox');
    if(!box){
      const div = D.createElement('div'); div.id='nfParcelasBox';
      div.style.cssText='margin-top:10px;border:1px solid var(--border);background:rgba(0,0,0,.08);border-radius:4px;padding:10px;display:none;';
      const anchor = $('divParcelasNF')?.parentElement || $('nfPgtoForma')?.closest('.form-row') || $('containerItensNF')?.parentElement;
      anchor?.insertAdjacentElement('afterend', div); box = div;
    }
    const arr = Array.isArray(dups) ? dups : [];
    if(!arr.length){ box.style.display='none'; box.innerHTML=''; return; }
    box.style.display='block';
    box.innerHTML = `<div style="font-family:var(--fd);font-weight:800;margin-bottom:8px;color:var(--accent)">DUPLICATAS / BOLETOS DA NF</div>` + arr.map((d,idx)=>`
      <div class="nf-parcela-row" style="display:grid;grid-template-columns:80px 1fr 1fr;gap:8px;margin-bottom:6px;align-items:end;">
        <div><label class="j-label">Parc.</label><input class="j-input nf-parc-num" value="${esc(d.numero || String(idx+1).padStart(3,'0'))}"></div>
        <div><label class="j-label">Vencimento</label><input type="date" class="j-input nf-parc-venc" value="${esc(d.vencimento || '')}"></div>
        <div><label class="j-label">Valor</label><input class="j-input nf-parc-valor" inputmode="decimal" value="${esc(fmtBR(d.valor||0))}"></div>
      </div>`).join('');
  }
  function gerarParcelasManuais(){
    const forma = getVal('nfPgtoForma');
    if(!['Boleto','Parcelado'].includes(forma)){ renderParcels([]); return; }
    const n = parseInt(getVal('nfParcelas') || '1',10) || 1;
    const base = getVal('nfVenc') || isoToday();
    const total = calcTotalNumber();
    const dups = [];
    const baseDate = new Date(base + 'T12:00:00');
    for(let i=0;i<n;i++){
      const d = new Date(baseDate); d.setMonth(d.getMonth()+i);
      const iso = d.toISOString().slice(0,10);
      dups.push({ numero:String(i+1).padStart(3,'0'), vencimento:iso, valor: Math.round((total/n)*100)/100 });
    }
    renderParcels(dups);
  }
  function calcTotalNumber(){
    let total = 0;
    D.querySelectorAll('#containerItensNF .nf-real-row').forEach(row=>{
      const q = parseNum(row.querySelector('.nf-qtd')?.value);
      const custo = parseNum(row.querySelector('.nf-custo')?.value);
      const desc = parseNum(row.querySelector('.nf-descvalor')?.value);
      const itemTotal = Math.max(q*custo - desc, 0);
      total += itemTotal;
      const totalEl = row.querySelector('.nf-total-item'); if(totalEl) totalEl.textContent = 'R$ ' + fmtBR(itemTotal);
    });
    return Math.round(total*100)/100;
  }
  W.calcNFTotal = function(){
    const total = calcTotalNumber();
    const el = $('nfTotal'); if(el) el.textContent = fmtBR(total);
    const current = W._nfeProData;
    if(current && current.totais && current.totais.vNF && Math.abs(total - current.totais.vNF) > 0.02){
      if(el) el.title = `Atenção: total dos itens (${fmtBR(total)}) difere do total fiscal da NF (${fmtBR(current.totais.vNF)}).`;
    }
    if($('nfParcelasBox')?.style.display === 'block' && !(W._nfeProData?.cobranca?.duplicatas || []).length) gerarParcelasManuais();
  };
  W.checkPgtoNF = function(){
    const forma = getVal('nfPgtoForma');
    if($('divParcelasNF')) $('divParcelasNF').style.display = ['Parcelado','Boleto'].includes(forma) ? 'block' : 'none';
    if(['Parcelado','Boleto'].includes(forma)) gerarParcelasManuais(); else renderParcels([]);
  };
  function preencherFornecedorTemporario(fornec){
    if(!$('nfFornec') || !fornec) return;
    const cnpj = onlyDigits(fornec.cnpj);
    let existente = (W.J?.fornecedores || []).find(f => onlyDigits(f.cnpj || f.doc || f.documento) === cnpj || String(f.nome||'').toLowerCase() === String(fornec.nome||'').toLowerCase());
    if(existente){ $('nfFornec').value = existente.id; return; }
    const tempId = '__xml__' + cnpj;
    if(!$('nfFornec').querySelector(`option[value="${tempId}"]`)){
      const opt = D.createElement('option'); opt.value = tempId; opt.textContent = `${fornec.nome || 'Fornecedor XML'} — ${cnpj || 'sem CNPJ'} (novo)`; opt.dataset.xmlFornecedor = JSON.stringify(fornec);
      $('nfFornec').appendChild(opt);
    }
    $('nfFornec').value = tempId;
  }
  function renderFiscalResumo(nfe){
    let box = $('nfFiscalResumo');
    if(!box){
      box = D.createElement('div'); box.id='nfFiscalResumo';
      box.style.cssText='border:1px solid var(--border);background:rgba(0,255,170,.035);border-radius:4px;padding:10px;margin:10px 0;font-family:var(--fm);font-size:.72rem;line-height:1.55;';
      $('containerItensNF')?.parentElement?.insertAdjacentElement('beforebegin', box);
    }
    if(!nfe){ box.innerHTML=''; box.style.display='none'; return; }
    box.style.display='block';
    box.innerHTML = `<b style="color:var(--accent)">ESPELHO FISCAL DA NF-E</b><br>
      Chave: <b>${esc(nfe.chave)}</b> · NF: <b>${esc(nfe.numero)}</b> / Série <b>${esc(nfe.serie)}</b> · Emissão: <b>${brDate(nfe.dataEmissao)}</b><br>
      Fornecedor: <b>${esc(nfe.fornecedor.nome)}</b> · CNPJ: <b>${esc(nfe.fornecedor.cnpj)}</b> · IE: <b>${esc(nfe.fornecedor.ie)}</b><br>
      Natureza: <b>${esc(nfe.natureza)}</b> · Protocolo: <b>${esc(nfe.protocolo)}</b> · Status: <b>${esc(nfe.statusAutorizacao)} ${esc(nfe.motivoAutorizacao)}</b><br>
      Produtos: <b>R$ ${fmtBR(nfe.totais.vProd)}</b> · Desc.: <b>R$ ${fmtBR(nfe.totais.vDesc)}</b> · IPI: <b>R$ ${fmtBR(nfe.totais.vIPI)}</b> · Total NF: <b>R$ ${fmtBR(nfe.totais.vNF)}</b>`;
  }
  W.prepNF = function(){
    W._nfeProData = null;
    setVal('nfNumero',''); setVal('nfData', isoToday()); setVal('nfVenc','');
    if($('containerItensNF')) $('containerItensNF').innerHTML = '';
    if($('nfTotal')) $('nfTotal').textContent = '0,00';
    if($('nfPgtoForma')) $('nfPgtoForma').value = 'Dinheiro';
    if($('nfParcelas')) { if(!$('nfParcelas').querySelector('option[value="1"]')) $('nfParcelas').insertAdjacentHTML('afterbegin','<option value="1">1x</option>'); $('nfParcelas').value='1'; $('nfParcelas').onchange = gerarParcelasManuais; }
    if($('nfVenc')) $('nfVenc').onchange = gerarParcelasManuais;
    if(typeof W.popularSelects === 'function') W.popularSelects();
    renderFiscalResumo(null); renderParcels([]); W.adicionarItemNF(); W.checkPgtoNF();
  };
  W.lerXMLNFe = function(event){
    const file = event?.target?.files?.[0]; if(!file) return;
    const r = new FileReader();
    r.onload = function(ev){
      try{
        const nfe = parseNFeXML(String(ev.target.result || ''));
        W._nfeProData = nfe;
        setVal('nfNumero', nfe.numero); setVal('nfData', nfe.dataEmissao || isoToday());
        preencherFornecedorTemporario(nfe.fornecedor);
        if($('containerItensNF')) $('containerItensNF').innerHTML = nfe.itens.map(rowTemplate).join('');
        renderFiscalResumo(nfe);
        if(nfe.cobranca.duplicatas.length){
          if($('nfPgtoForma')) $('nfPgtoForma').value = 'Boleto';
          if($('nfParcelas')) { if(!$('nfParcelas').querySelector(`option[value="${nfe.cobranca.duplicatas.length}"]`)) $('nfParcelas').insertAdjacentHTML('beforeend', `<option value="${nfe.cobranca.duplicatas.length}">${nfe.cobranca.duplicatas.length}x</option>`); $('nfParcelas').value = String(nfe.cobranca.duplicatas.length); }
          setVal('nfVenc', nfe.cobranca.duplicatas[0].vencimento || '');
          renderParcels(nfe.cobranca.duplicatas);
        } else {
          if($('nfPgtoForma')) $('nfPgtoForma').value = 'Dinheiro';
          renderParcels([]);
        }
        W.checkPgtoNF();
        W.calcNFTotal();
        const msg = `✓ XML importado: NF ${nfe.numero} — ${nfe.itens.length} item(ns) — Total R$ ${fmtBR(nfe.totais.vNF || calcTotalNumber())}`;
        if(typeof W.toast === 'function') W.toast(msg); else alert(msg);
        if(typeof W.audit === 'function') W.audit('ESTOQUE/NF', `Importou XML NFe ${nfe.numero} (${nfe.chave}) de ${nfe.fornecedor.nome}`);
      }catch(e){ console.error('[NFe PRO] Falha XML:', e); if(typeof W.toast==='function') W.toast('✕ XML inválido ou não reconhecido: '+e.message,'err'); else alert(e.message); }
      if($('xmlInputFile')) $('xmlInputFile').value='';
    };
    r.readAsText(file);
  };
  W.adicionarItemNF = function(item){
    if($('containerItensNF')) $('containerItensNF').insertAdjacentHTML('beforeend', rowTemplate(item || {descricao:'', quantidade:1, valorUnitario:0, desconto:0, venda:0, codigo:'', ean:'', ncm:'', cfop:'', cest:'', destino:'estoque'}));
    W.calcNFTotal();
  };
  function collectItens(){
    return Array.from(D.querySelectorAll('#containerItensNF .nf-real-row')).map(row => {
      let base = {};
      try{ base = JSON.parse(row.querySelector('.nf-json')?.value || '{}'); }catch(_){ base = {}; }
      const osSel = row.querySelector('.nf-os-select');
      const osId = osSel?.value || '';
      const osOpt = osSel?.selectedOptions?.[0];
      return Object.assign({}, base, {
        codigoFornecedor: row.querySelector('.nf-codforn')?.value || base.codigoFornecedor || base.codigo || '',
        codigoComercial: row.querySelector('.nf-codigo')?.value || base.codigoComercial || base.oem || '',
        descricao: row.querySelector('.nf-desc')?.value || base.descricao || '',
        descricaoOriginal: base.descricaoOriginal || row.querySelector('.nf-desc')?.getAttribute('title') || '',
        desc: row.querySelector('.nf-desc')?.value || base.descricao || '',
        marca: row.querySelector('.nf-marca')?.value || base.marca || '',
        quantidade: parseNum(row.querySelector('.nf-qtd')?.value), qtd: parseNum(row.querySelector('.nf-qtd')?.value),
        valorUnitario: parseNum(row.querySelector('.nf-custo')?.value), custo: parseNum(row.querySelector('.nf-custo')?.value),
        desconto: parseNum(row.querySelector('.nf-descvalor')?.value),
        venda: parseNum(row.querySelector('.nf-venda')?.value),
        codigo: row.querySelector('.nf-codforn')?.value || base.codigo || '',
        oem: row.querySelector('.nf-codigo')?.value || base.oem || '',
        ean: row.querySelector('.nf-ean')?.value || base.ean || '',
        ncm: row.querySelector('.nf-ncm-input')?.value || base.ncm || '',
        cfop: row.querySelector('.nf-cfop-input')?.value || base.cfop || '',
        cest: row.querySelector('.nf-cest-input')?.value || base.cest || '',
        destino: row.querySelector('.nf-finalidade')?.value || 'estoque', finalidade: row.querySelector('.nf-finalidade')?.value || 'estoque',
        osId, placa: osOpt?.dataset?.placa || '', vinculo: row.querySelector('.nf-vinculo')?.value || osId || '',
        valorLiquido: Math.max(parseNum(row.querySelector('.nf-qtd')?.value) * parseNum(row.querySelector('.nf-custo')?.value) - parseNum(row.querySelector('.nf-descvalor')?.value), 0)
      });
    }).filter(x => x.descricao);
  }
  function collectParcelas(){
    return Array.from(D.querySelectorAll('#nfParcelasBox .nf-parcela-row')).map(r => ({
      numero: r.querySelector('.nf-parc-num')?.value || '', vencimento: r.querySelector('.nf-parc-venc')?.value || '', valor: parseNum(r.querySelector('.nf-parc-valor')?.value)
    })).filter(p => p.valor > 0 || p.vencimento);
  }
  function normalizePlateNF(v){
    return String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }
  function normalizeTextNF(v){
    return String(v || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function firebaseFieldValueNF(){
    try {
      return W.firebase?.firestore?.FieldValue || firebase?.firestore?.FieldValue || null;
    } catch (_) {
      return null;
    }
  }
  function cleanFirestoreNF(value){
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (Array.isArray(value)) return value.map(cleanFirestoreNF).filter(v => v !== undefined);
    if (value && typeof value === 'object') {
      const ctor = String(value.constructor?.name || '');
      if (value._methodName || value._delegate?._methodName || value._toFieldTransform || /FieldValue|ArrayUnion|ArrayRemove/i.test(ctor)) return value;
      const out = {};
      Object.entries(value).forEach(([k, v]) => {
        const cleaned = cleanFirestoreNF(v);
        if (cleaned !== undefined) out[k] = cleaned;
      });
      return out;
    }
    return value;
  }
  function fornecedorNomeNF(nfe, fornecedorId){
    const local = (W.J?.fornecedores || []).find(f => f.id === fornecedorId) || null;
    const optText = $('nfFornec')?.selectedOptions?.[0]?.textContent || '';
    const optClean = optText.replace(/\s+[-—].*$/g, '').replace(/\s+\(novo\)$/i, '').trim();
    return nfe?.fornecedor?.nome || local?.nome || local?.razao || optClean || 'Fornecedor';
  }
  function placaDaOSNF(os){
    const v = (W.J?.veiculos || []).find(x => x.id === (os?.veiculoId || os?.veiculo)) || {};
    return normalizePlateNF(os?.placa || v.placa || '');
  }
  function textoBuscaOSNF(os){
    const v = (W.J?.veiculos || []).find(x => x.id === (os?.veiculoId || os?.veiculo)) || {};
    const c = (W.J?.clientes || []).find(x => x.id === (os?.clienteId || v.clienteId)) || {};
    return [
      os?.id, os?.numero, os?.placa, v.placa, os?.veiculo, v.modelo, v.marca, v.nome,
      c.nome, c.razao, os?.cliente, os?.status, os?.etapa, os?.data
    ].filter(Boolean).join(' ');
  }
  function ordenarOSDestinoNF(a, b){
    const peso = os => /cancel|entreg|recus|finaliz/.test(normalizeTextNF(os?.status || '')) ? 1 : 0;
    const data = os => Date.parse(os?.updatedAt || os?.createdAt || (os?.data ? os.data + 'T12:00:00' : '')) || 0;
    return (peso(a) - peso(b)) || (data(b) - data(a));
  }
  async function carregarOSNF(osId){
    if (!osId) return null;
    const local = (W.J?.os || []).find(o => String(o.id) === String(osId)) || null;
    if (W.db) {
      try {
        const snap = await W.db.collection('ordens_servico').doc(osId).get();
        if (snap.exists) return Object.assign({ id: snap.id }, snap.data() || {});
      } catch (_) {}
    }
    return local;
  }
  async function resolverOSDestinoNF(item){
    if (item.osId) return carregarOSNF(item.osId);
    const lista = (W.J?.os || []).slice();
    const placa = normalizePlateNF(item.placa || item.vinculo || '');
    if (placa) {
      const porPlaca = lista
        .filter(o => {
          const p = placaDaOSNF(o);
          return p && (p === placa || p.includes(placa) || placa.includes(p));
        })
        .sort(ordenarOSDestinoNF);
      if (porPlaca[0]?.id) return carregarOSNF(porPlaca[0].id);
    }
    const termo = normalizeTextNF(item.vinculo || item.osId || '');
    if (termo) {
      const porTexto = lista
        .filter(o => normalizeTextNF(textoBuscaOSNF(o)).includes(termo))
        .sort(ordenarOSDestinoNF);
      if (porTexto[0]?.id) return carregarOSNF(porTexto[0].id);
    }
    return null;
  }
  function pecaRealFromNF(item, os, nfRef, nfPayload, fornecedorId, fornecedorNome){
    const numeroItem = item.numeroItem || item.nItem || item.item || '';
    const codigoFornecedor = item.codigoFornecedor || item.codigo || '';
    const codigoComercial = item.codigoComercial || item.oem || '';
    const desc = item.descricao || item.desc || '';
    const key = [nfRef.id, numeroItem, codigoFornecedor, codigoComercial, desc].join('|');
    return cleanFirestoreNF({
      origem: 'nf_entrada',
      origemNFItemKey: key,
      statusAplicacao: 'comprada_vinculada_nf',
      codigo: codigoComercial || codigoFornecedor,
      codigoFornecedor,
      codigoComercial,
      oem: codigoComercial,
      desc,
      descricao: desc,
      marca: item.marca || '',
      qtd: Number(item.quantidade || item.qtd || 1) || 1,
      unidade: item.unidade || 'UN',
      fornecedor: fornecedorNome,
      fornecedorId,
      nf: nfPayload.numero || '',
      nfNumero: nfPayload.numero || '',
      nfId: nfRef.id,
      chaveNFe: nfPayload.chave || '',
      numeroItem,
      dataCompra: nfPayload.dataNF || isoToday(),
      dataNF: nfPayload.dataNF || isoToday(),
      valorCompra: Number(item.valorUnitario || item.custo || 0) || 0,
      totalCompra: Number(item.valorLiquido || 0) || 0,
      descontoCompra: Number(item.desconto || 0) || 0,
      ncm: item.ncm || '',
      cest: item.cest || '',
      cfop: item.cfop || '',
      ean: item.ean || '',
      osId: os?.id || item.osId || '',
      placa: normalizePlateNF(item.placa || placaDaOSNF(os)),
      registradoEm: new Date().toISOString(),
      registradoPor: W.J?.nome || 'Sistema',
      observacao: 'Vinculada automaticamente na entrada fiscal. Nao indica instalacao ou execucao.'
    });
  }
  function mergePecasReaisNF(atuais, novas){
    const out = Array.isArray(atuais) ? atuais.slice() : [];
    const keyOf = p => p?.origemNFItemKey || [p?.nfId || p?.chaveNFe || p?.nf || '', p?.numeroItem || '', p?.codigoFornecedor || p?.codigo || '', p?.desc || p?.descricao || ''].join('|');
    const pos = new Map();
    out.forEach((p, idx) => { const k = keyOf(p); if (k) pos.set(k, idx); });
    novas.forEach(p => {
      const k = keyOf(p);
      if (k && pos.has(k)) {
        const idx = pos.get(k);
        out[idx] = Object.assign({}, out[idx], p, { registradoEm: out[idx].registradoEm || p.registradoEm });
      } else {
        if (k) pos.set(k, out.length);
        out.push(p);
      }
    });
    return out;
  }
  async function registrarPecasReaisOSNF(batch, itens, nfRef, nfPayload, fornecedorId, fornecedorNome){
    const porOS = new Map();
    for (const item of itens) {
      const destino = String(item.destino || item.finalidade || '').toLowerCase();
      const placaVinculo = normalizePlateNF(item.placa || item.vinculo || '');
      const vinculoPareceOS = /\bos\b|o\.s\.|ordem/i.test(String(item.vinculo || ''));
      const vinculoParecePlaca = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(placaVinculo);
      if (!item.osId && destino !== 'os' && destino !== 'placa' && !vinculoPareceOS && !vinculoParecePlaca) continue;
      const os = await resolverOSDestinoNF(item);
      if (!os?.id) continue;
      item.osId = os.id;
      item.placa = item.placa || placaDaOSNF(os);
      const entry = porOS.get(os.id) || { os, pecas: [] };
      entry.pecas.push(pecaRealFromNF(item, os, nfRef, nfPayload, fornecedorId, fornecedorNome));
      porOS.set(os.id, entry);
    }
    const fv = firebaseFieldValueNF();
    let totalPecas = 0;
    const registrosAuxiliares = [];
    for (const [osId, entry] of porOS.entries()) {
      const pecas = entry.pecas.filter(Boolean);
      if (!pecas.length) continue;
      totalPecas += pecas.length;
      const acao = `Peca real vinculada por NF ${nfPayload.numero || 's/n'}: ${pecas.map(p => p.desc || p.codigo).filter(Boolean).join(', ')}`;
      const evento = cleanFirestoreNF({
        dt: new Date().toISOString(),
        user: W.J?.nome || 'Sistema',
        acao,
        tipo: 'nf_peca_real',
        interno: true,
        nfId: nfRef.id,
        nfNumero: nfPayload.numero || ''
      });
      const osUpdate = {
        updatedAt: new Date().toISOString(),
        ultimaEntradaNFVinculada: nfPayload.numero || nfRef.id
      };
      if (fv?.arrayUnion) {
        osUpdate.pecasReais = fv.arrayUnion(...pecas);
        osUpdate.timeline = fv.arrayUnion(evento);
      } else {
        osUpdate.pecasReais = mergePecasReaisNF(entry.os.pecasReais, pecas);
        osUpdate.timeline = (Array.isArray(entry.os.timeline) ? entry.os.timeline.slice() : []).concat(evento);
      }
      batch.set(W.db.collection('ordens_servico').doc(osId), cleanFirestoreNF(osUpdate), { merge: true });
      registrosAuxiliares.push({ osId, acao, nfId: nfRef.id, nfNumero: nfPayload.numero || '', pecas });
      const localOS = (W.J?.os || []).find(o => String(o.id) === String(osId));
      if (localOS) {
        localOS.pecasReais = mergePecasReaisNF(localOS.pecasReais, pecas);
        localOS.timeline = (Array.isArray(localOS.timeline) ? localOS.timeline.slice() : []).concat(evento);
        localOS.ultimaEntradaNFVinculada = nfPayload.numero || nfRef.id;
        localOS.updatedAt = osUpdate.updatedAt;
      }
      if ($('osId')?.value === osId && $('containerPecasReais') && W._pecasReaisDesbloqueadas === true && typeof W.adicionarPecaRealRow === 'function') {
        const chavesAtuais = new Set(Array.from(D.querySelectorAll('#containerPecasReais .pr-meta')).map(el => {
          try { return JSON.parse(el.value || '{}')?.origemNFItemKey || ''; } catch (_) { return ''; }
        }).filter(Boolean));
        pecas.forEach(p => {
          if (!p.origemNFItemKey || !chavesAtuais.has(p.origemNFItemKey)) W.adicionarPecaRealRow(p);
        });
      }
    }
    return { os: porOS.size, pecas: totalPecas, registrosAuxiliares };
  }
  async function salvarRegistrosAuxiliaresNF(vinculosOS){
    const registros = Array.isArray(vinculosOS?.registrosAuxiliares) ? vinculosOS.registrosAuxiliares : [];
    for (const reg of registros) {
      const notificacao = cleanFirestoreNF({
        tenantId: W.J?.tid,
        tipo: 'peca_nf_vinculada',
        titulo: 'Peca de NF vinculada a O.S.',
        mensagem: reg.acao,
        destinoPerfil: 'admin',
        entidade: 'ordens_servico',
        entidadeId: reg.osId,
        prioridade: 'normal',
        acaoSugerida: 'Conferir aba secreta Pecas Reais',
        lida: false,
        ts: Date.now(),
        createdAt: new Date().toISOString()
      });
      try {
        if (typeof W.thiaNotify === 'function') await W.thiaNotify(notificacao);
        else if (W.db) await W.db.collection('notificacoes_live').add(notificacao);
      } catch (_) {}
      try {
        if (typeof W.thiaAudit === 'function') {
          await W.thiaAudit('vinculo_nf_peca_real_os', 'ordens_servico', reg.osId, null, { nfId: reg.nfId, nfNumero: reg.nfNumero, pecas: reg.pecas }, 'Vinculo automatico na entrada fiscal');
        } else if (W.db) {
          await W.db.collection('lixeira_auditoria').add(cleanFirestoreNF({
            tenantId: W.J?.tid,
            usuario: W.J?.nome || 'Sistema',
            perfil: W.J?.role || '',
            acao: 'vinculo_nf_peca_real_os',
            entidade: 'ordens_servico',
            entidadeId: reg.osId,
            antes: null,
            depois: { nfId: reg.nfId, nfNumero: reg.nfNumero, pecas: reg.pecas },
            motivo: 'Vinculo automatico na entrada fiscal',
            ts: Date.now(),
            createdAt: new Date().toISOString()
          }));
        }
      } catch (_) {}
    }
  }
  async function ensureFornecedor(batch, nfe){
    const sel = getVal('nfFornec');
    if(!sel || !sel.startsWith('__xml__')) return sel;
    const fornec = nfe?.fornecedor || {};
    const ref = W.db.collection('fornecedores').doc();
    batch.set(ref, { tenantId:W.J?.tid, nome:fornec.nome || 'Fornecedor XML', fantasia:fornec.fantasia || '', cnpj:fornec.cnpj || '', ie:fornec.ie || '', telefone:fornec.endereco?.telefone || '', cep:fornec.endereco?.cep || '', endereco:fornec.endereco || {}, origem:'xml_nfe', createdAt:new Date().toISOString() });
    return ref.id;
  }
  W.salvarNF = async function(){
    const itens = collectItens();
    if(!itens.length){ if(W.toast) W.toast('⚠ Adicione ao menos um item','warn'); return; }
    if(!W.db || !W.J?.tid){ alert('Banco de dados ainda não carregado.'); return; }
    const nfe = W._nfeProData || null;
    const batch = W.db.batch();
    const fornecedorId = await ensureFornecedor(batch, nfe);
    if(nfe?.chave){
      const dupSnap = await W.db.collection('notas_fiscais_entrada')
        .where('tenantId','==',W.J.tid)
        .where('chave','==',nfe.chave)
        .limit(1)
        .get();
      if(!dupSnap.empty){
        const msg = `NF-e ${nfe.numero || ''} ja importada pela chave ${nfe.chave}. Operacao bloqueada para evitar duplicidade fiscal/financeira.`;
        if(W.toast) W.toast(msg,'warn'); else alert(msg);
        return;
      }
    }
    const totalItens = Math.round(itens.reduce((s,i)=>s+(Number(i.valorLiquido)||0),0)*100)/100;
    const totalNF = nfe?.totais?.vNF || totalItens;
    const nfRef = W.db.collection('notas_fiscais_entrada').doc();
    const nfPayload = {
      tenantId: W.J.tid, tipo:'entrada', origem:nfe?'xml_nfe':'manual', fornecedorId,
      numero: getVal('nfNumero') || nfe?.numero || '', serie:nfe?.serie || '', chave:nfe?.chave || '', natureza:nfe?.natureza || '',
      dataNF: getVal('nfData') || nfe?.dataEmissao || isoToday(), totalNF, totalItens,
      totaisFiscais: nfe?.totais || { vNF:totalNF }, cobranca: nfe?.cobranca || {}, pagamentos:nfe?.pagamentos || [], fornecedorSnapshot:nfe?.fornecedor || null,
      itens, rawXml:nfe?.rawXml || '', createdAt:new Date().toISOString(), updatedAt:new Date().toISOString()
    };
    const fornecedorNome = fornecedorNomeNF(nfe, fornecedorId);
    const vinculosOS = await registrarPecasReaisOSNF(batch, itens, nfRef, nfPayload, fornecedorId, fornecedorNome);
    batch.set(nfRef, nfPayload);
    for(const item of itens){
      const existente = (W.J?.estoque || []).find(p => String(p.codigo||p.oem||'').toLowerCase() === String(item.codigo||'').toLowerCase() && item.codigo) || (W.J?.estoque || []).find(p => String(p.desc||'').toLowerCase() === String(item.descricao||'').toLowerCase());
      const estoquePayload = { tenantId:W.J.tid, desc:item.descricao, codigo:item.codigoFornecedor||item.codigo||'', codigoFornecedor:item.codigoFornecedor||item.codigo||'', codigoComercial:item.codigoComercial||item.oem||'', oem:item.oem||item.codigoComercial||item.codigo||'', marca:item.marca||'', ean:item.ean||'', ncm:item.ncm||'', cest:item.cest||'', cfop:item.cfop||'', und:item.unidade||'UN', custo:item.valorUnitario, venda:item.venda || item.valorUnitario, fornecedorId, ultimaNF:nfPayload.numero, updatedAt:new Date().toISOString() };
      if(existente) batch.update(W.db.collection('estoqueItems').doc(existente.id), Object.assign({}, estoquePayload, { qtd:(Number(existente.qtd)||0)+(Number(item.quantidade)||0) }));
      else batch.set(W.db.collection('estoqueItems').doc(), Object.assign({}, estoquePayload, { qtd:Number(item.quantidade)||0, min:1, createdAt:new Date().toISOString() }));
      batch.set(W.db.collection('nf_itens_vinculos').doc(), { tenantId:W.J.tid, nfId:nfRef.id, nfNumero:nfPayload.numero, chave:nfPayload.chave, fornecedorId, codigo:item.codigo||'', ean:item.ean||'', desc:item.descricao, qtd:item.quantidade, custo:item.valorUnitario, desconto:item.desconto, total:item.valorLiquido, ncm:item.ncm||'', cest:item.cest||'', cfop:item.cfop||'', finalidade:item.destino||item.finalidade||'estoque', vinculo:item.vinculo||'', osId:item.osId||'', placa:item.placa||'', createdAt:new Date().toISOString() });
    }
    const parcelas = collectParcelas();
    const forma = getVal('nfPgtoForma') || 'Dinheiro';
    if(parcelas.length){
      for(const [idx,p] of parcelas.entries()){
        batch.set(W.db.collection('financeiro').doc(), { tenantId:W.J.tid, tipo:'Saída', status:['Dinheiro','PIX'].includes(forma)?'Pago':'Pendente', desc:`NF ${nfPayload.numero || 's/n'} — ${nfe?.fornecedor?.nome || 'Fornecedor'} (${idx+1}/${parcelas.length})`, valor:p.valor, pgto:forma, venc:p.vencimento || isoToday(), notaFiscalId:nfRef.id, chaveNFe:nfPayload.chave, fornecedorId, createdAt:new Date().toISOString() });
      }
    } else {
      batch.set(W.db.collection('financeiro').doc(), { tenantId:W.J.tid, tipo:'Saída', status:['Dinheiro','PIX'].includes(forma)?'Pago':'Pendente', desc:`NF ${nfPayload.numero || 's/n'} — ${nfe?.fornecedor?.nome || 'Fornecedor'}`, valor:totalNF, pgto:forma, venc:getVal('nfVenc') || isoToday(), notaFiscalId:nfRef.id, chaveNFe:nfPayload.chave, fornecedorId, createdAt:new Date().toISOString() });
    }
    await batch.commit();
    await salvarRegistrosAuxiliaresNF(vinculosOS);
    if(W.toast) W.toast(`✓ NF ${nfPayload.numero || 's/n'} lançada com espelho fiscal, estoque e financeiro${vinculosOS.pecas ? `; ${vinculosOS.pecas} peça(s) vinculada(s) em ${vinculosOS.os} O.S.` : ''}`); else alert('NF lançada.');
    if(typeof W.audit === 'function') W.audit('ESTOQUE/NF', `Entrada NF ${nfPayload.numero || 's/n'} — ${fmtBR(totalNF)} — ${itens.length} item(ns)`);
    if(typeof W.fecharModal === 'function') W.fecharModal('modalNF');
  };
  W.buscarCepAutoPro = async function(cep, prefix){
    const c = onlyDigits(cep); if(c.length !== 8) return null;
    const resp = await fetch(`https://viacep.com.br/ws/${c}/json/`); const data = await resp.json(); if(data.erro) return null;
    const map = { rua:data.logradouro||'', bairro:data.bairro||'', cidade:data.localidade||'', uf:data.uf||'', complemento:data.complemento||'' };
    Object.entries(map).forEach(([k,v]) => { const el = $(prefix + k.charAt(0).toUpperCase()+k.slice(1)) || $(prefix + k); if(el && !el.value) el.value = v; });
    return data;
  };
  D.addEventListener('change', function(e){ if(e.target && e.target.id === 'nfParcelas') gerarParcelasManuais(); });
  D.addEventListener('DOMContentLoaded', function(){
    const st = D.createElement('style');
    st.textContent = `@media(max-width:900px){.nf-real-grid-main,.nf-real-grid-fiscal,.nf-real-grid-destino,.nf-real-tributos{grid-template-columns:1fr!important}.nf-real-row input,.nf-real-row select{min-width:0!important}}`;
    D.head.appendChild(st);
  });
})();
