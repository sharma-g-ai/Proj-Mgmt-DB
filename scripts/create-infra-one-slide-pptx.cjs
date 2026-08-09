/**
 * Single-slide walkthrough deck for InfraSpecs / InfraBilling.
 * Run: node scripts/create-infra-one-slide-pptx.cjs
 */
const PptxGenJS = require("pptxgenjs");
const path = require("path");
const fs = require("fs");

const outDir = path.join(__dirname, "..", "docs");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "InfraSpecs-Walkthrough-One-Slide.pptx");

const pptx = new PptxGenJS();
pptx.defineLayout({ name: "WIDE", width: 13.333, height: 7.5 });
pptx.layout = "WIDE";
pptx.author = "Snehitha";
pptx.title = "InfraSpecs & InfraBilling — App Walkthrough";

const NAVY = "0F172A";
const MUTED = "64748B";
const CARD = "F8FAFC";
const LINE = "E2E8F0";
const ACCENT = "0F766E";
const WHITE = "FFFFFF";

const s = pptx.addSlide();
s.addShape(pptx.shapes.RECTANGLE, {
  x: 0,
  y: 0,
  w: 13.333,
  h: 7.5,
  fill: { color: WHITE },
});
s.addShape(pptx.shapes.RECTANGLE, {
  x: 0,
  y: 0,
  w: 13.333,
  h: 0.12,
  fill: { color: ACCENT },
  line: { color: ACCENT },
});

s.addText("InfraSpecs & InfraBilling", {
  x: 0.5,
  y: 0.3,
  w: 9,
  h: 0.45,
  fontSize: 26,
  bold: true,
  color: NAVY,
  fontFace: "Calibri",
});
s.addText("End-to-end walkthrough · Inventory → Upload → Extract → Check → Report (USD)", {
  x: 0.5,
  y: 0.75,
  w: 10,
  h: 0.3,
  fontSize: 13,
  color: MUTED,
  fontFace: "Calibri",
});
s.addText("Snehitha  ·  Proj-Mgmt-DB", {
  x: 10.2,
  y: 0.35,
  w: 2.7,
  h: 0.3,
  fontSize: 11,
  color: MUTED,
  align: "right",
  fontFace: "Calibri",
});

const steps = [
  {
    n: "1",
    title: "Billing setup",
    body: "Open project → InfraSpecs\nSet Tool (required)\nOptional: restrict by account #",
  },
  {
    n: "2",
    title: "Resources",
    body: "Add inventory by env tabs\n(Prod / Staging / …)\nEmpty scope ⇒ all lines OOS",
  },
  {
    n: "3",
    title: "Upload & extract",
    body: "Upload PDF → progress UI\nTool locked to project\nMismatch reject if toggle On",
  },
  {
    n: "4",
    title: "Review & flags",
    body: "Detail: file + lines\nOOS pills / highlight near Resources\nMonth sheet by account cols",
  },
  {
    n: "5",
    title: "Report",
    body: "Reports → InfraBilling\nUSD pivot by tool / project / month\nExport XLSX",
  },
];

const cardW = 2.35;
const gap = 0.15;
const startX = 0.5;
const cardY = 1.25;

steps.forEach((step, i) => {
  const x = startX + i * (cardW + gap);
  s.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
    x,
    y: cardY,
    w: cardW,
    h: 3.35,
    fill: { color: CARD },
    line: { color: LINE },
    rectRadius: 0.08,
  });
  s.addShape(pptx.shapes.OVAL, {
    x: x + 0.15,
    y: cardY + 0.18,
    w: 0.38,
    h: 0.38,
    fill: { color: ACCENT },
    line: { color: ACCENT },
  });
  s.addText(step.n, {
    x: x + 0.15,
    y: cardY + 0.2,
    w: 0.38,
    h: 0.35,
    fontSize: 14,
    bold: true,
    color: WHITE,
    align: "center",
    fontFace: "Calibri",
  });
  s.addText(step.title, {
    x: x + 0.6,
    y: cardY + 0.22,
    w: cardW - 0.75,
    h: 0.35,
    fontSize: 14,
    bold: true,
    color: NAVY,
    fontFace: "Calibri",
  });
  s.addText(step.body, {
    x: x + 0.18,
    y: cardY + 0.75,
    w: cardW - 0.36,
    h: 2.4,
    fontSize: 12,
    color: "334155",
    fontFace: "Calibri",
    valign: "top",
  });
});

// Flow arrow strip
s.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
  x: 0.5,
  y: 4.85,
  w: 12.333,
  h: 0.85,
  fill: { color: "ECFDF5" },
  line: { color: "A7F3D0" },
  rectRadius: 0.08,
});
s.addText(
  "Live path:  Projects → InfraSpecs  →  Resources (env)  →  Upload invoice  →  Extract  →  OOS / month totals  →  Reports → InfraBilling (USD)",
  {
    x: 0.7,
    y: 5.05,
    w: 12,
    h: 0.5,
    fontSize: 13,
    bold: true,
    color: NAVY,
    fontFace: "Calibri",
    align: "center",
  }
);

s.addText(
  [
    {
      text: "Roles: ",
      options: { bold: true, color: NAVY },
    },
    {
      text: "Admin / InfraOps manage · Manager-Lead view-only    ",
      options: { color: MUTED },
    },
    {
      text: "Key demo tip: ",
      options: { bold: true, color: NAVY },
    },
    {
      text: "Add matching resources first, then upload — OOS flags review only (totals still show).",
      options: { color: MUTED },
    },
  ],
  {
    x: 0.5,
    y: 5.95,
    w: 12.333,
    h: 0.45,
    fontSize: 12,
    fontFace: "Calibri",
  }
);

s.addText("InfraSpecs & InfraBilling · Single-slide walkthrough", {
  x: 0.5,
  y: 7.1,
  w: 12,
  h: 0.25,
  fontSize: 10,
  color: MUTED,
  fontFace: "Calibri",
});

pptx.writeFile({ fileName: outPath }).then(() => {
  console.log("Wrote", outPath);
});
