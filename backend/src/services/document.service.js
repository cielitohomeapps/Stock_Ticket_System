const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const {
  Document, Packer, Paragraph, Table, TableRow, TableCell,
  TextRun, AlignmentType, BorderStyle, WidthType, ShadingType,
} = require("docx");

// ── Design tokens ──────────────────────────────────────────────────────────────
// (matches App.css / email.templates.js)
const C = {
  green:      "#2d6e62",
  greenDark:  "#1a4f46",
  greenLight: "#e8f4f1",
  gold:       "#c9a84c",
  white:      "#ffffff",
  bg:         "#f3f8f6",
  border:     "#d4e8e2",
  text:       "#1a2e22",
  textMid:    "#2d4d3a",
  textMuted:  "#5a7a64",
  red:        "#c0392b",
  redLight:   "#fdf0ef",
};

// Same without "#" for docx shading
const D = Object.fromEntries(Object.entries(C).map(([k, v]) => [k, v.slice(1)]));

const LOGO_PATH = path.join(__dirname, "../../../frontend/src/assets/logoch.jpeg");

const TYPE_LABEL = {ENTRY: "Entrada", EXIT: "Salida"};

const STATUS_STYLE = {
  CREADO:            {label: "Creado",           bg: C.greenLight, fg: C.green},
  EN_REVISION:       {label: "En revisión",      bg: "#fdf6e3",    fg: "#9a7830"},
  RECHAZADO:         {label: "Rechazado",         bg: C.redLight,   fg: C.red},
  STOCK_ACTUALIZADO: {label: "Stock actualizado", bg: C.greenLight, fg: C.greenDark},
  NOTIFICADO:        {label: "Notificado",        bg: C.greenLight, fg: C.greenDark},
};

function getStatusStyle(s) {
  return STATUS_STYLE[s] || {label: s || "—", bg: C.bg, fg: C.textMuted};
}

function formatDate(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString("es-MX", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// PDF
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Streams a PDF into the provided Express res object.
 */
function generatePdf(ticket, res) {
  const doc = new PDFDocument({margin: 0, size: "A4"});

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
      "Content-Disposition",
      `attachment; filename="ticket-${ticket.id}.pdf"`,
  );
  doc.pipe(res);

  const W  = 595;          // A4 width (pt)
  const H  = 842;          // A4 height (pt)
  const M  = 40;           // page margin
  const CW = W - M * 2;    // content width: 515

  const area   = ticket.metadata?.area    || "—";
  const tipo   = TYPE_LABEL[ticket.type]   || ticket.type;
  const razon  = ticket.metadata?.motivo   || "";
  const destino = ticket.metadata?.destino || "";
  const firma  = ticket.metadata?.firma    || "";
  const fecha  = formatDate(ticket.createdAt);
  const items  = ticket.items || [];
  const ss     = getStatusStyle(ticket.status);

  // ── FULL PAGE BACKGROUND ────────────────────────────────────────────────────
  doc.rect(0, 0, W, H).fill(C.bg);

  // ── HEADER ──────────────────────────────────────────────────────────────────
  doc.rect(0, 0, W, 88).fill(C.green);

  if (fs.existsSync(LOGO_PATH)) {
    doc.image(LOGO_PATH, M, 22, {width: 44, height: 44});
  }

  doc.fillColor(C.white).font("Helvetica-Bold").fontSize(19)
      .text("Cielito Home", M + 54, 28, {lineBreak: false});
  doc.fillColor(C.greenLight).font("Helvetica").fontSize(10)
      .text("Sistema de Tickets", M + 54, 51, {lineBreak: false});

  // Ticket-type badge (right side of header)
  const bW = 172;
  const bX = W - M - bW;
  doc.roundedRect(bX, 24, bW, 40, 8).lineWidth(1.5).stroke(C.gold);
  doc.fillColor(C.white).font("Helvetica-Bold").fontSize(11)
      .text(`TICKET DE ${String(tipo).toUpperCase()}`, bX, 37, {
        width: bW, align: "center", lineBreak: false,
      });

  // ── GOLD ACCENT BAR ──────────────────────────────────────────────────────────
  doc.rect(0, 88, W, 4).fill(C.gold);

  // ── WHITE CONTENT CARD ───────────────────────────────────────────────────────
  doc.roundedRect(M - 4, 106, CW + 8, H - 158, 10).fill(C.white);

  let y = 124;

  // ── TICKET ID + STATUS PILL ──────────────────────────────────────────────────
  doc.fillColor(C.greenDark).font("Helvetica-Bold").fontSize(18)
      .text(`Ticket  #${ticket.id}`, M + 4, y, {lineBreak: false});

  const pillW = 132;
  const pillX = W - M - pillW - 4;
  doc.roundedRect(pillX, y - 1, pillW, 24, 12).fill(ss.bg);
  doc.fillColor(ss.fg).font("Helvetica-Bold").fontSize(10)
      .text(ss.label, pillX, y + 6, {width: pillW, align: "center", lineBreak: false});

  y += 34;

  // ── SEPARATOR ────────────────────────────────────────────────────────────────
  doc.moveTo(M + 4, y).lineTo(W - M - 4, y).lineWidth(0.75).strokeColor(C.border).stroke();
  y += 14;

  // ── INFO GRID (2 columns) ────────────────────────────────────────────────────
  const halfW = (CW - 16) / 2;
  const col2X = M + 4 + halfW + 16;

  function infoBlock(label, value, x, startY) {
    doc.fillColor(C.textMuted).font("Helvetica").fontSize(8)
        .text(label.toUpperCase(), x, startY, {width: halfW, lineBreak: false});
    doc.fillColor(C.text).font("Helvetica-Bold").fontSize(13)
        .text(value, x, startY + 12, {width: halfW, lineBreak: false, ellipsis: true});
    return startY + 38;
  }

  const leftInfo  = [["Área", area], ["Tipo", tipo], ["Fecha de creación", fecha]];
  const rightInfo = [
    ["ID de Ticket", ticket.id],
    ["Total de productos", String(items.length)],
    ["Firma responsable", firma || "—"],
  ];

  let yL = y;
  let yR = y;
  leftInfo.forEach(([l, v])  => { yL = infoBlock(l, v, M + 4, yL); });
  rightInfo.forEach(([l, v]) => { yR = infoBlock(l, v, col2X,  yR); });
  y = Math.max(yL, yR) + 6;

  // ── SEPARATOR ────────────────────────────────────────────────────────────────
  doc.moveTo(M + 4, y).lineTo(W - M - 4, y).lineWidth(0.75).strokeColor(C.border).stroke();
  y += 14;

  // ── PRODUCTS TABLE ───────────────────────────────────────────────────────────
  if (items.length) {
    doc.fillColor(C.textMuted).font("Helvetica-Bold").fontSize(8)
        .text("PRODUCTOS", M + 4, y, {lineBreak: false});
    y += 13;

    const tW = CW - 8;
    const cW = [tW * 0.50, tW * 0.30, tW * 0.20];
    const cX = [M + 4, M + 4 + cW[0], M + 4 + cW[0] + cW[1]];
    const rH = 24;

    // Header row
    doc.rect(M + 4, y, tW, rH).fill(C.greenLight);
    doc.rect(M + 4, y, tW, rH).lineWidth(0.75).stroke(C.border);
    ["Producto", "ID / SKU", "Cantidad"].forEach((h, i) => {
      doc.fillColor(C.textMid).font("Helvetica-Bold").fontSize(9)
          .text(h, cX[i] + 5, y + 8, {width: cW[i] - 8, lineBreak: false});
    });
    y += rH;

    items.forEach((item, idx) => {
      const name = item.name || item.nombre || item.productId || "—";
      const sku  = item.productId || item.sku || "—";
      const qty  = String(item.qty ?? item.cantidad ?? "—");

      doc.rect(M + 4, y, tW, rH).fill(idx % 2 === 0 ? C.white : C.bg);
      doc.rect(M + 4, y, tW, rH).lineWidth(0.5).stroke(C.border);

      // Column dividers
      cX.slice(1).forEach((cx) => {
        doc.moveTo(cx, y).lineTo(cx, y + rH).lineWidth(0.5).stroke(C.border);
      });

      doc.fillColor(C.text).font("Helvetica").fontSize(11)
          .text(name, cX[0] + 5, y + 7, {width: cW[0] - 10, lineBreak: false, ellipsis: true});
      doc.fillColor(C.textMid).font("Helvetica").fontSize(10)
          .text(sku, cX[1] + 5, y + 7, {width: cW[1] - 10, lineBreak: false, ellipsis: true});
      doc.fillColor(C.green).font("Helvetica-Bold").fontSize(12)
          .text(qty, cX[2] + 5, y + 6, {width: cW[2] - 10, align: "right", lineBreak: false});

      y += rH;
    });
    y += 14;
  }

  // ── RAZÓN + DESTINO + FIRMA ────────────────────────────────────────────────
  doc.moveTo(M + 4, y).lineTo(W - M - 4, y).lineWidth(0.75).strokeColor(C.border).stroke();
  y += 14;

  if (razon) {
    doc.fillColor(C.textMuted).font("Helvetica-Bold").fontSize(8)
        .text("RAZÓN", M + 4, y, {lineBreak: false});
    y += 13;

    doc.rect(M + 4, y, CW - 8, 42).fill(C.greenLight);
    doc.rect(M + 4, y, CW - 8, 42).lineWidth(0.75).stroke(C.border);
    doc.rect(M + 4, y, 4, 42).fill(C.green);
    doc.fillColor(C.text).font("Helvetica").fontSize(11)
        .text(razon, M + 14, y + 13, {width: CW - 24, lineBreak: false, ellipsis: true});
    y += 56;
  }

  // Bottom row: Destino (left) + Firma (right) — mirroring the UI layout
  const halfW2 = (CW - 16) / 2;
  const col2X2 = M + 4 + halfW2 + 16;

  // Destino
  doc.fillColor(C.textMuted).font("Helvetica-Bold").fontSize(8)
      .text("DESTINO", M + 4, y, {width: halfW2, lineBreak: false});
  doc.moveTo(M + 4, y + 18).lineTo(M + 4 + halfW2, y + 18).lineWidth(1).strokeColor(C.border).stroke();
  doc.fillColor(C.text).font("Helvetica").fontSize(11)
      .text(destino || "—", M + 4, y + 4, {width: halfW2, lineBreak: false, ellipsis: true});

  // Firma
  doc.fillColor(C.textMuted).font("Helvetica-Bold").fontSize(8)
      .text("FIRMA", col2X2, y, {width: halfW2, lineBreak: false});
  doc.moveTo(col2X2, y + 18).lineTo(col2X2 + halfW2, y + 18).lineWidth(1).strokeColor(C.border).stroke();
  doc.fillColor(C.text).font("Helvetica").fontSize(11)
      .text(firma || "—", col2X2, y + 4, {width: halfW2, lineBreak: false, ellipsis: true});

  // ── FOOTER ───────────────────────────────────────────────────────────────────
  doc.rect(0, H - 48, W, 4).fill(C.gold);
  doc.rect(0, H - 44, W, 44).fill(C.green);
  doc.fillColor(C.greenLight).font("Helvetica").fontSize(9)
      .text(
          `Generado el ${new Date().toLocaleString("es-MX")} · Cielito Home · Sistema de Tickets`,
          M, H - 24, {width: CW, align: "center", lineBreak: false},
      );

  doc.end();
}

// ══════════════════════════════════════════════════════════════════════════════
// WORD
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Returns a Buffer containing the .docx file.
 */
async function generateWord(ticket) {
  const area    = ticket.metadata?.area    || "—";
  const tipo    = TYPE_LABEL[ticket.type]   || ticket.type;
  const razon   = ticket.metadata?.motivo   || "";
  const destino = ticket.metadata?.destino  || "—";
  const firma   = ticket.metadata?.firma    || "—";
  const fecha   = formatDate(ticket.createdAt);
  const items   = ticket.items || [];
  const ss      = getStatusStyle(ticket.status);

  // ── Helpers ────────────────────────────────────────────────────────────────
  const noBorder = {style: BorderStyle.NONE, size: 0, color: "auto"};
  const thinBorder = {style: BorderStyle.SINGLE, size: 4, color: D.border};
  const allNoBorder = {top: noBorder, bottom: noBorder, left: noBorder, right: noBorder};
  const allThinBorder = {top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder};

  function shading(hexColor) {
    return {type: ShadingType.CLEAR, fill: hexColor, color: "auto"};
  }

  function cell(children, opts = {}) {
    return new TableCell({
      children,
      borders: opts.borders ?? allNoBorder,
      shading: opts.fill ? shading(opts.fill) : undefined,
      width: opts.width,
      margins: {
        top: 80, bottom: 80,
        left: opts.paddingH ?? 120, right: opts.paddingH ?? 120,
      },
      columnSpan: opts.span,
    });
  }

  function run(text, opts = {}) {
    return new TextRun({
      text: String(text ?? ""),
      bold:       opts.bold,
      italics:    opts.italic,
      color:      opts.color ?? D.text,
      size:       opts.size  ?? 22,
      font:       "Calibri",
    });
  }

  function para(runs, opts = {}) {
    return new Paragraph({
      children: Array.isArray(runs) ? runs : [runs],
      alignment: opts.align,
      spacing:   {before: opts.before ?? 60, after: opts.after ?? 60},
    });
  }

  // ── Header table ──────────────────────────────────────────────────────────
  const headerTable = new Table({
    width: {size: 100, type: WidthType.PERCENTAGE},
    borders: allNoBorder,
    rows: [
      new TableRow({
        children: [
          cell([
            para(run("Cielito Home", {bold: true, size: 32, color: D.white}),
                {before: 40, after: 0}),
            para(run("Sistema de Tickets", {size: 18, color: D.greenLight}),
                {before: 0, after: 40}),
          ], {fill: D.green, width: {size: 60, type: WidthType.PERCENTAGE}}),

          cell([
            para(
                [
                  run(`TICKET DE ${String(tipo).toUpperCase()}`, {
                    bold: true, size: 24, color: D.gold,
                  }),
                ],
                {align: AlignmentType.RIGHT, before: 40, after: 0},
            ),
            para(
                run(`#${ticket.id}`, {size: 18, color: D.white}),
                {align: AlignmentType.RIGHT, before: 0, after: 40},
            ),
          ], {fill: D.green, width: {size: 40, type: WidthType.PERCENTAGE}}),
        ],
      }),
      // Gold accent row
      new TableRow({
        height: {value: 60, rule: "exact"},
        children: [
          cell([para(run(""))], {fill: D.gold, span: 2,
            width: {size: 100, type: WidthType.PERCENTAGE}}),
        ],
      }),
    ],
  });

  // ── Status badge row ──────────────────────────────────────────────────────
  const statusRow = new Table({
    width: {size: 100, type: WidthType.PERCENTAGE},
    borders: allNoBorder,
    rows: [
      new TableRow({
        children: [
          cell([
            para(run(ss.label, {bold: true, size: 20, color: ss.fg.slice(1)}),
                {align: AlignmentType.LEFT}),
          ], {fill: ss.bg.slice(1), borders: allThinBorder}),
        ],
      }),
    ],
  });

  // ── Info grid ─────────────────────────────────────────────────────────────
  function infoCell(label, value) {
    return cell([
      para(run(label.toUpperCase(),
          {size: 16, color: D.textMuted}), {after: 20}),
      para(run(value, {bold: true, size: 22, color: D.text})),
    ], {borders: allThinBorder, fill: D.bg});
  }

  const infoTable = new Table({
    width: {size: 100, type: WidthType.PERCENTAGE},
    borders: allNoBorder,
    rows: [
      new TableRow({children: [infoCell("Área", area),           infoCell("Tipo", tipo)]}),
      new TableRow({children: [infoCell("Fecha de creación", fecha), infoCell("ID de Ticket", ticket.id)]}),
      new TableRow({children: [infoCell("Total de productos", String(items.length)), infoCell("Firma responsable", firma)]}),
      new TableRow({children: [infoCell("Destino", destino), infoCell("", "")]}),
    ],
  });

  // ── Products table ────────────────────────────────────────────────────────
  const productHeaderRow = new TableRow({
    tableHeader: true,
    children: [
      cell([para(run("Producto", {bold: true, size: 20, color: D.textMid}))],
          {fill: D.greenLight, borders: allThinBorder,
            width: {size: 50, type: WidthType.PERCENTAGE}}),
      cell([para(run("ID / SKU", {bold: true, size: 20, color: D.textMid}))],
          {fill: D.greenLight, borders: allThinBorder,
            width: {size: 30, type: WidthType.PERCENTAGE}}),
      cell([para(run("Cantidad", {bold: true, size: 20, color: D.textMid}),
          {align: AlignmentType.RIGHT})],
          {fill: D.greenLight, borders: allThinBorder,
            width: {size: 20, type: WidthType.PERCENTAGE}}),
    ],
  });

  const productDataRows = items.map((item, idx) => {
    const name = item.name || item.nombre || item.productId || "—";
    const sku  = item.productId || item.sku || "—";
    const qty  = String(item.qty ?? item.cantidad ?? "—");
    const bg   = idx % 2 === 0 ? D.white : D.bg;

    return new TableRow({
      children: [
        cell([para(run(name, {size: 22}))],
            {fill: bg, borders: allThinBorder,
              width: {size: 50, type: WidthType.PERCENTAGE}}),
        cell([para(run(sku, {size: 20, color: D.textMid}))],
            {fill: bg, borders: allThinBorder,
              width: {size: 30, type: WidthType.PERCENTAGE}}),
        cell([para(run(qty, {bold: true, size: 22, color: D.green}),
            {align: AlignmentType.RIGHT})],
            {fill: bg, borders: allThinBorder,
              width: {size: 20, type: WidthType.PERCENTAGE}}),
      ],
    });
  });

  const productsTable = new Table({
    width: {size: 100, type: WidthType.PERCENTAGE},
    rows: [productHeaderRow, ...productDataRows],
  });

  // ── Reason + Destino block ──────────────────────────────────────────────────────────
  const reasonBlock = razon ? [
    para(run("RAZÓN", {size: 16, color: D.textMuted, bold: true}),
        {before: 160, after: 60}),
    new Table({
      width: {size: 100, type: WidthType.PERCENTAGE},
      borders: allNoBorder,
      rows: [new TableRow({
        children: [
          cell([para(run(razon, {size: 22}))],
              {fill: D.greenLight, borders: allThinBorder}),
        ],
      })],
    }),
  ] : [];

  // ── Footer paragraph ──────────────────────────────────────────────────────
  const footer = para(
      run(
          `Generado el ${new Date().toLocaleString("es-MX")} · Cielito Home · Sistema de Tickets`,
          {size: 16, color: D.textMuted},
      ),
      {align: AlignmentType.CENTER, before: 200},
  );

  // ── Assemble document ─────────────────────────────────────────────────────
  const doc = new Document({
    sections: [{
      properties: {
        page: {margin: {top: 720, right: 720, bottom: 720, left: 720}},
      },
      children: [
        headerTable,
        para(run("")),
        statusRow,
        para(run(""), {before: 120}),
        infoTable,
        para(run("PRODUCTOS", {size: 16, color: D.textMuted, bold: true}),
            {before: 160, after: 80}),
        productsTable,
        ...reasonBlock,
        footer,
      ],
    }],
  });

  return Packer.toBuffer(doc);
}

module.exports = {generatePdf, generateWord};
