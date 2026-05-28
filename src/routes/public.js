"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const db_1 = require("../db");
const dayjs_1 = __importDefault(require("dayjs"));
const utils_1 = require("../utils");
const router = express_1.default.Router();
router.get('/verify/:certificate_id', async (req, res) => {
    const { certificate_id } = req.params;
    try {
        let documentType = 'CERTIFICATE';
        let doc = await db_1.prisma.certificate.findFirst({
            where: {
                OR: [
                    { certificate_id: certificate_id },
                    { internship_id: certificate_id }
                ]
            }
        });
        if (!doc) {
            doc = await db_1.prisma.offerLetter.findFirst({
                where: {
                    OR: [
                        { offer_id: certificate_id },
                        { internship_id: certificate_id }
                    ]
                }
            });
            if (doc)
                documentType = 'OFFER_LETTER';
        }
        if (!doc) {
            res.status(404).json({ error: 'Document not found' });
            return;
        }
        const durationText = doc.duration ? doc.duration : (0, utils_1.calculateDuration)(doc.start_date, doc.end_date);
        const programFormatted = `${durationText} ${doc.program_type} Program`;
        res.json({
            document_id: certificate_id,
            document_type: documentType,
            name: doc.name,
            college: doc.college,
            course: doc.course,
            program: programFormatted,
            start_date: (0, dayjs_1.default)(doc.start_date).format('DD MMM YYYY'),
            end_date: (0, dayjs_1.default)(doc.end_date).format('DD MMM YYYY'),
            issue_date: (0, dayjs_1.default)(doc.issue_date).format('DD MMM YYYY'),
            status: doc.status,
            pdf_url: `/generated/${certificate_id}.pdf`
        });
    }
    catch (error) {
        res.status(500).json({ error: 'Server error during verification' });
    }
});
exports.default = router;
//# sourceMappingURL=public.js.map