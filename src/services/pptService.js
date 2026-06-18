const CloudConvert = require('cloudconvert');
const https = require('https');
const { v4: uuidv4 } = require('uuid');
const { supabaseAdmin } = require('../config/database');

const SLIDES_BUCKET = 'slides';

async function ensureSlidesBucket() {
  const { data: buckets } = await supabaseAdmin.storage.listBuckets();
  const exists = buckets?.some(b => b.name === SLIDES_BUCKET);
  if (!exists) {
    await supabaseAdmin.storage.createBucket(SLIDES_BUCKET, { public: true });
  }
}

function downloadBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function convertPptxToSlides(fileBuffer) {
  const cloudConvert = new CloudConvert(process.env.CLOUDCONVERT_API_KEY);
  const id = uuidv4();

  await ensureSlidesBucket();

  // Buat job: PPTX → PDF (LibreOffice) → PNG per halaman (ImageMagick)
  let job = await cloudConvert.jobs.create({
    tasks: {
      'upload': {
        operation: 'import/upload'
      },
      'to-pdf': {
        operation: 'convert',
        input: 'upload',
        output_format: 'pdf',
        engine: 'libreoffice'
      },
      'to-png': {
        operation: 'convert',
        input: 'to-pdf',
        output_format: 'png',
        engine: 'imagemagick',
        pixel_density: 150,
        fit: 'max',
        width: 1280,
        height: 960
      },
      'export': {
        operation: 'export/url',
        input: 'to-png'
      }
    }
  });

  // Upload file PPTX ke CloudConvert
  const uploadTask = job.tasks.find(t => t.name === 'upload');
  await cloudConvert.tasks.upload(uploadTask, fileBuffer, 'presentation.pptx');

  // Tunggu sampai semua task selesai (timeout 3 menit)
  job = await cloudConvert.jobs.wait(job.id);

  // Ambil hasil export
  const exportTask = job.tasks.find(t => t.name === 'export' && t.status === 'finished');
  if (!exportTask?.result?.files?.length) {
    throw new Error('Konversi CloudConvert selesai tapi tidak ada file PNG yang dihasilkan.');
  }

  // Urutkan file slide berdasarkan nama (kronologis)
  const files = [...exportTask.result.files].sort((a, b) =>
    a.filename.localeCompare(b.filename, undefined, { numeric: true, sensitivity: 'base' })
  );

  // Download setiap PNG dan upload ke Supabase bucket 'slides'
  const slideUrls = [];
  for (let i = 0; i < files.length; i++) {
    const buffer = await downloadBuffer(files[i].url);
    const supabasePath = `${id}/slide-${i + 1}.png`;

    const { error } = await supabaseAdmin.storage
      .from(SLIDES_BUCKET)
      .upload(supabasePath, buffer, {
        contentType: 'image/png',
        cacheControl: '3600',
        upsert: false
      });

    if (error) throw new Error(`Upload slide ${i + 1} ke Supabase gagal: ${error.message}`);

    const { data: urlData } = supabaseAdmin.storage
      .from(SLIDES_BUCKET)
      .getPublicUrl(supabasePath);

    slideUrls.push(urlData.publicUrl);
  }

  return { id, slideUrls, slideCount: slideUrls.length };
}

module.exports = { convertPptxToSlides };
