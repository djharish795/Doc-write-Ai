# AgreementStudio (Doc-write-Ai) — AI-Powered Legal Document Generator

> **Intelligence Layer 4.6** — Powered by Anthropic Claude & Playwright High-Fidelity PDF Rendering

AgreementStudio is an advanced Next.js AI-powered application that automates the generation of professional, bank-ready legal agreements. It digitally maps custom document templates, extracts crucial legal details from Telugu Sale Deeds using Claude, and produces a highly polished, print-ready PDF in seconds.

---

## ✨ Features

- **Telugu Sale Deed Extraction** — Automatically parses scanned PDFs or images of deeds (including handwritten/printed Telugu) using Claude to extract party details (Buyer & Seller), parent names, addresses, survey numbers, boundaries, and transaction history.
- **Template Digital Twin** — Upload any PDF or DOCX agreement template. The system analyzes its structure, layout, and required variables to prepare it for high-fidelity generation.
- **Intelligent Financial Calculations** — Enter the total transaction and advance amounts; the system instantly auto-calculates balance payments and displays them dynamically in the UI.
- **Interactive Review & Configuration** — An editable, step-by-step review wizard pre-filled by AI allows manual overrides and adjustments before final generation.
- **Premium Print-Ready PDF Generation** — Compiles the final document with professional, legal-grade serif typography (`Lora`, `Georgia`), strict margins (1.25"), justified alignments, and page-break optimization using Mammooth and Playwright.

---

## 🗂 Project Structure

```
Doc-write-Ai/
├── src/
│   ├── app/
│   │   ├── page.tsx                    # Main 5-step interactive workflow UI
│   │   ├── layout.tsx                  # Root layout & global fonts
│   │   ├── globals.css                 # Global CSS styles & dark design tokens
│   │   └── api/
│   │       ├── analyze-template/       # POST: Analyze layout & identify required variables
│   │       ├── extract-data/           # POST: AI extraction from Telugu Sale Deed via Claude
│   │       └── generate-report/        # POST: Merge data & convert DOCX → Styled PDF via Playwright
│   ├── components/
│   │   ├── AgreementForm.tsx           # Edit details, configure variables & download PDF (Step 5)
│   │   └── FileUploader.tsx            # Premium drag-and-drop file uploader
│   └── lib/
│       ├── utils.ts                    # Classnames utility helper
│       ├── cache-utils.ts              # Server-side caching helpers
│       └── aiService.ts                # Anthropic Claude API connection & credential checks
├── public/
│   └── favicon.ico
├── .env.example                        # Template for environment configuration
├── package.json                        # Project dependencies (Playwright, Mammoth, Anthropic SDK)
├── tailwind.config.ts                  # Tailwind configuration
└── tsconfig.json                       # TypeScript compiler configuration
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** v18+
- **npm** v9+
- An **Anthropic API key** (get one at [console.anthropic.com](https://console.anthropic.com))

### 1. Clone the Repository

```bash
git clone https://github.com/djharish795/Doc-write-Ai.git
cd Doc-write-Ai
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Create a `.env` file at the root of the project:

```env
# Anthropic Claude API Key
ANTHROPIC_API_KEY=your_actual_anthropic_api_key_here

# Claude Model
CLAUDE_MODEL=claude-3-5-sonnet-20241022
```

> [!NOTE]
> `.env` is listed in `.gitignore` and will never be committed to GitHub. Keep `.env.example` as a safe placeholder file without any actual secrets.

### 4. Run the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## ⚙️ Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | ✅ Yes | Your Anthropic API key starting with `sk-ant-` |
| `CLAUDE_MODEL` | Optional | Claude model to use. Defaults to `claude-3-5-sonnet-20241022` |

---

## 🔄 Workflow — Step-by-Step

```
Step 1: Upload Sale Deed
  └─ Upload the Telugu Sale Deed (PDF/Image)
  └─ AI processes and extracts buyer/seller details and financials instantly

Step 2: Upload Agreement Template
  └─ Drag-and-drop your custom DOCX or PDF template
  └─ AI analyzes and maps the template fields

Step 3: Agreement Details
  └─ Verify or override extracted party names, addresses, and parent names
  └─ Input total transaction amount and advance payments (balance is calculated automatically)

Step 4: Review Configuration
  └─ Check a final visual summary of the transaction structure before compilation

Step 5: Generate & Export
  └─ Adjust final custom form values pre-filled from your template analysis
  └─ Generate and download a premium, print-ready, high-fidelity PDF
```

---

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | [Next.js 14](https://nextjs.org) (App Router) |
| **Language** | TypeScript |
| **Styling** | Tailwind CSS v3 |
| **AI Engine** | [Anthropic Claude](https://anthropic.com) via `@anthropic-ai/sdk` |
| **PDF Generation** | [Playwright](https://playwright.dev) & [Mammoth](https://github.com/mwilliamson/mammoth.js) |
| **Icons** | Lucide React |

---

## 📡 API Routes

### `POST /api/analyze-template`
Analyzes an uploaded report template and returns required variables.

---

### `POST /api/extract-data`
Extracts structured property and buyer/seller data from a Telugu sale deed.

---

### `POST /api/generate-report`
Merges the extracted and verified fields into the template, applies premium CSS print styles, and converts it into a high-fidelity PDF buffer.

---

## 🏗 Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start development server at `localhost:3000` |
| `npm run build` | Build production bundle |
| `npm run start` | Run production server |
| `npm run lint` | Run ESLint check |

---

## 📝 License

Private project — All rights reserved © 2026 Naprocs.
