// Offline AI Object Segmentation Engine (SlimSAM ONNX via @huggingface/transformers)
// Automatically caches model weights permanently in WebView2 / Browser Cache API.

const MODEL_ID = 'Xenova/slimsam-77-uniform';
const CACHE_FLAG_KEY = 'worktools_ai_models_cached';

let samModel = null;
let samProcessor = null;
let loadingPromise = null;

// Cached embeddings for the currently loaded image
let cachedImageKey = null;
let cachedRawImage = null;
let cachedEmbeddings = null;

export const isAiModelsCached = () => {
  try {
    return localStorage.getItem(CACHE_FLAG_KEY) === '1';
  } catch {
    return false;
  }
};

export const markAiModelsCached = () => {
  try {
    localStorage.setItem(CACHE_FLAG_KEY, '1');
  } catch {
    // ignore
  }
};

export const loadSamModel = async (onProgress) => {
  if (samModel && samProcessor) {
    return { model: samModel, processor: samProcessor };
  }
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const { SamModel, AutoProcessor, env } = await import('@huggingface/transformers');
    env.allowLocalModels = false;
    env.useBrowserCache = true;

    const progress_callback = (info) => {
      if (!onProgress) return;
      if (info.status === 'progress' && typeof info.progress === 'number') {
        onProgress({
          stage: 'download',
          percent: Math.min(99, Math.round(info.progress)),
          file: info.file || '',
        });
      } else if (info.status === 'ready') {
        onProgress({ stage: 'ready', percent: 100, file: '' });
      }
    };

    const [model, processor] = await Promise.all([
      SamModel.from_pretrained(MODEL_ID, { progress_callback }),
      AutoProcessor.from_pretrained(MODEL_ID, { progress_callback }),
    ]);

    samModel = model;
    samProcessor = processor;
    return { model, processor };
  })();

  try {
    return await loadingPromise;
  } catch (err) {
    loadingPromise = null;
    throw err;
  }
};

export const preloadAllBgAiModels = async (onProgress) => {
  // 1. Preload ISNet background removal model into permanent cache
  onProgress?.({ step: 'isnet', percent: 5, text: 'กำลังดาวน์โหลดโมเดลลบพื้นหลัง AI (ISNet)...' });
  const { preload } = await import('@imgly/background-removal');
  if (typeof preload === 'function') {
    await preload({
      model: 'isnet_fp16',
      progress: (key, current, total) => {
        if (total > 0) {
          const pct = Math.min(99, Math.round((current / total) * 100));
          onProgress?.({
            step: 'isnet',
            percent: Math.round(pct * 0.5),
            text: `กำลังเก็บโมเดลลบพื้นหลัง ISNet ลงเครื่อง... ${pct}%`,
          });
        }
      },
    });
  }

  // 2. Preload SlimSAM interactive object segmentation model into permanent cache
  onProgress?.({ step: 'sam', percent: 52, text: 'กำลังดาวน์โหลดโมเดล AI จิ้มเลือกวัตถุ (SlimSAM)...' });
  await loadSamModel((p) => {
    onProgress?.({
      step: 'sam',
      percent: 50 + Math.round((p.percent || 0) * 0.5),
      text: `กำลังเก็บโมเดล SlimSAM ลงเครื่อง... ${p.percent || 0}%`,
    });
  });

  markAiModelsCached();
  onProgress?.({ step: 'done', percent: 100, text: 'เก็บโมเดล AI ทั้งหมดลงเครื่องเรียบร้อย! พร้อมใช้งานออฟไลน์ทันที' });
};

export const prepareSamImage = async (imageKey, dataUrl, onProgress) => {
  const { model, processor } = await loadSamModel(onProgress);
  if (cachedImageKey === imageKey && cachedEmbeddings && cachedRawImage) {
    return;
  }

  onProgress?.({ stage: 'encode', percent: 50, text: 'กำลังวิเคราะห์โครงสร้างวัตถุในภาพด้วย SlimSAM...' });
  const { RawImage } = await import('@huggingface/transformers');
  const rawImg = await RawImage.fromURL(dataUrl);
  const processed = await processor(rawImg);
  const embeddings = await model.get_image_embeddings(processed);

  cachedImageKey = imageKey;
  cachedRawImage = rawImg;
  cachedEmbeddings = embeddings;
  onProgress?.({ stage: 'ready', percent: 100, text: 'พร้อมจิ้มเลือกวัตถุแล้ว!' });
};

export const segmentWithSamPoints = async (imageKey, dataUrl, points, onProgress) => {
  if (!points || points.length === 0) return null;
  await prepareSamImage(imageKey, dataUrl, onProgress);

  const { model, processor } = await loadSamModel();
  const input_points = [[points.map((p) => [p.x, p.y])]];
  const input_labels = [[points.map((p) => p.label)]];

  const inputs = await processor(cachedRawImage, { input_points, input_labels });
  const outputs = await model({ ...cachedEmbeddings, ...inputs });
  const masks = await processor.post_process_masks(
    outputs.pred_masks,
    inputs.original_sizes,
    inputs.reshaped_input_sizes
  );

  // Choose highest-confidence mask from IoU scores
  const iouData = outputs.iou_scores?.data || [];
  let bestIdx = 0;
  for (let i = 1; i < iouData.length; i++) {
    if (iouData[i] > iouData[bestIdx]) bestIdx = i;
  }

  const maskTensor = masks[0]; // shape [1, numMasks, H, W]
  const dims = maskTensor.dims;
  const numMasks = dims[1];
  const h = dims[2];
  const w = dims[3];
  const planeSize = h * w;
  const offset = Math.min(bestIdx, numMasks - 1) * planeSize;
  const rawData = maskTensor.data;

  const binaryMask = new Uint8Array(planeSize);
  for (let i = 0; i < planeSize; i++) {
    binaryMask[i] = rawData[offset + i] ? 1 : 0;
  }

  return { mask: binaryMask, width: w, height: h };
};

export const clearSamImageCache = () => {
  cachedImageKey = null;
  cachedRawImage = null;
  cachedEmbeddings = null;
};
