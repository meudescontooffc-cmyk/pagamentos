import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";

import {
  getFirestore,
  collection,
  getDocs,
  addDoc,
  updateDoc,
  setDoc,
  doc,
  getDoc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import {
  getAuth,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";


/* =========================================
   🔥 FIREBASE
========================================= */

const firebaseConfig = {
  apiKey: "AIzaSyAdDrbZHf93zdvY3TqdUYkqTcFOJmJhLw4",
  authDomain: "rastreamento-ad456.firebaseapp.com",
  projectId: "rastreamento-ad456",
  appId: "1:212558087501:web:a00e808856f7e80ae62304"
};


/* =========================================
   🔒 HELPERS DE SEGURANÇA
========================================= */

// Escapa HTML para prevenir XSS ao inserir texto em innerHTML
function sanitize(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

// Lê inteiro positivo de um input com segurança
function safeInt(val, fallback = 0) {
  const n = parseInt(val, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// Garante que há usuário autenticado antes de operações críticas
async function assertAdmin() {
  const user = auth.currentUser;
  if (!user) { window.location.href = "index.html"; throw new Error("Não autenticado"); }
  return user;
}

const app  = initializeApp(firebaseConfig);
const db   = getFirestore(app);
const auth = getAuth(app);


/* =========================================
   🔐 BLOQUEIO
========================================= */

onAuthStateChanged(auth, (user) => {
  if (!user) window.location.href = "index.html";
});


/* =========================================
   🔹 ELEMENTOS
========================================= */

const estadoInput  = document.getElementById("estado");
const estadoSelect = document.getElementById("listaEstados");
const lista        = document.getElementById("lista");

const numeros = [
  document.getElementById("c1"),
  document.getElementById("c2"),
  document.getElementById("c3"),
  document.getElementById("c4"),
  document.getElementById("c5"),
  document.getElementById("c6")
];

const PAGE = 10;


/* =========================================
   🔀 CONTROLE DE VIEW ATIVA
   Evita que respostas async de uma aba
   sobrescrevam o conteúdo de outra aba.
========================================= */

let _viewToken = 0; // incrementa a cada troca de view

function novaView() {
  _viewToken++;
  return _viewToken; // cada chamada guarda seu próprio token
}

// Retorna true se o token ainda é a view ativa
function viewAtiva(token) {
  return token === _viewToken;
}

// Marca o botão do menu como ativo (dourado) e persiste no sessionStorage
function setActiveBtn(btnId) {
  // Remove classe de todos os botões de nav
  document.querySelectorAll(".btn-menu, .btn").forEach(b => b.classList.remove("active"));
  // Adiciona no botão atual
  const btn = document.getElementById(btnId);
  if (btn) btn.classList.add("active");
  // Persiste para sobreviver a re-renders
  try { sessionStorage.setItem("adminActiveBtn", btnId); } catch (_) {}
}

// Restaura o botão ativo ao carregar / após qualquer re-render
function restaurarBtnAtivo() {
  try {
    const id = sessionStorage.getItem("adminActiveBtn");
    if (!id) return;
    document.querySelectorAll(".btn-menu, .btn").forEach(b => b.classList.remove("active"));
    const btn = document.getElementById(id);
    if (btn) btn.classList.add("active");
  } catch (_) {}
}

// Reexecuta a MESMA aba/filtro que estava ativo antes (Ativos, Inativos,
// Pagamentos, Todos, etc.) em vez de sempre cair na lista geral. Evita que
// ações feitas dentro de um modal (ex: salvar um plano) troquem a pessoa
// de aba sem querer ao fechar.
function recarregarViewAtual() {
  let id;
  try { id = sessionStorage.getItem("adminActiveBtn"); } catch (_) { id = null; }

  const mapa = {
    "btn-ativos":      () => verAtivos("btn-ativos"),
    "btn-inativos":    () => verInativos("btn-inativos"),
    "btn-validacoes":  () => verValidacoes("btn-validacoes"),
    "btn-empresas":    () => verEmpresas("btn-empresas"),
    "btn-premiacoes":  () => verPremiacoes("btn-premiacoes"),
    "btn-sorteios":    () => verSorteios("btn-sorteios"),
    "btn-pagamentos":  () => verPagamentos("btn-pagamentos"),
    "btn-todos":       () => listarClientes("btn-todos")
  };

  (mapa[id] || (() => listarClientes("btn-todos")))();
}


/* =========================================
   💾 CACHE (TTL 60s)
========================================= */

const cache = {
  _s: {},
  _ttl: 60_000,
  set(k, v)  { this._s[k] = { v, ts: Date.now() }; },
  get(k)     {
    const e = this._s[k];
    if (!e) return null;
    if (Date.now() - e.ts > this._ttl) { delete this._s[k]; return null; }
    return e.v;
  },
  del(k)     { delete this._s[k]; },
  clear()    { this._s = {}; }
};


/* =========================================
   💰 HELPERS
========================================= */

function moeda(v) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
    .format(Number(v || 0));
}

function agora() {
  const d = new Date();
  return {
    data: d.toLocaleDateString("pt-BR"),
    hora: d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
  };
}


/* =========================================
   📄 PAGINAÇÃO "VER MAIS"
========================================= */

function renderPaginado(container, itens, renderFn, offset = 0) {
  // Remove botão ver mais anterior
  const old = container.querySelector(".btn-ver-mais-wrap");
  if (old) old.remove();

  const fatia = itens.slice(offset, offset + PAGE);
  fatia.forEach(renderFn);

  const prox = offset + PAGE;
  if (prox < itens.length) {
    const wrap = document.createElement("div");
    wrap.className = "btn-ver-mais-wrap";
    wrap.style.cssText = "width:100%;display:block;clear:both;margin:12px 0;text-align:center;";
    const btn = document.createElement("button");
    btn.className = "btn-ver-mais";
    btn.style.cssText = "display:inline-block;width:auto;min-width:160px;max-width:100%;";
    btn.textContent = `Ver mais (${itens.length - prox} restantes)`;
    btn.onclick = () => {
      wrap.remove();
      renderPaginado(container, itens, renderFn, prox);
    };
    wrap.appendChild(btn);
    container.appendChild(wrap);
  }
}

// Atalho para o #lista principal
function paginar(itens, renderFn) {
  renderPaginado(lista, itens, renderFn, 0);
}


/* =========================================
   🔥 ESTADO / INPUTS
========================================= */

estadoSelect.addEventListener("change", () => {
  estadoInput.value = estadoSelect.value;
  numeros[0].focus();
});

// Permite digitar a UF diretamente no input (ex: "MA", "SP"), em vez de
// precisar abrir o select. Sincroniza com o select quando a sigla bate
// com uma das opções disponíveis, senão mantém o valor digitado mesmo assim.
estadoInput.addEventListener("input", () => {
  estadoInput.value = estadoInput.value.replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 2);

  const opcoes = Array.from(estadoSelect.options).map(o => o.value);
  estadoSelect.value = opcoes.includes(estadoInput.value) ? estadoInput.value : "";

  if (estadoInput.value.length === 2) numeros[0].focus();
});

numeros.forEach((input, i) => {
  input.addEventListener("input", () => {
    input.value = input.value.replace(/[^0-9]/g, "");
    if (input.value && i < numeros.length - 1) numeros[i + 1].focus();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Backspace" && !input.value && i > 0) numeros[i - 1].focus();
  });
});


/* =========================================
   🔥 GERAR ID ÚNICO
   UID do documento = código gerado
========================================= */

async function gerarCodigoUnico() {
  const estado = estadoSelect.value.trim().toUpperCase() || "MA";
  while (true) {
    const num    = Math.floor(100000 + Math.random() * 900000);
    const codigo = `${estado}-${num}`;
    const snap   = await getDoc(doc(db, "clientes", codigo));
    if (!snap.exists()) return codigo;
  }
}

/* =========================================
   ✨ MODAL GERAR CÓDIGO — Novo Cliente
========================================= */

let _planoSelecionado = null;

window.gerarCodigo = async function() {
  await assertAdmin();
  abrirModalGerar();
};

function abrirModalGerar() {
  // Reset do formulário
  document.getElementById("gc-nome").value = "";
  document.getElementById("gc-nascimento").value = "";
  document.getElementById("gc-telefone").value = "";
  document.getElementById("gc-uf").value = "";
  document.getElementById("gc-foto-link").value = "";
  document.getElementById("gc-foto-preview").src = "";
  document.getElementById("gc-foto-status").textContent = "";
  document.getElementById("gc-foto-status").className = "foto-status";
  document.querySelectorAll(".plano-btn").forEach(b => b.classList.remove("selecionado"));
  document.getElementById("plano-pendente-aviso")?.classList.add("hidden");
  _planoSelecionado = null;

  document.getElementById("modalGerarCodigo").classList.remove("hidden");
}

window.fecharModalGerar = function() {
  document.getElementById("modalGerarCodigo").classList.add("hidden");
};

window.selecionarPlano = function(plano) {
  _planoSelecionado = plano;
  document.querySelectorAll(".plano-btn").forEach(b => b.classList.remove("selecionado"));
  document.getElementById(`plano-${plano}`).classList.add("selecionado");

  const aviso = document.getElementById("plano-pendente-aviso");
  if (aviso) aviso.classList.toggle("hidden", plano !== "pendente");
};

// Mascara o telefone enquanto digita
document.addEventListener("DOMContentLoaded", () => {
  const tel = document.getElementById("gc-telefone");
  if (tel) {
    tel.addEventListener("input", () => {
      let v = tel.value.replace(/\D/g, "").slice(0, 11);
      if (v.length > 10) v = v.replace(/(\d{2})(\d{5})(\d{0,4})/, "($1) $2-$3");
      else if (v.length > 6) v = v.replace(/(\d{2})(\d{4})(\d{0,4})/, "($1) $2-$3");
      else if (v.length > 2) v = v.replace(/(\d{2})(\d{0,5})/, "($1) $2");
      tel.value = v;
    });
  }

  // Máscara da data de nascimento (DD/MM/AAAA)
  const nasc = document.getElementById("gc-nascimento");
  if (nasc) {
    nasc.addEventListener("input", () => {
      let v = nasc.value.replace(/\D/g, "").slice(0, 8);
      if (v.length > 4) v = v.replace(/(\d{2})(\d{2})(\d{0,4})/, "$1/$2/$3");
      else if (v.length > 2) v = v.replace(/(\d{2})(\d{0,2})/, "$1/$2");
      nasc.value = v;
    });
  }
});

// Preview da foto a partir do link colado
window.previewFotoLink = function(event) {
  const url = event.target.value.trim();
  const preview = document.getElementById("gc-foto-preview");
  const status = document.getElementById("gc-foto-status");

  if (!url) {
    preview.src = "";
    status.textContent = "";
    status.className = "foto-status";
    return;
  }

  status.textContent = "Carregando imagem...";
  status.className = "foto-status carregando";

  // Testa se a imagem carrega antes de exibir
  const testImg = new Image();
  testImg.onload = () => {
    preview.src = url;
    status.textContent = "Imagem válida ✓";
    status.className = "foto-status ok";
  };
  testImg.onerror = () => {
    preview.src = "";
    status.textContent = "Não foi possível carregar essa imagem ❗";
    status.className = "foto-status erro";
  };
  testImg.src = url;
};

window.confirmarGerarCodigo = async function() {
  await assertAdmin();

  const nome       = document.getElementById("gc-nome").value.trim().slice(0, 100);
  const nascimento = document.getElementById("gc-nascimento").value.trim();
  const telefone   = document.getElementById("gc-telefone").value.trim();
  const uf         = document.getElementById("gc-uf").value.trim().toUpperCase();
  const fotoLink   = document.getElementById("gc-foto-link").value.trim();

  if (!nome)             { alert("Informe o nome do cliente ❗"); return; }
  if (!nascimento)       { alert("Informe a data de nascimento ❗"); return; }
  if (!telefone)         { alert("Informe o telefone ❗"); return; }
  if (!_planoSelecionado){ alert("Selecione um plano (Mensal, Anual ou Pendente) ❗"); return; }
  if (!uf)               { alert("Selecione a UF ❗"); return; }

  const btnConfirmar = document.querySelector(".btn-gerar-confirmar");
  btnConfirmar.disabled = true;
  btnConfirmar.textContent = "Gerando...";

  try {
    // Gera código único usando a UF escolhida no modal
    let codigo;
    while (true) {
      const num = Math.floor(100000 + Math.random() * 900000);
      const tentativa = `${uf}-${num}`;
      const snap = await getDoc(doc(db, "clientes", tentativa));
      if (!snap.exists()) { codigo = tentativa; break; }
    }

    let planoInfo;
    if (_planoSelecionado === "anual") {
      planoInfo = { plano: "Anual",  valorPlano: CATALOGO_PLANOS.Anual.valor, dias: CATALOGO_PLANOS.Anual.dias };
    } else if (_planoSelecionado === "pendente") {
      planoInfo = { plano: "Pendente", valorPlano: CATALOGO_PLANOS.Pendente.valor, dias: CATALOGO_PLANOS.Pendente.dias };
    } else {
      planoInfo = { plano: "Mensal", valorPlano: CATALOGO_PLANOS.Mensal.valor,  dias: CATALOGO_PLANOS.Mensal.dias };
    }

    // Plano "Pendente" (neutro) nasce inativo: ID existe, mas só ativa
    // depois que o pagamento (Pix/Cartão) for confirmado no site de pagamento.
    const statusInicial = _planoSelecionado === "pendente" ? "inativo" : "ativo";

    // "Pendente" não é um pagamento de fato — não entra no histórico de planos
    // nem conta como "pagamento iniciado". É só um ID reservado, sem dias.
    const historicoPlanos = _planoSelecionado === "pendente"
      ? []
      : [{ plano: planoInfo.plano, dias: planoInfo.dias, valor: planoInfo.valorPlano, data: Date.now() }];

    await setDoc(doc(db, "clientes", codigo), {
      nome,
      id: codigo,
      status: statusInicial,
      foto: fotoLink,
      nascimento,
      telefone,
      plano: planoInfo.plano,
      valorPlano: planoInfo.valorPlano,
      diasRestantes: planoInfo.dias,
      historicoPlanos,
      // Marca se o cliente já efetuou algum pagamento real (Mensal/Anual).
      // Usado para diferenciar "nunca pagou" (não aparece em Pendentes de pagamento)
      // de "já pagou e venceu" (aparece em Pendentes, precisa renovar).
      pagamentoIniciado: _planoSelecionado !== "pendente",
      // Referência inicial da contagem automática de dias (1 dia descontado por dia corrido).
      ultimaAtualizacaoDias: dataDeHojeISO(),
      criadoEm: serverTimestamp()
    });

    cache.del("clientes");
    fecharModalGerar();
    alert(`Cliente criado \n\nNome: ${nome}\nCódigo: ${codigo}\nPlano: ${planoInfo.plano}\nStatus: ${statusInicial === "ativo" ? "Ativo" : "Inativo (aguardando pagamento)"}`);
    listarClientes();

  } catch (e) {
    console.error(e);
    alert("Erro ao gerar cliente ❌");
  } finally {
    btnConfirmar.disabled = false;
    btnConfirmar.textContent = "Gerar código do cliente";
  }
};


/* =========================================
   🔥 CARD CLIENTE
========================================= */

function criarCard(c, docId) {
  const card = document.createElement("div");
  card.className = "card";
  card.style.cssText = "display:flex;align-items:center;gap:12px;flex-wrap:wrap;";
  // 🔒 sanitize evita XSS em dados do Firestore
  const sNome   = sanitize(c.nome);
  const sStatus = sanitize(c.status);
  // UID do documento = código (ex: MA-123456) — docId é sempre a fonte correta
  const sId     = sanitize(docId || c.id || "");
  const sDocId  = sanitize(docId);
  const sFoto   = sanitize(c.foto || "");
  card.innerHTML = `
    <img src="${sFoto || "https://via.placeholder.com/80"}" style="width:56px;height:56px;border-radius:8px;object-fit:cover;flex-shrink:0;">
    <div class="info" style="flex:1;min-width:0;">
      <h3 style="margin:0 0 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${sNome}</h3>
      <p class="status ${sStatus}" style="margin:2px 0;">${sStatus}</p>
      <p style="margin:2px 0;font-size:12px;color:#aaa;font-family:monospace;">${sId}</p>
    </div>
    <div class="acao" style="display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-shrink:0;">
      <button class="btn-acao btn-detalhes btn-planos" onclick="abrirPlanos('${sDocId}')">Planos</button>
      ${c.status === "ativo"
        ? `<button class="btn-acao btn-inativar" onclick="inativar('${sDocId}')">Inativar</button>`
        : `<button class="btn-acao btn-ativar"   onclick="ativar('${sDocId}')">Ativar</button>`}
    </div>`;
  lista.appendChild(card);
}

/* =========================================
   📅 PLANOS DO CLIENTE
========================================= */

// Catálogo único de planos — usado aqui e no modal "Gerar Código"
const CATALOGO_PLANOS = {
  Mensal:    { dias: 30,  valor: 19.90 },
  Anual:     { dias: 365, valor: 149.90 },
  Pendente:  { dias: 0,   valor: 0 }
};

let _planosDocIdAtual = null;
let _planosOriginal   = null; // snapshot do que está salvo no Firebase
let _planosSimulado   = null; // edição em andamento, ainda não salva

function formatarDataHist(ts) {
  let d;
  if (!ts) return "—";
  if (typeof ts === "number") d = new Date(ts);
  else if (ts.toDate) d = ts.toDate();
  else if (ts.seconds) d = new Date(ts.seconds * 1000);
  else d = new Date(ts);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function tempoDesde(ts) {
  let d;
  if (!ts) return "—";
  if (typeof ts === "number") d = new Date(ts);
  else if (ts.toDate) d = ts.toDate();
  else if (ts.seconds) d = new Date(ts.seconds * 1000);
  else d = new Date(ts);
  if (isNaN(d.getTime())) return "—";

  const diffMs = Date.now() - d.getTime();
  const diasTotais = Math.floor(diffMs / 86400000);
  if (diasTotais < 1) return "Hoje";
  if (diasTotais < 30) return `${diasTotais} dia${diasTotais > 1 ? "s" : ""}`;
  const meses = Math.floor(diasTotais / 30);
  if (meses < 12) return `${meses} ${meses > 1 ? "meses" : "mês"}`;
  const anos = Math.floor(meses / 12);
  const mesesResto = meses % 12;
  return mesesResto > 0 ? `${anos} ano${anos > 1 ? "s" : ""} e ${mesesResto} ${mesesResto > 1 ? "meses" : "mês"}` : `${anos} ano${anos > 1 ? "s" : ""}`;
}

window.abrirPlanos = async function(docId) {
  await assertAdmin();
  _planosDocIdAtual = docId;

  const modal = document.getElementById("modalPlanos");
  modal.classList.remove("hidden");
  document.getElementById("conteudoPlanos").innerHTML = "Carregando...";

  await carregarESimularPlanos(docId);
};

window.fecharModalPlanos = function() {
  document.getElementById("modalPlanos").classList.add("hidden");
  _planosDocIdAtual = null;
  _planosOriginal = null;
  _planosSimulado = null;
  // Garante que a lista por trás do modal reflita a aba que estava ativa,
  // já que abrir/editar o plano pode ter mudado status/dias de algum cliente.
  recarregarViewAtual();
};

// Busca o cliente no Firebase e guarda um snapshot original + uma cópia
// "simulada" que é a que a tela edita. Nada é salvo até clicar em Salvar.
async function carregarESimularPlanos(docId) {
  const snap = await getDoc(doc(db, "clientes", docId));
  if (!snap.exists()) {
    document.getElementById("conteudoPlanos").innerHTML = "<p>Cliente não encontrado ❌</p>";
    return;
  }

  // Garante que os dias exibidos já estão descontados corretamente antes de simular.
  const corrigidos = await aplicarContagemDeDiasEmLote([{ data: snap.data(), id: snap.id }]);
  cache.del("clientes");
  const c = corrigidos[0].data;

  _planosOriginal = c;
  _planosSimulado = {
    plano: c.plano || "Mensal",
    diasRestantes: Number(c.diasRestantes || 0),
    trocouPlano: false // só vira true se o admin clicar em algum dos 3 planos
  };

  renderizarModalPlanos();
}

function renderizarModalPlanos() {
  const c = _planosOriginal;
  const sim = _planosSimulado;
  const docId = _planosDocIdAtual;
  if (!c || !sim) return;

  const sNome  = sanitize(c.nome);
  const sId    = sanitize(docId);
  const hist   = Array.isArray(c.historicoPlanos) ? c.historicoPlanos : [];

  // Valores ATUAIS (salvos de fato no Firebase)
  const planoAtual = c.plano || "—";
  const diasAtuais  = Number(c.diasRestantes || 0);

  // Valores SIMULADOS (o que vai ser salvo se clicar em "Salvar alterações")
  const planoSim = sim.plano;
  const diasSim  = sim.diasRestantes;

  const houveMudanca = planoSim !== planoAtual || diasSim !== diasAtuais;

  // Soma geral de todos os dias já adquiridos no histórico (caso tenha comprado várias vezes)
  const diasTotaisComprados = hist.reduce((soma, h) => soma + Number(h.dias || 0), 0);
  const valorTotalGasto     = hist.reduce((soma, h) => soma + Number(h.valor || 0), 0);

  const linhasHistorico = hist.length
    ? hist.slice().reverse().map(h => `
        <li class="planos-hist-item">
          <span class="planos-hist-plano">${sanitize(h.plano || "—")}</span>
          <span class="planos-hist-dias">${h.dias > 0 ? `+${h.dias} dias` : "0 dias"}</span>
          <span class="planos-hist-data">${formatarDataHist(h.data)}</span>
        </li>`).join("")
    : `<li class="planos-hist-vazio">Nenhum plano pago registrado ainda.</li>`;

  document.getElementById("conteudoPlanos").innerHTML = `
    <div class="planos-resumo">
      <h4 style="margin:0 0 2px;">${sNome}</h4>
      <p style="margin:0 0 12px;font-size:12px;color:#aaa;font-family:monospace;">${sId}</p>

      <div class="planos-grid-info">
        <div class="planos-info-box">
          <span class="planos-info-label">Plano atual (salvo)</span>
          <span class="planos-info-valor">${sanitize(planoAtual)}</span>
        </div>
        <div class="planos-info-box">
          <span class="planos-info-label">Dias restantes (salvo)</span>
          <span class="planos-info-valor" style="color:${diasAtuais > 0 ? '#4caf50' : '#ff5252'}">${diasAtuais}</span>
        </div>
        <div class="planos-info-box">
          <span class="planos-info-label">Dias comprados (total)</span>
          <span class="planos-info-valor">${diasTotaisComprados}</span>
        </div>
        <div class="planos-info-box">
          <span class="planos-info-label">Cliente há</span>
          <span class="planos-info-valor">${tempoDesde(c.criadoEm)}</span>
        </div>
        <div class="planos-info-box">
          <span class="planos-info-label">ID gerado em</span>
          <span class="planos-info-valor" style="font-size:13px;">${formatarDataHist(c.criadoEm)}</span>
        </div>
      </div>

      <p style="margin:10px 0 0;font-size:12px;color:#888;">Total já pago: <strong style="color:#FFD700;">R$ ${valorTotalGasto.toFixed(2).replace(".", ",")}</strong></p>
    </div>

    <div class="linha" style="margin:16px 0;"></div>

    <div class="planos-trocar">
      <label class="planos-label">Trocar plano <span style="color:#777;font-weight:400;">(simulação — só aplica ao salvar)</span></label>
      <div class="plano-opcoes plano-opcoes-3">
        <button type="button" class="plano-btn ${planoSim === 'Mensal' ? 'selecionado' : ''}" onclick="simularPlanoCliente('Mensal')">
          <span class="plano-nome">Mensal</span>
          <span class="plano-preco">+30 dias</span>
        </button>
        <button type="button" class="plano-btn ${planoSim === 'Anual' ? 'selecionado' : ''}" onclick="simularPlanoCliente('Anual')">
          <span class="plano-nome">Anual</span>
          <span class="plano-preco">+365 dias</span>
        </button>
        <button type="button" class="plano-btn plano-btn-neutro ${planoSim === 'Pendente' ? 'selecionado' : ''}" onclick="simularPlanoCliente('Pendente')">
          <span class="plano-nome">Pendente</span>
          <span class="plano-preco">+0 dias</span>
        </button>
      </div>
      <small style="display:block;margin-top:6px;font-size:11px;color:#777;">Clicar só pré-visualiza. Soma os dias do plano escolhido aos dias restantes atuais — nada é salvo até clicar em "Salvar alterações".</small>
    </div>

    <div class="linha" style="margin:16px 0;"></div>

    <div class="planos-ajuste">
      <label class="planos-label">Definir dias restantes (valor exato)</label>
      <div class="planos-ajuste-linha">
        <input type="number" id="planos-input-definir" placeholder="Ex: 45" style="flex:1;">
        <button class="btn-acao btn-detalhes" onclick="simularDefinirDias()">Pré-visualizar</button>
      </div>
      <small style="display:block;margin-top:6px;font-size:11px;color:#777;">Substitui o saldo simulado pelo número exato de dias digitado. Só salva ao clicar em "Salvar alterações".</small>
    </div>

    <div class="planos-ajuste" style="margin-top:14px;">
      <label class="planos-label">Adicionar / remover dias (somar ao saldo simulado)</label>
      <div class="planos-ajuste-linha">
        <input type="number" id="planos-input-dias" placeholder="Ex: 15 ou -10" style="flex:1;">
        <button class="btn-acao btn-detalhes" onclick="simularAjusteDias()">Pré-visualizar</button>
      </div>
      <small style="display:block;margin-top:6px;font-size:11px;color:#777;">Use número negativo para remover dias. Só salva ao clicar em "Salvar alterações".</small>
    </div>

    <div class="linha" style="margin:16px 0;"></div>

    <div class="planos-preview ${houveMudanca ? 'planos-preview-ativo' : ''}">
      <span class="planos-info-label">Pré-visualização do resultado</span>
      <div class="planos-preview-linha">
        <span>Plano: <strong>${sanitize(planoSim)}</strong></span>
        <span>Dias restantes: <strong style="color:${diasSim > 0 ? '#4caf50' : '#ff5252'}">${diasSim}</strong></span>
      </div>
      ${houveMudanca ? '<small style="color:#FFD700;">⚠ Alterações não salvas. Clique em "Salvar alterações" para confirmar.</small>' : '<small style="color:#666;">Nenhuma alteração pendente.</small>'}
    </div>

    <div class="linha" style="margin:16px 0;"></div>

    <div class="planos-historico">
      <label class="planos-label">Histórico de pagamentos</label>
      <ul class="planos-hist-lista">${linhasHistorico}</ul>
    </div>

    <div class="planos-footer-acoes">
      <button class="btn-acao btn-detalhes" onclick="cancelarSimulacaoPlanos()" ${!houveMudanca ? "disabled" : ""}>Cancelar alteração</button>
      <button class="btn-acao btn-ativar" onclick="salvarPlanosCliente()" ${!houveMudanca ? "disabled" : ""}>Salvar alterações</button>
    </div>
  `;
}

// Clicar num plano só atualiza a simulação em memória — NADA é salvo ainda.
// Some os dias do plano clicado ao saldo simulado atual (não ao saldo salvo),
// assim dá pra simular várias trocas em sequência antes de salvar.
window.simularPlanoCliente = function(novoPlano) {
  if (!_planosSimulado) return;
  const info = CATALOGO_PLANOS[novoPlano];
  if (!info) return;

  _planosSimulado.plano = novoPlano;
  _planosSimulado.diasRestantes = _planosSimulado.diasRestantes + info.dias;
  _planosSimulado.trocouPlano = true;

  renderizarModalPlanos();
};

window.simularDefinirDias = function() {
  if (!_planosSimulado) return;
  const input = document.getElementById("planos-input-definir");
  const valor = parseInt(input.value, 10);
  if (isNaN(valor)) { alert("Informe um número de dias válido (ex: 45) ❗"); return; }

  _planosSimulado.diasRestantes = valor;
  renderizarModalPlanos();
};

window.simularAjusteDias = function() {
  if (!_planosSimulado) return;
  const input = document.getElementById("planos-input-dias");
  const valor = parseInt(input.value, 10);
  if (!valor || isNaN(valor)) { alert("Informe um número de dias válido (ex: 15 ou -10) ❗"); return; }

  _planosSimulado.diasRestantes = _planosSimulado.diasRestantes + valor;
  renderizarModalPlanos();
};

// Descarta a simulação e volta tudo para o que está salvo no Firebase.
window.cancelarSimulacaoPlanos = function() {
  if (!_planosOriginal) return;
  _planosSimulado = {
    plano: _planosOriginal.plano || "Mensal",
    diasRestantes: Number(_planosOriginal.diasRestantes || 0),
    trocouPlano: false
  };
  renderizarModalPlanos();
};

// Só AQUI a gravação no Firebase de fato acontece — clicando em "Salvar alterações".
window.salvarPlanosCliente = async function() {
  await assertAdmin();
  if (!_planosDocIdAtual || !_planosOriginal || !_planosSimulado) return;

  const c   = _planosOriginal;
  const sim = _planosSimulado;
  const info = CATALOGO_PLANOS[sim.plano];

  if (!confirm(`Confirma salvar as alterações?\n\nPlano: ${sim.plano}\nDias restantes: ${sim.diasRestantes}`)) return;

  const hist = Array.isArray(c.historicoPlanos) ? c.historicoPlanos : [];
  // Só registra no histórico de pagamento se o admin realmente trocou de plano
  // (e não é o plano "Pendente", que não é um pagamento real).
  const ehPagamentoReal = sim.trocouPlano && sim.plano !== "Pendente";
  if (ehPagamentoReal && info) {
    hist.push({ plano: sim.plano, dias: info.dias, valor: info.valor, data: Date.now() });
  }

  const atualizacao = {
    plano: sim.plano,
    diasRestantes: sim.diasRestantes,
    historicoPlanos: hist,
    // Reseta a referência da contagem automática para hoje — evita que o
    // próximo carregamento desconte dias "atrasados" sobre o valor que o
    // admin acabou de definir manualmente.
    ultimaAtualizacaoDias: dataDeHojeISO()
  };
  if (info) atualizacao.valorPlano = info.valor;
  if (ehPagamentoReal) {
    atualizacao.pagamentoIniciado = true;
    // Ao trocar para um plano pago, garante que o cliente fique ativo
    atualizacao.status = "ativo";
  }

  const ref = doc(db, "clientes", _planosDocIdAtual);
  await updateDoc(ref, atualizacao);
  cache.del("clientes");

  alert("Alterações salvas ✅");
  await carregarESimularPlanos(_planosDocIdAtual);
  recarregarViewAtual();
};

/* =========================================
   💳 PAGAMENTOS — Pendentes / Pagos
========================================= */

// 🔧 Ajuste esta URL para o domínio real do seu checkout
const URL_CHECKOUT = "https://rastreamento-ad456.web.app";

window.abrirPagamentoCliente = function(codigo) {
  const url = `${URL_CHECKOUT}/?codigo=${encodeURIComponent(codigo)}`;
  window.open(url, "_blank");
};

let _filtroPagamentoAtual = "pendentes";

window.verPagamentos = async function(btnId) {
  if (btnId) setActiveBtn(btnId);
  const token = novaView();
  lista.innerHTML = "Carregando pagamentos...";
  fecharPainelConfig();

  try {
    const todos = await carregarClientes();
    if (!viewAtiva(token)) return;

    lista.innerHTML = "";

    // ── Sub-menu Pendentes / Pago
    const subMenu = document.createElement("div");
    subMenu.className = "submenu-pagamentos";
    subMenu.innerHTML = `
      <button class="subbtn-pagamento" id="subbtn-pendentes" onclick="filtrarPagamentos('pendentes')">
         Pendentes
      </button>
      <button class="subbtn-pagamento" id="subbtn-pagos" onclick="filtrarPagamentos('pagos')">
         Pago
      </button>`;
    lista.appendChild(subMenu);

    const containerCards = document.createElement("div");
    containerCards.id = "containerPagamentos";
    lista.appendChild(containerCards);

    renderizarListaPagamentos(todos, _filtroPagamentoAtual);

  } catch (e) { console.error(e); lista.innerHTML = "Erro ao carregar ❌"; }
  restaurarBtnAtivo();
};

window.filtrarPagamentos = async function(filtro) {
  _filtroPagamentoAtual = filtro;
  document.querySelectorAll(".subbtn-pagamento").forEach(b => b.classList.remove("ativo"));
  document.getElementById(`subbtn-${filtro}`)?.classList.add("ativo");

  const todos = await carregarClientes();
  renderizarListaPagamentos(todos, filtro);
};

function renderizarListaPagamentos(todos, filtro) {
  document.querySelectorAll(".subbtn-pagamento").forEach(b => b.classList.remove("ativo"));
  document.getElementById(`subbtn-${filtro}`)?.classList.add("ativo");

  const container = document.getElementById("containerPagamentos");
  if (!container) return;
  container.innerHTML = "";

  // Pendente = dias restantes <= 0 — inclui tanto quem já pagou e venceu
  // quanto quem nunca pagou ainda (plano "Pendente", aguardando 1º pagamento).
  // Pago     = dias restantes > 0 (plano ativo, em dia).
  const filtrados = todos.filter(({ data: d }) => {
    const dias = Number(d.diasRestantes || 0);
    return filtro === "pendentes" ? dias <= 0 : dias > 0;
  });

  if (!filtrados.length) {
    const p = document.createElement("p");
    p.style.cssText = "color:#666;font-size:13px;margin-top:16px";
    p.textContent = filtro === "pendentes"
      ? "Nenhum pagamento pendente "
      : "Nenhum cliente com pagamento em dia ainda.";
    container.appendChild(p);
    return;
  }

  renderPaginado(container, filtrados, ({ data: d, id: docId }) => {
    criarCardPagamento(d, docId, filtro);
  });
}

function criarCardPagamento(c, docId, filtro) {
  const container = document.getElementById("containerPagamentos");
  const card = document.createElement("div");
  card.className = "card card-pagamento";

  const sNome  = sanitize(c.nome);
  const sId    = sanitize(docId || c.id || "");
  const sFoto  = sanitize(c.foto || "");
  const sPlano = sanitize(c.plano || "—");
  const dias   = Number(c.diasRestantes || 0);

  const tagStatus = filtro === "pendentes"
    ? '<span class="tag-pendente"> Pendente</span>'
    : '<span class="tag-pago"> Pago</span>';

  const diasTexto = sPlano === "Pendente" && dias === 0
    ? "Aguardando 1º pagamento"
    : dias > 0
      ? `${dias} dia${dias > 1 ? "s" : ""} restante${dias > 1 ? "s" : ""}`
      : `Vencido há ${Math.abs(dias)} dia${Math.abs(dias) !== 1 ? "s" : ""}`;

  card.innerHTML = `
    <img src="${sFoto || "https://via.placeholder.com/80"}" style="width:56px;height:56px;border-radius:8px;object-fit:cover;flex-shrink:0;">
    <div class="info" style="flex:1;min-width:0;">
      <h3 style="margin:0 0 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${sNome}</h3>
      <p style="margin:2px 0;font-size:12px;color:#aaa;font-family:monospace;">${sId}</p>
      <p style="margin:4px 0;font-size:13px;"><strong>Plano:</strong> ${sPlano}</p>
      <p style="margin:2px 0;font-size:13px;color:${dias > 0 ? "#4caf50" : "#ff5252"};"><strong>${diasTexto}</strong></p>
      <div style="margin-top:6px;">${tagStatus}</div>
    </div>`;
  container.appendChild(card);
}

/* =========================================
   📅 CONTAGEM AUTOMÁTICA DE DIAS
   Desconta os dias corridos desde a última verificação de cada cliente.
   Funciona mesmo que o painel fique dias sem ser aberto (desconta tudo de
   uma vez, comparando data de hoje com a última data registrada).
========================================= */

function diasCorridosDesde(dataISO) {
  if (!dataISO) return 0;
  const hoje = new Date();
  const hojeUTC = Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());

  const [ano, mes, dia] = dataISO.split("-").map(Number);
  const dataUTC = Date.UTC(ano, mes - 1, dia);

  return Math.floor((hojeUTC - dataUTC) / 86400000);
}

function dataDeHojeISO() {
  const hoje = new Date();
  const ano = hoje.getFullYear();
  const mes = String(hoje.getMonth() + 1).padStart(2, "0");
  const dia = String(hoje.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

// Recebe a lista crua do Firestore, desconta os dias vencidos de cada
// cliente que precisar, persiste as correções em paralelo e retorna a
// lista já com os valores corrigidos (para renderizar na hora, sem esperar
// um segundo round-trip).
async function aplicarContagemDeDiasEmLote(todos) {
  const hojeISO = dataDeHojeISO();
  const atualizacoes = [];

  const corrigidos = todos.map(({ data: c, id }) => {
    if (c.diasRestantes === undefined || c.diasRestantes === null) {
      return { data: c, id };
    }

    const ultimaAtualizacao = c.ultimaAtualizacaoDias || hojeISO;
    const diasPassados = diasCorridosDesde(ultimaAtualizacao);

    if (diasPassados <= 0) {
      if (!c.ultimaAtualizacaoDias) {
        atualizacoes.push(updateDoc(doc(db, "clientes", id), { ultimaAtualizacaoDias: hojeISO }).catch(() => {}));
      }
      return { data: c, id };
    }

    const diasAtuais = Number(c.diasRestantes || 0);
    const novosDias = diasAtuais - diasPassados;
    const novoStatus = novosDias <= 0 ? "inativo" : c.status;

    atualizacoes.push(
      updateDoc(doc(db, "clientes", id), {
        diasRestantes: novosDias,
        ultimaAtualizacaoDias: hojeISO,
        status: novoStatus
      }).catch(() => {})
    );

    return { data: { ...c, diasRestantes: novosDias, ultimaAtualizacaoDias: hojeISO, status: novoStatus }, id };
  });

  if (atualizacoes.length) await Promise.all(atualizacoes);
  return corrigidos;
}

async function carregarClientes() {
  let todos = cache.get("clientes");
  if (!todos) {
    const snap = await getDocs(collection(db, "clientes"));
    todos = snap.docs.map(d => ({ data: d.data(), id: d.id }));
    todos = await aplicarContagemDeDiasEmLote(todos);
    cache.set("clientes", todos);
  }
  return todos;
}


/* =========================================
   🔥 LISTAR / ATIVOS / INATIVOS / TODOS
========================================= */

window.listarClientes = async function(btnId) {
  if (btnId) setActiveBtn(btnId);
  const token = novaView();
  lista.innerHTML = "Carregando...";
  const todos = await carregarClientes();
  if (!viewAtiva(token)) return;
  lista.innerHTML = "";
  paginar(todos, ({ data, id }) => criarCard(data, id));
  restaurarBtnAtivo();
};

window.verAtivos = async function(btnId) {
  if (btnId) setActiveBtn(btnId);
  const token = novaView();
  lista.innerHTML = "Carregando...";
  const todos   = await carregarClientes();
  if (!viewAtiva(token)) return;
  const filtro  = todos.filter(c => c.data.status === "ativo");
  lista.innerHTML = "";
  paginar(filtro, ({ data, id }) => criarCard(data, id));
  restaurarBtnAtivo();
};

window.verInativos = async function(btnId) {
  if (btnId) setActiveBtn(btnId);
  const token = novaView();
  lista.innerHTML = "Carregando...";
  const todos   = await carregarClientes();
  if (!viewAtiva(token)) return;
  const filtro  = todos.filter(c => c.data.status === "inativo");
  lista.innerHTML = "";
  paginar(filtro, ({ data, id }) => criarCard(data, id));
  restaurarBtnAtivo();
};

window.ativar = async function(docId) {
  await assertAdmin();
  await updateDoc(doc(db, "clientes", docId), { status: "ativo" });
  cache.del("clientes");
  recarregarViewAtual();
};

window.inativar = async function(docId) {
  await assertAdmin();
  await updateDoc(doc(db, "clientes", docId), { status: "inativo" });
  cache.del("clientes");
  recarregarViewAtual();
};


/* =========================================
   🔍 BUSCAR — direto pelo UID do documento
========================================= */

function pegarCodigo() {
  // Usa o que o usuário digitou no input; se estiver vazio, cai pro select.
  const uf = (estadoInput.value.trim() || estadoSelect.value.trim()).toUpperCase();
  return uf + "-" + numeros.map(n => n.value).join("");
}

window.buscar = async function(btnId) {
  if (btnId) setActiveBtn(btnId);
  const token = novaView();
  const codigo = pegarCodigo();
  lista.innerHTML = "Buscando...";

  // Busca direta pelo UID — sem varrer coleção inteira
  const snap = await getDoc(doc(db, "clientes", codigo));
  if (!viewAtiva(token)) return;
  lista.innerHTML = "";

  if (snap.exists()) {
    const corrigidos = await aplicarContagemDeDiasEmLote([{ data: snap.data(), id: snap.id }]);
    cache.del("clientes");
    criarCard(corrigidos[0].data, corrigidos[0].id);
  } else {
    lista.innerHTML = "Usuário não encontrado ❌";
  }
  restaurarBtnAtivo();
};


/* =========================================
   🏢 EMPRESAS
========================================= */

window.verEmpresas = async function(btnId) {
  if (btnId) setActiveBtn(btnId);
  const token = novaView();
  lista.innerHTML = "Carregando empresas...";
  fecharPainelConfig();

  try {
    let empresas = cache.get("empresas");
    if (!empresas) {
      const snap = await getDocs(collection(db, "empresas"));
      empresas = snap.docs.map(d => ({ data: d.data(), id: d.id }));
      cache.set("empresas", empresas);
    }
    if (!viewAtiva(token)) return;

    lista.innerHTML = "";

    if (!empresas.length) {
      lista.innerHTML = "Nenhuma empresa encontrada ❗";
      return;
    }

    const topoAcoes = document.createElement("div");
    topoAcoes.style.cssText = "display:flex;justify-content:flex-end;margin-bottom:12px;";
    topoAcoes.innerHTML = `<button class="btn-acao btn-detalhes" onclick="abrirModalWhatsappClube()">WhatsApp do Clube</button>`;
    lista.appendChild(topoAcoes);

    paginar(empresas, ({ data: d, id: eId }) => {
      const tagB = d.ativarBrinde
        ? '<span class="tag-ativo">● Brinde ativo</span>'
        : '<span class="tag-inativo">● Brinde inativo</span>';
      const tagS = d.ativarSorteio
        ? '<span class="tag-ativo">● Sorteio ativo</span>'
        : '<span class="tag-inativo">● Sorteio inativo</span>';

      const card = document.createElement("div");
      card.className = "card";
      card.style.cssText = "display:flex;align-items:flex-start;gap:10px;flex-wrap:nowrap;";
      card.innerHTML = `
        <div class="info" style="flex:1;min-width:0;">
          <h3 style="margin:0 0 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${d.nome || "Empresa sem nome"}</h3>
          <p style="margin:2px 0 4px;color:#aaa;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${d.email || ""}</p>
          <div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap;">${tagB} ${tagS}</div>
          ${d.metaBrinde  ? `<p style="margin:4px 0;font-size:13px"><strong>Meta brinde:</strong> ${d.metaBrinde} compras</p>` : ""}
          ${(d.metaUsosSorteio || d.metaComprasSorteio) ? `<p style="margin:4px 0;font-size:13px"><strong>Usos p/ participar:</strong> ${d.metaUsosSorteio || d.metaComprasSorteio} compras</p>` : ""}
          ${d.metaClientesSorteio ? `<p style="margin:4px 0;font-size:13px"><strong>Meta clientes elegíveis:</strong> ${d.metaClientesSorteio} — ${d.qtdSorteio || 1} ganhador(es)</p>` : ""}
        </div>
        <div class="acao" style="flex-shrink:0;display:flex;flex-direction:column;align-items:stretch;gap:6px;padding-top:2px;">
          <button class="btn-acao btn-config" style="white-space:nowrap;" onclick="abrirConfigEmpresa('${eId}')">⚙ Config</button>
          <button class="btn-acao btn-detalhes" style="white-space:nowrap;" onclick="abrirRastreamentoEmpresa('${eId}')">Rastreio</button>
        </div>`;
      lista.appendChild(card);
    });

  } catch (e) { console.error(e); lista.innerHTML = "Erro ao carregar ❌"; }
  restaurarBtnAtivo();
};


/* =========================================
   ⚙ PAINEL LATERAL CONFIG
========================================= */

function fecharPainelConfig() {
  document.getElementById("painel-config-lateral")?.remove();
}
window.fecharPainelConfig = fecharPainelConfig;

window.abrirConfigEmpresa = async function(eId) {
  fecharPainelConfig();
  let d = {};
  try {
    const snap = await getDoc(doc(db, "empresas", eId));
    if (snap.exists()) d = snap.data();
  } catch (e) { console.warn(e); }

  const painel = document.createElement("div");
  painel.id = "painel-config-lateral";
  painel.innerHTML = `
    <div class="painel-config-overlay" onclick="fecharPainelConfig()"></div>
    <div class="painel-config-box">
      <div class="painel-config-header">
        <h3>⚙ Configuração</h3>
        <span class="painel-config-nome">${d.nome || eId}</span>
        <button class="painel-config-fechar" onclick="fecharPainelConfig()">✕</button>
      </div>
      <div class="painel-config-body">

        <div class="config-secao">
          <div class="config-secao-titulo"> Brinde</div>
          <div class="config-toggle-row">
            <label>Ativar brinde</label>
            <label class="toggle">
              <input type="checkbox" id="cfg-ativarBrinde" ${d.ativarBrinde ? "checked" : ""}>
              <span class="slider"></span>
            </label>
          </div>
          <label>Meta de compras para brinde</label>
          <input type="number" id="cfg-metaBrinde" placeholder="Ex: 10" value="${d.metaBrinde || ""}" min="1"/>
          <small>Quantas compras o cliente precisa para ganhar o brinde.</small>
        </div>

        <div class="config-secao">
          <div class="config-secao-titulo"> Sorteio</div>
          <div class="config-toggle-row">
            <label>Ativar sorteio</label>
            <label class="toggle">
              <input type="checkbox" id="cfg-ativarSorteio" ${d.ativarSorteio ? "checked" : ""}>
              <span class="slider"></span>
            </label>
          </div>

          <label>Meta de compras = usos para participar</label>
          <input type="number" id="cfg-metaUsosSorteio"
            placeholder="Ex: 5"
            value="${d.metaUsosSorteio || d.metaComprasSorteio || ""}" min="1"/>
          <small>Quantas compras o cliente precisa fazer para ser elegível ao sorteio.</small>

          <label>Meta de clientes que bateram a meta de usos</label>
          <input type="number" id="cfg-metaClientesSorteio"
            placeholder="Ex: 10"
            value="${d.metaClientesSorteio || d.metaSorteio || ""}" min="1"/>
          <small>Mínimo de clientes elegíveis para o sorteio ser liberado. O botão "Sortear" só aparece quando essa meta é atingida.</small>

          <label>Quantidade de ganhadores</label>
          <input type="number" id="cfg-qtdSorteio"
            placeholder="Ex: 1"
            value="${d.qtdSorteio || ""}" min="1"/>
          <small>Quantos clientes serão sorteados.</small>
        </div>

      </div>
      <div class="painel-config-footer">
        <button class="btn-acao btn-ativar" onclick="salvarConfigEmpresa('${eId}')"> Salvar configuração</button>
      </div>
    </div>`;

  document.body.appendChild(painel);
  requestAnimationFrame(() => painel.querySelector(".painel-config-box").classList.add("aberto"));
};

window.salvarConfigEmpresa = async function(eId) {
  await assertAdmin();

  const ativarBrinde        = document.getElementById("cfg-ativarBrinde").checked;
  const metaBrinde          = safeInt(document.getElementById("cfg-metaBrinde").value, 0);
  const ativarSorteio       = document.getElementById("cfg-ativarSorteio").checked;
  const metaUsosSorteio     = safeInt(document.getElementById("cfg-metaUsosSorteio").value, 0);
  const metaClientesSorteio = safeInt(document.getElementById("cfg-metaClientesSorteio").value, 0);
  const qtdSorteio          = safeInt(document.getElementById("cfg-qtdSorteio").value, 1) || 1;

  // 🔒 Validações
  if (ativarBrinde && !metaBrinde) {
    alert("Informe a meta de compras para o brinde ❗"); return;
  }
  if (ativarSorteio) {
    if (!metaUsosSorteio)     { alert("Informe os usos necessários para participar do sorteio ❗"); return; }
    if (!metaClientesSorteio) { alert("Informe a meta de clientes elegíveis ❗"); return; }
    if (qtdSorteio > metaClientesSorteio) {
      alert("Ganhadores não pode ser maior que a meta de clientes ❗"); return;
    }
  }

  try {
    // ✅ FIX 2 & 4: Ao salvar config, registrar usos atuais de cada cliente como
    // ponto de início — sorteio e premiação só contam usos A PARTIR daqui.
    // NÃO zera usos, apenas marca o baseline.
    const snapCli = await getDocs(query(
      collection(db, "clientesEmpresa"),
      where("empresa", "==", eId)
    ));

    const batchUpdates = snapCli.docs.map(cliDoc => {
      const usosAtuais = Number(cliDoc.data().usos || 0);
      const upd = {};
      // Sorteio: marca início se está ativando sorteio
      if (ativarSorteio) {
        upd.inicioSorteio = usosAtuais;
        // Reseta ciclosSorteio para alinhar com novo início
        upd.ciclosSorteio = 0;
      }
      // Brinde: marca início se está ativando brinde
      if (ativarBrinde) {
        upd.inicioPremiacao = usosAtuais;
        // Reseta ciclosBrinde para alinhar com novo início
        upd.ciclosBrinde = 0;
      }
      if (Object.keys(upd).length === 0) return Promise.resolve();
      return updateDoc(doc(db, "clientesEmpresa", cliDoc.id), upd);
    });
    await Promise.all(batchUpdates);

    await setDoc(doc(db, "empresas", eId), {
      ativarBrinde,
      metaBrinde,
      ativarSorteio,
      metaUsosSorteio,          // usos por cliente para ser elegível
      metaClientesSorteio,      // clientes que precisam bater a meta
      qtdSorteio,
      // mantém campos legados para retrocompatibilidade
      metaSorteio: metaClientesSorteio,
      metaComprasSorteio: metaUsosSorteio
    }, { merge: true });
    cache.del("empresas");
    alert("Configuração salva ✅");
    fecharPainelConfig();
    verEmpresas();
  } catch (e) { console.error(e); alert("Erro ao salvar ❌"); }
};


/* =========================================
   📡 RASTREAMENTO — QR Code + Leads por empresa
   Modelo: 1 número de WhatsApp do CLUBE (geral, não por
   empresa). Cada empresa só tem um QR Code que pode ser
   ativado/desativado, e um nome de exibição (com acento)
   pra mostrar bonito na página pública do lead.
========================================= */

// Pequeno helper porque IDs de empresa podem ter caracteres especiais
function cssEscape(str) {
  return String(str).replace(/[^a-zA-Z0-9_-]/g, "_");
}

// Base da URL pública que o QR Code aponta. Usa o domínio atual do painel,
// então funciona tanto em produção quanto em testes locais sem precisar
// hardcodar um domínio fixo.
function urlLeadEmpresa(eId) {
  const base = window.location.origin + window.location.pathname.replace(/admin\.html$/, "");
  return `${base}lead.html?e=${encodeURIComponent(eId)}`;
}

let _rastreioEIdAtual = null;

/* ---------- WhatsApp do Clube (configuração geral, 1 número só) ---------- */

window.abrirModalWhatsappClube = async function() {
  await assertAdmin();
  const modal = document.getElementById("modalWhatsappClube");
  modal.classList.remove("hidden");

  const input = document.getElementById("whatsapp-clube-input");
  input.value = "Carregando...";
  input.disabled = true;

  try {
    const snap = await getDoc(doc(db, "configuracoes", "geral"));
    input.value = snap.exists() ? (snap.data().whatsappClube || "") : "";
  } catch (e) {
    console.error(e);
    input.value = "";
  }
  input.disabled = false;
};

window.fecharModalWhatsappClube = function() {
  document.getElementById("modalWhatsappClube").classList.add("hidden");
};

window.salvarWhatsappClube = async function() {
  await assertAdmin();
  const input = document.getElementById("whatsapp-clube-input");
  const numero = input.value.replace(/\D/g, "");

  if (!numero || numero.length < 10) {
    alert("Digite um número de WhatsApp válido, com DDI+DDD (ex: 5599999999999) ❗");
    return;
  }

  await setDoc(doc(db, "configuracoes", "geral"), { whatsappClube: numero }, { merge: true });
  alert("WhatsApp do Clube salvo ✅\n\nEsse número vai receber os leads de TODAS as empresas.");
  fecharModalWhatsappClube();
};

/* ---------- Modal individual de Rastreamento (por empresa) ---------- */

window.abrirRastreamentoEmpresa = async function(eId) {
  await assertAdmin();
  _rastreioEIdAtual = eId;

  const modal = document.getElementById("modalRastreamento");
  modal.classList.remove("hidden");
  document.getElementById("conteudoRastreamento").innerHTML = "Carregando...";

  await renderizarModalRastreamento(eId);
};

window.fecharModalRastreamento = function() {
  document.getElementById("modalRastreamento").classList.add("hidden");
  _rastreioEIdAtual = null;
};

async function renderizarModalRastreamento(eId) {
  const snap = await getDoc(doc(db, "empresas", eId));
  if (!snap.exists()) {
    document.getElementById("conteudoRastreamento").innerHTML = "<p>Empresa não encontrada ❌</p>";
    return;
  }
  const d = snap.data();

  const nomeBase = d.nome || eId;
  const nomeExibicao = d.nomeExibicao || nomeBase;
  const ativo = !!d.rastreamentoAtivo;
  const url = urlLeadEmpresa(eId);

  document.getElementById("conteudoRastreamento").innerHTML = `
    <div class="form-gerar">

      <div class="rastreio-status-linha">
        <span>Rastreamento desta empresa:</span>
        <label class="toggle-switch">
          <input type="checkbox" id="rastreio-toggle-ativo" ${ativo ? "checked" : ""} onchange="alternarRastreamentoEmpresa('${eId}', this.checked)">
          <span class="toggle-slider"></span>
        </label>
        <span id="rastreio-status-texto" style="color:${ativo ? '#4caf50' : '#ff5252'};font-weight:700;font-size:12.5px;">${ativo ? "Ativo" : "Inativo"}</span>
      </div>
      <small style="color:#666;font-size:11px;display:block;margin:-4px 0 14px;">Quando inativo, o QR Code continua existindo, mas quem escanear vê um aviso de que não está disponível.</small>

      <div class="form-grupo">
        <label>Nome de exibição (com acento, como deve aparecer pro lead)</label>
        <input type="text" id="rastreio-nome-exibicao" placeholder="Ex: Academia da Val" value="${sanitize(nomeExibicao)}" maxlength="80">
        <small style="color:#666;font-size:11px;display:block;margin-top:6px;">O nome do cadastro (${sanitize(nomeBase)}) vem do e-mail e não tem acento — use este campo pra mostrar o nome certo na página do lead.</small>
        <button class="btn-acao btn-detalhes" style="margin-top:10px;width:100%;" onclick="salvarNomeExibicaoEmpresa('${eId}')">Salvar nome de exibição</button>
      </div>

    </div>

    <div class="linha" style="margin:18px 0;"></div>

    <div class="rastreio-qr-centro">
      <div class="rastreio-qr-wrap">
        <canvas id="qr-${cssEscape(eId)}" width="190" height="190"></canvas>
      </div>

      <div class="rastreio-link-linha">
        <input type="text" readonly value="${sanitize(url)}" onclick="this.select()">
        <button class="btn-acao btn-detalhes" onclick="copiarLinkRastreamento('${eId}')">Copiar</button>
      </div>

      <div class="rastreio-acoes">
        <button class="btn-acao btn-ativar" onclick="baixarQRCode('${eId}','${sanitize(nomeExibicao).replace(/'/g, "\\'")}')">⬇ Baixar QR Code</button>
        <button class="btn-acao btn-detalhes" onclick="verLeadsEmpresa('${eId}','${sanitize(nomeExibicao).replace(/'/g, "\\'")}')">Ver leads</button>
      </div>
    </div>
  `;

  // Gera o QR Code no canvas recém-criado (a lib precisa do elemento já no DOM)
  const canvas = document.querySelector(`#qr-${cssEscape(eId)}`);
  if (canvas && window.QRCode) {
    QRCode.toCanvas(canvas, url, { width: 190, margin: 1, color: { dark: "#000000", light: "#ffffff" } }, (err) => {
      if (err) console.error("Erro ao gerar QR Code:", err);
    });
  }
}

window.alternarRastreamentoEmpresa = async function(eId, ativo) {
  await assertAdmin();
  await setDoc(doc(db, "empresas", eId), { rastreamentoAtivo: ativo }, { merge: true });
  cache.del("empresas");

  const texto = document.getElementById("rastreio-status-texto");
  if (texto) {
    texto.textContent = ativo ? "Ativo" : "Inativo";
    texto.style.color = ativo ? "#4caf50" : "#ff5252";
  }
};

window.salvarNomeExibicaoEmpresa = async function(eId) {
  await assertAdmin();
  const input = document.getElementById("rastreio-nome-exibicao");
  const nome = input.value.trim();

  if (!nome) { alert("Digite um nome de exibição ❗"); return; }

  await setDoc(doc(db, "empresas", eId), { nomeExibicao: nome }, { merge: true });
  cache.del("empresas");
  alert("Nome de exibição salvo ✅");
};

window.copiarLinkRastreamento = async function(eId) {
  const url = urlLeadEmpresa(eId);
  try {
    await navigator.clipboard.writeText(url);
    alert("Link copiado ✅");
  } catch (_) {
    alert(`Copie manualmente:\n\n${url}`);
  }
};

window.baixarQRCode = function(eId, nomeEmpresa) {
  const canvas = document.querySelector(`#qr-${cssEscape(eId)}`);
  if (!canvas) { alert("QR Code ainda não carregou, aguarde um instante ❗"); return; }

  const link = document.createElement("a");
  const nomeArquivo = (nomeEmpresa || eId).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase();
  link.download = `qrcode-${nomeArquivo || eId}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
};

/* =========================================
   📡 LEADS DE UMA EMPRESA
========================================= */

window.verLeadsEmpresa = async function(eId, nomeEmpresa) {
  fecharModalRastreamento();
  lista.innerHTML = "Carregando leads...";
  fecharPainelConfig();

  try {
    const snap = await getDocs(query(collection(db, "leads"), where("empresa", "==", eId)));

    lista.innerHTML = "";

    const voltar = document.createElement("button");
    voltar.className = "btn-voltar-inline";
    voltar.textContent = "← Voltar";
    voltar.onclick = () => verEmpresas("btn-empresas");
    lista.appendChild(voltar);

    const titulo = document.createElement("p");
    titulo.className = "secao-titulo";
    titulo.textContent = ` Leads de ${sanitize(nomeEmpresa || eId)}`;
    lista.appendChild(titulo);

    let leads = snap.docs.map(d => d.data());
    // Ordena do mais recente para o mais antigo
    leads.sort((a, b) => {
      const ta = a.criadoEm?.seconds || 0;
      const tb = b.criadoEm?.seconds || 0;
      return tb - ta;
    });

    if (!leads.length) {
      const p = document.createElement("p");
      p.style.cssText = "color:#666;font-size:13px;margin-top:16px";
      p.textContent = "Nenhum lead capturado por essa empresa ainda.";
      lista.appendChild(p);
      return;
    }

    const contagem = document.createElement("p");
    contagem.style.cssText = "color:#888;font-size:12.5px;margin:-6px 0 14px;";
    contagem.textContent = `${leads.length} lead${leads.length > 1 ? "s" : ""} capturado${leads.length > 1 ? "s" : ""}`;
    lista.appendChild(contagem);

    renderPaginado(lista, leads, (l) => {
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <div class="info">
          <h3 style="margin:0 0 4px;">${sanitize(l.nome)}</h3>
          <p style="color:rgba(255,215,0,0.6);font-size:11px;margin-top:4px;"> ${sanitize(l.data || "--")} às ${sanitize(l.hora || "--")}</p>
        </div>`;
      lista.appendChild(card);
    });

  } catch (e) { console.error(e); lista.innerHTML = "Erro ao carregar leads ❌"; }
};


/* =========================================
   🏆 PREMIAÇÕES
   clientesEmpresa com premiacaoPendente=true
========================================= */


/* =========================================
   🏆 PREMIAÇÕES
========================================= */

window.verPremiacoes = async function(btnId) {
  if (btnId) setActiveBtn(btnId);
  const token = novaView();
  lista.innerHTML = "Carregando premiações...";
  fecharPainelConfig();

  try {
    if (!viewAtiva(token)) return;
    lista.innerHTML = "";

    // ── Botão histórico completo
    const btnHist = document.createElement("button");
    btnHist.className = "btn-historico-topo";
    btnHist.textContent = "Histórico de premiações";
    btnHist.onclick = () => verHistoricoPromocoes("premiacao");
    lista.appendChild(btnHist);

    // ── Busca clientes e empresas em paralelo (histórico não é mais necessário aqui)
    const [snapClientes, snapEmpresas] = await Promise.all([
      getDocs(collection(db, "clientesEmpresa")),
      getDocs(collection(db, "empresas"))
    ]);
    if (!viewAtiva(token)) return;

    // Mapa empresaId → metaBrinde
    const metaMap = {};
    snapEmpresas.docs.forEach(d => {
      metaMap[d.id] = Number(d.data().metaBrinde || 0);
    });

    // ════════════════════════════════════════
    //  CLIENTES COM BRINDES PENDENTES
    //  Lógica acumulativa: Math.floor(usos/meta) > ciclosBrinde
    //  Não zera usos — a cada +meta compras ganha mais um brinde
    // ════════════════════════════════════════
    const tPend = document.createElement("p");
    tPend.className = "secao-titulo";
    tPend.style.marginTop = "8px";
    lista.appendChild(tPend);

    // Filtra clientes com brindes pendentes usando ciclosBrinde
    // ✅ FIX 4: conta apenas usos APÓS inicioPremiacao (salvo ao configurar)
    const pendentes = snapClientes.docs
      .map(d => ({ docId: d.id, ...d.data() }))
      .filter(d => {
        const meta = metaMap[d.empresa];
        if (!meta || meta <= 0) return false;
        const usos           = Number(d.usos || 0);
        const inicioPremiacao = Number(d.inicioPremiacao ?? 0);
        const usosDesdeInicio = Math.max(0, usos - inicioPremiacao);
        const ciclosBrinde   = Number(d.ciclosBrinde || 0);
        return Math.floor(usosDesdeInicio / meta) > ciclosBrinde;
      });

    if (!pendentes.length) {
      tPend.textContent = " Clientes aguardando premiação";
      const pp = document.createElement("p");
      pp.style.cssText = "color:#666;font-size:13px;margin-top:8px";
      pp.textContent = "Nenhum cliente aguardando premiação.";
      lista.appendChild(pp);
      return;
    }

    tPend.textContent = ` Clientes com brinde pendente (${pendentes.length} cliente${pendentes.length > 1 ? "s" : ""})`;

    renderPaginado(lista, pendentes, d => {
      const meta            = metaMap[d.empresa] || 1;
      const usos            = Number(d.usos || 0);
      const inicioPremiacao = Number(d.inicioPremiacao ?? 0);
      const usosDesdeInicio = Math.max(0, usos - inicioPremiacao);
      const ciclosBrinde    = Number(d.ciclosBrinde || 0);
      const brindesPend     = Math.floor(usosDesdeInicio / meta) - ciclosBrinde;

      const card = document.createElement("div");
      card.className = "card card-premiacao";
      card.id = `pend-${d.docId}`;
      card.style.borderLeft = "3px solid #ff9800";

      const nEmp   = sanitize(d.empresaNome || d.empresa || "");
      const nCli   = sanitize(d.nome || d.clienteId);
      const sId    = sanitize(d.clienteId || "");
      const sDocId = sanitize(d.docId);
      const sEId   = sanitize(d.empresa || "");
      const horaAt = d.ultimaData && d.ultimaHora ? `${d.ultimaData} às ${d.ultimaHora}` : "--";

      card.innerHTML = `
        <div class="info" style="flex:1">
          <p style="font-size:11px;color:#ff9800;font-weight:600;margin-bottom:4px">⚠ Cliente atingiu os requisitos</p>
          <h3>${nCli}</h3>
          <p style="margin:3px 0"><strong>Empresa:</strong> ${nEmp}</p>
          <p style="margin:3px 0;font-size:12px;color:#aaa"><strong>ID:</strong> ${sId}</p>
          <p style="margin:3px 0;font-size:12px"><strong>Compras totais:</strong> ${usos} &nbsp;|&nbsp; <strong>Brindes pendentes:</strong> ${brindesPend}</p>
          <p style="color:rgba(255,152,0,0.6);font-size:11px;margin-top:6px"> Última compra: ${horaAt}</p>
        </div>
        <div class="acao">
          <button class="btn-acao btn-ativar"
            onclick="confirmarPremiacao('${sDocId}','${sEId}','${sId}','${nEmp}','${nCli}')">
             OK
          </button>
        </div>`;
      lista.appendChild(card);
    });

  } catch (e) { console.error(e); lista.innerHTML = "Erro ao carregar ❌"; }
  restaurarBtnAtivo();
};

window.verParticipantesPremiacao = async function(eId, nomeEmpresa) {
  lista.innerHTML = "Carregando...";
  try {
    const snap = await getDocs(query(
      collection(db, "clientesEmpresa"),
      where("empresa",           "==", eId),
      where("premiacaoPendente", "==", true)
    ));

    lista.innerHTML = "";

    const voltar = document.createElement("button");
    voltar.className = "btn-voltar-inline";
    voltar.textContent = "← Voltar";
    voltar.onclick = verPremiacoes;
    lista.appendChild(voltar);

    const t = document.createElement("p");
    t.className = "secao-titulo";
    t.textContent = ` ${nomeEmpresa} — participantes`;
    lista.appendChild(t);

    if (snap.empty) {
      const p = document.createElement("p");
      p.style.cssText = "color:#666;font-size:13px";
      p.textContent = "Nenhum participante.";
      lista.appendChild(p);
      return;
    }

    const clientes = snap.docs.map(d => ({ data: d.data(), id: d.id }));

    renderPaginado(lista, clientes, ({ data: d, id: docId }) => {
      const nEmp  = (d.empresaNome || d.empresa || "").replace(/'/g, "");
      const nCli  = (d.nome        || d.clienteId || "").replace(/'/g, "");
      const card  = document.createElement("div");
      card.className = "card card-premiacao";
      card.id = `pend-${docId}`;
      card.innerHTML = `
        <div class="info" style="flex:1">
          <h3>${d.nome || d.clienteId}</h3>
          <p><strong>ID:</strong> ${d.clienteId}</p>
          <p><strong>Compras:</strong> ${d.usos || 0}</p>
          <span class="badge-premiacao"> Premiação pendente</span>
        </div>
        <div class="acao">
          <button class="btn-acao btn-ativar"
            onclick="confirmarPremiacao('${docId}','${eId.replace(/'/g,"")}','${(d.clienteId||"").replace(/'/g,"")}','${nEmp}','${nCli}')">
             OK
          </button>
        </div>`;
      lista.appendChild(card);
    });
  } catch (e) { console.error(e); lista.innerHTML = "Erro ❌"; }
};

window.confirmarPremiacao = async function(docId, eId, clienteId, nomeEmpresa, nomeCliente) {
  await assertAdmin();
  if (!confirm(`Confirmar premiação para ${nomeCliente}?`)) return;
  const { data, hora } = agora();
  try {
    // ✅ FIX 4: Calcula novoCiclo com base nos usos APÓS inicioPremiacao
    const cliSnap  = await getDoc(doc(db, "clientesEmpresa", docId));
    const cliData  = cliSnap.exists() ? cliSnap.data() : {};
    const empSnap  = await getDoc(doc(db, "empresas", eId));
    const meta            = Number(empSnap.exists() ? empSnap.data().metaBrinde : 0) || 1;
    const usos            = Number(cliData.usos || 0);
    const inicioPremiacao = Number(cliData.inicioPremiacao ?? 0);
    const usosDesdeInicio = Math.max(0, usos - inicioPremiacao);
    // Avança ciclosBrinde contado desde inicioPremiacao
    const novoCiclo = Math.floor(usosDesdeInicio / meta);

    await updateDoc(doc(db, "clientesEmpresa", docId), {
      ciclosBrinde: novoCiclo,
      premiacaoPendente: false   // mantido por retrocompatibilidade
    });
    await addDoc(collection(db, "historicoPromocoes"), {
      tipo: "premiacao", empresa: eId, nomeEmpresa,
      clienteId, nomeCliente, data, hora, timestamp: Date.now()
    });
    document.getElementById(`pend-${docId}`)?.remove();
    alert("Premiação confirmada ✅");
  } catch (e) { console.error(e); alert("Erro ❌"); }
};


/* =========================================
   🎰 SORTEIOS
========================================= */

window.verSorteios = async function(btnId) {
  if (btnId) setActiveBtn(btnId);
  const token = novaView();
  lista.innerHTML = "Carregando sorteios...";
  fecharPainelConfig();

  try {
    if (!viewAtiva(token)) return;
    lista.innerHTML = "";

    // ── Botão histórico completo
    const btnHist = document.createElement("button");
    btnHist.className = "btn-historico-topo";
    btnHist.textContent = "Histórico de sorteios";
    btnHist.onclick = () => verHistoricoPromocoes("sorteio");
    lista.appendChild(btnHist);

    // ── Busca apenas empresas com sorteio ativo
    const snapEmpresas = await getDocs(query(collection(db, "empresas"), where("ativarSorteio", "==", true)));
    if (!viewAtiva(token)) return;

    if (snapEmpresas.empty) {
      const p = document.createElement("p");
      p.style.cssText = "color:#666;margin-top:24px;font-size:13px";
      p.textContent = "Nenhuma empresa com sorteio ativo.";
      lista.appendChild(p);
      return;
    }

    const titulo = document.createElement("p");
    titulo.className = "secao-titulo";
    titulo.style.marginTop = "24px";
    lista.appendChild(titulo);

    let algum = false;
    const cards = [];

    for (const eDoc of snapEmpresas.docs) {
      const emp          = eDoc.data();
      const eId          = eDoc.id;
      const metaCompras  = Number(emp.metaUsosSorteio || emp.metaComprasSorteio || emp.metaSorteio || 0);
      const metaClientes = Number(emp.metaClientesSorteio || emp.metaSorteio || 0);
      const qtd          = Number(emp.qtdSorteio || 1);
      if (!metaCompras) continue;

      const snapCli = await getDocs(query(
        collection(db, "clientesEmpresa"),
        where("empresa", "==", eId)
      ));
      if (!viewAtiva(token)) return;
      // ✅ FIX 2: conta usos APENAS após inicioSorteio (salvo ao configurar)
      const total  = snapCli.docs.filter(d => {
        const usos          = Number(d.data().usos || 0);
        const inicioSorteio = Number(d.data().inicioSorteio ?? 0);
        const usosDesde     = Math.max(0, usos - inicioSorteio);
        const ciclo         = Number(d.data().ciclosSorteio || 0);
        return Math.floor(usosDesde / metaCompras) > ciclo;
      }).length;
      const pronto = total >= metaClientes;

      algum = true;
      cards.push({ emp, eId, total, metaCompras, metaClientes, qtd, pronto });
    }

    titulo.textContent = algum
      ? ` Sorteios ativos (${cards.length} empresa${cards.length > 1 ? "s" : ""})`
      : "Nenhuma empresa configurada para sorteio.";

    paginar(cards, ({ emp, eId, total, metaCompras, metaClientes, qtd, pronto }) => {
      const pct     = metaClientes ? Math.min(100, Math.round((total / metaClientes) * 100)) : 0;
      const nomeEmp = sanitize(emp.nome || eId);

      const card = document.createElement("div");
      card.className = `card ${pronto ? "card-sorteio" : ""}`;
      card.innerHTML = `
        <div class="info" style="flex:1">
          <h3>${sanitize(emp.nome || eId)}</h3>
          <p style="margin:3px 0"><strong>Compras p/ participar:</strong> ${metaCompras}</p>
          <p style="margin:3px 0"><strong>Clientes elegíveis:</strong> ${total} de ${metaClientes}</p>
          <p style="margin:3px 0"><strong>Ganhadores:</strong> ${qtd}</p>
          <div class="progresso-wrap">
            <div class="progresso-label">${pronto ? "✦ Pronto para sortear" : `${pct}% — aguardando clientes`}</div>
            <div class="progresso-bar"><div class="progresso-fill" style="width:${pct}%"></div></div>
          </div>
        </div>
        <div class="acao" style="flex-direction:column;gap:8px;align-items:flex-end">
          <button class="btn-config"
            onclick="verParticipantesSorteio('${sanitize(eId)}','${nomeEmp}',${metaCompras})">
            Ver participantes
          </button>
          ${pronto
            ? `<button class="btn-acao btn-ativar"
                onclick="realizarSorteio('${sanitize(eId)}','${nomeEmp}',${qtd},${metaCompras})">
                 Sortear
              </button>`
            : ""}
        </div>`;
      lista.appendChild(card);
    });

  } catch (e) { console.error(e); lista.innerHTML = "Erro ao carregar ❌"; }
  restaurarBtnAtivo();
};

window.verParticipantesSorteio = async function(eId, nomeEmpresa, metaCompras) {
  lista.innerHTML = "Carregando...";
  try {
    const snap = await getDocs(query(
      collection(db, "clientesEmpresa"),
      where("empresa", "==", eId)
    ));
    // ✅ FIX 2: elegível apenas por usos após inicioSorteio
    const elegiveis = snap.docs
      .map(d => d.data())
      .filter(d => {
        const usos          = Number(d.usos || 0);
        const inicioSorteio = Number(d.inicioSorteio ?? 0);
        const usosDesde     = Math.max(0, usos - inicioSorteio);
        const ciclo         = Number(d.ciclosSorteio || 0);
        return Math.floor(usosDesde / metaCompras) > ciclo;
      });

    lista.innerHTML = "";
    const voltar = document.createElement("button");
    voltar.className = "btn-voltar-inline";
    voltar.textContent = "← Voltar";
    voltar.onclick = verSorteios;
    lista.appendChild(voltar);

    const t = document.createElement("p");
    t.className = "secao-titulo";
    t.textContent = ` ${nomeEmpresa} — participantes elegíveis`;
    lista.appendChild(t);

    if (!elegiveis.length) {
      const p = document.createElement("p");
      p.style.cssText = "color:#666;font-size:13px";
      p.textContent = "Nenhum participante atingiu a meta ainda.";
      lista.appendChild(p);
      return;
    }

    renderPaginado(lista, elegiveis, (d) => {
      const card = document.createElement("div");
      card.className = "card";
      const _usos         = Number(d.usos || 0);
      const _inicio       = Number(d.inicioSorteio ?? 0);
      const _usosDesde    = Math.max(0, _usos - _inicio);
      const _ciclo        = Number(d.ciclosSorteio || 0);
      const _participacoes = Math.floor(_usosDesde / metaCompras) - _ciclo;
      card.innerHTML = `
        <div class="info">
          <h3>${sanitize(d.nome || d.clienteId)}</h3>
          <p><strong>ID:</strong> ${sanitize(d.clienteId)}</p>
          <p><strong>Compras totais:</strong> ${_usos}</p>
          <p><strong>Compras desde configuração:</strong> ${_usosDesde}</p>
          <p><strong>Participações disponíveis:</strong> ${_participacoes}</p>
          <span class="tag-ativo">✦ Elegível</span>
        </div>`;
      lista.appendChild(card);
    });
  } catch (e) { console.error(e); lista.innerHTML = "Erro ❌"; }
};

window.realizarSorteio = async function(eId, nomeEmpresa, qtdGanhadores, metaCompras) {
  await assertAdmin();
  if (!confirm(`Realizar sorteio para ${nomeEmpresa}?\n${qtdGanhadores} ganhador(es).`)) return;
  try {
    const snap = await getDocs(query(
      collection(db, "clientesEmpresa"),
      where("empresa", "==", eId)
    ));
    // ✅ FIX 2: elegível apenas por usos APÓS inicioSorteio
    const elegiveis = snap.docs
      .map(d => ({ id: d.id, data: d.data() }))
      .filter(e => {
        const usos          = Number(e.data.usos || 0);
        const inicioSorteio = Number(e.data.inicioSorteio ?? 0);
        const usosDesde     = Math.max(0, usos - inicioSorteio);
        const ciclo         = Number(e.data.ciclosSorteio || 0);
        return Math.floor(usosDesde / metaCompras) > ciclo;
      });

    if (!elegiveis.length) { alert("Nenhum cliente elegível ❗"); return; }

    const ganhadores = elegiveis.sort(() => Math.random() - 0.5).slice(0, qtdGanhadores);
    const nomes      = ganhadores.map(g => g.data.nome || g.data.clienteId);
    const ids        = ganhadores.map(g => g.data.clienteId);

    if (!confirm(`Ganhadores:\n${nomes.join("\n")}\n\nConfirmar sorteio?`)) return;

    const { data, hora } = agora();

    // ✅ FIX 2: Não zera usos — avança ciclosSorteio com base nos usos desde inicioSorteio.
    // ✅ FIX 3: Atualiza TODOS os elegíveis (não só ganhadores) para remover o aviso
    //           "Realizar sorteio" de todos os painéis (ADM principal e ADM empresa).
    await Promise.all(
      elegiveis.map(e => {
        const usos          = Number(e.data.usos || 0);
        const inicioSorteio = Number(e.data.inicioSorteio ?? 0);
        const usosDesde     = Math.max(0, usos - inicioSorteio);
        return updateDoc(doc(db, "clientesEmpresa", e.id), {
          ciclosSorteio:     Math.floor(usosDesde / metaCompras),
          participouSorteio: true   // ✅ FIX 3: garante compatibilidade com script.js
        });
      })
    );
    await addDoc(collection(db, "historicoPromocoes"), {
      tipo: "sorteio", empresa: eId, nomeEmpresa,
      ganhadores: nomes, idsGanhadores: ids,
      data, hora, timestamp: Date.now()
    });

    alert(`Sorteio realizado ✅\n\nGanhadores:\n${nomes.join("\n")}`);
    verSorteios();
  } catch (e) { console.error(e); alert("Erro ao realizar sorteio ❌"); }
};


/* =========================================
   📋 HISTÓRICO — premiação ou sorteio
========================================= */

window.verHistoricoPromocoes = async function(tipo) {
  lista.innerHTML = "Carregando histórico...";
  const titulo = tipo === "sorteio" ? "Histórico de Sorteios" : "Histórico de Premiações";

  try {
    // ⚠️ orderBy+where composto exige índice no Firestore — buscamos tudo e filtramos no cliente
    const snapAll = await getDocs(collection(db, "historicoPromocoes"));

    // Filtra e ordena no cliente para evitar erro de índice
    const registros = snapAll.docs
      .map(d => d.data())
      .filter(d => d.tipo === tipo)
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .slice(0, 200);

    lista.innerHTML = "";

    const voltar = document.createElement("button");
    voltar.className = "btn-voltar-inline";
    voltar.textContent = "← Voltar";
    voltar.onclick = tipo === "sorteio" ? verSorteios : verPremiacoes;
    lista.appendChild(voltar);

    const t = document.createElement("p");
    t.className = "secao-titulo";
    t.textContent = ` ${titulo}`;
    lista.appendChild(t);

    if (!registros.length) {
      const p = document.createElement("p");
      p.style.cssText = "color:#666;font-size:13px;margin-top:16px";
      p.textContent = "Nenhum registro encontrado.";
      lista.appendChild(p);
      return;
    }

    renderPaginado(lista, registros, (h) => {
      const card = document.createElement("div");
      card.className = "card";

      if (tipo === "sorteio") {
        const nomes = (h.ganhadores || []).map(n => sanitize(n)).join(", ");
        const ids   = (h.idsGanhadores || []).map(i => sanitize(i)).join(", ");
        card.innerHTML = `
          <div class="info">
            <h3> ${sanitize(h.nomeEmpresa || h.empresa)}</h3>
            <p style="margin:4px 0"><strong>Ganhadores:</strong> ${nomes || "—"}</p>
            ${ids ? `<p style="margin:4px 0;font-size:12px;color:#aaa"><strong>IDs:</strong> ${ids}</p>` : ""}
            <p style="color:rgba(255,215,0,0.5);font-size:11px;margin-top:8px"> ${sanitize(h.data || "--")} às ${sanitize(h.hora || "--")}</p>
          </div>`;
      } else {
        card.innerHTML = `
          <div class="info">
            <h3> ${sanitize(h.nomeCliente || h.clienteId)}</h3>
            <p style="margin:4px 0"><strong>Empresa:</strong> ${sanitize(h.nomeEmpresa || h.empresa)}</p>
            <p style="margin:4px 0"><strong>ID:</strong> ${sanitize(h.clienteId || "—")}</p>
            <p style="color:rgba(255,215,0,0.5);font-size:11px;margin-top:8px"> ${sanitize(h.data || "--")} às ${sanitize(h.hora || "--")}</p>
          </div>`;
      }

      lista.appendChild(card);
    });
  } catch (e) { console.error("Histórico erro:", e); lista.innerHTML = "Erro ao carregar ❌ — verifique o console."; }
};

window.verValidacoes = async function(btnId) {
  if (btnId) setActiveBtn(btnId);
  const token = novaView();
  lista.innerHTML = "Carregando...";
  fecharPainelConfig();

  try {
    const snap = await getDocs(
      query(collection(db, "clientesEmpresa"), orderBy("ultimaValidacao", "desc"))
    );
    if (!viewAtiva(token)) return;

    if (snap.empty) { lista.innerHTML = "Nenhuma validação encontrada ❗"; return; }

    const mapa = {};
    snap.forEach((docu) => {
      const d = docu.data();
      if (!mapa[d.empresa]) {
        mapa[d.empresa] = {
          empresa: d.empresa,
          nomeEmpresa: d.empresaNome || d.nomeEmpresa || "Empresa",
          total: 0, usos: 0, clientes: 0,
          ultimaValidacao: d.ultimaValidacao || 0,
          ultimaData: d.ultimaData || "--",
          ultimaHora: d.ultimaHora || "--"
        };
      }
      mapa[d.empresa].total    += Number(d.totalGasto || 0);
      mapa[d.empresa].usos     += Number(d.usos || 0);
      mapa[d.empresa].clientes++;
      if (Number(d.ultimaValidacao || 0) > mapa[d.empresa].ultimaValidacao) {
        mapa[d.empresa].ultimaValidacao = d.ultimaValidacao;
        mapa[d.empresa].ultimaData      = d.ultimaData || "--";
        mapa[d.empresa].ultimaHora      = d.ultimaHora || "--";
      }
    });

    const empresas = Object.values(mapa).sort((a, b) => b.ultimaValidacao - a.ultimaValidacao);
    lista.innerHTML = "";

    paginar(empresas, (e) => {
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <div class="info">
          <h3>${e.nomeEmpresa}</h3>
          <p><strong>Total vendido:</strong> ${moeda(e.total)}</p>
          <p><strong>Usos:</strong> ${e.usos}</p>
          <p><strong>Clientes:</strong> ${e.clientes}</p>
          <p><strong>Última:</strong> ${e.ultimaData} ${e.ultimaHora}</p>
        </div>
        <div class="acao">
          <button class="btn-acao btn-ativar" onclick="verEmpresa('${e.empresa}')">Abrir</button>
        </div>`;
      lista.appendChild(card);
    });

  } catch (e) { console.error(e); lista.innerHTML = "Erro ao carregar ❌"; }
  restaurarBtnAtivo();
};


/* =========================================
   🔥 CLIENTES DE UMA EMPRESA (validações)
========================================= */

window.verEmpresa = async function(eId) {
  lista.innerHTML = "Carregando clientes...";
  fecharPainelConfig();

  try {
    const snap = await getDocs(query(
      collection(db, "clientesEmpresa"),
      where("empresa", "==", eId),
      orderBy("ultimaValidacao", "desc")
    ));

    lista.innerHTML = "";

    // Botão voltar
    const voltar = document.createElement("button");
    voltar.className = "btn-voltar-inline";
    voltar.textContent = "← Voltar";
    voltar.onclick = verValidacoes;
    lista.appendChild(voltar);

    if (snap.empty) {
      const p = document.createElement("p");
      p.textContent = "Nenhum cliente encontrado ❗";
      lista.appendChild(p);
      return;
    }

    const clientes = snap.docs.map(d => ({ data: d.data(), id: d.id }));

    renderPaginado(lista, clientes, ({ data: d }) => {
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <img src="${d.foto || "https://via.placeholder.com/80"}">
        <div class="info">
          <h3>${d.nome || d.clienteId}</h3>
          <p>${d.clienteId}</p>
          <p><strong>Total:</strong> ${moeda(d.totalGasto || 0)}</p>
          <p><strong>Usos:</strong> ${d.usos || 0}</p>
          ${d.premiacaoPendente ? '<span class="badge-premiacao"> Premiação pendente</span>' : ""}
          <p>${d.ultimaData || "--"} ${d.ultimaHora || "--"}</p>
        </div>
        <div class="acao">
          <button class="btn-acao btn-ativar"
            onclick="verDetalhesCliente('${eId}','${d.clienteId}')">
            Detalhes
          </button>
        </div>`;
      lista.appendChild(card);
    });

  } catch (e) { console.error(e); lista.innerHTML = "Erro ao carregar ❌"; }
};


/* =========================================
   🔥 HISTÓRICO DO CLIENTE
========================================= */

window.verDetalhesCliente = async function(eId, clienteId) {
  lista.innerHTML = "Carregando histórico...";
  fecharPainelConfig();

  try {
    const snap = await getDocs(query(
      collection(db, "validacoes"),
      where("empresa",   "==", eId),
      where("clienteId", "==", clienteId),
      orderBy("timestamp", "desc"),
      limit(200)
    ));

    lista.innerHTML = "";

    const voltar = document.createElement("button");
    voltar.className = "btn-voltar-inline";
    voltar.textContent = "← Voltar";
    voltar.onclick = () => verEmpresa(eId);
    lista.appendChild(voltar);

    if (snap.empty) {
      const p = document.createElement("p");
      p.textContent = "Nenhum histórico encontrado ❗";
      lista.appendChild(p);
      return;
    }

    const valids = snap.docs.map(d => d.data());

    renderPaginado(lista, valids, (d) => {
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <div class="info">
          <h3>${d.clienteNome || clienteId}</h3>
          <p><strong>Valor:</strong> ${moeda(d.valor || 0)}</p>
          <p><strong>Desconto:</strong> ${d.desconto || 0}%</p>
          <p><strong>Total:</strong> ${moeda(d.total || 0)}</p>
          <p>${d.data || "--"} ${d.hora || "--"}</p>
        </div>`;
      lista.appendChild(card);
    });

  } catch (e) { console.error(e); lista.innerHTML = "Erro ao carregar ❌"; }
};

// Restaura o botão ativo ao carregar a página
document.addEventListener("DOMContentLoaded", restaurarBtnAtivo);
