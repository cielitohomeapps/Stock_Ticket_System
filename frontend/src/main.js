const elements = {
  userId: document.getElementById("userId"),
  userRole: document.getElementById("userRole"),
  authToken: document.getElementById("authToken"),
  apiBase: document.getElementById("apiBase"),
  ticketType: document.getElementById("ticketType"),
  assignedUsers: document.getElementById("assignedUsers"),
  ticketItems: document.getElementById("ticketItems"),
  ticketMetadata: document.getElementById("ticketMetadata"),
  ticketId: document.getElementById("ticketId"),
  rejectComment: document.getElementById("rejectComment"),
  output: document.getElementById("output"),
};

function parseJsonField(value, defaultValue) {
  if (!value.trim()) return defaultValue;
  return JSON.parse(value);
}

function getHeaders() {
  const headers = {
    "Content-Type": "application/json",
    "x-user-id": elements.userId.value.trim() || "demo.user",
    "x-user-role": elements.userRole.value,
  };

  const token = elements.authToken.value.trim();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

function writeOutput(title, payload, isError = false) {
  const stamp = new Date().toLocaleTimeString();
  const formatted = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  const prefix = isError ? "ERROR" : "OK";
  elements.output.textContent = `[${stamp}] ${prefix} - ${title}\n\n${formatted}`;
}

async function callApi({title, path, method = "GET", body}) {
  const base = elements.apiBase.value.trim().replace(/\/$/, "");
  const url = `${base}${path}`;

  try {
    const response = await fetch(url, {
      method,
      headers: getHeaders(),
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await response.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : {ok: response.ok};
    } catch {
      parsed = {raw: text};
    }

    if (!response.ok) {
      writeOutput(`${title} (${response.status})`, parsed, true);
      return null;
    }

    writeOutput(`${title} (${response.status})`, parsed);
    return parsed;
  } catch (error) {
    writeOutput(title, error.message, true);
    return null;
  }
}

async function createTicket() {
  try {
    const assignedUsers = elements.assignedUsers.value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    const body = {
      type: elements.ticketType.value,
      items: parseJsonField(elements.ticketItems.value, []),
      assignedUsers,
      metadata: parseJsonField(elements.ticketMetadata.value, {}),
    };

    const result = await callApi({title: "Crear ticket", path: "/tickets", method: "POST", body});
    if (result && result.ticketId) {
      elements.ticketId.value = result.ticketId;
    }
  } catch (error) {
    writeOutput("Validando formulario", error.message, true);
  }
}

function requireTicketId() {
  const id = elements.ticketId.value.trim();
  if (!id) {
    writeOutput("Ticket ID requerido", "Ingresa un ticketId para esta accion", true);
    return null;
  }
  return id;
}

document.getElementById("createTicketBtn").addEventListener("click", createTicket);

document.getElementById("sendReviewBtn").addEventListener("click", async () => {
  const id = requireTicketId();
  if (!id) return;
  await callApi({
    title: "Enviar a revision",
    path: `/tickets/${encodeURIComponent(id)}/send-review`,
    method: "POST",
  });
});

document.getElementById("approveBtn").addEventListener("click", async () => {
  const id = requireTicketId();
  if (!id) return;
  await callApi({
    title: "Aprobar ticket",
    path: `/tickets/${encodeURIComponent(id)}/review`,
    method: "POST",
    body: {decision: "APPROVE"},
  });
});

document.getElementById("rejectBtn").addEventListener("click", async () => {
  const id = requireTicketId();
  if (!id) return;
  await callApi({
    title: "Rechazar ticket",
    path: `/tickets/${encodeURIComponent(id)}/review`,
    method: "POST",
    body: {
      decision: "REJECT",
      comment: elements.rejectComment.value.trim(),
    },
  });
});

document.getElementById("getTicketBtn").addEventListener("click", async () => {
  const id = requireTicketId();
  if (!id) return;
  await callApi({
    title: "Consultar ticket",
    path: `/tickets/${encodeURIComponent(id)}`,
    method: "GET",
  });
});

document.getElementById("healthBtn").addEventListener("click", async () => {
  await callApi({title: "Health", path: "/health", method: "GET"});
});

document.getElementById("clearOutputBtn").addEventListener("click", () => {
  elements.output.textContent = "Listo para probar.";
});

writeOutput("Inicializacion", {apiBase: elements.apiBase.value});
