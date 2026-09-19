/* 图片压缩：手机截图 -> WebP
   原则：只在超过上限时缩小，绝不放大——用户的截图本来就只有 412px 宽，
   放大或过度压缩都会把界面上的小字弄糊。 */
(() => {
  'use strict';

  /* 为什么按「宽度」而不是「长边」限制：
     手机竖屏截图是 1170×2532 这种细长比例。按长边 1600 限，宽度会被压到 739，
     而 DPR3 的手机显示 390 逻辑像素宽 = 1170 物理像素 —— 素材只有 739，
     等于放大 1.6 倍来看，必糊。屏幕的清晰度取决于「宽度够不够」，跟多高无关。
     1440 = 430(最宽的主流机型) × 3(DPR) 再留一点余量。 */
  const MAX_W = 1440;
  const MAX_PIXELS = 6e6;   // 再给个总像素兜底，防止超长截图（比如整页长图）撑爆体积
  const QUALITY = 0.85;

  /** 算出目标尺寸。两个上限都是参数，不是写死值。 */
  function pickSize(w, h, maxW = MAX_W, maxPixels = MAX_PIXELS) {
    if (!(w > 0 && h > 0)) throw new Error('尺寸不合法');
    let k = 1;
    if (w > maxW) k = maxW / w;
    if (w * k * h * k > maxPixels) k = Math.sqrt(maxPixels / (w * h));
    if (k >= 1) return { w, h, scaled: false };          // 绝不放大
    return { w: Math.round(w * k), h: Math.round(h * k), scaled: true };
  }

  /** 浏览器能不能用 canvas 导出 WebP（老安卓不行，退回 JPEG） */
  let _webp = null;
  function supportsWebp() {
    if (_webp !== null) return _webp;
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    _webp = c.toDataURL('image/webp').startsWith('data:image/webp');
    return _webp;
  }

  /**
   * 压缩一个 File/Blob。
   * @returns {Promise<{blob:Blob,w:number,h:number,ext:string,scaled:boolean}>}
   */
  async function compress(file, opts = {}) {
    const maxW = opts.maxW ?? opts.max ?? MAX_W;
    const quality = opts.quality ?? QUALITY;
    const bmp = await createImageBitmap(file);
    try {
      const size = pickSize(bmp.width, bmp.height, maxW);
      const cv = document.createElement('canvas');
      cv.width = size.w;
      cv.height = size.h;
      const ctx = cv.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bmp, 0, 0, size.w, size.h);
      const type = supportsWebp() ? 'image/webp' : 'image/jpeg';
      const blob = await new Promise(res => cv.toBlob(res, type, quality));
      if (!blob) throw new Error('这张图导不出来（浏览器 toBlob 返回空）');
      return { blob, w: size.w, h: size.h, scaled: size.scaled,
               ext: type === 'image/webp' ? 'webp' : 'jpg' };
    } finally {
      bmp.close?.();
    }
  }

  /** Blob -> base64（GitHub 的 blob 接口要 base64；分块拼避免超长栈） */
  async function toBase64(blob) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    const CH = 0x8000;
    for (let i = 0; i < buf.length; i += CH) {
      s += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
    }
    return btoa(s);
  }

  window.SGImg = { pickSize, compress, toBase64, supportsWebp, MAX_W, MAX_PIXELS, QUALITY };
})();
