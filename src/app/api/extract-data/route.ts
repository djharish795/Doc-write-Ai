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

    const prompt = `You are a Senior Indian Property Law Expert and Document Data Extraction Specialist.

Extract EVERY detail from this sale deed. Do not skip, summarize, or paraphrase anything.
Translate Telugu/Hindi/Kannada/Tamil text to English accurately.

Return ONLY a valid JSON object with this exact structure (use null or empty string for missing fields, do NOT fabricate data):
{
  "parties": {
    "seller": {
      "fullName": "",
      "fatherOrHusbandName": "",
      "age": "",
      "address": "",
      "aadhaar": "",
      "pan": ""
    },
    "buyer": {
      "fullName": "",
      "fatherOrHusbandName": "",
      "age": "",
      "address": "",
      "aadhaar": "",
      "pan": ""
    },
    "powerOfAttorneyHolder": null,
    "witnesses": []
  },
  "property": {
    "surveyNumber": "",
    "subDivisionNumber": "",
    "plotNumber": "",
    "doorNumber": "",
    "ward": "",
    "block": "",
    "village": "",
    "mandal": "",
    "district": "",
    "state": "",
    "pincode": "",
    "fullAddress": "",
    "propertyType": "",
    "totalAreaAcres": "",
    "totalAreaCents": "",
    "totalAreaSqYards": "",
    "totalAreaSqFeet": "",
    "totalAreaSqMeters": "",
    "extentBeingSold": "",
    "boundaries": {
      "north": "",
      "south": "",
      "east": "",
      "west": ""
    },
    "schedule": "",
    "pattaNumber": "",
    "revenueVillage": "",
    "localBodyName": ""
  },
  "transaction": {
    "saleConsiderationTotal": "",
    "saleConsiderationInWords": "",
    "advanceAmountPaid": "",
    "advancePaidOn": "",
    "balanceAmount": "",
    "balancePaymentDeadline": "",
    "paymentMode": "",
    "chequeOrDdDetails": ""
  },
  "registration": {
    "previousDeedNumber": "",
    "previousDeedDate": "",
    "registrationOffice": "",
    "bookNumber": "",
    "executionDate": "",
    "registrationDate": ""
  },
  "encumbrance": {
    "anyLoanOrMortgage": false,
    "loanDetails": "",
    "nocDetails": ""
  },
  "apartment": {
    "projectName": "",
    "builderName": "",
    "flatNumber": "",
    "floorNumber": "",
    "towerOrBlock": "",
    "undividedShare": "",
    "carpetArea": "",
    "superBuiltupArea": "",
    "carParkingNumber": ""
  },
  "government": {
    "auctionNumber": "",
    "lotNumber": "",
    "governmentOrderNumber": "",
    "allottedDate": ""
  },
  "additionalClauses": [],
  "specialConditions": "",
  "rawScheduleText": "",
  "extractionNotes": "",

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
}

IMPORTANT: Populate BOTH the nested structure (parties/property/transaction/etc.) AND the flat top-level fields (buyerName, sellerName, surveyNumber, etc.) — the flat fields must mirror the nested values for backward compatibility.`;

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

    // Normalize: ensure flat top-level fields are populated from nested structure
    // (AI may fill nested but not flat, or vice versa — we reconcile both)
    if (extractedData) {
      const p = extractedData.parties || {};
      const prop = extractedData.property || {};
      const tx = extractedData.transaction || {};
      const reg = extractedData.registration || {};

      // Flat fields ← nested (only if flat is empty)
      if (!extractedData.buyerName && p.buyer?.fullName) extractedData.buyerName = p.buyer.fullName;
      if (!extractedData.buyerFatherName && p.buyer?.fatherOrHusbandName) extractedData.buyerFatherName = p.buyer.fatherOrHusbandName;
      if (!extractedData.buyerAddress && p.buyer?.address) extractedData.buyerAddress = p.buyer.address;
      if (!extractedData.sellerName && p.seller?.fullName) extractedData.sellerName = p.seller.fullName;
      if (!extractedData.sellerFatherName && p.seller?.fatherOrHusbandName) extractedData.sellerFatherName = p.seller.fatherOrHusbandName;
      if (!extractedData.sellerAddress && p.seller?.address) extractedData.sellerAddress = p.seller.address;
      if (!extractedData.surveyNumber && prop.surveyNumber) extractedData.surveyNumber = prop.surveyNumber;
      if (!extractedData.village && prop.village) extractedData.village = prop.village;
      if (!extractedData.mandal && prop.mandal) extractedData.mandal = prop.mandal;
      if (!extractedData.district && prop.district) extractedData.district = prop.district;
      if (!extractedData.state && prop.state) extractedData.state = prop.state;
      if (!extractedData.landSize && prop.extentBeingSold) extractedData.landSize = prop.extentBeingSold;
      if (!extractedData.boundaries && prop.boundaries) extractedData.boundaries = prop.boundaries;
      if (!extractedData.saleAmount && tx.saleConsiderationTotal) extractedData.saleAmount = tx.saleConsiderationTotal;
      if (!extractedData.advanceAmount && tx.advanceAmountPaid) extractedData.advanceAmount = tx.advanceAmountPaid;
      if (!extractedData.balanceAmount && tx.balanceAmount) extractedData.balanceAmount = tx.balanceAmount;
      if (!extractedData.registrationDate && reg.registrationDate) extractedData.registrationDate = reg.registrationDate;
      if (!extractedData.propertyDescription && prop.schedule) extractedData.propertyDescription = prop.schedule;

      // Nested ← flat (only if nested is empty)
      if (!p.buyer) extractedData.parties = { ...extractedData.parties, buyer: {} };
      if (!extractedData.parties?.buyer?.fullName && extractedData.buyerName)
        extractedData.parties.buyer.fullName = extractedData.buyerName;
      if (!extractedData.parties?.seller?.fullName && extractedData.sellerName)
        extractedData.parties.seller.fullName = extractedData.sellerName;
    }

    // Cache raw extraction
    setCachedResult(docHash, extractedData);

    // Merge user inputs (user inputs take priority)
    const finalData = userInputs ? { ...extractedData, ...userInputs } : extractedData;

    // Warn on missing critical fields
    const warnings: string[] = [];
    ["buyerName", "sellerName", "surveyNumber"].forEach((f) => {
      if (!finalData[f] || String(finalData[f]).trim() === "") {
        // Also check nested structure before warning
        const nested = f === "buyerName" ? finalData.parties?.buyer?.fullName
          : f === "sellerName" ? finalData.parties?.seller?.fullName
          : f === "surveyNumber" ? finalData.property?.surveyNumber
          : null;
        if (!nested || String(nested).trim() === "") {
          warnings.push(`Missing: ${f}`);
        }
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
