import express, { Request, Response } from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { globSync } from "glob";
import ytdlp from "yt-dlp-exec";
import archiver from "archiver";

const app = express();
const PORT = 3000;

const downloadDir = path.join(__dirname, "downloads");
const zipPath = path.join(__dirname, "downloads.zip");

app.use(express.json());
app.use(
  cors({
    exposedHeaders: ["Content-Disposition"],
  })
);

// Asegura que el directorio exista
if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir);

// Ruta para convertir un solo video
app.post("/download", async (req: Request, res: Response): Promise<void> => {
  const { url } = req.body;

  if (
    !url ||
    !/^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)/.test(url)
  ) {
    res.status(400).send("❌ URL de YouTube no válida");
    return;
  }

  try {
    await ytdlp(url, {
      extractAudio: true,
      audioFormat: "mp3",
      output: path.join(downloadDir, "%(title)s.%(ext)s"),
      noWarnings: true,
    });

    const files = globSync(`${downloadDir}/*.mp3`);
    if (files.length === 0) {
      res.status(404).send("No se encontró el archivo MP3");
      return;
    }

    const filePath = files[0];
    const fileName = path.basename(filePath);

    res.download(filePath, fileName, (err) => {
      if (err) {
        console.error("❌ Error al enviar el archivo:", err);
      } else {
        fs.unlinkSync(filePath);
      }
    });
  } catch (error) {
    console.error("❌ Error al procesar el video:", error);
    res.status(500).send("Error al procesar el video");
  }
});

// Ruta para convertir una playlist y enviar ZIP
app.post("/playlist", async (req: Request, res: Response): Promise<void> => {
  const { url } = req.body;

  if (!url || !/youtube\.com\/playlist\?list=/.test(url)) {
    res.status(400).send("❌ URL de Playlist no válida");
    return;
  }

  try {
    await ytdlp(url, {
      extractAudio: true,
      audioFormat: "mp3",
      output: path.join(downloadDir, "%(title)s.%(ext)s"),
      yesPlaylist: true,
      noWarnings: true,
    });

    const files = globSync(`${downloadDir}/*.mp3`);
    if (files.length === 0) {
      res.status(404).send("No se encontraron archivos MP3");
      return;
    }

    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => {
      res.download(zipPath, "playlist.zip", (err) => {
        if (err) {
          console.error("❌ Error al enviar el ZIP:", err);
        }

        files.forEach((file) => fs.unlinkSync(file));
        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
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
  } catch (error) {
    console.error("❌ Error al procesar la playlist:", error);
    res.status(500).send("Error al procesar la playlist");
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor activo en http://0.0.0.0:${PORT}`);
});
