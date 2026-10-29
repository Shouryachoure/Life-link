import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authenticate, AuthRequest } from '../middleware/auth';
import { Role } from '@prisma/client';

const router = Router();

// Ensure uploads folder exists safely outside web root
const uploadDir = path.resolve(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// In-memory document ownership registry for access authorization
interface DocumentRecord {
  filename: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedByUserId: string;
  uploadedByUserRole: string;
  uploadedAt: Date;
}
export const documentRegistry = new Map<string, DocumentRecord>();

// Strict whitelist of permitted identity and clinical document MIME types
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.pdf']);

// Multer disk storage config with sanitized filenames
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const rawExt = path.extname(file.originalname).toLowerCase();
    const ext = ALLOWED_EXTENSIONS.has(rawExt) ? rawExt : '.bin';
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `doc-${uniqueSuffix}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB maximum file size limit
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_MIME_TYPES.has(file.mimetype) || !ALLOWED_EXTENSIONS.has(ext)) {
      return cb(new Error('INVALID_FILE_TYPE: Only JPEG, PNG, WebP, and PDF documents are allowed.'));
    }
    cb(null, true);
  },
});

// POST /api/upload - Handle single document upload with authentication & validation
router.post('/', authenticate, (req: AuthRequest, res: Response) => {
  upload.single('file')(req as any, res as any, (err: any) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          status: 'fail',
          code: 'FILE_TOO_LARGE',
          message: 'File size exceeds 5 MB limit.',
        });
      }
      return res.status(400).json({
        status: 'fail',
        code: 'INVALID_FILE_TYPE',
        message: err.message || 'File upload failed.',
      });
    }

    if (!req.file) {
      return res.status(400).json({ status: 'fail', message: 'No file uploaded.' });
    }

    // Record document ownership in registry
    const record: DocumentRecord = {
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      uploadedByUserId: req.user!.id,
      uploadedByUserRole: req.user!.role,
      uploadedAt: new Date(),
    };
    documentRegistry.set(req.file.filename, record);

    const fileUrl = `/uploads/${req.file.filename}`;
    return res.status(201).json({
      status: 'success',
      filename: req.file.filename,
      fileUrl,
      sizeBytes: req.file.size,
      mimeType: req.file.mimetype,
    });
  });
});

/**
 * Access-controlled document retrieval handler.
 * Prevents unauthorized public browsing, prevents directory traversal,
 * and restricts access to document owners, organization admins, or Super/Verification Admins.
 */
export async function handleSecureDocumentDownload(req: AuthRequest, res: Response) {
  if (!req.user) {
    return res.status(401).json({ status: 'fail', message: 'Authentication required to access documents.' });
  }

  const rawFilename = req.params.filename || (req.params as any)[0] || (req.query.file as string) || '';
  const decodedUrl = decodeURIComponent(req.originalUrl || rawFilename);
  if (!rawFilename) {
    return res.status(400).json({ status: 'fail', message: 'Filename parameter is required.' });
  }

  // Path Traversal Mitigation: Strip path separators and detect path traversal tokens
  if (
    rawFilename.includes('..') ||
    rawFilename.includes('/') ||
    rawFilename.includes('\\') ||
    decodedUrl.includes('..') ||
    (req.query.file && String(req.query.file).includes('..'))
  ) {
    return res.status(400).json({ status: 'fail', message: 'Invalid filename: Path traversal is blocked.' });
  }

  const safeFilename = path.basename(rawFilename);
  const filePath = path.join(uploadDir, safeFilename);

  // Verify file stays strictly inside uploadDir
  if (!filePath.startsWith(uploadDir)) {
    return res.status(403).json({ status: 'fail', message: 'Access denied: Path escape detected.' });
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ status: 'fail', message: 'Document not found.' });
  }

  // Authorization Check:
  // 1. Super Admin and Verification Staff have global access to review submitted documents
  const isSuperOrVerifier = req.user.role === Role.SUPER_ADMIN || req.user.role === 'VERIFICATION_ADMIN';
  if (!isSuperOrVerifier) {
    // 2. Check if the document was uploaded by this user
    const docMeta = documentRegistry.get(safeFilename);
    const isOwner = docMeta ? docMeta.uploadedByUserId === req.user.id : false;

    if (!isOwner) {
      return res.status(403).json({
        status: 'fail',
        code: 'UNAUTHORIZED_DOCUMENT_ACCESS',
        message: 'Forbidden: You do not have permission to access this private document.',
      });
    }
  }

  // Set hardened security headers for document delivery
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('Content-Disposition', `inline; filename="${safeFilename}"`);

  // Stream the file safely
  return res.sendFile(filePath);
}

// GET /api/upload/:filename - Access-controlled document retrieval endpoint
router.get('/:filename', authenticate, handleSecureDocumentDownload);

export default router;
