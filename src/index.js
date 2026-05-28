"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const admin_1 = __importDefault(require("./routes/admin"));
const public_1 = __importDefault(require("./routes/public"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 5000;
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: '50mb' }));
// Ensure directories exist
const uploadDir = path_1.default.join(__dirname, '../uploads');
const generatedDir = path_1.default.join(__dirname, '../generated');
if (!fs_1.default.existsSync(uploadDir))
    fs_1.default.mkdirSync(uploadDir, { recursive: true });
if (!fs_1.default.existsSync(generatedDir))
    fs_1.default.mkdirSync(generatedDir, { recursive: true });
// Serve static files for verification templates and generated PDFs
app.use('/public', express_1.default.static(path_1.default.join(__dirname, '../public'))); // e.g. for mock-bg.jpg
app.use('/generated', express_1.default.static(generatedDir));
// Routes
app.use('/api/admin', admin_1.default);
app.use('/api/public', public_1.default);
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
//# sourceMappingURL=index.js.map