// 🔽 IMPORTS
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  getDoc,
  setDoc,
  query,
  where,
  orderBy,
  limit,
  doc,
  updateDoc,
  increment
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import {
  getAuth,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";


// 🔥 FIREBASE
const firebaseConfig = {
  apiKey:  "AIzaSyAdDrbZHf93zdvY3TqdUYkqTcFOJmJhLw4",
  authDomain:  "rastreamento-ad456.firebaseapp.com",
  projectId: "rastreamento-ad456",
  appId: "1:212558087501:web:a00e808856f7e80ae62304"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);


// 🔐 LOGIN / SESSÃO SEGURA
let empresaLogada = null;
let clienteAtual = null;
let dadosEmpresaCliente = null;
let buscandoAgora = false;
let tokenBusca = 0;


// 🔥 CACHE INTELIGENTE ÚLTIMAS VALIDAÇÕES
let cacheUltimasHTML = "";
let cacheUltimasTempo = 0;
const TEMPO_CACHE_ULTIMAS = 30000; // 30 segundos


// 🔥 PROTEÇÃO REAL PELO FIREBASE AUTH
let empresaConfig = {
  ativarBrinde: true,
  ativarSorteio: false,
  metaBrinde: 10,
  metaSorteio: 10,
  qtdSorteio: 5
};

// 🔥 BUSCAR CONFIG DA EMPRESA
async function carregarConfigEmpresa() {

  try {

    const ref = doc(db, "empresas", empresaLogada);

    const snap = await getDoc(ref);

    // 🔥 se já existe config
    if (snap.exists()) {

      const dadosEmpresa = snap.data();

      empresaConfig = {
        ...empresaConfig,
        ...dadosEmpresa,

        // 🔥 padroniza nome da empresa
        nomeEmpresa:
          dadosEmpresa.nomeEmpresa ||
          dadosEmpresa.nome ||
          "Empresa"
      };

    } else {

      // 🔥 cria padrão automática
      await setDoc(ref, empresaConfig);

    }

  } catch (erro) {

    console.error("Erro config empresa:", erro);

  }

}


// 🔐 LOGIN / SESSÃO
onAuthStateChanged(auth, async (user) => {

  if (!user) {
    window.location.href = "index.html";
    return;
  }

  // 🔥 UID EMPRESA
  empresaLogada = user.uid;

  try {

    // 🔥 carrega config individual
    await carregarConfigEmpresa();

    // 🔥 carrega painel
    await carregarUltimasValidacoes();

  } catch (erro) {

    console.error("Erro sessão:", erro);

  }

});

// 🚪 SAIR
window.sair = async () => {

  try {
    await signOut(auth);
  } catch (erro) {
    console.error("Erro ao sair:", erro);
  }

  window.location.href = "index.html";
};


// 🔹 ELEMENTOS
const estadoSelect = document.getElementById("listaEstados");

const numeros = ["c1","c2","c3","c4","c5","c6"].map(id =>
  document.getElementById(id)
);

const valorInput = document.getElementById("valor");
const tipoDesconto = document.getElementById("tipoDesconto");
const descontoInput = document.getElementById("desconto");
const totalInput = document.getElementById("total");
const infoDesconto = document.getElementById("infoDesconto");

const card = document.getElementById("card");
const sucesso = document.getElementById("sucesso");
const msg = document.getElementById("msg");


// 🔢 CAMPOS CÓDIGO
numeros.forEach((input, i) => {

  input.addEventListener("input", () => {

    input.value = input.value.replace(/\D/g, "");

    if (input.value && i < numeros.length - 1) {
      numeros[i + 1].focus();
    }

  });

  input.addEventListener("keydown", (e) => {

    if (e.key === "Backspace" && !input.value && i > 0) {
      numeros[i - 1].focus();
    }

  });

});


// 💰 FORMATA MOEDA
const formatadorMoeda = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL"
});

function moeda(valor) {
  return formatadorMoeda.format(Number(valor || 0));
}

// 🔥 ANIMAR NÚMEROS
function animarNumero(el, valorFinal, dinheiro = false) {

  let atual = 0;
  const passos = 30;
  const soma = valorFinal / passos;

  const timer = setInterval(() => {

    atual += soma;

    if (atual >= valorFinal) {
      atual = valorFinal;
      clearInterval(timer);
    }

    el.innerText = dinheiro
      ? moeda(atual)
      : Math.floor(atual);

  }, 20);

}


// 🔢 PEGAR CÓDIGO
function pegarCodigo() {

  const uf = estadoSelect.value.trim().toUpperCase();
  const nums = numeros.map(n => n.value.trim()).join("");

  return `${uf}-${nums}`;

}


// 🧹 LIMPAR CÓDIGO
function limparCodigo() {

  estadoSelect.value = "";

  numeros.forEach(n => n.value = "");

  numeros[0].focus();

}


// 🔥 BUSCAR DADOS CLIENTE X EMPRESA
async function buscarDadosEmpresaCliente(clienteId) {

  dadosEmpresaCliente = null;

  try {

    const q = query(
      collection(db, "clientesEmpresa"),
      where("clienteId", "==", clienteId),
      where("empresa", "==", empresaLogada),
      limit(1)
    );

    const snap = await getDocs(q);

    if (!snap.empty) {
      dadosEmpresaCliente = {
        docId: snap.docs[0].id,
        ...snap.docs[0].data()
      };
    }

  } catch (erro) {
    console.error("Erro clientesEmpresa:", erro);
  }

}


// 📅 CONTAGEM AUTOMÁTICA DE DIAS
// Compara a data de hoje com a última vez que o saldo de dias foi atualizado
// e desconta os dias corridos que passaram desde então. Funciona mesmo que
// ninguém abra o sistema por vários dias seguidos (desconta tudo de uma vez).
// Persiste a correção no Firestore para a contagem nunca se perder.
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

async function aplicarContagemDeDias(docId, dadosCliente) {
  // Cliente sem nenhum dia configurado (ex: plano "Pendente" nunca ativado) — não desconta nada.
  if (dadosCliente.diasRestantes === undefined || dadosCliente.diasRestantes === null) {
    return dadosCliente;
  }

  const hojeISO = dataDeHojeISO();
  const ultimaAtualizacao = dadosCliente.ultimaAtualizacaoDias || hojeISO;
  const diasPassados = diasCorridosDesde(ultimaAtualizacao);

  // Já foi atualizado hoje, nada a fazer.
  if (diasPassados <= 0) {
    if (!dadosCliente.ultimaAtualizacaoDias) {
      // Primeira vez que esse campo é gravado — só marca a referência, sem descontar.
      try { await updateDoc(doc(db, "clientes", docId), { ultimaAtualizacaoDias: hojeISO }); } catch (_) {}
    }
    return dadosCliente;
  }

  const diasAtuais = Number(dadosCliente.diasRestantes || 0);
  const novosDias = diasAtuais - diasPassados;
  const novoStatus = novosDias <= 0 ? "inativo" : dadosCliente.status;

  try {
    await updateDoc(doc(db, "clientes", docId), {
      diasRestantes: novosDias,
      ultimaAtualizacaoDias: hojeISO,
      status: novoStatus
    });
  } catch (_) { /* se falhar, segue com o valor antigo em memória mesmo assim */ }

  return { ...dadosCliente, diasRestantes: novosDias, ultimaAtualizacaoDias: hojeISO, status: novoStatus };
}


// 🔍 BUSCAR CLIENTE
window.buscar = async () => {

  if (buscandoAgora) return;

  buscandoAgora = true;
  tokenBusca++;

  const buscaAtual = tokenBusca;

  const ultimos = document.getElementById("ultimasValidacoes");

  if (ultimos) ultimos.style.display = "none";

  if (!empresaLogada) {
    msg.innerText = "Carregando sessão...";
    buscandoAgora = false;
    return;
  }

  const codigo = pegarCodigo();

  if (!estadoSelect.value || codigo.length < 9) {
    mostrarMensagem("Digite o código completo ❗");
    buscandoAgora = false;
    return;
  }

  msg.innerText = "Buscando...";

  try {

    // 🔥 BUSCA ULTRA RÁPIDA (SEM QUERY)
    const snap = await getDoc(doc(db, "clientes", codigo));

    if (!snap.exists()) {

      msg.innerText = "Usuário não encontrado ❌";

      if (ultimos) ultimos.style.display = "block";

      buscandoAgora = false;
      return;
    }

    document.getElementById("foto").src =
  "https://via.placeholder.com/100";

    clienteAtual = snap.data();

    // 📅 Desconta os dias corridos desde a última verificação, se houver.
    clienteAtual = await aplicarContagemDeDias(codigo, clienteAtual);

    if (buscaAtual !== tokenBusca) {
      buscandoAgora = false;
      return;
    }

    // 🔥 BUSCA DADOS EMPRESA CLIENTE
   await buscarDadosEmpresaCliente(clienteAtual.id);

    document.getElementById("nome").innerText =
      clienteAtual.nome || "Sem nome";

    document.getElementById("id").innerText =
      clienteAtual.id || "---";

    const fotoEl = document.getElementById("foto");

    fotoEl.src = "https://via.placeholder.com/100";

    setTimeout(() => {
      if (buscaAtual !== tokenBusca) return;

      fotoEl.src =
        clienteAtual.foto || "https://via.placeholder.com/100";
    }, 80);

    const status = document.getElementById("status");

// 🔴 BLOQUEIO TOTAL PARA INATIVO (MOSTRA SÓ TOPO)
if (clienteAtual.status !== "ativo") {

  status.innerText = "Inativo";
  status.className = "status inativo";

  msg.innerText = "";

  card.classList.remove("hidden");
  card.classList.add("show");

  // 🔥 TOPO SEMPRE VISÍVEL
  document.querySelector(".perfil-box")?.style.setProperty("display", "flex");

  document.querySelector(".info")?.style.setProperty("display", "block");

  document.querySelector("#nome")?.style.setProperty("display", "block");
  document.querySelector("#id")?.style.setProperty("display", "block");
  document.querySelector("#status")?.style.setProperty("display", "block");

  // 🔥 ESCONDE MÉTRICAS
  document.querySelector(".metrics")?.style.setProperty("display", "none");

  // 🔥 ESCONDE VALIDAÇÃO INTEIRA
  document.querySelector(".validar-box")?.style.setProperty("display", "none");

  // 🔥 ESCONDE HISTÓRICO INTEIRO
  document.querySelector(".historico-box")?.style.setProperty("display", "none");

  buscandoAgora = false;
  return;
}
    // 🔵 ATIVO
    status.innerText = "Ativo";
    status.className = "status ativo";

    animarNumero(
      document.getElementById("totalCompras"),
      Number(dadosEmpresaCliente?.totalGasto || 0),
      true
    );

    animarNumero(
      document.getElementById("usos"),
      Number(dadosEmpresaCliente?.usos || 0),
      false
    );

    msg.innerText = "";

    card.classList.remove("hidden");
    card.classList.add("show");

    sucesso.classList.remove("show");
    sucesso.classList.add("hidden");

    limparCampos();

    carregarHistorico();

    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });

  } catch (erro) {

    console.error("Erro ao buscar cliente:", erro);

    msg.innerText = "Erro ao buscar ❌";

    if (ultimos) ultimos.style.display = "block";

  } finally {

    buscandoAgora = false;
  }
};

// 💰 CAMPO VALOR
valorInput.addEventListener("input", () => {

  let valor = valorInput.value.replace(/\D/g, "");

  valor = (Number(valor) / 100).toFixed(2);

  valorInput.value =
    "R$ " + valor.replace(".", ",");

  calcular();

});


// 🔻 SELECT DESCONTO
tipoDesconto.addEventListener("change", () => {

  if (tipoDesconto.value === "manual") {

    descontoInput.style.display = "block";
    descontoInput.focus();

  } else {

    descontoInput.style.display = "none";
    descontoInput.value = "";

  }

  calcular();

});


// 🔴 INPUT %
descontoInput.addEventListener("input", () => {

  let valor = descontoInput.value.replace(/\D/g, "");

  if (Number(valor) > 100) valor = "100";

  descontoInput.value = valor + "%";

  calcular();

});


// 🔢 DESCONTO ATUAL
function descontoAtual() {

  if (tipoDesconto.value === "manual") {

    return parseFloat(
      descontoInput.value.replace("%", "").trim()
    ) || 0;

  }

  return parseFloat(tipoDesconto.value || 0);

}


// 🔥 INPUT MANUAL MELHORADO
descontoInput.addEventListener("input", () => {

  let valor = descontoInput.value.replace(/\D/g, "");

  if (Number(valor) > 100) valor = "100";

  // se apagar tudo
  if (valor === "") {
    descontoInput.value = "";
    calcular();
    return;
  }

  descontoInput.value = valor + "%";

  // 🔥 cursor fica antes do %
  setTimeout(() => {
    descontoInput.setSelectionRange(
      descontoInput.value.length - 1,
      descontoInput.value.length - 1
    );
  }, 0);

  calcular();

});


// 🔥 ao clicar no campo também posiciona antes do %
descontoInput.addEventListener("click", () => {

  if (descontoInput.value.includes("%")) {

    const pos = descontoInput.value.length - 1;

    descontoInput.setSelectionRange(pos, pos);

  }

});
// 💰 CALCULAR
function calcular() {

  let valor = valorInput.value
    .replace("R$", "")
    .replace(/\./g, "")
    .replace(",", ".")
    .trim();

  valor = parseFloat(valor || 0);

  const desconto = descontoAtual();

  const valorDesconto =
    (valor * desconto) / 100;

  const total =
    Math.max(valor - valorDesconto, 0);

  totalInput.value =
    valor > 0 ? moeda(total) : "";

  infoDesconto.innerText =
    `Desconto aplicado: ${moeda(valorDesconto)} (${desconto}%)`;

}


// 🧾 HISTÓRICO CLIENTE (últimas 5)
async function carregarHistorico() {

  const tbody =
    document.getElementById("listaHistorico");

  if (!clienteAtual?.id) {
    tbody.innerHTML = `
      <tr class="empty">
        <td colspan="5">Cliente inválido</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = `
    <tr class="empty">
      <td colspan="5">Carregando...</td>
    </tr>
  `;

  try {

    const q = query(
      collection(db, "validacoes"),
      where("clienteId", "==", clienteAtual.id),
      where("empresa", "==", empresaLogada),
      orderBy("timestamp", "desc"),
      limit(5)
    );

    const snap = await getDocs(q);

    if (snap.empty) {

      tbody.innerHTML = `
        <tr class="empty">
          <td colspan="5">Nenhum registro encontrado</td>
        </tr>
      `;

      return;
    }

    tbody.innerHTML = "";

    snap.forEach((docu) => {

      const d = docu.data();

      tbody.innerHTML += `
        <tr>
          <td>${d.data || "--/--/----"}</td>
          <td>${d.hora || "--:--"}</td>
          <td>${moeda(d.valor || 0)}</td>
          <td>${Number(d.desconto || 0)}%</td>
          <td>${moeda(d.total || 0)}</td>
        </tr>
      `;

    });

  } catch (erro) {

    console.error("Erro histórico:", erro);

    tbody.innerHTML = `
      <tr class="empty">
        <td colspan="5">Erro ao carregar</td>
      </tr>
    `;

  }

}

// 🔥 ÚLTIMAS VALIDAÇÕES + SORTEIO + TOPO CORRETO
async function carregarUltimasValidacoes() {

  const box = document.getElementById("listaUltimos");

  if (!box || !empresaLogada) return;

  const agora = Date.now();

  const cacheValido =
    cacheUltimasHTML &&
    (agora - cacheUltimasTempo < TEMPO_CACHE_ULTIMAS);

  // 🔥 mostra cache instantâneo
  if (cacheValido) {
    box.innerHTML = cacheUltimasHTML;
  } else {
    box.innerHTML = "Carregando...";
  }

  try {

    const metaBrinde = Number(empresaConfig?.metaBrinde || 10);
    const metaClientesSorteio = Number(
      empresaConfig?.metaClientesSorteio ||
      empresaConfig?.metaSorteio || 5
    );
    const qtdSorteio = Number(empresaConfig?.qtdSorteio || 1);

    const ativarBrinde = empresaConfig?.ativarBrinde !== false;
    const ativarSorteio = empresaConfig?.ativarSorteio === true;

    const qTodos = query(
      collection(db, "clientesEmpresa"),
      where("empresa", "==", empresaLogada),
      orderBy("ultimaValidacao", "desc"),
      limit(30)
    );

    const snap = await getDocs(qTodos);

    if (snap.empty) {
      box.innerHTML = "Nenhuma validação encontrada";
      return;
    }

    const aptosBrinde = [];
    const aptosSorteio = [];
    const aptosAmbos = [];
    const normais = [];

    // 🔥 SEPARAÇÃO
    snap.forEach((docu) => {

      const d = docu.data();

      const usos = Number(d.usos || 0);

      // ✅ FIX 4: Brinde conta apenas usos APÓS inicioPremiacao
      const inicioPremiacao = Number(d.inicioPremiacao ?? 0);
      const usosParaBrinde  = Math.max(0, usos - inicioPremiacao);
      const ciclosBrinde    = Number(d.ciclosBrinde || 0);
      const ganhosBrinde    = Math.floor(usosParaBrinde / metaBrinde);
      const pendentesBrinde = ganhosBrinde - ciclosBrinde;

      // ✅ FIX 3: Sorteio usa ciclosSorteio + inicioSorteio — NÃO usa participouSorteio
      // Isso garante que após o sorteio ser realizado, o aviso some em TODOS os painéis
      const metaUsosSorteio = Number(
        empresaConfig?.metaUsosSorteio ||
        empresaConfig?.metaComprasSorteio ||
        empresaConfig?.metaSorteio || 10
      );
      const inicioSorteio   = Number(d.inicioSorteio ?? 0);
      const usosParaSorteio = Math.max(0, usos - inicioSorteio);
      const ciclosSorteio   = Number(d.ciclosSorteio || 0);
      const aptoSorteio     = Math.floor(usosParaSorteio / metaUsosSorteio) > ciclosSorteio;

      const dados = {
        idDoc: docu.id,
        ...d,
        pendentesBrinde
      };

      const ehAptoSorteio = ativarSorteio && aptoSorteio;
      const ehAptoBrinde  = ativarBrinde && pendentesBrinde > 0;

      // ✅ Quando os dois módulos estão ativos e o cliente bate as duas metas
      // ao mesmo tempo, ele entra no grupo combinado (mensagem única),
      // sem perder a participação em nenhuma das duas listas/ações.
      if (ehAptoSorteio && ehAptoBrinde) {
        aptosAmbos.push(dados);
      } else if (ehAptoSorteio) {
        aptosSorteio.push(dados);
      } else if (ehAptoBrinde) {
        aptosBrinde.push(dados);
      } else {
        normais.push(dados);
      }

    });

    // 🔥 MONTA HTML UMA ÚNICA VEZ
    let html = "";

    // =====================================
    // 🔥 CARD SORTEIO (meta de clientes considera sorteio + ambos)
    // =====================================
    const totalAptosSorteio = aptosSorteio.length + aptosAmbos.length;
    if (ativarSorteio && totalAptosSorteio > 0) {

      const metaAtingida = totalAptosSorteio >= metaClientesSorteio;

      // ✅ Só mostra "Realizar sorteio" quando a meta de clientes foi atingida
      if (metaAtingida) {
  html += `
    <div class="card-beneficio" style="
      background:#b88b00;
      border:1px solid rgba(201,169,77,.15);
      padding:18px;
      margin-bottom:8px;
    ">
      <strong style="
        color:#000;
        font-size:17px;
        font-weight:700;
        display:block;
        margin-bottom:4px;
      ">
        Realizar sorteio
      </strong>

      <span style="
        color:#000;
        font-size:13px;
      ">
        Clientes atingiram os requisitos para participar
      </span>

    </div>
  `;
}
      

      // Lista todos os clientes já aptos só pro sorteio, independente da meta
      aptosSorteio.forEach((d) => {
        html += `
          <div class="item-historico" style="
            border:1px solid rgba(201,169,77,.15);
            background:#101010;
          ">
            <div class="dados-historico">
              <div style="
                color:#ffd700;
                font-size:12px;
                margin-bottom:6px;
                font-weight:bold;
              ">
                Cliente apto para sorteio
              </div>
              <div class="topo-historico">
                <strong style="color:#fff;font-size:16px;">
                  ${d.nome || d.clienteId}
                </strong>
                <button
                  class="btn-detalhes"
                  onclick="verDetalhes('${d.clienteId}')">
                  Ver detalhes
                </button>
              </div>
              <span>ID: ${d.clienteId || "---"}</span>
              <span>Total: ${moeda(d.totalGasto || 0)}</span>
              <span>Usos: ${d.usos || 0}</span>
              <span>${d.ultimaData || "--"} ${d.ultimaHora || "--"}</span>
            </div>
          </div>
        `;
      });
    }

    // =====================================
    // 🔥 CLIENTES APTOS PARA SORTEIO E PREMIAÇÃO (ambos ao mesmo tempo)
    // =====================================
    aptosAmbos.forEach((d) => {

      html += `
        <div class="item-historico" style="
          border:1px solid rgba(255,215,0,.25);
          background:linear-gradient(135deg,#171717,#0f0f0f);
        ">

          <div class="dados-historico">

            <div style="
              color:#ffd700;
              font-size:13px;
              margin-bottom:8px;
              font-weight:bold;
            ">
              Cliente apto para sorteio e premiação
            </div>

            <div class="topo-historico">

              <strong style="color:#fff;font-size:17px;">
                ${d.nome || d.clienteId}
              </strong>

              <button
                class="btn-detalhes"
                onclick="verDetalhes('${d.clienteId}')">
                Ver detalhes
              </button>

            </div>

            <span>ID: ${d.clienteId || "---"}</span>
            <span>Total: ${moeda(d.totalGasto || 0)}</span>
            <span>Usos: ${d.usos || 0}</span>
            <span>${d.ultimaData || "--"} ${d.ultimaHora || "--"}</span>

            ${d.pendentesBrinde > 0 ? `
              <div style="
                margin-top:-42px;
                display:flex;
                justify-content:flex-end;
              ">

                <button
                  onclick="premiarCliente(event,'${d.idDoc}')"
                  style="
                    background:linear-gradient(135deg,#ffd700,#ffcc00);
                    color:#111;
                    border:none;
                    padding:9px 12px;
                    border-radius:10px;
                    font-size:12px;
                    font-weight:900;
                    cursor:pointer;
                    min-width:80px;
                    transition:0.2s ease;
                  ">
                  Premiar
                </button>

              </div>
            ` : ""}

          </div>
        </div>
      `;
    });

    // =====================================
    // 🔥 CLIENTES BRINDE
    // =====================================
    aptosBrinde.forEach((d) => {

      html += `
        <div class="item-historico" style="
          border:1px solid rgba(255,215,0,.25);
          background:linear-gradient(135deg,#171717,#0f0f0f);
        ">

          <div class="dados-historico">

            <div style="
              color:#ffd700;
              font-size:13px;
              margin-bottom:8px;
              font-weight:bold;
            ">
              Cliente apto para premiação
            </div>

            <div class="topo-historico">

              <strong style="color:#fff;font-size:17px;">
                ${d.nome || d.clienteId}
              </strong>

              <button
                class="btn-detalhes"
                onclick="verDetalhes('${d.clienteId}')">
                Ver detalhes
              </button>

            </div>

            <span>ID: ${d.clienteId || "---"}</span>
            <span>Total: ${moeda(d.totalGasto || 0)}</span>
            <span>Usos: ${d.usos || 0}</span>
            <span>${d.ultimaData || "--"} ${d.ultimaHora || "--"}</span>

            ${d.pendentesBrinde > 0 ? `
              <div style="
                margin-top:-42px;
                display:flex;
                justify-content:flex-end;
              ">

                <button
                  onclick="premiarCliente(event,'${d.idDoc}')"
                  style="
                    background:linear-gradient(135deg,#ffd700,#ffcc00);
                    color:#111;
                    border:none;
                    padding:9px 12px;
                    border-radius:10px;
                    font-size:12px;
                    font-weight:900;
                    cursor:pointer;
                    min-width:80px;
                    transition:0.2s ease;
                  ">
                  Premiar
                </button>

              </div>
            ` : ""}

          </div>
        </div>
      `;
    });

    // =====================================
    // 🔥 LISTA NORMAL
    // =====================================
    normais.slice(0, 5).forEach((d) => {

      html += `
        <div class="item-historico">

          <div class="dados-historico">

            <div class="topo-historico">

              <strong>
                ${d.nome || d.clienteId}
              </strong>

              <button
                class="btn-detalhes"
                onclick="verDetalhes('${d.clienteId}')">
                Ver detalhes
              </button>

            </div>

            <span>ID: ${d.clienteId || "---"}</span>
            <span>Total: ${moeda(d.totalGasto || 0)}</span>
            <span>Usos: ${d.usos || 0}</span>
            <span>${d.ultimaData || "--"} ${d.ultimaHora || "--"}</span>

          </div>
        </div>
      `;
    });

// 🔥 RENDERIZA UMA VEZ SÓ
    if (html !== cacheUltimasHTML) {
      box.innerHTML = html;
    }

    // 🔥 SALVA CACHE NOVO
    cacheUltimasHTML = html;
    cacheUltimasTempo = Date.now();

  } catch (erro) {

    console.error(erro);

    box.innerHTML = `
      <div style="
        background:#2b0000;
        color:#ff6b6b;
        padding:16px;
        border-radius:16px;
      ">
        ⚠ ${erro.message}
      </div>
    `;
  }
}

// 🔍 VER DETALHES
window.verDetalhes = async (id) => {

  const modal =
    document.getElementById("modalDetalhes");

  const box =
    document.getElementById("conteudoDetalhes");

  modal.classList.remove("hidden");
  modal.classList.add("show");

  box.innerHTML = "Carregando...";

  try {

    const q = query(
      collection(db, "validacoes"),
      where("empresa", "==", empresaLogada),
      where("clienteId", "==", id),
      orderBy("timestamp", "desc"),
      limit(50)
    );

    const snap = await getDocs(q);

    if (snap.empty) {
      box.innerHTML = "Nenhum detalhe encontrado";
      return;
    }

    box.innerHTML = "";

    const docs = snap.docs;
    const primeiro = docs[0].data();

    // 🔥 última validação destaque
    box.innerHTML += `
      <div style="
        background:#111111;
        color:#fff;
        padding:16px;
        border-radius:16px;
        margin-bottom:14px;
        border:1px solid rgba(255,215,0,.14);
      ">

        <strong style="
          color:#ffd700;
          font-size:16px;
        ">
          Última validação
        </strong>

        <br><br>

        ${primeiro.data || "--"} ${primeiro.hora || "--"}<br>
        Valor: ${moeda(primeiro.valor || 0)}<br>
        Desconto: ${Number(primeiro.desconto || 0)}%<br>
        Total pago: ${moeda(primeiro.total || 0)}

      </div>
    `;

    // 🔥 mostra só 5
    docs.slice(0, 5).forEach((docu) => {

      const d = docu.data();

      box.innerHTML += `
        <div class="linha-detalhe">

          <span>
            ${d.data || "--"} ${d.hora || "--"}
          </span>

          <span>${moeda(d.valor || 0)}</span>

          <span>
            ${Number(d.desconto || 0)}%
          </span>

          <span>${moeda(d.total || 0)}</span>

        </div>
      `;

    });

    // 🔥 botão ver mais
    if (docs.length > 5) {

      box.innerHTML += `
        <div class="mais-box">

          <button
            class="btn btn-primary"
            onclick="mostrarMaisDetalhes('${id}')">

            Ver mais

          </button>

        </div>
      `;

    }

  } catch (erro) {

    console.error("Erro detalhes:", erro);

    box.innerHTML = "Erro ao carregar";

  }

};


// 🔥 VER MAIS NO MODAL
window.mostrarMaisDetalhes = async (id) => {

  const box =
    document.getElementById("conteudoDetalhes");

  box.innerHTML = "Carregando...";

  try {

    const q = query(
      collection(db, "validacoes"),
      where("empresa", "==", empresaLogada),
      where("clienteId", "==", id),
      orderBy("timestamp", "desc"),
      limit(50)
    );

    const snap = await getDocs(q);

    if (snap.empty) {
      box.innerHTML = "Nenhum detalhe encontrado";
      return;
    }

    box.innerHTML = "";

    snap.forEach((docu) => {

      const d = docu.data();

      box.innerHTML += `
        <div class="linha-detalhe">

          <span>
            ${d.data || "--"} ${d.hora || "--"}
          </span>

          <span>${moeda(d.valor || 0)}</span>

          <span>
            ${Number(d.desconto || 0)}%
          </span>

          <span>${moeda(d.total || 0)}</span>

        </div>
      `;

    });

  } catch (erro) {

    console.error("Erro ver mais:", erro);

    box.innerHTML = "Erro ao carregar";

  }

};

// ❌ FECHAR MODAL
window.fecharDetalhes = () => {

  const modal =
    document.getElementById("modalDetalhes");

  if (!modal) return;

  modal.classList.remove("show");
  modal.classList.add("hidden");

};


// 🔔 MENSAGENS
let timerMsg = null;

function mostrarMensagem(texto) {

  msg.innerText = texto;
  msg.style.display = "block";

  clearTimeout(timerMsg);

  timerMsg = setTimeout(() => {
    msg.innerText = "";
  }, 4000);

}

// ✅ VALIDAR
window.validar = async () => {

  if (!clienteAtual?.id) {
    mostrarMensagem("Busque um cliente primeiro ❗");
    return;
  }

  if (!tipoDesconto.value) {
    mostrarMensagem("Selecione o desconto primeiro ❗");
    return;
  }

  if (
    tipoDesconto.value === "manual" &&
    !descontoInput.value.trim()
  ) {
    mostrarMensagem("Digite o desconto manual ❗");
    descontoInput.focus();
    return;
  }

  let valor = valorInput.value
    .replace("R$", "")
    .replace(/\./g, "")
    .replace(",", ".")
    .trim();

  valor = parseFloat(valor || 0);

  if (!valor || valor <= 0) {
    mostrarMensagem("Digite o valor da venda ❗");
    return;
  }

  const desconto = descontoAtual();

  if (desconto < 0 || desconto > 100) {
    mostrarMensagem("Desconto inválido ❗");
    return;
  }

  const valorDesconto = (valor * desconto) / 100;
  const total = Math.max(valor - valorDesconto, 0);

  const btn = document.querySelector(".btn-success");

  if (btn.disabled) return;

  btn.disabled = true;
  btn.innerText = "Validando...";

  const agora = new Date();
  const agoraMs = Date.now();

  try {

    // ==========================================
    // SALVA VALIDAÇÃO
    // ==========================================
    await addDoc(
      collection(db, "validacoes"),
      {
        clienteId: clienteAtual.id,
        clienteNome: clienteAtual.nome || "",

        // 🔥 EMPRESA
        empresa: empresaLogada,

empresaNome:
  empresaConfig?.nomeEmpresa ||
  empresaConfig?.nome ||
  "Empresa",
  
        // 🔥 VENDA
        valor,
        desconto,
        total,

        // 🔥 DATA
        data: agora.toLocaleDateString("pt-BR"),
        hora: agora.toLocaleTimeString("pt-BR"),
        timestamp: agoraMs
      }
    );

    let usosAtual = 1;

    // ==========================================
    // CLIENTE EXISTE
    // ==========================================
    if (dadosEmpresaCliente?.docId) {

      usosAtual =
        Number(dadosEmpresaCliente.usos || 0) + 1;

      const atualizar = {

        // 🔥 EMPRESA
        empresaNome:
          empresaConfig?.nomeEmpresa || "Empresa",

        // 🔥 DADOS
        totalGasto: increment(total),
        usos: increment(1),

        // 🔥 ÚLTIMA VALIDAÇÃO
        ultimaValidacao: agoraMs,

        ultimaData:
          agora.toLocaleDateString("pt-BR"),

        ultimaHora:
          agora.toLocaleTimeString("pt-BR"),

        // 🔥 CLIENTE
        nome: clienteAtual.nome || "",
        foto: clienteAtual.foto || ""

      };

      // ✅ FIX 3: aptoSorteio não é mais usado para elegibilidade;
      // a elegibilidade agora é calculada via ciclosSorteio + inicioSorteio.
      // Mantemos o campo apenas para retrocompatibilidade, sem alterar sua lógica.

      await updateDoc(
        doc(
          db,
          "clientesEmpresa",
          dadosEmpresaCliente.docId
        ),
        atualizar
      );

    } else {

      usosAtual = 1;

      await addDoc(
        collection(db, "clientesEmpresa"),
        {
          clienteId: clienteAtual.id,

          // 🔥 EMPRESA
          empresa: empresaLogada,
          empresaNome:
            empresaConfig?.nomeEmpresa || "Empresa",

          // 🔥 CLIENTE
          nome: clienteAtual.nome || "",
          foto: clienteAtual.foto || "",

          // 🔥 DADOS
          totalGasto: total,
          usos: 1,

          brindesEntregues: 0,
          premiado: false,
          aptoSorteio: false,
          sorteado: false,

          // 🔥 ÚLTIMA VALIDAÇÃO
          ultimaValidacao: agoraMs,

          ultimaData:
            agora.toLocaleDateString("pt-BR"),

          ultimaHora:
            agora.toLocaleTimeString("pt-BR")
        }
      );

    } // 🔥 FECHAMENTO DO ELSE

    // ==========================================
    // ALERTA BRINDE
    // ==========================================
    if (usosAtual % 10 === 0) {

      mostrarMensagem(
        `${clienteAtual.nome || "Cliente"} atingiu ${usosAtual} compras!`
      );

    }

    // 🔥 ALERTA SORTEIO — usa metaUsosSorteio (nome correto do campo)
    const metaUsosSorteioAlerta =
      Number(empresaConfig?.metaUsosSorteio ||
             empresaConfig?.metaComprasSorteio ||
             empresaConfig?.metaSorteio || 10);

    // Calcula usos desde inicioSorteio para o alerta também ser consistente
    const inicioSorteioAlerta = Number(dadosEmpresaCliente?.inicioSorteio ?? 0);
    const usosDesdeInicioAlerta = Math.max(0, usosAtual - inicioSorteioAlerta);

    if (usosDesdeInicioAlerta === metaUsosSorteioAlerta) {

      mostrarMensagem(
        `${clienteAtual.nome || "Cliente"} atingiu ${metaUsosSorteioAlerta} compras e entrou no sorteio!`
      );

    }

    cacheUltimasHTML = "";
    cacheUltimasTempo = 0;

    await carregarUltimasValidacoes();

    // ==========================================
    // FECHA CARD
    // ==========================================
    card.classList.remove("show");
    card.classList.add("hidden");

    document.getElementById("resultado").style.display = "none";
    document.getElementById("ultimasValidacoes").style.display = "none";

    const codigo = document.querySelector(".codigo");
    if (codigo) codigo.style.display = "none";

    const titulo = document.querySelector("h2");
    if (titulo) titulo.style.display = "none";

    const linha = document.querySelector(".linha");
    if (linha) linha.style.display = "none";

    msg.style.display = "none";

    const botoesPrimarios =
      document.querySelectorAll(".btn-primary");

    if (botoesPrimarios[0]) {
      botoesPrimarios[0].style.display = "none";
    }

    setTimeout(() => {

      sucesso.classList.remove("hidden");
      sucesso.classList.add("show");
      sucesso.style.display = "flex";

      window.scrollTo({
        top: 0,
        behavior: "smooth"
      });

    }, 250);

  } catch (erro) {

    console.error("Erro validar:", erro);

    mostrarMensagem("Erro ao validar ❌");

  } finally {

    btn.disabled = false;
    btn.innerText = "Validar";

  }

};
// 🔄 VOLTAR
window.voltar = async () => {

  sucesso.classList.remove("show");
  sucesso.classList.add("hidden");
  sucesso.style.display = "none";

  // 🔥 VOLTA TELA PRINCIPAL
  document.getElementById("resultado").style.display = "block";
  document.getElementById("ultimasValidacoes").style.display = "block";

  const codigo = document.querySelector(".codigo");
  if (codigo) codigo.style.display = "flex";

  const titulo = document.querySelector("h2");
  if (titulo) titulo.style.display = "block";

  const linha = document.querySelector(".linha");
  if (linha) linha.style.display = "block";

  msg.style.display = "block";

  const botoesPrimarios =
    document.querySelectorAll(".btn-primary");

  if (botoesPrimarios[0]) {
    botoesPrimarios[0].style.display = "block";
  }

  // 🔥 ESCONDE CARD
  card.classList.add("hidden");
  card.classList.remove("show");

  clienteAtual = null;
  dadosEmpresaCliente = null;

  limparCodigo();

  document.getElementById("nome").innerText =
    "Nome do Cliente";

  document.getElementById("id").innerText =
    "ID: ---";

  document.getElementById("status").innerText =
    "Ativo";

  document.getElementById("status").className =
    "status ativo";

  document.getElementById("foto").src =
  "https://via.placeholder.com/100";

  limparCampos();

  await carregarUltimasValidacoes();

  numeros[0].focus();

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });

};


// 🔥 VOLTAR CARD
window.voltarCard = () => {

  card.classList.remove("show");
  card.classList.add("hidden");

  clienteAtual = null;
  dadosEmpresaCliente = null;

  limparCodigo();

  document.getElementById("nome").innerText =
    "Nome do Cliente";

  document.getElementById("id").innerText =
    "ID: ---";

  document.getElementById("status").innerText =
    "Ativo";

  document.getElementById("status").className =
    "status ativo";

  document.getElementById("foto").src = "";

  limparCampos();

  const ultimos =
    document.getElementById("ultimasValidacoes");

  if (ultimos) {
    ultimos.style.display = "block";
  }

  msg.innerText = "";

  numeros[0].focus();

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });

};


// 🧹 LIMPAR CAMPOS
function limparCampos() {

  valorInput.value = "";
  totalInput.value = "";
  tipoDesconto.value = "";
  descontoInput.value = "";
  descontoInput.style.display = "none";

  infoDesconto.innerText =
    "Desconto aplicado: R$ 0,00 (0%)";

}
// 🔥 FUNÇÃO PREMIAR
window.premiarCliente = async (event, idDoc) => {

  if (!idDoc) return;

  const btn = event?.target;

  if (btn && btn.disabled) return;

  if (btn) {
    btn.disabled = true;
    btn.innerText = "Premiando...";
  }

  try {

    // ✅ FIX 4: Calcula novoCiclo com base nos usos APÓS inicioPremiacao
    const ref     = doc(db, "clientesEmpresa", idDoc);
    const cliSnap = await getDoc(ref);
    const cliData = cliSnap.exists() ? cliSnap.data() : {};
    const meta            = Number(empresaConfig?.metaBrinde || 10);
    const usos            = Number(cliData.usos || 0);
    const inicioPremiacao = Number(cliData.inicioPremiacao ?? 0);
    const usosDesdeInicio = Math.max(0, usos - inicioPremiacao);
    // ciclosBrinde avança para o ciclo atual contado desde o início da config
    const novoCiclo = Math.floor(usosDesdeInicio / meta);

    const agora = new Date();
    const dataStr = agora.toLocaleDateString("pt-BR");
    const horaStr = agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

    // Avança ciclosBrinde → cliente sai de pendente no ADM principal
    await updateDoc(ref, {
      ciclosBrinde: novoCiclo,
      premiacaoPendente: false
    });

    // Grava no histórico → aparece no ADM principal em "Histórico de premiações"
    await addDoc(collection(db, "historicoPromocoes"), {
      tipo:        "premiacao",
      empresa:     empresaLogada,
      nomeEmpresa: empresaConfig?.nomeEmpresa || empresaConfig?.nome || "Empresa",
      clienteId:   cliData.clienteId || "",
      nomeCliente: cliData.nome      || cliData.clienteId || "",
      data:        dataStr,
      hora:        horaStr,
      timestamp:   Date.now()
    });

    // Limpa cache e recarrega lista
    cacheUltimasHTML  = "";
    cacheUltimasTempo = 0;
    mostrarMensagem("Premiação realizada ✅");
    setTimeout(() => carregarUltimasValidacoes(), 800);

  } catch (erro) {
    console.error("Erro ao premiar:", erro);
    if (btn) { btn.disabled = false; btn.innerText = "Premiar"; }
    mostrarMensagem("Erro ao premiar ❌");
  }

};