/**
 * SubtitleGenerator — Geração de SRT e VTT no navegador.
 * Port do Python subtitle_service.py para JavaScript ES Module.
 */

function pad(n, digits = 2) {
    return n.toString().padStart(digits, '0');
}

function secsToSRT(totalSecs) {
    const h = Math.floor(totalSecs / 3600);
    const m = Math.floor((totalSecs % 3600) / 60);
    const s = Math.floor(totalSecs % 60);
    const ms = Math.round((totalSecs % 1) * 1000);
    return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

function secsToVTT(totalSecs) {
    return secsToSRT(totalSecs).replace(',', '.');
}

export function generateSRT(segments) {
    return segments.map((seg, i) =>
        `${i + 1}\n${secsToSRT(seg.start)} --> ${secsToSRT(seg.end)}\n${seg.text}`
    ).join('\n\n') + '\n';
}

export function generateVTT(segments) {
    const cues = segments.map((seg, i) =>
        `${i + 1}\n${secsToVTT(seg.start)} --> ${secsToVTT(seg.end)}\n${seg.text}`
    ).join('\n\n');
    return `WEBVTT\n\n${cues}\n`;
}

export function createBlobURL(content, type = 'text/plain') {
    return URL.createObjectURL(new Blob([content], { type }));
}

export function downloadFile(content, filename, type = 'text/plain') {
    const a = document.createElement('a');
    a.href = createBlobURL(content, type);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
}
