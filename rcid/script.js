let currentImageUrl = "";
let currentGroupName = "";
let currentUsername = "";

const GAS_URL = "https://script.google.com/macros/s/AKfycbxCeHfsu9vpmPSAyCODpmdlyChyaTaCfeVQRBmVDiKuhUKpBQLD5UVmSPIbE2CeKoOV1Q/exec";

async function fetchCommunityLogo() {
    const input = document.getElementById("username").value.trim();
    const status = document.getElementById("status");
    const searchBtn = document.getElementById("searchBtn");
    const downloadBtn = document.getElementById("downloadBtn");
    const previewImg = document.getElementById("previewImg");
    const previewText = document.getElementById("previewText");

    if (!input) {
        alert("Silakan masukkan Username terlebih dahulu!");
        return;
    }

    searchBtn.disabled = true;
    downloadBtn.disabled = true;
    status.style.color = "#fbbf24";
    status.innerText = "Status: Memproses via Google Apps Script...";

    try {
        const response = await fetch(`${GAS_URL}?username=${encodeURIComponent(input)}`);
        const data = await response.json();

        if (data.error) {
            status.style.color = "#f43f5e";
            status.innerText = `Status: ${data.error}`;
            searchBtn.disabled = false;
            return;
        }

        currentUsername = data.username;
        currentGroupName = data.groupName;
        currentImageUrl = data.imageUrl;

        // Render Gambar Preview
        previewImg.src = currentImageUrl;
        previewImg.style.display = "block";
        previewText.style.display = "none";

        // Pasang event click langsung ke gambar agar pasti bisa diklik zoom
        previewImg.onclick = function() {
            openModal(currentImageUrl);
        };

        status.style.color = "#22c55e";
        status.innerText = `Grup: ${currentGroupName} (${currentUsername})`;
        downloadBtn.disabled = false;

    } catch (err) {
        status.style.color = "#f43f5e";
        status.innerText = "Status: Terjadi kesalahan koneksi!";
        console.error(err);
    } finally {
        searchBtn.disabled = false;
    }
}

// Fungsi Modal Zoom
function openModal(imageSrc) {
    const modal = document.getElementById("imageModal");
    const imgFull = document.getElementById("imgFull");
    const caption = document.getElementById("modalCaption");

    modal.style.display = "flex";
    imgFull.src = imageSrc;
    caption.innerText = `Logo Community: ${currentGroupName} (${currentUsername})`;
}

function closeModal() {
    document.getElementById("imageModal").style.display = "none";
}

// Tutup modal jika area luar gambar atau latar belakang diklik
document.getElementById("imageModal").addEventListener("click", function(e) {
    if (e.target === this) {
        closeModal();
    }
});

// Tutup modal pakai tombol Esc
document.addEventListener("keydown", function(e) {
    if (e.key === "Escape") {
        closeModal();
    }
});

// Fungsi Download 2000x2000px
async function downloadImage() {
    if (!currentImageUrl) return;

    try {
        const status = document.getElementById("status");
        status.innerText = "Status: Memproses resolusi 2000x2000px...";

        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = currentImageUrl;

        img.onload = function () {
            const canvas = document.createElement("canvas");
            canvas.width = 2000;
            canvas.height = 2000;

            const ctx = canvas.getContext("2d");
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "high";
            ctx.drawImage(img, 0, 0, 2000, 2000);

            canvas.toBlob(function (blob) {
                const cleanGroupName = currentGroupName.replace(/[^a-zA-Z0-9_-]/g, "_");
                const fileName = `${currentUsername}_${cleanGroupName}_2000x2000.png`;

                const link = document.createElement("a");
                link.href = URL.createObjectURL(blob);
                link.download = fileName;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);

                status.innerText = `Grup: ${currentGroupName} (Berhasil diunduh HD!)`;
            }, "image/png");
        };

        img.onerror = function () {
            window.open(currentImageUrl, '_blank');
        };

    } catch (e) {
        window.open(currentImageUrl, '_blank');
    }
}

document.getElementById("username").addEventListener("keypress", function(e) {
    if (e.key === "Enter") fetchCommunityLogo();
});
