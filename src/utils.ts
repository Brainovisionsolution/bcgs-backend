import dayjs from 'dayjs'

export function calculateDuration(startDate: Date, endDate: Date): string {
  const start = dayjs(startDate)
  const end = dayjs(endDate)
  
  const diffDays = end.diff(start, 'day')
  if (diffDays <= 0) return '0 Days'

  // If reasonably fits in months
  const diffMonths = end.diff(start, 'month', true)
  if (Number.isInteger(diffMonths) && diffMonths > 0) {
    return `${diffMonths} Month${diffMonths > 1 ? 's' : ''}`
  }

  // Check exact weeks
  if (diffDays % 7 === 0) {
    const weeks = diffDays / 7
    return `${weeks} Week${weeks > 1 ? 's' : ''}`
  }
  
  // Otherwise default to days
  return `${diffDays} Day${diffDays > 1 ? 's' : ''}`
}

export function getGenderPronoun(gender: string): string {
  const g = gender ? String(gender).toUpperCase() : 'NEUTRAL'
  if (g === 'MALE') return 'He'
  if (g === 'FEMALE') return 'She'
  return 'They' // Neutral default
}
