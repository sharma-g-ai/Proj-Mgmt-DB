import { describe, expect, it } from "vitest";
import {
  buildInstanceBillingRows,
  detectBillingDiscrepancies,
  validationStatusFromDiscrepancies,
} from "@/lib/infra/discrepancies";
import { validateExtractedInvoice } from "@/lib/infra/llm";
import { __test as fxTest } from "@/lib/infra/fx";
import {
  billingMonthKey,
  billingMonthBucket,
  buildInfraBillingRows,
  buildInfraBillingSheets,
  collectBillingMonths,
  dedupeInfraBillingAtoms,
  groupInfraBillingTotals,
  UNKNOWN_BILLING_MONTH,
} from "@/lib/report/infraBilling";
import { canManageInfra, isAdminRole } from "@/lib/infra/permissions";
import {
  fieldsForService,
  requiredAttributeKeys,
  servicesForProvider,
  servicesGroupedForProvider,
  summarizeAttributes,
} from "@/lib/infra/resourceSchemas";
import { matchProjectBillingBinding } from "@/lib/infra/billingBinding";

describe("canManageInfra / isAdminRole", () => {
  it("grants manage to Admin and InfraOps only", () => {
    expect(canManageInfra({ role: "Admin" })).toBe(true);
    expect(canManageInfra({ role: "InfraOps" })).toBe(true);
    expect(canManageInfra({ role: "Manager-Lead" })).toBe(false);
    expect(canManageInfra({ role: null })).toBe(false);
  });

  it("identifies Admin only for isAdminRole", () => {
    expect(isAdminRole({ role: "Admin" })).toBe(true);
    expect(isAdminRole({ role: "InfraOps" })).toBe(false);
  });
});

describe("fx parseGoogleFinanceRate", () => {
  it("reads data-last-price from Google Finance HTML", () => {
    const html = `<div data-last-price="1.1402" class="x">EUR/USD</div>`;
    expect(fxTest.parseGoogleFinanceRate(html)).toBe(1.1402);
  });

  it("falls back to chart series last close", () => {
    const chart = `[[2026,7,1,23,58,null,null,[]],[1.10,0.1,0.1]],[[2026,7,2,23,58,null,null,[]],[1.1402,0.01,0.01]`;
    expect(fxTest.parseGoogleFinanceRate(chart)).toBe(1.1402);
  });

  it("rejects unsafe currency codes", () => {
    expect(fxTest.sanitizeCurrencyCode("eur")).toBe("EUR");
    expect(fxTest.sanitizeCurrencyCode("USD")).toBe("USD");
    expect(fxTest.sanitizeCurrencyCode("../etc")).toBeNull();
    expect(fxTest.sanitizeCurrencyCode("USDX")).toBeNull();
    expect(fxTest.sanitizeCurrencyCode("http://evil")).toBeNull();
    expect(fxTest.sanitizeCurrencyCode("")).toBeNull();
  });
});

describe("parseMoneyNumber", () => {
  it("parses comma-formatted and symbol amounts", async () => {
    const { parseMoneyNumber, sumLineAmounts } = await import("@/lib/infra/money");
    expect(parseMoneyNumber("23,113.80")).toBe(23113.8);
    expect(parseMoneyNumber("₹ 1,23,456.78")).toBe(123456.78);
    expect(parseMoneyNumber("INR 311.30")).toBe(311.3);
    expect(parseMoneyNumber(239.4)).toBe(239.4);
    expect(parseMoneyNumber("not-a-number")).toBeNull();
    expect(sumLineAmounts([{ amount: "10.5" }, { amount: "20" }])).toBe(30.5);
  });
});

describe("normalizeCurrencyCode", () => {
  it("maps symbols and names to ISO codes", async () => {
    const { normalizeCurrencyCode } = await import("@/lib/infra/currency");
    expect(normalizeCurrencyCode("INR")).toBe("INR");
    expect(normalizeCurrencyCode("inr")).toBe("INR");
    expect(normalizeCurrencyCode("₹")).toBe("INR");
    expect(normalizeCurrencyCode("Rs")).toBe("INR");
    expect(normalizeCurrencyCode("Rs.")).toBe("INR");
    expect(normalizeCurrencyCode("Indian Rupees")).toBe("INR");
    expect(normalizeCurrencyCode("USD")).toBe("USD");
    expect(normalizeCurrencyCode("euro")).toBe("EUR");
    expect(normalizeCurrencyCode("")).toBeNull();
  });
});

describe("validateExtractedInvoice", () => {
  it("normalizes currency symbols from extraction", () => {
    const out = validateExtractedInvoice({
      currency: "₹",
      amount_total: 100,
      lines: [],
    });
    expect(out.currency).toBe("INR");
  });

  it("parses comma totals and fills total from lines when missing or zero", () => {
    const withCommas = validateExtractedInvoice({
      currency: "INR",
      amount_total: "23,113.80",
      lines: [],
    });
    expect(withCommas.amount_total).toBe(23113.8);

    const fromLines = validateExtractedInvoice({
      currency: "INR",
      amount_total: null,
      lines: [
        { line_label: "A", amount: "10,000.50" },
        { line_label: "B", amount: 500 },
      ],
    });
    expect(fromLines.amount_total).toBe(10500.5);

    const fromZero = validateExtractedInvoice({
      currency: "INR",
      amount_total: 0,
      lines: [{ line_label: "A", amount: 311.3 }],
    });
    expect(fromZero.amount_total).toBe(311.3);
  });

  it("coerces missing fields to null and keeps lines", () => {
    const out = validateExtractedInvoice({
      invoice_number: " INV-1 ",
      currency: null,
      amount_total: "12.5",
      billing_period_start: "2026-01-01",
      billing_period_end: "bad-date",
      lines: [
        {
          line_label: "Compute",
          amount: 12.5,
          attributes: { region: "x" },
        },
      ],
    });
    expect(out.invoice_number).toBe("INV-1");
    expect(out.vendor_name).toBeNull();
    expect(out.account_id).toBeNull();
    expect(out.invoice_date).toBeNull();
    expect(out.amount_total).toBe(12.5);
    expect(out.billing_period_end).toBeNull();
    expect(out.lines).toHaveLength(1);
    expect(out.lines[0].attributes).toEqual({ region: "x" });
  });

  it("keeps lean header fields when present", () => {
    const out = validateExtractedInvoice({
      invoice_number: "2660097025",
      vendor_name: " Amazon Web Services ",
      account_id: "123456789012",
      invoice_date: "2026-05-01",
      currency: "USD",
      amount_total: 725.56,
      billing_period_start: "2026-05-01",
      billing_period_end: "2026-05-31",
      lines: [],
    });
    expect(out.vendor_name).toBe("Amazon Web Services");
    expect(out.account_id).toBe("123456789012");
    expect(out.invoice_date).toBe("2026-05-01");
    expect(out.currency).toBe("USD");
  });

  it("rejects invalid invoice_date", () => {
    const out = validateExtractedInvoice({
      invoice_date: "05/01/2026",
      lines: [],
    });
    expect(out.invoice_date).toBeNull();
  });
});

describe("detectBillingDiscrepancies", () => {
  it("flags out-of-scope lines vs InfraSpecs", () => {
    const discs = detectBillingDiscrepancies({
      invoiceId: "inv-1",
      amountTotal: 30,
      billingPeriodStart: "2026-01-01",
      billingPeriodEnd: "2026-01-31",
      invoiceNumber: "INV-1",
      lines: [
        { amount: 10, line_label: "web-server-1", resource_type_label: "Compute" },
        { amount: 20, line_label: "mystery-box", resource_type_label: "Other" },
      ],
      scopedResources: [
        {
          resource_id: "r1",
          name: "web-server-1",
          external_id: null,
          resource_type_label: "Compute",
        },
      ],
    });
    expect(discs.some((d) => d.discrepancy_type === "out_of_scope_service")).toBe(true);
    expect(validationStatusFromDiscrepancies(discs)).toBe("invalid");
  });

  it("flags all charged lines out of scope when InfraSpecs is empty", () => {
    const discs = detectBillingDiscrepancies({
      invoiceId: "inv-1",
      amountTotal: 30,
      billingPeriodStart: "2026-01-01",
      billingPeriodEnd: "2026-01-31",
      invoiceNumber: "INV-1",
      lines: [
        { amount: 10, line_label: "web-server-1", resource_type_label: "Compute" },
        { amount: 20, line_label: "backup license", resource_type_label: null },
      ],
      scopedResources: [],
    });
    const oos = discs.filter((d) => d.discrepancy_type === "out_of_scope_service");
    expect(oos).toHaveLength(2);
    expect(validationStatusFromDiscrepancies(discs)).toBe("invalid");
  });

  it("matches instance id inside line label", () => {
    const discs = detectBillingDiscrepancies({
      invoiceId: "inv-1",
      amountTotal: 10,
      billingPeriodStart: "2026-01-01",
      billingPeriodEnd: "2026-01-31",
      invoiceNumber: null,
      lines: [{ amount: 10, line_label: "db-1 (i-xyz)", resource_type_label: "Database" }],
      scopedResources: [
        {
          resource_id: "r1",
          name: "db-1",
          external_id: "i-xyz",
          resource_type_label: "Database",
        },
      ],
    });
    expect(discs.filter((d) => d.discrepancy_type === "out_of_scope_service")).toHaveLength(0);
  });

  it("treats AWS service lines as in-scope when matching resource types exist", () => {
    const discs = detectBillingDiscrepancies({
      invoiceId: "inv-1",
      amountTotal: 100,
      billingPeriodStart: "2026-01-01",
      billingPeriodEnd: "2026-01-31",
      invoiceNumber: null,
      lines: [
        {
          amount: 50,
          line_label: "Amazon Elastic Compute Cloud",
          resource_type_label: "EC2 — Virtual Server",
        },
        {
          amount: 20,
          line_label: "Amazon Simple Storage Service",
          resource_type_label: null,
        },
        {
          amount: 30,
          line_label: "Amazon Relational Database Service",
          resource_type_label: "RDS — Relational Database",
        },
      ],
      scopedResources: [
        {
          resource_id: "r1",
          name: "web-1",
          external_id: null,
          resource_type_label: "EC2 — Virtual Server",
        },
        {
          resource_id: "r2",
          name: "logs-bucket",
          external_id: null,
          resource_type_label: "S3 — Object Storage",
        },
      ],
    });
    const oos = discs.filter((d) => d.discrepancy_type === "out_of_scope_service");
    expect(oos).toHaveLength(1);
    expect(oos[0]?.actual_value).toMatch(/Relational Database/i);
  });

  it("builds instance rows with scope", () => {
    const rows = buildInstanceBillingRows(
      [
        { amount: 5, line_label: "api-1", resource_type_label: "Compute" },
        { amount: 7, line_label: "api-1", resource_type_label: "Compute" },
        { amount: 3, line_label: "rogue", resource_type_label: "Storage" },
      ],
      [
        {
          resource_id: "r1",
          name: "api-1",
          external_id: null,
          resource_type_label: "Compute",
        },
      ]
    );
    expect(rows.some((r) => r.instance_label.includes("api-1") && r.in_scope === true)).toBe(true);
    expect(rows.some((r) => r.instance_label.includes("rogue") && r.in_scope === false)).toBe(true);
  });
});

describe("infraBilling report helpers", () => {
  it("groups month keys and totals", () => {
    const atoms = [
      {
        project_id: "p1",
        project_name: "Alpha",
        stakeholder: "External",
        ownership_label: "Group A",
        provider_label: "Prov",
        billing_period_start: "2026-01-01",
        billing_period_end: "2026-01-31",
        amount_total: 100,
        currency: "USD",
      },
      {
        project_id: "p2",
        project_name: "Beta",
        stakeholder: "External",
        ownership_label: "Group A",
        provider_label: "Prov",
        billing_period_start: "2026-02-01",
        billing_period_end: "2026-02-28",
        amount_total: 50,
        currency: "USD",
      },
    ];
    expect(billingMonthKey("2026-01-15", null)).toBe("2026-01");
    expect(collectBillingMonths(atoms)).toEqual(["2026-01", "2026-02"]);
    const rows = buildInfraBillingRows(atoms);
    expect(rows).toHaveLength(2);
    expect(rows[0].months["2026-01"] ?? rows.find((r) => r.project_name === "Alpha")?.months["2026-01"]).toBe(
      100
    );
    const groups = groupInfraBillingTotals(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].total).toBe(150);
  });

  it("builds one sheet with tool column-groups; External|Internal when tool has 2+ projects", () => {
    const atoms = [
      {
        project_id: "c1",
        project_name: "Genesis",
        stakeholder: "External",
        ownership_label: null,
        provider_label: "Amazon Web Services, Inc.",
        billing_period_start: "2026-04-01",
        billing_period_end: "2026-04-30",
        amount_total: 100,
        currency: "USD",
      },
      {
        project_id: "a1",
        project_name: "Revup",
        stakeholder: "Internal",
        ownership_label: null,
        provider_label: "AWS",
        billing_period_start: "2026-04-01",
        billing_period_end: "2026-04-30",
        amount_total: 40,
        currency: "USD",
      },
      {
        project_id: "x1",
        project_name: "OtherCloud",
        stakeholder: "External",
        ownership_label: null,
        provider_label: "Azure",
        billing_period_start: "2026-05-01",
        billing_period_end: "2026-05-31",
        amount_total: 10,
        currency: "USD",
      },
    ];
    const sheets = buildInfraBillingSheets(atoms);
    expect(sheets).toHaveLength(1);
    const sheet = sheets[0];
    expect(sheet.tools).toEqual(["AWS", "Azure"]);
    expect(sheet.toolBlocks.map((b) => b.tool)).toEqual(["AWS", "Azure"]);
    const aws = sheet.toolBlocks[0];
    expect(aws.showOwnershipHeaders).toBe(true);
    expect(aws.groups.map((g) => g.stakeholder)).toEqual(["External", "Internal"]);
    expect(aws.groups[0].projects.map((p) => p.project_name)).toEqual(["Genesis"]);
    expect(aws.groups[1].projects.map((p) => p.project_name)).toEqual(["Revup"]);
    const azure = sheet.toolBlocks[1];
    expect(azure.showOwnershipHeaders).toBe(false);
    expect(azure.groups[0].projects.map((p) => p.project_name)).toEqual(["OtherCloud"]);
    expect(sheet.months).toEqual(["2026-04", "2026-05"]);
  });

  it("keeps custom tool names like E2E on the sheet", () => {
    const sheets = buildInfraBillingSheets([
      {
        project_id: "p1",
        project_name: "Portal",
        stakeholder: "Internal",
        ownership_label: null,
        provider_label: "E2E",
        billing_period_start: "2026-01-01",
        billing_period_end: "2026-01-31",
        amount_total: 10,
        currency: "USD",
      },
    ]);
    expect(sheets[0].toolBlocks.map((b) => b.tool)).toEqual(["E2E"]);
  });

  it("puts missing billing period into Unspecified month (not only grand total)", () => {
    expect(billingMonthBucket(null, null)).toBe(UNKNOWN_BILLING_MONTH);
    const sheets = buildInfraBillingSheets([
      {
        project_id: "p1",
        project_name: "Portal",
        stakeholder: "External",
        ownership_label: null,
        provider_label: "AWS",
        billing_period_start: null,
        billing_period_end: null,
        amount_total: 55,
        currency: "USD",
      },
    ]);
    expect(sheets[0].months).toEqual([UNKNOWN_BILLING_MONTH]);
    const p = sheets[0].toolBlocks[0].groups[0].projects[0];
    expect(p.months[UNKNOWN_BILLING_MONTH]).toBe(55);
    expect(p.total).toBe(55);
  });

  it("dedupes same invoice number but keeps distinct numbers with same period+amount", () => {
    const atoms = [
      {
        invoice_id: "i1",
        invoice_number: "INV-9",
        project_id: "p1",
        project_name: "Portal",
        stakeholder: "External",
        ownership_label: null,
        provider_label: "AWS",
        billing_period_start: "2026-01-01",
        billing_period_end: "2026-01-31",
        amount_total: 100,
        currency: "USD",
      },
      {
        invoice_id: "i2",
        invoice_number: "inv-9",
        project_id: "p1",
        project_name: "Portal",
        stakeholder: "External",
        ownership_label: null,
        provider_label: "AWS",
        billing_period_start: "2026-01-01",
        billing_period_end: "2026-01-31",
        amount_total: 100,
        currency: "USD",
      },
      {
        invoice_id: "i3",
        invoice_number: "INV-OTHER",
        project_id: "p1",
        project_name: "Portal",
        stakeholder: "External",
        ownership_label: null,
        provider_label: "AWS",
        billing_period_start: "2026-01-01",
        billing_period_end: "2026-01-31",
        amount_total: 100,
        currency: "USD",
      },
    ];
    expect(dedupeInfraBillingAtoms(atoms)).toHaveLength(2);
    const sheets = buildInfraBillingSheets(atoms);
    expect(sheets[0].toolBlocks[0].groups[0].projects[0].total).toBe(200);
  });

  it("includes invoices with no tool under Unspecified", () => {
    const sheets = buildInfraBillingSheets([
      {
        invoice_id: "i1",
        invoice_number: "X-1",
        project_id: "p1",
        project_name: "Portal",
        stakeholder: "External",
        ownership_label: null,
        provider_label: null,
        billing_period_start: "2026-01-01",
        billing_period_end: "2026-01-31",
        amount_total: 40,
        currency: "USD",
      },
    ]);
    expect(sheets[0].toolBlocks.map((b) => b.tool)).toEqual(["Unspecified"]);
    expect(sheets[0].toolBlocks[0].groups[0].projects[0].total).toBe(40);
  });

  it("excludes null USD amounts from report totals (not silent $0)", () => {
    const sheets = buildInfraBillingSheets([
      {
        invoice_id: "i1",
        invoice_number: "A",
        project_id: "p1",
        project_name: "Portal",
        stakeholder: "External",
        ownership_label: null,
        provider_label: "AWS",
        billing_period_start: "2026-01-01",
        billing_period_end: "2026-01-31",
        amount_total: 50,
        currency: "USD",
      },
      {
        invoice_id: "i2",
        invoice_number: "B",
        project_id: "p1",
        project_name: "Portal",
        stakeholder: "External",
        ownership_label: null,
        provider_label: "AWS",
        billing_period_start: "2026-01-01",
        billing_period_end: "2026-01-31",
        amount_total: null,
        currency: "INR",
      },
    ]);
    expect(sheets[0].excludedFromUsdCount).toBe(1);
    expect(sheets[0].toolBlocks[0].groups[0].projects[0].total).toBe(50);
  });

  it("splits one project into separate columns per billing account", () => {
    const sheets = buildInfraBillingSheets([
      {
        project_id: "atg",
        project_name: "ATG",
        stakeholder: "External",
        ownership_label: null,
        provider_label: "AWS",
        account_id: "560581133020",
        account_name: "Amzur ATG",
        billing_period_start: "2026-01-01",
        billing_period_end: "2026-01-31",
        amount_total: 100,
        currency: "USD",
      },
      {
        project_id: "atg",
        project_name: "ATG",
        stakeholder: "External",
        ownership_label: null,
        provider_label: "AWS",
        account_id: "617321634820",
        account_name: null,
        billing_period_start: "2026-01-01",
        billing_period_end: "2026-01-31",
        amount_total: 40,
        currency: "USD",
      },
    ]);
    const cols = sheets[0].toolBlocks[0].groups[0].projects;
    expect(cols).toHaveLength(2);
    expect(cols.map((c) => c.total).sort((a, b) => a - b)).toEqual([40, 100]);
    expect(cols.every((c) => (c.months["2026-01"] ?? 0) > 0)).toBe(true);
    expect(cols.some((c) => c.project_name.includes("Amzur ATG"))).toBe(true);
    expect(cols.some((c) => c.project_name.includes("617321634820"))).toBe(true);
  });
});

describe("resourceSchemas", () => {
  it("lists EC2 for AWS and Copilot plans for GitHub Copilot", () => {
    expect(servicesForProvider("AWS").some((s) => s.value.includes("EC2"))).toBe(true);
    expect(
      servicesForProvider("GitHub Copilot").some((s) => s.value.includes("Copilot Business"))
    ).toBe(true);
  });

  it("groups AWS services under Compute / Database / Networking", () => {
    const groups = servicesGroupedForProvider("AWS").map((g) => g.category);
    expect(groups).toEqual(
      expect.arrayContaining(["Compute", "Database", "Storage", "Networking"])
    );
    const compute = servicesGroupedForProvider("AWS").find((g) => g.category === "Compute");
    expect(compute?.services.some((s) => s.value.startsWith("EC2"))).toBe(true);
  });

  it("groups Jira and Copilot under SaaS", () => {
    expect(servicesGroupedForProvider("Jira")[0]?.category).toBe("SaaS");
    expect(servicesGroupedForProvider("GitHub Copilot")[0]?.category).toBe("SaaS");
  });

  it("shows EC2 fields like the example (no monthly cost)", () => {
    const fields = fieldsForService("AWS", "EC2 — Virtual Server");
    const keys = fields.map((f) => f.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "instance_type",
        "vcpu",
        "memory_gb",
        "storage_gb",
        "environment",
        "region",
        "ip_address",
      ])
    );
    expect(keys).not.toContain("monthly_cost");
  });

  it("shows seats + unit for Copilot", () => {
    const fields = fieldsForService("GitHub Copilot", "Copilot Business — per user");
    const seats = fields.find((f) => f.key === "seats");
    expect(seats?.unitOptions).toContain("Users");
    expect(fields.some((f) => f.key === "environment")).toBe(true);
    expect(fields.some((f) => f.key === "monthly_cost")).toBe(false);
  });

  it("requires the right keys per service", () => {
    expect(requiredAttributeKeys("AWS", "EC2 — Virtual Server")).toEqual(
      expect.arrayContaining(["instance_type", "vcpu", "memory_gb", "storage_gb", "environment", "region"])
    );
    expect(requiredAttributeKeys("GitHub Copilot", "Copilot Business — per user")).toEqual(
      expect.arrayContaining(["seats", "environment"])
    );
  });

  it("summarizes attributes for the table", () => {
    expect(
      summarizeAttributes("EC2 — Virtual Server", {
        provider: "AWS",
        instance_type: "t3.micro",
        region: "us-east-1",
        environment: "Production",
      })
    ).toMatch(/AWS.*t3\.micro/);
    expect(
      summarizeAttributes("Copilot Business — per user", {
        provider: "GitHub Copilot",
        seats: 46,
        seat_unit: "Users",
      })
    ).toMatch(/46 Users/);
  });

  it("lists many AWS services including Lambda and EKS", () => {
    const aws = servicesForProvider("AWS").map((s) => s.value);
    expect(aws).toEqual(
      expect.arrayContaining([
        "EC2 — Virtual Server",
        "Lambda — Serverless Functions",
        "EKS — Kubernetes",
        "CloudWatch",
        "Bedrock",
      ])
    );
    expect(aws.length).toBeGreaterThan(40);
  });

  it("shows a compact field set for Other / Custom service", () => {
    const fields = fieldsForService("AWS", "Other / Custom service");
    const keys = fields.map((f) => f.key);
    expect(keys).toEqual([
      "custom_service_name",
      "instance_type",
      "environment",
      "region",
    ]);
    expect(requiredAttributeKeys("AWS", "Other / Custom service")).toEqual(
      expect.arrayContaining(["custom_service_name", "environment", "region"])
    );
  });

  it("resolves Azure / E2E / Atlassian billing labels to their catalogs", () => {
    expect(servicesForProvider("Azure").some((s) => s.value.includes("Virtual Machine"))).toBe(
      true
    );
    expect(servicesForProvider("E2E").some((s) => s.value.includes("Virtual Machine"))).toBe(true);
    expect(servicesForProvider("Atlassian").some((s) => s.value.includes("Confluence"))).toBe(true);
  });
});

describe("matchProjectBillingBinding", () => {
  const base = {
    enforceAccounts: true,
    projectToolLabel: "AWS",
    projectToolId: "prov-aws",
    allowedAccounts: ["123456789012", "999"],
    invoiceToolLabel: "AWS",
    invoiceToolId: "prov-aws",
    extractedAccountId: "123456789012",
  };

  it("skips all checks when account restriction is off", () => {
    expect(
      matchProjectBillingBinding({
        ...base,
        enforceAccounts: false,
        extractedAccountId: null,
        invoiceToolLabel: "E2E",
        invoiceToolId: "prov-e2e",
      })
    ).toEqual({ ok: true });
  });

  it("accepts matching tool and allow-listed account when restriction is on", () => {
    expect(matchProjectBillingBinding(base)).toEqual({ ok: true });
  });

  it("normalizes account casing and spaces", () => {
    expect(
      matchProjectBillingBinding({
        ...base,
        allowedAccounts: ["  AbC-1  "],
        extractedAccountId: "abc-1",
      })
    ).toEqual({ ok: true });
  });

  it("flags tool mismatch when restriction is on", () => {
    const r = matchProjectBillingBinding({
      ...base,
      invoiceToolLabel: "E2E",
      invoiceToolId: "prov-e2e",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("tool_mismatch");
  });

  it("flags missing extracted account when restriction is on", () => {
    const r = matchProjectBillingBinding({ ...base, extractedAccountId: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("account_missing");
  });

  it("flags account not on allow-list when restriction is on", () => {
    const r = matchProjectBillingBinding({
      ...base,
      extractedAccountId: "000000000000",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("account_mismatch");
  });
});
