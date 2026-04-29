"use client";

import React, { useState } from "react";
import AgreementForm from "@/components/AgreementForm";
import FileUploader from "@/components/FileUploader";
import {
  FileText,
  FileCheck,
  ClipboardList,
  Settings,
  FileOutput,
  Loader2,
  AlertCircle,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type StepStatus = "idle" | "uploading" | "completed";
type ExtractionStatus = "idle" | "processing" | "completed";

interface TransactionDetails {
  // Buyer Details
  buyerName: string;
  buyerAddress: string;
  buyerFatherName: string;
  
  // Seller Details
  sellerName: string;
  sellerAddress: string;
  sellerFatherName: string;
  
  // Transaction Details
  agreementDate: string;
  totalAmount: string;
  advanceAmount: string;
  balanceAmount: string;
  transactionNumber: string;
  propertyType: "Land" | "Flat" | "Government" | "POA";
}

const PROPERTY_TYPES = ["Land", "Flat", "Government", "POA"] as const;

const STEPS = [
  { id: 1, label: "Sale Deed", icon: FileText },
  { id: 2, label: "Template", icon: FileCheck },
  { id: 3, label: "Agreement", icon: ClipboardList },
  { id: 4, label: "Configure", icon: Settings },
  { id: 5, label: "Generate", icon: FileOutput },
] as const;

// ─── Component ────────────────────────────────────────────────────────────────

export default function Home() {
  const [step, setStep] = useState(1);

  // File upload states
  const [deedStatus, setDeedStatus] = useState<StepStatus>("idle");
  const [templateStatus, setTemplateStatus] = useState<StepStatus>("idle");

  // Processing states
  const [extractionStatus, setExtractionStatus] = useState<ExtractionStatus>("idle");

  // Loading feedback
  const [loadingText, setLoadingText] = useState("");

  // Data
  const [deedBase64, setDeedBase64] = useState<string>("");
  const [tailwindTemplate, setTailwindTemplate] = useState<string>("");
  const [templateSchema, setTemplateSchema] = useState<any[]>([]);
  const [extractedData, setExtractedData] = useState<any>(null);
  const [missingFields, setMissingFields] = useState<string[]>([]);
  const [manualFields, setManualFields] = useState<Record<string, string>>({});

  // Agreement details form
  const [txDetails, setTxDetails] = useState<TransactionDetails>({
    // Buyer Details
    buyerName: "",
    buyerAddress: "",
    buyerFatherName: "",
    
    // Seller Details
    sellerName: "",
    sellerAddress: "",
    sellerFatherName: "",
    
    // Transaction Details
    agreementDate: "",
    totalAmount: "",
    advanceAmount: "",
    balanceAmount: "",
    transactionNumber: "",
    propertyType: "Land",
  });

  const [formError, setFormError] = useState<string | null>(null);

  // ── Step 1: Upload Sale Deed ──────────────────────────────────────────────

  const handleDeedUpload = async (file: File) => {
    setDeedStatus("uploading");
    setLoadingText("Reading sale deed document...");

    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result as string;
      setDeedBase64(base64);
      setDeedStatus("completed");

      // ── AI extraction starts IMMEDIATELY on upload ──────────────────────
      setExtractionStatus("processing");
      setLoadingText("AI is reading your sale deed and extracting property details...");

      try {
        const response = await fetch("/api/extract-data", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pdfUrl: base64 }),
        });

        const result = await response.json();

        if (result.success && result.data) {
          setExtractedData(result.data);
          setExtractionStatus("completed");
          setLoadingText("Property details extracted successfully!");

          // Pre-fill seller details from extracted data if available
          if (result.data.sellerName || result.data.parties?.seller?.fullName) {
            const d = result.data;
            const seller = d.parties?.seller || {};
            const buyer  = d.parties?.buyer  || {};
            const tx     = d.transaction     || {};

            setTxDetails((prev) => ({
              ...prev,
              // Seller — flat field takes priority, fall back to nested
              sellerName:       d.sellerName       || seller.fullName          || prev.sellerName,
              sellerFatherName: d.sellerFatherName  || seller.fatherOrHusbandName || prev.sellerFatherName,
              sellerAddress:    d.sellerAddress     || seller.address           || prev.sellerAddress,
              // Buyer — pre-fill if extracted (user can override in Step 3)
              buyerName:        d.buyerName         || buyer.fullName           || prev.buyerName,
              buyerFatherName:  d.buyerFatherName   || buyer.fatherOrHusbandName || prev.buyerFatherName,
              buyerAddress:     d.buyerAddress      || buyer.address            || prev.buyerAddress,
              // Transaction amounts — pre-fill if found in deed
              totalAmount:      d.saleAmount        || tx.saleConsiderationTotal || prev.totalAmount,
              advanceAmount:    d.advanceAmount      || tx.advanceAmountPaid     || prev.advanceAmount,
              balanceAmount:    d.balanceAmount      || tx.balanceAmount         || prev.balanceAmount,
            }));
          }
        } else {
          console.warn("[Step1] Extraction warning:", result.error);
          setExtractionStatus("idle");
        }
      } catch (err) {
        console.error("[Step1] Extraction error:", err);
        setExtractionStatus("idle");
      }

      setTimeout(() => setStep(2), 800);
    };

    reader.readAsDataURL(file);
  };

  // ── Step 2: Upload Agreement Template ────────────────────────────────────

  const handleTemplateUpload = async (file: File) => {
    setTemplateStatus("uploading");
    setLoadingText("Analyzing agreement template...");

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = reader.result as string;
        setTailwindTemplate(base64);

        // Analyze template to identify required fields
        try {
          const analyzeResponse = await fetch("/api/analyze-template", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ templateUrl: base64 }),
          });

          const analyzeResult = await analyzeResponse.json();

          if (analyzeResult.success) {
            console.log("Template analysis successful:", analyzeResult.requiredFields);
            setTemplateSchema(analyzeResult.requiredFields || []);
          } else {
            console.warn("Template analysis failed:", analyzeResult.error);
          }
        } catch (error) {
          console.error("Template analysis error:", error);
        }

        setTemplateStatus("completed");
        setTimeout(() => setStep(3), 500);
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error("Template upload error:", error);
      setTemplateStatus("idle");
    }
  };

  // ── Step 3: Validate agreement details form ─────────────────────────────

  const handleTxChange = (field: keyof TransactionDetails, value: string) => {
    setTxDetails((prev) => ({ ...prev, [field]: value }));
    
    // Auto-calculate balance amount
    if (field === "totalAmount" || field === "advanceAmount") {
      const total = field === "totalAmount" ? parseFloat(value) || 0 : parseFloat(txDetails.totalAmount) || 0;
      const advance = field === "advanceAmount" ? parseFloat(value) || 0 : parseFloat(txDetails.advanceAmount) || 0;
      const balance = total - advance;
      setTxDetails((prev) => ({ ...prev, balanceAmount: balance >= 0 ? balance.toString() : "0" }));
    }
    
    setFormError(null);
  };

  const handleProceedToGenerate = async () => {
    // Buyer validation
    if (!txDetails.buyerName.trim()) {
      setFormError("Buyer Name is required.");
      return;
    }
    if (!txDetails.buyerAddress.trim()) {
      setFormError("Buyer Address is required.");
      return;
    }
    
    // Seller validation
    if (!txDetails.sellerName.trim()) {
      setFormError("Seller Name is required.");
      return;
    }
    if (!txDetails.sellerAddress.trim()) {
      setFormError("Seller Address is required.");
      return;
    }
    
    // Transaction validation
    if (!txDetails.agreementDate.trim()) {
      setFormError("Agreement Date is required.");
      return;
    }
    if (!txDetails.totalAmount.trim()) {
      setFormError("Total Amount is required.");
      return;
    }
    
    setFormError(null);
    setStep(4);
  };

  // ── Step 4: Merge user inputs with already-extracted deed data ───────────

  const handleProceedToFinalStep = async () => {
    // If extraction already completed at Step 1, just merge user inputs and proceed
    if (extractionStatus === "completed" && extractedData) {
      const merged = {
        // Spread all extracted data (includes nested parties/property/transaction/etc.)
        ...extractedData,
        // User inputs always override extracted data (flat fields)
        buyerName:        txDetails.buyerName        || extractedData.buyerName,
        buyerFatherName:  txDetails.buyerFatherName  || extractedData.buyerFatherName,
        buyerAddress:     txDetails.buyerAddress     || extractedData.buyerAddress,
        sellerName:       txDetails.sellerName       || extractedData.sellerName,
        sellerFatherName: txDetails.sellerFatherName || extractedData.sellerFatherName,
        sellerAddress:    txDetails.sellerAddress    || extractedData.sellerAddress,
        agreementDate:    txDetails.agreementDate,
        totalAmount:      txDetails.totalAmount,
        advanceAmount:    txDetails.advanceAmount,
        balanceAmount:    txDetails.balanceAmount,
        transactionNumber: txDetails.transactionNumber,
        propertyType:     txDetails.propertyType,
        // Also update nested parties so generate-report can use either path
        parties: {
          ...extractedData.parties,
          buyer: {
            ...extractedData.parties?.buyer,
            fullName:            txDetails.buyerName        || extractedData.parties?.buyer?.fullName,
            fatherOrHusbandName: txDetails.buyerFatherName  || extractedData.parties?.buyer?.fatherOrHusbandName,
            address:             txDetails.buyerAddress     || extractedData.parties?.buyer?.address,
          },
          seller: {
            ...extractedData.parties?.seller,
            fullName:            txDetails.sellerName       || extractedData.parties?.seller?.fullName,
            fatherOrHusbandName: txDetails.sellerFatherName || extractedData.parties?.seller?.fatherOrHusbandName,
            address:             txDetails.sellerAddress    || extractedData.parties?.seller?.address,
          },
        },
        // Also update nested transaction
        transaction: {
          ...extractedData.transaction,
          saleConsiderationTotal: txDetails.totalAmount   || extractedData.transaction?.saleConsiderationTotal,
          advanceAmountPaid:      txDetails.advanceAmount || extractedData.transaction?.advanceAmountPaid,
          balanceAmount:          txDetails.balanceAmount || extractedData.transaction?.balanceAmount,
        },
      };
      setExtractedData(merged);
      setStep(5);
      return;
    }

    // Fallback: if extraction didn't run at Step 1 (e.g. no deed uploaded), run now
    if (!deedBase64) {
      setStep(5);
      return;
    }

    setExtractionStatus("processing");
    setLoadingText("Extracting data from sale deed...");

    try {
      const response = await fetch("/api/extract-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pdfUrl: deedBase64,
          userInputs: {
            buyerName:        txDetails.buyerName,
            buyerFatherName:  txDetails.buyerFatherName,
            buyerAddress:     txDetails.buyerAddress,
            sellerName:       txDetails.sellerName,
            sellerFatherName: txDetails.sellerFatherName,
            sellerAddress:    txDetails.sellerAddress,
            advanceAmount:    txDetails.advanceAmount,
            totalAmount:      txDetails.totalAmount,
            balanceAmount:    txDetails.balanceAmount,
            agreementDate:    txDetails.agreementDate,
            transactionNumber: txDetails.transactionNumber,
            propertyType:     txDetails.propertyType,
          },
        }),
      });

      const result = await response.json();

      if (result.success) {
        setExtractedData(result.data);
        setExtractionStatus("completed");
        setStep(5);
      } else {
        console.error("Extraction failed:", result.error);
        setExtractionStatus("idle");
        setExtractedData(null);
        setStep(5);
      }
    } catch (error) {
      console.error("Extraction error:", error);
      setExtractionStatus("idle");
      setExtractedData(null);
      setStep(5);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <main className="min-h-screen bg-[#121212]">
      {/* Header */}
      <header className="bg-[#1A1A1A] border-b border-[#404040]">
        <div className="max-w-[1000px] mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-lime-400" />
            <h1 className="text-lg font-semibold text-[#E5E5E5]">AgreementStudio</h1>
          </div>
          <nav className="hidden md:flex gap-6">
            {["Documents", "History", "Settings"].map((item) => (
              <a
                key={item}
                href="#"
                className="text-sm font-medium text-[#A3A3A3] hover:text-[#E5E5E5] transition-colors"
              >
                {item}
              </a>
            ))}
          </nav>
        </div>
      </header>

      <div className="max-w-[1000px] mx-auto px-6 py-12">
        {/* Stepper */}
        <div className="mb-12">
          <div className="flex items-center justify-between relative">
            {/* Progress Line */}
            <div className="absolute top-5 left-0 right-0 h-px bg-[#404040] z-0">
              <div
                className="h-full bg-lime-400 transition-all duration-300"
                style={{ width: `${((step - 1) / (STEPS.length - 1)) * 100}%` }}
              />
            </div>

            {/* Steps */}
            {STEPS.map((s) => (
              <div
                key={s.id}
                className={cn(
                  "relative flex flex-col items-center gap-2 transition-all duration-300 z-10",
                  step >= s.id ? "opacity-100" : "opacity-40"
                )}
              >
                <div
                  className={cn(
                    "w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 border-2 bg-[#1A1A1A]",
                    step === s.id
                      ? "border-lime-400 text-lime-400"
                      : step > s.id
                      ? "border-lime-400 bg-lime-400 text-[#121212]"
                      : "border-[#404040] text-[#737373]"
                  )}
                >
                  {step > s.id ? (
                    <Check className="w-5 h-5" />
                  ) : (
                    <span className="text-sm font-semibold">{s.id}</span>
                  )}
                </div>
                <span
                  className={cn(
                    "text-xs font-medium text-center hidden sm:block",
                    step >= s.id ? "text-[#E5E5E5]" : "text-[#737373]"
                  )}
                >
                  {s.label}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Step Content */}
        <div className="bg-[#1A1A1A] border border-[#404040] rounded-lg card-shadow p-8 md:p-12 min-h-[500px] fade-in">
          {/* STEP 1 — Upload Sale Deed */}
          {step === 1 && (
            <div className="space-y-6">
              <div className="text-center space-y-2">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-[#262626] mb-2">
                  <span className="text-xs font-medium text-[#A3A3A3]">Step 1 of 5</span>
                </div>
                <h2 className="text-2xl font-semibold text-[#E5E5E5]">Upload Sale Deed</h2>
                <p className="text-sm text-[#A3A3A3] max-w-md mx-auto">
                  Upload the original sale deed document. Our system will extract all relevant property and party details.
                </p>
              </div>

              <div className="max-w-xl mx-auto">
                <FileUploader
                  title="Sale Deed Document"
                  description="PDF or DOCX — scanned or digital"
                  icon="pdf"
                  status={deedStatus}
                  onUpload={handleDeedUpload}
                />
              </div>

              {/* AI extraction status feedback */}
              {deedStatus === "uploading" && (
                <div className="flex items-center justify-center gap-2 text-[#A3A3A3]">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <p className="text-sm">{loadingText}</p>
                </div>
              )}

              {deedStatus === "completed" && extractionStatus === "processing" && (
                <div className="max-w-xl mx-auto p-4 bg-lime-400/5 border border-lime-400/20 rounded-lg flex items-center gap-3">
                  <Loader2 className="w-5 h-5 animate-spin text-lime-400 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-[#E5E5E5]">AI is reading your sale deed...</p>
                    <p className="text-xs text-[#A3A3A3]">Extracting property details, boundaries, and party information</p>
                  </div>
                </div>
              )}

              {deedStatus === "completed" && extractionStatus === "completed" && (
                <div className="max-w-xl mx-auto p-4 bg-lime-400/10 border border-lime-400/30 rounded-lg flex items-center gap-3">
                  <Check className="w-5 h-5 text-lime-400 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-lime-400">Property details extracted!</p>
                    <p className="text-xs text-[#A3A3A3]">Survey number, boundaries, and party details are ready</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 2 — Upload Agreement Template */}
          {step === 2 && (
            <div className="space-y-6">
              <div className="text-center space-y-2">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-[#262626] mb-2">
                  <span className="text-xs font-medium text-[#A3A3A3]">Step 2 of 5</span>
                </div>
                <h2 className="text-2xl font-semibold text-[#E5E5E5]">Agreement Template</h2>
                <p className="text-sm text-[#A3A3A3] max-w-md mx-auto">
                  Upload your agreement template document. This will be used to generate the final agreement.
                </p>
              </div>

              <div className="max-w-xl mx-auto">
                <FileUploader
                  title="Agreement Template"
                  description="PDF or DOCX template document"
                  icon="pdf"
                  status={templateStatus}
                  onUpload={handleTemplateUpload}
                />
              </div>

              {templateStatus === "uploading" && (
                <div className="flex items-center justify-center gap-2 text-[#A3A3A3]">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <p className="text-sm">{loadingText}</p>
                </div>
              )}
            </div>
          )}

          {/* STEP 3 — Agreement Details */}
          {step === 3 && (
            <div className="space-y-6">
              <div className="text-center space-y-2">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-[#262626] mb-2">
                  <span className="text-xs font-medium text-[#A3A3A3]">Step 3 of 5</span>
                </div>
                <h2 className="text-2xl font-semibold text-[#E5E5E5]">Agreement Details</h2>
                <p className="text-sm text-[#A3A3A3] max-w-md mx-auto">
                  Enter buyer, seller, and transaction information for the agreement.
                </p>
              </div>

              <div className="max-w-3xl mx-auto space-y-6">
                {/* BUYER DETAILS SECTION */}
                <div className="border border-[#404040] rounded-lg p-6 space-y-4">
                  <div className="flex items-center gap-2 pb-3 border-b border-[#404040]">
                    <div className="w-8 h-8 rounded-md bg-lime-400/10 flex items-center justify-center">
                      <span className="text-lime-400 text-sm font-semibold">B</span>
                    </div>
                    <h3 className="text-base font-semibold text-[#E5E5E5]">Buyer Details</h3>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-[#E5E5E5] flex items-center gap-1">
                        Buyer Name <span className="text-red-400">*</span>
                      </label>
                      <input
                        type="text"
                        value={txDetails.buyerName}
                        onChange={(e) => handleTxChange("buyerName", e.target.value)}
                        className="w-full bg-[#262626] px-4 py-2.5 rounded-md border border-[#404040] text-sm text-[#E5E5E5] transition-smooth focus:outline-none focus:ring-2 focus:ring-lime-400/30 focus:border-lime-400"
                        placeholder="Full legal name"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-[#E5E5E5]">
                        Father/Guardian Name
                      </label>
                      <input
                        type="text"
                        value={txDetails.buyerFatherName}
                        onChange={(e) => handleTxChange("buyerFatherName", e.target.value)}
                        className="w-full bg-[#262626] px-4 py-2.5 rounded-md border border-[#404040] text-sm text-[#E5E5E5] transition-smooth focus:outline-none focus:ring-2 focus:ring-lime-400/30 focus:border-lime-400"
                        placeholder="Father or guardian name"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-[#E5E5E5] flex items-center gap-1">
                      Buyer Address <span className="text-red-400">*</span>
                    </label>
                    <textarea
                      value={txDetails.buyerAddress}
                      onChange={(e) => handleTxChange("buyerAddress", e.target.value)}
                      rows={2}
                      className="w-full bg-[#262626] px-4 py-2.5 rounded-md border border-[#404040] text-sm text-[#E5E5E5] transition-smooth focus:outline-none focus:ring-2 focus:ring-lime-400/30 focus:border-lime-400 resize-none"
                      placeholder="Complete address with city, state, and pincode"
                    />
                  </div>
                </div>

                {/* SELLER DETAILS SECTION */}
                <div className="border border-[#404040] rounded-lg p-6 space-y-4">
                  <div className="flex items-center gap-2 pb-3 border-b border-[#404040]">
                    <div className="w-8 h-8 rounded-md bg-lime-400/10 flex items-center justify-center">
                      <span className="text-lime-400 text-sm font-semibold">S</span>
                    </div>
                    <h3 className="text-base font-semibold text-[#E5E5E5]">Seller Details</h3>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-[#E5E5E5] flex items-center gap-1">
                        Seller Name <span className="text-red-400">*</span>
                      </label>
                      <input
                        type="text"
                        value={txDetails.sellerName}
                        onChange={(e) => handleTxChange("sellerName", e.target.value)}
                        className="w-full bg-[#262626] px-4 py-2.5 rounded-md border border-[#404040] text-sm text-[#E5E5E5] transition-smooth focus:outline-none focus:ring-2 focus:ring-lime-400/30 focus:border-lime-400"
                        placeholder="Full legal name"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-[#E5E5E5]">
                        Father Name
                      </label>
                      <input
                        type="text"
                        value={txDetails.sellerFatherName}
                        onChange={(e) => handleTxChange("sellerFatherName", e.target.value)}
                        className="w-full bg-[#262626] px-4 py-2.5 rounded-md border border-[#404040] text-sm text-[#E5E5E5] transition-smooth focus:outline-none focus:ring-2 focus:ring-lime-400/30 focus:border-lime-400"
                        placeholder="Father name"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-[#E5E5E5] flex items-center gap-1">
                      Seller Address <span className="text-red-400">*</span>
                    </label>
                    <textarea
                      value={txDetails.sellerAddress}
                      onChange={(e) => handleTxChange("sellerAddress", e.target.value)}
                      rows={2}
                      className="w-full bg-[#262626] px-4 py-2.5 rounded-md border border-[#404040] text-sm text-[#E5E5E5] transition-smooth focus:outline-none focus:ring-2 focus:ring-lime-400/30 focus:border-lime-400 resize-none"
                      placeholder="Complete address with city, state, and pincode"
                    />
                  </div>
                </div>

                {/* TRANSACTION DETAILS SECTION */}
                <div className="border border-[#404040] rounded-lg p-6 space-y-4">
                  <div className="flex items-center gap-2 pb-3 border-b border-[#404040]">
                    <div className="w-8 h-8 rounded-md bg-lime-400/10 flex items-center justify-center">
                      <span className="text-lime-400 text-sm font-semibold">₹</span>
                    </div>
                    <h3 className="text-base font-semibold text-[#E5E5E5]">Transaction Details</h3>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-[#E5E5E5] flex items-center gap-1">
                        Date of Agreement <span className="text-red-400">*</span>
                      </label>
                      <input
                        type="date"
                        value={txDetails.agreementDate}
                        onChange={(e) => handleTxChange("agreementDate", e.target.value)}
                        className="w-full bg-[#262626] px-4 py-2.5 rounded-md border border-[#404040] text-sm text-[#E5E5E5] transition-smooth focus:outline-none focus:ring-2 focus:ring-lime-400/30 focus:border-lime-400"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-[#E5E5E5]">
                        Property Type
                      </label>
                      <select
                        value={txDetails.propertyType}
                        onChange={(e) => handleTxChange("propertyType", e.target.value)}
                        className="w-full bg-[#262626] px-4 py-2.5 rounded-md border border-[#404040] text-sm text-[#E5E5E5] transition-smooth cursor-pointer focus:outline-none focus:ring-2 focus:ring-lime-400/30 focus:border-lime-400"
                      >
                        {PROPERTY_TYPES.map((pt) => (
                          <option key={pt} value={pt}>
                            {pt}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-[#E5E5E5] flex items-center gap-1">
                        Total Amount (₹) <span className="text-red-400">*</span>
                      </label>
                      <input
                        type="number"
                        value={txDetails.totalAmount}
                        onChange={(e) => handleTxChange("totalAmount", e.target.value)}
                        className="w-full bg-[#262626] px-4 py-2.5 rounded-md border border-[#404040] text-sm text-[#E5E5E5] transition-smooth focus:outline-none focus:ring-2 focus:ring-lime-400/30 focus:border-lime-400"
                        placeholder="0"
                        min="0"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-[#E5E5E5]">
                        Advance Payment (₹)
                      </label>
                      <input
                        type="number"
                        value={txDetails.advanceAmount}
                        onChange={(e) => handleTxChange("advanceAmount", e.target.value)}
                        className="w-full bg-[#262626] px-4 py-2.5 rounded-md border border-[#404040] text-sm text-[#E5E5E5] transition-smooth focus:outline-none focus:ring-2 focus:ring-lime-400/30 focus:border-lime-400"
                        placeholder="0"
                        min="0"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-[#A3A3A3]">
                        Balance Payment (₹)
                      </label>
                      <input
                        type="number"
                        value={txDetails.balanceAmount}
                        readOnly
                        className="w-full bg-[#1A1A1A] px-4 py-2.5 rounded-md border border-[#404040] text-sm text-lime-400 font-medium cursor-not-allowed"
                        placeholder="Auto-calculated"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-[#E5E5E5]">
                      Transaction No. / Check / DD No.
                    </label>
                    <input
                      type="text"
                      value={txDetails.transactionNumber}
                      onChange={(e) => handleTxChange("transactionNumber", e.target.value)}
                      className="w-full bg-[#262626] px-4 py-2.5 rounded-md border border-[#404040] text-sm text-[#E5E5E5] transition-smooth focus:outline-none focus:ring-2 focus:ring-lime-400/30 focus:border-lime-400"
                      placeholder="Payment reference number"
                    />
                  </div>
                </div>

                {/* Validation error */}
                {formError && (
                  <div className="flex items-center gap-2 p-3 bg-red-900/20 border border-red-500/30 rounded-md">
                    <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                    <p className="text-sm text-red-400">{formError}</p>
                  </div>
                )}

                <button
                  onClick={handleProceedToGenerate}
                  className="w-full py-3 bg-lime-400 text-[#121212] rounded-md font-medium hover:bg-lime-500 transition-colors"
                >
                  Continue to Configuration
                </button>
              </div>
            </div>
          )}

          {/* STEP 4 — Configuration Preview */}
          {step === 4 && (
            <div className="space-y-6">
              <div className="text-center space-y-2">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-[#262626] mb-2">
                  <span className="text-xs font-medium text-[#A3A3A3]">Step 4 of 5</span>
                </div>
                <h2 className="text-2xl font-semibold text-[#E5E5E5]">Review Configuration</h2>
                <p className="text-sm text-[#A3A3A3] max-w-md mx-auto">
                  Review your agreement configuration before generating the final document.
                </p>
              </div>

              <div className="max-w-2xl mx-auto space-y-6">
                {/* Configuration Summary */}
                <div className="border border-[#404040] rounded-lg p-6 space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-[#404040]">
                    <h3 className="text-sm font-semibold text-[#E5E5E5]">Agreement Type</h3>
                    <span className="px-3 py-1 bg-lime-400/10 text-lime-400 text-xs font-medium rounded-md border border-lime-400/30">
                      {txDetails.propertyType}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-[#A3A3A3] text-xs mb-1">Buyer</p>
                      <p className="font-medium text-[#E5E5E5]">{txDetails.buyerName || "—"}</p>
                    </div>
                    <div>
                      <p className="text-[#A3A3A3] text-xs mb-1">Seller</p>
                      <p className="font-medium text-[#E5E5E5]">{txDetails.sellerName || "—"}</p>
                    </div>
                    <div>
                      <p className="text-[#A3A3A3] text-xs mb-1">Total Amount</p>
                      <p className="font-medium text-lime-400">₹{Number(txDetails.totalAmount || 0).toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-[#A3A3A3] text-xs mb-1">Agreement Date</p>
                      <p className="font-medium text-[#E5E5E5]">{txDetails.agreementDate || "—"}</p>
                    </div>
                  </div>
                </div>

                {/* Template Info */}
                <div className="bg-[#262626] border border-[#404040] rounded-lg p-6">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-md bg-lime-400/10 flex items-center justify-center shrink-0">
                      <FileCheck className="w-5 h-5 text-lime-400" />
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-[#E5E5E5] mb-1">Template & Sale Deed Ready</h4>
                      <p className="text-xs text-[#A3A3A3] leading-relaxed">
                        Your agreement will be generated using the uploaded template with data extracted from the sale deed and your inputs.
                      </p>
                    </div>
                  </div>
                </div>

                {extractionStatus === "processing" && (
                  <div className="flex items-center justify-center gap-2 p-4 bg-[#262626] border border-[#404040] rounded-md">
                    <Loader2 className="w-5 h-5 animate-spin text-lime-400" />
                    <p className="text-sm font-medium text-[#E5E5E5]">{loadingText}</p>
                  </div>
                )}

                <div className="flex gap-3">
                  <button
                    onClick={() => setStep(3)}
                    disabled={extractionStatus === "processing"}
                    className="flex-1 py-3 bg-[#262626] border border-[#404040] text-[#E5E5E5] rounded-md font-medium hover:bg-[#333333] transition-colors disabled:opacity-50"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleProceedToFinalStep}
                    disabled={extractionStatus === "processing"}
                    className="flex-1 py-3 bg-lime-400 text-[#121212] rounded-md font-medium hover:bg-lime-500 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {extractionStatus === "processing" ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        Generate Document
                        <FileOutput className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* STEP 5 — Generate Agreement */}
          {step === 5 && (
            <div className="space-y-6 fade-in">
              <div className="text-center space-y-2">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-lime-400/10 border border-lime-400/30 mb-2">
                  <Check className="w-3 h-3 text-lime-400" />
                  <span className="text-xs font-medium text-lime-400">Step 5 of 5 — Final Step</span>
                </div>
                <h2 className="text-2xl font-semibold text-[#E5E5E5]">Generate Agreement</h2>
                <p className="text-sm text-[#A3A3A3] max-w-md mx-auto">
                  Review the extracted data and download your completed agreement document.
                </p>
              </div>

              <AgreementForm
                transactionDetails={txDetails}
                extractedData={extractedData}
                templateSchema={templateSchema}
                tailwindTemplate={tailwindTemplate}
                missingFields={missingFields}
                manualFields={manualFields}
                onMissingFieldChange={(field, value) =>
                  setManualFields((prev) => ({ ...prev, [field]: value }))
                }
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="text-center pt-8 text-xs text-[#737373]">
          Powered by AI · Legal Document Processing
        </footer>
      </div>
    </main>
  );
}
