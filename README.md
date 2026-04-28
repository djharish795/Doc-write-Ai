# ValuationStudio — AI-Powered Valuation Report Generator

> **Intelligence Layer 4.6** — Empowered by Claude Sonnet AI & High-Fidelity Rendering

ValuationStudio is a Next.js AI application that automates the generation of professional property valuation reports. It digitally reconstructs any uploaded report template, extracts legal data from Telugu Sale Deeds using Claude, and produces a fully formatted, bank-ready output — in minutes.

---

## ✨ Features

- **Template Digital Twin** — Upload any previous bank-authorized PDF report; AI reconstructs its exact layout as a Tailwind-based HTML template
- **Telugu Sale Deed Extraction** — Automatically parses scanned/PDFs deeds (including handwritten Telugu) to extract party names, property dimensions, survey numbers, and financials
- **Automated Financial Mathematics** — Enters market rate & government rate once; all area calculations, values, and deductions are computed automatically
- **AI Intelligence Review** — Editable form pre-filled by AI before the final report is generated
- **One-click Report Export** — Generates a pixel-perfect HTML report matching the original template's style

---

## 🗂 Project Structure

```
valuation-report-gen/
├── src/
│   ├── app/
│   │   ├── page.tsx                    # Main 4-step workflow UI
│   │   ├── layout.tsx                  # Root layout & global fonts
│   │   ├── globals.css                 # Global styles & design tokens
│   │   └── api/
│   │       ├── analyze-template/       # POST: Analyze report template image → Tailwind HTML + data schema
│   │       ├── extract-data/           # POST: Extract data from Telugu deed PDF → JSON
│   │       └── generate-report/        # POST: Merge data + template → Final HTML report
│   ├── components/
│   │   ├── ValuationForm.tsx           # Editable data review form (Step 4)
│   │   └── FileUploader.tsx            # Drag-and-drop file upload component
│   └── lib/
│       ├── utils.ts                    # Tailwind class merging utilities
│       └── cache-utils.ts              # Server-side caching helpers
├── public/
│   └── favicon.ico
├── .env.local                          # Environment variables (API keys)
├── .env.example                        # Template for environment setup
├── package.json
├── tailwind.config.ts
└── tsconfig.json
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** v18+
- **npm** v9+
- An **Anthropic API key** (get one at [console.anthropic.com](https://console.anthropic.com))

### 1. Clone the Repository

```bash
git clone https://github.com/LokeshSaiSri/valuation_report_ai.git
cd valuation_report_ai
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Copy the example env file and add your API key:

```bash
cp .env.example .env.local
```

Then edit `.env.local`:

```env
ANTHROPIC_API_KEY=your_anthropic_api_key_here
CLAUDE_MODEL=claude-sonnet-4-6
```

### 4. Run the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## ⚙️ Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | ✅ Yes | Your Anthropic API key from [console.anthropic.com](https://console.anthropic.com) |
| `CLAUDE_MODEL` | Optional | Claude model to use. Defaults to `claude-sonnet-4-6` |

---

## 🔄 Workflow — How It Works

```
Step 1: Template Upload
  └─ Upload a reference valuation report (PDF/image)
  └─ AI analyzes layout, branding, and structure
  └─ Generates a Tailwind HTML digital twin + data schema

Step 2: Sale Deed Acquisition
  └─ Upload the Telugu Sale Deed (scanned PDF or image)
  └─ Stored for AI-powered extraction

Step 3: Base Rate Input
  └─ Enter current Market Rate (₹ per sq yard/ft)
  └─ Enter Government Rate
  └─ AI extracts all other data and computes financials automatically

Step 4: Intelligence Review & Export
  └─ Review and edit AI-extracted data in an editable form
  └─ Generate the final pixel-perfect valuation report
```

---

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | [Next.js 14](https://nextjs.org) (App Router) |
| **Language** | TypeScript |
| **Styling** | Tailwind CSS v3 |
| **AI Engine** | [Anthropic Claude](https://anthropic.com) via `@anthropic-ai/sdk` |
| **Forms** | React Hook Form |
| **Icons** | Lucide React |
| **UI Utilities** | clsx, tailwind-merge |

---

## 📡 API Routes

### `POST /api/analyze-template`
Analyzes an uploaded report template image and returns a Tailwind HTML layout + JSON data schema.

**Body:**
```json
{ "imageUrl": "<base64 data URL of the template image>" }
```

**Response:**
```json
{
  "tailwindTemplate": "<html string with Tailwind classes>",
  "dataSchema": [{ "key": "field_name", "label": "Field Label", "type": "text" }]
}
```

---

### `POST /api/extract-data`
Extracts property and financial data from a Telugu sale deed PDF.

**Body:**
```json
{
  "pdfUrl": "<base64 data URL of the deed PDF>",
  "schema": [...],
  "baseRates": { "marketRate": "5000", "governmentRate": "3200" }
}
```

**Response:** JSON object matching the data schema fields.

---

### `POST /api/generate-report`
Merges extracted data into the Tailwind template and returns a final HTML report.

**Body:**
```json
{
  "template": "<tailwind html string>",
  "data": { "field_name": "value", ... }
}
```

**Response:** `text/html` — the final rendered report.

---

## 🏗 Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start development server at `localhost:3000` |
| `npm run build` | Build production bundle |
| `npm run start` | Run production server |
| `npm run lint` | Run ESLint |

---

## 📝 License

Private project — All rights reserved © 2026 Naprocs.

---

## 👤 Author

**Lokesh Sai Sri Ganapaneni**  
Built for: Naprocs Client Projects
