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
    const imgContainer = document.getElementById("imgContainer");

    if (!input) {
        alert("Silakan masukkan Username terlebih dahulu!");
        return;
    }

    searchBtn.disabled = true;
    downloadBtn.disabled = true;
    status.className = "bg-black/60 border border-yellow-400/30 rounded-xl p-3 text-xs font-semibold text-yellow-400 mb-6 text-center truncate";
    status.innerText = "Status: Memproses data...";

    try {
        const response = await fetch(`${GAS_URL}?username=${encodeURIComponent(input)}`);
        const data = await response.json();

        if (data.error) {
            status.className = "bg-black/60 border border-red-500/30 rounded-xl p-3 text-xs font-semibold text-red-400 mb-6 text-center truncate";
            status.innerText = `Status: ${data.error}`;
            searchBtn.disabled = false;
            return;
        }

        currentUsername = data.username;
        currentGroupName = data.groupName;
        currentImageUrl = data.imageUrl;

        previewImg.src = currentImageUrl;
        imgContainer.classList.remove("hidden");
        previewText.classList.add("hidden");

        status.className = "bg-black/60 border border-green-500/30 rounded-xl p-3 text-xs font-semibold text-green-400 mb-6 text-center truncate";
        status.innerText = `Grup: ${currentGroupName} (@${currentUsername})`;
        downloadBtn.disabled = false;

    } catch (err) {
        status.className = "bg-black/60 border border-red-500/30 rounded-xl p-3 text-xs font-semibold text-red-400 mb-6 text-center truncate";
        status.innerText = "Status: Terjadi kesalahan koneksi!";
        console.error(err);
    } finally {
        searchBtn.disabled = false;
    }
}

// FUNGSI MODAL LIGHTBOX
function openModal() {
    if (!currentImageUrl) return;

    const modal = document.getElementById("imageModal");
    const imgFull = document.getElementById("imgFull");
    const caption = document.getElementById("modalCaption");

    imgFull.src = currentImageUrl;
    caption.innerText = `Logo Community: ${currentGroupName} (@${currentUsername})`;

    modal.classList.remove("hidden");
    modal.classList.add("flex");
}

function closeModal() {
    const modal = document.getElementById("imageModal");
    modal.classList.add("hidden");
    modal.classList.remove("flex");
}

function closeModalOnOuterClick(event) {
    if (event.target.id === "imageModal") {
        closeModal();
    }
}

document.addEventListener("keydown", function(e) {
    if (e.key === "Escape") {
        closeModal();
    }
});

// FUNGSI DOWNLOAD HD 2000x2000px
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