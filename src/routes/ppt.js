const express = require('express');
const multer = require('multer');
const { convert } = require('../controllers/pptController');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
  fileFilter: (req, file, cb) => {
    const ext = file.originalname.split('.').pop().toLowerCase();
    if (ext !== 'pptx') {
      return cb(new Error('Hanya file .pptx yang diterima.'));
    }
    cb(null, true);
  },
});

router.post('/convert', upload.single('file'), convert);

module.exports = router;
