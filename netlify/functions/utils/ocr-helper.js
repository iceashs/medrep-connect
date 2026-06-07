async function callOCRSpace(base64Image, language, ocrEngine, apiKey) {
  const params = new URLSearchParams();
  params.append('apikey', apiKey);
  params.append('base64Image', base64Image);
  params.append('language', language);
  params.append('OCREngine', String(ocrEngine));
  params.append('isTable', 'false');
  params.append('detectOrientation', 'true');
  params.append('scale', 'true');
  params.append('isCreateSearchablePdf', 'false');
  params.append('isSearchablePdfHideTextLayer', 'false');

  const response = await fetch('https://api.ocr.space/parse/image', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });

  if (!response.ok) {
    throw new Error(`OCR.space HTTP ${response.status}`);
  }

  const data = await response.json();
  if (data.IsErroredOnProcessing) {
    throw new Error(data.ErrorMessage?.[0] || 'OCR.space error');
  }
  if (!data.ParsedResults?.length) {
    throw new Error('No results from OCR.space');
  }

  return data.ParsedResults.map(r => r.ParsedText || '').join('\n').trim();
}

function mergeOCRResults(engText, araText) {
  const engLines = engText.split(/[\r\n]+/).map(l => l.trim()).filter(l => l.length > 1);
  const araLines = araText.split(/[\r\n]+/).map(l => l.trim()).filter(l => l.length > 1);
  const merged = [...engLines];
  
  for (const line of araLines) {
    if (/[\u0600-\u06FF]/.test(line)) {
      const alreadyHave = merged.some(l => {
        const a = l.replace(/\s/g, ''), b = line.replace(/\s/g, '');
        return a === b || (a.length > 3 && b.includes(a.substring(0, 4)));
      });
      if (!alreadyHave) merged.push(line);
    }
  }
  return merged.join('\n');
}

async function runOCR(base64Image, apiKey) {
  const [engResult, araResult] = await Promise.allSettled([
    callOCRSpace(base64Image, 'eng', 2, apiKey),
    callOCRSpace(base64Image, 'ara', 1, apiKey)
  ]);

  const engText = (engResult.status === 'fulfilled' ? engResult.value : '').trim();
  const araText = (araResult.status === 'fulfilled' ? araResult.value : '').trim();

  if (engResult.status === 'rejected') console.warn('⚠️ English OCR failed:', engResult.reason?.message);
  if (araResult.status === 'rejected') console.warn('⚠️ Arabic OCR failed:', araResult.reason?.message);

  const merged = mergeOCRResults(engText, araText);
  if (merged.length > 5) return merged;

  const fallback = engText.length >= araText.length ? engText : araText;
  if (fallback.length > 0) return fallback;

  throw new Error('OCR.space returned no text');
}

module.exports = { runOCR, callOCRSpace };
