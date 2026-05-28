"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const client_1 = require("@prisma/client");
const adapter_better_sqlite3_1 = require("@prisma/adapter-better-sqlite3");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const adapter = new adapter_better_sqlite3_1.PrismaBetterSqlite3({ url: process.env.DATABASE_URL });
const prisma = new client_1.PrismaClient({ adapter });
async function main() {
    console.log('Seeding initial data...');
    // Create default admin
    const hashedPassword = await bcryptjs_1.default.hash('admin123', 10);
    const admin = await prisma.admin.upsert({
        where: { email: 'it@brainovision.in' },
        update: {},
        create: {
            email: 'it@brainovision.in',
            password: hashedPassword,
        },
    });
    console.log('Default admin created: it@brainovision.in / admin123');
    // Create mock templates
    const mockLayout = {
        "TO_LABEL": { "x": 60, "y": 320, "default": "<b>TO</b>", "font": "16px Arial", "color": "#000" },
        "DATE_LABEL": { "x": 600, "y": 320, "default": "<b>Date: {{DATE}}</b>", "font": "16px Arial", "color": "#000" },
        "NAME": { "x": 60, "y": 360, "font": "16px Arial", "color": "#000" },
        "COLLEGE": { "x": 60, "y": 380, "font": "16px Arial", "color": "#000" },
        "CERT_PARAGRAPH": {
            "x": 60,
            "y": 440,
            "width": 700,
            "lineHeight": "1.8",
            "font": "14px Arial",
            "color": "#333",
            "textAlign": "justify",
            "default": "This is to certify that <b>{{NAME}}</b> has successfully completed {{PRONOUN_HIS}} <b>{{PROGRAM_TYPE}}</b> program with <b>BrainOvision Solutions Pvt. Ltd.</b> {{PRONOUN_HE_CAP}} has worked on <b>{{COURSE}}</b> and was actively & diligently involved in the projects and tasks assigned to {{PRONOUN_HIM}}. During the span, we found {{PRONOUN_HIM}} punctual and hardworking person. {{PRONOUN_HIS_CAP}} feedback and evolution proved that {{PRONOUN_HE}} is a quick learner.<br><br>Congratulations and Best Wishes."
        },
        "ROLE_LABEL": { "x": 60, "y": 580, "default": "ROLE", "font": "14px Arial", "color": "#333" },
        "ROLE_VAL": { "x": 180, "y": 580, "default": ": <b>{{ROLE}}</b>", "font": "14px Arial", "color": "#333" },
        "ID_LABEL": { "x": 60, "y": 605, "default": "INTERN ID", "font": "14px Arial", "color": "#333" },
        "ID_VAL": { "x": 180, "y": 605, "default": ": <b>{{INTERNSHIP_ID}}</b>", "font": "14px Arial", "color": "#333" },
        "MODE_LABEL": { "x": 60, "y": 630, "default": "MODE", "font": "14px Arial", "color": "#333" },
        "MODE_VAL": { "x": 180, "y": 630, "default": ": <b>OFFLINE</b>", "font": "14px Arial", "color": "#333" },
        "START_LABEL": { "x": 60, "y": 655, "default": "START DATE", "font": "14px Arial", "color": "#333" },
        "START_VAL": { "x": 180, "y": 655, "default": ": <b>{{START_DATE}}</b>", "font": "14px Arial", "color": "#333" },
        "END_LABEL": { "x": 60, "y": 680, "default": "END DATE", "font": "14px Arial", "color": "#333" },
        "END_VAL": { "x": 180, "y": 680, "default": ": <b>{{END_DATE}}</b>", "font": "14px Arial", "color": "#333" },
        "SIGNATURE_YOURS": { "x": 60, "y": 750, "default": "Yours Faithfully,", "font": "14px Arial", "color": "#333" },
        "SIGNATURE": { "x": 60, "y": 770, "width": 120 },
        "SEAL": { "x": 80, "y": 760, "width": 100, "opacity": 0.5 },
        "SIGNATURE_NAME": { "x": 60, "y": 820, "default": "<b>Ganesh Nag Doddi</b><br>Founder & CEO<br>Brainovision Solutions India Pvt Ltd", "font": "14px Arial", "color": "#333", "lineHeight": "1.5" },
        "QR_CODE": { "x": 350, "y": 800, "width": 100 },
        "QR_POSITION": "BOTTOM_MIDDLE",
        "QR_SIZE": 100
    };
    const templateMale = await prisma.template.upsert({
        where: { template_id: 'MOCK_MALE_01' },
        update: {},
        create: {
            template_id: 'MOCK_MALE_01',
            name: 'Standard Design - Male',
            background_image: '/mock-bg.jpg', // Local public URL to be served by Express
            layout_json: mockLayout
        }
    });
    const templateFemale = await prisma.template.upsert({
        where: { template_id: 'MOCK_FEMALE_01' },
        update: {},
        create: {
            template_id: 'MOCK_FEMALE_01',
            name: 'Standard Design - Female',
            background_image: '/mock-bg.jpg',
            layout_json: mockLayout
        }
    });
    console.log('Mock templates created.');
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
});
//# sourceMappingURL=seed.js.map