import express, { Request, Response } from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { globSync } from "glob";
import ytdlpRaw from "yt-dlp-exec";
import archiver from "archiver";
import { v4 as uuidv4 } from "uuid";
import pLimit from "p-limit"; // npm install p-limit

const app = express();
const PORT = 3000;
const BASE_DOWNLOAD_DIR = path.resolve(__dirname, "..", "downloads");

const ytdlp = ytdlpRaw as unknown as (
  url: string,
  options?: Record<string, any>
) => Promise<any>;

app.use(express.json());
app.use(
  cors({
    origin: "*",
    methods: ["POST", "OPTIONS"],
    exposedHeaders: ["Content-Disposition"],
  })
);

app.options("*", cors());

if (!fs.existsSync(BASE_DOWNLOAD_DIR)) fs.mkdirSync(BASE_DOWNLOAD_DIR);

// 🔹 Elimina caracteres no válidos para nombres de archivo
const sanitizeFileName = (name: string): string =>
  name.replace(/[\\/:*?"<>|]/g, "_");

// 🔹 Limpiar carpeta
const cleanFolder = (folderPath: string) => {
  if (fs.existsSync(folderPath)) {
    fs.readdirSync(folderPath).forEach((file) => {
      const filePath = path.join(folderPath, file);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    });
    fs.rmdirSync(folderPath, { recursive: true });
  }
};

// 🔹 Validar URL
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

//
// 🎵 Descargar video individual (stream directo sin guardar en disco)
//
app.post("/download", async (req: Request, res: Response): Promise<void> => {
  const { url } = req.body;

  if (!url || !isValidYouTubeUrl(url)) {
    res.status(400).send("❌ URL de YouTube no válida");
    return;
  }

  try {
    // Solo obtenemos título
    const info = await ytdlp(url, { dumpSingleJson: true, noWarnings: true });
    const sanitizedTitle = sanitizeFileName(info.title);

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(sanitizedTitle)}.mp3"`
    );
    res.setHeader("Content-Type", "audio/mpeg");

    // Stream directo yt-dlp -> res
    const proc: any = ytdlpRaw(url, {
      extractAudio: true,
      audioFormat: "mp3",
      audioQuality: 0,
      noWarnings: true,
      noPlaylist: true,
      output: "-", // salida estándar
    });

    proc.stdout.pipe(res);

    proc.stderr.on("data", (d: any) => console.log("yt-dlp:", d.toString()));
  } catch (err) {
    console.error("❌ Error al procesar:", err);
    res.status(500).send("❌ Error al procesar el video");
  }
});

//
// 📦 Descargar playlist (descargas en paralelo)
//
app.post("/playlist", async (req: Request, res: Response): Promise<void> => {
  const { url } = req.body;

  if (!url || !url.includes("playlist?list=")) {
    res.status(400).send("❌ URL de playlist no válida");
    return;
  }

  const tempDir = path.join(BASE_DOWNLOAD_DIR, uuidv4());
  const zipPath = path.join(BASE_DOWNLOAD_DIR, `${uuidv4()}.zip`);
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    const playlistInfo = await ytdlp(url, {
      dumpSingleJson: true,
      noWarnings: true,
    });

    const entries = playlistInfo.entries as any[];
    console.log(`🎧 Playlist con ${entries.length} videos`);

    // 🔹 Límite de concurrencia a 3 descargas simultáneas
    const limit = pLimit(3);

    await Promise.all(
      entries.map((video) =>
        limit(async () => {
          const videoUrl = `https://www.youtube.com/watch?v=${video.id}`;
          const sanitizedTitle = sanitizeFileName(video.title);
          const outputPath = path.join(tempDir, `${sanitizedTitle}.mp3`);

          console.log(`▶️ Descargando: ${video.title}`);

          await ytdlp(videoUrl, {
            extractAudio: true,
            audioFormat: "mp3",
            audioQuality: 0,
            output: outputPath,
            noWarnings: true,
            noPlaylist: true,
          });
        })
      )
    );

    const files = globSync(`${tempDir}/*.mp3`);
    if (files.length === 0) {
      cleanFolder(tempDir);
      res.status(404).send("❌ No se encontraron MP3");
      return;
    }

    // 🔹 Crear ZIP
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => {
      res.download(zipPath, "playlist.zip", (err) => {
        if (err) console.error("❌ Error al enviar ZIP:", err);
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
    console.error("❌ Error en playlist:", err);
    cleanFolder(tempDir);
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    res.status(500).send("❌ Error al procesar la playlist");
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor activo en http://0.0.0.0:${PORT}`);
});
