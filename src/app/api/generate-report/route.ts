import { NextRequest, NextResponse } from "next/server";
import { askAI, askAIWithDocument, parseAIJson } from "@/lib/aiService";
import JSZip from "jszip";
import {
  Document, Packer, Paragraph, TextRun,
  HeadingLevel, AlignmentType, BorderStyle,
  Table, TableRow, TableCell, WidthType,
} from "docx";

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const body = await req.json();

    const template = body.tailwindTemplate || body.template;
    const extractedDeedData = body.extractedDeedData || body.data || {};
    const userInputs = body.userInputs || body.data || {};
    const agreementType = body.agreementType || "direct_owner_sale";
    const fieldSchema = body.fieldSchema || [];
    const existingValues = body.existingValues || [];

    // Merge data — user inputs always override extracted deed data
    const mergedData = deepMerge(extractedDeedData, userInputs);

    let docxBuffer: Buffer;
    const safeName = sanitize(mergedData.buyerName || "Agreement");

    if (!template) {
      // ── No template: build DOCX from data ──────────────────────────────
      console.log("[generate-report] No template — building DOCX from data");
      docxBuffer = await buildDocxFromData(mergedData);

    } else {
      // ── Template provided: detect type ─────────────────────────────────
      const mimeMatch = template.match(/^data:([^;]+);base64,/);
      const mime = mimeMatch ? mimeMatch[1] : "";
      const base64Data = template.includes(",") ? template.split(",")[1] : template;
      const buffer = Buffer.from(base64Data, "base64");

      // Check magic bytes: DOCX/ZIP starts with PK (0x50 0x4B)
      const isDocx =
        (buffer[0] === 0x50 && buffer[1] === 0x4B) ||
        mime.includes("wordprocessingml") ||
        mime.includes("msword");

      if (isDocx) {
        // ── DOCX template: fill placeholders in XML ─────────────────────
        console.log("[generate-report] DOCX template — filling placeholders");
        docxBuffer = await fillDocxTemplate(buffer, mergedData);
      } else {
        // ── PDF / Image template: AI reads it, builds DOCX ─────────────
        console.log(`[generate-report] ${mime} template — AI reading and building DOCX`);
        docxBuffer = await buildDocxFromNonDocxTemplate(base64Data, mime, mergedData, agreementType, existingValues);
      }
    }

    return new NextResponse(new Uint8Array(docxBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="Agreement_${safeName}.docx"`,
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

// ─── Path 1: Fill DOCX template (XML manipulation) ───────────────────────────

async function fillDocxTemplate(
  buffer: Buffer,
  data: Record<string, any>
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await zip.file("word/document.xml")?.async("string");
  if (!documentXml) throw new Error("Invalid DOCX — missing document.xml");

  // Extract plain text for AI to read
  const mammoth = await import("mammoth");
  const { value: templateText } = await mammoth.extractRawText({ buffer });

  // Ask Gemini to map every placeholder → value
  const prompt = `You are filling an Indian legal agreement template with real data.

TEMPLATE TEXT:
${templateText}

DATA:
${JSON.stringify(data, null, 2)}

TASK:
- Find every placeholder: [Field Name], \${field}, blank lines after labels like "Buyer Name: ___"
- Map each placeholder EXACTLY as it appears in the template to the correct value from the data
- Format amounts as ₹X,XX,XXX (Indian number format)
- If no matching data exists, keep the placeholder as-is

Return ONLY a valid JSON object mapping placeholder → value. No markdown, no explanation.`;

  let replacementMap: Record<string, string>;
  try {
    const aiText = await askAI(prompt);
    replacementMap = parseAIJson(aiText);
  } catch {
    replacementMap = buildDirectMapping(data);
  }

  // Replace in XML
  let modifiedXml = documentXml;
  for (const [placeholder, value] of Object.entries(replacementMap)) {
    if (value) {
      modifiedXml = modifiedXml.replace(
        new RegExp(escapeRegex(placeholder), "gi"),
        escapeXml(String(value))
      );
    }
  }

  // Safety net: direct replacements
  modifiedXml = applyDirectReplacements(modifiedXml, data);

  zip.file("word/document.xml", modifiedXml);
  return await zip.generateAsync({ type: "nodebuffer" });
}

// ─── Path 2: PDF/Image template → AI reads → build DOCX ─────────────────────

async function buildDocxFromNonDocxTemplate(
  base64Data: string,
  mimeType: string,
  data: Record<string, any>,
  agreementType: string,
  existingValues: any[]
): Promise<Buffer> {
  const fmt = (n: any) => (n ? `₹${Number(n).toLocaleString("en-IN")}` : "");

  const prompt = `You are an expert Indian Property Law Document Drafter.

You are given a reference agreement template (as ${mimeType.includes("pdf") ? "PDF" : "image"}) and data to fill into it.

Agreement type: ${agreementType}

DATA TO USE:
${JSON.stringify(data, null, 2)}

OLD VALUES TO REPLACE (if present in template):
${JSON.stringify(existingValues || [])}

TASK:
1. Read the template carefully — understand its structure, clauses, and legal language
2. Produce the COMPLETE filled agreement as plain text paragraphs
3. Replace all placeholders and old values with the new data
4. Preserve ALL legal boilerplate, clauses, recitals VERBATIM
5. Write boundaries (East/West/North/South) as labeled lines, NOT tables
6. For missing data, write [TO BE FILLED]
7. User-provided data takes priority over anything in the template

OUTPUT FORMAT — Return ONLY a JSON object:
{
  "title": "SALE AGREEMENT",
  "paragraphs": [
    "This Agreement for Sale of Land is made on DATE...",
    "PARTIES:",
    "Seller: NAME, S/o FATHER, residing at ADDRESS",
    "Buyer: NAME, S/o FATHER, residing at ADDRESS",
    "PROPERTY DETAILS:",
    "Survey No: VALUE, Village: VALUE, Mandal: VALUE, District: VALUE",
    "Boundaries: East: VALUE, West: VALUE, North: VALUE, South: VALUE",
    "Land Size: VALUE",
    "FINANCIAL TERMS:",
    "Total Sale Consideration: ₹VALUE",
    "Advance Amount Paid: ₹VALUE",
    "Balance Amount: ₹VALUE",
    "Transaction No: VALUE",
    "...all remaining legal clauses verbatim..."
  ]
}`;

  let paragraphs: string[] = [];
  let title = "SALE AGREEMENT";

  try {
    const aiText = mimeType.includes("pdf") || mimeType.startsWith("image/")
      ? await askAIWithDocument(prompt, base64Data, mimeType)
      : await askAI(prompt);

    const parsed = parseAIJson(aiText);
    title = parsed.title || "SALE AGREEMENT";
    paragraphs = parsed.paragraphs || [];
  } catch (e) {
    console.error("[generate-report] AI failed for non-DOCX template, using data directly:", e);
    // Build paragraphs directly from data
    paragraphs = buildParagraphsFromData(data);
  }

  return buildDocxFromParagraphs(title, paragraphs, data);
}

// ─── Path 3: No template — build DOCX from data ──────────────────────────────

async function buildDocxFromData(data: Record<string, any>): Promise<Buffer> {
  const paragraphs = buildParagraphsFromData(data);
  return buildDocxFromParagraphs("SALE AGREEMENT", paragraphs, data);
}

// ─── Build paragraph list from data ──────────────────────────────────────────

function buildParagraphsFromData(data: Record<string, any>): string[] {
  const fmt = (n: any) => (n ? `₹${Number(n).toLocaleString("en-IN")}` : "[TO BE FILLED]");
  const v = (val: any) => (val && String(val).trim() ? String(val) : "[TO BE FILLED]");

  return [
    `Agreement for Sale of ${v(data.propertyType || "Land")}`,
    `Date: ${v(data.agreementDate)}`,
    "",
    "PARTIES",
    "",
    `Seller: ${v(data.sellerName)}, S/o ${v(data.sellerFatherName)}, residing at ${v(data.sellerAddress)}`,
    "",
    `Buyer: ${v(data.buyerName)}, S/o ${v(data.buyerFatherName)}, residing at ${v(data.buyerAddress)}`,
    "",
    "PROPERTY DETAILS",
    "",
    `Survey Number: ${v(data.surveyNumber)}`,
    `Village: ${v(data.village)}`,
    `Mandal: ${v(data.mandal)}`,
    `District: ${v(data.district)}`,
    `Land Size: ${v(data.landSize)} ${v(data.landSizeUnit || "")}`,
    `Property Description: ${v(data.propertyDescription)}`,
    "",
    "BOUNDARIES",
    "",
    `East: ${v(data.boundaries?.east || data.east)}`,
    `West: ${v(data.boundaries?.west || data.west)}`,
    `North: ${v(data.boundaries?.north || data.north)}`,
    `South: ${v(data.boundaries?.south || data.south)}`,
    "",
    "FINANCIAL TERMS",
    "",
    `Total Sale Consideration: ${fmt(data.totalAmount)}`,
    `Advance Amount Paid: ${fmt(data.advanceAmount)}`,
    `Balance Amount Payable: ${fmt(data.balanceAmount)}`,
    `Transaction / Cheque / DD No: ${v(data.transactionNumber)}`,
    "",
    "TERMS AND CONDITIONS",
    "",
    "1. The Seller hereby agrees to sell and the Buyer agrees to purchase the above-described property for the total consideration mentioned above.",
    "2. The Seller confirms that the property is free from all encumbrances, liens, and legal disputes.",
    "3. The balance amount shall be paid at the time of execution of the final Sale Deed.",
    "4. The Seller shall hand over all original title documents to the Buyer upon receipt of full payment.",
    "5. Both parties agree to cooperate for registration of the Sale Deed before the Sub-Registrar.",
    "",
    "SIGNATURES",
    "",
    `Seller: ${v(data.sellerName)}`,
    "",
    `Buyer: ${v(data.buyerName)}`,
    "",
    `Generated on: ${new Date().toLocaleDateString("en-IN")}`,
  ];
}

// ─── Convert paragraph list to DOCX buffer ───────────────────────────────────

async function buildDocxFromParagraphs(
  title: string,
  paragraphs: string[],
  data: Record<string, any>
): Promise<Buffer> {
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

  // Body paragraphs
  for (const para of paragraphs) {
    const trimmed = para.trim();

    if (!trimmed) {
      // Empty line → spacer
      children.push(new Paragraph({ text: "", spacing: { after: 100 } }));
      continue;
    }

    // Section headings (all caps, short lines)
    const isHeading =
      trimmed === trimmed.toUpperCase() &&
      trimmed.length < 60 &&
      !trimmed.includes("₹") &&
      !trimmed.match(/^\d+\./);

    if (isHeading && trimmed.length > 2) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: trimmed, bold: true, size: 24 })],
          spacing: { before: 300, after: 150 },
        })
      );
    } else {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: trimmed, size: 22 })],
          spacing: { after: 160 },
          alignment: AlignmentType.JUSTIFIED,
        })
      );
    }
  }

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: { top: 1440, bottom: 1440, left: 1440, right: 1080 },
        },
      },
      children,
    }],
  });

  return await Packer.toBuffer(doc);
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function buildDirectMapping(data: Record<string, any>): Record<string, string> {
  const fmt = (n: any) => (n ? `₹${Number(n).toLocaleString("en-IN")}` : "");
  return {
    "[Buyer Name]": data.buyerName || "",
    "[Seller Name]": data.sellerName || "",
    "[Buyer Father Name]": data.buyerFatherName || "",
    "[Seller Father Name]": data.sellerFatherName || "",
    "[Buyer Address]": data.buyerAddress || "",
    "[Seller Address]": data.sellerAddress || "",
    "[Property Description]": data.propertyDescription || "",
    "[Survey Number]": data.surveyNumber || "",
    "[Village]": data.village || "",
    "[Mandal]": data.mandal || "",
    "[District]": data.district || "",
    "[Land Size]": data.landSize || "",
    "[Total Amount]": fmt(data.totalAmount),
    "[Advance Amount]": fmt(data.advanceAmount),
    "[Balance Amount]": fmt(data.balanceAmount),
    "[Transaction Number]": data.transactionNumber || "",
    "[Date]": data.agreementDate || "",
  };
}

function applyDirectReplacements(xml: string, data: Record<string, any>): string {
  const fmt = (n: any) => (n ? `₹${Number(n).toLocaleString("en-IN")}` : "");
  const map: Record<string, string> = {
    "\\[Buyer Name\\]": data.buyerName,
    "\\[Seller Name\\]": data.sellerName,
    "\\[Buyer Father Name\\]": data.buyerFatherName,
    "\\[Seller Father Name\\]": data.sellerFatherName,
    "\\[Buyer Address\\]": data.buyerAddress,
    "\\[Seller Address\\]": data.sellerAddress,
    "\\[Property Description\\]": data.propertyDescription,
    "\\[Survey Number\\]": data.surveyNumber,
    "\\[Village\\]": data.village,
    "\\[Mandal\\]": data.mandal,
    "\\[District\\]": data.district,
    "\\[Land Size\\]": data.landSize,
    "\\[Total Amount\\]": fmt(data.totalAmount),
    "\\[Advance Amount\\]": fmt(data.advanceAmount),
    "\\[Balance Amount\\]": fmt(data.balanceAmount),
    "\\[Transaction Number\\]": data.transactionNumber,
    "\\[Date\\]": data.agreementDate,
  };
  let result = xml;
  for (const [pattern, value] of Object.entries(map)) {
    if (value) result = result.replace(new RegExp(pattern, "gi"), escapeXml(String(value)));
  }
  return result;
}

function flattenObject(obj: any, prefix = "", result: Record<string, any> = {}): Record<string, any> {
  for (const key in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (obj[key] !== null && typeof obj[key] === "object" && !Array.isArray(obj[key])) {
      flattenObject(obj[key], fullKey, result);
      flattenObject(obj[key], "", result);
    } else if (Array.isArray(obj[key])) {
      result[fullKey] = obj[key].join(", ");
      if (!result[key]) result[key] = obj[key].join(", ");
    } else {
      result[fullKey] = obj[key];
      if (!result[key]) result[key] = obj[key];
    }
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
