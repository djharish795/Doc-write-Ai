import { NextRequest, NextResponse } from "next/server";
import { generateHash, getCachedResult, setCachedResult } from "@/lib/cache-utils";
import { askAIWithDocument, askAI, parseAIJson } from "@/lib/aiService";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export async function POST(req: NextRequest) {
  try {
    // page.tsx sends: { pdfUrl, userInputs }
    const { pdfUrl, userInputs } = await req.json();

    if (!pdfUrl) {
      return NextResponse.json({ success: false, error: "No document provided" }, { status: 400 });
    }

    const match = pdfUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      return NextResponse.json({ success: false, error: "Invalid base64 data URL" }, { status: 400 });
    }

    const mimeType = match[1];
    const base64Data = match[2];

    // Validate size
    const sizeBytes = (base64Data.length * 3) / 4;
    if (sizeBytes > MAX_FILE_SIZE) {
      return NextResponse.json({ success: false, error: "File exceeds 10MB limit" }, { status: 413 });
    }

    const supportedTypes = [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword",
    ];
    if (!supportedTypes.includes(mimeType)) {
      return NextResponse.json({ success: false, error: `Unsupported type: ${mimeType}` }, { status: 400 });
    }

    // Cache check
    const docHash = generateHash(base64Data);
    const cached = getCachedResult(docHash);
    if (cached) {
      console.log(`[extract-data] Cache hit: ${docHash}`);
      return NextResponse.json({
        success: true,
        data: userInputs ? { ...cached, ...userInputs } : cached,
      });
    }

    console.log(`[extract-data] AI extracting from ${mimeType} (${(sizeBytes / 1024).toFixed(1)} KB)`);

    const prompt = `You are an expert in Indian legal documents — sale deeds written in Telugu, Hindi, or English.

Extract EVERY detail from this sale deed. Do not skip, summarize, or paraphrase anything.
Translate Telugu/Hindi text to English accurately.

Return ONLY a valid JSON object with this exact structure:
{
  "buyerName": "",
  "buyerFatherName": "",
  "buyerAddress": "",
  "sellerName": "",
  "sellerFatherName": "",
  "sellerAddress": "",
  "propertyDescription": "",
  "surveyNumber": "",
  "village": "",
  "mandal": "",
  "district": "",
  "state": "",
  "landSize": "",
  "landSizeUnit": "",
  "boundaries": {
    "north": "",
    "south": "",
    "east": "",
    "west": ""
  },
  "saleAmount": "",
  "advanceAmount": "",
  "balanceAmount": "",
  "registrationNumber": "",
  "registrationDate": "",
  "witnesses": [],
  "additionalDetails": ""
}`;

    let extractedData: any;

    if (mimeType.includes("wordprocessingml") || mimeType.includes("msword")) {
      // DOCX: extract text first, then send as text prompt
      const mammoth = await import("mammoth");
      const buffer = Buffer.from(base64Data, "base64");
      const { value: docText } = await mammoth.extractRawText({ buffer });
      const textPrompt = `${prompt}\n\nSALE DEED TEXT:\n${docText}`;
      const aiText = await askAI(textPrompt);
      extractedData = parseAIJson(aiText);
    } else {
      // PDF or image: send inline to Gemini vision
      const aiText = await askAIWithDocument(prompt, base64Data, mimeType);
      extractedData = parseAIJson(aiText);
    }

    // Cache raw extraction
    setCachedResult(docHash, extractedData);

    // Merge user inputs (user inputs take priority)
    const finalData = userInputs ? { ...extractedData, ...userInputs } : extractedData;

    // Warn on missing critical fields
    const warnings: string[] = [];
    ["buyerName", "sellerName", "surveyNumber"].forEach((f) => {
      if (!finalData[f] || String(finalData[f]).trim() === "") {
        warnings.push(`Missing: ${f}`);
      }
    });

    console.log(`[extract-data] ✅ Done. Warnings: ${warnings.length}`);

    return NextResponse.json({
      success: true,
      data: finalData,
      ...(warnings.length > 0 && { warnings }),
    });

  } catch (error: any) {
    console.error("[extract-data] Error:", error.message);
    return NextResponse.json({ success: false, error: error.message || "Extraction failed" }, { status: 500 });
  }
}
