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

// Automatic multi-object segmentation ("Magic Layers" / Canva Magic Grab auto-split)
// Encodes image ONCE, then decodes a 5x5 full-image grid of prompt points with IoU filtering & NMS deduplication.
export const autoSegmentImage = async (imageKey, dataUrl, onProgress, options = {}) => {
  const { gridSize = 5, minAreaRatio = 0.003, maxAreaRatio = 0.68, minIou = 0.65, maxObjects = 16 } = options;

  await prepareSamImage(imageKey, dataUrl, onProgress);
  const { model, processor } = await loadSamModel();

  const imgW = cachedRawImage.width;
  const imgH = cachedRawImage.height;
  const totalPixels = imgW * imgH;

  // Build evenly spaced full-image grid points (8%..92% so elements near borders are also captured)
  const gridPoints = [];
  for (let gy = 0; gy < gridSize; gy++) {
    const ny = 0.08 + (gy / Math.max(1, gridSize - 1)) * 0.84;
    for (let gx = 0; gx < gridSize; gx++) {
      const nx = 0.08 + (gx / Math.max(1, gridSize - 1)) * 0.84;
      gridPoints.push({ x: Math.round(nx * imgW), y: Math.round(ny * imgH) });
    }
  }

  const candidates = [];
  let maskW = imgW;
  let maskH = imgH;

  for (let i = 0; i < gridPoints.length; i++) {
    const pt = gridPoints[i];
    onProgress?.({
      stage: 'segment',
      percent: Math.round(((i + 1) / gridPoints.length) * 100),
      text: `กำลังตรวจจับและแยกชิ้นส่วนอัตโนมัติ (${i + 1}/${gridPoints.length})...`,
    });

    const inputs = await processor(cachedRawImage, {
      input_points: [[[pt.x, pt.y]]],
      input_labels: [[[1]]],
    });
    const outputs = await model({ ...cachedEmbeddings, ...inputs });
    const masks = await processor.post_process_masks(
      outputs.pred_masks,
      inputs.original_sizes,
      inputs.reshaped_input_sizes
    );

    const iouData = outputs.iou_scores?.data || [];
    const maskTensor = masks[0]; // [1, numMasks, H, W]
    const [, numMasks, h, w] = maskTensor.dims;
    maskW = w;
    maskH = h;
    const planeSize = h * w;
    const rawData = maskTensor.data;

    // Pick best valid object mask among the 3 SAM scales (skip full-background & tiny noise)
    let bestCandidate = null;
    for (let mIdx = 0; mIdx < numMasks; mIdx++) {
      const iou = Number(iouData[mIdx] || 0);
      if (iou < minIou) continue;

      const offset = mIdx * planeSize;
      let area = 0;
      for (let p = 0; p < planeSize; p++) {
        if (rawData[offset + p]) area++;
      }
      const ratio = area / planeSize;
      if (ratio < minAreaRatio || ratio > maxAreaRatio) continue;

      // Prefer higher IoU, slightly favoring whole objects over tiny sub-parts
      const score = iou + Math.min(0.06, ratio * 0.15);
      if (!bestCandidate || score > bestCandidate.score) {
        const binaryMask = new Uint8Array(planeSize);
        for (let p = 0; p < planeSize; p++) {
          binaryMask[p] = rawData[offset + p] ? 1 : 0;
        }
        bestCandidate = { mask: binaryMask, area, iou, score, width: w, height: h };
      }
    }

    if (bestCandidate) {
      candidates.push(bestCandidate);
    }
  }

  // Deduplicate overlapping masks via IoU & containment NMS (highest confidence first)
  candidates.sort((a, b) => b.score - a.score);
  const kept = [];
  const planeSize = maskW * maskH;

  for (const cand of candidates) {
    let duplicate = false;
    for (const prev of kept) {
      let inter = 0;
      for (let p = 0; p < planeSize; p++) {
        if (cand.mask[p] && prev.mask[p]) inter++;
      }
      if (inter === 0) continue;
      const union = cand.area + prev.area - inter;
      const iou = inter / Math.max(1, union);
      const minContain = inter / Math.max(1, Math.min(cand.area, prev.area));
      if (iou > 0.42 || minContain > 0.72) {
        duplicate = true;
        break;
      }
    }
    if (!duplicate) {
      kept.push(cand);
      if (kept.length >= maxObjects) break;
    }
  }

  // Sort smallest-to-largest so foreground items claim priority, and resolve pixel overlaps cleanly
  kept.sort((a, b) => a.area - b.area);
  const claimed = new Uint8Array(planeSize);
  const finalMasks = [];

  for (const item of kept) {
    let remaining = 0;
    const cleanMask = new Uint8Array(planeSize);
    for (let p = 0; p < planeSize; p++) {
      if (item.mask[p] && !claimed[p]) {
        cleanMask[p] = 1;
        claimed[p] = 1;
        remaining++;
      }
    }
    if (remaining / Math.max(1, totalPixels) >= minAreaRatio * 0.65) {
      finalMasks.push({
        mask: cleanMask,
        width: maskW,
        height: maskH,
        area: remaining,
        iou: item.iou,
      });
    }
  }

  // Return largest first so smaller foreground pieces stack ON TOP in the layers array
  finalMasks.sort((a, b) => b.area - a.area);
  return { masks: finalMasks, width: maskW, height: maskH };
};

export const clearSamImageCache = () => {
  cachedImageKey = null;
  cachedRawImage = null;
  cachedEmbeddings = null;
};
