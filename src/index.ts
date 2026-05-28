import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'

import adminRoutes from './routes/admin'
import publicRoutes from './routes/public'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 5000

app.use(cors())
app.use(express.json({ limit: '50mb' }))

// Ensure directories exist
const uploadDir = path.join(__dirname, '../uploads')
const generatedDir = path.join(__dirname, '../generated')
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true })
if (!fs.existsSync(generatedDir)) fs.mkdirSync(generatedDir, { recursive: true })

// Serve static files for verification templates and generated PDFs
app.use('/public', express.static(path.join(__dirname, '../public'))) // e.g. for mock-bg.jpg
app.use('/generated', express.static(generatedDir))

// Routes
app.use('/api/admin', adminRoutes)
app.use('/api/public', publicRoutes)

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})