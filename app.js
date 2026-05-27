// ═══════════════════════════════════════════════════════════
//  MERCADO PAGO — PUBLIC KEY (seguro no front-end)
// ═══════════════════════════════════════════════════════════
const MP_PUBLIC_KEY = "APP_USR-e2112002-a87c-4af6-98bf-f2a8be335e22";

// ═══════════════════════════════════════════════════════════
//  URL DA FIREBASE FUNCTION (backend)
//  Após deploy, substitua pela URL real do seu projeto
// ═══════════════════════════════════════════════════════════
const FUNCTIONS_BASE = "https://us-central1-rastreamento-ad456.cloudfunctions.net";

// ═══════════════════════════════════════════════════════════
//  FIREBASE IMPORTS
// ═══════════════════════════════════════════════════════════
import { initializeApp }       from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey:    "AIzaSyAdDrbZHf93zdvY3TqdUYkqTcFOJmJhLw4",
  authDomain:"rastreamento-ad456.firebaseapp.com",
  projectId: "rastreamento-ad456",
  appId:     "1:212558087501:web:a00e808856f7e80ae62304"
};
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

// ═══════════════════════════════════════════════════════════
//  SDK MERCADO PAGO
// ═══════════════════════════════════════════════════════════
const mp = new MercadoPago(MP_PUBLIC_KEY, { locale: "pt-BR" });
let cardForm = null;  // instância do cardForm do MP

// ═══════════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════════
let currentClient  = null;
let selectedPlan   = null;
let plansOpen      = false;
let activeMethod   = "pix";
let currentPaymentId = null;
let pixPollingTimer  = null;
let pixCountdownTimer = null;

// ═══════════════════════════════════════════════════════════
//  LOADING
// ═══════════════════════════════════════════════════════════
window.addEventListener("load", () => {
  setTimeout(() => {
    document.getElementById("loadingScreen").classList.add("hide");
    showStage("stage1");
  }, 1700);
});

// ═══════════════════════════════════════════════════════════
//  TOAST
// ═══════════════════════════════════════════════════════════
function toast(msg, type = "info", dur = 4000) {
  const c = document.getElementById("toastContainer");
  const icons = { success:"✓", error:"✕", info:"◆" };
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type]}</span><span>${msg}</span>`;
  c.appendChild(el);
  setTimeout(() => { el.classList.add("exit"); setTimeout(() => el.remove(), 350); }, dur);
}

// ═══════════════════════════════════════════════════════════
//  STAGE
// ═══════════════════════════════════════════════════════════
window.showStage = function(id) {
  document.querySelectorAll(".stage").forEach(s => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  window.scrollTo({ top: 0, behavior: "smooth" });
};

// ═══════════════════════════════════════════════════════════
//  STAGE 1 — CAMPO UF + ID
// ═══════════════════════════════════════════════════════════
const ufSelect  = document.getElementById("ufSelect");
const cardInput = document.getElementById("cardIdInput");
const preview   = document.getElementById("codePreview");

function updatePreview() {
  const uf  = ufSelect.value;
  const num = cardInput.value.trim();
  if (uf && num) { preview.textContent = `${uf}-${num}`; preview.classList.add("active"); }
  else if (uf)   { preview.textContent = `${uf}-`;      preview.classList.remove("active"); }
  else            { preview.textContent = "—";           preview.classList.remove("active"); }
}
ufSelect.addEventListener("change", () => { updatePreview(); if (ufSelect.value) cardInput.focus(); });
cardInput.addEventListener("input",  () => { cardInput.value = cardInput.value.replace(/\D/g,""); updatePreview(); });
cardInput.addEventListener("keydown", e => { if (e.key === "Enter") handleIdentify(); });

// ═══════════════════════════════════════════════════════════
//  IDENTIFICAR CLIENTE
// ═══════════════════════════════════════════════════════════
window.handleIdentify = async function() {
  const uf  = ufSelect.value.trim().toUpperCase();
  const num = cardInput.value.trim();
  if (!uf)  { toast("Selecione o estado (UF).", "error"); return; }
  if (!num) { toast("Digite o número do cartão.", "error"); return; }

  const docId = `${uf}-${num}`;
  const btn = document.getElementById("btnContinue");
  btn.disabled = true; btn.classList.add("loading");

  try {
    const snap = await getDoc(doc(db, "clientes", docId));
    if (!snap.exists()) { toast("Cliente não encontrado.", "error"); return; }
    currentClient = { uid: snap.id, ...snap.data() };
    populateDashboard(currentClient);
    toast(`Bem-vindo, ${currentClient.nome || "cliente"}!`, "success");
    setTimeout(() => showStage("stage2"), 300);
  } catch(e) {
    console.error(e);
    toast("Erro de conexão. Tente novamente.", "error");
  } finally {
    btn.disabled = false; btn.classList.remove("loading");
  }
};

// ═══════════════════════════════════════════════════════════
//  POPULAR DASHBOARD
// ═══════════════════════════════════════════════════════════
function populateDashboard(c) {
  const initials = (c.nome||"?").split(" ").slice(0,2).map(w=>w[0]?.toUpperCase()||"").join("");
  document.getElementById("clientAvatar").textContent = initials;
  document.getElementById("clientName").textContent   = c.nome || "—";
  document.getElementById("clientUID").textContent    = "ID: " + c.uid;
  document.getElementById("planBadge").textContent    = (c.plano || "—") + " Plano";
  document.getElementById("statPlano").textContent    = c.plano || "—";

  const val = Number(c.valorPlano || 0);
  document.getElementById("statValor").textContent = val > 0
    ? new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(val) : "—";

  const dias = Number(c.diasRestantes || 0);
  document.getElementById("statDias").textContent = dias > 0 ? `${dias} dias` : "0 dias";

  setTimeout(() => {
    document.getElementById("diasBar").style.width = Math.min(100, Math.round((dias/365)*100)) + "%";
  }, 700);

  // Preenche resumo de pagamento com plano atual
  selectedPlan = null;
  document.getElementById("payPlanName").textContent = c.plano || "Plano atual";
  document.getElementById("payValue").textContent    = val > 0
    ? new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(val) : "—";

  setPayEnabled(true);
  closePlans();
}

// ═══════════════════════════════════════════════════════════
//  TOGGLE / SELECT PLAN
// ═══════════════════════════════════════════════════════════
window.togglePlans = function() { plansOpen ? closePlans() : openPlans(); };

function openPlans() {
  plansOpen = true;
  document.getElementById("plansWrap").classList.add("open");
  document.getElementById("btnTogglePlans").classList.add("active");
  document.querySelectorAll(".plan-card").forEach(c => c.classList.remove("selected"));
  selectedPlan = null;
  setPayEnabled(false);
  document.getElementById("payPlanName").textContent = "Escolha um plano abaixo";
  document.getElementById("payValue").textContent    = "—";
}

function closePlans() {
  plansOpen = false;
  document.getElementById("plansWrap").classList.remove("open");
  document.getElementById("btnTogglePlans").classList.remove("active");
  if (!selectedPlan && currentClient) {
    const val = Number(currentClient.valorPlano || 0);
    document.getElementById("payPlanName").textContent = currentClient.plano || "Plano atual";
    document.getElementById("payValue").textContent    = val > 0
      ? new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(val) : "—";
    setPayEnabled(true);
  }
}

function setPayEnabled(on) {
  const btn = document.getElementById("btnPay");
  btn.disabled = !on;
  btn.classList.toggle("pay-locked", !on);
}

window.selectPlan = function(el) {
  document.querySelectorAll(".plan-card").forEach(c => c.classList.remove("selected"));
  el.classList.add("selected");
  const name  = el.dataset.plan === "mensal" ? "Plano Mensal" : "Plano Anual";
  const price = parseFloat(el.dataset.price);
  const days  = parseInt(el.dataset.days);
  selectedPlan = { name, price, days };
  document.getElementById("payPlanName").textContent = `${name} — ${days} dias`;
  document.getElementById("payValue").textContent    =
    new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(price);
  setPayEnabled(true);
};

// ═══════════════════════════════════════════════════════════
//  ABRIR CHECKOUT (Stage 3)
// ═══════════════════════════════════════════════════════════
window.openCheckout = function() {
  if (!currentClient) { toast("Nenhum cliente identificado.", "error"); return; }

  // Plano a cobrar
  const plan = selectedPlan || {
    name:  currentClient.plano  || "Plano atual",
    price: Number(currentClient.valorPlano || 0),
    days:  Number(currentClient.diasRestantes || 0)
  };

  // Atualiza cabeçalho do checkout
  document.getElementById("ckPlanName").textContent  = plan.name;
  document.getElementById("ckPlanValue").textContent =
    new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(plan.price);

  // Pré-preenche nome do pagador com o nome do cliente
  document.getElementById("payerName").value = currentClient.nome || "";

  showStage("stage3");
  selectMethod(activeMethod);
};

// ═══════════════════════════════════════════════════════════
//  MÉTODO DE PAGAMENTO
// ═══════════════════════════════════════════════════════════
window.selectMethod = function(method) {
  activeMethod = method;
  document.querySelectorAll(".method-tab").forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".method-panel").forEach(p => p.classList.remove("active"));
  document.getElementById(`tab${method.charAt(0).toUpperCase()+method.slice(1)}`).classList.add("active");
  document.getElementById(`${method}Panel`).classList.add("active");

  if (method === "card") initCardForm();
};

// ═══════════════════════════════════════════════════════════
//  MERCADO PAGO — CARD FORM (Secure Fields)
// ═══════════════════════════════════════════════════════════
function initCardForm() {
  if (cardForm) return; // já iniciado

  cardForm = mp.cardForm({
    amount: String(getPlanPrice()),
    iframe: true,
    form: {
      id: "cardFormEl",
      cardNumber:     { id: "cardNumber",     placeholder: "0000 0000 0000 0000" },
      expirationDate: { id: "cardExpiration",  placeholder: "MM/AA" },
      securityCode:   { id: "cardCVV",         placeholder: "CVV"   }
    },
    callbacks: {
      onFormMounted: (err) => {
        if (err) { console.warn("CardForm mount error:", err); }
      },
      onPaymentMethodsReceived: (err, pms) => {
        if (!err && pms.length) {
          document.getElementById("cardBrandText").textContent = pms[0].name || "—";
          // atualiza parcelas
          mp.getInstallments({
            amount: String(getPlanPrice()),
            bin: pms[0].bin
          }).then(res => {
            if (res && res[0]) {
              const sel = document.getElementById("installments");
              sel.innerHTML = res[0].payer_costs.map(p =>
                `<option value="${p.installments}">${p.recommended_message}</option>`
              ).join("");
            }
          });
        }
      },
      onError: (errs) => {
        console.warn("CardForm errors:", errs);
      }
    }
  });
}

function getPlanPrice() {
  if (selectedPlan) return selectedPlan.price;
  return Number(currentClient?.valorPlano || 0);
}

// ═══════════════════════════════════════════════════════════
//  SUBMIT PAGAMENTO
// ═══════════════════════════════════════════════════════════
window.submitPayment = async function() {
  const name  = document.getElementById("payerName").value.trim();
  const cpf   = document.getElementById("payerCpf").value.replace(/\D/g,"");
  const email = document.getElementById("payerEmail").value.trim();

  if (!name)              { toast("Informe seu nome.", "error"); return; }
  if (cpf.length !== 11)  { toast("CPF inválido.", "error"); return; }
  if (!email.includes("@")) { toast("E-mail inválido.", "error"); return; }

  const plan = selectedPlan || {
    name:  currentClient.plano  || "Plano",
    price: Number(currentClient.valorPlano || 0),
    days:  30
  };

  setSubmitLoading(true);

  try {
    if (activeMethod === "pix") {
      await createPixPayment({ name, cpf, email, plan });
    } else {
      await createCardPayment({ name, cpf, email, plan });
    }
  } catch(e) {
    console.error(e);
    toast(e.message || "Erro ao processar pagamento.", "error");
    setSubmitLoading(false);
  }
};

function setSubmitLoading(on) {
  const btn = document.getElementById("btnSubmitPayment");
  const txt = document.getElementById("btnSubmitText");
  const sp  = document.getElementById("btnSubmitSpinner");
  btn.disabled   = on;
  sp.style.display  = on ? "block" : "none";
  txt.textContent   = on ? "Processando..." : "Pagar agora";
}

// ─── PIX ─────────────────────────────────────────────────
async function createPixPayment({ name, cpf, email, plan }) {
  const res = await fetch(`${FUNCTIONS_BASE}/createPayment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      method:    "pix",
      amount:    plan.price,
      planName:  plan.name,
      planDays:  plan.days,
      clientId:  currentClient.uid,
      clientPlan: currentClient.plano || "",
      clientDays: Number(currentClient.diasRestantes || 0),
      payer: { name, cpf, email }
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Erro ao criar pagamento PIX.");
  }

  const data = await res.json();
  currentPaymentId = data.id;

  // Exibe stage 4 com QR Code
  document.getElementById("pixAmountDisplay").textContent =
    new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(plan.price);
  document.getElementById("pixCodeBox").textContent = data.qrCode;

  // Gera QR Code localmente a partir do código PIX copia-e-cola
  const qrContainer = document.getElementById("pixQrImage");
  qrContainer.innerHTML = ""; // limpa QR anterior se houver
  if (data.qrCode) {
    new QRCode(qrContainer, {
      text:       data.qrCode,
      width:      200,
      height:     200,
      colorDark:  "#000000",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.M
    });
    document.getElementById("pixQrOverlay").classList.add("hidden");
  } else {
    document.getElementById("pixQrOverlay").innerHTML =
      "<span>Código PIX indisponível. Use o código copia-e-cola abaixo.</span>";
  }

  setSubmitLoading(false);
  showStage("stage4");
  startPixCountdown(15 * 60); // 15 min
  startPixPolling(data.id, plan);
}

// ─── COUNTDOWN PIX ───────────────────────────────────────
function startPixCountdown(totalSeconds) {
  let remaining = totalSeconds;
  const bar     = document.getElementById("pixTimerBar");
  const timer   = document.getElementById("pixTimer");

  clearInterval(pixCountdownTimer);
  pixCountdownTimer = setInterval(() => {
    remaining--;
    const m = String(Math.floor(remaining / 60)).padStart(2,"0");
    const s = String(remaining % 60).padStart(2,"0");
    timer.textContent = `${m}:${s}`;
    bar.style.width   = ((remaining / totalSeconds) * 100) + "%";

    if (remaining <= 0) {
      clearInterval(pixCountdownTimer);
      timer.textContent = "Expirado";
      timer.classList.add("expired");
      bar.style.width = "0%";
      document.getElementById("pixStatusDot").className  = "pix-status-dot expired";
      document.getElementById("pixStatusText").textContent = "QR Code expirado. Volte e tente novamente.";
      clearInterval(pixPollingTimer);
    }
  }, 1000);
}

// ─── POLLING STATUS PIX ──────────────────────────────────
function startPixPolling(paymentId, plan) {
  clearInterval(pixPollingTimer);
  pixPollingTimer = setInterval(async () => {
    try {
      const res  = await fetch(`${FUNCTIONS_BASE}/checkPayment?id=${paymentId}`);
      const data = await res.json();

      if (data.status === "approved") {
        clearInterval(pixPollingTimer);
        clearInterval(pixCountdownTimer);
        document.getElementById("pixStatusDot").className  = "pix-status-dot approved";
        document.getElementById("pixStatusText").textContent = "Pagamento aprovado!";
        showSuccessStage(plan);
      }
    } catch(e) { console.warn("Polling error:", e); }
  }, 5000); // verifica a cada 5s
}

// ─── COPIAR PIX ──────────────────────────────────────────
window.copyPixCode = function() {
  const code = document.getElementById("pixCodeBox").textContent;
  navigator.clipboard.writeText(code).then(() => {
    const btn = document.getElementById("btnCopy");
    btn.classList.add("copied");
    btn.innerHTML = `<svg viewBox="0 0 16 16" fill="none" width="14" height="14"><path d="M3 8l4 4 6-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg> Copiado!`;
    setTimeout(() => {
      btn.classList.remove("copied");
      btn.innerHTML = `<svg viewBox="0 0 16 16" fill="none" width="14" height="14"><rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M3 11H2a1 1 0 01-1-1V2a1 1 0 011-1h8a1 1 0 011 1v1" stroke="currentColor" stroke-width="1.3"/></svg> Copiar`;
    }, 2500);
  });
};

// ─── CARTÃO ──────────────────────────────────────────────
async function createCardPayment({ name, cpf, email, plan }) {
  if (!cardForm) { toast("Formulário de cartão não carregado.", "error"); setSubmitLoading(false); return; }

  let token;
  try {
    const result = await cardForm.createCardToken();
    token = result.token;
  } catch(e) {
    throw new Error("Erro ao tokenizar cartão. Verifique os dados.");
  }

  const installments = parseInt(document.getElementById("installments").value || "1");
  const holderName   = document.getElementById("cardHolderName").value.trim().toUpperCase();

  const res = await fetch(`${FUNCTIONS_BASE}/createPayment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      method:       "card",
      amount:       plan.price,
      planName:     plan.name,
      planDays:     plan.days,
      clientId:     currentClient.uid,
      clientPlan:   currentClient.plano || "",
      clientDays:   Number(currentClient.diasRestantes || 0),
      token,
      installments,
      holderName,
      payer: { name, cpf, email }
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Erro ao processar cartão.");
  }

  const data = await res.json();
  setSubmitLoading(false);

  if (data.status === "approved") {
    showSuccessStage(plan);
  } else if (data.status === "in_process" || data.status === "pending") {
    toast("Pagamento em análise. Você será notificado.", "info", 6000);
    showSuccessStage(plan);
  } else {
    throw new Error(`Pagamento recusado: ${data.status_detail || data.status}`);
  }
}

// ═══════════════════════════════════════════════════════════
//  TELA DE SUCESSO
// ═══════════════════════════════════════════════════════════
function showSuccessStage(plan) {
  const diasAntigos = Number(currentClient.diasRestantes || 0);
  const diasNovos   = plan.days;

  // Lógica: mesmo plano = soma; plano diferente = substitui
  const mesmoPlan = (currentClient.plano || "").toLowerCase() === plan.name.toLowerCase();
  const totalDias = mesmoPlan ? diasAntigos + diasNovos : diasNovos;

  document.getElementById("successName").textContent     = currentClient.nome || "—";
  document.getElementById("successPlan").textContent     = plan.name;
  document.getElementById("successDays").textContent     = `+${diasNovos} dias`;
  document.getElementById("successTotalDays").textContent = `${totalDias} dias`;
  document.getElementById("successValue").textContent    =
    new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(plan.price);

  showStage("stage5");
}

// ═══════════════════════════════════════════════════════════
//  CPF MASK
// ═══════════════════════════════════════════════════════════
document.getElementById("payerCpf").addEventListener("input", function() {
  let v = this.value.replace(/\D/g,"").slice(0,11);
  if (v.length > 9)       v = v.replace(/(\d{3})(\d{3})(\d{3})(\d{0,2})/,"$1.$2.$3-$4");
  else if (v.length > 6)  v = v.replace(/(\d{3})(\d{3})(\d{0,3})/,"$1.$2.$3");
  else if (v.length > 3)  v = v.replace(/(\d{3})(\d{0,3})/,"$1.$2");
  this.value = v;
});

// ═══════════════════════════════════════════════════════════
//  VOLTAR / RESET
// ═══════════════════════════════════════════════════════════
window.goBack = function() {
  currentClient = null; selectedPlan = null; plansOpen = false;
  cardForm = null;
  clearInterval(pixPollingTimer); clearInterval(pixCountdownTimer);
  ufSelect.value = ""; cardInput.value = "";
  preview.textContent = "—"; preview.classList.remove("active");
  document.getElementById("plansWrap").classList.remove("open");
  document.getElementById("btnTogglePlans").classList.remove("active");
  document.querySelectorAll(".plan-card").forEach(c => c.classList.remove("selected"));
  showStage("stage1");
};

window.resetAll = window.goBack;
