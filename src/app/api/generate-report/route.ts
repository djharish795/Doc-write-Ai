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
