"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateCertificatePDF = generateCertificatePDF;
const puppeteer_1 = __importDefault(require("puppeteer"));
const qrcode_1 = __importDefault(require("qrcode"));
const path_1 = __importDefault(require("path"));
const utils_1 = require("./utils");
const dayjs_1 = __importDefault(require("dayjs"));
async function generateCertificatePDF(certData, template, bgBase64, logoBase64) {
    // 1. Generate QR Code
    const documentId = certData.internship_id || certData.offer_id || certData.certificate_id;
    const verifyUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/verify/${documentId}`;
    const qrDataUrl = await qrcode_1.default.toDataURL(verifyUrl);
    // 2. Prepare Data Mapping
    const durationText = certData.duration ? certData.duration : (0, utils_1.calculateDuration)(certData.start_date, certData.end_date);
    const pronoun = (0, utils_1.getGenderPronoun)(certData.gender);
    const g = certData.gender ? String(certData.gender).toUpperCase() : 'NEUTRAL';
    const PRONOUN_HE = g === 'MALE' ? 'he' : g === 'FEMALE' ? 'she' : 'they';
    const PRONOUN_HIS = g === 'MALE' ? 'his' : g === 'FEMALE' ? 'her' : 'their';
    const PRONOUN_HIM = g === 'MALE' ? 'him' : g === 'FEMALE' ? 'her' : 'them';
    const PRONOUN_HE_CAP = g === 'MALE' ? 'He' : g === 'FEMALE' ? 'She' : 'They';
    const PRONOUN_HIS_CAP = g === 'MALE' ? 'His' : g === 'FEMALE' ? 'Her' : 'Their';
    // Provide mapping against layout keys
    const dataMapping = {
        "NAME": certData.name,
        "COLLEGE": certData.college,
        "COURSE": certData.course,
        "PROGRAM_TYPE": certData.program_type,
        "DURATION": durationText,
        "START_DATE": (0, dayjs_1.default)(certData.start_date).format('DD MMM YYYY'),
        "END_DATE": (0, dayjs_1.default)(certData.end_date).format('DD MMM YYYY'),
        "DATE": (0, dayjs_1.default)(certData.issue_date).format('DD/MM/YYYY'),
        "CERTIFICATE_ID": certData.certificate_id,
        "OFFER_ID": certData.offer_id,
        "INTERNSHIP_ID": certData.internship_id,
        "ROLE": certData.role,
        "PRONOUN_HE": PRONOUN_HE,
        "PRONOUN_HIS": PRONOUN_HIS,
        "PRONOUN_HIM": PRONOUN_HIM,
        "PRONOUN_HE_CAP": PRONOUN_HE_CAP,
        "PRONOUN_HIS_CAP": PRONOUN_HIS_CAP,
        "DURATION_PROGRAM": `${durationText} ${certData.program_type} Program`,
        "GENDER_TEXT": `${pronoun} has successfully completed...`, // A simple text map for preview
        "OFFER_PARAGRAPHS": `
      <div style="margin-bottom: 20px;">
        Following your Application, Eligibility Test and Subsequence interview, we are pleased to inform you that you have been considered as an <b>INTERN</b> in our Organization And you will be working as <b>${certData.role || certData.program_type}</b>.
      </div>
      <div>
        It is our hope that you will work as your level best to improve the efficiency and performance of the Organization. We look forward to working with you. Congratulations and best wishes.
      </div>
    `
    };
    // 3. Generate HTML 
    // We use absolute positioning based on layout_json
    let overlays = '';
    // Render fields from layout_json (both data mapped and static defaults)
    for (const [key, p] of Object.entries(template.layout_json)) {
        // Skip special non-text keys
        if (['WORD_TEMPLATE', 'QR_CODE', 'QR_POSITION', 'QR_SIZE', 'SIGNATURE', 'SEAL'].includes(key))
            continue;
        let val = dataMapping[key];
        if (!val && p.default) {
            val = p.default;
            // Interpolate {{VAR}} dynamically
            for (const [dKey, dVal] of Object.entries(dataMapping)) {
                if (dVal !== undefined && dVal !== null) {
                    val = val.replace(new RegExp(`{{${dKey}}}`, 'g'), String(dVal));
                }
            }
        }
        if (val) {
            const widthStr = p.width ? `width: ${p.width}px;` : 'white-space: nowrap;';
            const lhStr = p.lineHeight ? `line-height: ${p.lineHeight};` : '';
            const alignStr = p.textAlign ? `text-align: ${p.textAlign};` : '';
            const textDec = p.textDecoration ? `text-decoration: ${p.textDecoration};` : '';
            overlays += `<div style="position: absolute; left: ${p.x}px; top: ${p.y}px; font: ${p.font || '20px Arial'}; color: ${p.color || '#000'}; ${widthStr} ${lhStr} ${alignStr} ${textDec}">${val}</div>\n`;
        }
    }
    // Support for Word Template Mode
    if (template.layout_json["WORD_TEMPLATE"]) {
        const wt = template.layout_json["WORD_TEMPLATE"];
        let parsedHtml = wt.html;
        for (const [key, val] of Object.entries(dataMapping)) {
            const regex = new RegExp(`{{${key}}}`, 'g');
            parsedHtml = parsedHtml.replace(regex, String(val));
        }
        overlays += `<div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; margin: ${wt.margin || '50px'}; font-family: Arial, sans-serif;">${parsedHtml}</div>\n`;
    }
    const isPortrait = template.orientation === 'PORTRAIT';
    const pdfWidth = isPortrait ? 816 : 1056;
    const pdfHeight = isPortrait ? 1056 : 816;
    // Add QR code to a fixed position or read it from layout
    let qrPos = template.layout_json["QR_CODE"] || { x: 800, y: 550, width: 100 };
    const qrPositionStr = template.layout_json["QR_POSITION"];
    const qrSize = template.layout_json["QR_SIZE"] || 100;
    if (qrPositionStr) {
        const margin = 60;
        if (qrPositionStr === 'BOTTOM_RIGHT')
            qrPos = { x: pdfWidth - qrSize - margin, y: pdfHeight - qrSize - margin, width: qrSize };
        else if (qrPositionStr === 'BOTTOM_LEFT')
            qrPos = { x: margin, y: pdfHeight - qrSize - margin, width: qrSize };
        else if (qrPositionStr === 'BOTTOM_MIDDLE')
            qrPos = { x: (pdfWidth - qrSize) / 2, y: pdfHeight - qrSize - margin, width: qrSize };
        else if (qrPositionStr === 'MIDDLE_RIGHT')
            qrPos = { x: pdfWidth - qrSize - margin, y: (pdfHeight - qrSize) / 2, width: qrSize };
        else if (qrPositionStr === 'MIDDLE_LEFT')
            qrPos = { x: margin, y: (pdfHeight - qrSize) / 2, width: qrSize };
        else if (qrPositionStr === 'TOP_RIGHT')
            qrPos = { x: pdfWidth - qrSize - margin, y: margin, width: qrSize };
        else if (qrPositionStr === 'TOP_LEFT')
            qrPos = { x: margin, y: margin, width: qrSize };
    }
    overlays += `<img src="${qrDataUrl}" style="position: absolute; left: ${qrPos.x}px; top: ${qrPos.y}px; width: ${qrPos.width}px; z-index: 10;" />\n`;
    if (logoBase64) {
        overlays += `<img src="${logoBase64}" style="position: absolute; left: 50px; top: 50px; width: 150px; height: auto;" />\n`;
    }
    // Add signature if exists
    if (template.signature_image && template.layout_json["SIGNATURE"]) {
        const sPos = template.layout_json["SIGNATURE"];
        const sImg = template.signature_image.startsWith('data:') ? template.signature_image : `http://localhost:${process.env.PORT || 5000}${template.signature_image}`;
        overlays += `<img src="${sImg}" style="position: absolute; left: ${sPos.x}px; top: ${sPos.y}px; width: ${sPos.width}px; z-index: 1;" />\n`;
    }
    // Add seal if exists
    if (template.seal_image && template.layout_json["SEAL"]) {
        const sealPos = template.layout_json["SEAL"];
        const sealImg = template.seal_image.startsWith('data:') ? template.seal_image : `http://localhost:${process.env.PORT || 5000}${template.seal_image}`;
        const opacity = sealPos.opacity ? `opacity: ${sealPos.opacity};` : '';
        overlays += `<img src="${sealImg}" style="position: absolute; left: ${sealPos.x}px; top: ${sealPos.y}px; width: ${sealPos.width}px; ${opacity} z-index: 5;" />\n`;
    }
    const bgImageSrc = bgBase64 ? bgBase64 : (template.background_image.startsWith('data:') ? template.background_image : `http://localhost:${process.env.PORT || 5000}${template.background_image}`);
    const htmlContent = `
    <html>
      <head>
        <style>
          body { margin: 0; padding: 0; width: ${pdfWidth}px; height: ${pdfHeight}px; position: relative; }
          .bg { position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: -1; }
        </style>
      </head>
      <body>
        <img src="${bgImageSrc}" class="bg" />
        ${overlays}
      </body>
    </html>
  `;
    // 4. Launch Puppeteer to capture
    const browser = await puppeteer_1.default.launch({ headless: true });
    const page = await browser.newPage();
    await page.setViewport({ width: pdfWidth, height: pdfHeight, deviceScaleFactor: 2 });
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
    const generatedDir = path_1.default.join(__dirname, '../generated');
    const pdfPath = path_1.default.join(generatedDir, `${documentId}.pdf`);
    await page.pdf({
        path: pdfPath,
        width: `${pdfWidth}px`,
        height: `${pdfHeight}px`,
        printBackground: true,
        margin: { top: 0, right: 0, bottom: 0, left: 0 }
    });
    await browser.close();
    return pdfPath;
}
//# sourceMappingURL=generator.js.map