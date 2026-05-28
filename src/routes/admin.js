"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const multer_1 = __importDefault(require("multer"));
const fast_csv_1 = require("fast-csv");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const auth_1 = require("../middleware/auth");
const db_1 = require("../db");
const generator_1 = require("../generator");
const dayjs_1 = __importDefault(require("dayjs"));
const nodemailer_1 = __importDefault(require("nodemailer"));
const transporter = nodemailer_1.default.createTransport({
    host: process.env.SMTP_HOST || 'smtp.ethereal.email',
    port: Number(process.env.SMTP_PORT) || 587,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});
const router = express_1.default.Router();
const upload = (0, multer_1.default)({ dest: 'uploads/' });
router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const admin = await db_1.prisma.admin.findUnique({ where: { email } });
    if (!admin || !(await bcryptjs_1.default.compare(password, admin.password))) {
        res.status(401).json({ error: 'Invalid credentials' });
        return;
    }
    const token = jsonwebtoken_1.default.sign({ id: admin.id, email: admin.email }, process.env.JWT_SECRET || 'fallback_secret', { expiresIn: '1d' });
    res.json({ token });
});
router.use(auth_1.authenticateAdmin);
router.get('/templates', async (req, res) => {
    const templates = await db_1.prisma.template.findMany();
    res.json(templates);
});
router.post('/upload-bulk', upload.fields([
    { name: 'csv', maxCount: 1 },
    { name: 'background', maxCount: 1 },
    { name: 'logo', maxCount: 1 }
]), async (req, res) => {
    const files = req.files;
    if (!files || !files.csv || !files.csv[0]) {
        res.status(400).json({ error: 'No CSV file uploaded' });
        return;
    }
    const csvFile = files.csv[0];
    const backgroundFile = files.background?.[0];
    const logoFile = files.logo?.[0];
    // Convert background and logo to base64 if provided
    let bgBase64;
    let logoBase64;
    if (backgroundFile) {
        const bgData = fs_1.default.readFileSync(backgroundFile.path);
        const mimeType = backgroundFile.mimetype;
        bgBase64 = `data:${mimeType};base64,${bgData.toString('base64')}`;
    }
    if (logoFile) {
        const logoData = fs_1.default.readFileSync(logoFile.path);
        const mimeType = logoFile.mimetype;
        logoBase64 = `data:${mimeType};base64,${logoData.toString('base64')}`;
    }
    const fileContent = fs_1.default.readFileSync(csvFile.path, 'utf8');
    const results = [];
    (0, fast_csv_1.parseString)(fileContent, { headers: true })
        .on('data', (row) => results.push(row))
        .on('end', async () => {
        // Process rows
        fs_1.default.unlinkSync(csvFile.path); // Clean up CSV
        if (backgroundFile)
            fs_1.default.unlinkSync(backgroundFile.path); // Clean up background
        if (logoFile)
            fs_1.default.unlinkSync(logoFile.path); // Clean up logo
        const generatedCerts = [];
        for (const [index, row] of results.entries()) {
            try {
                // Determine template. e.g. MALE -> MOCK_MALE_01, FEMALE -> MOCK_FEMALE_01
                const gender = row.gender?.toUpperCase() || 'NEUTRAL';
                let templateId = req.body.template_id || (gender === 'MALE' ? 'MOCK_MALE_01' : 'MOCK_FEMALE_01');
                let template = await db_1.prisma.template.findUnique({ where: { template_id: templateId } });
                if (!template) {
                    template = await db_1.prisma.template.findFirst(); // fallback
                }
                if (!template) {
                    console.error('No templates available');
                    continue;
                }
                const programCode = (row.program_type ? String(row.program_type).substring(0, 3).toUpperCase() : 'GEN');
                const serial = String(index + 1).padStart(4, '0');
                const uniqueSuffix = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
                const generatedCertId = `BRV-${(0, dayjs_1.default)().year()}-${programCode}-${serial}-${uniqueSuffix}`;
                const certId = row.internship_id || generatedCertId;
                const certData = {
                    certificate_id: certId,
                    internship_id: row.internship_id || null,
                    name: row.name || 'Unknown',
                    email: row.email || null,
                    gender: row.gender || 'NEUTRAL',
                    college: row.college || 'N/A',
                    course: row.course || 'N/A',
                    program_type: row.program_type || 'N/A',
                    duration: row.duration || 'N/A',
                    start_date: (row.start_date && !Number.isNaN(new Date(row.start_date).getTime())) ? new Date(row.start_date) : new Date(),
                    end_date: (row.end_date && !Number.isNaN(new Date(row.end_date).getTime())) ? new Date(row.end_date) : new Date(),
                    issue_date: new Date(),
                    role: row.role || 'N/A',
                    qr_url: '', // will be set
                    status: 'VALID',
                    templateId: template.id
                };
                // Generate PDF with potential custom background and logo
                const pdfPath = await (0, generator_1.generateCertificatePDF)(certData, template, bgBase64, logoBase64);
                certData.qr_url = `/verify/${certId}`;
                // Insert to DB
                const savedCert = await db_1.prisma.certificate.create({
                    data: certData
                });
                // Send email
                if (row.email) {
                    const verifyLink = `http://localhost:3000/verify/${certId}`;
                    try {
                        await transporter.sendMail({
                            from: process.env.SMTP_FROM || '"Brainovision" <noreply@brainovision.com>',
                            to: row.email,
                            subject: `Your Certificate for ${row.program_type} is Ready!`,
                            text: `Dear ${row.name},\n\nCongratulations on completing the ${row.program_type}. You can view and download your certificate at: ${verifyLink}\n\nBest regards,\nBrainovision Team`,
                            html: `<p>Dear ${row.name},</p><p>Congratulations on completing the ${row.program_type}.</p><p>You can view and download your certificate here: <a href="${verifyLink}">${verifyLink}</a></p><p>Best regards,<br>Brainovision Team</p>`,
                            attachments: [
                                {
                                    filename: `${certId}.pdf`,
                                    path: pdfPath
                                }
                            ]
                        });
                        console.log(`Email sent to ${row.email}`);
                    }
                    catch (emailErr) {
                        console.error(`Failed to send email to ${row.email}:`, emailErr);
                    }
                }
                generatedCerts.push(savedCert);
            }
            catch (err) {
                console.error('Row error:', err);
            }
        }
        res.json({ message: 'Success', generated: generatedCerts.length });
    });
});
router.post('/upload-bulk-offer-letters', upload.fields([
    { name: 'csv', maxCount: 1 },
    { name: 'background', maxCount: 1 },
    { name: 'logo', maxCount: 1 }
]), async (req, res) => {
    const files = req.files;
    if (!files || !files.csv || !files.csv[0]) {
        res.status(400).json({ error: 'No CSV file uploaded' });
        return;
    }
    const csvFile = files.csv[0];
    const backgroundFile = files.background?.[0];
    const logoFile = files.logo?.[0];
    let bgBase64;
    let logoBase64;
    if (backgroundFile) {
        const bgData = fs_1.default.readFileSync(backgroundFile.path);
        const mimeType = backgroundFile.mimetype;
        bgBase64 = `data:${mimeType};base64,${bgData.toString('base64')}`;
    }
    if (logoFile) {
        const logoData = fs_1.default.readFileSync(logoFile.path);
        const mimeType = logoFile.mimetype;
        logoBase64 = `data:${mimeType};base64,${logoData.toString('base64')}`;
    }
    const fileContent = fs_1.default.readFileSync(csvFile.path, 'utf8');
    const results = [];
    (0, fast_csv_1.parseString)(fileContent, { headers: true })
        .on('data', (row) => results.push(row))
        .on('error', (err) => {
        console.error('CSV Parsing Error:', err);
        if (!res.headersSent)
            res.status(400).json({ error: 'CSV parsing failed', details: [err.message] });
    })
        .on('end', async () => {
        try {
            if (fs_1.default.existsSync(csvFile.path))
                fs_1.default.unlinkSync(csvFile.path);
            if (backgroundFile && fs_1.default.existsSync(backgroundFile.path))
                fs_1.default.unlinkSync(backgroundFile.path);
            if (logoFile && fs_1.default.existsSync(logoFile.path))
                fs_1.default.unlinkSync(logoFile.path);
            if (res.headersSent)
                return; // Prevent crash if .on('error') already responded
            const generatedOffers = [];
            const errors = [];
            for (const [index, row] of results.entries()) {
                try {
                    const gender = row.gender?.toUpperCase() || 'NEUTRAL';
                    let templateId = req.body.template_id || (gender === 'MALE' ? 'MOCK_MALE_01' : 'MOCK_FEMALE_01');
                    let template = await db_1.prisma.template.findUnique({ where: { template_id: templateId } });
                    if (!template) {
                        template = await db_1.prisma.template.findFirst();
                    }
                    if (!template) {
                        console.error('No templates available');
                        continue;
                    }
                    const programCode = (row.program_type ? String(row.program_type).substring(0, 3).toUpperCase() : 'GEN');
                    const serial = String(index + 1).padStart(4, '0');
                    const uniqueSuffix = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
                    const generatedOfferId = `OFL-${(0, dayjs_1.default)().year()}-${programCode}-${serial}-${uniqueSuffix}`;
                    const internshipId = row.internship_id || `INT-${(0, dayjs_1.default)().year()}-${programCode}-${serial}`;
                    const offerData = {
                        offer_id: generatedOfferId,
                        internship_id: internshipId,
                        name: row.name || 'Unknown',
                        email: row.email || null,
                        college: row.college || 'N/A',
                        course: row.course || 'N/A',
                        program_type: row.program_type || 'N/A',
                        duration: row.duration || 'N/A',
                        start_date: (row.start_date && !Number.isNaN(new Date(row.start_date).getTime())) ? new Date(row.start_date) : new Date(),
                        end_date: (row.end_date && !Number.isNaN(new Date(row.end_date).getTime())) ? new Date(row.end_date) : new Date(),
                        issue_date: new Date(),
                        role: row.role || 'N/A',
                        qr_url: '',
                        status: 'GENERATED',
                        templateId: template.id
                    };
                    const pdfPath = await (0, generator_1.generateCertificatePDF)(offerData, template, bgBase64, logoBase64);
                    offerData.qr_url = `/verify/${generatedOfferId}`;
                    const savedOffer = await db_1.prisma.offerLetter.create({
                        data: offerData
                    });
                    generatedOffers.push(savedOffer);
                }
                catch (err) {
                    console.error('Row error:', err);
                    errors.push(err.message);
                }
            }
            if (generatedOffers.length === 0 && errors.length > 0) {
                if (!res.headersSent)
                    res.status(400).json({ error: 'Failed to generate offers', details: errors });
                return;
            }
            if (!res.headersSent)
                res.json({ message: 'Success', generated: generatedOffers.length });
        }
        catch (globalErr) {
            console.error('Unhandled error in CSV generation:', globalErr);
            if (!res.headersSent)
                res.status(500).json({ error: 'Server crashed during generation', details: [globalErr.message] });
        }
    });
});
router.get('/offer-letters', async (req, res) => {
    const offers = await db_1.prisma.offerLetter.findMany({
        orderBy: { createdAt: 'desc' }
    });
    res.json(offers);
});
router.post('/offer-letters/send', async (req, res) => {
    const { ids } = req.body; // Array of OfferLetter IDs
    if (!ids || !Array.isArray(ids)) {
        res.status(400).json({ error: 'ids array is required' });
        return;
    }
    const offers = await db_1.prisma.offerLetter.findMany({
        where: { id: { in: ids }, status: 'GENERATED' }
    });
    let sentCount = 0;
    for (const offer of offers) {
        if (offer.email) {
            const verifyLink = `http://localhost:3000/verify/${offer.offer_id}`;
            const pdfPath = path_1.default.join(__dirname, `../generated/${offer.offer_id}.pdf`);
            try {
                await transporter.sendMail({
                    from: process.env.SMTP_FROM || '"Brainovision" <noreply@brainovision.com>',
                    to: offer.email,
                    subject: `Your Offer Letter for ${offer.program_type} is Ready!`,
                    text: `Dear ${offer.name},\n\nCongratulations on being selected for the ${offer.program_type}. You can view and download your offer letter at: ${verifyLink}\n\nBest regards,\nBrainovision Team`,
                    html: `<p>Dear ${offer.name},</p><p>Congratulations on being selected for the ${offer.program_type}.</p><p>You can view and download your offer letter here: <a href="${verifyLink}">${verifyLink}</a></p><p>Best regards,<br>Brainovision Team</p>`,
                    attachments: fs_1.default.existsSync(pdfPath) ? [
                        {
                            filename: `${offer.offer_id}.pdf`,
                            path: pdfPath
                        }
                    ] : []
                });
                await db_1.prisma.offerLetter.update({
                    where: { id: offer.id },
                    data: { status: 'SENT' }
                });
                sentCount++;
            }
            catch (err) {
                console.error(`Failed to send email to ${offer.email}:`, err);
            }
        }
    }
    res.json({ message: 'Sent offer letters', sent: sentCount });
});
router.post('/offer-letters/:id/revoke', async (req, res) => {
    const { id } = req.params;
    const offer = await db_1.prisma.offerLetter.update({
        where: { id: Number(id) },
        data: { status: 'REVOKED' }
    });
    res.json(offer);
});
router.delete('/offer-letters/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const offer = await db_1.prisma.offerLetter.delete({
            where: { id: Number(id) }
        });
        const pdfPath = path_1.default.join(__dirname, `../generated/${offer.offer_id}.pdf`);
        if (fs_1.default.existsSync(pdfPath))
            fs_1.default.unlinkSync(pdfPath);
        res.json(offer);
    }
    catch (err) {
        res.status(500).json({ error: 'Failed to delete record' });
    }
});
router.get('/certificates', async (req, res) => {
    const certs = await db_1.prisma.certificate.findMany({
        orderBy: { createdAt: 'desc' }
    });
    res.json(certs);
});
router.post('/certificates/:id/revoke', async (req, res) => {
    const { id } = req.params;
    const cert = await db_1.prisma.certificate.update({
        where: { id: Number(id) },
        data: { status: 'REVOKED' }
    });
    res.json(cert);
});
router.delete('/certificates/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const cert = await db_1.prisma.certificate.delete({
            where: { id: Number(id) }
        });
        const pdfPath = path_1.default.join(__dirname, `../generated/${cert.certificate_id}.pdf`);
        if (fs_1.default.existsSync(pdfPath))
            fs_1.default.unlinkSync(pdfPath);
        res.json(cert);
    }
    catch (err) {
        res.status(500).json({ error: 'Failed to delete record' });
    }
});
router.post('/reset-password', async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    const adminId = req.admin.id;
    const admin = await db_1.prisma.admin.findUnique({ where: { id: adminId } });
    if (!admin || !(await bcryptjs_1.default.compare(oldPassword, admin.password))) {
        res.status(401).json({ error: 'Invalid old password' });
        return;
    }
    const hashedPassword = await bcryptjs_1.default.hash(newPassword, 10);
    await db_1.prisma.admin.update({
        where: { id: adminId },
        data: { password: hashedPassword }
    });
    res.json({ message: 'Password updated successfully' });
});
router.post('/templates', upload.fields([
    { name: 'background', maxCount: 1 },
    { name: 'signature', maxCount: 1 },
    { name: 'seal', maxCount: 1 }
]), async (req, res) => {
    const { template_id, name, layout_json, orientation } = req.body;
    const files = req.files;
    const backgroundFile = files?.background?.[0];
    const signatureFile = files?.signature?.[0];
    const sealFile = files?.seal?.[0];
    let bgBase64 = '';
    let signatureBase64 = '';
    let sealBase64 = '';
    if (backgroundFile) {
        const bgData = fs_1.default.readFileSync(backgroundFile.path);
        bgBase64 = `data:${backgroundFile.mimetype};base64,${bgData.toString('base64')}`;
        fs_1.default.unlinkSync(backgroundFile.path);
    }
    if (signatureFile) {
        const sigData = fs_1.default.readFileSync(signatureFile.path);
        signatureBase64 = `data:${signatureFile.mimetype};base64,${sigData.toString('base64')}`;
        fs_1.default.unlinkSync(signatureFile.path);
    }
    if (sealFile) {
        const sealData = fs_1.default.readFileSync(sealFile.path);
        sealBase64 = `data:${sealFile.mimetype};base64,${sealData.toString('base64')}`;
        fs_1.default.unlinkSync(sealFile.path);
    }
    try {
        const parsedLayout = typeof layout_json === 'string' ? JSON.parse(layout_json) : layout_json;
        const template = await db_1.prisma.template.create({
            data: {
                template_id: template_id || `TMPL-${Date.now()}`,
                name,
                background_image: bgBase64 || '/mock-bg.jpg',
                signature_image: signatureBase64 || null,
                seal_image: sealBase64 || null,
                layout_json: parsedLayout,
                orientation: orientation || 'LANDSCAPE'
            }
        });
        res.json(template);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to create template' });
    }
});
router.post('/offer-letters/generate-certificates', async (req, res) => {
    const { ids, template_id } = req.body;
    const offers = await db_1.prisma.offerLetter.findMany({
        where: { id: { in: ids } }
    });
    let generatedCount = 0;
    for (const offer of offers) {
        try {
            let templateId = template_id || 'MOCK_MALE_01';
            let template = await db_1.prisma.template.findUnique({ where: { template_id: templateId } });
            if (!template) {
                template = await db_1.prisma.template.findFirst();
            }
            if (!template)
                continue;
            const programCode = (offer.program_type ? String(offer.program_type).substring(0, 3).toUpperCase() : 'GEN');
            const serial = String(generatedCount + 1).padStart(4, '0');
            const uniqueSuffix = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
            const certId = `BRV-${(0, dayjs_1.default)().year()}-${programCode}-${serial}-${uniqueSuffix}`;
            const certData = {
                certificate_id: certId,
                internship_id: offer.internship_id,
                name: offer.name,
                email: offer.email,
                gender: 'NEUTRAL',
                college: offer.college,
                course: offer.course,
                program_type: offer.program_type,
                duration: offer.duration,
                start_date: offer.start_date,
                end_date: offer.end_date,
                issue_date: new Date(),
                role: offer.role,
                qr_url: `/verify/${certId}`,
                status: 'VALID',
                templateId: template.id
            };
            const pdfPath = await (0, generator_1.generateCertificatePDF)(certData, template, undefined, undefined);
            await db_1.prisma.certificate.create({
                data: certData
            });
            if (offer.email) {
                const verifyLink = `http://localhost:3000/verify/${certId}`;
                try {
                    await transporter.sendMail({
                        from: process.env.SMTP_FROM || '"Brainovision" <noreply@brainovision.com>',
                        to: offer.email,
                        subject: `Your Certificate for ${offer.program_type} is Ready!`,
                        text: `Dear ${offer.name},\n\nCongratulations on completing the ${offer.program_type}. You can view and download your certificate at: ${verifyLink}\n\nBest regards,\nBrainovision Team`,
                        html: `<p>Dear ${offer.name},</p><p>Congratulations on completing the ${offer.program_type}.</p><p>You can view and download your certificate here: <a href="${verifyLink}">${verifyLink}</a></p><p>Best regards,<br>Brainovision Team</p>`,
                        attachments: fs_1.default.existsSync(pdfPath) ? [
                            {
                                filename: `${certId}.pdf`,
                                path: pdfPath
                            }
                        ] : []
                    });
                }
                catch (err) {
                    console.error('Email failed:', err);
                }
            }
            generatedCount++;
        }
        catch (err) {
            console.error('Error generating cert for offer:', err);
        }
    }
    res.json({ message: 'Success', generated: generatedCount });
});
exports.default = router;
//# sourceMappingURL=admin.js.map