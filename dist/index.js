"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const glob_1 = require("glob");
const yt_dlp_exec_1 = __importDefault(require("yt-dlp-exec"));
const archiver_1 = __importDefault(require("archiver"));
const uuid_1 = require("uuid");
const app = (0, express_1.default)();
const PORT = 3000;
const BASE_DOWNLOAD_DIR = path_1.default.resolve(__dirname, "..", "downloads");
const ytdlp = yt_dlp_exec_1.default;
app.use(express_1.default.json());
app.use((0, cors_1.default)({ exposedHeaders: ["Content-Disposition"] }));
if (!fs_1.default.existsSync(BASE_DOWNLOAD_DIR))
    fs_1.default.mkdirSync(BASE_DOWNLOAD_DIR);
// Elimina caracteres no válidos para nombres de archivo
const sanitizeFileName = (name) => name.replace(/[\\/:*?"<>|]/g, "_");
// Limpiar carpeta
const cleanFolder = (folderPath) => {
    if (fs_1.default.existsSync(folderPath)) {
        fs_1.default.readdirSync(folderPath).forEach((file) => {
            const filePath = path_1.default.join(folderPath, file);
            if (fs_1.default.existsSync(filePath))
                fs_1.default.unlinkSync(filePath);
        });
        fs_1.default.rmdirSync(folderPath, { recursive: true });
    }
};
// Validar URL
const isValidYouTubeUrl = (url) => {
    try {
        const parsed = new URL(url);
        return (parsed.hostname.includes("youtube.com") ||
            parsed.hostname.includes("youtu.be"));
    }
    catch (_a) {
        return false;
    }
};
// 🎵 Descargar video individual
app.post("/download", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { url } = req.body;
    if (!url || !isValidYouTubeUrl(url)) {
        res.status(400).send("❌ URL de YouTube no válida");
        return;
    }
    const tempDir = path_1.default.join(BASE_DOWNLOAD_DIR, (0, uuid_1.v4)());
    fs_1.default.mkdirSync(tempDir, { recursive: true });
    try {
        // Obtener metadatos para obtener el título exacto
        const info = yield ytdlp(url, {
            dumpSingleJson: true,
            noWarnings: true,
        });
        const sanitizedTitle = sanitizeFileName(info.title);
        const outputPath = path_1.default.join(tempDir, `${sanitizedTitle}.mp3`);
        console.log(`▶️ Descargando: ${info.title}`);
        yield ytdlp(url, {
            extractAudio: true,
            audioFormat: "mp3",
            output: outputPath,
            noWarnings: true,
        });
        if (!fs_1.default.existsSync(outputPath)) {
            cleanFolder(tempDir);
            res.status(404).send("❌ No se encontró archivo MP3");
            return;
        }
        res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(sanitizedTitle)}.mp3"`);
        res.setHeader("Content-Type", "audio/mpeg");
        const stream = fs_1.default.createReadStream(outputPath);
        stream.pipe(res);
        stream.on("close", () => cleanFolder(tempDir));
        stream.on("error", (err) => {
            console.error("❌ Error al transmitir:", err);
            cleanFolder(tempDir);
            if (!res.headersSent) {
                res.status(500).send("❌ Error al enviar el archivo");
            }
        });
    }
    catch (err) {
        console.error("❌ Error al procesar:", err);
        cleanFolder(tempDir);
        res.status(500).send("❌ Error al procesar el video");
    }
}));
// 📦 Descargar playlist
app.post("/playlist", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { url } = req.body;
    if (!url || !url.includes("playlist?list=")) {
        res.status(400).send("❌ URL de playlist no válida");
        return;
    }
    const tempDir = path_1.default.join(BASE_DOWNLOAD_DIR, (0, uuid_1.v4)());
    const zipFileName = `${(0, uuid_1.v4)()}.zip`;
    const zipPath = path_1.default.join(BASE_DOWNLOAD_DIR, zipFileName);
    fs_1.default.mkdirSync(tempDir, { recursive: true });
    try {
        // Obtener metadatos de la playlist
        const playlistInfo = yield ytdlp(url, {
            dumpSingleJson: true,
            noWarnings: true,
        });
        const entries = playlistInfo.entries;
        // Descargar cada video individualmente
        for (const video of entries) {
            const videoUrl = `https://www.youtube.com/watch?v=${video.id}`;
            const sanitizedTitle = sanitizeFileName(video.title);
            const outputPath = path_1.default.join(tempDir, `${sanitizedTitle}.mp3`);
            console.log(`🎧 Descargando: ${video.title}`);
            yield ytdlp(videoUrl, {
                extractAudio: true,
                audioFormat: "mp3",
                output: outputPath,
                noWarnings: true,
            });
        }
        const files = (0, glob_1.globSync)(`${tempDir}/*.mp3`);
        if (files.length === 0) {
            cleanFolder(tempDir);
            res.status(404).send("❌ No se encontraron MP3");
            return;
        }
        const output = fs_1.default.createWriteStream(zipPath);
        const archive = (0, archiver_1.default)("zip", { zlib: { level: 9 } });
        output.on("close", () => {
            res.download(zipPath, "playlist.zip", (err) => {
                if (err)
                    console.error("❌ Error al enviar ZIP:", err);
                files.forEach((file) => fs_1.default.unlinkSync(file));
                if (fs_1.default.existsSync(zipPath))
                    fs_1.default.unlinkSync(zipPath);
                cleanFolder(tempDir);
            });
        });
        archive.on("error", (err) => {
            throw err;
        });
        archive.pipe(output);
        files.forEach((file) => {
            archive.file(file, { name: path_1.default.basename(file) });
        });
        yield archive.finalize();
    }
    catch (err) {
        console.error("❌ Error al procesar playlist:", err);
        cleanFolder(tempDir);
        if (fs_1.default.existsSync(zipPath))
            fs_1.default.unlinkSync(zipPath);
        res.status(500).send("❌ Error al procesar la playlist");
    }
}));
app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Servidor activo en http://0.0.0.0:${PORT}`);
});
//# sourceMappingURL=index.js.map