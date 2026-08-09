/**
 * Generates Phase-1 demo deck as PPTX (import into Google Slides).
 * Run: node scripts/create-infra-demo-pptx.mjs
 */
const PptxGenJS = require("pptxgenjs");
const path = require("path");
const fs = require("fs");

const outDir = path.join(__dirname, "..", "docs");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "InfraSpecs-InfraBilling-Phase1-Demo.pptx");

const pptx = new PptxGenJS();
pptx.defineLayout({ name: "WIDE", width: 13.333, height: 7.5 });
pptx.layout = "WIDE";
pptx.author = "Snehitha";
pptx.title = "InfraSpecs & InfraBilling — Phase-1 Demo";

const NAVY = "0F172A";
const SLATE = "334155";
const MUTED = "64748B";
const LINE = "E2E8F0";
const CARD = "F8FAFC";
const ACCENT = "0F766E"; // teal — avoid purple defaults

function addFooter(slide, n, total) {
  slide.addText("InfraSpecs & InfraBilling · Phase-1", {
    x: 0.5,
    y: 7.1,
    w: 10,
    h: 0.25,
    fontSize: 10,
    color: MUTED,
    fontFace: "Calibri",
  });
  slide.addText(`${n} / ${total}`, {
    x: 11.5,
    y: 7.1,
    w: 1.3,
    h: 0.25,
    fontSize: 10,
    color: MUTED,
    align: "right",
    fontFace: "Calibri",
  });
}

function titleBar(slide, title, subtitle) {
  slide.addShape(pptx.shapes.RECTANGLE, {
    x: 0,
    y: 0,
    w: 13.333,
    h: 0.15,
    fill: { color: ACCENT },
    line: { color: ACCENT },
  });
  slide.addText(title, {
    x: 0.6,
    y: 0.4,
    w: 12,
    h: 0.5,
    fontSize: 28,
    bold: true,
    color: NAVY,
    fontFace: "Calibri",
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.6,
      y: 0.95,
      w: 12,
      h: 0.35,
      fontSize: 14,
      color: MUTED,
      fontFace: "Calibri",
    });
  }
}

const TOTAL = 8;

// ---- 1 Title ----
{
  const s = pptx.addSlide();
  s.addShape(pptx.shapes.RECTANGLE, {
    x: 0,
    y: 0,
    w: 13.333,
    h: 7.5,
    fill: { color: NAVY },
  });
  s.addShape(pptx.shapes.RECTANGLE, {
    x: 0,
    y: 0,
    w: 0.2,
    h: 7.5,
    fill: { color: ACCENT },
  });
  s.addText("InfraSpecs & InfraBilling", {
    x: 0.9,
    y: 2.4,
    w: 11,
    h: 0.7,
    fontSize: 36,
    bold: true,
    color: "FFFFFF",
    fontFace: "Calibri",
  });
  s.addText("Phase-1 Demo", {
    x: 0.9,
    y: 3.15,
    w: 11,
    h: 0.45,
    fontSize: 22,
    color: "99F6E4",
    fontFace: "Calibri",
  });
  s.addText("Inventory → Upload invoice → Extract → Check scope → Report (USD)", {
    x: 0.9,
    y: 4.0,
    w: 11,
    h: 0.4,
    fontSize: 14,
    color: "CBD5E1",
    fontFace: "Calibri",
  });
  s.addText("Snehitha  ·  Proj-Mgmt-DB", {
    x: 0.9,
    y: 6.5,
    w: 11,
    h: 0.3,
    fontSize: 13,
    color: "94A3B8",
    fontFace: "Calibri",
  });
}

// ---- 2 What we built ----
{
  const s = pptx.addSlide();
  titleBar(s, "What we built", "Phase-1 billing flow for a project");
  const items = [
    ["InfraSpecs", "Authorized cloud/SaaS resources per project (EC2, S3, Lambda, …)"],
    ["Invoice upload", "Upload vendor bill (PDF / image / text) and store it"],
    ["Extraction", "Parse header + service line items from the file"],
    ["Discrepancy checks", "Out-of-scope charges, duplicates, amount/period issues"],
    ["InfraBilling", "Month totals in reports, converted to USD"],
  ];
  items.forEach((row, i) => {
    const y = 1.5 + i * 0.95;
    s.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
      x: 0.6,
      y,
      w: 12.1,
      h: 0.8,
      fill: { color: CARD },
      line: { color: LINE },
      rectRadius: 0.08,
    });
    s.addText(row[0], {
      x: 0.85,
      y: y + 0.12,
      w: 3.2,
      h: 0.55,
      fontSize: 16,
      bold: true,
      color: ACCENT,
      fontFace: "Calibri",
      valign: "middle",
    });
    s.addText(row[1], {
      x: 4.1,
      y: y + 0.12,
      w: 8.2,
      h: 0.55,
      fontSize: 15,
      color: SLATE,
      fontFace: "Calibri",
      valign: "middle",
    });
  });
  addFooter(s, 2, TOTAL);
}

// ---- 3 My work ----
{
  const s = pptx.addSlide();
  titleBar(s, "My Phase-1 work", "Tracker items allotted to Snehitha");
  const rows = [
    [
      { text: "S.No", options: { bold: true, color: NAVY } },
      { text: "Requirement", options: { bold: true, color: NAVY } },
      { text: "Status", options: { bold: true, color: NAVY } },
    ],
    ["3", "Migrate SQLite → Supabase + script verification", "Completed"],
    ["9", "Invoice parsing logic + unit tests", "Completed"],
    ["10", "Billing discrepancy detection + unit tests", "Completed"],
    ["11", "Service-wise billing display (EC2, Lambda, …) + tests", "Completed"],
    ["19", "UI/UX enhancements", "In progress"],
  ];
  s.addTable(rows, {
    x: 0.6,
    y: 1.55,
    w: 12.1,
    colW: [1.2, 8.2, 2.7],
    border: [{ pt: 0.5, color: LINE }],
    fontFace: "Calibri",
    fontSize: 14,
    color: SLATE,
    align: "left",
    valign: "middle",
    fill: { color: "FFFFFF" },
  });
  s.addText("Upstream (teammate): Supabase schema, Auth, Vercel deploy + env vars", {
    x: 0.6,
    y: 6.4,
    w: 12,
    h: 0.35,
    fontSize: 13,
    color: MUTED,
    fontFace: "Calibri",
  });
  addFooter(s, 3, TOTAL);
}

// ---- 4 Workflow ----
{
  const s = pptx.addSlide();
  titleBar(s, "Demo workflow", "Happy path — one diagram for the review");
  const steps = [
    "1\nResources",
    "2\nUpload",
    "3\nExtract",
    "4\nReview",
    "5\nCheck",
    "6\nReport",
  ];
  steps.forEach((label, i) => {
    const x = 0.45 + i * 2.15;
    s.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
      x,
      y: 2.2,
      w: 1.9,
      h: 1.5,
      fill: { color: i === 4 ? "FEF3C7" : CARD },
      line: { color: i === 4 ? "F59E0B" : LINE },
      rectRadius: 0.1,
    });
    s.addText(label, {
      x,
      y: 2.45,
      w: 1.9,
      h: 1.1,
      fontSize: 14,
      bold: true,
      color: NAVY,
      align: "center",
      valign: "middle",
      fontFace: "Calibri",
    });
    if (i < steps.length - 1) {
      s.addText("→", {
        x: x + 1.85,
        y: 2.7,
        w: 0.35,
        h: 0.5,
        fontSize: 20,
        color: MUTED,
        align: "center",
      });
    }
  });
  s.addText("If extract fails → retry / paste text.  If out-of-scope → fix inventory or edit lines → recheck.", {
    x: 0.6,
    y: 4.2,
    w: 12.1,
    h: 0.5,
    fontSize: 15,
    color: SLATE,
    fontFace: "Calibri",
  });
  s.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
    x: 0.6,
    y: 5.0,
    w: 12.1,
    h: 1.5,
    fill: { color: CARD },
    line: { color: LINE },
    rectRadius: 0.08,
  });
  s.addText("Remember", {
    x: 0.85,
    y: 5.2,
    w: 11.5,
    h: 0.35,
    fontSize: 14,
    bold: true,
    color: ACCENT,
    fontFace: "Calibri",
  });
  s.addText(
    "• Empty InfraSpecs inventory ⇒ every non-zero bill line is out of scope\n• Matching is by service type (EC2, S3…), not AWS linked-account ID\n• One Save writes invoice header + all line items together",
    {
      x: 0.85,
      y: 5.55,
      w: 11.5,
      h: 0.85,
      fontSize: 13,
      color: SLATE,
      fontFace: "Calibri",
    }
  );
  addFooter(s, 4, TOTAL);
}

// ---- 5 Invoice UI ----
{
  const s = pptx.addSlide();
  titleBar(s, "Invoice detail (demo screen)", "File vs extracted data");
  s.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
    x: 0.6,
    y: 1.6,
    w: 5.8,
    h: 4.6,
    fill: { color: CARD },
    line: { color: LINE },
    rectRadius: 0.1,
  });
  s.addText("LEFT — Uploaded file", {
    x: 0.85,
    y: 1.85,
    w: 5.3,
    h: 0.4,
    fontSize: 16,
    bold: true,
    color: NAVY,
    fontFace: "Calibri",
  });
  s.addText("PDF / image preview\nOpen in new tab if needed", {
    x: 0.85,
    y: 2.5,
    w: 5.3,
    h: 1.2,
    fontSize: 15,
    color: SLATE,
    fontFace: "Calibri",
  });
  s.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
    x: 6.9,
    y: 1.6,
    w: 5.8,
    h: 4.6,
    fill: { color: CARD },
    line: { color: LINE },
    rectRadius: 0.1,
  });
  s.addText("RIGHT — Extracted data", {
    x: 7.15,
    y: 1.85,
    w: 5.3,
    h: 0.4,
    fontSize: 16,
    bold: true,
    color: NAVY,
    fontFace: "Calibri",
  });
  s.addText(
    "• Invoice #, period, currency, total\n• Line items (service + amount)\n• Out-of-scope badges\n• Edit → one Save for header + lines\n• Re-extract / Delete",
    {
      x: 7.15,
      y: 2.5,
      w: 5.3,
      h: 3.2,
      fontSize: 15,
      color: SLATE,
      fontFace: "Calibri",
    }
  );
  addFooter(s, 5, TOTAL);
}

// ---- 6 Discrepancies ----
{
  const s = pptx.addSlide();
  titleBar(s, "Discrepancy detection", "What the system flags (S.No 10)");
  const cards = [
    ["Out of scope", "Charge is not in this project’s InfraSpecs (service / type match)"],
    ["Duplicates", "Same invoice number or same period + amount as another bill"],
    ["Data issues", "Missing period, amount vs lines mismatch, no line items"],
  ];
  cards.forEach((c, i) => {
    const x = 0.6 + i * 4.15;
    s.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
      x,
      y: 1.7,
      w: 3.9,
      h: 3.2,
      fill: { color: CARD },
      line: { color: LINE },
      rectRadius: 0.1,
    });
    s.addText(c[0], {
      x: x + 0.25,
      y: 2.0,
      w: 3.4,
      h: 0.5,
      fontSize: 18,
      bold: true,
      color: ACCENT,
      fontFace: "Calibri",
    });
    s.addText(c[1], {
      x: x + 0.25,
      y: 2.7,
      w: 3.4,
      h: 1.8,
      fontSize: 15,
      color: SLATE,
      fontFace: "Calibri",
    });
  });
  s.addText("Fix: add resources  ·  or edit extracted lines + Save  ·  then Recheck", {
    x: 0.6,
    y: 5.3,
    w: 12.1,
    h: 0.4,
    fontSize: 15,
    bold: true,
    color: NAVY,
    fontFace: "Calibri",
  });
  addFooter(s, 6, TOTAL);
}

// ---- 7 Demo script ----
{
  const s = pptx.addSlide();
  titleBar(s, "Live demo steps", "Follow this order");
  const demo = [
    "Open a project → InfraSpecs",
    "Show Resources inventory (types already added)",
    "Upload / open an invoice → wait for Extracted",
    "Open detail: compare PDF vs line items",
    "Point out any Out of scope pills → fix or explain",
    "Edit if needed → Save once → confirm totals / report",
  ];
  demo.forEach((t, i) => {
    const y = 1.5 + i * 0.75;
    s.addShape(pptx.shapes.OVAL, {
      x: 0.7,
      y: y + 0.05,
      w: 0.45,
      h: 0.45,
      fill: { color: ACCENT },
      line: { color: ACCENT },
    });
    s.addText(String(i + 1), {
      x: 0.7,
      y: y + 0.05,
      w: 0.45,
      h: 0.45,
      fontSize: 14,
      bold: true,
      color: "FFFFFF",
      align: "center",
      valign: "middle",
      fontFace: "Calibri",
    });
    s.addText(t, {
      x: 1.4,
      y,
      w: 11,
      h: 0.55,
      fontSize: 18,
      color: SLATE,
      fontFace: "Calibri",
      valign: "middle",
    });
  });
  addFooter(s, 7, TOTAL);
}

// ---- 8 Status ----
{
  const s = pptx.addSlide();
  titleBar(s, "Status & next", "");
  s.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
    x: 0.6,
    y: 1.6,
    w: 5.9,
    h: 4.5,
    fill: { color: CARD },
    line: { color: LINE },
    rectRadius: 0.1,
  });
  s.addText("Done", {
    x: 0.9,
    y: 1.9,
    w: 5.3,
    h: 0.4,
    fontSize: 18,
    bold: true,
    color: ACCENT,
    fontFace: "Calibri",
  });
  s.addText(
    "• SQLite → Supabase migration (3)\n• Invoice parsing (9)\n• Discrepancy detection (10)\n• Service-wise line display (11)\n• Core UI for list + invoice detail",
    {
      x: 0.9,
      y: 2.5,
      w: 5.3,
      h: 3.2,
      fontSize: 15,
      color: SLATE,
      fontFace: "Calibri",
    }
  );
  s.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
    x: 6.8,
    y: 1.6,
    w: 5.9,
    h: 4.5,
    fill: { color: CARD },
    line: { color: LINE },
    rectRadius: 0.1,
  });
  s.addText("Next", {
    x: 7.1,
    y: 1.9,
    w: 5.3,
    h: 0.4,
    fontSize: 18,
    bold: true,
    color: ACCENT,
    fontFace: "Calibri",
  });
  s.addText(
    "• Finish UI/UX (19) + QA hours\n• Smoke demo path end-to-end\n• Note: no multi-account AWS split yet\n• Hand off any open polish items",
    {
      x: 7.1,
      y: 2.5,
      w: 5.3,
      h: 3.2,
      fontSize: 15,
      color: SLATE,
      fontFace: "Calibri",
    }
  );
  addFooter(s, 8, TOTAL);
}

pptx
  .writeFile({ fileName: outPath })
  .then(() => {
    console.log("Wrote", outPath);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
