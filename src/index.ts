import express, { Request, Response } from "express";
import http from "http";
import cors from "cors";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import archiver from "archiver";
import { Server } from "socket.io";
import { v4 as uuidv4 } from "uuid";
import tmp from "tmp";
import pLimit from "p-limit";
import { globSync } from "glob";

// =========================================================
// CONFIG
// =========================================================
const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

app.use(express.json());
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    exposedHeaders: ["Content-Disposition"],
  })
);
app.options("*", cors());

const PORT = 3000;
const BASE_DIR = path.resolve(__dirname, "..", "downloads");

// Ruta al ejecutable yt-dlp.exe (bin/yt-dlp.exe en la raíz del proyecto)
const YTDLP_PATH = path.join(process.cwd(), "bin", "yt-dlp.exe");

if (!fs.existsSync(BASE_DIR)) {
  fs.mkdirSync(BASE_DIR, { recursive: true });
}

// =========================================================
// UTILIDADES
// =========================================================

const sanitizeFileName = (name: string) => {
  return (name || "audio_sin_titulo")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .substring(0, 100);
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

// Obtener info de video o playlist usando yt-dlp (JSON)
const getVideoInfo = (url: string, isPlaylist = false): Promise<any> => {
  return new Promise((resolve, reject) => {
    const args = ["--dump-single-json"];
    if (!isPlaylist) {
      args.push("--no-playlist");
    }
    args.push(url);

    const yt = spawn(YTDLP_PATH, args);
    let data = "";

    yt.stdout.on("data", (chunk) => (data += chunk.toString()));

    yt.on("close", (code) => {
      if (code === 0) {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (e) {
          reject(new Error("Error parseando JSON"));
        }
      } else {
        reject(new Error("yt-dlp falló al obtener info JSON"));
      }
    });

    yt.on("error", (err) => reject(err));
  });
};

// =========================================================
// 🔥 DESCARGA INDIVIDUAL CON PROGRESO
// =========================================================

const downloadAudioWithProgress = (
  url: string,
  outputPath: string,
  socketId?: string
): Promise<void> => {
  return new Promise((resolve, reject) => {
    const args = [
      "-x",
      "--audio-format",
      "mp3",
      "--audio-quality",
      "0",
      "--no-warnings",
      "--no-playlist",
      "--newline", // ⚡ para que imprima cada progreso en una línea
      "--progress-template",
      "%(progress._percent_str)s", // solo " 5.0%", "10.0%", etc
      "-o",
      outputPath,
      url,
    ];

    const yt = spawn(YTDLP_PATH, args);

    const handleChunk = (data: Buffer) => {
      const text = data.toString().trim();
      if (!text) return;
      console.log("YT-DLP PROGRESS LINE:", text);

      // Ejemplo esperado: "  5.0%" o "10.0%"
      const match = text.match(/(\d+(?:[.,]\d+)?)%/);
      if (match && socketId) {
        const value = Number(match[1].replace(",", "."));
        console.log("➡️ Progreso detectado:", value);
        io.to(socketId).emit("progress", { progress: value });
      }
    };

    yt.stdout.on("data", handleChunk);
    yt.stderr.on("data", handleChunk);

    yt.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error("yt-dlp falló al descargar audio"));
    });

    yt.on("error", (err) => reject(err));
  });
};

// =========================================================
// ENDPOINT: VIDEO INDIVIDUAL
// =========================================================

app.post("/download", async (req: Request, res: Response) => {
  const { url, socketId } = req.body;

  if (!url || !isValidYouTubeUrl(url)) {
    res.status(400).json({ error: "❌ URL de YouTube no válida" });
    return;
  }

  const cleanUrl = extractYouTubeVideoUrl(url, true);
  let tmpFile: string | null = null;

  try {
    console.log(`📥 Procesando video individual: ${cleanUrl}`);
    console.log("📡 socketId recibido:", socketId);

    // 1️⃣ Obtener info del video para el nombre
    const info = await getVideoInfo(cleanUrl, false);

    if (!info || !info.title) {
      throw new Error("No se pudo obtener información del video");
    }

    const sanitizedTitle = sanitizeFileName(info.title);
    tmpFile = tmp.tmpNameSync({ postfix: ".mp3" });

    // 2️⃣ Descargar con progreso
    await downloadAudioWithProgress(cleanUrl, tmpFile, socketId);

    if (!fs.existsSync(tmpFile) || fs.statSync(tmpFile).size === 0) {
      throw new Error("No se pudo descargar el archivo de audio");
    }

    // 3️⃣ Enviar con nombre correcto
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

// =========================================================
// 🔥 DESCARGA AUDIO SIMPLE (PARA PLAYLIST)
// =========================================================

const downloadAudioSimple = (
  url: string,
  outputPath: string
): Promise<boolean> => {
  return new Promise((resolve) => {
    const yt = spawn(YTDLP_PATH, [
      "-x",
      "--audio-format",
      "mp3",
      "--audio-quality",
      "0",
      "--no-warnings",
      "-o",
      outputPath,
      url,
    ]);

    yt.on("close", (code) => resolve(code === 0));
    yt.on("error", () => resolve(false));
  });
};

// =========================================================
// ENDPOINT: PLAYLIST
// =========================================================

app.post("/playlist", async (req: Request, res: Response) => {
  const { url, socketId } = req.body;

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

  const tempDir = path.join(BASE_DIR, uuidv4());
  const zipPath = path.join(BASE_DIR, `${uuidv4()}.zip`);

  try {
    fs.mkdirSync(tempDir, { recursive: true });

    console.log(`🎧 Obteniendo información de playlist: ${cleanUrl}`);
    console.log("📡 socketId recibido:", socketId);

    const playlistInfo = await getVideoInfo(cleanUrl, true);

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
    let index = 0;

    await Promise.all(
      validEntries.map((video: any) =>
        limit(async () => {
          index++;

          const videoUrl = `https://www.youtube.com/watch?v=${video.id}`;
          const sanitizedTitle = sanitizeFileName(video.title);
          const outputPath = path.join(tempDir, `${sanitizedTitle}.mp3`);

          const percent = Math.round((index / validEntries.length) * 100);
          console.log(
            `➡️ Progreso playlist: ${percent}% (${index}/${validEntries.length})`
          );

          if (socketId) {
            io.to(socketId).emit("progress", {
              progress: percent,
              current: video.title,
            });
          }

          try {
            const success = await downloadAudioSimple(videoUrl, outputPath);
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

    const playlistName = sanitizeFileName(playlistInfo.title || "playlist");

    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${playlistName}.zip"`
    );

    const fileStream = fs.createReadStream(zipPath);
    fileStream.pipe(res);

    fileStream.on("end", () => {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
      if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    });

    fileStream.on("error", (err) => {
      console.error("Error enviando ZIP:", err);
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
      if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
      if (!res.headersSent) {
        res.status(500).json({ error: "Error enviando el archivo ZIP" });
      }
    });
  } catch (err: any) {
    console.error("❌ Error en playlist:", err.message);

    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

    if (!res.headersSent) {
      res.status(500).json({
        error: "❌ Error al procesar la playlist",
        details: err.message,
      });
    }
  }
});

// =========================================================
// INICIAR SERVIDOR
// =========================================================

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🔥 Servidor listo en http://localhost:${PORT}`);
});
