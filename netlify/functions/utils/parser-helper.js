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

module.exports = { extractDoctorFields };
