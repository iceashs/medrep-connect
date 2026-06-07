/* ============================================
   MEDREP Connect — Application Logic
   OCR.space API (Arabic+English) + Tesseract Fallback
   ============================================ */

// ── Config ──────────────────────────────────────────
const CONFIG = {
    SAVE_ENDPOINT: '/api/save',
    OCR_ENDPOINT: '/api/ocr',
    TESSERACT_LANGUAGES: 'eng+ara',
    MAX_IMAGE_SIZE: 1600,
};

// ── DOM Elements ────────────────────────────────────
const DOM = {
    dropzone: document.getElementById('dropzone'),
    fileInput: document.getElementById('file-input'),
    cameraInput: document.getElementById('camera-input'),
    browseBtn: document.getElementById('browse-btn'),
    cameraBtn: document.getElementById('camera-btn'),
    previewSection: document.getElementById('preview-section'),
    previewImage: document.getElementById('preview-image'),
    preprocessCanvas: document.getElementById('preprocess-canvas'),
    clearBtn: document.getElementById('clear-btn'),
    processingSection: document.getElementById('processing-section'),
    progressFill: document.getElementById('progress-fill'),
    processingMessage: document.getElementById('processing-message'),
    resultsSection: document.getElementById('results-section'),
    doctorNameArabic: document.getElementById('doctor-name-arabic'),
    doctorNameEnglish: document.getElementById('doctor-name-english'),
    specialty: document.getElementById('specialty'),
    mobile1: document.getElementById('mobile-1'),
    mobile2: document.getElementById('mobile-2'),
    email: document.getElementById('email'),
    address1: document.getElementById('address-1'),
    address2: document.getElementById('address-2'),
    liveLocation: document.getElementById('live-location'),
    saveBtn: document.getElementById('save-btn'),
    newScanBtn: document.getElementById('new-scan-btn'),
    getLocationBtn: document.getElementById('get-location-btn'),
    enhancedModeToggle: document.getElementById('enhanced-mode-toggle'),
    uploadSection: document.getElementById('upload-section'),
    rawTextSection: document.getElementById('raw-text-section'),
    rawTextOutput: document.getElementById('raw-text-output'),
    toast: document.getElementById('toast'),
    toastMessage: document.querySelector('.toast-message'),
    toastIcon: document.querySelector('.toast-icon'),
};

// ── State ───────────────────────────────────────────
let state = {
    imageFile: null,
    ocrText: '',
    isProcessing: false,
    tesseractWorker: null,
};

// ── Initialize ──────────────────────────────────────
function init() {
    setupEventListeners();
    DOM.enhancedModeToggle.classList.add('active');
    warmTesseract();
}

function setupEventListeners() {
    DOM.dropzone.addEventListener('click', (e) => {
        if (e.target.closest('#browse-btn') || e.target.closest('#camera-btn')) return;
        DOM.fileInput.click();
    });
    DOM.dropzone.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); DOM.fileInput.click(); }
    });
    DOM.dropzone.addEventListener('dragover', (e) => { e.preventDefault(); DOM.dropzone.classList.add('drag-over'); });
    DOM.dropzone.addEventListener('dragleave', () => DOM.dropzone.classList.remove('drag-over'));
    DOM.dropzone.addEventListener('drop', handleDrop);
    DOM.browseBtn.addEventListener('click', (e) => { e.stopPropagation(); DOM.fileInput.click(); });
    DOM.cameraBtn.addEventListener('click', (e) => { e.stopPropagation(); DOM.cameraInput.click(); });
    DOM.fileInput.addEventListener('change', handleFileSelect);
    DOM.cameraInput.addEventListener('change', handleFileSelect);
    DOM.clearBtn.addEventListener('click', resetApp);
    DOM.newScanBtn.addEventListener('click', resetApp);
    DOM.saveBtn.addEventListener('click', saveToGoogleSheets);
    DOM.getLocationBtn.addEventListener('click', captureLocation);
    DOM.enhancedModeToggle.addEventListener('click', () => {
        showToast('OCR.space AI engine — free, Arabic + English', 'success');
    });
}

// ══════════════════════════════════════════════════════
//  PRIMARY OCR: OCR.space API
//  Free: 25,000 calls/month | Arabic + English
// ══════════════════════════════════════════════════════

async function runOCRSpace(file) {
    // Run English (Engine 2) and Arabic (Engine 1) in parallel
    // NOTE: Engine 2 is English-only; Engine 1 supports Arabic
    const [engResult, araResult] = await Promise.allSettled([
        callOCRSpace(file, 'eng', 2),
        callOCRSpace(file, 'ara', 1),
    ]);

    const engText = (engResult.status === 'fulfilled' ? engResult.value : '').trim();
    const araText = (araResult.status === 'fulfilled' ? araResult.value : '').trim();

    console.log(`📊 English OCR (${engText.length} chars):`, engText.substring(0, 80));
    console.log(`📊 Arabic  OCR (${araText.length} chars):`, araText.substring(0, 80));
    if (engResult.status === 'rejected') console.warn('⚠️ English OCR failed:', engResult.reason?.message);
    if (araResult.status === 'rejected') console.warn('⚠️ Arabic OCR failed:', araResult.reason?.message);

    const merged = mergeOCRResults(engText, araText);
    if (merged.length > 5) return merged;

    const fallback = engText.length >= araText.length ? engText : araText;
    if (fallback.length > 0) return fallback;

    throw new Error('OCR.space returned no text');
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

async function callOCRSpace(file, language, ocrEngine) {
    const base64 = await fileToBase64(file);
    
    const resp = await fetch(CONFIG.OCR_ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            base64Image: base64,
            language: language,
            ocrEngine: ocrEngine
        }),
        signal: AbortSignal.timeout(35000),
    });

    if (!resp.ok) {
        let errMessage = `HTTP ${resp.status}`;
        try {
            const errData = await resp.json();
            if (errData && errData.error) errMessage = errData.error;
        } catch (e) {}
        throw new Error(`OCR Proxy: ${errMessage}`);
    }

    const data = await resp.json();
    console.log('📊 OCR.space response:', JSON.stringify(data).substring(0, 300));

    if (data.IsErroredOnProcessing) throw new Error(data.ErrorMessage?.[0] || 'OCR.space error');
    if (!data.ParsedResults?.length) throw new Error('No results from OCR.space');

    return data.ParsedResults.map(r => r.ParsedText || '').join('\n').trim();
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
    });
}

// ══════════════════════════════════════════════════════
//  FALLBACK OCR: Tesseract.js
// ══════════════════════════════════════════════════════

async function warmTesseract() {
    try {
        if (!state.tesseractWorker) {
            state.tesseractWorker = await Tesseract.createWorker(CONFIG.TESSERACT_LANGUAGES);
            console.log('🔥 Tesseract.js pre-warmed');
        }
    } catch (e) { console.warn('Tesseract pre-warm failed:', e.message); }
}

async function ensureTesseractWorker() {
    if (!state.tesseractWorker) state.tesseractWorker = await Tesseract.createWorker(CONFIG.TESSERACT_LANGUAGES);
    return state.tesseractWorker;
}

async function runTesseractOCR(imageURL) {
    const canvas = await preprocessImage(imageURL);
    const worker = await ensureTesseractWorker();
    const result = await worker.recognize(canvas);
    return result.data.text || '';
}

function preprocessImage(imageURL) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            try {
                const canvas = DOM.preprocessCanvas;
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                let { width, height } = img;
                const maxDim = CONFIG.MAX_IMAGE_SIZE;
                if (width > maxDim || height > maxDim) {
                    const ratio = Math.min(maxDim / width, maxDim / height);
                    width = Math.round(width * ratio);
                    height = Math.round(height * ratio);
                }
                canvas.width = width; canvas.height = height;
                ctx.drawImage(img, 0, 0, width, height);
                const imageData = ctx.getImageData(0, 0, width, height);
                const d = imageData.data;
                for (let i = 0; i < d.length; i += 4) {
                    const g = Math.max(0, Math.min(255, ((0.299*d[i]+0.587*d[i+1]+0.114*d[i+2]-128)*1.4)+128));
                    d[i] = d[i+1] = d[i+2] = g;
                }
                ctx.putImageData(imageData, 0, 0);
                resolve(canvas);
            } catch (err) { reject(err); }
        };
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = imageURL;
    });
}

// ══════════════════════════════════════════════════════
//  MAIN PROCESSING PIPELINE
// ══════════════════════════════════════════════════════

function handleDrop(e) {
    e.preventDefault();
    DOM.dropzone.classList.remove('drag-over');
    const file = e.dataTransfer?.files?.[0];
    if (file && file.type.startsWith('image/')) processImageFile(file);
    else showToast('Please drop a valid image file', 'error');
}

function handleFileSelect(e) {
    const file = e.target.files?.[0];
    if (file) processImageFile(file);
    e.target.value = '';
}

async function processImageFile(file) {
    if (state.isProcessing) return;
    state.imageFile = file;
    state.isProcessing = true;

    const imageURL = URL.createObjectURL(file);
    DOM.previewImage.src = imageURL;
    DOM.uploadSection.classList.add('hidden');
    DOM.previewSection.classList.remove('hidden');
    DOM.processingSection.classList.remove('hidden');
    DOM.resultsSection.classList.add('hidden');
    DOM.rawTextSection.classList.add('hidden');
    resetPipelineUI();

    let ocrText = '', ocrMethod = '';

    try {
        setStepActive('scan', 'Preparing...');
        updateProgress(5);
        DOM.processingMessage.textContent = 'Preparing image...';
        await sleep(200);
        setStepDone('scan', 'Ready');
        fillConnector(0);
        updateProgress(15);

        setStepActive('ocr', 'Reading text...');
        DOM.processingMessage.textContent = '🔍 Running OCR (Arabic + English)...';
        updateProgress(20);

        try {
            ocrText = await runOCRSpace(file);
            if (ocrText && ocrText.trim().length > 5) {
                ocrMethod = 'OCR.space';
                setStepDone('ocr', '✓ OCR.space');
            } else {
                throw new Error('Insufficient text from OCR.space');
            }
        } catch (ocrErr) {
            console.warn('⚠️ OCR.space failed, falling back to Tesseract:', ocrErr.message);
            setStepActive('ocr', 'Fallback...');
            DOM.processingMessage.textContent = '📝 Trying Tesseract.js...';
            updateProgress(35);
            try {
                ocrText = await runTesseractOCR(imageURL);
                ocrMethod = 'Tesseract.js';
                setStepDone('ocr', '✓ Tesseract');
            } catch (tessErr) {
                ocrText = ''; ocrMethod = 'None';
                setStepDone('ocr', '⚠ Limited');
            }
        }

        state.ocrText = ocrText;
        fillConnector(1);
        updateProgress(75);

        setStepActive('extract', 'Analyzing...');
        DOM.processingMessage.textContent = 'Extracting doctor details...';
        updateProgress(85);
        await sleep(150);

        const fields = extractDoctorFields(ocrText);
        setStepDone('extract', 'Done');
        updateProgress(100);

        const hasData = Object.values(fields).some(v => v && v.trim().length > 0);
        DOM.processingMessage.textContent = hasData
            ? `✓ Complete via ${ocrMethod}`
            : `⚠ No text detected — try a clearer photo`;
        DOM.processingMessage.style.animation = 'none';
        DOM.processingMessage.style.color = hasData ? 'var(--accent-emerald)' : 'var(--accent-amber)';

        populateResults(fields);
        DOM.resultsSection.classList.remove('hidden');
        DOM.rawTextSection.classList.remove('hidden');
        DOM.rawTextOutput.textContent = ocrText || '(No text detected)';
        setTimeout(() => DOM.resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);

    } catch (err) {
        console.error('Processing error:', err);
        showToast('Error: ' + err.message, 'error');
        DOM.processingMessage.textContent = 'Error: ' + err.message;
        DOM.processingMessage.style.animation = 'none';
        DOM.processingMessage.style.color = 'var(--accent-red)';
    } finally {
        state.isProcessing = false;
        URL.revokeObjectURL(imageURL);
    }
}

// ══════════════════════════════════════════════════════
//  SMART FIELD EXTRACTION
// ══════════════════════════════════════════════════════

function extractDoctorFields(rawText) {
    const text = rawText.trim();
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const fields = { doctorNameArabic:'', doctorNameEnglish:'', specialty:'', mobile1:'', mobile2:'', email:'', address1:'', address2:'' };

    const emails = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/gi) || [];
    if (emails.length > 0) fields.email = emails[0];

    const phones = extractPhoneNumbers(text);
    if (phones.length >= 1) fields.mobile1 = phones[0];
    if (phones.length >= 2) fields.mobile2 = phones[1];

    fields.specialty = extractSpecialty(text, lines);
    const names = extractNames(text, lines);
    fields.doctorNameArabic = names.arabic;
    fields.doctorNameEnglish = names.english;

    const addresses = extractAddresses(text, lines, fields);
    fields.address1 = addresses[0] || '';
    fields.address2 = addresses[1] || '';

    return fields;
}

function extractPhoneNumbers(text) {
    const results = new Set();
    const normalized = text.replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660));
    const patterns = [
        /(?:\+?2?0?1[0-9][\s.\-]*[0-9]{3,4}[\s.\-]*[0-9]{3,4})/g,
        /(?:\+?20[\s.\-]?[0-9]{2,3}[\s.\-]?[0-9]{3,4}[\s.\-]?[0-9]{3,4})/g,
        /(?:\+\d{1,3}[\s.\-]?\d{2,4}[\s.\-]?\d{3,4}[\s.\-]?\d{3,4})/g,
        /\b\d[\d\s.\-]{8,15}\d\b/g,
    ];
    for (const pattern of patterns) {
        for (const m of (normalized.match(pattern) || [])) {
            const digits = m.replace(/[^\d+]/g, '');
            if (digits.length >= 8 && digits.length <= 15) results.add(digits);
        }
    }
    return [...results].sort((a, b) => b.length - a.length).slice(0, 2);
}

function extractSpecialty(text, lines) {
    const engSpecs = [
        'Cardiology','Cardiologist','Dermatology','Dermatologist','Neurology','Neurologist',
        'Neurosurgery','Neurosurgeon','Orthopedic','Orthopaedic','Pediatric','Paediatric',
        'Pediatrician','Internal Medicine','Internist','General Surgery','Surgeon','Surgery',
        'Psychiatry','Psychiatrist','Ophthalmology','Ophthalmologist','ENT','Otolaryngology',
        'Gastroenterology','Pulmonology','Pulmonologist','Chest','Endocrinology','Urology',
        'Urologist','Radiology','Radiologist','Anesthesiology','Pathology','Oncology',
        'Rheumatology','Nephrology','Hematology','Haematology','Gynecology','Gynaecology',
        'OB/GYN','Obstetrics','Dentist','Dental','Dentistry','Plastic Surgery',
        'Cosmetic Surgery','Vascular','Hepatology','Family Medicine','Emergency Medicine',
        'ICU','Physiotherapy','Rehabilitation','Allergy','Immunology','Infectious Disease',
        'Sports Medicine','Neonatology','Geriatrics','Consultant','Specialist','Professor',
        'Manager','Director','Associate','Fellow',
    ];
    const araSpecs = [
        'قلب','أمراض القلب','جلدية','أعصاب','مخ وأعصاب','جراحة أعصاب','عظام','جراحة عظام',
        'أطفال','طب أطفال','باطنة','طب باطني','جراحة عامة','نفسية','طب نفسي','عيون',
        'طب عيون','رمد','أنف وأذن وحنجرة','جهاز هضمي','مناظير','صدرية','غدد صماء',
        'مسالك بولية','أشعة','تخدير','أورام','روماتيزم','مفاصل','كلى','دم',
        'نساء وتوليد','أسنان','تجميل','استشاري','أخصائي','أستاذ','مدرس',
    ];
    for (const line of lines) {
        for (const spec of engSpecs) {
            const esc = spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            if (new RegExp(`\\b${esc}\\b`, 'i').test(line)) return line.length < 120 ? line : spec;
        }
    }
    for (const line of lines) {
        for (const spec of araSpecs) {
            if (line.includes(spec)) return line.length < 120 ? line : spec;
        }
    }
    return '';
}

function extractNames(text, lines) {
    const result = { arabic: '', english: '' };

    const araPrefix = /(?:د\.|دكتور[ة]?|الدكتور[ة]?|أ\.د\.?|ا\.د\.?)\s*([\u0600-\u06FF\s]+)/g;
    const am = araPrefix.exec(text);
    if (am) {
        const words = am[1].trim().replace(/[^\u0600-\u06FF\s]/g, '').split(/\s+/).filter(w => w.length > 1).slice(0, 5);
        if (words.length > 0) result.arabic = words.join(' ');
    }
    if (!result.arabic) {
        const skip = ['شارع','طريق','مبنى','عمارة','القاهرة','مصر','عيادة','مستشفى','تليفون','هاتف','عنوان','موبايل'];
        for (const line of lines.slice(0, 6)) {
            const m = line.match(/[\u0600-\u06FF][\u0600-\u06FF\s]+[\u0600-\u06FF]/);
            if (m) {
                const c = m[0].trim();
                if (!skip.some(w => c.includes(w)) && c.length > 3 && c.length < 60) { result.arabic = c; break; }
            }
        }
    }

    const engPat = /(?:Dr\.?\s+|Prof\.?\s+|Professor\s+)([A-Za-z][A-Za-z.\s\-']+?)(?:\s*[,\n]|\s+(?:M\.?D|MBBS|Ph\.?D|FRCS|Specialist|Consultant|Manager|Director)|\s*$)/gi;
    let em;
    while ((em = engPat.exec(text)) !== null) {
        const words = em[1].trim().replace(/[^A-Za-z\s.\-']/g, '').split(/\s+/).filter(w => w.length > 1);
        if (words.length >= 1 && words.length <= 5) { result.english = 'Dr. ' + words.join(' '); break; }
    }
    if (!result.english) {
        const skip2 = ['Street','Road','Building','Floor','Cairo','Egypt','Hospital','Clinic','Medical','Center','Tel','Mobile','Phone','Email','Fax','Address','Website','Web'];
        for (const line of lines.slice(0, 6)) {
            if ((line.match(/[A-Za-z]/g) || []).length < 4) continue;
            if (/@|www\.|http|^\+?\d[\d\s.\-]{7,}/.test(line)) continue;
            const nm = line.match(/([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){1,3})/);
            if (nm) {
                const c = nm[1].trim();
                if (!skip2.some(w => c.includes(w)) && c.length > 4 && c.length < 50) { result.english = c; break; }
            }
        }
    }
    return result;
}

function extractAddresses(text, lines, fields) {
    const addresses = [];
    const kws = [
        'street','road','avenue','building','floor','suite','tower','plaza','mall',
        'cairo','egypt','giza','alexandria','nasr city','maadi','heliopolis','zamalek',
        'mohandessin','katameya','rehab','tagamoa','obour','address','clinic','hospital',
        'شارع','طريق','مبنى','عمارة','الدور','الطابق','القاهرة','مصر','الجيزة',
        'عيادة','مستشفى','مركز','ميدان','حي','منطقة','التجمع','مدينة نصر','المعادي',
    ];
    const used = [fields.email, fields.mobile1, fields.mobile2, fields.specialty,
                  fields.doctorNameArabic, fields.doctorNameEnglish].filter(v => v);
    for (const line of lines) {
        if (used.some(v => line.includes(v) || v.includes(line))) continue;
        if (line.length < 8 || /^\d+$/.test(line.replace(/\s/g, ''))) continue;
        if (/@/.test(line) || /^www\.|^http/.test(line)) continue;
        const low = line.toLowerCase();
        if (kws.some(k => low.includes(k) || line.includes(k)) && addresses.length < 2) addresses.push(line);
    }
    return addresses;
}

// ══════════════════════════════════════════════════════
//  UI HELPERS
// ══════════════════════════════════════════════════════

function resetPipelineUI() {
    ['scan', 'ocr', 'extract'].forEach(step => {
        const el = document.getElementById(`step-${step}`);
        if (el) el.classList.remove('active', 'done', 'error');
        const s = document.getElementById(`step-${step}-status`);
        if (s) s.textContent = 'Waiting...';
    });
    document.querySelectorAll('.pipeline-connector').forEach(c => c.classList.remove('filled'));
    DOM.progressFill.style.width = '0%';
    DOM.processingMessage.style.animation = '';
    DOM.processingMessage.style.color = '';
}

function setStepActive(stepName, statusText) {
    const el = document.getElementById(`step-${stepName}`);
    if (!el) return;
    el.classList.add('active'); el.classList.remove('done', 'error');
    const s = document.getElementById(`step-${stepName}-status`);
    if (s) s.textContent = statusText;
}

function setStepDone(stepName, statusText) {
    const el = document.getElementById(`step-${stepName}`);
    if (!el) return;
    el.classList.remove('active'); el.classList.add('done');
    const s = document.getElementById(`step-${stepName}-status`);
    if (s) s.textContent = statusText;
}

function fillConnector(index) {
    const connectors = document.querySelectorAll('.pipeline-connector');
    if (connectors[index]) connectors[index].classList.add('filled');
}

function updateProgress(percent) { DOM.progressFill.style.width = percent + '%'; }

function populateResults(fields) {
    DOM.doctorNameArabic.value = fields.doctorNameArabic || '';
    DOM.doctorNameEnglish.value = fields.doctorNameEnglish || '';
    DOM.specialty.value = fields.specialty || '';
    DOM.mobile1.value = fields.mobile1 || '';
    DOM.mobile2.value = fields.mobile2 || '';
    DOM.email.value = fields.email || '';
    DOM.address1.value = fields.address1 || '';
    DOM.address2.value = fields.address2 || '';
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ══════════════════════════════════════════════════════
//  GOOGLE SHEETS SAVE
// ══════════════════════════════════════════════════════

async function saveToGoogleSheets() {
    const data = {
        doctorNameArabic: DOM.doctorNameArabic.value.trim(),
        doctorNameEnglish: DOM.doctorNameEnglish.value.trim(),
        specialty: DOM.specialty.value.trim(),
        mobile1: DOM.mobile1.value.trim(),
        mobile2: DOM.mobile2.value.trim(),
        email: DOM.email.value.trim(),
        address1: DOM.address1.value.trim(),
        address2: DOM.address2.value.trim(),
        liveLocation: DOM.liveLocation.value.trim(),
    };

    if (!data.doctorNameArabic && !data.doctorNameEnglish && !data.mobile1) {
        showToast('Please fill in at least a name or mobile number', 'error');
        return;
    }

    DOM.saveBtn.disabled = true;
    const originalHTML = DOM.saveBtn.innerHTML;
    DOM.saveBtn.innerHTML = '<span>Saving...</span>';
    console.log('📤 Sending to Google Sheets proxy:', data);

    try {
        const resp = await fetch(CONFIG.SAVE_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data),
        });

        if (!resp.ok) {
            let errText = `HTTP ${resp.status}`;
            try {
                const errJson = await resp.json();
                if (errJson && errJson.error) errText = errJson.error;
            } catch (e) {}
            throw new Error(errText);
        }

        const result = await resp.json();
        console.log('📊 Save response:', result);

        if (result.success) {
            showToast('Saved to Google Sheets! ✓', 'success');
        } else {
            throw new Error(result.error || 'Failed to save to Google Sheets');
        }
    } catch (err) {
        console.error('❌ Save failed:', err.message);
        showToast('Save failed: ' + err.message, 'error');
    } finally {
        DOM.saveBtn.disabled = false;
        DOM.saveBtn.innerHTML = originalHTML;
    }
}

// ══════════════════════════════════════════════════════
//  GEOLOCATION
// ══════════════════════════════════════════════════════

function captureLocation() {
    if (!navigator.geolocation) { showToast('Geolocation not supported', 'error'); return; }
    DOM.getLocationBtn.classList.add('loading');
    DOM.liveLocation.value = 'Getting location...';
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            DOM.liveLocation.value = `https://maps.google.com/?q=${pos.coords.latitude},${pos.coords.longitude}`;
            DOM.getLocationBtn.classList.remove('loading');
            showToast('Location captured! 📍', 'success');
        },
        (err) => {
            DOM.getLocationBtn.classList.remove('loading');
            DOM.liveLocation.value = '';
            const msgs = { 1: 'Permission denied', 2: 'Location unavailable', 3: 'Request timed out' };
            showToast(msgs[err.code] || 'Unable to get location', 'error');
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
}

// ══════════════════════════════════════════════════════
//  TOAST & RESET
// ══════════════════════════════════════════════════════

function showToast(message, type = 'success') {
    DOM.toastMessage.textContent = message;
    DOM.toast.classList.remove('hidden', 'error');
    DOM.toastIcon.textContent = type === 'success' ? '✓' : '✗';
    if (type === 'error') DOM.toast.classList.add('error');
    void DOM.toast.offsetWidth;
    DOM.toast.classList.add('visible');
    clearTimeout(DOM.toast._hideTimer);
    DOM.toast._hideTimer = setTimeout(() => {
        DOM.toast.classList.remove('visible');
        setTimeout(() => DOM.toast.classList.add('hidden'), 400);
    }, 3500);
}

function resetApp() {
    state.imageFile = null; state.ocrText = ''; state.isProcessing = false;
    DOM.uploadSection.classList.remove('hidden');
    DOM.previewSection.classList.add('hidden');
    DOM.processingSection.classList.add('hidden');
    DOM.resultsSection.classList.add('hidden');
    DOM.rawTextSection.classList.add('hidden');
    DOM.previewImage.src = '';
    DOM.rawTextOutput.textContent = '';
    DOM.doctorNameArabic.value = '';
    DOM.doctorNameEnglish.value = '';
    DOM.specialty.value = '';
    DOM.mobile1.value = '';
    DOM.mobile2.value = '';
    DOM.email.value = '';
    DOM.address1.value = '';
    DOM.address2.value = '';
    DOM.liveLocation.value = '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Boot ────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
