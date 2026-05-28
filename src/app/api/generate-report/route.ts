import { NextRequest, NextResponse } from "next/server";
import { askAI, askAIWithDocument, parseAIJson } from "@/lib/aiService";
import JSZip from "jszip";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from "docx";

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const body = await req.json();

    const template = body.tailwindTemplate || body.template;
    const extractedDeedData = body.extractedDeedData || body.data || {};
    const userInputs = body.userInputs || body.data || {};
    const agreementType = body.agreementType || "direct_owner_sale";
    const existingValues = body.existingValues || [];

    // Merge — user inputs always override extracted deed data
    const mergedData = deepMerge(extractedDeedData, userInputs);
    const safeName = sanitize(mergedData.buyerName || "Agreement");

    let docxBuffer: Buffer;

    if (!template) {
      // No template uploaded — Claude drafts the full agreement from scratch
      console.log("[generate-report] No template — Claude drafting agreement from data");
      docxBuffer = await claudeDraftDocx(mergedData, agreementType);

    } else {
      const mimeMatch = template.match(/^data:([^;]+);base64,/);
      const mime = mimeMatch ? mimeMatch[1] : "";
      const base64Data = template.includes(",") ? template.split(",")[1] : template;
      const buffer = Buffer.from(base64Data, "base64");

      // DOCX: magic bytes PK (0x50 0x4B)
      const isDocx =
        (buffer[0] === 0x50 && buffer[1] === 0x4B) ||
        mime.includes("wordprocessingml") ||
        mime.includes("msword");

      if (isDocx) {
        // DOCX template — fill placeholders in XML using Claude
        console.log("[generate-report] DOCX template — Claude filling placeholders");
        docxBuffer = await fillDocxTemplate(buffer, mergedData);
      } else {
        // PDF or Image template — Claude reads it and fills it
        console.log(`[generate-report] ${mime} template — Claude reading and filling`);
        docxBuffer = await claudeFillFromVisualTemplate(base64Data, mime, mergedData, agreementType, existingValues);
      }
    }

    console.log("[generate-report] Converting generated DOCX buffer to high-fidelity PDF via Playwright");
    const pdfBuffer = await convertDocxToPdf(docxBuffer);

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="Agreement_${safeName}.pdf"`,
      },
    });

  } catch (error: any) {
    console.error("[generate-report] Error:", error.message);
    return NextResponse.json(
      { error: error.message || "Failed to generate agreement" },
      { status: 500 }
    );
  }
}

// ─── Path 1: DOCX template — fill placeholders in XML ────────────────────────

async function fillDocxTemplate(buffer: Buffer, data: Record<string, any>): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await zip.file("word/document.xml")?.async("string");
  if (!documentXml) throw new Error("Invalid DOCX — missing document.xml");

  const mammoth = await import("mammoth");
  const { value: templateText } = await mammoth.extractRawText({ buffer });

  const prompt = `You are filling an Indian legal agreement template with real data.

TEMPLATE TEXT (exact content of the uploaded document):
${templateText}

DATA TO FILL IN:
${JSON.stringify(data, null, 2)}

INSTRUCTIONS:
- Identify every placeholder in the template: [Field Name], \${field}, blank lines after labels, underscores like "______"
- Map each placeholder EXACTLY as it appears in the template to the correct value from the data
- Format amounts as ₹X,XX,XXX (Indian number format)
- If no matching data exists for a placeholder, keep the placeholder text as-is
- Do NOT invent or fabricate any data

Return ONLY a valid JSON object mapping each placeholder to its replacement value.
Example: { "[Buyer Name]": "SURESH", "[Survey Number]": "123/4A", "[Total Amount]": "₹3,00,000" }`;

  let replacementMap: Record<string, string> = {};
  try {
    const aiText = await askAI(prompt);
    replacementMap = parseAIJson(aiText);
  } catch {
    replacementMap = buildDirectMapping(data);
  }

  let modifiedXml = documentXml;
  for (const [placeholder, value] of Object.entries(replacementMap)) {
    if (value) {
      modifiedXml = modifiedXml.replace(
        new RegExp(escapeRegex(placeholder), "gi"),
        escapeXml(String(value))
      );
    }
  }
  modifiedXml = applyDirectReplacements(modifiedXml, data);

  zip.file("word/document.xml", modifiedXml);
  return await zip.generateAsync({ type: "nodebuffer" });
}

// ─── Path 2: PDF/Image template — Claude reads visually and fills ─────────────

async function claudeFillFromVisualTemplate(
  base64Data: string,
  mimeType: string,
  data: Record<string, any>,
  agreementType: string,
  existingValues: any[]
): Promise<Buffer> {
  const prompt = `You are an expert Indian Property Law Document Drafter.

You are given the REFERENCE AGREEMENT TEMPLATE as a ${mimeType.includes("pdf") ? "PDF" : "image"}.
Your job is to produce a COMPLETE, FILLED agreement document based on this template.

NEW TRANSACTION DATA:
${JSON.stringify(data, null, 2)}

OLD VALUES TO REPLACE (from the template):
${JSON.stringify(existingValues || [])}

CRITICAL INSTRUCTIONS:
1. Read the template CAREFULLY — understand every clause, paragraph, and legal language
2. Reproduce the EXACT same document structure and legal text from the template
3. Replace ALL old names, amounts, dates, survey numbers with the new data provided
4. Keep ALL legal boilerplate, recitals, conditions, and clauses VERBATIM from the template
5. Write the document as flowing paragraphs — NOT as bullet points or tables
6. Boundaries (East/West/North/South) should appear as natural prose within the schedule paragraph
7. Do NOT add any new clauses or remove any existing ones
8. If data is missing, write the field label followed by a blank line

Return ONLY a JSON object:
{
  "title": "exact title from template",
  "paragraphs": [
    "Full paragraph 1 text exactly as it should appear in the document...",
    "Full paragraph 2 text...",
    "..."
  ]
}`;

  const aiText = mimeType.includes("pdf") || mimeType.startsWith("image/")
    ? await askAIWithDocument(prompt, base64Data, mimeType)
    : await askAI(prompt);

  const parsed = parseAIJson(aiText);
  return buildDocxFromParagraphs(parsed.title || "SALE AGREEMENT", parsed.paragraphs || []);
}

// ─── Path 3: No template — Claude drafts from scratch ────────────────────────

async function claudeDraftDocx(data: Record<string, any>, agreementType: string): Promise<Buffer> {
  const fmt = (n: any) => (n ? `₹${Number(n).toLocaleString("en-IN")}` : "");

  const prompt = `You are a Senior Indian Property Law Document Drafter.

Draft a complete, professional Indian Sale Agreement document using the following data.
Agreement type: ${agreementType}

DATA:
${JSON.stringify(data, null, 2)}

INSTRUCTIONS:
1. Write the document as flowing legal paragraphs — exactly like a real Indian sale deed
2. Include all standard sections: recitals, parties, property schedule, boundaries, financial terms, conditions, attestation
3. Use formal legal language appropriate for Indian property law
4. Boundaries (East/West/North/South) should appear in the schedule as labeled prose lines
5. Financial amounts should be written both in figures and words
6. Include standard covenants: title warranty, encumbrance-free declaration, possession clause, registration cooperation
7. Do NOT use bullet points or tables — write as continuous legal paragraphs
8. If any data field is missing or empty, omit that detail naturally from the prose

Return ONLY a JSON object:
{
  "title": "SALE AGREEMENT",
  "paragraphs": [
    "This Agreement for Sale of Land (hereinafter referred to as 'Agreement') is executed on this ${data.agreementDate || 'day'} between...",
    "WHEREAS the Seller is the absolute owner of the property described hereunder...",
    "NOW THEREFORE in consideration of the mutual covenants...",
    "PARTIES: The Seller, ${data.sellerName || '[Seller Name]'}, S/o ${data.sellerFatherName || '[Father Name]'}, residing at ${data.sellerAddress || '[Address]'}...",
    "...all remaining paragraphs with full legal text..."
  ]
}`;

  const aiText = await askAI(prompt);
  const parsed = parseAIJson(aiText);
  return buildDocxFromParagraphs(parsed.title || "SALE AGREEMENT", parsed.paragraphs || []);
}

// ─── Convert paragraph list → DOCX ───────────────────────────────────────────

async function buildDocxFromParagraphs(title: string, paragraphs: string[]): Promise<Buffer> {
  const children: Paragraph[] = [];

  // Title
  children.push(
    new Paragraph({
      text: title,
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    })
  );

  for (const para of paragraphs) {
    const trimmed = para.trim();

    if (!trimmed) {
      children.push(new Paragraph({ text: "", spacing: { after: 120 } }));
      continue;
    }

    // Detect section headings: all-caps, short, no numbers or rupee signs
    const isHeading =
      trimmed === trimmed.toUpperCase() &&
      trimmed.length < 60 &&
      !trimmed.includes("₹") &&
      !/^\d+\./.test(trimmed) &&
      !/^[a-z]/.test(trimmed);

    if (isHeading) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: trimmed, bold: true, size: 24 })],
          spacing: { before: 320, after: 160 },
        })
      );
    } else {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: trimmed, size: 22 })],
          spacing: { after: 200 },
          alignment: AlignmentType.JUSTIFIED,
          indent: { firstLine: 360 },
        })
      );
    }
  }

  const doc = new Document({
    sections: [{
      properties: {
        page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1080 } },
      },
      children,
    }],
  });

  return await Packer.toBuffer(doc);
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function buildDirectMapping(data: Record<string, any>): Record<string, string> {
  const fmt = (n: any) => (n ? `₹${Number(n).toLocaleString("en-IN")}` : "");

  // Helper: resolve value from flat field OR nested path
  const get = (flatKey: string, ...nestedPath: string[]): string => {
    if (data[flatKey] && String(data[flatKey]).trim()) return String(data[flatKey]);
    let cur: any = data;
    for (const k of nestedPath) { cur = cur?.[k]; }
    return cur ? String(cur) : "";
  };

  const sellerName    = get("sellerName",    "parties", "seller", "fullName");
  const buyerName     = get("buyerName",     "parties", "buyer",  "fullName");
  const sellerFather  = get("sellerFatherName", "parties", "seller", "fatherOrHusbandName");
  const buyerFather   = get("buyerFatherName",  "parties", "buyer",  "fatherOrHusbandName");
  const sellerAddress = get("sellerAddress", "parties", "seller", "address");
  const buyerAddress  = get("buyerAddress",  "parties", "buyer",  "address");
  const surveyNumber  = get("surveyNumber",  "property", "surveyNumber");
  const village       = get("village",       "property", "village");
  const mandal        = get("mandal",        "property", "mandal");
  const district      = get("district",      "property", "district");
  const state         = get("state",         "property", "state");
  const landSize      = get("landSize",      "property", "extentBeingSold") || get("landSize", "property", "totalAreaAcres");
  const propDesc      = get("propertyDescription", "property", "schedule") || get("propertyDescription", "property", "fullAddress");
  const saleAmt       = get("saleAmount",    "transaction", "saleConsiderationTotal");
  const advAmt        = get("advanceAmount", "transaction", "advanceAmountPaid");
  const balAmt        = get("balanceAmount", "transaction", "balanceAmount");
  const regDate       = get("registrationDate", "registration", "registrationDate");

  // Boundaries
  const b = data.boundaries || data.property?.boundaries || {};

  return {
    // Parties
    "[Buyer Name]":         buyerName,
    "[Seller Name]":        sellerName,
    "[Buyer Father Name]":  buyerFather,
    "[Seller Father Name]": sellerFather,
    "[Buyer Address]":      buyerAddress,
    "[Seller Address]":     sellerAddress,
    "[Buyer Age]":          get("buyerAge",  "parties", "buyer",  "age"),
    "[Seller Age]":         get("sellerAge", "parties", "seller", "age"),
    "[Buyer Aadhaar]":      get("buyerAadhaar", "parties", "buyer",  "aadhaar"),
    "[Seller Aadhaar]":     get("sellerAadhaar","parties", "seller", "aadhaar"),
    "[Buyer PAN]":          get("buyerPan",  "parties", "buyer",  "pan"),
    "[Seller PAN]":         get("sellerPan", "parties", "seller", "pan"),

    // Property
    "[Property Description]": propDesc,
    "[Survey Number]":        surveyNumber,
    "[Sub Division Number]":  get("subDivisionNumber", "property", "subDivisionNumber"),
    "[Plot Number]":          get("plotNumber",  "property", "plotNumber"),
    "[Door Number]":          get("doorNumber",  "property", "doorNumber"),
    "[Village]":              village,
    "[Mandal]":               mandal,
    "[District]":             district,
    "[State]":                state,
    "[Pincode]":              get("pincode",     "property", "pincode"),
    "[Land Size]":            landSize,
    "[Land Size Unit]":       get("landSizeUnit","property", "totalAreaAcres") ? "Acres" : "",
    "[Patta Number]":         get("pattaNumber", "property", "pattaNumber"),
    "[Revenue Village]":      get("revenueVillage","property","revenueVillage"),
    "[Local Body]":           get("localBodyName","property","localBodyName"),
    "[Schedule]":             get("rawScheduleText") || get("propertyDescription","property","schedule"),
    "[North Boundary]":       b.north  || "",
    "[South Boundary]":       b.south  || "",
    "[East Boundary]":        b.east   || "",
    "[West Boundary]":        b.west   || "",

    // Transaction
    "[Total Amount]":         fmt(saleAmt  || data.totalAmount),
    "[Advance Amount]":       fmt(advAmt   || data.advanceAmount),
    "[Balance Amount]":       fmt(balAmt   || data.balanceAmount),
    "[Sale Amount In Words]": get("saleConsiderationInWords","transaction","saleConsiderationInWords"),
    "[Advance Paid On]":      get("advancePaidOn","transaction","advancePaidOn"),
    "[Balance Deadline]":     get("balancePaymentDeadline","transaction","balancePaymentDeadline"),
    "[Payment Mode]":         get("paymentMode","transaction","paymentMode"),
    "[Cheque DD Details]":    get("chequeOrDdDetails","transaction","chequeOrDdDetails"),
    "[Transaction Number]":   data.transactionNumber || "",
    "[Date]":                 data.agreementDate || "",

    // Registration
    "[Registration Number]":  get("registrationNumber","registration","previousDeedNumber"),
    "[Registration Date]":    regDate,
    "[Registration Office]":  get("registrationOffice","registration","registrationOffice"),
    "[Execution Date]":       get("executionDate","registration","executionDate"),

    // Apartment
    "[Project Name]":         get("projectName",  "apartment","projectName"),
    "[Builder Name]":         get("builderName",  "apartment","builderName"),
    "[Flat Number]":          get("flatNumber",   "apartment","flatNumber"),
    "[Floor Number]":         get("floorNumber",  "apartment","floorNumber"),
    "[Tower Block]":          get("towerOrBlock", "apartment","towerOrBlock"),
    "[Undivided Share]":      get("undividedShare","apartment","undividedShare"),
    "[Carpet Area]":          get("carpetArea",   "apartment","carpetArea"),
    "[Super Builtup Area]":   get("superBuiltupArea","apartment","superBuiltupArea"),
    "[Car Parking]":          get("carParkingNumber","apartment","carParkingNumber"),

    // Government
    "[Auction Number]":       get("auctionNumber","government","auctionNumber"),
    "[Lot Number]":           get("lotNumber",    "government","lotNumber"),
    "[GO Number]":            get("governmentOrderNumber","government","governmentOrderNumber"),
    "[Allotted Date]":        get("allottedDate", "government","allottedDate"),
  };
}

function applyDirectReplacements(xml: string, data: Record<string, any>): string {
  const fmt = (n: any) => (n ? `₹${Number(n).toLocaleString("en-IN")}` : "");

  // Resolve nested or flat
  const get = (flatKey: string, ...nestedPath: string[]): string => {
    if (data[flatKey] && String(data[flatKey]).trim()) return String(data[flatKey]);
    let cur: any = data;
    for (const k of nestedPath) { cur = cur?.[k]; }
    return cur ? String(cur) : "";
  };

  const b = data.boundaries || data.property?.boundaries || {};

  const map: Record<string, string> = {
    "\\[Buyer Name\\]":         get("buyerName",    "parties","buyer","fullName"),
    "\\[Seller Name\\]":        get("sellerName",   "parties","seller","fullName"),
    "\\[Buyer Father Name\\]":  get("buyerFatherName","parties","buyer","fatherOrHusbandName"),
    "\\[Seller Father Name\\]": get("sellerFatherName","parties","seller","fatherOrHusbandName"),
    "\\[Buyer Address\\]":      get("buyerAddress", "parties","buyer","address"),
    "\\[Seller Address\\]":     get("sellerAddress","parties","seller","address"),
    "\\[Buyer Age\\]":          get("buyerAge",     "parties","buyer","age"),
    "\\[Seller Age\\]":         get("sellerAge",    "parties","seller","age"),
    "\\[Buyer Aadhaar\\]":      get("buyerAadhaar", "parties","buyer","aadhaar"),
    "\\[Seller Aadhaar\\]":     get("sellerAadhaar","parties","seller","aadhaar"),
    "\\[Buyer PAN\\]":          get("buyerPan",     "parties","buyer","pan"),
    "\\[Seller PAN\\]":         get("sellerPan",    "parties","seller","pan"),
    "\\[Property Description\\]": get("propertyDescription","property","schedule"),
    "\\[Survey Number\\]":      get("surveyNumber", "property","surveyNumber"),
    "\\[Sub Division Number\\]":get("subDivisionNumber","property","subDivisionNumber"),
    "\\[Plot Number\\]":        get("plotNumber",   "property","plotNumber"),
    "\\[Door Number\\]":        get("doorNumber",   "property","doorNumber"),
    "\\[Village\\]":            get("village",      "property","village"),
    "\\[Mandal\\]":             get("mandal",       "property","mandal"),
    "\\[District\\]":           get("district",     "property","district"),
    "\\[State\\]":              get("state",        "property","state"),
    "\\[Pincode\\]":            get("pincode",      "property","pincode"),
    "\\[Land Size\\]":          get("landSize",     "property","extentBeingSold"),
    "\\[Patta Number\\]":       get("pattaNumber",  "property","pattaNumber"),
    "\\[Revenue Village\\]":    get("revenueVillage","property","revenueVillage"),
    "\\[Local Body\\]":         get("localBodyName","property","localBodyName"),
    "\\[North Boundary\\]":     b.north  || "",
    "\\[South Boundary\\]":     b.south  || "",
    "\\[East Boundary\\]":      b.east   || "",
    "\\[West Boundary\\]":      b.west   || "",
    "\\[Total Amount\\]":       fmt(get("saleAmount","transaction","saleConsiderationTotal") || data.totalAmount),
    "\\[Advance Amount\\]":     fmt(get("advanceAmount","transaction","advanceAmountPaid") || data.advanceAmount),
    "\\[Balance Amount\\]":     fmt(get("balanceAmount","transaction","balanceAmount") || data.balanceAmount),
    "\\[Sale Amount In Words\\]": get("saleConsiderationInWords","transaction","saleConsiderationInWords"),
    "\\[Payment Mode\\]":       get("paymentMode","transaction","paymentMode"),
    "\\[Cheque DD Details\\]":  get("chequeOrDdDetails","transaction","chequeOrDdDetails"),
    "\\[Transaction Number\\]": data.transactionNumber || "",
    "\\[Date\\]":               data.agreementDate || "",
    "\\[Registration Number\\]":get("registrationNumber","registration","previousDeedNumber"),
    "\\[Registration Date\\]":  get("registrationDate","registration","registrationDate"),
    "\\[Registration Office\\]":get("registrationOffice","registration","registrationOffice"),
    "\\[Project Name\\]":       get("projectName",  "apartment","projectName"),
    "\\[Builder Name\\]":       get("builderName",  "apartment","builderName"),
    "\\[Flat Number\\]":        get("flatNumber",   "apartment","flatNumber"),
    "\\[Floor Number\\]":       get("floorNumber",  "apartment","floorNumber"),
    "\\[Tower Block\\]":        get("towerOrBlock", "apartment","towerOrBlock"),
    "\\[Undivided Share\\]":    get("undividedShare","apartment","undividedShare"),
    "\\[Carpet Area\\]":        get("carpetArea",   "apartment","carpetArea"),
    "\\[Super Builtup Area\\]": get("superBuiltupArea","apartment","superBuiltupArea"),
    "\\[Car Parking\\]":        get("carParkingNumber","apartment","carParkingNumber"),
    "\\[Auction Number\\]":     get("auctionNumber","government","auctionNumber"),
    "\\[Lot Number\\]":         get("lotNumber",    "government","lotNumber"),
    "\\[GO Number\\]":          get("governmentOrderNumber","government","governmentOrderNumber"),
    "\\[Allotted Date\\]":      get("allottedDate", "government","allottedDate"),
  };

  let result = xml;
  for (const [pattern, value] of Object.entries(map)) {
    if (value) result = result.replace(new RegExp(pattern, "gi"), escapeXml(String(value)));
  }
  return result;
}

function deepMerge(base: any, override: any): any {
  const result = { ...base };
  for (const key in override) {
    if (
      override[key] !== null &&
      typeof override[key] === "object" &&
      !Array.isArray(override[key]) &&
      typeof base[key] === "object"
    ) {
      result[key] = deepMerge(base[key] || {}, override[key]);
    } else if (override[key] !== null && override[key] !== undefined && override[key] !== "") {
      result[key] = override[key];
    }
  }
  return result;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 40);
}

async function convertDocxToPdf(docxBuffer: Buffer): Promise<Buffer> {
  const mammoth = await import("mammoth");
  const { value: htmlContent } = await mammoth.convertToHtml({ buffer: docxBuffer });

  // Wrap the HTML with premium CSS styling for print-ready legal document rendering
  const styledHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400..700;1,400..700&display=swap" rel="stylesheet">
        <style>
          @page {
            size: A4;
            margin: 1.25in 1.25in 1.25in 1.25in;
          }
          body {
            font-family: 'Lora', 'Georgia', 'Times New Roman', serif;
            font-size: 13pt;
            line-height: 1.6;
            color: #111111;
            margin: 0;
            padding: 0;
            text-align: justify;
          }
          h1 {
            text-align: center;
            font-size: 18pt;
            font-weight: 700;
            text-transform: uppercase;
            margin-bottom: 24pt;
            letter-spacing: 0.05em;
          }
          h2, h3 {
            font-size: 14pt;
            font-weight: 700;
            margin-top: 18pt;
            margin-bottom: 12pt;
            text-transform: uppercase;
          }
          p {
            margin-top: 0;
            margin-bottom: 14pt;
            text-indent: 0.5in;
          }
          /* Custom styling for heading lines that don't have indent */
          p strong:only-child, p b:only-child {
            text-indent: 0;
            display: block;
            margin-top: 18pt;
            margin-bottom: 12pt;
            font-size: 14pt;
            text-transform: uppercase;
          }
          ol, ul {
            margin-bottom: 14pt;
            padding-left: 24pt;
          }
          li {
            margin-bottom: 6pt;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 18pt;
            font-size: 11pt;
          }
          th, td {
            border: 1px solid #444444;
            padding: 8px 12px;
            text-align: left;
          }
          th {
            background-color: #f5f5f5;
            font-weight: bold;
          }
          /* Prevent page breaks inside paragraphs or tables if possible */
          p, tr, li {
            page-break-inside: avoid;
          }
        </style>
      </head>
      <body>
        ${htmlContent}
      </body>
    </html>
  `;

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(styledHtml, { waitUntil: "networkidle" });
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: {
        top: "1.25in",
        bottom: "1.25in",
        left: "1.25in",
        right: "1.25in"
      }
    });
    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}
