const fileInput = document.getElementById('fileInput');
const folderInput = document.getElementById('folderInput');
const formatSelect = document.getElementById('formatSelect');
const nameSelect = document.getElementById('nameSelect');
const progressBox = document.getElementById('progressBox');
const progressStatus = document.getElementById('progressStatus');
const progressCount = document.getElementById('progressCount');
const progressBar = document.getElementById('progressBar');
const batchPanel = document.getElementById('batchPanel');
const statsText = document.getElementById('statsText');
const resultsGrid = document.getElementById('resultsGrid');

const batchSaveBtn = document.getElementById('batchSaveBtn');
const zipShareBtn = document.getElementById('zipShareBtn');
const seqDownloadBtn = document.getElementById('seqDownloadBtn');
const clearBtn = document.getElementById('clearBtn');
const toastEl = document.getElementById('toast');

let processedItems = [];
let seqCounter = 1;

function showToast(msg, duration = 2600) {
  toastEl.textContent = msg;
  toastEl.style.display = 'block';
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => { toastEl.style.display = 'none'; }, duration);
}

fileInput.addEventListener('change', (e) => handleFiles(e.target.files));
folderInput.addEventListener('change', (e) => handleFiles(e.target.files));

async function handleFiles(fileList) {
  const files = Array.from(fileList).filter(f => f.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(f.name));
  if (!files.length) return;

  progressBox.style.display = 'block';
  const total = files.length;

  for (let i = 0; i < total; i++) {
    progressStatus.textContent = '正在清理: ' + files[i].name;
    progressCount.textContent = (i + 1) + ' / ' + total;
    progressBar.style.width = Math.round(((i + 1) / total) * 100) + '%';

    await processSingleImage(files[i]);
    await new Promise(r => setTimeout(r, 15));
  }

  progressBox.style.display = 'none';
  fileInput.value = '';
  folderInput.value = '';
  updateBatchPanel();
  showToast('✅ 已完成 ' + total + ' 张图片清理');
}

function updateBatchPanel() {
  if (processedItems.length === 0) {
    batchPanel.style.display = 'none';
    return;
  }
  batchPanel.style.display = 'block';
  const warnCount = processedItems.filter(i => i.detected).length;
  statsText.textContent = '已处理 ' + processedItems.length + ' 张 (清除 ' + warnCount + ' 张隐写/元数据)';
}

clearBtn.addEventListener('click', () => {
  processedItems.forEach(item => URL.revokeObjectURL(item.url));
  processedItems = [];
  seqCounter = 1;
  resultsGrid.innerHTML = '';
  updateBatchPanel();
  showToast('🗑️ 已清空列表');
});

async function detectStandardMetadata(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const limit = Math.min(bytes.length, 65536);
  let text = '';
  for (let i = 0; i < limit; i++) {
    if (bytes[i] >= 32 && bytes[i] <= 126) text += String.fromCharCode(bytes[i]);
  }
  const keywords = ['NovelAI', 'Description', 'parameters', 'Comment', 'Software', 'steps:', 'Sampler:'];
  return keywords.some(k => text.includes(k));
}

function detectStealthMetadata(imgData, width, height) {
  let alphaBits = '';
  let rgbBits = '';
  for (let x = 0; x < width && alphaBits.length < 120; x++) {
    for (let y = 0; y < height && alphaBits.length < 120; y++) {
      const idx = (y * width + x) * 4;
      alphaBits += (imgData.data[idx + 3] & 1).toString();
      if (rgbBits.length < 120) {
        rgbBits += (imgData.data[idx] & 1).toString() +
                   (imgData.data[idx + 1] & 1).toString() +
                   (imgData.data[idx + 2] & 1).toString();
      }
    }
  }
  const bitsToString = (bits) => {
    let s = '';
    for (let i = 0; i < 120; i += 8) {
      s += String.fromCharCode(parseInt(bits.slice(i, i + 8), 2));
    }
    return s;
  };
  return bitsToString(alphaBits).startsWith('stealth_') || bitsToString(rgbBits).startsWith('stealth_');
}

function blobToDataURL(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

// 针对 HBuilderX (5+ App) 原生 APK 环境的保存相册桥接
function saveToGalleryPlus(blob, fileName) {
  return new Promise(async (resolve, reject) => {
    if (!window.plus) return reject(new Error('No plus env'));
    try {
      const dataUrl = await blobToDataURL(blob);
      const bmp = new plus.nativeObj.Bitmap('bmp_' + Date.now());
      bmp.loadBase64Data(dataUrl, () => {
        const tempPath = '_doc/' + fileName;
        bmp.save(tempPath, { overwrite: true }, (saveRes) => {
          plus.gallery.save(saveRes.target, () => {
            bmp.clear();
            resolve();
          }, (err) => {
            bmp.clear();
            reject(err);
          });
        }, (err) => {
          bmp.clear();
          reject(err);
        });
      }, (err) => reject(err));
    } catch (e) {
      reject(e);
    }
  });
}

// 兼容安卓 WebView 的文件下载方法 (自动降级为 DataURL)
async function triggerCompatibleDownload(blob, url, fileName) {
  const a = document.createElement('a');
  // 在部分套壳 WebView 中 blob: 协议无法触发下载，小文件优先使用 DataURL
  if (blob.size < 15 * 1024 * 1024 && /wv|Android/i.test(navigator.userAgent)) {
    a.href = await blobToDataURL(blob);
  } else {
    a.href = url;
  }
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

async function processSingleImage(file) {
  try {
    const hasStandard = await detectStandardMetadata(file);
    const imgUrl = URL.createObjectURL(file);
    const img = new Image();
    img.src = imgUrl;
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });

    const canvas = document.createElement('canvas');
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(imgUrl);

    const imgData = ctx.getImageData(0, 0, width, height);
    const hasStealth = detectStealthMetadata(imgData, width, height);

    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
      data[i + 3] = 255;
    }
    for (let i = 0; i < Math.min(data.length, 600); i += 4) {
      data[i] &= 0xFE;
      data[i + 1] &= 0xFE;
      data[i + 2] &= 0xFE;
    }
    ctx.putImageData(imgData, 0, 0);

    const mimeType = formatSelect.value;
    const ext = mimeType === 'image/png' ? 'png' : (mimeType === 'image/jpeg' ? 'jpg' : 'webp');
    const blob = await new Promise(res => canvas.toBlob(res, mimeType, 0.95));

    canvas.width = 0;
    canvas.height = 0;

    let cleanFileName;
    if (nameSelect.value === 'seq') {
      cleanFileName = 'clean_' + String(seqCounter++).padStart(3, '0') + '.' + ext;
    } else {
      const baseName = file.name.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_\u4e00-\u9fa5-]/g, '_');
      cleanFileName = 'clean_' + baseName + '_' + (seqCounter++) + '.' + ext;
    }

    const cleanUrl = URL.createObjectURL(blob);
    const cleanFile = new File([blob], cleanFileName, { type: mimeType });
    const detected = hasStandard || hasStealth;

    const itemObj = { blob, file: cleanFile, url: cleanUrl, name: cleanFileName, detected };
    processedItems.push(itemObj);
    renderItemCard(itemObj, hasStandard, hasStealth);
  } catch (err) {
    console.error('处理失败:', file.name, err);
  }
}

function renderItemCard(item, hasStandard, hasStealth) {
  const card = document.createElement('div');
  card.className = 'item-card';

  let badgeHtml = '';
  if (hasStandard || hasStealth) {
    const tags = [];
    if (hasStandard) tags.push('元数据');
    if (hasStealth) tags.push('隐写');
    badgeHtml = '<div class="badge warn">⚠️ 已除: ' + tags.join('+') + '</div>';
  } else {
    badgeHtml = '<div class="badge safe">✅ 纯净副本</div>';
  }

  card.innerHTML = `
    <div>
      ${badgeHtml}
      <div class="thumb-wrap">
        <img src="${item.url}" alt="${item.name}">
      </div>
      <div class="item-name">${item.name}</div>
    </div>
    <div class="item-actions">
      <button class="btn btn-primary single-save">存相册</button>
      <button class="btn btn-outline single-dl">下载</button>
    </div>
  `;

  card.querySelector('.single-save').addEventListener('click', async () => {
    if (window.plus) {
      try {
        await saveToGalleryPlus(item.blob, item.name);
        showToast('✅ 已存入系统相册: ' + item.name);
        return;
      } catch (e) {}
    }
    if (navigator.canShare && navigator.canShare({ files: [item.file] })) {
      try { await navigator.share({ files: [item.file] }); return; } catch (e) {}
    }
    await triggerCompatibleDownload(item.blob, item.url, item.name);
    showToast('💾 已触发保存: ' + item.name);
  });

  card.querySelector('.single-dl').addEventListener('click', async () => {
    await triggerCompatibleDownload(item.blob, item.url, item.name);
    showToast('💾 开始下载: ' + item.name);
  });

  resultsGrid.appendChild(card);
}

// 批量存入相册 / 系统分享
batchSaveBtn.addEventListener('click', async () => {
  if (!processedItems.length) return;

  // 1. 若在 HBuilderX 打包的 APK 环境内，直接批量写入系统相册
  if (window.plus) {
    batchSaveBtn.disabled = true;
    let ok = 0;
    for (const item of processedItems) {
      try {
        await saveToGalleryPlus(item.blob, item.name);
        ok++;
      } catch (e) {}
    }
    batchSaveBtn.disabled = false;
    showToast('✅ 已成功保存 ' + ok + ' 张图片到系统相册！');
    return;
  }

  // 2. 调用系统原生多图分享
  const files = processedItems.map(i => i.file);
  if (navigator.canShare && navigator.canShare({ files })) {
    try {
      await navigator.share({ files, title: '批量纯净图片' });
      return;
    } catch (e) {}
  }

  // 3. 降级为逐张下载
  seqDownloadBtn.click();
});

// 逐张下载
seqDownloadBtn.addEventListener('click', async () => {
  if (!processedItems.length) return;
  seqDownloadBtn.disabled = true;
  const origText = seqDownloadBtn.textContent;

  for (let i = 0; i < processedItems.length; i++) {
    seqDownloadBtn.textContent = '⏳ (' + (i + 1) + '/' + processedItems.length + ')';
    await triggerCompatibleDownload(processedItems[i].blob, processedItems[i].url, processedItems[i].name);
    await new Promise(r => setTimeout(r, 320));
  }

  seqDownloadBtn.textContent = origText;
  seqDownloadBtn.disabled = false;
  showToast('✅ 已完成逐张下载触发');
});

// 导出 / 分享 ZIP 压缩包
zipShareBtn.addEventListener('click', async () => {
  if (!processedItems.length) return;
  zipShareBtn.disabled = true;
  const origText = zipShareBtn.textContent;
  zipShareBtn.textContent = '⏳ 正在打包...';

  try {
    const zipBlob = await ZipEngine.createZipBlob(processedItems);
    const zipName = 'clean_images_' + Date.now().toString().slice(-5) + '.zip';
    const zipFile = new File([zipBlob], zipName, { type: 'application/zip' });
    const zipUrl = URL.createObjectURL(zipBlob);

    // 优先尝试唤起系统分享保存 ZIP（在 APK WebView 中最稳定，可直接存文件管理或发微信/QQ）
    if (navigator.canShare && navigator.canShare({ files: [zipFile] })) {
      try {
        await navigator.share({ files: [zipFile], title: zipName });
      } catch (e) {
        await triggerCompatibleDownload(zipBlob, zipUrl, zipName);
      }
    } else {
      await triggerCompatibleDownload(zipBlob, zipUrl, zipName);
      showToast('📦 已开始下载 ZIP 压缩包');
    }
    setTimeout(() => URL.revokeObjectURL(zipUrl), 15000);
  } catch (err) {
    alert('打包失败: ' + err.message);
  } finally {
    zipShareBtn.textContent = origText;
    zipShareBtn.disabled = false;
  }
});