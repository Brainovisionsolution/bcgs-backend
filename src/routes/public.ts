import express from 'express'
import { prisma } from '../db'
import dayjs from 'dayjs'
import { calculateDuration } from '../utils'

const router = express.Router()

router.get('/verify/:certificate_id', async (req, res): Promise<void> => {
  const { certificate_id } = req.params

  try {
    let documentType = 'CERTIFICATE';
    let doc: any = await prisma.certificate.findFirst({
      where: { 
        OR: [
          { certificate_id: certificate_id },
          { internship_id: certificate_id }
        ]
      }
    });

    if (!doc) {
      doc = await prisma.offerLetter.findFirst({
        where: { 
          OR: [
            { offer_id: certificate_id },
            { internship_id: certificate_id }
          ]
        }
      });
      if (doc) documentType = 'OFFER_LETTER';
    }

    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    const durationText = doc.duration ? doc.duration : calculateDuration(doc.start_date, doc.end_date)
    const programFormatted = `${durationText} ${doc.program_type} Program`

    res.json({
      document_id: certificate_id,
      document_type: documentType,
      name: doc.name,
      college: doc.college,
      course: doc.course,
      program: programFormatted,
      start_date: dayjs(doc.start_date).format('DD MMM YYYY'),
      end_date: dayjs(doc.end_date).format('DD MMM YYYY'),
      issue_date: dayjs(doc.issue_date).format('DD MMM YYYY'),
      status: doc.status,
      pdf_url: `/generated/${certificate_id}.pdf`
    })
  } catch (error) {
    res.status(500).json({ error: 'Server error during verification' })
  }
})

export default router
