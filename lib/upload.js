const multer = require('multer');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');

// Store uploads OUTSIDE the project directory so uploaded files cannot be
// executed or accessed via the static web root. Configurable via UPLOAD_DIR.
const UPLOAD_ROOT = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(os.homedir(), 'ltq-uploads');

const PHOTO_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const VIDEO_MIME = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo', 'video/avi'];

// Derive extension from the validated MIME type, not the original filename —
// prevents extension spoofing (e.g. malicious.php renamed to photo.jpg).
const MIME_EXT = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
  'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm',
  'video/x-msvideo': '.avi', 'video/avi': '.avi',
  'application/pdf': '.pdf'
};

function makeStorage(subdir) {
  const dir = path.join(UPLOAD_ROOT, subdir);
  fs.mkdirSync(dir, { recursive: true });
  return multer.diskStorage({
    destination: (req, file, cb) => cb(null, dir),
    filename: (req, file, cb) => {
      const ext  = MIME_EXT[file.mimetype] || path.extname(file.originalname).toLowerCase();
      const stem = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      cb(null, `${stem}${ext}`);
    }
  });
}

const photoFilter = (req, file, cb) =>
  PHOTO_MIME.includes(file.mimetype)
    ? cb(null, true)
    : cb(new Error('Photo must be JPG, PNG, or WebP.'));

const videoFilter = (req, file, cb) =>
  VIDEO_MIME.includes(file.mimetype)
    ? cb(null, true)
    : cb(new Error('Video must be MP4, MOV, WebM, or AVI.'));

// Single photo upload (field name: "file"), 8 MB
const photoUpload = multer({
  storage: makeStorage('photos'),
  fileFilter: photoFilter,
  limits: { fileSize: 8 * 1024 * 1024 }
}).single('file');

// Single video upload (field name: "file"), 300 MB
const videoUpload = multer({
  storage: makeStorage('videos'),
  fileFilter: videoFilter,
  limits: { fileSize: 300 * 1024 * 1024 }
}).single('file');

// Event media: accepts both photos AND videos, routes to correct subdir automatically, 300 MB
const eventMediaUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const subdir = VIDEO_MIME.includes(file.mimetype) ? 'videos' : 'photos';
      const dir = path.join(UPLOAD_ROOT, subdir);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext  = MIME_EXT[file.mimetype] || path.extname(file.originalname).toLowerCase();
      const stem = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      cb(null, `${stem}${ext}`);
    }
  }),
  fileFilter: (req, file, cb) =>
    [...PHOTO_MIME, ...VIDEO_MIME].includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error('File must be JPG, PNG, WebP, MP4, MOV, WebM, or AVI.')),
  limits: { fileSize: 300 * 1024 * 1024 }
}).single('file');

// Registration: photo + video fields, combined 300 MB limit
const registrationUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const subdir = file.fieldname === 'video' ? 'videos' : 'photos';
      const dir = path.join(UPLOAD_ROOT, subdir);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext  = MIME_EXT[file.mimetype] || path.extname(file.originalname).toLowerCase();
      const stem = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      cb(null, `${stem}${ext}`);
    }
  }),
  fileFilter: (req, file, cb) => {
    const allowed = file.fieldname === 'video' ? VIDEO_MIME : PHOTO_MIME;
    allowed.includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error(file.fieldname === 'video'
          ? 'Video must be MP4, MOV, WebM, or AVI.'
          : 'Photo must be JPG, PNG, or WebP.'));
  },
  limits: { fileSize: 300 * 1024 * 1024 }
}).fields([{ name: 'photo', maxCount: 1 }, { name: 'video', maxCount: 1 }]);

// Single document upload (field name: "file"), 20 MB — PDF only
const documentUpload = multer({
  storage: makeStorage('documents'),
  fileFilter: (req, file, cb) =>
    file.mimetype === 'application/pdf'
      ? cb(null, true)
      : cb(new Error('File must be a PDF.')),
  limits: { fileSize: 20 * 1024 * 1024 }
}).single('file');

module.exports = { photoUpload, videoUpload, eventMediaUpload, registrationUpload, documentUpload, UPLOAD_ROOT, PHOTO_MIME, VIDEO_MIME };
