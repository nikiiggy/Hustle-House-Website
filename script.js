// --- PLAYLIST SOURCE ---
// Playlist lagu diambil dari npoint.io, BUKAN hardcode di sini.
// Mau nambah/ubah lagu? Buka URL ini, edit langsung di editornya, save.
// Format tiap item wajib: { "title": "...", "src": "https://..." }
const PLAYLIST_URL = "https://api.npoint.io/f24ffd31e695999ad25c";

let songs = []; // diisi oleh loadPlaylist()

let currentSong = null;   // lagu yang sedang dimuat/diputar (tidak lagi ada di playQueue)
let playQueue = [];       // antrean lagu berikutnya (FIFO, hanya yang BELUM diputar)
let historyStack = [];    // riwayat lagu yang sudah lewat, dipakai tombol Prev, TIDAK ditampilkan di UI
let currentTab = 'all';   // 'all' | 'queue'

// DOM Elements
const audioPlayer = document.getElementById('audioPlayer');
const songListEl = document.getElementById('songList');
const currentTitleEl = document.getElementById('currentTitle');
const playPauseBtn = document.getElementById('playPauseBtn');
const progressBar = document.getElementById('progressBar');
const currentTimeEl = document.getElementById('currentTime');
const durationEl = document.getElementById('duration');
const fxToggleBtn = document.getElementById('fxToggleBtn');
const visualizerCanvas = document.getElementById('visualizer');
const visCtx = visualizerCanvas ? visualizerCanvas.getContext('2d') : null;
const queueBadge = document.getElementById('queueBadge');

// --- WEB AUDIO API (DSP FX ENGINE) ---
let audioCtx;
let sourceNode;
let lowFilter, midFilter, highFilter;
let wetGain, dryGain, masterGain;
let analyser, analyserData;
let isAudioFxInitialized = false;
let fxEnabled = true;
let fxSilenceChecked = false;
let visRafId = null;

function initAudioEffects() {
    if (isAudioFxInitialized || !audioPlayer) return;

    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        sourceNode = audioCtx.createMediaElementSource(audioPlayer);

        lowFilter = audioCtx.createBiquadFilter();
        lowFilter.type = 'lowshelf';
        lowFilter.frequency.value = 250;
        lowFilter.gain.value = 3;

        midFilter = audioCtx.createBiquadFilter();
        midFilter.type = 'peaking';
        midFilter.frequency.value = 1500;
        midFilter.gain.value = 0;

        highFilter = audioCtx.createBiquadFilter();
        highFilter.type = 'highshelf';
        highFilter.frequency.value = 4000;
        highFilter.gain.value = -10;

        const impulseBuffer = createReverbImpulse(2.5, 0.85, 0.9);
        const convolver = audioCtx.createConvolver();
        convolver.buffer = impulseBuffer;

        wetGain = audioCtx.createGain();
        dryGain = audioCtx.createGain();
        masterGain = audioCtx.createGain();

        wetGain.gain.value = Math.pow(10, -8 / 20);
        dryGain.gain.value = 1.0;
        masterGain.gain.value = 1.0;

        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 64;
        analyserData = new Uint8Array(analyser.frequencyBinCount);

        sourceNode.connect(lowFilter);
        lowFilter.connect(midFilter);
        midFilter.connect(highFilter);

        highFilter.connect(dryGain);
        dryGain.connect(masterGain);

        highFilter.connect(convolver);
        convolver.connect(wetGain);
        wetGain.connect(masterGain);

        masterGain.connect(analyser);
        analyser.connect(audioCtx.destination);

        isAudioFxInitialized = true;
    } catch (e) {
        console.warn("Web Audio API tidak tersedia / diblokir. Player standar tetap dipakai.", e);
    }
}

// Jika host lagu (catbox) tidak mengirim header CORS, graph Web Audio akan
// diam total (spec-compliant tainted-audio behaviour) meski tidak melempar error.
// Deteksi kondisi itu sekali per lagu lalu bypass ke koneksi langsung.
function checkFxSilence() {
    if (!isAudioFxInitialized || !analyser || fxSilenceChecked) return;
    fxSilenceChecked = true;

    setTimeout(() => {
        if (!isAudioFxInitialized || audioPlayer.paused) return;
        analyser.getByteFrequencyData(analyserData);
        const sum = analyserData.reduce((a, b) => a + b, 0);
        if (sum === 0) {
            try {
                sourceNode.disconnect();
                sourceNode.connect(masterGain);
                masterGain.gain.value = 1.0;
                console.warn("Lagu ini diproteksi CORS oleh host, efek audio dinonaktifkan otomatis untuk lagu ini.");
                if (fxToggleBtn) {
                    fxToggleBtn.classList.add('disabled');
                    fxToggleBtn.title = "Efek audio tidak tersedia untuk lagu ini (CORS)";
                }
            } catch (e) { /* noop */ }
        }
    }, 700);
}

function createReverbImpulse(decay, density, diffusion) {
    const rate = audioCtx.sampleRate;
    const length = rate * decay;
    const impulse = audioCtx.createBuffer(2, length, rate);
    const left = impulse.getChannelData(0);
    const right = impulse.getChannelData(1);

    for (let i = 0; i < length; i++) {
        const n = i / length;
        const decayFactor = Math.pow(1 - n, decay * 1.5);

        if (Math.random() < density) {
            const noiseL = (Math.random() * 2 - 1) * decayFactor;
            const noiseR = (Math.random() * 2 - 1) * decayFactor;
            left[i] = noiseL * diffusion + noiseR * (1 - diffusion);
            right[i] = noiseR * diffusion + noiseL * (1 - diffusion);
        } else {
            left[i] = 0;
            right[i] = 0;
        }
    }
    return impulse;
}

function toggleAudioFX() {
    fxEnabled = !fxEnabled;
    if (fxToggleBtn) {
        fxToggleBtn.classList.toggle('active', fxEnabled);
        fxToggleBtn.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> FX ${fxEnabled ? 'ON' : 'OFF'}`;
    }
    if (!isAudioFxInitialized || !audioCtx) return;
    const now = audioCtx.currentTime;
    wetGain.gain.setTargetAtTime(fxEnabled ? Math.pow(10, -8 / 20) : 0, now, 0.15);
    lowFilter.gain.setTargetAtTime(fxEnabled ? 3 : 0, now, 0.15);
    highFilter.gain.setTargetAtTime(fxEnabled ? -10 : 0, now, 0.15);
}

// --- PLAYLIST LOADING (dari npoint.io) ---
async function loadPlaylist() {
    songListEl.innerHTML = '<div class="empty-state">Memuat daftar lagu...</div>';
    try {
        const res = await fetch(PLAYLIST_URL, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        songs = data.map((s, i) => ({ id: i + 1, title: s.title, src: s.src }));
    } catch (e) {
        console.error("Gagal memuat playlist dari npoint:", e);
        songListEl.innerHTML = '<div class="empty-state">Gagal memuat daftar lagu. Coba refresh halaman.</div>';
        showToast('Gagal memuat playlist', 'fa-triangle-exclamation');
        return;
    }
    renderSongs();
}

// --- App Initialization ---
window.onload = async () => {
    await loadPlaylist();
    initFireflies();

    document.body.addEventListener('click', () => {
        initAudioEffects();
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
    }, { once: true });
};

// --- TOAST NOTIFICATIONS ---
let toastContainer = null;
function showToast(message, icon = 'fa-list-ul') {
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.className = 'toast-container';
        document.body.appendChild(toastContainer);
    }
    const toast = document.createElement('div');
    toast.className = 'toast';
    const iconEl = document.createElement('i');
    iconEl.className = `fa-solid ${icon}`;
    const textEl = document.createElement('span');
    textEl.textContent = message;
    toast.appendChild(iconEl);
    toast.appendChild(textEl);
    toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 2600);
}

// --- Render Song / Queue List ---
function renderSongs() {
    songListEl.innerHTML = '';

    const isQueueTab = currentTab === 'queue';
    const list = isQueueTab ? playQueue : songs;

    if (list.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = isQueueTab
            ? 'Antrean kosong. Pilih lagu dari Daftar Lagu.'
            : 'Lagu tidak ditemukan.';
        songListEl.appendChild(empty);
        return;
    }

    const fragment = document.createDocumentFragment();
    list.forEach((song, i) => {
        const item = document.createElement('div');
        const isCurrentSong = !isQueueTab && currentSong?.id === song.id;
        item.className = `song-item ${isCurrentSong ? 'active' : ''}`;

        const clickAction = isQueueTab ? `playFromQueue(${i})` : `addToQueue(${song.id})`;
        const numberLabel = isQueueTab
            ? `<span class="queue-index">${i + 1}</span>`
            : `<i class="fa-solid fa-music"></i>`;

        item.innerHTML = `
            <div class="song-info" onclick="${clickAction}">
                ${numberLabel}
                <span>${song.title}</span>
            </div>
        `;
        fragment.appendChild(item);
    });
    songListEl.appendChild(fragment);
}

function updateQueueBadge() {
    if (queueBadge) queueBadge.textContent = playQueue.length > 0 ? playQueue.length : '';
}

function switchTab(tab, evt) {
    currentTab = tab;
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    (evt?.target?.closest('.tab-btn') || evt?.currentTarget)?.classList.add('active');
    renderSongs();
}

let searchDebounce = null;
function filterSongs() {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
        const query = document.getElementById('searchInput').value.toLowerCase();
        const items = songListEl.getElementsByClassName('song-item');
        Array.from(items).forEach(item => {
            const title = item.innerText.toLowerCase();
            item.style.display = title.includes(query) ? 'flex' : 'none';
        });
    }, 120);
}

// --- QUEUE & PLAYER CONTROLS ---

// Klik lagu dari Daftar Lagu -> masuk ke ujung antrean.
function addToQueue(id) {
    const song = songs.find(s => s.id === id);
    if (!song) return;

    playQueue.push(song);
    showToast(`Ditambahkan ke antrean: ${song.title}`, 'fa-list-ul');
    updateQueueBadge();

    if (currentSong === null) {
        // Belum ada yang diputar sama sekali -> langsung muat lagu ini (tanpa auto-play).
        advanceToNext(false);
    } else {
        renderSongs();
    }
}

// Pindah ke lagu berikutnya: ambil dari depan antrean (lalu lagu itu HILANG dari antrean),
// atau kalau antrean kosong, putar lagu acak.
function advanceToNext(autoPlay = true) {
    if (currentSong !== null) {
        historyStack.push(currentSong);
    }

    if (playQueue.length > 0) {
        currentSong = playQueue.shift();
    } else {
        currentSong = songs[Math.floor(Math.random() * songs.length)];
        showToast(`Memutar acak: ${currentSong.title}`, 'fa-shuffle');
    }

    loadCurrentSong();
    updateQueueBadge();
    if (autoPlay) playCurrent();
}

// Klik lagu langsung dari tab Antrean -> putar sekarang, keluar dari antrean.
function playFromQueue(index) {
    if (index < 0 || index >= playQueue.length) return;
    const song = playQueue.splice(index, 1)[0];
    if (currentSong !== null) historyStack.push(currentSong);
    currentSong = song;
    loadCurrentSong();
    updateQueueBadge();
    playCurrent();
}

function loadCurrentSong() {
    if (!currentSong) return;
    audioPlayer.src = currentSong.src;
    currentTitleEl.innerText = currentSong.title;
    fxSilenceChecked = false;
    renderSongs();
}

function playCurrent() {
    initAudioEffects();
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    audioPlayer.play().then(() => {
        playPauseBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';
        playPauseBtn.classList.add('is-playing');
        checkFxSilence();
        startVisualizer();
    }).catch(err => {
        console.error("Gagal memutar audio:", err);
    });
}

function pauseCurrent() {
    audioPlayer.pause();
    playPauseBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
    playPauseBtn.classList.remove('is-playing');
    stopVisualizer();
}

function togglePlay() {
    if (currentSong === null) {
        advanceToNext(true); // antrean isi -> ambil depan; antrean kosong -> acak
        return;
    }
    if (audioPlayer.paused) {
        playCurrent();
    } else {
        pauseCurrent();
    }
}

// Next SELALU langsung memutar lagu berikutnya, apapun status play/pause sebelumnya.
function nextSong() {
    advanceToNext(true);
}

// Prev pakai riwayat tersembunyi (bukan antrean) karena lagu yang sudah lewat
// sengaja tidak ditampilkan lagi di daftar antrean.
function prevSong() {
    if (historyStack.length === 0) return;
    if (currentSong !== null) playQueue.unshift(currentSong);
    currentSong = historyStack.pop();
    loadCurrentSong();
    updateQueueBadge();
    playCurrent();
}

// --- Progress Bar ---
audioPlayer.ontimeupdate = () => {
    if (!isNaN(audioPlayer.duration)) {
        progressBar.max = audioPlayer.duration;
        progressBar.value = audioPlayer.currentTime;
        currentTimeEl.innerText = formatTime(audioPlayer.currentTime);
        durationEl.innerText = formatTime(audioPlayer.duration);
    }
};

audioPlayer.onended = () => {
    if (document.getElementById('autoplayToggle').checked) {
        nextSong();
    } else {
        playPauseBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
        playPauseBtn.classList.remove('is-playing');
        stopVisualizer();
    }
};

function seekSong() {
    audioPlayer.currentTime = progressBar.value;
}

function formatTime(seconds) {
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${min < 10 ? '0' : ''}${min}:${sec < 10 ? '0' : ''}${sec}`;
}

function adjustMusicVolume() {
    audioPlayer.volume = document.getElementById('musicVolume').value;
}

// --- FULLSCREEN FEATURE ---
function toggleFullscreen() {
    if (!document.fullscreenElement && !document.webkitFullscreenElement && !document.msFullscreenElement) {
        const docEl = document.documentElement;
        if (docEl.requestFullscreen) docEl.requestFullscreen();
        else if (docEl.webkitRequestFullscreen) docEl.webkitRequestFullscreen();
        else if (docEl.msRequestFullscreen) docEl.msRequestFullscreen();
    } else {
        if (document.exitFullscreen) document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        else if (document.msExitFullscreen) document.msExitFullscreen();
    }
}

document.addEventListener('fullscreenchange', updateFullscreenIcon);
document.addEventListener('webkitfullscreenchange', updateFullscreenIcon);
document.addEventListener('msfullscreenchange', updateFullscreenIcon);

function updateFullscreenIcon() {
    const fsBtn = document.getElementById('fullscreenBtn');
    if (!fsBtn) return;
    const isFs = document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement;
    fsBtn.innerHTML = isFs ? '<i class="fa-solid fa-compress"></i>' : '<i class="fa-solid fa-expand"></i>';
}

// --- AUDIO-REACTIVE VISUALIZER ---
function startVisualizer() {
    if (!visCtx || visRafId) return;
    drawVisualizer();
}

function stopVisualizer() {
    if (visRafId) {
        cancelAnimationFrame(visRafId);
        visRafId = null;
    }
    if (visCtx) visCtx.clearRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);
}

function drawVisualizer() {
    visRafId = requestAnimationFrame(drawVisualizer);
    const w = visualizerCanvas.width;
    const h = visualizerCanvas.height;
    visCtx.clearRect(0, 0, w, h);

    if (!analyser) return;
    analyser.getByteFrequencyData(analyserData);

    const barCount = 28;
    const step = Math.floor(analyserData.length / barCount) || 1;
    const barWidth = w / barCount;

    for (let i = 0; i < barCount; i++) {
        const value = analyserData[i * step] || 0;
        const barHeight = Math.max(2, (value / 255) * h);
        const x = i * barWidth;
        const y = h - barHeight;
        const grad = visCtx.createLinearGradient(0, y, 0, h);
        grad.addColorStop(0, '#ffb37a');
        grad.addColorStop(1, 'rgba(255, 138, 76, 0.15)');
        visCtx.fillStyle = grad;
        visCtx.fillRect(x + 1, y, barWidth - 2, barHeight);
    }
}

function resizeVisualizer() {
    if (!visualizerCanvas) return;
    const rect = visualizerCanvas.getBoundingClientRect();
    visualizerCanvas.width = rect.width * devicePixelRatio;
    visualizerCanvas.height = rect.height * devicePixelRatio;
}
window.addEventListener('resize', resizeVisualizer);

// --- FIREFLY AMBIENT PARTICLES (lightweight canvas, no libraries) ---
function initFireflies() {
    const canvas = document.getElementById('fireflyCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let particles = [];
    let rafId = null;

    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }

    function makeParticles(count) {
        particles = Array.from({ length: count }, () => ({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            r: Math.random() * 1.6 + 0.6,
            speedX: (Math.random() - 0.5) * 0.15,
            speedY: (Math.random() - 0.5) * 0.15,
            baseAlpha: Math.random() * 0.5 + 0.3,
            flicker: Math.random() * Math.PI * 2
        }));
    }

    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        particles.forEach(p => {
            p.x += p.speedX;
            p.y += p.speedY;
            p.flicker += 0.03;

            if (p.x < 0) p.x = canvas.width;
            if (p.x > canvas.width) p.x = 0;
            if (p.y < 0) p.y = canvas.height;
            if (p.y > canvas.height) p.y = 0;

            const alpha = p.baseAlpha * (0.6 + 0.4 * Math.sin(p.flicker));
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 179, 122, ${alpha})`;
            ctx.shadowBlur = 6;
            ctx.shadowColor = 'rgba(255, 138, 76, 0.6)';
            ctx.fill();
        });
        rafId = requestAnimationFrame(draw);
    }

    resize();
    makeParticles(window.innerWidth < 600 ? 14 : 24);
    draw();

    window.addEventListener('resize', () => {
        resize();
        makeParticles(window.innerWidth < 600 ? 14 : 24);
    });

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            if (rafId) cancelAnimationFrame(rafId);
            rafId = null;
        } else if (!rafId) {
            draw();
        }
    });
}

resizeVisualizer();

// Tambahkan di script.js agar nama lagu & kontrol muncul di notifikasi HP
if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', () => togglePlay());
    navigator.mediaSession.setActionHandler('pause', () => togglePlay());
    navigator.mediaSession.setActionHandler('nexttrack', () => playNext());
    navigator.mediaSession.setActionHandler('previoustrack', () => playPrev());
}
