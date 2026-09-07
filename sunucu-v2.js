const express = require('express');
const app = express();

const PORT = process.env.PORT || 3000;
const HF_SPACE = 'https://yisol-idm-vton.hf.space';

app.use(express.json({ limit: '50mb' }));

app.use((req, res, next) => {
  res.setHeader(
    'Access-Control-Allow-Origin',
    process.env.ALLOW_ORIGIN || '*'
  );
  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET,POST,OPTIONS'
  );
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization'
  );

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});

app.use(express.static(__dirname));

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function hfHeaders() {
  if (process.env.HF_TOKEN) {
    return {
      Authorization: `Bearer ${process.env.HF_TOKEN}`
    };
  }

  return {};
}

function dataUriToBlob(data) {
  const match = /^data:([^;,]+)?(?:;base64)?,(.*)$/s.exec(data || '');

  if (!match) {
    throw new Error('Geçersiz görsel verisi.');
  }

  const isBase64 = /;base64,/.test(data);

  return new Blob(
    [
      Buffer.from(
        match[2],
        isBase64 ? 'base64' : 'utf8'
      )
    ],
    {
      type: match[1] || 'image/jpeg'
    }
  );
}


/*
 * HUGGING FACE GÖRSEL YÜKLEME
 *
 * Gradio sürümüne göre:
 *
 * /gradio_api/upload
 *
 * veya eski:
 *
 * /upload
 *
 * kullanılabiliyor.
 *
 * Önce yeni adres denenir.
 * 404 gelirse eski adres denenir.
 */

async function uploadImage(image) {

  // Eğer zaten internet üzerindeki bir görselse
  // tekrar yüklemeye gerek yok.
  if (
    typeof image === 'string' &&
    /^https?:\/\//i.test(image)
  ) {
    return image;
  }

  let blob;

  if (
    typeof image === 'string' &&
    image.startsWith('data:')
  ) {
    blob = dataUriToBlob(image);
  } else {
    blob = new Blob(
      [
        Buffer.from(image)
      ],
      {
        type: 'image/jpeg'
      }
    );
  }

  const endpoints = [
    '/gradio_api/upload',
    '/upload'
  ];

  let lastError = '';

  for (const endpoint of endpoints) {

    try {

      const form = new FormData();

      form.append(
        'files',
        blob,
        'image.jpg'
      );

      const response = await fetch(
        `${HF_SPACE}${endpoint}`,
        {
          method: 'POST',
          headers: hfHeaders(),
          body: form
        }
      );

      const text = await response.text();

      // Başarılı
      if (response.ok) {

        let data;

        try {
          data = JSON.parse(text);
        } catch (error) {
          throw new Error(
            `Hugging Face görsel yükleme yanıtı geçersiz: ${text.slice(0, 300)}`
          );
        }

        if (
          !Array.isArray(data) ||
          !data[0]
        ) {
          throw new Error(
            'Hugging Face görsel yolu döndürmedi.'
          );
        }

        return data[0];
      }

      // 404 ise diğer endpoint'i dene.
      if (response.status === 404) {
        lastError = text;
        continue;
      }

      throw new Error(
        `Hugging Face görsel yükleme hatası (${response.status}): ${text.slice(0, 400)}`
      );

    } catch (error) {

      // Endpoint bulunamadıysa diğerini dene.
      if (
        String(error.message || '')
          .includes('404')
      ) {
        lastError = error.message
