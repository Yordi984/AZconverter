import express, { Request, Response } from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { globSync } from "glob";
import ytdlp from "yt-dlp-exec";
import archiver from "archiver";
import { v4 as uuidv4 } from "uuid";

const app = express();
const PORT = 3000;

const baseDownloadDir = path.join(__dirname, "downloads");

app.use(express.json());
app.use(
  cors({
    exposedHeaders: ["Content-Disposition"],
  })
);

// Asegura que el directorio base exista
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

  // Crear carpeta temporal única para esta descarga
  const tempDir = path.join(baseDownloadDir, uuidv4());
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    // Descargar audio al directorio temporal
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

    // Envía y elimina carpeta completa después
    res.download(filePath, fileName, async (err) => {
      if (err) {
        console.error("❌ Error al enviar el archivo:", err);
      } else {
        console.log("✅ Archivo enviado:", fileName);
      }
      await cleanFolder(tempDir);
    });
  } catch (error) {
    console.error("❌ Error al procesar el video:", error);
    await cleanFolder(tempDir);
    res.status(500).send("❌ Error al procesar el video");
  }
});

app.post("/playlist", async (req: Request, res: Response): Promise<void> => {
  const { url } = req.body;

  if (!url || !/youtube\.com\/playlist\?list=/.test(url)) {
    res.status(400).send("❌ URL de Playlist no válida");
    return;
  }

  // Crear carpeta temporal única para esta descarga
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

    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => {
      res.download(zipPath, "playlist.zip", async (err) => {
        if (err) {
          console.error("❌ Error al enviar el ZIP:", err);
        } else {
          console.log("✅ ZIP enviado");
        }
        await cleanFolder(tempDir);
      });
    });

    archive.on("error", async (err) => {
      await cleanFolder(tempDir);
      throw err;
    });

    archive.pipe(output);
    files.forEach((file) => {
      archive.file(file, { name: path.basename(file) });
    });

    await archive.finalize();
  } catch (error) {
    console.error("❌ Error al procesar la playlist:", error);
    await cleanFolder(tempDir);
    res.status(500).send("❌ Error al procesar la playlist");
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor activo en http://0.0.0.0:${PORT}`);
});
