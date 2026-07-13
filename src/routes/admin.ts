import express from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import multer from 'multer'
import { parseString } from 'fast-csv'
import fs from 'fs'
import path from 'path'
import { authenticateAdmin } from '../middleware/auth'
import { prisma } from '../db'
import { generateCertificatePDF } from '../generator'
import dayjs from 'dayjs'
import nodemailer from 'nodemailer'

// Helper: always build a safe from-address from env
const SMTP_FROM = () => process.env.SMTP_FROM || `Brainovision <${process.env.SMTP_USER || 'noreply@brainovision.in'}>`

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.ethereal.email',
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false,          // false = STARTTLS (required for Gmail port 587)
  requireTLS: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  tls: {
    rejectUnauthorized: false  // allow self-signed certs in dev
  }
})

// Verify SMTP connection on startup so misconfiguration is caught early
transporter.verify((err) => {
  if (err) {
    console.error('[SMTP] Connection failed – emails will NOT be delivered:', err.message)
  } else {
    console.log('[SMTP] Server ready to send emails via', process.env.SMTP_HOST)
  }
})

const router = express.Router()
const upload = multer({ dest: 'uploads/' })

router.post('/login', async (req, res): Promise<void> => {
  const { email, password } = req.body
  const admin = await prisma.admin.findUnique({ where: { email } })
  if (!admin || !(await bcrypt.compare(password, admin.password))) {
    res.status(401).json({ error: 'Invalid credentials' })
    return
  }

  const token = jwt.sign({ id: admin.id, email: admin.email }, process.env.JWT_SECRET || 'fallback_secret', { expiresIn: '1d' })
  res.json({ token })
})

router.use(authenticateAdmin)

router.get('/templates', async (req, res) => {
  const templates = await prisma.template.findMany()
  res.json(templates)
})

router.post('/upload-bulk', upload.fields([
  { name: 'csv', maxCount: 1 },
  { name: 'background', maxCount: 1 },
  { name: 'logo', maxCount: 1 }
]), async (req, res): Promise<void> => {
  const files = req.files as { [fieldname: string]: Express.Multer.File[] }
  if (!files || !files.csv || !files.csv[0]) {
    res.status(400).json({ error: 'No CSV file uploaded' })
    return
  }

  const csvFile = files.csv[0]
  const backgroundFile = files.background?.[0]
  const logoFile = files.logo?.[0]

  // Convert background and logo to base64 if provided
  let bgBase64: string | undefined
  let logoBase64: string | undefined

  if (backgroundFile) {
    const bgData = fs.readFileSync(backgroundFile.path)
    const mimeType = backgroundFile.mimetype
    bgBase64 = `data:${mimeType};base64,${bgData.toString('base64')}`
  }

  if (logoFile) {
    const logoData = fs.readFileSync(logoFile.path)
    const mimeType = logoFile.mimetype
    logoBase64 = `data:${mimeType};base64,${logoData.toString('base64')}`
  }

  const fileContent = fs.readFileSync(csvFile.path, 'utf8')
  const results: any[] = []

  parseString(fileContent, { headers: true })
    .on('data', (row) => results.push(row))
    .on('error', (err) => {
      console.error('CSV Parsing Error:', err);
      // Clean up files immediately on error
      if (fs.existsSync(csvFile.path)) fs.unlinkSync(csvFile.path)
      if (backgroundFile && fs.existsSync(backgroundFile.path)) fs.unlinkSync(backgroundFile.path)
      if (logoFile && fs.existsSync(logoFile.path)) fs.unlinkSync(logoFile.path)
      
      if (!res.headersSent) {
        res.status(400).json({ 
          error: 'Failed to parse CSV file', 
          details: err.message,
          hint: 'Ensure your CSV has headers and valid data rows'
        });
      }
    })
    .on('end', async () => {
      // Process rows
      if (fs.existsSync(csvFile.path)) fs.unlinkSync(csvFile.path) // Clean up CSV
      if (backgroundFile && fs.existsSync(backgroundFile.path)) fs.unlinkSync(backgroundFile.path) // Clean up background
      if (logoFile && fs.existsSync(logoFile.path)) fs.unlinkSync(logoFile.path) // Clean up logo

      if (res.headersSent) return; // Prevent crash if .on('error') already responded

      const generatedCerts = []
      const errors = []
      for (const [index, row] of results.entries()) {
        try {
          let templateId = req.body.template_id
          let template = null

          if (templateId) {
            template = await prisma.template.findUnique({ where: { template_id: templateId } })
          } else {
            template = await prisma.template.findFirst({ where: { is_default_certificate: true } })
            if (!template) {
              const gender = row.gender?.toUpperCase() || 'NEUTRAL'
              templateId = gender === 'MALE' ? 'MOCK_MALE_01' : 'MOCK_FEMALE_01'
              template = await prisma.template.findUnique({ where: { template_id: templateId } })
            }
          }
          
          if (!template) {
             template = await prisma.template.findFirst() // fallback
          }

          if (!template) {
            console.error('No templates available')
            errors.push(`Row ${index + 1}: No template available`)
            continue;
          }

          const programCode = (row.program_type ? String(row.program_type).substring(0,3).toUpperCase() : 'GEN')
          const serial = String(index + 1).padStart(4, '0')
          const uniqueSuffix = Math.floor(Math.random() * 10000).toString().padStart(4, '0')
          const generatedCertId = `BRV-${dayjs().year()}-${programCode}-${serial}-${uniqueSuffix}`
          const certId = row.internship_id || generatedCertId

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
          }

          // Generate PDF with potential custom background and logo
          const pdfPath = await generateCertificatePDF(certData, template, bgBase64, logoBase64)
          certData.qr_url = `/verify/${certId}`

          // Insert to DB
          const savedCert = await prisma.certificate.create({
            data: certData
          })
          
          // Send email
          if (row.email) {
            const verifyLink = `http://localhost:3000/verify/${certId}`
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
              })
              console.log(`Email sent to ${row.email}`)
            } catch (emailErr) {
              console.error(`Failed to send email to ${row.email}:`, emailErr)
            }
          }

          generatedCerts.push(savedCert)
        } catch (err: any) {
          console.error('Row error:', err)
          errors.push(`Row ${index + 1}: ${err.message}`)
        }
      }

      if (generatedCerts.length === 0 && errors.length > 0) {
        if (!res.headersSent) {
          res.status(400).json({ 
            error: 'Failed to generate certificates', 
            details: errors,
            hint: 'This often occurs due to browser rendering issues. Ensure templates are properly configured and server has sufficient resources.'
          })
        }
        return
      }

      if (!res.headersSent) {
        const response: any = { message: 'Success', generated: generatedCerts.length }
        if (errors.length > 0) {
          response.warnings = `${errors.length} rows failed to process`
          response.failedRows = errors
        }
        res.json(response)
      }
    })
})

router.post('/upload-bulk-offer-letters', upload.fields([
  { name: 'csv', maxCount: 1 },
  { name: 'background', maxCount: 1 },
  { name: 'logo', maxCount: 1 }
]), async (req, res): Promise<void> => {
  const files = req.files as { [fieldname: string]: Express.Multer.File[] }
  if (!files || !files.csv || !files.csv[0]) {
    res.status(400).json({ error: 'No CSV file uploaded' })
    return
  }

  const csvFile = files.csv[0]
  const backgroundFile = files.background?.[0]
  const logoFile = files.logo?.[0]

  let bgBase64: string | undefined
  let logoBase64: string | undefined

  if (backgroundFile) {
    const bgData = fs.readFileSync(backgroundFile.path)
    const mimeType = backgroundFile.mimetype
    bgBase64 = `data:${mimeType};base64,${bgData.toString('base64')}`
  }

  if (logoFile) {
    const logoData = fs.readFileSync(logoFile.path)
    const mimeType = logoFile.mimetype
    logoBase64 = `data:${mimeType};base64,${logoData.toString('base64')}`
  }

  const fileContent = fs.readFileSync(csvFile.path, 'utf8')
  const results: any[] = []

  parseString(fileContent, { headers: true })
    .on('data', (row) => results.push(row))
    .on('error', (err) => {
      console.error('CSV Parsing Error:', err);
      // Clean up files immediately on error
      if (fs.existsSync(csvFile.path)) fs.unlinkSync(csvFile.path)
      if (backgroundFile && fs.existsSync(backgroundFile.path)) fs.unlinkSync(backgroundFile.path)
      if (logoFile && fs.existsSync(logoFile.path)) fs.unlinkSync(logoFile.path)
      
      if (!res.headersSent) {
        res.status(400).json({ 
          error: 'Failed to parse CSV file', 
          details: err.message,
          hint: 'Ensure your CSV has headers and valid data rows'
        });
      }
    })
    .on('end', async () => {
      try {
        if (fs.existsSync(csvFile.path)) fs.unlinkSync(csvFile.path)
        if (backgroundFile && fs.existsSync(backgroundFile.path)) fs.unlinkSync(backgroundFile.path)
        if (logoFile && fs.existsSync(logoFile.path)) fs.unlinkSync(logoFile.path)

        if (res.headersSent) return; // Prevent crash if .on('error') already responded

        const generatedOffers = []
        const errors = []
        for (const [index, row] of results.entries()) {
          try {
            let templateId = req.body.template_id
            let template = null

            if (templateId) {
              template = await prisma.template.findUnique({ where: { template_id: templateId } })
            } else {
              template = await prisma.template.findFirst({ where: { is_default_offer_letter: true } })
              if (!template) {
                const gender = row.gender?.toUpperCase() || 'NEUTRAL'
                templateId = gender === 'MALE' ? 'MOCK_MALE_01' : 'MOCK_FEMALE_01'
                template = await prisma.template.findUnique({ where: { template_id: templateId } })
              }
            }
            
            if (!template) {
               template = await prisma.template.findFirst()
            }

            if (!template) {
              console.error('No templates available')
              continue;
            }

            const programCode = (row.program_type ? String(row.program_type).substring(0,3).toUpperCase() : 'GEN')
            const serial = String(index + 1).padStart(4, '0')
            const uniqueSuffix = Math.floor(Math.random() * 10000).toString().padStart(4, '0')
            const generatedOfferId = `OFL-${dayjs().year()}-${programCode}-${serial}-${uniqueSuffix}`
            const internshipId = row.internship_id || `INT-${dayjs().year()}-${programCode}-${serial}`
            
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
            }

            const pdfPath = await generateCertificatePDF(offerData, template, bgBase64, logoBase64)
            offerData.qr_url = `/verify/${generatedOfferId}`

            const savedOffer = await prisma.offerLetter.create({
              data: offerData
            })
            
            generatedOffers.push(savedOffer)
          } catch (err: any) {
            console.error('Row error:', err)
            errors.push(err.message)
          }
        }
        
        if (generatedOffers.length === 0 && errors.length > 0) {
          if (!res.headersSent) {
            res.status(400).json({ 
              error: 'Failed to generate offer letters', 
              details: errors,
              hint: 'This often occurs due to browser rendering issues. Ensure templates are properly configured and server has sufficient resources.'
            })
          }
          return
        }

        if (!res.headersSent) {
          const response: any = { message: 'Success', generated: generatedOffers.length }
          if (errors.length > 0) {
            response.warnings = `${errors.length} rows failed to process`
            response.failedRows = errors
          }
          res.json(response)
        }
      } catch (globalErr: any) {
        console.error('Unhandled error in CSV generation:', globalErr)
        if (!res.headersSent) res.status(500).json({ error: 'Server crashed during generation', details: [globalErr.message] })
      }
    })
})

router.get('/offer-letters', async (req, res) => {
  const offers = await prisma.offerLetter.findMany({
    orderBy: { createdAt: 'desc' }
  })
  res.json(offers)
})

router.post('/offer-letters/send', async (req, res): Promise<void> => {
  const { ids } = req.body
  if (!ids || !Array.isArray(ids)) {
    res.status(400).json({ error: 'ids array is required' })
    return
  }

  const offers = await prisma.offerLetter.findMany({
    where: { id: { in: ids } }
  })

  let sentCount = 0
  const errors: string[] = []

  for (const offer of offers) {
    if (!offer.email) {
      errors.push(`${offer.name}: no email address`)
      continue
    }
    // The generator names the PDF using internship_id if present, else offer_id
    const docId = offer.internship_id || offer.offer_id
    const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 5000}`
    const pdfUrl = `${backendUrl}/generated/${docId}.pdf`
    const pdfPath = path.join(process.cwd(), `generated/${docId}.pdf`)
    try {
      await transporter.sendMail({
        from: SMTP_FROM(),
        to: offer.email,
        subject: `Your Offer Letter for ${offer.program_type} is Ready!`,
        text: `Dear ${offer.name},\n\nCongratulations on being selected for the ${offer.program_type}.\n\nYou can view and download your offer letter here: ${pdfUrl}\n\nBest regards,\nBrainovision Team`,
        html: `<p>Dear ${offer.name},</p><p>Congratulations on being selected for the <b>${offer.program_type}</b>.</p><p><a href="${pdfUrl}" style="display:inline-block;padding:10px 20px;background:#4F46E5;color:#fff;text-decoration:none;border-radius:6px;">Download Offer Letter</a></p><p style="font-size:12px;color:#888;">Or copy this link: ${pdfUrl}</p><p>Best regards,<br>Brainovision Team</p>`,
        attachments: fs.existsSync(pdfPath) ? [{ filename: `${docId}.pdf`, path: pdfPath }] : []
      })
      await prisma.offerLetter.update({
        where: { id: offer.id },
        data: { status: 'SENT' }
      })
      sentCount++
      console.log(`[EMAIL] Offer letter sent to ${offer.email} | PDF: ${pdfUrl}`)
    } catch (err: any) {
      errors.push(`${offer.email}: ${err.message}`)
      console.error(`[EMAIL] Failed for ${offer.email}:`, err.message)
    }
  }

  res.json({ message: 'Done', sent: sentCount, failed: errors.length, errors })
})

router.post('/offer-letters/:id/revoke', async (req, res) => {
  const { id } = req.params
  const offer = await prisma.offerLetter.update({
    where: { id: Number(id) },
    data: { status: 'REVOKED' }
  })
  res.json(offer)
})

// Bulk delete offer letters
router.delete('/offer-letters/bulk', async (req, res): Promise<void> => {
  const { ids } = req.body
  if (!ids || !Array.isArray(ids)) {
    res.status(400).json({ error: 'ids array is required' })
    return
  }
  try {
    const offers = await prisma.offerLetter.findMany({ where: { id: { in: ids } } })
    for (const offer of offers) {
      const docId = offer.internship_id || offer.offer_id
      const pdfPath = path.join(process.cwd(), `generated/${docId}.pdf`)
      if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath)
    }
    await prisma.offerLetter.deleteMany({ where: { id: { in: ids } } })
    res.json({ message: 'Deleted', count: ids.length })
  } catch (err) {
    res.status(500).json({ error: 'Bulk delete failed' })
  }
})

router.delete('/offer-letters/:id', async (req, res) => {
  const { id } = req.params
  try {
    const offer = await prisma.offerLetter.delete({
      where: { id: Number(id) }
    })
    const docId = offer.internship_id || offer.offer_id
    const pdfPath = path.join(process.cwd(), `generated/${docId}.pdf`)
    if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath)
    res.json(offer)
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete record' })
  }
})


router.get('/certificates', async (req, res) => {
  const certs = await prisma.certificate.findMany({
    orderBy: { createdAt: 'desc' }
  })
  res.json(certs)
})

// Send (or re-send) certificates by IDs
router.post('/certificates/send', async (req, res): Promise<void> => {
  const { ids } = req.body
  if (!ids || !Array.isArray(ids)) {
    res.status(400).json({ error: 'ids array is required' })
    return
  }

  const certs = await prisma.certificate.findMany({
    where: { id: { in: ids } }
  })

  let sentCount = 0
  const errors: string[] = []

  for (const cert of certs) {
    if (!cert.email) {
      errors.push(`${cert.name}: no email address`)
      continue
    }
    // Generator names the PDF using internship_id if present, else certificate_id
    const docId = cert.internship_id || cert.certificate_id
    const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 5000}`
    const pdfUrl = `${backendUrl}/generated/${docId}.pdf`
    const pdfPath = path.join(process.cwd(), `generated/${docId}.pdf`)
    try {
      await transporter.sendMail({
        from: SMTP_FROM(),
        to: cert.email,
        subject: `Your Certificate for ${cert.program_type} is Ready!`,
        text: `Dear ${cert.name},\n\nCongratulations on completing the ${cert.program_type}.\n\nYou can view and download your certificate here: ${pdfUrl}\n\nBest regards,\nBrainovision Team`,
        html: `<p>Dear ${cert.name},</p><p>Congratulations on completing the <b>${cert.program_type}</b>.</p><p><a href="${pdfUrl}" style="display:inline-block;padding:10px 20px;background:#4F46E5;color:#fff;text-decoration:none;border-radius:6px;">Download Certificate</a></p><p style="font-size:12px;color:#888;">Or copy this link: ${pdfUrl}</p><p>Best regards,<br>Brainovision Team</p>`,
        attachments: fs.existsSync(pdfPath) ? [{ filename: `${docId}.pdf`, path: pdfPath }] : []
      })
      sentCount++
      console.log(`[EMAIL] Certificate sent to ${cert.email} | PDF: ${pdfUrl}`)
    } catch (err: any) {
      errors.push(`${cert.email}: ${err.message}`)
      console.error(`[EMAIL] Failed for ${cert.email}:`, err.message)
    }
  }

  res.json({ message: 'Done', sent: sentCount, failed: errors.length, errors })
})

router.post('/certificates/:id/revoke', async (req, res) => {
  const { id } = req.params
  const cert = await prisma.certificate.update({
    where: { id: Number(id) },
    data: { status: 'REVOKED' }
  })
  res.json(cert)
})

// Bulk delete certificates
router.delete('/certificates/bulk', async (req, res): Promise<void> => {
  const { ids } = req.body
  if (!ids || !Array.isArray(ids)) {
    res.status(400).json({ error: 'ids array is required' })
    return
  }
  try {
    const certs = await prisma.certificate.findMany({ where: { id: { in: ids } } })
    for (const cert of certs) {
      const docId = cert.internship_id || cert.certificate_id
      const pdfPath = path.join(process.cwd(), `generated/${docId}.pdf`)
      if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath)
    }
    await prisma.certificate.deleteMany({ where: { id: { in: ids } } })
    res.json({ message: 'Deleted', count: ids.length })
  } catch (err) {
    res.status(500).json({ error: 'Bulk delete failed' })
  }
})

router.delete('/certificates/:id', async (req, res) => {
  const { id } = req.params
  try {
    const cert = await prisma.certificate.delete({
      where: { id: Number(id) }
    })
    const docId = cert.internship_id || cert.certificate_id
    const pdfPath = path.join(process.cwd(), `generated/${docId}.pdf`)
    if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath)
    res.json(cert)
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete record' })
  }
})

router.post('/reset-password', async (req, res): Promise<void> => {
  const { oldPassword, newPassword } = req.body
  const adminId = (req as any).admin.id
  
  const admin = await prisma.admin.findUnique({ where: { id: adminId } })
  if (!admin || !(await bcrypt.compare(oldPassword, admin.password))) {
    res.status(401).json({ error: 'Invalid old password' })
    return
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10)
  await prisma.admin.update({
    where: { id: adminId },
    data: { password: hashedPassword }
  })

  res.json({ message: 'Password updated successfully' })
})

router.post('/templates', upload.fields([
  { name: 'background', maxCount: 1 },
  { name: 'signature', maxCount: 1 },
  { name: 'seal', maxCount: 1 }
]), async (req, res): Promise<void> => {
  const { template_id, name, layout_json, orientation } = req.body
  const files = req.files as { [fieldname: string]: Express.Multer.File[] }

  const backgroundFile = files?.background?.[0]
  const signatureFile = files?.signature?.[0]
  const sealFile = files?.seal?.[0]

  let bgBase64 = ''
  let signatureBase64 = ''
  let sealBase64 = ''

  if (backgroundFile) {
    const bgData = fs.readFileSync(backgroundFile.path)
    bgBase64 = `data:${backgroundFile.mimetype};base64,${bgData.toString('base64')}`
    fs.unlinkSync(backgroundFile.path)
  }

  if (signatureFile) {
    const sigData = fs.readFileSync(signatureFile.path)
    signatureBase64 = `data:${signatureFile.mimetype};base64,${sigData.toString('base64')}`
    fs.unlinkSync(signatureFile.path)
  }

  if (sealFile) {
    const sealData = fs.readFileSync(sealFile.path)
    sealBase64 = `data:${sealFile.mimetype};base64,${sealData.toString('base64')}`
    fs.unlinkSync(sealFile.path)
  }

  try {
    const parsedLayout = typeof layout_json === 'string' ? JSON.parse(layout_json) : layout_json
    const template = await prisma.template.create({
      data: {
        template_id: template_id || `TMPL-${Date.now()}`,
        name,
        background_image: bgBase64 || '/mock-bg.jpg',
        signature_image: signatureBase64 || null,
        seal_image: sealBase64 || null,
        layout_json: parsedLayout,
        orientation: orientation || 'LANDSCAPE'
      }
    })
    res.json(template)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to create template' })
  }
})

router.put('/templates/:id', upload.fields([
  { name: 'background', maxCount: 1 },
  { name: 'signature', maxCount: 1 },
  { name: 'seal', maxCount: 1 }
]), async (req, res): Promise<void> => {
  const { id } = req.params
  const { template_id, name, layout_json, orientation } = req.body
  const files = req.files as { [fieldname: string]: Express.Multer.File[] }

  const backgroundFile = files?.background?.[0]
  const signatureFile = files?.signature?.[0]
  const sealFile = files?.seal?.[0]

  const updateData: any = {
    name,
    orientation: orientation || 'LANDSCAPE'
  }

  if (template_id) updateData.template_id = template_id

  if (backgroundFile) {
    const bgData = fs.readFileSync(backgroundFile.path)
    updateData.background_image = `data:${backgroundFile.mimetype};base64,${bgData.toString('base64')}`
    fs.unlinkSync(backgroundFile.path)
  }

  if (signatureFile) {
    const sigData = fs.readFileSync(signatureFile.path)
    updateData.signature_image = `data:${signatureFile.mimetype};base64,${sigData.toString('base64')}`
    fs.unlinkSync(signatureFile.path)
  }

  if (sealFile) {
    const sealData = fs.readFileSync(sealFile.path)
    updateData.seal_image = `data:${sealFile.mimetype};base64,${sealData.toString('base64')}`
    fs.unlinkSync(sealFile.path)
  }

  if (layout_json) {
    updateData.layout_json = typeof layout_json === 'string' ? JSON.parse(layout_json) : layout_json
  }

  try {
    const template = await prisma.template.update({
      where: { id: Number(id) },
      data: updateData
    })
    res.json(template)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to update template' })
  }
})

router.delete('/templates/:id', async (req, res): Promise<void> => {
  const { id } = req.params
  try {
    const templateId = Number(id)
    await prisma.template.delete({
      where: { id: templateId }
    })
    res.json({ message: 'Template deleted' })
  } catch (err) {
    console.error('Failed to delete template:', err)
    res.status(500).json({ error: 'Failed to delete template' })
  }
})

router.post('/templates/:id/set-default', async (req, res): Promise<void> => {
  const { id } = req.params
  const { type } = req.body // 'certificate' or 'offer_letter'

  if (type !== 'certificate' && type !== 'offer_letter') {
    res.status(400).json({ error: 'Type must be certificate or offer_letter' })
    return
  }

  const templateId = Number(id)
  
  try {
    if (type === 'certificate') {
      await prisma.template.updateMany({
        data: { is_default_certificate: false }
      })
      const updated = await prisma.template.update({
        where: { id: templateId },
        data: { is_default_certificate: true }
      })
      res.json(updated)
    } else {
      await prisma.template.updateMany({
        data: { is_default_offer_letter: false }
      })
      const updated = await prisma.template.update({
        where: { id: templateId },
        data: { is_default_offer_letter: true }
      })
      res.json(updated)
    }
  } catch (err) {
    console.error('Failed to set default template:', err)
    res.status(500).json({ error: 'Failed to set default template' })
  }
})

router.post('/offer-letters/generate-certificates', async (req, res) => {
  const { ids, template_id } = req.body
  const offers = await prisma.offerLetter.findMany({
    where: { id: { in: ids } }
  })

  let generatedCount = 0
  for (const offer of offers) {
    try {
      let templateId = template_id
      let template = null

      if (templateId) {
        template = await prisma.template.findUnique({ where: { template_id: templateId } })
      } else {
        template = await prisma.template.findFirst({ where: { is_default_certificate: true } })
        if (!template) {
          template = await prisma.template.findUnique({ where: { template_id: 'MOCK_MALE_01' } })
        }
      }
      
      if (!template) {
         template = await prisma.template.findFirst()
      }
      if (!template) continue

      const programCode = (offer.program_type ? String(offer.program_type).substring(0,3).toUpperCase() : 'GEN')
      const serial = String(generatedCount + 1).padStart(4, '0')
      const uniqueSuffix = Math.floor(Math.random() * 10000).toString().padStart(4, '0')
      const certId = `BRV-${dayjs().year()}-${programCode}-${serial}-${uniqueSuffix}`

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
      }

      const pdfPath = await generateCertificatePDF(certData, template, undefined, undefined)
      
      await prisma.certificate.create({
        data: certData
      })
      // NOTE: Email is NOT sent here. Admin must send emails manually from the Certificates section.
      console.log(`[CERT] Generated certificate for ${offer.name} → ${certData.internship_id || certId}`)
      generatedCount++
    } catch (err) {
      console.error('Error generating cert for offer:', err)
    }
  }
  
  res.json({ message: 'Success', generated: generatedCount })
})

export default router
