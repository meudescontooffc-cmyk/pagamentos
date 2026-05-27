// ═══════════════════════════════════════════════════════════
//  FIREBASE FUNCTIONS — BACKEND SEGURO
//  ACCESS TOKEN fica SOMENTE aqui, nunca no front-end
//
//  Deploy:
//    firebase deploy --only functions
//
//  Dependências (package.json):
//    "mercadopago": "^2.0.0"
//    "firebase-admin": "^12.0.0"
//    "firebase-functions": "^4.0.0"
// ═══════════════════════════════════════════════════════════

const functions  = require("firebase-functions");
const admin      = require("firebase-admin");
const { MercadoPagoConfig, Payment } = require("mercadopago");

admin.initializeApp();
const db = admin.firestore();

// ══ ACCESS TOKEN — seguro no backend ══════════════════════
const MP_ACCESS_TOKEN =
  "APP_USR-8538693089781751-032620-83aa3e7d777932f633436fe903f760b5-3288610998";

const mpClient = new MercadoPagoConfig({
  accessToken: MP_ACCESS_TOKEN,
  options: { timeout: 10000 }
});
const paymentClient = new Payment(mpClient);

// ══ CORS helper ═══════════════════════════════════════════
function setCors(res) {
  res.set("Access-Control-Allow-Origin",  "*");
  res.set("Access-Control-Allow-Methods", "POST,GET,OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
}

// ═══════════════════════════════════════════════════════════
//  createPayment — cria PIX ou cartão
// ═══════════════════════════════════════════════════════════
exports.createPayment = functions.https.onRequest(async (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST")    { res.status(405).json({ message: "Method not allowed" }); return; }

  const {
    method, amount, planName, planDays,
    clientId, clientPlan, clientDays,
    payer, token, installments, holderName
  } = req.body;

  // Validações básicas
  if (!method || !amount || !clientId || !payer?.cpf || !payer?.email) {
    res.status(400).json({ message: "Dados incompletos." });
    return;
  }

  // Idempotency key por clientId + timestamp
  const idempotencyKey = `${clientId}-${Date.now()}`;

  try {
    let paymentData = {
      transaction_amount: Number(amount),
      description:        planName,
      external_reference: clientId,
      payer: {
        email:            payer.email,
        first_name:       payer.name?.split(" ")[0] || "",
        last_name:        payer.name?.split(" ").slice(1).join(" ") || "",
        identification: {
          type:   "CPF",
          number: payer.cpf.replace(/\D/g,"")
        }
      }
    };

    if (method === "pix") {
      paymentData.payment_method_id = "pix";
    } else if (method === "card") {
      if (!token) { res.status(400).json({ message: "Token do cartão ausente." }); return; }
      paymentData.token            = token;
      paymentData.installments     = Number(installments) || 1;
      paymentData.payment_method_id = "";  // MP detecta pela bandeira do token
      paymentData.card = { cardholder: { name: holderName || payer.name } };
    } else {
      res.status(400).json({ message: "Método inválido." });
      return;
    }

    const mpRes = await paymentClient.create({
      body: paymentData,
      requestOptions: { idempotencyKey }
    });

    // ── Salva pagamento pendente no Firestore ──────────
    await db.collection("pagamentos").doc(String(mpRes.id)).set({
      paymentId:    mpRes.id,
      clientId,
      planName,
      planDays:     Number(planDays),
      clientPlan:   clientPlan || "",
      clientDays:   Number(clientDays || 0),
      amount:       Number(amount),
      method,
      status:       mpRes.status,
      createdAt:    admin.firestore.FieldValue.serverTimestamp()
    });

    // ── Se cartão aprovado na hora, atualiza cliente ───
    if (method === "card" && mpRes.status === "approved") {
      await updateClient({ clientId, planName, planDays, clientPlan, clientDays, amount });
    }

    // ── Monta resposta ─────────────────────────────────
    const response = {
      id:     mpRes.id,
      status: mpRes.status
    };

    if (method === "pix") {
      response.qrCode       = mpRes.point_of_interaction?.transaction_data?.qr_code || "";
      response.qrCodeBase64 = mpRes.point_of_interaction?.transaction_data?.qr_code_base64 || "";
    } else {
      response.status_detail = mpRes.status_detail;
    }

    res.status(200).json(response);

  } catch(err) {
    console.error("createPayment error:", err);
    const msg = err?.cause?.[0]?.description || err.message || "Erro no Mercado Pago.";
    res.status(500).json({ message: msg });
  }
});

// ═══════════════════════════════════════════════════════════
//  checkPayment — verifica status de pagamento PIX
// ═══════════════════════════════════════════════════════════
exports.checkPayment = functions.https.onRequest(async (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }

  const { id } = req.query;
  if (!id) { res.status(400).json({ message: "ID ausente." }); return; }

  try {
    const mpRes = await paymentClient.get({ id: String(id) });

    // Se aprovado, atualiza cliente e registro de pagamento
    if (mpRes.status === "approved") {
      const pagRef = db.collection("pagamentos").doc(String(id));
      const pagSnap = await pagRef.get();

      if (pagSnap.exists && pagSnap.data().status !== "approved") {
        const pag = pagSnap.data();
        await updateClient({
          clientId:   pag.clientId,
          planName:   pag.planName,
          planDays:   pag.planDays,
          clientPlan: pag.clientPlan,
          clientDays: pag.clientDays,
          amount:     pag.amount
        });
        await pagRef.update({ status: "approved" });
      }
    }

    res.status(200).json({ status: mpRes.status });

  } catch(err) {
    console.error("checkPayment error:", err);
    res.status(500).json({ message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
//  Webhook MP (opcional — recomendado para produção)
//  Configure em: MP Developers > Webhooks > URL desta função
// ═══════════════════════════════════════════════════════════
exports.mpWebhook = functions.https.onRequest(async (req, res) => {
  setCors(res);
  if (req.method !== "POST") { res.status(200).send("OK"); return; }

  const { action, data } = req.body;
  if (action === "payment.updated" && data?.id) {
    try {
      const mpRes = await paymentClient.get({ id: String(data.id) });
      if (mpRes.status === "approved") {
        const pagRef  = db.collection("pagamentos").doc(String(data.id));
        const pagSnap = await pagRef.get();
        if (pagSnap.exists && pagSnap.data().status !== "approved") {
          const pag = pagSnap.data();
          await updateClient({
            clientId:   pag.clientId,
            planName:   pag.planName,
            planDays:   pag.planDays,
            clientPlan: pag.clientPlan,
            clientDays: pag.clientDays,
            amount:     pag.amount
          });
          await pagRef.update({ status: "approved" });
        }
      }
    } catch(e) { console.error("Webhook error:", e); }
  }
  res.status(200).send("OK");
});

// ═══════════════════════════════════════════════════════════
//  updateClient — atualiza clientes/{id} no Firestore
//
//  Regra:
//  - Mesmo plano → soma os dias
//  - Plano diferente → substitui com os novos dias
// ═══════════════════════════════════════════════════════════
async function updateClient({ clientId, planName, planDays, clientPlan, clientDays, amount }) {
  const ref   = db.collection("clientes").doc(clientId);
  const snap  = await ref.get();
  if (!snap.exists) return;

  const current    = snap.data();
  const diasAtuais = Number(current.diasRestantes || clientDays || 0);
  const mesmoPlan  = (current.plano || clientPlan || "").toLowerCase() === planName.toLowerCase();

  const novosDias = mesmoPlan
    ? diasAtuais + Number(planDays)   // renova: soma
    : Number(planDays);               // troca: substitui

  const hoje        = new Date();
  const dataRenovacao = new Date(hoje.getTime() + novosDias * 86400000);

  await ref.update({
    plano:            planName,
    valorPlano:       Number(amount),
    diasRestantes:    novosDias,
    statusPagamento:  "aprovado",
    dataRenovacao:    dataRenovacao.toISOString().split("T")[0],
    ultimoPagamento:  hoje.toISOString().split("T")[0]
  });
}
