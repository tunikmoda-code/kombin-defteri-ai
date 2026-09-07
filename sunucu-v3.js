const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

const HF_SPACE = 'yisol/IDM-VTON';
const HF_TOKEN = process.env.HF_TOKEN || '';

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

let gradioClientPromise = null;

/*
 * @gradio/client'i dinamik olarak yüklüyoruz.
 * Böylece Node/Render CommonJS sunucusunda da çalışır.
 */
async function getGradioClient() {
  if (!gradioClientPromise) {
    gradioClientPromise = import('@gradio/client').then(mod => ({
      Client: mod.Client,
      handle_file: mod.handle_file
    }));
  }

  return gradioClientPromise;
}

let clientPromise = null;

/*
 * IDM-VTON Gradio istemcisini bir kez bağla ve tekrar kullan.
 */
async function getClient() {
  if (!clientPromise) {
    const { Client } = await getGradioClient();

    const options = {};

    if (HF_TOKEN) {
      options.token = HF_TOKEN;
    }

    options.status_callback = status => {
      try {
        console.log(
          '[HF STATUS]',
          JSON.stringify(status)
        );
      } catch (_) {
        console.log('[HF STATUS]', status);
      }
    };

    clientPromise = Client.connect(
      HF_SPACE,
      options
    ).catch(error => {
      clientPromise = null;
      throw error;
    });
  }

  return clientPromise;
}

/*
 * data:image/...;base64,... -> Blob
 */
function dataUriToBlob(data) {
  const match =
    /^data:([^;,]+)?(?:;base64)?,(.*)$/s.exec(
      data || ''
    );

  if (!match) {
    throw new Error(
      'Geçersiz görsel verisi.'
    );
  }

  const isBase64 =
    /;base64,/.test(data);

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
 * Gelen görseli Gradio Client'ın handle_file()
 * anlayacağı bir Blob'a çevirir.
 */
function imageToBlob(image) {
  if (
    typeof image !== 'string'
  ) {
    throw new Error(
      'Görsel verisi geçersiz.'
    );
  }

  if (
    image.startsWith('data:')
  ) {
    return dataUriToBlob(image);
  }

  throw new Error(
    'Bu sürüm yalnızca data:image/... görsellerini kabul ediyor.'
  );
}

/*
 * Gradio çıktısını tarayıcının gösterebileceği
 * data URI'ye dönüştür.
 */
async function outputToDataUri(output) {
  if (!output) {
    throw new Error(
      'IDM-VTON görüntü çıktısı boş.'
    );
  }

  /*
   * Bazı Gradio sürümlerinde çıktı:
   * { url, path, ... }
   */
  if (
    typeof output === 'object' &&
    output.url
  ) {
    const response =
      await fetch(output.url);

    if (!response.ok) {
      throw new Error(
        `AI görüntüsü alınamadı (${response.status}).`
      );
    }

    const type =
      response.headers.get(
        'content-type'
      ) || 'image/png';

    const buffer =
      Buffer.from(
        await response.arrayBuffer()
      );

    return (
      `data:${type};base64,` +
      buffer.toString('base64')
    );
  }

  /*
   * String URL gelirse.
   */
  if (
    typeof output === 'string' &&
    /^https?:\/\//i.test(output)
  ) {
    const response =
      await fetch(output);

    if (!response.ok) {
      throw new Error(
        `AI görüntüsü alınamadı (${response.status}).`
      );
    }

    const type =
      response.headers.get(
        'content-type'
      ) || 'image/png';

    const buffer =
      Buffer.from(
        await response.arrayBuffer()
      );

    return (
      `data:${type};base64,` +
      buffer.toString('base64')
    );
  }

  /*
   * Bazı sürümlerde Blob dönebilir.
   */
  if (
    typeof Blob !== 'undefined' &&
    output instanceof Blob
  ) {
    const type =
      output.type || 'image/png';

    const buffer =
      Buffer.from(
        await output.arrayBuffer()
      );

    return (
      `data:${type};base64,` +
      buffer.toString('base64')
    );
  }

  throw new Error(
    'IDM-VTON çıktı formatı tanınamadı: ' +
    JSON.stringify(output).slice(0, 500)
  );
}

/*
 * IDM-VTON çağrısı.
 *
 * Gerçek Space endpoint'i:
 * /tryon
 *
 * Parametreler IDM-VTON app.py ile aynı sıradadır:
 * 1. ImageEditor
 * 2. garment image
 * 3. garment description
 * 4. is_checked
 * 5. is_checked_crop
 * 6. denoise_steps
 * 7. seed
 */
async function callTryOn(
  modelImage,
  productImage,
  description
) {
  const {
    handle_file
  } = await getGradioClient();

  const client =
    await getClient();

  const modelBlob =
    imageToBlob(modelImage);

  const garmentBlob =
    imageToBlob(productImage);

  /*
   * Gradio Client upload işini kendisi yapar.
   * Manuel /upload veya /gradio_api/upload
   * çağrısı YOK.
   */
  const modelFile =
    handle_file(modelBlob);

  const garmentFile =
    handle_file(garmentBlob);

  console.log(
    '[IDM-VTON] Try-on başlatılıyor...'
  );

  const result =
    await client.predict(
      '/tryon',
      [
        {
          background: modelFile,
          layers: [],
          composite: null
        },

        garmentFile,

        description ||
          'fashion garment',

        true,

        false,

        30,

        42
      ]
    );

  console.log(
    '[IDM-VTON] Sonuç alındı.'
  );

  if (
    !result ||
    !Array.isArray(result.data)
  ) {
    throw new Error(
      'IDM-VTON geçerli bir sonuç döndürmedi.'
    );
  }

  /*
   * IDM-VTON:
   * result.data[0] = image_out
   * result.data[1] = masked_img
   */
  return result.data[0];
}


/*
 * TRY-ON API
 */
app.post(
  '/api/tryon',
  async (req, res) => {
    try {
      const {
        modelImage,
        productImage,
        category,
        itemName
      } = req.body || {};

      if (
        !modelImage ||
        !productImage
      ) {
        return res.status(400).json({
          error:
            'Manken fotoğrafı ve ürün fotoğrafı gerekli.'
        });
      }

      const description =
        `${category || 'fashion garment'} ${
          itemName || ''
        }`.trim();

      const output =
        await callTryOn(
          modelImage,
          productImage,
          description
        );

      const image =
        await outputToDataUri(output);

      res.json({
        image
      });

    } catch (error) {
      console.error(
        '[TRYON ERROR]',
        error
      );

      /*
       * Client bağlantısı bozulduysa sonraki
       * istekte yeniden bağlanabilsin.
       */
      clientPromise = null;

      res.status(500).json({
        error:
          error?.message ||
          'IDM-VTON AI hatası.'
      });
    }
  }
);


/*
 * Sağlık kontrolü
 */
app.get(
  '/api/health',
  (_req, res) => {
    res.json({
      ok: true,
      service: 'kombin-defteri-ai',
      engine: 'huggingface-idm-vton-gradio-client',
      space: HF_SPACE
    });
  }
);


/*
 * API bilgisi / teşhis
 */
app.get(
  '/api/ai-info',
  async (_req, res) => {
    try {
      const client =
        await getClient();

      const api =
        await client.view_api();

      res.json({
        ok: true,
        space: HF_SPACE,
        api
      });

    } catch (error) {
      clientPromise = null;

      res.status(500).json({
        ok: false,
        error:
          error?.message ||
          'IDM-VTON API bilgisi alınamadı.'
      });
    }
  }
);


app.listen(
  PORT,
  () => {
    console.log(
      `Kombin Defteri AI v3 çalışıyor: http://localhost:${PORT}`
    );
    console.log(
      `Hugging Face Space: ${HF_SPACE}`
    );
  }
);
