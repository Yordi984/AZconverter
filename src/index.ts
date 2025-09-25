import express, { Request, Response } from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { globSync } from "glob";
import ytdlpRaw from "yt-dlp-exec";
import archiver from "archiver";
import { v4 as uuidv4 } from "uuid";
import pLimit from "p-limit";
import tmp from "tmp";

const app = express();
const PORT = 3000;
const BASE_DOWNLOAD_DIR = path.resolve(__dirname, "..", "downloads");

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

// 🔹 Funciones auxiliares
const sanitizeFileName = (name: string) => name.replace(/[\\/:*?"<>|]/g, "_");

const cleanFolder = (folderPath: string) => {
  if (fs.existsSync(folderPath)) {
    fs.readdirSync(folderPath).forEach((file) => {
      const filePath = path.join(folderPath, file);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    });
    fs.rmdirSync(folderPath, { recursive: true });
  }
};

const isValidYouTubeUrl = (url: string) => {
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

const extractYouTubeVideoUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtu.be")) {
      return `https://www.youtube.com/watch?v=${parsed.pathname.slice(1)}`;
    } else if (parsed.hostname.includes("youtube.com")) {
      const id = parsed.searchParams.get("v");
      const list = parsed.searchParams.get("list");
      if (list) return `https://www.youtube.com/playlist?list=${list}`;
      if (id) return `https://www.youtube.com/watch?v=${id}`;
    }
    return url;
  } catch {
    return url;
  }
};

const getVideoInfo = async (url: string) => {
  return await ytdlpRaw(url, {
    dumpSingleJson: true,
    noWarnings: true,
    noCheckCertificate: true,
    preferFreeFormats: true,
  });
};

// 🔹 Endpoint: video individual
app.post("/download", async (req: Request, res: Response) => {
  const { url } = req.body;

  if (!url || !isValidYouTubeUrl(url)) {
    res.status(400).send("❌ URL de YouTube no válida");
    return;
  }

  const cleanUrl = extractYouTubeVideoUrl(url);

  try {
    const info: any = await getVideoInfo(cleanUrl);
    const sanitizedTitle = sanitizeFileName(info.title);

    // Crear archivo temporal
    const tmpFile = tmp.tmpNameSync({ postfix: ".mp3" });

    await ytdlpRaw(cleanUrl, {
      extractAudio: true,
      audioFormat: "mp3",
      audioQuality: 0,
      output: tmpFile,
      noWarnings: true,
      noPlaylist: true,
    });

    res.download(tmpFile, `${sanitizedTitle}.mp3`, (err) => {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
      if (err) console.error("❌ Error enviando MP3:", err);
    });
  } catch (err: any) {
    console.error("❌ Error al procesar:", err.stderr || err.message || err);
    res.status(500).send("❌ Error al procesar el video");
  }
});

// 🔹 Endpoint: playlist
app.post("/playlist", async (req: Request, res: Response) => {
  const { url } = req.body;

  if (!url || !url.includes("list=")) {
    res.status(400).send("❌ URL de playlist no válida");
    return;
  }

  const cleanUrl = extractYouTubeVideoUrl(url);
  const tempDir = path.join(BASE_DOWNLOAD_DIR, uuidv4());
  const zipPath = path.join(BASE_DOWNLOAD_DIR, `${uuidv4()}.zip`);
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    const playlistInfo: any = await getVideoInfo(cleanUrl);

    if (!("entries" in playlistInfo)) {
      throw new Error("❌ No se encontró la lista de videos en la playlist");
    }

    const entries: any[] = playlistInfo.entries;
    console.log(`🎧 Playlist con ${entries.length} videos`);

    const limit = pLimit(3); // 3 descargas simultáneas

    await Promise.all(
      entries.map((video) =>
        limit(async () => {
          const videoUrl = `https://www.youtube.com/watch?v=${video.id}`;
          const sanitizedTitle = sanitizeFileName(video.title);
          const outputPath = path.join(tempDir, `${sanitizedTitle}.mp3`);

          try {
            await ytdlpRaw(videoUrl, {
              extractAudio: true,
              audioFormat: "mp3",
              audioQuality: 0,
              output: outputPath,
              noWarnings: true,
              noPlaylist: true,
            });
            console.log(`✔️ Descargado: ${video.title}`);
          } catch (err: any) {
            console.warn(
              `⚠️ No se pudo descargar: ${video.title}`,
              err.message || err
            );
          }
        })
      )
    );

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
        if (err) console.error("❌ Error enviando ZIP:", err);
        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
        cleanFolder(tempDir);
      });
    });

    archive.on("error", (err) => {
      throw err;
    });

    archive.pipe(output);
    files.forEach((file) => archive.file(file, { name: path.basename(file) }));
    await archive.finalize();
  } catch (err: any) {
    console.error("❌ Error en playlist:", err.stderr || err.message || err);
    cleanFolder(tempDir);
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    res.status(500).send("❌ Error al procesar la playlist");
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor activo en http://0.0.0.0:${PORT}`);
});
