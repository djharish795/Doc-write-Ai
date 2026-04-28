import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { generateHash, getCachedResult, setCachedResult } from "@/lib/cache-utils";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: 30 * 60 * 1000,
});

export async function POST(req: NextRequest) {
  try {
    const { saleDeedFile, agreementType } = await req.json();

    if (!saleDeedFile) {
      return NextResponse.json({ error: "No sale deed file provided" }, { status: 400 });
    }

    const match = saleDeedFile.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      return NextResponse.json({ error: "Invalid file format. Must be a base64 Data URL." }, { status: 400 });
    }

    const mediaType = match[1];
    const base64Data = match[2];

    const supportedTypes = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
    if (!supportedTypes.includes(mediaType)) {
      return NextResponse.json(
        { error: `Unsupported file type: ${mediaType}. Please upload PDF, JPEG, PNG, or WEBP.` },
        { status: 400 }
      );
    }

    const docHash = generateHash(base64Data + (agreementType || ""));
    const cachedResult = getCachedResult(docHash);
    if (cachedResult) {
      console.log(`[extract-sale-deed] Cache hit: ${docHash}`);
      return NextResponse.json(cachedResult);
    }
    console.log(`[extract-sale-deed] Cache miss: ${docHash} — extracting with Claude...`);

    const contentBlocks: Anthropic.MessageParam["content"] = [];

    if (mediaType === "application/pdf") {
      contentBlocks.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: base64Data },
      } as any);
    } else {
      contentBlocks.push({
        type: "image",
        source: {
          type: "base64",
          media_type: mediaType as "image/jpeg" | "image/png" | "image/webp",
          data: base64Data,
        },
      });
    }

    contentBlocks.push({
      type: "text",
      text: `Extract every detail from this sale deed document. Agreement type context: ${agreementType || "unknown"}`,
    });

    const agreementTypeContext = buildAgreementTypeContext(agreementType);

    const response = await anthropic.messages.create({
      model: process.env.CLAUDE_MODEL || "claude-sonnet-4-5",
      max_tokens: 16000,
      temperature: 0,
      system: `You are a Senior Indian Property Law Expert and Document Data Extraction Specialist. You extract COMPLETE and ACCURATE data from sale deed documents for use in generating new property agreements.

${agreementTypeContext}

EXTRACTION REQUIREMENTS:
1. Extract EVERY piece of data — do not summarize, skip, or paraphrase. Include all names, addresses, survey numbers, measurements, boundary details, clauses, covenants, and financial figures.
2. If the document is in Telugu, Tamil, Hindi, Kannada, or any regional Indian language, translate to English accurately.
3. For financial figures, extract exact amounts including rupees in words and numbers.
4. For property boundaries (North, South, East, West / उत्तर, दक्षिण, पूर्व, पश्चिम), extract them with full detail.
5. Identify all parties (Sellers, Buyers, Witnesses, Guarantors, PoA holders if applicable).
6. Extract property schedule / pasupustakam details completely.
7. Extract encumbrance, mutation, and registration details if present.

OUTPUT — Return ONLY a valid JSON object, no markdown, no commentary:

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
  "extractionNotes": ""
}

If any field is not present in the document, return null or empty string for that field. Do NOT fabricate data.`,
      messages: [{ role: "user", content: contentBlocks }],
    });

    if (response.stop_reason === "max_tokens") {
      throw new Error("Extraction was truncated. Please try with a shorter document or contact support.");
    }

    const content = response.content[0];
    if (content.type !== "text") throw new Error("Unexpected response type from Claude");

    let extractedData: any = null;
    try {
      const jsonMatch = content.text.match(/\{[\s\S]*\}/);
      extractedData = JSON.parse(jsonMatch ? jsonMatch[0] : content.text);
    } catch {
      const cleaned = content.text.replace(/```json\n?|\n?```/g, "").trim();
      extractedData = JSON.parse(cleaned);
    }

    if (!extractedData) throw new Error("Extraction returned null");

    setCachedResult(docHash, extractedData);
    return NextResponse.json(extractedData);
  } catch (error: any) {
    console.error("[extract-sale-deed] Error:", error);
    return NextResponse.json({ error: error.message || "Failed to extract sale deed data" }, { status: 500 });
  }
}

function buildAgreementTypeContext(agreementType: string | undefined): string {
  const contexts: Record<string, string> = {
    direct_owner_sale: `This is a DIRECT OWNER SALE deed. Focus on: full seller identity and title chain, mutation records, patta details, prior sale deed references, complete boundary schedule, and encumbrance certificate details.`,

    power_of_attorney_sale: `This is a POWER OF ATTORNEY (PoA) SALE. Focus on: original owner details, PoA holder identity, PoA registration details (document number, date, registration office), scope of PoA authority, and whether PoA is general or specific.`,

    government_land_sale: `This is a GOVERNMENT LAND SALE. Focus on: government order number, auction/allotment details, lot number, pattadar details, conditions imposed by government, and any restrictions on resale.`,

    apartment_flat_sale: `This is an APARTMENT/FLAT SALE. Focus on: builder/developer name, project name, approved plan details, RERA registration number, flat number, floor, tower, undivided share of land (UDS), common areas description, car parking, and OC/CC details.`,

    agricultural_land_sale: `This is an AGRICULTURAL LAND SALE. Focus on: survey number, sub-division, patta number, water source (irrigation/rain-fed), crop details, revenue village, mandal, district, land classification (wet/dry), and any conversion orders.`,

    plot_sale: `This is a PLOT SALE. Focus on: layout approval number, DTCP/HMDA/RERA approval, plot number, dimensions, road facing, facing direction, and any development restrictions.`,

    commercial_property_sale: `This is a COMMERCIAL PROPERTY SALE. Focus on: commercial usage approvals, GST registration details, trade license details, shop/office number, and any tenancy agreements.`,
  };

  return contexts[agreementType || ""] || `Extract all available details from this sale deed document regardless of property type.`;
}
