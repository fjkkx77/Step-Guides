/* 图片压缩：手机截图 -> WebP
   原则：只在超过上限时缩小，绝不放大——用户的截图本来就只有 412px 宽，
   放大或过度压缩都会把界面上的小字弄糊。 */
(() => {
  'use strict';

  const MAX_EDGE = 1600;   // 长边上限：再大对手机阅读没有意义，只是白占仓库
  const QUALITY = 0.85;

  /** 算出目标尺寸。max 是参数不是写死值（同一函数也给写作页的预览用）。 */
  function pickSize(w, h, max = MAX_EDGE) {
    if (!(w > 0 && h > 0)) throw new Error('尺寸不合法');
    const long = Math.max(w, h);
    if (long <= max) return { w, h, scaled: false };
    const k = max / long;
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
    const max = opts.max ?? MAX_EDGE;
    const quality = opts.quality ?? QUALITY;
    const bmp = await createImageBitmap(file);
    try {
      const size = pickSize(bmp.width, bmp.height, max);
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

  window.SGImg = { pickSize, compress, toBase64, supportsWebp, MAX_EDGE, QUALITY };
})();
