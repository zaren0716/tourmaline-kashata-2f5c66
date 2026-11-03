# SZLYANA — Netlify-ready study platform

A Netlify-hosted study website with local-first storage and an optional serverless AI study-package generator. Document text is extracted in the browser, then sent to a Netlify Function for source-grounded reviewer, quiz, and flashcard generation.

## Deploy with Netlify (AI function enabled)

For the full application, deploy through the Netlify CLI or connect the folder to a Git repository. A simple drag-and-drop static deploy does not reliably bundle serverless functions.

### Netlify CLI deployment

1. Install Node.js LTS on your computer.
2. Open a terminal in the extracted `szlyana-netlify-edit` project folder.
3. Install the Netlify CLI: `npm install -g netlify-cli`.
4. Sign in: `netlify login`.
5. Link or create a site: `netlify init`.
6. Add `OPENAI_API_KEY` in Netlify **Site configuration → Environment variables**. Optionally add `OPENAI_MODEL` (defaults to `gpt-4o-mini`).
7. Deploy: `netlify deploy --prod`.
8. Open the deployed site and test an upload plus study-package generation.

You can also connect the project folder to a Git repository in Netlify; the `netlify.toml` file configures the publish directory and functions directory. A manual drag-and-drop deploy can host the static UI, but the AI generator will show a configuration/deployment error until the Netlify Function is deployed.

## Update the website

Make edits to the files locally. Then drag the updated project folder into the site's Deploys page, or connect a Git repository for automatic deployments.

## Included functionality

- Responsive dashboard and purple/pink theme with light/dark appearance
- IndexedDB local storage for materials, flashcards, quizzes, reviewers, subjects, and planner sessions
- Upload and local text extraction for TXT, CSV, PDF, DOCX, PPTX, XLSX, and image OCR (English)
- PDF text extraction first, with OCR fallback for pages with little selectable text
- AI-generated, source-grounded Natural Reviewer, four-option MCQ quiz, and focused flashcard deck
- Optional automatic study-package generation immediately after a file is uploaded
- Manual flashcards
- Source-text-based practice question generation (multiple choice, true/false, identification-style, fill-in style)
- Reviewer organization and direct Long Bond Paper PDF download
- Keyword search across saved source materials
- Study planner, daily study goal, and progress summaries
- JSON backup export/import and local data deletion

## Important limitations

- Processing libraries are loaded from public CDNs, so an internet connection is needed for first load and document processing. OCR may download its English language model the first time.
- The generators are deterministic, rule-based helpers—not AI. Their output quality depends on the structure and clarity of your source text. Always check generated questions and reviewer notes against the original material.
- DOC and legacy PPT files are not supported; save them as DOCX/PPTX first.
- Local study data stays in the browser profile/device where it was created. It does not sync between visitors or devices. Clearing browser storage can remove it. Export backups regularly.
- Browser storage quotas and available memory vary. Very large files may fail or take time to process.
- Speech recognition and text-to-speech were not included in this first packaged version.
- This ZIP is source code; it has not been deployed to your Netlify account. A public URL is created only after you upload/deploy it through your Netlify dashboard.

## Files

- `index.html` — application layout
- `styles.css` — responsive design and themes
- `app.js` — application logic, IndexedDB, extraction, and study tools
- `netlify.toml` — Netlify publish, function, and security configuration
- `netlify/functions/generate-study-package.js` — secure AI endpoint and strict MedTech generation prompt
- `.env.example` — environment-variable names only; contains no secret key


### Large PDF and scanned-document processing
PDF extraction processes every page. Pages with selectable text are extracted directly; pages without sufficient selectable text are rendered and OCR-processed using a reused browser worker. There is no three-page OCR cap and no artificial 55-second cancellation. Large scanned documents can take longer depending on device speed and image quality; keep the tab open until processing completes.


### Large PDF and scanned-document processing
PDF extraction processes every page. Pages with selectable text are extracted directly; pages without sufficient selectable text are rendered and OCR-processed using one reused browser OCR worker. There is no three-page OCR cap and no artificial 55-second cancellation. Large scanned documents can take longer depending on device speed and image quality; keep the tab open until processing completes.


### File selection limits
The Study Library accepts up to 10 files per selection, with a maximum size of 1 GB for each file. Files are processed one at a time. Files over 1 GB are skipped with a notice. Actual processing of very large files depends on the browser, available device memory, and file format.

### OCR for images embedded in documents
DOCX imports now preserve the document's extracted text and also OCR embedded images. PPTX imports extract slide text and OCR images linked to each slide. This helps capture readable words in screenshots, photographed notes, diagrams, and image-based tables. PDF pages continue to be rendered and OCR-processed when they do not contain enough selectable text, which also captures text visible in images placed on those pages. Standalone JPG, PNG, and WEBP uploads are OCR-processed too. OCR currently uses English; recognition quality depends on image clarity, resolution, orientation, and contrast. Complex diagrams are read as text where possible, not interpreted as visual concepts.


## Source cleaning and generation reliability

- Every imported, pasted, or edited material is normalized into one canonical cleaned source text before it is saved.
- The same saved source is used by the Reviewer, Flashcards, and Quiz generators; existing materials are cleaned on app startup as well.
- PDF extraction reconstructs text into visual lines using text coordinates and attempts a left-column-then-right-column reading order when a clear gutter is detected. Scanned pages still use OCR.
- Broken control/replacement characters, page-number noise, separator-only lines, and obviously symbol-damaged fragments are removed without rewriting numeric values, units, or scientific symbols.
- Materials that fail basic readability checks are rejected with an explanation rather than used to create study tools.
- Question generation is conservative and rule-based. MCQs are emitted only when four distinct choices are available and exactly one matches the source answer. The generator may produce fewer questions than requested when the source does not support enough reliable questions.
- PDF multi-column detection is heuristic. Always compare extracted text with the original PDF, especially for complex tables, equations, diagrams, and mixed multi-column layouts.


## Course classification and exports

- File upload requires a course category and subject before browse or drag-and-drop processing.
- MEDTECH subjects: CC, CD, AUBF, HEMA, HISTO, PARA, BACTE.
- IT subjects: NETW, SEPC, HCIN, SFCR, ITPM, ITPC, IAAS.
- The same category and subject metadata is attached to the source material and generated reviewer, flashcards, and quiz records.
- Pasted study text also requires a category and subject.
- Reviewer export uses a direct **Save as PDF** action (no browser Print dialog). The generated PDF is portrait Long Bond Paper (8.5 × 13 inches), two columns, 0.5-inch margins, 12 pt serif text, 1.5 line spacing, justified paragraphs, the exact `DY, JULIANA FAITH S.` header, and page numbers. The project embeds Liberation Serif, a metrically compatible Times-style font, because Times New Roman is proprietary and is not bundled. If exact Times New Roman is mandatory, supply a licensed Times New Roman TTF font file for embedding.
- Flashcard decks and completed quiz reviews can be exported as plain-text files.

## Known limitations

- This is still a static, local-first, rule-based application. It does not call an AI model. Flashcards and quizzes are generated from recognizable source patterns, so some documents may not contain enough structured material to create many reliable questions.
- Direct PDF export requires the jsPDF library CDN on first load. Keep an internet connection available when downloading the reviewer PDF.
- Column reconstruction, OCR, and table extraction are heuristic; always compare scientific material, tables, formulas, and scanned pages with the original file.


### Reviewer PDF fonts
The PDF embeds the included Liberation Serif font files from `assets/fonts/`. Liberation Serif is designed as a metrically compatible Times-style substitute. The PDF itself is generated at 612 × 936 points (8.5 × 13 inches), with two text columns and 18-point body leading (1.5 × 12 pt). The bundled font license is included beside the font files.


## AI study-package generator setup

The application extracts PDF, DOCX, PPTX, spreadsheet, text, and image content in the browser using the existing extraction pipeline. Once text is extracted and cleaned, the app sends the source text and selected subject metadata to `/.netlify/functions/generate-study-package`. The Netlify Function injects the strict system prompt and calls the OpenAI Chat Completions API using Structured Outputs with a strict JSON schema. The source document itself and the API key are not sent to browser-visible code.

### Required Netlify environment variables

In Netlify, open **Site configuration → Environment variables** and add:

- `OPENAI_API_KEY` — your private OpenAI API key (required)
- `OPENAI_MODEL` — optional; defaults to `gpt-4o-mini`

Never paste the API key into `app.js`, `index.html`, or any committed frontend file. After adding or changing environment variables, redeploy the site.

### Local development

Use the Netlify CLI so the serverless function runs locally:

```bash
npm install -g netlify-cli
netlify dev
```

Set the environment variables in your local shell or a private, untracked `.env` file. Do not commit `.env`. `.env.example` is safe to share because it contains placeholders only.

### How generation works

- The Study Library upload pipeline extracts and validates text locally first.
- The **Automatically generate a study package after upload** checkbox is enabled by default. When enabled, the extracted text is sent to the Netlify Function after it is saved. If AI is not configured or the API request fails, the original material remains saved locally and the app displays the error.
- The function returns a Natural Reviewer, four-option MCQs with reference answers and rationales, flashcards, and source-quality notes as structured JSON.
- The Reviewer screen shows a dynamic subject-specific header and a two-column, narrow-margin, 1.5-spaced layout. It does not print generic category/subject fields or a student-name header.
- **Save as PDF** opens a filename modal before creating a Long Bond Paper PDF.
- The Flashcards and Quiz screens reuse the saved package for the selected material, so they do not need to regenerate it unless the source material changes or the cached package is cleared.

The backend currently receives extracted text rather than raw PDF bytes: PDF/OCR and office-file parsing remain in the existing browser extraction pipeline. This preserves the current large-file and scanned-page support while ensuring all LLM calls and API credentials remain server-side.
