const multer     = require('multer');
const path       = require('path');
const fs         = require('fs');
const os         = require('os');
const cloudinary = require('cloudinary').v2;

const { getCloudinaryConfig } = require('./integrations');

// Local fallback root — used whenever Cloudinary isn't configured. Stored
// OUTSIDE the project directory so uploaded files cannot be executed or
// accessed via the static web root. Configurable via UPLOAD_DIR.
const UPLOAD_ROOT = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(os.homedir(), 'ltq-uploads');

const PHOTO_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const VIDEO_MIME = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo', 'video/avi'];
const DOC_MIME   = ['application/pdf'];

// Derive extension from the validated MIME type, not the original filename —
// prevents extension spoofing (e.g. malicious.php renamed to photo.jpg).
const MIME_EXT = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
  'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm',
  'video/x-msvideo': '.avi', 'video/avi': '.avi',
  'application/pdf': '.pdf'
};

// ── Real content-type detection (magic bytes) ────────────────────────────
// multer's fileFilter only sees the Content-Type the uploader's own request
// claims — that's attacker-controlled and trivially spoofed with a script.
// This inspects the actual file bytes so a renamed/relabeled file can't pass
// itself off as an image or video. Hand-rolled (no extra dependency) since
// the set of formats we accept is small and fixed.
function detectRealType(buffer) {
  if (!buffer || buffer.length < 12) return null;

  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'image/jpeg';

  if (buffer.length >= 8 && buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])))
    return 'image/png';

  if (buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP')
    return 'image/webp';

  if (buffer.slice(0, 4).toString('ascii') === '%PDF') return 'application/pdf';

  // MP4 / MOV: an 'ftyp' box at byte offset 4
  if (buffer.slice(4, 8).toString('ascii') === 'ftyp') {
    const brand = buffer.slice(8, 12).toString('ascii').trim();
    return brand === 'qt' ? 'video/quicktime' : 'video/mp4';
  }

  // WebM/Matroska container (EBML header)
  if (buffer.slice(0, 4).equals(Buffer.from([0x1A, 0x45, 0xDF, 0xA3]))) return 'video/webm';

  if (buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'AVI ')
    return 'video/x-msvideo';

  return null;
}

function allowedTypesFor(subdir) {
  if (subdir === 'photos')    return PHOTO_MIME;
  if (subdir === 'videos')    return VIDEO_MIME;
  if (subdir === 'documents') return DOC_MIME;
  return [...PHOTO_MIME, ...VIDEO_MIME];
}

function randomStem() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ── Persist a single buffered file to Cloudinary (if configured) or local disk ──
async function persistFile({ buffer, mimetype, originalname, subdir }) {
  const detected = detectRealType(buffer);
  if (!detected || !allowedTypesFor(subdir).includes(detected)) {
    const err = new Error('The uploaded file does not match its declared type and was rejected.');
    err.status = 400;
    throw err;
  }

  const stem = randomStem();
  const ext  = MIME_EXT[detected] || MIME_EXT[mimetype] || path.extname(originalname || '').toLowerCase();

  const cfg = await getCloudinaryConfig();
  if (cfg.configured) {
    cloudinary.config({ cloud_name: cfg.cloudName, api_key: cfg.apiKey, api_secret: cfg.apiSecret });
    const resourceType = subdir === 'videos' ? 'video' : subdir === 'documents' ? 'raw' : 'image';
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: `ltq-uploads/${subdir}`, public_id: stem, resource_type: resourceType, overwrite: false },
        (err, res) => (err ? reject(err) : resolve(res))
      );
      stream.end(buffer);
    });
    return { url: result.secure_url, isExternal: true };
  }

  const dir = path.join(UPLOAD_ROOT, subdir);
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${stem}${ext}`;
  fs.writeFileSync(path.join(dir, filename), buffer);
  return { url: `/uploads/${subdir}/${filename}`, isExternal: false };
}

// ── Best-effort delete — handles both local paths and Cloudinary URLs ────
async function removeFile(url) {
  if (!url) return;
  try {
    if (url.startsWith('/uploads/')) {
      const absPath = path.resolve(UPLOAD_ROOT, url.replace(/^\/uploads\//, ''));
      if (absPath.startsWith(path.resolve(UPLOAD_ROOT) + path.sep)) {
        await fs.promises.unlink(absPath).catch(() => {});
      }
      return;
    }
    if (url.includes('cloudinary.com')) {
      const cfg = await getCloudinaryConfig();
      if (!cfg.configured) return;
      cloudinary.config({ cloud_name: cfg.cloudName, api_key: cfg.apiKey, api_secret: cfg.apiSecret });
      const match = url.match(/\/upload\/(?:v\d+\/)?(.+?)\.[a-zA-Z0-9]+$/);
      if (!match) return;
      const publicId     = match[1];
      const resourceType = publicId.includes('/videos/') ? 'video' : publicId.includes('/documents/') ? 'raw' : 'image';
      await cloudinary.uploader.destroy(publicId, { resource_type: resourceType }).catch(() => {});
    }
  } catch { /* cleanup is best-effort; never let it break the caller */ }
}

// ── Middleware: persist every buffered file on req.file / req.files ──────
// subdirFor(file) decides the storage subfolder per file. Attaches `.url`
// to each file object so routes can use it exactly like they used to build
// `/uploads/<subdir>/<filename>` by hand. Rolls back any files that were
// already persisted in this request if a later one in the same batch fails.
function persistUploads(subdirFor) {
  return async (req, res, next) => {
    const files = [];
    if (req.file) files.push(req.file);
    if (req.files) {
      if (Array.isArray(req.files)) files.push(...req.files);
      else Object.values(req.files).forEach((arr) => files.push(...arr));
    }
    if (!files.length) return next();

    const persistedUrls = [];
    try {
      for (const file of files) {
        const subdir = subdirFor(file);
        const { url } = await persistFile({
          buffer: file.buffer, mimetype: file.mimetype, originalname: file.originalname, subdir
        });
        file.url    = url;
        file.buffer = null; // release memory now that it's been written out
        persistedUrls.push(url);
      }
      next();
    } catch (err) {
      await Promise.all(persistedUrls.map((u) => removeFile(u)));
      next(err);
    }
  };
}

function makeStorage() {
  return multer.memoryStorage();
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
  storage: makeStorage(),
  fileFilter: photoFilter,
  limits: { fileSize: 8 * 1024 * 1024 }
}).single('file');

// Single video upload (field name: "file"), 300 MB
const videoUpload = multer({
  storage: makeStorage(),
  fileFilter: videoFilter,
  limits: { fileSize: 300 * 1024 * 1024 }
}).single('file');

// Event media: accepts both photos AND videos, routed to the correct subdir at persist time, 300 MB
const eventMediaUpload = multer({
  storage: makeStorage(),
  fileFilter: (req, file, cb) =>
    [...PHOTO_MIME, ...VIDEO_MIME].includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error('File must be JPG, PNG, WebP, MP4, MOV, WebM, or AVI.')),
  limits: { fileSize: 300 * 1024 * 1024 }
}).single('file');

// Registration: photo + video fields, combined 300 MB limit
const registrationUpload = multer({
  storage: makeStorage(),
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
  storage: makeStorage(),
  fileFilter: (req, file, cb) =>
    file.mimetype === 'application/pdf'
      ? cb(null, true)
      : cb(new Error('File must be a PDF.')),
  limits: { fileSize: 20 * 1024 * 1024 }
}).single('file');

// Pre-built persist middlewares, one per upload config above.
const persistPhotos      = persistUploads(() => 'photos');
const persistVideos      = persistUploads(() => 'videos');
const persistEventMedia  = persistUploads((f) => VIDEO_MIME.includes(f.mimetype) ? 'videos' : 'photos');
const persistRegistration = persistUploads((f) => f.fieldname === 'video' ? 'videos' : 'photos');
const persistDocument    = persistUploads(() => 'documents');

module.exports = {
  photoUpload, videoUpload, eventMediaUpload, registrationUpload, documentUpload,
  persistPhotos, persistVideos, persistEventMedia, persistRegistration, persistDocument,
  removeFile, UPLOAD_ROOT, PHOTO_MIME, VIDEO_MIME
};
