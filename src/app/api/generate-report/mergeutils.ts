/**
 * merge-utils.ts
 *
 * Merges sale deed extracted data + user inputs into the final
 * data payload for agreement generation.
 *
 * Priority rules:
 * - User inputs ALWAYS override extracted data for buyer details and transaction amounts
 * - Extracted deed data is authoritative for property, seller/builder identity, boundaries
 * - Supports single buyer OR multiple joint buyers (co-buyers)
 * - Currency formatted as రూ.41,86,000/– (Indian legal document style)
 */
 
// ─── Types ────────────────────────────────────────────────────────────────────
 
export interface BuyerData {
  fullName: string;
  fatherOrHusbandName: string;
  age: string;
  address: string;
  pan?: string;
  aadhaar?: string;
}
 
export interface MergedAgreementData {
  // ── Primary buyer ──
  buyerFullName: string;
  buyerFatherName: string;
  buyerAge: string;
  buyerAddress: string;
  buyerPan?: string;
  buyerAadhaar?: string;
 
  // ── Joint/co-buyers (this doc has 2 buyers: జయశ్రీ + సంతోష్ కుమార్) ──
  hasMultipleBuyers: boolean;
  coBuyers: BuyerData[];
  allBuyersText: string; // "(1) జయశ్రీ... మరియు (2) సంతోష్..." for prose insertion
 
  // ── Seller — individual owner ──
  sellerFullName: string;
  sellerFatherName: string;
  sellerAge: string;
  sellerAddress: string;
  sellerPan?: string;
  sellerAadhaar?: string;
 
  // ── Seller — builder / company (apartment_flat_sale) ──
  isBuilderSale: boolean;
  builderCompanyName: string;          // "GOLDEN KEY CONSTRUCTIONS"
  builderProprietorName: string;       // "జల్లేపల్లి గణేష్"
  builderProprietorFatherName: string;
  builderProprietorAge: string;
  builderAddress: string;
  builderPan?: string;
 
  // ── PoA holder ──
  poaHolderName?: string;
  poaRegistrationNumber?: string;
  poaRegistrationDate?: string;
 
  // ── Property — common ──
  surveyNumber: string;
  subDivisionNumber: string;
  plotNumber: string;
  doorNumber: string;
  village: string;
  mandal: string;
  district: string;
  state: string;
  pincode: string;
  fullAddress: string;
  totalArea: string;
  extentBeingSold: string;
  undividedShareArea: string;       // "చ.అ.1610" / "చ.గ.60-60"
  boundaryNorth: string;
  boundarySouth: string;
  boundaryEast: string;
  boundaryWest: string;
  scheduleText: string;
  pattaNumber: string;
  localBodyName: string;
  revenueVillage: string;
 
  // ── Property — apartment/flat ──
  projectName: string;              // "గోల్డెన్ వాల్యూస్"
  flatNumber: string;               // "305"
  floorNumber: string;              // "సెకండ్ ఫ్లోర్"
  towerOrBlock: string;
  carpetArea: string;
  superBuiltupArea: string;
  carParkingNumber: string;
  reraNumber: string;
  developmentAgreementNumber: string; // "8515/2024"
  allotmentSurveyNumber: string;    // "చ.గ.2032-00"
  municipalCorporationName: string;
 
  // ── Transaction — formatted as Indian legal style రూ.X,XX,XXX/– ──
  totalSaleAmountNumeric: number;
  totalSaleAmount: string;          // రూ.41,86,000/–
  totalSaleAmountInWords: string;   // నలభై ఒక్క లక్షల ఎనభై ఆరు వేల రూపాయలు
  advanceAmount: string;            // రూ.8,00,000/–
  advanceAmountInWords: string;
  advancePaidDate: string;          // 19-05-2025
  balanceAmount: string;            // రూ.33,86,000/–
  balanceAmountInWords: string;
  balancePaymentDeadline: string;
  agreementDate: string;            // full formatted date
  agreementDay: string;             // "19"
  agreementMonth: string;           // "మే" (Telugu month)
  agreementYear: string;            // "2025"
  paymentMode: string;
  rtgsTransferAmount?: string;      // రూ.8,00,000/– (RTGS portion)
 
  // ── Previous deed / registration references ──
  previousDeedNumber1: string;     // "3653/2024"
  previousDeedNumber2: string;     // "3654/2024"
  previousDeedDate: string;
  registrationOffice: string;
  bookNumber: string;
 
  // ── Government land ──
  governmentOrderNumber: string;
  auctionLotNumber: string;
  allottedDate: string;
 
  // ── Plot ──
  layoutApprovalNumber: string;
  plotFacing: string;
 
  // ── Commercial ──
  shopOrOfficeNumber: string;
  businessUsage: string;
 
  [key: string]: any;
}
 
// ─── Main merge function ───────────────────────────────────────────────────────
 
export function mergeDataSources(
  extractedData: any,
  userInputs: Record<string, any>
): MergedAgreementData {
  const p    = extractedData?.parties      || {};
  const prop = extractedData?.property     || {};
  const tx   = extractedData?.transaction  || {};
  const reg  = extractedData?.registration || {};
  const apt  = extractedData?.apartment    || {};
  const gov  = extractedData?.government   || {};
 
  const isBuilderSale = !!(
    apt.projectName || p.builder?.companyName || userInputs.builderCompanyName
  );
 
  const coBuyers     = buildCoBuyers(p, userInputs);
  const primaryBuyer = coBuyers[0] || buildSingleBuyer(p, userInputs);
  const allBuyersText = formatAllBuyersText(coBuyers.length > 0 ? coBuyers : [primaryBuyer]);
 
  const totalNumeric   = parseAmount(userInputs.totalSaleAmount   || tx.saleConsiderationTotal);
  const advanceNumeric = parseAmount(userInputs.advanceAmountPaid || tx.advanceAmountPaid);
  const balanceNumeric = userInputs.balanceAmount
    ? parseAmount(userInputs.balanceAmount)
    : totalNumeric > 0
      ? totalNumeric - advanceNumeric
      : parseAmount(tx.balanceAmount);
 
  const dateParts = parseAgreementDate(userInputs.agreementDate || tx.executionDate);
 
  const merged: MergedAgreementData = {
    // ── Primary buyer ──
    buyerFullName:   userInputs.newBuyerFullName   || primaryBuyer.fullName            || "",
    buyerFatherName: userInputs.newBuyerFatherName || primaryBuyer.fatherOrHusbandName || "",
    buyerAge:        userInputs.newBuyerAge        || primaryBuyer.age                 || "",
    buyerAddress:    userInputs.newBuyerAddress    || primaryBuyer.address             || "",
    buyerPan:        userInputs.newBuyerPan        || primaryBuyer.pan                 || "",
    buyerAadhaar:    userInputs.newBuyerAadhaar    || primaryBuyer.aadhaar             || "",
 
    // ── Co/joint buyers ──
    hasMultipleBuyers: coBuyers.length > 1,
    coBuyers,
    allBuyersText,
 
    // ── Seller individual ──
    sellerFullName:   p.seller?.fullName            || "",
    sellerFatherName: p.seller?.fatherOrHusbandName || "",
    sellerAge:        p.seller?.age                 || "",
    sellerAddress:    p.seller?.address             || "",
    sellerPan:        p.seller?.pan                 || "",
    sellerAadhaar:    p.seller?.aadhaar             || "",
 
    // ── Builder / company seller ──
    isBuilderSale,
    builderCompanyName:          userInputs.builderCompanyName          || p.builder?.companyName          || apt.builderName || "",
    builderProprietorName:       userInputs.builderProprietorName       || p.builder?.proprietorName       || "",
    builderProprietorFatherName: userInputs.builderProprietorFatherName || p.builder?.proprietorFatherName || "",
    builderProprietorAge:        userInputs.builderProprietorAge        || p.builder?.proprietorAge        || "",
    builderAddress:              userInputs.builderAddress              || p.builder?.address              || "",
    builderPan:                  userInputs.builderPan                  || p.builder?.pan                  || "",
 
    // ── PoA ──
    poaHolderName:         userInputs.poaHolderName         || p.powerOfAttorneyHolder?.name               || "",
    poaRegistrationNumber: userInputs.poaRegistrationNumber || p.powerOfAttorneyHolder?.registrationNumber || "",
    poaRegistrationDate:   userInputs.poaRegistrationDate   || p.powerOfAttorneyHolder?.registrationDate   || "",
 
    // ── Property common ──
    surveyNumber:      prop.surveyNumber      || "",
    subDivisionNumber: prop.subDivisionNumber || "",
    plotNumber:        prop.plotNumber        || "",
    doorNumber:        prop.doorNumber        || "",
    village:           prop.village           || "",
    mandal:            prop.mandal            || "",
    district:          prop.district          || "",
    state:             prop.state             || "Andhra Pradesh",
    pincode:           prop.pincode           || "",
    fullAddress:       prop.fullAddress       || "",
    totalArea:         buildAreaString(prop),
    extentBeingSold:   prop.extentBeingSold   || "",
    undividedShareArea: apt.undividedShare    || prop.undividedShareArea || "",
    boundaryNorth:     prop.boundaries?.north || "",
    boundarySouth:     prop.boundaries?.south || "",
    boundaryEast:      prop.boundaries?.east  || "",
    boundaryWest:      prop.boundaries?.west  || "",
    scheduleText:      prop.schedule          || extractedData?.rawScheduleText || "",
    pattaNumber:       prop.pattaNumber       || "",
    localBodyName:     prop.localBodyName     || "",
    revenueVillage:    prop.revenueVillage    || "",
 
    // ── Apartment/flat ──
    projectName:                userInputs.projectName                || apt.projectName                || "",
    flatNumber:                 userInputs.flatNumber                 || apt.flatNumber                 || "",
    floorNumber:                userInputs.floorNumber                || apt.floorNumber                || "",
    towerOrBlock:               userInputs.towerOrBlock               || apt.towerOrBlock               || "",
    carpetArea:                 apt.carpetArea                        || "",
    superBuiltupArea:           apt.superBuiltupArea                  || "",
    carParkingNumber:           userInputs.carParkingNumber           || apt.carParkingNumber           || "",
    reraNumber:                 userInputs.reraNumber                 || apt.reraNumber                 || "",
    developmentAgreementNumber: userInputs.developmentAgreementNumber || apt.developmentAgreementNumber || "",
    allotmentSurveyNumber:      prop.allotmentSurveyNumber            || apt.allotmentSurveyNumber      || "",
    municipalCorporationName:   prop.localBodyName                    || "",
 
    // ── Transaction ──
    totalSaleAmountNumeric: totalNumeric,
    totalSaleAmount:        formatIndianCurrency(totalNumeric),
    totalSaleAmountInWords: userInputs.totalSaleAmountInWords  || tx.saleConsiderationInWords || "",
    advanceAmount:          formatIndianCurrency(advanceNumeric),
    advanceAmountInWords:   userInputs.advanceAmountInWords    || tx.advanceAmountInWords     || "",
    advancePaidDate:        formatIndianDate(userInputs.advancePaidDate || tx.advancePaidOn),
    balanceAmount:          formatIndianCurrency(balanceNumeric),
    balanceAmountInWords:   userInputs.balanceAmountInWords    || tx.balanceAmountInWords     || "",
    balancePaymentDeadline: formatIndianDate(userInputs.balancePaymentDeadline || tx.balancePaymentDeadline),
    agreementDate:          dateParts.formatted,
    agreementDay:           dateParts.day,
    agreementMonth:         dateParts.month,
    agreementYear:          dateParts.year,
    paymentMode:            userInputs.paymentMode || tx.paymentMode || "",
    rtgsTransferAmount:     userInputs.rtgsTransferAmount
                              ? formatIndianCurrency(parseAmount(userInputs.rtgsTransferAmount))
                              : tx.rtgsTransferAmount || "",
 
    // ── Deed references ──
    previousDeedNumber1: reg.previousDeedNumber  || reg.deedNumber1 || "",
    previousDeedNumber2: reg.previousDeedNumber2 || reg.deedNumber2 || "",
    previousDeedDate:    formatIndianDate(reg.previousDeedDate),
    registrationOffice:  reg.registrationOffice  || "",
    bookNumber:          reg.bookNumber           || "",
 
    // ── Government ──
    governmentOrderNumber: userInputs.governmentOrderNumber || gov.governmentOrderNumber || "",
    auctionLotNumber:      userInputs.auctionLotNumber      || gov.lotNumber             || "",
    allottedDate:          formatIndianDate(gov.allottedDate),
 
    // ── Plot ──
    layoutApprovalNumber: userInputs.layoutApprovalNumber || "",
    plotFacing:           userInputs.plotFacing           || "",
 
    // ── Commercial ──
    shopOrOfficeNumber: userInputs.shopOrOfficeNumber || "",
    businessUsage:      userInputs.businessUsage      || "",
  };
 
  // Pass through any extra user inputs not already mapped
  for (const key of Object.keys(userInputs)) {
    if (!(key in merged) || merged[key] === "" || merged[key] === null) {
      merged[key] = userInputs[key];
    }
  }
 
  return merged;
}
 
// ─── Buyer helpers ────────────────────────────────────────────────────────────
 
function buildCoBuyers(parties: any, userInputs: Record<string, any>): BuyerData[] {
  const buyers: BuyerData[] = [];
 
  // Primary buyer
  const primaryName = userInputs.newBuyerFullName || parties.buyer?.fullName;
  if (primaryName) {
    buyers.push({
      fullName:            primaryName,
      fatherOrHusbandName: userInputs.newBuyerFatherName || parties.buyer?.fatherOrHusbandName || "",
      age:                 userInputs.newBuyerAge        || parties.buyer?.age                 || "",
      address:             userInputs.newBuyerAddress    || parties.buyer?.address             || "",
      pan:                 userInputs.newBuyerPan        || parties.buyer?.pan                 || "",
      aadhaar:             userInputs.newBuyerAadhaar    || parties.buyer?.aadhaar             || "",
    });
  }
 
  // Co-buyers from user inputs: newCoBuyer1FullName, newCoBuyer2FullName ...
  for (let i = 1; i <= 5; i++) {
    const name = userInputs[`newCoBuyer${i}FullName`];
    if (name) {
      buyers.push({
        fullName:            name,
        fatherOrHusbandName: userInputs[`newCoBuyer${i}FatherName`] || "",
        age:                 userInputs[`newCoBuyer${i}Age`]         || "",
        address:             userInputs[`newCoBuyer${i}Address`]     || userInputs.newBuyerAddress || "",
        pan:                 userInputs[`newCoBuyer${i}Pan`]         || "",
        aadhaar:             userInputs[`newCoBuyer${i}Aadhaar`]     || "",
      });
    }
  }
 
  // Co-buyers from extracted deed data (if user didn't supply them)
  if (Array.isArray(parties.coBuyers) && buyers.length <= 1) {
    for (const cb of parties.coBuyers) {
      if (cb?.fullName && !buyers.find(b => b.fullName === cb.fullName)) {
        buyers.push({
          fullName:            cb.fullName,
          fatherOrHusbandName: cb.fatherOrHusbandName || "",
          age:                 cb.age                 || "",
          address:             cb.address             || "",
          pan:                 cb.pan                 || "",
          aadhaar:             cb.aadhaar             || "",
        });
      }
    }
  }
 
  return buyers;
}
 
function buildSingleBuyer(parties: any, userInputs: Record<string, any>): BuyerData {
  return {
    fullName:            userInputs.newBuyerFullName   || parties.buyer?.fullName            || "",
    fatherOrHusbandName: userInputs.newBuyerFatherName || parties.buyer?.fatherOrHusbandName || "",
    age:                 userInputs.newBuyerAge        || parties.buyer?.age                 || "",
    address:             userInputs.newBuyerAddress    || parties.buyer?.address             || "",
    pan:                 userInputs.newBuyerPan        || parties.buyer?.pan                 || "",
    aadhaar:             userInputs.newBuyerAadhaar    || parties.buyer?.aadhaar             || "",
  };
}
 
/**
 * Formats buyers list into legal prose string.
 * Single: "రవి కుమార్ 35 సం.లు వయస్సు గల"
 * Multiple: "(1) జయశ్రీ 60 సం.లు... మరియు (2) సంతోష్ కుమార్ 40 సం.లు..."
 */
function formatAllBuyersText(buyers: BuyerData[]): string {
  if (buyers.length === 0) return "";
  if (buyers.length === 1) {
    const b = buyers[0];
    return `${b.fullName}${b.age ? " " + b.age + " సం.లు వయస్సు గల" : ""}`;
  }
  return buyers
    .map((b, i) => `(${i + 1}) ${b.fullName}${b.age ? " " + b.age + " సం.లు వయస్సు గల" : ""}`)
    .join(" మరియు ");
}
 
// ─── Formatting helpers ───────────────────────────────────────────────────────
 
function buildAreaString(prop: any): string {
  if (prop.totalAreaSqFeet)   return `${prop.totalAreaSqFeet} చ.అ.`;
  if (prop.totalAreaSqYards)  return `${prop.totalAreaSqYards} చ.గ.`;
  if (prop.totalAreaAcres)    return `${prop.totalAreaAcres} ఎకరాలు`;
  if (prop.totalAreaCents)    return `${prop.totalAreaCents} సెంట్లు`;
  if (prop.totalAreaSqMeters) return `${prop.totalAreaSqMeters} చ.మీ.`;
  return "";
}
 
/**
 * Indian legal currency format: రూ.41,86,000/–
 * Indian number system: 12,34,567 (not 1,234,567)
 */
export function formatIndianCurrency(value: number | null | undefined): string {
  if (!value || isNaN(value)) return "";
  const formatted = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(value);
  return `రూ.${formatted}/–`;
}
 
export function parseAmount(value: any): number {
  if (!value) return 0;
  const num = parseFloat(String(value).replace(/[^0-9.]/g, ""));
  return isNaN(num) ? 0 : num;
}
 
/**
 * Indian date format: 19-05-2025
 */
export function formatIndianDate(value: any): string {
  if (!value) return "";
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    return `${dd}-${mm}-${d.getFullYear()}`;
  } catch {
    return String(value);
  }
}
 
function parseAgreementDate(value: any): {
  formatted: string; day: string; month: string; year: string;
} {
  const empty = { formatted: "", day: "", month: "", year: "" };
  if (!value) return empty;
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return { ...empty, formatted: String(value) };
    const teluguMonths = [
      "జనవరి","ఫిబ్రవరి","మార్చి","ఏప్రిల్","మే","జూన్",
      "జులై","ఆగస్టు","సెప్టెంబర్","అక్టోబర్","నవంబర్","డిసెంబర్"
    ];
    return {
      formatted: `${String(d.getDate()).padStart(2,"0")}-${String(d.getMonth()+1).padStart(2,"0")}-${d.getFullYear()}`,
      day:   String(d.getDate()),
      month: teluguMonths[d.getMonth()],
      year:  String(d.getFullYear()),
    };
  } catch {
    return { ...empty, formatted: String(value) };
  }
}
 