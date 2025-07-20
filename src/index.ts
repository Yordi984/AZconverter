import express, { Request, Response } from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { globSync } from "glob";
import ytdlpRaw from "yt-dlp-exec";
import archiver from "archiver";
import { v4 as uuidv4 } from "uuid";

const app = express();
const PORT = 3000;
const BASE_DOWNLOAD_DIR = path.resolve(__dirname, "..", "downloads");

const ytdlp = ytdlpRaw as unknown as (
  url: string,
  options?: Record<string, any>
) => Promise<any>;

app.use(express.json());
app.use(cors({ exposedHeaders: ["Content-Disposition"] }));

if (!fs.existsSync(BASE_DOWNLOAD_DIR)) fs.mkdirSync(BASE_DOWNLOAD_DIR);

// Elimina caracteres no válidos para nombres de archivo
const sanitizeFileName = (name: string): string =>
  name.replace(/[\\/:*?"<>|]/g, "_");

// Limpiar carpeta
const cleanFolder = (folderPath: string) => {
  if (fs.existsSync(folderPath)) {
    fs.readdirSync(folderPath).forEach((file) => {
      const filePath = path.join(folderPath, file);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    });
    fs.rmdirSync(folderPath, { recursive: true });
  }
};

// Validar URL
const isValidYouTubeUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname.includes("youtube.com") ||
      parsed.hostname.includes("youtu.be")
    );
  } catch {
    return false;
  }
};

// 🎵 Descargar video individual
app.post("/download", async (req: Request, res: Response): Promise<void> => {
  const { url } = req.body;

  if (!url || !isValidYouTubeUrl(url)) {
    res.status(400).send("❌ URL de YouTube no válida");
    return;
  }

  const tempDir = path.join(BASE_DOWNLOAD_DIR, uuidv4());
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    // Obtener metadatos para obtener el título exacto
    const info = await ytdlp(url, {
      dumpSingleJson: true,
      noWarnings: true,
    });

    const sanitizedTitle = sanitizeFileName(info.title);
    const outputPath = path.join(tempDir, `${sanitizedTitle}.mp3`);

    console.log(`▶️ Descargando: ${info.title}`);

    await ytdlp(url, {
      extractAudio: true,
      audioFormat: "mp3",
      output: outputPath,
      noWarnings: true,
    });

    if (!fs.existsSync(outputPath)) {
      cleanFolder(tempDir);
      res.status(404).send("❌ No se encontró archivo MP3");
      return;
    }

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(sanitizedTitle)}.mp3"`
    );
    res.setHeader("Content-Type", "audio/mpeg");

    const stream = fs.createReadStream(outputPath);
    stream.pipe(res);

    stream.on("close", () => cleanFolder(tempDir));
    stream.on("error", (err) => {
      console.error("❌ Error al transmitir:", err);
      cleanFolder(tempDir);
      if (!res.headersSent) {
        res.status(500).send("❌ Error al enviar el archivo");
      }
    });
  } catch (err) {
    console.error("❌ Error al procesar:", err);
    cleanFolder(tempDir);
    res.status(500).send("❌ Error al procesar el video");
  }
});

// 📦 Descargar playlist
app.post("/playlist", async (req: Request, res: Response): Promise<void> => {
  const { url } = req.body;

  if (!url || !url.includes("playlist?list=")) {
    res.status(400).send("❌ URL de playlist no válida");
    return;
  }

  const tempDir = path.join(BASE_DOWNLOAD_DIR, uuidv4());
  const zipFileName = `${uuidv4()}.zip`;
  const zipPath = path.join(BASE_DOWNLOAD_DIR, zipFileName);
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    // Obtener metadatos de la playlist
    const playlistInfo = await ytdlp(url, {
      dumpSingleJson: true,
      noWarnings: true,
    });

    const entries = playlistInfo.entries as any[];

    // Descargar cada video individualmente
    for (const video of entries) {
      const videoUrl = `https://www.youtube.com/watch?v=${video.id}`;
      const sanitizedTitle = sanitizeFileName(video.title);
      const outputPath = path.join(tempDir, `${sanitizedTitle}.mp3`);

      console.log(`🎧 Descargando: ${video.title}`);

      await ytdlp(videoUrl, {
        extractAudio: true,
        audioFormat: "mp3",
        output: outputPath,
        noWarnings: true,
      });
    }

    const files = globSync(`${tempDir}/*.mp3`);
    if (files.length === 0) {
      cleanFolder(tempDir);
      res.status(404).send("❌ No se encontraron MP3");
      return;
    }

    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => {
      res.download(zipPath, "playlist.zip", (err) => {
        if (err) console.error("❌ Error al enviar ZIP:", err);
        files.forEach((file) => fs.unlinkSync(file));
        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
        cleanFolder(tempDir);
      });
    });

    archive.on("error", (err) => {
      throw err;
    });

    archive.pipe(output);
    files.forEach((file) => {
      archive.file(file, { name: path.basename(file) });
    });

    await archive.finalize();
  } catch (err) {
    console.error("❌ Error al procesar playlist:", err);
    cleanFolder(tempDir);
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    res.status(500).send("❌ Error al procesar la playlist");
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor activo en http://0.0.0.0:${PORT}`);
});
