import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'

export function authenticateAdmin(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization
  if (!authHeader) {
    res.status(401).json({ error: 'Missing authorization header' })
    return
  }

  const token = authHeader.split(' ')[1]
  try {
    const secret = process.env.JWT_SECRET || 'fallback_secret';
    const payload = jwt.verify(token as string, secret)
    ;(req as any).user = payload
    next()
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' })
  }
}
