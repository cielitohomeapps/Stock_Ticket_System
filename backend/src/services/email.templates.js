const fs = require("fs");
const path = require("path");

// Intenta cargar el logo como base64; si no está disponible, usa texto
function getLogoDataUri() {
  try {
    const logoPath = path.join(__dirname, "../../../frontend/src/assets/logoch.jpeg");
    const data = fs.readFileSync(logoPath);
    return `data:image/jpeg;base64,${data.toString("base64")}`;
  } catch {
    return null;
  }
}

const LOGO_URI = getLogoDataUri();

// ── Colores Cielito Home ──────────────────────────────────────────────────────
const C = {
  green:      "#2d6e62",
  greenDark:  "#1a4f46",
  greenLight: "#e8f4f1",
  gold:       "#c9a84c",
  goldBorder: "#b8a97a",
  white:      "#ffffff",
  bg:         "#f3f8f6",
  border:     "#d4e8e2",
  text:       "#1a2e22",
  textMid:    "#2d4d3a",
  textMuted:  "#5a7a64",
  red:        "#c0392b",
  redLight:   "#fdf0ef",
};

// ── Wrapper HTML base ─────────────────────────────────────────────────────────
function wrapEmail(bodyContent) {
  const logoHtml = LOGO_URI
    ? `<img src="${LOGO_URI}" alt="Cielito Home" style="height:48px;width:48px;object-fit:cover;border-radius:8px;border:2px solid ${C.goldBorder};display:block;" />`
    : `<div style="height:48px;width:48px;border-radius:8px;background:${C.gold};display:inline-block;"></div>`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Cielito Home</title>
</head>
<body style="margin:0;padding:0;background:${C.bg};font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(26,78,70,0.13);border:1px solid ${C.border};">

          <!-- HEADER -->
          <tr>
            <td style="background:${C.green};padding:24px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align:middle;">
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="vertical-align:middle;padding-right:14px;">${logoHtml}</td>
                        <td style="vertical-align:middle;">
                          <div style="color:${C.white};font-size:20px;font-weight:700;letter-spacing:0.01em;line-height:1.2;">Cielito Home</div>
                          <div style="color:rgba(255,255,255,0.75);font-size:12px;letter-spacing:0.08em;text-transform:uppercase;margin-top:2px;">Sistema de tickets</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ACCENT LINE -->
          <tr>
            <td style="background:${C.gold};height:3px;line-height:3px;font-size:1px;">&nbsp;</td>
          </tr>

          <!-- BODY -->
          <tr>
            <td style="background:${C.white};padding:32px 32px 24px;">
              ${bodyContent}
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="background:${C.greenLight};padding:16px 32px;border-top:1px solid ${C.border};">
              <p style="margin:0;font-size:12px;color:${C.textMuted};text-align:center;">
                Este correo fue generado automáticamente por el sistema de tickets de <strong>Cielito Home</strong>.<br/>
                Por favor no respondas directamente a este mensaje.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ── Badge de estado ───────────────────────────────────────────────────────────
function statusBadge(label, approved = true) {
  const bg  = approved ? C.green   : C.red;
  const bg2 = approved ? "#e8f4f1" : C.redLight;
  const fg  = approved ? C.green   : C.red;
  return `<span style="display:inline-block;padding:4px 14px;border-radius:99px;background:${bg2};color:${fg};border:1.5px solid ${bg};font-size:13px;font-weight:600;letter-spacing:0.04em;">${label}</span>`;
}

// ── Fila de datos ─────────────────────────────────────────────────────────────
function dataRow(label, value) {
  return `
  <tr>
    <td style="padding:8px 0;border-bottom:1px solid ${C.border};width:38%;vertical-align:top;">
      <span style="font-size:13px;color:${C.textMuted};font-weight:500;">${label}</span>
    </td>
    <td style="padding:8px 0 8px 16px;border-bottom:1px solid ${C.border};vertical-align:top;">
      <span style="font-size:14px;color:${C.text};font-weight:600;">${value || "—"}</span>
    </td>
  </tr>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// Templates públicos
// ══════════════════════════════════════════════════════════════════════════════

// ── Tabla de items ────────────────────────────────────────────────────────────
function itemsTable(items) {
  if (!Array.isArray(items) || !items.length) return "";

  const rows = items.map((item, i) => {
    const name = item.name || item.nombre || item.productId || item.sku || "—";
    const qty  = item.qty ?? item.cantidad ?? "—";
    const bg   = i % 2 === 0 ? C.white : C.bg;
    return `
    <tr style="background:${bg};">
      <td style="padding:9px 12px;font-size:13px;color:${C.text};border-bottom:1px solid ${C.border};">${name}</td>
      <td style="padding:9px 12px;font-size:13px;color:${C.textMid};border-bottom:1px solid ${C.border};font-family:monospace;">${item.productId || item.sku || "—"}</td>
      <td style="padding:9px 12px;font-size:14px;color:${C.green};font-weight:700;border-bottom:1px solid ${C.border};text-align:right;">${qty}</td>
    </tr>`;
  }).join("");

  return `
  <div style="margin-top:24px;">
    <p style="margin:0 0 8px;font-size:13px;color:${C.textMuted};font-weight:500;text-transform:uppercase;letter-spacing:0.06em;">Productos</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid ${C.border};border-radius:8px;overflow:hidden;">
      <tr style="background:${C.greenLight};">
        <th style="padding:8px 12px;font-size:12px;color:${C.textMid};font-weight:600;text-align:left;letter-spacing:0.05em;text-transform:uppercase;">Producto</th>
        <th style="padding:8px 12px;font-size:12px;color:${C.textMid};font-weight:600;text-align:left;letter-spacing:0.05em;text-transform:uppercase;">ID / SKU</th>
        <th style="padding:8px 12px;font-size:12px;color:${C.textMid};font-weight:600;text-align:right;letter-spacing:0.05em;text-transform:uppercase;">Cantidad</th>
      </tr>
      ${rows}
    </table>
  </div>`;
}

/**
 * Email de ticket aprobado (stock actualizado).
 * @param {object} opts
 * @param {string} opts.ticketId
 * @param {string} opts.type
 * @param {string} [opts.area]
 * @param {string} opts.approvedBy
 * @param {Array}  [opts.items]
 * @param {string} [opts.status]  - etiqueta del estado para el badge
 */
function buildApprovedEmail({ticketId, type, area, approvedBy, items, status = "Aprobado"}) {
  const body = `
    <h2 style="margin:0 0 6px;font-size:22px;color:${C.greenDark};font-weight:700;">Ticket aprobado</h2>
    <p style="margin:0 0 20px;font-size:14px;color:${C.textMuted};">El siguiente ticket ha sido procesado y el stock fue actualizado.</p>

    <div style="margin-bottom:20px;">${statusBadge(status)}</div>

    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      ${dataRow("N° de Ticket", `<span style="font-family:monospace;">${ticketId}</span>`)}
      ${dataRow("Tipo", type)}
      ${area ? dataRow("Área", area) : ""}
      ${dataRow("Aprobado por", approvedBy)}
    </table>

    ${itemsTable(items)}

    <div style="margin-top:28px;padding:14px 18px;background:${C.greenLight};border-left:4px solid ${C.green};border-radius:0 8px 8px 0;">
      <p style="margin:0;font-size:13px;color:${C.textMid};">
        El inventario ha sido actualizado automáticamente. Si tienes alguna duda, comunícate con el administrador.
      </p>
    </div>
  `;
  return wrapEmail(body);
}

/**
 * Email de ticket rechazado.
 * @param {object} opts
 * @param {string} opts.ticketId
 * @param {string} opts.type
 * @param {string} [opts.area]
 * @param {string} opts.rejectedBy
 * @param {string} [opts.comment]
 */
/**
 * Email de ticket rechazado.
 * @param {object} opts
 * @param {string} opts.ticketId
 * @param {string} opts.type
 * @param {string} [opts.area]
 * @param {string} opts.rejectedBy
 * @param {Array}  [opts.items]
 * @param {string} [opts.comment]
 */
function buildRejectedEmail({ticketId, type, area, rejectedBy, items, comment}) {
  const body = `
    <h2 style="margin:0 0 6px;font-size:22px;color:${C.red};font-weight:700;">Ticket rechazado</h2>
    <p style="margin:0 0 20px;font-size:14px;color:${C.textMuted};">El siguiente ticket ha sido rechazado.</p>

    <div style="margin-bottom:20px;">${statusBadge("Rechazado", false)}</div>

    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      ${dataRow("N° de Ticket", `<span style="font-family:monospace;">${ticketId}</span>`)}
      ${dataRow("Tipo", type)}
      ${area ? dataRow("Área", area) : ""}
      ${dataRow("Rechazado por", rejectedBy)}
    </table>

    ${itemsTable(items)}

    ${comment ? `
    <div style="margin-top:24px;">
      <p style="margin:0 0 8px;font-size:13px;color:${C.textMuted};font-weight:500;text-transform:uppercase;letter-spacing:0.06em;">Motivo</p>
      <div style="padding:14px 18px;background:${C.redLight};border-left:4px solid ${C.red};border-radius:0 8px 8px 0;font-size:14px;color:${C.text};">${comment}</div>
    </div>` : ""}
  `;
  return wrapEmail(body);
}

module.exports = {buildApprovedEmail, buildRejectedEmail};
