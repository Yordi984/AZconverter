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

if (!fs.existsSync(BASE_DOWNLOAD_DIR))
  fs.mkdirSync(BASE_DOWNLOAD_DIR, { recursive: true });

// 🔹 Funciones auxiliares
const sanitizeFileName = (name: string) => {
  if (!name) return "audio_sin_titulo";
  return name.replace(/[\\/:*?"<>|]/g, "_").substring(0, 100);
};

const cleanFolder = (folderPath: string) => {
  if (fs.existsSync(folderPath)) {
    try {
      fs.readdirSync(folderPath).forEach((file) => {
        const filePath = path.join(folderPath, file);
        try {
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch (err) {
          console.warn(`No se pudo eliminar: ${filePath}`, err);
        }
      });
      fs.rmSync(folderPath, { recursive: true, force: true });
    } catch (err) {
      console.warn(`No se pudo limpiar carpeta: ${folderPath}`, err);
    }
  }
};

const isValidYouTubeUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    const validHostnames = [
      "youtube.com",
      "www.youtube.com",
      "m.youtube.com",
      "music.youtube.com",
      "youtu.be",
      "www.youtu.be",
    ];

    const isValidHost = validHostnames.some(
      (hostname) =>
        parsed.hostname === hostname || parsed.hostname.endsWith("." + hostname)
    );

    const hasVideoId = parsed.searchParams.get("v") !== null;
    const hasPlaylistId = parsed.searchParams.get("list") !== null;
    const isYoutuBe =
      parsed.hostname.includes("youtu.be") && parsed.pathname.length > 1;

    return isValidHost && (hasVideoId || hasPlaylistId || isYoutuBe);
  } catch {
    return false;
  }
};

const extractYouTubeVideoUrl = (
  url: string,
  forceSingleVideo: boolean = false
) => {
  try {
    const parsed = new URL(url);

    if (parsed.hostname.includes("youtu.be")) {
      const videoId = parsed.pathname.slice(1).split("/")[0];
      return `https://www.youtube.com/watch?v=${videoId}`;
    }

    if (parsed.hostname.includes("youtube.com")) {
      const videoId = parsed.searchParams.get("v");
      const listId = parsed.searchParams.get("list");

      if (forceSingleVideo && videoId) {
        return `https://www.youtube.com/watch?v=${videoId}`;
      }

      if (listId) {
        return `https://www.youtube.com/playlist?list=${listId}`;
      }

      if (videoId) {
        return `https://www.youtube.com/watch?v=${videoId}`;
      }
    }

    return url;
  } catch {
    return url;
  }
};

const getVideoInfo = async (url: string, retries = 3): Promise<any> => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const info = await ytdlpRaw(url, {
        dumpSingleJson: true,
        noWarnings: true,
        noCheckCertificate: true,
        preferFreeFormats: true,
        socketTimeout: 30000,
      });
      return info;
    } catch (error: any) {
      console.warn(`Intento ${attempt} fallido para ${url}:`, error.message);
      if (attempt === retries) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
  }
};

const downloadAudio = async (
  url: string,
  outputPath: string
): Promise<boolean> => {
  try {
    await ytdlpRaw(url, {
      extractAudio: true,
      audioFormat: "mp3",
      audioQuality: 0,
      output: outputPath,
      noWarnings: true,
      noPlaylist: true,
      socketTimeout: 30000,
      retries: 3,

      continue: true,
      noPart: true,
    });
    return true;
  } catch (error: any) {
    console.error(`Error descargando ${url}:`, error.message);
    return false;
  }
};

// 🔹 Endpoint para video individual
app.post("/download", async (req: Request, res: Response) => {
  const { url } = req.body;

  if (!url || !isValidYouTubeUrl(url)) {
    res.status(400).json({ error: "❌ URL de YouTube no válida" });
    return;
  }

  const cleanUrl = extractYouTubeVideoUrl(url, true);
  let tmpFile: string | null = null;

  try {
    console.log(`📥 Procesando video individual: ${cleanUrl}`);

    const info = await getVideoInfo(cleanUrl);

    if (!info || !info.title) {
      throw new Error("No se pudo obtener información del video");
    }

    const sanitizedTitle = sanitizeFileName(info.title);
    tmpFile = tmp.tmpNameSync({ postfix: ".mp3" });

    const success = await downloadAudio(cleanUrl, tmpFile);

    if (
      !success ||
      !fs.existsSync(tmpFile) ||
      fs.statSync(tmpFile).size === 0
    ) {
      throw new Error("No se pudo descargar el archivo de audio");
    }

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${sanitizedTitle}.mp3"`
    );

    const fileStream = fs.createReadStream(tmpFile);
    fileStream.pipe(res);

    fileStream.on("end", () => {
      if (tmpFile && fs.existsSync(tmpFile)) {
        fs.unlinkSync(tmpFile);
      }
    });

    fileStream.on("error", (err) => {
      console.error("Error enviando archivo:", err);
      if (tmpFile && fs.existsSync(tmpFile)) {
        fs.unlinkSync(tmpFile);
      }
      if (!res.headersSent) {
        res.status(500).json({ error: "Error enviando el archivo" });
      }
    });
  } catch (err: any) {
    console.error("❌ Error al procesar:", err.message || err);

    if (tmpFile && fs.existsSync(tmpFile)) {
      fs.unlinkSync(tmpFile);
    }

    if (!res.headersSent) {
      res.status(500).json({
        error: "❌ Error al procesar el video",
        details: err.message,
      });
    }
  }
});

// 🔹 Endpoint para playlist
app.post("/playlist", async (req: Request, res: Response) => {
  const { url } = req.body;

  if (!url || !isValidYouTubeUrl(url)) {
    res.status(400).json({ error: "❌ URL de YouTube no válida" });
    return;
  }

  const cleanUrl = extractYouTubeVideoUrl(url);

  if (!cleanUrl.includes("playlist?list=")) {
    res.status(400).json({
      error:
        "❌ Esta URL no es una playlist. Usa /download para videos individuales",
    });
    return;
  }

  const tempDir = path.join(BASE_DOWNLOAD_DIR, uuidv4());
  const zipPath = path.join(BASE_DOWNLOAD_DIR, `${uuidv4()}.zip`);

  try {
    fs.mkdirSync(tempDir, { recursive: true });

    console.log(`🎧 Obteniendo información de playlist: ${cleanUrl}`);
    const playlistInfo = await getVideoInfo(cleanUrl);

    if (
      !playlistInfo ||
      !playlistInfo.entries ||
      !Array.isArray(playlistInfo.entries)
    ) {
      throw new Error(
        "❌ No se pudo obtener información de la playlist o está vacía"
      );
    }

    const validEntries = playlistInfo.entries
      .filter((entry: any) => entry && entry.id && entry.title)
      .slice(0, 100);

    console.log(`🎧 Playlist con ${validEntries.length} videos válidos`);

    if (validEntries.length === 0) {
      throw new Error("No se encontraron videos válidos en la playlist");
    }

    const limit = pLimit(2);

    const downloadResults = await Promise.allSettled(
      validEntries.map((video: any) =>
        limit(async () => {
          const videoUrl = `https://www.youtube.com/watch?v=${video.id}`;
          const sanitizedTitle = sanitizeFileName(video.title);
          const outputPath = path.join(tempDir, `${sanitizedTitle}.mp3`);

          try {
            const success = await downloadAudio(videoUrl, outputPath);
            if (success && fs.existsSync(outputPath)) {
              console.log(`✔ Descargado: ${video.title}`);
              return { success: true, title: video.title };
            } else {
              console.warn(`⚠ No se pudo descargar: ${video.title}`);
              return { success: false, title: video.title };
            }
          } catch (err: any) {
            console.warn(`⚠ Error en ${video.title}:`, err.message);
            return { success: false, title: video.title };
          }
        })
      )
    );

    const successfulDownloads = downloadResults.filter(
      (
        result
      ): result is PromiseFulfilledResult<{
        success: boolean;
        title: string;
      }> => result.status === "fulfilled" && result.value.success
    );

    console.log(
      `✅ ${successfulDownloads.length}/${validEntries.length} descargas exitosas`
    );

    const files = globSync(`${tempDir}/*.mp3`);
    if (files.length === 0) {
      throw new Error("❌ No se pudieron descargar archivos MP3");
    }

    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", {
      zlib: { level: 9 },
    });

    await new Promise<void>((resolve, reject) => {
      output.on("close", resolve);
      output.on("error", reject);
      archive.on("error", reject);

      archive.pipe(output);
      files.forEach((file) => {
        archive.file(file, { name: path.basename(file) });
      });

      archive.finalize();
    });

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", 'attachment; filename="playlist.zip"');

    const fileStream = fs.createReadStream(zipPath);
    fileStream.pipe(res);

    fileStream.on("end", () => {
      cleanFolder(tempDir);
      if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    });

    fileStream.on("error", (err) => {
      console.error("Error enviando ZIP:", err);
      cleanFolder(tempDir);
      if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
      if (!res.headersSent) {
        res.status(500).json({ error: "Error enviando el archivo ZIP" });
      }
    });
  } catch (err: any) {
    console.error("❌ Error en playlist:", err.message);

    cleanFolder(tempDir);
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

    if (!res.headersSent) {
      res.status(500).json({
        error: "❌ Error al procesar la playlist",
        details: err.message,
      });
    }
  }
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor activo en http://0.0.0.0:${PORT}`);
});
