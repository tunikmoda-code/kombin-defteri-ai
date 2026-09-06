const express = require('express');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const FASHN_API = 'https://api.fashn.ai/v1';

app.use(express.json({ limit: '50mb' }));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOW_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.static(__dirname));

const sleep = ms => new Promise(r => setTimeout(r, ms));

app.post('/api/tryon', async (req, res) => {
  try {
    const { modelImage, productImage, category, itemName } = req.body || {};

    if (!process.env.FASHN_API_KEY)
      return res.status(500).json({ error: 'FASHN_API_KEY ayarlanmamış. .env dosyasına API anahtarını ekle.' });

    if (!modelImage || !productImage)
      return res.status(400).json({ error: 'Manken fotoğrafı ve ürün fotoğrafı gerekli.' });

    const prompt = [
      'Put the uploaded fashion product onto the person naturally.',
      `Product category: ${category || 'fashion item'}.`,
      `Product name: ${itemName || 'fashion item'}.`,
      "Preserve the person's identity, body proportions, pose, lighting and background.",
      "Keep the product's color, material, pattern, logo and shape faithful to the reference.",
      'Make the result photorealistic and commercially clean.'
    ].join(' ');

    const run = await fetch(`${FASHN_API}/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.FASHN_API_KEY}`
      },
      body: JSON.stringify({
        model_name: 'tryon-max',
        inputs: {
          model_image: modelImage,
          product_image: productImage,
          prompt,
          output_format: 'jpeg',
          return_base64: true,
          generation_mode: process.env.FASHN_GENERATION_MODE || 'balanced',
          resolution: process.env.FASHN_RESOLUTION || '1k',
          num_images: 1
        }
      })
    });

    const runText = await run.text();
    let runData = {};
    try { runData = JSON.parse(runText); } catch (_) {}

    if (!run.ok || !runData.id) {
      return res.status(run.status || 502).json({
        error: runData.error?.message || runData.message || runData.error || `FASHN HTTP ${run.status}`
      });
    }

    const started = Date.now();
    while (Date.now() - started < 180000) {
      await sleep(2500);

      const statusRes = await fetch(`${FASHN_API}/status/${runData.id}`, {
        headers: { 'Authorization': `Bearer ${process.env.FASHN_API_KEY}` }
      });

      const statusText = await statusRes.text();
      let status = {};
      try { status = JSON.parse(statusText); } catch (_) {}

      if (status.status === 'completed') {
        const output = Array.isArray(status.output) ? status.output[0] : null;
        if (!output) throw new Error('AI çıktı üretmedi.');
        return res.json({ image: output });
      }

      if (status.status === 'failed') {
        const err = status.error;
        throw new Error((err && typeof err === 'object' ? err.message : err) || 'FASHN üretimi başarısız.');
      }

      if (!['starting', 'in_queue', 'processing'].includes(status.status))
        throw new Error(`Beklenmeyen AI durumu: ${status.status || 'bilinmiyor'}`);
    }

    throw new Error('AI işlemi 180 saniyede tamamlanmadı.');
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Sunucu hatası.' });
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'kombin-defteri-ai' }));

app.listen(PORT, () => console.log(`Kombin Defteri AI: http://localhost:${PORT}`));
