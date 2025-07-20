import express, { Request, Response } from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { globSync } from "glob";
import ytdlp from "yt-dlp-exec";
import archiver from "archiver";
import { v4 as uuidv4 } from "uuid";
import { pipeline } from "stream/promises";

const app = express();
const PORT = 3000;

const baseDownloadDir = path.join(__dirname, "downloads");

app.use(express.json());
app.use(
  cors({
    exposedHeaders: ["Content-Disposition"],
  })
);

if (!fs.existsSync(baseDownloadDir))
  fs.mkdirSync(baseDownloadDir, { recursive: true });

async function cleanFolder(folderPath: string) {
  if (fs.existsSync(folderPath)) {
    fs.readdirSync(folderPath).forEach((file) => {
      fs.unlinkSync(path.join(folderPath, file));
    });
    fs.rmdirSync(folderPath);
  }
}

app.post("/download", async (req: Request, res: Response): Promise<void> => {
  const { url } = req.body;

  if (
    !url ||
    !/^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)/.test(url)
  ) {
    res.status(400).send("❌ URL de YouTube no válida");
    return;
  }

  const tempDir = path.join(baseDownloadDir, uuidv4());
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    await ytdlp(url, {
      extractAudio: true,
      audioFormat: "mp3",
      output: path.join(tempDir, "%(title)s.%(ext)s"),
      noWarnings: true,
    });

    const files = globSync(`${tempDir}/*.mp3`);
    if (files.length === 0) {
      await cleanFolder(tempDir);
      res.status(404).send("❌ No se encontró el archivo MP3");
      return;
    }

    const filePath = files[0];
    const stats = fs.statSync(filePath);
    if (stats.size < 1000) {
      await cleanFolder(tempDir);
      res.status(500).send("❌ El archivo MP3 generado es inválido");
      return;
    }

    const fileName = path.basename(filePath);

    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", stats.size);

    const fileStream = fs.createReadStream(filePath);

    fileStream.on("end", async () => {
      console.log("✅ Transferencia completada:", fileName);
      await cleanFolder(tempDir);
    });

    fileStream.on("error", async (err) => {
      console.error("❌ Error en stream:", err);
      await cleanFolder(tempDir);
      if (!res.headersSent) {
        res.status(500).send("Error enviando el archivo");
      }
    });

    await pipeline(fileStream, res);
  } catch (error) {
    console.error("❌ Error al procesar el video:", error);
    await cleanFolder(tempDir);
    if (!res.headersSent) {
      res.status(500).send("❌ Error al procesar el video");
    }
  }
});

app.post("/playlist", async (req: Request, res: Response): Promise<void> => {
  const { url } = req.body;

  if (!url || !/youtube\.com\/playlist\?list=/.test(url)) {
    res.status(400).send("❌ URL de Playlist no válida");
    return;
  }

  const tempDir = path.join(baseDownloadDir, uuidv4());
  fs.mkdirSync(tempDir, { recursive: true });

  const zipPath = path.join(tempDir, "playlist.zip");

  try {
    await ytdlp(url, {
      extractAudio: true,
      audioFormat: "mp3",
      output: path.join(tempDir, "%(title)s.%(ext)s"),
      yesPlaylist: true,
      noWarnings: true,
    });

    const files = globSync(`${tempDir}/*.mp3`);
    if (files.length === 0) {
      await cleanFolder(tempDir);
      res.status(404).send("❌ No se encontraron archivos MP3");
      return;
    }

    // Crear ZIP con archiver
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    archive.pipe(output);
    files.forEach((file) => {
      archive.file(file, { name: path.basename(file) });
    });

    await archive.finalize();

    // Cuando ZIP esté listo, enviar con stream y luego limpiar
    output.on("close", async () => {
      const stats = fs.statSync(zipPath);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="playlist.zip"`
      );
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Length", stats.size);

      const zipStream = fs.createReadStream(zipPath);

      zipStream.on("end", async () => {
        console.log("✅ ZIP enviado y descarga completada");
        await cleanFolder(tempDir);
      });

      zipStream.on("error", async (err) => {
        console.error("❌ Error enviando ZIP:", err);
        await cleanFolder(tempDir);
        if (!res.headersSent) {
          res.status(500).send("Error enviando el ZIP");
        }
      });

      await pipeline(zipStream, res);
    });

    output.on("error", async (err) => {
      console.error("❌ Error al crear ZIP:", err);
      await cleanFolder(tempDir);
      if (!res.headersSent) {
        res.status(500).send("Error creando el ZIP");
      }
    });
  } catch (error) {
    console.error("❌ Error al procesar la playlist:", error);
    await cleanFolder(tempDir);
    if (!res.headersSent) {
      res.status(500).send("❌ Error al procesar la playlist");
    }
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor activo en http://0.0.0.0:${PORT}`);
});
