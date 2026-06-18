const { convertPptxToSlides } = require('../services/pptService');

async function convert(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: 'File PPTX tidak ditemukan dalam request.' });
  }

  try {
    const result = await convertPptxToSlides(req.file.buffer);
    res.json({
      success: true,
      id: result.id,
      slideUrls: result.slideUrls,
      slideCount: result.slideCount,
    });
  } catch (err) {
    console.error('[pptController] Konversi gagal:', err.message);
    res.status(500).json({ error: err.message || 'Konversi PPTX gagal.' });
  }
}

module.exports = { convert };
