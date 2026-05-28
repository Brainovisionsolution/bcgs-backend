"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateDuration = calculateDuration;
exports.getGenderPronoun = getGenderPronoun;
const dayjs_1 = __importDefault(require("dayjs"));
function calculateDuration(startDate, endDate) {
    const start = (0, dayjs_1.default)(startDate);
    const end = (0, dayjs_1.default)(endDate);
    const diffDays = end.diff(start, 'day');
    if (diffDays <= 0)
        return '0 Days';
    // If reasonably fits in months
    const diffMonths = end.diff(start, 'month', true);
    if (Number.isInteger(diffMonths) && diffMonths > 0) {
        return `${diffMonths} Month${diffMonths > 1 ? 's' : ''}`;
    }
    // Check exact weeks
    if (diffDays % 7 === 0) {
        const weeks = diffDays / 7;
        return `${weeks} Week${weeks > 1 ? 's' : ''}`;
    }
    // Otherwise default to days
    return `${diffDays} Day${diffDays > 1 ? 's' : ''}`;
}
function getGenderPronoun(gender) {
    const g = gender ? String(gender).toUpperCase() : 'NEUTRAL';
    if (g === 'MALE')
        return 'He';
    if (g === 'FEMALE')
        return 'She';
    return 'They'; // Neutral default
}
//# sourceMappingURL=utils.js.map