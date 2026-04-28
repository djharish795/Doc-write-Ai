import { NextRequest, NextResponse } from "next/server";
import { generateHash, getCachedResult, setCachedResult } from "@/lib/cache-utils";
import { askAIWithDocument, askAI, parseAIJson } from "@/lib/aiService";

export async function POST(req: NextRequest) {
  try {
    // Accept both "templateUrl" (page.tsx) and "templateFile" (legacy)
    const body = await req.json();
    const templateFile = body.templateFile || body.templateUrl;

    if (!templateFile) {
      return NextResponse.json({ error: "No template file provided" }, { status: 400 });
    }

    const match = templateFile.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      return NextResponse.json({ error: "Invalid base64 data URL" }, { status: 400 });
    }

    const mimeType = match[1];
    const base64Data = match[2];

    const supportedTypes = [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword",
    ];
    if (!supportedTypes.includes(mimeType)) {
      return NextResponse.json(
        { error: `Unsupported type: ${mimeType}. Upload PDF, DOCX, JPEG, PNG, or WEBP.` },
        { status: 400 }
      );
    }

    // Cache check
    const docHash = generateHash(base64Data);
    const cached = getCachedResult(docHash);
    if (cached) {
      console.log(`[analyze-template] Cache hit: ${docHash}`);
      return NextResponse.json({
        success: true,
        requiredFields: cached.fieldSchema?.map((f: any) => f.name) || [],
        ...cached,
      });
    }

    console.log(`[analyze-template] AI analyzing template (${mimeType})`);

    // This prompt instructs Gemini to deeply analyze the template
    // and produce paragraph-style HTML — never generic tables
    const systemPrompt = `You are a Senior Legal Document Analyst specializing in Indian property law.

Analyze this agreement template document and return a JSON object with the following:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE 1 — PARAGRAPH PROSE OUTPUT (CRITICAL)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The output HTML MUST mirror the original document's writing style:
- If the document is written as flowing legal paragraphs → render as <p> tags. NEVER convert to tables.
- Boundary lines (East/West/North/South or తూర్పు/పడమర/ఉత్తర/దక్షిణం) written as labeled prose → render as <p><strong>East</strong>: value</p>, NOT table rows.
- Only use <table> if the original document EXPLICITLY has a data grid with columns.
- NEVER generate a generic table-based layout. The output must look like the original document.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE 2 — AGREEMENT TYPE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Detect: "direct_owner_sale" | "power_of_attorney_sale" | "government_land_sale" |
        "apartment_flat_sale" | "agricultural_land_sale" | "plot_sale" |
        "commercial_property_sale" | "unknown"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE 3 — HTML RECONSTRUCTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Recreate the EXACT document as full HTML with Tailwind CSS:
- Every paragraph → <p class="text-justify leading-loose mb-4">
- Every legal clause, recital, schedule → preserved VERBATIM, word for word
- Use \${fieldName} placeholders for every variable field (names, dates, amounts, survey numbers)
- Include: <script src="https://cdn.tailwindcss.com"></script> in <head>
- Include: <meta charset="utf-8"> in <head>
- Include: <style>@page { size: A4; margin: 25mm 20mm; } body { font-family: 'Noto Serif', serif; }</style>
- Section headings → <h3 class="text-center font-bold underline mb-2">
- Page markers like ":: 2 ::" → <p class="text-center font-bold">:: 2 ::</p>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE 4 — FIELD SCHEMA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
List every field that needs to be filled:
{ "name": "buyerName", "label": "Buyer Name", "type": "text", "section": "Parties", "required": true, "description": "..." }

Types: "text" | "number" | "date" | "currency" | "area" | "address" | "textarea"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE 5 — EXISTING VALUES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
List any pre-filled values in the template that need replacing for a new transaction:
{ "existingValue": "HARISH", "fieldName": "sellerName", "replaceWith": "dynamic" }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT — Return ONLY valid JSON, no markdown fences:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{
  "agreementType": "...",
  "agreementTypeLabel": "...",
  "documentStyle": "paragraph_prose",
  "tailwindTemplate": "<!DOCTYPE html>...",
  "fieldSchema": [...],
  "existingValues": [...],
  "detectedSections": [...],
  "totalPages": 1
}`;

    let result: any;

    if (mimeType.includes("wordprocessingml") || mimeType.includes("msword")) {
      // DOCX: extract text, send as text prompt
      const mammoth = await import("mammoth");
      const buffer = Buffer.from(base64Data, "base64");
      const { value: docText } = await mammoth.extractRawText({ buffer });
      const fullPrompt = `${systemPrompt}\n\nTEMPLATE DOCUMENT TEXT:\n${docText}`;
      const aiText = await askAI(fullPrompt);
      result = parseAIJson(aiText);
    } else {
      // PDF or image: send inline
      const aiText = await askAIWithDocument(systemPrompt, base64Data, mimeType);
      result = parseAIJson(aiText);
    }

    if (!result) throw new Error("Template analysis returned null");

    setCachedResult(docHash, result);

    console.log(`[analyze-template] ✅ Done. Type: ${result.agreementType}, Fields: ${result.fieldSchema?.length}`);

    return NextResponse.json({
      success: true,
      requiredFields: result.fieldSchema?.map((f: any) => f.name) || [],
      ...result,
    });

  } catch (error: any) {
    console.error("[analyze-template] Error:", error.message);
    return NextResponse.json({ error: error.message || "Failed to analyze template" }, { status: 500 });
  }
}
