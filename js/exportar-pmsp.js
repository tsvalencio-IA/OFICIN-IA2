(function() {
  'use strict';

  const TEMPLATE_URL = 'assets/templates/I-30003_PLANILHA_DE_CUSTOS.xlsx';
  const SERV_START = 19;
  const SERV_END = 74;
  const SERV_TOTAL = 75;
  const PECA_START = 77;
  const PECA_END = 122;
  const PECA_TOTAL = 123;
  const SERV_CAPACITY = SERV_END - SERV_START + 1;
  const PECA_CAPACITY = PECA_END - PECA_START + 1;

  const U = () => window.JarvisOSUtils || window.JOS || {};
  const n = value => U().parseNumberBR ? U().parseNumberBR(value) : (parseFloat(String(value || 0).replace(',', '.')) || 0);

  function moedaNumber(value) {
    return +n(value).toFixed(2);
  }

  function taxaDesconto(value) {
    const pct = n(value);
    if (!pct) return 0;
    return pct > 1 ? +(pct / 100).toFixed(6) : pct;
  }

  function normalizarSecao(txt) {
    return String(txt || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  function classificarSecao(serv) {
    const base = limparTexto(serv.sistema || serv.secaoHoraLabel || serv.sistemaTabela || '');
    const sistema = normalizarSecao(base);
    const desc = normalizarSecao(serv.desc || '');
    const t = normalizarSecao([serv.sistema, serv.secaoHoraLabel, serv.sistemaTabela, serv.desc].filter(Boolean).join(' '));

    const isFunilaria = /\b(funilaria|lanternagem|pintura|pintar|lataria|parachoque|para choque|porta|capo|capuz|teto|assoalho|coluna|paralama|para lama)\b/;
    const isTapecaria = /\b(tapecaria|capotaria|banco|assento|encosto|forro|estof)\b/;
    const isBorracharia = /\b(borracharia|pneu|pneus|roda|rodas|calota|balanceamento)\b/;
    const isLavagem = /\b(lavagem|higienizacao|higienizar|limpeza interna|polimento)\b/;
    const isInjecao = /\b(injecao|injetor|injetores|bico|bicos|combustivel|alimentacao|bomba de combustivel|tanque)\b/;
    const isMecanica = /\b(mecanica|motor|cambio|embreagem|transmissao|arrefecimento|radiador|suspensao|amortecedor|amortecedores|mola|molas|bandeja|pivo|terminal|bieleta|coifa|homocinetica|semieixo|semi eixo|semi-eixo|freio|pastilha|pastilhas|disco|tambor|direcao|retifica|rolamento)\b/;
    const isEletrica = /\b(eletrica|eletrico|eletronica|alternador|bateria|lampada|lanterna|farol|sensor|chicote|fusivel|rele|motor de partida|vidro eletrico|trava eletrica)\b/;

    // Primeiro usa a DESCRIÇÃO do serviço. Ela é mais específica que a seção PMSP,
    // que pode vir genérica como "MECANICA ELETRICA GERAL". Isso evita jogar
    // amortecedor/mola/suspensão em ELETRICA só porque o rótulo oficial contém a palavra "ELETRICA".
    if (isFunilaria.test(desc)) return 'FUNILARIA / PINTURA';
    if (isTapecaria.test(desc)) return 'TAPECARIA / CAPOTARIA';
    if (isBorracharia.test(desc)) return 'BORRACHARIA';
    if (isLavagem.test(desc)) return 'LAVAGEM / HIGIENIZACAO';
    if (isInjecao.test(desc)) return 'INJECAO / ALIMENTACAO';
    if (isMecanica.test(desc)) return 'MECANICA';
    if (isEletrica.test(desc)) return 'ELETRICA';

    if (isFunilaria.test(t)) return 'FUNILARIA / PINTURA';
    if (isTapecaria.test(t)) return 'TAPECARIA / CAPOTARIA';
    if (isBorracharia.test(t)) return 'BORRACHARIA';
    if (isLavagem.test(t)) return 'LAVAGEM / HIGIENIZACAO';
    if (isInjecao.test(t)) return 'INJECAO / ALIMENTACAO';

    if (/mecanica\s+eletrica\s+geral/.test(sistema) || (isMecanica.test(t) && isEletrica.test(t))) return 'MECANICA';
    if (isEletrica.test(t)) return 'ELETRICA';
    if (isMecanica.test(t)) return 'MECANICA';
    return base ? base.toUpperCase().slice(0, 48) : 'OUTROS SERVICOS';
  }

  function extrairTipoVeiculoTempa(input, veiculoAtual) {
    input = input || {};
    veiculoAtual = veiculoAtual || {};
    const direto = limparTexto(pick(
      input.tipoVeiculoTabela,
      input.tipoVeiculoTempa,
      input.tipoVeiculoTemp,
      input.porteVeiculoTabela,
      input.porteTabela
    ));
    if (direto) return direto.toUpperCase();

    const base = normalizarSecao([
      input.tipoVeiculo,
      input.tipo,
      input.sistemaTabela,
      input.sistema,
      input.secaoHoraLabel,
      input.desc,
      input.descricao
    ].filter(Boolean).join(' '));

    if (/caminhao|caminhoes|onibus|pesado/.test(base)) return 'ÔNIBUS / CAMINHÕES';
    if (/suv/.test(base)) return 'SUV';
    if (/compacto/.test(base)) return 'VEÍCULO COMPACTO';
    if (/pequenos? e medios?|medio|leve|ciclo otto|otto/.test(base)) return 'VEÍCULOS PEQUENOS E MÉDIOS / CICLO OTTO';
    if (/diesel/.test(base)) return 'VEÍCULOS MÉDIOS A DIESEL';
    if (/utilitario|utilitaria|van/.test(base)) return 'UTILITÁRIO / VAN';
    if (/motocicleta|moto/.test(base)) return 'MOTO';

    return limparTexto(pick(veiculoAtual.tipo, veiculoAtual.categoria, veiculoAtual.porte)).toUpperCase();
  }

  function codigoServicoTempa(servico, resolvido) {
    return limparTexto(pick(
      servico?.codigoTabela,
      servico?.codigoTempa,
      servico?.codigoServico,
      servico?.codigo,
      servico?.cod,
      resolvido?.codigoTabela,
      resolvido?.codigo
    ));
  }

  function listaResumo(values, limite) {
    const arr = Array.from(values || []).map(v => limparTexto(v)).filter(Boolean);
    const unicos = Array.from(new Set(arr));
    return unicos.slice(0, limite).join(', ') + (unicos.length > limite ? ` +${unicos.length - limite}` : '');
  }

  function textoSistemaServico(s) {
    const partes = [];
    if (s.codigo) partes.push(`COD. SERVIÇO: ${s.codigo}`);
    if (s.sistema) partes.push(`SISTEMA: ${s.sistema}`);
    if (s.tipoVeiculo) partes.push(`TIPO VEÍCULO: ${s.tipoVeiculo}`);
    return partes.join('\n') || s.sistema || '';
  }

  function textoResumoSecao(secao, item) {
    // KPI/resumo da planilha deve agrupar somente o tipo/seção do serviço.
    // Código do serviço, sistema e tipo de veículo ficam na linha individual do serviço,
    // igual ao código da peça fica na linha individual da peça.
    return limparTexto(secao);
  }

  function resumirSecoes(linhasServ) {
    const out = {};
    (linhasServ || []).forEach(s => {
      const secao = classificarSecao(s);
      if (!out[secao]) out[secao] = { horas: 0, total: 0, qtd: 0, codigos: new Set(), sistemas: new Set(), tiposVeiculo: new Set() };
      out[secao].horas += n(s.tempo || 0);
      out[secao].total += n(s.total || 0);
      out[secao].qtd += 1;
      if (s.codigo) out[secao].codigos.add(s.codigo);
      if (s.sistema) out[secao].sistemas.add(s.sistema);
      if (s.tipoVeiculo) out[secao].tiposVeiculo.add(s.tipoVeiculo);
    });
    return Object.entries(out).sort((a, b) => b[1].total - a[1].total);
  }

  function dataExtenso(cidade) {
    const hoje = new Date();
    const meses = ['JANEIRO','FEVEREIRO','MARCO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'];
    return `${(cidade || 'SAO PAULO').toUpperCase()}, ${hoje.getDate()} DE ${meses[hoje.getMonth()]} DE ${hoje.getFullYear()}.`;
  }

  function oesNumero(cli, os) {
    const modelo = pick(cli.govOesModelo, cli.oesModelo, os.oesModelo, os.oes, 'ORC ###/2026');
    return modelo.replace(/###/g, String(os.id || '').slice(-3).toUpperCase());
  }

  function limparTexto(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function pick(...values) {
    for (const value of values) {
      if (value === undefined || value === null) continue;
      const txt = limparTexto(value);
      if (txt !== '') return value;
    }
    return '';
  }

  function parseJsonSeguro(value) {
    try { return value ? JSON.parse(value) : {}; } catch(e) { return {}; }
  }

  function mergeCadastro(...objs) {
    const out = {};
    objs.filter(Boolean).forEach(obj => {
      Object.entries(obj).forEach(([k, v]) => {
        if (v === undefined || v === null) return;
        if (typeof v === 'string' && v.trim() === '') return;
        out[k] = v;
      });
    });
    return out;
  }

  function upperTexto(...values) {
    return limparTexto(pick(...values)).toUpperCase();
  }

  function enderecoPessoa(pessoa) {
    if (!pessoa) return '';
    return pick(
      pessoa.enderecoCompleto,
      [
        pick(pessoa.endereco, pessoa.rua, pessoa.logradouro),
        pick(pessoa.numero, pessoa.num, pessoa.n),
        pessoa.bairro,
        pick(pessoa.cidade, pessoa.municipio),
        pessoa.uf,
        pessoa.cep
      ].filter(v => limparTexto(v)).join(', ')
    );
  }

  function dadosCliente(cli, os) {
    cli = cli || {};
    os = os || {};
    return {
      unidade: pick(cli.govUnidade, cli.unidade, cli.razaoSocial, cli.nome, os.cliente),
      doc: pick(cli.doc, cli.cnpj, cli.cpf, os.cpf),
      endereco: enderecoPessoa(cli),
      fiscal: pick(cli.govFiscal, cli.fiscalContrato, cli.fiscal, cli.responsavel),
      cabecalho: pick(cli.govCabecalho, cli.cabecalhoInstitucional),
      cidade: pick(cli.cidade, cli.municipio)
    };
  }

  function dadosVeiculo(veiculo, os) {
    veiculo = veiculo || {};
    os = os || {};
    return {
      marca: upperTexto(veiculo.marca, os.marca),
      modelo: upperTexto(veiculo.modelo, os.veiculo, os.modelo),
      ano: pick(veiculo.ano, os.ano),
      placa: upperTexto(veiculo.placa, os.placa),
      chassis: upperTexto(veiculo.chassis, veiculo.chassi, os.chassis, os.chassi),
      patrimonio: pick(veiculo.patrimonio, veiculo.patrimonioNumero, veiculo.patrimonioId, os.patrimonio, os.patrimonioNumero),
      prefixo: upperTexto(veiculo.prefixo, os.prefixo),
      km: pick(os.km, veiculo.km)
    };
  }

  function dadosTenant(tenant) {
    tenant = tenant || {};
    return {
      razaoSocial: pick(tenant.razaoSocial, tenant.razao, tenant.nomeFantasia, tenant.tnome, tenant.nome),
      cnpj: pick(tenant.cnpj, tenant.doc, tenant.documento),
      endereco: enderecoOficina(tenant),
      telefone: pick(tenant.telefone, tenant.wpp, tenant.celular),
      orcamentista: pick(tenant.orcamentista, tenant.responsavel, tenant.nome, tenant.tnome),
      representante: pick(tenant.representante, tenant.responsavel, tenant.orcamentista, tenant.nome, tenant.tnome),
      cidade: pick(tenant.cidade, tenant.municipio)
    };
  }

  function cloneStyle(style) {
    return style ? JSON.parse(JSON.stringify(style)) : {};
  }

  function copiarLinhaModelo(ws, origem, destino, ateColuna) {
    const src = ws.getRow(origem);
    const dst = ws.getRow(destino);
    dst.height = src.height;
    for (let c = 1; c <= ateColuna; c++) {
      const sc = src.getCell(c);
      const dc = dst.getCell(c);
      dc.style = cloneStyle(sc.style);
      dc.numFmt = sc.numFmt;
      dc.alignment = cloneStyle(sc.alignment);
      dc.border = cloneStyle(sc.border);
      dc.fill = cloneStyle(sc.fill);
      dc.font = cloneStyle(sc.font);
      dc.protection = cloneStyle(sc.protection);
    }
  }

  function setCell(ws, addr, value) {
    const c = ws.getCell(addr);
    c.value = value == null ? '' : value;
  }

  function setFormula(ws, addr, formula, result) {
    const c = ws.getCell(addr);
    c.value = { formula, result: moedaNumber(result) };
  }

  function setNumberCell(ws, addr, value, numFmt) {
    const c = ws.getCell(addr);
    c.value = moedaNumber(value);
    if (numFmt) c.numFmt = numFmt;
    c.alignment = { ...(c.alignment || {}), horizontal: 'right', vertical: 'middle', shrinkToFit: true };
  }

  function setMoneyCell(ws, addr, value) {
    setNumberCell(ws, addr, value, '"R$" #,##0.00;-"R$" #,##0.00;"-"');
  }

  function setPercentCell(ws, addr, value) {
    const c = ws.getCell(addr);
    c.value = n(value) || 0;
    c.numFmt = '0.0%';
    c.alignment = { ...(c.alignment || {}), horizontal: 'center', vertical: 'middle', shrinkToFit: true };
  }

  function safeUnmerge(ws, range) {
    try { ws.unMergeCells(range); } catch(e) {}
  }

  function limparRangeResumo(ws, row) {
    ['A:H','A:D','A:B','B:D','B:F','B:H','C:D','D:H','E:F','E:H','F:H','G:H'].forEach(range => safeUnmerge(ws, `${range.split(':')[0]}${row}:${range.split(':')[1]}${row}`));
    ['A','B','C','D','E','F','G','H'].forEach(col => setCell(ws, col + row, ''));
  }

  function inserirLinhasExtras(ws, totalRow, modeloRow, extra) {
    if (extra <= 0) return;
    ws.spliceRows(totalRow, 0, ...Array.from({ length: extra }, () => []));
    for (let i = 0; i < extra; i++) copiarLinhaModelo(ws, modeloRow, totalRow + i, 8);
  }

  function enderecoOficina(tenant) {
    return pick(
      tenant.enderecoCompleto,
      [
        pick(tenant.endereco, tenant.rua, tenant.logradouro),
        pick(tenant.numero, tenant.num, tenant.n),
        tenant.bairro,
        pick(tenant.cidade, tenant.municipio),
        tenant.uf,
        tenant.cep
      ].filter(v => limparTexto(v)).join(', ')
    );
  }

  function aplicarAjustesCabecalho(ws) {
    ws.getColumn('B').width = 26;
    ws.getColumn('D').width = 46;
    ws.getColumn('E').width = 8;
    ws.getColumn('F').width = 17;
    ws.getColumn('G').width = 12;
    ws.getColumn('H').width = 20;
    [1,3,5,6,7,9,10,11,12,14,15,17].forEach(r => {
      const row = ws.getRow(r);
      row.height = Math.max(row.height || 15, r === 1 ? 92 : 18);
      row.eachCell({ includeEmpty: true }, cell => {
        cell.alignment = { ...(cell.alignment || {}), wrapText: true, shrinkToFit: true, vertical: 'middle' };
      });
    });
  }

  function clearRow(ws, row, cols) {
    (cols || ['B','D','E','F','G','H']).forEach(col => setCell(ws, col + row, ''));
  }

  function prepararLinhasDados(ws, start, end, usadas) {
    const visiveis = Math.min(end - start + 1, Math.max(usadas + 3, 4));
    const ultimoVisivel = start + visiveis - 1;
    for (let r = start; r <= end; r++) {
      clearRow(ws, r);
      ws.getRow(r).hidden = r > ultimoVisivel;
    }
  }

  function prepararRodape(ws, rows) {
    rows.forEach(r => {
      ws.getRow(r).hidden = false;
      limparRangeResumo(ws, r);
    });
  }

  function estilizarResumo(ws, row, destaque) {
    const fill = destaque ? { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC9C19B' } } : { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDEDED' } };
    ['B','C','D','E','F','G','H'].forEach(col => {
      const cell = ws.getCell(col + row);
      cell.fill = fill;
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF000000' } },
        left: { style: 'thin', color: { argb: 'FF000000' } },
        bottom: { style: 'thin', color: { argb: 'FF000000' } },
        right: { style: 'thin', color: { argb: 'FF000000' } }
      };
      cell.alignment = { ...(cell.alignment || {}), vertical: 'middle', shrinkToFit: true, wrapText: true };
      cell.font = { ...(cell.font || {}), bold: true, color: { argb: 'FF000000' }, size: destaque ? 15 : 10 };
    });
    ws.getRow(row).height = destaque ? 26 : 19;
  }

  function linhaResumoValor(ws, row, label, value, opts) {
    const op = opts || {};
    limparRangeResumo(ws, row);
    safeUnmerge(ws, `B${row}:F${row}`);
    ws.mergeCells(`B${row}:F${row}`);
    setCell(ws, 'B' + row, label);
    ws.getCell('B' + row).alignment = { horizontal: op.contrato ? 'center' : 'left', vertical: 'middle', wrapText: true, shrinkToFit: true };
    if (op.blankValue) {
      setCell(ws, 'G' + row, '');
      setCell(ws, 'H' + row, '');
    } else {
      setCell(ws, 'G' + row, 'R$');
      ws.getCell('G' + row).alignment = { horizontal: 'center', vertical: 'middle' };
      setMoneyCell(ws, 'H' + row, value);
    }
    estilizarResumo(ws, row, !!op.contrato);
  }

  function linhaTotalServicos(ws, row, horas, total) {
    limparRangeResumo(ws, row);
    setCell(ws, 'B' + row, 'TOTAL DE SERVICOS');
    setNumberCell(ws, 'E' + row, horas, '0.00');
    setCell(ws, 'G' + row, 'R$');
    ws.getCell('G' + row).alignment = { horizontal: 'center', vertical: 'middle' };
    setMoneyCell(ws, 'H' + row, total);
    estilizarResumo(ws, row, false);
  }

  function linhaTotalPecas(ws, row, total) {
    limparRangeResumo(ws, row);
    safeUnmerge(ws, `B${row}:F${row}`);
    ws.mergeCells(`B${row}:F${row}`);
    setCell(ws, 'B' + row, 'TOTAL DE PECAS');
    setCell(ws, 'G' + row, 'R$');
    ws.getCell('G' + row).alignment = { horizontal: 'center', vertical: 'middle' };
    setMoneyCell(ws, 'H' + row, total);
    estilizarResumo(ws, row, false);
  }

  function inserirResumoSecoes(ws, startRow, resumoSecoes) {
    if (!resumoSecoes || !resumoSecoes.length) return;
    const titleRow = startRow;
    const headRow = startRow + 1;
    const primeiroItem = startRow + 2;

    [titleRow, headRow, ...resumoSecoes.map((_, i) => primeiroItem + i)].forEach(row => {
      limparRangeResumo(ws, row);
      ws.getRow(row).hidden = false;
      ['B','D','E','F','G','H'].forEach(col => {
        const cell = ws.getCell(col + row);
        cell.border = {
          top: { style: 'thin', color: { argb: 'FF000000' } },
          left: { style: 'thin', color: { argb: 'FF000000' } },
          bottom: { style: 'thin', color: { argb: 'FF000000' } },
          right: { style: 'thin', color: { argb: 'FF000000' } }
        };
        cell.alignment = { vertical: 'middle', wrapText: true, shrinkToFit: true };
        cell.font = { name: 'Arial', size: 9, color: { argb: 'FF000000' } };
      });
    });

    safeUnmerge(ws, `B${titleRow}:H${titleRow}`);
    ws.mergeCells(`B${titleRow}:H${titleRow}`);
    setCell(ws, 'B' + titleRow, 'RESUMO POR SECAO DE MAO DE OBRA DA O.S.');
    ws.getCell('B' + titleRow).alignment = { horizontal: 'center', vertical: 'middle', shrinkToFit: true };
    ws.getCell('B' + titleRow).font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF000000' } };
    ws.getCell('B' + titleRow).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
    ws.getRow(titleRow).height = 18;

    safeUnmerge(ws, `B${headRow}:F${headRow}`);
    ws.mergeCells(`B${headRow}:F${headRow}`);
    setCell(ws, 'B' + headRow, 'TIPO / SEÇÃO DO SERVIÇO');
    setCell(ws, 'G' + headRow, 'HORAS');
    setCell(ws, 'H' + headRow, 'VALOR');
    ['B','G','H'].forEach(col => {
      const cell = ws.getCell(col + headRow);
      cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF000000' } };
      cell.alignment = { horizontal: col === 'B' ? 'left' : 'center', vertical: 'middle', shrinkToFit: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDEDED' } };
    });

    resumoSecoes.forEach(([secao, item], idx) => {
      const row = primeiroItem + idx;
      safeUnmerge(ws, `B${row}:F${row}`);
      ws.mergeCells(`B${row}:F${row}`);
      setCell(ws, 'B' + row, textoResumoSecao(secao, item));
      setNumberCell(ws, 'G' + row, item.horas, '0.00');
      setMoneyCell(ws, 'H' + row, item.total);
      ws.getCell('B' + row).alignment = { horizontal: 'left', vertical: 'middle', shrinkToFit: true, wrapText: true };
      ws.getCell('G' + row).alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getCell('H' + row).alignment = { horizontal: 'right', vertical: 'middle', shrinkToFit: true };
      ws.getRow(row).height = Math.max(18, 14 * String(ws.getCell('B' + row).value || '').split('\n').length);
    });
  }

  function formatarCabecalhoPM(texto) {
    let raw = String(texto || '');
    if (!/\r?\n/.test(raw)) {
      raw = raw
        .replace(/\s+(POL[IÍ]CIA\s+MILITAR)/i, '\n$1')
        .replace(/\s+(COMANDO\s+DE)/i, '\n$1')
        .replace(/\s+(UNIDADE\s+GESTORA)/i, '\n$1');
    }
    const linhas = raw
      .split(/\r?\n/)
      .map(l => limparTexto(l))
      .filter(Boolean);
    // O modelo possui o brasão/logotipo sobre as colunas A-C. O texto real do cabeçalho
    // precisa manter recuo dentro da célula mesclada B1:H1 para não ficar cortado pelo desenho.
    const recuo = ' '.repeat(39);
    return linhas.map(l => recuo + l).join('\n');
  }

  function coletarDados(os, cli, veiculo) {
    const sessao = window.J || {};
    const oficinaStorage = parseJsonSeguro(sessionStorage.getItem('j_oficina'));
    const tenant = mergeCadastro(sessao, oficinaStorage, sessao.oficina || {});
    tenant.tnome = pick(tenant.nomeFantasia, sessao.tnome, tenant.tnome, tenant.nome);
    tenant.nome = pick(tenant.nome, sessao.nome, tenant.tnome, tenant.nomeFantasia);
    const servicos = (os.servicos || []).filter(s => s.desc || s.valor || s.tempo);
    const pecas = (os.pecas || []).filter(p => p.desc || p.descricao || p.codigo || p.cod || p.venda || p.valor);
    const descMO = taxaDesconto(os.descMO != null ? os.descMO : cli.govDescMO);
    const descPeca = taxaDesconto(os.descPeca != null ? os.descPeca : cli.govDescPeca);
    const valorHoraCliente = n(cli.govValorHora || 0);

    const linhasServ = servicos.map(s => {
      const tempo = n(s.tempo || 0);
      const valorBrutoServico = n(s.valor || 0);
      const resolvido = U().resolvePMSPServico ? U().resolvePMSPServico(s, { veiculo, fallbackValorHora: valorHoraCliente }) : {};
      const valorHora = n(s.valorHora || s.valorHoraSecao || resolvido.valorHora || 0) ||
        (tempo > 0 && valorBrutoServico > 0 ? +(valorBrutoServico / tempo).toFixed(2) : 0) ||
        valorHoraCliente;
      const sistemaServico = resolvido.secaoHoraLabel || s.secaoHoraLabel || s.sistemaTabela || s.sistema || '';
      const codigo = codigoServicoTempa(s, resolvido);
      const tipoVeiculo = extrairTipoVeiculoTempa(s, veiculo);
      const totalFinal = +(valorHora * tempo * (1 - descMO)).toFixed(2);
      return {
        codigo,
        sistema: limparTexto(sistemaServico),
        tipoVeiculo,
        desc: limparTexto(s.desc || ''),
        tempo,
        valorHora,
        descPct: descMO,
        total: totalFinal
      };
    });

    const linhasPecas = pecas.map(p => {
      const qtd = n(p.qtd || p.q || 1) || 1;
      const valorUnit = n(p.venda || p.valor || p.v);
      const totalFinal = +(qtd * valorUnit * (1 - descPeca)).toFixed(2);
      return {
        codigo: limparTexto(p.codigo || p.cod || p.codigoOriginal || p.codigoOEM || p.oem || p.partNumber || p.numeroPeca || 'sem oem') || 'sem oem',
        desc: limparTexto(p.desc || p.descricao || ''),
        qtd,
        valorUnit,
        descPct: descPeca,
        total: totalFinal
      };
    });

    return { tenant, linhasServ, linhasPecas, descMO, descPeca };
  }

  async function exportarComExcelJS(os, cli, veiculo) {
    if (typeof ExcelJS === 'undefined') return false;

    const resp = await fetch(TEMPLATE_URL, { cache: 'no-store' });
    if (!resp.ok) throw new Error('Modelo PMSP nao encontrado: ' + TEMPLATE_URL);
    const buffer = await resp.arrayBuffer();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = wb.worksheets[0];

    const { tenant, linhasServ, linhasPecas } = coletarDados(os, cli, veiculo);
    const resumoSecoes = resumirSecoes(linhasServ);
    const dc = dadosCliente(cli, os);
    const dv = dadosVeiculo(veiculo, os);
    const dt = dadosTenant(tenant);

    const servRowsWanted = Math.max(linhasServ.length + 3, 4);
    const servExtra = Math.max(0, servRowsWanted - SERV_CAPACITY);
    inserirLinhasExtras(ws, SERV_TOTAL, SERV_END, servExtra);
    const servEnd = SERV_END + servExtra;
    const servTotal = SERV_TOTAL + servExtra;
    const resumoSecoesRows = resumoSecoes.length ? resumoSecoes.length + 2 : 0;
    if (resumoSecoesRows) {
      ws.spliceRows(servTotal + 1, 0, ...Array.from({ length: resumoSecoesRows }, () => []));
    }
    const pecaShift = servExtra + resumoSecoesRows;
    const pecaStart = PECA_START + pecaShift;
    const pecaEndBase = PECA_END + pecaShift;
    const pecaTotalBase = PECA_TOTAL + pecaShift;

    const pecaRowsWanted = Math.max(linhasPecas.length + 3, 4);
    const pecaExtra = Math.max(0, pecaRowsWanted - PECA_CAPACITY);
    inserirLinhasExtras(ws, pecaTotalBase, pecaEndBase, pecaExtra);
    const pecaEnd = pecaEndBase + pecaExtra;
    const pecaTotal = pecaTotalBase + pecaExtra;
    const totalGeralRow = pecaTotal + 1;
    const vistoriaRow = pecaTotal + 2;
    const resumoPecasRow = pecaTotal + 3;
    const resumoMORow = pecaTotal + 4;
    const resumoTotalRow = pecaTotal + 5;
    const contratoRow = pecaTotal + 6;
    const dataRow = pecaTotal + 7;
    const representanteRow = pecaTotal + 11;

    const cabecalho = dc.cabecalho || 'SECRETARIA DA SEGURANCA PUBLICA\nPOLICIA MILITAR DO ESTADO DE SAO PAULO';
    const representante = dt.representante;
    setCell(ws, 'B1', formatarCabecalhoPM(cabecalho));
    ws.getCell('B1').alignment = { ...(ws.getCell('B1').alignment || {}), vertical: 'middle', horizontal: 'left', wrapText: true, shrinkToFit: true };
    setCell(ws, 'A3', `REFERENCIA: ORDEM E EXECUCAO DE SERVICOS No ${oesNumero(cli, os)}`);
    setCell(ws, 'A5', `MARCA: ${dv.marca}`);
    setCell(ws, 'C5', `MODELO: ${dv.modelo}`);
    setCell(ws, 'E5', `ANO: ${dv.ano}`);
    setCell(ws, 'G5', `PLACA: ${dv.placa}`);
    setCell(ws, 'A6', `CHASSIS: ${dv.chassis}`);
    setCell(ws, 'D6', `PATRIMONIO: ${dv.patrimonio}`);
    setCell(ws, 'A7', `KM: ${dv.km}`);
    setCell(ws, 'C7', `PREFIXO: ${dv.prefixo}`);
    setCell(ws, 'E7', `OPM DETENTORA: ${dc.unidade}`);
    setCell(ws, 'A9', `RAZAO SOCIAL : ${dt.razaoSocial}`);
    setCell(ws, 'E9', `CNPJ: ${dt.cnpj}`);
    setCell(ws, 'A10', `ENDERECO: ${dt.endereco}`);
    setCell(ws, 'A11', `TELEFONE: ${dt.telefone}`);
    setCell(ws, 'D11', `ORCAMENTISTA: ${dt.orcamentista}`);
    setCell(ws, 'A12', `REPRESENTANTE LEGAL: ${representante}`);
    setCell(ws, 'A14', `UNIDADE : ${dc.unidade}`);
    setCell(ws, 'E14', `CNPJ: ${dc.doc}`);
    setCell(ws, 'A15', `ENDERECO: ${dc.endereco}`);
    setCell(ws, 'A17', `FISCAL DO CONTRATO: ${dc.fiscal}`);
    aplicarAjustesCabecalho(ws);
    setCell(ws, 'B18', 'CÓD. SERVIÇO / SISTEMA / TIPO VEÍCULO');
    setCell(ws, 'D18', 'DESCRIÇÃO DO SERVIÇO');

    prepararLinhasDados(ws, SERV_START, servEnd, linhasServ.length);
    linhasServ.forEach((s, idx) => {
      const r = SERV_START + idx;
      ws.getRow(r).hidden = false;
      setCell(ws, 'B' + r, textoSistemaServico(s));
      setCell(ws, 'D' + r, s.desc);
      ws.getRow(r).height = Math.max(ws.getRow(r).height || 18, (s.codigo || s.tipoVeiculo) ? 36 : 18);
      ws.getCell('B' + r).alignment = { ...(ws.getCell('B' + r).alignment || {}), wrapText: true, shrinkToFit: true, vertical: 'middle' };
      ws.getCell('D' + r).alignment = { ...(ws.getCell('D' + r).alignment || {}), wrapText: true, shrinkToFit: true, vertical: 'middle' };
      setCell(ws, 'E' + r, s.tempo);
      setMoneyCell(ws, 'F' + r, s.valorHora);
      setPercentCell(ws, 'G' + r, s.descPct);
      setMoneyCell(ws, 'H' + r, s.total);
    });

    prepararLinhasDados(ws, pecaStart, pecaEnd, linhasPecas.length);
    linhasPecas.forEach((p, idx) => {
      const r = pecaStart + idx;
      ws.getRow(r).hidden = false;
      setCell(ws, 'B' + r, p.codigo);
      setCell(ws, 'D' + r, p.desc);
      setCell(ws, 'E' + r, p.qtd);
      setMoneyCell(ws, 'F' + r, p.valorUnit);
      setPercentCell(ws, 'G' + r, p.descPct);
      setMoneyCell(ws, 'H' + r, p.total);
    });

    const totalPecas = linhasPecas.reduce((sum, p) => sum + p.total, 0);
    const totalMO = linhasServ.reduce((sum, s) => sum + s.total, 0);
    const totalHoras = linhasServ.reduce((sum, s) => sum + s.tempo, 0);
    const contrato = +(totalPecas + totalMO).toFixed(2);
    prepararRodape(ws, [
      servTotal,
      pecaTotal,
      totalGeralRow,
      vistoriaRow,
      resumoPecasRow,
      resumoMORow,
      resumoTotalRow,
      contratoRow,
      dataRow,
      representanteRow
    ]);
    linhaTotalServicos(ws, servTotal, totalHoras, totalMO);
    inserirResumoSecoes(ws, servTotal + 1, resumoSecoes);
    linhaTotalPecas(ws, pecaTotal, totalPecas);
    linhaResumoValor(ws, totalGeralRow, 'TOTAL GERAL', 0, { blankValue: true });
    linhaResumoValor(ws, vistoriaRow, 'VALOR DA VISTORIA TECNICA COMPLEMENTAR AO ESCOPO DE SERVICOS', 0, { blankValue: true });
    linhaResumoValor(ws, resumoPecasRow, 'VALOR TOTAL DE PECAS', totalPecas);
    linhaResumoValor(ws, resumoMORow, 'VALOR TOTAL DE MAO DE OBRA', totalMO);
    linhaResumoValor(ws, resumoTotalRow, 'TOTAL GERAL', contrato);
    linhaResumoValor(ws, contratoRow, 'VALOR DO CONTRATO', contrato, { contrato: true });
    setCell(ws, 'A' + dataRow, dataExtenso(dt.cidade || dc.cidade));
    setCell(ws, 'A' + representanteRow, String(representante).toUpperCase());

    ws.pageSetup = {
      ...ws.pageSetup,
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printArea: `A1:H${representanteRow}`
    };

    const fname = `${(dv.prefixo || String(os.id || '').slice(-6).toUpperCase() || 'OS')}_PLANILHA_DE_CUSTOS.xlsx`;
    const out = await wb.xlsx.writeBuffer();
    const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    window.toast?.(`Orcamento PMSP exportado: ${fname}`, 'ok');
    return true;
  }

  async function exportarFallbackSheetJS(os, cli, veiculo) {
    if (typeof XLSX === 'undefined') throw new Error('Biblioteca XLSX nao carregou.');
    const { tenant, linhasServ, linhasPecas } = coletarDados(os, cli, veiculo);
    const resumoSecoes = resumirSecoes(linhasServ);
    const dc = dadosCliente(cli, os);
    const dv = dadosVeiculo(veiculo, os);
    const dt = dadosTenant(tenant);
    const rows = [
      [dc.cabecalho || 'SECRETARIA DA SEGURANCA PUBLICA POLICIA MILITAR DO ESTADO DE SAO PAULO'],
      ['PLANILHA DE COMPOSICAO DE CUSTOS'],
      [`REFERENCIA: ORDEM E EXECUCAO DE SERVICOS No ${oesNumero(cli, os)}`],
      ['DADOS DA VIATURA'],
      [`MARCA: ${dv.marca}`, `MODELO: ${dv.modelo}`, `ANO: ${dv.ano}`, `PLACA: ${dv.placa}`],
      [`CHASSIS: ${dv.chassis}`, `PATRIMONIO: ${dv.patrimonio}`],
      [`KM: ${dv.km}`, `PREFIXO: ${dv.prefixo}`, `OPM DETENTORA: ${dc.unidade}`],
      ['DADOS DA EMPRESA'],
      [`RAZAO SOCIAL: ${dt.razaoSocial}`, `CNPJ: ${dt.cnpj}`],
      [`ENDERECO: ${dt.endereco}`],
      [`TELEFONE: ${dt.telefone}`, `ORCAMENTISTA: ${dt.orcamentista}`],
      [`REPRESENTANTE LEGAL: ${dt.representante}`],
      ['DADOS DO CLIENTE'],
      [`UNIDADE: ${dc.unidade}`, `CNPJ: ${dc.doc}`],
      [`ENDERECO: ${dc.endereco}`],
      [`FISCAL DO CONTRATO: ${dc.fiscal}`],
      [],
      ['COD. SERVICO / SISTEMA / TIPO VEICULO','DESCRICAO DO SERVICO','TMO','VALOR','DESC.','VALOR']
    ];
    linhasServ.forEach(s => rows.push([textoSistemaServico(s), s.desc, s.tempo, s.valorHora, s.descPct, s.total]));
    rows.push(['TOTAL DE SERVICOS', '', linhasServ.reduce((sum, s) => sum + s.tempo, 0), '', '', linhasServ.reduce((sum, s) => sum + s.total, 0)]);
    if (resumoSecoes.length) {
      rows.push([]);
      rows.push(['RESUMO POR TIPO / SECAO DO SERVICO DA O.S.', '', '', '', 'HORAS', 'VALOR']);
      resumoSecoes.forEach(([secao, item]) => rows.push([textoResumoSecao(secao, item), '', '', '', item.horas, item.total]));
    }
    rows.push([]);
    rows.push(['CODIGO DA PECA (CODIGO ORIGINAL)','DESCRICAO','QTD','VALOR UNITARIO REGISTRADO','DESC','VALOR']);
    linhasPecas.forEach(p => rows.push([p.codigo, p.desc, p.qtd, p.valorUnit, p.descPct, p.total]));
    rows.push(['TOTAL DE PECAS', '', '', '', '', linhasPecas.reduce((sum, p) => sum + p.total, 0)]);
    const total = linhasPecas.reduce((sum, p) => sum + p.total, 0) + linhasServ.reduce((sum, s) => sum + s.total, 0);
    rows.push(['VALOR DO CONTRATO', '', '', '', '', total]);
    rows.push([dataExtenso(dt.cidade || dc.cidade)]);

    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Plan1');
    const fname = `${(dv.prefixo || String(os.id || '').slice(-6).toUpperCase() || 'OS')}_PLANILHA_DE_CUSTOS.xlsx`;
    XLSX.writeFile(wb, fname);
    window.toast?.('ExcelJS nao carregou; exportado em modo compatibilidade.', 'warn');
  }

  window.exportarOrcamentoPMSP = async function() {
    try {
      const osId = document.getElementById('osId')?.value;
      if (!osId) { window.toast?.('Salve a O.S. antes de exportar.', 'warn'); return; }

      const os = (window.J?.os || []).find(o => o.id === osId);
      if (!os) { window.toast?.('O.S. nao encontrada.', 'err'); return; }

      const cli = (window.J?.clientes || []).find(c => c.id === os.clienteId);
      if (!cli || cli.tipoCliente !== 'governo') {
        window.toast?.('Esta exportacao e exclusiva para clientes governamentais.', 'err');
        return;
      }

      const veiculo = (window.J?.veiculos || []).find(v => v.id === os.veiculoId) || {};
      const ok = await exportarComExcelJS(os, cli, veiculo);
      if (!ok) await exportarFallbackSheetJS(os, cli, veiculo);
    } catch (e) {
      console.error('[PMSP XLSX]', e);
      window.toast?.('Erro ao exportar PMSP: ' + e.message, 'err');
    }
  };
})();
