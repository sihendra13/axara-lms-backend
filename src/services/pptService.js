const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { supabaseAdmin } = require('../config/database');

const execAsync = promisify(exec);

const SLIDES_BUCKET = 'slides';

async function ensureSlidesBucket() {
  const { data: buckets } = await supabaseAdmin.storage.listBuckets();
  const exists = buckets?.some(b => b.name === SLIDES_BUCKET);
  if (!exists) {
    await supabaseAdmin.storage.createBucket(SLIDES_BUCKET, { public: true });
  }
}

async function convertPptxToSlides(fileBuffer) {
  const id = uuidv4();
  const tmpDir = '/tmp';
  const pptxPath = path.join(tmpDir, `${id}.pptx`);
  const pdfPath = path.join(tmpDir, `${id}.pdf`);
  const slidePrefix = path.join(tmpDir, `${id}_slide`);

  try {
    await ensureSlidesBucket();

    // Tulis PPTX ke file sementara
    fs.writeFileSync(pptxPath, fileBuffer);

    // Step 1: PPTX → PDF via LibreOffice headless
    await execAsync(
      `libreoffice --headless --convert-to pdf --outdir ${tmpDir} ${pptxPath}`,
      {
        timeout: 90000,
        env: { ...process.env, HOME: '/tmp/libreoffice-home' }
      }
    );

    if (!fs.existsSync(pdfPath)) {
      throw new Error('Konversi PPTX ke PDF gagal — file PDF tidak terbuat.');
    }

    // Step 2: PDF → PNG per halaman via pdftoppm
    await execAsync(
      `pdftoppm -r 150 -png ${pdfPath} ${slidePrefix}`,
      { timeout: 120000 }
    );

    // Kumpulkan file slide PNG yang dihasilkan
    const allFiles = fs.readdirSync(tmpDir);
    const slideFiles = allFiles
      .filter(f => f.startsWith(`${id}_slide`) && f.endsWith('.png'))
      .sort((a, b) => {
        const numA = parseInt(a.match(/(\d+)\.png$/)?.[1] || '0');
        const numB = parseInt(b.match(/(\d+)\.png$/)?.[1] || '0');
        return numA - numB;
      });

    if (slideFiles.length === 0) {
      throw new Error('Tidak ada slide PNG yang dihasilkan dari konversi.');
    }

    // Upload tiap slide ke Supabase Storage
    const slideUrls = [];
    for (let i = 0; i < slideFiles.length; i++) {
      const slideFile = slideFiles[i];
      const slidePath = path.join(tmpDir, slideFile);
      const slideBuffer = fs.readFileSync(slidePath);
      const supabasePath = `${id}/slide-${i + 1}.png`;

      const { error } = await supabaseAdmin.storage
        .from(SLIDES_BUCKET)
        .upload(supabasePath, slideBuffer, {
          contentType: 'image/png',
          cacheControl: '3600',
          upsert: false
        });

      if (error) throw new Error(`Upload slide ${i + 1} gagal: ${error.message}`);

      const { data: urlData } = supabaseAdmin.storage
        .from(SLIDES_BUCKET)
        .getPublicUrl(supabasePath);

      slideUrls.push(urlData.publicUrl);
    }

    return { id, slideUrls, slideCount: slideUrls.length };

  } finally {
    // Bersihkan semua file sementara
    try {
      const allFiles = fs.readdirSync(tmpDir);
      allFiles
        .filter(f => f.startsWith(id))
        .forEach(f => {
          try { fs.unlinkSync(path.join(tmpDir, f)); } catch {}
        });
    } catch {}
  }
}

module.exports = { convertPptxToSlides };
