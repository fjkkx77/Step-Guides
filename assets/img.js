/* 图片处理：截图 -> 发布用的图
   原则：只在超过上限时缩小，绝不放大；截图能无损就无损。

   2026-10-10 改规则（用户问"清晰度有没有保证、换设备是否一致"），依据是实测，不是感觉：
   · 旧规则把宽度压到 1440、再用有损 WebP(0.85) 存。拿用户当天的电脑截图（2466×1302）量：
     宽度被砍到 58%，放回 2560 的屏幕上是先缩小再放大 1.78 倍，1× 就是糊的；
     有损那一步，四成的像素分量跟原图不一样，最大差到 119/255（红框、彩色文字的边最明显）。
   · 同一张图用无损 WebP 存：逐像素和原图一致，才 136KB，而且比有损编得还快。
   所以现在：先试无损，装得下（LOSSLESS_MAX）就用；装不下的基本是照片，照片没有锐利的字，用高质量有损。
   Apple 的人机界面指南「Images」页（2026-10-10 抓取）对位图给的也是同一个方向：
   给够像素（各倍率都有对应素材）、用 PNG（无损）、sRGB 在多数屏幕上颜色准确。

   一定要过一遍 canvas、不直接用原文件：重新编码会去掉照片里的拍摄地点等信息（仓库是公开的），
   并且把颜色统一换算成 sRGB —— 各种屏幕对它的解释是一致的。 */
(() => {
  'use strict';

  /* 为什么按「宽度」而不是「长边」限制：
     手机竖屏截图是 1170×2532 这种细长比例。按长边限会把宽度压到七百多，
     而 DPR3 的手机显示 390 逻辑像素宽 = 1170 物理像素 —— 素材不够就是放大来看，必糊。
     屏幕的清晰度取决于「宽度够不够」，跟多高无关。
     2560 = 最常见的高分电脑屏整屏截图的宽度（用户自己的屏幕就是 2560）；手机竖屏截图的宽度都在 1500 以内，本来就不会被缩。
     更宽的（4K 整屏 3840）缩到 2560：在 4K 屏上全屏看会软一点，换来体积可控。 */
  const MAX_W = 2560;
  const MAX_PIXELS = 6e6;   // 再给个总像素兜底，防止超长截图（比如整页长图）撑爆体积
  const QUALITY = 0.92;     // 有损那条路的质量（只有无损装不下时才走）
  /* 一张图无损最多占多少。实测界面截图无损 WebP 在 80~310KB；照片动辄几 MB，会落到有损那条路。
     800KB 是在「一份 12 步的教程最坏不到 10MB、仓库 1GB 的额度够放一百份以上」和「尽量多的截图走无损」之间取的 */
  const LOSSLESS_MAX = 800 * 1024;

  /** 算出目标尺寸。两个上限都是参数，不是写死值。 */
  function pickSize(w, h, maxW = MAX_W, maxPixels = MAX_PIXELS) {
    if (!(w > 0 && h > 0)) throw new Error('尺寸不合法');
    let k = 1;
    if (w > maxW) k = maxW / w;
    if (w * k * h * k > maxPixels) k = Math.sqrt(maxPixels / (w * h));
    if (k >= 1) return { w, h, scaled: false };          // 绝不放大
    return { w: Math.round(w * k), h: Math.round(h * k), scaled: true };
  }

  /** 浏览器能不能用 canvas 导出 WebP（Safari、老安卓不行） */
  let _webp = null;
  function supportsWebp() {
    if (_webp !== null) return _webp;
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    _webp = c.toDataURL('image/webp').startsWith('data:image/webp');
    return _webp;
  }

  /** 这个 WebP 是不是无损的。Chrome 在质量给 1 时会出无损，但这不是标准里写明的行为，
      所以不能假定，要看文件本身：WebP 里图像数据块叫 'VP8L' 的是无损，叫 'VP8 ' 的是有损 */
  async function isLosslessWebp(blob) {
    const b = new Uint8Array(await blob.arrayBuffer());
    const tag = i => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
    if (b.length < 20 || tag(0) !== 'RIFF' || tag(8) !== 'WEBP') return false;
    for (let i = 12; i + 8 <= b.length;) {
      const t = tag(i);
      if (t === 'VP8L') return true;
      if (t === 'VP8 ') return false;
      const size = b[i + 4] | b[i + 5] << 8 | b[i + 6] << 16 | b[i + 7] << 24;
      if (size < 0) return false;
      i += 8 + size + (size & 1);                         // 块按偶数字节对齐
    }
    return false;
  }

  /**
   * 处理一个 File/Blob。
   * @returns {Promise<{blob:Blob,w:number,h:number,ext:string,scaled:boolean,lossless:boolean}>}
   */
  async function compress(file, opts = {}) {
    const maxW = opts.maxW ?? opts.max ?? MAX_W;
    const quality = opts.quality ?? QUALITY;
    const losslessMax = opts.losslessMax ?? LOSSLESS_MAX;
    const bmp = await createImageBitmap(file);
    try {
      const size = pickSize(bmp.width, bmp.height, maxW);
      const cv = document.createElement('canvas');
      cv.width = size.w;
      cv.height = size.h;
      const ctx = cv.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bmp, 0, 0, size.w, size.h);
      const enc = (type, q) => new Promise(res => cv.toBlob(res, type, q));
      const done = (blob, ext, lossless) => ({ blob, w: size.w, h: size.h, scaled: size.scaled, ext, lossless });

      // ① 无损：能出无损 WebP 就用它（比 PNG 小一半以上）；出不了就用 PNG（哪儿都能出，一定无损）
      if (losslessMax > 0) {
        const b = supportsWebp() ? await enc('image/webp', 1) : null;
        const real = !!b && await isLosslessWebp(b);
        if (real && b.size <= losslessMax) return done(b, 'webp', true);
        if (!real) {                                        // 无损 WebP 都超了的话 PNG 只会更大，不用试
          const p = await enc('image/png');
          if (p && p.type === 'image/png' && p.size <= losslessMax) return done(p, 'png', true);
        }
      }
      // ② 装不下（多半是照片）：高质量有损
      const type = supportsWebp() ? 'image/webp' : 'image/jpeg';
      const blob = await enc(type, quality);
      if (!blob) throw new Error('这张图导不出来（浏览器 toBlob 返回空）');
      return done(blob, type === 'image/webp' ? 'webp' : 'jpg', false);
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

  window.SGImg = { pickSize, compress, toBase64, supportsWebp, isLosslessWebp, MAX_W, MAX_PIXELS, QUALITY, LOSSLESS_MAX };
})();
